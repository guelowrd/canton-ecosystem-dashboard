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

View dashboard: open `index.html` in a browser, or visit the GitHub Pages site.

## Architecture

```
index.html / app.js / style.css        -- Dashboard (static, loads snapshot.json)
scripts/fetch-data.js                   -- Fetches live data from APIs, writes snapshot
scripts/build-registry.js              -- Scrapes canton.network/ecosystem + CC Explorer
data/snapshot.json                      -- Latest dashboard data snapshot
data/canton_apps_registry.json          -- Full ecosystem app registry (83 apps)
data/canton_apps_registry.csv           -- CSV export of registry
```

## Data Sources

- [CC Explorer API](https://api.ccexplorer.io/api/overview) -- `/api/overview`, `/api/validators`, `/api/super-validators`, `/api/updates`
- [Tradecraft API](https://api.tradecraft.fi/v1/pools) -- `/v1/pools`, `/v1/volume/{A}/{B}`, `/v1/ratio/{A}/{B}`
- [Unhedged API](https://api.unhedged.gg/api/v1/markets) -- `/api/v1/markets`
- [Canton Network Ecosystem](https://www.canton.network/ecosystem) -- scraped for app registry
