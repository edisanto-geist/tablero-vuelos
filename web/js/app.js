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
    CONFIG.INTERVALO_REPOSO_S = CONFIG.DEMO.INTERVALO_CONSULTA_S;
    CONFIG.INTERVALO_ACTIVO_S = CONFIG.DEMO.INTERVALO_CONSULTA_S;
    CONFIG.ENRIQUECER = false;
    CONFIG.FRANJA_LENTA = null;
    CONFIG.TIMEOUT_SIN_AVIONES_S = CONFIG.DEMO.TIMEOUT_SIN_AVIONES_S;
    CONFIG.REBEEP_VUELO_S = CONFIG.DEMO.REBEEP_VUELO_S;
    CONFIG.PROVEEDOR = 'demo';
  }
  if (Q.radio && parseFloat(Q.radio) > 0) CONFIG.RADIO_KM = Math.min(460, parseFloat(Q.radio));
  if (Q.proveedor && !DEMO) CONFIG.PROVEEDOR = Q.proveedor;
  if (Q.proxy === '1') CONFIG.PROXY = 'http://127.0.0.1:8080/api/';
  else if (Q.proxy === '0') CONFIG.PROXY = '';
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
  var ultimoRes = null, ultimoOkMs = Date.now(), ultimosCrudos = [];
  var ultimosVuelos = [];
  var fuentes = raiz.Fuentes.crear(CONFIG, raiz.Proveedores, raiz.Red ? raiz.Red.almacen : null);
  var enriq = (CONFIG.ENRIQUECER && raiz.Enriquecer && raiz.Red) ?
    raiz.Enriquecer.crear(CONFIG, raiz.Red, raiz.Red.almacen, alEnriquecer) : null;
  var enrFlag = false, enrUltimoMs = 0;

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
    ultimosVuelos = vuelos;
    if (enriq) enriq.pedir(vuelos, ahora);

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
    marcarVuelos(vuelos);
    if (DEBUG) {
      if (ESTADO !== 'REPOSO') {
        var malos = raiz.Tablero.verificarDesbordes();
        if (malos.length) console.warn('[app] DESBORDE: ' + malos.join(' | '));
      }
      pintarDebug();
    }
  }

  function tick() {
    fuentes.obtener(Date.now()).then(function (res) {
      var ahora = Date.now();
      ultimoRes = res;
      try {
        if (res.ok) {
          ultimoOkMs = ahora; ultimosCrudos = res.estados;
          if (enriq) enriq.aplicar(res.estados, ahora);
          procesar(res.estados, ahora);
        } else if (ESTADO !== 'REPOSO' && ahora - ultimoOkMs >= CONFIG.TIMEOUT_SIN_AVIONES_S * 1000) {
          ultimosCrudos = [];
          procesar([], ahora);
        } else if (DEBUG) pintarDebug();   // falla corta: se mantiene lo que hay en pantalla
      } catch (e) { console.error('[app] error en tick', e); }
      setTimeout(tick, fuentes.intervaloS(ESTADO, new Date()) * 1000);
    });
  }

  // Re-render cuando llegan rutas/tipos de adsbdb: no toca 'vistos' ni el beep.
  function alEnriquecer() {
    if (enrFlag) return;
    enrFlag = true;
    var espera = Math.max(0, 500 - (Date.now() - enrUltimoMs));
    setTimeout(function () {
      enrFlag = false;
      if (ESTADO !== 'ACTIVO' || !ultimosCrudos || !ultimosCrudos.length) return;
      enrUltimoMs = Date.now();
      try {
        enriq.aplicar(ultimosCrudos, enrUltimoMs);
        var v = raiz.Datos.procesar(ultimosCrudos, CONFIG, enrUltimoMs);
        if (v.length) { ultimosVuelos = v; raiz.Tablero.mostrar(v); marcarVuelos(v); if (DEBUG) pintarDebug(); }
      } catch (e) { console.error('[app] error al enriquecer', e); }
    }, espera);
  }

  // Hook de pruebas (solo con debug=1): lista de vuelos del último render.
  function marcarVuelos(vuelos) {
    if (!DEBUG) return;
    document.body.setAttribute('data-vuelos', JSON.stringify(vuelos.map(function (v) {
      return v.vuelo + '|' + (v.origen || '---') + '>' + (v.destino || '---') + '|' + (v.tipo || '----');
    })));
  }

  // ---- overlay de debug ----
  function pintarDebug() {
    if (!dbg) return;
    var t = raiz.Tablero.estado();
    var tc = (CONFIG.PROVEEDOR === 'demo' && raiz.Proveedores.demo) ? raiz.Proveedores.demo.tCiclo(Date.now()).toFixed(0) : '-';
    var l1 = 'estado=' + ESTADO + ' n=' + ultimoN + ' t=' + tc + 's pag=' + (t.pagina + 1) + '/' + t.paginas +
      ' tp=' + (t.timerPagina ? 1 : 0) + ' tr=' + (t.timerReloj ? 1 : 0) + ' beeps=' + nBeeps + ' ult=' + ultimoBeep + ' modo=' + t.modo;
    var fi = fuentes.info(), ahora = Date.now();
    var r = ultimoRes, ult = r && r.intentos && r.intentos.length ? r.intentos[r.intentos.length - 1] : null;
    var prov = r && r.proveedor ? r.proveedor : (ult ? ult.prov : '-');
    var modoRed = (raiz.Red && raiz.Red.proxyBase()) ? 'proxy' : 'directo';
    var sig = fuentes.intervaloS(ESTADO, new Date());
    var l2 = 'fuente=' + prov + '(' + modoRed + ') http=' + (ult ? ult.status : '-') + ' ' + (ult ? Math.round(ult.ms) : '-') + 'ms' +
      ' crudos=' + (r && r.estados ? r.estados.length : '-') + ' radio=' + ultimoN + '/' + CONFIG.RADIO_KM + 'km' +
      ' sig=' + Math.round(sig) + 's fallidos=' + fi.ticksFallidos;
    var enf = [], cup = [], rem = '';
    Object.keys(fi.porProv).forEach(function (n) {
      var p = fi.porProv[n];
      if (p.enfriaHastaMs > ahora) enf.push(n + ' ' + Math.round((p.enfriaHastaMs - ahora) / 1000) + 's');
      if (p.cupo > 0) cup.push(n + ' ' + p.usados + '/' + p.cupo);
      if (n === 'opensky' && p.restante !== null) rem = ' rem=' + p.restante;
    });
    var ei = enriq ? enriq.info() : null;
    var l3 = 'enfrian: ' + (enf.length ? enf.join(' | ') : '-') + ' | cupos: ' + (cup.length ? cup.join(' ') : '-') + rem +
      ' | enriq ' + (ei ? 'cola=' + ei.cola + ' rutas=' + ei.rutas + ' tipos=' + ei.tipos + ' adsbdb=' + (ei.ultimoStatus === null || ei.ultimoStatus === undefined ? '-' : ei.ultimoStatus) +
        ' pausa=' + (ei.pausaHastaMs > ahora ? Math.round((ei.pausaHastaMs - ahora) / 1000) : 0) : 'off');
    dbg.textContent = l1 + '\n' + l2 + '\n' + l3;
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
      setInterval(pintarDebug, 2000);
    }
    ['click', 'touchstart', 'keydown'].forEach(function (ev) {
      document.addEventListener(ev, function () { setTimeout(refrescarAvisoSonido, 150); }, true);
    });
    tick();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})(window);
