# Canton Ecosystem Dashboard — Claude Context

## What This Is
A static GitHub Pages dashboard tracking the Canton blockchain ecosystem.
- Live at: https://gaylordwarner.github.io/canton-ecosystem-dashboard (or similar)
- Data is fetched via Node scripts and committed to `data/` — GitHub Pages deploys automatically from `main`
- No backend; everything is static files + vanilla JS

## Stack
- **Frontend**: vanilla JS (`app.js`), plain CSS (`style.css`), single `index.html`
- **Data pipeline**: Node.js scripts in `scripts/`
- **Deployment**: GitHub Pages (auto from `main`)
- **Dependency**: `puppeteer` only (for scraping CantonScan)

## Key Files
| File | Purpose |
|------|---------|
| `app.js` | All rendering logic — section renderers + helpers |
| `style.css` | All styles; CSS vars in `:root` |
| `index.html` | Shell page |
| `data/snapshot.json` | Current live data (~21KB) |
| `data/cantonscan_apps_registry.json` | Scraped app registry from CantonScan |
| `data/history/manifest.json` | Last 10 snapshot summaries (lightweight) |
| `data/history/snapshot-*.json` | Full archived snapshots (max 10) |
| `scripts/fetch-data.js` | Main scraper — ~2 min, 125 pages for 7d window |
| `scripts/scrape-cantonscan.js` | Puppeteer scrape of CantonScan registry |
| `scripts/archive-snapshot.js` | Archives snapshot + diffs + maintains manifest |
| `.github/workflows/refresh.yml` | Daily cron + manual trigger for auto-refresh |

## npm Scripts
```
npm run fetch    # node scripts/fetch-data.js  (main data fetch, ~2 min)
npm run scrape   # node scripts/scrape-cantonscan.js  (registry scrape)
npm run archive  # node scripts/archive-snapshot.js  (archive current snapshot)
```

## Dashboard Sections (render order in app.js)
1. **Overview** — Key Findings insights + Network Health + Structural Metrics + Recent Activity
2. **Applications** — Data Access by Category table + expandable full app list with filters
3. **Governance** — Open proposals, vote counts
4. **Network Infrastructure** — Validators, Super Validators, Sponsors
5. **Historical Snapshots** — Last 10 snapshots table + signal alerts (new apps / new data)

## Data Shape (snapshot.json)
```js
{
  lastUpdated,          // ISO timestamp
  cantonCoinPriceUsd,
  networkHealth: { totalTvlUsd, volume30dUsd, featuredApps, ... },
  concentration: { svTop1Pct, svTop3Pct, rewardsTop3Pct, ... },
  executiveInsights: [...strings],
  apps: [
    {
      id,               // 'ccexplorer' is the main network app
      name, url,
      appCategory,
      transparency,     // 'transparent' | 'opaque' | 'none' | 'partial'
      isCandidate,      // true = from CantonScan registry, not fully tracked
      // ccexplorer has: recentActivity, governance, network, superValidators, validators
    }
  ]
}
```

## History / Manifest Shape
```js
// data/history/manifest.json — array of up to 10 entries, newest first
[{
  file,             // 'snapshot-2026-02-20_1533.json'
  lastUpdated,
  tvlUsd,
  ccPriceUsd,
  topApp: { name, rewardsCC },
  appRewardsShareOfMinting,  // raw ratio (multiply by 100 for %)
  activeValidators,
  signals: {
    newApps: [...names],             // new since previous snapshot
    newData: [{ app, from, to }]     // transparency changed from 'none'
  }
}]
```

## Important Patterns
- `esc(str)` — HTML escape, always use for user-facing strings
- `fUsd(n)`, `fNum(n)`, `fPct(n)` — formatters; return `'--'` for null/NaN
- `normalizeAppName(raw)` — maps on-chain IDs to display names via `NAME_MAP`
- `findApp(snap, id)` — finds app by ID from `snap.apps`
- `expandable(id, label, content)` — collapsible section helper
- `metric(label, value)`, `miniBar(label, pct)` — card metric helpers
- `ccexplorer` app holds all network-wide data (network, governance, recentActivity)

## GitHub Actions
- **Workflow**: `.github/workflows/refresh.yml`
- **Schedule**: daily 00:00 UTC, plus manual `workflow_dispatch`
- **Steps**: checkout → npm ci → scrape → fetch → archive → git-auto-commit (`data/`)
- **Puppeteer on Linux**: `scrape-cantonscan.js` uses `--no-sandbox --disable-setuid-sandbox` flags — works on `ubuntu-latest` without xvfb

## Recent Work (as of 2026-02-23)
- Implemented auto-refresh cron + snapshot history
- `scripts/archive-snapshot.js` diffs against previous snapshot to detect new apps and newly-public APIs
- `renderHistory()` and `renderSignals()` added to `app.js`
- Signal blocks styled with `.signal-warn` (amber) and `.signal-ok` (green) in `style.css`
- First history entry created from current snapshot (Feb 20, 2026)

## Known Constraints
- Most Canton apps are institutional / require auth — only 2 of ~20 tracked apps expose public metrics (Tradecraft, Unhedged)
- CantonScan registry scrape uses Puppeteer; `PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=false` in CI ensures bundled Chromium is used
- `data/` is committed to git (no `.gitignore` exclusion) — this is intentional for GitHub Pages serving
