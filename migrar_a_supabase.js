// ============================================================================
//  MIGRACIÓN de datos → Supabase (Fase 1). Lee el backup local y sube a las
//  tablas creadas con supabase_schema.sql. NO toca el sistema actual.
//
//  Uso:
//    SUPABASE_URL=https://xxxx.supabase.co SERVICE_KEY=<service_role> \
//    node migrar_a_supabase.js <carpeta_backup>
//
//  La SERVICE_KEY (service_role) se saca de: Supabase → Settings → API.
//  Es secreta (permite escribir toda la base) → no commitear, no compartir.
// ============================================================================
const fs = require('fs');
const path = require('path');

const URL = process.env.SUPABASE_URL || 'https://soarkknjewgcewryxqac.supabase.co';
const KEY = process.env.SERVICE_KEY;
const DIR = process.argv[2];
if (!KEY) { console.error('❌ Falta SERVICE_KEY (service_role de Supabase → Settings → API).'); process.exit(1); }
if (!DIR || !fs.existsSync(DIR)) { console.error('❌ Pasá la carpeta del backup: node migrar_a_supabase.js backup_shuk_...'); process.exit(1); }

const num = v => { const n = parseFloat(String(v).replace(',', '.')); return isNaN(n) ? 0 : n; };
const read = f => { const p = path.join(DIR, f); return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null; };

// upsert por lotes contra la REST API de Supabase (PostgREST)
async function subir(tabla, filas, onConflict) {
  if (!filas || !filas.length) { console.log('  · ' + tabla + ': (sin datos)'); return; }
  const url = URL + '/rest/v1/' + tabla + (onConflict ? '?on_conflict=' + onConflict : '');
  let ok = 0;
  for (let i = 0; i < filas.length; i += 200) {
    const lote = filas.slice(i, i + 200);
    const r = await fetch(url, {
      method: 'POST',
      headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json',
        Prefer: onConflict ? 'resolution=merge-duplicates,return=minimal' : 'return=minimal' },
      body: JSON.stringify(lote)
    });
    if (r.ok) ok += lote.length;
    else { console.log('  ✗ ' + tabla + ': ' + r.status + ' ' + (await r.text()).slice(0, 200)); return; }
  }
  console.log('  ✓ ' + tabla + ': ' + ok + ' filas');
}

(async () => {
  console.log('Migrando desde ' + DIR + ' → ' + URL + '\n');

  // PRODUCTOS (Shuk)
  const prods = read('shuk_productos.json') || [];
  await subir('productos', prods.map(p => ({
    id: String(p.id), nombre: p.nombre || '', stock: num(p.stock), activo: p.activo !== false,
    categoria: p.categoria || null, dueno: p.dueno || null, moneda: p.moneda || '$',
    precio_may: num(p.precioMay), precio_min: num(p.precioMin), descripcion: p.desc || null,
    visible: p.visible !== false, imagen: p.imagen || null, desc_bot: p.descBot || null,
    costo: num(p.costo), nombres_prev: p.nombresPrev || null, unidades_por_paquete: 1
  })), 'id');

  // VENTAS (Shuk)
  const ventas = read('shuk_ventas.json') || [];
  await subir('ventas', ventas.map(v => ({
    id: String(v.id), n_venta: parseInt(v.nVenta) || null, fecha: v.fecha || null, cliente: v.cliente || null,
    tipo: v.tipo || null, productos: v.productos || null, forma_pago: v.formaPago || null, notas: v.notas || null,
    estado: v.estado || null, total_ars: num(v.totalARS), total_usd: num(v.totalUSD),
    ars_jony: num(v.arsJONY), ars_myri: num(v.arsMyri), usd_myri: num(v.usdMyri), usd_jony: num(v.usdJONY),
    comi_ars: num(v.comiARS), comi_usd: num(v.comiUSD), caja_jony: v.cajaJony || null, caja_myri: v.cajaMyri || null,
    tipo_cambio: num(v.tipoCambio), sin_comi: v.sinComi || null, tramos: v.tramos || null, corte: v.corte || null,
    stock_updates: v.stockUpdates || null, vid: v.vid || null
  })), 'id');

  // PAGOS (Shuk)
  const pagos = read('shuk_pagos.json') || [];
  await subir('pagos', pagos.map(p => ({
    fecha: p.fecha || null, cliente: p.cliente || null, pedido_id: p.pedidoId || null,
    monto_ars: num(p.montoARS), monto_usd: num(p.montoUSD), monto_pitz: num(p.montoPitz),
    caja: p.caja || null, tc: num(p.tc), nota: p.nota || null, comprobante: p.comprobante || null
  })));

  // CLIENTES (Shuk)
  const clientes = read('shuk_clientes.json') || [];
  await subir('clientes', clientes.map(c => ({
    fecha: c.fecha || null, nombre: c.nombre || null, telefono: c.telefono || null,
    tipo: c.tipo || null, nota: c.nota || null, ultimo_acceso: c.ultimoAcceso || null
  })));

  // MOVIMIENTOS ENTRE SOCIOS
  const movs = (read('shuk_movs_socios.json') || {}).movimientos || read('shuk_movs_socios.json') || [];
  await subir('movs_socios', (Array.isArray(movs) ? movs : []).map(m => ({
    fecha: m.fecha || null, descripcion: m.desc || null, monto_ars: num(m.montoARS), monto_usd: num(m.montoUSD)
  })));

  // CANDY — catálogo propio (los de Shuk se referencian, no se copian acá)
  const cat = read('candy_catalogo.json') || [];
  await subir('candy_productos', cat.filter(p => !String(p.codigo).startsWith('shuk:')).map(p => ({
    codigo: String(p.codigo), nombre: p.nombre || '', precio_venta: num(p.precioVenta), costo: num(p.costo),
    stock: num(p.stock), categoria: p.categoria || null, foto: p.foto || null, precio_oferta: num(p.precioOferta),
    fecha_oferta: p.fechaOferta || null, cant_pack: parseInt(p.cantPack) || 0, precio_pack: num(p.precioPack),
    siempre_disp: !!p.siempreDisp
  })), 'codigo');

  console.log('\n✅ Migración terminada. Verificá en Supabase → Table Editor.');
})().catch(e => { console.error('FALLO:', e.message); process.exit(1); });
