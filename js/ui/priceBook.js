/**
 * js/ui/priceBook.js — Phase 9 (Agent D)
 * Global price administration screen.
 * Route: #/pricebook
 *
 * Named export: render(rootEl, params)
 * No default export. Vanilla ESM.
 *
 * Contract refs: §7 (Price Book UX), §19 (globalPrices in settings),
 *   §20 (pricing fns), §21 (CSV fns), §28 (route), §32 (CSV warning schema).
 *
 * This screen edits GLOBAL prices only via setGlobalPrices().
 * It does NOT touch per-project priceOverrides.
 */

import {
  getGlobalPrices,
  setGlobalPrices,
  getActiveProject,
  onChange,
} from '../state.js';

import {
  CATALOG_ITEMS,
  GROUPS,
} from '../catalog.js';

import {
  parsePriceCSV,
  diffPriceCSV,
  applyPriceDiff,
  resetPrice,
  resetAllPrices,
  exportPriceBookCSV,
  formatMoney,
} from '../pricing.js';

import {
  showSheet,
  confirm,
  toast,
} from './components.js';

/* ============================================================
   Module-level UI state (in-memory, not persisted)
   ============================================================ */

/** Current search/filter term */
let _searchTerm = '';

/** The pending diff result (set during import preview, cleared on apply/cancel) */
let _pendingDiff = null;

/** onChange unsubscribe fn — stored so we don't double-subscribe */
let _unsubscribe = null;

/** Whether we are currently mounted (rootEl is live) */
let _rootEl = null;

/* ============================================================
   render — public named export
   ============================================================ */

/**
 * Render the price book view into rootEl.
 * @param {HTMLElement} rootEl
 * @param {object} params - route params (empty for pricebook)
 */
export async function render(rootEl, params) {
  _rootEl = rootEl;
  _searchTerm = '';
  _pendingDiff = null;

  // Subscribe to state changes so price edits elsewhere propagate here.
  // Unsubscribe old handler first to stay idempotent.
  if (_unsubscribe) {
    _unsubscribe();
    _unsubscribe = null;
  }
  _unsubscribe = onChange(() => {
    // Only re-render while Price Book is the active route. Otherwise self-clean:
    // a state change elsewhere (e.g. toggling an item back in the walkthrough)
    // must never repaint Price Book over another view.
    if (window.location.hash.startsWith('#/pricebook')) {
      _renderContent(rootEl);
    } else if (_unsubscribe) {
      _unsubscribe();
      _unsubscribe = null;
    }
  });

  _renderContent(rootEl);
  _attachHandlers(rootEl);
}

/* ============================================================
   Rendering
   ============================================================ */

function _renderContent(rootEl) {
  const globalPrices = getGlobalPrices();
  const overriddenCount = Object.keys(globalPrices).length;

  rootEl.innerHTML = `
    ${_headerHtml()}
    <div class="page-content pb-pricebook">

      ${/* Top action bar */''}
      <div class="pb-action-bar">
        <label class="btn btn--secondary btn--sm pb-action-btn pb-import-label" aria-label="Import CSV">
          <span class="pb-action-btn__icon" aria-hidden="true">⬆</span> Import CSV
          <input
            type="file"
            accept=".csv,text/csv"
            class="pb-file-input"
            data-action="pb-import"
            aria-hidden="true"
            tabindex="-1"
          />
        </label>
        <button class="btn btn--secondary btn--sm pb-action-btn" data-action="pb-export">
          <span class="pb-action-btn__icon" aria-hidden="true">⬇</span> Export CSV
        </button>
        <button class="btn btn--danger-outline btn--sm pb-action-btn" data-action="pb-reset-all" ${overriddenCount === 0 ? 'disabled' : ''}>
          Reset Prices
        </button>
      </div>

      ${/* Search */''}
      <div class="pb-search-wrap">
        <input
          type="search"
          class="input pb-search-input"
          placeholder="Search by name or ID…"
          value="${_esc(_searchTerm)}"
          autocomplete="off"
          autocorrect="off"
          spellcheck="false"
          data-action="pb-search"
          aria-label="Search price items"
        />
      </div>

      ${/* Price list */''}
      <div class="pb-list card" id="pb-list">
        ${_priceListHtml(globalPrices)}
      </div>

      ${/* Storage footer */''}
      <div class="pb-footer" id="pb-storage-footer">
        <span class="text-muted text-xs">Estimating storage…</span>
      </div>
    </div>
  `;

  // Kick off storage estimate (async; updates footer in-place)
  _updateStorageFooter();
}

