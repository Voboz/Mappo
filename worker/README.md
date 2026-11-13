# Mappo — Worker per i link brevi

Piccola funzione [Cloudflare Workers](https://workers.cloudflare.com/) che risolve i link brevi di Google Maps (`maps.app.goo.gl`, `goo.gl/maps`, `g.co/maps`).

Un link breve non contiene le coordinate: le ha solo la pagina di destinazione, e il browser non può seguirne il redirect perché Google non invia header CORS. Il Worker fa la richiesta lato server e restituisce solo l'URL finale.

```
GET https://mappo-link.<tuo-sottodominio>.workers.dev/?url=https%3A%2F%2Fmaps.app.goo.gl%2Fxxxx
→ {"url":"https://www.google.com/maps/place/..."}
```

## Perché usarlo

L'istanza pubblica di Mappo lo usa già. È **facoltativo**: senza Worker i link brevi non vengono più risolti (l'app non contatta servizi pubblici). Con il Worker:

- il link breve passa solo dalla tua istanza Cloudflare;
- la risoluzione è più affidabile e senza i limiti dei servizi pubblici.

## Deploy dal pannello Cloudflare (senza installare nulla)

1. Crea un account gratuito su <https://dash.cloudflare.com/>.
2. **Workers & Pages → Create → Worker** (template "Hello World").
3. Apri l'editor, cancella il codice di esempio e incolla il contenuto di `link-resolver.js`.
4. **Deploy**. L'indirizzo sarà simile a `https://mappo-link.tuonome.workers.dev/`.
5. (Consigliato) **Settings → Variables → Add variable**: `ALLOWED_ORIGIN` con le origini dell'app separate da virgola, per esempio `https://voboz.github.io,http://localhost:8080`. Senza questa variabile il Worker accetta chiamate da qualsiasi sito.
6. Prova: apri nel browser
   `https://mappo-link.tuonome.workers.dev/?url=https%3A%2F%2Fmaps.app.goo.gl%2Fxxxx`
   e verifica che risponda con `{"url":"…"}`.

## Deploy da riga di comando

Serve Node.js con `npx`:

```bash
cd worker
npx wrangler deploy
```

`wrangler.toml` contiene già nome, entry point e variabile `ALLOWED_ORIGIN`.

## Attivarlo nell'app

L'istanza pubblica di Mappo è già collegata a `https://mappo-link.mappo.workers.dev/`. Per una tua istanza:

1. In `app.js` (circa riga 1650) sostituisci l'indirizzo:
   ```js
   const SHORT_LINK_ENDPOINT = 'https://mappo-link.tuonome.workers.dev/';
   ```
2. In `index.html`, sostituisci il dominio del Worker in `connect-src` nella Content-Security-Policy.
3. Fatto: se `SHORT_LINK_ENDPOINT` è impostato, l'app usa solo il Worker e non contatta più i servizi pubblici.

> Se provi l'app in locale (`http://localhost:8080`), aggiungi quell'origine ad `ALLOWED_ORIGIN`, altrimenti il browser blocca la chiamata per CORS. Esempio: `https://voboz.github.io,http://localhost:8080`.

## Note

- Il Worker accetta **solo** host Google e solo percorsi `/maps/`: non è un proxy aperto e non può essere usato per raggiungere altri siti (nessun rischio SSRF).
- Non usa cookie, non conserva i link e non legge il contenuto delle pagine: restituisce soltanto l'URL finale. Cloudflare può registrare metadati tecnici delle richieste secondo la propria informativa.
- Il piano gratuito Cloudflare Workers è più che sufficiente per un uso personale (100.000 richieste al giorno).
- Licenza del progetto: PolyForm Noncommercial 1.0.0, come il resto di Mappo.
