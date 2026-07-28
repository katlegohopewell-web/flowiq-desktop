const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('licenseAPI', {
  activate: (key) => ipcRenderer.invoke('license:activate', key),
  enterApp: () => ipcRenderer.invoke('license:enterApp'),
  signOut: () => ipcRenderer.invoke('license:signOut'),
  getStatus: () => ipcRenderer.invoke('license:getStatus'),
});
