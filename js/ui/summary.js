/**
 * js/ui/summary.js
 * Pre-export summary: grouped cost breakdown, critical guardrail warnings,
 * export/backup/restore actions, and "Mark remaining as No Work Needed".
 *
 * Named export: render(rootEl, params)
 * No default export. Vanilla ESM.
 *
 * Event model:
 *   - Named delegated handler (_handleClick) on rootEl (idempotent).
 *   - data-action prefixed "sum-*".
 *   - onChange subscription to re-render (state changes from bulk-mark etc.).
 *   - Guard: only re-renders when not currently in an async operation.
 */

import {
  getActiveProject,
  getGlobalPrices,
  onChange,
  switchProject,
  reloadActiveProject,
  flushSave,
  bulkMarkNonCriticalNone,
  getEffectiveStatus,
} from '../state.js';

import {
  getGroupsForInstance,
  getItemsForGroup,
} from '../catalog.js';

import {
  buildEstimateRows,
  exportProjectZip,
} from '../export.js';

import {
  computeGrandTotal,
  formatMoney,
  formatUnitCost,
} from '../pricing.js';

import {
  getPhotos,
} from '../photos.js';

import {
  getCriticalWarnings,
  getNonCriticalUnreviewed,
} from '../guardrails.js';

import * as backup from '../backup.js';

import {
  confirm,
  toast,
  showSheet,
} from './components.js';

// ============================================================================
// Module-level state
// ============================================================================

/** onChange unsubscribe fn — stored so we don't double-subscribe */
let _unsubscribe = null;

/** Guard: prevents re-render while an async action is in flight */
let _busy = false;

// ============================================================================
// render
// ============================================================================

