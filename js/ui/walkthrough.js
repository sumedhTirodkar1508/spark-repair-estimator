/**
 * js/ui/walkthrough.js
 * Section tabs, room sub-tabs (multi), group cards (tri-state),
 * line items, qty chips, running total header, progress bar.
 *
 * Named export: render(rootEl, params)
 * No default export. Vanilla ESM.
 *
 * In-place qty strategy:
 *   _handleQtyInput updates lt / group-total / grand-total elements directly,
 *   then calls setQty() (schedules debounced save + emits onChange).
 *   onChange checks _suppressRerender + active element before doing a full
 *   re-render, preventing focus loss on every keystroke.
 */

import {
  SECTIONS,
  GROUPS,
  ROOM_TEMPLATES,
  SERIAL_ITEM_IDS,
  CRITICAL_GROUP_KEYS,
  getGroupsForInstance,
  getItemsForGroup,
  quantityChips,
} from '../catalog.js';

import {
  getActiveProject,
  getGlobalPrices,
  getEffectiveStatus,
  onChange,
  switchProject,
  addRoomInstance,
  removeRoomInstance,
  renameRoomInstance,
  duplicateRoomInstance,
  toggleItem,
  setQty,
  setNote,
  setGroupStatus,
  setItemPriceOverride,
  clearItemPriceOverride,
  addCustomItem,
  deleteItem,
  bulkMarkNonCriticalNone,
  resetBulkMarkedGroups,
  renameProject,
  setSerialMeta,
  resetProject,
} from '../state.js';

import {
  computeGrandTotal,
  computeGroupTotal,
  computeLineTotal,
  getResolvedCost,
  formatMoney,
  formatUnitCost,
} from '../pricing.js';

import {
  showModal,
  showSheet,
  confirm,
  toast,
  progressBar,
  renderChips,
} from './components.js';

import {
  capturePhoto,
  getPhotos,
  getThumbURL,
  deletePhoto as photosDeletePhoto,
  countSerialPhotos,
  onPhotosChanged,
} from '../photos.js';

/* ============================================================
   Module-level UI state (in-memory only, not persisted)
   ============================================================ */

/** Currently active section id (SECTIONS[n].id) */
let _activeSectionId = SECTIONS[0].id;

/** Which room sub-tab is active per section id: Map<sectionId, instanceId|null> */
const _activeSubTab = new Map();

/** Set of "instanceId::groupKey" composite keys that are expanded */
const _expandedGroups = new Set();

/** Flag to suppress onChange re-render during in-place qty updates */
let _suppressRerender = false;

/** instanceId::itemId to focus after next re-render (set when toggling item on) */
let _pendingFocusSelKey = null;

/** Current search query text (module-level so it survives in-place result updates) */
let _searchQuery = '';

/** { instanceId, groupKey, itemId? } to scroll into view + highlight after the
 *  next render — set when a search result is tapped */
let _pendingScrollTarget = null;

/** Project id that was last fully rendered — used to reset UI state on switch */
let _renderedProjectId = null;

/** project.updatedAt of the last render — detects in-place replacements (same id, new data) */
let _renderedProjectUpdatedAt = null;

/** True when the Web Speech API is available (progressive enhancement only) */
const _speechSupported = !!(window.SpeechRecognition || window.webkitSpeechRecognition);

/** onChange unsubscribe fn — stored so we don't double-subscribe */
let _unsubscribe = null;

/** onPhotosChanged unsubscribe fn — refreshes inline photo slots when a photo
 *  is deleted elsewhere (e.g. the Photo Gallery screen), without a page reload. */
let _unsubscribePhotos = null;

/* ============================================================
   Photo cache
   Maps refKey → photoRecord[] for the active project.
   Populated async when the project loads/switches; used synchronously
   during render so thumbnails show without waiting for IDB.
   Object URLs tracked here so we can revoke them before re-render.
   ============================================================ */

/** @type {Map<string, object[]>}  refKey → photo records */
const _photoCache = new Map();

/** @type {string[]}  Object URLs created during last render — revoked on next render */
let _photoURLs = [];

/**
 * True when a photo add/replace/delete happened while some other route was
 * visible (or while an input had focus), so _photoCache may no longer match
 * IndexedDB. Cleared only after a fresh load for the correct project
 * succeeds. render() checks this and reloads before presenting the page, so
 * returning to the Walkthrough never flashes stale thumbnails.
 */
let _photoCacheDirty = false;

/**
 * Monotonic counter identifying the most recently STARTED full-cache load.
 * Each async load captures its own value and, on resolution, only applies
 * its results if it's still the latest — otherwise a slower-resolving older
 * request could overwrite the results of a newer one.
 */
let _photoCacheGen = 0;

/* ============================================================
   Entry point
   ============================================================ */

export async function render(rootEl, params) {
  const targetId = params && params.id;

  // Ensure the right project is active
  const current = getActiveProject();
  if (!current || (targetId && current.id !== targetId)) {
    try {
      await switchProject(targetId);
    } catch (_err) {
      rootEl.innerHTML = `
        <div class="empty-state">
          <div class="empty-state__icon">⚠️</div>
          <p class="empty-state__title">Project not found</p>
          <p class="empty-state__desc">The project could not be loaded.</p>
          <a href="#/" class="btn btn--secondary" style="margin-top:var(--sp-4)">← Dashboard</a>
        </div>`;
      return;
    }
  }

  const project = getActiveProject();
  if (!project) {
    rootEl.innerHTML = `<div class="empty-state"><p class="empty-state__title">No active project</p></div>`;
    return;
  }

  // Reset section/expansion state when switching projects
  let needsPhotoReload = false;
  if (_renderedProjectId !== project.id) {
    _activeSectionId = SECTIONS[0].id;
    _activeSubTab.clear();
    _expandedGroups.clear();
    _searchQuery = '';
    _renderedProjectId = project.id;
    _renderedProjectUpdatedAt = project.updatedAt || null;
    _photoCache.clear();
    needsPhotoReload = true;
  } else if (project.updatedAt && project.updatedAt !== _renderedProjectUpdatedAt) {
    // Same project ID but updatedAt changed — happens after a backup Replace.
    // Revoke stale Object URLs and reload photos from IndexedDB.
    _renderedProjectUpdatedAt = project.updatedAt;
    for (const url of _photoURLs) { try { URL.revokeObjectURL(url); } catch (_) {} }
    _photoURLs = [];
    _photoCache.clear();
    needsPhotoReload = true;
  } else if (_photoCacheDirty) {
    // A photo changed elsewhere (e.g. Gallery) while this route wasn't
    // visible — reload before presenting the page so we never flash stale
    // thumbnails that then have to be corrected by a second render.
    needsPhotoReload = true;
  }

  // Subscribe to state changes (idempotent)
  if (!_unsubscribe) {
    _unsubscribe = onChange(_onStateChange);
  }
  if (!_unsubscribePhotos) {
    _unsubscribePhotos = onPhotosChanged(_onPhotosChanged);
  }

  if (needsPhotoReload) {
    await _fetchPhotosForProject(project.id);
  }

  _renderWalkthrough(rootEl, project);
}

/* ============================================================
   onChange subscription handler
   ============================================================ */

/**
 * True only for the exact base walkthrough route "#/project/<id>" — false for
 * summary, analyzer, gallery, or any other sub-route. Used to guard every
 * async/subscription path that can trigger a full walkthrough re-render, so
 * a delayed callback can never repaint the walkthrough over another screen
 * whose URL still starts with "#/project/".
 * @returns {boolean}
 */
function _isBaseWalkthroughRoute() {
  return /^#\/project\/[^/]+$/.test(window.location.hash);
}

function _onStateChange() {
  // Skip if qty/note/serial input is active (in-place or suppressed update already ran)
  if (_suppressRerender) return;
  const active = document.activeElement;
  if (active) {
    const act = active.dataset && active.dataset.action;
    if (act === 'wt-qty-input' || act === 'wt-note-input' || act === 'wt-serial-field' || act === 'wt-search-input') return;
  }

  // Only re-render if walkthrough is the visible route
  if (_isBaseWalkthroughRoute()) {
    const project = getActiveProject();
    const rootEl  = document.getElementById('app');
    if (rootEl && project) {
      _cleanListeners(rootEl);
      _renderWalkthrough(rootEl, project);
    }
  }
}

/**
 * Fires on every photo add/replace/delete from anywhere in the app
 * (Walkthrough's own capture/delete actions, or the Photo Gallery screen).
 *
 * - Events for a different project are ignored outright.
 * - If the base Walkthrough route isn't visible right now (Summary,
 *   Analyzer, Gallery, Dashboard, Price Book, …), the DOM is never touched —
 *   we only mark the cache dirty so the next render() reloads it first.
 * - If an input is mid-edit, do the same: defer to the next render instead
 *   of stealing focus.
 * - Otherwise, apply the change directly (upsert for add/replace, removal
 *   for delete — both idempotent) and do one guaranteed repaint. Unknown/
 *   batch events fall back to a full reload from IndexedDB.
 *
 * @param {{type?:string, projectId?:string, photoId?:string, refKey?:string, photo?:object|null}} [event]
 */
