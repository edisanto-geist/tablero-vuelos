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

## Datos

Vuelos en tiempo real vía [OpenSky Network](https://opensky-network.org/) (gratis).
