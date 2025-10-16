const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

// --- Import Modules ---
const DataManager = require('./dataManager');
const HostsManager = require('./hostsManager');
const UsageTracker = require('./usageTracker');

// --- Configuration ---
const deepWorkSites = ['web.whatsapp.com', 'messenger.com', 'www.messenger.com'];

// --- Commitment Paragraphs ---
const commitmentParagraphs = [
    "Discipline is the bridge between goals and accomplishment. It is the refusal to be swayed by momentary comfort or fleeting distraction. By choosing this path, I am not punishing myself; I am investing in my future self. Every second I reclaim from mindless scrolling is a second I can dedicate to building the career, the skills, and the life I truly desire. This deliberate act of focus is a declaration that my long-term ambitions are more valuable than my short-term impulses.",
    "The path to excellence is paved with focused effort, not scattered attention. True progress is measured in deliberate, concentrated work sessions where the noise of the world fades away. I am committing to this focus not out of obligation, but out of respect for my own potential. I recognize that my greatest breakthroughs will not come from passive consumption, but from active creation. This time is a sanctuary for deep thought and meaningful execution. I will protect it fiercely.",
    "Motivation is what gets you started; habit is what keeps you going. I am building the habit of discipline. This choice is a conscious repetition of an action that aligns with my highest values. It is the practice of prioritizing the important over the urgent, the meaningful over the trivial. I understand that the discomfort of this restriction is temporary, while the rewards of the work I am about to do will compound and last a lifetime. I am the architect of my habits and the master of my time."
];

// --- Main Window & App State ---
let mainWindow;
let deepWorkTimeout = null;
let dataManager;
let hostsManager;
let usageTracker;

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
    
    // Make mainWindow globally accessible for usage tracker
    global.mainWindow = mainWindow;
}

app.whenReady().then(() => {
    // Initialize managers
    dataManager = new DataManager();
    hostsManager = new HostsManager();
    usageTracker = new UsageTracker(dataManager, hostsManager);
    
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
    
    createWindow();
    
    // Check if deep work was active when app was closed
    const deepWorkEndTime = dataManager.store.get('deepWork.endTime');
    if (deepWorkEndTime && new Date().getTime() < deepWorkEndTime) {
        const remainingTime = deepWorkEndTime - new Date().getTime();
        startDeepWork(remainingTime / 1000); // Restart the timer
    } else {
        dataManager.deleteDeepWork(); // Clean up expired timer
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

// --- IPC Handlers ---
ipcMain.handle('get-initial-data', async () => {
    return dataManager.getInitialData();
});

ipcMain.handle('get-commitment-paragraph', () => {
    return commitmentParagraphs[Math.floor(Math.random() * commitmentParagraphs.length)];
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

ipcMain.handle('get-history', async () => {
    return dataManager.getHistoryData();
});

ipcMain.handle('log-blocker-event', async (event, isEnabled) => {
    return dataManager.addBlockerEvent(isEnabled);
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
    const today = new Date().toISOString().split('T')[0];
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
    if (deepWorkTimeout) clearTimeout(deepWorkTimeout); // Clear any existing timer

    const endTime = new Date().getTime() + durationInSeconds * 1000;
    dataManager.setDeepWork({ endTime });
    
    // Get current blocked domains and add deep work sites
    const currentBlocked = dataManager.getBlockedDomains();
    hostsManager.updateHostsFile(currentBlocked, deepWorkSites); // Immediately block deep work sites

    const interval = setInterval(() => {
        const now = new Date().getTime();
        const remaining = endTime - now;
        if (mainWindow) {
            mainWindow.webContents.send('deep-work-update', { isActive: true, remaining });
        }
    }, 1000);

    deepWorkTimeout = setTimeout(() => {
        clearInterval(interval);
        dataManager.deleteDeepWork();
        hostsManager.updateHostsFile(dataManager.getBlockedDomains()); // Unblock deep work sites
        if (mainWindow) {
            mainWindow.webContents.send('deep-work-update', { isActive: false, remaining: 0 });
        }
    }, durationInSeconds * 1000);

    return { success: true };
}