function _onPhotosChanged(event) {
  const eventProjectId = event && event.projectId;
  const active = getActiveProject();
  if (eventProjectId && active && eventProjectId !== active.id) return;

  if (!_isBaseWalkthroughRoute()) {
    _photoCacheDirty = true;
    return;
  }

  if (_suppressRerender) {
    _photoCacheDirty = true;
    return;
  }
  const activeEl = document.activeElement;
  if (activeEl) {
    const act = activeEl.dataset && activeEl.dataset.action;
    if (act === 'wt-qty-input' || act === 'wt-note-input' || act === 'wt-serial-field' || act === 'wt-search-input') {
      _photoCacheDirty = true;
      return;
    }
  }

  if (!active) return;

  if (event && event.type === 'delete' && event.photoId) {
    _removePhotoFromCache(event.photoId, event.refKey);
    _fullRerender();
    return;
  }

  if (event && (event.type === 'add' || event.type === 'replace') && event.photo) {
    _upsertPhotoInCache(event.photo);
    _fullRerender();
    return;
  }

  // Unknown shape, or a batch event with no per-photo payload — reload
  // everything for this project from IndexedDB.
  _loadPhotoCache(active.id);
}

/* ============================================================
   Photo cache helpers
   ============================================================ */

/**
 * Populate _photoCache from IndexedDB for the given project. Guards against
 * two kinds of staleness: a newer load having since started (generation
 * token), and the active project having changed while this read was in
 * flight (project-id check). Does NOT render — callers decide when to.
 * Clears _photoCacheDirty on success.
 * @param {string} projectId
 * @returns {Promise<boolean>} true if the cache was actually updated
 */
async function _fetchPhotosForProject(projectId) {
  const gen = ++_photoCacheGen;
  let photos;
  try {
    photos = await getPhotos(projectId);
  } catch (err) {
    console.error('[walkthrough] _fetchPhotosForProject error', err);
    return false;
  }

  // A newer load has since started — its result should win, not this one.
  if (gen !== _photoCacheGen) return false;

  const current = getActiveProject();
  if (!current || current.id !== projectId) return false;

  _photoCache.clear();
  for (const ph of photos) {
    if (!_photoCache.has(ph.refKey)) _photoCache.set(ph.refKey, []);
    _photoCache.get(ph.refKey).push(ph);
  }
  _photoCacheDirty = false;
  return true;
}

/**
 * Reload the full photo cache for a project and re-render once done —
 * used by async paths (subscription-triggered reloads, cold-entry jumps)
 * that need to repaint themselves once fresh data lands.
 * @param {string} projectId
 */
async function _loadPhotoCache(projectId) {
  const ok = await _fetchPhotosForProject(projectId);
  if (ok && _isBaseWalkthroughRoute()) {
    _fullRerender();
  }
}

/**
 * Insert or update a single photo record in _photoCache, keyed by the
 * record's OWN refKey (never a caller-supplied string) and de-duplicated by
 * id. Safe to call more than once for the same photo — idempotent — so it
 * can be called both directly at a capture/replace call site and again from
 * the onPhotosChanged subscription without producing duplicate thumbnails.
 * @param {object} photo
 */
function _upsertPhotoInCache(photo) {
  if (!photo || !photo.id || photo.refKey === undefined) return;
  const list = _photoCache.get(photo.refKey) || [];
  const idx  = list.findIndex(p => p.id === photo.id);
  if (idx === -1) {
    list.push(photo);
  } else {
    list[idx] = photo;
  }
  _photoCache.set(photo.refKey, list);
}

/**
 * Remove a single photo record from _photoCache by id. If refKeyHint is
 * known, only that bucket is scanned; otherwise every bucket is checked.
 * @param {string} photoId
 * @param {string} [refKeyHint]
 */
function _removePhotoFromCache(photoId, refKeyHint) {
  if (refKeyHint !== undefined && _photoCache.has(refKeyHint)) {
    _photoCache.set(refKeyHint, _photoCache.get(refKeyHint).filter(p => p.id !== photoId));
    return;
  }
  for (const [key, list] of _photoCache) {
    if (list.some(p => p.id === photoId)) {
      _photoCache.set(key, list.filter(p => p.id !== photoId));
      return;
    }
  }
}

/**
 * Revoke all tracked object URLs from the previous render cycle.
 * Called at the start of each full render.
 */
function _revokePhotoURLs() {
  for (const url of _photoURLs) {
    try { URL.revokeObjectURL(url); } catch (_) { /* ignore */ }
  }
  _photoURLs = [];
}

/* ============================================================
   Full render
   ============================================================ */

function _renderWalkthrough(rootEl, project) {
  // Revoke object URLs from previous render to avoid memory leaks
  _revokePhotoURLs();

  const globalPrices = getGlobalPrices();
  const grandTotal   = computeGrandTotal(project, globalPrices);
  const prog = _calcProgress(project);
  const pct = prog.groupsTotal > 0 ? Math.round((prog.groupsDone / prog.groupsTotal) * 100) : 0;

  const section = SECTIONS.find(s => s.id === _activeSectionId) || SECTIONS[0];
  _activeSectionId = section.id; // normalise

  // Room instances for this section
  const instances = project.rooms.filter(r => {
    const tmpl = ROOM_TEMPLATES[r.roomType];
    return tmpl && tmpl.section === section.id;
  });

  // Active sub-tab for multi sections
  if (section.multi) {
    if (!_activeSubTab.has(section.id) ||
        !instances.find(i => i.instanceId === _activeSubTab.get(section.id))) {
      _activeSubTab.set(section.id, instances.length > 0 ? instances[0].instanceId : null);
    }
  }
  const activeInstanceId = section.multi
    ? _activeSubTab.get(section.id)
    : (instances[0] ? instances[0].instanceId : null);

  const activeRoom = instances.find(r => r.instanceId === activeInstanceId) || instances[0] || null;

  rootEl.innerHTML = `
    <div class="wt-sticky-stack">
      ${_headerHtml(project, grandTotal, prog, pct)}
      ${_sectionTabsHtml()}
    </div>
    ${section.multi ? _roomSubTabsHtml(section, instances, activeInstanceId) : ''}
    ${_searchBarHtml()}
    <div id="wt-groups-container">
      ${activeRoom ? _groupCardsHtml(activeRoom, project, globalPrices) : _emptyRoomHtml(section)}
    </div>
    ${_endBarHtml(project)}
  `;

  // Attach delegated handlers
  rootEl.addEventListener('click',   _wtClickHandler);
  rootEl.addEventListener('input',   _wtInputHandler);
  rootEl.addEventListener('change',  _wtChangeHandler);
  rootEl.addEventListener('keydown', _wtKeydownHandler);
  rootEl.addEventListener('scroll',  _wtScrollHandler, { capture: true, passive: true });

  const tabsEl = rootEl.querySelector('.section-tabs');
  if (tabsEl) {
    requestAnimationFrame(() => _updateTabsFade(tabsEl));
  }

  // Focus pending qty input from toggle
  if (_pendingFocusSelKey) {
    const sel = _pendingFocusSelKey;
    _pendingFocusSelKey = null;
    requestAnimationFrame(() => {
      const inp = document.getElementById('qty-' + _safeId(sel));
      if (inp) { inp.focus(); inp.select(); }
    });
  }

  // Scroll to + briefly highlight a search result's target group/item
  if (_pendingScrollTarget) {
    const target = _pendingScrollTarget;
    _pendingScrollTarget = null;
    requestAnimationFrame(() => {
      const compositeKey = `${target.instanceId}::${target.groupKey}`;
      let scrollEl = document.querySelector(`[data-group-card="${compositeKey}"]`);
      let highlightEl = scrollEl;

      if (target.itemId) {
        const selKey  = `${target.instanceId}::${target.itemId}`;
        const itemEl  = document.getElementById('line-item-' + _safeId(selKey));
        if (itemEl) {
          scrollEl    = itemEl;
          highlightEl = itemEl;
        }
      }

      if (scrollEl) {
        const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        scrollEl.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
      }
      if (highlightEl) {
        highlightEl.classList.add('wt-search-target');
        setTimeout(() => highlightEl.classList.remove('wt-search-target'), 1600);
      }
    });
  }
}

function _cleanListeners(rootEl) {
  rootEl.removeEventListener('click',   _wtClickHandler);
  rootEl.removeEventListener('input',   _wtInputHandler);
  rootEl.removeEventListener('change',  _wtChangeHandler);
  rootEl.removeEventListener('keydown', _wtKeydownHandler);
  rootEl.removeEventListener('scroll',  _wtScrollHandler, { capture: true, passive: true });
}

/* ============================================================
   Header
   ============================================================ */

function _headerHtml(project, grandTotal, prog, pct) {
  const groupsLabel = `${prog.groupsDone}/${prog.groupsTotal} groups`;
  const itemsLabel  = `${prog.selectedItems} work item${prog.selectedItems !== 1 ? 's' : ''}`;
  return `
    <div class="wt-brand-row">
      <img src="./assets/logo.png" alt="" class="wt-brand-logo" aria-hidden="true" />
      <span class="wt-brand-title">Repair Estimator</span>
    </div>
    <div class="wt-nav-row">
      <button class="icon-btn" data-action="wt-back" aria-label="Dashboard" title="Dashboard">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M19 12H5M12 5l-7 7 7 7"/>
        </svg>
      </button>
      <button
        class="wt-project-name"
        data-action="wt-rename-project"
        title="Tap to rename project"
        aria-label="Project: ${_esc(project.name)} — tap to rename"
      >${_esc(project.name)}</button>
      <div class="wt-nav-actions">
        <button class="wt-nav-btn" data-action="wt-goto-pricebook" aria-label="Price Book / Rates" title="Price Book / Rates">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <rect x="3" y="3" width="18" height="18" rx="2"/>
            <line x1="3" y1="9" x2="21" y2="9"/>
            <line x1="9" y1="21" x2="9" y2="3"/>
          </svg>
          <span class="wt-nav-btn__label">Rates</span>
        </button>
        <button class="wt-nav-btn wt-nav-btn--danger" data-action="wt-reset-project" aria-label="Reset project" title="Reset project">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
            <path d="M3 3v5h5"/>
          </svg>
          <span class="wt-nav-btn__label">Reset</span>
        </button>
      </div>
    </div>
    <div class="wt-meta-row">
      <span class="wt-total-big tabular-nums" id="wt-grand-total" aria-live="polite">${formatMoney(grandTotal)}</span>
      <div class="wt-progress-cluster">
        <span class="wt-progress-main tabular-nums" id="wt-progress-main">${groupsLabel}</span>
        <span class="wt-progress-sub" id="wt-progress-sub"> · ${itemsLabel}</span>
      </div>
    </div>
    <div class="wt-progress-wrap" id="wt-progress-wrap">
      ${progressBar(pct)}
    </div>
  `;
}

