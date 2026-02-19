// scripts/build-registry.js
// Builds a canton app registry from canton.network/ecosystem + CC Explorer on-chain data
// Outputs: data/canton_apps_registry.json and data/canton_apps_registry.csv

const fs = require('fs');
const path = require('path');

const CCEXPLORER_API = 'https://api.ccexplorer.io/api';
const CANTON_ECOSYSTEM_URL = 'https://www.canton.network/ecosystem';

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json();
}

async function fetchHTML(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.text();
}

// ---------------------------------------------------------------------------
// Step 1: Scrape canton.network/ecosystem
// ---------------------------------------------------------------------------

async function scrapeEcosystem() {
  console.log('Scraping canton.network/ecosystem...');
  const html = await fetchHTML(CANTON_ECOSYSTEM_URL);

  const entries = [];
  // Pattern: <a href="/ecosystem/{slug}" class="{solution_tags}  {role_tags}">
  //   <h4>{name}</h4>
  //   <p class="description">{description}</p>
  const cardPattern = /<a\s+href="(\/ecosystem\/[^"]+)"\s+class="content-box\s+([^"]*)"[^>]*>([\s\S]*?)<\/a>/g;
  let match;

  while ((match = cardPattern.exec(html)) !== null) {
    const url = 'https://www.canton.network' + match[1];
    const cssClasses = match[2].trim();
    const inner = match[3];

    // Extract name from <h4>
    const nameMatch = inner.match(/<h4[^>]*>(.*?)<\/h4>/);
    const name = nameMatch ? nameMatch[1].replace(/<[^>]+>/g, '').trim() : '';

    // Extract description from <p class="description">
    const descMatch = inner.match(/<p\s+class="description"[^>]*>(.*?)<\/p>/s);
    let desc = descMatch ? descMatch[1].replace(/<[^>]+>/g, '').trim() : '';

    // Parse tags from CSS classes (solution tags + double space + role tags)
    const parts = cssClasses.split(/\s{2,}/);
    const solutionStr = parts[0] || '';
    const roleStr = parts[1] || '';
    const solutionTags = solutionStr.split(/\s+/).filter(Boolean);
    const roleTags = roleStr.split(/\s+/).filter(Boolean);

    if (name) {
      entries.push({ name, url, description: desc, solutionTags, roleTags });
    }
  }

  console.log(`  Scraped ${entries.length} ecosystem entries`);
  return entries;
}

// ---------------------------------------------------------------------------
// Step 2: Get on-chain active apps from CC Explorer
// ---------------------------------------------------------------------------

async function getOnChainApps() {
  console.log('Fetching on-chain activity from CC Explorer...');
  const data = await fetchJSON(`${CCEXPLORER_API}/updates?limit=2000`);
  const updates = data.updates || data || [];

  const parties = {};
  for (const u of updates) {
    const bp = u.balanceChanges?.byParty || {};
    for (const [pk, pv] of Object.entries(bp)) {
      const name = pk.split('::')[0];
      if (!parties[name]) parties[name] = { appRewards: 0, transferred: 0, appearances: 0 };
      parties[name].appRewards += Math.abs(parseFloat(pv.appRewardsMinted || '0'));
      parties[name].transferred += Math.abs(parseFloat(pv.amuletTransferred || '0'));
      parties[name].appearances += 1;
    }
  }

  // Filter to named parties (not UUIDs/hashes)
  const named = {};
  for (const [name, stats] of Object.entries(parties)) {
    if (/^[a-f0-9]{20,}$/.test(name)) continue; // Skip hex hashes
    if (/^[0-9a-f]{8}-/.test(name)) continue; // Skip UUIDs
    named[name] = stats;
  }

  console.log(`  ${Object.keys(named).length} named on-chain parties`);
  return named;
}

// ---------------------------------------------------------------------------
// Step 3: Name normalization
// ---------------------------------------------------------------------------

function computeBaseName(appName) {
  let base = appName.toLowerCase().trim();

  // Remove trailing -mainnet-N, -validator-N, -mainnet, -validator
  base = base.replace(/-mainnet-\d+$/, '');
  base = base.replace(/-validator-\d+$/, '');
  base = base.replace(/-mainnet$/, '');
  base = base.replace(/-validator$/, '');

  // Remove common prefixes
  base = base.replace(/^feat-/, '');
  base = base.replace(/^send-/, '');

  // Remove trailing -N (numeric suffixes)
  base = base.replace(/-\d+$/, '');

  // Remove trailing UUID-like segments
  base = base.replace(/-[a-f0-9]{8,}$/, '');

  // Clean up
  base = base.replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '');

  // If too short, keep original
  if (base.length < 2) base = appName.toLowerCase().replace(/[^a-z0-9-]/g, '-');

  return base;
}

