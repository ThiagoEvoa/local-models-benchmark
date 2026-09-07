#!/usr/bin/env node
/**
 * Update LLM Benchmark Data from Hugging Face Model Cards
 * 
 * - Ingests MODEL_URLS environment variable (space/newline/comma separated)
 * - Automatically derives model name from URL
 * - Groups benchmarks into functional categories: Coding, Agentic & Tool Use, Reasoning & Math, Multimodal & Vision
 * - Extracts scores from HTML and Markdown tables in README.md
 * - Preserves existing scores if unparseable
 */

const fs = require('fs');
const path = require('path');

const BENCHMARK_INFO_FILE = path.join(__dirname, '..', 'data', 'benchmark_info.json');
const BENCHMARK_DATA_FILE = path.join(__dirname, '..', 'data', 'benchmark_data.json');
const CURATED_BENCHMARKS_FILE = path.join(__dirname, '..', 'data', 'curated_benchmarks.json');

// Canonical benchmark definitions with categories
const BENCHMARK_DEFINITIONS = [
  // Coding
  {
    id: 'swe_bench_verified',
    name: 'SWE-bench Verified',
    category: 'Coding',
    patterns: [/swe[-_ ]bench verified/i, /swe[-_ ]verified/i, /swebench verified/i]
  },
  {
    id: 'swe_bench_pro',
    name: 'SWE-bench Pro',
    category: 'Coding',
    patterns: [/swe[-_ ]bench pro/i, /swebench pro/i]
  },
  {
    id: 'livecodebench',
    name: 'LiveCodeBench',
    category: 'Coding',
    patterns: [/livecodebench/i, /live[-_ ]code[-_ ]bench/i, /\blcb\b/i]
  },

  // Agentic & Tool Use
  {
    id: 'terminal_bench_2_1',
    name: 'Terminal-Bench 2.1',
    category: 'Agentic & Tool Use',
    patterns: [/terminal[-_ ]bench(?:[ ]*2\.1)?/i, /terminalbench(?:[ ]*2\.1)?/i]
  },
  {
    id: 'mcp_atlas',
    name: 'MCP Atlas',
    category: 'Agentic & Tool Use',
    patterns: [/mcp[-_ ]atlas/i, /mcp atlas/i]
  },
  {
    id: 'tau_bench',
    name: 'Tau-Bench',
    category: 'Agentic & Tool Use',
    patterns: [/tau[-_ ]bench/i, /tau2\b/i, /𝛕3\\?[-_ ]banking/i, /tau[-_ ]banking/i]
  },

  // Reasoning & Math
  {
    id: 'aime_2026',
    name: 'AIME 2026',
    category: 'Reasoning & Math',
    patterns: [/aime(?:[ ]*2026)?/i, /aime 26/i]
  },
  {
    id: 'gpqa_diamond',
    name: 'GPQA Diamond',
    category: 'Reasoning & Math',
    patterns: [/gpqa diamond/i, /gpqa-diamond/i, /gpqa \(diamond\)/i]
  },
  {
    id: 'hle',
    name: "Humanity's Last Exam (HLE)",
    category: 'Reasoning & Math',
    patterns: [/humanity'?s last exam/i, /\bhle\b/i]
  },
  {
    id: 'mmlu_pro',
    name: 'MMLU-Pro',
    category: 'Reasoning & Math',
    patterns: [/mmlu[-_ ]pro/i, /mmlu pro/i]
  },

  // Multimodal & Vision
  {
    id: 'osworld_verified',
    name: 'OSWorld-Verified',
    category: 'Multimodal & Vision',
    patterns: [/osworld[-_ ]verified/i, /osworld/i]
  },
  {
    id: 'mmmu_pro',
    name: 'MMMU-Pro',
    category: 'Multimodal & Vision',
    patterns: [/mmmu[-_ ]pro/i, /mmmu pro/i]
  },
  {
    id: 'math_vision',
    name: 'MathVision',
    category: 'Multimodal & Vision',
    patterns: [/math[-_ ]vision/i, /mathvision/i]
  }
];

function parseModelUrls(input) {
  if (!input) return [];
  return input
    .split(/[\s,]+/)
    .map(s => s.trim())
    .filter(s => s.length > 0 && s.includes('huggingface.co/'));
}

function extractModelInfo(url) {
  const cleaned = url.replace(/\/$/, '');
  const parts = cleaned.split('huggingface.co/')[1].split('/');
  const repo = parts.slice(0, 2).join('/');
  const modelName = parts[1] || parts[0];
  return {
    rawUrl: url,
    repo,
    name: modelName
  };
}

async function fetchReadme(repo) {
  const urls = [
    `https://huggingface.co/${repo}/raw/main/README.md`,
    `https://huggingface.co/${repo}/raw/master/README.md`
  ];

  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Local-LLMs-Benchmark-Updater/1.0' }
      });
      if (res.ok) {
        return await res.text();
      }
    } catch (err) {
      console.warn(`Failed fetching ${url}: ${err.message}`);
    }
  }
  return null;
}

