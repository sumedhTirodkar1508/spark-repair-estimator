/**
 * js/state.js
 * Active-project in-memory state + mutations + debounced persistence.
 *
 * Imports: db.js (IndexedDB ops), catalog.js (ROOM_TEMPLATES, GROUPS, CRITICAL_GROUP_KEYS,
 *          getGroupsForInstance).
 *
 * Rules:
 *   - No DOM, no network.
 *   - localStorage ONLY for "spark.activeProjectId".
 *   - No default export.
 *   - Every mutation: update memory → scheduleSave() → emit().
 */

import {
  openDB,
  getAllProjects,
  getProject,
  putProject,
  deleteProject  as dbDeleteProject,
  deletePhotosByProject,
  deletePhotosByItemId,
  deletePhotosByRoomInstance,
  getSetting,
  putSetting,
} from './db.js';

import {
  ROOM_TEMPLATES,
  GROUPS,
  CRITICAL_GROUP_KEYS,
  CATALOG_ITEMS,
} from './catalog.js';

import { computeGrandTotal } from './pricing.js';

// ---------------------------------------------------------------------------
// Module-level mutable state
// ---------------------------------------------------------------------------

/** @type {object|null} */
let activeProject = null;

/** @type {object} */
let globalPrices = {};

/** @type {Set<function>} */
const _subscribers = new Set();

/** @type {number|null}  setTimeout handle for debounced save */
let _saveTimer = null;

/**
 * The exact project object captured at the moment its save was scheduled.
 * The debounce timer always persists THIS reference, never whatever
 * `activeProject` happens to point to when the timer fires — so a project
 * switch that races a pending timer can never write to the wrong record.
 * @type {object|null}
 */
let _pendingSaveProject = null;

/** @type {Promise<void>|null}  most recently started persist Promise (in flight or settled) */
let _flushPromise = null;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Notify all subscribers synchronously. */
function emit() {
  for (const cb of _subscribers) {
    try { cb(); } catch (e) { console.error('[state] subscriber error', e); }
  }
}

/**
 * Persist a specific project object, chaining onto any save already in
 * flight so overlapping writes never race each other on the same store.
 * Tracks the resulting promise in _flushPromise for flushSave() to await.
 * @param {object} project
 * @returns {Promise<void>}
 */
function _persistProject(project) {
  if (!project) return Promise.resolve();
  const prior = _flushPromise || Promise.resolve();
  const p = prior
    .catch(() => {}) // a prior failure must not block this write
    .then(() => {
      project.updatedAt = new Date().toISOString();
      return putProject(project);
    })
    .catch(e => console.error('[state] persist error', e));
  _flushPromise = p;
  return p;
}

/** Cancel any pending debounced save without persisting it. */
function _cancelPendingSave() {
  if (_saveTimer !== null) clearTimeout(_saveTimer);
  _saveTimer = null;
  _pendingSaveProject = null;
}

/**
 * Debounced save: coalesces rapid calls into one write ~600 ms after the last call.
 * Captures the current activeProject reference at call time (not at fire time),
 * so a later reassignment of activeProject cannot redirect this write. If a
 * different project is already pending when called (edits to the previous
 * active project were never explicitly flushed), that pending save is flushed
 * immediately before the new debounce window starts, so no edits are lost.
 */
export function scheduleSave() {
  const project = activeProject;
  if (!project) return;

  if (_saveTimer !== null) {
    clearTimeout(_saveTimer);
    if (_pendingSaveProject && _pendingSaveProject !== project) {
      _persistProject(_pendingSaveProject);
    }
  }

  _pendingSaveProject = project;
  _saveTimer = setTimeout(() => {
    _saveTimer = null;
    const target = _pendingSaveProject;
    _pendingSaveProject = null;
    _persistProject(target);
  }, 600);
}

/**
 * Cancel any pending debounced save and immediately persist its target (the
 * project that was active when the save was scheduled — or the currently
 * active project if nothing is pending). Waits for any save already in
 * flight first, so writes never overlap. Should be called on
 * pagehide/visibilitychange, and before replacing the active project.
 * @returns {Promise<void>}
 */
