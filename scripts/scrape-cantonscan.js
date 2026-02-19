// scripts/scrape-cantonscan.js
// Scrapes https://www.cantonscan.com/featured-apps using headless browser
// Extracts all app names across pagination, then enriches with web research

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Step 1: Scrape featured apps from CantonScan
// ---------------------------------------------------------------------------

async function scrapeFeaturedApps() {
  console.log('Step 1: Scraping CantonScan featured apps...');

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();
  await page.setUserAgent(
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  );

  await page.goto('https://www.cantonscan.com/featured-apps', {
    waitUntil: 'networkidle2',
    timeout: 60000,
  });

  // Wait for Cloudflare challenge to resolve
  console.log('  Waiting for Cloudflare challenge...');
  await page.waitForFunction(
    () => !document.title.includes('Just a moment'),
    { timeout: 30000 }
  ).catch(() => console.log('  Cloudflare wait timed out, proceeding...'));

  // Wait for table/content to render
  await new Promise(r => setTimeout(r, 5000));

  // Try to find the app list -- check what's on the page
  const pageTitle = await page.title();
  console.log('  Page title:', pageTitle);

  // Collect all apps across pagination
  const allApps = [];
  let pageNum = 1;
  let hasMore = true;

  while (hasMore) {
    console.log(`  Scraping page ${pageNum}...`);

    // Extract app names from the current page
    const apps = await page.evaluate(() => {
      const results = [];

      // Strategy 1: Look for table rows
      const rows = document.querySelectorAll('table tbody tr');
      if (rows.length > 0) {
        rows.forEach(row => {
          const cells = row.querySelectorAll('td');
          if (cells.length > 0) {
            const name = cells[0]?.textContent?.trim();
            if (name) results.push({ appName: name, source: 'table' });
          }
        });
      }

      // Strategy 2: Look for list items or cards with app names
      if (results.length === 0) {
        // Look for common patterns in SPAs
        const links = document.querySelectorAll('a[href*="/app/"], a[href*="/featured"]');
        links.forEach(link => {
          const name = link.textContent?.trim();
          if (name && name.length > 1 && name.length < 100) {
            results.push({ appName: name, source: 'link' });
          }
        });
      }

      // Strategy 3: Look for any repeated card/item patterns
      if (results.length === 0) {
        const cards = document.querySelectorAll('[class*="app"], [class*="card"], [class*="item"], [class*="row"]');
        cards.forEach(card => {
          const heading = card.querySelector('h2, h3, h4, h5, [class*="name"], [class*="title"]');
          if (heading) {
            const name = heading.textContent?.trim();
            if (name && name.length > 1 && name.length < 100) {
              results.push({ appName: name, source: 'card' });
            }
          }
        });
      }

      // Strategy 4: Dump full page text structure for debugging
      if (results.length === 0) {
        results.push({
          appName: '__DEBUG__',
          source: 'debug',
          html: document.body.innerHTML.substring(0, 10000),
          text: document.body.innerText.substring(0, 5000),
        });
      }

      return results;
    });

    // Check for debug output
    const debugEntry = apps.find(a => a.appName === '__DEBUG__');
    if (debugEntry) {
      console.log('  Could not find structured app data. Page text sample:');
      console.log(debugEntry.text?.substring(0, 2000));

      // Save debug HTML for inspection
      fs.writeFileSync(
        path.join(__dirname, '..', 'data', '_cantonscan_debug.html'),
        debugEntry.html || ''
      );
      console.log('  Debug HTML saved to data/_cantonscan_debug.html');
      break;
    }

    if (apps.length > 0) {
      allApps.push(...apps);
      console.log(`  Found ${apps.length} apps on page ${pageNum}`);
    }

    // Try pagination -- find and click "next" button
    const nextButton = await page.evaluate(() => {
      // Look for next/pagination buttons
      const allButtons = Array.from(document.querySelectorAll('button, a'));
      for (const btn of allButtons) {
        const text = btn.textContent?.trim().toLowerCase();
        const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
        const className = (btn.className || '').toLowerCase();

        if (
          text === 'next' || text === '>' || text === '>>' || text === '\u203a' || text === '\u00bb' ||
          ariaLabel.includes('next') ||
          className.includes('next')
        ) {
          // Check if disabled
          if (btn.disabled || btn.classList.contains('disabled') || btn.getAttribute('aria-disabled') === 'true') {
            return { found: true, disabled: true };
          }
          // Click it
          btn.click();
          return { found: true, disabled: false };
        }
      }

      // Also look for SVG arrow buttons (common pattern)
      const svgButtons = Array.from(document.querySelectorAll('button svg, a svg'));
      // Check parent buttons
      for (const svg of svgButtons) {
        const parent = svg.closest('button, a');
        if (parent) {
          const siblings = Array.from(parent.parentElement?.children || []);
          const idx = siblings.indexOf(parent);
          // Last button in a group is often "next"
          if (idx === siblings.length - 1 && siblings.length >= 2) {
            if (!parent.disabled) {
              parent.click();
              return { found: true, disabled: false };
            }
          }
        }
      }

      return { found: false, disabled: false };
    });

    if (nextButton.found && !nextButton.disabled && apps.length > 0) {
      await new Promise(r => setTimeout(r, 3000));
      pageNum++;
    } else {
      hasMore = false;
    }

    // Safety: don't loop forever
    if (pageNum > 20) break;
  }

  await browser.close();

  // Deduplicate
  const seen = new Set();
  const unique = allApps.filter(a => {
    if (seen.has(a.appName)) return false;
    seen.add(a.appName);
    return true;
  });

  console.log(`  Total unique apps scraped: ${unique.length}`);
  return unique;
}

