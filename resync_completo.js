// ============================================================================
//  RE-SYNC COMPLETO Google (EN VIVO) → Supabase. Borra y recarga TODAS las
//  tablas operativas leyendo cada hoja cruda con exportarHoja. Idempotente.
//  Es LA herramienta del switch: se corre justo antes de apuntar el front.
//  NO toca: config (claves/estado/notas), bucket backups.
//  Uso: SB_KEY=<secret> node resync_completo.js
// ============================================================================
const SB_URL = 'https://soarkknjewgcewryxqac.supabase.co';
const SB_KEY = process.env.SB_KEY;
const SB_ANON = 'sb_publishable_aAZNID-NdaGERYQWe9Uk6w_rmlYSCj2';
const GAS_URL = 'https://script.google.com/macros/s/AKfycbxO71AD5tBy1KpWCP0K9-uBEZEc7Qv1ehMv3PA3zDQwngwj7XHMLgIY6M7vWosr7-nc/exec';
if (!SB_KEY) { console.error('❌ Falta SB_KEY.'); process.exit(1); }

const num = v => { const n = parseFloat(String(v == null ? '' : v).replace(',', '.')); return isNaN(n) ? 0 : n; };
const int = v => Math.round(num(v));
const txt = v => { const s = (v == null ? '' : v).toString().trim(); return s === '' ? null : s; };
// Fechas texto: exportarHoja manda segundos; la base usa 'dd/MM/yyyy HH:mm' (sacamos :ss).
const fch = v => { const s = (v == null ? '' : v).toString().trim(); return s === '' ? null : s.replace(/^(\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}):\d{2}$/, '$1'); };
// 'dd/MM/yyyy HH:mm[:ss]' → ISO con zona AR (para columnas timestamptz).
const iso = v => { const m = (v == null ? '' : v).toString().match(/(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?/); return m ? `${m[3]}-${m[2]}-${m[1]}T${m[4] || '00'}:${m[5] || '00'}:${m[6] || '00'}-03:00` : null; };
const siNo = v => (v == null ? 'SI' : v).toString().trim().toUpperCase() !== 'NO';
const b01 = v => { const s = (v == null ? '' : v).toString().trim().toUpperCase(); return s === '1' || s === 'TRUE' || s === 'SI'; };

// hoja → tabla, filtro de DELETE y mapeo posicional (fuente CRUDA, lección aprendida)
const CONFIG = [
  { hoja: 'Stock', tabla: 'productos', del: 'id=neq.__x__', map: r => ({
      id: txt(r[0]), nombre: (r[1] || '').toString(), descripcion: txt(r[2]), precio_may: r[3] == null || r[3] === '' ? null : num(r[3]),
      precio_min: num(r[4]), stock: num(r[5]), imagen: txt(r[6]), activo: siNo(r[7]), categoria: txt(r[8]),
      visible_cat: (txt(r[9]) || 'Ambos'), visible: (txt(r[9]) || 'Ambos') !== 'No',
      precio_oferta: num(r[10]), fecha_oferta: txt(r[11]), cant_pack: int(r[12]), precio_pack: num(r[13]),
      dueno: txt(r[14]), desc_bot: txt(r[16]), moneda: (txt(r[17]) === 'U$S') ? 'U$S' : '$',
      candy_cod: txt(r[28]), costo: r[29] == null || r[29] === '' ? null : num(r[29]), nombres_prev: txt(r[30]), unidades_por_paquete: 1,
    }), req: r => txt(r[0]) },
  { hoja: 'Ventas', tabla: 'ventas', del: 'id=neq.__x__', map: r => ({
      id: txt(r[0]), fecha: fch(r[1]), cliente: txt(r[2]), tipo: txt(r[3]), productos: txt(r[4]), forma_pago: txt(r[5]),
      notas: txt(r[6]), estado: txt(r[7]), total_ars: num(r[8]), total_usd: num(r[9]), n_venta: int(r[10]) || null,
      ars_jony: num(r[11]), ars_myri: num(r[12]), usd_myri: num(r[13]), comi_ars: num(r[14]), comi_usd: num(r[15]),
      caja_jony: txt(r[16]), caja_myri: txt(r[17]), tipo_cambio: num(r[18]), stock_updates: txt(r[19]), vid: txt(r[20]),
      comprobante: txt(r[21]), ajuste: num(r[22]), orig_split: txt(r[23]), corte: txt(r[25]), sin_comi: txt(r[26]),
      usd_jony: num(r[27]), tramos: txt(r[28]),
    }), req: r => txt(r[0]) },
  { hoja: 'Pagos', tabla: 'pagos', del: 'id=gte.0', map: r => ({
      fecha: fch(r[0]), cliente: txt(r[1]), pedido_id: txt(r[2]), monto_ars: num(r[3]), monto_usd: num(r[4]),
      caja: txt(r[5]), nota: txt(r[6]), monto_pitz: num(r[7]), comprobante: txt(r[8]), tc: num(r[9]),
    }) },
  { hoja: 'Clientes', tabla: 'clientes', del: 'id=gte.0', map: r => ({
      fecha: fch(r[0]), nombre: txt(r[1]), telefono: txt(r[2]), tipo: txt(r[3]), nota: txt(r[4]), ultimo_acceso: fch(r[5]),
    }), req: r => txt(r[1]) },
  { hoja: 'MovsSocios', tabla: 'movs_socios', del: 'id=gte.0', map: r => ({
      fecha: fch(r[0]), descripcion: txt(r[1]), monto_ars: num(r[2]), monto_usd: num(r[3]),
    }) },
  { hoja: 'Envios', tabla: 'envios', del: 'id=gte.0', map: r => ({
      fecha: fch(r[0]), venta_id: txt(r[1]), n_venta: txt(r[2]), cliente: txt(r[3]), dueno: txt(r[4]),
      cobrado: num(r[5]), costo: num(r[6]), quien_pago: txt(r[7]), nota: txt(r[8]),
    }) },
  { hoja: 'LiquidacionSocios', tabla: 'liquidacion_socios', del: 'id=gte.0', map: r => ({
      fecha: fch(r[0]), monto_ars: num(r[1]), monto_usd: num(r[2]), nota: txt(r[3]),
    }) },
  { hoja: 'Cortes', tabla: 'cortes', del: 'id=gte.0', map: r => ({
      fecha: fch(r[0]), corte_id: txt(r[1]), ganancia_ars: num(r[2]), diezmo_ars: num(r[3]), ganancia_usd: num(r[4]),
      diezmo_usd: num(r[5]), pagado_myri_ars: num(r[6]), pagado_myri_usd: num(r[7]), ventas: int(r[8]), nota: txt(r[9]),
    }) },
  { hoja: 'CatalogoHijos', tabla: 'candy_productos', del: 'codigo=neq.__x__', map: r => ({
      codigo: txt(r[0]), nombre: (r[1] || '').toString(), precio_venta: num(r[2]), costo: num(r[3]), foto: txt(r[4]),
      categoria: txt(r[5]) || 'Varios', precio_oferta: num(r[6]), fecha_oferta: txt(r[7]), cant_pack: int(r[8]),
      precio_pack: num(r[9]), siempre_disp: b01(r[10]),
    }), req: r => txt(r[0]) },
  { hoja: 'VentasHijos', tabla: 'candy_ventas', del: 'id=gte.0', map: r => ({
      fecha: fch(r[0]), hijo: txt(r[1]), producto: txt(r[2]), codigo: txt(r[3]), cantidad: int(r[4]) || 1,
      precio: num(r[5]), total: num(r[6]), cliente: txt(r[7]), es_debe: txt(r[8]), pago_parcial: num(r[9]),
      saldo_pendiente: num(r[10]), metodo_pago: txt(r[11]) || 'efectivo',
    }) },
  { hoja: 'PedidosHijos', tabla: 'candy_pedidos', del: 'id=gte.0', map: r => ({
      fecha: iso(r[0]), hijo: txt(r[1]), cliente: txt(r[2]), telefono: txt(r[3]), items: txt(r[4]) || '[]',
      total: num(r[5]), estado: txt(r[6]) || 'pendiente', pedido_id: txt(r[7]), nota: txt(r[8]),
    }), req: r => txt(r[7]) },
  { hoja: 'ProveedoresHijos', tabla: 'candy_proveedores', del: 'id=neq.__x__', map: r => ({
      id: txt(r[0]), nombre: txt(r[1]), telefono: txt(r[2]), notas: txt(r[3]),
    }), req: r => txt(r[0]) },
  { hoja: 'ComprasHijos', tabla: 'candy_compras', del: 'id=gte.0', map: r => ({
      compra_id: txt(r[0]), fecha: fch(r[1]), proveedor_id: txt(r[2]), proveedor: txt(r[3]), codigo: txt(r[4]),
      producto: txt(r[5]), cantidad: int(r[6]), costo_unit: num(r[7]), costo_total: num(r[8]), registrado_por: txt(r[9]),
    }) },
  // resto (mismos mapeos que migrar_universal.js)
  { hoja: 'CCHijos', tabla: 'candy_cc', del: 'id=gte.0', map: r => ({ fecha: fch(r[0]), hijo: txt(r[1]), cliente: txt(r[2]), monto: num(r[3]), tipo: txt(r[4]), detalle: txt(r[5]) }) },
  { hoja: 'ConsumoHijos', tabla: 'candy_consumo', del: 'id=gte.0', map: r => ({ fecha: fch(r[0]), hijo: txt(r[1]), producto: txt(r[2]), codigo: txt(r[3]), cantidad: int(r[4]), costo: num(r[5]), motivo: txt(r[6]), nota: txt(r[7]) }) },
  { hoja: 'Gastos', tabla: 'gastos', del: 'id=gte.0', map: r => ({ fecha: fch(r[0]), descripcion: txt(r[1]), monto: num(r[2]), moneda: txt(r[3]), categoria: txt(r[4]), columna: txt(r[5]) }) },
  { hoja: 'Rendiciones', tabla: 'rendiciones', del: 'id=gte.0', map: r => ({ fecha: fch(r[0]), descripcion: txt(r[1]), monto: num(r[2]), moneda: txt(r[3]), columna: txt(r[4]) }) },
  { hoja: 'StockDiario', tabla: 'stock_diario', del: 'id=gte.0', map: r => ({ fecha: fch(r[0]), hijo: txt(r[1]), codigo: txt(r[2]), producto: txt(r[3]), cantidad: num(r[4]) }) },
  { hoja: 'CierresHijos', tabla: 'cierres_hijos', del: 'id=gte.0', map: r => ({ fecha: fch(r[0]), hijo: txt(r[1]), cerrado_en: fch(r[2]), vendido: num(r[3]), cobrado: num(r[4]), efectivo: num(r[5]), mp: num(r[6]), deuda: num(r[7]), ganancia: num(r[8]), consumo_costo: num(r[9]), nota: txt(r[10]) }) },
  { hoja: 'Borrados', tabla: 'borrados', del: 'id=gte.0', map: r => ({ fecha: fch(r[0]), tipo: txt(r[1]), detalle: txt(r[2]), por: txt(r[3]) }) },
  { hoja: 'Notificaciones', tabla: 'notificaciones', del: 'id=gte.0', map: r => ({ fecha: fch(r[0]), producto_id: txt(r[1]), producto: txt(r[2]), nombre: txt(r[3]), telefono: txt(r[4]), estado: txt(r[5]), modo: txt(r[6]) }) },
  { hoja: 'MovimientosStock', tabla: 'movimientos_stock', del: 'id=gte.0', map: r => ({ fecha: fch(r[0]), id_prod: txt(r[1]), producto: txt(r[2]), cambio: num(r[3]), antes: num(r[4]), despues: num(r[5]), origen: txt(r[6]) }) },
  { hoja: 'GananciasJony', tabla: 'ganancias_jony', del: 'id=gte.0', map: r => ({ fecha: fch(r[0]), tipo: txt(r[1]), descripcion: txt(r[2]), monto: num(r[3]) }) },
  { hoja: 'CostosJony', tabla: 'costos_jony', del: 'id=gte.0', map: r => ({ fecha: fch(r[0]), producto_id: txt(r[1]), producto: txt(r[2]), cantidad: num(r[3]), costo_total: num(r[4]), costo_unitario: num(r[5]) }) },
  { hoja: 'Visitas', tabla: 'visitas', del: 'id=gte.0', map: r => ({ fecha: fch(r[0]), pagina: txt(r[1]) }) },
  // Trafico conserva los SEGUNDOS (carritos abandonados compara al segundo)
  { hoja: 'Trafico', tabla: 'trafico', del: 'id=gte.0', map: r => ({ fecha: txt(r[0]), vid: txt(r[1]), pagina: txt(r[2]), evento: txt(r[3]), origen: txt(r[4]), dispositivo: txt(r[5]), ciudad: txt(r[6]), region: txt(r[7]), pais: txt(r[8]), nombre: txt(r[9]), telefono: txt(r[10]), detalle: txt(r[11]), carrito: txt(r[12]), total: num(r[13]) }) },
  { hoja: 'AvisosCandy', tabla: 'avisos_candy', del: 'id=gte.0', map: r => ({ fecha: fch(r[0]), hijo: txt(r[1]), codigo: txt(r[2]), producto: txt(r[3]), cliente: txt(r[4]), telefono: txt(r[5]), estado: txt(r[6]) }) },
  { hoja: 'ShukEnCandy', tabla: 'shuk_en_candy', del: 'id=gte.0', map: r => ({ shuk_id: txt(r[0]), fecha: fch(r[1]) }) },
  { hoja: 'BandejaFotos', tabla: 'bandeja_fotos', del: 'id=neq.__x__', map: r => ({ id: txt(r[0]), fecha: fch(r[1]), public_id: txt(r[2]), nombre: txt(r[3]), descripcion: txt(r[4]), categoria: txt(r[5]), estado: txt(r[6]) }), req: r => txt(r[0]) },
  { hoja: 'FlyersHijos', tabla: 'flyers_hijos', del: 'id=neq.__x__', map: r => ({ id: txt(r[0]), fecha: fch(r[1]), hijo: txt(r[2]), url: txt(r[3]), titulo: txt(r[4]), codigos: txt(r[5]), idea: txt(r[6]), fondo_ia: txt(r[7]), estado: txt(r[8]), config: txt(r[9]) }), req: r => txt(r[0]) },
  { hoja: 'BotSesiones', tabla: 'bot_sesiones', del: 'telefono=neq.__x__', map: r => ({ telefono: txt(r[0]), carrito: txt(r[1]), ultima_actividad: fch(r[2]), nombre: txt(r[3]), historial: txt(r[4]) }), req: r => txt(r[0]) },
  { hoja: 'SMSLog', tabla: 'sms_log', del: 'id=gte.0', map: r => ({ fecha: fch(r[0]), sim: txt(r[1]), de: txt(r[2]), texto: txt(r[3]) }) },
];

async function gasHoja(hoja, tok) {
  const r = await fetch(GAS_URL + '?accion=exportarHoja&token=' + encodeURIComponent(tok) + '&hoja=' + hoja);
  const j = await r.json(); if (j.error) throw new Error(j.error); return j;
}
async function sbDel(tabla, filtro) { await fetch(SB_URL + '/rest/v1/' + tabla + '?' + filtro, { method: 'DELETE', headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY, Prefer: 'return=minimal' } }); }
async function sbIns(tabla, filas) {
  if (!filas.length) return 0; let ok = 0;
  for (let i = 0; i < filas.length; i += 500) {
    const lote = filas.slice(i, i + 500);
    const r = await fetch(SB_URL + '/rest/v1/' + tabla, { method: 'POST', headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY, 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify(lote) });
    if (r.ok) ok += lote.length; else throw new Error(r.status + ' ' + (await r.text()).slice(0, 180));
  }
  return ok;
}

