// 🛒 EL RESCATE DEL CARRITO, probado como lo vive un cliente: arma un pedido, se va,
// vuelve, y la tienda se lo ofrece. Todo en un navegador real, sin tocar producción.
// Uso: node tests/rescate_carrito.test.js
const { chromium } = require('playwright');
const path = require('path');
const INDEX = 'file://' + path.resolve(__dirname, '..', 'index.html');

const P = (id, nombre, stock, precioMin) => ({ id, nombre, descripcion: '', precio_may: '5', precio_min: precioMin, stock, imagen: '', activo: true, categoria: 'Chocolates', visible_cat: 'Ambos', precio_oferta: null, fecha_oferta: null, cant_pack: 0, precio_pack: 0, dueno: 'Jony', moneda: '$', unidades_por_paquete: 1, peso: 0, etiqueta: '', vinculo: '', hashgaja: '', kosher_tipo: '', jalav: '' });
let PRODUCTOS = [P('1', 'Chocolate Elite', 10, 9000), P('2', 'Bon O Bon', 5, 5000), P('3', 'Pesek Zman', 4, 6000)];

(async () => {
  const b = await chromium.launch();
  const pg = await b.newPage();
  await pg.addInitScript(() => {
    window.supabase = { createClient: () => ({ auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) } }) };
  });
  const tracks = [];
  const errs = [];
  pg.on('pageerror', e => errs.push(e.message));
  await pg.route('**/*', route => {
    const u = route.request().url();
    if (u.includes('accion=track')) { tracks.push(u); return route.fulfill({ contentType: 'application/json', body: '{"ok":true}' }); }
    if (u.includes('/rest/v1/productos')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify(PRODUCTOS) });
    if (u.includes('getEstadoTienda')) return route.fulfill({ contentType: 'application/json', body: '{"estado":"abierta","mensaje":"","aviso":""}' });
    if (u.includes('ipapi')) return route.fulfill({ contentType: 'application/json', body: '{"city":"CABA","region":"BA","country_name":"Argentina"}' });
    if (u.includes('supabase') || u.includes('qrserver') || u.includes('_geocheck')) return route.fulfill({ contentType: 'application/json', body: '{}' });
    return route.continue();
  });

  const checks = [];
  const ok = (n, c) => checks.push({ n, ok: !!c });
  const banner = () => pg.evaluate(() => { const b = document.getElementById('rescate-carrito'); return b ? b.innerText : ''; });
  const nuevaVisita = async () => {   // volver más tarde = misma memoria del aparato, sesión nueva
    await pg.evaluate(() => sessionStorage.clear());
    await pg.reload({ waitUntil: 'domcontentloaded' });
    await pg.waitForTimeout(1400);
  };

  await pg.goto(INDEX, { waitUntil: 'domcontentloaded' });
  await pg.waitForTimeout(1400);

  // 1) El cliente arma un carrito y se va
  await pg.evaluate(() => { const a = productos[0].id, b2 = productos[1].id; cantidades[a] = 2; agregarAlCarrito(a); cantidades[b2] = 1; agregarAlCarrito(b2); });
  await pg.waitForTimeout(200);
  const guardado = await pg.evaluate(() => JSON.parse(localStorage.getItem('shuk_carrito_guardado') || 'null'));
  ok('el carrito queda guardado en el aparato del cliente', guardado && guardado.items.length === 2);
  ok('se guardan los IDS y cantidades, no los precios', guardado && guardado.items[0].id === '1' && guardado.items[0].q === 2);

  // 2) Vuelve más tarde
  await nuevaVisita();
  let t = await banner();
  ok('al volver, la tienda le ofrece su pedido', t.includes('Te quedó un pedido armado'));
  ok('le dice cuántos productos eran', t.includes('3 producto'));
  ok('le muestra qué había cargado', t.includes('Chocolate Elite'));
  ok('queda registrado que se le ofreció', tracks.some(u => u.includes('evento=rescate') && decodeURIComponent(u).includes('ofrecido')));

  // 3) Retoma
  await pg.click('#rescate-carrito button');
  await pg.waitForTimeout(400);
  const car = await pg.evaluate(() => Object.values(carrito).map(x => String(x.id) + ':' + x.qty).sort().join(','));
  ok('al retomar vuelve el pedido completo', car === '1:2,2:1');
  ok('el cartel se va después de retomar', (await banner()) === '');
  ok('queda registrado que lo retomó', tracks.some(u => decodeURIComponent(u).includes('retomado')));

  // 4) No molesta dos veces en la misma visita
  await pg.evaluate(() => { carrito = {}; actualizarBadge(); _ofrecerCarritoGuardado(); });
  await pg.waitForTimeout(200);
  ok('no vuelve a insistir en la misma visita', (await banner()) === '');

  // 5) Lo que se quedó sin stock no se ofrece
  await pg.evaluate(() => { carrito = {}; const c = productos[2].id; cantidades[c] = 2; agregarAlCarrito(c); });
  await pg.waitForTimeout(150);
  PRODUCTOS = [P('1', 'Chocolate Elite', 10, 9000), P('2', 'Bon O Bon', 5, 5000), P('3', 'Pesek Zman', 0, 6000)];
  await nuevaVisita();
  ok('si TODO lo que había se quedó sin stock, no se le ofrece nada', (await banner()) === '');

  // 6) Empezar de cero
  await pg.evaluate(() => { carrito = {}; const f = productos[0].id; cantidades[f] = 1; agregarAlCarrito(f); });
  await pg.waitForTimeout(150);
  await nuevaVisita();
  ok('vuelve a ofrecer cuando hay algo rescatable', (await banner()).includes('Te quedó un pedido'));
  await pg.evaluate(() => descartarCarritoGuardado());
  await pg.waitForTimeout(200);
  ok('"empezar de cero" borra la memoria del carrito', await pg.evaluate(() => !localStorage.getItem('shuk_carrito_guardado')));
  ok('y queda registrado que lo descartó', tracks.some(u => decodeURIComponent(u).includes('descartado')));
  await nuevaVisita();
  ok('después de descartar, no vuelve a aparecer', (await banner()) === '');

  // 7) El navegador del equipo no ve el cartel
  await pg.evaluate(() => { const e = productos[0].id; cantidades[e] = 1; agregarAlCarrito(e); localStorage.setItem('shuk_no_track', '1'); });
  await pg.waitForTimeout(150);
  await nuevaVisita();
  ok('el navegador del equipo (panel) NO ve el cartel', (await banner()) === '');
  await pg.evaluate(() => localStorage.removeItem('shuk_no_track'));

  ok('sin errores de JavaScript en toda la vuelta', errs.length === 0);

  let fail = 0;
  console.log('\n── rescate del carrito ─────────────');
  checks.forEach(c => { if (!c.ok) fail++; console.log('  ' + (c.ok ? '✓' : '✗ FALLÓ —') + ' ' + c.n); });
  if (errs.length) console.log('  errores:', errs.slice(0, 3));
  console.log(fail === 0 ? `\n✅ TODO VERDE — ${checks.length} controles` : `\n❌ ${fail} de ${checks.length} FALLARON`);
  await b.close();
  process.exit(fail ? 1 : 0);
})();
