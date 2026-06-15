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
  'eliminarNotificacion','marcarNotificado','getAnalitica','getProductosDormidos','preguntarIA','editarProducto',
  'analizarFotoProducto','bandejaSubir','bandejaListar','bandejaUsar','procesarBandeja',
  'guardarClaveIA','movimientosStock','auditoriaStock','leerStockRaw'
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
  'registrarCompraHijos','getComprasHijos','getDepositoHijos','panelHijos','comprasTabHijos',
  'flyerTexto','fondoFlyer','guardarFlyer','getFlyersHijos','archivarFlyer','eliminarFlyer','enviarFlyerWA'
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

// Registra todo movimiento de stock de Shuk en la hoja MovimientosStock:
// quién/qué lo cambió, cuánto había antes y cuánto quedó. Nunca rompe la operación principal.
function registrarMovStock_(ss, pid, nombre, delta, antes, despues, origen) {
  try {
    const h = getOrCreate(ss, 'MovimientosStock', ['Fecha','ID','Producto','Cambio','Antes','Despues','Origen']);
    h.appendRow([Utilities.formatDate(new Date(), TZ, 'dd/MM/yyyy HH:mm'), pid, nombre, delta, antes, despues, origen]);
  } catch (err) { Logger.log('[movstock] ' + err); }
}

