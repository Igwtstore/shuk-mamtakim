// ↩️ LEVANTAR UN PEDIDO CANCELADO (07/09/2026)
// Cancelar devuelve la mercadería al depósito; levantar tiene que volver a sacarla, pero solo lo
// que HAY de verdad hoy: lo que no alcanza se ajusta y lo que no queda nada se cae del pedido.
// Estos checks blindan las dos cuentas puras que deciden eso, con las funciones REALES de
// index.html: _planLevantarPedido (qué queda) y _armarPedidoDesdeLineas (texto, totales y el
// reparto 2×2 con la comisión — la misma cuenta que usa el editor de pedidos).
const { extraerFns, suite } = require('./_helpers');
const F = extraerFns('../../index.html', ['_planLevantarPedido', '_armarPedidoDesdeLineas', '_precioMoneda', 'parsearLineasPedido', '_separarNotasPedido']);
const { _planLevantarPedido, _armarPedidoDesdeLineas, parsearLineasPedido, _separarNotasPedido } = F;

// Catálogo de prueba: 1 de Miri en $ (paga comisión), 1 de Jony en $ y 1 de Jony en U$S.
const CAT = [
  { id: 10, nombre: 'Chocolate Elite', desc: 'Caramelos (90g)', dueno: 'Miri', moneda: '$', precioMay: '11999', precioMin: 13500, stock: 12 },
  { id: 20, nombre: 'Marshmelow', desc: 'Confitado', dueno: 'Miri', moneda: '$', precioMay: '5000', precioMin: 6000, stock: 1 },
  { id: 30, nombre: 'Pitzujim', desc: 'Surtido', dueno: 'Jony', moneda: 'U$S', precioMay: '10', precioMin: 12, stock: 0 }
];
const stockDe = extra => {
  const m = {}; CAT.forEach(p => m[String(p.id)] = p.stock);
  Object.keys(extra || {}).forEach(k => m[k] = extra[k]);
  return m;
};
const L = (prodId, nombre, descripcion, qty, moneda, precio, desc) => ({ prodId, nombre, descripcion, qty, moneda, precio, desc: desc || 0 });