// ---------------------------------------------------------------------------
// Step 4: Categorization
// ---------------------------------------------------------------------------

const CATEGORY_RULES = [
  { category: 'Wallet', keywords: ['wallet', 'vault', 'custody', 'key', 'safe', 'stash', 'wallets'] },
  { category: 'DEX/AMM', keywords: ['swap', 'amm', 'pool', 'liquidity', 'dex'] },
  { category: 'Orderbook/CLOB', keywords: ['orderbook', 'clob', 'exchange', 'matching', 'exchanges'] },
  { category: 'Lending/Finance', keywords: ['lending', 'borrow', 'credit', 'loan', 'financing', 'finance'] },
  { category: 'Bridge/Interop', keywords: ['bridge', 'relay', 'interoperability', 'cross-chain'] },
  { category: 'Data/Analytics', keywords: ['explorer', 'analytics', 'data', 'scan', 'indexer', 'data_analytics', 'insights'] },
  { category: 'Identity/Auth', keywords: ['auth', 'identity', 'kyc', 'compliance', 'forensics', 'forensics_and_security'] },
  { category: 'Payments', keywords: ['payments', 'pay', 'remittance', 'stablecoins'] },
  { category: 'Tokenized Assets', keywords: ['tokenized', 'tokenized_assets', 'rwa', 'token'] },
  { category: 'Developer Tools', keywords: ['developer', 'developer_tools', 'sdk', 'tools', 'naas'] },
  { category: 'Prediction Markets', keywords: ['prediction', 'betting', 'market', 'odds'] },
  { category: 'Validator/Infra', keywords: ['validator', 'node', 'operator', 'foundation', 'infrastructure'] },
];

function categorize(entry) {
  const text = [
    entry.name,
    entry.baseName,
    entry.description || '',
    ...(entry.solutionTags || []),
    ...(entry.roleTags || []),
  ].join(' ').toLowerCase();

  let bestCategory = 'Unknown';
  let bestScore = 0;

  for (const rule of CATEGORY_RULES) {
    let score = 0;
    for (const kw of rule.keywords) {
      if (text.includes(kw)) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      bestCategory = rule.category;
    }
  }

  return bestCategory;
}

// ---------------------------------------------------------------------------
// Step 5: Confidence scoring
// ---------------------------------------------------------------------------

function computeConfidence(entry) {
  let score = 30; // Base score for being listed on canton.network

  // Has a canton.network page
  if (entry.url && entry.url.includes('canton.network')) score += 10;

  // Has description
  if (entry.description && entry.description.length > 10) score += 10;

  // Has solution tags (indicates real product)
  if (entry.solutionTags && entry.solutionTags.length > 0) score += 10;

  // Is featured app
  if (entry.roleTags && entry.roleTags.includes('apps_featured')) score += 15;

  // Has on-chain activity
  if (entry.onChainActivity) {
    score += 10;
    if (entry.onChainActivity.appRewards > 0) score += 10;
    if (entry.onChainActivity.appearances > 5) score += 5;
  }

  // Has a guessed website
  if (entry.websiteGuess && !entry.websiteGuess.includes('canton.network')) score += 10;

  return Math.min(score, 100);
}

// ---------------------------------------------------------------------------
// Step 6: Website guessing from known domains
// ---------------------------------------------------------------------------

