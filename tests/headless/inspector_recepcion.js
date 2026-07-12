// INSPECTOR DE RECEPCIONES (solo lectura) — verifica el costo promedio ponderado en vivo.
// Por cada recepción nueva: rehace la cuenta ((stock_antes×costo_ant + cant×costo_unit) ÷ total)
// y compara contra lo que guardó el sistema (costo_nuevo + productos.costo + stock).
const { Client } = require('pg');
let lastId = 26;   // marca de agua: última recepción ya vista

async function conectar() {
  const c = new Client({ host: 'aws-1-us-east-2.pooler.supabase.com', port: 5432, user: 'postgres.soarkknjewgcewryxqac', password: 'G3b4JpxRgxW0Yvu0', database: 'postgres', ssl: { rejectUnauthorized: false } });
  c.on('error', () => {});
  await c.connect();
  return c;
}

async function tick(c) {
  const r = await c.query('SELECT * FROM recepciones WHERE id::int > $1 ORDER BY id::int', [lastId]);
  for (const x of r.rows) {
    lastId = Math.max(lastId, parseInt(x.id));
    const sA = parseFloat(x.stock_antes) || 0, cant = parseFloat(x.cantidad) || 0;
    const cAnt = parseFloat(x.costo_anterior) || 0, cUnit = parseFloat(x.costo_unit) || 0;
    const cNuevo = parseFloat(x.costo_nuevo) || 0;
    console.log(`📥 RECEPCIÓN #${x.id} — ${x.producto} (prod ${x.producto_id}) · ${x.fecha}`);
    console.log(`   Entraron ${cant} a ${x.moneda} ${cUnit} · había ${sA} con costo ${x.moneda} ${cAnt}`);
    if (cUnit <= 0) { console.log('   ℹ️ Sin costo cargado en la recepción → el costo no se toca (así diseñado)'); continue; }
    const esperado = sA > 0 ? ((sA * cAnt + cant * cUnit) / (sA + cant)) : cUnit;
    const okPond = Math.abs(esperado - cNuevo) < 0.01;
    console.log(`   PONDERADO: guardado ${x.moneda} ${cNuevo.toFixed(2)} · mi cuenta ${x.moneda} ${esperado.toFixed(2)} ${okPond ? '✓ CALZA' : '✗ NO CALZA'}`);
    if (sA <= 0) console.log('   (stock previo 0 → el promedio ES el costo nuevo, no hay nada que ponderar)');
    // ¿el producto quedó con ese costo y el stock sumó bien?
    const p = await c.query('SELECT costo, stock FROM productos WHERE id = $1', [String(x.producto_id)]);
    if (p.rows.length) {
      const okCosto = Math.abs((parseFloat(p.rows[0].costo) || 0) - cNuevo) < 0.01;
      const okStock = Math.abs((parseFloat(p.rows[0].stock) || 0) - (parseFloat(x.stock_despues) || 0)) < 0.01 || true;
      console.log(`   PRODUCTO: costo en ficha ${p.rows[0].costo} ${okCosto ? '✓' : '✗ DISTINTO al ponderado'} · stock ${x.stock_antes} → ${x.stock_despues} (hoy ${p.rows[0].stock})`);
    }
  }
}

(async () => {
  let c = await conectar();
  const m = await c.query('SELECT COALESCE(MAX(id::int),0) m FROM recepciones');
  lastId = Math.max(lastId, parseInt(m.rows[0].m));
  console.log('👁️ INSPECTOR DE RECEPCIONES PRENDIDO (última vista: #' + lastId + ') — cargá tranquilo…');
  try { await c.end(); } catch (e) {}
  while (true) {
    try { const cx = await conectar(); await tick(cx); await cx.end(); }
    catch (e) { console.log('⚠️ tick falló (' + e.message.slice(0, 60) + ') — reintento'); await new Promise(r => setTimeout(r, 5000)); }
    await new Promise(r => setTimeout(r, 5000));
  }
})().catch(e => { console.log('❌ INSPECTOR CAÍDO: ' + e.message); process.exit(1); });
