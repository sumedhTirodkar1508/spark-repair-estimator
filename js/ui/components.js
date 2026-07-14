/**
 * js/ui/components.js
 * Shared UI primitives: modal, bottom-sheet, confirm, toast, progress bar, chips.
 *
 * All overlays mount into #modal-root / #sheet-root / #toast-root so view
 * re-renders never clobber open dialogs.
 *
 * Signatures:
 *   showModal({title, placeholder, value, confirmText}) -> Promise<string|null>
 *   showSheet({title, html, actions}) -> Promise<any>
 *   confirm({title, message, confirmText, danger}) -> Promise<boolean>
 *   toast(message, {type}) -> void
 *   progressBar(pct) -> htmlString
 *   renderChips(values, {selected}) -> htmlString
 *
 * Internal helpers also re-export adaptors so callers can pass the old-style
 * opts object (from stubs) without breakage.
 */

import { quantityChips } from '../catalog.js';

/* -------------------------------------------------------------------------
 * Internal: close-on-Escape key listener management
 * ------------------------------------------------------------------------- */
const _escStack = [];  // stack of { handler, el } — top is currently active overlay

function _pushEsc(handler) {
  _escStack.push(handler);
  if (_escStack.length === 1) {
    document.addEventListener('keydown', _escListener);
  }
}

function _popEsc(handler) {
  const idx = _escStack.lastIndexOf(handler);
  if (idx !== -1) _escStack.splice(idx, 1);
  if (_escStack.length === 0) {
    document.removeEventListener('keydown', _escListener);
  }
}

function _escListener(e) {
  if (e.key === 'Escape' && _escStack.length) {
    _escStack[_escStack.length - 1]();
  }
}

/* =========================================================================
 * showModal
 * A centered text-input modal. Resolves the trimmed string or null on cancel.
 * params: { title, placeholder, value, confirmText }
 * ========================================================================= */
export function showModal({ title = '', placeholder = '', value = '', confirmText = 'OK' } = {}) {
  return new Promise((resolve) => {
    const root = document.getElementById('modal-root');
    if (!root) { resolve(null); return; }

    function close(result) {
      _popEsc(escHandler);
      root.innerHTML = '';
      resolve(result);
    }

    function escHandler() { close(null); }
    _pushEsc(escHandler);

    const id = 'modal-input-' + Date.now();

    root.innerHTML = `
      <div class="modal-backdrop" data-modal-backdrop></div>
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title-${id}">
        <div class="modal__header">
          <h2 class="modal__title" id="modal-title-${id}">${_esc(title)}</h2>
        </div>
        <div class="modal__body">
          <input
            id="${id}"
            class="input"
            type="text"
            placeholder="${_esc(placeholder)}"
            value="${_esc(value)}"
            autocomplete="off"
            autocorrect="off"
            spellcheck="false"
          />
        </div>
        <div class="modal__footer">
          <button class="btn btn--ghost" data-modal-cancel>Cancel</button>
          <button class="btn btn--primary" data-modal-confirm>${_esc(confirmText)}</button>
        </div>
      </div>
    `;

    const input = root.querySelector('#' + id);
    const confirmBtn = root.querySelector('[data-modal-confirm]');
    const cancelBtn  = root.querySelector('[data-modal-cancel]');
    const backdrop   = root.querySelector('[data-modal-backdrop]');

    // Autofocus + select existing text
    requestAnimationFrame(() => {
      input.focus();
      input.select();
    });

    function doConfirm() {
      const val = input.value.trim();
      close(val || null);
    }

    confirmBtn.addEventListener('click', doConfirm);
    cancelBtn.addEventListener('click', () => close(null));
    backdrop.addEventListener('click', () => close(null));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); doConfirm(); }
    });
  });
}

/* =========================================================================
 * showSheet
 * A bottom-sheet for richer content. actions = [{label, value, primary?, danger?}]
 * Resolves with the chosen action's value, or null on dismiss.
 * params: { title, html, actions }
 * ========================================================================= */
export function showSheet({ title = '', html = '', actions = [] } = {}) {
  return new Promise((resolve) => {
    const root = document.getElementById('sheet-root');
    if (!root) { resolve(null); return; }

    function close(result) {
      _popEsc(escHandler);
      // Animate out before removing
      const sheet = root.querySelector('.sheet');
      if (sheet) {
        sheet.style.transition = 'transform 220ms cubic-bezier(0.32, 0.72, 0, 1)';
        sheet.style.transform = 'translateY(100%)';
        setTimeout(() => { root.innerHTML = ''; }, 220);
      } else {
        root.innerHTML = '';
      }
      resolve(result);
    }

    function escHandler() { close(null); }
    _pushEsc(escHandler);

    const actionsHtml = actions.map((a, i) => `
      <button
        class="btn ${a.danger ? 'btn--danger' : a.primary ? 'btn--primary' : 'btn--secondary'} btn--full"
        data-sheet-action="${i}"
      >${_esc(a.label)}</button>
    `).join('');

    root.innerHTML = `
      <div class="sheet-backdrop" data-sheet-backdrop></div>
      <div class="sheet" role="dialog" aria-modal="true">
        <div class="sheet__handle"></div>
        ${title ? `<div class="sheet__header"><h2 class="sheet__title">${_esc(title)}</h2></div>` : ''}
        <div class="sheet__body">
          ${html}
          ${actionsHtml ? `<div class="sheet-actions">${actionsHtml}</div>` : ''}
        </div>
      </div>
    `;

    root.querySelector('[data-sheet-backdrop]').addEventListener('click', () => close(null));

    root.querySelectorAll('[data-sheet-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        const i = parseInt(btn.dataset.sheetAction, 10);
        close(actions[i] ? actions[i].value : null);
      });
    });
  });
}

