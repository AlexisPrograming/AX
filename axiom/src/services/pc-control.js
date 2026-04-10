const { exec } = require('child_process');
const path = require('path');
const routines = require('./routines.js');

// Known app shortcuts → actual commands
const APP_MAP = {
  'vscode':         'code',
  'vs code':        'code',
  'visual studio code': 'code',
  'claude':         'powershell -NoProfile -WindowStyle Hidden -Command "$p=\'$env:LOCALAPPDATA\\AnthropicClaude\\claude.exe\';if(Test-Path $p){Start-Process $p}else{$p2=\'$env:LOCALAPPDATA\\Programs\\claude\\claude.exe\';if(Test-Path $p2){Start-Process $p2}else{Start-Process \'claude\'}}"',
  'chrome':         'start chrome',
  'google chrome':  'start chrome',
  'browser':        'start chrome',
  'firefox':        'start firefox',
  'edge':           'start msedge',
  'microsoft edge': 'start msedge',
  'spotify':        'start spotify',
  'notepad':        'notepad',
  'notepad++':      'start notepad++',
  'calculator':     'calc',
  'calc':           'calc',
  'terminal':       'wt',
  'windows terminal': 'wt',
  'cmd':            'cmd',
  'command prompt': 'cmd',
  'powershell':     'powershell',
  'explorer':       'explorer',
  'files':          'explorer',
  'file explorer':  'explorer',
  'discord':        'powershell -NoProfile -WindowStyle Hidden -Command "$d=Get-ChildItem \\"$env:LOCALAPPDATA\\Discord\\" -Filter Discord.exe -Recurse -EA SilentlyContinue|Sort-Object LastWriteTime -Desc|Select-Object -First 1;if($d){Start-Process $d.FullName}else{Start-Process discord}"',
  'valorant':       'powershell -NoProfile -WindowStyle Hidden -Command "$r=\'C:\\Riot Games\\Riot Client\\RiotClientServices.exe\';if(Test-Path $r){Start-Process $r \'--launch-product=valorant --launch-patchline=live\'}else{Start-Process valorant}"',
  'riot':           'powershell -NoProfile -WindowStyle Hidden -Command "Start-Process \'C:\\Riot Games\\Riot Client\\RiotClientServices.exe\' -ErrorAction SilentlyContinue"',
  'riot client':    'powershell -NoProfile -WindowStyle Hidden -Command "Start-Process \'C:\\Riot Games\\Riot Client\\RiotClientServices.exe\' -ErrorAction SilentlyContinue"',
  'slack':          'start slack',
  'teams':          'start msteams',
  'microsoft teams': 'start msteams',
  'paint':          'mspaint',
  'ms paint':       'mspaint',
  'word':           'start winword',
  'microsoft word': 'start winword',
  'excel':          'start excel',
  'microsoft excel': 'start excel',
  'powerpoint':     'start powerpnt',
  'outlook':        'start outlook',
  'task manager':   'taskmgr',
  'steam':          'start steam',
  'epic games':     'start "" "C:\\Program Files (x86)\\Epic Games\\Launcher\\Portal\\Binaries\\Win32\\EpicGamesLauncher.exe"',
  'epic':           'start "" "C:\\Program Files (x86)\\Epic Games\\Launcher\\Portal\\Binaries\\Win32\\EpicGamesLauncher.exe"',
  'obs':            'start obs64',
  'obs studio':     'start obs64',
  'vlc':            'start vlc',
  'zoom':           'start zoom',
  'whatsapp':       'start whatsapp',
  'telegram':       'start telegram',
  'blender':        'start blender',
  'figma':          'start figma',
  'postman':        'start postman',
  'insomnia':       'start insomnia',
  'settings':       'start ms-settings:',
  'windows settings': 'start ms-settings:',
  'snipping tool':  'start ms-screenclip:',
  'snip':           'start ms-screenclip:',
  'photos':         'start ms-photos:',
  'maps':           'start bingmaps:',
  'mail':           'start outlookmail:',
  'store':          'start ms-windows-store:',
  'xbox':           'start xbox:',
  'github desktop': 'start github',
  'gitkraken':      'start gitkraken',
};

// Normalize spotify.js { ok, error } → standard { success, error }
function normalizeSpotify(r) {
  return r.ok ? { success: true } : { success: false, error: r.error || 'Media key failed' };
}