export async function flushSave() {
  let target = null;
  if (_saveTimer !== null) {
    clearTimeout(_saveTimer);
    _saveTimer = null;
    target = _pendingSaveProject;
    _pendingSaveProject = null;
  }

  const project = target || activeProject;
  if (!project) return;
  await _persistProject(project);
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/**
 * Boot state: open DB, load globalPrices, restore active project (or create one).
 * Must be awaited before any mutation is called.
 * @returns {Promise<void>}
 */
export async function initState() {
  await openDB();

  // Load global price overrides from settings store. Normalize on load too,
  // in case overrides equal to the catalog default were persisted before
  // setGlobalPrices() started stripping them (defensive, one-time cleanup).
  globalPrices = _normalizeGlobalPrices((await getSetting('globalPrices')) || {});

  // Try to restore the previously active project
  const savedId = localStorage.getItem('spark.activeProjectId');
  let project   = savedId ? (await getProject(savedId)) : undefined;

  if (!project) {
    // Fall back to the most recently updated project
    const all = await getAllProjects();
    if (all.length > 0) {
      all.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
      project = all[0];
    }
  }

  if (!project) {
    // No projects at all — create the first one
    project = await createProject('My First Walkthrough');
    // createProject already sets activeProject + localStorage + emits
    return;
  }

  activeProject = project;
  localStorage.setItem('spark.activeProjectId', project.id);

  // Best-effort storage persistence (iOS/Android may silently ignore)
  try {
    if (navigator.storage && navigator.storage.persist) {
      navigator.storage.persist().catch(() => {});
    }
  } catch (_) { /* ignore */ }

  emit();
}

/**
 * Return the currently active project object (live reference).
 * @returns {object}
 */
export function getActiveProject() {
  return activeProject;
}

/**
 * Return the cached globalPrices object.
 * @returns {object}
 */
export function getGlobalPrices() {
  return globalPrices;
}

/**
 * Subscribe to state changes.
 * @param {function} callback
 * @returns {function} unsubscribe
 */
export function onChange(callback) {
  _subscribers.add(callback);
  return () => _subscribers.delete(callback);
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

/**
 * Return a summary list of all projects sorted by updatedAt desc.
 * @returns {Promise<Array<{id:string,name:string,updatedAt:string}>>}
 */
export async function listProjects() {
  const all = await getAllProjects();
  all.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  return all.map(p => ({ id: p.id, name: p.name, updatedAt: p.updatedAt }));
}

/**
 * Like listProjects(), but each entry also carries the repair-estimate total
 * (computed from the FULL project record + current globalPrices) and a cheap
 * selected-item count. Used by the dashboard so cards show the same total as
 * the walkthrough header. Photos are never loaded here.
 * @returns {Promise<Array<{id:string,name:string,updatedAt:string,total:number,selectedCount:number}>>}
 */
export async function listProjectsWithTotals() {
  const all = await getAllProjects();
  all.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  return all.map(p => {
    let total = 0;
    try { total = computeGrandTotal(p, globalPrices); } catch (_) { total = 0; }
    const selectedCount = p && p.selections
      ? Object.values(p.selections).filter(e => parseFloat(e && e.qty) > 0).length
      : 0;
    return { id: p.id, name: p.name, updatedAt: p.updatedAt, total, selectedCount };
  });
}

/**
 * Build a fresh project record seeded with 4 singletons + bath_1.
 * Persists it, makes it active, and emits.
 * @param {string} name
 * @returns {Promise<object>}
 */
export async function createProject(name) {
  // Persist any pending edits to the currently active project before it is
  // replaced — otherwise a debounced timer for the old project could later
  // fire and, under the old buggy behavior, target the wrong (new) project.
  await flushSave();

  const now = new Date().toISOString();
  const project = {
    id:              'proj_' + Date.now(),
    name,
    schemaVersion:   1,
    createdAt:       now,
    updatedAt:       now,
    rooms: [
      { instanceId: 'interior', roomType: 'interior-general', label: 'Interior / General', removable: false },
      { instanceId: 'kitchen',  roomType: 'kitchen',           label: 'Kitchen',            removable: false },
      { instanceId: 'systems',  roomType: 'systems',           label: 'Systems & Structure', removable: false },
      { instanceId: 'exterior', roomType: 'exterior',          label: 'Exterior',            removable: false },
      { instanceId: 'bath_1',   roomType: 'bathroom',          label: 'Bathroom 1',          removable: true  },
    ],
    selections:     {},
    serials:        {},
    groupStatus:    {},
    priceOverrides: {},
    customItems:    [],
    deletedItemIds: [],
    bulkMarkedGroups: [], // composite keys ("instanceId::groupKey") set by "Mark remaining"
    analyzer:       null,
  };

  await putProject(project);

  activeProject = project;
  localStorage.setItem('spark.activeProjectId', project.id);

  emit();
  return project;
}

/**
 * Flush current project, load another, and make it active.
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function switchProject(id) {
  await flushSave();
  const project = await getProject(id);
  if (!project) throw new Error(`switchProject: project "${id}" not found`);
  activeProject = project;
  localStorage.setItem('spark.activeProjectId', id);
  emit();
}

/**
 * Reload the active project record from IndexedDB, DISCARDING any pending
 * in-memory changes (and any debounced save). Use this after an out-of-band
 * write to the active project's record — e.g. restoring a backup into the
 * current project — so the stale in-memory copy is not flushed back over the
 * freshly-written record.
 *
 * Unlike switchProject(), this does NOT call flushSave() first.
 *
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function reloadActiveProject(id) {
  // Drop (do not flush) any pending debounced save for the now-stale
  // in-memory project — flushing it would overwrite the freshly-written
  // record we're about to load with stale data.
  _cancelPendingSave();
  const project = await getProject(id);
  if (!project) throw new Error(`reloadActiveProject: project "${id}" not found`);
  activeProject = project;
  localStorage.setItem('spark.activeProjectId', id);
  emit();
}

/**
 * Rename a project by id.
 * If it's the active project, mutate in memory and save; otherwise load/edit/putProject.
 * @param {string} id
 * @param {string} name
 * @returns {Promise<void>}
 */
export async function renameProject(id, name) {
  if (activeProject && activeProject.id === id) {
    activeProject.name      = name;
    activeProject.updatedAt = new Date().toISOString();
    await putProject(activeProject);
    emit();
  } else {
    const project = await getProject(id);
    if (!project) return;
    project.name      = name;
    project.updatedAt = new Date().toISOString();
    await putProject(project);
    // If this happens to be a background project, emit anyway so list views update
    emit();
  }
}

/**
 * Delete a project and all its photos.
 * If the deleted project is active, activate another or create a new one.
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function deleteProject(id) {
  // Settle any pending or already-in-flight save first. If `id` is the
  // active project, this legitimately persists its latest edits — but the
  // record is deleted right after, so nothing written here can survive.
  // (flushSave() chains onto an in-flight _persistProject via _flushPromise,
  // so this also waits out a save that had already started, not just a
  // pending debounce timer.)
  await flushSave();

  // Belt-and-braces: flushSave() already clears the pending debounce timer,
  // but make sure no pending target lingers for the project we're deleting.
  if (_pendingSaveProject && _pendingSaveProject.id === id) {
    _cancelPendingSave();
  }

  // Cascade delete photos first
  await deletePhotosByProject(id);
  await dbDeleteProject(id);

  if (activeProject && activeProject.id === id) {
    // Clear the active-project reference BEFORE activating/creating a
    // replacement — otherwise createProject()'s own flushSave() call could
    // write this now-deleted project back into IndexedDB.
    activeProject = null;
    localStorage.removeItem('spark.activeProjectId');

    // Pick a replacement
    const remaining = await getAllProjects();
    if (remaining.length > 0) {
      remaining.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
      activeProject = remaining[0];
      localStorage.setItem('spark.activeProjectId', activeProject.id);
      emit();
    } else {
      // No projects remain — create a fresh one. activeProject is already
      // null here, so createProject()'s internal flushSave() is a no-op.
      await createProject('My First Walkthrough');
      // createProject sets activeProject + emits
    }
  } else {
    // Deleted a background project; emit so list views update
    emit();
  }
}

/**
 * Reset the active project to a blank state, preserving only its id, name,
 * createdAt, and schemaVersion. Clears all selections, serials, groupStatus,
 * priceOverrides, customItems, deletedItemIds, bulkMarkedGroups, and analyzer.
 * Deletes all photos for this project from IndexedDB. Does NOT affect global
 * prices or other projects.
 * @returns {Promise<void>}
 */
export async function resetProject() {
  if (!activeProject) return;
  await deletePhotosByProject(activeProject.id);
  activeProject.rooms = [
    { instanceId: 'interior', roomType: 'interior-general', label: 'Interior / General', removable: false },
    { instanceId: 'kitchen',  roomType: 'kitchen',           label: 'Kitchen',            removable: false },
    { instanceId: 'systems',  roomType: 'systems',           label: 'Systems & Structure', removable: false },
    { instanceId: 'exterior', roomType: 'exterior',          label: 'Exterior',            removable: false },
    { instanceId: 'bath_1',   roomType: 'bathroom',          label: 'Bathroom 1',          removable: true  },
  ];
  activeProject.selections     = {};
  activeProject.serials        = {};
  activeProject.groupStatus    = {};
  activeProject.priceOverrides = {};
  activeProject.customItems    = [];
  activeProject.deletedItemIds = [];
  activeProject.bulkMarkedGroups = [];
  activeProject.analyzer       = null;
  activeProject.updatedAt      = new Date().toISOString();
  await putProject(activeProject);
  emit();
}

// ---------------------------------------------------------------------------
// Rooms — all operate on activeProject
// ---------------------------------------------------------------------------

/**
 * Add a new multi-instance room of the given roomType.
 * Numbering: max existing numeric suffix among same prefix + 1 (start at 1).
 * @param {string} roomType
 * @returns {string} instanceId
 */
export function addRoomInstance(roomType) {
  const template = ROOM_TEMPLATES[roomType];
  if (!template) throw new Error(`addRoomInstance: unknown roomType "${roomType}"`);

  const prefix = template.prefix;

  // Find the max numeric suffix already used for this prefix
  let maxN = 0;
  for (const room of activeProject.rooms) {
    if (room.instanceId.startsWith(prefix + '_')) {
      const n = parseInt(room.instanceId.slice(prefix.length + 1), 10);
      if (!isNaN(n) && n > maxN) maxN = n;
    }
  }
  const n          = maxN + 1;
  const instanceId = `${prefix}_${n}`;
  // Build a unique label: a user may have renamed another room to a higher
  // number, so keep incrementing until the label is free within this room type.
  const taken = new Set(
    activeProject.rooms
      .filter(r => r.roomType === roomType)
      .map(r => (r.label || '').trim().toLowerCase())
  );
  let labelN = n;
  let label = `${template.label} ${labelN}`;
  while (taken.has(label.trim().toLowerCase())) {
    labelN++;
    label = `${template.label} ${labelN}`;
  }

  activeProject.rooms.push({
    instanceId,
    roomType,
    label,
    removable: true,
  });

  scheduleSave();
  emit();
  return instanceId;
}

/**
 * Remove a room instance (only if removable).
 * Clears all selections/serials/groupStatus keys scoped to this instance.
 * Awaits deletion of every photo associated with this instance (single
 * IndexedDB transaction) before resolving, so callers never report success
 * while cleanup is still in flight — an immediate export or Gallery
 * navigation right after this resolves will never show the deleted room's
 * photos.
 * @param {string} instanceId
 * @returns {Promise<void>}
 */
export async function removeRoomInstance(instanceId) {
  const room = activeProject.rooms.find(r => r.instanceId === instanceId);
  if (!room) return;
  if (!room.removable) return;

  // Remove the room
  activeProject.rooms = activeProject.rooms.filter(r => r.instanceId !== instanceId);

  // Clear all composite keys prefixed with instanceId::
  const prefix = instanceId + '::';

  for (const key of Object.keys(activeProject.selections)) {
    if (key.startsWith(prefix)) delete activeProject.selections[key];
  }
  for (const key of Object.keys(activeProject.serials)) {
    if (key.startsWith(prefix)) delete activeProject.serials[key];
  }
  for (const key of Object.keys(activeProject.groupStatus)) {
    if (key.startsWith(prefix)) delete activeProject.groupStatus[key];
  }
  // Drop any bulk-mark tracking entries for this instance
  if (Array.isArray(activeProject.bulkMarkedGroups)) {
    activeProject.bulkMarkedGroups = activeProject.bulkMarkedGroups.filter(k => !k.startsWith(prefix));
  }

  scheduleSave();
  emit();

  await deletePhotosByRoomInstance(activeProject.id, instanceId);
}

/**
 * Rename a room instance label.
 * @param {string} instanceId
 * @param {string} label
 * @returns {void}
 */
export function renameRoomInstance(instanceId, label) {
  const trimmed = String(label || '').trim();
  if (!trimmed) throw new Error('Room name cannot be empty.');
  const room = activeProject.rooms.find(r => r.instanceId === instanceId);
  if (!room) return;
  // Reject duplicates within the same room type (case-insensitive). The room
  // keeping its own current name is allowed.
  const dup = activeProject.rooms.find(r =>
    r.instanceId !== instanceId &&
    r.roomType === room.roomType &&
    (r.label || '').trim().toLowerCase() === trimmed.toLowerCase()
  );
  if (dup) {
    throw new Error(`A ${room.roomType} room named "${trimmed}" already exists.`);
  }
  room.label = trimmed;
  scheduleSave();
  emit();
}

/**
 * Duplicate a room instance: creates a new instance of the same roomType
 * and copies all selections / serials / groupStatus (NOT photos).
 * @param {string} instanceId
 * @returns {string} newInstanceId
 */
export function duplicateRoomInstance(instanceId) {
  const sourceRoom = activeProject.rooms.find(r => r.instanceId === instanceId);
  if (!sourceRoom) throw new Error(`duplicateRoomInstance: instance "${instanceId}" not found`);

  // Add a new instance of the same type (handles numbering)
  const newInstanceId = addRoomInstance(sourceRoom.roomType);

  // Copy all composite keys for the source instance
  const srcPrefix = instanceId    + '::';
  const dstPrefix = newInstanceId + '::';

  for (const [key, val] of Object.entries(activeProject.selections)) {
    if (key.startsWith(srcPrefix)) {
      activeProject.selections[dstPrefix + key.slice(srcPrefix.length)] = { ...val };
    }
  }
  for (const [key, val] of Object.entries(activeProject.serials)) {
    if (key.startsWith(srcPrefix)) {
      activeProject.serials[dstPrefix + key.slice(srcPrefix.length)] = { ...val };
    }
  }
  for (const [key, val] of Object.entries(activeProject.groupStatus)) {
    if (key.startsWith(srcPrefix)) {
      activeProject.groupStatus[dstPrefix + key.slice(srcPrefix.length)] = val;
    }
  }

  // addRoomInstance already called scheduleSave + emit, but we need to re-emit
  // after copying data too.
  scheduleSave();
  emit();
  return newInstanceId;
}

// ---------------------------------------------------------------------------
// Items / Selections
// ---------------------------------------------------------------------------

/**
 * Toggle item selection. If selected, remove it; otherwise add {qty:"", note:""}.
 * When removing the last selection in a group and stored status is not "none",
 * effective status returns to "unreviewed" naturally (no stored key = unreviewed).
 * @param {string} instanceId
 * @param {string} itemId
 * @returns {void}
 */
export function toggleItem(instanceId, itemId) {
  const key = `${instanceId}::${itemId}`;
  if (activeProject.selections[key] !== undefined) {
    // Deselecting
    delete activeProject.selections[key];
    // If the group now has no selections and stored status was "work" (implicit),
    // removing the key is sufficient — effective status becomes "unreviewed" unless
    // stored groupStatus is "none", which we leave untouched.
  } else {
    // Selecting: if the group this item belongs to is currently stored as "none",
    // clear that stored "none" so the group transitions to "work" and won't snap
    // back to "No Work Needed" if the item is later deselected — selections
    // are the source of truth and always override stored group status.
    _clearStoredNoneForItem(instanceId, itemId);
    activeProject.selections[key] = { qty: '', note: '' };
  }
  scheduleSave();
  emit();
}

/**
 * Clear any stored "none" groupStatus for groups in this instance that contain
 * the given itemId (catalog or custom). Used when selecting an item so the
 * effective status cleanly becomes "work" instead of leaving a stale "none".
 * @param {string} instanceId
 * @param {string} itemId
 */
function _clearStoredNoneForItem(instanceId, itemId) {
  const prefix = instanceId + '::';
  const customItems = activeProject.customItems || [];
  for (const statusKey of Object.keys(activeProject.groupStatus)) {
    if (!statusKey.startsWith(prefix)) continue;
    if (activeProject.groupStatus[statusKey] !== 'none') continue;
    const gk = statusKey.slice(prefix.length);
    const group = GROUPS[gk];
    if (!group) continue;
    const belongs =
      group.itemIds.includes(itemId) ||
      customItems.some(ci => ci.groupKey === gk && ci.id === itemId);
    if (belongs) delete activeProject.groupStatus[statusKey];
  }
}

/**
 * Set quantity (as a string) for a selection, creating the entry if absent.
 * @param {string} instanceId
 * @param {string} itemId
 * @param {string} qty
 * @returns {void}
 */
export function setQty(instanceId, itemId, qty) {
  const key = `${instanceId}::${itemId}`;
  if (!activeProject.selections[key]) {
    activeProject.selections[key] = { qty: '', note: '' };
  }
  activeProject.selections[key].qty = qty;
  scheduleSave();
  emit();
}

/**
 * Set note for a selection, creating the entry if absent.
 * @param {string} instanceId
 * @param {string} itemId
 * @param {string} note
 * @returns {void}
 */
export function setNote(instanceId, itemId, note) {
  const key = `${instanceId}::${itemId}`;
  if (!activeProject.selections[key]) {
    activeProject.selections[key] = { qty: '', note: '' };
  }
  activeProject.selections[key].note = note;
  scheduleSave();
  emit();
}

/**
 * Set explicit group status.
 * status "unreviewed" → deletes the stored key (default).
 * status "none"       → stores "none"; also clears any selections in that group instance
 *                       (defence-in-depth: the UI confirms first, but we clear here too
 *                       in case this is called directly without going through that flow).
 * status "work"       → stores "work" (typically implicit from selections, but may be set
 *                       directly if the caller needs to).
 * @param {string} instanceId
 * @param {string} groupKey
 * @param {'unreviewed'|'none'|'work'} status
 * @returns {void}
 */
export function setGroupStatus(instanceId, groupKey, status) {
  const statusKey = `${instanceId}::${groupKey}`;

  // Any manual status change takes the group out of the "Mark remaining" bulk
  // tracking set so it is no longer eligible for the bulk reset (the user took
  // explicit control of this group).
  if (Array.isArray(activeProject.bulkMarkedGroups)) {
    activeProject.bulkMarkedGroups = activeProject.bulkMarkedGroups.filter(k => k !== statusKey);
  }

  if (status === 'unreviewed') {
    delete activeProject.groupStatus[statusKey];
  } else {
    activeProject.groupStatus[statusKey] = status;
  }

  if (status === 'none') {
    // Clear all selections in this group instance
    const group = GROUPS[groupKey];
    if (group) {
      for (const itemId of group.itemIds) {
        delete activeProject.selections[`${instanceId}::${itemId}`];
      }
      // Also clear custom items belonging to this group
      for (const ci of activeProject.customItems) {
        if (ci.groupKey === groupKey) {
          delete activeProject.selections[`${instanceId}::${ci.id}`];
        }
      }
    }
  }

  scheduleSave();
  emit();
}

/**
 * Merge serial metadata fields for an item selection.
 * Default shape: { serial:"", model:"", brand:"", year:"", notes:"" }.
 * @param {string} instanceId
 * @param {string} itemId
 * @param {object} fields
 * @returns {void}
 */
export function setSerialMeta(instanceId, itemId, fields) {
  const key = `${instanceId}::${itemId}`;
  const defaults = { serial: '', model: '', brand: '', year: '', notes: '' };
  activeProject.serials[key] = Object.assign(
    defaults,
    activeProject.serials[key] || {},
    fields
  );
  scheduleSave();
  emit();
}

// ---------------------------------------------------------------------------
// Prices — per-project overrides
// ---------------------------------------------------------------------------

/**
 * Set a per-project price override for an item.
 * @param {string} itemId
 * @param {number} cost
 * @returns {void}
 */
export function setItemPriceOverride(itemId, cost) {
  activeProject.priceOverrides[itemId] = Number(cost);
  scheduleSave();
  emit();
}

/**
 * Remove a per-project price override for an item.
 * @param {string} itemId
 * @returns {void}
 */
export function clearItemPriceOverride(itemId) {
  delete activeProject.priceOverrides[itemId];
  scheduleSave();
  emit();
}

// ---------------------------------------------------------------------------
// Global prices
// ---------------------------------------------------------------------------

/** Map of catalog item id -> defaultCost, used to normalize global overrides. */
const _catalogDefaultCost = new Map(CATALOG_ITEMS.map(item => [item.id, item.defaultCost]));

/**
 * A catalog price equal to its exact catalog default is not a real override.
 * Returns a NEW object with any such keys dropped. Unknown/custom ids (not
 * in the catalog) are left untouched — "equal to default" doesn't apply to
 * them. Legitimate zero-dollar overrides are preserved when the catalog
 * default is non-zero.
 * @param {object} obj  { itemId: cost }
 * @returns {object}
 */
function _normalizeGlobalPrices(obj) {
  const next = { ...(obj || {}) };
  for (const [id, val] of Object.entries(next)) {
    if (!_catalogDefaultCost.has(id)) continue;
    const num = Number(val);
    const def = _catalogDefaultCost.get(id);
    if (Number.isFinite(num) && Number.isFinite(def) && num === def) {
      delete next[id];
    }
  }
  return next;
}

/**
 * Replace the global price book.
 *
 * Normalizes at this single persistence boundary (see _normalizeGlobalPrices)
 * so "overridden" badges, the Reset button, and the Changed Only filter stay
 * consistent no matter which caller produced the value (manual edit, CSV
 * import, Reset All).
 *
 * @param {object} obj  { itemId: cost }
 * @returns {Promise<void>}
 */
export async function setGlobalPrices(obj) {
  const next = _normalizeGlobalPrices(obj);
  globalPrices = next;
  await putSetting('globalPrices', next);
  await putSetting('priceBookUpdatedAt', new Date().toISOString());
  emit();
}

// ---------------------------------------------------------------------------
// Custom items
// ---------------------------------------------------------------------------

/**
 * Add a custom item to the active project.
 * @param {{name:string, unit:string, defaultCost:number, groupKey:string}} param0
 * @returns {string} itemId
 */
export function addCustomItem({ name, unit, defaultCost, groupKey }) {
  const id = 'cust_' + Date.now();
  activeProject.customItems.push({ id, name, unit, defaultCost, groupKey });
  scheduleSave();
  emit();
  return id;
}

/**
 * Delete an item from the project — catalog or custom.
 * Removes every selection, serial-metadata entry, and price override scoped
 * to this item (composite keys ending in "::<itemId>"), so it stops
 * contributing to totals immediately regardless of prior selections. Custom
 * items are also removed from customItems; catalog items are added to
 * deletedItemIds (deduplicated) so they're hidden project-wide.
 *
 * Awaits item-scope photo cleanup (single IndexedDB transaction) before
 * resolving, so callers can safely report success only once cleanup is done.
 *
 * @param {string} itemId
 * @returns {Promise<void>}
 */
export async function deleteItem(itemId) {
  const suffix = '::' + itemId;

  for (const key of Object.keys(activeProject.selections)) {
    if (key.endsWith(suffix)) delete activeProject.selections[key];
  }
  for (const key of Object.keys(activeProject.serials)) {
    if (key.endsWith(suffix)) delete activeProject.serials[key];
  }
  delete activeProject.priceOverrides[itemId];

  if (itemId.startsWith('cust_')) {
    activeProject.customItems = activeProject.customItems.filter(ci => ci.id !== itemId);
  } else if (!activeProject.deletedItemIds.includes(itemId)) {
    activeProject.deletedItemIds.push(itemId);
  }

  scheduleSave();
  emit();

  await deletePhotosByItemId(activeProject.id, itemId);
}

/**
 * Restore a previously deleted catalog item in this project.
 * @param {string} itemId
 * @returns {void}
 */
export function restoreItem(itemId) {
  activeProject.deletedItemIds = activeProject.deletedItemIds.filter(id => id !== itemId);
  scheduleSave();
  emit();
}

// ---------------------------------------------------------------------------
// Analyzer
// ---------------------------------------------------------------------------

/**
 * Merge fields into the project's analyzer object.
 * @param {object} fields
 * @returns {void}
 */
export function setAnalyzer(fields) {
  activeProject.analyzer = Object.assign(activeProject.analyzer || {}, fields);
  scheduleSave();
  emit();
}

// ---------------------------------------------------------------------------
// Effective status helper
// ---------------------------------------------------------------------------

/**
 * Derive the effective group status for a group instance.
 *
 * Rules:
 *   1. If any selection exists for ANY item in this group instance → "work"
 *      (selections are the source of truth; overrides stored status).
 *   2. Else if stored groupStatus key is "none" → "none".
 *   3. Else → "unreviewed".
 *
 * @param {string} instanceId
 * @param {string} groupKey
 * @param {object} [project]  defaults to activeProject
 * @returns {'unreviewed'|'none'|'work'}
 */
export function getEffectiveStatus(instanceId, groupKey, project) {
  const proj  = project || activeProject;
  const group = GROUPS[groupKey];
  if (!group) return 'unreviewed';

  // Collect all item ids for this group: catalog + custom items
  const itemIds = [...group.itemIds];
  if (proj.customItems) {
    for (const ci of proj.customItems) {
      if (ci.groupKey === groupKey) itemIds.push(ci.id);
    }
  }

  // Rule 1: any selection → "work"
  const deletedSet = new Set(proj.deletedItemIds || []);
  for (const itemId of itemIds) {
    if (deletedSet.has(itemId)) continue;
    if (proj.selections[`${instanceId}::${itemId}`] !== undefined) {
      return 'work';
    }
  }

  // Rule 2: explicit "none"
  const stored = proj.groupStatus[`${instanceId}::${groupKey}`];
  if (stored === 'none') return 'none';

  // Rule 3: default
  return 'unreviewed';
}

// ---------------------------------------------------------------------------
// Guardrail bulk mutation
// ---------------------------------------------------------------------------

/**
 * Mark all non-critical group instances that are "unreviewed" as "none".
 *
 * Critical rules:
 *   - groupKey in CRITICAL_GROUP_KEYS is critical, EXCEPT:
 *   - "ba:tub" is critical ONLY when one of ba-10/ba-11/ba-12/ba-13 is selected
 *     in that instance (otherwise it's non-critical and may be swept).
 *
 * @returns {{ affected: number }}
 */
export function bulkMarkNonCriticalNone() {
  const BA_TUB_CONDITIONAL = ['ba-10', 'ba-11', 'ba-12', 'ba-13'];
  let affected = 0;

  for (const room of activeProject.rooms) {
    const { instanceId, roomType } = room;
    const template = ROOM_TEMPLATES[roomType];
    if (!template) continue;

    for (const groupKey of template.groupKeys) {
      // Determine if this group instance is critical
      let isCritical = CRITICAL_GROUP_KEYS.has(groupKey);

      if (groupKey === 'ba:tub' && isCritical) {
        // Conditional: only critical if one of the trigger items is selected
        const hasConditional = BA_TUB_CONDITIONAL.some(
          itemId => activeProject.selections[`${instanceId}::${itemId}`] !== undefined
        );
        isCritical = hasConditional;
      }

      if (isCritical) continue;

      // Only sweep instances that are currently "unreviewed"
      const effectiveStatus = getEffectiveStatus(instanceId, groupKey);
      if (effectiveStatus === 'unreviewed') {
        const composite = `${instanceId}::${groupKey}`;
        activeProject.groupStatus[composite] = 'none';
        // Record in bulk tracking so "Reset marked groups" can revert it later.
        if (!Array.isArray(activeProject.bulkMarkedGroups)) {
          activeProject.bulkMarkedGroups = [];
        }
        if (!activeProject.bulkMarkedGroups.includes(composite)) {
          activeProject.bulkMarkedGroups.push(composite);
        }
        affected++;
      }
    }
  }

  scheduleSave();
  emit();
  return { affected };
}

/**
 * Revert groups that were marked "none" by bulkMarkNonCriticalNone back to
 * "unreviewed". Only groups still in the bulk tracking set AND still effectively
 * "none" (no selected work items) are reset. Groups the user manually marked
 * No Work (never in the bulk set) and groups that now have work are left alone.
 * Critical groups are never in the bulk set, so they are never touched.
 *
 * @returns {{ reset: number }}
 */
export function resetBulkMarkedGroups() {
  const tracked = Array.isArray(activeProject.bulkMarkedGroups) ? activeProject.bulkMarkedGroups : [];
  let reset = 0;

  for (const composite of tracked) {
    const idx = composite.indexOf('::');
    if (idx === -1) continue;
    const instanceId = composite.slice(0, idx);
    const groupKey   = composite.slice(idx + 2);

    // Only reset if still "none" (i.e., no work items selected since the bulk mark).
    if (getEffectiveStatus(instanceId, groupKey) === 'none') {
      delete activeProject.groupStatus[composite];
      reset++;
    }
  }

  // Clear tracking regardless — any group no longer "none" has left the bulk set.
  activeProject.bulkMarkedGroups = [];

  scheduleSave();
  emit();
  return { reset };
}
