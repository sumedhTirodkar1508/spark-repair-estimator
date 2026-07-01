/**
 * Spark Estimator — service-worker.js
 * Versioned app-shell cache + offline-first strategy.
 * Update CACHE_NAME when any precached file changes.
 */

const CACHE_NAME = 'spark-cache-v9';

/**
 * Complete list of files to precache.
 * All paths are relative (no leading /), matching the app's relative-path contract.
 * Later agents: add new js/* files to this list when you create them.
 */
const PRECACHE = [
  /* App shell */
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './app.js',

  /* Core JS modules */
  './js/catalog.js',
  './js/db.js',
  './js/state.js',
  './js/pricing.js',
  './js/photos.js',
  './js/guardrails.js',
  './js/dealAnalyzer.js',
  './js/export.js',
  './js/backup.js',

  /* UI modules */
  './js/ui/components.js',
  './js/ui/dashboard.js',
  './js/ui/walkthrough.js',
  './js/ui/summary.js',
  './js/ui/priceBook.js',
  './js/ui/analyzer.js',

  /* Vendored libraries */
  './vendor/jszip.min.js',
  './vendor/xlsx.bundle.js',

  /* Assets */
  './assets/logo.png',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/icon-maskable-512.png',
  './assets/apple-touch-icon-180.png',
  './assets/favicon.ico',
];

/* ------------------------------------------------------------------ */
/* INSTALL — precache all app-shell files                              */
/* ------------------------------------------------------------------ */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Cache files individually so a single failure doesn't block the install.
      return Promise.allSettled(
        PRECACHE.map((url) =>
          cache.add(url).catch((err) => {
            // Log but don't abort install for missing optional assets (e.g. favicon).
            console.warn('[SW] Failed to precache:', url, err.message);
          })
        )
      );
    }).then(() => {
      // Activate immediately without waiting for existing tabs to close.
      return self.skipWaiting();
    })
  );
});

/* ------------------------------------------------------------------ */
/* ACTIVATE — clean up old caches and claim all clients                */
/* ------------------------------------------------------------------ */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keyList) => {
      return Promise.all(
        keyList
          .filter((key) => key !== CACHE_NAME)
          .map((key) => {
            console.log('[SW] Deleting old cache:', key);
            return caches.delete(key);
          })
      );
    }).then(() => {
      // Claim all open clients so the new SW is active immediately.
      return self.clients.claim();
    }).then(() => {
      // Notify all clients that a new service worker has activated.
      // app.js listens for this message to show an update toast.
      return self.clients.matchAll({ includeUncontrolled: true }).then((clients) => {
        clients.forEach((client) => {
          client.postMessage({
            type: 'SW_UPDATED',
            version: CACHE_NAME,
          });
        });
      });
    })
  );
});

/* ------------------------------------------------------------------ */
/* FETCH — cache-first for same-origin; pass-through for cross-origin  */
/* ------------------------------------------------------------------ */
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only intercept GET requests.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Pass cross-origin requests (CDNs, external APIs) straight to network.
  if (url.origin !== self.location.origin) {
    return; // fall through to browser default
  }

  event.respondWith(handleFetch(request));
});

async function handleFetch(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);

  // Background revalidation: fetch a fresh copy and update the cache for the
  // NEXT load. This is the "revalidate" half of stale-while-revalidate — it is
  // why an edited file appears after a normal reload, instead of being frozen
  // forever behind a static cache (the cause of "my fix didn't take effect").
  const networkUpdate = fetch(request)
    .then((response) => {
      if (response && response.status === 200 && response.type === 'basic') {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);

  // Serve the cached copy immediately when present (fast + fully offline),
  // while the background fetch refreshes it. If there's no cache entry, wait
  // for the network.
  if (cached) {
    return cached;
  }

  const network = await networkUpdate;
  if (network) return network;

  // Network failed and nothing cached — fall back to the app shell for navigations.
  if (request.mode === 'navigate') {
    const shell = await cache.match('./index.html') ||
                  await cache.match('./');
    if (shell) return shell;
  }

  return new Response('Offline — resource not cached', {
    status: 503,
    headers: { 'Content-Type': 'text/plain' },
  });
}
