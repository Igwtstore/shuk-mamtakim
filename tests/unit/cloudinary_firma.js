// 🖼️ v4.99 — Subidas a Cloudinary con firma. El motor firma cada subida (solo el equipo, solo el preset y la carpeta de
// los paneles) con la clave que Jony carga en 🔑. Corre el código REAL del motor: la firma se compara con la librería
// OFICIAL de Cloudinary (vectores sacados de `cloudinary.utils.api_sign_request`, incluido el ejemplo de su documentación).
const fs = require('fs');
const path = require('path');
const { suite } = require('./_helpers');
const TS = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'functions', 'api', 'index.ts'), 'utf8');
const HTML = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
const CANDY = fs.readFileSync(path.join(__dirname, '..', '..', 'candyshop.html'), 'utf8');

function bloque(src, inicio) {
  const i = src.indexOf(inicio);
  if (i === -1) throw new Error('no encontré ' + inicio);
  let j = src.indexOf('{', i + inicio.length - 1) + 1, d = 1;
  while (d > 0) { const c = src[j++]; if (c === '{') d++; else if (c === '}') d--; }
  return src.slice(i, j);
}
const sinTipos = (code) => code.replace(/\)\s*:\s*Promise<[^>]+>\s*\{/g, ') {').replace(/:\s*(any|string|number|boolean)(\[\])?(?=\s*[,)=;{])/g, '');
const linea = (nombre) => { const m = TS.match(new RegExp('^const ' + nombre + ' = .*$', 'm')); if (!m) throw new Error('no encontré ' + nombre); return m[0] + '\n'; };
const M = new Function(sinTipos(linea('CLD_CLOUD') + bloque(TS, 'function camposAFirmar(') + '\n' + bloque(TS, 'async function firmaCloudinary(')) + '\nreturn { camposAFirmar, firmaCloudinary, CLD_PRESETS, CLD_CARPETAS };')();

// Vectores de la librería oficial (npm cloudinary@2, utils.api_sign_request).
const OFICIAL = [
  [{ timestamp: '1315060510', public_id: 'sample_image', eager: 'w_400,h_300,c_pad|w_260,h_200,c_crop' }, 'abcd', 'bfd09f95f331f558cbd1320e67aa8d488770583e'],
  [{ timestamp: '1758667200', upload_preset: 'shuk_upload', folder: 'shuk-mamtakim' }, 'SecretoDePrueba_123-abc', '66e673452069e32811d98c79afd390a888b5177e'],
  [{ timestamp: '1758667201', upload_preset: 'candyshop' }, 'otro-secreto_XYZ', 'cd28b995382f8b8793902d3ada53ce68aa153d9e'],
  [{ timestamp: '1758667202', upload_preset: 'shuk_upload', folder: 'shuk-comprobantes' }, 'a1B2c3D4e5F6g7H8i9J0kLmNoP', 'f255f824d24261b5f443be2bdd4d3195fbb5b4a0'],
];

