// AXIOM Performance Monitor
// Detects gaming / high-resource activity and notifies main.js to enter light mode.
// Uses PowerShell (spawn, no cmd.exe) to avoid escaping issues.
// Polls every 3 s; enters gaming mode after sustained high CPU or known gaming exe.

'use strict';

const { spawn } = require('child_process');

// ── Actual GAME executables ───────────────────────────────────
// These trigger gaming mode on their own (game is definitely running).
const GAME_EXES = new Set([
  // Engines
  'ue4game', 'ue5game',
  // FPS / competitive
  'cs2', 'csgo', 'valorant', 'r5apex', 'rainbowsix',
  'overwatch', 'overwatch2', 'fortniteclient-win64-shipping',
  // Open world / RPG
  'gta5', 'gtav', 'fivem', 'rdr2',
  'eldenring', 'cyberpunk2077', 'witcher3', 'starfield',
  'fallout4', 'skyrimse', 'skyrimvr',
  'd2r', 'diablo4', 'pathofexile', 'pathofexile2',
  'hades', 'hades2',
  // Online / survival
  'destiny2', 'warframe.x64', 'warframe',
  'rust', 'ark', 'pubg', 'battlefield2042', 'bf4', 'bf1', 'bf5',
  'rocketleague', 'dota2', 'leagueoflegends',
  // Minecraft (Windows Store version only)
  'minecraft.windows',
  // Casual / indie
  'stardewvalley', 'terraria', 'palworld',
]);

// ── Game LAUNCHERS ────────────────────────────────────────────
// These only trigger gaming mode when system CPU is also elevated.
// Idle in the background → ignored.  Loading/running a game → CPU spikes → triggers.
const LAUNCHER_EXES = new Set([
  'steam', 'epicgameslauncher', 'galaxyclient', 'upc',
  'riotclientservices', 'xboxapp', 'xboxgame', 'battle.net',
]);

const LAUNCHER_CPU_THRESH = 50;  // CPU % required before launchers count as gaming

// ── Processes that must NEVER trigger gaming mode ─────────────
const NO_TRIGGER = new Set([
  // Windows system
  'system', 'idle', 'registry', 'smss', 'csrss', 'wininit', 'services',
  'lsass', 'svchost', 'dwm', 'winlogon', 'fontdrvhost', 'spoolsv',
  'taskhostw', 'runtimebroker', 'searchindexer', 'audiodg',
  'conhost', 'dllhost', 'wermgr', 'sihost', 'ctfmon',
  'shellexperiencehost', 'startmenuexperiencehost', 'securityhealthsystray',
  'textinputhost', 'explorer', 'taskmgr',
  // AXIOM itself
  'axiom', 'electron',
  // Browsers (heavy RAM but not games)
  'chrome', 'msedge', 'firefox', 'opera', 'brave', 'vivaldi',
  // Dev tools
  'code', 'devenv', 'node', 'npm', 'git', 'msbuild', 'python', 'python3',
]);

// ── Thresholds ────────────────────────────────────────────────
const POLL_MS          = 3000;   // poll interval
const SYS_CPU_THRESH   = 75;     // system CPU % — raised to avoid false positives
const SUSTAINED_ENTER  = 8;      // ~24 s of sustained high CPU → enter gaming mode
const GAMING_EXE_ENTER = 3;      // 3 polls (~9 s) with known game exe → enter
const SUSTAINED_EXIT   = 10;     // ~30 s of low load → exit gaming mode

// ── PowerShell snippet ────────────────────────────────────────
// Returns: "<sysCPU%>|<json-process-array>"
const PS_CODE = `
$c = [int](Get-CimInstance Win32_Processor | Measure-Object LoadPercentage -Average).Average
$p = Get-Process -ErrorAction SilentlyContinue |
     Select-Object Name, @{N='R';E={[int]($_.WorkingSet64/1MB)}} |
     ConvertTo-Json -Compress -Depth 1
Write-Output ($c.ToString() + '|' + $p)
`.trim();

// ─────────────────────────────────────────────────────────────

class PerformanceMonitor {
  constructor() {
    this._timer     = null;
    this._cb        = null;
    this._isGaming  = false;
    this._highCount = 0;
    this._lowCount  = 0;
    this._running   = false;
  }

  start(onModeChange) {
    if (this._running) return;
    this._running = true;
    this._cb      = onModeChange;
    this._scheduleNext();
  }

  stop() {
    this._running = false;
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
  }

  isGamingMode() { return this._isGaming; }

  // ── Internal ──────────────────────────────────────────────

  _scheduleNext() {
    if (!this._running) return;
    this._timer = setTimeout(() => this._poll(), POLL_MS);
  }

  _poll() {
    let stdout = '';
    let timedOut = false;

    const child = spawn('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden',
      '-Command', PS_CODE,
    ], { windowsHide: true });

    const watchdog = setTimeout(() => {
      timedOut = true;
      try { child.kill(); } catch {}
    }, 9000);

    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.on('close', () => {
      clearTimeout(watchdog);
      if (!timedOut && stdout) {
        try { this._analyze(stdout.trim()); } catch {}
      }
      this._scheduleNext();
    });
    child.on('error', () => {
      clearTimeout(watchdog);
      this._scheduleNext();
    });
  }

  _analyze(raw) {
    const pipe = raw.indexOf('|');
    if (pipe < 0) return;

    const sysCpu = parseInt(raw.slice(0, pipe), 10) || 0;

    let procs = [];
    try {
      const parsed = JSON.parse(raw.slice(pipe + 1));
      procs = Array.isArray(parsed) ? parsed : (parsed ? [parsed] : []);
    } catch { return; }

    // ── Gaming exe detection ──────────────────────────────────
    let gameExeFound     = false;   // definite game running → fast-trigger
    let launcherHighCpu  = false;   // launcher present + CPU elevated → slow-trigger

    for (const p of procs) {
      const name = (p.Name || '').toLowerCase();
      if (GAME_EXES.has(name)) { gameExeFound = true; break; }
      if (LAUNCHER_EXES.has(name) && sysCpu >= LAUNCHER_CPU_THRESH) {
        launcherHighCpu = true;
      }
    }

    const gamingExeFound = gameExeFound || launcherHighCpu;

    // ── Decide high-load ──────────────────────────────────────
    const highLoad = gamingExeFound || sysCpu >= SYS_CPU_THRESH;

    if (highLoad) {
      this._highCount++;
      this._lowCount = 0;
      // Game exe alone → fast-enter. Launcher+CPU or pure CPU → sustained enter.
      const threshold = gameExeFound ? GAMING_EXE_ENTER : SUSTAINED_ENTER;
      if (!this._isGaming && this._highCount >= threshold) {
        this._isGaming = true;
        this._cb && this._cb(true, gameExeFound ? 'gaming' : 'highcpu');
      }
    } else {
      this._lowCount++;
      this._highCount = Math.max(0, this._highCount - 1); // slow decay
      if (this._isGaming && this._lowCount >= SUSTAINED_EXIT) {
        this._isGaming = false;
        this._highCount = 0;
        this._lowCount  = 0;
        this._cb && this._cb(false, null);
      }
    }

    // Debug (comment out in production)
    // console.log(`[perf] cpu=${sysCpu}% gaming=${gamingExeFound} high=${this._highCount} low=${this._lowCount} mode=${this._isGaming ? 'GAMING' : 'normal'}`);
  }
}

module.exports = new PerformanceMonitor();
