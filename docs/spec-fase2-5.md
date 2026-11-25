# Especificación Fase 2.5: pantalla de configuración y horarios (SAL/ETA)

Esta spec la diseñó el agente arquitecto (Opus) y la implementan dos programadores en paralelo: **Paquete A (configuración)** y **Paquete B (horarios, layout y red)**.

Siguen valiendo las reglas de spec-fase1 §0:
- ES2015, sin async/await, sin `?.` ni `??`.
- IIFE con `module.exports`.
- Sin npm.
- CSS: fallback antes de cada `min()`, sin grid.

Hoy `node scripts/test_logica.js` da 60 tests OK.

---

## 1. Investigación: horarios gratis (nov 2026)

| Fuente | Cupo gratis | Key / CORS | Términos | Campos útiles | Veredicto |
|---|---|---|---|---|---|
| **FlightAware AeroAPI, plan Personal** | Gratis hasta US$5/mes (US$10 si sos feeder). Límite de 10 result sets/min. `GET /flights/{ident}` cuesta US$0,005, o sea unas 1000 consultas/mes ≈ 33/día | Header `x-apikey`. `start`/`end` hasta 10 días atrás y 2 adelante. `ident_type=designator`, ident ICAO. CORS no documentado: va **solo por proxy** (la key nunca va al navegador ni al repo) | Personal/académico | `scheduled_out`/`actual_out`/`estimated_in`/`scheduled_in`/`actual_in` (más `_off`/`_on`), `origin.code_iata`, `destination.code_iata`, `progress_percent` | **ELEGIDA** para el nivel (b) |
| AeroDataBox | 400 unidades/mes ≈ 6 consultas/día | Header de RapidAPI | No comercial, cita, caché máx. 7 días | — | No alcanza. Posible adaptador futuro |
| AirLabs | ¿1000/mes? (dato de 2021, sin verificar) | `api_key` en la query | — | `dep_time`/`dep_actual`/`arr_estimated` | Sin verificar. Candidato a 2º adaptador |
| Aviationstack | 100/mes | — | — | — | No sirve |
| OpenSky `/flights` | Gratis | — | — | — | Batch nocturno: solo datos de ayer. No sirve en vivo |
| adsb.lol / FR24 | — | — | — | — | No |

**Consumo estimado:** 30–80 callsigns por día. La caché por `callsign|fecha local` hace **1 consulta por vuelo y por día**. Con `HORARIOS_CUPO_DIARIO=30` son unas 900 consultas/mes, dentro de los US$5. El módulo cuenta `distintosHoy` y lo muestra en debug y en diag, para medir el número real.

---

## 2. Decisiones

1. **Prioridad de configuración:** `config.js` < `config.local.js` < localStorage `tv.ajustes.v1` < parámetros de URL.
   - Los ajustes se aplican en un script nuevo, `web/js/ajustes.js`, que carga justo después de `config.local.js`.
   - Así lo ven también `diag.html` y `prueba-sonido.html`.
2. **Se guardan solo las diferencias** con la base (config.js + config.local.js) en el momento de guardar.
3. **Cómo se llega a la configuración:**
   - **5 toques en menos de 3 s en cualquier lugar**, incluso con la pantalla negra en REPOSO. Abren `config.html?volver=<index.html+query>`.
   - No se usa preventDefault, así que el desbloqueo de sonido sigue funcionando.
   - También se puede entrar directo a `/config.html`.
   - `config.html` vuelve sola al tablero después de 5 min sin tocar nada, sin guardar.
4. **Cómo se aplican los cambios:** Guardar → `location.replace(volver)`.
   - Las cachés `tv.enriq.v1`, `tv.cupos.v1` y `tv.horarios.v1` no se tocan.
   - `app.js` hace flush de las cachés en `pagehide`.
   - El tablero recarga si recibe el evento `storage` de `tv.ajustes.v1`.
5. **`ORIENTACION_PANTALLA_DEG`** es el rumbo hacia el que mira una persona parada frente al tablero (hacia donde apunta la espalda del celu). La fórmula actual no cambia.
   - **Leer brújula:** el celu va acostado, con la parte de arriba apuntando hacia donde mira Esteban parado frente al tablero.
   - Rumbo = `webkitCompassHeading`; si no existe, `(360 − alpha) % 360` de `deviceorientationabsolute`, o de `deviceorientation` con `absolute===true`.
   - Se toman 5 s de muestras y se promedian con media circular.
   - Advertencias: lecturas inestables si R < 0,9; cerca del cargador o de metal se desvía; el rumbo es magnético.
