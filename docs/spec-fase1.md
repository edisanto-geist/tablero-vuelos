# Especificación Fase 1 — Tablero de Vuelos Ibarlucea (modo demo)

Fuente de verdad general: `CLAUDE.md` y `docs/roadmap.md`. Esta spec la diseñó el agente arquitecto (Opus) y la implementan dos programadores en paralelo: **Paquete A (tablero web)** y **Paquete B (beep)**.

Entorno verificado: `python3` (numpy, PIL), `ffmpeg` con `libmp3lame`, `node` 22, `google-chrome` (capturas headless).

Coordenadas:
- Ibarlucea: lat −32.8500, lon −60.7833. La casa exacta va en `config.local.js`.
- Aeropuerto de Rosario (ROS/SAAR): −32.9036, −60.7850, unos 6 km al SUR (rumbo ≈182°). Las salidas por la pista 02 pasan a 1–2 km de Ibarlucea.

> `CLAUDE.md` menciona `web/mock.json`. Se reemplaza por `web/js/datos-demo.js` porque `fetch` no funciona en `file://`.

---

## 0. Reglas comunes (A y B)

- **JS:**
  - Scripts clásicos (`<script src>`), sin `type="module"`, sin npm, sin build.
  - Se puede usar ES2015 (`let`/`const`, arrow, template strings, `Promise`).
  - No usar `async`/`await`, `?.`, `??` ni campos de clase (WebViews viejos).
- **Patrón de módulo:** IIFE que cuelga un único global. Los módulos puros también exportan a node:
  ```js
  (function (raiz) { var Geo = {...}; raiz.Geo = Geo;
    if (typeof module === 'object' && module.exports) module.exports = Geo;
  })(typeof window !== 'undefined' ? window : globalThis);
  ```
- **CSS:** cada `min()` lleva antes una línea de fallback (`font-size: 11vh; font-size: min(13vh, 7vw);`). Flexbox, no grid.
- **`file://`:** tiene que abrir así. Nada de `fetch`/XHR a archivos locales; los datos van como JS que define globales.
- **Idioma:** español rioplatense. La UI va en MAYÚSCULAS.
- **Fuente:** `font-family: "Droid Sans Mono","Noto Sans Mono","Roboto Mono","DejaVu Sans Mono","Courier New",monospace; font-weight:700;`. Sin fuentes remotas.

---

## 1. Archivos y paquetes

### Paquete A — tablero web

| Archivo | Responsabilidad |
|---|---|
| `web/index.html` | DOM y orden de scripts (abajo). `<body class="reposo">` |
| `web/css/tablero.css` | Estética, layout, celdas split-flap, animación flap, clases de estado |
| `web/js/config.js` | `window.CONFIG` (§2.1) |
| `web/js/geo.js` | `Geo`, funciones puras (§2.3) |
| `web/js/aerolineas.js` | `Aerolineas`: tabla por prefijo ICAO y `Aerolineas.buscar(icao)` |
| `web/js/datos.js` | `Datos.normalizar(crudo, config, ahoraMs)` → vuelo. `Datos.procesar(crudos, config, ahoraMs)` → filtrados y ordenados |
| `web/js/formato.js` | `Formato.fila(vuelo, config)` → textos de ancho fijo (§4.3). Puro |
| `web/js/datos-demo.js` | `window.ESCENARIO_DEMO` (§5) |
| `web/js/proveedores/demo.js` | `Proveedores.demo` (§2.4) |
| `web/js/insignia.js` | `Insignia.crear(aerolinea)` → nodo DOM (§4.5) |
| `web/js/tablero.js` | `Tablero`: render, celdas flap, paginado, reloj, pantalla "sin tráfico" (§4) |
| `web/js/app.js` | URL params, overrides demo, loop, máquina de estados (§3), `Pantalla`, cooldown de beep, overlay debug |
| `web/test.html` | Corre en el navegador los mismos tests que `scripts/test_logica.js` y muestra OK/FALLA |
| `scripts/test_logica.js` | `node scripts/test_logica.js`: require de geo, aerolineas, datos y formato; aserciones; exit 0/1 |
| `web/logos/README.md` | Hook futuro `logos/<ICAO>.png`. En Fase 1 no se suben logos |

