# ✈️ Tablero de Vuelos — Ibarlucea

Un celular Android viejo convertido en tablero de aeropuerto: pantalla negra en reposo,
se enciende con un *beep* cuando un avión pasa a menos de 30 km de Ibarlucea (Santa Fe)
y muestra aerolínea, vuelo, tipo de avión, altitud y ETA.

## Estado

🚧 En construcción con Claude Code. Las instrucciones del proyecto están en
[`CLAUDE.md`](CLAUDE.md) y la hoja de ruta en [`docs/roadmap.md`](docs/roadmap.md).

## Estructura

| Carpeta   | Qué va                                               |
|-----------|------------------------------------------------------|
| `web/`    | Display HTML/CSS/JS + `beep.mp3`                     |
| `termux/` | Scripts opcionales (proxy local, encendido de pantalla) |
| `tasker/` | Perfiles de Tasker exportados                        |
| `docs/`   | Instalación en el celu y cuidado de batería          |

## Probar el demo

Abrí `web/index.html?demo=1` en el navegador (doble clic con `?demo=1` o desde un servidor local;
anda también desde `file://`). Ciclo de 180 s con 8 aviones falsos: negro, entra uno solo
(modo destacado), después varios con paginado, y vuelve a negro.

Atajos de URL (se combinan con `&`):

- `t=20` salta al modo destacado (un solo avión); `t=70` salta al pico (7 aviones, 4 páginas).
- `debug=1` muestra un overlay con estado, cantidad de aviones, página y último beep, y avisa por consola si algo desborda.
- `animar=0` apaga la animación split-flap; `filas=3` pone 3 filas por página; `orientacion=90` gira las flechas.

Los datos falsos viven en `web/js/datos-demo.js` (reemplaza al `mock.json` que mencionaba `CLAUDE.md`:
`fetch` no funciona desde `file://`). Los tests de la lógica: `node scripts/test_logica.js` o abrir `web/test.html`.

## Datos reales

Sin `?demo=1` el tablero consulta vuelos reales. `PROVEEDORES` (en `web/js/config.js`) define el orden y el
fallback automático: **airplanes.live** (principal, sin cupo diario), **adsb.fi**, **adsb.lol** (500 consultas por día
sin key) y **OpenSky** (último recurso, cupo de créditos). Rutas (`AEP → ROS`) y tipo de avión salen de **adsbdb**,
con caché en el celu para no repetir consultas.

- **`?radio=200`** agranda el radio para ver que llegan datos aunque no pase nada a 30 km
  (`index.html?radio=200&debug=1`). No lo dejes así 24/7. Otros atajos: `proveedor=adsbfi` (uno fijo, sin fallback),
  `proxy=1` / `proxy=0`.
- **`web/diag.html`** prueba cada proveedor y adsbdb desde *este* navegador y dice cuál usar (o si hace falta el proxy).
  Abrilo desde el mismo navegador o Fully que va a usar el tablero. Cada corrida gasta 1 consulta de adsb.lol y 1 de OpenSky.
- **Proxy de Termux (opcional):** `python3 termux/proxy.py` sirve `web/` en `http://127.0.0.1:8080/` y reenvía `/api/...`
  con CORS. Hace falta si `diag.html` marca BLOQUEADO desde `file://`. Con `--fixtures scripts/fixtures` no sale a internet
  (para pruebas); `--falla airplaneslive=429` y `--demora-adsbdb-ms 1500` simulan problemas.
- **Créditos y cupos:** consulta cada 20 s en reposo y 10 s con aviones (60 s entre 01:00 y 05:30), unas 5000 por día: usá WiFi.
  adsb.lol sin key: 500/día; OpenSky anónimo: unos 400 créditos/día. OpenSky con cuenta solo conviene vía el proxy
  (credenciales en variables de entorno o `termux/credenciales.json`, que no se sube al repo). Ajustes anidados en
  `config.local.js`: `CONFIG.LIMITES.opensky = {REPOSO_S:60, ACTIVO_S:20, CUPO_DIARIO:4000};` (no uses `Object.assign` con `LIMITES`).

Datos de vuelos de [airplanes.live](https://airplanes.live), [adsb.fi](https://adsb.fi) (uso personal no comercial; hay que
citarlo), [adsb.lol](https://adsb.lol) (licencia ODbL) y [OpenSky Network](https://opensky-network.org/).
Rutas y tipos de aeronave de [adsbdb](https://www.adsbdb.com/): son para uso personal, no se republican ni se commitean datos reales.
