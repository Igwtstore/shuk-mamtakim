// 🔒 v4.95 — Lo que escribe un visitante (acciones públicas del motor, sin login) se guarda LIMPIO: sin
// etiquetas que después se ejecuten en el panel, identificadores con formato, el aviso de la tienda Candy
// solo a los números de la familia y notificarPedido ya no es pública. Corre el código REAL de index.ts.
const fs = require('fs');
const path = require('path');
const { suite } = require('./_helpers');
const TS = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'functions', 'api', 'index.ts'), 'utf8');

const linea = (nombre) => { const m = TS.match(new RegExp('^const ' + nombre + ' = .*$', 'm')); if (!m) throw new Error('no encontré ' + nombre); return m[0].replace(/: any/g, '') + '\n'; };
function bloque(src, inicio) {
  const i = src.indexOf(inicio);
  if (i === -1) throw new Error('no encontré ' + inicio);
  let j = src.indexOf('{', i + inicio.length - 1) + 1, d = 1;
  while (d > 0) { const c = src[j++]; if (c === '{') d++; else if (c === '}') d--; }
  return src.slice(i, j);
}

async function run() {
  const t = suite();
  const L = new Function(linea('_libre') + linea('_ident') + linea('_tel') + linea('WA_CANDY') + 'return { _libre, _ident, _tel, WA_CANDY };')();

  // Texto libre: sin < ni >, las comillas quedan (hay productos con comillas y el carrito es JSON).
  t.eq('un nombre con una etiqueta queda sin poder armarla', L._libre('<img src=x onerror=alert(1)>Ana'), 'img src=x onerror=alert(1)Ana');
  t.eq('<script> tampoco', L._libre('<script>robar()</script>'), 'scriptrobar()/script');
  t.eq('las comillas y los acentos quedan (D\'Angelo, «Pitzujim "Grill"»)', [L._libre("D'Angelo"), L._libre('Pitzujim "Grill"'), L._libre('Añá güera')], ["D'Angelo", 'Pitzujim "Grill"', 'Añá güera']);
  const carrito = JSON.stringify([{ n: 'Klik "azul"', q: 2 }]);
  t.eq('el carrito en JSON sigue siendo JSON', JSON.parse(L._libre(carrito, 8000)), [{ n: 'Klik "azul"', q: 2 }]);
  t.eq('los saltos de línea de las notas quedan; los caracteres de control raros, no', L._libre('línea 1\nlínea 2\u0000 fin'), 'línea 1\nlínea 2  fin');
  t.eq('tope de largo', L._libre('x'.repeat(500), 120).length, 120);
  t.eq('null / undefined → vacío', [L._libre(null), L._libre(undefined), L._ident(null), L._tel(undefined)], ['', '', '', '']);

  // Identificadores y teléfonos.
  t.eq('vid normal y los de robots por país pasan igual', [L._ident('v_k3j2h4g5f6d7'), L._ident('bot_IT'), L._ident('shuk:123')], ['v_k3j2h4g5f6d7', 'bot_IT', 'shuk:123']);
  t.eq("un vid que intenta romper un onclick queda inofensivo", L._ident("x')+alert(document.domain)+('"), 'xalertdocument.domain');
  t.eq('teléfono: solo dígitos, +, espacios, guiones y paréntesis', L._tel('+54 (11) 5555-4444\'"><b>'), '+54 (11) 5555-4444');

  // Cada acción pública que escribe usa los limpiadores.
  const usa = (accion, patrones) => { const b = bloque(TS, "if (accion === '" + accion + "') {"); return patrones.every((p) => b.includes(p)); };
  t.ok('venta: cliente, tipo, productos, forma de pago, notas y vid, limpios', usa('venta', ["_libre(Q('cliente'), 120)", "_libre(Q('tipo'), 30)", "_libre(Q('productos'), 20000)", "_libre(Q('formaPago'), 60)", "_libre(Q('notas'), 1000)", "_ident(Q('vid'))"]));
  t.ok('pedido Candy: hijo, cliente, teléfono, renglones, nota, id y vid, limpios', usa('registrarPedidoHijo', ["_ident(Q('hijo'), 20)", "_libre(Q('cliente'), 120)", "_tel(Q('telefono'))", "_libre(v, 200)", "_libre(Q('nota'), 500)", "_ident(Q('pedidoId'), 40)", "_ident(Q('vid'))", 'items: JSON.stringify(items)']));
  t.ok('Avisame Candy: producto, cliente, teléfono, hijo y código, limpios', usa('avisarmeCandy', ["_libre(Q('producto'), 150)", "_libre(Q('cliente'), 120)", "_tel(Q('telefono'))", "_ident(Q('hijo'), 20)", "_ident(Q('codigo'))"]));
  t.ok('Analítica (track): los 12 campos del visitante, limpios', usa('track', ['_ident(Q(\'vid\'))', "_libre(Q('pagina'), 120)", "_ident(Q('evento'), 40)", "_libre(Q('origen'), 200)", "_libre(Q('nombre'), 120)", "_tel(Q('telefono'))", "_libre(Q('producto'), 300)", "_libre(Q('carrito'), 8000)", '...tv']));
  t.ok('alta de mayorista: nombre y tipo, limpios', usa('registrarClienteMayorista', ["_libre(Q('nombre'), 120)", "_libre(Q('tipo'), 30)"]));
  t.ok('Avisame del Shuk: producto, nombre, teléfono, id y modo, limpios', usa('notificacion', ["_ident(P(body, 'productoId'), 20)", "_tel(P(body, 'telefono'))", "_libre(P(body, 'producto'), 150)", "_libre(P(body, 'nombre'), 120)", "_ident(P(body, 'modoCliente'), 20)"]));

  // El pedido tiene que traer "id:cantidad,…" (lo arma la tienda); otra cosa se rechaza antes de tocar nada.
  const reSU = new RegExp(TS.match(/if \(stockUpdates && !\/(.+?)\/\.test\(stockUpdates\)\) return json\(\{ error: 'pedido inválido' \}\);/)[1]);
  t.eq('formato del pedido: lo de la tienda pasa, lo inventado no', ['12:3', '12:3,45:10', "12:3,45'x:1", '12:3;DROP', '-1:2', '12:'].map((x) => reSU.test(x)), [true, true, false, false, false, false]);

  // El aviso de la tienda Candy manda WhatsApp SOLO a la familia.
  const src = bloque(TS, "if (accion === 'avisarmeCandy') {");
  const probarAviso = async (wa) => {
    const enviados = [];
    const q = { producto: 'Chicle', cliente: 'Ana', telefono: '', hijo: 'meir', codigo: 'C1', wa };
    await new Function('Q', 'json', 'sbInsert', 'sendTwilioWA', 'fechaAhora', 'telDudoso', '_libre', '_ident', '_tel', 'WA_CANDY',
      "return (async () => { const accion = 'avisarmeCandy'; " + src + ' })();')(
      (k) => q[k] || '', (o) => o, async () => {}, async (to) => { enviados.push(to); }, () => 'hoy', () => false, L._libre, L._ident, L._tel, L.WA_CANDY);
    return enviados;
  };
  t.eq('a Meir le llega el aviso', await probarAviso('5491171046383'), ['5491171046383']);
  t.eq('a un número cualquiera, NO (antes cualquiera podía usar el WhatsApp del negocio para mandar mensajes)', await probarAviso('5491100000000'), []);

  const publicas = TS.match(/const PUBLICAS = \[([^\]]+)\]/)[1];
  t.ok('notificarPedido ya no es pública (ninguna página la usa; servía para mandarle mensajes a Jony)', !publicas.includes("'notificarPedido'"));
  return t.result();
}
module.exports = { run };
