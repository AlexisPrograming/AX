const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, screen, Notification } = require('electron');
const path = require('path');
const Store = require('electron-store');

const dotenvPath = app.isPackaged
  ? path.join(process.resourcesPath, '.env')
  : path.join(__dirname, '..', '..', '.env');
require('dotenv').config({ path: dotenvPath });

const store = new Store({ defaults: { autoLaunch: true, firstRun: true } });

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
  createWindow();
  createTray();
  applyAutoLaunch(store.get('autoLaunch'));

  globalShortcut.register('Alt+Space', () => {
    toggleWindow();
  });

  if (launchedAtLogin) {
    showFirstRunNotification();
  } else if (store.get('firstRun')) {
    showFirstRunNotification();
    showWindow();
  } else {
    showWindow();
  }
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  const { shutdown } = require('../services/speech.js');
  shutdown();
});

app.on('window-all-closed', (e) => {
  e.preventDefault();
});

// ── IPC handlers ─────────────────────────────────────────────

ipcMain.handle('send-to-claude', async (_event, message) => {
  const { sendMessage } = require('../services/brain.js');
  const { executeAction } = require('../services/pc-control.js');

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

ipcMain.handle('start-listening', async () => {
  const { recognize } = require('../services/speech.js');
  return recognize();
});

ipcMain.handle('stop-listening', async () => {
  const { stopListening } = require('../services/speech.js');
  stopListening();
});

ipcMain.on('window-minimize', () => {
  mainWindow.hide();
});