Orden de scripts en `index.html`:
1. `config.js`
2. `config.local.js` (opcional; su 404 es el único error aceptado)
3. `geo.js`
4. `aerolineas.js`
5. `datos.js`
6. `formato.js`
7. `datos-demo.js`
8. `proveedores/demo.js`
9. `insignia.js`
10. `tablero.js`
11. `beep-data.js` (B)
12. `sonido.js` (B)
13. `app.js`

### Paquete B — beep

| Archivo | Responsabilidad |
|---|---|
| `scripts/generar_beep.py` | Sintetiza con stdlib (`math`, `wave`, `struct`, `base64`, `subprocess`) y codifica con ffmpeg. Escribe `web/beep.mp3` y `web/js/beep-data.js`. Opción `--wav RUTA`. Sin ffmpeg: mensaje claro y `exit 1` |
| `web/beep.mp3` | Generado y commiteado |
| `web/js/beep-data.js` | Generado: `window.BEEP_MP3_BASE64 = "<base64>";` con encabezado "ARCHIVO GENERADO, no editar" |
| `web/js/sonido.js` | `window.Sonido` (§1.1) |
| `web/prueba-sonido.html` | Carga `js/config.js` (si falta, define un CONFIG inline). Botones Desbloquear y Beep; `?forzar=webaudio\|audio\|osc`. Muestra estado y resultado |

**Sonido** (idéntico en el script y en el fallback con osciladores):
- Formato: 44 100 Hz, mono, exactamente 0,500 s (22 050 muestras).
- Nota 1, "ding": C6 = 1046,50 Hz, arranca en t = 0,000 s.
- Nota 2, "dong": A5 = 880,00 Hz, arranca en t = 0,200 s.
- Timbre de cada nota: `1·f + 0.3·2f + 0.1·3f`.
- Envolvente de cada nota: ataque lineal de 5 ms y caída `exp(−t/0.12)`.
- Fade-out lineal en los últimos 30 ms hasta 0 exacto.
- Normalizado a pico 0,708 (−3 dBFS).
- Codificación: `ffmpeg -y -f wav -i <tmp.wav> -ac 1 -ar 44100 -codec:a libmp3lame -b:a 96k web/beep.mp3` (el WAV temporal va en `tempfile` y se borra).

### 1.1 Interfaz A ↔ B: `window.Sonido`

```
Sonido.init(config?)        // idempotente. Usa config, o window.CONFIG, o defaults
                            // {VOLUMEN:0.8, HORARIO_SILENCIO:null, RUTA_BEEP:'beep.mp3'}.
                            // Lee VOLUMEN/HORARIO_SILENCIO al momento de cada beep.
                            // Registra una sola vez (capture) pointerdown/touchstart/keydown/click → desbloquear(). Nunca tira excepción.
Sonido.beep()               // -> Promise<string>, NUNCA rechaza:
                            //   'webaudio' | 'audio' | 'osciladores' | 'silencio' | 'bloqueado' | 'ignorado' (<300 ms del anterior) | 'error'
Sonido.desbloquear()        // -> Promise<boolean>
Sonido.estaDesbloqueado()   // -> boolean
Sonido.enHorarioSilencio(fecha?) // -> boolean
```

**Qué hace A:**
- `Sonido.init(CONFIG)` una vez.
- `Sonido.beep()` según §3; el resultado va al overlay de debug.
- `estaDesbloqueado()` decide si se muestra "SIN SONIDO · TOCÁ".
- Siempre con guarda `if (window.Sonido)`.

