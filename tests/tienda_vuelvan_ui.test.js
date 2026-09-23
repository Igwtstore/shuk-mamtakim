// 🔁 v4.86 — Tanda 1 "Que vuelvan", en un navegador de verdad y contra el servidor REAL del sitio
// (despliegue/sitio/servidor.mjs) con un motor de mentira: "lo de siempre" aparece, carga el carrito
// sin lo que no tiene stock, cede el lugar al carrito guardado y no sale en mayorista; las dos
// preguntas de después del pedido se muestran una sola vez y quedan registradas.
// Uso: node tests/tienda_vuelvan_ui.test.js
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const RAIZ = path.resolve(__dirname, '..');
const SITIO = 'http://127.0.0.1:3199';
const P = (id, nombre, stock, precio) => ({ id, nombre, descripcion: 'desc', precio_may: '5', precio_min: precio, stock, imagen: '', activo: true, categoria: 'Chocolate', visible_cat: 'Ambos', precio_oferta: 0, fecha_oferta: '', cant_pack: 0, precio_pack: 0, dueno: 'Jony', moneda: '$' });
const PRODS_SB = [P(1, 'Barrita Pesek Zman grande', 17, 6499), P(2, 'Klik cornflakes 65 g', 9, 7999), P(3, 'Pitzujim Maní grill', 48, 9999), P(4, 'Agotado de siempre', 0, 5000)];
const HABITUAL = { items: [{ id: '1', q: 2, veces: 2 }, { id: '2', q: 1, veces: 1 }, { id: '3', q: 2, veces: 2 }, { id: '4', q: 3, veces: 1 }], pedidos: 2, ultima: '20/09/2026 10:00' };
const esperar = ms => new Promise(r => setTimeout(r, ms));
async function hasta(fn, ms = 6000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await esperar(150); } return false; }