6. **Horarios, nivel (a): calculado** (default `HORARIOS_MODO='calc'`).
   - Se marca con `~`.
   - La salida estimada se redondea a 5 min (a 1 min si el origen está a ≤ 60 km).
   - Si falta algún dato → `--:--`.
7. **Horarios, nivel (b): API.** AeroAPI **solo a través del proxy** (Termux o Worker con secret). Prioridad de cada campo: **real > est > prog > calc**.
8. **Hora:** desfase fijo `ZONA_UTC_MIN=-180`, sin Intl. Formato 24 h.
9. **Credenciales desde config.html:** `Red.pedirJSON` agrega headers `X-TV-*` **solo** si la base es el proxy local (`/api/`, 127.0.0.1 o localhost). Nunca se mandan al Worker.

---

## 3. Esquemas congelados

### 3.1 Claves nuevas en `CONFIG` (planas; las escribe A en config.js)

```js
ALTERNAR_L3_S: 4,             // 0 = L3 no alterna (siempre datos técnicos)
HORARIOS_MODO: 'calc',        // 'no' | 'calc' | 'api'
HORARIOS_API: 'aeroapi',
HORARIOS_CUPO_DIARIO: 30,
HORARIOS_SOLO_LOCAL: false,
HORARIOS_ESPACIADO_MS: 6500,  // AeroAPI Personal: 10 result sets/min
HORARIOS_KEY: '',             // sensible: va en config.local.js o en el celu, nunca en el repo
ZONA_UTC_MIN: -180,
```

`FILAS_POR_PAGINA` solo admite 2 o 3.

### 3.2 Campos nuevos del EstadoCrudo (opcionales)

- `ruta: {oLat,oLon,dLat,dLon}`: lo pone `Enriquecer.aplicar` cuando aplica una ruta plausible.
- `horarioApi: {fuente:'aeroapi', salidaRealMs, salidaProgMs, etaEstMs, etaProgMs, llegadaRealMs, origen, destino}`: lo pone `h.aplicar`. Cada campo puede ser `null`.

### 3.3 Campos nuevos del vuelo normalizado (`Datos.normalizar` llama a `Horarios.completar`)

```
oLat,oLon,dLat,dLon   number|null  (de crudo.ruta o de Horarios.AEROPUERTOS[iata])
salidaMs              number|null
salidaTipo            'real'|'prog'|'calc'|null
salidaProgMs          number|null
etaMs                 number|null
etaTipo               'real'|'est'|'prog'|'calc'|null
etaProgMs             number|null
horarioFuente         'aeroapi'|'calc'|null
```

Si `Horarios` no está cargado, todos estos campos valen null.

### 3.4 `web/js/horarios.js` → global `Horarios` (B)

