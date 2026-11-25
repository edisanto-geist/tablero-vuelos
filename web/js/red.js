// Capa de red: URLs (directo o vía proxy de Termux), pedidos JSON que nunca rechazan y almacén local.
(function (raiz) {
  var cfg = null;
  var transporte = null;   // null = XHR

  var BASES = {
    airplaneslive: 'https://api.airplanes.live/v2/',
    adsbfi: 'https://opendata.adsb.fi/api/',
    adsblol: 'https://api.adsb.lol/',
    opensky: 'https://opensky-network.org/api/',
    adsbdb: 'https://api.adsbdb.com/v0/',
    aeroapi: 'https://aeroapi.flightaware.com/aeroapi/',
    openskyauth: 'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token'
  };

  function ahora() { return Date.now(); }

  function parsearHeaders(crudo) {
    var out = {};
    String(crudo || '').split(/\r?\n/).forEach(function (l) {
      var i = l.indexOf(':');
      if (i > 0) out[l.slice(0, i).trim().toLowerCase()] = l.slice(i + 1).trim();
    });
    return out;
  }

  function xhr(o) {
    return new Promise(function (resolve, reject) {
      var x = new XMLHttpRequest();
      var listo = false;
      function fin(f, v) { if (!listo) { listo = true; f(v); } }
      try {
        x.open(o.metodo, o.url, true);
        x.timeout = o.timeoutMs;
        var hs = o.headers || {};
        Object.keys(hs).forEach(function (k) { x.setRequestHeader(k, hs[k]); });
        x.onload = function () {
          fin(resolve, { status: x.status, texto: x.responseText, headers: parsearHeaders(x.getAllResponseHeaders()) });
        };
        x.onerror = function () { fin(reject, 'red'); };
        x.ontimeout = function () { fin(reject, 'timeout'); };
        x.onabort = function () { fin(reject, 'red'); };
        x.send(o.cuerpo === null || o.cuerpo === undefined ? null : o.cuerpo);
      } catch (e) { fin(reject, 'red'); }
    });
  }

  // Credenciales para el proxy local: viajan por header X-TV-* solo a 127.0.0.1 y nunca a la nube.
  function headersConCredenciales(url, base) {
    var hs = {};
    Object.keys(base || {}).forEach(function (k) { hs[k] = base[k]; });
    if (!cfg || !Red.esProxyLocal()) return hs;
    var m = /\/api\/(adsblol|opensky|aeroapi)\//.exec(String(url || ''));
    if (!m) return hs;
    function poner(nombre, valor) { if (valor && String(valor).trim() !== '') hs[nombre] = String(valor).trim(); }
    if (m[1] === 'adsblol') poner('X-TV-ADSBLOL-KEY', cfg.ADSBLOL_KEY);
    else if (m[1] === 'opensky') { poner('X-TV-OPENSKY-ID', cfg.OPENSKY_CLIENT_ID); poner('X-TV-OPENSKY-SECRET', cfg.OPENSKY_CLIENT_SECRET); }
    else poner('X-TV-AEROAPI-KEY', cfg.HORARIOS_KEY);
    return hs;
  }

  var Red = {
    BASES: BASES,
    configurar: function (c) { cfg = c; },
    proxyBase: function () {
      var p = cfg ? cfg.PROXY : '';
      if (p === 'auto') {
        if (typeof location !== 'undefined' && location && /^http/.test(location.protocol || '') &&
            (location.hostname === '127.0.0.1' || location.hostname === 'localhost')) return '/api/';
        // Publicado en GitHub Pages: las APIs de vuelos no mandan CORS, así que se pasa por el Worker de Cloudflare.
        if (typeof location !== 'undefined' && location && /\.github\.io$/.test(location.hostname || '') && cfg.PROXY_NUBE) {
          var n = String(cfg.PROXY_NUBE);
          return n.charAt(n.length - 1) === '/' ? n : n + '/';
        }
        return '';
      }
      if (!p) return '';
      p = String(p);
      return p.charAt(p.length - 1) === '/' ? p : p + '/';
    },
    // true si las consultas pasan por el proxy local (Termux / servidor de desarrollo), el único que puede recibir credenciales.
    esProxyLocal: function () {
      var b = Red.proxyBase();
      return b === '/api/' || /^http:\/\/(127\.0\.0\.1|localhost)([:\/]|$)/.test(b);
    },
    url: function (servicio, ruta) {
      var pb = Red.proxyBase();
      if (pb) return pb + servicio + '/' + ruta;
      return BASES[servicio] + ruta;
    },
    usarTransporte: function (fn) { transporte = fn || null; },
    pedirJSON: function (op) {
      op = op || {};
      var o = {
        url: op.url, metodo: op.metodo || 'GET', cuerpo: op.cuerpo === undefined ? null : op.cuerpo,
        headers: headersConCredenciales(op.url, op.headers),
        timeoutMs: op.timeoutMs || ((cfg && cfg.TIMEOUT_RED_S) || 8) * 1000
      };
      var t0 = ahora();
      function resp(status, error, json, headers) {
        var hs = headers || {};
        return {
          ok: status >= 200 && status < 300 && !error, status: status, error: error, json: json, ms: ahora() - t0,
          header: function (n) { var v = hs[String(n).toLowerCase()]; return v === undefined ? null : v; }
        };
      }
      var p;
      try { p = (transporte || xhr)(o); } catch (e) { p = Promise.reject('red'); }
      return Promise.resolve(p).then(function (r) {
        var st = r.status || 0;
        if (st === 0) return resp(0, 'red', null, r.headers);
        var json = null, malJson = false;
        try { json = JSON.parse(r.texto); } catch (e) { malJson = true; }
        var ok2xx = st >= 200 && st < 300;
        var error = !ok2xx ? 'http' : (malJson ? 'json' : null);
        return resp(st, error, malJson ? null : json, r.headers);
      }, function (motivo) {
        return resp(0, motivo === 'timeout' ? 'timeout' : 'red', null, null);
      });
    }
  };

  // Almacén: localStorage + JSON; si no hay, memoria.
  var memoria = {};
  Red.almacen = {
    persiste: function () {
      try { var k = 'tv.test'; localStorage.setItem(k, '1'); localStorage.removeItem(k); return true; } catch (e) { return false; }
    },
    leer: function (clave) {
      try {
        var s = localStorage.getItem(clave);
        if (s !== null && s !== undefined) return JSON.parse(s);
      } catch (e) {}
      return Object.prototype.hasOwnProperty.call(memoria, clave) ? memoria[clave] : null;
    },
    escribir: function (clave, obj) {
      memoria[clave] = obj;
      try { localStorage.setItem(clave, JSON.stringify(obj)); return true; } catch (e) { return false; }
    }
  };

  raiz.Red = Red;
  if (raiz.CONFIG) Red.configurar(raiz.CONFIG);
  if (typeof module === 'object' && module.exports) module.exports = Red;
})(typeof window !== 'undefined' ? window : globalThis);
