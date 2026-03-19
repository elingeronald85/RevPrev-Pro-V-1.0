// ════════════════════════════════════════════════════════════════
//  RevPrev Pro V 1.0 — Service Worker
//  Estrategia: Cache-First para assets, Network-First para HTML
//  Versión del cache: cambiar al actualizar la app
// ════════════════════════════════════════════════════════════════

const CACHE_VERSION   = 'revprev-v1.0';
const CACHE_STATIC    = CACHE_VERSION + '-static';
const CACHE_DYNAMIC   = CACHE_VERSION + '-dynamic';

// Archivos críticos que se cachean en la instalación
const STATIC_ASSETS = [
  './',
  './index.html',
  './registro.html',
  './manifest.json',
  // Fuentes locales (si las tienes)
  // './icons/icon-192.png',
  // './icons/icon-512.png',
];

// URLs externas a precargar (CDN)
const CDN_ASSETS = [
  'https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;700&display=swap',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js',
];

// ────────────────────────────────────────────────────────────────
// INSTALL: precachear archivos estáticos
// ────────────────────────────────────────────────────────────────
self.addEventListener('install', event => {
  console.log('[RevPrev SW] Instalando v' + CACHE_VERSION);
  event.waitUntil(
    Promise.all([
      caches.open(CACHE_STATIC).then(cache => {
        return cache.addAll(STATIC_ASSETS).catch(err => {
          console.warn('[RevPrev SW] Algunos assets no se pudieron cachear:', err);
        });
      }),
      caches.open(CACHE_DYNAMIC).then(cache => {
        return Promise.allSettled(
          CDN_ASSETS.map(url =>
            fetch(url, { mode: 'cors' }).then(res => {
              if (res.ok) cache.put(url, res);
            }).catch(() => {})
          )
        );
      })
    ]).then(() => self.skipWaiting())
  );
});

// ────────────────────────────────────────────────────────────────
// ACTIVATE: eliminar caches antiguos
// ────────────────────────────────────────────────────────────────
self.addEventListener('activate', event => {
  console.log('[RevPrev SW] Activado');
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_STATIC && k !== CACHE_DYNAMIC)
          .map(k => {
            console.log('[RevPrev SW] Eliminando cache antiguo:', k);
            return caches.delete(k);
          })
      )
    ).then(() => self.clients.claim())
  );
});

// ────────────────────────────────────────────────────────────────
// FETCH: estrategia inteligente según el tipo de recurso
// ────────────────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);

  // Solo manejar GET
  if (req.method !== 'GET') return;

  // No interceptar peticiones a Supabase API
  if (url.hostname.includes('supabase.co')) return;

  // HTML principal → Network-First con fallback a cache
  if (req.headers.get('accept')?.includes('text/html') ||
      url.pathname.endsWith('.html') ||
      url.pathname === '/' || url.pathname === '') {
    event.respondWith(networkFirstHTML(req));
    return;
  }

  // CDN / assets externos → Cache-First
  if (url.origin !== location.origin) {
    event.respondWith(cacheFirst(req, CACHE_DYNAMIC));
    return;
  }

  // Assets locales (JS, CSS, imágenes, fuentes) → Cache-First
  event.respondWith(cacheFirst(req, CACHE_STATIC));
});

// ── Network-First para HTML (siempre intenta actualizar) ──
async function networkFirstHTML(req) {
  try {
    const res = await fetch(req);
    if (res && res.status === 200) {
      const cache = await caches.open(CACHE_STATIC);
      cache.put(req, res.clone());
    }
    return res;
  } catch (err) {
    // Sin internet → servir desde cache
    const cached = await caches.match(req);
    if (cached) return cached;
    // Último recurso: index.html como fallback
    const fallback = await caches.match('./index.html');
    return fallback || new Response(
      '<html><body style="font-family:sans-serif;padding:40px;background:#0f172a;color:#e2e8f0">' +
      '<h2>📡 Sin conexión</h2><p>La app no está disponible sin internet.<br>' +
      'Conéctate y vuelve a intentarlo.</p></body></html>',
      { headers: { 'Content-Type': 'text/html' } }
    );
  }
}

// ── Cache-First para assets ──
async function cacheFirst(req, cacheName) {
  const cached = await caches.match(req);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (res && res.status === 200) {
      const cache = await caches.open(cacheName);
      cache.put(req, res.clone());
    }
    return res;
  } catch (err) {
    return new Response('', { status: 408, statusText: 'Sin conexión' });
  }
}

// ────────────────────────────────────────────────────────────────
// MENSAJES desde la app
// ────────────────────────────────────────────────────────────────
self.addEventListener('message', event => {
  if (event.data === 'skipWaiting') {
    self.skipWaiting();
  }
  if (event.data === 'getCacheVersion') {
    event.source.postMessage({ type: 'cacheVersion', version: CACHE_VERSION });
  }
});
