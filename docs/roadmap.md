# Hoja de ruta

Pedile a Claude Code que vaya fase por fase. Primer prompt sugerido al final.

## Fase 1 — Display en modo demo
- [x] `web/index.html` con el tablero (negro, amarillo/blanco, monoespaciada grande, efecto split-flap)
- [x] Modo `?demo=1` con aviones falsos y scroll automático cuando hay más de los que entran
- [x] Pantalla negra total en reposo
- [x] `web/beep.mp3` de 0.5 s generado por script + reproducción con Web Audio

## Fase 2 — Datos reales
- [x] Consulta de vuelos reales: airplanes.live (principal) con fallback adsb.fi / adsb.lol / OpenSky (bounding box)
- [x] Filtro por distancia (haversine) ≤ 30 km
- [x] Aerolínea (logo pendiente) por prefijo de callsign, tipo de avión por `icao24`, origen→destino IATA por adsbdb (con caché)
- [x] Dirección y distancia desde Ibarlucea ("AL NORTE · 12 KM") para ubicarlo en el cielo
- [x] Cálculo de tiempo al punto más cercano ("ETA")
- [x] Timeout de 2 min sin aviones → negro y silencio
- [x] Manejo de errores / reintentos / rate limits (enfriamientos, cupos diarios, fallback)
- [x] Prueba en vivo en el celu con `web/diag.html` (25/11/2026: vía Cloudflare solo responde adsb.lol → hace falta Termux)

## Fase 3 — El celu
- [x] Guía con Fully Kiosk Browser + Termux (`docs/instalacion.md`)
- [ ] Alternativa con Tasker (perfil exportado en `tasker/`)
- [x] Termux como proxy local (`termux/proxy.py` + arranque con Termux:Boot, en `docs/instalacion.md`)
- [ ] `docs/bateria-y-alimentacion.md`

## Fase 4 — Pulido
- [ ] Horario de silencio nocturno
- [ ] Animación de "flap" al cambiar caracteres
- [ ] Logo/colores por aerolínea (opcional)

---

## Primer prompt para Claude Code

> Leé CLAUDE.md y docs/roadmap.md. Arrancá la Fase 1: armá `web/index.html` con el tablero
> en modo demo (`?demo=1`), el beep de 0.5 s generado por script y la pantalla negra en reposo.
> Antes de escribir código, proponeme el plan en pocos bullets y una muestra del look.
