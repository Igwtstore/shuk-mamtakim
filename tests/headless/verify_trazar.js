// Caso Bon O Bon Mini Eggs (#57): 6 compras (10 u.) pero movimientos +6/−6, porque las ventas
// #11 y #12 (4 u.) son ANTERIORES al primer movimiento registrado. Debe aparecer el aviso.
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
    productos = [{ id: '57', nombre: 'Bon O Bon · Mini Eggs', dueno: 'Miri', stock: 0, desc: 'Huevitos' }];
    vistaSocio = 'todo';
    const V = [
      { id: 'P11', nVenta: 11, cliente: 'Jaco enzani', fecha: '11/06/2026 13:04', estado: 'entregado', stockUpdates: '57:3', productos: '' },
      { id: 'P12', nVenta: 12, cliente: 'Ezequiel', fecha: '11/06/2026 13:11', estado: 'entregado', stockUpdates: '57:1', productos: '' },
      { id: 'P27', nVenta: 27, cliente: 'Guido', fecha: '24/06/2026 07:05', estado: 'entregado', stockUpdates: '57:1', productos: '' },
    ];
    const MOVS = [
      { fecha: '22/06/2026 14:55', cambio: 6, antes: 0, despues: 6, origen: 'Ajuste manual (pestaña Stock)' },
      { fecha: '24/06/2026 07:05', cambio: -1, antes: 6, despues: 5, origen: 'Venta #27 — Guido' },
    ];
    window.apiGet = async (a) => a === 'ventas' ? V : (String(a).startsWith('movimientosStock') ? MOVS : []);
    document.getElementById('trazar-sel').innerHTML = '<option value="57" selected>Bon O Bon</option>';
    document.getElementById('trazar-sel').value = '57';
    await trazarProducto();
    await new Promise(res => setTimeout(res, 300));
    return { compras: document.getElementById('trazar-result').textContent.slice(0, 200), movs: document.getElementById('trazar-movs').innerHTML };
  });
  chk('las compras suman 5 u. (incluye las previas al registro)', /Total: 5 u/.test(r.compras), r.compras.slice(0, 60));
  chk('APARECE el aviso de compras pre-registro', /ANTES de que existiera este registro/.test(r.movs));
  chk('el aviso detalla quiénes (Jaco 3 u. y Ezequiel 1 u. = 4 u.)', /2 compras \(4 u\.\)/.test(r.movs) && /Jaco enzani 3 u/.test(r.movs) && /Ezequiel 1 u/.test(r.movs));
  chk('aclara que NO falta stock', /No falta stock/.test(r.movs));
  chk('los movimientos siguen listados normal', /Ajuste manual/.test(r.movs) && /Venta #27/.test(r.movs));
  await browser.close();
  console.log(fail ? '\n❌ ' + fail + ' FALLO(S)' : '\n✅ TRAZAR OK — ' + ok + '/' + ok);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('EXPLOTÓ:', e.message); process.exit(1); });
