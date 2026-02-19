// app.js -- Canton Ecosystem Dashboard renderer

(async function () {
  var dashboard = document.getElementById('dashboard');
  var timestampEl = document.getElementById('timestamp');
  var snap;

  try {
    var res = await fetch('data/snapshot.json');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    snap = await res.json();
  } catch (err) {
    dashboard.innerHTML =
      '<div class="card"><p>Failed to load data: ' + esc(err.message) +
      '</p><p>Run <code>node scripts/fetch-data.js</code> to generate the snapshot.</p></div>';
    return;
  }

  // Header
  var date = new Date(snap.lastUpdated);
  timestampEl.textContent =
    'Last updated: ' +
    date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) +
    ' at ' +
    date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });

  if (snap.cantonCoinPriceUsd) {
    var priceEl = document.createElement('p');
    priceEl.className = 'timestamp';
    priceEl.textContent = 'Canton Coin (CC): $' + snap.cantonCoinPriceUsd.toFixed(4);
    timestampEl.after(priceEl);
  }

  // Load registry data in parallel
  var registry = null;
  try {
    var regRes = await fetch('data/cantonscan_apps_registry.json');
    if (regRes.ok) registry = await regRes.json();
  } catch (e) { /* registry is optional */ }

  // 1. Executive Insights
  dashboard.innerHTML = renderInsights(snap);

  // 2. Three-tier metrics
  dashboard.innerHTML += renderTiers(snap, registry);

  // 3. Application cards
  dashboard.innerHTML += renderAppSection(snap);

  // 5. Featured Apps Registry
  if (registry) {
    dashboard.innerHTML += renderRegistry(registry);
  }

  // 6. Governance
  dashboard.innerHTML += renderGovernance(snap);

  // 7. Network infrastructure (SVs, sponsors -- collapsible)
  dashboard.innerHTML += renderNetworkInfra(snap);

  // Wire up expand toggles
  document.querySelectorAll('.expand-toggle').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var target = document.getElementById(btn.dataset.target);
      if (target) {
        var hidden = target.style.display === 'none';
        target.style.display = hidden ? '' : 'none';
        btn.textContent = hidden ? 'Show less' : btn.dataset.label;
      }
    });
  });

  // Wire up registry filters
  if (registry) wireRegistryFilters(registry);
})();

// ===========================================================================
// Section renderers
// ===========================================================================

function renderInsights(snap) {
  if (!snap.executiveInsights || snap.executiveInsights.length === 0) return '';
  var html = '<div class="insights-block"><div class="insights-title">Key Findings</div><ul>';
  for (var i = 0; i < snap.executiveInsights.length; i++) {
    html += '<li>' + esc(snap.executiveInsights[i]) + '</li>';
  }
  html += '</ul></div>';
  return html;
}

