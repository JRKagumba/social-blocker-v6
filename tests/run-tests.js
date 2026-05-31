// Minimal test runner for the Tier-1 logic. Run via: `node tests/run-tests.js`.

require('./setup');

const fs = require('fs');
const os = require('os');
const path = require('path');

let passed = 0;
let failed = 0;
const failures = [];
const warnings = [];

function ok(label, cond, extra) {
    if (cond) {
        passed++;
        console.log(`  PASS  ${label}`);
    } else {
        failed++;
        failures.push({ label, extra });
        console.log(`  FAIL  ${label}${extra ? '  -> ' + JSON.stringify(extra) : ''}`);
    }
}

function group(name, fn) {
    console.log(`\n=== ${name} ===`);
    fn();
}

function warn(label, message) {
    warnings.push({ label, message });
    console.log(`  WARN  ${label}: ${message}`);
}

// ---------------------------------------------------------------------------
// 1) HostsManager: parsing & verification
// ---------------------------------------------------------------------------
group('HostsManager.extractBlockedDomainsFromHostsText', () => {
    const HostsManager = require('../hostsManager');
    const hm = new HostsManager();

    const blank = '';
    ok('empty input returns []', JSON.stringify(hm.extractBlockedDomainsFromHostsText(blank)) === '[]');

    const noMarkers = '# Default hosts\n127.0.0.1 localhost\n';
    ok('no markers returns []', JSON.stringify(hm.extractBlockedDomainsFromHostsText(noMarkers)) === '[]');

    const withSection = [
        '# Some default hosts',
        '127.0.0.1 localhost',
        '',
        '# -- SOCIAL BLOCKER V6 START --',
        '127.0.0.1 instagram.com #SOCIALBLOCKER_MARKER',
        '127.0.0.1 www.instagram.com #SOCIALBLOCKER_MARKER',
        '127.0.0.1 reddit.com #SOCIALBLOCKER_MARKER',
        '# -- SOCIAL BLOCKER V6 END --',
        ''
    ].join('\n');
    const got = hm.extractBlockedDomainsFromHostsText(withSection);
    ok('extracts 3 domains', got.length === 3, got);
    ok('domains are lowercased', got[0] === 'instagram.com' && got[2] === 'reddit.com', got);

    const crlf = withSection.replace(/\n/g, '\r\n');
    const gotCRLF = hm.extractBlockedDomainsFromHostsText(crlf);
    ok('handles CRLF', gotCRLF.length === 3, gotCRLF);
});

group('HostsManager.verifyHostsSection (against synthetic file)', () => {
    const HostsManager = require('../hostsManager');
    const hm = new HostsManager();

    const tmp = path.join(os.tmpdir(), 'sblocker-test-hosts-' + process.pid + '.txt');
    hm.hostsPath = tmp;

    const allMatch = [
        '127.0.0.1 localhost',
        '# -- SOCIAL BLOCKER V6 START --',
        '127.0.0.1 instagram.com #SOCIALBLOCKER_MARKER',
        '127.0.0.1 reddit.com #SOCIALBLOCKER_MARKER',
        '# -- SOCIAL BLOCKER V6 END --'
    ].join('\n');
    fs.writeFileSync(tmp, allMatch);
    let v = hm.verifyHostsSection(['instagram.com', 'reddit.com']);
    ok('ok=true when section matches expected', v.ok === true, v);

    const missingSection = '127.0.0.1 localhost\n';
    fs.writeFileSync(tmp, missingSection);
    v = hm.verifyHostsSection(['instagram.com']);
    ok('detects missing section', v.ok === false && v.sectionPresent === false && v.unexpectedMissing.includes('instagram.com'), v);

    fs.writeFileSync(tmp, allMatch);
    v = hm.verifyHostsSection(['instagram.com', 'reddit.com', 'facebook.com']);
    ok('detects partial section (missing facebook)', v.ok === false && v.unexpectedMissing.includes('facebook.com'), v);

    fs.writeFileSync(tmp, allMatch);
    v = hm.verifyHostsSection(['instagram.com']);
    ok('detects unexpected extra (reddit not expected)', v.ok === false && v.unexpectedExtra.includes('reddit.com'), v);

    // When expecting empty list, section should be absent.
    fs.writeFileSync(tmp, '127.0.0.1 localhost\n');
    v = hm.verifyHostsSection([]);
    ok('expected-empty matches absent section', v.ok === true && v.sectionPresent === false, v);

    fs.writeFileSync(tmp, allMatch);
    v = hm.verifyHostsSection([]);
    ok('expected-empty but section present -> not ok', v.ok === false && v.sectionPresent === true, v);

    try { fs.unlinkSync(tmp); } catch (_) { /* ignore */ }
});