function doGet(e) {
  const accion = e.parameter.accion;
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  // Protección de acciones sensibles del admin. Etapa A: loguea pero permite.
  if (PROTECTED_ACTIONS.indexOf(accion) !== -1) {
    // Excepción: el bot (worker) puede consultar la IA con su secreto — para
    // preguntarle al negocio por WhatsApp/Telegram sin sesión de navegador.
    const esBotIA = ['preguntarIA','movimientosStock','auditoriaStock','leerStockRaw'].indexOf(accion) !== -1 && e.parameter.secret === BOT_SECRET;
    if (!esBotIA && !sesionValida_(e.parameter.token)) {
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
    if (accion === 'botMsg') {
      // Cerebro del bot de pedidos (SMS / voz). Lo usa el panel (token) para simular
      // y el gateway real (secret). Recibe from=teléfono, text=mensaje → {reply}.
      if (!(sesionValida_(e.parameter.token) || e.parameter.secret === BOT_SECRET))
        return json({ error: 'no autorizado' });
      return json(procesarMensajeBot_(ss, e.parameter.from || '', dec(e.parameter.text || ''), e.parameter.sim === '1'));
    }
    if (accion === 'botVoz') {
      // Cerebro conversacional con IA (para voz natural): entiende lenguaje común.
      if (!(sesionValida_(e.parameter.token) || e.parameter.secret === BOT_SECRET))
        return json({ error: 'no autorizado' });
      return json(procesarVozIA_(ss, e.parameter.from || '', dec(e.parameter.text || ''), e.parameter.sim === '1', e.parameter.canal || 'texto'));
    }
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
          var cliVenta = dec(e.parameter.cliente);
          stockUpdates.split(',').forEach(function(u) {
            var parts = u.split(':'); var pid = parts[0]; var qty = parseInt(parts[1])||0;
            for (var i = 1; i < sd.length; i++) {
              if (sd[i][0].toString() === pid) {
                var antes = parseInt(sd[i][5])||0;
                var despues = Math.max(0, antes - qty);
                sh.getRange(i+1,6).setValue(despues);
                var sobre = qty - antes;
                registrarMovStock_(ss, pid, sd[i][1], -qty, antes, despues,
                  'Venta #' + nVenta + ' — ' + cliVenta + (sobre > 0 ? ' ⚠️ SOBREVENTA: pidió ' + qty + ', había ' + antes : ''));
                if (sobre > 0) enviarTelegram_('papa', '⚠️ *SOBREVENTA*\n' + sd[i][1] + ': el pedido #' + nVenta + ' (' + cliVenta + ') pidió *' + qty + '* y solo había *' + antes + '*. Faltan ' + sobre + ' — revisalo antes de confirmar.');
                break;
              }
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
                    if (sd[j][0].toString() === pid) {
                      const antes = parseInt(sd[j][5])||0;
                      sh.getRange(j+1,6).setValue(antes + qty);
                      registrarMovStock_(ss, pid, sd[j][1], qty, antes, antes + qty, 'Cancelación pedido #' + (datos[i][10]||''));
                      break;
                    }
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
          // Ajuste de stock por la edición (productos agregados/quitados/cantidades cambiadas).
          // delta positivo = devolver al stock, negativo = descontar.
          if (e.parameter.stockDeltas) {
            const sh2 = ss.getSheetByName('Stock');
            if (sh2) {
              const sd2 = sh2.getDataRange().getValues();
              dec(e.parameter.stockDeltas).split(',').forEach(function(u) {
                const pp = u.split(':'); const pid = pp[0]; const delta = parseInt(pp[1])||0;
                if (!delta) return;
                for (let j = 1; j < sd2.length; j++) {
                  if (sd2[j][0].toString() === pid) {
                    const antes = parseInt(sd2[j][5])||0;
                    const despues = Math.max(0, antes + delta);
                    sh2.getRange(j+1,6).setValue(despues);
                    registrarMovStock_(ss, pid, sd2[j][1], delta, antes, despues, 'Edición pedido #' + (datos[i][10]||''));
                    break;
                  }
                }
              });
            }
          }
          // Mantener coherente la col Stock Updates (la usa la cancelación para devolver stock)
          if (e.parameter.stockUpdatesNuevo !== undefined) h.getRange(i+1,20).setValue(dec(e.parameter.stockUpdatesNuevo));
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
          if (e.parameter.comprobante) h.getRange(i+1,22).setValue(dec(e.parameter.comprobante));   // URL del comprobante de pago
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
      const nc = Math.min(22, h.getLastColumn());
      return json(h.getRange(2,1,h.getLastRow()-1,nc).getValues().map((r,idx) => ({
        id: r[0] instanceof Date ? r[0].toISOString() : r[0].toString().trim(),
        fecha: r[1] instanceof Date ? Utilities.formatDate(r[1],TZ,'dd/MM/yyyy HH:mm') : r[1].toString(),
        cliente:r[2], tipo:r[3], productos:r[4], formaPago:r[5], notas:r[6],
        estado:r[7]||'pendiente', totalARS:r[8]||0, totalUSD:r[9]||0,
        nVenta:r[10]||(idx+1), arsJONY:r[11]||0, arsMyri:r[12]||0,
        usdMyri:r[13]||0, comiARS:r[14]||0, comiUSD:r[15]||0,
        cajaJony:r[16]||'', cajaMyri:r[17]||'', tipoCambio:r[18]||0, stockUpdates:r[19]||'',
        comprobante:r[21]||''
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
        for (var i = 1; i < sd.length; i++) {
          if (sd[i][0].toString()===pid) {
            var antes = parseInt(sd[i][5])||0;
            sh.getRange(i+1,6).setValue(ns);
            if (ns !== antes) registrarMovStock_(ss, pid, sd[i][1], ns - antes, antes, ns, 'Ajuste manual (pestaña Stock)');
            break;
          }
        }
      });
      return ok();
    }
    if (accion === 'agregarProducto') {
      const h = ss.getSheetByName('Stock'); if (!h) return json({error:'sin hoja Stock'});
      const datos = h.getDataRange().getValues();
      let maxId = 0;
      for (let i = 1; i < datos.length; i++) { const id = parseInt(datos[i][0])||0; if (id > maxId) maxId = id; }
      const pMayNum = parseFloat(dec(e.parameter.pMay||'').replace(',', '.'));
      h.appendRow([maxId+1, dec(e.parameter.nombre), dec(e.parameter.desc),
        isNaN(pMayNum) ? '' : pMayNum, parseFloat(e.parameter.pMin||0),
        parseInt(e.parameter.stock||0), dec(e.parameter.imagen||''), 'SI',
        dec(e.parameter.categoria||'Varios'), dec(e.parameter.visible||'Ambos'),
        0, '', 0, 0, dec(e.parameter.dueno||'Miri'), 'Ambos', dec(e.parameter.descBot||'')]);
      const stockIni = parseInt(e.parameter.stock||0);
      if (stockIni > 0) registrarMovStock_(ss, String(maxId+1), dec(e.parameter.nombre), stockIni, 0, stockIni, 'Alta de producto');
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
    if (accion === 'analizarFotoProducto') { return json(analizarFotoProducto(ss, e.parameter)); }
    if (accion === 'bandejaSubir')   { return json(bandejaSubir(ss, e.parameter)); }
    if (accion === 'bandejaListar')  { return json(bandejaListar(ss)); }
    if (accion === 'bandejaUsar')    { return json(bandejaUsar(ss, e.parameter)); }
    if (accion === 'procesarBandeja'){ return json(procesarBandeja(ss)); }
    if (accion === 'editarProducto') {
      // Edita campos puntuales de un producto del Stock de Shuk (solo los que vengan)
      const h = ss.getSheetByName('Stock'); if (!h) return json({ error: 'sin hoja Stock' });
      const datos = h.getDataRange().getValues();
      const campos = { nombre: 2, desc: 3, precioMay: 4, precioMin: 5, stock: 6, imagen: 7, activo: 8, categoria: 9, visible: 10, dueno: 15, descBot: 17 };
      for (let i = 1; i < datos.length; i++) {
        if (datos[i][0].toString() === e.parameter.id) {
          const numericos = { precioMay: 1, precioMin: 1, stock: 1 };
          Object.keys(campos).forEach(k => {
            if (e.parameter[k] !== undefined && e.parameter[k] !== null && e.parameter[k] !== '') {
              let v = dec(e.parameter[k]);
              if (k === 'stock') {
                const antes = parseInt(datos[i][5])||0;
                const ns = parseInt(v)||0;
                if (ns !== antes) registrarMovStock_(ss, e.parameter.id, datos[i][1], ns - antes, antes, ns, 'Edición manual (editor de producto)');
              }
              if (v !== '__VACIO__' && numericos[k]) {
                const n = parseFloat(v.toString().replace(',', '.'));
                if (!isNaN(n)) v = n;   // número real: visible para el gviz CSV de la tienda
              }
              h.getRange(i + 1, campos[k]).setValue(v === '__VACIO__' ? '' : v);
            }
          });
          return json({ ok: true });
        }
      }
      return json({ error: 'producto no encontrado' });
    }
    if (accion === 'leerStockRaw') {
      // Diagnóstico de solo lectura: devuelve la fila cruda de un producto tal como
      // la ve el script (para detectar desfasajes entre lo escrito y lo leído).
      const h = ss.getSheetByName('Stock'); if (!h) return json({ error: 'sin hoja Stock' });
      const datos = h.getDataRange().getValues();
      for (let i = 1; i < datos.length; i++) {
        if (datos[i][0].toString() === (e.parameter.id||'')) {
          return json({
            ssId: ss.getId(), ssNombre: ss.getName(), fila: i + 1,
            valores: datos[i].slice(0, 10),
            formulaD: h.getRange(i + 1, 4).getFormula(),
            protecciones: h.getProtections(SpreadsheetApp.ProtectionType.RANGE).length
          });
        }
      }
      return json({ error: 'no encontrado' });
    }
    if (accion === 'movimientosStock') {
      const h = ss.getSheetByName('MovimientosStock');
      if (!h || h.getLastRow() < 2) return json([]);
      const pid = (e.parameter.id||'').toString();
      const datos = h.getRange(2,1,h.getLastRow()-1,7).getValues();
      const out = [];
      for (let i = datos.length - 1; i >= 0 && out.length < 200; i--) {
        const r = datos[i];
        if (pid && r[1].toString() !== pid) continue;
        out.push({ fecha: r[0] instanceof Date ? Utilities.formatDate(r[0],TZ,'dd/MM/yyyy HH:mm') : r[0].toString(),
          id: r[1].toString(), producto: r[2].toString(), cambio: parseInt(r[3])||0,
          antes: parseInt(r[4])||0, despues: parseInt(r[5])||0, origen: r[6].toString() });
      }
      return json(out);
    }
    if (accion === 'auditoriaStock') {
      // Reconstruye el historial de stock de un producto leyendo los backups horarios de Drive.
      const pid = (e.parameter.id||'').toString();
      if (!pid) return json({ error: 'falta id' });
      const max = Math.min(parseInt(e.parameter.max||24,10)||24, 60);
      const it = getBackupFolder_().getFiles();
      let files = [];
      while (it.hasNext()) files.push(it.next());
      files.sort((a,b) => b.getName().localeCompare(a.getName()));   // nombre = fecha → más nuevo primero
      if (e.parameter.modo === 'diario') {
        // Un backup por día (el último de cada día) — permite mirar un mes con ~30 lecturas
        const porDia = {};
        files.forEach(f => {
          const d = f.getName().replace('Backup Shuk ', '').substring(0, 10);
          if (!porDia[d]) porDia[d] = f;
        });
        files = Object.keys(porDia).sort().reverse().slice(0, Math.min(parseInt(e.parameter.dias||30,10)||30, 31)).map(d => porDia[d]);
      } else {
        files = files.slice(0, max);
      }
      const out = [];
      files.forEach(f => {
        try {
          const sh = SpreadsheetApp.openById(f.getId()).getSheetByName('Stock');
          if (!sh) return;
          const sd = sh.getDataRange().getValues();
          for (let i = 1; i < sd.length; i++) {
            if (sd[i][0].toString() === pid) {
              out.push({ backup: f.getName().replace('Backup Shuk ',''), nombre: sd[i][1].toString(), stock: parseInt(sd[i][5])||0 });
              return;
            }
          }
          out.push({ backup: f.getName().replace('Backup Shuk ',''), nombre: '', stock: null });   // aún no existía
        } catch (err) {}
      });
      return json(out);
    }
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
    if (accion === 'flyerTexto')           { return json(flyerTexto(e.parameter)); }
    if (accion === 'fondoFlyer')           { return json(fondoFlyer(e.parameter)); }
    if (accion === 'guardarFlyer')         { return json(guardarFlyer(ss, e.parameter)); }
    if (accion === 'getFlyersHijos')       { return json(getFlyersHijos(ss, e.parameter)); }
    if (accion === 'archivarFlyer')        { return json(archivarFlyer(ss, e.parameter)); }
    if (accion === 'eliminarFlyer')        { return json(eliminarFlyer(ss, e.parameter)); }
    if (accion === 'enviarFlyerWA')        { return json(enviarFlyerWA(e.parameter)); }

  } catch(err) { return json({error:err.toString()}); }
}

// POST: solo para subir audio (idea del flyer por voz) — el audio no entra en una URL.
// Auth: sesión del panel o secreto del bot, igual que las acciones protegidas.
function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    if (body.accion === 'transcribirIdea') {
      const ok = sesionValida_(body.token) || body.secret === BOT_SECRET;
      if (!ok) return json({ error: 'no autorizado' });
      const res = UrlFetchApp.fetch(WORKER_RELAY_URL, {
        method: 'post', contentType: 'application/json',
        payload: JSON.stringify({ transcribir: true, secret: BOT_SECRET, b64: body.audio || '', mime: body.mime || '' }),
        muteHttpExceptions: true
      });
      return json(JSON.parse(res.getContentText()));
    }
    // Webhook del gateway de SMS (capcom6 SMS Gateway): SMS entrante de un cliente.
    // El cliente manda un SMS → lo procesa el cerebro de Shuki → respondemos por SMS.
    if (body.event === 'sms:received' && body.payload) {
      const from = (body.payload.phoneNumber || '').toString().trim();
      const text = (body.payload.message || '').toString().trim();
      const sim = body.payload.simNumber != null ? String(body.payload.simNumber) : '';
      const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
      // Log de todo SMS entrante (para identificar la SIM de Shuk y diagnóstico)
      try { getOrCreate(ss, 'SMSLog', ['Fecha','SIM','De','Texto']).appendRow([Utilities.formatDate(new Date(), TZ, 'dd/MM/yyyy HH:mm'), sim, from, text]); } catch (e) {}
      const simShuk = PropertiesService.getScriptProperties().getProperty('SMS_SIM_SHUK');
      // SEGURIDAD: si no está configurada la SIM de Shuk, NO responder (modo captura, evita contestar a la línea de trabajo).
      if (!simShuk) return json({ ok: true, modo: 'captura', simRecibida: sim });
      // Solo responder a los SMS que entraron por la línea de Shuk.
      if (sim && String(sim) !== String(simShuk)) return json({ ok: true, ignorado: 'otra linea' });
      if (from && text) {
        const r = procesarVozIA_(ss, from, text, false, 'texto');   // canal texto = lista escaneable
        if (r && r.reply) enviarSMS_(r.reply, from, simShuk);
      }
      return json({ ok: true });
    }
    return json({ error: 'acción desconocida' });
  } catch (err) {
    return json({ error: 'doPost: ' + err });
  }
}

// Envía un SMS usando el cloud del gateway (capcom6 SMS Gateway / sms-gate.app).
// Credenciales en Script Properties: SMS_GATEWAY_USER y SMS_GATEWAY_PASS (las da la app).
function enviarSMS_(texto, to, sim) {
  const user = PropertiesService.getScriptProperties().getProperty('SMS_GATEWAY_USER');
  const pass = PropertiesService.getScriptProperties().getProperty('SMS_GATEWAY_PASS');
  if (!user || !pass) { Logger.log('[sms] faltan SMS_GATEWAY_USER/PASS en Propiedades'); return; }
  try {
    let dest = (to || '').toString().trim();
    if (dest && dest.charAt(0) !== '+') dest = '+' + dest;   // la API exige formato +54...
    const cuerpo = { message: (texto || '').substring(0, 600), phoneNumbers: [dest] };
    if (sim) cuerpo.simNumber = parseInt(sim) || undefined;   // responder por la línea de Shuk
    UrlFetchApp.fetch('https://api.sms-gate.app/3rdparty/v1/message', {
      method: 'post', contentType: 'application/json',
      headers: { 'Authorization': 'Basic ' + Utilities.base64Encode(user + ':' + pass) },
      payload: JSON.stringify(cuerpo),
      muteHttpExceptions: true
    });
  } catch (err) { Logger.log('[sms] error envío: ' + err); }
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

// ─── FLYER CON IA (Candy Shop) ────────────────────────────────────────────────
// Los chicos eligen productos y escriben una idea; la IA devuelve título, frase
// y cierre para el flyer. JSON garantizado por schema (output_config.format).
function flyerTexto(p) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  if (!apiKey) return { error: 'sin_clave', mensaje: 'Falta configurar la clave de IA (se carga desde el panel de Shuk).' };
  const hijo = dec(p.hijo || 'el vendedor');
  const productos = dec(p.productos || '');
  const idea = dec(p.idea || '').substring(0, 300);

  const ocasion = dec(p.ocasion || '');
  const intro = (p.negocio === 'shuk')
    ? 'Sos el creativo publicitario Y director de arte de "Shuk Mamtakim", un almacén familiar argentino de golosinas ' +
      'y productos kosher importados de Israel (venta mayorista y minorista). Escribís textos para flyers: cortos, ' +
      'tentadores, profesionales pero cercanos, en español rioplatense. '
    : 'Sos el creativo publicitario Y director de arte del Candy Shop de ' + hijo + ', un chico argentino que vende ' +
      'golosinas a amigos, compañeros y vecinos. Escribís textos para flyers: cortos, divertidos, vendedores, ' +
      'en español rioplatense, con onda pero sin grosería. ';
  const system = intro + 'Respetá los límites de caracteres a rajatabla. ' +
    'Además escribís el prompt (en inglés) para generar el FONDO del flyer con un modelo de imágenes: ' +
    'tiene que ser detallado y profesional — estilo visual concreto (ej: vibrant candy-pop 3D render, soft gradient studio backdrop, ' +
    'playful flat illustration), motivos inspirados en los productos (vapor de sopa, trozos de chocolate, caramelos flotando), ' +
    'composición con un centro despejado para superponer tarjetas de productos, iluminación y paleta. ' +
    'PROHIBIDO en el prompt: texto, letras, números, logos, marcas, personas, packaging legible. ' +
    'También elegís una paleta de 3 colores en hex que combine con ese fondo: dos para un degradé oscuro-medio ' +
    '(con buen contraste para texto blanco encima) y un acento vibrante claro (para pills con texto oscuro).';
  const user = 'Productos del flyer: ' + productos + '\n' +
    (ocasion ? 'Ocasión/tema del flyer: ' + ocasion + '\n' : '') +
    (idea ? 'Idea/texto que escribió ' + hijo + ' (mejorala manteniendo su espíritu): "' + idea + '"'
          : 'No dejó texto: inventá algo corto y tentador.') +
    '\nGenerá los textos del flyer, el prompt del fondo y la paleta.';

  try {
    const res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      payload: JSON.stringify({
        model: 'claude-opus-4-8',
        max_tokens: 1500,
        system: system,
        output_config: { format: { type: 'json_schema', schema: {
          type: 'object',
          properties: {
            titulo: { type: 'string', description: 'Título grande y pegadizo, MÁXIMO 22 caracteres' },
            frase:  { type: 'string', description: 'Frase vendedora corta, MÁXIMO 80 caracteres' },
            cierre: { type: 'string', description: 'Llamado a la acción, MÁXIMO 30 caracteres, ej: ¡Pedime ya!' },
            fondo_prompt: { type: 'string', description: 'Prompt en inglés, detallado y profesional, para generar el fondo del flyer (estilo, motivos de los productos, composición con centro despejado, iluminación, paleta). Sin texto/letras/logos/personas.' },
            paleta_a: { type: 'string', description: 'Color hex oscuro del degradé, ej #1a2c5e' },
            paleta_b: { type: 'string', description: 'Color hex medio del degradé, ej #4a6fd4' },
            paleta_accent: { type: 'string', description: 'Color hex de acento claro y vibrante, ej #ffd24a' }
          },
          required: ['titulo', 'frase', 'cierre', 'fondo_prompt', 'paleta_a', 'paleta_b', 'paleta_accent'],
          additionalProperties: false
        } } },
        messages: [{ role: 'user', content: user }]
      }),
      muteHttpExceptions: true
    });
    const code = res.getResponseCode();
    const body = JSON.parse(res.getContentText());
    if (code !== 200) return { error: 'IA error ' + code + (body.error ? ': ' + body.error.message : '') };
    let texto = '';
    (body.content || []).forEach(b => { if (b.type === 'text') texto += b.text; });
    const t = JSON.parse(texto);
    return { ok: true, titulo: t.titulo || '¡Golosinas!', frase: t.frase || '', cierre: t.cierre || '¡Pedime ya!',
      fondoPrompt: t.fondo_prompt || '', paletaA: t.paleta_a || '', paletaB: t.paleta_b || '', paletaAccent: t.paleta_accent || '' };
  } catch (err) {
    return { error: 'No se pudo generar el texto: ' + err };
  }
}

// Fondo del flyer generado con IA: el worker tiene la clave de imágenes,
// así que esto solo hace de puente autenticado.
function fondoFlyer(p) {
  try {
    const res = UrlFetchApp.fetch(WORKER_RELAY_URL, {
      method: 'post', contentType: 'application/json',
      payload: JSON.stringify({ fondoIA: true, secret: BOT_SECRET, tema: dec(p.tema || ''), prompt: dec(p.prompt || '') }),
      muteHttpExceptions: true
    });
    return JSON.parse(res.getContentText());
  } catch (err) { return { error: 'fondo: ' + err }; }
}

// ─── HISTORIAL DE FLYERS ──────────────────────────────────────────────────────
function guardarFlyer(ss, p) {
  const h = getOrCreate(ss, 'FlyersHijos', ['ID','Fecha','Hijo','URL','Titulo','Codigos','Idea','FondoIA','Estado','Config']);
  if (h.getRange(1, 10).getValue() !== 'Config') h.getRange(1, 10).setValue('Config');
  const id = 'F' + Date.now();
  h.appendRow([id, new Date(), dec(p.hijo || ''), dec(p.url || ''), dec(p.titulo || ''),
    dec(p.codigos || ''), dec(p.idea || ''), p.fondo === '1' ? 'SI' : 'NO', 'activo', dec(p.config || '')]);
  return { ok: true, id };
}

function getFlyersHijos(ss, p) {
  const h = ss.getSheetByName('FlyersHijos');
  if (!h || h.getLastRow() < 2) return [];
  const nCols = Math.max(h.getLastColumn(), 9);
  return h.getRange(2, 1, h.getLastRow() - 1, nCols).getValues()
    .filter(r => r[0] && r[2] === p.hijo)
    .map(r => ({
      id: r[0].toString(),
      fecha: r[1] instanceof Date ? Utilities.formatDate(r[1], TZ, 'dd/MM HH:mm') : r[1].toString(),
      url: r[3].toString(), titulo: (r[4] || '').toString(), codigos: (r[5] || '').toString(),
      idea: (r[6] || '').toString(), fondo: r[7] === 'SI', estado: (r[8] || 'activo').toString(),
      config: (r[9] || '').toString()
    }))
    .reverse().slice(0, 60);
}

function eliminarFlyer(ss, p) {
  const h = ss.getSheetByName('FlyersHijos'); if (!h) return { error: 'sin hoja' };
  const datos = h.getDataRange().getValues();
  for (let i = datos.length - 1; i >= 1; i--) {
    if (datos[i][0].toString() === p.id) { h.deleteRow(i + 1); return { ok: true }; }
  }
  return { error: 'no encontrado' };
}

// Manda el flyer terminado al WhatsApp del chico (vía worker → Twilio MediaUrl).
function enviarFlyerWA(p) {
  try {
    const res = UrlFetchApp.fetch(WORKER_RELAY_URL, {
      method: 'post', contentType: 'application/json',
      payload: JSON.stringify({
        relay: true, secret: BOT_SECRET,
        dest: dec(p.hijo || '').toLowerCase(),
        text: '🎨 ¡Tu flyer está listo! Reenvialo a tus contactos o subilo a tu estado.',
        mediaUrl: dec(p.url || '')
      }),
      muteHttpExceptions: true
    });
    return JSON.parse(res.getContentText());
  } catch (err) { return { error: 'envío: ' + err }; }
}

function archivarFlyer(ss, p) {
  const h = ss.getSheetByName('FlyersHijos'); if (!h) return { error: 'sin hoja' };
  const datos = h.getDataRange().getValues();
  for (let i = 1; i < datos.length; i++) {
    if (datos[i][0].toString() === p.id) {
      h.getRange(i + 1, 9).setValue(dec(p.estado || 'archivado'));
      return { ok: true };
    }
  }
  return { error: 'no encontrado' };
}

// ─── ANÁLISIS DE FOTOS DE PRODUCTOS (Claude vision) ──────────────────────────
// Mira la foto y propone nombre, descripción y categoría siguiendo el MOLDE
// de los textos reales del catálogo (se le pasan ejemplos como guía).
function _urlFotoProducto_(ref) {
  const r = dec(ref || '');
  if (r.indexOf('http') === 0) return r;
  return 'https://res.cloudinary.com/dq2boloyp/image/upload/w_800,f_auto,q_auto/' + r;
}

function analizarFotoProducto(ss, p) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  if (!apiKey) return { error: 'sin_clave', mensaje: 'Falta la clave de IA (se carga desde la card Preguntale a tu negocio).' };
  const url = _urlFotoProducto_(p.url);
  if (!url) return { error: 'sin url' };

  // Ejemplos reales del catálogo como molde de estilo + categorías existentes
  const hs = ss.getSheetByName('Stock');
  let ejemplos = [], cats = {};
  if (hs && hs.getLastRow() > 1) {
    hs.getRange(2, 1, hs.getLastRow() - 1, 9).getValues().forEach(r => {
      if (r[1] && r[2] && ejemplos.length < 14) ejemplos.push('- ' + r[1] + ' · ' + r[2]);
      if (r[8]) cats[r[8].toString()] = 1;
    });
  }
  const system = 'Sos el catalogador de "Shuk Mamtakim", almacén argentino de golosinas y productos kosher importados de Israel. ' +
    'Mirás la foto de un producto y escribís su ficha siguiendo EXACTAMENTE el estilo de estos ejemplos reales del catálogo ' +
    '(nombre corto y propio del producto; descripción breve que aclara sabor/tipo y peso o cantidad entre paréntesis si se ve):\n' +
    ejemplos.join('\n') +
    '\nCategorías existentes (elegí la que mejor calce): ' + Object.keys(cats).join(', ') +
    '\nSi el texto del envase está en hebreo, interpretalo. Si no estás seguro del peso, no lo inventes.';

  try {
    const res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
      method: 'post', contentType: 'application/json',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      payload: JSON.stringify({
        model: 'claude-opus-4-8',
        max_tokens: 800,
        system: system,
        output_config: { format: { type: 'json_schema', schema: {
          type: 'object',
          properties: {
            nombre: { type: 'string', description: 'Nombre corto del producto, como en los ejemplos' },
            desc: { type: 'string', description: 'Descripción breve estilo catálogo, con peso/cantidad entre paréntesis si es visible' },
            categoria: { type: 'string', description: 'Una de las categorías existentes' }
          },
          required: ['nombre', 'desc', 'categoria'],
          additionalProperties: false
        } } },
        messages: [{ role: 'user', content: [
          { type: 'image', source: { type: 'url', url: url } },
          { type: 'text', text: 'Generá la ficha de este producto.' }
        ] }]
      }),
      muteHttpExceptions: true
    });
    const code = res.getResponseCode();
    const body = JSON.parse(res.getContentText());
    if (code !== 200) return { error: 'IA error ' + code + (body.error ? ': ' + body.error.message : '') };
    let texto = '';
    (body.content || []).forEach(b => { if (b.type === 'text') texto += b.text; });
    const t = JSON.parse(texto);
    return { ok: true, nombre: t.nombre || '', desc: t.desc || '', categoria: t.categoria || '' };
  } catch (err) { return { error: 'análisis: ' + err }; }
}

