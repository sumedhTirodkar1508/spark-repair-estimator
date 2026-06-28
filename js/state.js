/**
 * js/state.js — Phase 2
 * Owner: F3 agent
 * Active-project in-memory state + mutations + debounced persistence.
 *
 * Imports: db.js (IndexedDB ops), catalog.js (ROOM_TEMPLATES, GROUPS, CRITICAL_GROUP_KEYS,
 *          getGroupsForInstance).
 *
 * Named exports match frozen contract §22 exactly.
 * Additional export: getEffectiveStatus (additive, allowed per contract).
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
  getPhotosByProject,
  deletePhoto,
  deletePhotosByProject,
  getSetting,
  putSetting,
} from './db.js';

import {
  ROOM_TEMPLATES,
  GROUPS,
  CRITICAL_GROUP_KEYS,
} from './catalog.js';

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

/** @type {Promise<void>|null}  in-flight putProject promise from flushSave */
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
 * Debounced save: coalesces rapid calls into one write ~600 ms after the last call.
 * Sets activeProject.updatedAt before writing.
 */
export function scheduleSave() {
  if (_saveTimer !== null) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    _saveTimer = null;
    if (!activeProject) return;
    activeProject.updatedAt = new Date().toISOString();
    putProject(activeProject).catch(e => console.error('[state] scheduleSave error', e));
  }, 600);
}

/**
 * Cancel any pending debounced save and immediately persist.
 * Should be called on pagehide/visibilitychange.
 * @returns {Promise<void>}
 */
export async function flushSave() {
  if (_saveTimer !== null) {
    clearTimeout(_saveTimer);
    _saveTimer = null;
  }
  if (!activeProject) return;
  activeProject.updatedAt = new Date().toISOString();
  _flushPromise = putProject(activeProject);
  await _flushPromise;
  _flushPromise = null;
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

  // Load global price overrides from settings store
  globalPrices = (await getSetting('globalPrices')) || {};

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
 * Build a fresh project record seeded with 4 singletons + bath_1.
 * Persists it, makes it active, and emits.
 * @param {string} name
 * @returns {Promise<object>}
 */
export async function createProject(name) {
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
  // Cascade delete photos first
  await deletePhotosByProject(id);
  await dbDeleteProject(id);

  if (activeProject && activeProject.id === id) {
    // Pick a replacement
    const remaining = await getAllProjects();
    if (remaining.length > 0) {
      remaining.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
      activeProject = remaining[0];
      localStorage.setItem('spark.activeProjectId', activeProject.id);
      emit();
    } else {
      // No projects remain — create a fresh one
      await createProject('My First Walkthrough');
      // createProject sets activeProject + emits
    }
  } else {
    // Deleted a background project; emit so list views update
    emit();
  }
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
 * Deletes any photos associated with this instance.
 * @param {string} instanceId
 * @returns {void}
 */
export function removeRoomInstance(instanceId) {
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

  // Delete photos associated with this instance asynchronously (fire and forget,
  // then scheduleSave will run after). We query by project and filter by refKey prefix.
  getPhotosByProject(activeProject.id).then(photos => {
    const promises = [];
    for (const ph of photos) {
      // Photos are associated by refKey: "instanceId::..." or scope=="room" refKey===instanceId
      if (
        ph.refKey === instanceId ||
        (typeof ph.refKey === 'string' && ph.refKey.startsWith(instanceId + '::'))
      ) {
        promises.push(deletePhoto(ph.id));
      }
    }
    return Promise.all(promises);
  }).catch(e => console.error('[state] removeRoomInstance photo cleanup error', e));

  scheduleSave();
  emit();
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
    // back to "No Work Needed" if the item is later deselected (contract §10:
    // selections are the source of truth and override stored status).
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
 *                       (defence-in-depth: UI confirms first per §29, but we clear here too).
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

/**
 * Replace the global price book.
 * Persists both the price map and a timestamp to IndexedDB settings.
 * @param {object} obj  { itemId: cost }
 * @returns {Promise<void>}
 */
export async function setGlobalPrices(obj) {
  globalPrices = obj;
  await putSetting('globalPrices', obj);
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
 * Delete an item from the project.
 * - Custom item (id starts with "cust_"): removes from customItems + clears any
 *   selections/overrides for it.
 * - Catalog item: pushes to deletedItemIds (deduplicated).
 * @param {string} itemId
 * @returns {void}
 */
export function deleteItem(itemId) {
  if (itemId.startsWith('cust_')) {
    // Remove from customItems
    activeProject.customItems = activeProject.customItems.filter(ci => ci.id !== itemId);
    // Clear any selections for this custom item across all instances
    for (const key of Object.keys(activeProject.selections)) {
      if (key.endsWith('::' + itemId)) delete activeProject.selections[key];
    }
    // Clear any price override
    delete activeProject.priceOverrides[itemId];
  } else {
    // Catalog item → hide in this project
    if (!activeProject.deletedItemIds.includes(itemId)) {
      activeProject.deletedItemIds.push(itemId);
    }
  }
  scheduleSave();
  emit();
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
// Effective status helper (additive export — §10, not in original 28 but allowed)
// ---------------------------------------------------------------------------

/**
 * Derive the effective group status for a group instance.
 *
 * Rules (contract §10):
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
 * Critical rules (contract §31):
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
