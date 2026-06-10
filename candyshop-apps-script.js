const SPREADSHEET_ID = '17uCcaoZ5TDZbiL4R3L881JQ8_-J94sWUP4KjUDqaV1c';
const TZ = 'America/Argentina/Buenos_Aires';
// v3

// ─── AUTH (protección de acciones del admin de Shuk Mamtakim) ─────────────────
const SUPA_URL = 'https://soarkknjewgcewryxqac.supabase.co';
const SUPA_ANON = 'sb_publishable_aAZNID-NdaGERYQWe9Uk6w_rmlYSCj2';
const ENFORCE_AUTH = true;   // Etapa B: estricto — rechaza acciones sensibles sin sesión válida.
// Nota: 'visitas' queda FUERA a propósito (candyshop también la usa y son solo contadores).
const PROTECTED_ACTIONS = [
  'ventas','gastos','rendiciones','getClientes','getPagos','getLiquidaciones',
  'getGanancias','getCompras','notasClientes','notificaciones','confirmarCobro','setStock',
  'saldarSocios','registrarPagoCuenta','actualizarEstado','actualizarPedido','editarNotaPedido',
  'registrarRetiro','setSaldoInicial','registrarCompra','agregarCliente','editarCliente',
  'guardarNotaCliente','enviarPush','gasto','rendicion','agregarProducto','actualizarOferta',
  'eliminarNotificacion','marcarNotificado','getAnalitica','getProductosDormidos','preguntarIA',
  'guardarClaveIA'
];

// ─── AUTH candyshop (panel de los chicos + bot) ───────────────────────────────
const ENFORCE_HIJOS = true;   // Etapa B: estricto — rechaza acciones de hijos sin sesión válida ni secreto.
const BOT_SECRET = 'shukbot_2026_x7Kq9Lm4Rp8Tz3W';   // compartido con el worker del bot
// 'getCatalogoHijos' y 'visitas' quedan FUERA (la tienda pública de los clientes los usa).
const PROTECTED_HIJOS = [
  'registrarVentaHijos','registrarPagoCliente','registrarVueltoCC','registrarPagoVuelto',
  'consultarDeudores','consultarDeudaCliente','ventasHoy','ventasPeriodo','historialCliente',
  'cargarStock','getStockDia','resetearStockDia','agregarProductoHijo','editarProductoHijo',
  'eliminarProductoHijo','eliminarVentaHijos','editarVentaHijos','marcarComprado',
  'getProveedoresHijos','agregarProveedorHijos','editarProveedorHijos','eliminarProveedorHijos',
  'registrarCompraHijos','getComprasHijos','getDepositoHijos','panelHijos','comprasTabHijos'
];

// Verifica un token de sesión Supabase contra /auth/v1/user. Cachea el resultado 5 min
// para no llamar a Supabase en cada request. Devuelve true si es válido.
function sesionValida_(token) {
  if (!token) return false;
  const cache = CacheService.getScriptCache();
  const key = 'auth_' + Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, token)
  ).substring(0, 28);
  if (cache.get(key) === '1') return true;
  try {
    const res = UrlFetchApp.fetch(SUPA_URL + '/auth/v1/user', {
      headers: { 'Authorization': 'Bearer ' + token, 'apikey': SUPA_ANON },
      muteHttpExceptions: true
    });
    if (res.getResponseCode() === 200) { cache.put(key, '1', 300); return true; }
    return false;
  } catch (e) { return false; }
}

// EJECUTAR UNA VEZ desde el editor para autorizar el acceso a servicios externos
// (UrlFetchApp), necesario para validar el token de sesión contra Supabase.
function autorizarPermisos() {
  const res = UrlFetchApp.fetch('https://www.google.com/generate_204', { muteHttpExceptions: true });
  Logger.log('Permiso de servicios externos OK — código ' + res.getResponseCode());
}

