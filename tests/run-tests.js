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
// 5) Summary
// ---------------------------------------------------------------------------
console.log('\n=========================================');
console.log(`PASS: ${passed}   FAIL: ${failed}   WARN: ${warnings.length}`);
if (failures.length) {
    console.log('Failures:');
    for (const f of failures) console.log('  -', f.label, f.extra ? '  ' + JSON.stringify(f.extra) : '');
}
console.log('=========================================');

process.exit(failed === 0 ? 0 : 1);
