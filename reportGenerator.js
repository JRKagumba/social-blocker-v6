// reportGenerator.js — Builds self-contained HTML usage digests (weekly / monthly).
// Writes to the user-configured target folder (default: G:\My Drive\Social Blocker\reports).
// No network, no credentials, fully local. Future: merges Pixel 8 data via UsageStatsManager export.

const fs = require('fs');
const path = require('path');

class ReportGenerator {
    constructor(dataManager) {
        this.dataManager = dataManager;
    }

    // ---------- DATE / WEEK HELPERS ----------

    pad(n) { return String(n).padStart(2, '0'); }

    toISODate(date) {
        return `${date.getFullYear()}-${this.pad(date.getMonth() + 1)}-${this.pad(date.getDate())}`;
    }

    /** ISO 8601 week number — Thursday in current week determines the year. */
    getISOWeek(date) {
        const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
        const dayNum = d.getUTCDay() || 7;
        d.setUTCDate(d.getUTCDate() + 4 - dayNum);
        const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
        const weekNum = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
        return { year: d.getUTCFullYear(), week: weekNum };
    }

    /** Monday of the local week containing `date`. */
    startOfISOWeek(date) {
        const d = new Date(date);
        const day = d.getDay() || 7;
        if (day !== 1) d.setDate(d.getDate() - (day - 1));
        d.setHours(0, 0, 0, 0);
        return d;
    }

    daysInRange(startDate, endDate) {
        const days = [];
        const cur = new Date(startDate);
        while (cur <= endDate) {
            days.push(this.toISODate(cur));
            cur.setDate(cur.getDate() + 1);
        }
        return days;
    }

    // ---------- DATA AGGREGATION ----------

    /** Sum usage per site over the given date list. Returns { siteName: seconds }. */
    aggregateUsage(dateList) {
        const totals = {};
        for (const day of dateList) {
            const dayUsage = this.dataManager.store.get(`usage.${day}`, {});
            if (!dayUsage || typeof dayUsage !== 'object') continue;
            for (const [site, secs] of Object.entries(dayUsage)) {
                const n = typeof secs === 'number' ? secs : parseFloat(secs) || 0;
                totals[site] = (totals[site] || 0) + n;
            }
        }
        return totals;
    }

    aggregateDailyTotals(dateList) {
        return dateList.map(day => {
            const dayUsage = this.dataManager.store.get(`usage.${day}`, {});
            let secs = 0;
            for (const v of Object.values(dayUsage || {})) {
                secs += typeof v === 'number' ? v : (parseFloat(v) || 0);
            }
            return { day, seconds: secs };
        });
    }

    countEventsInRange(events, startISO, endISO, filterFn = null) {
        if (!Array.isArray(events)) return 0;
        let count = 0;
        for (const e of events) {
            const day = (e.timestamp || '').split('T')[0];
            if (day >= startISO && day <= endISO) {
                if (!filterFn || filterFn(e)) count++;
            }
        }
        return count;
    }

    computeAdherence(dateList, siteSettings) {
        let daysAdherent = 0;
        for (const day of dateList) {
            const dayUsage = this.dataManager.store.get(`usage.${day}`, {});
            let allWithinLimit = true;
            for (const [siteName, cfg] of Object.entries(siteSettings)) {
                if (!cfg || typeof cfg.limit !== 'number' || cfg.limit <= 0) continue;
                const secs = dayUsage[siteName] || 0;
                const minutes = (typeof secs === 'number' ? secs : 0) / 60;
                if (minutes > cfg.limit) { allWithinLimit = false; break; }
            }
            if (allWithinLimit) daysAdherent++;
        }
        return { daysAdherent, totalDays: dateList.length };
    }

    // ---------- HTML BUILDING ----------

    formatMinutes(seconds) {
        const m = Math.round((seconds || 0) / 60);
        if (m < 60) return `${m}m`;
        return `${Math.floor(m / 60)}h ${m % 60}m`;
    }

    escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, c => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[c]));
    }

    buildHtml({ title, subtitle, dateList, period }) {
        const siteSettings = this.dataManager.getSiteSettings();
        const usageTotals = this.aggregateUsage(dateList);
        const dailyTotals = this.aggregateDailyTotals(dateList);
        const adherence = this.computeAdherence(dateList, siteSettings);

        const startISO = dateList[0];
        const endISO = dateList[dateList.length - 1];

        const unblockEvents = this.dataManager.store.get('unblockHistory', []);
        const tamperEvents = this.dataManager.store.get('hostsTamperEvents', []);
        const manualLockEvents = this.dataManager.store.get('manualLocks', {});

        const totalUnblocks = this.countEventsInRange(unblockEvents, startISO, endISO);
        const totalTampers = this.countEventsInRange(tamperEvents, startISO, endISO,
            e => e.outcome === 'external_mismatch_detected');
        const totalAutoRepairs = this.countEventsInRange(tamperEvents, startISO, endISO,
            e => e.source === 'watchdog_auto_repair' || e.source === 'user_repair');

        // Per-day max for bar scaling.
        const maxDaySecs = Math.max(60, ...dailyTotals.map(d => d.seconds));

        // Total seconds across the period.
        const grandTotalSecs = Object.values(usageTotals).reduce((s, v) => s + v, 0);

        // Per-site rows (descending by usage).
        const sortedSites = Object.entries(usageTotals)
            .sort((a, b) => b[1] - a[1]);

        const siteRowsHtml = sortedSites.map(([siteName, secs]) => {
            const cfg = siteSettings[siteName] || {};
            const limitPerDay = (cfg.limit || 0);
            const totalLimit = limitPerDay * dateList.length;
            const minutes = secs / 60;
            const pct = totalLimit > 0 ? Math.min(100, (minutes / totalLimit) * 100) : 0;
            const overBudget = totalLimit > 0 && minutes > totalLimit;
            const barColor = overBudget ? 'background:#ef4444;' :
                             pct > 75 ? 'background:#f59e0b;' : 'background:#06b6d4;';
            const noteColor = overBudget ? 'color:#fca5a5;' :
                              pct > 75 ? 'color:#fcd34d;' : 'color:#cbd5e1;';
            const note = totalLimit > 0
                ? `${this.formatMinutes(secs)} / ${totalLimit}m budget (${Math.round(pct)}%)`
                : `${this.formatMinutes(secs)} (no limit set)`;
            return `
                <div>
                  <div style="display:flex;justify-content:space-between;font-size:14px;align-items:baseline;">
                    <span style="font-weight:600;">${this.escapeHtml(siteName)}</span>
                    <span style="font-family:ui-monospace,monospace;${noteColor}">${this.escapeHtml(note)}</span>
                  </div>
                  <div style="height:8px;background:#0f172a;border-radius:9999px;margin-top:8px;overflow:hidden;">
                    <div style="height:100%;${barColor}width:${pct}%;"></div>
                  </div>
                </div>`;
        }).join('\n');

        const dailyBarsHtml = dailyTotals.map(d => {
            const heightPct = Math.round((d.seconds / maxDaySecs) * 100);
            const label = new Date(d.day).toLocaleDateString('en-US', { weekday: 'short' });
            const mins = Math.round(d.seconds / 60);
            const dailyLimitTotal = Object.values(siteSettings).reduce((s, c) => s + (c.limit || 0), 0);
            const overDaily = dailyLimitTotal > 0 && mins > dailyLimitTotal;
            const barColor = overDaily ? '#ef4444' : (mins > dailyLimitTotal * 0.75 ? '#f59e0b' : '#06b6d4');
            return `
                <div style="display:flex;flex-direction:column;align-items:center;gap:6px;">
                  <div style="width:100%;background:${barColor};border-radius:4px 4px 0 0;height:${heightPct}%;min-height:2px;"></div>
                  <span style="font-size:11px;color:#94a3b8;">${this.escapeHtml(label)}</span>
                  <span style="font-size:12px;font-family:ui-monospace,monospace;color:#cbd5e1;">${mins}m</span>
                </div>`;
        }).join('\n');

        // Insight: largest-overage site + best day.
        let insight = '';
        const overages = sortedSites
            .map(([name, s]) => {
                const cfg = siteSettings[name];
                const limit = (cfg?.limit || 0) * dateList.length;
                if (limit <= 0) return null;
                const overMin = Math.round((s / 60) - limit);
                return overMin > 0 ? { name, overMin } : null;
            })
            .filter(Boolean)
            .sort((a, b) => b.overMin - a.overMin);
        if (overages.length) {
            const worst = overages[0];
            const bestDay = dailyTotals.reduce((best, d) =>
                (!best || d.seconds < best.seconds) ? d : best, null);
            const bestDayLabel = bestDay
                ? new Date(bestDay.day).toLocaleDateString('en-US', { weekday: 'long' })
                : '';
            insight = `You exceeded your <strong>${this.escapeHtml(worst.name)}</strong> budget by ${worst.overMin} minutes this ${period}. ` +
                      `Your strongest day was <strong>${this.escapeHtml(bestDayLabel)}</strong> ` +
                      `(${Math.round(bestDay.seconds / 60)}m total). ` +
                      `Consider locking ${this.escapeHtml(worst.name)} for the day when you've already hit your budget by noon.`;
        } else {
            insight = `Strong week. You stayed within budget on every site you've configured. Keep it up.`;
        }

        const adherencePct = adherence.totalDays > 0
            ? Math.round((adherence.daysAdherent / adherence.totalDays) * 100)
            : 0;

        const generatedAt = new Date().toLocaleString('en-US', {
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', hour12: false
        });

        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${this.escapeHtml(title)}</title>
<style>
  body { margin:0; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",sans-serif; background:linear-gradient(135deg,#0f172a,#020617,#0f172a); color:#e2e8f0; min-height:100vh; }
  .wrap { max-width:880px; margin:0 auto; padding:48px 32px; }
  header { padding-bottom:32px; border-bottom:1px solid #1e293b; margin-bottom:40px; }
  .eyebrow { font-size:11px; letter-spacing:0.15em; text-transform:uppercase; color:#22d3ee; font-weight:600; }
  h1 { font-size:40px; margin:8px 0 4px 0; }
  h2 { font-size:12px; letter-spacing:0.15em; text-transform:uppercase; color:#22d3ee; font-weight:600; margin:0 0 16px 0; }
  .grid4 { display:grid; grid-template-columns:repeat(2,1fr); gap:16px; margin-bottom:40px; }
  @media (min-width:600px) { .grid4 { grid-template-columns:repeat(4,1fr); } }
  .card { background:rgba(30,41,59,0.6); border:1px solid #334155; border-radius:12px; padding:20px; }
  .card .stat-label { font-size:11px; letter-spacing:0.1em; text-transform:uppercase; color:#94a3b8; }
  .card .stat-value { font-size:30px; font-weight:700; margin-top:8px; }
  .card .stat-delta { font-size:11px; margin-top:4px; }
  section.panel { background:rgba(30,41,59,0.4); border:1px solid #334155; border-radius:12px; padding:24px; margin-bottom:40px; }
  .daily-grid { display:grid; grid-template-columns:repeat(7,1fr); gap:12px; align-items:end; height:160px; }
  .ftable .row { display:flex; align-items:center; justify-content:space-between; padding:8px 0; border-bottom:1px solid rgba(51,65,85,0.5); font-size:14px; }
  .ftable .row:last-child { border-bottom:none; }
  .ftable .row code { background:#1e293b; padding:4px 8px; border-radius:6px; }
  .insight { background:rgba(8,51,68,0.5); border:1px solid rgba(8,145,178,0.4); border-radius:12px; padding:24px; margin-bottom:40px; }
  .insight h2 { color:#67e8f9; }
  .insight p { color:rgba(207,250,254,0.95); margin:0; }
  .future { background:rgba(30,41,59,0.4); border:1px dashed #475569; border-radius:12px; padding:24px; margin-bottom:40px; color:#94a3b8; font-size:14px; }
  footer { text-align:center; font-size:11px; color:#64748b; padding-top:24px; border-top:1px solid #1e293b; }
  footer code { background:#1e293b; padding:4px 8px; border-radius:4px; }
  @media print { body { background:white; color:#111; } .card,section.panel { border-color:#ddd; background:#fafafa; color:#111; } }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <div style="display:flex;justify-content:space-between;align-items:center;">
      <span class="eyebrow">FocusGuard &middot; ${this.escapeHtml(period)} digest</span>
      <span style="font-size:11px;color:#64748b;">Generated ${this.escapeHtml(generatedAt)}</span>
    </div>
    <h1>${this.escapeHtml(title)}</h1>
    <p style="color:#94a3b8;">${this.escapeHtml(subtitle)}</p>
  </header>

  <div class="grid4">
    <div class="card">
      <div class="stat-label">Total time</div>
      <div class="stat-value">${this.formatMinutes(grandTotalSecs)}</div>
      <div class="stat-delta" style="color:#94a3b8;">across ${dateList.length} day${dateList.length === 1 ? '' : 's'}</div>
    </div>
    <div class="card">
      <div class="stat-label">Adherence</div>
      <div class="stat-value">${adherencePct}%</div>
      <div class="stat-delta" style="color:${adherencePct >= 80 ? '#4ade80' : adherencePct >= 50 ? '#fcd34d' : '#fca5a5'};">
        ${adherence.daysAdherent} of ${adherence.totalDays} days under limits
      </div>
    </div>
    <div class="card">
      <div class="stat-label">Unblock events</div>
      <div class="stat-value">${totalUnblocks}</div>
      <div class="stat-delta" style="color:#94a3b8;">commitment paragraphs completed</div>
    </div>
    <div class="card">
      <div class="stat-label">Tamper events</div>
      <div class="stat-value">${totalTampers}</div>
      <div class="stat-delta" style="color:#94a3b8;">${totalAutoRepairs} auto-repair${totalAutoRepairs === 1 ? '' : 's'}</div>
    </div>
  </div>

  <section class="panel">
    <h2>Per-site totals</h2>
    <div style="display:flex;flex-direction:column;gap:16px;">
      ${siteRowsHtml || '<div style="color:#94a3b8;font-size:14px;">No usage recorded in this period.</div>'}
    </div>
  </section>

  <section class="panel">
    <h2>Daily totals (minutes)</h2>
    <div class="daily-grid">
      ${dailyBarsHtml}
    </div>
  </section>

  <section class="insight">
    <h2>This ${this.escapeHtml(period)}&rsquo;s insight</h2>
    <p>${insight}</p>
  </section>

  <section class="future">
    <strong style="color:#cbd5e1;">&#x1F4F1; Mobile (Pixel 8) &mdash; coming soon.</strong>
    Once the Android companion app is set up, mobile screen-time data will appear here alongside desktop totals.
  </section>

  <footer>
    <p>Generated locally. No network used. No data leaves your machine.</p>
  </footer>
</div>
</body>
</html>`;
    }

    // ---------- PUBLIC ENTRY POINTS ----------

    /** Build the previous calendar week's digest (Mon..Sun ending the day before today). */
    buildWeekly({ asOf = new Date() } = {}) {
        const thisWeekStart = this.startOfISOWeek(asOf);
        const lastWeekStart = new Date(thisWeekStart);
        lastWeekStart.setDate(lastWeekStart.getDate() - 7);
        const lastWeekEnd = new Date(lastWeekStart);
        lastWeekEnd.setDate(lastWeekEnd.getDate() + 6);

        const dateList = this.daysInRange(lastWeekStart, lastWeekEnd);
        const iso = this.getISOWeek(lastWeekStart);
        const filename = `${iso.year}-W${this.pad(iso.week)}.html`;

        const startLabel = lastWeekStart.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
        const endLabel = lastWeekEnd.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

        const html = this.buildHtml({
            title: `Week of ${startLabel} – ${endLabel}`,
            subtitle: 'Your social-media activity, friction events, and adherence to the limits you set.',
            dateList,
            period: 'weekly'
        });

        return { html, filename };
    }

    /** Build the previous calendar month's digest. */
    buildMonthly({ asOf = new Date() } = {}) {
        const firstOfThisMonth = new Date(asOf.getFullYear(), asOf.getMonth(), 1);
        const firstOfLastMonth = new Date(asOf.getFullYear(), asOf.getMonth() - 1, 1);
        const lastOfLastMonth = new Date(firstOfThisMonth);
        lastOfLastMonth.setDate(lastOfLastMonth.getDate() - 1);

        const dateList = this.daysInRange(firstOfLastMonth, lastOfLastMonth);
        const filename = `${firstOfLastMonth.getFullYear()}-${this.pad(firstOfLastMonth.getMonth() + 1)}.html`;

        const monthLabel = firstOfLastMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

        const html = this.buildHtml({
            title: monthLabel,
            subtitle: 'Your social-media activity, friction events, and adherence for the month.',
            dateList,
            period: 'monthly'
        });

        return { html, filename };
    }

    /** Persist HTML to disk under the configured target folder. Returns { success, filepath } */
    saveReport({ html, filename, targetFolder }) {
        try {
            if (!fs.existsSync(targetFolder)) {
                fs.mkdirSync(targetFolder, { recursive: true });
            }
            const filepath = path.join(targetFolder, filename);
            fs.writeFileSync(filepath, html, 'utf8');
            return { success: true, filepath };
        } catch (e) {
            console.error('ReportGenerator: save failed:', e);
            return { success: false, error: e.message };
        }
    }
}

module.exports = ReportGenerator;
