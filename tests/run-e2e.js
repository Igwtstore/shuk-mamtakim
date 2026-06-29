// Runner de la batería E2E (los *.test.js corren contra el BACKEND real → lentos pero completos).
// Complementa la red rápida de tests/unit (lógica pura). Cada test sale con código 0 (ok) / 1 (falla).
//
// Uso:
//   URL=<exec del Apps Script> SECRET=<BOT_SECRET> node tests/run-e2e.js          # corre todos
//   URL=... SECRET=... node tests/run-e2e.js ganancia                              # solo los que matchean "ganancia"
//
// auth.js obtiene el token de Supabase solo (lee las credenciales de la memoria). Los tests crean
// datos con marca __TEST__ y limpian con limpiarTestData. Conviene correrlo antes de un release grande.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

if (!process.env.URL || !process.env.SECRET) {
  console.error('❌ Falta URL y/o SECRET.\n   Uso: URL=<exec> SECRET=<bot_secret> node tests/run-e2e.js [filtro]');
  process.exit(2);
}

const dir = __dirname;
const filtro = process.argv[2] || '';
const archivos = fs.readdirSync(dir).filter(f => f.endsWith('.test.js') && (!filtro || f.includes(filtro))).sort();
if (!archivos.length) { console.error('No hay tests que matcheen "' + filtro + '"'); process.exit(2); }

console.log(`Corriendo ${archivos.length} test(s) E2E contra el backend (esto tarda)...\n`);
let ok = 0, fail = 0; const fallidos = [];
archivos.forEach(f => {
  process.stdout.write('  ' + f.padEnd(42));
  try {
    execFileSync('node', [path.join(dir, f)], { env: process.env, stdio: 'pipe', timeout: 180000 });
    console.log('✅'); ok++;
  } catch (e) {
    console.log('❌'); fail++; fallidos.push(f);
  }
});

console.log('\n══════════════════════════════════════');
console.log(fail === 0 ? `✅ TODOS VERDE — ${ok}/${archivos.length} E2E OK` : `❌ ${fail} de ${archivos.length} FALLARON`);
if (fallidos.length) console.log('Fallaron: ' + fallidos.join(', ') + '\n  → corré uno solo para ver el detalle: URL=... SECRET=... node tests/<archivo>');
console.log('══════════════════════════════════════');
process.exit(fail === 0 ? 0 : 1);
