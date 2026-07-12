// WL hito 3c: comisión del socio y maaser salen de la ficha (negocio.*).
// Ficha REAL → 15%/10% idénticos a siempre. Ficha DEMO (20%/12%) → los cálculos siguen.
const { chromium } = require('playwright');
let ok = 0, fail = 0;
const chk = (n, c, x) => { if (c) { ok++; console.log('  ✓', n); } else { fail++; console.log('  ✗ FALLO:', n, x || ''); } };
(async () => {
  const browser = await chromium.launch();

  // ── ficha REAL: nada cambia ──
  const p1 = await browser.newPage();
  const errs1 = [];
  p1.on('pageerror', e => { if (!/net::|fetch|resource|onesignal/i.test(e.message)) errs1.push(e.message); });
  await p1.goto('http://localhost:8918/index.html', { waitUntil: 'load', timeout: 30000 });
  await p1.waitForTimeout(1200);
  const r1 = await p1.evaluate(() => {
    productos = [
      { nombre: 'Golosina M', dueno: 'Miri' },
      { nombre: 'Pitzujim J', dueno: 'Jony' },
    ];
    const sp = _recomputeSplit({ productos: '• 2x Golosina M — $ 500 c/u = $ 1.000 || • 1x Pitzujim J — $ 800 c/u = $ 800' });
    return {
      consts: COMISION === 0.15 && MAASER === 0.10,
      split: sp.arsMyri === 1000 && sp.arsJONY === 800 && sp.comiARS === 150,
      lblMa: (document.getElementById('lbl-maaser') || {}).textContent,
      lblRe: (document.getElementById('lbl-retiro') || {}).textContent,
    };
  });
  chk('REAL: COMISION=0.15 y MAASER=0.10 (idéntico a siempre)', r1.consts);
  chk('REAL: _recomputeSplit → comisión $150 sobre $1.000 de Miri', r1.split);
  chk('REAL: labels "Maaser (10%)" / "A retirar (90%)"', r1.lblMa === 'Maaser (10%)' && r1.lblRe === 'A retirar (90%)', r1.lblMa + ' | ' + r1.lblRe);
  chk('REAL: sin errores JS', errs1.length === 0, errs1.join(' | '));

  // ── ficha DEMO: otra tienda con 20% de comisión y 12% de maaser ──
  const p2 = await browser.newPage();
  await p2.route('**/config.js', route => route.fulfill({
    contentType: 'application/javascript',
    body: `window.TIENDA_CONFIG = {
      id: 'demo',
      marca: { nombre: 'Kiosco Demo', emoji: '🧉', tagline: 'demo', url: 'https://demo.example', baseImg: '' },
      contacto: { whatsapp: '111', whatsappHumano: '11 1111-1111', whatsappAlt: '222', whatsappExtra: [], telefonos: { jony: '111', meir: '333', iosi: '444' } },
      infra: { backendUrl: 'https://demo.example/api', supabase: { url: 'https://soarkknjewgcewryxqac.supabase.co', anonKey: 'k' }, cloudinary: { cloud: 'democloud', preset: 'demo' }, oneSignalAppId: 'x' },
      candy: { nombre: 'Demo Kids', emoji: '🧁', logo: '', cloudinaryPreset: 'demokids' },
      negocio: { comisionSocio: 0.20, maaser: 0.12, socios: ['A','B'] },
    };`
  }));
  const errs2 = [];
  p2.on('pageerror', e => { if (!/net::|fetch|resource|onesignal/i.test(e.message)) errs2.push(e.message); });
  await p2.goto('http://localhost:8918/index.html', { waitUntil: 'load', timeout: 30000 });
  await p2.waitForTimeout(1200);
  const r2 = await p2.evaluate(() => {
    productos = [
      { nombre: 'Golosina M', dueno: 'Miri' },
      { nombre: 'Pitzujim J', dueno: 'Jony' },
    ];
    const sp = _recomputeSplit({ productos: '• 2x Golosina M — $ 500 c/u = $ 1.000' });
    return {
      consts: COMISION === 0.20 && MAASER === 0.12,
      split: sp.comiARS === 200,
      lblMa: (document.getElementById('lbl-maaser') || {}).textContent,
      lblRe: (document.getElementById('lbl-retiro') || {}).textContent,
    };
  });
  chk('DEMO: COMISION=0.20 y MAASER=0.12 desde la ficha', r2.consts);
  chk('DEMO: _recomputeSplit → comisión $200 sobre $1.000 (20%)', r2.split);
  chk('DEMO: labels "Maaser (12%)" / "A retirar (88%)"', r2.lblMa === 'Maaser (12%)' && r2.lblRe === 'A retirar (88%)', r2.lblMa + ' | ' + r2.lblRe);
  chk('DEMO: sin errores JS', errs2.length === 0, errs2.join(' | '));

  await browser.close();
  console.log(fail ? '\n❌ ' + fail + ' FALLO(S)' : '\n✅ WL HITO 3c OK — ' + ok + '/' + ok);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('EXPLOTÓ:', e.message); process.exit(1); });