// ---------------------------------------------------------------------------
// 2) Regex corpus: Twitter/X false-positive history + Reddit modern titles
// ---------------------------------------------------------------------------
group('Site match patterns: real-world title corpus', () => {
    const DataManager = require('../dataManager');
    const dm = new DataManager();
    const settings = dm.getDefaultSiteSettings();

    function compile(site) {
        const out = [];
        for (const p of site.matchPatterns || []) {
            try { out.push(new RegExp(p, 'i')); } catch (e) { /* skip */ }
        }
        return out;
    }

    /**
     * Mirrors usageTracker.js: regex over title (case-insensitive) wins;
     * Twitter/X disables keyword fallback. Others may fall back to keyword.includes.
     */
    function matchSiteForTitle(siteName, site, title) {
        const lower = String(title).toLowerCase();
        for (const re of compile(site)) {
            if (re.test(lower)) return { matched: true, why: `pattern:${re.source}` };
        }
        if (siteName === 'Twitter/X') return { matched: false };
        for (const k of (site.keywords || [])) {
            if (typeof k !== 'string') continue;
            const kk = k.trim().toLowerCase();
            if (!kk) continue;
            if (kk.length <= 2 && !kk.includes('.')) continue;
            if (lower.includes(kk)) return { matched: true, why: `keyword:${kk}` };
        }
        return { matched: false };
    }

    function detectSites(title) {
        const hits = [];
        for (const siteName of Object.keys(settings)) {
            const r = matchSiteForTitle(siteName, settings[siteName], title);
            if (r.matched) hits.push({ siteName, why: r.why });
        }
        return hits;
    }

    // MUST MATCH (each title should land at least the expected site).
    // Includes real-world titles captured by startDebugMode() — especially Edge's multi-tab
    // "<title> and N more pages - <Profile> - Microsoft Edge" format which broke the old patterns.
    const mustMatch = [
        // YouTube
        ['Some Video Title - YouTube - Google Chrome', 'YouTube'],
        ['YouTube - Google Chrome', 'YouTube'],
        ['YouTube and 5 more pages - Personal - Microsoft Edge', 'YouTube'],
        // Facebook
        ['(2) Facebook - Google Chrome', 'Facebook'],
        ['Joe Kagumba | Facebook - Google Chrome', 'Facebook'],
        ['Facebook - Google Chrome', 'Facebook'],
        ['Facebook and 3 more pages - Personal - Microsoft Edge', 'Facebook'],
        // Instagram
        ['Instagram - Google Chrome', 'Instagram'],
        ['(5) Joe • Instagram photos and videos - Google Chrome', 'Instagram'],
        ['www.instagram.com - Google Chrome', 'Instagram'],
        ['Stories • Instagram and 3 more pages - Personal - Microsoft Edge', 'Instagram'],
        ['Instagram and 3 more pages - Personal - Microsoft Edge', 'Instagram'],
        // Twitter / X (modern + legacy patterns)
        ['(3) Home / X - Google Chrome', 'Twitter/X'],
        ['Notifications / X - Google Chrome', 'Twitter/X'],
        ['Joe Kagumba on X: "hello world" - Google Chrome', 'Twitter/X'],
        ['twitter.com / Twitter - Google Chrome', 'Twitter/X'],
        // Edge multi-tab X variants (real log)
        ['X. It\u2019s what\u2019s happening / X and 1 more page - Personal - Microsoft Edge', 'Twitter/X'],
        ['(1) Home / X and 1 more page - Personal - Microsoft Edge', 'Twitter/X'],
        ['Home / X and 1 more page - Personal - Microsoft Edge', 'Twitter/X'],
        // Reddit (modern subreddit title format dominates)
        ['AMA with Linus Torvalds : r/programming - Google Chrome', 'Reddit'],
        ['Reddit - Dive into anything - Google Chrome', 'Reddit'],
        ['r/funny - cats - Mozilla Firefox', 'Reddit'],
        ['Reddit - The heart of the internet - Google Chrome', 'Reddit'],
        ['Reddit - The heart of the internet - Work - Microsoft Edge', 'Reddit'],
        ['Reddit - The heart of the internet and 1 more page - Personal - Microsoft Edge', 'Reddit'],
        // LinkedIn
        ['(1) Joe Kagumba | LinkedIn - Google Chrome', 'LinkedIn'],
        ['Feed | LinkedIn - Google Chrome', 'LinkedIn'],
        ['Amy LK Liu | LinkedIn - Google Chrome', 'LinkedIn'],
        ['linkedin.com - Google Chrome', 'LinkedIn'],
        // Messenger
        ['Messenger - Google Chrome', 'Messenger'],
        ['Messenger and 4 more pages - Personal - Microsoft Edge', 'Messenger'],
    ];

    for (const [title, expected] of mustMatch) {
        const hits = detectSites(title);
        ok(`MATCH ${expected.padEnd(11)} <- "${title}"`,
            hits.some(h => h.siteName === expected),
            hits);
    }

    // MUST-NOT-MATCH for Twitter/X (the historical substring trap).
    const mustNotMatchTwitter = [
        'Netflix - Watch TV Shows Online - Google Chrome',
        'How to delete your x.com account : r/privacy - Google Chrome',
        'Tax.com - Tax tips and news - Google Chrome',
        'Affix.com home page - Google Chrome',
        'XBox Series X review : r/gaming - Mozilla Firefox',
        'Re: foo bar - person@x.com - Inbox - Gmail - Google Chrome',
        'Why I left X — A retrospective - Personal Blog - Google Chrome', // em-dashes; should not match
    ];

    for (const title of mustNotMatchTwitter) {
        const hits = detectSites(title);
        ok(`NO-TwitterX <- "${title}"`,
            !hits.some(h => h.siteName === 'Twitter/X'),
            hits);
    }

    // MUST-NOT-MATCH globally (non-browser-y titles).
    const mustNotMatchAny = [
        'Visual Studio Code - main.js',
        'Excel - revenue.xlsx',
        'File Explorer',
        'Inbox - Outlook',
    ];

    for (const title of mustNotMatchAny) {
        const hits = detectSites(title);
        ok(`NO-ANY <- "${title}"`,
            hits.length === 0,
            hits);
    }

    // KNOWN LIMITATIONS: title-only matching cannot disambiguate without URL context.
    const limitations = [
        'Twitter takeover analysis | Stratechery - Google Chrome',
        // A Reddit search results page whose title contains "twitter" — actually on Reddit, not X.
        'twitter - Reddit Search! and 1 more page - Personal - Microsoft Edge',
        // Bing search results page for "Twitter" — actually on Bing, not X.
        'Twitter and 1 more page - Personal - Microsoft Edge',
        // Transient "x.com" title appears for ~2s during initial page load before X's real title resolves.
        // Not worth tracking — would require \bx\.com\b which false-positives on Reddit/Hackernews discussions.
        'x.com and 1 more page - Personal - Microsoft Edge',
    ];
    for (const title of limitations) {
        const hits = detectSites(title);
        if (hits.some(h => h.siteName === 'Twitter/X')) {
            warn('KNOWN_LIMITATION_Twitter_discussion', `Title matches Twitter/X without URL context: "${title}"`);
        }
    }
});

