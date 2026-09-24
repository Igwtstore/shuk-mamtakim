// 🔔 v5.01 — TE TOCA: a quién le toca volver a pedir según SU propio ritmo. calcularTeToca() REAL del motor
// contra clientes armados a mano: le toca, atrasado, se enfrió, pronto, al día, una sola vez, oculto, ya avisado.
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
    .replace(/:\s*Record<[^>]+>/g, '')
    .replace(/(\w+)\s*:\s*(?:string|number|boolean|any)(\[\])?(?=\s*[,)=])/g, '$1')
    .replace(/const (\w+)\s*:\s*any(\[\])?\s*=/g, 'const $1 =')
    .replace(/\(([a-z]\w*)\s*:\s*any\)/g, '($1)')
    .replace(/\((\w+)\s*:\s*any,\s*(\w+)\s*:\s*any\)/g, '($1, $2)')
    .replace(/\s+as\s+(any|number|string|boolean)\b/g, '')
    .replace(/(\w+)!\./g, '$1.').replace(/(\w+)!\[/g, '$1[').replace(/\)!\./g, ').');
}
const F = new Function(['tsDeFecha', 'normNombreTT', 'pedidoHabitual', 'calcularTeToca'].map(bloque).join('\n') + '\nreturn { tsDeFecha, calcularTeToca, normNombreTT, pedidoHabitual };')();

