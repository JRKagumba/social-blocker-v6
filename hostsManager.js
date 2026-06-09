// hostsManager.js - Handles hosts file operations, verification, and external-change watchdog

const fs = require('fs');
const fsPromises = require('fs/promises');
const path = require('path');
const { exec } = require('child_process');
const sudo = require('sudo-prompt');
const { app } = require('electron');

class HostsManager {
    constructor() {
        this.hostsPath = process.platform === 'win32' ? 'C:\\Windows\\System32\\drivers\\etc\\hosts' : '/etc/hosts';
        this.hostsWatchDir = path.dirname(this.hostsPath);
        this.redirectPath = '127.0.0.1';
        this.blockerMarkerStart = '# -- SOCIAL BLOCKER V6 START --';
        this.blockerMarkerEnd = '# -- SOCIAL BLOCKER V6 END --';
        this.watchHandle = null;
        this.watchDebounceTimer = null;
        /** Ms timestamp until which directory watch events are ignored (our own writes / DNS flush side effects). */
        this.suppressExternalWatchUntil = 0;
        this.onExternalTamperDetected = null;
    }

    setExternalTamperHandler(fn) {
        this.onExternalTamperDetected = typeof fn === 'function' ? fn : null;
    }

    suppressWatchTemporarily(ms = 4500) {
        this.suppressExternalWatchUntil = Date.now() + ms;
    }

    flushDNSCache() {
        return new Promise((resolve) => {
            const command = process.platform === 'win32' ? 'ipconfig /flushdns' : 'sudo dscacheutil -flushcache';
            exec(command, (error) => {
                if (error) {
                    console.warn('DNS flush failed:', error.message);
                    resolve(false);
                } else {
                    console.log('DNS cache flushed successfully');
                    resolve(true);
                }
            });
        });
    }

    /** Read hosts file as UTF-8 (throws on ENOENT/read error). */
    async readHostsFileText() {
        return fsPromises.readFile(this.hostsPath, 'utf8');
    }

    /**
     * Extract domain hostnames Social Blocker has written between its markers (order preserved).
     */
    extractBlockedDomainsFromHostsText(text) {
        const lines = (text || '').split(/\r?\n/);
        let startIdx = -1;
        let endIdx = -1;

        for (let i = 0; i < lines.length; i++) {
            if (lines[i].includes(this.blockerMarkerStart)) startIdx = i;
            if (lines[i].includes(this.blockerMarkerEnd)) {
                endIdx = i;
                break;
            }
        }

        if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) return [];

        const domains = [];
        const lineRe = new RegExp(
            '^\\s*' + this.escapeRegExp(this.redirectPath) + '\\s+([^#\\s]+)\\s*(?:#.*)?$'
        );

