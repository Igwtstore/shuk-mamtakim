// 🔔 v5.01 — TE TOCA en el panel, en un navegador de verdad y contra el servidor REAL del sitio (motor de mentira):
// la tarjeta de Clientes con quién tiene que volver a pedir, su ritmo y su pedido de siempre (solo lo que hay);
// "Mandarle lo de siempre" arma el link con esos productos y deja anotado que le escribiste; saludar, ocultar,
// volver a mostrar; los agrupados (se enfriaron, pronto, ya escritos, una sola vez); el aviso diario en Avisos.
// Uso: node tests/te_toca_ui.test.js
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const RAIZ = path.resolve(__dirname, '..');
const SITIO = 'http://127.0.0.1:3199';
const P = (id, nombre, stock, precio, extra = {}) => ({ id, nombre, descripcion: 'desc', precio_may: '5', precio_min: precio, stock, imagen: '', activo: true, categoria: 'Chocolate', visible_cat: 'Ambos', precio_oferta: 0, fecha_oferta: '', cant_pack: 0, precio_pack: 0, dueno: 'Jony', moneda: '$', ...extra });
const PRODS = [P(1, 'Barrita Pesek Zman grande', 17, 6499, { precio_may: '3.5', moneda: 'U$S' }), P(2, 'Klik cornflakes 65 g', 9, 7999), P(3, 'Pitzujim Maní grill', 48, 9999, { precio_may: '8300' }), P(4, 'Agotado de siempre', 0, 5000)];
const X = (o) => ({ avisado: '', diasAvisado: null, yaEscrito: false, enDias: 0, ticketUSD: 0, ...o });
const TT = { ok: true, ritmoGeneral: 10, ocultos: [{ nombre: 'Meir', clave: 'meir' }],
  cuantos: { leToca: 1, atrasados: 1, enfriados: 1, pronto: 1 },
  lista: [
    X({ nombre: 'Débora Levy', clave: 'debora levy', telefono: '1144556677', tipo: 'Minorista', pedidos: 3, ultima: '10/09/2026 20:00', dias: 12, ticketARS: 21667, ritmo: 11, ratio: 1.09, estado: 'le toca', habitual: [{ id: '1', q: 3, veces: 3 }, { id: '2', q: 1, veces: 2 }, { id: '4', q: 1, veces: 1 }] }),
    X({ nombre: 'Rafa K', clave: 'rafa k', telefono: '1155556666', tipo: 'Minorista', pedidos: 2, ultima: '17/09/2026 12:00', dias: 6, ticketARS: 8000, ritmo: 3, ratio: 2, estado: 'atrasado', habitual: [{ id: '4', q: 1, veces: 2 }] }),
    X({ nombre: 'Kiosco Tov', clave: 'kiosco tov', telefono: '', tipo: 'Mayorista', pedidos: 2, ultima: '15/05/2026 09:00', dias: 131, ticketARS: 0, ticketUSD: 175, ritmo: 14, ratio: 9.36, estado: 'se enfrió', habitual: [{ id: '1', q: 10, veces: 2 }, { id: '3', q: 2, veces: 1 }] }),
    X({ nombre: 'Sarah G', clave: 'sarah g', telefono: '1166667777', tipo: 'Minorista', pedidos: 3, ultima: '15/09/2026 10:00', dias: 8, ticketARS: 15000, ritmo: 10, ratio: 0.8, estado: 'pronto', enDias: 2, habitual: [{ id: '2', q: 1, veces: 3 }] }),
    X({ nombre: 'Ana Gómez', clave: 'ana gomez', telefono: '1122334455', tipo: 'Minorista', pedidos: 3, ultima: '03/09/2026 11:00', dias: 20, ticketARS: 30000, ritmo: 7, ratio: 2.86, estado: 'atrasado', yaEscrito: true, avisado: '22/09/2026 18:00', diasAvisado: 1, habitual: [{ id: '3', q: 2, veces: 3 }] }),
  ],
  unaVez: [{ nombre: 'Pedro P', clave: 'pedro p', telefono: '1133445566', tipo: 'Minorista', pedidos: 1, dias: 22, ticketARS: 40000, ticketUSD: 0 }],
};
const esperar = ms => new Promise(r => setTimeout(r, ms));
async function hasta(fn, ms = 6000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await esperar(150); } return false; }

