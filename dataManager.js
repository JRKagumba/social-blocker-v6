// dataManager.js - Handles all data storage and retrieval operations

const Store = require('electron-store');

class DataManager {
    constructor() {
        this.store = new Store();
        this.initializeDataStore();
    }

    // Centralized defaults so v6 can safely evolve without breaking existing users.
    // NOTE: matchPatterns are stored as **strings** (compiled to RegExp at runtime).
    getDefaultSiteSettings() {
        return {
            'YouTube': {
                name: 'YouTube',
                domains: ['youtube.com', 'www.youtube.com', 'm.youtube.com'],
                keywords: ['youtube', 'youtube.com'],
                matchPatterns: [
                    // Examples seen in window titles: "YouTube", "youtube.com", "YouTube - Google Chrome"
                    '\\byoutube\\b',
                    '\\byoutube\\.com\\b'
                ],
                limit: 60
            },
            'Facebook': {
                name: 'Facebook',
                domains: ['facebook.com', 'www.facebook.com', 'm.facebook.com'],
                keywords: ['facebook', 'facebook.com'],
                matchPatterns: ['\\bfacebook\\b', '\\bfacebook\\.com\\b'],
                limit: 60
            },
            'Instagram': {
                name: 'Instagram',
                domains: ['instagram.com', 'www.instagram.com'],
                keywords: ['instagram', 'instagram.com'],
                matchPatterns: ['\\binstagram\\b', '\\binstagram\\.com\\b'],
                limit: 60
            },
            'Twitter/X': {
                name: 'Twitter/X',
                domains: [
                    'twitter.com',
                    'www.twitter.com',
                    'mobile.twitter.com',
                    'x.com',
                    'www.x.com'
                ],
                // IMPORTANT: Do NOT include a bare "x" keyword. It will match almost anything.
                // Also do NOT include "x.com" as a keyword — the keyword fallback uses
                // substring matching, which would re-introduce the "netflix.com" false positive.
                keywords: ['twitter', 'twitter.com'],
                // Patterns must distinguish *being on X* from *discussing X elsewhere*.
                // Anchor on title structures that only X.com produces, never a bare
                // `\bx\.com\b` (matches "How to delete your x.com account" on Reddit).
                matchPatterns: [
                    // Old brand
                    '\\btwitter\\b',
                    '\\btwitter\\.com\\b',
                    // Modern X.com title formats: "Home / X", "Notifications / X", "(3) Home / X"
                    '\\s/\\sx\\s',
                    '\\s-\\sx\\s',
                    '\\s/\\sx$',
                    // Tweet author titles: 'Joe Kagumba on X: "..."'  / 'Foo on X / X'
                    '\\bon\\sx[:\\s]'
                ],
                limit: 60
            },
            'Reddit': {
                name: 'Reddit',
                // Subdomains matter for hosts-file blocking.
                domains: ['reddit.com', 'www.reddit.com', 'old.reddit.com', 'new.reddit.com', 'np.reddit.com', 'redd.it'],
                keywords: ['reddit', 'reddit.com', 'redd.it'],
                // r/<subreddit> pattern catches modern Reddit titles like
                // "AMA with Linus Torvalds : r/programming" — the dominant title format now.
                matchPatterns: ['\\breddit\\b', '\\breddit\\.com\\b', '\\bredd\\.it\\b', '\\br/[A-Za-z0-9_]+\\b'],
                limit: 60
            },
            'LinkedIn': {
                name: 'LinkedIn',
                domains: ['linkedin.com', 'www.linkedin.com'],
                keywords: ['linkedin', 'linkedin.com'],
                matchPatterns: ['\\blinkedin\\b', '\\blinkedin\\.com\\b'],
                limit: 60
            },
            'Messenger': {
                name: 'Messenger',
                domains: ['messenger.com', 'www.messenger.com'],
                keywords: ['messenger', 'messenger.com'],
                matchPatterns: ['\\bmessenger\\b', '\\bmessenger\\.com\\b'],
                limit: 60
            }
        };
    }

    sanitizeKeywords(siteName, keywords) {
        if (!Array.isArray(keywords)) return [];

        const cleaned = keywords
            .map(k => (typeof k === 'string' ? k.trim().toLowerCase() : ''))
            .filter(Boolean)
            // Global safety: remove 1–2 char tokens unless it's clearly a domain-like token.
            .filter(k => k.length > 2 || k.includes('.'));

        // Extra safety for the one special case that caused huge false positives.
        if (siteName === 'Twitter/X') {
            return cleaned.filter(k => k !== 'x');
        }

        return cleaned;
    }

