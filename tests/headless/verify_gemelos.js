// BLINDAJE GEMELOS: dos productos con nombre Y descripción IDÉNTICOS (ni un punto de
// diferencia), uno de Miri (#68) y uno de Jony (#153). El editor debe elegir el que la
// venta REALMENTE descontó (stock_updates), sin importar el orden del catálogo.
const { chromium } = require('playwright');
let ok = 0, fail = 0;
const chk = (n, c, x) => { if (c) { ok++; console.log('  ✓', n); } else { fail++; console.log('  ✗ FALLO:', n, x || ''); } };
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('http://localhost:8917/index.html', { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(1200);

  const probar = (ordenCatalogo, su) => page.evaluate(({ ordenCatalogo, su }) => {
    const miri = { id: '68', nombre: 'Klik Kukiman GEMELO', desc: 'Cereales crocantes idénticos', dueno: 'Miri', precioMay: '5000', precioMin: '6000', moneda: '$', stock: 3 };
    const jony = { id: '153', nombre: 'Klik Kukiman GEMELO', desc: 'Cereales crocantes idénticos', dueno: 'Jony', precioMay: '5000', precioMin: '6000', moneda: '$', stock: 3 };
    productos = ordenCatalogo === 'miriPrimero' ? [miri, jony] : [jony, miri];
    const v = { id: 'PG', nVenta: 900, cliente: 'GemeloTEST', tipo: 'Minorista', stockUpdates: su,
      productos: '• 2x Klik Kukiman GEMELO · Cereales crocantes idénticos — $ 6.000 c/u = $ 12.000' };
    try { abrirEditarPedido(v); } catch (e) { /* DOM del modal puede fallar; _editLineas ya está */ }
    return _editLineas.map(l => ({ prodId: l.prodId }))[0];
  }, { ordenCatalogo, su });

  let r = await probar('miriPrimero', '153:2');   // la venta fue del de JONY, pero Miri está primera en el catálogo
  chk('venta de JONY (#153) con Miri primera en catálogo → elige #153 (el ID manda)', r && r.prodId === '153', JSON.stringify(r));
  r = await probar('jonyPrimero', '68:2');        // la venta fue del de MIRI, pero Jony está primero
  chk('venta de MIRI (#68) con Jony primero en catálogo → elige #68 (el ID manda)', r && r.prodId === '68', JSON.stringify(r));
  r = await probar('miriPrimero', '68:2');
  chk('venta de MIRI con Miri primera → #68 (sin regresión)', r && r.prodId === '68', JSON.stringify(r));
  r = await probar('jonyPrimero', '');            // venta vieja SIN stockUpdates → desempates de siempre (no rompe)
  chk('venta vieja sin stock_updates → sigue matcheando (alguno de los dos, sin crash)', r && (r.prodId === '68' || r.prodId === '153'), JSON.stringify(r));

  await browser.close();
  console.log(fail ? '\n❌ ' + fail + ' FALLO(S)' : '\n✅ GEMELOS OK — ' + ok + '/' + ok + ': con nombre idéntico, el ID de la venta decide');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('EXPLOTÓ:', e.message); process.exit(1); });
