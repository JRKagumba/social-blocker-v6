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
                // Never use substring "x.com" fallback — titles like "... netflix.com ..." falsely match x.com mid-string.
                // Regex handles real X contexts; keywords are deliberately narrow.
                keywords: ['twitter', 'twitter.com'],
                matchPatterns: [
                    '\\btwitter\\b',
                    '\\btwitter\\.com\\b',
                    // " / X" followed by a word boundary — covers single-tab Chrome ("/ X - Google Chrome")
                    // AND Edge multi-tab ("/ X and 1 more page - Personal - Microsoft Edge").
                    // Deliberately NOT \bx\.com\b — would false-positive on Reddit threads discussing x.com.
                    '\\s/\\sx\\b',
                    // "(12) Notifications / X ..." — multi-tab numeric prefix.
                    '^\\(\\d+\\)\\s[^\\n]*\\s/\\sx\\b',
                    // Post titles "Name on X: \"…\""
                    '\\bon\\sx\\s*:',
                    // Alternate separators used in SPA titles.
                    '\\s-\\sx\\s*-\\s*',
                    '\\s\\|\\sx\\s*\\|'
                ],
                limit: 60
            },
            'Reddit': {
                name: 'Reddit',
                // Subdomains matter for hosts-file blocking.
                domains: ['reddit.com', 'www.reddit.com', 'old.reddit.com', 'new.reddit.com', 'np.reddit.com', 'redd.it'],
                keywords: ['reddit', 'reddit.com', 'redd.it'],
                matchPatterns: [
                    '\\breddit\\b',
                    '\\breddit\\.com\\b',
                    '\\bredd\\.it\\b',
                    // Modern Reddit titles omit the brand; subreddit slash is the giveaway.
                    '\\br/[A-Za-z0-9_]+\\b'
                ],
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
                    const mustHave = ['twitter', 'twitter.com'];
                    const merged = Array.from(new Set([...(site.keywords || []), ...mustHave]));
                    const sanitizedMerged = this.sanitizeKeywords(siteName, merged);
                    if (JSON.stringify(sanitizedMerged) !== JSON.stringify(site.keywords)) {
                        site.keywords = sanitizedMerged;
                        needsUpdate = true;
                    }
                    // Always migrate to safer title patterns — X title formats change frequently.
                    if (defaultSite?.matchPatterns && JSON.stringify(site.matchPatterns) !== JSON.stringify(defaultSite.matchPatterns)) {
                        site.matchPatterns = defaultSite.matchPatterns;
                        needsUpdate = true;
                    }
                }

                if (siteName === 'Reddit' && defaultSite?.matchPatterns) {
                    const patternSet = new Set(site.matchPatterns || []);
                    defaultSite.matchPatterns.forEach(p => patternSet.add(p));
                    const mergedPatterns = [...patternSet];
                    if (mergedPatterns.length !== (site.matchPatterns || []).length) {
                        site.matchPatterns = mergedPatterns;
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

    normalizeDeepWork(raw) {
        if (!raw || typeof raw.endTime !== 'number') return null;
        const remainingMs = raw.endTime - Date.now();
        if (remainingMs <= 0) return null;
        return {
            isActive: true,
            endTime: raw.endTime,
            remainingMs
        };
    }

    inferAppliedBlockedBySite(domains) {
        const blockedSet = new Set((domains || []).map(d => String(d).toLowerCase()));
        const siteSettings = this.getSiteSettings();
        const prefs = {};
        for (const siteName in siteSettings) {
            const s = siteSettings[siteName];
            prefs[siteName] = Array.isArray(s.domains) && s.domains.length > 0
                ? s.domains.every(d => blockedSet.has(String(d).toLowerCase()))
                : false;
        }
        return prefs;
    }

    syncAppliedBlockedFromDomains(domains) {
        const prefs = this.inferAppliedBlockedBySite(domains);
        this.store.set('appliedBlockedBySite', prefs);
        return prefs;
    }

    /** Rebuild flattened blocked domain list when per-site booleans flip. */
    buildBlockedDomainsFromSitePreferenceMap(prefMap, siteSettings = null) {
        const ss = siteSettings || this.getSiteSettings();
        const out = [];
        for (const siteName of Object.keys(ss)) {
            if (prefMap[siteName]) {
                const s = ss[siteName];
                if (Array.isArray(s.domains)) out.push(...s.domains);
            }
        }
        return Array.from(new Set(out.map(d => String(d).toLowerCase())));
    }

    appendHostsTamperEvent(entry) {
        const log = [...this.store.get('hostsTamperEvents', [])];
        log.push({
            timestamp: new Date().toISOString(),
            ...entry
        });
        while (log.length > 250) log.shift();
        this.store.set('hostsTamperEvents', log);
    }

    /** Returns { rolled, baselineDay, prefsChanged, newDomainsJson } WITHOUT writing hosts — main process applies hosts. */
    advanceCalendarRollIfNeeded() {
        const today = this.getLocalISODate();
        const baseline = this.store.get('calendarRollBaselineDay', today);

        if (baseline === today) {
            return { rolled: false, baselineDay: baseline, prefsChanged: false, newDomains: this.getBlockedDomains() };
        }

        this.cleanupExpiredManualLocks();

        const siteSettings = this.getSiteSettings();
        let applied = this.store.get('appliedBlockedBySite', null);
        if (!applied || typeof applied !== 'object') {
            applied = this.inferAppliedBlockedBySite(this.getBlockedDomains());
        }

        const autoReblock = this.store.get('autoReblockUnblockedSitesOnNewDay', true);

        let prefsChanged = false;
        if (autoReblock) {
            for (const siteName of Object.keys(siteSettings)) {
                if (applied[siteName] === false) {
                    applied[siteName] = true;
                    prefsChanged = true;
                }
            }
        }

        const rebuilt = this.buildBlockedDomainsFromSitePreferenceMap(applied, siteSettings);
        const prev = this.getBlockedDomains();
        const prevJson = JSON.stringify([...prev].map(d => String(d).toLowerCase()).sort());
        const nextJson = JSON.stringify([...rebuilt].sort());

        let domainsChanged = prevJson !== nextJson;

        this.store.set('calendarRollBaselineDay', today);

        if (domainsChanged || prefsChanged) {
            this.store.set('blockedDomains', rebuilt);
            this.store.set('appliedBlockedBySite', applied);
            if (domainsChanged) {
                console.log(`DataManager: Calendar roll ${baseline} -> ${today}. Recomputed blockedDomains (${prev.length}->${rebuilt.length}).`);
            }
        }

        return {
            rolled: true,
            baselineDay: today,
            prefsChanged,
            domainsChanged,
            prevDomainsCount: prev.length,
            nextDomainsCount: rebuilt.length,
            newDomains: this.getBlockedDomains()
        };
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
        const list = Array.isArray(domains) ? [...domains] : [];
        this.store.set('blockedDomains', list);
        this.syncAppliedBlockedFromDomains(list);
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
            ...hostsIntegrityOverlay
        };
    }
}

module.exports = DataManager;
