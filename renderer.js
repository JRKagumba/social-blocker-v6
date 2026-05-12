// renderer.js - Frontend JavaScript for Social Blocker v6

// --- Element References ---
const blockedSitesList = document.getElementById('blocked-sites-list');
const statusIndicator = document.getElementById('status-indicator');
const nuclearOptionBtn = document.getElementById('nuclear-option-btn');
const deepWorkBtn = document.getElementById('deep-work-btn');
const deepWorkHoursInput = document.getElementById('deep-work-hours');
const deepWorkMinutesInput = document.getElementById('deep-work-minutes');
const deepWorkBanner = document.getElementById('deep-work-banner');
const deepWorkTimer = document.getElementById('deep-work-timer');
const statusText = document.getElementById('blocker-status-text');
const pendingChangesBanner = document.getElementById('pending-changes-banner');
const pendingChangesText = document.getElementById('pending-changes-text');
const applyChangesBtn = document.getElementById('apply-changes-btn');
const revertChangesBtn = document.getElementById('revert-changes-btn');
const pendingChangesPreview = document.getElementById('pending-changes-preview');
const willBlockList = document.getElementById('will-block-list');
const willUnblockList = document.getElementById('will-unblock-list');
const willBlockSites = document.getElementById('will-block-sites');
const willUnblockSites = document.getElementById('will-unblock-sites');
const tabs = { 
    dashboard: document.getElementById('tab-dashboard'), 
    history: document.getElementById('tab-history'), 
    data: document.getElementById('tab-data') 
};
const contents = { 
    dashboard: document.getElementById('content-dashboard'), 
    history: document.getElementById('content-history'), 
    data: document.getElementById('content-data') 
};
const chartCanvas = document.getElementById('history-chart');
const heatMapContainer = document.getElementById('heat-map-container');
const heatMapDaysSelect = document.getElementById('heat-map-days');
const commitmentModal = document.getElementById('commitment-modal');
const modalContent = document.getElementById('modal-content');
const commitmentParagraph = document.getElementById('commitment-paragraph');
const commitmentInput = document.getElementById('commitment-input');
const cancelCommitmentBtn = document.getElementById('cancel-commitment-btn');
const confirmCommitmentBtn = document.getElementById('confirm-commitment-btn');

// --- State Variables ---
let siteSettings = {};
let historyChartInstance = null;
let commitmentState = { siteName: null, newLimit: 0, oldLimit: 0, inputElement: null };

// --- Pending Changes State ---
let savedToggleStates = {}; // The state saved to disk (current reality)
let pendingToggleStates = {}; // The state shown in UI (pending changes)
let hasPendingChanges = false;

<<<<<<< Updated upstream
=======

function getLocalISODate() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function normalizeCommitmentText(s) {
    return String(s ?? '').replace(/\r\n/g, '\n').replace(/\s+$/gm, '').trimEnd();
}

function syncBannerStackPlacement() {
    if (!deepWorkBanner || !hostsIntegrityBanner || !pendingChangesBanner) return;
    const deepOn = !deepWorkBanner.classList.contains('hidden');
    const hostsOn = !hostsIntegrityBanner.classList.contains('hidden');

    hostsIntegrityBanner.style.top = deepOn ? '42px' : '0';

    let pendingTop = 0;
    if (deepOn) pendingTop += 42;
    if (hostsOn) pendingTop += 44;
    pendingChangesBanner.style.top = `${pendingTop}px`;
}

async function reloadDashboardFromMain(reason = '') {
    const data = await window.electronAPI.getInitialData();
    if (!data.success) return;
    siteSettings = data.siteSettings;
    renderSiteList(data.blockedDomains, data.usageData, data.manualLocks, data.today);
    updateMasterStatusText();
    deepWorkConfigCache = data.deepWorkConfig || deepWorkConfigCache;
    deepWorkSpecialCache = data.deepWorkSpecialSites || deepWorkSpecialCache;
    renderDeepWorkEditor();
    updateDeepWorkUI(data.deepWork);
    updateHostsIntegrityBanner(data.hostsIntegrity);
    await renderHistoryChart();
    if (reason) console.log('Renderer: dashboard reloaded —', reason);
}

function updateHostsIntegrityBanner(integrity) {
    if (!hostsIntegrityBanner || !hostsIntegrityText) return;
    if (!integrity || integrity.ok) {
        hostsIntegrityBanner.classList.add('hidden');
        syncBannerStackPlacement();
        return;
    }
    const miss = (integrity.unexpectedMissing && integrity.unexpectedMissing.length)
        ? ` Missing: ${integrity.unexpectedMissing.slice(0, 6).join(', ')}${integrity.unexpectedMissing.length > 6 ? '…' : ''}.`
        : '';
    const extra = (integrity.unexpectedExtra && integrity.unexpectedExtra.length)
        ? ` Unexpected: ${integrity.unexpectedExtra.slice(0, 4).join(', ')}${integrity.unexpectedExtra.length > 4 ? '…' : ''}.`
        : '';
    hostsIntegrityText.textContent =
        `Hosts file out of sync with the app (was it edited outside Social Blocker?).${miss}${extra} Click Repair or Save & Apply.`;
    hostsIntegrityBanner.classList.remove('hidden');
    syncBannerStackPlacement();
}


>>>>>>> Stashed changes
// --- Initialization ---
window.addEventListener('DOMContentLoaded', async () => {
    const initialData = await window.electronAPI.getInitialData();
    if (initialData.success) {
        siteSettings = initialData.siteSettings;
        renderSiteList(initialData.blockedDomains, initialData.usageData, initialData.manualLocks, initialData.today);
        updateMasterStatusText();
        updateDeepWorkUI(initialData.deepWork);
        await renderHistoryChart();
    }
    setupEventListeners();
    initReportsPanel(initialData?.reportSettings);
    initDeepWorkEditor(initialData);
    // Ensure DW badges + disable states reflect any session that was already running at load.
    syncDeepWorkEditorActiveState(!!(initialData?.deepWork?.isActive), initialData?.deepWork?.remainingMs || 0);
    showTab('dashboard');
});

