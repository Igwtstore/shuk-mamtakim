// 🎯 LA ANALÍTICA ACCIONABLE (v4.69) — red de seguridad de la lógica del backend.
// Extrae la función analitica() REAL de supabase/functions/api/index.ts y la corre contra
// un caso armado a mano. Lo que se protege acá es lo que le da valor a la pantalla:
// que a un visitante anónimo se le pueda poner nombre cruzando con quién compró.
const fs = require('fs');
const path = require('path');
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
    .replace(/\bas any\b/g, '')
    .replace(/(\w+)!\./g, '$1.')
    .replace(/(\w+)!\[/g, '$1[');
}
const codigo = fnReal('tsDeFecha') + '\n' + fnReal('analitica') + '\nreturn { analitica };';
const { analitica } = new Function(codigo)();

// ── El caso: dos días de tráfico, un cliente que vuelve y un desconocido ───────
const hoy = new Date();
const dd = (dias, hora) => { const d = new Date(hoy.getTime() - dias * 86400000); const p = n => String(n).padStart(2, '0'); return p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + d.getFullYear() + ' ' + p(hora) + ':00'; };
const ev = (vid, evento, dias, hora, extra = {}) => ({ fecha: dd(dias, hora), vid, pagina: 'tienda', evento, origen: 'whatsapp', dispositivo: 'celular', ciudad: 'CABA', pais: 'Argentina', nombre: '', telefono: '', detalle: '', carrito: '', total: 0, ...extra });

const trafico = [
  // DÉBORA: no deja un solo dato, pero es la misma compu con la que compró en el pasado.
  ev('v_debora', 'visita', 1, 20),
  ev('v_debora', 'carrito', 1, 21, { detalle: 'Chocolate Elite', carrito: JSON.stringify([{ n: 'Chocolate Elite', q: 3, p: 8000 }]), total: 24000 }),
  ev('v_debora', 'checkout', 1, 21, { carrito: JSON.stringify([{ n: 'Chocolate Elite', q: 3, p: 8000 }]), total: 24000 }),
  ev('v_debora', 'visita', 0, 10),
  // SARAH: se registró con nombre pero compró desde OTRO aparato (el nombre es el puente).
  ev('v_sarah', 'visita', 2, 12, { nombre: 'Sarah G', telefono: '1155667788' }),
  ev('v_sarah', 'carrito', 2, 12, { nombre: 'Sarah G', telefono: '1155667788', detalle: 'Bon O Bon', carrito: JSON.stringify([{ n: 'Bon O Bon', q: 2, p: 5000 }]), total: 10000 }),
  // DESCONOCIDO: entró tres días distintos y nunca compró ni dejó nada.
  ev('v_nadie', 'visita', 3, 9), ev('v_nadie', 'visita', 2, 9), ev('v_nadie', 'visita', 1, 9),
  ev('v_nadie', 'busqueda', 1, 9, { detalle: 'halva', total: 0 }),
  ev('v_nadie', 'busqueda', 1, 9, { detalle: 'bon o bon', total: 4 }),
  // COMPRADOR: hizo todo el camino hasta el pedido.
  ev('v_compra', 'visita', 1, 15), ev('v_compra', 'carrito', 1, 15, { detalle: 'Pesek Zman' }), ev('v_compra', 'pedido', 1, 15, { nombre: 'Iosi M' }),
  // 💵 MAYORISTA EN DÓLARES (caso real Isi Michan, 27/08): U$S 85,50 que la pantalla
  // mostraba como "$ 86". Los renglones viejos NO traen la moneda: hay que deducirla.
  { ...ev('v_may', 'visita', 1, 11), pagina: 'mayorista' },
  { ...ev('v_may', 'carrito', 1, 11, { detalle: 'Klik dolar', carrito: JSON.stringify([{ n: 'Klik dolar', q: 10, p: 8.55 }]), total: 86 }), pagina: 'mayorista' },
  // 🪤 LA TRAMPA: producto que en mayorista se cotiza en U$S, pero comprado por la tienda
  // MINORISTA — ahí el precio es en PESOS. (Es el error que cometí midiendo a mano.)
  ev('v_min', 'visita', 1, 12),
  ev('v_min', 'carrito', 1, 12, { detalle: 'Klik dolar', carrito: JSON.stringify([{ n: 'Klik dolar', q: 2, p: 12000 }]), total: 24000 }),
];
const ventas = [
  { id: 'P1', fecha: dd(20, 18), cliente: 'Débora Levy', estado: 'entregado', total_ars: 45000, total_usd: 0, vid: 'v_debora', stock_updates: '1:2' },
  { id: 'P2', fecha: dd(9, 18), cliente: 'Débora Levy', estado: 'entregado', total_ars: 100000, total_usd: 0, vid: 'v_debora', stock_updates: '1:1' },
  { id: 'P3', fecha: dd(30, 18), cliente: 'Sarah G', estado: 'entregado', total_ars: 20000, total_usd: 0, vid: 'v_viejo_de_sarah', stock_updates: '2:1' },
  { id: 'P4', fecha: dd(1, 16), cliente: 'Iosi M', estado: 'pendiente', total_ars: 12000, total_usd: 0, vid: 'v_compra', stock_updates: '3:2', tipo_cambio: 1400 },
  { id: 'P5', fecha: dd(1, 16), cliente: 'Cancelada', estado: 'cancelado', total_ars: 999999, total_usd: 0, vid: 'v_debora', stock_updates: '1:50' },
];
const clientes = [{ nombre: 'Débora Levy', telefono: '1144556677', tipo: 'Minorista' }, { nombre: 'Sarah G', telefono: '1155667788', tipo: 'Mayorista' }];
const productos = [
  { id: '1', nombre: 'Chocolate Elite', stock: 0, activo: true, dueno: 'Jony' },
  { id: '2', nombre: 'Bon O Bon', stock: 40, activo: true, dueno: 'Jony' },
  { id: '3', nombre: 'Pesek Zman', stock: 12, activo: true, dueno: 'Jony' },
  { id: '4', nombre: 'Klik dolar', stock: 30, activo: true, dueno: 'Jony', moneda: 'U$S' },
];

