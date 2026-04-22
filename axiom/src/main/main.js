const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, screen, Notification, session, powerMonitor, shell, desktopCapturer } = require('electron');
const path = require('path');
const { exec } = require('child_process');
const Store = require('electron-store');
const OpenAI = require('openai');
const { toFile } = require('openai/uploads');
const wakeword        = require('../services/wakeword.js');
const proactive       = require('../services/proactive.js');
const pomodoro        = require('../services/pomodoro.js');
const terminalWatcher = require('../services/terminal-watcher.js');
const clipboardService = require('../services/clipboard.js');
const usageTracker    = require('../services/usage-tracker.js');
const voiceAuth       = require('../services/voice-auth.js');
const windowMonitor      = require('../services/window-monitor.js');
const activityTracker    = require('../services/activity-tracker.js');
const performanceMonitor = require('../services/performance-monitor.js');

const dotenvPath = app.isPackaged
  ? path.join(process.resourcesPath, '.env')
  : path.join(__dirname, '..', '..', '.env');
require('dotenv').config({ path: dotenvPath });

const store = new Store({ defaults: { autoLaunch: true, firstRun: true } });

let openaiClient = null;
function getOpenAI() {
  if (!openaiClient) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is missing from .env');
    }
    openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openaiClient;
}

let mainWindow = null;
let tray = null;
let lastAxiomResponse = null;
let windowPinned = false;
let pendingWindowSuggestion = null;  // { exe, label, all } — set when AXIOM asks to close an app

// Yes/no/never patterns for window-close responses
// Broad enough to catch natural speech — anchored so they only match when the
// entire message is a close-confirmation (not mid-sentence noise).
const CLOSE_YES = /^\s*(yes|yeah|yep|sure|ok|okay|si|sí|dale|claro|alright|sounds good|do it|just do it|yeah do it|do it please|yes please|yeah go ahead|go ahead|go for it|close it|close this|close that|close them|close all|cierra|cerralos)\s*[.!]?\s*$/i;
const CLOSE_NO  = /^\s*(no|nope|nah|don.t|not now|keep it|leave it open|leave it|cancel|never mind|nevermind|no thanks|forget about it|forget it|just forget it|skip it|ignore it|don.t bother|déjalo|no lo cierres)\s*[.!]?\s*$/i;
const CLOSE_NEVER  = /\b(never|don.t (ever )?suggest|stop suggesting|always keep|whitelist|protect|nunca)\b/i;


const launchedAtLogin = process.argv.includes('--hidden') || app.getLoginItemSettings().wasOpenedAtLogin;

// ── Auto-launch ──────────────────────────────────────────────

function applyAutoLaunch(enabled) {
  app.setLoginItemSettings({
    openAtLogin: enabled,
    args: ['--hidden'],
  });
  store.set('autoLaunch', enabled);
}

// ── Window ───────────────────────────────────────────────────

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 220,
    height: 220,
    show: false,
    frame: false,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    transparent: true,
    backgroundThrottling: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  // Raise to front when focused (keeps it above whatever was just clicked)
  mainWindow.on('focus', () => {
    mainWindow.setAlwaysOnTop(true, windowPinned ? 'screen-saver' : 'floating');
    mainWindow.moveTop();
  });

  // Pause orb animation while dragging so the GPU isn't fighting two jobs at once
  let moveThrottle = null;
  mainWindow.on('will-move', () => {
    mainWindow.webContents.send('window-moving', true);
    clearTimeout(moveThrottle);
  });
  mainWindow.on('moved', () => {
    // Small delay so the window has fully settled before resuming animation
    moveThrottle = setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('window-moving', false);
      }
    }, 80);
  });

  mainWindow.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

// ── Tray ─────────────────────────────────────────────────────

function createTray() {
  tray = new Tray(path.join(__dirname, '..', '..', 'assets', 'icon.png'));
  buildTrayMenu();
  tray.setToolTip('AXIOM — Voice Assistant');
  tray.on('click', () => toggleWindow());
}

function buildTrayMenu(focusLabel) {
  const autoLaunch = store.get('autoLaunch');
  const template = [{ label: 'Show AXIOM', click: () => showWindow() }];

  if (focusLabel) {
    template.push({ type: 'separator' });
    template.push({ label: `⏱ ${focusLabel}`, enabled: false });
    template.push({
      label: 'Stop Focus Mode',
      click: () => {
        pomodoro.stop();
        buildTrayMenu(null);
      },
    });
  }

  template.push(
    { type: 'separator' },
    {
      label: 'Start with Windows',
      type: 'checkbox',
      checked: autoLaunch,
      click: (item) => {
        applyAutoLaunch(item.checked);
        buildTrayMenu();
      },
    },
    { type: 'separator' },
    { label: 'Quit', click: () => { app.isQuitting = true; app.quit(); } }
  );

  tray.setContextMenu(Menu.buildFromTemplate(template));
}

// ── Window positioning ───────────────────────────────────────

function showWindow() {
  // Always moves to the default position (top-right). Used on first launch / tray click.
  const { width: screenW } = screen.getPrimaryDisplay().workAreaSize;
  const [winW] = mainWindow.getSize();
  mainWindow.setPosition(screenW - winW - 12, 12);
  mainWindow.show();
  mainWindow.focus();
}