function renderTiers(snap, registry) {
  var nh = snap.networkHealth || {};
  var conc = snap.concentration || {};
  var ccx = findApp(snap, 'ccexplorer');
  var ra = ccx?.recentActivity;

  var html = '';

  // Tier 1: Network Health
  html += '<div class="card"><div class="tier-label">Network Health</div>';
  html += '<div class="metrics">';
  html += metric('Total TVL', fUsd(nh.totalTvlUsd));
  html += metric('30d Volume', fUsd(nh.volume30dUsd));
  html += metric('Featured Apps', fNum(nh.featuredApps));
  html += metric('Net Issuance', ra ? fNum(ra.netIssuance, 0) + ' CC' : '--', ra && ra.netIssuance > 0 ? 'positive' : ra && ra.netIssuance < 0 ? 'negative' : '');
  html += metric('Gov. Participation', nh.governanceParticipation != null ? fPct(nh.governanceParticipation * 100, 0) : '--');
  html += '</div></div>';

  // Tier 2: Structural Metrics
  html += '<div class="card"><div class="tier-label">Structural Metrics</div>';
  html += '<div class="metrics-row">';

  // SV concentration
  html += '<div class="metrics-group"><div class="metrics-group-label">SV Consensus Weight</div>';
  html += miniBar('Top 1', conc.svTop1Pct);
  html += miniBar('Top 3', conc.svTop3Pct);
  html += miniBar('Top 5', conc.svTop5Pct);
  if (conc.svHhi != null) html += '<div class="mini-stat">HHI: ' + fNum(conc.svHhi, 0) + ' <span class="hint">(>2500 = highly concentrated)</span></div>';
  html += '</div>';

  // Sponsor concentration
  html += '<div class="metrics-group"><div class="metrics-group-label">Validator Sponsors</div>';
  if (conc.sponsorTop3) {
    for (var s = 0; s < conc.sponsorTop3.length; s++) {
      var sp = conc.sponsorTop3[s];
      html += miniBar(sp.name.replace(/-/g, ' '), sp.pct);
    }
    html += '<div class="mini-stat">Top 3 cumulative: ' + fPct(conc.sponsorTop3Pct, 1) + '</div>';
  }
  html += '</div>';

  // Rewards concentration
  html += '<div class="metrics-group"><div class="metrics-group-label">App Rewards Distribution</div>';
  if (ra && ra.rewardsTop1Pct != null && ra.top1AppName) {
    html += '<div class="mini-stat">Top 1: ' + esc(ra.top1AppName) + ' (' + fPct(ra.rewardsTop1Pct, 1) + ')</div>';
  }
  html += miniBar('Top 3 apps', conc.rewardsTop3Pct);
  html += miniBar('Top 5 apps', conc.rewardsTop5Pct);
  if (ra) html += '<div class="mini-stat">' + fPct(ra.appRewardsShareOfMinting, 0) + ' of emissions go to apps</div>';
  html += '</div>';

  html += '</div></div>';

  // Tier 3: Recent Activity
  if (ra) {
    html += '<div class="card"><div class="tier-label">Recent Activity <span class="tier-sub">(' + ra.sampleSize + ' updates, ' + ra.timeWindowSeconds + 's window)</span></div>';
    html += '<div class="metrics">';
    html += metric('Minted', fNum(ra.totalMinted, 0) + ' CC');
    html += metric('Burned', fNum(ra.totalBurned, 0) + ' CC');
    html += metric('Transferred', fNum(ra.totalTransferred, 0) + ' CC');
    html += metric('Net Issuance', fNum(ra.netIssuance, 0) + ' CC', ra.netIssuance > 0 ? 'positive' : 'negative');
    html += '</div>';

    // Minting breakdown as proportion bar
    if (ra.totalMinted > 0) {
      html += '<div class="section-title">Minting Breakdown</div>';
      html += proportionBar([
        { label: 'App Rewards', value: ra.appRewardsMinted, color: 'var(--green)' },
        { label: 'SV Rewards', value: ra.svRewardsMinted, color: 'var(--accent)' },
        { label: 'Validator Liveness', value: ra.validatorLivenessRewardsMinted, color: 'var(--yellow)' },
      ], ra.totalMinted);
    }

    // Top apps
    if (ra.topApps && ra.topApps.length > 0) {
      html += '<div class="section-title">Top Apps by Rewards</div>';
      html += '<table class="data-table"><thead><tr><th>App / Party</th><th class="number">CC Rewards</th><th class="number">Share</th></tr></thead><tbody>';
      var totalRewards = ra.topApps.reduce(function (s, a) { return s + a.rewardsCC; }, 0);
      for (var t = 0; t < ra.topApps.length; t++) {
        var a = ra.topApps[t];
        html += '<tr><td>' + esc(a.name) + '</td><td class="number">' + fNum(a.rewardsCC, 0) + '</td><td class="number">' + fPct(totalRewards > 0 ? (a.rewardsCC / totalRewards) * 100 : 0, 1) + '</td></tr>';
      }
      html += '</tbody></table>';

      // App website links matched from registry
      if (registry && ra.topApps) {
        var links = [];
        ra.topApps.forEach(function(topApp) {
          for (var ri = 0; ri < registry.length; ri++) {
            var r = registry[ri];
            if (!r.websiteGuess) continue;
            var rBase = r.baseName.toLowerCase();
            var aName = topApp.name.toLowerCase();
            var rStripped = rBase.replace(/^feat-/, '');
            if (rBase === aName || rStripped === aName || aName.indexOf(rBase) !== -1 || rBase.indexOf(aName) !== -1) {
              var domain = '';
              try { domain = new URL(r.websiteGuess).hostname.replace('www.', ''); } catch(e) { domain = r.websiteGuess; }
              links.push({ name: topApp.name, url: r.websiteGuess, domain: domain });
              break;
            }
          }
        });
        if (links.length > 0) {
          html += '<div class="section-title">App Websites</div><div class="app-websites">';
          links.forEach(function(l) {
            html += '<a href="' + esc(l.url) + '" target="_blank" rel="noopener" class="app-website-link">' + esc(l.name) + ' \u2192 ' + esc(l.domain) + '</a>';
          });
          html += '</div>';
        }
      }
    }
    html += '</div>';
  }

  return html;
}