    // Helper function to get the current local date in YYYY-MM-DD format
    getLocalISODate(date = new Date()) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    initializeDataStore() {
        // Initialize site settings if they don't exist (for brand new users)
        if (!this.store.has('siteSettings')) {
            const siteSettings = this.getDefaultSiteSettings();
            this.store.set('siteSettings', siteSettings);
            const allDomains = Object.values(siteSettings).flatMap(s => s.domains);
            this.store.set('blockedDomains', allDomains);
            console.log('DataManager: Created new site settings');
        } else {
            // --- DATA MIGRATION LOGIC ---
            // This block updates settings for existing users who may be missing newer fields
            // or newer sites (ex: Messenger).
            const siteSettings = this.store.get('siteSettings');
            let needsUpdate = false;

            const defaults = this.getDefaultSiteSettings();

            // 1) Add any new sites that didn't exist previously.
            for (const defaultSiteName of Object.keys(defaults)) {
                if (!siteSettings[defaultSiteName]) {
                    console.log(`DataManager: Migrating data - adding new site "${defaultSiteName}".`);
                    siteSettings[defaultSiteName] = defaults[defaultSiteName];
                    // IMPORTANT: Do NOT auto-add newly introduced sites to blockedDomains.
                    // This avoids surprise blocks for existing users.
                    needsUpdate = true;
                }
            }

            // 2) Ensure all sites have required fields and apply safe upgrades.
            for (const siteName in siteSettings) {
                const site = siteSettings[siteName];
                const defaultSite = defaults[siteName];

                // domains
                if (!Array.isArray(site.domains) || site.domains.length === 0) {
                    if (defaultSite?.domains) {
                        site.domains = defaultSite.domains;
                        needsUpdate = true;
                    }
                } else if (defaultSite?.domains) {
                    // merge in any newly added domains (non-breaking)
                    const merged = Array.from(new Set([...site.domains, ...defaultSite.domains]));
                    if (merged.length !== site.domains.length) {
                        site.domains = merged;
                        needsUpdate = true;
                    }
                }

                // keywords (legacy fallback) + sanitization
                if (!site.hasOwnProperty('keywords') || !site.keywords) {
                    site.keywords = defaultSite?.keywords || [siteName.toLowerCase()];
                    needsUpdate = true;
                }
                const sanitized = this.sanitizeKeywords(siteName, site.keywords);
                if (JSON.stringify(sanitized) !== JSON.stringify(site.keywords)) {
                    console.log(`DataManager: Sanitized keywords for ${siteName}:`, site.keywords, '->', sanitized);
                    site.keywords = sanitized;
                    needsUpdate = true;
                }

                // matchPatterns (preferred matching mechanism)
                if (!Array.isArray(site.matchPatterns) || site.matchPatterns.length === 0) {
                    if (defaultSite?.matchPatterns) {
                        site.matchPatterns = defaultSite.matchPatterns;
                        needsUpdate = true;
                    }
                }

                // Ensure Twitter/X doesn't contain an "x" keyword from older experiments.
                if (siteName === 'Twitter/X') {
                    const mustHave = ['twitter', 'twitter.com', 'x.com'];
                    const merged = Array.from(new Set([...(site.keywords || []), ...mustHave]));
                    const sanitizedMerged = this.sanitizeKeywords(siteName, merged);
                    if (JSON.stringify(sanitizedMerged) !== JSON.stringify(site.keywords)) {
                        site.keywords = sanitizedMerged;
                        needsUpdate = true;
                    }
                    if (defaultSite?.matchPatterns && JSON.stringify(site.matchPatterns) !== JSON.stringify(defaultSite.matchPatterns)) {
                        // overwrite with safer patterns
                        site.matchPatterns = defaultSite.matchPatterns;
                        needsUpdate = true;
                    }
                }

                // Reddit: add subdomains for hosts-file blocking + include redd.it.
                if (siteName === 'Reddit' && defaultSite?.domains) {
                    const mergedDomains = Array.from(new Set([...(site.domains || []), ...defaultSite.domains]));
                    if (mergedDomains.length !== (site.domains || []).length) {
                        site.domains = mergedDomains;
                        needsUpdate = true;
                    }
                }

                siteSettings[siteName] = site;
            }

            // If we made any changes, save the updated object back to the store.
            if (needsUpdate) {
                console.log('DataManager: Migration complete. Saving updated site settings...');
                this.store.set('siteSettings', siteSettings);
            } else {
                console.log('DataManager: All site settings are up to date');
            }
        }

        // Clean up corrupted usage data
        this.cleanupCorruptedUsageData();

        // Initialize today's usage data
        const today = this.getLocalISODate();
        if (!this.store.has(`usage.${today}`)) {
            this.store.set(`usage.${today}`, {});
        }

        // When true (default): unblocked sites are automatically re-blocked at the local calendar rollover.
        if (!this.store.has('autoReblockUnblockedSitesOnNewDay')) {
            this.store.set('autoReblockUnblockedSitesOnNewDay', true);
        }

        // Last calendar day we've applied "new day" policy (baseline for midnight detection).
        if (!this.store.has('calendarRollBaselineDay')) {
            this.store.set('calendarRollBaselineDay', today);
        }

        if (!this.store.has('hostsTamperEvents')) {
            this.store.set('hostsTamperEvents', []);
        }

        // Local-HTML digest settings. Default target is the user's Google Drive root
        // — created lazily on first generate. Schedule is opportunistic, not exact:
        // weekly runs the first time the app sees a Monday >= 09:00 with no prior run that week;
        // monthly runs the first time it sees day-of-month 1 >= 09:00 with no prior run that month.
        if (!this.store.has('reportSettings')) {
            this.store.set('reportSettings', {
                targetFolder: 'G:\\My Drive\\Social Blocker\\reports',
                weeklyEnabled: true,
                monthlyEnabled: true,
                autoOpenOnGenerate: true,
                lastWeeklyGeneratedAt: null,
                lastMonthlyGeneratedAt: null
            });
        }

        // HUD widget settings. visible=false default — opt-in via tray menu (per Recommendation #2).
        // autoHideFullscreen=true to disappear during video/games. clickThrough=false so
        // double-click opens the dashboard.
        if (!this.store.has('hudConfig')) {
            this.store.set('hudConfig', {
                visible: false,
                autoHideFullscreen: true,
                clickThrough: false
            });
        }

        // Deep Work editor configuration. selectedSites references siteSettings keys
        // (Instagram, Facebook, etc.) plus the special name 'Messenger' which resolves
        // to a hardcoded domain set via getDeepWorkSpecialSites(). customDomains is a
        // free-form list users add via chip input in the dashboard.
        if (!this.store.has('deepWorkConfig')) {
            this.store.set('deepWorkConfig', {
                selectedSites: ['Instagram', 'Facebook', 'Twitter/X', 'Reddit', 'YouTube', 'Messenger'],
                customDomains: []
            });
        }

        // Mirrors which sites should be blocking all their domains according to last successful hosts apply / policy.
        if (!this.store.has('appliedBlockedBySite')) {
            this.syncAppliedBlockedFromDomains(this.getBlockedDomains());
        }

        // Manual "Lock Today" per-site discipline control (strict: no unlock until tomorrow)
        if (!this.store.has('manualLocks')) {
            this.store.set('manualLocks', {});
        }
        this.cleanupExpiredManualLocks();
    }

