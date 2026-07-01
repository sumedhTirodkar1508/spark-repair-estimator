# Spark Repair Estimator — One-Page Submission Writeup

## 1. Most interesting design / UX decision

The main UX decision was to treat the estimator as a guided field walkthrough instead of a generic repair calculator. Acquisition agents need to move quickly through distressed homes, often on a phone, while avoiding missed high-cost categories. I structured the app around room/section groups, group-level progress, No Work decisions, critical-category warnings, and a Review & Export step before generating the final package.

The most important tradeoff was using warning-based guardrails instead of hard blocking. The app clearly flags unreviewed critical areas such as HVAC, electrical, roof, plumbing, water heater, windows, and structural work, but it still allows export when an agent needs to move fast in the field. That keeps the workflow practical while making expensive omissions visible.

## 2. What is broken or fragile

The biggest limitation is that all data is local to the browser/device. This is intentional for an offline-first static PWA, but it means users must export backups if they want recovery or transfer across devices. Clearing browser site data will delete local projects unless they have been backed up.

PWA installation is also browser-controlled. Android and iOS handle install prompts differently, and iOS requires Safari’s Share → Add to Home Screen flow. The app works offline after the first successful load, but the user must load the app online once so the service worker can cache the app shell.

OCR is intentionally not included. Equipment labels vary heavily in lighting, angle, dirt, glare, and model format. Offline OCR would add size, complexity, and accuracy risk. Instead, I prioritized reliable manual serial/model/brand/year capture with proof photos and optional device/browser speech input where supported.

## 3. Creative addition and why I chose it

My creative addition was turning the estimator into a complete field package workflow: Price Book, critical guardrails, Deal Analyzer, photo manifest, and backup/restore.

The Deal Analyzer connects repair scope to acquisition decision-making. It uses ARV, offer price, selling/holding costs, target profit, and repair estimate to produce expected profit, maximum allowable offer, and PASS/WATCH/FAIL status. This makes the tool useful beyond cost entry: it helps the user decide whether the property still works as a deal.

The export package also includes more than a basic estimate. The ZIP contains an Excel workbook with Estimate, Photo Manifest, Guardrail Warnings, Deal Analyzer, and Review Summary sheets, plus attached photos. This makes the output easier to review, share, and defend after the walkthrough.

## 4. What I would ship next with two more days

With two more days, I would add authenticated team accounts with cloud sync while keeping the offline-first field workflow. Agents would be able to sign in, create property walkthroughs under their account or team, collect repairs/photos/serial details offline on-site, and then automatically sync the project back to a database once internet access returns.

The key design would be offline-first sync rather than making the app depend on the network. IndexedDB would remain the local source of truth during the walkthrough, while the backend would handle cross-device access, team visibility, backup recovery, and audit/history for completed estimates. This would let an acquisition team start an estimate on a phone, review it later on desktop, and avoid losing work if a device is cleared or replaced.

After that, I would add a Portfolio Compare view for reviewing multiple properties side by side: repair total, group completion, photo count, critical warning count, deal status, expected profit, and last updated time. That would help the team prioritize which properties deserve follow-up.

## 5. Role AI tools played

AI tools were used as a development accelerator and reviewer, not as a replacement for product judgment. I used AI to help generate implementation drafts, inspect edge cases, review competing approaches, write QA prompts, and identify risks such as stale photo cache behavior, service worker cache issues, and backup/restore edge cases.

Final product decisions were made based on the contest requirements and field reliability. For example, I chose not to add OCR because it would look impressive but would make the offline app heavier and less reliable in real property conditions.