function renderConcentration(snap) {
  var c = snap.concentration;
  if (!c) return '';

  var html = '<div class="card concentration-panel"><div class="tier-label">Concentration Risk</div>';
  html += '<div class="concentration-grid">';

  html += concMetric('Largest SV Weight', c.svTop1Pct, 'of consensus weight', 40);
  html += concMetric('Largest Sponsor', c.sponsorTop1Pct, 'of validator licenses', 30);
  html += concMetric('Largest AMM Pool', c.tvlLargestPoolPct, 'of DEX TVL', 80);
  html += concMetric('Top 3 App Rewards', c.rewardsTop3Pct, 'of app emissions', 50);

  html += '</div></div>';
  return html;
}

function renderAppSection(snap) {
  var apps = (snap.apps || []).filter(function (a) { return a.id !== 'ccexplorer'; });
  if (apps.length === 0) return '';

  // Group by category
  var groups = {};
  for (var i = 0; i < apps.length; i++) {
    var cat = apps[i].appCategory || 'Other';
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(apps[i]);
  }

  var html = '<div class="section-header">Application Layer</div>';

  // Category overview
  html += '<div class="card"><div class="tier-label">Tracked Applications</div>';
  html += '<table class="data-table"><thead><tr><th>Category</th><th class="number">Apps</th><th>Transparency</th></tr></thead><tbody>';
  var catKeys = Object.keys(groups).sort();
  for (var c = 0; c < catKeys.length; c++) {
    var catApps = groups[catKeys[c]];
    var transCounts = { transparent: 0, partial: 0, opaque: 0 };
    for (var j = 0; j < catApps.length; j++) {
      var t = catApps[j].transparency || 'opaque';
      transCounts[t] = (transCounts[t] || 0) + 1;
    }
    var transLabels = [];
    if (transCounts.transparent > 0) transLabels.push(transCounts.transparent + ' transparent');
    if (transCounts.partial > 0) transLabels.push(transCounts.partial + ' partial');
    if (transCounts.opaque > 0) transLabels.push(transCounts.opaque + ' opaque');
    if (transCounts.none > 0) transLabels.push(transCounts.none + ' no data');
    html += '<tr><td>' + esc(catKeys[c]) + '</td><td class="number">' + catApps.length + '</td><td>' + transLabels.join(', ') + '</td></tr>';
  }
  html += '</tbody></table></div>';

  // Core tracked apps (non-candidate)
  var coreApps = apps.filter(function(a) { return !a.isCandidate; });
  var candidateApps = apps.filter(function(a) { return a.isCandidate; });

  for (var k = 0; k < coreApps.length; k++) {
    var app = coreApps[k];
    var card = '<div class="card">';
    if (app.dataAvailability === 'error') {
      card += renderErrorCard(app);
    } else if (app.id === 'tradecraft') {
      card += renderTradecraft(app);
    } else if (app.id === 'unhedged') {
      card += renderUnhedged(app);
    } else {
      card += renderLimitedCard(app);
    }
    card += '</div>';
    html += card;
  }

  // Candidate apps (auto-detected from registry probing)
  if (candidateApps.length > 0) {
    html += '<div class="section-title" style="margin-top:1.5rem">Candidate Apps (auto-detected from registry)</div>';
    for (var m = 0; m < candidateApps.length; m++) {
      html += '<div class="card">' + renderCandidateCard(candidateApps[m]) + '</div>';
    }
  }

  // Why note
  html += '<div class="card"><div class="tier-label">Why only a few apps have live metrics</div><div class="limited-info"><ul><li>Many Canton apps are institutional or not publicly consumer-facing</li><li>Most API endpoints require authentication (HTTP 401/403)</li><li>Some websites are informational-only with no queryable data</li><li>This tracker shows only apps with publicly accessible metric endpoints today</li></ul></div></div>';

  return html;
}

