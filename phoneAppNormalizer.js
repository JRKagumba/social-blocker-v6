// phoneAppNormalizer.js
// -----------------------------------------------------------------------------
// Canonicalizes phone app display names so they line up with the desktop
// tracker's site catalog. Two responsibilities:
//
//   1. Display-name canonicalization. Mostly identity (`YouTube` -> `YouTube`)
//      because Digital Wellbeing already uses human-readable names. The
//      explicit map exists so we can centrally fix any future drift (e.g. if
//      Pixel ever renames `X` back to `Twitter`).
//
//   2. Chrome sub-site folding (per the v1.7.0 design decision in the
//      conversation). Digital Wellbeing's "Show sites you visit" view lists
//      every distinct domain visited in Chrome as its own row (e.g.
//      `google.com`, `nytimes.com`, `diamondleague.com`). For phone Insights
//      we collapse all of those into the parent `Chrome` bucket so the user
//      sees "Chrome: 27 min" rather than 12 individual sub-sites that each
//      register 1-2 min.
//
// Why a separate file? Both the parser and any future ADB/StayFree feeder
// will need the same mapping, and we want one place to update it when the
// app catalog evolves.
// -----------------------------------------------------------------------------

// Explicit display-name -> canonical mappings. Everything not listed here is
// returned unchanged (with a basic trim). Add entries here only when the
// phone-side display string differs from the canonical we want internally.
const DISPLAY_NAME_MAP = {
    // No remappings needed today — Digital Wellbeing uses the same display
    // names the desktop tracker does. The hook exists so future drift (e.g.
    // "Twitter" vs "X", or "Phone" being ambiguous with the device itself)
    // can be patched centrally.
};

// Heuristic: a Chrome "sub-site" is any name that looks like a hostname rather
// than an app display name (contains a dot, no spaces, length < 60). This is
// safer than a hardcoded allowlist because new sub-sites appear constantly.
function isChromeSubSite(rawName) {
    if (typeof rawName !== 'string') return false;
    const s = rawName.trim();
    if (s.length === 0 || s.length > 60) return false;
    // Real app display names never contain '.'; hostnames always do.
    if (!s.includes('.')) return false;
    // Spaces disqualify (no real hostname has spaces).
    if (/\s/.test(s)) return false;
    // Bare domain shape: one-or-more labels separated by dots, each label
    // letters/digits/hyphens. Lets us reject e.g. "1.2.3.4" if we ever care.
    return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(s);
}

/**
 * Map a raw phone app display name to its canonical name. Chrome sub-sites
 * fold to "Chrome". Empty/garbage inputs return null so callers can skip.
 *
 * @param {string} rawName  As it appears in the phone CSV (e.g. "YouTube",
 *                          "google.com", "WhatsApp").
 * @returns {string|null}   Canonical app name, or null if input is unusable.
 */
function normalizeAppName(rawName) {
    if (typeof rawName !== 'string') return null;
    const trimmed = rawName.trim();
    if (trimmed.length === 0) return null;

    // Sub-site fold takes precedence over the display map.
    if (isChromeSubSite(trimmed)) return 'Chrome';

    if (Object.prototype.hasOwnProperty.call(DISPLAY_NAME_MAP, trimmed)) {
        return DISPLAY_NAME_MAP[trimmed];
    }
    return trimmed;
}

module.exports = {
    normalizeAppName,
    isChromeSubSite,
    DISPLAY_NAME_MAP, // exported for tests + future override UI
};
