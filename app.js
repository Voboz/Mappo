/* ============================================================
   Luoghi del cuore — logica dell'applicazione
   ------------------------------------------------------------
   - Mappa OpenStreetMap (Leaflet, incluso in locale)
   - Dati salvati sul dispositivo (localStorage)
   - Categorie colorate, ricerca per nome, menu laterale
   - Import da link Google Maps, navigazione Waze / Google Maps
   ============================================================ */
(() => {
  'use strict';

  /* ----------------------------- Costanti ----------------------------- */

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

  const OSM_TILES = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
  const OSM_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';
  const NOMINATIM_REVERSE = 'https://nominatim.openstreetmap.org/reverse';
  const ITALY_CENTER = [42.5, 12.5];

  const GEO_OPTIONS = { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 };

  /* ----------------------------- Stato ------------------------------- */

  const state = {
    places: [],
    categories: [],
    settings: {},
    query: '',
    category: 'all',
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
  let lastAddAt = 0;
  let geocodeSeq = 0;
  let lastGeocodeAt = 0;
  let toastTimer = null;
  let toastHideTimer = null;

  const overlays = [];
  let historyOk = true;

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
        else if (key === 'html') el.innerHTML = value;
        else if (key === 'style' && typeof value === 'object') Object.assign(el.style, value);
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
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
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

  function savePlaces() { writeJSON(STORAGE.places, state.places); }
  function saveCategories() { writeJSON(STORAGE.categories, state.categories); }
  function saveSettings() { writeJSON(STORAGE.settings, state.settings); }

  function fold(text) {
    return String(text || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
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

  function sanitizePlace(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const lat = Number(raw.lat);
    const lng = Number(raw.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
    const name = String(raw.name || '').trim().slice(0, 120) || 'Luogo senza nome';
    const categoryId = state.categories.some((c) => c.id === raw.categoryId) ? raw.categoryId : 'altro';
    return {
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
    state.places = (Array.isArray(storedPlaces) ? storedPlaces : [])
      .map(sanitizePlace)
      .filter(Boolean);

    const settings = readJSON(STORAGE.settings);
    state.settings = settings && typeof settings === 'object' ? settings : {};
  }

  /* ------------------------------ Mappa ------------------------------ */

  function initMap() {
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

    L.tileLayer(OSM_TILES, {
      maxZoom: 19,
      attribution: OSM_ATTR,
    }).addTo(map);

    L.control.zoom({ position: 'bottomleft' }).addTo(map);
    if (map.attributionControl) map.attributionControl.setPosition('bottomright');

    const view = state.settings.view;
    if (view && Number.isFinite(view.lat) && Number.isFinite(view.lng) && Number.isFinite(view.zoom)) {
      map.setView([view.lat, view.lng], view.zoom);
    } else {
      map.setView(ITALY_CENTER, 6);
    }

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
    state.currentPosition = { lat: latitude, lng: longitude, accuracy };
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
      if (el) el.classList.toggle('is-hidden', !visible.has(id));
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
      tool('Elimina', 'i-trash', () => confirmDelete(place, false), 'danger')
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
    if (fold(place.name).includes(needle)) return true;
    if (place.note && fold(place.note).includes(needle)) return true;
    if (place.address && fold(place.address).includes(needle)) return true;
    if (fold(getCategory(place.categoryId).name).includes(needle)) return true;
    return false;
  }

  function getFilteredPlaces() {
    const needle = fold(state.query);
    return state.places
      .filter((p) => (state.category === 'all' || p.categoryId === state.category) && matchesQuery(p, needle))
      .sort((a, b) => a.name.localeCompare(b.name, 'it', { sensitivity: 'base', numeric: true }));
  }

  /* --------------------------- Rendering --------------------------- */

  function renderChips() {
    const needle = fold(state.query);
    const base = state.places.filter((p) => matchesQuery(p, needle));
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
          $('btnClearSearch').hidden = true;
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
    } else if (state.query || state.category !== 'all') {
      $('topbarSub').textContent = count === 1 ? '1 luogo trovato' : count + ' luoghi trovati';
    } else {
      const total = state.places.length;
      $('topbarSub').textContent = total === 1 ? '1 luogo salvato' : total + ' luoghi salvati';
    }

    applyMarkerFilter();
  }

  function listItem(place) {
    const cat = getCategory(place.categoryId);
    const meta = place.address
      ? cat.name + ' · ' + place.address
      : cat.name;

    let distanceEl = null;
    if (state.currentPosition) {
      const meters = haversine(state.currentPosition.lat, state.currentPosition.lng, place.lat, place.lng);
      distanceEl = h('span', { class: 'place-dist', text: formatDistance(meters) });
    } else {
      distanceEl = svgIcon('i-chevron-right', 'icon chev');
    }

    const nameEl = h('span', { class: 'place-name' });
    highlightInto(nameEl, place.name, state.query);

    const button = h('button', {
      type: 'button',
      class: 'place-item',
      dataset: { id: place.id },
      onclick: () => selectPlace(place.id),
    },
      h('span', { class: 'place-icon', style: { '--c': cat.color }, text: cat.icon }),
      h('span', { class: 'place-text' }, nameEl, h('span', { class: 'place-meta', text: meta })),
      distanceEl
    );
    return button;
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
    overlays.push({ kind, onClose });
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
    if (historyOk) {
      history.back();
    } else {
      overlays.pop();
      top.onClose();
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
    if (!overlays.some((o) => o.kind === kind)) finish();
    setTimeout(finish, 650);
  }

  window.addEventListener('popstate', () => {
    const entry = overlays.pop();
    if (entry) entry.onClose();
  });

  function updateScrim() {
    const needed = $('drawer').classList.contains('open') || $('sheet').classList.contains('open');
    $('scrim').classList.toggle('show', needed);
  }

  /* ----------------------------- Drawer ------------------------------ */

  function showDrawer(entry) {
    const drawer = $('drawer');
    drawer.classList.add('open');
    drawer.inert = false;
    drawer.setAttribute('aria-hidden', 'false');
    $('btnMenu').setAttribute('aria-expanded', 'true');
    updateScrim();
    return entry;
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
    if (focusSearch) setTimeout(() => $('searchInput').focus({ preventScroll: true }), 320);
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
    const now = Date.now();
    if (now - lastAddAt < 500) return;
    lastAddAt = now;

    const center = map.getCenter();
    state.editingId = null;
    state.draft = {
      lat: Number.isFinite(lat) ? lat : center.lat,
      lng: Number.isFinite(lng) ? lng : center.lng,
      address,
    };

    $('placeForm').reset();
    $('nameError').hidden = true;
    $('gmapsError').hidden = true;
    $('placeName').value = name;
    $('placeNote').value = '';
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
    map.closePopup();
    state.editingId = place.id;
    state.draft = { lat: place.lat, lng: place.lng, address: place.address || '' };
    $('placeForm').reset();
    $('nameError').hidden = true;
    $('gmapsError').hidden = true;
    $('placeName').value = place.name;
    $('placeNote').value = place.note || '';
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
    state.draft = { lat, lng, address };
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

  async function reverseGeocode(lat, lng) {
    const wait = Math.max(0, 1100 - (Date.now() - lastGeocodeAt));
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
    $('app').classList.add('picking');
    $('crosshair').hidden = false;
    $('pickBar').hidden = false;
    if (state.draft) {
      map.setView([state.draft.lat, state.draft.lng], Math.max(map.getZoom(), 16));
    }
    updatePickCoords();
    map.on('move', updatePickCoords);
  }

  function resetPickUI() {
    $('app').classList.remove('picking');
    $('crosshair').hidden = true;
    $('pickBar').hidden = true;
    if (map) map.off('move', updatePickCoords);
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
    if (!err) return 'Posizione non disponibile';
    if (err.message === 'unsupported') return 'Questo dispositivo non supporta la geolocalizzazione';
    switch (err.code) {
      case 1: return 'Permesso posizione negato: puoi scegliere il punto sulla mappa';
      case 2: return 'Posizione non disponibile, riprova tra poco';
      case 3: return 'Tempo scaduto nel recupero della posizione';
      default: return 'Posizione non disponibile';
    }
  }

  async function locateUser({ quiet = false } = {}) {
    const btn = $('btnLocate');
    btn.classList.add('busy');
    try {
      const position = await getPosition();
      showPositionOnMap(position);
      btn.classList.add('is-active');
      map.flyTo([position.coords.latitude, position.coords.longitude], Math.max(map.getZoom(), 16), { duration: 0.8 });
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
    let place;

    if (wasEditing) {
      place = getPlace(state.editingId);
      if (!place) return;
      place.name = name;
      place.categoryId = categoryId;
      place.note = note;
      place.lat = state.draft.lat;
      place.lng = state.draft.lng;
      if (state.draft.address) place.address = state.draft.address;
      place.updatedAt = Date.now();
    } else {
      place = {
        id: uid(),
        name,
        categoryId,
        note,
        address: state.draft.address || '',
        lat: state.draft.lat,
        lng: state.draft.lng,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      state.places.push(place);
    }

    state.settings.lastCategory = categoryId;
    saveSettings();
    savePlaces();
    closeSheet();
    renderMarkers();
    renderChips();
    renderList();

    const token = ++flyToken;
    map.flyTo([place.lat, place.lng], Math.max(map.getZoom(), 15), { duration: 0.7 });
    setTimeout(() => {
      if (token !== flyToken) return;
      const marker = state.markers.get(place.id);
      if (marker) marker.openPopup();
    }, 740);

    showToast(wasEditing ? 'Luogo aggiornato' : 'Luogo salvato', { tone: 'success' });
    if (!place.address) geocodePlaceAfterSave(place);
  }

  function confirmDelete(place, fromSheet) {
    const body = h('div', {},
      h('p', {}, 'Stai per rimuovere ', h('strong', { text: place.name }), ' dai tuoi luoghi.'),
      h('p', { text: 'Subito dopo potrai annullare con il pulsante nel messaggio.' })
    );
    showModal({
      title: 'Eliminare questo luogo?',
      body,
      actions: [
        { label: 'Annulla', kind: 'ghost' },
        { label: 'Elimina', kind: 'danger', onClick: () => doDelete(place.id, fromSheet) },
      ],
    });
  }

  function doDelete(id, fromSheet) {
    const index = state.places.findIndex((p) => p.id === id);
    if (index === -1) return;
    const [removed] = state.places.splice(index, 1);
    savePlaces();
    map.closePopup();

    if (fromSheet) {
      closeSheet();
      setTimeout(() => {
        renderMarkers();
        renderChips();
        renderList();
      }, 10);
    } else {
      renderMarkers();
      renderChips();
      renderList();
    }

    showToast('Luogo eliminato', {
      tone: 'error',
      duration: 6000,
      actionLabel: 'Annulla',
      onAction: () => {
        state.places.push(removed);
        savePlaces();
        renderMarkers();
        renderChips();
        renderList();
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

    const patterns = [
      /!3d(-?\d{1,3}(?:\.\d+)?)!4d(-?\d{1,3}(?:\.\d+)?)/,
      /@(-?\d{1,3}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)/,
      /[?&](?:q|query|ll|center|destination|daddr)=(-?\d{1,3}(?:\.\d+)?)(?:,|%2C|\+| )\s*(-?\d{1,3}(?:\.\d+)?)/i,
      /geo:(-?\d{1,3}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)/i,
      /^\s*(-?\d{1,3}(?:\.\d+)?)\s*[,;]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/,
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (!match) continue;
      const lat = Number(match[1]);
      const lng = Number(match[2]);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      if (lat < -90 || lat > 90 || lng < -180 || lng > 180) continue;
      return { lat, lng, name: extractPlaceName(text) };
    }

    return { error: 'Coordinate non riconosciute. Incolla un link completo di Google Maps.' };
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

  /* ------------------------------ Modale ----------------------------- */

  function showModal({ title, body, actions = [] }) {
    const modal = $('modal');
    $('modalTitle').textContent = title;
    const bodyEl = $('modalBody');
    bodyEl.textContent = '';
    if (typeof body === 'string') bodyEl.innerHTML = body;
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
    if (firstButton) setTimeout(() => firstButton.focus(), 60);
  }

  function hideModal() {
    $('modal').hidden = true;
    $('modalBody').textContent = '';
    $('modalActions').textContent = '';
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
            saveCategories();
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
      app: 'Luoghi del cuore',
      version: 1,
      exportedAt: new Date().toISOString(),
      categories: state.categories,
      places: state.places,
    };
  }

  async function exportBackup() {
    if (state.places.length === 0) {
      showToast('Non ci sono luoghi da esportare', { tone: 'error' });
      return;
    }
    const filename = 'luoghi-del-cuore-' + new Date().toISOString().slice(0, 10) + '.json';
    const blob = new Blob([JSON.stringify(currentBackup(), null, 2)], { type: 'application/json' });
    const file = new File([blob], filename, { type: 'application/json' });

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: 'Backup luoghi del cuore' });
        return;
      } catch (err) {
        if (err && err.name === 'AbortError') return;
      }
    }

    const url = URL.createObjectURL(blob);
    const link = h('a', { href: url, download: filename });
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    showToast('Backup esportato', { tone: 'success' });
  }

  function importBackupFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      let data;
      try {
        data = JSON.parse(String(reader.result));
      } catch (_) {
        showToast('File non valido: non è un backup JSON', { tone: 'error' });
        return;
      }
      const rawPlaces = Array.isArray(data) ? data : (data && Array.isArray(data.places) ? data.places : null);
      if (!rawPlaces) {
        showToast('File non valido: mancano i luoghi', { tone: 'error' });
        return;
      }
      applyImport(data, rawPlaces);
    };
    reader.onerror = () => showToast('Impossibile leggere il file', { tone: 'error' });
    reader.readAsText(file);
  }

  function applyImport(data, rawPlaces) {
    const incomingCats = !Array.isArray(data) && Array.isArray(data.categories)
      ? data.categories.map(makeCategory).filter(Boolean)
      : [];

    const withCats = () => {
      for (const cat of incomingCats) {
        if (!state.categories.some((c) => c.id === cat.id)) state.categories.push(cat);
      }
    };
    if (incomingCats.length) withCats();

    const incoming = rawPlaces.map(sanitizePlace).filter(Boolean);
    if (incoming.length === 0) {
      showToast('Il backup non contiene luoghi validi', { tone: 'error' });
      return;
    }

    const finish = (added, mode) => {
      saveCategories();
      savePlaces();
      renderMarkers();
      renderChips();
      renderList();
      const bounds = L.latLngBounds(state.places.map((p) => [p.lat, p.lng]));
      if (bounds.isValid()) map.fitBounds(bounds.pad(0.2), { maxZoom: 14 });
      showToast(mode === 'replace'
        ? 'Backup ripristinato: ' + state.places.length + ' luoghi'
        : 'Aggiunti ' + added + (added === 1 ? ' luogo' : ' luoghi'), { tone: 'success' });
    };

    if (state.places.length === 0) {
      state.places = incoming;
      finish(incoming.length, 'replace');
      return;
    }

    const body = h('div', {},
      h('p', {}, 'Il backup contiene ', h('strong', { text: String(incoming.length) }),
        incoming.length === 1 ? ' luogo.' : ' luoghi.'),
      h('p', { text: 'Puoi unirli ai luoghi già salvati oppure sostituire tutto con il contenuto del backup.' })
    );

    showModal({
      title: 'Come importare il backup?',
      body,
      actions: [
        { label: 'Annulla', kind: 'ghost' },
        {
          label: 'Unisci',
          kind: 'soft',
          onClick: () => {
            const existing = new Set(state.places.map((p) => p.id));
            let added = 0;
            for (const place of incoming) {
              if (existing.has(place.id)) place.id = uid();
              existing.add(place.id);
              state.places.push(place);
              added++;
            }
            finish(added, 'merge');
          },
        },
        {
          label: 'Sostituisci',
          kind: 'primary',
          onClick: () => {
            const dedup = new Set();
            state.places = incoming.filter((p) => (dedup.has(p.id) ? false : dedup.add(p.id)));
            finish(state.places.length, 'replace');
          },
        },
      ],
    });
  }

  /* ------------------------------ Info ------------------------------- */

  function openInfoModal() {
    const body = h('div', {},
      h('p', {}, h('strong', { text: 'Luoghi del cuore' }), ' · versione 1.0'),
      h('p', { text: 'I luoghi sono salvati solo su questo dispositivo. Esporta un backup ogni tanto per non perderli.' }),
      h('p', { text: state.places.length + (state.places.length === 1 ? ' luogo salvato.' : ' luoghi salvati.') })
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
            state.places = [];
            savePlaces();
            map.closePopup();
            renderMarkers();
            renderChips();
            renderList();
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

    window.addEventListener('load', async () => {
      try {
        const reg = await navigator.serviceWorker.register('./sw.js', { scope: './' });
        reg.addEventListener('updatefound', () => {
          const worker = reg.installing;
          if (!worker) return;
          worker.addEventListener('statechange', () => {
            if (worker.state === 'installed' && navigator.serviceWorker.controller) {
              showToast('Nuova versione disponibile', {
                duration: 9000,
                actionLabel: 'Ricarica',
                onAction: () => {
                  reloadRequested = true;
                  worker.postMessage({ type: 'SKIP_WAITING' });
                },
              });
            }
          });
        });
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
    $('scrim').addEventListener('click', () => {
      if (overlays.some((o) => o.kind === 'sheet')) requestCloseOverlay('sheet');
      else requestCloseOverlay('drawer');
    });

    const searchInput = $('searchInput');
    searchInput.addEventListener('input', () => {
      state.query = searchInput.value;
      $('btnClearSearch').hidden = searchInput.value.length === 0;
      renderChips();
      renderList();
    });
    $('btnClearSearch').addEventListener('click', () => {
      searchInput.value = '';
      state.query = '';
      $('btnClearSearch').hidden = true;
      renderChips();
      renderList();
      searchInput.focus();
    });

    $('btnCloseSheet').addEventListener('click', () => closeSheet());
    $('btnCancelSheet').addEventListener('click', () => closeSheet());
    $('placeForm').addEventListener('submit', submitForm);
    $('placeName').addEventListener('input', () => { if ($('placeName').value.trim()) $('nameError').hidden = true; });
    $('btnNewCategory').addEventListener('click', () => openNewCategoryModal());
    $('btnDeletePlace').addEventListener('click', () => {
      const place = getPlace(state.editingId);
      if (place) confirmDelete(place, true);
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

    $('btnExport').addEventListener('click', exportBackup);
    $('btnImport').addEventListener('click', () => $('importFile').click());
    $('importFile').addEventListener('change', (event) => {
      const file = event.target.files && event.target.files[0];
      if (file) importBackupFile(file);
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
    initMap();
    bindUI();
    renderAll();
    showInstallButton();
    setupInstall();
    setupConnectivity();
    registerServiceWorker();
    handleUrlActions();
    maybeShowWelcome();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