(async () => {
  const mock = spawn('node', [path.join(__dirname, '_mock_motor_auth.mjs')], { stdio: 'ignore' });
  const srv = spawn('node', ['servidor.mjs'], { cwd: path.join(RAIZ, 'despliegue', 'sitio'), stdio: 'ignore', env: { ...process.env, MOTOR_URL: 'http://127.0.0.1:3998/motor', SUPABASE_URL: 'http://127.0.0.1:3998', PUERTO: '3199', RAIZ } });
  await esperar(1500);
  const b = await chromium.launch();
  const checks = [], errs = [];
  const ok = (n, c) => checks.push({ n, ok: !!c });
  const recibidos = () => fetch('http://127.0.0.1:3998/_recibidos').then(r => r.json());
  const nueva = async (ruta, antes) => {
    const ctx = await b.newContext();
    const pg = await ctx.newPage();
    await pg.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => false }); window.supabase = { createClient: () => ({ auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) } }) }; });
    if (antes) await pg.addInitScript(antes);
    pg.on('pageerror', e => errs.push(e.message));
    await pg.route('**/*', route => {
      const u = route.request().url();
      if (u.includes('miHabitual')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify(HABITUAL) });
      if (/\/rest\/v1\/productos\?/.test(u)) return route.fulfill({ contentType: 'application/json', body: JSON.stringify(PRODS_SB) });
      if (u.startsWith(SITIO)) return route.continue();
      if (u.includes('supabase') || u.includes('ipapi') || u.includes('qrserver') || u.includes('onesignal')) return route.fulfill({ contentType: 'application/json', body: '[]' });
      return route.continue();
    });
    await pg.goto(SITIO + ruta, { waitUntil: 'domcontentloaded' });
    return { pg, ctx };
  };

  // 1) Minorista, sin carrito guardado: aparece "lo de siempre"
  const { pg, ctx } = await nueva('/tienda');
  ok('aparece "¿Te armo lo de siempre?" arriba del catálogo', await hasta(async () => (await pg.evaluate(() => (document.getElementById('lo-de-siempre') || {}).innerText || '')).includes('¿Te armo lo de siempre?')));
  const card = await pg.evaluate(() => document.getElementById('lo-de-siempre').innerText);
  ok('lista lo habitual con cantidades, y deja afuera lo que no tiene stock', card.includes('2× Barrita Pesek Zman grande') && card.includes('1× Klik cornflakes 65 g') && card.includes('2× Pitzujim Maní grill') && !card.includes('Agotado'));
  ok('el total es el de hoy: 2×6.499 + 7.999 + 2×9.999 = $ 40.995', card.includes('$ 40.995'));
  ok('el catálogo sigue abajo, completo', await pg.evaluate(() => document.querySelectorAll('#catalogo .producto-card').length) === 4);
  await pg.evaluate(() => cargarLoDeSiempre());
  const cart = await pg.evaluate(() => Object.values(carrito).map(i => i.nombre + ':' + i.qty).sort());
  ok('"Cargar lo de siempre" llena el carrito con esas cantidades', JSON.stringify(cart) === JSON.stringify(['Barrita Pesek Zman grande:2', 'Klik cornflakes 65 g:1', 'Pitzujim Maní grill:2']));
  ok('y abre el carrito', await pg.evaluate(() => document.getElementById('carrito-overlay').classList.contains('abierto')));
  ok('se registra "ofrecido" y "cargado" (para medir si sirve)', await hasta(async () => { const r = await recibidos(); return r.some(x => x.evento === 'recompra' && /^ofrecido/.test(x.producto)) && r.some(x => x.evento === 'recompra' && /^cargado/.test(x.producto)); }));

  // 2) Las dos preguntas de después del pedido
  await pg.evaluate(() => mostrarConfirmacionWA('pedido de prueba'));
  const pre = await pg.evaluate(() => (document.getElementById('post-preguntas') || {}).innerText || '');
  ok('después del pedido pregunta "¿Cómo nos conociste?" con opciones de un toque', pre.includes('¿Cómo nos conociste?') && pre.includes('WhatsApp') && pre.includes('Un amigo'));
  ok('el botón de enviar el pedido sigue siendo lo principal (va antes que las preguntas)', await pg.evaluate(() => { const m = document.getElementById('wa-confirm-modal'); const a = m.querySelector('a'); const q = document.getElementById('post-preguntas'); return !!a && !!q && (a.compareDocumentPosition(q) & Node.DOCUMENT_POSITION_FOLLOWING); }));
  await pg.evaluate(() => { const b = [...document.querySelectorAll('#post-preguntas button')].find(x => x.textContent === 'WhatsApp'); b.click(); });
  ok('la respuesta se registra como encuesta canal:whatsapp y agradece', await hasta(async () => (await recibidos()).some(x => x.evento === 'encuesta' && x.producto === 'canal:whatsapp')) && (await pg.evaluate(() => document.getElementById('pp-encuesta').innerText)).includes('Gracias'));
  await pg.evaluate(() => { document.getElementById('wa-confirm-modal').remove(); mostrarConfirmacionWA('otro pedido'); });
  ok('la segunda vez ya no vuelve a preguntar', !(await pg.evaluate(() => (document.getElementById('post-preguntas') || {}).innerText || '')).includes('¿Cómo nos conociste?'));
  await ctx.close();

  // 3) Con un carrito guardado, primero va el carrito guardado (nunca los dos)
  const { pg: pg2, ctx: ctx2 } = await nueva('/tienda', () => { localStorage.setItem('shuk_carrito_guardado', JSON.stringify({ ts: Date.now(), modo: 'minorista', items: [{ id: 2, q: 1 }] })); });
  await esperar(2500);
  ok('con carrito guardado: aparece el carrito guardado y NO "lo de siempre"', await pg2.evaluate(() => !!document.getElementById('rescate-carrito') && !document.getElementById('lo-de-siempre')));
  await ctx2.close();

  // 4) En mayorista no se ofrece (decisión del 22/09)
  const { pg: pg3, ctx: ctx3 } = await nueva('/mayorista', () => { localStorage.setItem('shuk_may_nombre', 'Prueba'); localStorage.setItem('shuk_may_tel', '1100000000'); });
  await esperar(2500);
  ok('en la tienda mayorista no aparece "lo de siempre"', await pg3.evaluate(() => !document.getElementById('lo-de-siempre')));
  await ctx3.close();

  ok('sin errores de JavaScript', errs.length === 0);
  await b.close(); srv.kill(); mock.kill();
  checks.forEach(c => console.log((c.ok ? '  ✓ ' : '  ✗ FALLÓ — ') + c.n));
  if (errs.length) console.log('  errores JS:', errs.slice(0, 3));
  const malos = checks.filter(c => !c.ok).length;
  console.log(malos ? `❌ ${malos} de ${checks.length} fallaron` : `✅ ${checks.length}/${checks.length} tanda 1 OK`);
  process.exit(malos ? 1 : 0);
})().catch(e => { console.error('💥', e); process.exit(1); });
