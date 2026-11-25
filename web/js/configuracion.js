// Pantalla de configuración (config.html). Arma el formulario a partir de Ajustes.ESQUEMA.
// Lo testeable (validación, diferencias, export/import, brújula) vive en Ajustes; acá está solo la UI.
(function (raiz) {
  'use strict';

  var doc = raiz.document;
  var CONFIG = raiz.CONFIG;
  var BASE = raiz.CONFIG_BASE || JSON.parse(JSON.stringify(CONFIG));
  var INACTIVIDAD_MS = 300000;

  var ETIQ_OPC = {
    no: 'NO MOSTRAR', calc: 'CALCULADO (~)', api: 'API (necesita proxy y clave)', aeroapi: 'FLIGHTAWARE AEROAPI',
    auto: 'AUTO (con respaldo)', adsbfi: 'ADSB.FI', adsblol: 'ADSB.LOL', opensky: 'OPENSKY', airplaneslive: 'AIRPLANES.LIVE',
    m: 'METROS', ft: 'PIES'
  };

  var campos = {};      // ruta -> {desc, leer(), escribir(v), err, aviso}
  var orden = [];
  var timerInactividad = null;
  var cfgPrueba = { VOLUMEN: 0.8, HORARIO_SILENCIO: null, RUTA_BEEP: 'beep.mp3', SONIDO: (raiz.CONFIG && raiz.CONFIG.SONIDO) || 'dingdong' };

  // ---------- utilidades DOM ----------
  function el(tag, props, hijos) {
    var n = doc.createElement(tag);
    if (props) for (var k in props) {
      if (!Object.prototype.hasOwnProperty.call(props, k)) continue;
      if (k === 'texto') n.textContent = props[k];
      else if (k === 'clase') n.className = props[k];
      else n.setAttribute(k, props[k]);
    }
    if (hijos) for (var i = 0; i < hijos.length; i++) if (hijos[i]) n.appendChild(hijos[i]);
    return n;
  }
  function boton(texto, onclick, extra) {
    var b = el('button', { type: 'button', texto: texto });
    if (extra) for (var k in extra) b.setAttribute(k, extra[k]);
    b.addEventListener('click', onclick);
    return b;
  }
  function porId(id) { return doc.getElementById(id); }
  function mensaje(txt, clase) { var m = porId('msg'); m.textContent = txt || ''; m.className = clase || ''; }
  function estadoEn(nodo, txt, clase) { nodo.textContent = txt || ''; nodo.className = 'estado' + (clase ? ' ' + clase : ''); }

  function volverUrl() {
    var v = null;
    try {
      var m = /[?&]volver=([^&]*)/.exec(raiz.location.search || '');
      if (m) v = decodeURIComponent(m[1].replace(/\+/g, ' '));
    } catch (e) { v = null; }
    return (v && /^index\.html(\?[^#]*)?$/.test(v)) ? v : 'index.html';
  }
  var VOLVER = volverUrl();
  function irAlTablero() { raiz.location.replace(VOLVER); }

  function reiniciarInactividad() {
    if (timerInactividad) raiz.clearTimeout(timerInactividad);
    timerInactividad = raiz.setTimeout(irAlTablero, INACTIVIDAD_MS);
  }

  // ---------- formato del "por defecto" ----------
  function textoValor(desc, v) {
    if (desc.sensible) return (v === '' || v === undefined || v === null) ? '(vacío)' : '(cargada)';
    if (v === null || v === undefined) return 'desactivado';
    if (typeof v === 'boolean') return v ? 'SÍ' : 'NO';
    if (desc.tipo === 'franja') return v.desde + ' a ' + v.hasta;
    if (desc.tipo === 'franjaLenta') return v.desde + ' a ' + v.hasta + ', cada ' + v.INTERVALO_S + ' s';
    if (desc.tipo === 'lista') return v.join(', ');
    if (v === '') return '(vacío)';
    if (desc.tipo === 'enum' && ETIQ_OPC[v]) return ETIQ_OPC[v];
    if (desc.ruta === 'VOLUMEN') return Math.round(v * 100) + ' %';
    return String(v);
  }

  // ---------- widgets por tipo ----------
  function widgetEntrada(desc, tipoInput) {
    var props = { type: tipoInput, id: 'c-' + desc.ruta, name: desc.ruta };
    if (tipoInput === 'number') {
      props.step = (desc.tipo === 'entero') ? '1' : 'any';
      props.inputmode = (desc.tipo === 'entero') ? 'numeric' : 'decimal';
    }
    if (desc.tipo === 'texto' && desc.mayus) { props.autocapitalize = 'characters'; props.maxlength = String(desc.largoMax + 6); }
    var inp = el('input', props);
    inp.setAttribute('autocomplete', 'off');
    return { nodo: inp, leer: function () { return inp.value; }, escribir: function (v) { inp.value = (v === null || v === undefined) ? '' : String(v); }, foco: inp };
  }

  function widgetClave(desc) {
    var inp = el('input', { type: 'password', id: 'c-' + desc.ruta, name: desc.ruta, autocomplete: 'new-password', autocapitalize: 'off', spellcheck: 'false' });
    var b = boton('MOSTRAR', function () {
      var ver = inp.type === 'password';
      inp.type = ver ? 'text' : 'password';
      b.textContent = ver ? 'OCULTAR' : 'MOSTRAR';
    });
    return { nodo: el('div', { clase: 'campo-fila' }, [inp, b]), leer: function () { return inp.value; }, escribir: function (v) { inp.value = v || ''; }, foco: inp };
  }

  function widgetBool(desc) {
    var chk = el('input', { type: 'checkbox', id: 'c-' + desc.ruta });
    var lab = el('label', { clase: 'chk', 'for': 'c-' + desc.ruta }, [chk, el('span', { texto: 'ACTIVADO' })]);
    return { nodo: lab, leer: function () { return chk.checked; }, escribir: function (v) { chk.checked = !!v; }, foco: chk, sinEtiqueta: true };
  }

  function widgetEnum(desc) {
    var sel = el('select', { id: 'c-' + desc.ruta, name: desc.ruta });
    desc.opciones.forEach(function (o) {
      var op = el('option', { value: String(o), texto: ETIQ_OPC[o] || String(o).toUpperCase() });
      sel.appendChild(op);
    });
    return { nodo: sel, leer: function () { return sel.value; }, escribir: function (v) { sel.value = String(v); }, foco: sel };
  }

  function widgetVolumen(desc) {
    var rng = el('input', { type: 'range', min: '0', max: '100', step: '5', id: 'c-' + desc.ruta });
    var val = el('span', { clase: 'valor-vol', texto: '80 %' });
    function sync() { val.textContent = rng.value + ' %'; cfgPrueba.VOLUMEN = rng.value / 100; }
    rng.addEventListener('input', sync);
    var nodo = el('div', null, [val, rng]);
    return { nodo: nodo, leer: function () { return rng.value / 100; }, escribir: function (v) { rng.value = String(Math.round((v || 0) * 100)); sync(); }, foco: rng };
  }

  function widgetFranja(desc, conIntervalo) {
    var chk = el('input', { type: 'checkbox', id: 'c-' + desc.ruta });
    var lab = el('label', { clase: 'chk', 'for': 'c-' + desc.ruta }, [chk, el('span', { texto: 'ACTIVA' })]);
    var desde = el('input', { type: 'time', 'aria-label': 'Desde' });
    var hasta = el('input', { type: 'time', 'aria-label': 'Hasta' });
    var fila = el('div', { clase: 'fila franja' }, [el('span', { texto: 'DESDE' }), desde, el('span', { texto: 'HASTA' }), hasta]);
    var inter = null, filaInt = null;
    if (conIntervalo) {
      inter = el('input', { type: 'number', step: '1', inputmode: 'numeric', 'aria-label': 'Intervalo en segundos' });
      filaInt = el('div', { clase: 'fila franja' }, [el('span', { texto: 'CONSULTAR CADA (S)' }), inter]);
    }
    function ver() {
      fila.style.display = chk.checked ? '' : 'none';
      if (filaInt) filaInt.style.display = chk.checked ? '' : 'none';
    }
    chk.addEventListener('change', ver);
    var nodo = el('div', null, [lab, fila, filaInt]);
    return {
      nodo: nodo,
      leer: function () {
        if (!chk.checked) return null;
        var o = { desde: desde.value, hasta: hasta.value };
        if (conIntervalo) o.INTERVALO_S = inter.value;
        return o;
      },
      escribir: function (v) {
        chk.checked = !!v;
        var def = conIntervalo ? { desde: '01:00', hasta: '05:30', INTERVALO_S: 60 } : { desde: '23:00', hasta: '07:00' };
        var x = v || def;
        desde.value = x.desde; hasta.value = x.hasta;
        if (conIntervalo) inter.value = x.INTERVALO_S;
        ver();
      },
      foco: chk
    };
  }

  function widgetLista(desc) {
    var cont = el('div', { id: 'c-' + desc.ruta });
    function fila(nombre, marcado) {
      var chk = el('input', { type: 'checkbox' });
      chk.checked = marcado;
      var lab = el('label', { clase: 'chk' }, [chk, el('span', { texto: ETIQ_OPC[nombre] || nombre.toUpperCase() })]);
      var f = el('div', { clase: 'prov', 'data-prov': nombre }, [lab]);
      f.appendChild(boton('▲', function () { var p = f.previousSibling; if (p) cont.insertBefore(f, p); }, { 'aria-label': 'Subir' }));
      f.appendChild(boton('▼', function () { var n = f.nextSibling; if (n) cont.insertBefore(n, f); }, { 'aria-label': 'Bajar' }));
      return f;
    }
    return {
      nodo: cont,
      leer: function () {
        var out = [];
        for (var i = 0; i < cont.childNodes.length; i++) {
          var f = cont.childNodes[i];
          if (f.getElementsByTagName('input')[0].checked) out.push(f.getAttribute('data-prov'));
        }
        return out;
      },
      escribir: function (v) {
        while (cont.firstChild) cont.removeChild(cont.firstChild);
        var usados = {};
        (Array.isArray(v) ? v : []).forEach(function (p) { if (desc.opciones.indexOf(p) >= 0 && !usados[p]) { usados[p] = true; cont.appendChild(fila(p, true)); } });
        desc.opciones.forEach(function (p) { if (!usados[p]) cont.appendChild(fila(p, false)); });
      },
      foco: cont
    };
  }

  function crearWidget(desc) {
    if (desc.ruta === 'VOLUMEN') return widgetVolumen(desc);
    switch (desc.tipo) {
      case 'num': case 'entero': return widgetEntrada(desc, 'number');
      case 'texto': return widgetEntrada(desc, 'text');
      case 'clave': return widgetClave(desc);
      case 'bool': return widgetBool(desc);
      case 'enum': return widgetEnum(desc);
      case 'franja': return widgetFranja(desc, false);
      case 'franjaLenta': return widgetFranja(desc, true);
      case 'lista': return widgetLista(desc);
    }
    return widgetEntrada(desc, 'text');
  }

  // ---------- formulario ----------
  function leerTodo() {
    var vals = {};
    orden.forEach(function (r) { vals[r] = campos[r].leer(); });
    return vals;
  }

  function mostrarErrores(errores) {
    orden.forEach(function (r) { campos[r].err.textContent = errores[r] || ''; });
  }

  function actualizarAvisos() {
    var v = Ajustes.validar(leerTodo(), CONFIG);
    orden.forEach(function (r) { campos[r].aviso.textContent = v.avisos[r] || ''; });
  }

  function valoresActuales() {
    var v = Ajustes.validar(leerTodo(), CONFIG);
    return { v: v, dif: Ajustes.diferencias(BASE, v.limpio) };
  }

  function cargarEnFormulario(config) {
    orden.forEach(function (r) {
      var v = Ajustes.obtener(config, r);
      var c = campos[r];
      c.escribir(v === undefined ? null : v);
    });
    actualizarAvisos();
  }

  function construirCampo(desc, contenedor, extras) {
    var w = crearWidget(desc);
    var err = el('div', { clase: 'err', role: 'alert' });
    var aviso = el('div', { clase: 'aviso' });
    var base = Ajustes.obtener(BASE, desc.ruta);
    var hijos = [];
    if (extras && extras.arriba) hijos.push(extras.arriba);
    if (!w.sinEtiqueta) hijos.push(el('label', { 'for': 'c-' + desc.ruta, texto: desc.etiqueta }));
    else hijos.push(el('div', { clase: 'etq', texto: desc.etiqueta }));
    if (extras && extras.antes) hijos.push(extras.antes);
    hijos.push(w.nodo);
    if (extras && extras.despues) hijos.push(extras.despues);
    if (desc.ayuda) hijos.push(el('div', { clase: 'ayuda', texto: desc.ayuda }));
    hijos.push(el('div', { clase: 'defecto', texto: 'por defecto: ' + textoValor(desc, base) }));
    hijos.push(err, aviso);
    var cont = el('div', { clase: 'campo', 'data-ruta': desc.ruta }, hijos);
    contenedor.appendChild(cont);
    campos[desc.ruta] = { desc: desc, leer: w.leer, escribir: w.escribir, err: err, aviso: aviso, foco: w.foco, caja: cont };
    orden.push(desc.ruta);
    var alCambiar = function () {
      var r = Ajustes.validarCampo(desc, w.leer());
      err.textContent = r.ok ? '' : r.error;
      actualizarAvisos();
    };
    cont.addEventListener('change', alCambiar);
    return campos[desc.ruta];
  }

  // ---------- extras: ubicación ----------
  function extraUbicacion() {
    var est = el('div', { clase: 'estado' });
    var b = boton('USAR MI UBICACIÓN', function () {
      if (!raiz.navigator || !raiz.navigator.geolocation) {
        estadoEn(est, 'Este navegador no tiene geolocalización.', 'mal');
        return;
      }
      b.disabled = true;
      estadoEn(est, 'Buscando posición... (puede tardar hasta 20 s)');
      raiz.navigator.geolocation.getCurrentPosition(function (p) {
        b.disabled = false;
        var lat = Math.round(p.coords.latitude * 1e5) / 1e5;
        var lon = Math.round(p.coords.longitude * 1e5) / 1e5;
        campos.LAT.escribir(lat); campos.LON.escribir(lon);
        campos.LAT.err.textContent = ''; campos.LON.err.textContent = '';
        estadoEn(est, 'Listo: ' + lat + ', ' + lon + ' (±' + Math.round(p.coords.accuracy) + ' m). Tocá GUARDAR para aplicar.', 'bien');
      }, function (e) {
        b.disabled = false;
        var motivo = (e && e.code === 1) ? 'No diste permiso de ubicación a este navegador.' :
                     (e && e.code === 3) ? 'Se acabó el tiempo sin obtener posición (probá cerca de una ventana).' :
                     'El celu no pudo determinar la posición.';
        var seguro = (raiz.isSecureContext === false) ? ' Además, esta página no está en contexto seguro (https o 127.0.0.1): los navegadores no dejan usar la ubicación así.' : '';
        estadoEn(est, motivo + seguro + ' Podés escribir latitud y longitud a mano.', 'mal');
      }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
    });
    return el('div', null, [b, est]);
  }

  // ---------- extras: orientación ----------
  function extraOrientacion() {
    var fila = el('div', { clase: 'fila cardinales' });
    ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'].forEach(function (c) {
      fila.appendChild(boton(c, function () {
        campos.ORIENTACION_PANTALLA_DEG.escribir(Ajustes.cardinalAGrados(c));
        campos.ORIENTACION_PANTALLA_DEG.err.textContent = '';
      }));
    });
    var est = el('div', { clase: 'estado' });
    var leyendo = false;
    var b = boton('LEER BRÚJULA', function () {
      if (leyendo) return;
      var iniciar = function () {
        leyendo = true; b.disabled = true;
        var muestras = [];
        var manejador = function (ev) { var g = Ajustes.rumboDesdeEvento(ev); if (g !== null) muestras.push(g); };
        raiz.addEventListener('deviceorientationabsolute', manejador, true);
        raiz.addEventListener('deviceorientation', manejador, true);
        var t0 = Date.now();
        var tic = raiz.setInterval(function () {
          var resta = 5 - Math.floor((Date.now() - t0) / 1000);
          if (resta > 0) { estadoEn(est, 'Leyendo... ' + resta + ' s (muestras: ' + muestras.length + '). No muevas el celu.'); return; }
          raiz.clearInterval(tic);
          raiz.removeEventListener('deviceorientationabsolute', manejador, true);
          raiz.removeEventListener('deviceorientation', manejador, true);
          leyendo = false; b.disabled = false;
          if (!muestras.length) {
            estadoEn(est, 'Este celu no entrega brújula (o el navegador no la deja usar en esta página). Elegí el rumbo con los botones.', 'mal');
            return;
          }
          var p = Ajustes.promedioCircular(muestras);
          var grados = Math.round(p.media) % 360;
          campos.ORIENTACION_PANTALLA_DEG.escribir(grados);
          campos.ORIENTACION_PANTALLA_DEG.err.textContent = '';
          var txt = 'Rumbo: ' + grados + '° (R=' + p.r.toFixed(2) + ', ' + muestras.length + ' muestras).';
          if (p.r < 0.9) txt += ' Lectura inestable: alejate de cargadores y metales y repetí.';
          else txt += ' Ojo: es rumbo magnético y se desvía cerca del cargador o de metal.';
          estadoEn(est, txt, p.r < 0.9 ? 'mal' : 'bien');
        }, 250);
      };
      var DOE = raiz.DeviceOrientationEvent;
      if (DOE && typeof DOE.requestPermission === 'function') {
        DOE.requestPermission().then(function (r) {
          if (r === 'granted') iniciar(); else estadoEn(est, 'No diste permiso para el sensor de orientación.', 'mal');
        }, function () { estadoEn(est, 'No se pudo pedir permiso para el sensor de orientación.', 'mal'); });
      } else iniciar();
    });
    var guia = el('div', { clase: 'ayuda', texto: 'Se mide una sola vez. Apoyá el celu plano donde va a quedar el tablero, con la parte de arriba apuntando para el lado contrario a vos (hacia donde mirás). Tocá LEER BRÚJULA, no lo muevas 5 s, guardá y después ponelo en el soporte como quieras.' });
    return el('div', null, [fila, b, est, guia]);
  }

  // ---------- extras: sonido ----------
  function extraSonido() {
    var est = el('div', { clase: 'estado' });
    var b = boton('PROBAR BEEP', function () {
      if (!raiz.Sonido) { estadoEn(est, 'No se cargó el módulo de sonido.', 'mal'); return; }
      try { if (campos.SONIDO) cfgPrueba.SONIDO = campos.SONIDO.leer(); } catch (e) { /* nada */ }
      try { raiz.Sonido.init(cfgPrueba); } catch (e) { /* nada */ }
      raiz.Sonido.desbloquear().then(function () { return raiz.Sonido.beep(); }).then(function (r) {
        estadoEn(est, 'Resultado: ' + String(r).toUpperCase(), (r === 'silencio' || r === 'bloqueado') ? 'mal' : 'bien');
      }, function () { estadoEn(est, 'No se pudo reproducir.', 'mal'); });
    });
    return el('div', null, [b, est]);
  }

  // ---------- copia de seguridad ----------
  function seccionCopia() {
    var ta = el('textarea', { id: 'copia', spellcheck: 'false', autocapitalize: 'off', 'aria-label': 'Ajustes en JSON' });
    var chk = el('input', { type: 'checkbox', id: 'incluir-claves' });
    var lab = el('label', { clase: 'chk', 'for': 'incluir-claves' }, [chk, el('span', { texto: 'INCLUIR CLAVES' })]);
    var est = el('div', { clase: 'estado' });
    var bExp = boton('EXPORTAR', function () {
      var a = valoresActuales();
      if (!a.v.ok) { mostrarErrores(a.v.errores); estadoEn(est, 'Hay campos con error: corregilos antes de exportar.', 'mal'); return; }
      ta.value = Ajustes.exportar(a.dif, { incluirSensibles: chk.checked });
      estadoEn(est, 'Exportados ' + Object.keys(a.dif).length + ' ajustes (los que difieren del defecto).', 'bien');
    });
    var bCop = boton('COPIAR', function () {
      var ok = function () { estadoEn(est, 'Copiado.', 'bien'); };
      var respaldo = function () {
        try { ta.focus(); ta.select(); ta.setSelectionRange(0, ta.value.length); var r = doc.execCommand('copy'); if (r) ok(); else estadoEn(est, 'No se pudo copiar: seleccioná el texto a mano.', 'mal'); }
        catch (e) { estadoEn(est, 'No se pudo copiar: seleccioná el texto a mano.', 'mal'); }
      };
      if (raiz.navigator && raiz.navigator.clipboard && raiz.navigator.clipboard.writeText) {
        raiz.navigator.clipboard.writeText(ta.value).then(ok, respaldo);
      } else respaldo();
    });
    var bImp = boton('IMPORTAR', function () {
      var r = Ajustes.importar(ta.value);
      if (!r.ok) {
        var l = [];
        for (var k in r.errores) if (Object.prototype.hasOwnProperty.call(r.errores, k)) l.push((k || 'texto') + ': ' + r.errores[k]);
        estadoEn(est, 'No se importó nada. ' + l.join(' | '), 'mal');
        return;
      }
      var n = 0;
      for (var ruta in r.valores) {
        if (Object.prototype.hasOwnProperty.call(r.valores, ruta) && campos[ruta]) { campos[ruta].escribir(r.valores[ruta]); campos[ruta].err.textContent = ''; n++; }
      }
      actualizarAvisos();
      estadoEn(est, 'Cargados ' + n + ' ajustes en el formulario. Tocá GUARDAR Y VOLVER para aplicarlos.', 'bien');
    });
    var fs = el('fieldset', { id: 'g-copia' }, [
      el('legend', { texto: 'COPIA DE SEGURIDAD' }),
      el('div', { clase: 'ayuda', texto: 'Exportá los ajustes para guardarlos o pasarlos a otro celu. Pegá un JSON y tocá IMPORTAR para cargarlo (no se guarda hasta que toques GUARDAR).' }),
      el('div', { clase: 'campo' }, [ta]),
      lab,
      el('div', { clase: 'fila dos' }, [bExp, bCop, bImp]),
      est,
      el('div', { clase: 'aviso', texto: 'Ojo: el JSON incluye la ubicación de tu casa. No lo publiques.' })
    ]);
    return fs;
  }

  function seccionClavesLeyenda() {
    return el('div', { clase: 'ayuda', texto: 'Las claves quedan solo en este celu. Con el proxy de Termux viajan por header solo a 127.0.0.1; nunca se mandan a la nube.' });
  }

  function seccionLeyenda() {
    var p = el('div', { clase: 'leyenda' });
    p.innerHTML = '<b>~</b> = calculado por el tablero (puede errar unos minutos).<br>' +
      '<b>PROG</b> = horario programado.<br><b>SALIÓ</b> / <b>LLEGÓ</b> = hora real.<br><b>LLEGA</b> = hora estimada de llegada.<br>' +
      '<b>--:--</b> = sin datos.';
    return el('fieldset', { id: 'g-leyenda' }, [el('legend', { texto: 'CÓMO LEER LOS HORARIOS' }), p]);
  }

  // ---------- acciones ----------
  function almacenFunciona() {
    try {
      raiz.localStorage.setItem('tv.prueba', '1');
      var ok = raiz.localStorage.getItem('tv.prueba') === '1';
      raiz.localStorage.removeItem('tv.prueba');
      return ok;
    } catch (e) { return false; }
  }

  function guardar() {
    var a = valoresActuales();
    mostrarErrores(a.v.errores);
    if (!a.v.ok) {
      mensaje('Hay campos con error (en rojo). Corregilos y volvé a guardar.', 'mal');
      var primero = null;
      for (var i = 0; i < orden.length; i++) if (a.v.errores[orden[i]]) { primero = campos[orden[i]]; break; }
      if (primero && primero.caja.scrollIntoView) primero.caja.scrollIntoView({ block: 'center' });
      return;
    }
    if (!Ajustes.guardar(Ajustes.almacenLocal, a.dif)) {
      mensaje('No se pudo guardar en este navegador.', 'mal');
      return;
    }
    mensaje('Guardado (' + Object.keys(a.dif).length + ' cambios). Volviendo...', 'bien');
    irAlTablero();
  }

  function restablecer() {
    if (!raiz.confirm('¿Borrar todos los ajustes de este celu y volver a los valores por defecto?')) return;
    Ajustes.borrar(Ajustes.almacenLocal);
    cargarEnFormulario(BASE);
    mostrarErrores({});
    mensaje('Ajustes borrados. Tocá VOLVER SIN GUARDAR para volver al tablero con los valores por defecto.', 'bien');
  }

  // ---------- armado ----------
  function iniciar() {
    if (!CONFIG || !raiz.Ajustes) {
      porId('sin-ls').style.display = 'block';
      porId('sin-ls').textContent = 'No se pudo cargar la configuración base (config.js).';
      return;
    }
    var cont = porId('campos');
    var extras = {
      LAT: { arriba: extraUbicacion() },
      ORIENTACION_PANTALLA_DEG: { antes: extraOrientacion() },
      VOLUMEN: { despues: extraSonido() }
    };
    Ajustes.GRUPOS.forEach(function (g) {
      var fs = el('fieldset', { 'data-grupo': g }, [el('legend', { texto: g })]);
      if (g === 'CLAVES') fs.appendChild(seccionClavesLeyenda());
      Ajustes.ESQUEMA.forEach(function (d) { if (d.grupo === g) construirCampo(d, fs, extras[d.ruta]); });
      cont.appendChild(fs);
    });
    cont.appendChild(seccionCopia());
    cont.appendChild(seccionLeyenda());

    cargarEnFormulario(CONFIG);

    var i = Ajustes.info();
    porId('sub').textContent = 'Los cambios se guardan en este celu. Hoy hay ' + i.guardados + ' ajuste' + (i.guardados === 1 ? '' : 's') +
      ' guardado' + (i.guardados === 1 ? '' : 's') + '. Se vuelve solo al tablero tras 5 min sin tocar nada.';

    porId('btn-guardar').addEventListener('click', guardar);
    porId('btn-volver').addEventListener('click', irAlTablero);
    porId('btn-restablecer').addEventListener('click', restablecer);

    if (!almacenFunciona()) {
      var s = porId('sin-ls');
      s.style.display = 'block';
      s.textContent = 'ESTE NAVEGADOR NO GUARDA DATOS (localStorage bloqueado o modo privado). No se pueden guardar ajustes acá.';
      porId('btn-guardar').disabled = true;
    }

    if (raiz.Sonido) { try { raiz.Sonido.init(cfgPrueba); } catch (e) { /* nada */ } }

    ['touchstart', 'mousedown', 'keydown', 'input', 'scroll', 'change'].forEach(function (n) { doc.addEventListener(n, reiniciarInactividad, true); });
    reiniciarInactividad();
    raiz.__configLista = true;
  }

  iniciar();
})(window);