    // Clean up corrupted usage data
    cleanupCorruptedUsageData() {
        console.log('DataManager: Checking for corrupted usage data...');
        let hasCorruptedData = false;
        
        // Get all usage data keys
        const allKeys = this.store.store;
        const usageKeys = Object.keys(allKeys).filter(key => key.startsWith('usage.'));
        
        for (const key of usageKeys) {
            const value = this.store.get(key);
            
            // Check if the value is a string (corrupted) instead of a number
            if (typeof value === 'string') {
                console.log(`DataManager: Found corrupted usage data at ${key}: "${value}" (string) - converting to number`);
                const numericValue = parseFloat(value);
                
                // If it's a valid number, convert it; otherwise set to 0
                if (!isNaN(numericValue) && isFinite(numericValue)) {
                    this.store.set(key, numericValue);
                    hasCorruptedData = true;
                } else {
                    console.log(`DataManager: Invalid numeric value "${value}" at ${key} - setting to 0`);
                    this.store.set(key, 0);
                    hasCorruptedData = true;
                }
            }
            // Check if the value is NaN or Infinity
            else if (typeof value === 'number' && (isNaN(value) || !isFinite(value))) {
                console.log(`DataManager: Found NaN/Infinity usage data at ${key}: ${value} - setting to 0`);
                this.store.set(key, 0);
                hasCorruptedData = true;
            }
        }
        
        if (hasCorruptedData) {
            console.log('DataManager: Cleaned up corrupted usage data');
        } else {
            console.log('DataManager: No corrupted usage data found');
        }
    }

    // Manual cleanup method for users who want to force a clean start
    forceCleanUsageData() {
        console.log('DataManager: Force cleaning all usage data...');
        
        // Get all usage data keys and delete them
        const allKeys = this.store.store;
        const usageKeys = Object.keys(allKeys).filter(key => key.startsWith('usage.'));
        
        for (const key of usageKeys) {
            this.store.delete(key);
        }
        
        // Initialize today's usage data
        const today = this.getLocalISODate();
        this.store.set(`usage.${today}`, {});
        
        console.log('DataManager: All usage data has been cleared and reset');
        return { success: true, message: 'Usage data has been cleared and reset' };
    }

    // Debug method to inspect raw store contents
    inspectRawStore() {
        console.log(`🗂️  RAW STORE INSPECTION:`);
        console.log(`   Store type: ${typeof this.store.store}`);
        console.log(`   Store keys:`, Object.keys(this.store.store));
        console.log(`   Full store contents:`, JSON.stringify(this.store.store, null, 2));
        
        // Focus on usage-related keys
        const usageKeys = Object.keys(this.store.store).filter(key => key.startsWith('usage.'));
        console.log(`   Usage-related keys:`, usageKeys);
        usageKeys.forEach(key => {
            const value = this.store.store[key];
            console.log(`   ${key}: ${JSON.stringify(value)} (type: ${typeof value})`);
        });
    }

    // Site Settings
    getSiteSettings() {
        return this.store.get('siteSettings', {});
    }

    setSiteLimit(siteName, limit) {
        this.store.set(`siteSettings.${siteName}.limit`, limit);
        return { success: true };
    }

    // Blocked Domains
    getBlockedDomains() {
        return this.store.get('blockedDomains', []);
    }

