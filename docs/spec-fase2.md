# Especificación Fase 2: datos reales (Tablero de Vuelos, Ibarlucea)

Leí `CLAUDE.md`, `docs/roadmap.md`, `docs/spec-fase1.md` y todo `web/js/`. No escribí ningún archivo. La spec está pensada para que la implementen dos programadores en paralelo (Paquete A y Paquete B, §7).

Antes de empezar:
- **Los fixtures son sintéticos.** Desde acá no pude bajar ninguna respuesta real de API: el WebFetch a `api.airplanes.live/v2/point/...` dio `client_error`. Los armé con los esquemas documentados. Esteban hace la prueba en vivo con `diag.html` (§6).
- **adsb.lol hoy tiene cupo:** 500 consultas por día sin key. Eso cambió la elección del proveedor principal.

---

## 1. Investigación y decisiones

### 1.1 OpenSky (`/api/states/all`)
Fuente: https://openskynetwork.github.io/opensky-api/rest.html

**Autenticación**
- Hoy solo se acepta **OAuth2 client credentials**. Basic auth con usuario y contraseña ya no se acepta.
- Endpoint del token: `https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token`.
- El token dura 30 min. Un 401 significa que venció y hay que pedir otro.

**Créditos por día y por endpoint**

| Tipo de usuario | Créditos |
|---|---|
| Anónimo | 400 por día |
| Con cuenta (standard) | 4000 por día |
| Feeder activo | 8000 por día |

**Costo de una consulta**
- Un bbox de 25 grados² o menos cuesta **1 crédito**.
- 30 km alrededor de Ibarlucea: lat −33.120…−32.580, lon −61.104…−60.462. Son 0,35 grados², o sea 1 crédito.
- Con `?radio=200` son 15,4 grados², también 1 crédito.

**Headers**
- `X-Rate-Limit-Remaining`: créditos que quedan.
- `X-Rate-Limit-Retry-After-Seconds`: cuánto esperar después de un 429.

**Cuentas para una consulta cada 15 s, 24/7 (5760 por día)**
- Anónimo: no entra, se pasa 14 veces.
- Con cuenta: no entra, se pasa 1,44 veces.
- Solo entra con feeder (8000).

**Decisión sobre OpenSky**
- Queda como **último fallback**.
- Anónimo: 240 s entre consultas (unas 360 por día).
- Con cuenta (lo configura `config.local.js`): reposo 60 s y activo 20 s. Un día típico, con 18 h en reposo y 6 h en activo, son unas 2160 consultas. El guardián de cupo corta en el 95 %.

**CORS**
- La documentación no lo menciona y no lo pude verificar.
- El endpoint del token, desde el navegador, casi seguro no tiene CORS para orígenes desconocidos. El header `Authorization` además fuerza un preflight.
- Por eso **OpenSky con cuenta se usa solo a través del proxy de Termux**. Desde `file://` se usa anónimo, y la conexión directa con OAuth es un intento best-effort.

### 1.2 Proveedores readsb (formato ADSBx v2)

