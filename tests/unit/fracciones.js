// ✂️ v5.03 — FRACCIONAR PAQUETES: faltantesStock() REAL del motor. Las fracciones ("· x3") comparten el pozo de su
// bolsa, así que el "¿alcanza?" de un pedido se mira por POZO (bolsas cerradas primero, después las unidades).
// El ejemplo del usuario: 2 bolsas de 18 = 36 unidades = 12 promos x3 = 9 promos x4.
const fs = require('fs');
const path = require('path');
const { suite } = require('./_helpers');
const TS = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'functions', 'api', 'index.ts'), 'utf8');
const SQL = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase_fracciones.sql'), 'utf8');
function bloque(nombre) {
  const re = new RegExp('(?:async\\s+)?function\\s+' + nombre + '\\s*\\(');
  const m = TS.match(re); if (!m) throw new Error('no encontré ' + nombre);
  let i = TS.indexOf('{', m.index + m[0].length), depth = 0;
  for (; i < TS.length; i++) { const c = TS[i]; if (c === '{') depth++; else if (c === '}') { depth--; if (!depth) { i++; break; } } }
  return TS.slice(m.index, i)
    .replace(/(\w+)\s*:\s*(?:string|number|boolean|any)(\[\])?(?=\s*[,)=])/g, '$1')
    .replace(/const (\w+)\s*:\s*any(\[\])?\s*=/g, 'const $1 =')
    .replace(/\(([a-z]\w*)\s*:\s*any\)/g, '($1)');
}
const { faltantesStock } = new Function(bloque('faltantesStock') + '\nreturn { faltantesStock };')();

