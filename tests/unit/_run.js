// RED DE SEGURIDAD (rápida, sin backend). Corre todos los tests de lógica de plata de /tests/unit
// y reporta verde/rojo. Uso: `node tests/unit/_run.js` (o `npm run blindaje` desde /tests).
// Ritual: correr ANTES de cada deploy. Si algo se pone rojo, NO se deploya.
const fs = require('fs');
const path = require('path');
const dir = __dirname;

let total = 0, fail = 0;
const archivos = fs.readdirSync(dir).filter(f => f.endsWith('.js') && !f.startsWith('_')).sort();

// `await`: un test puede devolver una promesa (los que simulan llamadas al backend).
// Los de siempre, que devuelven el array directo, siguen andando igual.
(async () => {
  for (const f of archivos) {
    console.log('\n── ' + f.replace('.js', '') + ' ─────────────');
    let res;
    try { res = await require(path.join(dir, f)).run(); }
    catch (e) { console.log('  💥 EXCEPCIÓN: ' + e.message); fail++; total++; continue; }
    res.forEach(t => { total++; if (!t.ok) fail++; console.log('  ' + (t.ok ? '✓' : '✗ FALLÓ —') + ' ' + t.name); });
  }

  console.log('\n══════════════════════════════════════');
  console.log(fail === 0 ? `✅ TODO VERDE — ${total} checks de plata OK` : `❌ ${fail} de ${total} FALLARON — NO deployar`);
  console.log('══════════════════════════════════════');
  process.exit(fail === 0 ? 0 : 1);
})();
