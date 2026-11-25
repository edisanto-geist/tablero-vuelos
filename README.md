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

## Datos

Vuelos en tiempo real vía [OpenSky Network](https://opensky-network.org/) (gratis).
