// v3.68 — (1) recepción muestra LA CUENTA del ponderado; (2) estado de cuenta con crédito
// muestra 💚 SALDO A FAVOR (verde); (3) la lista de deudores muestra a los "a favor" en verde.
const { chromium } = require('playwright');
let ok = 0, fail = 0;
const chk = (n, c, x) => { if (c) { ok++; console.log('  ✓', n); } else { fail++; console.log('  ✗ FALLO:', n, x || ''); } };
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => { if (!/net::|fetch|resource|onesignal/i.test(e.message)) errs.push(e.message); });
  await page.goto('http://localhost:8917/index.html', { waitUntil: 'load', timeout: 30000 });
  await page.waitForSelector('.producto-card', { timeout: 30000 });
  await page.waitForTimeout(1500);

  const r = await page.evaluate(async () => {
    const out = {};
    // ── 1) RECEPCIÓN: la cuenta del ponderado en el alert ──
    let alerta = ''; window.alert = (m) => { alerta = m; };
    productos.push({ id: 9901, nombre: 'Toffee TEST', dueno: 'Jony', moneda: 'U$S', stock: 2, costo: 10 });
    _recepSel = { 9901: { cantidad: '3', costo: '12.94' } };
    const postOrig = window._postSesion;
    window._postSesion = async () => ({ ok: true, items: [{ id: 9901, nombre: 'Toffee TEST', stock: 5, costoAnterior: 10, costoNuevo: 11.76 }] });
    const cargarOrig = window.cargarProductos; window.cargarProductos = async () => {};
    await registrarRecepcion(null);
    window._postSesion = postOrig; window.cargarProductos = cargarOrig;
    productos = productos.filter(p => p.id !== 9901);
    out.cuentaRecep = alerta.includes('tenías 2 a U$S 10.00') && alerta.includes('entraron 3 a U$S 12.94') && alerta.includes('nuevo costo U$S 11.76') && alerta.includes('ponderado');

    // ── 2) ESTADO DE CUENTA con crédito → banda verde 💚 ──
    window._estadoCta = { cliente: 'Sarah Kantor', emitido: '12/07/2026', tel: '', saldoARS: 0, saldoUSD: -12.83,
      movs: [{ ts: 1, fecha: '12/07/2026', tipo: 'pago', concepto: 'Pago a cuenta', ars: 0, usd: 12.83, signo: -1, sA: 0, sU: -12.83 }] };
    _renderEstadoCta();
    const doc = document.getElementById('estadocta-doc');
    const html = doc ? doc.innerHTML : '';
    out.aFavorBanda = html.includes('SALDO A FAVOR') && html.includes('U$S 12.83') && !html.includes('SALDO ACTUAL');
    out.aFavorNota = html.includes('se descuenta solo de la próxima compra');
    out.aFavorVerde = /background:\s*#e8f5ee[^>]*>\s*<span>💚 SALDO A FAVOR/.test(html.replace(/\n/g, ' '));

    // ── 3) LISTA DE DEUDORES: Sarah a favor en verde + no cuenta como deudora ──
    const V = [
      { id: 'P51', nVenta: 51, cliente: 'Sarah Kantor', fecha: '07/07/2026', estado: 'pendiente', tipo: 'Mayorista', productos: '• 1x X — $ 100 c/u = $ 100', totalARS: 100350, totalUSD: 121.15, arsJONY: 100350, arsMyri: 0, usdMyri: 44, usdJONY: 77.15 },
      { id: 'P60', nVenta: 60, cliente: 'Deudor Real', fecha: '10/07/2026', estado: 'pendiente', tipo: 'Mayorista', productos: '• 1x Y — $ 100 c/u = $ 100', totalARS: 50000, totalUSD: 0, arsJONY: 0, arsMyri: 50000, usdMyri: 0, usdJONY: 0 },
    ];
    const P = [
      { cliente: 'Sarah Kantor', pedidoId: 'P51', fecha: '12/07/2026', montoARS: 100350, montoUSD: 121.15, montoPitz: 100350, montoPitzUsd: 77.15, caja: 'ETF_USD_JONY', tc: 1520 },
      { cliente: 'Sarah Kantor', pedidoId: '', fecha: '12/07/2026', montoARS: 0, montoUSD: 12.83, montoPitz: 0, montoPitzUsd: 0, caja: 'ETF_USD_JONY', tc: 0 },
    ];
    const origApi = window.apiGet;
    window.apiGet = async (a) => a === 'ventas' ? V : (a === 'getPagos' ? P : []);
    vistaSocio = 'todo';
    await renderCuentaCorriente();
    window.apiGet = origApi;
    const cc = document.getElementById('cc-lista').innerHTML;
    out.sarahVerde = cc.includes('Sarah Kantor') && cc.includes('💚 A favor: U$S 12.83');
    out.sinRecordarAFavor = !/Sarah[\s\S]{0,700}?Recordar/.test(cc);
    out.badge = document.getElementById('cc-total-badge').textContent;
    out.badgeSoloDeudores = out.badge.includes('1 deudor');
    out.deudorRealRojo = cc.includes('Deudor Real') && cc.includes('$ 50.000');
    return out;
  });

  chk('recepción: el alert muestra LA CUENTA (2 a 10 + 3 a 12,94 → 11,76 ponderado)', r.cuentaRecep);
  chk('estado de cuenta: banda 💚 SALDO A FAVOR con U$S 12,83 (no "SALDO ACTUAL" rojo)', r.aFavorBanda);
  chk('  · con la nota "se descuenta solo de la próxima compra"', r.aFavorNota);
  chk('  · en verde de verdad', r.aFavorVerde);
  chk('deudores: Sarah aparece en VERDE con 💚 A favor: U$S 12,83', r.sarahVerde);
  chk('  · sin botón Recordar (no hay nada que reclamarle)', r.sinRecordarAFavor);
  chk('  · el contador dice "1 deudor" (Sarah no cuenta): ' + r.badge, r.badgeSoloDeudores);
  chk('  · el deudor real sigue en rojo con su monto', r.deudorRealRojo);
  chk('sin errores JS', errs.length === 0, errs.join(' | '));

  await browser.close();
  console.log(fail ? '\n❌ ' + fail + ' FALLO(S)' : '\n✅ PONDERADO VISIBLE + SALDO A FAVOR OK — ' + ok + '/' + ok);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('EXPLOTÓ:', e.message); process.exit(1); });