// ---------------------------------------------------------------------------
// 3) DataManager.advanceCalendarRollIfNeeded
// ---------------------------------------------------------------------------
group('DataManager.advanceCalendarRollIfNeeded (auto-reblock on)', () => {
    const DataManager = require('../dataManager');
    const dm = new DataManager();

    // Bootstrap: only Instagram domains are currently blocked.
    const settings = dm.getSiteSettings();
    const igDomains = settings.Instagram.domains;
    dm.setBlockedDomains(igDomains);

    // Confirm preferences derived correctly.
    const prefsBefore = dm.store.get('appliedBlockedBySite');
    ok('Instagram applied=true', prefsBefore.Instagram === true, prefsBefore);
    ok('Facebook applied=false', prefsBefore.Facebook === false, prefsBefore);

    // Simulate yesterday as baseline.
    dm.store.set('calendarRollBaselineDay', '1999-01-01');
    dm.store.set('autoReblockUnblockedSitesOnNewDay', true);

    const result = dm.advanceCalendarRollIfNeeded();
    ok('rolled=true', result.rolled === true, result);
    ok('prefsChanged=true', result.prefsChanged === true, result);
    ok('domainsChanged=true (Instagram-only -> all)', result.domainsChanged === true, result);

    const prefsAfter = dm.store.get('appliedBlockedBySite');
    const everySiteOn = Object.values(prefsAfter).every(v => v === true);
    ok('every site applied=true after roll', everySiteOn, prefsAfter);

    const afterDomains = dm.getBlockedDomains();
    const everyDomainPresent = Object.values(settings).every(s =>
        s.domains.every(d => afterDomains.includes(d.toLowerCase()))
    );
    ok('blockedDomains contains every site domain (lowercased)', everyDomainPresent, { count: afterDomains.length });
});

group('DataManager.advanceCalendarRollIfNeeded (auto-reblock OFF)', () => {
    const DataManager = require('../dataManager');
    const dm = new DataManager();

    const settings = dm.getSiteSettings();
    const igDomains = settings.Instagram.domains;
    dm.setBlockedDomains(igDomains);
    dm.store.set('calendarRollBaselineDay', '1999-01-01');
    dm.store.set('autoReblockUnblockedSitesOnNewDay', false);

    const result = dm.advanceCalendarRollIfNeeded();
    ok('rolled=true', result.rolled === true, result);
    ok('prefsChanged=false (auto-reblock disabled)', result.prefsChanged === false, result);
    ok('domainsChanged=false', result.domainsChanged === false, result);

    const after = dm.getBlockedDomains();
    ok('Only Instagram domains remain', after.length === igDomains.length, after);
});

