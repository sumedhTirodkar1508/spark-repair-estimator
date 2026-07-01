# Spark Repair Estimator

Spark Repair Estimator is a mobile-first, offline-capable Progressive Web App for real-estate acquisition teams to create repair estimates during distressed-home walkthroughs.

The app lets an agent walk room-by-room through a property, select repair line items, enter quantities, capture photos, record serial/model information manually, review critical-cost warnings, analyze the deal, and export a professional ZIP package containing an Excel workbook and attached photos.

It is designed to work in the field, including low-connectivity situations, after the app has been loaded once.

## Live Demo

Deployed app:

```txt
https://spark-repair-estimator-sumedh.vercel.app/#/dashboard
```

## Submission Deliverables

This submission includes:

- Live deployed static app: https://spark-repair-estimator-sumedh.vercel.app/#/dashboard
- GitHub repository with all source/static files
- One-page PDF writeup covering the required submission prompts

The app has no build step, backend, login, API server, database server, or dependency installation requirement.

## Core Features

- Offline-first mobile PWA
- Installable on Android Chrome and iOS Safari Add to Home Screen
- Project dashboard with multiple property walkthroughs
- Room-by-room repair estimate workflow
- Interior, Kitchen, Bathrooms, Systems, Exterior, Bedrooms, and Living areas
- Add, rename, duplicate, and remove room instances
- 108 official repair price-list items
- Required repair groups plus supplemental groups to avoid hidden/orphan costs
- No Work Needed toggle for fast inspection flow
- Bulk No-Work sweep for non-critical unreviewed groups
- Critical groups protected from silent bulk marking
- Quantity inputs and quick quantity chips
- Per-project item price overrides
- Global Price Book
- CSV price import/export with row-level warnings
- Photo capture/upload with IndexedDB blob storage
- Manual serial/model/brand/year/notes capture for equipment
- Critical cost guardrails before export
- Deal Analyzer with ARV, offer price, MAO, expected profit, and PASS/WATCH/FAIL status
- ZIP export with Excel workbook and photos
- Backup and restore using ZIP files
- Import-as-copy support for duplicate project backups
- No backend, no login, no API calls required

## Tech Stack

- Vanilla HTML, CSS, and JavaScript ES Modules
- Hash routing with `window.location.hash`
- IndexedDB for project data and photo blobs
- localStorage only for tiny local flags
- Service Worker for offline app-shell caching
- Web App Manifest for installability
- Canvas API for image compression and thumbnail generation
- Vendored JSZip for ZIP generation
- Vendored xlsx-js-style for Excel workbook generation
- Static hosting on Vercel

There is no React, Next.js, backend server, database server, Supabase, authentication, or runtime CDN dependency.

## Why This Is a Static PWA

This project is intentionally built as a static offline-first app because the field user may not have reliable connectivity during a property walkthrough.

All data is stored locally in the browser using IndexedDB. The app shell is cached by the service worker, and the export flow works without a backend after the first successful load.

## Run Locally

The app is fully static and runs from the deployed link without installing dependencies. The repo includes all static files and has no build step.

For local testing, use a simple static file server instead of opening `index.html` directly with a `file://` URL. Browser features such as ES modules, service workers, IndexedDB, and PWA install behavior can be blocked or inconsistent from `file://`.

From the project root:

```bash
python3 -m http.server 8000
```

Then open:

```txt
http://localhost:8000
```

For realistic mobile/PWA testing, use the deployed HTTPS URL instead of a local Mac IP address.

## Deploying as a Static App on Vercel

This app has no build step.

Recommended Vercel settings:

```txt
Framework Preset: Other
Build Command: empty
Output Directory: .
Install Command: empty
Root Directory: .
```

Vercel simply serves the static files:

```txt
index.html
app.js
styles.css
manifest.webmanifest
service-worker.js
js/
vendor/
assets/
```

## PWA Install Notes

### Android Chrome

Android Chrome may show an install prompt, but install prompts are browser-controlled and are not guaranteed.

Manual install:

```txt
Chrome menu ⋮ → Add to Home screen / Install app
```

