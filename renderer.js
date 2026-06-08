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
    history:   document.getElementById('tab-history'),
    data:      document.getElementById('tab-data'),
    settings:  document.getElementById('tab-settings')
};
const contents = {
    dashboard: document.getElementById('content-dashboard'),
    history:   document.getElementById('content-history'),
    data:      document.getElementById('content-data'),
    settings:  document.getElementById('content-settings')
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
const commitmentTierBadge = document.getElementById('commitment-tier-badge');
const commitmentContext = document.getElementById('commitment-context');
const commitmentCooldownRow = document.getElementById('commitment-cooldown-row');
const commitmentCooldownSeconds = document.getElementById('commitment-cooldown-seconds');
const commitmentCooldownHint = document.getElementById('commitment-cooldown-hint');
// Hosts integrity banner (added in the Linear redesign — was referenced as an
// undeclared global before, which would have thrown if syncBannerStackPlacement
// ever ran with #deep-work-banner present).
const hostsIntegrityBanner = document.getElementById('hosts-integrity-banner');
const hostsIntegrityText = document.getElementById('hosts-integrity-text');
const hostsRepairBtn = document.getElementById('hosts-repair-btn');

// --- State Variables ---
let siteSettings = {};
let historyChartInstance = null;
// `commitmentState.kind` distinguishes the two friction entrypoints:
//   - 'limit-increase' (existing): on confirm, persist the new limit
//   - 'manual-unblock' (new): on confirm, leave the toggle in OFF state and let
//     the Apply Changes flow run normally. On cancel, snap the toggle back ON.
// `requiredText` is the tier-scaled portion the user must type (NOT the full
// `paragraph`). `cooldownSeconds` (>0 for tier 4+) gates input until elapsed.
let commitmentState = {
    kind: null,
    siteName: null,
    newLimit: 0,
    oldLimit: 0,
    inputElement: null,
    toggleElement: null,
    requiredText: '',
    fullParagraph: '',
    tier: 1,
    cooldownSeconds: 0,
    cooldownTimer: null,
    onConfirm: null,
    onCancel: null
};

// --- Pending Changes State ---
let savedToggleStates = {}; // The state saved to disk (current reality)
let pendingToggleStates = {}; // The state shown in UI (pending changes)
let hasPendingChanges = false;


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


// --- Initialization ---
window.addEventListener('DOMContentLoaded', async () => {
    const initialData = await window.electronAPI.getInitialData();
    if (initialData.success) {
        siteSettings = initialData.siteSettings;
        renderSiteList(initialData.blockedDomains, initialData.usageData, initialData.manualLocks, initialData.today);
        updateMasterStatusText();
        updateDeepWorkUI(initialData.deepWork);
        updateHostsIntegrityBanner(initialData.hostsIntegrity);
        await renderHistoryChart();
    }
    setupEventListeners();
    initReportsPanel(initialData?.reportSettings);
    initDeepWorkEditor(initialData);
    initSchedulePanel(initialData);
    await initSettingsPanel();
    // Ensure DW badges + disable states reflect any session that was already running at load.
    syncDeepWorkEditorActiveState(!!(initialData?.deepWork?.isActive), initialData?.deepWork?.remainingMs || 0);

    // v1.8.0: when the user clicks the weekly phone-export reminder notification,
    // main.js sends 'focus-phone-settings'. We switch to Settings tab and scroll
    // the Phone Data section into view.
    if (window.electronAPI.onFocusPhoneSettings) {
        window.electronAPI.onFocusPhoneSettings(() => {
            showTab('settings');
            // Defer the scroll until after the tab content is laid out.
            requestAnimationFrame(() => {
                const target = document.getElementById('phone-pick-folder-btn');
                if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
            });
        });
    }

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
    const color = type === 'error'   ? 'var(--bad)'
                : type === 'success' ? 'var(--good)'
                : type === 'busy'    ? 'var(--warn)'
                :                      'var(--ink-3)';
    el.style.fontSize = '12px';
    el.style.minHeight = '1.5rem';
    el.style.color = color;
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
        const isManuallyBlocked = site.domains.some(domain => blockedDomains.includes(domain));
        const usageToday = usageData[site.name] || 0;
        const usageInMinutes = parseFloat((parseFloat(usageToday) / 60).toFixed(1));
        const isLimitReached = site.limit > 0 && usageInMinutes >= site.limit;
        const isBlocked = isManuallyBlocked || isLimitReached || isLockedToday;

        // Save state to disk model
        savedToggleStates[site.name] = isBlocked;
        pendingToggleStates[site.name] = isBlocked;

        // Compute progress + dot color
        const pct = site.limit > 0 ? Math.min(100, (usageInMinutes / site.limit) * 100) : 0;
        let dotColor = 'var(--ink-3)';
        if (site.limit > 0) {
            if (pct >= 100) dotColor = 'var(--bad)';
            else if (pct >= 80) dotColor = 'var(--warn)';
            else dotColor = 'var(--good)';
        }
        const barColor = (pct >= 100) ? 'var(--bad)'
                       : (pct >= 80)  ? 'var(--warn)'
                       :                'var(--accent)';

        // Status chip
        let chip;
        if (isLockedToday)       chip = `<span class="chip chip-warn">Locked today</span>`;
        else if (isLimitReached) chip = `<span class="chip chip-bad">Over budget</span>`;
        else if (isBlocked)      chip = `<span class="chip chip-accent">Blocked</span>`;
        else if (site.limit > 0 && pct >= 80) {
            const remaining = Math.max(0, Math.round(site.limit - usageInMinutes));
            chip = `<span class="chip chip-warn">${remaining}m left</span>`;
        } else                   chip = `<span class="chip chip-good">On track</span>`;

        // Optional lock-today button (under the name; renderer.js queries
        // `.lock-today-btn[data-site-name]`)
        const lockBtnHtml = (!isLockedToday && !isLimitReached)
            ? `<button class="lock-today-btn" data-site-name="${site.name}"
                       style="font-size:11px; padding:1px 7px; border-radius:4px;
                              background: var(--panel-2); border:1px solid var(--line);
                              color: var(--ink-2); margin-top:2px;">Lock today</button>`
            : '';

        const li = document.createElement('li');
        li.className = 'row px-4 py-3 flex items-center';
        if (isLockedToday) li.classList.add('opacity-60');

        li.innerHTML = `
            <div class="flex-1 flex items-center gap-2 min-w-0">
                <span class="site-dot" style="background:${dotColor};"></span>
                <div class="flex flex-col min-w-0">
                    <span class="text-lg font-semibold" style="font-size:13px; color:var(--ink); line-height:1.2;">${site.name}</span>
                    ${lockBtnHtml}
                </div>
            </div>
            <div style="width:96px;" class="num" >
                <span class="usage-text" data-site-name="${site.name}" style="color:var(--ink); font-size:12px;">${usageInMinutes.toFixed(1)}m</span>
            </div>
            <div style="width:60px;" class="flex items-center justify-end gap-1">
                <input type="number" value="${site.limit}" min="0"
                       class="limit-input num"
                       data-site-name="${site.name}"
                       data-old-value="${site.limit}"
                       title="Click to edit. Use arrow keys or scroll-wheel to nudge.">
                <span style="color: var(--ink-3); font-size: 11px;">m</span>
            </div>
            <div style="width:100px;" class="pr-3">
                <div style="height:4px; background:var(--line); border-radius:2px; overflow:hidden;">
                    <div style="height:100%; width:${pct}%; background:${barColor}; transition:width 0.2s;"></div>
                </div>
            </div>
            <div style="width:120px;">
                ${chip}
            </div>
            <div style="width:60px;" class="flex justify-center">
                <label class="relative inline-flex items-center cursor-pointer">
                    <input type="checkbox"
                           id="toggle-${site.name}"
                           class="sr-only peer individual-toggle"
                           data-site-name="${site.name}"
                           ${isBlocked ? 'checked' : ''}
                           ${(isLimitReached || isLockedToday) ? 'disabled' : ''}>
                    <div class="toggle-bg"></div>
                    <div class="toggle-dot"></div>
                </label>
            </div>
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
            labels: formattedLabels,
            datasets: [{
                label: 'Times Blocker Enabled',
                data: historyData.data,
                backgroundColor: 'rgba(94, 106, 210, 0.55)',
                borderColor: 'rgba(139, 149, 248, 1)',
                borderWidth: 1,
                borderRadius: 3
            }]
        },
        options: {
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: { color: '#9ca0a8', stepSize: 1, font: { size: 11 } },
                    grid: { color: '#1c1d1f' }
                },
                x: {
                    ticks: { color: '#9ca0a8', font: { size: 11 } },
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
        tableContainer.innerHTML = '<p style="color: var(--ink-3); text-align:center; padding: 24px 0; font-size:13px;">No sites unblocked today. Great focus.</p>';
        return;
    }

    let html = `
        <div class="overflow-x-auto">
            <table class="w-full text-left" style="font-size:13px;">
                <thead>
                    <tr style="border-bottom: 1px solid var(--line);">
                        <th class="label py-2 px-3" style="text-align:left;">Site</th>
                        <th class="label py-2 px-3" style="text-align:right;">Time used today</th>
                        <th class="label py-2 px-3" style="text-align:right;">Unblocks</th>
                    </tr>
                </thead>
                <tbody>
    `;

    unblockedSites.forEach(([siteName, unblockCount], idx) => {
        const usage = todayUsage[siteName] || 0;
        const usageMinutes = (usage / 60).toFixed(1);
        const countColor = unblockCount >= 3 ? 'var(--bad)'
                         : unblockCount >= 1 ? 'var(--warn)'
                         : 'var(--ink-2)';
        const bottom = (idx === unblockedSites.length - 1) ? '' : 'border-bottom: 1px solid var(--line);';
        html += `
            <tr style="${bottom}">
                <td class="py-2 px-3" style="color: var(--ink);">${siteName}</td>
                <td class="py-2 px-3 num" style="text-align:right; color: var(--ink-2);">${usageMinutes} min</td>
                <td class="py-2 px-3 num" style="text-align:right; color: ${countColor};">${unblockCount}&times;</td>
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
    
    // Color bars: 0 = good (green), 1-2 = warn (amber), 3+ = bad (red)
    const backgroundColors = data.map(count => {
        if (count === 0) return 'rgba(76, 183, 130, 0.55)';
        if (count <= 2) return 'rgba(255, 178, 36, 0.55)';
        return 'rgba(235, 87, 87, 0.55)';
    });
    const borderColors = backgroundColors.map(color => color.replace('0.55', '1'));

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
                borderRadius: 3
            }]
        },
        options: {
            responsive: true,
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: { color: '#9ca0a8', stepSize: 1, font: { size: 11 } },
                    grid: { color: '#1c1d1f' }
                },
                x: {
                    ticks: { color: '#9ca0a8', font: { size: 11 } },
                    grid: { color: 'transparent' }
                }
            },
            plugins: {
                legend: { display: false },
                title: {
                    display: false
                }
            }
        }
    });
}

