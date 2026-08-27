// 🧱 EL TOPE DE LAS 1000 FILAS — red de seguridad del bug del 26/08/2026.
// PostgREST corta toda respuesta en 1000 filas (db.max_rows) sin avisar: `limit=200000`
// devolvía las 1000 filas MÁS VIEJAS y la Analítica quedaba en cero desde julio.
// Este test toma sbGet/traficoParaAnalitica REALES del backend (supabase/functions/api/index.ts)
// y los corre contra una base simulada que impone ese mismo tope.
// Corre dentro del ritual: `node tests/unit/_run.js` (el runner espera el run() async).
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'functions', 'api', 'index.ts'), 'utf8');

// Saca una función por nombre (contando llaves) y le borra las anotaciones de TypeScript
// para poder evaluarla en Node. Testeamos el código de producción, no una copia.
function fnReal(nombre) {
  const re = new RegExp('(?:async\\s+)?function\\s+' + nombre + '\\s*\\(');
  const m = SRC.match(re);
  if (!m) throw new Error('no encontré ' + nombre);
  let i = SRC.indexOf('{', m.index + m[0].length), depth = 0, ini = m.index;
  for (; i < SRC.length; i++) { const c = SRC[i]; if (c === '{') depth++; else if (c === '}') { depth--; if (!depth) { i++; break; } } }
  return SRC.slice(ini, i)
    .replace(/\)\s*:\s*[A-Za-z<>\[\]|\s]+\s*\{/, ') {')          // tipo de retorno
    .replace(/(\w+)\s*:\s*(?:string|number|boolean|any)(\[\])?(?:\s*\|\s*null)?/g, '$1');   // params y consts
}

const codigo = [fnReal('sbPagina'), fnReal('sbGet'), fnReal('tsDeFecha'), fnReal('traficoParaAnalitica')].join('\n')
  + '\nreturn { sbGet, traficoParaAnalitica };';

const checks = [];
const ok = (n, c) => checks.push({ n, ok: !!c });
const eq = (n, a, b) => checks.push({ n: n + ' (=' + JSON.stringify(b) + ')', ok: JSON.stringify(a) === JSON.stringify(b) });

// ── Base simulada: N filas, y NUNCA devuelve más de 1000 por request (como PostgREST) ──
const TOPE = 1000;
let pedidos = [];
function baseFalsa(filas) {
  pedidos = [];
  return async (url) => {
    pedidos.push(url);
    const q = new URL(url).searchParams;
    const off = parseInt(q.get('offset') || '0') || 0;
    const lim = Math.min(parseInt(q.get('limit') || String(TOPE)) || TOPE, TOPE);   // ← el tope manda
    let datos = filas.slice();
    if ((q.get('order') || '').includes('id.desc')) datos = datos.slice().reverse();
    return { ok: true, json: async () => datos.slice(off, off + lim) };
  };
}

async function run() {
  const SB_URL = 'https://falso.supabase.co', SERVICE = 'x', SB_MAX_FILAS = 1000;
  const hacer = (filas) => new Function('SB_URL', 'SERVICE', 'SB_MAX_FILAS', 'fetch', codigo)(SB_URL, SERVICE, SB_MAX_FILAS, baseFalsa(filas));

  // 1) Tabla chica: una sola llamada, sin paginar de más.
  {
    const { sbGet } = hacer(Array.from({ length: 316 }, (_, i) => ({ id: i + 1 })));
    const r = await sbGet('productos', 'select=*');
    eq('tabla de 316 filas → trae las 316', r.length, 316);
    eq('tabla chica → una sola consulta', pedidos.length, 1);
  }

  // 2) EL BUG: 4.317 filas pedidas con limit=200000 (lo que hacía el backup / la analítica).
  {
    const filas = Array.from({ length: 4317 }, (_, i) => ({ id: i + 1 }));
    const { sbGet } = hacer(filas);
    const r = await sbGet('trafico', 'select=*&order=id&limit=200000');
    eq('4.317 filas → las trae TODAS (antes traía 1000)', r.length, 4317);
    eq('la última es la última de verdad', r[r.length - 1].id, 4317);
    ok('sin filas repetidas', new Set(r.map(x => x.id)).size === 4317);
  }

  // 3) Sin limit ni order y con más de 1000: ordena por id para no pisar páginas.
  {
    const { sbGet } = hacer(Array.from({ length: 2500 }, (_, i) => ({ id: i + 1 })));
    const r = await sbGet('ventas', 'select=*');
    eq('backup sin limit → trae las 2.500', r.length, 2500);
    ok('paginó ordenando por id', pedidos.some(u => u.includes('order=id.asc')));
  }

  // 4) Un limit chico se respeta tal cual (no rompe las 150 consultas existentes).
  {
    const { sbGet } = hacer(Array.from({ length: 4000 }, (_, i) => ({ id: i + 1 })));
    const r = await sbGet('trafico', 'select=*&limit=10');
    eq('limit=10 → 10 filas', r.length, 10);
    eq('limit=10 → una sola consulta', pedidos.length, 1);
  }

  // 5) Un limit intermedio (2.500) corta justo, sin traer de más.
  {
    const { sbGet } = hacer(Array.from({ length: 9000 }, (_, i) => ({ id: i + 1 })));
    const r = await sbGet('ventas', 'select=*&order=id&limit=2500');
    eq('limit=2500 → exactamente 2.500', r.length, 2500);
  }

  // 6) Analítica de 7 días sobre 6 meses de historial: trae lo NUEVO y frena al pasarse.
  {
    const hoy = Date.now();
    const dd = (t) => { const d = new Date(t), p = n => String(n).padStart(2, '0'); return p(d.getUTCDate()) + '/' + p(d.getUTCMonth() + 1) + '/' + d.getUTCFullYear() + ' 12:00'; };
    // 5.000 filas: una por hora hacia atrás (≈208 días). Las últimas 1000 cubren ~41 días.
    const filas = Array.from({ length: 5000 }, (_, i) => ({ id: 5000 - i, fecha: dd(hoy - i * 3600000) })).reverse();
    const { traficoParaAnalitica } = hacer(filas);
    const r = await traficoParaAnalitica(7);
    ok('7 días: trae la fila más reciente', r.some(x => x.id === 5000));
    ok('7 días: cubre la ventana completa (168 h)', r.length >= 168);
    ok('7 días: NO se trae los 6 meses enteros', r.length < 5000);
    ok('7 días: cortó rápido (pocas consultas)', pedidos.length <= 3);
  }

  // 7) dias=0 ("todo") sí trae el historial completo.
  {
    const filas = Array.from({ length: 3200 }, (_, i) => ({ id: i + 1, fecha: '01/06/2026 10:00' }));
    const { traficoParaAnalitica } = hacer(filas);
    const r = await traficoParaAnalitica(0);
    eq('dias=0 → historial completo', r.length, 3200);
  }

  return checks.map(c => ({ name: c.n, ok: c.ok }));
}

module.exports = { run };
