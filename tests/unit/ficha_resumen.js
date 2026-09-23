// 👤 v4.85 — la ficha del visitante, armada con resumirFicha() REAL del motor.
// El caso que se veía feo (captura del usuario, 22/09): la ficha técnica de cada visita y los
// segundos de cada salida aparecían como "productos" en "Lo que más miró" y como texto de código
// en el recorrido.
const fs = require('fs');
const path = require('path');
const { suite } = require('./_helpers');
const TS = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'functions', 'api', 'index.ts'), 'utf8');
function bloque(nombre) {
  const re = new RegExp('(?:async\\s+)?function\\s+' + nombre + '\\s*\\(');
  const m = TS.match(re); if (!m) throw new Error('no encontré ' + nombre);
  let i = TS.indexOf('{', m.index + m[0].length), depth = 0;
  for (; i < TS.length; i++) { const c = TS[i]; if (c === '{') depth++; else if (c === '}') { depth--; if (!depth) { i++; break; } } }
  return TS.slice(m.index, i)
    .replace(/\)\s*:\s*(number \| null|any\[\]|any|string|boolean)\s*\{/, ') {')
    .replace(/(\w+)\s*:\s*(?:string|number|boolean|any)(\[\])?(?=\s*[,)=])/g, '$1')
    .replace(/const (\w+)\s*:\s*any(\[\])?\s*=/g, 'const $1 =')
    .replace(/\(([a-z]\w*)\s*:\s*any\)/g, '($1)')
    .replace(/\((\w+)\s*:\s*any,\s*(\w+)\s*:\s*any\)/g, '($1, $2)')
    .replace(/\s+as\s+(any|number|string|boolean)\b/g, '');
}
const F = new Function('const esJSON = x => (x || \'\').charCodeAt(0) === 123;\n' + ['tsDeFecha', 'leerVistas', 'compactarEvento', 'resumirFicha'].map(bloque).join('\n') + '\nreturn { resumirFicha };')();

async function run() {
  const t = suite();
  const ficha = (hl, extra = {}) => JSON.stringify({ tz: 'America/Buenos_Aires', idi: 'es-US', ap: 'Android', px: '384x832', toq: 1, pwa: 0, push: 0, hl, wa: 0, pase: 0, ...extra });
  const r = (id, fecha, evento, x = {}) => ({ id, ts: null, fecha, vid: 'v_prueba3', pagina: 'tienda', evento, origen: '', dispositivo: 'celular', ciudad: 'Buenos Aires', pais: 'Argentina', nombre: '', telefono: '', detalle: '', carrito: '', total: 0, ...x });
  const tanda = JSON.stringify({ v: [{ i: '1', n: 'Pitzujim-Pecán Oreo.' }, { i: '2', n: 'Chocolate Elite Crunch' }] });
  const evs = [
    r(1, '03/09/2026 11:32', 'visita', { detalle: ficha(11), origen: 'whatsapp', nombre: 'Prueba3 Gonzales', telefono: '1100000003' }),
    r(2, '03/09/2026 11:33', 'carrito', { detalle: 'Pitzujim-Semillas de Girasol de Israel!!', carrito: '[{"n":"Pitzujim-Semillas de Girasol","q":2,"p":6000}]', total: 12000 }),
    r(3, '03/09/2026 11:34', 'salida', { detalle: '{"seg":74,"int":0,"prod":0}' }),
    r(4, '22/09/2026 01:40', 'visita', { detalle: ficha(1, { vip: '' }), origen: 'directo' }),
    r(5, '22/09/2026 01:41', 'vistas', { detalle: tanda }),
    r(6, '22/09/2026 01:42', 'vistas', { detalle: tanda.slice(0, tanda.indexOf('Chocolate') + 4) }),   // tanda cortada
    r(7, '22/09/2026 01:48', 'pedido', { nombre: 'Cliente Prueba 3', carrito: '[{"n":"Pitzujim-Pecán Oreo.","q":1,"p":12000}]', total: 87995 }),
    r(8, '22/09/2026 01:49', 'bloqueado'),
    r(9, '22/09/2026 20:06', 'salida', { detalle: '{"seg":75,"int":3,"prod":0}' }),
  ];
  const f = F.resumirFicha(evs);
  const todo = JSON.stringify({ productos: f.productos, agregados: f.agregados });
  t.ok('ningún "producto" es texto de código (ni ficha técnica ni segundos)', !todo.includes('{\\"') && !todo.includes('"tz') && !todo.includes('seg'));
  t.eq('lo que más miró sale de las tandas de vistas (la cortada también cuenta lo que llegó entero)', f.productos, [{ nombre: 'Pitzujim-Pecán Oreo.', n: 2 }, { nombre: 'Chocolate Elite Crunch', n: 1 }]);
  t.eq('lo que puso en el carrito sale de los eventos de carrito', f.agregados, [{ nombre: 'Pitzujim-Semillas de Girasol de Israel!!', n: 1 }]);
  t.eq('el nombre es el ÚLTIMO que dejó (si corrigió "Gonzales" por "González", manda el corregido)', f.nombre, 'Cliente Prueba 3');
  t.eq('el canal es el primer toque (el que lo trajo)', f.origen, 'whatsapp');
  t.eq('días distintos', f.dias, 2);
  t.eq('el recorrido no incluye los rechazos del candado', f.linea.map(x => x.evento).includes('bloqueado'), false);
  const vis = f.linea.find(x => x.evento === 'visita');
  t.eq('la visita viaja con el aparato y sin el texto de código', [vis.aparato, vis.detalle], ['Android', undefined]);
  t.ok('cada evento del recorrido tiene hora (sale de la fecha si no hay hora exacta)', f.linea.every(x => x.t > 0));
  t.eq('la tanda de vistas viaja como lista de nombres', f.linea.find(x => x.id === 'm5').vistos, ['Pitzujim-Pecán Oreo.', 'Chocolate Elite Crunch']);
  t.ok('el pedido conserva el carrito para mostrar qué llevaba', f.linea.find(x => x.evento === 'pedido').carrito.includes('Pecán Oreo'));
  t.eq('la cuenta por tipo incluye todo (también lo que no va al recorrido)', [f.cuenta.visita, f.cuenta.salida, f.cuenta.bloqueado], [2, 2, 1]);
  return t.result();
}
module.exports = { run };
