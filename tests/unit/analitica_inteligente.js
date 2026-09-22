// 🧠 v4.83 — cohortes, plata por canal, proyección, mayoristas dormidos, termómetro y mapa de calor,
// con la analitica() REAL del motor.
const fs = require('fs');
const path = require('path');
const { suite } = require('./_helpers');
const SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'functions', 'api', 'index.ts'), 'utf8');
function fnReal(nombre) {
  const re = new RegExp('(?:async\\s+)?function\\s+' + nombre + '\\s*\\(');
  const m = SRC.match(re); if (!m) throw new Error('no encontré ' + nombre);
  let i = SRC.indexOf('{', m.index + m[0].length), depth = 0;
  for (; i < SRC.length; i++) { const c = SRC[i]; if (c === '{') depth++; else if (c === '}') { depth--; if (!depth) { i++; break; } } }
  return SRC.slice(m.index, i)
    .replace(/\)\s*:\s*(number \| null|any\[\]|any|string|boolean)\s*\{/, ') {')
    .replace(/:\s*Record<[^>]+>/g, '')
    .replace(/(\w+)\s*:\s*(?:string|number|boolean|any)(\[\])?(?=\s*[,)=])/g, '$1')
    .replace(/const (\w+)\s*:\s*any(\[\])?\s*=/g, 'const $1 =')
    .replace(/\(([a-z]\w*)\s*:\s*any\)/g, '($1)')
    .replace(/\((\w+)\s*:\s*any,\s*(\w+)\s*:\s*any\)/g, '($1, $2)')
    .replace(/\s+as\s+(any|number|string|boolean)\b/g, '')
    .replace(/(\w+)!\./g, '$1.')
    .replace(/(\w+)!\[/g, '$1[')
    .replace(/\)!\./g, ').');
}
const codigo = 'const esJSON = x => (x || \'\').charCodeAt(0) === 123;\n' + fnReal('tsDeFecha') + '\n' + fnReal('leerVistas') + '\n' + fnReal('fechaAhora') + '\n' + fnReal('hoyVsSemana') + '\n' + fnReal('analitica') + '\nreturn { analitica, fechaAhora };';
const { analitica, fechaAhora } = new Function(codigo)();
const hoyBA = fechaAhora().slice(0, 10), horaBA = +fechaAhora().slice(11, 13);
const [dd, mm, yy] = hoyBA.split('/');
const dia = n => { const d = new Date(Date.UTC(+yy, +mm - 1, +dd - n)); const p = x => String(x).padStart(2, '0'); return p(d.getUTCDate()) + '/' + p(d.getUTCMonth() + 1) + '/' + d.getUTCFullYear(); };
const ev = (vid, evento, fecha, extra = {}) => ({ fecha, vid, pagina: 'tienda', evento, origen: 'directo', dispositivo: 'celular', ciudad: 'CABA', pais: 'Argentina', nombre: '', telefono: '', detalle: '', carrito: '', total: 0, ...extra });

