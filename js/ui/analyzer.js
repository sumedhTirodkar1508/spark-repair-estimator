/**
 * js/ui/analyzer.js — Phase 8 (Agent E)
 * Deal Analyzer screen: ARV/MAO math, live results, PASS/WATCH/FAIL badge.
 *
 * Named export: render(rootEl, params)
 * No default export. Vanilla ESM.
 *
 * Live-update strategy (§E rules):
 *   - On input events, call setAnalyzer({field: value}) which triggers onChange.
 *   - onChange handler ONLY updates the results region (#an-results) in place —
 *     it does NOT re-render the entire screen, preserving input focus.
 *   - _suppressRerender flag prevents full re-renders while an input is focused.
 *
 * Event model:
 *   - Named delegated handler (_handleInput) on rootEl (idempotent).
 *   - data-action prefixed "an-*".
 */

import {
  getActiveProject,
  getGlobalPrices,
  onChange,
  switchProject,
  setAnalyzer,
} from '../state.js';

import { computeGrandTotal, formatMoney } from '../pricing.js';
import { computeDeal } from '../dealAnalyzer.js';

// ============================================================================
// Module-level state
// ============================================================================

/** onChange unsubscribe fn */
let _unsubscribe = null;

/** Suppress full re-render while an input is focused */
let _suppressRerender = false;

// ============================================================================
// render
// ============================================================================

/**
 * Render the deal analyzer view into rootEl.
 *
 * @param {HTMLElement} rootEl
 * @param {{ id:string }} params
 */
export async function render(rootEl, params) {
  // Ensure the requested project is active
  const requestedId = params && params.id;
  if (requestedId) {
    const active = getActiveProject();
    if (!active || active.id !== requestedId) {
      try {
        await switchProject(requestedId);
      } catch (err) {
        rootEl.innerHTML = `
          <div class="page-content" style="padding:var(--sp-6)">
            <p class="text-danger">Project not found (${_esc(requestedId)})</p>
            <a href="#/" class="btn btn--ghost" style="margin-top:var(--sp-4)">← Back to Projects</a>
          </div>`;
        return;
      }
    }
  }

  const project      = getActiveProject();
  const globalPrices = getGlobalPrices();
  const projectId    = project ? project.id : '';

  // Remove previous subscription
  if (_unsubscribe) { _unsubscribe(); _unsubscribe = null; }

  // Attach delegated handlers (idempotent)
  if (!rootEl.dataset.anHandlerAttached) {
    rootEl.dataset.anHandlerAttached = '1';
    rootEl.addEventListener('input',  _handleInput);
    rootEl.addEventListener('focus',  _handleFocusIn,  true); // capture
    rootEl.addEventListener('blur',   _handleFocusOut, true); // capture
  }

  // Full initial render
  _renderFull(rootEl, project, globalPrices);

  // Subscribe to state changes — only update results region, not inputs
  _unsubscribe = onChange(() => {
    // Only while the analyzer is the active route; otherwise self-clean.
    if (!window.location.hash.includes('/analyzer')) {
      if (_unsubscribe) { _unsubscribe(); _unsubscribe = null; }
      return;
    }
    if (_suppressRerender) return;
    const proj  = getActiveProject();
    const gp    = getGlobalPrices();
    _updateResults(rootEl, proj, gp);
  });
}

// ============================================================================
// _renderFull — renders the entire screen (called once on load)
// ============================================================================

function _renderFull(rootEl, project, globalPrices) {
  const projectId   = project ? project.id : '';
  const inputs      = (project && project.analyzer) ? project.analyzer : {};
  const repairTotal = project ? computeGrandTotal(project, globalPrices) : 0;
  const deal        = computeDeal(inputs, repairTotal);

  rootEl.innerHTML = `
    <div class="page-header-stack">
      <div class="wt-brand-row">
        <img src="./assets/logo.png" alt="" class="wt-brand-logo" aria-hidden="true" />
        <span class="wt-brand-title">Repair Estimator</span>
      </div>
      <header class="app-header">
        <a href="#/project/${_esc(projectId)}/summary" class="icon-btn" aria-label="Back to Review &amp; Export" title="Back">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
        </a>
        <span class="app-header__title">Deal Analyzer</span>
      </header>
    </div>

    <div class="page-content an-page">

      ${!project ? `
        <div class="empty-state" style="min-height:40dvh">
          <p class="empty-state__title">No active project</p>
          <a href="#/" class="btn btn--primary">Go to Projects</a>
        </div>
      ` : `

        <!-- ── Repair Total (read-only) ─────────────────────────────────── -->
        <section class="an-section">
          <div class="an-repair-total">
            <span class="an-repair-total__label">Repair Estimate (from walkthrough)</span>
            <span class="an-repair-total__value">${formatMoney(repairTotal)}</span>
          </div>
        </section>

        <!-- ── Inputs ───────────────────────────────────────────────────── -->
        <section class="an-section">
          <h2 class="an-section__title">Deal Inputs</h2>
          <div class="an-fields">

            ${_field('arv',            'After Repair Value (ARV)',         inputs.arv,            '$',  'e.g. 200000')}
            ${_field('offerPrice',     'Offer / Purchase Price',           inputs.offerPrice,     '$',  'e.g. 120000')}
            ${_field('closingCosts',   'Closing Costs',                    inputs.closingCosts,   '$',  'e.g. 3000')}
            ${_field('sellingPct',     'Selling Cost %',                   inputs.sellingPct,     '%',  'e.g. 6')}
            ${_field('holdingMonths',  'Holding Period (months)',          inputs.holdingMonths,  '',   'e.g. 4')}
            ${_field('monthlyHolding','Monthly Holding Cost',              inputs.monthlyHolding, '$',  'e.g. 1200')}
            ${_field('targetProfit',   'Target Profit',                    inputs.targetProfit,   '$',  'e.g. 25000')}

          </div>
        </section>

        <!-- ── Results (updated in-place on input) ──────────────────────── -->
        <section class="an-section" id="an-results">
          ${_resultsHtml(deal, _isReady(inputs), inputs)}
        </section>

        <p class="an-footnote">
          MAO = ARV − Repair − Closing − Selling Costs − Holding − Target Profit
        </p>
      `}

    </div>
  `;
}

