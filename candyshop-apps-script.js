const SPREADSHEET_ID = '17uCcaoZ5TDZbiL4R3L881JQ8_-J94sWUP4KjUDqaV1c';
const TZ = 'America/Argentina/Buenos_Aires';

function doGet(e) {
  const accion = e.parameter.accion;
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
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
      h.getRange(row,1).setNumberFormat('@'); return ok();
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
        0, '', 0, 0, 'Ambos', dec(e.parameter.dueno||'Miri')]);
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
          h.getRange(i+1, 15).setValue(dec(e.parameter.visibleOferta||'Ambos'));
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

  } catch(err) { return json({error:err.toString()}); }
}

function dec(v){try{return decodeURIComponent(v||'');}catch(e){return v||'';}}
function ok(){return json({ok:true});}
function json(d){return ContentService.createTextOutput(JSON.stringify(d)).setMimeType(ContentService.MimeType.JSON);}
function getOrCreate(ss,nombre,headers){let h=ss.getSheetByName(nombre);if(!h){h=ss.insertSheet(nombre);h.appendRow(headers);h.getRange(1,1,1,headers.length).setFontWeight('bold');}return h;}

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
  return h.getRange(2,1,h.getLastRow()-1,11).getValues()
    .filter(r => r[0] && (!p.hijo || r[1] === p.hijo))
    .map(r => {
      let fecha;
      if (r[0] && typeof r[0].getTime === 'function') {
        fecha = Utilities.formatDate(r[0], TZ, 'dd/MM/yyyy');
      } else {
        fecha = r[0].toString().trim().substring(0, 10);
      }
      return {
        fecha, hijo: r[1], producto: r[2], codigo: r[3],
        cantidad: r[4], precio: r[5], total: r[6],
        cliente: r[7], esDebe: r[8], pagoParcial: r[9], saldoPendiente: r[10]
      };
    });
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
