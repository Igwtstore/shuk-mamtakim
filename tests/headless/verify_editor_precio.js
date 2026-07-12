// Verifica que abrir el editor de pedido RESPETA el precio especial guardado (no lo reprecia
// al mayorista del catálogo), y que SÍ repara un renglón que quedó sin precio.
const { chromium } = require('playwright');
let ok = 0, fail = 0;
const chk = (n, c, x) => { if (c) { ok++; console.log('  ✓', n); } else { fail++; console.log('  ✗ FALLO:', n, x || ''); } };
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on('pageerror', e => { if (!/net::|fetch|resource|onesignal/i.test(e.message)) {/* editor toca DOM: se ignora */} });
  await page.goto('http://localhost:8917/index.html', { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(1200);

  const r = await page.evaluate(() => {
    // Catálogo: un Pitzujim cuyo MAYORISTA ($7.100) difiere del precio especial guardado ($10.800);
    // y un producto sin precio (para probar la reparación).
    productos = [
      { id: '100', nombre: 'Pitzujim-Test', desc: 'Manies especiales 100g', precioMay: '7100', precioMin: '12000', moneda: '$', dueno: 'Jony' },
      { id: '101', nombre: 'Golosina-SinPrecio', desc: 'algo', precioMay: '5000', precioMin: '6000', moneda: '$', dueno: 'Miri' },
    ];
    // Pedido MAYORISTA con un Pitzujim a precio ESPECIAL ($10.800) y un renglón sin precio ($0).
    const v = { id: 'PTEST', nVenta: 999, cliente: 'TEST', tipo: 'Mayorista',
      productos: '• 1x Pitzujim-Test · Manies especiales 100g — $ 10.800 c/u = $ 10.800 || • 1x Golosina-SinPrecio · algo — $ 0 c/u = $ 0' };
    try { abrirEditarPedido(v); } catch (e) { /* falla en el DOM del modal, pero _editLineas ya se calculó */ }
    return (typeof _editLineas !== 'undefined') ? _editLineas.map(l => ({ nombre: l.nombre, precio: l.precio, moneda: l.moneda, prodId: l.prodId })) : null;
  });

  console.log('\nRenglones tras abrir el editor:');
  (r || []).forEach(l => console.log('   ' + l.nombre + ' → ' + l.moneda + ' ' + l.precio + ' (prodId ' + l.prodId + ')'));
  const pitz = (r || []).find(l => l.nombre === 'Pitzujim-Test');
  const sinp = (r || []).find(l => l.nombre === 'Golosina-SinPrecio');
  console.log('');
  chk('RESPETA el precio especial guardado ($10.800, NO el mayorista $7.100)', pitz && pitz.precio === 10800, pitz && pitz.precio);
  chk('el renglón sin precio SÍ se repara desde el catálogo ($5.000)', sinp && sinp.precio === 5000, sinp && sinp.precio);

  await browser.close();
  console.log(fail ? '\n❌ ' + fail + ' FALLO(S)' : '\n✅ EDITOR OK — ' + ok + '/' + ok + ', respeta los precios especiales y repara los vacíos');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('EXPLOTÓ:', e.message); process.exit(1); });
