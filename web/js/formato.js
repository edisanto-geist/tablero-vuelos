// Textos de ancho fijo para las celdas del tablero. Puro.
(function (raiz) {
  function ajustar(s, n) {
    s = String(s);
    if (s.length > n) return s.slice(0, n);
    while (s.length < n) s += ' ';
    return s;
  }
  function miles(n) {
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  }
  function altitud(v, config) {
    if (v.altitudM === null || v.altitudM === undefined) return '---';
    if (config.UNIDAD_ALTITUD === 'ft') {
      return miles(Math.round(v.altitudM * 3.28084 / 100) * 100) + ' FT';
    }
    return miles(Math.round(v.altitudM / 50) * 50) + ' M';
  }
  function estado(v, config) {
    var loc = config.AEROPUERTO_LOCAL;
    if (v.encima) return 'ENCIMA';
    if (loc && v.destino === loc && v.velVerticalMs !== null && v.velVerticalMs < -1) return 'ATERRIZA ' + loc;
    if (loc && v.origen === loc && v.velVerticalMs !== null && v.velVerticalMs > 1 &&
        v.altitudM !== null && v.altitudM < 4000) return 'DESPEGA ' + loc;
    if (v.seAcerca && v.minutosAlPaso !== null) {
      if (v.minutosAlPaso < 1) return 'ACERCA · YA';
      var n = Math.min(99, Math.round(v.minutosAlPaso));
      // Con 2 dígitos no entra el punto medio en 14 celdas.
      return n < 10 ? 'ACERCA · ' + n + ' MIN' : 'ACERCA ' + n + ' MIN';
    }
    return 'SE ALEJA';
  }

  var Formato = {
    ancho: { vuelo: 8, ruta: 7, direccion: 19, aerolinea: 11, tipo: 4, altitud: 9, estado: 14, nombre: 22 },
    ajustar: ajustar,
    fila: function (v, config) {
      var w = Formato.ancho;
      var km = Math.max(1, Math.round(v.distanciaKm));
      var dir = v.encima ? 'ARRIBA · ' + km + ' KM' : 'AL ' + v.cardinal + ' · ' + km + ' KM';
      return {
        vuelo: ajustar(v.vuelo, w.vuelo),
        ruta: ajustar((v.origen || '---') + '→' + (v.destino || '---'), w.ruta),
        direccion: ajustar(dir, w.direccion),
        aerolinea: ajustar(v.aerolinea ? v.aerolinea.nombreCorto : '---', w.aerolinea),
        nombre: ajustar(v.aerolinea ? v.aerolinea.nombre : '---', w.nombre),
        tipo: ajustar(v.tipo || '----', w.tipo),
        altitud: ajustar(altitud(v, config), w.altitud),
        estado: ajustar(estado(v, config), w.estado)
      };
    }
  };
  raiz.Formato = Formato;
  if (typeof module === 'object' && module.exports) module.exports = Formato;
})(typeof window !== 'undefined' ? window : globalThis);
