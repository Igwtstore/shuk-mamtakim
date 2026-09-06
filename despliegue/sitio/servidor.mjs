// ============================================================================
//  El sitio del Shuk en casa (VPS de Hostinger) — reemplaza lo que hacía Vercel.
//
//  Hace exactamente las tres cosas que hacía Vercel, sin reinventar ninguna:
//   1. Sirve los archivos del repo (index.html, tienda.html, candyshop.html, fotos…)
//      con las reescrituras y cabeceras de `vercel.json` (se LEE ese archivo: una sola verdad).
//   2. Corre el candado geográfico de `middleware.js` tal cual (se importa el archivo real;
//      solo cambia de dónde sale el país: acá lo da geoip-lite en vez de la cabecera de Vercel).
//   3. Expone `api/leer-factura.js` en /api/leer-factura (se importa el archivo real; el
//      `res.status().json()` de Vercel es el mismo que el de Express).
//
//  Supabase NO se toca: la base, el auth y la Edge Function siguen en supabase.co.
//
//  Variables: RAIZ (carpeta del repo, por defecto la raíz), PUERTO (3100),
//             ANTHROPIC_API_KEY (para el lector de tickets; la lee leer-factura.js).
// ============================================================================
import express from 'express';
import geoip from 'geoip-lite';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const RAIZ = path.resolve(process.env.RAIZ || path.join(import.meta.dirname, '..', '..'));
const PUERTO = parseInt(process.env.PUERTO || '3100', 10);
const ARRANQUE = new Date();

// ── vercel.json = la única verdad de reescrituras y cabeceras ────────────────
// El `source` de Vercel es un patrón "path-to-regexp": lo anclamos y listo.
const aRegex = (src) => new RegExp('^' + src + '$');
const vercel = JSON.parse(fs.readFileSync(path.join(RAIZ, 'vercel.json'), 'utf8'));
const REESCRITURAS = (vercel.rewrites || []).map((r) => ({ re: aRegex(r.source), destino: r.destination.split('?')[0] }));
const CABECERAS = (vercel.headers || []).map((h) => ({ re: aRegex(h.source), headers: h.headers }));

// ── Los dos archivos de Vercel se importan tal cual ─────────────────────────
const mw = await import(pathToFileURL(path.join(RAIZ, 'middleware.js')).href);
const leerFactura = (await import(pathToFileURL(path.join(RAIZ, 'api', 'leer-factura.js')).href)).default;
// El matcher del middleware (en qué rutas corre: páginas sí, assets no).
const MATCHER = aRegex(mw.config.matcher[0]);

// Lo que NO se sirve como archivo (en Vercel tampoco: son funciones, config o infra).
const OCULTOS = /^\/(despliegue|api|supabase|tests|\.git|middleware\.js$|vercel\.json$|[^/]*\.sql$)/i;

// ── De qué país viene la visita ─────────────────────────────────────────────
// La IP real la pone nginx en X-Real-IP (solo se le cree si el que conecta es nginx, o sea
// loopback). Si algún día hay Cloudflare adelante, nginx ya la traduce (ver nginx-shuk.conf).
const esLocal = (ip) => /^(::1|127\.|::ffff:127\.)/.test(ip || '');
function ipDe(req) {
  const par = req.socket.remoteAddress || '';
  const real = req.headers['x-real-ip'];
  return (esLocal(par) && typeof real === 'string' && real) ? real : par.replace(/^::ffff:/, '');
}
function paisDe(req) {
  try { const g = geoip.lookup(ipDe(req)); return (g && g.country) || ''; } catch { return ''; }
}

const app = express();
app.disable('x-powered-by');
app.set('etag', 'weak');

// Salud (antes del candado: los monitores no son del Mercosur).
app.get('/_salud', (_req, res) => res.json({ ok: true, desde: ARRANQUE.toISOString(), raiz: RAIZ }));

// Registro compacto de cada pedido.
app.use((req, res, next) => {
  const t0 = Date.now();
  res.on('finish', () => { if (res.statusCode >= 400 || req.path.startsWith('/api/')) console.log(`${res.statusCode} ${req.method} ${req.originalUrl} ${Date.now() - t0}ms ${ipDe(req)}`); });
  next();
});

// 1) Candado geográfico: el middleware real de Vercel, alimentado con el país de geoip.
app.use(async (req, res, next) => {
  if (!MATCHER.test(req.path)) return next();
  try {
    const h = new Headers();
    for (const [k, v] of Object.entries(req.headers)) { if (typeof v === 'string') { try { h.set(k, v); } catch { /* cabecera rara */ } } }
    h.set('x-vercel-ip-country', paisDe(req));   // se PISA: nadie puede mandarla desde afuera
    const r = await mw.default(new Request('https://' + (req.hostname || 'shukmamtakim.com.ar') + req.originalUrl, { headers: h }));
    if (!r) return next();                        // undefined = dejar pasar (igual que en Vercel)
    res.status(r.status);
    r.headers.forEach((v, k) => res.setHeader(k, v));
    res.send(Buffer.from(await r.arrayBuffer()));
  } catch { next(); }                             // 🛟 fail-open, como el original
});

// 2) El lector de tickets (la función de Vercel, con el mismo req/res).
app.post('/api/leer-factura', express.json({ limit: '30mb' }), (req, res) => leerFactura(req, res));
app.all('/api/leer-factura', (req, res) => leerFactura(req, res));   // devuelve 405, como en Vercel

// 3) Reescrituras de vercel.json (/tienda → index.html, /candyshop/meir → tienda.html…).
app.use((req, _res, next) => {
  for (const r of REESCRITURAS) {
    if (r.re.test(req.path)) { const q = req.url.indexOf('?'); req.url = r.destino + (q === -1 ? '' : req.url.slice(q)); break; }
  }
  next();
});

// 4) Los archivos del repo, con las cabeceras de Vercel.
app.use((req, res, next) => (OCULTOS.test(req.path) ? res.status(404).type('text').send('404') : next()));
app.use(express.static(RAIZ, {
  index: 'index.html',
  dotfiles: 'ignore',
  cacheControl: false,
  setHeaders(res, fp) {
    // Lo mismo que Vercel para archivos estáticos: siempre revalidar (ETag hace el resto).
    res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
    const rel = '/' + path.relative(RAIZ, fp).split(path.sep).join('/');
    for (const c of CABECERAS) { if (c.re.test(rel)) c.headers.forEach((h) => res.setHeader(h.key, h.value)); }
  },
}));

app.use((_req, res) => res.status(404).type('html').send('<!doctype html><meta charset="utf-8"><title>404</title><p style="font-family:system-ui;padding:40px">404 — esa página no existe en Shuk Mamtakim.</p>'));
// Errores (por ejemplo un body más grande que el tope) → JSON, nunca una página de Express.
app.use((err, _req, res, _next) => { res.status(err.status || 500).json({ error: err.type === 'entity.too.large' ? 'Las fotos pesan demasiado para una sola lectura.' : String(err.message || err) }); });

const srv = app.listen(PUERTO, '0.0.0.0', () => console.log(`sitio del Shuk escuchando en :${PUERTO} (raíz ${RAIZ})`));
// El lector de tickets tarda hasta ~200 s: mismo margen que tenía en Vercel (300 s) y un poco más.
srv.requestTimeout = 330000;
srv.headersTimeout = 65000;
srv.keepAliveTimeout = 65000;
