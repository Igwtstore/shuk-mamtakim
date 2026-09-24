// ✂️ v5.03 — FRACCIONES en la TIENDA, en un navegador de verdad (servidor real del sitio, motor y Supabase simulados).
// La bolsa entera y sus promos comparten las unidades: el carrito pone el tope sumando todo lo de la misma bolsa
// (la misma cuenta que hace el motor), en la tarjeta, el + del carrito y la lista rápida. La promo se ve solo en la
// tienda minorista y dice "✂️ 3 unidades · $ X c/u".
// Uso: node tests/fracciones_tienda_ui.test.js
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const RAIZ = path.resolve(__dirname, '..');
const SITIO = 'http://127.0.0.1:3199';
const P = (id, nombre, stock, precio, extra = {}) => ({ id, nombre, descripcion: 'desc', precio_may: '21.9', precio_min: precio, stock, imagen: '', activo: true, categoria: 'Marshmelow', visible_cat: 'Ambos', precio_oferta: 0, fecha_oferta: '', cant_pack: 0, precio_pack: 0, dueno: 'Jony', moneda: 'U$S', unidades_por_paquete: 1, fraccion_de: null, fraccion_cant: null, sueltas: 0, ...extra });
// 2 bolsas de 18 = 36 unidades = 12 x3 = 9 x4 (lo que calcula la base)
const PRODS = [
  P(245, 'Marshmallow Twists Carmel', 2, 38999, { unidades_por_paquete: 18 }),
  P(401, 'Marshmallow Twists Carmel · x3', 12, 6500, { precio_may: null, unidades_por_paquete: 3, fraccion_de: '245', fraccion_cant: 3, visible_cat: 'Minorista' }),
  P(400, 'Marshmallow Twists Carmel · x4', 9, 8000, { precio_may: null, unidades_por_paquete: 4, fraccion_de: '245', fraccion_cant: 4, visible_cat: 'Minorista' }),
  P(2, 'Klik cornflakes 65 g', 5, 7999, { moneda: '$', precio_may: '5' }),
];
const esperar = ms => new Promise(r => setTimeout(r, ms));
async function hasta(fn, ms = 6000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await esperar(150); } return false; }

