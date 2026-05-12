const { app, BrowserWindow, ipcMain, Tray, Menu, Notification, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

// --- Single Instance Lock ---
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
    app.quit();
} else {
    app.on('second-instance', () => {
        // Someone tried to run a second instance, focus our window instead
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.show();
            mainWindow.focus();
        }
    });
}

// --- Import Modules ---
const DataManager = require('./dataManager');
const HostsManager = require('./hostsManager');
const UsageTracker = require('./usageTracker');

// --- Configuration ---
const deepWorkSites = ['web.whatsapp.com', 'messenger.com', 'www.messenger.com'];

// --- Deep work timers (must survive hot paths; cleared explicitly) ---
let deepWorkTimeout = null;
let deepWorkInterval = null;
let lastWatchdogRepairAt = 0;
let midnightTimer = null;

// --- Commitment Paragraphs ---
const commitmentParagraphs = [
    "Discipline is the bridge between goals and accomplishment. It is the refusal to be swayed by momentary comfort or fleeting distraction. By choosing this path, I am not punishing myself; I am investing in my future self. Every second I reclaim from mindless scrolling is a second I can dedicate to building the career, the skills, and the life I truly desire. This deliberate act of focus is a declaration that my long-term ambitions are more valuable than my short-term impulses.",
    "The path to excellence is paved with focused effort, not scattered attention. True progress is measured in deliberate, concentrated work sessions where the noise of the world fades away. I am committing to this focus not out of obligation, but out of respect for my own potential. I recognize that my greatest breakthroughs will not come from passive consumption, but from active creation. This time is a sanctuary for deep thought and meaningful execution. I will protect it fiercely.",
    "Motivation is what gets you started; habit is what keeps you going. I am building the habit of discipline. This choice is a conscious repetition of an action that aligns with my highest values. It is the practice of prioritizing the important over the urgent, the meaningful over the trivial. I understand that the discomfort of this restriction is temporary, while the rewards of the work I am about to do will compound and last a lifetime. I am the architect of my habits and the master of my time."
];

// --- Main Window & App State ---
let mainWindow;
let dataManager;
let hostsManager;
let usageTracker;

// --- Tray State ---
let tray = null;
let trayRefreshInterval = null;
let trayResolvedIconPath = null;
let isQuitting = false;

// Tiny 1x1 transparent PNG (canonical bytes) — used only when icon.ico can't be resolved,
// so `new Tray(image)` doesn't throw and the user still gets a tray slot to right-click.
// The icon will be invisible in this case (intentional — surfaces the underlying problem).
const FALLBACK_TRAY_PNG_BASE64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk' +
    'YAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

function combinedExpectedDomainsForHosts() {
    const base = [...dataManager.getBlockedDomains()];
    const set = new Set(base.map(d => String(d).toLowerCase()));
    const normalized = dataManager.normalizeDeepWork(dataManager.getDeepWork());
    if (normalized) {
        deepWorkSites.forEach(s => set.add(String(s).toLowerCase()));
    }
    return Array.from(set);
}

function clearDeepWorkTimers() {
    if (deepWorkTimeout) {
        clearTimeout(deepWorkTimeout);
        deepWorkTimeout = null;
    }
    if (deepWorkInterval) {
        clearInterval(deepWorkInterval);
        deepWorkInterval = null;
    }
}

function pushHostsIntegrityToRenderer() {
    if (!hostsManager || !dataManager) return;
    const expected = combinedExpectedDomainsForHosts();
    const v = hostsManager.verifyHostsSection(expected);
    const payload = {
        ok: v.ok,
        unexpectedMissing: v.unexpectedMissing,
        unexpectedExtra: v.unexpectedExtra,
        sectionPresent: v.sectionPresent,
        expectedDomainCount: expected.length
    };
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('hosts-integrity-update', payload);
    }
}

/**
 * Apply current store + optional deep-work extras to the hosts file and refresh UI integrity.
 */