function run() {
  const t = suite();
  const bolsa = (stock, sueltas = 0) => ({ id: '10', nombre: 'Pastillitas x18', stock, sueltas, unidades_por_paquete: 18, fraccion_de: null });
  const x3 = { id: '11', nombre: 'Pastillitas · x3', stock: 0, fraccion_de: '10', fraccion_cant: 3, unidades_por_paquete: 3 };
  const x4 = { id: '12', nombre: 'Pastillitas · x4', stock: 0, fraccion_de: '10', fraccion_cant: 4, unidades_por_paquete: 4 };
  const F = (pares, filas) => faltantesStock(pares.map(([id, qty]) => ({ id, qty })), filas);

  // El ejemplo del usuario
  t.eq('2 bolsas de 18: alcanzan 12 promos x3', F([['11', 12]], [bolsa(2), x3]), []);
  t.eq('…pero no 13 (hay 12)', F([['11', 13]], [bolsa(2), x3]).map((f) => f.hay), [12]);
  t.eq('2 bolsas de 18: alcanzan 9 promos x4', F([['12', 9]], [bolsa(2), x4]), []);
  t.eq('1 cerrada + 15 sueltas (después de vender una x3): 11 x3', F([['11', 11]], [bolsa(1, 15), x3]), []);
  t.eq('…y 8 x4', F([['12', 9]], [bolsa(1, 15), x4]).map((f) => f.hay), [8]);

  // Lo que hay que mirar JUNTO (el chequeo viejo renglón por renglón lo dejaba pasar)
  t.eq('1 bolsa entera + 4 x4 de la misma bolsa: alcanza (18 + 16 ≤ 36)', F([['10', 1], ['12', 4]], [bolsa(2), x4]), []);
  t.eq('1 bolsa entera + 5 x4: NO (quedan 18 sueltas → 4 x4)', F([['10', 1], ['12', 5]], [bolsa(2), x4]).map((f) => [f.id, f.hay]), [['12', 4]]);
  t.eq('las 2 bolsas enteras + 1 x3: la x3 se queda sin nada', F([['10', 2], ['11', 1]], [bolsa(2), x3]).map((f) => [f.id, f.hay]), [['11', 0]]);
  t.eq('3 bolsas enteras con 2 en stock: falta la bolsa (hay 2) y la x3 tampoco', F([['10', 3], ['11', 1]], [bolsa(2), x3]).map((f) => [f.id, f.hay]), [['10', 2], ['11', 0]]);
  t.eq('x3 ×5 (15 u.) + x4 ×1 con 18 u.: sobran 3 → la x4 no entra', F([['11', 5], ['12', 1]], [bolsa(1), x3, x4]).map((f) => [f.id, f.hay]), [['12', 0]]);
  t.eq('x3 ×4 (12 u.) + x4 ×1 con 18 u.: entra todo', F([['11', 4], ['12', 1]], [bolsa(1), x3, x4]), []);
  t.eq('la bolsa entera NO usa las sueltas: 0 cerradas + 17 sueltas → no hay bolsa', F([['10', 1]], [bolsa(0, 17)]).map((f) => f.hay), [0]);
  t.eq('pero las sueltas sí sirven para las fracciones (17 → 5 x3)', F([['11', 6]], [bolsa(0, 17), x3]).map((f) => f.hay), [5]);
  t.eq('la misma fracción en dos renglones se suma', F([['11', 7], ['11', 6]], [bolsa(2), x3]).map((f) => [f.id, f.hay]), [['11', 5]]);

  // Casos borde
  t.eq('bolsa con stock negativo cuenta como 0', F([['11', 1]], [bolsa(-2, 0), x3]).map((f) => f.hay), [0]);
  t.eq('fracción sin su bolsa (la borraron) → no hay', F([['11', 1]], [x3]).map((f) => f.hay), [0]);
  t.eq('producto que no existe → #id y hay 0', F([['99', 1]], []).map((f) => [f.nombre, f.hay]), [['#99', 0]]);
  t.eq('producto normal (sin fracciones) igual que siempre: stock 3, pide 4 → hay 3', F([['7', 4]], [{ id: '7', nombre: 'Klik', stock: 3 }]).map((f) => f.hay), [3]);
  t.eq('producto normal que alcanza → nada', F([['7', 3]], [{ id: '7', nombre: 'Klik', stock: 3 }]), []);
  t.eq('cantidades 0 o vacías se ignoran', F([['7', 0], ['', 2]], [{ id: '7', nombre: 'Klik', stock: 0 }]), []);

  // El motor usa esta cuenta y mueve el stock en un solo paso (red contra una vuelta atrás accidental)
  t.ok('la venta chequea el stock por pozo', /faltanItems = await faltantesDelPedido\(paresChk\)/.test(TS));
  t.ok('levantar un pedido cancelado también', /faltantesDelPedido\(aDescontar\.map/.test(TS));
  t.ok('moverStockShuk usa la función de la base (atómica)', /sbRpc\('mover_stock', \{ p_id: String\(pid\), p_delta: delta \}\)/.test(TS));
  t.ok('crearFracciones es solo de Jony', /SOLO_JONY = \[[^\]]*'crearFracciones'/.test(TS));
  t.ok('la ficha del panel trae fraccionDe / fraccionCant / sueltas', /fraccionDe: \(p\.fraccion_de/.test(TS) && /sueltas: parseInt\(p\.sueltas\)/.test(TS));
  t.ok('una bolsa con fracciones no se puede borrar', /Esta bolsa tiene ' \+ hijasE\.length/.test(TS));

  // La base: las reglas que hacen que nada se desincronice
  t.ok('SQL: la fracción se recalcula ANTES de guardarse (nadie le escribe stock a mano)', /create trigger fraccion_calcular before insert or update on productos/.test(SQL));
  t.ok('SQL: cuando cambia la bolsa se recalculan sus fracciones', /create trigger fraccion_sincronizar after update on productos/.test(SQL));
  t.ok('SQL: costo = costo de la bolsa ÷ N × cant', /round\(m\.costo \/ upp \* k, 4\)/.test(SQL));
  t.ok('SQL: la tienda NO puede ejecutar mover_stock', /revoke all on function mover_stock\(text, numeric\) from public, anon, authenticated/.test(SQL));
  t.ok('SQL: se bloquea primero la bolsa (sin cruces entre una fracción y la bolsa entera)', /where id = f\.fraccion_de for update/.test(SQL));
  return t.result();
}
module.exports = { run };
