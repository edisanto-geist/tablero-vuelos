# CLAUDE.md — Tablero de Vuelos (Ibarlucea)

Instrucciones para Claude Code. Leelas antes de tocar cualquier archivo.

## Qué es este proyecto

Convertir un **celular Android viejo** en una decoración tipo **tablero de aeropuerto**
(estilo split-flap / Solari) que:

- Está **en negro / apagado** la mayor parte del tiempo.
- Se **enciende solo** cuando un avión entra en un radio de **30 km** alrededor de
  **Ibarlucea, Santa Fe, Argentina** (lat `-32.8500`, lon `-60.7833` — verificar).
- Suena un **beep corto (0.5 s)** tipo tablero de aeropuerto al detectar actividad.
- Muestra un panel **fondo negro, texto amarillo/blanco grande, tipografía monoespaciada**
  con: **logo de la aerolínea**, aerolínea, número de vuelo, tipo de avión, altitud,
  tiempo estimado (ETA / tiempo al punto más cercano) y **origen → destino en código IATA**
  (ej. `AEP → MDZ`).
- Uso real: Esteban sale al patio a ver el avión pasar, o lo ve en el cielo y mira el celu.
  Por eso el tablero también tiene que decir **hacia dónde mirar**: dirección/rumbo relativo
  a Ibarlucea (ej. `AL NORTE · 12 KM`, flecha) y si se acerca o se aleja. Lectura a 2–3 m de
  distancia: letras muy grandes, poca info por fila.
- Si hay varios aviones, **scroll automático** tipo tablero de arribos/partidas.
- Si pasan **2 minutos** (configurable) sin aviones en el radio → vuelve a negro y silencio.
- Corre **24/7**, sin bloqueo de pantalla y sin intervención manual.

El dueño es Esteban (no es desarrollador full-time). Priorizá **simple, robusto y fácil
de instalar en el celu** por sobre lo elegante.

## Arquitectura objetivo

```
web/        → display en HTML/CSS/JS puro (un solo index.html + assets). Sin frameworks, sin build.
web/beep.mp3→ beep de 0.5 s (generarlo, no bajarlo de internet; ver abajo)
termux/     → scripts opcionales (servidor local, wake de pantalla vía termux-api)
tasker/     → perfil/tareas de Tasker exportados (XML) + explicación paso a paso
docs/       → guías de instalación en el celu y de alimentación/batería
```

Flujo base:
1. `web/index.html` consulta la API cada N segundos (reposo 20 s, activo 10 s; respetar rate limits).
2. Filtra aviones por distancia (haversine) ≤ `RADIO_KM`.
3. Si hay ≥1 → muestra tablero + beep (solo en la transición 0 → ≥1, o cuando entra un vuelo nuevo).
4. Si 0 durante `TIMEOUT_SIN_AVIONES` → pantalla negra total (`#000`, sin nada encendido).
5. Encender físicamente la pantalla: lo resuelve Tasker o Fully Kiosk Browser
   (motion/JS interface `fully.turnScreenOn()`), NO el HTML solo.

## Fuentes de datos

- **Principal: airplanes.live** (`https://api.airplanes.live/v2/point/{lat}/{lon}/{nm}`, formato readsb/ADSBx v2).
  1 consulta por segundo, sin key ni cupo diario, uso no comercial. Trae `t` (tipo de avión) y matrícula.
- **Fallbacks, en orden (`CONFIG.PROVEEDORES`):** adsb.fi (cita obligatoria, v3), adsb.lol (500 consultas/día sin key,
  ODbL) y **OpenSky** (`/api/states/all` con bounding box) como último recurso. `Fuentes` (`web/js/fuentes.js`) maneja
  fallback, enfriamientos tras errores/429, cupos diarios y el intervalo de consulta.
- **OpenSky ya no acepta basic auth**: solo OAuth2 client credentials (`OPENSKY_CLIENT_ID/SECRET`), que desde el
  navegador casi seguro no anda por CORS: usarlo vía el proxy de Termux. Anónimo: ~400 créditos/día.
- Los readsb dan callsign, posición, altitud, velocidad, rumbo, `hex` y tipo; OpenSky **no** da tipo ni aerolínea:
  - Aerolínea → prefijo ICAO del callsign (ARG, JAT, FBZ, LAN/LPE, GLO, AZU…). Tabla local en JS.
  - Tipo de avión → campo `t` de readsb; si falta, adsbdb `/aircraft/{hex}` (`icao_type`), cacheado.
