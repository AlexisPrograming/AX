const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('axiom', {
  sendToClaude: (message) => ipcRenderer.invoke('send-to-claude', message),
  sendToClaudeWithScreen: (text, base64) =>
    ipcRenderer.invoke('send-to-claude-with-screen', { text, base64 }),
  captureScreen: () => ipcRenderer.invoke('capture-screen'),
  transcribeAudio: (arrayBuffer) => ipcRenderer.invoke('transcribe-audio', arrayBuffer),
  speakText: (text) => ipcRenderer.invoke('speak-text', text),
  stopSpeaking: () => ipcRenderer.invoke('stop-speaking'),
  runCommand: (command) => ipcRenderer.invoke('run-command', command),
  minimize: () => ipcRenderer.send('window-minimize'),
  userActive: () => ipcRenderer.send('user-active'),
  onBriefing: (cb) => ipcRenderer.on('axiom-briefing', (_e, text) => cb(text)),
  onWakeWord: (cb) => ipcRenderer.on('wake-word-activated', () => cb()),
  onScreenHotkey: (cb) => ipcRenderer.on('screen-hotkey', (_e, base64) => cb(base64)),
  onProactive: (cb) => ipcRenderer.on('axiom-proactive', (_e, text) => cb(text)),
});
