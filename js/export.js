/**
 * js/export.js
 * Excel workbook (Estimate + Photo Manifest tabs) + JSZip packaging + download trigger.
 *
 * No DOM mutations beyond an anchor download click. No state mutations. Offline-safe.
 *
 * Depends on (reads only):
 *   ./catalog.js  — getGroupsForInstance, getItemsForGroup, getItem, GROUPS
 *   ./pricing.js  — getResolvedCost, computeLineTotal, computeGroupTotal,
 *                   computeInstanceTotal, computeGrandTotal
 *   ./photos.js   — getPhotos (projectId) → photoRecord[]
 *
 * Vendor libs (xlsx-js-style and jszip) are NOT bundled in app.js; this module
 * lazy-loads them via _loadVendorLibs() which injects <script> tags once and
 * resolves on load. The SW precaches vendor/xlsx.bundle.js and vendor/jszip.min.js
 * so this works fully offline.
 */

import {
  getGroupsForInstance,
  getItemsForGroup,
  getItem,
  GROUPS,
} from './catalog.js';

import {
  getResolvedCost,
  computeLineTotal,
  computeGroupTotal,
  computeInstanceTotal,
  computeGrandTotal,
  formatMoney,
} from './pricing.js';

import { getPhotos } from './photos.js';

import { getCriticalWarnings } from './guardrails.js';
import { computeDeal, isDealReady } from './dealAnalyzer.js';
import { getEffectiveStatus } from './state.js';

// ============================================================================
// Vendor lazy-loader (offline-safe, idempotent)
// ============================================================================

/** @type {Promise<{XLSX:object,JSZip:Function}>|null} */
let _vendorPromise = null;

/**
 * Lazily inject vendor script tags and resolve once both globals are available.
 * Safe to call multiple times — returns the same Promise after first call.
 * Guards against the case where the globals are already present (e.g. loaded
 * by something else in the same page).
 *
 * @returns {Promise<{XLSX:object, JSZip:Function}>}
 */
function _loadVendorLibs() {
  if (_vendorPromise) return _vendorPromise;

  _vendorPromise = new Promise((resolve, reject) => {
    // Determine which libs still need loading
    const needXLSX  = !window.XLSX;
    const needJSZip = !window.JSZip;

    if (!needXLSX && !needJSZip) {
      resolve({ XLSX: window.XLSX, JSZip: window.JSZip });
      return;
    }

    let loaded = 0;
    const needed = (needXLSX ? 1 : 0) + (needJSZip ? 1 : 0);

    const onLoad = () => {
      loaded++;
      if (loaded === needed) {
        resolve({ XLSX: window.XLSX, JSZip: window.JSZip });
      }
    };

    const onError = (url) => (e) => {
      reject(new Error(`export.js: failed to load vendor lib: ${url}`));
    };

    if (needXLSX) {
      const s = document.createElement('script');
      s.src = './vendor/xlsx.bundle.js';
      s.onload  = onLoad;
      s.onerror = onError('./vendor/xlsx.bundle.js');
      document.head.appendChild(s);
    }

    if (needJSZip) {
      const s = document.createElement('script');
      s.src = './vendor/jszip.min.js';
      s.onload  = onLoad;
      s.onerror = onError('./vendor/jszip.min.js');
      document.head.appendChild(s);
    }
  });

  return _vendorPromise;
}

// ============================================================================
// Filename safety helper
// ============================================================================

/**
 * Derive an image extension from a Blob's MIME type.
 * Defaults to "jpg" when the type is absent or unrecognised.
 *
 * @param {Blob} blob
 * @returns {string}  e.g. "jpg", "png", "webp"
 */
function _blobExt(blob) {
  if (!blob || !blob.type) return 'jpg';
  const mime = blob.type.toLowerCase();
  if (mime.includes('png'))  return 'png';
  if (mime.includes('webp')) return 'webp';
  if (mime.includes('gif'))  return 'gif';
  return 'jpg'; // jpeg or unknown → jpg
}

/**
 * Sanitise an arbitrary string for use as a filename component.
 * Collapses non-alphanumeric runs to single underscores, trims leading/trailing
 * underscores, lowercases everything.
 *
 * @param {string} str
 * @returns {string}
 */
