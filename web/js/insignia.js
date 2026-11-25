// Insignia de aerolínea: logo real si lo encuentra; si no, cajita de color con el código IATA.
// Orden de búsqueda del logo (por código IATA, ej. AR):
//   1. local:  CONFIG.RUTA_LOGOS + 'AR.png'  (web/logos/, lo baja termux/bajar_logos.py; no se sube al repo)
//   2. remoto: CONFIG.LOGOS_URL con {IATA} reemplazado ('' = no usar)
//   3. cajita de color (Aerolineas.color) con 'AR'
// Recuerda qué funcionó para cada IATA, así no vuelve a pedir un logo que no existe en cada refresco.
(function (raiz) {
  var AVION = '<svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true">' +
    '<path fill="#FFC81E" d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/></svg>';

  // iata -> índice de la próxima fuente a probar (0 local, 1 remoto, 2 ninguna)
  var estado = {};

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

  function fuentes(cfg, iata) {
    var f = [(cfg.RUTA_LOGOS || 'logos/') + iata + '.png'];
    if (cfg.LOGOS_URL) f.push(String(cfg.LOGOS_URL).replace('{IATA}', iata));
    return f;
  }

  function probar(el, aerolinea, cfg, lista, i) {
    var iata = aerolinea.iata;
    if (i >= lista.length) { estado[iata] = lista.length; caja(el, aerolinea); return; }
    var img = document.createElement('img');
    img.className = 'logo-png';
    img.alt = iata;
    img.onerror = function () {
      estado[iata] = i + 1;
      if (img.parentNode) img.parentNode.removeChild(img);
      probar(el, aerolinea, cfg, lista, i + 1);
    };
    img.onload = function () { estado[iata] = i; };
    el.className = 'insignia con-logo';
    el.style.background = '';
    el.style.color = '';
    el.innerHTML = '';
    el.appendChild(img);
    img.src = lista[i];
  }

  var Insignia = {
    crear: function (aerolinea) {
      var el = document.createElement('span');
      var cfg = raiz.CONFIG || {};
      if (!aerolinea) { generica(el); return el; }
      if (cfg.USAR_LOGOS_PNG && aerolinea.iata) {
        var lista = fuentes(cfg, aerolinea.iata);
        var desde = estado[aerolinea.iata] || 0;
        probar(el, aerolinea, cfg, lista, desde);
        return el;
      }
      caja(el, aerolinea);
      return el;
    },
    _estado: estado
  };
  raiz.Insignia = Insignia;
})(window);
