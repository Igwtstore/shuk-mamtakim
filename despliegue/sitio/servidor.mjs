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
import { crearEnVivo, crearPortero, normalizarEvento, paramsParaMotor, SOLO_VIVO } from './en-vivo.mjs';

const RAIZ = path.resolve(process.env.RAIZ || path.join(import.meta.dirname, '..', '..'));
const PUERTO = parseInt(process.env.PUERTO || '3100', 10);
const ARRANQUE = new Date();
// 🔴 EN VIVO (v4.79): el motor al que se reenvía cada evento y el Auth que valida la sesión del panel.
// MOTOR_URL se puede pisar por variable de entorno (las pruebas locales apuntan a un motor de mentira).
const MOTOR_URL = process.env.MOTOR_URL || 'https://soarkknjewgcewryxqac.supabase.co/functions/v1/api';
const SB_URL = process.env.SUPABASE_URL || 'https://soarkknjewgcewryxqac.supabase.co';
const SB_ANON = process.env.SUPABASE_ANON || 'sb_publishable_aAZNID-NdaGERYQWe9Uk6w_rmlYSCj2';   // clave pública (la misma del navegador)
const MAIL_MIRI = 'myri@shukmamtakim.com';

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
// La IP real la pone el proxy Caddy en X-Real-IP (despliegue/shuk.caddy). Solo se le cree si el
// que conecta es interno (loopback o la red docker): a un pedido directo de afuera no se le cree.
const esInterna = (ip) => /^(?:::ffff:)?(?:127\.|10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)|^::1$/.test(ip || '');
function ipDe(req) {
  const par = req.socket.remoteAddress || '';
  const real = req.headers['x-real-ip'];
  return (esInterna(par) && typeof real === 'string' && real) ? real.replace(/^::ffff:/, '') : par.replace(/^::ffff:/, '');
}
function paisDe(req) {
  try { const g = geoip.lookup(ipDe(req)); return (g && g.country) || ''; } catch { return ''; }
}

const app = express();
app.disable('x-powered-by');
app.set('etag', 'weak');

// Salud (antes del candado: los monitores no son del Mercosur).
app.get('/_salud', (_req, res) => res.json({ ok: true, desde: ARRANQUE.toISOString(), raiz: RAIZ }));

// ── 🔴 EN VIVO: la tienda manda sus eventos acá; el panel se queda escuchando ─────────
// Van ANTES del candado: no son páginas, y al que el candado no dejó entrar nunca le carga la
// tienda, así que tampoco llega a mandar nada.
function geoDe(req) {
  try { const g = geoip.lookup(ipDe(req)); return g ? { city: g.city || '', region: g.region || '', country: g.country || '' } : null; } catch { return null; }
}
const vivo = crearEnVivo();
const portero = crearPortero({ sbUrl: SB_URL, anon: SB_ANON, mailMiri: MAIL_MIRI });
const leerParams = [express.urlencoded({ extended: false, limit: '64kb' }), express.json({ limit: '64kb' })];
// 🍪 La identidad anónima que Safari no borra (v4.80). El iPhone tira lo que la página guarda a
// los 7 días sin visitas, y la persona volvía como "nueva" (los "nuevos" estaban inflados). Una
// cookie puesta por el SERVIDOR no tiene ese límite: acá se recuerda el identificador del aparato
// y, si la página trae otro, manda el de siempre (la página lo adopta). Sigue siendo anónimo:
// no dice quién es, solo permite reconocer al mismo aparato. Nada nuevo se guarda en la base.
const COOKIE_VID = 'shuk_vid';
function cookieDe(req, nombre) {
  const c = req.headers.cookie || '';
  for (const parte of c.split(';')) { const [k, ...v] = parte.trim().split('='); if (k === nombre) return decodeURIComponent(v.join('=')); }
  return '';
}
const vidValido = (v) => /^v_[a-z0-9]{6,40}$/i.test(v || '');
app.all('/api/track', ...leerParams, async (req, res) => {
  const q = { ...req.query, ...(req.body && typeof req.body === 'object' ? req.body : {}) };
  const enCookie = cookieDe(req, COOKIE_VID);
  if (vidValido(enCookie)) q.vid = enCookie;                      // el aparato ya era conocido: manda ese
  const ev = normalizarEvento(q, { geo: geoDe(req) });
  if (!ev) return res.status(400).json({ error: 'falta el visitante' });
  if (!vidValido(enCookie) && vidValido(ev.vid)) {
    res.setHeader('Set-Cookie', COOKIE_VID + '=' + encodeURIComponent(ev.vid) + '; Path=/; Max-Age=63072000; SameSite=Lax; Secure; HttpOnly');
  }
  // Primero al motor (la verdad histórica). Si el motor no contesta, se avisa con 502 para que
  // la tienda le pegue directo, como hacía siempre: el dato no se pierde.
  let guardado = true;
  if (!SOLO_VIVO.has(ev.evento)) {
    try { const r = await fetch(MOTOR_URL + '?' + paramsParaMotor(ev).toString(), { signal: AbortSignal.timeout(8000) }); guardado = r.ok; }
    catch { guardado = false; }
  }
  vivo.registrar(ev);   // al panel va igual: lo que pasa, pasa, aunque el motor esté con hipo
  res.status(guardado ? 200 : 502).json({ ok: guardado, vid: ev.vid });
});
// La conexión abierta (SSE). El token viaja en la URL porque EventSource no admite cabeceras.
app.get('/api/en-vivo', async (req, res) => {
  const p = await portero.puedeVer(String(req.query.token || ''));
  if (!p.ok) return res.status(401).json({ error: p.motivo });
  res.status(200).set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'Content-Encoding': 'identity',    // que el proxy no lo comprima ni lo retenga
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  const salir = vivo.suscribir(res);
  req.on('close', salir);
});
// La foto de los últimos 30 minutos, para el panel que no logra sostener la conexión abierta.
app.get('/api/en-vivo/ahora', async (req, res) => {
  const p = await portero.puedeVer(String(req.query.token || ''));
  if (!p.ok) return res.status(401).json({ error: p.motivo });
  res.set('Cache-Control', 'no-store').json({ eventos: vivo.recientes(), conectados: vivo.conectados(), ahora: Date.now() });
});

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