async function applyHostsToSystem(reason = 'apply') {
    if (!hostsManager || !dataManager) return { success: false, error: 'not_ready' };
    const domains = [...dataManager.getBlockedDomains()];
    const dw = dataManager.normalizeDeepWork(dataManager.getDeepWork());
    const extra = dw ? [...deepWorkSites] : [];
    hostsManager.suppressWatchTemporarily(5000);
    const result = await hostsManager.updateHostsFile(domains, extra);

    if (!result.success) {
        dataManager.appendHostsTamperEvent({
            source: reason,
            outcome: 'hosts_write_failed',
            error: result.error
        });
    } else if (result.verified === false) {
        dataManager.appendHostsTamperEvent({
            source: reason,
            outcome: 'verification_failed_after_write',
            verification: result.verification || null
        });
    }

    pushHostsIntegrityToRenderer();
    refreshTray();
    return result;
}

async function handleExternalHostsTamperWatch() {
    if (!hostsManager || !dataManager) return;
    const expected = combinedExpectedDomainsForHosts();
    const v = hostsManager.verifyHostsSection(expected);
    if (v.ok) {
        pushHostsIntegrityToRenderer();
        return;
    }
    dataManager.appendHostsTamperEvent({
        source: 'fs_watch',
        outcome: 'external_mismatch_detected',
        verification: v,
        expectedDomainCount: expected.length
    });
    if (Date.now() - lastWatchdogRepairAt > 45_000) {
        lastWatchdogRepairAt = Date.now();
        await applyHostsToSystem('watchdog_auto_repair');
    } else {
        pushHostsIntegrityToRenderer();
    }
}

function msUntilNextLocalMidnight() {
    const n = new Date();
    n.setDate(n.getDate() + 1);
    n.setHours(0, 0, 20, 0);
    return Math.max(30_000, n.getTime() - Date.now());
}

function scheduleNextMidnightRollover() {
    if (midnightTimer) clearTimeout(midnightTimer);
    midnightTimer = setTimeout(async () => {
        midnightTimer = null;
        try {
            const roll = dataManager.advanceCalendarRollIfNeeded();
            if (roll.domainsChanged) {
                await applyHostsToSystem('midnight_calendar_roll');
            }
            const windows = BrowserWindow.getAllWindows();
            if (roll.rolled && windows.length) {
                const todayIso = dataManager.getLocalISODate();
                windows.forEach(w => {
                    if (!w.isDestroyed()) w.webContents.send('calendar-day-changed', { today: todayIso });
                });
            }
            pushHostsIntegrityToRenderer();
            refreshTray();
        } catch (e) {
            console.error('Midnight calendar roll error:', e);
        } finally {
            scheduleNextMidnightRollover();
        }
    }, msUntilNextLocalMidnight());
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 800,
        height: 950,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });
    mainWindow.loadFile('index.html');
    
    // Handle window close event (hide to tray instead of quitting)
    mainWindow.on('close', (event) => {
        if (!isQuitting) {
            event.preventDefault();
            mainWindow.hide();
            console.log('Main: Window hidden to tray');
        }
    });
    
    // Make mainWindow globally accessible for usage tracker
    global.mainWindow = mainWindow;
}

/**
 * Resolve a usable tray icon, trying packaged + dev paths, then falling back to an
 * embedded PNG so `new Tray()` always succeeds. Reports which path it ended up using.
 */
function resolveTrayIcon() {
    const candidates = [];
    if (app.isPackaged && process.resourcesPath) {
        candidates.push(path.join(process.resourcesPath, 'icon.ico'));
        try { candidates.push(path.join(app.getAppPath(), 'icon.ico')); } catch (_) { /* noop */ }
    }
    candidates.push(path.join(__dirname, 'icon.ico'));

    for (const candidate of candidates) {
        try {
            if (fs.existsSync(candidate)) {
                const img = nativeImage.createFromPath(candidate);
                if (!img.isEmpty()) {
                    return { image: img, source: candidate, fallback: false };
                }
            }
        } catch (e) {
            console.warn(`Main: Tray icon candidate failed (${candidate}):`, e.message);
        }
    }

    console.warn('Main: No icon.ico found. Using embedded fallback (tray will still appear).');
    try {
        const fallback = nativeImage.createFromBuffer(Buffer.from(FALLBACK_TRAY_PNG_BASE64, 'base64'));
        if (!fallback.isEmpty()) {
            return { image: fallback, source: '<embedded fallback>', fallback: true };
        }
    } catch (e) {
        console.warn('Main: Fallback PNG decode failed:', e.message);
    }
    return { image: null, source: '<unavailable>', fallback: true };
}

