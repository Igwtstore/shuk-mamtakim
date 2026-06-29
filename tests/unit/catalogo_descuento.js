// Blindaje: descuento del catálogo (_acConDesc) — función REAL de index.html. Regla del usuario:
// redondeo SIEMPRE para arriba (en pesos = entero; en U$S = 2 decimales). Afecta el precio impreso.
const { extraerFns, suite } = require('./_helpers');

module.exports.run = () => {
  const { _acConDesc } = extraerFns('../../index.html', ['_acConDesc']);
  const s = suite();

  s.ok('Sin descuento (0%) → mismo precio', _acConDesc(1000, 0, false) === 1000);
  s.ok('$1.000 -10% = 900', _acConDesc(1000, 10, false) === 900);
  s.ok('$1.000 -15% = 850', _acConDesc(1000, 15, false) === 850);
  s.ok('Redondeo SIEMPRE arriba: $999 -10% = ceil(899,1) = 900', _acConDesc(999, 10, false) === 900);
  s.ok('$1.000 -33% = ceil(670) = 670', _acConDesc(1000, 33, false) === 670);
  s.ok('-100% = 0', _acConDesc(1000, 100, false) === 0);
  // U$S: 2 decimales, también para arriba
  s.near('U$S 17 -10% = 15,30 (ceil 2 dec)', _acConDesc(17, 10, true), 15.30);
  s.near('U$S 4,50 -10% = 4,05', _acConDesc(4.50, 10, true), 4.05);

  return s.result();
};
