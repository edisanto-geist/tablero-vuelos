// Orquestación: parámetros de URL, bucle de consulta y máquina de estados REPOSO / ACTIVO / ESPERA.
(function (raiz) {
  var CONFIG = raiz.CONFIG;
  var Q = {};
  (location.search || '').replace(/^\?/, '').split('&').forEach(function (p) {
    if (!p) return;
    var kv = p.split('=');
    Q[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1] || '');
  });

  // ---- overrides por URL ----
  var DEMO = Q.demo === '1';
  if (DEMO) {
    CONFIG.INTERVALO_CONSULTA_S = CONFIG.DEMO.INTERVALO_CONSULTA_S;
    CONFIG.TIMEOUT_SIN_AVIONES_S = CONFIG.DEMO.TIMEOUT_SIN_AVIONES_S;
    CONFIG.REBEEP_VUELO_S = CONFIG.DEMO.REBEEP_VUELO_S;
    CONFIG.PROVEEDOR = 'demo';
  }
  if (Q.t !== undefined && !isNaN(parseFloat(Q.t))) CONFIG.DEMO.T_INICIAL_S = parseFloat(Q.t);
  if (Q.filas && parseInt(Q.filas, 10) > 0) CONFIG.FILAS_POR_PAGINA = parseInt(Q.filas, 10);
  if (Q.animar === '0') CONFIG.ANIMAR = false;
  if (Q.orientacion !== undefined && !isNaN(parseFloat(Q.orientacion))) CONFIG.ORIENTACION_PANTALLA_DEG = parseFloat(Q.orientacion);
  var DEBUG = Q.debug === '1';

  var ESTADO = 'REPOSO';
  var tSinAviones = 0;
  var vistos = {};
  var ultimoBeepMs = 0;
  var ultimoBeep = '-';
  var nBeeps = 0;
  var ultimoN = 0;
  var dbg = null;

  // ---- pantalla física ----
  var wakeLock = null;
  var Pantalla = {
    encender: function () {
      try { if (raiz.fully && raiz.fully.turnScreenOn) raiz.fully.turnScreenOn(); } catch (e) {}
      try {
        if (navigator.wakeLock && navigator.wakeLock.request) {
          navigator.wakeLock.request('screen').then(function (l) { wakeLock = l; }, function () {});
        }
      } catch (e2) {}
    },
    apagar: function () {
      try { if (wakeLock) { wakeLock.release(); wakeLock = null; } } catch (e) {}
      try {
        if (CONFIG.APAGAR_PANTALLA_FISICA && raiz.fully && raiz.fully.turnScreenOff) raiz.fully.turnScreenOff();
      } catch (e2) {}
    }
  };

  var T0 = Date.now();
  function log(msg) { try { console.log('[app] +' + Math.round((Date.now() - T0) / 1000) + 's ' + msg); } catch (e) {} }

  function refrescarAvisoSonido() {
    var sin = !!(raiz.Sonido && raiz.Sonido.estaDesbloqueado && !raiz.Sonido.estaDesbloqueado());
    raiz.Tablero.setSinSonido(ESTADO === 'ACTIVO' && sin);
  }

  function cambiar(nuevo) {
    log('estado ' + ESTADO + ' -> ' + nuevo + ' (n=' + ultimoN + ')');
    ESTADO = nuevo;
    document.body.classList.remove('reposo', 'activo', 'espera');
    document.body.classList.add(nuevo.toLowerCase());
  }

  function pedirBeep(motivo) {
    var ahora = Date.now();
    if (ultimoBeepMs && ahora - ultimoBeepMs < CONFIG.BEEP_MIN_ENTRE_S * 1000) {
      log('beep omitido por cooldown (' + motivo + ')');
      return;
    }
    ultimoBeepMs = ahora;
    nBeeps++;
    log('beep pedido (' + motivo + ')');
    if (!raiz.Sonido) { ultimoBeep = 'sin-sonido.js'; return; }
    try {
      raiz.Sonido.beep().then(function (r) { ultimoBeep = r; refrescarAvisoSonido(); }, function () { ultimoBeep = 'error'; });
    } catch (e) { ultimoBeep = 'error'; }
  }

  // ---- un tick ----
  function procesar(crudos, ahora) {
    var vuelos = raiz.Datos.procesar(crudos, CONFIG, ahora);
    var n = vuelos.length;
    ultimoN = n;

    var hayNuevo = false, i;
    for (i = 0; i < n; i++) {
      var u = vistos[vuelos[i].id];
      if (u === undefined || ahora - u > CONFIG.REBEEP_VUELO_S * 1000) hayNuevo = true;
    }
    for (i = 0; i < n; i++) vistos[vuelos[i].id] = ahora;
    Object.keys(vistos).forEach(function (k) { if (ahora - vistos[k] > 600000) delete vistos[k]; });

    if (ESTADO === 'REPOSO') {
      if (n > 0) {
        cambiar('ACTIVO');
        Pantalla.encender();
        raiz.Tablero.mostrar(vuelos);
        pedirBeep('reposo->activo');
      }
    } else if (ESTADO === 'ACTIVO') {
      if (n > 0) {
        raiz.Tablero.mostrar(vuelos);
        if (hayNuevo) pedirBeep('vuelo nuevo');
      } else {
        tSinAviones = ahora;
        cambiar('ESPERA');
        raiz.Tablero.mostrarSinTrafico();
      }
    } else { // ESPERA
      if (n > 0) {
        cambiar('ACTIVO');
        raiz.Tablero.mostrar(vuelos);
        if (hayNuevo) pedirBeep('vuelo nuevo');
      } else if (ahora - tSinAviones >= CONFIG.TIMEOUT_SIN_AVIONES_S * 1000) {
        cambiar('REPOSO');
        raiz.Tablero.ocultar();
        Pantalla.apagar();
      }
    }
    refrescarAvisoSonido();
    if (DEBUG) {
      if (ESTADO !== 'REPOSO') {
        var malos = raiz.Tablero.verificarDesbordes();
        if (malos.length) console.warn('[app] DESBORDE: ' + malos.join(' | '));
      }
      pintarDebug();
    }
  }

  function obtener(ahora) {
    return new Promise(function (resolve) {
      var listo = false;
      function fin(v, cuelga) {
        if (listo) return;
        listo = true;
        if (cuelga) console.warn("[app] proveedor '" + CONFIG.PROVEEDOR + "' no disponible en Fase 1");
        resolve(v);
      }
      var prov = raiz.Proveedores && raiz.Proveedores[CONFIG.PROVEEDOR];
      if (!prov) { fin([], true); return; }
      var timer = setTimeout(function () { fin([], true); }, 10000);
      try {
        prov.obtenerEstados(ahora).then(function (r) {
          clearTimeout(timer); fin(r || [], false);
        }, function () { clearTimeout(timer); fin([], true); });
      } catch (e) { clearTimeout(timer); fin([], true); }
    });
  }

  function tick() {
    var ahora = Date.now();
    obtener(ahora).then(function (crudos) {
      try { procesar(crudos, Date.now()); }
      catch (e) { console.error('[app] error en tick', e); }
      setTimeout(tick, CONFIG.INTERVALO_CONSULTA_S * 1000);
    });
  }

  // ---- overlay de debug ----
  function pintarDebug() {
    if (!dbg) return;
    var t = raiz.Tablero.estado();
    var tc = (CONFIG.PROVEEDOR === 'demo' && raiz.Proveedores.demo) ? raiz.Proveedores.demo.tCiclo(Date.now()).toFixed(0) : '-';
    dbg.textContent = 'estado=' + ESTADO + ' n=' + ultimoN + ' t=' + tc + 's pag=' + (t.pagina + 1) + '/' + t.paginas +
      ' tp=' + (t.timerPagina ? 1 : 0) + ' tr=' + (t.timerReloj ? 1 : 0) + ' beeps=' + nBeeps + ' ult=' + ultimoBeep + ' modo=' + t.modo;
  }

  // ---- arranque ----
  function iniciar() {
    raiz.Tablero.iniciar(CONFIG);
    if (raiz.Sonido && raiz.Sonido.init) { try { raiz.Sonido.init(CONFIG); } catch (e) {} }
    if (DEBUG) {
      dbg = document.createElement('div');
      dbg.id = 'debug';
      document.body.appendChild(dbg);
      pintarDebug();
    }
    ['click', 'touchstart', 'keydown'].forEach(function (ev) {
      document.addEventListener(ev, function () { setTimeout(refrescarAvisoSonido, 150); }, true);
    });
    tick();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})(window);
