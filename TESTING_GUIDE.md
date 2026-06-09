# Testing Guide for Social Blocker v6 - Fixes

## Changes Implemented

### Issue #1: Batched Hosts File Updates (Reduced Admin Prompts)
**Status:** ✅ Implemented

**What Changed:**
- Added "Save & Apply Changes" button in a prominent yellow banner
- Toggle switches now update pending state WITHOUT triggering UAC prompts
- User can make multiple changes and apply them all at once
- Added "Revert Changes" button to undo pending changes
- Keyboard shortcut: **Ctrl+S** to apply pending changes
- Visual preview shows exactly what will be blocked/unblocked

**How to Test:**
1. Start the app: `npm start`
2. Toggle multiple site switches on/off
3. Notice: 
   - Yellow banner appears at top with warning icon
   - Shows count of unsaved changes
   - Master Status section shows preview of pending changes
   - NO UAC prompt appears yet
4. Click "Save & Apply Changes" button
5. Notice: ONE UAC prompt appears for all changes
6. Try clicking "Revert Changes" to test undo functionality
7. Try using **Ctrl+S** keyboard shortcut to apply changes

### Issue #2: Tray Icon Not Showing
**Status:** ✅ Implemented

**What Changed:**
- Updated `package.json` to include `extraResources` for icon.ico
- Fixed icon path resolution for both development and production builds
- Added comprehensive diagnostic logging to help troubleshoot
- Icon now uses proper path: `process.resourcesPath/icon.ico` in production

**How to Test - Development:**
1. Start the app: `npm start`
2. Check console for tray diagnostic logs:
   ```
   === TRAY DIAGNOSTIC ===
   App is packaged: false
   Icon path: C:\...\icon.ico
   Icon exists: true
   ...
   ```
3. Look for tray icon in Windows system tray (bottom-right)
4. If not visible, click the "^" arrow to show hidden icons
5. Right-click the icon to test context menu
6. Left-click the icon to show/hide window