/* ============================================================
   Section Tabs
   ============================================================ */

function _sectionTabsHtml() {
  return `
    <div class="section-tabs-wrapper">
      <nav class="section-tabs" role="tablist" aria-label="Sections">
        ${SECTIONS.map(s => `
          <button
            class="section-tab${s.id === _activeSectionId ? ' is-active' : ''}"
            role="tab"
            aria-selected="${s.id === _activeSectionId}"
            data-action="wt-section-tab"
            data-section="${s.id}"
          >${_esc(s.label)}</button>
        `).join('')}
      </nav>
    </div>
  `;
}

/* ============================================================
   Room Sub-tabs (multi-instance sections)
   ============================================================ */

function _roomSubTabsHtml(section, instances, activeInstanceId) {
  const roomType = section.roomType;
  const tmpl     = ROOM_TEMPLATES[roomType];
  const tmplLabel = tmpl ? tmpl.label : 'Room';

  const tabs = instances.map(r => {
    const isActive = r.instanceId === activeInstanceId;
    return `
      <div class="room-subtab${isActive ? ' is-active' : ''}">
        <button
          class="room-subtab__btn"
          data-action="wt-room-subtab"
          data-section-id="${section.id}"
          data-instance-id="${r.instanceId}"
          aria-label="${_esc(r.label)}"
          aria-selected="${isActive}"
        >${_esc(r.label)}</button>
        ${isActive ? `
          <button
            class="room-subtab__menu icon-btn"
            data-action="wt-room-menu"
            data-instance-id="${r.instanceId}"
            data-room-label="${_esc(r.label)}"
            data-room-type="${r.roomType}"
            data-removable="${r.removable ? '1' : '0'}"
            aria-label="Options for ${_esc(r.label)}"
          >⋯</button>
        ` : ''}
      </div>
    `;
  }).join('');

  return `
    <div class="room-subtabs" role="tablist" aria-label="${_esc(tmplLabel)} rooms">
      ${tabs}
      <button
        class="room-subtab__add"
        data-action="wt-add-room"
        data-room-type="${roomType}"
        data-section-id="${section.id}"
        aria-label="Add ${_esc(tmplLabel)}"
      >+ Add</button>
    </div>
  `;
}

/* ============================================================
   Search (groups + line items, project-aware, local filter only)
   ============================================================ */

/**
 * Search field row + results panel wrapper. Rendered once per full render;
 * the results panel itself is updated in place on every keystroke via
 * _updateSearchPanel() to avoid losing input focus (same strategy as qty
 * inputs elsewhere in this file).
 */
function _searchBarHtml() {
  const project = getActiveProject();
  return `
    <div class="wt-search-wrap">
      <div class="wt-search-input-wrap">
        <svg class="wt-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="11" cy="11" r="7"/>
          <line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <input
          type="search"
          class="input input--sm wt-search-input"
          placeholder="Search groups, items, room, or item ID…"
          value="${_esc(_searchQuery)}"
          autocomplete="off"
          autocorrect="off"
          spellcheck="false"
          enterkeyhint="search"
          data-action="wt-search-input"
          aria-label="Search groups and line items"
        />
        ${_searchQuery ? `
          <button type="button" class="wt-search-clear-btn" data-action="wt-search-clear" aria-label="Clear search">✕</button>
        ` : ''}
      </div>
      <div id="wt-search-panel-wrap">
        ${project ? _searchResultsHtml(project, _searchQuery) : ''}
      </div>
    </div>
  `;
}

/**
 * Re-render just the results panel in place (called on every keystroke).
 * Leaves the input element untouched so focus/cursor position is preserved.
 */
function _updateSearchPanel() {
  const rootEl = document.getElementById('app');
  const wrap   = rootEl && rootEl.querySelector('#wt-search-panel-wrap');
  const project = getActiveProject();
  if (wrap && project) {
    wrap.innerHTML = _searchResultsHtml(project, _searchQuery);
  }
  // Toggle the clear button without a full re-render
  const clearBtn = rootEl && rootEl.querySelector('.wt-search-clear-btn');
  const hasQuery = !!_searchQuery.trim();
  if (hasQuery && !clearBtn) {
    const inputWrap = rootEl.querySelector('.wt-search-input-wrap');
    if (inputWrap) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'wt-search-clear-btn';
      btn.dataset.action = 'wt-search-clear';
      btn.setAttribute('aria-label', 'Clear search');
      btn.textContent = '✕';
      inputWrap.appendChild(btn);
    }
  } else if (!hasQuery && clearBtn) {
    clearBtn.remove();
  }
}

/**
 * Build the results panel HTML for the current query. Returns '' for an
 * empty query (compact — no panel shown at all until the user types).
 * @param {object} project
 * @param {string} query
 * @returns {string}
 */
function _searchResultsHtml(project, query) {
  const q = (query || '').trim();
  if (!q) return '';

  const { groups, items } = _runSearch(project, q);

  if (groups.length === 0 && items.length === 0) {
    return `
      <div class="wt-search-panel" id="wt-search-panel">
        <p class="wt-search-empty">No matching groups or items.</p>
      </div>
    `;
  }

  return `
    <div class="wt-search-panel" id="wt-search-panel" role="listbox" aria-label="Search results">
      ${groups.length ? `
        <div class="wt-search-section">
          <div class="wt-search-section__title">Groups</div>
          ${groups.map(g => _searchResultRowHtml(g)).join('')}
        </div>
      ` : ''}
      ${items.length ? `
        <div class="wt-search-section">
          <div class="wt-search-section__title">Line Items</div>
          ${items.map(it => _searchResultRowHtml(it)).join('')}
        </div>
      ` : ''}
    </div>
  `;
}

function _searchResultRowHtml(entry) {
  return `
    <button
      type="button"
      class="wt-search-result"
      role="option"
      data-action="wt-search-select"
      data-instance-id="${_esc(entry.instanceId)}"
      data-group-key="${_esc(entry.groupKey)}"
      ${entry.itemId ? `data-item-id="${_esc(entry.itemId)}"` : ''}
    >
      <span class="wt-search-result__label">${_esc(entry.contextLabel)}</span>
      ${entry.itemId ? `<span class="wt-search-result__id">${_esc(entry.itemId)}</span>` : ''}
    </button>
  `;
}

/**
 * Filter the current project's rooms/groups/items against a query.
 * Multi-word queries (e.g. "Bathroom 1 vanity") require every token to be
 * found somewhere in the entry's combined room+group(+item) text — order
 * independent, case-insensitive, substring match.
 *
 * Reuses getGroupsForInstance / getItemsForGroup so results automatically
 * respect current room instances, deleted items, and custom items — no
 * separate index/state to keep in sync.
 *
 * @param {object} project
 * @param {string} query
 * @returns {{groups:object[], items:object[]}}
 */
function _runSearch(project, query) {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  const MAX_GROUPS = 8;
  const MAX_ITEMS  = 12;

  const groupResults = [];
  const itemResults  = [];

  for (const room of (project.rooms || [])) {
    const tmpl = ROOM_TEMPLATES[room.roomType];
    if (!tmpl) continue;
    const roomLabel = room.label || room.instanceId;
    const groups = getGroupsForInstance(room.instanceId, room.roomType);

    for (const grp of groups) {
      const groupHay = `${roomLabel} ${grp.label}`.toLowerCase();
      if (groupResults.length < MAX_GROUPS && tokens.every(t => groupHay.includes(t))) {
        groupResults.push({
          instanceId: room.instanceId,
          groupKey: grp.key,
          itemId: null,
          contextLabel: `${roomLabel}: ${grp.label}`,
        });
      }

      if (itemResults.length >= MAX_ITEMS) continue;

      const items = getItemsForGroup(grp.key, project);
      for (const item of items) {
        if (itemResults.length >= MAX_ITEMS) break;
        const itemHay = `${roomLabel} ${grp.label} ${item.name} ${item.id}`.toLowerCase();
        if (tokens.every(t => itemHay.includes(t))) {
          itemResults.push({
            instanceId: room.instanceId,
            groupKey: grp.key,
            itemId: item.id,
            contextLabel: `${roomLabel}: ${grp.label} > ${item.name}`,
          });
        }
      }
    }
  }

  return { groups: groupResults, items: itemResults };
}

/* ============================================================
   Group Cards Container
   ============================================================ */

function _groupCardsHtml(room, project, globalPrices) {
  const groups = getGroupsForInstance(room.instanceId, room.roomType);
  if (!groups.length) {
    return `<div class="page-content"><p class="text-sm text-muted">No groups for this room type.</p></div>`;
  }
  return `<div class="page-content wt-group-list">
    ${groups.map(g => _groupCardHtml(g, room, project, globalPrices)).join('')}
  </div>`;
}

function _emptyRoomHtml(section) {
  return `
    <div class="page-content">
      <div class="empty-state" style="min-height:28dvh">
        <div class="empty-state__icon">🏠</div>
        <p class="empty-state__title">No ${_esc(section.label)} yet</p>
        <p class="empty-state__desc">Tap "+ Add" above to add a room.</p>
      </div>
    </div>
  `;
}

