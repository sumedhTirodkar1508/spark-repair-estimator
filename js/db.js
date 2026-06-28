/**
 * js/db.js — Phase 2
 * Owner: F3 agent
 * IndexedDB wrapper — Promise API. No business logic, no DOM, no localStorage.
 *
 * Database:  "spark-estimator"  version 1
 * Stores:
 *   projects  — keyPath "id"
 *   photos    — keyPath "id", index "byProject" on "projectId" (non-unique)
 *   settings  — keyPath "key"
 *
 * Named exports match frozen contract §18 exactly.
 */

const DB_NAME    = 'spark-estimator';
const DB_VERSION = 1;

/** @type {Promise<IDBDatabase>|null} */
let _dbPromise = null;

/**
 * Open (or reuse) the IndexedDB database.
 * Creates all three stores + the byProject index in onupgradeneeded.
 * Returns a cached Promise<IDBDatabase> — only one open request is ever made.
 *
 * @returns {Promise<IDBDatabase>}
 */
export function openDB() {
  if (_dbPromise) return _dbPromise;

  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (event) => {
      /** @type {IDBDatabase} */
      const db = event.target.result;

      if (!db.objectStoreNames.contains('projects')) {
        db.createObjectStore('projects', { keyPath: 'id' });
      }

      if (!db.objectStoreNames.contains('photos')) {
        const photoStore = db.createObjectStore('photos', { keyPath: 'id' });
        photoStore.createIndex('byProject', 'projectId', { unique: false });
      }

      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
    };

    req.onsuccess  = (event) => resolve(event.target.result);
    req.onerror    = (event) => {
      _dbPromise = null; // allow retry
      reject(event.target.error);
    };
    req.onblocked  = () => {
      // Another tab has the database open at an older version.
      // We resolve nothing here; the browser will retry after the other tab closes.
      console.warn('[db] openDB blocked — another tab may be holding an older version open');
    };
  });

  return _dbPromise;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Wrap an IDBRequest in a Promise.
 * @template T
 * @param {IDBRequest} req
 * @returns {Promise<T>}
 */
function _promisify(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror   = (e) => reject(e.target.error);
  });
}

/**
 * Open a transaction on a single store.
 * @param {'projects'|'photos'|'settings'} storeName
 * @param {'readonly'|'readwrite'} mode
 * @returns {Promise<IDBObjectStore>}
 */
async function _store(storeName, mode) {
  const db = await openDB();
  return db.transaction([storeName], mode).objectStore(storeName);
}

// ---------------------------------------------------------------------------
// projects store
// ---------------------------------------------------------------------------

/**
 * Return all project records from the store.
 * @returns {Promise<object[]>}
 */
export async function getAllProjects() {
  const store = await _store('projects', 'readonly');
  return _promisify(store.getAll());
}

/**
 * Return a single project by id, or undefined if not found.
 * @param {string} id
 * @returns {Promise<object|undefined>}
 */
export async function getProject(id) {
  const store = await _store('projects', 'readonly');
  return _promisify(store.get(id));
}

/**
 * Write (insert or overwrite) a project record.
 * @param {object} project
 * @returns {Promise<void>}
 */
export async function putProject(project) {
  const store = await _store('projects', 'readwrite');
  await _promisify(store.put(project));
}

/**
 * Delete a project record by id.
 * Does NOT cascade photos — callers (state.js) handle that via deletePhotosByProject.
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function deleteProject(id) {
  const store = await _store('projects', 'readwrite');
  await _promisify(store.delete(id));
}

// ---------------------------------------------------------------------------
// photos store
// ---------------------------------------------------------------------------

/**
 * Return all photo records for a given project (via the byProject index).
 * @param {string} projectId
 * @returns {Promise<object[]>}
 */
export async function getPhotosByProject(projectId) {
  const db    = await openDB();
  const store = db.transaction(['photos'], 'readonly').objectStore('photos');
  const index = store.index('byProject');
  return _promisify(index.getAll(projectId));
}

/**
 * Return a single photo record by id, or undefined.
 * @param {string} id
 * @returns {Promise<object|undefined>}
 */
export async function getPhoto(id) {
  const store = await _store('photos', 'readonly');
  return _promisify(store.get(id));
}

/**
 * Write (insert or overwrite) a photo record.
 * @param {object} photo
 * @returns {Promise<void>}
 */
export async function putPhoto(photo) {
  const store = await _store('photos', 'readwrite');
  await _promisify(store.put(photo));
}

/**
 * Delete a single photo record by id.
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function deletePhoto(id) {
  const store = await _store('photos', 'readwrite');
  await _promisify(store.delete(id));
}

/**
 * Delete ALL photo records for a given project using the byProject index.
 * Opens a single readwrite transaction and issues a delete for each matching key.
 *
 * @param {string} projectId
 * @returns {Promise<void>}
 */
export async function deletePhotosByProject(projectId) {
  const db    = await openDB();
  // We need both the index (for reading keys) and the store (for deleting) in the
  // same transaction so we open it once at the transaction level.
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(['photos'], 'readwrite');
    const store = tx.objectStore('photos');
    const index = store.index('byProject');
    const req   = index.getAllKeys(projectId);

    req.onsuccess = (e) => {
      const keys = e.target.result;
      for (const key of keys) {
        store.delete(key);
      }
    };
    req.onerror = (e) => reject(e.target.error);

    tx.oncomplete = () => resolve();
    tx.onerror    = (e) => reject(e.target.error);
    tx.onabort    = (e) => reject(e.target.error);
  });
}

// ---------------------------------------------------------------------------
// settings store
// ---------------------------------------------------------------------------

/**
 * Read a setting value by key.
 * The record shape is { key, value }; this resolves the inner `value`
 * (or undefined if the key has never been written).
 *
 * @param {string} key
 * @returns {Promise<any>}
 */
export async function getSetting(key) {
  const store  = await _store('settings', 'readonly');
  const record = await _promisify(store.get(key));
  return record === undefined ? undefined : record.value;
}

/**
 * Write a setting.  Stores the record as { key, value }.
 *
 * @param {string} key
 * @param {any}    value
 * @returns {Promise<void>}
 */
export async function putSetting(key, value) {
  const store = await _store('settings', 'readwrite');
  await _promisify(store.put({ key, value }));
}
