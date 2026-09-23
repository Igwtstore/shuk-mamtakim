// 🖼️ v4.99 — Subidas a Cloudinary FIRMADAS, en un navegador de verdad y contra el servidor REAL del sitio.
// Las funciones de subida de siempre (copiar la foto de otro producto en el panel; «subir foto» en el de los chicos):
// con clave cargada la subida lleva api_key + timestamp + signature que da el motor; sin clave, o con el motor caído,
// sale como siempre (sin firma) y la foto se sube igual. Y la tarjeta 🔑: la clave de Cloudinary viaja en el CUERPO.
// Uso: node tests/cloudinary_firma_ui.test.js
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const RAIZ = path.resolve(__dirname, '..');
const SITIO = 'http://127.0.0.1:3199';
const PNG = fs.readFileSync(path.join(RAIZ, 'icon-192.png'));
const esperar = ms => new Promise(r => setTimeout(r, ms));
async function hasta(fn, ms = 6000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await esperar(150); } return false; }
// Los campos de un cuerpo multipart (sin el archivo).
const campos = (buf) => { const o = {}; const txt = buf ? buf.toString('latin1') : ''; for (const m of txt.matchAll(/name="([^"]+)"\r\n\r\n([^\r]*)\r\n/g)) o[m[1]] = m[2]; return o; };

(async () => {
  const mock = spawn('node', [path.join(__dirname, '_mock_motor_auth.mjs')], { stdio: 'ignore' });
  const srv = spawn('node', ['servidor.mjs'], { cwd: path.join(RAIZ, 'despliegue', 'sitio'), stdio: 'ignore', env: { ...process.env, MOTOR_URL: 'http://127.0.0.1:3998/motor', SUPABASE_URL: 'http://127.0.0.1:3998', PUERTO: '3199', RAIZ } });
  process.on('exit', () => { try { srv.kill(); mock.kill(); } catch { /**/ } });
  await esperar(1500);
  const b = await chromium.launch();
  const checks = [], errs = [];
  const ok = (n, c) => checks.push({ n, ok: !!c });
  let modo = 'firma';               // 'firma' | 'sinClave' | 'caido'
  let pedidosFirma = [], subidas = [], posts = [], urls = [];
  let estado = { anthropic: { cargada: true, origen: 'panel', fecha: '02/07/2026' }, gemini: { cargada: true, origen: 'panel', fecha: '02/07/2026' }, cloudinary: { cargada: false, origen: 'ninguna', fecha: '' } };
  const rutear = async (route) => {
    const req = route.request(), u = req.url();
    urls.push(u);
    if (u.includes('accion=firmarSubida')) {
      const q = new URL(u).searchParams; pedidosFirma.push({ params: q.get('params'), token: q.get('token') });
      if (modo === 'caido') return route.abort();
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(modo === 'firma' ? { api_key: '123456789012345', timestamp: '1758667200', signature: 'firma0de0prueba0' } : { sinClave: true }) });
    }
    if (u.startsWith('https://api.cloudinary.com/') && req.method() === 'POST') {
      subidas.push(campos(req.postDataBuffer()));
      return route.fulfill({ contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ public_id: 'shuk-mamtakim/nueva' + subidas.length, secure_url: 'https://res.cloudinary.com/dq2boloyp/image/upload/v1/shuk-mamtakim/nueva' + subidas.length + '.png' }) });
    }
    if (u.includes('res.cloudinary.com')) return route.fulfill({ status: 200, contentType: 'image/png', headers: { 'Access-Control-Allow-Origin': '*' }, body: PNG });
    if (u.includes('accion=estadoClavesIA')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify(estado) });
    if (req.method() === 'POST' && u.includes('/functions/v1/api')) {
      let body = {}; try { body = JSON.parse(req.postData() || '{}'); } catch { /**/ }
      posts.push({ body, url: u });
      if (body.accion === 'guardarClaveCloudinary') { estado = { ...estado, cloudinary: { cargada: true, origen: 'panel', fecha: '23/09/2026 19:10' } }; return route.fulfill({ contentType: 'application/json', body: '{"ok":true}' }); }
    }
    if (u.includes('getEstadoTienda')) return route.fulfill({ contentType: 'application/json', body: '{"estado":"abierta"}' });
    if (u.includes('miHabitual')) return route.fulfill({ contentType: 'application/json', body: '{"items":[],"pedidos":0}' });
    if (/\/rest\/v1\/productos\?/.test(u)) return route.fulfill({ contentType: 'application/json', body: '[]' });
    if (u.startsWith(SITIO)) return route.continue();
    return route.fulfill({ contentType: 'application/json', body: '{}' });
  };
  const sinSupabase = () => { window.supabase = { createClient: () => ({ auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }), signInWithPassword: async () => ({ data: {}, error: { message: 'x' } }) } }) }; };

  // ── 1) Panel del Shuk: «copiar la foto de otro producto» (descarga + subida).
  const ctx = await b.newContext({ viewport: { width: 420, height: 900 }, serviceWorkers: 'block' });
  const pg = await ctx.newPage();
  pg.on('pageerror', e => errs.push('shuk: ' + e.message));
  await pg.addInitScript(sinSupabase);
  await pg.route('**/*', rutear);
  await pg.goto(SITIO + '/tienda', { waitUntil: 'domcontentloaded' });
  await esperar(800);
  await pg.evaluate(() => { adminAuth = true; socioActual = 'jony'; _authToken = 'tok-jony'; });
  const copiar = () => pg.evaluate(() => copiarFotoCloudinary('shuk-mamtakim/f5jvgkrk9rtofqcfhlxs'));
  let r = await copiar();
  let s = subidas[subidas.length - 1] || {};
  ok('con clave: la foto se copia y la subida va FIRMADA (api_key + timestamp + signature del motor)', r === 'shuk-mamtakim/nueva1' && s.api_key === '123456789012345' && s.timestamp === '1758667200' && s.signature === 'firma0de0prueba0');
  ok('…con el preset y la carpeta de siempre', s.upload_preset === 'shuk_upload' && s.folder === 'shuk-mamtakim');
  ok('…y el motor firmó exactamente eso, con la sesión de Jony', pedidosFirma[0] && pedidosFirma[0].params === '{"upload_preset":"shuk_upload","folder":"shuk-mamtakim"}' && pedidosFirma[0].token === 'tok-jony');
  modo = 'sinClave'; r = await copiar(); s = subidas[subidas.length - 1] || {};
  ok('sin clave cargada: se sube igual, como siempre (sin firma)', r === 'shuk-mamtakim/nueva2' && !('signature' in s) && !('api_key' in s) && s.upload_preset === 'shuk_upload');
  modo = 'caido'; r = await copiar(); s = subidas[subidas.length - 1] || {};
  ok('con el motor caído: la foto se sube igual (nunca se traba una subida por la firma)', r === 'shuk-mamtakim/nueva3' && !('signature' in s));
  modo = 'firma';
  const publico = await pg.evaluate(async () => { const t = _authToken; _authToken = ''; const fd = new FormData(); fd.append('file', new Blob(['x']), 'x.png'); fd.append('upload_preset', 'shuk_upload'); await fetch('https://api.cloudinary.com/v1_1/dq2boloyp/image/upload', { method: 'POST', body: fd }); _authToken = t; return true; });
  ok('sin sesión (la tienda pública) no se pide ninguna firma', publico && pedidosFirma.length === 3 && !('signature' in (subidas[subidas.length - 1] || {})));

  // ── 2) La tarjeta 🔑: la clave de Cloudinary.
  await pg.evaluate(() => cargarClavesIA());
  const txt = () => pg.evaluate(() => document.getElementById('ia-claves').innerText);
  ok('la tarjeta muestra «Cloudinary (subir fotos): ❌ falta»', (await txt()).includes('Cloudinary (subir fotos): ❌ falta'));
  await pg.evaluate(() => [...document.querySelectorAll('#ia-claves button')].find(x => x.textContent === 'Cambiar').click());
  ok('al abrirla: los dos campos (el secreto, oculto) y dónde se ve en Cloudinary', await pg.evaluate(() => { const k = document.getElementById('ia-clave-cld-key'), s = document.getElementById('ia-clave-cld-secret'); return k && s && s.type === 'password' && document.getElementById('ia-claves').innerText.includes('Settings → API Keys'); }));
  await pg.evaluate(() => { document.getElementById('ia-clave-cld-key').value = '123456789012345'; document.getElementById('ia-clave-cld-secret').value = 'SecretoDePrueba'; });
  await pg.evaluate(() => document.getElementById('ia-clave-btn-cloudinary').click());
  ok('guardar: la clave viaja en el CUERPO del pedido y en ninguna dirección', await hasta(() => posts.some(p => p.body.accion === 'guardarClaveCloudinary' && p.body.apiKey === '123456789012345' && p.body.apiSecret === 'SecretoDePrueba')) && !urls.some(u => u.includes('SecretoDePrueba')));
  ok('…y la tarjeta queda «✅ (cargada el 23/09/2026)», con los campos vacíos', await hasta(async () => (await txt()).includes('Cloudinary (subir fotos): ✅ (cargada el 23/09/2026)')) && await pg.evaluate(() => !document.getElementById('ia-clave-cld-secret')));
  await ctx.close();

  // ── 3) Panel de los chicos: «subir foto» de un producto.
  const ctx2 = await b.newContext({ viewport: { width: 420, height: 900 }, serviceWorkers: 'block' });
  const pg2 = await ctx2.newPage();
  pg2.on('pageerror', e => errs.push('candy: ' + e.message));
  await pg2.addInitScript(sinSupabase);
  await pg2.route('**/*', rutear);
  await pg2.goto(SITIO + '/candyshop.html', { waitUntil: 'domcontentloaded' });
  await esperar(800);
  const subirKids = () => pg2.evaluate(async (png) => {
    _kidsToken = 'tok-kids';
    const bin = Uint8Array.from(atob(png), c => c.charCodeAt(0));
    await subirFoto({ files: [new File([bin], 'foto.png', { type: 'image/png' })] });
    return document.getElementById('foto-status').textContent;
  }, PNG.toString('base64'));
  pedidosFirma = []; modo = 'firma';
  let st = await subirKids(); s = subidas[subidas.length - 1] || {};
  ok('chicos, con clave: «✅ Foto subida» y la subida va firmada con el preset del Candy', st.includes('Foto subida') && s.signature === 'firma0de0prueba0' && s.upload_preset === 'candyshop' && s.api_key === '123456789012345');
  ok('…y la firma la pidió su panel con SU sesión', pedidosFirma[0] && pedidosFirma[0].params === '{"upload_preset":"candyshop"}' && pedidosFirma[0].token === 'tok-kids');
  modo = 'sinClave'; st = await subirKids(); s = subidas[subidas.length - 1] || {};
  ok('chicos, sin clave: se sube igual, como siempre', st.includes('Foto subida') && !('signature' in s));

  ok('sin errores de JavaScript', errs.length === 0);
  await b.close(); srv.kill(); mock.kill();
  checks.forEach(c => console.log((c.ok ? '  ✓ ' : '  ✗ FALLÓ — ') + c.n));
  if (errs.length) console.log('  errores JS:', errs.slice(0, 3));
  const malos = checks.filter(c => !c.ok).length;
  console.log(malos ? `❌ ${malos} de ${checks.length} fallaron` : `✅ ${checks.length}/${checks.length} subidas firmadas OK`);
  process.exit(malos ? 1 : 0);
})().catch(e => { console.error('💥', e); process.exit(1); });
