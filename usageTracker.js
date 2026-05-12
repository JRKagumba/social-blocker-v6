// usageTracker.js - Handles background usage tracking and monitoring

class UsageTracker {
    constructor(dataManager, hostsManager, getDeepWorkExtras = () => []) {
        this.dataManager = dataManager;
        this.hostsManager = hostsManager;
        this.getDeepWorkExtras = typeof getDeepWorkExtras === 'function' ? getDeepWorkExtras : () => [];
        this.activeWin = null;
        this.isRunning = false;
        this.CHECK_INTERVAL = 2000; // 2 seconds — finer-grained sampling reduces undercounting from focus flicker
        
        // Debug mode properties
        this.debugMode = false;
        this.debugLogFile = null;
        this.debugStartTime = null;
        this.debugInterval = null;
        
        this.initializeActiveWin();
    }

    async initializeActiveWin() {
        try {
            console.log('Usage Tracker: Loading active-win module...');
            const activeWinModule = await import('active-win');
            this.activeWin = activeWinModule.default;
            console.log('Usage Tracker: active-win module loaded successfully');
            console.log('Usage Tracker: Ready to start (will not auto-start)');
            // Don't auto-start - wait for explicit start command
        } catch (err) {
            console.error('Usage Tracker: Failed to load active-win:', err);
            console.log('Usage Tracker: Retrying in 1 second...');
            // Retry after 1 second
            setTimeout(() => this.initializeActiveWin(), 1000);
        }
    }

    start() {
        if (this.isRunning || !this.activeWin) {
            if (!this.activeWin) {
                console.log('Usage Tracker: activeWin not ready, retrying in 1 second...');
                setTimeout(() => this.start(), 1000);
            }
            return;
        }

        this.isRunning = true;
        console.log('Usage Tracker: Started successfully with 5-second intervals');

        this.intervalId = setInterval(async () => {
            await this.checkActiveWindow();
        }, this.CHECK_INTERVAL);
    }

    stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
        this.isRunning = false;
        console.log('Usage tracker stopped');
    }

    async checkActiveWindow() {
        try {
            const windowInfo = await this.activeWin();
            if (!windowInfo) {
                console.log('Usage Tracker: No active window detected');
                return;
            }

            // Guard against null/undefined titles (it happens).
            const windowTitleRaw = windowInfo.title || '';
            const windowTitle = windowTitleRaw.toLowerCase();
            const ownerName = (windowInfo.owner?.name || '').toLowerCase();
            const ownerPath = (windowInfo.owner?.path || '').toLowerCase();
            console.log(`Usage Tracker: Active window - "${windowTitle}" (Owner: ${ownerName})`);

            // Permissive browser detection — active-win returns either the basename ("chrome.exe")
            // or the file description ("Google Chrome") depending on Windows version + install type.
            // Matching against BOTH owner.name and owner.path catches every observed variant.
            const browserIdentifiers = ['chrome', 'msedge', 'edge', 'brave', 'firefox', 'opera', 'vivaldi'];
            const isBrowser = browserIdentifiers.some(id =>
                ownerName.includes(id) || ownerPath.includes(`\\${id}.exe`)
            );
            if (!isBrowser) {
                console.log(`Usage Tracker: Skipping non-browser owner: "${ownerName}"`);
                return;
            }
            
            const allSiteSettings = this.dataManager.getSiteSettings();
            let usageUpdated = false;

            const compilePatterns = (site) => {
                if (!site || !Array.isArray(site.matchPatterns) || site.matchPatterns.length === 0) {
                    return [];
                }
                const patterns = [];
                for (const p of site.matchPatterns) {
                    if (typeof p !== 'string' || !p.trim()) continue;
                    try {
                        patterns.push(new RegExp(p, 'i'));
                    } catch (e) {
                        console.log(`Usage Tracker: Invalid match pattern for ${site.name || 'site'}: "${p}"`, e.message);
                    }
                }
                return patterns;
            };

            /**
             * Twitter/X: never keyword-fallback-match — pasted titles can contain "... netflix.com ..." substring "x.com"
             * matching would false-positive via includes(). Regex-only is intentional.
             */
            const keywordFallbackAllowed = site => site?.name !== 'Twitter/X';

            const safeKeywordMatch = (site) => {
                if (!keywordFallbackAllowed(site)) return null;
                if (!site || !Array.isArray(site.keywords) || site.keywords.length === 0) return null;
                for (const rawK of site.keywords) {
                    if (typeof rawK !== 'string') continue;
                    const k = rawK.trim().toLowerCase();
                    if (!k) continue;
                    // Safety: ignore overly-generic short tokens (the historic "x" issue).
                    if (k.length <= 2 && !k.includes('.')) continue;
                    if (windowTitle.includes(k)) return k;
                }
                return null;
            };

            for (const siteName in allSiteSettings) {
                try {
                    const site = allSiteSettings[siteName];
                    console.log(`Usage Tracker: Checking site "${siteName}"`);

                    const patterns = compilePatterns(site);
                    const patternMatched = patterns.find(re => re.test(windowTitle));
                    const keywordMatched = patternMatched ? null : safeKeywordMatch(site);

                    if (patternMatched || keywordMatched) {
                        const why = patternMatched ? `pattern: ${patternMatched}` : `keyword: "${keywordMatched}"`;
                        console.log(`🎯 Usage Tracker: MATCH FOUND! Site: ${siteName} (${why}) in: "${windowTitle}"`);
                        
                        // Get the full usage object first
                        const fullUsageObject = this.dataManager.getTodayUsage();
                        console.log(`📊 Usage Tracker: Full usage object:`, JSON.stringify(fullUsageObject));
                        console.log(`📊 Usage Tracker: Full usage object type: ${typeof fullUsageObject}`);
                        
                        // Now get the specific site's usage
                        const previousUsage = fullUsageObject[siteName] || 0;
                        console.log(`📊 Usage Tracker: Previous usage for ${siteName}: ${previousUsage} (type: ${typeof previousUsage})`);
                        console.log(`📊 Usage Tracker: previousUsage === 0: ${previousUsage === 0}`);
                        console.log(`📊 Usage Tracker: previousUsage == 0: ${previousUsage == 0}`);
                        
                        const additionalSeconds = this.CHECK_INTERVAL / 1000;
                        console.log(`⏱️  Usage Tracker: Adding ${additionalSeconds} seconds to ${siteName}`);
                        
                        const currentUsage = this.dataManager.updateSiteUsage(siteName, additionalSeconds);
                        console.log(`📊 Usage Tracker: updateSiteUsage returned:`, JSON.stringify(currentUsage));
                        console.log(`📊 Usage Tracker: updateSiteUsage return type: ${typeof currentUsage}`);
                        
                        const newUsage = currentUsage[siteName];
                        console.log(`📊 Usage Tracker: New usage value for ${siteName}: ${newUsage} (type: ${typeof newUsage})`);
                        
                        const usageInMinutes = newUsage / 60;
                        console.log(`📊 Usage Tracker: Usage in minutes: ${usageInMinutes} (type: ${typeof usageInMinutes})`);
                        
                        console.log(`✅ Usage Tracker: Updated usage for ${siteName}: ${previousUsage}s -> ${newUsage}s (${usageInMinutes.toFixed(2)} min)`);
                        usageUpdated = true;

                        // Check if site should be blocked due to limit
                        if (site.limit > 0 && usageInMinutes >= site.limit) {
                            console.log(`Usage Tracker: LIMIT REACHED for ${siteName}! Usage: ${usageInMinutes.toFixed(2)} min, Limit: ${site.limit} min`);
                            
                            const blockedDomains = new Set(this.dataManager.getBlockedDomains());
                            const previousBlockedCount = blockedDomains.size;
                            
                            if (site.domains) {
                                site.domains.forEach(d => blockedDomains.add(d));
                            }
                            
                            const newBlockedArray = Array.from(blockedDomains);
                            console.log(`Usage Tracker: Blocked domains before: ${previousBlockedCount}, after: ${newBlockedArray.length}`);
                            
                            if (newBlockedArray.length > this.dataManager.getBlockedDomains().length) {
                                console.log(`Usage Tracker: Auto-blocking ${siteName} - updating hosts file`);
                                this.dataManager.setBlockedDomains(newBlockedArray);
                                const extras = this.getDeepWorkExtras();
                                if (typeof this.hostsManager.suppressWatchTemporarily === 'function') {
                                    this.hostsManager.suppressWatchTemporarily(5000);
                                }
                                await this.hostsManager.updateHostsFile(newBlockedArray, extras);
                                const expected = Array.from(new Set(
                                    [...newBlockedArray, ...extras].map(d => String(d).toLowerCase())
                                ));
                                const v = this.hostsManager.verifyHostsSection(expected);
                                if (global.mainWindow && global.mainWindow.webContents) {
                                    global.mainWindow.webContents.send('hosts-integrity-update', {
                                        ok: v.ok,
                                        unexpectedMissing: v.unexpectedMissing,
                                        unexpectedExtra: v.unexpectedExtra,
                                        sectionPresent: v.sectionPresent,
                                        expectedDomainCount: expected.length
                                    });
                                }
                                console.log(`Usage Tracker: Successfully auto-blocked ${siteName}`);
                            } else {
                                console.log(`Usage Tracker: ${siteName} already blocked, no action needed`);
                            }
                        } else {
                            console.log(`Usage Tracker: ${siteName} within limit (${usageInMinutes.toFixed(2)}/${site.limit} min)`);
                        }
                        break; // Only track one site at a time
                    } else {
                        console.log(`Usage Tracker: No match for ${siteName} in "${windowTitle}"`);
                    }
                } catch (error) {
                    console.error(`Usage Tracker: Error processing site ${siteName}:`, error);
                    continue; // Skip this site and continue with others
                }
            }

            if (usageUpdated) {
                console.log('📤 Usage Tracker: Sending usage update to renderer');
                const usageDataToSend = this.dataManager.getTodayUsage();
                console.log('📤 Usage Tracker: Data being sent to renderer:', JSON.stringify(usageDataToSend));
                console.log('📤 Usage Tracker: Data type being sent:', typeof usageDataToSend);
                
                // Notify renderer of usage update
                if (global.mainWindow && global.mainWindow.webContents) {
                    global.mainWindow.webContents.send('usage-updated', usageDataToSend);
                    console.log('📤 Usage Tracker: ✅ Usage data sent to renderer successfully');
                } else {
                    console.log('📤 Usage Tracker: ❌ No mainWindow or webContents available');
                }
            } else {
                console.log('📤 Usage Tracker: No usage updated this cycle');
            }
        } catch (error) {
            console.error('Usage Tracker: Error in checkActiveWindow:', error);
        }
    }

    // Debug method to inspect raw store
    inspectRawStore() {
        console.log('🔍 Usage Tracker: Inspecting raw store...');
        this.dataManager.inspectRawStore();
    }

    // Debug mode methods
    startDebugMode() {
        if (this.debugMode) {
            console.log('Debug mode is already running!');
            return;
        }

        console.log('🔍 Starting window title debug mode...');
        console.log('📁 Log file will be saved to: C:\\Users\\jrkag\\Downloads\\social_blocker_debug_log.txt');
        console.log('⏱️  Debug mode will run for 10 minutes, then auto-stop');
        console.log('🌐 Please visit each website (YouTube, Facebook, Instagram, Twitter, Reddit, LinkedIn) in both Chrome and Edge');
        
        this.debugMode = true;
        this.debugStartTime = new Date();
        
        // Create log file path
        const path = require('path');
        const os = require('os');
        this.debugLogFile = path.join('C:\\Users\\jrkag\\Downloads', 'social_blocker_debug_log.txt');
        
        // Write initial log entry
        this.writeDebugLog('=== SOCIAL BLOCKER DEBUG LOG STARTED ===');
        this.writeDebugLog(`Started at: ${this.debugStartTime.toISOString()}`);
        this.writeDebugLog('Please visit each website to capture window titles');
        this.writeDebugLog('Sites to test: YouTube, Facebook, Instagram, Twitter/X, Reddit, LinkedIn');
        this.writeDebugLog('Test in both Chrome and Edge browsers');
        this.writeDebugLog('==========================================');
        
        // Start debug interval (every 2 seconds for more detailed logging)
        this.debugInterval = setInterval(async () => {
            await this.debugCheckActiveWindow();
        }, 2000);
        
        // Auto-stop after 10 minutes
        setTimeout(() => {
            this.stopDebugMode();
        }, 10 * 60 * 1000);
    }

    stopDebugMode() {
        if (!this.debugMode) {
            console.log('Debug mode is not running!');
            return;
        }

        console.log('🔍 Stopping debug mode...');
        
        this.debugMode = false;
        
        if (this.debugInterval) {
            clearInterval(this.debugInterval);
            this.debugInterval = null;
        }
        
        // Write final log entry
        const endTime = new Date();
        const duration = Math.round((endTime - this.debugStartTime) / 1000 / 60);
        this.writeDebugLog('==========================================');
        this.writeDebugLog(`Debug session ended at: ${endTime.toISOString()}`);
        this.writeDebugLog(`Total duration: ${duration} minutes`);
        this.writeDebugLog('=== SOCIAL BLOCKER DEBUG LOG ENDED ===');
        
        console.log(`📁 Debug log saved to: ${this.debugLogFile}`);
        console.log(`⏱️  Session duration: ${duration} minutes`);
        console.log('✅ Debug mode stopped. Please check the log file and share the contents.');
    }

    async debugCheckActiveWindow() {
        try {
            const windowInfo = await this.activeWin();
            if (!windowInfo) {
                this.writeDebugLog('[NO WINDOW] No active window detected');
                return;
            }

            const windowTitle = windowInfo.title || 'No title';
            const appName = windowInfo.owner?.name || 'Unknown app';
            const timestamp = new Date().toISOString();
            
            const logEntry = `[${timestamp}] "${windowTitle}" (${appName})`;
            this.writeDebugLog(logEntry);
            
        } catch (error) {
            this.writeDebugLog(`[ERROR] ${error.message}`);
        }
    }

    writeDebugLog(message) {
        if (!this.debugLogFile) return;
        
        try {
            const fs = require('fs');
            const logEntry = `${message}\n`;
            
            // Append to file
            fs.appendFileSync(this.debugLogFile, logEntry);
        } catch (error) {
            console.error('Error writing debug log:', error);
        }
    }
}

module.exports = UsageTracker;