function renderGovernance(snap) {
  var ccx = findApp(snap, 'ccexplorer');
  var gov = ccx?.governance;
  if (!gov) return '';

  var html = '<div class="section-header">Governance</div>';
  html += '<div class="card">';

  // Governance summary metrics
  html += '<div class="metrics">';
  html += metric('Open Proposals', fNum(gov.openProposals));
  html += metric('Participation', gov.participationRate != null ? fPct(gov.participationRate * 100, 0) : '--');
  html += metric('Total Historical', gov.totalHistorical != null ? fNum(gov.totalHistorical) : '--');
  html += metric('Closed', gov.closedCount != null ? fNum(gov.closedCount) : '--');
  html += '</div>';

  // Open votes
  if (gov.votes && gov.votes.length > 0) {
    html += '<div class="section-title">Open Proposals</div>';
    html += '<table class="data-table"><thead><tr><th>Proposal</th><th class="number">Votes</th><th>Requester</th></tr></thead><tbody>';
    for (var g = 0; g < gov.votes.length; g++) {
      var v = gov.votes[g];
      var voteStr = v.yesVotes + '/' + v.totalVoters + ' yes';
      if (v.pendingVotes > 0) voteStr += ' (' + v.pendingVotes + ' pending)';
      var summaryHtml = v.url
        ? '<a href="' + esc(v.url) + '" target="_blank" rel="noopener" style="color:var(--accent)">' + esc(v.summary) + '</a>'
        : esc(v.summary);
      html += '<tr><td>' + summaryHtml + '</td><td class="number" style="white-space:nowrap">' + voteStr + '</td><td>' + esc((v.requester || '').replace(/-/g, ' ')) + '</td></tr>';
    }
    html += '</tbody></table>';
  }

  html += '</div>';
  return html;
}

function renderNetworkInfra(snap) {
  var ccx = findApp(snap, 'ccexplorer');
  if (!ccx || ccx.dataAvailability !== 'full') return '';

  var n = ccx.network || {};
  var html = '<div class="section-header">Network Infrastructure</div>';

  // Network overview row
  html += '<div class="card"><div class="metrics">';
  html += metric('Active Validators', fNum(n.activeValidators));
  html += metric('Super Validators', fNum(n.superValidators));
  html += metric('Total Supply', n.supply ? fNum(n.supply / 1e9, 1) + 'B CC' : '--');
  html += metric('Current Round', fNum(n.currentRound));
  html += metric('Version', n.version || '--');
  html += '</div>';

  // Super validators (top 5 + expand)
  var svs = ccx.superValidators || [];
  if (svs.length > 0) {
    html += '<div class="section-title">Super Validators (' + svs.length + ')</div>';
    html += '<table class="data-table"><thead><tr><th>Name</th><th class="number">Weight</th><th class="number">Share</th></tr></thead><tbody>';
    var svShown = Math.min(svs.length, 5);
    for (var i = 0; i < svShown; i++) {
      var sv = svs[i];
      var nameHtml = sv.url
        ? '<a href="' + esc(sv.url) + '" target="_blank" rel="noopener" style="color:var(--accent)">' + esc(sv.name.replace(/-/g, ' ')) + '</a>'
        : esc(sv.name.replace(/-/g, ' '));
      if (sv.desc) nameHtml += ' <span class="entity-desc">' + esc(sv.desc) + '</span>';
      html += '<tr><td>' + nameHtml + '</td><td class="number">' + fNum(sv.weight) + '</td><td class="number">' + fPct(sv.weightPct, 1) + '</td></tr>';
    }
    html += '</tbody></table>';
    if (svs.length > 5) {
      html += expandable('sv-full', 'Show all ' + svs.length + ' SVs',
        '<table class="data-table"><tbody>' +
        svs.slice(5).map(function (sv) {
          var nh = sv.url ? '<a href="' + esc(sv.url) + '" target="_blank" rel="noopener" style="color:var(--accent)">' + esc(sv.name.replace(/-/g, ' ')) + '</a>' : esc(sv.name.replace(/-/g, ' '));
          if (sv.desc) nh += ' <span class="entity-desc">' + esc(sv.desc) + '</span>';
          return '<tr><td>' + nh + '</td><td class="number">' + fNum(sv.weight) + '</td><td class="number">' + fPct(sv.weightPct, 1) + '</td></tr>';
        }).join('') +
        '</tbody></table>');
    }
  }

  // Sponsors (top 5 + expand)
  var vals = ccx.validators || {};
  var sponsors = Object.entries(vals.bySponsor || {});
  if (sponsors.length > 0) {
    html += '<div class="section-title">Validators by Sponsor (' + fNum(vals.total) + ' total licenses)</div>';
    html += '<table class="data-table"><thead><tr><th>Sponsor</th><th class="number">Count</th><th class="number">Share</th></tr></thead><tbody>';
    var spShown = Math.min(sponsors.length, 5);
    for (var j = 0; j < spShown; j++) {
      var spName = sponsors[j][0];
      var spCount = sponsors[j][1];
      html += '<tr><td>' + entityLink(spName) + '</td><td class="number">' + spCount + '</td><td class="number">' + fPct((spCount / vals.total) * 100, 1) + '</td></tr>';
    }
    html += '</tbody></table>';
    if (sponsors.length > 5) {
      html += expandable('sponsors-full', 'Show all ' + sponsors.length + ' sponsors',
        '<table class="data-table"><tbody>' +
        sponsors.slice(5).map(function (sp) {
          return '<tr><td>' + entityLink(sp[0]) + '</td><td class="number">' + sp[1] + '</td><td class="number">' + fPct((sp[1] / vals.total) * 100, 1) + '</td></tr>';
        }).join('') +
        '</tbody></table>');
    }
  }

  html += '</div>';
  return html;
}

