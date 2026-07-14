/**
 * js/pricing.js
 * Cost resolution, rounding (Math.ceil — ONLY in computeLineTotal), CSV parse/diff/apply/export.
 *
 * No DOM, no IndexedDB, no localStorage, no network. Receives all data as args.
 */

import { CATALOG_ITEMS, getItem, getItemsForGroup, ROOM_TEMPLATES } from './catalog.js';

// Build a Set of all canonical catalog ids (108) for fast lookup
const _catalogIdSet = new Set(CATALOG_ITEMS.map(item => item.id));

// ============================================================================
// Cost resolution & totals
// ============================================================================

/**
 * Resolve the effective cost for an item.
 * Priority: project.priceOverrides[itemId] → globalPrices[itemId] → catalog/custom defaultCost.
 * If item unknown, returns 0.
 *
 * @param {string} itemId
 * @param {{priceOverrides?: Record<string,number>, customItems?: Array<{id:string,defaultCost:number}>}} project
 * @param {Record<string,number>} globalPrices
 * @returns {number}
 */
export function getResolvedCost(itemId, project, globalPrices) {
  // 1. Per-project override
  if (project && project.priceOverrides && Object.prototype.hasOwnProperty.call(project.priceOverrides, itemId)) {
    return project.priceOverrides[itemId];
  }
  // 2. Global override
  if (globalPrices && Object.prototype.hasOwnProperty.call(globalPrices, itemId)) {
    return globalPrices[itemId];
  }
  // 3. Catalog / custom defaultCost
  const item = getItem(itemId, project);
  if (item !== undefined) {
    return item.defaultCost;
  }
  // Unknown item
  return 0;
}

/**
 * Compute the line total for a single item + quantity.
 * THIS IS THE ONLY PLACE Math.ceil IS CALLED in this module.
 *
 * @param {string} itemId
 * @param {string|number} qty
 * @param {{priceOverrides?: Record<string,number>, customItems?: Array<{id:string,defaultCost:number}>}} project
 * @param {Record<string,number>} globalPrices
 * @returns {number}  integer (0 when qty ≤ 0 or unparseable)
 */
export function computeLineTotal(itemId, qty, project, globalPrices) {
  const q = parseFloat(qty);
  if (!(q > 0)) return 0;
  return Math.ceil(q * getResolvedCost(itemId, project, globalPrices));
}

/**
 * Sum of computeLineTotal over all items in the group that have a selection for this instance.
 * Includes custom items for the groupKey; respects deletedItemIds.
 * Only items with an existing selection key `${instanceId}::${itemId}` are counted.
 *
 * @param {string} instanceId
 * @param {string} groupKey
 * @param {{selections?: Record<string,{qty:string}>, priceOverrides?: Record<string,number>, customItems?: Array<{id:string,groupKey:string,defaultCost:number}>, deletedItemIds?: string[]}} project
 * @param {Record<string,number>} globalPrices
 * @returns {number}
 */
export function computeGroupTotal(instanceId, groupKey, project, globalPrices) {
  const items = getItemsForGroup(groupKey, project);
  const selections = (project && project.selections) ? project.selections : {};
  let total = 0;
  for (const item of items) {
    const selKey = `${instanceId}::${item.id}`;
    if (Object.prototype.hasOwnProperty.call(selections, selKey)) {
      const entry = selections[selKey];
      total += computeLineTotal(item.id, entry.qty, project, globalPrices);
    }
  }
  return total;
}

/**
 * Sum of computeGroupTotal over all groups in the room instance's template.
 * Looks up the roomType from project.rooms.
 *
 * @param {string} instanceId
 * @param {{rooms?: Array<{instanceId:string,roomType:string}>, selections?: Record<string,{qty:string}>, priceOverrides?: Record<string,number>, customItems?: Array<{id:string,groupKey:string,defaultCost:number}>, deletedItemIds?: string[]}} project
 * @param {Record<string,number>} globalPrices
 * @returns {number}
 */
export function computeInstanceTotal(instanceId, project, globalPrices) {
  const rooms = (project && Array.isArray(project.rooms)) ? project.rooms : [];
  const room = rooms.find(r => r.instanceId === instanceId);
  if (!room) return 0;
  const template = ROOM_TEMPLATES[room.roomType];
  if (!template) return 0;
  let total = 0;
  for (const groupKey of template.groupKeys) {
    total += computeGroupTotal(instanceId, groupKey, project, globalPrices);
  }
  return total;
}