**Qué hace B:**
- **AudioContext:** `AudioContext || webkitAudioContext`, creado en `init`.
- **Buffer:** base64 → ArrayBuffer → `decodeAudioData` en forma de callbacks.
- **`<audio>`:** `new Audio(CONFIG.RUTA_BEEP)` con `preload='auto'`. Funciona en file://; el fetch del mp3 no.
- **Desbloqueo:**
  1. `ctx.resume()`.
  2. Reproducir un buffer silencioso de 1 muestra.
  3. Cebar el `<audio>`: volumen 0 → `play` → `pause` → `currentTime=0` → restaurar volumen.
- **`beep()`:**
  1. Silencio → `'silencio'`.
  2. Contexto no running → `resume()` con espera de hasta 300 ms.
  3. Running y con buffer → `BufferSource` + `GainNode` en VOLUMEN → `'webaudio'`.
  4. Si no → `<audio>.play()` → `'audio'`.
  5. Si el contexto está running → osciladores → `'osciladores'`.
  6. `NotAllowedError` → `'bloqueado'`.
- **`HORARIO_SILENCIO`:** `{desde:'HH:MM', hasta:'HH:MM'}` o `null`. `desde` es inclusivo y `hasta` exclusivo; cruza medianoche si `desde > hasta`.
- **Log:** `console.log('[sonido] beep ->', resultado)`.

---

## 2. Esquemas

### 2.1 CONFIG (`web/js/config.js`)

```js
window.CONFIG = {
  LAT: -32.8500, LON: -60.7833, NOMBRE_LUGAR: 'IBARLUCEA',
  AEROPUERTO_LOCAL: 'ROS',
  RADIO_KM: 30,
  INTERVALO_CONSULTA_S: 15,
  TIMEOUT_SIN_AVIONES_S: 120,
  VOLUMEN: 0.8,
  HORARIO_SILENCIO: { desde: '23:00', hasta: '07:00' },
  BEEP_MIN_ENTRE_S: 10,
  REBEEP_VUELO_S: 300,
  FILAS_POR_PAGINA: 2,
  SEGUNDOS_POR_PAGINA: 8,
  UNIDAD_ALTITUD: 'm',
  ORIENTACION_PANTALLA_DEG: 0,
  DIST_ENCIMA_KM: 2,
  INCLUIR_EN_TIERRA: false,
  ANIMAR: true,
  PROVEEDOR: 'opensky',
  OPENSKY_USUARIO: '', OPENSKY_CLAVE: '',
  RUTA_BEEP: 'beep.mp3',
  RUTA_LOGOS: 'logos/', USAR_LOGOS_PNG: false,
  APAGAR_PANTALLA_FISICA: false,
  DEMO: { INTERVALO_CONSULTA_S: 2, TIMEOUT_SIN_AVIONES_S: 20, REBEEP_VUELO_S: 60,
          ACELERACION: 4, CICLO_S: 180, T_INICIAL_S: 0 }
};
```

- `config.local.js` hace `Object.assign(CONFIG, {...})`.
- Con `?demo=1`, los valores de `DEMO` (intervalo, timeout, rebeep) pisan los de la raíz y `PROVEEDOR` pasa a `'demo'`.

Parámetros de URL:
- `demo=1`
- `t=<s>`: se guarda en `DEMO.T_INICIAL_S`.
- `debug=1`: overlay de estado.
- `animar=0`: sin animación flap.
- `filas=3`

### 2.2 Estado crudo (formato tipo OpenSky)

```
{ icao24, callsign, lat, lon, altitudBaroM, velocidadMs, rumboDeg, velVerticalMs, enTierra, tsPosicion,
  tipo?, origen?, destino? }   // cualquier campo puede ser null
```

### 2.3 Vuelo normalizado

