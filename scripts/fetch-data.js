// scripts/fetch-data.js
// Fetches data from Canton ecosystem app APIs and writes data/snapshot.json

const fs = require('fs');
const path = require('path');

const TRADECRAFT_API = 'https://api.tradecraft.fi/v1';
const UNHEDGED_API = 'https://api.unhedged.gg/api/v1';
const CCEXPLORER_API = 'https://api.ccexplorer.io/api';

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
// CC Explorer (Network Stats) -- Free API
// ---------------------------------------------------------------------------

async function fetchCCExplorer() {
  console.log('Fetching CC Explorer data...');

  const [overview, svData, validatorData, roundData, updatesData] = await Promise.allSettled([
    fetchJSON(`${CCEXPLORER_API}/overview`),
    fetchJSON(`${CCEXPLORER_API}/super-validators`),
    fetchJSON(`${CCEXPLORER_API}/validators`),
    fetchJSON(`${CCEXPLORER_API}/current-round`),
    fetchJSON(`${CCEXPLORER_API}/updates?limit=2000`),
  ]);

  // Network overview
  const ov = overview.status === 'fulfilled' ? overview.value : {};
  const round = roundData.status === 'fulfilled' ? roundData.value : {};

  const network = {
    activeValidators: ov.activeValidators || null,
    superValidators: ov.superValidators || null,
    supply: ov.supply ? parseFloat(ov.supply) : null,
    consensusHeight: ov.consensusHeight ? parseInt(ov.consensusHeight) : null,
    version: ov.version || null,
    featuredApps: ov.featuredApps || null,
    currentRound: round.currentRound || null,
  };

  // Super validators -- sorted by weight descending
  let superValidators = [];
  if (svData.status === 'fulfilled' && svData.value.svs) {
    const totalWeight = svData.value.svs.reduce((s, sv) => s + parseInt(sv[1].svRewardWeight || '0'), 0);
    superValidators = svData.value.svs
      .map(sv => ({
        name: sv[1].name,
        weight: parseInt(sv[1].svRewardWeight || '0'),
        weightPct: totalWeight > 0 ? (parseInt(sv[1].svRewardWeight || '0') / totalWeight) * 100 : 0,
        joinedRound: parseInt(sv[1].joinedAsOfRound?.number || '0'),
      }))
      .sort((a, b) => b.weight - a.weight);
  }

  // Validator distribution (sponsors, versions, operators)
  let validators = { total: 0, bySponsor: {}, byVersion: {}, topOperators: {} };
  if (validatorData.status === 'fulfilled') {
    const licenses = validatorData.value.validator_licenses || validatorData.value;
    const list = Array.isArray(licenses) ? licenses : [];
    validators.total = list.length;

    for (const v of list) {
      const p = v.payload || v;

      // Sponsor distribution
      const sponsor = (p.sponsor || '').split('::')[0] || 'Unknown';
      validators.bySponsor[sponsor] = (validators.bySponsor[sponsor] || 0) + 1;

      // Version distribution
      const ver = p.metadata?.version || 'unknown';
      validators.byVersion[ver] = (validators.byVersion[ver] || 0) + 1;

      // Operator distribution (from contactPoint)
      const contact = p.metadata?.contactPoint || '';
      if (contact) {
        // Extract org name from email domain or use as-is
        const org = contact.includes('@')
          ? contact.split('@')[1].split('.')[0]
          : contact.length < 40 ? contact : 'other';
        validators.topOperators[org] = (validators.topOperators[org] || 0) + 1;
      }
    }

    // Sort and keep top entries
    validators.bySponsor = sortObj(validators.bySponsor);
    validators.byVersion = sortObj(validators.byVersion);
    validators.topOperators = topN(sortObj(validators.topOperators), 10);
  }

  // Recent activity from updates -- aggregate minting, burning, transfers, top apps
  let recentActivity = null;
  if (updatesData.status === 'fulfilled') {
    const updates = updatesData.value.updates || updatesData.value || [];
    if (updates.length > 0) {
      const firstTime = new Date(updates[updates.length - 1].recordTime || updates[updates.length - 1].effectiveAt);
      const lastTime = new Date(updates[0].recordTime || updates[0].effectiveAt);
      const windowMs = lastTime - firstTime;

      let totalMinted = 0, appRewards = 0, valLiveness = 0, svRewards = 0;
      let totalTransferred = 0, totalBurned = 0;
      let amuletPrice = null;
      const appRewardsByParty = {};

      for (const u of updates) {
        totalMinted += parseFloat(u.totalMinted || '0');
        appRewards += parseFloat(u.appRewardsMinted || '0');
        valLiveness += parseFloat(u.validatorLivenessRewardsMinted || '0');
        svRewards += parseFloat(u.svRewardsMinted || '0');
        totalTransferred += parseFloat(u.amuletTransferred || '0');
        totalBurned += parseFloat(u.totalBurned || '0');

        // Extract per-party app rewards and amulet price
        const byParty = u.balanceChanges?.byParty || {};
        for (const [partyKey, info] of Object.entries(byParty)) {
          if (amuletPrice === null && info.amuletPrice) {
            amuletPrice = parseFloat(info.amuletPrice);
          }
          const partyAppReward = parseFloat(info.appRewardsMinted || '0');
          if (partyAppReward > 0) {
            const partyName = partyKey.split('::')[0];
            appRewardsByParty[partyName] = (appRewardsByParty[partyName] || 0) + partyAppReward;
          }
        }
      }

      // Top apps by rewards earned
      const topApps = Object.entries(appRewardsByParty)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([name, rewards]) => ({ name, rewardsCC: rewards }));

      recentActivity = {
        sampleSize: updates.length,
        timeWindowSeconds: Math.round(windowMs / 1000),
        amuletPrice,
        totalMinted,
        appRewardsMinted: appRewards,
        validatorLivenessRewardsMinted: valLiveness,
        svRewardsMinted: svRewards,
        totalTransferred,
        totalBurned,
        topApps,
      };
    }
  }

  // Governance summary
  let governance = null;
  if (ov.openVotes && ov.openVotes.length > 0) {
    governance = {
      inProgressCount: ov.openVotes.length,
      votes: ov.openVotes.map(v => {
        const p = v.payload || v;
        const reason = p.reason || {};
        const svVotes = p.votes || [];
        const yes = svVotes.filter(([, sv]) => sv.accept === true).length;
        const pending = svVotes.filter(([, sv]) => sv.accept === null).length;
        const total = svVotes.length;
        // Truncate body to first sentence or 120 chars
        let body = (reason.body || '').trim();
        if (body.length > 120) {
          const dot = body.indexOf('. ');
          body = dot > 20 && dot < 150 ? body.slice(0, dot + 1) : body.slice(0, 117) + '...';
        }
        return {
          summary: body || 'Governance vote',
          url: reason.url || null,
          requester: p.requester || null,
          yesVotes: yes,
          pendingVotes: pending,
          totalVoters: total,
        };
      }),
    };
  }

  return {
    id: 'ccexplorer',
    name: 'Canton Network',
    url: 'https://ccexplorer.io',
    category: 'Network Stats',
    dataAvailability: 'full',
    network,
    superValidators,
    validators,
    recentActivity,
    governance,
  };
}

