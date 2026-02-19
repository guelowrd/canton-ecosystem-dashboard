# Canton Ecosystem Dashboard

Tracks publicly measurable activity across Canton Network ecosystem apps.

**Live site:** [GitHub Pages](https://guelowrd.github.io/canton-ecosystem-dashboard/)

## Apps Tracked

### Core (hand-curated, full or limited data)

| App | Type | Data | Source |
| --- | --- | --- | --- |
| Tradecraft | DEX (AMM) | Full API | TVL, volume, pool data, yields |
| Unhedged | Prediction Markets | Full API | Markets, pools, categories |
| Temple Digital Group | Exchange (CLOB) | Limited | API requires authentication |
| Cantex | DEX (AMM + Order Book) | Limited | No public API |

### Candidates (auto-detected from registry, 19+ apps)

At fetch time, `fetch-data.js` reads `cantonscan_apps_registry.json` and probes each
candidate app's website for public API endpoints. Results are classified as:

- **Transparent** — a probe path returned HTTP 200 + JSON (live data captured)
- **Opaque** — an endpoint returned HTTP 401/403 (API exists, auth required)
- **No Data** — no probe path responded

Candidate filter criteria: `confidence ≥ 70`, website present, not in `Validator/Infra`
category, not an exchange/custodian home page (Bybit, Kraken, etc.), and not already
in the core tracked set.

## Usage

Fetch latest dashboard data (includes registry probing):

```
npm run fetch
```

Build ecosystem app registry (scrapes canton.network + CC Explorer on-chain data):

```
node scripts/build-registry.js
```

Scrape CantonScan featured apps (headless browser, auto-enrichment):

```
node scripts/scrape-cantonscan.js
```

View dashboard: open `index.html` in a browser via a local server:

```
npx serve .
# or
python -m http.server
```

Then visit the GitHub Pages site for the live version.

## Dashboard Sections

| Section | Description |
| --- | --- |
| Key Findings | Auto-generated insights from live data |
| Network Health | TVL, volume, featured apps, net issuance, governance participation |
| Structural Metrics | SV consensus weight (Top 1/3/5 + HHI), validator sponsors, app rewards distribution (Top 1/3/5 + emissions share) |
| Recent Activity | Minted/burned/transferred CC, minting breakdown, top 10 apps by rewards + website links |
| Application Layer | Category overview, core app cards, candidate app cards, "why metrics are limited" note |
| Featured Apps Registry | All 82 CantonScan apps with category/confidence/website filters |
| Governance | Open proposals, participation rate, historical counts |
| Network Infrastructure | Super validators, validator sponsor breakdown |

## Architecture

```
index.html / app.js / style.css        -- Dashboard (static, loads snapshot.json + registry)
scripts/fetch-data.js                   -- Fetches live data from APIs + probes candidate apps
scripts/build-registry.js              -- Scrapes canton.network/ecosystem + CC Explorer
scripts/scrape-cantonscan.js           -- Scrapes CantonScan featured apps (Puppeteer)
data/snapshot.json                      -- Latest dashboard data snapshot
data/canton_apps_registry.json          -- canton.network ecosystem registry
data/canton_apps_registry.csv           -- CSV export
data/cantonscan_apps_registry.json      -- CantonScan featured apps registry (82 apps)
data/cantonscan_apps_registry.csv       -- CSV export
data/cantonscan_summary.json            -- Summary counts
```

## Data Sources

- [CC Explorer API](https://api.ccexplorer.io/api/overview) — `/api/overview`, `/api/validators`, `/api/super-validators`, `/api/updates`
- [Tradecraft API](https://api.tradecraft.fi/v1/pools) — `/v1/pools`, `/v1/volume/{A}/{B}`
- [Unhedged API](https://api.unhedged.gg/api/v1/markets) — `/api/v1/markets`
- [Canton Network Ecosystem](https://www.canton.network/ecosystem) — scraped for app registry
- [CantonScan Featured Apps](https://www.cantonscan.com/featured-apps) — scraped with headless browser
- Candidate app websites — probed directly at fetch time via `probeUrl()`

## Key Design Decisions

- **Registry-based probing**: instead of hard-coding app endpoints, `fetchCandidateApps()` reads
  the 82-app registry and probes each candidate in batches of 5, storing the first JSON response.
- **Structural Metrics shows 4 lines per box**: Top 1/3/5 SV bars + HHI; Top 1 app name + Top 3/5 bars + emissions share; top 3 sponsor bars + cumulative.
- **No Concentration Risk panel**: redundant with Structural Metrics; removed.
- **Top Apps always shows all 10**: no "show more" toggle needed.
- **App Websites**: matched from registry via fuzzy `baseName` lookup on on-chain party names.