// Execute an action object from Claude's response
async function executeAction(action) {
  if (!action || !action.type) {
    return { success: false, error: 'No action type specified' };
  }

  switch (action.type) {
    case 'open_app':
      return openApp(action.app);

    case 'close_app':
      return closeApp(action.app);

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

    case 'send_keys':
      return sendKeys(action.keys);

    case 'mouse_click':
      return require('./mouse-control.js').click(action.x, action.y, action.scaleFactor || 1);

    case 'mouse_right_click':
      return require('./mouse-control.js').rightClick(action.x, action.y, action.scaleFactor || 1);

    case 'mouse_double_click':
      return require('./mouse-control.js').doubleClick(action.x, action.y, action.scaleFactor || 1);

    case 'mouse_scroll':
      return require('./mouse-control.js').scroll(action.x, action.y, action.direction || 'down', action.amount || 3, action.scaleFactor || 1);

    case 'mouse_move':
      return require('./mouse-control.js').moveTo(action.x, action.y, action.scaleFactor || 1);

    case 'run_command':
      return runSafe(action.command);

    case 'clear_memory':
    case 'remember':
      // Handled by brain.js — no PC action needed
      return { success: true, output: 'Memory updated' };

    case 'spotify_play':
      return require('./spotify.js').play().then(normalizeSpotify);
    case 'spotify_pause':
      return require('./spotify.js').pause().then(normalizeSpotify);
    case 'spotify_next':
      return require('./spotify.js').next().then(normalizeSpotify);
    case 'spotify_previous':
      return require('./spotify.js').previous().then(normalizeSpotify);
    case 'spotify_current':
      // Handled by brain.js — nothing to do here
      return { success: true };

    case 'system_stats':
      // Handled by brain.js — nothing to do here
      return { success: true };

    // ── Environment / hardware control ──────────────────────
    case 'bt_on':
    case 'bt_off':
    case 'bt_list':
    case 'device_disable':
    case 'device_enable':
    case 'wifi_on':
    case 'wifi_off':
    case 'wifi_list':
    case 'wifi_connect':
    case 'display_off':
    case 'brightness':
    case 'audio_list':
    case 'audio_switch':
    case 'usb_eject':
      return require('./environment-control.js').executeEnvironmentAction(action);

    default:
      return { success: false, error: `Unknown action type: ${action.type}` };
  }
}

// App name → process name(s) for taskkill
const CLOSE_MAP = {
  'chrome':       'chrome.exe',
  'claude':       'Claude.exe',
  'browser':      'chrome.exe',
  'firefox':      'firefox.exe',
  'edge':         'msedge.exe',
  'spotify':      'Spotify.exe',
  'discord':      'Discord.exe',
  'valorant':     'VALORANT-Win64-Shipping.exe',
  'riot':         'RiotClientServices.exe',
  'riot client':  'RiotClientServices.exe',
  'slack':        'slack.exe',
  'teams':        'Teams.exe',
  'vscode':       'Code.exe',
  'vs code':      'Code.exe',
  'notepad':      'notepad.exe',
  'calculator':   'CalculatorApp.exe',
  'calc':         'CalculatorApp.exe',
  'terminal':     'WindowsTerminal.exe',
  'explorer':     'explorer.exe',
  'files':        'explorer.exe',
  'word':         'WINWORD.EXE',
  'excel':        'EXCEL.EXE',
  'paint':        'mspaint.exe',
  'task manager': 'Taskmgr.exe',
  'powershell':   'powershell.exe',
  'cmd':          'cmd.exe',
};

// Critical system processes that must never be killed
const PROTECTED_PROCESSES = new Set([
  'explorer.exe', 'svchost.exe', 'lsass.exe', 'csrss.exe', 'winlogon.exe',
  'wininit.exe', 'services.exe', 'system', 'smss.exe', 'dwm.exe',
  'taskhostw.exe', 'spoolsv.exe', 'audiodg.exe', 'fontdrvhost.exe',
  'sihost.exe', 'ctfmon.exe', 'runtimebroker.exe', 'shellexperiencehost.exe',
  'searchindexer.exe', 'antimalware service executable',
]);

function closeApp(appName) {
  if (!appName) return Promise.resolve({ success: false, error: 'No app specified' });
  const key = appName.toLowerCase().trim();
  const proc = (CLOSE_MAP[key] || `${appName}.exe`).toLowerCase();

  if (PROTECTED_PROCESSES.has(proc)) {
    return Promise.resolve({ success: false, error: `"${proc}" is a protected system process and cannot be closed.` });
  }

  return run(`taskkill /IM "${proc}" /F`);
}

