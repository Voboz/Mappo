# Informativa privacy di Mappo

**Ultimo aggiornamento:** novembre 2026 · versione app 1.6.8

Mappo è una web app (PWA) per salvare luoghi personali. Non ha account, non ha un backend e non prevede alcun tracciamento pubblicitario. Questa pagina spiega quali dati restano sul dispositivo, quali escono e verso quali servizi.

## 1. In breve

- I luoghi che salvi restano nel browser del tuo dispositivo. **Non vengono inviati all'autore.**
- Non ci sono cookie, analytics, pubblicità, profilazione o account.
- Escono dal dispositivo solo le richieste tecniche necessarie a mostrare la mappa, trovare un indirizzo o risolvere un link breve di Google.
- Puoi esportare, correggere e cancellare i tuoi dati in qualsiasi momento.

## 2. Titolare del trattamento e contatti

Il progetto non ha un server che raccoglie dati degli utenti: l'autore (Voboz) non riceve né conserva i luoghi, le note o le posizioni inserite nell'app.

- Repository e contatti: <https://github.com/Voboz/Mappo> (issue pubbliche)
- Se pubblichi una tua istanza dell'app o del Worker, il titolare del trattamento per quella istanza sei tu.
- Nota su hosting condiviso: su origini come `*.github.io` tutte le app dello stesso account condividono l'origine, quindi anche il localStorage. Per dati sensibili usa un dominio dedicato.

## 3. Dati salvati sul dispositivo

Mappo usa la memoria locale del browser (`localStorage`) e la cache del service worker. Non usa database remoti.

| Dato | Dove | Contenuto |
| --- | --- | --- |
| Luoghi | memoria locale del browser | nome, coordinate, indirizzo, nota, categoria, preferito, stato |
| Categorie personalizzate | memoria locale del browser | nome, colore, icona |
| Impostazioni | memoria locale del browser | ultima categoria usata, posizione e zoom della mappa, avviso di benvenuto |
| Cache offline | Cache Storage del browser | interfaccia e tessere di mappa già visitate |

Questi dati restano sul dispositivo finché non li cancelli. Non sono cifrati: chi ha accesso al dispositivo o al profilo del browser può leggerli. Se un dato è danneggiato, Mappo salva una copia di sicurezza locale; «Cancella tutti» rimuove anche queste copie.

## 4. Dati che escono dal dispositivo

Le richieste avvengono solo quando usi la funzione corrispondente.

| Servizio | Quando | Dati inviati | Fornitore |
| --- | --- | --- | --- |
| **OpenFreeMap** (`tiles.openfreemap.org`) | sempre, per disegnare la mappa | indirizzo IP, user agent, zona visualizzata (tessere richieste) | OpenFreeMap / OpenStreetMap |
| **Nominatim** (`nominatim.openstreetmap.org`) | quando apri il modulo di aggiunta su un punto della mappa, cerchi un nome o importi un CSV senza coordinate | coordinate, testo dell'indirizzo o nome del luogo, IP, user agent | OpenStreetMap Foundation |
| **Worker Mappo** (`mappo-link.mappo.workers.dev`) | solo se incolli un link breve Google, lo ricevi tramite Condividi o importi un file che lo contiene | il link breve, IP | Cloudflare (istanza del progetto) |

Note:

- I **link completi** di Google Maps e le coordinate vengono elaborati solo nel browser: non vengono inviati a servizi di risoluzione.
- I servizi pubblici di risoluzione (`r.jina.ai`, `api.allorigins.win`) **non sono più usati**: l'app usa solo il Worker incluso nel progetto. Se disattivi l'endpoint, i link brevi non vengono più risolti.
- La ricerca Nominatim invia il testo che digiti (per esempio un indirizzo) e la geocodifica inversa invia le coordinate del punto scelto (anche quando apri il modulo di aggiunta su un punto della mappa).
- Se l'app è pubblicata su GitHub Pages, Netlify o un altro hosting, il fornitore tratta i log tecnici delle richieste (IP, user agent, data e ora) per erogare e proteggere il servizio, secondo la propria informativa.

### Trasferimenti fuori dall'UE