    setBlockedDomains(domains) {
        this.store.set('blockedDomains', domains);
        // Keep appliedBlockedBySite in sync with the canonical domain list so the
        // calendar-roll logic and renderer never see contradictory state.
        this.syncAppliedBlockedFromDomains(domains);
    }

    // Usage Data
    getTodayUsage() {
        const today = this.getLocalISODate();
        const usageData = this.store.get(`usage.${today}`, {});
        console.log(`🔍 DataManager.getTodayUsage():`);
        console.log(`   Date: ${today}`);
        console.log(`   Raw data:`, JSON.stringify(usageData));
        console.log(`   Data type: ${typeof usageData}`);
        console.log(`   Keys:`, Object.keys(usageData));
        Object.keys(usageData).forEach(site => {
            console.log(`   ${site}: ${usageData[site]} (type: ${typeof usageData[site]})`);
        });
        return usageData;
    }

    setTodayUsage(usageData) {
        const today = this.getLocalISODate();
        console.log(`💾 DataManager.setTodayUsage():`);
        console.log(`   Date: ${today}`);
        console.log(`   Setting data:`, JSON.stringify(usageData));
        console.log(`   Data type: ${typeof usageData}`);
        Object.keys(usageData).forEach(site => {
            console.log(`   ${site}: ${usageData[site]} (type: ${typeof usageData[site]})`);
        });
        this.store.set(`usage.${today}`, usageData);
        console.log(`   ✅ Data saved to store`);
    }

    updateSiteUsage(siteName, additionalSeconds) {
        const today = this.getLocalISODate();
        console.log(`🔄 DataManager.updateSiteUsage():`);
        console.log(`   Site: ${siteName}`);
        console.log(`   Additional seconds: ${additionalSeconds} (type: ${typeof additionalSeconds})`);
        
        const currentUsage = this.getTodayUsage();
        console.log(`   Current usage object:`, JSON.stringify(currentUsage));
        
        // Ensure we always work with numbers to prevent string concatenation
        const currentValue = currentUsage[siteName];
        console.log(`   Current value for ${siteName}: ${currentValue} (type: ${typeof currentValue})`);
        
        const numericValue = typeof currentValue === 'number' ? currentValue : (parseFloat(currentValue) || 0);
        console.log(`   Converted to numeric: ${numericValue} (type: ${typeof numericValue})`);
        
        const newValue = numericValue + additionalSeconds;
        console.log(`   New value: ${numericValue} + ${additionalSeconds} = ${newValue} (type: ${typeof newValue})`);
        
        currentUsage[siteName] = newValue;
        console.log(`   Updated usage object:`, JSON.stringify(currentUsage));
        
        this.setTodayUsage(currentUsage);

        // Also update hourly data for heat map
        const now = new Date();
        const hour = now.getHours();
        const hourlyKey = `hourlyUsage.${today}.${siteName}.${hour}`;
        const currentHourlyUsage = this.store.get(hourlyKey, 0);
        console.log(`   Hourly key: ${hourlyKey}`);
        console.log(`   Current hourly usage: ${currentHourlyUsage} (type: ${typeof currentHourlyUsage})`);
        
        // Ensure hourly usage is also numeric
        const numericHourlyUsage = typeof currentHourlyUsage === 'number' ? currentHourlyUsage : (parseFloat(currentHourlyUsage) || 0);
        const newHourlyUsage = numericHourlyUsage + additionalSeconds;
        console.log(`   New hourly usage: ${numericHourlyUsage} + ${additionalSeconds} = ${newHourlyUsage}`);
        
        this.store.set(hourlyKey, newHourlyUsage);
        console.log(`   ✅ Hourly data saved`);

        return currentUsage;
    }

    // Deep Work
    getDeepWork() {
        return this.store.get('deepWork', null);
    }

    setDeepWork(deepWorkData) {
        this.store.set('deepWork', deepWorkData);
    }

    deleteDeepWork() {
        this.store.delete('deepWork');
    }

    // History
    getBlockerHistory() {
        return this.store.get('blockerHistory', []);
    }

    addBlockerEvent(isEnabled) {
        const history = this.getBlockerHistory();
        history.push({ timestamp: new Date().toISOString(), isEnabled });
        this.store.set('blockerHistory', history);
        return { success: true };
    }

    getHistoryData() {
        const history = this.getBlockerHistory();
        const last7Days = {};
        // --- CHANGE HERE: Include the current day in the loop ---
        for (let i = 6; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            const day = this.getLocalISODate(d);
            last7Days[day] = 0;
        }
        history.forEach(event => {
            const day = event.timestamp.split('T')[0];
            if (last7Days[day] !== undefined && event.isEnabled) {
                last7Days[day]++;
            }
        });
        return {
            labels: Object.keys(last7Days), // Pass raw ISO dates to renderer
            data: Object.values(last7Days)
        };
    }

    // Unblock History
    getUnblockHistory() {
        return this.store.get('unblockHistory', []);
    }

    addUnblockEvent(siteName) {
        const history = this.getUnblockHistory();
        history.push({ timestamp: new Date().toISOString(), siteName });
        this.store.set('unblockHistory', history);
        console.log(`DataManager: Logged unblock event for ${siteName}`);
        return { success: true };
    }

