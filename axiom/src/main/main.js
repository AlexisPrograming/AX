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
    width: 240,
    height: 300,
    show: false,
    frame: false,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    transparent: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  // Raise to front when focused (keeps it above whatever was just clicked)
  mainWindow.on('focus', () => {
    mainWindow.setAlwaysOnTop(true, windowPinned ? 'screen-saver' : 'floating');
    mainWindow.moveTop();
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
  const { width: screenW, height: screenH } = screen.getPrimaryDisplay().workAreaSize;
  const [winW, winH] = mainWindow.getSize();
  mainWindow.setPosition(screenW - winW - 12, screenH - winH - 12);
  mainWindow.show();
  mainWindow.focus();
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
  } else if (store.get('firstRun')) {
    showFirstRunNotification();
    showWindow();
  } else {
    showWindow();
  }

  // Daily briefing — runs once on startup unless disabled in .env
  runDailyBriefing().catch((err) => console.error('[AXIOM briefing]', err));

  // Offline wake word ("Hey AX")
  startWakeWord();

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

  // Keep the wake-word listener alive across sleep/wake cycles
  powerMonitor.on('suspend', async () => {
    console.log('[AXIOM] system suspending — stopping wake word');
    await wakeword.stop();
  });
  powerMonitor.on('resume', () => {
    console.log('[AXIOM] system resumed — restarting wake word');
    startWakeWord();
  });
});

async function startWakeWord() {
  const result = await wakeword.start(onWakeWordDetected);
  if (!result.ok && !result.alreadyRunning) {
    console.warn('[AXIOM wakeword] not started:', result.error);
  }
}

function onWakeWordDetected() {
  // Small chime + show window + tell renderer to start listening
  playActivationChime();
  if (mainWindow && !mainWindow.isDestroyed()) {
    showWindow();
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

  try {
    const { generateBriefing } = require('../services/brain.js');
    const { speak } = require('../services/speaker.js');

    const text = await generateBriefing();

    // Display in the chat panel
    mainWindow.webContents.send('axiom-briefing', text);

    // Speak it
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
});

app.on('window-all-closed', (e) => {
  e.preventDefault();
});

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

// ── IPC handlers ─────────────────────────────────────────────

ipcMain.handle('send-to-claude', async (_event, message) => {
  const { sendMessage, summarizeSearchResults } = require('../services/brain.js');
  const { executeAction } = require('../services/pc-control.js');
  const { speak } = require('../services/speaker.js');

  proactive.recordInteraction();

  // ── Clipboard intent check ────────────────────────────────
  const clipboardReply = await handleClipboardIntent(message);
  if (clipboardReply !== null) return { speech: clipboardReply, needsReply: false };

  const result = await sendMessage(message);

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

    const actionResult = await executeAction(result.action);
    console.log('[AXIOM action]', result.action.type, actionResult);

    if (!actionResult.success) {
      const errReply = `Hmm, I tried but it didn't work. ${actionResult.error || 'Windows blocked the command.'}`;
      lastAxiomResponse = errReply;
      return { speech: errReply, needsReply: false };
    }
  }

  lastAxiomResponse = result.speech;
  return { speech: result.speech, needsReply: result.needsReply || false };
});

ipcMain.handle('speak-text', async (_event, text) => {
  const { speak } = require('../services/speaker.js');
  return speak(text);
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
      const actionResult = await executeAction(result.action);
      console.log('[AXIOM action]', result.action.type, actionResult);

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

ipcMain.handle('transcribe-audio', async (_event, arrayBuffer) => {
  try {
    if (!arrayBuffer || arrayBuffer.byteLength < 1000) {
      return { error: 'no-speech' };
    }
    const buffer = Buffer.from(arrayBuffer);
    const file = await toFile(buffer, 'audio.webm', { type: 'audio/webm' });

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
  const { transcribeAudio } = ipcMain; // reuse transcription via direct call
  const OpenAI = require('openai');
  const { toFile } = require('openai/uploads');
  const { processThoughts } = require('../services/brainstorm.js');

  try {
    if (!arrayBuffer || arrayBuffer.byteLength < 1000) {
      return "Hmm, I didn't catch anything. Want to try again?";
    }

    const buffer = Buffer.from(arrayBuffer);
    const file   = await toFile(buffer, 'audio.webm', { type: 'audio/webm' });
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

ipcMain.handle('toggle-pin', () => {
  windowPinned = !windowPinned;
  // Pinned = screen-saver level (above full-screen apps too)
  // Unpinned = floating (normal always-on-top, other normal windows can't cover it)
  mainWindow.setAlwaysOnTop(true, windowPinned ? 'screen-saver' : 'floating');
  mainWindow.webContents.send('pin-changed', windowPinned);
  return windowPinned;
});
