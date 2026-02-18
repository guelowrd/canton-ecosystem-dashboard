// scripts/fetch-data.js
// Fetches data from Canton ecosystem app APIs and writes data/snapshot.json

const fs = require('fs');
const path = require('path');

const TRADECRAFT_API = 'https://api.tradecraft.fi/v1';
const UNHEDGED_API = 'https://api.unhedged.gg/api/v1';

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status} ${res.statusText}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// Tradecraft (DEX/AMM) -- Full API
// ---------------------------------------------------------------------------

async function fetchTradecraft() {
  console.log('Fetching Tradecraft data...');

  const [pools, volumeCCUSDCx, volumeCCCBTC] = await Promise.all([
    fetchJSON(`${TRADECRAFT_API}/pools`),
    fetchJSON(`${TRADECRAFT_API}/volume/CC/USDCx`),
    fetchJSON(`${TRADECRAFT_API}/volume/CC/CBTC`),
  ]);

  const ccUsdcxPool = pools.pools.find(p => p.token2 === 'USDCx');
  const ccCbtcPool = pools.pools.find(p => p.token2 === 'CBTC');

  if (!ccUsdcxPool || !ccCbtcPool) {
    throw new Error('Expected CC/USDCx and CC/CBTC pools not found');
  }

  // CC price derived from AMM balance: value(CC side) = value(USDCx side)
  const ccPriceUsd = ccUsdcxPool.token2_holdings / ccUsdcxPool.token1_holdings;

  // CBTC price derived from CC/CBTC pool balance
  const cbtcPriceInCc = ccCbtcPool.token1_holdings / ccCbtcPool.token2_holdings;
  const cbtcPriceUsd = cbtcPriceInCc * ccPriceUsd;

  // TVL per pool
  const ccUsdcxTvl = ccUsdcxPool.token1_holdings * ccPriceUsd + ccUsdcxPool.token2_holdings;
  const ccCbtcTvl = ccCbtcPool.token1_holdings * ccPriceUsd + ccCbtcPool.token2_holdings * cbtcPriceUsd;

  function buildPool(pool, volumeData, name) {
    return {
      name,
      token1: pool.token1 || 'CC',
      token2: pool.token2,
      token1Holdings: pool.token1_holdings,
      token2Holdings: pool.token2_holdings,
      tvlUsd: pool === ccUsdcxPool ? ccUsdcxTvl : ccCbtcTvl,
      lpFeePercent: pool.lp_fee_percent,
      operatorFeePercent: pool.operator_fee_percent,
      yield24h: pool.yield24h,
      totalLpTokens: pool.total_lp_tokens,
      volume: {
        '1h': volumeData.volume_usd['1h'],
        '4h': volumeData.volume_usd['4h'],
        '12h': volumeData.volume_usd['12h'],
        '24h': volumeData.volume_usd['1d'],
        '7d': volumeData.volume_usd['7d'],
        '30d': volumeData.volume_usd['30d'],
      },
    };
  }

  const poolsData = [
    buildPool(ccUsdcxPool, volumeCCUSDCx, 'CC / USDCx'),
    buildPool(ccCbtcPool, volumeCCCBTC, 'CC / CBTC'),
  ];

  return {
    id: 'tradecraft',
    name: 'Tradecraft',
    url: 'https://tradecraft.fi',
    category: 'DEX (AMM)',
    dataAvailability: 'full',
    ccPriceUsd,
    cbtcPriceUsd,
    pools: poolsData,
    totalTvlUsd: ccUsdcxTvl + ccCbtcTvl,
    totalVolume24hUsd: volumeCCUSDCx.volume_usd['1d'] + volumeCCCBTC.volume_usd['1d'],
    totalVolume7dUsd: volumeCCUSDCx.volume_usd['7d'] + volumeCCCBTC.volume_usd['7d'],
    totalVolume30dUsd: volumeCCUSDCx.volume_usd['30d'] + volumeCCCBTC.volume_usd['30d'],
  };
}

// ---------------------------------------------------------------------------
// Unhedged (Prediction Markets) -- Full API
// ---------------------------------------------------------------------------

