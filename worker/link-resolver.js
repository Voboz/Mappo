/* ============================================================
   Mappo — risolutore di link brevi Google Maps
   ------------------------------------------------------------
   Cloudflare Worker. Riceve:
     GET /?url=https://maps.app.goo.gl/xxxx
   legge il redirect di Google (senza scaricare la pagina finale)
   e restituisce l'indirizzo:
     {"url":"https://www.google.com/maps/..."}

   Perché serve: un link breve non contiene le coordinate e il
   browser non può seguirne il redirect (Google non manda header
   CORS). Il Worker lo fa lato server, dove il vincolo non esiste.

   Perché non si segue fino in fondo: la pagina finale di Maps
   risponde 429 alle richieste da datacenter. Basta leggere
   l'header Location della prima risposta 3xx.

   Sicurezza: accetta solo link brevi Google (niente proxy aperto,
   niente SSRF), segue solo redirect verso host Google e non legge
   il contenuto delle pagine.
   ============================================================ */

const ALLOWED_HOSTS = new Set(['maps.app.goo.gl', 'goo.gl', 'g.co']);
const MAX_TARGET_LENGTH = 2048;
const UPSTREAM_TIMEOUT = 8000;
const MAX_REDIRECTS = 4;
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/** Host verso cui è lecito seguire un redirect. */
function isGoogleHost(hostname) {
  const host = hostname.toLowerCase();
  // Il TLD deve essere un vero dominio pubblico (lettere, 2-24 caratteri),
  // mai un suffisso arbitrario come "google.com.evil.tld".
  if (host === 'goo.gl' || host === 'g.co') return true;
  const m = /(?:^|\.)google\.([a-z]{2,24}(?:\.[a-z]{2})?)$/.exec(host);
  if (!m) return false;
  const tld = m[1];
  // google.com, google.it, google.co.uk, google.com.au, google.co.jp, …
  return /^[a-z]{2,24}(?:\.[a-z]{2})?$/.test(tld);
}

/** Vero se l'URL è già una pagina di Google Maps con i dati del luogo. */
function isMapsUrl(url) {
  const host = url.hostname.toLowerCase();
  if (!isGoogleHost(host)) return false;
  if (host === 'maps.google.com' || host.startsWith('maps.google.')) return true;
  return /^\/maps(\/|$)/.test(url.pathname);
}

/**
 * Controlla che il parametro sia un link breve Google valido.
 * @param {string | null} raw
 * @returns {{ url: string } | { error: string }}
 */
export function checkTarget(raw) {
  const value = String(raw || '').trim();
  if (!value) return { error: 'missing_url' };
  if (value.length > MAX_TARGET_LENGTH) return { error: 'url_too_long' };

  let url;
  try {
    url = new URL(value);
  } catch (_) {
    return { error: 'invalid_url' };
  }

  if (url.protocol !== 'https:') return { error: 'invalid_protocol' };
  if (url.username || url.password) return { error: 'invalid_url' };

  const host = url.hostname.toLowerCase();
  if (!ALLOWED_HOSTS.has(host)) return { error: 'host_not_allowed' };
  // goo.gl e g.co ospitano anche altro: si accettano solo i percorsi /maps/.
  if (host !== 'maps.app.goo.gl' && !/^\/maps(\/|$)/i.test(url.pathname)) {
    return { error: 'not_a_maps_link' };
  }

  return { url: url.toString() };
}

/**
 * Sceglie l'origine da autorizzare. `ALLOWED_ORIGIN` può contenere più
 * origini separate da virgola (utile per provare in locale).
 * @param {Request} request
 * @param {{ ALLOWED_ORIGIN?: string }} [env]
 */
function pickOrigin(request, env) {
  const configured = String((env && env.ALLOWED_ORIGIN) || '*').trim();
  if (!configured || configured === '*') return '*';
  const allowed = configured.split(',').map((value) => value.trim()).filter(Boolean);
  const origin = request.headers.get('Origin') || '';
  // Se l'origine non è in elenco si risponde con la prima: il browser blocca.
  return allowed.includes(origin) ? origin : (allowed[0] || '*');
}

/**
 * Risposta JSON con gli header CORS necessari al browser.
 * @param {unknown} body
 * @param {number} status
 * @param {Record<string, string>} [extra]
 * @param {string} [allowedOrigin]
 */
function json(body, status, extra = {}, allowedOrigin = '*') {
  const headers = {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': allowedOrigin,
    'access-control-allow-methods': 'GET, OPTIONS',
    'access-control-allow-headers': 'Accept',
    'x-content-type-options': 'nosniff',
    ...extra,
  };
  if (allowedOrigin !== '*') headers.vary = 'Origin';
  return new Response(JSON.stringify(body), { status, headers });
}

export default {
  /**
   * @param {Request} request
   * @param {{ ALLOWED_ORIGIN?: string }} [env]
   */
  async fetch(request, env) {
    const allowedOrigin = pickOrigin(request, env);

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'access-control-allow-origin': allowedOrigin,
          'access-control-allow-methods': 'GET, OPTIONS',
          'access-control-allow-headers': 'Accept',
          'access-control-max-age': '86400',
        },
      });
    }
    if (request.method !== 'GET') {
      return json({ error: 'method_not_allowed' }, 405, {}, allowedOrigin);
    }

    const target = checkTarget(new URL(request.url).searchParams.get('url'));
    if ('error' in target) return json(target, 400, {}, allowedOrigin);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT);
    let current = target.url;
    try {
      for (let hop = 0; hop < MAX_REDIRECTS; hop++) {
        const res = await fetch(current, {
          redirect: 'manual',
          signal: controller.signal,
          headers: {
            accept: 'text/html,application/xhtml+xml',
            'accept-language': 'it-IT,it;q=0.9,en;q=0.8',
            'user-agent': BROWSER_UA,
          },
        });

        if (res.status < 300 || res.status >= 400) {
          return json({ error: 'upstream_status', status: res.status }, 502, {}, allowedOrigin);
        }

        const location = res.headers.get('location');
        if (!location) return json({ error: 'no_location' }, 502, {}, allowedOrigin);

        let next;
        try {
          next = new URL(location, current);
        } catch (_) {
          return json({ error: 'invalid_redirect' }, 502, {}, allowedOrigin);
        }
        if (next.protocol !== 'https:') {
          return json({ error: 'invalid_redirect' }, 502, {}, allowedOrigin);
        }
        if (!isGoogleHost(next.hostname)) {
          // Un goo.gl può puntare ovunque: non si segue fuori da Google.
          return json({ error: 'unexpected_redirect' }, 502, {}, allowedOrigin);
        }

        current = next.toString();
        if (isMapsUrl(next)) {
          // Il link breve punta sempre allo stesso luogo: si può memorizzare.
          return json({ url: current }, 200, { 'cache-control': 'private, max-age=86400' }, allowedOrigin);
        }
      }
      return json({ error: 'too_many_redirects' }, 502, {}, allowedOrigin);
    } catch (_) {
      return json({ error: 'upstream_unreachable' }, 502, {}, allowedOrigin);
    } finally {
      clearTimeout(timer);
    }
  },
};