function doGet(e) {
  const accion = e.parameter.accion;
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  // Protección de acciones sensibles del admin. Etapa A: loguea pero permite.
  if (PROTECTED_ACTIONS.indexOf(accion) !== -1) {
    if (!sesionValida_(e.parameter.token)) {
      Logger.log('[auth] acción protegida SIN sesión válida: ' + accion);
      if (ENFORCE_AUTH) return json({ error: 'no autorizado — iniciá sesión de nuevo' });
    }
  }
  // Protección de acciones del candyshop: panel (sesión Supabase) o bot (secreto).
  if (PROTECTED_HIJOS.indexOf(accion) !== -1) {
    const ok = sesionValida_(e.parameter.token) || (e.parameter.secret && e.parameter.secret === BOT_SECRET);
    if (!ok) {
      Logger.log('[auth] acción hijos SIN sesión/secret: ' + accion);
      if (ENFORCE_HIJOS) return json({ error: 'no autorizado' });
    }
  }
  try {
    if (accion === 'venta') {
      // Anti pedidos falsos: límite por dispositivo (vid). 90s entre pedidos, máx 4/hora.
      const vidVenta = dec(e.parameter.vid || '');
      if (vidVenta) {
        const rlCache = CacheService.getScriptCache();
        if (rlCache.get('rlv_' + vidVenta)) return json({ error: 'rate' });
        const nPedidos = parseInt(rlCache.get('rlh_' + vidVenta) || '0', 10);
        if (nPedidos >= 4) return json({ error: 'rate' });
        rlCache.put('rlv_' + vidVenta, '1', 90);
        rlCache.put('rlh_' + vidVenta, String(nPedidos + 1), 3600);
      }
      const h = getOrCreate(ss, 'Ventas', ['ID','Fecha','Cliente','Tipo','Productos','Forma de Pago','Notas','Estado','Total ARS','Total USD','# Venta','ARS Jony','ARS Myri','USD Myri','Comi ARS','Comi USD','Caja Jony','Caja Myri','Tipo Cambio','Stock Updates']);
      const id = 'P' + Date.now().toString();
      const fecha = Utilities.formatDate(new Date(), TZ, 'dd/MM/yyyy HH:mm');
      const row = h.getLastRow() + 1;
      const nVenta = row - 1;
      const stockUpdates = dec(e.parameter.stockUpdates||'');
      if (h.getRange(1, 21).getValue() !== 'VID') h.getRange(1, 21).setValue('VID');
      h.appendRow([id, fecha, dec(e.parameter.cliente), dec(e.parameter.tipo), dec(e.parameter.productos), dec(e.parameter.formaPago), dec(e.parameter.notas||''), 'pendiente',
        parseFloat(e.parameter.totalARS||0), parseFloat(e.parameter.totalUSD||0), nVenta,
        parseFloat(e.parameter.arsJONY||0), parseFloat(e.parameter.arsMyri||0),
        parseFloat(e.parameter.usdMyri||0), parseFloat(e.parameter.comiARS||0), parseFloat(e.parameter.comiUSD||0),
        '', '', 0, stockUpdates, vidVenta]);
      h.getRange(row, 1, 1, 2).setNumberFormat('@');
      if (stockUpdates) {
        var sh = ss.getSheetByName('Stock');
        if (sh) {
          var sd = sh.getDataRange().getValues();
          stockUpdates.split(',').forEach(function(u) {
            var parts = u.split(':'); var pid = parts[0]; var qty = parseInt(parts[1])||0;
            for (var i = 1; i < sd.length; i++) {
              if (sd[i][0].toString() === pid) { sh.getRange(i+1,6).setValue(Math.max(0,(parseInt(sd[i][5])||0)-qty)); break; }
            }
          });
        }
      }
      // Trackear ganancias automáticamente
      const jonyItems = dec(e.parameter.jonyItems||'');
      const comiARSv = parseFloat(e.parameter.comiARS||0);
      const hG = getOrCreate(ss, 'GananciasJony', ['Fecha','Tipo','Descripcion','Monto']);
      if (jonyItems) {
        let gananciaPitz = 0;
        jonyItems.split(',').forEach(it => {
          const parts = it.split(':');
          const pid = parts[0]; const qty = parseFloat(parts[1])||0; const precio = parseFloat(parts[2])||0;
          const avgCosto = getCostoPromedio(ss, pid);
          if (avgCosto > 0) gananciaPitz += (precio - avgCosto) * qty;
        });
        if (gananciaPitz > 0) hG.appendRow([fecha, 'ganancia_pitzujim', 'Pitzujim — ' + dec(e.parameter.cliente), Math.round(gananciaPitz)]);
      }
      if (comiARSv > 0) hG.appendRow([fecha, 'comision_miri', 'Comisión Miri — ' + dec(e.parameter.cliente), Math.round(comiARSv)]);
      return json({ok:true, nVenta});
    }
    if (accion === 'actualizarEstado') {
      const h = ss.getSheetByName('Ventas'); if (!h) return json({error:'sin hoja'});
      const datos = h.getDataRange().getValues();
      for (let i = 1; i < datos.length; i++) {
        const cellId = datos[i][0] instanceof Date ? datos[i][0].toISOString() : datos[i][0].toString().trim();
        if (cellId === e.parameter.id) {
          h.getRange(i+1,8).setValue(dec(e.parameter.estado));
          if (dec(e.parameter.estado) === 'cancelado') {
            const su = datos[i][19] || '';
            if (su) {
              const sh = ss.getSheetByName('Stock');
              if (sh) {
                const sd = sh.getDataRange().getValues();
                su.split(',').forEach(function(u) {
                  const parts = u.split(':'); const pid = parts[0]; const qty = parseInt(parts[1])||0;
                  for (let j = 1; j < sd.length; j++) {
                    if (sd[j][0].toString() === pid) { sh.getRange(j+1,6).setValue((parseInt(sd[j][5])||0) + qty); break; }
                  }
                });
              }
            }
          }
          return ok();
        }
      }
      return json({error:'no encontrado'});
    }
    if (accion === 'actualizarPedido') {
      const h = ss.getSheetByName('Ventas'); if (!h) return json({error:'sin hoja'});
      const datos = h.getDataRange().getValues();
      for (let i = 1; i < datos.length; i++) {
        const cellId = datos[i][0] instanceof Date ? datos[i][0].toISOString() : datos[i][0].toString().trim();
        if (cellId === e.parameter.id) {
          if (e.parameter.productos) h.getRange(i+1,5).setValue(dec(e.parameter.productos));
          if (e.parameter.tipo)      h.getRange(i+1,4).setValue(dec(e.parameter.tipo));
          if (e.parameter.totalARS !== undefined) h.getRange(i+1,9).setValue(parseFloat(e.parameter.totalARS)||0);
          if (e.parameter.totalUSD !== undefined) h.getRange(i+1,10).setValue(parseFloat(e.parameter.totalUSD)||0);
          if (e.parameter.arsJONY  !== undefined) h.getRange(i+1,12).setValue(parseFloat(e.parameter.arsJONY)||0);
          if (e.parameter.arsMyri  !== undefined) h.getRange(i+1,13).setValue(parseFloat(e.parameter.arsMyri)||0);
          if (e.parameter.usdMyri  !== undefined) h.getRange(i+1,14).setValue(parseFloat(e.parameter.usdMyri)||0);
          if (e.parameter.comiARS  !== undefined) h.getRange(i+1,15).setValue(parseFloat(e.parameter.comiARS)||0);
          if (e.parameter.comiUSD  !== undefined) h.getRange(i+1,16).setValue(parseFloat(e.parameter.comiUSD)||0);
          return ok();
        }
      }
      return json({error:'no encontrado'});
    }
    if (accion === 'confirmarCobro') {
      const h = ss.getSheetByName('Ventas'); if (!h) return json({error:'sin hoja'});
      const datos = h.getDataRange().getValues();
      for (let i = 1; i < datos.length; i++) {
        const cellId = datos[i][0] instanceof Date ? datos[i][0].toISOString() : datos[i][0].toString().trim();
        if (cellId === e.parameter.id) {
          // soloMyri: vista de Myri — solo actualiza su caja, no toca la de Jony (col 17)
          if (e.parameter.soloMyri !== '1') h.getRange(i+1,17).setValue(dec(e.parameter.cajaJony||''));
          h.getRange(i+1,18).setValue(dec(e.parameter.cajaMyri||''));
          h.getRange(i+1,19).setValue(parseFloat(e.parameter.tipoCambio||0));
          return ok();
        }
      }
      return json({error:'no encontrado'});
    }
    if (accion === 'editarNotaPedido') {
      const h = ss.getSheetByName('Ventas'); if (!h) return json({error:'sin hoja'});
      const datos = h.getDataRange().getValues();
      for (let i = 1; i < datos.length; i++) {
        const cellId = datos[i][0] instanceof Date ? datos[i][0].toISOString() : datos[i][0].toString().trim();
        if (cellId === e.parameter.id) { h.getRange(i+1,7).setValue(dec(e.parameter.nota||'')); return ok(); }
      }
      return json({error:'no encontrado'});
    }
    if (accion === 'guardarNotaCliente') {
      const h = getOrCreate(ss, 'NotasClientes', ['Cliente','Nota','Actualizado']);
      const datos = h.getDataRange().getValues();
      const cliente = dec(e.parameter.cliente||'');
      const nota = dec(e.parameter.nota||'');
      const fecha = Utilities.formatDate(new Date(), TZ, 'dd/MM/yyyy HH:mm');
      for (let i = 1; i < datos.length; i++) {
        if (datos[i][0] === cliente) { h.getRange(i+1,2).setValue(nota); h.getRange(i+1,3).setValue(fecha); return ok(); }
      }
      h.appendRow([cliente, nota, fecha]);
      return ok();
    }
    if (accion === 'notasClientes') {
      const h = ss.getSheetByName('NotasClientes');
      if (!h || h.getLastRow() < 2) return json({});
      const datos = h.getDataRange().getValues();
      const result = {};
      for (let i = 1; i < datos.length; i++) { if (datos[i][0]) result[datos[i][0]] = datos[i][1]||''; }
      return json(result);
    }
    if (accion === 'gasto') {
      const h = getOrCreate(ss, 'Gastos', ['Fecha','Descripción','Monto','Moneda','Categoría','Columna']);
      const fecha = Utilities.formatDate(new Date(), TZ, 'dd/MM/yyyy HH:mm');
      const row = h.getLastRow() + 1;
      h.appendRow([fecha, dec(e.parameter.desc), parseFloat(e.parameter.monto||0), dec(e.parameter.moneda||'ARS'), dec(e.parameter.categoria||'General'), dec(e.parameter.columna||'')]);
      h.getRange(row,1).setNumberFormat('@'); return ok();
    }
    if (accion === 'rendicion') {
      const h = getOrCreate(ss, 'Rendiciones', ['Fecha','Descripción','Monto','Moneda','Columna']);
      const fecha = Utilities.formatDate(new Date(), TZ, 'dd/MM/yyyy HH:mm');
      const row = h.getLastRow() + 1;
      h.appendRow([fecha, dec(e.parameter.desc), parseFloat(e.parameter.monto||0), dec(e.parameter.moneda||'ARS'), dec(e.parameter.columna||'')]);
      h.getRange(row,1).setNumberFormat('@'); return ok();
    }
    // Liquidación entre socios (saldar la cuenta corriente Myri↔Jony). NO afecta el diezmo.
    // Monto en convención "Myri le debe a Jony": positivo = Myri saldó deuda hacia Jony; negativo = Jony saldó hacia Myri.
    if (accion === 'saldarSocios') {
      const h = getOrCreate(ss, 'LiquidacionSocios', ['Fecha','MontoARS','MontoUSD','Nota']);
      const fecha = Utilities.formatDate(new Date(), TZ, 'dd/MM/yyyy HH:mm');
      const montoARS = parseFloat(e.parameter.montoARS||0) || 0;
      const montoUSD = parseFloat(e.parameter.montoUSD||0) || 0;
      if (montoARS === 0 && montoUSD === 0) return json({error:'nada para saldar'});
      const row = h.getLastRow() + 1;
      h.appendRow([fecha, montoARS, montoUSD, dec(e.parameter.nota||'Saldo entre socios')]);
      h.getRange(row,1).setNumberFormat('@');
      return ok();
    }
    if (accion === 'getLiquidaciones') {
      const h = ss.getSheetByName('LiquidacionSocios');
      if (!h || h.getLastRow() < 2) return json({totalARS:0, totalUSD:0, movimientos:[]});
      const rows = h.getRange(2,1,h.getLastRow()-1,4).getValues();
      const movimientos = rows.map(r => ({
        fecha: r[0] instanceof Date ? Utilities.formatDate(r[0],TZ,'dd/MM/yyyy HH:mm') : r[0].toString(),
        montoARS: parseFloat(r[1])||0, montoUSD: parseFloat(r[2])||0, nota: (r[3]||'').toString()
      }));
      return json({
        totalARS: movimientos.reduce((s,m)=>s+m.montoARS,0),
        totalUSD: movimientos.reduce((s,m)=>s+m.montoUSD,0),
        movimientos
      });
    }
    // Pago a cuenta: pago parcial de un cliente con deuda en cuenta corriente.
    if (accion === 'registrarPagoCuenta') {
      const h = getOrCreate(ss, 'Pagos', ['Fecha','Cliente','PedidoId','MontoARS','MontoUSD','Caja','Nota','MontoPitz']);
      const fecha = Utilities.formatDate(new Date(), TZ, 'dd/MM/yyyy HH:mm');
      const montoARS = parseFloat(e.parameter.montoARS||0) || 0;
      const montoUSD = parseFloat(e.parameter.montoUSD||0) || 0;
      const montoPitz = parseFloat(e.parameter.montoPitz||0) || 0;  // parte ARS que es Pitzujim (resto = golosinas)
      if (montoARS === 0 && montoUSD === 0) return json({error:'monto vacío'});
      const row = h.getLastRow() + 1;
      h.appendRow([fecha, dec(e.parameter.cliente||''), dec(e.parameter.pedidoId||''), montoARS, montoUSD, dec(e.parameter.caja||''), dec(e.parameter.nota||'Pago a cuenta'), montoPitz]);
      h.getRange(row,1).setNumberFormat('@');
      return ok();
    }
    if (accion === 'getPagos') {
      const h = ss.getSheetByName('Pagos');
      if (!h || h.getLastRow() < 2) return json([]);
      const rows = h.getRange(2,1,h.getLastRow()-1,8).getValues();
      return json(rows.map(r => ({
        fecha: r[0] instanceof Date ? Utilities.formatDate(r[0],TZ,'dd/MM/yyyy HH:mm') : r[0].toString(),
        cliente: (r[1]||'').toString(), pedidoId: (r[2]||'').toString(),
        montoARS: parseFloat(r[3])||0, montoUSD: parseFloat(r[4])||0,
        caja: (r[5]||'').toString(), nota: (r[6]||'').toString(),
        montoPitz: parseFloat(r[7])||0
      })));
    }
    if (accion === 'notificacion') {
      const h = getOrCreate(ss, 'Notificaciones', ['Fecha','Producto ID','Producto','Nombre','Telefono','Estado','Modo']);
      if (h.getLastRow() > 1) {
        const datos = h.getDataRange().getValues();
        for (let i = 1; i < datos.length; i++) {
          if (datos[i][1].toString() === dec(e.parameter.productoId) &&
              String(datos[i][4]) === dec(e.parameter.telefono) &&
              datos[i][5] === 'pendiente') {
            return json({ok:true, duplicado:true});
          }
        }
      }
      const fecha = Utilities.formatDate(new Date(), TZ, 'dd/MM/yyyy HH:mm');
      const row = h.getLastRow() + 1;
      h.appendRow([fecha, dec(e.parameter.productoId), dec(e.parameter.producto), dec(e.parameter.nombre), dec(e.parameter.telefono), 'pendiente', dec(e.parameter.modoCliente||'mayorista')]);
      h.getRange(row,1).setNumberFormat('@');
      sendTwilioWA('+5491131754540', '🔔 *Lista de espera - Shuk Mamtakim*\n\n👤 ' + dec(e.parameter.nombre) + '\n📱 ' + dec(e.parameter.telefono) + '\n\n🛒 Quiere aviso cuando llegue:\n*' + dec(e.parameter.producto) + '*');
      return ok();
    }
    if (accion === 'notificaciones') {
      const h = ss.getSheetByName('Notificaciones');
      if (!h || h.getLastRow() < 2) return json([]);
      const nc = Math.min(7, h.getLastColumn());
      return json(h.getRange(2,1,h.getLastRow()-1,nc).getValues()
        .filter(r => r[5] === 'pendiente' || r[5] === 'notificado')
        .map(r => ({ fecha:r[0].toString(), productoId:r[1].toString(), producto:r[2], nombre:r[3], telefono:String(r[4]), estado:r[5], modoCliente:r[6]||'mayorista' })));
    }
    if (accion === 'marcarNotificado') {
      const h = ss.getSheetByName('Notificaciones'); if (!h) return ok();
      const datos = h.getDataRange().getValues();
      const pid = e.parameter.productoId; const tel = dec(e.parameter.telefono);
      for (let i = 1; i < datos.length; i++) {
        if (datos[i][1].toString() === pid && String(datos[i][4]) === tel && datos[i][5] === 'pendiente') {
          h.getRange(i+1,6).setValue('notificado');
        }
      }
      return ok();
    }
    if (accion === 'marcarComprado') {
      const h = ss.getSheetByName('Notificaciones'); if (!h) return ok();
      const datos = h.getDataRange().getValues();
      const pid = e.parameter.productoId; const tel = dec(e.parameter.telefono);
      for (let i = 1; i < datos.length; i++) {
        if (datos[i][1].toString() === pid && String(datos[i][4]) === tel) {
          h.getRange(i+1,6).setValue('comprado');
        }
      }
      return ok();
    }
    if (accion === 'eliminarNotificacion') {
      const h = ss.getSheetByName('Notificaciones'); if (!h) return ok();
      const datos = h.getDataRange().getValues();
      const pid = e.parameter.productoId; const tel = dec(e.parameter.telefono);
      for (let i = datos.length - 1; i >= 1; i--) {
        if (datos[i][1].toString() === pid && String(datos[i][4]) === tel) { h.deleteRow(i+1); }
      }
      return ok();
    }
    if (accion === 'ventas') {
      const h = ss.getSheetByName('Ventas'); if (!h || h.getLastRow() < 2) return json([]);
      const nc = Math.min(20, h.getLastColumn());
      return json(h.getRange(2,1,h.getLastRow()-1,nc).getValues().map((r,idx) => ({
        id: r[0] instanceof Date ? r[0].toISOString() : r[0].toString().trim(),
        fecha: r[1] instanceof Date ? Utilities.formatDate(r[1],TZ,'dd/MM/yyyy HH:mm') : r[1].toString(),
        cliente:r[2], tipo:r[3], productos:r[4], formaPago:r[5], notas:r[6],
        estado:r[7]||'pendiente', totalARS:r[8]||0, totalUSD:r[9]||0,
        nVenta:r[10]||(idx+1), arsJONY:r[11]||0, arsMyri:r[12]||0,
        usdMyri:r[13]||0, comiARS:r[14]||0, comiUSD:r[15]||0,
        cajaJony:r[16]||'', cajaMyri:r[17]||'', tipoCambio:r[18]||0, stockUpdates:r[19]||''
      })));
    }
    if (accion === 'gastos') {
      const h = ss.getSheetByName('Gastos'); if (!h || h.getLastRow() < 2) return json([]);
      const nc = Math.min(6, h.getLastColumn());
      return json(h.getRange(2,1,h.getLastRow()-1,nc).getValues().map(r => ({
        fecha: r[0] instanceof Date ? Utilities.formatDate(r[0],TZ,'dd/MM/yyyy HH:mm') : r[0].toString(),
        desc:r[1], monto:r[2], moneda:r[3], categoria:r[4], columna:r[5]||''
      })));
    }
    if (accion === 'rendiciones') {
      const h = ss.getSheetByName('Rendiciones'); if (!h || h.getLastRow() < 2) return json([]);
      return json(h.getRange(2,1,h.getLastRow()-1,5).getValues().map(r => ({
        fecha: r[0] instanceof Date ? Utilities.formatDate(r[0],TZ,'dd/MM/yyyy HH:mm') : r[0].toString(),
        desc:r[1], monto:r[2], moneda:r[3], columna:r[4]||''
      })));
    }
    if (accion === 'setStock') {
      var sh = ss.getSheetByName('Stock'); if (!sh) return json({error:'sin hoja'});
      var updates = dec(e.parameter.updates||''); var sd = sh.getDataRange().getValues();
      updates.split(',').forEach(function(u) {
        var parts = u.split(':'); var pid = parts[0]; var ns = parseInt(parts[1])||0;
        for (var i = 1; i < sd.length; i++) { if (sd[i][0].toString()===pid) { sh.getRange(i+1,6).setValue(ns); break; } }
      });
      return ok();
    }
    if (accion === 'agregarProducto') {
      const h = ss.getSheetByName('Stock'); if (!h) return json({error:'sin hoja Stock'});
      const datos = h.getDataRange().getValues();
      let maxId = 0;
      for (let i = 1; i < datos.length; i++) { const id = parseInt(datos[i][0])||0; if (id > maxId) maxId = id; }
      h.appendRow([maxId+1, dec(e.parameter.nombre), dec(e.parameter.desc),
        dec(e.parameter.pMay), parseFloat(e.parameter.pMin||0),
        parseInt(e.parameter.stock||0), dec(e.parameter.imagen||''), 'SI',
        dec(e.parameter.categoria||'Varios'), dec(e.parameter.visible||'Ambos'),
        0, '', 0, 0, dec(e.parameter.dueno||'Miri'), 'Ambos']);
      return ok();
    }
    if (accion === 'actualizarOferta') {
      const h = ss.getSheetByName('Stock'); if (!h) return json({error:'sin hoja Stock'});
      const datos = h.getDataRange().getValues();
      const pid = e.parameter.id;
      for (let i = 1; i < datos.length; i++) {
        if (datos[i][0].toString() === pid) {
          h.getRange(i+1, 11).setValue(parseFloat(e.parameter.precioOferta||0));
          h.getRange(i+1, 12).setValue(dec(e.parameter.fechaOferta||''));
          h.getRange(i+1, 13).setValue(parseInt(e.parameter.cantPack||0));
          h.getRange(i+1, 14).setValue(parseFloat(e.parameter.precioPack||0));
          h.getRange(i+1, 16).setValue(dec(e.parameter.visibleOferta||'Ambos'));
          return ok();
        }
      }
      return json({error:'no encontrado'});
    }
    if (accion === 'agregarCliente') {
      const h = getOrCreate(ss, 'Clientes', ['Fecha','Nombre','Telefono','Tipo','Nota']);
      const fecha = Utilities.formatDate(new Date(), TZ, 'dd/MM/yyyy HH:mm');
      h.appendRow([fecha, dec(e.parameter.nombre), dec(e.parameter.telefono||''), dec(e.parameter.tipo||'Mayorista'), dec(e.parameter.nota||'')]);
      return ok();
    }
    if (accion === 'registrarCompra') {
      const h = getOrCreate(ss, 'CostosJony', ['Fecha','ProductoId','Producto','Cantidad','CostoTotal','CostoUnitario']);
      const fecha = Utilities.formatDate(new Date(), TZ, 'dd/MM/yyyy HH:mm');
      const cantidad = parseFloat(dec(e.parameter.cantidad||0));
      const costoTotal = parseFloat(dec(e.parameter.costoTotal||0));
      h.appendRow([fecha, dec(e.parameter.productoId), dec(e.parameter.producto), cantidad, costoTotal, cantidad > 0 ? costoTotal/cantidad : 0]);
      return ok();
    }
    if (accion === 'getCompras') {
      const h = ss.getSheetByName('CostosJony');
      if (!h || h.getLastRow() < 2) return json([]);
      return json(h.getRange(2,1,h.getLastRow()-1,6).getValues().map(r => ({
        fecha: r[0] instanceof Date ? Utilities.formatDate(r[0],TZ,'dd/MM/yyyy HH:mm') : r[0].toString(),
        productoId: r[1].toString(), producto: r[2].toString(),
        cantidad: parseFloat(r[3])||0, costoTotal: parseFloat(r[4])||0, costoUnitario: parseFloat(r[5])||0
      })));
    }
    if (accion === 'getGanancias') {
      const h = ss.getSheetByName('GananciasJony');
      if (!h || h.getLastRow() < 2) return json({balance:0, movimientos:[]});
      const rows = h.getRange(2,1,h.getLastRow()-1,4).getValues();
      const movimientos = rows.map(r => ({
        fecha: r[0] instanceof Date ? Utilities.formatDate(r[0],TZ,'dd/MM/yyyy HH:mm') : r[0].toString(),
        tipo: r[1].toString(), descripcion: r[2].toString(), monto: parseFloat(r[3])||0
      }));
      return json({balance: movimientos.reduce((s,m) => s + m.monto, 0), movimientos});
    }
    if (accion === 'registrarRetiro') {
      const h = getOrCreate(ss, 'GananciasJony', ['Fecha','Tipo','Descripcion','Monto']);
      const fecha = Utilities.formatDate(new Date(), TZ, 'dd/MM/yyyy HH:mm');
      const balance = parseFloat(dec(e.parameter.balance||0));
      const diezmo = Math.round(balance * 0.10);
      const retiro = Math.round(balance - diezmo);
      h.appendRow([fecha, 'diezmo', 'Diezmo 10%', -diezmo]);
      h.appendRow([fecha, 'retiro', dec(e.parameter.nota||'Retiro de ganancias'), -retiro]);
      return json({ok:true, diezmo, retiro});
    }
    if (accion === 'setSaldoInicial') {
      const h = getOrCreate(ss, 'GananciasJony', ['Fecha','Tipo','Descripcion','Monto']);
      const fecha = Utilities.formatDate(new Date(), TZ, 'dd/MM/yyyy HH:mm');
      h.appendRow([fecha, 'saldo_inicial', 'Saldo inicial', parseFloat(dec(e.parameter.monto||0))]);
      return ok();
    }
    if (accion === 'notificarPedido') {
      const cliente = dec(e.parameter.cliente||'');
      const tipo = dec(e.parameter.tipo||'');
      const resumen = dec(e.parameter.resumen||'');
      sendTwilioWA('+5491131754540', '🛍️ *Nuevo pedido - Shuk Mamtakim*\n\n👤 *' + cliente + '* (' + tipo + ')\n\n' + resumen);
      return ok();
    }
    if (accion === 'editarCliente') {
      const h = ss.getSheetByName('Clientes');
      if (!h || h.getLastRow() < 2) return ok();
      const nombreOriginal = dec(e.parameter.nombreOriginal);
      const datos = h.getDataRange().getValues();
      for (let i = 1; i < datos.length; i++) {
        if (datos[i][1].toString() === nombreOriginal) {
          h.getRange(i+1, 2).setValue(dec(e.parameter.nombre));
          h.getRange(i+1, 3).setValue(dec(e.parameter.telefono||''));
          h.getRange(i+1, 4).setValue(dec(e.parameter.tipo||'Mayorista'));
          if (e.parameter.nota !== undefined) h.getRange(i+1, 5).setValue(dec(e.parameter.nota));
          return ok();
        }
      }
      return ok();
    }
    if (accion === 'getClientes') {
      const h = ss.getSheetByName('Clientes');
      if (!h || h.getLastRow() < 2) return json([]);
      const rows = h.getRange(2,1,h.getLastRow()-1,6).getValues();
      return json(rows.map(r => ({
        fecha: r[0] instanceof Date ? Utilities.formatDate(r[0],TZ,'dd/MM/yyyy HH:mm') : r[0].toString(),
        nombre: r[1].toString(),
        telefono: r[2].toString(),
        tipo: r[3].toString(),
        nota: r[4].toString(),
        ultimoAcceso: r[5] instanceof Date ? Utilities.formatDate(r[5],TZ,'dd/MM/yyyy HH:mm') : (r[5]||'').toString()
      })));
    }
    if (accion === 'registrarClienteMayorista') {
      const tel = dec(e.parameter.telefono||'').replace(/\D/g,'').slice(-10);
      const nombre = dec(e.parameter.nombre||'');
      if (!tel || !nombre) return json({error:'datos incompletos'});
      const h = getOrCreate(ss, 'Clientes', ['Fecha','Nombre','Telefono','Tipo','Nota','UltimoAcceso']);
      const datos = h.getDataRange().getValues();
      for (let i = 1; i < datos.length; i++) {
        const telGuardado = (datos[i][2]||'').toString().replace(/\D/g,'').slice(-10);
        if (telGuardado === tel) {
          h.getRange(i+1, 6).setValue(Utilities.formatDate(new Date(), TZ, 'dd/MM/yyyy HH:mm'));
          return json({ok:true, nuevo:false, nombre: datos[i][1]||nombre});
        }
      }
      const fecha = Utilities.formatDate(new Date(), TZ, 'dd/MM/yyyy HH:mm');
      const tipo = dec(e.parameter.tipo||'Mayorista');
      h.appendRow([fecha, nombre, tel, tipo, '', fecha]);
      return json({ok:true, nuevo:true});
    }
    if (accion === 'registrarVisita') {
      const h = getOrCreate(ss, 'Visitas', ['Fecha','Pagina']);
      const fecha = Utilities.formatDate(new Date(), TZ, 'dd/MM/yyyy HH:mm');
      h.appendRow([fecha, dec(e.parameter.pagina||'tienda')]);
      return ok();
    }
    if (accion === 'track')      { return registrarTrack(ss, e.parameter); }
    if (accion === 'getAnalitica') { return json(getAnalitica(ss, e.parameter)); }
    if (accion === 'getProductosDormidos') { return json(getProductosDormidos(ss, e.parameter)); }
    if (accion === 'preguntarIA') { return json(preguntarIA(ss, e.parameter)); }
    if (accion === 'guardarClaveIA') {
      const clave = dec(e.parameter.clave || '').trim();
      if (!clave.startsWith('sk-ant-')) return json({ error: 'Esa no parece una clave de Anthropic (empiezan con sk-ant-)' });
      PropertiesService.getScriptProperties().setProperty('ANTHROPIC_API_KEY', clave);
      return ok();
    }
    if (accion === 'visitas') {
      const h = ss.getSheetByName('Visitas');
      if (!h || h.getLastRow() < 2) return json([]);
      return json(h.getRange(2,1,h.getLastRow()-1,2).getValues().map(r => ({
        fecha: r[0] instanceof Date ? Utilities.formatDate(r[0],TZ,'dd/MM/yyyy HH:mm') : r[0].toString(),
        pagina: r[1].toString()
      })));
    }
    if (accion === 'enviarPush') {
      const titulo = dec(e.parameter.titulo||'🛍️ Shuk Mamtakim');
      const mensaje = dec(e.parameter.mensaje||'');
      if (!mensaje) return json({error:'sin mensaje'});
      UrlFetchApp.fetch('https://api.onesignal.com/notifications', {
        method: 'post',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Key os_v2_app_bzffawgxufafxbwjq2xeffakwte3mjhkcfje2qevxjorgj4osj3vac6be2h2xriszbv7b7okaqv6ug4v6e4omyx6p6u74imuvhszyei' },
        payload: JSON.stringify({ app_id: '0e4a5058-d7a1-405b-86c9-86ae42940ab4', included_segments: ['All'], headings: { es: titulo, en: titulo }, contents: { es: mensaje, en: mensaje }, url: 'https://shuk-mamtakim.vercel.app/' }),
        muteHttpExceptions: true
      });
      return ok();
    }

    // ─── SISTEMA HIJOS ────────────────────────────────────────────────────────
    if (accion === 'getCatalogoHijos')     { return json(getCatalogoHijos(ss)); }
    if (accion === 'registrarVentaHijos')  { return json(registrarVentaHijos(ss, e.parameter)); }
    if (accion === 'registrarPagoCliente') { return json(registrarPagoCliente(ss, e.parameter)); }
    if (accion === 'registrarVueltoCC')    { return json(registrarVueltoCC(ss, e.parameter)); }
    if (accion === 'registrarPagoVuelto')  { return json(registrarPagoVuelto(ss, e.parameter)); }
    if (accion === 'consultarDeudores')    { return json(consultarDeudores(ss, e.parameter)); }
    if (accion === 'consultarDeudaCliente'){ return json(consultarDeudaCliente(ss, e.parameter)); }
    if (accion === 'ventasHoy')            { return json(ventasHoyHijos(ss, e.parameter)); }
    if (accion === 'ventasPeriodo')        { return json(ventasPeriodo(ss, e.parameter)); }
    if (accion === 'historialCliente')     { return json(historialCliente(ss, e.parameter)); }
    if (accion === 'cargarStock')          { return json(cargarStock(ss, e.parameter)); }
    if (accion === 'getStockDia')          { return json(getStockDia(ss, e.parameter)); }
    if (accion === 'resetearStockDia')     { return json(resetearStockDia(ss, e.parameter)); }
    if (accion === 'agregarProductoHijo')  { return json(agregarProductoHijo(ss, e.parameter)); }
    if (accion === 'editarProductoHijo')   { return json(editarProductoHijo(ss, e.parameter)); }
    if (accion === 'eliminarProductoHijo') { return json(eliminarProductoHijo(ss, e.parameter)); }
    if (accion === 'eliminarVentaHijos')   { return json(eliminarVentaHijos(ss, e.parameter)); }
    if (accion === 'editarVentaHijos')     { return json(editarVentaHijos(ss, e.parameter)); }
    if (accion === 'getProveedoresHijos')  { return json(getProveedoresHijos(ss)); }
    if (accion === 'agregarProveedorHijos'){ return json(agregarProveedorHijos(ss, e.parameter)); }
    if (accion === 'editarProveedorHijos') { return json(editarProveedorHijos(ss, e.parameter)); }
    if (accion === 'eliminarProveedorHijos'){ return json(eliminarProveedorHijos(ss, e.parameter)); }
    if (accion === 'registrarCompraHijos') { return json(registrarCompraHijos(ss, e.parameter)); }
    if (accion === 'getComprasHijos')      { return json(getComprasHijos(ss)); }
    if (accion === 'getDepositoHijos')     { return json(getDepositoHijos(ss)); }
    if (accion === 'panelHijos')           { return json(panelHijos(ss, e.parameter)); }
    if (accion === 'comprasTabHijos')      { return json({ proveedores: getProveedoresHijos(ss), compras: getComprasHijos(ss), deposito: getDepositoHijos(ss) }); }

  } catch(err) { return json({error:err.toString()}); }
}

