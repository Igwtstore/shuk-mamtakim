// 🖼️ v4.97 — Las fotos del flyer: si una falla, se reintenta sola con otra dirección; si igual no entra, se AVISA
// (antes el flyer dibujaba un 🍬 en silencio: caso real del flyer "Directo de Israel" del 22/09). Navegador de verdad,
// servidor real del sitio, Cloudinary simulado (primero anda, después falla una vez, después falla siempre).
// Uso: node tests/flyer_fotos_ui.test.js
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const RAIZ = path.resolve(__dirname, '..');
const PNG = require('fs').readFileSync(path.join(RAIZ, 'icon-192.png'));   // una imagen de verdad del repo
const SITIO = 'http://127.0.0.1:3199';
const esperar = ms => new Promise(r => setTimeout(r, ms));

const P = (id, nombre, imagen) => ({ id, nombre, descripcion: '', precio_may: '5', precio_min: 6499, stock: 7, imagen, activo: true, categoria: 'Snacks', visible_cat: 'Ambos', precio_oferta: 0, fecha_oferta: '', cant_pack: 0, precio_pack: 0, dueno: 'Jony', moneda: '$' });
const PRODS = [P(339, 'Carmit Cornflakes', 'shuk-mamtakim/aaa111'), P(340, 'Carmit Kadurim', 'shuk-mamtakim/bbb222'), P(341, 'Carmit Crackers', 'shuk-mamtakim/ccc333')];

