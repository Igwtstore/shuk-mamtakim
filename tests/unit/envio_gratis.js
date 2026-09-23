// 🚚 v4.90 — Tanda 5: envío gratis desde el mínimo (pedidos minoristas en pesos), la barra del carrito,
// la configuración con lista blanca y la medición de "la barra lo empujó". Funciones REALES.
const fs = require('fs');
const path = require('path');
const { suite } = require('./_helpers');
const TS = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'functions', 'api', 'index.ts'), 'utf8');
const HTML = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
function fnDe(src, nombre) {
  const m = src.match(new RegExp('function\\s+' + nombre + '\\s*\\('));
  if (!m) throw new Error('no encontré ' + nombre);
  let i = m.index + m[0].length, depth = 1;
  while (depth > 0) { const c = src[i++]; if (c === '(') depth++; else if (c === ')') depth--; }
  i = src.indexOf('{', i) + 1; depth = 1;
  while (i < src.length && depth > 0) { const c = src[i]; if (c === '{') depth++; else if (c === '}') depth--; i++; }
  return src.slice(m.index, i);
}
const sinTipos = s => s.replace(/: any/g, '');
const motor = new Function(sinTipos(fnDe(TS, 'normEnvio')) + '\nreturn { normEnvio };')();
const tienda = new Function(
  'var _envioCfg = { on: true, min: 120000, zona: "CABA" }; let modo = "minorista";\n' +
  'const esc = s => String(s == null ? "" : s);\n' +
  ['envioGratisDe', '_envioZonaTxt', '_plataAR', '_envioBarraHtml'].map(n => fnDe(HTML, n)).join('\n') +
  '\nreturn { envioGratisDe, _envioBarraHtml, set: o => { if ("cfg" in o) _envioCfg = o.cfg; if ("modo" in o) modo = o.modo; } };')();
// la medición (motor)
const analitica = require('./vidriera.js')._motor.analitica;
const fechaAhora = require('./vidriera.js')._motor.fechaAhora;

async function run() {
  const t = suite();
  t.eq('sin nada guardado: prendido, $ 120.000, CABA', motor.normEnvio(null), { on: true, min: 120000, zona: 'CABA' });
  t.eq('apagado, otro mínimo y otra zona', motor.normEnvio({ on: '0', min: '150000', zona: '  CABA y   GBA norte ' }), { on: false, min: 150000, zona: 'CABA y GBA norte' });
  t.eq('un mínimo raro (0, negativo, texto) vuelve a $ 120.000', [motor.normEnvio({ min: 0 }).min, motor.normEnvio({ min: -5 }).min, motor.normEnvio({ min: 'mucho' }).min], [120000, 120000, 120000]);
  t.eq('la zona, hasta 40 letras', motor.normEnvio({ zona: 'x'.repeat(80) }).zona.length, 40);

  const G = (tipo, ars, usd) => tienda.envioGratisDe(tipo, ars, usd);
  t.eq('minorista desde $ 120.000: gratis; justo en el mínimo también', [G('Minorista', 120000, 0), G('Minorista', 150000, 0)], [true, true]);
  t.eq('abajo del mínimo, mayorista o con dólares: no', [G('Minorista', 119999, 0), G('Mayorista', 500000, 0), G('Minorista', 200000, 10)], [false, false, false]);
  tienda.set({ cfg: { on: false, min: 120000, zona: 'CABA' } });
  t.eq('apagado: nunca', G('Minorista', 900000, 0), false);
  tienda.set({ cfg: { on: true, min: 0, zona: '' } });
  t.eq('sin mínimo cargado: nunca (no regala el envío por error)', G('Minorista', 900000, 0), false);
  tienda.set({ cfg: { on: true, min: 120000, zona: 'CABA' } });

  const it = (precio, qty) => ({ precioMin: precio, qty });
  const b1 = tienda._envioBarraHtml([it(40000, 2), it(7999.4, 1)]);
  t.ok('abajo del mínimo: "Te faltan $ 32.001 para el envío gratis dentro de CABA" (con el mismo redondeo del pedido)', b1.includes('Te faltan <b>$ 32.001</b> para el envío gratis dentro de CABA') && b1.includes('width:73%'));
  const b2 = tienda._envioBarraHtml([it(60000, 2)]);
  t.ok('en el mínimo: "¡Tu pedido tiene envío gratis dentro de CABA!"', b2.includes('¡Tu pedido tiene envío gratis dentro de CABA!') && b2.includes('envio-barra ok'));
  tienda.set({ modo: 'mayorista' });
  t.eq('en mayorista no hay barra', tienda._envioBarraHtml([it(1, 1)]), '');
  tienda.set({ modo: 'minorista' });
  t.eq('carrito vacío: sin barra', tienda._envioBarraHtml([]), '');

  const hoy = fechaAhora().slice(0, 10);
  const ev = (vid, evento, hora, detalle = '') => ({ fecha: hoy + ' ' + hora, vid, pagina: 'tienda', evento, origen: 'directo', dispositivo: 'celular', ciudad: '', pais: '', nombre: '', telefono: '', detalle, carrito: '', total: 0 });
  const d = analitica([ev('a', 'visita', '00:01'), ev('a', 'vidriera', '00:02', 'envio · alcanzado'), ev('a', 'pedido', '00:03'), ev('b', 'visita', '00:01'), ev('b', 'vidriera', '00:04', 'envio · alcanzado')], 7, [], [], [], null, {});
  t.eq('la medición: 2 llegaron al envío gratis gracias a la barra, 1 pidió', d.vidriera.envio, { alcanzaron: 2, compraron: 1 });
  return t.result();
}
module.exports = { run };
