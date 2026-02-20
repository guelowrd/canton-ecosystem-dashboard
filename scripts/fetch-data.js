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
// Entity context -- short descriptions for known participants
// ---------------------------------------------------------------------------

const ENTITY_INFO = {
  'Global-Synchronizer-Foundation': { desc: 'Foundation governing the Canton Global Synchronizer', url: 'https://sync.global' },
  'Digital-Asset-1': { desc: 'Digital Asset \u2014 creators of Canton and Daml', url: 'https://digitalasset.com' },
  'Digital-Asset-2': { desc: 'Digital Asset \u2014 creators of Canton and Daml', url: 'https://digitalasset.com' },
  'Cumberland-1': { desc: 'Cumberland (DRW subsidiary) \u2014 crypto market maker', url: 'https://cumberland.io' },
  'Cumberland-2': { desc: 'Cumberland (DRW subsidiary) \u2014 crypto market maker', url: 'https://cumberland.io' },
  'MPC-Holding-Inc': { desc: 'MPC Holdings' },
  'Five-North-1': { desc: 'Five North Capital' },
  'C7-Technology-Services-Limited': { desc: 'C7 Technology Services' },
  'Liberty-City-Ventures-1': { desc: 'Liberty City Ventures \u2014 crypto venture fund', url: 'https://lcv.co' },
  'Orb-1-LP-1': { desc: 'Orb-1 LP' },
  'Proof-Group-1': { desc: 'Proof Group \u2014 blockchain infrastructure', url: 'https://proofgroup.com' },
  'SV-Nodeops-Limited': { desc: 'SV Nodeops \u2014 validator infrastructure' },
  'Tradeweb-Markets-1': { desc: 'Tradeweb Markets \u2014 fixed-income trading platform', url: 'https://tradeweb.com' },
};

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

  const ccPriceUsd = ccUsdcxPool.token2_holdings / ccUsdcxPool.token1_holdings;
  const cbtcPriceInCc = ccCbtcPool.token1_holdings / ccCbtcPool.token2_holdings;
  const cbtcPriceUsd = cbtcPriceInCc * ccPriceUsd;

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

  const totalTvl = ccUsdcxTvl + ccCbtcTvl;

  return {
    id: 'tradecraft',
    name: 'Tradecraft',
    url: 'https://tradecraft.fi',
    appCategory: 'AMM',
    transparency: 'transparent',
    dataAvailability: 'full',
    ccPriceUsd,
    cbtcPriceUsd,
    pools: poolsData,
    totalTvlUsd: totalTvl,
    largestPoolPct: totalTvl > 0 ? (Math.max(ccUsdcxTvl, ccCbtcTvl) / totalTvl) * 100 : 0,
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

  const [globalData, activeData] = await Promise.all([
    fetchJSON(`${UNHEDGED_API}/markets?limit=1`),
    fetchJSON(`${UNHEDGED_API}/markets?status=ACTIVE&limit=100`),
  ]);

  const activeMarkets = activeData.markets;

  const totalActivePoolUsd = activeMarkets.reduce(
    (sum, m) => sum + parseFloat(m.totalPool || '0'), 0
  );
  const totalActiveBets = activeMarkets.reduce(
    (sum, m) => sum + (m.betCount || 0), 0
  );

  const categories = {};
  for (const m of activeMarkets) {
    const cat = m.category.toLowerCase();
    if (!categories[cat]) categories[cat] = { count: 0, poolUsd: 0, bets: 0 };
    categories[cat].count++;
    categories[cat].poolUsd += parseFloat(m.totalPool || '0');
    categories[cat].bets += m.betCount || 0;
  }

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
    appCategory: 'Prediction Markets',
    transparency: 'transparent',
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
// CC Explorer -- 24h activity via paginated parallel fetch
// ---------------------------------------------------------------------------

async function fetchRecentActivity24h() {
  const PAGE_SIZE = 50000;
  const WINDOW_HOURS = 7 * 24;
  const cutoff = Date.now() - WINDOW_HOURS * 3600 * 1000;

  // Page 0: calibrate record rate to estimate pages needed for the window
  const firstData = await fetchJSON(`${CCEXPLORER_API}/updates?limit=${PAGE_SIZE}&offset=0`);
  const firstUpdates = firstData.updates || firstData;
  if (!firstUpdates || firstUpdates.length === 0) return null;

  const newestMs = new Date(firstUpdates[0].recordTime || firstUpdates[0].effectiveAt).getTime();
  const oldestMs = new Date(firstUpdates[firstUpdates.length - 1].recordTime || firstUpdates[firstUpdates.length - 1].effectiveAt).getTime();
  const spanMs = newestMs - oldestMs;
  const recordsPerMs = PAGE_SIZE / Math.max(spanMs, 1);
  const numExtraPages = Math.min(Math.ceil(recordsPerMs * WINDOW_HOURS * 3600 * 1000 / PAGE_SIZE), 175);

  console.log(`  ${WINDOW_HOURS / 24}d activity: fetching ${numExtraPages + 1} pages × ${PAGE_SIZE.toLocaleString()} records...`);

  // Running totals (no arrays stored across pages)
  let totalMinted = 0, appRewards = 0, valLiveness = 0, svRewards = 0;
  let totalTransferred = 0, totalBurned = 0;
  let amuletPrice = null;
  const appRewardsByParty = {};
  let sampleSize = 0;

  function processPage(updates) {
    for (const u of updates) {
      const t = new Date(u.recordTime || u.effectiveAt).getTime();
      if (t < cutoff) continue;
      sampleSize++;
      totalMinted += parseFloat(u.totalMinted || '0');
      appRewards += parseFloat(u.appRewardsMinted || '0');
      valLiveness += parseFloat(u.validatorLivenessRewardsMinted || '0');
      svRewards += parseFloat(u.svRewardsMinted || '0');
      totalTransferred += parseFloat(u.amuletTransferred || '0');
      totalBurned += Math.abs(parseFloat(u.totalBurned || '0'));
      const byParty = u.balanceChanges?.byParty || {};
      for (const [partyKey, info] of Object.entries(byParty)) {
        if (amuletPrice === null && info.amuletPrice) amuletPrice = parseFloat(info.amuletPrice);
        const reward = parseFloat(info.appRewardsMinted || '0');
        if (reward > 0) {
          const name = partyKey.split('::')[0];
          appRewardsByParty[name] = (appRewardsByParty[name] || 0) + reward;
        }
      }
    }
  }

  processPage(firstUpdates);

  // Remaining pages in parallel batches of 5
  const extraOffsets = Array.from({ length: numExtraPages }, (_, i) => (i + 1) * PAGE_SIZE);
  for (let i = 0; i < extraOffsets.length; i += 5) {
    const batch = extraOffsets.slice(i, i + 5);
    const results = await Promise.allSettled(
      batch.map(offset => fetchJSON(`${CCEXPLORER_API}/updates?limit=${PAGE_SIZE}&offset=${offset}`))
    );
    for (const r of results) {
      if (r.status === 'fulfilled') processPage(r.value.updates || r.value);
    }
  }

  const topApps = Object.entries(appRewardsByParty)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, rewards]) => ({ name, rewardsCC: rewards }));

  const totalAppRewards = Object.values(appRewardsByParty).reduce((s, v) => s + v, 0);
  const top3Rewards = topApps.slice(0, 3).reduce((s, a) => s + a.rewardsCC, 0);
  const top5Rewards = topApps.slice(0, 5).reduce((s, a) => s + a.rewardsCC, 0);
  const rewardsTop1Pct = totalAppRewards > 0 && topApps.length > 0
    ? (topApps[0].rewardsCC / totalAppRewards) * 100 : null;
  const top1AppName = topApps.length > 0 ? topApps[0].name : null;

  return {
    sampleSize,
    timeWindowHours: WINDOW_HOURS,
    amuletPrice,
    totalMinted,
    appRewardsMinted: appRewards,
    validatorLivenessRewardsMinted: valLiveness,
    svRewardsMinted: svRewards,
    totalTransferred,
    totalBurned,
    netIssuance: totalMinted - totalBurned,
    topApps,
    rewardsTop1Pct,
    top1AppName,
    rewardsTop3Pct: totalAppRewards > 0 ? (top3Rewards / totalAppRewards) * 100 : 0,
    rewardsTop5Pct: totalAppRewards > 0 ? (top5Rewards / totalAppRewards) * 100 : 0,
    appRewardsShareOfMinting: totalMinted > 0 ? (appRewards / totalMinted) * 100 : 0,
  };
}