function dec(v){try{return decodeURIComponent(v||'');}catch(e){return v||'';}}
function ok(){return json({ok:true});}
function json(d){return ContentService.createTextOutput(JSON.stringify(d)).setMimeType(ContentService.MimeType.JSON);}
function getOrCreate(ss,nombre,headers){let h=ss.getSheetByName(nombre);if(!h){h=ss.insertSheet(nombre);h.appendRow(headers);h.getRange(1,1,1,headers.length).setFontWeight('bold');}return h;}
function getCostoPromedio(ss, productoId) {
  const h = ss.getSheetByName('CostosJony');
  if (!h || h.getLastRow() < 2) return 0;
  const data = h.getDataRange().getValues();
  let totalUnits = 0, totalCost = 0;
  for (let i = 1; i < data.length; i++) {
    if (data[i][1].toString() === productoId.toString()) {
      totalUnits += parseFloat(data[i][3]) || 0;
      totalCost += parseFloat(data[i][4]) || 0;
    }
  }
  return totalUnits > 0 ? totalCost / totalUnits : 0;
}
function sendTwilioWA(to, body) {
  const props = PropertiesService.getScriptProperties();
  const SID = props.getProperty('TWILIO_SID');
  const TOKEN = props.getProperty('TWILIO_TOKEN');
  const FROM = props.getProperty('TWILIO_FROM') || 'whatsapp:+14155238886';
  if (!SID || !TOKEN) return;
  try {
    UrlFetchApp.fetch('https://api.twilio.com/2010-04-01/Accounts/' + SID + '/Messages.json', {
      method: 'post',
      headers: { Authorization: 'Basic ' + Utilities.base64Encode(SID + ':' + TOKEN) },
      payload: { From: FROM, To: 'whatsapp:' + to, Body: body },
      muteHttpExceptions: true
    });
  } catch(err) {}
}

