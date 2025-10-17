// preload.js

const { contextBridge, ipcRenderer } = require('electron');

// Expose a secure, well-defined API to the renderer process (index.html)
contextBridge.exposeInMainWorld('electronAPI', {
  // --- Initial Data ---
  getInitialData: () => ipcRenderer.invoke('get-initial-data'),

  // --- Hosts File and Blocking ---
  updateHostsFile: (sitesToBlock) => ipcRenderer.invoke('update-hosts-file', sitesToBlock),

  // --- Usage, Limits, and Friction ---
  setSiteLimit: (payload) => ipcRenderer.invoke('set-site-limit', payload),
  getCommitmentParagraph: () => ipcRenderer.invoke('get-commitment-paragraph'),
  
  // --- Deep Work Mode ---
  startDeepWork: (durationInSeconds) => ipcRenderer.invoke('start-deep-work', durationInSeconds),
  
  // --- History and Logging ---
  getHistory: () => ipcRenderer.invoke('get-history'),
  logBlockerEvent: (isEnabled) => ipcRenderer.invoke('log-blocker-event', isEnabled),
  logUnblockEvent: (siteName) => ipcRenderer.invoke('log-unblock-event', siteName),
  getTodayUnblocks: () => ipcRenderer.invoke('get-today-unblocks'),
  
  // --- Analytics ---
  getHeatMapData: (days) => ipcRenderer.invoke('get-heat-map-data', days),
  getAdherenceData: (days) => ipcRenderer.invoke('get-adherence-data', days),
  
  // --- Testing ---
  testAdminAccess: () => ipcRenderer.invoke('test-admin-access'),
  
  // --- Debug Functions ---
  startDebugMode: () => ipcRenderer.invoke('start-debug-mode'),
  stopDebugMode: () => ipcRenderer.invoke('stop-debug-mode'),
  pauseUsageTracker: () => ipcRenderer.invoke('pause-usage-tracker'),
  resumeUsageTracker: () => ipcRenderer.invoke('resume-usage-tracker'),
  clearUsageData: () => ipcRenderer.invoke('clear-usage-data'),

  // --- Real-time Listeners (Main -> Renderer) ---
  onUsageUpdate: (callback) => ipcRenderer.on('usage-updated', (_event, value) => callback(value)),
  onDeepWorkUpdate: (callback) => ipcRenderer.on('deep-work-update', (_event, value) => callback(value)),
});