```
Horarios.AEROPUERTOS   {IATA:[lat,lon]}: ROS,AEP,EZE,COR,MDZ,SLA,TUC,JUJ,IGR,BRC,NQN,FTE,USH,MDQ,BHI,CRD,REL,SFN,PRA,RES,CNQ,
                       MVD,ASU,GRU,GIG,FLN,POA,SCL,LIM,PTY,BOG,MIA (coordenadas de OurAirports, dominio público).
                       Tienen que coincidir: ROS -32.9036,-60.785; AEP -34.5592,-58.4156; SLA -24.856,-65.4862
Horarios.coords(iata) -> {lat,lon}|null
Horarios.tramoMin(dKm, gsKmh, altM) -> minutos
   d<=60  : d / ((gs+250)/2) * 60 + 1
   d<=250 : d / max(gs,550) * 60 + 4
   si no  : v = (altM!==null && altM>=6000) ? gs : max(gs,780);  d / v * 60 + 8
Horarios.calcular(v, config, ahoraMs) -> {salidaMs, salidaTipo, etaMs, etaTipo}   // 'calc' o null
   Requiere velocidadKmh>=150 y !enTierra.
   ETA: con coords de destino, dD = Geo.distanciaKm(avión, destino).
        Si dD<3 y altitudM<300 → ahora. Si no → ahora + tramoMin(dD).
        Redondeo a 1 min si faltan ≤30 min; si no, a 5 min. Más de 18 h → null.
   Salida: con coords de origen, dO = dist(origen, avión). Si dO<3 → null.
        ahora − tramoMin(dO). Redondeo a 1 min si dO≤60; si no, a 5 min.
Horarios.parsearAeroapi(json, ahoraMs) -> horarioApi|null
   Elige de json.flights[]:
     (1) el que está en vuelo (actual_off||actual_out, sin actual_on/actual_in); si hay varios, el de actual más reciente;
     (2) si no, el no aterrizado con scheduled_out más cercano a ahora;
     (3) si no, el scheduled_out más cercano.
   Mapeo: salidaRealMs=actual_out||actual_off, salidaProgMs=scheduled_out||scheduled_off, etaEstMs=estimated_in||estimated_on,
   etaProgMs=scheduled_in||scheduled_on, llegadaRealMs=actual_in||actual_on (Date.parse del ISO), origen/destino=code_iata.
   Array vacío o JSON raro → null.
Horarios.combinar(calc, api, v, ahoraMs) -> campos de §3.3
   Si api.llegadaRealMs < ahora−30min y el avión está en el aire (alt>300) → se ignora api (vuelo equivocado).
   salida: real > prog > calc.  eta: real > est > prog > calc.
Horarios.completar(v, config, ahoraMs) -> v   // MODO 'no' → todo null; usa crudo.horarioApi solo si MODO==='api'
Horarios.fechaLocal(ms, config) -> 'YYYY-MM-DD'   (con ZONA_UTC_MIN)
Horarios.crear(config, red, almacen, alActualizar) -> h
   h.aplicar(crudos, ahoraMs)   sincrónico: pone crudo.horarioApi desde caché; si origen/destino del crudo son null y la API los trae, los completa
   h.pedir(vuelos, ahoraMs)     cuenta distintosHoy; encola; no bloquea
   h.drenar() -> Promise
   h.info() -> {activo, motivo, fecha, usados, cupo, cola, enVuelo, distintosHoy, ultimoStatus, pausaHastaMs, bloqueadoHoy}
   h.guardarAhora()
```

**Reglas de `crear`**
- **Activo** solo si `HORARIOS_MODO==='api'` y `red.proxyBase()!==''`. Si no, `aplicar` y `pedir` no hacen nada, y `motivo` vale `'modo'` o `'sin proxy'`.
- **Candidatos:** callsign `/^[A-Z]{3}[0-9][A-Z0-9]*$/`, dentro de los primeros `ENRIQ_MAX_POR_TICK`.
  - Con `SOLO_LOCAL`, solo los vuelos con origen o destino igual a `AEROPUERTO_LOCAL`.
  - Los locales van primero en la cola.
- **Clave de caché:** `CS|fechaLocal`.
- **Consultas:** una por vez, separadas por `HORARIOS_ESPACIADO_MS`. La URL es `red.url('aeroapi','flights/'+CS+'?ident_type=designator&start='+iso(ahora−20h)+'&end='+iso(ahora+4h))`, con iso sin milisegundos (`toISOString().replace(/\.\d{3}Z$/,'Z')`).
- **Cupo:** `usados` cuenta cada pedido que sale. Con `usados >= HORARIOS_CUPO_DIARIO` no se pide más hasta que cambie la fecha local.

| Respuesta | Qué se hace |
|---|---|
| 200 y parsea | Se guarda el valor, TTL 18 h, se persiste y se llama `alActualizar` |
| 200 sin vuelo o 404 | Se guarda `null`, TTL 18 h, se persiste |
| 429 | Pausa de 10 min, se reencola al principio, no se cachea |
| 401/403 | `bloqueadoHoy=true` hasta que cambie la fecha; log `[horarios] clave inválida` |
| 0, 5xx o timeout | `null` solo en memoria, por 5 min |

**Persistencia:** `'tv.horarios.v1' = {fecha, usados, vistos:[CS…] (máx. 300), c:{clave:{v,e}}}`.
- Máximo 300 entradas, debounce de 5 s, try/catch.
- Si al cargar la fecha cambió, `usados` y `vistos` vuelven a 0.

