const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('gulfAdmin', Object.freeze({
  status: () => ipcRenderer.invoke('gulf-admin:status'),
  list: () => ipcRenderer.invoke('gulf-admin:list'),
  issue: input => ipcRenderer.invoke('gulf-admin:issue', input),
}));
