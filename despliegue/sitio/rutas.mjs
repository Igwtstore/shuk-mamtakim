// 🔒 v4.94 — Qué archivos del repo NO se sirven nunca, y las cabeceras de seguridad del sitio.
// Separado de servidor.mjs para poder probarlo solo (tests/unit/servidor_rutas.js).
import path from 'node:path';

// Carpetas y archivos de infraestructura, funciones o config (en Vercel tampoco se sirven).
const OCULTOS = /^\/(despliegue|api|supabase|tests|node_modules|middleware\.js$|vercel\.json$|appsscript\.json$)/i;
// Tipos de archivo que nunca son del sitio, en cualquier carpeta: claves, esquemas, scripts, notas.
const EXT_OCULTAS = /\.(env|sql|sh|ya?ml|md|ts|mjs|cjs|lock|log|bak|viejo|ejemplo|pem|key|p12|crt)$/i;
// Los .js sueltos de la raíz son scripts de migración y mantenimiento; del sitio son solo estos dos.
const JS_RAIZ_DEL_SITIO = new Set(['/sw.js', '/onesignalsdkworker.js']);

// La ruta se evalúa DECODIFICADA y NORMALIZADA, igual que la va a leer express.static. Antes el filtro
// miraba la ruta cruda: '/%64espliegue/shuk.env' o '//despliegue/shuk.env' lo esquivaban y se bajaba
// el archivo de claves del VPS (encontrado en la auditoría del 23/09).
export function rutaOculta(cruda) {
  let p;
  try { p = decodeURIComponent(String(cruda || '/')); } catch { return true; }   // %-codificación rota: no se sirve
  if (p.includes('\0') || p.includes('\\')) return true;
  p = path.posix.normalize('/' + p).replace(/\/{2,}/g, '/');
  if (/(^|\/)\./.test(p)) return true;                                          // .git, .env, .clasp.json… en cualquier nivel
  if (OCULTOS.test(p) || EXT_OCULTAS.test(p)) return true;
  if (/^\/[^/]+\.js$/i.test(p) && !JS_RAIZ_DEL_SITIO.has(p.toLowerCase())) return true;
  return false;
}

// Cabeceras de seguridad para todo lo que sale del sitio. Sin CSP por ahora (el panel tiene mucho código
// en línea); SAMEORIGIN y no DENY porque Costos Israel se abre adentro del panel.
export const CABECERAS_SEGURIDAD = {
  'Strict-Transport-Security': 'max-age=15552000',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};
