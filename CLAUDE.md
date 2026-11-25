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
1. `web/index.html` consulta la API cada N segundos (default 15 s; respetar rate limits).
2. Filtra aviones por distancia (haversine) ≤ `RADIO_KM`.
3. Si hay ≥1 → muestra tablero + beep (solo en la transición 0 → ≥1, o cuando entra un vuelo nuevo).
4. Si 0 durante `TIMEOUT_SIN_AVIONES` → pantalla negra total (`#000`, sin nada encendido).
5. Encender físicamente la pantalla: lo resuelve Tasker o Fully Kiosk Browser
   (motion/JS interface `fully.turnScreenOn()`), NO el HTML solo.

## Fuentes de datos

- **Principal: OpenSky Network REST API** (`/api/states/all` con bounding box `lamin/lomin/lamax/lomax`).
  Gratis, anónimo con límites de créditos; con cuenta gratuita hay más margen. Usar bounding
  box chico (≈ ±0.3° alrededor de Ibarlucea) para gastar menos créditos.
- OpenSky da callsign, posición, altitud, velocidad, rumbo, `icao24`. **No** da aerolínea ni
  tipo de avión directamente:
  - Aerolínea → derivar del prefijo ICAO del callsign (ARG = Aerolíneas Argentinas,
    JAT = JetSMART, FBZ = Flybondi, LAN/LPE = LATAM, GLO = GOL, AZU = Azul, etc.). Tabla local en JS.
  - Tipo de avión → base de aircraft de OpenSky (`icao24` → typecode) o adsbdb.com; cachear.
- Origen/destino IATA → OpenSky no lo da de forma confiable. Usar la API gratuita de
  adsbdb.com (callsign → ruta con códigos IATA/ICAO de aeropuertos). Cachear por callsign.
  Si no hay ruta, mostrar `--- → ---` sin romper el layout.
- Logo → buscar por código IATA/ICAO de la aerolínea. Preferir **logos guardados localmente**
  en `web/logos/` para las aerolíneas que pasan por Rosario (ARG, JAT, FBZ, LAN/LPE, GLO, AZU,
  AAL, CMP, AVA…), con fallback a un ícono genérico de avión. Verificar licencia de cualquier
  fuente online antes de usarla.
- ETA: no existe ETA real gratis. Calcular **tiempo hasta el punto de máxima aproximación**
  con velocidad y rumbo, y mostrarlo como "ETA" o "SOBRE IBARLUCEA EN 3 MIN".
- Alternativa si OpenSky falla o se queda corto: adsb.lol / airplanes.live (API gratuitas
  tipo `/v2/point/{lat}/{lon}/{radio_nm}`). **Verificar** términos y CORS antes de usarlas.
- **No** usar scraping de Flightradar24 (no tiene API gratuita y viola sus términos).
- Si hay problemas de CORS desde el navegador, resolver con un mini proxy en Termux
  (Python/Node) que corra en `localhost` del mismo celu.

## Beep

- Archivo `web/beep.mp3`, **0.5 s**, tipo "ding-dong"/chime de tablero, generado por código
  (por ej. script Python con numpy + ffmpeg, o Web Audio API sintetizado como fallback).
- Reproducir con `<audio>` o Web Audio API del navegador. Sin apps externas.
- Ojo con autoplay: Chrome/WebView bloquea audio sin interacción. Documentar el workaround
  (Fully Kiosk: "Autoplay audio" habilitado; o primer toque de "arranque").

## Configuración

Todo lo configurable va en un único objeto `CONFIG` al principio del JS (o `config.js`):
`LAT`, `LON`, `RADIO_KM` (30), `INTERVALO_CONSULTA_S` (15), `TIMEOUT_SIN_AVIONES_S` (120),
`VOLUMEN`, `HORARIO_SILENCIO` (ej. 23:00–07:00 sin beep), credenciales OpenSky opcionales.

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
- Probá la lógica de filtrado/distancia con datos mock (`web/mock.json`) para no depender
  de que pasen aviones reales.
- Agregá un modo demo (`?demo=1`) que muestre aviones falsos para probar el look sin API.
- Commits chicos y descriptivos en español.