// ---------------------------------------------------------------------------
// Reports / Digest panel (Data tab)
// ---------------------------------------------------------------------------
function formatReportTimestamp(iso) {
    if (!iso) return 'never';
    try {
        return new Date(iso).toLocaleString('en-US', {
            month: 'short', day: 'numeric', year: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });
    } catch { return 'never'; }
}

function renderReportSettings(settings) {
    if (!settings) return;
    const folderEl = document.getElementById('report-folder-display');
    const weeklyEl = document.getElementById('report-weekly-toggle');
    const monthlyEl = document.getElementById('report-monthly-toggle');
    const autoOpenEl = document.getElementById('report-autoopen-toggle');
    const lastWeeklyEl = document.getElementById('report-last-weekly');
    const lastMonthlyEl = document.getElementById('report-last-monthly');

    if (folderEl) folderEl.textContent = settings.targetFolder || '(unset)';
    if (weeklyEl) weeklyEl.checked = !!settings.weeklyEnabled;
    if (monthlyEl) monthlyEl.checked = !!settings.monthlyEnabled;
    if (autoOpenEl) autoOpenEl.checked = !!settings.autoOpenOnGenerate;
    if (lastWeeklyEl) lastWeeklyEl.textContent = formatReportTimestamp(settings.lastWeeklyGeneratedAt);
    if (lastMonthlyEl) lastMonthlyEl.textContent = formatReportTimestamp(settings.lastMonthlyGeneratedAt);
}

function showReportStatus(message, type = 'info') {
    const el = document.getElementById('report-status');
    if (!el) return;
    const color = type === 'error' ? 'text-red-400'
                : type === 'success' ? 'text-green-400'
                : type === 'busy' ? 'text-amber-300'
                : 'text-gray-400';
    el.className = `text-sm min-h-[1.5rem] ${color}`;
    el.textContent = message;
}

async function refreshReportSettings() {
    try {
        const settings = await window.electronAPI.getReportSettings();
        renderReportSettings(settings);
    } catch (e) {
        console.error('refreshReportSettings:', e);
    }
}

async function handleGenerate(period) {
    showReportStatus(`Generating ${period} digest…`, 'busy');
    try {
        const res = await window.electronAPI.generateDigestNow(period);
        if (res?.success) {
            showReportStatus(`✓ Saved to ${res.filepath}`, 'success');
            await refreshReportSettings();
        } else {
            showReportStatus(`✗ Failed: ${res?.error || 'unknown error'}`, 'error');
        }
    } catch (e) {
        showReportStatus(`✗ Failed: ${e.message}`, 'error');
    }
}

function initReportsPanel(initialSettings) {
    renderReportSettings(initialSettings);

    const weeklyEl = document.getElementById('report-weekly-toggle');
    const monthlyEl = document.getElementById('report-monthly-toggle');
    const autoOpenEl = document.getElementById('report-autoopen-toggle');
    const openFolderBtn = document.getElementById('open-report-folder-btn');
    const editFolderBtn = document.getElementById('edit-report-folder-btn');
    const generateWeeklyBtn = document.getElementById('generate-weekly-now-btn');
    const generateMonthlyBtn = document.getElementById('generate-monthly-now-btn');

    weeklyEl?.addEventListener('change', async () => {
        await window.electronAPI.setReportSettings({ weeklyEnabled: weeklyEl.checked });
        showReportStatus(weeklyEl.checked ? 'Weekly auto-generation enabled.' : 'Weekly auto-generation paused.');
    });
    monthlyEl?.addEventListener('change', async () => {
        await window.electronAPI.setReportSettings({ monthlyEnabled: monthlyEl.checked });
        showReportStatus(monthlyEl.checked ? 'Monthly auto-generation enabled.' : 'Monthly auto-generation paused.');
    });
    autoOpenEl?.addEventListener('change', async () => {
        await window.electronAPI.setReportSettings({ autoOpenOnGenerate: autoOpenEl.checked });
        showReportStatus(autoOpenEl.checked ? 'Reports will auto-open after generation.' : 'Reports will be saved silently.');
    });
    openFolderBtn?.addEventListener('click', async () => {
        const res = await window.electronAPI.openReportFolder();
        if (!res?.success) showReportStatus(`✗ Could not open folder: ${res?.error}`, 'error');
    });
    editFolderBtn?.addEventListener('click', async () => {
        const current = (await window.electronAPI.getReportSettings())?.targetFolder || '';
        // Prompt is OK for now; a native folder-picker can come later with dialog.showOpenDialog.
        const next = window.prompt('Folder where digest HTML files will be saved:', current);
        if (next && next.trim() && next.trim() !== current) {
            await window.electronAPI.setReportSettings({ targetFolder: next.trim() });
            await refreshReportSettings();
            showReportStatus('Save folder updated.');
        }
    });
    generateWeeklyBtn?.addEventListener('click', () => handleGenerate('weekly'));
    generateMonthlyBtn?.addEventListener('click', () => handleGenerate('monthly'));
}

// --- Real-time Listeners ---
window.electronAPI.onUsageUpdate(handleUsageUpdate);
window.electronAPI.onDeepWorkUpdate(updateDeepWorkUI);

