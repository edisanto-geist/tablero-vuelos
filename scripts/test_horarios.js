// Tests de Fase 2.5: horarios SAL/ETA (calculados y por AeroAPI), cabeceras de credenciales, proxy y Worker. Sin red real.
// Exporta correr() -> Promise<[{nombre, ok, error}]>.
var path = require('path');
var fs = require('fs');
var cp = require('child_process');
var http = require('http');
var base = path.join(__dirname, '..', 'web', 'js');
var RF = require('./red_falsa.js');

// config.js define window.CONFIG; en node lo cargamos con un window falso.
global.window = {};
var rutaConfig = path.join(base, 'config.js');
delete require.cache[require.resolve(rutaConfig)];
require(rutaConfig);
var CONFIG = global.window.CONFIG;
delete global.window;

var Geo = require(path.join(base, 'geo.js'));
var Horarios = require(path.join(base, 'horarios.js'));
var Datos = require(path.join(base, 'datos.js'));
var Formato = require(path.join(base, 'formato.js'));
var Red = require(path.join(base, 'red.js'));
var Readsb = require(path.join(base, 'proveedores', 'readsb.js'));
var Enriquecer = require(path.join(base, 'enriquecer.js'));

var T0 = 1764079200000;   // 2025-11-25 14:00Z = 11:00 local

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

