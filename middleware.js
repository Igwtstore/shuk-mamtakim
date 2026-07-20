// 🌎 Vidriera geográfica (Vercel Edge Middleware) — PROVISORIA, controlada por un interruptor
// que Jony prende/apaga desde el panel (config GEO_GATE en Supabase). NO toca el backend
// (el backend vive en supabase.co, sigue global). Limita SOLO la web (este deploy de Vercel).
//
// 🛟 REGLA DE ORO: fail-open. Ante CUALQUIER duda (gate off, país desconocido, error de red,
//    excepción) → DEJA PASAR. Jamás bloquear a un cliente real por un problema de infra.

export const config = {
  // Corre solo en páginas (no en imágenes/JS/CSS ni internos de Vercel) → menos invocaciones,
  // y los assets nunca se bloquean.
  matcher: ['/((?!_next|_vercel|assets|.*\\.(?:js|mjs|css|png|jpg|jpeg|gif|svg|ico|webp|avif|woff|woff2|ttf|json|xml|txt|map|mp4|webm|webmanifest)$).*)'],
};

const GEOGATE_URL = 'https://soarkknjewgcewryxqac.supabase.co/functions/v1/api?accion=geoGate';
// Argentina + limítrofes + Mercosur (editable): AR, Uruguay, Brasil, Paraguay, Bolivia, Chile.
export const MERCOSUR = new Set(['AR', 'UY', 'BR', 'PY', 'BO', 'CL']);

// ── DECISIÓN PURA (testeable, sin red ni crypto) ──────────────────────────────
// cfg = { gate:'off'|'mercosur', passHash }
// ctx = { pathname, country, paseHash (ya hasheado o ''), cookie }
// Devuelve una de: {t:'allow'} · {t:'block'} · {t:'redirect', location} · {t:'geocheck'}
export function decidir(cfg, ctx) {
  const gate = (cfg && cfg.gate) || 'off';
  const passHash = (cfg && cfg.passHash) || '';
  const country = (ctx.country || '').toUpperCase();

  if (ctx.pathname === '/_geocheck') return { t: 'geocheck', gate, country: country || '(desconocido)', mercosur: MERCOSUR.has(country) };
  if (gate !== 'mercosur') return { t: 'allow' };            // interruptor apagado → pasa todo
  if (MERCOSUR.has(country)) return { t: 'allow' };          // país del Mercosur → pasa
  if (!country) return { t: 'allow' };                       // país desconocido → pasa (fail-open)
  if (ctx.paseHash && passHash && ctx.paseHash === passHash) return { t: 'redirect' };   // ?pase válido
  if (passHash && (ctx.cookie || '').includes('sm_pase=' + passHash)) return { t: 'allow' };   // cookie de pase
  return { t: 'block' };                                     // afuera y sin pase → cartel
}

// ── Infra (red + crypto + cache) ──────────────────────────────────────────────
let _cache = { t: 0, val: null };
async function getGate() {
  const now = Date.now();
  if (_cache.val && (now - _cache.t) < 30000) return _cache.val;
  try {
    const r = await fetch(GEOGATE_URL, { signal: AbortSignal.timeout(1200) });
    const j = await r.json();
    if (j && typeof j.gate === 'string') { _cache = { t: now, val: j }; return j; }
  } catch { /* fail-open */ }
  return _cache.val || { gate: 'off', passHash: '' };
}
async function sha256hex(s) {
  try {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch { return ''; }
}
function paginaBloqueo() {
  const wa = 'https://wa.me/5491131754540';
  const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Shuk Mamtakim</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Segoe UI',system-ui,Arial,sans-serif;background:#faf5ec;color:#2d1a0a;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;text-align:center}
.c{max-width:440px;background:#fff;border:1px solid #ece2d1;border-radius:18px;padding:38px 30px;box-shadow:0 10px 40px rgba(0,0,0,.06)}
.e{font-size:3rem;margin-bottom:10px}h1{font-size:1.35rem;color:#5c3d1e;margin-bottom:12px}p{font-size:.95rem;line-height:1.6;color:#6b5a48;margin-bottom:22px}
a{display:inline-flex;align-items:center;gap:8px;background:#25d366;color:#fff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:12px;font-size:.95rem}</style></head>
<body><div class="c"><div class="e">🌎🍬</div><h1>Shuk Mamtakim</h1>
<p>Nuestra tienda online está disponible por ahora <b>solo para clientes del Mercosur</b> 🇦🇷🇺🇾🇧🇷🇵🇾🇧🇴.<br>Si sos cliente y estás de viaje, escribinos y te ayudamos.</p>
<a href="${wa}">💬 Escribinos por WhatsApp</a></div></body></html>`;
  return new Response(html, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-sm-geo': 'blocked' } });
}

export default async function middleware(request) {
  try {
    const url = new URL(request.url);
    const paseParam = url.searchParams.get('pase');
    const ctx = {
      pathname: url.pathname,
      country: request.headers.get('x-vercel-ip-country') || '',
      paseHash: paseParam ? await sha256hex(paseParam) : '',
      cookie: request.headers.get('cookie') || '',
    };
    const cfg = await getGate();
    const d = decidir(cfg, ctx);

    if (d.t === 'geocheck') return new Response(JSON.stringify({ alive: true, gate: d.gate, country: d.country, mercosur: d.mercosur }, null, 2), { headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-sm-geo': 'check' } });
    if (d.t === 'allow') return undefined;
    if (d.t === 'redirect') { const limpio = new URL(url); limpio.searchParams.delete('pase'); return new Response(null, { status: 302, headers: { 'location': limpio.pathname + limpio.search, 'set-cookie': `sm_pase=${cfg.passHash}; Path=/; Max-Age=31536000; SameSite=Lax`, 'cache-control': 'no-store' } }); }
    return paginaBloqueo();
  } catch {
    return undefined;   // 🛟 cualquier error → dejar pasar
  }
}