// ---------------------------------------------------------------------------
// Step 2: Generate base_name
// ---------------------------------------------------------------------------

function computeBaseName(appName) {
  let base = appName.toLowerCase().trim();

  // Handle pure UUIDs (e.g., "23d169c2-0909-4c70-81d1-1922de6febaa")
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(base)) {
    return base; // Keep as-is, it's unidentifiable
  }

  // Handle "party-UUID" entries
  if (/^party-[0-9a-f]{8}-/.test(base)) {
    return base;
  }

  // Handle auth0 entries (e.g., "auth0_007c6643538f2eadd3e573dd05b9")
  if (/^auth0_/.test(base)) {
    return base.replace(/_/g, '');
  }

  // Handle google-oauth2 entries
  if (/^google-oauth2_/.test(base)) {
    return base.replace(/_/g, '');
  }

  // Remove trailing -mainnet-N, -validator-N, etc.
  base = base.replace(/-mainnet-\d+$/, '');
  base = base.replace(/-validator-\d+$/, '');
  base = base.replace(/-mainnetvalidator-\d+$/, '');
  base = base.replace(/-mainnet$/, '');
  base = base.replace(/-validator$/, '');

  // Remove common prefixes
  base = base.replace(/^feat-/, '');
  base = base.replace(/^send-/, '');
  base = base.replace(/^validator_/, '');

  // Remove trailing -N (numeric suffixes) but not if it makes it too short
  const withoutNum = base.replace(/-\d+$/, '');
  if (withoutNum.length >= 2) base = withoutNum;

  // Remove trailing -mainNet-NN patterns (case insensitive already)
  base = base.replace(/-mainnet-\d+$/, '');

  // Remove trailing UUID-like segments
  base = base.replace(/-[a-f0-9]{8,}$/, '');

  // Clean up
  base = base.replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '');

  // If too short, keep original cleaned
  if (base.length < 2) base = appName.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-');

  return base;
}

// ---------------------------------------------------------------------------
// Step 3: Automated web research
// ---------------------------------------------------------------------------

