const { app, BrowserWindow, ipcMain, Tray, Menu, Notification, nativeImage, shell, screen, dialog } = require('electron');
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
const ReportGenerator = require('./reportGenerator');

// electron-updater is optional at module-resolution time — if the user is running
// `npm start` without running `npm install` first, we don't want the whole app to crash.
// Auto-update only runs in packaged builds anyway.
let autoUpdater = null;
try {
    autoUpdater = require('electron-updater').autoUpdater;
} catch (e) {
    console.warn('Main: electron-updater not installed — auto-update disabled until `npm install` is run.');
}

// Deep-work domains are now computed dynamically from dataManager.getDeepWorkConfig()
// — see dataManager.computeDeepWorkDomains(). Editable via the Dashboard's Deep Work card.

// --- Deep work timers (must survive hot paths; cleared explicitly) ---
let deepWorkTimeout = null;
let deepWorkInterval = null;
let lastWatchdogRepairAt = 0;
let midnightTimer = null;
let digestCheckInterval = null;
let reportGenerator = null;
let updaterCheckInterval = null;
let updaterReadyPayload = null;
let scheduleEvaluatorInterval = null;
const SCHEDULE_EVAL_INTERVAL_MS = 30 * 1000; // tick every 30s
const SCHEDULE_GRACE_MINUTES = 5;            // late-fire allowance after scheduled time

// --- Commitment Paragraphs ---
//
// Pool intentionally large + thematically consistent (discipline / focus /
// long-term thinking). Why so many? With only 3, the user memorizes the
// first sentence of each and the typing requirement becomes trivial. With
// 17, hitting the same paragraph back-to-back is rare, and even on
// repeats the user has to actually read to confirm. The friction layer
// is `paste/drop/cut/contextmenu` blocked in renderer.js — these
// paragraphs only have to slow you down enough to interrupt the impulse.
const commitmentParagraphs = [
    "Discipline is the bridge between goals and accomplishment. It is the refusal to be swayed by momentary comfort or fleeting distraction. By choosing this path, I am not punishing myself; I am investing in my future self. Every second I reclaim from mindless scrolling is a second I can dedicate to building the career, the skills, and the life I truly desire. This deliberate act of focus is a declaration that my long-term ambitions are more valuable than my short-term impulses.",
    "The path to excellence is paved with focused effort, not scattered attention. True progress is measured in deliberate, concentrated work sessions where the noise of the world fades away. I am committing to this focus not out of obligation, but out of respect for my own potential. I recognize that my greatest breakthroughs will not come from passive consumption, but from active creation. This time is a sanctuary for deep thought and meaningful execution. I will protect it fiercely.",
    "Motivation is what gets you started; habit is what keeps you going. I am building the habit of discipline. This choice is a conscious repetition of an action that aligns with my highest values. It is the practice of prioritizing the important over the urgent, the meaningful over the trivial. I understand that the discomfort of this restriction is temporary, while the rewards of the work I am about to do will compound and last a lifetime. I am the architect of my habits and the master of my time.",
    "The impulse I feel right now is not me. It is a pattern, a reflex carved into my brain by years of seeking small rewards. The real me wants the work, the growth, the quiet pride of an evening well spent. Each time I pause and choose the harder path, I weaken the pattern and strengthen the self I want to become. This moment of friction is not the obstacle to my goals; it is the path itself, one decision at a time.",
    "I am not entitled to ease. Anything worth building demands a tax in attention, in patience, in the deliberate refusal of cheaper options. By honouring that tax today, I make tomorrow easier. By dodging it, I make tomorrow harder. There is no third option, no clever workaround, no version of growth that does not cost something. I choose to pay the cost now while I have the strength.",
    "Future me is watching this moment. Not with anger, but with quiet hope that I will respect the time we have. He knows the regrets that come from frittered hours and the deep satisfaction of a day actually lived. I will not let him down for the sake of a feed designed by strangers to keep him scrolling. The smallest acts of discipline are the most meaningful gifts I can send forward in time.",
    "Attention is the only currency I cannot earn back. I can sleep more, eat better, exercise harder, but the minutes spent in a dopamine trance are gone forever. Treating my focus as cheap means treating my life as cheap. I refuse to do that. The work I postpone today does not disappear; it simply waits for me, growing heavier each hour I delay it.",
    "What I do when no one is watching is who I actually am. Right now no one knows I am at this decision point. No friend will praise me for closing this prompt and getting back to work, and no boss will discover the small surrender. The reward and the punishment are both internal, which is exactly why this choice matters more than the loud public ones I make.",
    "The best version of my life is on the other side of consistent small refusals. Not heroic feats, not dramatic transformations, just thousands of unremarkable moments where I chose the thing that mattered over the thing that pulled. I cannot skip those moments and arrive at the destination. The moments are the destination, repeated until they become a life.",
    "Resistance is loudest right before something good happens. The urge to abandon the work tends to peak just as I approach a breakthrough, because my brain mistakes effort for danger. The discomfort I feel is not a signal to stop; it is often the most reliable signal that I am on the right path. I will treat the discomfort as a compass rather than a verdict.",
    "I trade hours for outcomes, whether I notice it or not. An hour of scrolling buys me a brief mood lift and a vague sense of having missed something. An hour of focused work buys me a piece of skill, a fragment of a project, a small but real claim on the person I am becoming. The exchange rate is brutally clear when I am honest about it.",
    "Nothing on a screen is more important than the next thing on my list. Not because the world is uninteresting, but because curated outrage and curated joy and curated everything else were engineered to feel important while costing me nothing they value and everything I value. I will not subsidise their business model with my one finite life.",
    "I respect myself enough to be a little bored. Boredom is the soil where ideas grow, where my mind connects things it could not connect while distracted. Every time I pull out a phone to avoid two empty minutes, I am poisoning that soil. The willingness to sit in a small silence is a quietly radical act in an economy designed to prevent it.",
    "The rules I set for myself when I was thinking clearly deserve more weight than the rules I want to break when I am tired. Past me did not impose this limit out of cruelty. He imposed it because he had seen this exact scenario play out a hundred times and knew how it ends. I will trust the version of me who could think straight, not the version desperate for a quick hit.",
    "Excellence is not a single decision; it is a posture. It is the way I hold myself in moments like this, when the easy thing is one click away and the hard thing requires me to actually show up. Each time I choose the posture, it costs slightly less. Each time I abandon it, the next return is slightly more expensive. Compounding works in both directions.",
    "The person I admire most would not be wrestling with this decision. They would have already returned to work. I do not have to become that person in a single day, but I can borrow their stance for the next sixty seconds. I will act as they would act, not because pretending is noble, but because acting is the only path that ever turns pretending into being.",
    "There are two kinds of time: the kind that builds something and the kind that erases something. I am about to decide which kind the next hour will be. Building is rarely thrilling in the moment, but it is the only kind I will ever be proud of having spent. Erasing feels like rest but leaves nothing behind, not even the memory of having rested. I choose to build."
];

