// Proveedor OpenSky Network (/states/all). Último fallback: cupo chico de créditos.
(function (raiz) {
  var Geo = raiz.Geo;
  if (typeof require === 'function' && typeof module === 'object') {
    if (!Geo) Geo = require('../geo.js');
  }

  function num(v) { return (typeof v === 'number' && isFinite(v)) ? v : null; }

  var OpenSky = {
    parsear: function (json, ahoraMs, config) {
      if (!json || typeof json !== 'object') return null;
      if (!Array.isArray(json.states)) return [];
      var t = num(json.time);
      if (t === null) t = ahoraMs / 1000;
      var maxEdad = config && typeof config.MAX_EDAD_POSICION_S === 'number' ? config.MAX_EDAD_POSICION_S : 60;
      var out = [];
      for (var i = 0; i < json.states.length; i++) {
        var s = json.states[i];
        if (!Array.isArray(s)) continue;
        var tp = num(s[3]);
        if (tp === null) tp = num(s[4]);
        if (tp !== null && t - tp > maxEdad) continue;
        var alt = num(s[7]);
        if (alt === null) alt = num(s[13]);
        var cs = typeof s[1] === 'string' ? s[1].trim() : '';
        out.push({
          icao24: String(s[0]).toLowerCase(),
          callsign: cs || null, matricula: null, tipo: null,
          lat: num(s[6]), lon: num(s[5]),
          altitudBaroM: alt, enTierra: !!s[8],
          velocidadMs: num(s[9]), rumboDeg: num(s[10]), velVerticalMs: num(s[11]),
          tsPosicion: tp === null ? ahoraMs : tp * 1000,
          origen: null, destino: null
        });
      }
      return out;
    },
    crear: function (red, config) {
      var token = null, tokenVenceMs = 0, noReintentarTokenHasta = 0;

      function obtenerToken(ahoraMs) {
        if (red.proxyBase() || !config.OPENSKY_CLIENT_ID || !config.OPENSKY_CLIENT_SECRET) return Promise.resolve(null);
        if (token && ahoraMs < tokenVenceMs) return Promise.resolve(token);
        if (ahoraMs < noReintentarTokenHasta) return Promise.resolve(null);
        var cuerpo = 'grant_type=client_credentials&client_id=' + encodeURIComponent(config.OPENSKY_CLIENT_ID) +
          '&client_secret=' + encodeURIComponent(config.OPENSKY_CLIENT_SECRET);
        return red.pedirJSON({ url: red.BASES.openskyauth, metodo: 'POST', cuerpo: cuerpo,
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }).then(function (r) {
          if (r.ok && r.json && r.json.access_token) {
            token = r.json.access_token;
            tokenVenceMs = ahoraMs + ((num(r.json.expires_in) || 1800) - 60) * 1000;
            return token;
          }
          noReintentarTokenHasta = ahoraMs + 600000;
          return null;
        });
      }

      var p = {
        nombre: 'opensky',
        info: {},
        obtenerEstados: function (ahoraMs) {
          var b = Geo.boundingBox(config.LAT, config.LON, config.RADIO_KM);
          var ruta = 'states/all?lamin=' + b.lamin.toFixed(4) + '&lomin=' + b.lomin.toFixed(4) +
            '&lamax=' + b.lamax.toFixed(4) + '&lomax=' + b.lomax.toFixed(4);
          var url = red.url('opensky', ruta);
          var quiereToken = !red.proxyBase() && config.OPENSKY_CLIENT_ID && config.OPENSKY_CLIENT_SECRET;
          return obtenerToken(ahoraMs).then(function (tk) {
            var headers = {};
            if (tk) headers.Authorization = 'Bearer ' + tk;
            return red.pedirJSON({ url: url, headers: headers }).then(function (resp) {
              p.info = { status: resp.status, ms: resp.ms, crudos: 0, restante: null, url: url, error: resp.error,
                auth: tk ? 'oauth' : (quiereToken ? 'anonimo (token falló)' : 'anonimo') };
              p.info.restante = parseInt(resp.header('x-rate-limit-remaining'), 10) || null;
              if (resp.status === 401) token = null;
              if (!resp.ok) {
                var tipo = resp.status === 429 ? '429' : (resp.error || 'http');
                throw { tipo: tipo, status: resp.status,
                  retryAfterS: resp.status === 429 ? (parseInt(resp.header('x-rate-limit-retry-after-seconds'), 10) || null) : null };
              }
              var est = OpenSky.parsear(resp.json, ahoraMs, config);
              if (est === null) { p.info.error = 'json'; throw { tipo: 'json', status: resp.status, retryAfterS: null }; }
              p.info.crudos = est.length;
              return est;
            });
          });
        }
      };
      return p;
    }
  };

  raiz.OpenSky = OpenSky;
  raiz.Proveedores = raiz.Proveedores || {};
  if (raiz.Red && raiz.CONFIG && typeof window !== 'undefined') raiz.Proveedores.opensky = OpenSky.crear(raiz.Red, raiz.CONFIG);
  if (typeof module === 'object' && module.exports) module.exports = OpenSky;
})(typeof window !== 'undefined' ? window : globalThis);