### iOS Safari

iOS does not support the Android-style install prompt.

Manual install:

```txt
Safari → Share → Add to Home Screen
```

## Offline Testing

For reliable offline testing, use the deployed HTTPS URL.

Recommended test flow:

1. Open the deployed Vercel URL while online.
2. Wait for the app to fully load.
3. Install the app or add it to the home screen.
4. Open the installed app once while online.
5. Turn on airplane mode.
6. Reopen the installed app.
7. Confirm dashboard, project walkthrough, photos, estimates, and export still work.

If old code appears after a deployment, clear the browser’s site data and unregister the old service worker.

## Price Book CSV Format

CSV import expects these columns:

```csv
id,name,cost,unit
```

Import rules:

- Items are matched by `id`.
- Only `cost` is applied.
- Uploaded `name` and `unit` do not overwrite the catalog.
- Unknown item IDs are skipped.
- Invalid or negative costs are skipped.
- Name/unit mismatches are shown as warnings.
- Missing known IDs leave current prices unchanged.
- A preview is shown before changes are applied.

This protects calculation integrity while still allowing price updates.

## Rounding Rule

The app uses a single pricing rule:

```txt
line total = Math.ceil(quantity × exact resolved unit cost)
grand total = sum of rounded line totals
```

Unit costs may contain decimals, but final line totals are rounded up to whole dollars.

## Export Output

The export flow creates a ZIP file containing:

- Excel workbook
- Attached photos in a `photos/` folder

The Excel workbook includes:

- `Estimate` — selected repair items, unit costs, quantities, line totals, room totals, and grand total
- `Photo Manifest` — exported photo filenames mapped to room/group/item context, including serial/model metadata when available
- `Guardrail Warnings` — critical category warnings such as unreviewed HVAC/electrical/roof/plumbing items or missing serial/roof photos
- `Deal Analyzer` — ARV, offer price, repair estimate, selling/holding costs, target profit, expected profit, MAO, and PASS/WATCH/FAIL status when completed
- `Review Summary` — reviewed group count, No Work group count, selected item count, critical warning count, photo count, serial photo count, grand estimate, and export timestamp

The workbook and ZIP are generated fully client-side using vendored offline-safe libraries.

## Backup and Restore

The backup flow exports the complete project state and photos into a ZIP file.

Backup includes:

- project record
- rooms
- selected items
- quantities
- notes
- No Work statuses
- serial/model metadata
- project price overrides
- Deal Analyzer inputs
- photo index
- photo files

Restore supports:

- Replace Current Project
- Replace Existing Project
- Import as Copy

When replacing the current project, the current project ID and project name are preserved by default, while the walkthrough data, rooms, selections, quantities, notes, photos, serial fields, price overrides, and analyzer values are restored from the backup.

Repeated copy imports use unique names such as:

```txt
My Project (Copy)
My Project (Copy 2)
My Project (Copy 3)
```

Restore is intended as the app’s offline-friendly project transfer and recovery mechanism.

## Storage and Privacy

All project data stays in the browser.

Stored locally:

- project records
- selections
- quantities
- notes
- photos
- thumbnails
- serial metadata
- price overrides
- backup/import state

No data is sent to a server by the app.

## Known Limitations

- Data is local to the device unless exported/imported through backup ZIP files.
- Android install prompts are browser-controlled and may not appear automatically.
- iOS installation is manual through Safari’s Share menu.
- Speech input is best handled through the device keyboard’s built-in dictation.
- OCR is intentionally not included. Equipment labels vary widely in lighting, angle, dirt, glare, and model format; offline OCR would add app size and reliability risk. The app instead prioritizes dependable manual serial/model capture with proof photos.
- Clearing browser site data will remove locally stored projects unless they were backed up first.

## Project Structure

```txt
index.html
styles.css
manifest.webmanifest
service-worker.js
app.js
assets/
vendor/
js/
```

## For Reviewers: File-by-File Architecture

### `index.html`

The static app shell.

It defines:

