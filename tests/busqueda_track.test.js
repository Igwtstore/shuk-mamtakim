// 🔎 ¿La tienda registra de verdad lo que buscan, con cuántos resultados les salió?
// Se escribe en el buscador REAL de la tienda y se espía la llamada (interceptada: no
// llega a producción, no ensucia los datos).
// Uso: node tests/busqueda_track.test.js
const { chromium } = require('playwright');
const path = require('path');
const INDEX = 'file://' + path.resolve(__dirname, '..', 'index.html');

const PRODUCTOS = [
  { id: '1', nombre: 'Chocolate Elite', descripcion: 'con leche', precio_may: '5', precio_min: 9000, stock: 10, imagen: '', activo: true, categoria: 'Chocolates', visible_cat: 'Ambos', precio_oferta: null, fecha_oferta: null, cant_pack: 0, precio_pack: 0, dueno: 'Jony', moneda: '$', unidades_por_paquete: 1, peso: 0, etiqueta: '', vinculo: '', hashgaja: '', kosher_tipo: '', jalav: '' },
  { id: '2', nombre: 'Bon O Bon', descripcion: 'bombones', precio_may: '4', precio_min: 5000, stock: 5, imagen: '', activo: true, categoria: 'Chocolates', visible_cat: 'Ambos', precio_oferta: null, fecha_oferta: null, cant_pack: 0, precio_pack: 0, dueno: 'Jony', moneda: '$', unidades_por_paquete: 1, peso: 0, etiqueta: '', vinculo: '', hashgaja: '', kosher_tipo: '', jalav: '' },
];

(async () => {
  const b = await chromium.launch();
  const pg = await b.newPage();
  await pg.addInitScript(() => {
    window.supabase = { createClient: () => ({ auth: {
      getSession: async () => ({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } })
    } }) };
    try { localStorage.clear(); } catch {}
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
    if (u.includes('supabase') || u.includes('qrserver')) return route.fulfill({ contentType: 'application/json', body: '[]' });
    return route.continue();
  });
  await pg.goto(INDEX, { waitUntil: 'domcontentloaded' });
  await pg.waitForTimeout(1200);

  const checks = [];
  const ok = (n, c) => checks.push({ n, ok: !!c });
  // `productos` es un `let` del script, no cuelga de window: hay que leerlo por nombre.
  ok('la tienda cargó el catálogo de prueba', await pg.evaluate(() => productos.length) === 2);

  const buscar = async texto => {
    await pg.fill('#buscador', texto);
    await pg.evaluate(() => filtrar());
    await pg.waitForTimeout(1700);   // el registro espera 1,2 s de silencio
  };

  await buscar('ch');
  ok('1 o 2 letras NO se registran (ruido de tipeo)', !tracks.some(u => u.includes('evento=busqueda')));

  await buscar('chocolate');
  const b1 = tracks.filter(u => u.includes('evento=busqueda')).pop();
  ok('una búsqueda con resultados SÍ se registra', !!b1);
  if (b1) {
    const q = new URL(b1).searchParams;
    ok('guarda lo que escribieron', q.get('producto') === 'chocolate');
    ok('guarda cuántos resultados le salieron (1)', q.get('total') === '1');
  }

  const antes = tracks.filter(u => u.includes('evento=busqueda')).length;
  await buscar('chocolate');
  ok('la misma búsqueda no se registra dos veces', tracks.filter(u => u.includes('evento=busqueda')).length === antes);

  await buscar('halva');
  const b2 = tracks.filter(u => u.includes('evento=busqueda')).pop();
  const q2 = b2 ? new URL(b2).searchParams : null;
  ok('la búsqueda SIN resultados también se registra', q2 && q2.get('producto') === 'halva');
  ok('y queda marcada con 0 resultados (eso es un pedido de compra)', q2 && q2.get('total') === '0');

  // El navegador del equipo no debe ensuciar la analítica
  await pg.evaluate(() => localStorage.setItem('shuk_no_track', '1'));
  const antes2 = tracks.length;
  await buscar('bon o bon');
  ok('el navegador del equipo (panel) NO registra búsquedas', tracks.length === antes2);

  ok('sin errores de JavaScript', errs.length === 0);

  let fail = 0;
  console.log('\n── registro de búsquedas en la tienda ─────────────');
  checks.forEach(c => { if (!c.ok) fail++; console.log('  ' + (c.ok ? '✓' : '✗ FALLÓ —') + ' ' + c.n); });
  if (errs.length) console.log('  errores:', errs.slice(0, 3));
  console.log(fail === 0 ? `\n✅ TODO VERDE — ${checks.length} controles` : `\n❌ ${fail} de ${checks.length} FALLARON`);
  await b.close();
  process.exit(fail ? 1 : 0);
})();
