// 📅 v4.84 — TODO EL DÍA en la pestaña En vivo.
// Motor: el lector tolerante de las tandas de vistas (rescata las que llegaron cortadas) y el
// evento compacto que viaja al panel. Panel: cómo se juntan motor y en vivo sin repetir, cómo se
// agrupa por visita, el resumen de una línea y el paso a paso. Todo con las funciones REALES.
const fs = require('fs');
const path = require('path');
const { suite } = require('./_helpers');
const TS = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'functions', 'api', 'index.ts'), 'utf8');
const HTML = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
function bloque(src, nombre) {
  const re = new RegExp('(?:async\\s+)?function\\s+' + nombre + '\\s*\\(');
  const m = src.match(re); if (!m) throw new Error('no encontré ' + nombre);
  let i = src.indexOf('{', m.index + m[0].length), depth = 0;
  for (; i < src.length; i++) { const c = src[i]; if (c === '{') depth++; else if (c === '}') { depth--; if (!depth) { i++; break; } } }
  return src.slice(m.index, i);
}
const sinTipos = t => t.replace(/(\w+)\s*:\s*(?:string|number|boolean|any)(\[\])?(?=\s*[,)=])/g, '$1').replace(/const (\w+)\s*:\s*any(\[\])?\s*=/g, 'const $1 =')
  .replace(/\(([a-z]\w*)\s*:\s*any\)/g, '($1)').replace(/\s+as\s+(any|number|string|boolean)\b/g, '');
const M = new Function('const esJSON = x => (x || \'\').charCodeAt(0) === 123;\n' + sinTipos(bloque(TS, 'leerVistas')) + '\n' + sinTipos(bloque(TS, 'compactarEvento')) + '\nreturn { leerVistas, compactarEvento };')();
const stubs = "const esc = s => String(s == null ? '' : s).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c]); const _anaPlata = n => '$ ' + Math.round(n || 0).toLocaleString('es-AR'); const _anaPlataMix = (a, u) => '$ ' + a; const _VIVO_SESION_MS = 30 * 60000;\n";
const nombres = ['_vivoDur', '_vivoHora', '_vivoVistos', '_vivoTexto', '_vivoUnir', '_vivoSesionNueva', '_vivoSesionSumar', '_vivoSesiones', '_vivoResumenSesion', '_vivoPasos', '_vivoHoyK', '_vivoInicioDe'];
const P = new Function(stubs + nombres.map(n => bloque(HTML, n)).join('\n') + '\nreturn {' + nombres.join(',') + '};')();

