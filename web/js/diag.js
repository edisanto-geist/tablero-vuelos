// Diagnóstico de red: prueba cada proveedor y adsbdb desde ESTE navegador y recomienda qué usar.
(function (raiz) {
  var CONFIG = raiz.CONFIG, Red = raiz.Red, Geo = raiz.Geo;
  var Q = {};
  (location.search || '').replace(/^\?/, '').split('&').forEach(function (p) {
    if (!p) return;
    var kv = p.split('=');
    Q[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1] || '');
  });
  CONFIG.RADIO_KM = Math.min(460, parseFloat(Q.radio) > 0 ? parseFloat(Q.radio) : 200);
  if (Q.proxy === '1') CONFIG.PROXY = 'http://127.0.0.1:8080/api/';
  else if (Q.proxy === '0') CONFIG.PROXY = '';

  var ORDEN = ['airplaneslive', 'adsbfi', 'adsblol', 'opensky'];
  var corriendo = false;

  function el(id) { return document.getElementById(id); }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }
  function esperar(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function cabecera() {
    var pb = Red.proxyBase();
    var persiste = Red.almacen.persiste ? Red.almacen.persiste() : false;
    el('cab').textContent =
      'Página: ' + (location.protocol === 'file:' ? 'file://' : location.protocol + '//' + location.host) + '\n' +
      'Red: ' + (pb ? 'PROXY ' + pb : 'DIRECTO') + '   onLine=' + navigator.onLine + '   radio=' + CONFIG.RADIO_KM + ' km\n' +
      'Almacén local (caché entre reinicios): ' + (persiste ? 'SÍ persiste' : 'NO persiste (solo memoria)') + '\n' +
      'Hora: ' + new Date().toLocaleString() + '\n' +
      'UA: ' + String(navigator.userAgent).slice(0, 110);
  }

  function ejemplos(crudos) {
    var l = [];
    crudos.forEach(function (c) {
      if (c.lat === null || c.lon === null) return;
      l.push({ c: c, km: Geo.distanciaKm(CONFIG.LAT, CONFIG.LON, c.lat, c.lon) });
    });
    l.sort(function (a, b) { return a.km - b.km; });
    return l.slice(0, 3).map(function (x) {
      return (x.c.callsign || x.c.matricula || x.c.icao24) + '/' + (x.c.tipo || '----') + '/' + Math.round(x.km);
    }).join('  ');
  }

  function cerca30(crudos) {
    var n = 0;
    crudos.forEach(function (c) {
      if (c.lat !== null && c.lon !== null && Geo.distanciaKm(CONFIG.LAT, CONFIG.LON, c.lat, c.lon) <= 30) n++;
    });
    return n;
  }

  function probarProveedor(nombre, fila) {
    var prov = raiz.Proveedores[nombre];
    var t0 = Date.now();
    return prov.obtenerEstados(Date.now()).then(function (est) {
      return { ok: true, est: est, info: prov.info };
    }, function (e) {
      return { ok: false, err: e || {}, info: prov.info, est: [] };
    }).then(function (r) {
      var info = r.info || {};
      var ms = info.ms !== undefined ? info.ms : Date.now() - t0;
      var txt, cls;
      if (r.ok) { txt = 'OK'; cls = 'ok'; }
      else if (r.err.tipo === 'timeout') { txt = 'TIMEOUT'; cls = 'mal'; }
      else if (r.err.status === 0 || r.err.tipo === 'red') {
        txt = ms < 1500 ? 'BLOQUEADO (CORS o sin red)' : 'SIN RESPUESTA (red)'; cls = 'mal';
      }
      else if (r.err.tipo === 'json') { txt = 'RESPUESTA ILEGIBLE'; cls = 'mal'; }
      else { txt = 'HTTP ' + r.err.status; cls = 'mal'; }
      fila.innerHTML = '<td>' + nombre + '<div class="url">' + esc(info.url || '') + '</div></td>' +
        '<td class="' + cls + '">' + txt + '</td><td>' + Math.round(ms) + ' ms</td>' +
        '<td>' + (r.ok ? r.est.length : '-') + '</td><td>' + (r.ok ? cerca30(r.est) : '-') + '</td>' +
        '<td>' + esc(r.ok ? ejemplos(r.est) : '') + '</td><td>' + (info.restante !== null && info.restante !== undefined ? info.restante : '') + '</td>';
      return { nombre: nombre, ok: r.ok, est: r.est, ms: ms, bloqueado: !r.ok && (r.err.status === 0 || r.err.tipo === 'red') };
    });
  }

  function probarAdsbdb(resultados) {
    var cs = 'ARG1541', hex = 'e06541', lat = CONFIG.LAT, lon = CONFIG.LON;
    resultados.forEach(function (r) {
      r.est.forEach(function (c) {
        if (cs === 'ARG1541' && c.callsign && /^[A-Z]{3}[0-9]/.test(c.callsign)) { cs = c.callsign; if (c.lat !== null) { lat = c.lat; lon = c.lon; } }
        if (hex === 'e06541' && !c.tipo && /^[0-9a-f]{6}$/.test(c.icao24)) hex = c.icao24;
      });
    });
    var out = el('adsbdb');
    out.textContent = 'Consultando ' + cs + ' y ' + hex + '...';
    var E = raiz.Enriquecer;
    return Red.pedirJSON({ url: Red.url('adsbdb', 'callsign/' + cs) }).then(function (r1) {
      var linea = 'callsign ' + cs + ': status=' + r1.status + ' ' + Math.round(r1.ms) + 'ms';
      var ok1 = r1.status === 200 || r1.status === 404;
      if (E && r1.json) {
        var ruta = E.parsearRuta(r1.json);
        linea += ruta ? ' ruta=' + (ruta.origen || '---') + '>' + (ruta.destino || '---') + ' plausible=' + E.plausible(ruta, lat, lon) : ' (sin ruta)';
      }
      return Red.pedirJSON({ url: Red.url('adsbdb', 'aircraft/' + hex) }).then(function (r2) {
        var linea2 = 'hex ' + hex + ': status=' + r2.status + ' ' + Math.round(r2.ms) + 'ms';
        if (E && r2.json) linea2 += ' icao_type=' + (E.parsearAeronave(r2.json) || '----');
        out.innerHTML = '<span class="' + (ok1 ? 'ok' : 'mal') + '">' + esc(linea) + '</span>\n<span class="' +
          ((r2.status === 200 || r2.status === 404) ? 'ok' : 'mal') + '">' + esc(linea2) + '</span>';
      });
    });
  }

  // Ajustes guardados en este celu (config.html) y estado de los horarios (AeroAPI por proxy).
  function lineaAjustes() {
    var out = el('ajustes');
    var A = raiz.Ajustes;
    if (!A || !A.info) { out.textContent = 'Ajustes del celu: módulo no disponible'; return; }
    var i = A.info(), g = i.guardados;
    var n = typeof g === 'number' ? g : (g && typeof g === 'object' ? Object.keys(g).length : 0);
    var rech = i.rechazados;
    var nr = typeof rech === 'number' ? rech : (rech && typeof rech === 'object' ? Object.keys(rech).length : 0);
    out.textContent = 'Ajustes del celu: ' + n + (n === 1 ? ' cambio' : ' cambios') + (nr ? ' (' + nr + ' rechazados)' : '');
  }
  function lineaHorarios() {
    var out = el('horarios');
    var H = raiz.Horarios;
    if (!H) { out.textContent = 'Horarios: módulo no disponible'; return; }
    var h = H.crear(CONFIG, Red, Red.almacen);
    var i = h.info();
    out.textContent = 'Horarios: modo=' + (CONFIG.HORARIOS_MODO || 'calc') + ' ' + (i.activo ? 'ACTIVO' : 'inactivo (' + i.motivo + ')') +
      '  usados=' + i.usados + '/' + i.cupo + '  distintosHoy=' + i.distintosHoy + '  bloqueadoHoy=' + (i.bloqueadoHoy ? 'SÍ' : 'no') +
      '  clave=' + (CONFIG.HORARIOS_KEY ? 'cargada' : 'vacía');
  }
  function probarHorarios() {
    var out = el('horarios-prueba'), H = raiz.Horarios;
    if (!H) { out.textContent = 'Sin módulo de horarios.'; return; }
    if (!Red.proxyBase()) { out.textContent = 'Sin proxy no se puede: AeroAPI solo va por el proxy (Termux o Worker).'; return; }
    var cs = Q.cs ? String(Q.cs).toUpperCase() : 'ARG1541', ya = Date.now();
    function iso(ms) { return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z'); }
    var ruta = 'flights/' + cs + '?ident_type=designator&start=' + iso(ya - 20 * 3600000) + '&end=' + iso(ya + 4 * 3600000);
    out.textContent = 'Consultando ' + cs + '...';
    Red.pedirJSON({ url: Red.url('aeroapi', ruta) }).then(function (r) {
      var api = r.json ? H.parsearAeroapi(r.json, ya) : null;
      var linea = 'status=' + r.status + ' ' + Math.round(r.ms) + 'ms' + (r.error ? ' error=' + r.error : '');
      if (api) {
        function hh(ms) { return ms === null ? '--:--' : H.fechaLocal(ms, CONFIG) + ' ' + new Date(ms + (CONFIG.ZONA_UTC_MIN === undefined ? -180 : CONFIG.ZONA_UTC_MIN) * 60000).toISOString().slice(11, 16); }
        linea += '\n' + (api.origen || '---') + '>' + (api.destino || '---') + ' salida real=' + hh(api.salidaRealMs) + ' prog=' + hh(api.salidaProgMs) +
          '\nllegada est=' + hh(api.etaEstMs) + ' prog=' + hh(api.etaProgMs) + ' real=' + hh(api.llegadaRealMs);
      } else if (r.status === 401 || r.status === 403) linea += '\nClave inválida o ausente.';
      else if (r.ok) linea += '\nSin vuelos para ese callsign.';
      out.innerHTML = '<span class="' + (r.ok ? 'ok' : 'mal') + '">' + esc(linea) + '</span>';
    });
  }

  function recomendar(res) {
    var r = el('reco');
    var mejor = null;
    res.forEach(function (x) { if (!mejor && x.ok && x.est.length > 0) mejor = x; });
    var todosBloq = res.every(function (x) { return x.bloqueado; });
    var txt;
    if (mejor) {
      txt = '<span class="ok">Dejá PROVEEDORES con ' + mejor.nombre + ' primero.</span>';
      var otros = res.filter(function (x) { return x.ok && x !== mejor; }).map(function (x) { return x.nombre; });
      if (otros.length) txt += '<br>También andan: ' + otros.join(', ') + '.';
    } else if (todosBloq && location.protocol === 'file:') {
      txt = '<span class="mal">Todo BLOQUEADO desde file://. Usá el proxy de Termux (termux/proxy.py) y abrí http://127.0.0.1:8080/</span>';
    } else if (res.some(function (x) { return x.ok; })) {
      txt = '<span class="med">Hay proveedores que responden pero ninguno devolvió aviones en ' + CONFIG.RADIO_KM + ' km. Probá de nuevo o con ?radio=400.</span>';
    } else {
      txt = '<span class="mal">Ningún proveedor respondió. ' + (Red.proxyBase()
        ? 'Revisá que el proxy (' + Red.proxyBase() + ') esté funcionando.'
        : (todosBloq ? 'Si adsbdb (abajo) respondió, internet anda (adsbdb respondió): y los proveedores bloquean al navegador por CORS: hace falta un proxy. Si no, revisá el WiFi.' : 'Revisá el WiFi.')) + '</span>';
    }
    r.innerHTML = txt;
  }

  function correr() {
    if (corriendo) return;
    corriendo = true;
    el('otra').disabled = true;
    cabecera();
    lineaAjustes();
    lineaHorarios();
    el('reco').textContent = 'Probando...';
    el('adsbdb').textContent = '-';
    var tabla = el('tabla');
    tabla.innerHTML = '<tr><th>PROVEEDOR</th><th>RESULTADO</th><th>MS</th><th>CRUDOS</th><th>&le;30 KM</th><th>EJEMPLOS</th><th>CRÉD.</th></tr>';
    var res = [];
    var p = Promise.resolve();
    ORDEN.forEach(function (n, i) {
      p = p.then(function () { return i ? esperar(1000) : null; }).then(function () {
        var fila = document.createElement('tr');
        fila.innerHTML = '<td>' + n + '</td><td colspan="6">consultando...</td>';
        tabla.appendChild(fila);
        return probarProveedor(n, fila).then(function (x) { res.push(x); });
      });
    });
    p.then(function () { return probarAdsbdb(res); }).then(function () {
      recomendar(res);
    }, function (e) {
      el('reco').textContent = 'Error del diagnóstico: ' + e;
    }).then(function () {
      corriendo = false; el('otra').disabled = false;
      document.body.setAttribute('data-listo', '1');
    });
  }

  el('otra').addEventListener('click', correr);
  el('probar-horarios').addEventListener('click', probarHorarios);
  correr();
})(window);
