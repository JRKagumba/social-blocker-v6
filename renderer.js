// renderer.js - Frontend JavaScript for Social Blocker v6

// --- Element References ---
const blockedSitesList = document.getElementById('blocked-sites-list');
const statusIndicator = document.getElementById('status-indicator');
const nuclearOptionBtn = document.getElementById('nuclear-option-btn');
const deepWorkBtn = document.getElementById('deep-work-btn');
const deepWorkDurationSelect = document.getElementById('deep-work-duration');
const deepWorkBanner = document.getElementById('deep-work-banner');
const deepWorkTimer = document.getElementById('deep-work-timer');
const statusText = document.getElementById('blocker-status-text');
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
const adherenceChartCanvas = document.getElementById('adherence-chart');
const heatMapContainer = document.getElementById('heat-map-container');
const heatMapDaysSelect = document.getElementById('heat-map-days');
const adherenceDaysSelect = document.getElementById('adherence-days');
const commitmentModal = document.getElementById('commitment-modal');
const modalContent = document.getElementById('modal-content');
const commitmentParagraph = document.getElementById('commitment-paragraph');
const commitmentInput = document.getElementById('commitment-input');
const cancelCommitmentBtn = document.getElementById('cancel-commitment-btn');
const confirmCommitmentBtn = document.getElementById('confirm-commitment-btn');

// --- State Variables ---
let siteSettings = {};
let historyChartInstance = null;
let adherenceChartInstance = null;
let commitmentState = { siteName: null, newLimit: 0, oldLimit: 0, inputElement: null };

// --- Initialization ---
window.addEventListener('DOMContentLoaded', async () => {
    const initialData = await window.electronAPI.getInitialData();
    if (initialData.success) {
        siteSettings = initialData.siteSettings;
        renderSiteList(initialData.blockedDomains, initialData.usageData);
        updateMasterStatusText();
        updateDeepWorkUI(initialData.deepWork);
        await renderHistoryChart();
    }
    setupEventListeners();
    showTab('dashboard');
});

// --- Real-time Listeners ---
window.electronAPI.onUsageUpdate(handleUsageUpdate);
window.electronAPI.onDeepWorkUpdate(updateDeepWorkUI);

// --- UI Rendering & State Updates ---
function renderSiteList(blockedDomains, usageData) {
    blockedSitesList.innerHTML = '';
    Object.values(siteSettings).forEach(site => {
        const li = document.createElement('li');
        li.className = 'p-6 bg-gray-700/60 backdrop-blur-sm rounded-xl border border-gray-600/50 flex items-center justify-between shadow-lg hover:shadow-xl transition-all duration-200';
        const isManuallyBlocked = site.domains.some(domain => blockedDomains.includes(domain));
        const usageToday = usageData[site.name] || 0;
        const usageInMinutes = (parseFloat(usageToday) / 60).toFixed(1);
        const isLimitReached = site.limit > 0 && usageInMinutes >= site.limit;
        const isBlocked = isManuallyBlocked || isLimitReached;

        li.innerHTML = `
            <div class="flex flex-col">
                <span class="text-lg font-semibold">${site.name}</span>
                <div class="text-xs text-gray-400 mt-1 flex items-center">
                    <span>Usage:</span> 
                    <span class="usage-text font-mono mx-1" data-site-name="${site.name}">${usageInMinutes} /</span>
                    <input type="number" value="${site.limit}" min="0" class="limit-input bg-gray-800 text-white w-12 text-center rounded focus:outline-none focus:ring-2 focus:ring-cyan-500" data-site-name="${site.name}" data-old-value="${site.limit}">
                    <span class="ml-1">mins</span>
                </div>
            </div>
            <label class="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" id="toggle-${site.name}" class="sr-only peer individual-toggle" data-site-name="${site.name}" ${isBlocked ? 'checked' : ''} ${isLimitReached ? 'disabled' : ''}>
                <div class="w-14 h-8 toggle-bg rounded-full"></div>
                <div class="toggle-dot absolute top-1 left-1 h-6 w-6 rounded-full transition-transform"></div>
            </label>
        `;
        blockedSitesList.appendChild(li);
    });
}

