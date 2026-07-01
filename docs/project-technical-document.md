# Spark Repair Estimator — Submission Writeup

## Overview

Spark Repair Estimator is a mobile-first offline Progressive Web App built for Spark Homes acquisition agents performing distressed-home walkthroughs. The app helps an agent move through a property room-by-room, select repair items, enter quantities, capture photos, record serial/model details, review critical warnings, analyze deal viability, and export a professional ZIP package containing an Excel workbook and supporting photos.

The main design goal was to make the tool practical in the field: fast on mobile, usable with poor connectivity, and structured enough to prevent expensive categories such as HVAC, electrical, roof, plumbing, water heater, windows, and structural work from being missed.

## Technical Approach

The application is intentionally built as a static offline-first PWA using vanilla HTML, CSS, and JavaScript ES modules. There is no backend, login, API, database server, or runtime CDN dependency.

Key technical decisions:

- Static PWA hosted on Vercel
- Hash-based client-side routing
- IndexedDB for project data and photo blobs
- Service Worker app-shell caching for offline use
- Web App Manifest for Android/iOS installation
- Local vendored JSZip and xlsx-js-style libraries for offline ZIP/Excel generation
- Canvas-based photo compression and thumbnail generation
- localStorage only for tiny local flags such as active project and install-hint dismissal

This structure allows the app to load and continue working offline after the first successful online load.

## Core Workflow

1. Agent opens or creates a project from the dashboard.
2. Agent walks the property through structured sections: Interior, Kitchen, Bathrooms, Systems, Exterior, Bedrooms, and Living.
3. Agent selects repair line items, enters quantities, adds notes, and attaches photos.
4. Agent marks reviewed groups as No Work Needed when appropriate.
5. Non-critical unreviewed groups can be bulk-marked as No Work, while critical groups remain protected.
6. Equipment-related items support manual serial/model/brand/year notes and serial photos.
7. Review & Export shows critical warnings, repair breakdown, review completeness, export, backup/restore, and Deal Analyzer access.
8. The final export creates a ZIP containing an Excel workbook and all attached photos.

## Features Implemented

- Mobile-first offline PWA
- Project dashboard with repair estimate glimpses
- Multiple project support
- Add, rename, duplicate, and remove room instances
- 108 official repair price-list items
- Required repair categories plus supplemental grouping to avoid orphan items
- No Work Needed workflow
- Bulk No-Work sweep for non-critical groups
- Critical group protection
- Live repair total and progress tracking
- Quantity chips and manual quantity entry
- Project-specific price overrides
- Global Price Book
- CSV price import/export with preview and row-level warnings
- Photo capture/upload with local IndexedDB storage
- Manual serial/model/brand/year/notes capture
- Progressive speech input for serial/model fields when the browser supports it
- Critical Cost Guardrails
- Deal Analyzer with ARV, offer price, MAO, expected profit, and PASS/WATCH/FAIL status
- ZIP export with Excel workbook and photos
- Excel workbook sheets: Estimate, Photo Manifest, Guardrail Warnings, Deal Analyzer, Review Summary
- Backup and restore with Replace Current Project and Import as Copy flows

## Notable Design Choices

IndexedDB is used instead of localStorage for project records and photos because mobile browser localStorage is not suitable for larger binary/photo data. This keeps the app more reliable during real field use.

OCR was intentionally not included. Equipment labels vary heavily, and offline OCR would add size, risk, and accuracy problems. Instead, the app provides manual serial/model fields, optional browser speech input when supported, and native keyboard dictation compatibility.

The app uses warning-based guardrails rather than hard export blocks. Agents can still export when needed, but critical unreviewed categories and missing proof photos are clearly surfaced before export.

## Testing Performed

Manual testing covered:

- Desktop browser walkthrough flow
- Android Chrome mobile layout
- Android installed PWA offline behavior
- Service Worker/offline reload behavior
- Project create/open/rename/delete
- Repair item selection and quantity updates
- No Work and Bulk No-Work flows
- Reset Project
- Photo upload/capture
- Serial/model fields
- Price Book edits and CSV import/export
- Review & Export guardrails
- Deal Analyzer empty and completed states
- ZIP/Excel export
- Backup export and restore
- Replace Current Project and Import as Copy restore flows
- Dashboard repair totals

## Known Limitations

- Data is local to the browser/device unless exported through backup.
- Clearing browser site data deletes local projects unless backed up first.
- Android install prompts are controlled by the browser and may not appear automatically.
- iOS installation requires Safari → Share → Add to Home Screen.
- Browser speech recognition is a progressive enhancement and should not be treated as guaranteed offline functionality.

## Final Notes

Spark Repair Estimator is designed to be a practical acquisition-field tool, not just a checklist. The strongest parts of the implementation are its offline-first architecture, structured room walkthrough flow, local photo/serial capture, critical guardrails, price-book flexibility, Deal Analyzer, and professional ZIP/Excel export package.
