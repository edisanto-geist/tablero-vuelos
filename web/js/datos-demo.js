// Escenario del modo demo (reemplaza al mock.json del CLAUDE.md: fetch no anda en file://).
// Los números de vuelo son ficticios; aerolíneas y aeropuertos son reales.
// ancla: 'ROS' o { marcacionDeg, distKm } medido desde Ibarlucea. En el ancla el avión está en t = tRefS.
window.ESCENARIO_DEMO = [
  { icao24: 'e06541', callsign: 'ARG1541', tipo: 'E190', origen: 'AEP', destino: 'ROS', ancla: 'ROS',
    rumboDeg: 20, velKmh: 280, tRefS: 90, altRefM: 0, vsMs: -4.1, apareceS: 5, desapareceS: 100 },
  { icao24: 'e48a21', callsign: 'GLO7461', tipo: 'B38M', origen: 'ROS', destino: 'GRU', ancla: 'ROS',
    rumboDeg: 20, velKmh: 400, tRefS: 30, altRefM: 0, vsMs: 9, apareceS: 30, desapareceS: 120 },
  { icao24: 'e07404', callsign: 'ARG1404', tipo: 'B738', origen: 'AEP', destino: 'COR',
    ancla: { marcacionDeg: 210, distKm: 12 },
    rumboDeg: 300, velKmh: 820, tRefS: 55, altRefM: 10700, vsMs: 0, apareceS: 16, desapareceS: 94 },
  { icao24: '0c20f1', callsign: 'CMP445', tipo: 'B738', origen: 'ROS', destino: 'PTY', ancla: 'ROS',
    rumboDeg: 350, velKmh: 420, tRefS: 45, altRefM: 0, vsMs: 10, apareceS: 45, desapareceS: 130 },
  { icao24: 'e84371', callsign: 'LPE2371', tipo: 'A320', origen: 'EZE', destino: 'LIM',
    ancla: { marcacionDeg: 45, distKm: 18 },
    rumboDeg: 315, velKmh: 830, tRefS: 70, altRefM: 11300, vsMs: 0, apareceS: 31, desapareceS: 109 },
  { icao24: 'e05120', callsign: 'FBZ5120', tipo: 'B738', origen: 'COR', destino: 'AEP',
    ancla: { marcacionDeg: 210, distKm: 22 },
    rumboDeg: 120, velKmh: 780, tRefS: 65, altRefM: 10100, vsMs: 0, apareceS: 24, desapareceS: 106 },
  { icao24: 'e03420', callsign: 'JES3420', tipo: 'A20N', origen: 'AEP', destino: 'SLA',
    ancla: { marcacionDeg: 60, distKm: 6 },
    rumboDeg: 330, velKmh: 800, tRefS: 95, altRefM: 9800, vsMs: 0, apareceS: 55, desapareceS: 136 },
  { icao24: 'e0f1a7', callsign: 'LVFVZ', tipo: null, origen: null, destino: null,
    ancla: { marcacionDeg: 270, distKm: 8 },
    rumboDeg: 0, velKmh: 180, tRefS: 110, altRefM: 900, vsMs: 0, apareceS: 98, desapareceS: 124 }
];
