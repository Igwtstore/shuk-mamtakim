// ✂️ v5.03 — FRACCIONAR PAQUETES en el panel, en un navegador de verdad y contra el servidor REAL del sitio (motor de
// mentira: ninguna llamada sale a Supabase). El publicador (tildar la bolsa, por cuántas + precio, costo/margen/alcanza
// solos, los errores), el pedido que viaja al motor, la bolsa con sus fracciones y sueltas en Stock, el actualizador y
// la recepción sin fracciones, el stock valorizado sin doble conteo y el editor de una fracción / de una bolsa.
// Uso: node tests/fracciones_ui.test.js
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const RAIZ = path.resolve(__dirname, '..');
const SITIO = 'http://127.0.0.1:3199';
const P = (id, nombre, stock, precio, extra = {}) => ({ id, nombre, descripcion: 'desc', precio_may: '5', precio_min: precio, stock, imagen: '', activo: true, categoria: 'Marshmelow', visible_cat: 'Ambos', precio_oferta: 0, fecha_oferta: '', cant_pack: 0, precio_pack: 0, dueno: 'Jony', moneda: '$', unidades_por_paquete: 1, fraccion_de: null, fraccion_cant: null, sueltas: 0, ...extra });
const PRODS = [
  P(245, 'Marshmallow Twists Carmel', 2, 38999, { precio_may: '21.9', moneda: 'U$S', unidades_por_paquete: 18 }),
  P(400, 'Marshmallow Twists Carmel · x4', 9, 9500, { precio_may: null, moneda: 'U$S', unidades_por_paquete: 4, fraccion_de: '245', fraccion_cant: 4, visible_cat: 'Minorista' }),
  P(208, 'Kinder Chocolate x 16', 0, 24000, { precio_may: '13.6', moneda: 'U$S', unidades_por_paquete: 16, categoria: 'Chocolate' }),
  P(2, 'Klik cornflakes 65 g', 9, 7999, { categoria: 'Chocolate' }),
];
const esperar = ms => new Promise(r => setTimeout(r, ms));
async function hasta(fn, ms = 6000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await esperar(150); } return false; }

