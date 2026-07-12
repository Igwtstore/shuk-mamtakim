// Reproduce la fuga que vio Miri: exporta ventas mezcladas y verifica que en vista Miri
// el CSV NO deja pasar NADA de Jony (ni venta 100% Pitzujim, ni líneas de Jony, ni columnas).
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
    // productos mock: uno de Jony (Pitzujim) y uno de Miri (golosina)
    productos = [{ nombre: 'Pitzujim Especial', dueno: 'Jony' }, { nombre: 'Chocolate Elite', dueno: 'Miri' }];
    const ventas = [
      { nVenta: 901, fecha: '01/07/2026', cliente: 'ClienteSoloJONY', tipo: 'Mayorista',
        productos: '• 3x Pitzujim Especial — $300', formaPago: 'Efectivo', estado: 'entregado',
        totalARS: 300, totalUSD: 0, arsJONY: 300, arsMyri: 0, usdMyri: 0, comiARS: 0, comiUSD: 0 },
      { nVenta: 902, fecha: '02/07/2026', cliente: 'ClienteMIXTO', tipo: 'Minorista',
        productos: '• 2x Pitzujim Especial — $200||• 1x Chocolate Elite — $150', formaPago: 'Efectivo', estado: 'entregado',
        totalARS: 350, totalUSD: 0, arsJONY: 200, arsMyri: 150, usdMyri: 0, comiARS: 22, comiUSD: 0 },
      { nVenta: 903, fecha: '03/07/2026', cliente: 'ClienteSoloMIRI', tipo: 'Minorista',
        productos: '• 1x Chocolate Elite — $150', formaPago: 'Efectivo', estado: 'entregado',
        totalARS: 150, totalUSD: 0, arsJONY: 0, arsMyri: 150, usdMyri: 0, comiARS: 22, comiUSD: 0 },
    ];
    vistaSocio = 'miri';  const csvMiri = _ventasACsv(ventas, true);
    vistaSocio = 'todo';  const csvTodo = _ventasACsv(ventas, false);
    return { csvMiri, csvTodo };
  });

  console.log('\n===== VISTA MIRI (lo que Miri puede exportar) =====');
  console.log(r.csvMiri.split('\n').map(l => '   ' + l).join('\n'));
  console.log('\n— La fuga está tapada —');
  chk('NO aparece la venta 100% Jony (ClienteSoloJONY)', !r.csvMiri.includes('ClienteSoloJONY'));
  chk('NO aparece NINGÚN producto de Jony (Pitzujim)', !/pitzujim/i.test(r.csvMiri));
  chk('NO aparece la columna ARS Jony', !r.csvMiri.includes('ARS Jony'));
  chk('NO aparece la columna de comisión (Comi)', !r.csvMiri.includes('Comi'));
  chk('SÍ aparece lo de Miri (ClienteSoloMIRI + Chocolate Elite)', r.csvMiri.includes('ClienteSoloMIRI') && r.csvMiri.includes('Chocolate Elite'));
  chk('la venta MIXTA aparece pero SOLO con la golosina (sin la línea Pitzujim)', r.csvMiri.includes('ClienteMIXTO') && r.csvMiri.includes('Chocolate Elite') && !r.csvMiri.match(/ClienteMIXTO[^\n]*Pitzujim/i));

  console.log('\n— Vista Todo (admin) sigue completa —');
  chk('vista Todo SÍ trae todo (ClienteSoloJONY + Pitzujim + ARS Jony)', r.csvTodo.includes('ClienteSoloJONY') && /pitzujim/i.test(r.csvTodo) && r.csvTodo.includes('ARS Jony'));

  await browser.close();
  console.log(fail ? '\n❌ ' + fail + ' FALLO(S) — la fuga NO está tapada' : '\n✅ FUGA TAPADA — ' + ok + '/' + ok + ' checks, Miri no ve NADA de Jony en el CSV');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('EXPLOTÓ:', e.message); process.exit(1); });
