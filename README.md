# Social Blocker v6

An Electron desktop app that helps you **limit** and **block** time-wasting sites, with simple on-device usage tracking.

## What it does

### Blocking
- Uses the Windows **hosts file** to block domains at the OS level
- UI supports **per-site toggles** (batch changes, then apply once) to reduce repeated UAC prompts
- **Lock Today (strict discipline):** you can click **Lock today** on any site to block it immediately and **prevent unlocking until tomorrow**
- Deep Work mode can temporarily block a separate list of "deep work sites"

### Usage tracking
- Uses `active-win` to read the current active window's title
- **Only tracks when the active app is a browser** (`chrome.exe`, `msedge.exe`, etc.)
- Matches sites using **safe regex patterns** (`matchPatterns`) with a keyword fallback
  - This specifically prevents the historic **Twitter/X false positive** issue caused by overly-generic keywords like `"x"`

## Sites included (defaults)

- YouTube
- Facebook
- Instagram
- Twitter/X
- Reddit
- LinkedIn
- Messenger

Deep Work default list (in `main.js`): `web.whatsapp.com`, `messenger.com`, `www.messenger.com`

## Run locally

```bash
git clone https://github.com/JRKagumba/social-blocker-v6.git
cd social-blocker-v6
npm install
npm start
```

## Build (Windows)

```bash
npm run build
```

## Debugging tips

### App opens the Electron splash screen at Windows startup
This usually happens if `npm start` (dev mode) accidentally registered the Electron binary to start on login.
This project only registers startup **in packaged builds**; dev mode forces startup **off**.

If you already have a bad startup entry:
- Open **Task Manager → Startup apps** and disable any "Electron" / unknown entry related to this project
- Or open **Settings → Apps → Startup** and disable it


### "Twitter/X says I used it all day"
1) Ensure you're on the updated code (see `usageTracker.js` and `dataManager.js`).
2) Run the app and use debug mode to capture window titles:
   - In the main process console: `startDebugMode()`
   - Then visit X/Twitter for ~10–15 seconds, and also browse unrelated sites.
3) Inspect the log written to your Downloads folder (path is printed in the console).

### Add / tweak sites
Edit **`dataManager.js`** → `getDefaultSiteSettings()`:
- `domains` affect hosts-file blocking
- `matchPatterns` affect usage tracking (recommended)
- `keywords` are a fallback (keep them specific)

## License

MIT
