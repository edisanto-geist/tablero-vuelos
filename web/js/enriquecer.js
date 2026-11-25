// Enriquecimiento de vuelos con adsbdb: ruta (origen/destino IATA) por callsign y tipo de avión por hex.
// No bloquea el tick: aplicar() es sincrónico (solo caché) y pedir() encola consultas espaciadas.
(function (raiz) {
  var Geo = raiz.Geo;
  if (!Geo && typeof require === 'function' && typeof module === 'object') Geo = require('./geo.js');

  var RE_CALLSIGN = /^[A-Z]{3}[0-9][A-Z0-9]*$/;
  var RE_HEX = /^[0-9a-f]{6}$/;
  var CLAVE = 'tv.enriq.v1';
  var MAX_ENTRADAS = 400;
  var HORA = 3600 * 1000, DIA = 24 * HORA;
  var TTL = {
    rutaOk: 12 * HORA, rutaNulo: 6 * HORA,
    tipoOk: 30 * DIA, tipoNulo: 7 * DIA,
    error: 2 * 60 * 1000
  };
  var PAUSA_429_MS = 60 * 1000;
  var DEBOUNCE_MS = 5000;

  function num(v) { return (typeof v === 'number' && isFinite(v)) ? v : null; }
  function str(v) { return (typeof v === 'string' && v.trim() !== '') ? v.trim() : null; }

  function unref(t) { if (t && typeof t.unref === 'function') t.unref(); return t; }

  var Enriquecer = {
    parsearRuta: function (json) {
      var fr = json && json.response && json.response.flightroute;
      if (!fr || typeof fr !== 'object') return null;
      var o = fr.origin || {}, d = fr.destination || {}, a = fr.airline;
      var aerolinea = null;
      if (a && typeof a === 'object') {
        aerolinea = { icao: str(a.icao), iata: str(a.iata), nombre: str(a.name) };
      }
      return {
        origen: str(o.iata_code), destino: str(d.iata_code),
        origenIcao: str(o.icao_code), destinoIcao: str(d.icao_code),
        oLat: num(o.latitude), oLon: num(o.longitude),
        dLat: num(d.latitude), dLon: num(d.longitude),
        aerolinea: aerolinea
      };
    },

    parsearAeronave: function (json) {
      var ac = json && json.response && json.response.aircraft;
      if (!ac || typeof ac !== 'object') return null;
      var t = str(ac.icao_type);
      return t ? t.toUpperCase() : null;
    },

    // Una ruta es plausible si el avión está "cerca del camino" entre origen y destino.
    plausible: function (ruta, lat, lon) {
      if (!ruta || num(lat) === null || num(lon) === null) return true;
      if (num(ruta.oLat) === null || num(ruta.oLon) === null ||
          num(ruta.dLat) === null || num(ruta.dLon) === null) return true;
      var dO = Geo.distanciaKm(ruta.oLat, ruta.oLon, lat, lon);
      var dD = Geo.distanciaKm(ruta.dLat, ruta.dLon, lat, lon);
      var dOD = Geo.distanciaKm(ruta.oLat, ruta.oLon, ruta.dLat, ruta.dLon);
      return dO + dD <= dOD * 1.2 + 50;
    },

    crear: function (config, red, almacen, alActualizar) {
      config = config || {};
      var cache = { r: {}, t: {} };
      var cola = [];                 // [{k, tipo:'r'|'t', clave}]
      var enCola = {};               // k -> true (en cola o en vuelo)
      var enVuelo = 0, pedidos = 0, ultimoStatus = null, pausaHastaMs = 0;
      var relojBase = Date.now(), relojReal = Date.now();
      var timerCola = null, timerGuardar = null, esperando = [];

      function ahora() { return relojBase + (Date.now() - relojReal); }
      function fijarReloj(ms) {
        if (typeof ms === 'number' && isFinite(ms)) { relojBase = ms; relojReal = Date.now(); }
      }
      function espaciado() {
        return typeof config.ENRIQ_ESPACIADO_MS === 'number' ? config.ENRIQ_ESPACIADO_MS : 1000;
      }
      function maxPorTick() {
        return typeof config.ENRIQ_MAX_POR_TICK === 'number' ? config.ENRIQ_MAX_POR_TICK : 8;
      }

      // ---- caché ----
      function entrada(mapa, clave) {
        var e = cache[mapa][clave];
        if (!e || !(e.e > ahora())) return undefined;
        return e;
      }
      function guardar(mapa, clave, valor, ttl, persistir) {
        cache[mapa][clave] = { v: valor, e: ahora() + ttl, m: persistir ? 0 : 1 };
        if (persistir) programarGuardado();
      }
      function recortar(obj) {
        var ks = Object.keys(obj);
        if (ks.length <= MAX_ENTRADAS) return;
        ks.sort(function (a, b) { return obj[a].e - obj[b].e; });
        for (var i = 0; i < ks.length - MAX_ENTRADAS; i++) delete obj[ks[i]];
      }
      function programarGuardado() {
        if (!almacen || timerGuardar) return;
        timerGuardar = unref(setTimeout(function () { timerGuardar = null; escribir(); }, DEBOUNCE_MS));
      }
      function escribir() {
        if (!almacen) return;
        try {
          var out = { r: {}, t: {} }, ya = ahora();
          ['r', 't'].forEach(function (m) {
            recortar(cache[m]);
            Object.keys(cache[m]).forEach(function (k) {
              var e = cache[m][k];
              if (!e.m && e.e > ya) out[m][k] = { v: e.v, e: e.e };
            });
          });
          almacen.escribir(CLAVE, out);
        } catch (err) { /* sin persistencia, seguimos en memoria */ }
      }
      function cargar() {
        if (!almacen) return;
        try {
          var d = almacen.leer(CLAVE);
          if (!d || typeof d !== 'object') return;
          ['r', 't'].forEach(function (m) {
            var src = d[m];
            if (!src || typeof src !== 'object') return;
            Object.keys(src).forEach(function (k) {
              var e = src[k];
              if (e && typeof e === 'object' && typeof e.e === 'number') {
                cache[m][k] = { v: e.v === undefined ? null : e.v, e: e.e, m: 0 };
              }
            });
          });
        } catch (err) { cache = { r: {}, t: {} }; }
      }
      cargar();

      // ---- cola ----
      function avisar() {
        if (typeof alActualizar === 'function') {
          try { alActualizar(); } catch (err) { console.error('[enriq] alActualizar falló', err); }
        }
      }
      function resolverEsperas() {
        if (enVuelo > 0) return;
        if (cola.length > 0 && !(ahora() < pausaHastaMs)) return;
        var w = esperando; esperando = [];
        w.forEach(function (f) { f(); });
      }
      function agendar(ms) {
        if (timerCola) return;
        timerCola = setTimeout(function () { timerCola = null; paso(); }, Math.max(0, ms));
      }
      function paso() {
        if (enVuelo > 0) return;
        if (!cola.length) { resolverEsperas(); return; }
        var espera = pausaHastaMs - ahora();
        if (espera > 0) { resolverEsperas(); agendar(espera); return; }
        var it = cola.shift();
        it.reencolar = false;
        enVuelo++; pedidos++;
        var url = red.url('adsbdb', (it.tipo === 'r' ? 'callsign/' : 'aircraft/') + it.clave);
        var p;
        try { p = red.pedirJSON({ url: url }); } catch (err) { p = Promise.resolve({ ok: false, status: 0, json: null }); }
        Promise.resolve(p).then(function (resp) { return resp || { ok: false, status: 0, json: null }; },
          function () { return { ok: false, status: 0, json: null }; })
        .then(function (resp) {
          try { manejar(it, resp); } catch (err) { console.error('[enriq] error al manejar respuesta', err); }
          enVuelo--;
          if (it.reencolar) { /* ya se reencoló en manejar */ }
          else delete enCola[it.k];
          if (cola.length) agendar(it.reencolar ? 0 : espaciado()); else resolverEsperas();
        });
      }
      function manejar(it, resp) {
        var st = resp.status || 0;
        ultimoStatus = st;
        var esRuta = it.tipo === 'r';
        var mapa = it.tipo;
        if (st === 429) {
          pausaHastaMs = ahora() + PAUSA_429_MS;
          it.reencolar = true;
          cola.unshift(it);
          return;
        }
        if (st >= 200 && st < 300) {
          var v = esRuta ? Enriquecer.parsearRuta(resp.json) : Enriquecer.parsearAeronave(resp.json);
          if (v) {
            guardar(mapa, it.clave, v, esRuta ? TTL.rutaOk : TTL.tipoOk, true);
            console.log(esRuta ? '[enriq] ruta ' + it.clave + ' → ' + (v.origen || '---') + '-' + (v.destino || '---')
                               : '[enriq] tipo ' + it.clave + ' → ' + v);
          } else {
            guardar(mapa, it.clave, null, esRuta ? TTL.rutaNulo : TTL.tipoNulo, true);
          }
          avisar();
        } else if (st === 404) {
          guardar(mapa, it.clave, null, esRuta ? TTL.rutaNulo : TTL.tipoNulo, true);
          avisar();
        } else {
          guardar(mapa, it.clave, null, TTL.error, false);   // solo memoria, no avisa
        }
      }
      function encolar(tipo, clave) {
        var k = tipo + ':' + clave;
        if (enCola[k]) return;
        if (entrada(tipo, clave) !== undefined) return;
        enCola[k] = true;
        cola.push({ k: k, tipo: tipo, clave: clave });
      }

      var e = {
        aplicar: function (crudos, ahoraMs) {
          fijarReloj(ahoraMs);
          if (!crudos) return;
          for (var i = 0; i < crudos.length; i++) {
            var c = crudos[i];
            if (!c) continue;
            var cs = String(c.callsign || '').trim().toUpperCase();
            if (RE_CALLSIGN.test(cs) && !c.origen && !c.destino) {
              var er = entrada('r', cs);
              if (er && er.v && Enriquecer.plausible(er.v, c.lat, c.lon)) {
                c.origen = er.v.origen; c.destino = er.v.destino;
              }
            }
            if (!c.tipo) {
              var hex = String(c.icao24 || '').toLowerCase();
              if (RE_HEX.test(hex)) {
                var et = entrada('t', hex);
                if (et && et.v) c.tipo = et.v;
              }
            }
          }
        },
        pedir: function (vuelos, ahoraMs) {
          fijarReloj(ahoraMs);
          if (!vuelos) return;
          var n = Math.min(vuelos.length, maxPorTick());
          for (var i = 0; i < n; i++) {
            var v = vuelos[i];
            if (!v) continue;
            var cs = String(v.callsign || '').trim().toUpperCase();
            if (RE_CALLSIGN.test(cs)) encolar('r', cs);
            var hex = String(v.id || v.icao24 || '').toLowerCase();
            if (!v.tipo && RE_HEX.test(hex)) encolar('t', hex);
          }
          if (cola.length) agendar(0);
        },
        // Resuelve cuando la cola queda vacía y no hay nada en vuelo (o cuando está en pausa por 429).
        drenar: function () {
          return new Promise(function (resolve) {
            if (enVuelo === 0 && (cola.length === 0 || ahora() < pausaHastaMs)) { resolve(); return; }
            esperando.push(resolve);
            if (cola.length) agendar(0);
          });
        },
        ruta: function (cs) {
          var x = entrada('r', String(cs || '').trim().toUpperCase());
          return x ? x.v : undefined;
        },
        tipo: function (hex) {
          var x = entrada('t', String(hex || '').toLowerCase());
          return x ? x.v : undefined;
        },
        info: function () {
          return {
            cola: cola.length, enVuelo: enVuelo,
            rutas: Object.keys(cache.r).length, tipos: Object.keys(cache.t).length,
            pedidos: pedidos, ultimoStatus: ultimoStatus, pausaHastaMs: pausaHastaMs
          };
        },
        // Fuerza la escritura al almacén (útil en tests).
        guardarAhora: function () { if (timerGuardar) { clearTimeout(timerGuardar); timerGuardar = null; } escribir(); }
      };
      return e;
    }
  };

  raiz.Enriquecer = Enriquecer;
  if (typeof module === 'object' && module.exports) module.exports = Enriquecer;
})(typeof window !== 'undefined' ? window : globalThis);
