// 🏷️ v4.91 — Tanda 6, en un navegador de verdad y contra el servidor REAL del sitio: la oferta y el pack
// que se ven son los que se cobran. Se arma un pedido con oferta, pack y un producto normal, y se mira
// lo que de verdad le llega al motor (total, renglones y precios por producto), no solo la pantalla.
// Uso: node tests/oferta_verdad_ui.test.js
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const RAIZ = path.resolve(__dirname, '..');
const SITIO = 'http://127.0.0.1:3199';
const P = (id, nombre, precioMin, extra = {}) => ({ id, nombre, descripcion: 'desc', precio_may: '6', precio_min: precioMin, stock: 50, imagen: '', activo: true, categoria: 'Chocolate', visible_cat: 'Ambos', precio_oferta: 0, fecha_oferta: '', cant_pack: 0, precio_pack: 0, dueno: 'Jony', moneda: 'U$S', ...extra });
const PRODS = [
  P(1, 'Con oferta', 10000, { precio_oferta: 8000, fecha_oferta: '30/09/2026' }),
  P(2, 'Con pack', 5000, { cant_pack: 3, precio_pack: 4000 }),
  P(3, 'Normal', 7000),
  P(4, 'Oferta vencida', 9000, { precio_oferta: 6000, fecha_oferta: '2026-09-20' }),
  P(5, 'Oferta mas cara', 10000, { precio_oferta: 12000 }),
];
const esperar = ms => new Promise(r => setTimeout(r, ms));
async function hasta(fn, ms = 6000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await esperar(150); } return false; }

