// 🔴 EN VIVO, probado de punta a punta en un navegador de verdad y contra el servidor REAL del
// sitio (despliegue/sitio/servidor.mjs) corriendo en local con un motor y un Auth de mentira:
// la tienda manda su visita por /api/track → el servidor la reenvía al motor y la empuja al
// panel por SSE → la pestaña 🔴 En vivo la dibuja. También: quién es quién, el checkout, la
// foto de respaldo, el 401 de Miri y que en vista Miri la pestaña no existe.
// Uso: node tests/en_vivo_ui.test.js   (levanta solo el servidor y el mock; puerto 3199/3998)
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const RAIZ = path.resolve(__dirname, '..');
const SITIO = 'http://127.0.0.1:3199';

const DATA = {
  resumen: { visitas: 55, unicos: 32, nuevos: 31, recurrentes: 1, tienda: 42, mayorista: 13 },
  embudo: { visita: 30, carrito: 2, checkout: 1, pedido: 1 }, porOrigen: { directo: 55 }, porDispositivo: { celular: 43, compu: 12 },
  topCiudades: [], topPaises: [], porHora: new Array(24).fill(1), porDiaSemana: [1, 1, 1, 1, 1, 1, 1], dias30: [], topProductos: [], conversionPorOrigen: [], leads: [],
  abandonados: [], acciones: [], accionable: { identificados: 1, conTelefono: 1, anonimos: 30, oportunidadARS: 0, oportunidadUSD: 0, carritosContactables: 0 },
  visitantes: [{ vid: 'v_abc', nombre: 'Débora Levy', telefono: '1144556677', esCliente: true, compras: 3, gastadoARS: 145000, apodo: '#VABC', leDijiste: false, etiqueta: 'compró', visitas: 3, dias: 2, productos: [], perfil: {} }],
  visitantesTotal: 1, diasDetalle: [], deseoVsVenta: [], busquedas: [], candado: null, comparativo: null, mironesTop: [], rescate: null, radiografia: null,
  verMas: { eventos: 3, vistosSinCarrito: [{ nombre: 'Bamba', vistos: 4, personas: 3, stock: 5, dueno: 'Jony' }], nuncaVistos: [{ nombre: 'Escondido', stock: 7, dueno: 'Jony' }], quitados: [{ nombre: 'Klik', veces: 2 }], promos: { oferta: { veces: 1, top: [{ nombre: 'Klik', n: 1 }] }, pack: { veces: 0, top: [] } }, compartidos: [], avisoClics: { veces: 2, personas: 1 }, scroll: { n: 5, promedio: 62, alFinal: 2, pctAlFinal: 40 } },
  vipAbiertos: [{ token: 'tok1', cliente: 'Sarah G', canal: 'minorista', creado: '19/09/2026 09:00', aperturas: 0, personas: 0, ultima: '' }],
  hoyVsSemana: { hoy: [0, 0, 0, 0, 0, 0, 0, 0, 2, 5, 7, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], hace7: [0, 0, 0, 0, 0, 0, 0, 1, 3, 4, 2, 6, 5, 3, 2, 1, 0, 0, 2, 3, 4, 2, 1, 0], horaActual: 11, diaNombre: 'martes', fechaHoy: '2026-09-22', fechaHace7: '2026-09-15', hace7Disponible: true },
};

const PRODS_SB = [1, 2, 3, 4].map(i => ({ id: i, nombre: 'Producto de prueba ' + i, descripcion: 'desc', precio_may: '2000', precio_min: 3000, stock: 5, imagen: '', activo: true, categoria: 'Chocolate', visible_cat: 'Ambos', precio_oferta: 0, fecha_oferta: '', cant_pack: 0, precio_pack: 0, dueno: 'Jony', moneda: '$' }));
const esperar = ms => new Promise(r => setTimeout(r, ms));
async function hasta(fn, ms = 6000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await esperar(150); } return false; }

