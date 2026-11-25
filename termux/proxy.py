#!/usr/bin/env python3
"""Proxy local del Tablero de Vuelos (solo stdlib, Python 3).

Sirve la carpeta web/ y reenvia /api/<servicio>/... a las APIs reales agregando CORS.
Sirve para evitar los problemas de CORS desde file:// y para guardar las credenciales
(OpenSky OAuth2, key de adsb.lol) fuera del navegador.

Uso:
  python3 termux/proxy.py [--puerto 8080] [--web web] [--fixtures scripts/fixtures]
                          [--falla airplaneslive=429 ...] [--demora-adsbdb-ms 1500]

Credenciales (opcionales): variables de entorno OPENSKY_CLIENT_ID, OPENSKY_CLIENT_SECRET,
ADSBLOL_KEY, AEROAPI_KEY (horarios), o el archivo termux/credenciales.json (esta en .gitignore) con esas mismas claves.
Tambien pueden llegar por header desde config.html (X-TV-ADSBLOL-KEY, X-TV-OPENSKY-ID, X-TV-OPENSKY-SECRET,
X-TV-AEROAPI-KEY) y esos tienen prioridad sobre el archivo y las variables de entorno.
Con --fixtures no sale a internet: contesta con los JSON de esa carpeta.
"""
import argparse
import functools
import gzip
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

BASES = {
    'airplaneslive': 'https://api.airplanes.live/v2/',
    'adsbfi': 'https://opendata.adsb.fi/api/',
    'adsblol': 'https://api.adsb.lol/',
    'opensky': 'https://opensky-network.org/api/',
    'adsbdb': 'https://api.adsbdb.com/v0/',
    'aeroapi': 'https://aeroapi.flightaware.com/aeroapi/',
}
# De AeroAPI solo se deja pasar lo que usa el tablero (cada consulta cuesta plata).
RUTA_AEROAPI = re.compile(r'^flights/[A-Za-z0-9]{3,8}$')
AUTH_OPENSKY = 'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token'
PASAR = ('Retry-After', 'X-Rate-Limit-Remaining', 'X-Rate-Limit-Retry-After-Seconds')
QUI = os.path.dirname(os.path.abspath(__file__))

CFG = {'fixtures': None, 'fallas': {}, 'demora_adsbdb': 0, 'cred': {}, 'tokens': {}}


def cargar_credenciales():
    cred = {}
    try:
        with open(os.path.join(QUI, 'credenciales.json'), encoding='utf-8') as f:
            cred = json.load(f)
    except (OSError, ValueError):
        pass
    for k in ('OPENSKY_CLIENT_ID', 'OPENSKY_CLIENT_SECRET', 'ADSBLOL_KEY', 'AEROAPI_KEY'):
        if os.environ.get(k):
            cred[k] = os.environ[k]
    return cred


def credencial(cli, clave, header):
    """Header X-TV-* del navegador (prioridad) o archivo/variable de entorno."""
    return cli.get(header) or CFG['cred'].get(clave) or ''


def token_opensky(cli, forzar=False):
    cid = credencial(cli, 'OPENSKY_CLIENT_ID', 'x-tv-opensky-id')
    sec = credencial(cli, 'OPENSKY_CLIENT_SECRET', 'x-tv-opensky-secret')
    if not cid or not sec:
        return None
    t = CFG['tokens'].get(cid)   # el token se cachea por client_id
    if not forzar and t and time.time() < t[1]:
        return t[0]
    cuerpo = urllib.parse.urlencode({'grant_type': 'client_credentials', 'client_id': cid,
                                     'client_secret': sec}).encode()
    req = urllib.request.Request(AUTH_OPENSKY, data=cuerpo, method='POST',
                                 headers={'Content-Type': 'application/x-www-form-urlencoded'})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            j = json.loads(r.read().decode('utf-8'))
        if j.get('access_token'):
            CFG['tokens'][cid] = (j['access_token'], time.time() + float(j.get('expires_in', 1800)) - 60)
            return j['access_token']
    except Exception as e:  # noqa: BLE001
        print('[proxy] no pude pedir el token de OpenSky: %s' % e, file=sys.stderr)
    CFG['tokens'].pop(cid, None)
    return None