// --- UI Rendering & State Updates ---
function renderSiteList(blockedDomains, usageData, manualLocks = {}, today = null) {
    blockedSitesList.innerHTML = '';
    
    // Initialize saved states
    savedToggleStates = {};
    pendingToggleStates = {};

    const todayStr = today || getLocalISODate();
    
    Object.values(siteSettings).forEach(site => {
        const isLockedToday = manualLocks && manualLocks[site.name] === todayStr;
        const li = document.createElement('li');
        li.className = 'p-6 bg-gray-700/60 backdrop-blur-sm rounded-xl border border-gray-600/50 flex items-center justify-between shadow-lg hover:shadow-xl transition-all duration-200';
        if (isLockedToday) li.classList.add('opacity-60');
        const isManuallyBlocked = site.domains.some(domain => blockedDomains.includes(domain));
        const usageToday = usageData[site.name] || 0;
        const usageInMinutes = (parseFloat(usageToday) / 60).toFixed(1);
        const isLimitReached = site.limit > 0 && usageInMinutes >= site.limit;
        const isBlocked = isManuallyBlocked || isLimitReached || isLockedToday;
        
        const lockControlHtml = isLockedToday
            ? `<div class="mt-2 text-xs font-semibold text-amber-300">Locked today</div>`
            : (isLimitReached ? '' : `<button class="lock-today-btn mt-2 text-xs px-2 py-1 rounded bg-gray-800/40 border border-gray-600 hover:bg-gray-800/70 text-gray-200" data-site-name="${site.name}">Lock today</button>`);

        // Store the saved state (what's actually on disk)
        savedToggleStates[site.name] = isBlocked;
        pendingToggleStates[site.name] = isBlocked;

        li.innerHTML = `
            <div class="flex flex-col">
                <span class="text-lg font-semibold">${site.name}</span>
                <div class="text-xs text-gray-400 mt-1 flex items-center">
                    <span>Usage:</span> 
                    <span class="usage-text font-mono mx-1" data-site-name="${site.name}">${usageInMinutes} /</span>
                    <input type="number" value="${site.limit}" min="0" class="limit-input bg-gray-800 text-white w-12 text-center rounded focus:outline-none focus:ring-2 focus:ring-cyan-500" data-site-name="${site.name}" data-old-value="${site.limit}">
                    <span class="ml-1">mins</span>
                </div>
                ${lockControlHtml}
            </div>
            <label class="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" id="toggle-${site.name}" class="sr-only peer individual-toggle" data-site-name="${site.name}" ${isBlocked ? 'checked' : ''} ${(isLimitReached || isLockedToday) ? 'disabled' : ''}>
                <div class="w-14 h-8 toggle-bg rounded-full"></div>
                <div class="toggle-dot absolute top-1 left-1 h-6 w-6 rounded-full transition-transform"></div>
            </label>
        `;
        blockedSitesList.appendChild(li);
    });
    
    // Reset pending changes on initial render
    hasPendingChanges = false;
    updatePendingChangesBanner();
}

async function renderHistoryChart() {
    const historyData = await window.electronAPI.getHistory();
    if (!historyData || !historyData.labels) return;
    
    // --- CHANGE HERE: Fix date parsing and formatting ---
    const formattedLabels = historyData.labels.map(isoDate => {
        // Create date correctly to avoid UTC conversion issues
        const [year, month, day] = isoDate.split('-').map(Number);
        const date = new Date(year, month - 1, day);
        return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    });

    if (historyChartInstance) historyChartInstance.destroy();
    historyChartInstance = new Chart(chartCanvas.getContext('2d'), { 
        type: 'bar', 
        data: { 
            labels: formattedLabels, // Use the new formatted labels
            datasets: [{ 
                label: 'Times Blocker Enabled', 
                data: historyData.data, 
                backgroundColor: 'rgba(34, 211, 238, 0.6)', 
                borderColor: 'rgba(34, 211, 238, 1)', 
                borderWidth: 1, 
                borderRadius: 4 
            }] 
        }, 
        options: { 
            scales: { 
                y: { 
                    beginAtZero: true, 
                    ticks: { color: '#9CA3AF', stepSize: 1 }, 
                    grid: { color: '#4B5563' } 
                }, 
                x: { 
                    ticks: { color: '#9CA3AF' }, 
                    grid: { color: 'transparent' } 
                } 
            }, 
            plugins: { legend: { display: false } } 
        } 
    });
}

// --- Site-Specific History Visualizations ---

async function renderUnblocksTable() {
    const unblockData = await window.electronAPI.getTodayUnblocks();
    const usageData = await window.electronAPI.getInitialData();
    const todayUsage = usageData.usageData;
    
    const tableContainer = document.getElementById('unblocks-table-container');
    if (!tableContainer) return;
    
    // Filter to only show sites that were unblocked today
    const unblockedSites = Object.entries(unblockData)
        .filter(([siteName, count]) => count > 0)
        .sort((a, b) => b[1] - a[1]); // Sort by unblock count descending
    
    if (unblockedSites.length === 0) {
        tableContainer.innerHTML = '<p class="text-gray-400 text-center py-8">No sites unblocked today. Great focus! 🎯</p>';
        return;
    }
    
    let html = `
        <div class="overflow-x-auto">
            <table class="w-full text-left">
                <thead class="border-b border-gray-600">
                    <tr>
                        <th class="py-3 px-4 text-cyan-400 font-semibold">Site Name</th>
                        <th class="py-3 px-4 text-cyan-400 font-semibold text-right">Time Used Today</th>
                        <th class="py-3 px-4 text-cyan-400 font-semibold text-right">Times Unblocked</th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-gray-700">
    `;
    
    unblockedSites.forEach(([siteName, unblockCount]) => {
        const usage = todayUsage[siteName] || 0;
        const usageMinutes = (usage / 60).toFixed(1);
        html += `
            <tr class="hover:bg-gray-700/30 transition-colors">
                <td class="py-3 px-4 font-medium">${siteName}</td>
                <td class="py-3 px-4 text-right font-mono">${usageMinutes} min</td>
                <td class="py-3 px-4 text-right font-mono text-yellow-400">${unblockCount}×</td>
            </tr>
        `;
    });
    
    html += `
                </tbody>
            </table>
        </div>
    `;
    
    tableContainer.innerHTML = html;
}

async function renderUnblocksChart() {
    const unblockData = await window.electronAPI.getTodayUnblocks();
    const chartContainer = document.getElementById('unblocks-chart-container');
    const canvas = document.getElementById('unblocks-chart');
    
    if (!canvas || !chartContainer) return;
    
    // Prepare data for all sites
    const labels = Object.keys(unblockData);
    const data = Object.values(unblockData);
    
    // Color bars based on count (green = 0, yellow = 1-2, red = 3+)
    const backgroundColors = data.map(count => {
        if (count === 0) return 'rgba(34, 197, 94, 0.6)'; // Green
        if (count <= 2) return 'rgba(251, 191, 36, 0.6)'; // Yellow
        return 'rgba(239, 68, 68, 0.6)'; // Red
    });
    
    const borderColors = backgroundColors.map(color => color.replace('0.6', '1'));
    
    // Destroy existing chart if it exists
    if (window.unblocksChartInstance) {
        window.unblocksChartInstance.destroy();
    }
    
    window.unblocksChartInstance = new Chart(canvas.getContext('2d'), {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Times Unblocked Today',
                data: data,
                backgroundColor: backgroundColors,
                borderColor: borderColors,
                borderWidth: 1,
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: { 
                        color: '#9CA3AF',
                        stepSize: 1
                    },
                    grid: { color: '#4B5563' }
                },
                x: {
                    ticks: { color: '#9CA3AF' },
                    grid: { color: 'transparent' }
                }
            },
            plugins: {
                legend: { display: false },
                title: {
                    display: true,
                    text: 'Unblock Events by Site (Today)',
                    color: '#9CA3AF',
                    font: { size: 14 }
                }
            }
        }
    });
}

