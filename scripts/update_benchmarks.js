#!/usr/bin/env node
/**
 * Update LLM Benchmark Data from Hugging Face Model Cards
 * 
 * Supports:
 * - MODEL_URLS environment variable (space, newline, or comma separated list of HF urls)
 * - Automatic extraction of model name from URL (e.g. https://huggingface.co/Qwen/Qwen3.8-27B -> Qwen3.8-27B)
 * - Fetching model card README from raw endpoint or HF API
 * - Parsing HTML and Markdown benchmark tables
 * - Normalizing benchmark names and scores
 * - Preserving cached fallback data if a model card is unparseable
 */

const fs = require('fs');
const path = require('path');

const BENCHMARK_INFO_FILE = path.join(__dirname, '..', 'data', 'benchmark_info.json');
const BENCHMARK_DATA_FILE = path.join(__dirname, '..', 'data', 'benchmark_data.json');

// Canonical benchmark mappings
const BENCHMARK_DEFINITIONS = [
  {
    id: 'swe_bench_verified',
    name: 'SWE-bench Verified',
    patterns: [/swe[-_ ]bench verified/i, /swe[-_ ]verified/i, /swebench verified/i]
  },
  {
    id: 'swe_bench_pro',
    name: 'SWE-bench Pro',
    patterns: [/swe[-_ ]bench pro/i, /swebench pro/i]
  },
  {
    id: 'terminal_bench_2_1',
    name: 'Terminal-Bench 2.1',
    patterns: [/terminal[-_ ]bench(?:[ ]*2\.1)?/i, /terminalbench(?:[ ]*2\.1)?/i]
  },
  {
    id: 'aime_2026',
    name: 'AIME 2026',
    patterns: [/aime(?:[ ]*2026)?/i, /aime 26/i]
  },
  {
    id: 'gpqa_diamond',
    name: 'GPQA Diamond',
    patterns: [/gpqa diamond/i, /gpqa-diamond/i, /gpqa \(diamond\)/i]
  },
  {
    id: 'hle',
    name: "Humanity's Last Exam (HLE)",
    patterns: [/humanity'?s last exam/i, /\bhle\b/i]
  },
  {
    id: 'osworld_verified',
    name: 'OSWorld-Verified',
    patterns: [/osworld[-_ ]verified/i, /osworld/i]
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
  // e.g. https://huggingface.co/Qwen/Qwen3.8-27B
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
  // keep approximation sign if present
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

  // e.g. "Gemma 4  31B" vs "gemma-4-31B"
  const colTokens = cleanTokens(colText);
  const targetTokens = cleanTokens(modelName);

  if (targetTokens.length > 0 && targetTokens.every(t => colTokens.includes(t))) {
    return true;
  }
  return false;
}

function matchBenchmarkName(rowName) {
  // Strip subtexts/parentheses/footnotes e.g. "AIME 2026 no tools", "HLE with search", "Terminal-Bench 2.1 (Terminus-2)"
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
    
    // Find header columns to detect which column belongs to modelName
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

    // Parse rows in tbody
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

      const benchmarkText = cells[0];
      const matchedDef = matchBenchmarkName(benchmarkText);

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
      
      // Header check: look for column containing model
      const foundIdx = cols.findIndex(c => matchHeaderToModel(c, modelName));
      if (foundIdx !== -1) {
        mdTargetCol = foundIdx;
        inMdTable = true;
        continue;
      }

      // Separator check
      if (cols.every(c => /^:?-+:?$/.test(c))) {
        continue;
      }

      if (inMdTable && cols.length > 1) {
        // Find benchmark column: check first columns before model column
        let matchedDef = null;
        let benchColIdx = -1;

        for (let c = 0; c < (mdTargetCol !== -1 ? mdTargetCol : cols.length); c++) {
          const testText = cols[c];
          if (!testText) continue;
          const match = matchBenchmarkName(testText);
          if (match) {
            matchedDef = match;
            benchColIdx = c;
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

  // URLs from GitHub Repository Variable or fallback to existing models
  const rawEnvUrls = process.env.MODEL_URLS;
  let urls = parseModelUrls(rawEnvUrls);

  if (urls.length === 0) {
    console.log('No MODEL_URLS found in environment, checking existing configured models...');
    if (currentData.models && currentData.models.length > 0) {
      urls = currentData.models.map(m => m.url).filter(Boolean);
    }
  }

  if (urls.length === 0) {
    // Default initial seed
    urls = [
      'https://huggingface.co/Qwen/Qwen3.8-27B',
      'https://huggingface.co/ornith-ai/Ornith-1.5-35B-A3B',
      'https://huggingface.co/Qwen/Qwen3.6-35B'
    ];
    console.log('Using default seed URLs:', urls);
  } else {
    console.log(`Processing ${urls.length} model URL(s):`, urls);
  }

  const updatedModels = [];

  for (const url of urls) {
    const info = extractModelInfo(url);
    console.log(`\nFetching model: ${info.name} (${info.repo})...`);

    const existingModel = (currentData.models || []).find(
      m => m.name.toLowerCase() === info.name.toLowerCase() || m.url === url
    );

    let scores = existingModel?.scores ? { ...existingModel.scores } : {};

    const readme = await fetchReadme(info.repo);
    if (readme) {
      console.log(`  Fetched README (${readme.length} chars). Extracting benchmark scores...`);
      const extracted = extractScoresFromTable(readme, info.name);
      console.log(`  Found parsed benchmarks:`, extracted);
      scores = { ...scores, ...extracted };
    } else {
      console.warn(`  Could not fetch README for ${info.repo}. Using cached values if present.`);
    }

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
    name: d.name
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
