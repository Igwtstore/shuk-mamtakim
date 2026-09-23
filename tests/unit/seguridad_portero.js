// 🔐 v4.92 — El portero del motor acepta SOLO las cuentas del equipo (función REAL de index.ts).
const fs = require('fs');
const path = require('path');
const { suite } = require('./_helpers');
const TS = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'functions', 'api', 'index.ts'), 'utf8');
const lista = TS.match(/const MAILS_EQUIPO = (\[[^\]]+\]);/)[1];
const cuerpo = (nombre) => { const i = TS.indexOf('async function ' + nombre + '('); let j = TS.indexOf('{', TS.indexOf(')', i)) + 1, d = 1; while (d > 0) { const c = TS[j++]; if (c === '{') d++; else if (c === '}') d--; } return TS.slice(i, j); };
const limpio = (s) => s.replace(/\): Promise<[^>]+>/g, ')').replace(/\(token: string\)/g, '(token)');
async function run() {
  const t = suite();
  const mails = { jony: 'Admin@ShukMamtakim.com ', miri: 'myri@shukmamtakim.com', kids: 'kids@candyshop.com', intruso: 'alguien@gmail.com', viejo: 'ingodwetrustsrl@gmail.com' };
  const fetch = async (url, o) => { const tok = o.headers.Authorization.replace('Bearer ', ''); return mails[tok] ? { ok: true, json: async () => ({ email: mails[tok], id: 'id-' + tok }) } : { ok: false, json: async () => ({}) }; };
  const F = new Function('fetch', 'const SB_URL = "https://x"; const ANON = "a"; const MAILS_EQUIPO = ' + lista + ';\n' + limpio(cuerpo('usuarioSesion')) + '\n' + limpio(cuerpo('sesionValida')) + '\nreturn { usuarioSesion, sesionValida };')(fetch);
  t.eq('las cuentas del equipo pasan (el mail se compara sin mayúsculas ni espacios)', [!!(await F.usuarioSesion('jony')), !!(await F.usuarioSesion('kids'))], [true, true]);
  t.eq('Miri ya NO pasa (v4.96: afuera de todo)', [await F.usuarioSesion('miri'), await F.sesionValida('miri')], [null, false]);
  t.eq('una sesión VÁLIDA de alguien de afuera no pasa', [await F.usuarioSesion('intruso'), await F.sesionValida('intruso')], [null, false]);
  t.eq('la cuenta vieja que no es del equipo tampoco', await F.sesionValida('viejo'), false);
  t.eq('sin token o con token falso, afuera', [await F.sesionValida(''), await F.sesionValida('cualquiera')], [false, false]);
  t.ok('el control está en usuarioSesion, que usa el portero de TODAS las acciones protegidas', /const usuario = \(esPublica \|\| conSecreto\) \? null : await usuarioSesion\(token\);/.test(TS) && /if \(!esPublica && !conSecreto && !usuario\) return json\(\{ error: 'no autorizado' \}\);/.test(TS));
  return t.result();
}
module.exports = { run };