async function run() {
  const t = suite();
  const rows = [
    // Ana llegó hace 20 días por WhatsApp, volvió y compró hace 18
    ev('v_ana', 'visita', dia(20) + ' 10:00', { origen: 'whatsapp' }), ev('v_ana', 'visita', dia(18) + ' 11:00', { origen: 'whatsapp' }), ev('v_ana', 'pedido', dia(18) + ' 11:10', { origen: 'whatsapp', nombre: 'Ana', total: 30000 }),
    // Beto llegó hace 20 días por Instagram y nunca volvió
    ev('v_beto', 'visita', dia(20) + ' 12:00', { origen: 'instagram' }),
    // Caro: hace 2 días, checkout con teléfono, no pidió (caliente)
    ev('v_caro', 'visita', dia(2) + ' 15:00'), ev('v_caro', 'carrito', dia(2) + ' 15:05', { detalle: 'Klik' }), ev('v_caro', 'checkout', dia(2) + ' 15:10', { telefono: '1155551234', nombre: 'Caro' }),
    // Dani: hace 1 día, solo miró; robot marcado por el servidor
    ev('v_dani', 'visita', dia(1) + ' 03:00', { detalle: JSON.stringify({ tz: 'UTC', bot: 1 }) }),
    // Eli: ya venía de antes (hace 50 días) → NO es nuevo en la ventana
    ev('v_eli', 'visita', dia(50) + ' 10:00'), ev('v_eli', 'visita', dia(3) + ' 10:00'),
  ];
  const ventas = [
    { id: 1, fecha: dia(18) + ' 11:10', cliente: 'Ana', estado: 'entregado', total_ars: 30000, total_usd: 0, vid: 'v_ana', stock_updates: '', tipo_cambio: 1500 },
    { id: 2, fecha: dia(45) + ' 11:10', cliente: 'Mayorista Viejo', estado: 'entregado', total_ars: 90000, total_usd: 0, vid: '', stock_updates: '', tipo_cambio: 1500 },
    { id: 3, fecha: dia(10) + ' 11:10', cliente: 'Mayorista Fresco', estado: 'entregado', total_ars: 50000, total_usd: 0, vid: '', stock_updates: '', tipo_cambio: 1500 },
    { id: 4, fecha: dia(60) + ' 11:10', cliente: 'Mayorista Cancelado', estado: 'cancelado', total_ars: 10000, total_usd: 0, vid: '', stock_updates: '', tipo_cambio: 1500 },
  ];
  const clientes = [
    { nombre: 'Mayorista Viejo', telefono: '1144440000', tipo: 'Mayorista' }, { nombre: 'Mayorista Fresco', telefono: '1144441111', tipo: 'Mayorista' },
    { nombre: 'Mayorista Cancelado', telefono: '1144442222', tipo: 'Mayorista' }, { nombre: 'Ana', telefono: '1144443333', tipo: 'Minorista' },
  ];
  const d = analitica(rows, 30, ventas, clientes, [], null, {});
  // 🔁 cohortes
  const semAna = d.cohortes.find(c => c.nuevos >= 2) || d.cohortes[0];
  t.ok('cohortes: Ana y Beto llegaron la misma semana → 2 nuevos, 1 volvió (50 %), 1 compró (50 %)', d.cohortes.some(c => c.nuevos === 2 && c.volvieron === 1 && c.compraron === 1 && c.pctVolvieron === 50));
  t.ok('cohortes: Eli venía de antes → no es nuevo (no hay cohorte de 3)', !d.cohortes.some(c => c.nuevos >= 3) && d.cohortes.reduce((a, c) => a + c.nuevos, 0) === 4);
  // 💰 plata por canal
  const wa = d.conversionPorOrigen.find(x => x.origen === 'whatsapp');
  t.eq('plata por canal: WhatsApp trajo la venta de Ana ($ 30.000, 1 venta)', [wa.plataARS, wa.ventas, wa.pedidos], [30000, 1, 1]);
  t.eq('plata por canal: Instagram no trajo plata', d.conversionPorOrigen.find(x => x.origen === 'instagram').plataARS, 0);
  // 📈 proyección
  t.ok('proyección: existe, con pedidos y visitas proyectados ≥ los que van', d.proyeccion && d.proyeccion.pedidosProy >= d.proyeccion.pedidos && d.proyeccion.visitasProy >= d.proyeccion.visitas && d.proyeccion.cubierta === true);
  // 😴 dormidos
  t.eq('dormidos: solo el mayorista con última compra hace 45 días (el fresco no, el cancelado no cuenta como compra)', d.dormidos.map(c => c.nombre), ['Mayorista Viejo']);
  t.ok('dormidos: trae teléfono y días', d.dormidos[0].telefono === '1144440000' && d.dormidos[0].diasSinComprar >= 45);
  // 🌡️ termómetro
  const vis = Object.fromEntries(d.visitantes.map(v => [v.vid, v]));
  t.ok('termómetro: Caro (checkout + carrito + tel) es la más caliente', vis.v_caro.calor >= 70 && vis.v_caro.calor > vis.v_beto.calor);
  t.eq('termómetro: Ana ya compró → 0 (ya llegó)', vis.v_ana.calor, 0);
  t.ok('termómetro: Beto (solo miró) es tibio o frío', vis.v_beto.calor < 40);
  // 🤖 robot marcado por el servidor
  t.ok('robot: la marca del servidor (bot:1) alcanza para señalarlo', vis.v_dani.perfil.pareceRobot === true && vis.v_dani.perfil.señales.some(x => x.includes('programa automático')));
  // 🗓️ heatmap
  t.ok('heatmap: 7 días × 24 horas y suma = visitas del período', d.heatmap.length === 7 && d.heatmap.every(f => f.length === 24) && d.heatmap.flat().reduce((a, b) => a + b, 0) === d.resumen.visitas);
  return t.result();
}
module.exports = { run };
