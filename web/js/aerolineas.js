// Aerolíneas por prefijo ICAO del callsign. Los colores son aproximados (se usan si no hay logo).
// termux/bajar_logos.py baja los logos de todas las IATA de esta tabla.
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
    ANS: a('ANS', 'OY', 'ANDES LINEAS AEREAS', 'ANDES', '#0072CE', '#FFF'),
    LAP: a('LAP', 'PZ', 'LATAM PARAGUAY', 'LATAM', '#1B0088', '#FFF'),
    BOV: a('BOV', 'OB', 'BOLIVIANA DE AVIACION', 'BOA', '#0A3D8F', '#FFF'),
    AEA: a('AEA', 'UX', 'AIR EUROPA', 'AIR EUROPA', '#0A2C5A', '#FFF'),
    IBE: a('IBE', 'IB', 'IBERIA', 'IBERIA', '#D7192D', '#FFF'),
    AFR: a('AFR', 'AF', 'AIR FRANCE', 'AIR FRANCE', '#002157', '#FFF'),
    KLM: a('KLM', 'KL', 'KLM', 'KLM', '#00A1DE', '#FFF'),
    DLH: a('DLH', 'LH', 'LUFTHANSA', 'LUFTHANSA', '#05164D', '#FFC72C'),
    ITY: a('ITY', 'AZ', 'ITA AIRWAYS', 'ITA', '#0D2A64', '#FFF'),
    BAW: a('BAW', 'BA', 'BRITISH AIRWAYS', 'BRITISH', '#075AAA', '#FFF'),
    UAL: a('UAL', 'UA', 'UNITED AIRLINES', 'UNITED', '#002244', '#FFF'),
    DAL: a('DAL', 'DL', 'DELTA AIR LINES', 'DELTA', '#C8102E', '#FFF'),
    ACA: a('ACA', 'AC', 'AIR CANADA', 'AIR CANADA', '#D22630', '#FFF'),
    AMX: a('AMX', 'AM', 'AEROMEXICO', 'AEROMEXICO', '#0B2343', '#FFF'),
    UAE: a('UAE', 'EK', 'EMIRATES', 'EMIRATES', '#D71921', '#FFF'),
    QTR: a('QTR', 'QR', 'QATAR AIRWAYS', 'QATAR', '#5C0632', '#FFF'),
    THY: a('THY', 'TK', 'TURKISH AIRLINES', 'TURKISH', '#C8102E', '#FFF'),
    ETH: a('ETH', 'ET', 'ETHIOPIAN AIRLINES', 'ETHIOPIAN', '#0A7D3B', '#FFF')
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
