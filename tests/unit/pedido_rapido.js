// 📋 v4.89 — Tanda 4: el pedido rápido mayorista (lista con − y +) y el pedido por mensaje con IA.
// Corre las funciones REALES de la tienda (index.html) y del motor (index.ts).
const fs = require('fs');
const path = require('path');
const { suite } = require('./_helpers');
const TS = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'functions', 'api', 'index.ts'), 'utf8');
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
  if (ini === -1) throw new Error('no encontré const ' + nombre);
  let depth = 0, q = '';
  for (let i = ini; i < src.length; i++) {
    const c = src[i];
    if (q) { if (c === '\\') { i++; continue; } if (c === q) q = ''; continue; }
    if (c === "'" || c === '"' || c === '`') { q = c; continue; }
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    else if (c === ';' && depth === 0) return src.slice(ini, i + 1) + '\n';
  }
  throw new Error('const sin cerrar: ' + nombre);
}
const sinTipos = src => src.replace(/: string\[\]/g, '').replace(/: any\[\]/g, '').replace(/: any/g, '').replace(/: string/g, '').replace(/: number/g, '');

const motor = new Function(constDe(TS, 'PEDIDO_IA_SCHEMA') + ['pedidoMensajeIA', 'limpiarPedidoIA'].map(n => sinTipos(fnDe(TS, n))).join('\n') + '\nreturn { pedidoMensajeIA, limpiarPedidoIA };')();

const tienda = new Function(
  'let productos = [], carrito = {}, modo = "mayorista", adminAuth = false, _estadoTienda = "abierta", _vipIds = null;\n' +
  'var _vistaLista = true;\n' +
  'const toasts = [], eventos = [];\n' +
  'const showToast = m => toasts.push(m); const track = (e, x) => eventos.push([e, x.producto, x.total]); const _contarInteraccion = () => {}; const _cartParaTrack = () => ({});\n' +
  'const agregarAlCarrito = id => toasts.push("cerrada " + id); const actualizarBadge = () => {}; const _lrSincronizarFilas = () => {};\n' +
  'const esc = s => String(s == null ? "" : s);\n' +
  'const _monedaMay = p => (p.moneda === "U$S" ? "U$S" : "$");\n' +
  ['_precioDelModo', '_precioCorto'].map(n => constDe(HTML, n)).join('') +
  ['esPesos', 'ofertaActiva', 'packActivo', 'ofertaVigente', 'precioEfectivo', '_fechaOfertaISO', '_usaLista', '_lrFila', '_listaRapidaHtml', 'lrPoner', 'lrCambiar', 'esFraccion', 'stockDisponible', '_porPeso', '_contenidoBolsa'].map(n => fnDe(HTML, n)).join('\n') +
  '\nconst _hoyAR = () => "2026-09-23";\n' +
  '\nreturn { _lrFila, _listaRapidaHtml, lrPoner, lrCambiar, _usaLista, toasts, eventos, carrito: () => carrito,' +
  ' set: (o) => { if ("productos" in o) productos = o.productos; if ("carrito" in o) carrito = o.carrito; if ("modo" in o) modo = o.modo; if ("estado" in o) _estadoTienda = o.estado; if ("admin" in o) adminAuth = o.admin; if ("lista" in o) _vistaLista = o.lista; } };')();