// ===========================================================================
// App card renderers
// ===========================================================================

function appHeader(app) {
  var transpMap = {
    transparent: { cls: 'badge-full', label: 'Transparent' },
    partial: { cls: 'badge-partial', label: 'Partial' },
    opaque: { cls: 'badge-opaque', label: 'Opaque' },
    none: { cls: 'badge-opaque', label: 'No Data' },
  };
  var tr = transpMap[app.transparency] || transpMap.opaque;

  return (
    '<div class="card-header">' +
    '<div>' +
    '<div class="card-title"><a href="' + esc(app.url || '#') + '" target="_blank" rel="noopener">' + esc(app.name) + '</a></div>' +
    '<div class="card-category">' + esc(app.appCategory || '') + '</div>' +
    '</div>' +
    '<span class="badge ' + tr.cls + '">' + tr.label + '</span>' +
    '</div>'
  );
}

function renderTradecraft(app) {
  var html = appHeader(app);

  html += '<div class="metrics">';
  html += metric('Total TVL', fUsd(app.totalTvlUsd));
  html += metric('24h Volume', fUsd(app.totalVolume24hUsd));
  html += metric('7d Volume', fUsd(app.totalVolume7dUsd));
  html += metric('30d Volume', fUsd(app.totalVolume30dUsd));
  html += '</div>';

  html += '<div class="section-title">Pool Breakdown</div>';
  html += '<table class="data-table"><thead><tr><th>Pool</th><th class="number">TVL</th><th class="number">TVL %</th><th class="number">24h Vol</th><th class="number">24h Yield</th></tr></thead><tbody>';
  for (var i = 0; i < app.pools.length; i++) {
    var p = app.pools[i];
    var tvlPct = app.totalTvlUsd > 0 ? (p.tvlUsd / app.totalTvlUsd) * 100 : 0;
    html += '<tr><td>' + esc(p.name) + '</td><td class="number">' + fUsd(p.tvlUsd) + '</td><td class="number">' + fPct(tvlPct, 1) + '</td><td class="number">' + fUsd(p.volume['24h']) + '</td><td class="number">' + fPct(p.yield24h) + '</td></tr>';
  }
  html += '</tbody></table>';

  return html;
}

function renderUnhedged(app) {
  var html = appHeader(app);

  html += '<div class="metrics">';
  html += metric('Total Markets', fNum(app.totalMarkets));
  html += metric('Active', fNum(app.activeMarkets));
  html += metric('Resolved', fNum(app.resolvedMarkets));
  html += metric('Active Pool', fUsd(app.totalActivePoolUsd));
  html += '</div>';

  if (app.categories && Object.keys(app.categories).length > 0) {
    html += '<div class="section-title">Active Markets by Category</div>';
    html += '<table class="data-table"><thead><tr><th>Category</th><th class="number">Markets</th><th class="number">Pool</th><th class="number">Bets</th></tr></thead><tbody>';
    var cats = Object.entries(app.categories).sort(function (a, b) { return b[1].poolUsd - a[1].poolUsd; });
    for (var i = 0; i < cats.length; i++) {
      html += '<tr><td>' + esc(cats[i][0].charAt(0).toUpperCase() + cats[i][0].slice(1)) + '</td><td class="number">' + cats[i][1].count + '</td><td class="number">' + fUsd(cats[i][1].poolUsd) + '</td><td class="number">' + fNum(cats[i][1].bets) + '</td></tr>';
    }
    html += '</tbody></table>';
  }

  if (app.topMarkets && app.topMarkets.length > 0) {
    html += '<div class="section-title">Top Active Markets</div>';
    html += '<table class="data-table"><thead><tr><th>Market</th><th class="number">Pool</th><th class="number">Bets</th></tr></thead><tbody>';
    for (var j = 0; j < app.topMarkets.length; j++) {
      var m = app.topMarkets[j];
      var q = m.question.length > 55 ? m.question.slice(0, 52) + '...' : m.question;
      html += '<tr><td>' + esc(q) + '</td><td class="number">' + fUsd(m.totalPool) + '</td><td class="number">' + fNum(m.betCount) + '</td></tr>';
    }
    html += '</tbody></table>';
  }

  return html;
}

