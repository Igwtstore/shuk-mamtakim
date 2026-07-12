// Verifica que Lista/Grilla en "Armar catálogo" cambia el botón activo SIN regenerar todo el
// modal (para que el scroll no salte y se vea el cambio).
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
    _acProductos = []; _acSel = {}; _acFiltro = 'todos'; _acLayout = 'lista';
    const ov = document.createElement('div'); ov.id = 'ac-overlay'; document.body.appendChild(ov);
    _acRender();
    const out = {};
    out.tieneContenedor = !!document.getElementById('ac-layout-btns');
    // marca en #ac-lista para detectar si se regenera todo el modal
    const lista = document.getElementById('ac-lista'); if (lista) lista.setAttribute('data-marca', 'X');
    // tocar Grilla
    _acSetLayout('grilla');
    out.layoutTrasGrilla = _acLayout;
    out.grillaActivo = document.getElementById('ac-layout-btns').innerHTML.indexOf('#c9954a') !== -1
      && /grilla[\s\S]*?#c9954a|#c9954a[\s\S]*?Grilla/i.test(document.getElementById('ac-layout-btns').innerHTML);
    out.noRegeneró = document.getElementById('ac-lista') && document.getElementById('ac-lista').getAttribute('data-marca') === 'X';
    // tocar Lista de nuevo
    _acSetLayout('lista');
    out.layoutTrasLista = _acLayout;
    out.siguesinRegenerar = document.getElementById('ac-lista') && document.getElementById('ac-lista').getAttribute('data-marca') === 'X';
    return out;
  });

  chk('el contenedor de botones existe (#ac-layout-btns)', r.tieneContenedor);
  chk('tocar Grilla → _acLayout = grilla', r.layoutTrasGrilla === 'grilla', r.layoutTrasGrilla);
  chk('el botón Grilla queda activo (dorado)', r.grillaActivo);
  chk('NO regenera todo el modal (la marca en #ac-lista sobrevive) → el scroll no salta', r.noRegeneró);
  chk('tocar Lista → vuelve a lista, sin regenerar', r.layoutTrasLista === 'lista' && r.siguesinRegenerar, r.layoutTrasLista);

  await browser.close();
  console.log(fail ? '\n❌ ' + fail + ' FALLO(S)' : '\n✅ TOGGLE OK — ' + ok + '/' + ok + ', Lista/Grilla responde sin saltar el scroll');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('EXPLOTÓ:', e.message); process.exit(1); });
