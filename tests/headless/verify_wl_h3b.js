// WL hito 3b: la marca visible del Shuk (index.html) sale de la ficha.
// Con la ficha REAL todo debe decir "Shuk Mamtakim"; con una ficha DEMO, "Kiosco Demo".
const { chromium } = require('playwright');
let ok = 0, fail = 0;
const chk = (n, c, x) => { if (c) { ok++; console.log('  ✓', n); } else { fail++; console.log('  ✗ FALLO:', n, x || ''); } };
(async () => {
  const browser = await chromium.launch();

  // ── ficha REAL: nada cambia para el Shuk ──
  const p1 = await browser.newPage();
  const errs1 = [];
  p1.on('pageerror', e => { if (!/net::|fetch|resource|onesignal/i.test(e.message)) errs1.push(e.message); });
  await p1.goto('http://localhost:8918/index.html', { waitUntil: 'load', timeout: 30000 });
  await p1.waitForTimeout(1200);
  const r1 = await p1.evaluate(() => ({
    titulo: document.title,
    marca: typeof MARCA !== 'undefined' && MARCA === 'Shuk Mamtakim',
    dom: typeof TIENDA_DOM !== 'undefined' && TIENDA_DOM === 'shuk-mamtakim.vercel.app',
    wlDivs: [...document.querySelectorAll('.wl-marca')].map(d => d.textContent),
    apple: document.querySelector('meta[name="apple-mobile-web-app-title"]').content,
  }));
  chk('REAL: título "Shuk Mamtakim 🍬"', r1.titulo === 'Shuk Mamtakim 🍬', r1.titulo);
  chk('REAL: constantes MARCA/TIENDA_DOM', r1.marca && r1.dom);
  chk('REAL: los 2 headers estáticos repintados', r1.wlDivs.length === 2 && r1.wlDivs.every(t => t === 'Shuk Mamtakim'), JSON.stringify(r1.wlDivs));
  chk('REAL: meta apple actualizado', r1.apple === 'Shuk Mamtakim', r1.apple);
  chk('REAL: sin errores JS', errs1.length === 0, errs1.join(' | '));

  // ── ficha DEMO: el Shuk entero se convierte en "Kiosco Demo" ──
  const p2 = await browser.newPage();
  await p2.route('**/config.js', route => route.fulfill({
    contentType: 'application/javascript',
    body: `window.TIENDA_CONFIG = {
      id: 'demo',
      marca: { nombre: 'Kiosco Demo', emoji: '🧉', tagline: 'demo', url: 'https://demo.example', baseImg: '' },
      contacto: { whatsapp: '111', whatsappHumano: '11 1111-1111', whatsappAlt: '222', whatsappExtra: [], telefonos: { jony: '111', meir: '333', iosi: '444' } },
      infra: { backendUrl: 'https://demo.example/api', supabase: { url: 'https://soarkknjewgcewryxqac.supabase.co', anonKey: 'k' }, cloudinary: { cloud: 'democloud', preset: 'demo' }, oneSignalAppId: 'x' },
      candy: { nombre: 'Demo Kids', emoji: '🧁', logo: '', cloudinaryPreset: 'demokids' },
      negocio: { comisionSocio: 0.15, maaser: 0.10, socios: ['A','B'] },
    };`
  }));
  const errs2 = [];
  p2.on('pageerror', e => { if (!/net::|fetch|resource|onesignal|OneSignal/i.test(e.message)) errs2.push(e.message); });
  await p2.goto('http://localhost:8918/index.html', { waitUntil: 'load', timeout: 30000 });
  await p2.waitForTimeout(1200);
  const r2 = await p2.evaluate(() => ({
    titulo: document.title,
    wlDivs: [...document.querySelectorAll('.wl-marca')].map(d => d.textContent),
    remito: (() => { try { return typeof MARCA_E !== 'undefined' ? `${MARCA_E} — ${TIENDA_DOM}` : 'no'; } catch (e) { return 'err'; } })(),
    btnWa: (document.querySelector('button[onclick*="precios mayoristas"]') || {}).outerHTML || '',
  }));
  chk('DEMO: título "Kiosco Demo 🧉"', r2.titulo === 'Kiosco Demo 🧉', r2.titulo);
  chk('DEMO: headers repintados a "Kiosco Demo"', r2.wlDivs.every(t => t === 'Kiosco Demo'), JSON.stringify(r2.wlDivs));
  chk('DEMO: pie de remito compone marca+dominio demo', r2.remito === 'Kiosco Demo 🧉 — demo.example', r2.remito);
  chk('DEMO: botón WhatsApp compone número/marca de la ficha (no hardcode)', r2.btnWa.includes('TIENDA_CONFIG.contacto.whatsapp') && !r2.btnWa.includes('5491131754540'), r2.btnWa.slice(0, 120));
  chk('DEMO: sin errores JS', errs2.length === 0, errs2.join(' | '));

  await browser.close();
  console.log(fail ? '\n❌ ' + fail + ' FALLO(S)' : '\n✅ WL HITO 3b OK — ' + ok + '/' + ok);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('EXPLOTÓ:', e.message); process.exit(1); });
