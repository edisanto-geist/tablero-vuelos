// Insignia de aerolínea: cajita de color con el código IATA (no es el logo real).
(function (raiz) {
  var AVION = '<svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true">' +
    '<path fill="#FFC81E" d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/></svg>';

  function generica(el) {
    el.className = 'insignia generica';
    el.style.background = '';
    el.style.color = '';
    el.innerHTML = AVION;
  }
  function caja(el, aerolinea) {
    el.className = 'insignia';
    el.style.background = aerolinea.color;
    el.style.color = aerolinea.colorTexto;
    el.innerHTML = '';
    var t = document.createElement('span');
    t.className = 'iata';
    t.textContent = aerolinea.iata;
    el.appendChild(t);
  }

  var Insignia = {
    crear: function (aerolinea) {
      var el = document.createElement('span');
      var cfg = raiz.CONFIG || {};
      if (!aerolinea) { generica(el); return el; }
      if (cfg.USAR_LOGOS_PNG) {
        var img = document.createElement('img');
        img.className = 'logo-png';
        img.alt = aerolinea.iata;
        img.onerror = function () {
          if (img.parentNode) img.parentNode.removeChild(img);
          caja(el, aerolinea);
        };
        el.className = 'insignia con-logo';
        img.src = (cfg.RUTA_LOGOS || 'logos/') + aerolinea.icao + '.png';
        el.appendChild(img);
        return el;
      }
      caja(el, aerolinea);
      return el;
    }
  };
  raiz.Insignia = Insignia;
})(window);
