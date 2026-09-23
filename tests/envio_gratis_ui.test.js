// 🚚 v4.90 — Tanda 5, en un navegador de verdad y contra el servidor REAL del sitio: la barra del
// envío gratis en el carrito, la línea del mensaje del pedido, y en el panel la marca en el pedido,
// el remito (de WhatsApp e impreso), el aviso al cobrar, el pedido manual y la tarjeta de configuración.
// Uso: node tests/envio_gratis_ui.test.js
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const RAIZ = path.resolve(__dirname, '..');
const SITIO = 'http://127.0.0.1:3199';
const P = (id, nombre, stock, precioMin, extra = {}) => ({ id, nombre, descripcion: 'desc', precio_may: '5', precio_min: precioMin, stock, imagen: '', activo: true, categoria: 'Chocolate', visible_cat: 'Ambos', precio_oferta: 0, fecha_oferta: '', cant_pack: 0, precio_pack: 0, dueno: 'Jony', moneda: '$', ...extra });
const PRODS = [P(1, 'Barrita Pesek Zman grande', 40, 40000), P(2, 'Klik cornflakes 65 g', 20, 7999), P(3, 'Pitzujim Maní grill', 30, 20000, { categoria: 'Pitzujim' })];
const V = (id, n, tipo, ars, usd) => ({ id, nVenta: n, fecha: '22/09/2026 10:00', cliente: 'Cliente ' + n, tipo, productos: '• 1x Algo — $ 1 c/u = $ 1', formaPago: 'Transferencia', notas: '', estado: 'pendiente', totalARS: ars, totalUSD: usd, arsJONY: ars, arsMyri: 0, usdMyri: 0, usdJONY: usd, comiARS: 0, comiUSD: 0, cajaJony: '', cajaMyri: '', tipoCambio: 0, stockUpdates: '1:1', comprobante: '', ajuste: 0 });
const VENTAS = [V('v1', 101, 'Minorista', 150000, 0), V('v2', 102, 'Minorista', 80000, 0), V('v3', 103, 'Mayorista', 500000, 0)];
const esperar = ms => new Promise(r => setTimeout(r, ms));
async function hasta(fn, ms = 6000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await esperar(150); } return false; }