async function run() {
  const t = suite();
  // ── el pedido a la IA ──
  const prods = [
    { id: 12, nombre: 'Klik chocolate con leche 65g (amarillo)', descripcion: 'Klick chocolate con leche 65g', stock: 20 },
    { id: 30, nombre: 'Barrita Pesek Zman grande (clasica)', descripcion: '', stock: 17 },
    { id: 41, nombre: 'Pitzujim-Mani Sabor Grill', descripcion: 'Manies Sabor Grill (100g)', stock: 0 },
  ];
  const pay = motor.pedidoMensajeIA(prods, 'hola! mandame 12 klik de leche', { tipo: 'image/jpeg', data: 'QUJD' });
  t.eq('modelo, respaldo y JSON con los 4 campos', [pay.model, pay.fallbacks, pay.output_config.format.schema.required], ['claude-opus-5', 'default', ['items', 'noEncontrados', 'cliente', 'nota']]);
  t.ok('el catálogo va con id, nombre, detalle y lo que no tiene stock', pay.system.includes('12 | Klik chocolate con leche 65g (amarillo) | Klick chocolate con leche 65g') && pay.system.includes('30 | Barrita Pesek Zman grande (clasica)\n') && pay.system.includes('41 | Pitzujim-Mani Sabor Grill | Manies Sabor Grill (100g) | SIN STOCK'));
  const cont = pay.messages[0].content;
  t.ok('primero la foto (base64) y después el mensaje', cont[0].type === 'image' && cont[0].source.type === 'base64' && cont[0].source.media_type === 'image/jpeg' && cont[1].text.includes('12 klik de leche'));
  t.eq('solo con foto: lo dice', motor.pedidoMensajeIA(prods, '', { tipo: 'image/png', data: 'x' }).messages[0].content[1].text, 'La lista del cliente está en la foto.');
  t.eq('solo con texto: sin bloque de imagen', motor.pedidoMensajeIA(prods, 'x', null).messages[0].content.length, 1);
  const L = motor.limpiarPedidoIA({
    items: [
      { id: 12, cantidad: 12, pedido: 'klik de leche', dudoso: false },
      { id: 999, cantidad: 3, pedido: 'alfajor havanna', dudoso: false },
      { id: 12, cantidad: 2, pedido: 'y 2 klik más', dudoso: false },
      { id: 30, cantidad: 0, pedido: 'barritas', dudoso: true },
      { id: 41, cantidad: 5, pedido: 'pitzujim de maní', dudoso: true },
      { id: 30, cantidad: 99999, pedido: 'barritas', dudoso: false },
    ],
    noEncontrados: ['bamba de frutilla', ' '], cliente: '  Ana ', nota: 'pide envío el jueves',
  }, prods);
  t.eq('el mismo producto dos veces se suma; lo de cantidad 0 no entra; las cantidades tienen techo', L.items.map(x => [x.id, x.cantidad]), [[12, 14], [41, 5], [30, 9999]]);
  t.eq('cada renglón trae el nombre del catálogo, lo que escribió el cliente, si es dudoso y el stock', L.items[1], { id: 41, nombre: 'Pitzujim-Mani Sabor Grill', cantidad: 5, pedido: 'pitzujim de maní', dudoso: true, stock: 0 });
  t.eq('un id que no existe va a "no encontré", junto con lo que la IA no encontró', L.noEncontrados, ['alfajor havanna', 'bamba de frutilla']);
  t.eq('cliente y nota, limpios', [L.cliente, L.nota], ['Ana', 'pide envío el jueves']);
  t.eq('una respuesta rota no rompe nada', motor.limpiarPedidoIA(null, prods), { items: [], noEncontrados: [], cliente: '', nota: '' });

  // ── la lista rápida mayorista ──
  const P = (id, nombre, extra = {}) => ({ id, nombre, categoria: 'Chocolate', stock: 10, activo: true, visible: 'Ambos', precioMin: 1000, precioMay: '4.5', moneda: 'U$S', unidadesPorPaquete: 1, ...extra });
  const cat = [P(1, 'Klik azul', { unidadesPorPaquete: 12, stock: 20 }), P(2, 'Elite Crunch'), P(3, 'Pitzujim-Mani Grill', { categoria: 'Pitzujim', moneda: '$', precioMay: '8300' }), P(4, 'Agotado', { stock: 0 }), P(5, 'Sin precio', { precioMay: '0' })];
  tienda.set({ productos: cat, carrito: {}, modo: 'mayorista', lista: true });
  t.ok('la lista rápida es solo del mayorista (y no en el panel)', tienda._usaLista() && (tienda.set({ modo: 'minorista' }), !tienda._usaLista()) && (tienda.set({ modo: 'mayorista', admin: true }), !tienda._usaLista()));
  tienda.set({ admin: false });
  const html = tienda._listaRapidaHtml([cat[0], cat[1], cat[2]], [cat[3]]);
  t.ok('agrupada por categoría, con precio en su moneda y "trae 12"', /Chocolate[\s\S]*Klik azul[\s\S]*U\$S 4\.50<\/b> · trae 12[\s\S]*Elite Crunch[\s\S]*Pitzujim[\s\S]*\$ 8\.300/.test(html));
  t.ok('lo agotado al final, con "Avisame" en vez de − y +', /🔔 Sin stock[\s\S]*Agotado[\s\S]*abrirNotifModal\(4\)/.test(html) && !/lrCambiar\(4/.test(html));
  t.ok('no muestra el stock que hay (es interno)', !/stock 10/.test(html));
  tienda.lrCambiar(1, 1);
  t.eq('"+" suma 1 al carrito y lo registra como agregado', [tienda.carrito()[1].qty, tienda.eventos.slice(-1)[0][0]], [1, 'carrito']);
  tienda.lrPoner(1, '12');
  t.eq('escribir 12 deja 12 (y no vuelve a registrar un agregado)', [tienda.carrito()[1].qty, tienda.eventos.filter(e => e[0] === 'carrito').length], [12, 1]);
  tienda.lrPoner(2, '999');
  t.eq('más que el stock: queda el stock y avisa', [tienda.carrito()[2].qty, tienda.toasts.slice(-1)[0]], [10, 'No hay más unidades disponibles']);
  tienda.lrCambiar(2, -1);
  t.eq('"−" baja y lo registra como quitado', [tienda.carrito()[2].qty, tienda.eventos.slice(-1)[0]], [9, ['quitar', 'Elite Crunch', '9']]);
  tienda.lrPoner(2, '0');
  t.ok('en 0 sale del carrito', !tienda.carrito()[2]);
  tienda.lrCambiar(5, 1);
  t.ok('sin precio no entra, y avisa', !tienda.carrito()[5] && tienda.toasts.slice(-1)[0].includes('no tiene precio'));
  t.ok('la fila muestra lo que hay en el carrito', tienda._lrFila(cat[0]).includes('value="12"') && tienda._lrFila(cat[0]).includes('lr-fila en'));
  tienda.set({ estado: 'cerrada' });
  tienda.lrCambiar(3, 1);
  t.ok('con la tienda cerrada, va el aviso de siempre (no se carga nada)', !tienda.carrito()[3] && tienda.toasts.slice(-1)[0] === 'cerrada 3');
  return t.result();
}
module.exports = { run };
