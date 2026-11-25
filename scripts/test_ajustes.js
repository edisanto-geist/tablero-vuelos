// Tests de web/js/ajustes.js. Exporta correr() -> [{nombre, ok, error}] (sincrónico). Uso: node scripts/test_ajustes.js
var path = require('path');
var base = path.join(__dirname, '..', 'web', 'js');

// config.js define window.CONFIG; en node lo cargamos con un window falso.
function cargarConfig() {
  global.window = {};
  var ruta = path.join(base, 'config.js');
  delete require.cache[require.resolve(ruta)];
  require(ruta);
  var c = global.window.CONFIG;
  delete global.window;
  return c;
}

var Ajustes = require(path.join(base, 'ajustes.js'));

function clonar(o) { return JSON.parse(JSON.stringify(o)); }
function ok(c, m) { if (!c) throw new Error(m || 'falló'); }
function igual(a, b, m) {
  var x = JSON.stringify(a), y = JSON.stringify(b);
  if (x !== y) throw new Error((m || 'distinto') + ': ' + x + ' != ' + y);
}
function cerca(a, b, tol, m) {
  if (!(Math.abs(a - b) <= tol)) throw new Error((m || 'valor') + ': ' + a + ' no está en ' + b + ' ± ' + tol);
}

function almacenFalso() {
  var m = {};
  return {
    leer: function (k) { return Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null; },
    escribir: function (k, t) { m[k] = t; return true; },
    borrar: function (k) { delete m[k]; },
    _m: m
  };
}