/* ============================================================
   Single Group Card
   ============================================================ */

function _groupCardHtml(group, room, project, globalPrices) {
  const { instanceId } = room;
  const { key: groupKey, label, critical, conditionalItemIds } = group;
  const compositeKey = `${instanceId}::${groupKey}`;
  const expanded     = _expandedGroups.has(compositeKey);

  // Explicit room+group context, e.g. "Bathroom 1: Vanity & Countertop",
  // "Bedroom 1: Flooring", "Living 1: Lighting" — same pattern for singleton
  // sections too ("Systems & Structure: HVAC") for consistency across the app.
  const roomLabel      = room.label || instanceId;
  const combinedLabel  = `${roomLabel}: ${label}`;

  const status     = getEffectiveStatus(instanceId, groupKey, project);
  const isCritical = _isCriticalNow(groupKey, instanceId, project, critical, conditionalItemIds);
  const selCount   = _countSelections(instanceId, groupKey, project);
  const groupTotal = computeGroupTotal(instanceId, groupKey, project, globalPrices);
  const isNone     = status === 'none';
  const hasWork    = selCount > 0; // active work selections → No Work not a normal toggle

  // Critical unreviewed → red left border
  const cardClass = `card wt-group-card${isCritical && status === 'unreviewed' ? ' card--critical' : ''}`;

  return `
    <div class="${cardClass}" data-group-card="${compositeKey}">
      <div class="card__header wt-group-header"
           data-action="wt-toggle-group"
           data-composite="${compositeKey}"
           style="cursor:pointer"
           aria-expanded="${expanded ? 'true' : 'false'}"
           aria-label="${_esc(combinedLabel)} — tap to ${expanded ? 'collapse' : 'expand'}">
        <div class="wt-group-meta">
          <div class="wt-group-label-row">
            <span class="wt-group-label">${_esc(combinedLabel)}</span>
            ${isCritical ? '<span class="badge badge--danger" style="font-size:9px">Critical</span>' : ''}
          </div>
          <div class="wt-group-status-row">
            ${_statusPill(status, groupTotal, selCount)}
            ${groupTotal > 0 && status === 'work' ? `<span class="wt-group-total tabular-nums" id="gt-${_safeId(compositeKey)}" style="font-size:var(--text-xs);color:var(--color-text-muted)">${formatMoney(groupTotal)}</span>` : `<span id="gt-${_safeId(compositeKey)}" style="display:none"></span>`}
          </div>
        </div>
        <div class="wt-group-actions">
          <button
            type="button"
            class="btn btn--sm wt-no-work-btn${isNone ? ' is-active' : ''}${hasWork ? ' is-disabled' : ''}"
            data-action="wt-no-work"
            data-instance-id="${instanceId}"
            data-group-key="${groupKey}"
            data-is-none="${isNone ? '1' : '0'}"
            data-sel-count="${selCount}"
            aria-pressed="${isNone ? 'true' : 'false'}"${hasWork ? ' aria-disabled="true"' : ''}
            aria-label="${isNone ? 'Undo No Work Needed' : 'Mark No Work Needed'}"
            title="${isNone ? 'Undo No Work Needed' : hasWork ? 'Deselect items to mark No Work' : 'No Work Needed'}"
          >${isNone ? '✓ No Work' : 'No Work'}</button>
          <span class="wt-chevron${expanded ? ' wt-chevron--open' : ''}" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </span>
        </div>
      </div>

      ${expanded ? `
        <div class="card__body wt-group-body" id="group-body-${_safeId(compositeKey)}">
          ${_lineItemsHtml(group, room, project, globalPrices)}
          ${_addItemRowHtml(groupKey)}
        </div>
      ` : ''}
    </div>
  `;
}

/* ============================================================
   Line Items
   ============================================================ */

function _lineItemsHtml(group, room, project, globalPrices) {
  const items = getItemsForGroup(group.key, project);
  if (!items.length) return `<p class="text-sm text-muted" style="padding:var(--sp-2) 0">No items in this group.</p>`;
  return items.map(item => _lineItemHtml(item, group.key, room.instanceId, project, globalPrices)).join('');
}

function _lineItemHtml(item, groupKey, instanceId, project, globalPrices) {
  const selKey   = `${instanceId}::${item.id}`;
  const entry    = project.selections[selKey];
  const checked  = entry !== undefined;
  const qty      = checked ? (entry.qty  || '') : '';
  const note     = checked ? (entry.note || '') : '';
  const isCustom = item.id.startsWith('cust_');
  const isSerial = SERIAL_ITEM_IDS.has(item.id);
  const resolvedCost = getResolvedCost(item.id, project, globalPrices);
  const hasOverride  = project.priceOverrides &&
    Object.prototype.hasOwnProperty.call(project.priceOverrides, item.id);
  const lineTotal = checked ? computeLineTotal(item.id, qty, project, globalPrices) : 0;

  // Quantity chips HTML (from renderChips using unit)
  const chips = renderChips(item.unit, {});

  return `
    <div class="wt-line-item" id="line-item-${_safeId(selKey)}">
      <div class="checkbox-row">
        <input
          type="checkbox"
          class="checkbox"
          id="chk-${_safeId(selKey)}"
          ${checked ? 'checked' : ''}
          data-action="wt-toggle-item"
          data-instance-id="${instanceId}"
          data-item-id="${item.id}"
          data-group-key="${groupKey}"
          data-sel-key="${selKey}"
          aria-label="${_esc(item.name)}"
        />
        <label for="chk-${_safeId(selKey)}" class="wt-item-label">${_esc(item.name)}</label>
        <div class="wt-item-actions">
          <button
            class="icon-btn wt-override-btn${hasOverride ? ' wt-override-btn--active' : ''}"
            data-action="wt-price-override"
            data-instance-id="${instanceId}"
            data-item-id="${item.id}"
            data-item-name="${_esc(item.name)}"
            data-resolved-cost="${resolvedCost}"
            data-has-override="${hasOverride ? '1' : '0'}"
            aria-label="${hasOverride ? 'Edit price override' : 'Set price override'} for ${_esc(item.name)}"
            title="${hasOverride ? 'Override: ' + formatUnitCost(resolvedCost) + '/' + item.unit : 'Set price override'}"
          >✏️</button>
          ${isCustom ? `
            <button
              class="icon-btn wt-delete-item-btn"
              data-action="wt-delete-item"
              data-item-id="${item.id}"
              data-item-name="${_esc(item.name)}"
              aria-label="Delete ${_esc(item.name)}"
              title="Delete item"
            >✕</button>
          ` : ''}
        </div>
      </div>

      ${checked ? `
        <div class="wt-item-detail" id="item-detail-${_safeId(selKey)}">
          <div class="qty-row">
            <input
              type="text"
              inputmode="decimal"
              class="qty-input"
              id="qty-${_safeId(selKey)}"
              value="${_esc(qty)}"
              placeholder="Qty"
              data-action="wt-qty-input"
              data-instance-id="${instanceId}"
              data-item-id="${item.id}"
              data-group-key="${groupKey}"
              data-sel-key="${selKey}"
              aria-label="Quantity for ${_esc(item.name)}"
            />
            <span class="qty-unit">${_esc(item.unit)}</span>
            ${chips}
            <span
              class="line-total tabular-nums"
              id="lt-${_safeId(selKey)}"
              aria-live="polite"
            >${lineTotal > 0 ? formatMoney(lineTotal) : '—'}</span>
          </div>
          <div class="wt-cost-hint">
            <span class="tabular-nums">${formatUnitCost(resolvedCost)}/${_esc(item.unit)}</span>
            ${hasOverride ? '<span class="badge badge--work" style="font-size:9px;padding:1px 5px">override</span>' : ''}
          </div>
          <div style="margin-top:var(--sp-2)">
            <input
              type="text"
              class="input input--sm"
              placeholder="Note (optional)"
              value="${_esc(note)}"
              data-action="wt-note-input"
              data-instance-id="${instanceId}"
              data-item-id="${item.id}"
              data-sel-key="${selKey}"
              aria-label="Note for ${_esc(item.name)}"
            />
          </div>

          ${isSerial ? _serialSlotHtml(selKey, instanceId, item.id, project) : ''}
          <div data-photo-slot data-scope="item" data-ref="${selKey}">
            ${_photoSlotHtml(selKey, 'item', project.id)}
          </div>
        </div>
      ` : ''}
    </div>
  `;
}

function _addItemRowHtml(groupKey) {
  return `
    <div class="wt-add-item-row">
      <button
        class="btn btn--ghost btn--sm"
        data-action="wt-add-custom-item"
        data-group-key="${groupKey}"
        aria-label="Add custom item to this group"
      >+ Add item</button>
    </div>
  `;
}

/* ============================================================
   Serial Slot HTML
   ============================================================ */

/**
 * Render manual Serial Capture fields + serial-photo required indicator.
 * Only called for items in SERIAL_ITEM_IDS.
 *
 * @param {string} selKey      "instanceId::itemId"
 * @param {string} instanceId
 * @param {string} itemId
 * @param {object} project
 * @returns {string} HTML
 */