function run() {
  const t = suite();

  // ── Qué queda del pedido ──────────────────────────────────────────────
  const pedido = [
    L(10, 'Chocolate Elite', 'Caramelos (90g)', 3, '$', 11999),   // hay 12 → entra entero
    L(20, 'Marshmelow', 'Confitado', 5, '$', 5000),               // hay 1  → se ajusta a 1
    L(30, 'Pitzujim', 'Surtido', 2, 'U$S', 10),                   // hay 0  → se cae
    L(null, 'Producto Borrado', '', 4, '$', 800)                  // no está en el catálogo → se cae
  ];
  const plan = _planLevantarPedido(pedido, stockDe());
  t.eq('Hay stock de sobra: queda tal cual', [plan[0].qty, plan[0].motivo], [3, 'ok']);
  t.eq('Hay menos: se ajusta a lo que hay', [plan[1].qty, plan[1].motivo], [1, 'ajustada']);
  t.eq('No hay nada: sale del pedido', [plan[2].qty, plan[2].motivo], [0, 'sin-stock']);
  t.eq('Ya no está en el catálogo: sale del pedido', [plan[3].qty, plan[3].motivo], [0, 'sin-catalogo']);
  t.eq('Se recuerda cuánto pedía cada renglón', plan.map(l => l.pedida), [3, 5, 2, 4]);
  t.ok('El tope editable nunca supera lo que se pedía', plan.every(l => l.max <= l.pedida && l.max <= l.hay));

  // Dos renglones del MISMO producto: el primero se lleva lo que hay (no se cuenta dos veces).
  const dobles = _planLevantarPedido([L(10, 'Chocolate Elite', '', 8, '$', 11999), L(10, 'Chocolate Elite', '', 8, '$', 11999)], stockDe({ 10: 10 }));
  t.eq('Mismo producto en 2 renglones: el 1º se lleva 8', dobles[0].qty, 8);
  t.eq('Mismo producto en 2 renglones: al 2º le quedan 2', dobles[1].qty, 2);
  t.ok('Mismo producto: nunca se descuenta más de lo que hay', dobles[0].qty + dobles[1].qty === 10);

  t.eq('Stock en 0 de todo: no queda nada para levantar', _planLevantarPedido(pedido, stockDe({ 10: 0, 20: 0 })).filter(l => l.qty > 0).length, 0);
  t.eq('Stock intacto: el pedido entra completo', _planLevantarPedido([pedido[0], pedido[1]], stockDe({ 10: 99, 20: 99 })).map(l => l.qty), [3, 5]);

  // ── La cuenta del pedido recortado ────────────────────────────────────
  const quedan = plan.filter(l => l.qty > 0);
  const arm = _armarPedidoDesdeLineas(quedan, [], 0, 'Mayorista', CAT);
  t.eq('Solo se guardan los renglones que quedaron', arm.productos.split(' || ').length, 2);
  t.ok('El renglón sin stock no queda en el texto', !/Pitzujim/.test(arm.productos) && !/Producto Borrado/.test(arm.productos));
  t.eq('Total ARS = 3×11.999 + 1×5.000', Math.round(arm.totalARS), 3 * 11999 + 5000);
  t.eq('Total USD = 0 (los dólares eran del renglón que se cayó)', arm.totalUSD, 0);
  t.eq('Todo es de Miri → arsMyri lleva el total', Math.round(arm.arsMyri), 3 * 11999 + 5000);
  t.eq('Nada de Jony en este pedido', Math.round(arm.arsJONY), 0);
  t.eq('Comisión 15% solo sobre lo de Miri', arm.comiARS, Math.round((3 * 11999 + 5000) * 0.15));
  t.eq('Stock a descontar = exactamente lo que quedó', arm.stockUpdates, '10:3,20:1');

  // Reparto 2×2 con las dos monedas y los dos dueños vivos
  const mix = _armarPedidoDesdeLineas([L(10, 'Chocolate Elite', '', 2, '$', 10000), L(30, 'Pitzujim', '', 3, 'U$S', 10)], [], 0, 'Mayorista', CAT);
  t.eq('Mixto: los pesos son de Miri', Math.round(mix.arsMyri), 20000);
  t.eq('Mixto: los dólares son de Jony (Pitzujim)', mix.usdJONY, 30);
  t.eq('Mixto: Jony no paga comisión en dólares', mix.comiUSD, 0);
  t.eq('Mixto: la comisión ARS sigue siendo el 15% de Miri', mix.comiARS, 3000);

  // Descuento global y notas del pedido: se conservan al levantar
  const conDesc = _armarPedidoDesdeLineas(quedan, ['📝 Entregar el viernes'], 15, 'Mayorista', CAT);
  t.ok('El descuento global vuelve al final del pedido', /🏷️ Descuento global: 15%$/.test(conDesc.productos));
  t.ok('La nota suelta del pedido se conserva', /📝 Entregar el viernes/.test(conDesc.productos));
  t.eq('El total sale rebajado por el descuento global', Math.round(conDesc.totalARS), Math.round((3 * 11999 + 5000) * 0.85));
  t.eq('El reparto también sale rebajado (no queda inflado)', Math.round(conDesc.arsMyri), Math.round((3 * 11999 + 5000) * 0.85));
  t.eq('La comisión se calcula sobre lo rebajado', conDesc.comiARS, Math.round((3 * 11999 + 5000) * 0.85 * 0.15));

  // Descuento por producto [-N%]: el texto guarda el precio ya rebajado y el total lo respeta
  const conDescProd = _armarPedidoDesdeLineas([L(10, 'Chocolate Elite', '', 2, '$', 10000, 10)], [], 0, 'Mayorista', CAT);
  t.ok('Descuento por producto: queda el tag [-10%]', /\[-10%\]/.test(conDescProd.productos));
  t.eq('Descuento por producto: total = 2 × 9.000', Math.round(conDescProd.totalARS), 18000);

  // ── Round-trip: levantar un pedido sin tocar nada no cambia una coma ──
  const TXT = '• 2x Chocolate Elite · Caramelos (90g) — $ 11.999 c/u = $ 23.998 || • 1x Pitzujim · Surtido — U$S 10.00 c/u = U$S 10.00 || 🏷️ Descuento global: 15%';
  const sep = _separarNotasPedido(parsearLineasPedido(TXT));
  sep.lineas[0].prodId = 10; sep.lineas[1].prodId = 30;
  const plan2 = _planLevantarPedido(sep.lineas, stockDe({ 10: 50, 30: 50 }));
  const arm2 = _armarPedidoDesdeLineas(plan2, sep.notas, sep.desc, 'Mayorista', CAT);
  t.eq('Con stock de sobra el pedido se reescribe IGUAL', arm2.productos, TXT);
  t.eq('Round-trip: total ARS con el 15%', Math.round(arm2.totalARS), Math.round(23998 * 0.85));
  t.eq('Round-trip: total USD con el 15%', +arm2.totalUSD.toFixed(2), 8.5);
  t.eq('Round-trip: se descuenta 2 y 1', arm2.stockUpdates, '10:2,30:1');

  // Y si en el medio se vendió casi todo, el pedido se achica sin romper el texto
  const plan3 = _planLevantarPedido(sep.lineas.map(l => Object.assign({}, l)), stockDe({ 10: 1, 30: 0 }));
  const arm3 = _armarPedidoDesdeLineas(plan3, sep.notas, sep.desc, 'Mayorista', CAT);
  t.eq('Achicado: queda 1 producto + el descuento', arm3.productos.split(' || ').length, 2);
  t.eq('Achicado: total = 1 × 11.999 −15%', Math.round(arm3.totalARS), Math.round(11999 * 0.85));
  t.eq('Achicado: no quedan dólares a cobrar', arm3.totalUSD, 0);
  t.eq('Achicado: solo se descuenta lo que quedó', arm3.stockUpdates, '10:1');
  t.ok('Achicado: el texto sigue siendo legible por el parser', parsearLineasPedido(arm3.productos)[0].qty === 1);

  return t.result();
}
module.exports = { run };