(async () => {
  const mock = spawn('node', [path.join(__dirname, '_mock_motor_auth.mjs')], { stdio: 'ignore' });
  const srv = spawn('node', ['servidor.mjs'], { cwd: path.join(RAIZ, 'despliegue', 'sitio'), stdio: 'ignore', env: { ...process.env, MOTOR_URL: 'http://127.0.0.1:3998/motor', SUPABASE_URL: 'http://127.0.0.1:3998', PUERTO: '3199', RAIZ } });
  await esperar(1500);
  const b = await chromium.launch();
  const checks = [], errs = [], escrituras = [];
  const ok = (n, c) => checks.push({ n, ok: !!c });
  const recibidos = () => fetch('http://127.0.0.1:3998/_recibidos').then(r => r.json());
  const nueva = async (ruta, { envio = { on: true, min: 120000, zona: 'CABA' } } = {}) => {
    const ctx = await b.newContext({ viewport: { width: 420, height: 900 } });
    const pg = await ctx.newPage();
    await pg.clock.setFixedTime(new Date('2026-10-20T15:00:00-03:00'));
    await pg.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => false }); localStorage.setItem('shuk_may_nombre', 'Ana'); localStorage.setItem('shuk_may_tel', '1155551234'); window.supabase = { createClient: () => ({ auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) } }) }; });
    pg.on('pageerror', e => errs.push(e.message));
    await pg.route('**/*', async route => {
      const req = route.request(), u = req.url();
      if (u.includes('getEstadoTienda')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ estado: 'abierta', envio }) });
      if (u.includes('accion=venta&') || (req.method() === 'POST' && (req.postData() || '').includes('accion=venta&'))) return route.fulfill({ contentType: 'application/json', body: '{"ok":true,"nVenta":777,"id":"x777"}' });
      if (u.includes('accion=ventas')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify(VENTAS) });
      if (u.includes('accion=getPagos') || u.includes('accion=getClientes')) return route.fulfill({ contentType: 'application/json', body: '[]' });
      if (u.includes('accion=setEnvioTienda')) { const q = Object.fromEntries(new URL(u).searchParams.entries()); escrituras.push(q); return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, envio: { on: q.on === '1', min: parseInt(q.min), zona: q.zona } }) }); }
      if (/\/rest\/v1\/productos\?/.test(u)) return route.fulfill({ contentType: 'application/json', body: JSON.stringify(PRODS) });
      if (u.startsWith(SITIO)) return route.continue();
      if (u.includes('supabase') || u.includes('ipapi') || u.includes('qrserver') || u.includes('onesignal') || u.includes('bluelytics') || u.includes('cloudinary')) return route.fulfill({ contentType: 'application/json', body: '[]' });
      return route.continue();
    });
    await pg.goto(SITIO + ruta, { waitUntil: 'domcontentloaded' });
    await hasta(async () => pg.evaluate(() => productos.length > 2));
    await esperar(500);
    return { pg, ctx };
  };

  // 1) El carrito minorista
  const { pg, ctx } = await nueva('/tienda');
  await pg.evaluate(() => { cantidades[1] = 2; agregarAlCarrito(1); cantidades[2] = 1; agregarAlCarrito(2); const x = document.getElementById('sabores-pop'); if (x) x.remove(); abrirCarrito(); });
  const barra1 = await pg.evaluate(() => (document.querySelector('#carrito-contenido .envio-barra') || {}).innerText || '');
  ok('con $ 87.999: "🚚 Te faltan $ 32.001 para el envío gratis dentro de CABA"', barra1.includes('Te faltan $ 32.001 para el envío gratis dentro de CABA'));
  ok('la barra va debajo de los productos y antes de los datos', await pg.evaluate(() => { const bb = document.querySelector('#carrito-contenido .envio-barra'); const n = document.getElementById('nombre-cliente'); return bb && n && (bb.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING); }));
  await pg.evaluate(() => { cambiarCarritoQty(1, 1); });
  const barra2 = await pg.evaluate(() => (document.querySelector('#carrito-contenido .envio-barra') || {}).innerText || '');
  ok('al llegar ($ 127.999): "¡Tu pedido tiene envío gratis dentro de CABA!"', barra2.includes('¡Tu pedido tiene envío gratis dentro de CABA!'));
  ok('queda registrado que la barra lo llevó al mínimo', await hasta(async () => (await recibidos()).some(x => x.evento === 'vidriera' && x.producto === 'envio · alcanzado')));
  // el pedido: el mensaje dice envío gratis
  await pg.evaluate(() => { document.getElementById('forma-pago').value = 'Efectivo'; enviarPedido(); });
  const href = await (async () => { await hasta(async () => pg.evaluate(() => !!document.querySelector('#wa-confirm-modal a'))); return pg.evaluate(() => (document.querySelector('#wa-confirm-modal a') || {}).href || ''); })();
  const msg = decodeURIComponent((href.split('text=')[1] || '').replace(/\+/g, ' '));
  ok('el mensaje del pedido dice "🚚 *Envío gratis* dentro de CABA (compra de $ 120.000 o más)"', msg.includes('🚚 *Envío gratis* dentro de CABA (compra de $ 120.000 o más)') && msg.indexOf('*Total:*') < msg.indexOf('Envío gratis'));
  await ctx.close();

  // 2) Mayorista y apagado: sin barra
  const { pg: pg2, ctx: ctx2 } = await nueva('/mayorista');
  await pg2.evaluate(() => { cantidades[1] = 1; agregarAlCarrito(1); abrirCarrito(); });
  ok('en mayorista no hay barra', await pg2.evaluate(() => !document.querySelector('#carrito-contenido .envio-barra')));
  await ctx2.close();
  const { pg: pg3, ctx: ctx3 } = await nueva('/tienda', { envio: { on: false, min: 120000, zona: 'CABA' } });
  await pg3.evaluate(() => { cantidades[1] = 1; agregarAlCarrito(1); const x = document.getElementById('sabores-pop'); if (x) x.remove(); abrirCarrito(); });
  ok('apagado desde el panel: no hay barra', await pg3.evaluate(() => !document.querySelector('#carrito-contenido .envio-barra')));
  await ctx3.close();

  // 3) Panel
  const { pg: pg4, ctx: ctx4 } = await nueva('/tienda');
  await pg4.evaluate(async () => { adminAuth = true; socioActual = 'jony'; await renderPedidos(); });
  const chips = await pg4.evaluate(() => ['v1', 'v2', 'v3'].map(id => !!document.querySelector('#pedido-' + id + ' .envio-chip')));
  ok('la tarjeta del pedido marca "🚚 Envío gratis" solo en el minorista de $ 150.000', JSON.stringify(chips) === JSON.stringify([true, false, false]));
  const remito = await pg4.evaluate(async () => { const v = (await apiGet('ventas')).find(x => x.id === 'v1'); abrirRemito(v); return { txt: document.getElementById('remito-pre').textContent, aviso: document.getElementById('remito-envio-gratis').hidden ? '' : document.getElementById('remito-envio-gratis').textContent }; });
  ok('el remito dice "🚚 Envío: sin cargo dentro de CABA"', remito.txt.includes('🚚 Envío: sin cargo dentro de CABA'));
  ok('y el modal del remito avisa que lo deje en 0', remito.aviso.includes('Envío gratis') && remito.aviso.includes('$ 150.000'));
  const remito2 = await pg4.evaluate(async () => { const v = (await apiGet('ventas')).find(x => x.id === 'v2'); abrirRemito(v); return { txt: document.getElementById('remito-pre').textContent, oculto: document.getElementById('remito-envio-gratis').hidden }; });
  ok('el de $ 80.000 no dice nada de envío gratis', !remito2.txt.includes('sin cargo') && remito2.oculto);
  const remito3 = await pg4.evaluate(async () => { const v = (await apiGet('ventas')).find(x => x.id === 'v1'); abrirRemito(v); document.getElementById('remito-envio-input').value = '5000'; _remitoRender(); return document.getElementById('remito-pre').textContent; });
  ok('si Jony igual carga un envío (fuera de CABA), manda lo que cargó', remito3.includes('📦 Envío: $ 5.000') && !remito3.includes('sin cargo'));
  await pg4.evaluate(() => cerrarRemito());
  const cobro = await pg4.evaluate(() => { abrirConfirmarCobro('v1', 150000, 0, 0, 'Cliente 101', 0); const g = !document.getElementById('cobro-envio-gratis').hidden; cerrarModalCobro(); abrirConfirmarCobro('v2', 80000, 0, 0, 'Cliente 102', 0); const g2 = !document.getElementById('cobro-envio-gratis').hidden; cerrarModalCobro(); return [g, g2]; });
  ok('al cobrar avisa "no paga envío" solo en el que corresponde', JSON.stringify(cobro) === JSON.stringify([true, false]));
  const manual = await pg4.evaluate(() => { document.getElementById('manual-tipo').value = 'Minorista'; _manualQtys = { 1: 3 }; renderManualProductos(); const a = document.getElementById('manual-total').innerText; _manualQtys = { 1: 2 }; actualizarTotalManual(); const b2 = document.getElementById('manual-total').innerText; return [a, b2]; });
  ok('el pedido manual minorista de $ 120.000 avisa "🚚 Envío gratis"; el de $ 80.000 no', manual[0].includes('Envío gratis') && !manual[1].includes('Envío gratis'));
  await pg4.evaluate(() => cargarAccesoMiri());
  ok('Jony ve la tarjeta "🚚 Envío gratis" con lo guardado', await pg4.evaluate(() => document.getElementById('card-envio').style.display !== 'none' && document.getElementById('envio-min').value === '120000' && document.getElementById('envio-zona').value === 'CABA' && document.getElementById('envio-on').checked));
  ok('y le muestra cómo lo va a ver el cliente', (await pg4.evaluate(() => document.getElementById('envio-preview').innerText)).includes('Te faltan $ 24.000 para el envío gratis dentro de CABA'));
  await pg4.evaluate(() => { document.getElementById('envio-min').value = '160000'; guardarEnvio(); });
  ok('"Guardar" manda el mínimo nuevo y el panel lo usa al toque (con $ 160.000, el pedido de $ 150.000 ya no tiene envío gratis)', await hasta(async () => escrituras.some(q => q.min === '160000' && q.on === '1' && q.zona === 'CABA')) && await hasta(async () => pg4.evaluate(() => _envioCfg.min === 160000 && !document.querySelector('#pedido-v1 .envio-chip'))));
  await ctx4.close();

  ok('sin errores de JavaScript', errs.length === 0);
  await b.close(); srv.kill(); mock.kill();
  checks.forEach(c => console.log((c.ok ? '  ✓ ' : '  ✗ FALLÓ — ') + c.n));
  if (errs.length) console.log('  errores JS:', errs.slice(0, 3));
  const malos = checks.filter(c => !c.ok).length;
  console.log(malos ? `❌ ${malos} de ${checks.length} fallaron` : `✅ ${checks.length}/${checks.length} tanda 5 OK`);
  process.exit(malos ? 1 : 0);
})().catch(e => { console.error('💥', e); process.exit(1); });
