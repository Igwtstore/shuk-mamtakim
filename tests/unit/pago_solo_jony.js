// 🚫 v5.10 — «A Myri nada: si sobra, sobra, queda en JONY». Un pago a cuenta NUEVO es todo de Jony (lo que cubre
// y lo que sobra); editarlo tampoco le pasa nada a Miri; los pagos VIEJOS se cuentan igual que siempre (historial).
// Corre la cobertura REAL del motor (coberturaPagos de index.ts) + chequea que cada puerta use soloJony.
const fs = require('fs');
const path = require('path');
const { stripTypeScriptTypes } = require('node:module');
const { suite } = require('./_helpers');
const TS = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'functions', 'api', 'index.ts'), 'utf8');
function bloque(nombre) {
  const m = TS.match(new RegExp('(?:async\\s+)?function\\s+' + nombre + '\\s*\\(')); if (!m) throw new Error('no encontré ' + nombre);
  let i = TS.indexOf('{', m.index + m[0].length), depth = 0;
  for (; i < TS.length; i++) { const c = TS[i]; if (c === '{') depth++; else if (c === '}') { depth--; if (!depth) { i++; break; } } }
  return TS.slice(m.index, i);
}
const accion = a => { const i = TS.indexOf("if (accion === '" + a + "')"); if (i < 0) throw new Error('no encontré la acción ' + a); const j = TS.indexOf("if (accion === '", i + 20); return TS.slice(i, j < 0 ? TS.length : j); };
const codigo = TS.match(/const CAJAS_ARS = [^;]*;/)[0] + '\n' + TS.slice(TS.indexOf('const _fparMin = '), TS.indexOf('function coberturaPagos')) + bloque('coberturaPagos') + '\n' + bloque('soloJony');
const { coberturaPagos, soloJony } = new Function(stripTypeScriptTypes(codigo) + '\nreturn { coberturaPagos, soloJony };')();

function run() {
  const t = suite();
  // Un cliente como el de verdad: debe U$S 90,21 a Jony y U$S 14 de golosinas viejas de Miri (#42)
  const venta = { id: 42, n_venta: 42, cliente: 'Cliente', fecha: '30/06/2026 18:39', estado: 'entregado', usd_jony: 90.21, usd_myri: 14, ars_jony: 0, ars_myri: 0, caja_jony: 'CTA_CTE_USD', caja_myri: 'CTA_CTE_USD', tramos: '' };
  const r0 = soloJony(0, 120);
  t.eq('soloJony: todo el pago es de Jony, en las dos monedas', [soloJony(50000, 0).pitzARS, r0.pitzUSD], [50000, 120]);
  // pago NUEVO de U$S 120 (más de lo que debe): cubre a Jony y el sobrante NO va a Miri
  const pNuevo = { id: 900, cliente: 'Cliente', pedido_id: '', fecha: '25/09/2026 10:00', monto_ars: 0, monto_usd: 120, monto_pitz: 0, monto_pitz_usd: r0.pitzUSD, caja: 'ETF_USD_JONY', reparto: 'solojony' };
  const c1 = coberturaPagos([venta], [pNuevo], 0)['42'];
  t.eq('pago nuevo: la deuda de Jony queda en 0', Math.round(c1.jU * 100) / 100, 0);
  t.eq('pago nuevo: a Miri no le llega nada (sus U$S 14 viejos siguen igual, para la conciliación)', Math.round(c1.mU * 100) / 100, 14);
  // el mismo pago, VIEJO (sin reparto): se cuenta como siempre — golosinas U$S primero (historial intacto)
  const pViejo = Object.assign({}, pNuevo, { reparto: null, monto_pitz_usd: 0 });
  const c2 = coberturaPagos([venta], [pViejo], 0)['42'];
  t.eq('pago viejo: se cuenta como siempre (golosinas en U$S primero)', [Math.round(c2.mU * 100) / 100, Math.round(c2.jU * 100) / 100], [0, 0]);
  // atado al pedido: igual
  const pAtado = Object.assign({}, pNuevo, { pedido_id: '42', monto_usd: 100, monto_pitz_usd: 100 });
  const c3 = coberturaPagos([venta], [pAtado], 0)['42'];
  t.eq('pago nuevo atado al pedido: tampoco le toca nada a Miri', [Math.round(c3.jU * 100) / 100, c3.mU], [0, 14]);

  // ── cada puerta ──
  const reg = accion('registrarPagoCuenta');
  t.ok('pago a cuenta nuevo: usa soloJony (salvo la devolución «forzado»)', /_forz\s*\?[\s\S]*calcularRepartoPitz[\s\S]*:\s*soloJony\(/.test(reg));
  t.ok("…y se guarda como 'solojony' (si no, la cobertura lo leería con el orden viejo)", reg.includes("reparto: _forz ? 'forzado' : 'solojony'"));
  const fr = accion('registrarPagoFraccionado');
  t.ok('pago fraccionado: todo a la caja de Jony', fr.includes('soloJony(mA, mU)') && !fr.includes('calcularRepartoPitz('));
  const ed = accion('editarPagoCuenta');
  t.ok("editar un pago nacido 'solojony': sigue todo de Jony", ed.includes("=== 'solojony'") && /_soloJ \? soloJony\(mA, mU\)/.test(ed) && ed.includes("reparto: _soloJ ? 'solojony'"));
  t.ok('editar un pago viejo: sigue con el reparto de siempre (historial)', /: await calcularRepartoPitz\(\(pgE\.cliente/.test(ed));
  return t.result();
}
module.exports = { run };
