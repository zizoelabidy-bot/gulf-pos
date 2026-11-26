const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('gulfAdmin', Object.freeze({
  status: () => ipcRenderer.invoke('gulf-admin:status'),
  list: () => ipcRenderer.invoke('gulf-admin:list'),
  commercialList: () => ipcRenderer.invoke('gulf-admin:commercial-list'),
  commercialRecord: input => ipcRenderer.invoke('gulf-admin:commercial-record', input),
  issue: input => ipcRenderer.invoke('gulf-admin:issue', input),
}));
