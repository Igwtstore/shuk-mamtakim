// LA REGLA DEL USUARIO: "Miri tiene que ver TODOS sus productos" aunque exista un gemelo
// de Jony con nombre idéntico. El ID de la venta (stock_updates) decide qué gemelo fue.
// Y la regla sagrada sigue: lo de Jony JAMÁS se ve en vista Miri.
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
    productos = [
      { id: '68',  nombre: 'Klik Kukiman GEMELO', desc: 'Cereales idénticos', dueno: 'Miri', stock: 3 },
      { id: '153', nombre: 'Klik Kukiman GEMELO', desc: 'Cereales idénticos', dueno: 'Jony', stock: 3 },
      { id: '99',  nombre: 'Pitzujim-Mani', desc: 'Manies', dueno: 'Jony', stock: 5 },
    ];
    const linea = '• 2x Klik Kukiman GEMELO · Cereales idénticos — $ 6.000 c/u = $ 12.000';
    const lineaJony = '• 1x Pitzujim-Mani · Manies — $ 8.000 c/u = $ 8.000';
    const out = {};
    // 1) La venta descontó el gemelo de MIRI (#68) → Miri LO VE
    out.veElSuyo = _lineasPedidoVista(linea + ' || ' + lineaJony, true, '68:2,99:1');
    // 2) La venta descontó el gemelo de JONY (#153) → Miri NO lo ve
    out.noVeElDeJony = _lineasPedidoVista(linea, true, '153:2');
    // 3) Venta vieja SIN registro → decide el gemelo MÁS VIEJO (#68 = Miri) → LO VE (v3.54)
    out.viejaSinSu = _lineasPedidoVista(linea, true, '');
    // 4) Chip de dueño en vista Todo: gemelo de Miri con su → chip MIRI (no JONY)
    out.chipMiri = !_lineaEsDeJony(linea, _nombresJony(), _suIdsDe('68:2'), [linea], 0);
    out.chipJony = _lineaEsDeJony(linea, _nombresJony(), _suIdsDe('153:2'), [linea], 0);
    // 5) La venta tiene LOS DOS gemelos (1 de cada uno) → Miri ve EXACTAMENTE el suyo (v3.54)
    const lAmbos = '• 1x Klik Kukiman GEMELO · Cereales idénticos — $ 6.000 c/u = $ 6.000';
    out.ambos = _lineasPedidoVista(lAmbos + ' || ' + lAmbos, true, '68:1,153:1');
    return out;
  });
  chk('MIRI VE su gemelo (venta con su=68) — el reclamo del usuario', r.veElSuyo.length === 1 && /Kukiman/.test(r.veElSuyo[0]));
  chk('  · y en el mismo pedido, el Pitzujim de Jony sigue OCULTO', !r.veElSuyo.some(l => /Pitzujim/.test(l)));
  chk('el gemelo de JONY (su=153) sigue invisible para Miri (regla sagrada)', r.noVeElDeJony.length === 0);
  chk('venta vieja sin registro → el gemelo más viejo decide (Miri VE lo histórico)', r.viejaSinSu.length === 1);
  chk('chip de dueño: con su=68 NO lo marca como Jony; con su=153 SÍ', r.chipMiri && r.chipJony);
  chk('la venta tiene AMBOS gemelos → Miri ve exactamente UNO (el suyo)', r.ambos.length === 1);
  await browser.close();
  console.log(fail ? '\n❌ ' + fail + ' FALLO(S)' : '\n✅ GEMELOS VISTA MIRI OK — ' + ok + '/' + ok);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('EXPLOTÓ:', e.message); process.exit(1); });
