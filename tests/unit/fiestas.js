// 🗓️ v4.88 — Tanda 3: la vidriera que sigue el calendario judío, el cierre para Shabat y cada fiesta
// anotada en la Analítica. Corre las funciones REALES de la tienda (index.html) y del motor (index.ts).
const fs = require('fs');
const path = require('path');
const { suite } = require('./_helpers');
const TS = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'functions', 'api', 'index.ts'), 'utf8');
const HTML = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');

// Una función por su nombre (aunque sus parámetros tengan paréntesis adentro, como `= new Date()`).
function fnDe(src, nombre) {
  const m = src.match(new RegExp('function\\s+' + nombre + '\\s*\\('));
  if (!m) throw new Error('no encontré ' + nombre);
  let i = m.index + m[0].length, depth = 1;
  while (depth > 0) { const c = src[i++]; if (c === '(') depth++; else if (c === ')') depth--; }
  i = src.indexOf('{', i) + 1; depth = 1;
  while (i < src.length && depth > 0) { const c = src[i]; if (c === '{') depth++; else if (c === '}') depth--; i++; }
  return src.slice(m.index, i);
}
// Una constante (aunque ocupe varias líneas): hasta el ";" que la cierra fuera de paréntesis y llaves.
function constDe(src, nombre) {
  const ini = src.indexOf('const ' + nombre + ' = ');
  if (ini === -1) throw new Error('no encontré const ' + nombre);
  let depth = 0, q = '';
  for (let i = ini; i < src.length; i++) {
    const c = src[i];
    if (q) { if (c === '\\') { i++; continue; } if (c === q) q = ''; continue; }
    if (c === "'" || c === '"' || c === '`') { q = c; continue; }
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    else if (c === ';' && depth === 0) return src.slice(ini, i + 1) + '\n';
  }
  throw new Error('const sin cerrar: ' + nombre);
}
const sinTipos = src => src
  .replace(/\(raw: any\)/g, '(raw)')
  .replace(/\(v: any\)/g, '(v)').replace(/\(n: number\)/g, '(n)').replace(/\(id\)/g, '(id)')
  .replace(/\(v: any, min: number, max: number, def: number\)/g, '(v, min, max, def)')
  .replace(/\(v: any, max: number\)/g, '(v, max)')
  .replace(/const (\w+)\s*:\s*any\s*=/g, 'const $1 =');

const motor = new Function(constDe(TS, 'FIESTAS_IDS') + sinTipos(fnDe(TS, 'normFiestas')) + '\nreturn { normFiestas };')();

const tienda = new Function(
  'let productos = [], modo = "minorista", _vidriera = null, _vidCache = null, _fiestasCfg = null, _estadoTienda = "abierta", HOY = "2026-09-23";\n' +
  'const productosVisibles = () => productos;\n' +
  'const _hoyAR = () => HOY;\n' +
  ['_normTxt', '_precioDelModo', 'FIESTAS_DEF', 'FIESTAS_FECHAS', '_diasEntre', '_diaMas', '_DIAS_SEMANA'].map(n => constDe(HTML, n)).join('') +
  ['_lineaDe', '_vidIdx', '_fiestaActiva', '_fiestaProductos', '_fiestaTitulo', '_shabatTexto', '_shabatVisible', '_fiestaEtiqueta', '_fiestasSemanaPrevia'].map(n => fnDe(HTML, n)).join('\n') +
  '\nconst _GENERICAS = new Set();\n' +
  'return { FIESTAS_FECHAS, FIESTAS_DEF, _fiestaActiva, _fiestaProductos, _fiestaTitulo, _shabatTexto, _shabatVisible, _fiestaEtiqueta, _fiestasSemanaPrevia,' +
  ' set: (o) => { if ("productos" in o) productos = o.productos; if ("modo" in o) modo = o.modo; if ("cfg" in o) _fiestasCfg = o.cfg; if ("estado" in o) _estadoTienda = o.estado; if ("hoy" in o) HOY = o.hoy; if ("vidriera" in o) { _vidriera = o.vidriera; _vidCache = null; } } };')();