// ---------------------------------------------------------------------------
// Insights tab (KPI cards + week comparison + friction timeline)
// ---------------------------------------------------------------------------
// Single fetch from get-insights then render in passes. All renderers tolerate
// nulls/empties so a fresh install with zero usage doesn't show broken cells.

let insightWeekChartInstance = null;

function formatDurationFromSeconds(seconds) {
    const s = Math.max(0, Math.round(Number(seconds) || 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m`;
    if (s > 0) return `${s}s`;
    return '0m';
}

function format12hLabel(hour) {
    if (hour === null || hour === undefined) return null;
    const h = ((hour + 11) % 12) + 1;
    const period = hour >= 12 ? 'PM' : 'AM';
    return `${h} ${period}`;
}

function renderInsightKpis(payload) {
    const { today, week } = payload;

    // Today's total + top site.
    document.getElementById('insight-kpi-today-total').textContent =
        formatDurationFromSeconds(today.totalSeconds);
    document.getElementById('insight-kpi-today-top').textContent =
        today.topSite
            ? `Top: ${today.topSite.siteName} (${formatDurationFromSeconds(today.topSite.seconds)})`
            : 'Total social time';

    // Unblocks today + tier.
    document.getElementById('insight-kpi-unblocks').textContent = String(today.unblockCount);
    const tierLabel = today.highestTier > 0 ? `Highest tier hit: ${today.highestTier}` : 'No friction triggered yet';
    document.getElementById('insight-kpi-unblocks-detail').textContent = tierLabel;

    // Peak hour today.
    const peakLabel = today.mostDistractingHour?.hour !== null
        ? format12hLabel(today.mostDistractingHour.hour)
        : '\u2014';
    document.getElementById('insight-kpi-peak-hour').textContent = peakLabel;
    document.getElementById('insight-kpi-peak-detail').textContent =
        today.mostDistractingHour?.seconds > 0
            ? `${formatDurationFromSeconds(today.mostDistractingHour.seconds)} in this hour`
            : 'No usage logged yet';

    // This week total + delta.
    document.getElementById('insight-kpi-week-total').textContent =
        formatDurationFromSeconds(week.thisWeekTotal);

    const deltaEl = document.getElementById('insight-kpi-week-delta');
    if (week.lastWeekTotal === 0 && week.thisWeekTotal === 0) {
        deltaEl.textContent = 'No data yet';
        deltaEl.style.color = 'var(--ink-3)';
    } else if (week.lastWeekTotal === 0) {
        deltaEl.textContent = 'First week of data';
        deltaEl.style.color = 'var(--ink-3)';
    } else {
        const pct = Math.round((week.deltaSeconds / week.lastWeekTotal) * 100);
        const arrow = week.deltaSeconds < 0 ? '\u2193' : (week.deltaSeconds > 0 ? '\u2191' : '\u2192');
        const sign = week.deltaSeconds > 0 ? '+' : '';
        deltaEl.textContent = `${arrow} ${sign}${pct}% vs last week`;
        // Going down is GOOD here (less social time).
        deltaEl.style.color = week.deltaSeconds < 0 ? 'var(--good)' : (week.deltaSeconds > 0 ? 'var(--bad)' : 'var(--ink-3)');
    }
}

function renderInsightWeekChart(payload) {
    const canvas = document.getElementById('insight-week-chart');
    if (!canvas || typeof Chart === 'undefined') return;
    const ctx = canvas.getContext('2d');

    const labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const thisWeekMins = payload.week.thisWeek.map(d => Math.round(d.seconds / 60));
    const lastWeekMins = payload.week.lastWeek.map(d => Math.round(d.seconds / 60));

    if (insightWeekChartInstance) insightWeekChartInstance.destroy();
    insightWeekChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [
                {
                    label: 'Last week',
                    data: lastWeekMins,
                    backgroundColor: 'rgba(120, 134, 165, 0.45)',
                    borderRadius: 4
                },
                {
                    label: 'This week',
                    data: thisWeekMins,
                    backgroundColor: 'rgba(94, 106, 210, 0.85)',
                    borderRadius: 4
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { labels: { color: '#aab0c5', font: { size: 11 } } },
                tooltip: {
                    callbacks: { label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y}m` }
                }
            },
            scales: {
                x: { ticks: { color: '#7886a5', font: { size: 11 } }, grid: { display: false } },
                y: {
                    ticks: { color: '#7886a5', font: { size: 11 }, callback: (v) => `${v}m` },
                    grid: { color: 'rgba(120, 134, 165, 0.15)' }
                }
            }
        }
    });

    const bestEl = document.getElementById('insight-week-best');
    if (payload.week.bestDay) {
        const labelIdx = payload.week.bestDay.dayOfWeek;
        bestEl.textContent =
            `Best day this week: ${labels[labelIdx]} (${formatDurationFromSeconds(payload.week.bestDay.seconds)})`;
    } else {
        bestEl.textContent = 'No usage logged yet this week.';
    }
}

function renderFrictionTimeline(payload) {
    const list = document.getElementById('insight-friction-timeline');
    const empty = document.getElementById('insight-friction-empty');
    if (!list || !empty) return;

    if (!payload.timeline || payload.timeline.length === 0) {
        list.innerHTML = '';
        empty.classList.remove('hidden');
        return;
    }
    empty.classList.add('hidden');

    list.innerHTML = payload.timeline.map(t => {
        const time = new Date(t.timestamp).toLocaleTimeString(undefined, {
            hour: 'numeric', minute: '2-digit'
        });
        const tierColor = t.tier >= 4 ? 'var(--warn)' : (t.tier >= 3 ? 'var(--accent-2)' : 'var(--ink-2)');
        const cooldownStr = t.cooldownSeconds > 0 ? ` \u00b7 ${t.cooldownSeconds}s cooldown` : '';
        const sentenceStr = t.tier === 5 ? 'full paragraph' : `${t.sentenceCount} sentence${t.sentenceCount === 1 ? '' : 's'}`;
        const safeSite = String(t.siteName).replace(/</g, '&lt;');
        return `
            <li class="row flex items-center gap-3 py-2.5">
                <span class="num" style="color: var(--ink-3); font-size: 11px; width: 55px;">${time}</span>
                <div class="flex-1 min-w-0">
                    <div class="font-semibold" style="font-size: 13px; color: var(--ink);">${safeSite}</div>
                    <div class="num" style="font-size: 11px; color: var(--ink-3); margin-top: 1px;">
                        Required: ${sentenceStr}${cooldownStr}
                    </div>
                </div>
                <span class="num"
                      style="font-size: 11px; padding: 2px 9px; border-radius: 999px;
                             border: 1px solid ${tierColor}; color: ${tierColor};">
                    Tier ${t.tier}
                </span>
            </li>
        `;
    }).join('');
}

async function renderInsightsTab() {
    let payload;
    try {
        payload = await window.electronAPI.getInsights();
    } catch (e) {
        console.error('renderInsightsTab fetch failed:', e);
        return;
    }
    if (!payload) return;

    renderInsightKpis(payload);
    renderInsightWeekChart(payload);
    renderFrictionTimeline(payload);

    // Phone scope toggle wiring + initial phone-pane render. This runs every
    // time the Insights tab is shown so freshly-imported data picks up
    // immediately. Listeners are idempotent (we guard with __wired).
    await initInsightsScopeToggle();
    const scope = getInsightsScope();
    if (scope === 'phone' || scope === 'both') {
        await renderPhoneInsightsPane();
    }
}

// ---------------------------------------------------------------------------
// Insights scope toggle (v1.7.0)
// ---------------------------------------------------------------------------
// State: 'desktop' (default) | 'phone' | 'both'. Persisted in localStorage
// so the user's choice survives reloads. Phone / Both only become selectable
// once phone data is imported (handled in updateInsightsScopeAvailability).

const INSIGHTS_SCOPE_KEY = 'insightsScope_v1';

function getInsightsScope() {
    const stored = (() => {
        try { return localStorage.getItem(INSIGHTS_SCOPE_KEY); }
        catch (e) { return null; }
    })();
    if (stored === 'phone' || stored === 'both' || stored === 'desktop') return stored;
    return 'desktop';
}

