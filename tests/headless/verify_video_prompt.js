// Verifica la receta de video: textura automática por producto, persona (mujer religiosa),
// y doble salida (Gemini prosa / Seedance corto + NEGATIVE). En el panel Shuk.
const { chromium } = require('playwright');
let ok = 0, fail = 0;
const chk = (n, c, x) => { if (c) { ok++; console.log('  ✓', n); } else { fail++; console.log('  ✗ FALLO:', n, x || ''); } };
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on('pageerror', e => { if (!/net::|fetch|resource|onesignal/i.test(e.message)) console.log('  PAGEERROR:', e.message); });
  await page.goto('http://localhost:8917/index.html', { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(1200);

  const gen = (nombre, desc, cat, persona, modelo) => page.evaluate(({ nombre, desc, cat, persona, modelo }) => {
    _vidNombre = nombre; _vidDesc = desc; _vidCat = cat; _vidPersona = persona; _vidModelo = modelo;
    return { tipo: _vidPerfil().tipo, txt: _vidPromptTexto() };
  }, { nombre, desc, cat, persona, modelo });

  console.log('\n— Textura automática por producto —');
  let r = await gen('Chocolate Elite Blanco', 'relleno cremoso', 'Chocolate', 'ninguna', 'gemini');
  chk('chocolate → CREMOSO y prohíbe el crunch', r.tipo === 'cremoso' && /PROHIBIDO el crujido/.test(r.txt) && !/QUIEBRA crocante/.test(r.txt), r.tipo);
  r = await gen('Pitzujim-Mani Sabor Grill', 'Manies', 'Pitzujim', 'ninguna', 'gemini');
  chk('maní → CRUJIENTE (crunch permitido)', r.tipo === 'crujiente' && /crocante/.test(r.txt) && !/PROHIBIDO el crujido/.test(r.txt), r.tipo);
  r = await gen('Soft Cubes', 'gomitas ácidas', 'Yumi', 'ninguna', 'gemini');
  chk('gomitas → GOMOSO (sin crunch)', r.tipo === 'gomoso' && /masticable/.test(r.txt) && /PROHIBIDO el crujido/.test(r.txt), r.tipo);
  r = await gen('Trapo de mesada', '', 'Varios', 'mujer', 'gemini');
  chk('trapo → HOGAR: nadie lo come, se usa en la casa', r.tipo === 'hogar' && /NO es un alimento/.test(r.txt) && /mesada/.test(r.txt), r.tipo);

  console.log('\n— Persona: mujer religiosa recatada —');
  chk('  · pelo cubierto con pañuelo + vestimenta modesta', /COMPLETAMENTE cubierto/.test(r.txt) && /pañuelo/.test(r.txt) && /modesta/.test(r.txt) && /manga larga/.test(r.txt));
  r = await gen('Chocolate Elite', '', 'Chocolate', 'hombre', 'gemini');
  chk('  · hombre con kipá sigue disponible', /kipá negra/.test(r.txt));

  console.log('\n— Protección del hebreo (en ambos modelos) —');
  chk('  · Gemini: envase quieto, nunca primer plano del texto', /NUNCA en primer plano/.test(r.txt) && /hebreo NO se redibuja/.test(r.txt));
  r = await gen('Chocolate Elite', '', 'Chocolate', 'ninguna', 'seedance');
  chk('  · Seedance: también protege el texto', /NUNCA en primer plano/.test(r.txt));

  console.log('\n— Salida Seedance/Kling —');
  chk('  · trae NEGATIVE PROMPT separado', /NEGATIVE PROMPT/.test(r.txt));
  chk('  · el negative incluye lo del producto (crunch prohibido p/ cremoso)', /crunch, crujido, textura crocante/.test(r.txt));
  chk('  · tip de foto real como primer cuadro + logo en edición', /imagen de inicio/.test(r.txt) && /CapCut/.test(r.txt));

  // El modal abre y detecta (con el DOM real del editor)
  const modal = await page.evaluate(() => {
    document.getElementById('ep-nombre').value = 'Trapo de piso';
    document.getElementById('ep-desc').value = '';
    videoPromptShuk();
    const ov = document.getElementById('vidp-overlay');
    return { visible: ov && ov.style.display === 'flex', tipo: document.getElementById('vidp-tipo').textContent, txt: document.getElementById('vidp-txt').value.slice(0, 80) };
  });
  console.log('\n— El modal del Shuk —');
  chk('abre y detecta HOGAR para el trapo', modal.visible && /HOGAR/.test(modal.tipo), modal.tipo);

  await browser.close();
  console.log(fail ? '\n❌ ' + fail + ' FALLO(S)' : '\n✅ RECETA DE VIDEO OK — ' + ok + '/' + ok);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('EXPLOTÓ:', e.message); process.exit(1); });
