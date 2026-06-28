/**
 * js/photos.js — Phase 5 (Agent B)
 * Camera capture, canvas compress, thumbnail, photo CRUD via IndexedDB.
 *
 * Named exports match frozen contract §23 exactly.
 * No default export. Vanilla ESM. No network. No deps. No OCR.
 * photos → {db}.  No state mutations here; callers (walkthrough.js) call
 * state.setSerialMeta for serial text fields.
 */

import {
  putPhoto,
  getPhotosByProject,
  deletePhoto as dbDeletePhoto,
} from './db.js';

import { getActiveProject } from './state.js';

// ---------------------------------------------------------------------------
// §23  compressImage
// ---------------------------------------------------------------------------

/**
 * Compress an image File to JPEG, scaled so long edge ≤ maxDim (never upscale).
 *
 * Feature-detects canvas.toBlob; falls back to toDataURL→fetch→blob on
 * older iOS Safari where toBlob may be absent.
 *
 * @param {File|Blob} file
 * @param {number}    maxDim   long-edge cap (default 1600)
 * @param {number}    quality  JPEG quality 0-1 (default 0.82)
 * @returns {Promise<{blob:Blob, w:number, h:number}>}
 */
export function compressImage(file, maxDim = 1600, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      URL.revokeObjectURL(url);

      const origW = img.naturalWidth;
      const origH = img.naturalHeight;
      const longEdge = Math.max(origW, origH);

      // Never upscale
      const scale = longEdge > maxDim ? maxDim / longEdge : 1;
      const w = Math.round(origW * scale);
      const h = Math.round(origH * scale);

      const canvas = document.createElement('canvas');
      canvas.width  = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);

      _canvasToBlob(canvas, quality)
        .then(blob => resolve({ blob, w, h }))
        .catch(reject);
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('compressImage: failed to load image'));
    };

    img.src = url;
  });
}

// ---------------------------------------------------------------------------
// §23  makeThumbnail
// ---------------------------------------------------------------------------

/**
 * Generate a small JPEG thumbnail blob from a full-res blob.
 * Long edge ≤ maxDim. Object URL is created and immediately revoked.
 *
 * @param {Blob}   blob
 * @param {number} maxDim   (default 320)
 * @param {number} quality  (default 0.7)
 * @returns {Promise<Blob>}
 */
export function makeThumbnail(blob, maxDim = 320, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();

    img.onload = () => {
      URL.revokeObjectURL(url);  // revoke immediately as required

      const origW = img.naturalWidth;
      const origH = img.naturalHeight;
      const longEdge = Math.max(origW, origH);

      const scale = longEdge > maxDim ? maxDim / longEdge : 1;
      const w = Math.round(origW * scale);
      const h = Math.round(origH * scale);

      const canvas = document.createElement('canvas');
      canvas.width  = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);

      _canvasToBlob(canvas, quality)
        .then(resolve)
        .catch(reject);
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('makeThumbnail: failed to load blob'));
    };

    img.src = url;
  });
}

// ---------------------------------------------------------------------------
// §23  capturePhoto
// ---------------------------------------------------------------------------

/**
 * Open the device camera (or file picker on iOS) by creating a hidden
 * <input type="file"> appended to document.body (required for Android —
 * the change event is dropped if the input isn't in the DOM).
 *
 * Compresses the selected file, generates a thumbnail, persists via addPhoto,
 * removes the input element, and resolves with the full photoRecord.
 * Resolves null if the user cancels (no file selected).
 *
 * Multiple files: processes and stores the first file; any additional files
 * beyond the first are silently ignored (single-photo capture is the norm).
 *
 * @param {{ scope:string, refKey:string, kind:string }} param0
 * @returns {Promise<object|null>}
 */
export function capturePhoto({ scope, refKey, kind }) {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type    = 'file';
    input.accept  = 'image/*';
    input.setAttribute('capture', 'environment');
    input.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0;pointer-events:none';

    // Must be in DOM for Android change event to fire reliably
    document.body.appendChild(input);

    // Track whether change fired (guards against cancel detection)
    let settled = false;

    const cleanup = () => {
      try { document.body.removeChild(input); } catch (_) { /* already removed */ }
    };

    input.addEventListener('change', async () => {
      if (settled) return;
      settled = true;
      cleanup();

      const file = input.files && input.files[0];
      if (!file) {
        resolve(null);
        return;
      }

      try {
        const { blob, w, h } = await compressImage(file);
        const thumbBlob       = await makeThumbnail(blob);

        const project = getActiveProject();
        if (!project) {
          reject(new Error('capturePhoto: no active project'));
          return;
        }

        const id = await addPhoto(project.id, { scope, refKey, kind, blob, thumbBlob, w, h });

        // Return the full record so callers can render immediately
        const record = {
          id,
          projectId: project.id,
          scope,
          refKey,
          kind,
          blob,
          thumbBlob,
          w,
          h,
          bytes: blob.size,
          createdAt: new Date().toISOString(),
        };
        resolve(record);
      } catch (err) {
        reject(err);
      }
    });

    // Detect cancel on desktop/iOS — focus returns to window after picker closes
    // Use a short delay so the change event fires first when a file IS selected.
    const onFocus = () => {
      setTimeout(() => {
        if (!settled) {
          settled = true;
          cleanup();
          resolve(null);
        }
        window.removeEventListener('focus', onFocus);
      }, 500);
    };
    window.addEventListener('focus', onFocus);

    input.click();
  });
}