group('DataManager.cleanupExpiredManualLocks on calendar roll', () => {
    const DataManager = require('../dataManager');
    const dm = new DataManager();
    dm.store.set('manualLocks', { Instagram: '1999-01-01' });
    dm.store.set('calendarRollBaselineDay', '1999-01-01');
    dm.advanceCalendarRollIfNeeded();
    const locks = dm.store.get('manualLocks', {});
    ok('stale manual-lock cleared after roll', !('Instagram' in locks), locks);
});

// ---------------------------------------------------------------------------
// 4) ReportGenerator: HTML build smoke + week/month math
// ---------------------------------------------------------------------------
group('ReportGenerator.getISOWeek / startOfISOWeek / saveReport', () => {
    const DataManager = require('../dataManager');
    const ReportGenerator = require('../reportGenerator');
    const dm = new DataManager();
    const rg = new ReportGenerator(dm);

    // ISO week edge cases. NOTE: must use the (year, monthIndex, day) constructor
    // so dates are interpreted as LOCAL time. `new Date('2026-05-11')` parses as UTC
    // midnight, which lands on the previous day in any negative UTC offset and silently
    // shifts the answer by one ISO week.
    const w1 = rg.getISOWeek(new Date(2026, 4, 11)); // Mon May 11 2026 -> W20
    ok('2026-05-11 -> ISO W20', w1.year === 2026 && w1.week === 20, w1);

    const w2 = rg.getISOWeek(new Date(2024, 0, 1)); // Mon Jan 1 2024 -> W1 of 2024
    ok('2024-01-01 -> ISO W1', w2.year === 2024 && w2.week === 1, w2);

    const w3 = rg.getISOWeek(new Date(2025, 0, 1)); // Wed Jan 1 2025 -> W1 of 2025
    ok('2025-01-01 -> ISO W1', w3.year === 2025 && w3.week === 1, w3);

    // startOfISOWeek should resolve to Monday at 00:00 in local time.
    const mon = rg.startOfISOWeek(new Date(2026, 4, 13, 14, 32, 0)); // Wed May 13 2026 14:32 local
    ok('startOfISOWeek picks Monday', mon.getDay() === 1, { day: mon.getDay(), iso: mon.toString() });

    // Seed two usage days, then build a weekly digest and verify HTML contains expected markers.
    const today = new Date();
    const todayIso = rg.toISODate(today);
    const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
    const yIso = rg.toISODate(yesterday);
    dm.store.set(`usage.${todayIso}`, { Instagram: 1800, YouTube: 600 });   // 30m + 10m
    dm.store.set(`usage.${yIso}`, { Reddit: 1200 });                         // 20m

    const built = rg.buildWeekly({ asOf: new Date(today.getTime() + 7 * 86400000) }); // shift forward to cover both days
    ok('buildWeekly returns HTML', typeof built.html === 'string' && built.html.includes('<html'));
    ok('buildWeekly filename matches pattern', /^\d{4}-W\d{2}\.html$/.test(built.filename), built.filename);
    ok('weekly HTML references Per-site totals', built.html.includes('Per-site totals'));
    ok('weekly HTML mentions Total time stat', built.html.includes('Total time'));

    const built2 = rg.buildMonthly({ asOf: new Date(today.getFullYear(), today.getMonth() + 1, 5) });
    ok('buildMonthly filename matches pattern', /^\d{4}-\d{2}\.html$/.test(built2.filename), built2.filename);

    // Write to a temp dir to verify saveReport creates folders.
    const tempDir = path.join(os.tmpdir(), `sb-test-${Date.now()}`, 'nested', 'reports');
    const saved = rg.saveReport({ html: built.html, filename: built.filename, targetFolder: tempDir });
    ok('saveReport returns success', saved.success === true, saved);
    ok('saveReport wrote file', saved.success && fs.existsSync(saved.filepath), saved);

    // Cleanup
    try {
        if (saved.success) fs.unlinkSync(saved.filepath);
        fs.rmdirSync(tempDir);
        fs.rmdirSync(path.dirname(tempDir));
        fs.rmdirSync(path.dirname(path.dirname(tempDir)));
    } catch (_) { /* best-effort */ }
});

group('DataManager.reportSettings round-trip', () => {
    const DataManager = require('../dataManager');
    const dm = new DataManager();
    const initial = dm.getReportSettings();
    ok('reportSettings has default targetFolder', typeof initial.targetFolder === 'string' && initial.targetFolder.length > 0, initial);
    ok('reportSettings defaults weekly enabled', initial.weeklyEnabled === true);
    ok('reportSettings defaults monthly enabled', initial.monthlyEnabled === true);

    const updated = dm.setReportSettings({ targetFolder: 'C:\\Custom\\Path', monthlyEnabled: false });
    ok('targetFolder persisted', updated.targetFolder === 'C:\\Custom\\Path', updated);
    ok('monthlyEnabled persisted', updated.monthlyEnabled === false, updated);
    ok('untouched field preserved', updated.weeklyEnabled === true, updated);
});

