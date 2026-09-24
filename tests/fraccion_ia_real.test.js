// ✂️ v5.04 — prueba REAL del nombre y la descripción de fracciones con la IA (pedidoFraccionIA + limpiarFraccionIA del motor).
// Uso (con sesión de Supabase: npx supabase login): node tests/fraccion_ia_real.test.js — gasta unos centavos de IA.
// La clave se lee de la base y nunca se imprime. Solo LEE productos.
const { execSync } = require('child_process');
const fs = require('fs');
const RAIZ = '/Users/antoniojsetton/shuk-mamtakim';
const TS = fs.readFileSync(RAIZ + '/supabase/functions/api/index.ts', 'utf8');
const b = (n) => { const m = TS.match(new RegExp('function\\s+' + n + '\\s*\\(')); let i = TS.indexOf('{', m.index), d = 0; for (; i < TS.length; i++) { if (TS[i] === '{') d++; else if (TS[i] === '}') { d--; if (!d) { i++; break; } } } return TS.slice(m.index, i); };
const constante = (n) => { const ini = TS.indexOf('const ' + n + ' = '); let d = 0; for (let i = TS.indexOf('{', ini); i < TS.length; i++) { if (TS[i] === '{') d++; else if (TS[i] === '}') { d--; if (!d) return TS.slice(ini, i + 1) + ';'; } } };
const sinTipos = (s) => s.replace(/(\w+)\s*:\s*(?:string|number|boolean|any)(\[\])?(?=\s*[,)=])/g, '$1').replace(/\s+as\s+any\b/g, '');
const F = new Function(sinTipos([constante('FRACCION_IA_SCHEMA'), ...['sinCantidadPaquete', 'cantFraccionTxt', 'nombreFraccion', 'descFraccion', 'pedidoFraccionIA', 'limpiarFraccionIA'].map(b)].join('\n')) + '\nreturn { pedidoFraccionIA, limpiarFraccionIA };')();
(async () => {
  const out = execSync(`cd ${RAIZ} && npx supabase db query --linked "select valor from config where clave='ANTHROPIC_API_KEY'" -o json`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
  const key = (JSON.parse(out).rows[0] || {}).valor;
  if (!key) { console.log('no encontré la clave'); return; }
  const prods = JSON.parse(execSync(`cd ${RAIZ} && npx supabase db query --linked "select id,nombre,descripcion,categoria,unidades_por_paquete,peso from productos where id in ('349','137','338','249','245')" -o json`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString()).rows;
  const casos = [['349', [5, 10], 'u'], ['137', [3, 5], 'u'], ['338', [5], 'u'], ['249', [4], 'u'], ['245', [3], 'u']];
  for (const [id, cants, u] of casos) {
    const bolsa = prods.find((p) => String(p.id) === id);
    const t0 = Date.now();
    const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-beta': 'server-side-fallback-2026-07-01', 'Content-Type': 'application/json' }, body: JSON.stringify(F.pedidoFraccionIA(bolsa, cants, u)) });
    const body = await r.json(); let texto = ''; (body.content || []).forEach((x) => { if (x.type === 'text') texto += x.text; });
    console.log('\n' + bolsa.nombre + ' — ' + r.status + ' · ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s · ' + (body.model || ''));
    if (r.status !== 200) { console.log(JSON.stringify(body).slice(0, 300)); continue; }
    F.limpiarFraccionIA(JSON.parse(texto), bolsa, cants, u).forEach((f) => console.log('  x' + f.cant + (f.ia ? ' ✨' : ' (regla)') + '  ' + f.nombre + '\n        ' + f.desc));
  }
})().catch((e) => console.log('ERROR', e.message));
