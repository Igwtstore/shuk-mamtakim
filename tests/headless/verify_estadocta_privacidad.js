// Verifica que el "Estado de cuenta completo" por cliente, en vista Miri, no muestre NADA
// de Jony (ni pedidos 100% Pitzujim, ni líneas de Jony, ni el total mezclado, ni la parte
// Pitzujim de los pagos). Mockea apiGet y solo inspecciona window._estadoCta.
const { chromium } = require('playwright');
let ok = 0, fail = 0;
const chk = (n, c, x) => { if (c) { ok++; console.log('  ✓', n); } else { fail++; console.log('  ✗ FALLO:', n, x || ''); } };
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on('pageerror', e => { if (!/net::|fetch|resource|onesignal/i.test(e.message)) console.log('  PAGEERROR:', e.message); });
  await page.goto('http://localhost:8917/index.html', { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(1200);

  const run = async (vista) => page.evaluate(async (vistaSel) => {
    window.apiGet = async (accion) => {
      if (accion === 'ventas') return [
        { nVenta: 801, cliente: 'ClienteTEST', fecha: '01/07/2026', estado: 'entregado',
          productos: '• 2x Pitzujim Especial — $ 200 c/u = $ 400||• 1x Chocolate Elite — $ 150 c/u = $ 150',
          totalARS: 550, totalUSD: 0, arsJONY: 400, arsMyri: 150, usdMyri: 0, comiARS: 22 },
        { nVenta: 802, cliente: 'ClienteTEST', fecha: '02/07/2026', estado: 'entregado',
          productos: '• 3x Pitzujim Especial — $ 300 c/u = $ 900',
          totalARS: 900, totalUSD: 0, arsJONY: 900, arsMyri: 0, usdMyri: 0 },
      ];
      if (accion === 'getPagos') return [
        { cliente: 'ClienteTEST', fecha: '03/07/2026', montoARS: 500, montoUSD: 0, montoPitz: 300, montoPitzUsd: 0, caja: 'MP_GABY', nota: '' },
      ];
      return [];
    };
    productos = [{ nombre: 'Pitzujim Especial', dueno: 'Jony' }, { nombre: 'Chocolate Elite', dueno: 'Miri' }];
    window._renderEstadoCta = () => {};
    window.showToast = () => {};
    vistaSocio = vistaSel;
    await abrirEstadoCuenta('ClienteTEST');
    return window._estadoCta;
  }, vista);

  const miri = await run('miri');
  const dump = JSON.stringify(miri.movs);
  console.log('\n===== ESTADO DE CUENTA en VISTA MIRI =====');
  miri.movs.forEach(m => console.log('   ' + m.fecha + ' · ' + m.concepto + ' · $' + m.ars + (m.usd ? ' / U$S' + m.usd : '') + ' (saldo $' + Math.round(m.sA) + ')'));
  console.log('\n— Sin nada de Jony —');
  chk('NO aparece ningún Pitzujim en el estado', !/pitzujim/i.test(dump));
  chk('NO aparece el pedido 100% Jony (#802)', !/#802/.test(dump));
  chk('el pedido mixto (#801) figura con el monto de MIRI ($150), no el total ($550)',
    miri.movs.some(m => /#801/.test(m.concepto) && m.tipo === 'pedido' && Math.round(m.ars) === 150) && !dump.includes('550'));
  chk('el pago figura con la parte de Miri ($200 = 500−300 Pitz), no $500',
    miri.movs.some(m => m.tipo === 'pago' && Math.round(m.ars) === 200) && !miri.movs.some(m => m.tipo === 'pago' && Math.round(m.ars) === 500));

  const todo = await run('todo');
  const dumpT = JSON.stringify(todo.movs);
  console.log('\n— Vista Todo (admin) ve todo —');
  chk('vista Todo SÍ trae Pitzujim, el #802 y el total mezclado ($550)', /pitzujim/i.test(dumpT) && /#802/.test(dumpT) && dumpT.includes('550'));

  await browser.close();
  console.log(fail ? '\n❌ ' + fail + ' FALLO(S)' : '\n✅ ESTADO DE CUENTA OK — ' + ok + '/' + ok + ' checks, en vista Miri no se filtra nada de Jony');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('EXPLOTÓ:', e.message); process.exit(1); });
