// ↩️ LEVANTAR UN PEDIDO CANCELADO (07/09/2026) — navegador real, datos mock, sin escribir nada.
// Cancelar devolvió la mercadería al depósito: levantar tiene que volver a sacarla, pero SOLO lo
// que hay de verdad hoy. Se verifica la radiografía (qué queda / qué se ajusta / qué se cae), lo
// que se manda a guardar, el recálculo cuando el backend avisa que había menos stock, y que el
// reloj de la reserva de 7 días arranque de nuevo sin ensuciar el remito del cliente.
const { chromium } = require('playwright');
const path = require('path');
const INDEX = 'file://' + path.resolve(__dirname, '..', 'index.html');

const CAT = [
  { id: 1, nombre: 'Chocolate Elite', desc: 'Con caramelos explotables (90g)', dueno: 'Miri', moneda: '$', precioMay: '11999', precioMin: 11999, stock: 12, activo: 'SI', visible: 'Ambos', categoria: 'Chocolate', imagen: '' },
  { id: 2, nombre: 'Klik Test', desc: 'Barra', dueno: 'Miri', moneda: '$', precioMay: '3000', precioMin: 3000, stock: 1, activo: 'SI', visible: 'Ambos', categoria: 'Chocolate', imagen: '' },
  { id: 3, nombre: 'Pitzujim', desc: 'Surtido', dueno: 'Jony', moneda: 'U$S', precioMay: '10', precioMin: 10, stock: 0, activo: 'SI', visible: 'Ambos', categoria: 'Pitzujim', imagen: '' }
];
const PEDIDO = {
  id: 'V77', nVenta: 77, cliente: 'Cliente Test', tipo: 'Mayorista', estado: 'cancelado', fecha: '01/01/2026 10:00',
  notas: 'Timbre 3B', stockUpdates: '', totalARS: 33997, totalUSD: 20, arsMyri: 33997, usdJONY: 20, comiARS: 5100,
  productos: '• 2x Chocolate Elite · Con caramelos explotables (90g) — $ 11.999 c/u = $ 23.998 || • 3x Klik Test · Barra — $ 3.000 c/u = $ 9.000 || • 2x Pitzujim · Surtido — U$S 10.00 c/u = U$S 20.00'
};