group('DataManager.deepWorkConfig + computeDeepWorkDomains', () => {
    const DataManager = require('../dataManager');
    const dm = new DataManager();

    const cfg = dm.getDeepWorkConfig();
    ok('selectedSites is array', Array.isArray(cfg.selectedSites));
    ok('customDomains is array', Array.isArray(cfg.customDomains));
    ok('defaults include Instagram', cfg.selectedSites.includes('Instagram'));
    ok('defaults include Messenger special', cfg.selectedSites.includes('Messenger'));

    // computeDeepWorkDomains pulls real-site domains + messenger specials.
    const domains = dm.computeDeepWorkDomains();
    ok('computed list contains instagram.com', domains.includes('instagram.com'), { sample: domains.slice(0, 6) });
    ok('computed list contains messenger.com', domains.includes('messenger.com'));
    ok('computed list contains web.whatsapp.com', domains.includes('web.whatsapp.com'));
    ok('all domains lowercase', domains.every(d => d === d.toLowerCase()));

    // Custom domain validation: ignore garbage, accept valid hostnames.
    const next = dm.setDeepWorkConfig({
        customDomains: ['  HTTPS://news.YCombinator.com/x  ', 'invalid!@#', 'chess.com', 'chess.com', '']
    });
    ok('custom domain stripped + lowercased', next.customDomains.includes('news.ycombinator.com'), next.customDomains);
    ok('invalid domain rejected', !next.customDomains.includes('invalid!@#'), next.customDomains);
    ok('duplicate deduped', next.customDomains.filter(d => d === 'chess.com').length === 1, next.customDomains);

    // After save, computeDeepWorkDomains should reflect customs.
    const domains2 = dm.computeDeepWorkDomains();
    ok('custom domain appears in computed list', domains2.includes('chess.com'));
});

group('DataManager.hudConfig defaults + round-trip', () => {
    const DataManager = require('../dataManager');
    const dm = new DataManager();
    const initial = dm.getHudConfig();
    ok('hud visible defaults false (opt-in)', initial.visible === false, initial);
    ok('hud autoHideFullscreen defaults true', initial.autoHideFullscreen === true, initial);
    ok('hud clickThrough defaults false', initial.clickThrough === false, initial);

    const next = dm.setHudConfig({ visible: true });
    ok('hudConfig visible persists', next.visible === true);
    ok('hudConfig unrelated field preserved', next.autoHideFullscreen === true);
});

// ---------------------------------------------------------------------------
// 5) DataManager.deepWorkSchedule CRUD + scheduler predicates
// ---------------------------------------------------------------------------
group('DataManager.deepWorkSchedule CRUD', () => {
    const DataManager = require('../dataManager');
    const dm = new DataManager();

    // Should start empty (clean store after each `new DataManager()`).
    dm.store.set('deepWorkSchedule', []);
    ok('initial schedule is empty array', Array.isArray(dm.getDeepWorkSchedule()) && dm.getDeepWorkSchedule().length === 0);

    const after1 = dm.addScheduleRule({
        name: 'Morning focus', days: [1, 2, 3, 4, 5],
        startTime: '09:00', durationMinutes: 180
    });
    ok('add returns array of 1', after1.length === 1, after1);
    ok('added rule has UUID-shaped id', typeof after1[0].id === 'string' && after1[0].id.length >= 8);
    ok('added rule is enabled by default', after1[0].enabled === true);
    ok('added rule preserves name', after1[0].name === 'Morning focus');

    const after2 = dm.addScheduleRule({
        name: 'Weekend deep work', days: [0, 6],
        startTime: '14:30', durationMinutes: 120, enabled: false
    });
    ok('second add yields 2 rules', after2.length === 2);
    ok('explicit enabled:false respected', after2[1].enabled === false);

    const id1 = after2[0].id;
    const after3 = dm.updateScheduleRule(id1, { name: 'Renamed', durationMinutes: 60 });
    const updated = after3.find(r => r.id === id1);
    ok('update preserves id', updated.id === id1);
    ok('update applies new name', updated.name === 'Renamed');
    ok('update clamps duration to 60', updated.durationMinutes === 60);

    const after4 = dm.deleteScheduleRule(id1);
    ok('delete removes rule', after4.length === 1 && after4[0].id !== id1);

    // Defensive: setDeepWorkSchedule sanitizes inputs.
    // Design: null/non-objects are dropped; valid-looking objects with
    // missing fields are normalized to sensible defaults rather than
    // discarded — keeps storage forgiving across schema migrations.
    const sanitized = dm.setDeepWorkSchedule([
        { id: 'x', name: 'bad time',  days: [8, 1, -3, 'cat', 1], startTime: '99:99', durationMinutes: 9999 },
        null,
        'not even an object',
        { not: 'a-rule' },  // gets normalized to defaults (empty days, 09:00, 60min)
        { name: 'no-id-passes', days: [2], startTime: '10:00', durationMinutes: 90 }
    ]);
    ok('null + non-objects dropped (5 in -> 3 out)', sanitized.length === 3, sanitized);
    ok('out-of-range days filtered + deduped', JSON.stringify(sanitized[0].days) === '[1]', sanitized[0]);
    ok('invalid time falls back to 09:00', sanitized[0].startTime === '09:00', sanitized[0]);
    ok('duration capped at 480', sanitized[0].durationMinutes === 480);
    ok('object without required fields gets defaults', sanitized[1].days.length === 0 && sanitized[1].startTime === '09:00');
    ok('missing id is generated', typeof sanitized[2].id === 'string' && sanitized[2].id.length > 0);
});

