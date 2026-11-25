// Red falsa para tests: transporte de Red.usarTransporte, "red" mínima para Enriquecer y almacén en memoria.
var fs = require('fs');
var path = require('path');
var DIR_FIXTURES = path.join(__dirname, 'fixtures');

function leerFixture(nombre) { return fs.readFileSync(path.join(DIR_FIXTURES, nombre), 'utf8'); }

// tabla: [{re:RegExp, status, archivo|texto, headers, demoraMs}]. La primera que coincide gana.
// Sin coincidencia: status 0 (equivale a error de red).
function crearTransporte(tabla) {
  var fn = function (opciones) {
    var url = String(opciones.url);
    var metodo = opciones.metodo || 'GET';
    fn.llamadas.push({ url: url, metodo: metodo, headers: opciones.headers || {}, cuerpo: opciones.cuerpo || null });
    var regla = null;
    for (var i = 0; i < fn.tabla.length; i++) {
      if (fn.tabla[i].re.test(url)) { regla = fn.tabla[i]; break; }
    }
    return new Promise(function (resolve) {
      var salir = function () {
        if (!regla) { resolve({ status: 0, texto: '', headers: {} }); return; }
        var texto = regla.texto !== undefined ? regla.texto : (regla.archivo ? leerFixture(regla.archivo) : '');
        var headers = {};
        Object.keys(regla.headers || {}).forEach(function (k) { headers[k.toLowerCase()] = String(regla.headers[k]); });
        resolve({ status: regla.status === undefined ? 200 : regla.status, texto: texto, headers: headers });
      };
      if (regla && regla.demoraMs) setTimeout(salir, regla.demoraMs); else salir();
    });
  };
  fn.llamadas = [];
  fn.tabla = tabla || [];
  return fn;
}

// Objeto con la forma mínima que usa Enriquecer: {url(servicio, ruta), pedirJSON(opts)}.
// opciones.proxyBase: lo que devuelve proxyBase() (por defecto '/api/', como con el proxy de Termux; '' = sin proxy).
function crearRedFalsa(tabla, opciones) {
  var transporte = crearTransporte(tabla);
  var proxy = opciones && opciones.proxyBase !== undefined ? opciones.proxyBase : '/api/';
  return {
    transporte: transporte,
    llamadas: transporte.llamadas,
    proxyBase: function () { return proxy; },
    url: function (servicio, ruta) {
      if (servicio === 'aeroapi') return (proxy ? proxy + 'aeroapi/' : 'https://aeroapi.flightaware.com/aeroapi/') + ruta;
      return 'https://api.adsbdb.com/v0/' + ruta;
    },
    pedirJSON: function (opts) {
      var t0 = Date.now();
      return transporte(opts).then(function (r) {
        var json = null, error = null;
        try { json = r.texto ? JSON.parse(r.texto) : null; } catch (e) { json = null; error = 'json'; }
        var ok = r.status >= 200 && r.status < 300;
        if (r.status === 0) error = 'red'; else if (!ok) error = 'http';
        return { ok: ok && !error, status: r.status, error: error, json: json, ms: Date.now() - t0,
                 header: function (n) { var v = r.headers[String(n).toLowerCase()]; return v === undefined ? null : v; } };
      });
    }
  };
}

function crearAlmacenMemoria() {
  var datos = {};
  return {
    datos: datos,
    leer: function (clave) { return Object.prototype.hasOwnProperty.call(datos, clave) ? JSON.parse(datos[clave]) : null; },
    escribir: function (clave, obj) { datos[clave] = JSON.stringify(obj); return true; }
  };
}

module.exports = {
  leerFixture: leerFixture,
  leerJSON: function (n) { return JSON.parse(leerFixture(n)); },
  crearTransporte: crearTransporte,
  crearRedFalsa: crearRedFalsa,
  crearAlmacenMemoria: crearAlmacenMemoria
};
