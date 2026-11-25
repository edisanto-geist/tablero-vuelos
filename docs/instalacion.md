# Instalación en el celu

Cómo dejar el tablero andando 24/7 en el celu que va a quedar fijo, con **Fully Kiosk Browser** y
**Termux** como intermediario local.

## Por qué Termux

Las APIs de vuelos no dejan que el navegador las consulte directo (no mandan CORS). Desde GitHub Pages
el tablero pasa por el Worker de Cloudflare, pero **adsb.fi, OpenSky y airplanes.live bloquean a
Cloudflare**, y el único que queda es adsb.lol, con tope de 500 consultas por día. El tablero hace
unas 5000, así que se queda sin datos a media mañana (diagnóstico del 25/11/2026).

Termux corre `termux/proxy.py` dentro del mismo celu: consulta desde el WiFi de casa, donde adsb.fi
responde sin tope, y le sirve el tablero a Fully en `http://127.0.0.1:8080/`.

## 1. Preparar el celu

- Conectarlo al **WiFi de casa** (no dejarlo con datos móviles).
- Ajustes → Seguridad → bloqueo de pantalla: **Ninguno**.
- Fecha y hora **automáticas**, zona Buenos Aires (GMT-3). El reloj del tablero sale de acá.
- Si existe, activar **Proteger batería / limitar carga al 80–85 %** (Ajustes → Batería).

## 2. Termux

1. Instalar **Termux** y **Termux:Boot** desde [F-Droid](https://f-droid.org). No usar las del
   Play Store: están desactualizadas y fallan.
2. Abrir Termux y pegar:

   ```sh
   pkg update -y && pkg install -y python git
   git clone https://github.com/edisanto-geist/tablero-vuelos
   cd tablero-vuelos && python termux/proxy.py
   ```

3. Con eso corriendo, abrir `http://127.0.0.1:8080/diag.html` en el navegador del celu.
   **adsb.fi** debería dar **OK**.

### Arranque automático

1. Abrir **Termux:Boot** una vez (solo para que Android lo registre).
2. Volver a Termux, cortar el proxy con Ctrl+C y pegar:

   ```sh
   mkdir -p ~/.termux/boot
   printf '#!/data/data/com.termux/files/usr/bin/sh\ntermux-wake-lock\ncd ~/tablero-vuelos && python termux/proxy.py\n' > ~/.termux/boot/tablero.sh
   chmod +x ~/.termux/boot/tablero.sh
   ```

3. Ajustes → Batería → poner **Termux** y **Termux:Boot** como **sin restricciones**.
4. Reiniciar el celu y confirmar que `http://127.0.0.1:8080/` abre solo.

## 3. Fully Kiosk Browser

Instalar **Fully Kiosk Browser** del Play Store (la versión gratis alcanza) y ponerlo también como
**sin restricciones** de batería. La configuración se abre deslizando desde el borde izquierdo →
Settings. Los nombres pueden variar un poco según la versión.

| Sección | Opción | Valor |
|---|---|---|
| Web Content Settings | Start URL | `http://127.0.0.1:8080/` |
| Web Content Settings | Autoplay Videos / Audio | Activado (el beep suena sin tocar) |
| Advanced Web Settings | Enable JavaScript Interface | Activado |
| Device Management | Keep Screen On | Activado |
| Device Management | Launch on Boot | Activado |
| Device Management | Screen Orientation | Landscape |
| Toolbars & Appearance | Fullscreen Mode | Activado |

En reposo la pantalla queda **negra pero prendida**. En AMOLED casi no consume. En LCD la luz de
fondo sigue encendida: ahí conviene activar `APAGAR_PANTALLA_FISICA` (usa `fully.turnScreenOff()`).

## 4. Configurar el tablero

- **5 toques en menos de 3 s** en cualquier parte de la pantalla abren la configuración.
- Revisar ubicación, radio y sonido.
- **Brújula:** se mide una sola vez. Apoyar el celu plano donde va a quedar, con la parte de arriba
  apuntando para el lado contrario a uno (hacia donde se mira el tablero), tocar LEER BRÚJULA, no
  moverlo 5 s y guardar. Después se pone en el soporte como sea. Repetir solo si se cambia de lugar.
- Los ajustes se guardan por dirección: los que se hayan cargado en la versión de GitHub Pages no
  pasan solos a `127.0.0.1`. Exportarlos desde la configuración e importarlos.

## 5. Probar

- `http://127.0.0.1:8080/index.html?radio=200&debug=1`: tienen que aparecer vuelos y sonar el beep.
  No dejarlo así: volver a la Start URL normal.
- `?demo=1` muestra aviones falsos para ver el look sin depender de la API.

## Actualizar

Los cambios del repo no llegan solos (Fully sirve la copia local). En Termux:

```sh
cd ~/tablero-vuelos && git pull
```

y recargar Fully.

## Sin Termux (solo pruebas)

`https://edisanto-geist.github.io/tablero-vuelos/` anda en cualquier navegador (celu, compu) vía el
Worker de Cloudflare, pero con el tope de adsb.lol. Sirve para mostrarlo o probar, no para dejarlo 24/7.
