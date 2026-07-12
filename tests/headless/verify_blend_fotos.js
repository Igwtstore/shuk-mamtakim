// Fundido de fondos blancos: screenshot con las FOTOS REALES del catálogo de producción.
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1100, height: 1600 } });
  const errs = [];
  page.on('pageerror', e => { if (!/net::|fetch|resource|onesignal/i.test(e.message)) errs.push(e.message); });
  await page.goto('http://localhost:8917/index.html', { waitUntil: 'load', timeout: 30000 });
  // esperar catálogo real + fotos de Cloudinary
  await page.waitForSelector('.producto-card', { timeout: 30000 });
  await page.waitForTimeout(4000);

  const r = await page.evaluate(() => {
    const img = document.querySelector('.producto-img');
    return {
      nCards: document.querySelectorAll('.producto-card').length,
      blend: img ? getComputedStyle(img).mixBlendMode : 'sin imagen',
      wrapBg: img ? getComputedStyle(img.parentNode).backgroundColor : '',
      trim: img ? (img.src.includes('e_trim') ? 'sí' : 'no → ' + img.src.slice(0, 90)) : '',
    };
  });
  console.log('cards:', r.nCards, '| blend:', r.blend, '| fondo marco:', r.wrapBg, '| e_trim:', r.trim);
  console.log(errs.length ? '⚠️ errores: ' + errs.join(' | ') : '✓ sin errores JS');

  // buscar "Chocolate Elite" (packshots con fondo blanco, el caso del usuario) y fotografiar
  await page.fill('#buscador', 'chocolate elite');
  await page.evaluate(() => filtrar());
  await page.waitForTimeout(3500);
  await page.screenshot({ path: '/private/tmp/claude-501/-Users-antoniojsetton-shuk-mamtakim/52846744-33a5-4981-8bd5-1fdb8a8bda65/scratchpad/blend_chocolates.png', clip: { x: 0, y: 250, width: 1100, height: 800 } });
  console.log('📸 chocolates (fondo blanco) capturados');

  await browser.close();
  process.exit(0);
})().catch(e => { console.error('EXPLOTÓ:', e.message); process.exit(1); });
