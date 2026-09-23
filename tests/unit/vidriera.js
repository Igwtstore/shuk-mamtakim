// 🔥 v4.87 — Tanda 2 "Que agarren algo": la vidriera que se ordena sola, los sellos que dicen la
// verdad, "Completá los sabores" y el pedido de la ficha a la IA. Corre las funciones REALES del
// motor (index.ts) y de la tienda (index.html) con datos armados a mano.
const fs = require('fs');
const path = require('path');
const { suite } = require('./_helpers');
const TS = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'functions', 'api', 'index.ts'), 'utf8');
const HTML = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');

// ── extractores (mismo criterio que el resto de la red: el código que corre en producción) ──
function bloqueTS(nombre) {
  const re = new RegExp('(?:async\\s+)?function\\s+' + nombre + '\\s*\\(');
  const m = TS.match(re); if (!m) throw new Error('no encontré ' + nombre);
  let i = TS.indexOf('{', m.index + m[0].length), depth = 0;
  for (; i < TS.length; i++) { const c = TS[i]; if (c === '{') depth++; else if (c === '}') { depth--; if (!depth) { i++; break; } } }
  return quitarTipos(TS.slice(m.index, i));
}
function quitarTipos(src) {
  return src
    .replace(/\)\s*:\s*(number \| null|any\[\]|any|string|boolean)\s*\{/, ') {')
    .replace(/:\s*Record<[^>]+>/g, '')
    .replace(/(\w+)\s*:\s*(?:string|number|boolean|any)(\[\])?(?=\s*[,)=])/g, '$1')
    .replace(/const (\w+)\s*:\s*any(\[\])?\s*=/g, 'const $1 =')
    .replace(/\(([a-z]\w*)\s*:\s*any\)/g, '($1)')
    .replace(/\((\w+)\s*:\s*any,\s*(\w+)\s*:\s*any\)/g, '($1, $2)')
    .replace(/\s+as\s+(any|number|string|boolean)\b/g, '')
    .replace(/(\w+)!\./g, '$1.').replace(/(\w+)!\[/g, '$1[').replace(/\)!\./g, ').');
}
// Una constante de una sola sentencia (hasta el primer ";" + salto de línea).
function constTS(nombre) {
  const m = TS.match(new RegExp('const ' + nombre + ' = [\\s\\S]*?;\\n'));
  if (!m) throw new Error('no encontré const ' + nombre);
  return quitarTipos(m[0]);
}
function fnHTML(nombre) {
  const re = new RegExp('function\\s+' + nombre + '\\s*\\([^)]*\\)\\s*\\{');
  const m = HTML.match(re); if (!m) throw new Error('no encontré ' + nombre);
  let i = m.index + m[0].length, depth = 1;
  while (i < HTML.length && depth > 0) { const c = HTML[i]; if (c === '{') depth++; else if (c === '}') depth--; i++; }
  return HTML.slice(m.index, i);
}
// Una constante (aunque ocupe varias líneas): hasta el ";" que la cierra fuera de paréntesis y llaves.
function constHTML(nombre) {
  const ini = HTML.indexOf('const ' + nombre + ' = ');
  if (ini === -1) throw new Error('no encontré const ' + nombre);
  let depth = 0, q = '';
  for (let i = ini; i < HTML.length; i++) {
    const c = HTML[i];
    if (q) { if (c === '\\') { i++; continue; } if (c === q) q = ''; continue; }
    if (c === "'" || c === '"' || c === '`') { q = c; continue; }
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    else if (c === ';' && depth === 0) return HTML.slice(ini, i + 1) + '\n';
  }
  throw new Error('const sin cerrar: ' + nombre);
}

// FICHA_IA_SCHEMA es un objeto de varias líneas: se toma entero (hasta el "};" que lo cierra).
const schemaSrc = TS.match(/const FICHA_IA_SCHEMA = \{[\s\S]*?\n\};\n/)[0];
const motor = new Function(
  'const esJSON = x => (x || \'\').charCodeAt(0) === 123;\n' +
  bloqueTS('fotoShukUrl') + '\n' +
  constTS('fotosShukLista') + '\n' +
  schemaSrc + '\n' +
  ['tsDeFecha', 'fechaAhora', 'hoyVsSemana', 'leerVistas', 'pedidoHabitual', 'productosQueVolvieron', 'calcularVidriera', 'pedidoFichaIA', 'fotoParaIA', 'analitica'].map(bloqueTS).join('\n') +
  '\nreturn { calcularVidriera, pedidoFichaIA, fotoParaIA, analitica, fechaAhora, FICHA_IA_SCHEMA };')();

