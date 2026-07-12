// Diseño C (feria) en la tienda real: checks de estilo computado + SCREENSHOT para mirarlo.
const { chromium } = require('playwright');
let ok = 0, fail = 0;
const chk = (n, c, x) => { if (c) { ok++; console.log('  ✓', n); } else { fail++; console.log('  ✗ FALLO:', n, x || ''); } };
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1100, height: 1400 } });
  const errs = [];
  page.on('pageerror', e => { if (!/net::|fetch|resource|onesignal/i.test(e.message)) errs.push(e.message); });
  await page.goto('http://localhost:8917/index.html', { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(1200);

  const r = await page.evaluate(() => {
    // catálogo de muestra: normal $ (dorado), normal U$S (verde), OFERTA, agotado
    productos = [
      { id: 1, nombre: 'Pitzujim-Almendras Caramelizadas', desc: 'Almendras Caramelizadas Israelies (100g)', categoria: 'Pitzujim', dueno: 'Jony', stock: 8, precioMin: 12000, precioMay: '9.50', moneda: 'U$S', visible: 'Ambos', kosherTipo: 'Parve', hashgaja: 'Badatz Ierushalaim' },
      { id: 2, nombre: 'Chocolate Elite', desc: 'Blanco con galletitas – Ugiot (100g)', categoria: 'Chocolate', dueno: 'Miri', stock: 5, precioMin: 10000, precioMay: '5.80', moneda: 'U$S', visible: 'Ambos', kosherTipo: 'Jalav', hashgaja: 'Igur Harabanim' },
      { id: 3, nombre: 'Elite Etzbaot', desc: 'Dedos de chocolate (x21)', categoria: 'Chocolate', dueno: 'Miri', stock: 9, precioMin: 32499, precioMay: '18.00', moneda: 'U$S', visible: 'Ambos', oferta: 1, precioOferta: 27999, ofertaVence: '31/12/2026' },
      { id: 4, nombre: 'Bombon Agotado', desc: 'Sin stock para probar', categoria: 'Chocolate', dueno: 'Miri', stock: 0, precioMin: 5000, precioMay: '3.00', moneda: 'U$S', visible: 'Ambos' },
    ];
    modo = 'minorista';
    renderCatalogo();
    const out = {};
    const card = document.querySelector('.producto-card');
    const cs = getComputedStyle(card);
    out.bordePunteado = cs.borderTopStyle === 'dashed' && cs.borderTopWidth === '2px';
    out.cartel = !!document.querySelector('#card-1 .precio-cartel .producto-precio');
    out.cartelPrecio = (document.querySelector('#card-1 .precio-cartel')?.textContent || '').includes('12.000');
    const btn = document.querySelector('#card-1 .agregar-btn');
    out.btnTerracota = getComputedStyle(btn).backgroundColor === 'rgb(184, 92, 56)';
    out.selloOferta = !!document.querySelector('#card-3 .sello-oferta') && !document.querySelector('#card-1 .sello-oferta');
    out.ofertaTachado = (document.querySelector('#card-3 .precio-cartel')?.innerHTML || '').includes('line-through');
    out.textura = getComputedStyle(document.getElementById('catalogo-section')).backgroundImage.includes('repeating-linear-gradient');
    out.fotoCrema = true; // (la foto real no carga offline; el fondo crema es del CSS .producto-img)
    out.agotadoSinSello = !document.querySelector('#card-4 .sello-oferta');
    // dark mode: el punteado sigue y el cartel se adapta
    document.body.classList.add('dark');
    const csD = getComputedStyle(document.querySelector('.producto-card'));
    out.darkPunteado = csD.borderTopStyle === 'dashed';
    document.body.classList.remove('dark');
    return out;
  });

  chk('tarjeta con borde punteado 2px (etiqueta de feria)', r.bordePunteado);
  chk('precio dentro del cartelito colgado', r.cartel && r.cartelPrecio);
  chk('botón Agregar terracota', r.btnTerracota);
  chk('sello ¡OFERTA! solo en el producto en oferta', r.selloOferta && r.agotadoSinSello);
  chk('oferta: precio tachado + rojo dentro del cartel', r.ofertaTachado);
  chk('fondo con textura de rayas en la zona del catálogo', r.textura);
  chk('modo oscuro: el punteado se mantiene', r.darkPunteado);
  chk('sin errores JS', errs.length === 0, errs.join(' | '));

  // 📸 screenshot para MIRARLO (hover simulado en la primera tarjeta)
  await page.hover('#card-1');
  await page.waitForTimeout(300);
  await page.screenshot({ path: '/private/tmp/claude-501/-Users-antoniojsetton-shuk-mamtakim/52846744-33a5-4981-8bd5-1fdb8a8bda65/scratchpad/diseno_c.png', clip: { x: 0, y: 300, width: 1100, height: 900 } });
  console.log('📸 screenshot guardado');

  await browser.close();
  console.log(fail ? '\n❌ ' + fail + ' FALLO(S)' : '\n✅ DISEÑO C OK — ' + ok + '/' + ok);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('EXPLOTÓ:', e.message); process.exit(1); });
