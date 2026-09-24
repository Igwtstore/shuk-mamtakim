// 🆔 v5.07 — EL DUEÑO DE CADA RENGLÓN LO DECIDE LA FICHA QUE EL PEDIDO DESCONTÓ (caso #157, 24/09/2026)
// El chocolate #344 (de Jony) se renombró después del pedido. El renglón guarda el nombre VIEJO, que ya no es
// de ninguna ficha, y el panel caía en "Chocolate Elite" = una ficha vieja de Miri (#1, stock 0):
//   · la tarjeta mostraba MIRI en algo que cobró Jony;
//   · el editor de pedidos, al abrir y guardar sin tocar nada, le pasaba la plata a Miri (13 pedidos así).
// Con las funciones REALES de index.html y fichas copiadas de la base de ese día.
const { extraerFns, suite } = require('./_helpers');
const F = extraerFns('../../index.html', ['_identificarLineasPedido', '_armarPedidoDesdeLineas', '_precioMoneda', 'parsearLineasPedido',
  '_separarNotasPedido', '_nombresDe', '_matchNombreProd', '_suIdsDe', '_nombreLineaCat', '_gemeloMasViejo', '_resolverGemelosMixtos',
  '_lineaEsDeJony', '_nombresJony', '_fichasDeLineaEnVenta', '_lineasPedidoVista']);

const CAT = [
  { id: '1', nombre: 'Chocolate Elite', desc: 'Con caramelos explotables (90g) (Igur Harabanim)', dueno: 'Miri', moneda: 'U$S', precioMay: '5.8', precioMin: 10000, nombresPrev: '' },
  { id: '8', nombre: 'Elite Etzbaot Explotables', desc: 'Dedos de chocolate tipo KINDER con caramelos explotables x21', dueno: 'Miri', moneda: 'U$S', precioMay: '17', precioMin: 32499, nombresPrev: '' },
  { id: '43', nombre: 'Pitzujim-Mani Sabor Grill', desc: 'Manies Sabor Grill (100g) (Mezonot!!)', dueno: 'Jony', moneda: '$', precioMay: '8300', precioMin: 9999, nombresPrev: '' },
  { id: '44', nombre: 'Pitzujim-Mani Sabor Falafel', desc: 'Manies Sabor Falafel (100g) (Mezonot!!)', dueno: 'Jony', moneda: '$', precioMay: '8300', precioMin: 9999, nombresPrev: 'Pitzujim' },
  { id: '48', nombre: 'Pitzujim-Pecán Caramelizadas.', desc: 'Nueces Pecán Caramelizadas Israelíes (100g)', dueno: 'Jony', moneda: '$', precioMay: '10000', precioMin: 12000, nombresPrev: '' },
  { id: '68', nombre: 'Klik Kukiman · Edición especial chocolate y blanco', desc: 'Cereales crocantes sabor chocolate y vainilla', dueno: 'Miri', moneda: 'U$S', precioMay: '4.5', precioMin: 7999, nombresPrev: '' },
  { id: '153', nombre: 'Klik Kukiman · Edición especial chocolate y blanco (Violeta)', desc: 'Cereales crocantes sabor chocolate y vainilla', dueno: 'Jony', moneda: 'U$S', precioMay: '4.5', precioMin: 7999, nombresPrev: 'Klik Kukiman · Edición especial chocolate y blanco' },
  { id: '251', nombre: 'Elite Etzbaot Explotables', desc: 'barrita de chocolate tipo KINDER con caramelos explotables x21', dueno: 'Jony', moneda: 'U$S', precioMay: '17.85', precioMin: 32499, nombresPrev: '' },
  { id: '344', nombre: 'Chocolate Elite · Blanco con chispas que explotan en la boca (90g)', desc: 'Chocolate blanco con chispas explotables (90g)', dueno: 'Jony', moneda: 'U$S', precioMay: '6.5', precioMin: 11999, nombresPrev: 'Chocolate Elite · Blanco con caramelos explotables (90g)' }
];
const abrir = v => F._identificarLineasPedido(F._separarNotasPedido(F.parsearLineasPedido(v.productos)).lineas, v, CAT);