async function renderUsageChart() {
    const usageData = await window.electronAPI.getInitialData();
    const todayUsage = usageData.usageData;
    const canvas = document.getElementById('usage-chart');
    
    if (!canvas) return;
    
    // Prepare data for all sites (convert to minutes)
    const labels = Object.keys(todayUsage);
    const data = Object.values(todayUsage).map(seconds => (seconds / 60).toFixed(1));
    
    // Color bars based on site limits
    const siteSettings = usageData.siteSettings;
    const backgroundColors = labels.map(siteName => {
        const site = siteSettings[siteName];
        if (!site || site.limit === 0) return 'rgba(156, 163, 175, 0.6)'; // Gray for no limit
        
        const usage = todayUsage[siteName] / 60;
        const limit = site.limit;
        const percentage = (usage / limit) * 100;
        
        if (percentage < 50) return 'rgba(34, 197, 94, 0.6)'; // Green
        if (percentage < 90) return 'rgba(251, 191, 36, 0.6)'; // Yellow
        return 'rgba(239, 68, 68, 0.6)'; // Red
    });
    
    const borderColors = backgroundColors.map(color => color.replace('0.6', '1'));
    
    // Destroy existing chart if it exists
    if (window.usageChartInstance) {
        window.usageChartInstance.destroy();
    }
    
    window.usageChartInstance = new Chart(canvas.getContext('2d'), {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Usage (minutes)',
                data: data,
                backgroundColor: backgroundColors,
                borderColor: borderColors,
                borderWidth: 1,
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: { 
                        color: '#9CA3AF',
                        callback: function(value) {
                            return value + ' min';
                        }
                    },
                    grid: { color: '#4B5563' }
                },
                x: {
                    ticks: { color: '#9CA3AF' },
                    grid: { color: 'transparent' }
                }
            },
            plugins: {
                legend: { display: false },
                title: {
                    display: true,
                    text: 'Time Used by Site (Today)',
                    color: '#9CA3AF',
                    font: { size: 14 }
                }
            }
        }
    });
}

async function renderDataTab() {
    await renderHeatMap();
}

async function renderHeatMap() {
    const days = parseInt(heatMapDaysSelect.value);
    const heatMapData = await window.electronAPI.getHeatMapData(days);
    
    if (!heatMapData || heatMapData.length === 0) {
        heatMapContainer.innerHTML = '<p class="text-gray-400 text-center py-8">No data available for the selected period.</p>';
        return;
    }

    // Find max value for color scaling
    const maxValue = Math.max(...heatMapData.flatMap(day => day.hours));
    
    let html = '<div class="heat-map-grid">';
    
    // Header row with hours
    html += '<div class="flex mb-2">';
    html += '<div class="w-20 text-xs text-gray-400 font-medium"></div>';
    for (let hour = 0; hour < 24; hour++) {
        html += `<div class="w-8 text-xs text-gray-400 text-center">${hour}</div>`;
    }
    html += '</div>';
    
    // Data rows
    heatMapData.forEach(dayData => {
        // --- CHANGE HERE: Fix date parsing for Heat Map to avoid UTC issues ---
        const [year, month, day] = dayData.date.split('-').map(Number);
        const date = new Date(year, month - 1, day);
        const dayName = date.toLocaleDateString(undefined, { weekday: 'short' });
        const monthDay = date.getDate();
        
        html += `<div class="flex mb-1">`;
        html += `<div class="w-20 text-xs text-gray-300 font-medium">${dayName} ${monthDay}</div>`;
        
        dayData.hours.forEach((minutes, hour) => {
            const intensity = maxValue > 0 ? minutes / maxValue : 0;
            let bgColor;
            
            if (minutes === 0) {
                bgColor = 'bg-gray-700';
            } else if (intensity < 0.3) {
                bgColor = 'bg-green-600';
            } else if (intensity < 0.6) {
                bgColor = 'bg-yellow-500';
            } else {
                bgColor = 'bg-red-600';
            }
            
            const tooltip = minutes > 0 ? `${minutes.toFixed(1)} min` : '0 min';
            html += `<div class="w-8 h-8 ${bgColor} border border-gray-600 cursor-pointer hover:opacity-80 transition-opacity" title="${tooltip}"></div>`;
        });
        
        html += '</div>';
    });
    
    html += '</div>';
    
    // Add legend
    html += '<div class="mt-4 flex items-center justify-center space-x-4 text-xs text-gray-400">';
    html += '<span>Less</span>';
    html += '<div class="w-4 h-4 bg-gray-700 border border-gray-600"></div>';
    html += '<div class="w-4 h-4 bg-green-600 border border-gray-600"></div>';
    html += '<div class="w-4 h-4 bg-yellow-500 border border-gray-600"></div>';
    html += '<div class="w-4 h-4 bg-red-600 border border-gray-600"></div>';
    html += '<span>More</span>';
    html += '</div>';
    
    heatMapContainer.innerHTML = html;
}

// --- Adherence chart removed (no longer needed) ---

