# Local LLMs Benchmark Matrix

Automated daily benchmark comparison website for local frontier open-weights language models, deployed on **GitHub Pages**.

## Features

- **Aesthetic Dark Theme UI**: Matches modern benchmark presentations (Tailwind CSS, clean typography, responsive layout, JetBrains Mono scores).
- **Interactive Tooltips**: Hover over any benchmark suite to view an explanatory dialog with capability details and evaluation focus.
- **Daily Automated Sync**: GitHub Actions scheduled cron (`0 0 * * *`) fetches model cards directly from Hugging Face every 24 hours.
- **Dual-Layer Evaluation Pipeline**: Combines a rigorous, peer-reviewed evaluation baseline (`data/curated_benchmarks.json` from official papers & leaderboards) with dynamic live model card scraping to ensure 100% matrix completeness without missing scores.
- **Dynamic Workflow Phase Recommendations**: Below the main matrix, cards dynamically rank the top 3 open-weights models for each phase in a software development lifecycle (PRD/Specs, Figma UI/UX, Implementation, Specs Validation, Code Review, QA / Bug Hunting).
- **Dynamic Configuration via Repository Variables**: Add, reorder, or update local models with `MODEL_NAMES`; configure frontier references separately with `FRONTIER_MODEL_NAMES`.
- **Explicit Model Repositories**: `MODEL_NAMES` supports `name https://huggingface.co/org/repository` entries, avoiding repository inference errors.

---

## Setup & Configuration

### 1. Enable GitHub Pages

1. In your GitHub repository, navigate to **Settings** &rarr; **Pages**.
2. Under **Build and deployment** &rarr; **Source**, select **GitHub Actions**.

### 2. Configure Model Variables

Create `MODEL_NAMES` with one entry per line. Use either a bare name or explicit name + Hugging Face URL:

```text
qwen3.8-27b https://huggingface.co/Qwen/Qwen3.8-27B
qwen3.6-35b https://huggingface.co/Qwen/Qwen3.6-35B-A3B
```

Create `FRONTIER_MODEL_NAMES` separately for cloud/frontier references:

```text
claude-fable-5.1
gpt-6
gemini-3.8-flash
```

`MODEL_URLS` remains supported as a legacy fallback when `MODEL_NAMES` is empty.

### 3. Triggering Manual Updates

To force an immediate update without waiting for midnight UTC:
1. Go to the **Actions** tab.
2. Select **Daily Benchmark Update & Pages Deploy**.
3. Click **Run workflow**.

---

## Local Development

Test the scraper and preview the site locally:

```bash
# Test scraper with environment variable:
MODEL_URLS="https://huggingface.co/Qwen/Qwen3.8-27B https://huggingface.co/ornith-ai/Ornith-1.5-35B-A3B" node scripts/update_benchmarks.js

# Serve the static website locally:
npx serve .
```

Open `http://localhost:3000` to inspect the table and hover tooltips.
