// Sonido del tablero: beep tipo "ding-dong" de aeropuerto.
// Interfaz (ver docs/spec-fase1.md §1.1): window.Sonido
//   init(config?), beep() -> Promise<string>, desbloquear() -> Promise<boolean>,
//   estaDesbloqueado(), enHorarioSilencio(fecha?)
// beep() NUNCA rechaza y nada de aca tira excepciones.
// Vias, en orden: Web Audio (mp3 decodificado desde BEEP_MP3_BASE64) -> <audio>
// (beep.mp3) -> osciladores (mismo sonido sintetizado). Chrome/WebView bloquean
// el audio hasta el primer gesto del usuario (tocar la pantalla) o hasta que
// Fully Kiosk tenga "Autoplay audio" activado.
(function (raiz) {
  'use strict';

  var DEFAULTS = { VOLUMEN: 0.8, HORARIO_SILENCIO: null, RUTA_BEEP: 'beep.mp3', SONIDO: 'dingdong' };
  var EVENTOS_GESTO = ['pointerdown', 'touchstart', 'keydown', 'click'];
  var MIN_ENTRE_BEEPS_MS = 300;
  var ESPERA_RESUME_MS = 300;

  var cfg = null;
  var iniciado = false;
  var ctx = null;
  var buffer = null;
  var audioEl = null;
  var audioCebado = false;
  var ultimoBeepMs = 0;
  var sonidoCargado = null;     // qué CONFIG.SONIDO está decodificado / en el <audio>

  // CONFIG.SONIDO: 'dingdong' | 'chime' | 'sintetico' (web/sonidos/<nombre>.mp3; sintetico = beep.mp3)
  function sonidoElegido() {
    var n = String(leer('SONIDO') || 'sintetico');
    return (raiz.BEEP_SONIDOS && raiz.BEEP_SONIDOS[n]) ? n : 'sintetico';
  }
  function base64Elegido() {
    var n = sonidoElegido();
    return (raiz.BEEP_SONIDOS && raiz.BEEP_SONIDOS[n]) || raiz.BEEP_MP3_BASE64 || null;
  }
  function rutaElegida() {
    var n = sonidoElegido();
    return n === 'sintetico' ? leer('RUTA_BEEP') : 'sonidos/' + n + '.mp3';
  }

  // La config puede traer FORZAR ('webaudio' | 'audio' | 'osc') solo para pruebas;
  // en el tablero real no se define.
  function leer(clave) {
    var v = cfg && cfg[clave];
    return (v === undefined || v === null) ? (clave === 'HORARIO_SILENCIO' ? null : DEFAULTS[clave]) : v;
  }

  function volumen() {
    var v = Number(leer('VOLUMEN'));
    if (isNaN(v)) v = DEFAULTS.VOLUMEN;
    return Math.max(0, Math.min(1, v));
  }

  function aMinutos(hhmm) {
    var m = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(String(hhmm));
    if (!m) return null;
    return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  }

  function enHorarioSilencio(fecha) {
    try {
      var h = leer('HORARIO_SILENCIO');
      if (!h) return false;
      var d = aMinutos(h.desde);
      var hasta = aMinutos(h.hasta);
      if (d === null || hasta === null || d === hasta) return false;
      var f = fecha instanceof Date ? fecha : new Date();
      var m = f.getHours() * 60 + f.getMinutes();
      if (d < hasta) return m >= d && m < hasta;
      return m >= d || m < hasta; // cruza medianoche
    } catch (e) {
      return false;
    }
  }

  function decodificarBase64(b64) {
    var bin = atob(b64);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
  }

  function crearContexto() {
    try {
      var AC = raiz.AudioContext || raiz.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
    } catch (e) {
      ctx = null;
    }
  }

  function decodificarBuffer() {
    try {
      sonidoCargado = sonidoElegido();
      var b64 = base64Elegido();
      if (!ctx || !b64) return;
      ctx.decodeAudioData(decodificarBase64(b64),
        function (b) { buffer = b; },
        function () { buffer = null; });
    } catch (e) {
      buffer = null;
    }
  }

  function crearAudio() {
    try {
      if (typeof raiz.Audio !== 'function') return;
      audioEl = new raiz.Audio(rutaElegida());
      audioEl.preload = 'auto';
    } catch (e) {
      audioEl = null;
    }
  }

  function esperarResume() {
    // resume() puede quedar pendiente para siempre sin gesto: no esperamos mas de 300 ms.
    return new Promise(function (resolve) {
      var listo = false;
      function fin() { if (!listo) { listo = true; resolve(); } }
      try {
        var p = ctx.resume();
        if (p && p.then) p.then(fin, fin);
      } catch (e) { /* sigue con el timeout */ }
      setTimeout(fin, ESPERA_RESUME_MS);
    });
  }

  function corriendo() {
    return !!ctx && ctx.state === 'running';
  }

  function estaDesbloqueado() {
    return corriendo();
  }

  function cebarAudio() {
    // volumen 0 -> play -> pause -> currentTime=0 -> restaurar volumen
    return new Promise(function (resolve) {
      if (!audioEl) return resolve();
      try {
        var vol = audioEl.volume;
        audioEl.volume = 0;
        var p = audioEl.play();
        var fin = function (ok) {
          try {
            audioEl.pause();
            audioEl.currentTime = 0;
            audioEl.volume = vol;
          } catch (e) { /* nada */ }
          if (ok) audioCebado = true;
          resolve();
        };
        if (p && p.then) p.then(function () { fin(true); }, function () { fin(false); });
        else fin(true);
      } catch (e) {
        resolve();
      }
    });
  }

  function desbloquear() {
    return new Promise(function (resolve) {
      try {
        if (!iniciado) init();
        var tareas = [];
        if (ctx) {
          tareas.push(esperarResume().then(function () {
            try {
              if (corriendo()) {
                var s = ctx.createBufferSource();
                s.buffer = ctx.createBuffer(1, 1, ctx.sampleRate || 44100);
                s.connect(ctx.destination);
                s.start(0);
              }
            } catch (e) { /* nada */ }
          }));
        }
        tareas.push(cebarAudio());
        Promise.all(tareas).then(function () { resolve(estaDesbloqueado()); },
                                 function () { resolve(estaDesbloqueado()); });
      } catch (e) {
        resolve(false);
      }
    });
  }

  function alGesto() {
    try {
      if (!estaDesbloqueado() || (audioEl && !audioCebado)) desbloquear();
    } catch (e) { /* nada */ }
  }

  // Si cambió CONFIG.SONIDO (ej. desde config.html), decodifica el nuevo y rehace el <audio>.
  function recargarSiCambio() {
    try {
      if (sonidoCargado === sonidoElegido()) return;
      buffer = null;
      decodificarBuffer();
      crearAudio();
      audioCebado = false;
    } catch (e) { /* nunca tira */ }
  }

  function init(config) {
    try {
      if (config) cfg = config;
      else if (!cfg) cfg = raiz.CONFIG || DEFAULTS;
      if (iniciado) { recargarSiCambio(); return; }
      iniciado = true;
      crearContexto();
      decodificarBuffer();
      crearAudio();
      if (raiz.document && raiz.document.addEventListener) {
        for (var i = 0; i < EVENTOS_GESTO.length; i++) {
          raiz.document.addEventListener(EVENTOS_GESTO[i], alGesto, true);
        }
      }
    } catch (e) { /* nunca tira */ }
  }

  // Mismo sonido que scripts/generar_beep.py, sintetizado en vivo.
  function osciladores() {
    var t0 = ctx.currentTime + 0.02;
    var maestro = ctx.createGain();
    var pico = volumen() * 0.708 / 1.4;
    maestro.gain.setValueAtTime(pico, t0);
    maestro.gain.setValueAtTime(pico, t0 + 0.47);
    maestro.gain.linearRampToValueAtTime(0, t0 + 0.5);
    maestro.connect(ctx.destination);
    var notas = [[1046.5, 0], [880, 0.2]];
    var armonicos = [[1, 1], [2, 0.3], [3, 0.1]];
    for (var n = 0; n < notas.length; n++) {
      var ini = t0 + notas[n][1];
      var env = ctx.createGain();
      env.gain.setValueAtTime(0, ini);
      env.gain.linearRampToValueAtTime(1, ini + 0.005);
      env.gain.setTargetAtTime(0, ini + 0.005, 0.12);
      env.connect(maestro);
      for (var a = 0; a < armonicos.length; a++) {
        var osc = ctx.createOscillator();
        var g = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = notas[n][0] * armonicos[a][0];
        g.gain.value = armonicos[a][1];
        osc.connect(g);
        g.connect(env);
        osc.start(ini);
        osc.stop(t0 + 0.52);
      }
    }
  }

  function esNoPermitido(e) {
    return !!e && (e.name === 'NotAllowedError' || /not allowed|user gesture|interact/i.test(String(e.message || '')));
  }

  function reproducirAudio() {
    // Promise<'audio' | 'bloqueado' | 'fallo'>
    return new Promise(function (resolve) {
      try {
        if (!audioEl) return resolve('fallo');
        audioEl.volume = volumen();
        try { audioEl.currentTime = 0; } catch (e) { /* nada */ }
        var p = audioEl.play();
        if (p && p.then) {
          p.then(function () { resolve('audio'); },
                 function (e) { resolve(esNoPermitido(e) ? 'bloqueado' : 'fallo'); });
        } else {
          resolve('audio');
        }
      } catch (e) {
        resolve(esNoPermitido(e) ? 'bloqueado' : 'fallo');
      }
    });
  }

  function beepInterno() {
    return new Promise(function (resolve) {
      var forzar = leer('FORZAR');

      function viaAudio() {
        return reproducirAudio().then(function (r) {
          if (r === 'audio') return 'audio';
          if (corriendo()) return viaOsc();
          return r === 'bloqueado' ? 'bloqueado' : 'error';
        });
      }
      function viaOsc() {
        if (!corriendo()) return 'bloqueado';
        try { osciladores(); return 'osciladores'; } catch (e) { return 'error'; }
      }

      var previo = ctx ? esperarResume() : Promise.resolve();
      previo.then(function () {
        if (forzar === 'osc') return viaOsc();
        if (forzar !== 'audio' && corriendo() && buffer) {
          try {
            var src = ctx.createBufferSource();
            var gan = ctx.createGain();
            src.buffer = buffer;
            gan.gain.value = volumen();
            src.connect(gan);
            gan.connect(ctx.destination);
            src.start(0);
            return 'webaudio';
          } catch (e) { /* cae a las otras vias */ }
        }
        return viaAudio();
      }).then(resolve, function () { resolve('error'); });
    });
  }

  function beep() {
    return new Promise(function (resolve) {
      var fin = function (r) {
        try { console.log('[sonido] beep ->', r); } catch (e) { /* nada */ }
        resolve(r);
      };
      try {
        if (!iniciado) init();
        var ahora = Date.now();
        if (ultimoBeepMs && ahora - ultimoBeepMs < MIN_ENTRE_BEEPS_MS) return fin('ignorado');
        ultimoBeepMs = ahora;
        if (volumen() <= 0 || enHorarioSilencio()) return fin('silencio');
        recargarSiCambio();
        beepInterno().then(fin, function () { fin('error'); });
      } catch (e) {
        fin('error');
      }
    });
  }

  var Sonido = {
    init: init,
    beep: beep,
    desbloquear: desbloquear,
    estaDesbloqueado: estaDesbloqueado,
    enHorarioSilencio: enHorarioSilencio
  };

  raiz.Sonido = Sonido;
  if (typeof module === 'object' && module.exports) module.exports = Sonido;
})(typeof window !== 'undefined' ? window : globalThis);
