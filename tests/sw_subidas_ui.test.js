// 🛑 v4.98 — Con el service worker PRENDIDO, una subida de foto (POST a api.cloudinary.com) llega ENTERA a Cloudinary.
// En la v4.97 el SW la rearmaba como GET y se perdía el archivo: "guardado" sin foto. Cloudinary DE VERDAD, con un
// preset que no existe: si el POST llega entero contesta "Upload preset not found" y no guarda nada.
// Y de paso: las fotos (descargas) siguen entrando al lienzo del flyer.
// Uso: node tests/sw_subidas_ui.test.js
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const RAIZ = path.resolve(__dirname, '..');
const SITIO = 'http://127.0.0.1:3199';
const esperar = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const mock = spawn('node', [path.join(__dirname, '_mock_motor_auth.mjs')], { stdio: 'ignore' });
  const srv = spawn('node', ['servidor.mjs'], { cwd: path.join(RAIZ, 'despliegue', 'sitio'), stdio: 'ignore', env: { ...process.env, MOTOR_URL: 'http://127.0.0.1:3998/motor', SUPABASE_URL: 'http://127.0.0.1:3998', PUERTO: '3199', RAIZ } });
  process.on('exit', () => { try { srv.kill(); mock.kill(); } catch { /**/ } });   // aunque la prueba se corte, no quedan servidores prendidos
  await esperar(1500);
  const b = await chromium.launch();
  const checks = [], errs = [];
  const ok = (n, c) => checks.push({ n, ok: !!c });
  const pg = await (await b.newContext()).newPage();
  pg.on('pageerror', e => errs.push(e.message));
  await pg.addInitScript(() => { window.supabase = { createClient: () => ({ auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) } }) }; });
  await pg.route('**/*', async route => {
    const u = route.request().url();
    if (/\/rest\/v1\/productos\?/.test(u)) return route.fulfill({ contentType: 'application/json', body: '[]' });
    if (u.startsWith(SITIO) || u.includes('cloudinary.com')) return route.continue();
    return route.fulfill({ contentType: 'application/json', body: '{}' });
  });
  await pg.goto(SITIO + '/tienda', { waitUntil: 'load' });
  await esperar(2500);
  await pg.reload({ waitUntil: 'load' });   // la segunda carga ya la controla el service worker
  await esperar(1500);
  const png = fs.readFileSync(path.join(RAIZ, 'icon-192.png')).toString('base64');
  const r = await pg.evaluate(async ({ png, w }) => {
    const controla = !!navigator.serviceWorker.controller;
    const cache = await caches.keys();
    // Subida como la del panel (FormData por POST), con un preset que NO existe → no se guarda nada.
    const bin = Uint8Array.from(atob(png), c => c.charCodeAt(0));
    const fd = new FormData(); fd.append('file', new Blob([bin], { type: 'image/png' }), 'prueba.png'); fd.append('upload_preset', 'no_existe_prueba_23sep');
    const res = await fetch('https://api.cloudinary.com/v1_1/dq2boloyp/image/upload', { method: 'POST', body: fd });
    const subida = (await res.json().catch(() => ({}))).error?.message || '';
    // Una foto (descarga) sigue entrando al lienzo después de verse como miniatura.
    const url = `https://res.cloudinary.com/dq2boloyp/image/upload/e_trim:10/w_${w},f_auto,q_auto/shuk-mamtakim/f5jvgkrk9rtofqcfhlxs`;
    await new Promise(res => { const i = new Image(); i.onload = i.onerror = res; i.src = url; });
    const lienzo = await new Promise(res => { const im = new Image(); im.crossOrigin = 'anonymous'; im.onload = () => res(true); im.onerror = () => res(false); im.src = url; });
    return { controla, cache, subida, lienzo };
  }, { png, w: 1200 + Math.floor(Math.random() * 90) });
  ok('el service worker controla la página (como en la PC de Jony)', r.controla);
  ok('la SUBIDA llega entera a Cloudinary (contesta "Upload preset not found", no el error de un pedido sin archivo)', r.subida === 'Upload preset not found');
  ok('las fotos siguen entrando al lienzo del flyer', r.lienzo);
  ok('caché nuevo shuk-v8 (el de la v4.97 se borra)', JSON.stringify(r.cache) === '["shuk-v8"]');
  ok('sin errores de JavaScript', errs.length === 0);
  await b.close(); srv.kill(); mock.kill();
  checks.forEach(c => console.log((c.ok ? '  ✓ ' : '  ✗ FALLÓ — ') + c.n));
  if (!checks.every(c => c.ok)) console.log('  subida contestó:', r.subida, '· caché:', r.cache);
  const malos = checks.filter(c => !c.ok).length;
  console.log(malos ? `❌ ${malos} de ${checks.length} fallaron` : `✅ ${checks.length}/${checks.length} subidas con el service worker OK`);
  process.exit(malos ? 1 : 0);
})().catch(e => { console.error('💥', e); process.exit(1); });
