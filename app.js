/**
 * Spark Estimator — app.js
 * Entry module: boot, hash router, SW registration, install prompt.
 *
 * Named exports: navigate(hash), triggerInstallPrompt(), isInstallAvailable(), isStandalone(), isIosSafariForInstall()
 *
 * Routes:
 *   #/            → dashboard
 *   #/dashboard   → dashboard
 *   #/project/:id → walkthrough
 *   #/project/:id/summary  → summary
 *   #/project/:id/analyzer → analyzer
 *   #/project/:id/gallery  → photo gallery
 *   #/pricebook   → price book
 */

import { initState, getActiveProject, onChange, flushSave } from './js/state.js';
import { render as renderDashboard }    from './js/ui/dashboard.js';
import { render as renderWalkthrough }  from './js/ui/walkthrough.js';

/* ------------------------------------------------------------------ */
/* 1. SW REGISTRATION                                                  */
/* ------------------------------------------------------------------ */

let _swRegistration = null;

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  try {
    _swRegistration = await navigator.serviceWorker.register(
      './service-worker.js',
      { scope: './' }
    );
    console.log('[App] SW registered, scope:', _swRegistration.scope);

    // Listen for the SW_UPDATED message from the new service worker.
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data && event.data.type === 'SW_UPDATED') {
        _showUpdateToast(event.data.version);
      }
    });
  } catch (err) {
    console.warn('[App] SW registration failed:', err);
  }
}

function _showUpdateToast(version) {
  // Use components.js toast if available; fallback to raw DOM.
  try {
    const { toast } = _lazyComponents();
    toast(`New version available — tap to refresh`, { type: 'info', duration: 12000 });
  } catch (_) {
    const root = document.getElementById('toast-root');
    if (!root) return;
    const div = document.createElement('div');
    div.className = 'toast toast--info';
    div.innerHTML = `<span style="flex:1">New version — <strong>tap to refresh</strong></span>
      <button onclick="window.location.reload()"
        style="background:var(--color-orange);color:#111;border:none;border-radius:6px;
               padding:4px 10px;font-size:0.75rem;font-weight:600;cursor:pointer;flex-shrink:0">
        Refresh
      </button>`;
    root.appendChild(div);
    setTimeout(() => div.remove(), 12000);
  }
}

/* Lazy-load components (avoids circular import issues at SW message time) */
let _componentsCache = null;
function _lazyComponents() {
  if (!_componentsCache) {
    // This is a sync call so we rely on the module already being loaded
    // (it will be by the time boot() finishes).
    throw new Error('components not loaded yet');
  }
  return _componentsCache;
}

/* ------------------------------------------------------------------ */
/* 2. INSTALL PROMPT (Android / Chrome)                                */
/* ------------------------------------------------------------------ */

let _deferredInstallPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  _deferredInstallPrompt = e;
  console.log('[App] beforeinstallprompt captured');
  // Show native install banner (Android / desktop Chrome)
  if (!isStandalone()) { _maybeShowInstallBanner('android'); }
  document.dispatchEvent(new CustomEvent('spark:installable'));
});

window.addEventListener('appinstalled', () => {
  _deferredInstallPrompt = null;
  console.log('[App] App installed');
  document.querySelectorAll('.install-hint').forEach(el => el.remove());
  document.dispatchEvent(new CustomEvent('spark:installed'));
});

/**
 * Trigger the native install prompt (call from a user-gesture handler).
 * Returns the outcome ('accepted' | 'dismissed') or null if unavailable.
 */
export async function triggerInstallPrompt() {
  if (!_deferredInstallPrompt) return null;
  _deferredInstallPrompt.prompt();
  const { outcome } = await _deferredInstallPrompt.userChoice;
  _deferredInstallPrompt = null;
  return outcome;
}

/** Returns true if a native install prompt is available (Android/Chrome). */
export function isInstallAvailable() {
  return Boolean(_deferredInstallPrompt);
}

/* ------------------------------------------------------------------ */
/* 3. iOS STANDALONE DETECTION                                         */
/* ------------------------------------------------------------------ */

/** Returns true when running as an installed PWA on any platform. */
export function isStandalone() {
  return (
    window.navigator.standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches
  );
}

