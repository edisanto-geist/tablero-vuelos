#!/usr/bin/env python3
"""Baja los logos de aerolíneas a web/logos/<IATA>.png para que el tablero no dependa de internet para mostrarlos.

Uso (en Termux, desde la carpeta de arriba del repo):
    python tablero-vuelos/termux/bajar_logos.py            # baja los que faltan
    python tablero-vuelos/termux/bajar_logos.py --todos    # vuelve a bajar todos
    python tablero-vuelos/termux/bajar_logos.py AR LA G3   # solo esos

Toma la lista de códigos IATA de web/js/aerolineas.js. Los PNG NO se suben al repo (.gitignore):
son marcas de cada aerolínea, para uso personal en el tablero.
Solo usa la biblioteca estándar de Python.
"""
import os
import re
import sys
import time
import urllib.request

URL = 'https://content.r9cdn.net/rimg/provider-logos/airlines/v/{IATA}.png'
RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CARPETA = os.path.join(RAIZ, 'web', 'logos')
TABLA = os.path.join(RAIZ, 'web', 'js', 'aerolineas.js')


def codigos_de_tabla():
    with open(TABLA, encoding='utf-8') as f:
        texto = f.read()
    # a('ARG', 'AR', ...)
    cods = re.findall(r"a\('[A-Z0-9]{3}',\s*'([A-Z0-9]{2})'", texto)
    vistos = []
    for c in cods:
        if c not in vistos:
            vistos.append(c)
    return vistos


def bajar(iata):
    req = urllib.request.Request(URL.replace('{IATA}', iata), headers={'User-Agent': 'tablero-vuelos/1.0 (uso personal)'})
    with urllib.request.urlopen(req, timeout=20) as r:
        datos = r.read()
        tipo = r.headers.get('Content-Type', '')
    if not datos.startswith(b'\x89PNG') and 'image' not in tipo:
        raise ValueError('no es una imagen (%s)' % tipo)
    return datos


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    todos = '--todos' in sys.argv
    cods = [a.upper() for a in args] if args else codigos_de_tabla()
    os.makedirs(CARPETA, exist_ok=True)
    ok = salteados = fallas = 0
    for iata in cods:
        destino = os.path.join(CARPETA, iata + '.png')
        if os.path.exists(destino) and not todos:
            salteados += 1
            continue
        try:
            datos = bajar(iata)
            with open(destino, 'wb') as f:
                f.write(datos)
            print('OK     %s  (%d bytes)' % (iata, len(datos)))
            ok += 1
        except Exception as e:  # noqa: BLE001 — se informa y se sigue con el próximo
            print('FALLA  %s  %s' % (iata, e))
            fallas += 1
        time.sleep(0.3)
    print('\nListo: %d bajados, %d ya estaban, %d fallaron. Carpeta: %s' % (ok, salteados, fallas, CARPETA))
    return 0 if fallas == 0 else 1


if __name__ == '__main__':
    sys.exit(main())
