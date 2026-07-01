/**
 * js/guardrails.js — Phase 7 (Agent E)
 * Critical-group detection + pre-export warning generation.
 *
 * Named exports (frozen contract §24):
 *   isCriticalGroup(groupKey, instanceId, project) -> boolean
 *   getCriticalWarnings(project, photosByRefKey, globalPrices) -> Warning[]
 *   getNonCriticalUnreviewed(project) -> [{instanceId, groupKey}]
 *
 * Rules:
 *   - No DOM, no IndexedDB. Returns data; performs no mutations.
 *   - photosByRefKey is built by the caller (summary.js), NOT here.
 *   - Calls state.getEffectiveStatus for group status resolution.
 */

import { CRITICAL_GROUP_KEYS, ROOM_TEMPLATES, GROUPS, CATALOG_ITEMS } from './catalog.js';
import { getEffectiveStatus } from './state.js';

// Items whose presence makes ba:tub a critical group (§24, §31)
const _BA_TUB_TRIGGERS = new Set(['ba-10', 'ba-11', 'ba-12', 'ba-13']);

// Groups that require serial photos for their selected items (§24)
const _SERIAL_PHOTO_GROUPS = new Set(['as:hvac', 'as:waterheater']);

// Pre-build a catalog name lookup map (id -> name) for warning messages
const _catalogNameMap = new Map(CATALOG_ITEMS.map(item => [item.id, item.name]));

// ============================================================================
// isCriticalGroup
// ============================================================================

/**
 * Determine whether a specific group instance is critical.
 *
 * ba:tub is critical ONLY when one of ba-10/ba-11/ba-12/ba-13 is selected in
 * that instance. All other CRITICAL_GROUP_KEYS are unconditionally critical.
 *
 * @param {string} groupKey
 * @param {string} instanceId
 * @param {object} project
 * @returns {boolean}
 */
export function isCriticalGroup(groupKey, instanceId, project) {
  if (!CRITICAL_GROUP_KEYS.has(groupKey)) return false;

  if (groupKey === 'ba:tub') {
    // Conditional: critical only when a tear-out/replacement item is selected
    const selections = (project && project.selections) ? project.selections : {};
    for (const triggerId of _BA_TUB_TRIGGERS) {
      if (selections[`${instanceId}::${triggerId}`] !== undefined) {
        return true;
      }
    }
    return false;
  }

  return true;
}

// ============================================================================
// getCriticalWarnings
// ============================================================================

/**
 * Generate all pre-export warnings for a project.
 *
 * Warning types (§24):
 *   critical-unreviewed     — critical group instance still "unreviewed"
 *   critical-missing-qty    — selected item in critical group with qty ≤ 0
 *   serial-photo-missing    — selected HVAC/water-heater item with no serial photo
 *   roof-photo-missing      — as-16 selected with no roof-specific OR exterior general photos
 *
 * @param {object} project
 * @param {Object<string,{serialCount:number,generalCount:number,total:number}>} photosByRefKey
 * @param {object} globalPrices  - passed through; not used directly in warnings
 * @returns {Array<{type:string,instanceId:string,groupKey:string,itemId?:string,message:string}>}
 */
