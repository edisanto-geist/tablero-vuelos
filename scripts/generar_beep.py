#!/usr/bin/env python3
"""Genera el beep del tablero (ding-dong de 0,5 s).

Solo usa la biblioteca estandar de Python + ffmpeg (por subprocess).
Escribe:
  web/beep.mp3          el audio
  web/js/beep-data.js   el mismo mp3 en base64 (para file://, donde no hay fetch)

Uso:
  python3 scripts/generar_beep.py [--wav RUTA.wav]

El resultado es deterministico: correrlo dos veces da los mismos bytes.
El mismo sonido lo sintetiza con osciladores web/js/sonido.js como ultimo
recurso: si cambias algo aca (notas, envolvente), cambialo alla tambien.
"""
import argparse
import base64
import math
import os
import shutil
import struct
import subprocess
import sys
import tempfile
import wave

SR = 44100
N = 22050                 # exactamente 0,500 s
PICO = 0.708              # -3 dBFS
NOTAS = [(1046.50, 0.000),  # C6 "ding"
         (880.00, 0.200)]   # A5 "dong"
ARMONICOS = [(1, 1.0), (2, 0.3), (3, 0.1)]
ATAQUE_S = 0.005
TAU_S = 0.12
FADE_S = 0.030

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RUTA_MP3 = os.path.join(RAIZ, 'web', 'beep.mp3')
RUTA_JS = os.path.join(RAIZ, 'web', 'js', 'beep-data.js')


def sintetizar():
    """Devuelve la lista de N muestras float normalizadas a pico PICO."""
    x = [0.0] * N
    for freq, inicio in NOTAS:
        i0 = int(round(inicio * SR))
        for i in range(i0, N):
            t = (i - i0) / SR
            env = (t / ATAQUE_S if t < ATAQUE_S else 1.0) * math.exp(-t / TAU_S)
            s = 0.0
            for mult, amp in ARMONICOS:
                s += amp * math.sin(2 * math.pi * freq * mult * t)
            x[i] += env * s
    # fade-out lineal en los ultimos 30 ms, llegando a 0 exacto en la ultima muestra
    nf = int(round(FADE_S * SR))
    for k in range(nf):
        i = N - nf + k
        x[i] *= (N - 1 - i) / nf
    pico = max(abs(v) for v in x)
    return [v * PICO / pico for v in x]


def escribir_wav(ruta, muestras):
    with wave.open(ruta, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(b''.join(struct.pack('<h', int(round(v * 32767))) for v in muestras))


def main():
    ap = argparse.ArgumentParser(description='Genera web/beep.mp3 y web/js/beep-data.js')
    ap.add_argument('--wav', metavar='RUTA', help='ademas guarda el WAV sin comprimir en RUTA')
    args = ap.parse_args()

    if shutil.which('ffmpeg') is None:
        sys.stderr.write('ERROR: no encuentro ffmpeg en el PATH. Instalalo '
                         '(apt install ffmpeg / brew install ffmpeg) y volve a correr.\n')
        return 1

    muestras = sintetizar()
    if args.wav:
        escribir_wav(args.wav, muestras)
        print('WAV: %s' % args.wav)

    fd, tmp = tempfile.mkstemp(suffix='.wav')
    os.close(fd)
    try:
        escribir_wav(tmp, muestras)
        # -bitexact / -map_metadata -1: sin version de ffmpeg ni fechas en el mp3,
        # asi la salida es identica entre corridas.
        cmd = ['ffmpeg', '-y', '-loglevel', 'error', '-f', 'wav', '-i', tmp,
               '-ac', '1', '-ar', '44100', '-codec:a', 'libmp3lame', '-b:a', '96k',
               '-map_metadata', '-1', '-fflags', '+bitexact', '-flags:a', '+bitexact',
               RUTA_MP3]
        r = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        if r.returncode != 0:
            sys.stderr.write('ERROR: ffmpeg fallo:\n%s\n' % r.stderr.decode('utf-8', 'replace'))
            return 1
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)

    with open(RUTA_MP3, 'rb') as f:
        datos = f.read()
    b64 = base64.b64encode(datos).decode('ascii')
    with open(RUTA_JS, 'w', newline='\n') as f:
        f.write('// ARCHIVO GENERADO por scripts/generar_beep.py. No editar a mano.\n')
        f.write('// Es web/beep.mp3 en base64, para poder reproducirlo desde file:// sin fetch.\n')
        f.write('window.BEEP_MP3_BASE64 = "%s";\n' % b64)
        # Sonidos alternativos de web/sonidos/*.mp3 (CONFIG.SONIDO elige cuál). 'sintetico' es web/beep.mp3.
        carpeta = os.path.join(RAIZ, 'web', 'sonidos')
        f.write('window.BEEP_SONIDOS = { sintetico: window.BEEP_MP3_BASE64 };\n')
        if os.path.isdir(carpeta):
            for nombre in sorted(os.listdir(carpeta)):
                if nombre.endswith('.mp3'):
                    with open(os.path.join(carpeta, nombre), 'rb') as g:
                        f.write('window.BEEP_SONIDOS[%r] = "%s";\n' % (nombre[:-4], base64.b64encode(g.read()).decode('ascii')))

    print('Muestras: %d a %d Hz = %.3f s' % (len(muestras), SR, len(muestras) / SR))
    print('MP3: %s (%d bytes)' % (RUTA_MP3, len(datos)))
    print('JS:  %s' % RUTA_JS)
    return 0


if __name__ == '__main__':
    sys.exit(main())