async function fetchUnhedged() {
  console.log('Fetching Unhedged data...');

  // Global counts come in every response; fetch active markets for detail
  const [globalData, activeData] = await Promise.all([
    fetchJSON(`${UNHEDGED_API}/markets?limit=1`),
    fetchJSON(`${UNHEDGED_API}/markets?status=ACTIVE&limit=100`),
  ]);

  const activeMarkets = activeData.markets;

  // Aggregate active-market stats
  const totalActivePoolUsd = activeMarkets.reduce(
    (sum, m) => sum + parseFloat(m.totalPool || '0'), 0
  );
  const totalActiveBets = activeMarkets.reduce(
    (sum, m) => sum + (m.betCount || 0), 0
  );

  // Category breakdown (active only)
  const categories = {};
  for (const m of activeMarkets) {
    const cat = m.category.toLowerCase();
    if (!categories[cat]) categories[cat] = { count: 0, poolUsd: 0, bets: 0 };
    categories[cat].count++;
    categories[cat].poolUsd += parseFloat(m.totalPool || '0');
    categories[cat].bets += m.betCount || 0;
  }

  // Top 5 active markets by pool size
  const topMarkets = [...activeMarkets]
    .sort((a, b) => parseFloat(b.totalPool || '0') - parseFloat(a.totalPool || '0'))
    .slice(0, 5)
    .map(m => ({
      question: m.question,
      category: m.category,
      totalPool: parseFloat(m.totalPool || '0'),
      betCount: m.betCount,
      endTime: m.endTime,
    }));

  return {
    id: 'unhedged',
    name: 'Unhedged',
    url: 'https://unhedged.gg',
    category: 'Prediction Markets',
    dataAvailability: 'full',
    totalMarkets: globalData.total,
    activeMarkets: globalData.activeCount,
    endedMarkets: globalData.endedCount,
    resolvedMarkets: globalData.resolvedCount,
    totalActivePoolUsd,
    totalActiveBets,
    categories,
    topMarkets,
  };
}

// ---------------------------------------------------------------------------
// Temple Digital Group -- Limited (API requires auth)
// ---------------------------------------------------------------------------

function getTempleData() {
  return {
    id: 'temple',
    name: 'Temple Digital Group',
    url: 'https://app.templedigitalgroup.com',
    category: 'Exchange (CLOB)',
    dataAvailability: 'limited',
    status: 'Live',
    description:
      'Institutional central limit order book exchange for Canton Coin trading. ' +
      'API endpoints exist (ticker, markets, orderbook) but require authentication.',
    metadata: {
      founded: 'July 2025',
      funding: '$5M (YZi Labs)',
      pairs: ['CC/USDCx'],
      features: ['CLOB trading', 'Leaderboard', 'Rewards program'],
    },
    note: 'Metrics require account access \u2014 API returns 403 for unauthenticated requests.',
  };
}

// ---------------------------------------------------------------------------
// Cantex -- Limited (no public API)
// ---------------------------------------------------------------------------

function getCantexData() {
  return {
    id: 'cantex',
    name: 'Cantex',
    url: 'https://cantex.io',
    category: 'DEX (AMM + Order Book)',
    dataAvailability: 'limited',
    status: 'Live (early)',
    description:
      'Built by CaviarNine (previously leading DeFi suite on Radix by TVL/volume). ' +
      'AMM live, order book coming soon.',
    metadata: {
      builder: 'CaviarNine',
      pairs: ['CC-USDC', 'BTC-USDC', 'ETH-USDC'],
      features: ['AMM trading', 'Order book (coming soon)'],
      observation:
        'Showing 0.00% on all pairs as of last check \u2014 very early stage or minimal activity.',
    },
    note: 'No public API found \u2014 domain redirects all API paths to homepage.',
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('Canton Ecosystem Dashboard \u2014 Data Fetch');
  console.log('========================================\n');

  const results = await Promise.allSettled([fetchTradecraft(), fetchUnhedged()]);

  const apps = [];
  const names = ['Tradecraft', 'Unhedged'];

  for (const [i, result] of results.entries()) {
    if (result.status === 'fulfilled') {
      apps.push(result.value);
      console.log(`  \u2713 ${names[i]}: OK`);
    } else {
      console.error(`  \u2717 ${names[i]}: ${result.reason.message}`);
      apps.push({
        id: names[i].toLowerCase(),
        name: names[i],
        dataAvailability: 'error',
        error: result.reason.message,
      });
    }
  }

  // Static entries
  apps.push(getTempleData());
  console.log('  \u2713 Temple Digital Group: static');
  apps.push(getCantexData());
  console.log('  \u2713 Cantex: static');

  const snapshot = {
    lastUpdated: new Date().toISOString(),
    cantonCoinPriceUsd: apps.find(a => a.id === 'tradecraft')?.ccPriceUsd || null,
    apps,
  };

  const outPath = path.join(__dirname, '..', 'data', 'snapshot.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(snapshot, null, 2));

  console.log(`\nSnapshot written to ${outPath}`);
  console.log(`Timestamp: ${snapshot.lastUpdated}`);

  if (snapshot.cantonCoinPriceUsd) {
    console.log(`CC price: $${snapshot.cantonCoinPriceUsd.toFixed(4)}`);
  }

  // Summary
  const tc = apps.find(a => a.id === 'tradecraft');
  if (tc && tc.dataAvailability === 'full') {
    console.log(
      `\nTradecraft: TVL $${tc.totalTvlUsd.toLocaleString('en-US', { maximumFractionDigits: 0 })}` +
        ` | 24h Vol $${tc.totalVolume24hUsd.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
    );
  }
  const uh = apps.find(a => a.id === 'unhedged');
  if (uh && uh.dataAvailability === 'full') {
    console.log(
      `Unhedged: ${uh.totalMarkets} markets (${uh.activeMarkets} active)` +
        ` | Active pool $${uh.totalActivePoolUsd.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
    );
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
