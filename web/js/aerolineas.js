// Aerolíneas por prefijo ICAO del callsign. Los colores son aproximados, no son logos.
(function (raiz) {
  function a(icao, iata, nombre, corto, color, texto) {
    return { icao: icao, iata: iata, nombre: nombre, nombreCorto: corto, color: color, colorTexto: texto };
  }
  var TABLA = {
    ARG: a('ARG', 'AR', 'AEROLINEAS ARGENTINAS', 'AEROLINEAS', '#1B5FAA', '#FFF'),
    JES: a('JES', 'WJ', 'JETSMART', 'JETSMART', '#1E2A78', '#FFF'),
    JAT: a('JAT', 'JA', 'JETSMART', 'JETSMART', '#1E2A78', '#FFF'),
    FBZ: a('FBZ', 'FO', 'FLYBONDI', 'FLYBONDI', '#FFC72C', '#000'),
    LAN: a('LAN', 'LA', 'LATAM AIRLINES', 'LATAM', '#1B0088', '#FFF'),
    LPE: a('LPE', 'LP', 'LATAM PERU', 'LATAM', '#1B0088', '#FFF'),
    TAM: a('TAM', 'JJ', 'LATAM BRASIL', 'LATAM', '#1B0088', '#FFF'),
    GLO: a('GLO', 'G3', 'GOL LINHAS AEREAS', 'GOL', '#FF7020', '#FFF'),
    AZU: a('AZU', 'AD', 'AZUL LINHAS AEREAS', 'AZUL', '#003A8C', '#FFF'),
    CMP: a('CMP', 'CM', 'COPA AIRLINES', 'COPA', '#0033A0', '#FFF'),
    AVA: a('AVA', 'AV', 'AVIANCA', 'AVIANCA', '#DA291C', '#FFF'),
    AAL: a('AAL', 'AA', 'AMERICAN AIRLINES', 'AMERICAN', '#0078D2', '#FFF'),
    SKU: a('SKU', 'H2', 'SKY AIRLINE', 'SKY', '#00205B', '#FFF'),
    AZP: a('AZP', 'ZP', 'PARANAIR', 'PARANAIR', '#00A3E0', '#FFF'),
    ANS: a('ANS', 'OY', 'ANDES LINEAS AEREAS', 'ANDES', '#0072CE', '#FFF')
  };
  var Aerolineas = {
    tabla: TABLA,
    buscar: function (icao) {
      if (!icao) return null;
      var k = String(icao).toUpperCase();
      return Object.prototype.hasOwnProperty.call(TABLA, k) ? TABLA[k] : null;
    }
  };
  raiz.Aerolineas = Aerolineas;
  if (typeof module === 'object' && module.exports) module.exports = Aerolineas;
})(typeof window !== 'undefined' ? window : globalThis);