function _safe(str) {
  return String(str || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'x';
}

function _stampStr() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/** Coerce to finite number; 0 for blank/null/NaN/undefined. */
function _n(v) { const n = Number(v); return isFinite(n) ? n : 0; }

/**
 * Build a deduped, safe, unique filename for each photo record.
 * The SAME string is used in the manifest `filename` column AND the zip entry path.
 *
 * Format: `photos/<roomLabel>_<itemName|scope>_<kind>_<index>.<ext>`
 *
 * @param {object[]} photos  array of photo records
 * @param {object}   project the full project record
 * @returns {string[]}       one filename (without leading "photos/") per photo, in same order
 */
function _buildFilenames(photos, project) {
  // Build instanceId → label map
  const labelMap = {};
  for (const room of (project.rooms || [])) {
    labelMap[room.instanceId] = room.label || room.instanceId;
  }

  // Build a counter to deduplicate identical base names
  const seen = {};

  return photos.map((ph, idx) => {
    // Determine room label from refKey or scope
    let roomLabel = '';
    let itemLabel = '';

    if (ph.scope === 'item' || ph.scope === 'group') {
      // refKey is "instanceId::itemId" or "instanceId::groupKey"
      const sep = ph.refKey ? ph.refKey.indexOf('::') : -1;
      if (sep !== -1) {
        const instanceId = ph.refKey.slice(0, sep);
        const rightPart  = ph.refKey.slice(sep + 2);
        roomLabel = labelMap[instanceId] || instanceId;
        // Try to resolve rightPart as an itemId first, then as a groupKey
        const item = getItem(rightPart, project);
        if (item) {
          itemLabel = item.name;
        } else if (GROUPS[rightPart]) {
          itemLabel = GROUPS[rightPart].label;
        } else {
          itemLabel = rightPart;
        }
      }
    } else if (ph.scope === 'room') {
      // refKey is just the instanceId
      roomLabel = labelMap[ph.refKey] || ph.refKey || '';
      itemLabel = 'room';
    } else {
      // project-level scope; refKey is ""
      roomLabel = _safe(project.name) || 'project';
      itemLabel = 'general';
    }

    const ext  = _blobExt(ph.blob);
    const base = `${_safe(roomLabel)}_${_safe(itemLabel)}_${_safe(ph.kind)}`;

    // Deduplicate: if we've seen this base before, append a counter
    if (!seen[base]) {
      seen[base] = 1;
    } else {
      seen[base]++;
    }
    const counter = seen[base];
    // Always append index so every filename is unambiguously unique
    return `${base}_${counter}.${ext}`;
  });
}

// ============================================================================
// buildEstimateRows
// ============================================================================

/**
 * Build the structured estimate tree for the Excel Estimate sheet.
 *
 * Returns a SectionBlock array — one entry per room instance that has ≥1
 * selected item with qty>0.
 *
 * SectionBlock shape:
 * {
 *   instanceId:    string,
 *   instanceLabel: string,
 *   groups: [
 *     {
 *       groupKey:   string,
 *       groupLabel: string,
 *       items: [
 *         { itemId, name, unit, unitCost, qty, lineTotal }
 *       ],
 *       groupTotal: number
 *     }
 *   ],
 *   instanceTotal: number
 * }
 *
 * Rules:
 * - unitCost     = getResolvedCost   (may be decimal)
 * - lineTotal    = computeLineTotal  (Math.ceil — already an integer)
 * - groupTotal   = computeGroupTotal (sum of integer line totals)
 * - instanceTotal= computeInstanceTotal
 * - Skip groups with zero eligible items; skip instances with zero eligible groups.
 * - qty is stored as a string in project.selections; store the parsed float here.
 *
 * @param {object} project
 * @param {object} globalPrices
 * @returns {Array<{instanceId:string,instanceLabel:string,groups:object[],instanceTotal:number}>}
 */
export function buildEstimateRows(project, globalPrices) {
  const sections = [];
  const selections = project.selections || {};

  for (const room of (project.rooms || [])) {
    const { instanceId, roomType, label: instanceLabel } = room;
    const groupObjs = getGroupsForInstance(instanceId, roomType);

    const groups = [];

    for (const grp of groupObjs) {
      const { key: groupKey, label: groupLabel } = grp;
      const items = getItemsForGroup(groupKey, project);

      const eligibleItems = [];
      for (const item of items) {
        const selKey = `${instanceId}::${item.id}`;
        if (!Object.prototype.hasOwnProperty.call(selections, selKey)) continue;
        const entry = selections[selKey];
        const q = parseFloat(entry.qty);
        if (!(q > 0)) continue;

        const unitCost  = getResolvedCost(item.id, project, globalPrices);
        const lineTotal = computeLineTotal(item.id, entry.qty, project, globalPrices);

        eligibleItems.push({
          itemId:    item.id,
          name:      item.name,
          unit:      item.unit,
          unitCost,
          qty:       q,
          lineTotal,
        });
      }

      if (eligibleItems.length === 0) continue;

      const groupTotal = computeGroupTotal(instanceId, groupKey, project, globalPrices);
      groups.push({ groupKey, groupLabel, items: eligibleItems, groupTotal });
    }

    if (groups.length === 0) continue;

    const instanceTotal = computeInstanceTotal(instanceId, project, globalPrices);
    sections.push({ instanceId, instanceLabel, groups, instanceTotal });
  }

  return sections;
}

// ============================================================================
// buildPhotoManifestRows
// ============================================================================

/**
 * Build the photo manifest rows for the "Photo Manifest" Excel sheet.
 *
 * Columns (fixed order):
 *   filename, scope, room, group, itemId, itemName, kind,
 *   serial, model, brand, year, notes, capturedAt
 *
 * - filename:  the SAME safe unique name used in the zip entry (without "photos/")
 * - room:      label of the room instance (from project.rooms)
 * - group:     group label when derivable (scope=item → item's group; scope=group → that group)
 * - itemId:    for scope=item only
 * - itemName:  via getItem for scope=item
 * - serial…notes: from project.serials[refKey] when scope=item and item is in SERIAL_ITEM_IDS
 * - capturedAt: photo.createdAt ISO string
 * Empty string for fields that don't apply.
 *
 * @param {object}   project
 * @param {object[]} photos   result of getPhotos(projectId) — full records including .blob
 * @returns {object[]}  ManifestRow[]
 */
export function buildPhotoManifestRows(project, photos) {
  if (!photos || photos.length === 0) return [];

  // Build instanceId → label map
  const labelMap = {};
  for (const room of (project.rooms || [])) {
    labelMap[room.instanceId] = room.label || room.instanceId;
  }

  // Build itemId → [groupKey] reverse map so we can look up a group from an itemId.
  // Note: same itemId can appear in multiple groups across templates (bed/liv reuse interior).
  // We build this per (instanceId, groupKey) from the template at call time instead.

  const filenames = _buildFilenames(photos, project);
  const serials   = project.serials || {};

  return photos.map((ph, idx) => {
    const filename   = filenames[idx];
    const scope      = ph.scope || '';
    const capturedAt = ph.createdAt || '';

    let room     = '';
    let group    = '';
    let itemId   = '';
    let itemName = '';

    // Serial fields (only when scope=item AND serial metadata exists)
    let serial = '';
    let model  = '';
    let brand  = '';
    let year   = '';
    let notes  = '';

    if (ph.scope === 'item') {
      // refKey: "instanceId::itemId"
      const sep = ph.refKey ? ph.refKey.indexOf('::') : -1;
      if (sep !== -1) {
        const instanceId = ph.refKey.slice(0, sep);
        const iId        = ph.refKey.slice(sep + 2);
        room   = labelMap[instanceId] || instanceId;
        itemId = iId;

        const item = getItem(iId, project);
        itemName = item ? item.name : '';

        // Derive group: find which group this item belongs to in this instance's template
        const roomInst = (project.rooms || []).find(r => r.instanceId === instanceId);
        if (roomInst) {
          const grpObjs = getGroupsForInstance(instanceId, roomInst.roomType);
          for (const grp of grpObjs) {
            const groupItems = getItemsForGroup(grp.key, project);
            if (groupItems.some(gi => gi.id === iId)) {
              group = grp.label;
              break;
            }
          }
        }

        // Serial metadata
        const serialRec = serials[ph.refKey];
        if (serialRec) {
          serial = serialRec.serial || '';
          model  = serialRec.model  || '';
          brand  = serialRec.brand  || '';
          year   = serialRec.year   || '';
          notes  = serialRec.notes  || '';
        }
      }
    } else if (ph.scope === 'group') {
      // refKey: "instanceId::groupKey"
      const sep = ph.refKey ? ph.refKey.indexOf('::') : -1;
      if (sep !== -1) {
        const instanceId = ph.refKey.slice(0, sep);
        const groupKey   = ph.refKey.slice(sep + 2);
        room  = labelMap[instanceId] || instanceId;
        group = GROUPS[groupKey] ? GROUPS[groupKey].label : groupKey;
      }
    } else if (ph.scope === 'room') {
      // refKey is the instanceId itself
      room = labelMap[ph.refKey] || ph.refKey || '';
    }
    // scope=project: room, group, itemId, itemName all remain ''

    return {
      filename,
      scope,
      room,
      group,
      itemId,
      itemName,
      kind: ph.kind || '',
      serial,
      model,
      brand,
      year,
      notes,
      capturedAt,
    };
  });
}

// ============================================================================
// buildWorkbook
// ============================================================================

/**
 * Build the xlsx-js-style workbook object.
 * Two sheets:
 *   "Estimate"      — title, per-instance sections, grand total
 *   "Photo Manifest"— 13-column table; headers always present even when no photos
 *
 * GRAND TOTAL cell value = computeGrandTotal(project, globalPrices).
 * Unit Cost format: "$"#,##0.00
 * Line Total / subtotal / grand total format: "$"#,##0
 *
 * @param {object}   project
 * @param {object}   globalPrices
 * @param {object[]} photos
 * @returns {object}  xlsx-js-style workbook
 */
export function buildWorkbook(project, globalPrices, photos) {
  const XLSX = window.XLSX;
  const grandTotal = computeGrandTotal(project, globalPrices);

  // ── Estimate sheet ─────────────────────────────────────────────────────────

  const ws = {};
  let row = 0;
  const merges = [];

  // Helper: encode a cell address
  const addr = (r, c) => XLSX.utils.encode_cell({ r, c });

  // Helper: write a cell with value, type, style, and optional number format
  const cell = (r, c, v, s, z) => {
    const a = addr(r, c);
    ws[a] = { v, t: typeof v === 'number' ? 'n' : 's', s };
    if (z) ws[a].z = z;
  };

  // Helper: add a merge entry
  const merge = (r, c1, c2) => merges.push({ s: { r, c: c1 }, e: { r, c: c2 } });

  // Style helpers (xlsx-js-style API)
  const baseFont = { name: 'Calibri' };

  const _s = (fontExt, fillRgb, alignH, bold, sz) => ({
    font: { ...baseFont, bold: !!bold, sz: sz || 10, ...(fontExt || {}) },
    fill: fillRgb ? { patternType: 'solid', fgColor: { rgb: fillRgb } } : undefined,
    alignment: { horizontal: alignH || 'left', vertical: 'center', wrapText: false },
  });

  const borderThin = (rgb) => ({
    top:    { style: 'thin', color: { rgb } },
    bottom: { style: 'thin', color: { rgb } },
    left:   { style: 'thin', color: { rgb } },
    right:  { style: 'thin', color: { rgb } },
  });

  const _sb = (fontExt, fillRgb, alignH, bold, sz, borderRgb) => ({
    ..._s(fontExt, fillRgb, alignH, bold, sz),
    border: borderRgb ? borderThin(borderRgb) : undefined,
  });

  // ── Title row ──
  const titleDate = new Date().toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
  });
  const titleText = 'SPARK HOMES — REPAIR ESTIMATE';
  cell(row, 0, titleText,
    _s({ bold: true, sz: 14, color: { rgb: 'FFFFFF' } }, '111827', 'center'));
  merge(row, 0, 4);
  // Fill merged cells
  for (let c = 1; c <= 4; c++) {
    cell(row, c, '', _s({}, '111827'));
  }
  row++;

  // ── Project / date subtitle ──
  const subtitle = `Property: ${project.name || ''}     Date: ${titleDate}`;
  cell(row, 0, subtitle,
    _s({ sz: 10, color: { rgb: '6B7280' } }, 'F9FAFB', 'center'));
  merge(row, 0, 4);
  for (let c = 1; c <= 4; c++) {
    cell(row, c, '', _s({}, 'F9FAFB'));
  }
  row++;

  // ── Blank row after header ──
  row++;

  // ── Per-instance sections ──
  const sections = buildEstimateRows(project, globalPrices);

  for (const sec of sections) {
    // Section header (orange background, white text)
    const secLabel = (sec.instanceLabel || sec.instanceId).toUpperCase();
    cell(row, 0, secLabel,
      _s({ bold: true, sz: 11, color: { rgb: 'FFFFFF' } }, 'EA580C', 'left'));
    merge(row, 0, 4);
    for (let c = 1; c <= 4; c++) {
      cell(row, c, '', _s({}, 'EA580C'));
    }
    row++;

    // Column headers
    const COL_HEADERS = ['Repair Item', 'Unit', 'Unit Cost', 'Qty', 'Line Total'];
    COL_HEADERS.forEach((h, c) => {
      cell(row, c, h,
        _sb(
          { bold: true, sz: 10, color: { rgb: '374151' } },
          'FFF7ED',
          c >= 2 ? 'right' : 'left',
          true, 10, 'FDBA74'
        )
      );
    });
    row++;

    // Item rows (one per selected item with qty>0, across all groups in this instance)
    for (const grp of sec.groups) {
      for (const it of grp.items) {
        const rowStyle = _sb({ sz: 10, color: { rgb: '374151' } }, 'FFFFFF', 'left', false, 10, 'F3F4F6');
        const rowStyleR = _sb({ sz: 10, color: { rgb: '374151' } }, 'FFFFFF', 'right', false, 10, 'F3F4F6');

        cell(row, 0, it.name,     rowStyle);
        cell(row, 1, it.unit,     rowStyle);
        cell(row, 2, it.unitCost, rowStyleR, '"$"#,##0.00');
        cell(row, 3, it.qty,      rowStyleR, 'General');
        cell(row, 4, it.lineTotal,rowStyleR, '"$"#,##0');
        row++;
      }
    }

    // Instance subtotal row
    const subStyle  = _sb({ bold: true, sz: 10, color: { rgb: 'C2410C' } }, 'FFF7ED', 'left',  true, 10, 'FDBA74');
    const subStyleR = _sb({ bold: true, sz: 10, color: { rgb: 'C2410C' } }, 'FFF7ED', 'right', true, 10, 'FDBA74');

    const subLabel = `${sec.instanceLabel || sec.instanceId} Total`;
    cell(row, 0, subLabel,         subStyle);
    cell(row, 1, '',               subStyle);
    cell(row, 2, '',               subStyle);
    cell(row, 3, '',               subStyle);
    cell(row, 4, sec.instanceTotal, subStyleR, '"$"#,##0');
    merge(row, 0, 3);
    row++;

    // Blank separator row between sections
    row++;
  }

  // ── Grand Total row ──
  const gtStyle  = _s({ bold: true, sz: 13, color: { rgb: 'FFFFFF' } }, '111827', 'center');
  const gtStyleR = _s({ bold: true, sz: 13, color: { rgb: 'FFFFFF' } }, '111827', 'right');

  cell(row, 0, 'TOTAL ESTIMATE', gtStyle);
  merge(row, 0, 3);
  for (let c = 1; c <= 3; c++) {
    cell(row, c, '', gtStyle);
  }
  cell(row, 4, grandTotal, gtStyleR, '"$"#,##0');
  row++;

  // Sheet metadata
  ws['!ref']    = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: row - 1, c: 4 } });
  ws['!cols']   = [{ wch: 38 }, { wch: 16 }, { wch: 12 }, { wch: 10 }, { wch: 14 }];
  ws['!merges'] = merges;

  // ── Photo Manifest sheet ───────────────────────────────────────────────────

  const MANIFEST_HEADERS = [
    'filename', 'scope', 'room', 'group', 'itemId', 'itemName',
    'kind', 'serial', 'model', 'brand', 'year', 'notes', 'capturedAt',
  ];

  const wm = {};
  const manifestRows = buildPhotoManifestRows(project, photos || []);

  // Header row
  MANIFEST_HEADERS.forEach((h, c) => {
    const a = XLSX.utils.encode_cell({ r: 0, c });
    wm[a] = {
      v: h, t: 's',
      s: _s({ bold: true, sz: 10, color: { rgb: '374151' } }, 'FFF7ED', 'left', true),
    };
  });

  // Data rows
  manifestRows.forEach((mr, ri) => {
    const r = ri + 1;
    MANIFEST_HEADERS.forEach((col, c) => {
      const a = XLSX.utils.encode_cell({ r, c });
      wm[a] = {
        v: String(mr[col] !== undefined ? mr[col] : ''),
        t: 's',
        s: _s({ sz: 10 }, 'FFFFFF', 'left'),
      };
    });
  });

  const mLastRow = manifestRows.length; // 0 if no photos (only header row at index 0)
  wm['!ref']  = XLSX.utils.encode_range({
    s: { r: 0, c: 0 },
    e: { r: Math.max(0, mLastRow), c: MANIFEST_HEADERS.length - 1 },
  });
  wm['!cols'] = [
    { wch: 36 }, // filename
    { wch: 10 }, // scope
    { wch: 20 }, // room
    { wch: 24 }, // group
    { wch: 10 }, // itemId
    { wch: 30 }, // itemName
    { wch: 10 }, // kind
    { wch: 16 }, // serial
    { wch: 20 }, // model
    { wch: 16 }, // brand
    { wch: 8  }, // year
    { wch: 30 }, // notes
    { wch: 22 }, // capturedAt
  ];

  // ── Build photosByRefKey for guardrail + review sheets ───────────────────────
  const photosByRefKey = {};
  for (const ph of (photos || [])) {
    const rk = ph.refKey || '';
    if (!photosByRefKey[rk]) photosByRefKey[rk] = { serialCount: 0, generalCount: 0, total: 0 };
    photosByRefKey[rk].total++;
    if (ph.kind === 'serial')  photosByRefKey[rk].serialCount++;
    if (ph.kind === 'general') photosByRefKey[rk].generalCount++;
  }

  // ── Guardrail Warnings sheet ─────────────────────────────────────────────
  const warnings = getCriticalWarnings(project, photosByRefKey, globalPrices);
  const wg = {};
  {
    const labelMap = {};
    for (const room of (project.rooms || [])) labelMap[room.instanceId] = room.label || room.instanceId;

    const hdrS = _s({ bold: true, sz: 10, color: { rgb: '374151' } }, 'FFF7ED', 'left', true);
    const WG_COLS = ['Severity', 'Type', 'Room', 'Group', 'Item ID', 'Message'];
    WG_COLS.forEach((h, c) => { wg[XLSX.utils.encode_cell({ r: 0, c })] = { v: h, t: 's', s: hdrS }; });

    let lastRow;
    if (warnings.length === 0) {
      const okS = _s({ sz: 10, color: { rgb: '166534' } }, 'F0FDF4', 'left');
      ['OK', '', '', '', '', 'All critical categories reviewed — no issues found.'].forEach((v, c) => {
        wg[XLSX.utils.encode_cell({ r: 1, c })] = { v, t: 's', s: okS };
      });
      lastRow = 1;
    } else {
      warnings.forEach((w, ri) => {
        const r = ri + 1;
        const isRed = w.type === 'critical-unreviewed';
        const rowS = _s({ sz: 10, color: { rgb: isRed ? 'B91C1C' : 'B45309' } }, isRed ? 'FEF2F2' : 'FFFBEB', 'left');
        const room  = labelMap[w.instanceId] || w.instanceId || '';
        const group = GROUPS[w.groupKey] ? GROUPS[w.groupKey].label : (w.groupKey || '');
        ['Critical', w.type || '', room, group, w.itemId || '', w.message || ''].forEach((v, c) => {
          wg[XLSX.utils.encode_cell({ r, c })] = { v: String(v), t: 's', s: rowS };
        });
      });
      lastRow = warnings.length;
    }
    wg['!ref']  = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: lastRow, c: 5 } });
    wg['!cols'] = [{ wch: 10 }, { wch: 24 }, { wch: 22 }, { wch: 28 }, { wch: 10 }, { wch: 55 }];
  }

  // ── Deal Analyzer sheet ──────────────────────────────────────────────────
  const wd = {};
  {
    const analyzerInputs = project.analyzer || {};
    const ready          = isDealReady(analyzerInputs);
    const headS  = _s({ bold: true, sz: 11, color: { rgb: 'FFFFFF' } }, 'EA580C', 'left', true);
    const lblS   = _s({ bold: true, sz: 10, color: { rgb: '374151' } }, 'F9FAFB', 'left',  true);
    const valS   = _s({ sz: 10, color: { rgb: '111827' } }, 'FFFFFF', 'right');
    const wdCell = (r, c, v, s, z) => {
      const a = XLSX.utils.encode_cell({ r, c });
      wd[a] = { v, t: typeof v === 'number' ? 'n' : 's', s };
      if (z) wd[a].z = z;
    };

    let dRow = 0;
    wdCell(dRow, 0, 'DEAL ANALYZER', headS); wdCell(dRow, 1, '', headS); dRow++;

    if (!ready) {
      wdCell(dRow, 0, 'Deal Analyzer not completed', _s({ sz: 10, color: { rgb: '9CA3AF' } }, 'FFFFFF', 'left')); wdCell(dRow, 1, '', valS); dRow++;
      wdCell(dRow, 0, 'Repair Estimate', lblS); wdCell(dRow, 1, grandTotal, valS, '"$"#,##0'); dRow++;
    } else {
      const deal = computeDeal(analyzerInputs, grandTotal);
      const DA_ROWS = [
        ['ARV',                   _n(analyzerInputs.arv),          '"$"#,##0'],
        ['Offer / Purchase Price',_n(analyzerInputs.offerPrice),   '"$"#,##0'],
        ['Repair Estimate',       grandTotal,                       '"$"#,##0'],
        ['Closing Costs',         _n(analyzerInputs.closingCosts), '"$"#,##0'],
        ['Selling Cost %',        _n(analyzerInputs.sellingPct),   '0.00"%"'],
        ['Selling Costs',         deal.sellingCosts,               '"$"#,##0'],
        ['Holding Months',        _n(analyzerInputs.holdingMonths),'0'],
        ['Monthly Holding Cost',  _n(analyzerInputs.monthlyHolding),'"$"#,##0'],
        ['Holding Costs',         deal.holding,                    '"$"#,##0'],
        ['Target Profit',         _n(analyzerInputs.targetProfit), '"$"#,##0'],
        ['Expected Profit',       deal.expectedProfit,             '"$"#,##0'],
        ['MAO',                   deal.mao,                        '"$"#,##0'],
        ['Offer Gap (Offer − MAO)', _n(analyzerInputs.offerPrice) - deal.mao, '"$"#,##0'],
      ];
      for (const [label, value, fmt] of DA_ROWS) {
        wdCell(dRow, 0, label, lblS); wdCell(dRow, 1, value, valS, fmt); dRow++;
      }
      const stColor = deal.status === 'PASS' ? '166534' : deal.status === 'WATCH' ? 'B45309' : 'B91C1C';
      const stBg    = deal.status === 'PASS' ? 'F0FDF4' : deal.status === 'WATCH' ? 'FFFBEB' : 'FEF2F2';
      wdCell(dRow, 0, 'Status', _s({ bold: true, sz: 10, color: { rgb: '374151' } }, stBg, 'left', true));
      wdCell(dRow, 1, deal.status, _s({ bold: true, sz: 11, color: { rgb: stColor } }, stBg, 'center', true)); dRow++;
    }
    wd['!ref']  = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: dRow - 1, c: 1 } });
    wd['!cols'] = [{ wch: 24 }, { wch: 16 }];
  }

  // ── Review Summary sheet ─────────────────────────────────────────────────
  const wr = {};
  {
    let totalGroups = 0, reviewedGroups = 0, noWorkGroups = 0, selectedItems = 0;
    const selections = project.selections || {};
    for (const room of (project.rooms || [])) {
      const grps = getGroupsForInstance(room.instanceId, room.roomType);
      for (const grp of grps) {
        totalGroups++;
        const st = getEffectiveStatus(room.instanceId, grp.key, project);
        if (st !== 'unreviewed') reviewedGroups++;
        if (st === 'none') noWorkGroups++;
        for (const item of getItemsForGroup(grp.key, project)) {
          const entry = selections[`${room.instanceId}::${item.id}`];
          if (entry !== undefined && parseFloat(entry.qty) > 0) selectedItems++;
        }
      }
    }
    const photoCount   = (photos || []).length;
    const serialPhotos = (photos || []).filter(p => p.kind === 'serial').length;
    const exportedAt   = new Date().toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true,
    });

    const headS = _s({ bold: true, sz: 11, color: { rgb: 'FFFFFF' } }, 'EA580C', 'left', true);
    const lblS  = _s({ bold: true, sz: 10, color: { rgb: '374151' } }, 'F9FAFB', 'left', true);
    const valS  = _s({ sz: 10, color: { rgb: '111827' } }, 'FFFFFF', 'left');
    const wrCell = (r, c, v, s) => { wr[XLSX.utils.encode_cell({ r, c })] = { v, t: 's', s }; };

    let rRow = 0;
    wrCell(rRow, 0, 'REVIEW SUMMARY', headS); wrCell(rRow, 1, '', headS); rRow++;

    const RS_ROWS = [
      ['Groups Reviewed',       `${reviewedGroups} / ${totalGroups}`],
      ['No Work Groups',        String(noWorkGroups)],
      ['Items Selected',        String(selectedItems)],
      ['Critical Warnings',     String(warnings.length)],
      ['Photo Count',           String(photoCount)],
      ['Serial Photos',         String(serialPhotos)],
      ['Grand Repair Estimate', formatMoney(grandTotal)],
      ['Exported At',           exportedAt],
    ];
    for (const [label, value] of RS_ROWS) {
      wrCell(rRow, 0, label, lblS); wrCell(rRow, 1, value, valS); rRow++;
    }
    wr['!ref']  = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rRow - 1, c: 1 } });
    wr['!cols'] = [{ wch: 22 }, { wch: 22 }];
  }

  // ── Assemble workbook ──────────────────────────────────────────────────────

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Estimate');
  XLSX.utils.book_append_sheet(wb, wm, 'Photo Manifest');
  XLSX.utils.book_append_sheet(wb, wg, 'Guardrail Warnings');
  XLSX.utils.book_append_sheet(wb, wd, 'Deal Analyzer');
  XLSX.utils.book_append_sheet(wb, wr, 'Review Summary');

  return wb;
}

