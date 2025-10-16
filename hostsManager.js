// hostsManager.js - Handles hosts file operations and DNS management

const fs = require('fs');
const { exec } = require('child_process');
const sudo = require('sudo-prompt');
const { app } = require('electron');
const path = require('path');

class HostsManager {
    constructor() {
        this.hostsPath = process.platform === 'win32' ? 'C:\\Windows\\System32\\drivers\\etc\\hosts' : '/etc/hosts';
        this.redirectPath = '127.0.0.1';
        this.blockerMarkerStart = '# -- SOCIAL BLOCKER V6 START --';
        this.blockerMarkerEnd = '# -- SOCIAL BLOCKER V6 END --';
    }

    flushDNSCache() {
        return new Promise((resolve) => {
            const command = process.platform === 'win32' ? 'ipconfig /flushdns' : 'sudo dscacheutil -flushcache';
            exec(command, (error, stdout, stderr) => {
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


    updateHostsFile(blockedDomains = null, deepWorkSites = []) {
        return new Promise((resolve) => {
            console.log('Updating hosts file...');
            fs.readFile(this.hostsPath, 'utf8', (err, data) => {
                if (err) {
                    console.error('Error reading hosts file:', err);
                    return resolve({ success: false, error: err.message });
                }
                
                const manuallyBlocked = new Set(blockedDomains || []);
                
                // Add deep work sites if provided
                if (deepWorkSites.length > 0) {
                    deepWorkSites.forEach(site => manuallyBlocked.add(site));
                }

                const sitesToBlock = Array.from(manuallyBlocked);
                console.log('Sites to block:', sitesToBlock);
                
                const lines = data.split('\n');
                console.log('Original hosts file has', lines.length, 'lines');
                
                // Find and remove our SOCIAL BLOCKER section
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
                
                // Remove our section if it exists
                if (startIndex !== -1 && endIndex !== -1) {
                    console.log(`Removing existing SOCIAL BLOCKER section (lines ${startIndex + 1}-${endIndex + 1})`);
                    newLines.splice(startIndex, endIndex - startIndex + 1);
                }
                
                console.log('After removing old section, hosts file has', newLines.length, 'lines');
                
                // Add new section if we have sites to block
                if (sitesToBlock.length > 0) {
                    const newSection = [
                        this.blockerMarkerStart,
                        ...sitesToBlock.map(site => `${this.redirectPath} ${site} #SOCIALBLOCKER_MARKER`),
                        this.blockerMarkerEnd
                    ];
                    newLines.push(...newSection);
                    console.log(`Added new SOCIAL BLOCKER section with ${sitesToBlock.length} sites`);
                }
                
                let content = newLines.join('\n');
                
                // Clean up excessive newlines
                content = content.replace(/\n{3,}/g, '\n\n');
                
                const tempFilePath = path.join(app.getPath('temp'), 'hosts_temp');
                console.log('Writing to temp file:', tempFilePath);
                
                fs.writeFile(tempFilePath, content, (err) => {
                    if (err) {
                        console.error('Error writing temp file:', err);
                        return resolve({ success: false, error: err.message });
                    }
                    
                    // Use a simple copy command that should trigger UAC
                    const copyCommand = process.platform === 'win32' 
                        ? `cmd /c copy /Y "${tempFilePath}" "${this.hostsPath}"`
                        : `cp "${tempFilePath}" "${this.hostsPath}"`;
                    
                    console.log('Executing command:', copyCommand);
                    console.log('Requesting admin privileges...');
                    
                    sudo.exec(copyCommand, { 
                        name: 'Social Blocker v6',
                    }, async (error, stdout, stderr) => {
                        if (error) {
                            console.error('Admin command failed:', error);
                            return resolve({ success: false, error: error.message });
                        }
                        
                        console.log('Hosts file updated successfully');
                        console.log('STDOUT:', stdout);
                        if (stderr) console.log('STDERR:', stderr);
                        
                        // Flush DNS cache after successful hosts file update
                        await this.flushDNSCache();
                        resolve({ success: true });
                    });
                });
            });
        });
    }
}

module.exports = HostsManager;
