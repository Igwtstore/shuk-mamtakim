// Verifica la lógica de "Mi resumen" de Miri: suma correcta, cuadre exacto, cero Jony.
const { chromium } = require('playwright');
let ok = 0, fail = 0;
const chk = (n, c, x) => { if (c) { ok++; console.log('  ✓', n); } else { fail++; console.log('  ✗ FALLO:', n, x || ''); } };
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on('pageerror', e => { if (!/net::|fetch|resource|onesignal/i.test(e.message)) console.log('  PAGEERROR:', e.message); });
  await page.goto('http://localhost:8917/index.html', { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(1200);

  const r = await page.evaluate(() => {
    productos = [{ nombre: 'Pitzujim Especial', dueno: 'Jony' }, { nombre: 'Chocolate Elite', dueno: 'Miri' }];
    const ventas = [
      { nVenta: 801, cliente: 'ClienteMIXTO', fecha: '01/07/2026', estado: 'entregado',
        productos: '• 2x Pitzujim Especial — $ 200 c/u = $ 400||• 1x Chocolate Elite — $ 150 c/u = $ 150',
        totalARS: 550, totalUSD: 0, arsJONY: 400, arsMyri: 150, usdMyri: 0 },
      { nVenta: 802, cliente: 'ClienteSoloMIRI', fecha: '02/07/2026', estado: 'entregado',
        productos: '• 1x Chocolate Elite — $ 200 c/u = $ 200', totalARS: 200, totalUSD: 0, arsJONY: 0, arsMyri: 200, usdMyri: 0 },
      { nVenta: 803, cliente: 'ClienteSoloJONY', fecha: '03/07/2026', estado: 'entregado',
        productos: '• 3x Pitzujim Especial — $ 300 c/u = $ 900', totalARS: 900, totalUSD: 0, arsJONY: 900, arsMyri: 0, usdMyri: 0 },
    ];
    const cajaMovs = [
      { col: 'MP_GABY', val: 300, mon: 'ARS', tipo: 'venta' },
      { col: 'EFT_MYRI', val: 100, mon: 'ARS', tipo: 'venta' },
      { col: 'MP_JONY', val: 9999, mon: 'ARS', tipo: 'venta' },  // caja de Jony → NO debe sumar
    ];
    const ds = { jonyTiene: 50, jonyTieneU: 0 };
    const soc = { ars: 120, usd: 0 };            // le debe a Jony 120
    const ccData = { c1: { totalARS: 80, totalUSD: 0 } };  // te deben 80
    const R = _resumenMiriCalc(ventas, cajaMovs, ds, soc, ccData);
    const html = _resumenMiriHTML(R);
    return { R, html };
  });

  console.log('\n— Suma y cuadre —');
  chk('cuenta 2 ventas de Miri (excluye la 100% Jony)', r.R.vivas.length === 2, 'vivas=' + r.R.vivas.length);
  chk('total vendido = 350 (150 + 200)', r.R.vendARS === 350, 'vendARS=' + r.R.vendARS);
  chk('te deben = 80 (de _ccData)', r.R.debenARS === 80, r.R.debenARS);
  chk('Jony te debe = 50', r.R.jonyDebeARS === 50, r.R.jonyDebeARS);
  chk('ya cobrado = 220 (350 − 80 − 50)', r.R.cobradoARS === 220, r.R.cobradoARS);
  chk('CUADRA: cobrado + deben + jony = vendido', r.R.cobradoARS + r.R.debenARS + r.R.jonyDebeARS === r.R.vendARS);
  chk('caja MP Gaby = 300 (no suma la de Jony)', r.R.porCaja.MP_GABY.ars === 300, JSON.stringify(r.R.porCaja.MP_GABY));

  console.log('\n— Privacidad: nada de Jony en la pantalla —');
  chk('el HTML NO contiene Pitzujim', !/pitzujim/i.test(r.html));
  chk('el HTML NO contiene la venta 100% Jony (ClienteSoloJONY)', !r.html.includes('ClienteSoloJONY'));
  chk('el HTML NO muestra el saldo de la caja de Jony (9999)', !r.html.includes('9.999') && !r.html.includes('9999'));
  chk('SÍ muestra las ventas de Miri (#801 y #802) + "2 ventas"', r.html.includes('#801') && r.html.includes('#802') && r.html.includes('2 ventas'));

  await browser.close();
  console.log(fail ? '\n❌ ' + fail + ' FALLO(S)' : '\n✅ MI RESUMEN OK — ' + ok + '/' + ok + ' checks, suma bien, cuadra y no filtra Jony');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('EXPLOTÓ:', e.message); process.exit(1); });