function openApp(appName) {
  if (!appName) return Promise.resolve({ success: false, error: 'No app specified' });

  const key = appName.toLowerCase().trim();
  const cmd = APP_MAP[key];

  if (cmd) {
    return run(cmd);
  }

  // Try via Windows shell — searches PATH, Start Menu, and registered app names
  return run(`start "" "${appName.replace(/"/g, '')}"`)
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
  const volPct = Math.max(0, Math.min(100, parseInt(level) || 50));
  const os   = require('os');
  const fs   = require('fs');
  const path = require('path');

  // Write a temp .ps1 file so there are zero quote-escaping issues.
  // The C# snippet needs "using System;" for IntPtr to resolve.
  const script = `
Add-Type -Language CSharp -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class AudioHelper {
    [DllImport("winmm.dll")]
    public static extern int waveOutSetVolume(IntPtr hwo, uint dwVolume);
    public static void SetVolume(int percent) {
        uint raw = (uint)(percent * 0xFFFF / 100);
        uint vol = raw | (raw << 16);
        waveOutSetVolume(IntPtr.Zero, vol);
    }
}
"@
[AudioHelper]::SetVolume(${volPct})
`.trim();

  const tmpFile = path.join(os.tmpdir(), `axiom-vol-${Date.now()}.ps1`);
  fs.writeFileSync(tmpFile, script, 'utf8');

  return new Promise((resolve) => {
    const { exec } = require('child_process');
    exec(
      `powershell -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "${tmpFile}"`,
      { windowsHide: true },
      (err) => {
        fs.unlink(tmpFile, () => {});
        if (err) resolve({ success: false, error: err.message });
        else resolve({ success: true });
      }
    );
  });
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

// Block genuinely destructive system commands
const BLOCKED_PATTERNS = [
  /\bformat\s+[a-z]:/i,
  /\bdiskpart\b/i,
  /\breg\s+(delete|add)\b/i,
  /\bnetsh\b.*\bfirewall\b/i,
  /\bsc\s+(delete|stop|config)\b/i,
  /\bsfc\b/i,
  /\bcacls\b/i,
  /\bicacls\b/i,
  /\bbcdedit\b/i,
  /\bbootrec\b/i,
];

function runSafe(command) {
  if (!command) return Promise.resolve({ success: false, error: 'No command specified' });

  const cmd = command.trim();

  if (BLOCKED_PATTERNS.some((p) => p.test(cmd))) {
    return Promise.resolve({ success: false, error: `Blocked dangerous command: ${command}` });
  }

  // Block taskkill on protected processes
  const taskkillMatch = cmd.match(/taskkill\s+.*?\/IM\s+"?([^"\s]+)"?/i);
  if (taskkillMatch) {
    const proc = taskkillMatch[1].toLowerCase();
    if (PROTECTED_PROCESSES.has(proc)) {
      return Promise.resolve({ success: false, error: `"${proc}" is a protected system process.` });
    }
  }

  return run(cmd);
}

function sendKeys(keys) {
  if (!keys) return Promise.resolve({ success: false, error: 'No keys specified' });

  // Allowlist: only safe SendKeys patterns (no arbitrary shell injection)
  const safe = /^[\^%+~{}\[\]()\w\s;:.,!@#$*-]+$/;
  if (!safe.test(keys)) {
    return Promise.resolve({ success: false, error: `Invalid key sequence: ${keys}` });
  }

  const { execFile } = require('child_process');
  const fs   = require('fs');
  const os   = require('os');
  const path = require('path');

  const tmp    = path.join(os.tmpdir(), `axiom-keys-${Date.now()}.ps1`);
  const script = [
    `Add-Type -AssemblyName System.Windows.Forms`,
    `[System.Windows.Forms.SendKeys]::SendWait('${keys.replace(/'/g, "''")}')`,
  ].join('\r\n');

  return new Promise((resolve) => {
    fs.writeFile(tmp, script, 'utf8', (writeErr) => {
      if (writeErr) return resolve({ success: false, error: writeErr.message });
      execFile(
        'powershell',
        ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', tmp],
        { windowsHide: true },
        (err) => {
          fs.unlink(tmp, () => {});
          resolve(err ? { success: false, error: err.message } : { success: true });
        }
      );
    });
  });
}

function run(command) {
  // Build a PATH that includes common Windows app locations so packaged Electron
  // inherits the same environment as an interactive shell.
  const extraPaths = [
    'C:\\Windows\\System32',
    'C:\\Windows',
    'C:\\Windows\\System32\\WindowsPowerShell\\v1.0',
    'C:\\Program Files\\Google\\Chrome\\Application',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application',
    'C:\\Program Files\\Mozilla Firefox',
    'C:\\Program Files\\Microsoft VS Code',
    'C:\\Program Files\\WindowsApps',
  ].join(';');

  const env = {
    ...process.env,
    PATH: [process.env.PATH, extraPaths].filter(Boolean).join(';'),
  };

  return new Promise((resolve) => {
    exec(command, { timeout: 10000, windowsHide: true, shell: 'cmd.exe', env }, (err, stdout, stderr) => {
      if (err) {
        resolve({ success: false, error: stderr || err.message });
      } else {
        resolve({ success: true, output: stdout.trim() });
      }
    });
  });
}

module.exports = { executeAction };