function _headerHtml() {
  return `
    <header class="app-header">
      <button
        class="icon-btn"
        data-action="pb-back"
        aria-label="Back"
        title="Back"
      ><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5M12 5l-7 7 7 7"/></svg></button>
      <span class="app-header__title">Price Book</span>
    </header>
  `;
}

function _priceListHtml(globalPrices) {
  const term = _searchTerm.trim().toLowerCase();

  // Filter items
  const filtered = CATALOG_ITEMS.filter(item => {
    if (!term) return true;
    return (
      item.name.toLowerCase().includes(term) ||
      item.id.toLowerCase().includes(term)
    );
  });

  if (filtered.length === 0) {
    return `<div class="pb-empty">No items match "${_esc(_searchTerm)}"</div>`;
  }

  return filtered.map(item => _priceRowHtml(item, globalPrices)).join('');
}

function _priceRowHtml(item, globalPrices) {
  const hasOverride = Object.prototype.hasOwnProperty.call(globalPrices, item.id);
  const currentCost = hasOverride ? globalPrices[item.id] : item.defaultCost;
  const priceStr = _fmtPrice(currentCost);

  const overrideBadge = hasOverride
    ? `<span class="badge badge--warning pb-override-badge" title="Default: ${_fmtPrice(item.defaultCost)}">overridden</span>`
    : '';

  const resetBtn = hasOverride
    ? `<button
         class="btn btn--ghost btn--sm pb-reset-btn"
         data-action="pb-reset"
         data-item-id="${_esc(item.id)}"
         aria-label="Reset ${_esc(item.name)} to default"
         title="Reset to default (${_fmtPrice(item.defaultCost)})"
       >Reset</button>`
    : '';

  return `
    <div class="pb-price-row list-item" data-item-id="${_esc(item.id)}">
      <div class="pb-row-info">
        <div class="pb-row-name">
          ${_esc(item.name)}
          ${overrideBadge}
        </div>
        <div class="pb-row-meta">
          <span class="pb-row-id">${_esc(item.id)}</span>
          <span class="pb-row-unit">${_esc(item.unit)}</span>
          ${hasOverride ? `<span class="pb-row-default text-muted text-xs">default: ${_fmtPrice(item.defaultCost)}</span>` : ''}
        </div>
      </div>
      <div class="pb-row-actions">
        <span class="pb-row-price tabular-nums">${_esc(priceStr)}</span>
        <button
          class="btn btn--secondary btn--sm"
          data-action="pb-edit"
          data-item-id="${_esc(item.id)}"
          data-item-name="${_esc(item.name)}"
          data-item-cost="${currentCost}"
          aria-label="Edit price for ${_esc(item.name)}"
        >Edit</button>
        ${resetBtn}
      </div>
    </div>
  `;
}

async function _updateStorageFooter() {
  const footer = _rootEl && _rootEl.querySelector('#pb-storage-footer');
  if (!footer) return;

  try {
    if (!navigator.storage || typeof navigator.storage.estimate !== 'function') {
      footer.innerHTML = '<span class="text-muted text-xs">Storage info unavailable in this browser.</span>';
      return;
    }
    const est = await navigator.storage.estimate();
    const usedMB  = ((est.usage  || 0) / (1024 * 1024)).toFixed(1);
    const quotaMB = ((est.quota  || 0) / (1024 * 1024)).toFixed(0);
    footer.innerHTML = `
      <span class="text-muted text-xs">
        Storage: ${usedMB} MB used of ~${quotaMB} MB available
      </span>
    `;
  } catch (_) {
    footer.innerHTML = '<span class="text-muted text-xs">Storage estimate unavailable.</span>';
  }
}

