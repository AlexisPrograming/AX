const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('axiom', {
  sendToClaude: (message) => ipcRenderer.invoke('send-to-claude', message),
  transcribeAudio: (arrayBuffer) => ipcRenderer.invoke('transcribe-audio', arrayBuffer),
  speakText: (text) => ipcRenderer.invoke('speak-text', text),
  stopSpeaking: () => ipcRenderer.invoke('stop-speaking'),
  runCommand: (command) => ipcRenderer.invoke('run-command', command),
  minimize: () => ipcRenderer.send('window-minimize'),
  onBriefing: (cb) => ipcRenderer.on('axiom-briefing', (_e, text) => cb(text)),
});