**How to Test - Production:**
1. Build the app: `npm run build`
2. Navigate to `dist\win-unpacked\`
3. Run `Social Blocker v6.exe`
4. Check for tray icon (may need to rebuild first)
5. After rebuild, verify icon.ico exists in:
   - `dist\win-unpacked\resources\icon.ico`

**IMPORTANT:** You need to rebuild the app for the icon fix to take effect:
```bash
npm run build
```

### Issue #3: Twitter/X False-Positive Usage Tracking
**Status:** ✅ Implemented

**Symptom:** Twitter/X usage climbs even when you're not on X.

**Root Causes Fixed:**
- The tracker was counting time even when the active window was **not a browser**.
- Some historic configs accidentally used overly-broad keywords (like a bare `"x"`).

**What Changed:**
- Usage tracking now **only counts time when the active app is a browser** (e.g., `chrome.exe`, `msedge.exe`).
- Site matching prefers `matchPatterns` (regex strings) over simple substring matching.
- Keywords are sanitized (1–2 character tokens are ignored, and Twitter/X will never use bare `x`).

**How to Test:**
1. Run the app: `npm start`
2. Open Chrome/Edge and visit **X/Twitter** for ~15 seconds.
3. Switch to a non-browser app (VS Code, Notion, Spotify, etc.) for ~30 seconds.
4. Expected:
   - Twitter/X usage only increments while the browser is active AND the title matches Twitter/X patterns.
   - No more “X time” when you're not even in a browser.

### Issue #4: Reddit Tracking / Blocking Reliability
**Status:** ✅ Implemented

**What Changed:**
- Reddit domains were expanded to include common subdomains that the hosts file treats separately:
  - `old.reddit.com`, `new.reddit.com`, `np.reddit.com`, `redd.it`
- Added regex match patterns for `reddit.com` / `redd.it`.

**How to Test:**
1. Visit `reddit.com`, `old.reddit.com`, and a `redd.it` link (if you have one).
2. Confirm:
   - Usage increments consistently.
   - Blocking toggles (once applied) block those variants.

### Issue #5: Messenger Added as a First-Class Site
**Status:** ✅ Implemented

**What Changed:**
- Added **Messenger** to `siteSettings` with domains + match patterns.
- Migration adds the site to existing installs **without auto-blocking it** (so you won't get surprise blocks).

**How to Test:**
1. Open the app UI and confirm **Messenger** appears.
2. Toggle Messenger to block, click **Save & Apply Changes**.
3. Visit `messenger.com` in Chrome/Edge → should be blocked.
4. Confirm Messenger usage increments when active.

## Known Behavior

### Auto-Blocks Still Trigger UAC
When a time limit is reached and a site is auto-blocked, this WILL still trigger a UAC prompt. This is intentional because:
- It's a security feature (preventing sites from being accessed)
- It happens automatically, not from user interaction
- It's a single prompt per limit reached

### Nuclear Option
The "Nuclear Option" button now works with the batching system:
- Marks all sites as "to be blocked"
- Shows pending changes banner
- Still requires clicking "Save & Apply Changes"

### Deep Work Mode
Deep Work mode blocks sites immediately (bypasses batching) because it's a deliberate focus session.

## Files Modified

1. **package.json** - Added `extraResources` configuration
2. **main.js** - Fixed tray icon path resolution, added diagnostic logging
3. **index.html** - Added pending changes banner and preview section
4. **renderer.js** - Complete refactor of toggle handling to support batching

## Verification Checklist

- [ ] Multiple toggle changes don't trigger multiple UAC prompts
- [ ] "Save & Apply Changes" button appears when changes are pending
- [ ] "Revert Changes" button restores previous state
- [ ] Ctrl+S keyboard shortcut works to apply changes
- [ ] Preview section shows what will be blocked/unblocked
- [ ] Auto-blocks (time limit reached) still work correctly
- [ ] Tray icon appears in system tray (dev mode)
- [ ] Tray icon appears in production build
- [ ] Tray context menu works (right-click)
- [ ] Tray click shows/hides window

## Troubleshooting

### Tray Icon Still Not Showing?

1. **Check Windows Settings:**
   - Settings → Personalization → Taskbar
   - "Select which icons appear on the taskbar"
   - Make sure app isn't hidden

2. **Check Icon Dimensions:**
   - Your icon.ico is 221KB which is quite large
   - Verify it contains 16x16 and 32x32 sizes:
     - Right-click icon.ico → Properties → Details
     - Or use an online icon viewer

3. **Check Console Logs:**
   - Look for diagnostic output starting with "=== TRAY DIAGNOSTIC ==="
   - Check if "Icon exists" is true

4. **Try Rebuilding:**
   ```bash
   # Clean old build
   rmdir /s dist
   
   # Rebuild
   npm run build
   ```

### Can't Get the App on the Taskbar (Only Tray)

**Why this happens:** This app is intentionally designed to hide to the tray when you close the window.
That means you won't always see it in the taskbar.

**Ways to Pin / Access Quickly (Windows):**
1. **Pin the installed shortcut**
   - Build + install the NSIS installer (`npm run build`)
   - Open Start → find **Social Blocker v6** → right click → **Pin to taskbar**
2. **Pin the EXE directly**
   - Navigate to the install folder (usually `C:\Program Files\...`) → right click the app exe → Pin to taskbar
3. **If you're running `npm start` (dev mode):**
   - Taskbar pinning is unreliable; use the tray icon or install a production build.

### Messenger App Going Away (Workaround)

If you want Messenger to behave like a taskbar app (separate icon), install it as a **PWA**:
- **Edge:** `...` menu → **Apps** → **Install this site as an app** (on `messenger.com`)
- Then open the installed Messenger app → right click its taskbar icon → **Pin to taskbar**

### Admin Prompts Still Appearing on Every Toggle?

1. Make sure you're clicking "Save & Apply Changes" button, not the toggles themselves
2. If toggles are still triggering immediately, check browser console for JavaScript errors
3. Try refreshing the app with Ctrl+R

## Next Steps

1. Test in development mode first
2. If everything works, rebuild for production
3. Test the production build
4. Verify icon appears in built version
5. Test that batching reduces UAC prompts to once per session

## Questions or Issues?

- Check console logs for detailed diagnostics
- Tray diagnostic logs show icon path and existence
- Toggle behavior should now show yellow banner instead of immediate UAC




## New: Lock Today (strict, no unlock until tomorrow)
1. Launch the app and ensure Website Controls are visible.
2. Pick a site that is currently **not** limit-reached (e.g., Instagram before it hits the limit).
3. Click **Lock today**.
   - You should get a single UAC prompt (same as Apply Changes).
   - After it applies, the site row should become **greyed out** and show **Locked today**.
   - The toggle should be **disabled** (you cannot unlock it today).
4. Close and re-open the app: the site should still show **Locked today** (same day).
5. Change your system date to tomorrow (optional test): the lock should disappear in the UI (toggle enabled again).

## New: Startup behavior (dev vs packaged)
- **Dev mode (`npm start`)**: app should NOT register itself to start on login.
- **Packaged build**: app may register to start on login (minimized).

If you ever see the generic **Electron** splash screen at boot:
- Disable the startup entry in **Task Manager → Startup apps** (or **Settings → Apps → Startup**).
