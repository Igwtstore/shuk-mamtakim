// 📋 v4.89 — Tanda 4, en un navegador de verdad y contra el servidor REAL del sitio: la lista rápida
// de la tienda mayorista (− y +, el pie con renglones y totales en U$S y en $ por separado, la vista
// que queda guardada) y, en el panel, el pedido armado por la IA desde un mensaje o una foto.
// Uso: node tests/pedido_rapido_ui.test.js
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const RAIZ = path.resolve(__dirname, '..');
const SITIO = 'http://127.0.0.1:3199';
const P = (id, nombre, stock, precioMay, moneda, extra = {}) => ({ id, nombre, descripcion: 'desc', precio_may: precioMay, precio_min: 9999, stock, imagen: '', activo: true, categoria: 'Chocolate', visible_cat: 'Ambos', precio_oferta: 0, fecha_oferta: '', cant_pack: 0, precio_pack: 0, dueno: 'Jony', moneda, ...extra });
const PRODS = [
  P(12, 'Klik chocolate con leche 65g (amarillo)', 30, '4.5', 'U$S', { unidades_por_paquete: 12 }), P(30, 'Barrita Pesek Zman grande (clasica)', 17, '3.5', 'U$S'),
  P(41, 'Pitzujim-Mani Sabor Grill', 48, '8300', '$', { categoria: 'Pitzujim' }), P(50, 'Agotado de siempre', 0, '5', 'U$S'),
];
const IA = { ok: true, items: [
  { id: 12, nombre: 'Klik chocolate con leche 65g (amarillo)', cantidad: 12, pedido: 'klik de leche', dudoso: false, stock: 30 },
  { id: 30, nombre: 'Barrita Pesek Zman grande (clasica)', cantidad: 24, pedido: 'barritas pesek zman', dudoso: false, stock: 17 },
  { id: 41, nombre: 'Pitzujim-Mani Sabor Grill', cantidad: 5, pedido: 'pitzujim de maní', dudoso: true, stock: 48 },
  { id: 50, nombre: 'Agotado de siempre', cantidad: 2, pedido: 'los de siempre', dudoso: false, stock: 0 },
], noEncontrados: ['alfajores havanna'], cliente: 'Sarah', nota: 'Pide que llegue el jueves.' };
const esperar = ms => new Promise(r => setTimeout(r, ms));
async function hasta(fn, ms = 6000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await esperar(150); } return false; }
// Una foto chiquita de verdad (PNG 2×2) para probar la subida.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR42mP8z8Dwn4EIwDiqEAAxCgQCNmFyRQAAAABJRU5ErkJggg==', 'base64');

