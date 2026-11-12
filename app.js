/* ============================================================
   Mappo — logica dell'applicazione
   ------------------------------------------------------------
   - Mappa OpenFreeMap (Leaflet + MapLibre GL, incluso in locale)
   - Dati salvati sul dispositivo (localStorage)
   - Categorie colorate, ricerca per nome, menu laterale
   - Import da link Google Maps, navigazione Waze / Google Maps
   ============================================================ */
(() => {
  'use strict';

  /* ----------------------------- Costanti ----------------------------- */

  // Chiavi di archivio: sono volutamente rimaste quelle del vecchio nome
  // "Luoghi del cuore" (prefisso ldc). Cambiarle farebbe perdere i luoghi
  // già salvati a chi usa l'app dal giorno della prima release.
  const STORAGE = {
    places: 'ldc.places.v1',
    categories: 'ldc.categories.v1',
    settings: 'ldc.settings.v1',
  };

  const DEFAULT_CATEGORIES = [
    { id: 'preferiti', name: 'Preferiti', color: '#e11d48', icon: '❤️', custom: false },
    { id: 'ristoranti', name: 'Ristoranti', color: '#f97316', icon: '🍽️', custom: false },
    { id: 'mare', name: 'Mare', color: '#0284c7', icon: '🌊', custom: false },
    { id: 'montagna', name: 'Montagna', color: '#16a34a', icon: '⛰️', custom: false },
    { id: 'citta', name: 'Città', color: '#7c3aed', icon: '🏙️', custom: false },
    { id: 'natura', name: 'Natura', color: '#65a30d', icon: '🌳', custom: false },
    { id: 'shopping', name: 'Shopping', color: '#db2777', icon: '🛍️', custom: false },
    { id: 'altro', name: 'Altro', color: '#64748b', icon: '📍', custom: false },
  ];

  const PALETTE = [
    '#e11d48', '#f97316', '#f59e0b', '#16a34a', '#0d9488',
    '#0284c7', '#6366f1', '#7c3aed', '#a855f7', '#db2777', '#64748b',
  ];

  const EMOJIS = [
    '❤️', '🍽️', '☕', '🍷', '🌊', '🏖️', '⛰️', '🌳',
    '🏙️', '🛍️', '🏠', '🎯', '🎉', '🚗', '🚲', '📍',
  ];

  const PLACE_STATUSES = ['da_visitare', 'visitato'];
  const STATUS_LABELS = {
    da_visitare: 'Da visitare',
    visitato: 'Visitato',
  };

  const OPENFREEMAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';
  const OPENFREEMAP_ATTR = '© <a href="https://openfreemap.org/" target="_blank" rel="noopener">OpenFreeMap</a> © <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a> dati <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';
  const NOMINATIM_REVERSE = 'https://nominatim.openstreetmap.org/reverse';
  const NOMINATIM_SEARCH = 'https://nominatim.openstreetmap.org/search';
  const ITALY_CENTER = [42.5, 12.5];

  const GEO_OPTIONS = { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 };
  const GEOCODE_INTERVAL = 1100; // Nominatim: max 1 richiesta al secondo
  const DEDUPE_METERS = 60;
  const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
  // Tetto sul numero di voci: un file valido ma enorme (elenco Takeout)
  // non deve bloccare la scheda durante l'anteprima e la deduplica.
  const MAX_IMPORT_PLACES = 5000;
  // Limite prudente: alcuni client di messaggistica troncano URL più lunghi.
  const MAX_SHARE_URL = 2000;
  const MAX_SHARE_TEXT = 4000;
  // Tetti sui link ricevuti, per non decodificare payload enormi o malevoli.
  const MAX_SHARE_TOKEN = 24000;
  const MAX_SHARE_BYTES = 512 * 1024;

  /* ----------------------------- Stato ------------------------------- */

  const state = {
    places: [],
    categories: [],
    settings: {},
    query: '',
    category: 'all',
    favoriteOnly: false,
    status: 'all',
    nearMe: false,
    currentPosition: null,
    editingId: null,
    draft: null,
    markers: new Map(),
    installPrompt: null,
  };

  let map = null;
  let positionMarker = null;
  let accuracyCircle = null;
  let viewSaveTimer = null;
  let flyToken = 0;
  let geocodeSeq = 0;
  let lastGeocodeAt = 0;
  let toastTimer = null;
  let toastHideTimer = null;
  let importRunning = false;
  let shareLinkPending = false;
  // Momento dell'ultima condivisione gestita: serve a non far comparire il
  // benvenuto sopra il form, senza disabilitare i link condivisi.
  let shareHandledAt = 0;

  const overlays = [];
  let historyOk = true;
  let historyBackPending = false;

  /* ----------------------------- Utility ----------------------------- */

  const $ = (id) => document.getElementById(id);

  function h(tag, props, ...children) {
    const el = document.createElement(tag);
    if (props) {
      for (const key of Object.keys(props)) {
        const value = props[key];
        if (value == null) continue;
        if (key === 'class') el.className = value;
        else if (key === 'text') el.textContent = value;
        else if (key === 'style' && typeof value === 'object') {
          for (const prop of Object.keys(value)) {
            if (prop.startsWith('--')) el.style.setProperty(prop, value[prop]);
            else el.style[prop] = value[prop];
          }
        }
        else if (key === 'dataset' && typeof value === 'object') Object.assign(el.dataset, value);
        else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
        else el.setAttribute(key, value);
      }
    }
    for (const child of children.flat()) {
      if (child == null || child === false) continue;
      el.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    }
    return el;
  }

  function svgIcon(name, cls = 'icon') {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', cls);
    svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', '#' + name);
    svg.appendChild(use);
    return svg;
  }

  function uid() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      try { return window.crypto.randomUUID(); } catch (_) { /* noop */ }
    }
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  function readJSON(key) {
    let raw = null;
    try {
      raw = localStorage.getItem(key);
    } catch (_) {
      return null;
    }
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (_) {
      // Conserva una copia del dato corrotto prima che una scrittura lo
      // sovrascriva. Chiave fissa: una sola copia per dato, niente accumulo.
      try {
        localStorage.setItem(key + '.corrupt', raw);
      } catch (_) { /* quota esaurita: nulla da fare */ }
      showToast('Dati locali danneggiati: ho salvato una copia di sicurezza', { tone: 'error', duration: 8000 });
      return null;
    }
  }

  function writeJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (err) {
      showToast('Spazio di archiviazione esaurito', { tone: 'error' });
      return false;
    }
  }

  function savePlaces() { return writeJSON(STORAGE.places, state.places); }
  function saveCategories() { return writeJSON(STORAGE.categories, state.categories); }
  function saveSettings() { return writeJSON(STORAGE.settings, state.settings); }

  function fold(text) {
    return String(text || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }

  // Il folding è costoso (normalize + regex): durante l'import viene
  // eseguito decine di migliaia di volte, quindi si memoizza per oggetto.
  const foldCache = new WeakMap();

  function foldedName(place) {
    if (!place || typeof place !== 'object') return fold(place && place.name);
    const raw = place.name;
    const cached = foldCache.get(place);
    // La cache vale solo per lo stesso testo: il nome di un luogo può
    // cambiare (modifica) e il valore salvato deve seguire il cambiamento.
    if (cached && cached.raw === raw) return cached.value;
    const value = fold(raw);
    foldCache.set(place, { raw, value });
    return value;
  }

  // Indice per nome normalizzato: evita di confrontare ogni coppia di
  // luoghi (e di normalizzare i nomi a ogni confronto) durante l'import.
  function buildNameIndex(list) {
    const index = new Map();
    for (const place of list) {
      const key = foldedName(place);
      const bucket = index.get(key);
      if (bucket) bucket.push(place);
      else index.set(key, [place]);
    }
    return index;
  }

  function findDuplicate(candidate, index) {
    const bucket = index.get(foldedName(candidate));
    if (!bucket) return null;
    for (const place of bucket) {
      if (haversine(candidate.lat, candidate.lng, place.lat, place.lng) <= DEDUPE_METERS) return place;
    }
    return null;
  }

  function foldMap(text) {
    let folded = '';
    const mapIdx = [];
    for (let i = 0; i < text.length; i++) {
      const base = text[i].normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      folded += base;
      for (let k = 0; k < base.length; k++) mapIdx.push(i);
    }
    return { folded, mapIdx };
  }

  function highlightInto(node, text, query) {
    const needle = fold(query);
    node.textContent = text;
    if (!needle) return;
    const { folded, mapIdx } = foldMap(text);
    const idx = folded.indexOf(needle);
    if (idx === -1) return;
    const start = mapIdx[idx];
    const end = mapIdx[Math.min(idx + needle.length - 1, mapIdx.length - 1)] + 1;
    node.textContent = '';
    node.appendChild(document.createTextNode(text.slice(0, start)));
    node.appendChild(h('mark', { text: text.slice(start, end) }));
    node.appendChild(document.createTextNode(text.slice(end)));
  }

  function formatCoord(value) {
    return Number(value).toFixed(5);
  }

  function haversine(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2
      + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  function formatDistance(meters) {
    if (meters < 950) return Math.round(meters / 10) * 10 + ' m';
    const km = meters / 1000;
    const text = km < 10 ? km.toFixed(1) : String(Math.round(km));
    return text.replace('.', ',') + ' km';
  }

  function sanitizeColor(value, fallback = '#64748b') {
    return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value.trim())
      ? value.trim().toLowerCase()
      : fallback;
  }

  function sanitizeEmoji(value) {
    return typeof value === 'string' && EMOJIS.includes(value) ? value : '📍';
  }

  function getCategory(id) {
    return state.categories.find((c) => c.id === id)
      || DEFAULT_CATEGORIES.find((c) => c.id === id)
      || DEFAULT_CATEGORIES[DEFAULT_CATEGORIES.length - 1];
  }

  function getPlace(id) {
    return state.places.find((p) => p.id === id) || null;
  }

  function orderedCategories() {
    const defaults = DEFAULT_CATEGORIES
      .map((d) => state.categories.find((c) => c.id === d.id))
      .filter(Boolean);
    const customs = state.categories
      .filter((c) => !DEFAULT_CATEGORIES.some((d) => d.id === c.id))
      .sort((a, b) => a.name.localeCompare(b.name, 'it'));
    return [...defaults, ...customs];
  }

  /* --------------------------- Persistenza --------------------------- */

  function makeCategory(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const id = String(raw.id || '').trim().slice(0, 40) || 'cat-' + uid();
    return {
      id,
      name: String(raw.name || 'Categoria').trim().slice(0, 40) || 'Categoria',
      color: sanitizeColor(raw.color),
      icon: sanitizeEmoji(raw.icon),
      custom: Boolean(raw.custom),
    };
  }

  function parseCoordinate(value) {
    if (typeof value === 'number') return value;
    if (typeof value === 'string' && value.trim() !== '') return Number(value.trim());
    return NaN;
  }

  function sanitizePlace(raw, categories = state.categories) {
    if (!raw || typeof raw !== 'object') return null;
    const lat = parseCoordinate(raw.lat);
    const lng = parseCoordinate(raw.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
    const name = String(raw.name || '').trim().slice(0, 120) || 'Luogo senza nome';
    const categoryId = categories.some((c) => c.id === raw.categoryId) ? raw.categoryId : 'altro';
    return {
      favorite: raw.favorite === true,
      status: PLACE_STATUSES.includes(raw.status) ? raw.status : null,
      id: typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim().slice(0, 64) : uid(),
      name,
      categoryId,
      note: String(raw.note || '').slice(0, 1000),
      address: String(raw.address || '').slice(0, 300),
      lat,
      lng,
      createdAt: Number(raw.createdAt) || Date.now(),
      updatedAt: Number(raw.updatedAt) || Date.now(),
    };
  }

  function loadData() {
    const storedCats = readJSON(STORAGE.categories);
    let cats = Array.isArray(storedCats) ? storedCats.map(makeCategory).filter(Boolean) : [];
    for (const def of DEFAULT_CATEGORIES) {
      if (!cats.some((c) => c.id === def.id)) cats.push({ ...def });
    }
    const seen = new Set();
    state.categories = cats.filter((c) => (seen.has(c.id) ? false : seen.add(c.id)));

    const storedPlaces = readJSON(STORAGE.places);
    const seenPlaces = new Set();
    state.places = (Array.isArray(storedPlaces) ? storedPlaces : [])
      .map((raw) => sanitizePlace(raw))
      .filter((place) => place && (seenPlaces.has(place.id) ? false : seenPlaces.add(place.id)));

    const settings = readJSON(STORAGE.settings);
    state.settings = settings && typeof settings === 'object' ? settings : {};
  }

  /* ------------------------------ Mappa ------------------------------ */

  function initMap() {
    if (typeof maplibregl !== 'undefined' && typeof maplibregl.setWorkerUrl === 'function') {
      maplibregl.setWorkerUrl('./vendor/maplibre/maplibre-gl-csp-worker.js');
    }

    map = L.map('map', {
      zoomControl: false,
      attributionControl: true,
      minZoom: 2,
      maxZoom: 19,
      worldCopyJump: true,
      zoomSnap: 0.5,
      fadeAnimation: true,
      zoomAnimation: true,
    });

    // La vista va impostata prima di aggiungere il layer GL: il plugin
    // costruisce la mappa MapLibre usando il centro e lo zoom correnti,
    // che senza setView sarebbero indefiniti (NaN) e il rendering non
    // partirebbe.
    const view = state.settings.view;
    if (view && Number.isFinite(view.lat) && Number.isFinite(view.lng) && Number.isFinite(view.zoom)) {
      map.setView([view.lat, view.lng], view.zoom);
    } else {
      map.setView(ITALY_CENTER, 6);
    }

    // Il layer GL è l'unico punto in cui la mappa può fallire (file vendor
    // mancanti, deploy parziale, cache corrotta): in quel caso l'app deve
    // restare comunque usabile.
    if (typeof L.maplibreGL !== 'function') {
      showToast('Mappa non disponibile: i file di MapLibre non sono stati caricati', { tone: 'error', duration: 10000 });
    } else {
      try {
        L.maplibreGL({
          style: OPENFREEMAP_STYLE,
          attributionControl: { customAttribution: OPENFREEMAP_ATTR },
          // Leaflet usa worldCopyJump: MapLibre deve mostrare un solo mondo,
          // altrimenti marker e mappa si disallineano oltre l'antimeridiano.
          renderWorldCopies: false,
        }).addTo(map);
      } catch (err) {
        console.error('[map] layer GL non inizializzato', err);
        showToast('Mappa non disponibile', { tone: 'error', duration: 10000 });
      }
    }

    L.control.zoom({ position: 'bottomleft' }).addTo(map);
    if (map.attributionControl) map.attributionControl.setPosition('bottomright');

    map.on('moveend', () => {
      clearTimeout(viewSaveTimer);
      viewSaveTimer = setTimeout(() => {
        const c = map.getCenter();
        state.settings.view = { lat: c.lat, lng: c.lng, zoom: map.getZoom() };
        saveSettings();
      }, 500);
    });

    bindMapGestures();
  }

  function userIcon() {
    return L.divIcon({
      className: 'user-marker',
      html: '<span class="user-dot"></span>',
      iconSize: [24, 24],
      iconAnchor: [12, 12],
    });
  }

  function showPositionOnMap(position) {
    const { latitude, longitude, accuracy } = position.coords;
    const latlng = [latitude, longitude];
    state.currentPosition = { lat: latitude, lng: longitude, accuracy, at: Date.now() };
    if (!map) return;
    if (!positionMarker) {
      positionMarker = L.marker(latlng, {
        icon: userIcon(),
        interactive: false,
        keyboard: false,
        zIndexOffset: 1200,
      }).addTo(map);
    } else {
      positionMarker.setLatLng(latlng);
    }
    if (!accuracyCircle) {
      accuracyCircle = L.circle(latlng, {
        radius: Math.max(accuracy || 30, 20),
        color: '#0284c7',
        weight: 1,
        fillColor: '#0284c7',
        fillOpacity: 0.08,
        interactive: false,
      }).addTo(map);
    } else {
      accuracyCircle.setLatLng(latlng);
      accuracyCircle.setRadius(Math.max(accuracy || 30, 20));
    }
  }

  /* --------------------------- Marker e pin -------------------------- */

  function makeMarkerIcon(place) {
    const cat = getCategory(place.categoryId);
    const html = '<div class="pin-wrap">'
      + '<svg viewBox="0 0 40 52" aria-hidden="true">'
      + '<path d="M20 1.4C9.8 1.4 1.4 9.8 1.4 20c0 13.9 18.6 30.6 18.6 30.6S38.6 33.9 38.6 20C38.6 9.8 30.2 1.4 20 1.4Z" '
      + 'fill="' + cat.color + '" stroke="#fff" stroke-width="2.6"/></svg>'
      + '<span class="pin-emoji">' + cat.icon + '</span></div>';
    return L.divIcon({
      className: 'place-marker',
      html,
      iconSize: [40, 52],
      iconAnchor: [20, 51],
      popupAnchor: [0, -47],
    });
  }

  function renderMarkers() {
    for (const marker of state.markers.values()) marker.remove();
    state.markers.clear();
    // Senza mappa non ci sono marker da mostrare, ma l'app resta viva.
    if (!map) return;

    for (const place of state.places) {
      const marker = L.marker([place.lat, place.lng], {
        icon: makeMarkerIcon(place),
        title: place.name,
        alt: place.name,
        keyboard: true,
        riseOnHover: true,
      });
      marker.bindPopup(() => buildPopup(place.id), {
        maxWidth: 320,
        minWidth: 240,
        autoPanPaddingTopLeft: L.point(16, 86),
        autoPanPaddingBottomRight: L.point(16, 24),
        className: 'place-popup',
      });
      marker.on('click', () => highlightMarker(place.id));
      marker.on('popupclose', () => highlightMarker(null));
      marker.addTo(map);
      state.markers.set(place.id, marker);
    }
    applyMarkerFilter();
  }

  function highlightMarker(id) {
    for (const [markerId, marker] of state.markers) {
      const el = marker.getElement();
      if (!el) continue;
      el.classList.toggle('is-selected', markerId === id);
    }
  }

  function applyMarkerFilter() {
    const visible = new Set(getFilteredPlaces().map((p) => p.id));
    for (const [id, marker] of state.markers) {
      const el = marker.getElement();
      if (!el) continue;
      const show = visible.has(id);
      el.classList.toggle('is-hidden', !show);
      if (show) {
        el.setAttribute('tabindex', '0');
        el.removeAttribute('aria-hidden');
      } else {
        marker.closePopup();
        el.setAttribute('tabindex', '-1');
        el.setAttribute('aria-hidden', 'true');
      }
    }
  }

  /* --------------------------- Popup luogo --------------------------- */

  function buildPopup(placeId) {
    const place = getPlace(placeId);
    if (!place) return h('div', { class: 'popup-card', text: 'Luogo non disponibile' });
    const cat = getCategory(place.categoryId);

    const head = h('div', { class: 'popup-head' },
      h('span', { class: 'popup-icon', style: { '--c': cat.color }, text: cat.icon }),
      h('div', {},
        h('h3', { class: 'popup-title', text: place.name }),
        h('span', { class: 'popup-cat', style: { '--c': cat.color }, text: cat.name })
      )
    );

    const card = h('div', { class: 'popup-card' }, head);

    if (place.address) {
      card.appendChild(h('p', { class: 'popup-address' }, svgIcon('i-pin'), h('span', { text: place.address })));
    }
    if (place.note) {
      card.appendChild(h('div', { class: 'popup-note', text: place.note }));
    }

    const navBtn = (label, icon, onClick) => h('button', {
      type: 'button', class: 'btn soft', onclick: onClick,
    }, svgIcon(icon), h('span', { text: label }));

    card.appendChild(h('div', { class: 'popup-nav' },
      navBtn('Waze', 'i-navigate', () => openNavigation('waze', place)),
      navBtn('Google Maps', 'i-map', () => openNavigation('gmaps', place))
    ));

    const tool = (label, icon, onClick, cls) => h('button', {
      type: 'button', class: cls || '', onclick: onClick, 'aria-label': label,
    }, svgIcon(icon), h('span', { text: label }));

    card.appendChild(h('div', { class: 'popup-tools' },
      tool('Modifica', 'i-edit', () => startEditPlace(place)),
      tool('Condividi', 'i-share', () => sharePlace(place)),
      tool('Elimina', 'i-trash', () => confirmDelete(place), 'danger')
    ));

    return card;
  }

  function openNavigation(kind, place) {
    const lat = Number(place.lat).toFixed(6);
    const lng = Number(place.lng).toFixed(6);
    const url = kind === 'waze'
      ? 'https://waze.com/ul?ll=' + lat + ',' + lng + '&navigate=yes&zoom=17'
      : 'https://www.google.com/maps/dir/?api=1&destination=' + lat + ',' + lng + '&travelmode=driving';
    window.open(url, '_blank', 'noopener');
  }

  async function sharePlace(place) {
    const url = 'https://www.google.com/maps/search/?api=1&query=' + place.lat + ',' + place.lng;
    const text = place.name + (place.address ? ' — ' + place.address : '');
    if (navigator.share) {
      try {
        await navigator.share({ title: place.name, text, url });
        return;
      } catch (err) {
        if (err && err.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(text + '\n' + url);
      showToast('Link copiato negli appunti', { tone: 'success' });
    } catch (_) {
      showToast('Impossibile condividere il luogo', { tone: 'error' });
    }
  }

  /* ----------------------- Ricerca e filtro ------------------------ */

  function matchesQuery(place, needle) {
    if (!needle) return true;
    // foldedName riusa il folding memoizzato: la ricerca rifà questo passaggio
    // per ogni luogo a ogni tasto.
    if (foldedName(place).includes(needle)) return true;
    if (place.note && fold(place.note).includes(needle)) return true;
    if (place.address && fold(place.address).includes(needle)) return true;
    if (fold(getCategory(place.categoryId).name).includes(needle)) return true;
    return false;
  }

  function matchesQuickFilters(place) {
    if (state.favoriteOnly && !place.favorite) return false;
    if (state.status !== 'all' && place.status !== state.status) return false;
    return true;
  }

  function hasActiveFilters() {
    return Boolean(state.query) || state.category !== 'all' || state.favoriteOnly || state.status !== 'all';
  }

  function getFilteredPlaces() {
    const needle = fold(state.query);
    const filtered = state.places
      .filter((p) => (state.category === 'all' || p.categoryId === state.category)
        && matchesQuickFilters(p)
        && matchesQuery(p, needle));

    if (state.nearMe && state.currentPosition) {
      const { lat, lng } = state.currentPosition;
      return filtered
        .map((place) => ({ place, meters: haversine(lat, lng, place.lat, place.lng) }))
        .sort((a, b) => (a.meters - b.meters)
          || a.place.name.localeCompare(b.place.name, 'it', { sensitivity: 'base', numeric: true }))
        .map((entry) => entry.place);
    }

    return filtered
      .sort((a, b) => a.name.localeCompare(b.name, 'it', { sensitivity: 'base', numeric: true }));
  }

  /* --------------------------- Rendering --------------------------- */

  function renderChips() {
    const needle = fold(state.query);
    const base = state.places.filter((p) => matchesQuickFilters(p) && matchesQuery(p, needle));
    const counts = new Map();
    for (const p of base) counts.set(p.categoryId, (counts.get(p.categoryId) || 0) + 1);

    const frag = document.createDocumentFragment();
    frag.appendChild(h('button', {
      type: 'button',
      class: 'chip' + (state.category === 'all' ? ' active' : ''),
      onclick: () => setCategory('all'),
    }, h('span', { text: 'Tutti' }), h('span', { class: 'chip-count', text: String(base.length) })));

    for (const cat of orderedCategories()) {
      const count = counts.get(cat.id) || 0;
      if (count === 0 && state.category !== cat.id) continue;
      frag.appendChild(h('button', {
        type: 'button',
        class: 'chip' + (state.category === cat.id ? ' active' : '') + (count === 0 ? ' zero' : ''),
        style: { '--c': cat.color },
        onclick: () => setCategory(cat.id),
      },
        h('span', { class: 'chip-dot' }),
        h('span', { text: cat.name }),
        h('span', { class: 'chip-count', text: String(count) })
      ));
    }

    const chips = $('chips');
    chips.textContent = '';
    chips.appendChild(frag);
  }

  function setFilterPressed(button, pressed) {
    button.classList.toggle('is-on', pressed);
    button.setAttribute('aria-pressed', String(pressed));
  }

  function renderFilters() {
    setFilterPressed($('filterFavorites'), state.favoriteOnly);
    setFilterPressed($('filterTodo'), state.status === 'da_visitare');
    setFilterPressed($('filterDone'), state.status === 'visitato');
  }

  function renderNearMe() {
    const btn = $('btnNearMe');
    if (!btn) return;
    btn.classList.toggle('is-on', state.nearMe);
    btn.setAttribute('aria-pressed', String(state.nearMe));
    const label = btn.querySelector('span');
    if (label) label.textContent = state.nearMe ? 'Più vicini' : 'Vicino a me';
    btn.setAttribute('aria-label', state.nearMe
      ? 'Disattiva l\'ordinamento per distanza'
      : 'Ordina i luoghi dal più vicino');
  }

  function toggleFavoritesFilter() {
    state.favoriteOnly = !state.favoriteOnly;
    renderFilters();
    renderChips();
    renderList();
  }

  function toggleStatusFilter(status) {
    state.status = state.status === status ? 'all' : status;
    renderFilters();
    renderChips();
    renderList();
  }

  function renderList() {
    const list = $('placeList');
    const filtered = getFilteredPlaces();
    list.textContent = '';
    list.scrollTop = 0;

    if (state.places.length === 0) {
      list.appendChild(emptyState({
        icon: 'i-heart',
        title: 'Nessun luogo salvato',
        text: 'Tocca il pulsante + oppure tieni premuto sulla mappa per aggiungere il tuo primo posto del cuore.',
        actionLabel: 'Aggiungi un luogo',
        onAction: () => closeOverlayThen('drawer', startAddPlaceFromCenter),
      }));
    } else if (filtered.length === 0) {
      list.appendChild(emptyState({
        icon: 'i-search',
        title: 'Nessun risultato',
        text: 'Prova con un altro nome o cambia categoria per ritrovare il tuo luogo.',
        actionLabel: 'Mostra tutti',
        onAction: () => {
          $('searchInput').value = '';
          state.query = '';
          state.category = 'all';
          state.favoriteOnly = false;
          state.status = 'all';
          $('btnClearSearch').hidden = true;
          renderFilters();
          renderChips();
          renderList();
        },
      }));
    } else {
      for (const place of filtered) list.appendChild(listItem(place));
    }

    const count = filtered.length;
    $('placeCount').textContent = String(count);
    if (state.places.length === 0) {
      $('topbarSub').textContent = 'La tua mappa personale';
    } else if (hasActiveFilters()) {
      $('topbarSub').textContent = count === 1 ? '1 luogo trovato' : count + ' luoghi trovati';
    } else {
      const total = state.places.length;
      $('topbarSub').textContent = total === 1 ? '1 luogo salvato' : total + ' luoghi salvati';
    }

    applyMarkerFilter();
  }

  function createStatusSelect(value, onChange, ariaLabel, cls = '') {
    const select = h('select', {
      class: 'status-select' + (cls ? ' ' + cls : ''),
      'aria-label': ariaLabel,
      onchange: () => onChange(select.value || null),
    },
      h('option', { value: '', text: 'Nessuno' }),
      h('option', { value: 'da_visitare', text: 'Da visitare' }),
      h('option', { value: 'visitato', text: 'Visitato' })
    );
    select.value = PLACE_STATUSES.includes(value) ? value : '';
    return select;
  }

  function renderListPreservingScroll() {
    const list = $('placeList');
    const top = list.scrollTop;
    renderList();
    list.scrollTop = top;
  }

  function toggleFavorite(place) {
    const next = !place.favorite;
    place.favorite = next;
    place.updatedAt = Date.now();
    if (!savePlaces()) {
      place.favorite = !next;
      return;
    }
    renderChips();
    renderListPreservingScroll();
  }

  function setPlaceStatus(place, status) {
    const next = PLACE_STATUSES.includes(status) ? status : null;
    if (place.status === next) return;
    const previous = place.status;
    place.status = next;
    place.updatedAt = Date.now();
    if (!savePlaces()) {
      place.status = previous;
    }
    renderChips();
    renderListPreservingScroll();
  }

  function listItem(place) {
    const cat = getCategory(place.categoryId);
    const metaParts = [cat.name];
    if (place.status) metaParts.push(STATUS_LABELS[place.status]);
    if (place.address) metaParts.push(place.address);
    const meta = metaParts.join(' · ');

    let distanceEl = null;
    if (state.currentPosition) {
      const meters = haversine(state.currentPosition.lat, state.currentPosition.lng, place.lat, place.lng);
      distanceEl = h('span', { class: 'place-dist', text: formatDistance(meters) });
    } else {
      distanceEl = svgIcon('i-chevron-right', 'icon chev');
    }

    const nameEl = h('span', { class: 'place-name' });
    highlightInto(nameEl, place.name, state.query);

    const main = h('button', {
      type: 'button',
      class: 'place-item',
      dataset: { id: place.id },
      onclick: () => selectPlace(place.id),
    },
      h('span', { class: 'place-icon', style: { '--c': cat.color }, text: cat.icon }),
      h('span', { class: 'place-text' }, nameEl, h('span', { class: 'place-meta', text: meta })),
      distanceEl
    );

    const favBtn = h('button', {
      type: 'button',
      class: 'fav-btn' + (place.favorite ? ' is-favorite' : ''),
      'aria-pressed': String(Boolean(place.favorite)),
      'aria-label': place.favorite
        ? 'Rimuovi ' + place.name + ' dai preferiti'
        : 'Aggiungi ' + place.name + ' ai preferiti',
      onclick: () => toggleFavorite(place),
    }, svgIcon('i-star'));

    const statusSelect = createStatusSelect(
      place.status,
      (value) => setPlaceStatus(place, value),
      'Stato di ' + place.name
    );

    return h('div', { class: 'place-row' }, main, favBtn, statusSelect);
  }

  function emptyState({ icon, title, text, actionLabel, onAction }) {
    return h('div', { class: 'empty' },
      h('span', { class: 'empty-art' }, svgIcon(icon)),
      h('h3', { text: title }),
      h('p', { text }),
      h('button', { type: 'button', class: 'btn primary', onclick: onAction },
        svgIcon('i-plus'), h('span', { text: actionLabel }))
    );
  }

  function renderAll() {
    renderMarkers();
    renderChips();
    renderFilters();
    renderNearMe();
    renderList();
  }

  function setCategory(id) {
    state.category = id;
    renderChips();
    renderList();
  }

  function selectPlace(id) {
    const place = getPlace(id);
    if (!place) return;
    requestCloseOverlay('drawer');
    document.querySelectorAll('.place-item').forEach((el) => {
      el.classList.toggle('is-selected', el.dataset.id === id);
    });
    highlightMarker(id);
    if (!map) return;
    const token = ++flyToken;
    map.flyTo([place.lat, place.lng], Math.max(map.getZoom(), 15), { duration: 0.7 });
    setTimeout(() => {
      if (token !== flyToken) return;
      const marker = state.markers.get(id);
      if (marker) marker.openPopup();
    }, 740);
  }

  /* ------------------------- Gestione overlay ------------------------ */

  function openOverlay(kind, onClose) {
    if (overlays.some((o) => o.kind === kind)) return;
    overlays.push({ kind, onClose, focus: document.activeElement });
    if (historyOk) {
      try {
        history.pushState({ overlay: kind }, '');
      } catch (_) {
        historyOk = false;
      }
    }
  }

  function requestCloseOverlay(kind) {
    if (!overlays.length) return;
    const top = overlays[overlays.length - 1];
    if (kind && top.kind !== kind) return;
    // Un history.back() per volta: due back in rapidissima successione
    // porterebbero l'utente fuori dall'app (schermata precedente).
    if (historyBackPending) return;
    if (historyOk) {
      historyBackPending = true;
      history.back();
      setTimeout(() => { historyBackPending = false; }, 800);
    } else {
      overlays.pop();
      top.onClose();
      syncOverlayState();
      focusIfVisible(top.focus);
    }
  }

  // Chiude un overlay e attende che la cronologia sia tornata indietro
  // prima di aprire il successivo (evita conflitti con il tasto Indietro).
  function closeOverlayThen(kind, callback) {
    const top = overlays[overlays.length - 1];
    if (!top || top.kind !== kind) {
      callback();
      return;
    }
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      window.removeEventListener('popstate', onPop);
      callback();
    };
    const onPop = () => setTimeout(finish, 0);
    window.addEventListener('popstate', onPop);
    requestCloseOverlay(kind);
    if (!overlays.some((o) => o.kind === kind)) {
      finish();
      return;
    }
    // L'overlay non si è ancora chiuso: il callback viene eseguito solo
    // quando è davvero chiuso, così non resta aperto sotto il nuovo form.
    setTimeout(() => {
      if (!overlays.some((o) => o.kind === kind)) finish();
    }, 650);
  }

  window.addEventListener('popstate', () => {
    historyBackPending = false;
    const entry = overlays.pop();
    if (entry) entry.onClose();
    syncOverlayState();
    if (entry) focusIfVisible(entry.focus);
  });

  // Mantiene coerenti visibilità, inert e focus trap degli overlay.
  function syncOverlayState() {
    const top = overlays.length ? overlays[overlays.length - 1].kind : null;
    const drawer = $('drawer');
    const sheet = $('sheet');
    const drawerOpen = drawer.classList.contains('open');
    const sheetOpen = sheet.classList.contains('open');

    drawer.inert = !(drawerOpen && top === 'drawer');
    sheet.inert = !(sheetOpen && top === 'sheet');

    const picking = $('app').classList.contains('picking');
    const blockBackground = top !== null && !picking;
    for (const el of [$('map'), $('offlineBadge'), document.querySelector('.topbar'), document.querySelector('.map-fabs')]) {
      if (el) el.inert = blockBackground;
    }

    $('scrim').classList.toggle('show', drawerOpen || sheetOpen);
  }

  function focusIfVisible(el) {
    if (!el || !document.contains(el) || typeof el.focus !== 'function') return;
    if (el.closest('[inert]')) return;
    if (typeof el.checkVisibility === 'function') {
      if (!el.checkVisibility({ checkVisibilityCSS: true, checkOpacity: true })) return;
    } else if (el.offsetParent === null) {
      return;
    }
    el.focus({ preventScroll: true });
  }

  function updateScrim() {
    syncOverlayState();
  }

  /* ----------------------------- Drawer ------------------------------ */

  function showDrawer() {
    const drawer = $('drawer');
    drawer.classList.add('open');
    drawer.inert = false;
    drawer.setAttribute('aria-hidden', 'false');
    $('btnMenu').setAttribute('aria-expanded', 'true');
    updateScrim();
  }

  function hideDrawer() {
    const drawer = $('drawer');
    drawer.classList.remove('open');
    drawer.inert = true;
    drawer.setAttribute('aria-hidden', 'true');
    $('btnMenu').setAttribute('aria-expanded', 'false');
    updateScrim();
  }

  function openDrawer({ focusSearch = false } = {}) {
    if (overlays.some((o) => o.kind === 'drawer')) {
      if (focusSearch) setTimeout(() => $('searchInput').focus(), 50);
      return;
    }
    openOverlay('drawer', hideDrawer);
    showDrawer();
    if (focusSearch) {
      setTimeout(() => $('searchInput').focus({ preventScroll: true }), 320);
    } else {
      setTimeout(() => {
        if ($('drawer').classList.contains('open')) $('btnCloseDrawer').focus({ preventScroll: true });
      }, 320);
    }
  }

  /* --------------------------- Bottom sheet -------------------------- */

  function showSheet() {
    const sheet = $('sheet');
    sheet.inert = false;
    sheet.setAttribute('aria-hidden', 'false');
    sheet.classList.add('open');
    updateScrim();
  }

  function hideSheet() {
    const sheet = $('sheet');
    sheet.classList.remove('open');
    sheet.inert = true;
    sheet.setAttribute('aria-hidden', 'true');
    updateScrim();
  }

  function resetSheetTitles(editing) {
    $('sheetEyebrow').textContent = editing ? 'Modifica' : 'Nuovo luogo';
    $('sheetTitle').textContent = editing ? 'Modifica luogo' : 'Aggiungi un luogo';
    $('btnSavePlaceLabel').textContent = editing ? 'Salva modifiche' : 'Salva luogo';
    $('btnDeletePlace').hidden = !editing;
  }

  function startAddPlace({ lat, lng, address = '', name = '' } = {}) {
    // Il form aperto assorbe i tocchi successivi: evita che un long-press
    // e un tocco consecutivo aprano due form.
    if ($('sheet').classList.contains('open')) return;

    // Senza mappa il luogo viene salvato con le coordinate fornite.
    const center = map ? map.getCenter() : { lat: ITALY_CENTER[0], lng: ITALY_CENTER[1] };
    state.editingId = null;
    state.draft = {
      lat: Number.isFinite(lat) ? lat : center.lat,
      lng: Number.isFinite(lng) ? lng : center.lng,
      address,
      moved: false,
    };

    $('placeForm').reset();
    $('nameError').hidden = true;
    $('gmapsError').hidden = true;
    $('placeName').value = name;
    $('placeNote').value = '';
    $('placeStatus').value = '';
    setFavoriteUI(false);
    renderCategorySelect(state.settings.lastCategory || 'preferiti');
    resetSheetTitles(false);
    updateDraftUI();
    openSheetOverlay(true);
    if (!address) geocodeDraft();
  }

  function startAddPlaceFromCenter() {
    startAddPlace({});
  }

  function startEditPlace(place) {
    if (!place) return;
    if (map) map.closePopup();
    state.editingId = place.id;
    state.draft = { lat: place.lat, lng: place.lng, address: place.address || '', moved: false };
    $('placeForm').reset();
    $('nameError').hidden = true;
    $('gmapsError').hidden = true;
    $('placeName').value = place.name;
    $('placeNote').value = place.note || '';
    $('placeStatus').value = PLACE_STATUSES.includes(place.status) ? place.status : '';
    setFavoriteUI(place.favorite);
    renderCategorySelect(place.categoryId);
    resetSheetTitles(true);
    updateDraftUI();
    openSheetOverlay(true);
    if (!place.address) geocodeDraft();
  }

  function openSheetOverlay(focusName) {
    if (!overlays.some((o) => o.kind === 'sheet')) {
      openOverlay('sheet', () => {
        resetPickUI();
        hideSheet();
        state.editingId = null;
        state.draft = null;
      });
    }
    showSheet();
    if (focusName) {
      setTimeout(() => {
        const input = $('placeName');
        if (input.offsetParent !== null) input.focus({ preventScroll: true });
      }, 340);
    }
  }

  function closeSheet() {
    requestCloseOverlay('sheet');
  }

  function setFavoriteUI(value) {
    const button = $('btnFavorite');
    const on = Boolean(value);
    button.classList.toggle('is-active', on);
    button.setAttribute('aria-pressed', String(on));
  }

  function isFavoriteSelected() {
    return $('btnFavorite').getAttribute('aria-pressed') === 'true';
  }

  function renderCategorySelect(selectedId) {
    const select = $('placeCategory');
    select.textContent = '';
    for (const cat of orderedCategories()) {
      select.appendChild(h('option', { value: cat.id, text: cat.icon + '  ' + cat.name }));
    }
    if (selectedId && state.categories.some((c) => c.id === selectedId)) {
      select.value = selectedId;
    }
  }

  function updateDraftUI() {
    const draft = state.draft;
    if (!draft) {
      $('coordsValue').textContent = '—';
      $('coordsAddress').textContent = 'Scegli un punto sulla mappa';
      return;
    }
    $('coordsValue').textContent = formatCoord(draft.lat) + ', ' + formatCoord(draft.lng);
    $('coordsAddress').textContent = draft.address || 'Posizione pronta';
  }

  function setDraftCoords(lat, lng, address = '') {
    state.draft = { lat, lng, address, moved: true };
    updateDraftUI();
    geocodeSeq++;
  }

  /* --------------------------- Geocodifica --------------------------- */

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function formatAddress(data) {
    if (!data) return '';
    const a = data.address || {};
    const parts = [
      a.road || a.pedestrian || a.footway || a.place || a.neighbourhood,
      a.house_number,
      a.city || a.town || a.village || a.municipality || a.county,
      a.state,
      a.country,
    ].filter(Boolean);
    const clean = parts.filter((v, i) => parts.indexOf(v) === i);
    return clean.join(', ').slice(0, 300);
  }

  let geocodeChain = Promise.resolve();

  // Serializza le richieste: evita che due geocodifiche concorrenti aggirino il rate limit.
  function reverseGeocode(lat, lng) {
    const task = geocodeChain.then(() => reverseGeocodeNow(lat, lng));
    geocodeChain = task.then(() => undefined, () => undefined);
    return task;
  }

  async function reverseGeocodeNow(lat, lng) {
    const wait = Math.max(0, GEOCODE_INTERVAL - (Date.now() - lastGeocodeAt));
    if (wait) await sleep(wait);
    lastGeocodeAt = Date.now();

    const url = NOMINATIM_REVERSE + '?format=jsonv2&lat=' + lat + '&lon=' + lng
      + '&zoom=18&addressdetails=1&accept-language=it';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 9000);
    try {
      const res = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
      if (!res.ok) return '';
      const data = await res.json();
      return formatAddress(data);
    } catch (_) {
      return '';
    } finally {
      clearTimeout(timer);
    }
  }

  // Ricerca diretta (nome/indirizzo) usata dall'import CSV senza coordinate.
  function forwardGeocode(query) {
    const task = geocodeChain.then(() => forwardGeocodeNow(query));
    geocodeChain = task.then(() => undefined, () => undefined);
    return task;
  }

  async function forwardGeocodeNow(query) {
    const text = cleanText(query, 300);
    if (!text) return null;
    const wait = Math.max(0, GEOCODE_INTERVAL - (Date.now() - lastGeocodeAt));
    if (wait) await sleep(wait);
    lastGeocodeAt = Date.now();

    const url = NOMINATIM_SEARCH + '?format=jsonv2&limit=1&addressdetails=1&accept-language=it&q='
      + encodeURIComponent(text);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 9000);
    try {
      const res = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
      if (!res.ok) return null;
      const data = await res.json();
      if (!Array.isArray(data) || data.length === 0) return null;
      const first = data[0];
      const lat = Number(first.lat);
      const lng = Number(first.lon);
      if (!validLatLng(lat, lng)) return null;
      return { lat, lng, address: formatAddress(first) };
    } catch (_) {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  async function geocodeDraft() {
    const draft = state.draft;
    if (!draft) return;
    const seq = ++geocodeSeq;
    $('coordsAddress').textContent = 'Recupero indirizzo…';
    const address = await reverseGeocode(draft.lat, draft.lng);
    if (seq !== geocodeSeq || !state.draft) return;
    if (address) state.draft.address = address;
    updateDraftUI();
  }

  async function geocodePlaceAfterSave(place) {
    const address = await reverseGeocode(place.lat, place.lng);
    const current = getPlace(place.id);
    if (!current || !address) return;
    current.address = address;
    savePlaces();
    renderList();
  }

  /* --------------------------- Pick on map --------------------------- */

  function updatePickCoords() {
    if (!map) return;
    const c = map.getCenter();
    $('pickCoords').textContent = formatCoord(c.lat) + ', ' + formatCoord(c.lng);
  }

  function enterPickMode() {
    hideSheet();
    if (!map) {
      showToast('Scegliere sulla mappa non è disponibile', { tone: 'error' });
      return;
    }
    $('app').classList.add('picking');
    $('crosshair').hidden = false;
    $('pickBar').hidden = false;
    if (state.draft) {
      map.setView([state.draft.lat, state.draft.lng], Math.max(map.getZoom(), 16));
    }
    updatePickCoords();
    map.on('move', updatePickCoords);
    syncOverlayState();
  }

  function resetPickUI() {
    $('app').classList.remove('picking');
    $('crosshair').hidden = true;
    $('pickBar').hidden = true;
    if (map) map.off('move', updatePickCoords);
    syncOverlayState();
  }

  function exitPickMode() {
    resetPickUI();
    if (!overlays.some((o) => o.kind === 'sheet')) openSheetOverlay(false);
    else showSheet();
  }

  /* --------------------------- Geolocalizzazione --------------------- */

  function getPosition() {
    return new Promise((resolve, reject) => {
      if (!('geolocation' in navigator)) {
        reject(new Error('unsupported'));
        return;
      }
      navigator.geolocation.getCurrentPosition(resolve, reject, GEO_OPTIONS);
    });
  }

  function geoErrorMessage(err) {
    if (!err) return 'Posizione non disponibile: riprova tra poco';
    if (err.message === 'unsupported') return 'Questo dispositivo o browser non supporta la geolocalizzazione';
    switch (err.code) {
      case 1: return 'Permesso posizione negato: consentilo nelle impostazioni del browser per usare “Vicino a me”';
      case 2: return 'Posizione non disponibile: controlla GPS e connessione, poi riprova';
      case 3: return 'Tempo scaduto: non è stato possibile ottenere la posizione, riprova';
      default: return 'Posizione non disponibile: riprova tra poco';
    }
  }

  async function locateUser({ quiet = false } = {}) {
    const btn = $('btnLocate');
    btn.classList.add('busy');
    try {
      const position = await getPosition();
      showPositionOnMap(position);
      btn.classList.add('is-active');
      if (map) map.flyTo([position.coords.latitude, position.coords.longitude], Math.max(map.getZoom(), 16), { duration: 0.8 });
      renderList();
      if (!quiet) showToast('Posizione aggiornata', { tone: 'success' });
      return state.currentPosition;
    } catch (err) {
      if (!quiet) showToast(geoErrorMessage(err), { tone: 'error' });
      return null;
    } finally {
      btn.classList.remove('busy');
    }
  }

  async function toggleNearMe() {
    if (state.nearMe) {
      state.nearMe = false;
      renderNearMe();
      renderListPreservingScroll();
      showToast('Ordinamento per distanza disattivato');
      return;
    }
    if (state.places.length === 0) {
      showToast('Non ci sono luoghi da ordinare', { tone: 'error' });
      return;
    }

    const btn = $('btnNearMe');
    btn.classList.add('busy');
    try {
      const fresh = state.currentPosition
        && Date.now() - (state.currentPosition.at || 0) < 120000;
      if (!fresh) {
        const position = await getPosition();
        showPositionOnMap(position);
      }
      state.nearMe = true;
      renderNearMe();
      renderList();
      showToast('Luoghi ordinati dal più vicino', { tone: 'success' });
    } catch (err) {
      state.nearMe = false;
      renderNearMe();
      renderList();
      showToast(geoErrorMessage(err), { tone: 'error' });
    } finally {
      btn.classList.remove('busy');
    }
  }

  /* ------------------- Salvataggio / eliminazione ------------------- */

  function submitForm(event) {
    event.preventDefault();
    const name = $('placeName').value.trim();
    if (!name) {
      $('nameError').hidden = false;
      $('placeName').focus();
      return;
    }
    $('nameError').hidden = true;

    if (!state.draft || !Number.isFinite(state.draft.lat) || !Number.isFinite(state.draft.lng)) {
      showToast('Scegli una posizione sulla mappa', { tone: 'error' });
      return;
    }

    const wasEditing = Boolean(state.editingId);
    const categoryId = $('placeCategory').value || 'altro';
    const note = $('placeNote').value.trim();
    const favorite = isFavoriteSelected();
    const statusValue = $('placeStatus').value;
    const status = PLACE_STATUSES.includes(statusValue) ? statusValue : null;
    let place;

    if (wasEditing) {
      place = getPlace(state.editingId);
      if (!place) {
        showToast('Questo luogo non è più disponibile', { tone: 'error' });
        closeSheet();
        return;
      }
      const previous = {
        name: place.name,
        categoryId: place.categoryId,
        note: place.note,
        favorite: place.favorite,
        status: place.status,
        lat: place.lat,
        lng: place.lng,
        address: place.address,
        updatedAt: place.updatedAt,
      };
      place.name = name;
      place.categoryId = categoryId;
      place.note = note;
      place.favorite = favorite;
      place.status = status;
      place.lat = state.draft.lat;
      place.lng = state.draft.lng;
      place.address = state.draft.address || (state.draft.moved ? '' : place.address);
      place.updatedAt = Date.now();
      if (!savePlaces()) {
        Object.assign(place, previous);
        return;
      }
    } else {
      place = {
        id: uid(),
        name,
        categoryId,
        note,
        favorite,
        status,
        address: state.draft.address || '',
        lat: state.draft.lat,
        lng: state.draft.lng,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      state.places.push(place);
      if (!savePlaces()) {
        state.places.pop();
        return;
      }
    }

    state.settings.lastCategory = categoryId;
    saveSettings();
    closeSheet();
    renderAll();

    const token = ++flyToken;
    if (map) map.flyTo([place.lat, place.lng], Math.max(map.getZoom(), 15), { duration: 0.7 });
    setTimeout(() => {
      if (token !== flyToken) return;
      const marker = state.markers.get(place.id);
      if (marker) marker.openPopup();
    }, 740);

    showToast(wasEditing ? 'Luogo aggiornato' : 'Luogo salvato', { tone: 'success' });
    if (!place.address) geocodePlaceAfterSave(place);
  }

  function confirmDelete(place) {
    const body = h('div', {},
      h('p', {}, 'Stai per rimuovere ', h('strong', { text: place.name }), ' dai tuoi luoghi.'),
      h('p', { text: 'Subito dopo potrai annullare con il pulsante nel messaggio.' })
    );
    showModal({
      title: 'Eliminare questo luogo?',
      body,
      actions: [
        { label: 'Annulla', kind: 'ghost' },
        { label: 'Elimina', kind: 'danger', onClick: () => doDelete(place.id) },
      ],
    });
  }

  function doDelete(id) {
    const index = state.places.findIndex((p) => p.id === id);
    if (index === -1) return;
    const [removed] = state.places.splice(index, 1);
    if (!savePlaces()) {
      state.places.splice(index, 0, removed);
      return;
    }
    if (map) map.closePopup();
    renderAll();

    showToast('Luogo eliminato', {
      tone: 'error',
      duration: 6000,
      actionLabel: 'Annulla',
      onAction: () => {
        const snapshot = state.places.slice();
        state.places.push(removed);
        if (!savePlaces()) {
          state.places = snapshot;
          return;
        }
        renderAll();
        showToast('Luogo ripristinato', { tone: 'success' });
      },
    });
  }

  /* -------------------- Import da link Google Maps ------------------- */

  function parseCoordinates(input) {
    if (!input) return { error: 'Incolla un link o delle coordinate.' };
    const text = input.trim();

    if (/maps\.app\.goo\.gl|goo\.gl\/maps/i.test(text)) {
      return { error: 'I link brevi non sono supportati: apri il link, poi copia l\'indirizzo completo.' };
    }

    const isUrl = /^(https?:\/\/|geo:)/i.test(text);
    const isGoogle = isUrl
      ? /(^|\.)google\.[a-z.]+\//i.test(text) || /google\./i.test(text)
      : /google\.[a-z.]+\/maps/i.test(text);

    const patterns = [];
    if (isGoogle) {
      patterns.push(
        /!3d(-?\d{1,3}(?:\.\d+)?)!4d(-?\d{1,3}(?:\.\d+)?)/,
        /@(-?\d{1,3}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)/,
        /[?&](?:q|query|ll|center|destination|daddr)=(-?\d{1,3}(?:\.\d+)?)(?:,|%2C|\+| )\s*(-?\d{1,3}(?:\.\d+)?)/i,
        /geo:(-?\d{1,3}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)/i
      );
    } else if (/^geo:/i.test(text)) {
      patterns.push(/geo:(-?\d{1,3}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)/i);
    }
    // Coordinate incollate a mano: "45.4642, 9.1900" (virgola o punto e virgola).
    patterns.push(/^\s*(-?\d{1,3}(?:\.\d+)?)\s*[,;]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/);

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (!match) continue;
      const lat = Number(match[1]);
      const lng = Number(match[2]);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      if (lat < -90 || lat > 90 || lng < -180 || lng > 180) continue;
      return { lat, lng, name: extractPlaceName(text) };
    }

    return {
      error: isUrl
        ? 'Coordinate non riconosciute in questo link. Incolla un link completo di Google Maps.'
        : 'Coordinate non riconosciute. Incolla un link completo di Google Maps o "lat, lng".',
    };
  }

  function extractPlaceName(text) {
    const match = text.match(/\/place\/([^/@?]+)/i) || text.match(/\/maps\/search\/([^/@?]+)/i);
    if (!match) return '';
    try {
      const decoded = decodeURIComponent(match[1].replace(/\+/g, ' ')).replace(/\s+/g, ' ').trim();
      if (!decoded || /^-?\d/.test(decoded)) return '';
      return decoded.slice(0, 120);
    } catch (_) {
      return '';
    }
  }

  /* --------------------- Condivisione di sistema ---------------------
     Share Target (manifest): riceve title/text/url da un'altra app.
     I link brevi maps.app.goo.gl non vengono mai seguiti (CORS):
     in quel caso si usa nome/indirizzo e la geocodifica Nominatim.
     ------------------------------------------------------------------ */

  const SHARE_URL_RE = /(?:https?:\/\/|geo:)[^\s<>"']+/gi;

  function cleanSharedUrl(value) {
    return String(value || '').replace(/[.,;:!?)\]}"']+$/g, '');
  }

  function shareTargetUrls(payload) {
    const urls = [];
    const add = (value) => {
      const text = cleanSharedUrl(String(value || '').trim());
      if (!/^(https?:\/\/|geo:)/i.test(text)) return;
      if (text.length > MAX_SHARE_URL) return;
      if (!urls.includes(text)) urls.push(text);
    };
    add(payload.url);
    for (const text of [payload.title, payload.text]) {
      const matches = String(text || '').match(SHARE_URL_RE) || [];
      matches.forEach(add);
    }
    return urls;
  }

  function shareTargetHints(payload) {
    const cleanName = (value) => cleanText(String(value || '')
      .replace(SHARE_URL_RE, ' ')
      .replace(/\s*[|·]\s*Google Maps\s*$/i, '')
      .replace(/\s*-\s*Google Maps\s*$/i, ''), 120);
    const lines = String(payload.text || '')
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map((line) => cleanText(line.replace(SHARE_URL_RE, ' '), 200))
      .filter(Boolean);
    let name = cleanName(payload.title);
    if (/^google maps$/i.test(name)) name = '';
    if (!name) name = lines[0] || '';
    const rest = lines.filter((line) => fold(line) !== fold(name));
    return {
      name: cleanText(name, 120),
      address: cleanText(rest.join(', '), 300),
    };
  }

  function openShareFallback(payload) {
    const lines = [];
    for (const value of [payload.title, payload.text, payload.url]) {
      for (const line of String(value || '').split(/\r?\n/)) {
        const trimmed = line.trim();
        if (trimmed && !lines.includes(trimmed)) lines.push(trimmed);
      }
    }
    const received = lines.join('\n').slice(0, 900);
    const body = h('div', {},
      h('p', { text: 'Non sono riuscito a ricavare il luogo da questa condivisione. Ecco il testo ricevuto:' }),
      h('p', { class: 'share-received', text: received || 'Nessun testo ricevuto' }),
      h('p', { text: 'Scegli il punto sulla mappa e completa il nome: potrai controllare tutto prima di salvare.' })
    );
    showModal({
      title: 'Luogo non riconosciuto',
      body,
      actions: [
        {
          label: 'Scegli sulla mappa',
          kind: 'primary',
          onClick: () => {
            closeOverlayThen('modal', () => {
              startAddPlaceFromCenter();
              setTimeout(enterPickMode, 380);
            });
            return false;
          },
        },
        { label: 'Annulla' },
      ],
    });
  }

  async function handleShareTarget(payload) {
    // Resta "attivo" per qualche secondo: evita che il benvenuto copra la
    // condivisione, ma senza bloccare i link condivisi per la sessione.
    shareHandledAt = Date.now();
    try {
      history.replaceState({}, '', window.location.pathname + window.location.hash);
    } catch (_) { /* noop */ }

    const urls = shareTargetUrls(payload);
    const hints = shareTargetHints(payload);

    let coords = null;
    let nameFromUrl = '';
    for (const url of urls) {
      const result = parseCoordinates(url);
      if (Number.isFinite(result.lat) && Number.isFinite(result.lng)) {
        coords = result;
        nameFromUrl = result.name || '';
        break;
      }
    }

    if (coords) {
      showToast('Luogo condiviso pronto: controlla e salva', { tone: 'success' });
      setTimeout(() => {
        focusMapOn(coords.lat, coords.lng);
        startAddPlace({
          lat: coords.lat,
          lng: coords.lng,
          name: nameFromUrl || hints.name,
          address: hints.address,
        });
      }, 350);
      return;
    }

    const query = cleanText([hints.name, hints.address].filter(Boolean).join(', '), 300);
    if (query) {
      showToast('Cerco il luogo condiviso…');
      const found = await forwardGeocode(query);
      if (found) {
        focusMapOn(found.lat, found.lng);
        startAddPlace({
          lat: found.lat,
          lng: found.lng,
          name: hints.name,
          address: hints.address || found.address,
        });
        showToast('Luogo trovato: controlla e salva', { tone: 'success' });
        return;
      }
    }

    openShareFallback(payload);
  }

  function focusMapOn(lat, lng) {
    if (!map || !Number.isFinite(lat) || !Number.isFinite(lng)) return;
    map.setView([lat, lng], Math.max(map.getZoom(), 15), { animate: false });
  }

  /* ------------------------------ Modale ----------------------------- */

  function showModal({ title, body, actions = [] }) {
    const modal = $('modal');
    $('modalTitle').textContent = title;
    const bodyEl = $('modalBody');
    bodyEl.textContent = '';
    if (typeof body === 'string') bodyEl.textContent = body;
    else if (body) bodyEl.appendChild(body);

    const actionsEl = $('modalActions');
    actionsEl.textContent = '';
    let firstButton = null;
    for (const action of actions) {
      const button = h('button', {
        type: 'button',
        class: 'btn ' + (action.kind || 'ghost'),
        text: action.label,
        onclick: () => {
          if (action.onClick && action.onClick() === false) return;
          requestCloseOverlay('modal');
        },
      });
      if (!firstButton) firstButton = button;
      actionsEl.appendChild(button);
    }

    modal.hidden = false;
    openOverlay('modal', hideModal);
    syncOverlayState();
    if (firstButton) setTimeout(() => firstButton.focus(), 60);
  }

  function hideModal() {
    $('modal').hidden = true;
    $('modalBody').textContent = '';
    $('modalActions').textContent = '';
    syncOverlayState();
  }

  function openNewCategoryModal() {
    let selectedColor = PALETTE[4];
    let selectedEmoji = '📍';

    const nameInput = h('input', { type: 'text', maxlength: '40', placeholder: 'Es. Pizzerie', 'aria-label': 'Nome categoria' });
    const errorEl = h('p', { class: 'field-error', hidden: true, text: 'Scrivi un nome per la categoria.' });

    const swatches = h('div', { class: 'swatches' });
    PALETTE.forEach((color) => {
      const swatch = h('button', {
        type: 'button',
        class: 'swatch' + (color === selectedColor ? ' is-selected' : ''),
        style: { background: color },
        'aria-label': 'Colore ' + color,
        onclick: () => {
          selectedColor = color;
          swatches.querySelectorAll('.swatch').forEach((el, i) => el.classList.toggle('is-selected', PALETTE[i] === color));
        },
      });
      swatches.appendChild(swatch);
    });

    const emojiGrid = h('div', { class: 'emoji-grid' });
    EMOJIS.forEach((emoji) => {
      const option = h('button', {
        type: 'button',
        class: 'emoji-opt' + (emoji === selectedEmoji ? ' is-selected' : ''),
        text: emoji,
        'aria-label': 'Icona ' + emoji,
        onclick: () => {
          selectedEmoji = emoji;
          emojiGrid.querySelectorAll('.emoji-opt').forEach((el) => el.classList.toggle('is-selected', el.textContent === emoji));
        },
      });
      emojiGrid.appendChild(option);
    });

    const form = h('div', { class: 'cat-form' },
      h('div', { class: 'field' }, h('label', { text: 'Nome' }), nameInput, errorEl),
      h('div', { class: 'field' }, h('label', { text: 'Colore' }), swatches),
      h('div', { class: 'field' }, h('label', { text: 'Icona' }), emojiGrid)
    );

    showModal({
      title: 'Nuova categoria',
      body: form,
      actions: [
        { label: 'Annulla', kind: 'ghost' },
        {
          label: 'Crea categoria',
          kind: 'primary',
          onClick: () => {
            const name = nameInput.value.trim();
            if (!name) {
              errorEl.hidden = false;
              nameInput.focus();
              return false;
            }
            const category = { id: 'cat-' + uid().slice(0, 8), name: name.slice(0, 40), color: selectedColor, icon: selectedEmoji, custom: true };
            state.categories.push(category);
            if (!saveCategories()) {
              state.categories.pop();
              return false;
            }
            renderCategorySelect(category.id);
            renderChips();
            renderList();
            showToast('Categoria creata', { tone: 'success' });
            return true;
          },
        },
      ],
    });

    setTimeout(() => nameInput.focus(), 80);
  }

  /* ------------------------------ Toast ------------------------------ */

  function showToast(message, { tone = '', duration = 3400, actionLabel, onAction } = {}) {
    const toast = $('toast');
    clearTimeout(toastTimer);
    clearTimeout(toastHideTimer);
    $('toastText').textContent = message;
    toast.classList.remove('success', 'error');
    if (tone) toast.classList.add(tone);

    const toastIconUse = $('toastIcon') && $('toastIcon').querySelector('use');
    if (toastIconUse) {
      toastIconUse.setAttribute('href', tone === 'error' ? '#i-alert' : tone === 'success' ? '#i-check' : '#i-info');
    }

    const action = $('toastAction');
    if (actionLabel && onAction) {
      action.hidden = false;
      action.textContent = actionLabel;
      action.onclick = () => {
        hideToast();
        onAction();
      };
    } else {
      action.hidden = true;
      action.onclick = null;
    }

    toast.hidden = false;
    requestAnimationFrame(() => toast.classList.add('show'));
    toastTimer = setTimeout(hideToast, duration);
  }

  function hideToast() {
    const toast = $('toast');
    clearTimeout(toastTimer);
    toast.classList.remove('show');
    toastHideTimer = setTimeout(() => { toast.hidden = true; }, 240);
  }

  /* -------------------------- Backup JSON ---------------------------- */

  function currentBackup() {
    return {
      app: 'Mappo',
      version: 1,
      exportedAt: new Date().toISOString(),
      categories: state.categories,
      places: state.places,
    };
  }

  /* -------------------------- Esportazione --------------------------- */

  function escapeXml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  function csvCell(value) {
    let text = value == null ? '' : String(value);
    // Neutralizza la CSV injection (formula injection): un nome importato
    // che inizia con = + - @ verrebbe eseguito come formula da Excel,
    // LibreOffice e Google Sheets. L'apostrofo iniziale lo rende testo.
    if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
    return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
  }

  function placeProperties(place) {
    const cat = getCategory(place.categoryId);
    return {
      name: place.name,
      category: cat.name,
      categoryId: place.categoryId,
      note: place.note || '',
      favorite: Boolean(place.favorite),
      status: place.status || '',
      address: place.address || '',
    };
  }

  function serializeGeoJson() {
    return JSON.stringify({
      type: 'FeatureCollection',
      features: state.places.map((place) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [place.lng, place.lat] },
        properties: placeProperties(place),
      })),
    }, null, 2);
  }

  function serializeKml() {
    const placemarks = state.places.map((place) => {
      const props = placeProperties(place);
      const data = [
        ['categoria', props.category],
        ['nota', props.note],
        ['preferito', props.favorite ? 'true' : 'false'],
        ['stato', props.status],
        ['indirizzo', props.address],
      ].map(([name, value]) => '        <Data name="' + name + '"><value>' + escapeXml(value) + '</value></Data>').join('\n');
      return '    <Placemark>\n'
        + '      <name>' + escapeXml(place.name) + '</name>\n'
        + '      <description>' + escapeXml(props.note) + '</description>\n'
        + '      <ExtendedData>\n' + data + '\n      </ExtendedData>\n'
        + '      <Point><coordinates>' + Number(place.lng).toFixed(6) + ',' + Number(place.lat).toFixed(6) + ',0</coordinates></Point>\n'
        + '    </Placemark>';
    }).join('\n');
    return '<?xml version="1.0" encoding="UTF-8"?>\n'
      + '<kml xmlns="http://www.opengis.net/kml/2.2">\n'
      + '  <Document>\n'
      + '    <name>Mappo</name>\n'
      + placemarks + '\n'
      + '  </Document>\n'
      + '</kml>\n';
  }

  function serializeGpx() {
    const waypoints = state.places.map((place) => {
      const props = placeProperties(place);
      return '  <wpt lat="' + Number(place.lat).toFixed(6) + '" lon="' + Number(place.lng).toFixed(6) + '">\n'
        + '    <name>' + escapeXml(place.name) + '</name>\n'
        + '    <desc>' + escapeXml(props.note) + '</desc>\n'
        + '    <type>' + escapeXml(props.category) + '</type>\n'
        + '    <extensions>\n'
        + '      <ldc:category>' + escapeXml(props.category) + '</ldc:category>\n'
        + '      <ldc:favorite>' + (props.favorite ? 'true' : 'false') + '</ldc:favorite>\n'
        + '      <ldc:status>' + escapeXml(props.status) + '</ldc:status>\n'
        + '      <ldc:address>' + escapeXml(props.address) + '</ldc:address>\n'
        + '    </extensions>\n'
        + '  </wpt>';
    }).join('\n');
    // Namespace XML mantenuto a "ldc" (Luoghi del cuore) per compatibilità
    // con i GPX già esportati: gli identificatori XML non hanno implicito di
    // branding e il parser legge le estensioni per local name.
    return '<?xml version="1.0" encoding="UTF-8"?>\n'
      + '<gpx version="1.1" creator="Mappo" xmlns="http://www.topografix.com/GPX/1/1" xmlns:ldc="https://luoghidelcuore.local/schema">\n'
      + '  <metadata><name>Mappo</name></metadata>\n'
      + waypoints + '\n'
      + '</gpx>\n';
  }

  function serializeCsv() {
    const header = ['name', 'category', 'note', 'favorite', 'status', 'address', 'lat', 'lng'];
    const rows = state.places.map((place) => {
      const props = placeProperties(place);
      return [props.name, props.category, props.note, props.favorite ? 'true' : 'false', props.status, props.address, place.lat, place.lng];
    });
    return '\uFEFF' + [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
  }

  function exportFilename(format) {
    return 'mappo-' + new Date().toISOString().slice(0, 10) + '.' + format;
  }

  async function saveExportFile(format, content, mime) {
    const filename = exportFilename(format);
    const blob = new Blob([content], { type: mime });
    const file = new File([blob], filename, { type: mime });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: 'Mappo' });
        return 'shared';
      } catch (err) {
        if (err && err.name === 'AbortError') return 'aborted';
      }
    }
    const url = URL.createObjectURL(blob);
    const link = h('a', { href: url, download: filename });
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return 'downloaded';
  }

  function exportData(format) {
    if (state.places.length === 0) {
      showToast('Non ci sono luoghi da esportare', { tone: 'error' });
      return;
    }
    const formats = {
      json: { mime: 'application/json', content: () => JSON.stringify(currentBackup(), null, 2) },
      geojson: { mime: 'application/geo+json', content: serializeGeoJson },
      kml: { mime: 'application/vnd.google-earth.kml+xml', content: serializeKml },
      gpx: { mime: 'application/gpx+xml', content: serializeGpx },
      csv: { mime: 'text/csv', content: serializeCsv },
    };
    const spec = formats[format];
    if (!spec) return;
    saveExportFile(format, spec.content(), spec.mime)
      .then((outcome) => {
        if (outcome === 'aborted') return;
        showToast(outcome === 'shared'
          ? 'File condiviso'
          : (format === 'json' ? 'Backup esportato' : 'File scaricato'), { tone: 'success' });
      })
      .catch(() => showToast('Esportazione non riuscita', { tone: 'error' }));
  }

  function openExportModal(shareMode = false) {
    if (state.places.length === 0) {
      showToast('Non ci sono luoghi da esportare', { tone: 'error' });
      return;
    }
    const options = [
      ['geojson', 'GeoJSON', 'Punti con nome, categoria, nota, preferito e stato'],
      ['kml', 'KML', 'Per Google Earth e My Maps'],
      ['gpx', 'GPX', 'Waypoint per navigatori e app outdoor'],
      ['csv', 'CSV', 'Foglio di calcolo, con coordinate'],
      ['json', 'JSON (backup)', "Formato completo dell'app, reimportabile"],
    ];
    const body = h('div', {},
      h('div', { class: 'export-formats' }, options.map(([format, label, description]) => h('button', {
        type: 'button',
        class: 'export-option',
        onclick: () => {
          requestCloseOverlay('modal');
          exportData(format);
        },
      }, h('strong', { text: label }), h('span', { text: description })))),
      h('p', { class: 'import-note', text: 'Sui dispositivi compatibili si apre il menu di condivisione; altrimenti il file viene scaricato.' })
    );
    showModal({
      title: shareMode ? 'Condividi un file' : 'Esporta i luoghi',
      body,
      actions: [{ label: 'Annulla', kind: 'ghost' }],
    });
  }

  /* --------------------------- Condivisione -------------------------- */

  function bytesToBase64Url(bytes) {
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function base64UrlToBytes(text) {
    const normalized = String(text).replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  // Prova prima deflate-raw (più compatto), poi deflate: i browser più vecchi
  // supportano solo il secondo. Null se CompressionStream non esiste.
  async function compressBytes(bytes) {
    if (typeof CompressionStream !== 'function') return null;
    for (const [format, prefix] of [['deflate-raw', 'z'], ['deflate', 'y']]) {
      try {
        const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream(format));
        return { prefix, bytes: new Uint8Array(await new Response(stream).arrayBuffer()) };
      } catch (_) { /* formato non supportato: provo il successivo */ }
    }
    return null;
  }

  async function decompressBytes(bytes, format, limit = MAX_SHARE_BYTES) {
    if (typeof DecompressionStream !== 'function') {
      throw new Error('Questo browser non supporta i link compressi');
    }
    let reader;
    try {
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream(format));
      reader = stream.getReader();
    } catch (_) {
      throw new Error('Link non valido o danneggiato');
    }
    const chunks = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.length;
        // Il limite si controlla durante l'espansione: materializzare tutto
        // prima di misurarlo aprirebbe la porta a un decompression bomb.
        if (total > limit) {
          await reader.cancel().catch(() => {});
          throw new Error('Link troppo grande');
        }
        chunks.push(value);
      }
    } catch (err) {
      if (err && err.message === 'Link troppo grande') throw err;
      throw new Error('Link non valido o danneggiato');
    }
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  }

  // Payload compatto: nomi dei campi ridotti e categorie indicizzate,
  // così il link resta corto dopo la compressione.
  function sharePayload() {
    const categories = [];
    const places = state.places.map((place) => {
      const cat = getCategory(place.categoryId);
      let index = categories.findIndex((item) => item.name === cat.name);
      if (index === -1) {
        categories.push({ name: cat.name, color: cat.color, icon: cat.icon });
        index = categories.length - 1;
      }
      return [
        place.name,
        Number(place.lat),
        Number(place.lng),
        index,
        place.note || '',
        place.favorite ? 1 : 0,
        place.status || '',
        place.address || '',
      ];
    });
    return { v: 1, c: categories.map((cat) => [cat.name, cat.color, cat.icon]), p: places };
  }

  async function buildShareLink() {
    const bytes = new TextEncoder().encode(JSON.stringify(sharePayload()));
    const packed = await compressBytes(bytes);
    const token = packed
      ? packed.prefix + bytesToBase64Url(packed.bytes)
      : 'u' + bytesToBase64Url(bytes);
    const url = new URL(window.location.href);
    url.search = '';
    url.hash = 's=' + token;
    return url.toString();
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (_) { /* fallback sotto */ }
    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.setAttribute('aria-hidden', 'true');
      area.className = 'copy-fallback';
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand('copy');
      area.remove();
      return ok;
    } catch (_) {
      return false;
    }
  }

  function openShareModal() {
    if (state.places.length === 0) {
      showToast('Non ci sono luoghi da condividere', { tone: 'error' });
      return;
    }
    const body = h('div', {},
      h('div', { class: 'export-formats' },
        h('button', {
          type: 'button',
          class: 'export-option',
          onclick: () => openExportModal(true),
        },
          h('strong', { text: 'Condividi un file' }),
          h('span', { text: 'JSON, GeoJSON, KML, GPX o CSV' })),
        h('button', {
          type: 'button',
          class: 'export-option',
          onclick: () => { void startShareLink(); },
        },
          h('strong', { text: 'Condividi un link' }),
          h('span', { text: 'La lista viaggia nel link, con anteprima prima di importare' }))
      ),
      h('p', { class: 'import-note', text: 'Il link contiene i luoghi in chiaro: condividilo solo con chi vuoi.' })
    );
    showModal({ title: 'Condividi i luoghi', body, actions: [{ label: 'Annulla', kind: 'ghost' }] });
  }

  async function startShareLink() {
    showToast('Preparazione del link…', { duration: 60000 });
    let url;
    try {
      url = await buildShareLink();
    } catch (_) {
      hideToast();
      showToast('Impossibile creare il link', { tone: 'error' });
      return;
    }
    hideToast();
    if (url.length > MAX_SHARE_URL) {
      showShareTooLong(url.length);
      return;
    }
    showShareLinkModal(url);
  }

  function showShareTooLong(length) {
    showModal({
      title: 'Link troppo lungo',
      body: h('div', {},
        h('p', { text: 'La lista è troppo grande per stare in un link: '
          + state.places.length + (state.places.length === 1 ? ' luogo' : ' luoghi')
          + ', circa ' + Math.ceil(length / 1024) + ' kB.' }),
        h('p', { text: 'Condividi un file: chi lo riceve può importarlo dall\'app.' })
      ),
      actions: [
        { label: 'Annulla', kind: 'ghost' },
        {
          label: 'Condividi un file',
          kind: 'primary',
          onClick: () => { openExportModal(true); return false; },
        },
      ],
    });
  }

  function showShareLinkModal(url) {
    const input = h('input', {
      type: 'text',
      class: 'share-link-input',
      readonly: '',
      value: url,
      'aria-label': 'Link di condivisione',
    });
    input.addEventListener('focus', () => input.select());

    const copy = async () => {
      const ok = await copyText(url);
      showToast(ok
        ? 'Link copiato negli appunti'
        : 'Copia non riuscita: seleziona il link e copialo a mano',
        { tone: ok ? 'success' : 'error' });
    };
    const share = async () => {
      try {
        await navigator.share({ title: 'Mappo', text: 'La mia lista di luoghi', url });
      } catch (err) {
        if (err && err.name === 'AbortError') return;
        await copy();
      }
    };

    const actions = [
      { label: 'Chiudi', kind: 'ghost' },
      { label: 'Copia link', kind: 'soft', onClick: () => { void copy(); return false; } },
    ];
    if (typeof navigator.share === 'function') {
      actions.push({ label: 'Condividi', kind: 'primary', onClick: () => { void share(); return false; } });
    }

    showModal({
      title: 'Link pronto',
      body: h('div', {},
        h('p', { text: state.places.length
          + (state.places.length === 1 ? ' luogo in un link di ' : ' luoghi in un link di ')
          + url.length + ' caratteri.' }),
        input,
        h('p', { class: 'import-note', text: 'Chi apre il link vede un\'anteprima e sceglie se importare i luoghi. Il link non scade, ma contiene i dati in chiaro.' })
      ),
      actions,
    });
    setTimeout(() => input.select(), 80);
  }

  function shareTokenFromHash() {
    if (!window.location.hash || window.location.hash.length < 3) return null;
    return new URLSearchParams(window.location.hash.slice(1)).get('s');
  }

  async function decodeShareToken(token) {
    if (!token || token.length < 2) throw new Error('Link non valido');
    if (token.length > MAX_SHARE_TOKEN) throw new Error('Link troppo lungo');
    const prefix = token[0];
    let bytes;
    try {
      bytes = base64UrlToBytes(token.slice(1));
    } catch (_) {
      throw new Error('Link non valido');
    }
    let jsonBytes;
    if (prefix === 'z') jsonBytes = await decompressBytes(bytes, 'deflate-raw');
    else if (prefix === 'y') jsonBytes = await decompressBytes(bytes, 'deflate');
    else if (prefix === 'u') jsonBytes = bytes;
    else throw new Error('Link non valido');
    if (jsonBytes.length > MAX_SHARE_BYTES) throw new Error('Link troppo grande');

    let data;
    try {
      data = JSON.parse(new TextDecoder().decode(jsonBytes));
    } catch (_) {
      throw new Error('Link non valido o danneggiato');
    }
    if (!data || data.v !== 1 || !Array.isArray(data.p)) throw new Error('Link non riconosciuto');

    // Riusa le categorie già presenti (match per nome), altrimenti ricrea
    // quella del link con colore e icona originali.
    const rawCategories = Array.isArray(data.c) ? data.c : [];
    const categoryNames = rawCategories.map((raw) => (Array.isArray(raw) ? cleanText(raw[0], 40) : ''));
    const categoryIds = rawCategories.map((raw, i) => {
      const name = categoryNames[i];
      if (!Array.isArray(raw) || !name) return '';
      const existing = state.categories.find((cat) => fold(cat.name) === fold(name));
      return existing ? existing.id : 'cat-' + uid().slice(0, 8);
    });
    const extraCategories = categoryIds
      .map((id, i) => {
        if (!id || state.categories.some((cat) => cat.id === id)) return null;
        const raw = rawCategories[i];
        return makeCategory({ id, name: categoryNames[i], color: raw[1], icon: raw[2], custom: true });
      })
      .filter(Boolean);

    const places = [];
    const skipped = [];
    for (const raw of data.p) {
      // Stesso tetto dei file importati: un link non deve poter portare
      // più voci di quanto l'app ne possa gestire.
      if (places.length >= MAX_IMPORT_PLACES) {
        skipped.push(skippedEntry('', 'oltre il limite di ' + MAX_IMPORT_PLACES + ' luoghi'));
        break;
      }
      if (!Array.isArray(raw)) { skipped.push(skippedEntry('', 'dati non validi')); continue; }
      const name = cleanText(raw[0], 120);
      const lat = parseCoordinateValue(raw[1]);
      const lng = parseCoordinateValue(raw[2]);
      if (!name) { skipped.push(skippedEntry('', 'nome mancante')); continue; }
      if (!validLatLng(lat, lng)) { skipped.push(skippedEntry(name, 'coordinate non valide')); continue; }
      const index = Number(raw[3]);
      const validIndex = Number.isInteger(index) && index >= 0 && index < categoryIds.length;
      places.push({
        name,
        lat,
        lng,
        address: cleanText(raw[7], 300),
        note: cleanText(raw[4], 1000),
        favorite: Boolean(raw[5]),
        status: PLACE_STATUSES.includes(raw[6]) ? raw[6] : null,
        categoryId: validIndex ? categoryIds[index] : '',
        categoryName: validIndex ? categoryNames[index] : '',
        createdAt: Date.now(),
      });
    }
    return { format: 'link', places, categories: extraCategories, skipped };
  }

  async function handleShareLink() {
    const token = shareTokenFromHash();
    if (!token) return;
    shareLinkPending = true;
    shareHandledAt = Date.now();
    try {
      history.replaceState({}, '', window.location.pathname + window.location.search);
    } catch (_) { /* noop */ }
    try {
      const payload = await decodeShareToken(token);
      if (payload.places.length === 0) {
        showToast('Il link non contiene luoghi validi', { tone: 'error' });
        return;
      }
      openImportPreview(payload, { title: 'Luoghi condivisi' });
    } catch (err) {
      showToast(err && err.message ? err.message : 'Link non valido', { tone: 'error' });
    } finally {
      shareLinkPending = false;
    }
  }

  /* ---------------------- Importazione: utilità ---------------------- */

  function parseFavoriteValue(value) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value === 1;
    const text = fold(value);
    return ['true', '1', 'yes', 'si', 'x', 'preferito', 'starred', 'favorite', 'favourite'].includes(text);
  }

  function parseStatusValue(value) {
    const text = fold(value);
    if (!text) return null;
    if (['da_visitare', 'da visitare', 'davisitare', 'to visit', 'to_visit', 'want to go', 'da fare', 'non visitato'].includes(text)) {
      return 'da_visitare';
    }
    if (['visitato', 'visited', 'done', 'completato', 'fatto'].includes(text)) return 'visitato';
    if (text.includes('visit') && text.includes('da')) return 'da_visitare';
    if (text.startsWith('visit')) return 'visitato';
    return null;
  }

  function parseCoordinateValue(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (value == null) return null;
    const text = String(value).trim().replace(',', '.');
    if (!text) return null;
    const number = Number(text);
    return Number.isFinite(number) ? number : null;
  }

  function validLatLng(lat, lng) {
    return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
  }

  function cleanText(value, max = 1000) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
  }

  function stripTags(value) {
    return cleanText(String(value == null ? '' : value).replace(/<[^>]*>/g, ' '), 1000);
  }

  function firstByLocalName(parent, name) {
    if (!parent) return null;
    const nodes = parent.getElementsByTagNameNS('*', name);
    return nodes.length ? nodes[0] : null;
  }

  function textByLocalName(parent, name) {
    const node = firstByLocalName(parent, name);
    return node ? node.textContent.trim() : '';
  }

  function skippedEntry(name, reason) {
    return { name: cleanText(name, 120), reason };
  }

  function detectDelimiter(text) {
    let line = '';
    for (const candidate of String(text).split(/\r?\n/)) {
      if (candidate.trim()) { line = candidate; break; }
    }
    let best = ',';
    let bestCount = -1;
    for (const delimiter of [',', ';', '\t']) {
      let count = 0;
      let quoted = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') quoted = !quoted;
        else if (!quoted && ch === delimiter) count++;
      }
      if (count > bestCount) { bestCount = count; best = delimiter; }
    }
    return best;
  }

  function parseDelimited(text, delimiter) {
    const rows = [];
    let row = [];
    let cell = '';
    let quoted = false;
    const source = String(text);
    for (let i = 0; i < source.length; i++) {
      const ch = source[i];
      if (quoted) {
        if (ch === '"') {
          if (source[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
        } else {
          cell += ch;
        }
      } else if (ch === '"' && cell === '') {
        quoted = true;
      } else if (ch === delimiter) {
        row.push(cell);
        cell = '';
      } else if (ch === '\n') {
        row.push(cell);
        rows.push(row);
        row = [];
        cell = '';
      } else if (ch !== '\r') {
        cell += ch;
      }
    }
    if (cell !== '' || row.length) {
      row.push(cell);
      rows.push(row);
    }
    return rows.filter((cells) => cells.some((value) => value.trim() !== ''));
  }

  function headerKey(value) {
    return fold(value).replace(/[\s_.-]+/g, '');
  }

  function findColumn(headers, aliases) {
    for (const alias of aliases) {
      const index = headers.indexOf(headerKey(alias));
      if (index !== -1) return index;
    }
    return -1;
  }

  function listNameFromFile(filename) {
    const base = cleanText(String(filename || '').replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' '), 40);
    // I nomi dei file esportati dall'app non sono liste da importare.
    if (!base || /^(mappo|luoghi del cuore)/i.test(base)) return '';
    return base;
  }

  function parseCsvImport(text, filename) {
    const rows = parseDelimited(text, detectDelimiter(text));
    if (rows.length < 2) throw new Error('CSV senza righe di dati');
    const headers = rows[0].map(headerKey);
    const idx = {
      name: findColumn(headers, ['name', 'nome', 'title', 'titolo', 'place', 'luogo', 'luogosalvato']),
      category: findColumn(headers, ['category', 'categoria', 'list', 'lista', 'type', 'tipo', 'collezione']),
      note: findColumn(headers, ['note', 'notes', 'nota', 'description', 'descrizione']),
      comment: findColumn(headers, ['comment', 'commento']),
      address: findColumn(headers, ['address', 'indirizzo', 'location', 'posizione', 'formattedaddress']),
      lat: findColumn(headers, ['lat', 'latitude', 'latitudine']),
      lng: findColumn(headers, ['lng', 'lon', 'long', 'longitude', 'longitudine']),
      favorite: findColumn(headers, ['favorite', 'favourite', 'preferito', 'starred', 'preferiti']),
      status: findColumn(headers, ['status', 'stato']),
      url: findColumn(headers, ['url', 'link', 'googlemapsurl', 'mapsurl', 'web']),
    };
    if (idx.name === -1 && idx.address === -1 && idx.lat === -1) {
      throw new Error('CSV non riconosciuto: mancano le colonne del nome o delle coordinate');
    }
    const defaultCategory = idx.category === -1 ? listNameFromFile(filename) : '';
    const places = [];
    const skipped = [];
    for (const row of rows.slice(1)) {
      const value = (index) => (index >= 0 ? String(row[index] == null ? '' : row[index]).trim() : '');
      let name = value(idx.name);
      const address = cleanText(value(idx.address), 300);
      const url = value(idx.url);
      let lat = parseCoordinateValue(value(idx.lat));
      let lng = parseCoordinateValue(value(idx.lng));
      let urlName = '';
      if ((lat == null || lng == null) && url) {
        const parsed = parseCoordinates(url);
        if (!parsed.error) { lat = parsed.lat; lng = parsed.lng; urlName = parsed.name || ''; }
      }
      if (!name) name = urlName || address;
      if (!name) { skipped.push(skippedEntry(address || url, 'nome mancante')); continue; }
      if (lat != null && lng != null && !validLatLng(lat, lng)) {
        skipped.push(skippedEntry(name, 'coordinate non valide'));
        continue;
      }
      if (lat == null || lng == null) { lat = null; lng = null; }
      const notes = [value(idx.note), value(idx.comment)].filter((part, i, all) => part && all.indexOf(part) === i);
      places.push({
        name: cleanText(name, 120),
        lat,
        lng,
        address,
        note: cleanText(notes.join(' · '), 1000),
        favorite: parseFavoriteValue(value(idx.favorite)),
        status: parseStatusValue(value(idx.status)),
        categoryId: '',
        categoryName: cleanText(value(idx.category) || defaultCategory, 40),
        createdAt: Date.now(),
      });
    }
    return { format: 'csv', places, categories: [], skipped };
  }

  function parseGeoJsonImport(data, options = {}) {
    const places = [];
    const skipped = [];
    for (const feature of data.features) {
      const props = feature && feature.properties && typeof feature.properties === 'object' ? feature.properties : {};
      let lat = null;
      let lng = null;
      const geometry = feature && feature.geometry;
      if (geometry && geometry.type === 'Point' && Array.isArray(geometry.coordinates)) {
        lng = parseCoordinateValue(geometry.coordinates[0]);
        lat = parseCoordinateValue(geometry.coordinates[1]);
      } else if (geometry && geometry.type === 'MultiPoint' && Array.isArray(geometry.coordinates) && geometry.coordinates.length) {
        lng = parseCoordinateValue(geometry.coordinates[0][0]);
        lat = parseCoordinateValue(geometry.coordinates[0][1]);
      }
      const url = props.google_maps_url || props.url || props.link || '';
      let urlName = '';
      if ((lat == null || lng == null) && url) {
        const parsed = parseCoordinates(String(url));
        if (!parsed.error) { lat = parsed.lat; lng = parsed.lng; urlName = parsed.name || ''; }
      }
      if (lat != null && lng != null && !validLatLng(lat, lng)) {
        skipped.push(skippedEntry(props.name || props.title || urlName, 'coordinate non valide'));
        continue;
      }
      if (lat == null || lng == null) { lat = null; lng = null; }
      const address = cleanText(props.address || props.Address || props.location || '', 300);
      const name = cleanText(props.name || props.title || props.Title || props.Name || urlName || address, 120);
      if (!name) { skipped.push(skippedEntry(address || url, 'nome mancante')); continue; }
      const hasFavorite = Object.prototype.hasOwnProperty.call(props, 'favorite')
        || Object.prototype.hasOwnProperty.call(props, 'preferito');
      places.push({
        name,
        lat,
        lng,
        address,
        note: cleanText(props.note || props.comment || props.description || props.notes || '', 1000),
        favorite: hasFavorite
          ? parseFavoriteValue(props.favorite != null ? props.favorite : props.preferito)
          : Boolean(options.defaultFavorite),
        status: parseStatusValue(props.status != null ? props.status : props.stato),
        categoryId: cleanText(props.categoryId || props.category_id || '', 40),
        categoryName: cleanText(props.category || props.categoria || props.list || props.List || '', 40),
        createdAt: Number(props.createdAt) || Date.now(),
      });
    }
    return { format: 'geojson', places, categories: [], skipped };
  }

  function parseLegacyBackup(data, rawPlaces) {
    const incomingCats = !Array.isArray(data) && Array.isArray(data.categories)
      ? data.categories.map((raw) => makeCategory(raw)).filter(Boolean)
      : [];
    const knownIds = new Set(state.categories.map((c) => c.id));
    const available = state.categories.concat(incomingCats.filter((cat) => !knownIds.has(cat.id)));
    const places = [];
    const skipped = [];
    for (const raw of rawPlaces) {
      const place = sanitizePlace(raw, available);
      if (!place) {
        skipped.push(skippedEntry(raw && raw.name, 'coordinate mancanti o non valide'));
        continue;
      }
      const cat = available.find((c) => c.id === place.categoryId);
      places.push({
        name: place.name,
        lat: place.lat,
        lng: place.lng,
        address: place.address,
        note: place.note,
        favorite: place.favorite,
        status: place.status,
        categoryId: place.categoryId,
        categoryName: cat ? cat.name : '',
        createdAt: place.createdAt,
      });
    }
    return { format: 'json', places, categories: incomingCats, skipped };
  }

  function parseJsonImport(text, filename) {
    let data;
    try {
      data = JSON.parse(text);
    } catch (_) {
      throw new Error('JSON non valido');
    }
    const rawPlaces = Array.isArray(data) ? data : (data && Array.isArray(data.places) ? data.places : null);
    if (rawPlaces) return parseLegacyBackup(data, rawPlaces);
    if (data && Array.isArray(data.features)) {
      const savedPlaces = /saved places|luoghi salvati/i.test(String(filename || ''));
      return parseGeoJsonImport(data, { defaultFavorite: savedPlaces });
    }
    throw new Error('JSON non riconosciuto: servono luoghi o una FeatureCollection');
  }

  function parseKmlImport(text) {
    const doc = new DOMParser().parseFromString(text, 'text/xml');
    if (doc.querySelector('parsererror')) throw new Error('KML non valido');
    const placemarks = Array.from(doc.getElementsByTagNameNS('*', 'Placemark'));
    if (placemarks.length === 0) throw new Error('Il KML non contiene luoghi');
    const places = [];
    const skipped = [];
    for (const placemark of placemarks) {
      const data = {};
      for (const node of placemark.getElementsByTagNameNS('*', 'Data')) {
        const key = headerKey(node.getAttribute('name') || '');
        if (key) data[key] = textByLocalName(node, 'value');
      }
      for (const node of placemark.getElementsByTagNameNS('*', 'SimpleData')) {
        const key = headerKey(node.getAttribute('name') || '');
        if (key) data[key] = node.textContent.trim();
      }
      const address = cleanText(data.indirizzo || data.address || '', 300);
      const name = cleanText(textByLocalName(placemark, 'name') || data.nome || address, 120);
      let lat = null;
      let lng = null;
      const coordsText = textByLocalName(placemark, 'coordinates');
      if (coordsText) {
        const parts = coordsText.trim().split(/\s+/)[0].split(',');
        lng = parseCoordinateValue(parts[0]);
        lat = parseCoordinateValue(parts[1]);
      }
      if (!name) { skipped.push(skippedEntry(address, 'nome mancante')); continue; }
      if (!validLatLng(lat, lng)) { skipped.push(skippedEntry(name, 'coordinate mancanti o non valide')); continue; }
      const note = data.nota || data.note || stripTags(textByLocalName(placemark, 'description'));
      places.push({
        name,
        lat,
        lng,
        address,
        note: cleanText(note, 1000),
        favorite: parseFavoriteValue(data.preferito != null ? data.preferito : data.favorite),
        status: parseStatusValue(data.stato != null ? data.stato : data.status),
        categoryId: '',
        categoryName: cleanText(data.categoria || data.category || '', 40),
        createdAt: Date.now(),
      });
    }
    return { format: 'kml', places, categories: [], skipped };
  }

  function parseGpxImport(text) {
    const doc = new DOMParser().parseFromString(text, 'text/xml');
    if (doc.querySelector('parsererror')) throw new Error('GPX non valido');
    const waypoints = Array.from(doc.getElementsByTagNameNS('*', 'wpt'));
    if (waypoints.length === 0) throw new Error('Il GPX non contiene waypoint');
    const places = [];
    const skipped = [];
    for (const wpt of waypoints) {
      const lat = parseCoordinateValue(wpt.getAttribute('lat'));
      const lng = parseCoordinateValue(wpt.getAttribute('lon'));
      const extensions = firstByLocalName(wpt, 'extensions');
      const ext = (name) => (extensions ? textByLocalName(extensions, name) : '');
      const name = cleanText(textByLocalName(wpt, 'name') || ext('name'), 120);
      const address = cleanText(ext('address') || ext('indirizzo'), 300);
      if (!name) { skipped.push(skippedEntry(address, 'nome mancante')); continue; }
      if (!validLatLng(lat, lng)) { skipped.push(skippedEntry(name, 'coordinate mancanti o non valide')); continue; }
      const note = ext('note') || ext('nota') || textByLocalName(wpt, 'desc');
      places.push({
        name,
        lat,
        lng,
        address,
        note: cleanText(note, 1000),
        favorite: parseFavoriteValue(ext('favorite') || ext('preferito')),
        status: parseStatusValue(ext('status') || ext('stato')),
        categoryId: '',
        categoryName: cleanText(ext('category') || ext('categoria') || textByLocalName(wpt, 'type'), 40),
        createdAt: Date.now(),
      });
    }
    return { format: 'gpx', places, categories: [], skipped };
  }

  function parseImportText(raw, filename) {
    const text = String(raw == null ? '' : raw).replace(/^\uFEFF/, '');
    if (!text.trim()) throw new Error('Il file è vuoto');
    if (/^\s*[{[]/.test(text)) return parseJsonImport(text, filename);
    const head = text.slice(0, 4000);
    if (/<kml[\s>]/i.test(head)) return parseKmlImport(text);
    if (/<gpx[\s>]/i.test(head)) return parseGpxImport(text);
    if (/<html[\s>]/i.test(head)) throw new Error('File HTML non supportato: usa CSV, KML o GPX');
    return parseCsvImport(text, filename);
  }

  /* ------------------ Importazione: anteprima e conferma -------------- */

  function importStat(value, label) {
    return h('div', { class: 'import-stat' }, h('strong', { text: String(value) }), h('span', { text: label }));
  }

  function importFile(file) {
    if (!file) return;
    if (importRunning) {
      showToast('Importazione già in corso', { tone: 'error' });
      return;
    }
    if (file.size > MAX_IMPORT_BYTES) {
      showToast('File troppo grande: il limite è 5 MB', { tone: 'error' });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      let payload;
      try {
        payload = parseImportText(reader.result, file.name);
      } catch (err) {
        showToast(err && err.message ? err.message : 'File non valido', { tone: 'error' });
        return;
      }
      if (!payload.places.length && !payload.skipped.length) {
        showToast('Nessun luogo riconosciuto nel file', { tone: 'error' });
        return;
      }
      if (payload.places.length > MAX_IMPORT_PLACES) {
        const dropped = payload.places.length - MAX_IMPORT_PLACES;
        payload.places = payload.places.slice(0, MAX_IMPORT_PLACES);
        payload.dropped = dropped;
        showToast('File troppo grande: importate le prime ' + MAX_IMPORT_PLACES + ' voci', { tone: 'error', duration: 8000 });
      }
      openImportPreview(payload);
    };
    reader.onerror = () => showToast('Impossibile leggere il file', { tone: 'error' });
    reader.readAsText(file);
  }

  function openImportPreview(payload, options = {}) {
    const ready = [];
    const seenIndex = new Map();
    let duplicatesInFile = 0;
    for (const entry of payload.places) {
      if (validLatLng(entry.lat, entry.lng) && findDuplicate(entry, seenIndex)) {
        duplicatesInFile++;
        continue;
      }
      if (validLatLng(entry.lat, entry.lng)) {
        const key = foldedName(entry);
        const bucket = seenIndex.get(key);
        if (bucket) bucket.push(entry);
        else seenIndex.set(key, [entry]);
      }
      ready.push(entry);
    }
    const pending = ready.filter((entry) => !validLatLng(entry.lat, entry.lng)).length;
    const savedIndex = buildNameIndex(state.places);
    const alreadySaved = ready.filter((entry) => validLatLng(entry.lat, entry.lng)
      && findDuplicate(entry, savedIndex)).length;
    const invalid = payload.skipped.length;
    const total = payload.places.length + invalid;

    const list = h('ul', { class: 'import-preview' });
    for (const entry of ready.slice(0, 100)) {
      const catName = entry.categoryName || (entry.categoryId ? getCategory(entry.categoryId).name : '');
      const tags = [
        catName,
        STATUS_LABELS[entry.status],
        entry.favorite ? '★' : '',
        validLatLng(entry.lat, entry.lng) ? '' : 'da geocodificare',
      ].filter(Boolean).join(' · ');
      list.appendChild(h('li', {},
        h('span', { class: 'import-name', text: entry.name }),
        tags ? h('span', { class: 'import-tags', text: tags }) : null
      ));
    }
    if (ready.length > 100) {
      list.appendChild(h('li', { class: 'import-more', text: '…e altri ' + (ready.length - 100) + ' luoghi' }));
    }

    const body = h('div', {},
      h('p', { class: 'import-intro', text: total + (total === 1 ? ' voce letta' : ' voci lette')
        + ' · ' + ready.length + (ready.length === 1 ? ' luogo importabile' : ' luoghi importabili') + '.' }),
      h('div', { class: 'import-stats' },
        importStat(ready.length - pending, 'pronti con coordinate'),
        importStat(pending, 'da geocodificare'),
        importStat(duplicatesInFile, 'duplicati nel file'),
        importStat(alreadySaved, 'già presenti'),
        importStat(invalid, 'voci non valide')
      ),
      list,
      pending > 0
        ? h('p', { class: 'import-note', text: 'I ' + pending + ' luoghi senza coordinate verranno cercati con Nominatim, una richiesta al secondo. Potrebbero servire alcuni minuti.' })
        : null,
      duplicatesInFile > 0
        ? h('p', { class: 'import-note', text: 'I duplicati con lo stesso nome e coordinate vicine vengono saltati automaticamente.' })
        : null,
      invalid > 0
        ? h('p', { class: 'import-note', text: invalid + (invalid === 1 ? ' voce non valida verrà ignorata.' : ' voci non valide verranno ignorate.') })
        : null,
      payload.dropped > 0
        ? h('p', { class: 'import-note', text: payload.dropped + ' voci in eccesso non verranno importate (limite di ' + MAX_IMPORT_PLACES + ' luoghi per volta).' })
        : null
    );

    if (ready.length === 0) {
      showModal({ title: 'Nessun nuovo luogo', body, actions: [{ label: 'Chiudi', kind: 'primary' }] });
      return;
    }

    const start = (mode) => () => {
      closeOverlayThen('modal', () => { void startImport(payload, mode); });
      return false;
    };
    const actions = [{ label: 'Annulla', kind: 'ghost' }];
    if (state.places.length === 0) {
      actions.push({ label: 'Importa ' + ready.length, kind: 'primary', onClick: start('replace') });
    } else {
      actions.push({ label: 'Unisci', kind: 'soft', onClick: start('merge') });
      actions.push({ label: 'Sostituisci', kind: 'primary', onClick: start('replace') });
    }
    showModal({ title: options.title || 'Anteprima importazione', body, actions });
  }

  function resolveImportCategory(entry) {
    if (entry.categoryId && state.categories.some((cat) => cat.id === entry.categoryId)) return entry.categoryId;
    if (entry.categoryName) {
      const existing = state.categories.find((cat) => fold(cat.name) === fold(entry.categoryName));
      if (existing) return existing.id;
      let hash = 0;
      for (const ch of entry.categoryName) hash = (hash + ch.charCodeAt(0)) % PALETTE.length;
      const category = {
        id: 'cat-' + uid().slice(0, 8),
        name: cleanText(entry.categoryName, 40),
        color: PALETTE[hash],
        icon: '📍',
        custom: true,
      };
      state.categories.push(category);
      return category.id;
    }
    return 'altro';
  }

  async function startImport(payload, mode) {
    if (importRunning) return;
    importRunning = true;
    try {
      const pending = payload.places.filter((entry) => !validLatLng(entry.lat, entry.lng));
      const geocodeFailures = [];
      for (let i = 0; i < pending.length; i++) {
        const entry = pending[i];
        showToast('Geocodifica ' + (i + 1) + ' di ' + pending.length + ': ' + entry.name, { duration: 300000 });
        const query = [entry.name, entry.address].filter(Boolean).join(', ');
        const result = await forwardGeocode(query);
        if (result && validLatLng(result.lat, result.lng)) {
          entry.lat = result.lat;
          entry.lng = result.lng;
          if (!entry.address && result.address) entry.address = result.address;
        } else {
          geocodeFailures.push({ name: entry.name, reason: 'coordinate non trovate' });
        }
      }

      const target = mode === 'replace' ? [] : state.places.slice();
      const targetIndex = buildNameIndex(target);
      const accepted = [];
      let duplicates = 0;
      for (const entry of payload.places) {
        if (!entry.name || !validLatLng(entry.lat, entry.lng)) continue;
        if (findDuplicate(entry, targetIndex)) {
          duplicates++;
          continue;
        }
        target.push(entry);
        const key = foldedName(entry);
        const bucket = targetIndex.get(key);
        if (bucket) bucket.push(entry);
        else targetIndex.set(key, [entry]);
        accepted.push(entry);
      }

      const skipped = payload.skipped.concat(geocodeFailures);
      if (accepted.length === 0) {
        showImportSummary({
          imported: 0,
          duplicates,
          geocodeFailed: geocodeFailures.length,
          invalid: payload.skipped.length,
          skipped,
          mode,
          replaced: 0,
        });
        return;
      }

      const snapshotCategories = state.categories.slice();
      const snapshotPlaces = state.places.slice();
      let categoriesChanged = false;
      for (const category of payload.categories) {
        if (!state.categories.some((cat) => cat.id === category.id)) {
          state.categories.push(category);
          categoriesChanged = true;
        }
      }
      const newPlaces = accepted.map((entry) => {
        const before = state.categories.length;
        const categoryId = resolveImportCategory(entry);
        if (state.categories.length !== before) categoriesChanged = true;
        return {
          id: uid(),
          name: entry.name,
          categoryId,
          note: entry.note,
          favorite: entry.favorite,
          status: entry.status,
          address: entry.address,
          lat: entry.lat,
          lng: entry.lng,
          createdAt: entry.createdAt || Date.now(),
          updatedAt: Date.now(),
        };
      });

      if (mode === 'replace') state.places = newPlaces;
      else state.places.push(...newPlaces);

      const categoriesSaved = !categoriesChanged || saveCategories();
      const placesSaved = savePlaces();
      if (!categoriesSaved || !placesSaved) {
        state.categories = snapshotCategories;
        state.places = snapshotPlaces;
        if (!categoriesSaved || !placesSaved) saveCategories();
        renderAll();
        showToast('Importazione non riuscita: spazio esaurito', { tone: 'error' });
        return;
      }

      if (map) map.closePopup();
      renderAll();
      if (map && newPlaces.length > 0) {
        const bounds = L.latLngBounds(newPlaces.map((place) => [place.lat, place.lng]));
        if (bounds.isValid()) map.fitBounds(bounds.pad(0.2), { maxZoom: 14 });
      }
      showImportSummary({
        imported: newPlaces.length,
        duplicates,
        geocodeFailed: geocodeFailures.length,
        invalid: payload.skipped.length,
        skipped,
        mode,
        replaced: mode === 'replace' ? snapshotPlaces.length : 0,
      });
    } catch (_) {
      showToast('Importazione non riuscita', { tone: 'error' });
    } finally {
      importRunning = false;
    }
  }

  function showImportSummary(stats) {
    hideToast();
    const body = h('div', {},
      stats.replaced > 0
        ? h('p', { text: 'Hai sostituito ' + stats.replaced + (stats.replaced === 1 ? ' luogo precedente.' : ' luoghi precedenti.') })
        : null,
      h('div', { class: 'import-stats' },
        importStat(stats.imported, 'importati'),
        importStat(stats.duplicates, 'duplicati saltati'),
        importStat(stats.geocodeFailed, 'senza coordinate'),
        importStat(stats.invalid, 'non validi')
      ),
      stats.skipped.length
        ? h('details', { class: 'import-skipped' },
            h('summary', { text: 'Dettaglio voci saltate' }),
            h('ul', {}, stats.skipped.slice(0, 30).map((item) => h('li', { text: item.name + ' · ' + item.reason })))
          )
        : null
    );
    showModal({
      title: stats.imported > 0 ? 'Importazione completata' : 'Nessun luogo importato',
      body,
      actions: [{ label: 'Chiudi', kind: 'primary' }],
    });
  }

  /* ------------------------------ Info ------------------------------- */

  function openInfoModal() {
    const body = h('div', {},
      h('p', {}, h('strong', { text: 'Mappo' }), ' · versione 1.6.2'),
      h('p', { text: 'I luoghi sono salvati solo su questo dispositivo. Esporta un backup ogni tanto per non perderli.' }),
      h('p', { text: 'Puoi condividere un luogo da Google Maps o da un\'altra app: scegli «Mappo» nel menu di condivisione e ritrovalo nel form, già precompilato.' }),
      h('p', { text: 'Tocca «Vicino a me» per vedere la distanza di ogni luogo e ordinarli dal più vicino; tocca di nuovo per tornare all\'ordine alfabetico.' }),
      h('p', { text: 'Esporta in JSON, GeoJSON, KML, GPX o CSV. Importa anche i file di Google Takeout: prima vedi un\'anteprima e i duplicati vengono saltati.' }),
      h('p', { text: 'Condividi la lista come file o come link: chi lo apre vede un\'anteprima e sceglie se importarla.' }),
      h('p', { text: state.places.length + (state.places.length === 1 ? ' luogo salvato.' : ' luoghi salvati.') }),
      h('p', {}, 'Licenza: ', h('a', {
        href: 'https://polyformproject.org/licenses/noncommercial/1.0.0',
        target: '_blank',
        rel: 'noopener',
        text: 'PolyForm Noncommercial 1.0.0',
      }), ' (uso non commerciale). Mappa: OpenFreeMap, dati OpenStreetMap.')
    );

    showModal({
      title: 'Informazioni',
      body,
      actions: [
        {
          label: 'Cancella tutti',
          kind: 'danger-ghost',
          onClick: () => {
            if (state.places.length === 0) {
              showToast('Non ci sono luoghi da cancellare');
              return false;
            }
            closeOverlayThen('modal', confirmClearAll);
            return false;
          },
        },
        { label: 'Chiudi', kind: 'primary' },
      ],
    });
  }

  function confirmClearAll() {
    showModal({
      title: 'Cancellare tutti i luoghi?',
      body: h('p', { text: 'Questa operazione rimuove tutti i luoghi salvati su questo dispositivo e non può essere annullata.' }),
      actions: [
        { label: 'Annulla', kind: 'ghost' },
        {
          label: 'Cancella tutto',
          kind: 'danger',
          onClick: () => {
            const previous = state.places;
            state.places = [];
            if (!savePlaces()) {
              state.places = previous;
              return false;
            }
            if (map) map.closePopup();
            renderAll();
            showToast('Tutti i luoghi sono stati cancellati');
          },
        },
      ],
    });
  }

  /* --------------------------- Installazione ------------------------- */

  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches
      || window.navigator.standalone === true;
  }

  function setupInstall() {
    window.addEventListener('beforeinstallprompt', (event) => {
      event.preventDefault();
      state.installPrompt = event;
    });
    window.addEventListener('appinstalled', () => {
      state.installPrompt = null;
      showToast('App installata sul dispositivo', { tone: 'success' });
    });
  }

  function showInstallButton() {
    if (isStandalone()) {
      $('btnInstall').hidden = true;
      return;
    }
    $('btnInstall').hidden = false;
  }

  async function promptInstall() {
    if (isStandalone()) {
      showToast('L\'app è già installata');
      return;
    }
    if (state.installPrompt) {
      state.installPrompt.prompt();
      try {
        const choice = await state.installPrompt.userChoice;
        if (choice && choice.outcome === 'accepted') showToast('App installata', { tone: 'success' });
      } catch (_) { /* noop */ }
      state.installPrompt = null;
      return;
    }
    const isAndroid = /android/i.test(navigator.userAgent);
    const body = h('div', {},
      h('p', { text: isAndroid
        ? 'Apri il menu di Chrome (⋮) e scegli "Installa app" oppure "Aggiungi a schermata Home".'
        : 'Apri il menu del browser e scegli "Installa app" per aggiungerla al telefono o al computer.' }),
      h('p', { text: 'L\'installazione richiede che la pagina sia servita da un indirizzo sicuro (https).' })
    );
    showModal({ title: 'Installa l\'app', body, actions: [{ label: 'Ho capito', kind: 'primary' }] });
  }

  /* --------------------------- Connettività -------------------------- */

  function setupConnectivity() {
    const update = () => { $('offlineBadge').hidden = navigator.onLine; };
    window.addEventListener('online', () => { update(); showToast('Connessione ripristinata', { tone: 'success' }); });
    window.addEventListener('offline', update);
    update();
  }

  /* ------------------------- Service worker -------------------------- */

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    let reloadRequested = false;
    let promptedWorker = null;

    const promptReload = (worker) => {
      if (!worker || promptedWorker === worker) return;
      promptedWorker = worker;
      showToast('Nuova versione disponibile', {
        duration: 9000,
        actionLabel: 'Ricarica',
        onAction: () => {
          reloadRequested = true;
          worker.postMessage({ type: 'SKIP_WAITING' });
        },
      });
    };

    window.addEventListener('load', async () => {
      try {
        const reg = await navigator.serviceWorker.register('./sw.js', { scope: './' });
        const watchWorker = (worker) => {
          if (!worker) return;
          const check = () => {
            if (worker.state === 'installed' && navigator.serviceWorker.controller) promptReload(worker);
          };
          check();
          worker.addEventListener('statechange', check);
        };
        // L'update può essere già stato rilevato prima che questo codice parta.
        if (reg.waiting) promptReload(reg.waiting);
        watchWorker(reg.installing);
        reg.addEventListener('updatefound', () => watchWorker(reg.installing));
      } catch (_) { /* offline o contesto non sicuro */ }
    });

    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!reloadRequested) return;
      reloadRequested = false;
      window.location.reload();
    });
  }

  /* ------------------------- Gesti sulla mappa ----------------------- */

  function bindMapGestures() {
    const container = map.getContainer();
    let pressTimer = null;
    let startPoint = null;

    const clearPress = () => {
      if (pressTimer) {
        clearTimeout(pressTimer);
        pressTimer = null;
      }
    };

    container.addEventListener('touchstart', (event) => {
      if (event.touches.length !== 1) { clearPress(); startPoint = null; return; }
      const target = event.target;
      if (target && target.closest && target.closest('.leaflet-marker-icon, .leaflet-popup, .leaflet-control')) return;
      startPoint = { x: event.touches[0].clientX, y: event.touches[0].clientY };
      clearPress();
      pressTimer = setTimeout(() => {
        pressTimer = null;
        if (!startPoint) return;
        if (overlays.some((o) => o.kind === 'sheet' || o.kind === 'drawer')) return;
        const rect = container.getBoundingClientRect();
        const point = L.point(startPoint.x - rect.left, startPoint.y - rect.top);
        const latlng = map.containerPointToLatLng(point);
        if (navigator.vibrate) { try { navigator.vibrate(15); } catch (_) { /* noop */ } }
        startAddPlace({ lat: latlng.lat, lng: latlng.lng });
      }, 560);
    }, { passive: true });

    container.addEventListener('touchmove', (event) => {
      if (!startPoint || !event.touches[0]) return;
      const dx = event.touches[0].clientX - startPoint.x;
      const dy = event.touches[0].clientY - startPoint.y;
      if (Math.sqrt(dx * dx + dy * dy) > 12) clearPress();
    }, { passive: true });

    container.addEventListener('touchend', () => { clearPress(); startPoint = null; }, { passive: true });
    container.addEventListener('touchcancel', () => { clearPress(); startPoint = null; }, { passive: true });

    container.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      const target = event.target;
      if (target && target.closest && target.closest('.leaflet-popup, .leaflet-control, .leaflet-marker-icon')) return;
      const latlng = map.mouseEventToLatLng(event);
      startAddPlace({ lat: latlng.lat, lng: latlng.lng });
    });
  }

  /* ------------------------------ Eventi ----------------------------- */

  function bindUI() {
    $('btnMenu').addEventListener('click', () => openDrawer());
    $('btnSearchTop').addEventListener('click', () => openDrawer({ focusSearch: true }));
    $('btnCloseDrawer').addEventListener('click', () => requestCloseOverlay('drawer'));
    $('btnAdd').addEventListener('click', () => startAddPlaceFromCenter());
    $('btnAddFromDrawer').addEventListener('click', () => {
      closeOverlayThen('drawer', startAddPlaceFromCenter);
    });
    $('btnLocate').addEventListener('click', () => locateUser());
    $('btnNearMe').addEventListener('click', () => { void toggleNearMe(); });
    $('scrim').addEventListener('click', () => {
      if (overlays.some((o) => o.kind === 'sheet')) requestCloseOverlay('sheet');
      else requestCloseOverlay('drawer');
    });

    const searchInput = $('searchInput');
    // Il filtro viene ricalcolato con un piccolo ritardo: a ogni tasto
    // l'elenco e i marker venivano ricostruiti da zero.
    let searchTimer = null;
    const applySearch = () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        renderChips();
        renderList();
      }, 120);
    };
    searchInput.addEventListener('input', () => {
      state.query = searchInput.value;
      $('btnClearSearch').hidden = searchInput.value.length === 0;
      applySearch();
    });
    $('btnClearSearch').addEventListener('click', () => {
      searchInput.value = '';
      state.query = '';
      $('btnClearSearch').hidden = true;
      clearTimeout(searchTimer);
      renderChips();
      renderList();
      searchInput.focus();
    });

    $('filterFavorites').addEventListener('click', toggleFavoritesFilter);
    $('filterTodo').addEventListener('click', () => toggleStatusFilter('da_visitare'));
    $('filterDone').addEventListener('click', () => toggleStatusFilter('visitato'));

    $('btnCloseSheet').addEventListener('click', () => closeSheet());
    $('btnCancelSheet').addEventListener('click', () => closeSheet());
    $('btnFavorite').addEventListener('click', () => setFavoriteUI(!isFavoriteSelected()));
    $('placeForm').addEventListener('submit', submitForm);
    $('placeName').addEventListener('input', () => { if ($('placeName').value.trim()) $('nameError').hidden = true; });
    $('btnNewCategory').addEventListener('click', () => openNewCategoryModal());
    $('btnDeletePlace').addEventListener('click', () => {
      const place = getPlace(state.editingId);
      if (!place) return;
      // Chiude prima il foglio, poi apre la conferma: evita che resti aperto sul luogo eliminato.
      closeOverlayThen('sheet', () => confirmDelete(place));
    });

    $('btnUseGps').addEventListener('click', async () => {
      const button = $('btnUseGps');
      button.classList.add('loading');
      const position = await locateUser({ quiet: true });
      button.classList.remove('loading');
      if (!position) {
        showToast('Impossibile ottenere la posizione', { tone: 'error' });
        return;
      }
      setDraftCoords(position.lat, position.lng, '');
      updateDraftUI();
      geocodeDraft();
      showToast('Posizione impostata', { tone: 'success' });
    });

    $('btnPickMap').addEventListener('click', () => enterPickMode());
    $('btnPickCancel').addEventListener('click', () => exitPickMode());
    $('btnPickConfirm').addEventListener('click', () => {
      const center = map.getCenter();
      setDraftCoords(center.lat, center.lng, '');
      exitPickMode();
      updateDraftUI();
      geocodeDraft();
    });

    $('btnParseLink').addEventListener('click', () => {
      const result = parseCoordinates($('gmapsInput').value);
      const error = $('gmapsError');
      if (result.error) {
        error.textContent = result.error;
        error.hidden = false;
        return;
      }
      error.hidden = true;
      setDraftCoords(result.lat, result.lng, '');
      updateDraftUI();
      if (result.name && !$('placeName').value.trim()) $('placeName').value = result.name;
      geocodeDraft();
      showToast('Coordinate importate', { tone: 'success' });
    });

    $('btnExport').addEventListener('click', () => openExportModal());
    $('btnShare').addEventListener('click', openShareModal);
    $('btnImport').addEventListener('click', () => $('importFile').click());
    $('importFile').addEventListener('change', (event) => {
      const file = event.target.files && event.target.files[0];
      if (file) importFile(file);
      event.target.value = '';
    });
    $('btnInstall').addEventListener('click', promptInstall);
    $('btnInfo').addEventListener('click', openInfoModal);

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        if (!$('modal').hidden) { requestCloseOverlay('modal'); return; }
        if (!$('pickBar').hidden) { exitPickMode(); return; }
        if ($('sheet').classList.contains('open')) { closeSheet(); return; }
        if ($('drawer').classList.contains('open')) requestCloseOverlay('drawer');
        return;
      }
      const typing = /^(input|textarea|select)$/i.test(document.activeElement && document.activeElement.tagName);
      if (!typing && event.key === '/') {
        event.preventDefault();
        openDrawer({ focusSearch: true });
      }
    });

    window.addEventListener('hashchange', () => {
      if (shareTokenFromHash()) void handleShareLink();
    });

    window.addEventListener('beforeunload', () => {
      if (map) {
        const c = map.getCenter();
        state.settings.view = { lat: c.lat, lng: c.lng, zoom: map.getZoom() };
        saveSettings();
      }
    });
  }

  /* ------------------------------ Avvio ------------------------------ */

  function handleUrlActions() {
    const params = new URLSearchParams(window.location.search);
    if (params.get('share') === '1') {
      void handleShareTarget({
        title: params.get('title') || '',
        text: (params.get('text') || '').slice(0, MAX_SHARE_TEXT),
        url: (params.get('url') || '').slice(0, MAX_SHARE_URL),
      });
      return;
    }
    const action = params.get('action');
    if (!action) return;
    try {
      history.replaceState({}, '', window.location.pathname + window.location.hash);
    } catch (_) { /* noop */ }
    if (action === 'add') {
      setTimeout(() => startAddPlaceFromCenter(), 400);
    } else if (action === 'search') {
      setTimeout(() => openDrawer({ focusSearch: true }), 400);
    }
  }

  function maybeShowWelcome() {
    if (shareLinkPending) return;
    // Poco dopo una condivisione il benvenuto coprirebbe il form: meglio aspettare.
    if (Date.now() - shareHandledAt < 10000) return;
    if (state.places.length > 0 || state.settings.welcomeShown) return;
    setTimeout(() => {
      if (overlays.length > 0) return;
      state.settings.welcomeShown = true;
      saveSettings();
      openDrawer();
      showToast('Tieni premuto sulla mappa per aggiungere un luogo');
    }, 800);
  }

  function init() {
    loadData();
    // I listener si registrano prima della mappa: se la mappa non parte,
    // l'interfaccia resta comunque utilizzabile.
    bindUI();
    try {
      initMap();
    } catch (err) {
      // Senza mappa l'app resta utilizzabile (lista, export, import,
      // condivisione) e il service worker viene comunque registrato.
      console.error('[map] inizializzazione fallita', err);
      showToast('Mappa non disponibile: alcuni file non sono stati caricati', { tone: 'error', duration: 10000 });
    }
    renderAll();
    showInstallButton();
    setupInstall();
    setupConnectivity();
    registerServiceWorker();
    handleUrlActions();
    void handleShareLink();
    maybeShowWelcome();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