group('DataManager.shouldFireRuleNow predicate', () => {
    const DataManager = require('../dataManager');

    // Build a fake "Mon 2026-06-01 09:02:30" — a Monday so weekday=1.
    const monAt0902 = new Date(2026, 5, 1, 9, 2, 30);
    ok('synthetic Monday 9:02 has weekday 1', monAt0902.getDay() === 1);

    const rule = {
        id: 'r1', enabled: true, name: 't',
        days: [1, 2, 3, 4, 5], startTime: '09:00',
        durationMinutes: 60, lastFiredOn: null
    };
    ok('fires inside grace window', DataManager.shouldFireRuleNow(rule, monAt0902, 5) === true);

    const monAt0830 = new Date(2026, 5, 1, 8, 30, 0);
    ok('does not fire before scheduled time', DataManager.shouldFireRuleNow(rule, monAt0830, 5) === false);

    const monAt0910 = new Date(2026, 5, 1, 9, 10, 0);
    ok('does not fire past grace window (10min > 5min)', DataManager.shouldFireRuleNow(rule, monAt0910, 5) === false);

    const ruleAlreadyFired = { ...rule, lastFiredOn: '2026-06-01' };
    ok('does not fire when already fired today', DataManager.shouldFireRuleNow(ruleAlreadyFired, monAt0902, 5) === false);

    const sunAt0902 = new Date(2026, 5, 7, 9, 2, 0); // Sun Jun 7
    ok('does not fire on non-scheduled weekday', DataManager.shouldFireRuleNow(rule, sunAt0902, 5) === false);

    const disabled = { ...rule, enabled: false };
    ok('does not fire when disabled', DataManager.shouldFireRuleNow(disabled, monAt0902, 5) === false);

    const noDays = { ...rule, days: [] };
    ok('does not fire when no days set', DataManager.shouldFireRuleNow(noDays, monAt0902, 5) === false);
});

group('DataManager.computeNextFireTime', () => {
    const DataManager = require('../dataManager');

    // Mon 2026-06-01 10:00 — past 09:00 weekday rule, before 14:00 weekday rule.
    const monAt1000 = new Date(2026, 5, 1, 10, 0, 0);

    const morningRule = {
        id: 'm', enabled: true, name: 'Morning',
        days: [1, 2, 3, 4, 5], startTime: '09:00',
        durationMinutes: 60, lastFiredOn: null
    };
    const afternoonRule = {
        id: 'a', enabled: true, name: 'Afternoon',
        days: [1, 2, 3, 4, 5], startTime: '14:00',
        durationMinutes: 60, lastFiredOn: null
    };

    const next1 = DataManager.computeNextFireTime([morningRule, afternoonRule], monAt1000);
    ok('next is Afternoon (today)', next1.ruleId === 'a', next1);
    ok('next fires at 14:00 today', next1.fireAt.getHours() === 14 && next1.fireAt.getDate() === 1);

    // Mon 16:00 — both 09 and 14 are past for today, so next is tomorrow's morning rule (Tue).
    const monAt1600 = new Date(2026, 5, 1, 16, 0, 0);
    const next2 = DataManager.computeNextFireTime([morningRule, afternoonRule], monAt1600);
    ok('after both windows, next is tomorrow Morning', next2.ruleId === 'm', next2);
    ok('next fireAt is Tue Jun 2', next2.fireAt.getDate() === 2 && next2.fireAt.getDay() === 2);

    // Disabled rule excluded.
    const next3 = DataManager.computeNextFireTime([{ ...morningRule, enabled: false }, afternoonRule], monAt1000);
    ok('disabled rule excluded', next3.ruleId === 'a');

    // No enabled rules -> null.
    const next4 = DataManager.computeNextFireTime([{ ...morningRule, enabled: false }], monAt1000);
    ok('null when no enabled rules', next4 === null);

    // Sunday-only rule from Monday morning -> next is next Sunday.
    const sundayOnly = { ...morningRule, days: [0] };
    const next5 = DataManager.computeNextFireTime([sundayOnly], monAt1000);
    ok('sunday-only from Mon -> next Sun', next5.fireAt.getDay() === 0, next5);
});