/**
 * Grand total: iterate ALL selections in project.selections, add computeLineTotal per entry.
 * This is the canonical sum — equals the sum of all rounded line totals.
 *
 * Defensive safeguard: selections for items in deletedItemIds, or items that
 * no longer resolve through the catalog or project.customItems (e.g. a stale
 * selection left behind by a data bug), are ignored. This never changes a
 * valid total — it only guards against a deleted/unknown item silently
 * contributing to the total when its selection key wasn't cleaned up.
 *
 * @param {{selections?: Record<string,{qty:string}>, priceOverrides?: Record<string,number>, customItems?: Array<{id:string,defaultCost:number}>, deletedItemIds?: string[]}} project
 * @param {Record<string,number>} globalPrices
 * @returns {number}
 */
export function computeGrandTotal(project, globalPrices) {
  const selections = (project && project.selections) ? project.selections : {};
  const deletedSet = new Set((project && project.deletedItemIds) || []);
  let total = 0;
  for (const selKey of Object.keys(selections)) {
    // selKey format: "${instanceId}::${itemId}" — split on first "::"
    const sepIdx = selKey.indexOf('::');
    if (sepIdx === -1) continue;
    const itemId = selKey.slice(sepIdx + 2);
    if (deletedSet.has(itemId)) continue;
    if (getItem(itemId, project) === undefined) continue;
    const entry = selections[selKey];
    total += computeLineTotal(itemId, entry.qty, project, globalPrices);
  }
  return total;
}

/**
 * Format a number as a dollar string with no cents.
 * n is expected to be an already-rounded integer from totals.
 * Math.round here is purely defensive.
 *
 * @param {number} n
 * @returns {string}  e.g. "$1,234"
 */
export function formatMoney(n) {
  return '$' + Math.round(n).toLocaleString('en-US');
}

/**
 * Format a UNIT cost for display. Shows cents only when the cost actually has
 * a fractional part (e.g. $4.75/sqft, $8.35/sqft) and a whole number otherwise
 * (e.g. $5/sqft). Use this for per-unit display; use formatMoney for rounded
 * line/grand totals.
 *
 * @param {number} n
 * @returns {string}  e.g. "$4.75", "$8.35", "$5", "$1,250"
 */