function setInsightsScope(scope) {
    try { localStorage.setItem(INSIGHTS_SCOPE_KEY, scope); } catch (e) {}
    applyInsightsScope(scope);
}

function applyInsightsScope(scope) {
    const desktopPane = document.getElementById('insights-desktop-pane');
    const phonePane = document.getElementById('insights-phone-pane');
    const desktopLabel = document.getElementById('insights-desktop-pane-label');
    const phoneLabel = document.getElementById('insights-phone-pane-label');
    if (!desktopPane || !phonePane) return;

    if (scope === 'desktop') {
        desktopPane.classList.remove('hidden');
        phonePane.classList.add('hidden');
        desktopLabel?.classList.add('hidden');
        phoneLabel?.classList.add('hidden');
    } else if (scope === 'phone') {
        desktopPane.classList.add('hidden');
        phonePane.classList.remove('hidden');
        desktopLabel?.classList.add('hidden');
        phoneLabel?.classList.add('hidden');
    } else { // both
        desktopPane.classList.remove('hidden');
        phonePane.classList.remove('hidden');
        desktopLabel?.classList.remove('hidden');
        phoneLabel?.classList.remove('hidden');
    }

    // Visual highlight of selected button.
    document.querySelectorAll('.insights-scope-btn').forEach(btn => {
        const isActive = btn.dataset.scope === scope;
        btn.style.background = isActive ? 'var(--accent)' : 'var(--panel-2)';
        btn.style.color = isActive ? 'white' : (btn.disabled ? 'var(--ink-3)' : 'var(--ink)');
    });
}

async function initInsightsScopeToggle() {
    const buttons = document.querySelectorAll('.insights-scope-btn');
    if (!buttons.length) return;

    if (!initInsightsScopeToggle.__wired) {
        buttons.forEach(btn => {
            btn.addEventListener('click', async () => {
                if (btn.disabled) return;
                const scope = btn.dataset.scope;
                setInsightsScope(scope);
                if (scope === 'phone' || scope === 'both') {
                    await renderPhoneInsightsPane();
                }
            });
        });
        initInsightsScopeToggle.__wired = true;
    }

    // Always sync availability + visible state. Source of truth = phone status.
    try {
        const status = await window.electronAPI.phoneGetStatus();
        updateInsightsScopeAvailability(status);
        let scope = getInsightsScope();
        if ((scope === 'phone' || scope === 'both') && !status.hasData) {
            scope = 'desktop';
            setInsightsScope(scope);
        } else {
            applyInsightsScope(scope);
        }
    } catch (e) {
        console.error('initInsightsScopeToggle failed:', e);
        applyInsightsScope('desktop');
    }
}

/**
 * Render KPI cards + week chart for the phone pane. Reads from get-phone-insights
 * IPC. Shows the empty-state panel if no data.
 */
async function renderPhoneInsightsPane() {
    let payload;
    try {
        payload = await window.electronAPI.getPhoneInsights();
    } catch (e) {
        console.error('renderPhoneInsightsPane fetch failed:', e);
        return;
    }
    if (!payload) return;

    const emptyEl = document.getElementById('phone-pane-empty');
    if (!payload.hasData) {
        emptyEl?.classList.remove('hidden');
        return;
    }
    emptyEl?.classList.add('hidden');

    // KPI cards
    const setText = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
    const fmtHours = (min) => {
        if (!min) return '0h';
        const h = Math.floor(min / 60);
        const m = min % 60;
        return h > 0 ? `${h}h ${m}m` : `${m}m`;
    };
    setText('phone-kpi-today-total', payload.today.totalMinutes > 0 ? fmtHours(payload.today.totalMinutes) : '—');
    setText('phone-kpi-unlocks', payload.today.unlocks > 0 ? String(payload.today.unlocks) : '—');
    if (payload.today.topApp) {
        setText('phone-kpi-top-app', payload.today.topApp.app);
        setText('phone-kpi-top-app-detail', `${payload.today.topApp.minutes} min today`);
    } else {
        setText('phone-kpi-top-app', '—');
        setText('phone-kpi-top-app-detail', 'No data for today');
    }
    if (payload.today.topOpenedApp) {
        setText('phone-kpi-top-opened', payload.today.topOpenedApp.app);
        setText('phone-kpi-top-opened-detail', `${payload.today.topOpenedApp.opens} opens today`);
    } else {
        setText('phone-kpi-top-opened', '—');
        setText('phone-kpi-top-opened-detail', 'No data for today');
    }

    // Week chart
    renderPhoneWeekChart(payload);
}

function renderPhoneWeekChart(payload) {
    const canvas = document.getElementById('phone-week-chart');
    if (!canvas || typeof Chart === 'undefined') return;
    const days = payload.week?.days || [];
    const labels = days.map(d => ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.dayOfWeek]);
    const data = days.map(d => Math.round(d.totalMinutes));

    if (window.phoneWeekChartInstance) window.phoneWeekChartInstance.destroy();
    window.phoneWeekChartInstance = new Chart(canvas.getContext('2d'), {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label: 'Phone screen time (minutes)',
                data,
                backgroundColor: 'rgba(107, 138, 245, 0.55)',
                borderColor: 'rgba(107, 138, 245, 1)',
                borderWidth: 1,
                borderRadius: 3,
            }],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: { color: '#9ca0a8', font: { size: 11 }, callback: v => v + ' min' },
                    grid: { color: '#1c1d1f' },
                },
                x: { ticks: { color: '#9ca0a8', font: { size: 11 } }, grid: { color: 'transparent' } },
            },
            plugins: { legend: { display: false } },
        },
    });

    const bestLine = document.getElementById('phone-week-best');
    if (bestLine) {
        const thisW = payload.week.thisWeekTotal || 0;
        const lastW = payload.week.lastWeekTotal || 0;
        const delta = thisW - lastW;
        const arrow = delta === 0 ? '' : (delta > 0 ? '↑' : '↓');
        const deltaText = lastW > 0
            ? `${arrow} ${Math.abs(Math.round((delta / lastW) * 100))}% vs last week`
            : 'No comparison (no last-week data)';
        bestLine.innerHTML = `This week: <span class="num">${Math.round(thisW)}</span> min &middot; last week: <span class="num">${Math.round(lastW)}</span> min &middot; ${deltaText}`;
    }
}

