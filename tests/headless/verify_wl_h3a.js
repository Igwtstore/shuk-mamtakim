// WL hito 3a: tienda.html y candyshop.html leen TODO de la ficha (config.js).
// Prueba de molde: se pisa la ficha con una marca FALSA y la UI tiene que reflejarla.
const { chromium } = require('playwright');
let ok = 0, fail = 0;
const chk = (n, c, x) => { if (c) { ok++; console.log('  ✓', n); } else { fail++; console.log('  ✗ FALLO:', n, x || ''); } };
(async () => {
  const browser = await chromium.launch();

  // ── tienda.html (tienda de los chicos) ──
  const p1 = await browser.newPage();
  const errs1 = [];
  p1.on('pageerror', e => { if (!/net::|fetch|resource/i.test(e.message)) errs1.push(e.message); });
  // Ficha falsa ANTES de que corra el script de la página (después de config.js real la pisa el init)
  await p1.addInitScript(() => {
    Object.defineProperty(window, '__WL_TEST__', { value: true });
    document.addEventListener('DOMContentLoaded', () => {});
  });
  await p1.goto('http://localhost:8918/tienda.html?kid=meir', { waitUntil: 'load', timeout: 30000 });
  await p1.waitForTimeout(800);
  const r1 = await p1.evaluate(() => ({
    apps: typeof APPS_URL !== 'undefined' && APPS_URL === TIENDA_CONFIG.infra.backendUrl,
    phones: typeof PHONES !== 'undefined' && PHONES.meir === TIENDA_CONFIG.contacto.telefonos.meir && PHONES.jony === TIENDA_CONFIG.contacto.telefonos.jony,
    titulo: document.title.includes(TIENDA_CONFIG.candy.nombre),
    header: document.getElementById('header-title').textContent.includes(TIENDA_CONFIG.candy.nombre),
    manifest: !!document.querySelector('link[rel="manifest"]'),
  }));
  chk('tienda: APPS_URL sale de la ficha', r1.apps);
  chk('tienda: teléfonos salen de la ficha', r1.phones);
  chk('tienda: título de pestaña usa candy.nombre', r1.titulo, 'title=' + await p1.title());
  chk('tienda: header usa candy.nombre', r1.header);
  chk('tienda: manifest PWA generado', r1.manifest);
  chk('tienda: sin errores JS', errs1.length === 0, errs1.join(' | '));

  // ── prueba de MOLDE: ficha con otra marca → la tienda se repinta sola ──
  const p2 = await browser.newPage();
  await p2.route('**/config.js', route => route.fulfill({
    contentType: 'application/javascript',
    body: `window.TIENDA_CONFIG = {
      id: 'demo',
      marca: { nombre: 'Kiosco Demo', emoji: '🧉', tagline: 'demo', baseImg: '' },
      contacto: { whatsapp: '111', whatsappAlt: '222', whatsappExtra: [], telefonos: { jony: '111', meir: '333', iosi: '444' } },
      infra: { backendUrl: 'https://demo.example/api', supabase: { url: 'https://demo.supabase.co', anonKey: 'k' }, cloudinary: { cloud: 'democloud', preset: 'demo' }, oneSignalAppId: 'x' },
      candy: { nombre: 'Demo Kids', emoji: '🧁', logo: 'https://demo.example/logo.png', cloudinaryPreset: 'demokids' },
      negocio: { comisionSocio: 0.15, maaser: 0.10, socios: ['A','B'] },
    };`
  }));
  const errs2 = [];
  p2.on('pageerror', e => { if (!/net::|fetch|resource/i.test(e.message)) errs2.push(e.message); });
  await p2.goto('http://localhost:8918/tienda.html?kid=meir', { waitUntil: 'load', timeout: 30000 });
  await p2.waitForTimeout(800);
  const r2 = await p2.evaluate(() => ({
    titulo: document.title,
    header: document.getElementById('header-title').textContent,
    apps: APPS_URL,
    tel: PHONES.meir,
  }));
  chk('MOLDE tienda: otra ficha → título "Demo Kids"', r2.titulo.includes('Demo Kids'), r2.titulo);
  chk('MOLDE tienda: header repintado', r2.header.includes('Demo Kids'), r2.header);
  chk('MOLDE tienda: backend de la ficha demo', r2.apps === 'https://demo.example/api', r2.apps);
  chk('MOLDE tienda: teléfono de la ficha demo', r2.tel === '333', r2.tel);
  chk('MOLDE tienda: sin errores JS', errs2.length === 0, errs2.join(' | '));

  // ── candyshop.html (panel de los chicos) ──
  const p3 = await browser.newPage();
  const errs3 = [];
  p3.on('pageerror', e => { if (!/net::|fetch|resource|supabase/i.test(e.message)) errs3.push(e.message); });
  await p3.goto('http://localhost:8918/candyshop.html', { waitUntil: 'load', timeout: 30000 });
  await p3.waitForTimeout(800);
  const r3 = await p3.evaluate(() => ({
    apps: typeof APPS_URL !== 'undefined' && APPS_URL === TIENDA_CONFIG.infra.backendUrl,
    titulo: document.title === TIENDA_CONFIG.candy.nombre,
    h1: [...document.querySelectorAll('.candy-marca')].every(h => h.textContent === TIENDA_CONFIG.candy.nombre) && document.querySelectorAll('.candy-marca').length === 2,
    tels: typeof _CCAT_TELS !== 'undefined' && _CCAT_TELS.meir.num === TIENDA_CONFIG.contacto.telefonos.meir,
    sinHardcode: true,
  }));
  chk('candyshop: APPS_URL sale de la ficha', r3.apps);
  chk('candyshop: título = candy.nombre', r3.titulo);
  chk('candyshop: los 2 headers usan candy.nombre', r3.h1);
  chk('candyshop: teléfonos de catálogo salen de la ficha', r3.tels);
  chk('candyshop: sin errores JS', errs3.length === 0, errs3.join(' | '));

  await browser.close();
  console.log(fail ? '\n❌ ' + fail + ' FALLO(S)' : '\n✅ WL HITO 3a OK — ' + ok + '/' + ok);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('EXPLOTÓ:', e.message); process.exit(1); });
