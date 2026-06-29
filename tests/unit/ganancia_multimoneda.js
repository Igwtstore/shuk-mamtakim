// Blindaje: cálculo de ganancia Pitzujim/golosinas de Jony (multi-moneda) — funciones REALES
// de motor-v2.js. Cubre: Pitzujim $, golosina U$S, golosina minorista $ con costo U$S (×TC),
// desambiguación de los 9 "Pitzujim" por descripción, renombrado, sin costo, sin TC, producto de Miri.
const { extraerFns, suite } = require('./_helpers');

module.exports.run = () => {
  const { _gananciaPitzVenta_ } = extraerFns('../../motor-v2.js', ['_parseLineaVenta_', '_matchProdLinea_', '_gananciaPitzVenta_']);
  const s = suite();
  const P = (id, nombre, desc, costo, mon) => ({ id, nombre: nombre.toLowerCase(), desc: desc.toLowerCase(), costo, moneda: mon || '$' });

  // 9 "Pitzujim" comparten nombre → se distinguen por descripción
  const mapa = {
    'pitzujim': [
      P(43, 'Pitzujim', 'Manies Sabor Grill (100g) (Mezonot!!)', 5000),
      P(47, 'Pitzujim', 'Nueces Pecan Lotus (100g)', 4000),
      P(48, 'Pitzujim', 'Nueces Pecan Caramelizadas (100g)', 6000),
      P(49, 'Pitzujim', 'Nueces Pecan Oreo (100g)', 7000),
    ],
    'bon o bon': [P(80, 'Bon O Bon', 'alfajor', 3, 'U$S')],
    'sin costo': [P(90, 'Sin Costo', '', 0)],
  };

  let r = _gananciaPitzVenta_('• 2x Pitzujim · Manies Sabor Grill (100g) (Mezonot!!) — $ 9.000 c/u = $ 18.000', mapa, 1500);
  s.ok('Pitzujim minorista $ (Manies, costo 5000): (9000-5000)*2 = 8000', r.ars === 8000 && r.usd === 0);

  r = _gananciaPitzVenta_('• 1x Pitzujim · Nueces Pecan Caramelizadas (100g) — $ 11.000 c/u = $ 11.000', mapa, 0);
  s.ok('Desambigua por descripción (Caramelizadas, costo 6000): 5000', r.ars === 5000);

  r = _gananciaPitzVenta_('• 1x Bon O Bon · alfajor — U$S 5.00 c/u = U$S 5.00', mapa, 1500);
  s.ok('Golosina mayorista U$S: (5-3)*1 = 2 USD', r.usd === 2 && r.ars === 0);

  r = _gananciaPitzVenta_('• 1x Bon O Bon · alfajor — $ 6.000 c/u = $ 6.000', mapa, 1500);
  s.ok('Golosina minorista $ con costo U$S (×TC): 6000 - 3*1500 = 1500', r.ars === 1500);

  r = _gananciaPitzVenta_(
    '• 2x Pitzujim · Manies Sabor Grill (100g) (Mezonot!!) — $ 9.000 c/u = $ 18.000 || ' +
    '• 1x Bon O Bon · alfajor — U$S 5.00 c/u = U$S 5.00 || ' +
    '• 1x Pitzujim · Nueces Pecan Oreo (100g) — $ 9.000 c/u = $ 9.000', mapa, 1500);
  s.ok('Mezcla: ARS = 8000 (Manies) + 2000 (Oreo) = 10000', r.ars === 10000);
  s.ok('Mezcla: USD = 2 (Bon O Bon)', r.usd === 2);

  r = _gananciaPitzVenta_('• 1x Pitzujim · Nueces Pecan Oreo (100g) [-10%] — $ 8.100 c/u = $ 8.100', mapa, 0);
  s.ok('Tag de descuento [-10%] no rompe el match (Oreo costo 7000): 1100', r.ars === 1100);

  r = _gananciaPitzVenta_('• 3x Sin Costo — $ 1.000 c/u = $ 3.000', mapa, 1500);
  s.ok('Sin costo cargado: no suma y lo reporta', r.ars === 0 && r.faltaCosto.indexOf('Sin Costo') !== -1);

  r = _gananciaPitzVenta_('• 1x Bon O Bon · alfajor — $ 6.000 c/u = $ 6.000', mapa, 0);
  s.ok('Sin TC cuando hace falta convertir: no suma, marca faltaTC', r.ars === 0 && r.faltaTC === true);

  r = _gananciaPitzVenta_('• 2x Alfajor Miri — $ 8.000 c/u = $ 16.000', mapa, 1500);
  s.ok('Producto que NO es de Jony: no cuenta', r.ars === 0 && r.usd === 0);

  // Renombrado: el sabor pasó al NOMBRE y se borró la descripción → la venta vieja sigue matcheando
  const mapaRenom = { 'pitzujim': [
    P(43, 'Pitzujim - Manies Sabor Grill', '', 5000),
    P(47, 'Pitzujim - Nueces Pecan Lotus', '', 4000),
  ]};
  r = _gananciaPitzVenta_('• 2x Pitzujim · Manies Sabor Grill (100g) (Mezonot!!) — $ 9.000 c/u = $ 18.000', mapaRenom, 0);
  s.ok('Tras renombrar + borrar desc: venta vieja Manies → 8000', r.ars === 8000);

  return s.result();
};