export function formatUnitCost(n) {
  const num = Number(n) || 0;
  const rounded = Math.round(num);
  const hasFraction = Math.abs(num - rounded) > 1e-9;
  if (hasFraction) {
    return '$' + num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  return '$' + rounded.toLocaleString('en-US');
}

// ============================================================================
// CSV parse / diff / apply / export
// ============================================================================

/**
 * RFC-4180 aware CSV parser.
 * Handles: quoted fields, doubled quotes ("" → "), commas inside quotes, CRLF/LF.
 * Returns parsed rows for the data rows only (header is line 1).
 * Required header columns (case-insensitive, trimmed): id, name, cost, unit.
 *
 * @param {string} text
 * @returns {{ headerOk: boolean, missingColumns: string[], rows: Array<{lineNumber:number,id:string,name:string,cost:number,unit:string,rawCostText:string}> }}
 */
export function parsePriceCSV(text) {
  // Normalize line endings — replace CRLF with LF then split on LF
  const normalised = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // RFC-4180 tokeniser: parse the entire text into an array of rows, each an array of fields.
  // We need line numbers aligned with original CRLF-normalised lines.
  const allRows = _parseCSVRows(normalised);

  if (allRows.length === 0) {
    return { headerOk: false, missingColumns: ['id', 'name', 'cost', 'unit'], rows: [] };
  }

  // Header row (line 1)
  const headerFields = allRows[0].map(f => f.trim().toLowerCase());
  const REQUIRED_COLS = ['id', 'name', 'cost', 'unit'];
  const missingColumns = REQUIRED_COLS.filter(col => !headerFields.includes(col));
  const headerOk = missingColumns.length === 0;

  if (!headerOk) {
    return { headerOk, missingColumns, rows: [] };
  }

  const idIdx   = headerFields.indexOf('id');
  const nameIdx = headerFields.indexOf('name');
  const costIdx = headerFields.indexOf('cost');
  const unitIdx = headerFields.indexOf('unit');

  const rows = [];
  for (let r = 1; r < allRows.length; r++) {
    const fields = allRows[r];
    // Skip completely empty lines
    if (fields.length === 1 && fields[0].trim() === '') continue;

    const lineNumber = r + 1; // header is line 1; first data row is line 2
    const id          = (fields[idIdx]   || '').trim();
    const name        = (fields[nameIdx] || '').trim();
    const rawCostText = (fields[costIdx] || '').trim();
    const unit        = (fields[unitIdx] || '').trim();
    const cost        = parseFloat(rawCostText);

    rows.push({ lineNumber, id, name, cost, unit, rawCostText });
  }

  return { headerOk, missingColumns, rows };
}

/**
 * Internal RFC-4180 row tokeniser.
 * Returns array-of-arrays. Line numbers are implicit (index+1 in outer array).
 *
 * Strategy: split into logical lines first (respecting quoted newlines), then split
 * each line into fields (respecting quoted commas). This avoids complex pos-tracking.
 *
 * @param {string} text  Already CRLF-normalised (uses \n only)
 * @returns {string[][]}
 */
function _parseCSVRows(text) {
  const rows = [];
  let pos = 0;
  const len = text.length;

  while (pos < len) {
    const row = [];
    let endOfInput = false;

    // Parse one row: collect fields until \n (outside quotes) or end of input
    while (true) {
      if (pos >= len) {
        endOfInput = true;
        break;
      }

      const ch = text[pos];

      if (ch === '\n') {
        // End of row (unquoted newline)
        pos++; // consume the newline
        break;
      }

      if (ch === '"') {
        // Quoted field
        pos++; // skip opening quote
        let field = '';
        while (pos < len) {
          const c = text[pos];
          if (c === '"') {
            if (pos + 1 < len && text[pos + 1] === '"') {
              // Doubled quote → literal "
              field += '"';
              pos += 2;
            } else {
              // Closing quote
              pos++;
              break;
            }
          } else {
            field += c;
            pos++;
          }
        }
        row.push(field);
        // After closing quote, consume the comma separator (if any) or let next iteration handle \n/end
        if (pos < len && text[pos] === ',') {
          pos++; // consume comma; next iteration parses the next field
          // If the comma is the last char before \n or end, we need an empty field:
          if (pos >= len || text[pos] === '\n') {
            row.push('');
            if (pos < len && text[pos] === '\n') pos++;
            break;
          }
        } else {
          // \n or end — row ends; let the outer while(true) handle it next iteration
          // Actually, we need to handle \n here:
          if (pos < len && text[pos] === '\n') {
            pos++;
          }
          break;
        }
      } else if (ch === ',') {
        // Empty field before this comma
        row.push('');
        pos++; // consume comma
        // If comma is last before \n or end, push another empty field
        if (pos >= len || text[pos] === '\n') {
          row.push('');
          if (pos < len && text[pos] === '\n') pos++;
          break;
        }
      } else {
        // Unquoted field — read until comma or \n or end
        let field = '';
        while (pos < len && text[pos] !== ',' && text[pos] !== '\n') {
          field += text[pos];
          pos++;
        }
        row.push(field);
        if (pos < len && text[pos] === ',') {
          pos++; // consume comma
          // If comma is last before \n or end, push empty field
          if (pos >= len || text[pos] === '\n') {
            row.push('');
            if (pos < len && text[pos] === '\n') pos++;
            break;
          }
          // Otherwise: continue loop to parse the next field
        } else {
          // \n or end of input
          if (pos < len && text[pos] === '\n') pos++;
          break;
        }
      }
    }

    // Push row only if it has content (skip phantom empty rows from trailing newlines)
    if (row.length > 0 && !(row.length === 1 && row[0] === '')) {
      rows.push(row);
    } else if (row.length === 0 && !endOfInput) {
      // genuinely empty line (e.g. blank line between rows) — skip silently
    }
  }

  return rows;
}

/**
 * Diff the parsed CSV against current global prices.
 * Determines what would change, what is unchanged, and what has warnings.
 *
 * @param {{ headerOk: boolean, missingColumns: string[], rows: Array<{lineNumber:number,id:string,name:string,cost:number,unit:string,rawCostText:string}> }} parsed
 * @param {Record<string,number>} globalPrices
 * @returns {{ changes: Array<{id:string,name:string,oldCost:number,newCost:number}>, unchanged: string[], warnings: Array<{lineNumber:number,id:string|null,issueType:string,message:string,actionTaken:string}> }}
 */
export function diffPriceCSV(parsed, globalPrices) {
  // Abort case: header not ok
  if (!parsed.headerOk) {
    const list = parsed.missingColumns.join(', ');
    return {
      changes: [],
      unchanged: [],
      warnings: [{
        lineNumber: 1,
        id: null,
        issueType: 'missing-columns',
        message: `CSV missing required column(s): ${list}`,
        actionTaken: 'skipped',
      }],
    };
  }

  const changes = [];
  const unchanged = [];
  const warnings = [];

  const seenIds = new Set(); // for duplicate detection within THIS file

  for (const row of parsed.rows) {
    const { lineNumber, id, name, cost, unit, rawCostText } = row;

    // Unknown id check
    if (!_catalogIdSet.has(id)) {
      warnings.push({
        lineNumber,
        id,
        issueType: 'unknown-id',
        message: `No catalog item with id '${id}' — skipped.`,
        actionTaken: 'skipped',
      });
      continue;
    }

    // Duplicate id check (skip later duplicates, keep first occurrence's handling)
    if (seenIds.has(id)) {
      warnings.push({
        lineNumber,
        id,
        issueType: 'duplicate-id',
        message: `Duplicate id '${id}' in CSV — skipped (first occurrence used).`,
        actionTaken: 'skipped',
      });
      continue;
    }
    seenIds.add(id);

    // Invalid cost check: NaN, negative, or empty rawCostText
    if (rawCostText === '' || isNaN(cost) || cost < 0) {
      warnings.push({
        lineNumber,
        id,
        issueType: 'invalid-cost',
        message: `Invalid cost '${rawCostText}' for id '${id}' — skipped.`,
        actionTaken: 'skipped',
      });
      continue;
    }

    // Catalog item (known, valid cost) — check name/unit mismatches
    const catalogItem = CATALOG_ITEMS.find(ci => ci.id === id);
    // (catalogItem is guaranteed non-null here since we checked _catalogIdSet)

    if (name !== catalogItem.name) {
      warnings.push({
        lineNumber,
        id,
        issueType: 'name-mismatch',
        message: `Name mismatch for '${id}': expected '${catalogItem.name}', got '${name}' — warning only.`,
        actionTaken: 'warning-only',
      });
    }

    if (unit !== catalogItem.unit) {
      warnings.push({
        lineNumber,
        id,
        issueType: 'unit-mismatch',
        message: `Unit mismatch for '${id}': expected '${catalogItem.unit}', got '${unit}' — warning only.`,
        actionTaken: 'warning-only',
      });
    }

    // Compare new cost to current effective global value
    const currentEffective = Object.prototype.hasOwnProperty.call(globalPrices, id)
      ? globalPrices[id]
      : catalogItem.defaultCost;

    if (cost !== currentEffective) {
      changes.push({ id, name: catalogItem.name, oldCost: currentEffective, newCost: cost });
    } else {
      unchanged.push(id);
    }
  }

  return { changes, unchanged, warnings };
}

/**
 * Apply a diff's changes to globalPrices, returning a NEW object.
 * Never mutates the input. Only applies `changes` entries.
 * Name/unit mismatches are never applied (they only appear in warnings).
 *
 * @param {{ changes: Array<{id:string,newCost:number}> }} diff
 * @param {Record<string,number>} globalPrices
 * @returns {Record<string,number>}
 */
export function applyPriceDiff(diff, globalPrices) {
  const next = { ...globalPrices };
  for (const change of diff.changes) {
    next[change.id] = change.newCost;
  }
  return next;
}

/**
 * Remove a single item override from globalPrices, reverting it to catalog default.
 * Returns a NEW object with that key deleted.
 *
 * @param {string} itemId
 * @param {Record<string,number>} globalPrices
 * @returns {Record<string,number>}
 */
export function resetPrice(itemId, globalPrices) {
  const next = { ...globalPrices };
  delete next[itemId];
  return next;
}

/**
 * Returns an empty global overrides object (all prices revert to catalog defaults).
 *
 * @returns {{}}
 */
export function resetAllPrices() {
  return {};
}

/**
 * Export current price book as RFC-4180 CSV.
 * Columns: id, name, cost, unit.
 * Cost = current GLOBAL resolved (globalPrices[id] ?? catalogItem.defaultCost).
 * Names/units always from catalog (never overwritten by global overrides).
 * Covers all 108 catalog items. Custom items from project may also be included if provided.
 *
 * @param {{customItems?: Array<{id:string,name:string,unit:string,defaultCost:number}>}|null} project
 * @param {Record<string,number>} globalPrices
 * @returns {string}  CSV text with \n line endings
 */
export function exportPriceBookCSV(project, globalPrices) {
  const lines = ['id,name,cost,unit'];

  for (const item of CATALOG_ITEMS) {
    const cost = Object.prototype.hasOwnProperty.call(globalPrices, item.id)
      ? globalPrices[item.id]
      : item.defaultCost;
    lines.push(
      `${_csvField(item.id)},${_csvField(item.name)},${cost},${_csvField(item.unit)}`
    );
  }

  // Optionally include custom items from project
  if (project && Array.isArray(project.customItems)) {
    for (const ci of project.customItems) {
      const cost = Object.prototype.hasOwnProperty.call(globalPrices, ci.id)
        ? globalPrices[ci.id]
        : ci.defaultCost;
      lines.push(
        `${_csvField(ci.id)},${_csvField(ci.name)},${cost},${_csvField(ci.unit)}`
      );
    }
  }

  return lines.join('\n');
}

/**
 * RFC-4180 field encoder.
 * Wraps in double-quotes if the field contains a comma, double-quote, or newline.
 * Doubles any internal double-quotes.
 *
 * @param {string} field
 * @returns {string}
 */
function _csvField(field) {
  const s = String(field);
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}
