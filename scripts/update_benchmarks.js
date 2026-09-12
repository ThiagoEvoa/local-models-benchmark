#!/usr/bin/env node
/**
 * Update LLM Benchmark Data from Multi-Tier Sources:
 * 
 * Requirements:
 * 1. Ingests MODEL_NAMES repository variable (and falls back to MODEL_URLS or defaults)
 * 2. Benchmarks:
 *    - SWE-bench Verified/Pro (swebench.com, github.com/SWE-bench/SWE-bench)
 *    - LiveCodeBench (livecodebench.github.io, github.com/LiveCodeBench/LiveCodeBench)
 *    - Terminal-Bench 2.1 (tbench.ai)
 *    - MCP Atlas (scale.com/leaderboard/mcp_atlas, github.com/scaleapi/mcp-atlas)
 *    - Tau-Bench (github.com/sierra-research/tau2-bench)
 *    - AIME 2026 (aimeenwiki / AoPS / lab self-reported)
 *    - GPQA Diamond (github.com/idavidrein/gpqa)
 *    - HLE (agi.safe.ai/hle)
 *    - MMLU-Pro (github.com/TIGER-AI-Lab/MMLU-Pro)
 *    - OSWorld-Verified (github.com/xlang-ai/OSWorld, benchlm.ai)
 *    - MMMU-Pro (mmmu-benchmark.github.io, HF dataset MMMU/MMMU_Pro)
 *    - MathVision (github.com/mathvision-cuhk/MathVision)
 * 3. Multi-tier extraction with provenance:
 *    - Primary: Official sources & verified submissions
 *    - Fallback 1: https://artificialanalysis.ai/models/{formatted_model_name}#intelligence-breakdown
 *    - Fallback 2: Hugging Face model cards (README.md)
 * 4. Record provenance metadata (source type, source name, URL) for every extracted benchmark score.
 */

const fs = require('fs');
const path = require('path');

const BENCHMARK_INFO_FILE = path.join(__dirname, '..', 'data', 'benchmark_info.json');
const BENCHMARK_DATA_FILE = path.join(__dirname, '..', 'data', 'benchmark_data.json');
const CURATED_BENCHMARKS_FILE = path.join(__dirname, '..', 'data', 'curated_benchmarks.json');
const MODEL_CONFIGS_FILE = path.join(__dirname, '..', 'data', 'model_configs.json');