function formatMinutes(seconds) {
    const m = Math.round((seconds || 0) / 60);
    return `${m}m`;
}

function formatDurationFromMs(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
}

function gatherTrayStats() {
    if (!dataManager) return null;
    const siteSettings = dataManager.getSiteSettings();
    const usage = dataManager.getTodayUsage();
    const blocked = new Set((dataManager.getBlockedDomains() || []).map(d => String(d).toLowerCase()));
    const locks = dataManager.getManualLocks();
    const unblocks = dataManager.getTodayUnblocks();
    const dw = dataManager.normalizeDeepWork(dataManager.getDeepWork());

    const sites = Object.keys(siteSettings).map(name => {
        const cfg = siteSettings[name];
        const seconds = typeof usage[name] === 'number' ? usage[name] : 0;
        const minutes = seconds / 60;
        const isBlocked = Array.isArray(cfg.domains) && cfg.domains.length > 0
            && cfg.domains.every(d => blocked.has(String(d).toLowerCase()));
        return {
            name,
            seconds,
            minutes,
            limit: typeof cfg.limit === 'number' ? cfg.limit : 0,
            isBlocked,
            isLocked: !!locks[name],
            isOver: cfg.limit > 0 && minutes >= cfg.limit
        };
    }).sort((a, b) => b.seconds - a.seconds);

    const totalUnblocks = Object.values(unblocks).reduce((s, v) => s + (Number(v) || 0), 0);
    const totalMinutes = sites.reduce((s, x) => s + x.minutes, 0);

    return { sites, totalUnblocks, totalMinutes, deepWork: dw };
}

function buildTrayTooltip(stats) {
    if (!stats) return 'FocusGuard';
    const top = stats.sites
        .filter(s => s.seconds > 0)
        .slice(0, 3)
        .map(s => `${s.name.split('/')[0]} ${formatMinutes(s.seconds)}`)
        .join(' • ');
    const head = `FocusGuard • ${Math.round(stats.totalMinutes)}m today`;
    const dwSuffix = stats.deepWork ? ` • DW ${formatDurationFromMs(stats.deepWork.remainingMs)}` : '';
    const unblocksSuffix = stats.totalUnblocks ? ` • ${stats.totalUnblocks} unblocks` : '';
    const detail = top ? ` (${top})` : '';
    // Windows 10+ tooltips are long-tolerant; Windows 7 capped at 127. Stay conservative.
    let out = head + detail + dwSuffix + unblocksSuffix;
    if (out.length > 127) out = out.slice(0, 124) + '…';
    return out;
}

function buildTrayMenuTemplate(stats) {
    const showDashboard = () => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.show();
            mainWindow.focus();
        }
    };

    const template = [
        { label: 'Open Dashboard', click: showDashboard },
        { type: 'separator' },
    ];

    if (stats && stats.deepWork) {
        template.push({
            label: `Deep Work: ${formatDurationFromMs(stats.deepWork.remainingMs)} remaining`,
            enabled: false
        });
        template.push({ type: 'separator' });
    }

    template.push({ label: "Today's usage", enabled: false });
    if (stats && stats.sites.length) {
        for (const s of stats.sites) {
            const tags = [];
            if (s.isLocked) tags.push('LOCKED');
            else if (s.isBlocked) tags.push('blocked');
            if (s.isOver && !s.isLocked) tags.push('over limit');
            const tagStr = tags.length ? `  [${tags.join(', ')}]` : '';
            const limitStr = s.limit > 0 ? `${formatMinutes(s.seconds)} / ${s.limit}m` : `${formatMinutes(s.seconds)}`;
            template.push({
                label: `  ${s.name}: ${limitStr}${tagStr}`,
                enabled: false
            });
        }
    } else {
        template.push({ label: '  (no usage yet today)', enabled: false });
    }

    template.push({ type: 'separator' });
    template.push({
        label: `Unblock events today: ${stats ? stats.totalUnblocks : 0}`,
        enabled: false
    });
    template.push({ type: 'separator' });
    template.push({
        label: 'Repair hosts file now',
        click: () => { applyHostsToSystem('tray_repair').catch(e => console.error('Tray repair:', e)); }
    });
    template.push({ type: 'separator' });
    template.push({
        label: 'Quit',
        click: () => {
            isQuitting = true;
            app.quit();
        }
    });

    return template;
}