async function run() {
  const t = suite();
  const firmas = [];
  for (const [p, s, esperada] of OFICIAL) firmas.push((await M.firmaCloudinary(p, s)) === esperada);
  t.eq('la firma es la de la librería oficial de Cloudinary (4 casos, incluido el ejemplo de su documentación)', firmas, [true, true, true, true]);

  t.eq('se firma lo de los paneles: preset del Shuk con su carpeta, el de comprobantes y el de los chicos', [
    M.camposAFirmar({ upload_preset: 'shuk_upload', folder: 'shuk-mamtakim' }),
    M.camposAFirmar({ upload_preset: 'shuk_upload', folder: 'shuk-comprobantes' }),
    M.camposAFirmar({ upload_preset: 'candyshop' }),
  ], [{ upload_preset: 'shuk_upload', folder: 'shuk-mamtakim' }, { upload_preset: 'shuk_upload', folder: 'shuk-comprobantes' }, { upload_preset: 'candyshop' }]);
  t.eq('NO se firma: pisar una foto (public_id), transformaciones, otro preset, otra carpeta, ni una subida sin preset', [
    M.camposAFirmar({ upload_preset: 'shuk_upload', public_id: 'shuk-mamtakim/f5jvgkrk9rtofqcfhlxs' }),
    M.camposAFirmar({ upload_preset: 'shuk_upload', eager: 'w_4000' }),
    M.camposAFirmar({ upload_preset: 'ml_default' }),
    M.camposAFirmar({ upload_preset: 'shuk_upload', folder: 'otra-cosa' }),
    M.camposAFirmar({ folder: 'shuk-mamtakim' }),
    M.camposAFirmar({}),
  ], [null, null, null, null, null, null]);

  // Quién puede qué.
  const lista = (nombre) => [...TS.match(new RegExp('const ' + nombre + ' = \\[([\\s\\S]*?)\\];'))[1].matchAll(/'([A-Za-z]+)'/g)].map((m) => m[1]);
  t.ok('cargar la clave: solo Jony', lista('SOLO_JONY').includes('guardarClaveCloudinary'));
  t.ok('pedir una firma: el equipo (Jony y la cuenta de los chicos), nunca un visitante', lista('ACCIONES_KIDS').includes('firmarSubida') && !lista('PUBLICAS').includes('firmarSubida') && !lista('PUBLICAS').includes('guardarClaveCloudinary'));
  const guardar = bloque(TS, "if (accion === 'guardarClaveCloudinary') {");
  t.ok('la clave se PRUEBA contra Cloudinary antes de guardarla (si no anda, no se toca nada)', guardar.indexOf('probarClaveCloudinary') !== -1 && guardar.indexOf('probarClaveCloudinary') < guardar.indexOf('setConfig'));
  const firmar = bloque(TS, "if (accion === 'firmarSubida') {");
  t.ok('la firma nunca devuelve el secreto (solo la API Key, la hora y la firma)', /return json\(\{ api_key: cC\.k, timestamp: firmar\.timestamp, signature: await firmaCloudinary\(firmar, cC\.s\) \}\)/.test(firmar) && !/api_secret|cC\.s \}/.test(firmar.replace('firmaCloudinary(firmar, cC.s)', '')));
  t.ok('sin clave cargada contesta «sinClave» y el panel sube como siempre', firmar.includes("if (!cC) return json({ sinClave: true });"));
  const estado = bloque(TS, "if (accion === 'estadoClavesIA') {");
  t.ok('el estado de las claves dice si está cargada y desde cuándo, nunca la clave', estado.includes("cloudinary: await est('CLOUDINARY_API_SECRET'") && /return \{ cargada: enPanel \|\| enSecreto, origen: [^}]+, fecha: [^}]+\};/.test(estado));
  const reBackup = new RegExp(TS.match(/dump\.config\.map\(\(r: any\) => \(\/(.+?)\/i\.test/)[1], 'i');
  t.ok('la copia horaria del motor NO guarda las claves de Cloudinary', reBackup.test('CLOUDINARY_API_KEY') && reBackup.test('CLOUDINARY_API_SECRET'));

  // Los dos paneles firman cada subida (y si no hay firma, suben como siempre).
  t.ok('panel del Shuk: el interceptor firma las subidas a Cloudinary antes de mandarlas', /url\.indexOf\('https:\/\/api\.cloudinary\.com\/'\) === 0 && opts && opts\.method === 'POST' && opts\.body instanceof FormData && !opts\.body\.has\('signature'\) && _authToken\) \{\s*return _firmarSubidaCloudinary\(opts\.body\)\.then\(\(\) => _origFetch\(url, opts\)\);/.test(HTML));
  t.ok('panel de los chicos: igual, con su propia sesión', /return _firmarSubida\(opts\.body\)\.then\(\(\) => _fetchSinFirma\(url, opts\)\);/.test(CANDY) && CANDY.includes("await api('firmarSubida', { params: JSON.stringify(campos) })"));
  return t.result();
}
module.exports = { run };
if (require.main === module) run().then(r => { r.forEach(x => console.log((x.ok ? '  ✓ ' : '  ✗ FALLÓ — ') + x.name)); const m = r.filter(x => !x.ok).length; console.log(m ? `❌ ${m} fallaron` : `✅ ${r.length}/${r.length}`); process.exit(m ? 1 : 0); });