export function getCriticalWarnings(project, photosByRefKey, globalPrices) {
  const warnings = [];
  const selections = (project && project.selections) ? project.selections : {};
  const photos = photosByRefKey || {};
  const deletedSet = new Set(project.deletedItemIds || []);

  for (const room of (project.rooms || [])) {
    const { instanceId, roomType } = room;
    const template = ROOM_TEMPLATES[roomType];
    if (!template) continue;

    for (const groupKey of template.groupKeys) {
      if (!isCriticalGroup(groupKey, instanceId, project)) continue;

      const effectiveStatus = getEffectiveStatus(instanceId, groupKey, project);

      // ── critical-unreviewed ────────────────────────────────────────────────
      if (effectiveStatus === 'unreviewed') {
        warnings.push({
          type: 'critical-unreviewed',
          instanceId,
          groupKey,
          message: `Critical category "${_roomGroupLabel(room, instanceId, groupKey)}" has not been reviewed.`,
        });
      }

      // Get items in this group for qty + photo checks
      const group = GROUPS[groupKey];
      if (!group) continue;

      const itemIds = [
        ...group.itemIds,
        ...((project.customItems || [])
          .filter(ci => ci.groupKey === groupKey)
          .map(ci => ci.id)),
      ];

      for (const itemId of itemIds) {
        if (deletedSet.has(itemId)) continue;
        const selKey = `${instanceId}::${itemId}`;
        const entry = selections[selKey];
        if (entry === undefined) continue; // not selected

        // ── critical-missing-qty ─────────────────────────────────────────────
        const qty = parseFloat(entry.qty);
        if (!(qty > 0)) {
          warnings.push({
            type: 'critical-missing-qty',
            instanceId,
            groupKey,
            itemId,
            message: `"${_itemName(itemId, project)}" in "${_roomGroupLabel(room, instanceId, groupKey)}" is selected but has no quantity.`,
          });
        }

        // ── serial-photo-missing ─────────────────────────────────────────────
        if (_SERIAL_PHOTO_GROUPS.has(groupKey)) {
          const refKey = `${instanceId}::${itemId}`;
          const photoInfo = photos[refKey];
          const serialCount = (photoInfo && photoInfo.serialCount) ? photoInfo.serialCount : 0;
          if (serialCount === 0) {
            warnings.push({
              type: 'serial-photo-missing',
              instanceId,
              groupKey,
              itemId,
              message: `Serial/model photo required for "${_itemName(itemId, project)}" in "${_roomGroupLabel(room, instanceId, groupKey)}".`,
            });
          }
        }

        // ── roof-photo-missing ───────────────────────────────────────────────
        // Rule (§24): as-16 selected with zero photos at refKey "systems::as-16"
        // AND zero kind:general photos on the "exterior" instance.
        if (groupKey === 'as:roof' && itemId === 'as-16') {
          const roofRefKey    = 'systems::as-16';
          const roofPhotoInfo = photos[roofRefKey];
          const roofTotal     = (roofPhotoInfo && roofPhotoInfo.total) ? roofPhotoInfo.total : 0;

          // Count any general photos scoped to the exterior instance
          let exteriorGeneralCount = 0;
          for (const [rk, info] of Object.entries(photos)) {
            if (
              (rk === 'exterior' || rk.startsWith('exterior::')) &&
              info.generalCount > 0
            ) {
              exteriorGeneralCount += info.generalCount;
            }
          }

          if (roofTotal === 0 && exteriorGeneralCount === 0) {
            warnings.push({
              type: 'roof-photo-missing',
              instanceId,
              groupKey,
              itemId: 'as-16',
              message: 'Roof is selected but no photos were attached — add at least one roof or exterior photo.',
            });
          }
        }
      }
    }
  }

  return warnings;
}

// ============================================================================
// getNonCriticalUnreviewed
// ============================================================================

/**
 * Return all non-critical group instances that are currently "unreviewed".
 * Used by summary.js to power "Mark remaining as No Work Needed".
 *
 * @param {object} project
 * @returns {Array<{instanceId:string,groupKey:string}>}
 */
export function getNonCriticalUnreviewed(project) {
  const result = [];

  for (const room of (project.rooms || [])) {
    const { instanceId, roomType } = room;
    const template = ROOM_TEMPLATES[roomType];
    if (!template) continue;

    for (const groupKey of template.groupKeys) {
      // Skip critical groups (respects ba:tub conditional)
      if (isCriticalGroup(groupKey, instanceId, project)) continue;

      const status = getEffectiveStatus(instanceId, groupKey, project);
      if (status === 'unreviewed') {
        result.push({ instanceId, groupKey });
      }
    }
  }

  return result;
}

// ============================================================================
// Internal helpers
// ============================================================================

/**
 * Human-readable label for a groupKey.
 * @param {string} groupKey
 * @returns {string}
 */
function _groupLabel(groupKey) {
  const grp = GROUPS[groupKey];
  return grp ? grp.label : groupKey;
}

/**
 * Explicit "Room: Group" context label, e.g. "Bathroom 1: Vanity & Countertop" —
 * matches the same combined label shown on the walkthrough group card so
 * warning text is unambiguous about which room instance it refers to.
 * @param {{label?:string}} room
 * @param {string} instanceId
 * @param {string} groupKey
 * @returns {string}
 */
function _roomGroupLabel(room, instanceId, groupKey) {
  const roomLabel = (room && room.label) || instanceId;
  return `${roomLabel}: ${_groupLabel(groupKey)}`;
}

/**
 * Human-readable item name; checks catalog map then custom items.
 * @param {string} itemId
 * @param {object} project
 * @returns {string}
 */
function _itemName(itemId, project) {
  const catalogName = _catalogNameMap.get(itemId);
  if (catalogName) return catalogName;
  if (project && project.customItems) {
    const ci = project.customItems.find(c => c.id === itemId);
    if (ci) return ci.name;
  }
  return itemId;
}