const KNOWN_WEBSITES = {
  '5n loop wallet': 'https://5nloop.com',
  'archax': 'https://archax.com',
  'asterizm': 'https://asterizm.io',
  'bitwave': 'https://bitwave.io',
  'black manta': 'https://blackmanta.capital',
  'brale': 'https://brale.xyz',
  'broadridge dlr': 'https://www.broadridge.com',
  'bron': 'https://bronwallet.com',
  'bron wallet': 'https://bronwallet.com',
  'calastone': 'https://calastone.com',
  'cantara': 'https://cantara.fi',
  'cantex': 'https://cantex.io',
  'cantor8': 'https://cantor8.io',
  'cbtc': 'https://cbtc.com',
  'circle': 'https://circle.com',
  'coin metrics': 'https://coinmetrics.io',
  'cygnet': 'https://cygnet.finance',
  'cypherock': 'https://cypherock.com',
  'da utilities': 'https://digitalasset.com',
  'denex gas station': null,
  'dfns': 'https://dfns.co',
  'equilend': 'https://equilend.com',
  'fairmint': 'https://fairmint.com',
  'frax': 'https://frax.finance',
  'gs dap\u00ae': 'https://www.gsam.com',
  'hashnote': 'https://hashnote.com',
  'hecto finance': 'https://hectofinance.com',
  'hkex synapse': 'https://hkex.com.hk',
  'houdini swap': 'https://houdiniswap.com',
  'hydra x': 'https://hydrax.io',
  'icapital': 'https://icapitalnetwork.com',
  'intellecteu': 'https://intellecteu.com',
  'kaiko': 'https://kaiko.com',
  'kairo': null,
  'lendos': 'https://lendos.io',
  'lukka inc.': 'https://lukka.tech',
  'm1x': null,
  'maestro': 'https://maestro.org',
  'moody\'s': 'https://moodys.com',
  'mpch': 'https://mpcvault.com',
  'nasdaq': 'https://nasdaq.com',
  'nightly wallet': 'https://nightly.app',
  'node fortress': 'https://nodefortress.io',
  'novaprime': null,
  'noves': 'https://noves.fi',
  'obligate': 'https://obligate.com',
  'openvector': null,
  'particula': 'https://particula.io',
  'realworld solutions': null,
  'send': 'https://send.it',
  'sync insights': null,
  'temple digital group': 'https://templedigitalgroup.com',
  'tradecraft': 'https://tradecraft.fi',
  'unhedged': 'https://unhedged.gg',
  'bnp paribas': 'https://bnpparibas.com',
  'société générale': 'https://societegenerale.com',
  'trakx': 'https://trakx.io',
  'loopid': null,
  'cantonswap': null,
  'supa1': null,
  'bitsafe': null,
  'angelhack': 'https://angelhack.com',
  '7ridge': null,
  'acme': null,
  'chain experts': null,
  'eleox': 'https://eleox.io',
  'fidelity': 'https://fidelity.com',
  'franklin templeton': 'https://franklintempleton.com',
  'galaxy': 'https://galaxy.com',
  'ledgible': 'https://ledgible.io',
  'ipblock llc': null,
  'mexc': 'https://mexc.com',
  'hellomoon': 'https://hellomoon.io',
  'texturecapital': 'https://texturecapital.com',
  'tenkai': null,
};

function guessWebsite(name) {
  const lower = name.toLowerCase();
  if (KNOWN_WEBSITES.hasOwnProperty(lower)) return KNOWN_WEBSITES[lower];

  // Try common domain patterns
  const base = computeBaseName(name);
  // Don't guess for generic names
  if (base.length < 3) return null;

  return null; // Only use known sites, don't fabricate URLs
}

// ---------------------------------------------------------------------------
// Step 7: Match on-chain names to ecosystem entries
// ---------------------------------------------------------------------------