// --- Main Window & App State ---
let mainWindow;
let hudWindow = null;
let hudFullscreenHidden = false;
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
        dataManager.computeDeepWorkDomains().forEach(s => set.add(String(s).toLowerCase()));
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
    const extra = dw ? dataManager.computeDeepWorkDomains() : [];
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

// ---------------------------------------------------------------------------
// AUTO-UPDATE (electron-updater, unsigned)
// ---------------------------------------------------------------------------
// Hosts releases on GitHub Releases (private repo OK with GH_TOKEN at build/publish time).
// Unsigned: Windows will SmartScreen-warn on first install of each new version. That's
// expected and acceptable for a personal-use, non-distributed app.
// Flow:
//   1. On launch (packaged only): checkForUpdates() — silent, no UI noise if nothing pending.
//   2. If an update is downloaded, store the payload and send a non-modal notification
//      AND broadcast to the renderer so it can show an "Update ready — restart" pill.
//   3. User can also trigger manual check via the tray menu or future UI button.

/**
 * Push a structured updater event to the renderer so the Settings panel can
 * show a live status line (idle / checking / available / downloading-NN% /
 * downloaded / error / up-to-date). Safe to call even before the window exists.
 */
function broadcastUpdaterEvent(type, payload = {}) {
    if (mainWindow && !mainWindow.isDestroyed()) {
        try {
            mainWindow.webContents.send('updater-event', { type, at: Date.now(), ...payload });
        } catch (_) {}
    }
}

function notifyUpdateReady(info) {
    updaterReadyPayload = info;
    if (Notification.isSupported()) {
        try {
            const n = new Notification({
                title: 'Social Blocker update ready',
                body: `Version ${info?.version || ''} downloaded. Open the app and click "Restart to install".`
            });
            n.on('click', () => {
                if (mainWindow) {
                    if (mainWindow.isMinimized()) mainWindow.restore();
                    mainWindow.show();
                    mainWindow.focus();
                }
            });
            n.show();
        } catch (e) { console.warn('Updater notification failed:', e.message); }
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update-ready', {
            version: info?.version,
            releaseNotes: info?.releaseNotes || null,
            releaseDate: info?.releaseDate || null
        });
    }
    refreshTray();
}

function setupAutoUpdater() {
    if (!autoUpdater) return; // module not installed
    if (!app.isPackaged) {
        console.log('Updater: skipped in dev (npm start). Builds only check from packaged installers.');
        return;
    }

    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.allowPrerelease = false;

    if (autoUpdater.logger && autoUpdater.logger.transports && autoUpdater.logger.transports.file) {
        autoUpdater.logger.transports.file.level = 'info';
    }

    autoUpdater.on('checking-for-update', () => {
        console.log('Updater: checking…');
        broadcastUpdaterEvent('checking');
    });
    autoUpdater.on('update-available', (info) => {
        console.log(`Updater: update available — v${info?.version || '?'}`);
        broadcastUpdaterEvent('available', { version: info?.version || null });
    });
    autoUpdater.on('update-not-available', () => {
        console.log('Updater: app is up to date.');
        broadcastUpdaterEvent('up-to-date');
    });
    autoUpdater.on('error', (err) => {
        console.error('Updater error:', err?.message || err);
        broadcastUpdaterEvent('error', { message: err?.message || String(err) });
    });
    autoUpdater.on('download-progress', (p) => {
        const pct = Math.round(p.percent);
        console.log(`Updater: downloading ${pct}%`);
        broadcastUpdaterEvent('downloading', { percent: pct, bytesPerSecond: p.bytesPerSecond, total: p.total });
    });
    autoUpdater.on('update-downloaded', (info) => {
        console.log(`Updater: update downloaded — v${info?.version}`);
        broadcastUpdaterEvent('downloaded', { version: info?.version || null });
        notifyUpdateReady(info);
    });

    // Initial check shortly after startup so we don't compete with the usage-tracker boot delay.
    setTimeout(() => {
        autoUpdater.checkForUpdates().catch(e => console.error('Updater initial check:', e?.message || e));
    }, 30_000);

    // Periodic re-check every 6 hours.
    if (updaterCheckInterval) clearInterval(updaterCheckInterval);
    updaterCheckInterval = setInterval(() => {
        autoUpdater.checkForUpdates().catch(e => console.error('Updater periodic check:', e?.message || e));
    }, 6 * 60 * 60 * 1000);
}