(async () => {
  const mock = spawn('node', [path.join(__dirname, '_mock_motor_auth.mjs')], { stdio: 'ignore' });
  const srv = spawn('node', ['servidor.mjs'], { cwd: path.join(RAIZ, 'despliegue', 'sitio'), stdio: 'ignore', env: { ...process.env, MOTOR_URL: 'http://127.0.0.1:3998/motor', SUPABASE_URL: 'http://127.0.0.1:3998', PUERTO: '3199', RAIZ } });
  process.on('exit', () => { try { srv.kill(); mock.kill(); } catch { /**/ } });   // aunque la prueba se corte, no quedan servidores prendidos
  await esperar(1500);
  const b = await chromium.launch();
  const checks = [], errs = [], ventas = [], ofertas = [];
  const ok = (n, c) => checks.push({ n, ok: !!c });
  const nueva = async (ruta) => {
    const ctx = await b.newContext({ viewport: { width: 420, height: 900 } });
    const pg = await ctx.newPage();
    await pg.clock.setFixedTime(new Date('2026-09-23T15:00:00-03:00'));
    await pg.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => false }); localStorage.setItem('shuk_may_nombre', 'Ana'); localStorage.setItem('shuk_may_tel', '1155551234'); localStorage.setItem('shuk_cookies', '1'); window.supabase = { createClient: () => ({ auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) } }) }; });
    pg.on('pageerror', e => errs.push(e.message));
    await pg.route('**/*', async route => {
      const req = route.request(), u = req.url();
      if (u.includes('getEstadoTienda')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ estado: 'abierta', fiestas: { shabat: { on: false, dia: 4, hora: 20, txt: '' }, fiestas: {} } }) });
      if (u.includes('accion=venta&')) { ventas.push(Object.fromEntries(new URL(u).searchParams.entries())); return route.fulfill({ contentType: 'application/json', body: '{"ok":true,"nVenta":900,"id":"x900"}' }); }
      if (u.includes('accion=actualizarOferta')) { ofertas.push(Object.fromEntries(new URL(u).searchParams.entries())); return route.fulfill({ contentType: 'application/json', body: '{"ok":true}' }); }
      if (/\/rest\/v1\/productos\?/.test(u)) return route.fulfill({ contentType: 'application/json', body: JSON.stringify(PRODS) });
      if (u.startsWith(SITIO)) return route.continue();
      if (u.includes('supabase') || u.includes('ipapi') || u.includes('qrserver') || u.includes('onesignal') || u.includes('bluelytics') || u.includes('cloudinary')) return route.fulfill({ contentType: 'application/json', body: '[]' });
      return route.continue();
    });
    await pg.goto(SITIO + ruta, { waitUntil: 'domcontentloaded' });
    await hasta(async () => pg.evaluate(() => productos.length > 3));
    await esperar(400);
    return { pg, ctx };
  };
  const tarjeta = (pg, id) => pg.evaluate(i => (document.querySelector('#catalogo > #card-' + i) || document.getElementById('card-' + i) || {}).innerText || '', id);

  // 1) Minorista: lo que se ve
  const { pg, ctx } = await nueva('/tienda');
  const t1 = await tarjeta(pg, 1), t2 = await tarjeta(pg, 2), t4 = await tarjeta(pg, 4), t5 = await tarjeta(pg, 5);
  ok('la oferta vigente se ve: sello, precio de lista tachado y $ 8.000', t1.includes('¡OFERTA') && t1.includes('$ 10.000') && t1.includes('$ 8.000'));
  ok('el pack dice cómo se cobra: "🎁 Llevando 3 o más: $ 4.000 c/u"', t2.includes('Llevando 3 o más: $ 4.000 c/u'));
  ok('la oferta rápida vencida (fecha aaaa-mm-dd) ya no aparece', !t4.includes('OFERTA') && !t4.includes('$ 6.000'));
  ok('una "oferta" más cara que la lista no aparece', !t5.includes('OFERTA') && !t5.includes('12.000'));

  // 2) El carrito
  await pg.evaluate(() => { cantidades[1] = 2; agregarAlCarrito(1); cantidades[2] = 2; agregarAlCarrito(2); cantidades[3] = 1; agregarAlCarrito(3); const x = document.getElementById('sabores-pop'); if (x) x.remove(); abrirCarrito(); });
  const c1 = await pg.evaluate(() => document.getElementById('carrito-contenido').innerText);
  ok('en el carrito, la oferta con el de lista tachado: $ 10.000 → $ 8.000', /Con oferta[\s\S]*\$ 10\.000[\s\S]*\$ 8\.000/.test(c1));
  ok('con 2 del pack: $ 5.000 y el empujón "🎁 Sumá 1 más y cada una sale $ 4.000"', /Con pack[\s\S]*Sumá 1 más y cada una sale \$ 4\.000/.test(c1));
  await pg.evaluate(() => cambiarCarritoQty(2, 1));
  const c2 = await pg.evaluate(() => document.getElementById('carrito-contenido').innerText);
  ok('con 3 del pack: $ 4.000 c/u (y el empujón desaparece)', /Con pack[\s\S]*\$ 5\.000[\s\S]*\$ 4\.000/.test(c2) && !c2.includes('Sumá 1 más'));
  ok('la barra del envío cuenta los precios rebajados (2×8.000 + 3×4.000 + 7.000 = 35.000 → faltan $ 85.000)', c2.includes('Te faltan $ 85.000'));

  // 3) El pedido: lo que llega al motor
  await pg.evaluate(() => { document.getElementById('forma-pago').value = 'Efectivo'; enviarPedido(); });
  ok('se registró el pedido', await hasta(async () => ventas.length === 1));
  const v = ventas[0] || {};
  ok('el total que se cobra: $ 35.000 (no los $ 42.000 de lista)', v.totalARS === '35000' && v.arsJONY === '35000');
  ok('los renglones llevan el precio cobrado: 2x a $ 8.000 y 3x a $ 4.000', (v.productos || '').includes('2x Con oferta · desc — $ 8.000 c/u = $ 16.000') && (v.productos || '').includes('3x Con pack · desc — $ 4.000 c/u = $ 12.000') && (v.productos || '').includes('1x Normal · desc — $ 7.000 c/u = $ 7.000'));
  ok('y lo que usa la ganancia por producto también (id:cantidad:precio)', v.jonyItems === '1:2:8000,2:3:4000,3:1:7000');
  const href = await (async () => { await hasta(async () => pg.evaluate(() => !!document.querySelector('#wa-confirm-modal a'))); return pg.evaluate(() => (document.querySelector('#wa-confirm-modal a') || {}).href || ''); })();
  const msg = decodeURIComponent((href.split('text=')[1] || '').replace(/\+/g, ' '));
  ok('el mensaje de WhatsApp dice lo mismo: total $ 35.000 y "🏷️ Con ofertas y packs ahorrás $ 7.000"', msg.includes('*Total:* $ 35.000') && msg.includes('🏷️ *Con ofertas y packs ahorrás $ 7.000*'));
  await ctx.close();

  // 4) Mayorista: ni se ve ni se cobra
  const { pg: pg2, ctx: ctx2 } = await nueva('/mayorista');
  const m1 = await tarjeta(pg2, 1), m2 = await tarjeta(pg2, 2);
  ok('en mayorista no hay sello de oferta ni cartel de pack', !m1.includes('OFERTA') && !m2.includes('Llevando'));
  await pg2.evaluate(() => { cantidades[1] = 2; agregarAlCarrito(1); cantidades[2] = 3; agregarAlCarrito(2); abrirCarrito(); document.getElementById('forma-pago').value = 'Efectivo'; enviarPedido(); });
  ok('y el pedido mayorista va con su precio de lista (U$S 6 c/u)', await hasta(async () => ventas.length === 2) && ventas[1].totalUSD === '30.00' && ventas[1].totalARS === '0');
  await ctx2.close();

  // 5) Panel: el formulario de ofertas no deja cargar algo que no baja el precio; la difusión dice lo mismo
  const { pg: pg3, ctx: ctx3 } = await nueva('/tienda');
  await pg3.evaluate(() => { adminAuth = true; socioActual = 'jony'; abrirOfertaModal(3); });
  ok('el formulario explica que se cobra solo en la minorista', (await pg3.evaluate(() => document.getElementById('oferta-aviso').innerText)).includes('se cobran'));
  await pg3.evaluate(() => { document.getElementById('oferta-precio').value = '7500'; guardarOferta(); });
  await esperar(300);
  ok('una oferta más cara que la lista ($ 7.500 contra $ 7.000) no se guarda y avisa', ofertas.length === 0 && (await pg3.evaluate(() => document.getElementById('toast').textContent)).includes('menor que el precio de lista'));
  await pg3.evaluate(() => { document.getElementById('oferta-precio').value = ''; document.getElementById('oferta-cant-pack').value = '3'; document.getElementById('oferta-precio-pack').value = ''; guardarOferta(); });
  await esperar(300);
  ok('un pack con la cantidad y sin el precio no se guarda', ofertas.length === 0 && (await pg3.evaluate(() => document.getElementById('toast').textContent)).includes('las dos cosas'));
  await pg3.evaluate(() => { document.getElementById('oferta-precio').value = '6000'; document.getElementById('oferta-fecha').value = '30/9/2026'; document.getElementById('oferta-cant-pack').value = ''; document.getElementById('oferta-precio-pack').value = ''; guardarOferta(); });
  ok('una oferta que sí baja el precio se guarda', await hasta(async () => ofertas.some(o => o.id === '3' && o.precioOferta === '6000' && o.fechaOferta === '30/9/2026' && o.cantPack === '0')));
  const dif = await pg3.evaluate(() => { let abierto = ''; window.open = u => { abierto = u; return null; }; difundirOfertas(); return decodeURIComponent(abierto); });
  ok('la difusión dice el pack como se cobra: "llevando 3 o más, $4.000 c/u" (antes decía "pack x3 por $4.000")', dif.includes('llevando 3 o más, $4.000 c/u') && !dif.includes('Oferta vencida'));
  await ctx3.close();

  ok('sin errores de JavaScript', errs.length === 0);
  await b.close(); srv.kill(); mock.kill();
  checks.forEach(c => console.log((c.ok ? '  ✓ ' : '  ✗ FALLÓ — ') + c.n));
  if (errs.length) console.log('  errores JS:', errs.slice(0, 3));
  const malos = checks.filter(c => !c.ok).length;
  console.log(malos ? `❌ ${malos} de ${checks.length} fallaron` : `✅ ${checks.length}/${checks.length} tanda 6 OK`);
  process.exit(malos ? 1 : 0);
})().catch(e => { console.error('💥', e); process.exit(1); });