// Rate limiting: max 3 concurrent requests
const CONCURRENCY = 3;
const DELAY_MS = 1500;

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// Simple web search using DuckDuckGo HTML (no API key needed)
async function webSearch(query) {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      },
    });
    if (!res.ok) return [];
    const html = await res.text();

    // Parse results from DuckDuckGo HTML
    const results = [];
    const pattern = /<a\s+rel="nofollow"\s+class="result__a"\s+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    let match;
    while ((match = pattern.exec(html)) !== null) {
      const rawUrl = match[1];
      const title = match[2].replace(/<[^>]+>/g, '').trim();

      // DuckDuckGo wraps URLs - extract actual URL
      let actualUrl = rawUrl;
      const uddgMatch = rawUrl.match(/uddg=([^&]+)/);
      if (uddgMatch) actualUrl = decodeURIComponent(uddgMatch[1]);

      results.push({ url: actualUrl, title });
    }

    return results.slice(0, 5);
  } catch {
    return [];
  }
}

// Known website mappings -- comprehensive list from canton.network + manual research
const KNOWN_WEBSITES = {
  // DeFi / Apps
  'tradecraft': { url: 'https://tradecraft.fi', cat: 'DEX/AMM', note: 'Canton DEX (AMM)' },
  'unhedged': { url: 'https://unhedged.gg', cat: 'Prediction Markets', note: 'Canton prediction markets' },
  'unhedged-app': { url: 'https://unhedged.gg', cat: 'Prediction Markets', note: 'Canton prediction markets' },
  'temple': { url: 'https://app.templedigitalgroup.com', cat: 'Orderbook/CLOB', note: 'Institutional CLOB exchange' },
  'cantex': { url: 'https://cantex.io', cat: 'DEX/AMM', note: 'Canton DEX by CaviarNine' },
  'cantonswap': { url: null, cat: 'DEX/AMM', note: 'Canton swap protocol' },
  'poolparty': { url: null, cat: 'DEX/AMM', note: 'Liquidity pool protocol' },
  'silvana-orderbook': { url: null, cat: 'Orderbook/CLOB', note: 'Order book exchange' },
  'thetamarkets': { url: null, cat: 'Prediction Markets', note: 'Markets protocol' },
  'acme-lending': { url: null, cat: 'Lending', note: 'Overcollateralized lending on Canton' },
  'cygnet': { url: 'https://cygnet.finance', cat: 'DEX/AMM', note: 'Canton DeFi protocol' },

  // Wallets
  'bron': { url: 'https://bronwallet.com', cat: 'Wallet', note: 'Non-custodial Canton wallet' },
  'cypherock': { url: 'https://cypherock.com', cat: 'Wallet', note: 'Hardware wallet with Canton support' },
  'cantonwallet': { url: 'https://cantonwallet.com', cat: 'Wallet', note: 'Canton Network wallet' },
  'cantonloop': { url: 'https://lighthouse.cantonloop.com', cat: 'Wallet', note: '5N Loop wallet / explorer' },
  'dstash': { url: null, cat: 'Wallet', note: 'Canton stash wallet' },
  'valawallet': { url: null, cat: 'Wallet', note: 'Vala Canton wallet' },
  'safe': { url: null, cat: 'Wallet', note: 'Safe send interface' },
  'openvector-wallet': { url: null, cat: 'Wallet', note: 'OpenVector wallet' },

  // Infrastructure / Validators
  'bitgo': { url: 'https://bitgo.com', cat: 'Validator/Infra', note: 'Digital asset custody & infrastructure' },
  'bitgo-mainnetvalidator': { url: 'https://bitgo.com', cat: 'Validator/Infra', note: 'BitGo validator node' },
  'bybit': { url: 'https://bybit.com', cat: 'Validator/Infra', note: 'Crypto exchange validator' },
  'bybit-mainnetvalidator': { url: 'https://bybit.com', cat: 'Validator/Infra', note: 'ByBit validator node' },
  'kraken': { url: 'https://kraken.com', cat: 'Validator/Infra', note: 'Crypto exchange validator' },
  'kucoin': { url: 'https://kucoin.com', cat: 'Validator/Infra', note: 'Crypto exchange validator' },
  'kucoin-node': { url: 'https://kucoin.com', cat: 'Validator/Infra', note: 'KuCoin validator node' },
  'binance-dp': { url: 'https://binance.us', cat: 'Validator/Infra', note: 'Binance delegation participant' },
  'mexc': { url: 'https://mexc.com', cat: 'Validator/Infra', note: 'MEXC exchange validator' },
  'coinmetrics': { url: 'https://coinmetrics.io', cat: 'Explorer/Infra', note: 'Crypto data & analytics' },
  'flipside': { url: 'https://flipsidecrypto.xyz', cat: 'Explorer/Infra', note: 'Onchain analytics' },
  'republic': { url: 'https://republic.com', cat: 'Validator/Infra', note: 'Investment platform validator' },
  'cantonnodes': { url: 'https://cantonnodes.com', cat: 'Validator/Infra', note: 'Canton RPC & node services' },
  'proofgroup': { url: 'https://proofgroup.com', cat: 'Validator/Infra', note: 'Blockchain infrastructure' },
  'supanova': { url: null, cat: 'Validator/Infra', note: 'Canton validator' },
  'palladium': { url: null, cat: 'Validator/Infra', note: 'Canton validator' },
  'texturecapital': { url: 'https://texturecapital.com', cat: 'Validator/Infra', note: 'Digital asset platform' },
  'lithiumdigital': { url: null, cat: 'Validator/Infra', note: 'Canton validator' },
  'ubyx': { url: null, cat: 'Validator/Infra', note: 'Canton validator' },
  'hifi': { url: 'https://hifi.finance', cat: 'Validator/Infra', note: 'Fixed-rate lending protocol' },
  'ibtc': { url: null, cat: 'Validator/Infra', note: 'iBTC validator' },
  'potamusengagement': { url: null, cat: 'Validator/Infra', note: 'Canton validator' },
  'thetievalidator': { url: 'https://thetie.io', cat: 'Explorer/Infra', note: 'Crypto analytics platform' },
  'the_tie_validator': { url: 'https://thetie.io', cat: 'Explorer/Infra', note: 'Crypto analytics platform' },
  'nodefortress': { url: 'https://nodefortress.io', cat: 'Validator/Infra', note: 'Node hosting infrastructure' },
  'nodefortress-finance': { url: 'https://nodefortress.io', cat: 'Validator/Infra', note: 'Node hosting infrastructure' },
  'trizegroup-cantonmainnetvalidator': { url: null, cat: 'Validator/Infra', note: 'TRIZE Group validator' },
  'trizegroup-rizescore': { url: null, cat: 'Identity/Auth', note: 'TRIZE Group identity score' },
  'm1': { url: null, cat: 'Validator/Infra', note: 'Canton validator' },
  'trakx': { url: 'https://trakx.io', cat: 'Validator/Infra', note: 'Crypto index platform' },

  // Tech / Services
  'fairmint': { url: 'https://fairmint.com', cat: 'Tokenized Assets', note: 'Equity & token issuance' },
  'intellecteu': { url: 'https://intellecteu.com', cat: 'Validator/Infra', note: 'Enterprise blockchain solutions' },
  'obligate': { url: 'https://obligate.com', cat: 'Tokenized Assets', note: 'On-chain bond issuance' },
  'pixelplex': { url: 'https://pixelplex.io', cat: 'Explorer/Infra', note: 'Canton exchange development' },
  'nethermind': { url: 'https://nethermind.io', cat: 'Validator/Infra', note: 'Blockchain infrastructure' },
  'nethermind-angkor': { url: 'https://nethermind.io', cat: 'Validator/Infra', note: 'Nethermind Canton node' },
  'dsrv': { url: 'https://dsrv.io', cat: 'Validator/Infra', note: 'Multi-chain validator' },
  'dsrv-mainnetvalidator': { url: 'https://dsrv.io', cat: 'Validator/Infra', note: 'DSRV Canton validator' },
  'mpch': { url: 'https://mpcvault.com', cat: 'Wallet', note: 'MPC wallet infrastructure' },
  'mpch-brondvn': { url: 'https://mpcvault.com', cat: 'Wallet', note: 'MPCH Bron delegation validator' },
  'noves': { url: 'https://noves.fi', cat: 'Explorer/Infra', note: 'Transaction interpretation' },
  'noves-translate': { url: 'https://noves.fi', cat: 'Explorer/Infra', note: 'Noves Translate API' },
  'cantor8-digik': { url: 'https://cantor8.tech/digik', cat: 'Explorer/Infra', note: 'DigiK - Canton gateway' },
  'dfns': { url: 'https://dfns.co', cat: 'Wallet', note: 'Wallet-as-a-service' },
  'dfns1': { url: 'https://dfns.co', cat: 'Wallet', note: 'DFNS wallet infrastructure' },
  'hashnote': { url: 'https://hashnote.com', cat: 'Tokenized Assets', note: 'Institutional yield products' },
  'validatorhashnote': { url: 'https://hashnote.com', cat: 'Tokenized Assets', note: 'Hashnote validator' },
  'zodiacustody': { url: 'https://zodia.io', cat: 'Wallet', note: 'Standard Chartered crypto custody' },
  'blackmantacapital-primary': { url: 'https://blackmanta.capital', cat: 'Tokenized Assets', note: 'BaFin-regulated tokenized securities' },
  'hecto-finance': { url: 'https://hectofinance.com', cat: 'Lending', note: 'Canton DeFi protocol' },
  'handlpay-main': { url: null, cat: 'Payments', note: 'Canton payment service' },
  'bridge-operator': { url: null, cat: 'Bridge', note: 'Canton bridge operator' },
  'cumberland-gasstation': { url: 'https://cumberland.io', cat: 'Validator/Infra', note: 'Cumberland gas station (DRW subsidiary)' },
  'ccbrowser': { url: null, cat: 'Explorer/Infra', note: 'Canton Coin browser' },
  'c7trust': { url: null, cat: 'Validator/Infra', note: 'C7 Technology trust service' },
  'desyn': { url: null, cat: 'Unknown', note: 'Canton app' },
  'foundinalsunthy': { url: null, cat: 'Unknown', note: 'Canton app' },
  'sunthycloud': { url: null, cat: 'Unknown', note: 'Canton cloud service' },
  'hashrupt-verity': { url: null, cat: 'Identity/Auth', note: 'Verification service' },
  'kairo': { url: null, cat: 'Unknown', note: 'Canton app' },
  'loopid': { url: null, cat: 'Identity/Auth', note: 'Identity service' },
  'mandalo': { url: null, cat: 'Unknown', note: 'Canton app' },
  'modo': { url: null, cat: 'Unknown', note: 'Canton app' },
  'modulo': { url: null, cat: 'Unknown', note: 'Canton app' },
  'tenkai-main': { url: null, cat: 'Unknown', note: 'Canton app' },
  'unitedapp-cc': { url: null, cat: 'Unknown', note: 'Canton app' },
  'openvector': { url: null, cat: 'Unknown', note: 'Canton app' },
  'cbtc-attestor-pool': { url: null, cat: 'Bridge', note: 'CBTC Bitcoin attestor pool' },
};

