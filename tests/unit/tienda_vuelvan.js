// 🔁 v4.86 — Tanda 1 "Que vuelvan": pedidoHabitual(), productosQueVolvieron() y lo que mide la
// analitica() (lo de siempre, la encuesta, la acción de la lista de espera). Funciones REALES del motor.
const fs = require('fs');
const path = require('path');
const { suite } = require('./_helpers');
const TS = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'functions', 'api', 'index.ts'), 'utf8');
function bloque(nombre) {
  const re = new RegExp('(?:async\\s+)?function\\s+' + nombre + '\\s*\\(');
  const m = TS.match(re); if (!m) throw new Error('no encontré ' + nombre);
  let i = TS.indexOf('{', m.index + m[0].length), depth = 0;
  for (; i < TS.length; i++) { const c = TS[i]; if (c === '{') depth++; else if (c === '}') { depth--; if (!depth) { i++; break; } } }
  return TS.slice(m.index, i)
    .replace(/\)\s*:\s*(number \| null|any\[\]|any|string|boolean)\s*\{/, ') {')
    .replace(/:\s*Record<[^>]+>/g, '')
    .replace(/(\w+)\s*:\s*(?:string|number|boolean|any)(\[\])?(?=\s*[,)=])/g, '$1')
    .replace(/const (\w+)\s*:\s*any(\[\])?\s*=/g, 'const $1 =')
    .replace(/\(([a-z]\w*)\s*:\s*any\)/g, '($1)')
    .replace(/\((\w+)\s*:\s*any,\s*(\w+)\s*:\s*any\)/g, '($1, $2)')
    .replace(/\s+as\s+(any|number|string|boolean)\b/g, '')
    .replace(/(\w+)!\./g, '$1.').replace(/(\w+)!\[/g, '$1[').replace(/\)!\./g, ').');
}
const F = new Function('const esJSON = x => (x || \'\').charCodeAt(0) === 123;\n' + ['tsDeFecha', 'fechaAhora', 'hoyVsSemana', 'leerVistas', 'pedidoHabitual', 'productosQueVolvieron', 'analitica'].map(bloque).join('\n') + '\nreturn { pedidoHabitual, productosQueVolvieron, analitica, fechaAhora };')();

async function run() {
  const t = suite();
  // ── lo de siempre ──
  const ventas = [   // como llegan de la base: la más nueva primero
    { fecha: '20/09/2026 10:00', estado: 'pendiente', tipo: 'Minorista', stock_updates: '1:2,2:1,1:5' },   // el 1 repetido en el mismo pedido cuenta una vez
    { fecha: '09/09/2026 10:00', estado: 'entregado', tipo: 'Minorista', stock_updates: '1:3,3:2' },
    { fecha: '01/09/2026 10:00', estado: 'cancelado', tipo: 'Minorista', stock_updates: '9:1' },
    { fecha: '28/08/2026 10:00', estado: 'entregado', tipo: 'Minorista', stock_updates: '3:1,4:5' },
    { fecha: '20/08/2026 10:00', estado: 'entregado', tipo: 'Mayorista', stock_updates: '8:10' },
  ];
  const h = F.pedidoHabitual(ventas);
  t.eq('del último pedido entra todo, y de los anteriores lo que se repite (el 3 dos veces; el 4 una sola no)', h.items.map(x => x.id).sort(), ['1', '2', '3']);
  t.eq('la cantidad es la del pedido más reciente que lo tiene', h.items.map(x => [x.id, x.q]).sort(), [['1', 2], ['2', 1], ['3', 2]]);
  t.ok('lo cancelado y lo mayorista no cuentan', !h.items.some(x => x.id === '9' || x.id === '8'));
  t.eq('mira los 3 últimos pedidos minoristas válidos', [h.pedidos, h.ultima], [3, '20/09/2026 10:00']);
  t.eq('primero lo que más se repite', h.items[0].veces, 2);
  t.eq('sin pedidos: nada que ofrecer', F.pedidoHabitual([]).items, []);
  t.eq('solo pedidos cancelados: nada que ofrecer', F.pedidoHabitual([{ estado: 'cancelado', tipo: 'Minorista', stock_updates: '1:1' }]).items, []);

  // ── el avisame que se cumple ──
  const pend = [{ producto_id: 1, producto: 'Klik', estado: 'pendiente' }, { producto_id: '1', producto: 'Klik', estado: 'pendiente' }, { producto_id: 2, estado: 'pendiente' }, { producto_id: 3, estado: 'notificado' }, { producto_id: 4, estado: 'pendiente' }];
  const prods = [{ id: 1, nombre: 'Klik biscuit', stock: 5, activo: true }, { id: 2, nombre: 'Bamba', stock: 0 }, { id: 3, nombre: 'Elite', stock: 4 }, { id: 4, nombre: 'Pausado', stock: 9, activo: false }];
  t.eq('solo los que YA volvieron, con cuántas personas los esperan (sin notificados ni pausados)', F.productosQueVolvieron(pend, prods), [{ id: '1', nombre: 'Klik biscuit', stock: 5, esperan: 2 }]);

  // ── lo que mide la Analítica ──
  const hoy = F.fechaAhora().slice(0, 10);
  const ev = (vid, evento, hora, detalle = '') => ({ fecha: hoy + ' ' + hora, vid, pagina: 'tienda', evento, origen: 'directo', dispositivo: 'celular', ciudad: '', pais: '', nombre: '', telefono: '', detalle, carrito: '', total: 0 });
  const rows = [
    ev('v_a', 'visita', '00:01'), ev('v_a', 'recompra', '00:01', 'ofrecido · 3 items'), ev('v_a', 'recompra', '00:02', 'cargado · 3 items'), ev('v_a', 'pedido', '00:05'),
    ev('v_a', 'encuesta', '00:06', 'canal:whatsapp'), ev('v_a', 'encuesta', '00:06', 'push:si'),
    ev('v_b', 'visita', '00:01'), ev('v_b', 'recompra', '00:01', 'ofrecido · 2 items'), ev('v_b', 'recompra', '00:02', 'descartado'),
    ev('v_c', 'visita', '00:03'), ev('v_c', 'encuesta', '00:04', 'canal:instagram'), ev('v_d', 'encuesta', '00:04', 'canal:whatsapp'),
  ];
  const d = F.analitica(rows, 7, [], [], prods, null, { esperando: pend });
  t.eq('lo de siempre: 2 ofrecidos, 1 cargado, 1 lo cerró, y el que lo cargó pidió', d.recompra, { ofrecidos: 2, cargados: 1, descartados: 1, compraron: 1 });
  t.eq('encuesta: 2 por WhatsApp, 1 por Instagram, 1 aceptó avisos', [d.encuesta.canales.whatsapp, d.encuesta.canales.instagram, d.encuesta.respuestas, d.encuesta.pushSi], [2, 1, 3, 1]);
  const acc = d.acciones.find(a => a.id === 'esperan-stock');
  t.ok('Qué hacer: "2 personas esperan productos que ya volvieron", con el producto', acc && acc.n === 2 && acc.detalle.includes('Klik biscuit (2)') && acc.urgencia === 'alta');
  t.ok('sin lista de espera, no hay acción', !F.analitica(rows, 7, [], [], prods, null, {}).acciones.some(a => a.id === 'esperan-stock'));
  return t.result();
}
module.exports = { run };
