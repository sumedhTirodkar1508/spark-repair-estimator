/**
 * js/ui/dashboard.js — Phase 4 (Agent A)
 * Project list view: create / rename / delete / switch.
 *
 * Named export: render(rootEl, params)
 * No default export. Vanilla ESM.
 */

import {
  listProjects,
  createProject,
  renameProject,
  deleteProject,
  getActiveProject,
} from '../state.js';

import { computeGrandTotal, formatMoney } from '../pricing.js';
import { showModal, showSheet, confirm, toast } from './components.js';
import { readBackupZip, importBackup, projectIdExists } from '../backup.js';

/* ------------------------------------------------------------------
 * Helpers
 * ------------------------------------------------------------------ */

function _fmtDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch (_) { return ''; }
}

/* ------------------------------------------------------------------
 * render(rootEl, params)
 * ------------------------------------------------------------------ */
export async function render(rootEl, params) {
  // Optimistic loading skeleton while data loads
  rootEl.innerHTML = `
    <header class="app-header">
      <img src="./assets/logo.png" alt="Spark" class="app-header__logo" />
      <span class="app-header__title">Spark Repair Estimator</span>
    </header>
    <div class="page-content">
      <div class="loading-state" style="min-height:40dvh">
        <p class="loading-text">Loading projects…</p>
      </div>
    </div>
  `;

  let projects;
  try {
    projects = await listProjects();
  } catch (err) {
    rootEl.innerHTML = `
      <header class="app-header">
        <img src="./assets/logo.png" alt="Spark" class="app-header__logo" />
        <span class="app-header__title">Spark Repair Estimator</span>
      </header>
      <div class="page-content">
        <div class="empty-state">
          <div class="empty-state__icon">⚠️</div>
          <p class="empty-state__title">Could not load projects</p>
          <p class="empty-state__desc">${String(err.message || err)}</p>
        </div>
      </div>
    `;
    return;
  }

  _renderDashboard(rootEl, projects);
}

function _renderDashboard(rootEl, projects) {
  const active = getActiveProject();

  const projectRows = projects.length > 0
    ? projects.map(p => _projectRowHtml(p, active)).join('')
    : `<div class="empty-state" style="min-height:30dvh">
         <div class="empty-state__icon">🏠</div>
         <p class="empty-state__title">No projects yet</p>
         <p class="empty-state__desc">Tap "+ New Project" to start your first walkthrough estimate.</p>
       </div>`;

  rootEl.innerHTML = `
    <header class="app-header">
      <img src="./assets/logo.png" alt="Spark" class="app-header__logo" />
      <span class="app-header__title">Spark Repair Estimator</span>
    </header>

    <div class="page-content" style="padding-top:var(--sp-6)">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--sp-4);gap:var(--sp-2)">
        <h1 style="font-size:var(--text-xl);font-weight:var(--weight-bold)">Projects</h1>
        <div style="display:flex;gap:var(--sp-2);flex-shrink:0">
          <label class="btn btn--secondary btn--sm" aria-label="Import backup">
            <span aria-hidden="true">⬆</span> Import Backup
            <input
              type="file"
              accept=".zip,application/zip"
              class="dash-import-input"
              aria-hidden="true"
              tabindex="-1"
              style="display:none"
            />
          </label>
          <button
            class="btn btn--primary btn--sm"
            data-action="dash-new-project"
            aria-label="Create new project"
          >+ New Project</button>
        </div>
      </div>

      <div class="card dash-project-list">
        ${projectRows}
      </div>
    </div>
  `;

  /* ---- delegated handlers inside this view (named fns = idempotent) ---- */
  rootEl.addEventListener('click', _dashClickHandler, { once: false });
  rootEl.addEventListener('change', _dashChangeHandler, { once: false });
}

function _projectRowHtml(p, active) {
  // We don't have globalPrices here — just show last-updated date.
  // Grand total requires loading the full project; that's too heavy for a list.
  const isActive = active && active.id === p.id;
  return `
    <div class="list-item dash-project-row" data-project-id="${p.id}" style="cursor:pointer;gap:var(--sp-3)">
      <div style="flex:1;min-width:0">
        <div style="font-weight:var(--weight-semibold);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
          ${_esc(p.name)}
          ${isActive ? '<span class="badge badge--work" style="margin-left:var(--sp-2)">Open</span>' : ''}
        </div>
        <div style="font-size:var(--text-xs);color:var(--color-text-muted);margin-top:2px">
          Updated ${_fmtDate(p.updatedAt)}
        </div>
      </div>
      <div style="display:flex;gap:var(--sp-2);flex-shrink:0">
        <button
          class="btn btn--ghost btn--sm dash-action-btn dash-action-btn--rename"
          data-action="dash-rename-project"
          data-project-id="${p.id}"
          data-project-name="${_esc(p.name)}"
          aria-label="Rename ${_esc(p.name)}"
          title="Rename"
        >✏️</button>
        <button
          class="btn btn--ghost btn--sm dash-action-btn dash-action-btn--delete"
          data-action="dash-delete-project"
          data-project-id="${p.id}"
          data-project-name="${_esc(p.name)}"
          aria-label="Delete ${_esc(p.name)}"
          title="Delete"
        >🗑</button>
      </div>
    </div>
  `;
}