    getTodayUnblocks() {
        const today = this.getLocalISODate();
        const history = this.getUnblockHistory();
        const todayUnblocks = {};
        
        // Initialize all sites with 0
        const allSiteSettings = this.getSiteSettings();
        for (const siteName in allSiteSettings) {
            todayUnblocks[siteName] = 0;
        }
        
        // Count unblocks for today
        history.forEach(event => {
            const eventDate = event.timestamp.split('T')[0];
            if (eventDate === today && todayUnblocks.hasOwnProperty(event.siteName)) {
                todayUnblocks[event.siteName]++;
            }
        });
        
        return todayUnblocks;
    }

    // Heat Map Data
    getHeatMapData(days = 7) {
        const heatMapData = [];
        const today = new Date();
        
        for (let i = days - 1; i >= 0; i--) {
            const date = new Date(today);
            date.setDate(date.getDate() - i);
            const dateStr = this.getLocalISODate(date);
            
            const dayData = { date: dateStr, hours: [] };
            
            for (let hour = 0; hour < 24; hour++) {
                let totalMinutes = 0;
                const allSiteSettings = this.getSiteSettings();
                
                for (const siteName in allSiteSettings) {
                    const hourlyKey = `hourlyUsage.${dateStr}.${siteName}.${hour}`;
                    const hourlyUsage = this.store.get(hourlyKey, 0);
                    totalMinutes += hourlyUsage / 60; // Convert seconds to minutes
                }
                
                dayData.hours.push(totalMinutes);
            }
            
            heatMapData.push(dayData);
        }
        
        return heatMapData;
    }

    // Adherence Data
    getAdherenceData(days = 7) {
        const adherenceData = [];
        const today = new Date();
        const allSiteSettings = this.getSiteSettings();
        
        for (let i = days - 1; i >= 0; i--) {
            const date = new Date(today);
            date.setDate(date.getDate() - i);
            const dateStr = this.getLocalISODate(date);
            
            let totalSites = 0;
            let withinLimit = 0;
            
            for (const siteName in allSiteSettings) {
                const site = allSiteSettings[siteName];
                if (site.limit > 0) {
                    totalSites++;
                    const dailyUsage = this.store.get(`usage.${dateStr}.${siteName}`, 0);
                    const usageInMinutes = dailyUsage / 60;
                    
                    if (usageInMinutes <= site.limit) {
                        withinLimit++;
                    }
                }
            }
            
            const adherenceRate = totalSites > 0 ? Math.round((withinLimit / totalSites) * 100) : 100;
            adherenceData.push({
                date: dateStr,
                adherenceRate,
                totalSites,
                withinLimit
            });
        }
        
        return adherenceData;
    }

    
    // Manual Locks (Lock Today) - strict: once locked, UI won't allow unlocking until tomorrow.
    cleanupExpiredManualLocks() {
        const today = this.getLocalISODate();
        const locks = this.store.get('manualLocks', {});
        let changed = false;

        for (const [siteName, lockDate] of Object.entries(locks)) {
            if (lockDate !== today) {
                delete locks[siteName];
                changed = true;
            }
        }

        if (changed) {
            this.store.set('manualLocks', locks);
        }

        return locks;
    }

    getManualLocks() {
        // Ensure we don't keep stale locks around across days
        return this.cleanupExpiredManualLocks();
    }

    isSiteLockedToday(siteName) {
        const today = this.getLocalISODate();
        const locks = this.store.get('manualLocks', {});
        return locks[siteName] === today;
    }

    lockSiteForToday(siteName) {
        const today = this.getLocalISODate();
        const locks = this.store.get('manualLocks', {});
        locks[siteName] = today;
        this.store.set('manualLocks', locks);
        return { success: true, siteName, lockedForDate: today };
    }

    // Initial Data for Renderer
    getInitialData(hostsIntegrityOverlay = {}) {
        return {
            success: true,
            today: this.getLocalISODate(),
            siteSettings: this.getSiteSettings(),
            blockedDomains: this.getBlockedDomains(),
            usageData: this.getTodayUsage(),
            deepWork: this.normalizeDeepWork(this.getDeepWork()),
            rawDeepWork: this.getDeepWork(),
            manualLocks: this.getManualLocks(),
            autoReblockUnblockedSitesOnNewDay: this.store.get('autoReblockUnblockedSitesOnNewDay', true),
            reportSettings: this.getReportSettings(),
            deepWorkConfig: this.getDeepWorkConfig(),
            deepWorkSpecialSites: this.getDeepWorkSpecialSites(),
            deepWorkSchedule: this.getDeepWorkSchedule(),
            ...hostsIntegrityOverlay
        };
    }

    // ---------------- HUD widget configuration ----------------
    getHudConfig() {
        const defaults = { visible: false, autoHideFullscreen: true, clickThrough: false };
        const stored = this.store.get('hudConfig', defaults) || {};
        return { ...defaults, ...stored };
    }

    setHudConfig(partial) {
        const next = { ...this.getHudConfig(), ...(partial || {}) };
        this.store.set('hudConfig', next);
        return next;
    }

    // ---------------- Deep Work editor configuration ----------------