// Domains to ignore (not official app sites)
const IGNORE_DOMAINS = [
  'cantonscan.com', 'ccexplorer.io', 'canton.network', 'sync.global',
  'twitter.com', 'x.com', 'facebook.com', 'linkedin.com', 'youtube.com',
  'reddit.com', 'medium.com', 'github.com',
];

function isOfficialDomain(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return !IGNORE_DOMAINS.some(d => host.includes(d));
  } catch {
    return false;
  }
}

async function researchApp(baseName, appName) {
  // Check known websites first (try baseName, then appName-derived keys)
  const keysToTry = [baseName, appName.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-')];
  for (const key of keysToTry) {
    if (KNOWN_WEBSITES.hasOwnProperty(key)) {
      const known = KNOWN_WEBSITES[key];
      return {
        websiteGuess: known.url,
        note: known.note || (known.url ? 'Known website' : 'No website known'),
        knownCategory: known.cat || null,
        searchResults: [],
      };
    }
  }

  // Try web searches
  const queries = [
    `${baseName} canton network`,
    `${baseName} blockchain crypto`,
  ];

  let bestUrl = null;
  let bestTitle = '';
  const allResults = [];

  for (const query of queries) {
    await sleep(DELAY_MS);
    const results = await webSearch(query);
    allResults.push(...results);

    for (const r of results) {
      if (isOfficialDomain(r.url) && !bestUrl) {
        bestUrl = r.url;
        bestTitle = r.title;
      }
    }

    if (bestUrl) break; // Found something, stop searching
  }

  return {
    websiteGuess: bestUrl,
    note: bestTitle ? bestTitle.substring(0, 80) : null,
    searchResults: allResults.slice(0, 3),
  };
}

async function researchAllApps(apps) {
  console.log('\nStep 3: Researching apps...');

  const results = [];
  const queue = [...apps];
  let completed = 0;

  // Process in batches of CONCURRENCY
  while (queue.length > 0) {
    const batch = queue.splice(0, CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map(async (app) => {
        const research = await researchApp(app.baseName, app.appName);
        completed++;
        if (completed % 10 === 0 || completed === apps.length) {
          console.log(`  Researched ${completed}/${apps.length}`);
        }
        return { ...app, ...research };
      })
    );
    results.push(...batchResults);
  }

  return results;
}

// ---------------------------------------------------------------------------
// Step 4: Categorize
// ---------------------------------------------------------------------------

const CATEGORY_RULES = [
  { category: 'Wallet', keywords: ['wallet', 'vault', 'custody', 'key', 'safe', 'stash'] },
  { category: 'DEX/AMM', keywords: ['swap', 'amm', 'pool', 'liquidity', 'dex'] },
  { category: 'Orderbook/CLOB', keywords: ['orderbook', 'clob', 'exchange', 'matching', 'order-book'] },
  { category: 'Lending', keywords: ['lending', 'borrow', 'credit', 'loan'] },
  { category: 'Bridge', keywords: ['bridge', 'relay', 'interoperability', 'cross-chain'] },
  { category: 'Explorer/Infra', keywords: ['explorer', 'browser', 'scan', 'indexer', 'analytics'] },
  { category: 'Identity/Auth', keywords: ['auth', 'identity', 'kyc', 'compliance'] },
  { category: 'Prediction Markets', keywords: ['prediction', 'betting', 'market', 'odds'] },
  { category: 'Payments', keywords: ['pay', 'payment', 'remittance', 'stablecoin'] },
  { category: 'Tokenized Assets', keywords: ['tokenized', 'rwa', 'token', 'asset'] },
  { category: 'Validator/Infra', keywords: ['validator', 'node', 'operator', 'foundation', 'infrastructure'] },
];

function categorize(app) {
  // If we have a known category from the website DB, prefer it
  if (app.knownCategory && app.knownCategory !== 'Unknown') {
    return app.knownCategory;
  }

  const text = [
    app.appName,
    app.baseName,
    app.note || '',
    ...(app.searchResults || []).map(r => r.title || ''),
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

function computeConfidence(app) {
  let score = 30; // Base score for being listed on CantonScan

  // Pure UUID or auth0 entries get lower base
  if (/^[0-9a-f]{8}-/.test(app.appName) || /^party-/.test(app.appName)) {
    score = 15;
  } else if (/^auth0_/.test(app.appName) || /^google-oauth2_/.test(app.appName)) {
    score = 20;
  }

  // Has a website guess that's not null
  if (app.websiteGuess) {
    score += 25;
    // Official-looking domain
    const base = app.baseName.replace(/-/g, '');
    if (app.websiteGuess.toLowerCase().includes(base)) score += 15;
  }

  // Has a note/description from search
  if (app.note && app.note !== 'No website known' && app.note !== 'Canton app') score += 10;

  // Category is not Unknown
  if (app.category !== 'Unknown') score += 10;

  // Known in our database (high confidence)
  const known = KNOWN_WEBSITES[app.baseName];
  if (known) {
    if (known.url) score += 10;
    if (known.cat && known.cat !== 'Unknown') score += 5;
  }

  return Math.min(score, 100);
}

// ---------------------------------------------------------------------------
// Step 5: Produce registry artifact
// ---------------------------------------------------------------------------

function writeRegistry(apps) {
  console.log('\nStep 5: Writing registry files...');

  const outDir = path.join(__dirname, '..', 'data');
  fs.mkdirSync(outDir, { recursive: true });

  // Clean up search results before saving (keep output lean)
  const registry = apps.map(a => ({
    appName: a.appName,
    baseName: a.baseName,
    category: a.category,
    confidence: a.confidence,
    websiteGuess: a.websiteGuess || null,
    note: a.note || null,
  }));

  // Sort: high confidence first, then alphabetical
  registry.sort((a, b) => {
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    return a.appName.localeCompare(b.appName);
  });

  // JSON
  const jsonPath = path.join(outDir, 'cantonscan_apps_registry.json');
  fs.writeFileSync(jsonPath, JSON.stringify(registry, null, 2));

  // CSV
  const csvPath = path.join(outDir, 'cantonscan_apps_registry.csv');
  const csvHeader = 'app_name,base_name,category,confidence,website_guess,note';
  const csvRows = registry.map(r => {
    return [
      csvEscape(r.appName),
      csvEscape(r.baseName),
      csvEscape(r.category),
      r.confidence,
      csvEscape(r.websiteGuess || ''),
      csvEscape(r.note || ''),
    ].join(',');
  });
  fs.writeFileSync(csvPath, [csvHeader, ...csvRows].join('\n'));

  // Summary
  const categories = {};
  let withWebsite = 0;
  let lowConfidence = 0;

  for (const r of registry) {
    categories[r.category] = (categories[r.category] || 0) + 1;
    if (r.websiteGuess) withWebsite++;
    if (r.confidence < 50) lowConfidence++;
  }

  const summary = {
    totalApps: registry.length,
    withWebsite,
    lowConfidence,
    categories,
  };

  // Write summary
  const summaryPath = path.join(outDir, 'cantonscan_summary.json');
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

  console.log(`\n=== Registry Summary ===`);
  console.log(`Total apps: ${registry.length}`);
  console.log(`With website: ${withWebsite}`);
  console.log(`Low confidence (<50): ${lowConfidence}`);
  console.log(`\nCategories:`);
  for (const [cat, count] of Object.entries(categories).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${cat}: ${count}`);
  }

  console.log(`\nFiles written:`);
  console.log(`  ${jsonPath}`);
  console.log(`  ${csvPath}`);
  console.log(`  ${summaryPath}`);

  return { registry, summary };
}

function csvEscape(str) {
  if (!str) return '';
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('CantonScan Featured Apps Registry Builder');
  console.log('=========================================\n');

  // Step 1: Scrape
  let apps = await scrapeFeaturedApps();

  if (apps.length === 0) {
    console.error('\nFailed to scrape apps. Check data/_cantonscan_debug.html for page content.');
    process.exit(1);
  }

  // Step 2: Generate base_name
  console.log('\nStep 2: Generating base names...');
  apps = apps.map(a => ({
    ...a,
    baseName: computeBaseName(a.appName),
  }));

  // Step 3: Research
  apps = await researchAllApps(apps);

  // Step 4: Categorize
  console.log('\nStep 4: Categorizing...');
  apps = apps.map(a => {
    const category = categorize(a);
    return { ...a, category };
  });

  // Compute confidence
  apps = apps.map(a => ({
    ...a,
    confidence: computeConfidence(a),
  }));

  // Step 5: Write
  const { registry, summary } = writeRegistry(apps);

  console.log('\nDone!');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
