// phoneCsvParser.js
// -----------------------------------------------------------------------------
// Reads the Digital-Wellbeing-screenshot-OCR CSV bundle (the format that lives
// in the user's `phone_app_activity_log_csv_tabs/` folder) and returns a
// normalized per-day phone-usage payload that the rest of the app can consume.
//
// Why a dedicated parser instead of a generic CSV reader?
//   1. The source is a bundle of related files (long-form Daily_Unlocks +
//      Daily_Screen_Time + App_Opens + App_Screen_Time) that must be joined
//      by date. Optional matrix/dashboard/README files are tolerated but
//      ignored — long-form is the source of truth.
//   2. App display-names need canonicalization (handled in phoneAppNormalizer)
//      before any per-app aggregation makes sense.
//   3. The parser is the first implementation of an abstract
//      `PhoneDataSource` concept; future ADB / StayFree feeders will produce
//      the same shape so the storage + UI layer don't need to care which
//      source was used.
//
// Output shape (the canonical phone-usage payload):
//   {
//       source: 'csv-folder-import',
//       sourceLabel: 'CSV folder: <path>',
//       importedAt: ISOString,
//       days: {
//           '2026-05-10': {
//               date: '2026-05-10',
//               dayOfWeek: 0,                  // 0=Sun ... 6=Sat
//               totalMinutes: 475,
//               unlocks: 51,
//               perApp: { 'YouTube': 211, 'Chrome': 22, ... }, // canonicalized
//               visibleRowCount: 7,
//               sourceFile: 'Screenshot_20260603-103718.png',
//           },
//           ...
//       },
//       warnings: [ '...', ... ],            // non-fatal issues
//   }
//
// All parsing is pure: no fs writes, no IPC. Tests call parseFolder() with
// the path to tests/phone-fixtures/.
// -----------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const { normalizeAppName, isChromeSubSite } = require('./phoneAppNormalizer');

// File-name suffix -> logical tab. Long-form tabs are required (parser will
// still produce output if some are missing, but with warnings). Matrix /
// dashboard / README are intentionally ignored — they're derived views.
const TAB_SUFFIXES = {
    dailyUnlocks: 'Daily_Unlocks.csv',
    dailyScreenTime: 'Daily_Screen_Time.csv',
    appOpens: 'App_Opens.csv',
    appScreenTime: 'App_Screen_Time.csv',
};

// ----- CSV line parser (handles quoted commas, escaped quotes) -------------
function parseCsvLine(line) {
    const cells = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"') {
            // Escaped double-quote inside a quoted field is "" -> "
            if (inQuotes && line[i + 1] === '"') { cur += '"'; i += 1; continue; }
            inQuotes = !inQuotes;
            continue;
        }
        if (c === ',' && !inQuotes) { cells.push(cur); cur = ''; continue; }
        cur += c;
    }
    cells.push(cur);
    return cells;
}

function parseCsvText(text) {
    const lines = String(text).replace(/\r\n/g, '\n').split('\n').filter(l => l.length > 0);
    if (lines.length === 0) return { header: [], rows: [] };
    const header = parseCsvLine(lines[0]);
    const rows = lines.slice(1).map(l => {
        const cells = parseCsvLine(l);
        const obj = {};
        header.forEach((h, i) => { obj[h] = cells[i] ?? ''; });
        return obj;
    });
    return { header, rows };
}

// ----- File discovery -------------------------------------------------------
function findBundleFiles(folderPath) {
    let entries;
    try {
        entries = fs.readdirSync(folderPath);
    } catch (e) {
        throw new Error(`Could not read folder: ${folderPath} (${e.code || e.message})`);
    }
    const found = {};
    for (const key of Object.keys(TAB_SUFFIXES)) found[key] = null;

    for (const name of entries) {
        if (!name.toLowerCase().endsWith('.csv')) continue;
        for (const [key, suffix] of Object.entries(TAB_SUFFIXES)) {
            if (name.endsWith(suffix)) {
                // Last match wins if user has duplicates; warn caller via return shape later.
                found[key] = path.join(folderPath, name);
            }
        }
    }
    return found;
}

// ----- Field coercion helpers ----------------------------------------------
// "2026-05-10" -> 2026-05-10. Returns null on garbage.
function normalizeIsoDate(raw) {
    if (typeof raw !== 'string') return null;
    const m = raw.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    const [_, y, mo, d] = m;
    const yi = parseInt(y, 10);
    const moi = parseInt(mo, 10);
    const di = parseInt(d, 10);
    if (yi < 2000 || yi > 2100) return null;
    if (moi < 1 || moi > 12) return null;
    if (di < 1 || di > 31) return null;
    return `${y}-${mo}-${d}`;
}

function parseIntOrZero(raw) {
    const n = parseInt(String(raw).trim(), 10);
    return Number.isFinite(n) ? n : 0;
}

// "Sun" / "Mon" / "Tue" / ... -> 0..6, else null
const DAY_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
function parseDayOfWeek(raw) {
    if (!raw) return null;
    return DAY_INDEX[String(raw).trim().slice(0, 3)] ?? null;
}

