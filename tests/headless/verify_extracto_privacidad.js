// Verifica que el "Extracto de caja" descargable NO deja ver movimientos de Jony en vista Miri,
// aun si un movimiento de Jony (Pitzujim/comisión) cayó en una caja compartida (Cta Cte).
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
    // Usar los elementos REALES del panel (ya existen; no duplicar ids)
    const sel = document.getElementById('extracto-caja');
    sel.innerHTML = '<option value="CTA_CTE_ARS" selected>Cta Cte $</option>';
    sel.value = 'CTA_CTE_ARS';
    document.getElementById('extracto-desde').value = '';
    document.getElementById('extracto-hasta').value = '';
    // Movimientos en la MISMA caja Cta Cte $: uno de Jony (Pitzujim), una comisión, y uno de Miri.
    window._cajaMovsExtracto = [
      { desc: 'Pend. cobro #901 Pitzujim de JONY', col: 'CTA_CTE_ARS', val: 5000, mon: 'ARS', tipo: 'venta', dueno: 'J' },
      { desc: 'comisión de JONY', col: 'CTA_CTE_ARS', val: 300, mon: 'ARS', tipo: 'comi' },
      { desc: 'Pend. cobro #903 golosinas de MIRI', col: 'CTA_CTE_ARS', val: 2000, mon: 'ARS', tipo: 'venta' },
    ];
    vistaSocio = vistaSel;
    let captured = null;
    const origCreate = URL.createObjectURL, origClick = HTMLAnchorElement.prototype.click;
    URL.createObjectURL = (b) => { captured = b; return 'blob:x'; };
    HTMLAnchorElement.prototype.click = function () {};
    try { exportarExtractoCaja(); } catch (e) { return 'ERROR: ' + e.message; }
    URL.createObjectURL = origCreate; HTMLAnchorElement.prototype.click = origClick;
    return captured ? await captured.text() : '(no generó CSV)';
  }, vista);

  const csvMiri = await run('miri');
  console.log('\n===== EXTRACTO "Cta Cte $" en VISTA MIRI =====');
  console.log(csvMiri.split('\n').map(l => '   ' + l).join('\n'));
  console.log('\n— La fuga del extracto está tapada —');
  chk('NO aparece el Pitzujim de Jony (#901)', !csvMiri.includes('901') && !/pitzujim/i.test(csvMiri));
  chk('NO aparece la comisión de Jony', !/comisi/i.test(csvMiri));
  chk('SÍ aparece lo de Miri (#903 golosinas)', csvMiri.includes('903') && /miri/i.test(csvMiri));

  const csvTodo = await run('todo');
  console.log('\n— Vista Todo (admin) ve todo —');
  chk('vista Todo SÍ trae el Pitzujim de Jony y la comisión', /pitzujim/i.test(csvTodo) && /comisi/i.test(csvTodo) && csvTodo.includes('903'));

  await browser.close();
  console.log(fail ? '\n❌ ' + fail + ' FALLO(S)' : '\n✅ EXTRACTO OK — ' + ok + '/' + ok + ' checks, Miri no ve movimientos de Jony ni en el extracto');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('EXPLOTÓ:', e.message); process.exit(1); });