// La tienda: las funciones con su entorno (catálogo, carrito, canal) armado a mano.
const tienda = new Function(
  'let productos = [], carrito = {}, modo = "minorista", _vipIds = null, _vidriera = null, _vidCache = null;\n' +
  'const productosVisibles = () => productos;\n' +
  'const esc = s => String(s == null ? "" : s);\n' +
  'const _monedaMay = p => (p.moneda === "U$S" ? "U$S" : "$");\n' +
  ['_normTxt', '_GENERICAS', '_precioDelModo', '_precioCorto'].map(constHTML).join('') +
  ['esPesos', 'ofertaActiva', '_lineaDe', '_famFina', '_vidIdx', '_vidComparar', '_vidTopIds', '_sellosHtml', '_saboresPara', 'getMarcaIdx', 'getCatIdx'].map(fnHTML).join('\n') +
  '\nconst MARCAS_LINEA = ' + HTML.match(/const MARCAS_LINEA = (\[[^\]]*\]);/)[1] + ';\n' +
  'const CATEGORIA_ORDEN = ' + HTML.match(/const CATEGORIA_ORDEN = (\[[^\]]*\]);/)[1] + ';\n' +
  'return { _lineaDe, _famFina, _vidComparar, _vidTopIds, _sellosHtml, _saboresPara, getCatIdx, getMarcaIdx,' +
  ' set: (o) => { if ("productos" in o) productos = o.productos; if ("carrito" in o) carrito = o.carrito; if ("modo" in o) modo = o.modo; if ("vip" in o) _vipIds = o.vip; if ("vidriera" in o) { _vidriera = o.vidriera; _vidCache = null; } } };')();