/* ============================================================
   Import diff preview sheet
   ============================================================ */

function _diffPreviewHtml(diff) {
  const { changes, unchanged, warnings } = diff;

  // Check for missing-columns abort
  const missingColWarning = warnings.find(w => w.issueType === 'missing-columns');

  // Summary
  const summaryHtml = `
    <div class="pb-diff-summary">
      <span class="pb-diff-stat pb-diff-stat--changes">${changes.length} change${changes.length !== 1 ? 's' : ''}</span>
      <span class="pb-diff-stat pb-diff-stat--unchanged">${unchanged.length} unchanged</span>
      <span class="pb-diff-stat pb-diff-stat--warnings">${warnings.length} warning${warnings.length !== 1 ? 's' : ''}</span>
    </div>
  `;

  // Changes list
  const changesHtml = changes.length > 0
    ? `
      <div class="pb-diff-section">
        <div class="pb-diff-section-title">Changes (${changes.length})</div>
        <div class="pb-changes-list">
          ${changes.map(c => `
            <div class="pb-change-row">
              <span class="pb-change-name">${_esc(c.name)}</span>
              <span class="pb-change-id text-muted text-xs">${_esc(c.id)}</span>
              <span class="pb-change-prices">
                <span class="pb-change-old tabular-nums">${_fmtPrice(c.oldCost)}</span>
                <span class="pb-change-arrow">&rarr;</span>
                <span class="pb-change-new tabular-nums text-success">${_fmtPrice(c.newCost)}</span>
              </span>
            </div>
          `).join('')}
        </div>
      </div>
    `
    : '';

  // Warnings table
  const warningsHtml = warnings.length > 0
    ? `
      <div class="pb-diff-section">
        <div class="pb-diff-section-title">Warnings (${warnings.length})</div>
        <div class="pb-warn-table-wrap">
          <table class="pb-warn-table">
            <thead>
              <tr>
                <th>Line #</th>
                <th>ID</th>
                <th>Issue Type</th>
                <th>Message</th>
                <th>Action Taken</th>
              </tr>
            </thead>
            <tbody>
              ${warnings.map(w => `
                <tr class="pb-warn-row pb-warn-row--${_esc(w.issueType)}">
                  <td class="tabular-nums">${w.lineNumber != null ? w.lineNumber : '—'}</td>
                  <td class="tabular-nums">${w.id ? _esc(w.id) : '—'}</td>
                  <td><span class="pb-warn-type">${_esc(w.issueType)}</span></td>
                  <td class="pb-warn-msg">${_esc(w.message)}</td>
                  <td><span class="pb-action-taken pb-action-taken--${_esc(w.actionTaken)}">${_esc(w.actionTaken)}</span></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `
    : '';

  const canApply = !missingColWarning && changes.length > 0;

  return `
    <div class="pb-diff-preview">
      ${summaryHtml}
      ${missingColWarning
        ? `<div class="pb-diff-abort-msg text-danger">
             Import aborted: ${_esc(missingColWarning.message)}
           </div>`
        : ''
      }
      ${changesHtml}
      ${warningsHtml}
      ${changes.length === 0 && !missingColWarning
        ? `<div class="pb-diff-no-changes text-muted">No price changes to apply.</div>`
        : ''
      }
      <div class="pb-diff-actions">
        <button
          class="btn btn--ghost btn--sm"
          data-action="pb-cancel-diff"
        >Cancel</button>
        <button
          class="btn btn--primary btn--sm"
          data-action="pb-apply-diff"
          ${canApply ? '' : 'disabled'}
        >Apply ${changes.length} change${changes.length !== 1 ? 's' : ''}</button>
      </div>
    </div>
  `;
}

/* ============================================================
   Event delegation — named handler, idempotent attach
   ============================================================ */

/** Symbol used as the flag property on rootEl to avoid double-attaching */
const _HANDLER_KEY  = '__pbClickHandler';
const _INPUT_KEY    = '__pbInputHandler';
const _CHANGE_KEY   = '__pbChangeHandler';

function _attachHandlers(rootEl) {
  // Remove old handlers if re-rendering into same rootEl (idempotent)
  if (rootEl[_HANDLER_KEY]) {
    rootEl.removeEventListener('click', rootEl[_HANDLER_KEY]);
  }
  if (rootEl[_INPUT_KEY]) {
    rootEl.removeEventListener('input', rootEl[_INPUT_KEY]);
  }
  if (rootEl[_CHANGE_KEY]) {
    rootEl.removeEventListener('change', rootEl[_CHANGE_KEY]);
  }

  const clickHandler  = (e) => _handleClick(e, rootEl);
  const inputHandler  = (e) => _handleInput(e, rootEl);
  const changeHandler = (e) => _handleChange(e, rootEl);

  rootEl.addEventListener('click',  clickHandler);
  rootEl.addEventListener('input',  inputHandler);
  rootEl.addEventListener('change', changeHandler);

  rootEl[_HANDLER_KEY]  = clickHandler;
  rootEl[_INPUT_KEY]    = inputHandler;
  rootEl[_CHANGE_KEY]   = changeHandler;
}

function _handleInput(e, rootEl) {
  const el = e.target;
  if (!el) return;

  // Search box — live filter without full re-render (preserves focus)
  if (el.dataset.action === 'pb-search') {
    _searchTerm = el.value;
    const listEl = rootEl.querySelector('#pb-list');
    if (listEl) {
      listEl.innerHTML = _priceListHtml(getGlobalPrices());
    }
    return;
  }
}

function _handleChange(e, rootEl) {
  const el = e.target;
  if (!el) return;

  // File input — fires 'change', not 'input'
  if (el.dataset.action === 'pb-import') {
    _handleImportFile(el, rootEl);
    return;
  }
}

function _handleClick(e, rootEl) {
  // Walk up DOM to find data-action
  let el = e.target;
  while (el && el !== rootEl) {
    const action = el.dataset && el.dataset.action;
    if (action) {
      e.stopPropagation();
      _dispatch(action, el, rootEl, e);
      return;
    }
    el = el.parentElement;
  }
}

async function _dispatch(action, el, rootEl, e) {
  switch (action) {

    case 'navigate': {
      // Use the global hash navigation (app-level delegated handler also handles this,
      // but ours fires first via stopPropagation — so we do it ourselves)
      const href = el.dataset.href;
      if (href) window.location.hash = href;
      break;
    }

    case 'pb-back': {
      // Return to wherever Price Book was opened from (the project, or the
      // dashboard). Hash routes are real history entries, so back() restores
      // the source route instead of always jumping to the dashboard.
      if (window.history.length > 1) {
        window.history.back();
      } else {
        window.location.hash = '#/dashboard';
      }
      break;
    }

    case 'pb-edit': {
      await _handleEdit(el, rootEl);
      break;
    }

    case 'pb-reset': {
      await _handleReset(el, rootEl);
      break;
    }

    case 'pb-reset-all': {
      await _handleResetAll(rootEl);
      break;
    }

    case 'pb-export': {
      _handleExport();
      break;
    }

    case 'pb-apply-diff': {
      await _handleApplyDiff(rootEl);
      break;
    }

    case 'pb-cancel-diff': {
      _pendingDiff = null;
      // Re-render to close the inline diff preview and reset file input
      _renderContent(rootEl);
      _attachHandlers(rootEl);
      break;
    }

    default:
      break;
  }
}

/* ============================================================
   Action handlers
   ============================================================ */

async function _handleEdit(el, rootEl) {
  const itemId   = el.dataset.itemId;
  const itemName = el.dataset.itemName || itemId;
  const currentCost = parseFloat(el.dataset.itemCost);

  if (!itemId) return;

  // Use a custom numeric-input modal via showSheet
  // (showModal is text-only; we build a sheet with a number input)
  const newValStr = await _showNumericSheet({
    title: `Edit Price — ${itemName}`,
    label: 'New price ($)',
    value: isNaN(currentCost) ? '' : String(currentCost),
    placeholder: '0.00',
  });

  if (newValStr === null) return; // cancelled

  const newVal = parseFloat(newValStr);
  if (isNaN(newVal) || newVal < 0) {
    toast('Invalid price — enter a number ≥ 0', { type: 'error' });
    return;
  }

  try {
    const updated = { ...getGlobalPrices(), [itemId]: newVal };
    await setGlobalPrices(updated);
    toast(`Price updated to ${_fmtPrice(newVal)}`, { type: 'success' });
    // onChange will re-render; but we also restore the search input focus
    requestAnimationFrame(() => {
      const searchEl = rootEl.querySelector('.pb-search-input');
      // Don't steal focus if user is elsewhere
    });
  } catch (err) {
    toast('Could not save price: ' + (err.message || err), { type: 'error' });
  }
}

async function _handleReset(el, rootEl) {
  const itemId = el.dataset.itemId;
  if (!itemId) return;

  try {
    const updated = resetPrice(itemId, getGlobalPrices());
    await setGlobalPrices(updated);
    toast('Price reset to default', { type: 'info' });
  } catch (err) {
    toast('Could not reset price: ' + (err.message || err), { type: 'error' });
  }
}

async function _handleResetAll(rootEl) {
  const count = Object.keys(getGlobalPrices()).length;
  if (count === 0) return;

  const ok = await confirm({
    title: 'Reset All Prices',
    message: `Reset all ${count} overridden price${count !== 1 ? 's' : ''} back to catalog defaults? This cannot be undone.`,
    confirmText: 'Reset All',
    danger: true,
  });
  if (!ok) return;

  try {
    await setGlobalPrices(resetAllPrices());
    toast('All prices reset to defaults', { type: 'info' });
  } catch (err) {
    toast('Could not reset prices: ' + (err.message || err), { type: 'error' });
  }
}

function _handleExport() {
  try {
    const project = getActiveProject();
    const csv = exportPriceBookCSV(project, getGlobalPrices());
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    a.href     = url;
    a.download = `spark-price-book-${date}.csv`;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    toast('Price book exported', { type: 'success' });
  } catch (err) {
    toast('Export failed: ' + (err.message || err), { type: 'error' });
  }
}

async function _handleImportFile(inputEl, rootEl) {
  const file = inputEl.files && inputEl.files[0];
  // Reset the input value so the same file can be selected again later
  inputEl.value = '';

  if (!file) return;

  let text;
  try {
    text = await file.text();
  } catch (err) {
    toast('Could not read file: ' + (err.message || err), { type: 'error' });
    return;
  }

  let parsed, diff;
  try {
    parsed = parsePriceCSV(text);
    diff   = diffPriceCSV(parsed, getGlobalPrices());
  } catch (err) {
    toast('Parse error: ' + (err.message || err), { type: 'error' });
    return;
  }

  _pendingDiff = diff;

  // Show the diff preview inline in a sheet
  await _showDiffSheet(diff, rootEl);
}

async function _showDiffSheet(diff, rootEl) {
  // We use showSheet for the diff preview. Actions are wired in the HTML
  // via data-action attributes and handled by our delegated click handler.
  // However showSheet resolves on button click. Instead we render the diff
  // inline inside a sheet body and wire our own data-actions into the sheet's
  // DOM via the sheet-root. This is the cleanest approach: we pass raw html
  // and catch button clicks inside the sheet via showSheet's actions array.

  const missingColWarning = diff.warnings.find(w => w.issueType === 'missing-columns');
  const canApply = !missingColWarning && diff.changes.length > 0;

  const actions = [];
  if (canApply) {
    actions.push({
      label: `Apply ${diff.changes.length} change${diff.changes.length !== 1 ? 's' : ''}`,
      value: 'apply',
      primary: true,
    });
  }
  actions.push({
    label: 'Cancel',
    value: 'cancel',
  });

  const result = await showSheet({
    title: 'Import Preview',
    html: _diffPreviewHtml(diff),
    actions,
  });

  if (result === 'apply') {
    await _applyDiff(diff, rootEl);
  } else {
    // Cancelled — clear pending diff
    _pendingDiff = null;
  }
}

async function _handleApplyDiff(rootEl) {
  if (!_pendingDiff) return;
  await _applyDiff(_pendingDiff, rootEl);
}

async function _applyDiff(diff, rootEl) {
  try {
    const updated = applyPriceDiff(diff, getGlobalPrices());
    await setGlobalPrices(updated);
    const n = diff.changes.length;
    toast(`${n} price${n !== 1 ? 's' : ''} updated`, { type: 'success' });
  } catch (err) {
    toast('Could not apply changes: ' + (err.message || err), { type: 'error' });
  } finally {
    _pendingDiff = null;
    // Re-render the list (onChange will also fire, but be explicit)
    _renderContent(rootEl);
    _attachHandlers(rootEl);
  }
}

/* ============================================================
   Numeric input sheet (edit price)
   ============================================================ */

/**
 * Show a bottom sheet with a number input.
 * Returns the trimmed string value or null on cancel.
 *
 * @param {{ title: string, label: string, value: string, placeholder: string }} opts
 * @returns {Promise<string|null>}
 */
function _showNumericSheet({ title, label, value, placeholder }) {
  return new Promise((resolve) => {
    const inputId = 'pb-price-input-' + Date.now();
    const html = `
      <div class="field" style="margin-bottom:var(--sp-2)">
        <label class="field__label" for="${inputId}">${_esc(label)}</label>
        <input
          id="${inputId}"
          class="input"
          type="number"
          step="0.01"
          min="0"
          value="${_esc(value)}"
          placeholder="${_esc(placeholder)}"
          inputmode="decimal"
          autocomplete="off"
        />
      </div>
    `;

    // We need to wire the input after the sheet is in the DOM.
    // showSheet's `actions` handle resolution.
    showSheet({
      title,
      html,
      actions: [
        { label: 'Save', value: '__save__', primary: true },
        { label: 'Cancel', value: null },
      ],
    }).then((result) => {
      if (result !== '__save__') {
        resolve(null);
        return;
      }
      // Read the value from the DOM before the sheet is removed.
      // The sheet animates out — the input still exists for a brief moment.
      // We read via the sheet-root.
      const sheetRoot = document.getElementById('sheet-root');
      if (sheetRoot) {
        const inp = sheetRoot.querySelector('#' + inputId);
        if (inp) {
          resolve(inp.value.trim() || null);
          return;
        }
      }
      resolve(null);
    });

    // Auto-focus after the sheet animates in
    requestAnimationFrame(() => {
      setTimeout(() => {
        const sheetRoot = document.getElementById('sheet-root');
        if (sheetRoot) {
          const inp = sheetRoot.querySelector('#' + inputId);
          if (inp) {
            inp.focus();
            inp.select();
          }
        }
      }, 50);
    });
  });
}

/* ============================================================
   Helpers
   ============================================================ */

/**
 * Format a price to 2 decimal places with a $ prefix.
 * (formatMoney from pricing.js shows integers with no cents; prices can be decimal)
 * @param {number} n
 * @returns {string}
 */
function _fmtPrice(n) {
  if (typeof n !== 'number' || isNaN(n)) return '$0.00';
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** HTML-escape a string for safe insertion */
function _esc(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
