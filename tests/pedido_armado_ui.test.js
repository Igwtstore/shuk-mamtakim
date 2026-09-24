// 🔗 v5.00 — PEDIDO ARMADO, en un navegador de verdad y contra el servidor REAL del sitio (motor de mentira):
// el cliente abre el link y encuentra el carrito cargado (al precio de hoy, sin lo agotado, recortado al stock),
// confirma y el pedido viaja marcado; un link ya confirmado no vuelve a cargar nada; uno anulado avisa; el canal
// mayorista cambia la tienda; el equipo no cuenta como "lo abrió". En el panel: armar el link desde el pedido
// manual y desde un carrito abandonado, el mensaje de WhatsApp con el total de la tienda, y la lista de enviados.
// Uso: node tests/pedido_armado_ui.test.js
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const RAIZ = path.resolve(__dirname, '..');
const SITIO = 'http://127.0.0.1:3199';
const P = (id, nombre, stock, precio, extra = {}) => ({ id, nombre, descripcion: 'desc', precio_may: '5', precio_min: precio, stock, imagen: '', activo: true, categoria: 'Chocolate', visible_cat: 'Ambos', precio_oferta: 0, fecha_oferta: '', cant_pack: 0, precio_pack: 0, dueno: 'Jony', moneda: '$', ...extra });
const LARGO = 'Chocolate Elite · Con leche relleno con crema de frutilla (100g)';
const PRODS = [
  P(1, 'Barrita Pesek Zman grande', 17, 6499, { precio_may: '3.5', moneda: 'U$S' }), P(2, 'Klik cornflakes 65 g', 3, 7999),
  P(3, 'Pitzujim Maní grill', 48, 9999, { precio_may: '8300' }), P(4, 'Agotado de siempre', 0, 5000), P(5, LARGO, 20, 11999),
  P(6, 'Gemelo', 0, 1000, { dueno: 'Myri' }), P(7, 'Gemelo', 8, 1000),
];
const ARMADOS = {
  ok1: { nombre: 'Débora Levy', canal: 'minorista', items: [{ id: '1', q: 2 }, { id: '2', q: 5 }, { id: '4', q: 1 }, { id: '99', q: 1 }], nota: 'Te armé lo de siempre 😉', confirmado: false, nVenta: null },
  conf1: { nombre: 'Débora Levy', canal: 'minorista', items: [{ id: '1', q: 2 }], nota: '', confirmado: true, nVenta: 321 },
  may1: { nombre: 'Kiosco Tov', canal: 'mayorista', items: [{ id: '1', q: 10 }, { id: '3', q: 2 }], nota: '', confirmado: false, nVenta: null },
};
const LISTA = [
  { token: 'aaa', nombre: 'Débora Levy', canal: 'minorista', n: 2, unidades: 5, creado: '23/09/2026 10:00', estado: 'confirmado', abierto: '23/09/2026 10:05', confirmado: '23/09/2026 10:07', nVenta: 321, origen: 'manual' },
  { token: 'bbb', nombre: 'Ana Gómez', canal: 'minorista', n: 1, unidades: 2, creado: '23/09/2026 11:00', estado: 'abierto', abierto: '23/09/2026 11:20', confirmado: '', nVenta: null, origen: 'carrito' },
  { token: 'ccc', nombre: 'Kiosco Tov', canal: 'mayorista', n: 2, unidades: 12, creado: '23/09/2026 12:00', estado: 'enviado', abierto: '', confirmado: '', nVenta: null, origen: 'tetoca' },
];
const esperar = ms => new Promise(r => setTimeout(r, ms));
async function hasta(fn, ms = 6000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await esperar(150); } return false; }

