// Generates smart window-close suggestions.
// Pure calculation — no I/O, no timers.

const activityTracker = require('./activity-tracker.js');

const INACTIVITY_MIN   = 20;   // minutes before a window is "inactive"
const RAM_MIN_MB       = 80;   // only care about apps using this much RAM+
const LOW_PRIORITY_EXE = new Set([
  'searchhost', 'shellexperiencehost', 'sihost', 'runtimebroker',
  'startmenuexperiencehost', 'textinputhost', 'applicationframehost',
  'systemsettings', 'backgroundtaskhost',
]);

const EXE_LABELS = {
  chrome: 'Chrome', firefox: 'Firefox', msedge: 'Edge', opera: 'Opera', brave: 'Brave',
  spotify: 'Spotify', discord: 'Discord', slack: 'Slack', teams: 'Teams', zoom: 'Zoom',
  whatsapp: 'WhatsApp', telegram: 'Telegram', signal: 'Signal',
  steam: 'Steam', epicgameslauncher: 'Epic Games', 'battle.net': 'Battle.net',
  obs64: 'OBS Studio', obs32: 'OBS Studio', vlc: 'VLC', potplayer64: 'PotPlayer',
  photoshop: 'Photoshop', blender: 'Blender', figma: 'Figma',
  notepad: 'Notepad', wordpad: 'WordPad', winword: 'Word', excel: 'Excel',
  winrar: 'WinRAR', '7zfm': '7-Zip',
  msedgewebview2: 'Edge WebView',
};

function toLabel(exe) {
  const key = exe.toLowerCase();
  if (EXE_LABELS[key]) return EXE_LABELS[key];
  // Capitalize first letter as fallback
  return exe.charAt(0).toUpperCase() + exe.slice(1);
}

/**
 * openWindows         : [{ exe, ramMB }]  — from window-monitor.getOpenWindows()
 * lastSeenFn          : (exe) => minutes_since_last_foreground  — from usage-tracker
 * currentForegroundExe: string|null — currently active exe; never suggest it
 * Returns a suggestion object or null.
 */
function getSuggestion(openWindows, lastSeenFn, currentForegroundExe) {
  const activeFg = currentForegroundExe ? currentForegroundExe.toLowerCase() : null;
  const candidates = [];

  for (const win of openWindows) {
    const exe = win.exe.toLowerCase();

    if (activeFg && exe === activeFg)     continue;  // user is actively using it right now
    if (activityTracker.isProtected(exe)) continue;
    if (LOW_PRIORITY_EXE.has(exe))        continue;
    if (win.ramMB < RAM_MIN_MB)           continue;

    const inactiveMin = lastSeenFn(exe);
    if (inactiveMin < INACTIVITY_MIN)     continue;

    // Skip if user has rejected this app enough times to auto-protect
    // (auto-protect is already handled in recordDecision, this is a safety check)
    const rate = activityTracker.getAcceptanceRate(exe);
    if (rate !== -1 && rate < 0.2)        continue;

    candidates.push({
      exe,
      label:       toLabel(exe),
      inactiveMin,
      ramMB:       win.ramMB,
    });
  }

  if (!candidates.length) return null;

  // Prioritise highest RAM consumer
  candidates.sort((a, b) => b.ramMB - a.ramMB);
  const top = candidates[0];

  return {
    exe:        top.exe,
    label:      top.label,
    inactiveMin: top.inactiveMin,
    ramMB:      top.ramMB,
    all:        candidates,
    speech:     buildSpeech(top, candidates),
  };
}

function buildSpeech(top, all) {
  const timeStr = top.inactiveMin >= 60
    ? `${Math.round(top.inactiveMin / 60)} hour${top.inactiveMin >= 120 ? 's' : ''}`
    : `${top.inactiveMin} minutes`;

  if (all.length >= 3) {
    const names  = all.slice(0, 3).map(a => a.label).join(', ');
    const totalMB = all.reduce((s, a) => s + a.ramMB, 0);
    return `Hey, you've got ${all.length} apps sitting idle — ${names} — using about ${totalMB} MB combined. Want me to close them all?`;
  }

  return `${top.label} hasn't been used in ${timeStr} and is eating ${top.ramMB} MB of RAM. Want me to close it?`;
}

module.exports = { getSuggestion, toLabel, INACTIVITY_MIN, RAM_MIN_MB };