// Use Date math as the trusted source of dayOfWeek when string lookup fails.
function dayOfWeekFromIso(iso) {
    if (!iso) return null;
    const [y, m, d] = iso.split('-').map(s => parseInt(s, 10));
    // Local-noon avoids edge weirdness from DST midnight boundaries.
    return new Date(y, m - 1, d, 12, 0, 0).getDay();
}

// ----- Main entry point -----------------------------------------------------
/**
 * Parse a folder of CSV tabs and return the normalized payload.
 * @param {string} folderPath
 * @returns {object} canonical phone-usage payload (see file header)
 */
function parseFolder(folderPath) {
    const warnings = [];
    const files = findBundleFiles(folderPath);

    // Track missing required tabs as warnings rather than throwing — partial
    // data is still useful (e.g. user only has unlocks but no screen-time).
    const tabsPresent = {};
    for (const [key, fpath] of Object.entries(files)) {
        if (!fpath) {
            warnings.push(`Missing tab: ${TAB_SUFFIXES[key]} (some metrics will be unavailable)`);
            tabsPresent[key] = false;
            continue;
        }
        tabsPresent[key] = true;
    }

    // Read + parse what we have.
    const parsed = {};
    for (const [key, fpath] of Object.entries(files)) {
        if (!fpath) { parsed[key] = { rows: [] }; continue; }
        try {
            const text = fs.readFileSync(fpath, 'utf8');
            parsed[key] = parseCsvText(text);
        } catch (e) {
            warnings.push(`Could not read ${path.basename(fpath)}: ${e.message}`);
            parsed[key] = { rows: [] };
        }
    }

    // Build per-day records, keyed by ISO date. Days only show up if at
    // least one source mentions them.
    const days = {};
    const ensure = (iso, srcFile) => {
        if (!days[iso]) {
            days[iso] = {
                date: iso,
                dayOfWeek: dayOfWeekFromIso(iso),
                totalMinutes: 0,
                unlocks: 0,
                perApp: {},
                visibleRowCount: 0,
                sourceFile: srcFile || null,
            };
        }
        return days[iso];
    };

    // Daily unlocks.
    for (const r of parsed.dailyUnlocks.rows || []) {
        const iso = normalizeIsoDate(r['Date']);
        if (!iso) { warnings.push(`Daily_Unlocks: skipped row with bad date "${r['Date']}"`); continue; }
        const day = ensure(iso, r['Screenshot filename'] || null);
        day.unlocks = parseIntOrZero(r['Unlocks']);
        const explicitDow = parseDayOfWeek(r['Day']);
        if (explicitDow !== null) day.dayOfWeek = explicitDow;
    }

    // Daily screen-time.
    for (const r of parsed.dailyScreenTime.rows || []) {
        const iso = normalizeIsoDate(r['Date']);
        if (!iso) { warnings.push(`Daily_Screen_Time: skipped row with bad date "${r['Date']}"`); continue; }
        const day = ensure(iso, r['Screenshot filename'] || null);
        day.totalMinutes = parseIntOrZero(r['Total minutes']);
    }

    // Per-app screen-time. Aggregate per (date, canonical app). Chrome sub-
    // sites fold into Chrome per the user's decision in the v1.7.0 design.
    // Per-app opens are tracked separately and we currently use them only for
    // the "Top opened app" KPI; screen-time minutes are the primary metric.
    for (const r of parsed.appScreenTime.rows || []) {
        const iso = normalizeIsoDate(r['Date']);
        if (!iso) { warnings.push(`App_Screen_Time: skipped row with bad date "${r['Date']}"`); continue; }
        const rawApp = r['App'];
        if (!rawApp) continue;
        const day = ensure(iso, r['Screenshot filename'] || null);
        const canon = normalizeAppName(rawApp);
        const mins = parseIntOrZero(r['Minutes']);
        day.perApp[canon] = (day.perApp[canon] || 0) + mins;
        // Only count non-sub-site rows toward "visible row count" to keep
        // the count comparable across days where Chrome was/wasn't expanded.
        if (!isChromeSubSite(rawApp)) day.visibleRowCount += 1;
    }

    // Per-app opens. Stored on each day under perAppOpens so consumers can
    // build a "most-opened app today" KPI without re-reading the file.
    for (const r of parsed.appOpens.rows || []) {
        const iso = normalizeIsoDate(r['Date']);
        if (!iso) { warnings.push(`App_Opens: skipped row with bad date "${r['Date']}"`); continue; }
        const rawApp = r['App'];
        if (!rawApp) continue;
        const day = ensure(iso, r['Screenshot filename'] || null);
        const canon = normalizeAppName(rawApp);
        const opens = parseIntOrZero(r['Opened times']);
        if (!day.perAppOpens) day.perAppOpens = {};
        day.perAppOpens[canon] = (day.perAppOpens[canon] || 0) + opens;
    }

    return {
        source: 'csv-folder-import',
        sourceLabel: `CSV folder: ${folderPath}`,
        importedAt: new Date().toISOString(),
        days,
        warnings,
        tabsPresent,
    };
}

module.exports = {
    parseFolder,
    parseCsvText,      // exported for tests
    parseCsvLine,      // exported for tests
    normalizeIsoDate,  // exported for tests
    dayOfWeekFromIso,  // exported for tests
    TAB_SUFFIXES,
};
