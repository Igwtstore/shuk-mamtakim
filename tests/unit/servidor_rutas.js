// 🔒 v4.94 — El filtro de archivos del servidor del VPS (despliegue/sitio/rutas.mjs, el REAL): los trucos
// de la auditoría del 23/09 ('/%64espliegue/shuk.env', '//despliegue/…', '%74ests', '.git'…) ya no
// sacan nada, y lo que el sitio sí necesita (páginas, fotos, manifiestos, service workers) sigue saliendo.
const path = require('path');
const { pathToFileURL } = require('url');
const { suite } = require('./_helpers');

async function run() {
  const t = suite();
  const { rutaOculta, CABECERAS_SEGURIDAD } = await import(pathToFileURL(path.join(__dirname, '..', '..', 'despliegue', 'sitio', 'rutas.mjs')).href);
  const trucos = [
    '/despliegue/shuk.env', '/%64espliegue/shuk.env', '//despliegue/shuk.env', '/./despliegue/shuk.env', '/x/../despliegue/shuk.env',
    '/%2564espliegue/shuk.env', '/DESPLIEGUE/shuk.env', '/despliegue%2fshuk.env', '/%2fdespliegue/shuk.env',
    '/tests/headless/inspector_caso51.js', '/%74ests/headless/inspector_caso51.js', '//tests/unit/README.md',
    '/supabase/functions/api/index.ts', '/%73upabase/functions/api/index.ts', '/supabase/.temp/linked-project.json',
    '/.git/config', '/%2egit/config', '/.git/HEAD', '/.env', '/.clasp.json', '/x/.env',
    '/vercel.json', '/%76ercel.json', '//vercel.json', '/middleware.js', '/appsscript.json',
    '/supabase_schema.sql', '/cualquier/cosa.sql', '/PLAN-PLANTILLA.md', '/despliegue/README.md',
    '/motor-v2.js', '/resync_completo.js', '/migrar_a_supabase.js', '/aplicar_switch.js', '/fix_movs_socios.js',
    '/api/leer-factura.js', '/node_modules/express/package.json', '/x.viejo', '/clave.pem',
    '/%zz', '/a%00b', '/a\\..\\despliegue',
  ];
  const pasan = trucos.filter((r) => !rutaOculta(r));
  t.eq('ninguno de los ' + trucos.length + ' trucos saca un archivo interno', pasan, []);
  const delSitio = [
    '/', '/index.html', '/tienda.html', '/candyshop.html', '/manual.html', '/docs.html', '/sw.js', '/OneSignalSDKWorker.js',
    '/manifest.json', '/manifest-minorista.json', '/candyshop-manifest.json', '/icon-192.png', '/icon.svg', '/IMG_6172.jpg',
    '/ci-k7m2x9/', '/ci-k7m2x9/index.html', '/ci-k7m2x9/assets/index-CVuKse4y.js', '/ci-k7m2x9/assets/index-MO5Xu3k9.css',
    '/marshmelow%20chico.jpg',
  ];
  const tapadas = delSitio.filter((r) => rutaOculta(r));
  t.eq('lo que el sitio necesita sigue saliendo (' + delSitio.length + ' rutas)', tapadas, []);
  t.eq('cabeceras de seguridad: HSTS, nosniff, sin marcos de otros sitios, sin mandar la dirección completa afuera',
    Object.keys(CABECERAS_SEGURIDAD).sort(), ['Referrer-Policy', 'Strict-Transport-Security', 'X-Content-Type-Options', 'X-Frame-Options']);
  t.eq('SAMEORIGIN (Costos Israel se abre en un marco del mismo panel)', CABECERAS_SEGURIDAD['X-Frame-Options'], 'SAMEORIGIN');
  return t.result();
}
module.exports = { run };
