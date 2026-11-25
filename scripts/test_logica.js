// Uso: node scripts/test_logica.js   (exit 0 si todo OK)
var path = require('path');
var base = path.join(__dirname, '..', 'web', 'js');
var Geo = require(path.join(base, 'geo.js'));
var Aerolineas = require(path.join(base, 'aerolineas.js'));
var Datos = require(path.join(base, 'datos.js'));
var Formato = require(path.join(base, 'formato.js'));
var Tests = require(path.join(base, 'tests.js'));

// config.js define window.CONFIG; en node lo cargamos con un window falso.
global.window = {};
require(path.join(base, 'config.js'));
var CONFIG = global.window.CONFIG;
delete global.window;

var res = Tests.correr(Geo, Aerolineas, Datos, Formato, CONFIG);
function imprimir(res) {
  var fallas = 0;
  res.forEach(function (r) {
    console.log((r.ok ? 'OK    ' : 'FALLA ') + r.nombre + (r.ok ? '' : '  -> ' + r.error));
    if (!r.ok) fallas++;
  });
  return fallas;
}

// Fase 1 (síncrono) → Fase 2 (promesas, red falsa) → horarios → ajustes (solo si existe test_ajustes.js).
var fallas = imprimir(res);
var total = res.length;
var fs = require('fs');
function etapa(nombre, fn) {
  return function () {
    return Promise.resolve().then(fn).then(function (r) {
      fallas += imprimir(r); total += r.length;
    }, function (e) {
      console.log('FALLA ' + nombre + ' no pudo correr  -> ' + (e && e.stack || e));
      fallas++;
    });
  };
}
var cadena = Promise.resolve()
  .then(etapa('test_fase2', function () { return require('./test_fase2.js').correr(); }))
  .then(etapa('test_horarios', function () { return require('./test_horarios.js').correr(); }));
if (fs.existsSync(path.join(__dirname, 'test_ajustes.js'))) {
  cadena = cadena.then(etapa('test_ajustes', function () { return require('./test_ajustes.js').correr(); }));
}
cadena.then(function () {
  console.log(fallas ? fallas + ' test(s) fallaron' : 'Todo OK (' + total + ' tests)');
  process.exit(fallas ? 1 : 0);
});
