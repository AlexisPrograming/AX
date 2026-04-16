// AXIOM Performance Monitor
// Detects gaming / high-resource activity and notifies main.js to enter light mode.
// Uses PowerShell (spawn, no cmd.exe) to avoid escaping issues.
//
// Triggers gaming mode when ANY of the following are sustained:
//   1. A known game executable is running
//   2. Total system CPU >= SYS_CPU_THRESH (75%)
//   3. A single process consumes >= PER_PROC_CPU_THRESH (70%) of total CPU
//   4. A single process consumes >= GPU_THRESH (70%) of a GPU 3D engine

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
  // Browsers (heavy RAM/GPU but not games)
  'chrome', 'msedge', 'firefox', 'opera', 'brave', 'vivaldi',
  // Dev tools
  'code', 'devenv', 'node', 'npm', 'git', 'msbuild', 'python', 'python3',
]);

// ── Thresholds ────────────────────────────────────────────────
const POLL_MS             = 3000;  // poll interval
const WATCHDOG_MS         = 12000; // kill stalled PS after 12 s (GPU query adds ~1 s)
const SYS_CPU_THRESH      = 75;    // system-wide CPU % → avoids false positives
const PER_PROC_CPU_THRESH = 70;    // single process CPU % (normalised per core)
const GPU_THRESH          = 70;    // single process GPU 3D-engine utilisation %
const SUSTAINED_ENTER     = 8;     // ~24 s of sustained high CPU → enter gaming mode
const GAMING_EXE_ENTER    = 3;     // 3 polls (~9 s) with known game exe → enter
const SUSTAINED_EXIT      = 10;    // ~30 s of low load → exit gaming mode

// ── PowerShell snippet ────────────────────────────────────────
// Output (one value per line):
//   line 0 : system CPU %
//   line 1 : max per-process CPU % (normalised by core count)
//   line 2 : process name responsible for max CPU
//   line 3 : max per-process GPU 3D-engine utilisation %
//   line 4 : process name responsible for max GPU
//   line 5+: JSON process list [{Name, R}]
const PS_CODE = `
$numCpu = [math]::Max([int]$env:NUMBER_OF_PROCESSORS, 1)
$sysCpu = [int](Get-CimInstance Win32_Processor | Measure-Object LoadPercentage -Average).Average

# Per-process CPU (normalised to 0-100 of total CPU)
$maxProcCpuVal = 0; $maxProcCpuName = ''
try {
  $top = Get-CimInstance Win32_PerfFormattedData_PerfProc_Process -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -notmatch '^(_Total|Idle)$' } |
    Sort-Object PercentProcessorTime -Descending |
    Select-Object -First 1
  if ($top) {
    $maxProcCpuVal = [math]::Round($top.PercentProcessorTime / $numCpu)
    $maxProcCpuName = ($top.Name -replace '#\\d+$','').ToLower()
  }
} catch {}

# Per-process GPU (3D engine utilisation via Performance Counters)
$maxGpuVal = 0; $maxGpuName = ''
try {
  $gpuTop = (Get-Counter '\\GPU Engine(*engtype_3D)\\Utilization Percentage' -ErrorAction Stop).CounterSamples |
    Sort-Object CookedValue -Descending | Select-Object -First 1
  if ($gpuTop -and $gpuTop.CookedValue -gt 0) {
    $maxGpuVal = [int][math]::Round($gpuTop.CookedValue)
    if ($gpuTop.InstanceName -match 'pid_(\\d+)') {
      $proc = Get-Process -Id ([int]$Matches[1]) -ErrorAction SilentlyContinue
      if ($proc) { $maxGpuName = $proc.ProcessName.ToLower() }
    }
  }
} catch {}

# All running processes (for game-exe + RAM checks)
$procs = Get-Process -ErrorAction SilentlyContinue |
  Select-Object Name,@{N='R';E={[int]($_.WorkingSet64/1MB)}} |
  ConvertTo-Json -Compress -Depth 1

Write-Output $sysCpu
Write-Output $maxProcCpuVal
Write-Output $maxProcCpuName
Write-Output $maxGpuVal
Write-Output $maxGpuName
Write-Output $procs
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
    }, WATCHDOG_MS);

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
    const lines = raw.split('\n').map(l => l.trim()).filter(l => l);
    if (lines.length < 2) return;

    const sysCpu         = parseInt(lines[0], 10) || 0;
    const maxProcCpuVal  = parseInt(lines[1], 10) || 0;
    const maxProcCpuName = lines[2] || '';
    const maxGpuVal      = parseInt(lines[3], 10) || 0;
    const maxGpuName     = lines[4] || '';
    const procsJson      = lines.slice(5).join('');

    let procs = [];
    try {
      const parsed = JSON.parse(procsJson);
      procs = Array.isArray(parsed) ? parsed : (parsed ? [parsed] : []);
    } catch { return; }

    // ── Game exe detection ────────────────────────────────────
    let gameExeFound    = false;
    let launcherHighCpu = false;

    for (const p of procs) {
      const name = (p.Name || '').toLowerCase();
      if (GAME_EXES.has(name)) { gameExeFound = true; break; }
      if (LAUNCHER_EXES.has(name) && sysCpu >= LAUNCHER_CPU_THRESH) {
        launcherHighCpu = true;
      }
    }

    // ── Per-process CPU / GPU checks ──────────────────────────
    const highProcCpu = maxProcCpuVal >= PER_PROC_CPU_THRESH
      && maxProcCpuName
      && !NO_TRIGGER.has(maxProcCpuName);

    const highGpu = maxGpuVal >= GPU_THRESH
      && maxGpuName
      && !NO_TRIGGER.has(maxGpuName);

    // ── Decide high-load ──────────────────────────────────────
    const gamingExeFound = gameExeFound || launcherHighCpu;
    const highLoad       = gamingExeFound || sysCpu >= SYS_CPU_THRESH || highProcCpu || highGpu;

    // Determine reason string (most specific wins)
    const reason = gameExeFound       ? 'gaming'
                 : highGpu            ? `highgpu:${maxGpuName}:${maxGpuVal}%`
                 : highProcCpu        ? `highcpu_proc:${maxProcCpuName}:${maxProcCpuVal}%`
                 : launcherHighCpu    ? 'launcher'
                 :                     'highcpu';

    if (highLoad) {
      this._highCount++;
      this._lowCount = 0;
      // Game exe alone → fast-enter. Everything else → sustained enter.
      const threshold = gameExeFound ? GAMING_EXE_ENTER : SUSTAINED_ENTER;
      if (!this._isGaming && this._highCount >= threshold) {
        this._isGaming = true;
        console.log(`[AXIOM perf] gaming mode ON — reason: ${reason}`);
        this._cb && this._cb(true, reason);
      }
    } else {
      this._lowCount++;
      this._highCount = Math.max(0, this._highCount - 1); // slow decay
      if (this._isGaming && this._lowCount >= SUSTAINED_EXIT) {
        this._isGaming = false;
        this._highCount = 0;
        this._lowCount  = 0;
        console.log('[AXIOM perf] gaming mode OFF');
        this._cb && this._cb(false, null);
      }
    }

    // Debug (uncomment if needed)
    // console.log(`[perf] sys=${sysCpu}% procCpu=${maxProcCpuVal}%(${maxProcCpuName}) gpu=${maxGpuVal}%(${maxGpuName}) mode=${this._isGaming ? 'GAMING' : 'normal'}`);
  }
}

module.exports = new PerformanceMonitor();
