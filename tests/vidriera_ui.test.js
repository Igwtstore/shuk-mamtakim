// 🔥 v4.87 — Tanda 2 "Que agarren algo", en un navegador de verdad y contra el servidor REAL del
// sitio (despliegue/sitio/servidor.mjs) con un motor de mentira: la fila "Lo más pedido", el orden
// dentro de cada categoría, los sellos, "Completá los sabores" (al agregar y en el carrito) y, en el
// panel, el ✨ que le pide la ficha a la IA y la aplica.
// Uso: node tests/vidriera_ui.test.js
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const { _motor } = require('./unit/vidriera.js');
const RAIZ = path.resolve(__dirname, '..');
const SITIO = 'http://127.0.0.1:3199';
const P = (id, nombre, stock, precio, extra = {}) => ({ id, nombre, descripcion: 'desc', precio_may: '5', precio_min: precio, stock, imagen: '', activo: true, categoria: 'Chocolate', visible_cat: 'Ambos', precio_oferta: 0, fecha_oferta: '', cant_pack: 0, precio_pack: 0, dueno: 'Jony', moneda: '$', ...extra });
const PRODS_SB = [
  P(1, 'Klik almohaditas 65g (azul)', 16, 7999), P(2, 'Klik biscuit arroz 65g (rojo)', 4, 7999), P(3, 'Klik cornflakes 65g (verde)', 9, 7999),
  P(4, 'Chocolate Elite Crunch', 16, 8999), P(5, 'Chocolate Elite Crunch · Blanco con biscuit', 5, 8999), P(6, 'Chocolate Elite · Cream Jalav (100g)', 10, 8500),
  P(7, 'Chocolate Milka · Oreo', 5, 9500), P(8, 'Aaa chocolate sin ventas', 30, 5000),
  P(10, 'Pitzujim-Mani Sabor Grill', 48, 9999, { categoria: 'Pitzujim' }), P(11, 'Pitzujim-Cajú Caramelizado', 22, 12000, { categoria: 'Pitzujim' }), P(12, 'Pitzujim-Pecán Halva', 24, 12000, { categoria: 'Pitzujim' }),
  P(13, 'Mentos Pure Fresh', 8, 3000, { categoria: 'Pastilla' }), P(14, 'Mentos Pure Fresh', 7, 3000, { categoria: 'Pastilla' }),
  P(15, 'Solo para mayoristas', 30, 5000, { visible_cat: 'Mayorista' }), P(16, 'Agotado pero pedido', 0, 5000),
  P(17, 'Sin descripción con stock', 6, 4000, { descripcion: '', categoria: 'Varios' }),
];
// Lo que calcula el motor: top de la semana, orden de 30 días y lo que se agota (con el stock de entonces).
const VIDRIERA = { t: Date.now(), dias: 7, top: [10, 5, 13, 14, 16, 15, 1, 4, 7, 11], orden: [5, 10, 1, 4, 7, 2, 11, 13, 3, 16], agota: { 2: 4, 5: 5, 7: 3 } };
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
  const escrituras = [];
  const nueva = async (ruta, { antes, estado = { estado: 'abierta', vidriera: VIDRIERA }, analitica = null, ficha = null, prods = PRODS_SB } = {}) => {
    const ctx = await b.newContext({ viewport: { width: 420, height: 900 } });
    const pg = await ctx.newPage();
    await pg.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => false }); window.supabase = { createClient: () => ({ auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) } }) }; });
    if (antes) await pg.addInitScript(antes);
    pg.on('pageerror', e => errs.push(e.message));
    await pg.route('**/*', async route => {
      const req = route.request(), u = req.url();
      if (u.includes('getEstadoTienda')) return estado ? route.fulfill({ contentType: 'application/json', body: JSON.stringify(estado) }) : route.abort();
      if (u.includes('miHabitual')) return route.fulfill({ contentType: 'application/json', body: '{"items":[],"pedidos":0}' });
      if (u.includes('getAnalitica') && analitica) return route.fulfill({ contentType: 'application/json', body: JSON.stringify(analitica) });
      if (u.includes('accion=editarProducto')) { escrituras.push(Object.fromEntries(new URL(u).searchParams.entries())); return route.fulfill({ contentType: 'application/json', body: '{"ok":true}' }); }
      if (req.method() === 'POST' && u.includes('/functions/v1/api')) {
        let body = {}; try { body = JSON.parse(req.postData() || '{}'); } catch { /**/ }
        if (body.accion === 'sugerirFicha' && ficha) { escrituras.push(body); await esperar(300); return route.fulfill({ contentType: 'application/json', body: JSON.stringify(ficha) }); }
      }
      if (/\/rest\/v1\/productos\?/.test(u)) return route.fulfill({ contentType: 'application/json', body: JSON.stringify(prods) });
      if (u.startsWith(SITIO)) return route.continue();
      if (u.includes('supabase') || u.includes('ipapi') || u.includes('qrserver') || u.includes('onesignal') || u.includes('bluelytics') || u.includes('cloudinary')) return route.fulfill({ contentType: 'application/json', body: '[]' });
      return route.continue();
    });
    await pg.goto(SITIO + ruta, { waitUntil: 'domcontentloaded' });
    return { pg, ctx };
  };

  // 1) Minorista: la fila, los sellos y el orden
  const { pg, ctx } = await nueva('/tienda');
  ok('aparece "🔥 Lo más pedido esta semana" arriba del catálogo', await hasta(async () => (await pg.evaluate(() => (document.querySelector('#catalogo .vitrina') || {}).innerText || '')).includes('Lo más pedido')));
  const fila = await pg.evaluate(() => [...document.querySelectorAll('#catalogo .vitrina .vitrina-nombre')].map(e => e.textContent));
  ok('la fila: 6, en el orden del motor, sin gemelo repetido, sin agotado y sin lo que es solo mayorista',
    JSON.stringify(fila) === JSON.stringify(['Pitzujim-Mani Sabor Grill', 'Chocolate Elite Crunch · Blanco con biscuit', 'Mentos Pure Fresh', 'Klik almohaditas 65g (azul)', 'Chocolate Elite Crunch', 'Chocolate Milka · Oreo']));
  ok('la fila va antes que las tarjetas', await pg.evaluate(() => { const c = document.getElementById('catalogo'); return c.firstElementChild && c.firstElementChild.classList.contains('vitrina'); }));
  const sellos = await pg.evaluate(() => Object.fromEntries([...document.querySelectorAll('#catalogo .producto-card')].map(c => [c.querySelector('.producto-nombre').textContent + '#' + c.id, (c.querySelector('.sellos-foto') || {}).innerText || ''])));
  const sello = (nombre, id) => sellos[nombre + '#card-' + id] || '';
  ok('🔥 en los 6 de la fila (y en uno solo de los gemelos)', sello('Pitzujim-Mani Sabor Grill', 10).includes('Lo más pedido') && sello('Mentos Pure Fresh', 13).includes('Lo más pedido') && !sello('Mentos Pure Fresh', 14).includes('Lo más pedido'));
  ok('⏳ donde queda el stock de cuando se calculó (Klik rojo 4 de 4, Milka 5 de 3 → no)', sello('Klik biscuit arroz 65g (rojo)', 2).includes('Se agota pronto') && !sello('Chocolate Milka · Oreo', 7).includes('Se agota'));
  ok('los dos sellos juntos cuando son los dos ciertos (Elite biscuit)', sello('Chocolate Elite Crunch · Blanco con biscuit', 5).includes('Lo más pedido') && sello('Chocolate Elite Crunch · Blanco con biscuit', 5).includes('Se agota pronto'));
  ok('lo que no vende no lleva sellos', sello('Aaa chocolate sin ventas', 8) === '');
  const ordenChoc = await pg.evaluate(() => [...document.querySelectorAll('#catalogo > .producto-card')].map(c => c.querySelector('.producto-nombre').textContent).filter(n => /Klik|Elite|Milka|Aaa/.test(n)));
  ok('Chocolate: primero lo que se vende, cada línea junta (Elite, Klik, Milka) y al final lo que no vendió',
    JSON.stringify(ordenChoc) === JSON.stringify(['Chocolate Elite Crunch · Blanco con biscuit', 'Chocolate Elite Crunch', 'Klik almohaditas 65g (azul)', 'Klik biscuit arroz 65g (rojo)', 'Klik cornflakes 65g (verde)', 'Chocolate Milka · Oreo', 'Chocolate Elite · Cream Jalav (100g)', 'Aaa chocolate sin ventas']));

  // 2) Sumar desde la fila
  await pg.evaluate(() => vitrinaSumar(10));
  ok('"+ Agregar" de la fila suma 1 al carrito', await pg.evaluate(() => carrito[10] && carrito[10].qty === 1));
  ok('y el botón pasa a "✓ 1 · sumar otro"', (await pg.evaluate(() => [...document.querySelectorAll('.vitrina-btn')][0].textContent)).includes('✓ 1'));
  ok('queda registrado que salió de la fila', await hasta(async () => (await recibidos()).some(x => x.evento === 'vidriera' && x.producto === 'fila · Pitzujim-Mani Sabor Grill')));
  ok('al sumar desde la fila no salta el aviso de sabores (eso es al elegir en la tarjeta)', await pg.evaluate(() => !document.getElementById('sabores-pop')));

  // 3) Agregar desde la tarjeta → "¿Completás los sabores?"
  await pg.evaluate(() => { cantidades[1] = 2; agregarAlCarrito(1); });
  const pop = await pg.evaluate(() => (document.getElementById('sabores-pop') || {}).innerText || '');
  ok('al agregar un Klik desde la tarjeta aparece "¿Completás los sabores?" con los otros Klik', pop.includes('¿Completás los sabores?') && pop.includes('Klik biscuit arroz 65g (rojo)') && pop.includes('Klik cornflakes 65g (verde)') && pop.includes('Agregado · Klik almohaditas 65g (azul)'));
  ok('el más vendido primero (rojo antes que verde)', pop.indexOf('rojo') < pop.indexOf('verde'));
  await pg.evaluate(() => { const b = [...document.querySelectorAll('#sabores-pop button')].find(x => x.textContent.includes('Sumar')); b.click(); });
  ok('"+ Sumar" lo agrega y cierra el aviso', await pg.evaluate(() => carrito[2] && carrito[2].qty === 1 && !document.getElementById('sabores-pop')));
  ok('queda registrado: se ofreció y se sumó un sabor', await hasta(async () => { const r = await recibidos(); return r.some(x => x.evento === 'vidriera' && x.producto === 'sabores · ofrecido') && r.some(x => x.evento === 'vidriera' && x.producto === 'sabores · Klik biscuit arroz 65g (rojo)'); }));
  await pg.evaluate(() => { cantidades[3] = 1; agregarAlCarrito(3); });
  ok('la misma línea no se vuelve a ofrecer en la visita', await pg.evaluate(() => !document.getElementById('sabores-pop')));

  // 4) El carrito
  await pg.evaluate(() => { cantidades[4] = 1; agregarAlCarrito(4); const x = document.getElementById('sabores-pop'); if (x) x.remove(); abrirCarrito(); });
  const cartTxt = await pg.evaluate(() => (document.querySelector('#carrito-contenido .sabores-box') || {}).innerText || '');
  ok('en el carrito: "🎨 Completá los sabores" con lo que falta (Elite biscuit primero, después Elite Cream y Pitzujim)', cartTxt.includes('Completá los sabores') && cartTxt.includes('Chocolate Elite Crunch · Blanco con biscuit') && cartTxt.indexOf('Blanco con biscuit') < cartTxt.indexOf('Cream Jalav'));
  ok('no sugiere lo que ya está en el carrito', !cartTxt.includes('Klik') && !cartTxt.includes('Mani Sabor Grill'));
  await pg.evaluate(() => { const b = [...document.querySelectorAll('#carrito-contenido .sabores-box button')][0]; b.click(); });
  ok('"+ Sumar" en el carrito lo suma y el carrito se redibuja', await pg.evaluate(() => carrito[5] && carrito[5].qty === 1 && !document.querySelector('#carrito-contenido .sabores-box').innerText.includes('Blanco con biscuit')));
  await pg.evaluate(() => cerrarCarrito());

  // 5) Con búsqueda, sin fila
  await pg.evaluate(() => { document.getElementById('buscador').value = 'klik'; renderCatalogo(); });
  ok('buscando, la fila no aparece', await pg.evaluate(() => !document.querySelector('#catalogo .vitrina')));
  await ctx.close();

  // 6) Vuelve otro día y el servidor no contesta: abre igual ordenada, con lo que guardó el aparato
  const { pg: pg2, ctx: ctx2 } = await nueva('/tienda', { estado: null, antes: `localStorage.setItem('shuk_vidriera', ${JSON.stringify(JSON.stringify(VIDRIERA))})` });
  ok('con la vidriera guardada en el aparato, la fila sale aunque el servidor no conteste', await hasta(async () => pg2.evaluate(() => !!document.querySelector('#catalogo .vitrina'))));
  await ctx2.close();
  const { pg: pg3, ctx: ctx3 } = await nueva('/tienda', { estado: { estado: 'abierta' } });
  await esperar(2500);
  ok('sin vidriera (motor viejo) la tienda anda igual: sin fila, orden de siempre', await pg3.evaluate(() => !document.querySelector('#catalogo .vitrina') && document.querySelectorAll('#catalogo .producto-card').length > 5));
  await ctx3.close();

  // 7) Mayorista: entra lo que es solo mayorista
  const { pg: pg4, ctx: ctx4 } = await nueva('/mayorista', { antes: () => { localStorage.setItem('shuk_may_nombre', 'Prueba'); localStorage.setItem('shuk_may_tel', '1100000000'); } });
  ok('en mayorista la fila incluye lo que es solo mayorista', await hasta(async () => (await pg4.evaluate(() => (document.querySelector('#catalogo .vitrina') || {}).innerText || '')).includes('Solo para mayoristas')));
  await ctx4.close();

  // 8) Panel: ✨ Mejorar la ficha
  const hoy = _motor.fechaAhora().slice(0, 10);
  const ev = (vid, evento, hora, detalle = '') => ({ fecha: hoy + ' ' + hora, vid, pagina: 'tienda', evento, origen: 'directo', dispositivo: 'celular', ciudad: '', pais: '', nombre: '', telefono: '', detalle, carrito: '', total: 0 });
  const rows = [];
  for (let i = 0; i < 6; i++) rows.push(ev('v' + i, 'visita', '00:0' + i), ev('v' + i, 'vistas', '00:0' + i, JSON.stringify({ v: [{ n: 'Chocolate Milka · Oreo' }, { n: 'Aaa chocolate sin ventas' }] })));
  rows.push(ev('v1', 'vidriera', '00:09', 'fila · Pitzujim-Mani Sabor Grill'), ev('v1', 'pedido', '00:10'));
  const prodsAna = PRODS_SB.map(p => ({ id: p.id, nombre: p.nombre, stock: p.stock, activo: true, dueno: 'Jony' }));
  const ANA = _motor.analitica(rows, 30, [], [], prodsAna, null, {});
  const FICHA = { ok: true, id: '7', actual: { nombre: 'Chocolate Milka · Oreo', desc: 'desc' }, desc: 'Chocolate con leche de los Alpes relleno con trocitos de galletita Oreo (100 g).', nombre: 'Chocolate Milka · Oreo', cambiarNombre: false, foto: 'Mostrarla partida, con la galletita a la vista.', porque: 'La descripción actual no dice qué tiene adentro.' };
  const { pg: pg5, ctx: ctx5 } = await nueva('/tienda', { analitica: ANA, ficha: FICHA });
  await hasta(async () => pg5.evaluate(() => productos.length > 5));
  await pg5.evaluate(async () => { adminAuth = true; socioActual = 'jony'; await renderAnalitica(); setAnaTab('productos'); });
  const secP = await pg5.evaluate(() => document.getElementById('analitica-contenido').innerText);
  ok('"Los ven y no los agarran" trae ✨ Mejorar en lo que tiene stock', secP.includes('Los ven y no los agarran') && (await pg5.evaluate(() => document.querySelectorAll('.ficha-ia-btn').length)) >= 2);
  ok('"📝 Con stock y sin descripción" lista lo que se vende con la tarjeta pelada', secP.includes('Con stock y sin descripción (1)') && secP.includes('Sin descripción con stock'));
  await pg5.evaluate(() => { const b = [...document.querySelectorAll('.ficha-ia-btn')].find(x => x.closest('div').parentElement.innerText.includes('Milka')); b.click(); });
  ok('mientras la IA trabaja, lo dice', await hasta(async () => (await pg5.evaluate(() => document.querySelector('[data-ficha-ia="7"]').innerText)).includes('está mirando la foto'), 2000));
  ok('la propuesta aparece con descripción, idea de foto y el porqué', await hasta(async () => { const t = await pg5.evaluate(() => document.querySelector('[data-ficha-ia="7"]').innerText); return t.includes('La IA te sugiere') && t.includes('trocitos de galletita Oreo') && t.includes('Mostrarla partida') && t.includes('no dice qué tiene adentro'); }));
  ok('el pedido viaja con el producto, el motivo y cuántos lo vieron', escrituras.some(x => x.accion === 'sugerirFicha' && x.id === '7' && x.motivo === 'no-agarran' && x.personas === '6'));
  ok('no ofrece cambiar el nombre si la IA dice que está bien', !(await pg5.evaluate(() => document.querySelector('[data-ficha-ia="7"]').innerText)).includes('Aplicar nombre'));
  await pg5.evaluate(() => { [...document.querySelectorAll('[data-ficha-ia="7"] button')].find(x => x.textContent === 'Aplicar descripción').click(); });
  ok('"Aplicar descripción" la guarda en el producto', await hasta(async () => escrituras.some(x => x.accion === 'editarProducto' && x.id === '7' && x.desc === FICHA.desc)));
  ok('y queda "✓ Ficha actualizada", con la tienda ya mostrándola', await hasta(async () => (await pg5.evaluate(() => document.querySelector('[data-ficha-ia="7"]').innerText)).includes('Ficha actualizada')) && await pg5.evaluate(() => productos.find(p => p.id === 7).desc.includes('trocitos')));
  ok('"🔥 ¿Venden la vidriera y los sabores?" en Hoy', await pg5.evaluate(() => { setAnaTab('hoy'); return document.getElementById('analitica-contenido').innerText.includes('¿Venden la vidriera y los sabores?'); }));
  await pg5.evaluate(() => { socioActual = 'miri'; vistaSocio = 'miri'; setAnaTab('productos'); });
  ok('en la vista de Miri no hay ✨ (la IA de fichas es de Jony)', await pg5.evaluate(() => document.querySelectorAll('.ficha-ia-btn').length === 0));
  await ctx5.close();

  ok('sin errores de JavaScript', errs.length === 0);
  await b.close(); srv.kill(); mock.kill();
  checks.forEach(c => console.log((c.ok ? '  ✓ ' : '  ✗ FALLÓ — ') + c.n));
  if (errs.length) console.log('  errores JS:', errs.slice(0, 3));
  const malos = checks.filter(c => !c.ok).length;
  console.log(malos ? `❌ ${malos} de ${checks.length} fallaron` : `✅ ${checks.length}/${checks.length} tanda 2 OK`);
  process.exit(malos ? 1 : 0);
})().catch(e => { console.error('💥', e); process.exit(1); });