```
{ id (icao24 en minúsculas), callsign (trim, mayúsculas, '' si falta),
  vuelo ('AR 1541' = IATA + ' ' + número sin ceros a la izquierda; si no hay prefijo, el callsign),
  aerolinea {icao,iata,nombre,nombreCorto,color,colorTexto} | null,
  tipo|null, origen|null, destino|null,
  lat, lon, altitudM|null, velocidadKmh|null, rumboDeg|null, velVerticalMs|null, enTierra,
  distanciaKm, marcacionDeg (del observador al avión), cardinal, encima (dist < DIST_ENCIMA_KM),
  seAcerca, minutosAlPaso|null, distanciaPasoKm|null, actualizadoMs }
```

- **Prefijo:** solo cuenta si el callsign arranca con 3 letras `[A-Z]` seguidas de un dígito (`LVFVZ` no tiene).
- **`procesar`:**
  1. Normaliza cada estado.
  2. Descarta los que no tienen lat/lon, los que están a más de `RADIO_KM` y los `enTierra` (salvo `INCLUIR_EN_TIERRA`).
  3. Ordena por distancia ascendente.

**Geo** (R = 6371,0088 km):
- `distanciaKm(lat1,lon1,lat2,lon2)`: haversine.
- `rumboDeg(lat1,lon1,lat2,lon2)`: rumbo inicial, en [0,360).
- `destino(lat,lon,rumboDeg,distKm)` → `{lat,lon}`. Acepta distancia negativa.
- `cardinal(deg)`: 8 sectores centrados. NORTE = [337,5, 22,5). NORTE, NORESTE, ESTE, SURESTE, SUR, SUROESTE, OESTE, NOROESTE.
- `aproximacion(obsLat,obsLon,lat,lon,rumboDeg,velKmh)` → `{minutos, distMinKm, seAcerca}`:
  1. Proyección equirectangular local en km: `x = ΔlonRad·R·cos(obsLat)`, `y = ΔlatRad·R`.
  2. Velocidad: `v = (sin θ, cos θ)·velKmh/60` km/min.
  3. `t* = −(p·v)/|v|²`.
  4. `seAcerca = t* > 0.05`.
  5. `minutos = seAcerca ? t* : 0`.
  6. `distMinKm = |p + v·max(t*,0)|`.
  7. Si `velKmh` es null o menor a 30 → `{minutos:null, distMinKm:dist, seAcerca:false}`.
- `boundingBox(lat,lon,radioKm)` → `{lamin,lamax,lomin,lomax}`.

### 2.4 Contrato de proveedor

```
window.Proveedores = window.Proveedores || {};
Proveedores.<nombre> = { nombre, obtenerEstados: function (ahoraMs) { return Promise<EstadoCrudo[]>; } }
```

- `app.js` usa `Proveedores[CONFIG.PROVEEDOR]`.
- Si no existe, o si la promesa rechaza o tarda más de 10 s:
  - el tick cuenta como 0 aviones;
  - se loguea `console.warn("[app] proveedor 'opensky' no disponible en Fase 1")`;
  - reintenta en el siguiente tick.
- El proveedor demo devuelve también aviones fuera del radio.

**Aerolíneas** (colores aproximados, no son logos; `nombre` = nombre completo, ej. AEROLINEAS ARGENTINAS):

| ICAO | IATA | nombreCorto | color | colorTexto |
|---|---|---|---|---|
| ARG | AR | AEROLINEAS | #1B5FAA | #FFF |
| JES | WJ | JETSMART | #1E2A78 | #FFF |
| JAT | JA | JETSMART | #1E2A78 | #FFF |
| FBZ | FO | FLYBONDI | #FFC72C | #000 |
| LAN | LA | LATAM | #1B0088 | #FFF |
| LPE | LP | LATAM | #1B0088 | #FFF |
| TAM | JJ | LATAM | #1B0088 | #FFF |
| GLO | G3 | GOL | #FF7020 | #FFF |
| AZU | AD | AZUL | #003A8C | #FFF |
| CMP | CM | COPA | #0033A0 | #FFF |
| AVA | AV | AVIANCA | #DA291C | #FFF |
| AAL | AA | AMERICAN | #0078D2 | #FFF |
| SKU | H2 | SKY | #00205B | #FFF |
| AZP | ZP | PARANAIR | #00A3E0 | #FFF |
| ANS | OY | ANDES | #0072CE | #FFF |

