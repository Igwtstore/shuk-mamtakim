// ============================================================================
//  MIGRACIÓN Fase 2 — hojas del saldo de socios: Envios, LiquidacionSocios, Cortes.
//  Lee de Google en vivo (con sesión QA temporal) y sube a Supabase. Idempotente
//  (borra y recarga cada tabla). Requiere antes: supabase_schema_socios.sql.
//
//  Uso:  SB_KEY=<secret> node migrar_hojas_faltantes.js
// ============================================================================
const SB_URL = 'https://soarkknjewgcewryxqac.supabase.co';
const SB_KEY = process.env.SB_KEY;
const SB_ANON = process.env.SB_ANON || 'sb_publishable_aAZNID-NdaGERYQWe9Uk6w_rmlYSCj2';
const GAS_URL = 'https://script.google.com/macros/s/AKfycbxO71AD5tBy1KpWCP0K9-uBEZEc7Qv1ehMv3PA3zDQwngwj7XHMLgIY6M7vWosr7-nc/exec';
if (!SB_KEY) { console.error('❌ Falta SB_KEY.'); process.exit(1); }
const num = v => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };

async function sbDeleteAll(tabla) {
  await fetch(SB_URL + '/rest/v1/' + tabla + '?id=gte.0', { method: 'DELETE', headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY, Prefer: 'return=minimal' } });
}
async function sbInsert(tabla, filas) {
  if (!filas.length) { console.log('  · ' + tabla + ': (sin datos)'); return; }
  const r = await fetch(SB_URL + '/rest/v1/' + tabla, { method: 'POST', headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY, 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify(filas) });
  if (r.ok) console.log('  ✓ ' + tabla + ': ' + filas.length + ' filas'); else console.log('  ✗ ' + tabla + ': ' + r.status + ' ' + (await r.text()).slice(0, 200));
}
async function gasGet(accion, tok) {
  const r = await fetch(GAS_URL + '?accion=' + accion + '&token=' + encodeURIComponent(tok));
  const j = await r.json();
  if (j && j.error) throw new Error(accion + ': ' + j.error);
  return j;
}

(async () => {
  // Sesión QA temporal para leer Google
  const email = 'qa_hojas_' + Date.now() + '@shuk.local', pass = 'Qa!' + Math.random().toString(36).slice(2) + 'X9';
  const cr = await fetch(SB_URL + '/auth/v1/admin/users', { method: 'POST', headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: pass, email_confirm: true }) });
  const cru = await cr.json();
  if (!cr.ok) { console.error('❌ crear sesión QA: ' + JSON.stringify(cru).slice(0, 200)); process.exit(1); }
  const tempUserId = cru.id;
  const si = await fetch(SB_URL + '/auth/v1/token?grant_type=password', { method: 'POST', headers: { apikey: SB_ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: pass }) });
  const tok = (await si.json()).access_token;
  console.log('Migrando hojas de socios (Envios, LiquidacionSocios, Cortes)…\n');

  try {
    const [env, liq, cortes] = await Promise.all([gasGet('getCajaEnvios', tok), gasGet('getLiquidaciones', tok), gasGet('getCortes', tok)]);

    await sbDeleteAll('envios');
    await sbInsert('envios', (env.movimientos || []).map(m => ({
      fecha: m.fecha || null, venta_id: (m.ventaId || '').toString(), n_venta: (m.nVenta || '').toString(),
      cliente: m.cliente || null, dueno: m.dueno || 'Jony', cobrado: num(m.cobrado), costo: num(m.costo),
      quien_pago: m.quienPago || null, nota: m.nota || null
    })));

    await sbDeleteAll('liquidacion_socios');
    await sbInsert('liquidacion_socios', (liq.movimientos || []).map(m => ({
      fecha: m.fecha || null, monto_ars: num(m.montoARS), monto_usd: num(m.montoUSD), nota: m.nota || null
    })));

    await sbDeleteAll('cortes');
    await sbInsert('cortes', (Array.isArray(cortes) ? cortes : []).map(c => ({
      fecha: c.fecha || null, corte_id: (c.corteId || '').toString(), ganancia_ars: num(c.gananciaARS), diezmo_ars: num(c.diezmoARS),
      ganancia_usd: num(c.gananciaUSD), diezmo_usd: num(c.diezmoUSD), pagado_myri_ars: num(c.pagadoMyriARS),
      pagado_myri_usd: num(c.pagadoMyriUSD), ventas: num(c.ventas), nota: c.nota || null
    })));

    console.log('\n✅ Hojas de socios migradas. Verificá con el comparador maestro.');
  } finally {
    await fetch(SB_URL + '/auth/v1/admin/users/' + tempUserId, { method: 'DELETE', headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY } }).then(() => console.log('🧹 usuario QA temporal borrado.')).catch(() => {});
  }
})().catch(e => { console.error('FALLO:', e.message); process.exit(1); });