// Canonical benchmark definitions with categories and official provenance
const BENCHMARK_DEFINITIONS = [
  // Coding
  {
    id: 'swe_bench_verified',
    name: 'SWE-bench Verified',
    category: 'Coding',
    officialSource: 'SWE-bench Verified Leaderboard',
    officialUrl: 'https://www.swebench.com/verified.html',
    patterns: [/swe[-_ ]bench verified/i, /swe[-_ ]verified/i, /swebench verified/i]
  },
  {
    id: 'swe_bench_pro',
    name: 'SWE-bench Pro',
    category: 'Coding',
    officialSource: 'SWE-bench Pro Leaderboard',
    officialUrl: 'https://www.swebench.com/',
    patterns: [/swe[-_ ]bench pro/i, /swebench pro/i]
  },
  {
    id: 'livecodebench',
    name: 'LiveCodeBench',
    category: 'Coding',
    officialSource: 'LiveCodeBench Leaderboard',
    officialUrl: 'https://livecodebench.github.io/leaderboard.html',
    patterns: [/livecodebench/i, /live[-_ ]code[-_ ]bench/i, /\blcb\b/i]
  },

  // Agentic & Tool Use
  {
    id: 'terminal_bench_2_1',
    name: 'Terminal-Bench 2.1',
    category: 'Agentic & Tool Use',
    officialSource: 'Terminal-Bench Official Hub (tbench.ai)',
    officialUrl: 'https://www.tbench.ai/',
    patterns: [/terminal[-_ ]bench(?:[ ]*2\.1)?/i, /terminalbench(?:[ ]*2\.1)?/i]
  },
  {
    id: 'mcp_atlas',
    name: 'MCP Atlas',
    category: 'Agentic & Tool Use',
    officialSource: 'Scale AI Labs MCP Atlas Leaderboard',
    officialUrl: 'https://scale.com/leaderboard/mcp_atlas',
    patterns: [/mcp[-_ ]atlas/i, /mcp atlas/i]
  },
  {
    id: 'tau_bench',
    name: 'Tau-Bench',
    category: 'Agentic & Tool Use',
    officialSource: 'Sierra Research (tau2-bench)',
    officialUrl: 'https://github.com/sierra-research/tau2-bench',
    patterns: [/tau[-_ ]bench/i, /tau2\b/i, /𝛕3\\?[-_ ]banking/i, /tau[-_ ]banking/i]
  },

  // Reasoning & Math
  {
    id: 'aime_2026',
    name: 'AIME 2026',
    category: 'Reasoning & Math',
    officialSource: 'AIME / Competition self-reported',
    officialUrl: 'https://artofproblemsolving.com/wiki/index.php/AIME_Problems_and_Solutions',
    patterns: [/aime(?:[ ]*2026)?/i, /aime 26/i, /aime25/i]
  },
  {
    id: 'gpqa_diamond',
    name: 'GPQA Diamond',
    category: 'Reasoning & Math',
    officialSource: 'GPQA Official (David Rein et al.)',
    officialUrl: 'https://github.com/idavidrein/gpqa',
    patterns: [/gpqa diamond/i, /gpqa-diamond/i, /gpqa \(diamond\)/i, /\bgpqa\b/i]
  },
  {
    id: 'hle',
    name: "Humanity's Last Exam (HLE)",
    category: 'Reasoning & Math',
    officialSource: "Humanity's Last Exam (CAIS + Scale)",
    officialUrl: 'https://agi.safe.ai/hle',
    patterns: [/humanity'?s last exam/i, /\bhle\b/i]
  },
  {
    id: 'mmlu_pro',
    name: 'MMLU-Pro',
    category: 'Reasoning & Math',
    officialSource: 'TIGER AI Lab (MMLU-Pro)',
    officialUrl: 'https://github.com/TIGER-AI-Lab/MMLU-Pro',
    patterns: [/mmlu[-_ ]pro/i, /mmlu pro/i]
  },

  // Multimodal & Vision
  {
    id: 'osworld_verified',
    name: 'OSWorld-Verified',
    category: 'Multimodal & Vision',
    officialSource: 'OSWorld Verified Leaderboard',
    officialUrl: 'https://os-world.github.io/',
    patterns: [/osworld[-_ ]verified/i, /osworld/i]
  },
  {
    id: 'mmmu_pro',
    name: 'MMMU-Pro',
    category: 'Multimodal & Vision',
    officialSource: 'MMMU-Pro Official Benchmark',
    officialUrl: 'https://mmmu-benchmark.github.io/',
    patterns: [/mmmu[-_ ]pro/i, /mmmu pro/i]
  },
  {
    id: 'math_vision',
    name: 'MathVision',
    category: 'Multimodal & Vision',
    officialSource: 'CUHK MathVision Benchmark',
    officialUrl: 'https://mathvision-cuhk.github.io/',
    patterns: [/math[-_ ]vision/i, /mathvision/i]
  }
];

// Mapping helper to format model name to Artificial Analysis URL convention
// e.g., "qwen3.8-27b" -> "qwen3-8-27b", "Qwen3.6-35B-A3B" -> "qwen3-6-35b-a3b"
function formatSlugForArtificialAnalysis(name) {
  if (!name) return '';
  return name
    .toLowerCase()
    .replace(/\./g, '-')
    .replace(/[^a-z0-9\-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

// Known mapping of provider brand info
const PROVIDER_INFO = {
  qwen: { brand: 'Alibaba', logo: 'alibaba_small.svg' },
  gemma: { brand: 'Google', logo: 'google_small.svg' },
  claude: { brand: 'Anthropic', logo: 'anthropic_small.svg' },
  gpt: { brand: 'OpenAI', logo: 'openai_small.svg' },
  deepseek: { brand: 'DeepSeek', logo: 'deepseek_small.svg' },
  muse: { brand: 'Meta', logo: 'meta_small.svg' },
  grok: { brand: 'xAI', logo: 'xai_small.svg' },
  kimi: { brand: 'Moonshot', logo: 'kimi_small.svg' },
  mistral: { brand: 'Mistral', logo: 'mistral_small.svg' },
  devstral: { brand: 'Mistral', logo: 'mistral_small.svg' },
  nemotron: { brand: 'NVIDIA', logo: 'nvidia_small.svg' },
  glm: { brand: 'Zhipu AI', logo: 'zhipu_small.svg' },
  ling: { brand: '01.AI', logo: 'ling_small.svg' }
};

function getProviderDetails(modelName) {
  const norm = modelName.toLowerCase();
  for (const [key, val] of Object.entries(PROVIDER_INFO)) {
    if (norm.includes(key)) return val;
  }
  return { brand: 'Independent', logo: 'default_model.svg' };
}

// Format clean display name
function formatModelDisplayName(raw) {
  let name = raw.trim();
  if (name.includes('/')) {
    name = name.split('/').pop();
  }
  return name;
}

// Frontier reference model identifiers
const FRONTIER_MODEL_PATTERNS = [
  /claude[-_ ]?fable/i,
  /gpt[-_ ]?6/i,
  /claude[-_ ]?opus/i,
  /muse[-_ ]?spark/i,
  /glm[-_ ]?5/i,
  /gemini[-_ ]?3\.[78]/i,
  /gpt[-_ ]?5\.6/i,
  /deepseek[-_ ]?v4/i,
  /kimi[-_ ]?k3/i,
  /grok[-_ ]?4/i
];

function isFrontierModel(name) {
  return FRONTIER_MODEL_PATTERNS.some(p => p.test(name));
}

function parseModelEntries(value) {
  if (!value || !value.trim()) return [];

  return value
    .split(/[\r\n,]+/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const urlMatch = line.match(/https?:\/\/\S+/i);
      const url = urlMatch ? urlMatch[0].replace(/\/$/, '') : '';
      const name = (urlMatch ? line.slice(0, urlMatch.index) : line).trim();

      // URL-only entries remain supported for compatibility with MODEL_URLS.
      if (!name && url) {
        const parts = url.split('huggingface.co/')[1]?.split('/') || [];
        return { name: parts[1] || parts[0] || url, repoUrl: url };
      }

      return { name, repoUrl: url };
    })
    .filter(entry => entry.name);
}

// Convert MODEL_NAMES and FRONTIER_MODEL_NAMES into structured model descriptors.
function resolveModelList() {
  const envModelNames = process.env.MODEL_NAMES;
  const envFrontierNames = process.env.FRONTIER_MODEL_NAMES;
  const envModelUrls = process.env.MODEL_URLS;
  const hasExplicitFrontierList = Boolean(envFrontierNames && envFrontierNames.trim());

  let localEntries = parseModelEntries(envModelNames);
  if (localEntries.length === 0 && envModelUrls && envModelUrls.trim()) {
    localEntries = parseModelEntries(envModelUrls);
  }

  // If local list is empty, use repository default models.
  if (localEntries.length === 0) {
    localEntries = [
      { name: 'qwen3.8-27b', repoUrl: '' },
      { name: 'qwen3.6-27b', repoUrl: '' },
      { name: 'qwen3.6-35b', repoUrl: '' }
    ];
  }

  const frontierEntries = parseModelEntries(envFrontierNames);
  const frontierIds = new Set(frontierEntries.map(entry => entry.name.toLowerCase()));
  const allEntries = [...localEntries, ...frontierEntries];
  const seen = new Set();
  const models = [];

  for (const entry of allEntries) {
    const name = entry.name.trim();
    const id = name.toLowerCase();
    if (seen.has(id)) continue;
    seen.add(id);

    let repo = '';
    if (entry.repoUrl && entry.repoUrl.includes('huggingface.co/')) {
      repo = entry.repoUrl.split('huggingface.co/')[1].replace(/\/$/, '');
    } else if (/^qwen/i.test(name)) {
      repo = `Qwen/${name}`;
    } else if (/^gemma/i.test(name)) {
      repo = `google/${name}`;
    } else {
      repo = name;
    }

    const repoName = repo.includes('/') ? repo.split('/').pop() : name;
    const aaSlug = formatSlugForArtificialAnalysis(name);
    const provider = getProviderDetails(name);
    const frontier = hasExplicitFrontierList
      ? frontierIds.has(id)
      : isFrontierModel(name);

    models.push({
      id: name,
      name,
      slug: aaSlug,
      repo,
      isFrontier: frontier,
      url: `https://huggingface.co/${repo}`,
      aaUrl: `https://artificialanalysis.ai/models/${aaSlug}#intelligence-breakdown`,
      provider: provider.brand,
      logo: provider.logo
    });
  }

  return models;
}

function baselineProfile(reasoning) {
  return {
    reasoning,
    temperature: 0.7,
    top_p: 0.9,
    top_k: 20,
    min_p: 0.0,
    presence_penalty: 0.0,
    repetition_penalty: 1.0
  };
}

function findConfigValue(config, keys) {
  if (!config || typeof config !== 'object') return null;
  for (const [key, value] of Object.entries(config)) {
    if (keys.includes(key) && typeof value === 'number') return value;
    if (value && typeof value === 'object') {
      const found = findConfigValue(value, keys);
      if (found !== null) return found;
    }
  }
  return null;
}

async function fetchModelConfig(model) {
  if (!model.repo || !model.repo.includes('/')) return null;
  const base = `https://huggingface.co/${model.repo}/raw/main/`;
  const fetchJson = async name => {
    try {
      const res = await fetch(`${base}${name}`, { headers: { 'User-Agent': 'Local-LLMs-Benchmark-Matrix/2.0' } });
      return res.ok ? await res.json() : null;
    } catch (_) { return null; }
  };
  const fetchText = async name => {
    try {
      const res = await fetch(`${base}${name}`, { headers: { 'User-Agent': 'Local-LLMs-Benchmark-Matrix/2.0' } });
      return res.ok ? await res.text() : '';
    } catch (_) { return ''; }
  };

  const [modelConfig, generationConfig, tokenizerConfig, readme] = await Promise.all([
    fetchJson('config.json'), fetchJson('generation_config.json'),
    fetchJson('tokenizer_config.json'), fetchText('README.md')
  ]);
  const text = readme.toLowerCase();
  const reasoning = /reasoning|thinking|<think/.test(text) || /thinking|reasoning/i.test(JSON.stringify(tokenizerConfig || {}));
  const generation = generationConfig || {};
  const documented = {
    temperature: generation.temperature,
    top_p: generation.top_p,
    top_k: generation.top_k,
    min_p: generation.min_p,
    presence_penalty: generation.presence_penalty,
    repetition_penalty: generation.repetition_penalty
  };
  const hasSampling = Object.values(documented).some(value => typeof value === 'number');
  const general = { ...baselineProfile(reasoning) };
  for (const [key, value] of Object.entries(documented)) if (typeof value === 'number') general[key] = value;
  const context = findConfigValue(modelConfig, ['max_position_embeddings', 'max_sequence_length', 'max_seq_len']);
  const maxTokens = generation.max_new_tokens || generation.max_length || null;
  const profileSources = {
    general: hasSampling ? 'generation_config' : 'application_baseline',
    coding: 'inferred_from_general',
    fast: 'inferred_baseline'
  };
  return {
    status: hasSampling || context ? 'partial' : 'inferred',
    source: `https://huggingface.co/${model.repo}`,
    profileSources,
    capabilities: {
      reasoning,
      thinkingControl: reasoning ? 'model-card/tokenizer-template' : 'Unknown',
      thinkingFormat: /<think/.test(text) ? 'think_tags' : 'Unknown',
      supportsDeveloperRole: null,
      supportsReasoningEffort: /reasoning_effort/.test(text)
    },
    limits: { nativeContextWindow: context, recommendedMaxTokens: maxTokens },
    profiles: {
      general,
      coding: { ...general, reasoning: true },
      fast: { ...baselineProfile(false), top_p: 0.8, presence_penalty: 1.5 }
    }
  };
}

async function updateModelConfigs(modelList) {
  let existing = {};
  if (fs.existsSync(MODEL_CONFIGS_FILE)) {
    try { existing = JSON.parse(fs.readFileSync(MODEL_CONFIGS_FILE, 'utf8')); } catch (_) {}
  }
  const generated = {};
  for (const model of modelList) {
    if (existing[model.id]?.profileSources && Object.values(existing[model.id].profileSources).some(source => source.includes('model_card'))) {
      generated[model.id] = existing[model.id];
      continue;
    }
    generated[model.id] = await fetchModelConfig(model) || existing[model.id] || {
      status: 'inferred', source: model.url, profileSources: { general: 'inferred_baseline', coding: 'inferred_baseline', fast: 'inferred_baseline' },
      capabilities: { reasoning: false, thinkingControl: 'Unknown', thinkingFormat: 'Unknown', supportsDeveloperRole: null, supportsReasoningEffort: null },
      limits: { nativeContextWindow: null, recommendedMaxTokens: null },
      profiles: { general: baselineProfile(false), coding: baselineProfile(true), fast: { ...baselineProfile(false), top_p: 0.8, presence_penalty: 1.5 } }
    };
  }
  fs.writeFileSync(MODEL_CONFIGS_FILE, JSON.stringify(generated, null, 2) + '\n', 'utf8');
  console.log(`Saved model configurations for ${Object.keys(generated).length} models.`);
}

function normalizeScore(rawVal) {
  if (rawVal === undefined || rawVal === null) return null;
  let val = String(rawVal).trim().replace(/[*_`]/g, '');
  if (val === '-' || val === '--' || val === 'N/A' || val === '' || val === 'null') return null;
  const isApprox = val.startsWith('~');
  const numMatch = val.match(/([0-9]+(?:\.[0-9]+)?)/);
  if (!numMatch) return null;
  const num = parseFloat(numMatch[1]);
  return {
    value: Number(num.toFixed(1)),
    display: `${isApprox ? '~' : ''}${num.toFixed(1)}%`
  };
}

// Tier 2: Extract scores from Artificial Analysis website HTML
async function fetchFromArtificialAnalysis(slug) {
  const url = `https://artificialanalysis.ai/models/${slug}#intelligence-breakdown`;
  try {
    const res = await fetch(`https://artificialanalysis.ai/models/${slug}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
      }
    });

    if (!res.ok) {
      return null;
    }

    const html = await res.text();
    const scores = {};

    // Look for JSON-LD or script payload containing evaluation scores
    // e.g. "terminalbenchV21": 0.79775, "gpqa": 0.905, "hle": 0.339, "mmmuPro": 0.763
    const mapping = {
      terminal_bench_2_1: [/"terminalbenchV21":\s*([0-9.]+)/i, /"terminalbench":\s*([0-9.]+)/i],
      gpqa_diamond: [/"gpqa":\s*([0-9.]+)/i],
      hle: [/"hle":\s*([0-9.]+)/i],
      mmmu_pro: [/"mmmuPro":\s*([0-9.]+)/i],
      livecodebench: [/"livecodebench":\s*([0-9.]+)/i],
      aime_2026: [/"aime2(?:5|6)":\s*([0-9.]+)/i],
      tau_bench: [/"tau2":\s*([0-9.]+)/i, /"tauBanking":\s*([0-9.]+)/i]
    };

    for (const [benchId, regexes] of Object.entries(mapping)) {
      for (const reg of regexes) {
        const m = html.match(reg);
        if (m && m[1]) {
          const rawNum = parseFloat(m[1]);
          // Artificial Analysis stores 0.0 - 1.0 or 0 - 100
          const pct = rawNum <= 1.0 ? (rawNum * 100) : rawNum;
          scores[benchId] = {
            value: Number(pct.toFixed(1)),
            display: `${pct.toFixed(1)}%`,
            source: 'fallback-aa',
            sourceName: 'Artificial Analysis',
            sourceUrl: url
          };
          break;
        }
      }
    }

    return Object.keys(scores).length > 0 ? scores : null;
  } catch (err) {
    console.warn(`  [AA Fallback] Fetch failed for ${slug}: ${err.message}`);
    return null;
  }
}

// Tier 3: Fetch README from Hugging Face model card
async function fetchFromHuggingFaceReadme(repo, modelName) {
  const urls = [
    `https://huggingface.co/${repo}/raw/main/README.md`,
    `https://huggingface.co/${repo}/raw/master/README.md`
  ];

  let content = null;
  let sourceUrl = `https://huggingface.co/${repo}`;

  for (const u of urls) {
    try {
      const res = await fetch(u, {
        headers: { 'User-Agent': 'Local-LLMs-Benchmark-Matrix/2.0' }
      });
      if (res.ok) {
        content = await res.text();
        sourceUrl = u;
        break;
      }
    } catch (_) {}
  }

  if (!content) return {};

  const scores = {};
  const lines = content.split('\n');
  const sourceUrlForModelCard = `https://huggingface.co/${repo}`;

  // Model cards commonly publish benchmark tables as HTML instead of Markdown.
  // Parse first score column: model being synced is table's first model column.
  const htmlRows = [...content.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)]
    .map(match => [...match[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)]
      .map(cell => cell[1]
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&#39;/gi, "'")
        .replace(/&quot;/gi, '"')
        .replace(/\s+/g, ' ')
        .trim()));

  for (const def of BENCHMARK_DEFINITIONS) {
    // Markdown table support.
    for (const line of lines) {
      if (!line.includes('|')) continue;
      const cells = line.split('|').map(c => c.trim()).filter(Boolean);
      if (cells.length < 2) continue;

      const hasMatch = def.patterns.some(p => p.test(cells[0]));
      if (hasMatch) {
        for (let i = 1; i < cells.length; i++) {
          const norm = normalizeScore(cells[i]);
          if (norm) {
            scores[def.id] = {
              value: norm.value,
              display: norm.display,
              source: 'fallback-hf',
              sourceName: `Hugging Face (${repo})`,
              sourceUrl: sourceUrlForModelCard
            };
            break;
          }
        }
        if (scores[def.id]) break;
      }
    }

    // HTML table fallback for model cards such as Ornith-1.5-9B.
    if (!scores[def.id]) {
      for (const cells of htmlRows) {
        if (cells.length < 2 || !def.patterns.some(p => p.test(cells[0]))) continue;
        const norm = normalizeScore(cells[1]);
        if (norm) {
          scores[def.id] = {
            value: norm.value,
            display: norm.display,
            source: 'fallback-hf',
            sourceName: `Hugging Face (${repo})`,
            sourceUrl: sourceUrlForModelCard
          };
          break;
        }
      }
    }
  }

  return scores;
}

async function main() {
  console.log('=== Starting LLM Benchmark Sync Engine ===');

  let curatedData = { models: {} };
  if (fs.existsSync(CURATED_BENCHMARKS_FILE)) {
    try {
      curatedData = JSON.parse(fs.readFileSync(CURATED_BENCHMARKS_FILE, 'utf8'));
    } catch (e) {
      console.warn('Warning: Could not read curated baseline:', e.message);
    }
  }

  const modelList = resolveModelList();
  console.log(`Target Models count: ${modelList.length}`);
  modelList.forEach(m => console.log(` - ${m.name} (AA slug: ${m.slug})`));

  const finalModels = [];

  for (const model of modelList) {
    console.log(`\nProcessing Model: ${model.name}`);
    const aggregatedScores = {};

    // ---------------------------------------------------------------
    // Tier 1: Curated Official Source Extraction
    // Verified submissions to SWE-bench, LiveCodeBench, tbench, MCP Atlas, etc.
    // ---------------------------------------------------------------
    // Match curated data by model name with strict feature matching
    let foundCuratedKey = null;

    function extractFeatures(str) {
      const norm = str.toLowerCase();
      const nums = norm.match(/[0-9]+(?:\.[0-9]+)?/g) || [];
      const baseWords = ['qwen', 'gemma', 'ornith', 'muse', 'gpt', 'bonsai', 'claude', 'glm', 'gemini', 'kimi', 'deepseek'];
      const base = baseWords.find(w => norm.includes(w)) || '';
      return { base, nums, rawClean: norm.replace(/[^a-z0-9]/g, '') };
    }

    const tFeat = extractFeatures(model.name);
    let bestScore = -1;

    if (curatedData.models) {
      for (const k of Object.keys(curatedData.models)) {
        const kFeat = extractFeatures(k);
        // Base word MUST match if either has one
        if (tFeat.base !== kFeat.base) continue;

        let score = 0;
        if (tFeat.rawClean === kFeat.rawClean) {
          score += 100;
        }

        // Subword check like "spark" or "glimmer"
        if (tFeat.base === 'muse') {
          const tSpark = /spark/i.test(model.name);
          const kSpark = /spark/i.test(k);
          if (tSpark !== kSpark) continue;
        }

        const matchingNums = tFeat.nums.filter(n => kFeat.nums.includes(n));
        if (tFeat.nums.length > 0 && matchingNums.length === tFeat.nums.length) {
          score += 50 + matchingNums.length * 10;
        }

        // Fallback matching when no numbers exist (e.g. muse-spark)
        if (tFeat.nums.length === 0 && tFeat.base === kFeat.base) {
          score += 50;
        }

        if (score > bestScore && score >= 50) {
          bestScore = score;
          foundCuratedKey = k;
        }
      }
    }

    if (foundCuratedKey && curatedData.models[foundCuratedKey]) {
      const rawScores = curatedData.models[foundCuratedKey];
      console.log(`  [Tier 1: Official Source] Found verified benchmark records for ${foundCuratedKey}`);
      for (const [bId, raw] of Object.entries(rawScores)) {
        const norm = normalizeScore(raw);
        if (norm) {
          const def = BENCHMARK_DEFINITIONS.find(d => d.id === bId);
          aggregatedScores[bId] = {
            value: norm.value,
            display: norm.display,
            source: 'official',
            sourceName: def ? def.officialSource : 'Official Benchmark Leaderboard',
            sourceUrl: def ? def.officialUrl : 'https://github.com/'
          };
        }
      }
    }

    // ---------------------------------------------------------------
    // Tier 2: Artificial Analysis Fallback
    // For any missing benchmarks, query https://artificialanalysis.ai/models/{slug}#intelligence-breakdown
    // ---------------------------------------------------------------
    const missingInTier1 = BENCHMARK_DEFINITIONS.filter(d => !aggregatedScores[d.id]);
    if (missingInTier1.length > 0) {
      console.log(`  [Tier 2: Artificial Analysis Fallback] Querying ${model.aaUrl} for ${missingInTier1.length} missing benchmarks...`);
      const aaScores = await fetchFromArtificialAnalysis(model.slug);
      if (aaScores) {
        for (const [bId, scoreObj] of Object.entries(aaScores)) {
          if (!aggregatedScores[bId]) {
            aggregatedScores[bId] = scoreObj;
            console.log(`    -> Filled ${bId} from Artificial Analysis: ${scoreObj.display}`);
          }
        }
      }
    }

    // ---------------------------------------------------------------
    // Tier 3: Hugging Face Model Card Fallback
    // For any still-missing benchmarks, parse huggingface.co/{repo} README.md
    // ---------------------------------------------------------------
    const stillMissing = BENCHMARK_DEFINITIONS.filter(d => !aggregatedScores[d.id]);
    if (stillMissing.length > 0 && model.repo) {
      console.log(`  [Tier 3: Hugging Face Fallback] Checking README for ${model.repo}...`);
      const hfScores = await fetchFromHuggingFaceReadme(model.repo, model.name);
      for (const [bId, scoreObj] of Object.entries(hfScores)) {
        if (!aggregatedScores[bId]) {
          aggregatedScores[bId] = scoreObj;
          console.log(`    -> Filled ${bId} from Hugging Face: ${scoreObj.display}`);
        }
      }
    }

    // Compute composite arithmetic mean index (equivalent to Artificial Analysis Intelligence Index)
    const validScores = Object.values(aggregatedScores).map(s => s.value).filter(v => typeof v === 'number');
    const compositeIndex = validScores.length > 0
      ? Number((validScores.reduce((a, b) => a + b, 0) / validScores.length).toFixed(1))
      : 0;

    finalModels.push({
      id: model.id,
      name: model.name,
      slug: model.slug,
      repo: model.repo,
      isFrontier: model.isFrontier,
      url: model.url,
      provider: model.provider,
      logo: model.logo,
      compositeIndex,
      scores: aggregatedScores
    });
  }

  // Also include top frontier reference models to match the screenshot comparison context
  // (GPT-6 Astra, Claude Opus 5, Gemini 3.8 Flash, Muse Spark, Grok 4.6, Kimi K3, etc.)
  const frontierBaselines = [
    {
      id: 'Claude Fable 5.1 (max with fallback)',
      name: 'Claude Fable 5.1 (max with fallback)',
      slug: 'claude-fable-5-1',
      provider: 'Anthropic',
      logo: 'anthropic_small.svg',
      compositeIndex: 53.0,
      scores: {
        swe_bench_verified: { value: 85.0, display: "85.0%", source: "official", sourceName: "SWE-bench Verified Leaderboard", sourceUrl: "https://www.swebench.com/verified.html" },
        livecodebench: { value: 92.4, display: "92.4%", source: "official", sourceName: "LiveCodeBench Leaderboard", sourceUrl: "https://livecodebench.github.io/leaderboard.html" },
        terminal_bench_2_1: { value: 84.2, display: "84.2%", source: "official", sourceName: "Terminal-Bench Official Hub", sourceUrl: "https://www.tbench.ai/" }
      }
    },
    {
      id: 'GPT-6 Astra (max)',
      name: 'GPT-6 Astra (max)',
      slug: 'gpt-6-astra',
      provider: 'OpenAI',
      logo: 'openai_small.svg',
      compositeIndex: 53.0,
      scores: {
        swe_bench_verified: { value: 84.8, display: "84.8%", source: "official", sourceName: "SWE-bench Verified Leaderboard", sourceUrl: "https://www.swebench.com/verified.html" },
        livecodebench: { value: 91.8, display: "91.8%", source: "official", sourceName: "LiveCodeBench Leaderboard", sourceUrl: "https://livecodebench.github.io/leaderboard.html" },
        terminal_bench_2_1: { value: 83.5, display: "83.5%", source: "official", sourceName: "Terminal-Bench Official Hub", sourceUrl: "https://www.tbench.ai/" }
      }
    },
    {
      id: 'Claude Opus 5 (max)',
      name: 'Claude Opus 5 (max)',
      slug: 'claude-opus-5',
      provider: 'Anthropic',
      logo: 'anthropic_small.svg',
      compositeIndex: 51.0,
      scores: {
        swe_bench_verified: { value: 82.5, display: "82.5%", source: "official", sourceName: "SWE-bench Verified Leaderboard", sourceUrl: "https://www.swebench.com/verified.html" },
        livecodebench: { value: 89.5, display: "89.5%", source: "official", sourceName: "LiveCodeBench Leaderboard", sourceUrl: "https://livecodebench.github.io/leaderboard.html" }
      }
    },
    {
      id: 'Muse Spark 1.3 (max)',
      name: 'Muse Spark 1.3 (max)',
      slug: 'muse-spark-1-3',
      provider: 'Meta',
      logo: 'meta_small.svg',
      compositeIndex: 48.0,
      scores: {
        swe_bench_verified: { value: 79.2, display: "79.2%", source: "official", sourceName: "SWE-bench Verified Leaderboard", sourceUrl: "https://www.swebench.com/verified.html" }
      }
    },
    {
      id: 'GLM-5.3 (max)',
      name: 'GLM-5.3 (max)',
      slug: 'glm-5-3',
      provider: 'Zhipu AI',
      logo: 'zhipu_small.svg',
      compositeIndex: 44.0,
      scores: {
        swe_bench_verified: { value: 78.0, display: "78.0%", source: "official", sourceName: "SWE-bench Verified Leaderboard", sourceUrl: "https://www.swebench.com/verified.html" }
      }
    },
    {
      id: 'Grok 4.6 (high)',
      name: 'Grok 4.6 (high)',
      slug: 'grok-4-6',
      provider: 'xAI',
      logo: 'xai_small.svg',
      compositeIndex: 44.0,
      scores: {
        swe_bench_verified: { value: 78.0, display: "78.0%", source: "official", sourceName: "SWE-bench Verified Leaderboard", sourceUrl: "https://www.swebench.com/verified.html" }
      }
    },
    {
      id: 'Kimi K3 (max)',
      name: 'Kimi K3 (max)',
      slug: 'kimi-k3',
      provider: 'Moonshot',
      logo: 'kimi_small.svg',
      compositeIndex: 43.0,
      scores: {
        swe_bench_verified: { value: 77.0, display: "77.0%", source: "official", sourceName: "SWE-bench Verified Leaderboard", sourceUrl: "https://www.swebench.com/verified.html" }
      }
    },
    {
      id: 'Gemini 3.8 Flash (high)',
      name: 'Gemini 3.8 Flash (high)',
      slug: 'gemini-3-8-flash',
      provider: 'Google',
      logo: 'google_small.svg',
      compositeIndex: 41.0,
      scores: {
        swe_bench_verified: { value: 76.5, display: "76.5%", source: "official", sourceName: "SWE-bench Verified Leaderboard", sourceUrl: "https://www.swebench.com/verified.html" }
      }
    },
    {
      id: 'GPT-5.6 Luna (max)',
      name: 'GPT-5.6 Luna (max)',
      slug: 'gpt-5-6-luna',
      provider: 'OpenAI',
      logo: 'openai_small.svg',
      compositeIndex: 38.0,
      scores: {
        swe_bench_verified: { value: 75.0, display: "75.0%", source: "official", sourceName: "SWE-bench Verified Leaderboard", sourceUrl: "https://www.swebench.com/verified.html" }
      }
    },
    {
      id: 'DeepSeek V4 Pro 0813 (max)',
      name: 'DeepSeek V4 Pro 0813 (max)',
      slug: 'deepseek-v4-pro',
      provider: 'DeepSeek',
      logo: 'deepseek_small.svg',
      compositeIndex: 36.0,
      scores: {
        swe_bench_verified: { value: 74.0, display: "74.0%", source: "official", sourceName: "SWE-bench Verified Leaderboard", sourceUrl: "https://www.swebench.com/verified.html" }
      }
    }
  ];

  const benchmarkList = BENCHMARK_DEFINITIONS.map(d => ({
    id: d.id,
    name: d.name,
    category: d.category,
    officialSource: d.officialSource,
    officialUrl: d.officialUrl
  }));

  // Only output the target models from vars.MODEL_NAMES.
  const generatedPayload = {
    targetModels: modelList.map(m => m.name),
    benchmarks: benchmarkList,
    models: finalModels
  };

  // Preserve timestamp when polling finds no data change; avoids a commit every 15 minutes.
  let updatedAt = new Date().toISOString();
  if (fs.existsSync(BENCHMARK_DATA_FILE)) {
    try {
      const previousPayload = JSON.parse(fs.readFileSync(BENCHMARK_DATA_FILE, 'utf8'));
      const previousComparable = {
        targetModels: previousPayload.targetModels,
        benchmarks: previousPayload.benchmarks,
        models: previousPayload.models
      };
      if (JSON.stringify(previousComparable) === JSON.stringify(generatedPayload)) {
        updatedAt = previousPayload.updatedAt || updatedAt;
      }
    } catch (e) {
      console.warn('Warning: Could not compare previous benchmark data:', e.message);
    }
  }

  const outputPayload = { updatedAt, ...generatedPayload };
  fs.writeFileSync(BENCHMARK_DATA_FILE, JSON.stringify(outputPayload, null, 2), 'utf8');
  await updateModelConfigs(modelList);
  console.log(`\nSuccessfully saved updated benchmark dataset to ${BENCHMARK_DATA_FILE}`);
}

main().catch(err => {
  console.error('Fatal benchmark script error:', err);
  process.exit(1);
});
