// preload.js

const { contextBridge, ipcRenderer } = require('electron');

// Expose a secure, well-defined API to the renderer process (index.html)
contextBridge.exposeInMainWorld('electronAPI', {
  // --- Initial Data ---
  getInitialData: () => ipcRenderer.invoke('get-initial-data'),

  // --- Manual Lock Today ---
  lockSiteForToday: (siteName) => ipcRenderer.invoke('lock-site-for-today', siteName),
  getManualLocks: () => ipcRenderer.invoke('get-manual-locks'),

  // --- Hosts File and Blocking ---
  updateHostsFile: (sitesToBlock) => ipcRenderer.invoke('update-hosts-file', sitesToBlock),

  // --- Usage, Limits, and Friction ---
  setSiteLimit: (payload) => ipcRenderer.invoke('set-site-limit', payload),
  getCommitmentParagraph: () => ipcRenderer.invoke('get-commitment-paragraph'),
  getProgressiveFrictionConfig: () => ipcRenderer.invoke('get-progressive-friction-config'),
  setProgressiveFrictionConfig: (partial) => ipcRenderer.invoke('set-progressive-friction-config', partial),
  getInsights: () => ipcRenderer.invoke('get-insights'),
  
  // --- Deep Work Mode ---
  startDeepWork: (durationInSeconds) => ipcRenderer.invoke('start-deep-work', durationInSeconds),
  endDeepWork: () => ipcRenderer.invoke('end-deep-work'),
  getDeepWorkConfig: () => ipcRenderer.invoke('get-deep-work-config'),
  setDeepWorkConfig: (partial) => ipcRenderer.invoke('set-deep-work-config', partial),

  // --- Deep Work Auto-Schedule ---
  scheduleGet:    () => ipcRenderer.invoke('schedule-get'),
  scheduleAdd:    (rule) => ipcRenderer.invoke('schedule-add', rule),
  scheduleUpdate: (id, changes) => ipcRenderer.invoke('schedule-update', { id, changes }),
  scheduleDelete: (id) => ipcRenderer.invoke('schedule-delete', { id }),
  scheduleClearAll: () => ipcRenderer.invoke('schedule-clear-all'),

  // --- Phone usage data (v1.7.0) ---
  phoneGetStatus: () => ipcRenderer.invoke('phone-get-status'),
  phonePickFolder: () => ipcRenderer.invoke('phone-pick-folder'),
  phoneImportFolder: (folderPath) => ipcRenderer.invoke('phone-import-folder', folderPath),
  phoneClearAll: () => ipcRenderer.invoke('phone-clear-all'),
  getPhoneInsights: () => ipcRenderer.invoke('get-phone-insights'),
  
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

  // --- Digest / Local-HTML Reports ---
  getReportSettings: () => ipcRenderer.invoke('get-report-settings'),
  setReportSettings: (partial) => ipcRenderer.invoke('set-report-settings', partial),
  generateDigestNow: (period) => ipcRenderer.invoke('generate-digest-now', period),
  openReportFolder: () => ipcRenderer.invoke('open-report-folder'),

  // --- Auto-Update ---
  updaterCheckNow: () => ipcRenderer.invoke('updater-check-now'),
  updaterInstallNow: () => ipcRenderer.invoke('updater-install-now'),
  updaterGetStatus: () => ipcRenderer.invoke('updater-get-status'),

  // --- Startup / login item ---
  startupGet: () => ipcRenderer.invoke('startup-get'),
  startupSet: (openAtLogin) => ipcRenderer.invoke('startup-set', { openAtLogin }),

  // --- HUD widget ---
  hudShow: () => ipcRenderer.invoke('hud-show'),
  hudHide: () => ipcRenderer.invoke('hud-hide'),
  hudToggle: () => ipcRenderer.invoke('hud-toggle'),
  hudGetConfig: () => ipcRenderer.invoke('hud-get-config'),
  hudSetConfig: (partial) => ipcRenderer.invoke('hud-set-config', partial),

  // --- Real-time Listeners (Main -> Renderer) ---
  onUsageUpdate: (callback) => ipcRenderer.on('usage-updated', (_event, value) => callback(value)),
  onDeepWorkUpdate: (callback) => ipcRenderer.on('deep-work-update', (_event, value) => callback(value)),
  repairHostsNow: () => ipcRenderer.invoke('repair-hosts-now'),
  onHostsIntegrityUpdate: (callback) =>
    ipcRenderer.on('hosts-integrity-update', (_event, payload) => callback(payload)),
  onCalendarDayChanged: (callback) =>
    ipcRenderer.on('calendar-day-changed', (_event, payload) => callback(payload)),
  onUpdateReady: (callback) =>
    ipcRenderer.on('update-ready', (_event, payload) => callback(payload)),
  onUpdaterEvent: (callback) =>
    ipcRenderer.on('updater-event', (_event, payload) => callback(payload)),
  onScheduleEvent: (callback) =>
    ipcRenderer.on('schedule-event', (_event, payload) => callback(payload)),
});