function renderLimitedCard(app) {
  var html = appHeader(app);
  html += '<div class="limited-info">';
  if (app.status) html += '<p><strong>Status:</strong> ' + esc(app.status) + '</p>';
  if (app.description) html += '<p>' + esc(app.description) + '</p>';
  if (app.metadata) {
    var parts = [];
    if (app.metadata.founded) parts.push('Founded: ' + app.metadata.founded);
    if (app.metadata.funding) parts.push('Funding: ' + app.metadata.funding);
    if (app.metadata.builder) parts.push('Builder: ' + app.metadata.builder);
    if (parts.length) html += '<p>' + esc(parts.join(' \u00b7 ')) + '</p>';
    if (app.metadata.pairs) {
      html += '<div class="tag-list">';
      for (var i = 0; i < app.metadata.pairs.length; i++) html += '<span class="tag">' + esc(app.metadata.pairs[i]) + '</span>';
      html += '</div>';
    }
    if (app.metadata.observation) html += '<p class="note" style="margin-top:0.5rem">' + esc(app.metadata.observation) + '</p>';
  }
  if (app.note) html += '<p class="note" style="margin-top:0.75rem">' + esc(app.note) + '</p>';
  html += '</div>';
  return html;
}

function renderErrorCard(app) {
  var html = appHeader(app);
  html += '<div class="limited-info"><p>Failed to fetch data: ' + esc(app.error || 'Unknown error') + '</p></div>';
  return html;
}

function renderCandidateCard(app) {
  var html = appHeader(app);
  html += '<div class="limited-info">';
  if (app.url) {
    var domain = '';
    try { domain = new URL(app.url).hostname.replace('www.', ''); } catch(e) { domain = app.url; }
    html += '<p><a href="' + esc(app.url) + '" target="_blank" rel="noopener" style="color:var(--accent)">' + esc(domain) + '</a></p>';
  }
  if (app.transparency === 'transparent' && app.probeEndpoint) {
    html += '<p><strong>Live API:</strong> <code>' + esc(app.probeEndpoint) + '</code></p>';
    if (app.probeData) {
      var keys = Object.keys(app.probeData).slice(0, 10);
      if (keys.length > 0) {
        html += '<div class="tag-list">';
        for (var i = 0; i < keys.length; i++) {
          var v = app.probeData[keys[i]];
          var vStr = typeof v === 'object' ? (v === null ? 'null' : '[object]') : String(v);
          if (vStr.length > 30) vStr = vStr.slice(0, 27) + '...';
          html += '<span class="tag">' + esc(keys[i]) + ': ' + esc(vStr) + '</span>';
        }
        html += '</div>';
      }
    }
  } else if (app.transparency === 'opaque') {
    html += '<p class="note">API requires authentication (HTTP 401/403)</p>';
  } else {
    html += '<p class="note">No public endpoints found</p>';
  }
  if (app.note) html += '<p class="note" style="margin-top:0.5rem">' + esc(app.note) + '</p>';
  html += '</div>';
  return html;
}

// ===========================================================================
// Shared helpers
// ===========================================================================

function findApp(snap, id) {
  return (snap.apps || []).find(function (a) { return a.id === id; });
}

function esc(str) {
  if (!str) return '';
  var d = document.createElement('div');
  d.textContent = String(str);
  return d.innerHTML;
}