function correr() {
  var res = [];
  var cola = Promise.resolve();
  function t(nombre, fn) {
    cola = cola.then(function () {
      var r;
      try { r = fn(); } catch (e) { res.push({ nombre: nombre, ok: false, error: String(e && e.message || e) }); return; }
      return Promise.resolve(r).then(function () { res.push({ nombre: nombre, ok: true }); },
        function (e) { res.push({ nombre: nombre, ok: false, error: String(e && e.message || e) }); });
    });
  }

  var cfg = clonar(CONFIG);
  cfg.PROXY = '';
  cfg.HORARIOS_MODO = 'calc';
  cfg.HORARIOS_ESPACIADO_MS = 0;
  cfg.HORARIOS_CUPO_DIARIO = 30;
  cfg.ZONA_UTC_MIN = -180;
  var cfgApi = clonar(cfg); cfgApi.HORARIOS_MODO = 'api';
  var silencio = console.log, warn = console.warn;
  console.log = function () {}; console.warn = function () {};

  var point = RF.leerJSON('readsb_point.json');
  var crudos = Readsb.parsear(point, T0, cfg);
  var rutaArg = Enriquecer.parsearRuta(RF.leerJSON('adsbdb_callsign_ARG1541.json'));
  var rutaJes = Enriquecer.parsearRuta(RF.leerJSON('adsbdb_callsign_JES3420.json'));
  var apiArg = Horarios.parsearAeroapi(RF.leerJSON('aeroapi_flights_ARG1541.json'), T0);
  var apiJes = Horarios.parsearAeroapi(RF.leerJSON('aeroapi_flights_JES3420.json'), T0);

  function crudoArg() {
    var c = clonar(porId(crudos, 'e06541'));
    c.origen = rutaArg.origen; c.destino = rutaArg.destino;
    c.ruta = { oLat: rutaArg.oLat, oLon: rutaArg.oLon, dLat: rutaArg.dLat, dLon: rutaArg.dLon };
    return c;
  }
  function crudoJes() {
    var c = clonar(porId(crudos, 'e03420'));
    c.origen = rutaJes.origen; c.destino = rutaJes.destino;
    c.ruta = { oLat: rutaJes.oLat, oLon: rutaJes.oLon, dLat: rutaJes.dLat, dLon: rutaJes.dLon };
    return c;
  }
  function fila(c, conf) { return Formato.fila(Datos.normalizar(c, conf, T0), conf); }

  // ---------------- datos base ----------------
  t('AEROPUERTOS: coordenadas clave, coords() y 32 aeropuertos', function () {
    var A = Horarios.AEROPUERTOS;
    ok(Object.keys(A).length === 32, 'cantidad ' + Object.keys(A).length);
    igual(A.ROS, [-32.9036, -60.785], 'ROS'); igual(A.AEP, [-34.5592, -58.4156], 'AEP'); igual(A.SLA, [-24.856, -65.4862], 'SLA');
    igual(Horarios.coords('ros'), { lat: -32.9036, lon: -60.785 }, 'coords ros');
    ok(Horarios.coords('XXX') === null && Horarios.coords(null) === null, 'coords desconocido');
  });
  t('Formato.hora(T0) = 11:00 y fechaLocal', function () {
    ok(Formato.hora(T0, cfg) === '11:00', Formato.hora(T0, cfg));
    ok(Formato.hora(T0, { ZONA_UTC_MIN: 0 }) === '14:00', 'UTC');
    ok(Horarios.fechaLocal(T0, cfg) === '2025-11-25', 'fecha');
    ok(Horarios.fechaLocal(Date.UTC(2025, 10, 25, 2, 0), cfg) === '2025-11-24', 'antes de las 03Z sigue el día anterior');
  });
  t('tramoMin: tres tramos', function () {
    cerca(Horarios.tramoMin(30, 400, 1000), 30 / ((400 + 250) / 2) * 60 + 1, 1e-9, 'd<=60');
    cerca(Horarios.tramoMin(200, 400, 5000), 200 / 550 * 60 + 4, 1e-9, 'd<=250');
    cerca(Horarios.tramoMin(200, 700, 5000), 200 / 700 * 60 + 4, 1e-9, 'd<=250 rápido');
    cerca(Horarios.tramoMin(1000, 500, 3000), 1000 / 780 * 60 + 8, 1e-9, 'bajo, usa 780');
    cerca(Horarios.tramoMin(1000, 850, 11000), 1000 / 850 * 60 + 8, 1e-9, 'crucero usa gs');
    cerca(Horarios.tramoMin(1000, 500, null), 1000 / 780 * 60 + 8, 1e-9, 'sin altitud');
  });

  // ---------------- nivel (a): calculado ----------------
  t('ARG1541: dD 5,35 km y dO 283,9 km → LLEGA~11:02 y SALIÓ~10:30', function () {
    var v = Datos.normalizar(crudoArg(), cfg, T0);
    cerca(Geo.distanciaKm(v.lat, v.lon, v.dLat, v.dLon), 5.35, 0.05, 'dD');
    cerca(Geo.distanciaKm(v.oLat, v.oLon, v.lat, v.lon), 283.9, 0.3, 'dO');
    var f = Formato.fila(v, cfg);
    ok(f.eta === 'LLEGA~11:02', '"' + f.eta + '"'); ok(f.salida === 'SALIÓ~10:30', '"' + f.salida + '"');
    ok(f.etaTipo === 'calc' && f.salidaTipo === 'calc' && f.hayHorarios === true, 'tipos');
    ok(v.horarioFuente === 'calc', 'fuente');
  });
  t('JES3420 AEP→SLA: LLEGA~12:25 y SALIÓ~10:30', function () {
    var f = fila(crudoJes(), cfg);
    ok(f.eta === 'LLEGA~12:25', '"' + f.eta + '"'); ok(f.salida === 'SALIÓ~10:30', '"' + f.salida + '"');
  });
  t('coordenadas por IATA cuando no hay crudo.ruta (ej. demo)', function () {
    var c = crudoArg(); delete c.ruta;
    var f = fila(c, cfg);
    ok(f.eta === 'LLEGA~11:02' && f.salida === 'SALIÓ~10:30', f.salida + ' / ' + f.eta);
  });
  t('velocidad < 150, en tierra o sin coordenadas → --:--', function () {
    var lento = crudoArg(); lento.velocidadMs = 100 / 3.6;
    var f1 = fila(lento, cfg);
    ok(f1.salida === 'SALIÓ --:--' && f1.eta === 'LLEGA --:--' && f1.hayHorarios === false, 'lento ' + f1.salida + f1.eta);
    var suelo = crudoArg(); suelo.enTierra = true;
    var v2 = Datos.normalizar(suelo, cfg, T0);
    var f2 = Formato.fila(v2, cfg);
    ok(f2.salida === 'SALIÓ --:--' && f2.eta === 'LLEGA --:--', 'en tierra');
    var sinRuta = crudoArg(); delete sinRuta.ruta; sinRuta.origen = null; sinRuta.destino = null;
    var f3 = fila(sinRuta, cfg);
    ok(f3.salida === 'SALIÓ --:--' && f3.eta === 'LLEGA --:--', 'sin coordenadas');
    var raro = crudoArg(); raro.destino = 'ZZZ'; delete raro.ruta;
    ok(fila(raro, cfg).eta === 'LLEGA --:--', 'destino desconocido');
  });
  t('ETA: sobre el aeropuerto y baja → ahora; muy lejos (>18 h) → null; origen a <3 km → sin salida', function () {
    var c = crudoArg(); c.lat = rutaArg.dLat; c.lon = rutaArg.dLon; c.altitudBaroM = 100; c.velocidadMs = 90;
    var v = Datos.normalizar(c, cfg, T0);
    ok(v.etaMs === T0 && v.etaTipo === 'calc', 'ahora ' + v.etaMs);
    var lejos = Horarios.calcular({ lat: 0, lon: 0, velocidadKmh: 200, enTierra: false, altitudM: 5000, dLat: 0, dLon: 180, oLat: 0, oLon: 0.01 }, cfg, T0);
    ok(lejos.etaMs === null, 'más de 18 h'); ok(lejos.salidaMs === null, 'origen a <3 km');
  });
  t('redondeo: a 1 min si faltan ≤30 min, a 5 si no; salida a 1 min con origen ≤60 km', function () {
    var p = Geo.destino(rutaArg.oLat, rutaArg.oLon, 90, 50);      // a 50 km de AEP
    var c = crudoArg(); c.lat = p.lat; c.lon = p.lon; c.altitudBaroM = 1500;
    var v = Datos.normalizar(c, cfg, T0);
    ok(v.salidaMs % 60000 === 0 && ((v.salidaMs - 3 * 3600000 * -1) % 300000) !== undefined, 'salida');
    var tO = Horarios.tramoMin(50, v.velocidadKmh, 1500);
    cerca(v.salidaMs, T0 - tO * 60000, 30000, 'salida a 1 min');
    var l = Datos.normalizar(crudoJes(), cfg, T0);
    ok((l.etaMs + (-180 * 60000)) % 300000 === 0, 'ETA larga múltiplo de 5 min');
  });

  // ---------------- nivel (b): AeroAPI ----------------
  t('parsearAeroapi: ARG1541 elige el vuelo en el aire, no el de ayer', function () {
    ok(apiArg.fuente === 'aeroapi' && apiArg.origen === 'AEP' && apiArg.destino === 'ROS', 'origen/destino');
    ok(Formato.hora(apiArg.salidaRealMs, cfg) === '10:18', 'salida real ' + Formato.hora(apiArg.salidaRealMs, cfg));
    ok(Formato.hora(apiArg.etaEstMs, cfg) === '11:09', 'eta est');
    ok(Formato.hora(apiArg.etaProgMs, cfg) === '11:05', 'eta prog');
    ok(apiArg.llegadaRealMs === null, 'sin llegada real');
  });
  t('parsearAeroapi: elección (2) no aterrizado más cercano, (3) el más cercano, JSON raro', function () {
    function vuelo(sched, extra) {
      var f = { scheduled_out: sched, actual_out: null, actual_off: null, actual_on: null, actual_in: null, origin: { code_iata: 'AEP' }, destination: { code_iata: 'ROS' } };
      Object.keys(extra || {}).forEach(function (k) { f[k] = extra[k]; });
      return f;
    }
    var a = vuelo('2025-11-25T20:00:00Z'), b = vuelo('2025-11-25T14:30:00Z'), c = vuelo('2025-11-25T14:10:00Z', { actual_out: '2025-11-25T14:15:00Z', actual_in: '2025-11-25T15:00:00Z' });
    var r = Horarios.parsearAeroapi({ flights: [a, b, c] }, T0);
    ok(r.salidaProgMs === Date.parse('2025-11-25T14:30:00Z'), '(2) ' + r.salidaProgMs);
    var d = vuelo('2025-11-25T14:10:00Z', { actual_in: '2025-11-25T15:00:00Z' });
    var e = vuelo('2025-11-25T08:00:00Z', { actual_in: '2025-11-25T09:00:00Z' });
    r = Horarios.parsearAeroapi({ flights: [e, d] }, T0);
    ok(r.salidaProgMs === Date.parse('2025-11-25T14:10:00Z'), '(3)');
    ok(Horarios.parsearAeroapi({ flights: [] }, T0) === null, 'vacío');
    ok(Horarios.parsearAeroapi({ x: 1 }, T0) === null && Horarios.parsearAeroapi(null, T0) === null &&
       Horarios.parsearAeroapi('basura', T0) === null && Horarios.parsearAeroapi({ flights: [null, 3] }, T0) === null, 'raro');
    ok(Horarios.parsearAeroapi(RF.leerJSON('aeroapi_flights_vacio.json'), T0) === null, 'fixture vacío');
  });
  t('api ARG1541 → SALIÓ 10:18 (real) y LLEGA 11:09 (est)', function () {
    var c = crudoArg(); c.horarioApi = apiArg;
    var f = fila(c, cfgApi);
    ok(f.salida === 'SALIÓ 10:18', '"' + f.salida + '"'); ok(f.eta === 'LLEGA 11:09', '"' + f.eta + '"');
    ok(f.salidaTipo === 'real' && f.etaTipo === 'est', 'tipos');
    ok(Datos.normalizar(c, cfgApi, T0).horarioFuente === 'aeroapi', 'fuente');
    // con modo calc la API se ignora
    var f2 = fila(c, cfg);
    ok(f2.salida === 'SALIÓ~10:30', 'calc ignora la api');
  });
  t('api JES3420 → PROG  09:40 / PROG  12:00', function () {
    var c = crudoJes(); c.horarioApi = apiJes;
    var f = fila(c, cfgApi);
    ok(f.salida === 'PROG  09:40', '"' + f.salida + '"'); ok(f.eta === 'PROG  12:00', '"' + f.eta + '"');
    ok(f.salidaTipo === 'prog' && f.etaTipo === 'prog', 'tipos');
  });
  t('api vacío → null y se usa el cálculo', function () {
    var api = Horarios.parsearAeroapi(RF.leerJSON('aeroapi_flights_vacio.json'), T0);
    var c = crudoArg(); c.horarioApi = api;
    var f = fila(c, cfgApi);
    ok(f.salida === 'SALIÓ~10:30' && f.eta === 'LLEGA~11:02', f.salida + ' / ' + f.eta);
  });
  t('llegada real de hace >30 min con el avión en el aire → se ignora la api', function () {
    var c = crudoArg();
    c.horarioApi = { fuente: 'aeroapi', salidaRealMs: T0 - 9 * 3600000, salidaProgMs: null, etaEstMs: null, etaProgMs: null,
      llegadaRealMs: T0 - 40 * 60000, origen: 'COR', destino: 'AEP' };
    var f = fila(c, cfgApi);
    ok(f.salida === 'SALIÓ~10:30' && f.eta === 'LLEGA~11:02', f.salida + ' / ' + f.eta);
    c.horarioApi.llegadaRealMs = T0 - 10 * 60000;    // hace 10 min: se muestra
    var f2 = fila(c, cfgApi);
    ok(f2.eta === 'LLEGÓ 10:50', '"' + f2.eta + '"');
  });
  t('MODO no → todos los campos null', function () {
    var c = crudoArg(); c.horarioApi = apiArg;
    var conf = clonar(cfg); conf.HORARIOS_MODO = 'no';
    var v = Datos.normalizar(c, conf, T0);
    ['oLat', 'oLon', 'dLat', 'dLon', 'salidaMs', 'salidaTipo', 'salidaProgMs', 'etaMs', 'etaTipo', 'etaProgMs', 'horarioFuente'].forEach(function (k) {
      ok(v[k] === null, k + ' = ' + v[k]);
    });
    var f = Formato.fila(v, conf);
    ok(f.hayHorarios === false && f.salida === 'SALIÓ --:--' && f.eta === 'LLEGA --:--', 'formato');
  });
  t('Formato: los 5 textos de salida y de eta miden 11', function () {
    var base = Datos.normalizar(crudoArg(), cfg, T0);
    [['real', 'SALIÓ 07:52', 'LLEGÓ 07:52'], ['prog', 'PROG  07:52', 'PROG  07:52'], ['est', null, 'LLEGA 07:52'],
     ['calc', 'SALIÓ~07:52', 'LLEGA~07:52']].forEach(function (x) {
      var v = clonar(base); var ms = T0 - 3 * 3600000 - 8 * 60000;   // 07:52 local
      v.salidaMs = ms; v.salidaTipo = x[0] === 'est' ? 'real' : x[0]; v.etaMs = ms; v.etaTipo = x[0];
      var f = Formato.fila(v, cfg);
      if (x[1]) ok(f.salida === x[1], '"' + f.salida + '" != "' + x[1] + '"');
      ok(f.eta === x[2], '"' + f.eta + '" != "' + x[2] + '"');
      ok(f.salida.length === 11 && f.eta.length === 11, 'ancho');
    });
    ok(Formato.ancho.salida === 11 && Formato.ancho.eta === 11, 'ancho declarado');
  });
  t('Enriquecer.aplicar pone crudo.ruta con coordenadas', function () {
    var almacen = RF.crearAlmacenMemoria();
    var red = RF.crearRedFalsa([{ re: /callsign\/ARG1541$/, archivo: 'adsbdb_callsign_ARG1541.json' }]);
    var c0 = Object.assign({}, clonar(porId(crudos, 'e06541')));
    var e = Enriquecer.crear({ ENRIQ_ESPACIADO_MS: 0 }, red, almacen, null);
    e.pedir(Datos.procesar([c0], cfg, T0), T0);
    return e.drenar().then(function () {
      var c = clonar(c0); e.aplicar([c], T0);
      ok(c.origen === 'AEP' && c.destino === 'ROS', 'ruta');
      igual(c.ruta, { oLat: -34.5592, oLon: -58.4156, dLat: -32.9036, dLon: -60.785 });
      var pre = clonar(c0); pre.origen = 'COR'; e.aplicar([pre], T0);
      ok(pre.ruta === undefined, 'no pisa un origen ya puesto');
    });
  });

  // ---------------- instancia con red falsa ----------------
  function vuelosDe(cs) {   // cs: lista de callsigns → vuelos normalizados con origen/destino de los fixtures
    return cs.map(function (c, i) {
      var cr = { icao24: 'e0000' + i, callsign: c, lat: -32.9, lon: -60.8, altitudBaroM: 3000, velocidadMs: 100, rumboDeg: 10 };
      if (c === 'ARG1541') { cr.origen = 'AEP'; cr.destino = 'ROS'; }
      if (c === 'JES3420') { cr.origen = 'AEP'; cr.destino = 'SLA'; }
      return Datos.normalizar(cr, cfg, T0);
    });
  }
  function tablaApi() {
    return [{ re: /aeroapi\/flights\/ARG1541/, archivo: 'aeroapi_flights_ARG1541.json' },
            { re: /aeroapi\/flights\/JES3420/, archivo: 'aeroapi_flights_JES3420.json' },
            { re: /aeroapi\/flights\//, archivo: 'aeroapi_flights_vacio.json' }];
  }
  function nuevoH(conf, tabla, opc, almacen) {
    var red = RF.crearRedFalsa(tabla || tablaApi(), opc);
    var cambios = { n: 0 };
    var h = Horarios.crear(conf, red, almacen === undefined ? RF.crearAlmacenMemoria() : almacen, function () { cambios.n++; });
    return { h: h, red: red, cambios: cambios };
  }

  t('instancia: pide por proxy, aplica a los crudos y completa origen/destino', function () {
    var x = nuevoH(cfgApi);
    var vs = vuelosDe(['ARG1541', 'JES3420', 'AZP401']);
    x.h.pedir(vs, T0);
    return x.h.drenar().then(function () {
      ok(x.red.llamadas.length === 3, 'pedidos ' + x.red.llamadas.length);
      var u = x.red.llamadas[0].url;
      ok(/\/api\/aeroapi\/flights\/ARG1541\?ident_type=designator&start=\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ&end=\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(u), u);
      var m = /start=([^&]+)&end=(.+)$/.exec(u);
      ok(Date.parse(m[1]) === T0 - 20 * 3600000 && Date.parse(m[2]) === T0 + 4 * 3600000, 'ventana -20h/+4h');
      ok(x.cambios.n >= 2, 'alActualizar ' + x.cambios.n);
      var c = { callsign: 'ARG1541', origen: null, destino: null };
      var c2 = { callsign: 'LVFVZ' };
      x.h.aplicar([c, c2], T0);
      ok(c.horarioApi && c.horarioApi.salidaRealMs === apiArg.salidaRealMs, 'horarioApi');
      ok(c.origen === 'AEP' && c.destino === 'ROS', 'completa origen/destino');
      ok(c2.horarioApi === undefined, 'LVFVZ no');
      var azp = { callsign: 'AZP401' }; x.h.aplicar([azp], T0);
      ok(azp.horarioApi === undefined, 'vacío no aplica');
      var i = x.h.info();
      ok(i.activo && i.usados === 3 && i.cupo === 30 && i.distintosHoy === 3 && i.cola === 0 && i.ultimoStatus === 200, JSON.stringify(i));
    });
  });
  t('instancia: segundo pedir → 0 pedidos nuevos (caché) y persiste entre instancias', function () {
    var almacen = RF.crearAlmacenMemoria();
    var x = nuevoH(cfgApi, null, null, almacen);
    var vs = vuelosDe(['ARG1541', 'JES3420']);
    x.h.pedir(vs, T0);
    return x.h.drenar().then(function () {
      ok(x.red.llamadas.length === 2, 'primera tanda');
      x.h.pedir(vs, T0 + 1000);
      return x.h.drenar();
    }).then(function () {
      ok(x.red.llamadas.length === 2, 'segunda tanda: ' + x.red.llamadas.length);
      x.h.guardarAhora();
      var y = nuevoH(cfgApi, null, null, almacen);
      var c = { callsign: 'ARG1541' }; y.h.aplicar([c], T0 + 5000);
      ok(c.horarioApi && c.horarioApi.destino === 'ROS', 'caché persistida');
      y.h.pedir(vs, T0 + 5000);
      return y.h.drenar().then(function () {
        ok(y.red.llamadas.length === 0, 'sin pedidos tras recargar');
        ok(y.h.info().usados === 2 && y.h.info().distintosHoy === 2, JSON.stringify(y.h.info()));
        var guardado = almacen.leer('tv.horarios.v1');
        ok(guardado.fecha === '2025-11-25' && guardado.c['ARG1541|2025-11-25'], 'formato de la persistencia');
      });
    });
  });
  t('instancia: cupo 2 con 3 vuelos → solo 2 pedidos; al cambiar la fecha usados=0', function () {
    var conf = clonar(cfgApi); conf.HORARIOS_CUPO_DIARIO = 2;
    var x = nuevoH(conf);
    var vs = vuelosDe(['ARG1541', 'JES3420', 'AZP401']);
    x.h.pedir(vs, T0);
    return x.h.drenar().then(function () {
      ok(x.red.llamadas.length === 2, 'pedidos ' + x.red.llamadas.length);
      ok(x.h.info().usados === 2 && x.h.info().cola === 0, JSON.stringify(x.h.info()));
      x.h.pedir(vs, T0 + 1000); return x.h.drenar();
    }).then(function () {
      ok(x.red.llamadas.length === 2, 'sigue en 2');
      x.h.pedir(vs, T0 + 25 * 3600000);
      var i = x.h.info();
      ok(i.usados === 0 && i.fecha === '2025-11-26' && i.distintosHoy === 3, 'fecha nueva ' + JSON.stringify(i));
      return x.h.drenar().then(function () { ok(x.red.llamadas.length === 4, 'dos pedidos más: ' + x.red.llamadas.length); });
    });
  });
  t('instancia: 429 → pausa de 10 min, se reencola y no se cachea', function () {
    var x = nuevoH(cfgApi, [{ re: /./, status: 429, texto: '{}' }]);
    x.h.pedir(vuelosDe(['ARG1541']), T0);
    return x.h.drenar().then(function () {
      var i = x.h.info();
      cerca(i.pausaHastaMs, T0 + 10 * 60000, 2000, 'pausa');
      ok(i.cola === 1 && i.ultimoStatus === 429, JSON.stringify(i));
      ok(x.red.llamadas.length === 1, 'un solo pedido');
      var c = { callsign: 'ARG1541' }; x.h.aplicar([c], T0); ok(!c.horarioApi, 'sin caché');
    });
  });
  t('instancia: 401 → bloqueadoHoy y no pide más; mañana se destraba', function () {
    var x = nuevoH(cfgApi, [{ re: /./, status: 401, texto: '{"error":"sin clave de horarios"}' }]);
    var vs = vuelosDe(['ARG1541', 'JES3420']);
    x.h.pedir(vs, T0);
    return x.h.drenar().then(function () {
      var i = x.h.info();
      ok(i.bloqueadoHoy === true && i.cola === 0 && x.red.llamadas.length === 1, JSON.stringify(i));
      x.h.pedir(vs, T0 + 60000); return x.h.drenar();
    }).then(function () {
      ok(x.red.llamadas.length === 1, 'no insiste');
      x.h.pedir(vs, T0 + 25 * 3600000);
      ok(x.h.info().bloqueadoHoy === false, 'al otro día se destraba');
    });
  });
  t('instancia: error de red o 5xx → solo en memoria 5 min, sin reconsultar', function () {
    var almacen = RF.crearAlmacenMemoria();
    var x = nuevoH(cfgApi, [{ re: /./, status: 503, texto: '' }], null, almacen);
    var vs = vuelosDe(['ARG1541']);
    x.h.pedir(vs, T0);
    return x.h.drenar().then(function () {
      x.h.pedir(vs, T0 + 60000); return x.h.drenar();
    }).then(function () {
      ok(x.red.llamadas.length === 1, 'dentro de 5 min no reconsulta');
      x.h.guardarAhora();
      var g = almacen.leer('tv.horarios.v1');
      ok(!g || !Object.keys(g.c).length, 'no se persiste el error');
      x.h.pedir(vs, T0 + 6 * 60000); return x.h.drenar();
    }).then(function () { ok(x.red.llamadas.length === 2, 'pasados 5 min reintenta'); });
  });
  t('instancia: 404 y respuesta vacía se cachean como null (18 h)', function () {
    var x = nuevoH(cfgApi, [{ re: /ARG1541/, status: 404, texto: '{}' }, { re: /./, archivo: 'aeroapi_flights_vacio.json' }]);
    var vs = vuelosDe(['ARG1541', 'AZP401']);
    x.h.pedir(vs, T0);
    return x.h.drenar().then(function () {
      x.h.pedir(vs, T0 + 8 * 3600000); return x.h.drenar();
    }).then(function () { ok(x.red.llamadas.length === 2, 'sin reconsulta a las 8 h'); });
  });
  t('instancia: SOLO_LOCAL filtra; los locales van primero', function () {
    var conf = clonar(cfgApi); conf.HORARIOS_SOLO_LOCAL = true;
    var x = nuevoH(conf);
    x.h.pedir(vuelosDe(['AZP401', 'JES3420', 'ARG1541']), T0);
    return x.h.drenar().then(function () {
      ok(x.red.llamadas.length === 1 && /ARG1541/.test(x.red.llamadas[0].url), 'solo ARG1541 (dest ROS): ' + x.red.llamadas.map(function (l) { return l.url; }));
      var y = nuevoH(cfgApi);
      y.h.pedir(vuelosDe(['AZP401', 'JES3420', 'ARG1541']), T0);
      return y.h.drenar().then(function () {
        ok(/ARG1541/.test(y.red.llamadas[0].url), 'el local primero: ' + y.red.llamadas[0].url);
        ok(y.red.llamadas.length === 3, 'sin SOLO_LOCAL pide los 3');
      });
    });
  });
  t('instancia: solo callsigns con formato y dentro de ENRIQ_MAX_POR_TICK', function () {
    var conf = clonar(cfgApi); conf.ENRIQ_MAX_POR_TICK = 2;
    var x = nuevoH(conf);
    x.h.pedir(vuelosDe(['LVFVZ', 'ARG1541', 'JES3420']), T0);
    return x.h.drenar().then(function () {
      ok(x.red.llamadas.length === 1 && /ARG1541/.test(x.red.llamadas[0].url), 'solo ARG1541: ' + x.red.llamadas.length);
    });
  });
  t('instancia: sin proxy → inactiva con motivo; modo calc → inactiva con motivo modo', function () {
    var x = nuevoH(cfgApi, null, { proxyBase: '' });
    x.h.pedir(vuelosDe(['ARG1541']), T0);
    var c = { callsign: 'ARG1541' }; x.h.aplicar([c], T0);
    return x.h.drenar().then(function () {
      var i = x.h.info();
      ok(i.activo === false && i.motivo === 'sin proxy' && x.red.llamadas.length === 0 && !c.horarioApi, JSON.stringify(i));
      ok(i.distintosHoy === 1, 'igual cuenta distintos');
      var y = nuevoH(cfg);
      y.h.pedir(vuelosDe(['ARG1541']), T0);
      var j = y.h.info();
      ok(j.activo === false && j.motivo === 'modo' && y.red.llamadas.length === 0, JSON.stringify(j));
    });
  });

  // ---------------- Red: headers de credenciales ----------------
  function redConHeaders(conf, url) {
    var tr = RF.crearTransporte([{ re: /./, status: 200, texto: '{}' }]);
    Red.usarTransporte(tr);
    Red.configurar(conf);
    return Red.pedirJSON({ url: url, headers: { 'x-otro': '1' } }).then(function () { return tr.llamadas[0].headers; });
  }
  t('Red: X-TV-AEROAPI-KEY solo con proxy local (nunca con la nube)', function () {
    var conf = clonar(cfg); conf.HORARIOS_KEY = 'secreta'; conf.ADSBLOL_KEY = 'kk'; conf.OPENSKY_CLIENT_ID = 'cid'; conf.OPENSKY_CLIENT_SECRET = 'sec';
    conf.PROXY = 'http://127.0.0.1:8080/api/';
    return redConHeaders(conf, 'http://127.0.0.1:8080/api/aeroapi/flights/ARG1541').then(function (h) {
      ok(h['X-TV-AEROAPI-KEY'] === 'secreta', 'local: ' + JSON.stringify(h));
      ok(h['x-otro'] === '1', 'conserva los headers del pedido');
      ok(h['X-TV-ADSBLOL-KEY'] === undefined && h['X-TV-OPENSKY-ID'] === undefined, 'solo las del servicio');
      ok(Red.esProxyLocal() === true, 'esProxyLocal');
      return redConHeaders(conf, 'http://127.0.0.1:8080/api/opensky/states/all');
    }).then(function (h) {
      ok(h['X-TV-OPENSKY-ID'] === 'cid' && h['X-TV-OPENSKY-SECRET'] === 'sec' && h['X-TV-AEROAPI-KEY'] === undefined, 'opensky ' + JSON.stringify(h));
      return redConHeaders(conf, 'http://127.0.0.1:8080/api/adsblol/v2/point/1/2/3');
    }).then(function (h) {
      ok(h['X-TV-ADSBLOL-KEY'] === 'kk', 'adsblol');
      conf.PROXY = 'https://tablero-vuelos-proxy.edisanto.workers.dev/api/';
      return redConHeaders(conf, conf.PROXY + 'aeroapi/flights/ARG1541');
    }).then(function (h) {
      ok(Red.esProxyLocal() === false, 'nube no es local');
      ok(Object.keys(h).every(function (k) { return !/^x-tv-/i.test(k); }), 'nube sin X-TV-*: ' + JSON.stringify(h));
      conf.PROXY = '';
      return redConHeaders(conf, 'https://aeroapi.flightaware.com/aeroapi/flights/ARG1541');
    }).then(function (h) {
      ok(Object.keys(h).every(function (k) { return !/^x-tv-/i.test(k); }), 'directo sin X-TV-*');
      conf.PROXY = 'http://127.0.0.1:8080/api/'; conf.HORARIOS_KEY = '';
      return redConHeaders(conf, 'http://127.0.0.1:8080/api/aeroapi/flights/ARG1541');
    }).then(function (h) {
      ok(h['X-TV-AEROAPI-KEY'] === undefined, 'clave vacía no viaja');
      ok(Red.BASES.aeroapi === 'https://aeroapi.flightaware.com/aeroapi/', 'BASES');
      Red.usarTransporte(null); Red.configurar(cfg);
    }, function (e) { Red.usarTransporte(null); throw e; });
  });

  // ---------------- Worker de Cloudflare ----------------
  function cargarWorker() {
    var src = fs.readFileSync(path.join(__dirname, '..', 'cloudflare', 'worker.js'), 'utf8').replace('export default', 'module.exports =');
    var m = { exports: {} };
    new Function('module', src)(m);
    return m.exports;
  }
  function llamarWorker(w, url, env, headers) {
    var pedidos = [];
    var fetchOrig = global.fetch;
    global.fetch = function (u, o) {
      pedidos.push({ url: String(u), headers: (o && o.headers) || {} });
      return Promise.resolve(new Response('{"flights":[]}', { status: 200, headers: { 'Content-Type': 'application/json' } }));
    };
    var req = new Request(url, { headers: headers || {} });
    return w.fetch(req, env).then(function (r) { global.fetch = fetchOrig; return { r: r, pedidos: pedidos }; },
      function (e) { global.fetch = fetchOrig; throw e; });
  }
  var ISO = 'start=2025-11-25T08:00:00Z&end=2025-11-25T18:00:00Z';
  t('Worker: aeroapi → upstream con x-apikey; query extra descartada', function () {
    var w = cargarWorker();
    return llamarWorker(w, 'https://w.example/api/aeroapi/flights/ARG1541?ident_type=designator&' + ISO + '&max_pages=9&foo=bar',
      { AEROAPI_KEY: 'sk' }, { 'X-TV-AEROAPI-KEY': 'otra' }).then(function (x) {
      ok(x.r.status === 200, 'status ' + x.r.status);
      ok(x.pedidos.length === 1, 'un upstream');
      var p = x.pedidos[0];
      ok(p.url === 'https://aeroapi.flightaware.com/aeroapi/flights/ARG1541?ident_type=designator&start=2025-11-25T08%3A00%3A00Z&end=2025-11-25T18%3A00%3A00Z', p.url);
      ok(p.headers['x-apikey'] === 'sk', 'x-apikey del secret, no del header del navegador');
      ok(!/max_pages|foo/.test(p.url), 'sin query extra');
    });
  });
  t('Worker: start/end inválidos se descartan; ruta rara → 400; sin secret → 401', function () {
    var w = cargarWorker();
    return llamarWorker(w, 'https://w.example/api/aeroapi/flights/ARG1541?start=ayer&end=2025-11-25T18:00:00.123Z', { AEROAPI_KEY: 'sk' }).then(function (x) {
      ok(x.pedidos[0].url.slice(-26) === 'flights/ARG1541?ident_type=designator'.slice(-26) || /ARG1541\?ident_type=designator$/.test(x.pedidos[0].url), x.pedidos[0].url);
      return llamarWorker(w, 'https://w.example/api/aeroapi/flights/../x?' + ISO, { AEROAPI_KEY: 'sk' });
    }).then(function (x) {
      ok(x.r.status === 400 && x.pedidos.length === 0, 'flights/../x → ' + x.r.status);
      return llamarWorker(w, 'https://w.example/api/aeroapi/flights/arg1541?' + ISO, { AEROAPI_KEY: 'sk' });
    }).then(function (x) {
      ok(x.r.status === 400, 'minúsculas → 400');
      return llamarWorker(w, 'https://w.example/api/aeroapi/flights/ARG1541/otra?' + ISO, { AEROAPI_KEY: 'sk' });
    }).then(function (x) {
      ok(x.r.status === 400, 'subruta → 400');
      return llamarWorker(w, 'https://w.example/api/aeroapi/flights/ARG1541?' + ISO, {}, { 'X-TV-AEROAPI-KEY': 'del-navegador' });
    }).then(function (x) {
      ok(x.r.status === 401 && x.pedidos.length === 0, 'sin secret → ' + x.r.status);
      return x.r.json();
    }).then(function (j) { ok(/sin clave/.test(j.error), j.error); });
  });
  t('Worker: los otros servicios siguen andando', function () {
    var w = cargarWorker();
    return llamarWorker(w, 'https://w.example/api/adsbdb/callsign/ARG1541', {}).then(function (x) {
      ok(x.r.status === 200 && x.pedidos[0].url === 'https://api.adsbdb.com/v0/callsign/ARG1541', x.pedidos[0].url);
      return llamarWorker(w, 'https://w.example/api/airplaneslive/point/-32.85/-60.78/19?x=1', {});
    }).then(function (x) {
      ok(x.pedidos[0].url === 'https://api.airplanes.live/v2/point/-32.85/-60.78/19?x=1', x.pedidos[0].url);
    });
  });

  // ---------------- proxy.py (modo fixtures, sin internet) ----------------
  function pedirHttp(puerto, ruta, headers) {
    return new Promise(function (resolve, reject) {
      var rq = http.get({ host: '127.0.0.1', port: puerto, path: ruta, headers: headers || {} }, function (rs) {
        var s = ''; rs.on('data', function (d) { s += d; }); rs.on('end', function () { resolve({ status: rs.statusCode, texto: s }); });
      });
      rq.on('error', reject);
      rq.setTimeout(5000, function () { rq.destroy(new Error('timeout')); });
    });
  }
  function conProxy(args, fn) {
    var puerto = 18000 + Math.floor(Math.random() * 1000);
    var env = Object.assign({}, process.env); delete env.AEROAPI_KEY;
    var p = cp.spawn('python3', ['-I', path.join(__dirname, '..', 'termux', 'proxy.py'), '--puerto', String(puerto)].concat(args),
      { stdio: ['ignore', 'pipe', 'pipe'], env: env });
    return new Promise(function (resolve, reject) {
      var listo = false;
      p.stdout.on('data', function (d) { if (!listo && /Proxy en/.test(String(d))) { listo = true; resolve(); } });
      p.on('error', reject);
      setTimeout(function () { if (!listo) reject(new Error('el proxy no arrancó')); }, 4000);
    }).then(function () { return fn(puerto); }).then(function (r) { p.kill(); return r; }, function (e) { p.kill(); throw e; });
  }
  t('proxy.py --fixtures: aeroapi devuelve el fixture por callsign, vacío para el resto, y filtra rutas', function () {
    return conProxy(['--fixtures', path.join(__dirname, 'fixtures')], function (pt) {
      return pedirHttp(pt, '/api/aeroapi/flights/ARG1541?ident_type=designator').then(function (r) {
        ok(r.status === 200 && JSON.parse(r.texto).flights.length === 2, 'ARG1541 ' + r.status);
        return pedirHttp(pt, '/api/aeroapi/flights/ZZZ999');
      }).then(function (r) {
        ok(r.status === 200 && JSON.parse(r.texto).flights.length === 0, 'vacío');
        return pedirHttp(pt, '/api/aeroapi/operators/ARG');
      }).then(function (r) { ok(r.status === 400, 'ruta no permitida → ' + r.status); });
    });
  });
  t('proxy.py sin clave: aeroapi responde 401 "sin clave de horarios" sin salir a internet', function () {
    return conProxy([], function (pt) {
      return pedirHttp(pt, '/api/aeroapi/flights/ARG1541').then(function (r) {
        ok(r.status === 401 && /sin clave de horarios/.test(r.texto), r.status + ' ' + r.texto);
      });
    });
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