---

## 3. Máquina de estados (`app.js`)

Estados: `REPOSO`, `ACTIVO` y `ESPERA`, reflejados como clase de `<body>`. El tick es una cadena de `setTimeout` sin solapamiento: el primero corre al cargar y después uno cada `INTERVALO_CONSULTA_S`.

| Desde | Condición | Hacia | Acciones |
|---|---|---|---|
| REPOSO | n>0 | ACTIVO | `Pantalla.encender()`, render, **beep siempre** |
| ACTIVO | n>0 | ACTIVO | render; beep si hay un id sin ver en los últimos `REBEEP_VUELO_S` |
| ACTIVO | n==0 | ESPERA | `tSinAviones = ahora`; pantalla "SIN VUELOS EN 30 KM" |
| ESPERA | n>0 | ACTIVO | render; beep solo si hay un id nuevo |
| ESPERA | ahora−tSinAviones ≥ TIMEOUT | REPOSO | `Tablero.ocultar()`, cortar timers de página y reloj, `Pantalla.apagar()` |

**Registro de vistos:**
- `vistos` es un mapa `id → últimoMs`. Se actualiza con todos los ids de cada tick y se purgan los de más de 10 min.
- **Cooldown:** si el último intento de beep fue hace menos de `BEEP_MIN_ENTRE_S`, no se llama. Tampoco queda en cola.

**`Pantalla`:**
- `encender()`: llama `fully.turnScreenOn()` si existe `window.fully`, y pide el `navigator.wakeLock` de pantalla (con try/catch).
- `apagar()`: libera el wake lock, y llama `fully.turnScreenOff` solo si `APAGAR_PANTALLA_FISICA`.

**REPOSO:** `background:#000; cursor:none`, `#tablero` con `display:none`, sin animaciones, reloj ni texto. Solo corre el timer de consulta, y el overlay si está `debug=1`.

**Aviso de sonido:** si `!Sonido.estaDesbloqueado()`, el encabezado muestra "SIN SONIDO · TOCÁ" en gris mientras está ACTIVO.

---

## 4. Layout (horizontal; ~640×360 px CSS en un 720p con DPR 2; todo en vh/vw)

**Colores:**
- Fondo: `#000`.
- Amarillo `#FFC81E`: vuelo y dirección.
- Blanco `#F2F2F2`: ruta.
- Gris `#9A9A9A`: L3 y encabezado.
- `#555`: texto "sin tráfico".
- Celdas: fondo `#141414` con una costura de 1px `#000` al medio (linear-gradient), separación de 0,06em y radio de 0,08em.

### 4.1 Estructura

- **Encabezado** (10vh, letra `min(5.5vh, 3vw)`, gris):
  - Izquierda: `CIELO DE IBARLUCEA · 30 KM`.
  - Derecha: aviso de sonido, `1/4` (si hay más de una página) y `HH:MM` (se actualiza cada 30 s, solo en ACTIVO).
- **Cuerpo** (90vh): `FILAS_POR_PAGINA` filas iguales con separadores de 0,4vh `#222`.

Fila normal (2 por página, unos 44vh cada una):

| Línea | Tamaño | Contenido |
|---|---|---|
| L1 | `min(13vh, 7vw)` | `[INSIGNIA 1.15em]` + **vuelo** (amarillo, 8 celdas) … a la derecha **ruta** (blanco, 7 celdas) |
| L2 | `min(10vh, 5.6vw)` | `[FLECHA SVG 1em]` + **dirección** (amarillo, 19 celdas) |
| L3 | `min(6vh, 3.3vw)` | **aerolínea**(11) · **tipo**(4) · **altitud**(9) · **estado**(14), en gris, separados por ` · ` |

Con `filas=3`, todos los tamaños se multiplican por 0,7.

