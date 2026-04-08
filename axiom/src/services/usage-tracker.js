// Usage tracker — records active window/app every 60 s.
// Exposes getTopApps() and getTopUrls() for brain context.

const { exec } = require('child_process');
const path = require('path');
const os   = require('os');
const fs   = require('fs');

const DATA_FILE  = path.join(os.homedir(), 'Documents', 'AXIOM', 'usage.json');
const POLL_MS    = 60_000;   // sample every 60 s
const MAX_DAYS   = 14;       // keep history for 14 days

let timer = null;
let data  = null;            // { entries: [{ ts, exe, title, url }] }

// ── Persistence ───────────────────────────────────────────────

function load() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    }
  } catch {}
  if (!data || !Array.isArray(data.entries)) data = { entries: [] };
}

function save() {
  try {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(data), 'utf8');
  } catch {}
}

function prune() {
  const cutoff = Date.now() - MAX_DAYS * 86_400_000;
  data.entries = data.entries.filter(e => e.ts > cutoff);
}

// ── Active window detection via PowerShell ────────────────────

function getForegroundWindow() {
  return new Promise((resolve) => {
    const ps = `
$h = [System.IntPtr]::Zero
Add-Type @"
using System; using System.Runtime.InteropServices;
public class W { [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); }
"@ -ErrorAction SilentlyContinue
$h = [W]::GetForegroundWindow()
$p = (Get-Process | Where-Object { $_.MainWindowHandle -eq $h } | Select-Object -First 1)
if ($p) { Write-Output ($p.ProcessName + "|" + $p.MainWindowTitle) }
`.trim();

    exec(`powershell -NoProfile -WindowStyle Hidden -Command "${ps.replace(/"/g, '\\"')}"`,
      { windowsHide: true, timeout: 4000 },
      (err, stdout) => {
        if (err || !stdout.trim()) return resolve(null);
        const [exe, ...titleParts] = stdout.trim().split('|');
        resolve({ exe: exe.trim(), title: titleParts.join('|').trim() });
      }
    );
  });
}

// Detect URL if active window is a browser
function extractUrl(title, exe) {
  // Common browser titles contain " - Chrome", " - Firefox", etc.
  const browsers = ['chrome', 'firefox', 'msedge', 'opera', 'brave'];
  if (!browsers.some(b => exe.toLowerCase().includes(b))) return null;

  // Title format is usually "Page Title - Google Chrome"
  // We can't get the URL from the title directly, but we can note the page title
  const m = title.match(/^(.+?)\s*[-–]\s*(?:Google Chrome|Mozilla Firefox|Microsoft Edge.*|Opera|Brave).*$/i);
  return m ? m[1].trim() : null;
}

// ── Poll ──────────────────────────────────────────────────────

async function poll() {
  const win = await getForegroundWindow();
  if (!win) return;

  // Skip AXIOM itself
  if (win.exe.toLowerCase().includes('axiom') || win.exe.toLowerCase() === 'electron') return;

  const entry = {
    ts:    Date.now(),
    exe:   win.exe.toLowerCase(),
    title: win.title,
    url:   extractUrl(win.title, win.exe),
  };

  data.entries.push(entry);
  prune();
  save();
}

// ── Public API ────────────────────────────────────────────────

/**
 * Returns top N apps by session count over the past `days` days.
 * [{ exe, count, label }]
 */
function getTopApps(n = 5, days = 7) {
  const cutoff = Date.now() - days * 86_400_000;
  const counts = {};
  for (const e of data.entries) {
    if (e.ts < cutoff) continue;
    counts[e.exe] = (counts[e.exe] || 0) + 1;
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([exe, count]) => ({ exe, count, label: exeToLabel(exe) }));
}

/**
 * Returns top N page titles (from browsers) by frequency.
 */
function getTopUrls(n = 5, days = 7) {
  const cutoff = Date.now() - days * 86_400_000;
  const counts = {};
  for (const e of data.entries) {
    if (e.ts < cutoff || !e.url) continue;
    counts[e.url] = (counts[e.url] || 0) + 1;
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([title, count]) => ({ title, count }));
}

/**
 * Returns a short text summary for brain.js context injection.
 */
function getSummary() {
  const apps = getTopApps(5);
  const pages = getTopUrls(3);
  if (!apps.length) return '';

  const appLine  = apps.map(a => `${a.label} (${a.count}×)`).join(', ');
  const pageLine = pages.length ? `  Top pages: ${pages.map(p => p.title).join(' / ')}` : '';
  return `USAGE (last 7 days): ${appLine}.${pageLine ? '\n' + pageLine : ''}`;
}

/**
 * Returns the exe names most likely to be "favorite" apps to auto-open.
 * Filters to apps used more than threshold times.
 */
function getFavorites(threshold = 5) {
  return getTopApps(10).filter(a => a.count >= threshold).map(a => a.exe);
}

function exeToLabel(exe) {
  const MAP = {
    chrome: 'Chrome', firefox: 'Firefox', msedge: 'Edge', code: 'VS Code',
    spotify: 'Spotify', discord: 'Discord', slack: 'Slack', teams: 'Teams',
    notepad: 'Notepad', 'notepad++': 'Notepad++', explorer: 'File Explorer',
    obs64: 'OBS', vlc: 'VLC', zoom: 'Zoom', figma: 'Figma',
    postman: 'Postman', blender: 'Blender', steam: 'Steam',
  };
  return MAP[exe] || exe;
}

function start() {
  load();
  // First poll immediately, then on interval
  poll();
  timer = setInterval(poll, POLL_MS);
  console.log('[AXIOM usage] tracking started');
}

function stop() {
  if (timer) { clearInterval(timer); timer = null; }
}

module.exports = { start, stop, getTopApps, getTopUrls, getSummary, getFavorites };
