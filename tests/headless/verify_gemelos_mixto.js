// v3.54 — Las DOS objeciones del usuario:
// 1) venta con AMBOS gemelos: NO se oculta "por precaución" — cantidad/precio aparean renglón↔ID.
// 2) venta sin registro del gemelo: decide el gemelo más viejo (Miri VE lo suyo histórico).
// + regla sagrada: lo de Jony jamás se le muestra a Miri, en ningún reparto.
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
    // Catálogo con gemelos IDÉNTICOS: #68 Miri (viejo) / #153 Jony (nuevo), precios distintos;
    // y otro par #70/#152 con precios IGUALES (indistinguibles).
    productos = [
      { id: 68, nombre: 'Klik Kukiman', dueno: 'Miri', precioMay: '5.00', precioMin: 500 },
      { id: 153, nombre: 'Klik Kukiman', dueno: 'Jony', precioMay: '7.00', precioMin: 700 },
      { id: 70, nombre: 'Shoko Shoko', dueno: 'Miri', precioMay: '4.00', precioMin: 400 },
      { id: 152, nombre: 'Shoko Shoko', dueno: 'Jony', precioMay: '4.00', precioMin: 400 },
      { id: 99, nombre: 'Trapo Sasón', dueno: 'Jony', precioMay: '3.00', precioMin: 300 },
    ];
    const sj = _nombresJony();
    const casos = {};

    // ── CASO 1a: gemelos mixtos, CANTIDADES distintas (5 de Miri + 3 de Jony) ──
    const su1 = _suIdsDe('68:5,153:3');
    const l1 = ['• 5x Klik Kukiman — $ 500 c/u = $ 2.500', '• 3x Klik Kukiman — $ 700 c/u = $ 2.100'];
    casos.qty_miri_ve = _lineaEsDeJony(l1[0], sj, su1, l1, 0) === false;
    casos.qty_jony_oculto = _lineaEsDeJony(l1[1], sj, su1, l1, 1) === true;

    // ── CASO 1b: MISMA cantidad, precios de catálogo distintos → desempata el precio ──
    const su2 = _suIdsDe('68:2,153:2');
    const l2 = ['• 2x Klik Kukiman — $ 700 c/u = $ 1.400', '• 2x Klik Kukiman — $ 500 c/u = $ 1.000'];
    casos.precio_jony_oculto = _lineaEsDeJony(l2[0], sj, su2, l2, 0) === true;    // $700 = catálogo Jony
    casos.precio_miri_ve = _lineaEsDeJony(l2[1], sj, su2, l2, 1) === false;       // $500 = catálogo Miri

    // ── CASO 1c: renglones INDISTINGUIBLES (misma cantidad, mismo precio) → Miri ve EXACTAMENTE uno ──
    const su3 = _suIdsDe('70:2,152:2');
    const l3 = ['• 2x Shoko Shoko — $ 400 c/u = $ 800', '• 2x Shoko Shoko — $ 400 c/u = $ 800'];
    const vis3 = l3.filter((l, i) => !_lineaEsDeJony(l, sj, su3, l3, i));
    casos.identicos_exacto_uno = vis3.length === 1;

    // ── CASO 1d: mixto entre OTROS renglones no gemelos (posiciones no consecutivas) ──
    const su4 = _suIdsDe('99:1,68:4,153:2');
    const l4 = ['• 1x Trapo Sasón — $ 300 c/u = $ 300', '• 4x Klik Kukiman — $ 500 c/u = $ 2.000', '• 2x Klik Kukiman — $ 700 c/u = $ 1.400'];
    const vis4 = l4.filter((l, i) => !_lineaEsDeJony(l, sj, su4, l4, i));
    casos.mixto_entre_otros = vis4.length === 1 && vis4[0].includes('4x Klik');

    // ── CASO 2: venta SIN registro del gemelo → decide el más viejo (#68 = Miri) → LO VE ──
    const suSin = _suIdsDe('');
    const lSin = ['• 3x Klik Kukiman — $ 500 c/u = $ 1.500'];
    casos.sin_registro_miri_ve = _lineaEsDeJony(lSin[0], sj, suSin, lSin, 0) === false;
    // …y si el más viejo fuera de JONY, se oculta (invierto los dueños para probar la dirección)
    productos.find(p => p.id === 68).dueno = 'Jony';
    productos.find(p => p.id === 153).dueno = 'Miri';
    const sj2 = _nombresJony();
    casos.sin_registro_jony_oculto = _lineaEsDeJony(lSin[0], sj2, suSin, lSin, 0) === true;
    productos.find(p => p.id === 68).dueno = 'Miri';
    productos.find(p => p.id === 153).dueno = 'Jony';

    // ── REGLA SAGRADA: la venta descontó SOLO el gemelo de Jony → oculto, siempre ──
    const suJ = _suIdsDe('153:2');
    const lJ = ['• 2x Klik Kukiman — $ 700 c/u = $ 1.400'];
    casos.solo_jony_oculto = _lineaEsDeJony(lJ[0], sj, suJ, lJ, 0) === true;
    // …y SOLO el de Miri → lo ve (v3.53, sigue igual)
    const suM = _suIdsDe('68:2');
    casos.solo_miri_ve = _lineaEsDeJony(lJ[0], sj, suM, lJ, 0) === false;

    // ── etiqueta de descuento del editor sin descripción: "Nombre [-10%]" no rompe el match ──
    const suT = _suIdsDe('99:2');
    const lT = ['• 2x Trapo Sasón [-10%] — $ 270 c/u = $ 540'];
    casos.tag_descuento_jony_oculto = _lineaEsDeJony(lT[0], sj, suT, lT, 0) === true;

    // ── _lineasPedidoVista integra todo (el caller real) ──
    const vista = _lineasPedidoVista('• 5x Klik Kukiman — $ 500 c/u = $ 2.500 || • 3x Klik Kukiman — $ 700 c/u = $ 2.100', true, '68:5,153:3');
    casos.vista_integrada = vista.length === 1 && vista[0].includes('5x');

    return casos;
  });

  chk('1a cantidades distintas: Miri VE su renglón (5x)', r.qty_miri_ve);
  chk('1a cantidades distintas: el de Jony (3x) queda oculto', r.qty_jony_oculto);
  chk('1b misma cantidad: el precio desempata — $700 (Jony) oculto', r.precio_jony_oculto);
  chk('1b misma cantidad: $500 (Miri) visible', r.precio_miri_ve);
  chk('1c renglones idénticos: Miri ve EXACTAMENTE uno (ni cero ni dos)', r.identicos_exacto_uno);
  chk('1d mixto entre otros renglones: solo queda el 4x de Miri', r.mixto_entre_otros);
  chk('2  sin registro: decide el gemelo más viejo → Miri VE lo histórico', r.sin_registro_miri_ve);
  chk('2  sin registro con el viejo de Jony → oculto (dirección correcta)', r.sin_registro_jony_oculto);
  chk('🛡️ solo gemelo de Jony en el registro → oculto SIEMPRE', r.solo_jony_oculto);
  chk('🛡️ solo gemelo de Miri → visible (v3.53 intacto)', r.solo_miri_ve);
  chk('etiqueta [-10%] sin descripción: producto de Jony sigue oculto', r.tag_descuento_jony_oculto);
  chk('_lineasPedidoVista integra el apareo completo', r.vista_integrada);

  await browser.close();
  console.log(fail ? '\n❌ ' + fail + ' FALLO(S)' : '\n✅ GEMELOS MIXTOS + SIN REGISTRO OK — ' + ok + '/' + ok);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('EXPLOTÓ:', e.message); process.exit(1); });