function _serialSlotHtml(selKey, instanceId, itemId, project) {
  const meta = (project.serials && project.serials[selKey]) || {};
  const serial = meta.serial || '';
  const model  = meta.model  || '';
  const brand  = meta.brand  || '';
  const year   = meta.year   || '';
  const notes  = meta.notes  || '';

  // Serial photo required indicator: show badge until ≥1 serial photo exists
  const serialPhotos = _photoCache.get(selKey)
    ? _photoCache.get(selKey).filter(p => p.kind === 'serial')
    : [];
  const hasSerialPhoto = serialPhotos.length > 0;
  const requiredBadge = hasSerialPhoto
    ? ''
    : `<span class="wt-serial-required-badge" aria-live="polite">Photo required</span>`;

  // Serial photos strip (thumbnails inside the serial slot)
  const serialPhotoStrip = _photoStripHtml(serialPhotos, 'serial');

  return `
    <div class="wt-serial-slot" data-serial-slot data-ref="${selKey}">
      <div class="wt-serial-header">
        <span class="wt-serial-title">Serial Info</span>
        ${requiredBadge}
      </div>
      <div class="wt-serial-fields">
        <div class="wt-serial-row">
          <label class="wt-serial-label" for="sf-serial-${_safeId(selKey)}">Serial #</label>
          <div class="wt-serial-input-wrap">
            <input
              id="sf-serial-${_safeId(selKey)}"
              class="input input--sm wt-serial-input"
              type="text"
              inputmode="text"
              autocomplete="off"
              placeholder="Serial number"
              value="${_esc(serial)}"
              data-action="wt-serial-field"
              data-instance-id="${instanceId}"
              data-item-id="${itemId}"
              data-field="serial"
            />${_speechSupported ? `<button type="button" class="icon-btn wt-dictate-btn" data-action="wt-dictate-field" data-target-id="sf-serial-${_safeId(selKey)}" data-field="serial" data-instance-id="${instanceId}" data-item-id="${itemId}" aria-label="Dictate serial number" title="Dictate serial number" aria-pressed="false"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg></button>` : ''}
          </div>
        </div>
        <div class="wt-serial-row">
          <label class="wt-serial-label" for="sf-model-${_safeId(selKey)}">Model #</label>
          <div class="wt-serial-input-wrap">
            <input
              id="sf-model-${_safeId(selKey)}"
              class="input input--sm wt-serial-input"
              type="text"
              inputmode="text"
              autocomplete="off"
              placeholder="Model number"
              value="${_esc(model)}"
              data-action="wt-serial-field"
              data-instance-id="${instanceId}"
              data-item-id="${itemId}"
              data-field="model"
            />${_speechSupported ? `<button type="button" class="icon-btn wt-dictate-btn" data-action="wt-dictate-field" data-target-id="sf-model-${_safeId(selKey)}" data-field="model" data-instance-id="${instanceId}" data-item-id="${itemId}" aria-label="Dictate model number" title="Dictate model number" aria-pressed="false"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg></button>` : ''}
          </div>
        </div>
        <div class="wt-serial-row">
          <label class="wt-serial-label" for="sf-brand-${_safeId(selKey)}">Brand</label>
          <input
            id="sf-brand-${_safeId(selKey)}"
            class="input input--sm wt-serial-input"
            type="text"
            inputmode="text"
            autocomplete="off"
            placeholder="Brand / manufacturer"
            value="${_esc(brand)}"
            data-action="wt-serial-field"
            data-instance-id="${instanceId}"
            data-item-id="${itemId}"
            data-field="brand"
          />
        </div>
        <div class="wt-serial-row">
          <label class="wt-serial-label" for="sf-year-${_safeId(selKey)}">Year</label>
          <input
            id="sf-year-${_safeId(selKey)}"
            class="input input--sm wt-serial-input"
            type="text"
            inputmode="numeric"
            autocomplete="off"
            placeholder="Year installed"
            value="${_esc(year)}"
            data-action="wt-serial-field"
            data-instance-id="${instanceId}"
            data-item-id="${itemId}"
            data-field="year"
          />
        </div>
        <div class="wt-serial-row wt-serial-row--notes">
          <label class="wt-serial-label" for="sf-notes-${_safeId(selKey)}">Notes</label>
          <input
            id="sf-notes-${_safeId(selKey)}"
            class="input input--sm wt-serial-input"
            type="text"
            inputmode="text"
            autocomplete="off"
            placeholder="Additional notes"
            value="${_esc(notes)}"
            data-action="wt-serial-field"
            data-instance-id="${instanceId}"
            data-item-id="${itemId}"
            data-field="notes"
          />
        </div>
      </div>
      ${!_speechSupported ? `<p class="wt-serial-tip">Tip: Use your keyboard's 🎤 dictation button to enter serial and model numbers hands-free.</p>` : ''}
      <div class="wt-serial-photo-row">
        ${serialPhotoStrip}
        <button
          class="btn btn--ghost btn--sm wt-serial-photo-btn"
          data-action="wt-add-photo"
          data-scope="item"
          data-ref="${selKey}"
          data-kind="serial"
          aria-label="Add serial photo"
        >📷 Serial Photo</button>
      </div>
    </div>
  `;
}

/* ============================================================
   Photo Slot HTML
   ============================================================ */

/**
 * Render the general photo strip + "Add Photo" button for any item.
 *
 * @param {string} refKey      "instanceId::itemId"
 * @param {string} scope       always "item" from line items
 * @param {string} projectId
 * @returns {string} HTML
 */
function _photoSlotHtml(refKey, scope, projectId) {
  // Only show general photos here (serial photos are shown inside the serial slot)
  const allPhotos = _photoCache.get(refKey) || [];
  const generalPhotos = allPhotos.filter(p => p.kind === 'general');

  return `
    <div class="wt-photo-strip">
      ${_photoStripHtml(generalPhotos, 'general')}
      <button
        class="btn btn--ghost btn--sm wt-add-photo-btn"
        data-action="wt-add-photo"
        data-scope="${_esc(scope)}"
        data-ref="${_esc(refKey)}"
        data-kind="general"
        aria-label="Add photo"
      >📷 Add Photo</button>
    </div>
  `;
}

/**
 * Render a horizontal strip of photo thumbnails with delete buttons.
 * Creates object URLs and tracks them for later revocation.
 *
 * @param {object[]} photos   array of photoRecords
 * @param {string}   kind     'general' or 'serial' (for aria labels)
 * @returns {string} HTML
 */
function _photoStripHtml(photos, kind) {
  if (!photos || photos.length === 0) return '';

  return photos.map(ph => {
    let thumbSrc = '';
    if (ph.thumbBlob) {
      thumbSrc = getThumbURL(ph);
      _photoURLs.push(thumbSrc);  // track for revocation on next render
    }
    return `
      <div class="wt-photo-thumb" data-photo-id="${_esc(ph.id)}">
        ${thumbSrc
          ? `<img src="${thumbSrc}" class="wt-photo-img" alt="${kind} photo" loading="lazy" />`
          : `<div class="wt-photo-placeholder" aria-hidden="true">🖼</div>`
        }
        <button
          class="wt-photo-delete-btn"
          data-action="wt-delete-photo"
          data-photo-id="${_esc(ph.id)}"
          data-ref-key="${_esc(ph.refKey)}"
          aria-label="Delete photo"
          title="Delete photo"
        >×</button>
      </div>
    `;
  }).join('');
}

/* ============================================================
   End-of-walkthrough Bar
   ============================================================ */

function _endBarHtml(project) {
  // Count non-critical groups that are still unreviewed (eligible for bulk mark)
  let unreviewed = 0;
  for (const room of project.rooms) {
    const groups = getGroupsForInstance(room.instanceId, room.roomType);
    for (const g of groups) {
      const critical = _isCriticalNow(g.key, room.instanceId, project, g.critical, g.conditionalItemIds);
      if (critical) continue;
      if (getEffectiveStatus(room.instanceId, g.key, project) === 'unreviewed') unreviewed++;
    }
  }

  // Count bulk-marked groups still effectively "none" (eligible for reset)
  let bulkCandidates = 0;
  const tracked = project.bulkMarkedGroups || [];
  for (const composite of tracked) {
    const idx = composite.indexOf('::');
    if (idx === -1) continue;
    if (getEffectiveStatus(composite.slice(0, idx), composite.slice(idx + 2), project) === 'none') {
      bulkCandidates++;
    }
  }

  let bulkBtn = '';
  if (unreviewed > 0) {
    bulkBtn = `
      <button
        class="btn btn--sm wt-bulk-btn"
        data-action="wt-bulk-mark-none"
        aria-label="Mark remaining non-critical groups as No Work Needed"
        title="Mark remaining non-critical groups as No Work Needed. Critical groups stay unreviewed."
      >Bulk No-Work</button>`;
  } else if (bulkCandidates > 0) {
    bulkBtn = `
      <button
        class="btn btn--sm wt-bulk-btn"
        data-action="wt-bulk-reset"
        aria-label="Undo bulk No Work mark"
        title="Undo the bulk No Work mark; manually-marked groups and groups with work are kept."
      >Undo Bulk No-Work</button>`;
  }

  return `
    <div class="wt-end-bar">
      <button
        type="button"
        class="btn btn--sm wt-gallery-btn"
        data-action="wt-goto-gallery"
        data-project-id="${project.id}"
        aria-label="Photo Gallery"
        title="Photo Gallery"
      ><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>Gallery</button>
      <div class="wt-end-bar__right">
        ${bulkBtn}
        <button
          class="btn btn--primary btn--sm wt-summary-btn"
          data-action="wt-goto-summary"
          data-project-id="${project.id}"
          aria-label="Review &amp; Export"
          title="Review &amp; Export"
        ><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align:-2px;margin-right:5px"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><path d="M9 14l1.8 1.8L15 12"/></svg>Review</button>
      </div>
    </div>
  `;
}

/* ============================================================
   Delegated Event Handlers
   ============================================================ */

function _wtClickHandler(e) {
  let el = e.target;
  while (el && el !== e.currentTarget) {
    const action = el.dataset && el.dataset.action;
    if (action) {
      // Don't stop propagation for checkbox — it has its own change / click behaviour
      if (action !== 'wt-toggle-item') e.stopPropagation();
      _handleWtAction(action, el, e);
      return;
    }
    el = el.parentElement;
  }
}

function _wtInputHandler(e) {
  const el = e.target;
  if (el.dataset && el.dataset.action === 'wt-qty-input') {
    _handleQtyInput(el);
  }
  // Serial fields: suppress re-render on every keystroke (same pattern as qty)
  if (el.dataset && el.dataset.action === 'wt-serial-field') {
    _suppressRerender = true;
    // No state write on every keystroke — write on blur/change (below)
    setTimeout(() => { _suppressRerender = false; }, 200);
  }
  // Search: local filter only — no state mutation, no debounce needed.
  // Updates just the results panel in place so the input keeps focus.
  if (el.dataset && el.dataset.action === 'wt-search-input') {
    _searchQuery = el.value;
    _updateSearchPanel();
  }
}

function _wtScrollHandler(e) {
  if (e.target && e.target.classList && e.target.classList.contains('section-tabs')) {
    _updateTabsFade(e.target);
  }
}

function _updateTabsFade(el) {
  if (!el || !el.parentElement) return;
  const maxScroll = el.scrollWidth - el.clientWidth;
  if (maxScroll <= 0) {
    el.parentElement.classList.remove('can-scroll-left', 'can-scroll-right');
    return;
  }
  const left = Math.ceil(el.scrollLeft);

  if (left <= 1) {
    el.parentElement.classList.remove('can-scroll-left');
    el.parentElement.classList.add('can-scroll-right');
  } else if (left >= maxScroll - 1) {
    el.parentElement.classList.add('can-scroll-left');
    el.parentElement.classList.remove('can-scroll-right');
  } else {
    el.parentElement.classList.add('can-scroll-left', 'can-scroll-right');
  }
}

function _wtKeydownHandler(e) {
  const el = e.target;
  if (el.dataset && el.dataset.action === 'wt-search-input' && e.key === 'Escape') {
    el.value = '';
    _searchQuery = '';
    _updateSearchPanel();
    el.blur();
  }
}

function _wtChangeHandler(e) {
  const el = e.target;
  if (el.dataset && el.dataset.action === 'wt-note-input') {
    const { instanceId, itemId } = el.dataset;
    if (instanceId && itemId) {
      _suppressRerender = true;
      setNote(instanceId, itemId, el.value);
      setTimeout(() => { _suppressRerender = false; }, 100);
    }
  }
  if (el.dataset && el.dataset.action === 'wt-toggle-item') {
    // checkbox change — also handled by click; guard against double-fire
    // The click handler fires first; ignore change event for checkboxes
  }
  // Serial field: write to state on blur/change so focus is not disrupted
  if (el.dataset && el.dataset.action === 'wt-serial-field') {
    const { instanceId, itemId, field } = el.dataset;
    if (instanceId && itemId && field) {
      _suppressRerender = true;
      setSerialMeta(instanceId, itemId, { [field]: el.value });
      setTimeout(() => { _suppressRerender = false; }, 100);
    }
  }
}

async function _handleWtAction(action, el, e) {
  const project = getActiveProject();
  if (!project) return;

  switch (action) {

    /* ------ Navigation ------ */
    case 'wt-back':
      window.location.hash = '#/dashboard';
      break;

    case 'wt-goto-pricebook':
      window.location.hash = '#/pricebook';
      break;

    case 'wt-goto-summary': {
      const pid = el.dataset.projectId || project.id;
      window.location.hash = `#/project/${pid}/summary`;
      break;
    }

    case 'wt-goto-gallery': {
      const pid = el.dataset.projectId || project.id;
      window.location.hash = `#/project/${pid}/gallery`;
      break;
    }

    /* ------ Search: jump to a group or line item ------ */
    case 'wt-search-select': {
      const { instanceId, groupKey, itemId } = el.dataset;
      const ok = _jumpToTarget({ instanceId, groupKey, itemId: itemId || null });
      if (!ok) break;

      _searchQuery = '';
      _fullRerender();
      break;
    }

    case 'wt-search-clear': {
      _searchQuery = '';
      _updateSearchPanel();
      const input = document.querySelector('.wt-search-input');
      if (input) { input.value = ''; input.focus(); }
      break;
    }

    /* ------ Speech dictation (Serial # / Model # fields) ------ */
    case 'wt-dictate-field': {
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SR) {
        toast('Speech input not available. Use your keyboard dictation button.', { type: 'info' });
        break;
      }
      const targetId   = el.dataset.targetId;
      const field      = el.dataset.field;
      const iid        = el.dataset.instanceId;
      const iitemId    = el.dataset.itemId;
      const inputEl    = document.getElementById(targetId);
      if (!inputEl) break;

      el.classList.add('is-listening');
      el.setAttribute('aria-pressed', 'true');

      try {
        const recognition = new SR();
        recognition.continuous     = false;
        recognition.interimResults = false;
        recognition.lang           = 'en-US';

        recognition.onresult = (evt) => {
          const text = evt.results[0][0].transcript.trim();
          if (text) {
            inputEl.value = text;
            _suppressRerender = true;
            setSerialMeta(iid, iitemId, { [field]: text });
            setTimeout(() => { _suppressRerender = false; }, 100);
          }
        };
        recognition.onerror = (evt) => {
          el.classList.remove('is-listening');
          el.setAttribute('aria-pressed', 'false');
          if (['network', 'service-not-allowed', 'not-allowed'].includes(evt.error)) {
            toast('Microphone unavailable. Use your keyboard dictation button.', { type: 'info' });
          }
        };
        recognition.onend = () => {
          el.classList.remove('is-listening');
          el.setAttribute('aria-pressed', 'false');
        };

        recognition.start();
      } catch (_err) {
        el.classList.remove('is-listening');
        el.setAttribute('aria-pressed', 'false');
        toast('Speech input not available here.', { type: 'info' });
      }
      break;
    }

    /* ------ Project rename ------ */
    case 'wt-rename-project': {
      const newName = await showModal({
        title: 'Rename Project',
        placeholder: project.name,
        value: project.name,
        confirmText: 'Rename',
      });
      if (!newName) break;
      await renameProject(project.id, newName);
      // onChange will re-render
      break;
    }

    /* ------ Section tab ------ */
    case 'wt-section-tab': {
      const sid = el.dataset.section;
      if (sid && sid !== _activeSectionId) {
        _activeSectionId = sid;
        _fullRerender();
      }
      break;
    }

    /* ------ Room sub-tab ------ */
    case 'wt-room-subtab': {
      const iid = el.dataset.instanceId;
      const sid = el.dataset.sectionId || _activeSectionId;
      if (iid) {
        _activeSubTab.set(sid, iid);
        _fullRerender();
      }
      break;
    }

    /* ------ Add room ------ */
    case 'wt-add-room': {
      const roomType = el.dataset.roomType;
      const sectionId = el.dataset.sectionId || _activeSectionId;
      if (!roomType) break;
      // Suppress the emit-driven re-render inside addRoomInstance so we can set
      // the new room as the active sub-tab BEFORE re-rendering — otherwise the
      // re-render runs with the stale sub-tab and the new room never activates.
      _suppressRerender = true;
      const newId = addRoomInstance(roomType);
      _activeSubTab.set(sectionId, newId);
      _suppressRerender = false;
      _fullRerender();
      break;
    }

    /* ------ Room menu (rename / duplicate / remove) ------ */
    case 'wt-room-menu': {
      const instanceId  = el.dataset.instanceId;
      const roomLabel   = el.dataset.roomLabel || '';
      const removable   = el.dataset.removable === '1';
      const roomType    = el.dataset.roomType;

      const actions = [
        { label: 'Rename',    value: 'rename' },
        { label: 'Duplicate', value: 'duplicate' },
      ];
      if (removable) actions.push({ label: 'Remove Room', value: 'remove', danger: true });

      const choice = await showSheet({ title: roomLabel, html: '', actions });
      if (!choice) break;

      if (choice === 'rename') {
        const newLabel = await showModal({
          title: 'Rename Room',
          value: roomLabel,
          placeholder: roomLabel,
          confirmText: 'Rename',
        });
        if (!newLabel) break; // cancelled (or empty) — no change
        try {
          renameRoomInstance(instanceId, newLabel);
        } catch (err) {
          toast(err.message || 'Could not rename room', { type: 'error' });
        }

      } else if (choice === 'duplicate') {
        // Same ordering fix as wt-add-room: suppress emit-driven render, set
        // the new instance active, then re-render once.
        _suppressRerender = true;
        const newId = duplicateRoomInstance(instanceId);
        _activeSubTab.set(_activeSectionId, newId);
        _suppressRerender = false;
        _fullRerender();

      } else if (choice === 'remove') {
        const ok = await confirm({
          title: 'Remove Room',
          message: `Remove "${roomLabel}" and all its selections? This cannot be undone.`,
          confirmText: 'Remove',
          danger: true,
        });
        if (!ok) break;
        // Find another instance to switch to before removing
        const proj = getActiveProject();
        const remaining = proj.rooms.filter(r => {
          const tmpl = ROOM_TEMPLATES[r.roomType];
          return tmpl && tmpl.section === _activeSectionId && r.instanceId !== instanceId;
        });
        try {
          await removeRoomInstance(instanceId);
          _activeSubTab.set(_activeSectionId, remaining.length > 0 ? remaining[0].instanceId : null);
          toast('Room removed', { type: 'info' });
        } catch (err) {
          console.error('[walkthrough] removeRoomInstance error', err);
          toast('Could not fully remove room photos', { type: 'error' });
        }
      }
      break;
    }

    /* ------ Group expand/collapse ------ */
    case 'wt-toggle-group': {
      // Don't fire if user clicked a button inside the header
      if (e.target.closest('[data-action="wt-no-work"]')) break;
      const composite = el.dataset.composite;
      if (!composite) break;
      if (_expandedGroups.has(composite)) {
        _expandedGroups.delete(composite);
      } else {
        _expandedGroups.add(composite);
      }
      _fullRerender();
      break;
    }

    /* ------ No Work Needed toggle ------ */
    case 'wt-no-work': {
      e.stopPropagation(); // prevent header toggle-group from also firing
      const { instanceId, groupKey } = el.dataset;
      const isNone   = el.dataset.isNone === '1';
      const selCount = parseInt(el.dataset.selCount || '0', 10);

      if (!isNone && selCount > 0) {
        const ok = await confirm({
          title: 'Clear Selections',
          message: `Clear ${selCount} selected item${selCount !== 1 ? 's' : ''} and mark this group as "No Work Needed"?`,
          confirmText: 'Clear & Mark',
          danger: false,
        });
        if (!ok) break;
      }
      // Suppress the emit-driven render, then force one guaranteed repaint.
      // The activeElement guard in _onStateChange can otherwise skip the
      // re-render when a qty input still holds focus, leaving the pill/button/
      // progress stale (same root cause as the checkbox detail-panel bug).
      _suppressRerender = true;
      setGroupStatus(instanceId, groupKey, isNone ? 'unreviewed' : 'none');
      _suppressRerender = false;
      _fullRerender();
      break;
    }

    /* ------ Toggle item ------ */
    case 'wt-toggle-item': {
      const { instanceId, itemId, selKey } = el.dataset;
      if (!instanceId || !itemId) break;
      const willBeChecked = el.checked;
      // Suppress the emit-driven _onStateChange re-render: on Android standalone/
      // offline, the activeElement guard (a qty-input still focused from a prior
      // selection) can silently skip the re-render, leaving the detail panel
      // closed. Call _fullRerender() directly for a guaranteed, guard-free repaint.
      _suppressRerender = true;
      toggleItem(instanceId, itemId);
      _suppressRerender = false;
      if (willBeChecked && !_isTouchDevice()) {
        _pendingFocusSelKey = selKey || `${instanceId}::${itemId}`;
      }
      _fullRerender();
      e.stopPropagation();
      break;
    }

    /* ------ Chip click ------ */
    case 'chip': {
      const chipVal = el.dataset.chip;
      if (!chipVal) break;
      // Find nearest qty input inside same .wt-item-detail
      const detail = el.closest('.wt-item-detail');
      if (!detail) break;
      const qtyInput = detail.querySelector('[data-action="wt-qty-input"]');
      if (!qtyInput) break;
      const { instanceId, itemId, groupKey, selKey } = qtyInput.dataset;
      qtyInput.value = chipVal;
      _applyQtyInPlace(qtyInput, instanceId, itemId, groupKey, selKey, chipVal);
      // Only refocus qty input on non-touch devices to avoid mobile keyboard jump.
      if (!_isTouchDevice()) { qtyInput.focus(); }
      break;
    }

    /* ------ Price override ------ */
    case 'wt-price-override': {
      const { instanceId, itemId, itemName, hasOverride } = el.dataset;
      const resolvedCost = parseFloat(el.dataset.resolvedCost) || 0;
      const proj = getActiveProject();
      const gp   = getGlobalPrices();
      // Default cost = global or catalog (no project override)
      const baseCost = getResolvedCost(itemId, { priceOverrides: {}, customItems: proj.customItems, deletedItemIds: proj.deletedItemIds }, gp);

      const sheetHtml = `
        <div class="field" style="margin-bottom:var(--sp-4)">
          <label class="field__label" for="override-inp">Unit cost (${_esc(proj.rooms[0] && proj.rooms[0].instanceId ? '' : '')})
            <strong>${_esc(itemName)}</strong></label>
          <p style="font-size:var(--text-xs);color:var(--color-text-muted);margin:var(--sp-2) 0 var(--sp-3)">
            Catalog/global: ${formatUnitCost(baseCost)}
            ${hasOverride === '1' ? ` &bull; Current override: ${formatUnitCost(resolvedCost)}` : ''}
          </p>
          <input
            id="override-inp"
            class="input"
            type="text"
            inputmode="decimal"
            placeholder="${baseCost}"
            value="${hasOverride === '1' ? resolvedCost : ''}"
            autocomplete="off"
          />
        </div>
      `;
      const actions = [
        { label: 'Save Override', value: 'save', primary: true },
        ...(hasOverride === '1' ? [{ label: 'Clear Override', value: 'clear' }] : []),
      ];

      const choice = await showSheet({ title: 'Price Override', html: sheetHtml, actions });
      if (!choice) break;

      if (choice === 'save') {
        const inpEl = document.getElementById('override-inp');
        const val   = inpEl ? parseFloat(inpEl.value) : NaN;
        if (!isNaN(val) && val >= 0) {
          setItemPriceOverride(itemId, val);
          toast('Price override saved', { type: 'success' });
        } else {
          toast('Enter a valid number ≥ 0', { type: 'error' });
        }
      } else if (choice === 'clear') {
        clearItemPriceOverride(itemId);
        toast('Price reset to global/default', { type: 'info' });
      }
      break;
    }

    /* ------ Delete item ------ */
    case 'wt-delete-item': {
      const { itemId, itemName } = el.dataset;
      const ok = await confirm({
        title: 'Delete Item',
        message: `Delete "${itemName}" from this project? Catalog items are hidden; custom items are removed.`,
        confirmText: 'Delete',
        danger: true,
      });
      if (!ok) break;
      try {
        await deleteItem(itemId);
        toast('Item deleted', { type: 'info' });
      } catch (err) {
        console.error('[walkthrough] deleteItem error', err);
        toast('Could not delete item', { type: 'error' });
      }
      break;
    }

    /* ------ Add custom item ------ */
    case 'wt-add-custom-item': {
      const groupKey = el.dataset.groupKey;
      const sheetHtml = `
        <div class="field" style="margin-bottom:var(--sp-3)">
          <label class="field__label" for="ci-name">Item name</label>
          <input id="ci-name" class="input" type="text" placeholder="e.g. Skylight Replacement" autocomplete="off" />
        </div>
        <div style="display:flex;gap:var(--sp-3)">
          <div class="field" style="flex:1">
            <label class="field__label" for="ci-unit">Unit</label>
            <input id="ci-unit" class="input" type="text" placeholder="ea." value="ea." autocomplete="off" />
          </div>
          <div class="field" style="flex:1">
            <label class="field__label" for="ci-cost">Default cost ($)</label>
            <input id="ci-cost" class="input" type="text" inputmode="decimal" placeholder="0" autocomplete="off" />
          </div>
        </div>
      `;
      const choice = await showSheet({
        title: 'Add Custom Item',
        html: sheetHtml,
        actions: [{ label: 'Add Item', value: 'add', primary: true }],
      });
      if (choice !== 'add') break;
      const nameEl = document.getElementById('ci-name');
      const unitEl = document.getElementById('ci-unit');
      const costEl = document.getElementById('ci-cost');
      const name   = nameEl ? nameEl.value.trim() : '';
      const unit   = (unitEl && unitEl.value.trim()) || 'ea.';
      const cost   = costEl ? parseFloat(costEl.value) : 0;
      if (!name) { toast('Name is required', { type: 'error' }); break; }
      addCustomItem({ name, unit, defaultCost: isNaN(cost) ? 0 : cost, groupKey });
      toast('Custom item added', { type: 'success' });
      break;
    }

    /* ------ Bulk mark non-critical none ------ */
    case 'wt-bulk-mark-none': {
      const ok = await confirm({
        title: 'Mark Non-Critical Groups?',
        message: 'This will mark all remaining non-critical unreviewed groups as No Work Needed. Critical groups will stay unreviewed.',
        confirmText: 'Mark All',
        danger: false,
      });
      if (!ok) break;
      const { affected } = bulkMarkNonCriticalNone();
      toast(
        affected > 0
          ? `${affected} group${affected !== 1 ? 's' : ''} marked as No Work Needed`
          : 'No unreviewed non-critical groups to mark',
        { type: affected > 0 ? 'success' : 'info' }
      );
      break;
    }

    /* ------ Reset bulk-marked groups ------ */
    case 'wt-bulk-reset': {
      const ok = await confirm({
        title: 'Undo Bulk No Work?',
        message: 'This resets groups marked by "Mark remaining" back to Not Reviewed. Manually-marked No Work groups and groups with selected work are not affected.',
        confirmText: 'Undo',
        danger: false,
      });
      if (!ok) break;
      const { reset } = resetBulkMarkedGroups();
      toast(
        reset > 0
          ? `${reset} group${reset !== 1 ? 's' : ''} reset to Not Reviewed`
          : 'No bulk-marked groups to reset',
        { type: reset > 0 ? 'info' : 'info' }
      );
      break;
    }

    /* ------ Reset current project ------ */
    case 'wt-reset-project': {
      const ok = await confirm({
        title: 'Reset Current Project?',
        message: 'This will clear all selections, quantities, notes, No Work markings, photos, serial info, custom items, price overrides, room changes, and deal analyzer values for this project. This cannot be undone.',
        confirmText: 'Reset Project',
        danger: true,
      });
      if (!ok) break;
      try {
        // Blur any focused input so the rerender isn't suppressed by the
        // activeElement guard and the soft keyboard closes.
        if (document.activeElement && document.activeElement.blur) {
          document.activeElement.blur();
        }
        // Suppress the emit-driven render so it can't repaint with stale local
        // UI caches mid-reset; we clear caches and force one clean rerender below.
        _suppressRerender = true;
        await resetProject();
        _activeSectionId = SECTIONS[0].id;
        _activeSubTab.clear();
        _expandedGroups.clear();
        _photoCache.clear();
        _photoURLs = [];
        _pendingFocusSelKey = null;
        _suppressRerender = false;
        _fullRerender();
        toast('Project reset to blank state', { type: 'info' });
      } catch (err) {
        _suppressRerender = false;
        console.error('[walkthrough] reset error', err);
        toast('Could not reset project', { type: 'error' });
      }
      break;
    }

    /* ------ Add photo (general or serial) ------ */
    case 'wt-add-photo': {
      const scope  = el.dataset.scope  || 'item';
      const refKey = el.dataset.ref    || '';
      const kind   = el.dataset.kind   || 'general';
      if (!refKey) break;
      try {
        const record = await capturePhoto({ scope, refKey, kind });
        if (!record) break; // user cancelled
        // Upsert directly from the returned record (its own refKey is the
        // source of truth) and repaint immediately — do not wait on the
        // onPhotosChanged round trip, and don't show the toast until this
        // is done. addPhoto() also emits onPhotosChanged; _upsertPhotoInCache
        // is idempotent by photo id, so that second application is a no-op.
        _upsertPhotoInCache(record);
        _fullRerender();
        toast('Photo added', { type: 'success' });
      } catch (err) {
        console.error('[walkthrough] add photo error', err);
        toast('Could not add photo', { type: 'error' });
      }
      break;
    }

    /* ------ Delete photo ------ */
    case 'wt-delete-photo': {
      const photoId = el.dataset.photoId;
      const refKey  = el.dataset.refKey;
      if (!photoId) break;
      const ok = await confirm({
        title: 'Delete Photo',
        message: 'Delete this photo? This cannot be undone.',
        confirmText: 'Delete',
        danger: true,
      });
      if (!ok) break;
      try {
        await photosDeletePhoto(photoId);
        _removePhotoFromCache(photoId, refKey);
        _fullRerender();
        toast('Photo deleted', { type: 'info' });
      } catch (err) {
        console.error('[walkthrough] delete photo error', err);
        toast('Could not delete photo', { type: 'error' });
      }
      break;
    }

    default:
      break;
  }
}