// ─── FUNCIONES HIJOS ──────────────────────────────────────────────────────────

function getCatalogoHijos(ss) {
  const h = ss.getSheetByName('CatalogoHijos');
  if (!h || h.getLastRow() < 2) return [];
  return h.getRange(2,1,h.getLastRow()-1,5).getValues()
    .filter(r => r[0])
    .map(r => ({ codigo:r[0].toString(), nombre:r[1].toString(), precioVenta:parseFloat(r[2])||0, costo:parseFloat(r[3])||0, foto:r[4]?.toString()||'' }));
}

function agregarProductoHijo(ss, p) {
  const h = getOrCreate(ss, 'CatalogoHijos', ['Codigo','Nombre','PrecioVenta','Costo','Foto']);
  h.appendRow([dec(p.codigo), dec(p.nombre), parseFloat(p.precioVenta)||0, parseFloat(p.costo)||0, dec(p.foto||'')]);
  return { ok: true };
}

function editarProductoHijo(ss, p) {
  const h = ss.getSheetByName('CatalogoHijos'); if (!h) return { error:'sin hoja' };
  const codigo = dec(p.codigo);
  const nuevoCodigo = dec(p.nuevoCodigo || '') || codigo;
  const datos = h.getDataRange().getValues();
  if (nuevoCodigo !== codigo) {
    for (let i = 1; i < datos.length; i++) {
      if (datos[i][0].toString() === nuevoCodigo) return { error:'ya existe un producto con ese código' };
    }
  }
  for (let i = 1; i < datos.length; i++) {
    if (datos[i][0].toString() === codigo) {
      h.getRange(i+1,1).setValue(nuevoCodigo);
      h.getRange(i+1,2).setValue(dec(p.nombre));
      h.getRange(i+1,3).setValue(parseFloat(p.precioVenta)||0);
      h.getRange(i+1,4).setValue(parseFloat(p.costo)||0);
      h.getRange(i+1,5).setValue(dec(p.foto||''));
      if (nuevoCodigo !== codigo) renombrarCodigoHijos_(ss, codigo, nuevoCodigo);
      return { ok: true };
    }
  }
  return { error:'no encontrado' };
}

// El código es la llave que une todo: al cambiarlo hay que propagarlo a las
// hojas que lo referencian para no dejar huérfanos ventas/stock/compras/depósito.
function renombrarCodigoHijos_(ss, viejo, nuevo) {
  [['VentasHijos',4],['StockDiario',3],['ComprasHijos',5],['DepositoHijos',1]].forEach(par => {
    const h = ss.getSheetByName(par[0]);
    if (!h || h.getLastRow() < 2) return;
    const col = par[1];
    const vals = h.getRange(2,col,h.getLastRow()-1,1).getValues();
    vals.forEach((r,i) => {
      if (r[0] && r[0].toString() === viejo) h.getRange(i+2,col).setValue(nuevo);
    });
  });
}

function eliminarProductoHijo(ss, p) {
  const h = ss.getSheetByName('CatalogoHijos'); if (!h) return { error:'sin hoja' };
  const datos = h.getDataRange().getValues();
  for (let i = datos.length - 1; i >= 1; i--) {
    if (datos[i][0].toString() === dec(p.codigo)) { h.deleteRow(i+1); return { ok: true }; }
  }
  return { error:'no encontrado' };
}

function registrarVentaHijos(ss, p) {
  const h = getOrCreate(ss, 'VentasHijos', ['Fecha','Hijo','Producto','Codigo','Cantidad','Precio','Total','Cliente','EsDebe','PagoParcial','SaldoPendiente']);
  // Soporte para fecha personalizada (ventas retroactivas)
  const fecha = p.fecha ? new Date(p.fecha + 'T12:00:00') : new Date();
  h.appendRow([fecha, p.hijo, dec(p.productoNombre), dec(p.productoCodigo), parseInt(p.cantidad)||1,
    parseFloat(p.precio)||0, parseFloat(p.total)||0, dec(p.cliente||''),
    p.esDebe||'NO', parseFloat(p.pagoParcial)||0, parseFloat(p.saldoPendiente)||0]);
  if (parseFloat(p.saldoPendiente) > 0 && p.cliente) {
    const prodLabel = dec(p.productoNombre) + (parseInt(p.cantidad) > 1 ? ' x' + parseInt(p.cantidad) : '');
    registrarMovimientoCC(ss, p.hijo, dec(p.cliente), parseFloat(p.saldoPendiente), 'deuda', prodLabel);
  }
  return { ok: true };
}

function registrarPagoCliente(ss, p) {
  const hijo = p.hijo; const cliente = dec(p.cliente);
  const saldoActual = getSaldoCliente(ss, hijo, cliente);
  const montoPago = p.monto === 'todo' ? saldoActual : parseFloat(p.monto)||0;
  registrarMovimientoCC(ss, hijo, cliente, -montoPago, 'pago');
  return { ok: true, saldoRestante: saldoActual - montoPago };
}

function registrarVueltoCC(ss, p) {
  // El cliente pagó de más — le debemos cambio (monto negativo en CC)
  if (!p.cliente || !p.monto) return { ok: false };
  registrarMovimientoCC(ss, p.hijo, dec(p.cliente), -(parseFloat(p.monto)||0), 'vuelto', dec(p.producto||''));
  return { ok: true };
}

function registrarPagoVuelto(ss, p) {
  // Le devolvimos el cambio al cliente (cancela el vuelto pendiente)
  if (!p.monto) return { ok: false };
  const saldo = getSaldoCliente(ss, p.hijo, dec(p.cliente));
  const monto = p.monto === 'todo' ? Math.abs(saldo) : parseFloat(p.monto)||0;
  registrarMovimientoCC(ss, p.hijo, dec(p.cliente), monto, 'pago_vuelto');
  return { ok: true };
}

