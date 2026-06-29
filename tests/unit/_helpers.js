// Extrae funciones REALES del código de producción (motor-v2.js / index.html) por nombre,
// sin ejecutar todo el archivo. Devuelve un objeto con las funciones, evaluadas en un mismo
// scope para que se vean entre sí (ej. _gananciaPitzVenta_ usa _parseLineaVenta_).
// Así la "red de seguridad" testea el código que de verdad corre en producción.
const fs = require('fs');
const path = require('path');

function _cuerpoFn(src, nombre) {
  const re = new RegExp('function\\s+' + nombre.replace(/[$]/g, '\\$') + '\\s*\\([^)]*\\)\\s*\\{');
  const m = src.match(re);
  if (!m) throw new Error('No encontré la función ' + nombre);
  let i = m.index + m[0].length, depth = 1;
  while (i < src.length && depth > 0) { const c = src[i]; if (c === '{') depth++; else if (c === '}') depth--; i++; }
  return src.slice(m.index, i);
}

// archivoRel: ruta relativa a /tests/unit (ej. '../../motor-v2.js')
function extraerFns(archivoRel, nombres) {
  const src = fs.readFileSync(path.join(__dirname, archivoRel), 'utf8');
  let codigo = '';
  nombres.forEach(n => { codigo += _cuerpoFn(src, n) + '\n'; });
  codigo += 'return {' + nombres.join(', ') + '};';
  return new Function(codigo)();   // mismo scope → las funciones se referencian entre sí
}

// Mini–assert. Cada test devuelve un array de {name, ok} que el runner agrega.
function suite() {
  const res = [];
  return {
    ok: (name, cond) => res.push({ name, ok: !!cond }),
    eq: (name, a, b) => res.push({ name: name + ' (=' + JSON.stringify(b) + ')', ok: JSON.stringify(a) === JSON.stringify(b) }),
    near: (name, a, b, tol = 0.011) => res.push({ name, ok: Math.abs(a - b) <= tol }),
    result: () => res
  };
}

module.exports = { extraerFns, suite };
