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

import { getProject, getAllProjects, putProject, putPhoto, getPhotosByProject } from './db.js';
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
 * @param {string} baseName  the original project name
 * @param {Set<string>} existing  set of names already in use
 * @returns {string}
 */
function _uniqueCopyName(baseName, existing) {
  const root = String(baseName || 'Imported Project').replace(/\s*\(Copy(?:\s+\d+)?\)\s*$/i, '').trim() || 'Imported Project';
  let candidate = `${root} (Copy)`;
  let n = 2;
  while (existing.has(candidate)) {
    candidate = `${root} (Copy ${n})`;
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
 * mode 'replace':
 *   - Keep the same project.id.
 *   - Overwrite the existing project record.
 *   - Re-generate thumbBlob for each photo via makeThumbnail; putPhoto with
 *     same ids and projectId.
 *
 * mode 'copy':
 *   - Assign a new project id: `proj_<timestamp>`.
 *   - Remap project.id.
 *   - For each photo: new id `ph_<timestamp>_<index>`, set projectId to new id.
 *   - Re-generate thumbBlob; putPhoto.
 *
 * @param {{ meta:object, project:object, photos:Array<{record:object,blob:Blob}> }} parsed
 * @param {'replace'|'copy'} mode
 * @returns {Promise<string>}  the resulting projectId
 */
export async function importBackup(parsed, mode) {
  const { project, photos } = parsed;

  let targetProjectId;
  let targetProject;

  if (mode === 'replace') {
    // Keep the existing id; overwrite everything else
    targetProjectId = project.id;
    targetProject   = {
      ...project,
      id:        targetProjectId,
      updatedAt: new Date().toISOString(),
    };
  } else {
    // mode === 'copy' — new unique id AND a unique display name so repeated
    // imports produce "(Copy)", "(Copy 2)", "(Copy 3)" instead of duplicates.
    const existing = new Set((await getAllProjects()).map(p => p.name));
    targetProjectId = `proj_${Date.now()}`;
    targetProject   = {
      ...project,
      id:        targetProjectId,
      name:      _uniqueCopyName(project.name, existing),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  // Persist the project record
  await putProject(targetProject);

  // Re-generate thumbnails and persist each photo
  const ts = Date.now();
  for (let i = 0; i < photos.length; i++) {
    const { record, blob } = photos[i];

    let photoId;
    if (mode === 'replace') {
      photoId = record.id;
    } else {
      photoId = `ph_${ts}_${i}`;
    }

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