(async () => {
  const mock = spawn('node', [path.join(__dirname, '_mock_motor_auth.mjs')], { stdio: 'ignore' });
  const srv = spawn('node', ['servidor.mjs'], { cwd: path.join(RAIZ, 'despliegue', 'sitio'), stdio: 'ignore', env: { ...process.env, MOTOR_URL: 'http://127.0.0.1:3998/motor', SUPABASE_URL: 'http://127.0.0.1:3998', PUERTO: '3199', RAIZ } });
  process.on('exit', () => { try { srv.kill(); mock.kill(); } catch { /**/ } });
  await esperar(1500);
  const b = await chromium.launch();
  const checks = [], errs = [];
  const ok = (n, c) => checks.push({ n, ok: !!c });
  const ctx = await b.newContext({ viewport: { width: 420, height: 900 } });
  const pg = await ctx.newPage();
  await pg.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => false }); window.supabase = { createClient: () => ({ auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) } }) }; });
  pg.on('pageerror', e => errs.push(e.message));
  pg.on('dialog', d => d.accept());
  await pg.route('**/*', route => {
    const u = route.request().url();
    if (u.includes('/functions/v1/api')) {
      if (u.includes('getEstadoTienda')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ estado: 'abierta' }) });
      return route.fulfill({ contentType: 'application/json', body: '[]' });
    }
    if (/\/rest\/v1\/productos\?/.test(u)) return route.fulfill({ contentType: 'application/json', body: JSON.stringify(PRODS) });
    if (u.startsWith(SITIO)) return route.continue();
    if (u.includes('supabase') || u.includes('ipapi') || u.includes('qrserver') || u.includes('onesignal') || u.includes('bluelytics') || u.includes('cloudinary')) return route.fulfill({ contentType: 'application/json', body: '[]' });
    return route.continue();
  });
  await pg.goto(SITIO + '/tienda', { waitUntil: 'domcontentloaded' });
  await hasta(async () => pg.evaluate(() => typeof productos !== 'undefined' && productos.length > 3));
  await pg.evaluate(() => { try { setModo('minorista'); } catch (e) {} renderCatalogo(); });
  const disp = () => pg.evaluate(() => Object.fromEntries([245, 401, 400, 2].map(id => [id, stockDisponible(productos.find(p => p.id === id))])));

  // Carrito vacío: cada uno lo suyo
  ok('carrito vacío: bolsa 2 · x3 12 · x4 9 · Klik 5 (normal, igual que siempre)', JSON.stringify(await disp()) === JSON.stringify({ 2: 5, 245: 2, 400: 9, 401: 12 }));
  const cardX3 = await pg.evaluate(() => (document.getElementById('card-401') || {}).innerText || '');
  ok('la promo se ve en la tienda minorista, con "✂️ 3 unidades · $ 2.167 c/u"', cardX3.includes('Marshmallow Twists Carmel · x3') && cardX3.replace(/\s+/g, ' ').includes('✂️ 3 unidades $ 2.167 c/u'));
  const cardBolsa = await pg.evaluate(() => (document.getElementById('card-245') || {}).innerText || '');
  ok('la bolsa entera sigue a la venta ("📦 trae 18")', cardBolsa.includes('trae 18'));

  // Se lleva 1 bolsa entera → quedan 18 unidades para las promos
  await pg.evaluate(() => _sumarUnidad(245, 'fila'));
  ok('con 1 bolsa en el carrito: x3 hasta 6 · x4 hasta 4 (queda 1 bolsa = 18 u.)', JSON.stringify(await disp()) === JSON.stringify({ 2: 5, 245: 2, 400: 4, 401: 6 }));
  // Lista rápida: pide 5 x4 → lo baja a 4
  await pg.evaluate(() => lrPoner(400, 5));
  ok('pedir 5 x4 lo baja a 4 (no alcanza para 5)', await pg.evaluate(() => carrito[400] && carrito[400].qty === 4));
  ok('ahora la bolsa entera: solo la que ya está (la otra la abren las x4)', (await disp())[245] === 1);
  ok('y la x3 ya no tiene de dónde sacar (sobran 2 unidades)', (await disp())[401] === 0);
  await pg.evaluate(() => cambiarCarritoQty(245, 1));
  ok('el + del carrito no deja sumar otra bolsa entera', await pg.evaluate(() => carrito[245].qty === 1));
  const tope401 = await pg.evaluate(() => { renderCatalogo(); const bt = document.querySelectorAll('#card-401 .qty-btn')[1]; return bt ? bt.getAttribute('onclick') : ''; });
  ok('la tarjeta de la x3 ya trae el tope en 0', /cambiarQty\(401,1,0\)/.test(tope401));
  // Saca la bolsa entera → vuelven las unidades
  await pg.evaluate(() => { eliminarDelCarrito(245); });
  ok('sin la bolsa en el carrito: 4 x4 (16 u.) → x3 hasta 6 · bolsa entera hasta 1', JSON.stringify(await disp()) === JSON.stringify({ 2: 5, 245: 1, 400: 9, 401: 6 }));

  // Con sueltas: 1 cerrada + 15 sueltas (después de una venta de x3)
  await pg.evaluate(() => { carrito = {}; const b = productos.find(p => p.id === 245); b.stock = 1; b.sueltas = 15; });
  ok('1 cerrada + 15 sueltas: x3 hasta 11 · x4 hasta 8 · bolsa entera 1 (las sueltas no arman bolsa)', JSON.stringify(await disp()) === JSON.stringify({ 2: 5, 245: 1, 400: 8, 401: 11 }));
  await pg.evaluate(() => lrPoner(401, 5));   // 15 unidades: salen justo de las sueltas
  ok('5 x3 (15 u.) salen de las sueltas: la bolsa cerrada sigue disponible entera', (await disp())[245] === 1);
  await pg.evaluate(() => lrPoner(400, 1));   // 4 u. más → hay que abrir la cerrada
  ok('una x4 más obliga a abrir la cerrada: ya no queda bolsa entera', (await disp())[245] === 0);

  // Mayorista: la promo no aparece
  await pg.evaluate(() => { carrito = {}; try { setModo('mayorista'); } catch (e) {} renderCatalogo(); });
  const may = await pg.evaluate(() => ({ x3: !!document.getElementById('card-401'), x4: !!document.getElementById('card-400'), bolsa: !!document.getElementById('card-245') }));
  ok('en la tienda mayorista la promo NO aparece (la bolsa sí)', !may.x3 && !may.x4 && may.bolsa);

  ok('sin errores de JavaScript en la página', errs.length === 0);
  if (errs.length) console.log('Errores:', errs.slice(0, 5));
  await b.close();
  const mal = checks.filter(c => !c.ok);
  checks.forEach(c => console.log((c.ok ? '  ✓ ' : '  ✗ FALLÓ — ') + c.n));
  console.log('\n' + (mal.length ? '❌ ' + mal.length + ' de ' + checks.length + ' FALLARON' : '✅ ' + checks.length + ' de ' + checks.length));
  process.exit(mal.length ? 1 : 0);
})();
