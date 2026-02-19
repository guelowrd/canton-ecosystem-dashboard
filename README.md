# Canton Ecosystem Dashboard

Tracks publicly measurable activity across Canton Network ecosystem apps.

**Live site:** [GitHub Pages](https://guelowrd.github.io/canton-ecosystem-dashboard/)

## Apps Tracked

| App | Type | Data | Source |
| --- | --- | --- | --- |
| Tradecraft | DEX (AMM) | Full API | TVL, volume, pool data, yields |
| Unhedged | Prediction Markets | Full API | Markets, pools, categories |
| Temple Digital Group | Exchange (CLOB) | Limited | API requires authentication |
| Cantex | DEX (AMM + Order Book) | Limited | No public API |

## Usage

Fetch latest dashboard data:

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

View dashboard: open `index.html` in a browser, or visit the GitHub Pages site.

## Architecture

```
index.html / app.js / style.css        -- Dashboard (static, loads snapshot.json + registry)
scripts/fetch-data.js                   -- Fetches live data from APIs, writes snapshot
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

- [CC Explorer API](https://api.ccexplorer.io/api/overview) -- `/api/overview`, `/api/validators`, `/api/super-validators`, `/api/updates`
- [Tradecraft API](https://api.tradecraft.fi/v1/pools) -- `/v1/pools`, `/v1/volume/{A}/{B}`, `/v1/ratio/{A}/{B}`
- [Unhedged API](https://api.unhedged.gg/api/v1/markets) -- `/api/v1/markets`
- [Canton Network Ecosystem](https://www.canton.network/ecosystem) -- scraped for app registry
- [CantonScan Featured Apps](https://www.cantonscan.com/featured-apps) -- scraped with headless browser
