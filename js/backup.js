/**
 * js/backup.js — Phase 8 (Agent E)
 * Backup ZIP export/import with duplicate-ID handling.
 *
 * Named exports (frozen contract §27):
 *   exportBackupZip(projectId) -> Promise<void>
 *   readBackupZip(file)        -> Promise<{meta, project, photos:[{record, blob}]}>
 *   importBackup(parsed, mode) -> Promise<string>   mode: 'replace' | 'copy'
 *   projectIdExists(id)        -> Promise<boolean>
 *
 * Vendor: JSZip only (global JSZip) — lazy-loaded idempotently from
 *   ./vendor/jszip.min.js (offline-safe via SW precache).
 *   Pattern mirrors export.js _loadVendorLibs() but uses only JSZip.
 *
 * No dependency on export.js internals. No pricing. No DOM mutations beyond
 * creating a transient anchor for download.
 */

import { getProject, getAllProjects, putProject, putPhoto, getPhotosByProject, deletePhotosByProject } from './db.js';
import { makeThumbnail } from './photos.js';

// ============================================================================
// JSZip lazy-loader (idempotent, offline-safe, mirrors export.js pattern)
// ============================================================================

/** @type {Promise<Function>|null} */
let _jszipPromise = null;

/**
 * Lazily inject the JSZip vendor script and resolve once the global is ready.
 * Idempotent: subsequent calls return the same Promise.
 *
 * @returns {Promise<Function>} resolves with the JSZip constructor
 */
function _loadJSZip() {
  if (_jszipPromise) return _jszipPromise;

  _jszipPromise = new Promise((resolve, reject) => {
    if (window.JSZip) {
      resolve(window.JSZip);
      return;
    }

    const s = document.createElement('script');
    s.src     = './vendor/jszip.min.js';
    s.onload  = () => {
      if (window.JSZip) {
        resolve(window.JSZip);
      } else {
        _jszipPromise = null;
        reject(new Error('backup.js: jszip.min.js loaded but window.JSZip is undefined'));
      }
    };
    s.onerror = () => {
      _jszipPromise = null;
      reject(new Error('backup.js: failed to load ./vendor/jszip.min.js'));
    };
    document.head.appendChild(s);
  });

  return _jszipPromise;
}

// ============================================================================
// Filename / date helpers
// ============================================================================

/**
 * Sanitise a project name for use in a filename.
 * Collapses non-alphanumeric runs to single hyphens; lowercases; trims.
 * @param {string} str
 * @returns {string}
 */