### 4.2 Casos según cantidad de aviones

- **n = 1, modo destacado** (`#tablero.uno`): una fila de 90vh.
  - L1 `min(18vh, 9.5vw)`.
  - L2 `min(14vh, 7.5vw)`.
  - L3 en dos renglones `min(8vh, 4.4vw)`: (nombre completo hasta 22 · tipo) y (altitud · estado).
  - Sin indicador de página.
- **2 ≤ n ≤ FILAS:** una página fija.
- **n > FILAS:**
  - Páginas de FILAS aviones; avanzan cada `SEGUNDOS_POR_PAGINA` en forma circular.
  - Los huecos de la última página se rellenan con filas de celdas vacías.
  - Si el índice de página queda fuera de rango, vuelve a 0.
- **ESPERA:** encabezado más `SIN VUELOS EN 30 KM` centrado, en `#555`, a `min(8vh, 4.5vw)`.

Se usa paginado y no scroll continuo: el texto en movimiento no se lee a 3 m, y el paginado es fiel a un Solari.

### 4.3 Textos (`Formato.fila`): ancho fijo, relleno con espacios a la derecha o truncado

- **vuelo (8):** `vuelo`.
- **ruta (7):** `ORIGEN→DESTINO`, con `---` si falta alguno (`---→---`).
- **dirección (19):** `ARRIBA · 1 KM` si `encima`; si no, `AL ${cardinal} · ${round(km)} KM`.
- **aerolínea (11):** `nombreCorto`, o `---`.
- **tipo (4):** el tipo, o `----`.
- **altitud (9):**
  - En metros: redondeada a 50 y con punto de miles (`10.700 M`).
  - En pies: redondeada a 100 (`35.100 FT`).
  - Si falta: `---`.
- **estado (14):** gana la primera regla que se cumpla.
  1. `encima` → `ENCIMA`.
  2. `destino==AEROPUERTO_LOCAL` y `velVerticalMs < −1` → `ATERRIZA ROS`.
  3. `origen==AEROPUERTO_LOCAL` y `velVerticalMs > 1` y `altitudM < 4000` → `DESPEGA ROS`.
  4. `seAcerca` y menos de 1 min → `ACERCA · YA`.
  5. `seAcerca` → `ACERCA · N MIN` (N = `min(99, round)`).
  6. En otro caso → `SE ALEJA`.
- **flecha:** `rotate((marcacionDeg − ORIENTACION_PANTALLA_DEG) mod 360)` con transición de 600 ms. Si `encima`, en lugar de la flecha va un círculo con punto (SVG).

### 4.4 Split-flap

- Cada `.campo` tiene N `<span class="celda">`.
- **En cada tick:** solo las celdas que cambian de carácter reciben `.flap`: `rotateX` 0→90°, cambio de carácter, 90→0°, en 180 ms (solo transform).
- **Al cambiar de página:** todas las celdas pasan por 2 caracteres aleatorios (A–Z, 0–9) antes del final, escalonadas 15 ms por índice. Todo dura 900 ms o menos.
- `ANIMAR=false` o `animar=0` → cambio instantáneo.

### 4.5 Insignia

- **Aerolínea conocida:** caja de 1.15em con `border-radius: 18%`, fondo `color` y el IATA en `colorTexto` a 0.55em en negrita.
- **Sin aerolínea:** SVG de avión genérico amarillo sobre `#222`.
- **Logos PNG:** si `USAR_LOGOS_PNG && aerolinea`, `<img src=RUTA_LOGOS+icao+'.png'>` con `onerror` que vuelve a la insignia. En Fase 1 está en false.

---

## 5. Modo demo

**Reloj del demo:**
- `tCiclo = ((ahoraMs − inicioMs)/1000 + DEMO.T_INICIAL_S) mod CICLO_S`.
- `dtSim = (tCiclo − tRef)·ACELERACION`. Los minutos de "ACERCA" quedan en tiempo simulado (×4); hay que dejarlo comentado en el código.

