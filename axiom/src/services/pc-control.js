const { exec } = require('child_process');
const path = require('path');
const routines = require('./routines.js');

// Known app shortcuts → actual commands
const APP_MAP = {
  'vscode':    'code',
  'vs code':   'code',
  'chrome':    'start chrome',
  'browser':   'start chrome',
  'firefox':   'start firefox',
  'edge':      'start msedge',
  'spotify':   'start spotify',
  'notepad':   'notepad',
  'calculator':'calc',
  'calc':      'calc',
  'terminal':  'wt',
  'cmd':       'cmd',
  'powershell':'powershell',
  'explorer':  'explorer',
  'files':     'explorer',
  'discord':   'start discord',
  'slack':     'start slack',
  'teams':     'start msteams',
  'paint':     'mspaint',
  'word':      'start winword',
  'excel':     'start excel',
  'task manager': 'taskmgr',
};

// Execute an action object from Claude's response
async function executeAction(action) {
  if (!action || !action.type) {
    return { success: false, error: 'No action type specified' };
  }

  switch (action.type) {
    case 'open_app':
      return openApp(action.app);

    case 'search_web':
      return searchWeb(action.query);

    case 'open_url':
      return openUrl(action.url);

    case 'run_routine':
      return runRoutine(action.name);

    case 'list_routines':
      return { success: true, output: listRoutineNames() };

    case 'create_routine':
      return createRoutine(action.routine);

    case 'delete_routine':
      return deleteRoutine(action.name);

    case 'open_path':
      return openPath(action.path);

    case 'shutdown':
      return systemPower('shutdown', action.delay);

    case 'restart':
      return systemPower('restart', action.delay);

    case 'sleep':
      return systemPower('sleep');

    case 'lock':
      return run('rundll32.exe user32.dll,LockWorkStation');

    case 'volume':
      return adjustVolume(action.level);

    case 'reminder':
      return setReminder(action.message, action.minutes);

    case 'run_command':
      return runSafe(action.command);

    case 'clear_memory':
    case 'remember':
      // Handled by brain.js — no PC action needed
      return { success: true, output: 'Memory updated' };

    default:
      return { success: false, error: `Unknown action type: ${action.type}` };
  }
}

function openApp(appName) {
  if (!appName) return Promise.resolve({ success: false, error: 'No app specified' });

  const key = appName.toLowerCase().trim();
  const cmd = APP_MAP[key];

  if (cmd) {
    return run(cmd);
  }

  // Try launching directly — Windows will search PATH and Start Menu
  return run(`start "" "${appName}"`);
}

function openUrl(url) {
  if (!url) return Promise.resolve({ success: false, error: 'No URL specified' });
  let safeUrl = String(url).trim();
  if (!/^https?:\/\//i.test(safeUrl)) safeUrl = 'https://' + safeUrl;
  // Strip dangerous shell chars
  if (/["'`\n\r]/.test(safeUrl)) {
    return Promise.resolve({ success: false, error: 'Invalid characters in URL' });
  }
  return run(`start "" "${safeUrl}"`);
}

function runRoutine(name) {
  // Lazy require to avoid circular dep at module load
  const { speak } = require('./speaker.js');
  return routines.run(name, { speak, executeAction });
}

function listRoutineNames() {
  return routines.list().map((r) => r.name);
}

function deleteRoutine(name) {
  if (!name) return Promise.resolve({ success: false, error: 'No routine name' });
  const removed = routines.remove(name);
  return Promise.resolve(
    removed
      ? { success: true, output: `Routine "${name}" deleted.` }
      : { success: false, error: `No routine named "${name}"` }
  );
}

function createRoutine(routine) {
  try {
    routines.add(routine);
    return Promise.resolve({ success: true, output: `Routine "${routine.name}" saved.` });
  } catch (err) {
    return Promise.resolve({ success: false, error: err.message });
  }
}

function searchWeb(query) {
  if (!query) return Promise.resolve({ success: false, error: 'No search query' });
  const encoded = encodeURIComponent(query);
  return run(`start "" "https://www.google.com/search?q=${encoded}"`);
}

function openPath(filePath) {
  if (!filePath) return Promise.resolve({ success: false, error: 'No path specified' });

  // Basic path traversal protection
  const normalized = path.normalize(filePath);
  if (normalized.includes('..')) {
    return Promise.resolve({ success: false, error: 'Path traversal not allowed' });
  }

  return run(`start "" "${normalized}"`);
}

function systemPower(mode, delaySec) {
  const delay = Math.max(0, parseInt(delaySec) || 0);

  switch (mode) {
    case 'shutdown':
      return run(`shutdown /s /t ${delay}`);
    case 'restart':
      return run(`shutdown /r /t ${delay}`);
    case 'sleep':
      return run('rundll32.exe powrprof.dll,SetSuspendState 0,1,0');
    default:
      return Promise.resolve({ success: false, error: 'Unknown power mode' });
  }
}

function adjustVolume(level) {
  // Use PowerShell to set system volume (0-100)
  const vol = Math.max(0, Math.min(100, parseInt(level) || 50));
  const ps = `(New-Object -ComObject WScript.Shell).SendKeys([char]173); `
    + `$vol = [Math]::Round(${vol} * 655.35); `
    + `Add-Type -TypeDefinition 'using System.Runtime.InteropServices; public class Vol { [DllImport("winmm.dll")] public static extern int waveOutSetVolume(IntPtr hwo, uint dwVolume); }'; `
    + `[Vol]::waveOutSetVolume([IntPtr]::Zero, (${vol} * 655 + (${vol} * 655 -shl 16)))`;
  return run(`powershell -NoProfile -Command "${ps}"`);
}

function setReminder(message, minutes) {
  const mins = parseInt(minutes) || 1;
  const msg = (message || 'Reminder from AXIOM').replace(/"/g, "'");

  // Schedule a toast notification via PowerShell
  const ps = `Start-Sleep -Seconds ${mins * 60}; `
    + `[System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms') | Out-Null; `
    + `[System.Windows.Forms.MessageBox]::Show('${msg}', 'AXIOM Reminder')`;

  // Run detached so it doesn't block
  exec(`start /b powershell -NoProfile -WindowStyle Hidden -Command "${ps}"`, { windowsHide: true });

  console.log(`[AXIOM] Reminder set: "${message}" in ${mins} minute(s)`);
  return Promise.resolve({ success: true, output: `Reminder set for ${mins} minute(s)` });
}

// Safe command runner with allowlist
const SAFE_PATTERNS = [
  /^start\s/i,
  /^explorer/i,
  /^notepad/i,
  /^calc/i,
  /^code/i,
  /^wt$/i,
  /^taskmgr/i,
  /^mspaint/i,
  /^shutdown\s/i,
  /^rundll32/i,
  /^powershell\s+-NoProfile\s+-Command/i,
];

function runSafe(command) {
  if (!command) return Promise.resolve({ success: false, error: 'No command specified' });

  const isSafe = SAFE_PATTERNS.some((p) => p.test(command.trim()));
  if (!isSafe) {
    return Promise.resolve({ success: false, error: `Blocked unsafe command: ${command}` });
  }

  return run(command);
}

function run(command) {
  return new Promise((resolve) => {
    exec(command, { timeout: 10000, windowsHide: true }, (err, stdout, stderr) => {
      if (err) {
        resolve({ success: false, error: stderr || err.message });
      } else {
        resolve({ success: true, output: stdout.trim() });
      }
    });
  });
}

module.exports = { executeAction };