// ---------------------------------------------------------------------------
// DEEP WORK AUTO-SCHEDULE EVALUATOR
// ---------------------------------------------------------------------------
// Ticks every 30s and fires any rule whose window is "now" (within a 5-minute
// grace). Why 30s instead of waiting until the exact moment with setTimeout?
//  - Robust against sleep/wake: when the machine resumes we naturally re-evaluate
//    on the next tick instead of trusting a long-since-stale timer.
//  - Robust against system clock changes (DST, manual time adjust, time-sync).
//  - Cheap: ~2 array iterations per tick, no I/O unless we actually fire.
//
// Double-fire guard: once a rule fires, dataManager marks lastFiredOn=today
// so subsequent ticks inside the grace window skip it.
//
// Active-session guard: if any deep work is already running (manual or
// scheduled), we mark the rule as fired (so it doesn't try again later today)
// and log a skip — surprising users with overlapping sessions is worse than
// silently honouring the manual one.

function broadcastScheduleEvent(type, payload = {}) {
    if (mainWindow && !mainWindow.isDestroyed()) {
        try {
            mainWindow.webContents.send('schedule-event', { type, at: Date.now(), ...payload });
        } catch (_) {}
    }
}

function evaluateSchedule() {
    if (!dataManager) return;
    let rules;
    try {
        rules = dataManager.getDeepWorkSchedule();
    } catch (e) {
        console.warn('Schedule evaluator: getDeepWorkSchedule threw:', e?.message || e);
        return;
    }
    if (!rules || rules.length === 0) return;

    const now = new Date();
    const todayISO = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    for (const rule of rules) {
        const DataManager = dataManager.constructor;
        if (!DataManager.shouldFireRuleNow(rule, now, SCHEDULE_GRACE_MINUTES)) continue;

        // Active-session guard.
        const currentDw = dataManager.normalizeDeepWork(dataManager.getDeepWork());
        if (currentDw && currentDw.isActive) {
            console.log(`Schedule: rule "${rule.name}" (${rule.id}) skipped — Deep Work already active.`);
            dataManager.markScheduleRuleFired(rule.id, todayISO);
            broadcastScheduleEvent('skipped-active', { ruleId: rule.id, ruleName: rule.name });
            continue;
        }

        const durationSeconds = (rule.durationMinutes || 60) * 60;
        console.log(`Schedule: firing rule "${rule.name}" (${rule.id}) — ${rule.durationMinutes}min`);
        try {
            startDeepWork(durationSeconds);
            dataManager.markScheduleRuleFired(rule.id, todayISO);
            broadcastScheduleEvent('fired', {
                ruleId: rule.id,
                ruleName: rule.name,
                durationMinutes: rule.durationMinutes
            });
            if (Notification.isSupported()) {
                try {
                    new Notification({
                        title: `Deep Work started: ${rule.name}`,
                        body: `Auto-scheduled session running for ${rule.durationMinutes} minutes.`
                    }).show();
                } catch (_) {}
            }
        } catch (e) {
            console.error(`Schedule: rule "${rule.name}" failed to start:`, e?.message || e);
            broadcastScheduleEvent('error', { ruleId: rule.id, ruleName: rule.name, message: e?.message || String(e) });
        }
    }
}

function startScheduleEvaluator() {
    if (scheduleEvaluatorInterval) clearInterval(scheduleEvaluatorInterval);
    // Run once immediately so an app launch at the scheduled time catches it
    // without waiting 30s.
    evaluateSchedule();
    scheduleEvaluatorInterval = setInterval(evaluateSchedule, SCHEDULE_EVAL_INTERVAL_MS);
    console.log(`Schedule: evaluator running every ${SCHEDULE_EVAL_INTERVAL_MS / 1000}s.`);
}

function stopScheduleEvaluator() {
    if (scheduleEvaluatorInterval) {
        clearInterval(scheduleEvaluatorInterval);
        scheduleEvaluatorInterval = null;
    }
}

// ---------------------------------------------------------------------------
// DIGEST / REPORT GENERATION
// ---------------------------------------------------------------------------
// Generates self-contained HTML usage reports and writes them to the user's
// configured target folder (default: G:\My Drive\Social Blocker\reports).
// Scheduler is "opportunistic": every 5 minutes we ask "should we generate?".
// Weekly fires the first time we see Monday >= 09:00 with no prior run that ISO week.
// Monthly fires the first time we see day-of-month 1 >= 09:00 with no prior run this month.
// This survives sleep / app restarts because state lives in electron-store.

async function generateDigest(period, { force = false, asOf = new Date() } = {}) {
    if (!dataManager || !reportGenerator) {
        return { success: false, error: 'managers_not_ready' };
    }
    const settings = dataManager.getReportSettings();

    const enabled = period === 'weekly' ? settings.weeklyEnabled : settings.monthlyEnabled;
    if (!enabled && !force) return { success: false, error: 'period_disabled' };

    const built = period === 'weekly'
        ? reportGenerator.buildWeekly({ asOf })
        : reportGenerator.buildMonthly({ asOf });

    const saved = reportGenerator.saveReport({
        html: built.html,
        filename: built.filename,
        targetFolder: settings.targetFolder
    });

    if (!saved.success) return { success: false, error: saved.error };

    const stamp = new Date().toISOString();
    dataManager.setReportSettings(
        period === 'weekly'
            ? { lastWeeklyGeneratedAt: stamp }
            : { lastMonthlyGeneratedAt: stamp }
    );

    if (settings.autoOpenOnGenerate) {
        try {
            const openErr = await shell.openPath(saved.filepath);
            if (openErr) console.warn('Digest open returned:', openErr);
        } catch (e) {
            console.error('Digest open failed:', e);
        }
    }
    console.log(`Digest [${period}] saved: ${saved.filepath}`);
    return { success: true, filepath: saved.filepath };
}