- root app container
- modal root
- bottom-sheet root
- toast root
- manifest link
- iOS PWA meta tags
- app entry script

### `app.js`

The app boot and routing layer.

It handles:

- service worker registration
- install prompt handling
- iOS/Android install hints
- hash route parsing
- dashboard route
- project walkthrough route
- Price Book route
- Review & Export route
- Deal Analyzer route
- save flushing on page hide

### `styles.css`

The hand-built design system.

It handles:

- dark theme
- layout
- cards
- buttons
- sticky headers
- progress bars
- tabs
- bottom bars
- modals
- sheets
- mobile responsiveness
- animations
- focus states
- safe-area spacing

### `manifest.webmanifest`

The PWA manifest.

It defines:

- app name
- short name
- icons
- display mode
- start URL
- theme color
- standalone behavior

### `service-worker.js`

The offline app-shell cache.

It precaches:

- HTML
- CSS
- JS modules
- vendor libraries
- manifest
- icons/assets

It allows the app to load offline after a successful first load.

### `js/catalog.js`

The repair catalog and grouping model.

It contains:

- 108 official catalog items
- item IDs
- item names
- default costs
- units
- required groups
- supplemental groups
- room templates
- critical group metadata
- serial-required item metadata
- quantity chip presets

### `js/db.js`

The IndexedDB wrapper.

It manages:

- database open/versioning
- project records
- photo records
- settings
- photo deletion
- project deletion

### `js/state.js`

The local state manager.

It handles:

- active project
- project CRUD
- room CRUD
- item selection
- quantities
- notes
- No Work statuses
- Bulk No-Work
- project reset
- serial metadata
- project price overrides
- global price overrides
- custom items
- debounced persistence

### `js/pricing.js`

The pricing engine.

It handles:

- cost resolution
- line totals
- group totals
- instance totals
- grand total
- money formatting
- unit-cost formatting
- CSV parsing
- CSV diffing
- price import/export
- price reset

### `js/photos.js`

The photo layer.

It handles:

- camera/file input
- image compression
- thumbnail creation
- photo records
- photo deletion
- object URL helpers
- serial photo counting

### `js/guardrails.js`

The critical-cost warning engine.

It detects:

- unreviewed critical categories
- selected critical items without quantity
- missing serial photos
- missing roof/exterior photos

### `js/dealAnalyzer.js`

The pure deal math module.

It calculates:

- selling costs
- holding costs
- expected profit
- maximum allowable offer
- PASS / WATCH / FAIL status

### `js/export.js`

The final package export module.

It builds:

- estimate rows
- photo manifest rows
- Excel workbook
- ZIP package
- photo folder
- downloadable archive

### `js/backup.js`

The backup/restore module.

It handles:

- backup ZIP export
- project JSON export
- photo export
- backup ZIP parsing
- replace existing project
- import as copy
- unique copy naming
- thumbnail regeneration on import

### `js/ui/dashboard.js`

The project dashboard.

It handles:

- project list
- new project
- open project
- rename project
- delete project
- import backup

### `js/ui/walkthrough.js`

The main field workflow screen.

It handles:

- section tabs
- room tabs
- group cards
- item rows
- No Work toggle
- Bulk No-Work
- quantity inputs
- quantity chips
- notes
- photos
- serial fields
- running total
- progress
- project reset
- Review navigation

### `js/ui/priceBook.js`

The Price Book admin screen.

It handles:

- global price search
- edit price
- reset price
- reset all prices
- import CSV
- export CSV
- warning preview
- diff preview

### `js/ui/summary.js`

The Review & Export screen.

It handles:

- critical warnings
- estimate breakdown
- export ZIP
- backup export
- backup restore
- Deal Analyzer link

### `js/ui/analyzer.js`

The Deal Analyzer UI.

It handles:

- ARV input
- offer price
- closing costs
- selling percentage
- holding costs
- target profit
- live results
- neutral empty state before required inputs are entered

### `js/ui/components.js`

Shared UI utilities.

It provides:

- modal
- confirm dialog
- bottom sheet
- toast
- progress bar
- quantity chips
- shared formatting helpers
