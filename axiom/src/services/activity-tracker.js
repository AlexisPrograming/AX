// Tracks user decisions about window-close suggestions.
// Persists per-app data + user-defined protection list.

const path = require('path');
const os   = require('os');
const fs   = require('fs');

const DATA_FILE = path.join(os.homedir(), 'Documents', 'AXIOM', 'window-activity.json');

// ── Built-in critical app patterns — NEVER suggest closing ─────
const CRITICAL_PATTERNS = [
  /fan/i, /temp(mon)?/i, /hwinfo/i, /afterburner/i, /speedfan/i, /rivatuner/i,
  /antivirus/i, /defender/i, /malware/i, /firewall/i, /kaspersky/i, /avast/i,
  /avg(ui)?/i, /bitdefender/i, /norton/i,
  /driver/i, /audiodg/i, /dwm/i, /winlogon/i, /lsass/i, /csrss/i, /svchost/i,
  /corsair/i, /logitech/i, /razer/i, /steelseries/i, /ghub/i, /synapse/i,
  /armourychrate/i, /icue/i, /nvcontainer/i, /nvdisplay/i,
];

const CRITICAL_EXES = new Set([
  'taskmgr', 'regedit', 'devmgmt', 'services', 'mmc',
  'fancontrol', 'hwinfo64', 'hwinfo32', 'msiafterburner', 'rtss',
  'msmpeng', 'msseces', 'securityhealthsystray',
  'electron', 'code', 'cursor',  // never close IDE or AXIOM itself
  'explorer',                     // Windows shell
]);

let data = null;
// data.apps[exe] = { protected, suggestionCount, acceptCount, rejectCount, lastSuggested }

function load() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    }
  } catch {}
  if (!data || typeof data.apps !== 'object') data = { apps: {} };
}

function save() {
  try {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error('[AXIOM activity-tracker] save failed:', err.message);
  }
}

function getApp(exe) {
  if (!data) load();
  const key = exe.toLowerCase();
  if (!data.apps[key]) {
    data.apps[key] = {
      protected:       false,
      suggestionCount: 0,
      acceptCount:     0,
      rejectCount:     0,
      lastSuggested:   0,
    };
  }
  return data.apps[key];
}

function isCritical(exe) {
  const key = exe.toLowerCase();
  if (CRITICAL_EXES.has(key)) return true;
  return CRITICAL_PATTERNS.some(p => p.test(key));
}

function isProtected(exe) {
  if (isCritical(exe)) return true;
  if (!data) return false;
  return getApp(exe).protected;
}

function protect(exe) {
  getApp(exe).protected = true;
  save();
}

function unprotect(exe) {
  getApp(exe).protected = false;
  save();
}

function recordSuggested(exe) {
  const app = getApp(exe);
  app.suggestionCount++;
  app.lastSuggested = Date.now();
  save();
}

function recordDecision(exe, accepted) {
  const app = getApp(exe);
  if (accepted) app.acceptCount++;
  else          app.rejectCount++;

  // Auto-protect on first rejection — one "no" = never ask again
  if (!accepted) {
    app.protected = true;
    console.log(`[AXIOM activity-tracker] auto-protected ${exe} after rejection`);
  }
  save();
}

// Returns 0–1, or -1 if no history yet
function getAcceptanceRate(exe) {
  const app = getApp(exe);
  const total = app.acceptCount + app.rejectCount;
  if (total === 0) return -1;
  return app.acceptCount / total;
}

function getStats(exe) {
  return data ? getApp(exe) : null;
}

module.exports = {
  load, save, isProtected, isCritical,
  protect, unprotect,
  recordSuggested, recordDecision,
  getAcceptanceRate, getStats,
};