function run() {
  const t = suite();
  const V = (cliente, fecha, total, su, extra = {}) => ({ cliente, fecha, estado: 'entregado', tipo: 'Minorista', total_ars: total, total_usd: 0, stock_updates: su, ...extra });
  const ventas = [
    // Débora: compra cada ~10-11 días; la última hace 13 → LE TOCA. El 10/09 hizo dos pedidos el mismo día (= una compra).
    V('Débora Levy', '20/08/2026 10:00', 20000, '1:2,2:1'), V('debora levy', '31/08/2026 10:00', 20000, '1:2,3:1'),
    V('Débora Levy', '10/09/2026 10:00', 20000, '1:3,2:1'), V('Débora Levy', '10/09/2026 20:00', 5000, '5:1'),
    V('Débora Levy', '15/09/2026 10:00', 99000, '9:9', { estado: 'cancelado' }),   // cancelado: no cuenta
    // Ana: cada 7 días; la última hace 20 → ATRASADA (pero ya le escribieron ayer)
    V('Ana Gómez', '20/08/2026 11:00', 30000, '3:1'), V('Ana Gómez', '27/08/2026 11:00', 30000, '3:1'), V('Ana Gómez', '03/09/2026 11:00', 30000, '3:2'),
    // Kiosco Tov (mayorista): cada 14 días; la última hace ~4 meses → SE ENFRIÓ
    V('Kiosco Tov', '01/05/2026 09:00', 0, '7:10', { tipo: 'Mayorista', total_usd: 150 }), V('Kiosco Tov', '15/05/2026 09:00', 0, '7:12,8:5', { tipo: 'Mayorista', total_usd: 200 }),
    // Sarah: cada 10 días; la última hace 8 → PRONTO (le toca en 2 días)
    V('Sarah G', '26/08/2026 10:00', 15000, '2:1'), V('Sarah G', '05/09/2026 10:00', 15000, '2:1'), V('Sarah G', '15/09/2026 10:00', 15000, '2:1'),
    // Iosi: cada 10 días; la última hace 3 → AL DÍA (no aparece)
    V('Iosi M', '10/09/2026 10:00', 12000, '4:1'), V('Iosi M', '20/09/2026 10:00', 12000, '4:1'),
    // Rafa: dos compras a 2 días y pico → el ritmo mínimo es 3 (no queda "atrasado" para siempre)
    V('Rafa K', '15/09/2026 10:00', 8000, '6:1'), V('Rafa K', '17/09/2026 12:00', 8000, '6:1'),
    // Pedro: una sola compra hace 22 días → "compró una vez"; Laura: una sola hace 3 días → todavía no
    V('Pedro P', '01/09/2026 12:00', 40000, '1:1'), V('Laura L', '20/09/2026 12:00', 10000, '1:1'),
    // Meir: le tocaría, pero Jony lo ocultó (es de la familia)
    V('Meir', '01/08/2026 10:00', 1000, '1:1'), V('Meir', '08/08/2026 10:00', 1000, '1:1'),
    // Una cotización no es una compra
    V('Cotizador', '01/08/2026 10:00', 5000, '1:1', { estado: 'cotizacion' }), V('Cotizador', '08/08/2026 10:00', 5000, '1:1', { estado: 'cotizacion' }),
  ];
  const clientes = [{ nombre: 'Débora Levy', telefono: '1144556677' }, { nombre: 'ANA GOMEZ', telefono: '1122334455' }];
  const marcas = { 'ana gomez': { avisado: '22/09/2026 18:00' }, meir: { oculto: true } };
  const ahora = F.tsDeFecha('23/09/2026 12:00');
  const r = F.calcularTeToca(ventas, clientes, marcas, ahora);
  const de = n => r.lista.find(x => x.nombre.toLowerCase().startsWith(n.toLowerCase()));

  const deb = de('débora');
  t.ok('a Débora (compra cada ~11 días, la última hace 13) LE TOCA', deb && deb.estado === 'le toca');
  t.eq('su ritmo sale de SU costumbre: mediana de 11 y 10 días → 11', deb.ritmo, 11);
  t.eq('los dos pedidos del mismo día son UNA compra (3 compras, no 4)', deb.pedidos, 3);
  t.eq('hace cuántos días fue la última', deb.dias, 12);
  t.ok('el cancelado no cuenta (si contara, la última sería el 15/09)', deb.ultima === '10/09/2026 20:00');
  t.ok('junta "Débora Levy" y "debora levy" en la misma persona', r.lista.filter(x => x.clave === 'debora levy').length === 1);
  t.eq('el teléfono sale de la ficha del cliente', deb.telefono, '1144556677');
  t.eq('el ticket promedio es por compra: (20.000+20.000+25.000)/3', deb.ticketARS, 21667);
  t.eq('trae su pedido de siempre: la última compra entera (los 2 pedidos del 10/09 juntos) + lo que repite', deb.habitual.map(x => x.id).sort(), ['1', '2', '5']);
  t.eq('con las cantidades de su última compra', deb.habitual.map(x => [x.id, x.q]).sort(), [['1', 3], ['2', 1], ['5', 1]]);
  t.eq('primero lo que más repite (el 1 está en sus 3 compras)', [deb.habitual[0].id, deb.habitual[0].veces], ['1', 3]);

  const ana = de('ana');
  t.ok('Ana (cada 7 días, la última hace 20) está ATRASADA', ana && ana.estado === 'atrasado');
  t.ok('pero como ya le escribiste ayer, queda marcada y va al final', ana.yaEscrito === true && r.lista[r.lista.length - 1].nombre !== 'Débora Levy' && r.lista.indexOf(ana) > r.lista.indexOf(deb));
  t.eq('y encuentra su teléfono aunque en la ficha esté en mayúsculas y sin tilde', ana.telefono, '1122334455');

  const kt = de('kiosco');
  t.ok('Kiosco Tov (cada 14 días, la última hace 4 meses) SE ENFRIÓ', kt && kt.estado === 'se enfrió');
  t.ok('es mayorista y su pedido de siempre incluye lo mayorista', kt.tipo === 'Mayorista' && kt.habitual.some(x => x.id === '7'));
  t.eq('el ticket en dólares, aparte', kt.ticketUSD, 175);

  const sa = de('sarah');
  t.ok('a Sarah (cada 10, la última hace 8) le toca PRONTO', sa && sa.estado === 'pronto' && sa.enDias === 2);
  t.ok('Iosi (la última hace 3 de un ritmo de 10) está al día: NO aparece', !de('iosi'));
  const rf = de('rafa');
  t.eq('el ritmo mínimo es 3 días (Rafa compró a 2 días de distancia)', rf && rf.ritmo, 3);
  t.ok('Meir está oculto: NO aparece', !de('meir'));
  t.ok('pero figura entre los ocultos (para poder volver a mostrarlo)', r.ocultos.some(x => x.clave === 'meir'));
  t.ok('una cotización no es una compra', !de('cotizador'));

  t.ok('Pedro (una sola compra hace 22 días) va a "compró una vez"', r.unaVez.some(x => x.nombre === 'Pedro P'));
  t.ok('Laura (una sola compra hace 3 días) todavía no', !r.unaVez.some(x => x.nombre === 'Laura L'));
  t.ok('el que compró una vez no se mezcla con los de ritmo', !de('pedro'));

  t.eq('el orden: primero a quien le toca, después atrasados, enfriados y pronto; lo ya avisado al final', r.lista.map(x => x.estado + (x.yaEscrito ? '·avisado' : '')), ['le toca', 'atrasado', 'se enfrió', 'pronto', 'atrasado·avisado']);
  t.eq('los números de la cabecera no cuentan lo ya avisado', r.cuantos, { leToca: 1, atrasados: 1, enfriados: 1, pronto: 1 });
  t.ok('calcula el ritmo general del negocio (para contexto)', typeof r.ritmoGeneral === 'number' && r.ritmoGeneral > 0);
  t.eq('sin ventas no se rompe', F.calcularTeToca([], [], {}, ahora).lista, []);

  // "lo de siempre" de la tienda NO cambió: sigue sin mirar lo mayorista si no se lo pide
  t.eq('pedidoHabitual sigue igual para la tienda minorista', F.pedidoHabitual([V('x', '01/09/2026 10:00', 0, '7:10', { tipo: 'Mayorista' })]).items, []);
  t.eq('y con el permiso, sí mira lo mayorista', F.pedidoHabitual([V('x', '01/09/2026 10:00', 0, '7:10', { tipo: 'Mayorista' })], true).items.map(x => x.id), ['7']);
  return t.result();
}
module.exports = { run };