function revealInPlace() {
  // Wake-word activation — show without moving if the window already has a position.
  if (mainWindow.isVisible()) {
    mainWindow.focus();
    return;
  }
  // If it was hidden and has never been placed, use the default position.
  const [x, y] = mainWindow.getPosition();
  if (x === 0 && y === 0) {
    showWindow();
  } else {
    mainWindow.show();
    mainWindow.focus();
  }
}

function toggleWindow() {
  if (mainWindow.isVisible()) {
    mainWindow.hide();
  } else {
    showWindow();
  }
}

// ── First-run notification ───────────────────────────────────

function showFirstRunNotification() {
  if (!store.get('firstRun')) return;
  store.set('firstRun', false);
  new Notification({
    title: 'AXIOM is running',
    body: 'Press Alt+Space to activate.',
    icon: path.join(__dirname, '..', '..', 'assets', 'icon.png'),
  }).show();
}

// ── App lifecycle ────────────────────────────────────────────

app.whenReady().then(() => {
  // Auto-grant microphone permission for the renderer
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    if (permission === 'media' || permission === 'microphone') return callback(true);
    callback(false);
  });

  createWindow();
  createTray();
  applyAutoLaunch(store.get('autoLaunch'));

  // Terminal watcher — init with error callback
  terminalWatcher.init({
    onError: async (errorText) => {
      const { explainError } = require('../services/brain.js');
      const { speak } = require('../services/speaker.js');
      try {
        const explanation = await explainError(errorText);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('axiom-proactive', `Error detected: ${explanation}`);
        }
        await speak(`Hey, got an error. ${explanation}`);
      } catch (err) {
        console.error('[AXIOM terminal watcher] error handler failed:', err.message);
      }
    },
  });

  // Pomodoro — init with speak + tray tooltip updater
  pomodoro.init({
    speak: (text) => {
      const { speak } = require('../services/speaker.js');
      return speak(text);
    },
    onTrayUpdate: (label) => {
      if (!tray || tray.isDestroyed()) return;
      tray.setToolTip(label ? `AXIOM — ${label}` : 'AXIOM — Voice Assistant');
      buildTrayMenu(label);
    },
  });


  globalShortcut.register('Alt+Space', () => {
    toggleWindow();
  });

  globalShortcut.register('Alt+S', async () => {
    try {
      // Hide the overlay so it's not in the shot, capture, then reveal
      const wasVisible = mainWindow.isVisible();
      if (wasVisible) mainWindow.hide();
      await new Promise((r) => setTimeout(r, 120));

      const shot = await captureScreenshot();
      showWindow();
      mainWindow.webContents.send('screen-hotkey', shot); // base64 PNG
    } catch (err) {
      console.error('[AXIOM screen hotkey] failed:', err);
      showWindow();
    }
  });

  if (launchedAtLogin) {
    showFirstRunNotification();
    showWindow();
  } else if (store.get('firstRun')) {
    showFirstRunNotification();
    showWindow();
  } else {
    showWindow();
  }

  // Post-update announcement — fires after restart if AXIOM just self-updated
  const justUpdated = store.get('justUpdated');
  if (justUpdated) {
    store.delete('justUpdated');
    setTimeout(async () => {
      const { speak } = require('../services/speaker.js');
      let msg = `Hey, I'm back! Just updated myself to version ${justUpdated.version}.`;
      if (justUpdated.notes) {
        msg += ` Here's what changed: ${justUpdated.notes}`;
      } else {
        msg += ` Everything's fresh and ready to go.`;
      }
      await speak(msg).catch(() => {});
    }, 4500); // Wait for TTS and wakeword to fully initialize first
  }

  // Daily briefing — runs once on startup unless disabled in .env
  runDailyBriefing().catch((err) => console.error('[AXIOM briefing]', err));

  // Offline wake word ("Hey AX")
  startWakeWord();

  // Usage tracker — starts logging active window every 60 s
  usageTracker.start();

  // Performance monitor — enters light mode during gaming / high-CPU activity
  performanceMonitor.start((isGaming, reason) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('gaming-mode-changed', isGaming);
    }
    if (tray && !tray.isDestroyed()) {
      tray.setToolTip(isGaming ? 'AXIOM — Gaming Mode' : 'AXIOM — Voice Assistant');
    }
    if (isGaming) {
      // Silent toast — don't interrupt the game with speech
      new Notification({
        title: 'AXIOM — Gaming Mode',
        body: 'Running light. Voice still active.',
        icon: path.join(__dirname, '..', '..', 'assets', 'icon.png'),
        silent: true,
      }).show();
    } else {
      // Brief spoken announcement when resources free up
      try {
        const { speak } = require('../services/speaker.js');
        speak("Back to normal.").catch(() => {});
      } catch {}
    }
  });

  // Window activity monitor — suggests closing idle high-RAM apps
  windowMonitor.start(async (suggestion) => {
    const { speak } = require('../services/speaker.js');
    pendingWindowSuggestion = suggestion;

    // Show AXIOM and speak the suggestion
    if (mainWindow && !mainWindow.isDestroyed()) {
      revealInPlace();
      mainWindow.webContents.send('axiom-proactive', suggestion.speech);
    }

    // Speak — then activate listening so user can answer yes/no
    try {
      await speak(suggestion.speech);
    } catch {}

    // Only start listening if the suggestion is still pending
    // (user didn't already answer via another path)
    if (pendingWindowSuggestion && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('wake-word-activated');
    }
  }, usageTracker);

  // Proactive companion loop
  try {
    const { speak } = require('../services/speaker.js');
    const { generateProactive } = require('../services/brain.js');
    proactive.start({
      speak,
      generateProactive,
      sendToRenderer: (text) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          showWindow();
          mainWindow.webContents.send('axiom-proactive', text);
        }
      },
    });
  } catch (err) {
    console.error('[AXIOM proactive] init failed:', err);
  }

  // Sleep → hide AXIOM. Wake → bring it back.
  powerMonitor.on('suspend', async () => {
    console.log('[AXIOM] system suspending — hiding');
    await wakeword.stop();
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
  });
  powerMonitor.on('resume', async () => {
    console.log('[AXIOM] system resumed — showing');
    if (mainWindow && !mainWindow.isDestroyed()) {
      revealInPlace();
      // Short wake-up greeting (no full briefing)
      try {
        const { speak } = require('../services/speaker.js');
        const greetings = ['Hey, welcome back.', 'Back at it.', 'Welcome back.'];
        await speak(greetings[Math.floor(Math.random() * greetings.length)]);
      } catch {}
    }
    startWakeWord();
  });
});

