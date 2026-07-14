# Spark Repair Estimator — One-Page Submission Writeup

## 1. Most interesting design / UX decision

The main UX decision was to treat the estimator as a guided field walkthrough instead of a generic repair calculator. Acquisition agents need to move quickly through distressed homes, often on a phone, while avoiding missed high-cost categories. I structured the app around room and section groups, group-level progress, No Work decisions, critical-category warnings, and a Review & Export step before generating the final package.

The most important tradeoff was using warning-based guardrails instead of hard blocking. The app clearly flags unreviewed critical areas such as HVAC, electrical, roof, plumbing, water heater, windows, and structural work, but it still permits export when an agent needs to move quickly in the field. This keeps the workflow practical while making expensive omissions visible.

## 2. What is broken or fragile

The biggest limitation is that all project data is local to the browser and device. This is intentional for an offline-first static PWA, but users must export backups when they need recovery or transfer between devices. Clearing browser site data will delete locally stored projects unless they were previously backed up.

PWA installation is also browser-controlled. Android and iOS handle installation differently, and iOS requires Safari’s Share → Add to Home Screen flow. The app works offline after the first successful load, but it must be loaded online once so the service worker can cache the application shell.

OCR is intentionally not included. Equipment labels vary substantially in lighting, angle, dirt, glare, and model format. Offline OCR would add application size, implementation complexity, and accuracy risk. I instead prioritized dependable manual serial, model, brand, and year capture with proof photos and optional device or browser speech input where supported.

## 3. Creative addition and why I chose it

My creative addition was turning the estimator into a field decision and evidence system rather than only a repair checklist.

The Deal Analyzer connects the repair estimate to acquisition economics using ARV, offer price, selling and holding costs, target profit, expected profit, maximum allowable offer, and PASS/WATCH/FAIL status. Its Offer Gap guidance also explains how much the offer must decrease to meet the target profit, or how much profit cushion exists when the deal passes.

The Field Evidence Gallery centralizes serial and repair-item photos so an agent can review, preview, replace, or delete evidence before export. Go to Source links a Gallery photo back to its exact Walkthrough item. The final ZIP combines the estimate, photo manifest, guardrail warnings, deal analysis, review summary, and attached photos into a package the acquisition team can review, share, and defend after the walkthrough.

## 4. What I would ship next with two more days

With two more days, I would add authenticated team accounts with cloud synchronization while preserving the offline-first field workflow. Agents would be able to sign in, create property walkthroughs under their account or team, collect repair details, photos, and serial information offline on-site, and automatically synchronize the project once internet access returns.

IndexedDB would remain the local source of truth during the walkthrough, while the backend would provide cross-device access, team visibility, backup recovery, and audit history for completed estimates. This would allow an acquisition team to begin an estimate on a phone, review it later on desktop, and avoid losing work if a device is cleared or replaced.

After that, I would add a Portfolio Compare view for reviewing multiple properties side by side using repair total, group completion, photo count, critical warning count, deal status, expected profit, and last updated time. This would help the team prioritize which properties deserve follow-up.

## 5. Role AI tools played

AI tools were used as development accelerators and review partners. Claude Code, Codex, and Antigravity IDE helped draft, refactor, and inspect code. ChatGPT and Gemini were used for architecture planning, feature tradeoffs, UX critique, edge-case analysis, QA planning, and submission positioning.

I treated generated output as implementation drafts rather than final answers. I reviewed the code, performed manual regression testing, diagnosed failures, and made the final product and reliability decisions. AI accelerated development, while responsibility for the scope, architecture, testing, and submission quality remained with me.
