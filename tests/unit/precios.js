// Blindaje: precio + moneda según el tipo de venta (_precioMoneda) — función REAL de index.html.
// Es la base del repreciado al editar una venta (el bug de hoy: mayorista↔minorista) y del armado
// de pedidos. Regla: minorista SIEMPRE pesos; mayorista en la moneda del producto.
const { extraerFns, suite } = require('./_helpers');

module.exports.run = () => {
  const { _precioMoneda } = extraerFns('../../index.html', ['_precioMoneda']);
  const s = suite();

  const pitz = { dueno: 'Jony', moneda: '$', precioMay: '6500', precioMin: 9000 };
  const golo = { dueno: 'Jony', moneda: 'U$S', precioMay: '5', precioMin: 9000 };

  let r = _precioMoneda(pitz, 'Mayorista');
  s.ok('Pitzujim ($) mayorista → 6500 en $', r.precioUnit === 6500 && r.moneda === '$');

  r = _precioMoneda(golo, 'Mayorista');
  s.ok('Golosina (U$S) mayorista → 5 en U$S', r.precioUnit === 5 && r.moneda === 'U$S');

  r = _precioMoneda(pitz, 'Minorista');
  s.ok('Minorista siempre $ → 9000 en $', r.precioUnit === 9000 && r.moneda === '$');

  r = _precioMoneda(golo, 'Minorista');
  s.ok('Golosina minorista también en $ (no U$S) → 9000 en $', r.precioUnit === 9000 && r.moneda === '$');

  // Precio mayorista con coma decimal (formato U$S) se parsea bien
  r = _precioMoneda({ dueno: 'Jony', moneda: 'U$S', precioMay: '4,50', precioMin: 0 }, 'Mayorista');
  s.near('Mayorista U$S con coma "4,50" → 4.5', r.precioUnit, 4.5);

  return s.result();
};