/** Returns true if the saved ISO timestamp falls in the same ISO week as `now`. */
function sameISOWeek(now, lastIso) {
    if (!lastIso) return false;
    const last = new Date(lastIso);
    const a = reportGenerator.getISOWeek(now);
    const b = reportGenerator.getISOWeek(last);
    return a.year === b.year && a.week === b.week;
}

function sameMonth(now, lastIso) {
    if (!lastIso) return false;
    const last = new Date(lastIso);
    return now.getFullYear() === last.getFullYear() && now.getMonth() === last.getMonth();
}

async function maybeAutoGenerateDigests() {
    if (!dataManager || !reportGenerator) return;
    const now = new Date();
    const settings = dataManager.getReportSettings();

    // Weekly — Monday, 09:00+
    if (settings.weeklyEnabled
        && now.getDay() === 1
        && now.getHours() >= 9
        && !sameISOWeek(now, settings.lastWeeklyGeneratedAt)) {
        await generateDigest('weekly', { asOf: now });
    }

    // Monthly — day 1, 09:00+
    if (settings.monthlyEnabled
        && now.getDate() === 1
        && now.getHours() >= 9
        && !sameMonth(now, settings.lastMonthlyGeneratedAt)) {
        await generateDigest('monthly', { asOf: now });
    }
}

function startDigestScheduler() {
    if (digestCheckInterval) clearInterval(digestCheckInterval);
    maybeAutoGenerateDigests().catch(e => console.error('Digest auto-gen:', e));
    digestCheckInterval = setInterval(() => {
        maybeAutoGenerateDigests().catch(e => console.error('Digest auto-gen:', e));
    }, 5 * 60 * 1000); // 5 minutes
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

    // Route any <a target="_blank"> or window.open(...) call (e.g. the "View
    // all releases" link in Settings, or the GitHub source link in About) out
    // to the user's default browser. Without this Electron silently swallows
    // them since we have nodeIntegration off + no nested window handler.
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (/^https?:\/\//i.test(url)) {
            shell.openExternal(url).catch(e => console.warn('openExternal failed:', e?.message || e));
        }
        return { action: 'deny' };
    });

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


// ---------------------------------------------------------------------------
// HUD WIDGET — small frameless always-on-top window (Item D)
// ---------------------------------------------------------------------------
// Anchored bottom-right above the Windows taskbar. Persists visibility across
// restarts. Auto-hides during fullscreen apps (toggleable via hudConfig).
// Compact 260×160 fixed-size variant — resize will come later as a preset toggle.

const HUD_WIDTH = 260;
const HUD_HEIGHT = 160;
const HUD_EDGE_MARGIN = 16;

function positionHudBottomRight() {
    if (!hudWindow || hudWindow.isDestroyed()) return;
    const display = screen.getPrimaryDisplay();
    const { x, y, width, height } = display.workArea; // workArea excludes taskbar
    const targetX = x + width - HUD_WIDTH - HUD_EDGE_MARGIN;
    const targetY = y + height - HUD_HEIGHT - HUD_EDGE_MARGIN;
    hudWindow.setBounds({ x: targetX, y: targetY, width: HUD_WIDTH, height: HUD_HEIGHT });
}

