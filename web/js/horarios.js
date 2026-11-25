// Horarios de salida (SAL) y llegada (ETA): calculados a ojo (nivel a) o traídos de FlightAware AeroAPI por proxy (nivel b).
// Puro salvo Horarios.crear, que arma una cola de consultas espaciadas con caché y cupo diario.
(function (raiz) {
  var Geo = raiz.Geo;
  if (!Geo && typeof require === 'function' && typeof module === 'object') Geo = require('./geo.js');

  var RE_CALLSIGN = /^[A-Z]{3}[0-9][A-Z0-9]*$/;
  var CLAVE = 'tv.horarios.v1';
  var MIN = 60000, HORA = 3600000;
  var TTL_OK = 18 * HORA, TTL_ERROR = 5 * MIN, PAUSA_429_MS = 10 * MIN;
  var MAX_ENTRADAS = 300, MAX_VISTOS = 300, DEBOUNCE_MS = 5000;

  // Coordenadas [lat, lon] de OurAirports (dominio público).
  var AEROPUERTOS = {
    ROS: [-32.9036, -60.785], AEP: [-34.5592, -58.4156], EZE: [-34.8222, -58.5358], COR: [-31.3236, -64.208],
    MDZ: [-32.8317, -68.7929], SLA: [-24.856, -65.4862], TUC: [-26.8409, -65.1049], JUJ: [-24.3928, -65.0978],
    IGR: [-25.7373, -54.4734], BRC: [-41.1512, -71.1575], NQN: [-38.949, -68.1557], FTE: [-50.2803, -72.0531],
    USH: [-54.8433, -68.2958], MDQ: [-37.9342, -57.5733], BHI: [-38.725, -62.1693], CRD: [-45.7853, -67.4655],
    REL: [-43.2105, -65.2703], SFN: [-31.7117, -60.8117], PRA: [-31.7948, -60.4804], RES: [-27.4499, -59.0561],
    CNQ: [-27.4455, -58.7619], MVD: [-34.8384, -56.0308], ASU: [-25.24, -57.519], GRU: [-23.4356, -46.4731],
    GIG: [-22.81, -43.2506], FLN: [-27.6703, -48.5525], POA: [-29.9944, -51.1714], SCL: [-33.393, -70.7858],
    LIM: [-12.0219, -77.1143], PTY: [9.0714, -79.3835], BOG: [4.7016, -74.1469], MIA: [25.7932, -80.2906]
  };

  function num(v) { return (typeof v === 'number' && isFinite(v)) ? v : null; }
  function unref(t) { if (t && typeof t.unref === 'function') t.unref(); return t; }
  function zona(config) { return (config && typeof config.ZONA_UTC_MIN === 'number') ? config.ZONA_UTC_MIN : -180; }
  function modo(config) {
    var m = config && config.HORARIOS_MODO;
    return (m === 'no' || m === 'api') ? m : 'calc';
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function hhmm(ms, config) {
    var d = new Date(ms + zona(config) * MIN);
    return pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes());
  }
  // Redondea a múltiplos de pasoMin en hora local (así el redondeo coincide con lo que se ve en el reloj).
  function redondear(ms, pasoMin, config) {
    var off = zona(config) * MIN, u = pasoMin * MIN;
    return Math.round((ms + off) / u) * u - off;
  }
  function iso(ms) { return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z'); }
  function ts(x) {
    if (typeof x !== 'string' || x === '') return null;
    var t = Date.parse(x);
    return isNaN(t) ? null : t;
  }
  function primero(a, b) { return a !== null ? a : b; }

  var Horarios = {
    AEROPUERTOS: AEROPUERTOS,

    coords: function (iata) {
      var c = iata ? AEROPUERTOS[String(iata).toUpperCase()] : null;
      return c ? { lat: c[0], lon: c[1] } : null;
    },

    // Minutos de vuelo restantes (o recorridos) para una distancia, según la fase típica del vuelo.
    tramoMin: function (dKm, gsKmh, altM) {
      if (dKm <= 60) return dKm / ((gsKmh + 250) / 2) * 60 + 1;
      if (dKm <= 250) return dKm / Math.max(gsKmh, 550) * 60 + 4;
      var v = (altM !== null && altM !== undefined && altM >= 6000) ? gsKmh : Math.max(gsKmh, 780);
      return dKm / v * 60 + 8;
    },

    fechaLocal: function (ms, config) {
      return new Date(ms + zona(config) * MIN).toISOString().slice(0, 10);
    },

    // Nivel (a): estima salida y llegada con distancias y velocidad. Devuelve siempre un objeto (campos null si no se puede).
    calcular: function (v, config, ahoraMs) {
      var out = { salidaMs: null, salidaTipo: null, etaMs: null, etaTipo: null };
      if (!v || num(v.lat) === null || num(v.lon) === null) return out;
      var gs = num(v.velocidadKmh);
      if (gs === null || gs < 150 || v.enTierra) return out;
      var alt = num(v.altitudM);
      if (num(v.dLat) !== null && num(v.dLon) !== null) {
        var dD = Geo.distanciaKm(v.lat, v.lon, v.dLat, v.dLon);
        if (dD < 3 && alt !== null && alt < 300) {
          out.etaMs = redondear(ahoraMs, 1, config); out.etaTipo = 'calc';
        } else {
          var tD = Horarios.tramoMin(dD, gs, alt);
          if (tD <= 18 * 60) {
            out.etaMs = redondear(ahoraMs + tD * MIN, tD <= 30 ? 1 : 5, config); out.etaTipo = 'calc';
          }
        }
      }
      if (num(v.oLat) !== null && num(v.oLon) !== null) {
        var dO = Geo.distanciaKm(v.oLat, v.oLon, v.lat, v.lon);
        if (dO >= 3) {
          var tO = Horarios.tramoMin(dO, gs, alt);
          out.salidaMs = redondear(ahoraMs - tO * MIN, dO <= 60 ? 1 : 5, config); out.salidaTipo = 'calc';
        }
      }
      return out;
    },

    // Nivel (b): elige el vuelo que corresponde dentro de la respuesta de AeroAPI /flights/{ident}.
    parsearAeroapi: function (json, ahoraMs) {
      var lista = json && Array.isArray(json.flights) ? json.flights : null;
      if (!lista || !lista.length) return null;
      var info = [];
      lista.forEach(function (f) {
        if (!f || typeof f !== 'object') return;
        var off = ts(f.actual_off), out = ts(f.actual_out);
        var aterrizo = ts(f.actual_on) !== null || ts(f.actual_in) !== null;
        var actual = off !== null || out !== null ? Math.max(off === null ? -Infinity : off, out === null ? -Infinity : out) : null;
        info.push({
          f: f, aterrizo: aterrizo, enAire: actual !== null && !aterrizo, actual: actual,
          prog: primero(ts(f.scheduled_out), ts(f.scheduled_off)),
          salidaReal: primero(out, off)
        });
      });
      if (!info.length) return null;
      function masCercano(arr) {
        var mejor = null, dm = Infinity;
        arr.forEach(function (x) {
          var d = x.prog === null ? Infinity : Math.abs(x.prog - ahoraMs);
          if (mejor === null || d < dm) { mejor = x; dm = d; }
        });
        return mejor;
      }
      var elegido = null;
      var enAire = info.filter(function (x) { return x.enAire; });
      if (enAire.length) {
        elegido = enAire[0];
        enAire.forEach(function (x) { if (x.actual > elegido.actual) elegido = x; });
      } else {
        var pend = info.filter(function (x) { return !x.aterrizo; });
        elegido = pend.length ? masCercano(pend) : masCercano(info);
      }
      var f = elegido.f;
      var o = f.origin && typeof f.origin === 'object' ? f.origin : {};
      var d = f.destination && typeof f.destination === 'object' ? f.destination : {};
      function iata(x) { return (typeof x.code_iata === 'string' && x.code_iata.trim()) ? x.code_iata.trim().toUpperCase() : null; }
      return {
        fuente: 'aeroapi',
        salidaRealMs: primero(ts(f.actual_out), ts(f.actual_off)),
        salidaProgMs: primero(ts(f.scheduled_out), ts(f.scheduled_off)),
        etaEstMs: primero(ts(f.estimated_in), ts(f.estimated_on)),
        etaProgMs: primero(ts(f.scheduled_in), ts(f.scheduled_on)),
        llegadaRealMs: primero(ts(f.actual_in), ts(f.actual_on)),
        origen: iata(o), destino: iata(d)
      };
    },

    // Mezcla lo calculado con lo de la API: real > est/prog > calc.
    combinar: function (calc, api, v, ahoraMs) {
      calc = calc || {};
      var alt = v ? num(v.altitudM) : null;
      if (api && api.llegadaRealMs !== null && api.llegadaRealMs !== undefined &&
          api.llegadaRealMs < ahoraMs - 30 * MIN && alt !== null && alt > 300) api = null;   // vuelo equivocado
      var r = { salidaMs: null, salidaTipo: null, etaMs: null, etaTipo: null, horarioFuente: null };
      var deApi = false, deCalc = false;
      function dato(x) { return x !== null && x !== undefined; }
      if (api && dato(api.salidaRealMs)) { r.salidaMs = api.salidaRealMs; r.salidaTipo = 'real'; deApi = true; }
      else if (api && dato(api.salidaProgMs)) { r.salidaMs = api.salidaProgMs; r.salidaTipo = 'prog'; deApi = true; }
      else if (dato(calc.salidaMs)) { r.salidaMs = calc.salidaMs; r.salidaTipo = 'calc'; deCalc = true; }
      if (api && dato(api.llegadaRealMs)) { r.etaMs = api.llegadaRealMs; r.etaTipo = 'real'; deApi = true; }
      else if (api && dato(api.etaEstMs)) { r.etaMs = api.etaEstMs; r.etaTipo = 'est'; deApi = true; }
      else if (api && dato(api.etaProgMs)) { r.etaMs = api.etaProgMs; r.etaTipo = 'prog'; deApi = true; }
      else if (dato(calc.etaMs)) { r.etaMs = calc.etaMs; r.etaTipo = 'calc'; deCalc = true; }
      r.horarioFuente = deApi ? 'aeroapi' : (deCalc ? 'calc' : null);
      return r;
    },

    // Completa el vuelo normalizado con los campos de horarios (§3.3). crudo es opcional: trae ruta y horarioApi.
    completar: function (v, config, ahoraMs, crudo) {
      var m = modo(config);
      var nulo = {
        oLat: null, oLon: null, dLat: null, dLon: null, salidaMs: null, salidaTipo: null, salidaProgMs: null,
        etaMs: null, etaTipo: null, etaProgMs: null, horarioFuente: null
      };
      if (m === 'no') { Object.keys(nulo).forEach(function (k) { v[k] = nulo[k]; }); return v; }
      var rt = crudo && crudo.ruta ? crudo.ruta : null;
      var o = Horarios.coords(v.origen), d = Horarios.coords(v.destino);
      v.oLat = rt && num(rt.oLat) !== null ? rt.oLat : (o ? o.lat : num(v.oLat));
      v.oLon = rt && num(rt.oLon) !== null ? rt.oLon : (o ? o.lon : num(v.oLon));
      v.dLat = rt && num(rt.dLat) !== null ? rt.dLat : (d ? d.lat : num(v.dLat));
      v.dLon = rt && num(rt.dLon) !== null ? rt.dLon : (d ? d.lon : num(v.dLon));
      var api = null;
      if (m === 'api') api = crudo ? crudo.horarioApi : v.horarioApi;
      var calc = Horarios.calcular(v, config, ahoraMs);
      var c = Horarios.combinar(calc, api || null, v, ahoraMs);
      v.salidaMs = c.salidaMs; v.salidaTipo = c.salidaTipo;
      v.etaMs = c.etaMs; v.etaTipo = c.etaTipo;
      v.horarioFuente = c.horarioFuente;
      v.salidaProgMs = api && num(api.salidaProgMs) !== null ? api.salidaProgMs : null;
      v.etaProgMs = api && num(api.etaProgMs) !== null ? api.etaProgMs : null;
      return v;
    },

    // Instancia con cola de consultas a AeroAPI (solo por proxy), caché por callsign y día, y cupo diario.
    crear: function (config, red, almacen, alActualizar) {
      config = config || {};
      var cache = {};                // clave 'CS|fecha' -> {v, e, m}
      var cola = [];                 // [{k, cs, clave, local}]
      var enCola = {};
      var enVuelo = 0, ultimoStatus = null, pausaHastaMs = 0;
      var est = { fecha: Horarios.fechaLocal(Date.now(), config), usados: 0, vistos: [], bloqueadoHoy: false };
      var vistosMapa = {};
      var relojBase = Date.now(), relojReal = Date.now();
      var timerCola = null, timerGuardar = null, esperando = [];

      function ahora() { return relojBase + (Date.now() - relojReal); }
      function fijarReloj(ms) {
        if (typeof ms === 'number' && isFinite(ms)) { relojBase = ms; relojReal = Date.now(); }
      }
      function espaciado() { return typeof config.HORARIOS_ESPACIADO_MS === 'number' ? config.HORARIOS_ESPACIADO_MS : 6500; }
      function cupo() { return typeof config.HORARIOS_CUPO_DIARIO === 'number' ? config.HORARIOS_CUPO_DIARIO : 30; }
      function maxPorTick() { return typeof config.ENRIQ_MAX_POR_TICK === 'number' ? config.ENRIQ_MAX_POR_TICK : 8; }
      function proxy() {
        try { return (red && typeof red.proxyBase === 'function') ? red.proxyBase() : ''; } catch (e) { return ''; }
      }
      function motivo() {
        if (modo(config) !== 'api') return 'modo';
        if (!proxy()) return 'sin proxy';
        return null;
      }
      function activo() { return motivo() === null; }

      // ---- caché y persistencia ----
      function entrada(clave) {
        var e = cache[clave];
        if (!e || !(e.e > ahora())) return undefined;
        return e;
      }
      function guardar(clave, valor, ttl, persistir) {
        cache[clave] = { v: valor, e: ahora() + ttl, m: persistir ? 0 : 1 };
        if (persistir) programarGuardado();
      }
      function programarGuardado() {
        if (!almacen || timerGuardar) return;
        timerGuardar = unref(setTimeout(function () { timerGuardar = null; escribir(); }, DEBOUNCE_MS));
      }
      function escribir() {
        if (!almacen) return;
        try {
          var ya = ahora(), ks = Object.keys(cache).filter(function (k) { return !cache[k].m && cache[k].e > ya; });
          ks.sort(function (a, b) { return cache[a].e - cache[b].e; });
          if (ks.length > MAX_ENTRADAS) ks = ks.slice(ks.length - MAX_ENTRADAS);
          var c = {};
          ks.forEach(function (k) { c[k] = { v: cache[k].v, e: cache[k].e }; });
          almacen.escribir(CLAVE, { fecha: est.fecha, usados: est.usados, vistos: est.vistos.slice(-MAX_VISTOS), c: c });
        } catch (err) { /* sin persistencia, seguimos en memoria */ }
      }
      function cargar() {
        if (!almacen) return;
        try {
          var d = almacen.leer(CLAVE);
          if (!d || typeof d !== 'object') return;
          if (typeof d.fecha === 'string') est.fecha = d.fecha;
          if (typeof d.usados === 'number') est.usados = d.usados;
          if (Array.isArray(d.vistos)) d.vistos.forEach(function (cs) { marcarVisto(cs); });
          if (d.c && typeof d.c === 'object') {
            Object.keys(d.c).forEach(function (k) {
              var e = d.c[k];
              if (e && typeof e === 'object' && typeof e.e === 'number') cache[k] = { v: e.v === undefined ? null : e.v, e: e.e, m: 0 };
            });
          }
        } catch (err) { cache = {}; }
      }
      function marcarVisto(cs) {
        if (vistosMapa[cs]) return false;
        vistosMapa[cs] = true; est.vistos.push(cs);
        if (est.vistos.length > MAX_VISTOS) { var x = est.vistos.shift(); delete vistosMapa[x]; }
        return true;
      }
      // Si cambió el día local, arranca de cero el cupo y el conteo de distintos.
      function rolloFecha() {
        var f = Horarios.fechaLocal(ahora(), config);
        if (f === est.fecha) return;
        est.fecha = f; est.usados = 0; est.vistos = []; vistosMapa = {}; est.bloqueadoHoy = false;
        programarGuardado();
      }
      cargar();

      // ---- cola ----
      function avisar() {
        if (typeof alActualizar === 'function') {
          try { alActualizar(); } catch (err) { console.error('[horarios] alActualizar falló', err); }
        }
      }
      function resolverEsperas() {
        if (enVuelo > 0) return;
        if (cola.length > 0 && !(ahora() < pausaHastaMs) && puedePedir()) return;
        var w = esperando; esperando = [];
        w.forEach(function (f) { f(); });
      }
      function puedePedir() { return !est.bloqueadoHoy && est.usados < cupo() && activo(); }
      function vaciarCola() {
        cola.forEach(function (it) { delete enCola[it.k]; });
        cola = [];
      }
      function agendar(ms) {
        if (timerCola) return;
        timerCola = unref(setTimeout(function () { timerCola = null; paso(); }, Math.max(0, ms)));
      }
      function texto(v) {
        function h(ms) { return ms === null || ms === undefined ? '--:--' : hhmm(ms, config); }
        var sal = v.salidaRealMs !== null ? 'SALIÓ ' + h(v.salidaRealMs) : 'PROG ' + h(v.salidaProgMs);
        var lle = v.llegadaRealMs !== null ? 'LLEGÓ ' + h(v.llegadaRealMs)
          : (v.etaEstMs !== null ? 'LLEGA ' + h(v.etaEstMs) : 'PROG ' + h(v.etaProgMs));
        return sal + ' ' + lle;
      }
      function paso() {
        if (enVuelo > 0) return;
        if (!cola.length) { resolverEsperas(); return; }
        rolloFecha();
        if (!puedePedir()) { vaciarCola(); resolverEsperas(); return; }
        var espera = pausaHastaMs - ahora();
        if (espera > 0) { resolverEsperas(); agendar(espera); return; }
        var it = cola.shift();
        it.reencolar = false;
        enVuelo++; est.usados++;
        programarGuardado();
        var ya = ahora();
        var ruta = 'flights/' + it.cs + '?ident_type=designator&start=' + iso(ya - 20 * HORA) + '&end=' + iso(ya + 4 * HORA);
        var p;
        try { p = red.pedirJSON({ url: red.url('aeroapi', ruta) }); } catch (err) { p = Promise.resolve({ ok: false, status: 0, json: null }); }
        Promise.resolve(p).then(function (resp) { return resp || { ok: false, status: 0, json: null }; },
          function () { return { ok: false, status: 0, json: null }; })
        .then(function (resp) {
          try { manejar(it, resp); } catch (err) { console.error('[horarios] error al manejar respuesta', err); }
          enVuelo--;
          if (!it.reencolar) delete enCola[it.k];
          if (cola.length) agendar(it.reencolar ? 0 : espaciado()); else resolverEsperas();
        });
      }
      function manejar(it, resp) {
        var st = resp.status || 0;
        ultimoStatus = st;
        if (st === 429) {
          pausaHastaMs = ahora() + PAUSA_429_MS;
          it.reencolar = true;
          cola.unshift(it);
          return;
        }
        if (st === 401 || st === 403) {
          est.bloqueadoHoy = true;
          console.warn('[horarios] clave inválida');
          vaciarCola();
          return;
        }
        if (st >= 200 && st < 300) {
          var v = Horarios.parsearAeroapi(resp.json, ahora());
          if (v) {
            guardar(it.clave, v, TTL_OK, true);
            console.log('[horarios] ' + it.cs + ' → ' + texto(v));
            avisar();
          } else guardar(it.clave, null, TTL_OK, true);
        } else if (st === 404) {
          guardar(it.clave, null, TTL_OK, true);
        } else {
          guardar(it.clave, null, TTL_ERROR, false);
        }
      }
      function claveDe(cs) { return cs + '|' + est.fecha; }

      var h = {
        aplicar: function (crudos, ahoraMs) {
          fijarReloj(ahoraMs);
          if (!crudos || !activo()) return;
          rolloFecha();
          for (var i = 0; i < crudos.length; i++) {
            var c = crudos[i];
            if (!c) continue;
            var cs = String(c.callsign || '').trim().toUpperCase();
            if (!RE_CALLSIGN.test(cs)) continue;
            var e = entrada(claveDe(cs));
            if (!e || !e.v) continue;
            c.horarioApi = e.v;
            if (!c.origen && e.v.origen) c.origen = e.v.origen;
            if (!c.destino && e.v.destino) c.destino = e.v.destino;
          }
        },
        pedir: function (vuelos, ahoraMs) {
          fijarReloj(ahoraMs);
          if (!vuelos) return;
          rolloFecha();
          var n = Math.min(vuelos.length, maxPorTick());
          var locales = [], otros = [];
          var loc = config.AEROPUERTO_LOCAL || '';
          for (var i = 0; i < n; i++) {
            var v = vuelos[i];
            if (!v) continue;
            var cs = String(v.callsign || '').trim().toUpperCase();
            if (!RE_CALLSIGN.test(cs)) continue;
            if (marcarVisto(cs)) programarGuardado();     // mide cuántos callsigns distintos pasan por día
            if (!activo()) continue;
            var esLocal = !!loc && (v.origen === loc || v.destino === loc);
            if (config.HORARIOS_SOLO_LOCAL && !esLocal) continue;
            (esLocal ? locales : otros).push(cs);
          }
          if (!activo() || est.bloqueadoHoy) return;
          var nuevos = locales.map(function (cs) { return { cs: cs, local: true }; })
            .concat(otros.map(function (cs) { return { cs: cs, local: false }; }));
          var agregados = [];
          nuevos.forEach(function (x) {
            var clave = claveDe(x.cs), k = clave;
            if (enCola[k]) return;
            if (entrada(clave) !== undefined) return;
            enCola[k] = true;
            agregados.push({ k: k, cs: x.cs, clave: clave, local: x.local });
          });
          // Los locales van antes que los no locales que ya estaban esperando.
          agregados.forEach(function (it) {
            if (!it.local) { cola.push(it); return; }
            var pos = 0;
            while (pos < cola.length && cola[pos].local) pos++;
            cola.splice(pos, 0, it);
          });
          if (cola.length) agendar(0);
        },
        drenar: function () {
          return new Promise(function (resolve) {
            if (enVuelo === 0 && (cola.length === 0 || ahora() < pausaHastaMs || !puedePedir())) { resolve(); return; }
            esperando.push(resolve);
            if (cola.length) agendar(0);
          });
        },
        info: function () {
          return {
            activo: activo(), motivo: motivo(), fecha: est.fecha, usados: est.usados, cupo: cupo(),
            cola: cola.length, enVuelo: enVuelo, distintosHoy: est.vistos.length, ultimoStatus: ultimoStatus,
            pausaHastaMs: pausaHastaMs, bloqueadoHoy: est.bloqueadoHoy
          };
        },
        guardarAhora: function () { if (timerGuardar) { clearTimeout(timerGuardar); timerGuardar = null; } escribir(); }
      };
      return h;
    }
  };

  raiz.Horarios = Horarios;
  if (typeof module === 'object' && module.exports) module.exports = Horarios;
})(typeof window !== 'undefined' ? window : globalThis);