function normalizeScore(rawVal) {
  if (!rawVal) return null;
  let val = rawVal.trim().replace(/[*_`]/g, '');
  if (val === '-' || val === '--' || val === 'N/A' || val === '') return null;
  const isApprox = val.startsWith('~');
  const numMatch = val.match(/([0-9]+(?:\.[0-9]+)?)/);
  if (!numMatch) return null;
  const num = parseFloat(numMatch[1]).toFixed(1);
  return `${isApprox ? '~' : ''}${num}%`;
}

function cleanTokens(str) {
  return str.toLowerCase().replace(/[^a-z0-9]/g, ' ').split(/\s+/).filter(Boolean);
}

function matchHeaderToModel(colText, modelName) {
  const normCol = colText.toLowerCase();
  const normTarget = modelName.toLowerCase();
  if (normCol.includes(normTarget)) return true;

  const colTokens = cleanTokens(colText);
  const targetTokens = cleanTokens(modelName);
  if (targetTokens.length > 0 && targetTokens.every(t => colTokens.includes(t))) {
    return true;
  }
  return false;
}

function matchBenchmarkName(rowName) {
  return BENCHMARK_DEFINITIONS.find(def => 
    def.patterns.some(p => p.test(rowName))
  );
}

function extractScoresFromTable(content, modelName) {
  const scores = {};
  if (!content) return scores;

  // 1. Try parsing HTML tables
  const tableRegex = /<table[^>]*>([\s\S]*?)<\/table>/gi;
  let match;

  while ((match = tableRegex.exec(content)) !== null) {
    const tableHtml = match[1];
    const theadMatch = tableHtml.match(/<thead[^>]*>([\s\S]*?)<\/thead>/i) || [null, tableHtml];
    const headerRow = theadMatch[1];
    
    let targetColIndex = -1;
    const thRegex = /<th[^>]*>([\s\S]*?)<\/th>/gi;
    let thMatch;
    let colIdx = 0;
    
    while ((thMatch = thRegex.exec(headerRow)) !== null) {
      const text = thMatch[1].replace(/<[^>]+>/g, '').trim();
      if (matchHeaderToModel(text, modelName)) {
        targetColIndex = colIdx;
        break;
      }
      colIdx++;
    }

    const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let trMatch;
    
    while ((trMatch = trRegex.exec(tableHtml)) !== null) {
      const rowHtml = trMatch[1];
      const cells = [];
      const cellRegex = /<(?:td|th)[^>]*>([\s\S]*?)<\/(?:td|th)>/gi;
      let cMatch;
      while ((cMatch = cellRegex.exec(rowHtml)) !== null) {
        cells.push(cMatch[1].replace(/<[^>]+>/g, '').trim());
      }

      if (cells.length < 2) continue;

      let matchedDef = null;
      for (let c = 0; c < (targetColIndex !== -1 ? targetColIndex : cells.length); c++) {
        const testText = cells[c];
        if (!testText) continue;
        const found = matchBenchmarkName(testText);
        if (found) {
          matchedDef = found;
          break;
        }
      }

      if (matchedDef && !scores[matchedDef.id]) {
        let rawVal = null;
        if (targetColIndex !== -1 && cells[targetColIndex] !== undefined) {
          rawVal = cells[targetColIndex];
        } else if (cells.length >= 2) {
          rawVal = cells[1];
        }

        const norm = normalizeScore(rawVal);
        if (norm) {
          scores[matchedDef.id] = norm;
        }
      }
    }
  }

  // 2. Try parsing Markdown tables
  const lines = content.split('\n');
  let mdTargetCol = -1;
  let inMdTable = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('|') && line.endsWith('|')) {
      const cols = line.split('|').slice(1, -1).map(c => c.trim());
      
      const foundIdx = cols.findIndex(c => matchHeaderToModel(c, modelName));
      if (foundIdx !== -1) {
        mdTargetCol = foundIdx;
        inMdTable = true;
        continue;
      }

      if (cols.every(c => /^:?-+:?$/.test(c))) {
        continue;
      }

      if (inMdTable && cols.length > 1) {
        let matchedDef = null;
        for (let c = 0; c < (mdTargetCol !== -1 ? mdTargetCol : cols.length); c++) {
          const testText = cols[c];
          if (!testText) continue;
          const found = matchBenchmarkName(testText);
          if (found) {
            matchedDef = found;
            break;
          }
        }

        if (matchedDef && !scores[matchedDef.id]) {
          const raw = mdTargetCol !== -1 && cols[mdTargetCol] !== undefined ? cols[mdTargetCol] : cols[1];
          const norm = normalizeScore(raw);
          if (norm) {
            scores[matchedDef.id] = norm;
          }
        }
      }
    } else {
      inMdTable = false;
    }
  }

  return scores;
}

async function main() {
  console.log('--- Starting LLM Benchmark Data Updater ---');

  let currentData = { benchmarks: [], models: [] };
  if (fs.existsSync(BENCHMARK_DATA_FILE)) {
    try {
      currentData = JSON.parse(fs.readFileSync(BENCHMARK_DATA_FILE, 'utf8'));
    } catch (e) {
      console.warn('Existing data unreadable, reinitializing.');
    }
  }

  let curatedData = { models: {} };
  if (fs.existsSync(CURATED_BENCHMARKS_FILE)) {
    try {
      curatedData = JSON.parse(fs.readFileSync(CURATED_BENCHMARKS_FILE, 'utf8'));
    } catch (e) {
      console.warn('Could not read curated benchmarks:', e.message);
    }
  }

  const rawEnvUrls = process.env.MODEL_URLS;
  let urls = parseModelUrls(rawEnvUrls);

  if (urls.length === 0) {
    if (currentData.models && currentData.models.length > 0) {
      urls = currentData.models.map(m => m.url).filter(Boolean);
    }
  }

  if (urls.length === 0) {
    urls = [
      'https://huggingface.co/Qwen/Qwen3.8-27B',
      'https://huggingface.co/Qwen/Qwen3.6-35B-A3B',
      'https://huggingface.co/Qwen/Qwen3.6-27B',
      'https://huggingface.co/google/gemma-4-31B',
      'https://huggingface.co/google/gemma-4-26B-A4B',
      'https://huggingface.co/ornith-ai/Ornith-1.5-35B-A3B',
      'https://huggingface.co/meta-models/Muse-Glimmer-30B',
      'https://huggingface.co/openai/gpt-oss-20b',
      'https://huggingface.co/prism-ml/Bonsai-27B-gguf'
    ];
  }

  console.log(`Processing ${urls.length} model URL(s):`, urls);
  const updatedModels = [];

  for (const url of urls) {
    const info = extractModelInfo(url);
    console.log(`\nFetching model: ${info.name} (${info.repo})...`);

    const existingModel = (currentData.models || []).find(
      m => m.name.toLowerCase() === info.name.toLowerCase() || m.url === url
    );

    // Layer 1: Curated standardized baseline (from papers, leaderboards)
    const curatedScores = curatedData.models?.[info.name] || {};

    // Layer 2: Previous cached scores
    const cachedScores = existingModel?.scores ? { ...existingModel.scores } : {};

    // Layer 3: Live parsed from model card
    let parsedScores = {};
    const readme = await fetchReadme(info.repo);
    if (readme) {
      console.log(`  Fetched README (${readme.length} chars). Parsing tables...`);
      parsedScores = extractScoresFromTable(readme, info.name);
      console.log(`  Extracted scores:`, parsedScores);
    } else {
      console.warn(`  Could not fetch README for ${info.repo}.`);
    }

    // Merge strategy: Curated Baseline -> Cached -> Live parsed
    const scores = {
      ...curatedScores,
      ...cachedScores,
      ...parsedScores
    };

    updatedModels.push({
      id: info.name,
      name: info.name,
      repo: info.repo,
      url,
      scores
    });
  }

  const benchmarkList = BENCHMARK_DEFINITIONS.map(d => ({
    id: d.id,
    name: d.name,
    category: d.category
  }));

  const outputPayload = {
    updatedAt: new Date().toISOString(),
    benchmarks: benchmarkList,
    models: updatedModels
  };

  fs.writeFileSync(BENCHMARK_DATA_FILE, JSON.stringify(outputPayload, null, 2), 'utf8');
  console.log(`\nSuccessfully updated ${BENCHMARK_DATA_FILE} at ${outputPayload.updatedAt}`);
}

main().catch(err => {
  console.error('Fatal updater error:', err);
  process.exit(1);
});