/* ============================================================
   In-place qty update helpers
   ============================================================ */

function _handleQtyInput(el) {
  const { instanceId, itemId, groupKey, selKey } = el.dataset;
  _applyQtyInPlace(el, instanceId, itemId, groupKey, selKey, el.value);
}

function _applyQtyInPlace(qtyEl, instanceId, itemId, groupKey, selKey, qty) {
  // Guard onChange re-render during in-place update
  _suppressRerender = true;

  const project      = getActiveProject();
  const globalPrices = getGlobalPrices();

  // 1. Update line total in place
  const lt    = computeLineTotal(itemId, qty, project, globalPrices);
  const ltEl  = document.getElementById('lt-' + _safeId(selKey));
  if (ltEl) ltEl.textContent = lt > 0 ? formatMoney(lt) : '—';

  // 2. Update group total in place — snapshot selections with new qty
  const compositeKey = `${instanceId}::${groupKey}`;
  const patchedSel   = Object.assign({}, project.selections, {
    [selKey]: Object.assign({}, project.selections[selKey] || { note: '' }, { qty }),
  });
  const patchedProj = Object.assign({}, project, { selections: patchedSel });
  const gt  = computeGroupTotal(instanceId, groupKey, patchedProj, globalPrices);
  const gtEl = document.getElementById('gt-' + _safeId(compositeKey));
  if (gtEl) {
    gtEl.style.display = gt > 0 ? '' : 'none';
    gtEl.textContent = gt > 0 ? formatMoney(gt) : '';
  }

  // 3. Update grand total in place
  const grandTotEl = document.getElementById('wt-grand-total');
  if (grandTotEl) {
    const gTotal = computeGrandTotal(patchedProj, globalPrices);
    grandTotEl.textContent = formatMoney(gTotal);
  }

  // Call state.setQty — schedules debounced save + emits onChange
  setQty(instanceId, itemId, qty);

  // Release suppression after emit has fired
  setTimeout(() => { _suppressRerender = false; }, 200);
}