async function startWakeWord() {
  const result = await wakeword.start(onWakeWordDetected, onInterruptDetected);
  if (!result.ok && !result.alreadyRunning) {
    console.warn('[AXIOM wakeword] not started:', result.error);
  }
}

function onInterruptDetected() {
  const { stop, isSpeaking } = require('../services/speaker.js');
  if (!isSpeaking()) return; // only act if AXIOM is actually talking
  console.log('[AXIOM] interrupted — stopping speech');
  stop();
  // Tell renderer to cancel current flow and start fresh listening
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('axiom-interrupted');
  }
}

function onWakeWordDetected() {
  // Small chime + reveal in-place + tell renderer to start listening
  playActivationChime();
  if (mainWindow && !mainWindow.isDestroyed()) {
    revealInPlace();
    mainWindow.webContents.send('wake-word-activated');
  }
}

function playActivationChime() {
  // Uses the built-in Windows "Asterisk" system sound — no file shipping needed.
  const ps = `powershell -NoProfile -WindowStyle Hidden -Command "[System.Media.SystemSounds]::Asterisk.Play()"`;
  exec(ps, { windowsHide: true }, () => {});
}

async function runDailyBriefing() {
  const enabled = (process.env.DAILY_BRIEFING || 'true').toLowerCase() !== 'false';
  if (!enabled) return;

  // Wait for the renderer to be ready
  await new Promise((resolve) => {
    if (mainWindow.webContents.isLoading()) {
      mainWindow.webContents.once('did-finish-load', resolve);
    } else {
      resolve();
    }
  });

  showWindow();

  const memory = require('../services/memory.js');

  // Same day re-open — short casual greeting, no full briefing
  if (memory.wasOpenedToday()) {
    console.log('[AXIOM briefing] already greeted today — short greeting');
    try {
      const { speak } = require('../services/speaker.js');
      const phrases = [
        "Hey, back again.",
        "What's up.",
        "I'm here.",
        "Ready when you are.",
        "Back at it.",
        "Hey.",
        "Yo, what's good.",
      ];
      await speak(phrases[Math.floor(Math.random() * phrases.length)]);
    } catch {}
    return;
  }

  memory.markOpenedToday();

  try {
    const { generateBriefing } = require('../services/brain.js');
    const { speak } = require('../services/speaker.js');

    const text = await generateBriefing();

    mainWindow.webContents.send('axiom-briefing', text);
    await speak(text);
  } catch (err) {
    console.error('[AXIOM briefing] failed:', err);
  }

  // Run any routines configured to trigger on startup
  try {
    const routines = require('../services/routines.js');
    const { speak } = require('../services/speaker.js');
    const { executeAction } = require('../services/pc-control.js');
    const startupRoutines = routines.findByTrigger('startup');
    for (const r of startupRoutines) {
      await routines.run(r, { speak, executeAction });
    }
  } catch (err) {
    console.error('[AXIOM startup routines]', err);
  }

  // One short morning motivation line (once per day) + opportunistic pattern nudge
  setTimeout(() => {
    proactive.morningMotivation().catch(() => {});
  }, 4000);
  setTimeout(() => {
    proactive.checkRecurringPattern().catch(() => {});
  }, 12000);

  // Window stays open after the briefing — user hides it manually via the X
  // button, Alt+Space, or the tray. No auto-hide.
}

ipcMain.on('user-active', () => {
  // kept for future use; no-op for now
});

app.on('will-quit', async () => {
  globalShortcut.unregisterAll();
  try {
    const { shutdown } = require('../services/speech.js');
    shutdown();
  } catch {}
  await wakeword.stop();
  proactive.stop();
  pomodoro.shutdown();
  terminalWatcher.shutdown();
  usageTracker.stop();
  windowMonitor.stop();
  performanceMonitor.stop();
});

app.on('window-all-closed', (e) => {
  e.preventDefault();
});

