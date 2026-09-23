// 🔑 v4.93 — Las claves de IA: solo Jony las cambia, se prueban antes de guardarse, el estado nunca
// devuelve la clave y ninguna clave queda escrita en el código público. Corre el código REAL de index.ts.
const fs = require('fs');
const path = require('path');
const { suite } = require('./_helpers');
const RAIZ = path.join(__dirname, '..', '..');
const TS = fs.readFileSync(path.join(RAIZ, 'supabase', 'functions', 'api', 'index.ts'), 'utf8');
const HTML = fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8');

// El bloque { ... } que sigue a un texto (una función o un if (accion === ...)).
function bloque(src, inicio) {
  const i = src.indexOf(inicio);
  if (i === -1) throw new Error('no encontré ' + inicio);
  let j = src.indexOf('{', i + inicio.length - 1) + 1, d = 1;
  while (d > 0) { const c = src[j++]; if (c === '{') d++; else if (c === '}') d--; }
  return src.slice(i, j);
}
const sinTipos = (s) => s.replace(/\): Promise<[^>]+>/g, ')').replace(/\((tipo|clave): string, (clave): string\)/, '($1, $2)').replace(/: string/g, '');

async function run() {
  const t = suite();
  const soloJony = TS.match(/const SOLO_JONY = \[([^\]]+)\]/)[1];
  t.ok('cambiar las claves y ver su estado es SOLO de Jony (la cuenta de los chicos ya no puede pisarlas)',
    ['guardarClaveIA', 'guardarClaveGemini', 'estadoClavesIA'].every((a) => soloJony.includes("'" + a + "'")));

  // probarClaveIA: la clave va en una cabecera (nunca en la dirección) y un rechazo no pasa.
  const pedidos = [];
  let respuesta = { ok: true, status: 200 };
  const fetchFalso = async (url, o) => { pedidos.push({ url, o }); if (respuesta === 'caida') throw new Error('sin red'); return respuesta; };
  const probar = new Function('fetch', sinTipos(bloque(TS, 'async function probarClaveIA(')) + '\nreturn probarClaveIA;')(fetchFalso);
  t.eq('una clave que el servicio acepta: sin error', await probar('anthropic', 'sk-ant-PRUEBA'), '');
  t.ok('Anthropic: la clave viaja en la cabecera x-api-key, no en la dirección',
    pedidos[0].url.startsWith('https://api.anthropic.com/') && !pedidos[0].url.includes('PRUEBA') && pedidos[0].o.headers['x-api-key'] === 'sk-ant-PRUEBA');
  await probar('gemini', 'AIzaPRUEBA');
  t.ok('Gemini: la clave viaja en la cabecera x-goog-api-key, no en la dirección',
    pedidos[1].url.startsWith('https://generativelanguage.googleapis.com/') && !pedidos[1].url.includes('PRUEBA') && pedidos[1].o.headers['x-goog-api-key'] === 'AIzaPRUEBA');
  respuesta = { ok: false, status: 401 };
  t.ok('una clave rechazada (401) da error', /no funciona/.test(await probar('anthropic', 'sk-ant-MALA')));
  respuesta = 'caida';
  t.ok('sin conexión con el servicio también da error (no se guarda a ciegas)', /no se pudo comprobar/.test(await probar('gemini', 'AIzaX')));

  // guardarClaveIA / guardarClaveGemini: si la prueba falla, NO se toca la clave que está.
  const guardar = (accionTxt) => {
    const src = sinTipos(bloque(TS, "if (accion === '" + accionTxt + "') {"));
    return (valor, probarRes, cfg = { ANTHROPIC_API_KEY: 'sk-ant-VIEJA', GEMINI_API_KEY: 'AIzaVIEJA' }) => new Function('Q', 'json', 'setConfig', 'probarClaveIA', 'fechasClavesIA', 'fechaAhora', 'cfg',
      'return (async () => { const accion = ' + JSON.stringify(accionTxt) + '; ' + src + ' return null; })();')(
      () => valor, (o) => o, async (k, v) => { cfg[k] = v; }, async () => probarRes, async () => ({}), () => '23/09/2026 10:00', cfg).then((r) => ({ r, cfg }));
  };
  const gIA = guardar('guardarClaveIA'), gG = guardar('guardarClaveGemini');
  let x = await gIA('sk-ant-NUEVA-mal-pegada', 'la clave no funciona (el servicio la rechazó)');
  t.eq('Anthropic: clave rechazada → error y la vieja queda', [!!x.r.error, x.cfg.ANTHROPIC_API_KEY], [true, 'sk-ant-VIEJA']);
  x = await gIA('sk-ant-NUEVA', '');
  t.eq('Anthropic: clave que funciona → se guarda con su fecha', [x.r.ok, x.cfg.ANTHROPIC_API_KEY, JSON.parse(x.cfg.CLAVES_IA_FECHAS).anthropic], [true, 'sk-ant-NUEVA', '23/09/2026 10:00']);
  x = await gIA('cualquier-cosa', '');
  t.ok('Anthropic: algo que no es una clave ni se prueba', x.r.error && x.cfg.ANTHROPIC_API_KEY === 'sk-ant-VIEJA');
  x = await gG('AIzaNUEVA-que-no-anda-000000000000000', 'la clave no funciona (el servicio la rechazó)');
  t.eq('Gemini: clave rechazada → error y la vieja queda', [!!x.r.error, x.cfg.GEMINI_API_KEY], [true, 'AIzaVIEJA']);

  // estadoClavesIA: dice si está y desde cuándo, NUNCA la clave.
  const est = sinTipos(bloque(TS, "if (accion === 'estadoClavesIA') {"));
  const estado = await new Function('getConfig', 'Deno', 'json', 'fechasClavesIA',
    "return (async () => { const accion = 'estadoClavesIA'; " + est + ' })();')(
    async (k) => ({ ANTHROPIC_API_KEY: 'sk-ant-SECRETISIMA' })[k] || '', { env: { get: (k) => (k === 'GEMINI_API_KEY' ? 'AIzaDELSECRETO' : '') } }, (o) => o, async () => ({ anthropic: '23/09/2026 10:00' }));
  t.eq('el estado dice de dónde sale cada clave', estado, { anthropic: { cargada: true, origen: 'panel', fecha: '23/09/2026 10:00' }, gemini: { cargada: true, origen: 'secreto', fecha: '' } });
  t.ok('…y no trae la clave ni un pedazo', !/SECRETISIMA|DELSECRETO|sk-ant|AIza/.test(JSON.stringify(estado)));

  // Todo lo que usa Claude o Gemini sale de la MISMA fuente (antes el verificador de flyers usaba el secreto viejo).
  t.eq('una sola fuente para cada clave (claveIA / claveGemini)', [/Deno\.env\.get\('ANTHROPIC_API_KEY'\) \|\| \(await getConfig/.test(TS), (TS.match(/getConfig\('ANTHROPIC_API_KEY'/g) || []).length, (TS.match(/getConfig\('GEMINI_API_KEY'/g) || []).length], [false, 1, 1]);

  // El panel manda la clave por el CUERPO (POST): en la dirección quedaría en los registros.
  t.ok('el panel manda las claves por POST, nunca en la dirección',
    !/apiWrite\(new URLSearchParams\(\{ accion: 'guardarClave/.test(HTML) && (HTML.match(/apiWritePost\(\{ accion: 'guardarClave(IA|Gemini)'/g) || []).length === 2 && /apiWritePost\(\{ accion: tipo === 'anthropic' \? 'guardarClaveIA' : 'guardarClaveGemini'/.test(HTML));
  t.ok('la tarjeta de claves es solo para Jony (no en la vista de Miri)', /if \(!adminAuth \|\| socioActual !== 'jony' \|\| esVistaMiri\(\)\) \{ box\.hidden = true; return; \}/.test(HTML));

  // Ninguna clave escrita en el código que se publica (el repo es público).
  const PATRONES = [/os_v2_app_[a-z0-9]{20,}/i, /sk-ant-[A-Za-z0-9_-]{20,}/, /AIza[0-9A-Za-z_-]{30,}/, /\bAQ\.[0-9A-Za-z_-]{30,}/, /ghp_[A-Za-z0-9]{30,}/, /github_pat_[A-Za-z0-9_]{30,}/, /\bSK[0-9a-f]{32}\b/, /postgres(ql)?:\/\/[^:\s'"]+:[^@\s'"]{6,}@/];
  const publicados = require('child_process').execSync('git ls-files', { cwd: RAIZ, encoding: 'utf8' }).split('\n')
    .filter((f) => f && /\.(html|js|mjs|ts|json|sql|md|sh|yml|yaml|caddy|env|ejemplo|txt)$/.test(f) && fs.existsSync(path.join(RAIZ, f)));
  const conClave = [];
  for (const f of publicados) {
    const txt = fs.readFileSync(path.join(RAIZ, f), 'utf8');
    for (const p of PATRONES) if (p.test(txt)) conClave.push(f + ' (' + p.source.slice(0, 12) + '…)');
  }
  t.eq('ningún archivo publicado trae una clave escrita (' + publicados.length + ' archivos revisados)', conClave, []);
  // Un JWT con rol service_role (la llave maestra de Supabase) en un archivo publicado sería lo peor.
  const maestras = [];
  for (const f of publicados) {
    for (const m of fs.readFileSync(path.join(RAIZ, f), 'utf8').matchAll(/eyJ[A-Za-z0-9_-]{10,}\.(eyJ[A-Za-z0-9_-]{10,})\.[A-Za-z0-9_-]{10,}/g)) {
      try { if (JSON.parse(Buffer.from(m[1], 'base64url').toString()).role === 'service_role') maestras.push(f); } catch { /* no es un JWT */ }
    }
  }
  t.eq('ningún archivo publicado trae la llave maestra (service_role)', maestras, []);
  return t.result();
}
module.exports = { run };