function fUsd(n, dec) {
  if (n == null || isNaN(n)) return '--';
  if (dec === undefined) dec = 0;
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

function fNum(n, dec) {
  if (n == null || isNaN(n)) return '--';
  if (dec === undefined) dec = 0;
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

function fPct(n, dec) {
  if (n == null || isNaN(n)) return '--';
  if (dec === undefined) dec = 1;
  return Number(n).toFixed(dec) + '%';
}

function metric(label, value, extraClass) {
  return '<div class="metric' + (extraClass ? ' ' + extraClass : '') + '"><div class="metric-label">' + esc(label) + '</div><div class="metric-value">' + value + '</div></div>';
}

function miniBar(label, pct) {
  if (pct == null) return '';
  var color = pct > 50 ? 'var(--red)' : pct > 30 ? 'var(--yellow)' : 'var(--green)';
  return '<div class="mini-bar-row"><span class="mini-bar-label">' + esc(label) + '</span><div class="mini-bar-track"><div class="mini-bar-fill" style="width:' + Math.min(pct, 100) + '%;background:' + color + '"></div></div><span class="mini-bar-value">' + fPct(pct, 1) + '</span></div>';
}

function concMetric(title, pct, subtitle, threshold) {
  if (pct == null) return '';
  var color = pct > threshold ? 'var(--red)' : pct > threshold * 0.6 ? 'var(--yellow)' : 'var(--green)';
  return '<div class="conc-metric"><div class="conc-value" style="color:' + color + '">' + fPct(pct, 1) + '</div><div class="conc-title">' + esc(title) + '</div><div class="conc-sub">' + esc(subtitle) + '</div></div>';
}

function proportionBar(segments, total) {
  if (!total || total <= 0) return '';
  var html = '<div class="proportion-bar">';
  for (var i = 0; i < segments.length; i++) {
    var seg = segments[i];
    var pct = (seg.value / total) * 100;
    if (pct < 0.5) continue;
    html += '<div class="proportion-seg" style="width:' + pct.toFixed(1) + '%;background:' + seg.color + '" title="' + esc(seg.label) + ': ' + fPct(pct, 1) + '"></div>';
  }
  html += '</div><div class="proportion-legend">';
  for (var j = 0; j < segments.length; j++) {
    var s = segments[j];
    var p = (s.value / total) * 100;
    html += '<span class="proportion-item"><span class="proportion-dot" style="background:' + s.color + '"></span>' + esc(s.label) + ' ' + fPct(p, 0) + '</span>';
  }
  html += '</div>';
  return html;
}

function expandable(id, label, content) {
  return '<div style="margin-top:0.5rem"><button class="expand-toggle" data-target="' + id + '" data-label="' + esc(label) + '">' + esc(label) + '</button><div id="' + id + '" style="display:none">' + content + '</div></div>';
}

function entityLink(name) {
  var info = {
    'Global-Synchronizer-Foundation': { url: 'https://sync.global' },
    'Digital-Asset-1': { url: 'https://digitalasset.com' },
    'Digital-Asset-2': { url: 'https://digitalasset.com' },
    'Cumberland-1': { url: 'https://cumberland.io' },
    'Cumberland-2': { url: 'https://cumberland.io' },
    'Liberty-City-Ventures-1': { url: 'https://lcv.co' },
    'Proof-Group-1': { url: 'https://proofgroup.com' },
    'Tradeweb-Markets-1': { url: 'https://tradeweb.com' },
  };
  var display = name.replace(/-/g, ' ');
  var i = info[name];
  if (i && i.url) return '<a href="' + esc(i.url) + '" target="_blank" rel="noopener" style="color:var(--accent)">' + esc(display) + '</a>';
  return esc(display);
}

// ===========================================================================
// Registry renderer (CantonScan featured apps)
// ===========================================================================

function renderRegistry(registry) {
  if (!registry || registry.length === 0) return '';

  // Compute summary
  var cats = {};
  var withWebsite = 0;
  var lowConf = 0;
  for (var i = 0; i < registry.length; i++) {
    var cat = registry[i].category || 'Unknown';
    cats[cat] = (cats[cat] || 0) + 1;
    if (registry[i].websiteGuess) withWebsite++;
    if (registry[i].confidence < 50) lowConf++;
  }

  var html = '<div class="section-header">Featured Apps Registry <span class="tier-sub">(from CantonScan)</span></div>';

  // Summary counts
  html += '<div class="card"><div class="tier-label">Registry Summary</div>';
  html += '<div class="metrics">';
  html += metric('Total Apps', fNum(registry.length));
  html += metric('With Website', fNum(withWebsite));
  html += metric('Low Confidence', fNum(lowConf));
  html += metric('Categories', fNum(Object.keys(cats).length));
  html += '</div>';

  // Category breakdown as mini bars
  html += '<div class="section-title">Category Breakdown</div>';
  var catEntries = Object.entries(cats).sort(function (a, b) { return b[1] - a[1]; });
  for (var c = 0; c < catEntries.length; c++) {
    var pct = (catEntries[c][1] / registry.length) * 100;
    html += miniBar(catEntries[c][0] + ' (' + catEntries[c][1] + ')', pct);
  }
  html += '</div>';

  // Filters
  html += '<div class="card" id="registry-card">';
  html += '<div class="tier-label">All Featured Apps</div>';
  html += '<div class="registry-filters" style="display:flex;gap:0.75rem;flex-wrap:wrap;margin-bottom:1rem">';

  // Category filter
  html += '<select id="reg-cat-filter" class="reg-filter-select">';
  html += '<option value="all">All categories</option>';
  for (var f = 0; f < catEntries.length; f++) {
    html += '<option value="' + esc(catEntries[f][0]) + '">' + esc(catEntries[f][0]) + ' (' + catEntries[f][1] + ')</option>';
  }
  html += '</select>';

  // Confidence filter
  html += '<select id="reg-conf-filter" class="reg-filter-select">';
  html += '<option value="0">All confidence</option>';
  html += '<option value="50">50+ only</option>';
  html += '<option value="75">75+ only</option>';
  html += '</select>';

  html += '</div>';

  // Table
  html += '<div id="registry-table-wrap">';
  html += registryTable(registry);
  html += '</div>';

  html += '</div>';
  return html;
}

function registryTable(apps) {
  var html = '<table class="data-table"><thead><tr>';
  html += '<th>App Name</th><th>Base Name</th><th>Category</th><th class="number">Confidence</th><th>Website</th><th>Note</th>';
  html += '</tr></thead><tbody>';

  for (var i = 0; i < apps.length; i++) {
    var a = apps[i];
    var confClass = a.confidence >= 75 ? 'conf-high' : a.confidence >= 50 ? 'conf-mid' : 'conf-low';

    // App name
    var nameHtml = esc(a.appName);

    // Base name
    var baseHtml = '<span style="color:var(--text-secondary)">' + esc(a.baseName) + '</span>';

    // Category badge
    var catHtml = '<span class="tag">' + esc(a.category) + '</span>';

    // Confidence with color
    var confColor = a.confidence >= 75 ? 'var(--green)' : a.confidence >= 50 ? 'var(--yellow)' : 'var(--red)';
    var confHtml = '<span style="color:' + confColor + ';font-weight:600">' + a.confidence + '</span>';
    if (a.confidence < 50) confHtml += ' <span class="badge badge-opaque" style="font-size:0.65rem">low</span>';

    // Website
    var webHtml = '--';
    if (a.websiteGuess) {
      var domain = '';
      try { domain = new URL(a.websiteGuess).hostname.replace('www.', ''); } catch (e) { domain = a.websiteGuess; }
      webHtml = '<a href="' + esc(a.websiteGuess) + '" target="_blank" rel="noopener" style="color:var(--accent);font-size:0.8rem">' + esc(domain) + '</a>';
    }

    // Note
    var noteHtml = a.note ? '<span style="font-size:0.75rem;color:var(--text-secondary)">' + esc(a.note) + '</span>' : '';

    html += '<tr data-category="' + esc(a.category) + '" data-confidence="' + a.confidence + '">';
    html += '<td>' + nameHtml + '</td>';
    html += '<td>' + baseHtml + '</td>';
    html += '<td>' + catHtml + '</td>';
    html += '<td class="number">' + confHtml + '</td>';
    html += '<td>' + webHtml + '</td>';
    html += '<td>' + noteHtml + '</td>';
    html += '</tr>';
  }

  html += '</tbody></table>';
  return html;
}

function wireRegistryFilters(registry) {
  var catFilter = document.getElementById('reg-cat-filter');
  var confFilter = document.getElementById('reg-conf-filter');
  if (!catFilter || !confFilter) return;

  function applyFilters() {
    var selectedCat = catFilter.value;
    var minConf = parseInt(confFilter.value, 10);
    var rows = document.querySelectorAll('#registry-table-wrap tbody tr');

    var shown = 0;
    rows.forEach(function (row) {
      var cat = row.getAttribute('data-category');
      var conf = parseInt(row.getAttribute('data-confidence'), 10);
      var show = (selectedCat === 'all' || cat === selectedCat) && conf >= minConf;
      row.style.display = show ? '' : 'none';
      if (show) shown++;
    });

    // Update count in header
    var label = document.querySelector('#registry-card .tier-label');
    if (label) {
      label.textContent = 'All Featured Apps (' + shown + ' shown)';
    }
  }

  catFilter.addEventListener('change', applyFilters);
  confFilter.addEventListener('change', applyFilters);
}