// ============================================================================
// exportProjectZip
// ============================================================================

/**
 * Full export flow:
 *  1. Ensure vendor libs are loaded (offline-safe lazy load).
 *  2. Fetch all photos for this project from IndexedDB.
 *  3. Build the workbook.
 *  4. Write the xlsx to an array buffer.
 *  5. Build a JSZip: add the xlsx + each photo blob under photos/<filename>.
 *  6. Generate a Blob and trigger a download via a temporary anchor.
 *
 * Edge cases:
 * - Zero photos: zip still contains the xlsx (no photos/ entries).
 * - Zero selections: Estimate sheet shows only headers + grand total of $0.
 * - Always produces a .zip file for consistency (not a bare .xlsx).
 *
 * @param {object} project
 * @param {object} globalPrices
 * @returns {Promise<void>}
 */
export async function exportProjectZip(project, globalPrices) {
  // 1. Load vendor libs (idempotent — SW-cached, offline-safe)
  const { XLSX, JSZip } = await _loadVendorLibs();

  // 2. Fetch photos
  const photos = await getPhotos(project.id);

  // 3. Build safe filenames once, shared between manifest and zip entries
  const filenames = _buildFilenames(photos, project);

  // 4. Build workbook (uses window.XLSX which is now guaranteed set)
  const wb = buildWorkbook(project, globalPrices, photos);

  // 5. Write xlsx → Uint8Array
  const xlsxData = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });

  // 6. Build the ZIP
  const zip = new JSZip();

  // Safe project name for the archive filename
  const safeProject = _safe(project.name || 'project') || 'project';
  const stamp       = _stampStr(); // YYYYMMDD-HHMMSS local time
  const xlsxName    = `${safeProject}-estimate-${stamp}.xlsx`;
  const zipName     = `${safeProject}-estimate-${stamp}.zip`;

  zip.file(xlsxName, xlsxData);

  // Add each photo under photos/<filename>
  if (photos.length > 0) {
    const photoFolder = zip.folder('photos');
    photos.forEach((ph, idx) => {
      photoFolder.file(filenames[idx], ph.blob);
    });
  }

  // 7. Generate the zip Blob and trigger download
  const zipBlob = await zip.generateAsync({ type: 'blob' });

  const a = document.createElement('a');
  a.href     = URL.createObjectURL(zipBlob);
  a.download = zipName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoke after a short delay so the browser has time to start the download
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}
