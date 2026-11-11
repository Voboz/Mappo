/* ============================================================
   Service worker — funzionamento offline
   ------------------------------------------------------------
   - App shell (HTML, CSS, JS, Leaflet, icone): aggiornata dalla
     rete quando disponibile, con fallback immediato in cache
   - Pagine: network-first con fallback in cache
   - Tessere della mappa: cache-first con cache limitata
   ------------------------------------------------------------
   L'update non forza l'attivazione: il nuovo worker resta in
   attesa finché la pagina invia SKIP_WAITING (pulsante "Ricarica").
   ============================================================ */

const VERSION = 'v1.0.2';
const SHELL_CACHE = 'luoghi-shell-' + VERSION;
const TILE_CACHE = 'luoghi-tiles-' + VERSION;
const MAX_TILES = 600;
const NETWORK_TIMEOUT = 3500;

const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  './vendor/leaflet/leaflet.css',
  './vendor/leaflet/leaflet.js',
  './vendor/leaflet/images/marker-icon.png',
  './vendor/leaflet/images/marker-icon-2x.png',
  './vendor/leaflet/images/marker-shadow.png',
  './vendor/leaflet/images/layers.png',
  './vendor/leaflet/images/layers-2x.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    const results = await Promise.allSettled(APP_SHELL.map((url) => cache.add(url)));
    const failed = results.filter((result) => result.status === 'rejected');
    if (failed.length > 0) {
      // Non attivare un service worker con una shell incompleta: senza
      // questo controllo l'app resterebbe offline in modo silenzioso.
      console.error('[sw] precache incompleto: ' + failed.length + ' risorse non scaricate');
      throw new Error('Precache incompleto');
    }
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          // Cancella solo le cache di questa app: l'origine può ospitare altre PWA.
          .filter((key) => key.startsWith('luoghi-') && key !== SHELL_CACHE && key !== TILE_CACHE)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    event.waitUntil(self.skipWaiting());
  }
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  let url;
  try {
    url = new URL(request.url);
  } catch (_) {
    return;
  }

  if (url.origin === self.location.origin) {
    const dynamic = request.mode === 'navigate'
      || request.destination === 'script'
      || request.destination === 'style'
      || request.destination === 'manifest';
    if (dynamic) {
      // HTML/JS/CSS sempre freschi quando c'è rete: evita di mescolare
      // una pagina nuova con asset vecchi in cache.
      event.respondWith(networkFirst(request));
    } else {
      event.respondWith(cacheFirst(request, SHELL_CACHE));
    }
    return;
  }

  if (url.hostname.endsWith('tile.openstreetmap.org')) {
    event.respondWith(tileFirst(request));
  }
});

async function fetchWithTimeout(request, timeout) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(request, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function networkFirst(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetchWithTimeout(request, NETWORK_TIMEOUT);
    if (response && response.ok) {
      cache.put(request, response.clone());
      return response;
    }
    const cached = (await cache.match(request))
      || (await cache.match('./index.html'))
      || (await cache.match('./'));
    if (cached) return cached;
    return response;
  } catch (_) {
    const cached = (await cache.match(request))
      || (await cache.match('./index.html'))
      || (await cache.match('./'));
    if (cached) return cached;
    return new Response(
      '<!doctype html><meta charset="utf-8"><title>Offline</title><body style="font-family:sans-serif;padding:24px">Sei offline e la pagina non è in cache. Riconnettiti e riprova.</body>',
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response && response.ok) cache.put(request, response.clone());
    return response;
  } catch (_) {
    return new Response('', { status: 504, statusText: 'Offline' });
  }
}

async function tileFirst(request) {
  const cache = await caches.open(TILE_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response && (response.ok || response.type === 'opaque')) {
      await cache.put(request, response.clone());
      await trimTiles();
    }
    return response;
  } catch (_) {
    return new Response('', { status: 504, statusText: 'Offline' });
  }
}

let trimming = false;

async function trimTiles() {
  if (trimming) return;
  trimming = true;
  try {
    const cache = await caches.open(TILE_CACHE);
    const keys = await cache.keys();
    if (keys.length <= MAX_TILES) return;
    for (let i = 0; i < keys.length - MAX_TILES; i++) {
      await cache.delete(keys[i]);
    }
  } finally {
    trimming = false;
  }
}