**Log:** `[horarios] ARG1541 → SALIÓ 10:18 LLEGA 11:09`.

### 3.5 `Formato` (B)

- `Formato.ancho` suma `salida: 11, eta: 11`.
- `Formato.hora(ms, config)` → `'HH:MM'`, con `new Date(ms + ZONA_UTC_MIN*60000)` y getUTC*.
- `Formato.fila` agrega:

| Campo | real | prog | est | calc | null |
|---|---|---|---|---|---|
| `salida` (11) | `SALIÓ 07:52` | `PROG  07:30` | — | `SALIÓ~07:45` | `SALIÓ --:--` |
| `eta` (11) | `LLEGÓ 09:12` | `PROG  09:10` | `LLEGA 09:05` | `LLEGA~09:10` | `LLEGA --:--` |

- También agrega `salidaTipo`, `etaTipo` y `hayHorarios` (true si alguno de los dos tipos no es null).

### 3.6 `Ajustes` (`web/js/ajustes.js`, A)

```
Ajustes.CLAVE = 'tv.ajustes.v1'      // {v:1, guardadoMs, valores:{ruta: valor}}
Ajustes.ESQUEMA = [{ruta, grupo, etiqueta, ayuda, tipo, min, max, paso, opciones, sensible}]
   tipos: 'num','entero','texto','bool','enum','franja' ({desde,hasta}|null), 'franjaLenta' ({desde,hasta,INTERVALO_S}|null), 'lista' (PROVEEDORES), 'clave'
Ajustes.obtener(config, ruta) / Ajustes.poner(config, ruta, valor)     // rutas con puntos: 'LIMITES.opensky.CUPO_DIARIO'
Ajustes.validarCampo(desc, valor) -> {ok, valor, error}
Ajustes.validar(valores) -> {ok, errores:{ruta:msg}, limpio}
Ajustes.diferencias(base, valores) -> lo que difiere (comparación JSON)
Ajustes.aplicar(config, valores) -> {aplicados, rechazados}   // ignora rutas desconocidas o inválidas; NUNCA tira excepción
Ajustes.leer(almacen) / guardar(almacen, valores) / borrar(almacen)
Ajustes.almacenLocal = {leer, escribir, borrar}     // localStorage con try/catch
Ajustes.exportar(valores, {incluirSensibles:false}) -> JSON {"app":"tablero-vuelos","tipo":"ajustes","v":1,"valores":{…}}
Ajustes.importar(texto) -> {ok, valores, errores}   // acepta ese formato o un objeto de valores pelado
Ajustes.promedioCircular([deg]) -> {media, r}
Ajustes.rumboDesdeEvento(ev) -> deg|null
Ajustes.cardinalAGrados('NO') -> 315              // N,NE,E,SE,S,SO,O,NO
Ajustes.info() -> {guardados, guardadoMs, aplicados, rechazados}
```

Al cargar en el navegador: si existen `raiz.CONFIG` y localStorage, guarda `raiz.CONFIG_BASE` (clon profundo con JSON) y aplica lo guardado. En node no hace nada.

**Rangos del ESQUEMA**