async function _dashClickHandler(e) {
  // Walk up for data-action
  let el = e.target;
  while (el && el !== e.currentTarget) {
    const action = el.dataset.action;
    if (action) {
      e.stopPropagation();
      await _handleDashAction(action, el);
      return;
    }
    // Tapping the project row itself (not a button) → open it
    if (el.classList.contains('dash-project-row') && !e.target.closest('[data-action]')) {
      const pid = el.dataset.projectId;
      if (pid) {
        await _openProject(pid);
        return;
      }
    }
    el = el.parentElement;
  }
}

/* Handle the Import Backup file selection (change event on the hidden input). */
function _dashChangeHandler(e) {
  const input = e.target;
  if (input && input.classList && input.classList.contains('dash-import-input')) {
    const file = input.files && input.files[0];
    input.value = ''; // allow re-selecting the same file later
    if (file) _handleImportBackup(file);
  }
}

async function _handleImportBackup(file) {
  let parsed;
  try {
    parsed = await readBackupZip(file);
  } catch (err) {
    toast('Invalid backup: ' + (err.message || err), { type: 'error' });
    return;
  }
  try {
    let mode = 'copy';
    if (await projectIdExists(parsed.project.id)) {
      const choice = await showSheet({
        title: 'Project Already Exists',
        html: `<p style="margin:0 0 var(--sp-2)">A project from this backup already exists on this device. Import it as a separate copy, or replace the existing one?</p>`,
        actions: [
          { label: 'Import as Copy', value: 'copy', primary: true },
          { label: 'Replace Existing', value: 'replace', danger: true },
        ],
      });
      if (!choice) return; // cancelled
      mode = choice;
    }
    const newId = await importBackup(parsed, mode);
    toast('Backup imported', { type: 'success' });
    // Navigate only — walkthrough.render() switches the active project after the
    // route changes, avoiding the dashboard-clobber race documented in _openProject.
    window.location.hash = '#/project/' + newId;
  } catch (err) {
    toast('Import failed: ' + (err.message || err), { type: 'error' });
  }
}

async function _handleDashAction(action, el) {
  if (action === 'dash-new-project') {
    const name = await showModal({ title: 'New Project', placeholder: '123 Main St', confirmText: 'Create' });
    if (!name) return;
    try {
      const proj = await createProject(name);
      // Navigate into it
      window.location.hash = '#/project/' + proj.id;
    } catch (err) {
      toast('Could not create project: ' + err.message, { type: 'error' });
    }
    return;
  }

  if (action === 'dash-rename-project') {
    const id   = el.dataset.projectId;
    const name = el.dataset.projectName || '';
    const newName = await showModal({ title: 'Rename Project', placeholder: name, value: name, confirmText: 'Rename' });
    if (!newName) return;
    try {
      await renameProject(id, newName);
      toast('Renamed to "' + newName + '"', { type: 'success' });
      // Re-fetch and re-render
      const projects = await listProjects();
      const rootEl = document.getElementById('app');
      if (rootEl) _renderDashboard(rootEl, projects);
    } catch (err) {
      toast('Could not rename: ' + err.message, { type: 'error' });
    }
    return;
  }

  if (action === 'dash-delete-project') {
    const id   = el.dataset.projectId;
    const name = el.dataset.projectName || 'this project';
    const ok = await confirm({
      title: 'Delete Project',
      message: `Delete "${name}" and all its photos? This cannot be undone.`,
      confirmText: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteProject(id);
      toast('Project deleted', { type: 'info' });
      const projects = await listProjects();
      const rootEl = document.getElementById('app');
      if (rootEl) _renderDashboard(rootEl, projects);
    } catch (err) {
      toast('Could not delete: ' + err.message, { type: 'error' });
    }
    return;
  }
}

async function _openProject(pid) {
  // Don't switchProject here. switchProject emits a state change while the
  // current route is still "dashboard", which races the dashboard re-render
  // (from app.js's onChange) against the walkthrough render triggered by the
  // hash change — the dashboard render can finish last and clobber the
  // walkthrough, leaving the URL on #/project/<id> but the UI on the dashboard.
  // Instead, just navigate; walkthrough.render() switches the active project
  // AFTER handleRoute has set the route name to "project", so any emit during
  // the switch no longer re-renders the dashboard.
  window.location.hash = '#/project/' + pid;
}

/* HTML escape */
function _esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
