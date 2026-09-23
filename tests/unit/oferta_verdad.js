// 🏷️ v4.91 — Tanda 6: que las ofertas y packs se cobren. Una sola cuenta (precioEfectivo) para la
// tarjeta, el carrito, el mensaje y la venta. Funciones REALES de la tienda, con el reloj y el canal fijados.
const fs = require('fs');
const path = require('path');
const { suite } = require('./_helpers');
const HTML = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
function fnDe(src, nombre) {
  const m = src.match(new RegExp('function\\s+' + nombre + '\\s*\\('));
  if (!m) throw new Error('no encontré ' + nombre);
  let i = m.index + m[0].length, depth = 1;
  while (depth > 0) { const c = src[i++]; if (c === '(') depth++; else if (c === ')') depth--; }
  i = src.indexOf('{', i) + 1; depth = 1;
  while (i < src.length && depth > 0) { const c = src[i]; if (c === '{') depth++; else if (c === '}') depth--; i++; }
  return src.slice(m.index, i);
}
function constDe(src, nombre) {
  const ini = src.indexOf('const ' + nombre + ' = ');
  let depth = 0, q = '';
  for (let i = ini; i < src.length; i++) {
    const c = src[i];
    if (q) { if (c === '\\') { i++; continue; } if (c === q) q = ''; continue; }
    if (c === "'" || c === '"' || c === '`') { q = c; continue; }
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    else if (c === ';' && depth === 0) return src.slice(ini, i + 1) + '\n';
  }
}
const T = new Function(
  'let modo = "minorista", HOY = "2026-09-23";\n' +
  'const _hoyAR = () => HOY;\n' +
  'const _monedaMay = p => (p.moneda === "U$S" ? "U$S" : "$");\n' +
  constDe(HTML, '_precioDelModo') +
  ['_fechaOfertaISO', 'ofertaActiva', 'packActivo', 'ofertaVigente', 'precioEfectivo'].map(n => fnDe(HTML, n)).join('\n') +
  '\nreturn { _fechaOfertaISO, ofertaActiva, packActivo, ofertaVigente, precioEfectivo, set: o => { if ("modo" in o) modo = o.modo; if ("hoy" in o) HOY = o.hoy; } };')();

async function run() {
  const t = suite();
  t.eq('las fechas: dd/mm/aaaa, d/m/aaaa y aaaa-mm-dd; lo demás, sin vencimiento', ['30/09/2026', '5/9/2026', '2026-09-30', '2026-09-30T00:00', 'mañana', ''].map(T._fechaOfertaISO), ['2026-09-30', '2026-09-05', '2026-09-30', '2026-09-30', '', '']);
  const P = (extra = {}) => ({ id: 1, precioMin: 10000, precioMay: '6', moneda: 'U$S', precioOferta: 0, fechaOferta: '', cantPack: 0, precioPack: 0, ...extra });
  const of = P({ precioOferta: 8000, fechaOferta: '23/09/2026' });
  t.ok('la oferta vale todo el día que vence (hora de Buenos Aires)', T.ofertaActiva(of));
  T.set({ hoy: '2026-09-24' });
  t.ok('y al otro día ya no', !T.ofertaActiva(of));
  t.ok('la oferta rápida (aaaa-mm-dd), que antes nunca vencía, ahora vence', !T.ofertaActiva(P({ precioOferta: 8000, fechaOferta: '2026-09-23' })));
  T.set({ hoy: '2026-09-23' });
  t.eq('sin fecha, sigue', T.ofertaActiva(P({ precioOferta: 8000 })), true);
  t.eq('minorista: con oferta se cobra la oferta', T.precioEfectivo(of, 1), 8000);
  t.eq('una "oferta" más cara que la lista no cuenta', [T.ofertaVigente(P({ precioOferta: 12000 })), T.precioEfectivo(P({ precioOferta: 12000 }), 1)], [false, 10000]);
  const vip = P({ precioMin: 7000, precioOferta: 8000 });   // el link VIP ya bajó la lista a 7.000
  t.eq('link VIP + oferta: el más bajo de los dos', [T.precioEfectivo(vip, 1), T.precioEfectivo(P({ precioMin: 9000, precioOferta: 8000 }), 1)], [7000, 8000]);
  const pk = P({ cantPack: 3, precioPack: 8500 });
  t.eq('pack: con menos de 3, precio de lista; llevando 3 o más, cada una a $ 8.500', [T.precioEfectivo(pk, 2), T.precioEfectivo(pk, 3), T.precioEfectivo(pk, 7)], [10000, 8500, 8500]);
  const ambos = P({ precioOferta: 8000, cantPack: 3, precioPack: 8500 });
  t.eq('oferta y pack juntos: siempre el más bajo (acá la oferta)', [T.precioEfectivo(ambos, 1), T.precioEfectivo(ambos, 5)], [8000, 8000]);
  const ambos2 = P({ precioOferta: 9000, cantPack: 3, precioPack: 8500 });
  t.eq('…y si el pack es más bajo, el pack desde 3', [T.precioEfectivo(ambos2, 2), T.precioEfectivo(ambos2, 3)], [9000, 8500]);
  T.set({ modo: 'mayorista' });
  t.eq('mayorista: ni oferta ni pack (el precio de oferta no tiene moneda); se cobra la lista del canal', [T.ofertaActiva(ambos), T.packActivo(ambos), T.precioEfectivo(ambos, 10)], [false, false, 6]);
  T.set({ modo: 'minorista' });
  t.eq('sin cantidad (0) no activa el pack', T.precioEfectivo(pk, 0), 10000);
  return t.result();
}
module.exports = { run };