(async () => {
  const mock = spawn('node', [path.join(__dirname, '_mock_motor_auth.mjs')], { stdio: 'ignore' });
  const srv = spawn('node', ['servidor.mjs'], { cwd: path.join(RAIZ, 'despliegue', 'sitio'), stdio: 'ignore', env: { ...process.env, MOTOR_URL: 'http://127.0.0.1:3998/motor', SUPABASE_URL: 'http://127.0.0.1:3998', PUERTO: '3199', RAIZ } });
  process.on('exit', () => { try { srv.kill(); mock.kill(); } catch { /**/ } });
  await esperar(1500);
  const b = await chromium.launch();
  const checks = [], errs = [], motor = [], dialogos = [];
  const ok = (n, c) => checks.push({ n, ok: !!c });
  const ctx = await b.newContext({ viewport: { width: +(process.env.ANCHO || 1100), height: 900 } });
  const pg = await ctx.newPage();
  await pg.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => false }); window.supabase = { createClient: () => ({ auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) } }) }; });
  pg.on('pageerror', e => errs.push(e.message));
  pg.on('dialog', d => { dialogos.push(d.type() + ':' + d.message()); d.accept(); });
  await pg.route('**/*', route => {
    const rq = route.request(), u = rq.url();
    if (u.includes('/functions/v1/api')) {
      const q = Object.fromEntries(new URL(u).searchParams.entries());
      let body = {}; try { body = rq.postData() ? JSON.parse(rq.postData()) : {}; } catch { body = {}; }
      const acc = q.accion || body.accion || '';
      if (['crearFracciones', 'editarProducto', 'eliminarProducto'].includes(acc)) { motor.push({ acc, ...q, ...body }); return route.fulfill({ contentType: 'application/json', body: '{"ok":true,"creadas":[]}' }); }
      if (acc === 'getEstadoTienda') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ estado: 'abierta' }) });
      return route.fulfill({ contentType: 'application/json', body: '[]' });
    }
    if (/\/rest\/v1\/productos\?/.test(u)) return route.fulfill({ contentType: 'application/json', body: JSON.stringify(PRODS) });
    if (u.startsWith(SITIO)) return route.continue();
    if (u.includes('supabase') || u.includes('ipapi') || u.includes('qrserver') || u.includes('onesignal') || u.includes('bluelytics') || u.includes('cloudinary')) return route.fulfill({ contentType: 'application/json', body: '[]' });
    return route.continue();
  });
  await pg.goto(SITIO + '/tienda', { waitUntil: 'domcontentloaded' });
  await hasta(async () => pg.evaluate(() => typeof productos !== 'undefined' && productos.length > 3));
  // Jony en el panel; los costos llegan del endpoint privado (acá se ponen a mano) y el dólar a $ 1.500.
  const prep = () => pg.evaluate(() => { adminAuth = true; socioActual = 'jony'; _tc = 1500; productos.forEach(p => { if (p.id === 245) p.costo = 18; if (p.id === 400) p.costo = 4; if (p.id === 208) p.costo = 9.01; }); });
  await prep();

  const cat = await pg.evaluate(() => productos.map(p => ({ id: p.id, fr: p.fraccionDe, k: p.fraccionCant, su: p.sueltas })));
  ok('el catálogo trae de qué bolsa sale cada fracción (y cuántas lleva)', JSON.stringify(cat.find(x => x.id === 400)) === JSON.stringify({ id: 400, fr: '245', k: 4, su: 0 }) && cat.find(x => x.id === 245).fr === '');

  // ── El publicador ─────────────────────────────────────────────────────────
  // Abrir el panel en la pestaña Stock (como Jony): el publicador tiene que verse y poder escribirse de verdad.
  await pg.evaluate(() => { try { setModo('admin'); } catch (e) {} try { setAdminTab('panel'); } catch (e) {} setPanelSeccion('stock'); });
  await esperar(800); await prep();
  await pg.evaluate(() => renderFraccionar());
  ok('el publicador se VE en la pestaña Stock del panel', await pg.evaluate(() => { const c = document.getElementById('frac-card'); return !!c && c.offsetHeight > 0 && getComputedStyle(c).display !== 'none'; }));
  const card = () => pg.evaluate(() => (document.getElementById('frac-card') || {}).innerText || '');
  let t = await card();
  ok('la tarjeta "✂️ Fraccionar paquetes" está en Stock', t.includes('Fraccionar paquetes') && t.includes('solo tienda minorista'));
  ok('la bolsa: trae 18 · 2 cerradas · la unidad cuesta U$S 1,00 · bolsa a $ 38.999', t.includes('Marshmallow Twists Carmel') && t.includes('trae 18 · 2 cerradas · la unidad cuesta U$S 1,00 · bolsa a $ 38.999'));
  ok('muestra la fracción ya publicada: x4 · $ 9.500 · 9 disp.', t.replace(/\s+/g, ' ').includes('x4 · $ 9.500 · 9 disp.'));
  ok('la fracción NO aparece como bolsa para fraccionar', !t.includes('Carmel · x4\n'));
  ok('un producto que viene suelto (Klik) no aparece', !t.includes('Klik'));
  ok('la bolsa sin stock (Kinder) no aparece con "Solo con stock"', !t.includes('Kinder'));
  await pg.evaluate(() => { document.getElementById('frac-solo-stock').checked = false; renderFraccionar(); });
  ok('…y aparece al destildarlo', (await card()).includes('Kinder Chocolate x 16'));
  await pg.evaluate(() => { document.getElementById('frac-solo-stock').checked = true; renderFraccionar(); });
  ok('sin tildar nada no hay botón de publicar', await pg.evaluate(() => document.getElementById('frac-pie').style.display === 'none'));

  // Tildar la bolsa y completar x3 a $ 6.500
  await pg.evaluate(() => fracTildar('245', true));
  ok('al tildarla aparece la fila "Por __  Precio $ __"', await pg.evaluate(() => document.querySelectorAll('#frac-lista input[placeholder="3"]').length === 1));
  const cant = pg.locator('#frac-lista input[placeholder="3"]').first();
  await cant.click(); await cant.pressSequentially('3');
  ok('escribir no repinta la lista (el cursor sigue en el casillero)', await pg.evaluate(() => document.activeElement && document.activeElement.placeholder === '3'));
  const precio = pg.locator('#frac-lista input[placeholder="6500"]').first();
  await precio.click(); await precio.pressSequentially('6500');
  const info = await pg.evaluate(() => document.getElementById('frac-info-245-0').innerText);
  ok('x3: costo U$S 3,00 ≈ $ 4.500 (bolsa U$S 18 ÷ 18 × 3, al dólar 1.500)', info.includes('costo U$S 3,00') && info.includes('≈ $ 4.500'));
  ok('margen +31% ((6.500 − 4.500) ÷ 6.500)', info.includes('+31%'));
  ok('alcanza 12 (2 bolsas × 18 ÷ 3)', info.includes('alcanza 12'));
  ok('y a cuánto sale esa cantidad al precio de la bolsa: $ 6.500', info.includes('a precio de bolsa: $ 6.500'));
  ok('el botón: "Publicar 1 fracción en la tienda minorista"', (await pg.evaluate(() => document.getElementById('frac-publicar').textContent)).includes('Publicar 1 fracción en la tienda minorista'));

  // Una fila con x4 (ya existe) y otra con x18 (la bolsa entera): no cuentan
  await pg.evaluate(() => fracAgregarFila('245'));
  await pg.evaluate(() => fracAgregarFila('245'));
  const c2 = pg.locator('#frac-lista input[placeholder="3"]').nth(1), p2 = pg.locator('#frac-lista input[placeholder="6500"]').nth(1);
  await c2.click(); await c2.pressSequentially('4'); await p2.click(); await p2.pressSequentially('8000');
  const c3 = pg.locator('#frac-lista input[placeholder="3"]').nth(2), p3 = pg.locator('#frac-lista input[placeholder="6500"]').nth(2);
  await c3.click(); await c3.pressSequentially('18'); await p3.click(); await p3.pressSequentially('30000');
  ok('x4 otra vez: "ya hay una x4"', (await pg.evaluate(() => document.getElementById('frac-info-245-1').innerText)).includes('ya hay una x4'));
  ok('x18 (la bolsa entera): "tiene que ser de 1 a 17"', (await pg.evaluate(() => document.getElementById('frac-info-245-2').innerText)).includes('tiene que ser de 1 a 17'));
  ok('esas dos no se cuentan: sigue "Publicar 1 fracción"', (await pg.evaluate(() => document.getElementById('frac-publicar').textContent)).includes('Publicar 1 fracción'));
  await pg.evaluate(() => { fracQuitarFila('245', 2); fracQuitarFila('245', 1); });
  const c5 = pg.locator('#frac-lista input[placeholder="3"]').nth(0);
  ok('quitar filas no borra lo ya escrito', (await c5.inputValue()) === '3');
  await pg.evaluate(() => fracAgregarFila('245'));
  const c4 = pg.locator('#frac-lista input[placeholder="3"]').nth(1), p4 = pg.locator('#frac-lista input[placeholder="6500"]').nth(1);
  await c4.click(); await c4.pressSequentially('5'); await p4.click(); await p4.pressSequentially('10000');
  if (process.env.CAPTURA) await pg.locator('#frac-card').screenshot({ path: process.env.CAPTURA });
  ok('una x5 a $ 10.000 → "Publicar 2 fracciones"', (await pg.evaluate(() => document.getElementById('frac-publicar').textContent)).includes('Publicar 2 fracciones'));

  await pg.evaluate(() => publicarFracciones(document.getElementById('frac-publicar')));
  ok('pide confirmación con el resumen', await hasta(async () => dialogos.some(d => d.startsWith('confirm:') && d.includes('Marshmallow Twists Carmel: x3 a $ 6.500, x5 a $ 10.000'))));
  ok('le manda al motor la bolsa y las 2 fracciones (por POST, solo cantidad y precio)', await hasta(async () => motor.some(m => m.acc === 'crearFracciones')));
  const mf = motor.find(m => m.acc === 'crearFracciones') || {};
  ok('…exactamente: padre 245, [{x3, $6500}, {x5, $10000}]', mf.padre === '245' && mf.items === JSON.stringify([{ cant: 3, precio: 6500 }, { cant: 5, precio: 10000 }]));
  ok('nunca manda costo ni stock (los pone la base)', !/costo|stock/.test(mf.items || ''));
  ok('después de publicar, la bolsa queda destildada', await hasta(async () => pg.evaluate(() => !Object.keys(_fracSel).length)));

  // Borrar una fracción
  await prep();
  await pg.evaluate(() => borrarFraccion(400));
  ok('borrar una fracción avisa que el stock de la bolsa no cambia', await hasta(async () => dialogos.some(d => d.includes('El stock de la bolsa NO cambia'))));
  ok('…y llama a eliminarProducto con la fracción', await hasta(async () => motor.some(m => m.acc === 'eliminarProducto' && m.id === '400')));

  // ── Stock: la bolsa con sus sueltas y fracciones; la fracción no es mercadería aparte ──
  await prep();
  await pg.evaluate(() => { productos.find(p => p.id === 245).sueltas = 15; });
  const st = await pg.evaluate(() => { renderStockTotal(); return (document.getElementById('stock-total-lista') || {}).innerText || ''; });
  ok('en Stock, la bolsa muestra "2 u. + 15 sueltas" y sus fracciones "✂️ x4"', st.includes('2 u.') && st.includes('+ 15 sueltas') && st.includes('✂️ x4'));
  ok('la fracción no aparece como tarjeta propia', !st.includes('Carmel · x4'));
  const drawer = await pg.evaluate(() => { renderStockDrawer(productosVisibles()); return { frac: !!document.getElementById('sinput-400'), bolsa: !!document.getElementById('sinput-245'), txt: document.getElementById('stock-drawer-body').innerText }; });
  ok('el actualizador de stock no deja cargarle stock a la fracción', !drawer.frac && drawer.bolsa);
  ok('…y en la bolsa avisa las sueltas', drawer.txt.includes('+ 15 sueltas de una bolsa abierta'));
  const rec = await pg.evaluate(() => { document.getElementById('recep-buscar').value = 'marsh'; filtrarRecep(); return document.getElementById('recep-resultados').innerText; });
  const bajos = await pg.evaluate(() => { productos.find(p => p.id === 400).stock = 2; verificarStockBajo(); return document.getElementById('stock-alerta-lista').innerText; });
  ok('"Stock bajo" no avisa por una fracción (lo que se repone es la bolsa)', !bajos.includes('· x4'));
  ok('al recibir mercadería se busca la bolsa, nunca la fracción', rec.includes('Marshmallow Twists Carmel') && !rec.includes('· x4'));
  const sv = await pg.evaluate(() => {
    const todo = _stockValorizar(productosVisibles(), 1500), bien = _stockValorizar(productosVisibles().filter(p => !esFraccion(p)), 1500);
    const f = bien.items.find(i => i.id === 245);
    return { todoUsd: todo.costo.usd, bienUsd: bien.costo.usd, u: f && f.u };
  });
  ok('stock valorizado: la bolsa vale 2 + 15/18 = 2,83 bolsas (las sueltas cuentan)', sv.u === 2.83);
  ok('…y la fracción no se suma dos veces (U$S 50,94, no 86,94)', Math.abs(sv.bienUsd - 50.94) < 0.01 && sv.todoUsd > sv.bienUsd);
  ok('la tarjeta del stock valorizado usa la lista sin fracciones', await pg.evaluate(() => /_stockValorizar\(productosVisibles\(\)\.filter\(p => !esFraccion\(p\)\)/.test(renderStockValorizado.toString())));

  // ── Editor de producto ──
  await pg.evaluate(() => irAEditarProducto(400));
  const ed = await pg.evaluate(() => ({ aviso: document.getElementById('ep-frac').innerText, stock: document.getElementById('ep-stock').disabled, costo: document.getElementById('ep-costo').disabled, dueno: document.getElementById('ep-dueno').disabled, pmay: document.getElementById('ep-pmay').disabled, ambos: [...document.getElementById('ep-visible').options].find(o => o.value === 'Ambos').disabled, nombre: document.getElementById('ep-nombre').disabled }));
  ok('editar una fracción: "✂️ Fracción x4 de «Marshmallow Twists Carmel»…" con el estado de la bolsa', ed.aviso.includes('Fracción x4 de «Marshmallow Twists Carmel»') && ed.aviso.includes('2 cerradas + 15 sueltas') && ed.aviso.includes('solo en la tienda minorista'));
  ok('stock, costo, dueño y precio mayorista bloqueados; "Ambos" no se puede elegir', ed.stock && ed.costo && ed.dueno && ed.pmay && ed.ambos);
  ok('el nombre y el precio minorista sí se editan', !ed.nombre && !(await pg.evaluate(() => document.getElementById('ep-pmin').disabled)));
  await pg.evaluate(() => cerrarEditorProducto());
  await pg.evaluate(() => irAEditarProducto(245));
  const eb = await pg.evaluate(() => ({ aviso: document.getElementById('ep-frac').innerText, su: (document.getElementById('ep-sueltas') || {}).value, stock: document.getElementById('ep-stock').disabled, visAmbos: [...document.getElementById('ep-visible').options].find(o => o.value === 'Ambos').disabled }));
  ok('editar la bolsa: casillero de sueltas (15) y sus fracciones publicadas', eb.su === '15' && eb.aviso.includes('Fracciones publicadas') && eb.aviso.includes('x4'));
  ok('en la bolsa todo sigue editable (stock, "Ambos")', !eb.stock && !eb.visAmbos);
  await pg.evaluate(() => { document.getElementById('ep-sueltas').value = '12'; });
  await pg.evaluate(() => guardarEdicionProducto());
  ok('guardar la bolsa manda las sueltas corregidas (12)', await hasta(async () => motor.some(m => m.acc === 'editarProducto' && m.id === '245' && m.sueltas === '12')));
  await pg.evaluate(() => irAEditarProducto(208));
  const k = await pg.evaluate(() => ({ su: document.getElementById('ep-sueltas') && document.getElementById('ep-sueltas').value, visAmbos: [...document.getElementById('ep-visible').options].find(o => o.value === 'Ambos').disabled }));
  ok('otra bolsa: sus sueltas en 0 y la opción "Ambos" vuelve a estar (no quedó bloqueada)', k.su === '0' && !k.visAmbos);
  await pg.evaluate(() => { guardarEdicionProducto(); });
  ok('si no tocás las sueltas, no se mandan', await hasta(async () => motor.some(m => m.acc === 'editarProducto' && m.id === '208')) && !motor.some(m => m.acc === 'editarProducto' && m.id === '208' && 'sueltas' in m));
  await pg.evaluate(() => irAEditarProducto(2));
  ok('un producto que viene suelto no muestra la caja de fracciones', await pg.evaluate(() => document.getElementById('ep-frac').style.display === 'none'));

  ok('sin errores de JavaScript en la página', errs.length === 0);
  if (errs.length) console.log('Errores:', errs.slice(0, 5));
  await b.close();
  const mal = checks.filter(c => !c.ok);
  checks.forEach(c => console.log((c.ok ? '  ✓ ' : '  ✗ FALLÓ — ') + c.n));
  console.log('\n' + (mal.length ? '❌ ' + mal.length + ' de ' + checks.length + ' FALLARON' : '✅ ' + checks.length + ' de ' + checks.length));
  process.exit(mal.length ? 1 : 0);
})();
