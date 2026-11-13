/* ============================================================
   Service worker — funzionamento offline
   ------------------------------------------------------------
   - App shell (HTML, CSS, JS, Leaflet, MapLibre, icone):
     aggiornata dalla rete quando disponibile, con fallback
     immediato in cache
   - Pagine: network-first con fallback in cache
   - Librerie vendor: cache-first (cambiano solo a ogni release)
   - Stile, TileJSON, sprite e font della mappa: cache-first con
     rivalidazione in background
   - Tessere della mappa: cache-first con cache limitata, che non
     sfratta mai le risorse di piano di controllo
   ------------------------------------------------------------
   L'update non forza l'attivazione: il nuovo worker resta in
   attesa finché la pagina invia SKIP_WAITING (pulsante "Ricarica").
   ============================================================ */

const VERSION = 'v1.7.0';
const SHELL_CACHE = 'mappo-shell-' + VERSION;
const TILE_CACHE = 'mappo-tiles-' + VERSION;
const RASTER_CACHE = 'mappo-raster-' + VERSION;
const MAX_TILES = 800;
// Le tessere raster Natural Earth sono molto piu' grosse di quelle vettoriali
// (~250 KB): tengono una cache separata e piccola.
const MAX_RASTER_TILES = 24;
const NETWORK_TIMEOUT = 3500;
// Script e CSS: se la rete e' lenta meglio la cache (stessa versione) che
// aspettare secondi con la pagina vuota.
const ASSET_TIMEOUT = 1500;
// Cache create dalla versione precedente dell'app (prefisso "luoghi-"):
// vengono eliminate al primo avvio dopo il rinominamento.
const LEGACY_CACHE_PREFIX = 'luoghi-';

// Risorse di "piano di controllo" della mappa (stile, TileJSON, sprite, font):
// senza queste MapLibre non può costruire la mappa, quindi non devono mai
// essere sfrattate dalla cache delle tessere e vanno rivalidate dalla rete.
const CRITICAL_MAP_RE = /\/styles\/|\/planet$|\/sprites\/|\/fonts\//;

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
  './vendor/maplibre/maplibre-gl-csp.js',
  './vendor/maplibre/maplibre-gl-csp-worker.js',
  './vendor/maplibre/maplibre-gl.css',
  './vendor/maplibre/leaflet-maplibre-gl.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // cache: 'reload' evita di prendere da cache HTTP copie vecchie
    // (per esempio delle icone appena rigenerate).
    const results = await Promise.allSettled(APP_SHELL.map(async (url) => {
      const response = await fetch(url, { cache: 'reload' });
      if (!response || !response.ok) throw new Error('HTTP ' + (response && response.status));
      await cache.put(url, response);
    }));
    const missing = APP_SHELL.filter((_, i) => results[i].status === 'rejected');
    if (missing.length === 0) return;

    // Un errore di rete è transitorio: si ritenta una volta. Un 404 invece
    // significa che il file non esiste più (per esempio un'icona rimossa):
    // in quel caso si continua senza di lui, così l'install non fallisce.
    const stillMissing = [];
    for (const url of missing) {
      const response = await fetch(url, { cache: 'reload' }).catch(() => null);
      if (response && response.ok) {
        await cache.put(url, response);
      } else if (!response || response.status !== 404) {
        stillMissing.push(url);
      }
    }
    if (stillMissing.length > 0) {
      // Non attivare un service worker con una shell incompleta: senza
      // questo controllo l'app resterebbe offline in modo silenzioso.
      console.error('[sw] precache incompleto: ' + stillMissing.length + ' risorse non scaricate');
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
          .filter((key) => (key.startsWith('mappo-') || key.startsWith(LEGACY_CACHE_PREFIX))
            && key !== SHELL_CACHE && key !== TILE_CACHE)
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
    // I file vendor cambiano solo a ogni release: sono già versionati dalla
    // cache della shell, quindi si servono dalla cache e non dalla rete.
    if (url.pathname.includes('/vendor/')) {
      event.respondWith(cacheFirst(request, SHELL_CACHE));
      return;
    }
    // Gli URL con parametri sono varianti (cache-busting, test): non si
    // memorizzano, altrimenti la cache della shell cresce senza limite.
    if (url.search.length > 1) {
      event.respondWith(networkOnly(request));
      return;
    }
    if (dynamic) {
      // HTML/JS/CSS freschi quando c'è rete: evita di mescolare una pagina
      // nuova con asset vecchi in cache. Per script e CSS il timeout è più
      // breve: se la rete è lenta si preferisce la copia in cache (che
      // appartiene alla stessa versione) a una pagina che non si disegna.
      const timeout = request.mode === 'navigate' ? NETWORK_TIMEOUT : ASSET_TIMEOUT;
      event.respondWith(networkFirst(request, timeout));
    } else {
      event.respondWith(cacheFirst(request, SHELL_CACHE));
    }
    return;
  }

  if (url.hostname === 'tiles.openfreemap.org') {
    if (url.pathname.includes('/natural_earth/')) {
      // Tessere raster pesanti: cache separata e limitata.
      event.respondWith(tileFirst(request, RASTER_CACHE, MAX_RASTER_TILES));
      return;
    }
    // Stile, TileJSON, sprite e font: serviti dalla cache ma rivalidati in
    // background, così un nuovo build di OpenFreeMap non lascia in cache
    // riferimenti a tessere sparite.
    event.respondWith(isCriticalMapResource(url)
      ? staleWhileRevalidate(request)
      : tileFirst(request, TILE_CACHE, MAX_TILES));
  }
});