// ─── BANDEJA DE FOTOS (análisis en segundo plano) ────────────────────────────
function bandejaSubir(ss, p) {
  const h = getOrCreate(ss, 'BandejaFotos', ['ID','Fecha','PublicId','Nombre','Desc','Categoria','Estado']);
  const id = 'B' + Date.now() + Math.floor(Math.random() * 1000);
  h.appendRow([id, new Date(), dec(p.publicId || ''), '', '', '', 'pendiente']);
  return { ok: true, id };
}

function bandejaListar(ss) {
  const h = ss.getSheetByName('BandejaFotos');
  if (!h || h.getLastRow() < 2) return [];
  return h.getRange(2, 1, h.getLastRow() - 1, 7).getValues()
    .filter(r => r[0] && r[6] !== 'usado')
    .map(r => ({
      id: r[0].toString(), publicId: (r[2] || '').toString(),
      nombre: (r[3] || '').toString(), desc: (r[4] || '').toString(),
      categoria: (r[5] || '').toString(), estado: (r[6] || 'pendiente').toString()
    }))
    .reverse();
}

function bandejaUsar(ss, p) {
  const h = ss.getSheetByName('BandejaFotos'); if (!h) return { error: 'sin hoja' };
  const datos = h.getDataRange().getValues();
  for (let i = 1; i < datos.length; i++) {
    if (datos[i][0].toString() === p.id) { h.getRange(i + 1, 7).setValue('usado'); return { ok: true }; }
  }
  return { error: 'no encontrado' };
}

