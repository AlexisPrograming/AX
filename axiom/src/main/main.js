const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, screen, Notification, session, powerMonitor, shell, desktopCapturer } = require('electron');
const path = require('path');
const { exec } = require('child_process');
const Store = require('electron-store');
const OpenAI = require('openai');
const { toFile } = require('openai/uploads');
const wakeword = require('../services/wakeword.js');
const proactive = require('../services/proactive.js');

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
    width: 400,
    height: 600,
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

function buildTrayMenu() {
  const autoLaunch = store.get('autoLaunch');

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Show AXIOM', click: () => showWindow() },
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
    { label: 'Quit', click: () => { app.isQuitting = true; app.quit(); } },
  ]);

  tray.setContextMenu(contextMenu);
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
});

app.on('window-all-closed', (e) => {
  e.preventDefault();
});

// ── IPC handlers ─────────────────────────────────────────────

ipcMain.handle('send-to-claude', async (_event, message) => {
  const { sendMessage } = require('../services/brain.js');
  const { executeAction } = require('../services/pc-control.js');

  proactive.recordInteraction();
  const result = await sendMessage(message);

  if (result.action) {
    const actionResult = await executeAction(result.action);
    console.log('[AXIOM action]', result.action.type, actionResult);
  }

  return result.speech;
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
  let b64 = base64;
  try {
    if (!b64) b64 = await captureScreenshot();
    const result = await sendMessageWithImage(text, b64);

    if (result.action) {
      const actionResult = await executeAction(result.action);
      console.log('[AXIOM action]', result.action.type, actionResult);
    }
    return result.speech;
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

ipcMain.on('window-minimize', () => {
  mainWindow.hide();
});
