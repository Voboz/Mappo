# Versioni delle librerie incluse

I file in `vendor/` sono serviti in locale (nessun CDN): l'app funziona
offline e la CSP resta `script-src 'self'`.

| Libreria | Versione | Licenza | File |
| --- | --- | --- | --- |
| Leaflet | 1.9.4 | BSD-2-Clause | `vendor/leaflet/` (`LICENSE.txt`) |
| MapLibre GL JS | 5.24.1 | BSD-3-Clause | `vendor/maplibre/maplibre-gl-csp.js`, `maplibre-gl-csp-worker.js`, `maplibre-gl.css` (`LICENSE.txt`) |
| @maplibre/maplibre-gl-leaflet | 0.1.4 | ISC | `vendor/maplibre/leaflet-maplibre-gl.js` (`LICENSE-plugin.txt`) |

## Aggiornare una libreria

1. Scarica la nuova versione e sostituisci i file in `vendor/`.
2. Aggiorna la versione in questa tabella.
3. Se cambia la versione di MapLibre, verifica il percorso del worker
   (`maplibregl.setWorkerUrl`) e la compatibilità con il plugin Leaflet.
4. Bumpa `VERSION` in `sw.js`: la cache del service worker si svuota e i
   dispositivi scaricano subito i file nuovi.