function refreshTray() {
    if (!tray) {
        // Either tray hasn't been created yet (boot-time race) or createTray gave up.
        // Either way, do nothing — createTray's own retry loop owns recovery.
        return;
    }
    if (tray.isDestroyed()) {
        console.warn('Main: Tray reported destroyed — attempting recreate');
        tray = null;
        try { createTray(); } catch (e) { console.error('Tray recreate failed:', e.message); }
        return;
    }
    try {
        const stats = gatherTrayStats();
        tray.setToolTip(buildTrayTooltip(stats));
        tray.setContextMenu(Menu.buildFromTemplate(buildTrayMenuTemplate(stats)));
    } catch (e) {
        console.error('Main: refreshTray error:', e);
    }
}

function createTray() {
    const resolved = resolveTrayIcon();
    trayResolvedIconPath = resolved.source;

    console.log('Main: Tray creating with icon source:', resolved.source, resolved.fallback ? '(fallback)' : '');

    if (!resolved.image) {
        console.error('Main: No usable tray icon (and fallback is unavailable). Skipping tray.');
        if (Notification.isSupported()) {
            const n = new Notification({
                title: 'FocusGuard',
                body: 'Tray icon could not be created. The app is running but only the main window is accessible.'
            });
            n.show();
        }
        return;
    }

    let attempts = 0;
    const tryCreate = () => {
        attempts++;
        try {
            tray = new Tray(resolved.image);
        } catch (e) {
            console.error(`Main: Tray creation attempt #${attempts} failed:`, e.message);
            if (attempts < 4) {
                setTimeout(tryCreate, 1500 * attempts);
                return;
            }
            console.error('Main: Tray creation permanently failed after 4 attempts. App will run windowed only.');
            return;
        }

        tray.setToolTip('FocusGuard - starting…');
        tray.setContextMenu(Menu.buildFromTemplate(buildTrayMenuTemplate(null)));

        tray.on('click', () => {
            if (mainWindow) {
                if (mainWindow.isMinimized()) mainWindow.restore();
                mainWindow.show();
                mainWindow.focus();
            }
        });

        refreshTray();

        if (trayRefreshInterval) clearInterval(trayRefreshInterval);
        trayRefreshInterval = setInterval(refreshTray, 30_000);

        console.log('Main: Tray created successfully');

        if (resolved.fallback && Notification.isSupported()) {
            const n = new Notification({
                title: 'FocusGuard',
                body: 'Using a fallback tray icon — the bundled icon.ico could not be located.'
            });
            n.show();
        } else if (!resolved.fallback && Notification.isSupported()) {
            const notification = new Notification({
                title: 'FocusGuard',
                body: 'Running in the background. Right-click the tray icon for live stats.',
                icon: resolved.source
            });
            notification.show();
        }
    };

    tryCreate();
}

