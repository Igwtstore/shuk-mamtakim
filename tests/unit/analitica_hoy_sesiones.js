// 🧹 v4.80 — modo "Hoy", sesiones de 30 minutos y lo que se aparta (Candy, diagnóstico).
// Corre la analitica() REAL del motor contra tráfico armado a mano.
const fs = require('fs');
const path = require('path');
const { suite } = require('./_helpers');
const SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'functions', 'api', 'index.ts'), 'utf8');
function fnReal(nombre) {
  const re = new RegExp('(?:async\\s+)?function\\s+' + nombre + '\\s*\\(');
  const m = SRC.match(re);
  if (!m) throw new Error('no encontré ' + nombre);
  let i = SRC.indexOf('{', m.index + m[0].length), depth = 0;
  for (; i < SRC.length; i++) { const c = SRC[i]; if (c === '{') depth++; else if (c === '}') { depth--; if (!depth) { i++; break; } } }
  return SRC.slice(m.index, i)
    .replace(/\)\s*:\s*(number \| null|any\[\]|any|string|boolean)\s*\{/, ') {')
    .replace(/:\s*Record<[^>]+>/g, '')
    .replace(/(\w+)\s*:\s*(?:string|number|boolean|any)(\[\])?(?=\s*[,)=])/g, '$1')
    .replace(/const (\w+)\s*:\s*any(\[\])?\s*=/g, 'const $1 =')
    .replace(/\(([a-z]\w*)\s*:\s*any\)/g, '($1)')
    .replace(/\((\w+)\s*:\s*any,\s*(\w+)\s*:\s*any\)/g, '($1, $2)')
    .replace(/\s+as\s+(any|number|string|boolean)\b/g, '')
    .replace(/(\w+)!\./g, '$1.')
    .replace(/(\w+)!\[/g, '$1[')
    .replace(/\)!\./g, ').');
}
const codigo = 'const esJSON = x => (x || \'\').charCodeAt(0) === 123;\n' + fnReal('tsDeFecha') + '\n' + fnReal('leerVistas') + '\n' + fnReal('fechaAhora') + '\n' + fnReal('hoyVsSemana') + '\n' + fnReal('analitica') + '\nreturn { analitica, fechaAhora };';
const { analitica, fechaAhora } = new Function(codigo)();

const hoyBA = fechaAhora().slice(0, 10), horaBA = +fechaAhora().slice(11, 13);
const [dd, mm, yy] = hoyBA.split('/');
const dia = n => { const d = new Date(Date.UTC(+yy, +mm - 1, +dd - n)); const p = x => String(x).padStart(2, '0'); return p(d.getUTCDate()) + '/' + p(d.getUTCMonth() + 1) + '/' + d.getUTCFullYear(); };
const hhmm = (h, m) => String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
const ev = (vid, evento, fecha, extra = {}) => ({ fecha, vid, pagina: 'tienda', evento, origen: 'directo', dispositivo: 'celular', ciudad: 'CABA', pais: 'Argentina', nombre: '', telefono: '', detalle: '', carrito: '', total: 0, ...extra });

async function run() {
  const t = suite();
  const h = Math.max(1, Math.min(horaBA, 22));   // una hora de hoy que ya pasó (o la actual)
  const rows = [
    // Ana: tres cargas de página en 10 minutos = 1 sesión; y vuelve 2 horas después = otra sesión
    ev('v_ana', 'visita', dia(0) + ' ' + hhmm(h - 1, 0)), ev('v_ana', 'visita', dia(0) + ' ' + hhmm(h - 1, 5)), ev('v_ana', 'carrito', dia(0) + ' ' + hhmm(h - 1, 10), { detalle: 'Klik' }),
    ev('v_ana', 'visita', dia(0) + ' ' + hhmm(h, 0)),
    // Beto: solo ayer (no entra en "hoy")
    ev('v_beto', 'visita', dia(1) + ' 10:00'), ev('v_beto', 'visita', dia(1) + ' 20:00'),
    // Candy y diagnóstico: hoy, pero NO son tráfico del Shuk
    ev('v_meir', 'visita', dia(0) + ' ' + hhmm(h, 1), { pagina: 'candy-meir' }),
    ev('v_diag', 'visita', dia(0) + ' ' + hhmm(h, 2), { origen: 'diagnostico' }),
  ];
  const hoy = analitica(rows, 1, [], [], [], null, { soloHoy: true });
  t.eq('HOY: solo las visitas de hoy (Ana ×3; Beto era ayer)', hoy.resumen.visitas, 3);
  t.eq('HOY: 1 persona única', hoy.resumen.unicos, 1);
  t.eq('HOY: 2 sesiones de Ana (10 min seguidos = 1; vuelve 2 h después = otra)', hoy.resumen.sesiones, 2);
  // El que entra una vez y toca el carrito 40 minutos después NO "volvió": sigue en la misma sesión.
  const largo = analitica([ev('v_lento', 'visita', dia(0) + ' ' + hhmm(h - 1, 0)), ev('v_lento', 'carrito', dia(0) + ' ' + hhmm(h - 1, 40), { detalle: 'Klik' }), ev('v_lento', 'salida', dia(0) + ' ' + hhmm(h - 1, 55), { detalle: '{"seg":3300}' })], 1, [], [], [], null, { soloHoy: true });
  t.eq('una visita larga (carrito a los 40 min, salida a los 55) = 1 sesión, no 3', largo.resumen.sesiones, 1);
  t.ok('sesiones nunca supera a visitas', largo.resumen.sesiones <= largo.resumen.visitas && hoy.resumen.sesiones <= hoy.resumen.visitas);
  t.eq('HOY: Candy y diagnóstico apartados, y se informa cuánto', hoy.excluidos, { candy: 1, diagnostico: 1 });
  t.ok('HOY: la comparativa es contra ayer completo (2 visitas de Beto)', hoy.comparativa && hoy.comparativa.visitas.anterior === 2 && hoy.comparativa.visitas.actual === 3);
  t.eq('HOY: viene marcado como soloHoy', hoy.soloHoy, true);
  const dos = analitica(rows, 7, [], [], [], null, null);
  t.eq('7 DÍAS: todas las visitas del Shuk (5), sin Candy ni diagnóstico', dos.resumen.visitas, 5);
  t.eq('7 DÍAS: sesiones = 2 de Ana + 2 de Beto (10:00 y 20:00 están a 10 h)', dos.resumen.sesiones, 4);
  const soloCandy = analitica([ev('v_meir', 'visita', dia(0) + ' ' + hhmm(h, 1), { pagina: 'candy-meir' })], 7, [], [], [], null, null);
  t.ok('si solo hay tráfico de Candy, el Shuk está vacío (y dice que apartó 1)', soloCandy.vacio === true && soloCandy.excluidos.candy === 1);
  return t.result();
}
module.exports = { run };