**Ancla:**
- `'ROS'` → (−32.9036, −60.7850).
- `{marcacionDeg, distKm}` → `Geo.destino` desde Ibarlucea. En los sobrevuelos es el punto de máxima aproximación, perpendicular al rumbo.

**Movimiento:**
- `pos = Geo.destino(ancla, rumbo, velKmh/3600·dtSim)`.
- `alt = altRef + vs·dtSim`. Si da 0 o menos: `alt = 0` y `enTierra = true`.
- Solo sale en la lista si `apareceS ≤ tCiclo ≤ desapareceS`.

| # | icao24 | callsign | tipo | ruta | ancla | rumbo | km/h | tRef | altRef | vs | aparece–desaparece | en radio ≈ |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | e06541 | ARG1541 | E190 | AEP→ROS | ROS | 20 | 280 | 90 | 0 | −4.1 | 5–100 | 13–90 (aterriza) |
| 2 | e48a21 | GLO7461 | B38M | ROS→GRU | ROS | 20 | 400 | 30 | 0 | +9 | 30–120 | 32–110 (ENCIMA ≈ t43) |
| 3 | e07404 | ARG1404 | B738 | AEP→COR | {210°,12km} | 300 | 820 | 55 | 10700 | 0 | 16–94 | 25–85 |
| 4 | 0c20f1 | CMP445 | B738 | ROS→PTY | ROS | 350 | 420 | 45 | 0 | +10 | 45–130 | 47–122 (ENCIMA ≈ t58) |
| 5 | e84371 | LPE2371 | A320 | EZE→LIM | {45°,18km} | 315 | 830 | 70 | 11300 | 0 | 31–109 | 44–96 |
| 6 | e05120 | FBZ5120 | B738 | COR→AEP | {210°,22km} | 120 | 780 | 65 | 10100 | 0 | 24–106 | 42–89 |
| 7 | e03420 | JES3420 | A20N | AEP→SLA | {60°,6km} | 330 | 800 | 95 | 9800 | 0 | 55–136 | 62–128 |
| 8 | e0f1a7 | LVFVZ | null | null→null | {270°,8km} | 0 | 180 | 110 | 900 | 0 | 98–124 | 98–124 (privado) |

Los números de vuelo son ficticios; las aerolíneas y los aeropuertos son reales.

**Línea de tiempo esperada** (ciclo de 180 s, tick de 2 s, timeout de 20 s):
- 0–12 s: negro.
- ≈13: entra el vuelo 1 → ACTIVO, modo destacado y beep.
- ≈25: entra el vuelo 3 → 2 filas y beep.
- 62–85: pico de 7 aviones, 4 páginas.
- ≈128: ESPERA.
- ≈148: REPOSO.
- Beeps cerca de 13, 25, 42, 62 y 98.

Atajos: `?t=70` salta al pico y `?t=20` al modo destacado.

---

## 6. Criterios de aceptación

### A

1. `node scripts/test_logica.js` termina con exit 0, y `web/test.html` muestra todo OK. Casos:
   - `distanciaKm(Ibarlucea, ROS)` = 5,95 ± 0,1 y `rumboDeg` = 181 ± 2 → `SUR`.
   - Ida y vuelta con `destino` a 73° y 25 km, y también con −10 km.
   - `cardinal`: 0→NORTE, 22.4→NORTE, 22.6→NORESTE, 180→SUR, 225→SUROESTE, 270→OESTE, 359→NORTE.
   - `aproximacion`:
     - 20 km al N, rumbo 180, 600 km/h → `seAcerca`, 2,0 ± 0,05 min, distMin ≈ 0.
     - El mismo con rumbo 0 → no se acerca.
     - (−10 E, −10 N), rumbo 0, 600 km/h → 1,0 min y distMin 10 ± 0,1.
     - 10 km/h → `minutos` null.
   - `normalizar`: `ARG01541` → `AR 1541`; `LVFVZ` → aerolínea null y `vuelo` = `LVFVZ`.
   - `procesar` filtra (más de 30 km, en tierra, sin lat/lon) y ordena por distancia.
   - `Formato.fila` devuelve anchos exactos, también con nulls.
