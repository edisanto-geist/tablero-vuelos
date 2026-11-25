// Funciones geográficas puras.
(function (raiz) {
  var R = 6371.0088;
  var RAD = Math.PI / 180;
  var CARDINALES = ['NORTE', 'NORESTE', 'ESTE', 'SURESTE', 'SUR', 'SUROESTE', 'OESTE', 'NOROESTE'];

  function norm360(d) { return ((d % 360) + 360) % 360; }

  var Geo = {
    distanciaKm: function (lat1, lon1, lat2, lon2) {
      var dLat = (lat2 - lat1) * RAD, dLon = (lon2 - lon1) * RAD;
      var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
      return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
    },
    rumboDeg: function (lat1, lon1, lat2, lon2) {
      var f1 = lat1 * RAD, f2 = lat2 * RAD, dl = (lon2 - lon1) * RAD;
      var y = Math.sin(dl) * Math.cos(f2);
      var x = Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dl);
      return norm360(Math.atan2(y, x) / RAD);
    },
    destino: function (lat, lon, rumboDeg, distKm) {
      var d = distKm / R, b = rumboDeg * RAD, f1 = lat * RAD, l1 = lon * RAD;
      var f2 = Math.asin(Math.sin(f1) * Math.cos(d) + Math.cos(f1) * Math.sin(d) * Math.cos(b));
      var l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(f1),
        Math.cos(d) - Math.sin(f1) * Math.sin(f2));
      return { lat: f2 / RAD, lon: ((l2 / RAD + 540) % 360) - 180 };
    },
    cardinal: function (deg) {
      var i = Math.floor((norm360(deg) + 22.5) / 45) % 8;
      return CARDINALES[i];
    },
    aproximacion: function (obsLat, obsLon, lat, lon, rumboDeg, velKmh) {
      var x = (lon - obsLon) * RAD * R * Math.cos(obsLat * RAD);
      var y = (lat - obsLat) * RAD * R;
      var dist = Math.sqrt(x * x + y * y);
      if (velKmh === null || velKmh === undefined || velKmh < 30 ||
          rumboDeg === null || rumboDeg === undefined) {
        return { minutos: null, distMinKm: dist, seAcerca: false };
      }
      var th = rumboDeg * RAD, vm = velKmh / 60;
      var vx = Math.sin(th) * vm, vy = Math.cos(th) * vm;
      var t = -(x * vx + y * vy) / (vx * vx + vy * vy);
      var se = t > 0.05;
      var tt = Math.max(t, 0);
      var dx = x + vx * tt, dy = y + vy * tt;
      return { minutos: se ? t : 0, distMinKm: Math.sqrt(dx * dx + dy * dy), seAcerca: se };
    },
    boundingBox: function (lat, lon, radioKm) {
      var dLat = radioKm / R / RAD;
      var dLon = radioKm / (R * Math.cos(lat * RAD)) / RAD;
      return { lamin: lat - dLat, lamax: lat + dLat, lomin: lon - dLon, lomax: lon + dLon };
    }
  };
  raiz.Geo = Geo;
  if (typeof module === 'object' && module.exports) module.exports = Geo;
})(typeof window !== 'undefined' ? window : globalThis);
