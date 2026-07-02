// ============================================================================
//  RE-MIGRACIÓN de Candy desde Google EN VIVO (no del backup) — 2026-07-01.
//  El backup del 30/06 quedó viejo (Meir siguió vendiendo). Trae lo ACTUAL de
//  Google y reemplaza candy_ventas, candy_deudores, candy_deposito. Idempotente.
//  Filtra datos de prueba (__TEST__). Uso: SB_KEY=<secret> node remigrar_candy.js
// ============================================================================
const SB_URL = 'https://soarkknjewgcewryxqac.supabase.co';
const SB_KEY = process.env.SB_KEY;
const SB_ANON = process.env.SB_ANON || 'sb_publishable_aAZNID-NdaGERYQWe9Uk6w_rmlYSCj2';
const GAS_URL = 'https://script.google.com/macros/s/AKfycbxO71AD5tBy1KpWCP0K9-uBEZEc7Qv1ehMv3PA3zDQwngwj7XHMLgIY6M7vWosr7-nc/exec';
if (!SB_KEY) { console.error('❌ Falta SB_KEY.'); process.exit(1); }
const HIJOS = ['Meir', 'Iosi', 'Pa'];
const esTest = s => /__TEST/i.test(JSON.stringify(s || ''));
const num = v => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };

async function sbDel(tabla, filtro) { await fetch(SB_URL + '/rest/v1/' + tabla + '?' + filtro, { method: 'DELETE', headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY, Prefer: 'return=minimal' } }); }
async function sbIns(tabla, filas) {
  if (!filas.length) { console.log('  · ' + tabla + ': (sin datos)'); return; }
  let ok = 0;
  for (let i = 0; i < filas.length; i += 200) {
    const lote = filas.slice(i, i + 200);
    const r = await fetch(SB_URL + '/rest/v1/' + tabla, { method: 'POST', headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY, 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify(lote) });
    if (r.ok) ok += lote.length; else { console.log('  ✗ ' + tabla + ': ' + r.status + ' ' + (await r.text()).slice(0, 200)); return; }
  }
  console.log('  ✓ ' + tabla + ': ' + ok + ' filas');
}
async function gasGet(accion, tok, extra) {
  const r = await fetch(GAS_URL + '?accion=' + accion + '&token=' + encodeURIComponent(tok) + (extra || ''));
  const j = await r.json(); if (j && j.error) throw new Error(accion + ': ' + j.error); return j;
}

(async () => {
  const email = 'qa_rem_' + Date.now() + '@shuk.local', pass = 'Qa!' + Math.random().toString(36).slice(2) + 'X9';
  const cr = await fetch(SB_URL + '/auth/v1/admin/users', { method: 'POST', headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: pass, email_confirm: true }) });
  const cru = await cr.json(); if (!cr.ok) { console.error('❌ ' + JSON.stringify(cru).slice(0, 200)); process.exit(1); }
  const tempUserId = cru.id;
  const si = await fetch(SB_URL + '/auth/v1/token?grant_type=password', { method: 'POST', headers: { apikey: SB_ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: pass }) });
  const tok = (await si.json()).access_token;
  console.log('Re-migrando Candy desde Google EN VIVO…\n');

  try {
    // VENTAS: ventasPeriodo por chico
    let ventas = [];
    for (const h of HIJOS) {
      (await gasGet('ventasPeriodo', tok, '&hijo=' + h)).filter(v => !esTest(v)).forEach(v => ventas.push({
        fecha: (v.fecha || '') + (v.hora ? ' ' + v.hora : ''), hijo: v.hijo || h, producto: v.producto || null, codigo: (v.codigo || '').toString(),
        cantidad: parseInt(v.cantidad) || 0, precio: num(v.precio), total: num(v.total), cliente: v.cliente || null,
        es_debe: (v.esDebe || '').toString(), pago_parcial: num(v.pagoParcial), saldo_pendiente: num(v.saldoPendiente), metodo_pago: (v.metodoPago || '').toString()
      }));
    }
    await sbDel('candy_ventas', 'id=gte.0');
    await sbIns('candy_ventas', ventas);

    // DEUDORES: consultarDeudores por chico
    let deud = [];
    for (const h of HIJOS) {
      (await gasGet('consultarDeudores', tok, '&hijo=' + h)).filter(d => !esTest(d)).forEach(d => deud.push({ hijo: h, cliente: d.cliente || null, saldo: num(d.saldo) }));
    }
    await sbDel('candy_deudores', 'id=gte.0');
    await sbIns('candy_deudores', deud);

    // DEPÓSITO: getDepositoHijos. En Google puede haber el mismo código en 2 filas
    // (ajustes +/−); la tabla nueva usa código único → se SUMAN las cantidades (stock real).
    const depMap = {};
    (await gasGet('getDepositoHijos', tok)).filter(d => !esTest(d)).forEach(d => {
      const c = String(d.codigo);
      if (!depMap[c]) depMap[c] = { codigo: c, nombre: d.producto || null, cantidad: 0 };
      depMap[c].cantidad += num(d.cantidad);
      if (d.producto) depMap[c].nombre = d.producto;
    });
    await sbDel('candy_deposito', 'codigo=not.is.null');
    await sbIns('candy_deposito', Object.values(depMap));

    console.log('\n✅ Candy re-sincronizado con Google en vivo.');
  } finally {
    await fetch(SB_URL + '/auth/v1/admin/users/' + tempUserId, { method: 'DELETE', headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY } }).then(() => console.log('🧹 usuario QA temporal borrado.')).catch(() => {});
  }
})().catch(e => { console.error('FALLO:', e.message); process.exit(1); });