| Grupo | Rutas y rangos |
|---|---|
| Ubicación | `LAT` [−90, 90], `LON` [−180, 180], 5 decimales. `NOMBRE_LUGAR`: 1–14 caracteres, mayúsculas y sin tildes, `[A-Z0-9 Ñ.'-]`. `AEROPUERTO_LOCAL`: `/^([A-Z]{3})?$/` |
| Orientación | `ORIENTACION_PANTALLA_DEG`: entero [0, 359] |
| Tablero | `RADIO_KM` [5, 150]; `FILAS_POR_PAGINA` {2, 3}; `SEGUNDOS_POR_PAGINA` [3, 60]; `ALTERNAR_L3_S` [0, 30]; `ANIMAR`; `UNIDAD_ALTITUD` {m, ft}; `TIMEOUT_SIN_AVIONES_S` [20, 1800]; `INCLUIR_EN_TIERRA`; `DIST_ENCIMA_KM` [0.5, 10] |
| Sonido | `VOLUMEN` [0, 1] con paso 0,05; `HORARIO_SILENCIO` franja; `BEEP_MIN_ENTRE_S` [0, 600]; `REBEEP_VUELO_S` [30, 3600] |
| Horarios | `HORARIOS_MODO`, `HORARIOS_API`, `HORARIOS_CUPO_DIARIO` [0, 500], `HORARIOS_SOLO_LOCAL`, `ZONA_UTC_MIN` [−720, 840] |
| Datos | `PROVEEDOR` {auto, adsbfi, adsblol, opensky, airplaneslive}; `PROVEEDORES`: subconjunto ordenado, sin repetidos, al menos 1; `INTERVALO_REPOSO_S` [5, 600]; `INTERVALO_ACTIVO_S` [5, 300]; `FRANJA_LENTA` (INTERVALO_S [20, 900]); `LIMITES.adsblol` y `LIMITES.opensky` → `.REPOSO_S` y `.ACTIVO_S` [5, 3600], `.CUPO_DIARIO` [0, 100000]; `ENRIQUECER` |
| Claves (sensibles) | `ADSBLOL_KEY`, `OPENSKY_CLIENT_ID`, `OPENSKY_CLIENT_SECRET`, `HORARIOS_KEY`: hasta 200 caracteres, con trim |
| Avanzado | `PROXY`: `'auto'`, `''` o una URL `^https?://…/api/?$`; `TIMEOUT_RED_S` [2, 30] |

Advertencia que no bloquea: si `ALTERNAR_L3_S >= SEGUNDOS_POR_PAGINA` y `ALTERNAR_L3_S > 0`, la vista de horarios no se llega a ver cuando hay varias páginas.

### 3.7 Headers de credenciales y proxy (B)

**`Red`**
- `BASES.aeroapi = 'https://aeroapi.flightaware.com/aeroapi/'`.
- `Red.esProxyLocal()` es true si la base es `/api/` o empieza con `http://127.0.0.1` o `http://localhost`.
- En `pedirJSON`, si `esProxyLocal()` y la URL contiene `/api/<servicio>/`, agrega solo los headers no vacíos de ese servicio:
  - `adsblol`: `X-TV-ADSBLOL-KEY`;
  - `opensky`: `X-TV-OPENSKY-ID` y `X-TV-OPENSKY-SECRET`;
  - `aeroapi`: `X-TV-AEROAPI-KEY` (sale de `HORARIOS_KEY`).

**`proxy.py`**
- Agrega `BASES['aeroapi']`.
- El header `X-TV-*` tiene prioridad sobre `credenciales.json` y las variables de entorno (se agrega `AEROAPI_KEY`).
- Para aeroapi agrega `x-apikey`. **Sin key, responde 401** `{"error":"sin clave de horarios"}`.
- El token de OpenSky se cachea por client_id.
- En modo fixtures, `aeroapi` + `flights/<CS>` devuelve `aeroapi_flights_<CS>.json`; si no existe, `aeroapi_flights_vacio.json` (200).

**`worker.js`**
- `BASES.aeroapi` y `PERMITIDAS.aeroapi = /^flights\/[A-Z0-9]{3,8}$/`.
- La query se reconstruye solo con `ident_type=designator`, y `start`/`end` que cumplan `/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/`.
- `x-apikey` sale de `env.AEROAPI_KEY`; si no está, responde 401.
- `CACHE_S.aeroapi = 600`.
- Ignora los headers `X-TV-*`.

---

## 4. Layout (B)

**L1 y L2 no cambian.**

**L3 normal alterna** entre dos contenedores, `.l3.l3a` y `.l3.l3b`:
- **Vista A** (como hoy): aerolínea(11) · tipo(4) · altitud(9) · estado(14).
- **Vista B:** salida(11) · eta(11) · estado2(14) (mismo texto que estado).

**Cómo se alterna:**
- Un timer cada `ALTERNAR_L3_S` (0 = siempre A). Se arranca en `asegurarTimers` y se corta en `detenerTimers`.
- **Cada cambio de página vuelve a A** y reinicia el timer.
- Al pasar a B, los campos se dibujan con flap de página. Los campos ocultos se actualizan igual en cada tick.
- Las filas con `hayHorarios=false` se quedan en A.

