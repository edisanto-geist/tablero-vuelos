// Acceso a la configuración desde el tablero: 5 toques en menos de 3 s en cualquier lugar (también con la pantalla negra).
// No hace preventDefault, así el desbloqueo de sonido sigue funcionando.
// Además: si otra pestaña guarda ajustes (evento storage de tv.ajustes.v1), recarga el tablero.
(function (raiz) {
  'use strict';
  var TOQUES = 5, VENTANA_MS = 3000, ANTIREBOTE_MS = 50;
  var CLAVE = 'tv.ajustes.v1';
  var marcas = [];

  function archivoActual() {
    var p = (raiz.location && raiz.location.pathname) || '';
    var a = p.split('/').pop();
    return a || 'index.html';
  }

  function urlConfig() {
    return 'config.html?volver=' + encodeURIComponent(archivoActual() + (raiz.location.search || ''));
  }

  // Devuelve true si este toque completa la secuencia. Puro, para poder probarlo.
  function registrar(ahoraMs) {
    var ult = marcas.length ? marcas[marcas.length - 1] : -1e12;
    if (ahoraMs - ult < ANTIREBOTE_MS) return false;
    marcas.push(ahoraMs);
    while (marcas.length && ahoraMs - marcas[0] > VENTANA_MS) marcas.shift();
    if (marcas.length >= TOQUES) { marcas = []; return true; }
    return false;
  }

  var AccesoConfig = { registrar: registrar, urlConfig: urlConfig };
  raiz.AccesoConfig = AccesoConfig;
  if (typeof module === 'object' && module.exports) module.exports = AccesoConfig;

  if (!raiz.document || !raiz.document.addEventListener) return;
  var hayTouch = ('ontouchstart' in raiz);
  raiz.document.addEventListener(hayTouch ? 'touchstart' : 'mousedown', function () {
    if (registrar(Date.now())) {
      try { raiz.location.href = urlConfig(); } catch (e) { /* nada */ }
    }
  }, true);

  if (raiz.addEventListener) {
    raiz.addEventListener('storage', function (e) {
      if (e && e.key === CLAVE) { try { raiz.location.reload(); } catch (x) { /* nada */ } }
    });
  }
})(typeof window !== 'undefined' ? window : globalThis);