// --- Pending Changes Management ---
function updatePendingChangesBanner() {
    // Check if there are any differences between saved and pending states
    hasPendingChanges = false;
    const willBlock = [];
    const willUnblock = [];
    
    Object.keys(pendingToggleStates).forEach(siteName => {
        if (savedToggleStates[siteName] !== pendingToggleStates[siteName]) {
            hasPendingChanges = true;
            if (pendingToggleStates[siteName]) {
                willBlock.push(siteName);
            } else {
                willUnblock.push(siteName);
            }
        }
    });
    
    // Show/hide the banner
    if (hasPendingChanges) {
        pendingChangesBanner.classList.remove('hidden');
        pendingChangesPreview.classList.remove('hidden');
        
        // Update the count
        const changeCount = willBlock.length + willUnblock.length;
        pendingChangesText.textContent = `You have ${changeCount} unsaved change${changeCount > 1 ? 's' : ''}`;
        
        // Show what will change
        if (willBlock.length > 0) {
            willBlockList.classList.remove('hidden');
            willBlockSites.textContent = willBlock.join(', ');
        } else {
            willBlockList.classList.add('hidden');
        }
        
        if (willUnblock.length > 0) {
            willUnblockList.classList.remove('hidden');
            willUnblockSites.textContent = willUnblock.join(', ');
        } else {
            willUnblockList.classList.add('hidden');
        }
    } else {
        pendingChangesBanner.classList.add('hidden');
        pendingChangesPreview.classList.add('hidden');
    }
}

function handleToggleChange(siteName) {
    const toggle = document.getElementById(`toggle-${siteName}`);
    if (!toggle) return;
    
    // Update pending state
    pendingToggleStates[siteName] = toggle.checked;
    
    // Detect if this is an unblock event for logging (only when applying, not pending)
    // We'll handle logging when changes are actually applied
    
    // Update the banner
    updatePendingChangesBanner();
}

function revertPendingChanges() {
    // Reset all toggles to their saved state
    Object.keys(savedToggleStates).forEach(siteName => {
        const toggle = document.getElementById(`toggle-${siteName}`);
        if (toggle && !toggle.disabled) {
            toggle.checked = savedToggleStates[siteName];
            pendingToggleStates[siteName] = savedToggleStates[siteName];
        }
    });
    
    updatePendingChangesBanner();
}

// --- Event Listeners Setup ---
function setupEventListeners() {
    blockedSitesList.addEventListener('change', async (e) => { 
        if (e.target.classList.contains('individual-toggle')) {
            const siteName = e.target.dataset.siteName;
            handleToggleChange(siteName);
        }
    });
    blockedSitesList.addEventListener('click', async (e) => {
        const lockBtn = e.target.closest('.lock-today-btn');
        if (!lockBtn) return;
        const siteName = lockBtn.dataset.siteName;
        await lockSiteForToday(siteName);
    });

    blockedSitesList.addEventListener('focusout', (e) => { 
        if (e.target.classList.contains('limit-input')) handleLimitChange(e.target); 
    });
    
    // Apply changes button - this triggers the actual hosts file update
    applyChangesBtn.addEventListener('click', async () => {
        // Log unblock events for sites that are being unblocked
        for (const siteName in pendingToggleStates) {
            const wasSaved = savedToggleStates[siteName];
            const isPending = pendingToggleStates[siteName];
            
            // If it was blocked and is now being unblocked
            if (wasSaved && !isPending) {
                console.log(`Renderer: Manual unblock detected for ${siteName}`);
                await window.electronAPI.logUnblockEvent(siteName);
            }
        }
        
        await applyChanges();
    });
    
    // Revert changes button
    revertChangesBtn.addEventListener('click', () => {
        revertPendingChanges();
    });
    
    // Keyboard shortcut: Ctrl+S to apply changes
    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.key === 's') {
            e.preventDefault();
            if (hasPendingChanges) {
                applyChangesBtn.click();
            }
        }
    });
    
    nuclearOptionBtn.addEventListener('click', () => { 
        document.querySelectorAll('.individual-toggle').forEach(t => {
            if (!t.disabled) {
                t.checked = true;
                pendingToggleStates[t.dataset.siteName] = true;
            }
        });
        updatePendingChangesBanner();
    });
            deepWorkBtn.addEventListener('click', () => { 
                const hours = parseInt(deepWorkHoursInput.value, 10) || 0;
                const minutes = parseInt(deepWorkMinutesInput.value, 10) || 0;
                const totalMinutes = (hours * 60) + minutes;
                
                // Button should be disabled if invalid, but double-check
                if (totalMinutes === 0 || totalMinutes > 480) {
                    return;
                }
                
                const totalSeconds = totalMinutes * 60;
                window.electronAPI.startDeepWork(totalSeconds); 
            });
            
            // Validation function for Deep Work inputs
            function validateDeepWorkInputs() {
                const hours = parseInt(deepWorkHoursInput.value, 10) || 0;
                const minutes = parseInt(deepWorkMinutesInput.value, 10) || 0;
                const totalMinutes = (hours * 60) + minutes;
                
                // Disable button if total is 0 or exceeds 8 hours (480 minutes)
                deepWorkBtn.disabled = (totalMinutes === 0 || totalMinutes > 480);
            }
            
            // Live validation on input changes
            deepWorkHoursInput.addEventListener('input', validateDeepWorkInputs);
            deepWorkMinutesInput.addEventListener('input', validateDeepWorkInputs);
            
            // Select all text when focused (for easy editing)
            deepWorkHoursInput.addEventListener('focus', () => {
                deepWorkHoursInput.select();
            });
            
            deepWorkHoursInput.addEventListener('click', () => {
                deepWorkHoursInput.select();
            });
            
            deepWorkMinutesInput.addEventListener('focus', () => {
                deepWorkMinutesInput.select();
            });
            
            deepWorkMinutesInput.addEventListener('click', () => {
                deepWorkMinutesInput.select();
            });
            
            // Run validation on page load
            validateDeepWorkInputs();
    tabs.dashboard.addEventListener('click', () => showTab('dashboard'));
    tabs.history.addEventListener('click', async () => { 
        await renderHistoryChart();
        await renderUnblocksTable();
        await renderUnblocksChart();
        await renderUsageChart();
        showTab('history'); 
    });
    tabs.data.addEventListener('click', async () => { 
        await renderDataTab(); 
        showTab('data'); 
    });
    heatMapDaysSelect.addEventListener('change', () => renderHeatMap());
    cancelCommitmentBtn.addEventListener('click', closeCommitmentModal);
    confirmCommitmentBtn.addEventListener('click', confirmCommitment);
    commitmentInput.addEventListener('input', validateCommitmentInput);
    commitmentInput.addEventListener('keydown', (e) => { 
        if (e.key === 'Backspace') e.preventDefault(); 
    });
}

