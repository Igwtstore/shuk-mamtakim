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
  'eliminarNotificacion','marcarNotificado'
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
  try {
    if (accion === 'venta') {
      const h = getOrCreate(ss, 'Ventas', ['ID','Fecha','Cliente','Tipo','Productos','Forma de Pago','Notas','Estado','Total ARS','Total USD','# Venta','ARS Jony','ARS Myri','USD Myri','Comi ARS','Comi USD','Caja Jony','Caja Myri','Tipo Cambio','Stock Updates']);
      const id = 'P' + Date.now().toString();
      const fecha = Utilities.formatDate(new Date(), TZ, 'dd/MM/yyyy HH:mm');
      const row = h.getLastRow() + 1;
      const nVenta = row - 1;
      const stockUpdates = dec(e.parameter.stockUpdates||'');
      h.appendRow([id, fecha, dec(e.parameter.cliente), dec(e.parameter.tipo), dec(e.parameter.productos), dec(e.parameter.formaPago), dec(e.parameter.notas||''), 'pendiente',
        parseFloat(e.parameter.totalARS||0), parseFloat(e.parameter.totalUSD||0), nVenta,
        parseFloat(e.parameter.arsJONY||0), parseFloat(e.parameter.arsMyri||0),
        parseFloat(e.parameter.usdMyri||0), parseFloat(e.parameter.comiARS||0), parseFloat(e.parameter.comiUSD||0),
        '', '', 0, stockUpdates]);
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
          h.getRange(i+1,17).setValue(dec(e.parameter.cajaJony||''));
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
  const datos = h.getDataRange().getValues();
  for (let i = 1; i < datos.length; i++) {
    if (datos[i][0].toString() === dec(p.codigo)) {
      h.getRange(i+1,2).setValue(dec(p.nombre));
      h.getRange(i+1,3).setValue(parseFloat(p.precioVenta)||0);
      h.getRange(i+1,4).setValue(parseFloat(p.costo)||0);
      h.getRange(i+1,5).setValue(dec(p.foto||''));
      return { ok: true };
    }
  }
  return { error:'no encontrado' };
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
      h.appendRow([fecha, p.hijo, item.codigo, item.nombre || '', parseInt(item.cantidad) || 0]);
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
      h.deleteRow(i + 2);
    }
  }
  return { ok: true };
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