**Destacado (`.uno`):** se agrega una 3ª línea L3, `.l3c`, con salida(11) · eta(11).
- Es fija y muestra `--:--` si no hay datos.
- Si `HORARIOS_MODO==='no'` no se construye.

**Color:** `.c-salida` y `.c-eta` con:
- `t-real` / `t-est` → `#F2F2F2`;
- `t-prog` / `t-calc` / vacío → `#9A9A9A`.

**Parámetros de URL** (app.js): `horarios=no|calc|api` y `l3=a|b` (fuerza la vista).

**Con `?debug=1`:**
- atributo `data-horarios` con el JSON de `vuelo|salida.trim()|eta.trim()`;
- línea 4 del overlay: `horarios modo=… activo=… usados=x/y cola=… distintosHoy=… ult=… bloq=…`.

`verificarDesbordes` también revisa `.l3b` y `.l3c`.

---

## 5. Pantalla de configuración (A)

### `web/config.html`

- **Aspecto:**
  - Viewport normal (con zoom), vertical, fondo #000 y texto #ddd.
  - Fuente monoespaciada de 18 px.
  - Inputs y botones de 48 px de alto como mínimo, con botones en amarillo #FFC81E y texto negro.
- **Estructura:**
  - Un `<fieldset>` por grupo, con el título en MAYÚSCULAS.
  - Cada campo muestra "por defecto: X", tomado de `CONFIG_BASE`.
  - Errores en rojo debajo del campo.
- **Pie fijo** con tres botones:
  - **GUARDAR Y VOLVER**;
  - **VOLVER SIN GUARDAR**;
  - **RESTABLECER** (con confirm), que borra solo `tv.ajustes.v1`.
- **Orden de scripts:** config.js, config.local.js, ajustes.js, beep-data.js, sonido.js, configuracion.js.

### `web/js/configuracion.js` (la UI; lo testeable va en `Ajustes`)

- **"USAR MI UBICACIÓN":**
  - `getCurrentPosition({enableHighAccuracy:true, timeout:20000, maximumAge:0})`.
  - Muestra ±precisión en metros y redondea a 5 decimales.
  - Si falla, explica que puede ser por el permiso o porque la página no está en contexto seguro.
- **Orientación:**
  - 8 botones N…NO más un campo numérico.
  - "LEER BRÚJULA": llama `DeviceOrientationEvent.requestPermission` si existe, junta 5 s de muestras y muestra media, R y advertencias.
- **Volumen:**
  - Slider de 0 a 100 %.
  - "PROBAR BEEP": `Sonido.init(cfgPrueba)` con `cfgPrueba = {VOLUMEN:<slider>, HORARIO_SILENCIO:null, RUTA_BEEP:'beep.mp3'}`, actualizado en vivo.
- **Proveedores:** lista con casilla para activar y botones ▲▼ para ordenar.
- **Claves:**
  - Campos `type=password` con botón "mostrar".
  - Leyenda: quedan solo en este celu; con el proxy de Termux viajan por header solo a 127.0.0.1.
- **Copia de seguridad:**
  - Textarea con EXPORTAR.
  - Casilla "incluir claves", apagada por defecto.
  - COPIAR: `navigator.clipboard`, y si no hay, select + execCommand.
  - IMPORTAR: valida y carga los valores en el formulario, sin guardar.
  - Aviso: el JSON incluye la ubicación de tu casa, no lo publiques.
- **Leyenda** de `~` / PROG / SALIÓ / LLEGA.
- **Volver:**
  - Solo se acepta `/^index\.html(\?[^#]*)?$/`; si no coincide, va a `index.html`.
  - Con 300 s sin tocar nada → `location.replace(volver)`.
- Si localStorage no persiste, muestra un error grande y no navega.

### `web/js/acceso-config.js`

- Escucha `touchstart`, o `mousedown` si no hay touch, en captura sobre document.
  - Ignora toques a menos de 50 ms del anterior.
  - 5 toques en 3000 ms → `location.href='config.html?volver='+encodeURIComponent(archivo+location.search)`.
- Escucha el evento `storage`: si `e.key==='tv.ajustes.v1'`, hace `location.reload()`.

---

## 6. Paquetes paralelos

### Paquete A: configuración

