// hudPreload.js — Minimal IPC bridge for the HUD widget window.
// Exposes a small `window.hudAPI` surface; the HUD never has direct access
// to dataManager or hostsManager and only consumes events main.js broadcasts.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('hudAPI', {
    getInitialState: () => ipcRenderer.invoke('hud-get-initial-state'),
    hide: () => ipcRenderer.invoke('hud-hide'),
    openMainWindow: () => ipcRenderer.invoke('hud-open-main'),

    onUsageUpdate: (callback) =>
        ipcRenderer.on('usage-updated', (_event, payload) => callback(payload)),
    onDeepWorkUpdate: (callback) =>
        ipcRenderer.on('deep-work-update', (_event, payload) => callback(payload)),
    onSiteSettingsUpdate: (callback) =>
        ipcRenderer.on('hud-site-settings', (_event, payload) => callback(payload)),
});