async function renderUsageChart() {
    const usageData = await window.electronAPI.getInitialData();
    const todayUsage = usageData.usageData;
    const canvas = document.getElementById('usage-chart');
    
    if (!canvas) return;
    
    // Prepare data for all sites (convert to minutes)
    const labels = Object.keys(todayUsage);
    const data = Object.values(todayUsage).map(seconds => (seconds / 60).toFixed(1));
    
    // Color bars based on limit utilization (Linear palette).
    const siteSettings = usageData.siteSettings;
    const backgroundColors = labels.map(siteName => {
        const site = siteSettings[siteName];
        if (!site || site.limit === 0) return 'rgba(156, 163, 175, 0.45)';
        const usage = todayUsage[siteName] / 60;
        const percentage = (usage / site.limit) * 100;
        if (percentage < 50) return 'rgba(76, 183, 130, 0.55)';
        if (percentage < 90) return 'rgba(255, 178, 36, 0.55)';
        return 'rgba(235, 87, 87, 0.55)';
    });
    const borderColors = backgroundColors.map(color => color.replace(/0\.\d+\)/, '1)'));

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
                borderRadius: 3
            }]
        },
        options: {
            responsive: true,
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        color: '#9ca0a8',
                        font: { size: 11 },
                        callback: function(value) { return value + ' min'; }
                    },
                    grid: { color: '#1c1d1f' }
                },
                x: {
                    ticks: { color: '#9ca0a8', font: { size: 11 } },
                    grid: { color: 'transparent' }
                }
            },
            plugins: {
                legend: { display: false },
                title: { display: false }
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
        heatMapContainer.innerHTML = '<p style="color: var(--ink-3); text-align:center; padding: 24px 0; font-size:13px;">No data available for the selected period.</p>';
        return;
    }

    const maxValue = Math.max(...heatMapData.flatMap(day => day.hours));

    let html = '<div class="heat-map-grid" style="display:inline-block;">';

    // Header row with hours
    html += '<div style="display:flex; margin-bottom:6px;">';
    html += '<div style="width:64px;"></div>';
    for (let hour = 0; hour < 24; hour++) {
        html += `<div class="label num" style="width:22px; margin: 0 1px; text-align:center; font-size:10px; letter-spacing:0;">${hour}</div>`;
    }
    html += '</div>';

    // Data rows
    heatMapData.forEach(dayData => {
        const [year, month, day] = dayData.date.split('-').map(Number);
        const date = new Date(year, month - 1, day);
        const dayName = date.toLocaleDateString(undefined, { weekday: 'short' });
        const monthDay = date.getDate();

        html += `<div style="display:flex; align-items:center; margin-bottom:2px;">`;
        html += `<div class="num" style="width:64px; color: var(--ink-2); font-size:11px;">${dayName} ${monthDay}</div>`;

        dayData.hours.forEach((minutes) => {
            const intensity = maxValue > 0 ? minutes / maxValue : 0;
            let cls = 'heat-none';
            if (minutes > 0) {
                if (intensity < 0.3) cls = 'heat-low';
                else if (intensity < 0.6) cls = 'heat-med';
                else cls = 'heat-high';
            }
            const tooltip = minutes > 0 ? `${minutes.toFixed(1)} min` : '0 min';
            html += `<div class="heat-cell ${cls}" style="margin: 0 1px;" title="${tooltip}"></div>`;
        });

        html += '</div>';
    });

    html += '</div>';

    // Legend
    html += '<div style="display:flex; align-items:center; justify-content:center; gap:8px; margin-top:14px; color: var(--ink-3); font-size:11px;">';
    html += '<span>Less</span>';
    html += '<div class="heat-cell heat-none" style="width:14px; height:14px;"></div>';
    html += '<div class="heat-cell heat-low" style="width:14px; height:14px;"></div>';
    html += '<div class="heat-cell heat-med" style="width:14px; height:14px;"></div>';
    html += '<div class="heat-cell heat-high" style="width:14px; height:14px;"></div>';
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

    const wasBlocked = !!savedToggleStates[siteName];
    const previouslyPending = pendingToggleStates[siteName];
    const nowChecked = toggle.checked;

    // Manual unblock detected: was blocked (saved=true) AND user just turned
    // the toggle OFF AND this is a NEW pending change (not just flipping back
    // to the saved state). Gate it behind progressive friction.
    const isFreshUnblockIntent = wasBlocked && !nowChecked && previouslyPending !== false;

    if (isFreshUnblockIntent) {
        // Snap the toggle back ON immediately while we ask for commitment; on
        // confirm we'll flip it OFF for real. This avoids a flicker where the
        // pending banner appears, then disappears if the user bails.
        toggle.checked = true;

        beginCommitmentFlow({
            kind: 'manual-unblock',
            siteName,
            toggleElement: toggle,
            onConfirm: () => {
                toggle.checked = false;
                pendingToggleStates[siteName] = false;
                updatePendingChangesBanner();
            },
            onCancel: () => {
                // Restore prior state — either still-saved or whatever was pending.
                toggle.checked = previouslyPending ?? wasBlocked;
                pendingToggleStates[siteName] = previouslyPending ?? wasBlocked;
                updatePendingChangesBanner();
            }
        });
        return;
    }

    pendingToggleStates[siteName] = nowChecked;
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
    // Hosts watchdog: live update + repair button.
    if (window.electronAPI?.onHostsIntegrityUpdate) {
        window.electronAPI.onHostsIntegrityUpdate(updateHostsIntegrityBanner);
    }
    hostsRepairBtn?.addEventListener('click', async () => {
        hostsRepairBtn.disabled = true;
        const prev = hostsRepairBtn.textContent;
        hostsRepairBtn.textContent = 'Repairing…';
        try {
            const res = await window.electronAPI.repairHostsNow();
            if (!res?.success) console.error('Hosts repair failed:', res?.error);
        } catch (e) {
            console.error('Hosts repair threw:', e);
        } finally {
            hostsRepairBtn.disabled = false;
            hostsRepairBtn.textContent = prev;
        }
    });

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
        await renderInsightsTab();
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
    tabs.settings.addEventListener('click', async () => {
        await refreshSettingsPanel();
        showTab('settings');
    });
    heatMapDaysSelect.addEventListener('change', () => renderHeatMap());
    cancelCommitmentBtn.addEventListener('click', () => closeCommitmentModal(true));
    confirmCommitmentBtn.addEventListener('click', confirmCommitment);
    commitmentInput.addEventListener('input', validateCommitmentInput);
    commitmentInput.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace') e.preventDefault();
    });
    // Close the copy-paste loophole. Paste fires a 'paste' event, not 'keydown',
    // so the Backspace block above didn't catch it. Same goes for drag-and-drop
    // text from elsewhere on screen and the right-click context menu.
    ['paste', 'drop', 'cut'].forEach(ev => {
        commitmentInput.addEventListener(ev, (e) => e.preventDefault());
    });
    commitmentInput.addEventListener('contextmenu', (e) => e.preventDefault());
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
        beginCommitmentFlow({
            kind: 'limit-increase',
            siteName,
            inputElement: input,
            newLimit,
            oldLimit,
            onConfirm: async () => {
                siteSettings[siteName].limit = newLimit;
                input.dataset.oldValue = newLimit;
                await window.electronAPI.setSiteLimit({ siteName, limit: newLimit });
                // A confirmed limit increase is also a form of unblock —
                // log it so the friction tier compounds across the day.
                await window.electronAPI.logUnblockEvent(siteName);
            },
            onCancel: () => {
                input.value = oldLimit;
            }
        });
    } else {
        siteSettings[siteName].limit = newLimit;
        input.dataset.oldValue = newLimit;
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



function updateMasterStatusText() {
    const total = Object.keys(siteSettings).length;
    const blockedCount = document.querySelectorAll('.individual-toggle:checked').length;
    statusText.textContent = `${blockedCount} / ${total} sites blocked`;
    statusText.className = 'num';
    statusText.style.fontSize = '12px';
    if (blockedCount === 0)            statusText.style.color = 'var(--good)';
    else if (blockedCount === total)   statusText.style.color = 'var(--bad)';
    else                                statusText.style.color = 'var(--warn)';
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
    // Dedup by name — Messenger lives in BOTH registries (first-class tracker + special-domain
    // bundle for whatsapp web), and without this it would render twice in the editor.
    const choiceNames = Array.from(new Set([
        ...Object.keys(siteSettings),
        ...Object.keys(deepWorkSpecialCache || {})
    ]));
    const selectedSet = new Set(deepWorkConfigCache.selectedSites || []);

    defaultsContainer.innerHTML = choiceNames.map(name => {
        const checked = selectedSet.has(name) ? 'checked' : '';
        const isSpecial = !!(deepWorkSpecialCache && deepWorkSpecialCache[name]);
        const badge = isSpecial
            ? '<span class="chip chip-accent" style="font-size:10px; padding:0 5px; margin-left:6px;">extra</span>'
            : '';
        const safeName = String(name).replace(/"/g, '&quot;');
        return `
            <label class="flex items-center gap-2 cursor-pointer"
                   style="background: var(--bg-2); border: 1px solid var(--line); border-radius:6px; padding: 6px 9px;">
                <input type="checkbox" class="dw-default-site" style="width:14px; height:14px;" data-site-name="${safeName}" ${checked} />
                <span style="font-size:12px; color: var(--ink);">${safeName}${badge}</span>
            </label>`;
    }).join('');

    chipsContainer.innerHTML = (deepWorkConfigCache.customDomains || []).map(d => {
        const safe = String(d).replace(/"/g, '&quot;');
        return `
            <span class="num"
                  style="display:inline-flex; align-items:center; gap:6px;
                         padding: 2px 8px; border-radius: 12px;
                         background: rgba(94,106,210,0.12);
                         border: 1px solid rgba(94,106,210,0.35);
                         color: var(--accent-2); font-size: 11px;">
                ${safe}
                <button class="dw-chip-remove" data-domain="${safe}"
                        style="color: var(--accent-2); background: transparent; border: none; cursor: pointer; font-size:14px; line-height:1; padding:0;">&times;</button>
            </span>`;
    }).join('') || '<span style="color: var(--ink-3); font-size:11px; font-style: italic;">No custom domains yet.</span>';
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

    if (card) {
        card.style.borderColor = isActive ? 'rgba(94,106,210,0.5)' : '';
    }

    if (isActive) {
        activeBanner?.classList.remove('hidden');
        if (inlineTimer) inlineTimer.textContent = formatDwInline(remainingMs);
        startRow?.classList.add('opacity-40', 'pointer-events-none');
        editorSection?.classList.add('opacity-40', 'pointer-events-none');
        endRow?.classList.remove('hidden');
        if (statusPill) {
            statusPill.textContent = 'Session active';
            statusPill.className = 'chip chip-accent';
        }
    } else {
        activeBanner?.classList.add('hidden');
        startRow?.classList.remove('opacity-40', 'pointer-events-none');
        editorSection?.classList.remove('opacity-40', 'pointer-events-none');
        endRow?.classList.add('hidden');
        if (statusPill) {
            statusPill.textContent = 'Idle — not running';
            statusPill.className = 'chip chip-mute';
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
            badge.className = 'dw-badge chip chip-accent';
            badge.style.marginLeft = '8px';
            badge.style.fontSize = '10px';
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

// ---------------------------------------------------------------------------
// Deep Work auto-schedule (Dashboard panel + Rule editor modal)
// ---------------------------------------------------------------------------
// State + DOM refs are scoped via the module-level `scheduleState`. Listens to
// 'schedule-event' broadcasts from main so the "next fire" line and rule list
// refresh whenever a scheduled session fires.

const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const DAY_LONG = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const scheduleState = {
    rules: [],
    next: null,
    editingId: null, // null when modal is opening as "Create"
    modalDays: new Set(),
    subscribed: false,
};

function formatRuleSummary(rule) {
    const days = (rule.days || []).slice().sort();
    let dayLabel;
    if (days.length === 7) dayLabel = 'Every day';
    else if (days.length === 5 && days.every(d => d >= 1 && d <= 5)) dayLabel = 'Weekdays';
    else if (days.length === 2 && days.includes(0) && days.includes(6)) dayLabel = 'Weekends';
    else if (days.length === 0) dayLabel = 'Never';
    else dayLabel = days.map(d => DAY_LONG[d]).join(', ');

    const [h, m] = (rule.startTime || '09:00').split(':').map(Number);
    const period = h >= 12 ? 'PM' : 'AM';
    const h12 = ((h + 11) % 12) + 1;
    const timeLabel = `${h12}:${String(m).padStart(2, '0')} ${period}`;

    const mins = rule.durationMinutes || 60;
    const durLabel = mins >= 60
        ? (mins % 60 === 0 ? `${mins / 60}h` : `${Math.floor(mins / 60)}h ${mins % 60}m`)
        : `${mins}m`;

    return `${dayLabel} \u00b7 ${timeLabel} \u00b7 ${durLabel}`;
}

function formatNextFireFromIso(iso) {
    if (!iso) return null;
    const d = new Date(iso);
    if (isNaN(d)) return null;
    const now = new Date();
    const sameDay = d.getFullYear() === now.getFullYear()
        && d.getMonth() === now.getMonth()
        && d.getDate() === now.getDate();
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const isTomorrow = d.getFullYear() === tomorrow.getFullYear()
        && d.getMonth() === tomorrow.getMonth()
        && d.getDate() === tomorrow.getDate();
    const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    if (sameDay) return `Today at ${time}`;
    if (isTomorrow) return `Tomorrow (${DAY_LONG[d.getDay()]}) at ${time}`;
    return `${DAY_LONG[d.getDay()]}, ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} at ${time}`;
}

function renderScheduleList() {
    const listEl = document.getElementById('schedule-rule-list');
    const emptyEl = document.getElementById('schedule-empty-state');
    const nextEl = document.getElementById('schedule-next-fire');
    const clearAllBtn = document.getElementById('schedule-clear-all-btn');
    if (!listEl || !emptyEl || !nextEl) return;

    // Only show "Delete all" when there's actually something to delete. Keeps the
    // header clean and makes the button feel like a remediation tool rather than
    // a permanent destructive surface.
    if (clearAllBtn) {
        clearAllBtn.classList.toggle('hidden', scheduleState.rules.length === 0);
    }

    if (!scheduleState.rules.length) {
        listEl.innerHTML = '';
        emptyEl.classList.remove('hidden');
        nextEl.textContent = 'No rules scheduled.';
        nextEl.style.color = 'var(--ink-3)';
        return;
    }

    emptyEl.classList.add('hidden');

    if (scheduleState.next) {
        const when = formatNextFireFromIso(scheduleState.next.fireAt) || '\u2014';
        nextEl.textContent = `Next: ${when} \u2014 ${scheduleState.next.ruleName}`;
        nextEl.style.color = 'var(--accent-2)';
    } else {
        nextEl.textContent = 'No upcoming sessions (all rules disabled or have no days set).';
        nextEl.style.color = 'var(--ink-3)';
    }

    listEl.innerHTML = scheduleState.rules.map(rule => {
        const safeId = String(rule.id).replace(/"/g, '&quot;');
        const safeName = String(rule.name || '').replace(/</g, '&lt;');
        const dotColor = rule.enabled ? 'var(--good)' : 'var(--ink-4)';
        const summary = formatRuleSummary(rule);
        return `
            <li class="row flex items-center gap-3 py-2.5">
                <span class="site-dot" style="background:${dotColor};"></span>
                <div class="flex-1 min-w-0">
                    <div class="font-semibold" style="font-size:13px; color: var(--ink);">${safeName || 'Untitled'}</div>
                    <div class="num" style="font-size:11px; color: var(--ink-3); margin-top:1px;">${summary}</div>
                </div>
                <button class="schedule-rule-edit btn btn-ghost"
                        style="padding:3px 9px; font-size:11px;"
                        data-rule-id="${safeId}">Edit</button>
                <label class="relative inline-flex items-center cursor-pointer">
                    <input type="checkbox"
                           class="schedule-rule-enabled sr-only peer"
                           data-rule-id="${safeId}"
                           ${rule.enabled ? 'checked' : ''}>
                    <div style="width:30px; height:17px; background:${rule.enabled ? 'var(--accent)' : 'var(--line)'}; border-radius:9999px; transition:background-color 0.15s; position:relative;">
                        <div style="position:absolute; top:2px; left:${rule.enabled ? '15px' : '2px'}; width:13px; height:13px; background:${rule.enabled ? 'white' : 'var(--ink-2)'}; border-radius:9999px; transition:left 0.15s, background-color 0.15s;"></div>
                    </div>
                </label>
            </li>
        `;
    }).join('');
}

async function reloadSchedule() {
    try {
        const data = await window.electronAPI.scheduleGet();
        scheduleState.rules = Array.isArray(data?.rules) ? data.rules : [];
        scheduleState.next = data?.next || null;
        renderScheduleList();
    } catch (e) {
        console.error('reloadSchedule:', e);
    }
}

function openScheduleModal(rule = null) {
    const modal = document.getElementById('schedule-modal');
    const title = document.getElementById('schedule-modal-title');
    const nameEl = document.getElementById('schedule-modal-name');
    const startEl = document.getElementById('schedule-modal-start');
    const hrsEl = document.getElementById('schedule-modal-hours');
    const minsEl = document.getElementById('schedule-modal-minutes');
    const deleteBtn = document.getElementById('schedule-modal-delete-btn');
    const err = document.getElementById('schedule-modal-error');
    if (!modal) return;

    scheduleState.editingId = rule?.id || null;
    scheduleState.modalDays = new Set(rule?.days || []);

    title.textContent = rule ? 'Edit scheduled session' : 'New scheduled session';
    nameEl.value = rule?.name || '';
    startEl.value = rule?.startTime || '09:00';
    const dm = rule?.durationMinutes || 60;
    hrsEl.value = String(Math.floor(dm / 60));
    minsEl.value = String(dm % 60);
    deleteBtn.classList.toggle('hidden', !rule);
    err.classList.add('hidden');
    err.textContent = '';

    renderScheduleModalDays();
    modal.classList.remove('hidden');
    setTimeout(() => nameEl.focus(), 50);
}

function closeScheduleModal() {
    document.getElementById('schedule-modal')?.classList.add('hidden');
    scheduleState.editingId = null;
}

function renderScheduleModalDays() {
    const container = document.getElementById('schedule-modal-days');
    if (!container) return;
    container.innerHTML = DAY_LABELS.map((label, i) => {
        const on = scheduleState.modalDays.has(i);
        return `<button type="button"
                        class="schedule-day-pill"
                        data-day-index="${i}"
                        title="${DAY_LONG[i]}"
                        style="width:32px; height:32px; border-radius:6px;
                               border:1px solid ${on ? 'var(--accent)' : 'var(--line)'};
                               background:${on ? 'var(--accent)' : 'var(--bg-2)'};
                               color:${on ? 'white' : 'var(--ink-2)'};
                               font-weight:600; font-size:12px; cursor:pointer;
                               transition: background-color 0.12s, border-color 0.12s, color 0.12s;">
                    ${label}
                </button>`;
    }).join('');
}

function readScheduleModalForm() {
    const name = document.getElementById('schedule-modal-name').value.trim() || 'Untitled';
    const startTime = document.getElementById('schedule-modal-start').value;
    const hrs = parseInt(document.getElementById('schedule-modal-hours').value, 10) || 0;
    const mins = parseInt(document.getElementById('schedule-modal-minutes').value, 10) || 0;
    const durationMinutes = (hrs * 60) + mins;
    const days = Array.from(scheduleState.modalDays).sort();
    return { name, startTime, durationMinutes, days };
}

function validateScheduleForm(form) {
    if (!form.startTime || !/^\d{2}:\d{2}$/.test(form.startTime)) return 'Please pick a start time.';
    if (form.days.length === 0) return 'Pick at least one day of the week.';
    if (form.durationMinutes < 1) return 'Duration must be at least 1 minute.';
    if (form.durationMinutes > 480) return 'Duration cannot exceed 8 hours.';
    return null;
}

async function saveScheduleModal() {
    const form = readScheduleModalForm();
    const validationError = validateScheduleForm(form);
    const errEl = document.getElementById('schedule-modal-error');
    if (validationError) {
        errEl.textContent = validationError;
        errEl.classList.remove('hidden');
        return;
    }

    // Disable the Save button while the IPC round-trip is in flight. Without
    // this, a rapid double-click was firing scheduleAdd twice before the first
    // response came back, and on the old dedup-less code path that produced
    // identical duplicate rules. The dataManager now also dedups by fingerprint,
    // but disabling the button is the cleaner UX (no flicker, no toast on fast
    // double-clicks).
    const saveBtn = document.getElementById('schedule-modal-save');
    if (saveBtn?.disabled) return; // belt-and-suspenders re-entry guard
    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.dataset.savingOriginalText = saveBtn.textContent;
        saveBtn.textContent = 'Saving…';
    }

    try {
        let duplicate = false;
        if (scheduleState.editingId) {
            await window.electronAPI.scheduleUpdate(scheduleState.editingId, {
                ...form, enabled: true
            });
        } else {
            const res = await window.electronAPI.scheduleAdd({ ...form, enabled: true });
            // New IPC shape: { rules, duplicate }. Falls back gracefully for any
            // older builds still returning the raw array.
            if (res && typeof res === 'object' && !Array.isArray(res)) {
                duplicate = !!res.duplicate;
            }
        }

        if (duplicate) {
            errEl.textContent = 'A rule with the same name, days, start time, and duration already exists.';
            errEl.classList.remove('hidden');
            return; // leave modal open so user can edit then re-save
        }

        closeScheduleModal();
        await reloadSchedule();
    } catch (e) {
        errEl.textContent = `Could not save: ${e?.message || e}`;
        errEl.classList.remove('hidden');
    } finally {
        if (saveBtn) {
            saveBtn.disabled = false;
            if (saveBtn.dataset.savingOriginalText) {
                saveBtn.textContent = saveBtn.dataset.savingOriginalText;
                delete saveBtn.dataset.savingOriginalText;
            }
        }
    }
}

async function deleteScheduleFromModal() {
    if (!scheduleState.editingId) return;
    if (!confirm('Delete this scheduled session?')) return;
    try {
        await window.electronAPI.scheduleDelete(scheduleState.editingId);
        closeScheduleModal();
        await reloadSchedule();
    } catch (e) {
        console.error('Schedule delete failed:', e);
    }
}

async function toggleScheduleRuleEnabled(id, enabled) {
    try {
        await window.electronAPI.scheduleUpdate(id, { enabled });
        await reloadSchedule();
    } catch (e) {
        console.error('Schedule toggle failed:', e);
        await reloadSchedule();
    }
}

function initSchedulePanel(initialPayload) {
    // Seed from initial-data so we don't need an extra IPC roundtrip on boot.
    if (Array.isArray(initialPayload?.deepWorkSchedule)) {
        scheduleState.rules = initialPayload.deepWorkSchedule;
    }

    // Subscribe to fire/skip notifications so the list refreshes immediately.
    if (!scheduleState.subscribed && window.electronAPI?.onScheduleEvent) {
        window.electronAPI.onScheduleEvent(() => { reloadSchedule(); });
        scheduleState.subscribed = true;
    }

    // List interactions (event-delegated on the parent <ul>).
    const list = document.getElementById('schedule-rule-list');
    list?.addEventListener('click', (e) => {
        const editBtn = e.target.closest('.schedule-rule-edit');
        if (editBtn) {
            const id = editBtn.dataset.ruleId;
            const rule = scheduleState.rules.find(r => r.id === id);
            if (rule) openScheduleModal(rule);
        }
    });
    list?.addEventListener('change', (e) => {
        const toggle = e.target.closest('.schedule-rule-enabled');
        if (toggle) {
            toggleScheduleRuleEnabled(toggle.dataset.ruleId, toggle.checked);
        }
    });

    document.getElementById('schedule-add-btn')?.addEventListener('click', () => openScheduleModal(null));

    // Bulk-delete-all. Two-step confirm: a generic confirm() prompt that requires
    // explicit acknowledgement of how many rules are about to be wiped. There's
    // no undo since the schedule store is overwritten with [].
    document.getElementById('schedule-clear-all-btn')?.addEventListener('click', async () => {
        const count = scheduleState.rules.length;
        if (!count) return;
        const msg = `Delete all ${count} scheduled session rule${count === 1 ? '' : 's'}?\n\nThis cannot be undone. Active Deep Work sessions (if any) will not be affected.`;
        if (!confirm(msg)) return;
        try {
            await window.electronAPI.scheduleClearAll();
            await reloadSchedule();
        } catch (e) {
            console.error('Schedule clear-all failed:', e);
            alert(`Could not clear schedule: ${e?.message || e}`);
        }
    });

    // Modal controls.
    document.getElementById('schedule-modal-cancel')?.addEventListener('click', closeScheduleModal);
    document.getElementById('schedule-modal-save')?.addEventListener('click', saveScheduleModal);
    document.getElementById('schedule-modal-delete-btn')?.addEventListener('click', deleteScheduleFromModal);
    document.getElementById('schedule-modal')?.addEventListener('click', (e) => {
        if (e.target.id === 'schedule-modal') closeScheduleModal();
    });

    // Day pill toggles (event-delegated).
    document.getElementById('schedule-modal-days')?.addEventListener('click', (e) => {
        const pill = e.target.closest('.schedule-day-pill');
        if (!pill) return;
        const idx = parseInt(pill.dataset.dayIndex, 10);
        if (scheduleState.modalDays.has(idx)) scheduleState.modalDays.delete(idx);
        else scheduleState.modalDays.add(idx);
        renderScheduleModalDays();
    });

    // Day quick-presets.
    const setDays = (arr) => { scheduleState.modalDays = new Set(arr); renderScheduleModalDays(); };
    document.getElementById('schedule-modal-days-weekdays')?.addEventListener('click', () => setDays([1, 2, 3, 4, 5]));
    document.getElementById('schedule-modal-days-weekends')?.addEventListener('click', () => setDays([0, 6]));
    document.getElementById('schedule-modal-days-everyday')?.addEventListener('click', () => setDays([0, 1, 2, 3, 4, 5, 6]));
    document.getElementById('schedule-modal-days-clear')?.addEventListener('click', () => setDays([]));

    // Initial render with seeded data, then async refresh to grab the "next" calculation.
    renderScheduleList();
    reloadSchedule();
}

// ---------------------------------------------------------------------------
// Settings panel
// ---------------------------------------------------------------------------
// Initialized once on DOMContentLoaded. Each section reads its current state
// from a dedicated IPC and binds change handlers that immediately persist.
// The updater section also subscribes to the live 'updater-event' stream so
// progress (checking / downloading-NN% / downloaded) is reflected in real time.

let settingsUpdaterSubscribed = false;

function setUpdaterPill(label, kind = 'mute') {
    const pill = document.getElementById('settings-updater-pill');
    if (!pill) return;
    pill.textContent = label;
    pill.className = `chip chip-${kind}`;
}

function setUpdaterStatus(text) {
    const el = document.getElementById('settings-updater-status');
    if (el) el.textContent = text;
}

function showInstallUpdateButton(version) {
    const btn = document.getElementById('settings-install-update-btn');
    if (!btn) return;
    btn.classList.remove('hidden');
    btn.textContent = version ? `Restart & install v${version}` : 'Restart & install update';
}

function hideInstallUpdateButton() {
    document.getElementById('settings-install-update-btn')?.classList.add('hidden');
}

async function refreshUpdaterCard() {
    try {
        const s = await window.electronAPI.updaterGetStatus();
        const verEl = document.getElementById('settings-current-version');
        const aboutVerEl = document.getElementById('settings-about-version');
        const v = s?.currentVersion || '—';
        if (verEl) verEl.textContent = `v${v}`;
        if (aboutVerEl) aboutVerEl.textContent = `v${v}`;

        if (!s?.installed) {
            setUpdaterPill('Updater module missing', 'bad');
            setUpdaterStatus('electron-updater is not installed in this build.');
            return;
        }
        if (!s?.packaged) {
            setUpdaterPill('Dev mode', 'mute');
            setUpdaterStatus('Updates only run in packaged installer builds, not under `npm start`.');
            return;
        }
        if (s?.pendingUpdate) {
            setUpdaterPill('Update ready', 'accent');
            setUpdaterStatus(`v${s.pendingUpdate.version} downloaded. Click Restart & install when you're ready.`);
            showInstallUpdateButton(s.pendingUpdate.version);
        } else {
            setUpdaterPill('Up to date', 'good');
            setUpdaterStatus('No update pending. Auto-check runs every 6 hours.');
            hideInstallUpdateButton();
        }
    } catch (e) {
        setUpdaterPill('Status unknown', 'mute');
        setUpdaterStatus(`Could not query updater: ${e?.message || e}`);
    }
}

function handleUpdaterEvent(payload) {
    if (!payload || typeof payload !== 'object') return;
    switch (payload.type) {
        case 'checking':
            setUpdaterPill('Checking…', 'mute');
            setUpdaterStatus('Contacting GitHub Releases…');
            break;
        case 'available':
            setUpdaterPill('Downloading', 'accent');
            setUpdaterStatus(`v${payload.version || '?'} is available. Downloading in background…`);
            break;
        case 'downloading': {
            const pct = typeof payload.percent === 'number' ? payload.percent : 0;
            setUpdaterPill(`${pct}%`, 'accent');
            const kbps = payload.bytesPerSecond ? `${Math.round(payload.bytesPerSecond / 1024)} KB/s` : '';
            setUpdaterStatus(`Downloading… ${pct}%${kbps ? ` (${kbps})` : ''}`);
            break;
        }
        case 'downloaded':
            setUpdaterPill('Update ready', 'accent');
            setUpdaterStatus(`v${payload.version || '?'} downloaded. Click Restart & install when you're ready.`);
            showInstallUpdateButton(payload.version);
            break;
        case 'up-to-date':
            setUpdaterPill('Up to date', 'good');
            setUpdaterStatus(`No update pending. Auto-check runs every 6 hours.`);
            hideInstallUpdateButton();
            break;
        case 'error':
            setUpdaterPill('Error', 'bad');
            setUpdaterStatus(`Updater error: ${payload.message || 'unknown'}`);
            break;
    }
}

async function initSettingsUpdaterSection() {
    if (!settingsUpdaterSubscribed && window.electronAPI?.onUpdaterEvent) {
        window.electronAPI.onUpdaterEvent(handleUpdaterEvent);
        settingsUpdaterSubscribed = true;
    }
    await refreshUpdaterCard();

    document.getElementById('settings-check-update-btn')?.addEventListener('click', async () => {
        setUpdaterPill('Checking…', 'mute');
        setUpdaterStatus('Contacting GitHub Releases…');
        try {
            const r = await window.electronAPI.updaterCheckNow();
            if (!r?.success) {
                const friendly = r?.error === 'dev_mode'
                    ? 'Updates only run in packaged installer builds.'
                    : r?.error === 'updater_not_installed'
                        ? 'electron-updater is not installed in this build.'
                        : `Check failed: ${r?.error || 'unknown'}`;
                setUpdaterPill('Check failed', 'bad');
                setUpdaterStatus(friendly);
            }
            // Any actual success/up-to-date/available state will arrive via onUpdaterEvent.
        } catch (e) {
            setUpdaterPill('Check failed', 'bad');
            setUpdaterStatus(`Check threw: ${e?.message || e}`);
        }
    });

    document.getElementById('settings-install-update-btn')?.addEventListener('click', async () => {
        const r = await window.electronAPI.updaterInstallNow();
        if (!r?.success) {
            setUpdaterPill('Install failed', 'bad');
            setUpdaterStatus(`Could not install: ${r?.error || 'unknown'}`);
        }
        // On success the app quits and the installer takes over — no further UI to render.
    });
}

async function initSettingsStartupSection() {
    const toggle = document.getElementById('settings-startup-toggle');
    const hint = document.getElementById('settings-startup-hint');
    if (!toggle) return;

    const refresh = async () => {
        try {
            const s = await window.electronAPI.startupGet();
            toggle.checked = !!s?.openAtLogin;
            toggle.disabled = !s?.canModify;
            if (!s?.canModify) {
                hint.textContent = s?.reason === 'dev_mode'
                    ? "Startup toggle is read-only in dev mode (npm start). Run the installed build to change."
                    : `Unable to manage startup item: ${s?.error || 'unknown'}`;
                hint.style.color = 'var(--warn)';
            } else {
                hint.textContent = '\u00a0';
                hint.style.color = 'var(--ink-3)';
            }
        } catch (e) {
            hint.textContent = `Could not read startup state: ${e?.message || e}`;
            hint.style.color = 'var(--bad)';
        }
    };

    toggle.addEventListener('change', async () => {
        const want = toggle.checked;
        const r = await window.electronAPI.startupSet(want);
        if (!r?.success) {
            toggle.checked = !want; // revert
            hint.textContent = `Failed to update startup: ${r?.error || 'unknown'}`;
            hint.style.color = 'var(--bad)';
        } else {
            hint.textContent = want ? 'Will launch minimized at next sign-in.' : 'Will not auto-launch.';
            hint.style.color = 'var(--good)';
            setTimeout(() => { hint.textContent = '\u00a0'; hint.style.color = 'var(--ink-3)'; }, 4000);
        }
    });

    await refresh();
}

async function initSettingsHudSection() {
    const visibleEl = document.getElementById('settings-hud-visible');
    const autoEl = document.getElementById('settings-hud-autohide');
    const ctEl = document.getElementById('settings-hud-clickthrough');
    if (!visibleEl || !autoEl || !ctEl) return;

    try {
        const cfg = await window.electronAPI.hudGetConfig();
        visibleEl.checked = !!cfg.visible;
        autoEl.checked = !!cfg.autoHideFullscreen;
        ctEl.checked = !!cfg.clickThrough;
    } catch (e) {
        console.error('HUD config read failed:', e);
    }

    visibleEl.addEventListener('change', async () => {
        if (visibleEl.checked) await window.electronAPI.hudShow();
        else await window.electronAPI.hudHide();
        await window.electronAPI.hudSetConfig({ visible: visibleEl.checked });
    });
    autoEl.addEventListener('change', async () => {
        await window.electronAPI.hudSetConfig({ autoHideFullscreen: autoEl.checked });
    });
    ctEl.addEventListener('change', async () => {
        await window.electronAPI.hudSetConfig({ clickThrough: ctEl.checked });
    });
}

async function refreshSettingsPanel() {
    // Lightweight refresh when the user clicks the Settings tab — re-pulls
    // current updater status (in case auto-check happened in the background)
    // and updates the visible state of HUD toggles. Startup and Reports are
    // already initialized once at boot and stay in sync via their own
    // change handlers.
    await refreshUpdaterCard();
    // HUD config can drift if the user toggled it via the tray menu.
    try {
        const cfg = await window.electronAPI.hudGetConfig();
        const v = document.getElementById('settings-hud-visible');
        const a = document.getElementById('settings-hud-autohide');
        const c = document.getElementById('settings-hud-clickthrough');
        if (v) v.checked = !!cfg.visible;
        if (a) a.checked = !!cfg.autoHideFullscreen;
        if (c) c.checked = !!cfg.clickThrough;
    } catch (_) {}
    // Reports panel timestamps refresh
    await refreshReportSettings();
}

async function initSettingsFrictionSection() {
    const el = document.getElementById('settings-friction-enabled');
    if (!el) return;
    try {
        const cfg = await window.electronAPI.getProgressiveFrictionConfig();
        el.checked = cfg.enabled !== false;
    } catch (e) {
        console.error('initSettingsFrictionSection:', e);
        el.checked = true;
    }
    el.addEventListener('change', async () => {
        try {
            await window.electronAPI.setProgressiveFrictionConfig({ enabled: el.checked });
        } catch (e) {
            console.error('friction toggle save failed:', e);
            // Revert UI if save failed.
            el.checked = !el.checked;
        }
    });
}

async function initSettingsPanel() {
    await initSettingsUpdaterSection();
    await initSettingsStartupSection();
    await initSettingsHudSection();
    await initSettingsFrictionSection();
    await initSettingsPhonePanel();
}

// ---------------------------------------------------------------------------
// Phone Data settings panel (v1.7.0)
// ---------------------------------------------------------------------------
// Wires the Settings -> Phone usage data section: source picker (CSV only
// today), folder-pick + import button, status line, re-import button, and
// destructive "Clear all" with confirmation. Status refreshes the Insights
// scope toggle so newly-imported data immediately enables Phone / Both.

async function initSettingsPhonePanel() {
    const pickBtn = document.getElementById('phone-pick-folder-btn');
    const reimportBtn = document.getElementById('phone-reimport-btn');
    const clearBtn = document.getElementById('phone-clear-btn');
    const statusLine = document.getElementById('phone-status-line');
    const statusFolder = document.getElementById('phone-status-folder');
    const importStatus = document.getElementById('phone-import-status');
    if (!pickBtn) return;

    // v1.8.0: wire the weekly export reminder controls. Idempotent — safe
    // to call multiple times (we guard inside).
    await initPhoneReminderControls();

    const refresh = async () => {
        try {
            const s = await window.electronAPI.phoneGetStatus();
            renderPhoneStatus(s);
            updateInsightsScopeAvailability(s);
        } catch (e) {
            console.error('phone status refresh failed:', e);
        }
    };

    function renderPhoneStatus(s) {
        if (!s.hasData) {
            statusLine.textContent = 'No phone data imported yet.';
            statusFolder.classList.add('hidden');
            reimportBtn.classList.add('hidden');
            clearBtn.classList.add('hidden');
            return;
        }
        const importedAt = s.lastImportedAt ? new Date(s.lastImportedAt).toLocaleString() : 'unknown';
        statusLine.innerHTML = `<span style="color: var(--ink);">${s.daysCount} day${s.daysCount === 1 ? '' : 's'}</span> of phone data &middot; ` +
            `<span class="num">${s.oldestDate} &rarr; ${s.newestDate}</span> &middot; ` +
            `source: <span style="color: var(--ink);">${s.sourceLabel || s.source}</span> &middot; ` +
            `imported ${importedAt}`;
        if (s.lastImportFolder) {
            statusFolder.textContent = s.lastImportFolder;
            statusFolder.classList.remove('hidden');
        } else {
            statusFolder.classList.add('hidden');
        }
        reimportBtn.classList.remove('hidden');
        clearBtn.classList.remove('hidden');
    }

    async function doImport(folderPath) {
        if (!folderPath) return;
        importStatus.textContent = 'Importing...';
        importStatus.style.color = 'var(--ink-3)';
        try {
            const r = await window.electronAPI.phoneImportFolder(folderPath);
            if (!r.success) {
                importStatus.textContent = `Import failed: ${r.error || 'unknown error'}`;
                importStatus.style.color = 'var(--danger)';
                return;
            }
            const warn = (r.warnings || []).length ? ` (${r.warnings.length} warning${r.warnings.length === 1 ? '' : 's'})` : '';
            importStatus.textContent = `Imported. ${r.daysImported} new day${r.daysImported === 1 ? '' : 's'}, ${r.daysReplaced} replaced. Total: ${r.totalDays}.${warn}`;
            importStatus.style.color = 'var(--success)';
            await refresh();
        } catch (e) {
            importStatus.textContent = `Import error: ${e?.message || e}`;
            importStatus.style.color = 'var(--danger)';
        }
    }

    pickBtn.addEventListener('click', async () => {
        const pick = await window.electronAPI.phonePickFolder();
        if (pick.canceled) return;
        await doImport(pick.folderPath);
    });

    reimportBtn.addEventListener('click', async () => {
        const s = await window.electronAPI.phoneGetStatus();
        if (!s.lastImportFolder) {
            importStatus.textContent = 'No last-used folder remembered. Use "Pick folder & import" instead.';
            importStatus.style.color = 'var(--warn)';
            return;
        }
        await doImport(s.lastImportFolder);
    });

    clearBtn.addEventListener('click', async () => {
        if (!confirm('Wipe ALL imported phone data? This cannot be undone.')) return;
        if (!confirm('Final confirmation: remove every imported phone day?')) return;
        try {
            await window.electronAPI.phoneClearAll();
            importStatus.textContent = 'Phone data cleared.';
            importStatus.style.color = 'var(--ink-3)';
            await refresh();
        } catch (e) {
            importStatus.textContent = `Clear failed: ${e?.message || e}`;
            importStatus.style.color = 'var(--danger)';
        }
    });

    await refresh();
}

// ---------------------------------------------------------------------------
// Phone export reminder controls (v1.8.0)
// ---------------------------------------------------------------------------
// Settings -> Phone usage data -> Weekly export reminder. Lets the user pick
// day-of-week + hour-of-day for a desktop notification reminding them to
// export StayFree CSVs from their phone. Persists via IPC.
async function initPhoneReminderControls() {
    const enabled = document.getElementById('phone-reminder-enabled');
    const daySel = document.getElementById('phone-reminder-day');
    const hourSel = document.getElementById('phone-reminder-hour');
    const testBtn = document.getElementById('phone-reminder-test-btn');
    const statusEl = document.getElementById('phone-reminder-status');
    if (!enabled || !daySel || !hourSel) return;

    // Populate hour dropdown 0..23 with 12-hour-format labels for readability.
    if (hourSel.options.length === 0) {
        for (let h = 0; h < 24; h++) {
            const opt = document.createElement('option');
            opt.value = String(h);
            const hr12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
            const ampm = h < 12 ? 'AM' : 'PM';
            opt.textContent = `${String(h).padStart(2, '0')}:00 (${hr12} ${ampm})`;
            hourSel.appendChild(opt);
        }
    }

    const renderStatus = (cfg) => {
        if (!cfg.enabled) {
            statusEl.textContent = 'Reminder is off.';
            return;
        }
        const dayName = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][cfg.dayOfWeek];
        const hour12 = cfg.hour === 0 ? 12 : cfg.hour > 12 ? cfg.hour - 12 : cfg.hour;
        const ampm = cfg.hour < 12 ? 'AM' : 'PM';
        const lastFired = cfg.lastFiredOn ? ` Last fired: ${cfg.lastFiredOn}.` : '';
        statusEl.textContent = `Reminder set for every ${dayName} at ${hour12}:00 ${ampm}.${lastFired}`;
    };

    try {
        const cfg = await window.electronAPI.phoneReminderGet();
        enabled.checked = !!cfg.enabled;
        daySel.value = String(cfg.dayOfWeek);
        hourSel.value = String(cfg.hour);
        renderStatus(cfg);
    } catch (e) {
        console.error('phone-reminder-get failed:', e);
    }

    const persist = async () => {
        try {
            const next = await window.electronAPI.phoneReminderSet({
                enabled: enabled.checked,
                dayOfWeek: parseInt(daySel.value, 10),
                hour: parseInt(hourSel.value, 10),
            });
            renderStatus(next);
        } catch (e) {
            statusEl.textContent = `Failed to save reminder: ${e?.message || e}`;
        }
    };

    if (!initPhoneReminderControls.__wired) {
        enabled.addEventListener('change', persist);
        daySel.addEventListener('change', persist);
        hourSel.addEventListener('change', persist);
        if (testBtn) {
            testBtn.addEventListener('click', async () => {
                statusEl.textContent = 'Firing test reminder...';
                try {
                    const r = await window.electronAPI.phoneReminderTestFire();
                    statusEl.textContent = r.success
                        ? 'Test reminder sent. Check your desktop notifications.'
                        : `Test failed: ${r.error || 'unknown'}`;
                } catch (e) {
                    statusEl.textContent = `Test failed: ${e?.message || e}`;
                }
            });
        }
        initPhoneReminderControls.__wired = true;
    }
}

/**
 * Enable/disable the Insights scope toggle buttons based on whether phone
 * data exists. Called from initSettingsPhonePanel() after any import/clear.
 */
function updateInsightsScopeAvailability(phoneStatus) {
    const phoneBtn = document.getElementById('insights-scope-phone');
    const bothBtn = document.getElementById('insights-scope-both');
    if (!phoneBtn || !bothBtn) return;
    const enabled = !!phoneStatus?.hasData;
    [phoneBtn, bothBtn].forEach(btn => {
        btn.disabled = !enabled;
        btn.style.cursor = enabled ? 'pointer' : 'not-allowed';
        btn.style.color = enabled ? '' : 'var(--ink-3)';
        btn.title = enabled ? '' : 'Import phone data in Settings first';
    });
}

// ---------------------------------------------------------------------------
// Commitment modal (progressive friction)
// ---------------------------------------------------------------------------
//
// Two entrypoints flow through here:
//   1. handleLimitChange (kind='limit-increase')
//   2. handleToggleChange detecting a manual unblock (kind='manual-unblock')
// Both call beginCommitmentFlow(opts) which fetches a tier-scaled payload
// from main and stages the modal. On confirm/cancel, the opts.onConfirm /
// opts.onCancel callbacks fire — keeping the modal agnostic about WHAT
// it's gating.

async function beginCommitmentFlow(opts) {
    let payload;
    try {
        payload = await window.electronAPI.getCommitmentParagraph();
    } catch (e) {
        console.error('Commitment fetch failed; bailing out (treating as cancel):', e);
        if (typeof opts.onCancel === 'function') opts.onCancel();
        return;
    }

    commitmentState = {
        kind: opts.kind,
        siteName: opts.siteName,
        newLimit: opts.newLimit ?? null,
        oldLimit: opts.oldLimit ?? null,
        inputElement: opts.inputElement ?? null,
        toggleElement: opts.toggleElement ?? null,
        requiredText: payload.requiredText || payload.paragraph || '',
        fullParagraph: payload.paragraph || '',
        tier: payload.tier || 1,
        cooldownSeconds: payload.cooldownSeconds || 0,
        cooldownTimer: null,
        onConfirm: opts.onConfirm || (() => {}),
        onCancel:  opts.onCancel  || (() => {}),
        progressiveEnabled: !!payload.progressiveEnabled,
        priorCount: payload.priorCount || 0
    };

    renderCommitmentModal(payload);
    openCommitmentModalUI();
    startCommitmentCooldown();
}

function renderCommitmentModal(payload) {
    const { tier, requiredText, fullParagraph, cooldownSeconds, priorCount, progressiveEnabled } = commitmentState;

    // Tier badge.
    if (progressiveEnabled) {
        commitmentTierBadge.textContent = `Unblock #${priorCount + 1} today \u00b7 Tier ${tier}`;
        commitmentTierBadge.style.color = tier >= 4 ? 'var(--warn)' : 'var(--ink-2)';
        commitmentTierBadge.style.borderColor = tier >= 4 ? 'var(--warn)' : 'var(--line)';
    } else {
        commitmentTierBadge.textContent = 'Full paragraph';
        commitmentTierBadge.style.color = 'var(--ink-2)';
        commitmentTierBadge.style.borderColor = 'var(--line)';
    }

    // Context line varies by entrypoint.
    if (commitmentState.kind === 'manual-unblock') {
        commitmentContext.textContent =
            `Unblocking ${commitmentState.siteName}. Type the text below exactly to proceed.`;
    } else if (commitmentState.kind === 'limit-increase') {
        commitmentContext.textContent =
            `Raising the limit on ${commitmentState.siteName}. Type the text below exactly to proceed.`;
    } else {
        commitmentContext.textContent = 'Type the text below exactly to proceed.';
    }

    // Render required text in normal weight, with the rest of the paragraph
    // faded (so the user can see the full case, but only types the slice).
    const safeReq = requiredText.replace(/</g, '&lt;');
    const remainder = (fullParagraph || '').slice(requiredText.length);
    const safeRem = remainder.replace(/</g, '&lt;');
    if (safeRem && progressiveEnabled && tier < 5) {
        commitmentParagraph.innerHTML =
            `<span style="color: var(--ink);">${safeReq}</span>` +
            `<span style="color: var(--ink-4); opacity: 0.45;">${safeRem}</span>`;
    } else {
        commitmentParagraph.innerHTML = `<span style="color: var(--ink);">${safeReq}</span>`;
    }

    // Cooldown row.
    if (cooldownSeconds > 0) {
        commitmentCooldownRow.classList.remove('hidden');
        commitmentCooldownSeconds.textContent = String(cooldownSeconds);
        commitmentCooldownHint.textContent =
            `Sit with this for ${cooldownSeconds}s before you can type.`;
    } else {
        commitmentCooldownRow.classList.add('hidden');
    }

    commitmentInput.value = '';
    commitmentInput.placeholder = cooldownSeconds > 0 ? 'Waiting for cooldown...' : 'Type the text above exactly';
    commitmentInput.disabled = cooldownSeconds > 0;
    confirmCommitmentBtn.disabled = true;
}

function openCommitmentModalUI() {
    commitmentModal.classList.remove('hidden');
    modalContent.classList.remove('scale-95', 'opacity-0');
}

function startCommitmentCooldown() {
    if (commitmentState.cooldownTimer) {
        clearInterval(commitmentState.cooldownTimer);
        commitmentState.cooldownTimer = null;
    }
    if (!(commitmentState.cooldownSeconds > 0)) return;

    let remaining = commitmentState.cooldownSeconds;
    commitmentCooldownSeconds.textContent = String(remaining);
    commitmentState.cooldownTimer = setInterval(() => {
        remaining -= 1;
        if (remaining <= 0) {
            clearInterval(commitmentState.cooldownTimer);
            commitmentState.cooldownTimer = null;
            commitmentCooldownRow.classList.add('hidden');
            commitmentInput.disabled = false;
            commitmentInput.placeholder = 'Type the text above exactly';
            commitmentInput.focus();
            validateCommitmentInput();
        } else {
            commitmentCooldownSeconds.textContent = String(remaining);
        }
    }, 1000);
}

function closeCommitmentModal(viaCancel = true) {
    if (commitmentState.cooldownTimer) {
        clearInterval(commitmentState.cooldownTimer);
        commitmentState.cooldownTimer = null;
    }
    if (viaCancel && typeof commitmentState.onCancel === 'function') {
        try { commitmentState.onCancel(); } catch (e) { console.error('Commitment cancel cb:', e); }
    }
    modalContent.classList.add('scale-95', 'opacity-0');
    setTimeout(() => commitmentModal.classList.add('hidden'), 150);
}

function validateCommitmentInput() {
    confirmCommitmentBtn.disabled =
        commitmentInput.disabled ||
        commitmentInput.value !== commitmentState.requiredText;
}

async function confirmCommitment() {
    if (confirmCommitmentBtn.disabled) return;
    const cb = commitmentState.onConfirm;
    closeCommitmentModal(/* viaCancel */ false);
    if (typeof cb === 'function') {
        try { await cb(); } catch (e) { console.error('Commitment confirm cb:', e); }
    }
}