Alcuni fornitori possono avere sede o infrastrutture fuori dall'Unione europea (per esempio Cloudflare, negli Stati Uniti). In quel caso il trasferimento avviene secondo le garanzie previste dai fornitori (clausole contrattuali standard e/o Data Privacy Framework). Se usi il Worker incluso nel progetto, il trattamento resta nella tua istanza Cloudflare: verifica la regione configurata nel tuo account.

## 5. Posizione

La posizione precisa viene richiesta solo quando tocchi **Posizione attuale** o **Vicino a me**, tramite il prompt del browser. Le coordinate:

- restano sul dispositivo;
- vengono salvate solo se decidi di salvare il luogo;
- possono essere usate per mostrare le distanze nell'elenco.

Puoi negare il permesso: l'app resta utilizzabile e puoi scegliere il punto sulla mappa.

## 6. Condivisione

- I file esportati e i link condivisi **non sono cifrati**: chi li riceve può leggerli.
- Il token dei link condivisi sta nel frammento (`#`) dell'URL, quindi non viene inviato al server che ospita l'app; resta però visibile nell'app di messaggistica o nel servizio con cui condividi il link.
- La ricezione da altre app (share target) usa i dati che l'app di origine mette a disposizione: titolo, testo e URL condivisi. Questi dati arrivano all'app nell'URL di avvio, che viene ripulito subito dopo l'elaborazione; possono comunque comparire nei log del fornitore di hosting.

## 7. Basi giuridiche

- **Posizione:** consenso, espresso con il prompt del browser (art. 6(1)(a) GDPR).
- **Mappa, ricerca indirizzi, risoluzione link brevi:** esecuzione del servizio richiesto (art. 6(1)(b)) e legittimo interesse a far funzionare le funzioni scelte dall'utente (art. 6(1)(f)).
- **Memoria locale tecnica:** non richiede consenso, perché è necessaria a erogare il servizio richiesto (art. 5(3) ePrivacy). Per questo Mappo non mostra un banner cookie.

## 8. Conservazione

- Dati locali: fino alla cancellazione da parte tua (o alla cancellazione dei dati del sito).
- Cache: gestita dal browser e dal service worker, con limiti automatici.
- Servizi terzi: secondo le informative dei rispettivi fornitori. Il Worker non conserva i link; Cloudflare può registrare metadati tecnici secondo la propria informativa.

## 9. I tuoi diritti

Hai diritto di accesso, rettifica, cancellazione, limitazione, opposizione e portabilità (artt. 15-20 GDPR), oltre a reclamo al Garante per la protezione dei dati personali (<https://www.garanteprivacy.it>).

In pratica:

- **Accesso e portabilità:** menu ☰ → **Esporta** (JSON, GeoJSON, KML, GPX, CSV).
- **Rettifica:** apri il luogo → **Modifica**.
- **Cancellazione:** **Info → Cancella tutti** rimuove i luoghi e le copie di sicurezza dei dati danneggiati; per rimuovere anche categorie, impostazioni e cache cancella i dati del sito dalle impostazioni del browser.
- Poiché l'autore non riceve i dati, non c'è nulla da richiedere a lui; per i trattamenti dei servizi terzi rivolgiti ai fornitori.

## 10. Cookie e tracciamento

Mappo non imposta cookie, non usa analytics, pixel, fingerprinting o pubblicità. Le uniche memorizzazioni sono quelle tecniche descritte sopra. Non ci sono processi decisionali automatizzati né profilazione.

## 11. Sicurezza

- L'app è servita in HTTPS quando pubblicata su un hosting adeguato.
- La Content-Security-Policy limita script, connessioni e risorse a origini esplicite.
- Non ci sono segreti, chiavi API o credenziali nel codice.
- I dati locali non sono cifrati: proteggi il dispositivo con blocco schermo e non condividere link contenenti luoghi riservati.

## 12. Minori

Mappo non è rivolta a minori e non raccoglie consapevolmente dati di minori. Non essendoci account né server dell'autore, non viene creato alcun profilo.

## 13. Modifiche

Questa informativa può essere aggiornata quando cambiano le funzioni o i servizi usati. La data in testa indica l'ultima revisione; la versione dell'app è visibile in **Info**.

## 14. Ambito

Questa informativa riguarda l'app Mappo e il Worker incluso nel repository. Il codice è distribuito con licenza PolyForm Noncommercial 1.0.0; le librerie di terze parti mantengono le proprie licenze.