- **Nuevos:**
  - `web/js/ajustes.js`
  - `web/config.html`
  - `web/js/configuracion.js`
  - `web/js/acceso-config.js`
  - `scripts/test_ajustes.js`, que exporta `correr() → [{nombre,ok,error}]` (sincrónico)
- **Modificados:**
  - `web/js/config.js`: claves de §3.1.
  - `web/index.html`: orden config, config.local, **ajustes**, **acceso-config**, geo, aerolineas, **horarios**, datos, … Todos los scripts con `?v=20261126a`.
  - `web/prueba-sonido.html`: suma `ajustes.js`.
  - `CLAUDE.md`: sección Configuración.

### Paquete B: horarios, layout y red

- **Nuevos:**
  - `web/js/horarios.js`
  - `scripts/test_horarios.js`
  - `scripts/fixtures/aeroapi_flights_{ARG1541,JES3420,vacio}.json`
- **Modificados:**
  - `web/js/datos.js`
  - `web/js/enriquecer.js`
  - `web/js/formato.js`
  - `web/js/tablero.js`
  - `web/css/tablero.css`
  - `web/js/app.js`
  - `web/js/red.js`
  - `termux/proxy.py`
  - `cloudflare/worker.js`
  - `web/diag.html` y `web/js/diag.js`: suman `ajustes.js` y `horarios.js`; línea "Ajustes del celu: N cambios"; línea Horarios; botón "PROBAR HORARIOS (gasta 1 consulta)".
  - `web/test.html`: suma `horarios.js`.
  - `scripts/test_logica.js`: encadena fase2 → horarios → ajustes.

### Interfaz congelada

- Lo de §3.1, §3.2, §3.3, §3.4, §3.5, `Ajustes.info`/`CLAVE` y §3.7.
- Claves de storage: A es dueño de `tv.ajustes.v1` y B de `tv.horarios.v1`.
- A escribe `config.js` e `index.html`; B no los toca. Si `horarios.js` todavía no existe, el 404 no rompe nada (Datos tiene guarda).
- El que termine segundo corre todo §7 y arregla **su propio** módulo.

### Fixtures sintéticos

T0 = 1764079200000 = 2025-11-25 14:00Z = 11:00 local.

- **`aeroapi_flights_ARG1541.json`:**
  - Vuelo en el aire, `ident_icao` ARG1541, AEP→ROS: `scheduled_out` 13:10Z, `actual_out` 13:18Z, `actual_off` 13:29Z, `scheduled_in` 14:05Z, `estimated_on` 14:03Z, `estimated_in` 14:09Z, `actual_on`/`actual_in` null, `progress_percent` 93.
  - Además, otro vuelo del 24/11 (13:10Z) con todos los actual completos.
- **`aeroapi_flights_JES3420.json`:** un solo vuelo, AEP→SLA, `scheduled_out` 12:40Z y `scheduled_in` 15:00Z; todo lo demás null.
- **`aeroapi_flights_vacio.json`:** `{"flights":[]}`.

---

## 7. Criterios de aceptación (sin red)

1. `node scripts/test_logica.js` → exit 0. Siguen pasando los 60 tests de antes, incluido el de anchos de Formato, que ahora cubre salida y eta.
2. **test_horarios:**
   - **ARG1541** de `readsb_point` (−32.95, −60.80; 160 kt; 3500 ft) con `crudo.ruta` de adsbdb:
     - dD = 5,35 km → `LLEGA~11:02` (calc);
     - dO = 283,9 km → `SALIÓ~10:30`.
   - **JES3420** (−32.78, −60.70; 250 kt; 11 000 ft; AEP→SLA) → `LLEGA~12:25` y `SALIÓ~10:30`.
   - Con `api` y el fixture de ARG1541 → `SALIÓ 10:18` (real) y `LLEGA 11:09` (est). El vuelo del día anterior no se elige.
   - Con JES3420 → `PROG  09:40` / `PROG  12:00`.
   - Fixture vacío → `null`, y se usa calc.
   - `velocidadKmh<150`, en tierra o sin coordenadas → `--:--`.
   - Llegada real de hace más de 30 min con el avión en el aire → se ignora api.
   - Con `MODO='no'` → todos los campos null.
   - `Formato.hora(T0)` = `'11:00'`.
   - **Instancia** (con red_falsa):
     - cupo 2 con 3 vuelos → solo 2 pedidos;
     - segundo `pedir` → 0 pedidos nuevos (caché);
     - 429 → pausa de 10 min y reencola;
     - 401 → `bloqueadoHoy`;
     - cambio de fecha → `usados=0`;
     - `SOLO_LOCAL` filtra;
     - sin proxy → `activo=false`, `motivo='sin proxy'`;
     - la URL lleva `ident_type=designator` y `start`/`end` sin milisegundos.
   - `Enriquecer.aplicar` pone `crudo.ruta`.
   - Red agrega `X-TV-AEROAPI-KEY` solo con el proxy local, nunca con PROXY_NUBE.