function consultarDeudores(ss, p) {
  const h = ss.getSheetByName('CCHijos'); if (!h || h.getLastRow() < 2) return [];
  const datos = h.getRange(2,1,h.getLastRow()-1,5).getValues();
  const saldos = {};
  datos.filter(r => r[1] === p.hijo && r[2]).forEach(r => {
    const c = r[2].toString().toLowerCase();
    if (!saldos[c]) saldos[c] = { cliente: r[2], saldo: 0 };
    saldos[c].saldo += parseFloat(r[3])||0;
  });
  // Devuelve positivos (nos deben) Y negativos (les debemos vuelto)
  return Object.values(saldos)
    .filter(x => Math.abs(x.saldo) > 0.01)
    .sort((a,b) => Math.abs(b.saldo) - Math.abs(a.saldo));
}

function consultarDeudaCliente(ss, p) {
  const saldo = getSaldoCliente(ss, p.hijo, dec(p.cliente));
  const h = ss.getSheetByName('CCHijos'); const detalle = [];
  if (h && h.getLastRow() > 1) {
    h.getRange(2,1,h.getLastRow()-1,5).getValues()
      .filter(r => r[1] === p.hijo && r[2]?.toString().toLowerCase() === dec(p.cliente).toLowerCase() && parseFloat(r[3]) > 0)
      .slice(-5).forEach(r => detalle.push({
        fecha: r[0] instanceof Date ? Utilities.formatDate(r[0],TZ,'dd/MM') : r[0].toString(),
        producto: r[4]||'deuda', monto: parseFloat(r[3])
      }));
  }
  return { saldo, detalle };
}

function ventasHoyHijos(ss, p) {
  const h = ss.getSheetByName('VentasHijos'); if (!h || h.getLastRow() < 2) return [];
  const hoyStr = Utilities.formatDate(new Date(), TZ, 'dd/MM/yyyy');
  return h.getRange(2,1,h.getLastRow()-1,11).getValues()
    .filter(r => {
      if (!r[0]) return false;
      let fechaStr;
      if (r[0] && typeof r[0].getTime === 'function') {
        fechaStr = Utilities.formatDate(r[0], TZ, 'dd/MM/yyyy');
      } else {
        fechaStr = r[0].toString().trim().substring(0, 10);
      }
      return r[1] === p.hijo && fechaStr === hoyStr;
    })
    .map(r => ({ producto:r[2], codigo:r[3], cantidad:r[4], precio:r[5], cliente:r[7], saldoPendiente:r[10] }));
}

function ventasPeriodo(ss, p) {
  const h = ss.getSheetByName('VentasHijos'); if (!h || h.getLastRow() < 2) return [];
  const rows = h.getRange(2,1,h.getLastRow()-1,11).getValues();
  return rows
    .map((r, idx) => {
      if (!r[0] || (p.hijo && r[1] !== p.hijo)) return null;
      let fecha;
      if (r[0] && typeof r[0].getTime === 'function') {
        fecha = Utilities.formatDate(r[0], TZ, 'dd/MM/yyyy');
      } else {
        fecha = r[0].toString().trim().substring(0, 10);
      }
      return {
        rowIndex: idx + 2,
        fecha, hijo: r[1], producto: r[2], codigo: r[3],
        cantidad: r[4], precio: r[5], total: r[6],
        cliente: r[7], esDebe: r[8], pagoParcial: r[9], saldoPendiente: r[10]
      };
    })
    .filter(r => r !== null);
}

function eliminarVentaHijos(ss, p) {
  const h = ss.getSheetByName('VentasHijos');
  if (!h) return { error: 'sin hoja' };
  const rowIndex = parseInt(p.rowIndex);
  if (!rowIndex || rowIndex < 2) return { error: 'fila inválida' };
  const row = h.getRange(rowIndex, 1, 1, 11).getValues()[0];
  if (row[1] !== p.hijo) return { error: 'no autorizado' };
  const saldo = parseFloat(row[10]) || 0;
  if (saldo > 0 && row[7]) {
    registrarMovimientoCC(ss, row[1], row[7].toString(), -saldo, 'anulacion', row[2]);
  }
  h.deleteRow(rowIndex);
  return { ok: true };
}

function editarVentaHijos(ss, p) {
  const h = ss.getSheetByName('VentasHijos');
  if (!h) return { error: 'sin hoja' };
  const rowIndex = parseInt(p.rowIndex);
  if (!rowIndex || rowIndex < 2) return { error: 'fila inválida' };
  const row = h.getRange(rowIndex, 1, 1, 11).getValues()[0];
  if (row[1] !== p.hijo) return { error: 'no autorizado' };
  const oldSaldo = parseFloat(row[10]) || 0;
  const oldCliente = (row[7] || '').toString();
  const newNombre = dec(p.productoNombre || row[2]);
  const newCodigo = dec(p.productoCodigo || row[3]);
  const newCantidad = parseInt(p.cantidad) || parseInt(row[4]) || 1;
  const newPrecio = parseFloat(p.precio) || parseFloat(row[5]) || 0;
  const newTotal = newCantidad * newPrecio;
  const newCliente = dec(p.cliente !== undefined ? p.cliente : oldCliente);
  const newSaldo = parseFloat(p.saldoPendiente) || 0;
  h.getRange(rowIndex, 3).setValue(newNombre);
  h.getRange(rowIndex, 4).setValue(newCodigo);
  h.getRange(rowIndex, 5).setValue(newCantidad);
  h.getRange(rowIndex, 6).setValue(newPrecio);
  h.getRange(rowIndex, 7).setValue(newTotal);
  h.getRange(rowIndex, 8).setValue(newCliente);
  h.getRange(rowIndex, 9).setValue(newSaldo > 0 ? 'SI' : 'NO');
  h.getRange(rowIndex, 11).setValue(newSaldo);
  if (oldSaldo > 0 && oldCliente) {
    registrarMovimientoCC(ss, row[1], oldCliente, -oldSaldo, 'correccion', row[2]);
  }
  if (newSaldo > 0 && newCliente) {
    registrarMovimientoCC(ss, row[1], newCliente, newSaldo, 'correccion', newNombre);
  }
  return { ok: true };
}

function getSaldoCliente(ss, hijo, cliente) {
  const h = ss.getSheetByName('CCHijos'); if (!h || h.getLastRow() < 2) return 0;
  let saldo = 0;
  h.getRange(2,1,h.getLastRow()-1,5).getValues()
    .filter(r => r[1] === hijo && r[2]?.toString().toLowerCase() === cliente.toLowerCase())
    .forEach(r => { saldo += parseFloat(r[3])||0; });
  return saldo; // positivo = nos deben, negativo = les debemos vuelto
}

function registrarMovimientoCC(ss, hijo, cliente, monto, desc, producto) {
  const h = getOrCreate(ss, 'CCHijos', ['Fecha','Hijo','Cliente','Monto','Descripcion','Producto']);
  h.appendRow([new Date(), hijo, cliente, monto, desc, producto || '']);
}

function historialCliente(ss, p) {
  const h = ss.getSheetByName('CCHijos');
  if (!h || h.getLastRow() < 2) return [];
  const clienteLC = dec(p.cliente).toLowerCase();
  const nCols = h.getLastColumn();
  return h.getRange(2, 1, h.getLastRow() - 1, nCols).getValues()
    .filter(r => r[1] === p.hijo && r[2] && r[2].toString().toLowerCase() === clienteLC)
    .sort((a, b) => {
      const ta = a[0] instanceof Date ? a[0].getTime() : 0;
      const tb = b[0] instanceof Date ? b[0].getTime() : 0;
      return tb - ta;
    })
    .map(r => ({
      fecha: r[0] instanceof Date ? Utilities.formatDate(r[0], TZ, 'dd/MM HH:mm') : r[0].toString(),
      monto: parseFloat(r[3]) || 0,
      tipo: r[4] || '',
      producto: r[5] ? r[5].toString() : ''
    }));
}

function cargarStock(ss, p) {
  const h = getOrCreate(ss, 'StockDiario', ['Fecha','Hijo','Codigo','Producto','Cantidad']);
  const items = JSON.parse(dec(p.items || '[]'));
  const fecha = new Date();
  items.forEach(item => {
    if (item.codigo && item.cantidad > 0) {
      const cant = parseInt(item.cantidad) || 0;
      h.appendRow([fecha, p.hijo, item.codigo, item.nombre || '', cant]);
      // Lo que se lleva para vender sale del depósito compartido.
      ajustarDeposito_(ss, item.codigo, item.nombre || '', -cant);
    }
  });
  return { ok: true };
}

function getStockDia(ss, p) {
  const h = ss.getSheetByName('StockDiario');
  if (!h || h.getLastRow() < 2) return {};
  const hoyStr = Utilities.formatDate(new Date(), TZ, 'dd/MM/yyyy');
  const stock = {};
  h.getRange(2, 1, h.getLastRow() - 1, 5).getValues()
    .filter(r => r[0] && typeof r[0].getTime === 'function' &&
                 Utilities.formatDate(r[0], TZ, 'dd/MM/yyyy') === hoyStr &&
                 r[1] === p.hijo)
    .forEach(r => {
      const cod = r[2].toString();
      stock[cod] = (stock[cod] || 0) + (parseInt(r[4]) || 0);
    });
  return stock;
}

function resetearStockDia(ss, p) {
  const h = ss.getSheetByName('StockDiario');
  if (!h || h.getLastRow() < 2) return { ok: true };
  const hoyStr = Utilities.formatDate(new Date(), TZ, 'dd/MM/yyyy');
  const datos = h.getRange(2, 1, h.getLastRow() - 1, 5).getValues();
  for (let i = datos.length - 1; i >= 0; i--) {
    const r = datos[i];
    if (r[0] && typeof r[0].getTime === 'function' &&
        Utilities.formatDate(r[0], TZ, 'dd/MM/yyyy') === hoyStr &&
        r[1] === p.hijo) {
      // Al borrar la carga del día, la mercadería vuelve al depósito.
      ajustarDeposito_(ss, r[2].toString(), r[3] ? r[3].toString() : '', parseInt(r[4]) || 0);
      h.deleteRow(i + 2);
    }
  }
  return { ok: true };
}

// Batch: todo lo que necesita el panel de los chicos en UNA sola llamada
// (antes eran 5 requests; cada request a Apps Script cuesta 1-4 segundos).
function panelHijos(ss, p) {
  return {
    ventas: ventasHoyHijos(ss, p),
    deudores: consultarDeudores(ss, p),
    catalogo: getCatalogoHijos(ss),
    stockDia: getStockDia(ss, p),
    visitas: visitasHijoResumen_(ss, (p.hijo || '').toLowerCase())
  };
}

// Cuenta las visitas en el servidor: antes viajaba la lista completa de visitas
// al browser (crece sin límite) solo para contar hoy y total.
function visitasHijoResumen_(ss, pagina) {
  const h = ss.getSheetByName('Visitas');
  if (!h || h.getLastRow() < 2) return { hoy: 0, total: 0 };
  const hoyStr = Utilities.formatDate(new Date(), TZ, 'dd/MM/yyyy');
  let hoy = 0, total = 0;
  h.getRange(2,1,h.getLastRow()-1,2).getValues().forEach(r => {
    if ((r[1] || '').toString() !== pagina) return;
    total++;
    const f = r[0] instanceof Date ? Utilities.formatDate(r[0], TZ, 'dd/MM/yyyy') : r[0].toString().substring(0,10);
    if (f === hoyStr) hoy++;
  });
  return { hoy, total };
}

