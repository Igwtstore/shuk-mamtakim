// ============================================================================
//  MIGRADOR UNIVERSAL — lee cada hoja de Google con exportarHoja y la sube a su
//  tabla en Supabase (mapeo por índice de columna). Idempotente (borra+recarga).
//  Requiere: supabase_schema_resto.sql ejecutado. Uso: SB_KEY=<secret> node migrar_universal.js
// ============================================================================
const SB_URL = 'https://soarkknjewgcewryxqac.supabase.co';
const SB_KEY = process.env.SB_KEY;
const SB_ANON = process.env.SB_ANON || 'sb_publishable_aAZNID-NdaGERYQWe9Uk6w_rmlYSCj2';
const GAS_URL = 'https://script.google.com/macros/s/AKfycbxO71AD5tBy1KpWCP0K9-uBEZEc7Qv1ehMv3PA3zDQwngwj7XHMLgIY6M7vWosr7-nc/exec';
if (!SB_KEY) { console.error('❌ Falta SB_KEY.'); process.exit(1); }
const num = v => { const n = parseFloat(String(v == null ? '' : v).replace(',', '.')); return isNaN(n) ? 0 : n; };
const txt = v => { const s = (v == null ? '' : v).toString().trim(); return s === '' ? null : s; };

// hoja → { tabla, del (filtro DELETE), cols: [[índice, columna, tipo]] }  tipo: n=num, i=int, t=text
const CONFIG = [
  { hoja: 'CCHijos',          tabla: 'candy_cc',         del: 'id=gte.0', cols: [[0,'fecha','t'],[1,'hijo','t'],[2,'cliente','t'],[3,'monto','n'],[4,'tipo','t'],[5,'detalle','t']] },
  { hoja: 'ConsumoHijos',     tabla: 'candy_consumo',    del: 'id=gte.0', cols: [[0,'fecha','t'],[1,'hijo','t'],[2,'producto','t'],[3,'codigo','t'],[4,'cantidad','i'],[5,'costo','n'],[6,'motivo','t'],[7,'nota','t']] },
  { hoja: 'Gastos',           tabla: 'gastos',           del: 'id=gte.0', cols: [[0,'fecha','t'],[1,'descripcion','t'],[2,'monto','n'],[3,'moneda','t'],[4,'categoria','t'],[5,'columna','t']] },
  { hoja: 'Rendiciones',      tabla: 'rendiciones',      del: 'id=gte.0', cols: [[0,'fecha','t'],[1,'descripcion','t'],[2,'monto','n'],[3,'moneda','t'],[4,'columna','t']] },
  { hoja: 'StockDiario',      tabla: 'stock_diario',     del: 'id=gte.0', cols: [[0,'fecha','t'],[1,'hijo','t'],[2,'codigo','t'],[3,'producto','t'],[4,'cantidad','n']] },
  { hoja: 'CierresHijos',     tabla: 'cierres_hijos',    del: 'id=gte.0', cols: [[0,'fecha','t'],[1,'hijo','t'],[2,'cerrado_en','t'],[3,'vendido','n'],[4,'cobrado','n'],[5,'efectivo','n'],[6,'mp','n'],[7,'deuda','n'],[8,'ganancia','n'],[9,'consumo_costo','n'],[10,'nota','t']] },
  { hoja: 'Borrados',         tabla: 'borrados',         del: 'id=gte.0', cols: [[0,'fecha','t'],[1,'tipo','t'],[2,'detalle','t'],[3,'por','t']] },
  { hoja: 'Notificaciones',   tabla: 'notificaciones',   del: 'id=gte.0', cols: [[0,'fecha','t'],[1,'producto_id','t'],[2,'producto','t'],[3,'nombre','t'],[4,'telefono','t'],[5,'estado','t'],[6,'modo','t']] },
  { hoja: 'MovimientosStock', tabla: 'movimientos_stock',del: 'id=gte.0', cols: [[0,'fecha','t'],[1,'id_prod','t'],[2,'producto','t'],[3,'cambio','n'],[4,'antes','n'],[5,'despues','n'],[6,'origen','t']] },
  { hoja: 'GananciasJony',    tabla: 'ganancias_jony',   del: 'id=gte.0', cols: [[0,'fecha','t'],[1,'tipo','t'],[2,'descripcion','t'],[3,'monto','n']] },
  { hoja: 'CostosJony',       tabla: 'costos_jony',      del: 'id=gte.0', cols: [[0,'fecha','t'],[1,'producto_id','t'],[2,'producto','t'],[3,'cantidad','n'],[4,'costo_total','n'],[5,'costo_unitario','n']] },
  { hoja: 'Visitas',          tabla: 'visitas',          del: 'id=gte.0', cols: [[0,'fecha','t'],[1,'pagina','t']] },
  { hoja: 'Trafico',          tabla: 'trafico',          del: 'id=gte.0', cols: [[0,'fecha','t'],[1,'vid','t'],[2,'pagina','t'],[3,'evento','t'],[4,'origen','t'],[5,'dispositivo','t'],[6,'ciudad','t'],[7,'region','t'],[8,'pais','t'],[9,'nombre','t'],[10,'telefono','t'],[11,'detalle','t'],[12,'carrito','t'],[13,'total','n']] },
  { hoja: 'AvisosCandy',      tabla: 'avisos_candy',     del: 'id=gte.0', cols: [[0,'fecha','t'],[1,'hijo','t'],[2,'codigo','t'],[3,'producto','t'],[4,'cliente','t'],[5,'telefono','t'],[6,'estado','t']] },
  { hoja: 'ShukEnCandy',      tabla: 'shuk_en_candy',    del: 'id=gte.0', cols: [[0,'shuk_id','t'],[1,'fecha','t']] },
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
  const email = 'qa_uni_' + Date.now() + '@shuk.local', pass = 'Qa!' + Math.random().toString(36).slice(2) + 'X9';
  const cr = await fetch(SB_URL + '/auth/v1/admin/users', { method: 'POST', headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: pass, email_confirm: true }) });
  const cru = await cr.json(); if (!cr.ok) { console.error('❌ ' + JSON.stringify(cru).slice(0, 200)); process.exit(1); }
  const tempUserId = cru.id;
  const si = await fetch(SB_URL + '/auth/v1/token?grant_type=password', { method: 'POST', headers: { apikey: SB_ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: pass }) });
  const tok = (await si.json()).access_token;
  console.log('Migrando TODAS las hojas restantes → Supabase\n');

  try {
    for (const c of CONFIG) {
      try {
        const { filas } = await gasHoja(c.hoja, tok);
        const rows = (filas || []).filter(row => row.some(v => v !== '' && v != null)).map(row => {
          const o = {}; c.cols.forEach(([i, name, t]) => { const v = row[i]; o[name] = t === 't' ? txt(v) : (t === 'i' ? Math.round(num(v)) : num(v)); }); return o;
        });
        await sbDel(c.tabla, c.del);
        const n = await sbIns(c.tabla, rows);
        console.log('  ✓ ' + c.hoja.padEnd(18) + '→ ' + c.tabla.padEnd(20) + n + ' filas');
      } catch (e) { console.log('  ✗ ' + c.hoja.padEnd(18) + e.message); }
    }
    console.log('\n✅ Migración universal completa.');
  } finally {
    await fetch(SB_URL + '/auth/v1/admin/users/' + tempUserId, { method: 'DELETE', headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY } }).then(() => console.log('🧹 usuario QA temporal borrado.')).catch(() => {});
  }
})().catch(e => { console.error('FALLO:', e.message); process.exit(1); });
