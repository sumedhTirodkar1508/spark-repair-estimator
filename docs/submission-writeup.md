# Spark Repair Estimator — One-Page Submission Writeup

## 1. Most interesting design / UX decision

The main UX decision was to treat the estimator as a guided field walkthrough instead of a generic repair calculator. Acquisition agents need to move quickly through distressed homes, often on a phone, while avoiding missed high-cost categories. I structured the app around room/section groups, group-level progress, No Work decisions, critical-category warnings, and a Review & Export step before generating the final package.

The most important tradeoff was using warning-based guardrails instead of hard blocking. The app clearly flags unreviewed critical areas such as HVAC, electrical, roof, plumbing, water heater, windows, and structural work, but it still allows export when an agent needs to move fast in the field. That keeps the workflow practical while making expensive omissions visible.

## 2. What is broken or fragile

The biggest limitation is that all data is local to the browser/device. This is intentional for an offline-first static PWA, but it means users must export backups if they want recovery or transfer across devices. Clearing browser site data will delete local projects unless they have been backed up.

PWA installation is also browser-controlled. Android and iOS handle install prompts differently, and iOS requires Safari’s Share → Add to Home Screen flow. The app works offline after the first successful load, but the user must load the app online once so the service worker can cache the app shell.

OCR is intentionally not included. Equipment labels vary heavily in lighting, angle, dirt, glare, and model format. Offline OCR would add size, complexity, and accuracy risk. Instead, I prioritized reliable manual serial/model/brand/year capture with proof photos and optional device/browser speech input where supported.

## 3. Creative addition and why I chose it

My creative addition was turning the estimator into a complete field decision and evidence package, not just a repair checklist. I added a Deal Analyzer, critical guardrails, a structured Photo Gallery, and a professional ZIP/Excel export flow.

The Deal Analyzer connects the repair estimate to the acquisition decision. It uses ARV, offer price, selling/holding costs, target profit, and repair estimate to calculate expected profit, maximum allowable offer, and PASS/WATCH/FAIL status. This helps the agent decide whether the property still works as a deal, not just what the repairs cost.

The Photo Gallery acts as a field evidence review screen. Instead of leaving photos scattered only inside individual line items, it gives the agent one place to review serial photos and repair item photos, preview them, replace bad shots, and delete mistakes before export. This matters in a real walkthrough because photos are often the proof behind expensive repairs such as HVAC, water heater, appliances, flooring, doors, and tile work.

The final export package then turns the walkthrough into something reviewable by the team: an Excel workbook with Estimate, Photo Manifest, Guardrail Warnings, Deal Analyzer, and Review Summary sheets, plus the attached photos. This makes the output easier to defend, share, and act on after the property visit.

## 4. What I would ship next with two more days

With two more days, I would add authenticated team accounts with cloud sync while keeping the offline-first field workflow. Agents would be able to sign in, create property walkthroughs under their account or team, collect repairs/photos/serial details offline on-site, and then automatically sync the project back to a database once internet access returns.

The key design would be offline-first sync rather than making the app depend on the network. IndexedDB would remain the local source of truth during the walkthrough, while the backend would handle cross-device access, team visibility, backup recovery, and audit/history for completed estimates. This would let an acquisition team start an estimate on a phone, review it later on desktop, and avoid losing work if a device is cleared or replaced.

After that, I would add a Portfolio Compare view for reviewing multiple properties side by side: repair total, group completion, photo count, critical warning count, deal status, expected profit, and last updated time. That would help the team prioritize which properties deserve follow-up.

## 5. Role AI tools played

AI tools were used heavily as development accelerators, code-review partners, and planning assistants. I used Claude Code, Codex, and Antigravity IDE to help generate and refactor parts of the implementation, while ChatGPT and Gemini were used to reason through architecture, feature tradeoffs, UX polish, edge cases, testing plans, and submission positioning.

I treated AI output as drafts rather than final answers. I reviewed the generated code, tested features manually, checked for regressions, and made the final product decisions based on the contest requirements and field reliability. For example, I intentionally chose manual serial/model capture with proof photos instead of OCR because OCR would look impressive but would add size, offline complexity, and reliability risk in real walkthrough conditions.

AI helped move faster, but the final scope, architecture, feature prioritization, QA decisions, and submission tradeoffs were guided by the product goal: a fast, offline-first mobile tool that an acquisition agent could actually use in a distressed-home walkthrough.