(async () => {
  const mock = spawn('node', [path.join(__dirname, '_mock_motor_auth.mjs')], { stdio: 'ignore' });
  const srv = spawn('node', ['servidor.mjs'], { cwd: path.join(RAIZ, 'despliegue', 'sitio'), stdio: 'ignore', env: { ...process.env, MOTOR_URL: 'http://127.0.0.1:3998/motor', SUPABASE_URL: 'http://127.0.0.1:3998', PUERTO: '3199', RAIZ } });
  process.on('exit', () => { try { srv.kill(); mock.kill(); } catch { /**/ } });   // aunque la prueba se corte, no quedan servidores prendidos
  await esperar(1500);
  const b = await chromium.launch();
  const checks = [], errs = [];
  const ok = (n, c) => checks.push({ n, ok: !!c });
  let modo = 'anda';   // 'anda' | 'falla-una-vez' | 'bbb-nunca'
  const pedidas = [];
  const pg = await (await b.newContext({ viewport: { width: 420, height: 900 }, serviceWorkers: 'block' })).newPage();   // sin esto el sw.js pide las fotos por su cuenta y el simulador no las ve
  pg.on('pageerror', e => errs.push(e.message));
  await pg.addInitScript(() => { window.supabase = { createClient: () => ({ auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) } }) }; });
  await pg.route('**/*', async route => {
    const u = route.request().url();
    if (u.includes('res.cloudinary.com') && /shuk-mamtakim\/(aaa111|bbb222|ccc333)/.test(u)) {
      pedidas.push(u);
      const reintento = u.includes('_f=');
      if (modo === 'falla-una-vez' && !reintento) return route.abort();
      if (modo === 'bbb-nunca' && u.includes('bbb222')) return route.abort();
      return route.fulfill({ status: 200, contentType: 'image/png', headers: { 'Access-Control-Allow-Origin': '*' }, body: PNG });
    }
    if (/\/rest\/v1\/productos\?/.test(u)) return route.fulfill({ contentType: 'application/json', body: JSON.stringify(PRODS) });
    if (u.includes('getEstadoTienda')) return route.fulfill({ contentType: 'application/json', body: '{"estado":"abierta"}' });
    if (u.startsWith(SITIO) || u.includes('fonts.g')) return route.continue();
    return route.fulfill({ contentType: 'application/json', body: '{}' });
  });
  await pg.goto(SITIO + '/tienda', { waitUntil: 'domcontentloaded' });
  await esperar(1500);
  await pg.evaluate(() => {
    adminAuth = true; socioActual = 'jony';
    window.__log = [];
    const orig = window._cargarImgFlyer;
    window._cargarImgFlyer = async (url, esReintento) => { const im = await orig(url, esReintento); if (!esReintento) window.__log.push({ url, ok: !!im }); return im; };   // pasa el aviso de reintento (si no, reintentaría sin fin)
  });
  const dibujar = () => pg.evaluate(async () => {
    window.__log = [];
    const t = document.getElementById('toast'); if (t) t.textContent = '';
    _syncCatalogoFlyer();
    const prods = catalogoCache.filter(p => ['339', '340', '341'].includes(p.codigo));
    await dibujarFlyer(prods, { titulo: 'Directo de Israel', frase: 'prueba', cierre: '¡Pedí el tuyo hoy!' });
    return { fotos: prods.map(p => p.foto), log: window.__log.filter(x => /aaa111|bbb222|ccc333/.test(x.url)), aviso: (document.getElementById('toast') || {}).textContent || '' };
  });

  // 1) Todo anda.
  let r = await dibujar();
  ok('la dirección de la foto lleva UN solo recorte (antes: e_trim dos veces)', r.fotos.every(f => (f.match(/e_trim:10/g) || []).length === 1 && f.includes('/w_1400,')));
  ok('con las fotos andando, entran las 3 y no hay aviso', r.log.length === 3 && r.log.every(x => x.ok) && !r.aviso.includes('No pude cargar'));

  // 2) Cada foto falla la primera vez: el reintento (con otra dirección) la trae.
  modo = 'falla-una-vez'; pedidas.length = 0;
  r = await dibujar();
  ok('si la foto falla una vez, se reintenta sola con otra dirección y entra (las 3)', r.log.length === 3 && r.log.every(x => x.ok) && pedidas.filter(u => u.includes('_f=')).length === 3);
  ok('…y no hay aviso (salió bien)', !r.aviso.includes('No pude cargar'));

  // 3) Una foto no entra nunca: se AVISA con su nombre, las otras entran.
  modo = 'bbb-nunca';
  r = await dibujar();
  const logB = r.log.filter(x => x.url.includes('bbb222'));
  ok('la que no entra ni con el reintento queda afuera (y las otras 2 entran)', logB.length === 1 && !logB[0].ok && r.log.filter(x => x.ok).length === 2);
  ok('AVISA: "No pude cargar la foto de: Carmit Kadurim"', await pg.evaluate(() => { const t = document.getElementById('toast'); return !!t && t.textContent.includes('No pude cargar la foto de: Carmit Kadurim'); }));

  // 4) La causa real del 22/09: con el SERVICE WORKER prendido, la miniatura (sin permiso) quedaba guardada opaca
  //    y la foto del lienzo (con permiso) fallaba → 🍬. Cloudinary DE VERDAD (el SW pide por su cuenta).
  const ctx2 = await b.newContext();
  const pg2 = await ctx2.newPage();
  await pg2.addInitScript(() => { window.supabase = { createClient: () => ({ auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) } }) }; });
  await pg2.route('**/*', async route => {
    const u = route.request().url();
    if (/\/rest\/v1\/productos\?/.test(u)) return route.fulfill({ contentType: 'application/json', body: '[]' });
    if (u.startsWith(SITIO) || u.includes('res.cloudinary.com')) return route.continue();
    return route.fulfill({ contentType: 'application/json', body: '{}' });
  });
  await pg2.goto(SITIO + '/tienda', { waitUntil: 'load' });
  await esperar(2500);
  await pg2.reload({ waitUntil: 'load' });   // la segunda carga ya la controla el service worker
  await esperar(1500);
  const sw = await pg2.evaluate(async (w) => {
    const url = `https://res.cloudinary.com/dq2boloyp/image/upload/e_trim:10/w_${w},f_auto,q_auto/shuk-mamtakim/f5jvgkrk9rtofqcfhlxs`;
    const controla = !!navigator.serviceWorker.controller;
    const mini = await new Promise(res => { const i = new Image(); i.onload = () => res(true); i.onerror = () => res(false); i.src = url; });
    await new Promise(res => setTimeout(res, 800));
    const lienzo = await new Promise(res => { const im = new Image(); im.crossOrigin = 'anonymous'; im.onload = () => res(true); im.onerror = () => res(false); im.src = url; });
    const cache = await caches.keys();
    return { controla, mini, lienzo, cache };
  }, 1300 + Math.floor(Math.random() * 90));
  ok('con el service worker: la miniatura se ve Y la foto del lienzo entra (antes: 🍬)', sw.controla && sw.mini && sw.lienzo);
  ok('el cache viejo (con fotos opacas) ya no está: solo shuk-v7', JSON.stringify(sw.cache) === '["shuk-v7"]');
  await ctx2.close();

  ok('sin errores de JavaScript', errs.length === 0);
  await b.close(); srv.kill(); mock.kill();
  checks.forEach(c => console.log((c.ok ? '  ✓ ' : '  ✗ FALLÓ — ') + c.n));
  if (errs.length) console.log('  errores JS:', errs.slice(0, 3));
  const malos = checks.filter(c => !c.ok).length;
  console.log(malos ? `❌ ${malos} de ${checks.length} fallaron` : `✅ ${checks.length}/${checks.length} fotos del flyer OK`);
  process.exit(malos ? 1 : 0);
})().catch(e => { console.error('💥', e); process.exit(1); });
