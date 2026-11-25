// Proveedores formato readsb / ADSBx v2: airplanes.live, adsb.fi, adsb.lol.
(function (raiz) {
  var Geo = raiz.Geo;
  if (typeof require === 'function' && typeof module === 'object') {
    if (!Geo) Geo = require('../geo.js');
  }

  function num(v) { return (typeof v === 'number' && isFinite(v)) ? v : null; }
  function mult(v, k) { return v === null ? null : v * k; }
  function limpiar(s) { return (typeof s === 'string') ? s.trim() : ''; }

  var Readsb = {
    RUTAS: {
      airplaneslive: 'point/{lat}/{lon}/{nm}',
      adsbfi: 'v3/lat/{lat}/lon/{lon}/dist/{nm}',
      adsblol: 'v2/point/{lat}/{lon}/{nm}'
    },
    millasNauticas: function (radioKm) { return Math.min(250, Math.ceil(radioKm / 1.852) + 2); },
    parsear: function (json, ahoraMs, config) {
      if (!json || typeof json !== 'object') return null;
      var lista = json.ac || json.aircraft;
      if (!Array.isArray(lista)) return [];
      var nowMs = ahoraMs;
      if (typeof json.now === 'number' && isFinite(json.now)) nowMs = json.now < 1e12 ? json.now * 1000 : json.now;
      var maxEdad = config && typeof config.MAX_EDAD_POSICION_S === 'number' ? config.MAX_EDAD_POSICION_S : 60;
      var out = [];
      for (var i = 0; i < lista.length; i++) {
        var a = lista[i];
        if (!a || typeof a !== 'object') continue;
        var seen = num(a.seen_pos);
        if (seen !== null && seen > maxEdad) continue;
        // readsb rellena con '@' los caracteres de callsign que no recibió (ej. '@@@@@@@@'): se descartan
        var cs = limpiar(a.flight).toUpperCase().replace(/[^A-Z0-9]/g, '');
        var mat = limpiar(a.r);
        var tipo = limpiar(a.t).toUpperCase();
        var enTierra = false, alt;
        if (a.alt_baro === 'ground') { enTierra = true; alt = 0; }
        else {
          alt = mult(num(a.alt_baro), 0.3048);
          if (alt === null) alt = mult(num(a.alt_geom), 0.3048);
        }
        var rumbo = num(a.track);
        if (rumbo === null) rumbo = num(a.true_heading);
        var vv = num(a.baro_rate);
        if (vv === null) vv = num(a.geom_rate);
        out.push({
          icao24: String(a.hex).toLowerCase(),
          callsign: cs || null, matricula: mat || null, tipo: tipo || null,
          lat: num(a.lat), lon: num(a.lon),
          altitudBaroM: alt, enTierra: enTierra,
          velocidadMs: mult(num(a.gs), 0.514444),
          rumboDeg: rumbo,
          velVerticalMs: mult(vv, 0.00508),
          tsPosicion: nowMs - (seen || 0) * 1000,
          origen: null, destino: null
        });
      }
      return out;
    },
    crear: function (nombre, red, config) {
      var p = {
        nombre: nombre,
        info: {},
        obtenerEstados: function (ahoraMs) {
          var nm = Readsb.millasNauticas(config.RADIO_KM);
          var ruta = Readsb.RUTAS[nombre]
            .replace('{lat}', config.LAT.toFixed(4)).replace('{lon}', config.LON.toFixed(4)).replace('{nm}', String(nm));
          var url = red.url(nombre, ruta);
          var headers = {};
          if (nombre === 'adsblol' && !red.proxyBase() && config.ADSBLOL_KEY) headers['x-api-key'] = config.ADSBLOL_KEY;
          return red.pedirJSON({ url: url, headers: headers }).then(function (resp) {
            p.info = { status: resp.status, ms: resp.ms, crudos: 0, restante: null, url: url, error: resp.error };
            if (!resp.ok) {
              var tipo = resp.status === 429 ? '429' : (resp.error || 'http');
              throw { tipo: tipo, status: resp.status,
                retryAfterS: resp.status === 429 ? (parseInt(resp.header('retry-after'), 10) || null) : null };
            }
            var est = Readsb.parsear(resp.json, ahoraMs, config);
            if (est === null) { p.info.error = 'json'; throw { tipo: 'json', status: resp.status, retryAfterS: null }; }
            p.info.crudos = est.length;
            return est;
          });
        }
      };
      return p;
    }
  };

  raiz.Readsb = Readsb;
  raiz.Proveedores = raiz.Proveedores || {};
  if (raiz.Red && raiz.CONFIG && typeof window !== 'undefined') {
    ['airplaneslive', 'adsbfi', 'adsblol'].forEach(function (n) {
      raiz.Proveedores[n] = Readsb.crear(n, raiz.Red, raiz.CONFIG);
    });
  }
  if (typeof module === 'object' && module.exports) module.exports = Readsb;
})(typeof window !== 'undefined' ? window : globalThis);
