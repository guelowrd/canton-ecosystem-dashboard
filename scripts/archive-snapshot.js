#!/usr/bin/env node
// archive-snapshot.js — archive current snapshot.json into data/history/

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SNAPSHOT_PATH = path.join(ROOT, 'data', 'snapshot.json');
const HISTORY_DIR = path.join(ROOT, 'data', 'history');
const MANIFEST_PATH = path.join(HISTORY_DIR, 'manifest.json');
const MAX_SNAPSHOTS = 10;

// Read current snapshot
if (!fs.existsSync(SNAPSHOT_PATH)) {
  console.error('No snapshot.json found at', SNAPSHOT_PATH);
  process.exit(1);
}

const snap = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8'));
const lastUpdated = snap.lastUpdated || new Date().toISOString();

// Generate filename from lastUpdated timestamp
const d = new Date(lastUpdated);
const yyyy = d.getUTCFullYear();
const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
const dd = String(d.getUTCDate()).padStart(2, '0');
const hh = String(d.getUTCHours()).padStart(2, '0');
const min = String(d.getUTCMinutes()).padStart(2, '0');
const filename = `snapshot-${yyyy}-${mm}-${dd}_${hh}${min}.json`;
const destPath = path.join(HISTORY_DIR, filename);

// Ensure history dir exists
if (!fs.existsSync(HISTORY_DIR)) {
  fs.mkdirSync(HISTORY_DIR, { recursive: true });
}

// Load existing manifest
let manifest = [];
if (fs.existsSync(MANIFEST_PATH)) {
  try {
    manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  } catch (e) {
    console.warn('Could not parse existing manifest, starting fresh:', e.message);
    manifest = [];
  }
}

// Diff against previous snapshot
let signals = { newApps: [], newData: [] };
if (manifest.length > 0) {
  const prevEntry = manifest[0];
  if (prevEntry.file && fs.existsSync(path.join(HISTORY_DIR, prevEntry.file))) {
    try {
      const prevSnap = JSON.parse(fs.readFileSync(path.join(HISTORY_DIR, prevEntry.file), 'utf8'));

      // Build previous app ID set
      const prevAppIds = new Set((prevSnap.apps || []).map(a => a.id));

      // New apps: present in current but not previous (excluding ccexplorer)
      (snap.apps || []).forEach(function(a) {
        if (a.id !== 'ccexplorer' && !prevAppIds.has(a.id)) {
          const displayName = a.name || a.id;
          signals.newApps.push(displayName);
        }
      });

      // New data: transparency changed from 'none' to 'transparent' or 'opaque'
      const prevById = {};
      (prevSnap.apps || []).forEach(function(a) { prevById[a.id] = a; });

      (snap.apps || []).forEach(function(a) {
        if (a.id === 'ccexplorer') return;
        const prev = prevById[a.id];
        if (prev && prev.transparency === 'none' && (a.transparency === 'transparent' || a.transparency === 'opaque')) {
          signals.newData.push({ app: a.name || a.id, from: prev.transparency, to: a.transparency });
        }
      });
    } catch (e) {
      console.warn('Could not load previous snapshot for diff:', e.message);
    }
  }
}

// Extract lightweight manifest entry
const nh = snap.networkHealth || {};
const conc = snap.concentration || {};
const ccx = (snap.apps || []).find(function(a) { return a.id === 'ccexplorer'; });
const ra = ccx && ccx.recentActivity;
const n = ccx && ccx.network;

let topApp = null;
if (ra && ra.topApps && ra.topApps.length > 0) {
  const t = ra.topApps[0];
  // Normalize top app name
  const NAME_MAP = {
    'cantonloop-mainnet-1': 'CantonLoop', 'cantonloop': 'CantonLoop',
    'tradecraft': 'Tradecraft', 'unhedged': 'Unhedged', 'unhedged-app': 'Unhedged',
    'temple-mainnet-1': 'Temple', 'cantex-validator-1': 'Cantex',
  };
  const lc = (t.name || '').toLowerCase();
  const displayName = NAME_MAP[lc] || t.name;
  topApp = { name: displayName, rewardsCC: t.rewardsCC };
}

const entry = {
  file: filename,
  lastUpdated: lastUpdated,
  tvlUsd: nh.totalTvlUsd || null,
  ccPriceUsd: snap.cantonCoinPriceUsd || null,
  topApp: topApp,
  appRewardsShareOfMinting: ra ? ra.appRewardsShareOfMinting : null,
  activeValidators: n ? n.activeValidators : null,
  signals: signals,
};

// Copy full snapshot to history
fs.copyFileSync(SNAPSHOT_PATH, destPath);
console.log(`Archived snapshot → ${filename}`);

// Prepend new entry and trim to MAX_SNAPSHOTS
manifest.unshift(entry);
if (manifest.length > MAX_SNAPSHOTS) {
  const removed = manifest.splice(MAX_SNAPSHOTS);
  // Delete orphaned snapshot files
  removed.forEach(function(old) {
    const oldPath = path.join(HISTORY_DIR, old.file);
    if (fs.existsSync(oldPath)) {
      fs.unlinkSync(oldPath);
      console.log(`Deleted old snapshot: ${old.file}`);
    }
  });
}

// Write manifest
fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
console.log(`Manifest updated: ${manifest.length} snapshot(s)`);
if (signals.newApps.length > 0) console.log(`  New apps: ${signals.newApps.join(', ')}`);
if (signals.newData.length > 0) console.log(`  New data: ${signals.newData.map(d => d.app).join(', ')}`);
