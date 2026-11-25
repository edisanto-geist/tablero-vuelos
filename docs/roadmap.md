# Hoja de ruta

Pedile a Claude Code que vaya fase por fase. Primer prompt sugerido al final.

## Fase 1 — Display en modo demo
- [ ] `web/index.html` con el tablero (negro, amarillo/blanco, monoespaciada grande, efecto split-flap)
- [ ] Modo `?demo=1` con aviones falsos y scroll automático cuando hay más de los que entran
- [ ] Pantalla negra total en reposo
- [ ] `web/beep.mp3` de 0.5 s generado por script + reproducción con Web Audio

## Fase 2 — Datos reales
- [ ] Consulta a OpenSky con bounding box alrededor de Ibarlucea
- [ ] Filtro por distancia (haversine) ≤ 30 km
- [ ] Aerolínea + logo por prefijo de callsign, tipo de avión por `icao24`, origen→destino IATA por adsbdb (con caché)
- [ ] Dirección y distancia desde Ibarlucea ("AL NORTE · 12 KM") para ubicarlo en el cielo
- [ ] Cálculo de tiempo al punto más cercano ("ETA")
- [ ] Timeout de 2 min sin aviones → negro y silencio
- [ ] Manejo de errores / reintentos / rate limits

## Fase 3 — El celu
- [ ] Guía con Fully Kiosk Browser (encender pantalla, autoplay, arranque al bootear)
- [ ] Alternativa con Tasker (perfil exportado en `tasker/`)
- [ ] Opcional: Termux como proxy local si hay CORS
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
