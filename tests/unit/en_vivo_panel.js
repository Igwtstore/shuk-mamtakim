// 🔴 EN VIVO — la lógica del panel (index.html) que decide quién está ahora y qué carrito trae.
// Extrae las funciones REALES de index.html y las corre con eventos armados a mano.
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
const stubs = "const esc = s => String(s == null ? '' : s).replace(/[<>const esc = s => String(s == null ? '' : s);]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c]); const _anaPlataMix = (a, u) => '$ ' + a + (u ? ' + U$S ' + u : ''); const _VIVO_ACTIVO_MS = 5 * 60000;\n";
const F = new Function(stubs + ['_vivoApodo', '_vivoDur', '_vivoHace', '_vivoTexto', '_vivoAgrupar'].map(cuerpo).join('\n') + '\nreturn { _vivoApodo, _vivoDur, _vivoHace, _vivoTexto, _vivoAgrupar };')();

async function run() {
  const t = suite();
  const T0 = 1_700_000_000_000;
  const min = n => T0 + n * 60000;
  let id = 0;
  const ev = (vid, evento, t, extra = {}) => ({ id: ++id, t, vid, evento, pagina: 'tienda', ...extra });
  const eventos = [
    ev('v_ana', 'visita', min(0), { ciudad: 'Castelar', dispositivo: 'celular' }),
    ev('v_ana', 'carrito', min(1), { detalle: 'Klik', carrito: '[{"n":"Klik","q":2,"p":1000}]', total: 2000 }),
    ev('v_ana', 'carrito', min(2), { detalle: 'Bamba', carrito: '[{"n":"Klik","q":2,"p":1000},{"n":"Bamba","q":1,"p":500}]', total: 2500 }),
    ev('v_ana', 'checkout', min(3), { carrito: '[{"n":"Klik","q":2,"p":1000},{"n":"Bamba","q":1,"p":500}]', total: 2500, nombre: 'Ana', telefono: '1155551234' }),
    ev('v_beto', 'visita', min(0)),
    ev('v_beto', 'salida', min(2), { detalle: '{"seg":95,"int":3,"prod":4}' }),
    ev('v_caro', 'visita', min(-20)),                       // hace 20 minutos y nada más: ya no está
    ev('v_dani', 'visita', min(1), { pagina: 'mayorista' }),
    ev('v_dani', 'latido', min(4), { pagina: 'mayorista', detalle: '{"seg":180,"int":2,"prod":3}', carrito: '[]', total: 0 }),
    ev('v_eli', 'carrito', min(3), { detalle: 'Elite', carrito: '[{"n":"Elite","q":1,"p":9000}]', total: 9000 }),
    ev('v_eli', 'pedido', min(4), { total: 9000 }),
  ];
  const ahora = min(5);
  // Los eventos llegan desordenados (SSE + foto): el agrupador tiene que ordenarlos solo.
  const { activos, todos } = F._vivoAgrupar(eventos.slice().reverse(), ahora);
  const por = Object.fromEntries(todos.map(p => [p.vid, p]));
  t.eq('están ahora: Ana, Dani y Eli (Beto se fue, Caro es vieja)', activos.map(p => p.vid).sort(), ['v_ana', 'v_dani', 'v_eli']);
  t.eq('ordenados por la última señal, la más nueva primero', activos.map(p => p.vid), ['v_dani', 'v_eli', 'v_ana']);
  t.eq('Ana: etapa checkout, con su carrito de 2 renglones y $ 2.500', [por.v_ana.etapa, por.v_ana.items.length, por.v_ana.total], ['checkout', 2, 2500]);
  t.eq('Ana: nombre, teléfono, ciudad y aparato vienen del evento que los trajo', [por.v_ana.nombre, por.v_ana.telefono, por.v_ana.ciudad, por.v_ana.dispositivo], ['Ana', '1155551234', 'Castelar', 'celular']);
  t.eq('Ana: los productos que fue agregando, sin repetir', por.v_ana.productos, ['Klik', 'Bamba']);
  t.eq('Beto: se fue, y se sabe cuánto estuvo', [por.v_beto.seFue, por.v_beto.seg], [true, 95]);
  t.eq('Dani: el latido lo mantiene "ahora", trae la página mayorista y el carrito vacío', [por.v_dani.pagina, por.v_dani.items.length, por.v_dani.seg], ['mayorista', 0, 180]);
  t.eq('Eli: después del pedido el carrito se vacía (ya es pedido)', [por.v_eli.etapa, por.v_eli.items, por.v_eli.total], ['pedido', null, 0]);
  t.eq('un visitante que vuelve después de irse vuelve a estar', F._vivoAgrupar([ev('v_beto', 'salida', min(2)), ev('v_beto', 'latido', min(4))], ahora).activos.length, 1);
  t.eq('apodo estable a partir del identificador', F._vivoApodo('v_k3x9a4f2'), '#A4F2');
  t.eq('duración legible', [F._vivoDur(45), F._vivoDur(125), F._vivoDur(120)], ['45 s', '2 min 5 s', '2 min']);
  t.eq('hace cuánto', [F._vivoHace(min(4), ahora), F._vivoHace(min(-30), ahora), F._vivoHace(min(-200), ahora)], ['hace 1 min', 'hace 35 min', 'hace 3 h']);
  t.ok('texto del checkout con plata', F._vivoTexto({ evento: 'checkout', total: 2500 }).includes('checkout') && F._vivoTexto({ evento: 'checkout', total: 2500 }).includes('2500'));
  t.ok('búsqueda sin resultados se marca', F._vivoTexto({ evento: 'busqueda', detalle: 'Gum', total: 0 }).includes('sin resultados'));
  t.ok('búsqueda con resultados no se marca', !F._vivoTexto({ evento: 'busqueda', detalle: 'Mentos', total: 3 }).includes('sin resultados'));
  t.ok('la salida dice cuánto estuvo', F._vivoTexto({ evento: 'salida', detalle: '{"seg":95}' }).includes('1 min 35 s'));
  t.ok('el detalle se escapa (no se inyecta HTML)', !F._vivoTexto({ evento: 'carrito', detalle: '<img src=x>' }).includes('<img'));
  return t.result();
}
module.exports = { run };