function createHudWindow() {
    if (hudWindow && !hudWindow.isDestroyed()) return hudWindow;
    hudWindow = new BrowserWindow({
        width: HUD_WIDTH,
        height: HUD_HEIGHT,
        frame: false,
        transparent: true,
        resizable: false,
        movable: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        show: false,
        // focusable:false lets the HUD never steal focus from the active app — important
        // because the user is presumably working when they see it.
        focusable: false,
        webPreferences: {
            preload: path.join(__dirname, 'hudPreload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });
    hudWindow.setAlwaysOnTop(true, 'screen-saver'); // ensure top-most over fullscreen browsers
    hudWindow.loadFile('hud.html');
    positionHudBottomRight();

    const cfg = dataManager.getHudConfig();
    if (cfg.clickThrough) {
        hudWindow.setIgnoreMouseEvents(true, { forward: true });
    }

    hudWindow.on('closed', () => { hudWindow = null; });
    global.hudWindow = hudWindow;
    return hudWindow;
}

function showHud() {
    if (!hudWindow || hudWindow.isDestroyed()) createHudWindow();
    if (!hudWindow) return;
    positionHudBottomRight();
    hudWindow.showInactive(); // show without stealing focus
    dataManager.setHudConfig({ visible: true });
    refreshTray();
    // Push current state immediately so user sees data right away rather than waiting for next tick.
    setTimeout(pushHudInitialState, 100);
}

function hideHud() {
    if (hudWindow && !hudWindow.isDestroyed()) hudWindow.hide();
    dataManager.setHudConfig({ visible: false });
    refreshTray();
}

function toggleHud() {
    const visible = !!(hudWindow && !hudWindow.isDestroyed() && hudWindow.isVisible());
    if (visible) hideHud(); else showHud();
}

function pushHudInitialState() {
    if (!hudWindow || hudWindow.isDestroyed()) return;
    try {
        hudWindow.webContents.send('hud-site-settings', dataManager.getSiteSettings());
        hudWindow.webContents.send('usage-updated', dataManager.getTodayUsage());
        const dw = dataManager.normalizeDeepWork(dataManager.getDeepWork());
        hudWindow.webContents.send('deep-work-update', dw || { isActive: false, remainingMs: 0 });
    } catch (e) { console.warn('HUD initial state push failed:', e.message); }
}

/**
 * Compares the active window bounds against the display bounds to detect fullscreen.
 * If we've been told to auto-hide during fullscreen (default), temporarily hide.
 * Re-shows when the window is no longer fullscreen. Called from the tracker tick.
 */
function applyHudFullscreenPolicy(activeWinBounds) {
    if (!hudWindow || hudWindow.isDestroyed()) return;
    const cfg = dataManager.getHudConfig();
    if (!cfg.visible || !cfg.autoHideFullscreen) return;
    if (!activeWinBounds || typeof activeWinBounds.width !== 'number') return;

    const display = screen.getDisplayMatching(activeWinBounds);
    if (!display) return;

    // Heuristic: window matches the FULL display (not workArea) within 4px on every side.
    const fs = display.bounds;
    const isFullscreen =
        Math.abs(activeWinBounds.x - fs.x) < 4 &&
        Math.abs(activeWinBounds.y - fs.y) < 4 &&
        Math.abs((activeWinBounds.x + activeWinBounds.width) - (fs.x + fs.width)) < 4 &&
        Math.abs((activeWinBounds.y + activeWinBounds.height) - (fs.y + fs.height)) < 4;

    if (isFullscreen && hudWindow.isVisible()) {
        hudWindow.hide();
        hudFullscreenHidden = true;
    } else if (!isFullscreen && hudFullscreenHidden && !hudWindow.isVisible()) {
        hudWindow.showInactive();
        hudFullscreenHidden = false;
    }
}
global.applyHudFullscreenPolicy = applyHudFullscreenPolicy;

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
    const fallback = nativeImage.createFromBuffer(Buffer.from(FALLBACK_TRAY_PNG_BASE64, 'base64'));
    return { image: fallback, source: '<embedded fallback>', fallback: true };
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
    const unblocks = dataManager.getTodayUnblocks ? dataManager.getTodayUnblocks() : {};
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

    const hudVisible = !!(hudWindow && !hudWindow.isDestroyed() && hudWindow.isVisible());
    template.push({
        label: hudVisible ? 'Hide HUD widget' : 'Show HUD widget',
        click: () => toggleHud()
    });

    template.push({ type: 'separator' });
    template.push({
        label: 'Repair hosts file now',
        click: () => { applyHostsToSystem('tray_repair').catch(e => console.error('Tray repair:', e)); }
    });

    if (autoUpdater && app.isPackaged) {
        template.push({ type: 'separator' });
        if (updaterReadyPayload) {
            template.push({
                label: `Restart to install v${updaterReadyPayload.version}`,
                click: () => {
                    isQuitting = true;
                    setImmediate(() => autoUpdater.quitAndInstall(true, true));
                }
            });
        } else {
            template.push({
                label: 'Check for updates',
                click: () => {
                    autoUpdater.checkForUpdates().catch(e => console.error('Tray updater check:', e?.message || e));
                }
            });
        }
    }

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

app.whenReady().then(() => {
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
        (dataManager.normalizeDeepWork(dataManager.getDeepWork()) ? dataManager.computeDeepWorkDomains() : []);
    usageTracker = new UsageTracker(dataManager, hostsManager, getDeepExtras);
    reportGenerator = new ReportGenerator(dataManager);

    hostsManager.setExternalTamperHandler(() => {
        handleExternalHostsTamperWatch().catch(e => console.error('Hosts watchdog:', e));
    });
    hostsManager.startHostsWatchdog();

    console.log('Main: Initialized managers');
    console.log('Main: Site settings:', dataManager.getSiteSettings());
    console.log('Main: Today\'s usage:', dataManager.getTodayUsage());
    
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
    
    // Check if app was launched on startup
    const launchedOnStartup = app.getLoginItemSettings().wasOpenedAtLogin || 
                             process.argv.includes('--hidden');
    
    createWindow();
    
    // If launched on startup, keep window hidden; otherwise show it
    if (launchedOnStartup) {
        console.log('Main: Launched on startup - starting minimized to tray');
        mainWindow.hide();
    } else {
        console.log('Main: Launched manually - showing window');
        mainWindow.show();
    }
    
    // Initialize Tray
    createTray();
    
    // Check if deep work was active when app was closed
    const deepWorkEndTime = dataManager.store.get('deepWork.endTime');
    if (deepWorkEndTime && new Date().getTime() < deepWorkEndTime) {
        const remainingTime = deepWorkEndTime - new Date().getTime();
        startDeepWork(remainingTime / 1000); // Restart the timer
    } else {
        dataManager.deleteDeepWork(); // Clean up expired timer
    }

    scheduleNextMidnightRollover();
    startDigestScheduler();
    setupAutoUpdater();
    startScheduleEvaluator();

    // HUD: restore visibility from last session.
    if (dataManager.getHudConfig().visible) {
        createHudWindow();
        // Defer show slightly so the file finishes loading before initial state is pushed.
        setTimeout(() => { try { showHud(); } catch (e) { console.error('HUD restore:', e); } }, 600);
    }

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
    if (digestCheckInterval) {
        clearInterval(digestCheckInterval);
        digestCheckInterval = null;
    }
    if (updaterCheckInterval) {
        clearInterval(updaterCheckInterval);
        updaterCheckInterval = null;
    }
    stopScheduleEvaluator();
    if (midnightTimer) {
        clearTimeout(midnightTimer);
        midnightTimer = null;
    }
    if (hostsManager && typeof hostsManager.stopHostsWatchdog === 'function') {
        try { hostsManager.stopHostsWatchdog(); } catch (_) {}
    }
    if (tray) {
        tray.destroy();
        console.log('Main: Tray destroyed');
    }
});

// --- IPC Handlers ---
ipcMain.handle('get-initial-data', async () => {
    let hostsIntegrity = null;
    try {
        if (hostsManager && dataManager) {
            const expected = combinedExpectedDomainsForHosts();
            const v = hostsManager.verifyHostsSection(expected);
            hostsIntegrity = {
                ok: v.ok,
                unexpectedMissing: v.unexpectedMissing,
                unexpectedExtra: v.unexpectedExtra,
                sectionPresent: v.sectionPresent,
                expectedDomainCount: expected.length
            };
        }
    } catch (e) {
        console.warn('get-initial-data: integrity probe failed', e.message);
    }
    return dataManager.getInitialData({ hostsIntegrity });
});

ipcMain.handle('repair-hosts-now', async () => {
    return applyHostsToSystem('manual_repair');
});

ipcMain.handle('lock-site-for-today', (event, siteName) => {
    return dataManager.lockSiteForToday(siteName);
});

ipcMain.handle('get-manual-locks', () => {
    return dataManager.getManualLocks();
});

// Returns a tier-scaled commitment payload.
//   { paragraph, requiredText, tier, sentenceCount, cooldownSeconds, priorCount }
// The renderer enforces:
//   - cooldownSeconds before the input becomes editable
//   - typed value must exactly equal `requiredText` (which is a leading
//     N-sentence slice of `paragraph` chosen by computeFrictionPolicy)
// Sending the full `paragraph` too is helpful for displaying the unrequired
// remainder in muted text — a subtle reminder that the full case for
// discipline still exists, the user just doesn't have to type it yet.
ipcMain.handle('get-commitment-paragraph', () => {
    const DataManager = dataManager.constructor;
    const cfg = dataManager.getProgressiveFrictionConfig();
    const priorCount = dataManager.getTodayUnblockTotal();
    const policy = DataManager.computeFrictionPolicy(priorCount, { enabled: cfg.enabled });
    const paragraph = commitmentParagraphs[Math.floor(Math.random() * commitmentParagraphs.length)];
    const requiredText = DataManager.extractFirstNSentences(paragraph, policy.sentenceCount);
    return {
        paragraph,
        requiredText,
        tier: policy.tier,
        sentenceCount: policy.sentenceCount,
        cooldownSeconds: policy.cooldownSeconds,
        priorCount,
        progressiveEnabled: cfg.enabled
    };
});

ipcMain.handle('get-progressive-friction-config', () => {
    return dataManager.getProgressiveFrictionConfig();
});

ipcMain.handle('set-progressive-friction-config', (_event, partial) => {
    return dataManager.setProgressiveFrictionConfig(partial || {});
});

ipcMain.handle('update-hosts-file', async (event, sitesToBlock) => {
    dataManager.setBlockedDomains(sitesToBlock);
    return hostsManager.updateHostsFile(sitesToBlock);
});

ipcMain.handle('set-site-limit', async (event, { siteName, limit }) => {
    return dataManager.setSiteLimit(siteName, limit);
});

ipcMain.handle('start-deep-work', async (event, durationInSeconds) => {
    return startDeepWork(durationInSeconds);
});

ipcMain.handle('get-deep-work-config', async () => {
    return {
        config: dataManager.getDeepWorkConfig(),
        specialSites: dataManager.getDeepWorkSpecialSites(),
        siteSettings: dataManager.getSiteSettings()
    };
});

ipcMain.handle('set-deep-work-config', async (_event, partial) => {
    const next = dataManager.setDeepWorkConfig(partial || {});
    // If a session is currently active, the hosts file must be refreshed to reflect new selections.
    const dw = dataManager.normalizeDeepWork(dataManager.getDeepWork());
    if (dw) {
        await applyHostsToSystem('deep_work_config_changed');
    }
    return next;
});

// --- Deep Work auto-schedule CRUD ---
ipcMain.handle('schedule-get', async () => {
    const DataManager = dataManager.constructor;
    const rules = dataManager.getDeepWorkSchedule();
    const next = DataManager.computeNextFireTime(rules, new Date());
    return {
        rules,
        next: next ? {
            ruleId: next.ruleId,
            ruleName: next.ruleName,
            fireAt: next.fireAt.toISOString()
        } : null
    };
});

ipcMain.handle('schedule-add', async (_event, partial) => {
    // Return both the rule list AND a duplicate flag so the renderer can show
    // a "Rule already exists" toast instead of silently re-rendering the same
    // list. Without this signal the user assumes the click was lost and clicks
    // again, which historically caused 9 dupes to pile up.
    const wasDuplicate = dataManager.scheduleRuleExists(partial || {});
    const rules = dataManager.addScheduleRule(partial || {});
    return { rules, duplicate: wasDuplicate };
});

ipcMain.handle('schedule-update', async (_event, payload) => {
    if (!payload || !payload.id) return dataManager.getDeepWorkSchedule();
    return dataManager.updateScheduleRule(payload.id, payload.changes || {});
});

ipcMain.handle('schedule-delete', async (_event, payload) => {
    if (!payload || !payload.id) return dataManager.getDeepWorkSchedule();
    return dataManager.deleteScheduleRule(payload.id);
});

ipcMain.handle('schedule-clear-all', async () => {
    return dataManager.clearDeepWorkSchedule();
});

// ============================================================
// Phone usage data (v1.7.0)
// ------------------------------------------------------------
// IPC surface for the renderer's Settings -> Phone Data section.
// CSV folder import is the only feeder today; ADB / StayFree will
// land as additional handlers (phone-import-adb, phone-import-stayfree)
// without changing the storage layer or the renderer's status surface.
// ============================================================
const phoneCsvParser = require('./phoneCsvParser');

ipcMain.handle('phone-get-status', async () => {
    return dataManager.getPhoneStatus();
});

/**
 * Open native folder picker. Returns { canceled, folderPath } so the
 * renderer can immediately follow up with phone-import-folder.
 */
ipcMain.handle('phone-pick-folder', async () => {
    const lastFolder = dataManager.getPhoneStatus().lastImportFolder || undefined;
    const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Select phone-CSV folder',
        defaultPath: lastFolder,
        properties: ['openDirectory'],
        buttonLabel: 'Use this folder',
    });
    if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
        return { canceled: true, folderPath: null };
    }
    return { canceled: false, folderPath: result.filePaths[0] };
});

/**
 * Parse + merge a phone-data folder into the store. Returns the import
 * summary the renderer can toast. Errors surface with `success:false`.
 */
ipcMain.handle('phone-import-folder', async (_event, folderPath) => {
    if (!folderPath || typeof folderPath !== 'string') {
        return { success: false, error: 'no_folder' };
    }
    try {
        const payload = phoneCsvParser.parseFolder(folderPath);
        payload.sourceFolder = folderPath;
        const summary = dataManager.importPhoneUsage(payload);
        return {
            success: true,
            ...summary,
            status: dataManager.getPhoneStatus(),
        };
    } catch (e) {
        return { success: false, error: e?.message || String(e) };
    }
});

ipcMain.handle('phone-clear-all', async () => {
    dataManager.clearPhoneUsage();
    return { success: true, status: dataManager.getPhoneStatus() };
});

/**
 * Returns the phone-scoped equivalent of get-insights. Renderer's scope
 * toggle [Desktop|Phone|Both] switches between get-insights (existing) and
 * get-phone-insights (this).
 */
ipcMain.handle('get-phone-insights', async () => {
    const status = dataManager.getPhoneStatus();
    if (!status.hasData) {
        return { hasData: false, status };
    }
    const todayIso = dataManager.getLocalISODate();
    const week = dataManager.getPhoneWeekTotals(0);
    const lastWeek = dataManager.getPhoneWeekTotals(1);
    const thisWeekTotal = week.reduce((a, d) => a + d.totalMinutes, 0);
    const lastWeekTotal = lastWeek.reduce((a, d) => a + d.totalMinutes, 0);

    // Best day = LEAST screen-time in this week that has data (mirrors
    // desktop interpretation of "best day").
    const daysWithData = week.filter(d => d.hasData);
    let bestDay = null;
    if (daysWithData.length) {
        bestDay = daysWithData.reduce((best, d) =>
            (best === null || d.totalMinutes < best.totalMinutes) ? d : best,
        null);
    }

    return {
        hasData: true,
        status,
        today: {
            date: todayIso,
            totalMinutes: dataManager.getPhoneDailyTotalMinutes(todayIso),
            unlocks: dataManager.getPhoneDailyUnlocks(todayIso),
            topApp: dataManager.getPhoneTopAppForDay(todayIso),
            topOpenedApp: dataManager.getPhoneTopOpenedAppForDay(todayIso),
        },
        week: { days: week, thisWeekTotal, lastWeekTotal, bestDay },
    };
});

ipcMain.handle('end-deep-work', async () => {
    if (!dataManager.normalizeDeepWork(dataManager.getDeepWork())) {
        return { success: false, error: 'no_active_session' };
    }
    clearDeepWorkTimers();
    dataManager.deleteDeepWork();
    const r = await applyHostsToSystem('deep_work_ended_early');
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('deep-work-update', { isActive: false, remainingMs: 0 });
    }
    refreshTray();
    return { success: true, hostsResult: r };
});

