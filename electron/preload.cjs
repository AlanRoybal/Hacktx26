const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('rr', {
  saveTrace: (name, text) => ipcRenderer.invoke('save-trace', name, text),
  quit: () => ipcRenderer.send('quit'),
  uploadClip: (id, bytes) => ipcRenderer.invoke('upload-clip', id, bytes),
});