function _safeName(str) {
  return String(str || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'project';
}

/**
 * YYYY-MM-DD string for today.
 * @returns {string}
 */
function _todayStr() {
  return new Date().toISOString().split('T')[0];
}

/**
 * Filesystem-safe timestamp "YYYYMMDD-HHMMSS" (local time) for unique,
 * cross-platform backup filenames (no colons — safe on Windows/iOS/Android).
 * @returns {string}
 */
function _stampStr() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-` +
         `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/**
 * Produce a unique display name for an imported copy, e.g.
 * "123 Main St (Copy)", "123 Main St (Copy 2)", "123 Main St (Copy 3)".
 * Comparison against existing names is case-insensitive and trimmed.
 * @param {string} baseName  the original project name
 * @param {Set<string>} existingLower  set of existing names, already trimmed + lower-cased
 * @returns {string}
 */
function _uniqueCopyName(baseName, existingLower) {
  const root = String(baseName || 'Imported Project').replace(/\s*\(Copy(?:\s+\d+)?\)\s*$/i, '').trim() || 'Imported Project';
  let candidate = `${root} (Copy)`;
  let n = 2;
  while (existingLower.has(candidate.trim().toLowerCase())) {
    candidate = `${root} (Copy ${n})`;
    n++;
  }
  return candidate;
}

/**
 * Make a preserved name unique for replace-current. Uses the name as-is when
 * it does not collide with OTHER projects; otherwise suffixes "(Restored)",
 * "(Restored 2)", … (never "(Copy)" — this is not Import as Copy).
 * Comparison is case-insensitive and trimmed.
 * @param {string} baseName       the current project's existing name to keep
 * @param {Set<string>} existingLower  other projects' names (trimmed + lower-cased),
 *                                      EXCLUDING the target project itself
 * @returns {string}
 */
function _uniqueRestoredName(baseName, existingLower) {
  const root = String(baseName || 'Restored Project').replace(/\s*\(Restored(?:\s+\d+)?\)\s*$/i, '').trim() || 'Restored Project';
  if (!existingLower.has(root.toLowerCase())) return root;
  let candidate = `${root} (Restored)`;
  let n = 2;
  while (existingLower.has(candidate.trim().toLowerCase())) {
    candidate = `${root} (Restored ${n})`;
    n++;
  }
  return candidate;
}

// ============================================================================
// exportBackupZip
// ============================================================================

/**
 * Export a full backup ZIP for a project.
 *
 * ZIP structure (§16):
 *   project.json  — project record (WITHOUT blob fields) + photoIndex
 *   photos/<photoId>.jpg  — full-res blobs only (thumbnails regenerated on import)
 *
 * project.json schema (§17):
 * {
 *   schemaVersion: 1,
 *   appVersion: "1.0.0",
 *   exportedAt: "ISO",
 *   project: { ...project record, no photo blobs },
 *   photoIndex: [{ id, scope, refKey, kind, file, w, h, bytes, createdAt }]
 * }
 *
 * @param {string} projectId
 * @returns {Promise<void>}
 */
export async function exportBackupZip(projectId) {
  const JSZip = await _loadJSZip();

  // 1. Load project record
  const project = await getProject(projectId);
  if (!project) throw new Error(`exportBackupZip: project "${projectId}" not found`);

  // 2. Load all photos for this project
  const photos = await getPhotosByProject(projectId);

  // 3. Build photoIndex (no blobs — full-res blobs go in the zip)
  const photoIndex = photos.map(ph => ({
    id:        ph.id,
    scope:     ph.scope,
    refKey:    ph.refKey,
    kind:      ph.kind,
    file:      `photos/${ph.id}.jpg`,
    w:         ph.w,
    h:         ph.h,
    bytes:     ph.bytes,
    createdAt: ph.createdAt,
  }));

  // 4. Build project record stripped of any embedded blob fields
  //    (project record §7 does not normally contain blobs, but strip defensively)
  const projectRecord = _stripBlobs(project);

  // 5. Assemble project.json payload
  const meta = {
    schemaVersion: 1,
    appVersion:    '1.0.0',
    exportedAt:    new Date().toISOString(),
    project:       projectRecord,
    photoIndex,
  };

  // 6. Build the ZIP
  const zip = new JSZip();
  zip.file('project.json', JSON.stringify(meta, null, 2));

  // Add full-res photo blobs under photos/<id>.jpg
  if (photos.length > 0) {
    const folder = zip.folder('photos');
    for (const ph of photos) {
      if (ph.blob) {
        folder.file(`${ph.id}.jpg`, ph.blob);
      }
    }
  }

  // 7. Generate and trigger download
  const zipBlob  = await zip.generateAsync({ type: 'blob' });
  const safeName = _safeName(project.name || projectId);
  const filename = `${safeName}-backup-${_stampStr()}.zip`;

  const a = document.createElement('a');
  a.href     = URL.createObjectURL(zipBlob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

// ============================================================================
// readBackupZip
// ============================================================================

/**
 * Parse a backup ZIP file into structured data.
 *
 * Validates schemaVersion === 1; rejects with a clear Error otherwise.
 *
 * @param {File} file
 * @returns {Promise<{meta:object, project:object, photos:Array<{record:object, blob:Blob}>}>}
 */
export async function readBackupZip(file) {
  const JSZip = await _loadJSZip();

  const zip = await JSZip.loadAsync(file);

  // Parse project.json
  const jsonEntry = zip.file('project.json');
  if (!jsonEntry) throw new Error('Invalid backup: missing project.json');

  const jsonText = await jsonEntry.async('string');
  let meta;
  try {
    meta = JSON.parse(jsonText);
  } catch (e) {
    throw new Error('Invalid backup: project.json is not valid JSON');
  }

  // Validate schema version
  if (meta.schemaVersion !== 1) {
    throw new Error(
      `Unsupported backup schema version "${meta.schemaVersion}" — only version 1 is supported.`
    );
  }

  if (!meta.project) {
    throw new Error('Invalid backup: project.json is missing the "project" field');
  }

  // Load photo blobs
  const photos = [];
  for (const entry of (meta.photoIndex || [])) {
    const zipFile = zip.file(entry.file);
    if (!zipFile) {
      // Photo entry references a missing file — skip it gracefully
      console.warn(`[backup] photo file "${entry.file}" missing from zip — skipping`);
      continue;
    }
    const blob = await zipFile.async('blob');
    photos.push({
      record: entry,
      blob,
    });
  }

  return { meta, project: meta.project, photos };
}

// ============================================================================
// importBackup
// ============================================================================

/**
 * Import a parsed backup into IndexedDB.
 *
 * Accepts either a legacy string mode or an options object:
 *
 *   'copy'  | { mode: 'copy' }
 *     - Assign a new project id: `proj_<timestamp>`.
 *     - Give it a unique display name ("(Copy)", "(Copy 2)", …),
 *       compared case-insensitively against existing names.
 *     - Generate fresh photo ids; set projectId to the new id.
 *
 *   'replace' | { mode: 'replace-existing-id' }
 *     - Keep the backup's own project.id (the target IS that project).
 *     - Overwrite the existing project record.
 *     - Delete the target's existing photos, then re-write the backup's
 *       photos with their original ids and the same projectId.
 *
 *   { mode: 'replace-current', targetProjectId }
 *     - Replace the CURRENTLY ACTIVE project (id = targetProjectId), NOT a new
 *       project and NOT the backup's old id. The route stays valid.
 *     - The backup's name/selections/rooms/serials/analyzer/etc. are copied
 *       onto the target id.
 *     - Delete the target's existing photos, then write the backup's photos
 *       with FRESH ids (so they cannot collide with / steal photos belonging
 *       to other projects whose ids differ from the backup's).
 *
 * @param {{ meta:object, project:object, photos:Array<{record:object,blob:Blob}> }} parsed
 * @param {'replace'|'copy'|{mode:string, targetProjectId?:string}} modeOrOpts
 * @returns {Promise<string>}  the resulting projectId
 */
export async function importBackup(parsed, modeOrOpts) {
  const { project, photos } = parsed;

  // Normalise legacy string mode + new options object.
  const opts = (typeof modeOrOpts === 'string') ? { mode: modeOrOpts } : (modeOrOpts || {});
  let mode = opts.mode || 'copy';
  if (mode === 'replace') mode = 'replace-existing-id'; // legacy alias

  const nowIso = new Date().toISOString();

  let targetProjectId;
  let targetProject;
  let regenPhotoIds;          // true → assign fresh photo ids
  let purgeTargetPhotos;      // true → deletePhotosByProject(targetProjectId) first

  if (mode === 'copy') {
    const existingLower = new Set(
      (await getAllProjects()).map(p => String(p.name || '').trim().toLowerCase())
    );
    targetProjectId = `proj_${Date.now()}`;
    targetProject   = {
      ...project,
      id:        targetProjectId,
      name:      _uniqueCopyName(project.name, existingLower),
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    regenPhotoIds     = true;
    purgeTargetPhotos = false;
  } else if (mode === 'replace-current') {
    targetProjectId = opts.targetProjectId;
    if (!targetProjectId) {
      throw new Error('importBackup: mode "replace-current" requires targetProjectId');
    }
    // Preserve the current project's identity: keep its existing NAME (not the
    // backup's) and createdAt by default. Only fall back to the backup name if
    // no target name was supplied. Make the kept name unique against OTHER
    // projects (excluding this target id) so we never create duplicates.
    const keepName = (typeof opts.targetProjectName === 'string' && opts.targetProjectName.trim())
      ? opts.targetProjectName
      : project.name;
    const otherNamesLower = new Set(
      (await getAllProjects())
        .filter(p => p.id !== targetProjectId)
        .map(p => String(p.name || '').trim().toLowerCase())
    );
    targetProject = {
      ...project,
      id:        targetProjectId,
      name:      _uniqueRestoredName(keepName, otherNamesLower),
      createdAt: opts.targetProjectCreatedAt || project.createdAt,
      updatedAt: nowIso,
    };
    regenPhotoIds     = true;  // backup photo ids belong to a different project id
    purgeTargetPhotos = true;
  } else { // 'replace-existing-id'
    targetProjectId = project.id;
    targetProject   = {
      ...project,
      id:        targetProjectId,
      updatedAt: nowIso,
    };
    regenPhotoIds     = false; // target IS this project — keep original photo ids
    purgeTargetPhotos = true;
  }

  // Persist the project record
  await putProject(targetProject);

  // Purge stale photos for the target before writing restored ones so old blobs
  // cannot linger in the Photo Manifest or export ZIP.
  if (purgeTargetPhotos) {
    await deletePhotosByProject(targetProjectId);
  }

  // Re-generate thumbnails and persist each photo
  const ts = Date.now();
  for (let i = 0; i < photos.length; i++) {
    const { record, blob } = photos[i];

    const photoId = regenPhotoIds ? `ph_${ts}_${i}` : record.id;

    // Generate thumbnail from the full-res blob
    let thumbBlob;
    try {
      thumbBlob = await makeThumbnail(blob);
    } catch (err) {
      console.warn(`[backup] makeThumbnail failed for photo "${record.id}" — using full blob as thumb`, err);
      thumbBlob = blob;
    }

    const photoRecord = {
      id:        photoId,
      projectId: targetProjectId,
      scope:     record.scope    || 'item',
      refKey:    record.refKey   || '',
      kind:      record.kind     || 'general',
      blob,
      thumbBlob,
      w:         record.w        || 0,
      h:         record.h        || 0,
      bytes:     record.bytes    || blob.size,
      createdAt: record.createdAt || new Date().toISOString(),
    };

    await putPhoto(photoRecord);
  }

  return targetProjectId;
}

// ============================================================================
// projectIdExists
// ============================================================================

/**
 * Check whether a project with the given id already exists in IndexedDB.
 * Used by summary.js to decide whether to show "Replace vs Copy" prompt.
 *
 * @param {string} id
 * @returns {Promise<boolean>}
 */
export async function projectIdExists(id) {
  const proj = await getProject(id);
  return proj !== undefined;
}

// ============================================================================
// Internal helpers
// ============================================================================

/**
 * Strip any Blob/ArrayBuffer/File values from an object recursively.
 * Project records should not contain blobs, but this is a safe-guard.
 *
 * @param {object} obj
 * @returns {object}
 */
function _stripBlobs(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  if (obj instanceof Blob || obj instanceof ArrayBuffer) return undefined;

  if (Array.isArray(obj)) {
    return obj.map(_stripBlobs).filter(v => v !== undefined);
  }

  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v instanceof Blob || v instanceof ArrayBuffer) continue; // drop
    out[k] = _stripBlobs(v);
  }
  return out;
}