function run() {
  const t = suite();
  const antes = globalThis.productos;
  globalThis.productos = CAT;   // _lineaEsDeJony y compañía leen el catálogo global, como en el panel
  try {
    // ── #157: el renglón con el nombre VIEJO del #344 ──────────────────────────────────────────────
    const v157 = { tipo: 'Minorista', stockUpdates: '48:1,344:1', arsMyri: 0, usdMyri: 0,
      productos: '• 1x Pitzujim-Pecán Caramelizadas. · Nueces Pecán Caramelizadas Israelíes (100g) — $ 12.000 c/u = $ 12.000 || • 1x Chocolate Elite · Blanco con caramelos explotables (90g) · Chocolate blanco con caramelos explotables (9 — $ 11.999 c/u = $ 11.999' };
    const l157 = abrir(v157);
    t.eq('#157: el chocolate renombrado es la ficha #344 (la que el pedido descontó), no la #1 de Miri', l157.map(l => l.prodId), ['48', '344']);
    const a157 = F._armarPedidoDesdeLineas(l157, [], 0, 'Minorista', CAT, true);
    t.eq('#157: abrir y guardar sin tocar deja todo en Jony', [Math.round(a157.arsJONY), a157.arsMyri, a157.comiARS], [23999, 0, 0]);
    t.eq('#157: y el stock sigue apuntando a las mismas fichas', a157.stockUpdates, '48:1,344:1');
    const su157 = F._suIdsDe(v157.stockUpdates), L157 = v157.productos.split(' || ');
    t.ok('#157: el cartel del renglón dice JONY (antes decía MIRI)', F._lineaEsDeJony(L157[1], F._nombresJony(), su157, L157, 1) === true);
    t.eq('Ficha que el renglón nombra dentro del pedido: la #344', F._fichasDeLineaEnVenta(L157[1], su157).map(p => p.id), ['344']);

    // ── #136: gemelos de nombre idéntico (Miri #8 y Jony #251), el pedido descontó el de Jony ─────────
    const v136 = { tipo: 'Mayorista', stockUpdates: '251:1', productos: '• 1x Elite Etzbaot Explotables · Dedos de chocolate tipo KINDER con caramelos — U$S 17.85 c/u = U$S 17.85' };
    const l136 = abrir(v136);
    t.eq('#136: gemelo de Jony (#251), aunque la descripción se parezca más a la vieja de Miri', l136.map(l => l.prodId), ['251']);
    const a136 = F._armarPedidoDesdeLineas(l136, [], 0, 'Mayorista', CAT);
    t.eq('#136: la plata queda en Jony (sin candado: lo decide la ficha)', [a136.usdJONY, a136.usdMyri], [17.85, 0]);

    // ── Nombre viejo GENÉRICO: la #44 se llamó "Pitzujim" a secas, como todos los de junio ─────────────
    const v16 = { tipo: 'Mayorista', stockUpdates: '43:5,44:2', productos: '• 5x Pitzujim · Manies Sabor Grill (100g) — $ 6.500 c/u = $ 32.500 || • 2x Pitzujim · Manies Sabor Falafel (100g) — $ 6.500 c/u = $ 13.000' };
    t.eq('Nombre viejo genérico: cada renglón a su ficha (no todos a la #44)', abrir(v16).map(l => l.prodId), ['43', '44']);

    // ── Gemelos de AMBOS dueños descontados en la MISMA venta: decide la cantidad ──────────────────────
    const vGem = { tipo: 'Mayorista', stockUpdates: '68:5,153:3', productos: '• 5x Klik Kukiman · Edición especial chocolate y blanco · Cereales crocantes sabor chocolate y — U$S 4.50 c/u = U$S 22.50 || • 3x Klik Kukiman · Edición especial chocolate y blanco · Cereales crocantes sabor chocolate y — U$S 4.50 c/u = U$S 13.50' };
    t.eq('Gemelos Miri+Jony en el mismo pedido: 5 → la de Miri, 3 → la de Jony', abrir(vGem).map(l => l.prodId), ['68', '153']);
    const aGem = F._armarPedidoDesdeLineas(abrir(vGem), [], 0, 'Mayorista', CAT);
    t.eq('Pedido viejo mixto: el reparto histórico se respeta (Miri 22,50 · Jony 13,50)', [aGem.usdMyri, aGem.usdJONY], [22.5, 13.5]);

    // ── Candado: un pedido que no le daba nada a Miri no puede empezar a darle ─────────────────────────
    const mal = [{ qty: 2, nombre: 'Chocolate Elite', descripcion: 'x', moneda: 'U$S', precio: 6.5, prodId: '1' }];   // emparejado con la ficha vieja de Miri
    const sinCandado = F._armarPedidoDesdeLineas(mal, [], 0, 'Mayorista', CAT);
    const conCandado = F._armarPedidoDesdeLineas(mal, [], 0, 'Mayorista', CAT, true);
    t.ok('Sin el candado, una ficha de Miri le daría plata (así era antes)', sinCandado.usdMyri === 13 && sinCandado.comiUSD === 1.95);
    t.eq('Con el candado (pedido sin plata de Miri): todo a Jony y comisión 0', [conCandado.usdJONY, conCandado.usdMyri, conCandado.comiUSD], [13, 0, 0]);

    // ── Vista Miri de un pedido VIEJO mixto: ve exactamente lo suyo ────────────────────────────────────
    const vis = F._lineasPedidoVista(vGem.productos, true, vGem.stockUpdates);
    t.eq('Vista Miri del pedido mixto: ve solo su renglón (el de 5)', vis.map(l => (l.match(/(\d+)x/) || [])[1]), ['5']);
  } finally { globalThis.productos = antes; }
  return t.result();
}
module.exports = { run };
