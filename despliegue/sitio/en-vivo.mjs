// ============================================================================
//  🔴 EN VIVO (v4.79) — la parte del servidor propio que hace posible la pestaña "En vivo".
//
//  Qué hace, en tres pasos:
//   1. La tienda le manda cada evento (visita, carrito, checkout, pedido, búsqueda, latido…)
//      a /api/track del MISMO dominio. Acá se normaliza y, si no trae ciudad, se le pone la
//      que dice geoip por la IP del visitante. La IP se usa para eso y NO se guarda.
//   2. El evento se reenvía al motor (Edge Function) para que la tabla `trafico` siga siendo
//      la ÚNICA verdad histórica. Excepción: el `latido` (cada 60 s mientras miran) es solo
//      para la pantalla en vivo; guardarlo sería una fila por minuto por persona sin valor.
//   3. Se lo empuja al instante a los paneles abiertos por SSE (una conexión que el navegador
//      deja abierta y por la que recibe avisos), y queda 30 minutos en memoria para que al
//      abrir la pestaña ya se vea lo reciente.
//
//  Nada de esto es Supabase Realtime: se eligió el VPS porque ya corre el sitio, se publica
//  con git push y no necesita configurar nada en la base.
// ============================================================================

export const VENTANA_MS = 30 * 60 * 1000;     // cuánto se recuerda en memoria
export const MAX_EVENTOS = 800;               // techo de seguridad por si hay una avalancha
export const SOLO_VIVO = new Set(['latido']); // eventos que NO se mandan al motor

// Cuánto puede medir cada campo (un evento es un renglón, no un archivo).
// detalle: 4000 (v4.84). Con 700, una tanda de productos vistos (12 o, al irse, hasta 60 nombres) llegaba cortada
// y se perdía entera: pasó con 30 de 452 tandas el 22/09.
const TOPES = { vid: 60, pagina: 30, evento: 30, origen: 40, dispositivo: 20, ciudad: 80, region: 80, pais: 60, nombre: 80, telefono: 30, detalle: 4000, carrito: 6000 };
const NOMBRE_PAIS = { AR: 'Argentina', UY: 'Uruguay', BR: 'Brazil', CL: 'Chile', PY: 'Paraguay', BO: 'Bolivia', IL: 'Israel', US: 'United States', ES: 'Spain', MX: 'Mexico' };

// 🤖 Un navegador que se presenta como programa (rastreadores, pruebas automatizadas). Se MARCA, no se
// descarta: los números siguen siendo los reales y la Analítica lo muestra como robot.
export const esBot = (ua) => /bot|crawl|spider|slurp|headless|phantom|puppeteer|playwright|python-requests|curl\/|wget|scrapy|httpclient|java\/|go-http|libwww/i.test(ua || '');
const txt = (v, tope) => (v == null ? '' : String(v)).trim().slice(0, tope);
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };

// Un evento tal como lo manda la tienda (query o body) → el objeto que viaja a los paneles.
// `geo` es lo que dice geoip-lite de la IP ({city, region, country}) y solo se usa si la
// tienda no trajo ciudad. Devuelve null si no hay visitante (sin vid no hay a quién seguir).
export function normalizarEvento(q, { geo = null, ahora = Date.now(), id = 0, ua = '' } = {}) {
  const vid = txt(q.vid, TOPES.vid);
  if (!vid) return null;
  const ev = {
    id, t: ahora, vid,
    pagina: txt(q.pagina, TOPES.pagina) || 'tienda',
    evento: txt(q.evento, TOPES.evento) || 'visita',
    origen: txt(q.origen, TOPES.origen) || 'directo',
    dispositivo: txt(q.dispositivo, TOPES.dispositivo),
    ciudad: txt(q.ciudad, TOPES.ciudad), region: txt(q.region, TOPES.region), pais: txt(q.pais, TOPES.pais),
    nombre: txt(q.nombre, TOPES.nombre), telefono: txt(q.telefono, TOPES.telefono),
    detalle: txt(q.producto, TOPES.detalle), carrito: txt(q.carrito, TOPES.carrito),
    total: num(q.total), totalUSD: num(q.totalUSD),
  };
  if (!ev.ciudad && geo && (geo.city || geo.country)) {
    ev.ciudad = txt(geo.city, TOPES.ciudad);
    ev.region = ev.region || txt(geo.region, TOPES.region);
    ev.pais = ev.pais || NOMBRE_PAIS[geo.country] || txt(geo.country, TOPES.pais);
    ev.geoServidor = true;   // para saber de dónde salió la ciudad
  }
  if (ua && esBot(ua) && ev.evento === 'visita') {
    // La marca viaja dentro de la ficha técnica de la visita (el JSON del detalle), que es lo que la Analítica lee.
    let ficha = {};
    try { ficha = JSON.parse(ev.detalle || '{}'); if (!ficha || typeof ficha !== 'object') ficha = {}; } catch { ficha = {}; }
    ficha.bot = 1;
    ev.detalle = JSON.stringify(ficha).slice(0, TOPES.detalle);
    ev.bot = true;
  }
  return ev;
}

