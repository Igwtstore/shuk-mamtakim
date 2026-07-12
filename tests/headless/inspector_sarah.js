// INSPECTOR EN VIVO (solo lectura) — pago de Sarah Kantor #51
// Deuda por componente: $100.350 Pitzujim(J) · U$S 77,15 Pitzujim(J) · U$S 44 golosinas(M), comi U$S 6,60
// Vigila: pagos nuevos (id>102) + cambios en la venta P1783436978494. Emite una línea por hallazgo.
const { Client } = require('pg');
const VENTA = 'P1783436978494';
const COMP = { pitzA: 100350, pitzU: 77.15, golU: 44, golA: 0 };
let lastPago = 102, ventaPrev = null;
const f$ = n => '$ ' + Math.round(n).toLocaleString('es-AR');
const fU = n => 'U$S ' + (+n).toFixed(2);

async function conectar() {
  const c = new Client({ host: 'aws-1-us-east-2.pooler.supabase.com', port: 5432, user: 'postgres.soarkknjewgcewryxqac', password: 'G3b4JpxRgxW0Yvu0', database: 'postgres', ssl: { rejectUnauthorized: false } });
  // el pooler corta sockets ociosos: sin este handler, el 'error' asíncrono voltea el proceso
  c.on('error', () => {});
  await c.connect();
  return c;
}

async function tick(c) {
  // 1) pagos nuevos
  const pg = await c.query('SELECT * FROM pagos WHERE id > $1 ORDER BY id', [lastPago]);
  for (const p of pg.rows) {
    lastPago = Math.max(lastPago, parseInt(p.id));
    const mA = +p.monto_ars || 0, mU = +p.monto_usd || 0, pzA = +p.monto_pitz || 0, pzU = +p.monto_pitz_usd || 0;
    const golA = mA - pzA, golU = mU - pzU;
    const esSarah = /sarah/i.test(p.cliente || '') || p.pedido_id === VENTA;
    if (!esSarah) { console.log(`ℹ️ pago #${p.id} de OTRO cliente (${p.cliente}): ${f$(mA)} + ${fU(mU)} → ${p.caja}`); continue; }
    console.log(`💰 PAGO #${p.id} — ${p.cliente} → pedido ${p.pedido_id || '(general)'} · caja ${p.caja}${+p.tc > 0 ? ' · TC ' + p.tc : ''}${p.nota ? ' · nota: ' + p.nota : ''}`);
    console.log(`   Monto: ${f$(mA)} + ${fU(mU)} · Reparto guardado → Pitzujim(J): ${f$(pzA)} + ${fU(pzU)} | golosinas(M): ${f$(golA)} + ${fU(golU)}`);
    const checks = [];
    checks.push(pzA <= mA + 1 && pzU <= mU + 0.01 ? '✓ reparto ≤ monto' : '✗ REPARTO MAYOR AL MONTO');
    checks.push(pzA <= COMP.pitzA + 1 ? '✓ Pitz$ dentro de la deuda' : `✗ Pitz$ ${f$(pzA)} EXCEDE la deuda ${f$(COMP.pitzA)}`);
    checks.push(pzU <= COMP.pitzU + 0.01 ? '✓ PitzU$S dentro de la deuda' : `✗ PitzU$S ${fU(pzU)} EXCEDE ${fU(COMP.pitzU)}`);
    checks.push(golU <= COMP.golU + 0.01 ? '✓ golosinasU$S dentro de la deuda' : `✗ golosinasU$S ${fU(golU)} EXCEDE ${fU(COMP.golU)}`);
    if (golA > 1) checks.push(`✗ golosinas$ ${f$(golA)}: la deuda ARS de Miri es CERO`);
    if (/jony/i.test(p.caja || '') && (golU > 0.01 || golA > 1)) checks.push(`⚠️ ${fU(golU)}${golA > 1 ? ' + ' + f$(golA) : ''} de MIRI entró a caja de JONY → cuenta interna socios (Jony le debe a Miri; comisión 15% aparte)`);
    if (!/jony/i.test(p.caja || '') && (pzA > 1 || pzU > 0.01)) checks.push(`⚠️ plata de JONY entró a caja ${p.caja} → revisar circuito`);
    console.log('   ' + checks.join(' · '));
    // residual acumulado por componente (todos los pagos de la venta)
    const todos = await c.query('SELECT coalesce(sum(monto_ars),0) a, coalesce(sum(monto_usd),0) u, coalesce(sum(monto_pitz),0) pa, coalesce(sum(monto_pitz_usd),0) pu FROM pagos WHERE pedido_id = $1', [VENTA]);
    const t = todos.rows[0];
    const rPzA = COMP.pitzA - t.pa, rPzU = COMP.pitzU - t.pu, rGolU = COMP.golU - (t.u - t.pu);
    console.log(`   RESIDUAL esperado en la tarjeta → Pitz(J): ${f$(Math.max(0, rPzA))} + ${fU(Math.max(0, rPzU))} | golosinas(M): ${fU(Math.max(0, rGolU))} | TOTAL: ${f$(Math.max(0, rPzA))} + ${fU(Math.max(0, rPzU) + Math.max(0, rGolU))}`);
  }
  // 2) cambios en la venta #51
  const v = await c.query('SELECT estado, tramos, total_ars, total_usd, ars_jony, usd_jony, usd_myri, comi_usd, tipo_cambio FROM ventas WHERE id = $1', [VENTA]);
  const cur = JSON.stringify(v.rows[0]);
  if (ventaPrev === null) ventaPrev = cur;
  else if (cur !== ventaPrev) {
    console.log('📝 LA VENTA #51 CAMBIÓ:');
    const a = JSON.parse(ventaPrev), b = JSON.parse(cur);
    Object.keys(b).forEach(k => { if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) console.log(`   ${k}: ${a[k]} → ${b[k]}`); });
    ventaPrev = cur;
  }
}

(async () => {
  let c = await conectar();
  console.log('👁️ INSPECTOR PRENDIDO — Sarah #51: deuda ' + f$(COMP.pitzA) + ' Pitz(J) + ' + fU(COMP.pitzU) + ' Pitz(J) + ' + fU(COMP.golU) + ' golosinas(M). Esperando el pago…');
  // conexión NUEVA por tick: el pooler corta sockets ociosos y un socket muerto no debe
  // voltear la vigilancia (caída real 2026-07-12)
  try { await c.end(); } catch (e) {}
  while (true) {
    try { const cx = await conectar(); await tick(cx); await cx.end(); }
    catch (e) { console.log('⚠️ tick falló (' + e.message.slice(0, 60) + ') — reintento en 10s'); await new Promise(r => setTimeout(r, 5000)); }
    await new Promise(r => setTimeout(r, 5000));
  }
})().catch(e => { console.log('❌ INSPECTOR CAÍDO: ' + e.message); process.exit(1); });
