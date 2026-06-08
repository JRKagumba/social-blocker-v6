// phoneStayFreeParser.js
// -----------------------------------------------------------------------------
// Parses a StayFree export bundle (3-tab CSV: "Usage Time", "Usage Count",
// "Device Unlocks") and returns the same canonical phone-usage payload as
// phoneCsvParser.parseFolder() so the rest of the app can consume both
// sources identically.
//
// Why a separate parser? The shape is fundamentally different:
//   Digital Wellbeing OCR = LONG format (one row per app-day pair)
//   StayFree              = WIDE format (rows = apps, columns = dates,
//                                         cells = "1h 23m" durations)
// The transform is a pivot + duration parsing + duplicate-app aggregation.
//
// Filename convention (from StayFree's manual export):
//   "StayFree Export - Total Usage - M_D_YY ... - Usage Time.csv"
//   "StayFree Export - Total Usage - M_D_YY ... - Usage Count.csv"
//   "StayFree Export - Total Usage - M_D_YY ... - Device Unlocks.csv"
// Detection key = the trailing "- Usage Time.csv" etc. suffix (case-insensitive).
//
// Edge cases handled:
//   - Duplicate app rows ("Authenticator" appearing twice for Google +
//     Microsoft Authenticator): summed per (date, app).
//   - The trailing "Total Usage" summary row: skipped (not an app).
//   - Footer rows ("Created by 'StayFree'.", "Creation date: ..."): skipped.
//   - All-zero columns (StayFree pre-install date range): days with
//     totalMinutes === 0 AND no per-app entries are dropped from the
//     payload so they don't overwrite better data from other sources.
//   - Duration strings: "0s" -> 0, "4m 50s" -> 5, "1h 23m" -> 83.
//     Rounded to nearest minute. Sub-minute usage rounds to 0.
//   - Date strings: "May 12, 2026" -> "2026-05-12".
// -----------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const { parseCsvText, dayOfWeekFromIso } = require('./phoneCsvParser');
const { normalizeAppName } = require('./phoneAppNormalizer');

const TAB_SUFFIXES = {
    usageTime: '- Usage Time.csv',
    usageCount: '- Usage Count.csv',
    deviceUnlocks: '- Device Unlocks.csv',
};

// Three-letter month abbreviations and full names both supported; StayFree
// uses full names ("May", "June") but defensive against locale variants.
const MONTHS = {
    Jan: 1, January: 1, Feb: 2, February: 2, Mar: 3, March: 3,
    Apr: 4, April: 4, May: 5, Jun: 6, June: 6,
    Jul: 7, July: 7, Aug: 8, August: 8, Sep: 9, Sept: 9, September: 9,
    Oct: 10, October: 10, Nov: 11, November: 11, Dec: 12, December: 12,
};

/**
 * Parse a StayFree-formatted date header like "May 12, 2026" -> "2026-05-12".
 * Returns null if the header isn't a recognizable date (e.g. "Device" or
 * "Total Usage" header columns).
 */