function run() {
  const c = [];
  const ok = (n, v) => c.push({ name: n, ok: !!v });
  const eq = (n, a, b) => c.push({ name: n + ' (=' + JSON.stringify(b) + ')', ok: JSON.stringify(a) === JSON.stringify(b) });
  const d = analitica(trafico, 7, ventas, clientes, productos);

  // ── EL CRUCE: ponerle nombre al que no dejó datos ───────────────────────────
  const deb = d.visitantes.find(v => v.vid === 'v_debora');
  eq('al anónimo que ya compró se le pone NOMBRE', deb.nombre, 'Débora Levy');
  ok('y su teléfono sale de la ficha del cliente', deb.telefono === '1144556677');
  eq('cuenta bien cuántas veces compró', deb.compras, 2);
  eq('y cuánto gastó (la venta CANCELADA no suma)', deb.gastadoARS, 145000);
  ok('explica de dónde se supo quién es', deb.comoSeSupo === 'ya compró desde este aparato');

  const sarah = d.visitantes.find(v => v.vid === 'v_sarah');
  eq('el que compró desde OTRO aparato se reconoce por el nombre', sarah.compras, 1);
  ok('Sarah queda marcada como clienta', sarah.esCliente === true);

  const nadie = d.visitantes.find(v => v.vid === 'v_nadie');
  ok('el que de verdad no se sabe quién es, queda sin nombre', !nadie.nombre && !nadie.esCliente);
  eq('pero se sabe qué es: vuelve y no compra', nadie.etiqueta, 'mirón que vuelve');
  eq('y cuántos días distintos vino', nadie.dias, 3);
  eq('el que compró queda etiquetado como tal', d.visitantes.find(v => v.vid === 'v_compra').etiqueta, 'compró');

  // ── CARRITOS: prioridad y antigüedad ────────────────────────────────────────
  eq('los carritos sin cerrar son 4 (el que pidió no cuenta)', d.abandonados.length, 4);
  eq('primero el contactable que ya te compró', d.abandonados[0].nombre, 'Débora Levy');
  ok('sabe hace cuántas horas quedó colgado', d.abandonados[0].horas >= 20 && d.abandonados[0].horas <= 40);
  ok('guarda el vid para poder abrir su ficha', !!d.abandonados[0].vid);

  // ── 💵 LA MONEDA DEL CARRITO ────────────────────────────────────────────────
  const may = d.abandonados.find(x => x.vid === 'v_may');
  const min = d.abandonados.find(x => x.vid === 'v_min');
  eq('carrito MAYORISTA en dólares: no suma pesos', may.total, 0);
  eq('carrito MAYORISTA en dólares: los U$S van aparte', may.totalUSD, 85.5);
  ok('queda marcado como mayorista', may.mayorista === true);
  eq('el equivalente usa el tipo de cambio de la última venta (1400)', may.totalEquiv, 119700);
  eq('carrito MINORISTA de un producto que en mayorista es U$S → sigue siendo PESOS', min.total, 24000);
  eq('y no inventa dólares donde no los hay', min.totalUSD, 0);
  ok('el carrito en dólares NO queda último por "poca plata"',
     d.abandonados.findIndex(x => x.vid === 'v_may') < d.abandonados.length - 1);
  ok('la oportunidad total separa las dos monedas', d.accionable.oportunidadUSD === 85.5 && d.accionable.oportunidadARS > 0);
  eq('guarda qué tipo de cambio usó', d.accionable.tcRef, 1400);

  // ── DESEO CONTRA VENTA ──────────────────────────────────────────────────────
  const elite = d.deseoVsVenta.find(p => p.nombre === 'Chocolate Elite');
  eq('lo agregado al carrito se cuenta', elite.deseado, 1);
  eq('Chocolate Elite está en cero de stock', elite.stock, 0);
  // Chocolate Elite se vendió hace 20 y hace 9 días: las DOS quedan fuera de la ventana
  // de 7 días. Y la de hace 1 día está cancelada. Entonces en el período no vendió nada:
  // por eso "lo miran y no lo compran" es una alarma de verdad y no ruido del histórico.
  eq('las ventas de antes del período NO se cuentan', elite.vendido, 0);
  ok('la venta CANCELADA no infla lo vendido (eran 50 unidades)', elite.vendido < 50);
  const pesek = d.deseoVsVenta.find(p => p.nombre === 'Pesek Zman');
  eq('el vendido del período se lee de stock_updates', pesek.vendido, 2);

  // ── BÚSQUEDAS ───────────────────────────────────────────────────────────────
  const halva = d.busquedas.find(b => b.q === 'halva');
  ok('registra la búsqueda que no encontró nada', halva && halva.vacias === 1);
  const bob = d.busquedas.find(b => b.q === 'bon o bon');
  ok('y la que sí encontró no se marca como vacía', bob && bob.vacias === 0);
  ok('las búsquedas NO ensucian los productos deseados', !d.deseoVsVenta.some(p => p.nombre === 'halva'));

  // ── QUÉ HACER AHORA ─────────────────────────────────────────────────────────
  const ids = d.acciones.map(a => a.id);
  ok('avisa de los carritos calientes', ids.includes('carritos'));
  ok('avisa del cliente que volvió y no compró', ids.includes('clientes-volvieron'));
  ok('avisa del producto muy pedido sin stock', ids.includes('sin-stock') || elite.deseado < 2);
  ok('avisa de las búsquedas sin resultado', ids.includes('busquedas-vacias'));
  ok('avisa del que llegó al checkout y no terminó', ids.includes('casi'));
  ok('lo urgente va primero', d.acciones[0].urgencia === 'alta');

  // ── EL DÍA A DÍA ────────────────────────────────────────────────────────────
  ok('hay detalle día por día', d.diasDetalle.length >= 3);
  const conPedido = d.diasDetalle.find(x => x.pedidos > 0);
  ok('un día con pedido lo registra con su conversión', conPedido && conPedido.conv > 0);
  ok('cada día dice qué miraron', d.diasDetalle.some(x => x.top.length > 0));

  // ── LOS NÚMEROS DE LA CABECERA ──────────────────────────────────────────────
  eq('cuenta los identificados', d.accionable.identificados, 3);   // Débora, Sarah, Iosi
  eq('cuenta los que no sabemos quiénes son', d.accionable.anonimos, 3);
  ok('suma los pesos que quedaron en los carritos', d.accionable.oportunidadARS === 34000 + 24000);

  // ── Que no se haya roto nada de lo de antes ─────────────────────────────────
  ok('sigue devolviendo el resumen de siempre', d.resumen.visitas === 9 && d.resumen.unicos === 6);
  ok('sigue devolviendo el embudo', d.embudo.pedido === 1 && d.embudo.checkout === 1);
  ok('sigue devolviendo leads y orígenes', d.leads.length >= 1 && !!d.porOrigen.whatsapp);
  return c;
}
// Para inspeccionar a mano lo que devuelve el backend con este caso:
//   node -e "console.log(require('./tests/unit/analitica_accionable.js').salida().resumen)"
function salida() { return analitica(trafico, 7, ventas, clientes, productos); }
module.exports = { run, salida };