function matchOnChainToEcosystem(ecosystemEntries, onChainParties) {
  const matched = {};

  for (const [partyName, stats] of Object.entries(onChainParties)) {
    const base = computeBaseName(partyName);

    // Try to match against ecosystem entries
    let bestMatch = null;
    let bestScore = 0;

    for (const entry of ecosystemEntries) {
      const entryBase = computeBaseName(entry.name);
      const entryLower = entry.name.toLowerCase();

      // Exact base match
      if (base === entryBase) {
        bestMatch = entry.name;
        bestScore = 100;
        break;
      }

      // Partial match
      if (entryBase.includes(base) || base.includes(entryBase)) {
        const score = Math.min(base.length, entryBase.length) / Math.max(base.length, entryBase.length) * 80;
        if (score > bestScore) {
          bestMatch = entry.name;
          bestScore = score;
        }
      }

      // Name contains
      if (entryLower.includes(base) || base.includes(entryLower.replace(/\s+/g, ''))) {
        if (60 > bestScore) {
          bestMatch = entry.name;
          bestScore = 60;
        }
      }
    }

    matched[partyName] = {
      ecosystemMatch: bestMatch,
      matchScore: bestScore,
      ...stats,
    };
  }

  return matched;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('Canton App Registry Builder');
  console.log('==========================\n');

  // Step 1: Scrape ecosystem
  const ecosystem = await scrapeEcosystem();

  // Step 2: Get on-chain activity
  let onChainParties = {};
  try {
    onChainParties = await getOnChainApps();
  } catch (err) {
    console.error('  Warning: CC Explorer fetch failed:', err.message);
  }

  // Match on-chain to ecosystem
  const onChainMatches = matchOnChainToEcosystem(ecosystem, onChainParties);

  // Filter to apps only (apps_all or apps_featured)
  const appEntries = ecosystem.filter(e =>
    e.roleTags.includes('apps_all') || e.roleTags.includes('apps_featured')
  );

  // Also add on-chain parties that didn't match any ecosystem entry
  const unmatchedOnChain = [];
  for (const [name, info] of Object.entries(onChainMatches)) {
    if (!info.ecosystemMatch && (info.appRewards > 0 || info.appearances > 10)) {
      unmatchedOnChain.push({
        name, url: null, description: null,
        solutionTags: [], roleTags: ['on_chain_only'],
        onChainData: info,
      });
    }
  }

  console.log(`  ${appEntries.length} ecosystem apps + ${unmatchedOnChain.length} on-chain-only parties`);

  // Build registry entries
  const registry = [];

  for (const entry of [...appEntries, ...unmatchedOnChain]) {
    const baseName = computeBaseName(entry.name);
    const websiteGuess = guessWebsite(entry.name) || guessWebsite(baseName);

    // Find on-chain match
    let onChainActivity = null;
    for (const [partyName, info] of Object.entries(onChainMatches)) {
      if (info.ecosystemMatch === entry.name) {
        onChainActivity = { partyName, ...info };
        break;
      }
    }
    // For on-chain-only entries
    if (entry.onChainData) {
      onChainActivity = { partyName: entry.name, ...entry.onChainData };
    }

    const regEntry = {
      appName: entry.name,
      baseName,
      solutionTags: entry.solutionTags || [],
      roleTags: entry.roleTags || [],
      description: entry.description || null,
      cantonNetworkUrl: entry.url || null,
      websiteGuess,
      onChainActivity,
    };

    regEntry.category = categorize(regEntry);
    regEntry.confidence = computeConfidence(regEntry);

    // Generate note
    const notes = [];
    if (regEntry.roleTags.includes('apps_featured')) notes.push('Featured');
    if (onChainActivity && onChainActivity.appRewards > 0) {
      notes.push(`${onChainActivity.appRewards.toFixed(0)} CC rewards on-chain`);
    }
    if (onChainActivity && onChainActivity.appearances > 10) {
      notes.push(`${onChainActivity.appearances} recent txns`);
    }
    if (regEntry.roleTags.includes('on_chain_only')) notes.push('On-chain only, not in ecosystem page');
    if (regEntry.roleTags.includes('super_validator')) notes.push('Super Validator');
    if (regEntry.roleTags.includes('canton_foundation_member')) notes.push('Foundation Member');
    regEntry.note = notes.join('; ') || null;

    registry.push(regEntry);
  }

  // Sort: featured first, then by confidence desc, then alphabetical
  registry.sort((a, b) => {
    const aFeat = a.roleTags.includes('apps_featured') ? 1 : 0;
    const bFeat = b.roleTags.includes('apps_featured') ? 1 : 0;
    if (bFeat !== aFeat) return bFeat - aFeat;
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    return a.appName.localeCompare(b.appName);
  });

  // Write JSON
  const outDir = path.join(__dirname, '..', 'data');
  fs.mkdirSync(outDir, { recursive: true });

  const jsonPath = path.join(outDir, 'canton_apps_registry.json');
  fs.writeFileSync(jsonPath, JSON.stringify(registry, null, 2));

  // Write CSV
  const csvPath = path.join(outDir, 'canton_apps_registry.csv');
  const csvHeader = 'app_name,base_name,category,confidence,website_guess,canton_page,on_chain,note';
  const csvRows = registry.map(r => {
    const fields = [
      csvEscape(r.appName),
      csvEscape(r.baseName),
      csvEscape(r.category),
      r.confidence,
      csvEscape(r.websiteGuess || ''),
      csvEscape(r.cantonNetworkUrl || ''),
      r.onChainActivity ? 'yes' : 'no',
      csvEscape(r.note || ''),
    ];
    return fields.join(',');
  });
  fs.writeFileSync(csvPath, [csvHeader, ...csvRows].join('\n'));

  // Summary
  const categories = {};
  let withWebsite = 0;
  let lowConfidence = 0;
  let featured = 0;
  let onChainCount = 0;

  for (const r of registry) {
    categories[r.category] = (categories[r.category] || 0) + 1;
    if (r.websiteGuess) withWebsite++;
    if (r.confidence < 50) lowConfidence++;
    if (r.roleTags.includes('apps_featured')) featured++;
    if (r.onChainActivity) onChainCount++;
  }

  console.log(`\n=== Registry Summary ===`);
  console.log(`Total apps: ${registry.length}`);
  console.log(`Featured: ${featured}`);
  console.log(`With website: ${withWebsite}`);
  console.log(`With on-chain activity: ${onChainCount}`);
  console.log(`Low confidence (<50): ${lowConfidence}`);
  console.log(`\nCategories:`);
  for (const [cat, count] of Object.entries(categories).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${cat}: ${count}`);
  }

  console.log(`\nFiles written:`);
  console.log(`  ${jsonPath}`);
  console.log(`  ${csvPath}`);
}

function csvEscape(str) {
  if (!str) return '';
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
