# Local LLMs Benchmark Matrix

Automated daily benchmark comparison website for local frontier open-weights language models, deployed on **GitHub Pages**.

## Features

- **Aesthetic Dark Theme UI**: Matches modern benchmark presentations (Tailwind CSS, clean typography, responsive layout, JetBrains Mono scores).
- **Interactive Tooltips**: Hover over any benchmark suite to view an explanatory dialog with capability details and evaluation focus.
- **Daily Automated Sync**: GitHub Actions scheduled cron (`0 0 * * *`) fetches model cards directly from Hugging Face every 24 hours.
- **Dynamic Workflow Phase Recommendations**: Below the main matrix, cards dynamically rank the top 3 open-weights models for each phase in a software development lifecycle (PRD/Specs, Figma UI/UX, Implementation, Specs Validation, Code Review, QA / Bug Hunting).
- **Dynamic Configuration via Repository Variable**: Add, reorder, or update models anytime using GitHub Repository Variable `MODEL_URLS` without code changes.
- **Auto Model Name Extraction**: Model names like `Qwen3.8-27B` are automatically parsed from URLs like `https://huggingface.co/Qwen/Qwen3.8-27B`.

---

## Setup & Configuration

### 1. Enable GitHub Pages

1. In your GitHub repository, navigate to **Settings** &rarr; **Pages**.
2. Under **Build and deployment** &rarr; **Source**, select **GitHub Actions**.

### 2. Configure the Model URLs Variable

1. Go to **Settings** &rarr; **Secrets and variables** &rarr; **Actions** &rarr; **Variables** tab.
2. Click **New repository variable**.
3. Set the Name to:
   ```text
   MODEL_URLS
   ```
4. Set the Value to your desired list of Hugging Face URLs (separated by newlines, spaces, or commas):
   ```text
   https://huggingface.co/Qwen/Qwen3.8-27B
   https://huggingface.co/ornith-ai/Ornith-1.5-35B-A3B
   https://huggingface.co/Qwen/Qwen3.6-35B
   ```
5. Click **Add variable**.

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
