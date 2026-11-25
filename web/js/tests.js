// Tests de la lógica pura. Se usan tanto desde node (scripts/test_logica.js) como desde web/test.html.
(function (raiz) {
  function correr(Geo, Aerolineas, Datos, Formato, CONFIG) {
    var res = [];
    function t(nombre, fn) {
      try { fn(); res.push({ nombre: nombre, ok: true }); }
      catch (e) { res.push({ nombre: nombre, ok: false, error: String(e && e.message || e) }); }
    }
    function ok(c, m) { if (!c) throw new Error(m || 'falló'); }
    function cerca(a, b, tol, m) {
      if (!(Math.abs(a - b) <= tol)) throw new Error((m || 'valor') + ': ' + a + ' no está en ' + b + ' ± ' + tol);
    }
    var cfg = JSON.parse(JSON.stringify(CONFIG));
    var LAT = cfg.LAT, LON = cfg.LON;

    t('distancia Ibarlucea-ROS', function () {
      cerca(Geo.distanciaKm(LAT, LON, -32.9036, -60.7850), 5.95, 0.1, 'distancia');
    });
    t('rumbo Ibarlucea-ROS = 181 y cardinal SUR', function () {
      var r = Geo.rumboDeg(LAT, LON, -32.9036, -60.7850);
      cerca(r, 181, 2, 'rumbo'); ok(Geo.cardinal(r) === 'SUR', 'cardinal');
    });
    t('destino ida y vuelta (73° 25 km y -10 km)', function () {
      [25, -10].forEach(function (km) {
        var p = Geo.destino(LAT, LON, 73, km);
        cerca(Geo.distanciaKm(LAT, LON, p.lat, p.lon), Math.abs(km), 0.01, 'dist ' + km);
        var b = Geo.rumboDeg(LAT, LON, p.lat, p.lon);
        cerca(b, km > 0 ? 73 : 253, 0.3, 'rumbo ' + km);
      });
    });
    t('cardinal', function () {
      var c = [[0, 'NORTE'], [22.4, 'NORTE'], [22.6, 'NORESTE'], [180, 'SUR'], [225, 'SUROESTE'],
        [270, 'OESTE'], [359, 'NORTE']];
      c.forEach(function (p) { ok(Geo.cardinal(p[0]) === p[1], p[0] + ' -> ' + Geo.cardinal(p[0])); });
    });
    t('aproximacion: de frente', function () {
      var p = Geo.destino(LAT, LON, 0, 20);
      var a = Geo.aproximacion(LAT, LON, p.lat, p.lon, 180, 600);
      ok(a.seAcerca, 'seAcerca'); cerca(a.minutos, 2.0, 0.05, 'min'); cerca(a.distMinKm, 0, 0.1, 'distMin');
    });
    t('aproximacion: se aleja', function () {
      var p = Geo.destino(LAT, LON, 0, 20);
      ok(!Geo.aproximacion(LAT, LON, p.lat, p.lon, 0, 600).seAcerca, 'no debería acercarse');
    });
    t('aproximacion: al costado', function () {
      var d = 10 * Math.SQRT2;
      var p = Geo.destino(LAT, LON, 225, d);
      var a = Geo.aproximacion(LAT, LON, p.lat, p.lon, 0, 600);
      cerca(a.minutos, 1.0, 0.05, 'min'); cerca(a.distMinKm, 10, 0.1, 'distMin');
    });
    t('aproximacion: lento -> minutos null', function () {
      var p = Geo.destino(LAT, LON, 0, 20);
      var a = Geo.aproximacion(LAT, LON, p.lat, p.lon, 180, 10);
      ok(a.minutos === null && !a.seAcerca, 'null');
    });
    t('boundingBox contiene el radio', function () {
      var b = Geo.boundingBox(LAT, LON, 30);
      cerca((b.lamax - b.lamin) / 2 * 111.195, 30, 0.1, 'alto');
      ok(b.lomin < LON && b.lomax > LON, 'lon');
    });
    t('normalizar ARG01541 -> AR 1541', function () {
      var v = Datos.normalizar({ icao24: 'E06541', callsign: 'ARG01541 ', lat: LAT, lon: LON }, cfg, 0);
      ok(v.vuelo === 'AR 1541', v.vuelo); ok(v.aerolinea && v.aerolinea.icao === 'ARG', 'aerolinea');
      ok(v.id === 'e06541', 'id');
    });
    t('normalizar LVFVZ -> sin aerolinea', function () {
      var v = Datos.normalizar({ icao24: 'x', callsign: 'LVFVZ', lat: LAT, lon: LON }, cfg, 0);
      ok(v.aerolinea === null && v.vuelo === 'LVFVZ', v.vuelo);
    });
    t('procesar filtra y ordena', function () {
      var cerca10 = Geo.destino(LAT, LON, 90, 10), cerca20 = Geo.destino(LAT, LON, 90, 20);
      var lejos = Geo.destino(LAT, LON, 90, 40);
      var lista = Datos.procesar([
        { icao24: 'a', callsign: 'ARG1', lat: cerca20.lat, lon: cerca20.lon },
        { icao24: 'b', callsign: 'ARG2', lat: lejos.lat, lon: lejos.lon },
        { icao24: 'c', callsign: 'ARG3', lat: cerca10.lat, lon: cerca10.lon },
        { icao24: 'd', callsign: 'ARG4', lat: cerca10.lat, lon: cerca10.lon, enTierra: true },
        { icao24: 'e', callsign: 'ARG5', lat: null, lon: null }
      ], cfg, 0);
      ok(lista.length === 2, 'largo ' + lista.length);
      ok(lista[0].id === 'c' && lista[1].id === 'a', 'orden');
      cfg.INCLUIR_EN_TIERRA = true;
      var l2 = Datos.procesar([{ icao24: 'd', callsign: 'X', lat: cerca10.lat, lon: cerca10.lon, enTierra: true }], cfg, 0);
      cfg.INCLUIR_EN_TIERRA = false;
      ok(l2.length === 1, 'en tierra incluido');
    });
    t('Formato.fila anchos exactos (con y sin nulls)', function () {
      var w = Formato.ancho;
      var p = Geo.destino(LAT, LON, 200, 12);
      var crudos = [
        { icao24: 'a', callsign: 'ARG1541', lat: p.lat, lon: p.lon, altitudBaroM: 10712, velocidadMs: 230,
          rumboDeg: 20, tipo: 'B738', origen: 'AEP', destino: 'COR' },
        { icao24: 'b', callsign: 'LVFVZ', lat: p.lat, lon: p.lon },
        { icao24: 'c', callsign: 'ARG9', lat: LAT, lon: LON, altitudBaroM: 1000 }
      ];
      crudos.forEach(function (c) {
        var f = Formato.fila(Datos.normalizar(c, cfg, 0), cfg);
        Object.keys(w).forEach(function (k) {
          ok(f[k].length === w[k], k + ' mide ' + f[k].length + ' y debía ' + w[k] + ': "' + f[k] + '"');
        });
      });
      var f1 = Formato.fila(Datos.normalizar(crudos[1], cfg, 0), cfg);
      ok(f1.ruta === '---→---', 'ruta nula'); ok(f1.tipo === '----', 'tipo nulo');
      ok(f1.aerolinea.trim() === '---' && f1.altitud.trim() === '---', 'nulos');
      var f0 = Formato.fila(Datos.normalizar(crudos[0], cfg, 0), cfg);
      ok(f0.altitud.trim() === '10.700 M', 'altitud ' + f0.altitud);
      ok(f0.direccion.trim() === 'AL SUR · 12 KM' || /^AL SUR/.test(f0.direccion), 'direccion ' + f0.direccion);
    });
    t('Formato estados', function () {
      var base = { icao24: 'a', callsign: 'ARG1', lat: LAT, lon: LON };
      var ros = Geo.destino(LAT, LON, 180, 9);
      var e = function (extra) {
        var c = { icao24: 'a', callsign: 'ARG1', lat: ros.lat, lon: ros.lon, velocidadMs: 80, rumboDeg: 0 };
        for (var k in extra) c[k] = extra[k];
        return Formato.fila(Datos.normalizar(c, cfg, 0), cfg).estado.trim();
      };
      ok(Formato.fila(Datos.normalizar(base, cfg, 0), cfg).estado.trim() === 'ENCIMA', 'encima');
      ok(e({ destino: 'ROS', velVerticalMs: -4 }) === 'ATERRIZA ROS', 'aterriza');
      ok(e({ origen: 'ROS', velVerticalMs: 8, altitudBaroM: 1500 }) === 'DESPEGA ROS', 'despega');
      ok(/^ACERCA/.test(e({})), 'acerca ' + e({}));
      ok(e({ rumboDeg: 180 }) === 'SE ALEJA', 'aleja');
    });
    return res;
  }
  var API = { correr: correr };
  raiz.TestsLogica = API;
  if (typeof module === 'object' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