// ─── ANALÍTICA DE TRÁFICO (anónima; identidad solo si el visitante la deja) ───
// Cada visitante tiene un ID anónimo (vid) generado en su navegador. Eso permite
// reconocer al MISMO dispositivo cuando vuelve, sin saber quién es. Si en algún
// momento hace un pedido o se registra, el nombre/teléfono se atan a su vid.
// NO se guarda la IP cruda: la ciudad aproximada la calcula el navegador.
function registrarTrack(ss, p) {
  const h = getOrCreate(ss, 'Trafico',
    ['Fecha','VID','Pagina','Evento','Origen','Dispositivo','Ciudad','Region','Pais','Nombre','Telefono','Detalle']);
  if (h.getRange(1, 12).getValue() !== 'Detalle') h.getRange(1, 12).setValue('Detalle');
  h.appendRow([new Date(), dec(p.vid||''), dec(p.pagina||'tienda'), dec(p.evento||'visita'),
    dec(p.origen||'directo'), dec(p.dispositivo||''), dec(p.ciudad||''), dec(p.region||''),
    dec(p.pais||''), dec(p.nombre||''), dec(p.telefono||''), dec(p.producto||'')]);
  // Compatibilidad con el contador simple de visitas existente
  if ((p.evento||'visita') === 'visita') {
    const v = getOrCreate(ss, 'Visitas', ['Fecha','Pagina']);
    v.appendRow([Utilities.formatDate(new Date(), TZ, 'dd/MM/yyyy HH:mm'), dec(p.pagina||'tienda')]);
  }
  return ok();
}

function getAnalitica(ss, p) {
  const h = ss.getSheetByName('Trafico');
  if (!h || h.getLastRow() < 2) return { vacio: true };
  const dias = parseInt(p.dias) || 0;   // 0 = todo
  const desde = dias > 0 ? new Date(Date.now() - dias * 86400000) : null;
  const nCols = Math.max(h.getLastColumn(), 11);
  const filas = h.getRange(2,1,h.getLastRow()-1,nCols).getValues()
    .filter(r => r[0] instanceof Date && (!desde || r[0] >= desde));

  const resumen = { visitas:0, unicos:0, nuevos:0, recurrentes:0, tienda:0, mayorista:0 };
  const porOrigen = {}, porDispositivo = {}, porCiudad = {}, porHora = new Array(24).fill(0), porDia = {};
  const embudoVids = { visita:{}, carrito:{}, checkout:{}, pedido:{} };
  const vids = {};            // vid -> { visitas, fechas:Set, nombre, telefono, ciudad, origen, pagina, primera, ultima }

  const carritosPorVid = {};   // vid -> { productos:{}, ultimaCarrito, ultimoPedido, etapa }
  filas.forEach(r => {
    const [fecha, vid, pagina, evento, origen, disp, ciudad, region, pais, nombre, tel] = r;
    const detalle = r[11] ? r[11].toString() : '';
    if (vid && (evento === 'carrito' || evento === 'checkout' || evento === 'pedido')) {
      if (!carritosPorVid[vid]) carritosPorVid[vid] = { productos:{}, ultimaCarrito:null, ultimoPedido:null, etapa:'carrito' };
      const c = carritosPorVid[vid];
      if (evento === 'pedido') { c.ultimoPedido = fecha; }
      else {
        if (!c.ultimaCarrito || fecha > c.ultimaCarrito) c.ultimaCarrito = fecha;
        if (evento === 'checkout') c.etapa = 'checkout';
        if (detalle) c.productos[detalle] = 1;
      }
    }
    if (evento === 'visita') {
      resumen.visitas++;
      resumen[pagina === 'mayorista' ? 'mayorista' : 'tienda']++;
      porOrigen[origen||'directo'] = (porOrigen[origen||'directo']||0) + 1;
      if (disp) porDispositivo[disp] = (porDispositivo[disp]||0) + 1;
      if (ciudad) porCiudad[ciudad] = (porCiudad[ciudad]||0) + 1;
      porHora[fecha.getHours()]++;
      const dk = Utilities.formatDate(fecha, TZ, 'yyyy-MM-dd');
      porDia[dk] = (porDia[dk]||0) + 1;
    }
    if (embudoVids[evento] && vid) embudoVids[evento][vid] = 1;
    if (vid) {
      if (!vids[vid]) vids[vid] = { visitas:0, fechas:{}, nombre:'', telefono:'', ciudad:'', origen:origen, pagina:pagina, primera:fecha, ultima:fecha };
      const o = vids[vid];
      if (evento === 'visita') o.visitas++;
      o.fechas[Utilities.formatDate(fecha, TZ, 'yyyy-MM-dd')] = 1;
      if (nombre && !o.nombre) o.nombre = nombre;
      if (tel && !o.telefono) o.telefono = tel;
      if (ciudad && !o.ciudad) o.ciudad = ciudad;
      if (fecha < o.primera) o.primera = fecha;
      if (fecha > o.ultima) o.ultima = fecha;
    }
  });

  const listaVids = Object.keys(vids);
  resumen.unicos = listaVids.length;
  listaVids.forEach(v => {
    if (Object.keys(vids[v].fechas).length >= 2) resumen.recurrentes++; else resumen.nuevos++;
  });

  // Leads: visitantes que en algún momento dejaron nombre o teléfono
  const leads = listaVids.filter(v => vids[v].nombre || vids[v].telefono)
    .map(v => ({
      nombre: vids[v].nombre || '(sin nombre)', telefono: vids[v].telefono || '',
      ciudad: vids[v].ciudad, origen: vids[v].origen, pagina: vids[v].pagina,
      visitas: vids[v].visitas,
      ultima: Utilities.formatDate(vids[v].ultima, TZ, 'dd/MM/yyyy HH:mm')
    }))
    .sort((a,b) => b.visitas - a.visitas);

  const topCiudades = Object.entries(porCiudad).sort((a,b)=>b[1]-a[1]).slice(0,8)
    .map(([nombre,n]) => ({ nombre, n }));
  const dias30 = Object.entries(porDia).sort((a,b)=>a[0]<b[0]?-1:1).map(([fecha,n]) => ({ fecha, n }));
  const embudo = {
    visita: Object.keys(embudoVids.visita).length,
    carrito: Object.keys(embudoVids.carrito).length,
    checkout: Object.keys(embudoVids.checkout).length,
    pedido: Object.keys(embudoVids.pedido).length
  };

  // Carritos abandonados: agregó al carrito (o llegó al checkout) y no hay
  // pedido posterior. Ventas casi cerradas para recuperar por WhatsApp.
  const abandonados = Object.keys(carritosPorVid)
    .filter(v => {
      const c = carritosPorVid[v];
      return c.ultimaCarrito && (!c.ultimoPedido || c.ultimoPedido < c.ultimaCarrito);
    })
    .map(v => {
      const c = carritosPorVid[v];
      const info = vids[v] || {};
      return {
        nombre: info.nombre || '', telefono: info.telefono || '',
        ciudad: info.ciudad || '', etapa: c.etapa,
        productos: Object.keys(c.productos).slice(0, 6),
        cuando: Utilities.formatDate(c.ultimaCarrito, TZ, 'dd/MM HH:mm'),
        ts: c.ultimaCarrito.getTime()
      };
    })
    .sort((a,b) => b.ts - a.ts)
    .slice(0, 30);

  return { resumen, porOrigen, porDispositivo, topCiudades, porHora, dias30, embudo, leads, abandonados };
}

// ─── PROVEEDORES Y COMPRAS (depósito compartido de los hijos) ─────────────────

function getProveedoresHijos(ss) {
  const h = ss.getSheetByName('ProveedoresHijos');
  if (!h || h.getLastRow() < 2) return [];
  return h.getRange(2,1,h.getLastRow()-1,4).getValues()
    .filter(r => r[0])
    .map(r => ({ id:r[0].toString(), nombre:r[1].toString(), telefono:r[2]?.toString()||'', notas:r[3]?.toString()||'' }));
}

function agregarProveedorHijos(ss, p) {
  if (!p.nombre) return { error:'falta nombre' };
  const h = getOrCreate(ss, 'ProveedoresHijos', ['ID','Nombre','Telefono','Notas']);
  const id = 'PR' + Date.now();
  h.appendRow([id, dec(p.nombre), dec(p.telefono||''), dec(p.notas||'')]);
  return { ok:true, id };
}

function editarProveedorHijos(ss, p) {
  const h = ss.getSheetByName('ProveedoresHijos'); if (!h) return { error:'sin hoja' };
  const datos = h.getDataRange().getValues();
  for (let i = 1; i < datos.length; i++) {
    if (datos[i][0].toString() === p.id) {
      h.getRange(i+1,2,1,3).setValues([[dec(p.nombre), dec(p.telefono||''), dec(p.notas||'')]]);
      return { ok:true };
    }
  }
  return { error:'no encontrado' };
}

function eliminarProveedorHijos(ss, p) {
  const h = ss.getSheetByName('ProveedoresHijos'); if (!h) return { error:'sin hoja' };
  const datos = h.getDataRange().getValues();
  for (let i = datos.length - 1; i >= 1; i--) {
    if (datos[i][0].toString() === p.id) { h.deleteRow(i+1); return { ok:true }; }
  }
  return { error:'no encontrado' };
}

// Registra una compra a proveedor: suma cada item al depósito compartido y
// recalcula el costo del producto como promedio ponderado de todas sus compras.
function registrarCompraHijos(ss, p) {
  const items = JSON.parse(dec(p.items || '[]'));
  if (!items.length) return { error:'sin items' };
  const h = getOrCreate(ss, 'ComprasHijos',
    ['CompraID','Fecha','ProveedorID','Proveedor','Codigo','Producto','Cantidad','CostoUnit','CostoTotal','RegistradoPor']);
  const id = 'C' + Date.now();
  const fecha = p.fecha ? new Date(p.fecha + 'T12:00:00') : new Date();
  items.forEach(it => {
    const cant = parseInt(it.cantidad) || 0;
    const costo = parseFloat(it.costoUnit) || 0;
    if (!it.codigo || cant <= 0) return;
    h.appendRow([id, fecha, dec(p.proveedorId||''), dec(p.proveedor||''), it.codigo, it.nombre||'', cant, costo, cant*costo, p.hijo||'']);
    ajustarDeposito_(ss, it.codigo, it.nombre||'', cant);
    actualizarCostoPromedio_(ss, it.codigo);
  });
  return { ok:true, id };
}

function getComprasHijos(ss) {
  const h = ss.getSheetByName('ComprasHijos');
  if (!h || h.getLastRow() < 2) return [];
  const compras = {};
  const orden = [];
  h.getRange(2,1,h.getLastRow()-1,10).getValues().forEach(r => {
    if (!r[0]) return;
    const id = r[0].toString();
    if (!compras[id]) {
      compras[id] = {
        id,
        fecha: r[1] instanceof Date ? Utilities.formatDate(r[1], TZ, 'dd/MM/yyyy') : r[1].toString(),
        proveedor: r[3] ? r[3].toString() : '',
        items: [], total: 0
      };
      orden.push(id);
    }
    compras[id].items.push({ codigo:r[4].toString(), nombre:r[5]?.toString()||'', cantidad:parseInt(r[6])||0, costoUnit:parseFloat(r[7])||0 });
    compras[id].total += parseFloat(r[8]) || 0;
  });
  return orden.reverse().slice(0, 30).map(id => compras[id]);
}

function getDepositoHijos(ss) {
  const h = ss.getSheetByName('DepositoHijos');
  if (!h || h.getLastRow() < 2) return [];
  return h.getRange(2,1,h.getLastRow()-1,3).getValues()
    .filter(r => r[0])
    .map(r => ({ codigo:r[0].toString(), producto:r[1]?.toString()||'', cantidad:parseInt(r[2])||0 }));
}

