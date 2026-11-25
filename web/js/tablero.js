// Render del tablero: filas con celdas split-flap, paginado, reloj y pantalla "sin tráfico".
(function (raiz) {
  var ABC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  var DURACION_FLAP = 180;       // ms de una vuelta de celda
  var ESCALONADO = 15;           // ms de retraso por índice de celda al cambiar de página

  var cfg, el = {}, gen = 0;
  var vuelos = [], pagina = 0, timerPagina = null, timerReloj = null;
  var modo = null;               // 'uno' | 'normal' | null (sin filas construidas)
  var filas = [];                // [{raiz, campos:{nombre:[celdas]}, ...}]
  var sinSonido = false;
  var visible = false;
  var vistaL3 = 'a', timerL3 = null;       // L3 alterna entre la vista A (datos técnicos) y la B (horarios)
  var GRUPO_A = ['aerolinea', 'tipo', 'altitud', 'estado'];
  var GRUPO_B = ['salida', 'eta', 'estado2'];

  function aleatorio() { return ABC.charAt(Math.floor(Math.random() * ABC.length)); }
  function mostrarCh(ch) { return ch === ' ' ? ' ' : ch; }
  // La flecha de la ruta se dibuja con CSS: el carácter → no está bien en todas las fuentes monoespaciadas de Android.
  function pintar(celda, ch) {
    if (ch === '→') { celda.textContent = ''; celda.classList.add('cf'); }
    else { celda.classList.remove('cf'); celda.textContent = mostrarCh(ch); }
  }

  function mk(tag, clase, padre) {
    var e = document.createElement(tag);
    if (clase) e.className = clase;
    if (padre) padre.appendChild(e);
    return e;
  }

  // --- celdas -------------------------------------------------------------
  function crearCampo(padre, nombre, n, extra) {
    var campo = mk('span', 'campo c-' + nombre + (extra ? ' ' + extra : ''), padre);
    var celdas = [];
    for (var i = 0; i < n; i++) {
      var c = mk('span', 'celda', campo);
      c.textContent = ' ';
      c._ch = ' ';
      c._t = 0;
      celdas.push(c);
    }
    campo._celdas = celdas;
    return campo;
  }

  // Lleva una celda por una secuencia de caracteres, un flap por carácter.
  function secuencia(celda, chars, retardo) {
    var tok = ++celda._t;
    var g = gen;
    celda._ch = chars[chars.length - 1];
    chars.forEach(function (ch, i) {
      setTimeout(function () {
        if (g !== gen || celda._t !== tok) return;
        celda.classList.remove('flap');
        void celda.offsetWidth;               // reinicia la animación
        celda.classList.add('flap');
        setTimeout(function () {
          if (g !== gen || celda._t !== tok) return;
          pintar(celda, ch);
        }, DURACION_FLAP / 2);
        setTimeout(function () {
          if (celda._t === tok) celda.classList.remove('flap');
        }, DURACION_FLAP + 20);
      }, retardo + i * DURACION_FLAP);
    });
  }

  // modoCambio: 'tick' (solo las celdas distintas) | 'pagina' (todas, con letras al azar)
  function poner(campo, texto, modoCambio) {
    var celdas = campo._celdas;
    for (var i = 0; i < celdas.length; i++) {
      var ch = i < texto.length ? texto.charAt(i) : ' ';
      var c = celdas[i];
      if (!cfg.ANIMAR) {
        c._t++; c._ch = ch; pintar(c, ch);
      } else if (modoCambio === 'pagina') {
        if (c._ch === ' ' && ch === ' ') continue;
        secuencia(c, [aleatorio(), aleatorio(), ch], i * ESCALONADO);
      } else if (c._ch !== ch) {
        secuencia(c, [ch], 0);
      }
    }
  }

  // --- filas --------------------------------------------------------------
  function sep(padre) { return mk('span', 'sep', padre); }

  function conHorarios() { return cfg.HORARIOS_MODO !== 'no'; }
  // Alterna automáticamente salvo que ALTERNAR_L3_S sea 0 o la URL fuerce una vista (l3=a|b).
  function forzadaL3() { return cfg.L3_VISTA === 'a' || cfg.L3_VISTA === 'b'; }
  function segundosL3() {
    return (typeof cfg.ALTERNAR_L3_S === 'number' && cfg.ALTERNAR_L3_S >= 0) ? cfg.ALTERNAR_L3_S : 4;
  }

  function construirFila(tipo) {
    var f = { campos: {} };
    var r = f.raiz = mk('div', 'fila');
    var l1 = mk('div', 'linea l1', r);
    f.ins = mk('span', 'ins-hueco', l1);
    f.campos.vuelo = crearCampo(l1, 'vuelo', 8);
    mk('span', 'resorte', l1);
    f.campos.ruta = crearCampo(l1, 'ruta', 7);
    var l2 = mk('div', 'linea l2', r);
    f.flecha = mk('span', 'flecha', l2);
    f.flecha.innerHTML =
      '<svg class="f-flecha" viewBox="0 0 24 24" width="100%" height="100%"><polygon fill="#FFC81E" points="12,1.5 21.5,21 12,15.5 2.5,21"/></svg>' +
      '<svg class="f-encima" viewBox="0 0 24 24" width="100%" height="100%"><circle cx="12" cy="12" r="9" fill="none" stroke="#FFC81E" stroke-width="2.6"/><circle cx="12" cy="12" r="3.6" fill="#FFC81E"/></svg>';
    f.campos.direccion = crearCampo(l2, 'direccion', 19);
    if (tipo === 'uno') {
      var a = mk('div', 'linea l3', r);
      f.campos.nombre = crearCampo(a, 'nombre', 22);
      sep(a);
      f.campos.tipo = crearCampo(a, 'tipo', 4);
      var b = mk('div', 'linea l3', r);
      f.campos.altitud = crearCampo(b, 'altitud', 9);
      sep(b);
      f.campos.estado = crearCampo(b, 'estado', 14);
      if (conHorarios()) {
        var c = mk('div', 'linea l3 l3c', r);
        f.campos.salida = crearCampo(c, 'salida', 11);
        sep(c);
        f.campos.eta = crearCampo(c, 'eta', 11);
      }
    } else {
      var l3 = mk('div', 'linea l3 l3a', r);
      f.campos.aerolinea = crearCampo(l3, 'aerolinea', 11);
      sep(l3);
      f.campos.tipo = crearCampo(l3, 'tipo', 4);
      sep(l3);
      f.campos.altitud = crearCampo(l3, 'altitud', 9);
      sep(l3);
      f.campos.estado = crearCampo(l3, 'estado', 14);
      if (conHorarios()) {
        var l3b = mk('div', 'linea l3 l3b', r);
        f.campos.salida = crearCampo(l3b, 'salida', 11);
        sep(l3b);
        f.campos.eta = crearCampo(l3b, 'eta', 11);
        sep(l3b);
        f.campos.estado2 = crearCampo(l3b, 'estado2', 14);
      }
    }
    f.angulo = null;
    f.icao = undefined;
    return f;
  }

  function poblarFila(f, v, modoCambio) {
    var vacio = !v;
    var t = vacio ? null : raiz.Formato.fila(v, cfg);
    if (t) t.estado2 = t.estado;
    f.t = t;
    Object.keys(f.campos).forEach(function (k) {
      poner(f.campos[k], vacio ? '' : t[k], modoCambio);
    });
    ['salida', 'eta'].forEach(function (k) {   // color: real/est en blanco, prog/calc/vacío en gris
      if (f.campos[k]) f.campos[k].className = 'campo c-' + k + (t && t[k + 'Tipo'] ? ' t-' + t[k + 'Tipo'] : '');
    });
    // Insignia (solo se reconstruye si cambió la aerolínea)
    var clave = vacio ? '' : (v.aerolinea ? v.aerolinea.icao : '-');
    if (f.icao !== clave) {
      f.icao = clave;
      f.ins.innerHTML = '';
      if (!vacio) f.ins.appendChild(raiz.Insignia.crear(v.aerolinea));
    }
    // Flecha / círculo
    var svgF = f.flecha.firstChild, svgE = f.flecha.lastChild;
    if (vacio) {
      svgF.style.display = 'none'; svgE.style.display = 'none';
    } else if (v.encima) {
      svgF.style.display = 'none'; svgE.style.display = 'block';
    } else {
      svgE.style.display = 'none'; svgF.style.display = 'block';
      var objetivo = ((v.marcacionDeg - (cfg.ORIENTACION_PANTALLA_DEG || 0)) % 360 + 360) % 360;
      var primera = f.angulo === null;
      if (primera) f.angulo = objetivo;
      else {                       // camino corto, sin dar vueltas de más
        var d = ((objetivo - f.angulo) % 360 + 540) % 360 - 180;
        f.angulo += d;
      }
      var tr = 'rotate(' + f.angulo.toFixed(1) + 'deg)';
      if (primera) { svgF.style.webkitTransition = 'none'; svgF.style.transition = 'none'; }
      svgF.style.webkitTransform = tr;
      svgF.style.transform = tr;
      if (primera) {
        void svgF.getBoundingClientRect();
        svgF.style.webkitTransition = ''; svgF.style.transition = '';
      }
    }
  }

  // --- estructura general -----------------------------------------------
  function paginas() {
    var n = vuelos.length;
    if (n <= 1) return 1;
    return Math.max(1, Math.ceil(n / cfg.FILAS_POR_PAGINA));
  }

  function actualizarEncabezado() {
    var np = paginas();
    el.pagina.textContent = np > 1 ? (pagina + 1) + '/' + np : '';
    el.aviso.textContent = sinSonido ? 'SIN SONIDO · TOCÁ' : '';
  }

  function actualizarReloj() {
    var d = new Date();
    var h = d.getHours(), m = d.getMinutes();
    el.reloj.textContent = (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
  }

  function detenerTimers() {
    if (timerPagina) { clearInterval(timerPagina); timerPagina = null; }
    if (timerReloj) { clearInterval(timerReloj); timerReloj = null; }
    if (timerL3) { clearInterval(timerL3); timerL3 = null; }
  }

  function reiniciarTimerL3() {
    if (timerL3) { clearInterval(timerL3); timerL3 = null; }
    var s = segundosL3();
    if (s > 0 && !forzadaL3() && conHorarios() && modo === 'normal') {
      timerL3 = setInterval(function () { cambiarVistaL3(vistaL3 === 'a' ? 'b' : 'a'); }, s * 1000);
    }
  }

  function limpiarCuerpo() {
    gen++;
    el.cuerpo.innerHTML = '';
    filas = [];
    modo = null;
  }

  function asegurarTimers() {
    if (!timerReloj) { timerReloj = setInterval(actualizarReloj, 30000); }
    var np = paginas();
    if (np > 1 && !timerPagina) {
      timerPagina = setInterval(function () {
        pagina = (pagina + 1) % paginas();
        vistaL3 = forzadaL3() ? cfg.L3_VISTA : 'a';   // cada página arranca en la vista A
        reiniciarTimerL3();
        dibujar('pagina');
      }, cfg.SEGUNDOS_POR_PAGINA * 1000);
    } else if (np <= 1 && timerPagina) {
      clearInterval(timerPagina); timerPagina = null;
    }
    if (!timerL3 && modo === 'normal') reiniciarTimerL3();
    if (modo !== 'normal' && timerL3) { clearInterval(timerL3); timerL3 = null; }
  }

  function dibujar(modoCambio) {
    var nuevoModo = vuelos.length === 1 ? 'uno' : 'normal';
    var nFilas = nuevoModo === 'uno' ? 1 : cfg.FILAS_POR_PAGINA;
    if (pagina >= paginas()) pagina = 0;
    if (nuevoModo !== modo || filas.length !== nFilas) {
      limpiarCuerpo();
      modo = nuevoModo;
      vistaL3 = forzadaL3() ? cfg.L3_VISTA : 'a';
      el.tablero.className = (modo === 'uno' ? 'uno ' : '') + (cfg.FILAS_POR_PAGINA >= 3 ? 'f3' : 'f2') + ' visible';
      for (var i = 0; i < nFilas; i++) {
        var f = construirFila(modo);
        el.cuerpo.appendChild(f.raiz);
        filas.push(f);
      }
      modoCambio = 'pagina';
    }
    for (var j = 0; j < filas.length; j++) {
      var v = vuelos[pagina * nFilas + j] || null;
      poblarFila(filas[j], v, modoCambio);
      filas[j].raiz.className = 'fila' + (v ? '' : ' vacia');
    }
    aplicarClasesL3();
    el.cuerpo.className = '';
    actualizarEncabezado();
  }

  // La vista B solo se ve en las filas que tienen algún horario; el resto se queda en A.
  function filaEnB(f) { return vistaL3 === 'b' && modo === 'normal' && !!(f.t && f.t.hayHorarios); }
  function aplicarClasesL3() {
    for (var j = 0; j < filas.length; j++) {
      var f = filas[j];
      var vacia = /(^| )vacia( |$)/.test(f.raiz.className);
      f.raiz.className = 'fila' + (vacia ? ' vacia' : '') + (filaEnB(f) ? ' vb' : '');
    }
  }

  // Cambia la vista de L3 con flap de página en los campos que quedan visibles.
  function cambiarVistaL3(nueva) {
    if (nueva === vistaL3) return;
    vistaL3 = nueva;
    aplicarClasesL3();
    if (!cfg.ANIMAR) return;
    for (var j = 0; j < filas.length; j++) {
      var f = filas[j];
      if (!f.t || !f.t.hayHorarios) continue;
      (nueva === 'b' ? GRUPO_B : GRUPO_A).forEach(function (k) {
        if (f.campos[k]) poner(f.campos[k], f.t[k], 'pagina');
      });
    }
  }

  function mostrarEstructura() {
    visible = true;
    el.tablero.style.display = 'flex';
    actualizarReloj();
  }

  var Tablero = {
    iniciar: function (config) {
      cfg = config;
      el.tablero = document.getElementById('tablero');
      el.titulo = document.getElementById('titulo');
      el.aviso = document.getElementById('aviso-sonido');
      el.pagina = document.getElementById('pagina');
      el.reloj = document.getElementById('reloj');
      el.cuerpo = document.getElementById('cuerpo');
      vistaL3 = forzadaL3() ? cfg.L3_VISTA : 'a';
      el.titulo.textContent = 'CIELO DE ' + cfg.NOMBRE_LUGAR + ' · ' + cfg.RADIO_KM + ' KM';
    },
    // Dibuja la lista de vuelos (ya filtrada y ordenada). Se llama en cada tick con aviones.
    mostrar: function (lista) {
      var veniaSinTrafico = !visible || modo === 'espera';
      vuelos = lista;
      mostrarEstructura();
      if (modo === 'espera') limpiarCuerpo();
      if (veniaSinTrafico) pagina = 0;
      dibujar('tick');
      asegurarTimers();
    },
    mostrarSinTrafico: function () {
      vuelos = [];
      pagina = 0;
      mostrarEstructura();
      limpiarCuerpo();
      modo = 'espera';
      el.tablero.className = 'espera visible';
      var m = mk('div', 'sin-trafico', el.cuerpo);
      m.textContent = 'SIN VUELOS EN ' + cfg.RADIO_KM + ' KM';
      actualizarEncabezado();
      el.pagina.textContent = '';
      detenerTimers();
      timerReloj = setInterval(actualizarReloj, 30000);
    },
    // Vuelve a negro total: corta timers y esconde todo.
    ocultar: function () {
      detenerTimers();
      limpiarCuerpo();
      vuelos = []; pagina = 0; visible = false;
      el.tablero.style.display = 'none';
      el.tablero.className = '';
    },
    setSinSonido: function (b) {
      sinSonido = !!b;
      if (visible) actualizarEncabezado();
    },
    estado: function () {
      return { visible: visible, modo: modo, pagina: pagina, paginas: paginas(), n: vuelos.length,
               timerPagina: !!timerPagina, timerReloj: !!timerReloj };
    },
    // Devuelve la lista de elementos que se salen de su caja o de la pantalla.
    verificarDesbordes: function () {
      var malos = [];
      if (!visible) return malos;
      var W = window.innerWidth, H = window.innerHeight;
      var sel = el.tablero.querySelectorAll('.linea, .l3a, .l3b, .l3c, .fila, .campo, #encabezado');
      for (var i = 0; i < sel.length; i++) {
        var e = sel[i], r = e.getBoundingClientRect();
        var fuera = r.right > W + 0.5 || r.left < -0.5 || r.bottom > H + 0.5;
        var interno = e.scrollWidth > e.clientWidth + 1 && e.clientWidth > 0 && !e.classList.contains('campo');
        var alto = (e.classList.contains('fila')) && e.scrollHeight > e.clientHeight + 1;
        if (fuera || interno || alto) malos.push((e.className || e.id) + ' (' + Math.round(r.left) + '..' +
          Math.round(r.right) + 'x' + Math.round(r.bottom) + ' en ' + W + 'x' + H + ')');
      }
      // superposición en L1 entre vuelo y ruta
      var l1 = el.tablero.querySelectorAll('.l1');
      for (var k = 0; k < l1.length; k++) {
        var a = l1[k].querySelector('.c-vuelo'), b = l1[k].querySelector('.c-ruta');
        if (a && b && a.getBoundingClientRect().right > b.getBoundingClientRect().left + 0.5)
          malos.push('l1: vuelo pisa ruta');
      }
      return malos;
    }
  };
  raiz.Tablero = Tablero;
})(window);
