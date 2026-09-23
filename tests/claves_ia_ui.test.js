// 🔑 v4.93 — La tarjeta "Claves de IA" del panel, en un navegador de verdad y contra el servidor REAL
// del sitio: Jony ve si cada clave está cargada (nunca la clave), la cambia, una clave rechazada no
// pisa nada, la clave viaja en el CUERPO del pedido (nunca en la dirección) y Miri no ve la tarjeta.
// Uso: node tests/claves_ia_ui.test.js
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const RAIZ = path.resolve(__dirname, '..');
const SITIO = 'http://127.0.0.1:3199';
const esperar = ms => new Promise(r => setTimeout(r, ms));
async function hasta(fn, ms = 6000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await esperar(150); } return false; }
const CLAVE_BUENA = 'sk-ant-PRUEBA-BUENA', CLAVE_MALA = 'sk-ant-PRUEBA-MALA';   // cortas a propósito: no tienen forma de clave real (el barrido de seguridad_claves las cazaría)

(async () => {
  const mock = spawn('node', [path.join(__dirname, '_mock_motor_auth.mjs')], { stdio: 'ignore' });
  const srv = spawn('node', ['servidor.mjs'], { cwd: path.join(RAIZ, 'despliegue', 'sitio'), stdio: 'ignore', env: { ...process.env, MOTOR_URL: 'http://127.0.0.1:3998/motor', SUPABASE_URL: 'http://127.0.0.1:3998', PUERTO: '3199', RAIZ } });
  process.on('exit', () => { try { srv.kill(); mock.kill(); } catch { /**/ } });   // aunque la prueba se corte, no quedan servidores prendidos
  await esperar(1500);
  const b = await chromium.launch();
  const checks = [], errs = [], urls = [], posts = [];
  const ok = (n, c) => checks.push({ n, ok: !!c });
  let estado = { anthropic: { cargada: true, origen: 'panel', fecha: '02/07/2026 11:20' }, gemini: { cargada: true, origen: 'secreto', fecha: '' } };
  const ctx = await b.newContext({ viewport: { width: 420, height: 900 } });
  const pg = await ctx.newPage();
  await pg.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => false }); window.supabase = { createClient: () => ({ auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) } }) }; });
  pg.on('pageerror', e => errs.push(e.message));
  await pg.route('**/*', async route => {
    const req = route.request(), u = req.url();
    urls.push(u);
    if (u.includes('accion=estadoClavesIA')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify(estado) });
    if (req.method() === 'POST' && u.includes('/functions/v1/api')) {
      let body = {}; try { body = JSON.parse(req.postData() || '{}'); } catch { /**/ }
      posts.push(body);
      if (body.accion === 'guardarClaveIA') {
        if (body.clave !== CLAVE_BUENA) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ error: 'Anthropic: la clave no funciona (el servicio la rechazó). No se guardó nada.' }) });
        estado = { ...estado, anthropic: { cargada: true, origen: 'panel', fecha: '23/09/2026 10:00' } };
        return route.fulfill({ contentType: 'application/json', body: '{"ok":true}' });
      }
    }
    if (u.includes('getEstadoTienda')) return route.fulfill({ contentType: 'application/json', body: '{"estado":"abierta"}' });
    if (u.includes('miHabitual')) return route.fulfill({ contentType: 'application/json', body: '{"items":[],"pedidos":0}' });
    if (/\/rest\/v1\/productos\?/.test(u)) return route.fulfill({ contentType: 'application/json', body: '[]' });
    if (u.startsWith(SITIO)) return route.continue();
    if (u.includes('supabase') || u.includes('ipapi') || u.includes('qrserver') || u.includes('onesignal') || u.includes('bluelytics') || u.includes('cloudinary')) return route.fulfill({ contentType: 'application/json', body: '[]' });
    return route.continue();
  });
  await pg.goto(SITIO + '/tienda', { waitUntil: 'domcontentloaded' });
  await esperar(800);

  ok('sin sesión de Jony la tarjeta no se dibuja', await pg.evaluate(async () => { await cargarClavesIA(); return document.getElementById('ia-claves').hidden; }));
  await pg.evaluate(async () => { adminAuth = true; socioActual = 'jony'; await cargarClavesIA(); });
  const txt = () => pg.evaluate(() => document.getElementById('ia-claves').innerText);
  let t = await txt();
  ok('Jony ve "🔑 Claves de IA" con el estado de cada una', t.includes('Claves de IA') && t.includes('Claude (Anthropic): ✅ (cargada el 02/07/2026)') && t.includes('Gemini (flyers): ✅ (la de respaldo del motor)'));
  ok('está adentro de "Preguntale a tu negocio" y se ve', await pg.evaluate(() => { const e = document.getElementById('ia-claves'); return !e.hidden && e.closest('#card-ia') !== null; }));
  await pg.evaluate(() => [...document.querySelectorAll('#ia-claves button')].find(x => x.textContent === 'Cambiar').click());
  ok('"Cambiar" abre los dos campos, de tipo contraseña, con de dónde sacar cada clave', await pg.evaluate(() => {
    const a = document.getElementById('ia-clave-anthropic'), g = document.getElementById('ia-clave-gemini');
    return a && g && a.type === 'password' && g.type === 'password' && document.getElementById('ia-claves').innerText.includes('console.anthropic.com') && document.getElementById('ia-claves').innerText.includes('aistudio.google.com');
  }));

  // Una clave que el servicio rechaza: avisa y no cambia nada.
  await pg.evaluate(v => { document.getElementById('ia-clave-anthropic').value = v; }, CLAVE_MALA);
  await pg.evaluate(() => cambiarClaveIA('anthropic'));
  ok('clave rechazada: el aviso lo dice y el estado sigue igual', await hasta(async () => (await pg.evaluate(() => (document.getElementById('toast') || document.body).innerText)).includes('no funciona')) && (await txt()).includes('cargada el 02/07/2026'));
  ok('…y el campo se vacía (la clave no queda a la vista)', await pg.evaluate(() => document.getElementById('ia-clave-anthropic').value === ''));

  // La buena: se guarda y la tarjeta se actualiza sola.
  await pg.evaluate(v => { document.getElementById('ia-clave-anthropic').value = v; }, CLAVE_BUENA);
  await pg.evaluate(() => cambiarClaveIA('anthropic'));
  ok('clave buena: se guarda y la tarjeta muestra la fecha nueva (y se cierra)', await hasta(async () => (await txt()).includes('cargada el 23/09/2026')) && await pg.evaluate(() => !document.getElementById('ia-clave-anthropic')));
  ok('las dos claves viajaron en el CUERPO del pedido (POST)', posts.filter(p => p.accion === 'guardarClaveIA').map(p => p.clave).join(',') === CLAVE_MALA + ',' + CLAVE_BUENA);
  ok('NINGUNA dirección pedida lleva la clave', !urls.some(u => u.includes('PRUEBA-BUENA') || u.includes('PRUEBA-MALA')));
  ok('en ningún momento la tarjeta mostró una clave', !(await txt()).includes('sk-ant'));

  // Miri: nada.
  await pg.evaluate(async () => { socioActual = 'miri'; vistaSocio = 'miri'; await cargarClavesIA(); });
  ok('en la sesión de Miri la tarjeta se esconde', await pg.evaluate(() => document.getElementById('ia-claves').hidden));

  ok('sin errores de JavaScript', errs.length === 0);
  await b.close(); srv.kill(); mock.kill();
  checks.forEach(c => console.log((c.ok ? '  ✓ ' : '  ✗ FALLÓ — ') + c.n));
  if (errs.length) console.log('  errores JS:', errs.slice(0, 3));
  const malos = checks.filter(c => !c.ok).length;
  console.log(malos ? `❌ ${malos} de ${checks.length} fallaron` : `✅ ${checks.length}/${checks.length} claves de IA OK`);
  process.exit(malos ? 1 : 0);
})().catch(e => { console.error('💥', e); process.exit(1); });