function correr() {
  var res = [];
  function t(nombre, fn) {
    try { fn(); res.push({ nombre: 'ajustes: ' + nombre, ok: true }); }
    catch (e) { res.push({ nombre: 'ajustes: ' + nombre, ok: false, error: e && e.message || String(e) }); }
  }

  t('el ESQUEMA cubre las claves de config.js y sus rutas existen', function () {
    var cfg = cargarConfig();
    Ajustes.ESQUEMA.forEach(function (d) {
      ok(Ajustes.obtener(cfg, d.ruta) !== undefined || d.ruta === 'HORARIOS_KEY', 'no existe en config.js: ' + d.ruta);
    });
    ['HORARIOS_MODO', 'HORARIOS_API', 'HORARIOS_CUPO_DIARIO', 'HORARIOS_SOLO_LOCAL', 'HORARIOS_ESPACIADO_MS',
     'HORARIOS_KEY', 'ZONA_UTC_MIN', 'ALTERNAR_L3_S'].forEach(function (k) { ok(k in cfg, 'falta ' + k); });
    igual(cfg.HORARIOS_MODO, 'calc'); igual(cfg.ZONA_UTC_MIN, -180); igual(cfg.ALTERNAR_L3_S, 4);
  });

  t('cada valor por defecto de config.js es válido para su campo', function () {
    var cfg = cargarConfig();
    Ajustes.ESQUEMA.forEach(function (d) {
      var v = Ajustes.obtener(cfg, d.ruta);
      if (v === undefined) return;
      var r = Ajustes.validarCampo(d, v);
      ok(r.ok, d.ruta + ': ' + r.error);
    });
  });

  t('prioridad base < local < guardado', function () {
    var cfg = cargarConfig();
    igual(cfg.RADIO_KM, 30);
    Object.assign(cfg, { RADIO_KM: 40, VOLUMEN: 0.5 });          // config.local.js
    var r = Ajustes.aplicar(cfg, { RADIO_KM: 55 });                // localStorage
    igual(cfg.RADIO_KM, 55); igual(cfg.VOLUMEN, 0.5);
    igual(r.aplicados, ['RADIO_KM']);
  });

  t('LIMITES.opensky.CUPO_DIARIO no pisa LIMITES.adsbfi', function () {
    var cfg = cargarConfig();
    var antes = clonar(cfg.LIMITES);
    Ajustes.aplicar(cfg, { 'LIMITES.opensky.CUPO_DIARIO': 1234 });
    igual(cfg.LIMITES.opensky.CUPO_DIARIO, 1234);
    igual(cfg.LIMITES.opensky.REPOSO_S, antes.opensky.REPOSO_S);
    igual(cfg.LIMITES.adsbfi, antes.adsbfi);
    igual(cfg.LIMITES.adsblol, antes.adsblol);
  });

  t('un valor fuera de rango se rechaza y no se aplica', function () {
    var cfg = cargarConfig();
    var r = Ajustes.aplicar(cfg, { RADIO_KM: 9999, VOLUMEN: 2, FILAS_POR_PAGINA: 5, ORIENTACION_PANTALLA_DEG: 360 });
    igual(cfg.RADIO_KM, 30); igual(cfg.VOLUMEN, 0.8); igual(cfg.FILAS_POR_PAGINA, 2); igual(cfg.ORIENTACION_PANTALLA_DEG, 0);
    igual(r.aplicados.length, 0); igual(r.rechazados.length, 4);
  });

  t('una ruta desconocida se ignora', function () {
    var cfg = cargarConfig();
    var copia = clonar(cfg);
    var r = Ajustes.aplicar(cfg, { NO_EXISTE: 1, 'LIMITES.adsbfi.CUPO_DIARIO': 5, '__proto__.x': 1, 'a.b.c': 2 });
    igual(cfg, copia);
    igual(r.aplicados.length, 0);
    ok(({}).x === undefined, 'contaminó el prototipo');
    var v = Ajustes.validar({ NO_EXISTE: 1 });
    ok(!v.ok && v.errores.NO_EXISTE, 'validar debía marcar error');
  });

  t('aplicar con basura no tira excepción', function () {
    var cfg = cargarConfig();
    [null, undefined, 5, 'x', [], [1, 2], true, { RADIO_KM: null }, { RADIO_KM: {} }, { PROVEEDORES: 'adsbfi' },
     { HORARIO_SILENCIO: 7 }, { NOMBRE_LUGAR: 12 }].forEach(function (b) {
      Ajustes.aplicar(cfg, b);
      Ajustes.validar(b);
    });
    Ajustes.aplicar(null, { RADIO_KM: 5 });
    Ajustes.aplicar(undefined, null);
    var alm = { leer: function () { return '{no es json'; }, escribir: function () { throw new Error('x'); }, borrar: function () { throw new Error('y'); } };
    igual(Ajustes.leer(alm), {});
    igual(Ajustes.guardar(alm, { RADIO_KM: 5 }), false);
    igual(cfg.RADIO_KM, 30);
  });

  t('diferencias devuelve solo lo que cambió', function () {
    var cfg = cargarConfig();
    var d = Ajustes.diferencias(cfg, {
      RADIO_KM: 30, VOLUMEN: 0.5, PROVEEDORES: ['adsbfi', 'adsblol', 'opensky', 'airplaneslive'],
      HORARIO_SILENCIO: { hasta: '07:00', desde: '23:00' }, FRANJA_LENTA: { desde: '01:00', hasta: '05:30', INTERVALO_S: 90 },
      'LIMITES.opensky.CUPO_DIARIO': 400, 'LIMITES.adsblol.CUPO_DIARIO': 100
    });
    igual(Object.keys(d).sort(), ['FRANJA_LENTA', 'LIMITES.adsblol.CUPO_DIARIO', 'VOLUMEN']);
  });

  t('exportar sin sensibles no incluye HORARIOS_KEY; importar(exportar(x)) devuelve lo mismo', function () {
    var x = { RADIO_KM: 45, NOMBRE_LUGAR: 'FUNES', HORARIO_SILENCIO: null, PROVEEDORES: ['adsblol', 'adsbfi'], HORARIOS_KEY: 'secreto', ADSBLOL_KEY: 'otro' };
    var txt = Ajustes.exportar(x, { incluirSensibles: false });
    ok(txt.indexOf('HORARIOS_KEY') < 0 && txt.indexOf('secreto') < 0 && txt.indexOf('ADSBLOL_KEY') < 0, 'se coló una clave');
    ok(txt.indexOf('"tablero-vuelos"') >= 0);
    var sin = clonar(x); delete sin.HORARIOS_KEY; delete sin.ADSBLOL_KEY;
    var im = Ajustes.importar(txt);
    ok(im.ok, 'importar falló: ' + JSON.stringify(im.errores));
    igual(im.valores, sin);
    var con = Ajustes.importar(Ajustes.exportar(x, { incluirSensibles: true }));
    ok(con.ok); igual(con.valores, x);
    var pelado = Ajustes.importar(JSON.stringify({ RADIO_KM: 20 }));
    ok(pelado.ok); igual(pelado.valores, { RADIO_KM: 20 });
    ok(!Ajustes.importar('basura').ok);
    ok(!Ajustes.importar('{"RADIO_KM":1}').ok);
    ok(!Ajustes.importar('[1]').ok);
  });

  t('PROVEEDORES vacío, repetido o desconocido da error', function () {
    var d = Ajustes.PORRUTA.PROVEEDORES;
    ok(!Ajustes.validarCampo(d, []).ok);
    ok(!Ajustes.validarCampo(d, ['adsbfi', 'adsbfi']).ok);
    ok(!Ajustes.validarCampo(d, ['adsbfi', 'flightradar']).ok);
    ok(!Ajustes.validarCampo(d, 'adsbfi').ok);
    var r = Ajustes.validarCampo(d, ['opensky', 'adsbfi']);
    ok(r.ok); igual(r.valor, ['opensky', 'adsbfi']);
    ok(!Ajustes.validar({ PROVEEDORES: [] }).ok);
  });

  t('nombre del lugar: tildes y mayúsculas', function () {
    var d = Ajustes.PORRUTA.NOMBRE_LUGAR;
    igual(Ajustes.validarCampo(d, 'Fúnes sur').valor, 'FUNES SUR');
    igual(Ajustes.validarCampo(d, 'Cañada').valor, 'CAÑADA');
    ok(!Ajustes.validarCampo(d, '').ok);
    ok(!Ajustes.validarCampo(d, 'DEMASIADO LARGO PARA EL TABLERO').ok);
    ok(!Ajustes.validarCampo(d, 'A<B').ok);
    ok(Ajustes.validarCampo(Ajustes.PORRUTA.AEROPUERTO_LOCAL, '').ok);
    igual(Ajustes.validarCampo(Ajustes.PORRUTA.AEROPUERTO_LOCAL, 'ros').valor, 'ROS');
    ok(!Ajustes.validarCampo(Ajustes.PORRUTA.AEROPUERTO_LOCAL, 'ROSA').ok);
  });

  t('campos: ubicación, franjas, claves, proxy, enum numérico', function () {
    var P = Ajustes.PORRUTA;
    igual(Ajustes.validarCampo(P.LAT, '-32.123456789').valor, -32.12346);
    ok(!Ajustes.validarCampo(P.LAT, 91).ok); ok(!Ajustes.validarCampo(P.LON, 'abc').ok); ok(!Ajustes.validarCampo(P.LON, '').ok);
    igual(Ajustes.validarCampo(P.FILAS_POR_PAGINA, '3').valor, 3);
    ok(!Ajustes.validarCampo(P.FILAS_POR_PAGINA, 4).ok);
    ok(Ajustes.validarCampo(P.HORARIO_SILENCIO, null).ok);
    ok(!Ajustes.validarCampo(P.HORARIO_SILENCIO, { desde: '25:00', hasta: '07:00' }).ok);
    ok(!Ajustes.validarCampo(P.HORARIO_SILENCIO, { desde: '07:00', hasta: '07:00' }).ok);
    ok(!Ajustes.validarCampo(P.FRANJA_LENTA, { desde: '01:00', hasta: '05:00', INTERVALO_S: 5 }).ok);
    igual(Ajustes.validarCampo(P.FRANJA_LENTA, { desde: '01:00', hasta: '05:00', INTERVALO_S: '60' }).valor, { desde: '01:00', hasta: '05:00', INTERVALO_S: 60 });
    igual(Ajustes.validarCampo(P.HORARIOS_KEY, '  abc  ').valor, 'abc');
    ok(!Ajustes.validarCampo(P.HORARIOS_KEY, new Array(202).join('a')).ok);
    ['auto', '', 'http://127.0.0.1:8080/api/', 'https://x.workers.dev/api'].forEach(function (u) { ok(Ajustes.validarCampo(P.PROXY, u).ok, u); });
    ['ftp://x/api/', 'http://x/otra'].forEach(function (u) { ok(!Ajustes.validarCampo(P.PROXY, u).ok, u); });
    ok(!Ajustes.validarCampo(P.ANIMAR, 'si').ok);
    ok(!Ajustes.validarCampo(P.HORARIOS_MODO, 'otro').ok);
  });

  t('aviso (no bloquea): ALTERNAR_L3_S >= SEGUNDOS_POR_PAGINA', function () {
    var v = Ajustes.validar({ ALTERNAR_L3_S: 10, SEGUNDOS_POR_PAGINA: 8 });
    ok(v.ok && v.avisos.ALTERNAR_L3_S);
    ok(!Ajustes.validar({ ALTERNAR_L3_S: 4, SEGUNDOS_POR_PAGINA: 8 }).avisos.ALTERNAR_L3_S);
    ok(!Ajustes.validar({ ALTERNAR_L3_S: 0, SEGUNDOS_POR_PAGINA: 3 }).avisos.ALTERNAR_L3_S);
  });

  t('guardar/leer/borrar con almacén falso; solo diferencias; info', function () {
    var alm = almacenFalso();
    igual(Ajustes.leer(alm), {});
    ok(Ajustes.guardar(alm, { RADIO_KM: 50, NOMBRE_LUGAR: 'FUNES' }));
    ok(JSON.parse(alm._m['tv.ajustes.v1']).v === 1);
    igual(Ajustes.leer(alm), { RADIO_KM: 50, NOMBRE_LUGAR: 'FUNES' });
    ok(Ajustes.guardar(alm, {}));
    ok(!('tv.ajustes.v1' in alm._m), 'sin diferencias debía borrar la clave');
    Ajustes.guardar(alm, { RADIO_KM: 50 }); Ajustes.borrar(alm);
    igual(Ajustes.leer(alm), {});
    alm._m['tv.ajustes.v1'] = JSON.stringify({ v: 2, valores: { RADIO_KM: 5 } });
    igual(Ajustes.leer(alm), {});
    var i = Ajustes.info();
    ok(typeof i.guardados === 'number' && typeof i.aplicados === 'number' && typeof i.rechazados === 'number' && 'guardadoMs' in i);
    igual(Ajustes.CLAVE, 'tv.ajustes.v1');
  });

  t('promedioCircular([350,10,5]) ≈ 1,67 con r > 0,98', function () {
    var p = Ajustes.promedioCircular([350, 10, 5]);
    cerca(p.media, 1.67, 0.1, 'media'); ok(p.r > 0.98, 'r=' + p.r);
    var q = Ajustes.promedioCircular([0, 180]);
    ok(q.r < 0.01);
    igual(Ajustes.promedioCircular([]).media, null);
    cerca(Ajustes.promedioCircular([90, 90]).media, 90, 0.001);
  });

  t('cardinalAGrados', function () {
    igual(Ajustes.cardinalAGrados('SO'), 225); igual(Ajustes.cardinalAGrados('N'), 0);
    igual(Ajustes.cardinalAGrados('NO'), 315); igual(Ajustes.cardinalAGrados('o'), 270);
    igual(Ajustes.cardinalAGrados('X'), null);
  });

  t('rumboDesdeEvento', function () {
    igual(Ajustes.rumboDesdeEvento({ absolute: true, alpha: 90 }), 270);
    igual(Ajustes.rumboDesdeEvento({ webkitCompassHeading: 42 }), 42);
    igual(Ajustes.rumboDesdeEvento({ alpha: 90 }), null);
    igual(Ajustes.rumboDesdeEvento({ absolute: true, alpha: 0 }), 0);
    igual(Ajustes.rumboDesdeEvento({ type: 'deviceorientationabsolute', alpha: 350 }), 10);
    igual(Ajustes.rumboDesdeEvento({ absolute: false, alpha: 90 }), null);
    igual(Ajustes.rumboDesdeEvento(null), null);
  });

  return res;
}

module.exports = { correr: correr };
if (require.main === module) {
  var r = correr();
  var f = 0;
  r.forEach(function (x) { console.log((x.ok ? 'OK    ' : 'FALLA ') + x.nombre + (x.ok ? '' : '  -> ' + x.error)); if (!x.ok) f++; });
  console.log(f ? f + ' test(s) fallaron' : 'Todo OK (' + r.length + ' tests)');
  process.exit(f ? 1 : 0);
}
