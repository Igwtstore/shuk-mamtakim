// v3.63 — Deuda en $ pagada con DÓLARES FÍSICOS (caso Sarah #51):
// el modal pide TC y muestra los U$S reales; la CAJA U$S recibe aRS÷tc (no pesos).
// + regresión de la dirección vieja (v3.41: U$S pagados en pesos) y del pago normal.
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

  // ── 1) EL MODAL: caso Sarah (pedido: Pitzujim $100.350 + U$S, caja ETF U$S JONY) ──
  const r1 = await page.evaluate(() => {
    const out = {};
    document.getElementById('pago-split-wrap').style.display = 'block';   // modo pedido
    document.getElementById('pago-pitz').value = '100350';
    document.getElementById('pago-gol').value = '0';
    document.getElementById('pago-usd').value = '121.15';
    const sel = document.getElementById('pago-caja');
    sel.innerHTML = '<option value="ETF_USD_JONY">ETF U$S JONY</option><option value="EFT_JONY">EFT $ JONY</option>';
    sel.value = 'ETF_USD_JONY';
    pago_evalTC();
    out.tcVisible = document.getElementById('pago-tc-wrap').style.display !== 'none';
    out.labelNuevo = (document.getElementById('pago-tc-label').textContent || '').includes('U$S físicos');
    document.getElementById('pago-tc').value = '1400';
    pago_calcularTC();
    out.resultado = document.getElementById('pago-tc-result').textContent;
    out.total = document.getElementById('pago-total-recibido').textContent;
    // regresión: caja de PESOS con U$S → dirección vieja intacta
    sel.value = 'EFT_JONY';
    pago_evalTC();
    out.labelViejo = (document.getElementById('pago-tc-label').textContent || '').includes('U$S en pesos');
    out.tcVisibleViejo = document.getElementById('pago-tc-wrap').style.display !== 'none';
    // caja pesos + solo pesos → SIN TC
    document.getElementById('pago-usd').value = '0';
    pago_evalTC();
    out.sinTcPesosPuros = document.getElementById('pago-tc-wrap').style.display === 'none';
    return out;
  });
  chk('caja U$S + deuda en $ → aparece el TC con el label nuevo', r1.tcVisible && r1.labelNuevo);
  chk('muestra los U$S que entran: 71,68 por los $ 100.350', r1.resultado.includes('U$S 71.68') && r1.resultado.includes('100.350'), r1.resultado);
  chk('total en mano: U$S 192,83 (71,68 + 121,15) para contar', r1.total.includes('U$S 192.83'), r1.total);
  chk('regresión: caja $ + U$S → label y TC de v3.41 intactos', r1.labelViejo && r1.tcVisibleViejo);
  chk('caja $ + solo pesos → sin TC (pago normal)', r1.sinTcPesosPuros);

  // ── 2) LA CAJA: el pago con tc mete U$S REALES en la caja U$S ──
  const r2 = await page.evaluate(async () => {
    const out = {};
    const V = [];
    const P = [
      // caso Sarah: $100.350 (Pitzujim) + U$S 121,15 a caja U$S con TC 1400
      { cliente: 'Sarah TEST', pedidoId: 'P51', fecha: '12/07/2026', montoARS: 100350, montoUSD: 121.15, montoPitz: 100350, montoPitzUsd: 77.15, caja: 'ETF_USD_JONY', tc: 1400 },
      // regresión v3.41: U$S 50 pagados en pesos a caja de pesos con TC 1500
      { cliente: 'Otro TEST', pedidoId: 'P99', fecha: '12/07/2026', montoARS: 0, montoUSD: 50, montoPitz: 0, montoPitzUsd: 0, caja: 'EFT_JONY', tc: 1500 },
      // pago normal sin TC: pesos a caja de pesos
      { cliente: 'Normal TEST', pedidoId: 'P98', fecha: '12/07/2026', montoARS: 20000, montoUSD: 0, montoPitz: 0, montoPitzUsd: 0, caja: 'EFT_MYRI', tc: 0 },
    ];
    const origApi = window.apiGet;
    window.apiGet = async (a) => a === 'ventas' ? V : (a === 'getPagos' ? P : []);
    vistaSocio = 'todo';
    await renderCaja();
    window.apiGet = origApi;
    const movs = window._cajaMovs || [];
    const enCaja = (col, mon) => movs.filter(m => m.col === col && m.mon === mon && m.tipo === 'venta' && !/Cta Cte/i.test(m.desc)).reduce((s, m) => s + m.val, 0);
    out.usdJony = enCaja('ETF_USD_JONY', 'USD');            // 71.68 + 121.15 = 192.83
    out.arsEnCajaUsd = enCaja('ETF_USD_JONY', 'ARS');       // debe ser CERO (¡el bug viejo!)
    out.v341 = enCaja('EFT_JONY', 'ARS');                   // 50×1500 = 75.000
    out.normal = enCaja('EFT_MYRI', 'ARS');                 // 20.000
    // solo las bajas de cta cte del pago de SARAH (los otros pagos mock tienen las suyas)
    const idxSarah = movs.findIndex(m => /Sarah/.test(m.desc || ''));
    const bajasSarah = movs.slice(idxSarah, idxSarah + 5).filter(m => /Cta Cte/i.test(m.desc || '') && m.val < 0);
    out.ctaCteArs = bajasSarah.filter(m => m.col === 'CTA_CTE_ARS').reduce((s, m) => s + m.val, 0);   // −100.350
    out.ctaCteUsd = bajasSarah.filter(m => m.col === 'CTA_CTE_USD').reduce((s, m) => s + m.val, 0);   // −121.15
    return out;
  });
  chk('caja ETF U$S JONY recibe U$S 192,83 REALES (71,68 de los pesos + 121,15)', Math.abs(r2.usdJony - 192.83) < 0.02, String(r2.usdJony));
  chk('🛡️ CERO pesos en la caja de dólares (el descuadre tipo Fabio, imposible)', Math.abs(r2.arsEnCajaUsd) < 0.01, String(r2.arsEnCajaUsd));
  chk('la deuda en $ baja COMPLETA de la Cta Cte (−$ 100.350)', Math.abs(r2.ctaCteArs + 100350) < 1, String(r2.ctaCteArs));
  chk('la deuda U$S baja completa (−U$S 121,15)', Math.abs(r2.ctaCteUsd + 121.15) < 0.02, String(r2.ctaCteUsd));
  chk('regresión v3.41: U$S en pesos → caja $ recibe $ 75.000', Math.abs(r2.v341 - 75000) < 1, String(r2.v341));
  chk('regresión: pago normal en pesos intacto ($ 20.000)', Math.abs(r2.normal - 20000) < 1, String(r2.normal));
  chk('sin errores JS', errs.length === 0, errs.join(' | '));

  await browser.close();
  console.log(fail ? '\n❌ ' + fail + ' FALLO(S)' : '\n✅ PESOS CON U$S FÍSICOS OK — ' + ok + '/' + ok);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('EXPLOTÓ:', e.message); process.exit(1); });
