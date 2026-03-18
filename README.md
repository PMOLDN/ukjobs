# UK Job Market Visualizer

This project looks at the current ONS Annual population survey and combines it with the Nomis data on area/wages and employment this data is then monitored by an LLM based on descriptions of each role to generate the purposed impact AI will have on that role.

You can access a demo here ----> https://shaune.neocities.org/

## Overview

A fork of [karpathy/jobs](https://github.com/karpathy/jobs), retargeted from US Bureau of Labor Statistics data to UK occupation data from the **Office for National Statistics**. The current build uses the ONS Annual Population Survey workbook to generate an interactive treemap of **412 SOC 2020 unit-group occupations**.

## What works now

| Feature | Details |
|---------|---------|
| **Treemap size** | 2024 reported employment by 4-digit SOC occupation |
| **Recent Trend** | Colour layer showing 2021 to 2024 employment change |
| **Median Pay** | Colour layer using 2024 ASHE Table 14 annual gross median pay |
| **Regional Employment** | Region selector using Nomis APS regional occupation data, mapped from 3-digit SOC parents onto 4-digit tiles |
| **Industry Concentration** | Colour layer from each occupation's largest 1-digit industry share |
| **AI Exposure** | Colour layer scored by LLM (OpenRouter or local Ollama) |
| **Grouping** | SOC major groups (Managers, Professional, Skilled Trades, Elementary, etc.) |
| **Search** | Live filter bar to find occupations by title, SOC code, or industry |
| **Occupation pages** | `pages/*.md` generated from the official ONS SOC 2020 descriptions workbook |

## Current limits

- The ONS workbook suppresses small cells with `*`, so occupation totals are **lower-bound sums** of reported industry values.
- The regional layer currently uses **3-digit SOC parent groups** from Nomis and maps them onto the 4-digit treemap tiles. It does not yet use true 4-digit regional occupation counts.
- Education/skill level and vacancy-demand layers are still **not wired yet**.

## Data pipeline

1. **`make_csv.py`** - Parses the ONS workbook and writes `occupations.csv` plus a richer `occupations.json`.
   It also merges local ASHE Table 14 pay and the local Nomis regional occupation export when those files are present under `Data/Raw/`.
2. **`process.py`** - Turns the ONS SOC 2020 description workbook into `pages/*.md`.
3. **`score.py`** - Scores those markdown pages with either OpenRouter or local Ollama (optional).
4. **`build_site_data.py`** - Reshapes all occupation data into `site/data.json` for the frontend.
5. **`site/index.html`** - Renders the interactive UK treemap.

## Quick start if you want to run local

```bash
uv sync
python make_csv.py
python process.py
python build_site_data.py

cd site
python -m http.server 8000
```

Then open `http://localhost:8000`.


```bash

# Ollama (local)
python score.py --provider ollama --model llama3.2:3b

# Rebuild the frontend payload after scoring
python build_site_data.py
```

**Notes:**

- Local Ollama defaults to `http://localhost:11434/v1`.
- `process.py` expects the official ONS description workbook at `soc2020_unit_groups.xlsx`. If it is missing, it prints the official ONS download URL.

## Key files

| File | Purpose |
|------|---------|
| `employmentby4digitsoc1digitindustryatosuk20212024final.xlsx` | Primary UK source workbook (ONS APS) |
| `Data/Raw/pay/ashetable142024provisional/PROV - Occupation SOC20 (4) Table 14.7a   Annual pay - Gross 2024.xlsx` | ASHE 2024 median pay source |
| `Data/Raw/regional/731911681617723.csv` | Nomis APS regional occupation export |
| `soc2020_unit_groups.xlsx` | ONS SOC 2020 unit-group descriptions |
| `uk_job_data.py` | Workbook parser and UK occupation normalisation |
| `make_csv.py` | Step 1: parse workbook to CSV/JSON |
| `process.py` | Step 2: generate occupation markdown pages |
| `score.py` | Step 3: LLM-score AI exposure |
| `build_site_data.py` | Step 4: build frontend payload |
| `occupations.csv` | Flattened occupation summary |
| `occupations.json` | Richer occupation records with industry breakdowns and regional mappings |
| `scores.json` | AI exposure scores and rationales |
| `pages/` | 412 markdown occupation descriptions |
| `site/index.html` | Frontend treemap UI |
| `site/styles.css` | Stylesheet |
| `site/treemap.js` | Squarify layout and canvas rendering |
| `site/ui.js` | Stats, search, tooltips, and state management |
| `site/data.json` | Frontend payload |
| `.env.example` | Environment variable template |

## Legacy files

The original US BLS scraping and parsing scripts have been moved to `legacy/` and are not part of the UK pipeline:

- `legacy/scrape.py` - Playwright-based BLS page scraper
- `legacy/parse_detail.py` - BLS HTML parser
- `legacy/parse_occupations.py` - BLS occupation extractor
- `legacy/make_prompt.py` - US prompt generation
- `legacy/html/` - Raw BLS HTML pages
- `legacy/occupational_outlook_handbook.html` - BLS handbook page
- `legacy/prompt.md` - Original scoring prompt