    /**
     * Pseudo-sites available in the Deep Work editor that are NOT in the normal
     * tracker site list (because they're not browser-based or not configurable).
     * Add new entries here to make them selectable in the editor.
     */
    getDeepWorkSpecialSites() {
        return {
            Messenger: {
                domains: ['web.whatsapp.com', 'messenger.com', 'www.messenger.com']
            }
        };
    }

    getDeepWorkConfig() {
        const defaults = {
            selectedSites: ['Instagram', 'Facebook', 'Twitter/X', 'Reddit', 'YouTube', 'Messenger'],
            customDomains: []
        };
        const stored = this.store.get('deepWorkConfig', defaults) || {};
        return {
            ...defaults,
            ...stored,
            selectedSites: Array.isArray(stored.selectedSites) ? stored.selectedSites : defaults.selectedSites,
            customDomains: Array.isArray(stored.customDomains) ? stored.customDomains : []
        };
    }

    setDeepWorkConfig(partial) {
        const next = { ...this.getDeepWorkConfig(), ...(partial || {}) };
        // Normalize custom domains (lowercase, trim, strip protocol/path, dedupe).
        if (Array.isArray(next.customDomains)) {
            const cleaned = next.customDomains
                .map(d => String(d || '').trim().toLowerCase())
                .map(d => d.replace(/^https?:\/\//, '').replace(/\/.*$/, ''))
                .filter(d => d && /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d));
            next.customDomains = Array.from(new Set(cleaned));
        }
        if (Array.isArray(next.selectedSites)) {
            next.selectedSites = Array.from(new Set(next.selectedSites.filter(Boolean)));
        }
        this.store.set('deepWorkConfig', next);
        return next;
    }

    /**
     * Compute the full set of domains to block when a Deep Work session is active.
     * Combines: selected real-site domains (from siteSettings) + selected special sites
     * (Messenger etc.) + user-added customDomains. Always lowercase, always deduped.
     */
    computeDeepWorkDomains() {
        const config = this.getDeepWorkConfig();
        const siteSettings = this.getSiteSettings();
        const specials = this.getDeepWorkSpecialSites();
        const out = new Set();
        for (const name of config.selectedSites) {
            if (specials[name] && Array.isArray(specials[name].domains)) {
                specials[name].domains.forEach(d => out.add(String(d).toLowerCase()));
            } else if (siteSettings[name] && Array.isArray(siteSettings[name].domains)) {
                siteSettings[name].domains.forEach(d => out.add(String(d).toLowerCase()));
            }
        }
        for (const d of config.customDomains) {
            const v = String(d || '').trim().toLowerCase();
            if (v) out.add(v);
        }
        return Array.from(out);
    }

    // ---------------- Report (digest) settings ----------------
    getReportSettings() {
        const defaults = {
            targetFolder: 'G:\\My Drive\\Social Blocker\\reports',
            weeklyEnabled: true,
            monthlyEnabled: true,
            autoOpenOnGenerate: true,
            lastWeeklyGeneratedAt: null,
            lastMonthlyGeneratedAt: null
        };
        const stored = this.store.get('reportSettings', defaults) || {};
        return { ...defaults, ...stored };
    }

    setReportSettings(partial) {
        const next = { ...this.getReportSettings(), ...(partial || {}) };
        this.store.set('reportSettings', next);
        return next;
    }

    // ---------------- Deep Work auto-schedule ----------------
    //
    // Rules persist in `store.deepWorkSchedule`. Each rule is:
    //   { id, enabled, name, days[0..6 Sun..Sat], startTime "HH:MM",
    //     durationMinutes, lastFiredOn "YYYY-MM-DD" | null }
    //
    // Why we store `lastFiredOn` per rule instead of inferring from current
    // session state: a rule may legitimately want to fire even if a manual
    // session ended earlier today. The `lastFiredOn` guard prevents the
    // 30-second evaluator from firing the same rule twice if it stays in the
    // 5-minute grace window across multiple ticks.

    getDeepWorkSchedule() {
        const raw = this.store.get('deepWorkSchedule', []);
        if (!Array.isArray(raw)) return [];
        // Defensive normalization for older / partial data.
        return raw
            .filter(r => r && typeof r === 'object' && r.id)
            .map(r => ({
                id: String(r.id),
                enabled: !!r.enabled,
                name: String(r.name || 'Untitled'),
                days: Array.isArray(r.days)
                    ? Array.from(new Set(r.days.map(d => Number(d)).filter(d => Number.isInteger(d) && d >= 0 && d <= 6))).sort()
                    : [],
                startTime: this._normalizeHHMM(r.startTime),
                durationMinutes: this._clampDuration(r.durationMinutes),
                lastFiredOn: typeof r.lastFiredOn === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.lastFiredOn)
                    ? r.lastFiredOn
                    : null
            }));
    }

    _normalizeHHMM(s) {
        if (typeof s !== 'string') return '09:00';
        const m = s.match(/^(\d{1,2}):(\d{1,2})$/);
        if (!m) return '09:00';
        const h = parseInt(m[1], 10);
        const mm = parseInt(m[2], 10);
        // Reject (not clamp) out-of-range values. A corrupted "99:99" should
        // fall back to a known-safe default, not silently fire at 23:59.
        if (h < 0 || h > 23 || mm < 0 || mm > 59) return '09:00';
        return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    }

