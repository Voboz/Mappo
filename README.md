# Luoghi del cuore

Web App installabile (PWA) per salvare i tuoi posti preferiti, vederli sulla mappa e ritrovarli in un attimo. Pensata per il telefono, funziona anche offline.

![Anteprima](icons/icon-512.png)

## Cosa sa fare

- **Salva i luoghi** con nome, categoria, nota e posizione (GPS, mappa o link Google Maps).
- **Mappa OpenStreetMap** con un pin colorato e icona per ogni categoria.
- **Menu laterale** con tutti i luoghi, filtri per categoria e conteggi.
- **Ricerca per nome** (cerca anche in note, indirizzo e categoria) con evidenziazione del risultato.
- **Navigazione** verso un luogo con **Waze** o **Google Maps**.
- **Posizione attuale** con indicatore preciso e distanze nella lista.
- **Categorie personalizzate** con colore e icona (oltre alle 8 predefinite).
- **Backup**: esporta/importa tutti i luoghi in un file JSON (unisci o sostituisci).
- **Installabile** sulla schermata Home e **offline** per l'interfaccia e le zone di mappa già visitate.
- **Dati solo sul telefono**: nessun account, nessun server, nessuna traccia.

## Avvio rapido sul PC

Serve Python 3 (già presente su questo PC).

```bat
avvia-server.bat
```

Oppure da terminale:

```bash
python -m http.server 8080
```

Poi apri <http://localhost:8080>.

> Nota: aprendo `index.html` con doppio clic l'app funziona, ma il service worker e l'installazione PWA richiedono `http://localhost` oppure HTTPS.

## Installarla sul Pocophone

Per installare una PWA Chrome richiede un indirizzo **HTTPS** (oppure `localhost`). Il modo più semplice è pubblicare la cartella su un hosting statico gratuito:

### Opzione A — GitHub Pages (consigliata)

1. Crea un account su [github.com](https://github.com) se non ce l'hai.
2. Crea un nuovo repository pubblico, ad esempio `luoghi-del-cuore`.
3. Carica **tutti i file di questa cartella** (trascina la cartella nella pagina di upload di GitHub).
4. Vai in **Settings → Pages**, in *Branch* scegli `main` e cartella `/root`, poi **Save**.
5. Dopo circa un minuto l'app sarà su `https://TUONOME.github.io/luoghi-del-cuore/`.
6. Apri quel link con **Chrome** sul Pocophone, tocca il menu **⋮ → Installa app** (o *Aggiungi a schermata Home*).

### Opzione B — Netlify Drop

1. Vai su <https://app.netlify.com/drop> e accedi (gratis).
2. Trascina la cartella del progetto nella pagina.
3. Apri il link `https://…netlify.app` sul telefono e installa da Chrome.

### Opzione C — solo per provare (senza installazione)

Avvia `avvia-server.bat` sul PC, collega telefono e PC alla stessa rete Wi-Fi e apri sul telefono:

```
http://IP_DEL_PC:8080
```

L'app funziona, ma senza HTTPS Chrome non permette l'installazione completa né la cache offline. Lo script mostra l'indirizzo IP corretto all'avvio.

## Guida d'uso

- **Aggiungere un luogo**: tocca il **+**, oppure **tieni premuto** su un punto della mappa.
- **Scegliere la posizione**: “Posizione attuale”, “Scegli sulla mappa” (sposta la mappa e conferma) o incolla un link Google Maps.
- **Ritrovare un luogo**: apri il menu ☰, cerca per nome o filtra per categoria, tocca il luogo per volare sulla mappa.
- **Navigare**: apri il pin → **Waze** o **Google Maps**.
- **Modificare/eliminare**: apri il pin → Modifica / Elimina (con annullamento).
- **Backup**: menu ☰ → **Esporta**. Per ripristinare: **Importa** e scegli “Unisci” o “Sostituisci”.

### Link Google Maps supportati

Sono riconosciuti i link completi (`google.com/maps/place/...`, `?q=lat,lng`, `@lat,lng`, `!3d…!4d…`), le coordinate `45.4642, 9.1900` e i link `geo:`. I link brevi `maps.app.goo.gl` non possono essere risolti nel browser: apri il link e copia l'indirizzo completo.

## Struttura del progetto

```
index.html               interfaccia
styles.css               stile e animazioni
app.js                   logica (mappa, dati, ricerca, backup)
manifest.webmanifest     manifest PWA
sw.js                    service worker (offline)
vendor/leaflet/          Leaflet 1.9.4 incluso in locale
icons/                   icone app
tools/make-icons.ps1     rigenera le icone
avvia-server.bat         server locale di prova
```

## Note tecniche

- **Mappe**: tessere OpenStreetMap con attribuzione. Per un uso intensivo o commerciale valuta un provider di tessere dedicato.
- **Dati**: `localStorage` del browser. Cancellando i dati del sito si perdono i luoghi: usa l'export.
- **Indirizzi**: geocodifica inversa tramite Nominatim (OpenStreetMap) solo quando serve, con richieste limitate a circa una al secondo.
- **Offline**: interfaccia e tessere già caricate restano disponibili; le zone mai visitate richiedono connessione.
- **Licenza Leaflet**: BSD-2-Clause, vedi `vendor/leaflet/LICENSE.txt`.

## Aggiornare l'app

Dopo aver modificato i file e ripubblicato, cambia `VERSION` in `sw.js` (es. da `v1.0.0` a `v1.0.1`): così i dispositivi scaricano la nuova versione e mostrano l'avviso “Nuova versione disponibile”.

---

Versione 1.0 · i luoghi restano salvati solo sul tuo dispositivo; mappa e indirizzi usano OpenStreetMap.