// --- Handlers & Core Logic ---
function handleUsageUpdate(usageData) {
    console.log('Renderer: Received usage update:', usageData);
    console.log('Renderer: Usage data type check:', typeof usageData);
    console.log('Renderer: Usage data keys:', Object.keys(usageData));
    Object.keys(usageData).forEach(key => {
        console.log(`Renderer: ${key}: ${usageData[key]} (type: ${typeof usageData[key]})`);
    });
    
    Object.keys(usageData).forEach(siteName => {
        const usageInSeconds = parseFloat(usageData[siteName]) || 0;
        const usageInMinutes = (usageInSeconds / 60).toFixed(1);
        console.log(`Renderer: Updating UI for ${siteName}: ${usageInMinutes} minutes`);
        
        const usageSpan = document.querySelector(`.usage-text[data-site-name="${siteName}"]`);
        if (usageSpan) {
            usageSpan.textContent = `${usageInMinutes} /`;
            console.log(`Renderer: Updated usage display for ${siteName}`);
        } else {
            console.log(`Renderer: Could not find usage span for ${siteName}`);
        }
        
        const site = siteSettings[siteName];
        if (site && site.limit > 0 && (usageInSeconds / 60) >= site.limit) {
            console.log(`Renderer: LIMIT REACHED for ${siteName}! Auto-blocking...`);
            const toggle = document.getElementById(`toggle-${siteName}`);
            if (toggle && !toggle.disabled) { 
                console.log(`Renderer: Setting toggle for ${siteName} to checked and disabled`);
                toggle.checked = true; 
                toggle.disabled = true;
                
                // Update both pending and saved states for auto-block
                pendingToggleStates[siteName] = true;
                savedToggleStates[siteName] = true;
                
                // Auto-blocks should apply immediately
                applyChanges(); 
            } else {
                console.log(`Renderer: Toggle for ${siteName} not found or already disabled`);
            }
        } else {
            console.log(`Renderer: ${siteName} within limit (${usageInMinutes}/${site?.limit || 'no limit'} min)`);
        }
    });
    
    updateMasterStatusText();
}

async function handleLimitChange(input) {
    const siteName = input.dataset.siteName;
    const newLimit = parseInt(input.value, 10);
    const oldLimit = parseInt(input.dataset.oldValue, 10);

    if (isNaN(newLimit) || newLimit < 0) {
        input.value = oldLimit; // Revert invalid input
        return;
    }

    if (newLimit > oldLimit) {
        // Increasing limit requires commitment
        commitmentState = { siteName, newLimit, oldLimit, inputElement: input };
        const paragraph = await window.electronAPI.getCommitmentParagraph();
        commitmentParagraph.textContent = paragraph;
        openCommitmentModal();
    } else {
        // Decreasing limit is easy
        siteSettings[siteName].limit = newLimit;
        input.dataset.oldValue = newLimit; // Update old value
        await window.electronAPI.setSiteLimit({ siteName, limit: newLimit });
    }
}

async function applyChanges() {
    statusIndicator.classList.remove('opacity-0');
    statusIndicator.textContent = '(Requesting admin access...)';
    
    const sitesToBlock = [];
    document.querySelectorAll('.individual-toggle:checked').forEach(toggle => {
        sitesToBlock.push(...siteSettings[toggle.dataset.siteName].domains);
    });

    // --- Log blocker event when changes are applied ---
    const isBlockingActive = sitesToBlock.length > 0;
    await window.electronAPI.logBlockerEvent(isBlockingActive);
    
    try {
        const result = await window.electronAPI.updateHostsFile(sitesToBlock);
        if (result.success) {
            statusIndicator.textContent = '(Success!)';
            
            // Update saved states to match what was just applied
            Object.keys(pendingToggleStates).forEach(siteName => {
                savedToggleStates[siteName] = pendingToggleStates[siteName];
            });
            
            // Hide the pending changes banner
            hasPendingChanges = false;
            updatePendingChangesBanner();
            updateMasterStatusText();
            
            // Refresh history chart after a successful block/unblock
            if (contents.history.classList.contains('hidden') === false) {
                await renderHistoryChart();
            }
        } else {
            statusIndicator.textContent = '(Failed - check console)';
            console.error('Hosts file update failed:', result.error);
        }
    } catch (error) {
        statusIndicator.textContent = '(Error occurred)';
        console.error('Error updating hosts file:', error);
    }
    
    setTimeout(() => {
        statusIndicator.classList.add('opacity-0');
        statusIndicator.textContent = '(Saving...)';
    }, 2000);
}

function updateMasterStatusText() {
    const total = Object.keys(siteSettings).length;
    const blockedCount = document.querySelectorAll('.individual-toggle:checked').length;
    statusText.textContent = `${blockedCount} / ${total} SITES BLOCKED`;
    statusText.className = 'mr-4 text-lg font-bold transition-colors';
    if (blockedCount === 0) statusText.classList.add('text-green-500');
    else if (blockedCount === total) statusText.classList.add('text-red-500');
    else statusText.classList.add('text-yellow-500');
}

function showTab(tabName) {
    Object.values(contents).forEach(c => c.classList.add('hidden'));
    Object.values(tabs).forEach(t => t.classList.replace('tab-active', 'tab-inactive'));
    contents[tabName].classList.remove('hidden');
    tabs[tabName].classList.replace('tab-inactive', 'tab-active');
}

function updateDeepWorkUI(deepWork) {
    if (deepWork && deepWork.isActive && deepWork.remaining > 0) {
        deepWorkBanner.classList.remove('hidden');
        const minutes = Math.floor(deepWork.remaining / 60000);
        const seconds = Math.floor((deepWork.remaining % 60000) / 1000).toString().padStart(2, '0');
        deepWorkTimer.textContent = `Deep Work session active. Time remaining: ${minutes}:${seconds}`;
        deepWorkBtn.disabled = true;
        deepWorkBtn.textContent = 'Session Active';
    } else {
        deepWorkBanner.classList.add('hidden');
        deepWorkBtn.disabled = false;
        deepWorkBtn.textContent = 'Start Deep Work';
    }
}