function isCriticalMapResource(url) {
  return CRITICAL_MAP_RE.test(url.pathname);
}

async function fetchWithTimeout(request, timeout) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(request, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function networkFirst(request, timeout = NETWORK_TIMEOUT) {
  const cache = await caches.open(SHELL_CACHE);
  // Le navigazioni con parametri (condivisione, scorciatoie del manifest)
  // hanno URL sempre diversi: non vanno salvate in cache, altrimenti la
  // cache della shell cresce senza limite (la shell resta ./index.html).
  let skipCache = false;
  try {
    const url = new URL(request.url);
    skipCache = request.mode === 'navigate' && url.search.length > 1;
  } catch (_) { /* URL non valido: tratta come richiesta normale */ }
  try {
    const response = await fetchWithTimeout(request, timeout);
    if (response && response.ok) {
      if (!skipCache) cache.put(request, response.clone());
      return response;
    }
    const cached = await cache.match(request);
    if (cached) return cached;
    // Il fallback alla shell va offerto solo alle navigazioni vere: per
    // script/CSS/manifest non ha senso restituire index.html.
    if (request.mode === 'navigate') {
      const shell = (await cache.match('./index.html')) || (await cache.match('./'));
      if (shell) return shell;
    }
    return response;
  } catch (_) {
    const cached = await cache.match(request);
    if (cached) return cached;
    if (request.mode === 'navigate') {
      const shell = (await cache.match('./index.html')) || (await cache.match('./'));
      if (shell) return shell;
    }
    return new Response(
      '<!doctype html><meta charset="utf-8"><title>Offline</title><body style="font-family:sans-serif;padding:24px">Sei offline e la pagina non è in cache. Riconnettiti e riprova.</body>',
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  }
}

// Richiesta senza cache: usata per gli URL con parametri.
async function networkOnly(request) {
  try {
    return await fetch(request);
  } catch (_) {
    return new Response('', { status: 504, statusText: 'Offline' });
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

async function tileFirst(request, cacheName = TILE_CACHE, limit = MAX_TILES) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response && (response.ok || response.type === 'opaque')) {
      await cache.put(request, response.clone());
      await trimTiles(cacheName, limit);
    }
    return response;
  } catch (_) {
    return new Response('', { status: 504, statusText: 'Offline' });
  }
}

// Risorse di piano di controllo: cache-first con rivalidazione in background.
async function staleWhileRevalidate(request) {
  const cache = await caches.open(TILE_CACHE);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then(async (response) => {
      if (response && response.ok) {
        await cache.put(request, response.clone());
        await trimTiles(TILE_CACHE, MAX_TILES);
      }
      return response;
    })
    .catch(() => null);
  if (cached) {
    // La risposta in rete continua in background: non blocca la risposta.
    void network;
    return cached;
  }
  const response = await network;
  return response || new Response('', { status: 504, statusText: 'Offline' });
}

let trimming = false;

async function trimTiles(cacheName = TILE_CACHE, limit = MAX_TILES) {
  if (trimming) return;
  trimming = true;
  try {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    if (keys.length <= limit) return;
    // Le risorse di piano di controllo non si sfrattano mai: anzi, se sono
    // in eccesso, si lascia uscire prima una tessera vecchia.
    const evictable = keys.filter((req) => {
      try {
        return !isCriticalMapResource(new URL(req.url));
      } catch (_) {
        return true;
      }
    });
    const excess = keys.length - limit;
    for (let i = 0; i < Math.min(excess, evictable.length); i++) {
      await cache.delete(evictable[i]);
    }
  } finally {
    trimming = false;
  }
}
