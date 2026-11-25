// Gestor de proveedores: orden con fallback, enfriamientos, cupos diarios e intervalos de consulta. Sin DOM.
(function (raiz) {
  var CLAVE_CUPOS = 'tv.cupos.v1';
  var DIA_MS = 24 * 3600 * 1000;

  function minutosDe(hhmm) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ''));
    return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : 0;
  }

  var Fuentes = {
    enFranja: function (franja, fecha) {
      if (!franja) return false;
      var f = fecha || new Date();
      var m = f.getHours() * 60 + f.getMinutes();
      var d = minutosDe(franja.desde), h = minutosDe(franja.hasta);
      if (d === h) return false;
      return d < h ? (m >= d && m < h) : (m >= d || m < h);
    },

    crear: function (config, proveedores, almacen) {
      proveedores = proveedores || {};
      var est = {};          // estado por proveedor
      var ticksFallidos = 0;
      var actual = null;
      var avisados = false;

      function estadoDe(n) {
        if (!est[n]) est[n] = { fallas: 0, enfriaHastaMs: 0, enfriamientoS: 120, usados: 0, ventanaInicioMs: 0,
          ultimoStatus: null, restante: null };
        return est[n];
      }

      // cupos persistidos
      try {
        var g = almacen ? almacen.leer(CLAVE_CUPOS) : null;
        if (g && typeof g === 'object') {
          Object.keys(g).forEach(function (n) {
            var s = estadoDe(n);
            s.usados = +g[n].usados || 0;
            s.ventanaInicioMs = +g[n].ventanaInicioMs || 0;
          });
        }
      } catch (e) {}

      function persistir() {
        if (!almacen) return;
        var o = {};
        Object.keys(est).forEach(function (n) { o[n] = { usados: est[n].usados, ventanaInicioMs: est[n].ventanaInicioMs }; });
        try { almacen.escribir(CLAVE_CUPOS, o); } catch (e) {}
      }

      function lista() {
        var l = config.PROVEEDOR === 'auto' ? (config.PROVEEDORES || []) : [config.PROVEEDOR];
        var ok = [], malos = [];
        l.forEach(function (n) { if (proveedores[n]) ok.push(n); else malos.push(n); });
        if (malos.length && !avisados) {
          avisados = true;
          try { console.warn('[fuentes] proveedores inexistentes ignorados: ' + malos.join(', ')); } catch (e) {}
        }
        return ok;
      }

      function cupoDe(n) {
        var l = config.LIMITES && config.LIMITES[n];
        return l && l.CUPO_DIARIO ? l.CUPO_DIARIO : 0;
      }

      function renovarVentana(n, ahora) {
        var s = estadoDe(n);
        if (s.ventanaInicioMs && ahora - s.ventanaInicioMs >= DIA_MS) { s.usados = 0; s.ventanaInicioMs = 0; }
      }

      function cupoAgotado(n, ahora) {
        renovarVentana(n, ahora);
        var c = cupoDe(n);
        return c > 0 && estadoDe(n).usados >= Math.floor(c * 0.95);
      }

      function disponible(n, ahora) {
        if (!proveedores[n]) return false;
        if (ahora < estadoDe(n).enfriaHastaMs) return false;
        return !cupoAgotado(n, ahora);
      }

      function consultar(n, ahoraMs) {
        var s = estadoDe(n);
        renovarVentana(n, ahoraMs);
        if (!s.ventanaInicioMs) s.ventanaInicioMs = ahoraMs;
        s.usados++;
        persistir();
        var t0 = Date.now();
        return new Promise(function (resolve) {
          var listo = false, timer = null;
          function fin(r) {
            if (listo) return;
            listo = true; if (timer) clearTimeout(timer);
            r.ms = Date.now() - t0;
            resolve(r);
          }
          timer = setTimeout(function () {
            fin({ ok: false, error: { tipo: 'timeout', status: 0, retryAfterS: null } });
          }, ((config.TIMEOUT_RED_S || 8) + 2) * 1000);
          try {
            proveedores[n].obtenerEstados(ahoraMs).then(function (arr) {
              fin({ ok: true, estados: arr || [] });
            }, function (e) {
              fin({ ok: false, error: (e && typeof e === 'object' && e.tipo) ? e : { tipo: 'red', status: 0, retryAfterS: null } });
            });
          } catch (e2) { fin({ ok: false, error: { tipo: 'red', status: 0, retryAfterS: null } }); }
        });
      }

      var f = {
        obtener: function (ahoraMs) {
          var cand = lista().filter(function (n) { return disponible(n, ahoraMs); });
          var intentos = [];
          if (!cand.length) {
            ticksFallidos++;
            return Promise.resolve({ ok: false, estados: [], proveedor: null, intentos: intentos });
          }
          function probar(i) {
            var n = cand[i];
            var s = estadoDe(n);
            return consultar(n, ahoraMs).then(function (r) {
              var info = proveedores[n].info || {};
              s.ultimoStatus = r.ok ? (info.status || 200) : (r.error.status || 0);
              if (info.restante !== undefined && info.restante !== null) s.restante = info.restante;
              if (r.ok) {
                s.fallas = 0; s.enfriamientoS = 120; ticksFallidos = 0; actual = n;
                intentos.push({ prov: n, ok: true, status: s.ultimoStatus, error: null, ms: r.ms });
                return { ok: true, estados: r.estados, proveedor: n, intentos: intentos };
              }
              var e = r.error;
              intentos.push({ prov: n, ok: false, status: e.status || 0, error: e.tipo, ms: r.ms });
              if (e.tipo === '429') {
                s.enfriaHastaMs = ahoraMs + (e.retryAfterS || 600) * 1000;
              } else {
                s.fallas++;
                if (s.fallas >= 2) {
                  s.enfriaHastaMs = ahoraMs + s.enfriamientoS * 1000;
                  s.enfriamientoS = Math.min(s.enfriamientoS * 2, 3600);
                  s.fallas = 0;
                }
              }
              // Probar todos los disponibles en orden: si los primeros están bloqueados (p. ej. CORS en el celu),
              // los de más abajo tienen que llegar a probarse en el mismo tick.
              var hayOtro = i + 1 < cand.length;
              try { console.warn('[fuentes] ' + n + ' falló (' + e.tipo + ' ' + (e.status || 0) + ') → ' + (hayOtro ? cand[i + 1] : 'nadie')); } catch (e3) {}
              if (hayOtro) return probar(i + 1);
              ticksFallidos++;
              return { ok: false, estados: [], proveedor: null, intentos: intentos };
            });
          }
          return probar(0);
        },

        intervaloS: function (estadoApp, fecha) {
          var f2 = fecha || new Date();
          var ahora = f2.getTime();
          var reposo = estadoApp === 'REPOSO';
          var base = reposo ? config.INTERVALO_REPOSO_S : config.INTERVALO_ACTIVO_S;
          if (reposo && config.FRANJA_LENTA && Fuentes.enFranja(config.FRANJA_LENTA, f2)) {
            base = Math.max(base, config.FRANJA_LENTA.INTERVALO_S);
          }
          var primero = null, l = lista(), i;
          for (i = 0; i < l.length; i++) { if (disponible(l[i], ahora)) { primero = l[i]; break; } }
          if (primero === null) {
            var min = Infinity;
            l.forEach(function (n) { var h = estadoDe(n).enfriaHastaMs; if (h > ahora && h < min) min = h; });
            var seg = min === Infinity ? 600 : (min - ahora) / 1000;
            return Math.min(600, Math.max(30, seg));
          }
          var lim = config.LIMITES && config.LIMITES[primero];
          if (lim) base = Math.max(base, reposo ? lim.REPOSO_S : lim.ACTIVO_S);
          if (ticksFallidos > 0) base = Math.min(base * Math.pow(2, ticksFallidos), 300);
          return base;
        },

        info: function () {
          var por = {};
          lista().forEach(function (n) {
            var s = estadoDe(n);
            por[n] = { fallas: s.fallas, enfriaHastaMs: s.enfriaHastaMs, usados: s.usados, cupo: cupoDe(n),
              ultimoStatus: s.ultimoStatus, restante: s.restante };
          });
          return { actual: actual, porProv: por, ticksFallidos: ticksFallidos };
        }
      };
      return f;
    }
  };

  raiz.Fuentes = Fuentes;
  if (typeof module === 'object' && module.exports) module.exports = Fuentes;
})(typeof window !== 'undefined' ? window : globalThis);
