// 🤖🏷️ v5.02 — EL BOT CON OFERTAS. Las funciones REALES del bot (menú, carrito, cierre por SMS y pedido por teléfono)
// contra un catálogo con oferta vigente, oferta vencida, oferta "más cara que la lista" y pack por umbral. Lo que se
// protege: que el bot cobre EXACTAMENTE lo mismo que la tienda, que muestre las ofertas, y que sin ofertas no cambie nada.
// Nada escribe: el cierre va en modo prueba y el pedido por teléfono en seco (si algo intentara guardar, la prueba explota).
const fs = require('fs');
const path = require('path');
const { suite } = require('./_helpers');
const TS = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'functions', 'api', 'index.ts'), 'utf8');
function fnDe(src, nombre) {
  const m = src.match(new RegExp('(?:async\\s+)?function\\s+' + nombre + '\\s*\\('));
  if (!m) throw new Error('no encontré ' + nombre);
  let i = src.indexOf('{', m.index + m[0].length), depth = 0;
  for (; i < src.length; i++) { const c = src[i]; if (c === '{') depth++; else if (c === '}') { depth--; if (!depth) { i++; break; } } }
  return src.slice(m.index, i) + '\n';
}
function constDe(src, nombre) {
  const ini = src.indexOf('const ' + nombre + ' = ');
  if (ini === -1) throw new Error('no encontré ' + nombre);
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
const sinTipos = (code) => code.replace(/\)\s*:\s*Promise<[^>]+>\s*\{/g, ') {').replace(/:\s*(any|string|number|boolean)(\[\])?(?=\s*[,)=;{])/g, '');
const codigo = 'let HOY = "2026-09-23";\nconst _hoyISO_AR = () => HOY;\nconst escrituras = [];\n' +
  'const botGuardarSesion = async () => {};\nlet PRODS = [];\nconst botLeerProductos = async () => PRODS;\n' +
  'const insertarVentaAtomica = async (f) => { escrituras.push(f); throw new Error("el modo prueba NO puede escribir"); };\n' +
  'const normTxt = (t) => String(t || "").toLowerCase().normalize("NFD").replace(/[\\u0300-\\u036f]/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\\s+/g, " ").trim();\n' +
  sinTipos(constDe(TS, 'botMiles') + constDe(TS, 'botMoney') + constDe(TS, 'botCorto') + fnDe(TS, '_fechaOfertaISO') + fnDe(TS, 'precioMinoristaHoy') +
    constDe(TS, 'CAT_OFERTAS') + constDe(TS, 'precioBot') + fnDe(TS, 'botPackActivo') + constDe(TS, 'botEnOferta') + fnDe(TS, 'botEtiquetaPrecio') +
    fnDe(TS, 'botCategorias') + fnDe(TS, 'botMenuCategorias') + fnDe(TS, 'botListarCategoria') + constDe(TS, 'botNombreItem') + fnDe(TS, 'botAgregar') +
    fnDe(TS, 'botVerCarrito') + fnDe(TS, 'botConfirmar') + fnDe(TS, 'matchProductoVoz') + fnDe(TS, 'registrarPedidoVoz')) +
  '\nreturn { precioBot, botCategorias, botMenuCategorias, botListarCategoria, botAgregar, botVerCarrito, botConfirmar, registrarPedidoVoz, CAT_OFERTAS, escrituras, setProds: p => { PRODS = p; }, setHoy: h => { HOY = h; } };';
const B = new Function(codigo)();

// Como los arma botLeerProductos: campos del bot + los crudos de oferta y pack.
const P = (id, nombre, min, cat, extra = {}) => ({ id: String(id), nombre, desc: '', precioMin: min, stock: 20, categoria: cat, dueno: 'Jony', moneda: '$', descBot: '', precio_min: min, precio_oferta: 0, fecha_oferta: '', cant_pack: 0, precio_pack: 0, ...extra });
const CAT = [
  P(1, 'Chocolate Elite', 12000, 'Chocolate', { precio_oferta: 9000, fecha_oferta: '30/09/2026' }),      // oferta vigente
  P(2, 'Bon O Bon', 5000, 'Chocolate', { precio_oferta: 3000, fecha_oferta: '10/09/2026' }),            // oferta VENCIDA
  P(3, 'Pitzujim Maní', 10000, 'Pitzujim', { cant_pack: 3, precio_pack: 8000 }),                         // pack: llevando 3+
  P(4, 'Klik', 7000, 'Chocolate', { precio_oferta: 7500 }),                                              // "oferta" más cara: no cuenta
  P(5, 'Bamba', 4000, 'Varios'),                                                                          // sin nada
];

async function run() {
  const t = suite();
  B.setProds(CAT);
  const p = id => CAT.find(x => x.id === String(id));

  // ── El precio: la misma cuenta que la tienda ──
  t.eq('oferta vigente: cobra la oferta (9.000, no 12.000)', B.precioBot(p(1), 1), 9000);
  t.eq('oferta vencida el 10/09: vuelve al precio de lista', B.precioBot(p(2), 1), 5000);
  t.eq('una "oferta" más cara que la lista no cuenta', B.precioBot(p(4), 1), 7000);
  t.eq('pack: con 2 unidades, precio normal', B.precioBot(p(3), 2), 10000);
  t.eq('pack: con 3 unidades, cada una a 8.000', B.precioBot(p(3), 3), 8000);
  t.eq('sin oferta ni pack: igual que siempre', B.precioBot(p(5), 7), 4000);
  B.setHoy('2026-10-01');
  t.eq('la oferta vence al final del día: el 01/10 ya no aplica', B.precioBot(p(1), 1), 12000);
  B.setHoy('2026-09-23');

  // ── El menú: las ofertas se ven ──
  const cats = B.botCategorias(CAT);
  t.eq('con ofertas, "🔥 Ofertas" es la primera categoría', cats[0], B.CAT_OFERTAS);
  t.ok('el menú numerado la muestra primera (1- 🔥 Ofertas)', B.botMenuCategorias(CAT).includes('1- 🔥 Ofertas'));
  const of = B.botListarCategoria(CAT, B.CAT_OFERTAS);
  t.ok('la lista de ofertas trae lo que está más barato hoy (Elite y el pack de Pitzujim)', of.includes('Chocolate Elite') && of.includes('Pitzujim Maní'));
  t.ok('y NO lo vencido ni la "oferta" más cara', !of.includes('Bon O Bon') && !of.includes('Klik'));
  const choco = B.botListarCategoria(CAT, 'Chocolate');
  t.ok('Elite se lista con 🔥, su precio de hoy y el de antes', choco.includes('$ 9.000 🔥 (antes $ 12.000)'));
  t.ok('Bon O Bon (vencida) se lista a su precio normal, sin 🔥', /Bon O Bon\s+\$ 5\.000\n/.test(choco));
  t.ok('el pack se anuncia: "llevando 3 o más: $ 8.000 c/u"', B.botListarCategoria(CAT, 'Pitzujim').includes('llevando 3 o más: $ 8.000 c/u'));
  const sinOf = CAT.map(x => ({ ...x, precio_oferta: 0, cant_pack: 0, precio_pack: 0 }));
  t.ok('sin ninguna oferta, el menú queda como siempre (sin la categoría 🔥)', !B.botCategorias(sinOf).includes(B.CAT_OFERTAS) && B.botListarCategoria(sinOf, 'Chocolate').includes('Chocolate Elite  $ 12.000\n'));

  // ── El carrito ──
  const s = { telefono: '1100000000', carrito: {}, nombre: 'Ana', historial: [] };
  let r = await B.botAgregar(s, CAT, '1', 2);
  t.ok('agregar Elite: 2 × 9.000 = $ 18.000', r.includes('2x Chocolate Elite = $ 18.000'));
  r = await B.botAgregar(s, CAT, '3', 2);
  t.ok('con 2 Pitzujim le avisa que llevando 3 le sale más barato', r.includes('Llevando 3 o más, cada uno sale $ 8.000'));
  r = await B.botAgregar(s, CAT, '3', 1);
  t.ok('al llegar a 3, cobra el pack: 3 × 8.000 = $ 24.000 🔥', r.includes('3x Pitzujim Maní = $ 24.000') && r.includes('precio de pack'));
  await B.botAgregar(s, CAT, '2', 1);
  const ver = B.botVerCarrito(CAT, s.carrito);
  t.ok('VER: el total con ofertas y pack (18.000 + 24.000 + 5.000 = $ 47.000)', ver.includes('TOTAL: $ 47.000'));
  t.ok('VER marca con 🔥 lo que va rebajado', /Elite = \$ 18\.000 🔥/.test(ver) && /Pitzujim Maní = \$ 24\.000 🔥/.test(ver) && !/Bon O Bon = \$ 5\.000 🔥/.test(ver));

  // ── El cierre (modo prueba: no escribe nada) ──
  const conf = await B.botConfirmar(s, CAT, '1100000000', true);
  t.ok('LISTO: el total que confirma es el mismo ($ 47.000)', conf.includes('Total $ 47.000'));
  t.eq('en modo prueba no se escribe NADA', B.escrituras.length, 0);

  // ── El pedido por teléfono (Shuki), en seco ──
  const v = await B.registrarPedidoVoz(JSON.stringify([{ codigo: '1', cantidad: 1 }, { nombre: 'pitzujim mani', cantidad: 4 }, { codigo: '5', cantidad: 2 }]), 'Ana', '', '1100000000', true);
  t.eq('por teléfono también: 9.000 + 4×8.000 + 2×4.000 = $ 49.000', v.total, 49000);
  t.ok('y cada renglón dice el precio que se cobra', v.lineas.some(l => l.includes('1x Chocolate Elite — $ 9.000 c/u')) && v.lineas.some(l => l.includes('4x Pitzujim Maní — $ 8.000 c/u = $ 32.000')));
  t.eq('en seco no se escribe nada', B.escrituras.length, 0);
  return t.result();
}
module.exports = { run };
