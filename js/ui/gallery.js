/**
 * js/ui/gallery.js — Project Photo Gallery
 * Professional review screen for every photo in the active project: summary
 * stats, filter chips, grouped buckets, a large preview lightbox, and
 * View / Replace / Delete actions per photo.
 *
 * Named export: render(rootEl, params)
 * No default export. Vanilla ESM.
 *
 * Reuses existing helpers only — no new business logic:
 *   - photos.js:  getPhotos, getThumbURL, deletePhoto, replacePhoto, onPhotosChanged
 *   - export.js:  buildPhotoManifestRows (same room/group/item context labels
 *                 already used by the Photo Manifest Excel sheet)
 *
 * Route: #/project/:id/gallery (static hash route, mirrors summary/pricebook/analyzer).
 */

import {
  getActiveProject,
  switchProject,
} from '../state.js';

import {
  getPhotos,
  getThumbURL,
  deletePhoto,
  replacePhoto,
} from '../photos.js';

import { buildPhotoManifestRows } from '../export.js';

import { confirm, toast } from './components.js';

// ============================================================================
// Constants
// ============================================================================

/* Gallery now surfaces only the two dominant photo types via chips/stats.
   Room/Group/Project photos (if any exist) are still fully viewable under
   "All" — see _matchesFilter/_bucketPhotos below, which are unchanged — this
   only removes the dedicated UI controls for them, not the underlying data. */
const FILTER_DEFS = [
  { key: 'all',    label: 'All' },
  { key: 'serial', label: 'Serial' },
  { key: 'item',   label: 'Item' },
];

const KIND_LABELS = {
  serial:  'Serial',
  item:    'Item',
  room:    'Room',
  group:   'Group',
  project: 'Project',
};

// ============================================================================
// Module-level state
// ============================================================================

/** Object URLs created during the last render — revoked before the next render */
let _photoURLs = [];

/** Guard: prevents overlapping delete/replace operations */
let _busy = false;

/** Active filter chip key */
let _activeFilter = 'all';

/** Photo id currently shown in the preview lightbox, or null */
let _previewPhotoId = null;

/** Cached project + photo list so filter/preview interactions don't need a DB round-trip */
let _currentProject = null;
let _currentPhotos  = [];

// ============================================================================
// render
// ============================================================================

/**
 * Render the photo gallery into rootEl.
 * @param {HTMLElement} rootEl
 * @param {{ id:string }} params - route params from hash router
 */
export async function render(rootEl, params) {
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

  // Fresh entry into the route — reset transient UI state
  _activeFilter    = 'all';
  _previewPhotoId  = null;

  const project = getActiveProject();
  _currentProject = project;

  try {
    _currentPhotos = project ? await getPhotos(project.id) : [];
  } catch (err) {
    console.error('[gallery] getPhotos error', err);
    toast('Could not load photos.', { type: 'error' });
    _currentPhotos = [];
  }

  _renderContent(rootEl);
  _attachHandlers(rootEl);
}

// ============================================================================
// Rendering
// ============================================================================