// ============================================================================
// _updateResults — in-place update of just the results section
// ============================================================================

function _updateResults(rootEl, project, globalPrices) {
  const resultsEl = rootEl.querySelector('#an-results');
  if (!resultsEl) return;

  const inputs      = (project && project.analyzer) ? project.analyzer : {};
  const repairTotal = project ? computeGrandTotal(project, globalPrices) : 0;
  const deal        = computeDeal(inputs, repairTotal);

  // Also update the repair total display (it may have changed)
  const rtEl = rootEl.querySelector('.an-repair-total__value');
  if (rtEl) rtEl.textContent = formatMoney(repairTotal);

  resultsEl.innerHTML = _resultsHtml(deal, _isReady(inputs), inputs);
}

// ============================================================================
// _resultsHtml — renders the results block as a string
// ============================================================================

function _resultsHtml(deal, ready, inputs) {
  // Don't compute / show PASS·WATCH·FAIL until the minimum inputs exist.
  if (!ready) {
    return `
    <h2 class="an-section__title">Results</h2>
    <div class="an-results an-results--empty">
      <p class="an-empty-msg">Enter <strong>ARV</strong>, <strong>offer price</strong>, and
      <strong>target profit</strong> to analyze this deal.</p>
    </div>
    `;
  }

  const statusClass = deal.status === 'PASS' ? 'pass'
    : deal.status === 'WATCH' ? 'watch'
    : 'fail';

  return `
    <h2 class="an-section__title">Results</h2>
    <div class="an-results">

      <div class="an-result-row">
        <span class="an-result-row__label">Selling Costs</span>
        <span class="an-result-row__value">${formatMoney(deal.sellingCosts)}</span>
      </div>
      <div class="an-result-row">
        <span class="an-result-row__label">Holding Costs</span>
        <span class="an-result-row__value">${formatMoney(deal.holding)}</span>
      </div>
      <div class="an-result-row an-result-row--highlight">
        <span class="an-result-row__label">Expected Profit</span>
        <span class="an-result-row__value ${deal.expectedProfit < 0 ? 'text-danger' : 'text-success'}">
          ${formatMoney(deal.expectedProfit)}
        </span>
      </div>
      <div class="an-result-row an-result-row--mao">
        <span class="an-result-row__label">Max Allowable Offer (MAO)</span>
        <span class="an-result-row__value an-result-row__value--mao">${formatMoney(deal.mao)}</span>
      </div>

      <div class="an-status an-status--${statusClass}">
        <span class="an-status__badge">${deal.status}</span>
        <span class="an-status__label">${_statusLabel(deal.status)}</span>
      </div>

      ${_offerGapHtml(deal, inputs)}

    </div>
  `;
}

// ============================================================================
// _offerGapHtml — "Offer Gap / What needs to change?" actionable explanation
// ============================================================================

/**
 * Offer Gap is derived, not a new formula: mao is defined as the offer price
 * at which expectedProfit == targetProfit, so algebraically
 *   offerPrice - mao  ==  targetProfit - expectedProfit
 * i.e. the amount the offer exceeds MAO is exactly the profit shortfall.
 * This reuses computeDeal's existing mao/expectedProfit outputs as-is —
 * no change to the deal formula.
 *
 * @param {{status:'PASS'|'WATCH'|'FAIL', mao:number, expectedProfit:number}} deal
 * @param {object} inputs  raw analyzer inputs (for offerPrice/targetProfit)
 * @returns {string}
 */
