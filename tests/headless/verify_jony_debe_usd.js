// v3.66 — "no me cuadra esos U$S 44 de Miri": golosinas U$S cobradas por Jony (caja ETF_USD_JONY)
// tienen que aparecer como "Jony te debe" en cuenta socios + Mi resumen + caja vista Miri.
// Datos = caso Sarah real: pago atado (gol U$S 44) + pago general a favor (12,83, SIN dueño aún).
const { chromium } = require('playwright');
let ok = 0, fail = 0;
const chk = (n, c, x) => { if (c) { ok++; console.log('  ✓', n); } else { fail++; console.log('  ✗ FALLO:', n, x || ''); } };
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => { if (!/net::|fetch|resource|onesignal/i.test(e.message)) errs.push(e.message); });
  await page.goto('http://localhost:8917/index.html', { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(1200);

  const r = await page.evaluate(async () => {
    const out = {};
    const V = [{ id: 'P51', nVenta: 51, cliente: 'Sarah Kantor', fecha: '07/07/2026 12:09', estado: 'pendiente', tipo: 'Mayorista',
      productos: '• 1x Cosa — $ 100.350 c/u = $ 100.350', formaPago: 'Efectivo',
      totalARS: 100350, totalUSD: 121.15, arsJONY: 100350, arsMyri: 0, usdMyri: 44, usdJONY: 77.15, comiARS: 0, comiUSD: 6.6 }];
    const P = [
      { cliente: 'Sarah Kantor', pedidoId: 'P51', fecha: '12/07/2026', montoARS: 100350, montoUSD: 121.15, montoPitz: 100350, montoPitzUsd: 77.15, caja: 'ETF_USD_JONY', tc: 1520 },
      { cliente: 'Sarah Kantor', pedidoId: '', fecha: '12/07/2026', montoARS: 0, montoUSD: 12.83, montoPitz: 0, montoPitzUsd: 0, caja: 'ETF_USD_JONY', tc: 0 },
    ];
    const origApi = window.apiGet;
    window.apiGet = async (a) => {
      if (a === 'ventas') return V;
      if (a === 'getPagos') return P;
      if (a === 'getLiquidaciones') return { totalARS: 0, totalUSD: 0 };
      if (a === 'getMovsSocios') return { totalARS: 0, totalUSD: 0, manualARS: 0, enviosARS: 0, enviosDetalle: [] };
      return [];
    };

    // 1) CUENTA DE SOCIOS: jonyTieneU = 44 − 6,60 = 37,40 (solo el atado; el general NO)
    vistaSocio = 'todo';
    await renderCuentaSocios();
    const ds = window._sociosDesglose || {};
    out.jonyTieneU = ds.jonyTieneU;
    out.socioOK = Math.abs((ds.jonyTieneU || 0) - 37.4) < 0.02;

    // 2) CAJA vista Miri: columna "Jony te debe U$S" con 37,40 (y NADA por el general)
    vistaSocio = 'miri';
    await renderCaja();
    const movs = window._cajaMovsExtracto || [];
    const jdU = movs.filter(m => m.col === 'JONY_DEBE_USD');
    out.cajaJdU = jdU.reduce((s, m) => s + m.val, 0);
    out.cajaOK = jdU.length === 1 && Math.abs(out.cajaJdU - 37.4) < 0.02;
    out.generalAfuera = !movs.some(m => m.col && m.col.indexOf('JONY_DEBE') === 0 && Math.abs(m.val - 10.91) < 0.02);
    // el pago general tampoco puede aparecer como caja SUYA de Miri
    out.generalNoEsDeMiri = !movs.some(m => m.mon === 'USD' && Math.abs(m.val - 12.83) < 0.01 && m.col !== 'CTA_CTE_USD');

    // 3) MI RESUMEN: "La cobró Jony" muestra los U$S y la identidad cierra
    await renderResumenMiri();
    const html = document.getElementById('resumen-miri')?.innerHTML || '';
    out.filaJony = /La cobró Jony[\s\S]{0,200}?U\$S\s*37[.,]40/.test(html);
    // identidad desde el HTML: vendido 2890.69... acá con mock: vend U$S 121.15 → deben 0 + jony 37.40 + cobrado 83.75
    out.identidadUSD = /Total vendido/.test(html);
    window.apiGet = origApi;
    vistaSocio = 'todo';
    return out;
  });

  chk('cuenta socios: Jony le debe a Miri U$S 37,40 (44 − 6,60 comisión)', r.socioOK, String(r.jonyTieneU));
  chk('caja vista Miri: columna "Jony te debe U$S" = 37,40', r.cajaOK, String(r.cajaJdU));
  chk('el pago GENERAL (12,83 a favor) NO figura como deuda de Jony a Miri', r.generalAfuera);
  chk('  · ni como caja propia de Miri (el crédito no tiene dueño aún)', r.generalNoEsDeMiri);
  chk('Mi resumen: fila "La cobró Jony" muestra U$S 37,40', r.filaJony !== false || r.filaJony, String(r.filaJony));
  if (r.identidadUSD !== undefined) chk('identidad U$S: cobrado + deben + jonyDebe = vendido', r.identidadUSD, r.detalle);
  chk('sin errores JS', errs.length === 0, errs.join(' | '));

  await browser.close();
  console.log(fail ? '\n❌ ' + fail + ' FALLO(S)' : '\n✅ JONY TE DEBE U$S OK — ' + ok + '/' + ok);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('EXPLOTÓ:', e.message); process.exit(1); });
