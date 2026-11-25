// Tests de la Fase 2 (datos reales). Exporta correr() -> Promise<[{nombre, ok, error}]>. Sin red real.
var path = require('path');
var base = path.join(__dirname, '..', 'web', 'js');
var RF = require('./red_falsa.js');

// config.js define window.CONFIG; en node lo cargamos con un window falso.
global.window = {};
var rutaConfig = path.join(base, 'config.js');
delete require.cache[require.resolve(rutaConfig)];   // puede estar cacheado por test_logica.js
require(rutaConfig);
var CONFIG = global.window.CONFIG;
delete global.window;

var Geo = require(path.join(base, 'geo.js'));
var Aerolineas = require(path.join(base, 'aerolineas.js'));
var Datos = require(path.join(base, 'datos.js'));
var Formato = require(path.join(base, 'formato.js'));
var Red = require(path.join(base, 'red.js'));
var Readsb = require(path.join(base, 'proveedores', 'readsb.js'));
var OpenSky = require(path.join(base, 'proveedores', 'opensky.js'));
var Fuentes = require(path.join(base, 'fuentes.js'));
var Enriquecer = require(path.join(base, 'enriquecer.js'));

var T0 = 1764079200000;   // "ahora" de los fixtures

function clonar(o) { return JSON.parse(JSON.stringify(o)); }
function ok(c, m) { if (!c) throw new Error(m || 'falló'); }
function cerca(a, b, tol, m) {
  if (!(Math.abs(a - b) <= tol)) throw new Error((m || 'valor') + ': ' + a + ' no está en ' + b + ' ± ' + tol);
}
function igual(a, b, m) {
  var x = JSON.stringify(a), y = JSON.stringify(b);
  if (x !== y) throw new Error((m || 'distinto') + ': ' + x + ' != ' + y);
}
function porId(arr, id) {
  for (var i = 0; i < arr.length; i++) if ((arr[i].icao24 || arr[i].id) === id) return arr[i];
  throw new Error('no está ' + id);
}
function esperarMs(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function rechazo(p) {   // resuelve con el motivo del rechazo; falla si resolvió
  return p.then(function () { throw new Error('debía rechazar'); }, function (e) { return e; });
}

function correr() {
  var res = [];
  var cola = Promise.resolve();
  function t(nombre, fn) {
    cola = cola.then(function () {
      var r;
      try { r = fn(); } catch (e) { res.push({ nombre: nombre, ok: false, error: String(e && e.message || e) }); return; }
      if (process.env.TV_DEBUG) process.stderr.write('> ' + nombre + '\n'); return Promise.resolve(r).then(function () { res.push({ nombre: nombre, ok: true }); },
        function (e) { res.push({ nombre: nombre, ok: false, error: String(e && e.message || e) }); });
    });
  }

  var cfg = clonar(CONFIG);
  cfg.PROXY = '';
  var silencio = console.log;

  // ---------------- Readsb.parsear ----------------
  var point = RF.leerJSON('readsb_point.json');
  var crudosPoint = null;
  t('Readsb.parsear(readsb_point): 10 estados, descarta posición vieja', function () {
    crudosPoint = Readsb.parsear(point, T0, cfg);
    ok(crudosPoint.length === 10, 'cantidad ' + crudosPoint.length);
    ok(!crudosPoint.some(function (c) { return c.icao24 === 'e0e5f6'; }), 'e0e5f6 no se descartó');
  });
  t('Readsb.parsear: e06541 (conversiones y campos)', function () {
    var c = porId(crudosPoint, 'e06541');
    cerca(c.altitudBaroM, 1066.8, 0.01, 'alt');
    cerca(c.velocidadMs, 82.31, 0.01, 'vel');
    cerca(c.velVerticalMs, -4.2266, 0.001, 'vv');
    ok(c.callsign === 'ARG1541', 'callsign'); ok(c.tipo === 'E190', 'tipo'); ok(c.matricula === 'LV-ABC', 'matrícula');
    ok(c.tsPosicion === T0 - 800, 'tsPosicion ' + c.tsPosicion);
    ok(c.origen === null && c.destino === null, 'origen/destino null');
  });
  t('Readsb.parsear: e0a1b2 en tierra', function () {
    var c = porId(crudosPoint, 'e0a1b2');
    ok(c.enTierra === true, 'enTierra'); ok(c.altitudBaroM === 0, 'alt 0');
  });
  t('Readsb.parsear: e0b9c8 solo alt_geom', function () { cerca(porId(crudosPoint, 'e0b9c8').altitudBaroM, 3657.6, 0.01); });
  t('Readsb.parsear: e0c3d4 sin flight, geom_rate, vuelo LV-GHI', function () {
    var c = porId(crudosPoint, 'e0c3d4');
    ok(c.callsign === null, 'callsign null');
    cerca(c.velVerticalMs, -1.30048, 0.0001, 'vv');
    ok(Datos.normalizar(c, cfg, T0).vuelo === 'LV-GHI', 'vuelo');
  });
  t('Readsb.parsear: ~2a1f00 conserva ~ y sin tipo', function () {
    var c = porId(crudosPoint, '~2a1f00');
    ok(c.icao24 === '~2a1f00', 'hex'); ok(c.tipo === null, 'tipo null');
  });
  t('Readsb.parsear: e0d4e5 sin posición', function () {
    var c = porId(crudosPoint, 'e0d4e5'); ok(c.lat === null && c.lon === null, 'lat/lon null');
  });
  t('Datos.procesar sobre readsb_point: 7 vuelos en orden', function () {
    var c = clonar(cfg); c.RADIO_KM = 30;
    var v = Datos.procesar(crudosPoint, c, T0);
    igual(v.map(function (x) { return x.id; }), ['e0c3d4', 'e0f1a7', 'e03420', 'e06541', 'e0b9c8', '~2a1f00', 'e48a21']);
    [5.24, 8.35, 11.01, 11.23, 19.14, 20.82, 22.81].forEach(function (d, i) { cerca(v[i].distanciaKm, d, 0.1, 'dist ' + v[i].id); });
    ok(v[0].cardinal === 'SURESTE', 'cardinal e0c3d4 ' + v[0].cardinal);
    ok(v[3].cardinal === 'SUR', 'cardinal e06541 ' + v[3].cardinal);
    ok(v[6].cardinal === 'SUROESTE', 'cardinal e48a21 ' + v[6].cardinal);
    ok(Formato.fila(v[6], c).altitud.trim() === '10.950 M', 'altitud e48a21: "' + Formato.fila(v[6], c).altitud + '"');
  });
  t('Readsb.parsear: clave "aircraft" y now en segundos', function () {
    var j = RF.leerJSON('readsb_aircraft_key.json');
    ok(j.aircraft && !j.ac, 'fixture usa "aircraft"');
    var e = Readsb.parsear(j, 0, cfg);
    ok(e.length === 10, 'cantidad ' + e.length);
    ok(porId(e, 'e06541').tsPosicion === T0 - 800, 'tsPosicion con now en segundos');
  });
  t('Readsb.parsear: vacío y null; millasNauticas', function () {
    igual(Readsb.parsear(RF.leerJSON('readsb_vacio.json'), T0, cfg), []);
    ok(Readsb.parsear(null, T0, cfg) === null, 'null');
    ok(Readsb.millasNauticas(30) === 19, '30'); ok(Readsb.millasNauticas(200) === 110, '200'); ok(Readsb.millasNauticas(1000) === 250, '1000');
  });

  // ---------------- OpenSky.parsear ----------------
  var osk = RF.leerJSON('opensky_states.json'), crudosOsk = null;
  t('OpenSky.parsear: 5 estados, descarta e0e5f6', function () {
    crudosOsk = OpenSky.parsear(osk, T0, cfg);
    ok(crudosOsk.length === 5, 'cantidad ' + crudosOsk.length);
    ok(!crudosOsk.some(function (c) { return c.icao24 === 'e0e5f6'; }), 'e0e5f6');
  });
  t('OpenSky.parsear: campos puntuales', function () {
    cerca(porId(crudosOsk, 'e06541').velocidadMs, 82.31, 0.001, 'vel');
    var b = porId(crudosOsk, 'e0b9c8'); cerca(b.altitudBaroM, 3657.6, 0.001, 'alt geo'); ok(b.callsign === null, 'callsign null');
    var f = porId(crudosOsk, 'e0f1a7'); ok(f.lat === null, 'lat null'); ok(f.tsPosicion === 1764079180000, 'ts ' + f.tsPosicion);
    ok(porId(crudosOsk, 'e0a1b2').enTierra === true, 'en tierra');
  });
  t('OpenSky + procesar: quedan 3 (e06541, e0b9c8, e48a21)', function () {
    var v = Datos.procesar(crudosOsk, cfg, T0);
    igual(v.map(function (x) { return x.id; }).sort(), ['e06541', 'e0b9c8', 'e48a21']);
  });
  t('OpenSky.parsear: states null -> []', function () { igual(OpenSky.parsear(RF.leerJSON('opensky_vacio.json'), T0, cfg), []); });

  // ---------------- URLs y headers ----------------
  function proveedorConRed(nombre, cfgX, tabla) {
    Red.configurar(cfgX);
    var tr = RF.crearTransporte(tabla);
    Red.usarTransporte(tr);
    var p = nombre === 'opensky' ? OpenSky.crear(Red, cfgX) : Readsb.crear(nombre, Red, cfgX);
    return { p: p, tr: tr };
  }
  var OK_READSB = [{ re: /./, status: 200, archivo: 'readsb_point.json' }];
  t('URL airplaneslive directo', function () {
    var x = proveedorConRed('airplaneslive', clonar(cfg), OK_READSB);
    return x.p.obtenerEstados(T0).then(function (e) {
      ok(x.tr.llamadas[0].url === 'https://api.airplanes.live/v2/point/-32.8500/-60.7833/19', x.tr.llamadas[0].url);
      ok(e.length === 10, 'estados'); ok(x.p.info.crudos === 10 && x.p.info.status === 200, 'info');
    });
  });
  t('URL adsbfi directo', function () {
    var x = proveedorConRed('adsbfi', clonar(cfg), OK_READSB);
    return x.p.obtenerEstados(T0).then(function () {
      ok(x.tr.llamadas[0].url === 'https://opendata.adsb.fi/api/v3/lat/-32.8500/lon/-60.7833/dist/19', x.tr.llamadas[0].url);
    });
  });
  t('URL adsblol directo', function () {
    var x = proveedorConRed('adsblol', clonar(cfg), OK_READSB);
    return x.p.obtenerEstados(T0).then(function () {
      ok(x.tr.llamadas[0].url === 'https://api.adsb.lol/v2/point/-32.8500/-60.7833/19', x.tr.llamadas[0].url);
    });
  });
  t('URL con proxy', function () {
    var c = clonar(cfg); c.PROXY = 'http://127.0.0.1:8080/api/';
    var x = proveedorConRed('airplaneslive', c, OK_READSB);
    return x.p.obtenerEstados(T0).then(function () {
      ok(x.tr.llamadas[0].url === 'http://127.0.0.1:8080/api/airplaneslive/point/-32.8500/-60.7833/19', x.tr.llamadas[0].url);
    });
  });
  t('URL opensky (bbox)', function () {
    var x = proveedorConRed('opensky', clonar(cfg), [{ re: /./, status: 200, archivo: 'opensky_states.json' }]);
    return x.p.obtenerEstados(T0).then(function (e) {
      ok(x.tr.llamadas[0].url === 'https://opensky-network.org/api/states/all?lamin=-33.1198&lomin=-61.1045&lamax=-32.5802&lomax=-60.4621', x.tr.llamadas[0].url);
      ok(e.length === 5, 'estados');
    });
  });
  t('adsblol: x-api-key solo sin proxy', function () {
    var c = clonar(cfg); c.ADSBLOL_KEY = 'k';
    var x = proveedorConRed('adsblol', c, OK_READSB);
    return x.p.obtenerEstados(T0).then(function () {
      ok(x.tr.llamadas[0].headers['x-api-key'] === 'k', 'falta x-api-key');
      var c2 = clonar(c); c2.PROXY = 'http://127.0.0.1:8080/api/';
      var y = proveedorConRed('adsblol', c2, OK_READSB);
      return y.p.obtenerEstados(T0).then(function () {
        ok(y.tr.llamadas[0].headers['x-api-key'] === undefined, 'con proxy no debe ir la key');
      });
    });
  });
  t('OpenSky: 429 con retry-after rechaza {tipo 429, retryAfterS 77}', function () {
    var x = proveedorConRed('opensky', clonar(cfg), [{ re: /./, status: 429, texto: '{}', headers: { 'X-Rate-Limit-Retry-After-Seconds': '77' } }]);
    return rechazo(x.p.obtenerEstados(T0)).then(function (e) {
      ok(e.tipo === '429' && e.retryAfterS === 77, JSON.stringify(e));
    });
  });
  t('OpenSky: x-rate-limit-remaining -> info.restante', function () {
    var x = proveedorConRed('opensky', clonar(cfg), [{ re: /./, status: 200, archivo: 'opensky_states.json', headers: { 'X-Rate-Limit-Remaining': '399' } }]);
    return x.p.obtenerEstados(T0).then(function () { ok(x.p.info.restante === 399, 'restante ' + x.p.info.restante); });
  });
  t('Readsb: error de red rechaza con tipo "red"', function () {
    var x = proveedorConRed('airplaneslive', clonar(cfg), []);
    return rechazo(x.p.obtenerEstados(T0)).then(function (e) { ok(e.tipo === 'red' && e.status === 0, JSON.stringify(e)); });
  });
  t('(limpieza) Red.usarTransporte(null)', function () { Red.usarTransporte(null); });

  // ---------------- Fuentes ----------------
  function fake(nombre) {
    var p = { nombre: nombre, info: {}, llamadas: 0, modo: 'ok', retry: null };
    p.obtenerEstados = function () {
      p.llamadas++;
      if (p.modo === 'ok') { p.info = { status: 200 }; return Promise.resolve([{ icao24: nombre }]); }
      if (p.modo === '429') return Promise.reject({ tipo: '429', status: 429, retryAfterS: p.retry });
      return Promise.reject({ tipo: p.modo, status: 0, retryAfterS: null });
    };
    return p;
  }
  function fuentesCon(nombres, mod) {
    var c = clonar(cfg);
    c.PROVEEDORES = nombres;
    if (mod) mod(c);
    var provs = {};
    nombres.forEach(function (n) { provs[n] = fake(n); });
    var alm = RF.crearAlmacenMemoria();
    return { c: c, provs: provs, alm: alm, f: Fuentes.crear(c, provs, alm) };
  }
  var NOMBRES4 = ['airplaneslive', 'adsbfi', 'adsblol', 'opensky'];
  var warn = console.warn;

  t('Fuentes 1: todos OK -> siempre airplaneslive', function () {
    var x = fuentesCon(NOMBRES4);
    return x.f.obtener(T0).then(function (r) {
      ok(r.ok && r.proveedor === 'airplaneslive', 'prov ' + r.proveedor);
      return x.f.obtener(T0 + 10000);
    }).then(function (r) { ok(r.proveedor === 'airplaneslive', 'segundo'); ok(x.provs.adsbfi.llamadas === 0, 'adsbfi no se toca'); });
  });
  t('Fuentes 2: 429 retryAfter 120 -> fallback inmediato y vuelta a los 121 s', function () {
    console.warn = function () {};
    var x = fuentesCon(NOMBRES4);
    x.provs.airplaneslive.modo = '429'; x.provs.airplaneslive.retry = 120;
    return x.f.obtener(T0).then(function (r) {
      ok(r.ok && r.proveedor === 'adsbfi', 'prov ' + r.proveedor); ok(r.intentos.length === 2, 'intentos ' + r.intentos.length);
      return x.f.obtener(T0 + 119000);
    }).then(function (r) {
      ok(r.proveedor === 'adsbfi' && r.intentos.length === 1, 'a +119s: ' + r.proveedor);
      x.provs.airplaneslive.modo = 'ok';
      return x.f.obtener(T0 + 121000);
    }).then(function (r) { ok(r.proveedor === 'airplaneslive', 'a +121s: ' + r.proveedor); console.warn = warn; },
      function (e) { console.warn = warn; throw e; });
  });
  t('Fuentes 3: falla "red" -> fallback; 2 fallas enfrían 120 s, luego 240 s', function () {
    console.warn = function () {};
    var x = fuentesCon(NOMBRES4), AL = x.provs.airplaneslive;
    AL.modo = 'red';
    return x.f.obtener(T0).then(function (r) {
      ok(r.proveedor === 'adsbfi', 'tick1 ' + r.proveedor);
      return x.f.obtener(T0 + 1000);
    }).then(function (r) {
      ok(r.proveedor === 'adsbfi', 'tick2');
      var e = x.f.info().porProv.airplaneslive.enfriaHastaMs;
      ok(e - (T0 + 1000) === 120000, 'enfriamiento 1: ' + (e - (T0 + 1000)));
      var n = AL.llamadas;
      return x.f.obtener(T0 + 60000).then(function () { ok(AL.llamadas === n, 'no debe probar en enfriamiento'); });
    }).then(function () {
      return x.f.obtener(T0 + 122000);          // vuelve a probar: falla 1
    }).then(function () {
      return x.f.obtener(T0 + 123000);          // falla 2 -> 240 s
    }).then(function () {
      var e = x.f.info().porProv.airplaneslive.enfriaHastaMs;
      ok(e - (T0 + 123000) === 240000, 'enfriamiento 2: ' + (e - (T0 + 123000)));
      console.warn = warn;
    }, function (e) { console.warn = warn; throw e; });
  });
  t('Fuentes 4: cupo diario (95 %) y renovación a las 24 h', function () {
    var x = fuentesCon(['adsblol'], function (c) { c.LIMITES.adsblol.CUPO_DIARIO = 10; });
    var p = Promise.resolve();
    for (var i = 0; i < 9; i++) (function (i) { p = p.then(function () { return x.f.obtener(T0 + i * 1000); }); })(i);
    return p.then(function () {
      ok(x.f.info().porProv.adsblol.usados === 9, 'usados ' + x.f.info().porProv.adsblol.usados);
      return x.f.obtener(T0 + 10000);
    }).then(function (r) {
      ok(r.ok === false && r.proveedor === null, 'debía estar agotado');
      return x.f.obtener(T0 + 24 * 3600 * 1000 + 1000);
    }).then(function (r) { ok(r.ok && r.proveedor === 'adsblol', 'debía volver a las 24 h'); });
  });
  t('Fuentes 5: PROVEEDOR fijo nunca usa otro', function () {
    console.warn = function () {};
    var x = fuentesCon(NOMBRES4, function (c) { c.PROVEEDOR = 'adsbfi'; });
    x.provs.adsbfi.modo = 'red';
    return x.f.obtener(T0).then(function (r) {
      ok(r.ok === false, 'debía fallar');
      ok(x.provs.airplaneslive.llamadas === 0 && x.provs.adsblol.llamadas === 0 && x.provs.opensky.llamadas === 0, 'usó otro proveedor');
      console.warn = warn;
    }, function (e) { console.warn = warn; throw e; });
  });
  t('Fuentes 6: todos fallan -> ok:false y ticksFallidos sube', function () {
    console.warn = function () {};
    var x = fuentesCon(NOMBRES4);
    NOMBRES4.forEach(function (n) { x.provs[n].modo = 'red'; });
    return x.f.obtener(T0).then(function (r) {
      ok(r.ok === false, 'ok false'); ok(x.f.info().ticksFallidos === 1, 'ticks ' + x.f.info().ticksFallidos);
      return x.f.obtener(T0 + 1000);
    }).then(function () { ok(x.f.info().ticksFallidos === 2, 'ticks 2'); console.warn = warn; },
      function (e) { console.warn = warn; throw e; });
  });
  t('Fuentes 7: intervaloS', function () {
    console.warn = function () {};
    var x = fuentesCon(NOMBRES4);
    var dia = new Date(2025, 10, 25, 12, 0, 0);       // 12:00 local
    var noche = new Date(2025, 10, 25, 3, 0, 0);      // 03:00 local
    ok(x.f.intervaloS('REPOSO', dia) === 20, 'reposo ' + x.f.intervaloS('REPOSO', dia));
    ok(x.f.intervaloS('ACTIVO', dia) === 10, 'activo');
    ok(x.f.intervaloS('ESPERA', dia) === 10, 'espera');
    ok(x.f.intervaloS('REPOSO', noche) === 60, 'franja lenta ' + x.f.intervaloS('REPOSO', noche));
    // primer disponible = opensky (los otros enfriados por 429)
    var y = fuentesCon(NOMBRES4);
    ['airplaneslive', 'adsbfi', 'adsblol'].forEach(function (n) { y.provs[n].modo = '429'; y.provs[n].retry = 3600; });
    var d0 = new Date(T0 + 1000);
    return y.f.obtener(T0).then(function () { return y.f.obtener(T0); }).then(function () {
      // airplaneslive+adsbfi enfriados; adsblol aún no (nunca se probó): probarlo
      return y.f.obtener(T0);
    }).then(function () {
      ok(y.f.info().porProv.adsblol.enfriaHastaMs > T0, 'adsblol enfriado');
      ok(y.f.intervaloS('REPOSO', d0) === 240, 'opensky reposo ' + y.f.intervaloS('REPOSO', d0));
      ok(y.f.intervaloS('ACTIVO', d0) === 240, 'opensky activo');
      // ticksFallidos: 8 proveedores sin LIMITES; cada tick prueba todos los disponibles,
      // así que tras 2 ticks fallidos quedan todos enfriando (120 s) y el intervalo es lo que falta para el primero
      var ns = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'];
      var z = fuentesCon(ns);
      ns.forEach(function (n) { z.provs[n].modo = 'red'; });
      var p = Promise.resolve();
      [0, 1].forEach(function (i) { p = p.then(function () { return z.f.obtener(T0 + i * 1000); }); });
      return p.then(function () {
        ok(z.f.info().ticksFallidos === 2, 'ticks ' + z.f.info().ticksFallidos);
        var i2 = z.f.intervaloS('REPOSO', new Date(T0 + 2000));
        ok(i2 >= 115 && i2 <= 120, 'con 2 fallidos (todos enfriando): ' + i2);
        var q = Promise.resolve();
        [2, 3, 4].forEach(function (i) { q = q.then(function () { return z.f.obtener(T0 + i * 1000); }); });
        return q;
      }).then(function () {
        ok(z.f.info().ticksFallidos === 5, 'ticks ' + z.f.info().ticksFallidos);
        var i5 = z.f.intervaloS('REPOSO', new Date(T0 + 5000));
        ok(i5 >= 30 && i5 <= 120, 'con 5 fallidos: ' + i5);
        // sin enfriamiento pendiente, el backoff exponencial sigue topeado en 300
        ok(z.f.intervaloS('REPOSO', new Date(T0 + 200000)) === 300, 'tope 300: ' + z.f.intervaloS('REPOSO', new Date(T0 + 200000)));
        console.warn = warn;
      });
    }).then(null, function (e) { console.warn = warn; throw e; });
  });
  t('Fuentes 8: enFranja', function () {
    var f1 = { desde: '01:00', hasta: '05:30' };
    ok(Fuentes.enFranja(f1, new Date(2025, 10, 25, 1, 0)) === true, '01:00 true');
    ok(Fuentes.enFranja(f1, new Date(2025, 10, 25, 5, 30)) === false, '05:30 false');
    ok(Fuentes.enFranja({ desde: '23:00', hasta: '02:00' }, new Date(2025, 10, 25, 1, 0)) === true, '23-02 a la 01:00');
    ok(Fuentes.enFranja(null, new Date()) === false, 'null');
  });
  t('Fuentes 9: cupos persistidos en el almacén y recuperados', function () {
    var x = fuentesCon(['adsblol']);
    return x.f.obtener(T0).then(function () { return x.f.obtener(T0 + 1000); }).then(function () {
      ok(x.f.info().porProv.adsblol.usados === 2, 'usados');
      var f2 = Fuentes.crear(x.c, x.provs, x.alm);
      ok(f2.info().porProv.adsblol.usados === 2, 'recuperados ' + f2.info().porProv.adsblol.usados);
    });
  });
  t('Datos: vuelo con matrícula / hex', function () {
    ok(Datos.normalizar({ icao24: 'e0c3d4', callsign: '', matricula: 'LV-GHI' }, cfg, T0).vuelo === 'LV-GHI', 'matrícula');
    ok(Datos.normalizar({ icao24: 'e0c3d4', callsign: '' }, cfg, T0).vuelo === 'E0C3D4', 'hex');
  });

  // ---------------- Enriquecer ----------------
  var TABLA_ADSBDB = [
    { re: /callsign\/ARG1541$/, status: 200, archivo: 'adsbdb_callsign_ARG1541.json' },
    { re: /callsign\/JES3420$/, status: 200, archivo: 'adsbdb_callsign_JES3420.json' },
    { re: /callsign\/IBE3412$/, status: 200, archivo: 'adsbdb_callsign_IBE3412.json' },
    { re: /callsign\//, status: 404, archivo: 'adsbdb_callsign_404.json' },
    { re: /aircraft\/e06541$/, status: 200, archivo: 'adsbdb_aircraft_e06541.json' },
    { re: /aircraft\/e03420$/, status: 200, archivo: 'adsbdb_aircraft_e03420.json' },
    { re: /aircraft\//, status: 404, archivo: 'adsbdb_aircraft_404.json' }
  ];
  var ecfg = clonar(cfg); ecfg.ENRIQ_ESPACIADO_MS = 0;
  function nuevoEnriq(tabla, alm, cb) {
    var red = RF.crearRedFalsa(tabla || TABLA_ADSBDB);
    var almacen = alm || RF.crearAlmacenMemoria();
    return { red: red, alm: almacen, e: Enriquecer.crear(ecfg, red, almacen, cb || function () {}) };
  }
  var AHORA = Date.now();
  var cuentaAct = 0;
  var E = null, vuelosPoint = null, crudosE = null;

  t('Enriquecer 1: aplicar sin caché no cambia nada', function () {
    E = nuevoEnriq(null, null, function () { cuentaAct++; });
    crudosE = Readsb.parsear(point, T0, cfg);
    var antes = clonar(crudosE);
    E.e.aplicar(crudosE, AHORA);
    igual(crudosE, antes);
  });
  t('Enriquecer 2: pedir encola rutas (no LVFVZ ni sin callsign) y tipo solo de e03420', function () {
    vuelosPoint = Datos.procesar(crudosE, cfg, T0);
    console.log = function () {};
    E.e.pedir(vuelosPoint, AHORA);
    return E.e.drenar().then(function () {
      console.log = silencio;
      var urls = E.red.llamadas.map(function (l) { return l.url; });
      var rutas = urls.filter(function (u) { return /callsign\//.test(u); }).map(function (u) { return u.split('/').pop(); }).sort();
      igual(rutas, ['ARG1541', 'AZP401', 'GLO7461', 'JES3420']);
      var tipos = urls.filter(function (u) { return /aircraft\//.test(u); }).map(function (u) { return u.split('/').pop(); });
      igual(tipos, ['e03420']);
    }, function (e) { console.log = silencio; throw e; });
  });
  t('Enriquecer 3: aplicar deja rutas/tipos; 404 -> null cacheado', function () {
    E.e.aplicar(crudosE, AHORA);
    var a = porId(crudosE, 'e06541'), j = porId(crudosE, 'e03420');
    ok(a.origen === 'AEP' && a.destino === 'ROS', 'ARG1541 ' + a.origen + '>' + a.destino);
    ok(j.origen === 'AEP' && j.destino === 'SLA' && j.tipo === 'A20N', 'JES3420 ' + j.origen + '>' + j.destino + ' ' + j.tipo);
    ok(!porId(crudosE, 'e0b9c8').origen && !porId(crudosE, 'e48a21').origen, 'AZP401/GLO7461 deben seguir sin ruta');
    ok(E.e.ruta('AZP401') === null && E.e.ruta('GLO7461') === null, 'caché null');
    ok(E.e.ruta('XXX9999') === undefined, 'desconocido = undefined');
  });
  t('Enriquecer 4: alActualizar llamado >= 5 veces', function () { ok(cuentaAct >= 5, 'llamadas ' + cuentaAct); });
  t('Enriquecer 5: segundo pedir no hace llamadas nuevas', function () {
    var n = E.red.llamadas.length;
    E.e.pedir(vuelosPoint, AHORA + 1000);
    return E.e.drenar().then(function () { ok(E.red.llamadas.length === n, 'llamadas nuevas: ' + (E.red.llamadas.length - n)); });
  });
  t('Enriquecer 6: ruta no plausible (IBE3412 en Ibarlucea) no se aplica', function () {
    var X = nuevoEnriq();
    console.log = function () {};
    X.e.pedir([{ id: 'e11111', callsign: 'IBE3412', tipo: 'A20N' }], AHORA);
    return X.e.drenar().then(function () {
      console.log = silencio;
      ok(X.e.ruta('IBE3412') && X.e.ruta('IBE3412').origen === 'MAD', 'ruta en caché');
      var c = { icao24: 'e11111', callsign: 'IBE3412', lat: -32.85, lon: -60.7833, tipo: 'A20N', origen: null, destino: null };
      X.e.aplicar([c], AHORA);
      ok(!c.origen && !c.destino, 'no debía aplicarse');
    }, function (e) { console.log = silencio; throw e; });
  });
  t('Enriquecer 7: no pisa origen ya puesto', function () {
    var c = { icao24: 'e06541', callsign: 'ARG1541', lat: -32.95, lon: -60.80, tipo: 'E190', origen: 'COR', destino: 'ROS' };
    E.e.aplicar([c], AHORA);
    ok(c.origen === 'COR' && c.destino === 'ROS', 'se pisó');
    var d = { icao24: 'e03420', callsign: 'JES3420', lat: -32.78, lon: -60.7, tipo: 'B738', origen: null, destino: null };
    E.e.aplicar([d], AHORA);
    ok(d.tipo === 'B738', 'tipo pisado');
  });
  t('Enriquecer 8: 429 -> pausa 60 s, reencola y no cachea', function () {
    var X = nuevoEnriq([{ re: /./, status: 429, texto: '{}' }]);
    X.e.pedir([{ id: 'e22222', callsign: 'ARG1541', tipo: 'E190' }], AHORA);
    return X.e.drenar().then(function () {
      var i = X.e.info();
      cerca(i.pausaHastaMs, AHORA + 60000, 5000, 'pausaHastaMs');
      ok(i.cola === 1, 'cola ' + i.cola); ok(i.ultimoStatus === 429, 'status');
      ok(X.e.ruta('ARG1541') === undefined, 'no se cachea');
    });
  });
  t('Enriquecer 9: error de red no se persiste ni se reconsulta en 2 min', function () {
    var X = nuevoEnriq([]);   // sin reglas = status 0
    var v = [{ id: 'e33333', callsign: 'ARG1541', tipo: 'E190' }];
    X.e.pedir(v, AHORA);
    return X.e.drenar().then(function () {
      ok(X.red.llamadas.length === 1, 'primera consulta');
      X.e.pedir(v, AHORA + 60000);
      return X.e.drenar();
    }).then(function () {
      ok(X.red.llamadas.length === 1, 'no debía reconsultar: ' + X.red.llamadas.length);
      X.e.guardarAhora();
      var guardado = JSON.stringify(X.alm.leer('tv.enriq.v1') || {});
      ok(guardado.indexOf('ARG1541') < 0, 'se persistió el error: ' + guardado);
    });
  });
  t('Enriquecer 10: persistencia, vencimiento', function () {
    console.log = function () {};
    var alm = RF.crearAlmacenMemoria();
    var X = nuevoEnriq(null, alm);
    X.e.pedir([{ id: 'e44444', callsign: 'ARG1541', tipo: 'E190' }], AHORA);
    return X.e.drenar().then(function () {
      console.log = silencio;
      X.e.guardarAhora();
      var e2 = Enriquecer.crear(ecfg, RF.crearRedFalsa([]), alm, null);
      var r = e2.ruta('ARG1541');
      ok(r && r.origen === 'AEP' && r.destino === 'ROS', 'no recuperó ARG1541');
      var alm2 = RF.crearAlmacenMemoria();
      alm2.escribir('tv.enriq.v1', { r: { ARG1541: { v: r, e: Date.now() - 1000 } }, t: {} });
      var e3 = Enriquecer.crear(ecfg, RF.crearRedFalsa([]), alm2, null);
      ok(e3.ruta('ARG1541') === undefined, 'entrada vencida debe ser undefined');
    }, function (e) { console.log = silencio; throw e; });
  });
  t('Enriquecer 11: parsearRuta / parsearAeronave', function () {
    ok(Enriquecer.parsearRuta({ response: 'unknown callsign' }) === null, 'unknown callsign');
    ok(Enriquecer.parsearAeronave(RF.leerJSON('adsbdb_aircraft_e06541.json')) === 'E190', 'E190');
    ok(Enriquecer.parsearAeronave(RF.leerJSON('adsbdb_aircraft_404.json')) === null, 'aeronave 404');
    var r = Enriquecer.parsearRuta(RF.leerJSON('adsbdb_callsign_ARG1541.json'));
    ok(r.origen === 'AEP' && r.destino === 'ROS' && r.origenIcao === 'SABE' && r.aerolinea.iata === 'AR', 'ruta ARG1541');
  });
  t('Enriquecer: plausible (AEP-ROS, AEP-MDZ, MAD-BCN)', function () {
    var aepRos = { oLat: -34.5592, oLon: -58.4156, dLat: -32.9036, dLon: -60.785 };
    ok(Enriquecer.plausible(aepRos, -32.95, -60.80) === true, 'AEP-ROS');
    var aepMdz = { oLat: -34.5592, oLon: -58.4156, dLat: -32.8317, dLon: -68.7929 };
    ok(Enriquecer.plausible(aepMdz, -32.85, -60.7833) === true, 'AEP-MDZ');
    var madBcn = { oLat: 40.4719, oLon: -3.5626, dLat: 41.2971, dLon: 2.0785 };
    ok(Enriquecer.plausible(madBcn, -32.85, -60.7833) === false, 'MAD-BCN');
    ok(Enriquecer.plausible(madBcn, null, null) === true, 'sin posición');
  });

  return cola.then(function () { console.log = silencio; console.warn = warn; Red.usarTransporte(null); return res; });
}

module.exports = { correr: correr };
if (require.main === module) {
  correr().then(function (r) {
    var f = 0;
    r.forEach(function (x) { console.log((x.ok ? 'OK    ' : 'FALLA ') + x.nombre + (x.ok ? '' : '  -> ' + x.error)); if (!x.ok) f++; });
    console.log(f ? f + ' test(s) fallaron' : 'Todo OK (' + r.length + ' tests)');
    process.exit(f ? 1 : 0);
  });
}