/* ============================================================
   Full re-render helper
   ============================================================ */

function _fullRerender() {
  const project = getActiveProject();
  const rootEl  = document.getElementById('app');
  if (!rootEl || !project) return;
  _cleanListeners(rootEl);
  _renderWalkthrough(rootEl, project);
}

/* ============================================================
   Jump-to-target (shared by in-app search and external callers,
   e.g. the Photo Gallery's "Go to Source" action)
   ============================================================ */

/**
 * Point the walkthrough at a specific group/item: resolves the section +
 * room sub-tab from the target's instanceId, expands the group, and queues
 * a scroll+highlight for the next render. Pure state mutation — does NOT
 * re-render; callers already on the walkthrough screen must call
 * _fullRerender() afterward, callers navigating IN (e.g. from another route)
 * should set the hash afterward and let the route's own render() pick it up.
 *
 * @param {{instanceId:string, groupKey:string, itemId?:string|null}} target
 * @returns {boolean} true if the target resolved to a real room/group
 */
function _jumpToTarget({ instanceId, groupKey, itemId }) {
  const project = getActiveProject();
  if (!project || !instanceId || !groupKey) return false;

  const room = project.rooms.find(r => r.instanceId === instanceId);
  const tmpl = room ? ROOM_TEMPLATES[room.roomType] : null;
  if (!room || !tmpl) return false;

  const section = SECTIONS.find(s => s.id === tmpl.section);
  _activeSectionId = tmpl.section;
  if (section && section.multi) {
    _activeSubTab.set(tmpl.section, instanceId);
  }
  _expandedGroups.add(`${instanceId}::${groupKey}`);
  _pendingScrollTarget = { instanceId, groupKey, itemId: itemId || null };

  return true;
}