(async () => {
  const email = 'qa_rs_' + Date.now() + '@shuk.local', pass = 'Qa!' + Math.random().toString(36).slice(2) + 'X9';
  const cr = await fetch(SB_URL + '/auth/v1/admin/users', { method: 'POST', headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: pass, email_confirm: true }) });
  const cru = await cr.json(); if (!cr.ok) { console.error('❌ ' + JSON.stringify(cru).slice(0, 200)); process.exit(1); }
  const si = await fetch(SB_URL + '/auth/v1/token?grant_type=password', { method: 'POST', headers: { apikey: SB_ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: pass }) });
  const tok = (await si.json()).access_token;
  console.log('RE-SYNC completo Google (en vivo) → Supabase\n');
  let fallas = 0;
  try {
    for (const c of CONFIG) {
      try {
        const { filas } = await gasHoja(c.hoja, tok);
        let rows = (filas || []).filter(row => row.some(v => v !== '' && v != null)).filter(row => !c.req || c.req(row)).map(c.map);
        if (c.tabla === 'candy_deposito_placeholder') { /* nunca */ }
        await sbDel(c.tabla, c.del);
        const n = await sbIns(c.tabla, rows);
        console.log('  ✓ ' + c.hoja.padEnd(18) + '→ ' + c.tabla.padEnd(20) + n + ' filas');
      } catch (e) { fallas++; console.log('  ✗ ' + c.hoja.padEnd(18) + String(e.message).slice(0, 140)); }
    }
    // candy_deudores (espejo derivado): se recalcula de la candy_cc recién sincronizada,
    // con la MISMA lógica de consultarDeudores (agrupa por hijo+cliente normalizado).
    try {
      const norm = s => (s || '').toString().trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ');
      const cc = await (await fetch(SB_URL + '/rest/v1/candy_cc?select=hijo,cliente,monto&limit=100000', { headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY } })).json();
      const saldos = {};
      cc.forEach(r => { if (!r.cliente) return; const k = r.hijo + '|' + norm(r.cliente); if (!saldos[k]) saldos[k] = { hijo: r.hijo, cliente: r.cliente, saldo: 0 }; saldos[k].saldo += num(r.monto); });
      const deudores = Object.values(saldos).filter(x => Math.abs(x.saldo) > 0.01);
      await sbDel('candy_deudores', 'id=gte.0');
      const n = await sbIns('candy_deudores', deudores);
      console.log('  ✓ ' + '(derivado)'.padEnd(18) + '→ ' + 'candy_deudores'.padEnd(20) + n + ' filas');
    } catch (e) { fallas++; console.log('  ✗ candy_deudores    ' + String(e.message).slice(0, 140)); }
    // DepositoHijos aparte: SUMA los códigos duplicados (lección del 01/07: stock real)
    try {
      const { filas } = await gasHoja('DepositoHijos', tok);
      const porCod = {};
      (filas || []).forEach(r => { const cod = txt(r[0]); if (!cod) return; if (!porCod[cod]) porCod[cod] = { codigo: cod, nombre: txt(r[1]), cantidad: 0 }; porCod[cod].cantidad += num(r[2]); });
      await sbDel('candy_deposito', 'codigo=neq.__x__');
      const n = await sbIns('candy_deposito', Object.values(porCod));
      console.log('  ✓ ' + 'DepositoHijos'.padEnd(18) + '→ ' + 'candy_deposito'.padEnd(20) + n + ' filas (duplicados sumados)');
    } catch (e) { fallas++; console.log('  ✗ DepositoHijos     ' + String(e.message).slice(0, 140)); }
    console.log('\n' + (fallas ? '❌ ' + fallas + ' hojas fallaron' : '✅ RE-SYNC COMPLETO — la base nueva es espejo del Google de AHORA.'));
  } finally {
    await fetch(SB_URL + '/auth/v1/admin/users/' + cru.id, { method: 'DELETE', headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY } }).then(() => console.log('🧹 usuario QA borrado.')).catch(() => {});
  }
  process.exit(fallas ? 1 : 0);
})().catch(e => { console.error('FALLO:', e); process.exit(1); });
