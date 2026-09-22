// 🧭 v4.80 — de dónde viene cada visita: la etiqueta del link manda, el primer toque queda guardado,
// el referrer es el último recurso. Extrae las funciones REALES de index.html.
const fs = require('fs');
const path = require('path');
const { suite } = require('./_helpers');
const SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
function cuerpo(nombre) {
  const re = new RegExp('function\\s+' + nombre + '\\s*\\([^)]*\\)\\s*\\{');
  const m = SRC.match(re); if (!m) throw new Error('no encontré ' + nombre);
  let i = m.index + m[0].length, depth = 1;
  while (i < SRC.length && depth > 0) { const c = SRC[i]; if (c === '{') depth++; else if (c === '}') depth--; i++; }
  return SRC.slice(m.index, i);
}
const canales = SRC.match(/const _CANALES = \{[^\n]+\};/)[0];
function armar(search, referrer, guardado) {
  const store = {}; if (guardado) store.shuk_canal = guardado;
  const ctx = 'const location = { search: ' + JSON.stringify(search) + ', host: "shukmamtakim.com.ar" }; const document = { referrer: ' + JSON.stringify(referrer) + ' };'
    + 'const localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };';
  const F = new Function('store', ctx + canales + '\n' + cuerpo('_canalDelLink') + cuerpo('_origenReferrer') + cuerpo('_origen') + '\nreturn { origen: _origen(), store };')(store);
  return F;
}
async function run() {
  const t = suite();
  t.eq('link ?c=wa → whatsapp', armar('?c=wa', '', '').origen, 'whatsapp');
  t.eq('?c=estado → estado (el estado de WhatsApp es un canal aparte)', armar('?c=estado', '', '').origen, 'estado');
  t.eq('?c=IG (mayúsculas) → instagram', armar('?c=IG', '', '').origen, 'instagram');
  t.eq('?c=qr con hash y otros params → qr', armar('?p=123&c=qr', '', '').origen, 'qr');
  t.eq('etiqueta desconocida → otro:<lo que sea>, saneado', armar('?c=Volante<b>2', '', '').origen, 'otro:volanteb2');
  t.eq('la etiqueta le gana al referrer', armar('?c=fb', 'https://l.instagram.com/', '').origen, 'facebook');
  t.eq('sin etiqueta, con referrer de Google → google', armar('', 'https://www.google.com/', '').origen, 'google');
  t.eq('sin nada → directo', armar('', '', '').origen, 'directo');
  t.eq('el primer toque queda guardado en el navegador', armar('?c=wa', '', '').store.shuk_canal, 'whatsapp');
  t.eq('la vuelta sin etiqueta usa lo guardado (no "directo")', armar('', '', 'instagram').origen, 'instagram');
  t.eq('una recarga interna tampoco borra el canal', armar('', 'https://shukmamtakim.com.ar/tienda', 'whatsapp').origen, 'whatsapp');
  t.eq('con etiqueta nueva pero ya había un primer toque, el primer toque NO se pisa', armar('?c=ig', '', 'whatsapp').store.shuk_canal, 'whatsapp');
  t.eq('…pero ESTA visita cuenta para la etiqueta nueva', armar('?c=ig', '', 'whatsapp').origen, 'instagram');
  t.eq('interno sin nada guardado sigue siendo interno', armar('', 'https://shukmamtakim.com.ar/', '').origen, 'interno');
  return t.result();
}
module.exports = { run };