function parseStayFreeDate(headerCell) {
    if (typeof headerCell !== 'string') return null;
    const m = headerCell.trim().match(/^([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})$/);
    if (!m) return null;
    const monthName = m[1];
    const day = parseInt(m[2], 10);
    const year = parseInt(m[3], 10);
    const month = MONTHS[monthName];
    if (!month || day < 1 || day > 31 || year < 2000 || year > 2100) return null;
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Parse a StayFree duration cell like "0s", "4m 50s", "1h 23m 28s" into
 * an integer minute count using ROUND-HALF-TO-NEAREST on the residual
 * seconds. Specifically:
 *   - Seconds  0-29 round DOWN (effectively discarded)
 *   - Seconds 30-59 round UP   (counted as +1 minute)
 *
 * This matches typical human "about how long" intuition without inflating
 * short app launches. 1-2 second taps disappear; 45s gets counted as 1 min.
 *
 * Examples:
 *   "0s"            -> 0
 *   "29s"           -> 0       (sub-30s rounds down)
 *   "34s"           -> 1       (>=30s rounds up)
 *   "1m"            -> 1
 *   "4m 50s"        -> 5       (50s rounds 4 -> 5)
 *   "9m 30s"        -> 10      (30s rounds 9 -> 10)
 *   "1h 23m 28s"    -> 83      (60 + 23 + round(28/60) = 60 + 23 + 0)
 *   "1h 23m 31s"    -> 84
 *   "5h"            -> 300
 *   ""              -> 0
 *
 * Returns 0 for empty/null/garbage so we never insert NaN into the store.
 */
function parseStayFreeDuration(raw) {
    if (raw === null || raw === undefined) return 0;
    const s = String(raw).trim();
    if (s === '' || s === '0s' || s === '0') return 0;

    let hours = 0;
    let minutes = 0;
    let seconds = 0;

    const hMatch = s.match(/(\d+)\s*h/);
    if (hMatch) hours = parseInt(hMatch[1], 10) || 0;

    const mMatch = s.match(/(\d+)\s*m(?!s)/); // 'm' not followed by 's' (don't match 'ms' if present)
    if (mMatch) minutes = parseInt(mMatch[1], 10) || 0;

    const sMatch = s.match(/(\d+)\s*s\b/);
    if (sMatch) seconds = parseInt(sMatch[1], 10) || 0;

    // If we matched nothing at all but s is purely numeric, treat as bare seconds.
    if (!hMatch && !mMatch && !sMatch && /^\d+$/.test(s)) {
        seconds = parseInt(s, 10);
    }

    return hours * 60 + minutes + Math.round(seconds / 60);
}

/**
 * Parse a StayFree "wide" tab (Usage Time or Usage Count) into a long-form
 * intermediate: array of { date, app, value }. Filters out:
 *   - The "Total Usage" summary row (last data row in StayFree exports)
 *   - The "Device" column (column 2 in Usage Time/Count, contains device name)
 *   - Footer noise ("Created by 'StayFree'.", "Creation date: ...")
 *   - Header columns that aren't dates (the trailing "Total Usage" col)
 *
 * @param {string} csvText  Raw CSV file contents.
 * @param {function} valueFn  Cell-value parser. parseStayFreeDuration for the
 *                            Usage Time tab, parseInt for the Usage Count tab.
 * @returns {Array<{date: string, app: string, value: number}>}
 */
function pivotWideTab(csvText, valueFn) {
    const { header, rows } = parseCsvText(csvText);
    // Header[0] is empty (the app-name column has no label).
    // Header[1] is "Device" (skip).
    // Headers[2..] are dates OR the trailing "Total Usage" label (skip).
    const dateColumns = []; // [{ idx, iso }, ...]
    for (let i = 0; i < header.length; i++) {
        const iso = parseStayFreeDate(header[i]);
        if (iso) dateColumns.push({ idx: i, iso });
    }

    const out = [];
    for (const row of rows) {
        const appRaw = row[header[0]];
        if (!appRaw || appRaw.trim() === '') continue;
        const app = appRaw.trim();
        // Skip the summary row + footer markers.
        if (app === 'Total Usage') continue;
        if (app.startsWith('Created by')) continue;
        if (app.startsWith('Creation date')) continue;

        for (const { idx, iso } of dateColumns) {
            const cellHeaderName = header[idx];
            const cell = row[cellHeaderName];
            const value = valueFn(cell);
            if (value > 0) {
                out.push({ date: iso, app, value });
            }
        }
    }
    return out;
}

/**
 * Parse the Device Unlocks tab. Different shape: single data row labeled
 * "Device Unlocks" with one integer per date column. Returns a map
 * { '2026-05-29': 151, '2026-05-30': 83, ... }.
 */
function parseDeviceUnlocks(csvText) {
    const { header, rows } = parseCsvText(csvText);
    const dateColumns = [];
    for (let i = 0; i < header.length; i++) {
        const iso = parseStayFreeDate(header[i]);
        if (iso) dateColumns.push({ idx: i, iso });
    }
    const result = {};
    for (const row of rows) {
        const firstColName = header[0]; // unlabeled in StayFree exports
        const label = (row[firstColName] || '').trim();
        if (label !== 'Device Unlocks') continue;
        for (const { idx, iso } of dateColumns) {
            const cell = row[header[idx]];
            const n = parseInt(cell, 10);
            if (Number.isFinite(n) && n > 0) result[iso] = n;
        }
        break;
    }
    return result;
}

// ---------------------------------------------------------------------------
// File-bundle discovery
// ---------------------------------------------------------------------------
function findBundleFiles(folderPath) {
    let entries;
    try {
        entries = fs.readdirSync(folderPath);
    } catch (e) {
        throw new Error(`Could not read folder: ${folderPath} (${e.code || e.message})`);
    }
    const found = { usageTime: null, usageCount: null, deviceUnlocks: null };
    for (const name of entries) {
        const lower = name.toLowerCase();
        if (!lower.endsWith('.csv')) continue;
        for (const [key, suffix] of Object.entries(TAB_SUFFIXES)) {
            if (lower.endsWith(suffix.toLowerCase())) {
                found[key] = path.join(folderPath, name);
            }
        }
    }
    return found;
}

/**
 * Quick detector callers can use BEFORE invoking the parser to decide
 * whether a folder is a StayFree bundle. Returns true if at least one of
 * the three StayFree-suffix files exists.
 */
function looksLikeStayFreeBundle(folderPath) {
    try {
        const files = findBundleFiles(folderPath);
        return !!(files.usageTime || files.usageCount || files.deviceUnlocks);
    } catch (e) {
        return false;
    }
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------
/**
 * Parse a StayFree-format folder. Returns the canonical phone-usage payload
 * (same shape as phoneCsvParser.parseFolder) so the storage layer treats
 * both sources identically.
 */
function parseFolder(folderPath) {
    const warnings = [];
    const files = findBundleFiles(folderPath);

    if (!files.usageTime && !files.usageCount && !files.deviceUnlocks) {
        throw new Error('No StayFree CSV files found in folder (expected suffixes: "- Usage Time.csv", "- Usage Count.csv", "- Device Unlocks.csv")');
    }

    if (!files.usageTime) warnings.push('Missing tab: "- Usage Time.csv" (screen-time data unavailable)');
    if (!files.usageCount) warnings.push('Missing tab: "- Usage Count.csv" (per-app open counts unavailable)');
    if (!files.deviceUnlocks) warnings.push('Missing tab: "- Device Unlocks.csv" (daily unlock counts unavailable)');

    const timeRecords = files.usageTime
        ? pivotWideTab(fs.readFileSync(files.usageTime, 'utf8'), parseStayFreeDuration)
        : [];
    const countRecords = files.usageCount
        ? pivotWideTab(fs.readFileSync(files.usageCount, 'utf8'), (v) => parseInt(String(v).trim(), 10) || 0)
        : [];
    const unlocksByDate = files.deviceUnlocks
        ? parseDeviceUnlocks(fs.readFileSync(files.deviceUnlocks, 'utf8'))
        : {};

    // Build per-day records. Apps with duplicate names (e.g. two "Authenticator"
    // apps) get summed because the wide CSV gives no other disambiguator.
    const days = {};
    const ensure = (iso, srcFile) => {
        if (!days[iso]) {
            days[iso] = {
                date: iso,
                dayOfWeek: dayOfWeekFromIso(iso),
                totalMinutes: 0,
                unlocks: 0,
                perApp: {},
                perAppOpens: {},
                visibleRowCount: 0,
                sourceFile: srcFile || null,
            };
        }
        return days[iso];
    };

    for (const r of timeRecords) {
        const canon = normalizeAppName(r.app);
        if (!canon) continue;
        const day = ensure(r.date, path.basename(files.usageTime || ''));
        day.perApp[canon] = (day.perApp[canon] || 0) + r.value;
        // Only count unique canonical apps toward visibleRowCount.
        if (day.perApp[canon] === r.value) day.visibleRowCount += 1;
    }
    for (const r of countRecords) {
        const canon = normalizeAppName(r.app);
        if (!canon) continue;
        const day = ensure(r.date, path.basename(files.usageCount || ''));
        day.perAppOpens[canon] = (day.perAppOpens[canon] || 0) + r.value;
    }
    for (const [iso, n] of Object.entries(unlocksByDate)) {
        const day = ensure(iso, path.basename(files.deviceUnlocks || ''));
        day.unlocks = n;
    }

    // Compute totalMinutes from the sum of perApp (StayFree wide format
    // doesn't include a pre-summed per-day total per the source CSV — its
    // "Total Usage" row is a per-COLUMN aggregate, not per-row).
    for (const day of Object.values(days)) {
        day.totalMinutes = Object.values(day.perApp).reduce((a, n) => a + n, 0);
    }

    // Drop empty days: no screen time AND no unlocks AND no opens.
    // This filters out StayFree's pre-install date range (all-zero columns)
    // so we don't overwrite good data from other sources.
    for (const iso of Object.keys(days)) {
        const d = days[iso];
        const hasAnything = d.totalMinutes > 0 || d.unlocks > 0 || Object.keys(d.perAppOpens).length > 0;
        if (!hasAnything) delete days[iso];
    }

    return {
        source: 'stayfree-export',
        sourceLabel: `StayFree export: ${folderPath}`,
        importedAt: new Date().toISOString(),
        days,
        warnings,
        tabsPresent: {
            usageTime: !!files.usageTime,
            usageCount: !!files.usageCount,
            deviceUnlocks: !!files.deviceUnlocks,
        },
    };
}

module.exports = {
    parseFolder,
    parseStayFreeDuration,    // exported for tests
    parseStayFreeDate,        // exported for tests
    parseDeviceUnlocks,       // exported for tests
    pivotWideTab,             // exported for tests
    looksLikeStayFreeBundle,  // exported for the auto-detect path
    TAB_SUFFIXES,
};