// Analiza hasta 4 fotos pendientes por corrida (la llama el panel tras subir,
// y también el trigger horario del backup como red de seguridad).
function procesarBandeja(ss) {
  const h = ss.getSheetByName('BandejaFotos');
  if (!h || h.getLastRow() < 2) return { ok: true, procesadas: 0, pendientes: 0 };
  const datos = h.getDataRange().getValues();
  let procesadas = 0, pendientes = 0;
  for (let i = 1; i < datos.length; i++) {
    if (datos[i][6] !== 'pendiente') continue;
    if (procesadas >= 4) { pendientes++; continue; }
    const r = analizarFotoProducto(ss, { url: datos[i][2] });
    if (r.ok) {
      h.getRange(i + 1, 4, 1, 4).setValues([[r.nombre, r.desc, r.categoria, 'listo']]);
      procesadas++;
    } else if (r.error === 'sin_clave') {
      return { error: r.mensaje };
    } else {
      h.getRange(i + 1, 7).setValue('error');
      procesadas++;
    }
  }
  return { ok: true, procesadas, pendientes };
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
      if ((r[9] || '').toString() === 'Oculto') return false;   // internos: no se promocionan
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
  try { procesarBandeja(SpreadsheetApp.openById(SPREADSHEET_ID)); } catch (err) { Logger.log('[bandeja] ' + err); }
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

// ═══════════════════════════════════════════════════════════════════════════
//  CEREBRO DEL BOT — pedidos por SMS / voz (transporte-agnóstico)
//  Recibe {from: teléfono, text: mensaje} y devuelve {reply}. El MISMO motor
//  sirve para SMS (gateway Android) y para voz (speech→texto→cerebro→voz).
//  Texto plano (sin asteriscos) para verse bien en teléfonos básicos kosher.
// ═══════════════════════════════════════════════════════════════════════════

function botMiles_(n){ return Math.round(n||0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }
function botMoney_(n){ return '$ ' + botMiles_(n); }
function botCorto_(t,n){ t=(t||'').toString(); return t.length>n ? t.substring(0,n-1)+'…' : t; }

// Lee de la hoja Stock los productos que un cliente minorista puede pedir.
function botLeerProductos_(ss) {
  const h = ss.getSheetByName('Stock');
  if (!h || h.getLastRow() < 2) return [];
  const d = h.getDataRange().getValues();
  const out = [];
  for (let i = 1; i < d.length; i++) {
    const activo = (d[i][7]||'').toString().toUpperCase();
    const vis = (d[i][9]||'Ambos').toString().trim();
    const stock = parseInt(d[i][5])||0;
    if (activo === 'NO' || vis === 'Oculto' || stock <= 0) continue;
    if (vis !== 'Ambos' && vis !== 'Minorista') continue;   // el bot atiende minoristas
    out.push({
      id: d[i][0].toString(), nombre: (d[i][1]||'').toString(), desc: (d[i][2]||'').toString(),
      precioMin: parseFloat(d[i][4])||0, stock: stock,
      categoria: (d[i][8]||'Varios').toString(), dueno: (d[i][14]||'Miri').toString(),
      descBot: (d[i][16]||'').toString()   // descripción rica para Shuki (col 17, opcional)
    });
  }
  return out;
}

function botCategorias_(prods) {
  const orden = ['Pitzujim','Chocolate','Caramelo','Chupetín','Pastilla','Yumi','Varios'];
  const cats = [];
  prods.forEach(p => { if (cats.indexOf(p.categoria) === -1) cats.push(p.categoria); });
  cats.sort((a,b) => {
    const ia = orden.indexOf(a), ib = orden.indexOf(b);
    return (ia===-1?99:ia) - (ib===-1?99:ib);
  });
  return cats;
}

// Estado de la conversación por teléfono (carrito + nombre), en la hoja BotSesiones.
function botSesion_(ss, tel) {
  const h = getOrCreate(ss, 'BotSesiones', ['Telefono','Carrito','UltimaActividad','Nombre','Historial']);
  const d = h.getDataRange().getValues();
  for (let i = 1; i < d.length; i++) {
    if (d[i][0].toString() === tel) {
      let carrito = {}, hist = [];
      try { carrito = JSON.parse(d[i][1]||'{}'); } catch(e) {}
      try { hist = JSON.parse(d[i][4]||'[]'); } catch(e) {}
      return { fila: i+1, carrito: carrito, nombre: (d[i][3]||'').toString(), historial: hist, h: h };
    }
  }
  h.appendRow([tel, '{}', Utilities.formatDate(new Date(), TZ, 'dd/MM/yyyy HH:mm'), '', '[]']);
  return { fila: h.getLastRow(), carrito: {}, nombre: '', historial: [], h: h };
}

function botGuardarSesion_(s) {
  s.h.getRange(s.fila, 2).setValue(JSON.stringify(s.carrito));
  s.h.getRange(s.fila, 3).setValue(Utilities.formatDate(new Date(), TZ, 'dd/MM/yyyy HH:mm'));
  if (s.nombre) s.h.getRange(s.fila, 4).setValue(s.nombre);
  if (s.historial) s.h.getRange(s.fila, 5).setValue(JSON.stringify(s.historial.slice(-6)));
}

function botMenuCategorias_(prods) {
  if (!prods.length) return 'Por ahora no hay productos disponibles. Probá más tarde. 🍬';
  const cats = botCategorias_(prods);
  let s = '🍬 Shuk Mamtakim - Hola! Que buscas?\n\n';
  cats.forEach((c,i) => { s += (i+1) + '- ' + c + '\n'; });
  s += '\nMandá el numero de la categoria.\nO LISTO cuando termines.';
  return s;
}

function botListarCategoria_(prods, cat) {
  const items = prods.filter(p => p.categoria === cat);
  if (!items.length) return 'No hay productos en esa categoria ahora. Mandá LISTA.';
  let s = cat.toUpperCase() + ':\n\n';
  items.forEach(p => {
    s += p.id + '- ' + p.nombre + (p.desc ? ' ' + botCorto_(p.desc,20) : '') + '  ' + botMoney_(p.precioMin) + '\n';
  });
  const ej2 = items[1] ? ', ' + items[1].id + 'x1' : '';
  s += '\nMandá: codigo x cantidad (ej: ' + items[0].id + 'x2' + ej2 + ')\nPodés pedir varios separados por coma.\nVER tu pedido · LISTO para cerrar';
  return s;
}

function botAgregar_(s, prods, codigo, qty) {
  const p = prods.find(x => x.id === codigo);
  if (!p) return 'No encontré el codigo ' + codigo + '. Mandá LISTA para ver los codigos.';
  if (qty < 1) qty = 1;
  const ya = s.carrito[codigo] || 0;
  if (ya + qty > p.stock) return 'De ' + botNombreItem_(p) + ' quedan ' + p.stock + '. Probá una cantidad menor.';
  s.carrito[codigo] = ya + qty;
  botGuardarSesion_(s);
  return '✓ ' + s.carrito[codigo] + 'x ' + botNombreItem_(p) + ' = ' + botMoney_(p.precioMin * s.carrito[codigo]) +
    '\n\nSegui pidiendo, VER tu pedido, o LISTO para cerrar.';
}

// Nombre mostrable: suma el sabor/desc para los genéricos tipo "Pitzujim".
function botNombreItem_(p) {
  return p.desc ? p.nombre + ' ' + botCorto_(p.desc, 22) : p.nombre;
}

// Parsea uno o varios ítems de un mensaje. Separadores entre ítems: coma, ";",
// salto de línea o " y ". Cada ítem: "codigo x cant", "codigo*cant" o "codigo cant".
// Devuelve [{codigo,qty},...] o null si el mensaje no es una lista de ítems.
function botParsearItems_(raw) {
  const partes = (raw || '').split(/\s*[,;\n]\s*|\s+y\s+/i).map(t => t.trim()).filter(Boolean);
  if (!partes.length) return null;
  const items = [];
  for (let i = 0; i < partes.length; i++) {
    const m = partes[i].match(/^(\d{1,4})\s*[xX*\s]\s*(\d{1,3})$/);
    if (!m) return null;   // si alguna parte no tiene forma de ítem, no es lista de ítems
    items.push({ codigo: m[1], qty: parseInt(m[2], 10) });
  }
  return items;
}

// Agrega varios ítems de una. Reporta los que se agregaron y los que fallaron.
function botAgregarVarios_(s, prods, items) {
  if (items.length === 1) return botAgregar_(s, prods, items[0].codigo, items[0].qty);
  const oks = [], errs = [];
  items.forEach(it => {
    const p = prods.find(x => x.id === it.codigo);
    if (!p) { errs.push('codigo ' + it.codigo + ' no existe'); return; }
    let qty = it.qty < 1 ? 1 : it.qty;
    const ya = s.carrito[it.codigo] || 0;
    if (ya + qty > p.stock) { errs.push('de ' + botNombreItem_(p) + ' solo quedan ' + p.stock); return; }
    s.carrito[it.codigo] = ya + qty;
    oks.push(qty + 'x ' + botNombreItem_(p));
  });
  botGuardarSesion_(s);
  let r = '';
  if (oks.length) r += '✓ Agregué:\n' + oks.map(o => '• ' + o).join('\n') + '\n';
  if (errs.length) r += (oks.length ? '\n' : '') + '⚠️ No pude:\n' + errs.map(e => '• ' + e).join('\n') + '\n';
  r += '\nSegui pidiendo, VER tu pedido, o LISTO para cerrar.';
  return r;
}

function botVerCarrito_(prods, carrito) {
  const ids = Object.keys(carrito).filter(k => carrito[k] > 0);
  if (!ids.length) return 'Tu pedido esta vacio. Mandá LISTA para ver los productos. 🛒';
  let s = 'TU PEDIDO:\n\n', total = 0;
  ids.forEach(id => {
    const p = prods.find(x => x.id === id);
    if (!p) return;
    const sub = p.precioMin * carrito[id]; total += sub;
    s += carrito[id] + 'x ' + botNombreItem_(p) + ' = ' + botMoney_(sub) + '\n';
  });
  s += '\nTOTAL: ' + botMoney_(total) + '\n\nLISTO para confirmar · BORRAR para vaciar';
  return s;
}

function botAyuda_() {
  return 'Shuk Mamtakim - Como pedir:\n\n' +
    '• LISTA = ver categorias\n• numero = ver esa categoria\n• codigo x cantidad (ej 12x2) = agregar\n' +
    '• VER = tu pedido\n• LISTO = confirmar\n• BORRAR = empezar de nuevo';
}

// Cierra el pedido: lo crea en Ventas, descuenta stock, registra ganancias y avisa al negocio.
// Si sim=true es una PRUEBA: arma el resumen pero NO crea pedido ni toca stock.
function botConfirmar_(ss, s, prods, tel, sim) {
  const carrito = s.carrito;
  const ids = Object.keys(carrito).filter(k => carrito[k] > 0);
  if (!ids.length) return 'Tu pedido esta vacio. Mandá LISTA para empezar. 🛒';
  const lineas = [], suArr = [], jonyArr = [];
  let total = 0;
  ids.forEach(id => {
    const p = prods.find(x => x.id === id);
    if (!p) return;
    const qty = carrito[id], sub = p.precioMin * qty;
    total += sub;
    lineas.push('• ' + qty + 'x ' + p.nombre + (p.desc ? ' · ' + p.desc : '') + ' — $ ' + botMiles_(p.precioMin) + ' c/u = $ ' + botMiles_(sub));
    suArr.push(id + ':' + qty);
    if (p.dueno === 'Jony') jonyArr.push(id + ':' + qty + ':' + p.precioMin);
  });
  if (!lineas.length) return 'Hubo un problema con tu pedido. Mandá LISTA y probá de nuevo.';
  if (sim) {
    s.carrito = {}; botGuardarSesion_(s);
    return '✅ (PRUEBA) Pedido tomado! Total ' + botMoney_(total) +
      '.\nEn la realidad acá se cargaria el pedido y se descontaria el stock.\nNada se modificó porque es una simulación. 🧪';
  }
  const h = getOrCreate(ss, 'Ventas', ['ID','Fecha','Cliente','Tipo','Productos','Forma de Pago','Notas','Estado','Total ARS','Total USD','# Venta','ARS Jony','ARS Myri','USD Myri','Comi ARS','Comi USD','Caja Jony','Caja Myri','Tipo Cambio','Stock Updates']);
  const idV = 'P' + Date.now().toString();
  const fecha = Utilities.formatDate(new Date(), TZ, 'dd/MM/yyyy HH:mm');
  const row = h.getLastRow() + 1;
  const nVenta = row - 1;
  const cliente = s.nombre ? s.nombre : ('SMS ' + tel);
  const stockUpdates = suArr.join(',');
  if (h.getRange(1, 21).getValue() !== 'VID') h.getRange(1, 21).setValue('VID');
  h.appendRow([idV, fecha, cliente, 'Minorista', lineas.join('\n'), 'A coordinar', '📱 Pedido por SMS', 'pendiente',
    total, 0, nVenta, 0, 0, 0, 0, 0, '', '', 0, stockUpdates, 'sms_' + tel]);
  h.getRange(row, 1, 1, 2).setNumberFormat('@');
  // Descontar stock + registrar movimiento
  const sh = ss.getSheetByName('Stock');
  if (sh) {
    const sd = sh.getDataRange().getValues();
    suArr.forEach(u => {
      const parts = u.split(':'); const pid = parts[0]; const qty = parseInt(parts[1])||0;
      for (let i = 1; i < sd.length; i++) {
        if (sd[i][0].toString() === pid) {
          const antes = parseInt(sd[i][5])||0, despues = Math.max(0, antes - qty);
          sh.getRange(i+1,6).setValue(despues);
          registrarMovStock_(ss, pid, sd[i][1], -qty, antes, despues, 'Venta SMS #' + nVenta + ' — ' + cliente);
          break;
        }
      }
    });
  }
  // Ganancias pitzujim (igual que la web)
  if (jonyArr.length) {
    const hG = getOrCreate(ss, 'GananciasJony', ['Fecha','Tipo','Descripcion','Monto']);
    let g = 0;
    jonyArr.forEach(it => {
      const pp = it.split(':'); const avg = getCostoPromedio(ss, pp[0]);
      if (avg > 0) g += (parseFloat(pp[2]) - avg) * (parseFloat(pp[1])||0);
    });
    if (g > 0) hG.appendRow([fecha, 'ganancia_pitzujim', 'Pitzujim — ' + cliente, Math.round(g)]);
  }
  // Avisar al negocio
  enviarTelegram_('papa', '📱 NUEVO PEDIDO POR SMS #' + nVenta + '\n👤 ' + cliente + ' (' + tel + ')\n\n' + lineas.join('\n') + '\n\nTotal: $ ' + botMiles_(total) + '\nCoordiná entrega y cobro desde el panel.');
  s.carrito = {};
  botGuardarSesion_(s);
  return '✅ Pedido tomado' + (s.nombre ? ', ' + s.nombre : '') + '! Total ' + botMoney_(total) +
    '.\nTe contactamos para coordinar la entrega. Gracias! 🍬';
}

// Punto de entrada del cerebro.
function procesarMensajeBot_(ss, tel, texto, sim) {
  tel = (tel||'').toString().trim();
  if (!tel) return { reply: 'Error: sin numero de origen.' };
  const s = botSesion_(ss, tel);
  const prods = botLeerProductos_(ss);
  const raw = (texto||'').trim();
  const T = raw.toUpperCase();

  if (T === '' || ['HOLA','LISTA','MENU','MENÚ','INICIO','EMPEZAR','BUENAS','BUENAS!','HI'].indexOf(T) !== -1)
    return { reply: botMenuCategorias_(prods), nVenta: 0 };
  if (['AYUDA','HELP','?'].indexOf(T) !== -1) return { reply: botAyuda_() };
  if (['BORRAR','VACIAR','CANCELAR','RESET'].indexOf(T) !== -1) {
    s.carrito = {}; botGuardarSesion_(s);
    return { reply: 'Listo, vacié tu pedido. Mandá LISTA para empezar de nuevo. 🗑️' };
  }
  if (['VER','CARRITO','PEDIDO'].indexOf(T) !== -1) return { reply: botVerCarrito_(prods, s.carrito) };
  if (['LISTO','FIN','CONFIRMAR','TERMINAR','PAGAR','ENVIAR'].indexOf(T) !== -1)
    return { reply: botConfirmar_(ss, s, prods, tel, sim), cerrado: true };

  // Agregar UNO o VARIOS productos: "43x2" · "43x2, 44x3" · "43x2 y 44x3" · "43 2"
  const items = botParsearItems_(raw);
  if (items && items.length) return { reply: botAgregarVarios_(s, prods, items) };

  // Solo un código → si es producto, agregar 1; si es número de categoría, listar
  const solo = raw.match(/^\s*(\d{1,4})\s*$/);
  if (solo) {
    const esProd = prods.find(p => p.id === solo[1]);
    if (esProd) return { reply: botAgregar_(s, prods, solo[1], 1) };
    const cats = botCategorias_(prods);
    const n = parseInt(solo[1], 10);
    if (n >= 1 && n <= cats.length) return { reply: botListarCategoria_(prods, cats[n-1]) };
  }

  return { reply: 'No te entendí 🤔 Mandá:\n• LISTA (ver productos)\n• codigo y cantidad (ej ' +
    (prods[0] ? prods[0].id + 'x2' : '12x2') + ')\n• VER (tu pedido) · LISTO (cerrar)' };
}

// ═══════════════════════════════════════════════════════════════════════════
//  AGENTE DE VOZ CONVERSACIONAL (Shuki) — Claude entiende lenguaje natural
//  El cliente habla normal ("quiero dos maní grill") y la IA arma el pedido.
//  Mismo carrito/sesión que el bot de comandos; el cierre lo hace el backend.
// ═══════════════════════════════════════════════════════════════════════════

// Últimos pedidos de un teléfono (memoria del cliente entre llamadas).
function botPedidosPrevios_(ss, tel) {
  const h = ss.getSheetByName('Ventas');
  if (!h || h.getLastRow() < 2) return [];
  const d = h.getDataRange().getValues();
  const out = [];
  for (let i = d.length - 1; i >= 1 && out.length < 3; i--) {
    const vid = (d[i][20]||'').toString();
    if (vid === 'sms_' + tel && (d[i][7]||'').toString() !== 'cancelado') {
      out.push({ fecha: (d[i][1]||'').toString().substring(0,10), productos: (d[i][4]||'').toString() });
    }
  }
  return out;
}

function procesarVozIA_(ss, tel, texto, sim, canal) {
  tel = (tel||'').toString().trim();
  if (!tel) return { reply: 'No te escuché bien, ¿me repetís?' };
  const esVoz = canal === 'voz';
  const apiKey = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  if (!apiKey) return { reply: 'Disculpá, ahora no puedo atenderte. Probá más tarde.', error: 'sin_clave' };

  const s = botSesion_(ss, tel);
  // Reset de la charla de prueba (lo usa el botón "Reiniciar" del simulador)
  if ((texto || '').trim() === '__reset__') {
    s.carrito = {}; s.historial = [];
    botGuardarSesion_(s);
    return { reply: 'ok' };
  }
  const prods = botLeerProductos_(ss);
  if (!prods.length) return { reply: 'Perdoná, ahora mismo no tengo productos disponibles. Llamá más tarde así te atiendo.' };

  // Catálogo compacto para el prompt (incluye descripción rica si la cargaron)
  const cat = prods.map(p => p.id + ' | ' + p.nombre + (p.desc ? ' ' + p.desc : '') + ' | $' + botMiles_(p.precioMin) + ' | stock ' + p.stock + (p.descBot ? ' | DESC: ' + p.descBot : '')).join('\n');
  // Perfil del cliente: nombre conocido + qué compró antes (memoria entre llamadas)
  const previos = botPedidosPrevios_(ss, tel);
  let perfil = '';
  if (s.nombre) perfil += 'El cliente se llama ' + s.nombre + '. ';
  if (previos.length) {
    perfil += 'Ya compró antes con nosotros. Sus últimos pedidos:\n' +
      previos.map(pp => '- ' + pp.fecha + ': ' + pp.productos.replace(/\n/g, '; ')).join('\n');
  }
  if (!perfil) perfil = 'Cliente nuevo o sin datos previos.';
  // Charla previa (últimos 6 turnos) como contexto narrativo
  const histTxt = (s.historial || []).slice(-6).map(t => (t.r === 'a' ? 'Shuki' : 'Cliente') + ': ' + t.t).join('\n');
  // Carrito actual (memoria del pedido)
  const ids = Object.keys(s.carrito).filter(k => s.carrito[k] > 0);
  let carritoTxt = '(vacío)', total = 0;
  if (ids.length) {
    const ls = [];
    ids.forEach(id => {
      const p = prods.find(x => x.id === id); if (!p) return;
      const sub = p.precioMin * s.carrito[id]; total += sub;
      ls.push(s.carrito[id] + 'x ' + p.nombre + (p.desc ? ' ' + p.desc : '') + ' = $' + botMiles_(sub));
    });
    carritoTxt = ls.join('\n') + '\nTOTAL: $' + botMiles_(total);
  }

  const system =
    'Sos Shuki, el vendedor telefónico de Shuk Mamtakim, un negocio familiar argentino de golosinas y frutos secos kosher. ' +
    'Atendés a un cliente por TELÉFONO. Hablás español rioplatense, cálido, cercano y BREVE (es una llamada: frases cortas, ' +
    'naturales, una idea por vez). Sos buena onda como un vendedor de barrio que conoce a su gente.\n' +
    'Te paso el CATÁLOGO (codigo | producto | precio | stock) y el CARRITO actual del cliente. El cliente te habla normal.\n' +
    'Tu trabajo: ayudarlo a armar el pedido y cerrarlo.\n' +
    'REGLAS:\n' +
    '- Identificá el producto por su nombre aunque lo diga informal ("maní grill", "los chocolates blancos").\n' +
    '- Si es ambiguo o no está, preguntá con amabilidad cuál es.\n' +
    '- Si el cliente pregunta cómo es un producto, describilo corto y apetitoso. Si en el catálogo el producto ' +
    'trae "DESC:", usá ESA descripción (es la oficial del negocio). Si no la trae, describí con lo que sabés de ' +
    'esa golosina/marca, sin inventar ingredientes ni datos que no podés saber.\n' +
    '- Respetá el stock. Si no alcanza, decíselo con tacto.\n' +
    '- Nunca digas códigos en voz alta (el cliente no los ve): hablá con los nombres.\n' +
    '- PERFIL DEL CLIENTE: si ya lo conocés por su nombre, saludalo por su nombre con cariño. Si compró antes, ' +
    'podés referirte a eso con naturalidad ("¿te llevo las pecan Lotus como la otra vez?"). No seas invasivo.\n' +
    '- Si el cliente te dice su nombre, anotalo en el campo nombre_cliente.\n' +
    '- Cuando el cliente diga que terminó, repetí el pedido y el total y pedí confirmación. Si confirma, cerrá.\n' +
    '- No inventes productos ni precios: usá SOLO el catálogo.\n' +
    (esVoz
      ? '- CANAL: estás en una LLAMADA telefónica. Hablá en prosa fluida y natural, frases cortas, SIN listas, SIN números de ítem, SIN viñetas (no se pueden "escuchar"). Si enumerás productos, decilos en una oración corrida y breve.\n'
      : '- CANAL: estás por MENSAJE de texto (SMS/WhatsApp). Cuando listes varios productos, ponelos en LISTA VERTICAL, uno por línea con guión "- ", cortita y fácil de leer (nombre y precio). Para charlar usá frases normales. Sé breve.\n') +
    'Respondé el JSON:\n' +
    '- reply = lo que vas a DECIR (corto, natural, para leer en voz).\n' +
    '- pedido = la lista COMPLETA de lo que el cliente quiere HASTA AHORA (codigo y cantidad de CADA producto, no solo lo nuevo). ' +
    'El CARRITO ACTUAL de abajo te dice cómo viene. Si el cliente agrega algo, sumalo a lo que ya había. ' +
    'Si solo pregunta, saluda o charla, devolvé el pedido EXACTAMENTE igual a como está (no lo cambies). ' +
    'Si pide sacar algo, devolvé la lista sin eso. Si quiere empezar de cero, devolvé lista vacía.\n' +
    '- confirmar = true SOLO cuando el cliente confirma que ya terminó y quiere cerrar.\n' +
    '- nombre_cliente = el nombre del cliente si lo dijo en algún momento, si no "".\n\n' +
    'PERFIL DEL CLIENTE:\n' + perfil + '\n\n' +
    'CATÁLOGO (codigo | producto | precio | stock | DESC opcional):\n' + cat + '\n\nCARRITO ACTUAL del cliente:\n' + carritoTxt +
    (histTxt ? '\n\nCHARLA HASTA AHORA (para que tengas contexto):\n' + histTxt : '');

  // El historial va como CONTEXTO en el system (arriba). El único mensaje es el turno actual.
  // (Mezclar turnos previos con structured output degradaba la respuesta.)
  const mensajes = [{ role: 'user', content: texto }];

  const payload = JSON.stringify({
    model: 'claude-sonnet-4-6', max_tokens: 1500, system: system,
    output_config: { format: { type: 'json_schema', schema: {
      type: 'object',
      properties: {
        reply: { type: 'string', description: 'Lo que Shuki dice en voz: corto, natural, español rioplatense.' },
        pedido: { type: 'array', description: 'Lista COMPLETA de lo que el cliente quiere hasta ahora (estado final, no incremental).', items: {
          type: 'object',
          properties: {
            codigo: { type: 'string', description: 'Código del producto del catálogo.' },
            cantidad: { type: 'number', description: 'Cantidad total de ese producto en el pedido.' }
          },
          required: ['codigo','cantidad'],
          additionalProperties: false
        } },
        confirmar: { type: 'boolean', description: 'true solo cuando el cliente confirma que terminó.' },
        nombre_cliente: { type: 'string', description: 'Nombre del cliente si lo dijo, si no "".' }
      },
      required: ['reply','pedido','confirmar','nombre_cliente'],
      additionalProperties: false
    } } },
    messages: mensajes
  });
  // Llamada con reintento: cubre cortes/hipos transitorios de la API y JSON truncado.
  let data, dbg = '';
  for (let intento = 0; intento < 3 && !data; intento++) {
    if (intento > 0) Utilities.sleep(500);
    try {
      const res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
        method: 'post', contentType: 'application/json',
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        payload: payload, muteHttpExceptions: true
      });
      const code = res.getResponseCode();
      const raw = res.getContentText();
      if (code !== 200) { dbg = 'http ' + code + ': ' + raw.substring(0, 150); continue; }
      const body = JSON.parse(raw);
      const stop = (body.content && body.stop_reason) ? body.stop_reason : '';
      let txt = '';
      (body.content || []).forEach(b => { if (b.type === 'text') txt += b.text; });
      data = JSON.parse(txt);
      if (stop === 'max_tokens') dbg = 'truncado (subir max_tokens)';
    } catch (err) {
      dbg = 'parse/exc: ' + String(err).substring(0, 150);
    }
  }
  if (!data) {
    Logger.log('[voz] falló tras reintentos: ' + dbg);
    return { reply: 'Perdoná, se me trabó un segundo. ¿Me lo repetís?', _dbg: dbg };
  }

  // El carrito = el estado completo que declara la IA (idempotente: no suma de más)
  const nuevo = {};
  (data.pedido||[]).forEach(it => {
    const p = prods.find(x => x.id === String(it.codigo));
    if (!p) return;
    const q = parseInt(it.cantidad) || 0;
    if (q > 0) nuevo[p.id] = Math.min(p.stock, q);
  });
  s.carrito = nuevo;
  // Recordar el nombre del cliente entre llamadas
  if (data.nombre_cliente && data.nombre_cliente.trim() && !s.nombre) s.nombre = data.nombre_cliente.trim();
  const confirmar = data.confirmar === true && Object.keys(nuevo).length > 0;
  // Guardar el turno en el historial (memoria conversacional)
  s.historial = (s.historial || []).concat([{ r: 'u', t: texto }, { r: 'a', t: data.reply || '' }]).slice(-6);
  if (confirmar) s.historial = [];   // pedido cerrado: arranca charla nueva
  botGuardarSesion_(s);

  // El cierre lo maneja el backend (total exacto + creación real / simulación)
  if (confirmar) {
    const cierre = botConfirmar_(ss, s, prods, tel, sim);
    return { reply: (data.reply ? data.reply + ' ' : '') + cierre, cerrado: true };
  }
  return { reply: data.reply || '¿Querés algo más?' };
}
