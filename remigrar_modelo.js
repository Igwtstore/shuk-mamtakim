// ============================================================================
//  RE-MIGRACIÓN de los campos del "reparar modelo": visible_cat + ofertas/packs
//  de Shuk (desde hoja Stock cruda) y candy_compras fila-por-item (desde ComprasHijos).
//  Requiere supabase_reparar_modelo.sql ejecutado. Lee de Google con exportarHoja.
//  Uso:  SB_KEY=<secret> node remigrar_modelo.js
// ============================================================================
const SB_URL = 'https://soarkknjewgcewryxqac.supabase.co';
const SB_KEY = process.env.SB_KEY;
const SB_ANON = process.env.SB_ANON || 'sb_publishable_aAZNID-NdaGERYQWe9Uk6w_rmlYSCj2';
const GAS_URL = 'https://script.google.com/macros/s/AKfycbxO71AD5tBy1KpWCP0K9-uBEZEc7Qv1ehMv3PA3zDQwngwj7XHMLgIY6M7vWosr7-nc/exec';
if (!SB_KEY) { console.error('❌ Falta SB_KEY.'); process.exit(1); }
const num = v => { const n = parseFloat(String(v == null ? '' : v).replace(',', '.')); return isNaN(n) ? 0 : n; };
const txt = v => { const s = (v == null ? '' : v).toString().trim(); return s === '' ? null : s; };

async function gasHoja(hoja, tok) {
  const r = await fetch(GAS_URL + '?accion=exportarHoja&token=' + encodeURIComponent(tok) + '&hoja=' + hoja);
  const j = await r.json(); if (j.error) throw new Error(hoja + ': ' + j.error); return j;
}
async function sbPatch(tabla, filtro, patch) {
  const r = await fetch(SB_URL + '/rest/v1/' + tabla + '?' + filtro, { method: 'PATCH', headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY, 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify(patch) });
  if (!r.ok) throw new Error('patch ' + tabla + ' ' + r.status + ' ' + (await r.text()).slice(0, 150));
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
  const email = 'qa_rm_' + Date.now() + '@shuk.local', pass = 'Qa!' + Math.random().toString(36).slice(2) + 'X9';
  const cr = await fetch(SB_URL + '/auth/v1/admin/users', { method: 'POST', headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: pass, email_confirm: true }) });
  const cru = await cr.json(); if (!cr.ok) { console.error('❌ ' + JSON.stringify(cru).slice(0, 200)); process.exit(1); }
  const tempUserId = cru.id;
  const si = await fetch(SB_URL + '/auth/v1/token?grant_type=password', { method: 'POST', headers: { apikey: SB_ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: pass }) });
  const tok = (await si.json()).access_token;
  console.log('Re-migrando campos del reparar-modelo…\n');

  try {
    // ── SHUK: Stock cruda → visible_cat + ofertas/packs (por id). Índices 0-based del Sheet:
    //   0 id, 9 visible(col10=Ambos/Min/May), 10 precioOferta(col11), 11 fechaOferta(col12), 12 cantPack(col13), 13 precioPack(col14)
    const stock = await gasHoja('Stock', tok);
    let up = 0;
    for (const r of stock.filas) {
      const id = (r[0] || '').toString().trim(); if (!id) continue;
      await sbPatch('productos', 'id=eq.' + encodeURIComponent(id), {
        visible_cat: txt(r[9]) || 'Ambos',
        precio_oferta: num(r[10]), fecha_oferta: txt(r[11]),
        cant_pack: Math.round(num(r[12])), precio_pack: num(r[13]),
      });
      up++;
    }
    console.log('  ✓ productos Shuk actualizados (visible_cat + ofertas/packs): ' + up);

    // ── CANDY: ComprasHijos cruda (fila-por-item) → candy_compras
    //   0 CompraID,1 Fecha,2 ProveedorID,3 Proveedor,4 Codigo,5 Producto,6 Cantidad,7 CostoUnit,8 CostoTotal,9 RegistradoPor
    const compras = await gasHoja('ComprasHijos', tok);
    const filas = (compras.filas || []).filter(r => r[0]).map(r => ({
      compra_id: (r[0] || '').toString(), fecha: txt(r[1]), proveedor_id: txt(r[2]), proveedor: txt(r[3]),
      codigo: txt(r[4]), producto: txt(r[5]), cantidad: Math.round(num(r[6])), costo_unit: num(r[7]), costo_total: num(r[8]), registrado_por: txt(r[9]),
    }));
    await sbDel('candy_compras', 'id=gte.0');
    const n = await sbIns('candy_compras', filas);
    console.log('  ✓ candy_compras (fila-por-item): ' + n);

    console.log('\n✅ Reparación de modelo re-migrada.');
  } finally {
    await fetch(SB_URL + '/auth/v1/admin/users/' + tempUserId, { method: 'DELETE', headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY } }).then(() => console.log('🧹 usuario QA temporal borrado.')).catch(() => {});
  }
})().catch(e => { console.error('FALLO:', e.message); process.exit(1); });