ipcMain.handle('get-history', async () => {
    return dataManager.getHistoryData();
});

ipcMain.handle('get-insights', async () => {
    return dataManager.buildInsightsPayload(new Date());
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

// --- Digest / Reports ---
ipcMain.handle('get-report-settings', async () => {
    return dataManager.getReportSettings();
});

ipcMain.handle('set-report-settings', async (_event, partial) => {
    return dataManager.setReportSettings(partial || {});
});

ipcMain.handle('generate-digest-now', async (_event, period) => {
    if (period !== 'weekly' && period !== 'monthly') {
        return { success: false, error: 'invalid_period' };
    }
    return generateDigest(period, { force: true });
});

// --- HUD widget ---
ipcMain.handle('hud-get-initial-state', async () => {
    if (!dataManager) return null;
    return {
        siteSettings: dataManager.getSiteSettings(),
        usageData: dataManager.getTodayUsage(),
        deepWork: dataManager.normalizeDeepWork(dataManager.getDeepWork()),
        config: dataManager.getHudConfig()
    };
});

ipcMain.handle('hud-show', async () => { showHud(); return { success: true }; });
ipcMain.handle('hud-hide', async () => { hideHud(); return { success: true }; });
ipcMain.handle('hud-toggle', async () => { toggleHud(); return { success: true }; });
ipcMain.handle('hud-open-main', async () => {
    if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
    }
    return { success: true };
});
ipcMain.handle('hud-get-config', async () => dataManager.getHudConfig());
ipcMain.handle('hud-set-config', async (_event, partial) => {
    const next = dataManager.setHudConfig(partial || {});
    if (hudWindow && !hudWindow.isDestroyed()) {
        hudWindow.setIgnoreMouseEvents(!!next.clickThrough, { forward: true });
    }
    return next;
});

// --- Auto-Update ---
ipcMain.handle('updater-check-now', async () => {
    if (!autoUpdater) return { success: false, error: 'updater_not_installed' };
    if (!app.isPackaged) return { success: false, error: 'dev_mode' };
    try {
        const result = await autoUpdater.checkForUpdates();
        return {
            success: true,
            currentVersion: app.getVersion(),
            updateInfo: result?.updateInfo || null,
            isUpdateAvailable: !!(result?.updateInfo && result.updateInfo.version !== app.getVersion())
        };
    } catch (e) {
        return { success: false, error: e?.message || String(e) };
    }
});

ipcMain.handle('updater-install-now', async () => {
    if (!autoUpdater) return { success: false, error: 'updater_not_installed' };
    if (!updaterReadyPayload) return { success: false, error: 'no_update_downloaded' };
    try {
        isQuitting = true;
        setImmediate(() => autoUpdater.quitAndInstall(true, true));
        return { success: true };
    } catch (e) {
        return { success: false, error: e?.message || String(e) };
    }
});

ipcMain.handle('updater-get-status', async () => {
    return {
        installed: !!autoUpdater,
        packaged: app.isPackaged,
        currentVersion: app.getVersion(),
        pendingUpdate: updaterReadyPayload ? {
            version: updaterReadyPayload.version,
            releaseNotes: updaterReadyPayload.releaseNotes || null,
            releaseDate: updaterReadyPayload.releaseDate || null
        } : null
    };
});

// --- Startup / login item ---
// app.getLoginItemSettings()/setLoginItemSettings() must be called with the
// SAME args we registered the entry with on boot, otherwise the lookup will
// fail to find it. We always register with ['--hidden'] in packaged builds.
ipcMain.handle('startup-get', async () => {
    if (!app.isPackaged) {
        return {
            openAtLogin: false,
            canModify: false,
            reason: 'dev_mode'
        };
    }
    try {
        const s = app.getLoginItemSettings({ args: ['--hidden'] });
        return {
            openAtLogin: !!s.openAtLogin,
            wasOpenedAtLogin: !!s.wasOpenedAtLogin,
            wasOpenedAsHidden: !!s.wasOpenedAsHidden,
            canModify: true
        };
    } catch (e) {
        return { openAtLogin: false, canModify: false, error: e?.message || String(e) };
    }
});

ipcMain.handle('startup-set', async (_event, payload) => {
    const openAtLogin = !!(payload && payload.openAtLogin);
    if (!app.isPackaged) {
        return { success: false, error: 'dev_mode_disabled' };
    }
    try {
        app.setLoginItemSettings({
            openAtLogin,
            openAsHidden: true,
            args: ['--hidden']
        });
        console.log(`Main: startup-set -> openAtLogin=${openAtLogin}`);
        return { success: true, openAtLogin };
    } catch (e) {
        return { success: false, error: e?.message || String(e) };
    }
});

ipcMain.handle('open-report-folder', async () => {
    if (!dataManager) return { success: false, error: 'not_ready' };
    const { targetFolder } = dataManager.getReportSettings();
    try {
        if (!fs.existsSync(targetFolder)) fs.mkdirSync(targetFolder, { recursive: true });
        const err = await shell.openPath(targetFolder);
        if (err) return { success: false, error: err };
        return { success: true, path: targetFolder };
    } catch (e) {
        return { success: false, error: e.message };
    }
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
        const result = await hostsManager.updateHostsFile([]);
        console.log('Test result:', result);
        return result;
    } catch (error) {
        console.error('Test failed:', error);
        return { success: false, error: error.message };
    }
});