// Suma (compra) o resta (carga del stock del día) unidades del depósito compartido.
// Puede quedar negativo si se carga mercadería que nunca entró por una compra
// (stock viejo sin registrar) — el panel lo muestra como 0.
function ajustarDeposito_(ss, codigo, producto, delta) {
  const h = getOrCreate(ss, 'DepositoHijos', ['Codigo','Producto','Cantidad']);
  const datos = h.getDataRange().getValues();
  for (let i = 1; i < datos.length; i++) {
    if (datos[i][0].toString() === codigo.toString()) {
      h.getRange(i+1,3).setValue((parseInt(datos[i][2])||0) + delta);
      if (producto) h.getRange(i+1,2).setValue(producto);
      return;
    }
  }
  h.appendRow([codigo, producto || '', delta]);
}

// Costo promedio ponderado de todas las compras del producto → columna Costo del catálogo.
function actualizarCostoPromedio_(ss, codigo) {
  const hc = ss.getSheetByName('ComprasHijos');
  if (!hc || hc.getLastRow() < 2) return;
  let unidades = 0, total = 0;
  hc.getRange(2,1,hc.getLastRow()-1,9).getValues().forEach(r => {
    if (r[4] && r[4].toString() === codigo.toString()) {
      unidades += parseInt(r[6]) || 0;
      total += parseFloat(r[8]) || 0;
    }
  });
  if (unidades <= 0) return;
  const cat = ss.getSheetByName('CatalogoHijos');
  if (!cat || cat.getLastRow() < 2) return;
  const datos = cat.getDataRange().getValues();
  for (let i = 1; i < datos.length; i++) {
    if (datos[i][0].toString() === codigo.toString()) {
      cat.getRange(i+1,4).setValue(Math.round((total/unidades)*100)/100);
      return;
    }
  }
}

function setupHojaHijos() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let cat = ss.getSheetByName('CatalogoHijos');
  if (!cat) cat = ss.insertSheet('CatalogoHijos');
  cat.clearContents();
  cat.getRange(1,1,1,5).setValues([['Codigo','Nombre','PrecioVenta','Costo','Foto']]);
  let ven = ss.getSheetByName('VentasHijos');
  if (!ven) ven = ss.insertSheet('VentasHijos');
  ven.clearContents();
  ven.getRange(1,1,1,11).setValues([['Fecha','Hijo','Producto','Codigo','Cantidad','Precio','Total','Cliente','EsDebe','PagoParcial','SaldoPendiente']]);
  let cc = ss.getSheetByName('CCHijos');
  if (!cc) cc = ss.insertSheet('CCHijos');
  cc.clearContents();
  cc.getRange(1,1,1,6).setValues([['Fecha','Hijo','Cliente','Monto','Descripcion','Producto']]);
  Logger.log('Hojas creadas OK');
}

// ─── IA: "PREGUNTALE A TU NEGOCIO" ────────────────────────────────────────────
// Responde preguntas en lenguaje natural sobre los datos del negocio usando la
// API de Claude. La clave se configura UNA vez: editor de Apps Script →
// Configuración del proyecto → Propiedades del script → ANTHROPIC_API_KEY.

// Resumen compacto y agregado de todo el negocio (lo que ve la IA).
function resumenNegocio_(ss) {
  const cache = CacheService.getScriptCache();
  const cacheado = cache.get('resumen_negocio');
  if (cacheado) return cacheado;

  const r = { hoy: Utilities.formatDate(new Date(), TZ, 'dd/MM/yyyy') };

  // Ventas Shuk: por mes + por cliente + por producto (qué se vende más)
  const hv = ss.getSheetByName('Ventas');
  if (hv && hv.getLastRow() > 1) {
    const porMes = {}, porCliente = {}, porProducto = {};
    hv.getRange(2, 1, hv.getLastRow() - 1, 11).getValues().forEach(row => {
      if (row[7] === 'cancelado') return;
      const m = (row[1] || '').toString().match(/\d{2}\/(\d{2})\/(\d{4})/);
      const mes = m ? m[2] + '-' + m[1] : 's/f';
      if (!porMes[mes]) porMes[mes] = { pedidos: 0, ars: 0, usd: 0 };
      porMes[mes].pedidos++; porMes[mes].ars += parseFloat(row[8]) || 0; porMes[mes].usd += parseFloat(row[9]) || 0;
      const cli = (row[2] || '').toString();
      if (cli) {
        if (!porCliente[cli]) porCliente[cli] = { pedidos: 0, ars: 0, usd: 0, tipo: row[3], ultima: row[1], pendientes: 0 };
        porCliente[cli].pedidos++; porCliente[cli].ars += parseFloat(row[8]) || 0; porCliente[cli].usd += parseFloat(row[9]) || 0;
        porCliente[cli].ultima = row[1];
        if (row[7] === 'pendiente') porCliente[cli].pendientes++;
      }
      // Desglose de productos: el campo Productos guarda líneas "• 2x Nombre · desc — $ ..."
      // Se conserva la descripción (variedad): los Pitzujim se distinguen por ella.
      (row[4] || '').toString().split('||').forEach(seg => {
        const pm = seg.match(/(\d+)\s*x\s*([^—]+)/);
        if (pm) {
          const nom = pm[2].replace(/^[•\s]+/, '').trim();
          if (nom) {
            if (!porProducto[nom]) porProducto[nom] = { unidades: 0, pedidos: 0 };
            porProducto[nom].unidades += parseInt(pm[1]) || 0;
            porProducto[nom].pedidos++;
          }
        }
      });
    });
    r.ventasShukPorMes = porMes;
    r.clientesShukTop = Object.entries(porCliente).sort((a, b) => b[1].ars - a[1].ars).slice(0, 30)
      .map(e => ({ nombre: e[0], pedidos: e[1].pedidos, totalARS: Math.round(e[1].ars), totalUSD: Math.round(e[1].usd * 100) / 100, tipo: e[1].tipo, ultimaCompra: e[1].ultima, pedidosPendientes: e[1].pendientes }));
    r.productosShukTop = Object.entries(porProducto).sort((a, b) => b[1].unidades - a[1].unidades).slice(0, 30)
      .map(e => ({ producto: e[0], unidadesVendidas: e[1].unidades, apareceEnPedidos: e[1].pedidos }));
  }

  // Gastos por mes
  const hg = ss.getSheetByName('Gastos');
  if (hg && hg.getLastRow() > 1) {
    const gm = {};
    hg.getRange(2, 1, hg.getLastRow() - 1, 4).getValues().forEach(row => {
      const m = (row[0] || '').toString().match(/\d{2}\/(\d{2})\/(\d{4})/);
      const mes = m ? m[2] + '-' + m[1] : 's/f';
      gm[mes] = (gm[mes] || 0) + (parseFloat(row[2]) || 0);
    });
    r.gastosShukPorMes = gm;
  }

  // Stock actual
  const hs = ss.getSheetByName('Stock');
  if (hs && hs.getLastRow() > 1) {
    r.stockShuk = hs.getRange(2, 1, hs.getLastRow() - 1, 8).getValues()
      .filter(row => row[1] && (row[7] || '').toString().toUpperCase() !== 'NO')
      .map(row => ({
        nombre: row[1].toString() + (row[2] ? ' · ' + row[2].toString() : ''),
        stock: parseInt(row[5]) || 0, precioMay: (row[3] || '').toString(), precioMin: (row[4] || '').toString()
      }));
  }

  // Diezmo / ganancias Jony (agregado)
  const hgj = ss.getSheetByName('GananciasJony');
  if (hgj && hgj.getLastRow() > 1) {
    let total = 0;
    hgj.getRange(2, 1, hgj.getLastRow() - 1, 4).getValues().forEach(row => { total += parseFloat(row[3]) || 0; });
    r.gananciasJonyAcumulado = Math.round(total);
  }

  // Candy Shop: ventas por mes/hijo + deudores + depósito
  const hvh = ss.getSheetByName('VentasHijos');
  if (hvh && hvh.getLastRow() > 1) {
    const vh = {}, prodH = {};
    hvh.getRange(2, 1, hvh.getLastRow() - 1, 7).getValues().forEach(row => {
      const f = row[0] instanceof Date ? Utilities.formatDate(row[0], TZ, 'yyyy-MM') : (row[0] || '').toString().substring(3, 10).split('/').reverse().join('-');
      const k = row[1] + ' ' + f;
      if (!vh[k]) vh[k] = { ventas: 0, total: 0 };
      vh[k].ventas++; vh[k].total += parseFloat(row[6]) || 0;
      const prod = (row[2] || '').toString();
      if (prod) prodH[prod] = (prodH[prod] || 0) + (parseInt(row[4]) || 1);
    });
    r.candyVentasPorMes = vh;
    r.candyProductosTop = Object.entries(prodH).sort((a, b) => b[1] - a[1]).slice(0, 20)
      .map(e => ({ producto: e[0], unidadesVendidas: e[1] }));
  }
  r.candyDeudores = { Meir: consultarDeudores(ss, { hijo: 'Meir' }), Iosi: consultarDeudores(ss, { hijo: 'Iosi' }) };
  r.candyDeposito = getDepositoHijos(ss).filter(d => d.cantidad > 0);

  const json = JSON.stringify(r);
  cache.put('resumen_negocio', json, 300);   // 5 min
  return json;
}

function preguntarIA(ss, p) {
  const pregunta = dec(p.q || '').trim();
  if (!pregunta) return { error: 'pregunta vacía' };
  const apiKey = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  if (!apiKey) return { error: 'sin_clave', mensaje: 'Falta configurar ANTHROPIC_API_KEY en Propiedades del script (editor de Apps Script → ⚙️ Configuración del proyecto).' };

  const datos = resumenNegocio_(ss);
  const system = 'Sos el analista de datos de Shuk Mamtakim, un negocio familiar argentino de golosinas y productos kosher ' +
    '(venta mayorista y minorista). También existe "Candy Shop", el mini-negocio de los hijos Meir e Iosi. ' +
    'Te paso un resumen JSON con los datos reales del negocio y una pregunta del dueño. ' +
    'Respondé en español rioplatense, breve y concreto, con los números formateados (ej: $1.234.567). ' +
    'Si la pregunta no se puede responder con los datos disponibles, decilo claramente y sugerí dónde podría mirar. ' +
    'No inventes datos. Montos en ARS salvo que se indique USD.';

  try {
    const res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      payload: JSON.stringify({
        model: 'claude-opus-4-8',
        max_tokens: 4096,
        system: system,
        messages: [{ role: 'user', content: 'DATOS DEL NEGOCIO (JSON):\n' + datos + '\n\nPREGUNTA: ' + pregunta }]
      }),
      muteHttpExceptions: true
    });
    const code = res.getResponseCode();
    const body = JSON.parse(res.getContentText());
    if (code !== 200) {
      Logger.log('[ia] error ' + code + ': ' + res.getContentText().substring(0, 300));
      return { error: 'La IA respondió con error ' + code + (body.error ? ': ' + body.error.message : '') };
    }
    let texto = '';
    (body.content || []).forEach(b => { if (b.type === 'text') texto += b.text; });
    return { ok: true, respuesta: texto || '(sin respuesta)' };
  } catch (err) {
    return { error: 'No se pudo consultar la IA: ' + err };
  }
}

