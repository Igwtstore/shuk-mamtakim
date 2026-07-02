// ============================================================================
//  MIGRACIÓN de datos de CANDY → Supabase (Fase 1 Candy).
//  Requiere: ejecutar antes supabase_schema_candy.sql (ajusta compras/proveedores/deudores).
//  Uso: SUPABASE_URL=... SERVICE_KEY=<secret> node migrar_candy.js <carpeta_backup>
// ============================================================================
const fs = require('fs');
const path = require('path');
const URL = process.env.SUPABASE_URL || 'https://soarkknjewgcewryxqac.supabase.co';
const KEY = process.env.SERVICE_KEY;
const DIR = process.argv[2];
if (!KEY) { console.error('❌ Falta SERVICE_KEY (secret de Supabase).'); process.exit(1); }
if (!DIR || !fs.existsSync(DIR)) { console.error('❌ Pasá la carpeta del backup.'); process.exit(1); }

const num = v => { const n = parseFloat(String(v).replace(',', '.')); return isNaN(n) ? 0 : n; };
const read = f => { const p = path.join(DIR, f); return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null; };
const esTest = s => /__TEST/i.test(JSON.stringify(s || ''));

async function subir(tabla, filas, onConflict) {
  if (!filas || !filas.length) { console.log('  · ' + tabla + ': (sin datos)'); return; }
  const url = URL + '/rest/v1/' + tabla + (onConflict ? '?on_conflict=' + onConflict : '');
  let ok = 0;
  for (let i = 0; i < filas.length; i += 200) {
    const lote = filas.slice(i, i + 200);
    const r = await fetch(url, { method: 'POST',
      headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json',
        Prefer: onConflict ? 'resolution=merge-duplicates,return=minimal' : 'return=minimal' },
      body: JSON.stringify(lote) });
    if (r.ok) ok += lote.length; else { console.log('  ✗ ' + tabla + ': ' + r.status + ' ' + (await r.text()).slice(0, 200)); return; }
  }
  console.log('  ✓ ' + tabla + ': ' + ok + ' filas');
}

(async () => {
  console.log('Migrando CANDY desde ' + DIR + '\n');

  // VENTAS de Candy (los 3 hijos). SKIP_VENTAS=1 para no re-subirlas (ya migradas → evita duplicar).
  if (!process.env.SKIP_VENTAS) {
    let ventas = [];
    ['Meir', 'Iosi', 'Pa'].forEach(h => (read('candy_ventas_' + h + '.json') || []).forEach(v => { if (!esTest(v)) ventas.push(v); }));
    await subir('candy_ventas', ventas.map(v => ({
      fecha: v.fecha || null, hijo: v.hijo || null, producto: v.producto || null, codigo: v.codigo || null,
      cantidad: parseInt(v.cantidad) || 0, precio: num(v.precio), total: num(v.total), cliente: v.cliente || null,
      es_debe: v.esDebe || null, pago_parcial: num(v.pagoParcial), saldo_pendiente: num(v.saldoPendiente), metodo_pago: v.metodoPago || null
    })));
  } else console.log('  · candy_ventas: (saltado — ya migrado)');

  const ctab = read('candy_compras_full.json') || {};
  // DEPÓSITO (dedup por código: hay repetidos en los datos → me quedo con el último)
  const depMap = {};
  (ctab.deposito || []).filter(d => !esTest(d)).forEach(d => { depMap[String(d.codigo)] = { codigo: String(d.codigo), nombre: d.producto || null, cantidad: num(d.cantidad) }; });
  await subir('candy_deposito', Object.values(depMap), 'codigo');
  // COMPRAS (items como JSON)
  await subir('candy_compras', (ctab.compras || []).filter(c => !esTest(c)).map(c => ({
    id: String(c.id), fecha: c.fecha || null, proveedor: c.proveedor || null, items: JSON.stringify(c.items || []), total: num(c.total)
  })), 'id');
  // PROVEEDORES
  await subir('candy_proveedores', (ctab.proveedores || []).filter(p => !esTest(p)).map(p => ({
    id: String(p.id), nombre: p.nombre || null, telefono: p.telefono || null, notas: p.notas || null
  })), 'id');

  // DEUDORES (saldo por cliente, por hijo)
  let deud = [];
  ['Meir', 'Iosi', 'Pa'].forEach(h => (read('candy_deudores_' + h + '.json') || []).forEach(d => { if (!esTest(d)) deud.push({ hijo: h, cliente: d.cliente || null, saldo: num(d.saldo) }); }));
  await subir('candy_deudores', deud);

  console.log('\n✅ Candy migrado. Verificá en Supabase → Table Editor.');
})().catch(e => { console.error('FALLO:', e.message); process.exit(1); });
