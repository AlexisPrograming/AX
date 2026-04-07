const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('axiom', {
  sendToClaude: (message) => ipcRenderer.invoke('send-to-claude', message),
  startListening: () => ipcRenderer.invoke('start-listening'),
  stopListening: () => ipcRenderer.invoke('stop-listening'),
  speakText: (text) => ipcRenderer.invoke('speak-text', text),
  stopSpeaking: () => ipcRenderer.invoke('stop-speaking'),
  runCommand: (command) => ipcRenderer.invoke('run-command', command),
  minimize: () => ipcRenderer.send('window-minimize'),
});