// ---------------------------------------------------------------------------
// CC Explorer (Network Stats) -- Free API
// ---------------------------------------------------------------------------

async function fetchCCExplorer() {
  console.log('Fetching CC Explorer data...');

  const [overview, svData, validatorData, roundData, govFullData] =
    await Promise.allSettled([
      fetchJSON(`${CCEXPLORER_API}/overview`),
      fetchJSON(`${CCEXPLORER_API}/super-validators`),
      fetchJSON(`${CCEXPLORER_API}/validators`),
      fetchJSON(`${CCEXPLORER_API}/current-round`),
      fetchJSON(`${CCEXPLORER_API}/governance`),
    ]);

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

  // Super validators
  let superValidators = [];
  if (svData.status === 'fulfilled' && svData.value.svs) {
    const totalWeight = svData.value.svs.reduce((s, sv) => s + parseInt(sv[1].svRewardWeight || '0'), 0);
    superValidators = svData.value.svs
      .map(sv => {
        const name = sv[1].name;
        const weight = parseInt(sv[1].svRewardWeight || '0');
        const info = ENTITY_INFO[name];
        return {
          name,
          weight,
          weightPct: totalWeight > 0 ? (weight / totalWeight) * 100 : 0,
          joinedRound: parseInt(sv[1].joinedAsOfRound?.number || '0'),
          desc: info?.desc || null,
          url: info?.url || null,
        };
      })
      .sort((a, b) => b.weight - a.weight);
  }

  // Validator distribution
  let validators = { total: 0, bySponsor: {}, byVersion: {}, topOperators: {} };
  if (validatorData.status === 'fulfilled') {
    const licenses = validatorData.value.validator_licenses || validatorData.value;
    const list = Array.isArray(licenses) ? licenses : [];
    validators.total = list.length;

    for (const v of list) {
      const p = v.payload || v;
      const sponsor = (p.sponsor || '').split('::')[0] || 'Unknown';
      validators.bySponsor[sponsor] = (validators.bySponsor[sponsor] || 0) + 1;
      const ver = p.metadata?.version || 'unknown';
      validators.byVersion[ver] = (validators.byVersion[ver] || 0) + 1;
      const contact = p.metadata?.contactPoint || '';
      if (contact) {
        const org = contact.includes('@')
          ? contact.split('@')[1].split('.')[0]
          : contact.length < 40 ? contact : 'other';
        validators.topOperators[org] = (validators.topOperators[org] || 0) + 1;
      }
    }

    validators.bySponsor = sortObj(validators.bySponsor);
    validators.byVersion = sortObj(validators.byVersion);
    validators.topOperators = topN(sortObj(validators.topOperators), 10);
  }

  // Recent activity -- 24h window via paginated fetch
  const recentActivity = await fetchRecentActivity24h();

  // Governance -- current + historical
  let governance = null;
  const openVotes = ov.openVotes || [];
  const govFull = govFullData.status === 'fulfilled' ? govFullData.value : null;

  const parsedVotes = openVotes.map(v => {
    const p = v.payload || v;
    const reason = p.reason || {};
    const svVotes = p.votes || [];
    const yes = svVotes.filter(([, sv]) => sv.accept === true).length;
    const no = svVotes.filter(([, sv]) => sv.accept === false).length;
    const pending = svVotes.filter(([, sv]) => sv.accept === null).length;
    const total = svVotes.length;
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
      noVotes: no,
      pendingVotes: pending,
      totalVoters: total,
    };
  });

  // Participation rate: across open votes, avg fraction of SVs that voted
  const avgParticipation = parsedVotes.length > 0
    ? parsedVotes.reduce((sum, v) => {
        const voted = v.yesVotes + v.noVotes;
        return sum + (v.totalVoters > 0 ? voted / v.totalVoters : 0);
      }, 0) / parsedVotes.length
    : null;

  // Historical stats from /api/governance
  let totalHistorical = null;
  let closedCount = null;
  if (govFull) {
    const closed = govFull.closed || [];
    const inProg = govFull.in_progress || [];
    closedCount = closed.length;
    totalHistorical = closed.length + inProg.length;
  }

  governance = {
    openProposals: openVotes.length,
    participationRate: avgParticipation,
    totalHistorical,
    closedCount,
    votes: parsedVotes,
  };

  return {
    id: 'ccexplorer',
    name: 'Canton Network',
    url: 'https://ccexplorer.io',
    appCategory: 'Infrastructure',
    transparency: 'transparent',
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
// Candidate app probing
// ---------------------------------------------------------------------------

async function probeUrl(url, timeoutMs = 4000) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'Canton-Dashboard/1.0' } });
    clearTimeout(t);
    const ct = res.headers.get('content-type') || '';
    const isJson = ct.includes('application/json') || ct.includes('json');
    let data = null;
    if (res.ok && isJson) {
      try {
        const json = await res.json();
        if (typeof json === 'object' && json !== null) {
          const keys = Object.keys(json).slice(0, 10);
          data = {};
          for (const k of keys) data[k] = json[k];
        }
      } catch { /* ignore */ }
    }
    return { status: res.status, isJson, ok: res.ok, data };
  } catch { return { status: 0, ok: false, isJson: false, data: null }; }
}