function _renderContent(rootEl) {
  _revokePhotoURLs();

  const project    = _currentProject;
  const photos     = _currentPhotos;
  const projectId  = project ? project.id : '';
  const totalCount = photos.length;
  const stats      = _computeStats(photos);
  const buckets    = project ? _bucketPhotos(project, photos) : [];
  const filteredCount = buckets.reduce((n, b) => n + b.items.length, 0);

  rootEl.innerHTML = `
    <div class="page-header-stack">
      <div class="wt-brand-row">
        <img src="./assets/logo.png" alt="" class="wt-brand-logo" aria-hidden="true" />
        <span class="wt-brand-title">Repair Estimator</span>
      </div>
      <header class="app-header">
        <a href="#/project/${_esc(projectId)}" class="icon-btn" aria-label="Back to walkthrough" title="Back to walkthrough">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M19 12H5M12 5l-7 7 7 7"/>
          </svg>
        </a>
        <span class="app-header__title">Photo Gallery</span>
      </header>
    </div>

    <div class="page-content gal-page">
      ${!project ? `
        <div class="empty-state" style="min-height:40dvh">
          <p class="empty-state__title">No active project</p>
          <a href="#/" class="btn btn--primary" style="margin-top:var(--sp-4)">Go to Projects</a>
        </div>
      ` : totalCount === 0 ? `
        <div class="empty-state gal-empty" style="min-height:40dvh">
          <div class="gal-empty__icon">${_iconImage(32)}</div>
          <p class="empty-state__title">No photos yet</p>
          <p class="empty-state__desc">Photos you add during the walkthrough will show up here.</p>
        </div>
      ` : `
        ${_statsHtml(stats)}
        ${_filterChipsHtml()}
        ${filteredCount === 0
          ? `
            <div class="gal-empty-filtered">
              ${_iconImage(24)}
              <p>No ${_esc(KIND_LABELS[_activeFilter] || 'matching')} photos yet.</p>
            </div>
          `
          : buckets.map(b => _bucketHtml(b)).join('')}
      `}
    </div>

    ${_previewPhotoId ? _previewHtml() : ''}
  `;
}

function _rerender() {
  const rootEl = document.getElementById('app');
  if (rootEl) _renderContent(rootEl);
}

async function _refreshPhotos() {
  const project = _currentProject;
  if (!project) return;
  _currentPhotos = await getPhotos(project.id);
  _rerender();
}

// ============================================================================
// Classification / stats
// ============================================================================

/**
 * Map a photo record to one of the 5 filter/kind buckets: serial, item,
 * room, group, project. Mirrors the same scope/kind rules used by the
 * Photo Manifest export so the taxonomy stays a single source of truth.
 * @param {object} photo
 * @returns {'serial'|'item'|'room'|'group'|'project'}
 */
function _filterKindOf(photo) {
  if (photo.scope === 'project') return 'project';
  if (photo.scope === 'room')    return 'room';
  if (photo.scope === 'group')   return 'group';
  if (photo.scope === 'item' && photo.kind === 'serial') return 'serial';
  return 'item';
}

function _matchesFilter(photo, filter) {
  if (filter === 'all') return true;
  return _filterKindOf(photo) === filter;
}

/**
 * Summary strip counts — always computed from the FULL unfiltered photo
 * list so the strip stays a stable overview regardless of the active filter.
 * @param {object[]} photos
 * @returns {{total:number, serial:number, item:number, other:number}}
 */
function _computeStats(photos) {
  let serial = 0, item = 0, other = 0;
  for (const p of photos) {
    const k = _filterKindOf(p);
    if (k === 'serial') serial++;
    else if (k === 'item') item++;
    else other++; // room + group + project
  }
  return { total: photos.length, serial, item, other };
}

/**
 * Group the CURRENTLY FILTERED photos into the 4 display buckets, attaching
 * a context label to each photo via export.js's buildPhotoManifestRows so
 * the label logic is identical to the Photo Manifest Excel sheet.
 * @param {object} project
 * @param {object[]} photos  full (unfiltered) photo records — kept in the
 *                           same order/index as buildPhotoManifestRows expects
 * @returns {Array<{key:string, label:string, items:object[]}>}
 */
function _bucketPhotos(project, photos) {
  const rows = buildPhotoManifestRows(project, photos);

  const bucketDefs = [
    { key: 'serial',    label: 'Serial Photos',        items: [] },
    { key: 'item',       label: 'Repair Item Photos',   items: [] },
    { key: 'roomgroup', label: 'Room &amp; Group Photos', items: [] },
    { key: 'project',   label: 'Project Photos',        items: [] },
  ];
  const byKey = {};
  for (const b of bucketDefs) byKey[b.key] = b;

  photos.forEach((photo, idx) => {
    if (!_matchesFilter(photo, _activeFilter)) return;

    const row        = rows[idx] || {};
    const filterKind = _filterKindOf(photo);
    const bucketKey  = (filterKind === 'room' || filterKind === 'group') ? 'roomgroup' : filterKind;

    byKey[bucketKey].items.push({
      photo,
      context:    _contextLabel(row),
      filterKind,
      kindLabel:  KIND_LABELS[filterKind] || 'Photo',
      timestamp:  _fmtTimestamp(photo.createdAt),
    });
  });

  return bucketDefs.filter(b => b.items.length > 0);
}