// ── Type text into active window ──────────────────────────────
// Defocuses AXIOM so the target window regains focus, then pastes via clipboard.
async function typeTextIntoActiveWindow(text) {
  if (!text) return;

  // Temporarily step back so the previous window can reclaim focus
  mainWindow.setAlwaysOnTop(false);
  mainWindow.blur();
  await new Promise(r => setTimeout(r, 650)); // longer settle so target window fully regains focus

  const { exec: execCmd } = require('child_process');
  const tmpFile = require('path').join(require('os').tmpdir(), `axiom-type-${Date.now()}.ps1`);

  // Use a here-string so no shell escaping is needed for the text content
  const safeText = text.replace(/`/g, '``');
  const script = [
    `$text = @'`,
    safeText,
    `'@`,
    `Add-Type -AssemblyName System.Windows.Forms`,
    `$prev = [System.Windows.Forms.Clipboard]::GetText()`,
    `[System.Windows.Forms.Clipboard]::SetText($text)`,
    `Start-Sleep -Milliseconds 250`,
    `[System.Windows.Forms.SendKeys]::SendWait('^v')`,
    `Start-Sleep -Milliseconds 400`,
    `if ($prev) { [System.Windows.Forms.Clipboard]::SetText($prev) } else { [System.Windows.Forms.Clipboard]::Clear() }`,
  ].join('\r\n');

  await new Promise((resolve) => {
    require('fs').writeFile(tmpFile, script, 'utf8', (writeErr) => {
      if (writeErr) { resolve(); return; }
      execCmd(
        `powershell -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "${tmpFile}"`,
        { windowsHide: true },
        () => {
          require('fs').unlink(tmpFile, () => {});
          resolve();
        }
      );
    });
  });

  // Restore always-on-top
  mainWindow.setAlwaysOnTop(true, windowPinned ? 'screen-saver' : 'floating');
}

// ── Clipboard intent handler ──────────────────────────────────
// Returns a reply string if the message is a clipboard command, or null to fall through.
async function handleClipboardIntent(message) {
  const { needsClipboard, sendMessageWithClipboard } = require('../services/brain.js');
  const intent = needsClipboard(message);
  if (!intent) return null;

  if (intent === 'copy_that') {
    if (!lastAxiomResponse) return "I don't have anything to copy yet. Ask me something first.";
    clipboardService.write(lastAxiomResponse);
    const reply = "Copied to your clipboard.";
    lastAxiomResponse = reply;
    return reply;
  }

  if (intent === 'save_that') {
    if (!lastAxiomResponse) return "Nothing to save yet. Ask me something first.";
    try {
      const filePath = clipboardService.saveToFile(lastAxiomResponse);
      const reply = `Saved to your Documents AXIOM folder as ${path.basename(filePath)}.`;
      lastAxiomResponse = reply;
      return reply;
    } catch (err) {
      return `Hmm, couldn't save the file. ${err.message}`;
    }
  }

  if (intent === 'previous') {
    const prev = clipboardService.getPrevious();
    if (!prev) {
      const reply = "I only have one clipboard entry so far. Copy something else and try again.";
      lastAxiomResponse = reply;
      return reply;
    }
    const preview = prev.length > 120 ? `${prev.slice(0, 120)}...` : prev;
    const reply = `The last thing you copied before that was: ${preview}`;
    lastAxiomResponse = reply;
    return reply;
  }

  if (intent === 'read_aloud') {
    const clipText = clipboardService.read();
    if (!clipText || !clipText.trim()) return "Your clipboard is empty right now.";
    lastAxiomResponse = clipText;
    if (clipText.length > 600) {
      return `${clipText.slice(0, 600)}... That's the first part. Say "AX save that" to save the full text to a file.`;
    }
    return clipText;
  }

  // For explain / explain_detail / translate / summarize / fix / improve
  const clipText = clipboardService.read();
  if (!clipText || !clipText.trim()) {
    return "Your clipboard seems to be empty. Copy some text first, then ask me again.";
  }

  const result = await sendMessageWithClipboard(message, clipText, intent);
  let speech = result.speech;

  // Long response: truncate spoken reply, store full text for "save that"
  if (speech.length > 450) {
    lastAxiomResponse = speech;
    const words = speech.split(/\s+/);
    speech = `${words.slice(0, 65).join(' ')}... That's the short version. Say "AX save that" to get the full answer saved to a file.`;
  } else {
    lastAxiomResponse = speech;
  }

  return speech;
}

// ── Blender error → human speech ─────────────────────────────
function blenderErrorToSpeech(raw) {
  if (!raw) return "Something went wrong in Blender.";
  if (/NoneType|has no attribute|'None'/i.test(raw))
    return "Blender couldn't grab the object — nothing was active. Try selecting an object first, or rephrase the command.";
  if (/context_error|invalid context|RuntimeError.*context/i.test(raw))
    return "Blender context error — make sure you're in the 3D viewport with the MCP server running.";
  if (/OperatorCallError|cannot execute|restricted/i.test(raw))
    return "Blender blocked that operation. Try a simpler version of the command.";
  if (/SyntaxError/i.test(raw))
    return "There was a syntax error in the generated code. Try rephrasing what you want.";
  if (/KeyError/i.test(raw))
    return "Blender couldn't find a node or property — the material setup might differ in Blender 5.";
  if (/bpy_struct.*item\.attr|item\.attr = val/i.test(raw))
    return "Blender rejected a property value — the material node indices were wrong. Try rephrasing.";
  // Generic — strip Python traceback noise, just give the last useful line
  const lines = raw.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('Traceback') && !l.startsWith('File ') && !l.startsWith('line '));
  const useful = lines[lines.length - 1] || raw;
  return `Blender error — ${useful.slice(0, 80)}`;
}

// ── Self-update ───────────────────────────────────────────────
// Packaged (installed) app  → electron-updater checks GitHub Releases,
//                             downloads silently, restarts.
// Dev (running from source) → git pull + npm install + app.relaunch().

async function handleSelfUpdate() {
  const { speak: speakDirect } = require('../services/speaker.js');

  if (app.isPackaged) {
    await handlePackagedUpdate(speakDirect);
  } else {
    await handleDevUpdate(speakDirect);
  }
}

