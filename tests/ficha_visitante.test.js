// 🔬 ¿La tienda cuenta de verdad quién es el anónimo? Ficha técnica al entrar
// (huso horario, idioma, aparato, pantalla) y, al irse, cuánto se quedó y cuánto tocó.
// Uso: node tests/ficha_visitante.test.js
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const http = require('http');
// Se sirve por HTTP (no file://) porque la tienda le pregunta al candado por una ruta del
// propio dominio (/_geocheck): con file:// esa consulta no existe y el control no se probaría.
const HTML = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const server = http.createServer((req, res) => {
  if (req.url.startsWith('/_geocheck')) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"alive":true,"gate":"mercosur","country":"AR","mercosur":true}'); }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(HTML);
});
const P = (id, nombre, stock, precioMin) => ({ id, nombre, descripcion: '', precio_may: '5', precio_min: precioMin, stock, imagen: '', activo: true, categoria: 'Chocolates', visible_cat: 'Ambos', precio_oferta: null, fecha_oferta: null, cant_pack: 0, precio_pack: 0, dueno: 'Jony', moneda: '$', unidades_por_paquete: 1, peso: 0, etiqueta: '', vinculo: '', hashgaja: '', kosher_tipo: '', jalav: '' });
const PRODUCTOS = [P('1', 'Chocolate Elite', 10, 9000), P('2', 'Bon O Bon', 5, 5000)];

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const INDEX = 'http://127.0.0.1:' + server.address().port + '/';
  const b = await chromium.launch();
  // Un visitante de Tel Aviv, en hebreo, desde un iPhone: así se ve la diferencia.
  const ctx = await b.newContext({ timezoneId: 'Asia/Jerusalem', locale: 'he-IL', viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' });
  const pg = await ctx.newPage();
  await pg.addInitScript(() => { window.supabase = { createClient: () => ({ auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) } }) }; });
  const tracks = [];
  const errs = [];
  pg.on('pageerror', e => errs.push(e.message));
  await pg.route('**/*', route => {
    const u = route.request().url();
    if (u.includes('accion=track')) { tracks.push(u); return route.fulfill({ contentType: 'application/json', body: '{"ok":true}' }); }
    if (u.includes('/rest/v1/productos')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify(PRODUCTOS) });
    if (u.includes('getEstadoTienda')) return route.fulfill({ contentType: 'application/json', body: '{"estado":"abierta","mensaje":"","aviso":""}' });
    if (u.includes('ipapi')) return route.fulfill({ contentType: 'application/json', body: '{"city":"Tel Aviv","region":"TA","country_name":"Israel"}' });
    if (u.includes('_geocheck')) return route.continue();   // lo contesta el servidor local
    if (u.includes('supabase') || u.includes('qrserver')) return route.fulfill({ contentType: 'application/json', body: '[]' });
    return route.continue();
  });
  await pg.goto(INDEX, { waitUntil: 'domcontentloaded' });
  await pg.waitForTimeout(1800);

  const checks = [];
  const ok = (n, c) => checks.push({ n, ok: !!c });
  const evento = e => tracks.filter(u => u.includes('evento=' + e)).pop();
  const jsonDe = u => { try { return JSON.parse(new URL(u).searchParams.get('producto') || '{}'); } catch { return {}; } };

  const visita = evento('visita');
  ok('la visita se registra', !!visita);
  const f = jsonDe(visita);
  ok('dice en qué huso horario está DE VERDAD', f.tz === 'Asia/Jerusalem');
  ok('dice en qué idioma lee', (f.idi || '').startsWith('he'));
  ok('dice con qué aparato entró', f.ap === 'iPhone');
  ok('dice el tamaño de la pantalla', /^\d+x\d+$/.test(f.px || ''));
  ok('sabe si la pantalla es táctil', f.toq === 1);
  ok('sabe si tiene la tienda instalada', typeof f.pwa === 'number');
  ok('sabe si acepta notificaciones', typeof f.push === 'number');
  ok('guarda la hora local del visitante', typeof f.hl === 'number');

  // 🌎 Como el navegador dice Israel, la tienda le pregunta al candado qué vio ÉL
  const geo = evento('geo');
  ok('detecta que dice estar afuera y consulta al candado', !!geo);
  if (geo) {
    const det = new URL(geo).searchParams.get('producto') || '';
    ok('y anota la discrepancia (navegador Israel vs candado AR)', det.includes('Israel') && det.includes('AR'));
  }

  // ⏱️ Se queda un rato y toca cosas
  await pg.evaluate(() => { const a = productos[0].id; cantidades[a] = 1; agregarAlCarrito(a); });
  await pg.evaluate(() => setCategoria('Chocolates'));
  await pg.evaluate(() => abrirCarrito());
  await pg.waitForTimeout(1200);
  await pg.evaluate(() => { _entroA = Date.now() - 45000; document.dispatchEvent(new Event('visibilitychange')); Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await pg.waitForTimeout(700);
  const salida = evento('salida');
  ok('cuando se va, registra cuánto se quedó', !!salida);
  if (salida) {
    const s = jsonDe(salida);
    ok('el tiempo es real (45 s, no cero)', s.seg >= 40 && s.seg <= 60);
    ok('cuenta cuántas cosas tocó (carrito + categoría + abrir carrito)', s.int >= 3);
    ok('y cuántos productos distintos miró', s.prod >= 1);
  }
  const antes = tracks.filter(u => u.includes('evento=salida')).length;
  await pg.evaluate(() => _mandarSalida());
  ok('no manda la salida dos veces', tracks.filter(u => u.includes('evento=salida')).length === antes);

  ok('sin errores de JavaScript', errs.length === 0);

  let fail = 0;
  console.log('\n── ficha técnica del visitante ─────────────');
  checks.forEach(c => { if (!c.ok) fail++; console.log('  ' + (c.ok ? '✓' : '✗ FALLÓ —') + ' ' + c.n); });
  if (errs.length) console.log('  errores:', errs.slice(0, 3));
  console.log(fail === 0 ? `\n✅ TODO VERDE — ${checks.length} controles` : `\n❌ ${fail} de ${checks.length} FALLARON`);
  await b.close();
  server.close();
  process.exit(fail ? 1 : 0);
})();