**airplanes.live** (https://airplanes.live/api-guide)
- Endpoint: `https://api.airplanes.live/v2/point/{lat}/{lon}/{nm}`, hasta 250 nm.
- Límite de **1 consulta por segundo**, sin key y sin cupo diario.
- Uso no comercial, sin SLA.
- Dice que podría exigir ser feeder en el futuro.
- Es el **proveedor principal**.

**adsb.fi** (https://github.com/adsbfi/opendata/blob/main/README.md)
- Endpoint: `https://opendata.adsb.fi/api/v3/lat/{lat}/lon/{lon}/dist/{nm}`. El `v2/lat/lon/dist` está deprecado y tiene otro formato.
- Límite de 1 consulta por segundo. Las respuestas 4xx también cuentan para el límite.
- Uso personal no comercial. Hay que citar adsb.fi con un link.
- Es el **fallback 1**.
- La clave de la lista no está documentada (`ac` o `aircraft`). El adaptador acepta las dos.

**adsb.lol** (OpenAPI en https://api.adsb.lol/api/openapi.json)
- Endpoints: `/v2/point/{lat}/{lon}/{radius}` y `/v2/lat/{lat}/lon/{lon}/dist/{radius}`.
- Cupos medidos:

| Modo | Consultas por día |
|---|---|
| Sin key | **500 por IP** (ventana fija de 24 h) |
| Key adhoc gratis | 1000 |
| Key de feeder | 7200 |

- La key va en el header `x-api-key`. Al pasarse del cupo devuelve 429 con `Retry-After`.
- `/api/0/routeset` es gratis.
- Licencia ODbL.
- Es el **fallback 2**, con 180 s entre consultas.

**Campos de readsb** (https://github.com/wiedehopf/readsb/blob/dev/README-json.md)

| Campo | Qué es | Unidad |
|---|---|---|
| `hex` | Código del avión. Si empieza con `~` no es ICAO (TIS-B) | — |
| `flight` | Callsign, con espacios al final | — |
| `r` | Matrícula | — |
| `t` | Typecode | — |
| `alt_baro` | Altitud; puede valer el string `"ground"` | pies |
| `alt_geom` | Altitud geométrica | pies |
| `gs` | Velocidad respecto al suelo | nudos |
| `track` | Rumbo | grados |
| `baro_rate`, `geom_rate` | Velocidad vertical | pies/min |
| `seen_pos` | Antigüedad de la posición | segundos |
| `lat`, `lon` | Posición | grados |

Envoltorio de la respuesta: `{ac:[…], msg:"No error", now, total, ctime, ptime}`. Ojo: en la API, `now` y `ctime` vienen **en milisegundos** (fixture de https://docs.rs/crate/adsbx_json/2.0.0/source/src/v2.rs). En el `aircraft.json` de readsb vienen en segundos.

Como **traen `t`**, para nuestro caso son mejores que OpenSky.

### 1.3 Rutas y tipo de avión: adsbdb
Fuente: https://github.com/mrjackwills/adsbdb

**Endpoints y respuestas**
- `GET https://api.adsbdb.com/v0/callsign/{CS}` devuelve `{response:{flightroute:{callsign, callsign_icao, callsign_iata, airline{name,icao,iata,country,country_iso,callsign}|null, origin{iata_code, icao_code, latitude, longitude, name, municipality,…}, destination{…}, midpoint?}}}`.
- Si no lo conoce: **404** con `{"response":"unknown callsign"}`.
- `GET /v0/aircraft/{hex}` devuelve `{response:{aircraft:{type, icao_type, manufacturer, mode_s, registration, registered_owner,…}}}`. Si no lo conoce: 404 con `{"response":"unknown aircraft"}`.
- **Usar `icao_type`**, no `type`: `type` es el nombre largo, tipo "737-8AS".

**CORS:** el código fuente usa `CorsLayer::new().allow_origin(Any)`, o sea `*`, y anda con origen `null` (https://github.com/mrjackwills/adsbdb/blob/main/src/api/mod.rs).

**Rate limit:** 512 consultas en 60 s bloquean 60 s; 1024 bloquean 300 s. Fuente: https://wiert.me/2025/10/28/some-ads-b-api-link-notes-hoping-to-be-able-to-get-from-to-airport-data-from-it/

**Licencia:** los datos de rutas no se pueden copiar ni republicar. Para una caché personal está bien. **No commitear datos reales** en el repo.

**Alternativa evaluada: adsb.lol `/api/0/routeset`**
- Es POST con `{planes:[{callsign,lat,lng}]}` y devuelve un array con `callsign`, `_airports[{iata,icao,…}]`, `_airport_codes_iata`, `airport_codes` y `plausible`. Así lo parsea tar1090 (https://raw.githubusercontent.com/wiedehopf/tar1090/master/html/planeObject.js), con caché de 6 h y lotes de hasta 100.
- **Descartada para la Fase 2:**
  - el schema oficial dice que devuelve un "string" sin documentar;
  - el CORS no está verificado y el POST JSON fuerza un preflight;
  - usa la misma base de rutas (VRS standing data).
- La "plausibilidad" la reproducimos localmente con las coordenadas de aeropuertos que da adsbdb (§4.3).

### 1.4 CORS en resumen

| API | Desde `file://` (origen `null`) | Desde `http://127.0.0.1:8080` con proxy |
|---|---|---|
| adsbdb | OK, confirmado por código (`*`) | OK (mismo origen) |
| airplanes.live, adsb.fi, adsb.lol sin key | **Sin verificar** | OK |
| adsb.lol con `x-api-key` | Preflight, dudoso | OK (la key la pone el proxy) |
| OpenSky anónimo | Sin verificar | OK |
| OpenSky con OAuth | Casi seguro bloqueado | OK (el token lo maneja el proxy) |

Conclusión: el modo directo es el default. **`diag.html` le dice a Esteban qué anda desde su celu.** El proxy de Termux es opcional y resuelve todo.

### 1.5 Conversiones (constantes exactas)
- Nudos a m/s: `× 0.514444`. El modelo interno es `velocidadMs`; `Datos` ya pasa a km/h con ×3,6, lo que equivale a nudos × 1,852.
- Pies a metros: `× 0.3048`.
- ft/min a m/s: `× 0.00508`.
- `alt_baro === "ground"` da `enTierra: true` y `altitudBaroM: 0`.

---

## 2. CONFIG (`web/js/config.js`)

**Se sacan** `INTERVALO_CONSULTA_S` (de la raíz; `DEMO.INTERVALO_CONSULTA_S` se queda), `OPENSKY_USUARIO` y `OPENSKY_CLAVE`. **Se cambia** `PROVEEDOR` a `'auto'`. **Se agrega:**

```js
PROVEEDOR: 'auto',                 // 'auto' = usa PROVEEDORES en orden con fallback; o un nombre fijo (sin fallback)
PROVEEDORES: ['airplaneslive', 'adsbfi', 'adsblol', 'opensky'],
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
PROXY: 'auto',                     // 'auto' | '' (directo) | 'http://127.0.0.1:8080/api/'
OPENSKY_CLIENT_ID: '', OPENSKY_CLIENT_SECRET: '',
ADSBLOL_KEY: '',
ENRIQUECER: true,
ENRIQ_ESPACIADO_MS: 1000,
ENRIQ_MAX_POR_TICK: 8,
```

**Atención con `LIMITES`.** `Object.assign` en `config.local.js` es superficial y pisaría todo `LIMITES`. Los ajustes anidados se escriben así, y hay que documentarlo en el comentario de `config.js`:
- `CONFIG.LIMITES.opensky = {REPOSO_S:60, ACTIVO_S:20, CUPO_DIARIO:4000};` (con cuenta de OpenSky)
- `CONFIG.LIMITES.adsblol = {REPOSO_S:90, ACTIVO_S:90, CUPO_DIARIO:1000};` (con key adhoc)

**Parámetros de URL nuevos**

| Parámetro | Efecto |
|---|---|
| `radio=N` | `RADIO_KM = min(460, N)`. Cambia el filtro, la consulta y el título |
| `proveedor=nombre` | `PROVEEDOR` fijo |
| `proxy=1` | `PROXY = 'http://127.0.0.1:8080/api/'` |
| `proxy=0` | `PROXY = ''` |

Con **`?demo=1`**:
- `INTERVALO_REPOSO_S` e `INTERVALO_ACTIVO_S` toman el valor de `DEMO.INTERVALO_CONSULTA_S`;
- `PROVEEDOR = 'demo'`;
- `ENRIQUECER = false`;
- `FRANJA_LENTA = null`;
- no sale ninguna consulta a la red.

---

## 3. Módulos de red y proveedores (Paquete A)

Las restricciones de §0 de la Fase 1 siguen igual:
- ES2015, sin `async`/`await`, sin `?.` ni `??`;
- IIFE con `(typeof window!=='undefined'?window:globalThis)` y `module.exports`;
- los módulos tienen que cargar en node con `require` y en el navegador con `<script>`;
- las dependencias se resuelven igual que en `datos.js` (`raiz.X` o `require('./x.js')`).

### 3.1 `web/js/red.js` → global `Red`

```
Red.configurar(config)              // guarda la referencia (NO copia). Al cargar en browser: Red.configurar(raiz.CONFIG)
Red.BASES = { airplaneslive:'https://api.airplanes.live/v2/', adsbfi:'https://opendata.adsb.fi/api/',
  adsblol:'https://api.adsb.lol/', opensky:'https://opensky-network.org/api/', adsbdb:'https://api.adsbdb.com/v0/',
  openskyauth:'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token' }
Red.proxyBase() -> ''|string
Red.url(servicio, ruta) -> string
Red.pedirJSON({url, metodo='GET', cuerpo=null, headers={}, timeoutMs=CONFIG.TIMEOUT_RED_S*1000}) -> Promise<Resp>  // NUNCA rechaza
Resp = { ok:boolean(2xx), status:number(0 si red/CORS/timeout), error:null|'timeout'|'red'|'http'|'json',
         json:any|null, ms:number, header:function(nombre)->string|null }
Red.usarTransporte(fn)             // tests. fn(opciones) -> Promise<{status, texto, headers:{minúsculas:valor}}> (rechaza = 'red')
Red.almacen = { leer(clave)->obj|null, escribir(clave,obj)->boolean }   // localStorage + JSON, todo con try/catch; sin localStorage → memoria
```

**`Red.proxyBase()`**
- Si `PROXY === 'auto'` y `location.protocol` empieza con `http` y el hostname es `127.0.0.1` o `localhost`, devuelve `'/api/'`.
- Si es `'auto'` en cualquier otro caso, o si es `''`, devuelve `''`.
- Si es una URL, la devuelve tal cual, con `/` al final asegurada.
- En node no hay `location`: `'auto'` devuelve `''`.

**`Red.url(servicio, ruta)`**
- Con proxy: `base + servicio + '/' + ruta`.
- Sin proxy: `BASES[servicio] + ruta`.

**`Red.pedirJSON`**
- **Transporte por defecto: XHR**, no fetch: tiene `timeout` y anda en WebViews viejos.
- Con 2xx: si el JSON no parsea, `error='json'`.
- Con no-2xx: igual intenta parsear el cuerpo (los 404 de adsbdb traen JSON) y pone `error='http'`.
- **Headers:** parsearlos desde `getAllResponseHeaders()`. No usar `getResponseHeader`, que en cross-origin loguea "Refused to get unsafe header".
- Status 0 da `error='red'`. `ontimeout` da `'timeout'`.

### 3.2 `web/js/proveedores/readsb.js` → `Readsb` y registro de 3 proveedores

```
Readsb.millasNauticas(radioKm) -> Math.min(250, Math.ceil(radioKm/1.852) + 2)    // 30 km→19, 200 km→110
Readsb.RUTAS = { airplaneslive: 'point/{lat}/{lon}/{nm}', adsbfi: 'v3/lat/{lat}/lon/{lon}/dist/{nm}', adsblol: 'v2/point/{lat}/{lon}/{nm}' }
   // lat/lon con toFixed(4): 'point/-32.8500/-60.7833/19'
Readsb.parsear(json, ahoraMs, config) -> EstadoCrudo[] | null (null si json no es objeto)
Readsb.crear(nombre, red, config) -> { nombre, obtenerEstados(ahoraMs) -> Promise<EstadoCrudo[]>, info:{} }
```

En el navegador, al cargar: `Proveedores.airplaneslive = Readsb.crear('airplaneslive', raiz.Red, raiz.CONFIG)`, y lo mismo para `adsbfi` y `adsblol`. **`config` se lee en cada llamada** (app.js lo muta después).

**Reglas de `parsear`**

1. **Lista:** `json.ac || json.aircraft`. Si no es un array, devuelve `[]`.
2. **`nowMs`:** si `json.now` es un número, se usa `now < 1e12 ? now*1000 : now`. Si no, `ahoraMs`.
3. Para cada `ac`:
   - **Edad:** si `seen_pos` es un número mayor que `MAX_EDAD_POSICION_S`, se descarta.
   - **`icao24`:** `String(hex).toLowerCase()`. Se conserva el `~`.
   - **`callsign`:** `flight` con trim. Si es string vacío o falta, `null`.
   - **`matricula`:** `r` con trim, o `null`.
   - **`tipo`:** `t` con trim y en mayúsculas, o `null`.
   - **`lat` y `lon`:** números o `null`. **No** se descarta acá: `Datos.procesar` ya filtra.
   - **Altitud:**
     - si `alt_baro === 'ground'`: `enTierra = true` y `altitudBaroM = 0`;
     - si no, `num(alt_baro)*0.3048`;
     - si da null, `num(alt_geom)*0.3048`;
     - si da null, `null`.
   - **`velocidadMs`:** `num(gs)*0.514444`.
   - **`rumboDeg`:** `num(track)`, después `num(true_heading)`, si no `null`.
   - **`velVerticalMs`:** `num(baro_rate)`, después `num(geom_rate)`, multiplicado por 0.00508.
   - **`tsPosicion`:** `nowMs - (seen_pos||0)*1000`.
   - **`origen` y `destino`:** `null`.

**`obtenerEstados`**
1. `url = red.url(nombre, ruta)`.
2. Headers: solo para `adsblol`, sin proxy y con `ADSBLOL_KEY`, se agrega `{'x-api-key': KEY}`.
3. Se llama `red.pedirJSON`.
4. Se completa `this.info = {status, ms, crudos, restante:null, url, error}`.
5. **Rechaza** con un `ErrorProveedor = {tipo:'429'|'http'|'timeout'|'red'|'json', status, retryAfterS:number|null}`:
   - si `status === 429` → `tipo:'429'` y `retryAfterS = parseInt(header('retry-after'))||null`;
   - con cualquier otro `!ok`, el tipo es `resp.error`;
   - si `parsear` devuelve `null` → `'json'`.
6. Si sale bien, resuelve con el array.

### 3.3 `web/js/proveedores/opensky.js` → `OpenSky`

```
OpenSky.parsear(json, ahoraMs, config) -> EstadoCrudo[] | null
OpenSky.crear(red, config) -> proveedor 'opensky'    // en browser: Proveedores.opensky = OpenSky.crear(raiz.Red, raiz.CONFIG)
```

**Reglas de `parsear`**

1. Si `json` no es un objeto, devuelve `null`.
2. Si `json.states` es `null` (OpenSky lo devuelve así cuando no hay aviones) o no es un array, devuelve `[]`.
3. Toma `t = json.time`, o `ahoraMs/1000`.
4. Para cada `s`:

| Índice | Campo | Cómo se usa |
|---|---|---|
| 0 | `icao24` | En minúsculas |
| 1 | `callsign` | Trim; vacío pasa a `null` |
| 3 | `time_position` | Si es `null`, se usa el 4 (`last_contact`). Se descarta si `t − tp > MAX_EDAD` |
| 5 | `lon` | — |
| 6 | `lat` | — |
| 7 | `baro_altitude` | En metros. Si es `null`, se usa el 13 (`geo_altitude`) |
| 8 | `on_ground` | Pasa a `enTierra` |
| 9 | `velocity` | m/s, directo |
| 10 | `true_track` | — |
| 11 | `vertical_rate` | m/s |

   Además: `tsPosicion = tp*1000`, `tipo = null`, `matricula = null`. Hay que tolerar arrays de 17 o 18 elementos.

**`obtenerEstados`**
- `bbox = Geo.boundingBox(LAT, LON, RADIO_KM)`.
- Ruta: `'states/all?lamin=..&lomin=..&lamax=..&lomax=..'`, con `toFixed(4)`.
- **Token:** solo sin proxy y con `CLIENT_ID` y `CLIENT_SECRET` cargados.
  - Se pide por POST a `Red.BASES.openskyauth` con `Content-Type: application/x-www-form-urlencoded` y cuerpo `grant_type=client_credentials&client_id=…&client_secret=…` (encodeURIComponent).
  - Se cachea hasta `expires_in − 60 s`.
  - Si el token falla: `info.auth = 'anonimo (token falló)'` y se sigue anónimo. No se reintenta el token antes de 10 min.
  - Con 401 en `states`, se borra el token. No se reintenta en el mismo tick.
- **Info:** `info.restante = parseInt(header('x-rate-limit-remaining'))||null`.
- **429:** `retryAfterS = header('x-rate-limit-retry-after-seconds')`.
- Los errores siguen el mismo contrato que readsb.

### 3.4 `web/js/fuentes.js` → `Fuentes` (gestor de proveedores, testeable sin DOM)

```
Fuentes.enFranja(franja{desde,hasta}|null, fecha) -> boolean   // misma semántica que HORARIO_SILENCIO (desde incl., hasta excl., cruza medianoche)
Fuentes.crear(config, proveedores, almacen) -> f
f.obtener(ahoraMs) -> Promise<Resultado>  // NUNCA rechaza
  Resultado = { ok, estados:[], proveedor:string|null, intentos:[{prov, ok, status, error, ms}] }
f.intervaloS(estadoApp 'REPOSO'|'ACTIVO'|'ESPERA', fecha) -> number
f.info() -> { actual, porProv:{nombre:{fallas, enfriaHastaMs, usados, cupo, ultimoStatus, restante}}, ticksFallidos }
```

**Lista de proveedores**
- Si `PROVEEDOR === 'auto'`, se usa `PROVEEDORES`. Si no, `[PROVEEDOR]`.
- Los nombres que no existen en `proveedores` se ignoran, con un solo `console.warn`.

**Disponibilidad.** Un proveedor `p` está disponible si cumple las tres:
- existe;
- `ahora ≥ enfriaHastaMs`;
- no tiene el cupo agotado.

**Cupo**
- Hay una ventana de 24 h desde `ventanaInicioMs`. Cuando la ventana vence, `usados` vuelve a 0.
- El cupo está agotado si `CUPO_DIARIO > 0` y `usados ≥ floor(CUPO*0.95)`.
- `usados++` **antes** de cada consulta.
- Se persiste en `almacen` con la clave `'tv.cupos.v1'` en cada consulta.

**`obtener`**
1. Candidatos = los disponibles, en orden.
2. Si no hay ninguno, resuelve `{ok:false, proveedor:null, …}`.
3. Prueba el primero. Si falla y hay otro candidato, prueba el siguiente **en el mismo tick**. Máximo 2 intentos.

**Si un proveedor sale bien:** `fallas = 0`, `enfriamientoS = 120` y `ticksFallidos = 0`.

**Si falla:**
- **429:** `enfriaHastaMs = ahora + (retryAfterS || 600)*1000`.
- **Otro error:** `fallas++`. Con `fallas ≥ 2`:
  - `enfriaHastaMs = ahora + enfriamientoS*1000`;
  - `enfriamientoS = min(enfriamientoS*2, 3600)`;
  - `fallas = 0`.
- Log: `console.warn('[fuentes] <prov> falló (<tipo> <status>) → <siguiente|nadie>')`.

**Si el tick termina sin éxito:** `ticksFallidos++`.

**Vuelta al principal:** como siempre se elige el **primer disponible**, se vuelve solo al principal cuando termina su enfriamiento.

**Timeout global:** `Fuentes` envuelve cada `obtenerEstados` con un timeout de `TIMEOUT_RED_S + 2` s, por si un proveedor se cuelga.

**`intervaloS`**
1. `base = REPOSO ? INTERVALO_REPOSO_S : INTERVALO_ACTIVO_S`.
2. En REPOSO, si `enFranja(FRANJA_LENTA, fecha)`: `base = max(base, FRANJA_LENTA.INTERVALO_S)`.
3. `p` = primer disponible. Si tiene `LIMITES[p]`: `base = max(base, REPOSO ? REPOSO_S : ACTIVO_S)`.
4. Si `ticksFallidos > 0`: `base = min(base * 2^ticksFallidos, 300)`.
5. Si no hay ninguno disponible: `base = clamp(segundos hasta el menor enfriaHastaMs, 30, 600)`.
6. `demo` no tiene `LIMITES` y por eso usa solo la base.

### 3.5 Cambios en `web/js/datos.js` (mínimos)
1. `vuelo`:
   - si `callsign === ''`, `vuelo = crudo.matricula || id.toUpperCase()`;
   - el resto de la lógica queda igual. El test de `LVFVZ` no cambia.
2. Se agrega `matricula: crudo.matricula || null` al vuelo normalizado.
3. (Opcional, al final) `aerolineaExtra`: ver §4.5.

### 3.6 Cambios en `web/js/app.js`

**Parámetros de URL:** `radio`, `proveedor` y `proxy`, como en §2. El bloque de demo pone `ENRIQUECER = false`, `FRANJA_LENTA = null` y los dos intervalos.

**Setup**
```js
var fuentes = Fuentes.crear(CONFIG, raiz.Proveedores, raiz.Red ? Red.almacen : null);
var enriq = (CONFIG.ENRIQUECER && raiz.Enriquecer && raiz.Red) ? Enriquecer.crear(CONFIG, Red, Red.almacen, alEnriquecer) : null;
```

**Se reemplazan `obtener` y `tick`:**
```js
function tick() {
  fuentes.obtener(Date.now()).then(function (res) {
    var ahora = Date.now(); ultimoRes = res;
    try {
      if (res.ok) { ultimoOkMs = ahora; ultimosCrudos = res.estados;
        if (enriq) enriq.aplicar(res.estados, ahora);
        procesar(res.estados, ahora); }
      else if (ESTADO !== 'REPOSO' && ahora - ultimoOkMs >= CONFIG.TIMEOUT_SIN_AVIONES_S * 1000) {
        ultimosCrudos = []; procesar([], ahora); }
      else if (DEBUG) pintarDebug();          // falla corta: se mantiene lo que hay en pantalla
    } catch (e) { console.error('[app] error en tick', e); }
    setTimeout(tick, fuentes.intervaloS(ESTADO, new Date()) * 1000);
  });
}
```

**Política de error:** un corte de red no apaga el tablero en el momento. Solo después de `TIMEOUT_SIN_AVIONES_S` sin datos se pasa a "0 aviones", y desde ahí el ciclo normal lleva a ESPERA y después a REPOSO. En REPOSO, un error no hace nada.

**En `procesar(crudos, ahora)`**, después de `Datos.procesar`: `if (enriq) enriq.pedir(vuelos, ahora);`.

**`alEnriquecer()`**
- Se agrupa con un flag más `setTimeout(…, 0)`: un solo re-render por ráfaga, y como mínimo 500 ms entre re-renders.
- Si `ESTADO !== 'ACTIVO'` o no hay `ultimosCrudos`, no hace nada.
- Si no:
  ```js
  enriq.aplicar(ultimosCrudos, now);
  var v = Datos.procesar(ultimosCrudos, CONFIG, now);
  if (v.length) Tablero.mostrar(v);
  ```
- **No toca `vistos` ni el beep.**
- `Tablero.mostrar` usa el modo `'tick'`, que solo anima las celdas que cambian: la ruta hace flap de `---→---` a `AEP→ROS`.

**Hook de pruebas (solo con `DEBUG`).** En cada render se escribe:
```js
document.body.setAttribute('data-vuelos', JSON.stringify(vuelos.map(function(v){
  return v.vuelo + '|' + (v.origen||'---') + '>' + (v.destino||'---') + '|' + (v.tipo||'----'); })))
```
Sirve para verificar con `--dump-dom`.

**Overlay de debug.** `#debug` ya tiene `white-space: pre`. Se suma una segunda y una tercera línea:
```
fuente=airplaneslive(directo|proxy) http=200 312ms crudos=11 radio=7/30km sig=10s fallidos=0
enfrian: adsblol 240s | cupos: adsblol 3/500 opensky 1/400 rem=399 | enriq cola=1 rutas=3 tipos=2 adsbdb=200 pausa=0
```
Los datos salen de `ultimoRes`, `fuentes.info()` y `enriq.info()`.

**Logs:** el warning `"no disponible en Fase 1"` desaparece. Los logs nuevos usan el prefijo `[fuentes]` / `[enriq]`.

### 3.7 `web/index.html`: orden de scripts
`config.js` → `config.local.js` → `geo.js` → `aerolineas.js` → `datos.js` → `formato.js` → `datos-demo.js` → **`red.js`** → `proveedores/demo.js` → **`proveedores/readsb.js`** → **`proveedores/opensky.js`** → **`fuentes.js`** → **`enriquecer.js`** → `insignia.js` → `tablero.js` → `beep-data.js` → `sonido.js` → `app.js`.

---

## 4. Enriquecimiento: `web/js/enriquecer.js` (Paquete B)

### 4.1 API

```
Enriquecer.parsearRuta(json) -> {origen, destino, origenIcao, destinoIcao, oLat, oLon, dLat, dLon, aerolinea:{icao,iata,nombre}|null} | null
     // json.response.flightroute; origen/destino = iata_code (null si falta; NO usar ICAO de 4 letras: no entra en 7 celdas)
Enriquecer.parsearAeronave(json) -> 'E190' | null      // json.response.aircraft.icao_type, trim+mayúsculas
Enriquecer.plausible(ruta, lat, lon) -> boolean
Enriquecer.crear(config, red, almacen, alActualizar) -> e
e.aplicar(crudos, ahoraMs) -> void      // sincrónico, solo caché
e.pedir(vuelos, ahoraMs) -> void        // encola faltantes; no bloquea
e.drenar() -> Promise                   // resuelve cuando la cola queda vacía y nada en vuelo (tests)
e.ruta(cs) / e.tipo(hex) -> valor | null | undefined   // undefined = no está en caché
e.info() -> { cola, enVuelo, rutas, tipos, pedidos, ultimoStatus, pausaHastaMs }
```

`red` solo necesita `red.url(servicio, ruta)` y `red.pedirJSON(opts)`, con el contrato de §3.1. B no depende de `red.js` para sus tests.

### 4.2 Reglas

**Cuándo se busca algo**
- **Ruta:** solo si `callsign` cumple `/^[A-Z]{3}[0-9][A-Z0-9]*$/`, la misma regla que `Datos`.
  - `LVFVZ` nunca se busca.
  - La clave de caché es el callsign en mayúsculas.
- **Tipo:** solo si `tipo` es null y `icao24` cumple `/^[0-9a-f]{6}$/`. Un `~hex` nunca se busca.

**`aplicar`**
- **Nunca pisa** valores que ya vienen: el demo trae `origen`, `destino` y `tipo`.
- Si la ruta está en caché y `plausible(ruta, crudo.lat, crudo.lon)`, pone `crudo.origen` y `crudo.destino`.
- Si el tipo está en caché, pone `crudo.tipo`.

**`pedir`**
- Toma los primeros `ENRIQ_MAX_POR_TICK` vuelos, ya ordenados por distancia.
- Encola `r:CS` y/o `t:hex` si no hay entrada vigente en caché y no están ya en la cola o en vuelo.

**Cola**
- Una consulta por vez, separadas por `ENRIQ_ESPACIADO_MS`.
- URL: `red.url('adsbdb', 'callsign/'+CS)` o `red.url('adsbdb', 'aircraft/'+hex)`.

**Cómo se trata cada respuesta**

| Respuesta | Qué se guarda | TTL | Se persiste | Llama `alActualizar` |
|---|---|---|---|---|
| 200 y parsea bien | El valor | Ruta 12 h, tipo 30 días | Sí | Sí |
| 200 que no parsea, o 404 | `null` | Ruta 6 h, tipo 7 días | Sí | Sí |
| 429 | Nada; el ítem se reencola al principio | Pausa de 60 s (`pausaHastaMs`) | No | No |
| 0, timeout u otro código | `null` | 2 min | **No** (solo en memoria) | No |

**Persistencia**
- Clave `'tv.enriq.v1'` = `{r:{CS:{v,e}}, t:{hex:{v,e}}}`, donde `e` es la expiración en ms.
- Se carga en `crear` y se descarta lo vencido.
- Escritura con debounce de 5 s.
- Máximo 400 entradas por mapa. Si se pasa, se borran las de menor `e`.
- Todo con try/catch. Si `almacen` es null, solo memoria.

**Logs:** `console.log('[enriq] ruta ARG1541 → AEP-ROS')`.

### 4.3 Plausibilidad (reemplaza el `plausible` de routeset)
- `dO = dist(origen, avión)`, `dD = dist(destino, avión)`, `dOD = dist(origen, destino)`, con `Geo.distanciaKm`.
- Plausible si `dO + dD ≤ dOD*1.2 + 50`.
- Si falta alguna coordenada, o el avión no tiene posición, cuenta como plausible.

Valores calculados con `geo.js`:

| Ruta | Posición | dO / dD / dOD (km) | ¿Plausible? |
|---|---|---|---|
| AEP→ROS | (−32.95, −60.80) | 284 / 5 / 286 | Sí |
| AEP→MDZ | Ibarlucea | 290 / 748 / 979 | Sí |
| MAD→BCN | Ibarlucea | 10046 / 10455 / 483 | No |

### 4.4 Cómo el enriquecimiento no bloquea el tick
- Un tick nunca espera a adsbdb.
- Primer tick con un vuelo nuevo:
  1. `aplicar` no encuentra nada en caché;
  2. el tablero se dibuja con `---→---` y `----`;
  3. `pedir` encola.
- Alrededor de 1 s después llega la respuesta: `alActualizar` → re-render → flap solo en las celdas de ruta y tipo.
- En los ticks siguientes, `aplicar` lo completa desde la caché.
- Al recargar la página, la caché de localStorage hace que no haya ninguna consulta para los callsigns ya conocidos.

### 4.5 Opcional (solo si sobra tiempo; tocan juntos A y B)
Si `Aerolineas.buscar` no conoce el prefijo pero la ruta trae `aerolinea` con `iata`:
- `aplicar` pone `crudo.aerolineaExtra = {icao, iata, nombre}`;
- `Datos.normalizar` arma un objeto aerolínea con:
  - `nombre`: en mayúsculas y sin tildes;
  - `nombreCorto`: la primera palabra, hasta 11 caracteres;
  - `color` `#333` y `colorTexto` `#FFF`;
- y el vuelo queda `iata + ' ' + número`.

---

## 5. Fixtures y tests (Paquete B)

### 5.1 `scripts/fixtures/` (JSON válido, sin comentarios; los comentarios de acá son solo para el programador)

**`readsb_point.json`**
```json
{"ac":[
 {"hex":"e06541","type":"adsb_icao","flight":"ARG1541 ","r":"LV-ABC","t":"E190","alt_baro":3500,"alt_geom":3725,"gs":160,"track":18.5,"baro_rate":-832,"squawk":"4521","category":"A3","lat":-32.95,"lon":-60.80,"nic":8,"seen_pos":0.8,"seen":0.3,"rssi":-18.4,"dst":5.4,"dir":190.1},
 {"hex":"e0a1b2","type":"adsb_icao","flight":"FBZ5121 ","r":"LV-KJE","t":"B738","alt_baro":"ground","gs":12.3,"track":200.4,"category":"A3","lat":-32.903,"lon":-60.7845,"seen_pos":2.1,"seen":1.0},
 {"hex":"e48a21","type":"adsb_icao","flight":"GLO7461 ","r":"PR-XMA","t":"B38M","alt_baro":36000,"alt_geom":36775,"gs":452,"track":23.4,"baro_rate":0,"lat":-33.02,"lon":-60.92,"seen_pos":1.4,"seen":0.6},
 {"hex":"e03420","type":"adsb_icao","flight":"JES3420 ","alt_baro":11000,"gs":250,"track":330,"baro_rate":1792,"lat":-32.78,"lon":-60.70,"seen_pos":3.0,"seen":2.2},
 {"hex":"e0f1a7","type":"mode_s","flight":"LVFVZ   ","r":"LV-FVZ","t":"C150","alt_baro":2100,"gs":95,"track":0,"lat":-32.80,"lon":-60.85,"seen_pos":4.5,"seen":1.1},
 {"hex":"e0c3d4","type":"mlat","r":"LV-GHI","t":"PA34","alt_baro":1500,"gs":120,"track":90,"geom_rate":-256,"lat":-32.88,"lon":-60.74,"seen_pos":6.0,"seen":3.0},
 {"hex":"~2a1f00","type":"tisb_other","alt_baro":4500,"gs":180,"track":270,"lat":-32.70,"lon":-60.65,"seen_pos":1.0,"seen":1.0},
 {"hex":"e0b9c8","type":"adsb_icao","flight":"AZP401  ","t":"E190","alt_geom":12000,"gs":300,"track":135,"lat":-32.75,"lon":-60.95,"seen_pos":2.0,"seen":0.5},
 {"hex":"e0d4e5","type":"adsb_icao","flight":"ARG1234 ","t":"A332","alt_baro":38000,"gs":480,"track":10,"seen":0.4},
 {"hex":"e0e5f6","type":"adsb_icao","flight":"ARG1777 ","t":"B738","alt_baro":24000,"gs":400,"track":45,"lat":-32.90,"lon":-60.78,"seen_pos":95.0,"seen":90.0},
 {"hex":"e09f10","type":"adsb_icao","flight":"LAN1405 ","t":"A320","alt_baro":33000,"gs":440,"track":300,"baro_rate":64,"lat":-33.20,"lon":-60.50,"seen_pos":0.5,"seen":0.2}
],"msg":"No error","now":1764079200000,"total":11,"ctime":1764079199500,"ptime":4}
```
Qué prueba cada avión:

| Avión | Caso |
|---|---|
| e0a1b2 | En tierra (`"ground"`) |
| e03420 | Sin `t` → tipo por adsbdb |
| e0c3d4 | Sin `flight` → vuelo `LV-GHI`; usa `geom_rate` |
| ~2a1f00 | Hex no ICAO (TIS-B) |
| e0b9c8 | Solo `alt_geom` |
| e0d4e5 | Sin posición |
| e0e5f6 | Posición vieja → se descarta |
| e09f10 | A 47 km → fuera del radio |

**Variantes de readsb**
- `readsb_aircraft_key.json`: lo mismo pero con la clave `"aircraft"` en vez de `"ac"` y `"now":1764079200`, en segundos.
- `readsb_vacio.json`: `{"ac":[],"msg":"No error","now":1764079200000,"total":0,"ctime":1764079200000,"ptime":1}`.

**`opensky_states.json`**
```json
{"time":1764079200,"states":[
 ["e06541","ARG1541 ","Argentina",1764079199,1764079200,-60.80,-32.95,1066.8,false,82.31,18.5,-4.23,null,1135.38,"4521",false,0],
 ["e0a1b2","FBZ5121 ","Argentina",1764079190,1764079199,-60.7845,-32.903,null,true,3.6,200.4,null,null,null,null,false,0],
 ["e48a21","GLO7461 ","Brazil",1764079198,1764079200,-60.92,-33.02,10972.8,false,232.53,23.4,0,null,11209.02,"2214",false,0,0],
 ["e0f1a7","","Argentina",null,1764079180,null,null,null,false,null,null,null,null,null,null,false,0],
 ["e0b9c8",null,"Argentina",1764079199,1764079200,-60.95,-32.75,null,false,154.33,135,null,null,3657.6,null,false,0],
 ["e0e5f6","ARG1777 ","Argentina",1764079100,1764079120,-60.78,-32.90,7315.2,false,205.78,45,0,null,7467.6,null,false,0]
]}
```
- `opensky_vacio.json`: `{"time":1764079200,"states":null}`.

**adsbdb**
- `adsbdb_callsign_ARG1541.json`:
  ```json
  {"response":{"flightroute":{"callsign":"ARG1541","callsign_icao":"ARG1541","callsign_iata":"AR1541","airline":{"name":"Aerolineas Argentinas","icao":"ARG","iata":"AR","country":"Argentina","country_iso":"AR","callsign":"ARGENTINA"},"origin":{"country_iso_name":"AR","country_name":"Argentina","elevation":18,"iata_code":"AEP","icao_code":"SABE","latitude":-34.5592,"longitude":-58.4156,"municipality":"Buenos Aires","name":"Jorge Newbery Airpark"},"destination":{"country_iso_name":"AR","country_name":"Argentina","elevation":85,"iata_code":"ROS","icao_code":"SAAR","latitude":-32.9036,"longitude":-60.785,"municipality":"Rosario","name":"Islas Malvinas International Airport"}}}}
  ```
- `adsbdb_callsign_JES3420.json`: misma forma, con AEP (SABE) → SLA (SASA, −24.8560, −65.4862). La aerolínea es JetSMART (JES/WJ).
- `adsbdb_callsign_IBE3412.json`: misma forma, MAD (LEMD, 40.4719, −3.5626) → BCN (LEBL, 41.2971, 2.0785). Es el caso no plausible.
- `adsbdb_callsign_404.json`: `{"response":"unknown callsign"}`.
- `adsbdb_aircraft_e06541.json`:
  ```json
  {"response":{"aircraft":{"type":"ERJ 190-100 IGW","icao_type":"E190","manufacturer":"Embraer","mode_s":"E06541","registration":"LV-ABC","registered_owner_country_iso_name":"AR","registered_owner_country_name":"Argentina","registered_owner_operator_flag_code":"ARG","registered_owner":"Aerolineas Argentinas","url_photo":null,"url_photo_thumbnail":null}}}
  ```
- `adsbdb_aircraft_e03420.json`: igual, con `icao_type` `"A20N"`, `type` `"A320 271N"` y fabricante Airbus.
- `adsbdb_aircraft_404.json`: `{"response":"unknown aircraft"}`.

**`scripts/fixtures/LEEME.md`** (una línea): "Fixtures sintéticos según los esquemas documentados; matrículas y rutas ficticias. No pegar respuestas reales de adsbdb (licencia de datos de rutas)."

### 5.2 `scripts/red_falsa.js`
- `crearTransporte(tabla)` devuelve una función `fn(opciones)` para `Red.usarTransporte`.
- `tabla` es un array `[{re:RegExp, status, archivo|texto, headers, demoraMs}]`; la primera que coincide gana. Sin coincidencia: status 0, que equivale a un error de red.
- Registra cada llamada en `fn.llamadas` (con url, método y headers) para hacer aserciones.
- `crearRedFalsa(tabla)` devuelve un objeto `{url(servicio, ruta), pedirJSON(opts)}` para `Enriquecer`. `url` es `'https://api.adsbdb.com/v0/'+ruta` y `pedirJSON` usa el mismo transporte.
- También `crearAlmacenMemoria()`.

### 5.3 `scripts/test_fase2.js`
Exporta `correr() -> Promise<[{nombre, ok, error}]>`. `test_logica.js` corre primero `Tests.correr` (Fase 1), después `require('./test_fase2.js').correr()`, imprime todo junto y sale con exit 0 o 1 dentro del `.then`. Casos con valores esperados:

**Readsb.parsear(readsb_point)**
1. Da **10** estados (descarta e0e5f6).
2. `e06541`:
   - `altitudBaroM` 1066,8 ± 0,01;
   - `velocidadMs` 82,31 ± 0,01;
   - `velVerticalMs` −4,2266 ± 0,001;
   - `callsign` `'ARG1541'`, `tipo` `'E190'`, `matricula` `'LV-ABC'`;
   - `tsPosicion` = 1764079200000 − 800.
3. `e0a1b2`: `enTierra` true y altitud 0.
4. `e0b9c8`: altitud 3657,6.
5. `e0c3d4`:
   - `callsign` null;
   - `velVerticalMs` −1,30048;
   - después de `Datos.normalizar`, `vuelo` = `'LV-GHI'`.
6. `~2a1f00`: `icao24` `'~2a1f00'` y `tipo` null.
7. `e0d4e5`: lat y lon null.

**`Datos.procesar` con RADIO 30**
- **7** vuelos, en este orden: `e0c3d4` (5,24 km, SURESTE), `e0f1a7` (8,35), `e03420` (11,01), `e06541` (11,23, SUR), `e0b9c8` (19,14), `~2a1f00` (20,82), `e48a21` (22,81, SUROESTE).
- `Formato.fila` de `e48a21` → altitud `'10.950 M'`.

**Otras pruebas de `Readsb`**
- `readsb_aircraft_key` → los mismos 10, con `now` en segundos.
- `readsb_vacio` → `[]`.
- `parsear(null)` → `null`.
- `millasNauticas(30)` = 19; `millasNauticas(200)` = 110; `millasNauticas(1000)` = 250.

**OpenSky.parsear(opensky_states)**
- Da **5** estados (descarta e0e5f6).
- `e06541`: `velocidadMs` 82,31.
- `e0b9c8`: altitud 3657,6 (geo) y `callsign` null.
- `e0f1a7`: lat null y `tsPosicion` 1764079180000.
- `e0a1b2`: `enTierra`.
- Con `procesar`, quedan 3: e06541, e0b9c8, e48a21.
- `opensky_vacio` → `[]`.

**URLs y headers (Red con transporte falso, `cfg` clonado)**

| Proveedor y modo | URL esperada |
|---|---|
| airplaneslive directo | `https://api.airplanes.live/v2/point/-32.8500/-60.7833/19` |
| adsbfi | `https://opendata.adsb.fi/api/v3/lat/-32.8500/lon/-60.7833/dist/19` |
| adsblol | `https://api.adsb.lol/v2/point/-32.8500/-60.7833/19` |
| `PROXY='http://127.0.0.1:8080/api/'` | `http://127.0.0.1:8080/api/airplaneslive/point/-32.8500/-60.7833/19` |
| opensky | `https://opensky-network.org/api/states/all?lamin=-33.1198&lomin=-61.1045&lamax=-32.5802&lomax=-60.4621` |

- Con `ADSBLOL_KEY='k'` sin proxy, aparece el header `x-api-key: k`. Con proxy, no aparece.
- OpenSky:
  - un 429 con `x-rate-limit-retry-after-seconds: 77` rechaza con `{tipo:'429', retryAfterS:77}`;
  - `x-rate-limit-remaining: 399` → `info.restante` 399.

**Fuentes** (proveedores falsos que resuelven o rechazan a pedido; `ahoraMs` controlado)
1. Todos OK → siempre usa `airplaneslive`.
2. `airplaneslive` da 429 con `retryAfterS` 120:
   - en **el mismo** `obtener`, el resultado viene de `adsbfi` (2 intentos);
   - con `ahora + 119 s` sigue en `adsbfi`;
   - con `+121 s` vuelve a `airplaneslive`.
3. `airplaneslive` da `'red'` una vez → ese tick resuelve con `adsbfi`, y el siguiente vuelve a probar `airplaneslive`. Con dos fallas seguidas, queda enfriado 120 s; la siguiente tanda, 240 s.
4. Cupo: con `adsblol` con `CUPO_DIARIO` 10, después de 9 usos queda no disponible. Con `+24 h` vuelve.
5. Con `PROVEEDOR='adsbfi'`, aunque falle nunca usa otro.
6. Todos fallan → `ok:false`, y `ticksFallidos` sube.
7. `intervaloS`:
   - REPOSO con airplaneslive = 20;
   - ACTIVO = 10;
   - REPOSO a las 03:00 = 60;
   - si el primer disponible es `opensky` (los otros están enfriados) = 240 en los dos estados;
   - con `ticksFallidos=2` en REPOSO = 80; con 5 = 300.
8. `enFranja`: con 01:00–05:30, las 01:00 dan true y las 05:30 false. Con 23:00–02:00, la 01:00 da true.
9. `info()` refleja los `usados` persistidos en un almacén en memoria y los recupera en otro `crear`.

**Enriquecer** (red falsa, `ENRIQ_ESPACIADO_MS=0`, almacén en memoria)
1. `aplicar` sobre los crudos de `readsb_point` sin caché → no cambia nada.
2. `pedir(vuelos de procesar)`:
   - encola rutas para JES3420, ARG1541, AZP401 y GLO7461, pero **no** para LVFVZ ni para crudos sin callsign;
   - encola el tipo solo de `e03420` (es el único que no trae `t`).
3. `drenar()` → `aplicar` deja:
   - ARG1541: `origen` AEP y `destino` ROS;
   - JES3420: AEP→SLA y tipo `A20N`;
   - AZP401 y GLO7461: siguen null, con la caché en `null` (404).
4. `alActualizar` se llamó al menos 5 veces (una por cada 200/404).
5. Un segundo `pedir` con los mismos vuelos no hace ninguna llamada nueva (`llamadas.length` no cambia).
6. Un crudo IBE3412 en Ibarlucea, con la ruta en caché, no recibe `origen`/`destino` (no plausible).
7. Un crudo con `origen:'COR'` ya puesto no se pisa.
8. Un 429 en adsbdb → `pausaHastaMs ≈ ahora + 60000`, el ítem se reencola y no se cachea.
9. Un error de red → el siguiente `pedir` dentro de 2 min no reconsulta. Lo que se escribió en el almacén no contiene ese callsign.
10. Persistencia: un nuevo `crear` con el mismo almacén ya tiene ARG1541. Con una entrada vencida (`e < ahora`), devuelve `undefined`.
11. `parsearRuta({response:'unknown callsign'})` → null. `parsearAeronave` de e06541 → `'E190'`.

**Datos:** `normalizar({icao24:'e0c3d4', callsign:'', matricula:'LV-GHI'})` → `vuelo` `'LV-GHI'`. Sin matrícula → `'E0C3D4'`.

---

## 6. Herramientas para probar en el celu

### 6.1 `?radio=200` (A)
- Ejemplo: `index.html?radio=200&debug=1`. El tablero muestra `CIELO DE IBARLUCEA · 200 KM`.
- La consulta readsb pide 110 nm. OpenSky sigue costando 1 crédito.
- Sirve para ver que llegan datos aunque no pase nada a 30 km.
- No usarlo 24/7: hay más tráfico y más páginas.

### 6.2 `web/diag.html` + `web/js/diag.js` (A)
- Carga config, `config.local`, geo, red, readsb, opensky y enriquecer. Fondo negro, monoespaciada de 16 px, sin el tablero.
- `?radio=` por defecto vale 200.
- Corre solo al cargar, y hay un botón grande **PROBAR DE NUEVO**.

**Qué muestra**
1. **Encabezado:** origen de la página (`file://` o `http://127.0.0.1:8080`), modo de red (directo o proxy más base), `navigator.onLine`, hora y userAgent recortado.
2. **Una fila por proveedor**, en orden `airplaneslive`, `adsbfi`, `adsblol`, `opensky`, con 1 s entre cada uno. Columnas:
   - URL;
   - resultado:
     - **OK**;
     - **BLOQUEADO (CORS o sin red)** si da status 0 en menos de 1500 ms;
     - **TIMEOUT**;
     - **HTTP nnn**;
   - ms;
   - crudos;
   - cuántos están a 30 km o menos;
   - hasta 3 ejemplos `CALLSIGN/TIPO/km`;
   - `restante` (header de créditos).
3. **adsbdb:**
   - callsign: el primero con formato de aerolínea, o `ARG1541`;
   - hex: el primero sin `t`, o `e06541`;
   - muestra status, ruta parseada con su plausibilidad, e `icao_type`.
4. **RECOMENDACIÓN** en texto:
   - el primer proveedor OK con crudos mayor que 0 → "Dejá PROVEEDORES con X primero";
   - si todos dan BLOQUEADO desde `file://` → "Usá el proxy de Termux (termux/proxy.py) y abrí http://127.0.0.1:8080/".

Aclaración: el diagnóstico gasta 1 consulta del cupo de adsblol y 1 de opensky.

### 6.3 `termux/proxy.py` (A; opcional en producción, **obligatorio para la prueba con fixtures**)
- Python 3, solo stdlib: `http.server.ThreadingHTTPServer`, `urllib.request`, `json`, `gzip`, `argparse`, `os`, `time`.
- Escucha en `127.0.0.1`.

```
python3 termux/proxy.py [--puerto 8080] [--web web] [--fixtures scripts/fixtures]
                        [--falla airplaneslive=429 ...] [--demora-adsbdb-ms 1500]
```

**Rutas**
- `GET /…` → estáticos de `--web` (por defecto, `../web` relativo al script). Con `Cache-Control: no-store`.
- `GET /api/salud` → `{"ok":true,"fixtures":bool}`.
- `GET /api/<servicio>/<resto>?<query>`:
  - `servicio` tiene que estar en la whitelist `airplaneslive|adsbfi|adsblol|opensky|adsbdb`; si no, 404;
  - el destino es `BASES[servicio] + resto + query`, con las mismas BASES que `Red`;
  - `OPTIONS` → 204 con los headers CORS.

**Hacia arriba (upstream)**
- Timeout de 10 s.
- `User-Agent: tablero-vuelos/1.0`, `Accept: application/json`, `Accept-Encoding: gzip`. Si la respuesta viene comprimida, la descomprime.
- Si upstream contesta con error, se pasan el status y el cuerpo tal cual. Error de red o timeout → 502 con `{"error":"…"}`.

**Headers de la respuesta**
- `Access-Control-Allow-Origin: *`.
- `Access-Control-Expose-Headers: Retry-After, X-Rate-Limit-Remaining, X-Rate-Limit-Retry-After-Seconds`, y se pasan esos tres.
- `Content-Type` de upstream, o `application/json`.

**Credenciales**
- Variables de entorno `OPENSKY_CLIENT_ID`, `OPENSKY_CLIENT_SECRET` y `ADSBLOL_KEY`, o un archivo `termux/credenciales.json` (**agregarlo a `.gitignore`**).
- adsblol: agrega `x-api-key`.
- OpenSky:
  - el token se pide por POST form a la URL de autenticación;
  - se cachea hasta `expires_in − 60`;
  - con un 401 de upstream, se invalida y se reintenta 1 vez.

**Modo `--fixtures DIR`** (no sale a internet)

| Ruta | Archivo que devuelve |
|---|---|
| `airplaneslive/point/*`, `adsbfi/v3/*`, `adsblol/v2/point/*` | `readsb_point.json` |
| `opensky/states/all*` | `opensky_states.json` |
| `adsbdb/callsign/<CS>` | `adsbdb_callsign_<CS>.json`; si no existe, 404 con `adsbdb_callsign_404.json` |
| `adsbdb/aircraft/<hex>` | `adsbdb_aircraft_<hex en minúsculas>.json`; si no existe, 404 con `adsbdb_aircraft_404.json` |

- `--falla servicio=código` responde ese código. Si es 429, agrega `Retry-After: 60`.
- `--demora-adsbdb-ms` sirve para ver el flap.

**Log:** una línea por request, por ejemplo `GET /api/airplaneslive/point/… → 200 312ms (fixture)`.

---

## 7. División en paquetes paralelos

### Paquete A: red, proveedores y app
- **Archivos:** `red.js`, `proveedores/readsb.js`, `proveedores/opensky.js`, `fuentes.js`, `config.js`, `datos.js` (§3.5), `app.js`, `index.html`, `diag.html` + `js/diag.js`, `termux/proxy.py`, `.gitignore` (`termux/credenciales.json`).
- **Documentación:**
  - README: sección "Datos reales" con `?radio`, `diag.html`, el proxy y los créditos. Los créditos citan airplanes.live, adsb.fi (con link, lo piden sus términos), adsb.lol (ODbL), OpenSky y adsbdb.
  - `CLAUDE.md`: actualizar "Fuentes de datos": airplanes.live pasa a principal, OpenSky queda como fallback, y basic auth ya no existe.
  - `roadmap.md`: tildar lo que corresponda.

### Paquete B: enriquecimiento, fixtures y tests
- **Archivos:** `enriquecer.js`, `scripts/fixtures/*`, `scripts/red_falsa.js`, `scripts/test_fase2.js`, y el cambio en `scripts/test_logica.js`.

### Interfaz congelada entre A y B
- Contrato de `Resp` y `Red.pedirJSON`, `Red.url` y `Red.almacen` (§3.1).
- `Readsb.parsear`, `Readsb.millasNauticas`, `Readsb.crear` y `OpenSky.parsear`, `OpenSky.crear`, con firmas y reglas de §3.2 y §3.3.
- `Fuentes` (§3.4).
- `Enriquecer` (§4.1).
- El campo nuevo `matricula` de EstadoCrudo y del vuelo normalizado.
- Nombres de fixtures (§5.1) y tabla del modo `--fixtures` (§6.3).

**Reglas de trabajo**
- B escribe los tests de los módulos de A contra esta spec. Si un test de B contradice la spec, gana la spec.
- Al final, el que termine segundo corre `node scripts/test_logica.js` y los criterios de §8, y arregla **su propio** módulo.

---

## 8. Criterios de aceptación (sin red)

1. `node scripts/test_logica.js` → exit 0, con los tests de la Fase 1 y los de §5.3. `web/test.html` sigue todo OK (no cambia).
2. **Sin red y sin proxy:** `google-chrome --headless --window-size=1280,720 --virtual-time-budget=60000 --screenshot "file://…/web/index.html?debug=1"`:
   - la pantalla queda toda `(0,0,0)` salvo el overlay;
   - no hay excepciones;
   - en consola aparecen warnings `[fuentes] … falló (red 0)` que recorren los 4 proveedores;
   - el intervalo crece y nunca pasa de 300 s.
3. **Con fixtures:** `python3 termux/proxy.py --fixtures scripts/fixtures &` y después `google-chrome --headless --virtual-time-budget=8000 --dump-dom "http://127.0.0.1:8080/index.html?debug=1&animar=0"`:
   - `data-vuelos` vale exactamente `["LV-GHI|--->---|PA34","LVFVZ|--->---|C150","WJ 3420|AEP>SLA|A20N","AR 1541|AEP>ROS|E190","ZP 401|--->---|E190","~2A1F00|--->---|----","G3 7461|--->---|B38M"]`;
   - el overlay muestra `fuente=airplaneslive(proxy)`, `crudos=10` y `radio=7/30km`;
   - el encabezado muestra `1/4`.
4. **Fallback:** con `--falla airplaneslive=429` → misma lista, `fuente=adsbfi`, y `airplaneslive` aparece enfriando unos 60 s.
5. **OpenSky:** con `?proveedor=opensky` sobre fixtures → `["AR 1541|AEP>ROS|E190","E0B9C8|--->---|----","G3 7461|--->---|----"]`. AR 1541 recibe el tipo por adsbdb (e06541); e0b9c8 y e48a21 no tienen fixture de aeronave y quedan en `----`.
6. **Flap asincrónico:** con `--demora-adsbdb-ms 1500` → en consola aparece `[enriq] ruta ARG1541 → AEP-ROS`, y a continuación un re-render **antes** del siguiente tick (10 s). En el primer render, la ruta de AR 1541 era `---→---`. El beep no se repite por el re-render.
7. **Caché:** al recargar la página, el log del proxy no muestra pedidos a `/api/adsbdb/callsign/ARG1541` ni `/aircraft/e03420`.
8. `?radio=200` → título `· 200 KM`, y el log del proxy muestra `…/point/-32.8500/-60.7833/110`.
9. **Demo intacto:** `?demo=1` cumple los criterios 2 a 9 de la Fase 1 y no hace ningún request (el log del proxy, si está servido por el proxy, solo muestra los estáticos).
10. `diag.html` con fixtures → los 4 proveedores OK, adsbdb OK y la recomendación "airplaneslive primero". Con `--falla adsbfi=500` → la fila de adsbfi dice HTTP 500.

---

## 9. Riesgos y qué tiene que probar Esteban en el celu

**Riesgos**
1. **CORS desde `file://`** de airplanes.live, adsb.fi, adsb.lol y OpenSky: no está verificado. Abrir `diag.html` desde el mismo navegador o Fully que va a usar. Si dice BLOQUEADO, hay que usar el proxy de Termux:
   - `pkg install python`;
   - `termux-wake-lock`;
   - `python termux/proxy.py`;
   - abrir `http://127.0.0.1:8080/`.
   Esto suma Termux:Boot y sacar la optimización de batería (Fase 3).
2. **Cobertura en la zona de Rosario:** depende de los feeders de cada red y no se puede verificar desde acá.
   - `diag.html?radio=200` muestra cuántos crudos llegan de cada uno.
   - Después, `index.html?radio=30&debug=1` cuando vea pasar un avión.
   - El orden de `PROVEEDORES` se ajusta según quién vea más.
3. **Cupos:**
   - adsb.lol sin key está limitado a 500 por día; solo sirve de fallback.
   - OpenSky anónimo: unos 360 por día.
   - Si quiere OpenSky de verdad: crear una cuenta y un API client. Las credenciales van en el proxy; desde el navegador el token muy probablemente no ande.
   - airplanes.live puede pasar a exigir ser feeder.
4. **Rutas de adsbdb para vuelos de cabotaje:** pueden faltar o estar viejas. Se ve `---→---`, y la plausibilidad evita rutas absurdas.
5. **Términos:** todo es uso personal no comercial. adsb.fi exige citarlo (va en el README y en `diag.html`). No republicar las rutas.
6. **localStorage desde `file://`** puede no estar disponible en algunos WebView. En ese caso funciona solo con memoria, pero se pierde el ahorro entre reinicios. `diag.html` debería mostrar si `Red.almacen` persiste: que lo agregue A como línea del encabezado.
7. **Datos:** son unas 5000–6000 consultas por día con 20/10 s. Casi todas vienen vacías (unos cientos de bytes). Tiene que ser por WiFi, no con datos móviles.
8. **`file://` en Android 11 o más nuevo** (almacenamiento acotado) dentro de Fully: queda para la Fase 3. Si da problemas, es otra razón para servir desde el proxy.

**Checklist de Esteban**
- `diag.html` desde `file://`, y si hace falta desde el proxy.
- `index.html?radio=200&debug=1` durante 5 minutos: llegan vuelos y aparecen rutas y tipos.
- `index.html?debug=1` un día normal: se enciende cuando pasa uno, el beep suena y a los 2 min vuelve a negro.
- Mirar en el overlay que `fallidos` se quede en 0 y que no aparezcan enfriamientos todo el tiempo.

