// 👁️ v4.81 — "ver más": vistas de producto, quitados, promos, compartir, aviso, scroll y catálogos VIP.
// Corre la analitica() REAL del motor contra tráfico armado a mano.
const fs = require('fs');
const path = require('path');
const { suite } = require('./_helpers');
const SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'functions', 'api', 'index.ts'), 'utf8');
function fnReal(nombre) {
  const re = new RegExp('(?:async\\s+)?function\\s+' + nombre + '\\s*\\(');
  const m = SRC.match(re);
  if (!m) throw new Error('no encontré ' + nombre);
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

const hoyBA = fechaAhora().slice(0, 10);
const [dd, mm, yy] = hoyBA.split('/');
const dia = n => { const d = new Date(Date.UTC(+yy, +mm - 1, +dd - n)); const p = x => String(x).padStart(2, '0'); return p(d.getUTCDate()) + '/' + p(d.getUTCMonth() + 1) + '/' + d.getUTCFullYear(); };
const ev = (vid, evento, fecha, extra = {}) => ({ fecha, vid, pagina: 'tienda', evento, origen: 'directo', dispositivo: 'celular', ciudad: 'CABA', pais: 'Argentina', nombre: '', telefono: '', detalle: '', carrito: '', total: 0, ...extra });
const NOMBRE_LARGO = 'Chocolate Elite · Blanco con galletitas - Ugiot (100g)';   // > 40 letras

async function run() {
  const t = suite();
  const productos = [
    { id: '1', nombre: 'Klik', stock: 10, activo: true, dueno: 'Jony', moneda: '$' },
    { id: '2', nombre: 'Bamba', stock: 5, activo: true, dueno: 'Jony', moneda: '$' },
    { id: '3', nombre: 'Escondido', stock: 7, activo: true, dueno: 'Jony', moneda: '$' },
    { id: '4', nombre: 'Agotado', stock: 0, activo: true, dueno: 'Jony', moneda: '$' },
    { id: '5', nombre: NOMBRE_LARGO, stock: 3, activo: true, dueno: 'Jony', moneda: '$' },
  ];
  const vistas = arr => JSON.stringify({ v: arr.map(n => ({ i: 'x', n: n.substring(0, 40) })) });
  const rows = [
    ev('v_a', 'visita', dia(0) + ' 10:00', { detalle: JSON.stringify({ tz: 'America/Argentina/Buenos_Aires', vip: 'tokabc' }) }),
    ev('v_a', 'vistas', dia(0) + ' 10:01', { detalle: vistas(['Klik', 'Bamba', NOMBRE_LARGO]) }),
    ev('v_a', 'carrito', dia(0) + ' 10:02', { detalle: 'Klik', carrito: '[{"n":"Klik","q":1,"p":1000}]', total: 1000 }),
    ev('v_a', 'promo', dia(0) + ' 10:02', { detalle: 'oferta · Klik' }),
    ev('v_a', 'quitar', dia(0) + ' 10:03', { detalle: 'Klik', total: 0 }),
    ev('v_a', 'compartir', dia(0) + ' 10:04', { detalle: 'Bamba' }),
    ev('v_a', 'aviso', dia(0) + ' 10:04'),
    ev('v_a', 'salida', dia(0) + ' 10:05', { detalle: JSON.stringify({ seg: 300, int: 4, prod: 2, sc: 95, vp: 3 }) }),
    ev('v_b', 'visita', dia(0) + ' 11:00', { detalle: JSON.stringify({ tz: 'America/Argentina/Buenos_Aires', vip: 'tokabc' }) }),
    ev('v_b', 'vistas', dia(0) + ' 11:01', { detalle: vistas(['Bamba']) }),
    ev('v_b', 'carrito', dia(0) + ' 11:02', { detalle: NOMBRE_LARGO, carrito: '[{"n":"Chocolate Elite · Blanco con galletitas","q":1,"p":9000}]', total: 9000 }),
    ev('v_b', 'promo', dia(0) + ' 11:02', { detalle: 'pack · ' + NOMBRE_LARGO }),
    ev('v_b', 'salida', dia(0) + ' 11:05', { detalle: JSON.stringify({ seg: 200, int: 2, prod: 1, sc: 40, vp: 1 }) }),
    ev('v_c', 'visita', dia(0) + ' 12:00', { detalle: JSON.stringify({ tz: 'America/Argentina/Buenos_Aires' }) }),
  ];
  const vipCatalogos = [
    { token: 'tokabc', nombre: 'David Cohen', canal: 'mayorista', creado: dia(3) + ' 09:00' },
    { token: 'toknunca', nombre: 'Sarah G', canal: 'minorista', creado: dia(5) + ' 09:00' },
    { token: 'tokreciente', nombre: 'Recién mandado', canal: 'minorista', creado: dia(0) + ' 08:00' },
    { token: 'tokviejo', nombre: 'Del año pasado', canal: 'minorista', creado: '10/06/2026 09:00' },   // anterior a la medición
  ];
  const d = analitica(rows, 7, [], [], productos, null, { vipCatalogos, vipDesde: Date.UTC(2026, 6, 1), vipTotales: { tokviejo: { aperturas: 3, vids: { v_z: 1 }, ultima: '01/09/2026 10:00', ultimaTs: 0 } } });
  const vm = d.verMas;
  t.eq('se contaron los lotes de vistas', vm.eventos, 2);
  const klik = d.deseoVsVenta.find(x => x.nombre === 'Klik');
  t.eq('Klik: 1 persona lo vio, 1 lo agregó, 1 lo sacó', [klik.personasVieron, klik.deseado, klik.quitado], [1, 1, 1]);
  const largo = d.deseoVsVenta.find(x => x.nombre === NOMBRE_LARGO);
  t.eq('el nombre largo (>40) cruza vistas con carrito igual (recorte a 40)', [largo.vistos, largo.personasVieron], [1, 1]);
  t.eq('Bamba: lo vieron 2 personas y nadie lo agarró → "los ven y no los agarran", con stock', vm.vistosSinCarrito.map(x => [x.nombre, x.personas, x.stock]), [['Bamba', 2, 5]]);
  t.eq('Escondido (stock 7) nunca estuvo a la vista → "nadie llega a verlos"; Agotado no cuenta (stock 0)', vm.nuncaVistos.map(x => x.nombre), ['Escondido']);
  t.eq('lo que sacan del carrito', vm.quitados, [{ nombre: 'Klik', veces: 1 }]);
  t.eq('promos: 1 con oferta (Klik), 1 como pack', [vm.promos.oferta.veces, vm.promos.oferta.top[0].nombre, vm.promos.pack.veces], [1, 'Klik', 1]);
  t.eq('compartidos', vm.compartidos, [{ nombre: 'Bamba', n: 1 }]);
  t.eq('toques al aviso: 1 vez, 1 persona', vm.avisoClics, { veces: 1, personas: 1 });
  t.eq('scroll: promedio (95+40)/2, 1 de 2 llegó al final', [vm.scroll.n, vm.scroll.promedio, vm.scroll.alFinal, vm.scroll.pctAlFinal], [2, 68, 1, 50]);
  const vipDavid = d.vipAbiertos.find(c => c.token === 'tokabc');
  t.eq('VIP de David: abierto 2 veces por 2 aparatos', [vipDavid.aperturas, vipDavid.personas, vipDavid.cliente], [2, 2, 'David Cohen']);
  t.eq('VIP de Sarah: nunca abierto', d.vipAbiertos.find(c => c.token === 'toknunca').aperturas, 0);
  t.ok('el abierto va primero', d.vipAbiertos[0].token === 'tokabc');
  const accVip = d.acciones.find(a => a.id === 'vip-sin-abrir');
  t.ok('acción: catálogo VIP sin abrir hace más de 2 días (Sarah sí, el de hoy no, el viejo no es medible)', accVip && accVip.n === 1 && accVip.detalle.includes('Sarah'));
  const viejo = d.vipAbiertos.find(c => c.token === 'tokviejo');
  t.eq('catálogo anterior al 22/09: no medible, pero trae sus aperturas históricas', [viejo.medible, viejo.aperturas, viejo.aperturasTotal], [false, 0, 3]);
  const sinVistas = analitica(rows.filter(r => r.evento !== 'vistas'), 7, [], [], productos, null, {});
  t.eq('sin lotes de vistas, "nadie llega a verlos" es null (no se acusa sin datos)', sinVistas.verMas.nuncaVistos, null);
  // Acción "los ven y no los agarran" pide 5 personas: con 2 no salta.
  t.ok('con 2 personas no salta la acción de "ven y no agarran"', !d.acciones.some(a => a.id === 'ven-no-agarran'));
  const muchos = rows.concat(['v_d', 'v_e', 'v_f'].map(v => ev(v, 'vistas', dia(0) + ' 13:00', { detalle: vistas(['Bamba']) })));
  t.ok('con 5 personas sí salta, y nombra a Bamba', (analitica(muchos, 7, [], [], productos, null, {}).acciones.find(a => a.id === 'ven-no-agarran') || {}).detalle?.includes('Bamba (5 personas)'));
  return t.result();
}
module.exports = { run };