(async () => {
  const mock = spawn('node', [path.join(__dirname, '_mock_motor_auth.mjs')], { stdio: 'ignore' });
  const srv = spawn('node', ['servidor.mjs'], { cwd: path.join(RAIZ, 'despliegue', 'sitio'), stdio: 'ignore', env: { ...process.env, MOTOR_URL: 'http://127.0.0.1:3998/motor', SUPABASE_URL: 'http://127.0.0.1:3998', PUERTO: '3199', RAIZ } });
  process.on('exit', () => { try { srv.kill(); mock.kill(); } catch { /**/ } });
  await esperar(1500);
  const b = await chromium.launch();
  const checks = [], errs = [], pedidosArmado = [], ventas = [], creados = [], dialogos = [];
  const ok = (n, c) => checks.push({ n, ok: !!c });
  const recibidos = () => fetch('http://127.0.0.1:3998/_recibidos').then(r => r.json());
  let respPrompt = '';
  const nueva = async (ruta, antes) => {
    const ctx = await b.newContext({ viewport: { width: 420, height: 900 } });
    const pg = await ctx.newPage();
    await pg.clock.setFixedTime(new Date('2026-10-20T15:00:00-03:00'));   // sin fiestas cerca
    await pg.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => false }); window.supabase = { createClient: () => ({ auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) } }) }; });
    if (antes) await pg.addInitScript(antes);
    pg.on('pageerror', e => errs.push(e.message));
    pg.on('dialog', d => { dialogos.push(d.type() + ':' + d.message()); if (d.type() === 'prompt') d.accept(respPrompt); else d.accept(); });
    await pg.route('**/*', route => {
      const u = route.request().url();
      if (u.includes('getPedidoArmado')) {
        const q = new URL(u).searchParams; pedidosArmado.push(Object.fromEntries(q.entries()));
        const d = ARMADOS[q.get('t')];
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify(d || { error: 'este pedido ya no está disponible' }) });
      }
      if (u.includes('accion=venta')) { ventas.push(Object.fromEntries(new URL(u).searchParams.entries())); return route.fulfill({ contentType: 'application/json', body: '{"ok":true,"nVenta":321}' }); }
      if (u.includes('accion=crearPedidoArmado')) { creados.push(Object.fromEntries(new URL(u).searchParams.entries())); return route.fulfill({ contentType: 'application/json', body: '{"ok":true,"token":"tok123abc"}' }); }
      if (u.includes('accion=listarPedidosArmados')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify(LISTA) });
      if (u.includes('miHabitual')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ items: [{ id: '3', q: 1, veces: 3 }], pedidos: 3, ultima: '10/10/2026' }) });
      if (u.includes('getEstadoTienda')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ estado: 'abierta' }) });
      if (/\/rest\/v1\/productos\?/.test(u)) return route.fulfill({ contentType: 'application/json', body: JSON.stringify(PRODS) });
      if (u.startsWith(SITIO)) return route.continue();
      if (u.includes('supabase') || u.includes('ipapi') || u.includes('qrserver') || u.includes('onesignal') || u.includes('bluelytics') || u.includes('cloudinary')) return route.fulfill({ contentType: 'application/json', body: '[]' });
      return route.continue();
    });
    await pg.goto(SITIO + ruta, { waitUntil: 'domcontentloaded' });
    await hasta(async () => pg.evaluate(() => typeof productos !== 'undefined' && productos.length > 3));
    return { pg, ctx };
  };
  const banner = pg => pg.evaluate(() => (document.getElementById('armado-banner') || {}).innerText || '');

  // ── 1) El cliente abre el link: carrito cargado, al precio de hoy ─────────────
  const { pg, ctx } = await nueva('/?pedido=ok1', () => {
    localStorage.setItem('shuk_may_nombre', 'Débora Levy'); localStorage.setItem('shuk_may_tel', '1144556677');
    localStorage.setItem('shuk_carrito_guardado', JSON.stringify({ ts: Date.now(), modo: 'minorista', items: [{ id: 3, q: 4 }] }));   // un carrito viejo que NO debe aparecer
  });
  ok('abre con el cartel "Débora, ya está todo en tu carrito" y el mensajito de Jony', await hasta(async () => { const t = await banner(pg); return t.includes('Débora, ya está todo en tu carrito') && t.includes('Te armé lo de siempre'); }));
  const cart1 = await pg.evaluate(() => Object.values(carrito).map(i => String(i.id) + ':' + i.qty).sort().join(','));
  ok('el carrito tiene lo armado: 2 barritas y los Klik recortados al stock (pidió 5, hay 3)', cart1 === '1:2,2:3');
  const t1 = await banner(pg);
  ok('avisa lo agotado y lo que ya no existe (no lo carga)', t1.includes('Se agotó') && t1.includes('Agotado de siempre') && t1.includes('ya no está'));
  ok('avisa que de los Klik le pusieron lo que queda', t1.includes('Klik cornflakes 65 g (quedan 3)'));
  ok('el total es el de HOY: 2×6.499 + 3×7.999 = $ 36.995', t1.includes('$ 36.995'));
  ok('el carrito se abre solo', await hasta(async () => pg.evaluate(() => document.getElementById('carrito-overlay').classList.contains('abierto'))));
  ok('no aparece el carrito viejo guardado ni "lo de siempre" (manda el pedido armado)', await pg.evaluate(() => !document.getElementById('rescate-carrito') && !document.getElementById('lo-de-siempre')));
  ok('el cliente no cuenta como equipo (el link queda marcado "lo abrió")', pedidosArmado.length >= 1 && pedidosArmado[0].equipo === undefined);
  ok('queda registrado que lo abrió (para medir)', await hasta(async () => (await recibidos()).some(x => x.evento === 'armado' && /^abierto/.test(x.producto))));
  // Confirma
  await pg.evaluate(() => { const fp = document.getElementById('forma-pago'); fp.value = [...fp.options].find(o => o.value).value; enviarPedido(); });
  ok('al confirmar, el pedido viaja marcado con el link', await hasta(async () => ventas.some(v => v.armado === 'ok1')));
  const v1 = ventas.find(v => v.armado === 'ok1') || {};
  ok('con la nota "🔗 Pedido armado por link" (se ve en el pedido)', (v1.notas || '').includes('🔗 Pedido armado por link'));
  ok('y el stock que descuenta es exactamente lo del carrito', v1.stockUpdates === '1:2,2:3' || v1.stockUpdates === '2:3,1:2');
  ok('después de confirmar, el cartel del pedido armado se va', await hasta(async () => (await banner(pg)) === ''));
  await ctx.close();

  // ── 2) Sin nombre guardado: el nombre ya viene puesto en el carrito ───────────
  const { pg: pgN, ctx: ctxN } = await nueva('/?pedido=ok1');
  await hasta(async () => pgN.evaluate(() => document.getElementById('carrito-overlay').classList.contains('abierto')));
  ok('sin nombre guardado, el carrito ya trae "Débora Levy" (un paso menos)', await hasta(async () => pgN.evaluate(() => (document.getElementById('nombre-cliente') || {}).value === 'Débora Levy')));
  await ctxN.close();

  // ── 3) Link ya confirmado: no vuelve a cargar nada ─────────────────────────────
  const { pg: pgC, ctx: ctxC } = await nueva('/?pedido=conf1');
  ok('un link ya confirmado dice "ya lo mandaste (#321)"', await hasta(async () => (await banner(pgC)).includes('ya lo mandaste (#321)')));
  ok('y NO carga el carrito otra vez (no se duplica el pedido)', await pgC.evaluate(() => Object.keys(carrito).length === 0));
  await ctxC.close();

  // ── 4) Link anulado o inventado ────────────────────────────────────────────────
  const { pg: pgX, ctx: ctxX } = await nueva('/?pedido=nada1');
  ok('un link anulado avisa "ya no está disponible" y no carga nada', await hasta(async () => (await banner(pgX)).includes('ya no está disponible')) && await pgX.evaluate(() => Object.keys(carrito).length === 0));
  await ctxX.close();

  // ── 5) Pedido mayorista: la tienda cambia sola a mayorista ─────────────────────
  const { pg: pgM, ctx: ctxM } = await nueva('/tienda?pedido=may1', () => { localStorage.setItem('shuk_may_nombre', 'Kiosco Tov'); localStorage.setItem('shuk_may_tel', '1100000000'); });
  ok('un pedido mayorista pone la tienda en mayorista', await hasta(async () => pgM.evaluate(() => modo === 'mayorista')));
  ok('con el carrito cargado (10 barritas, 2 pitzujim)', await pgM.evaluate(() => Object.values(carrito).map(i => String(i.id) + ':' + i.qty).sort().join(',') === '1:10,3:2'));
  const tM = await banner(pgM);
  ok('y el total en las dos monedas, sin mezclar: $ 16.600 + U$S 35.00', tM.includes('$ 16.600') && tM.includes('U$S 35.00'));
  await ctxM.close();

  // ── 6) Si lo abre Jony para probarlo, no cuenta como que el cliente lo vio ────
  pedidosArmado.length = 0;
  const { pg: pgJ, ctx: ctxJ } = await nueva('/?pedido=ok1', () => { localStorage.setItem('shuk_no_track', '1'); });
  await hasta(async () => pedidosArmado.length > 0);
  ok('el navegador del equipo avisa "equipo=1" (no se marca "lo abrió")', pedidosArmado.length >= 1 && pedidosArmado[0].equipo === '1');
  ok('pero igual ve el carrito cargado (para revisar lo que mandó)', await hasta(async () => pgJ.evaluate(() => Object.keys(carrito).length === 2)));
  await ctxJ.close();

  // ── 7) PANEL ───────────────────────────────────────────────────────────────────
  const { pg: pp, ctx: ctxP } = await nueva('/tienda');
  await pp.evaluate(() => { adminAuth = true; socioActual = 'jony'; });
  const g = await pp.evaluate(L => ({
    porId: String((_productoDeRenglon({ i: '3', n: 'otra cosa' }) || {}).id),
    largo: String((_productoDeRenglon({ n: L.substring(0, 40) }) || {}).id),
    gemelo: String((_productoDeRenglon({ n: 'Gemelo' }) || {}).id),
  }), LARGO);
  ok('un renglón de carrito con id encuentra EL producto (aunque el nombre no coincida)', g.porId === '3');
  ok('un renglón viejo con el nombre recortado a 40 letras lo encuentra igual', g.largo === '5');
  ok('entre dos gemelos con el mismo nombre, gana el que tiene stock', g.gemelo === '7');

  respPrompt = 'Te sumé el Pitzujim nuevo 😉';
  await pp.evaluate(() => {
    window._telDeCliente = { [normCliente('Débora Levy')]: '1144556677' };
    document.getElementById('manual-cliente').value = 'Débora Levy';
    document.getElementById('manual-tipo').value = 'Minorista';
    _manualQtys = { 1: 2, 3: 1 }; _manualPrecios = {}; _manualDescs = {};
  });
  await pp.evaluate(() => mandarPedidoManualComoLink());
  ok('desde el pedido manual crea el link con lo elegido', await hasta(async () => creados.length === 1));
  const c1 = creados[0] || {};
  ok('manda qué y cuánto (1:2, 3:1), el nombre, el canal y el mensajito — nunca precios', c1.items === '1:2,3:1' && c1.nombre === 'Débora Levy' && c1.canal === 'minorista' && c1.nota === respPrompt && c1.origen === 'manual' && !('precio' in c1));
  const ov = await pp.evaluate(() => ({ t: (document.getElementById('armado-overlay') || {}).innerText || '', h: (document.getElementById('armado-overlay') || {}).innerHTML || '' }));
  ok('el mensaje lista el pedido y el total como lo va a ver la tienda (2×6.499 + 9.999 = $ 22.997)', ov.t.includes('2× Barrita Pesek Zman grande') && ov.t.includes('1× Pitzujim Maní grill') && ov.t.includes('$ 22.997'));
  ok('con el link al pedido', ov.t.includes('https://shukmamtakim.com.ar/?pedido=tok123abc'));
  ok('y el WhatsApp va directo al número del cliente', ov.h.includes('wa.me/5491144556677'));
  await pp.evaluate(() => { const o = document.getElementById('armado-overlay'); if (o) o.remove(); });

  // Con descuentos en la pantalla: avisa que NO viajan
  dialogos.length = 0;
  await pp.evaluate(() => { _manualDescs = { 1: 10 }; mandarPedidoManualComoLink(); });
  ok('si hay descuentos cargados, avisa que el link usa los precios de la tienda', await hasta(async () => dialogos.some(d => d.startsWith('confirm:') && d.includes('no viajan'))));
  await esperar(500);
  await pp.evaluate(() => { _manualDescs = {}; const o = document.getElementById('armado-overlay'); if (o) o.remove(); });

  // Desde un carrito abandonado
  creados.length = 0;
  await pp.evaluate(L => {
    window._abData = [{ nombre: 'Ana Gómez', telefono: '1122334455', mayorista: false, items: [{ i: '1', n: 'Barrita Pesek Zman grande', q: 1 }, { n: L.substring(0, 40), q: 2 }, { n: 'Producto que ya no existe', q: 1 }] }];
    armadoDesdeCarrito(0);
  }, LARGO);
  ok('desde un carrito abandonado arma el link con SU carrito (el de nombre largo incluido)', await hasta(async () => creados.length === 1 && creados[0].items === '1:1,5:2' && creados[0].origen === 'carrito'));
  const ov2 = await pp.evaluate(() => ({ t: (document.getElementById('armado-overlay') || {}).innerText || '', h: (document.getElementById('armado-overlay') || {}).innerHTML || '' }));
  ok('con el mensaje "te quedó este pedido sin terminar" y a su WhatsApp', ov2.t.includes('te quedó este pedido sin terminar') && ov2.h.includes('wa.me/5491122334455'));
  await pp.evaluate(() => { const o = document.getElementById('armado-overlay'); if (o) o.remove(); });

  // "Cargar como pedido" ahora encuentra los de nombre largo
  await pp.evaluate(L => { window._abData = [{ nombre: 'Ana', mayorista: false, items: [{ n: L.substring(0, 40), q: 2 }] }]; cargarComoPedido(0); }, LARGO);
  ok('"Cargar como pedido" encuentra el producto de nombre largo (antes quedaba afuera)', await pp.evaluate(() => _manualQtys[5] === 2));

  // La lista de enviados
  await pp.evaluate(() => verLinksArmados());
  const lista = await hasta(async () => ((await pp.evaluate(() => (document.getElementById('armado-overlay') || {}).innerText || '')).includes('Pedidos armados que mandaste')));
  const tl = await pp.evaluate(() => (document.getElementById('armado-overlay') || {}).innerText || '');
  ok('"Enviados" muestra qué pasó con cada link', lista && tl.includes('Confirmó · pedido #321') && tl.includes('Lo abrió 23/09/2026 11:20') && tl.includes('Todavía no lo abrió'));
  ok('y cuántos confirmaron', tl.includes('3 enviados') && tl.includes('1 confirmado'));
  await ctxP.close();

  ok('sin errores de JavaScript', errs.length === 0);
  await b.close(); srv.kill(); mock.kill();
  let fail = 0;
  console.log('\n── pedido armado ─────────────');
  checks.forEach(c => { if (!c.ok) fail++; console.log('  ' + (c.ok ? '✓' : '✗ FALLÓ —') + ' ' + c.n); });
  if (errs.length) console.log('  errores:', errs.slice(0, 4));
  console.log(fail === 0 ? `\n✅ TODO VERDE — ${checks.length} controles` : `\n❌ ${fail} de ${checks.length} FALLARON`);
  process.exit(fail ? 1 : 0);
})();