3. **test_ajustes:**
   - prioridad base < local < guardado;
   - `LIMITES.opensky.CUPO_DIARIO` no pisa `LIMITES.adsbfi`;
   - un valor fuera de rango se rechaza y no se aplica;
   - una ruta desconocida se ignora;
   - `aplicar` con basura no tira excepción;
   - `diferencias` devuelve solo lo que cambió;
   - `exportar` sin sensibles no incluye `HORARIOS_KEY`, e `importar(exportar(x))` lo devuelve igual;
   - `PROVEEDORES` vacío, repetido o desconocido → error;
   - `'Fúnes sur'` → `'FUNES SUR'`;
   - `promedioCircular([350,10,5]).media` ≈ 1,67 ± 0,1 con r > 0,98;
   - `cardinalAGrados('SO')` = 225;
   - `rumboDesdeEvento({absolute:true, alpha:90})` = 270, `({webkitCompassHeading:42})` = 42 y `({alpha:90})` = null.
4. **Proxy `--fixtures` con `index.html?debug=1&animar=0`:**
   - `data-vuelos` queda igual que antes.
   - Con `&horarios=api`, `data-horarios` contiene `"AR 1541|SALIÓ 10:18|LLEGA 11:09"` y `"WJ 3420|PROG  09:40|PROG  12:00"`.
   - Máximo 1 pedido `/api/aeroapi/flights/ARG1541` por recarga, y 0 en la segunda.
5. **Sin `horarios=api`:**
   - `salida` cumple `/^(SALIÓ[~ ]\d\d:\d\d|SALIÓ --:--)$/`;
   - `eta` cumple `/^(LLEGA[~ ]\d\d:\d\d|LLEGA --:--)$/`;
   - no hay ningún pedido a aeroapi.
6. **Capturas** a 1280×720 y 640×360:
   - `?demo=1&debug=1&l3=b` y `&l3=a`, con `filas=2` y `filas=3`;
   - `?demo=1&t=95` (destacado).
   - En todas, ningún `DESBORDE`.
7. **`config.html` headless:**
   - sin excepciones y con todos los campos de §3.6;
   - al guardar se escribe solo lo que cambió;
   - después, el tablero muestra el `RADIO_KM` y el `NOMBRE_LUGAR` guardados;
   - `diag.html` muestra "Ajustes del celu: 2 cambios".
8. **Worker** (node con fetch simulado):
   - `flights/ARG1541?...` → upstream con `x-apikey`;
   - query extra → se descarta;
   - `flights/../x` → 400;
   - sin secret → 401.
9. `?demo=1` no hace ningún request y muestra horarios `~` calculados con `AEROPUERTOS`.

---

## 8. Qué tiene que probar Esteban en el celu

1. 5 toques → configuración → "USAR MI UBICACIÓN" → guardar. El tablero recarga con la caché intacta.
2. "LEER BRÚJULA" lejos del cargador; comparar con la app de brújula.
3. "PROBAR BEEP" y el horario de silencio.
4. Un día con `?debug=1` en modo calc: anotar `distintosHoy` y comparar `LLEGA~` con FlightAware.
5. Opcional: cuenta Personal de AeroAPI, key en Claves, modo api, cupo 30.
6. Que la configuración vuelva sola al tablero a los 5 min en modo kiosko.

**Riesgos:**
- Los nombres de campos de AeroAPI hay que confirmarlos contra la primera respuesta real.
- La ETA `~` puede errar ±10 min en vuelos largos.
- El rumbo de la brújula es magnético.