/**
 * Build a human-readable "Room: Group > Item" context label from a
 * buildPhotoManifestRows row. Falls back gracefully when fields are empty.
 * @param {{room:string,group:string,itemName:string}} row
 * @returns {string}
 */
function _contextLabel(row) {
  const room = row.room || '';
  const rightParts = [row.group, row.itemName].filter(Boolean);
  const right = rightParts.join(' > ');
  if (room && right) return `${room}: ${right}`;
  if (room) return room;
  if (right) return right;
  return 'Project photo';
}

/**
 * Compact absolute date, matching the format used elsewhere in the app
 * (e.g. dashboard.js's _fmtDate) for consistency.
 * @param {string} iso
 * @returns {string}
 */
function _fmtTimestamp(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch (_) {
    return '';
  }
}

// ============================================================================
// HTML builders
// ============================================================================

function _statsHtml(stats) {
  return `
    <div class="gal-stats">
      <div class="gal-stat">
        <span class="gal-stat__value">${stats.total}</span>
        <span class="gal-stat__label">Total</span>
      </div>
      <div class="gal-stat">
        <span class="gal-stat__value">${stats.serial}</span>
        <span class="gal-stat__label">Serial</span>
      </div>
      <div class="gal-stat">
        <span class="gal-stat__value">${stats.item}</span>
        <span class="gal-stat__label">Item</span>
      </div>
    </div>
  `;
}

function _filterChipsHtml() {
  return `
    <div class="gal-filters" role="tablist" aria-label="Filter photos by type">
      ${FILTER_DEFS.map(f => `
        <button
          type="button"
          class="gal-chip${_activeFilter === f.key ? ' gal-chip--active' : ''}"
          data-action="gal-filter"
          data-filter="${f.key}"
          role="tab"
          aria-selected="${_activeFilter === f.key ? 'true' : 'false'}"
        >${_esc(f.label)}</button>
      `).join('')}
    </div>
  `;
}

function _bucketHtml(bucket) {
  return `
    <section class="gal-bucket">
      <h2 class="gal-bucket__title">${bucket.label} <span class="gal-bucket__count">${bucket.items.length}</span></h2>
      <div class="gal-grid">
        ${bucket.items.map(it => _cardHtml(it)).join('')}
      </div>
    </section>
  `;
}

function _cardHtml({ photo, context, filterKind, kindLabel, timestamp }) {
  let thumbSrc = '';
  if (photo.thumbBlob) {
    thumbSrc = getThumbURL(photo);
    _photoURLs.push(thumbSrc);
  }

  return `
    <div class="gal-card" data-photo-id="${_esc(photo.id)}">
      <div class="gal-card__thumb-wrap">
        <button
          type="button"
          class="gal-card__thumb-btn"
          data-action="gal-view-photo"
          data-photo-id="${_esc(photo.id)}"
          aria-label="View photo — ${_esc(context)}"
        >
          ${thumbSrc
            ? `<img src="${thumbSrc}" alt="" class="gal-card__img" />`
            : `<div class="gal-card__placeholder">${_iconImage(28)}</div>`}
        </button>
        <div class="gal-card__actions">
          <button
            type="button"
            class="gal-icon-btn gal-icon-btn--view"
            data-action="gal-view-photo"
            data-photo-id="${_esc(photo.id)}"
            data-tooltip="View photo"
            aria-label="View photo"
          >${_iconEye()}</button>
          <button
            type="button"
            class="gal-icon-btn gal-icon-btn--replace"
            data-action="gal-replace-photo"
            data-photo-id="${_esc(photo.id)}"
            data-tooltip="Replace photo"
            aria-label="Replace photo"
          >${_iconReplace()}</button>
          <button
            type="button"
            class="gal-icon-btn gal-icon-btn--delete"
            data-action="gal-delete-photo"
            data-photo-id="${_esc(photo.id)}"
            data-tooltip="Delete photo"
            aria-label="Delete photo"
          >${_iconTrash()}</button>
        </div>
      </div>
      <div class="gal-card__meta">
        <div class="gal-card__meta-top">
          <span class="badge gal-card__kind${filterKind === 'serial' ? ' gal-card__kind--serial' : ''}">${_esc(kindLabel)}</span>
          ${timestamp ? `<span class="gal-card__time">${_esc(timestamp)}</span>` : ''}
        </div>
        <p class="gal-card__context">${_esc(context)}</p>
      </div>
    </div>
  `;
}