(async () => {
  const mock = spawn('node', [path.join(__dirname, '_mock_motor_auth.mjs')], { stdio: 'ignore' });
  const srv = spawn('node', ['servidor.mjs'], { cwd: path.join(RAIZ, 'despliegue', 'sitio'), stdio: 'ignore', env: { ...process.env, MOTOR_URL: 'http://127.0.0.1:3998/motor', SUPABASE_URL: 'http://127.0.0.1:3998', PUERTO: '3199', RAIZ } });
  await esperar(1500);
  const b = await chromium.launch();
  const pg = await b.newPage();
  // El cliente de Supabase no carga desde el CDN en la prueba: se stubea (igual que en ana_vuelta_rosca).
  await pg.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });   // v4.80: los automatizados no cuentan; acá queremos contar
    window.supabase = { createClient: () => ({ auth: {
      getSession: async () => ({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } })
    } }) };
  });
  const errs = [];
  pg.on('pageerror', e => errs.push(e.message));
  await pg.route('**/*', route => {
    const u = route.request().url();
    if (u.includes('getAnalitica')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify(DATA) });
    // El catálogo (Supabase REST) con productos de mentira: sin tarjetas no hay vistas que medir.
    if (/\/rest\/v1\/productos\?/.test(u)) return route.fulfill({ contentType: 'application/json', body: JSON.stringify(PRODS_SB) });
    if (u.startsWith(SITIO)) return route.continue();
    if (u.includes('supabase') || u.includes('ipapi') || u.includes('qrserver') || u.includes('onesignal')) return route.fulfill({ contentType: 'application/json', body: '[]' });
    return route.continue();
  });
  const checks = [];
  const ok = (n, c) => checks.push({ n, ok: !!c });
  const txt = () => pg.evaluate(() => (document.getElementById('analitica-contenido') || {}).innerText || '');
  const track = (q) => fetch(SITIO + '/api/track?' + new URLSearchParams(q).toString()).then(r => r.status);
  const recibidos = () => fetch('http://127.0.0.1:3998/_recibidos').then(r => r.json());

  // ── 1) La TIENDA, como un cliente: la visita tiene que llegar al motor pasando por el servidor ──
  await pg.goto(SITIO + '/tienda', { waitUntil: 'domcontentloaded' });
  ok('la tienda mandó su visita por /api/track y el servidor la reenvió al motor', await hasta(async () => (await recibidos()).some(r => r.evento === 'visita' && r.pagina === 'tienda' && /^v_/.test(r.vid))));
  const vidTienda = (await recibidos()).find(r => r.evento === 'visita').vid;
  // v4.81: las tarjetas a la vista se anotan (1 s a media altura) y viajan en lote como 'vistas'.
  // Como una persona: baja un poco para que las tarjetas queden a la vista (la mitad, un segundo).
  await pg.evaluate(() => window.scrollTo(0, 600));
  await pg.waitForTimeout(1600);
  await pg.evaluate(() => _vistasEnviar(false));
  ok('v4.81: la tienda mandó un lote de VISTAS con las tarjetas que estuvieron a la vista', await hasta(async () => (await recibidos()).some(r => r.evento === 'vistas' && (() => { try { return JSON.parse(r.producto).v.length > 0; } catch { return false; } })())));
  // v4.81: sacar del carrito se registra como 'quitar'
  // (en la prueba el catálogo no carga desde Supabase: se inventa un producto)
  await pg.evaluate(() => { const p = { id: 999001, nombre: 'Klik de prueba', stock: 5, precioMin: 1000, precioMay: 900, desc: '' }; productos.push(p); carrito[p.id] = { ...p, qty: 1 }; eliminarDelCarrito(p.id); });
  ok('v4.81: sacar algo del carrito manda "quitar"', await hasta(async () => (await recibidos()).some(r => r.evento === 'quitar' && r.total === '0' && r.producto === 'Klik de prueba')));

  // ── 2) El PANEL de Jony ──
  await pg.evaluate(() => { adminAuth = true; socioActual = 'jony'; _authToken = 'jony'; localStorage.setItem('shuk_no_track', '1'); });
  await pg.evaluate(() => setAdminTab('analitica'));
  await pg.waitForTimeout(600);
  ok('la pestaña 🔴 En vivo existe y va primera', (await txt()).trim().startsWith('🔴 En vivo'));
  ok('v4.80: hay botón "Hoy" en el período', await pg.evaluate(() => !!document.getElementById('ana-p-hoy')));
  await pg.evaluate(() => setAnaTab('productos'));
  await pg.waitForTimeout(200);
  { const c = await txt();
    ok('v4.81: Productos muestra "los ven y no los agarran" y "nadie llega a verlos"', c.includes('Los ven y no los agarran') && c.includes('Nadie llega a verlos') && c.includes('Escondido')); }
  await pg.evaluate(() => setAnaTab('gente'));
  await pg.waitForTimeout(200);
  ok('v4.81: Gente muestra los catálogos VIP con "nunca lo abrió"', (await txt()).includes('Catálogos VIP') && (await txt()).includes('nunca lo abrió'));
  await pg.evaluate(() => setAnaTab('canales'));
  await pg.waitForTimeout(200);
  { const c = await txt(); const h = await pg.content();
    ok('v4.80: Canales arranca con el generador de links etiquetados (copiar minorista/mayorista)', c.includes('Links por canal') && h.includes('/tienda?c=wa') && h.includes('/mayorista?c=estado'));
    ok('v4.80: "directo" se explica como "sin etiqueta"', c.includes('Directo (sin etiqueta)')); }
  await pg.evaluate(() => setAnaTab('vivo'));
  ok('se conecta por SSE (punto verde "En vivo")', await hasta(async () => (await txt()).includes('En vivo ·') && (await pg.evaluate(() => _vivo.fuente)) === 'sse'));
  let t = await txt();
  ok('la visita de la tienda de recién ya figura como persona en la tienda ahora', t.includes('1 persona en la tienda ahora') && t.includes('entró a la tienda'));
  ok('el gráfico hoy vs semana pasada se dibuja con sus totales', t.includes('Hoy: 18 visitas') && t.includes('martes pasado') && t.includes('16 a esta hora'));

  // ── 3) Llegan eventos en vivo ──
  await track({ vid: 'v_abc', evento: 'carrito', producto: 'Klik', carrito: '[{"n":"Klik","q":2,"p":1000}]', total: '2000', ciudad: 'Castelar', dispositivo: 'celular' });
  ok('el carrito de Débora aparece al instante, CON NOMBRE (cruce con la Analítica) y sus compras', await hasta(async () => { const x = await txt(); return x.includes('Débora Levy') && x.includes('3 compras') && x.includes('2× Klik') && x.includes('$ 2.000'); }));
  await track({ vid: 'v_abc', evento: 'checkout', carrito: '[{"n":"Klik","q":2,"p":1000}]', total: '2000', nombre: 'Débora Levy', telefono: '1144556677' });
  ok('al llegar al checkout cambia el chip y hay botón para escribirle ahora', await hasta(async () => { const x = await txt(); return x.includes('en el checkout') && x.includes('Escribirle ahora'); }));
  ok('el ticker cuenta la historia con hora', await hasta(async () => /\d\d:\d\d:\d\d/.test(await txt()) && (await txt()).includes('llegó al checkout')));
  ok('personas ahora = 2 (la de la tienda + Débora)', (await txt()).includes('2 personas en la tienda ahora'));
  await track({ vid: 'v_abc', evento: 'busqueda', producto: 'Gum', total: '0' });
  ok('una búsqueda sin resultados se marca en rojo en el ticker', await hasta(async () => (await txt()).includes('sin resultados')));
  await track({ vid: vidTienda, evento: 'salida', producto: '{"seg":42,"int":1,"prod":2}' });
  ok('el que se fue deja de contar como "ahora" pero queda en el ticker', await hasta(async () => { const x = await txt(); return x.includes('1 persona en la tienda ahora') && x.includes('se fue después de 42 s'); }));
  if (process.env.CAPTURA) {
    // Para la foto: hacer visible el panel (en la prueba no se entra al panel de verdad) y capturar solo la pestaña.
    await pg.setViewportSize({ width: 420, height: 1600 });
    await pg.evaluate(() => { let el = document.getElementById('analitica-contenido'); while (el) { if (getComputedStyle(el).display === 'none') el.style.display = 'block'; el = el.parentElement; } });
    await pg.locator('#analitica-contenido').screenshot({ path: process.env.CAPTURA });
  }
  const html = await pg.content();
  ok('el botón de WhatsApp lleva el teléfono de Débora', html.includes('wa.me/5491144556677'));

  // ── 4) La foto de respaldo (sin SSE) ──
  await pg.evaluate(() => { _vivoDesconectar(false); _vivo.fuente = 'poll'; });
  await track({ vid: 'v_nuevo', evento: 'visita', pagina: 'mayorista' });
  await pg.evaluate(() => _vivoFoto());
  ok('sin SSE, la foto trae al nuevo (y dice que actualiza cada 15 s)', await hasta(async () => { const x = await txt(); return x.includes('Actualizando cada 15 s') && x.includes('mayorista'); }));

  // ── 5) Miri: el servidor le cierra la puerta, y en su vista la pestaña no existe ──
  await pg.evaluate(() => { _authToken = 'miri'; _vivoConectar(); });
  ok('con la sesión de Miri el servidor contesta 401 y la pantalla lo dice', await hasta(async () => (await txt()).includes('no disponible para esta cuenta'), 8000));
  await pg.evaluate(() => { _authToken = 'jony'; vistaSocio = 'miri'; setAnaTab('vivo'); });
  await pg.waitForTimeout(300);
  t = await txt();
  ok('en vista Miri no hay pestaña En vivo y cae en "Qué hacer"', !t.includes('🔴 En vivo') && t.includes('Resumen del período'));
  ok('al salir de la pestaña se corta la conexión', (await pg.evaluate(() => !_vivo.es && !_vivo.timer)));
  ok('sin errores de JavaScript en toda la recorrida', errs.length === 0);

  await b.close(); srv.kill(); mock.kill();
  checks.forEach(c => console.log((c.ok ? '  ✓ ' : '  ✗ FALLÓ — ') + c.n));
  const malos = checks.filter(c => !c.ok).length;
  if (errs.length) console.log('  errores JS:', errs.slice(0, 3));
  console.log(malos ? `❌ ${malos} de ${checks.length} fallaron` : `✅ ${checks.length}/${checks.length} en vivo OK`);
  process.exit(malos ? 1 : 0);
})().catch(e => { console.error('💥', e); process.exit(1); });
process.on('exit', () => { try { require('child_process').execSync('pkill -f _mock_motor_auth.mjs; pkill -f "PUERTO=3199" ', { stdio: 'ignore' }); } catch { /**/ } });