async function lockSiteForToday(siteName) {
    try {
        const toggle = blockedSitesList.querySelector(`.individual-toggle[data-site-name="${CSS.escape(siteName)}"]`);
        if (!toggle) return;

        const prevChecked = toggle.checked;
        const prevPending = pendingToggleStates[siteName];
        const prevSaved = savedToggleStates[siteName];

        // Ensure it's selected for blocking
        toggle.checked = true;
        pendingToggleStates[siteName] = true;
        hasPendingChanges = true;
        updatePendingChangesBanner();

        const applied = await applyChanges();
        if (!applied) {
            // Revert UI state if apply failed/cancelled
            toggle.checked = prevChecked;
            pendingToggleStates[siteName] = prevPending ?? prevSaved ?? prevChecked;
            updatePendingChangesBanner();
            return;
        }

        await window.electronAPI.lockSiteForToday(siteName);

        const latest = await window.electronAPI.getInitialData();
        if (latest.success) {
            siteSettings = latest.siteSettings;
            renderSiteList(latest.blockedDomains, latest.usageData, latest.manualLocks, latest.today);
            updateMasterStatusText();
        }
    } catch (err) {
        console.error('Error locking site for today:', err);
    }
}

<<<<<<< Updated upstream
=======


function updateMasterStatusText() {
    const total = Object.keys(siteSettings).length;
    const blockedCount = document.querySelectorAll('.individual-toggle:checked').length;
    statusText.textContent = `${blockedCount} / ${total} SITES BLOCKED`;
    statusText.className = 'mr-4 text-lg font-bold transition-colors';
    if (blockedCount === 0) statusText.classList.add('text-green-500');
    else if (blockedCount === total) statusText.classList.add('text-red-500');
    else statusText.classList.add('text-yellow-500');
}

function showTab(tabName) {
    Object.values(contents).forEach(c => c.classList.add('hidden'));
    Object.values(tabs).forEach(t => t.classList.replace('tab-active', 'tab-inactive'));
    contents[tabName].classList.remove('hidden');
    tabs[tabName].classList.replace('tab-inactive', 'tab-active');
}

function updateDeepWorkUI(deepWork) {
    const ms = (() => {
        if (!deepWork) return 0;
        if (typeof deepWork.remainingMs === 'number') return deepWork.remainingMs;
        if (typeof deepWork.remaining === 'number') return deepWork.remaining;
        return 0;
    })();

    const isActive = !!(deepWork && deepWork.isActive && ms > 0);

    if (isActive) {
        deepWorkBanner.classList.remove('hidden');
        const minutes = Math.floor(ms / 60000);
        const seconds = Math.floor((ms % 60000) / 1000).toString().padStart(2, '0');
        deepWorkTimer.textContent = `Deep Work session active. Time remaining: ${minutes}:${seconds}`;
        deepWorkBtn.disabled = true;
        deepWorkBtn.textContent = 'Session Active';
    } else {
        deepWorkBanner.classList.add('hidden');
        deepWorkBtn.disabled = false;
        deepWorkBtn.textContent = 'Start Deep Work';
    }
    syncBannerStackPlacement();
    syncDeepWorkEditorActiveState(isActive, ms);
}

// ---------------------------------------------------------------------------
// Deep Work editor (Item C)
// ---------------------------------------------------------------------------
let deepWorkConfigCache = null;
let deepWorkSpecialCache = null;

function formatDwInline(ms) {
    const totalMin = Math.floor(ms / 60000);
    if (totalMin >= 60) return `${Math.floor(totalMin / 60)}h ${totalMin % 60}m`;
    return `${totalMin}m`;
}

