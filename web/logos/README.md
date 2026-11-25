# Logos de aerolíneas

El tablero busca el logo de cada aerolínea por su código IATA (ej. `AR`), en este orden:

1. **Local:** `web/logos/AR.png`.
2. **Remoto:** `CONFIG.LOGOS_URL` con `{IATA}` reemplazado (por defecto el CDN de logos de Kayak).
3. Si no encuentra ninguno: la cajita de color con el código.

Para bajar los logos al celu una sola vez (después no depende de internet para mostrarlos), en Termux:

```
python tablero-vuelos/termux/bajar_logos.py
```

Baja los de todas las aerolíneas de `web/js/aerolineas.js`. Los PNG **no se suben al repo** (están en `.gitignore`):
son marcas registradas de cada aerolínea y se usan solo en el tablero personal.
Se apagan desde la configuración (Mostrar logos de aerolíneas) o con `USAR_LOGOS_PNG: false`.
