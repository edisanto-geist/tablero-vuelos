// Intermediario (proxy) del tablero de vuelos en Cloudflare Workers.
// Hace lo mismo que termux/proxy.py pero en la nube: el navegador del celu no puede leer directo las APIs de
// vuelos (no mandan CORS), así que este Worker las pide y devuelve la respuesta con CORS abierto.
//
// Rutas:  GET /api/<servicio>/<resto>?query   → <BASE del servicio><resto>?query
//         GET /api/salud                      → {"ok":true}
// Solo acepta los servicios de BASES y pedidos desde los orígenes de ORIGENES (para no ser un proxy abierto).
// Credenciales opcionales (secrets del Worker): ADSBLOL_KEY, OPENSKY_CLIENT_ID, OPENSKY_CLIENT_SECRET.

const BASES = {
  airplaneslive: 'https://api.airplanes.live/v2/',
  adsbfi: 'https://opendata.adsb.fi/api/',
  adsblol: 'https://api.adsb.lol/',
  opensky: 'https://opensky-network.org/api/',
  adsbdb: 'https://api.adsbdb.com/v0/',
};

// Rutas permitidas por servicio (solo lo que usa el tablero).
const PERMITIDAS = {
  airplaneslive: /^point\/-?\d+(\.\d+)?\/-?\d+(\.\d+)?\/\d+(\.\d+)?$/,
  adsbfi: /^v3\/lat\/-?\d+(\.\d+)?\/lon\/-?\d+(\.\d+)?\/dist\/\d+(\.\d+)?$/,
  adsblol: /^v2\/(point\/-?\d+(\.\d+)?\/-?\d+(\.\d+)?\/\d+(\.\d+)?|lat\/-?\d+(\.\d+)?\/lon\/-?\d+(\.\d+)?\/dist\/\d+(\.\d+)?)$/,
  opensky: /^states\/all$/,
  adsbdb: /^(callsign\/[A-Za-z0-9]{2,10}|aircraft\/~?[A-Fa-f0-9]{6})$/,
};

const ORIGENES = [
  'https://edisanto-geist.github.io',
  'http://127.0.0.1:8080',
  'http://localhost:8080',
  'null', // file:// en el celu
];

// Cache en el borde: las posiciones cambian rápido; rutas y tipos casi nunca.
const CACHE_S = { airplaneslive: 5, adsbfi: 5, adsblol: 5, opensky: 5, adsbdb: 6 * 3600 };

const PASAR = ['Retry-After', 'X-Rate-Limit-Remaining', 'X-Rate-Limit-Retry-After-Seconds'];
const AUTH_OPENSKY = 'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token';

let tokenOpensky = null;
let tokenVence = 0;

function cors(origen) {
  return {
    'Access-Control-Allow-Origin': origen && ORIGENES.includes(origen) ? origen : ORIGENES[0],
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Expose-Headers': PASAR.join(', '),
    'Vary': 'Origin',
  };
}

function json(status, obj, origen, extra) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: Object.assign({ 'Content-Type': 'application/json' }, cors(origen), extra || {}),
  });
}

async function obtenerTokenOpensky(env, forzar) {
  if (!env.OPENSKY_CLIENT_ID || !env.OPENSKY_CLIENT_SECRET) return null;
  if (!forzar && tokenOpensky && Date.now() < tokenVence) return tokenOpensky;
  const r = await fetch(AUTH_OPENSKY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: env.OPENSKY_CLIENT_ID,
      client_secret: env.OPENSKY_CLIENT_SECRET,
    }),
  });
  if (!r.ok) return null;
  const j = await r.json();
  tokenOpensky = j.access_token;
  tokenVence = Date.now() + Math.max(60, (j.expires_in || 1800) - 60) * 1000;
  return tokenOpensky;
}

async function pedirUpstream(servicio, resto, query, env, reintento) {
  const url = BASES[servicio] + resto + (query ? '?' + query : '');
  const h = { 'User-Agent': 'tablero-vuelos/1.0 (uso personal)', Accept: 'application/json' };
  if (servicio === 'adsblol' && env.ADSBLOL_KEY) h['x-api-key'] = env.ADSBLOL_KEY;
  if (servicio === 'opensky') {
    const tk = await obtenerTokenOpensky(env, false);
    if (tk) h.Authorization = 'Bearer ' + tk;
  }
  const r = await fetch(url, { headers: h, cf: { cacheTtl: CACHE_S[servicio], cacheEverything: true } });
  if (r.status === 401 && servicio === 'opensky' && reintento && (await obtenerTokenOpensky(env, true))) {
    return pedirUpstream(servicio, resto, query, env, false);
  }
  return r;
}

export default {
  async fetch(request, env) {
    const origen = request.headers.get('Origin');
    const u = new URL(request.url);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origen) });
    if (request.method !== 'GET') return json(405, { error: 'solo GET' }, origen);
    if (origen && !ORIGENES.includes(origen)) return json(403, { error: 'origen no permitido' }, origen);

    if (u.pathname === '/api/salud') return json(200, { ok: true, nube: true }, origen);
    if (!u.pathname.startsWith('/api/')) return json(404, { error: 'ruta desconocida' }, origen);

    const resto = u.pathname.slice(5);
    const corte = resto.indexOf('/');
    const servicio = corte < 0 ? resto : resto.slice(0, corte);
    const ruta = corte < 0 ? '' : resto.slice(corte + 1);
    if (!BASES[servicio]) return json(404, { error: 'servicio desconocido' }, origen);
    if (!PERMITIDAS[servicio].test(ruta)) return json(400, { error: 'ruta no permitida' }, origen);

    let r;
    try {
      r = await pedirUpstream(servicio, ruta, u.search.slice(1), env, true);
    } catch (e) {
      return json(502, { error: String((e && e.message) || e) }, origen);
    }
    const extra = {};
    PASAR.forEach((k) => { const v = r.headers.get(k); if (v !== null) extra[k] = v; });
    return new Response(r.body, {
      status: r.status,
      headers: Object.assign({ 'Content-Type': r.headers.get('Content-Type') || 'application/json' }, cors(origen), extra),
    });
  },
};