// ---------------------------------------------------------------------------
// §23  addPhoto
// ---------------------------------------------------------------------------

/**
 * Build a photo record per §13 and persist it via db.putPhoto.
 *
 * @param {string} projectId
 * @param {{ scope:string, refKey:string, kind:string,
 *           blob:Blob, thumbBlob:Blob, w:number, h:number }} param1
 * @returns {Promise<string>} photo id
 */
export async function addPhoto(projectId, { scope, refKey, kind, blob, thumbBlob, w, h }) {
  // Unique id: ph_ + timestamp + 4-digit random suffix
  const id = 'ph_' + Date.now() + Math.floor(Math.random() * 10000).toString().padStart(4, '0');

  const record = {
    id,
    projectId,
    scope,
    refKey,
    kind,
    blob,
    thumbBlob,
    w,
    h,
    bytes: blob.size,
    createdAt: new Date().toISOString(),
  };

  await putPhoto(record);
  return id;
}

// ---------------------------------------------------------------------------
// §23  getPhotos
// ---------------------------------------------------------------------------

/**
 * Retrieve all photo records for a project, with optional filtering.
 *
 * @param {string}   projectId
 * @param {{ scope?:string, refKey?:string, kind?:string }} [filter]
 * @returns {Promise<object[]>}
 */
export async function getPhotos(projectId, filter) {
  const all = await getPhotosByProject(projectId);
  if (!filter) return all;

  return all.filter(ph => {
    if (filter.scope  !== undefined && ph.scope  !== filter.scope)  return false;
    if (filter.refKey !== undefined && ph.refKey !== filter.refKey) return false;
    if (filter.kind   !== undefined && ph.kind   !== filter.kind)   return false;
    return true;
  });
}

// ---------------------------------------------------------------------------
// §23  getThumbURL
// ---------------------------------------------------------------------------

/**
 * Create an object URL for a photo's thumbnail blob.
 * Caller is responsible for revoking (URL.revokeObjectURL) when done.
 *
 * @param {object} photoRecord  must have a thumbBlob Blob property
 * @returns {string}
 */
export function getThumbURL(photoRecord) {
  return URL.createObjectURL(photoRecord.thumbBlob);
}

// ---------------------------------------------------------------------------
// §23  deletePhoto
// ---------------------------------------------------------------------------

/**
 * Delete a single photo record from IndexedDB by id.
 *
 * @param {string} photoId
 * @returns {Promise<void>}
 */
export async function deletePhoto(photoId) {
  await dbDeletePhoto(photoId);
}

// ---------------------------------------------------------------------------
// §23  countSerialPhotos
// ---------------------------------------------------------------------------

/**
 * Count the number of photos attached to a given refKey with kind "serial".
 *
 * @param {string} projectId
 * @param {string} refKey
 * @returns {Promise<number>}
 */
export async function countSerialPhotos(projectId, refKey) {
  const photos = await getPhotos(projectId, { refKey, kind: 'serial' });
  return photos.length;
}

// ---------------------------------------------------------------------------
// Internal: canvas → Blob with iOS toBlob fallback
// ---------------------------------------------------------------------------

/**
 * Convert a canvas to a JPEG Blob.
 * Feature-detects canvas.toBlob; falls back to toDataURL → fetch → blob
 * for older iOS Safari where toBlob is absent or broken.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {number}            quality  0-1
 * @returns {Promise<Blob>}
 */
function _canvasToBlob(canvas, quality) {
  // Modern path: canvas.toBlob is a proper function
  if (typeof canvas.toBlob === 'function') {
    return new Promise((resolve, reject) => {
      try {
        canvas.toBlob(
          (blob) => {
            if (blob) {
              resolve(blob);
            } else {
              reject(new Error('canvas.toBlob returned null'));
            }
          },
          'image/jpeg',
          quality
        );
      } catch (err) {
        // Fallthrough to dataURL path on any synchronous error
        _dataURLFallback(canvas, quality).then(resolve).catch(reject);
      }
    });
  }

  // iOS fallback: toDataURL → fetch → blob
  return _dataURLFallback(canvas, quality);
}

/**
 * iOS fallback: canvas.toDataURL('image/jpeg', quality) → fetch(dataUrl) → blob().
 * fetch() with a data: URL works in all modern browsers and converts the
 * base64 payload into a proper Blob without holding it in a JS string long-term.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {number}            quality
 * @returns {Promise<Blob>}
 */
function _dataURLFallback(canvas, quality) {
  const dataURL = canvas.toDataURL('image/jpeg', quality);
  return fetch(dataURL).then(r => r.blob());
}