/**
 * Full-screen preview lightbox for the photo currently in _previewPhotoId.
 * Backdrop + explicit close button both close it; a click anywhere inside
 * the panel does NOT close it (see the el.classList check in _handleClick).
 */
function _previewHtml() {
  const photo = _currentPhotos.find(p => p.id === _previewPhotoId);
  if (!photo) return '';

  const rows       = buildPhotoManifestRows(_currentProject, [photo]);
  const context    = _contextLabel(rows[0] || {});
  const filterKind = _filterKindOf(photo);
  const kindLabel  = KIND_LABELS[filterKind] || 'Photo';
  const timestamp  = _fmtTimestamp(photo.createdAt);

  let fullSrc = '';
  if (photo.blob) {
    fullSrc = URL.createObjectURL(photo.blob);
    _photoURLs.push(fullSrc);
  } else if (photo.thumbBlob) {
    fullSrc = getThumbURL(photo);
    _photoURLs.push(fullSrc);
  }

  return `
    <div class="gal-preview" data-action="gal-close-preview" role="dialog" aria-modal="true" aria-label="Photo preview">
      <div class="gal-preview__panel">
        <button
          type="button"
          class="gal-icon-btn gal-icon-btn--neutral gal-icon-btn--lg gal-preview__close"
          data-action="gal-close-preview"
          data-tooltip="Close"
          aria-label="Close preview"
        >${_iconClose()}</button>
        <div class="gal-preview__image-wrap">
          ${fullSrc
            ? `<img src="${fullSrc}" alt="" class="gal-preview__image" />`
            : `<div class="gal-preview__placeholder">${_iconImage(40)}</div>`}
        </div>
        <div class="gal-preview__meta">
          <div class="gal-preview__meta-top">
            <span class="badge gal-card__kind${filterKind === 'serial' ? ' gal-card__kind--serial' : ''}">${_esc(kindLabel)}</span>
            ${timestamp ? `<span class="gal-card__time">${_esc(timestamp)}</span>` : ''}
          </div>
          <p class="gal-preview__context">${_esc(context)}</p>
        </div>
        <div class="gal-preview__actions">
          <button
            type="button"
            class="gal-icon-btn gal-icon-btn--replace gal-icon-btn--lg"
            data-action="gal-replace-photo"
            data-photo-id="${_esc(photo.id)}"
            data-tooltip="Replace photo"
            aria-label="Replace photo"
          >${_iconReplace(18)}</button>
          <button
            type="button"
            class="gal-icon-btn gal-icon-btn--delete gal-icon-btn--lg"
            data-action="gal-delete-photo"
            data-photo-id="${_esc(photo.id)}"
            data-tooltip="Delete photo"
            aria-label="Delete photo"
          >${_iconTrash(18)}</button>
        </div>
      </div>
    </div>
  `;
}

function _revokePhotoURLs() {
  for (const url of _photoURLs) {
    try { URL.revokeObjectURL(url); } catch (_) { /* ignore */ }
  }
  _photoURLs = [];
}

// ============================================================================
// Icons (inline SVG only — no emoji buttons)
// ============================================================================

function _iconEye(size = 15) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z"/><circle cx="12" cy="12" r="3"/></svg>`;
}

function _iconReplace(size = 15) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 2l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>`;
}

function _iconTrash(size = 15) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`;
}

