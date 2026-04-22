const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('axiom', {
  sendToClaude: (message) => ipcRenderer.invoke('send-to-claude', message),
  sendToClaudeWithScreen: (text, base64) =>
    ipcRenderer.invoke('send-to-claude-with-screen', { text, base64 }),
  captureScreen: () => ipcRenderer.invoke('capture-screen'),
  transcribeAudio: (arrayBuffer, isWav) => ipcRenderer.invoke('transcribe-audio', arrayBuffer, isWav),
  speakText: (text) => ipcRenderer.invoke('speak-text', text),
  stopSpeaking: () => ipcRenderer.invoke('stop-speaking'),
  runCommand: (command) => ipcRenderer.invoke('run-command', command),
  minimize: () => ipcRenderer.send('window-minimize'),
  togglePin: () => ipcRenderer.invoke('toggle-pin'),
  onPinChanged: (cb) => ipcRenderer.on('pin-changed', (_e, pinned) => cb(pinned)),
  userActive: () => ipcRenderer.send('user-active'),
  onBriefing: (cb) => ipcRenderer.on('axiom-briefing', (_e, text) => cb(text)),
  onWakeWord: (cb) => ipcRenderer.on('wake-word-activated', () => cb()),
  onScreenHotkey: (cb) => ipcRenderer.on('screen-hotkey', (_e, base64) => cb(base64)),
  onProactive: (cb) => ipcRenderer.on('axiom-proactive', (_e, text) => cb(text)),
  onBrainstormStart: (cb) => ipcRenderer.on('brainstorm-start', (_e, mode) => cb(mode)),
  onWindowMoving: (cb) => ipcRenderer.on('window-moving', (_e, moving) => cb(moving)),
  onInterrupted: (cb) => ipcRenderer.on('axiom-interrupted', () => cb()),
  onSpeakingStarted: (cb) => ipcRenderer.on('speaking-started', () => cb()),
  onGamingMode: (cb) => ipcRenderer.on('gaming-mode-changed', (_e, active) => cb(active)),
  onWorking: (cb) => ipcRenderer.on('axiom-working', (_e, label) => cb(label)),
  moveWindowBy: (dx, dy) => ipcRenderer.send('move-window-by', dx, dy),
  setIgnoreMouseEvents: (ignore) => ipcRenderer.send('set-ignore-mouse-events', ignore),
  processBrainstorm: (arrayBuffer, mode) => ipcRenderer.invoke('process-brainstorm', { arrayBuffer, mode }),
});
