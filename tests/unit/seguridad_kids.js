// 🔒 v4.96 — La cuenta de los chicos (kids@candyshop.com) puede SOLO lo que usa su panel, y Miri no está en el equipo.
// La lista del motor (ACCIONES_KIDS) se compara con las acciones que de verdad llama candyshop.html: si el panel suma
// una acción nueva y nadie la agrega a la lista, esta prueba falla (antes de que al chico le salte "no disponible").
const fs = require('fs');
const path = require('path');
const { suite } = require('./_helpers');
const RAIZ = path.join(__dirname, '..', '..');
const TS = fs.readFileSync(path.join(RAIZ, 'supabase', 'functions', 'api', 'index.ts'), 'utf8');
const CANDY = fs.readFileSync(path.join(RAIZ, 'candyshop.html'), 'utf8');

async function run() {
  const t = suite();
  const lista = [...TS.match(/const ACCIONES_KIDS = \[([\s\S]*?)\];/)[1].matchAll(/'([A-Za-z]+)'/g)].map((m) => m[1]);
  const publicas = [...TS.match(/const PUBLICAS = \[([^\]]+)\]/)[1].matchAll(/'([A-Za-z]+)'/g)].map((m) => m[1]);
  // Lo que llama el panel: api('x'…), accion: 'x', y el ternario de alta/edición de producto.
  const usadas = new Set([
    ...[...CANDY.matchAll(/\bapi\(['"]([A-Za-z]+)['"]/g)].map((m) => m[1]),
    ...[...CANDY.matchAll(/accion\s*:\s*['"]([A-Za-z]+)['"]/g)].map((m) => m[1]),
    ...[...CANDY.matchAll(/const accion = [^;]*?\? *'([A-Za-z]+)' *: *'([A-Za-z]+)'/g)].flatMap((m) => [m[1], m[2]]),
  ]);
  const faltan = [...usadas].filter((a) => !lista.includes(a) && !publicas.includes(a));
  t.eq('todo lo que usa el panel de los chicos está en su lista (' + usadas.size + ' acciones)', faltan, []);
  const sobran = lista.filter((a) => !usadas.has(a));
  t.eq('la lista no tiene acciones que el panel no usa', sobran, []);
  const SENSIBLES = ['ventas', 'getPagos', 'getClientes', 'notificaciones', 'getAnalitica', 'panelAdmin', 'getGanancias', 'getCortes', 'hacerCorte', 'confirmarCobro', 'enviarPush', 'setStock', 'eliminarProducto', 'editarProducto', 'guardarClaveIA', 'guardarClaveGemini', 'setEstadoTienda', 'setGeoGate', 'renumerarVentas', 'registrarRetiro', 'notasClientes', 'getFichaVisitante', 'getMovsSocios', 'getCajaEnvios', 'historialCompras'];
  t.eq('ninguna acción sensible del Shuk está en la lista de los chicos', SENSIBLES.filter((a) => lista.includes(a)), []);
  t.ok('el portero corta a los chicos fuera de su lista (y con un texto que NO dispara el refresco de sesión)',
    /if \(usuario && usuario\.email === MAIL_KIDS && ACCIONES_KIDS\.indexOf\(accion\) === -1\) return json\(\{ error: 'no disponible para esta cuenta' \}\);/.test(TS));
  const equipo = TS.match(/const MAILS_EQUIPO = (\[[^\]]+\]);/)[1];
  t.ok('Miri ya no está en el equipo (pedido del dueño: "que MYRI no tenga acceso a NADA")', !/myri@/i.test(equipo) && /admin@shukmamtakim\.com/.test(equipo) && /kids@candyshop\.com/.test(equipo));
  return t.result();
}
module.exports = { run };
