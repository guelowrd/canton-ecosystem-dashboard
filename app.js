// app.js -- Renders the Canton Ecosystem Dashboard from data/snapshot.json

(async function () {
  const dashboard = document.getElementById('dashboard');
  const timestampEl = document.getElementById('timestamp');

  let snapshot;
  try {
    const res = await fetch('data/snapshot.json');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    snapshot = await res.json();
  } catch (err) {
    dashboard.innerHTML =
      '<div class="card"><p>Failed to load data: ' +
      escapeHtml(err.message) +
      '</p><p>Run <code>node scripts/fetch-data.js</code> to generate the snapshot.</p></div>';
    return;
  }

  // Header: timestamp + CC price
  const date = new Date(snapshot.lastUpdated);
  timestampEl.textContent =
    'Last updated: ' +
    date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) +
    ' at ' +
    date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });

  if (snapshot.cantonCoinPriceUsd) {
    const priceEl = document.createElement('p');
    priceEl.className = 'timestamp';
    priceEl.textContent = 'Canton Coin (CC): $' + snapshot.cantonCoinPriceUsd.toFixed(4);
    timestampEl.after(priceEl);
  }

  // Render each app card
  for (const app of snapshot.apps) {
    const card = document.createElement('div');
    card.className = 'card';

    if (app.dataAvailability === 'error') {
      card.innerHTML = renderErrorCard(app);
    } else if (app.id === 'ccexplorer') {
      card.innerHTML = renderCCExplorer(app);
    } else if (app.id === 'tradecraft') {
      card.innerHTML = renderTradecraft(app);
    } else if (app.id === 'unhedged') {
      card.innerHTML = renderUnhedged(app);
    } else {
      card.innerHTML = renderLimitedCard(app);
    }

    dashboard.appendChild(card);
  }
})();

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function renderCardHeader(app) {
  var badgeMap = { full: 'badge-full', limited: 'badge-limited', error: 'badge-error' };
  var labelMap = { full: 'Full API', limited: 'Limited', error: 'Error' };
  var cls = badgeMap[app.dataAvailability] || 'badge-limited';
  var label = labelMap[app.dataAvailability] || app.dataAvailability;

  return (
    '<div class="card-header">' +
    '<div>' +
    '<div class="card-title"><a href="' + escapeHtml(app.url || '#') + '" target="_blank" rel="noopener">' + escapeHtml(app.name) + '</a></div>' +
    '<div class="card-category">' + escapeHtml(app.category || '') + '</div>' +
    '</div>' +
    '<span class="badge ' + cls + '">' + label + '</span>' +
    '</div>'
  );
}