async function run() {
  const t = suite();
  const DIA = 86400000, AHORA = Date.parse('2026-09-22T20:00:00Z');
  const hace = d => new Date(AHORA - d * DIA).toISOString();
  const prods = [
    { id: 1, stock: 48, activo: true }, { id: 2, stock: 22, activo: true }, { id: 3, stock: 4, activo: true },
    { id: 4, stock: 17, activo: true }, { id: 5, stock: 0, activo: true }, { id: 6, stock: 30, activo: false },
    { id: 7, stock: 50, activo: true }, { id: 8, stock: 3, activo: true },
  ];
  const v = (dias, su, extra = {}) => ({ creado: hace(dias), fecha: '', estado: 'entregado', cliente: 'Ana', stock_updates: su, ...extra });
  const ventas = [
    v(1, '1:1,2:1'), v(2, '1:2,2:1,3:2'), v(3, '1:1,3:1'), v(4, '2:1,3:1'),
    v(5, '4:24'),                                   // un mayorista enorme: UN pedido
    v(2, '4:1'),
    v(1, '5:3'), v(2, '5:1'),                        // agotado: no va arriba
    v(1, '6:2'), v(2, '6:2'),                        // pausado: no va a ningún lado
    v(1, '7:9', { estado: 'cancelado' }), v(2, '7:9', { estado: 'cotizacion' }), v(3, '7:9', { cliente: 'Candy' }),   // no cuentan
    v(20, '8:4'), v(21, '8:3'), v(25, '8:3'),        // 10 u en el mes, 3 pedidos, quedan 3 → dura 9 días
    v(40, '1:50'),                                  // fuera de los 30 días
  ];
  const V = motor.calcularVidriera(ventas, prods, AHORA);
  t.eq('lo más pedido de la semana: por PEDIDOS distintos, a igualdad más unidades (el mayorista de 24 u es UN pedido y queda último)', V.top, [1, 3, 2, 4]);
  t.eq('mira 7 días cuando alcanzan', V.dias, 7);
  t.ok('lo agotado, lo pausado y lo cancelado/cotizado/Candy no van arriba', !V.top.includes(5) && !V.top.includes(6) && !V.top.includes(7));
  t.eq('el orden de 30 días: más pedidos primero, a igualdad más unidades (el 8 tuvo 3 pedidos y 10 u)', V.orden.slice(0, 5), [8, 1, 3, 2, 4]);
  t.ok('el orden deja afuera lo pausado y lo que no cuenta', !V.orden.includes(6) && !V.orden.includes(7));
  t.eq('se agota pronto: 3 pedidos y menos de 10 días al ritmo del mes (10 u al mes, quedan 3), con el stock de ese momento', V.agota, { 8: 3 });
  t.ok('poco stock pero se vende lento no es "se agota" (quedan 4, salen 4 al mes: 30 días)', V.agota[3] === undefined && V.agota[1] === undefined);
  const flojo = motor.calcularVidriera([v(1, '1:1'), v(2, '1:1'), v(10, '2:1'), v(11, '2:1'), v(12, '3:1'), v(13, '3:1'), v(9, '4:1'), v(8, '4:1')], prods, AHORA);
  t.eq('semana floja (menos de 4 con 2 pedidos): mira 14 días', [flojo.dias, flojo.top], [14, [1, 2, 3, 4]]);
  t.eq('una sola compra no es "lo más pedido"', motor.calcularVidriera([v(1, '1:5')], prods, AHORA).top, []);
  const conFecha = motor.calcularVidriera([{ fecha: '22/09/2026 10:00', estado: 'pendiente', stock_updates: '2:1' }, { fecha: '21/09/2026 10:00', estado: 'pendiente', stock_updates: '2:1' }], prods, AHORA);
  t.eq('sin "creado" usa la fecha del pedido', conFecha.orden, [2]);

  // ── el pedido a la IA ──
  const p = { id: 9, nombre: 'Chocolate Elite Crunch', descripcion: '', categoria: 'Chocolate', precio_min: 7999, hashgaja: 'Badatz', kosher_tipo: 'Lácteo' };
  const pay = motor.pedidoFichaIA(p, ['- Klik · bolitas de chocolate (65g)'], 'La vieron 12 personas en el último mes y nadie la puso en el carrito.', 'https://res.cloudinary.com/x.jpg');
  t.eq('modelo y respaldo si se niega', [pay.model, pay.fallbacks], ['claude-opus-5', 'default']);
  t.eq('pide JSON con los 5 campos', pay.output_config.format.schema.required, ['desc', 'nombre', 'cambiarNombre', 'foto', 'porque']);
  t.ok('sin temperatura ni presupuesto de pensamiento (la API los rechaza)', pay.temperature === undefined && pay.thinking === undefined);
  const cont = pay.messages[0].content;
  t.ok('primero la foto, después el texto', cont[0].type === 'image' && cont[0].source.url === 'https://res.cloudinary.com/x.jpg' && cont[1].type === 'text');
  t.ok('el texto dice qué es, que no tiene descripción, el precio, lo kosher y lo que pasa en la tienda', /Chocolate Elite Crunch/.test(cont[1].text) && /\(no tiene\)/.test(cont[1].text) && /\$ 7\.999/.test(cont[1].text) && /Badatz · Lácteo/.test(cont[1].text) && /12 personas/.test(cont[1].text));
  t.ok('el estilo sale de fichas reales, y prohíbe inventar', pay.system.includes('- Klik · bolitas de chocolate (65g)') && /Nada inventado/.test(pay.system));
  const sinFoto = motor.pedidoFichaIA(p, [], 'No tiene descripción.', '');
  t.ok('sin foto: solo texto, y lo avisa', sinFoto.messages[0].content.length === 1 && /No tiene foto cargada/.test(sinFoto.messages[0].content[0].text));
  t.eq('la foto para la IA: salta el video y la pide a 800 px en JPG', motor.fotoParaIA('shuk/video/abc.mp4, shuk-mamtakim/elite'), 'https://res.cloudinary.com/dq2boloyp/image/upload/w_800,f_jpg,q_auto/shuk-mamtakim/elite');
  t.eq('sin fotos: nada', motor.fotoParaIA(''), '');

  // ── lo que mide la Analítica ──
  const hoy = motor.fechaAhora().slice(0, 10);
  const ev = (vid, evento, hora, detalle = '') => ({ fecha: hoy + ' ' + hora, vid, pagina: 'tienda', evento, origen: 'directo', dispositivo: 'celular', ciudad: '', pais: '', nombre: '', telefono: '', detalle, carrito: '', total: 0 });
  const rows = [
    ev('v_a', 'visita', '00:01'), ev('v_a', 'vidriera', '00:02', 'fila · Klik'), ev('v_a', 'vidriera', '00:03', 'sabores · ofrecido'), ev('v_a', 'vidriera', '00:04', 'sabores · Klik rojo'), ev('v_a', 'pedido', '00:06'),
    ev('v_b', 'visita', '00:01'), ev('v_b', 'vidriera', '00:02', 'fila · Bamba'), ev('v_b', 'vidriera', '00:02', 'fila · Elite'),
    ev('v_c', 'visita', '00:01'), ev('v_c', 'vidriera', '00:02', 'sabores · ofrecido'),
  ];
  const d = motor.analitica(rows, 7, [], [], [{ id: 1, nombre: 'Klik', stock: 3 }], null, {});
  t.eq('desde la fila 3 sumados (2 personas); sabores: 2 los vieron, 1 sumó; pidió 1 (sin contarlo dos veces)', d.vidriera, { fila: { sumados: 3, personas: 2 }, sabores: { ofrecidos: 2, sumados: 1, personas: 1 }, compraron: 1 });
  t.eq('sin esos eventos, no hay tarjeta', motor.analitica([ev('v_z', 'visita', '00:01')], 7, [], [], [], null, {}).vidriera, null);
  const vis = (vid, n) => ({ ...ev(vid, 'vistas', '00:0' + n), detalle: JSON.stringify({ v: [{ n: 'Gemelo' }] }) });
  const dG = motor.analitica([vis('v1', 1), vis('v2', 2)], 7, [], [], [{ id: 10, nombre: 'Gemelo', stock: 0, activo: true }, { id: 11, nombre: 'Gemelo', stock: 6, activo: true }], null, {});
  const fila = (dG.verMas.vistosSinCarrito || []).find(x => x.nombre === 'Gemelo');
  t.eq('"los ven y no los agarran" trae el id: entre gemelos, el que tiene stock', fila && fila.id, '11');

  // ── la tienda: familias, orden, fila, sellos y sabores ──
  const L = n => tienda._lineaDe({ nombre: n }), Fm = n => tienda._famFina({ nombre: n });
  t.eq('la línea sale de la primera palabra que no es genérica', ['Pitzujim-Mani Sabor Grill', 'Tableta chocolate Pesek Zman (marron)', 'Barrita Pesek Zman grande', 'Chocolate Elite Crunch · Blanco con biscuit', 'Caramelos Mentos Discovery Pack x 4', "Wow'Z", 'Klik almohaditas 65g (azul)'].map(L), ['pitzujim', 'pesek', 'pesek', 'elite', 'mentos', 'wow', 'klik']);
  t.eq('la familia es el producto sin el sabor, el color ni el peso', ['Chocolate Elite Crunch · Blanco con biscuit', 'Chocolate Elite Crunch', 'Klik almohaditas 65g (azul)', 'Tableta chocolate Pesek Zman (verde) (LoTob)', 'Elite Etzbaot Mix x 34 unid'].map(Fm), ['chocolate elite crunch', 'chocolate elite crunch', 'klik almohaditas', 'tableta chocolate pesek zman', 'elite etzbaot mix']);

  const C = (id, nombre, extra = {}) => ({ id, nombre, desc: '', categoria: 'Chocolate', stock: 10, activo: true, visible: 'Ambos', precioMin: 1000, precioMay: '1', moneda: '$', ...extra });
  const catalogo = [
    C(1, 'Klik almohaditas 65g (azul)'), C(2, 'Klik biscuit arroz 65g (rojo)'), C(3, 'Klik cornflakes 65g (verde)'),
    C(4, 'Chocolate Elite Crunch'), C(5, 'Chocolate Elite Crunch · Blanco con biscuit'), C(6, 'Chocolate Elite · Cream Jalav (100g)'),
    C(7, 'Chocolate Milka · Oreo'), C(8, 'Chocolate Milka · Toffee Creme (100g)', { stock: 0 }),
    C(9, 'Aaa sin ventas'), C(10, 'Mentos Pure Fresh', { categoria: 'Pastilla' }), C(11, 'Mentos Pure Fresh', { categoria: 'Pastilla', stock: 7 }),
    C(12, 'Solo mayorista', { visible: 'Mayorista' }), C(13, 'Sin precio', { precioMin: 0 }),
  ];
  tienda.set({ productos: catalogo, carrito: {}, modo: 'minorista', vip: null, vidriera: { t: 1, dias: 7, top: [5, 12, 13, 10, 11, 1, 8, 7, 2, 4], orden: [5, 1, 7, 4, 2, 10], agota: { 5: 4, 2: 12 } } });
  const orden = catalogo.slice().sort((a, b) => tienda.getCatIdx(a) - tienda.getCatIdx(b) || tienda._vidComparar(a, b) || tienda.getMarcaIdx(a) - tienda.getMarcaIdx(b) || a.nombre.localeCompare(b.nombre));
  t.eq('en la categoría: primero lo que vende, cada línea junta y la mejor línea primero (Elite: 5 y 4; Klik: 1 y 2; Milka), después el resto como siempre',
    orden.filter(p => p.categoria === 'Chocolate').map(p => p.id).slice(0, 5), [5, 4, 1, 2, 7]);
  t.ok('lo que no vendió va después de todo lo que vendió', orden.findIndex(p => p.id === 9) > orden.findIndex(p => p.id === 7));
  const top = tienda._vidTopIds();
  t.eq('la fila: sin lo que no se ve en este canal, sin precio, sin stock y sin repetir gemelos', top, [5, 10, 1, 7, 2, 4]);
  tienda.set({ modo: 'mayorista' });
  t.ok('en mayorista entra lo que es solo mayorista', tienda._vidTopIds().includes(12));
  tienda.set({ modo: 'minorista' });
  const topSet = new Set(top);
  t.ok('sello 🔥 en los de la fila', tienda._sellosHtml(catalogo[4], topSet).includes('🔥 Lo más pedido'));
  t.ok('⏳ con el stock de cuando se calculó o menos', tienda._sellosHtml(C(5, 'x', { stock: 4 }), new Set()).includes('⏳ Se agota pronto'));
  t.ok('si entró mercadería (hay más que entonces), el ⏳ se apaga solo', !tienda._sellosHtml(C(5, 'x', { stock: 20 }), new Set()).includes('⏳'));
  t.ok('lo agotado no lleva sellos', tienda._sellosHtml(C(5, 'x', { stock: 0 }), topSet) === '');
  t.eq('lo que no está en ninguna lista, sin sellos', tienda._sellosHtml(catalogo[8], topSet), '');

  // Completá los sabores
  tienda.set({ carrito: { 1: { ...catalogo[0], qty: 2 } } });
  t.eq('con un Klik en el carrito: los otros Klik, el que más se vende primero', tienda._saboresPara([catalogo[0]], 3).map(p => p.id), [2, 3]);
  tienda.set({ carrito: { 4: { ...catalogo[3], qty: 1 } } });
  t.eq('con Elite Crunch: primero el mismo producto en otro sabor, después su línea', tienda._saboresPara([catalogo[3]], 3).map(p => p.id), [5, 6]);
  tienda.set({ carrito: { 7: { ...catalogo[6], qty: 1 } } });
  t.eq('lo agotado no se sugiere (Milka Toffee sin stock)', tienda._saboresPara([catalogo[6]], 3).map(p => p.id), []);
  tienda.set({ carrito: { 10: { ...catalogo[9], qty: 1 } } });
  t.eq('el gemelo de lo que ya está en el carrito no se sugiere', tienda._saboresPara([catalogo[9]], 3).map(p => p.id), []);
  tienda.set({ carrito: { 1: { ...catalogo[0], qty: 1 } }, vip: new Set(['1', '3']) });
  t.eq('en un link VIP solo se sugiere lo elegido', tienda._saboresPara([catalogo[0]], 3).map(p => p.id), [3]);
  tienda.set({ vip: null });
  t.eq('máximo pedido', tienda._saboresPara([catalogo[3]], 1).length, 1);
  return t.result();
}
module.exports = { run, _motor: motor, _tienda: tienda };