/**
 * Returns true when the user is on iOS Safari (not standalone).
 * Used to decide whether to show an A2HS instruction hint.
 */
export function isIosSafariForInstall() {
  const ua = navigator.userAgent;
  const isIos    = /iphone|ipad|ipod/i.test(ua);
  const isSafari = /safari/i.test(ua) && !/chrome|crios|fxios/i.test(ua);
  return isIos && isSafari && !isStandalone();
}

/* ------------------------------------------------------------------ */
/* 4. HASH ROUTER                                                      */
/* ------------------------------------------------------------------ */

const LAST_ROUTE_KEY = 'spark.lastRoute';

/**
 * Parse location.hash into a route descriptor.
 */
function parseRoute(hash) {
  const path = (hash || '').replace(/^#/, '') || '/';

  if (path === '/' || path === '/dashboard') {
    return { name: 'dashboard', params: {} };
  }
  if (path === '/pricebook') {
    return { name: 'pricebook', params: {} };
  }

  const summaryMatch = path.match(/^\/project\/([^/]+)\/summary$/);
  if (summaryMatch) {
    return { name: 'project-summary', params: { id: summaryMatch[1] } };
  }

  const analyzerMatch = path.match(/^\/project\/([^/]+)\/analyzer$/);
  if (analyzerMatch) {
    return { name: 'project-analyzer', params: { id: analyzerMatch[1] } };
  }

  const galleryMatch = path.match(/^\/project\/([^/]+)\/gallery$/);
  if (galleryMatch) {
    return { name: 'project-gallery', params: { id: galleryMatch[1] } };
  }

  const projectMatch = path.match(/^\/project\/([^/]+)$/);
  if (projectMatch) {
    return { name: 'project', params: { id: projectMatch[1] } };
  }

  return { name: 'dashboard', params: {} };
}

/**
 * Navigate to a hash route.
 */
export function navigate(hash) {
  window.location.hash = hash;
}

/** Keep track of which route is currently rendered. */
let _currentRouteName = null;

async function handleRoute(hash) {
  const route  = parseRoute(hash);
  const rootEl = document.getElementById('app');
  if (!rootEl) return;

  // Save last route so a fresh launch resumes here.
  try { localStorage.setItem(LAST_ROUTE_KEY, hash || '#/'); } catch (_) {}

  _currentRouteName = route.name;

  switch (route.name) {
    case 'dashboard':
      try {
        await renderDashboard(rootEl, route.params);
      } catch (err) {
        console.error('[App] dashboard.render error', err);
        _renderErrorPlaceholder(rootEl, 'Dashboard error', err.message);
      }
      break;

    case 'project':
      try {
        await renderWalkthrough(rootEl, route.params);
      } catch (err) {
        console.error('[App] walkthrough.render error', err);
        _renderErrorPlaceholder(rootEl, 'Walkthrough error', err.message);
      }
      break;

    case 'project-summary':
      try {
        const { render: renderSummary } = await import('./js/ui/summary.js');
        await renderSummary(rootEl, route.params);
      } catch (err) {
        console.error('[App] summary.render error', err);
        _renderErrorPlaceholder(rootEl, 'Review & Export', err.message, route.params.id);
      }
      break;

    case 'project-analyzer':
      try {
        const { render: renderAnalyzer } = await import('./js/ui/analyzer.js');
        await renderAnalyzer(rootEl, route.params);
      } catch (err) {
        console.error('[App] analyzer.render error', err);
        _renderErrorPlaceholder(rootEl, 'Deal Analyzer', err.message, route.params.id);
      }
      break;

    case 'project-gallery':
      try {
        const { render: renderGallery } = await import('./js/ui/gallery.js');
        await renderGallery(rootEl, route.params);
      } catch (err) {
        console.error('[App] gallery.render error', err);
        _renderErrorPlaceholder(rootEl, 'Photo Gallery', err.message, route.params.id);
      }
      break;

    case 'pricebook':
      try {
        const { render: renderPriceBook } = await import('./js/ui/priceBook.js');
        await renderPriceBook(rootEl, route.params);
      } catch (err) {
        console.error('[App] priceBook.render error', err);
        _renderErrorPlaceholder(rootEl, 'Price Book', err.message, null);
      }
      break;

    default:
      try {
        await renderDashboard(rootEl, {});
      } catch (err) {
        _renderErrorPlaceholder(rootEl, 'Dashboard', err.message);
      }
      break;
  }
}

/**
 * Escape text for safe HTML interpolation. Error messages can originate from
 * thrown Error objects anywhere downstream (including user-influenced data),
 * so this must run before any error text is inserted via innerHTML.
 * @param {string} str
 * @returns {string}
 */
function _esc(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function _renderErrorPlaceholder(rootEl, label, msg, projectId) {
  const backHref = projectId ? `#/project/${projectId}` : '#/dashboard';
  const backLabel = projectId ? '← Back' : '← Dashboard';
  rootEl.innerHTML = `
    <div class="route-placeholder">
      <div class="route-placeholder__label">Error loading ${_esc(label)}</div>
      <div class="route-placeholder__sub" style="color:var(--color-danger)">${_esc(msg)}</div>
      <div style="margin-top:var(--sp-4)">
        <a href="${backHref}" style="color:var(--color-orange-light);font-size:0.875rem">${backLabel}</a>
      </div>
    </div>
  `;
}

/* ------------------------------------------------------------------ */
/* 5. GLOBAL DELEGATED CLICK HANDLER SKELETON                          */
/* ------------------------------------------------------------------ */

function setupGlobalDelegation() {
  document.addEventListener('click', (e) => {
    let el = e.target;
    while (el && el !== document.body) {
      const action = el.dataset && el.dataset.action;
      if (action) {
        _handleGlobalAction(action, el, e);
        return;
      }
      el = el.parentElement;
    }
  });
}

function _handleGlobalAction(action, el, event) {
  switch (action) {
    case 'navigate': {
      const hash = el.dataset.href || el.getAttribute('href') || '#/';
      event.preventDefault();
      navigate(hash);
      break;
    }
    case 'install-app': {
      triggerInstallPrompt().then(outcome => {
        if (outcome === 'accepted') {
          document.querySelectorAll('.install-hint').forEach(el => el.remove());
        }
      }).catch(() => {});
      break;
    }
    case 'dismiss-install-hint': {
      try { localStorage.setItem('spark.dismissedInstallHint', '1'); } catch (_) {}
      document.querySelectorAll('.install-hint').forEach(el => el.remove());
      break;
    }
    // Other actions are handled by view-local delegated handlers
    default:
      break;
  }
}

/* ------------------------------------------------------------------ */
/* 6. FLUSH SAVE ON PAGE HIDE / VISIBILITY CHANGE                      */
/* ------------------------------------------------------------------ */

function setupFlushSave() {
  const flush = () => {
    flushSave().catch(e => console.warn('[App] flushSave error', e));
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
  window.addEventListener('pagehide', flush);
  // iOS "freeze" event
  window.addEventListener('freeze', flush);
}

/* ------------------------------------------------------------------ */
/* 7. INSTALL HINTS (iOS A2HS + Android Chrome banner)                 */
/* ------------------------------------------------------------------ */

/**
 * Render an install hint banner and append to body.
 * type: 'ios' | 'android' | 'android-manual'
 */
function _maybeShowInstallBanner(type) {
  if (isStandalone()) return;
  if (localStorage.getItem('spark.dismissedInstallHint') === '1') return;
  if (document.querySelector('.install-hint')) return; // already visible

  const hint = document.createElement('div');
  hint.className = 'install-hint';

  const dismiss = `<button class="btn btn--ghost btn--sm" data-action="dismiss-install-hint"
    aria-label="Dismiss install hint" style="flex-shrink:0">✕</button>`;

  if (type === 'android') {
    hint.innerHTML = `
      <div class="install-hint__text">
        <strong>Install Spark Repair Estimator</strong><br>
        Add to home screen for fast offline access.
      </div>
      <button class="btn btn--sm" style="background:var(--color-orange);color:#111;flex-shrink:0"
        data-action="install-app" aria-label="Install app">Install</button>
      ${dismiss}`;
  } else if (type === 'android-manual') {
    hint.innerHTML = `
      <div class="install-hint__text">
        <strong>Install Spark Repair Estimator</strong><br>
        Open Chrome menu <strong>⋮</strong> → <strong>Add to Home screen</strong>.
      </div>
      ${dismiss}`;
  } else {
    // ios
    hint.innerHTML = `
      <div class="install-hint__text">
        <strong>Install Spark Repair Estimator</strong><br>
        Tap <strong>Share ↑</strong> → <strong>Add to Home Screen</strong> for offline access.
      </div>
      ${dismiss}`;
  }
  document.body.appendChild(hint);
}

function maybeShowInstallHint() {
  if (isStandalone()) return;

  // iOS Safari: beforeinstallprompt never fires — show Share instructions.
  if (isIosSafariForInstall()) {
    const dismissed = localStorage.getItem('spark.dismissedInstallHint') === '1';
    if (!dismissed) {
      setTimeout(() => _maybeShowInstallBanner('ios'), 1500);
    }
    return;
  }

  // Android Chrome: if beforeinstallprompt hasn't fired after 4 s (app already
  // installed elsewhere, criteria not yet met, etc.), show manual fallback.
  const ua = navigator.userAgent;
  if (/android/i.test(ua) && /chrome/i.test(ua) && !/wv/i.test(ua)) {
    setTimeout(() => {
      if (_deferredInstallPrompt) return; // banner already shown via beforeinstallprompt
      _maybeShowInstallBanner('android-manual');
    }, 4000);
  }
}

/* ------------------------------------------------------------------ */
/* 8. onChange → re-render current route (dashboard only;              */
/*    walkthrough handles its own subscription)                        */
/* ------------------------------------------------------------------ */

function setupStateSubscription() {
  onChange(() => {
    // Dashboard re-renders on project-list changes
    if (_currentRouteName === 'dashboard') {
      const rootEl = document.getElementById('app');
      if (rootEl) {
        renderDashboard(rootEl, {}).catch(err => {
          console.error('[App] dashboard re-render error', err);
        });
      }
    }
    // Walkthrough has its own internal subscription; app.js doesn't duplicate it.
  });
}

/* ------------------------------------------------------------------ */
/* 9. BOOT                                                             */
/* ------------------------------------------------------------------ */

async function boot() {
  // Register SW non-blocking
  registerServiceWorker();

  // Set up global delegation (handles navigate, install-app, dismiss-install-hint)
  setupGlobalDelegation();

  // Boot state: open IndexedDB, load globalPrices, restore/create project
  try {
    await initState();
  } catch (err) {
    console.error('[App] initState failed', err);
    const rootEl = document.getElementById('app');
    if (rootEl) {
      rootEl.innerHTML = `
        <div class="empty-state">
          <div class="empty-state__icon">⚠️</div>
          <p class="empty-state__title">Storage error</p>
          <p class="empty-state__desc">Could not open IndexedDB: ${_esc(err.message)}</p>
          <p class="empty-state__desc" style="margin-top:var(--sp-2)">
            Try reloading the page or clearing site data in browser settings.
          </p>
        </div>`;
    }
    return;
  }

  // Wire flush-save on page hide
  setupFlushSave();

  // Subscribe onChange for dashboard re-renders
  setupStateSubscription();

  // Determine start route
  let startHash = window.location.hash;
  if (!startHash || startHash === '#') {
    try {
      const saved = localStorage.getItem(LAST_ROUTE_KEY);
      if (saved) startHash = saved;
    } catch (_) {}
  }

  // If no saved route, go to the active project if one exists, else dashboard
  if (!startHash || startHash === '#' || startHash === '#/') {
    const active = getActiveProject();
    if (active) {
      startHash = `#/project/${active.id}`;
    } else {
      startHash = '#/dashboard';
    }
  }

  // Render initial route
  await handleRoute(startHash || '#/dashboard');

  // Listen for subsequent hash changes
  window.addEventListener('hashchange', () => {
    handleRoute(window.location.hash);
  });

  // Install hint (iOS A2HS or Android Chrome banner)
  maybeShowInstallHint();

  console.log('[App] Boot complete. Route:', startHash);
}

// Run on DOMContentLoaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