function fmtUsd(n, decimals) {
  if (n == null || isNaN(n)) return '--';
  if (decimals === undefined) decimals = 0;
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtNum(n, decimals) {
  if (n == null || isNaN(n)) return '--';
  if (decimals === undefined) decimals = 0;
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtPct(n, decimals) {
  if (n == null || isNaN(n)) return '--';
  if (decimals === undefined) decimals = 2;
  return Number(n).toFixed(decimals) + '%';
}

function escapeHtml(str) {
  var d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

// ---------------------------------------------------------------------------
// CC Explorer / Network Stats card
// ---------------------------------------------------------------------------

function renderCCExplorer(app) {
  var html = renderCardHeader(app);
  var n = app.network || {};

  // Top metrics
  html +=
    '<div class="metrics">' +
    metric('Validators', fmtNum(n.activeValidators) + (n.superValidators ? ' <span style="font-size:0.7em;color:var(--text-secondary)">(' + n.superValidators + ' SVs)</span>' : '')) +
    metric('Total Supply', n.supply ? fmtNum(n.supply / 1e9, 1) + 'B CC' : '--') +
    metric('Featured Apps', fmtNum(n.featuredApps)) +
    metric('Current Round', fmtNum(n.currentRound)) +
    '</div>';

  // Recent activity snapshot
  var ra = app.recentActivity;
  if (ra) {
    html += '<div class="section-title">Recent Activity Snapshot <span style="font-weight:400;font-size:0.75rem;text-transform:none">(' + ra.sampleSize + ' updates, ' + ra.timeWindowSeconds + 's window)</span></div>';
    html +=
      '<div class="metrics">' +
      metric('Minted', fmtNum(ra.totalMinted, 0) + ' CC') +
      metric('Transferred', fmtNum(ra.totalTransferred, 0) + ' CC') +
      metric('Burned', fmtNum(ra.totalBurned, 0) + ' CC') +
      metric('Amulet Price', ra.amuletPrice ? '$' + ra.amuletPrice.toFixed(4) : '--') +
      '</div>';

    // Minting breakdown
    if (ra.totalMinted > 0) {
      html += '<div class="section-title">Minting Breakdown</div>';
      html +=
        '<table class="data-table"><thead><tr>' +
        '<th>Category</th><th class="number">CC Minted</th><th class="number">Share</th>' +
        '</tr></thead><tbody>';
      var mintRows = [
        ['App Rewards', ra.appRewardsMinted],
        ['Validator Liveness', ra.validatorLivenessRewardsMinted],
        ['SV Rewards', ra.svRewardsMinted],
      ];
      for (var i = 0; i < mintRows.length; i++) {
        var pct = ra.totalMinted > 0 ? (mintRows[i][1] / ra.totalMinted) * 100 : 0;
        html +=
          '<tr><td>' + mintRows[i][0] + '</td>' +
          '<td class="number">' + fmtNum(mintRows[i][1], 0) + '</td>' +
          '<td class="number">' + fmtPct(pct, 1) + '</td></tr>';
      }
      html += '</tbody></table>';
    }

    // Top apps by rewards
    if (ra.topApps && ra.topApps.length > 0) {
      html += '<div class="section-title">Top Apps by Rewards</div>';
      html +=
        '<table class="data-table"><thead><tr>' +
        '<th>App / Party</th><th class="number">CC Rewards</th>' +
        '</tr></thead><tbody>';
      for (var j = 0; j < ra.topApps.length; j++) {
        var a = ra.topApps[j];
        html +=
          '<tr><td>' + escapeHtml(a.name) + '</td>' +
          '<td class="number">' + fmtNum(a.rewardsCC, 0) + '</td></tr>';
      }
      html += '</tbody></table>';
    }
  }

  // Super validators
  if (app.superValidators && app.superValidators.length > 0) {
    html += '<div class="section-title">Super Validators (' + app.superValidators.length + ')</div>';
    html +=
      '<table class="data-table"><thead><tr>' +
      '<th>Name</th><th class="number">Weight</th><th class="number">Share</th>' +
      '</tr></thead><tbody>';
    for (var k = 0; k < app.superValidators.length; k++) {
      var sv = app.superValidators[k];
      html +=
        '<tr><td>' + escapeHtml(sv.name.replace(/-/g, ' ')) + '</td>' +
        '<td class="number">' + fmtNum(sv.weight) + '</td>' +
        '<td class="number">' + fmtPct(sv.weightPct, 1) + '</td></tr>';
    }
    html += '</tbody></table>';
  }

  // Validator distribution
  var vals = app.validators;
  if (vals && vals.total > 0) {
    // Sponsor table
    html += '<div class="section-title">Validators by Sponsor (' + fmtNum(vals.total) + ' total licenses)</div>';
    html +=
      '<table class="data-table"><thead><tr>' +
      '<th>Sponsor</th><th class="number">Count</th><th class="number">Share</th>' +
      '</tr></thead><tbody>';
    var sponsors = Object.entries(vals.bySponsor);
    for (var s = 0; s < sponsors.length; s++) {
      html +=
        '<tr><td>' + escapeHtml(sponsors[s][0].replace(/-/g, ' ')) + '</td>' +
        '<td class="number">' + sponsors[s][1] + '</td>' +
        '<td class="number">' + fmtPct((sponsors[s][1] / vals.total) * 100, 1) + '</td></tr>';
    }
    html += '</tbody></table>';

    // Version table
    html += '<div class="section-title">Validators by Version</div>';
    html +=
      '<table class="data-table"><thead><tr>' +
      '<th>Version</th><th class="number">Count</th><th class="number">Share</th>' +
      '</tr></thead><tbody>';
    var versions = Object.entries(vals.byVersion);
    for (var v = 0; v < versions.length; v++) {
      html +=
        '<tr><td>' + escapeHtml(versions[v][0]) + '</td>' +
        '<td class="number">' + versions[v][1] + '</td>' +
        '<td class="number">' + fmtPct((versions[v][1] / vals.total) * 100, 1) + '</td></tr>';
    }
    html += '</tbody></table>';
  }

  // Governance
  if (app.governance && app.governance.inProgressCount > 0) {
    html += '<div class="section-title">Open Governance Votes (' + app.governance.inProgressCount + ')</div>';
    html +=
      '<table class="data-table"><thead><tr>' +
      '<th>Proposal</th><th class="number">Votes</th><th>Requester</th>' +
      '</tr></thead><tbody>';
    for (var g = 0; g < app.governance.votes.length; g++) {
      var vote = app.governance.votes[g];
      var text = vote.summary;
      var voteCell = vote.yesVotes + '/' + vote.totalVoters + ' yes';
      if (vote.pendingVotes > 0) voteCell += ' (' + vote.pendingVotes + ' pending)';
      var summaryHtml = vote.url
        ? '<a href="' + escapeHtml(vote.url) + '" target="_blank" rel="noopener" style="color:var(--accent)">' + escapeHtml(text) + '</a>'
        : escapeHtml(text);
      html +=
        '<tr><td>' + summaryHtml + '</td>' +
        '<td class="number">' + voteCell + '</td>' +
        '<td>' + escapeHtml((vote.requester || '').replace(/-/g, ' ')) + '</td></tr>';
    }
    html += '</tbody></table>';
  }

  return html;
}

// ---------------------------------------------------------------------------
// Tradecraft card
// ---------------------------------------------------------------------------

function renderTradecraft(app) {
  var html = renderCardHeader(app);

  // Top metrics
  html +=
    '<div class="metrics">' +
    metric('Total TVL', fmtUsd(app.totalTvlUsd)) +
    metric('24h Volume', fmtUsd(app.totalVolume24hUsd)) +
    metric('7d Volume', fmtUsd(app.totalVolume7dUsd)) +
    metric('30d Volume', fmtUsd(app.totalVolume30dUsd)) +
    '</div>';

  // Pool breakdown
  html += '<div class="section-title">Pool Breakdown</div>';
  html +=
    '<table class="data-table"><thead><tr>' +
    '<th>Pool</th><th class="number">TVL</th><th class="number">24h Vol</th>' +
    '<th class="number">24h Yield</th><th class="number">LP Fee</th>' +
    '</tr></thead><tbody>';

  for (var i = 0; i < app.pools.length; i++) {
    var p = app.pools[i];
    html +=
      '<tr>' +
      '<td>' + escapeHtml(p.name) + '</td>' +
      '<td class="number">' + fmtUsd(p.tvlUsd) + '</td>' +
      '<td class="number">' + fmtUsd(p.volume['24h']) + '</td>' +
      '<td class="number">' + fmtPct(p.yield24h) + '</td>' +
      '<td class="number">' + fmtPct(p.lpFeePercent, 1) + '</td>' +
      '</tr>';
  }
  html += '</tbody></table>';

  // Token holdings
  html += '<div class="section-title">Token Holdings</div>';
  html +=
    '<table class="data-table"><thead><tr>' +
    '<th>Pool</th><th class="number">Token 1</th><th class="number">Token 2</th>' +
    '<th class="number">LP Tokens</th>' +
    '</tr></thead><tbody>';

  for (var j = 0; j < app.pools.length; j++) {
    var q = app.pools[j];
    var t2dec = q.token2 === 'CBTC' ? 4 : 2;
    html +=
      '<tr>' +
      '<td>' + escapeHtml(q.name) + '</td>' +
      '<td class="number">' + fmtNum(q.token1Holdings) + ' ' + escapeHtml(q.token1) + '</td>' +
      '<td class="number">' + fmtNum(q.token2Holdings, t2dec) + ' ' + escapeHtml(q.token2) + '</td>' +
      '<td class="number">' + fmtNum(q.totalLpTokens, 2) + '</td>' +
      '</tr>';
  }
  html += '</tbody></table>';

  return html;
}

// ---------------------------------------------------------------------------
// Unhedged card
// ---------------------------------------------------------------------------

function renderUnhedged(app) {
  var html = renderCardHeader(app);

  html +=
    '<div class="metrics">' +
    metric('Total Markets', fmtNum(app.totalMarkets)) +
    metric('Active', fmtNum(app.activeMarkets)) +
    metric('Resolved', fmtNum(app.resolvedMarkets)) +
    metric('Active Pool', fmtUsd(app.totalActivePoolUsd)) +
    '</div>';

  // Category breakdown
  if (app.categories && Object.keys(app.categories).length > 0) {
    html += '<div class="section-title">Active Markets by Category</div>';
    html +=
      '<table class="data-table"><thead><tr>' +
      '<th>Category</th><th class="number">Markets</th><th class="number">Pool</th><th class="number">Bets</th>' +
      '</tr></thead><tbody>';

    var cats = Object.entries(app.categories).sort(function (a, b) { return b[1].poolUsd - a[1].poolUsd; });
    for (var i = 0; i < cats.length; i++) {
      var cat = cats[i][0];
      var d = cats[i][1];
      html +=
        '<tr>' +
        '<td>' + escapeHtml(cat.charAt(0).toUpperCase() + cat.slice(1)) + '</td>' +
        '<td class="number">' + d.count + '</td>' +
        '<td class="number">' + fmtUsd(d.poolUsd) + '</td>' +
        '<td class="number">' + fmtNum(d.bets) + '</td>' +
        '</tr>';
    }
    html += '</tbody></table>';
  }

  // Top active markets
  if (app.topMarkets && app.topMarkets.length > 0) {
    html += '<div class="section-title">Top Active Markets</div>';
    html +=
      '<table class="data-table"><thead><tr>' +
      '<th>Market</th><th class="number">Pool</th><th class="number">Bets</th>' +
      '</tr></thead><tbody>';

    for (var j = 0; j < app.topMarkets.length; j++) {
      var m = app.topMarkets[j];
      var q = m.question.length > 65 ? m.question.slice(0, 62) + '...' : m.question;
      html +=
        '<tr>' +
        '<td>' + escapeHtml(q) + '</td>' +
        '<td class="number">' + fmtUsd(m.totalPool) + '</td>' +
        '<td class="number">' + fmtNum(m.betCount) + '</td>' +
        '</tr>';
    }
    html += '</tbody></table>';
  }

  return html;
}

// ---------------------------------------------------------------------------
// Limited-data card
// ---------------------------------------------------------------------------

function renderLimitedCard(app) {
  var html = renderCardHeader(app);
  html += '<div class="limited-info">';

  if (app.status) {
    html += '<p><strong>Status:</strong> ' + escapeHtml(app.status) + '</p>';
  }
  if (app.description) {
    html += '<p>' + escapeHtml(app.description) + '</p>';
  }
  if (app.metadata) {
    var parts = [];
    if (app.metadata.founded) parts.push('Founded: ' + app.metadata.founded);
    if (app.metadata.funding) parts.push('Funding: ' + app.metadata.funding);
    if (app.metadata.builder) parts.push('Builder: ' + app.metadata.builder);
    if (parts.length) html += '<p>' + escapeHtml(parts.join(' \u00b7 ')) + '</p>';

    if (app.metadata.pairs) {
      html += '<div class="tag-list">';
      for (var i = 0; i < app.metadata.pairs.length; i++) {
        html += '<span class="tag">' + escapeHtml(app.metadata.pairs[i]) + '</span>';
      }
      html += '</div>';
    }
    if (app.metadata.features) {
      html += '<div class="tag-list" style="margin-top:0.5rem">';
      for (var j = 0; j < app.metadata.features.length; j++) {
        html += '<span class="tag">' + escapeHtml(app.metadata.features[j]) + '</span>';
      }
      html += '</div>';
    }
    if (app.metadata.observation) {
      html += '<p class="note" style="margin-top:0.5rem">' + escapeHtml(app.metadata.observation) + '</p>';
    }
  }
  if (app.note) {
    html += '<p class="note" style="margin-top:0.75rem">' + escapeHtml(app.note) + '</p>';
  }

  html += '</div>';
  return html;
}

// ---------------------------------------------------------------------------
// Error card
// ---------------------------------------------------------------------------

function renderErrorCard(app) {
  var html = renderCardHeader(app);
  html += '<div class="limited-info"><p>Failed to fetch data: ' + escapeHtml(app.error || 'Unknown error') + '</p></div>';
  return html;
}

// ---------------------------------------------------------------------------
// Tiny helpers
// ---------------------------------------------------------------------------

function metric(label, value) {
  return (
    '<div class="metric">' +
    '<div class="metric-label">' + escapeHtml(label) + '</div>' +
    '<div class="metric-value">' + value + '</div>' +
    '</div>'
  );
}
