// Proveedor demo: aviones falsos que repiten un ciclo (CONFIG.DEMO.CICLO_S).
(function (raiz) {
  var ROS = { lat: -32.9036, lon: -60.7850 };
  var inicioMs = null;

  function anclaDe(a, cfg) {
    if (a === 'ROS') return ROS;
    return raiz.Geo.destino(cfg.LAT, cfg.LON, a.marcacionDeg, a.distKm);
  }

  var Demo = {
    nombre: 'demo',
    // Segundos (del ciclo) en que estamos ahora.
    tCiclo: function (ahoraMs) {
      var cfg = raiz.CONFIG, d = cfg.DEMO;
      if (inicioMs === null) inicioMs = ahoraMs;
      var t = (ahoraMs - inicioMs) / 1000 + (d.T_INICIAL_S || 0);
      return ((t % d.CICLO_S) + d.CICLO_S) % d.CICLO_S;
    },
    obtenerEstados: function (ahoraMs) {
      var cfg = raiz.CONFIG, d = cfg.DEMO;
      var tc = Demo.tCiclo(ahoraMs);
      var out = [];
      var esc = raiz.ESCENARIO_DEMO || [];
      for (var i = 0; i < esc.length; i++) {
        var e = esc[i];
        if (tc < e.apareceS || tc > e.desapareceS) continue;
        // dtSim está acelerado (x ACELERACION): los minutos de "ACERCA" quedan en tiempo simulado.
        var dtSim = (tc - e.tRefS) * d.ACELERACION;
        var p = raiz.Geo.destino(anclaDe(e.ancla, cfg).lat, anclaDe(e.ancla, cfg).lon,
          e.rumboDeg, e.velKmh / 3600 * dtSim);
        var alt = e.altRefM + e.vsMs * dtSim;
        var enTierra = false;
        if (alt <= 0) { alt = 0; enTierra = true; }
        out.push({
          icao24: e.icao24, callsign: e.callsign, lat: p.lat, lon: p.lon,
          altitudBaroM: alt, velocidadMs: e.velKmh / 3.6, rumboDeg: e.rumboDeg,
          velVerticalMs: e.vsMs, enTierra: enTierra, tsPosicion: ahoraMs,
          tipo: e.tipo, origen: e.origen, destino: e.destino
        });
      }
      return Promise.resolve(out);
    }
  };
  raiz.Proveedores = raiz.Proveedores || {};
  raiz.Proveedores.demo = Demo;
})(window);