async function fetchCandidateApps(alreadyTracked) {
  const registryPath = path.join(__dirname, '..', 'data', 'cantonscan_apps_registry.json');
  let registry;
  try {
    registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  } catch (e) {
    console.error('  Could not read registry:', e.message);
    return [];
  }

  const EXCLUDED_DOMAINS = ['bybit.com', 'kraken.com', 'mexc.com', 'kucoin.com', 'binance.us', 'bitgo.com'];
  const PROBE_PATHS = ['/api/v1', '/api/v1/stats', '/api', '/v1', '/v1/stats', '/openapi.json'];

  const candidates = registry.filter(r => {
    if (r.confidence < 70) return false;
    if (!r.websiteGuess) return false;
    if (r.category === 'Validator/Infra') return false;
    if (alreadyTracked.includes(r.baseName.toLowerCase())) return false;
    if (EXCLUDED_DOMAINS.some(d => r.websiteGuess.includes(d))) return false;
    return true;
  });

  console.log(`  Probing ${candidates.length} candidate apps...`);

  const results = [];
  for (let i = 0; i < candidates.length; i += 5) {
    const batch = candidates.slice(i, i + 5);
    const batchResults = await Promise.allSettled(batch.map(async (r) => {
      // Skip dead domains: probe homepage first
      const homepage = await probeUrl(r.websiteGuess, 5000);
      if (homepage.status === 0) return null; // unreachable — skip entirely

      let transparency = 'none';
      let probeEndpoint = null;
      let probeData = null;

      for (const probePath of PROBE_PATHS) {
        const url = r.websiteGuess.replace(/\/$/, '') + probePath;
        const probe = await probeUrl(url);
        if (probe.ok && probe.isJson) {
          transparency = 'transparent';
          probeEndpoint = url;
          probeData = probe.data;
          break;
        } else if (probe.status === 401 || probe.status === 403) {
          transparency = 'opaque';
          break;
        }
      }

      return {
        id: r.baseName,
        name: r.appName,
        url: r.websiteGuess,
        appCategory: r.category,
        transparency,
        dataAvailability: transparency === 'transparent' ? 'full' : 'limited',
        probeEndpoint,
        probeData,
        note: r.note || null,
        isCandidate: true,
      };
    }));
    for (const res of batchResults) {
      if (res.status === 'fulfilled' && res.value !== null) results.push(res.value);
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Temple Digital Group -- Limited (API requires auth)
// ---------------------------------------------------------------------------

function getTempleData() {
  return {
    id: 'temple',
    name: 'Temple Digital Group',
    url: 'https://app.templedigitalgroup.com',
    appCategory: 'CLOB',
    transparency: 'opaque',
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
    appCategory: 'AMM',
    transparency: 'opaque',
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
// Derived metrics -- computed from all app data
// ---------------------------------------------------------------------------

function computeDerivedMetrics(apps) {
  const ccx = apps.find(a => a.id === 'ccexplorer');
  const tc = apps.find(a => a.id === 'tradecraft');
  const uh = apps.find(a => a.id === 'unhedged');
  const ra = ccx?.recentActivity;

  // --- Network Health ---
  const totalTvlUsd = (tc?.totalTvlUsd || 0) + (uh?.totalActivePoolUsd || 0);
  const volume30dUsd = tc?.totalVolume30dUsd || null;
  const featuredApps = ccx?.network?.featuredApps || null;
  const trackedApps = apps.filter(a => a.id !== 'ccexplorer').length;
  const transparentApps = apps.filter(a => a.transparency === 'transparent' && a.id !== 'ccexplorer').length;
  const netIssuance = ra ? ra.netIssuance : null;
  const govParticipation = ccx?.governance?.participationRate || null;

  const networkHealth = {
    totalTvlUsd,
    volume30dUsd,
    featuredApps,
    trackedApps,
    transparentApps,
    netIssuance,
    governanceParticipation: govParticipation,
  };

  // --- Concentration ---
  const svs = ccx?.superValidators || [];
  const svTop1Pct = svs[0]?.weightPct || null;
  const svTop3Pct = svs.slice(0, 3).reduce((s, sv) => s + sv.weightPct, 0) || null;
  const svTop5Pct = svs.slice(0, 5).reduce((s, sv) => s + sv.weightPct, 0) || null;
  // HHI: sum of squared market shares (0-10000 scale)
  const svHhi = svs.length > 0
    ? svs.reduce((s, sv) => s + Math.pow(sv.weightPct, 2), 0)
    : null;

  const vals = ccx?.validators || {};
  const sponsorEntries = Object.entries(vals.bySponsor || {});
  const sponsorTop1Pct = vals.total > 0 && sponsorEntries[0]
    ? (sponsorEntries[0][1] / vals.total) * 100 : null;
  const sponsorTop3Pct = vals.total > 0
    ? (sponsorEntries.slice(0, 3).reduce((s, [, c]) => s + c, 0) / vals.total) * 100
    : null;
  const sponsorTop3 = sponsorEntries.slice(0, 3).map(([name, count]) => ({
    name,
    count,
    pct: vals.total > 0 ? (count / vals.total) * 100 : 0,
    desc: ENTITY_INFO[name]?.desc || null,
    url: ENTITY_INFO[name]?.url || null,
  }));

  const tvlLargestPoolPct = tc?.largestPoolPct || null;

  const concentration = {
    svTop1Pct,
    svTop3Pct,
    svTop5Pct,
    svHhi,
    sponsorTop1Pct,
    sponsorTop3Pct,
    sponsorTop3,
    tvlLargestPoolPct,
    rewardsTop3Pct: ra?.rewardsTop3Pct ?? null,
    rewardsTop5Pct: ra?.rewardsTop5Pct ?? null,
  };

  // --- Executive Insights ---
  const insights = [];

  if (svTop1Pct != null) {
    insights.push(`Largest super validator controls ${svTop1Pct.toFixed(1)}% of consensus weight`);
  }
  if (sponsorTop1Pct != null && sponsorEntries[0]) {
    insights.push(`Top sponsor (${sponsorEntries[0][0].replace(/-/g, ' ')}) holds ${sponsorTop1Pct.toFixed(1)}% of validator licenses`);
  }
  if (ra?.appRewardsShareOfMinting != null) {
    insights.push(`${ra.appRewardsShareOfMinting.toFixed(0)}% of CC emissions go to application rewards`);
  }
  if (tvlLargestPoolPct != null) {
    insights.push(`${tvlLargestPoolPct.toFixed(0)}% of DEX TVL is in the largest pool (CC/USDCx)`);
  }
  if (transparentApps != null && trackedApps > 0) {
    insights.push(`${transparentApps} of ${trackedApps} tracked apps expose public metrics`);
  }
  if (ra?.rewardsTop3Pct != null && ra.topApps[0]) {
    insights.push(`Top 3 apps capture ${ra.rewardsTop3Pct.toFixed(0)}% of app rewards (led by ${ra.topApps[0].name})`);
  }

  return { networkHealth, concentration, executiveInsights: insights.slice(0, 6) };
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

  apps.push(getTempleData());
  console.log('  \u2713 Temple Digital Group: static');
  apps.push(getCantexData());
  console.log('  \u2713 Cantex: static');

  const alreadyTracked = ['tradecraft', 'unhedged', 'temple', 'cantex', 'ccexplorer'];
  const candidates = await fetchCandidateApps(alreadyTracked);
  apps.push(...candidates);
  console.log(`  + ${candidates.length} candidate apps probed`);

  const tc = apps.find(a => a.id === 'tradecraft');
  const ccx = apps.find(a => a.id === 'ccexplorer');
  const ccPrice = tc?.ccPriceUsd || ccx?.recentActivity?.amuletPrice || null;

  const derived = computeDerivedMetrics(apps);

  const snapshot = {
    lastUpdated: new Date().toISOString(),
    cantonCoinPriceUsd: ccPrice,
    networkHealth: derived.networkHealth,
    concentration: derived.concentration,
    executiveInsights: derived.executiveInsights,
    apps,
  };

  const outPath = path.join(__dirname, '..', 'data', 'snapshot.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(snapshot, null, 2));

  console.log(`\nSnapshot written to ${outPath}`);
  console.log(`Timestamp: ${snapshot.lastUpdated}`);
  if (ccPrice) console.log(`CC price: $${ccPrice.toFixed(4)}`);

  // Summary
  if (ccx && ccx.dataAvailability === 'full') {
    const n = ccx.network;
    console.log(
      `\nNetwork: ${n.activeValidators} validators | ${n.superValidators} SVs` +
        ` | Supply ${(n.supply / 1e9).toFixed(1)}B CC | Round ${n.currentRound}`
    );
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

  console.log('\nInsights:');
  for (const ins of derived.executiveInsights) {
    console.log(`  - ${ins}`);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
