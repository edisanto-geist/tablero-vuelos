// Configuración del tablero. Prioridad: config.js < config.local.js < ajustes del celu (config.html, 5 toques) < parámetros de URL.
// Para cambios propios usá config.local.js (no se sube al repo):
//   Object.assign(CONFIG, { LAT: -32.85, LON: -60.78 });
// OJO: Object.assign es superficial. Los ajustes anidados se escriben así (no pisar LIMITES entero):
//   CONFIG.LIMITES.opensky = { REPOSO_S: 60, ACTIVO_S: 20, CUPO_DIARIO: 4000 };  // OpenSky con cuenta
//   CONFIG.LIMITES.adsblol = { REPOSO_S: 90, ACTIVO_S: 90, CUPO_DIARIO: 1000 };  // adsb.lol con key adhoc
window.CONFIG = {
  LAT: -32.8500, LON: -60.7833, NOMBRE_LUGAR: 'IBARLUCEA',
  AEROPUERTO_LOCAL: 'ROS',
  RADIO_KM: 30,
  TIMEOUT_SIN_AVIONES_S: 120,
  VOLUMEN: 0.8,
  HORARIO_SILENCIO: { desde: '23:00', hasta: '07:00' },
  BEEP_MIN_ENTRE_S: 10,
  REBEEP_VUELO_S: 300,
  FILAS_POR_PAGINA: 2,
  SEGUNDOS_POR_PAGINA: 8,
  ALTERNAR_L3_S: 4,                  // la 3ª línea alterna datos técnicos / horarios; 0 = no alterna (siempre datos técnicos)
  UNIDAD_ALTITUD: 'm',
  ORIENTACION_PANTALLA_DEG: 0,
  DIST_ENCIMA_KM: 2,
  INCLUIR_EN_TIERRA: false,
  ANIMAR: true,
  PROVEEDOR: 'auto',                 // 'auto' = usa PROVEEDORES en orden con fallback; o un nombre fijo (sin fallback)
  PROVEEDORES: ['adsbfi', 'adsblol', 'opensky', 'airplaneslive'], // prueba en el celu (25/11/2026): airplanes.live da 403 y adsb.fi anda
  INTERVALO_REPOSO_S: 20,
  INTERVALO_ACTIVO_S: 10,            // se usa en ACTIVO y ESPERA
  FRANJA_LENTA: { desde: '01:00', hasta: '05:30', INTERVALO_S: 60 },   // solo en REPOSO; null = desactivada
  LIMITES: {                         // piso de intervalo por proveedor y cupo diario (0 = sin cupo)
    airplaneslive: { REPOSO_S: 5,   ACTIVO_S: 5,   CUPO_DIARIO: 0 },
    adsbfi:        { REPOSO_S: 5,   ACTIVO_S: 5,   CUPO_DIARIO: 0 },
    adsblol:       { REPOSO_S: 180, ACTIVO_S: 180, CUPO_DIARIO: 500 },
    opensky:       { REPOSO_S: 240, ACTIVO_S: 240, CUPO_DIARIO: 400 }
  },
  TIMEOUT_RED_S: 8,
  MAX_EDAD_POSICION_S: 60,           // posiciones más viejas se descartan (fantasmas)
  PROXY: 'auto',                     // 'auto' (GitHub Pages → PROXY_NUBE; 127.0.0.1 → Termux; si no, directo) | '' | 'http://127.0.0.1:8080/api/'
  PROXY_NUBE: 'https://tablero-vuelos-proxy.edisanto.workers.dev/api/', // cloudflare/worker.js
  OPENSKY_CLIENT_ID: '', OPENSKY_CLIENT_SECRET: '',
  ADSBLOL_KEY: '',
  HORARIOS_KEY: '',                  // sensible: va en config.local.js o se carga en el celu desde config.html, nunca en el repo
  HORARIOS_MODO: 'calc',             // 'no' | 'calc' (calculado, con ~) | 'api' (AeroAPI, solo vía proxy)
  HORARIOS_API: 'aeroapi',
  HORARIOS_CUPO_DIARIO: 30,
  HORARIOS_SOLO_LOCAL: false,
  HORARIOS_ESPACIADO_MS: 6500,       // AeroAPI Personal: 10 result sets/min
  ZONA_UTC_MIN: -180,                // Argentina UTC-3, sin Intl
  ENRIQUECER: true,
  ENRIQ_ESPACIADO_MS: 1000,
  ENRIQ_MAX_POR_TICK: 8,
  RUTA_BEEP: 'beep.mp3',
  SONIDO: 'dingdong',                // 'dingdong' (cabina de avión) | 'chime' | 'sintetico' (web/sonidos/*.mp3; sintetico = beep.mp3)
  RUTA_LOGOS: 'logos/', USAR_LOGOS_PNG: true, // logos locales: web/logos/<IATA>.png (los baja termux/bajar_logos.py)
  LOGOS_URL: 'https://content.r9cdn.net/rimg/provider-logos/airlines/v/{IATA}.png', // si no hay local; '' = no usar
  APAGAR_PANTALLA_FISICA: false,
  DEMO: { INTERVALO_CONSULTA_S: 2, TIMEOUT_SIN_AVIONES_S: 20, REBEEP_VUELO_S: 60,
          ACELERACION: 4, CICLO_S: 180, T_INICIAL_S: 0 }
};