async function handlePackagedUpdate(speak) {
  try {
    const { autoUpdater } = require('electron-updater');

    autoUpdater.autoDownload        = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.logger              = null; // silence file logs

    // Pass GitHub token so updates work with private repos
    if (process.env.GH_TOKEN) {
      autoUpdater.requestHeaders = { Authorization: `token ${process.env.GH_TOKEN}` };
    }

    // IPC handler already said "Checking for updates" — go straight to checking
    const result = await autoUpdater.checkForUpdates();
    const info   = result?.updateInfo;

    if (!info || info.version === app.getVersion()) {
      await speak(`All good — you're already on the latest version.`);
      return;
    }

    await speak(`New version ${info.version} found. Downloading now, I'll restart when it's ready.`);

    const downloadedInfo = await new Promise((resolve, reject) => {
      autoUpdater.once('update-downloaded', resolve);
      autoUpdater.once('error', reject);
      autoUpdater.downloadUpdate();
    });

    // Save what's new so AXIOM can announce it after restart
    const rawNotes = downloadedInfo?.releaseNotes || downloadedInfo?.releaseName || info.releaseNotes || null;
    const cleanNotes = rawNotes
      ? String(Array.isArray(rawNotes) ? rawNotes.map(n => n.note || n).join(' ') : rawNotes)
          .replace(/<[^>]+>/g, '').replace(/\n+/g, ' ').trim().slice(0, 280)
      : null;
    store.set('justUpdated', { version: info.version, notes: cleanNotes });

    await speak('All set — update downloaded. Restarting now.');
    await new Promise(r => setTimeout(r, 1800));
    autoUpdater.quitAndInstall(true /* silent */, true /* restart */);

  } catch (err) {
    const msg = err?.message || String(err);
    if (/Cannot find module/.test(msg)) {
      await speak('electron-updater is not installed yet. Run npm install in the axiom folder first.').catch(() => {});
    } else {
      await speak(`Update check failed — ${msg.slice(0, 80)}`).catch(() => {});
    }
  }
}

async function handleDevUpdate(speak) {
  const APP_DIR = path.join(__dirname, '..', '..');

  const git = (args) => new Promise((resolve, reject) => {
    exec(`git ${args}`, { cwd: APP_DIR, windowsHide: true }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || err.message || '').trim().slice(0, 120)));
      else resolve((stdout || '').trim());
    });
  });

  try {
    await git('fetch');

    const behind = await git('rev-list HEAD..origin/HEAD --count').catch(() => '0');

    if (!behind || behind === '0') {
      await speak("All good — you're already on the latest version.");
      return;
    }

    const changed    = await git('diff --name-only HEAD..origin/HEAD').catch(() => '');
    const needsInstall = changed.includes('package.json');
    const count      = parseInt(behind, 10);

    await speak(`Found ${count} new update${count !== 1 ? 's' : ''}. Pulling now.`);
    await git('pull');

    if (needsInstall) {
      await speak('New packages detected — installing dependencies. Give me a minute.');
      await new Promise((resolve, reject) => {
        exec('npm install', { cwd: APP_DIR, windowsHide: true }, (err) => {
          if (err) reject(err); else resolve();
        });
      });
    }

    await speak('All set — update installed. Restarting now.');
    await new Promise(r => setTimeout(r, 1800));
    app.relaunch();
    app.exit(0);

  } catch (err) {
    await speak(`Update failed — ${err.message.slice(0, 80)}`).catch(() => {});
  }
}

// ── IPC handlers ─────────────────────────────────────────────