app.whenReady().then(async () => {
    // Register app to start on system login (minimized to tray)
    // IMPORTANT: Only do this in packaged builds. In dev (npm start), this can register
    // the Electron binary itself, which causes the "Electron" splash screen at startup.
    if (app.isPackaged) {
        app.setLoginItemSettings({
            openAtLogin: true,
            openAsHidden: true,
            args: ['--hidden']
        });
        console.log('Main: Registered for startup on login (packaged)');
    } else {
        // Actively disable any previous dev-mode startup registration
        app.setLoginItemSettings({ openAtLogin: false });
        console.log('Main: Dev mode - startup disabled');
    }

    // Initialize managers
    dataManager = new DataManager();
    hostsManager = new HostsManager();
    const getDeepExtras = () =>
        (dataManager.normalizeDeepWork(dataManager.getDeepWork()) ? deepWorkSites : []);
    usageTracker = new UsageTracker(dataManager, hostsManager, getDeepExtras);

    hostsManager.setExternalTamperHandler(() => {
        handleExternalHostsTamperWatch().catch(e => console.error('Hosts watchdog:', e));
    });
    hostsManager.startHostsWatchdog();

    console.log('Main: Initialized managers');
    console.log('Main: Site settings:', dataManager.getSiteSettings());
    console.log('Main: Today\'s usage:', dataManager.getTodayUsage());

    // New local day: optional auto-reblock + refresh stored baseline
    const rollOut = dataManager.advanceCalendarRollIfNeeded();
    if (rollOut.domainsChanged) {
        await applyHostsToSystem('startup_calendar_roll');
    }

    // Expose debug functions globally for console access
    global.startDebugMode = () => {
        console.log('Starting debug mode from console...');
        usageTracker.startDebugMode();
    };

    global.stopDebugMode = () => {
        console.log('Stopping debug mode from console...');
        usageTracker.stopDebugMode();
    };

    global.pauseUsageTracker = () => {
        console.log('Pausing usage tracker...');
        usageTracker.stop();
    };

    global.resumeUsageTracker = () => {
        console.log('Resuming usage tracker...');
        usageTracker.start();
    };

    console.log('🔧 Debug commands available:');
    console.log('   pauseUsageTracker() - Stop the normal usage tracker');
    console.log('   resumeUsageTracker() - Restart the normal usage tracker');
    console.log('   startDebugMode() - Start window title logging');
    console.log('   stopDebugMode() - Stop window title logging');

    // Start usage tracker after a delay to allow console access
    console.log('⏸️  Usage tracker will start automatically in 10 seconds...');
    console.log('💡 Type "pauseUsageTracker()" to stop it, or "startDebugMode()" to begin debugging');
    setTimeout(() => {
        console.log('▶️  Starting usage tracker...');
        usageTracker.start();
    }, 10000);

    const launchedOnStartup = app.getLoginItemSettings().wasOpenedAtLogin ||
        process.argv.includes('--hidden');

    createWindow();

    mainWindow.webContents.once('did-finish-load', () => {
        if (rollOut.rolled) {
            mainWindow.webContents.send('calendar-day-changed', {
                today: dataManager.getLocalISODate(),
                reason: 'calendar_roll'
            });
        }
        pushHostsIntegrityToRenderer();
    });

    if (launchedOnStartup) {
        console.log('Main: Launched on startup - starting minimized to tray');
        mainWindow.hide();
    } else {
        console.log('Main: Launched manually - showing window');
        mainWindow.show();
    }

    createTray();

    const dwRaw = dataManager.getDeepWork();
    const resumed = dwRaw?.endTime && dataManager.normalizeDeepWork(dwRaw);
    if (resumed) {
        await startDeepWorkSessionUntil(dwRaw.endTime);
    } else {
        dataManager.deleteDeepWork();
        clearDeepWorkTimers();
    }

    scheduleNextMidnightRollover();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        usageTracker.stop();
        app.quit();
    }
});

// Clean up tray on app quit
app.on('before-quit', () => {
    if (trayRefreshInterval) {
        clearInterval(trayRefreshInterval);
        trayRefreshInterval = null;
    }
    if (tray) {
        tray.destroy();
        console.log('Main: Tray destroyed');
    }
});

// --- IPC Handlers ---
ipcMain.handle('get-initial-data', async () => {
    const expected = combinedExpectedDomainsForHosts();
    const verification = hostsManager.verifyHostsSection(expected);
    const hostsIntegrity = {
        ok: verification.ok,
        unexpectedMissing: verification.unexpectedMissing,
        unexpectedExtra: verification.unexpectedExtra,
        sectionPresent: verification.sectionPresent,
        expectedDomainCount: expected.length
    };
    return dataManager.getInitialData({ hostsIntegrity });
});

ipcMain.handle('lock-site-for-today', (event, siteName) => {
    return dataManager.lockSiteForToday(siteName);
});

ipcMain.handle('get-manual-locks', () => {
    return dataManager.getManualLocks();
});


ipcMain.handle('get-commitment-paragraph', () => {
    return commitmentParagraphs[Math.floor(Math.random() * commitmentParagraphs.length)];
});

ipcMain.handle('update-hosts-file', async (_event, sitesToBlock) => {
    dataManager.setBlockedDomains(sitesToBlock);
    return applyHostsToSystem('renderer_apply');
});

