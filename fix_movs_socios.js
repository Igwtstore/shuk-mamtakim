// ============================================================================
//  FIX movs_socios — el backup del 30/06 subió el PROCESADO (getMovsSocios), que
//  mezcla movimientos manuales + envíos DERIVADOS (🛵). Los envíos ya viven en la
//  tabla `envios` → contarlos también en movs_socios = doble conteo (bug del saldo).
//  Deja en movs_socios SOLO los movimientos manuales genuinos (espejo de MovsSocios).
//  Uso:  SB_KEY=<secret> node fix_movs_socios.js
// ============================================================================
const SB_URL = 'https://soarkknjewgcewryxqac.supabase.co';
const SB_KEY = process.env.SB_KEY;
const SB_ANON = process.env.SB_ANON || 'sb_publishable_aAZNID-NdaGERYQWe9Uk6w_rmlYSCj2';
const GAS_URL = 'https://script.google.com/macros/s/AKfycbxO71AD5tBy1KpWCP0K9-uBEZEc7Qv1ehMv3PA3zDQwngwj7XHMLgIY6M7vWosr7-nc/exec';
if (!SB_KEY) { console.error('❌ Falta SB_KEY.'); process.exit(1); }
const num = v => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };

(async () => {
  const email = 'qa_fix_' + Date.now() + '@shuk.local', pass = 'Qa!' + Math.random().toString(36).slice(2) + 'X9';
  const cr = await fetch(SB_URL + '/auth/v1/admin/users', { method: 'POST', headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: pass, email_confirm: true }) });
  const cru = await cr.json(); if (!cr.ok) { console.error('❌ ' + JSON.stringify(cru).slice(0, 200)); process.exit(1); }
  const tempUserId = cru.id;
  const si = await fetch(SB_URL + '/auth/v1/token?grant_type=password', { method: 'POST', headers: { apikey: SB_ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: pass }) });
  const tok = (await si.json()).access_token;

  try {
    const r = await fetch(GAS_URL + '?accion=getMovsSocios&token=' + encodeURIComponent(tok));
    const g = await r.json();
    // Manuales genuinos = todos los movimientos que NO son envíos derivados (🛵 Envío #N).
    const manuales = (g.movimientos || []).filter(m => !(m.desc || '').toString().startsWith('🛵 Envío'));
    console.log('Movimientos manuales genuinos: ' + manuales.length + ' (envíos derivados excluidos)');
    console.log('  manualARS reportado por Google: ' + (g.manualARS || 0) + '  ·  enviosARS: ' + (g.enviosARS || 0));

    // Limpiar y recargar movs_socios solo con los manuales.
    await fetch(SB_URL + '/rest/v1/movs_socios?id=gte.0', { method: 'DELETE', headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY, Prefer: 'return=minimal' } });
    if (manuales.length) {
      const filas = manuales.map(m => ({ fecha: m.fecha || null, descripcion: m.desc || null, monto_ars: num(m.montoARS), monto_usd: num(m.montoUSD) }));
      const ins = await fetch(SB_URL + '/rest/v1/movs_socios', { method: 'POST', headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY, 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify(filas) });
      console.log(ins.ok ? '  ✓ movs_socios recargada con ' + filas.length + ' manuales' : '  ✗ ' + ins.status + ' ' + (await ins.text()).slice(0, 200));
    } else {
      console.log('  ✓ movs_socios queda VACÍA (no hay movimientos manuales; el 4.640 era el envío #27).');
    }
    console.log('\n✅ Fix aplicado. Corré el comparador maestro para confirmar.');
  } finally {
    await fetch(SB_URL + '/auth/v1/admin/users/' + tempUserId, { method: 'DELETE', headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY } }).then(() => console.log('🧹 usuario QA temporal borrado.')).catch(() => {});
  }
})().catch(e => { console.error('FALLO:', e.message); process.exit(1); });