/**
 * Public entry point for other screens (e.g. gallery.js's "Go to Source")
 * to point the walkthrough at a group/item BEFORE navigating there via
 * window.location.hash. Since the walkthrough module keeps its section/
 * sub-tab/expanded-group state at module scope for the lifetime of the
 * page, setting it here and then changing the route lets the normal
 * render() → _renderWalkthrough() flow pick it up and scroll/highlight
 * automatically — no direct DOM access needed from the caller.
 *
 * Guards against the cold-entry edge case where the walkthrough has never
 * rendered this project yet this session (e.g. the user opened the Gallery
 * route directly): render()'s first-load branch would otherwise reset
 * _activeSectionId/_activeSubTab/_expandedGroups right after we set them.
 * Marking the project as already-initialized here (and kicking off the
 * photo cache load ourselves) makes the jump work the same whether the
 * walkthrough was already mounted or not.
 *
 * @param {{instanceId:string, groupKey:string, itemId?:string|null}} target
 * @returns {boolean} true if the target resolved to a real room/group
 */
export function jumpToWalkthroughTarget(target) {
  const ok = _jumpToTarget(target);
  if (!ok) return false;

  const project = getActiveProject();
  if (project && _renderedProjectId !== project.id) {
    _renderedProjectId        = project.id;
    _renderedProjectUpdatedAt = project.updatedAt || null;
    _loadPhotoCache(project.id);
  }

  return true;
}

/* ============================================================
   Progress calculation
   ============================================================ */

function _calcProgress(project) {
  // Progress is group-based: any selected item OR explicit No Work completes
  // the group. Selected item count is kept only as secondary context.
  let selectedItems = 0;
  let groupsDone = 0, groupsTotal = 0;
  for (const room of project.rooms) {
    const groups = getGroupsForInstance(room.instanceId, room.roomType);
    for (const g of groups) {
      groupsTotal++;
      const status = getEffectiveStatus(room.instanceId, g.key, project);
      if (status !== 'unreviewed') groupsDone++;
      const items = getItemsForGroup(g.key, project);
      for (const item of items) {
        if (project.selections[`${room.instanceId}::${item.id}`] !== undefined) selectedItems++;
      }
    }
  }
  return { selectedItems, groupsDone, groupsTotal };
}

/* ============================================================
   Status pill
   ============================================================ */

function _statusPill(status, groupTotal, selCount) {
  if (status === 'unreviewed') {
    return `<span class="badge badge--unreviewed">Not Reviewed</span>`;
  }
  if (status === 'none') {
    return `<span class="badge badge--none">✓ No Work Needed</span>`;
  }
  // work
  const parts = [];
  if (groupTotal > 0) parts.push(formatMoney(groupTotal));
  if (selCount > 0)   parts.push(selCount + '✓');
  const detail = parts.length ? ' — ' + parts.join(' · ') : '';
  return `<span class="badge badge--work">Work Needed${detail}</span>`;
}

/* ============================================================
   Helpers
   ============================================================ */

function _isCriticalNow(groupKey, instanceId, project, criticalDef, conditionalItemIds) {
  if (!CRITICAL_GROUP_KEYS.has(groupKey)) return false;
  if (criticalDef === 'conditional' && Array.isArray(conditionalItemIds)) {
    return conditionalItemIds.some(
      iid => project.selections[`${instanceId}::${iid}`] !== undefined
    );
  }
  return true;
}

function _countSelections(instanceId, groupKey, project) {
  const group = GROUPS[groupKey];
  if (!group) return 0;
  const ids = [
    ...group.itemIds,
    ...(project.customItems || []).filter(ci => ci.groupKey === groupKey).map(ci => ci.id),
  ];
  return ids.filter(id =>
    !((project.deletedItemIds || []).includes(id)) &&
    project.selections[`${instanceId}::${id}`] !== undefined
  ).length;
}

function _safeId(str) {
  return String(str).replace(/[^a-zA-Z0-9_-]/g, '_');
}

function _esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function _isTouchDevice() {
  return window.matchMedia('(pointer: coarse)').matches;
}
