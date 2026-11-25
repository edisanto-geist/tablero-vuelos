// Ajustes del celu: lo que se cambia desde config.html y se guarda en localStorage.
// Prioridad: config.js < config.local.js < localStorage 'tv.ajustes.v1' < parámetros de URL (app.js).
// Se guardan solo las DIFERENCIAS con la base (config.js + config.local.js).
// Módulo puro (testeable en node); al cargarse en el navegador aplica lo guardado sobre CONFIG.
(function (raiz) {
  'use strict';

  var CLAVE = 'tv.ajustes.v1';
  var RE_HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
  var PROVEEDORES_OK = ['adsbfi', 'adsblol', 'opensky', 'airplaneslive'];

  var GRUPOS = ['UBICACIÓN', 'ORIENTACIÓN', 'TABLERO', 'SONIDO', 'HORARIOS', 'DATOS', 'CLAVES', 'AVANZADO'];

  function d(ruta, grupo, etiqueta, tipo, extra, ayuda) {
    var o = { ruta: ruta, grupo: grupo, etiqueta: etiqueta, ayuda: ayuda || '', tipo: tipo,
              min: null, max: null, paso: null, opciones: null, sensible: false };
    if (extra) for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) o[k] = extra[k];
    return o;
  }

  var G = GRUPOS;
  var ESQUEMA = [
    // Ubicación
    d('LAT', G[0], 'Latitud', 'num', { min: -90, max: 90, paso: 0.00001, dec: 5 }, 'Centro del radio. Negativa = hemisferio sur.'),
    d('LON', G[0], 'Longitud', 'num', { min: -180, max: 180, paso: 0.00001, dec: 5 }, 'Negativa = al oeste de Greenwich.'),
    d('NOMBRE_LUGAR', G[0], 'Nombre del lugar', 'texto', { largoMin: 1, largoMax: 14, mayus: true, patron: '^[A-Z0-9 Ñ.\'-]+$' },
      'Sale en el título: CIELO DE ... Hasta 14 letras, en mayúsculas.'),
    d('AEROPUERTO_LOCAL', G[0], 'Aeropuerto local (IATA)', 'texto', { largoMin: 0, largoMax: 3, mayus: true, patron: '^([A-Z]{3})?$' },
      'Tres letras, por ejemplo ROS. Vacío = ninguno.'),
    // Orientación
    d('ORIENTACION_PANTALLA_DEG', G[1], 'Hacia dónde mirás (grados)', 'entero', { min: 0, max: 359, paso: 1 },
      'Rumbo hacia el que mira una persona parada frente al tablero. 0 = norte, 90 = este.'),
    // Tablero
    d('RADIO_KM', G[2], 'Radio (km)', 'num', { min: 5, max: 150, paso: 1, dec: 1 }, 'Se enciende con aviones dentro de este radio.'),
    d('FILAS_POR_PAGINA', G[2], 'Vuelos por pantalla', 'enum', { opciones: [2, 3] }, '2 se lee más grande; 3 entran más vuelos.'),
    d('SEGUNDOS_POR_PAGINA', G[2], 'Segundos por pantalla', 'entero', { min: 3, max: 60, paso: 1 }, 'Cada cuánto pasa de página si hay muchos vuelos.'),
    d('ALTERNAR_L3_S', G[2], 'Alternar datos cada (s)', 'entero', { min: 0, max: 30, paso: 1 }, 'La 3ª línea alterna entre datos técnicos y horarios. 0 = no alterna.'),
    d('ANIMAR', G[2], 'Animación flap', 'bool', null, 'El efecto de letras que giran. Apagalo si el celu va lento.'),
    d('UNIDAD_ALTITUD', G[2], 'Unidad de altitud', 'enum', { opciones: ['m', 'ft'] }, 'Metros o pies.'),
    d('TIMEOUT_SIN_AVIONES_S', G[2], 'Apagar tras (s) sin aviones', 'entero', { min: 20, max: 1800, paso: 10 }, 'Después de este tiempo vuelve a negro.'),
    d('INCLUIR_EN_TIERRA', G[2], 'Mostrar aviones en tierra', 'bool', null, 'Incluye los que están carreteando o estacionados.'),
    d('DIST_ENCIMA_KM', G[2], 'Distancia "encima" (km)', 'num', { min: 0.5, max: 10, paso: 0.5, dec: 1 }, 'Dentro de esta distancia dice SOBRE TU CASA.'),
    // Sonido
    d('VOLUMEN', G[3], 'Volumen', 'num', { min: 0, max: 1, paso: 0.05, dec: 2 }, '0 = mudo, 1 = al máximo.'),
    d('HORARIO_SILENCIO', G[3], 'Horario de silencio', 'franja', null, 'En esta franja no suena el beep (el tablero sigue funcionando).'),
    d('BEEP_MIN_ENTRE_S', G[3], 'Mínimo entre beeps (s)', 'entero', { min: 0, max: 600, paso: 1 }, 'Para que no suene seguido.'),
    d('REBEEP_VUELO_S', G[3], 'Repetir beep del mismo vuelo (s)', 'entero', { min: 30, max: 3600, paso: 10 }, 'Si el mismo avión sigue en el radio, vuelve a sonar pasado este tiempo.'),
    // Horarios
    d('HORARIOS_MODO', G[4], 'Horarios de salida y llegada', 'enum', { opciones: ['no', 'calc', 'api'] },
      'no = no mostrar; calc = calculado (con ~); api = de una API (necesita proxy y clave).'),
    d('HORARIOS_API', G[4], 'API de horarios', 'enum', { opciones: ['aeroapi'] }, 'Por ahora solo FlightAware AeroAPI.'),
    d('HORARIOS_CUPO_DIARIO', G[4], 'Consultas por día a la API', 'entero', { min: 0, max: 500, paso: 1 }, '30 por día entran en los US$5 gratis al mes.'),
    d('HORARIOS_SOLO_LOCAL', G[4], 'Pedir solo vuelos locales', 'bool', null, 'Solo pide horarios de vuelos que salen o llegan al aeropuerto local.'),
    d('ZONA_UTC_MIN', G[4], 'Zona horaria (min vs UTC)', 'entero', { min: -720, max: 840, paso: 30 }, 'Argentina: -180 (UTC-3).'),
    // Datos
    d('PROVEEDOR', G[5], 'Modo de proveedor', 'enum', { opciones: ['auto', 'adsbfi', 'adsblol', 'opensky', 'airplaneslive'] },
      'auto = usa la lista de abajo con respaldo; o uno fijo, sin respaldo.'),
    d('PROVEEDORES', G[5], 'Orden de proveedores', 'lista', { opciones: PROVEEDORES_OK }, 'El primero tildado se prueba primero; los demás son respaldo.'),
    d('INTERVALO_REPOSO_S', G[5], 'Consulta en reposo (s)', 'entero', { min: 5, max: 600, paso: 1 }, 'Cada cuánto mira el cielo cuando no hay aviones.'),
    d('INTERVALO_ACTIVO_S', G[5], 'Consulta con aviones (s)', 'entero', { min: 5, max: 300, paso: 1 }, 'Cada cuánto actualiza cuando hay aviones.'),
    d('FRANJA_LENTA', G[5], 'Franja de consulta lenta', 'franjaLenta', null, 'De madrugada consulta más espaciado para ahorrar cupo.'),
    d('LIMITES.adsblol.REPOSO_S', G[5], 'adsb.lol: reposo (s)', 'entero', { min: 5, max: 3600, paso: 1 }),
    d('LIMITES.adsblol.ACTIVO_S', G[5], 'adsb.lol: activo (s)', 'entero', { min: 5, max: 3600, paso: 1 }),
    d('LIMITES.adsblol.CUPO_DIARIO', G[5], 'adsb.lol: cupo diario', 'entero', { min: 0, max: 100000, paso: 1 }, '0 = sin cupo.'),
    d('LIMITES.opensky.REPOSO_S', G[5], 'OpenSky: reposo (s)', 'entero', { min: 5, max: 3600, paso: 1 }),
    d('LIMITES.opensky.ACTIVO_S', G[5], 'OpenSky: activo (s)', 'entero', { min: 5, max: 3600, paso: 1 }),
    d('LIMITES.opensky.CUPO_DIARIO', G[5], 'OpenSky: cupo diario', 'entero', { min: 0, max: 100000, paso: 1 }, '0 = sin cupo.'),
    d('ENRIQUECER', G[5], 'Buscar ruta y tipo de avión', 'bool', null, 'Pide origen, destino y modelo a adsbdb.'),
    // Claves
    d('ADSBLOL_KEY', G[6], 'Clave de adsb.lol', 'clave', { sensible: true }),
    d('OPENSKY_CLIENT_ID', G[6], 'OpenSky: client id', 'clave', { sensible: true }),
    d('OPENSKY_CLIENT_SECRET', G[6], 'OpenSky: client secret', 'clave', { sensible: true }),
    d('HORARIOS_KEY', G[6], 'Clave de horarios (AeroAPI)', 'clave', { sensible: true }),
    // Avanzado
    d('PROXY', G[7], 'Proxy', 'texto', { largoMin: 0, largoMax: 200, patron: '^(auto|https?://\\S+/api/?)?$' },
      'auto, vacío (directo) o una URL que termine en /api/.'),
    d('TIMEOUT_RED_S', G[7], 'Tiempo máximo de red (s)', 'entero', { min: 2, max: 30, paso: 1 })
  ];

  var PORRUTA = {};
  (function () { for (var i = 0; i < ESQUEMA.length; i++) PORRUTA[ESQUEMA[i].ruta] = ESQUEMA[i]; })();

  var estado = { aplicados: 0, rechazados: 0, guardadoMs: 0, guardados: 0, listaAplicados: [], listaRechazados: [] };

  function esObj(x) { return x !== null && typeof x === 'object' && !Array.isArray(x); }
  function tiene(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function rutaSegura(ruta) {
    if (typeof ruta !== 'string' || !ruta) return null;
    var p = ruta.split('.');
    for (var i = 0; i < p.length; i++) {
      if (!p[i] || p[i] === '__proto__' || p[i] === 'constructor' || p[i] === 'prototype') return null;
    }
    return p;
  }

  function obtener(config, ruta) {
    var p = rutaSegura(ruta);
    if (!p || !config) return undefined;
    var x = config;
    for (var i = 0; i < p.length; i++) {
      if (x === null || typeof x !== 'object' || !tiene(x, p[i])) return undefined;
      x = x[p[i]];
    }
    return x;
  }

  function poner(config, ruta, valor) {
    var p = rutaSegura(ruta);
    if (!p || !config) return false;
    var x = config;
    for (var i = 0; i < p.length - 1; i++) {
      if (!esObj(x[p[i]])) x[p[i]] = {};
      x = x[p[i]];
    }
    x[p[p.length - 1]] = valor;
    return true;
  }

  function quitarTildes(s) {
    var t = String(s).toUpperCase().replace(/Ñ/g, '\u0001');
    try { t = t.normalize('NFD').replace(/[̀-ͯ]/g, ''); } catch (e) { /* sin normalize */ }
    return t.replace(/\u0001/g, 'Ñ');
  }

  function aNumero(v) {
    if (typeof v === 'string' && v.trim() !== '') v = Number(v.trim().replace(',', '.'));
    return (typeof v === 'number' && isFinite(v)) ? v : null;
  }

  function rangoTxt(desc) { return 'Entre ' + desc.min + ' y ' + desc.max + '.'; }
  function mal(msg) { return { ok: false, valor: undefined, error: msg }; }
  function bien(v) { return { ok: true, valor: v, error: '' }; }

  function validarHora(h) { return typeof h === 'string' && RE_HORA.test(h); }

  function validarCampo(desc, valor) {
    if (!desc) return mal('Campo desconocido.');
    var t = desc.tipo;
    var n, i;
    if (t === 'num') {
      n = aNumero(valor);
      if (n === null) return mal('Tiene que ser un número.');
      if (n < desc.min || n > desc.max) return mal(rangoTxt(desc));
      if (desc.dec !== undefined && desc.dec !== null) { var f = Math.pow(10, desc.dec); n = Math.round(n * f) / f; }
      return bien(n);
    }
    if (t === 'entero') {
      n = aNumero(valor);
      if (n === null || Math.floor(n) !== n) return mal('Tiene que ser un número entero.');
      if (n < desc.min || n > desc.max) return mal(rangoTxt(desc));
      return bien(n);
    }
    if (t === 'bool') {
      if (typeof valor !== 'boolean') return mal('Tiene que ser sí o no.');
      return bien(valor);
    }
    if (t === 'enum') {
      for (i = 0; i < desc.opciones.length; i++) {
        if (valor !== null && valor !== undefined && String(desc.opciones[i]) === String(valor)) return bien(desc.opciones[i]);
      }
      return mal('Opción no válida (' + desc.opciones.join(', ') + ').');
    }
    if (t === 'texto') {
      if (typeof valor !== 'string') return mal('Tiene que ser texto.');
      var s = valor.trim();
      if (desc.mayus) s = quitarTildes(s);
      if (s.length < (desc.largoMin || 0)) return mal('No puede estar vacío.');
      if (desc.largoMax && s.length > desc.largoMax) return mal('Máximo ' + desc.largoMax + ' caracteres.');
      if (desc.patron && !new RegExp(desc.patron).test(s)) {
        return mal(desc.ruta === 'PROXY' ? 'Usá auto, vacío o una URL http(s)://.../api/' :
                   desc.ruta === 'AEROPUERTO_LOCAL' ? 'Tres letras (por ejemplo ROS) o vacío.' :
                   'Caracteres no permitidos (letras, números, espacio . \' -).');
      }
      return bien(s);
    }
    if (t === 'clave') {
      if (typeof valor !== 'string') return mal('Tiene que ser texto.');
      var c = valor.trim();
      if (c.length > 200) return mal('Máximo 200 caracteres.');
      return bien(c);
    }
    if (t === 'franja' || t === 'franjaLenta') {
      if (valor === null) return bien(null);
      if (!esObj(valor)) return mal('Franja no válida.');
      if (!validarHora(valor.desde) || !validarHora(valor.hasta)) return mal('Horas en formato HH:MM.');
      if (valor.desde === valor.hasta) return mal('Desde y hasta no pueden ser iguales.');
      if (t === 'franja') return bien({ desde: valor.desde, hasta: valor.hasta });
      n = aNumero(valor.INTERVALO_S);
      if (n === null || Math.floor(n) !== n || n < 20 || n > 900) return mal('El intervalo va entre 20 y 900 s.');
      return bien({ desde: valor.desde, hasta: valor.hasta, INTERVALO_S: n });
    }
    if (t === 'lista') {
      if (!Array.isArray(valor) || valor.length < 1) return mal('Elegí al menos un proveedor.');
      var vistos = {};
      var out = [];
      for (i = 0; i < valor.length; i++) {
        if (typeof valor[i] !== 'string' || desc.opciones.indexOf(valor[i]) < 0) return mal('Proveedor desconocido: ' + String(valor[i]));
        if (vistos[valor[i]]) return mal('Proveedor repetido: ' + valor[i]);
        vistos[valor[i]] = true;
        out.push(valor[i]);
      }
      return bien(out);
    }
    return mal('Tipo de campo desconocido.');
  }

  function avisosDe(limpio, config) {
    var av = {};
    function v(r) { return tiene(limpio, r) ? limpio[r] : obtener(config || {}, r); }
    var alt = v('ALTERNAR_L3_S'), seg = v('SEGUNDOS_POR_PAGINA');
    if (typeof alt === 'number' && typeof seg === 'number' && alt > 0 && alt >= seg) {
      av.ALTERNAR_L3_S = 'Con varias páginas, los horarios no se llegan a ver: poné un valor menor que los segundos por pantalla (' + seg + ').';
    }
    return av;
  }

  function validar(valores, config) {
    var errores = {};
    var limpio = {};
    var ok = true;
    if (!esObj(valores)) return { ok: false, errores: { '': 'No es un objeto de valores.' }, limpio: {}, avisos: {} };
    for (var ruta in valores) {
      if (!tiene(valores, ruta)) continue;
      var desc = PORRUTA[ruta];
      if (!desc) { errores[ruta] = 'Campo desconocido.'; ok = false; continue; }
      var r = validarCampo(desc, valores[ruta]);
      if (r.ok) limpio[ruta] = r.valor;
      else { errores[ruta] = r.error; ok = false; }
    }
    return { ok: ok, errores: errores, limpio: limpio, avisos: avisosDe(limpio, config) };
  }

  // JSON con claves ordenadas, para comparar sin importar el orden.
  function estable(x) {
    if (Array.isArray(x)) return '[' + x.map(estable).join(',') + ']';
    if (x !== null && typeof x === 'object') {
      return '{' + Object.keys(x).sort().map(function (k) { return JSON.stringify(k) + ':' + estable(x[k]); }).join(',') + '}';
    }
    return JSON.stringify(x === undefined ? null : x);
  }

  function diferencias(base, valores) {
    var out = {};
    if (!esObj(valores)) return out;
    for (var ruta in valores) {
      if (!tiene(valores, ruta)) continue;
      if (estable(obtener(base, ruta)) !== estable(valores[ruta])) out[ruta] = valores[ruta];
    }
    return out;
  }

  function clonar(x) { return x === undefined ? undefined : JSON.parse(JSON.stringify(x)); }

  function aplicar(config, valores) {
    var res = { aplicados: [], rechazados: [] };
    try {
      if (!config || typeof config !== 'object' || !esObj(valores)) return res;
      for (var ruta in valores) {
        if (!tiene(valores, ruta)) continue;
        var desc = PORRUTA[ruta];
        if (!desc) { res.rechazados.push({ ruta: ruta, motivo: 'desconocido' }); continue; }
        var r = validarCampo(desc, valores[ruta]);
        if (!r.ok) { res.rechazados.push({ ruta: ruta, motivo: r.error }); continue; }
        if (poner(config, ruta, clonar(r.valor))) res.aplicados.push(ruta);
        else res.rechazados.push({ ruta: ruta, motivo: 'ruta inválida' });
      }
    } catch (e) { /* nunca tira */ }
    return res;
  }

  // Almacén: {leer(clave)->texto|null, escribir(clave,texto)->bool, borrar(clave)}
  var almacenLocal = {
    leer: function (clave) { try { return raiz.localStorage.getItem(clave); } catch (e) { return null; } },
    escribir: function (clave, texto) { try { raiz.localStorage.setItem(clave, texto); return true; } catch (e) { return false; } },
    borrar: function (clave) { try { raiz.localStorage.removeItem(clave); } catch (e) { /* nada */ } }
  };

  function leerCompleto(almacen) {
    try {
      var t = almacen.leer(CLAVE);
      if (!t) return null;
      var o = JSON.parse(t);
      if (esObj(o) && o.v === 1 && esObj(o.valores)) return o;
    } catch (e) { /* roto: se ignora */ }
    return null;
  }
  function leer(almacen) { var o = leerCompleto(almacen); return o ? o.valores : {}; }

  function guardar(almacen, valores) {
    try {
      if (!esObj(valores) || Object.keys(valores).length === 0) { almacen.borrar(CLAVE); return true; }
      var ok = almacen.escribir(CLAVE, JSON.stringify({ v: 1, guardadoMs: Date.now(), valores: valores }));
      if (!ok) return false;
      var o = leerCompleto(almacen);
      return !!o && estable(o.valores) === estable(valores);
    } catch (e) { return false; }
  }
  function borrar(almacen) { try { almacen.borrar(CLAVE); } catch (e) { /* nada */ } }

  function exportar(valores, opc) {
    var con = !!(opc && opc.incluirSensibles);
    var out = {};
    if (esObj(valores)) {
      for (var ruta in valores) {
        if (!tiene(valores, ruta)) continue;
        if (!con && PORRUTA[ruta] && PORRUTA[ruta].sensible) continue;
        out[ruta] = valores[ruta];
      }
    }
    return JSON.stringify({ app: 'tablero-vuelos', tipo: 'ajustes', v: 1, valores: out }, null, 2);
  }

  function importar(texto) {
    var o;
    try { o = JSON.parse(String(texto)); } catch (e) { return { ok: false, valores: {}, errores: { '': 'No es un JSON válido.' } }; }
    var vals = o;
    if (esObj(o) && o.app === 'tablero-vuelos') {
      if (o.tipo !== 'ajustes' || !esObj(o.valores)) return { ok: false, valores: {}, errores: { '': 'El archivo no es de ajustes.' } };
      vals = o.valores;
    }
    if (!esObj(vals)) return { ok: false, valores: {}, errores: { '': 'No es un objeto de valores.' } };
    var v = validar(vals);
    return { ok: v.ok, valores: v.limpio, errores: v.errores };
  }

  function promedioCircular(grados) {
    var s = 0, c = 0, n = 0;
    for (var i = 0; i < (grados ? grados.length : 0); i++) {
      if (typeof grados[i] !== 'number' || !isFinite(grados[i])) continue;
      var r = grados[i] * Math.PI / 180;
      s += Math.sin(r); c += Math.cos(r); n++;
    }
    if (!n) return { media: null, r: 0 };
    var media = Math.atan2(s / n, c / n) * 180 / Math.PI;
    if (media < 0) media += 360;
    return { media: media, r: Math.sqrt(s * s + c * c) / n };
  }

  function rumboDesdeEvento(ev) {
    if (!ev) return null;
    if (typeof ev.webkitCompassHeading === 'number' && isFinite(ev.webkitCompassHeading)) {
      return ((ev.webkitCompassHeading % 360) + 360) % 360;
    }
    if ((ev.absolute === true || ev.type === 'deviceorientationabsolute') && typeof ev.alpha === 'number' && isFinite(ev.alpha)) {
      return (((360 - ev.alpha) % 360) + 360) % 360;
    }
    return null;
  }

  var CARD = { N: 0, NE: 45, E: 90, SE: 135, S: 180, SO: 225, O: 270, NO: 315 };
  function cardinalAGrados(c) {
    var k = String(c === null || c === undefined ? '' : c).trim().toUpperCase();
    return tiene(CARD, k) ? CARD[k] : null;
  }

  function info() {
    return { guardados: estado.guardados, guardadoMs: estado.guardadoMs,
             aplicados: estado.aplicados, rechazados: estado.rechazados,
             listaAplicados: estado.listaAplicados.slice(), listaRechazados: estado.listaRechazados.slice() };
  }

  var Ajustes = {
    CLAVE: CLAVE, GRUPOS: GRUPOS, ESQUEMA: ESQUEMA, PORRUTA: PORRUTA,
    obtener: obtener, poner: poner, clonar: clonar,
    validarCampo: validarCampo, validar: validar, diferencias: diferencias, aplicar: aplicar,
    leer: leer, leerCompleto: leerCompleto, guardar: guardar, borrar: borrar, almacenLocal: almacenLocal,
    exportar: exportar, importar: importar,
    promedioCircular: promedioCircular, rumboDesdeEvento: rumboDesdeEvento, cardinalAGrados: cardinalAGrados,
    quitarTildes: quitarTildes, info: info
  };
  raiz.Ajustes = Ajustes;
  if (typeof module === 'object' && module.exports) module.exports = Ajustes;

  // Navegador: guarda la base y aplica lo guardado.
  try {
    var hayLS = false;
    try { hayLS = !!(raiz.localStorage && raiz.localStorage.getItem); } catch (e) { hayLS = false; }
    if (raiz.CONFIG && hayLS) {
      raiz.CONFIG_BASE = clonar(raiz.CONFIG);
      var comp = leerCompleto(almacenLocal);
      if (comp) {
        var r = aplicar(raiz.CONFIG, comp.valores);
        estado.aplicados = r.aplicados.length;
        estado.rechazados = r.rechazados.length;
        estado.listaAplicados = r.aplicados;
        estado.listaRechazados = r.rechazados;
        estado.guardados = Object.keys(comp.valores).length;
        estado.guardadoMs = comp.guardadoMs || 0;
      }
    }
  } catch (e) { /* nunca rompe la carga */ }
})(typeof window !== 'undefined' ? window : globalThis);
