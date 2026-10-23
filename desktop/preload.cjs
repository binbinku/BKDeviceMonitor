const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bkDeviceMonitor', {
  platform: process.platform,
  request: (path, method = 'GET') => ipcRenderer.invoke('bkdm:request', path, method),
  saveFile: file => ipcRenderer.invoke('bkdm:save', file),
  apk: input => ipcRenderer.invoke('bkdm:apk', input),
  files: input => ipcRenderer.invoke('bkdm:files', input),
  onEvent: callback => {
    const listener = (_event, name, data) => callback(name, data);
    ipcRenderer.on('bkdm:event', listener);
    return () => ipcRenderer.removeListener('bkdm:event', listener);
  }
});