ipcMain.handle('send-to-claude', async (_event, message) => {
  const { sendMessage, summarizeSearchResults, isPastMemoryQuery } = require('../services/brain.js');
  const { executeAction } = require('../services/pc-control.js');
  const { speak } = require('../services/speaker.js');

  proactive.recordInteraction();

  // ── Past-memory recall: speak a natural thinking pause first ─
  if (isPastMemoryQuery(message)) {
    const phrases = [
      "Give me a second, let me look back.",
      "One sec, searching through our history.",
      "Hold on, let me check.",
      "Give me a moment.",
      "Let me look back real quick.",
    ];
    try {
      await speak(phrases[Math.floor(Math.random() * phrases.length)]);
    } catch {}
  }

  // ── Window-close suggestion response ─────────────────────
  if (pendingWindowSuggestion) {
    const suggestion = pendingWindowSuggestion;

    if (CLOSE_NEVER.test(message)) {
      pendingWindowSuggestion = null;
      activityTracker.protect(suggestion.exe);
      activityTracker.recordDecision(suggestion.exe, false);
      const reply = `Got it — I'll never suggest closing ${suggestion.label} again.`;
      lastAxiomResponse = reply;
      return { speech: reply, needsReply: false };
    }

    if (CLOSE_YES.test(message)) {
      pendingWindowSuggestion = null;
      activityTracker.recordDecision(suggestion.exe, true);
      const toClose = suggestion.all && suggestion.all.length >= 3 ? suggestion.all : [suggestion];
      const labels  = toClose.map(a => a.label).join(', ');
      for (const app of toClose) {
        try { await executeAction({ type: 'close_app', app: app.label }); } catch {}
        activityTracker.recordDecision(app.exe, true);
      }
      const reply = toClose.length > 1
        ? `Closed ${labels}. That freed up some RAM.`
        : `${suggestion.label} is closed.`;
      lastAxiomResponse = reply;
      return { speech: reply, needsReply: false };
    }

    if (CLOSE_NO.test(message)) {
      pendingWindowSuggestion = null;
      activityTracker.recordDecision(suggestion.exe, false);
      const reply = `No problem, leaving ${suggestion.label} open.`;
      lastAxiomResponse = reply;
      return { speech: reply, needsReply: false };
    }

    // User said something else — inject suggestion context so Claude understands
    // what the user is responding to, then fall through to normal Claude handling.
    const _sugg = pendingWindowSuggestion;
    pendingWindowSuggestion = null;
    message = `[AXIOM just asked: "${_sugg.speech}" — user replied:] ${message}`;
  }

  // ── Clipboard intent check ────────────────────────────────
  const clipboardReply = await handleClipboardIntent(message);
  if (clipboardReply !== null) return { speech: clipboardReply, needsReply: false };

  const result = await sendMessage(message);

  // ── Multi-action: execute actions sequentially ───────────────
  if (result.actions && result.actions.length > 1) {
    const { executeAction } = require('../services/pc-control.js');
    const MULTI_DELAYS = { open_app: 2500, close_app: 1000, run_command: 1500 };
    const MULTI_MOUSE  = new Set(['mouse_click','mouse_right_click','mouse_double_click','mouse_scroll','mouse_move']);

    for (let i = 0; i < result.actions.length; i++) {
      const act = result.actions[i];

      if (act.type === 'type_text') {
        await typeTextIntoActiveWindow(act.text || '');
      } else if (act.type === 'send_keys' || MULTI_MOUSE.has(act.type)) {
        if (MULTI_MOUSE.has(act.type)) {
          const { scaleFactor } = screen.getPrimaryDisplay();
          act.scaleFactor = scaleFactor;
        }
        mainWindow.setAlwaysOnTop(false);
        mainWindow.blur();
        await new Promise(r => setTimeout(r, 250));
        await executeAction(act);
        mainWindow.setAlwaysOnTop(true, windowPinned ? 'screen-saver' : 'floating');
      } else if (act.type === 'web_search') {
        // Silent search in multi-action context — result folds into AXIOM's spoken line
        try {
          const { search } = require('../services/search.js');
          await search(act.query, act.hint || 'general');
        } catch {}
      } else if (act.type === 'pin_window') {
        windowPinned = true;
        mainWindow.setAlwaysOnTop(true, 'screen-saver');
      } else if (act.type === 'unpin_window') {
        windowPinned = false;
        mainWindow.setAlwaysOnTop(true, 'floating');
      } else if (act.type === 'brainstorm_start') {
        // Not meaningful in multi-action — skip
      } else {
        const ar = await executeAction(act);
        if (!ar.success) {
          const errReply = `Started, but hit a snag on step ${i + 1}. ${ar.error || ''}`.trim();
          lastAxiomResponse = errReply;
          return { speech: errReply, needsReply: false };
        }
      }

      // Wait between actions (not after the last one)
      if (i < result.actions.length - 1) {
        const delay = MULTI_DELAYS[act.type] ?? 700;
        await new Promise(r => setTimeout(r, delay));
      }
    }

    lastAxiomResponse = result.speech;
    return { speech: result.speech, needsReply: result.needsReply || false };
  }

  if (result.action) {
    // Brainstorm: tell renderer to enter extended recording mode
    if (result.action.type === 'brainstorm_start') {
      const mode = result.action.mode || 'general';
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('brainstorm-start', mode);
      }
      lastAxiomResponse = result.speech;
      return { speech: result.speech, needsReply: false };
    }

    // ── Blender 3D scene query ────────────────────────────────
    if (result.action.type === 'blender_query') {
      const blender = require('../services/blender.js');
      if (!(await blender.isRunning())) {
        const msg = "Blender's MCP server isn't running. Open Blender, press N, go to the BlenderMCP tab and click Start MCP Server.";
        lastAxiomResponse = msg;
        return { speech: msg, needsReply: false };
      }
      try {
        const desc = await blender.describeScene();
        lastAxiomResponse = desc;
        return { speech: desc, needsReply: false };
      } catch (err) {
        const msg = `Couldn't read the scene — ${err.message.slice(0, 80)}`;
        lastAxiomResponse = msg;
        return { speech: msg, needsReply: false };
      }
    }

    // ── Blender 3D command ────────────────────────────────────
    if (result.action.type === 'blender') {
      const blender = require('../services/blender.js');
      if (!(await blender.isRunning())) {
        const msg = "Blender's MCP server isn't running. Open Blender, press N, go to the BlenderMCP tab and click Start MCP Server.";
        lastAxiomResponse = msg;
        return { speech: msg, needsReply: false };
      }
      const code = result.action.code || '';
      if (!code.trim()) {
        const msg = "Hmm, I couldn't figure out the right command for that. Try rephrasing.";
        lastAxiomResponse = msg;
        return { speech: msg, needsReply: false };
      }
      // Show working indicator in renderer UI
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('axiom-working', 'Working in Blender...');
      }
      // Speak a short natural phrase — NEVER read code or Claude's verbose text
      const workPhrases = [
        "Give me a second.",
        "On it.",
        "Working on it.",
        "Hold on a second.",
        "Give me a moment.",
      ];
      await speak(workPhrases[Math.floor(Math.random() * workPhrases.length)]);
      try {
        const blResult = await blender.executeCode(code);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('axiom-working', null);
        }
        if (blResult && blResult.status === 'error') {
          // blResult.error may be undefined — fall back to blResult.message
          const raw = blResult.error || blResult.message || '';
          const errMsg = blenderErrorToSpeech(raw);
          lastAxiomResponse = errMsg;
          return { speech: errMsg, needsReply: false };
        }
        // Bring Blender to foreground so Alexis sees the result
        blender.focusWindow();
        // Speak the task description as the completion phrase
        const doneMsg = (result.action.task || 'Done.').slice(0, 80);
        lastAxiomResponse = doneMsg;
        return { speech: doneMsg, needsReply: false };
      } catch (err) {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('axiom-working', null);
        }
        const isTimeout = /timed out/i.test(err?.message || '');
        const msg = isTimeout
          ? "Blender took too long — the script might be too complex. Try breaking it into smaller steps."
          : "Lost contact with Blender — is the server still running?";
        lastAxiomResponse = msg;
        return { speech: msg, needsReply: false };
      }
    }

    // Web search: speak the placeholder first, then fetch + summarize
    if (result.action.type === 'web_search') {
      const { search } = require('../services/search.js');
      await speak(result.speech || 'Let me look that up.');
      try {
        const raw = await search(result.action.query, result.action.hint || 'general');
        const summary = await summarizeSearchResults(result.action.query, raw);
        lastAxiomResponse = summary;
        return { speech: summary, needsReply: false };
      } catch (err) {
        console.error('[AXIOM search]', err.message);
        return { speech: "Hmm, I ran into an issue with the search. Check your Serper API key in .env.", needsReply: false };
      }
    }

    // Self-update: git pull + npm install + relaunch
    if (result.action.type === 'update_self') {
      setTimeout(() => handleSelfUpdate().catch(console.error), 600);
      const reply = 'Checking for updates, one second.';
      lastAxiomResponse = reply;
      return { speech: reply, needsReply: false };
    }

    // Pin / unpin window via voice command
    if (result.action.type === 'pin_window') {
      windowPinned = true;
      mainWindow.setAlwaysOnTop(true, 'screen-saver');
      lastAxiomResponse = result.speech;
      return { speech: result.speech, needsReply: false };
    }
    if (result.action.type === 'unpin_window') {
      windowPinned = false;
      mainWindow.setAlwaysOnTop(true, 'floating');
      lastAxiomResponse = result.speech;
      return { speech: result.speech, needsReply: false };
    }

    // Type text or send keys into previously focused window
    if (result.action.type === 'type_text') {
      await typeTextIntoActiveWindow(result.action.text || '');
      lastAxiomResponse = result.speech;
      return { speech: result.speech, needsReply: result.needsReply || false };
    }

    if (result.action.type === 'send_keys') {
      mainWindow.setAlwaysOnTop(false);
      mainWindow.blur();
      await new Promise(r => setTimeout(r, 350));
      // fall through to executeAction which calls sendKeys
    }

    // Mouse actions: inject scaleFactor and defocus AXIOM window first
    const MOUSE_ACTIONS = new Set(['mouse_click','mouse_right_click','mouse_double_click','mouse_scroll','mouse_move']);
    if (MOUSE_ACTIONS.has(result.action.type)) {
      const { scaleFactor } = screen.getPrimaryDisplay();
      result.action.scaleFactor = scaleFactor;
      mainWindow.setAlwaysOnTop(false);
      mainWindow.blur();
      await new Promise(r => setTimeout(r, 200));
    }

    const actionResult = await executeAction(result.action);
    console.log('[AXIOM action]', result.action.type, actionResult);

    // Restore always-on-top after key-sending or mouse actions
    if (result.action.type === 'send_keys' || MOUSE_ACTIONS.has(result.action.type)) {
      mainWindow.setAlwaysOnTop(true, windowPinned ? 'screen-saver' : 'floating');
    }

    if (!actionResult.success) {
      const errReply = `Hmm, I tried but it didn't work. ${actionResult.error || 'Windows blocked the command.'}`;
      lastAxiomResponse = errReply;
      return { speech: errReply, needsReply: false };
    }

    // Environment actions that return list data — build spoken reply
    const ENV_LIST_ACTIONS = new Set(['bt_list', 'wifi_list', 'audio_list']);
    if (ENV_LIST_ACTIONS.has(result.action.type)) {
      const items = actionResult.devices || actionResult.networks || [];
      const listSpeech = items.length
        ? `${items.slice(0, 6).join(', ')}.`
        : 'Nothing found.';
      const prefix = result.action.type === 'bt_list'    ? 'Bluetooth devices: '
                   : result.action.type === 'wifi_list'  ? 'Available networks: '
                   : 'Audio devices: ';
      const speech = prefix + listSpeech;
      lastAxiomResponse = speech;
      return { speech, needsReply: false };
    }

    // audio_switch may return a note
    if (result.action.type === 'audio_switch' && actionResult.note) {
      const speech = actionResult.note;
      lastAxiomResponse = speech;
      return { speech, needsReply: false };
    }
  }

  lastAxiomResponse = result.speech;
  console.log(`[AXIOM reply] needsReply=${result.needsReply} speech="${result.speech?.slice(0,80)}"`);
  return { speech: result.speech, needsReply: result.needsReply || false };
});