/* =========================================================================
 * confirm
 * Simple confirm dialog. Resolves true (confirmed) or false (cancelled).
 * params: { title, message, confirmText, danger }
 * ========================================================================= */
export function confirm({ title = 'Confirm', message = '', confirmText = 'Confirm', danger = false } = {}) {
  return new Promise((resolve) => {
    const root = document.getElementById('modal-root');
    if (!root) { resolve(false); return; }

    function close(result) {
      _popEsc(escHandler);
      root.innerHTML = '';
      resolve(result);
    }

    function escHandler() { close(false); }
    _pushEsc(escHandler);

    const id = 'confirm-' + Date.now();

    root.innerHTML = `
      <div class="modal-backdrop" data-confirm-backdrop></div>
      <div class="modal" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title-${id}">
        <div class="modal__header">
          <h2 class="modal__title" id="confirm-title-${id}">${_esc(title)}</h2>
        </div>
        <div class="modal__body">
          <p class="text-sm text-2">${_esc(message)}</p>
        </div>
        <div class="modal__footer">
          <button class="btn btn--ghost" data-confirm-cancel>Cancel</button>
          <button class="btn ${danger ? 'btn--danger' : 'btn--primary'}" data-confirm-ok>
            ${_esc(confirmText)}
          </button>
        </div>
      </div>
    `;

    root.querySelector('[data-confirm-backdrop]').addEventListener('click', () => close(false));
    root.querySelector('[data-confirm-cancel]').addEventListener('click', () => close(false));
    root.querySelector('[data-confirm-ok]').addEventListener('click', () => close(true));

    // Focus the confirm button
    requestAnimationFrame(() => {
      const ok = root.querySelector('[data-confirm-ok]');
      if (ok) ok.focus();
    });
  });
}

/* =========================================================================
 * toast
 * Transient notification (auto-dismiss ~2.5s).
 * type: 'info' | 'success' | 'warning' | 'error'
 * ========================================================================= */
export function toast(message, { type = 'info', duration = 2500 } = {}) {
  const root = document.getElementById('toast-root');
  if (!root) return;

  const el = document.createElement('div');
  el.className = `toast toast--${type}`;
  el.textContent = message;
  root.appendChild(el);

  // Auto-dismiss
  const timer = setTimeout(() => {
    el.style.transition = 'opacity 200ms ease';
    el.style.opacity = '0';
    setTimeout(() => { if (el.parentNode) el.remove(); }, 200);
  }, duration);

  // Click to dismiss early
  el.style.pointerEvents = 'auto';
  el.style.cursor = 'pointer';
  el.addEventListener('click', () => {
    clearTimeout(timer);
    if (el.parentNode) el.remove();
  });
}

/* =========================================================================
 * progressBar
 * Returns an HTML string for a thin progress bar at pct (0–100).
 * Caller injects into DOM.
 * ========================================================================= */
export function progressBar(pct) {
  const clamped = Math.max(0, Math.min(100, pct || 0));
  const complete = clamped >= 100;
  return `
    <div class="progress-bar" role="progressbar" aria-valuenow="${clamped}" aria-valuemin="0" aria-valuemax="100">
      <div class="progress-bar__fill${complete ? ' progress-bar__fill--complete' : ''}"
           style="width:${clamped}%"></div>
    </div>
  `;
}

/* =========================================================================
 * renderChips
 * Returns tappable quantity-chip markup. Each chip carries data-chip="<n>".
 * Caller wires the click → setQty via delegated handler on data-action="chip".
 *
 * Contract says: renderChips(values, {selected}) -> htmlString
 * values can be a unit string (auto-lookup) OR an array of numbers.
 * ========================================================================= */
export function renderChips(values, { selected } = {}) {
  let nums;
  if (Array.isArray(values)) {
    nums = values;
  } else {
    // values is a unit string
    nums = quantityChips(typeof values === 'string' ? values : '');
  }

  if (!nums || nums.length === 0) return '';

  const chips = nums.map(n => {
    const isSelected = selected !== undefined && String(selected) === String(n);
    return `<button
      class="chip${isSelected ? ' chip--selected' : ''}"
      data-chip="${n}"
      data-action="chip"
      type="button"
      aria-label="Set quantity to ${n}"
    >${n}</button>`;
  }).join('');

  return `<div class="chip-strip" role="group" aria-label="Quick quantities">${chips}</div>`;
}

/* =========================================================================
 * Internal: HTML escape helper
 * ========================================================================= */
function _esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