function _iconImage(size = 24) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>`;
}

function _iconClose() {
  return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
}

// ============================================================================
// Event handling
// ============================================================================

function _attachHandlers(rootEl) {
  if (rootEl.dataset.galHandlerAttached) return;
  rootEl.dataset.galHandlerAttached = '1';
  rootEl.addEventListener('click', _handleClick);
  rootEl.addEventListener('keydown', _handleKeydown);
}

function _handleKeydown(e) {
  if (e.key === 'Escape' && _previewPhotoId) {
    _previewPhotoId = null;
    _rerender();
  }
}

async function _handleClick(e) {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const action = el.dataset.action;

  if (action === 'gal-filter') {
    _activeFilter = el.dataset.filter || 'all';
    _rerender();
    return;
  }

  if (action === 'gal-view-photo') {
    const photoId = el.dataset.photoId;
    if (!photoId) return;
    _previewPhotoId = photoId;
    _rerender();
    return;
  }

  if (action === 'gal-close-preview') {
    // Only close on a click that lands exactly on the backdrop (or the close
    // button itself); a click bubbling up from inside the panel must NOT close it.
    if (el.classList.contains('gal-preview') && e.target !== el) return;
    _previewPhotoId = null;
    _rerender();
    return;
  }

  if (action === 'gal-replace-photo') {
    if (_busy) return;
    const photoId = el.dataset.photoId;
    if (!photoId) return;
    _triggerReplacePhoto(photoId);
    return;
  }

  if (action === 'gal-delete-photo') {
    if (_busy) return;
    const photoId = el.dataset.photoId;
    if (!photoId) return;

    const ok = await confirm({
      title: 'Delete Photo',
      message: 'This photo will be permanently deleted. This cannot be undone.',
      confirmText: 'Delete',
      danger: true,
    });
    if (!ok) return;

    _busy = true;
    try {
      await deletePhoto(photoId); // emits onPhotosChanged — walkthrough refreshes itself
      toast('Photo deleted.', { type: 'info' });
      if (_previewPhotoId === photoId) _previewPhotoId = null;
      await _refreshPhotos();
    } catch (err) {
      console.error('[gallery] delete error', err);
      toast(`Could not delete photo: ${err.message || err}`, { type: 'error' });
    } finally {
      _busy = false;
    }
  }
}

/**
 * Open a scoped hidden file input for a single photo and replace its image
 * content on selection. Mirrors photos.js's capturePhoto() hidden-input
 * pattern exactly (same accept/capture attrs, DOM-attach requirement for
 * Android, focus-based cancel detection) so behavior stays consistent with
 * normal photo capture.
 * @param {string} photoId
 */
function _triggerReplacePhoto(photoId) {
  const input = document.createElement('input');
  input.type   = 'file';
  input.accept = 'image/*';
  input.setAttribute('capture', 'environment');
  input.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0;pointer-events:none';

  document.body.appendChild(input);

  let settled = false;
  const cleanup = () => {
    try { document.body.removeChild(input); } catch (_) { /* already removed */ }
  };

  input.addEventListener('change', async () => {
    if (settled) return;
    settled = true;
    cleanup();

    const file = input.files && input.files[0];
    if (!file) return;

    _busy = true;
    try {
      await replacePhoto(photoId, file); // emits onPhotosChanged — walkthrough refreshes itself
      toast('Photo replaced.', { type: 'success' });
      await _refreshPhotos(); // gallery card + open preview both pick up the new image
    } catch (err) {
      console.error('[gallery] replace error', err);
      toast(`Could not replace photo: ${err.message || err}`, { type: 'error' });
    } finally {
      _busy = false;
    }
  });

  const onFocus = () => {
    setTimeout(() => {
      if (!settled) {
        settled = true;
        cleanup();
      }
      window.removeEventListener('focus', onFocus);
    }, 500);
  };
  window.addEventListener('focus', onFocus);

  input.click();
}

// ============================================================================
// Utility
// ============================================================================

function _esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
