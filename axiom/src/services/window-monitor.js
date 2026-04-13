// Window Activity Monitor
// Polls all open windowed processes every 2 minutes.
// Fires onSuggestion({ exe, label, ramMB, inactiveMin, speech, all })
// when an idle high-RAM app is found.

const { exec }        = require('child_process');
const activityTracker = require('./activity-tracker.js');
const suggestionEngine = require('./suggestion-engine.js');

const POLL_MS          = 2 * 60 * 1000;   // check every 2 minutes
const SUGGESTION_GAP   = 10 * 60 * 1000;  // at most one suggestion per 10 min

let timer             = null;
let lastSuggestionAt  = 0;
let onSuggestionCb    = null;
let usageTrackerRef   = null;

// ── Get all visible windows + RAM via PowerShell ───────────────
function getOpenWindows() {
  return new Promise((resolve) => {
    // MainWindowHandle != 0  →  process has a visible window
    const cmd = [
      'powershell', '-NoProfile', '-WindowStyle', 'Hidden', '-Command',
      '"Get-Process | Where-Object { $_.MainWindowHandle -ne 0 } | ' +
      'Select-Object Name,@{N=\'RAM\';E={[math]::Round($_.WorkingSet64/1MB,1)}} | ' +
      'ConvertTo-Json -Compress"',
    ].join(' ');

    exec(cmd, { windowsHide: true, timeout: 8000 }, (err, stdout) => {
      if (err || !stdout.trim()) return resolve([]);
      try {
        const raw = JSON.parse(stdout.trim());
        const arr = Array.isArray(raw) ? raw : [raw];
        resolve(
          arr
            .filter(p => p && p.Name)
            .map(p => ({ exe: p.Name.toLowerCase(), ramMB: p.RAM || 0 }))
        );
      } catch {
        resolve([]);
      }
    });
  });
}

// ── Minutes since exe was last in the foreground ───────────────
function minutesSinceLastSeen(exe) {
  if (!usageTrackerRef) return 999;
  const ts = usageTrackerRef.getLastSeenTime(exe);
  if (!ts) return 999;
  return Math.round((Date.now() - ts) / 60000);
}

// ── Main check cycle ───────────────────────────────────────────
async function check() {
  if (Date.now() - lastSuggestionAt < SUGGESTION_GAP) return;

  const windows = await getOpenWindows();
  if (!windows.length) return;

  const suggestion = suggestionEngine.getSuggestion(windows, minutesSinceLastSeen);
  if (!suggestion) return;

  lastSuggestionAt = Date.now();
  activityTracker.recordSuggested(suggestion.exe);

  console.log(`[AXIOM window-monitor] suggesting close: ${suggestion.exe} (${suggestion.ramMB} MB, ${suggestion.inactiveMin} min idle)`);
  if (onSuggestionCb) onSuggestionCb(suggestion);
}

// ── Public API ─────────────────────────────────────────────────

function start(onSuggestion, usageTracker) {
  activityTracker.load();
  onSuggestionCb  = onSuggestion;
  usageTrackerRef = usageTracker;

  // Delay first check by 5 min so AXIOM isn't noisy right at startup
  setTimeout(() => {
    check();
    timer = setInterval(check, POLL_MS);
  }, 5 * 60 * 1000);

  console.log('[AXIOM window-monitor] started — first check in 5 min');
}

function stop() {
  if (timer) { clearInterval(timer); timer = null; }
}

// Force an immediate check (useful for testing)
function forceCheck() { return check(); }

module.exports = { start, stop, forceCheck, getOpenWindows };