    _clampDuration(n) {
        const v = parseInt(n, 10);
        if (!Number.isFinite(v) || v < 1) return 60;
        if (v > 480) return 480; // cap matches the manual UI cap (8h)
        return v;
    }

    setDeepWorkSchedule(rules) {
        const list = Array.isArray(rules) ? rules : [];
        const normalized = list
            .filter(r => r && typeof r === 'object')
            .map(r => ({
                id: r.id ? String(r.id) : this._genId(),
                enabled: !!r.enabled,
                name: String(r.name || 'Untitled').slice(0, 60),
                days: Array.isArray(r.days)
                    ? Array.from(new Set(r.days.map(d => Number(d)).filter(d => Number.isInteger(d) && d >= 0 && d <= 6))).sort()
                    : [],
                startTime: this._normalizeHHMM(r.startTime),
                durationMinutes: this._clampDuration(r.durationMinutes),
                lastFiredOn: typeof r.lastFiredOn === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.lastFiredOn)
                    ? r.lastFiredOn
                    : null
            }));
        this.store.set('deepWorkSchedule', normalized);
        return normalized;
    }

    _genId() {
        try {
            const { randomUUID } = require('crypto');
            return randomUUID();
        } catch (_) {
            return 'r_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
        }
    }

    addScheduleRule(partial) {
        const rules = this.getDeepWorkSchedule();
        const rule = {
            id: this._genId(),
            enabled: partial?.enabled !== false,
            name: partial?.name || 'Untitled',
            days: partial?.days || [],
            startTime: partial?.startTime || '09:00',
            durationMinutes: partial?.durationMinutes || 60,
            lastFiredOn: null
        };
        rules.push(rule);
        return this.setDeepWorkSchedule(rules);
    }

    updateScheduleRule(id, partial) {
        const rules = this.getDeepWorkSchedule();
        const idx = rules.findIndex(r => r.id === id);
        if (idx === -1) return rules;
        rules[idx] = { ...rules[idx], ...(partial || {}), id }; // id pinned
        return this.setDeepWorkSchedule(rules);
    }

    deleteScheduleRule(id) {
        const rules = this.getDeepWorkSchedule().filter(r => r.id !== id);
        return this.setDeepWorkSchedule(rules);
    }

    /**
     * Mark a rule as having fired today so the 30s evaluator doesn't re-fire
     * inside the grace window.
     */
    markScheduleRuleFired(id, isoDate) {
        return this.updateScheduleRule(id, { lastFiredOn: isoDate });
    }

    /**
     * Decide whether `rule` should fire RIGHT NOW. Pure function (no I/O), so
     * it's trivially unit-testable.
     *   - `now` is a Date (caller supplies, for testability)
     *   - `graceMinutes` is the late-fire allowance (default 5)
     * Returns true iff: enabled, today's weekday is in rule.days,
     * now-clock has advanced past startTime, the gap is <= grace,
     * and lastFiredOn != today.
     */
    static shouldFireRuleNow(rule, now = new Date(), graceMinutes = 5) {
        if (!rule || !rule.enabled) return false;
        if (!Array.isArray(rule.days) || !rule.days.includes(now.getDay())) return false;
        const m = (rule.startTime || '').match(/^(\d{2}):(\d{2})$/);
        if (!m) return false;
        const schedHour = parseInt(m[1], 10);
        const schedMin = parseInt(m[2], 10);

        const nowMins = now.getHours() * 60 + now.getMinutes();
        const schedMins = schedHour * 60 + schedMin;
        if (nowMins < schedMins) return false;
        if (nowMins - schedMins > graceMinutes) return false;

        const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        if (rule.lastFiredOn === today) return false;

        return true;
    }

    /**
     * Compute the next fire moment across ALL enabled rules, or null if none
     * would ever fire. Returns { ruleId, ruleName, fireAt: Date }.
     * Looks ahead up to 7 days.
     */
    static computeNextFireTime(rules, now = new Date()) {
        if (!Array.isArray(rules)) return null;
        let best = null;
        for (const rule of rules) {
            if (!rule || !rule.enabled || !Array.isArray(rule.days) || rule.days.length === 0) continue;
            const m = (rule.startTime || '').match(/^(\d{2}):(\d{2})$/);
            if (!m) continue;
            const schedHour = parseInt(m[1], 10);
            const schedMin  = parseInt(m[2], 10);

            // Walk forward day-by-day up to 7 days to find the next match.
            for (let offset = 0; offset < 8; offset++) {
                const candidate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset, schedHour, schedMin, 0, 0);
                if (candidate <= now) continue;
                if (!rule.days.includes(candidate.getDay())) continue;
                if (!best || candidate < best.fireAt) {
                    best = { ruleId: rule.id, ruleName: rule.name, fireAt: candidate };
                }
                break; // first hit for this rule is the nearest
            }
        }
        return best;
    }

    // ---------------- Deep Work helpers (normalization) ----------------
    /**
     * Normalize raw stored deepWork data into a renderer-friendly shape, or null when
     * no active session. Treats `endTime` in the past as "no session". Used by both
     * main.js (policy decisions) and the IPC `get-initial-data` response so the renderer
     * never has to do the math.
     */
    normalizeDeepWork(raw) {
        if (!raw || typeof raw !== 'object') return null;
        if (!raw.endTime) return null;
        const end = new Date(raw.endTime).getTime();
        if (!Number.isFinite(end)) return null;
        const remainingMs = end - Date.now();
        if (remainingMs <= 0) return null;
        return { isActive: true, endTime: raw.endTime, remainingMs };
    }

    // ---------------- Calendar rollover ----------------
    /**
     * Re-apply "new day" policy if the local calendar day has advanced since the last
     * baseline. Triggers:
     *  - manual-lock cleanup (always)
     *  - re-block of any sites that the user temporarily unblocked yesterday (when
     *    `autoReblockUnblockedSitesOnNewDay` is true)
     * Returns a summary object so main.js can decide whether to re-apply hosts.
     */
    advanceCalendarRollIfNeeded() {
        const today = this.getLocalISODate();
        const baseline = this.store.get('calendarRollBaselineDay', today);
        if (baseline === today) {
            return { rolled: false, prefsChanged: false, domainsChanged: false };
        }

        this.cleanupExpiredManualLocks();

        const autoReblock = !!this.store.get('autoReblockUnblockedSitesOnNewDay', true);
        let prefsChanged = false;
        let domainsChanged = false;

        if (autoReblock) {
            const siteSettings = this.getSiteSettings();
            const newPrefs = {};
            for (const name of Object.keys(siteSettings)) {
                newPrefs[name] = true;
            }
            const oldPrefs = this.store.get('appliedBlockedBySite', {}) || {};
            const prefsKeysEqual =
                Object.keys(oldPrefs).length === Object.keys(newPrefs).length &&
                Object.keys(newPrefs).every(k => oldPrefs[k] === newPrefs[k]);
            if (!prefsKeysEqual) {
                this.store.set('appliedBlockedBySite', newPrefs);
                prefsChanged = true;
            }

            const newDomains = this.buildBlockedDomainsFromSitePreferenceMap(newPrefs, siteSettings);
            const oldDomains = this.getBlockedDomains();
            const setsEqual =
                newDomains.length === oldDomains.length &&
                newDomains.every(d => oldDomains.includes(d));
            if (!setsEqual) {
                this.setBlockedDomains(newDomains);
                domainsChanged = true;
            }
        }

        this.store.set('calendarRollBaselineDay', today);
        return { rolled: true, prefsChanged, domainsChanged };
    }

    // ---------------- Hosts tamper log ----------------
    /**
     * Appends a tamper event to the rolling log. Cap at 100 events so the store
     * never balloons. Stored chronologically, oldest-first.
     */
    appendHostsTamperEvent(entry) {
        const events = this.store.get('hostsTamperEvents', []) || [];
        const stamped = { at: new Date().toISOString(), ...(entry || {}) };
        events.push(stamped);
        // Trim from the front so the most recent events are kept.
        const MAX_EVENTS = 100;
        const trimmed = events.length > MAX_EVENTS ? events.slice(events.length - MAX_EVENTS) : events;
        this.store.set('hostsTamperEvents', trimmed);
        return stamped;
    }

    // ---------------- Applied-block site-preference helpers ----------------
    /**
     * Pure: from a list of blocked domains, infer which sites are "fully blocked"
     * (i.e. all of that site's domains are present). Used to derive `appliedBlockedBySite`
     * after external/legacy state, or for sanity checks.
     */
    inferAppliedBlockedBySite(domains) {
        const settings = this.getSiteSettings();
        const lower = new Set((domains || []).map(d => String(d).toLowerCase()));
        const out = {};
        for (const [name, site] of Object.entries(settings)) {
            if (!site.domains || site.domains.length === 0) {
                out[name] = false;
                continue;
            }
            out[name] = site.domains.every(d => lower.has(String(d).toLowerCase()));
        }
        return out;
    }

    /**
     * Pure: rebuild the canonical blocked-domains list from a site-preference map
     * (siteName -> boolean) and a fresh siteSettings snapshot.
     */
    buildBlockedDomainsFromSitePreferenceMap(prefMap, siteSettings) {
        const out = new Set();
        for (const [name, applied] of Object.entries(prefMap || {})) {
            if (!applied) continue;
            const site = siteSettings && siteSettings[name];
            if (site && Array.isArray(site.domains)) {
                site.domains.forEach(d => out.add(String(d).toLowerCase()));
            }
        }
        return Array.from(out);
    }

    /**
     * Write-through: persist the preference map inferred from the given domain list.
     * Used at startup to backfill `appliedBlockedBySite` when it's missing.
     */
    syncAppliedBlockedFromDomains(domains) {
        const inferred = this.inferAppliedBlockedBySite(domains);
        this.store.set('appliedBlockedBySite', inferred);
        return inferred;
    }
}

module.exports = DataManager;