// Lo que se le manda al motor: los mismos nombres que la tienda usaba hasta ahora
// (el motor lee `producto` como detalle). Así `trafico` no cambia de forma.
export function paramsParaMotor(ev) {
  const p = new URLSearchParams({ accion: 'track', vid: ev.vid, pagina: ev.pagina, evento: ev.evento, origen: ev.origen, dispositivo: ev.dispositivo, ciudad: ev.ciudad, region: ev.region, pais: ev.pais, nombre: ev.nombre, telefono: ev.telefono });
  if (ev.detalle) p.set('producto', ev.detalle);
  if (ev.carrito) p.set('carrito', ev.carrito);
  p.set('total', String(ev.total || 0));   // siempre: en 'quitar', 0 significa "lo sacó" (y no "bajó la cantidad")
  if (ev.totalUSD) p.set('totalUSD', String(ev.totalUSD));
  return p;
}

// La memoria de 30 minutos + los paneles conectados.
export function crearEnVivo({ ahora = () => Date.now() } = {}) {
  const eventos = [];
  const clientes = new Set();
  const creado = ahora();
  // Desde cuándo esta memoria tiene TODO: si el servidor arrancó hace 10 minutos, lo anterior hay que
  // pedírselo al motor (el panel usa este corte para no perder ni repetir nada).
  const desde = () => Math.max(creado, ahora() - VENTANA_MS);
  // El id arranca en la hora del arranque: si el contenedor se reinicia, los ids nuevos nunca
  // repiten a los que un panel abierto ya tenía (los usa para no mostrar dos veces el mismo).
  let ultimoId = Math.floor(ahora());
  function podar() {
    const corte = ahora() - VENTANA_MS;
    while (eventos.length && eventos[0].t < corte) eventos.shift();
    while (eventos.length > MAX_EVENTOS) eventos.shift();
  }
  function registrar(ev) {
    ev.id = ++ultimoId;
    eventos.push(ev);
    podar();
    const linea = 'event: evento\ndata: ' + JSON.stringify(ev) + '\n\n';
    for (const c of clientes) { try { c.write(linea); } catch { clientes.delete(c); } }
    return ev;
  }
  function recientes() { podar(); return eventos.slice(); }
  // `res` es la respuesta de Express: se deja abierta y se le van escribiendo eventos.
  function suscribir(res) {
    // Si el panel ya se cortó antes de recibir la primera línea, no hay a quién suscribir.
    try {
      res.write('retry: 5000\n');
      res.write('event: inicio\ndata: ' + JSON.stringify({ eventos: recientes(), conectados: clientes.size + 1, ahora: ahora(), desde: desde() }) + '\n\n');
    } catch { return () => {}; }
    clientes.add(res);
    // Un comentario cada 25 s mantiene viva la conexión a través del proxy.
    const latido = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* se cierra abajo */ } }, 25000);
    return () => { clearInterval(latido); clientes.delete(res); };
  }
  return { registrar, recientes, suscribir, desde, conectados: () => clientes.size, siguienteId: () => ultimoId + 1 };
}

// El portero de la pantalla: hay que tener sesión válida en Supabase Auth, y la cuenta de
// Miri no la ve (⚠️ regla sagrada: en vista Miri no se ve NADA de Jony, y acá se ven los
// productos y los clientes en tiempo real). Se recuerda cada token 5 minutos para no
// consultar Auth en cada reconexión.
// 🔐 v4.92: `permitidos` = las ÚNICAS cuentas que pueden ver el En vivo (nombres y teléfonos de quien
// está en la tienda). Antes pasaba cualquier sesión válida menos la de Miri: la cuenta de Candy también.
export function crearPortero({ sbUrl, anon, mailMiri, permitidos = null, fetchFn = globalThis.fetch, ahora = () => Date.now(), ttlMs = 5 * 60 * 1000 }) {
  const cache = new Map();
  async function emailDe(token) {
    const c = cache.get(token);
    if (c && c.hasta > ahora()) return c.email;
    let email = '';
    try {
      const r = await fetchFn(sbUrl + '/auth/v1/user', { headers: { Authorization: 'Bearer ' + token, apikey: anon }, signal: AbortSignal.timeout(6000) });
      if (r.ok) { const u = await r.json(); email = String((u && u.email) || '').trim().toLowerCase(); }
    } catch { email = ''; }
    if (email) cache.set(token, { email, hasta: ahora() + ttlMs });
    if (cache.size > 200) cache.delete(cache.keys().next().value);
    return email;
  }
  async function puedeVer(token) {
    if (!token) return { ok: false, motivo: 'sin sesión' };
    const email = await emailDe(token);
    if (!email) return { ok: false, motivo: 'sesión inválida o vencida' };
    if (mailMiri && email === mailMiri) return { ok: false, motivo: 'no disponible para esta cuenta' };
    if (Array.isArray(permitidos) && !permitidos.includes(email)) return { ok: false, motivo: 'no disponible para esta cuenta' };
    return { ok: true, email };
  }
  return { puedeVer };
}
