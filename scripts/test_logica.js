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
var fallas = 0;
res.forEach(function (r) {
  console.log((r.ok ? 'OK    ' : 'FALLA ') + r.nombre + (r.ok ? '' : '  -> ' + r.error));
  if (!r.ok) fallas++;
});
console.log(fallas ? fallas + ' test(s) fallaron' : 'Todo OK (' + res.length + ' tests)');
process.exit(fallas ? 1 : 0);
