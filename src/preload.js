'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  onSnapshot: (cb) => ipcRenderer.on('snapshot', (_e, data) => cb(data)),
  onSnapshotError: (cb) => ipcRenderer.on('snapshot-error', (_e, msg) => cb(msg)),
  refreshNow: () => ipcRenderer.invoke('refresh-now'),
  closeApp: () => ipcRenderer.invoke('close-app'),
  togglePin: () => ipcRenderer.invoke('toggle-pin'),
});