async function run() {
  const t = suite();
  // ── Motor ──
  const ok = JSON.stringify({ v: [{ i: '1', n: 'Klik' }, { i: '2', n: 'Bamba "Osem"' }] });
  t.eq('vistas: una tanda sana se lee entera', M.leerVistas(ok), ['Klik', 'Bamba "Osem"']);
  const cortada = ok.slice(0, ok.indexOf('Bamba') + 3);   // cortada en el medio del segundo nombre
  t.eq('vistas: una tanda CORTADA rescata los nombres completos', M.leerVistas(cortada), ['Klik']);
  t.eq('vistas: basura no rompe', M.leerVistas('no es json'), []);
  const r = (x) => ({ id: 7, ts: '2026-09-22T20:15:11.123456+00:00', vid: 'v_a', pagina: 'tienda', origen: 'wa', dispositivo: 'celular', ciudad: 'CABA', pais: 'Argentina', nombre: '', telefono: '', total: '0', carrito: '', ...x });
  const cv = M.compactarEvento(r({ evento: 'vistas', detalle: ok }));
  t.eq('compacto: vistas viaja como lista de nombres, sin el JSON', [cv.vistos, cv.detalle, cv.id, cv.t], [['Klik', 'Bamba "Osem"'], undefined, 'm7', Date.parse('2026-09-22T20:15:11.123Z')]);
  const cvi = M.compactarEvento(r({ evento: 'visita', detalle: JSON.stringify({ tz: 'x', ap: 'iPhone', vip: 'tok', idi: 'es' }) }));
  t.eq('compacto: la visita solo lleva el aparato y si vino por VIP', [cvi.aparato, cvi.vip, cvi.detalle], ['iPhone', 1, undefined]);
  const cc = M.compactarEvento(r({ evento: 'carrito', detalle: 'Klik', carrito: '[{"n":"Klik","q":2,"p":1000}]', total: '2000' }));
  t.eq('compacto: el carrito conserva producto, carrito y total', [cc.detalle, cc.carrito, cc.total], ['Klik', '[{"n":"Klik","q":2,"p":1000}]', 2000]);
  t.ok('compacto: la salida conserva su JSON (segundos)', M.compactarEvento(r({ evento: 'salida', detalle: '{"seg":86}' })).detalle === '{"seg":86}');

  // ── Panel: juntar motor + en vivo sin repetir ──
  const T0 = Date.UTC(2026, 8, 22, 23, 0, 0);   // 20:00 en Buenos Aires
  const e = (id, vid, evento, seg, x = {}) => ({ id, t: T0 + seg * 1000, vid, evento, pagina: 'tienda', ...x });
  const motor = [e('m1', 'v_a', 'visita', 0), e('m2', 'v_a', 'carrito', 60, { detalle: 'Klik' }), e('m3', 'v_b', 'visita', 5), e('m4', 'v_a', 'carrito', 62, { detalle: 'Bamba' })];
  const vivos = [e(9001, 'v_a', 'carrito', 61, { detalle: 'Klik' }), e(9002, 'v_a', 'latido', 90)];
  const unidos = P._vivoUnir(motor, vivos);
  t.eq('unir: el gemelo del motor se descarta y queda el de en vivo; el latido no entra', unidos.map(x => x.id).sort(), ['m1', 'm3', 'm4', 9001].map(String).sort().map(x => isNaN(x) ? x : Number(x)).sort());
  t.eq('unir: empareja UNO a UNO (dos carritos del motor, uno en vivo: se va uno solo)', unidos.filter(x => x.vid === 'v_a' && x.evento === 'carrito').length, 2);
  t.eq('unir: un evento en vivo sin gemelo cercano (más de 30 s) no borra nada', P._vivoUnir([e('m1', 'v_a', 'visita', 0)], [e(1, 'v_a', 'visita', 45)]).length, 2);

  // ── Panel: visita por visita ──
  const evs = [
    e('a1', 'v_a', 'visita', 0, { detalle: JSON.stringify({ ap: 'iPhone' }), ciudad: 'Castelar' }),
    e('a2', 'v_a', 'vistas', 20, { detalle: JSON.stringify({ v: [{ n: 'Klik' }, { n: 'Bamba' }] }) }),
    e('a3', 'v_a', 'vistas', 50, { vistos: ['Bamba', 'Elite'] }),
    e('a4', 'v_a', 'carrito', 60, { detalle: 'Klik', carrito: '[{"n":"Klik","q":2,"p":1000}]', total: 2000 }),
    e('a5', 'v_a', 'busqueda', 70, { detalle: 'gum', total: 0 }),
    e('a6', 'v_a', 'checkout', 80, { total: 2000, nombre: 'Ana', telefono: '1155551234' }),
    e('a7', 'v_a', 'pedido', 90, { total: 2000 }),
    e('a8', 'v_a', 'salida', 100, { detalle: '{"seg":95}' }),
    e('a9', 'v_a', 'visita', 100 + 45 * 60),                 // vuelve 45 minutos después: otra visita
    e('b1', 'v_b', 'visita', 30, { pagina: 'mayorista' }),
    e('b2', 'v_b', 'quitar', 40, { detalle: 'Klik', total: 0 }),
  ];
  const ses = P._vivoSesiones(evs);
  t.eq('sesiones: 3 visitas (Ana dos veces, separadas por 45 min; y el mayorista)', ses.length, 3);
  t.eq('sesiones: la más nueva primero (la vuelta de Ana)', ses[0].eventos.map(x => x.id), ['a9']);
  const ana = ses.find(s => s.eventos.some(x => x.id === 'a1'));
  t.eq('sesión de Ana: nombre, aparato, ciudad, productos vistos sin repetir', [ana.nombre, ana.aparato, ana.ciudad, [...ana.vistos]], ['Ana', 'iPhone', 'Castelar', ['Klik', 'Bamba', 'Elite']]);
  t.eq('sesión de Ana: carrito, búsqueda vacía, pedido y se fue a los 95 s', [ana.agregados, ana.busquedas, !!ana.pedido, ana.seFue, ana.seg], [['Klik'], [{ q: 'gum', vacia: true }], true, true, 95]);
  const res = P._vivoResumenSesion(ana).join(' · ');
  t.ok('resumen: miró 3 productos, buscó sin resultados, agregó, pidió con plata, se fue', res.includes('miró 3 productos') && res.includes('sin resultados') && res.includes('agregó Klik') && res.includes('pidió') && res.includes('$') && res.includes('se fue a los 1 min 35 s'));
  t.ok('resumen: si pidió, no repite "llegó al checkout"', !res.includes('checkout'));
  const may = ses.find(s => s.vid === 'v_b');
  t.ok('resumen del mayorista: entró a la mayorista y sacó Klik', P._vivoResumenSesion(may).join(' · ').includes('mayorista') && P._vivoResumenSesion(may).join(' · ').includes('sacó Klik'));
  const pasos = P._vivoPasos(ana);
  t.ok('paso a paso: las dos tandas de vistas seguidas van en UN renglón con los 3 productos', (pasos.match(/miró/g) || []).length === 1 && pasos.includes('miró 3: Klik, Bamba, Elite'));
  t.ok('paso a paso: con la hora de Buenos Aires (20:00:00)', pasos.includes('20:00:00'));
  t.ok('el detalle se escapa (no se inyecta HTML)', !P._vivoResumenSesion(P._vivoSesiones([e('x', 'v_x', 'carrito', 0, { detalle: '<img src=x>' })])[0]).join('').includes('<img'));

  // ── Panel: textos de los eventos de la Fase 3 (antes salían crudos) ──
  t.ok('texto: vistas dice cuántos y cuáles', P._vivoTexto({ evento: 'vistas', vistos: ['Klik', 'Bamba', 'Elite', 'Pesek'] }).includes('miró 4 productos: Klik, Bamba, Elite…'));
  t.ok('texto: vistas desde el JSON en vivo, aun cortado', P._vivoTexto({ evento: 'vistas', detalle: cortada }).includes('miró 1 producto: Klik'));
  t.ok('texto: sacar y bajar cantidad se distinguen', P._vivoTexto({ evento: 'quitar', detalle: 'Klik', total: 0 }).includes('sacó') && P._vivoTexto({ evento: 'quitar', detalle: 'Klik', total: 2 }).includes('bajó'));
  t.ok('texto: aviso y compartir', P._vivoTexto({ evento: 'aviso' }).includes('aviso') && P._vivoTexto({ evento: 'compartir', detalle: 'Klik' }).includes('compartió'));
  t.ok('el día de hoy es el de Buenos Aires (AAAA-MM-DD)', /^\d{4}-\d{2}-\d{2}$/.test(P._vivoHoyK()));
  t.eq('el día arranca a las 00:00 de Buenos Aires', new Date(P._vivoInicioDe('2026-09-22')).toISOString(), '2026-09-22T03:00:00.000Z');
  return t.result();
}
module.exports = { run };
