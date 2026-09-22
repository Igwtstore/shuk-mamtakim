// 🔔 v4.82 — los avisos al celular: el texto del informe y la cuenta de "día raro", con las funciones REALES del motor.
const fs = require('fs');
const path = require('path');
const { suite } = require('./_helpers');
const SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'functions', 'api', 'index.ts'), 'utf8');
function fnReal(nombre) {
  const re = new RegExp('(?:async\\s+)?function\\s+' + nombre + '\\s*\\(');
  const m = SRC.match(re); if (!m) throw new Error('no encontré ' + nombre);
  let i = SRC.indexOf('{', m.index + m[0].length), depth = 0;
  for (; i < SRC.length; i++) { const c = SRC[i]; if (c === '{') depth++; else if (c === '}') { depth--; if (!depth) { i++; break; } } }
  return SRC.slice(m.index, i)
    .replace(/\)\s*:\s*(number \| null|any\[\]|any|string|boolean)\s*\{/, ') {')
    .replace(/(\w+)\s*:\s*(?:string|number|boolean|any)(\[\])?(?=\s*[,)=])/g, '$1')
    .replace(/const (\w+)\s*:\s*any(\[\])?\s*=/g, 'const $1 =')
    .replace(/\(([a-z]\w*)\s*:\s*any\)/g, '($1)')
    .replace(/\((\w+)\s*:\s*any,\s*(\w+)\s*:\s*(?:any|number)\)/g, '($1, $2)');
}
const plata = SRC.match(/const plataCorta = [^\n]+/)[0].replace(/(\w+)\s*:\s*(?:string|number|boolean|any)(\[\])?(?=\s*[,)=])/g, '$1');
const F = new Function(plata + '\n' + fnReal('tsDeFecha') + '\n' + fnReal('textoInforme') + '\n' + fnReal('rarezaCalc') + '\n' + fnReal('itemsCortos') + '\nreturn { textoInforme, rarezaCalc, itemsCortos };')();

async function run() {
  const t = suite();
  const txt = F.textoInforme({ resumen: { visitas: 328, sesiones: 265, unicos: 95 }, comparativa: { visitas: { delta: 12 } }, embudo: { pedido: 4 }, abandonados: [{ total: 25000 }, { total: 15000 }], acciones: [{ titulo: '3 carritos quedaron sin terminar' }, { titulo: '2 clientes tuyos entraron y no compraron' }, { titulo: '12 productos muy pedidos están en CERO' }, { titulo: 'una de más' }] });
  t.ok('informe: los 6 números', txt.includes('328 visitas (▲12%)') && txt.includes('265 sesiones') && txt.includes('95 personas') && txt.includes('4 pedidos') && txt.includes('2 carritos sin terminar ($ 40.000)'));
  t.ok('informe: 3 cosas para el lunes, no 4', txt.includes('1) 3 carritos') && txt.includes('3) 12 productos') && !txt.includes('una de más'));
  t.ok('informe: semana floja dice ▼', F.textoInforme({ resumen: {}, comparativa: { visitas: { delta: -30 } }, embudo: {}, abandonados: [], acciones: [] }).includes('▼30%') );
  t.ok('informe sin acciones: "Nada urgente"', F.textoInforme({ resumen: {}, embudo: {}, abandonados: [], acciones: [] }).includes('Nada urgente'));
  t.eq('items cortos: 3 y el resto contado', F.itemsCortos('[{"n":"Klik","q":2},{"n":"Bamba","q":1},{"n":"Elite","q":3},{"n":"Extra","q":1}]'), '2× Klik · 1× Bamba · 3× Elite · +1');
  t.eq('items cortos con basura: vacío', F.itemsCortos('no es json'), '');

  // Día raro: hoy = martes 22/09/2026, hora 13. Cuatro martes anteriores con 20 visitas hasta las 13; hoy 6.
  const f = (d, h) => ({ fecha: d + ' ' + String(h).padStart(2, '0') + ':30' });
  const martes = ['15/09/2026', '08/09/2026', '01/09/2026', '25/08/2026'];
  const filas = [];
  martes.forEach(d => { for (let i = 0; i < 20; i++) filas.push(f(d, 8 + (i % 6))); for (let i = 0; i < 5; i++) filas.push(f(d, 18)); });   // las de la tarde no cuentan
  for (let i = 0; i < 6; i++) filas.push(f('22/09/2026', 9));
  filas.push(f('21/09/2026', 9));   // lunes: no es el mismo día
  const rz = F.rarezaCalc(filas, '2026-09-22', 13);
  t.eq('rareza: hoy 6 contra promedio 20 → −70 %, martes, 4 semanas', [rz.hoy, rz.promedio, rz.pct, rz.dia, rz.semanas], [6, 20, -70, 'martes', 4]);
  t.eq('rareza: las visitas de la tarde no cuentan a las 13', F.rarezaCalc(filas, '2026-09-22', 20).promedio, 25);
  t.eq('rareza: sin martes anteriores → null', F.rarezaCalc(filas.filter(x => !martes.includes(x.fecha.slice(0, 10))), '2026-09-22', 13), null);
  t.eq('rareza: promedio chico (< 10) → null, no se acusa con poco', F.rarezaCalc(martes.map(d => f(d, 9)), '2026-09-22', 13), null);
  const pico = F.rarezaCalc(filas.concat(Array.from({ length: 34 }, () => f('22/09/2026', 10))), '2026-09-22', 13);
  t.eq('rareza: hoy 40 contra 20 → +100 %', pico.pct, 100);
  return t.result();
}
module.exports = { run };