(async () => {
  const browser = await chromium.launch();
  const pg = await browser.newPage();
  const errs = []; pg.on('pageerror', e => errs.push(e.message));
  pg.on('dialog', d => d.accept());
  await pg.goto(INDEX, { waitUntil: 'domcontentloaded' });
  await pg.waitForFunction(() => typeof abrirLevantarPedido === 'function' && typeof _planLevantarPedido === 'function', { timeout: 20000 });
  await pg.evaluate(cat => { productos = cat; }, CAT);

  let okAll = true; const chk = (n, c, e = '') => { if (!c) okAll = false; console.log((c ? '✅' : '❌') + ' ' + n + (e ? ' — ' + e : '')); };

  // ── 1. La radiografía ───────────────────────────────────────────────────────
  const radio = await pg.evaluate(ped => {
    abrirLevantarPedido(ped);
    const txt = document.getElementById('levantar-overlay').innerText;
    return { txt, lineas: _lvLineas.map(l => ({ n: l.nombre, pedida: l.pedida, qty: l.qty, motivo: l.motivo })) };
  }, PEDIDO);
  console.log('\n── Radiografía del pedido cancelado ──');
  chk('Hay 12: el chocolate entra entero (2)', radio.lineas[0].qty === 2 && radio.lineas[0].motivo === 'ok', JSON.stringify(radio.lineas[0]));
  chk('Hay 1 de 3: el Klik se ajusta a 1', radio.lineas[1].qty === 1 && radio.lineas[1].motivo === 'ajustada', JSON.stringify(radio.lineas[1]));
  chk('Sin stock: el Pitzujim sale del pedido', radio.lineas[2].qty === 0 && radio.lineas[2].motivo === 'sin-stock', JSON.stringify(radio.lineas[2]));
  chk('La pantalla lo explica en criollo ("quedan 1")', /quedan 1/.test(radio.txt), radio.txt.replace(/\n/g, ' | ').slice(0, 240));
  chk('La pantalla avisa que un renglón sale', /sale del pedido/.test(radio.txt));
  chk('Muestra el total viejo y el nuevo', /33\.997/.test(radio.txt) && /26\.998/.test(radio.txt), radio.txt.replace(/\n/g, ' | ').slice(-160));
  chk('El botón de levantar está habilitado', !/No hay stock de nada/.test(radio.txt));

  // ── 2. Qué se manda a guardar ───────────────────────────────────────────────
  const envio = await pg.evaluate(async () => {
    let url = null;
    const orig = window.fetch;
    // Ojo: después de guardar, el panel refresca solo (más fetch) → guardamos SOLO la del guardado.
    window.fetch = async (u) => {
      const s = typeof u === 'string' ? u : (u && u.url) || '';
      if (/levantarPedido/.test(s) && !url) url = s;
      return { ok: true, status: 200, json: async () => ({ ok: true }), text: async () => '{"ok":true}' };
    };
    await confirmarLevantarPedido();
    window.fetch = orig;
    return { url, stockLocal: productos.map(p => p.stock), overlay: !!document.getElementById('levantar-overlay') };
  });
  const q = new URLSearchParams((envio.url || '').split('?')[1] || '');
  console.log('\n── Lo que viaja al motor ──');
  chk('Va la acción levantarPedido', q.get('accion') === 'levantarPedido', q.get('accion'));
  chk('El pedido queda solo con lo que hay (2 renglones)', (q.get('productos') || '').split(' || ').length === 2, q.get('productos'));
  chk('El Klik va con 1, no con 3', /• 1x Klik Test/.test(q.get('productos') || ''));
  chk('El Pitzujim sin stock no viaja', !/Pitzujim/.test(q.get('productos') || ''));
  chk('Se descuenta exactamente 2 y 1', q.get('stockUpdatesNuevo') === '1:2,2:1', q.get('stockUpdatesNuevo'));
  chk('Total ARS recalculado = 23.998 + 3.000', q.get('totalARS') === '26998', q.get('totalARS'));
  chk('Total USD recalculado = 0 (se cayó el renglón en dólares)', parseFloat(q.get('totalUSD')) === 0, q.get('totalUSD'));
  chk('El reparto sigue a nombre de Miri', q.get('arsMyri') === '26998' && q.get('arsJONY') === '0', q.get('arsMyri') + '/' + q.get('arsJONY'));
  chk('La comisión se recalcula sobre lo que quedó (15%)', q.get('comiARS') === String(Math.round(26998 * 0.15)), q.get('comiARS'));
  chk('El catálogo local ya refleja el descuento (12→10, 1→0)', envio.stockLocal[0] === 10 && envio.stockLocal[1] === 0, JSON.stringify(envio.stockLocal));
  chk('La pantalla se cierra al terminar', !envio.overlay);

  // ── 3. El motor avisa que había MENOS stock del que figuraba ────────────────
  const rehecho = await pg.evaluate(async ped => {
    productos[0].stock = 12; productos[1].stock = 1;
    abrirLevantarPedido(ped);
    const orig = window.fetch;
    const resp = { error: 'el stock cambió', recalcular: true, faltantes: [{ id: 1, pide: 2, hay: 1 }] };
    window.fetch = async () => ({ ok: true, status: 200, json: async () => resp, text: async () => JSON.stringify(resp) });
    await confirmarLevantarPedido();
    window.fetch = orig;
    const abierto = !!document.getElementById('levantar-overlay');
    return { abierto, lineas: _lvLineas.map(l => ({ qty: l.qty, motivo: l.motivo })), stockLocal: productos.map(p => p.stock) };
  }, PEDIDO);
  console.log('\n── Si el stock cambió mientras confirmabas ──');
  chk('No se cierra: te muestra la cuenta corregida', rehecho.abierto);
  chk('El chocolate se recalcula a 1', rehecho.lineas[0].qty === 1 && rehecho.lineas[0].motivo === 'ajustada', JSON.stringify(rehecho.lineas[0]));
  chk('El Klik sigue en 1', rehecho.lineas[1].qty === 1);
  chk('No se tocó el stock local (no se escribió nada)', rehecho.stockLocal[0] === 12 && rehecho.stockLocal[1] === 1, JSON.stringify(rehecho.stockLocal));

  // ── 4. Pedido sin nada de stock ─────────────────────────────────────────────
  const vacio = await pg.evaluate(ped => {
    productos.forEach(p => p.stock = 0);
    abrirLevantarPedido(ped);
    const txt = document.getElementById('levantar-overlay').innerText;
    const btn = document.getElementById('lv-btn-ok');
    return { txt, deshabilitado: !!(btn && btn.disabled) };
  }, PEDIDO);
  console.log('\n── Pedido sin stock de nada ──');
  chk('El botón queda bloqueado', vacio.deshabilitado);
  chk('Lo dice con todas las letras', /No hay stock de nada/.test(vacio.txt));

  // ── 4bis. La tarjeta del pedido cancelado ofrece levantarlo ────────────────
  const tarjeta = await pg.evaluate(async ped => {
    productos.forEach(p => p.stock = 5);
    apiGet = async (a) => (a === 'ventas' ? [ped] : []);
    await renderPedidos();
    const html = document.getElementById('pedidos-lista').innerHTML;
    return { hayLevantar: /Levantar pedido/.test(html), hayCancelarDeNuevo: /Cancelar y devolver stock/.test(html) };
  }, PEDIDO);
  console.log('\n── La tarjeta del pedido cancelado ──');
  chk('Ofrece "↩️ Levantar pedido"', tarjeta.hayLevantar);
  chk('Ya no ofrece volver a cancelar lo que está cancelado', !tarjeta.hayCancelarDeNuevo);

  // ── 5. El reloj de la reserva y la nota del cliente ─────────────────────────
  const reloj = await pg.evaluate(() => {
    const hoy = new Date();
    const dd = String(hoy.getDate()).padStart(2, '0') + '/' + String(hoy.getMonth() + 1).padStart(2, '0') + '/' + hoy.getFullYear();
    const vLev = { fecha: '01/01/2026 10:00', notas: '🔁 Levantado el ' + dd + ' · Timbre 3B' };
    const vNormal = { fecha: '01/01/2026 10:00', notas: 'Timbre 3B' };
    return {
      diasLevantado: diasDesdePedido(_fechaReserva(vLev)),
      diasNormal: diasDesdePedido(_fechaReserva(vNormal)),
      notaCliente: _notaCliente(vLev),
      notaManual: _notaCliente({ notas: 'Manual' }),
      notaCotiz: _notaCliente({ notas: '🟡 COTIZACIÓN · Para el shabat' })
    };
  });
  console.log('\n── Reloj de la reserva + nota ──');
  chk('Levantado hoy: el reloj de los 7 días arranca de cero', reloj.diasLevantado === 0, 'días=' + reloj.diasLevantado);
  chk('Un pedido viejo sin levantar sigue contando sus días', reloj.diasNormal > 200, 'días=' + reloj.diasNormal);
  chk('El cliente ve su nota, no el marcador interno', reloj.notaCliente === 'Timbre 3B', reloj.notaCliente);
  chk('"Manual" sigue sin ser una nota', reloj.notaManual === '');
  chk('El prefijo de cotización tampoco llega al remito', reloj.notaCotiz === 'Para el shabat', reloj.notaCotiz);

  const rel = errs.filter(e => /levantar|Levantar|_arm|_plan|identificarLineas/i.test(e));
  chk('Sin errores JS relevantes', rel.length === 0, rel.join('; '));
  await browser.close();
  console.log('\n' + (okAll ? '🟢 LEVANTAR PEDIDO CANCELADO: VERDE' : '🔴 HAY ROJOS'));
  process.exit(okAll ? 0 : 1);
})();