async function run() {
  const t = suite();
  // ── la configuración (motor, lista blanca) ──
  const def = motor.normFiestas(null);
  t.eq('sin nada guardado: Shabat prendido, jueves 20 h', def.shabat, { on: true, dia: 4, hora: 20, txt: '' });
  t.eq('y las 7 fiestas prendidas, sin productos a mano', Object.keys(def.fiestas), ['roshhashana', 'sucot', 'januca', 'tubishvat', 'purim', 'pesaj', 'shavuot']);
  const raro = motor.normFiestas({ shabat: { on: '0', dia: 9, hora: 30, txt: '  Hola​  mundo  ' }, fiestas: { sucot: { on: false, txt: 'x'.repeat(300), ids: [5, '7', 5, -1, 'abc', ...Array.from({ length: 40 }, (_, i) => i + 100)] }, inventada: { on: true } } });
  t.eq('Shabat con valores raros: apagado, día y hora a su default, texto limpio', raro.shabat, { on: false, dia: 4, hora: 20, txt: 'Hola mundo' });
  t.ok('una fiesta apagada queda apagada', raro.fiestas.sucot.on === false);
  t.eq('los productos: sin repetidos ni basura, hasta 24', [raro.fiestas.sucot.ids.slice(0, 3), raro.fiestas.sucot.ids.length], [[5, 7, 100], 24]);
  t.eq('el texto del cartel, hasta 160 letras', raro.fiestas.sucot.txt.length, 160);
  t.ok('una fiesta inventada no entra', !('inventada' in raro.fiestas));

  // ── el calendario ──
  const F = tienda.FIESTAS_FECHAS;
  t.ok('ordenado por fecha y cada fiesta termina después de empezar', F.every((f, i) => f[2] >= f[1] && (!i || F[i - 1][1] <= f[1])));
  const busca = (id, erev) => F.some(f => f[0] === id && f[1] === erev);
  t.ok('las fechas del tablero: Sucot 25/09/2026, Janucá 04/12/2026, Tu Bishvat 23/01/2027, Purim 23/03/2027, Pésaj 21/04/2027',
    busca('sucot', '2026-09-25') && busca('januca', '2026-12-04') && busca('tubishvat', '2027-01-22') && busca('purim', '2027-03-22') && busca('pesaj', '2027-04-21'));
  t.ok('alcanza hasta 2031, todas las fiestas todos los años', ['roshhashana', 'iomkipur', 'sucot', 'januca', 'tubishvat', 'purim', 'pesaj', 'shavuot'].every(id => F.filter(f => f[0] === id && f[1] >= '2027-01-01').length === 5));

  // ── qué fiesta va hoy en la vidriera ──
  const A = h => { tienda.set({ hoy: h }); const f = tienda._fiestaActiva(h); return f ? [f.id, f.dias] : null; };
  t.eq('hoy 23/09/2026: Sucot, faltan 2 días', A('2026-09-23'), ['sucot', 2]);
  t.eq('durante Rosh Hashaná manda Rosh Hashaná (aunque Sucot ya esté a 13 días)', A('2026-09-12'), ['roshhashana', -1]);
  t.eq('Simjat Torá es el último día de Sucot', A('2026-10-04'), ['sucot', -9]);
  t.eq('después de Sucot y lejos de Janucá: nada', A('2026-10-05'), null);
  t.eq('Janucá aparece 14 días antes de la 1ª vela', [A('2026-11-19'), A('2026-11-20')], [null, ['januca', 14]]);
  t.eq('Iom Kipur no tiene vidriera: ese día ya se ve Sucot, que empieza 4 días después', A('2026-09-21'), ['sucot', 4]);
  tienda.set({ cfg: { shabat: { on: true, dia: 4, hora: 20 }, fiestas: { sucot: { on: false, txt: '', ids: [] } } } });
  t.eq('si Jony apaga Sucot, no va', A('2026-09-23'), null);
  tienda.set({ cfg: null });
  const tit = (dias, id = 'sucot') => tienda._fiestaTitulo({ dias, def: tienda.FIESTAS_DEF[id] });
  t.eq('el título según cuánto falta', [tit(2), tit(1), tit(0), tit(-3), tit(-2, 'januca')], ['Faltan 2 días para Sucot', 'Mañana empieza Sucot', 'Hoy empieza Sucot', '¡Jag Sameaj! Estamos en Sucot', '¡Janucá Sameaj! Estamos en Janucá']);

  // ── los productos de la fiesta ──
  const C = (id, nombre, categoria, extra = {}) => ({ id, nombre, categoria, stock: 10, activo: true, visible: 'Ambos', precioMin: 1000, precioMay: '1', kosherTipo: '', ...extra });
  const cat = [
    C(1, 'Pitzujim-Mani Grill', 'Pitzujim'), C(2, 'Pitzujim-Cajú', 'Pitzujim'), C(3, 'Pitzujim-Pecán', 'Pitzujim'),
    C(4, 'Chocolate Elite Crunch', 'Chocolate', { kosherTipo: 'Lácteo' }), C(5, 'Klik azul', 'Chocolate', { kosherTipo: 'Lácteo' }),
    C(6, 'Bamba', 'Snacks'), C(7, 'Caramelos Mentos', 'Caramelo'), C(8, 'Sin stock', 'Pitzujim', { stock: 0 }),
    C(9, 'Solo mayorista', 'Chocolate', { visible: 'Mayorista' }), C(10, 'Pitzujim-Mani Grill', 'Pitzujim'), C(11, 'Sopa', 'Sopa'),
  ];
  tienda.set({ productos: cat, modo: 'minorista', vidriera: { t: 1, orden: [2, 5, 6, 1, 4, 3], top: [] } });
  const P = (id, cfg = { on: true, txt: '', ids: [] }) => tienda._fiestaProductos({ id, def: tienda.FIESTAS_DEF[id], cfg });
  t.eq('Sucot automático: lo más pedido de cada categoría, intercalado (Pitzujim, Chocolate, Snacks, Caramelo…)', P('sucot'), [2, 5, 6, 7, 1, 4, 3]);
  t.ok('nada sin stock, nada solo mayorista, sin repetir gemelos y sin categorías que no van', !P('sucot').some(id => [8, 9, 10, 11].includes(id)));
  t.eq('los elegidos a mano, en su orden (y solo los que se pueden comprar)', P('sucot', { on: true, txt: '', ids: [7, 8, 1] }), [7, 1]);
  t.eq('Pésaj sin lista: nada (nunca se adivina qué es kosher le-Pésaj)', P('pesaj'), []);
  t.eq('Pésaj con lista: la lista', P('pesaj', { on: true, txt: '', ids: [6] }), [6]);
  t.eq('Shavuot: lo lácteo', P('shavuot'), [5, 4]);
  t.eq('hasta 8', P('purim').length <= 8, true);
  const Px = (id, excl) => tienda._fiestaProductos({ id, def: tienda.FIESTAS_DEF[id], cfg: { on: true, txt: '', ids: [] } }, 8, new Set(excl));
  t.eq('saltea lo que ya está en "Lo más pedido" y sigue intercalando', Px('sucot', [2, 5]), [1, 4, 6, 7, 3]);
  t.eq('si saltear la deja con menos de 3, no saltea', Px('tubishvat', [2, 1]), [2, 1, 3]);
  t.eq('lo elegido a mano no se toca', tienda._fiestaProductos({ id: 'sucot', def: tienda.FIESTAS_DEF.sucot, cfg: { on: true, txt: '', ids: [2, 7] } }, 8, new Set([2])), [2, 7]);

  // ── Shabat (hora de Buenos Aires) ──
  const c = { on: true, dia: 4, hora: 20, txt: '' };
  const V = iso => tienda._shabatVisible(c, new Date(iso));
  t.eq('el texto de siempre', tienda._shabatTexto(c), '🕯️ Pedí hasta el jueves a las 20 h y llega para Shabat');
  t.eq('se ve el miércoles, el jueves a las 19:59 y el domingo; no el jueves a las 20, ni viernes ni sábado',
    [V('2026-09-23T18:00:00Z'), V('2026-09-24T22:59:00Z'), V('2026-09-27T03:30:00Z'), V('2026-09-24T23:00:00Z'), V('2026-09-25T15:00:00Z'), V('2026-09-26T15:00:00Z')],
    [true, true, true, false, false, false]);
  t.ok('apagado o con la tienda cerrada, no se ve', !tienda._shabatVisible({ ...c, on: false }, new Date('2026-09-23T18:00:00Z')) && (tienda.set({ estado: 'cerrada' }), !tienda._shabatVisible(c, new Date('2026-09-23T18:00:00Z'))));
  tienda.set({ estado: 'abierta' });
  t.eq('con otro día y hora, y texto propio', [tienda._shabatTexto({ dia: 3, hora: 18, txt: '' }), tienda._shabatTexto({ dia: 4, hora: 20, txt: 'Hasta el jueves!' })], ['🕯️ Pedí hasta el miércoles a las 18 h y llega para Shabat', 'Hasta el jueves!']);

  // ── cada fiesta, anotada en Día a día ──
  const E = k => { const e = tienda._fiestaEtiqueta(k); return e ? e.txt : null; };
  t.eq('la semana de Iom Kipur y Sucot, como en el tablero', ['2026-09-20', '2026-09-21', '2026-09-22', '2026-09-23', '2026-09-25', '2026-09-27', '2026-10-03', '2026-10-04', '2026-10-05'].map(E),
    ['🕯️ víspera de Iom Kipur', '🕯️ Iom Kipur', 'el día después de Iom Kipur', 'faltan 2 días para Sucot', '🌿 víspera de Sucot', '🌿 Sucot', '🌿 Shminí Atzeret', '🌿 Simjat Torá', 'el día después de Sucot']);
  t.eq('Janucá empieza con la 1ª vela; un día común no lleva nada', [E('2026-12-04'), E('2026-12-08'), E('2026-11-01')], ['🕎 1ª vela de Janucá', '🕎 Janucá', null]);
  const dia = (fecha, visitas, pedidos) => ({ fecha, visitas, pedidos });
  const dias = [];
  for (let k = 0; k < 30; k++) { const f = new Date(Date.parse('2026-08-25T12:00:00Z') + k * 86400000).toISOString().slice(0, 10); dias.push(dia(f, f >= '2026-09-04' && f <= '2026-09-10' ? 20 : 10, 1)); }
  tienda.set({ hoy: '2026-09-23' });
  const sp = tienda._fiestasSemanaPrevia(dias);
  const rh = sp.find(x => x.id === 'roshhashana');
  t.eq('la semana antes de Rosh Hashaná: sus visitas, sus pedidos y cuánto más que una semana normal (370 visitas en 30 días = 86 por semana)', rh && [rh.v, rh.p, rh.n, rh.pct], [140, 7, 7, 62]);
  const su = sp.find(x => x.id === 'sucot');
  t.eq('Sucot (empieza el 25) ya entra con los días que van, y sabe que todavía no empezó', su && [su.n, su.futuro], [6, true]);
  t.eq('la más reciente primero', sp.map(x => x.id), ['sucot', 'roshhashana']);
  return t.result();
}
module.exports = { run };