// ─── PRODUCTOS DORMIDOS (sugerencias de oferta) ───────────────────────────────
// Productos activos con stock que no aparecen en ninguna venta de los últimos
// N días (default 30) y no tienen oferta vigente. Candidatos a oferta.
function getProductosDormidos(ss, p) {
  const dias = parseInt(p.dias) || 30;
  const desde = new Date(Date.now() - dias * 86400000);
  const hv = ss.getSheetByName('Ventas');
  let vendidos = '';
  if (hv && hv.getLastRow() > 1) {
    hv.getRange(2, 1, hv.getLastRow() - 1, 8).getValues().forEach(row => {
      let f = null;
      if (row[1] instanceof Date) f = row[1];
      else {
        const m = (row[1] || '').toString().match(/(\d{2})\/(\d{2})\/(\d{4})/);
        if (m) f = new Date(m[3] + '-' + m[2] + '-' + m[1] + 'T12:00:00');
      }
      if (f && f >= desde && row[7] !== 'cancelado') vendidos += '||' + (row[4] || '').toString().toLowerCase();
    });
  }
  const hs = ss.getSheetByName('Stock');
  if (!hs || hs.getLastRow() < 2) return [];
  const hoy = new Date();
  return hs.getRange(2, 1, hs.getLastRow() - 1, 14).getValues()
    .filter(r => {
      if (!r[0] || !r[1]) return false;
      const stock = parseInt(r[5]); const activo = (r[7] || '').toString().toUpperCase() !== 'NO';
      if (!activo || isNaN(stock) || stock <= 0) return false;
      // con oferta vigente no se sugiere
      const precioOf = parseFloat(r[10]) || 0;
      const fechaOf = r[11] ? new Date(r[11] + 'T23:59:59') : null;
      if (precioOf > 0 && (!fechaOf || isNaN(fechaOf.getTime()) || fechaOf >= hoy)) return false;
      return vendidos.indexOf(r[1].toString().toLowerCase()) === -1;
    })
    .map(r => ({
      id: r[0].toString(), nombre: r[1].toString(), desc: (r[2] || '').toString(),
      stock: parseInt(r[5]) || 0,
      precioMay: parseFloat((r[3] || '0').toString().replace(',', '.')) || 0,
      precioMin: parseFloat((r[4] || '0').toString().replace(',', '.')) || 0
    }));
}

// ─── CIERRE DIARIO AUTOMÁTICO (Telegram vía worker) ──────────────────────────
// Cada noche manda a papá un resumen del día por Telegram, sin abrir el panel.
// El mensaje viaja por el worker del bot (que tiene el token TG como secret).
const WORKER_RELAY_URL = 'https://shuk-hijos-bot.ingodwetrustsrl.workers.dev';

function enviarTelegram_(dest, texto) {
  try {
    UrlFetchApp.fetch(WORKER_RELAY_URL, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ relay: true, secret: BOT_SECRET, dest: dest, text: texto }),
      muteHttpExceptions: true
    });
  } catch (err) { Logger.log('[cierre] error relay: ' + err); }
}

function _esHoy_(valor) {
  const hoyStr = Utilities.formatDate(new Date(), TZ, 'dd/MM/yyyy');
  if (valor instanceof Date) return Utilities.formatDate(valor, TZ, 'dd/MM/yyyy') === hoyStr;
  return (valor || '').toString().trim().substring(0, 10) === hoyStr;
}

function resumenShukHoy_(ss) {
  const r = { n: 0, ars: 0, usd: 0, gastos: 0, visitas: 0, abandonados: 0, stockBajo: [] };
  const hv = ss.getSheetByName('Ventas');
  if (hv && hv.getLastRow() > 1) {
    hv.getRange(2, 1, hv.getLastRow() - 1, 10).getValues().forEach(row => {
      if (_esHoy_(row[1]) && row[7] !== 'cancelado') {
        r.n++; r.ars += parseFloat(row[8]) || 0; r.usd += parseFloat(row[9]) || 0;
      }
    });
  }
  const hg = ss.getSheetByName('Gastos');
  if (hg && hg.getLastRow() > 1) {
    hg.getRange(2, 1, hg.getLastRow() - 1, 3).getValues().forEach(row => {
      if (_esHoy_(row[0])) r.gastos += parseFloat(row[2]) || 0;
    });
  }
  const ht = ss.getSheetByName('Trafico');
  if (ht && ht.getLastRow() > 1) {
    const porVid = {};
    ht.getRange(2, 1, ht.getLastRow() - 1, 4).getValues().forEach(row => {
      if (!_esHoy_(row[0])) return;
      if (row[3] === 'visita') r.visitas++;
      if (row[1]) {
        if (!porVid[row[1]]) porVid[row[1]] = {};
        porVid[row[1]][row[3]] = true;
      }
    });
    r.abandonados = Object.values(porVid).filter(ev => (ev.carrito || ev.checkout) && !ev.pedido).length;
  }
  const hs = ss.getSheetByName('Stock');
  if (hs && hs.getLastRow() > 1) {
    hs.getRange(2, 1, hs.getLastRow() - 1, 8).getValues().forEach(row => {
      const stock = parseInt(row[5]);
      const activo = (row[7] || '').toString().toUpperCase() !== 'NO';
      if (row[1] && activo && !isNaN(stock) && stock > 0 && stock <= 3) r.stockBajo.push(row[1] + ' (' + stock + ')');
    });
  }
  return r;
}

function resumenHijoHoy_(ss, hijo) {
  const r = { n: 0, total: 0, ganancia: 0, deudasNuevas: 0 };
  const costos = {};
  (getCatalogoHijos(ss) || []).forEach(p => { costos[p.codigo.toLowerCase()] = p.costo || 0; });
  const hv = ss.getSheetByName('VentasHijos');
  if (hv && hv.getLastRow() > 1) {
    hv.getRange(2, 1, hv.getLastRow() - 1, 11).getValues().forEach(row => {
      if (row[1] !== hijo || !_esHoy_(row[0])) return;
      r.n++; r.total += parseFloat(row[6]) || 0;
      const costo = costos[(row[3] || '').toString().toLowerCase()] || 0;
      r.ganancia += ((parseFloat(row[5]) || 0) - costo) * (parseInt(row[4]) || 1);
    });
  }
  const hc = ss.getSheetByName('CCHijos');
  if (hc && hc.getLastRow() > 1) {
    hc.getRange(2, 1, hc.getLastRow() - 1, 5).getValues().forEach(row => {
      if (row[1] === hijo && _esHoy_(row[0]) && parseFloat(row[3]) > 0) r.deudasNuevas += parseFloat(row[3]) || 0;
    });
  }
  return r;
}

function cierreDiario() {
  // Idempotente: si ya se mandó hoy (p. ej. trigger propio + enganche del backup), no repite.
  const props = PropertiesService.getScriptProperties();
  const hoyKey = 'cierre_' + Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  if (props.getProperty(hoyKey)) return;
  props.setProperty(hoyKey, '1');
  props.deleteProperty('cierre_' + Utilities.formatDate(new Date(Date.now() - 86400000), TZ, 'yyyy-MM-dd'));
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const fmt = n => '$' + Math.round(n).toLocaleString('es-AR');
  const fecha = Utilities.formatDate(new Date(), TZ, 'dd/MM/yyyy');
  const shuk = resumenShukHoy_(ss);
  const meir = resumenHijoHoy_(ss, 'Meir');
  const iosi = resumenHijoHoy_(ss, 'Iosi');

  let msg = '🌙 *Cierre del día — ' + fecha + '*\n\n';
  msg += '🏪 *Shuk Mamtakim*\n';
  msg += '• Pedidos: ' + shuk.n;
  if (shuk.ars > 0) msg += ' · ' + fmt(shuk.ars);
  if (shuk.usd > 0) msg += ' + U$S ' + shuk.usd.toFixed(2);
  msg += '\n';
  if (shuk.gastos > 0) msg += '• Gastos: ' + fmt(shuk.gastos) + '\n';
  msg += '• Visitas a la web: ' + shuk.visitas + '\n';
  if (shuk.abandonados > 0) msg += '• 🛒 Carritos sin terminar: ' + shuk.abandonados + ' (ver Analítica)\n';
  if (shuk.stockBajo.length) msg += '• ⚠️ Stock bajo: ' + shuk.stockBajo.slice(0, 5).join(', ') + '\n';

  msg += '\n🍬 *Candy Shop*\n';
  [['Meir', meir], ['Iosi', iosi]].forEach(par => {
    const nombre = par[0], d = par[1];
    msg += '• ' + nombre + ': ' + d.n + ' venta' + (d.n !== 1 ? 's' : '');
    if (d.total > 0) msg += ' · ' + fmt(d.total) + ' (ganancia ' + fmt(d.ganancia) + ', diezmo ' + fmt(d.ganancia * 0.1) + ')';
    if (d.deudasNuevas > 0) msg += ' · deudas nuevas ' + fmt(d.deudasNuevas);
    msg += '\n';
  });

  enviarTelegram_('papa', msg);

  // Mini-resumen a cada chico, solo si vendió algo hoy
  [['meir', meir], ['iosi', iosi]].forEach(par => {
    const dest = par[0], d = par[1];
    if (d.n > 0) {
      enviarTelegram_(dest, '🌙 *Tu día de hoy*\n• Ventas: ' + d.n + ' · ' + fmt(d.total) +
        '\n• Ganancia: ' + fmt(d.ganancia) + '\n• Diezmo (10%): ' + fmt(d.ganancia * 0.1) + '\n¡Buen trabajo! 💪');
    }
  });
  Logger.log('Cierre diario enviado');
}

// EJECUTAR UNA SOLA VEZ desde el editor para activar el cierre diario a las 21hs.
// Re-ejecutarla es seguro (borra triggers previos).
function configurarCierreDiario() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'cierreDiario')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('cierreDiario').timeBased().atHour(21).everyDays(1).inTimezone(TZ).create();
  Logger.log('Cierre diario configurado (21hs)');
}

// ─── BACKUP AUTOMÁTICO ────────────────────────────────────────────────────────
const BACKUP_FOLDER_NAME = 'Backups Shuk Mamtakim';
const BACKUP_RETENTION_DAYS = 30;   // con backup horario = ~720 copias (~pocos GB, hay 5 TB)

// Copia toda la planilla a una carpeta en Drive y borra backups más viejos que la retención.
// La ejecuta el trigger horario (ver configurarBackup).
function crearBackup() {
  const folder = getBackupFolder_();
  const fecha = Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd HH'h'mm");
  const src = DriveApp.getFileById(SPREADSHEET_ID);
  src.makeCopy('Backup Shuk ' + fecha, folder);
  limpiarBackupsViejos_(folder);
  Logger.log('Backup creado: Backup Shuk ' + fecha);
  // Enganche del cierre diario: el trigger horario del backup ya corre cada hora,
  // así que a partir de las 21hs aprovecha y manda el cierre del día (idempotente,
  // cierreDiario se protege solo contra duplicados). Sin trigger extra que configurar.
  try {
    const hora = parseInt(Utilities.formatDate(new Date(), TZ, 'H'), 10);
    if (hora >= 21) cierreDiario();
  } catch (err) { Logger.log('[cierre] ' + err); }
}

function getBackupFolder_() {
  const it = DriveApp.getFoldersByName(BACKUP_FOLDER_NAME);
  return it.hasNext() ? it.next() : DriveApp.createFolder(BACKUP_FOLDER_NAME);
}

function limpiarBackupsViejos_(folder) {
  const limite = new Date().getTime() - BACKUP_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const files = folder.getFiles();
  while (files.hasNext()) {
    const f = files.next();
    if (f.getDateCreated().getTime() < limite) f.setTrashed(true);
  }
}

// EJECUTAR UNA SOLA VEZ desde el editor para activar el backup cada 60 minutos.
// Borra triggers previos de crearBackup para no duplicar (seguro re-ejecutarla).
function configurarBackup() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'crearBackup')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('crearBackup')
    .timeBased()
    .everyHours(1)
    .create();
  Logger.log('Backup horario configurado (cada 60 min)');
}
