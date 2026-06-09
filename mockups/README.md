# Mockups

These are standalone HTML previews of proposed UI changes. They are NOT loaded by the running app.

To review: double-click any `.html` file to open it in your browser. Each preview is self-contained (Tailwind CDN only) and matches the production app's design system.

| File | What it previews | Status |
|---|---|---|
| `hud-widget.html` | Item D — small always-on-top HUD (bottom-right, compact) | Ready for review |
| `deep-work-editor.html` | Item C — editable Deep Work block list + force-disable state | Ready for review |
| `email-digest-report.html` | Item A — weekly local-HTML digest saved to Google Drive | Ready for review |
| `dashboard-apple-screentime.html` | Item E — UI revamp variant 1 (Apple Screen Time aesthetic) | Pick one |
| `dashboard-linear.html` | Item E — UI revamp variant 2 (Linear aesthetic) | Pick one |

After review, approved mockups get ported into `index.html` / `renderer.js` / new HUD `BrowserWindow`. Rejected ones get revised here first.
