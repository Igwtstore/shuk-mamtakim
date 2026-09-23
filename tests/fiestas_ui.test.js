// 🗓️ v4.88 — Tanda 3, en un navegador de verdad y contra el servidor REAL del sitio: el cartel de la
// fiesta con su cuenta regresiva y sus productos, la franja de Shabat (con el reloj fijado en días
// distintos), la tarjeta del panel para configurarlo todo y las fiestas anotadas en Día a día.
// Uso: node tests/fiestas_ui.test.js
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const { _motor } = require('./unit/vidriera.js');
const RAIZ = path.resolve(__dirname, '..');
const SITIO = 'http://127.0.0.1:3199';
const P = (id, nombre, stock, precio, extra = {}) => ({ id, nombre, descripcion: 'desc', precio_may: '5', precio_min: precio, stock, imagen: '', activo: true, categoria: 'Chocolate', visible_cat: 'Ambos', precio_oferta: 0, fecha_oferta: '', cant_pack: 0, precio_pack: 0, dueno: 'Jony', moneda: '$', ...extra });
const PRODS = [
  P(1, 'Pitzujim-Mani Sabor Grill', 48, 9999, { categoria: 'Pitzujim' }), P(2, 'Pitzujim-Cajú Caramelizado', 22, 12000, { categoria: 'Pitzujim' }),
  P(3, 'Chocolate Elite Crunch', 16, 8999, { kosher_tipo: 'Lácteo' }), P(4, 'Klik almohaditas 65g (azul)', 16, 7999, { kosher_tipo: 'Lácteo' }),
  P(5, 'Bamba Osem', 11, 3500, { categoria: 'Snacks' }), P(6, 'Caramelos Mentos', 5, 3000, { categoria: 'Caramelo' }),
  P(7, 'Sopa de sobre', 9, 2000, { categoria: 'Sopa' }),
];
const VIDRIERA = { t: Date.now(), dias: 7, top: [1, 3, 5], orden: [1, 3, 5, 2, 4, 6], agota: {} };
const esperar = ms => new Promise(r => setTimeout(r, ms));
async function hasta(fn, ms = 6000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await esperar(150); } return false; }
const MIE = '2026-09-23T15:00:00-03:00', VIE = '2026-09-25T15:00:00-03:00';