// ---------------------------------------------------------------------------
// 6) Progressive friction policy
// ---------------------------------------------------------------------------
group('DataManager.computeFrictionPolicy ladder', () => {
    const DataManager = require('../dataManager');

    const t1 = DataManager.computeFrictionPolicy(0, { enabled: true });
    ok('priorCount=0 -> tier 1', t1.tier === 1 && t1.sentenceCount === 1 && t1.cooldownSeconds === 0, t1);

    const t2 = DataManager.computeFrictionPolicy(1, { enabled: true });
    ok('priorCount=1 -> tier 2 (2 sentences)', t2.tier === 2 && t2.sentenceCount === 2 && t2.cooldownSeconds === 0, t2);

    const t3 = DataManager.computeFrictionPolicy(2, { enabled: true });
    ok('priorCount=2 -> tier 3 (3 sentences)', t3.tier === 3 && t3.sentenceCount === 3 && t3.cooldownSeconds === 0, t3);

    const t4 = DataManager.computeFrictionPolicy(3, { enabled: true });
    ok('priorCount=3 -> tier 4 (4 sentences + 15s)', t4.tier === 4 && t4.sentenceCount === 4 && t4.cooldownSeconds === 15, t4);

    const t5 = DataManager.computeFrictionPolicy(4, { enabled: true });
    ok('priorCount=4 -> tier 5 (full + 60s)', t5.tier === 5 && t5.sentenceCount === 5 && t5.cooldownSeconds === 60, t5);

    const t5b = DataManager.computeFrictionPolicy(99, { enabled: true });
    ok('priorCount=99 stays at tier 5', t5b.tier === 5 && t5b.cooldownSeconds === 60, t5b);

    const disabled = DataManager.computeFrictionPolicy(0, { enabled: false });
    ok('disabled -> tier 0 (full paragraph, no cooldown)',
       disabled.tier === 0 && disabled.cooldownSeconds === 0 && disabled.sentenceCount === 5, disabled);
});

group('DataManager.extractFirstNSentences', () => {
    const DataManager = require('../dataManager');

    const three = 'First sentence. Second sentence here. Third one too! Fourth?';
    ok('extract 1 of 4', DataManager.extractFirstNSentences(three, 1) === 'First sentence.');
    ok('extract 2 of 4',
       DataManager.extractFirstNSentences(three, 2) === 'First sentence. Second sentence here.',
       DataManager.extractFirstNSentences(three, 2));
    ok('extract 3 of 4',
       DataManager.extractFirstNSentences(three, 3) === 'First sentence. Second sentence here. Third one too!',
       DataManager.extractFirstNSentences(three, 3));
    ok('N >= sentences returns whole text', DataManager.extractFirstNSentences(three, 10) === three);
    ok('handles "?" sentence terminator',
       DataManager.extractFirstNSentences('Why? Because.', 1) === 'Why?');
    ok('non-string returns empty', DataManager.extractFirstNSentences(null, 2) === '');
    ok('text with no terminator returns whole', DataManager.extractFirstNSentences('no period', 2) === 'no period');
});

group('DataManager.getTodayUnblockTotal + progressive friction config', () => {
    const DataManager = require('../dataManager');
    const dm = new DataManager();
    // Clean slate.
    dm.store.set('unblockHistory', []);

    ok('initial total is 0', dm.getTodayUnblockTotal() === 0);

    dm.addUnblockEvent('Reddit');
    dm.addUnblockEvent('Reddit');
    dm.addUnblockEvent('YouTube');
    ok('after 3 events today total = 3', dm.getTodayUnblockTotal() === 3);

    // Insert a fake old event manually — should not count.
    const old = dm.getUnblockHistory();
    old.push({ timestamp: '1999-01-01T12:00:00.000Z', siteName: 'Twitter' });
    dm.store.set('unblockHistory', old);
    ok('old event ignored', dm.getTodayUnblockTotal() === 3);

    // Friction config defaults to enabled.
    const initial = dm.getProgressiveFrictionConfig();
    ok('friction config defaults enabled=true', initial.enabled === true);
    const after = dm.setProgressiveFrictionConfig({ enabled: false });
    ok('friction config toggle persists', after.enabled === false);
    ok('friction config re-read matches', dm.getProgressiveFrictionConfig().enabled === false);
});

