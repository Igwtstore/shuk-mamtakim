// 🆔 v5.07 — EN EL MOTOR, MIRI YA NO EXISTE: una venta nueva (o la edición de un pedido que no le daba nada) no le puede
// dar plata; un producto nuevo es siempre de Jony y el dueño no se cambia editando. Funciones REALES de index.ts +
// chequeo de que cada puerta las use (si alguien las saca, esto se pone rojo).
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
    .replace(/(\w+)\??\s*:\s*(?:string|number|boolean|any)(\[\])?(?=\s*[,)=])/g, '$1')
    .replace(/const (\w+)\s*:\s*any(\[\])?\s*=/g, 'const $1 =')
    .replace(/\(([a-z]\w*)\s*:\s*any\)/g, '($1)');
}
const { sinPlataMiri, duenoVenta } = new Function(bloque('sinPlataMiri') + '\n' + bloque('duenoVenta') + '\nreturn { sinPlataMiri, duenoVenta };')();
// el cuerpo de una acción del motor (desde su "if (accion === 'x')" hasta la próxima acción)
const accion = a => { const i = TS.indexOf("if (accion === '" + a + "')"); if (i < 0) throw new Error('no encontré la acción ' + a); const j = TS.indexOf("if (accion === '", i + 20); return TS.slice(i, j < 0 ? TS.length : j); };

function run() {
  const t = suite();
  // ── la cuenta ──
  const venta = sinPlataMiri({ total_ars: 23999, total_usd: 6.5, ars_jony: 12000, ars_myri: 11999, usd_myri: 6.5, usd_jony: 0, comi_ars: 1800, comi_usd: 0.98 });
  t.eq('venta con un renglón "de Miri": todo a Jony, en la misma moneda', [venta.ars_jony, venta.usd_jony, venta.ars_myri, venta.usd_myri], [23999, 6.5, 0, 0]);
  t.eq('…y sin comisión', [venta.comi_ars, venta.comi_usd], [0, 0]);
  t.eq('…y el total no se toca', [venta.total_ars, venta.total_usd], [23999, 6.5]);
  const limpia = sinPlataMiri({ ars_jony: 5000, usd_jony: 12.34, ars_myri: 0, usd_myri: 0, comi_ars: 0, comi_usd: 0 });
  t.eq('venta ya toda de Jony: queda igual', [limpia.ars_jony, limpia.usd_jony], [5000, 12.34]);
  // edición que no manda todas las partes: la parte de Jony que no vino sale de la venta como estaba
  const patch = sinPlataMiri({ usd_myri: 17.85 }, { ars_jony: 71000, usd_jony: 780.34, ars_myri: 0, usd_myri: 0 });
  t.eq('edición parcial: suma sobre lo que Jony ya tenía (U$S 780,34 + 17,85)', [patch.usd_jony, patch.usd_myri, 'ars_jony' in patch], [798.19, 0, false]);
  t.eq('dueño del envío: empate / pedido en $ 0 → Jony (antes Miri)', [duenoVenta(0, 0, 0, 0), duenoVenta(100, 0, 100, 0)], ['Jony', 'Jony']);
  t.eq('dueño del envío: los casos de siempre no cambian', [duenoVenta(100, 0, 0, 0), duenoVenta(0, 0, 50, 0), duenoVenta(10, 0, 90, 0)], ['Jony', 'Miri', 'Miri']);

  // ── cada puerta la usa ──
  t.ok('venta nueva (tienda y manual): pasa por sinPlataMiri antes de guardarse', /sinPlataMiri\(fila\)[\s\S]*insertarVentaAtomica\(fila\)/.test(accion('venta')));
  t.ok('venta nueva: el envío va al dueño de la venta YA corregida', accion('venta').includes('duenoVenta(fila.ars_jony, fila.usd_jony, fila.ars_myri, fila.usd_myri)'));
  t.ok('editar pedido: si no le daba nada a Miri, no empieza a darle', /if \(!tienePlataMiri\(v\)[^\n]*sinPlataMiri\(patch, v\)/.test(accion('actualizarPedido')));
  t.ok('levantar pedido cancelado: ídem', accion('levantarPedido').includes('if (!tienePlataMiri(vLv)) sinPlataMiri(patchLv, vLv)'));
  const alta = accion('agregarProducto');
  t.ok("alta de producto: dueno: 'Jony' fijo (lo que mande el navegador no cuenta)", alta.includes("dueno: 'Jony'") && !alta.includes("P(body, 'dueno')"));
  const edit = accion('editarProducto'), lote = accion('editarProductosLote');
  const mapaDe = s => (s.match(/const map: any = \{[^}]*\}/) || [''])[0];
  t.ok('editar ficha: el dueño no está entre los campos que se guardan', mapaDe(edit) && !/dueno/.test(mapaDe(edit)));
  t.ok('planilla masiva: tampoco', mapaDe(lote) && !/dueno/.test(mapaDe(lote)));
  t.ok("un envío nuevo sin dueño es de Jony (no 'Miri')", !/dueno: patch\.dueno \|\| 'Miri'/.test(TS) && /dueno: patch\.dueno \|\| 'Jony'/.test(TS));
  return t.result();
}
module.exports = { run };