// --- Core Logic ---
function startDeepWork(durationInSeconds) {
    clearDeepWorkTimers(); // Clear any existing timer

    const endTimeMs = Date.now() + durationInSeconds * 1000;
    const remainingMs = endTimeMs - Date.now();
    dataManager.setDeepWork({ endTime: endTimeMs });

    // Apply hosts (current blocked domains + dynamic deep-work extras from config).
    applyHostsToSystem('deep_work_start').catch(e => console.error('Deep work start hosts apply:', e));

    const broadcastDw = (payload) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('deep-work-update', payload);
        }
        if (hudWindow && !hudWindow.isDestroyed()) {
            try { hudWindow.webContents.send('deep-work-update', payload); } catch (_) {}
        }
    };
    const tick = () => {
        const rem = endTimeMs - Date.now();
        broadcastDw({
            isActive: rem > 0,
            remainingMs: Math.max(0, rem),
            endTime: endTimeMs
        });
    };
    tick();
    deepWorkInterval = setInterval(tick, 1000);

    deepWorkTimeout = setTimeout(async () => {
        if (deepWorkInterval) {
            clearInterval(deepWorkInterval);
            deepWorkInterval = null;
        }
        dataManager.deleteDeepWork();
        try { await applyHostsToSystem('deep_work_complete'); }
        catch (e) { console.error('Deep work end hosts apply:', e); }
        broadcastDw({ isActive: false, remainingMs: 0 });
        refreshTray();
    }, remainingMs);

    refreshTray();
    return { success: true };
}