def leer_cuerpo(resp):
    datos = resp.read()
    if resp.headers.get('Content-Encoding', '').lower() == 'gzip':
        try:
            datos = gzip.decompress(datos)
        except OSError:
            pass
    return datos


def pedir_upstream(servicio, resto, query, cli=None, reintento=True):
    """Devuelve (status, headers_dict, cuerpo_bytes). Lanza OSError si no hay red."""
    cli = cli or {}
    url = BASES[servicio] + resto + (('?' + query) if query else '')
    h = {'User-Agent': 'tablero-vuelos/1.0', 'Accept': 'application/json', 'Accept-Encoding': 'gzip'}
    if servicio == 'adsblol':
        k = credencial(cli, 'ADSBLOL_KEY', 'x-tv-adsblol-key')
        if k:
            h['x-api-key'] = k
    if servicio == 'opensky':
        tk = token_opensky(cli)
        if tk:
            h['Authorization'] = 'Bearer ' + tk
    if servicio == 'aeroapi':
        k = credencial(cli, 'AEROAPI_KEY', 'x-tv-aeroapi-key')
        if not k:
            return 401, {}, b'{"error":"sin clave de horarios"}'
        h['x-apikey'] = k
    req = urllib.request.Request(url, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status, dict(r.headers.items()), leer_cuerpo(r)
    except urllib.error.HTTPError as e:
        if e.code == 401 and servicio == 'opensky' and reintento and token_opensky(cli, forzar=True):
            return pedir_upstream(servicio, resto, query, cli, reintento=False)
        return e.code, dict(e.headers.items()), leer_cuerpo(e)


def fixture(servicio, resto):
    """Devuelve (status, archivo) segun la tabla del modo --fixtures."""
    d = CFG['fixtures']
    ruta = resto.split('?')[0]
    if servicio == 'aeroapi':
        m = re.match(r'^flights/([A-Za-z0-9]+)$', ruta)
        if m:
            f = os.path.join(d, 'aeroapi_flights_%s.json' % m.group(1).upper())
            return 200, (f if os.path.isfile(f) else os.path.join(d, 'aeroapi_flights_vacio.json'))
    if servicio in ('airplaneslive', 'adsbfi', 'adsblol'):
        return 200, os.path.join(d, 'readsb_point.json')
    if servicio == 'opensky':
        return 200, os.path.join(d, 'opensky_states.json')
    if servicio == 'adsbdb':
        m = re.match(r'^(callsign|aircraft)/([A-Za-z0-9]+)$', ruta)
        if m:
            clave = m.group(2).upper() if m.group(1) == 'callsign' else m.group(2).lower()
            f = os.path.join(d, 'adsbdb_%s_%s.json' % (m.group(1), clave))
            if os.path.isfile(f):
                return 200, f
            return 404, os.path.join(d, 'adsbdb_%s_404.json' % m.group(1))
    return 404, None


class Manejador(SimpleHTTPRequestHandler):
    nota = ''

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        SimpleHTTPRequestHandler.end_headers(self)

    def log_message(self, fmt, *args):
        pass

    def log_request(self, code='-', size='-'):
        ms = int((time.time() - getattr(self, '_t0', time.time())) * 1000)
        print('%s %s -> %s %dms%s' % (self.command, self.path, code, ms, self.nota), flush=True)

    def _cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Expose-Headers', ', '.join(PASAR))
        self.send_header('Access-Control-Allow-Headers', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')

    def _responder(self, status, cuerpo, ctype='application/json', extra=None):
        self.send_response(status)
        self._cors()
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(cuerpo)))
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(cuerpo)

    def do_OPTIONS(self):
        self._t0 = time.time()
        self.send_response(204)
        self._cors()
        self.send_header('Content-Length', '0')
        self.end_headers()

    def do_GET(self):
        self._t0 = time.time()
        self.nota = ''
        ruta, _, query = self.path.partition('?')
        if ruta == '/api/salud':
            self._responder(200, json.dumps({'ok': True, 'fixtures': bool(CFG['fixtures'])}).encode())
            return
        if ruta.startswith('/api/'):
            self._api(ruta[5:], query)
            return
        SimpleHTTPRequestHandler.do_GET(self)

    def _api(self, resto_total, query):
        servicio, _, resto = resto_total.partition('/')
        if servicio not in BASES:
            self._responder(404, b'{"error":"servicio desconocido"}')
            return
        if servicio == 'aeroapi' and not RUTA_AEROAPI.match(resto):
            self._responder(400, b'{"error":"ruta no permitida"}')
            return
        if servicio == 'adsbdb' and CFG['demora_adsbdb'] > 0:
            time.sleep(CFG['demora_adsbdb'] / 1000.0)
        if servicio in CFG['fallas']:
            cod = CFG['fallas'][servicio]
            extra = {'Retry-After': '60'} if cod == 429 else {}
            self.nota = ' (falla simulada)'
            self._responder(cod, json.dumps({'error': 'falla simulada %d' % cod}).encode(), extra=extra)
            return
        if CFG['fixtures']:
            cod, arch = fixture(servicio, resto)
            self.nota = ' (fixture)'
            if arch and os.path.isfile(arch):
                with open(arch, 'rb') as f:
                    self._responder(cod, f.read())
            else:
                self._responder(404, b'{"response":"sin fixture"}')
            return
        try:
            cli = {k.lower(): v.strip() for k, v in self.headers.items() if k.lower().startswith('x-tv-')}
            cod, hs, cuerpo = pedir_upstream(servicio, resto, query, cli)
        except Exception as e:  # noqa: BLE001 (red caida, timeout, DNS)
            self._responder(502, json.dumps({'error': str(e)}).encode())
            return
        extra = {k: v for k in PASAR for kk, v in hs.items() if kk.lower() == k.lower()}
        ctype = next((v for kk, v in hs.items() if kk.lower() == 'content-type'), 'application/json')
        self._responder(cod, cuerpo, ctype=ctype, extra=extra)


