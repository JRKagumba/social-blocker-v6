// hudRenderer.js — Receives live updates from main and renders the HUD bars.

let siteSettings = {};
let lastUsage = {};

function shortName(name) {
    // Trim long site names down to fit the 54px column.
    const map = { 'Twitter/X': 'Twitter', 'LinkedIn': 'LinkedIn' };
    if (map[name]) return map[name];
    return name.length > 9 ? name.slice(0, 9) + '…' : name;
}

function fmtTotal(seconds) {
    const m = Math.round((seconds || 0) / 60);
    if (m < 60) return `${m}m today`;
    return `${Math.floor(m / 60)}h ${m % 60}m today`;
}

function buildRows() {
    const container = document.getElementById('hud-rows');
    const empty = document.getElementById('hud-empty');
    if (!container) return;

    // Only render sites with usage > 0 today (per Recommendation #1).
    const entries = Object.entries(siteSettings)
        .map(([name, cfg]) => {
            const secs = typeof lastUsage[name] === 'number' ? lastUsage[name] : 0;
            return { name, secs, limit: typeof cfg?.limit === 'number' ? cfg.limit : 0 };
        })
        .filter(e => e.secs > 0)
        .sort((a, b) => b.secs - a.secs);

    if (!entries.length) {
        container.innerHTML = '<div class="empty">No tracked activity yet today.</div>';
        return;
    }

    // Show top 5, then "+N more" footer-row if there are extras.
    const top = entries.slice(0, 5);
    const more = entries.length - top.length;

    container.innerHTML = top.map(e => {
        const minutes = Math.round(e.secs / 60);
        const pct = e.limit > 0 ? Math.min(100, (minutes / e.limit) * 100) : 0;
        const cls = e.limit > 0 && minutes >= e.limit ? 'over' :
                    e.limit > 0 && minutes >= e.limit * 0.75 ? 'warn' : '';
        const numText = e.limit > 0 ? `${minutes}/${e.limit}` : `${minutes}m`;
        return `
            <div class="row ${cls}">
                <span class="name" title="${e.name}">${shortName(e.name)}</span>
                <span class="bar-track"><span class="bar" style="width:${pct}%"></span></span>
                <span class="num">${numText}</span>
            </div>`;
    }).join('') + (more > 0
        ? `<div class="row idle" style="opacity:0.6;"><span class="name">…</span><span class="bar-track"></span><span class="num">+${more} more</span></div>`
        : '');

    // Update total.
    const totalSecs = entries.reduce((s, e) => s + e.secs, 0);
    const totalEl = document.getElementById('hud-total');
    if (totalEl) totalEl.textContent = fmtTotal(totalSecs);
}

function applyDeepWork(dw) {
    const footer = document.getElementById('hud-deepwork');
    const timeEl = document.getElementById('hud-dw-time');
    if (!footer) return;
    if (dw && dw.isActive && typeof dw.remainingMs === 'number' && dw.remainingMs > 0) {
        const mins = Math.floor(dw.remainingMs / 60000);
        const h = Math.floor(mins / 60);
        const m = mins % 60;
        if (timeEl) timeEl.textContent = h > 0 ? `${h}h ${m}m left` : `${m}m left`;
        footer.classList.remove('hidden');
    } else {
        footer.classList.add('hidden');
    }
}

// Wire up listeners.
window.hudAPI.onUsageUpdate((payload) => {
    lastUsage = payload || {};
    buildRows();
});

window.hudAPI.onDeepWorkUpdate((payload) => {
    applyDeepWork(payload);
});

window.hudAPI.onSiteSettingsUpdate((payload) => {
    siteSettings = payload || {};
    buildRows();
});

document.getElementById('close-hud')?.addEventListener('click', () => {
    window.hudAPI.hide();
});

// Double-click on the HUD opens the main dashboard.
document.getElementById('hud')?.addEventListener('dblclick', (e) => {
    if (e.target.id === 'close-hud') return;
    window.hudAPI.openMainWindow();
});

// Initial state hydration.
(async () => {
    try {
        const initial = await window.hudAPI.getInitialState();
        if (initial) {
            siteSettings = initial.siteSettings || {};
            lastUsage = initial.usageData || {};
            applyDeepWork(initial.deepWork);
            buildRows();
        }
    } catch (e) {
        console.error('HUD: initial state fetch failed:', e);
    }
})();