2. `index.html?demo=1` desde file:// no muestra errores en consola, salvo el 404 de `config.local.js`. Tampoco hay excepciones si faltan `sonido.js` o `beep-data.js`.
3. `google-chrome --headless --window-size=1280,720 --virtual-time-budget=3000 --screenshot=/tmp/r.png "file://…/index.html?demo=1&t=2"` → todos los píxeles (0,0,0).
4. `?demo=1&t=20&animar=0`: modo destacado con `AR 1541`, `AEP→ROS`, `AL SUR · 2x KM`, `ATERRIZA ROS` e insignia AR azul.
5. `?demo=1&t=70&animar=0` a 1280×720, 640×360, 1024×768 y 1440×720: muestra `1/4`, 2 filas y ningún `.campo` desborda (con `debug=1` se loguea warning si alguno desborda).
6. Paginado: 1/4 → 2/4 → 3/4 → 4/4 → 1/4 cada 8 ± 1 s. La página 4 tiene 1 fila más una vacía. El flap dura 900 ms o menos.
7. Ciclo completo (`debug=1`):
   - ACTIVO a los 13 ± 3 s.
   - ESPERA a los 128 ± 3 s.
   - REPOSO a los 148 ± 4 s.
   - Se repite.
8. Beeps:
   - nunca con menos de 10 s entre uno y otro;
   - siempre uno al pasar de REPOSO a ACTIVO;
   - ninguno en un tick sin vuelo nuevo;
   - entre 4 y 6 por ciclo.
9. El vuelo 8 sale con avión genérico, `LVFVZ`, `---→---`, `----` y `---`. Los vuelos 2 y 4 muestran `ARRIBA · …` y el círculo cuando están a menos de 2 km.
10. Sin `?demo`: pantalla negra, un warning por intento y ningún crash en 2 min.
11. En REPOSO: `#tablero` con `display:none`, sin intervals de página ni de reloj.
12. `ORIENTACION_PANTALLA_DEG=90` gira las flechas −90°.

### B

1. `python3 scripts/generar_beep.py` usa solo stdlib + ffmpeg. Escribe el mp3 y `beep-data.js`, imprime la duración y da el mismo resultado si se corre dos veces.
2. `ffprobe`: duración de 0,45 a 0,60 s, mono, 44 100 Hz, menos de 12 KB.
3. Con `--wav`:
   - exactamente 22 050 muestras;
   - los primeros 2 ms y los últimos 20 ms por debajo del 1 % de fondo de escala, y la última muestra en 0;
   - pico 0,708 ± 0,02;
   - pico de la FFT entre 0 y 0,19 s en 1046 ± 10 Hz, y entre 0,25 y 0,45 s en 880 ± 10 Hz.
4. Decodificar el base64 da bytes idénticos al mp3.
5. `prueba-sonido.html` desde file://:
   - antes de tocar → `'bloqueado'`, sin excepciones ni unhandled rejection;
   - después de un clic → `'webaudio'`;
   - con `?forzar=audio` → `'audio'`;
   - con `?forzar=osc` → `'osciladores'`.
6. Con `--autoplay-policy=no-user-gesture-required` → `'webaudio'` sin tocar.
7. `VOLUMEN = 0` → `'silencio'`. Con `HORARIO_SILENCIO` 23:00→07:00:
   - 23:30 → true; 06:59 → true; 23:00 → true;
   - 07:00 → false; 22:59 → false;
   - con `null` → siempre false.
8. Dos `beep()` con menos de 300 ms de diferencia → el segundo da `'ignorado'`.
9. Únicos globales: `Sonido` y `BEEP_MP3_BASE64`. Se respetan las restricciones de §0.
10. `init()` dos veces no duplica listeners ni contextos.