ipcMain.handle('speak-text', async (_event, text) => {
  const { speak } = require('../services/speaker.js');
  return speak(text, () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('speaking-started');
    }
  });
});

ipcMain.handle('stop-speaking', async () => {
  const { stop } = require('../services/speaker.js');
  stop();
});

// ── Screen capture ──────────────────────────────────────────
async function captureScreenshot() {
  const { width, height } = screen.getPrimaryDisplay().size;
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width, height },
  });
  if (!sources.length) throw new Error('No screen sources available');
  // Pick the primary display (first source)
  const img = sources[0].thumbnail;
  // Return base64 PNG (no data: prefix)
  return img.toPNG().toString('base64');
}

ipcMain.handle('capture-screen', async () => {
  try {
    return { ok: true, base64: await captureScreenshot() };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('send-to-claude-with-screen', async (_event, { text, base64 }) => {
  const { sendMessageWithImage } = require('../services/brain.js');
  const { executeAction } = require('../services/pc-control.js');

  proactive.recordInteraction();

  // Clipboard intents take priority — e.g. "read this to me" may arrive here
  const clipboardReply = await handleClipboardIntent(text);
  if (clipboardReply !== null) return { speech: clipboardReply, needsReply: false };

  let b64 = base64;
  try {
    if (!b64) b64 = await captureScreenshot();
    const result = await sendMessageWithImage(text, b64);

    if (result.action) {
      const MOUSE_ACTIONS_SCREEN = new Set(['mouse_click','mouse_right_click','mouse_double_click','mouse_scroll','mouse_move']);
      if (MOUSE_ACTIONS_SCREEN.has(result.action.type)) {
        const { scaleFactor } = screen.getPrimaryDisplay();
        result.action.scaleFactor = scaleFactor;
        mainWindow.setAlwaysOnTop(false);
        mainWindow.blur();
        await new Promise(r => setTimeout(r, 200));
      }

      const actionResult = await executeAction(result.action);
      console.log('[AXIOM action]', result.action.type, actionResult);

      if (MOUSE_ACTIONS_SCREEN.has(result.action.type)) {
        mainWindow.setAlwaysOnTop(true, windowPinned ? 'screen-saver' : 'floating');
      }

      if (!actionResult.success) {
        const errReply = `Hmm, I tried but it didn't work. ${actionResult.error || 'Windows blocked the command.'}`;
        lastAxiomResponse = errReply;
        return { speech: errReply, needsReply: false };
      }
    }
    lastAxiomResponse = result.speech;
    return { speech: result.speech, needsReply: result.needsReply || false };
  } finally {
    // Nothing is persisted — the base64 lives in memory only and is
    // released when this handler returns. Scrub the local reference.
    b64 = null;
  }
});

ipcMain.handle('transcribe-audio', async (_event, arrayBuffer, isWav = true) => {
  try {
    if (!arrayBuffer || arrayBuffer.byteLength < 1000) {
      return { error: 'no-speech' };
    }
    const buffer = Buffer.from(arrayBuffer);

    // ── Voice authentication (if server is running) ───────────
    const auth = await voiceAuth.verify(buffer);
    if (auth.available && !auth.verified) {
      console.warn(`[VoiceAuth] Rejected — score: ${auth.score}`);
      return { error: 'voice-not-authorized', score: auth.score };
    }

    const audioName = isWav ? 'audio.wav' : 'audio.webm';
    const audioType = isWav ? 'audio/wav' : 'audio/webm';
    const file = await toFile(buffer, audioName, { type: audioType });

    const result = await getOpenAI().audio.transcriptions.create({
      file,
      model: 'whisper-1',
    });

    const text = (result.text || '').trim();
    if (!text) return { error: 'no-speech' };
    return { text };
  } catch (err) {
    console.error('[whisper] error:', err);
    return { error: err.message || 'whisper-failed' };
  }
});

ipcMain.handle('process-brainstorm', async (_event, { arrayBuffer, mode }) => {
  const OpenAI = require('openai');
  const { toFile } = require('openai/uploads');
  const { processThoughts } = require('../services/brainstorm.js');

  try {
    if (!arrayBuffer || arrayBuffer.byteLength < 1000) {
      return "Hmm, I didn't catch anything. Want to try again?";
    }

    const buffer = Buffer.from(arrayBuffer);
    const file   = await toFile(buffer, 'audio.wav', { type: 'audio/wav' });
    const result = await getOpenAI().audio.transcriptions.create({ file, model: 'whisper-1' });
    const text   = (result.text || '').trim();

    if (!text) return "I didn't catch what you said. Try again?";

    return await processThoughts(text, mode || 'general');
  } catch (err) {
    console.error('[AXIOM brainstorm IPC]', err.message);
    return "Something went wrong processing your thoughts. Sorry about that.";
  }
});

ipcMain.on('window-minimize', () => {
  mainWindow.hide();
});

ipcMain.on('move-window-by', (e, dx, dy) => {
  const [x, y] = mainWindow.getPosition();
  mainWindow.setPosition(x + Math.round(dx), y + Math.round(dy));
});

ipcMain.on('set-ignore-mouse-events', (_e, ignore) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    // forward:true keeps mousemove events coming so we can re-enable when cursor returns
    mainWindow.setIgnoreMouseEvents(ignore, { forward: true });
  }
});

ipcMain.handle('toggle-pin', () => {
  windowPinned = !windowPinned;
  // Pinned = screen-saver level (above full-screen apps too)
  // Unpinned = floating (normal always-on-top, other normal windows can't cover it)
  mainWindow.setAlwaysOnTop(true, windowPinned ? 'screen-saver' : 'floating');
  mainWindow.webContents.send('pin-changed', windowPinned);
  return windowPinned;
});
