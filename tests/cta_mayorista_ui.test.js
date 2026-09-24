// 🤝 v5.08 — el cartel «¿Comprás para revender?» se mudó de arriba de todo al medio del catálogo:
// entre lo que hay y lo agotado. Arriba, la gente lo tocaba al entrar creyendo que era la lista.
// En un navegador de verdad, contra el servidor REAL del sitio (despliegue/sitio/servidor.mjs).
// Uso: node tests/cta_mayorista_ui.test.js
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const RAIZ = path.resolve(__dirname, '..');
const SITIO = 'http://127.0.0.1:3199';
const P = (id, nombre, stock, precio, extra = {}) => ({ id, nombre, descripcion: 'desc', precio_may: '5', precio_min: precio, stock, imagen: '', activo: true, categoria: 'Chocolate', visible_cat: 'Ambos', precio_oferta: 0, fecha_oferta: '', cant_pack: 0, precio_pack: 0, dueno: 'Jony', moneda: '$', ...extra });
const PRODS_SB = [
  P(1, 'Klik almohaditas', 16, 7999), P(2, 'Chocolate Elite Crunch', 5, 8999), P(3, 'Milka Oreo', 9, 9500),
  P(4, 'Pitzujim Cajú', 22, 12000, { categoria: 'Pitzujim' }),
  P(5, 'Mentos agotado', 0, 3000, { categoria: 'Pastilla' }), P(6, 'Halva agotada', 0, 5000, { categoria: 'Varios' }),
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
  const nueva = async (ruta, ancho = 420) => {
    const ctx = await b.newContext({ viewport: { width: ancho, height: 900 }, serviceWorkers: 'block' });
    const pg = await ctx.newPage();
    await pg.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      window.supabase = { createClient: () => ({ auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) } }) };
      window.__abiertos = []; window.open = (u) => { window.__abiertos.push(u); return null; };
    });
    pg.on('pageerror', e => errs.push(ruta + ': ' + e.message));
    await pg.route('**/*', async route => {
      const u = route.request().url();
      if (u.includes('getEstadoTienda')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ estado: 'abierta' }) });
      if (u.includes('miHabitual')) return route.fulfill({ contentType: 'application/json', body: '{"items":[],"pedidos":0}' });
      if (/\/rest\/v1\/productos\?/.test(u)) return route.fulfill({ contentType: 'application/json', body: JSON.stringify(PRODS_SB) });
      if (u.startsWith(SITIO)) return route.continue();
      if (u.includes('supabase') || u.includes('ipapi') || u.includes('qrserver') || u.includes('onesignal') || u.includes('bluelytics') || u.includes('cloudinary')) return route.fulfill({ contentType: 'application/json', body: '[]' });
      return route.continue();
    });
    await pg.goto(SITIO + ruta, { waitUntil: 'domcontentloaded' });
    await hasta(async () => (await pg.evaluate(() => document.querySelectorAll('#catalogo .producto-card').length)) > 0);
    return { pg, ctx };
  };
  // Qué hay en la grilla, en orden: C = con stock, A = agotado, M = el cartel, S = la línea "Sin stock"
  const secuencia = pg => pg.evaluate(() => [...document.getElementById('catalogo').children].map(e =>
    e.id === 'banner-mayorista-cta' ? 'M' : e.classList.contains('producto-card') ? (e.classList.contains('agotado') ? 'A' : 'C') : /Sin stock/.test(e.innerText) ? 'S' : '·').join(''));
  const seVe = pg => pg.evaluate(() => { const e = document.getElementById('banner-mayorista-cta'); if (!e) return false; const r = e.getBoundingClientRect(); return r.height > 40 && getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility !== 'hidden'; });

  // 1) Minorista: ya no está arriba; está entre lo que hay y lo agotado, y se ve
  const { pg, ctx } = await nueva('/tienda');
  const sec = await secuencia(pg);
  ok('minorista: el cartel va entre lo último con stock y la línea "Sin stock" (' + sec + ')', /^[·C]*CMSA+$/.test(sec));
  ok('minorista: hay UN solo cartel en toda la página', await pg.evaluate(() => document.querySelectorAll('#banner-mayorista-cta').length === 1));
  ok('minorista: el cartel se VE (alto > 40 px, sin display:none)', await seVe(pg));
  ok('minorista: arriba de todo (antes del buscador) ya no hay cartel', await pg.evaluate(() => {
    const e = document.getElementById('banner-mayorista-cta'), bus = document.getElementById('buscador');
    return !!(bus.compareDocumentPosition(e) & Node.DOCUMENT_POSITION_FOLLOWING);
  }));
  ok('minorista: mismo texto de siempre', await pg.evaluate(() => { const t = document.getElementById('banner-mayorista-cta').innerText; return t.includes('¿Comprás para revender?') && t.includes('Tenemos precios especiales para mayoristas y revendedores.') && t.includes('Consultar precios por mayor'); }));
  await pg.evaluate(() => document.querySelector('#banner-mayorista-cta button').click());
  const abiertos = await pg.evaluate(() => window.__abiertos);
  ok('minorista: el botón abre el mismo WhatsApp con el mismo mensaje', abiertos.length === 1 && abiertos[0] === 'https://wa.me/5491131754540?text=' + encodeURIComponent('Hola! Me interesan los precios mayoristas de Shuk Mamtakim 🍬'));
  await pg.evaluate(() => document.getElementById('banner-mayorista-cta').scrollIntoView({ block: 'center' }));
  await esperar(300);
  await pg.screenshot({ path: path.join(__dirname, 'headless', 'cta_mayorista_medio.png') });
  // 1b) Buscando: si solo aparecen agotados, el cartel NO queda primero
  await pg.fill('#buscador', 'agotad'); await pg.evaluate(() => filtrar()); await esperar(300);
  ok('buscando solo agotados: no hay cartel', await pg.evaluate(() => !document.getElementById('banner-mayorista-cta')));
  await pg.fill('#buscador', 'klik'); await pg.evaluate(() => filtrar()); await esperar(300);
  ok('buscando algo con stock y sin agotados: el cartel va abajo del resultado (' + await secuencia(pg) + ')', /^C+M$/.test(await secuencia(pg)));
  // 1c) Link VIP: nunca
  await pg.fill('#buscador', ''); await pg.evaluate(() => { _vipIds = new Set(['1', '2', '5']); renderCatalogo(); }); await esperar(200);
  ok('link VIP: sin cartel', await pg.evaluate(() => !document.getElementById('banner-mayorista-cta')));
  await ctx.close();

  // 2) Mayorista: no
  const may = await nueva('/mayorista');
  ok('mayorista: sin cartel', await may.pg.evaluate(() => !document.getElementById('banner-mayorista-cta')));
  await may.ctx.close();

  // 3) Compu (grilla ancha): sigue ocupando todo el ancho
  const pc = await nueva('/tienda', 1280);
  ok('compu: el cartel ocupa el ancho de la grilla', await pc.pg.evaluate(() => { const e = document.getElementById('banner-mayorista-cta'), g = document.getElementById('catalogo'); return Math.abs(e.getBoundingClientRect().width - g.getBoundingClientRect().width) < 50; }));
  await pc.pg.evaluate(() => document.getElementById('banner-mayorista-cta').scrollIntoView({ block: 'center' }));
  await esperar(300);
  await pc.pg.screenshot({ path: path.join(__dirname, 'headless', 'cta_mayorista_compu.png') });
  await pc.ctx.close();

  ok('sin errores de JavaScript en la página', errs.length === 0);
  await b.close();
  checks.forEach(c => console.log((c.ok ? '✅' : '❌') + ' ' + c.n));
  if (errs.length) console.log(errs.join('\n'));
  const mal = checks.filter(c => !c.ok).length;
  console.log(mal ? `\n❌ ${mal} de ${checks.length} fallaron` : `\n✅ ${checks.length}/${checks.length}`);
  process.exit(mal ? 1 : 0);
})();