/**
 * Render the summary view into rootEl.
 *
 * @param {HTMLElement} rootEl
 * @param {{ id:string }} params - route params from hash router
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

  // Unsubscribe any previous listener, then subscribe for this render pass
  if (_unsubscribe) { _unsubscribe(); _unsubscribe = null; }

  // Attach delegated event handler (idempotent via custom attribute)
  if (!rootEl.dataset.sumHandlerAttached) {
    rootEl.dataset.sumHandlerAttached = '1';
    rootEl.addEventListener('click',  _handleClick);
    rootEl.addEventListener('change', _handleChange);
  }

  await _renderContent(rootEl);

  // Re-render on state changes (e.g. after bulk-mark-none).
  _unsubscribe = onChange(() => {
    // Only while Summary is the active route; otherwise self-clean so a state
    // change elsewhere never repaints Summary over another view.
    if (!window.location.hash.includes('/summary')) {
      if (_unsubscribe) { _unsubscribe(); _unsubscribe = null; }
      return;
    }
    if (!_busy) {
      _renderContent(rootEl).catch(err => console.error('[summary] re-render error', err));
    }
  });
}

// ============================================================================
// _renderContent — async; builds all HTML and injects it
// ============================================================================

async function _renderContent(rootEl) {
  const project      = getActiveProject();
  const globalPrices = getGlobalPrices();
  const projectId    = project ? project.id : '';

  // Build photosByRefKey map for guardrails; also keep allPhotos for completeness stats
  let photosByRefKey = {};
  let allPhotos = [];
  if (project) {
    try {
      allPhotos = await getPhotos(project.id);
      for (const ph of allPhotos) {
        const rk = ph.refKey || '';
        if (!photosByRefKey[rk]) {
          photosByRefKey[rk] = { serialCount: 0, generalCount: 0, total: 0 };
        }
        photosByRefKey[rk].total++;
        if (ph.kind === 'serial')  photosByRefKey[rk].serialCount++;
        if (ph.kind === 'general') photosByRefKey[rk].generalCount++;
      }
    } catch (err) {
      console.warn('[summary] could not load photos for guardrails', err);
    }
  }

  // Build data
  const sections    = project ? buildEstimateRows(project, globalPrices) : [];
  const grandTotal  = project ? computeGrandTotal(project, globalPrices) : 0;
  const warnings    = project ? getCriticalWarnings(project, photosByRefKey, globalPrices) : [];
  const nonCritLen  = project ? getNonCriticalUnreviewed(project).length : 0;
  const completeness = project ? _computeCompleteness(project, allPhotos, warnings) : null;

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
        <span class="app-header__title">Review &amp; Export</span>
      </header>
    </div>

    <div class="page-content sum-page">

      ${project ? '' : `
        <div class="empty-state" style="min-height:40dvh">
          <p class="empty-state__title">No active project</p>
          <a href="#/" class="btn btn--primary" style="margin-top:var(--sp-4)">Go to Projects</a>
        </div>
      `}

      ${project && completeness ? _renderCompleteness(completeness) : ''}

      ${project ? `
        <!-- ── Guardrail Warnings ───────────────────────────────────────── -->
        <section class="sum-section">
          <h2 class="sum-section__title">Critical Category Check</h2>
          ${_renderWarnings(warnings)}
        </section>

        <!-- ── Estimate Breakdown ───────────────────────────────────────── -->
        <section class="sum-section">
          <h2 class="sum-section__title">Estimate Breakdown</h2>
          ${_renderBreakdown(sections, grandTotal)}
        </section>

        <!-- ── Primary Actions ──────────────────────────────────────────── -->
        <section class="sum-section">
          <h2 class="sum-section__title">Actions</h2>
          <div class="sum-actions">
            <button class="btn btn--primary sum-btn" data-action="sum-export-zip">
              Export ZIP (Excel + Photos)
            </button>
            <a href="#/project/${_esc(projectId)}/analyzer" class="btn btn--secondary sum-btn">
              Open Deal Analyzer
            </a>
            <a href="#/project/${_esc(projectId)}/gallery" class="btn btn--secondary sum-btn">
              Photo Gallery
            </a>
            ${nonCritLen > 0 ? `
              <button class="btn btn--ghost sum-btn" data-action="sum-bulk-none">
                Mark ${nonCritLen} Non-Critical as No Work Needed
              </button>
            ` : ''}
          </div>
        </section>

        <!-- ── Backup / Restore ─────────────────────────────────────────── -->
        <section class="sum-section">
          <h2 class="sum-section__title">Backup &amp; Restore</h2>
          <div class="sum-actions">
            <button class="btn btn--ghost sum-btn" data-action="sum-export-backup">
              Export Backup (.zip)
            </button>
            <label class="btn btn--ghost sum-btn sum-btn--file">
              Restore from Backup
              <input
                type="file"
                accept=".zip"
                data-action="sum-restore-file"
                style="position:absolute;width:1px;height:1px;opacity:0;pointer-events:none"
              />
            </label>
          </div>
          <p class="sum-note">
            Backup includes all project data and photos. Restore lets you "Replace Current Project"
            (overwrite this project) or "Import as Copy" (create a new project).
          </p>
        </section>
      ` : ''}

    </div>
  `;
}

// ============================================================================
// _computeCompleteness / _renderCompleteness
// ============================================================================

function _computeCompleteness(project, photos, warnings) {
  let totalGroups = 0, reviewedGroups = 0, noWorkGroups = 0, selectedItems = 0;
  const selections = project.selections || {};

  for (const room of (project.rooms || [])) {
    const groups = getGroupsForInstance(room.instanceId, room.roomType);
    for (const grp of groups) {
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

  return {
    totalGroups,
    reviewedGroups,
    noWorkGroups,
    selectedItems,
    photoCount:    photos.length,
    serialPhotos:  photos.filter(p => p.kind === 'serial').length,
    criticalCount: warnings.length,
  };
}

function _renderCompleteness(c) {
  const ok = c.criticalCount === 0;
  const parts = [
    `${c.reviewedGroups}/${c.totalGroups} groups reviewed`,
    `${c.selectedItems} work item${c.selectedItems !== 1 ? 's' : ''}`,
    ok
      ? 'no critical warnings'
      : `${c.criticalCount} critical warning${c.criticalCount !== 1 ? 's' : ''}`,
    `${c.photoCount} photo${c.photoCount !== 1 ? 's' : ''}`,
  ];
  return `
    <div class="sum-completeness sum-completeness--${ok ? 'ok' : 'warn'}">
      ${parts.map(p => `<span class="sum-completeness__chip">${p}</span>`).join('<span class="sum-completeness__sep">·</span>')}
    </div>`;
}

// ============================================================================
// _renderWarnings
// ============================================================================

function _renderWarnings(warnings) {
  if (warnings.length === 0) {
    return `
      <div class="sum-warnings sum-warnings--ok">
        <span class="sum-warnings__icon">✓</span>
        All critical categories reviewed — ready to export.
      </div>`;
  }

  const rows = warnings.map(w => `
    <div class="sum-warning sum-warning--${_warnClass(w.type)}">
      <span class="sum-warning__icon sum-warning__icon--${_warnClass(w.type)}" aria-hidden="true"></span>
      <span class="sum-warning__msg">${_esc(w.message)}</span>
    </div>
  `).join('');

  return `
    <div class="sum-warnings sum-warnings--has-issues">
      <p class="sum-warnings__note">
        ${warnings.length} issue${warnings.length > 1 ? 's' : ''} found — review before exporting (export is still allowed).
      </p>
      ${rows}
    </div>`;
}

function _warnClass(type) {
  if (type === 'critical-unreviewed') return 'red';
  if (type === 'critical-missing-qty') return 'orange';
  return 'orange';
}

// ============================================================================
// _renderBreakdown
// ============================================================================

function _renderBreakdown(sections, grandTotal) {
  if (sections.length === 0) {
    return `
      <div class="sum-empty">
        No items selected yet. Go back to the walkthrough to add repair items.
      </div>`;
  }

  const rows = sections.map(sec => `
    <div class="sum-instance">
      <div class="sum-instance__header">
        <span class="sum-instance__label">${_esc(sec.instanceLabel)}</span>
        <span class="sum-instance__total">${formatMoney(sec.instanceTotal)}</span>
      </div>
      ${sec.groups.map(grp => `
        <div class="sum-group">
          <div class="sum-group__header">
            <span class="sum-group__label">${_esc(grp.groupLabel)}</span>
            <span class="sum-group__total">${formatMoney(grp.groupTotal)}</span>
          </div>
          ${grp.items.map(it => `
            <div class="sum-item">
              <span class="sum-item__name">${_esc(it.name)}</span>
              <span class="sum-item__meta">${it.qty} ${_esc(it.unit)} × ${formatUnitCost(it.unitCost)}</span>
              <span class="sum-item__total">${formatMoney(it.lineTotal)}</span>
            </div>
          `).join('')}
        </div>
      `).join('')}
    </div>
  `).join('');

  return `
    <div class="sum-breakdown">
      ${rows}
      <div class="sum-grand-total">
        <span class="sum-grand-total__label">GRAND TOTAL</span>
        <span class="sum-grand-total__value">${formatMoney(grandTotal)}</span>
      </div>
    </div>`;
}

// ============================================================================
// Event handlers (delegated on rootEl)
// ============================================================================

async function _handleClick(e) {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;

  if (action === 'sum-export-zip') {
    await _doExportZip();
  } else if (action === 'sum-export-backup') {
    await _doExportBackup();
  } else if (action === 'sum-bulk-none') {
    await _doBulkNone();
  }
}

async function _handleChange(e) {
  const input = e.target.closest('[data-action="sum-restore-file"]');
  if (!input) return;
  const file = input.files && input.files[0];
  if (!file) return;
  // Reset so the same file can be re-selected later
  input.value = '';
  await _doRestore(file);
}

// ── Export ZIP ───────────────────────────────────────────────────────────────

async function _doExportZip() {
  if (_busy) return;
  _busy = true;
  try {
    const project      = getActiveProject();
    const globalPrices = getGlobalPrices();
    await exportProjectZip(project, globalPrices);
    toast('Export ZIP downloaded.', { type: 'success' });
  } catch (err) {
    console.error('[summary] exportProjectZip error', err);
    toast(`Export failed: ${err.message || err}`, { type: 'error' });
  } finally {
    _busy = false;
  }
}

// ── Export Backup ────────────────────────────────────────────────────────────

async function _doExportBackup() {
  if (_busy) return;
  _busy = true;
  try {
    const project = getActiveProject();
    await backup.exportBackupZip(project.id);
    toast('Backup downloaded.', { type: 'success' });
  } catch (err) {
    console.error('[summary] exportBackupZip error', err);
    toast(`Backup failed: ${err.message || err}`, { type: 'error' });
  } finally {
    _busy = false;
  }
}

// ── Bulk Mark None ───────────────────────────────────────────────────────────

async function _doBulkNone() {
  if (_busy) return;
  const project  = getActiveProject();
  const nonCrit  = getNonCriticalUnreviewed(project);
  if (nonCrit.length === 0) return;

  const ok = await confirm({
    title:       'Mark as No Work Needed',
    message:     `Mark ${nonCrit.length} unreviewed non-critical group${nonCrit.length > 1 ? 's' : ''} as "No Work Needed"?`,
    confirmText: 'Mark All',
    danger:      false,
  });
  if (!ok) return;

  _busy = true;
  try {
    const result = bulkMarkNonCriticalNone();
    toast(`Marked ${result.affected} group${result.affected !== 1 ? 's' : ''} as No Work Needed.`, { type: 'success' });
  } finally {
    _busy = false;
  }
}

// ── Restore from Backup ──────────────────────────────────────────────────────

async function _doRestore(file) {
  if (_busy) return;
  _busy = true;
  try {
    // Parse the zip
    let parsed;
    try {
      parsed = await backup.readBackupZip(file);
    } catch (err) {
      toast(`Could not read backup: ${err.message || err}`, { type: 'error' });
      return;
    }

    const current = getActiveProject();
    if (!current) {
      toast('No active project to restore into.', { type: 'error' });
      return;
    }

    const backupName = (parsed.project && parsed.project.name) || 'this backup';

    // We are restoring while inside a current project, so ALWAYS ask — even if
    // the backup's project id does not already exist. This prevents silently
    // creating a duplicate-named project.
    const choice = await showSheet({
      title: 'Restore from Backup',
      html: `<p style="color:var(--color-text-2);font-size:var(--text-sm);margin:0 0 var(--sp-4)">
        Restoring "<strong>${_esc(backupName)}</strong>". How would you like to import it?
      </p>`,
      actions: [
        { label: 'Replace Current Project', value: 'replace-current', danger: true },
        { label: 'Import as Copy',          value: 'copy',            danger: false },
        { label: 'Cancel',                  value: null,              danger: false },
      ],
    });
    if (!choice) return;

    if (choice === 'replace-current') {
      const confirmed = await confirm({
        title:       'Replace Current Project',
        message:     `This will overwrite "${current.name}" and all its data with the backup. This cannot be undone.`,
        confirmText: 'Replace',
        danger:      true,
      });
      if (!confirmed) return;

      // Settle any pending or already-in-flight save for the current project
      // BEFORE the atomic restore transaction runs — otherwise that older
      // save could resolve afterward and overwrite the freshly-restored
      // record. reloadActiveProject() only cancels a pending debounce timer;
      // it cannot cancel a save promise that has already started.
      await flushSave();

      // Replace the CURRENT project record in place (keeps the same id so the
      // route stays valid), then reload the active project WITHOUT flushing the
      // stale in-memory copy back over the freshly-restored record.
      await backup.importBackup(parsed, {
        mode: 'replace-current',
        targetProjectId: current.id,
        targetProjectName: current.name,
        targetProjectCreatedAt: current.createdAt,
      });
      await reloadActiveProject(current.id);
      window.location.hash = `#/project/${current.id}`;
      toast('Backup restored into current project.', { type: 'success' });
    } else {
      // Settle the current project's save chain before switching away, so
      // its latest edits are fully persisted rather than possibly racing
      // with the project switch below.
      await flushSave();

      // Import as a brand-new project with a unique name.
      const newId = await backup.importBackup(parsed, { mode: 'copy' });
      await switchProject(newId);
      window.location.hash = `#/project/${newId}`;
      toast('Backup imported as a copy.', { type: 'success' });
    }
  } catch (err) {
    console.error('[summary] restore error', err);
    toast(`Restore failed: ${err.message || err}`, { type: 'error' });
  } finally {
    _busy = false;
  }
}

// ============================================================================
// Utility
// ============================================================================

/**
 * Escape HTML special characters to prevent XSS.
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
