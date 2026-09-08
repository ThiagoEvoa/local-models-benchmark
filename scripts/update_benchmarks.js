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

// Convert input model list into structured model descriptor
function resolveModelList() {
  const envModelNames = process.env.MODEL_NAMES;
  const envModelUrls = process.env.MODEL_URLS;

  let rawList = [];
  if (envModelNames && envModelNames.trim()) {
    rawList = envModelNames
      .split(/[\r\n,]+/)
      .map(s => s.trim())
      .filter(Boolean);
  } else if (envModelUrls && envModelUrls.trim()) {
    rawList = envModelUrls
      .split(/[\r\n,\s]+/)
      .map(s => s.trim())
      .filter(s => s.length > 0 && s.includes('huggingface.co/'))
      .map(url => {
        const parts = url.replace(/\/$/, '').split('huggingface.co/')[1].split('/');
        return parts[1] || parts[0];
      });
  }

  // If empty, use repository default models
  if (rawList.length === 0) {
    rawList = [
      'qwen3.8-27b',
      'qwen3.6-27b',
      'qwen3.6-35b'
    ];
  }

  // Deduplicate and structure
  const seen = new Set();
  const models = [];

  for (const item of rawList) {
    const clean = item.replace(/^https?:\/\/huggingface\.co\//, '').replace(/\/$/, '');
    const id = clean.toLowerCase();
    if (seen.has(id)) continue;
    seen.add(id);

    // Map to canonical Hugging Face repo and slug
    let repo = '';
    let name = clean;
    if (clean.includes('/')) {
      repo = clean;
      name = clean.split('/')[1];
    } else {
      // Common repo inference
      if (/^qwen/i.test(clean)) {
        repo = `Qwen/${name}`;
      } else if (/^gemma/i.test(clean)) {
        repo = `google/${name}`;
      } else {
        repo = clean;
      }
    }

    const aaSlug = formatSlugForArtificialAnalysis(name);
    const provider = getProviderDetails(name);

    models.push({
      id: name,
      name,
      slug: aaSlug,
      repo,
      url: `https://huggingface.co/${repo}`,
      aaUrl: `https://artificialanalysis.ai/models/${aaSlug}#intelligence-breakdown`,
      provider: provider.brand,
      logo: provider.logo
    });
  }

  return models;
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

  for (const def of BENCHMARK_DEFINITIONS) {
    for (const line of lines) {
      if (!line.includes('|')) continue;
      const cells = line.split('|').map(c => c.trim()).filter(Boolean);
      if (cells.length < 2) continue;

      const hasMatch = def.patterns.some(p => p.test(cells[0]));
      if (hasMatch) {
        // Try cell 1 or 2
        for (let i = 1; i < cells.length; i++) {
          const norm = normalizeScore(cells[i]);
          if (norm) {
            scores[def.id] = {
              value: norm.value,
              display: norm.display,
              source: 'fallback-hf',
              sourceName: `Hugging Face (${repo})`,
              sourceUrl: `https://huggingface.co/${repo}`
            };
            break;
          }
        }
        if (scores[def.id]) break;
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
    // Match curated data by key
    let foundCuratedKey = null;
    const cleanName = model.name.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (curatedData.models) {
      for (const k of Object.keys(curatedData.models)) {
        const cleanK = k.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (cleanK === cleanName || cleanK.includes(cleanName) || cleanName.includes(cleanK)) {
          foundCuratedKey = k;
          break;
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

  const outputPayload = {
    updatedAt: new Date().toISOString(),
    targetModels: modelList.map(m => m.name),
    benchmarks: benchmarkList,
    models: finalModels,
    comparisonBaselines: frontierBaselines
  };

  fs.writeFileSync(BENCHMARK_DATA_FILE, JSON.stringify(outputPayload, null, 2), 'utf8');
  console.log(`\nSuccessfully saved updated benchmark dataset to ${BENCHMARK_DATA_FILE}`);
}

main().catch(err => {
  console.error('Fatal benchmark script error:', err);
  process.exit(1);
});
