// ✂️ v4.99 — El sitio vive SOLO en el VPS (shukmamtakim.com.ar). Vercel queda como un cartel: todo lo que llega a un
// *.vercel.app se desvía a la misma ruta del dominio propio (los links viejos de clientes siguen andando). Las 3 copias de
// prueba del 2/7 (la mudanza a Supabase) mandan a la página buena. Y nada que se comparta arma links con Vercel.
const fs = require('fs');
const path = require('path');
const { suite } = require('./_helpers');
const RAIZ = path.join(__dirname, '..', '..');
const leer = (f) => fs.readFileSync(path.join(RAIZ, f), 'utf8');

async function run() {
  const t = suite();
  const vercel = JSON.parse(leer('vercel.json'));
  const r = (vercel.redirects || [])[0] || {};
  t.ok('Vercel desvía TODO al dominio propio, con la misma ruta', r.source === '/(.*)' && r.destination === 'https://shukmamtakim.com.ar/$1');
  t.ok('…solo cuando la visita llega a un *.vercel.app (así el VPS, que lee el mismo archivo, nunca se desvía a sí mismo)', Array.isArray(r.has) && r.has[0].type === 'host' && new RegExp('^' + r.has[0].value + '$').test('shuk-mamtakim.vercel.app') && !new RegExp('^' + r.has[0].value + '$').test('shukmamtakim.com.ar'));
  t.ok('…y temporal (si algún día se quiere volver, los navegadores no lo quedan guardando para siempre)', r.permanent === false);
  const srv = leer('despliegue/sitio/servidor.mjs');
  t.ok('el servidor del VPS no usa los desvíos de vercel.json (no hay vuelta en círculo)', !/vercel\.redirects/.test(srv) && /vercel\.rewrites/.test(srv));
  t.ok('las rutas de siempre siguen iguales (tienda, mayorista, tiendas del Candy)', ['/tienda', '/mayorista', '/candyshop/meir', '/candyshop/iosi'].every((s) => vercel.rewrites.some((x) => x.source === s)));

  const viejas = { 'paralelo.html': '/', 'tienda-paralelo.html': '/tienda.html', 'candyshop-paralelo.html': '/candyshop.html' };
  for (const [f, dest] of Object.entries(viejas)) {
    const h = leer(f);
    t.ok(`${f}: ya no es una copia del sistema, manda a ${dest} (con los mismos parámetros)`, h.length < 1500 && h.includes(`location.replace('${dest}' + location.search + location.hash)`) && h.includes('noindex') && !h.includes('supabase.co'));
  }
  const candy = leer('candyshop.html'), panel = leer('index.html'), tiendaCandy = leer('tienda.html');
  t.ok('«Compartir tienda» de los chicos arma el link con el dominio propio', candy.includes('const url = `https://shukmamtakim.com.ar/tienda.html?kid=${kid}`;'));
  const sinComentarios = (s) => s.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  t.eq('ninguna página arma links con vercel.app (fuera de los comentarios)', [panel, candy, tiendaCandy].map((s) => (sinComentarios(s).match(/vercel\.app/g) || []).length), [0, 0, 0]);
  return t.result();
}
module.exports = { run };
if (require.main === module) run().then(r => { r.forEach(x => console.log((x.ok ? '  ✓ ' : '  ✗ FALLÓ — ') + x.name)); const m = r.filter(x => !x.ok).length; console.log(m ? `❌ ${m} fallaron` : `✅ ${r.length}/${r.length}`); process.exit(m ? 1 : 0); });