/** Renders the default-sites checkboxes + custom-domain chips from current config. */
function renderDeepWorkEditor() {
    if (!deepWorkConfigCache || !siteSettings) return;
    const defaultsContainer = document.getElementById('deep-work-default-sites');
    const chipsContainer = document.getElementById('deep-work-custom-chips');
    if (!defaultsContainer || !chipsContainer) return;

    // Available choices = every key in siteSettings PLUS each special site (Messenger, etc.)
    const choiceNames = [
        ...Object.keys(siteSettings),
        ...Object.keys(deepWorkSpecialCache || {})
    ];
    const selectedSet = new Set(deepWorkConfigCache.selectedSites || []);

    defaultsContainer.innerHTML = choiceNames.map(name => {
        const checked = selectedSet.has(name) ? 'checked' : '';
        const isSpecial = !!(deepWorkSpecialCache && deepWorkSpecialCache[name]);
        const badge = isSpecial
            ? '<span class="text-[10px] text-purple-300 bg-purple-900/40 px-1.5 py-0.5 rounded ml-1">extra</span>'
            : '';
        const safeName = String(name).replace(/"/g, '&quot;');
        return `
            <label class="flex items-center gap-3 bg-gray-900/50 border border-gray-700 rounded-lg px-3 py-2 hover:bg-gray-900 cursor-pointer">
                <input type="checkbox" class="dw-default-site w-4 h-4 accent-cyan-500" data-site-name="${safeName}" ${checked} />
                <span class="text-sm">${safeName}${badge}</span>
            </label>`;
    }).join('');

    chipsContainer.innerHTML = (deepWorkConfigCache.customDomains || []).map(d => {
        const safe = String(d).replace(/"/g, '&quot;');
        return `
            <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-purple-700/40 border border-purple-500/40 text-purple-100 text-xs font-mono">
                ${safe}
                <button class="dw-chip-remove text-purple-200 hover:text-white" data-domain="${safe}">&times;</button>
            </span>`;
    }).join('') || '<span class="text-xs text-gray-500 italic">No custom domains yet.</span>';
}

/** Disables the editor + every site toggle on the dashboard while a session is running. */
function syncDeepWorkEditorActiveState(isActive, remainingMs) {
    const card = document.getElementById('deep-work-card');
    const activeBanner = document.getElementById('deep-work-active-banner');
    const inlineTimer = document.getElementById('deep-work-inline-timer');
    const startRow = document.getElementById('deep-work-start-row');
    const editorSection = document.getElementById('deep-work-editor-section');
    const endRow = document.getElementById('deep-work-end-early-row');
    const statusPill = document.getElementById('deep-work-status-pill');

    if (card) card.classList.toggle('border-cyan-500/50', isActive);

    if (isActive) {
        activeBanner?.classList.remove('hidden');
        if (inlineTimer) inlineTimer.textContent = formatDwInline(remainingMs);
        startRow?.classList.add('opacity-40', 'pointer-events-none');
        editorSection?.classList.add('opacity-40', 'pointer-events-none');
        endRow?.classList.remove('hidden');
        if (statusPill) {
            statusPill.textContent = 'Session active';
            statusPill.className = 'text-xs text-cyan-200 bg-cyan-700/40 rounded-full px-3 py-1 font-semibold';
        }
    } else {
        activeBanner?.classList.add('hidden');
        startRow?.classList.remove('opacity-40', 'pointer-events-none');
        editorSection?.classList.remove('opacity-40', 'pointer-events-none');
        endRow?.classList.add('hidden');
        if (statusPill) {
            statusPill.textContent = 'Idle — not running';
            statusPill.className = 'text-xs text-gray-400 bg-gray-700/50 rounded-full px-3 py-1';
        }
    }

    // Force-disable every per-site toggle on the dashboard during deep work + add DW badge.
    document.querySelectorAll('.individual-toggle').forEach(input => {
        if (isActive) {
            input.dataset.preDwDisabled = input.disabled ? '1' : '0';
            input.disabled = true;
        } else if (input.dataset.preDwDisabled !== undefined) {
            input.disabled = input.dataset.preDwDisabled === '1';
            delete input.dataset.preDwDisabled;
        }
    });
    document.querySelectorAll('.lock-today-btn').forEach(btn => {
        btn.disabled = isActive;
        btn.classList.toggle('opacity-50', isActive);
        btn.classList.toggle('cursor-not-allowed', isActive);
    });
    // Badge on each site row showing DW status.
    document.querySelectorAll('#blocked-sites-list > li').forEach(li => {
        const existing = li.querySelector('.dw-badge');
        if (isActive && !existing) {
            const badge = document.createElement('span');
            badge.className = 'dw-badge text-[10px] text-cyan-200 bg-cyan-700/40 px-2 py-0.5 rounded ml-2 font-semibold tracking-wide';
            badge.textContent = 'DEEP WORK';
            const heading = li.querySelector('span.text-lg');
            if (heading) heading.appendChild(badge);
        } else if (!isActive && existing) {
            existing.remove();
        }
    });
}

async function refreshDeepWorkConfig() {
    try {
        const payload = await window.electronAPI.getDeepWorkConfig();
        deepWorkConfigCache = payload?.config || null;
        deepWorkSpecialCache = payload?.specialSites || null;
        renderDeepWorkEditor();
    } catch (e) {
        console.error('refreshDeepWorkConfig:', e);
    }
}

function initDeepWorkEditor(initialPayload) {
    if (initialPayload) {
        deepWorkConfigCache = initialPayload.deepWorkConfig || null;
        deepWorkSpecialCache = initialPayload.deepWorkSpecialSites || null;
    }
    renderDeepWorkEditor();

    const defaultsContainer = document.getElementById('deep-work-default-sites');
    const chipsContainer = document.getElementById('deep-work-custom-chips');
    const customInput = document.getElementById('deep-work-custom-input');
    const customAddBtn = document.getElementById('deep-work-custom-add-btn');
    const endEarlyBtn = document.getElementById('deep-work-end-early-btn');

    defaultsContainer?.addEventListener('change', async (e) => {
        if (!e.target.classList?.contains('dw-default-site')) return;
        const name = e.target.dataset.siteName;
        if (!name || !deepWorkConfigCache) return;
        const set = new Set(deepWorkConfigCache.selectedSites);
        if (e.target.checked) set.add(name); else set.delete(name);
        const next = await window.electronAPI.setDeepWorkConfig({ selectedSites: Array.from(set) });
        deepWorkConfigCache = next;
    });

    chipsContainer?.addEventListener('click', async (e) => {
        const btn = e.target.closest('.dw-chip-remove');
        if (!btn) return;
        const domain = btn.dataset.domain;
        if (!domain || !deepWorkConfigCache) return;
        const remaining = (deepWorkConfigCache.customDomains || []).filter(d => d !== domain);
        const next = await window.electronAPI.setDeepWorkConfig({ customDomains: remaining });
        deepWorkConfigCache = next;
        renderDeepWorkEditor();
    });

    const addCustom = async () => {
        if (!customInput || !deepWorkConfigCache) return;
        const raw = customInput.value.trim();
        if (!raw) return;
        const merged = Array.from(new Set([...(deepWorkConfigCache.customDomains || []), raw]));
        const next = await window.electronAPI.setDeepWorkConfig({ customDomains: merged });
        deepWorkConfigCache = next;
        customInput.value = '';
        renderDeepWorkEditor();
        if (!next.customDomains.includes(raw.toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, ''))) {
            customInput.placeholder = 'invalid domain — try news.ycombinator.com';
            setTimeout(() => { customInput.placeholder = 'add a domain (e.g. news.ycombinator.com)'; }, 2500);
        }
    };
    customAddBtn?.addEventListener('click', addCustom);
    customInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addCustom(); } });

    endEarlyBtn?.addEventListener('click', async () => {
        if (!confirm('End the Deep Work session now? The block lifts immediately.')) return;
        const r = await window.electronAPI.endDeepWork();
        if (!r?.success) alert(`Could not end session: ${r?.error || 'unknown'}`);
        await reloadDashboardFromMain('deep-work-ended-early');
    });
}

>>>>>>> Stashed changes
// --- Commitment Modal Logic ---
function openCommitmentModal() {
    commitmentInput.value = '';
    confirmCommitmentBtn.disabled = true;
    commitmentModal.classList.remove('hidden');
    modalContent.classList.remove('scale-95', 'opacity-0');
}

function closeCommitmentModal() {
    commitmentState.inputElement.value = commitmentState.oldLimit; // Revert UI
    modalContent.classList.add('scale-95', 'opacity-0');
    setTimeout(() => commitmentModal.classList.add('hidden'), 150);
}

function validateCommitmentInput() {
    confirmCommitmentBtn.disabled = commitmentInput.value !== commitmentParagraph.textContent;
}

async function confirmCommitment() {
    const { siteName, newLimit, inputElement } = commitmentState;
    siteSettings[siteName].limit = newLimit;
    inputElement.dataset.oldValue = newLimit;
    await window.electronAPI.setSiteLimit({ siteName, limit: newLimit });
    closeCommitmentModal();
}
