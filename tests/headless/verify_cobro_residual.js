// Caso Moshe #47: pedido U$S 432,50 (todo Jony) con pago a cuenta de U$S 320 atado.
// El botón "Confirmar cobro" de la tarjeta debe precargar SOLO el resto (112,50), no el total.
const { chromium } = require('playwright');
let ok = 0, fail = 0;
const chk = (n, c, x) => { if (c) { ok++; console.log('  ✓', n); } else { fail++; console.log('  ✗ FALLO:', n, x || ''); } };
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on('pageerror', e => { if (!/net::|fetch|resource|onesignal/i.test(e.message)) console.log('  PAGEERROR:', e.message); });
  await page.goto('http://localhost:8917/index.html', { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(1200);

  const r = await page.evaluate(async () => {
    const V = [
      { id: 'PM47', nVenta: 47, cliente: 'Moshe TEST', fecha: '05/07/2026 20:14', estado: 'pendiente', tipo: 'Mayorista',
        productos: '• 6x Tableta chocolate — U$S 6.90 c/u = U$S 41.40', formaPago: 'Efectivo',
        totalARS: 0, totalUSD: 432.5, arsJONY: 0, arsMyri: 0, usdMyri: 0, usdJONY: 432.5, comiARS: 0, comiUSD: 0 },
      { id: 'PSIN', nVenta: 48, cliente: 'Otro TEST', fecha: '06/07/2026 10:00', estado: 'pendiente', tipo: 'Minorista',
        productos: '• 1x Chocolate — $ 1.000 c/u = $ 1.000', formaPago: 'Efectivo',
        totalARS: 1000, totalUSD: 0, arsJONY: 0, arsMyri: 1000, usdMyri: 0, usdJONY: 0 },
    ];
    const P = [
      { cliente: 'Moshe TEST', pedidoId: 'PM47', fecha: '06/07/2026', montoARS: 0, montoUSD: 320, montoPitz: 0, montoPitzUsd: 320, caja: 'ETF_USD_JONY' },
    ];
    const origApi = window.apiGet;
    window.apiGet = async (a) => a === 'ventas' ? V : (a === 'getPagos' ? P : (origApi ? origApi(a) : []));
    productos = [{ nombre: 'Tableta chocolate', dueno: 'Jony' }, { nombre: 'Chocolate', dueno: 'Miri' }];
    vistaSocio = 'todo';
    await renderPedidos();
    window.apiGet = origApi;
    const html = document.getElementById('pedidos-lista').innerHTML;
    const mResidual = html.match(/abrirConfirmarCobroResidual\('PM47',([\d.]+),([\d.]+),([\d.]+),'[^']*',([\d.]+),([\d.]+),([\d.]+),([\d.]+),([\d.]+)\)/);
    return {
      tieneResto: /Confirmar cobro \(el resto\)/.test(html),
      args: mResidual ? mResidual.slice(1).map(Number) : null,
      normalIntacto: /abrirConfirmarCobro\('PSIN',0,1000,0,'Otro TEST',0\)/.test(html) && !/abrirConfirmarCobroResidual\('PSIN'/.test(html),
    };
  });

  chk('la tarjeta de Moshe muestra "Confirmar cobro (el resto)"', r.tieneResto);
  chk('precarga el RESTO: U$S 112,50 de Jony (no 432,50)', r.args && r.args[3] === 112.5, JSON.stringify(r.args));
  chk('lo cubierto por pagos viaja aparte (320 → tramo Cta Cte, no se pierde)', r.args && r.args[7] === 320, JSON.stringify(r.args));
  chk('un pedido SIN pagos sigue con el botón normal (total completo)', r.normalIntacto);

  await browser.close();
  console.log(fail ? '\n❌ ' + fail + ' FALLO(S)' : '\n✅ COBRO RESIDUAL OK — ' + ok + '/' + ok);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('EXPLOTÓ:', e.message); process.exit(1); });