def main():
    ap = argparse.ArgumentParser(description='Proxy local del Tablero de Vuelos')
    ap.add_argument('--puerto', type=int, default=8080)
    ap.add_argument('--web', default=os.path.join(QUI, '..', 'web'))
    ap.add_argument('--fixtures', default=None, help='carpeta con JSON de prueba (no sale a internet)')
    ap.add_argument('--falla', action='append', default=[], metavar='SERVICIO=CODIGO',
                    help='responde ese codigo HTTP para el servicio (ej: airplaneslive=429)')
    ap.add_argument('--demora-adsbdb-ms', type=int, default=0)
    a = ap.parse_args()
    CFG['fixtures'] = os.path.abspath(a.fixtures) if a.fixtures else None
    CFG['demora_adsbdb'] = a.demora_adsbdb_ms
    for par in a.falla:
        k, _, v = par.partition('=')
        if k not in BASES or not v.isdigit():
            ap.error('--falla invalido: %s (esperaba servicio=codigo)' % par)
        CFG['fallas'][k] = int(v)
    CFG['cred'] = cargar_credenciales()
    web = os.path.abspath(a.web)
    srv = ThreadingHTTPServer(('127.0.0.1', a.puerto), functools.partial(Manejador, directory=web))
    print('Proxy en http://127.0.0.1:%d/  (web=%s%s)' % (a.puerto, web, ', FIXTURES' if CFG['fixtures'] else ''), flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
