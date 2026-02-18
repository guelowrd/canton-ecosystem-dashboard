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

Fetch latest data:

```
npm run fetch
```

View dashboard: open `index.html` in a browser, or visit the GitHub Pages site.

## Architecture

```
index.html / app.js / style.css   -- Dashboard (static, loads snapshot.json)
scripts/fetch-data.js              -- Node.js fetch script (calls APIs, writes JSON)
data/snapshot.json                 -- Latest data snapshot (committed)
```

## Data Sources

- [Tradecraft API](https://api.tradecraft.fi/v1/pools) -- `/v1/pools`, `/v1/volume/{A}/{B}`, `/v1/ratio/{A}/{B}`
- [Unhedged API](https://api.unhedged.gg/api/v1/markets) -- `/api/v1/markets`