        for (let i = startIdx + 1; i < endIdx; i++) {
            const trimmed = lines[i].trim();
            if (!trimmed || trimmed.startsWith('#')) continue;
            const m = trimmed.match(lineRe);
            if (m) domains.push(m[1].trim().toLowerCase());
        }
        return domains;
    }

    escapeRegExp(s) {
        return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    /**
     * Returns { ok: boolean, unexpectedMissing: string[], unexpectedExtra: string[] }
     * compared to expected domains list (handles duplicates loosely).
     */
    verifyHostsSection(expectedDomains) {
        let text;
        try {
            text = fs.readFileSync(this.hostsPath, 'utf8');
        } catch (e) {
            return {
                ok: false,
                unexpectedMissing: [...new Set((expectedDomains || []).map(d => String(d).toLowerCase()))],
                unexpectedExtra: [],
                sectionPresent: false,
                readError: e.message
            };
        }

        const found = this.extractBlockedDomainsFromHostsText(text);
        const expSet = new Set((expectedDomains || []).map(d => String(d).toLowerCase()));
        const foundSet = new Set(found.map(d => String(d).toLowerCase()));

        const unexpectedMissing = [];
        expSet.forEach(d => {
            if (!foundSet.has(d)) unexpectedMissing.push(d);
        });

        const unexpectedExtra = [];
        foundSet.forEach(d => {
            if (!expSet.has(d)) unexpectedExtra.push(d);
        });

        const sectionPresent = text.includes(this.blockerMarkerStart) && text.includes(this.blockerMarkerEnd);
        return {
            ok: unexpectedMissing.length === 0 && unexpectedExtra.length === 0 && (expSet.size === 0 || sectionPresent),
            unexpectedMissing,
            unexpectedExtra,
            sectionPresent
        };
    }

    /** Start fs.watch on the hosts directory — external edits to hosts trigger callback (debounced). */
    startHostsWatchdog() {
        if (this.watchHandle) return;

        try {
            this.watchHandle = fs.watch(this.hostsWatchDir, { persistent: true }, (_eventType) => {
                if (Date.now() < this.suppressExternalWatchUntil) return;
                if (!this.onExternalTamperDetected) return;

                if (this.watchDebounceTimer) clearTimeout(this.watchDebounceTimer);
                this.watchDebounceTimer = setTimeout(() => {
                    this.watchDebounceTimer = null;
                    try {
                        this.onExternalTamperDetected();
                    } catch (e) {
                        console.error('HostsManager: watchdog callback error:', e);
                    }
                }, 450);
            });
            console.log('HostsManager: Watchdog armed on directory:', this.hostsWatchDir);
        } catch (e) {
            console.warn('HostsManager: Unable to arm hosts watchdog:', e.message);
        }
    }

    stopHostsWatchdog() {
        if (this.watchDebounceTimer) {
            clearTimeout(this.watchDebounceTimer);
            this.watchDebounceTimer = null;
        }
        if (this.watchHandle) {
            this.watchHandle.close();
            this.watchHandle = null;
            console.log('HostsManager: Watchdog stopped');
        }
    }

    updateHostsFile(blockedDomains = null, deepWorkSites = []) {
        return new Promise((resolve) => {
            console.log('Updating hosts file...');

            fs.readFile(this.hostsPath, 'utf8', (err, data) => {
                if (err) {
                    console.error('Error reading hosts file:', err);
                    return resolve({ success: false, error: err.message });
                }

                const manuallyBlocked = new Set(blockedDomains || []);

                if (deepWorkSites.length > 0) {
                    deepWorkSites.forEach(site => manuallyBlocked.add(site));
                }

                const sitesToBlock = Array.from(manuallyBlocked);
                console.log('Sites to block:', sitesToBlock);

                const lines = data.split('\n');
                let startIndex = -1;
                let endIndex = -1;

                for (let i = 0; i < lines.length; i++) {
                    if (lines[i].includes(this.blockerMarkerStart)) {
                        startIndex = i;
                    }
                    if (lines[i].includes(this.blockerMarkerEnd)) {
                        endIndex = i;
                        break;
                    }
                }

                let newLines = [...lines];

                if (startIndex !== -1 && endIndex !== -1) {
                    console.log(`Removing existing SOCIAL BLOCKER section (lines ${startIndex + 1}-${endIndex + 1})`);
                    newLines.splice(startIndex, endIndex - startIndex + 1);
                }

                if (sitesToBlock.length > 0) {
                    const newSection = [
                        this.blockerMarkerStart,
                        ...sitesToBlock.map(site => `${this.redirectPath} ${site} #SOCIALBLOCKER_MARKER`),
                        this.blockerMarkerEnd
                    ];
                    newLines.push(...newSection);
                }

                let content = newLines.join('\n');
                content = content.replace(/\n{3,}/g, '\n\n');

                const tempFilePath = path.join(app.getPath('temp'), 'hosts_temp');

                fs.writeFile(tempFilePath, content, (writeErr) => {
                    if (writeErr) {
                        console.error('Error writing temp file:', writeErr);
                        return resolve({ success: false, error: writeErr.message });
                    }

                    const copyCommand = process.platform === 'win32'
                        ? `cmd /c copy /Y "${tempFilePath}" "${this.hostsPath}"`
                        : `cp "${tempFilePath}" "${this.hostsPath}"`;

                    sudo.exec(copyCommand, {
                        name: 'Social Blocker v6',
                    }, async (error, stdout, stderr) => {
                        if (error) {
                            console.error('Admin command failed:', error);
                            return resolve({ success: false, error: error.message });
                        }

                        console.log('Hosts file updated successfully');
                        if (stdout) console.log('STDOUT:', stdout);
                        if (stderr) console.log('STDERR:', stderr);

                        await this.flushDNSCache();

                        const verification = this.verifyHostsSection(sitesToBlock);

                        resolve({
                            success: true,
                            verified: verification.ok && verification.sectionPresent,
                            verification
                        });
                    });
                });
            });
        });
    }
}

module.exports = HostsManager;
