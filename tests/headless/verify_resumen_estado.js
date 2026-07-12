// "Mi resumen": cada venta con su estado — Sarah (100% sin cobrar) → "cta cte";
// parcial → "debe X"; cobrada → "✓". Y el aviso arriba de "no es plata en mano".
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
    productos = [{ nombre: 'Chocolate Elite', dueno: 'Miri' }];
    const ventas = [
      { id: 'V51', nVenta: 51, cliente: 'Sarah TEST', fecha: '07/07/2026', estado: 'pendiente',
        productos: '• 1x Chocolate Elite — U$S 44.00 c/u = U$S 44.00', arsMyri: 0, usdMyri: 44, arsJONY: 0, usdJONY: 0 },
      { id: 'V60', nVenta: 60, cliente: 'Parcial TEST', fecha: '06/07/2026', estado: 'entregado',
        productos: '• 1x Chocolate Elite — $ 10.000 c/u = $ 10.000', arsMyri: 10000, usdMyri: 0, arsJONY: 0, usdJONY: 0 },
      { id: 'V61', nVenta: 61, cliente: 'Cobrada TEST', fecha: '05/07/2026', estado: 'entregado',
        productos: '• 1x Chocolate Elite — $ 5.000 c/u = $ 5.000', arsMyri: 5000, usdMyri: 0, arsJONY: 0, usdJONY: 0 },
    ];
    const ccData = {
      a: { totalARS: 4000, totalUSD: 44, items: [
        { v: ventas[0], remARS: 0, remUSD: 44 },
        { v: ventas[1], remARS: 4000, remUSD: 0 },
        { v: ventas[2], remARS: 0, remUSD: 0 },
      ] },
    };
    const R = _resumenMiriCalc(ventas, [], {}, { ars: 0, usd: 0 }, ccData);
    return { html: _resumenMiriHTML(R), nSinCobrar: R.nSinCobrar };
  });
  chk('Sarah (100% sin cobrar) → chip "cta cte — sin cobrar"', /#51[\s\S]{0,500}cta cte — sin cobrar/.test(r.html));
  chk('la parcial → chip "debe $ 4.000"', /#60[\s\S]{0,500}debe \$ 4\.000/.test(r.html));
  chk('la cobrada → chip "✓ cobrada"', /#61[\s\S]{0,500}✓ cobrada/.test(r.html));
  chk('cuenta 2 sin cobrar del todo', r.nSinCobrar === 2 && /2 sin cobrar del todo/.test(r.html), r.nSinCobrar);
  chk('aviso arriba: "$ 4.000 + U$S 44 en cuenta corriente (no es plata en mano)"', /Ojo: de esto, \$ 4\.000\s+\+\s+U\$S 44\.00 todavía está en cuenta corriente/.test(r.html));
  await browser.close();
  console.log(fail ? '\n❌ ' + fail + ' FALLO(S)' : '\n✅ ESTADO POR VENTA OK — ' + ok + '/' + ok);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('EXPLOTÓ:', e.message); process.exit(1); });