// ---------------------------------------------------------------------------
// 7) Insights aggregator
// ---------------------------------------------------------------------------
group('DataManager insights helpers', () => {
    const DataManager = require('../dataManager');
    const dm = new DataManager();

    // Clean slate for usage + unblocks.
    dm.store.set('unblockHistory', []);
    const today = dm.getLocalISODate();
    const yesterday = (() => {
        const d = new Date(); d.setDate(d.getDate() - 1);
        return dm.getLocalISODate(d);
    })();

    // Seed today's usage: Reddit 30min, YouTube 10min.
    dm.store.set(`usage.${today}`, { Reddit: 1800, YouTube: 600 });
    // Seed yesterday too.
    dm.store.set(`usage.${yesterday}`, { Reddit: 60 });

    ok('getDailyTotalSocialSeconds sums all sites', dm.getDailyTotalSocialSeconds(today) === 2400,
        dm.getDailyTotalSocialSeconds(today));
    ok('getDailyTotalSocialSeconds zero for empty date',
        dm.getDailyTotalSocialSeconds('1999-01-01') === 0);

    // Seed hourly data: 10AM has the most traffic.
    dm.store.set(`hourlyUsage.${today}.Reddit.10`, 1200);
    dm.store.set(`hourlyUsage.${today}.YouTube.10`, 300);
    dm.store.set(`hourlyUsage.${today}.Reddit.14`, 600);
    const peak = dm.getMostDistractingHourForDay(today);
    ok('getMostDistractingHourForDay finds 10AM', peak.hour === 10, peak);
    ok('peak hour seconds is sum across sites at that hour', peak.seconds === 1500, peak);
    ok('hourlyTotals is length 24', peak.hourlyTotals.length === 24);

    const noUsageDay = dm.getMostDistractingHourForDay('1999-01-01');
    ok('no-usage day returns null hour', noUsageDay.hour === null && noUsageDay.seconds === 0);

    // Week math: 7 entries, Monday first.
    const wk = dm.getWeekTotals(0);
    ok('getWeekTotals returns 7 days', wk.length === 7);
    ok('first day is Mon (dayOfWeek=0 ISO)', wk[0].dayOfWeek === 0);
    ok('last day is Sun (dayOfWeek=6 ISO)', wk[6].dayOfWeek === 6);
    ok('week includes today',
        wk.some(d => d.date === today && d.seconds === 2400),
        wk.map(d => `${d.date}:${d.seconds}`));

    // Friction timeline: seed 3 unblocks today across two sites.
    const ts = (h, m) => `${today}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00.000Z`;
    dm.store.set('unblockHistory', [
        { timestamp: ts(9, 0), siteName: 'Reddit' },
        { timestamp: ts(10, 30), siteName: 'YouTube' },
        { timestamp: ts(14, 15), siteName: 'Reddit' }
    ]);
    dm.setProgressiveFrictionConfig({ enabled: true });
    const tl = dm.getTodayFrictionTimeline();
    ok('timeline length matches today unblocks', tl.length === 3);
    ok('timeline tiers escalate 1->2->3', tl[0].tier === 1 && tl[1].tier === 2 && tl[2].tier === 3,
        tl.map(t => t.tier));
    ok('timeline is chronological', tl[0].timestamp < tl[1].timestamp && tl[1].timestamp < tl[2].timestamp);

    // Aggregator payload sanity.
    const payload = dm.buildInsightsPayload();
    ok('payload.today.totalSeconds matches', payload.today.totalSeconds === 2400);
    ok('payload.today.unblockCount === 3', payload.today.unblockCount === 3);
    ok('payload.today.highestTier === 3', payload.today.highestTier === 3);
    ok('payload.today.topSite is Reddit', payload.today.topSite?.siteName === 'Reddit', payload.today.topSite);
    ok('payload.today.mostDistractingHour.hour === 10', payload.today.mostDistractingHour.hour === 10);
    ok('payload.week.thisWeekTotal includes today', payload.week.thisWeekTotal >= 2400);
    // bestDay = LEAST social time in the week (most disciplined). Yesterday
    // was seeded with 60s, today with 2400s — yesterday should win iff it
    // falls in this week. (Test only meaningful when today != Monday; on
    // Mondays yesterday is in the previous week.)
    if (new Date().getDay() !== 1) {
        ok('payload.week.bestDay finds lowest-usage day', payload.week.bestDay?.seconds === 60,
            payload.week.bestDay);
    } else {
        ok('Monday edge case skipped (yesterday is in previous week)', true);
    }
    ok('payload.timeline length === 3', payload.timeline.length === 3);
});

// ---------------------------------------------------------------------------
// 8) Summary
// ---------------------------------------------------------------------------
console.log('\n=========================================');
console.log(`PASS: ${passed}   FAIL: ${failed}   WARN: ${warnings.length}`);
if (failures.length) {
    console.log('Failures:');
    for (const f of failures) console.log('  -', f.label, f.extra ? '  ' + JSON.stringify(f.extra) : '');
}
console.log('=========================================');

process.exit(failed === 0 ? 0 : 1);