function sortObj(obj) {
  return Object.fromEntries(Object.entries(obj).sort((a, b) => b[1] - a[1]));
}

function topN(obj, n) {
  return Object.fromEntries(Object.entries(obj).slice(0, n));
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

  const results = await Promise.allSettled([
    fetchCCExplorer(),
    fetchTradecraft(),
    fetchUnhedged(),
  ]);

  const apps = [];
  const names = ['CC Explorer', 'Tradecraft', 'Unhedged'];

  for (const [i, result] of results.entries()) {
    if (result.status === 'fulfilled') {
      apps.push(result.value);
      console.log(`  \u2713 ${names[i]}: OK`);
    } else {
      console.error(`  \u2717 ${names[i]}: ${result.reason.message}`);
      apps.push({
        id: names[i].toLowerCase().replace(/ /g, '-'),
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

  // CC price: prefer Tradecraft AMM-derived, fallback to CC Explorer amulet price
  const tc = apps.find(a => a.id === 'tradecraft');
  const ccx = apps.find(a => a.id === 'ccexplorer');
  const ccPrice = tc?.ccPriceUsd || ccx?.recentActivity?.amuletPrice || null;

  const snapshot = {
    lastUpdated: new Date().toISOString(),
    cantonCoinPriceUsd: ccPrice,
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
  if (ccx && ccx.dataAvailability === 'full') {
    const n = ccx.network;
    console.log(
      `\nNetwork: ${n.activeValidators} validators | ${n.superValidators} SVs` +
        ` | Supply ${(n.supply / 1e9).toFixed(1)}B CC | Round ${n.currentRound}`
    );
    if (ccx.recentActivity) {
      const ra = ccx.recentActivity;
      console.log(
        `Activity (${ra.sampleSize} updates, ${ra.timeWindowSeconds}s window):` +
          ` Minted ${ra.totalMinted.toFixed(0)} CC | Transferred ${ra.totalTransferred.toFixed(0)} CC` +
          ` | Top app: ${ra.topApps[0]?.name || 'n/a'}`
      );
    }
  }
  if (tc && tc.dataAvailability === 'full') {
    console.log(
      `Tradecraft: TVL $${tc.totalTvlUsd.toLocaleString('en-US', { maximumFractionDigits: 0 })}` +
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