function _offerGapHtml(deal, inputs) {
  const offerPrice   = _num(inputs.offerPrice);
  const targetProfit = _num(inputs.targetProfit);
  const gap           = offerPrice - deal.mao; // > 0 whenever status is WATCH or FAIL

  if (deal.status === 'PASS') {
    const cushion = Math.max(0, deal.expectedProfit - targetProfit);
    return `
      <div class="an-offer-gap an-offer-gap--pass">
        <p class="an-offer-gap__text">Deal has <strong>${formatMoney(cushion)}</strong> cushion above target profit.</p>
      </div>
    `;
  }

  const reduction = Math.max(0, gap);

  if (deal.status === 'FAIL') {
    return `
      <div class="an-offer-gap an-offer-gap--fail">
        <p class="an-offer-gap__title">Offer Gap</p>
        <div class="an-offer-gap__row">
          <span class="an-offer-gap__row-label">Current Offer</span>
          <span class="an-offer-gap__row-value">${formatMoney(offerPrice)}</span>
        </div>
        <div class="an-offer-gap__row">
          <span class="an-offer-gap__row-label">Max Allowable Offer</span>
          <span class="an-offer-gap__row-value">${formatMoney(deal.mao)}</span>
        </div>
        <p class="an-offer-gap__text">Reduce offer by <strong>${formatMoney(reduction)}</strong> to meet the target profit.</p>
      </div>
    `;
  }

  // WATCH — close, but the offer still needs to come down (or profit go up)
  // by the same amount to fully clear the target-profit bar.
  return `
    <div class="an-offer-gap an-offer-gap--watch">
      <p class="an-offer-gap__text">Close to target — reduce the offer by <strong>${formatMoney(reduction)}</strong> (or improve ARV/costs by the same amount) to fully meet your target profit.</p>
    </div>
  `;
}

/**
 * Coerce a value to a finite number; blank/null/NaN → 0. Mirrors
 * dealAnalyzer.js's own _n() helper for consistent input normalisation.
 * @param {any} v
 * @returns {number}
 */
function _num(v) {
  const n = Number(v);
  return isFinite(n) ? n : 0;
}

/**
 * Minimum inputs required before showing a PASS/WATCH/FAIL verdict.
 * ARV, offer price, and target profit must all be present and positive.
 */
function _isReady(inputs) {
  const n = (v) => (v === '' || v === null || v === undefined ? 0 : Number(v));
  return n(inputs.arv) > 0 && n(inputs.offerPrice) > 0 && n(inputs.targetProfit) > 0;
}

function _statusLabel(status) {
  if (status === 'PASS')  return 'Deal looks good — offer is at or below MAO and meets profit target.';
  if (status === 'WATCH') return 'Proceed carefully — profit is below target but above 60% threshold.';
  return 'Deal does not meet profit criteria at the current offer price.';
}

// ============================================================================
// Input field builder
// ============================================================================

function _field(name, label, value, prefix, placeholder) {
  const v = (value !== undefined && value !== null && value !== '') ? value : '';
  return `
    <div class="an-field">
      <label class="an-field__label" for="an-${_esc(name)}">${_esc(label)}</label>
      <div class="an-field__input-wrap">
        ${prefix ? `<span class="an-field__prefix">${_esc(prefix)}</span>` : ''}
        <input
          id="an-${_esc(name)}"
          class="input an-field__input${prefix ? ' an-field__input--prefixed' : ''}"
          type="number"
          inputmode="decimal"
          step="any"
          min="0"
          name="${_esc(name)}"
          data-action="an-input"
          data-field="${_esc(name)}"
          value="${_esc(v)}"
          placeholder="${_esc(placeholder)}"
          autocomplete="off"
        />
      </div>
    </div>
  `;
}

// ============================================================================
// Event handlers (delegated on rootEl)
// ============================================================================

function _handleInput(e) {
  const input = e.target.closest('[data-action="an-input"]');
  if (!input) return;

  const field = input.dataset.field;
  if (!field) return;

  const raw = input.value;
  const num = raw === '' ? undefined : Number(raw);

  // Update state (triggers onChange → _updateResults, not a full re-render)
  setAnalyzer({ [field]: num });
}

function _handleFocusIn(e) {
  if (e.target.closest('[data-action="an-input"]')) {
    _suppressRerender = true;
  }
}

function _handleFocusOut(e) {
  if (e.target.closest('[data-action="an-input"]')) {
    _suppressRerender = false;
    // Trigger an out-of-band results update now that focus has left
    const proj = getActiveProject();
    const gp   = getGlobalPrices();
    // Find rootEl by walking up from the blur target
    const rootEl = e.target.closest('.an-page') && e.target.closest('.an-page').parentElement;
    if (rootEl) _updateResults(rootEl, proj, gp);
  }
}

// ============================================================================
// Utility
// ============================================================================

/**
 * Escape HTML special characters.
 * @param {any} s
 * @returns {string}
 */
function _esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
