# Spark Estimator

A mobile-first, offline-capable Progressive Web App (PWA) for Spark Homes acquisition agents to estimate repair costs during distressed-home walkthroughs. Agents walk room-by-room through a structured checklist of 108 line items across five sections (Interior, Kitchen, Bathrooms, Systems, Exterior, plus per-bedroom and per-living-area rooms), capture serial numbers and photos, and export a ZIP containing an Excel workbook (Estimate + Photo Manifest tabs) and all attached photos — all without a network connection after the first load.

## Run locally

**A local HTTP server is required** — `file://` URLs block service-worker registration and IndexedDB in some browsers. Run:

```bash
cd /path/to/spark-repair-estimator
python3 -m http.server 8000
```

Then open `http://localhost:8000` in Chrome (desktop or Android) or Safari (iOS). For PWA install testing use `https://` (GitHub Pages, Netlify, or `npx serve --ssl`).

## Tech stack

- **Vanilla HTML/CSS/ES Modules** — no framework, no build step, no CDN at runtime
- **IndexedDB** — project data + photo blobs (via `js/db.js`)
- **Service Worker** — full app-shell precache, cache-first offline strategy
- **Web App Manifest** — installable on Android (Chrome) and iOS (Safari Add to Home Screen)
- **Vendored libraries** (offline-safe, no CDN):
  - `vendor/jszip.min.js` — JSZip 3.10.1 (ZIP export/backup)
  - `vendor/xlsx.bundle.js` — xlsx-js-style 1.2.0 (Excel workbook)
- **Canvas API** — photo compression + thumbnail generation

## Storage note

All project data and photo blobs are stored in **IndexedDB** (database `spark-estimator`), not localStorage. localStorage holds only three tiny flags (`spark.activeProjectId`, `spark.dismissedInstallHint`, `spark.lastRoute`). This avoids silent data-loss bugs caused by mobile localStorage quota limits — the reference implementation's `localStorage` approach discards photos when the quota is exceeded.

## Project structure

```
index.html              App shell
styles.css              Hand-rolled mobile-first design system
manifest.webmanifest    PWA manifest
service-worker.js       Offline cache (spark-cache-v1)
app.js                  Boot, hash router, SW registration, install prompt
js/
  catalog.js            108 catalog items, 37 groups, room templates, helpers
  db.js                 IndexedDB Promise API
  state.js              Active-project state + mutations
  pricing.js            Cost resolution, Math.ceil rounding, CSV import/export
  photos.js             Camera capture, compression, thumbnails
  guardrails.js         Critical-group warnings
  dealAnalyzer.js       ARV / MAO deal math
  export.js             Excel + ZIP export
  backup.js             Backup ZIP export/import
  ui/
    components.js       Modal, bottom-sheet, confirm, toast, progress bar, chips
    dashboard.js        Project list view
    walkthrough.js      Room-by-room estimate entry
    summary.js          Pre-export summary + guardrail warnings
    priceBook.js        Price admin + CSV import/export
    analyzer.js         Deal analyzer view
vendor/
  jszip.min.js          JSZip 3.10.1 (vendored)
  xlsx.bundle.js        xlsx-js-style 1.2.0 (vendored)
assets/
  logo.png              Spark Group logo
  icon-192.png          PWA icon 192×192
  icon-512.png          PWA icon 512×512
  icon-maskable-512.png PWA maskable icon 512×512
  apple-touch-icon-180.png  iOS home-screen icon
  favicon.ico           Browser favicon
```

## Routes

| Hash | View |
|------|------|
| `#/` or `#/dashboard` | Project list |
| `#/project/:id` | Room walkthrough |
| `#/project/:id/summary` | Pre-export summary |
| `#/project/:id/analyzer` | Deal analyzer |
| `#/pricebook` | Global price book admin |

## PWA install

- **Android/Chrome:** Tap the browser install banner or the in-app "Install" button.
- **iOS/Safari:** Tap Share → Add to Home Screen. (No `beforeinstallprompt` on iOS; the app detects iOS Safari and shows a one-time instruction hint.)

After install, the app works fully offline (airplane mode) after one successful online load.