(async () => {
  const mock = spawn('node', [path.join(__dirname, '_mock_motor_auth.mjs')], { stdio: 'ignore' });
  const srv = spawn('node', ['servidor.mjs'], { cwd: path.join(RAIZ, 'despliegue', 'sitio'), stdio: 'ignore', env: { ...process.env, MOTOR_URL: 'http://127.0.0.1:3998/motor', SUPABASE_URL: 'http://127.0.0.1:3998', PUERTO: '3199', RAIZ } });
  process.on('exit', () => { try { srv.kill(); mock.kill(); } catch { /**/ } });
  await esperar(1500);
  const b = await chromium.launch();
  const checks = [], errs = [], marcas = [], creados = [], dialogos = [];
  const ok = (n, c) => checks.push({ n, ok: !!c });
  const ctx = await b.newContext({ viewport: { width: 1100, height: 900 } });
  const pg = await ctx.newPage();
  await pg.clock.setFixedTime(new Date('2026-09-23T12:00:00-03:00'));
  await pg.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => false }); window.supabase = { createClient: () => ({ auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) } }) }; window.__abiertos = []; window.open = (u) => { window.__abiertos.push(String(u)); return null; }; });
  pg.on('pageerror', e => errs.push(e.message));
  pg.on('dialog', d => { dialogos.push(d.type() + ':' + d.message()); d.accept(); });
  await pg.route('**/*', route => {
    const u = route.request().url();
    if (u.includes('accion=teTocaMarcar')) { marcas.push(Object.fromEntries(new URL(u).searchParams.entries())); return route.fulfill({ contentType: 'application/json', body: '{"ok":true}' }); }
    if (u.includes('accion=teToca')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify(TT) });
    if (u.includes('accion=crearPedidoArmado')) { creados.push(Object.fromEntries(new URL(u).searchParams.entries())); return route.fulfill({ contentType: 'application/json', body: '{"ok":true,"token":"tt9tok"}' }); }
    if (u.includes('getEstadoTienda')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ estado: 'abierta' }) });
    if (/\/rest\/v1\/productos\?/.test(u)) return route.fulfill({ contentType: 'application/json', body: JSON.stringify(PRODS) });
    if (u.startsWith(SITIO)) return route.continue();
    if (u.includes('supabase') || u.includes('ipapi') || u.includes('qrserver') || u.includes('onesignal') || u.includes('bluelytics') || u.includes('cloudinary')) return route.fulfill({ contentType: 'application/json', body: '[]' });
    return route.continue();
  });
  await pg.goto(SITIO + '/tienda', { waitUntil: 'domcontentloaded' });
  await hasta(async () => pg.evaluate(() => typeof productos !== 'undefined' && productos.length > 3));
  await pg.evaluate(() => { adminAuth = true; socioActual = 'jony'; renderTeToca(); });
  const card = () => pg.evaluate(() => (document.getElementById('tetoca-card') || {}).innerText || '');
  ok('la tarjeta "🔔 Te toca" aparece en Clientes', await hasta(async () => (await card()).includes('Te toca — a quién le toca volver a pedir')));
  let t = await card();
  ok('explica de dónde sale el ritmo, con el general del negocio (~10 días)', t.includes('sacado de sus propias compras') && t.includes('cada ~10 días'));
  ok('"Para escribirles hoy (2)": a quien le toca y el atrasado — el ya escrito NO', t.includes('Para escribirles hoy (2)'));
  ok('Débora: le toca, compra cada ~11 días, la última hace 12, 3 compras, ticket $ 21.667', t.includes('Débora Levy') && t.includes('le toca') && t.includes('Compra cada ~11 días · la última hace 12 · 3 compras · ticket $ 21.667'));
  ok('su pedido de siempre, solo con lo que hay (y avisa lo que no)', t.includes('3× Barrita Pesek Zman grande · 1× Klik cornflakes 65 g') && t.includes('sin stock: Agotado de siempre'));
  ok('Rafa: "3 días atrasado" y como lo suyo no tiene stock, no ofrece mandarlo', t.includes('3 días atrasado') && t.includes('lo de siempre está sin stock'));
  ok('agrupa los que se enfriaron, los que les toca pronto y los ya escritos', t.includes('Se enfriaron — hace mucho que no vuelven (1)') && t.includes('Les toca en los próximos días (1)') && t.includes('Ya les escribiste (1)'));
  ok('los que compraron una sola vez, aparte', t.includes('Compraron una sola vez (1)'));
  ok('y los ocultos, para poder volver a mostrarlos', t.includes('Ocultos (1)'));
  ok('Kiosco Tov: mayorista, con el ticket en dólares', t.includes('Kiosco Tov') && t.includes('📦 mayorista') && t.includes('U$S 175.00'));
  ok('Ana: dice que ya le escribiste (hace 1 día)', t.includes('Le escribiste hace 1 día'));
  const botonesRafa = await pg.evaluate(() => [...document.querySelectorAll('#tetoca-card button')].filter(b => b.getAttribute('onclick') === 'teTocaMandar(1)').length);
  ok('(el botón de mandar de Rafa no existe)', botonesRafa === 0);

  // Mandarle lo de siempre a Débora
  await pg.evaluate(() => teTocaMandar(0));
  ok('"Mandarle lo de siempre" arma el link con lo que hay (sin lo agotado)', await hasta(async () => creados.length === 1));
  const c1 = creados[0] || {};
  ok('con sus cantidades de siempre, el canal y el origen "Te toca"', c1.items === '1:3,2:1' && c1.canal === 'minorista' && c1.origen === 'tetoca' && c1.nombre === 'Débora Levy');
  const ov = await pg.evaluate(() => ({ t: (document.getElementById('armado-overlay') || {}).innerText || '', h: (document.getElementById('armado-overlay') || {}).innerHTML || '' }));
  ok('el mensaje: "¿Te armo lo de siempre?", la lista y el total de hoy (3×6.499 + 7.999 = $ 27.496)', ov.t.includes('¿Te armo lo de siempre?') && ov.t.includes('3× Barrita Pesek Zman grande') && ov.t.includes('$ 27.496'));
  ok('y va directo a su WhatsApp', ov.h.includes('wa.me/5491144556677'));
  ok('todavía NO se anota que le escribiste (recién al mandarlo)', marcas.length === 0);
  await pg.evaluate(() => { [...document.querySelectorAll('#armado-overlay button')].find(b => b.textContent.includes('Mandar por WhatsApp')).click(); });
  ok('al tocar "Mandar por WhatsApp" se abre su chat', await hasta(async () => (await pg.evaluate(() => window.__abiertos)).some(u => u.includes('wa.me/5491144556677'))));
  ok('y queda anotado que le escribiste (para no insistir mañana)', await hasta(async () => marcas.some(m => m.clave === 'debora levy' && m.avisado === '1')));
  await pg.evaluate(() => { const o = document.getElementById('armado-overlay'); if (o) o.remove(); });

  // Mayorista, sin teléfono
  creados.length = 0;
  await pg.evaluate(() => teTocaMandar(2));
  ok('al mayorista le arma el link mayorista', await hasta(async () => creados.length === 1 && creados[0].canal === 'mayorista' && creados[0].items === '1:10,3:2'));
  const ov2 = await pg.evaluate(() => (document.getElementById('armado-overlay') || {}).innerText || '');
  ok('con el total en las dos monedas: $ 16.600 + U$S 35.00', ov2.includes('$ 16.600 + U$S 35.00'));
  ok('y avisa que no tiene su teléfono', ov2.includes('No tengo su teléfono'));
  await pg.evaluate(() => { const o = document.getElementById('armado-overlay'); if (o) o.remove(); });

  // Solo saludar
  marcas.length = 0;
  await pg.evaluate(() => { window.__abiertos = []; teTocaSaludar(3); });
  const saludo = await pg.evaluate(() => window.__abiertos[0] || '');
  ok('"Solo saludar" abre su WhatsApp con un saludo, sin presionar', saludo.includes('wa.me/5491166667777') && decodeURIComponent(saludo).includes('¿Te preparo algo esta semana?'));
  ok('y también anota que le escribiste', await hasta(async () => marcas.some(m => m.clave === 'sarah g' && m.avisado === '1')));
  await pg.evaluate(() => { window.__abiertos = []; teTocaSaludar(0, true); });
  ok('al que compró una sola vez también se lo puede saludar', (await pg.evaluate(() => window.__abiertos[0] || '')).includes('wa.me/5491133445566'));

  // Ocultar y volver a mostrar
  marcas.length = 0;
  await pg.evaluate(() => teTocaOcultar(1));
  ok('ocultar pregunta antes y avisa que queda en "Ocultos"', dialogos.some(d => d.startsWith('confirm:') && d.includes('Rafa K') && d.includes('Ocultos')));
  ok('y lo anota', await hasta(async () => marcas.some(m => m.clave === 'rafa k' && m.oculto === '1')));
  await pg.evaluate(() => teTocaMostrar('meir'));
  ok('volver a mostrar a un oculto', await hasta(async () => marcas.some(m => m.clave === 'meir' && m.oculto === '0')));

  // El aviso diario, en la tarjeta de avisos
  const al = await pg.evaluate(() => { _alertasCfg = { checkout: 1, conocido: 1, busqueda: 1, pico: 1, carrito: 1, carritoMin: 20000, picoMin: 15, informe: 1, rareza: 1, avisame: 1, tetoca: 1 }; return _anaCardAlertas(); });
  ok('en Avisos al celular aparece "🔔 Te toca" (cada mañana a las 11, menos los sábados)', al.includes('Te toca: a quién le toca volver a pedir') && al.includes('a las 11'));

  // En la sesión de Miri no se dibuja
  await pg.evaluate(() => { socioActual = 'miri'; vistaSocio = 'miri'; renderTeToca(); });
  ok('en la sesión de Miri la tarjeta no se dibuja', await pg.evaluate(() => document.getElementById('tetoca-card').innerHTML === ''));

  ok('sin errores de JavaScript', errs.length === 0);
  await b.close(); srv.kill(); mock.kill();
  let fail = 0;
  console.log('\n── te toca (panel) ─────────────');
  checks.forEach(c => { if (!c.ok) fail++; console.log('  ' + (c.ok ? '✓' : '✗ FALLÓ —') + ' ' + c.n); });
  if (errs.length) console.log('  errores:', errs.slice(0, 4));
  console.log(fail === 0 ? `\n✅ TODO VERDE — ${checks.length} controles` : `\n❌ ${fail} de ${checks.length} FALLARON`);
  process.exit(fail ? 1 : 0);
})();