async function renderHistoryChart() {
    const historyData = await window.electronAPI.getHistory();
    if (!historyData) return;
    if (historyChartInstance) historyChartInstance.destroy();
    historyChartInstance = new Chart(chartCanvas.getContext('2d'), { 
        type: 'bar', 
        data: { 
            labels: historyData.labels, 
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

async function renderDataTab() {
    await Promise.all([renderHeatMap(), renderAdherenceChart()]);
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
        const date = new Date(dayData.date);
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

async function renderAdherenceChart() {
    const days = parseInt(adherenceDaysSelect.value);
    const adherenceData = await window.electronAPI.getAdherenceData(days);
    
    if (!adherenceData || adherenceData.length === 0) {
        if (adherenceChartInstance) adherenceChartInstance.destroy();
        adherenceChartInstance = null;
        return;
    }
    
    if (adherenceChartInstance) adherenceChartInstance.destroy();
    
    const labels = adherenceData.map(d => {
        const date = new Date(d.date);
        return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    });
    
    const data = adherenceData.map(d => d.adherenceRate);
    const backgroundColors = data.map(rate => {
        if (rate >= 90) return 'rgba(34, 197, 94, 0.8)'; // Green
        if (rate >= 70) return 'rgba(251, 191, 36, 0.8)'; // Yellow
        return 'rgba(239, 68, 68, 0.8)'; // Red
    });
    
    adherenceChartInstance = new Chart(adherenceChartCanvas.getContext('2d'), {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Adherence Rate (%)',
                data: data,
                backgroundColor: backgroundColors,
                borderColor: backgroundColors.map(color => color.replace('0.8', '1')),
                borderWidth: 1,
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            scales: {
                y: {
                    beginAtZero: true,
                    max: 100,
                    ticks: {
                        color: '#9CA3AF',
                        callback: function(value) {
                            return value + '%';
                        }
                    },
                    grid: {
                        color: '#4B5563'
                    }
                },
                x: {
                    ticks: {
                        color: '#9CA3AF'
                    },
                    grid: {
                        color: 'transparent'
                    }
                }
            },
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    callbacks: {
                        afterLabel: function(context) {
                            const index = context.dataIndex;
                            const dayData = adherenceData[index];
                            return [
                                `Within limit: ${dayData.withinLimit}/${dayData.totalSites} sites`,
                                `Perfect day: ${dayData.adherenceRate === 100 ? 'Yes' : 'No'}`
                            ];
                        }
                    }
                }
            }
        }
    });
}

// --- Event Listeners Setup ---
function setupEventListeners() {
    blockedSitesList.addEventListener('change', (e) => { 
        if (e.target.classList.contains('individual-toggle')) applyChanges(); 
    });
    blockedSitesList.addEventListener('focusout', (e) => { 
        if (e.target.classList.contains('limit-input')) handleLimitChange(e.target); 
    });
            nuclearOptionBtn.addEventListener('click', () => { 
                document.querySelectorAll('.individual-toggle').forEach(t => { 
                    t.checked = true; 
                    t.disabled = true; 
                }); 
                applyChanges(); 
            });
            deepWorkBtn.addEventListener('click', () => { 
                const minutes = parseInt(deepWorkDurationSelect.value, 10);
                if (isNaN(minutes) || minutes < 1 || minutes > 480) {
                    alert('Please enter a valid number of minutes between 1 and 480.');
                    return;
                }
                const seconds = minutes * 60;
                window.electronAPI.startDeepWork(seconds); 
            });
            
            // Make deep work input more user-friendly for typing
            deepWorkDurationSelect.addEventListener('focus', () => {
                deepWorkDurationSelect.select(); // Select all text when focused
            });
            
            deepWorkDurationSelect.addEventListener('click', () => {
                deepWorkDurationSelect.select(); // Select all text when clicked
            });
    tabs.dashboard.addEventListener('click', () => showTab('dashboard'));
    tabs.history.addEventListener('click', async () => { 
        await renderHistoryChart(); 
        showTab('history'); 
    });
    tabs.data.addEventListener('click', async () => { 
        await renderDataTab(); 
        showTab('data'); 
    });
    heatMapDaysSelect.addEventListener('change', () => renderHeatMap());
    adherenceDaysSelect.addEventListener('change', () => renderAdherenceChart());
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
            
            try {
                const result = await window.electronAPI.updateHostsFile(sitesToBlock);
                if (result.success) {
                    statusIndicator.textContent = '(Success!)';
                    updateMasterStatusText();
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
