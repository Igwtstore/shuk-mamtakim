// ============================================================================
//  MIGRADOR de BandejaFotos + FlyersHijos → Supabase (bandeja_fotos, flyers_hijos).
//  Mismo patrón que migrar_universal.js (exportarHoja + sesión QA temporal).
//  Idempotente (borra+recarga). Uso: SB_KEY=<secret> node migrar_fotos_flyers.js
// ============================================================================
const SB_URL = 'https://soarkknjewgcewryxqac.supabase.co';
const SB_KEY = process.env.SB_KEY;
const SB_ANON = process.env.SB_ANON || 'sb_publishable_aAZNID-NdaGERYQWe9Uk6w_rmlYSCj2';
const GAS_URL = 'https://script.google.com/macros/s/AKfycbxO71AD5tBy1KpWCP0K9-uBEZEc7Qv1ehMv3PA3zDQwngwj7XHMLgIY6M7vWosr7-nc/exec';
if (!SB_KEY) { console.error('❌ Falta SB_KEY.'); process.exit(1); }
const txt = v => { const s = (v == null ? '' : v).toString().trim(); return s === '' ? null : s; };

const CONFIG = [
  { hoja: 'BandejaFotos', tabla: 'bandeja_fotos', del: 'id=neq.__x__', cols: [[0,'id'],[1,'fecha'],[2,'public_id'],[3,'nombre'],[4,'descripcion'],[5,'categoria'],[6,'estado']] },
  { hoja: 'FlyersHijos',  tabla: 'flyers_hijos',  del: 'id=neq.__x__', cols: [[0,'id'],[1,'fecha'],[2,'hijo'],[3,'url'],[4,'titulo'],[5,'codigos'],[6,'idea'],[7,'fondo_ia'],[8,'estado'],[9,'config']] },
];

async function gasHoja(hoja, tok) {
  const r = await fetch(GAS_URL + '?accion=exportarHoja&token=' + encodeURIComponent(tok) + '&hoja=' + hoja);
  const j = await r.json(); if (j.error) throw new Error(hoja + ': ' + j.error); return j;
}
async function sbDel(tabla, filtro) { await fetch(SB_URL + '/rest/v1/' + tabla + '?' + filtro, { method: 'DELETE', headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY, Prefer: 'return=minimal' } }); }
async function sbIns(tabla, filas) {
  if (!filas.length) return 0; let ok = 0;
  for (let i = 0; i < filas.length; i += 500) {
    const lote = filas.slice(i, i + 500);
    const r = await fetch(SB_URL + '/rest/v1/' + tabla, { method: 'POST', headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY, 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify(lote) });
    if (r.ok) ok += lote.length; else throw new Error(tabla + ' ' + r.status + ' ' + (await r.text()).slice(0, 200));
  }
  return ok;
}

(async () => {
  const email = 'qa_fotos_' + Date.now() + '@shuk.local', pass = 'Qa!' + Math.random().toString(36).slice(2) + 'X9';
  const cr = await fetch(SB_URL + '/auth/v1/admin/users', { method: 'POST', headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: pass, email_confirm: true }) });
  const cru = await cr.json(); if (!cr.ok) { console.error('❌ ' + JSON.stringify(cru).slice(0, 200)); process.exit(1); }
  const tempUserId = cru.id;
  const si = await fetch(SB_URL + '/auth/v1/token?grant_type=password', { method: 'POST', headers: { apikey: SB_ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: pass }) });
  const tok = (await si.json()).access_token;
  try {
    for (const c of CONFIG) {
      try {
        const { filas } = await gasHoja(c.hoja, tok);
        const rows = (filas || []).filter(row => row.some(v => v !== '' && v != null) && txt(row[0])).map(row => {
          const o = {}; c.cols.forEach(([i, name]) => o[name] = txt(row[i])); return o;
        });
        await sbDel(c.tabla, c.del);
        const n = await sbIns(c.tabla, rows);
        console.log('  ✓ ' + c.hoja.padEnd(14) + '→ ' + c.tabla.padEnd(16) + n + ' filas');
      } catch (e) { console.log('  ✗ ' + c.hoja.padEnd(14) + e.message); }
    }
  } finally {
    await fetch(SB_URL + '/auth/v1/admin/users/' + tempUserId, { method: 'DELETE', headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY } }).then(() => console.log('🧹 usuario QA temporal borrado.')).catch(() => {});
  }
})().catch(e => { console.error('FALLO:', e.message); process.exit(1); });