(async () => {
  const mock = spawn('node', [path.join(__dirname, '_mock_motor_auth.mjs')], { stdio: 'ignore' });
  const srv = spawn('node', ['servidor.mjs'], { cwd: path.join(RAIZ, 'despliegue', 'sitio'), stdio: 'ignore', env: { ...process.env, MOTOR_URL: 'http://127.0.0.1:3998/motor', SUPABASE_URL: 'http://127.0.0.1:3998', PUERTO: '3199', RAIZ } });
  await esperar(1500);
  const b = await chromium.launch();
  const checks = [], errs = [], pedidosIA = [];
  const ok = (n, c) => checks.push({ n, ok: !!c });
  const recibidos = () => fetch('http://127.0.0.1:3998/_recibidos').then(r => r.json());
  const nueva = async (ctx, ruta) => {
    const pg = await ctx.newPage();
    await pg.clock.setFixedTime(new Date('2026-10-20T15:00:00-03:00'));   // sin fiestas cerca
    await pg.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => false }); localStorage.setItem('shuk_may_nombre', 'Prueba'); localStorage.setItem('shuk_may_tel', '1100000000'); window.supabase = { createClient: () => ({ auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) } }) }; });
    pg.on('pageerror', e => errs.push(e.message));
    await pg.route('**/*', async route => {
      const req = route.request(), u = req.url();
      if (u.includes('getEstadoTienda')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ estado: 'abierta' }) });
      if (req.method() === 'POST' && u.includes('/functions/v1/api')) {
        let body = {}; try { body = JSON.parse(req.postData() || '{}'); } catch { /**/ }
        if (body.accion === 'armarPedidoIA') { pedidosIA.push(body); await esperar(250); return route.fulfill({ contentType: 'application/json', body: JSON.stringify(IA) }); }
      }
      if (/\/rest\/v1\/productos\?/.test(u)) return route.fulfill({ contentType: 'application/json', body: JSON.stringify(PRODS) });
      if (u.startsWith(SITIO)) return route.continue();
      if (u.includes('supabase') || u.includes('ipapi') || u.includes('qrserver') || u.includes('onesignal') || u.includes('bluelytics') || u.includes('cloudinary')) return route.fulfill({ contentType: 'application/json', body: '[]' });
      return route.continue();
    });
    await pg.goto(SITIO + ruta, { waitUntil: 'domcontentloaded' });
    await hasta(async () => pg.evaluate(() => productos.length > 2));
    return pg;
  };

  // 1) Mayorista: el interruptor, la lista, − y +, el pie
  const ctx = await b.newContext({ viewport: { width: 400, height: 860 } });
  const pg = await nueva(ctx, '/mayorista');
  ok('en mayorista aparece "¿Ya sabés lo que querés? 🖼️ Con fotos · 📋 Lista rápida"', await hasta(async () => pg.evaluate(() => { const t = document.getElementById('vista-toggle'); return !t.hidden && t.innerText.includes('Lista rápida'); })));
  await pg.evaluate(() => setVistaMay(true));
  const lista = await pg.evaluate(() => ({ filas: [...document.querySelectorAll('#catalogo .lr-fila')].map(f => f.id), cats: [...document.querySelectorAll('#catalogo .lr-cat')].map(c => c.textContent), tarjetas: document.querySelectorAll('#catalogo .producto-card').length }));
  ok('la lista reemplaza a las tarjetas, agrupada por categoría y con lo agotado al final', lista.tarjetas === 0 && JSON.stringify(lista.cats) === JSON.stringify(['Pitzujim', 'Chocolate', '🔔 Sin stock']) && lista.filas.slice(-1)[0] === 'lr-50');
  await pg.evaluate(() => { lrCambiar(12, 1); });
  ok('"+" suma al carrito y el renglón se marca', await pg.evaluate(() => carrito[12].qty === 1 && document.getElementById('lr-12').classList.contains('en')));
  await pg.evaluate(() => { const i = document.querySelector('#lr-12 input'); i.value = '12'; i.dispatchEvent(new Event('change')); });
  await pg.evaluate(() => { const i = document.querySelector('#lr-41 input'); i.value = '5'; i.dispatchEvent(new Event('change')); });
  await pg.evaluate(() => { const i = document.querySelector('#lr-30 input'); i.value = '99'; i.dispatchEvent(new Event('change')); });
  ok('escribir la cantidad: 12 y 5; 99 de lo que hay 17 queda en 17', await pg.evaluate(() => carrito[12].qty === 12 && carrito[41].qty === 5 && carrito[30].qty === 17 && document.querySelector('#lr-30 input').value === '17'));
  const pie = await pg.evaluate(() => (document.getElementById('lr-pie') || {}).innerText || '');
  ok('el pie: 3 renglones, 34 u. y el total en U$S y en $ por separado (12×4,50 + 17×3,50 = U$S 113.50; 5×8.300 = $ 41.500)', pie.includes('3 renglones') && pie.includes('34 u.') && pie.includes('U$S 113.50 + $ 41.500'));
  await pg.evaluate(() => { [...document.querySelectorAll('#lr-pie button')][0].click(); });
  ok('"Ver pedido →" abre el carrito', await pg.evaluate(() => document.getElementById('carrito-overlay').classList.contains('abierto')));
  await pg.evaluate(() => { cambiarCarritoQty(41, -1); cerrarCarrito(); });
  ok('lo que se cambia en el carrito se ve en la lista', await pg.evaluate(() => document.querySelector('#lr-41 input').value === '4'));
  await pg.evaluate(() => { lrPoner(41, '0'); });
  ok('en 0 sale del carrito y el renglón se desmarca', await pg.evaluate(() => !carrito[41] && !document.getElementById('lr-41').classList.contains('en')));
  ok('queda registrado lo agregado y lo quitado', await hasta(async () => { const r = await recibidos(); return r.some(x => x.evento === 'carrito' && x.producto === 'Klik chocolate con leche 65g (amarillo)') && r.some(x => x.evento === 'quitar' && x.producto === 'Pitzujim-Mani Sabor Grill' && x.total === '0'); }));
  await pg.reload({ waitUntil: 'domcontentloaded' });
  await hasta(async () => pg.evaluate(() => productos.length > 2));
  ok('al volver a entrar sigue en lista rápida (queda guardado en el aparato)', await hasta(async () => pg.evaluate(() => document.querySelectorAll('#catalogo .lr-fila').length === 4)));
  await pg.evaluate(() => setVistaMay(false));
  ok('"🖼️ Con fotos" vuelve a las tarjetas y el pie se va', await pg.evaluate(() => document.querySelectorAll('#catalogo .producto-card').length === 4 && !document.getElementById('lr-pie')));
  await ctx.close();
  const ctx2 = await b.newContext();
  const pg2 = await nueva(ctx2, '/tienda');
  await esperar(800);
  ok('en la tienda minorista no hay lista rápida', await pg2.evaluate(() => document.getElementById('vista-toggle').hidden));
  await ctx2.close();

  // 2) Panel: el pedido armado por la IA
  const ctx3 = await b.newContext({ viewport: { width: 1200, height: 900 } });
  const pg3 = await nueva(ctx3, '/tienda');
  pg3.on('dialog', d => d.accept());
  await pg3.evaluate(() => { adminAuth = true; socioActual = 'jony'; renderManualProductos(); });
  ok('la caja "✨ Armar el pedido con IA" está arriba de Cargar pedido manual', await pg3.evaluate(() => { const c = document.getElementById('pia-caja'); return !!c && c.innerText.includes('Armar el pedido con IA'); }));
  await pg3.evaluate(() => armarPedidoConIA());
  ok('sin mensaje ni foto no manda nada', pedidosIA.length === 0);
  await pg3.evaluate(() => { document.getElementById('pia-texto').value = 'hola! mandame 12 klik de leche, 24 barritas pesek zman y 5 pitzujim de maní 🙏 soy Sarah'; });   // el panel está oculto en esta prueba
  await pg3.setInputFiles('#pia-foto', { name: 'lista.png', mimeType: 'image/png', buffer: PNG });
  ok('la foto se achica y queda lista para mandar (JPG)', await hasta(async () => pg3.evaluate(() => _piaImg && _piaImg.tipo === 'image/jpeg' && _piaImg.data.length > 20)));
  await pg3.evaluate(() => { armarPedidoConIA(); });   // sin esperar la respuesta: se mira el "leyendo"
  ok('mientras lee, lo dice', await hasta(async () => (await pg3.evaluate(() => document.getElementById('pia-res').innerText)).includes('está leyendo el pedido'), 2000));
  ok('manda el mensaje y la foto', await hasta(async () => pedidosIA.some(x => x.texto.includes('12 klik de leche') && x.imagen && x.imagen.tipo === 'image/jpeg')));
  const res = await (async () => { await hasta(async () => (await pg3.evaluate(() => document.getElementById('pia-res').innerText)).includes('La IA armó el pedido')); return pg3.evaluate(() => document.getElementById('pia-res').innerText); })();
  ok('muestra lo que armó, con lo que escribió el cliente', res.includes('La IA armó el pedido de Sarah (4 productos)') && res.includes('12× Klik chocolate con leche 65g (amarillo)') && res.includes('«klik de leche»'));
  ok('avisa lo dudoso, lo que no alcanza, lo que no tiene stock y lo que no está', res.includes('revisá cuál es') && res.includes('hay 17: se cargan 17') && res.includes('sin stock: no se carga') && res.includes('alfajores havanna') && res.includes('Pide que llegue el jueves'));
  await pg3.evaluate(() => { _manualQtys = { 41: 3 }; });
  await pg3.evaluate(() => piaCargar());
  const cargado = await pg3.evaluate(() => ({ q: _manualQtys, cli: document.getElementById('manual-cliente').value, sel: document.getElementById('manual-seleccion-lista').innerText }));
  ok('"Cargar en el pedido" llena el pedido manual (reemplazando lo que había): 12, 17 (lo que hay) y 5; lo agotado no', JSON.stringify(cargado.q) === JSON.stringify({ 12: 12, 30: 17, 41: 5 }));
  ok('y pone el nombre del cliente si estaba vacío', cargado.cli === 'Sarah');
  ok('el pedido armado se ve abajo, listo para revisar y registrar', cargado.sel.includes('Klik chocolate con leche') && cargado.sel.includes('Barrita Pesek Zman'));
  await pg3.evaluate(() => piaDescartar());
  ok('"Descartar" limpia la caja', await pg3.evaluate(() => document.getElementById('pia-res').innerHTML === '' && document.getElementById('pia-texto').value === '' && !_piaImg));
  await ctx3.close();

  ok('sin errores de JavaScript', errs.length === 0);
  await b.close(); srv.kill(); mock.kill();
  checks.forEach(c => console.log((c.ok ? '  ✓ ' : '  ✗ FALLÓ — ') + c.n));
  if (errs.length) console.log('  errores JS:', errs.slice(0, 3));
  const malos = checks.filter(c => !c.ok).length;
  console.log(malos ? `❌ ${malos} de ${checks.length} fallaron` : `✅ ${checks.length}/${checks.length} tanda 4 OK`);
  process.exit(malos ? 1 : 0);
})().catch(e => { console.error('💥', e); process.exit(1); });