(async () => {
  const mock = spawn('node', [path.join(__dirname, '_mock_motor_auth.mjs')], { stdio: 'ignore' });
  const srv = spawn('node', ['servidor.mjs'], { cwd: path.join(RAIZ, 'despliegue', 'sitio'), stdio: 'ignore', env: { ...process.env, MOTOR_URL: 'http://127.0.0.1:3998/motor', SUPABASE_URL: 'http://127.0.0.1:3998', PUERTO: '3199', RAIZ } });
  await esperar(1500);
  const b = await chromium.launch();
  const checks = [], errs = [], guardados = [];
  const ok = (n, c) => checks.push({ n, ok: !!c });
  const recibidos = () => fetch('http://127.0.0.1:3998/_recibidos').then(r => r.json());
  const nueva = async (ruta, { reloj = MIE, fiestas = null, analitica = null, antes } = {}) => {
    const ctx = await b.newContext({ viewport: { width: 420, height: 900 } });
    const pg = await ctx.newPage();
    await pg.clock.setFixedTime(new Date(reloj));
    await pg.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => false }); window.supabase = { createClient: () => ({ auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) } }) }; });
    if (antes) await pg.addInitScript(antes);
    pg.on('pageerror', e => errs.push(e.message));
    await pg.route('**/*', async route => {
      const req = route.request(), u = req.url();
      if (u.includes('getEstadoTienda')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ estado: 'abierta', vidriera: VIDRIERA, fiestas: fiestas || _motor_norm(null) }) });
      if (u.includes('miHabitual')) return route.fulfill({ contentType: 'application/json', body: '{"items":[],"pedidos":0}' });
      if (u.includes('getAnalitica') && analitica) return route.fulfill({ contentType: 'application/json', body: JSON.stringify(analitica) });
      if (req.method() === 'POST' && u.includes('/functions/v1/api')) {
        let body = {}; try { body = JSON.parse(req.postData() || '{}'); } catch { /**/ }
        if (body.accion === 'setFiestasTienda') { guardados.push(body.cfg); return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, fiestas: _motor_norm(body.cfg) }) }); }
      }
      if (/\/rest\/v1\/productos\?/.test(u)) return route.fulfill({ contentType: 'application/json', body: JSON.stringify(PRODS) });
      if (u.startsWith(SITIO)) return route.continue();
      if (u.includes('supabase') || u.includes('ipapi') || u.includes('qrserver') || u.includes('onesignal') || u.includes('bluelytics') || u.includes('cloudinary')) return route.fulfill({ contentType: 'application/json', body: '[]' });
      return route.continue();
    });
    await pg.goto(SITIO + ruta, { waitUntil: 'domcontentloaded' });
    return { pg, ctx };
  };

  // 1) Miércoles 23/09/2026: Sucot en dos días y la franja de Shabat
  const { pg, ctx } = await nueva('/tienda');
  ok('arriba del catálogo: "🌿 Faltan 2 días para Sucot" con su cuenta regresiva', await hasta(async () => (await pg.evaluate(() => (document.querySelector('#catalogo .fiesta') || {}).innerText || '')).includes('Faltan 2 días para Sucot')));
  const fiesta = await pg.evaluate(() => ({ txt: document.querySelector('#catalogo .fiesta').innerText, primero: document.getElementById('catalogo').firstElementChild.classList.contains('fiesta'), nombres: [...document.querySelectorAll('#catalogo .fiesta .vitrina-nombre')].map(e => e.textContent) }));
  ok('va primero, antes de "Lo más pedido"', fiesta.primero && await pg.evaluate(() => !!document.querySelector('#catalogo .vitrina')));
  ok('el cartel dice para qué es', fiesta.txt.includes('para la sucá') && /2\s*días/.test(fiesta.txt));
  ok('los productos de Sucot: de cada categoría, intercalados, sin repetir lo de "Lo más pedido" (y nada de Sopa)', JSON.stringify(fiesta.nombres) === JSON.stringify(['Pitzujim-Cajú Caramelizado', 'Klik almohaditas 65g (azul)', 'Caramelos Mentos']));
  await pg.evaluate(() => fiestaSumar(5));
  ok('"+ Agregar" en la fila de la fiesta suma y queda registrado de dónde salió', await pg.evaluate(() => carrito[5] && carrito[5].qty === 1) && await hasta(async () => (await recibidos()).some(x => x.evento === 'vidriera' && x.producto === 'fiesta · Bamba Osem')));
  ok('miércoles: "🕯️ Pedí hasta el jueves a las 20 h y llega para Shabat"', await pg.evaluate(() => { const e = document.getElementById('shabat-franja'); return !e.hidden && e.textContent === '🕯️ Pedí hasta el jueves a las 20 h y llega para Shabat'; }));
  ok('la franja va arriba del buscador', await pg.evaluate(() => document.getElementById('shabat-franja').nextElementSibling.classList.contains('buscador-wrap')));
  await ctx.close();

  // 2) Viernes: sin franja; la fiesta ya es hoy
  const { pg: pg2, ctx: ctx2 } = await nueva('/tienda', { reloj: VIE });
  ok('viernes: "Hoy empieza Sucot"', await hasta(async () => (await pg2.evaluate(() => (document.querySelector('#catalogo .fiesta') || {}).innerText || '')).includes('Hoy empieza Sucot')));
  ok('viernes: la franja de Shabat no está', await pg2.evaluate(() => document.getElementById('shabat-franja').hidden));
  await ctx2.close();

  // 3) Sucot apagado y Shabat con otro horario
  const cfg = _motor_norm({ shabat: { on: true, dia: 3, hora: 18 }, fiestas: { sucot: { on: false } } });
  const { pg: pg3, ctx: ctx3 } = await nueva('/tienda', { fiestas: cfg });
  await hasta(async () => pg3.evaluate(() => document.querySelectorAll('#catalogo .producto-card').length > 3));
  await esperar(600);
  ok('con Sucot apagado no hay cartel', await pg3.evaluate(() => !document.querySelector('#catalogo .fiesta')));
  ok('la franja respeta el día y la hora que eligió Jony', await pg3.evaluate(() => document.getElementById('shabat-franja').textContent.includes('miércoles a las 18 h')));
  await ctx3.close();

  // 4) Pésaj: sin lista, nada; con lista, esa lista
  const { pg: pg4, ctx: ctx4 } = await nueva('/tienda', { reloj: '2027-04-15T12:00:00-03:00' });
  await hasta(async () => pg4.evaluate(() => document.querySelectorAll('#catalogo .producto-card').length > 3));
  await esperar(600);
  ok('Pésaj sin productos elegidos: no se muestra (nunca se adivina qué es kosher le-Pésaj)', await pg4.evaluate(() => !document.querySelector('#catalogo .fiesta')));
  await ctx4.close();
  const { pg: pg5, ctx: ctx5 } = await nueva('/tienda', { reloj: '2027-04-15T12:00:00-03:00', fiestas: _motor_norm({ fiestas: { pesaj: { ids: [3] } } }) });
  ok('Pésaj con productos elegidos: "Faltan 6 días para Pésaj" con esos productos', await hasta(async () => { const t = await pg5.evaluate(() => (document.querySelector('#catalogo .fiesta') || {}).innerText || ''); return t.includes('Faltan 6 días para Pésaj') && t.includes('Chocolate Elite Crunch') && !t.includes('Pitzujim'); }));
  await ctx5.close();

  // 5) Panel: la tarjeta de fiestas y Shabat
  const hoy = '2026-09-23';
  const ev = (vid, evento, fecha) => ({ fecha: fecha.split('-').reverse().join('/') + ' 12:00', vid, pagina: 'tienda', evento, origen: 'directo', dispositivo: 'celular', ciudad: '', pais: '', nombre: '', telefono: '', detalle: '', carrito: '', total: 0 });
  const rows = [];
  for (let k = 0; k < 20; k++) { const f = new Date(Date.parse('2026-09-04T12:00:00Z') + k * 86400000).toISOString().slice(0, 10); if (f > hoy) break; for (let n = 0; n < (f <= '2026-09-10' ? 4 : 2); n++) rows.push(ev('v' + k + '_' + n, 'visita', f)); }
  const ANA = _motor.analitica(rows, 0, [], [], PRODS.map(p => ({ id: p.id, nombre: p.nombre, stock: p.stock, activo: true, dueno: 'Jony' })), null, {});
  const { pg: pg6, ctx: ctx6 } = await nueva('/tienda', { analitica: ANA });
  await hasta(async () => pg6.evaluate(() => productos.length > 3));
  await pg6.evaluate(() => { adminAuth = true; socioActual = 'jony'; cargarAccesoMiri(); });
  const card = await pg6.evaluate(() => { const c = document.getElementById('card-fiestas'); return c.style.display !== 'none' ? c.innerText : ''; });
  ok('Jony ve "🗓️ Fiestas y Shabat en la tienda"', card.includes('Fiestas y Shabat en la tienda') && card.includes('Cierre para Shabat'));
  ok('Sucot figura primero y "EN LA TIENDA AHORA", con lo que va a mostrar', card.indexOf('Sucot') < card.indexOf('Janucá') && card.includes('EN LA TIENDA AHORA') && card.includes('Automático: lo más pedido de Pitzujim'));
  ok('Pésaj avisa que va solo a mano', card.includes('Solo a mano'));
  await pg6.evaluate(() => { const cb = document.querySelector('#fiestas-panel input[type=checkbox]'); cb.click(); });
  await pg6.evaluate(() => fiestaElegir('januca'));
  for (const nom of ['Bamba Osem', 'Chocolate Elite Crunch']) await pg6.evaluate(n => { const l = [...document.querySelectorAll('#fiestas-panel label')].find(x => x.textContent.includes(n)); l.querySelector('input').click(); }, nom);   // de a uno: cada tilde redibuja la tarjeta
  ok('elegir productos a mano: quedan anotados en orden', await pg6.evaluate(() => JSON.stringify(_fiestasEdit.fiestas.januca.ids.slice().sort()) === JSON.stringify([3, 5])));
  await pg6.evaluate(() => guardarFiestas());
  ok('"Guardar" manda todo junto: Shabat apagado y los de Janucá', await hasta(async () => guardados.some(c => c.shabat && c.shabat.on === false && c.fiestas.januca.ids.length === 2)));
  ok('y la tienda lo toma al toque (la franja se va)', await pg6.evaluate(() => _fiestasCfg.shabat.on === false));
  await pg6.evaluate(async () => { _anaPeriodo = 'todo'; await renderAnalitica(); setAnaTab('dias'); });
  const dias = await pg6.evaluate(() => document.getElementById('analitica-contenido').innerText);
  ok('Día a día anota cada fiesta: Iom Kipur, el día después, lo que falta para Sucot', dias.includes('🕯️ Iom Kipur') && dias.includes('el día después de Iom Kipur') && dias.includes('faltan 2 días para Sucot'));
  ok('"🗓️ La semana antes de cada fiesta" con Rosh Hashaná (y cuánto más que una semana normal)', dias.includes('La semana antes de cada fiesta') && /Rosh Hashaná 2026[\s\S]*28 visitas[\s\S]*\+\d+%/.test(dias));
  await pg6.evaluate(() => { socioActual = 'miri'; vistaSocio = 'miri'; });
  ok('en la sesión de Miri la tarjeta no se dibuja', await pg6.evaluate(() => { document.getElementById('fiestas-panel').innerHTML = ''; renderFiestasPanel(true); return document.getElementById('fiestas-panel').innerHTML === ''; }));
  await ctx6.close();

  ok('sin errores de JavaScript', errs.length === 0);
  await b.close(); srv.kill(); mock.kill();
  checks.forEach(c => console.log((c.ok ? '  ✓ ' : '  ✗ FALLÓ — ') + c.n));
  if (errs.length) console.log('  errores JS:', errs.slice(0, 3));
  const malos = checks.filter(c => !c.ok).length;
  console.log(malos ? `❌ ${malos} de ${checks.length} fallaron` : `✅ ${checks.length}/${checks.length} tanda 3 OK`);
  process.exit(malos ? 1 : 0);
})().catch(e => { console.error('💥', e); process.exit(1); });

// La misma lista blanca del motor (función REAL extraída de index.ts), para armar lo que devolvería.
function _motor_norm(raw) {
  if (!_motor_norm.fn) {
    const fs = require('fs');
    const TS = fs.readFileSync(path.join(RAIZ, 'supabase', 'functions', 'api', 'index.ts'), 'utf8');
    const ids = TS.match(/const FIESTAS_IDS = [^;]+;/)[0];
    const ini = TS.indexOf('function normFiestas(');
    let i = TS.indexOf('{', ini) + 1, d = 1; while (d > 0) { const c = TS[i++]; if (c === '{') d++; else if (c === '}') d--; }
    const src = TS.slice(ini, i).replace(/: any/g, '').replace(/: number/g, '');
    _motor_norm.fn = new Function(ids + src + '; return normFiestas;')();
  }
  return _motor_norm.fn(raw);
}