ipcMain.handle('repair-hosts-now', async () => applyHostsToSystem('user_repair'));

ipcMain.handle('set-site-limit', async (event, { siteName, limit }) => {
    return dataManager.setSiteLimit(siteName, limit);
});

ipcMain.handle('start-deep-work', async (_event, durationInSeconds) => {
    return startDeepWorkDurationSeconds(durationInSeconds);
});

ipcMain.handle('get-history', async () => {
    return dataManager.getHistoryData();
});

ipcMain.handle('log-blocker-event', async (event, isEnabled) => {
    return dataManager.addBlockerEvent(isEnabled);
});

ipcMain.handle('log-unblock-event', async (event, siteName) => {
    return dataManager.addUnblockEvent(siteName);
});

ipcMain.handle('get-today-unblocks', async () => {
    return dataManager.getTodayUnblocks();
});

ipcMain.handle('get-heat-map-data', async (event, days = 7) => {
    return dataManager.getHeatMapData(days);
});

ipcMain.handle('get-adherence-data', async (event, days = 7) => {
    return dataManager.getAdherenceData(days);
});

// Debug functions
ipcMain.handle('start-debug-mode', async () => {
    console.log('Starting debug mode from renderer...');
    usageTracker.startDebugMode();
    return { success: true };
});

ipcMain.handle('stop-debug-mode', async () => {
    console.log('Stopping debug mode from renderer...');
    usageTracker.stopDebugMode();
    return { success: true };
});

ipcMain.handle('pause-usage-tracker', async () => {
    console.log('Pausing usage tracker from renderer...');
    usageTracker.stop();
    return { success: true };
});

ipcMain.handle('resume-usage-tracker', async () => {
    console.log('Resuming usage tracker from renderer...');
    usageTracker.start();
    return { success: true };
});

ipcMain.handle('clear-usage-data', async () => {
    console.log('Clearing all usage data...');
    const today = dataManager.getLocalISODate();
    dataManager.store.set(`usage.${today}`, {});
    console.log('Usage data cleared for today');
    return { success: true };
});

// Test admin permissions
ipcMain.handle('test-admin-access', async () => {
    console.log('Testing admin access...');
    try {
        hostsManager.suppressWatchTemporarily(5000);
        const result = await hostsManager.updateHostsFile([], []);
        console.log('Test result:', result);
        pushHostsIntegrityToRenderer();
        return result;
    } catch (error) {
        console.error('Test failed:', error);
        return { success: false, error: error.message };
    }
});


// --- Deep work session (async; survives restarts via electron-store) ---
async function startDeepWorkSessionUntil(endTimeMs) {
    clearDeepWorkTimers();
    const remainingMs = endTimeMs - Date.now();
    if (remainingMs <= 0) {
        dataManager.deleteDeepWork();
        await applyHostsToSystem('deep_work_expired_on_resume');
        return { success: true, expired: true };
    }

    dataManager.setDeepWork({ endTime: endTimeMs });
    const hostsResult = await applyHostsToSystem('deep_work_start');
    if (!hostsResult.success) {
        dataManager.deleteDeepWork();
        clearDeepWorkTimers();
        return hostsResult;
    }

    const tick = () => {
        const rem = endTimeMs - Date.now();
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('deep-work-update', {
                isActive: rem > 0,
                remainingMs: Math.max(0, rem),
                endTime: endTimeMs
            });
        }
    };
    tick();
    deepWorkInterval = setInterval(tick, 1000);

    deepWorkTimeout = setTimeout(async () => {
        clearDeepWorkTimers();
        dataManager.deleteDeepWork();
        await applyHostsToSystem('deep_work_complete');
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('deep-work-update', { isActive: false, remainingMs: 0 });
        }
        refreshTray();
    }, remainingMs);

    return { success: true, verified: hostsResult.verified, hostsResult };
}

async function startDeepWorkDurationSeconds(durationInSeconds) {
    const secs = typeof durationInSeconds === 'number' ? durationInSeconds : parseFloat(durationInSeconds);
    const bound = Number.isFinite(secs) ? Math.max(1, secs) : 1;
    return startDeepWorkSessionUntil(Date.now() + bound * 1000);
}