- Origen/destino IATA → adsbdb.com `/callsign/{CS}` (CORS abierto), con caché en localStorage y validación de
  plausibilidad geográfica. Si no hay ruta, mostrar `--- → ---` sin romper el layout. No commitear datos reales de rutas.
- Logo → buscar por código IATA/ICAO de la aerolínea. Preferir **logos guardados localmente**
  en `web/logos/` para las aerolíneas que pasan por Rosario (ARG, JAT, FBZ, LAN/LPE, GLO, AZU,
  AAL, CMP, AVA…), con fallback a un ícono genérico de avión. Verificar licencia de cualquier
  fuente online antes de usarla.
- ETA: no existe ETA real gratis. Calcular **tiempo hasta el punto de máxima aproximación**
  con velocidad y rumbo, y mostrarlo como "ETA" o "SOBRE IBARLUCEA EN 3 MIN".
- **No** usar scraping de Flightradar24 (no tiene API gratuita y viola sus términos).
- CORS: desde `file://` de los proveedores de vuelos no está verificado. `web/diag.html` lo prueba en el celu; si da
  BLOQUEADO, usar `termux/proxy.py` (sirve `web/` en `http://127.0.0.1:8080/` y reenvía `/api/...`).
  Con `--fixtures scripts/fixtures` el proxy responde sin internet (pruebas).

## Beep

- Archivo `web/beep.mp3`, **0.5 s**, tipo "ding-dong"/chime de tablero, generado por código
  (por ej. script Python con numpy + ffmpeg, o Web Audio API sintetizado como fallback).
- Reproducir con `<audio>` o Web Audio API del navegador. Sin apps externas.
- Ojo con autoplay: Chrome/WebView bloquea audio sin interacción. Documentar el workaround
  (Fully Kiosk: "Autoplay audio" habilitado; o primer toque de "arranque").

## Configuración

Todo lo configurable va en un único objeto `CONFIG` al principio del JS (o `config.js`):
`LAT`, `LON`, `RADIO_KM` (30), `INTERVALO_REPOSO_S` (20), `INTERVALO_ACTIVO_S` (10), `TIMEOUT_SIN_AVIONES_S` (120),
`VOLUMEN`, `HORARIO_SILENCIO` (ej. 23:00–07:00 sin beep), `PROVEEDORES`, `LIMITES`, `PROXY`, credenciales opcionales
(OpenSky client id/secret, key de adsb.lol). Ojo: `Object.assign` en `config.local.js` es superficial; los ajustes
anidados van como `CONFIG.LIMITES.opensky = {...}`.

## Convenciones

- Idioma: **español rioplatense** en UI, comentarios y docs. Textos del tablero en MAYÚSCULAS.
- Sin dependencias npm para el display. Tiene que abrir con doble clic / desde `file://` o un
  servidor local simple.
- Pantalla pensada en **horizontal**, resolución baja (celus viejos ~720p). Tipografía grande.
- Fondo realmente `#000` cuando está en reposo (en AMOLED = píxeles apagados).
- Manejar errores de red sin romper: si la API falla, seguir en negro y reintentar.
- Nada de claves ni tokens en el repo: usar `config.local.js` (en `.gitignore`).

## Entregables de documentación (en `docs/`)

1. `instalacion.md`: paso a paso en el celu (Fully Kiosk Browser **o** Tasker + navegador,
   y opción Termux). Ajustes: no bloquear pantalla, optimización de batería desactivada,
   inicio automático al reiniciar.
2. `bateria-y-alimentacion.md`: cómo evitar que la batería se hinche/degrade estando
   siempre enchufada (limitar carga 40–80% con Tasker/AccA o enchufe inteligente,
   cargador de baja potencia, ventilación, opción de quitar batería si el modelo lo permite).

## Cómo trabajar

- Antes de un cambio grande, proponé el plan en 3–5 bullets.
- Probá la lógica de filtrado/distancia con datos mock (`web/js/datos-demo.js`; no se usa JSON porque `fetch` no anda en `file://`) para no depender
  de que pasen aviones reales.
- Agregá un modo demo (`?demo=1`) que muestre aviones falsos para probar el look sin API.
- Commits chicos y descriptivos en español.
