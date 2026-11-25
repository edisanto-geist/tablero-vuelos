// Normalización y filtrado de estados crudos de vuelos (formato tipo OpenSky).
(function (raiz) {
  var Geo = raiz.Geo, Aerolineas = raiz.Aerolineas;
  if (typeof require === 'function' && typeof module === 'object') {
    if (!Geo) Geo = require('./geo.js');
    if (!Aerolineas) Aerolineas = require('./aerolineas.js');
  }

  function num(v) { return (typeof v === 'number' && isFinite(v)) ? v : null; }

  var Datos = {
    normalizar: function (crudo, config, ahoraMs) {
      var lat = num(crudo.lat), lon = num(crudo.lon);
      var callsign = String(crudo.callsign || '').trim().toUpperCase();
      var m = /^([A-Z]{3})([0-9][A-Z0-9]*)$/.exec(callsign);
      var aerolinea = m ? Aerolineas.buscar(m[1]) : null;
      var vuelo = callsign;
      if (callsign === '') vuelo = crudo.matricula || String(crudo.icao24 || '').toUpperCase();
      if (aerolinea) {
        var numero = m[2].replace(/^0+(?=.)/, '');
        vuelo = aerolinea.iata + ' ' + numero;
      }
      var vel = num(crudo.velocidadMs);
      var velKmh = vel === null ? null : vel * 3.6;
      var rumbo = num(crudo.rumboDeg);
      var v = {
        id: String(crudo.icao24 || '').toLowerCase(),
        callsign: callsign, vuelo: vuelo, aerolinea: aerolinea, matricula: crudo.matricula || null,
        tipo: crudo.tipo || null, origen: crudo.origen || null, destino: crudo.destino || null,
        lat: lat, lon: lon,
        altitudM: num(crudo.altitudBaroM), velocidadKmh: velKmh, rumboDeg: rumbo,
        velVerticalMs: num(crudo.velVerticalMs), enTierra: !!crudo.enTierra,
        distanciaKm: null, marcacionDeg: null, cardinal: null, encima: false,
        seAcerca: false, minutosAlPaso: null, distanciaPasoKm: null,
        actualizadoMs: num(crudo.tsPosicion) !== null ? crudo.tsPosicion : ahoraMs
      };
      if (lat !== null && lon !== null) {
        v.distanciaKm = Geo.distanciaKm(config.LAT, config.LON, lat, lon);
        v.marcacionDeg = Geo.rumboDeg(config.LAT, config.LON, lat, lon);
        v.cardinal = Geo.cardinal(v.marcacionDeg);
        v.encima = v.distanciaKm < config.DIST_ENCIMA_KM;
        var ap = Geo.aproximacion(config.LAT, config.LON, lat, lon, rumbo, velKmh);
        v.seAcerca = ap.seAcerca;
        v.minutosAlPaso = ap.minutos;
        v.distanciaPasoKm = ap.distMinKm;
      }
      return v;
    },
    procesar: function (crudos, config, ahoraMs) {
      var out = [];
      for (var i = 0; i < (crudos || []).length; i++) {
        var v = Datos.normalizar(crudos[i], config, ahoraMs);
        if (v.lat === null || v.lon === null) continue;
        if (v.distanciaKm > config.RADIO_KM) continue;
        if (v.enTierra && !config.INCLUIR_EN_TIERRA) continue;
        out.push(v);
      }
      out.sort(function (a, b) { return a.distanciaKm - b.distanciaKm; });
      return out;
    }
  };
  raiz.Datos = Datos;
  if (typeof module === 'object' && module.exports) module.exports = Datos;
})(typeof window !== 'undefined' ? window : globalThis);
