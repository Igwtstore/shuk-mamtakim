// 🔴 HOY CONTRA EL MISMO DÍA DE LA SEMANA PASADA (v4.79) — la cuenta que alimenta la pestaña En vivo.
// Extrae hoyVsSemana() REAL del motor y la corre contra tráfico armado a mano.
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
    .replace(/(\w+)\s*:\s*(?:string|number|boolean|any)(\[\])?(?=\s*[,)=])/g, '$1')
    .replace(/const (\w+)\s*:\s*any(\[\])?\s*=/g, 'const $1 =')
    .replace(/\(([a-z]\w*)\s*:\s*any\)/g, '($1)');
}
const { hoyVsSemana, tsDeFecha, fechaAhora } = new Function(fnReal('tsDeFecha') + '\n' + fnReal('fechaAhora') + '\n' + fnReal('hoyVsSemana') + '\nreturn { hoyVsSemana, tsDeFecha, fechaAhora };')();

// Igual que en analitica(): cada fila viene con su fecha ya parseada.
const pf = f => { const m = f.match(/(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}))?/); return { ts: Date.UTC(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0)), hora: +(m[4] || 0), dk: m[3] + '-' + m[2] + '-' + m[1] }; };
const fila = (fecha, evento = 'visita') => ({ r: { fecha, evento }, t: pf(fecha) });
const hoyBA = fechaAhora().slice(0, 10);                       // 'dd/MM/yyyy' en hora de Buenos Aires
const horaBA = +fechaAhora().slice(11, 13);
const [dd, mm, yy] = hoyBA.split('/');
const menosDias = n => { const d = new Date(Date.UTC(+yy, +mm - 1, +dd - n)); const p = x => String(x).padStart(2, '0'); return p(d.getUTCDate()) + '/' + p(d.getUTCMonth() + 1) + '/' + d.getUTCFullYear(); };

async function run() {
  const t = suite();
  const todas = [
    fila(hoyBA + ' 09:15'), fila(hoyBA + ' 09:40'), fila(hoyBA + ' 21:05'),
    fila(hoyBA + ' 09:50', 'carrito'),                        // no es visita: no cuenta
    fila(menosDias(7) + ' 09:10'), fila(menosDias(7) + ' 14:00'), fila(menosDias(7) + ' 14:30'),
    fila(menosDias(6) + ' 09:10'),                            // ayer de la semana pasada: no es el mismo día
    fila(menosDias(14) + ' 03:00'),                           // más viejo todavía: solo sirve para "hace7Disponible"
  ];
  const r = hoyVsSemana(todas);
  t.ok('devuelve las dos series de 24 horas', r && r.hoy.length === 24 && r.hace7.length === 24);
  t.eq('hoy 9 h = 2 visitas (el carrito no cuenta)', r.hoy[9], 2);
  t.eq('hoy 21 h = 1', r.hoy[21], 1);
  t.eq('hace 7 días: 9 h = 1, 14 h = 2', [r.hace7[9], r.hace7[14]], [1, 2]);
  t.eq('el día anterior de la semana pasada no se mezcla', r.hace7.reduce((a, n) => a + n, 0), 3);
  t.eq('la hora actual es la de Buenos Aires', r.horaActual, horaBA);
  t.ok('el nombre del día es uno de los siete', ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'].includes(r.diaNombre));
  t.ok('con datos de 14 días atrás, la comparación está disponible', r.hace7Disponible === true);
  const corto = hoyVsSemana([fila(hoyBA + ' 09:15'), fila(menosDias(1) + ' 10:00')]);
  t.ok('con solo 2 días de datos avisa que la semana pasada NO está', corto.hace7Disponible === false);
  t.eq('sin filas: series en cero, no explota', hoyVsSemana([]).hoy.reduce((a, n) => a + n, 0), 0);
  return t.result();
}
module.exports = { run };
