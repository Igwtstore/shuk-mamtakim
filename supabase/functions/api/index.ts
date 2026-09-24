// ============================================================================
//  BACKEND NUEVO (Supabase Edge Function) — el "empleado de confianza" del híbrido.
//  Sirve LECTURAS de plata leyendo de Supabase, con la lógica pura verificada
//  (idéntica a motor-v2.js). Valida sesión igual que el motor viejo. Deno.
//
//  Deploy:  supabase functions deploy api --project-ref soarkknjewgcewryxqac --no-verify-jwt
//  URL:     https://soarkknjewgcewryxqac.supabase.co/functions/v1/api?accion=<x>
// ============================================================================
const SB_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;

// URL pública del sitio (la que se abre al tocar una notificación). Espejo de `SITIO` en index.html.
const SITIO_PUSH = 'https://shukmamtakim.com.ar/';

// ── Notificaciones push (OneSignal) ─────────────────────────────────────────────
const OS_APP_ID = '0e4a5058-d7a1-405b-86c9-86ae42940ab4';
// La clave sale del secret ONESIGNAL_KEY; si no está, cae al valor viejo del código (vencido).
const osKey = () => Deno.env.get('ONESIGNAL_KEY') || '';   // 🔒 v4.93: nada de clave escrita acá (el repo es público)

const CAJAS_ARS = ['MP_GABY', 'EFT_MYRI', 'EFT_JONY', 'MP_JONY', 'CTA_CTE_ARS'];
const _CAJAS_JONY_ENV = ['MP_JONY', 'EFT_JONY', 'ETF_USD_JONY', 'COMI_USD_JONY'];
const _CAJAS_MIRI_ENV = ['MP_GABY', 'EFT_MYRI', 'ETF_USD_MYRI'];

// ── LÓGICA PURA (copiada 1:1 de motor-v2.js) ────────────────────────────────────
function parseLinea(linea: string) {
  const m = (linea || '').match(/^•\s*(\d+)x\s+(.+?)\s+—\s+(\$|U\$S)\s+([\d.,]+)\s+c\/u/);
  if (!m) return null;
  const cuerpo = m[2].replace(/\s*\[-\d+%\]\s*$/, '');
  const partes = cuerpo.split(' · ');
  const moneda = m[3] === 'U$S' ? 'U$S' : '$';
  const precio = moneda === 'U$S' ? parseFloat(m[4].replace(',', '.')) : parseInt(m[4].replace(/\./g, '').replace(',', ''), 10);
  return { qty: parseInt(m[1], 10), nombre: partes[0].trim(), desc: partes.slice(1).join(' · ').trim(), moneda, precio };
}
function matchProd(cands: any[], descLinea: string) {
  if (!cands || !cands.length) return null;
  if (cands.length === 1) return cands[0];
  const ld = (descLinea || '').toLowerCase().trim();
  if (ld) {
    let hit = cands.find((c) => c.desc === ld); if (hit) return hit;
    hit = cands.find((c) => c.desc && (ld.startsWith(c.desc.substring(0, 30)) || c.desc.startsWith(ld.substring(0, 30)))); if (hit) return hit;
  }
  const palabras = (s: string) => (s || '').toLowerCase().replace(/[()0-9.,!¡¿?·\-]/g, ' ').split(/\s+/).filter((w) => w.length > 2);
  const lp = palabras(ld);
  if (lp.length) {
    let best = null, bestScore = 0;
    for (const c of cands) { const cp = palabras(c.nombre + ' ' + c.desc); const score = lp.filter((w) => cp.indexOf(w) !== -1).length; if (score > bestScore) { bestScore = score; best = c; } }
    if (bestScore >= 1) return best;
  }
  return null;
}
function gananciaPitz(productosStr: string, mapa: any, tc: number, msVenta?: number) {
  const out = { ars: 0, usd: 0, faltaCosto: [] as string[], faltaTC: false };
  (productosStr || '').split(' || ').forEach((linea) => {
    const t = (linea || '').trim(); if (!t || t[0] !== '•') return;
    const L = parseLinea(t); if (!L) return;
    let cands = mapa[L.nombre.toLowerCase()]; if (!cands || !cands.length) return;
    // Un producto dado de alta DESPUÉS de la venta no pudo venderse ahí. Protege el caso del CLON
    // (mismo nombre, otro dueño): sin esto, clonar para Jony haría que las ventas viejas —ya cobradas
    // como mercadería de Miri— computaran ganancia de Pitzujim retroactiva. creadoMs=0 → no se filtra.
    if (msVenta && msVenta > 0) {
      const vivos = cands.filter((c: any) => !c.creadoMs || c.creadoMs <= msVenta + 86400000);
      if (!vivos.length) return;
      cands = vivos;
    }
    const p = matchProd(cands, L.desc); if (!p) return;
    if (!(p.costo > 0)) {   // sin costo → no cuenta, se reporta con nombre + desc (verificador de costos)
      const etq = L.nombre + (L.desc ? ' · ' + L.desc : '');
      if (out.faltaCosto.indexOf(etq) === -1) out.faltaCosto.push(etq);
      return;
    }
    let costo = p.costo;
    if (L.moneda !== p.moneda) { if (!(tc > 0)) { out.faltaTC = true; return; } costo = L.moneda === '$' ? p.costo * tc : p.costo / tc; }
    const gan = (L.precio - costo) * L.qty;
    if (L.moneda === 'U$S') out.usd += gan; else out.ars += gan;
  });
  out.ars = Math.round(out.ars); out.usd = Math.round(out.usd * 100) / 100; return out;
}
function comiPeriodo(arsM: number, usdM: number, comiARS: number, comiUSD: number, cajaM: string, tc: number, sinComi: boolean, tieneTramos: boolean) {
  if (sinComi) return { cARS: 0, cUSD: 0 };
  if (tieneTramos) return { cARS: comiARS, cUSD: comiUSD };
  let cARS = 0, cUSD = 0;
  if (arsM > 0) cARS += comiARS || Math.round(arsM * 0.15);
  if (usdM > 0) { if (tc > 0 && CAJAS_ARS.indexOf(cajaM) !== -1) cARS += Math.round(usdM * tc * 0.15); else cUSD += comiUSD || Math.round(usdM * 0.15 * 100) / 100; }
  return { cARS, cUSD };
}
// Alta real confiable solo a partir de acá: los productos migrados a Supabase quedaron todos con
// creado = 2026-07-02 (fecha de la migración), que no refleja cuándo se dieron de alta de verdad.
const MS_POST_MIGRACION = Date.parse('2026-07-04T00:00:00Z');
function mapaProdJony(productos: any[]) {
  const map: any = {};
  productos.forEach((p) => {
    if ((p.dueno || '').toString().trim() !== 'Jony') return;
    const moneda = ((p.moneda || '$').toString().trim() === 'U$S') ? 'U$S' : '$';
    const costo = parseFloat(String(p.costo || '0').replace(',', '.')) || 0;
    // v4.33: 'creado' sirve para no aplicar un producto a ventas ANTERIORES a su alta (caso CLON).
    // OJO: los 144 productos migrados el 02/07/2026 tienen creado = fecha de la MIGRACIÓN, no la real
    // (las ventas arrancan el 01/06) → para esos NO se puede filtrar. Solo se confía en los posteriores.
    const _cms = p.creado ? Date.parse(String(p.creado)) : 0;
    const creadoMs = (!isNaN(_cms) && _cms > MS_POST_MIGRACION) ? _cms : 0;   // 0 = "no filtrar por fecha"
    const entry = { id: p.id, moneda, costo, creadoMs, desc: (p.descripcion || '').toString().trim().toLowerCase(), nombre: (p.nombre || '').toString().trim().toLowerCase() };
    const push = (k: string) => { if (k) (map[k] = map[k] || []).push(entry); };
    push((p.nombre || '').toString().trim().toLowerCase());
    (p.nombres_prev || '').toString().split('|').forEach((n: string) => push(n.trim().toLowerCase()));
  });
  return map;
}
// ── Opción A (2026-07-03): la ganancia también cuenta lo CUBIERTO por pagos a cuenta ──
// Un pedido sin cobro confirmado pero tapado (total o parcialmente) por pagos a cuenta del
// cliente ES plata que entró: su comisión y su ganancia Pitzujim cuentan para el Maaser.
// La imputación replica 1:1 la de Cuenta socios (v3.08): residuales por componente
// {pitz $ / golosinas $ / golosinas U$S / pitz U$S}, atados primero, generales FIFO.
const _fparMin = (f: string) => {
  const p = (f || '').split(' '), d = (p[0] || '').split('/'), h = (p[1] || '0:0').split(':');
  return d.length < 3 ? 0 : new Date(+d[2], +d[1] - 1, +d[0], +h[0] || 0, +h[1] || 0).getTime();
};
function coberturaPagos(ventas: any[], pagos: any[], msCorte: number) {
  const real = (c: string) => !!c && !String(c).startsWith('CTA_CTE');
  const norm = (s: any) => (s || '').toString().trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
  // Pool de deuda por cliente: TODAS las ventas (incluye las ya liquidadas en cortes, para que
  // los pagos viejos sigan imputando ahí y no "salten" a ventas nuevas después de un corte).
  const res: any = {}, porId: any = {};
  ventas.forEach((v) => {
    const e = (v.estado || '').toString().trim();
    if (e === 'cancelado' || e === 'cotizacion') return;
    let tr: any[] | null = null; try { tr = JSON.parse((v.tramos || '').toString() || 'null'); } catch { tr = null; }
    const d = { jA: 0, mA: 0, jU: 0, mU: 0 };
    if (tr && tr.length) tr.forEach((t) => {
      const m = parseFloat(t.monto) || 0; if (m <= 0) return;
      if (t.caja === 'CTA_CTE_ARS') { if (t.dueno === 'J') d.jA += m; else d.mA += m; }
      else if (t.caja === 'CTA_CTE_USD') { if (t.dueno === 'J') d.jU += m; else d.mU += m; }
    });
    else if (!real(v.caja_jony) && !real(v.caja_myri)) {
      d.jA = parseFloat(v.ars_jony) || 0; d.mA = parseFloat(v.ars_myri) || 0;
      d.jU = parseFloat(v.usd_jony) || 0; d.mU = parseFloat(v.usd_myri) || 0;
    }
    // cub: cubierto que CUENTA (pagos > último corte). mUars (v4.29) = equivalente EN PESOS de las
    // golosinas en U$S que se cobraron en una caja de PESOS con TC → la comisión de esas va en pesos,
    // mismo criterio que la cuenta entre socios ("la comisión sigue dónde entró la plata").
    const it = { v, ...d, cub: { jA: 0, mA: 0, jU: 0, mU: 0, mUars: 0 } };
    porId[String(v.id)] = it;
    if (d.jA <= 0 && d.mA <= 0 && d.jU <= 0 && d.mU <= 0) return;
    (res[norm(v.cliente)] = res[norm(v.cliente)] || []).push(it);
  });
  Object.values(res).forEach((l: any) => l.sort((a: any, b: any) => _fparMin(a.v.fecha) - _fparMin(b.v.fecha)));
  // ¿el pago entró en una caja de PESOS con TC? → sus golosinas en U$S cuentan como pesos
  const enPesos = (p: any) => { const tcp = parseFloat(p.tc) || 0; return tcp > 0 && CAJAS_ARS.indexOf((p.caja || '').toString()) !== -1 ? tcp : 0; };
  const ord = [...(pagos || [])].sort((a, b) => _fparMin(a.fecha) - _fparMin(b.fecha));
  // Atados: consumen la deuda de SU pedido (monto_pitz / monto_pitz_usd dicen cuánto fue Pitzujim)
  ord.filter((p) => p.pedido_id).forEach((p) => {
    const it = porId[String(p.pedido_id)]; if (!it) return;
    const cuenta = _fparMin(p.fecha) > msCorte && (p.caja || '') !== 'PERDON';
    const pz = Math.min(parseFloat(p.monto_pitz) || 0, it.jA);
    const gA = Math.min(Math.max(0, (parseFloat(p.monto_ars) || 0) - (parseFloat(p.monto_pitz) || 0)), it.mA);
    const pzU = Math.min(parseFloat(p.monto_pitz_usd) || 0, it.jU);   // Pitzujim en U$S (auto-reparto 2026-07-07)
    const gU = Math.min(Math.max(0, (parseFloat(p.monto_usd) || 0) - (parseFloat(p.monto_pitz_usd) || 0)), it.mU);
    it.jA -= pz; it.mA -= gA; it.mU -= gU; it.jU -= pzU;
    if (cuenta) { const _tp = enPesos(p); it.cub.jA += pz; it.cub.mA += gA; it.cub.jU += pzU; if (_tp) it.cub.mUars += gU * _tp; else it.cub.mU += gU; }
  });
  // Generales: FIFO por componente. Los pagos NUEVOS con criterio elegido (p.reparto seteado)
  // respetan sus partes YA guardadas (Pitzujim = monto_pitz / monto_pitz_usd); los VIEJOS (sin
  // reparto) siguen con el orden histórico fijo — así el pasado queda IDÉNTICO (v4.01).
  ord.filter((p) => !p.pedido_id && (p.caja || '') !== 'PERDON').forEach((p) => {
    const cuenta = _fparMin(p.fecha) > msCorte;
    if (p.reparto) {
      // parte Pitzujim (Jony) y golosinas (Miri) guardadas → se distribuyen FIFO por bolsillo
      let pPz = parseFloat(p.monto_pitz) || 0, pGa = Math.max(0, (parseFloat(p.monto_ars) || 0) - (parseFloat(p.monto_pitz) || 0));
      let pPu = parseFloat(p.monto_pitz_usd) || 0, pGu = Math.max(0, (parseFloat(p.monto_usd) || 0) - (parseFloat(p.monto_pitz_usd) || 0));
      (res[norm(p.cliente)] || []).forEach((it: any) => {
        let a = Math.min(pPz, it.jA); it.jA -= a; pPz -= a; if (cuenta) it.cub.jA += a;
        a = Math.min(pGa, it.mA); it.mA -= a; pGa -= a; if (cuenta) it.cub.mA += a;
        a = Math.min(pGu, it.mU); it.mU -= a; pGu -= a; if (cuenta) { const _tp = enPesos(p); if (_tp) it.cub.mUars += a * _tp; else it.cub.mU += a; }
        a = Math.min(pPu, it.jU); it.jU -= a; pPu -= a; if (cuenta) it.cub.jU += a;
      });
      return;
    }
    let pA = parseFloat(p.monto_ars) || 0, pU = parseFloat(p.monto_usd) || 0;
    (res[norm(p.cliente)] || []).forEach((it: any) => {
      let a = Math.min(pA, it.jA); it.jA -= a; pA -= a; if (cuenta) it.cub.jA += a;
      a = Math.min(pA, it.mA); it.mA -= a; pA -= a; if (cuenta) it.cub.mA += a;
      a = Math.min(pU, it.mU); it.mU -= a; pU -= a; if (cuenta) { const _tp = enPesos(p); if (_tp) it.cub.mUars += a * _tp; else it.cub.mU += a; }
      a = Math.min(pU, it.jU); it.jU -= a; pU -= a; if (cuenta) it.cub.jU += a;
    });
  });
  return porId;   // ventaId → { v, cub:{jA,mA,jU,mU}, ... }
}
function calcularGanancias(ventas: any[], productos: any[], pagos: any[], msCorte: number) {
  const out = { comisionARS: 0, comisionUSD: 0, pitzARS: 0, pitzUSD: 0, faltaCosto: [] as string[], faltaTC: false, faltaTCVentas: [] as string[] };
  const marcarTC = (v: any) => { out.faltaTC = true; const et = '#' + (v.n_venta || '?') + ' ' + (v.cliente || '').toString().trim(); if (out.faltaTCVentas.indexOf(et) === -1) out.faltaTCVentas.push(et); };
  const real = (c: string) => !!c && !String(c).startsWith('CTA_CTE');
  const mapa = mapaProdJony(productos);
  const cober = coberturaPagos(ventas, pagos, msCorte);
  ventas.forEach((v) => {
    const estado = (v.estado || '').toString().trim();
    if (estado === 'cancelado' || estado === 'cotizacion') return;
    if ((v.corte || '').toString().trim()) return;
    const cobrada = real(v.caja_jony) || real(v.caja_myri);
    const sinComi = (v.sin_comi || '').toString().toUpperCase() === 'SI';
    const tc = parseFloat(v.tipo_cambio) || 0;
    if (cobrada) {
      // Cobro confirmado: cuenta completo (comportamiento de siempre)
      const arsM = parseFloat(v.ars_myri) || 0, usdM = parseFloat(v.usd_myri) || 0;
      const comiARS = parseFloat(v.comi_ars) || 0, comiUSD = parseFloat(v.comi_usd) || 0;
      const cajaM = (v.caja_myri || '').toString();
      const gp = gananciaPitz((v.productos || '').toString(), mapa, tc, _fparMin(v.fecha));
      gp.faltaCosto.forEach((n) => { if (out.faltaCosto.indexOf(n) === -1) out.faltaCosto.push(n); });
      if (gp.faltaTC) marcarTC(v);
      const tieneTramos = (v.tramos || '').toString().trim() !== '';
      const { cARS, cUSD } = comiPeriodo(arsM, usdM, comiARS, comiUSD, cajaM, tc, sinComi, tieneTramos);
      out.comisionARS += cARS; out.comisionUSD += cUSD; out.pitzARS += gp.ars; out.pitzUSD += gp.usd;
      return;
    }
    // Opción A: sin cobro confirmado pero CUBIERTA por pagos a cuenta → cuenta lo cubierto
    const it = cober[String(v.id)]; if (!it) return;
    const c = it.cub;
    if (c.jA <= 0.5 && c.mA <= 0.5 && c.jU <= 0.005 && c.mU <= 0.005 && (c.mUars || 0) <= 0.5) return;
    if (!sinComi) {
      // v4.29: mUars son golosinas en U$S cobradas en caja de PESOS → su comisión va en PESOS
      // (criterio elegido por el usuario: la comisión sigue dónde entró la plata).
      out.comisionARS += Math.round(c.mA * 0.15) + Math.round((c.mUars || 0) * 0.15);
      out.comisionUSD += Math.round(c.mU * 0.15 * 100) / 100;
    }
    const bJ = (parseFloat(v.ars_jony) || 0) + (parseFloat(v.usd_jony) || 0);
    const fJ = bJ > 0 ? Math.min(1, (c.jA + c.jU) / bJ) : 0;
    if (fJ > 0) {
      const gp = gananciaPitz((v.productos || '').toString(), mapa, tc, _fparMin(v.fecha));
      gp.faltaCosto.forEach((n) => { if (out.faltaCosto.indexOf(n) === -1) out.faltaCosto.push(n); });
      if (gp.faltaTC) marcarTC(v);
      out.pitzARS += Math.round(gp.ars * fJ); out.pitzUSD += Math.round(gp.usd * fJ * 100) / 100;
    }
  });
  out.pitzARS = Math.round(out.pitzARS); out.comisionARS = Math.round(out.comisionARS);
  out.comisionUSD = Math.round(out.comisionUSD * 100) / 100; out.pitzUSD = Math.round(out.pitzUSD * 100) / 100;
  return out;
}
// ⚖️ Auto-reparto de un pago: qué parte es Pitzujim (Jony) y qué parte golosinas (Miri), contra
// la deuda viva FIFO del cliente. Compartido por registrar y EDITAR un pago (v3.96). Al editar,
// excludePagoId saca el propio pago del cálculo (si no, se contaría a sí mismo → doble).
// criterio (v4.01): 'auto' = orden histórico (Pitzujim $ primero, golosinas U$S primero) ·
// 'jony' = Pitzujim (Jony) primero en las DOS monedas · 'prorrata' = proporcional a lo que cada
// uno tiene de deuda. Si el front manda montoPitzExplicito>0, se respeta (solo modo 'auto').
async function calcularRepartoPitz(cliente: string, pedidoId: string, montoARS: number, montoUSD: number, montoPitzExplicito: number, excludePagoId?: string, criterio?: string, montoPitzUsdExplicito?: number): Promise<{ pitzARS: number; pitzUSD: number }> {
  const modo = (criterio === 'jony' || criterio === 'prorrata' || criterio === 'forzado') ? criterio : 'auto';
  // 🔒 Parte en U$S forzada desde el front. Hace falta cuando el reparto NO se puede deducir de la
  // deuda viva: p. ej. una DEVOLUCIÓN de un pedido ya cobrado (el cliente no debe nada, así que el
  // auto-reparto dejaría la plata del lado equivocado e inventaría deuda entre socios).
  const expUSD = Math.max(0, Math.min(montoUSD, montoPitzUsdExplicito || 0));
  const forzado = modo === 'forzado';   // respeta AMBAS partes tal cual, incluso el cero
  if (forzado) return { pitzARS: Math.max(0, Math.min(montoARS, montoPitzExplicito || 0)), pitzUSD: expUSD };
  let pitzARS = (modo === 'auto') ? (montoPitzExplicito || 0) : 0, pitzUSD = 0;
  try {
    const cliPago = normCli(cliente);
    const [vsCli, pgsCli] = await Promise.all([sbGet('ventas', 'select=*'), sbGet('pagos', 'select=*')]);
    const vsDel = vsCli.filter((v: any) => normCli(v.cliente) === cliPago);
    let pgsDel = pgsCli.filter((p: any) => normCli(p.cliente) === cliPago);
    if (excludePagoId) pgsDel = pgsDel.filter((p: any) => String(p.id) !== String(excludePagoId));
    const resid = coberturaPagos(vsDel, pgsDel, 0);   // residual por pedido, como si este pago no existiera
    let items = Object.values(resid) as any[];
    if (pedidoId) items = items.filter((it: any) => String(it.v.id) === String(pedidoId));
    items.sort((a: any, b: any) => _fparMin(a.v.fecha) - _fparMin(b.v.fecha));
    if (modo === 'prorrata') {
      // Proporcional a la deuda TOTAL de cada uno (Jony=jA/jU, Miri=mA/mU), por moneda.
      let jA = 0, mA = 0, jU = 0, mU = 0;
      items.forEach((it: any) => { jA += it.jA; mA += it.mA; jU += it.jU; mU += it.mU; });
      const denA = jA + mA, denU = jU + mU;
      pitzARS = denA > 0 ? Math.round(Math.min(montoARS, denA) * jA / denA) : 0;
      pitzUSD = denU > 0 ? Math.round(Math.min(montoUSD, denU) * jU / denU * 100) / 100 : 0;
    } else {
      let poolA = montoARS, poolU = montoUSD, autoPitzA = 0, autoPitzU = 0;
      items.forEach((it: any) => {
        if (modo === 'jony') {
          let a = Math.min(poolA, it.jA); poolA -= a; autoPitzA += a;   // $: Pitzujim primero
          a = Math.min(poolA, it.mA); poolA -= a;                       // $: golosinas después
          a = Math.min(poolU, it.jU); poolU -= a; autoPitzU += a;       // U$S: Pitzujim primero (¡Jony!)
          a = Math.min(poolU, it.mU); poolU -= a;                       // U$S: golosinas después
        } else {   // 'auto' (histórico)
          let a = Math.min(poolA, it.jA); poolA -= a; autoPitzA += a;   // $: Pitzujim primero
          a = Math.min(poolA, it.mA); poolA -= a;                       // $: golosinas después
          a = Math.min(poolU, it.mU); poolU -= a;                       // U$S: golosinas primero
          a = Math.min(poolU, it.jU); poolU -= a; autoPitzU += a;       // U$S: Pitzujim después
        }
      });
      if (pitzARS <= 0) pitzARS = Math.round(autoPitzA);
      pitzUSD = Math.round(autoPitzU * 100) / 100;
    }
  } catch { /* si el reparto falla, queda en 0 (como antes) */ }
  if (expUSD > 0) pitzUSD = expUSD;   // el forzado manda por encima del auto-reparto
  return { pitzARS, pitzUSD };
}
// Fecha del último corte (en ms) — los pagos anteriores ya quedaron liquidados en ese corte.
async function msUltimoCorte() {
  const c = await sbGet('cortes', 'select=fecha&order=id.desc&limit=1');
  return c.length ? _fparMin((c[0].fecha || '').toString()) : 0;
}
function envioCobradoEnCajaDe(cajaJony: string, cajaMyri: string) {
  const cj = (cajaJony || '').toString(), cm = (cajaMyri || '').toString();
  if (_CAJAS_JONY_ENV.indexOf(cj) !== -1 || _CAJAS_JONY_ENV.indexOf(cm) !== -1) return 'Jony';
  if (_CAJAS_MIRI_ENV.indexOf(cm) !== -1 || _CAJAS_MIRI_ENV.indexOf(cj) !== -1) return 'Miri';
  return 'Jony';
}
function esCajaUSD(c: string) { return ['ETF_USD_MYRI', 'ETF_USD_JONY', 'COMI_USD_JONY'].indexOf((c || '').toString()) !== -1; }
function comiEnMonedaCobro(arsMyri: number, usdMyri: number, cajaMyri: string, tc: number, sinComi: boolean) {
  if (sinComi) return { comiARS: 0, comiUSD: 0 };
  let cARS = Math.round((parseFloat(String(arsMyri)) || 0) * 0.15), cUSD = 0;
  const usd = parseFloat(String(usdMyri)) || 0;
  if (usd > 0) { if (parseFloat(String(tc)) > 0 && CAJAS_ARS.indexOf(cajaMyri) !== -1) cARS += Math.round(usd * parseFloat(String(tc)) * 0.15); else cUSD += Math.round(usd * 0.15 * 100) / 100; }
  return { comiARS: cARS, comiUSD: cUSD };
}
function duenoVenta(arsJ: number, usdJ: number, arsM: number, usdM: number) {
  const jony = (parseFloat(String(arsJ)) || 0) + (parseFloat(String(usdJ)) || 0);
  const miri = (parseFloat(String(arsM)) || 0) + (parseFloat(String(usdM)) || 0);
  if (miri > 0 && jony === 0) return 'Miri';
  if (jony > 0 && miri === 0) return 'Jony';
  return miri >= jony ? 'Miri' : 'Jony';
}
async function upsertEnvio(ventaId: string, patch: any) {
  const ex = await sbGet('envios', 'select=id&venta_id=eq.' + encodeURIComponent(ventaId));
  if (ex.length) {
    const p: any = {};
    if (patch.nVenta !== undefined) p.n_venta = String(patch.nVenta);
    if (patch.cliente !== undefined) p.cliente = patch.cliente;
    if (patch.dueno) p.dueno = patch.dueno;
    if (patch.cobrado !== undefined) p.cobrado = patch.cobrado;
    if (patch.costo !== undefined) p.costo = patch.costo;
    if (patch.quienPago) p.quien_pago = patch.quienPago;
    if (patch.nota !== undefined) p.nota = patch.nota;
    await sbPatch('envios', 'id=eq.' + ex[0].id, p);
  } else {
    await sbInsert('envios', { fecha: fechaAhora(), venta_id: ventaId, n_venta: String(patch.nVenta || ''), cliente: patch.cliente || '', dueno: patch.dueno || 'Miri', cobrado: patch.cobrado !== undefined ? patch.cobrado : 0, costo: patch.costo !== undefined ? patch.costo : 0, quien_pago: patch.quienPago || '', nota: patch.nota || '' });
  }
}
// confirmarCobro — PORTADO 1:1 de motor-v2.js (la operación de cobro más compleja).
// Aplica todo sobre un patch local y hace UN PATCH (en Sheets eran múltiples setValue).
async function confirmarCobro(body: any) {
  const id = P(body, 'id');
  const rows = await sbGet('ventas', 'select=*&id=eq.' + encodeURIComponent(id));
  if (!rows.length) return { error: 'no encontrado' };
  const v = rows[0];
  const has = (k: string) => body[k] !== undefined && body[k] !== null && body[k] !== '';
  const soloMyri = P(body, 'soloMyri') === '1';
  const _sc = (v.sin_comi || '').toString().toUpperCase() === 'SI';
  const tc = N(body, 'tipoCambio');
  const patch: any = { tipo_cambio: tc };
  if (!soloMyri) patch.caja_jony = P(body, 'cajaJony');
  patch.caja_myri = P(body, 'cajaMyri');
  const cajaM = P(body, 'cajaMyri'), cajaJ = P(body, 'cajaJony');
  // valor efectivo de un campo (patch si ya lo tocamos, si no el original de la venta)
  const cur = (col: string, def: any) => patch[col] !== undefined ? patch[col] : (v[col] !== undefined && v[col] !== null ? v[col] : def);

  // ── COBRO FRACCIONADO (tramos) ──
  if (body.tramos !== undefined) {
    let nuevos: any[] = []; try { nuevos = JSON.parse(P(body, 'tramos') || '[]'); } catch { nuevos = []; }
    if (soloMyri) { let prev: any[] = []; try { prev = JSON.parse((v.tramos || '').toString() || '[]'); } catch { prev = []; } nuevos = prev.filter((t) => t.dueno === 'J').concat(nuevos.filter((t) => t.dueno === 'M')); }
    patch.tramos = JSON.stringify(nuevos);
    let cA = 0, cU = 0;
    if (!_sc) nuevos.filter((t) => t.dueno === 'M').forEach((t) => {
      const monto = parseFloat(t.monto) || 0; if (monto <= 0) return;
      const cajaUSD = ['ETF_USD_MYRI', 'ETF_USD_JONY', 'CTA_CTE_USD'].indexOf(t.caja) !== -1;
      if (cajaUSD) cU += (t.moneda === 'USD' ? monto : (tc > 0 ? monto / tc : 0)) * 0.15;
      else cA += (t.moneda === 'USD' ? monto * tc : monto) * 0.15;
    });
    patch.comi_ars = Math.round(cA); patch.comi_usd = Math.round(cU * 100) / 100;
    if (P(body, 'perdonarFaltante') === '1') {
      let req: any[] = []; try { req = JSON.parse(P(body, 'tramos') || '[]'); } catch { req = []; }
      const sumB = (k: string) => req.filter((t) => t.balde === k).reduce((s, t) => s + (parseFloat(t.monto) || 0), 0);
      const pres = new Set(req.map((t) => t.balde));
      if (pres.has('arsJ')) patch.ars_jony = Math.round(sumB('arsJ'));
      if (pres.has('arsM')) patch.ars_myri = Math.round(sumB('arsM'));
      if (pres.has('usdM')) patch.usd_myri = Math.round(sumB('usdM') * 100) / 100;
      if (pres.has('usdJ')) patch.usd_jony = Math.round(sumB('usdJ') * 100) / 100;
    }
  }
  // ── AJUSTE DE COBRO (recibido != esperado) ──  (usa valores ORIGINALES de la venta)
  if (has('recibido')) {
    const recibido = Math.round(N(body, 'recibido'));
    const origStr = (v.orig_split || '').toString();
    let bJ, bM, bU, bCA, bCU, bUJ;
    if (origStr && origStr.indexOf('|') !== -1) { const p = origStr.split('|').map(parseFloat); bJ = p[0] || 0; bM = p[1] || 0; bU = p[2] || 0; bCA = p[3] || 0; bCU = p[4] || 0; bUJ = p[5] || 0; }
    else { bJ = parseFloat(v.ars_jony) || 0; bM = parseFloat(v.ars_myri) || 0; bU = parseFloat(v.usd_myri) || 0; bCA = parseFloat(v.comi_ars) || 0; bCU = parseFloat(v.comi_usd) || 0; bUJ = parseFloat(v.usd_jony) || 0; }
    const usdEnPesos = bU > 0 && tc > 0 && CAJAS_ARS.indexOf(cajaM) !== -1;
    const usdJEnPesos = bUJ > 0 && tc > 0 && CAJAS_ARS.indexOf(cajaJ) !== -1;
    const esperado = Math.round(bJ + bM + (usdEnPesos ? bU * tc : 0) + (usdJEnPesos ? bUJ * tc : 0));
    if (esperado > 0 && recibido > 0 && Math.abs(recibido - esperado) >= 1) {
      const f = recibido / esperado;
      const nJ = Math.round(bJ * f), nM = Math.round(bM * f), nU = Math.round(bU * f * 100) / 100, nUJ = Math.round(bUJ * f * 100) / 100;
      const _cm = comiEnMonedaCobro(nM, nU, cajaM, tc, _sc);
      if (!origStr) patch.orig_split = [bJ, bM, bU, bCA, bCU, bUJ].join('|');
      patch.ars_jony = nJ; patch.ars_myri = nM; patch.usd_myri = nU; patch.comi_ars = _cm.comiARS; patch.comi_usd = _cm.comiUSD; patch.usd_jony = nUJ; patch.ajuste = recibido - esperado;
    } else {
      if (origStr) { patch.ars_jony = bJ; patch.ars_myri = bM; patch.usd_myri = bU; patch.comi_ars = bCA; patch.comi_usd = bCU; patch.usd_jony = bUJ; }
      patch.ajuste = 0;
    }
  }
  // ── COMISIÓN EN MONEDA DE COBRO (sin ajuste ni tramos) ──
  if (!has('recibido') && body.tramos === undefined) {
    const _cm = comiEnMonedaCobro(parseFloat(v.ars_myri) || 0, parseFloat(v.usd_myri) || 0, cajaM, tc, _sc);
    patch.comi_ars = _cm.comiARS; patch.comi_usd = _cm.comiUSD;
  }
  // ── CROSS-MONEDA (parte en pesos cobrada en caja de dólares → pasar a U$S) ──
  if (tc > 0 && body.tramos === undefined) {
    const aJ0 = parseFloat(cur('ars_jony', 0)) || 0, aM0 = parseFloat(cur('ars_myri', 0)) || 0, uM0 = parseFloat(cur('usd_myri', 0)) || 0, uJ0 = parseFloat(cur('usd_jony', 0)) || 0;
    let aJ = aJ0, aM = aM0, uM = uM0, uJ = uJ0, mov = false;
    if (aM0 > 0 && esCajaUSD(cajaM)) { uM = Math.round((uM0 + aM0 / tc) * 100) / 100; aM = 0; mov = true; }
    if (aJ0 > 0 && esCajaUSD(cajaJ)) { uJ = Math.round((uJ0 + aJ0 / tc) * 100) / 100; aJ = 0; mov = true; }
    if (mov) {
      if (!(v.orig_split || '').toString() && patch.orig_split === undefined) { const preCA = parseFloat(cur('comi_ars', 0)) || 0, preCU = parseFloat(cur('comi_usd', 0)) || 0; patch.orig_split = [aJ0, aM0, uM0, preCA, preCU, uJ0].join('|'); }
      patch.ars_jony = aJ; patch.ars_myri = aM; patch.usd_myri = uM; patch.usd_jony = uJ;
      const _cm = comiEnMonedaCobro(aM, uM, cajaM, tc, _sc);
      patch.comi_ars = _cm.comiARS; patch.comi_usd = _cm.comiUSD;
    }
  }
  // ── COMPROBANTE (se acumula) ──
  if (has('comprobante')) { const prevC = (v.comprobante || '').toString().trim(); const nuevoC = P(body, 'comprobante').trim(); patch.comprobante = prevC ? (prevC + '\n' + nuevoC) : nuevoC; }

  // ── FECHA DEL COBRO (v3.92/93): cuándo entró la plata DE VERDAD (antes el extracto usaba la
  // fecha del pedido → "no me coinciden las fechas con el resumen de MP", caso #37).
  // Si el modal manda la fecha elegida (📅), ESA manda (también al re-confirmar). Si no viene,
  // se estampa "ahora" solo la primera vez.
  const fcElegida = P(body, 'fechaCobro').trim();
  if (/^\d{2}\/\d{2}\/\d{4}( \d{2}:\d{2})?$/.test(fcElegida)) patch.fecha_cobro = fcElegida;
  else if (!(v.fecha_cobro || '').toString().trim()) patch.fecha_cobro = fechaAhora();

  await sbPatch('ventas', 'id=eq.' + encodeURIComponent(id), patch);
  // Circuito F3: si la venta interna del cliente "Candy" se cobró con TC, la compra espejo
  // de Candy pasa de U\$S crudo a pesos reales (CS<nVenta> — solo esa).
  if ((v.cliente || '').toString().trim() === 'Candy' && tc > 0) { try { await convertirComprasCircuito(tc, 'CS' + v.n_venta); } catch { /**/ } }

  // ── ENVÍO (upsert idempotente) ──
  if (has('envioCosto') || has('envioCobrado')) {
    const dueno = duenoVenta(v.ars_jony, v.usd_jony || 0, v.ars_myri, v.usd_myri);
    const ep: any = { nVenta: v.n_venta, cliente: (v.cliente || '').toString(), dueno, quienPago: P(body, 'quienPagoEnvio') || dueno };
    if (has('envioCosto')) ep.costo = Math.round(N(body, 'envioCosto'));
    if (has('envioCobrado')) ep.cobrado = Math.round(N(body, 'envioCobrado'));
    await upsertEnvio(id, ep);
  }
  return { ok: true };
}

// ── Capa de LECTURA: Supabase → formato del front (idéntico a _*Data de motor-v2.js) ──
const ventaFront = (v: any) => ({
  id: v.id, fecha: v.fecha, cliente: v.cliente, tipo: v.tipo, productos: v.productos, formaPago: v.forma_pago, notas: v.notas,
  estado: v.estado || 'pendiente', totalARS: v.total_ars || 0, totalUSD: v.total_usd || 0, nVenta: v.n_venta,
  arsJONY: v.ars_jony || 0, arsMyri: v.ars_myri || 0, usdMyri: v.usd_myri || 0, comiARS: v.comi_ars || 0, comiUSD: v.comi_usd || 0,
  cajaJony: v.caja_jony || '', cajaMyri: v.caja_myri || '', tipoCambio: v.tipo_cambio || 0, stockUpdates: v.stock_updates || '',
  // ⚠️ estos dos quedaron stubeados en la migración (comprobante:'' / ajuste:0) y mataban
  // "🧾 Ver comprobante" y el chip "⚖️ Ajuste de cobro" en el panel (regresión desde 2026-07-02)
  comprobante: (v.comprobante || '').toString(), ajuste: parseFloat(v.ajuste) || 0, fechaCobro: (v.fecha_cobro || '').toString(),
  corte: (v.corte || '').toString(), sinComision: (v.sin_comi || '').toString(), usdJONY: v.usd_jony || 0, tramos: (v.tramos || '').toString(),
});
const pagoFront = (p: any) => ({ id: p.id, fecha: p.fecha, cliente: (p.cliente || '').toString(), pedidoId: (p.pedido_id || '').toString(), montoARS: parseFloat(p.monto_ars) || 0, montoUSD: parseFloat(p.monto_usd) || 0, caja: (p.caja || '').toString(), nota: (p.nota || '').toString(), montoPitz: parseFloat(p.monto_pitz) || 0, montoPitzUsd: parseFloat(p.monto_pitz_usd) || 0, tc: parseFloat(p.tc) || 0, comprobante: (p.comprobante || '').toString(), totalMano: parseFloat(p.total_mano) || 0, reparto: (p.reparto || '').toString() });
const clienteFront = (c: any) => ({ fecha: c.fecha, nombre: (c.nombre || '').toString(), telefono: (c.telefono || '').toString(), tipo: (c.tipo || '').toString(), nota: (c.nota || '').toString(), ultimoAcceso: (c.ultimo_acceso || '').toString() });
const gastoFront = (g: any) => ({ fecha: g.fecha, desc: g.descripcion, monto: g.monto, moneda: g.moneda, categoria: g.categoria, columna: g.columna || '', comprobante: (g.comprobante || '').toString() });
const prodAdmin = (p: any) => ({ id: p.id, nombre: p.nombre || '', stock: parseInt(p.stock) || 0, activo: p.activo !== false, categoria: (p.categoria || 'Varios').toString(), dueno: (p.dueno || '').toString(), moneda: p.moneda === 'U$S' ? 'U$S' : '$', precioMay: p.precio_may, precioMin: parseFloat(p.precio_min) || 0, desc: (p.descripcion || '').toString(), visible: (p.visible_cat || 'Ambos').toString(), imagen: (p.imagen || '').toString(), descBot: (p.desc_bot || '').toString(), costo: parseFloat(p.costo) || 0, nombresPrev: (p.nombres_prev || '').toString(), candyCod: (p.candy_cod || '').toString(), unidadesPorPaquete: Math.max(1, parseInt(p.unidades_por_paquete) || 1), fraccionDe: (p.fraccion_de || '').toString(), fraccionCant: parseInt(p.fraccion_cant) || 0, sueltas: parseInt(p.sueltas) || 0, peso: parseFloat(p.peso) || 0, ean: (p.ean || '').toString(), etiqueta: (p.etiqueta || '').toString(), vinculo: (p.vinculo || '').toString(), hashgaja: (p.hashgaja || '').toString(), kosherTipo: (p.kosher_tipo || '').toString(), jalav: (p.jalav || '').toString(), creado: (p.creado || '').toString() });
const rendFront = (r: any) => ({ fecha: r.fecha, desc: r.descripcion, monto: r.monto, moneda: r.moneda, columna: r.columna || '', comprobante: (r.comprobante || '').toString() });

// _enviosData: saldo y deuda derivada de la caja de envíos (idempotente).
function enviosData(envios: any[], ventas: any[]) {
  const cajaPorVenta: any = {};
  ventas.forEach((v) => { cajaPorVenta[String(v.id)] = envioCobradoEnCajaDe(v.caja_jony, v.caja_myri); });
  const movimientos: any[] = []; const saldos = { Miri: 0, Jony: 0 }; let socioARS = 0; const deudaEnvios: any[] = [];
  envios.forEach((r) => {
    const cobrado = parseFloat(r.cobrado) || 0, costo = parseFloat(r.costo) || 0;
    if (cobrado === 0 && costo === 0) return;
    saldos.Jony += cobrado - costo;
    const cobradoEn = cajaPorVenta[String(r.venta_id)] || 'Jony';
    if (cobrado > 0 && cobradoEn === 'Miri') { socioARS += cobrado; deudaEnvios.push({ nVenta: r.n_venta, cliente: r.cliente, fecha: r.fecha, monto: cobrado }); }
    movimientos.push({ fecha: r.fecha, ventaId: r.venta_id, nVenta: r.n_venta, cliente: r.cliente, dueno: 'Jony', cobrado, costo, quienPago: (r.quien_pago || '').toString(), nota: (r.nota || '').toString(), cobradoEn });
  });
  return { movimientos, saldos, socioARS, deudaEnvios };
}
function movsSociosData(movs: any[], envios: any[], ventas: any[]) {
  const movimientos = movs.map((r) => ({ fecha: r.fecha, desc: (r.descripcion || '').toString(), montoARS: parseFloat(r.monto_ars) || 0, montoUSD: parseFloat(r.monto_usd) || 0 }));
  const manualARS = movimientos.reduce((s, m) => s + m.montoARS, 0);
  const manualUSD = movimientos.reduce((s, m) => s + m.montoUSD, 0);
  const env = enviosData(envios, ventas);
  const enviosARS = env.socioARS || 0;
  env.deudaEnvios.forEach((d) => movimientos.push({ fecha: d.fecha || '', desc: '🛵 Envío #' + (d.nVenta || '?') + (d.cliente ? ' · ' + d.cliente : ''), montoARS: d.monto, montoUSD: 0 }));
  return { totalARS: manualARS + enviosARS, totalUSD: manualUSD, movimientos, manualARS, enviosARS, enviosDetalle: env.deudaEnvios };
}

// ── ANALÍTICA (getAnalitica portado de motor-v2.js, lee tabla trafico) ──────────
// `trafico.fecha` es TEXTO 'dd/MM/yyyy HH:mm' (no una fecha de verdad), así que la base no
// sabe filtrar por rango: el recorte por período se hace acá. Para no arrastrar meses de
// historial cada vez que se miran "los últimos 7 días", leemos de lo MÁS NUEVO hacia atrás
// y cortamos apenas la página se va antes de la ventana.
// ¿El texto es un JSON? (123 es el código de la llave de apertura: escribirla como carácter
// suelto dentro de un string descoloca a cualquier herramienta que cuente llaves).
const esJSON = (x: string) => (x || '').charCodeAt(0) === 123;
function tsDeFecha(f: string): number | null {
  const m = (f || '').toString().match(/(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?/);
  return m ? Date.UTC(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)) : null;
}
async function traficoParaAnalitica(dias: number) {
  if (dias <= 0) return await sbGet('trafico', 'select=*&order=id.asc');
  // 🗓️ v4.80: `trafico.ts` es una fecha de verdad, con índice: la base filtra sola el período y
  // ya no hace falta leer de a páginas desde lo más nuevo adivinando dónde frenar. Se piden 2× la
  // ventana porque la comparativa mira el período anterior. Una fila sin ts (no debería haber
  // ninguna: se completaron todas) entra igual, por las dudas.
  const corte = new Date(Date.now() - 2 * dias * 86400000).toISOString();
  return await sbGet('trafico', 'select=*&or=(ts.gte.' + encodeURIComponent(corte) + ',ts.is.null)&order=id.asc');
}
// 👁️ LOS PRODUCTOS DE UNA TANDA DE VISTAS (v4.84). La tanda llega como {"v":[{"i":..,"n":..}]}.
// Hasta v4.84 el servidor del sitio recortaba cada evento a 700 caracteres y 30 de 452 tandas del
// 22/09 llegaron cortadas (JSON inválido): acá se rescatan los productos que llegaron completos,
// en vez de perder la tanda entera.
function leerVistas(detalle: string) {
  const d = String(detalle || '');
  try { const j = JSON.parse(d); return (j.v || []).map((it: any) => String(it.n || '').trim()).filter(Boolean); } catch { /**/ }
  const out: any[] = [];
  const re = /"n":"((?:[^"\\]|\\.)*)"/g;
  let m = null as any;
  while ((m = re.exec(d))) { try { out.push(String(JSON.parse('"' + m[1] + '"')).trim()); } catch { out.push(m[1]); } }
  return out.filter(Boolean);
}
// 📅 TODO EL DÍA en la pestaña En vivo (v4.84): cada evento, livianito. La tanda de vistas viaja
// como lista de nombres y la ficha técnica de la visita solo con el aparato: el día entero pesa poco.
function compactarEvento(r: any) {
  const ev = String(r.evento || ''), det = String(r.detalle || '');
  const o: any = { id: 'm' + r.id, t: Date.parse(String(r.ts || '')) || 0, vid: String(r.vid || ''), pagina: String(r.pagina || 'tienda'), evento: ev,
    origen: String(r.origen || ''), dispositivo: String(r.dispositivo || ''), ciudad: String(r.ciudad || ''), pais: String(r.pais || ''),
    nombre: String(r.nombre || ''), telefono: String(r.telefono || ''), total: parseFloat(r.total) || 0 };
  if (ev === 'vistas') o.vistos = leerVistas(det);
  else if (ev === 'visita') { if (esJSON(det)) { try { const f = JSON.parse(det); o.aparato = String(f.ap || ''); if (f.vip) o.vip = 1; if (f.bot) o.bot = 1; } catch { /**/ } } }
  else o.detalle = det.slice(0, 400);
  if (r.carrito && (ev === 'carrito' || ev === 'checkout' || ev === 'pedido')) o.carrito = String(r.carrito);
  return o;
}
// 🔁 LO DE SIEMPRE (v4.86): el pedido habitual de un aparato, a partir de sus últimos pedidos
// minoristas. Del último pedido entra todo; de los dos anteriores, lo que se repite. La cantidad
// es la del pedido más reciente que lo tiene. No devuelve nombres ni teléfonos: solo productos.
function pedidoHabitual(ventas: any[], incluirMayorista = false) {
  const validas = ventas.filter((v: any) => !['cancelado', 'cotizacion'].includes(String(v.estado || '')) && (incluirMayorista || String(v.tipo || 'Minorista') !== 'Mayorista')).slice(0, 3);
  if (!validas.length) return { items: [], pedidos: 0, ultima: '' };
  const cuenta: any = {}, ultimaQ: any = {};
  const idsDe = (v: any) => {
    const vistos: any = {}, out: any[] = [];
    String(v.stock_updates || '').split(',').forEach((u: string) => {
      const par = u.split(':'), id = String(par[0] || '').trim(), q = parseInt(par[1]) || 0;
      if (!id || q <= 0 || vistos[id]) return;
      vistos[id] = 1; out.push([id, q]);
    });
    return out;
  };
  validas.forEach((v: any) => idsDe(v).forEach((x: any) => { cuenta[x[0]] = (cuenta[x[0]] || 0) + 1; if (ultimaQ[x[0]] === undefined) ultimaQ[x[0]] = x[1]; }));
  const delUltimo: any = {};
  idsDe(validas[0]).forEach((x: any) => { delUltimo[x[0]] = 1; });
  const items = Object.keys(cuenta).filter((id) => delUltimo[id] || cuenta[id] >= 2)
    .map((id) => ({ id, q: ultimaQ[id], veces: cuenta[id] }))
    .sort((a: any, b: any) => b.veces - a.veces);
  return { items: items.slice(0, 25), pedidos: validas.length, ultima: String(validas[0].fecha || '') };
}
// ══════════════════════════════════════════════════════════════════════════════
//  🔔 TE TOCA (v5.01): a quién le toca volver a pedir, según SU PROPIO ritmo.
//  Cada cliente que compró 2+ veces tiene su intervalo típico (la mediana de días entre compras). Si ya
//  pasó ese tiempo desde la última, le toca. No es un número inventado para todos: es su costumbre.
//  Dos pedidos a menos de 2 días cuentan como UNA compra (se agregó algo, se corrigió un pedido).
//  El ritmo mínimo es 3 días: el que compró dos veces en una semana no queda "atrasado" para siempre.
// ══════════════════════════════════════════════════════════════════════════════
function normNombreTT(x: any) { return String(x || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').replace(/[^a-z0-9 ]/g, '').slice(0, 60); }
function calcularTeToca(ventas: any[], clientes: any[], marcas: any, ahoraAR: number) {
  const tel: any = {};
  clientes.forEach((c: any) => { const k = normNombreTT(c.nombre); if (k && c.telefono) tel[k] = String(c.telefono); });
  const porCli: any = {};
  ventas.forEach((v: any) => {
    const est = String(v.estado || '');
    if (est === 'cancelado' || est === 'cotizacion') return;
    const k = normNombreTT(v.cliente), ts = tsDeFecha(String(v.fecha || ''));
    if (!k || !ts) return;
    (porCli[k] = porCli[k] || { nombre: String(v.cliente || '').trim(), ventas: [] }).ventas.push({ ...v, ts });
  });
  const lista: any[] = [], unaVez: any[] = [], todosInt: number[] = [], ocultos: any[] = [];
  const mediana = (a: number[]) => { const b = a.slice().sort((x, y) => x - y); const m = Math.floor(b.length / 2); return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; };
  for (const k of Object.keys(porCli)) {
    const c = porCli[k], marca = marcas[k] || {};
    if (marca.oculto) { ocultos.push({ nombre: c.nombre, clave: k }); continue; }
    c.ventas.sort((a: any, b: any) => a.ts - b.ts);
    const ocas: any[] = [];
    c.ventas.forEach((v: any) => { const u = ocas[ocas.length - 1]; if (u && v.ts - u.ultTs < 2 * 86400000) { u.ventas.push(v); u.ultTs = v.ts; } else ocas.push({ ts: v.ts, ultTs: v.ts, ventas: [v] }); });
    const ult = c.ventas[c.ventas.length - 1];
    const dias = Math.max(0, Math.floor((ahoraAR - ult.ts) / 86400000));
    let ars = 0, usd = 0;
    c.ventas.forEach((v: any) => { ars += parseFloat(v.total_ars) || 0; usd += parseFloat(v.total_usd) || 0; });
    const tipo = String(ult.tipo || '') === 'Mayorista' ? 'Mayorista' : 'Minorista';
    const avisadoTs = marca.avisado ? (tsDeFecha(String(marca.avisado)) || 0) : 0;
    const base = {
      nombre: c.nombre, clave: k, telefono: tel[k] || '', tipo, pedidos: ocas.length, ultima: String(ult.fecha || ''), dias,
      ticketARS: Math.round(ars / ocas.length), ticketUSD: Math.round(usd / ocas.length * 100) / 100,
      avisado: marca.avisado || '', diasAvisado: avisadoTs ? Math.floor((ahoraAR - avisadoTs) / 86400000) : null,
    };
    if (ocas.length < 2) {
      if (dias >= 21 && dias <= 180) unaVez.push(base);
      continue;
    }
    const ints: number[] = [];
    for (let i = 1; i < ocas.length; i++) ints.push((ocas[i].ts - ocas[i - 1].ultTs) / 86400000);
    ints.forEach((x) => todosInt.push(x));
    const ritmo = Math.max(3, Math.round(mediana(ints)));
    const ratio = dias / ritmo;
    if (ratio < 0.8) continue;
    // El avisado de los últimos días no desaparece, pero baja: ya le escribiste, no hace falta insistir hoy.
    const yaEscrito = base.diasAvisado !== null && base.diasAvisado < 5 && avisadoTs >= ult.ts;
    const estado = ratio < 1 ? 'pronto' : (ratio < 1.5 ? 'le toca' : (ratio < 3 ? 'atrasado' : 'se enfrió'));
    // Lo de siempre se arma por COMPRA, no por pedido: lo que pidió el mismo día en dos veces es una sola canasta
    // (si no, "lo que agregó después" tapaba lo que había pedido primero). Las cantidades se suman.
    const porCompra = ocas.slice().reverse().map((o: any) => {
      const q: any = {}, orden: string[] = [];
      o.ventas.forEach((v: any) => String(v.stock_updates || '').split(',').forEach((u: string) => {
        const pp = u.split(':'), id = String(pp[0] || '').trim(), n = parseInt(pp[1]) || 0;
        if (!id || n <= 0) return;
        if (q[id] === undefined) { q[id] = 0; orden.push(id); }
        q[id] += n;
      }));
      const uv = o.ventas[o.ventas.length - 1];
      return { fecha: uv.fecha, estado: 'entregado', tipo: uv.tipo, stock_updates: orden.map((id) => id + ':' + q[id]).join(',') };
    });
    const habitual = pedidoHabitual(porCompra, tipo === 'Mayorista');
    lista.push({ ...base, ritmo, ratio: Math.round(ratio * 100) / 100, estado, yaEscrito, enDias: Math.max(0, ritmo - dias), habitual: habitual.items });
  }
  const pesoEstado: any = { 'le toca': 0, 'atrasado': 1, 'se enfrió': 2, 'pronto': 3 };
  const valor = (x: any) => (x.ticketARS || 0) + (x.ticketUSD || 0) * 1400;
  lista.sort((a, b) => (Number(a.yaEscrito) - Number(b.yaEscrito)) || (pesoEstado[a.estado] - pesoEstado[b.estado]) || (valor(b) - valor(a)));
  unaVez.sort((a, b) => a.dias - b.dias);
  return {
    lista, unaVez: unaVez.slice(0, 20), ocultos,
    ritmoGeneral: todosInt.length ? Math.round(mediana(todosInt)) : null,
    cuantos: { leToca: lista.filter((x) => x.estado === 'le toca' && !x.yaEscrito).length, atrasados: lista.filter((x) => x.estado === 'atrasado' && !x.yaEscrito).length, enfriados: lista.filter((x) => x.estado === 'se enfrió' && !x.yaEscrito).length, pronto: lista.filter((x) => x.estado === 'pronto').length },
  };
}
async function teTocaDesdeLaBase() {
  const [vtT, clT, mkT] = await Promise.all([
    sbGet('ventas', 'select=cliente,fecha,estado,tipo,total_ars,total_usd,stock_updates&order=n_venta'),
    sbGet('clientes', 'select=nombre,telefono,tipo'),
    sbGet('config', 'select=clave,valor&clave=like.TETOCA_*'),
  ]);
  const marcas: any = {};
  mkT.forEach((r: any) => { try { marcas[String(r.clave || '').slice(7)] = JSON.parse(r.valor || '{}'); } catch { /**/ } });
  return calcularTeToca(vtT, clT, marcas, Date.now() - 3 * 3600000);   // Argentina = UTC−3 todo el año (las fechas se guardan en hora de acá)
}
// 🔔 EL AVISAME QUE SE CUMPLE (v4.86): de la lista de espera, los productos que YA tienen stock,
// con cuántas personas los esperan. Lo usa el aviso a tu celular y "Qué hacer" en la Analítica.
function productosQueVolvieron(pendientes: any[], productos: any[]) {
  const porId: any = {};
  productos.forEach((p: any) => { porId[String(p.id)] = p; });
  const grupos: any = {};
  pendientes.forEach((n: any) => {
    if (String(n.estado || 'pendiente') !== 'pendiente') return;
    const pid = String(n.producto_id || ''), p = porId[pid];
    if (!p || (parseInt(p.stock) || 0) <= 0 || p.activo === false) return;
    const g = grupos[pid] = grupos[pid] || { id: pid, nombre: String(p.nombre || n.producto || ''), stock: parseInt(p.stock) || 0, esperan: 0 };
    g.esperan++;
  });
  return Object.values(grupos).sort((a: any, b: any) => b.esperan - a.esperan);
}
// 🗓️ FIESTAS Y SHABAT EN LA TIENDA (v4.88). Lo que Jony elige una vez y queda para siempre: qué va en
// la vidriera de cada fiesta (vacío = automático, lo más pedido de sus categorías), el texto del
// cartel y la franja "pedí hasta el jueves y llega para Shabat". Todo pasa por lista blanca: un valor
// raro cae a su default y la tienda nunca se rompe. Las fechas no se guardan: la tienda trae el
// calendario (calculado con Hebcal para la diáspora).
const FIESTAS_IDS = ['roshhashana', 'sucot', 'januca', 'tubishvat', 'purim', 'pesaj', 'shavuot'];
function normFiestas(raw: any) {
  const c = raw && typeof raw === 'object' ? raw : {};
  const s = c.shabat && typeof c.shabat === 'object' ? c.shabat : {};
  const prendido = (v: any) => v !== false && v !== 'false' && v !== 0 && v !== '0';
  const entero = (v: any, min: number, max: number, def: number) => { const n = parseInt(v); return Number.isFinite(n) && n >= min && n <= max ? n : def; };
  const texto = (v: any, max: number) => String(v == null ? '' : v).replace(/[\u200B-\u200D\uFEFF\u00AD]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
  const out: any = { shabat: { on: prendido(s.on), dia: entero(s.dia, 0, 5, 4), hora: entero(s.hora, 0, 23, 20), txt: texto(s.txt, 120) }, fiestas: {} };
  const f = c.fiestas && typeof c.fiestas === 'object' ? c.fiestas : {};
  FIESTAS_IDS.forEach((id) => {
    const x = f[id] && typeof f[id] === 'object' ? f[id] : {};
    const ids = Array.isArray(x.ids) ? x.ids.map((v: any) => parseInt(v)).filter((n: number) => n > 0) : [];
    out.fiestas[id] = { on: prendido(x.on), txt: texto(x.txt, 160), ids: Array.from(new Set(ids)).slice(0, 24) };
  });
  return out;
}
// 🚚 ENVÍO GRATIS (v4.90): desde cuánto (los productos, en pesos, de un pedido minorista) y en qué
// zona. Sin nada guardado: prendido, $ 120.000, CABA (lo que decidió Jony el 22/09). Lista blanca.
function normEnvio(raw: any) {
  const c = raw && typeof raw === 'object' ? raw : {};
  const min = parseInt(c.min);
  return {
    on: c.on !== false && c.on !== 'false' && c.on !== 0 && c.on !== '0',
    min: Number.isFinite(min) && min > 0 && min <= 100000000 ? min : 120000,
    zona: String(c.zona == null ? 'CABA' : c.zona).replace(/\s+/g, ' ').trim().slice(0, 40),
  };
}
// 🔥 LA VIDRIERA SE ORDENA SOLA (v4.87), a partir de los pedidos (no de las visitas):
//  · orden: lo que tuvo pedidos en 30 días, de más a menos. Con eso la tienda pone primero, en
//    cada categoría, lo que se vende.
//  · top: lo más pedido de la semana, con 2 pedidos como mínimo (lo que compró una sola persona
//    no es "lo más pedido"). Si la semana vino floja y no llegan a 4, se miran 14 días.
//  · agota: lo que al ritmo del último mes dura menos de 10 días y tuvo 3 pedidos o más, con el
//    stock que tenía al calcularlo. Si después entra mercadería, la tienda apaga el sello sola.
// Se cuentan PEDIDOS distintos, no unidades: un mayorista de 24 cajas no tapa a diez clientes.
// Los pases a Candy no cuentan (son internos). A la tienda viaja el orden y los sellos, nunca
// cuánto se vendió.
function calcularVidriera(ventas: any[], productos: any[], ahoraMs: number) {
  const porId: any = {};
  productos.forEach((p: any) => { porId[String(p.id)] = p; });
  const cuenta = (dias: number) => {
    const out: any = {};
    ventas.forEach((v: any) => {
      if (['cancelado', 'cotizacion'].includes(String(v.estado || '')) || String(v.cliente || '') === 'Candy') return;
      const t = v.creado ? Date.parse(String(v.creado)) : (tsDeFecha(String(v.fecha || '')) || NaN);
      if (!(t > 0) || ahoraMs - t > dias * 86400000) return;
      const enEste: any = {};
      String(v.stock_updates || '').split(',').forEach((u: string) => {
        const par = u.split(':'), id = String(par[0] || '').trim(), q = parseInt(par[1]) || 0;
        if (!id || q <= 0 || !porId[id]) return;
        const e = out[id] = out[id] || { ped: 0, u: 0 };
        e.u += q;
        if (!enEste[id]) { enEste[id] = 1; e.ped++; }
      });
    });
    return out;
  };
  const vivo = (id: string) => porId[id] && porId[id].activo !== false;
  const stockDe = (id: string) => parseInt(porId[id] && porId[id].stock) || 0;
  const c30 = cuenta(30);
  const ordenar = (c: any) => (a: string, b: string) => c[b].ped - c[a].ped || c[b].u - c[a].u || ((c30[b] || {}).ped || 0) - ((c30[a] || {}).ped || 0) || parseInt(a) - parseInt(b);
  const orden = Object.keys(c30).filter(vivo).sort(ordenar(c30)).map((id) => parseInt(id));
  const candidatos = (c: any) => Object.keys(c).filter((id) => vivo(id) && stockDe(id) > 0 && c[id].ped >= 2);
  let dias = 7, c = cuenta(7), top = candidatos(c);
  if (top.length < 4) { dias = 14; c = cuenta(14); top = candidatos(c); }
  top = top.sort(ordenar(c)).slice(0, 16);
  const agota: any = {};
  Object.keys(c30).forEach((id) => {
    const st = stockDe(id), e = c30[id];
    if (!vivo(id) || st <= 0 || e.ped < 3) return;
    if (st / (e.u / 30) < 10) agota[id] = st;
  });
  return { t: ahoraMs, dias, top: top.map((id) => parseInt(id)), orden, agota };
}
// 👤 LA FICHA DE UN VISITANTE (v4.85), armada a partir de sus eventos. Antes se contaba como
// "producto" cualquier texto de un evento, y desde que cada visita trae su ficha técnica (y cada
// salida sus segundos) en formato de código, eso aparecía en "Lo que más miró" y en el recorrido.
// Ahora: lo que más miró sale de las tandas de vistas, lo que puso en el carrito de los eventos de
// carrito, y el recorrido viaja como eventos compactos para dibujarlo visita por visita.
function resumirFicha(evs: any[]) {
  let nombre = '', telefono = '', ciudad = '', pais = '', dispositivo = '', origen = '';
  const dias: any = {}, vistos: any = {}, agregados: any = {}, cuenta: any = {};
  const linea: any[] = [];
  evs.forEach((r: any) => {
    const ev = String(r.evento || 'visita');
    cuenta[ev] = (cuenta[ev] || 0) + 1;
    // Lo último que dejó es lo que vale: si corrigió su nombre, manda el corregido.
    if (r.nombre) nombre = String(r.nombre);
    if (r.telefono) telefono = String(r.telefono);
    if (r.ciudad) ciudad = String(r.ciudad);
    if (r.pais) pais = String(r.pais);
    if (r.dispositivo) dispositivo = String(r.dispositivo);
    if (r.origen && !origen) origen = String(r.origen);   // el canal es el primer toque: el que lo trajo
    const f = String(r.fecha || '');
    if (f) dias[f.slice(0, 10)] = 1;
    if (ev === 'bloqueado' || ev === 'geo') return;
    const det = String(r.detalle || '');
    if (ev === 'vistas') leerVistas(det).forEach((n: string) => { vistos[n] = (vistos[n] || 0) + 1; });
    if (ev === 'carrito' && det && !esJSON(det)) agregados[det] = (agregados[det] || 0) + 1;
    const c = compactarEvento(r);
    c.fecha = f;
    if (!c.t) c.t = tsDeFecha(f) || 0;
    linea.push(c);
  });
  const top = (o: any) => Object.entries(o).sort((a: any, b: any) => b[1] - a[1]).map(([nombre, n]) => ({ nombre, n }));
  return { nombre, telefono, ciudad, pais, dispositivo, origen, cuenta, dias: Object.keys(dias).length,
    productos: top(vistos), agregados: top(agregados), linea };
}
async function eventosDelDia(dia: string, hoyK: string) {
  const [y, mo, d] = dia.split('-').map((x) => parseInt(x, 10));
  const sig = new Date(Date.UTC(y, mo - 1, d + 1));
  const p2 = (n: number) => String(n).padStart(2, '0');
  const diaSig = sig.getUTCFullYear() + '-' + p2(sig.getUTCMonth() + 1) + '-' + p2(sig.getUTCDate());
  // Argentina no tiene horario de verano desde 2009: el día de Buenos Aires va de 00:00 a 00:00 en -03:00.
  const desde = dia + 'T00:00:00-03:00', hasta = diaSig + 'T00:00:00-03:00';
  const filas = await sbGet('trafico', 'select=id,ts,vid,pagina,evento,origen,dispositivo,ciudad,pais,nombre,telefono,detalle,carrito,total'
    + '&ts=gte.' + encodeURIComponent(desde) + '&ts=lt.' + encodeURIComponent(hasta) + '&evento=not.in.(bloqueado,geo)&order=id.asc');
  return { dia, esHoy: dia === hoyK, eventos: filas.map(compactarEvento) };
}
// 🔴 HOY CONTRA EL MISMO DÍA DE LA SEMANA PASADA, hora por hora (v4.79, pestaña En vivo).
// "Comparado con el período anterior" mezcla un jueves con un lunes; esto compara el jueves con
// el jueves anterior. Las fechas de `trafico` ya están en hora de Buenos Aires, así que "hoy"
// es el día de Buenos Aires aunque el servidor viva en otro huso.
function hoyVsSemana(todas: any[]) {
  const m = fechaAhora().match(/(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})/);
  if (!m) return null;
  const hoyTs = Date.UTC(+m[3], +m[2] - 1, +m[1]);
  const dk = (ts: number) => { const d = new Date(ts); const p = (n: number) => String(n).padStart(2, '0'); return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate()); };
  const kHoy = dk(hoyTs), kHace7 = dk(hoyTs - 7 * 86400000);
  const hoy = new Array(24).fill(0), hace7 = new Array(24).fill(0);
  let masViejo = Infinity;
  todas.forEach((x: any) => {
    const t = x.t; if (!t) return;
    if (t.ts < masViejo) masViejo = t.ts;
    if (x.r.evento !== 'visita') return;
    if (t.dk === kHoy) hoy[t.hora]++; else if (t.dk === kHace7) hace7[t.hora]++;
  });
  const nombres = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  // ¿Los datos que se leyeron llegan hasta hace 7 días? Con "1 día" no (se leen 2), con 7 sí (se leen 14).
  return { hoy, hace7, horaActual: +m[4], diaNombre: nombres[new Date(hoyTs).getUTCDay()], fechaHoy: kHoy, fechaHace7: kHace7, hace7Disponible: masViejo <= hoyTs - 7 * 86400000 };
}
function analitica(rows: any[], dias: number, ventas: any[] = [], clientes: any[] = [], productos: any[] = [], aliasPuestos: any = null, opciones: any = null) {
  const alias = aliasPuestos || {};
  const soloHoy = !!(opciones && opciones.soloHoy);
  // 🧹 Lo que NO es tráfico del Shuk (v4.80): las visitas de los chicos (Candy, `pagina` candy-*) se
  // contaban como minorista del Shuk, y la página de diagnóstico se contaba como visita. Se apartan y
  // se informa cuánto se apartó, para que el número que se mira sea el de la tienda y nada más.
  const excluidos: any = { candy: 0, diagnostico: 0 };
  rows = rows.filter((r: any) => {
    if (String(r.pagina || '').startsWith('candy-')) { excluidos.candy++; return false; }
    if (String(r.origen || '') === 'diagnostico') { excluidos.diagnostico++; return false; }
    return true;
  });
  if (!rows.length) return { vacio: true, excluidos };
  const pf = (f: string) => { const m = (f || '').toString().match(/(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?/); return m ? { ts: Date.UTC(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)), hora: +(m[4] || 0), dow: new Date(Date.UTC(+m[3], +m[2] - 1, +m[1])).getUTCDay(), dk: m[3] + '-' + m[2] + '-' + m[1], ddmm: m[1] + '/' + m[2] + ' ' + (m[4] || '00') + ':' + (m[5] || '00') } : null; };
  const todas = rows.map((r: any) => ({ r, t: pf(r.fecha) })).filter((x) => x.t);
  const nowT = Date.now();
  // "Hoy" = desde las 00:00 de Buenos Aires; el período anterior es ayer completo. Las fechas de
  // `trafico` están en hora de Buenos Aires y se parsean como si fueran UTC, así que el corte de
  // "hoy" se arma en ese mismo sistema (de fechaAhora, no de Date.now()).
  const mH = fechaAhora().match(/(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})/);
  const hoy00 = mH ? Date.UTC(+mH[3], +mH[2] - 1, +mH[1]) : nowT - 86400000;
  const desdeT = soloHoy ? hoy00 : (dias > 0 ? nowT - dias * 86400000 : null);
  const prevT = soloHoy ? hoy00 - 86400000 : (dias > 0 ? nowT - 2 * dias * 86400000 : null);
  const filas = desdeT ? todas.filter((x) => x.t!.ts >= desdeT) : todas;
  const resumen: any = { visitas: 0, unicos: 0, nuevos: 0, recurrentes: 0, tienda: 0, mayorista: 0 };
  const porOrigen: any = {}, porDispositivo: any = {}, porCiudad: any = {}, porPais: any = {}, porHora = new Array(24).fill(0), porDia: any = {}, porDiaSemana = new Array(7).fill(0);
  const heatmap: any = Array.from({ length: 7 }, () => new Array(24).fill(0));   // 🗓️ v4.83 día × hora
  const prodDeseados: any = {}, origenVisitaVids: any = {}, origenPedidoVids: any = {};
  // 🔎 Lo que se agregó en la vuelta de rosca: el día a día en detalle, qué buscan en la
  // tienda, y qué tocó cada visitante (para poder contar SU historia, no solo el total).
  const porDiaDet: any = {}, busq: any = {};
  // 🌎 Control del candado geográfico: a cuánta gente rechazó, y los casos donde el país que
  // ve el navegador no coincide con el que ve el candado (VPN, proxy, o país ilegible).
  const bloqueos: any = { total: 0, porPais: {}, ultimo: '' };
  const discrepancias: any[] = [];
  // 🛒 El rescate del carrito: a cuántos se les ofreció, cuántos lo retomaron y —lo único
  // que importa de verdad— cuántos de ésos terminaron comprando.
  const resc: any = { ofrecidos: {}, retomados: {}, descartados: {} };
  // 🔁 v4.86: "lo de siempre" (ofrecido/cargado/descartado) y la encuesta de después del pedido.
  const recom: any = { ofrecidos: {}, cargados: {}, descartados: {} };
  const encuesta: any = { canales: {}, respuestas: 0, pushSi: 0 };
  // 🔥 v4.87: lo que se suma desde la fila "Lo más pedido" y desde "Completá los sabores".
  const vidr: any = { fila: {}, filaN: 0, sabOfr: {}, sabSum: {}, sabN: 0, fiesta: {}, fiestaN: 0, envio: {} };
  // 👁️ VER MÁS (v4.81): lo que hasta ahora era invisible — qué tarjetas se VIERON (no solo qué se
  // agarró), qué sacaron del carrito, si el cartel/las ofertas se tocan, qué se comparte, hasta dónde
  // bajan, y qué catálogo VIP abrió cada cliente.
  const vistasProd: any = {}; let vistasEventos = 0;
  const quitados: any = {};
  const promos: any = { oferta: { veces: 0, productos: {} }, pack: { veces: 0, productos: {} } };
  const compartidos: any = {};
  const avisoClics: any = { veces: 0, vids: {} };
  const scroll: any = { n: 0, suma: 0, alFinal: 0 };
  const vipAp: any = {};
  const embudoVids: any = { visita: {}, carrito: {}, checkout: {}, pedido: {} };
  const vids: any = {}, carritosPorVid: any = {};
  filas.forEach(({ r, t }) => {
    const vid = r.vid, pagina = r.pagina, evento = r.evento, origen = r.origen, disp = r.dispositivo, ciudad = r.ciudad, pais = r.pais, nombre = r.nombre, tel = r.telefono;
    const detalle = (r.detalle || '').toString(), cartJson = (r.carrito || '').toString(), totalEv = (r.total || '').toString();
    // Un rechazo del candado no es una visita ni un visitante: se cuenta aparte.
    if (evento === 'bloqueado') {
      bloqueos.total++;
      const pb = r.pais || 'sin dato';
      bloqueos.porPais[pb] = (bloqueos.porPais[pb] || 0) + 1;
      bloqueos.ultimo = r.fecha || '';
      return;
    }
    if (evento === 'geo') { discrepancias.push({ fecha: r.fecha, detalle, ciudad: r.ciudad || '', pais: r.pais || '' }); return; }
    if (evento === 'rescate') {
      const cual = detalle.split(' ')[0];                      // ofrecido | retomado | descartado
      if (vid && resc[cual + 's']) resc[cual + 's'][vid] = 1;
      return;
    }
    if (evento === 'recompra') {
      const cual = detalle.split(' ')[0];                      // ofrecido | cargado | descartado
      if (vid && recom[cual + 's']) recom[cual + 's'][vid] = 1;
      return;
    }
    if (evento === 'encuesta') {
      if (detalle.startsWith('canal:')) { const c = detalle.slice(6).trim().slice(0, 20) || 'otro'; encuesta.canales[c] = (encuesta.canales[c] || 0) + 1; encuesta.respuestas++; }
      if (detalle === 'push:si') encuesta.pushSi++;
      return;
    }
    if (evento === 'vidriera') {
      const [dondeV, queV] = detalle.split(' · ');                 // fila · <producto> | sabores · ofrecido | sabores · <producto>
      if (dondeV === 'fila' && queV) { vidr.filaN++; if (vid) vidr.fila[vid] = 1; }
      else if (dondeV === 'fiesta' && queV) { vidr.fiestaN++; if (vid) vidr.fiesta[vid] = 1; }   // 🗓️ v4.88
      else if (dondeV === 'envio' && queV === 'alcanzado') { if (vid) vidr.envio[vid] = 1; }       // 🚚 v4.90: la barra lo empujó al mínimo
      else if (dondeV === 'sabores' && queV === 'ofrecido') { if (vid) vidr.sabOfr[vid] = 1; }
      else if (dondeV === 'sabores' && queV) { vidr.sabN++; if (vid) vidr.sabSum[vid] = 1; }
      return;
    }
    if (vid && (evento === 'carrito' || evento === 'checkout' || evento === 'pedido')) {
      if (!carritosPorVid[vid]) carritosPorVid[vid] = { productos: {}, ultimaCarrito: null, ultimoPedido: null, etapa: 'carrito', items: null, total: 0, itemsTs: null, ddmm: '' };
      const c = carritosPorVid[vid];
      if (cartJson && (!c.itemsTs || t!.ts >= c.itemsTs)) { try { const arr = JSON.parse(cartJson); if (Array.isArray(arr) && arr.length) { c.items = arr; c.total = parseInt(totalEv) || 0; c.itemsTs = t!.ts; c.pagCarrito = pagina; } } catch { /**/ } }
      if (evento === 'pedido') { c.ultimoPedido = t!.ts; const og = origen || 'directo'; (origenPedidoVids[og] = origenPedidoVids[og] || {})[vid] = 1; }
      else { if (!c.ultimaCarrito || t!.ts > c.ultimaCarrito) { c.ultimaCarrito = t!.ts; c.ddmm = t!.ddmm; } if (evento === 'checkout') c.etapa = 'checkout'; if (detalle) c.productos[detalle] = 1; }
      if (detalle) prodDeseados[detalle] = (prodDeseados[detalle] || 0) + 1;
    }
    if (evento === 'visita') {
      resumen.visitas++; resumen[pagina === 'mayorista' ? 'mayorista' : 'tienda']++;
      const og = origen || 'directo'; porOrigen[og] = (porOrigen[og] || 0) + 1;
      if (vid) (origenVisitaVids[og] = origenVisitaVids[og] || {})[vid] = 1;
      if (disp) porDispositivo[disp] = (porDispositivo[disp] || 0) + 1;
      if (ciudad) porCiudad[ciudad] = (porCiudad[ciudad] || 0) + 1;
      if (pais) porPais[pais] = (porPais[pais] || 0) + 1;
      porHora[t!.hora]++; porDiaSemana[t!.dow]++; porDia[t!.dk] = (porDia[t!.dk] || 0) + 1; heatmap[t!.dow][t!.hora]++;
    }
    // Día a día en detalle: no solo "cuántas visitas" sino qué pasó ese día.
    const dk = t!.dk;
    const D = porDiaDet[dk] = porDiaDet[dk] || { fecha: dk, visitas: 0, unicos: {}, carrito: {}, checkout: {}, pedido: {}, prod: {} };
    if (evento === 'visita') D.visitas++;
    if (vid) { D.unicos[vid] = 1; if (D[evento]) D[evento][vid] = 1; }
    if (detalle && (evento === 'carrito' || evento === 'pedido')) D.prod[detalle] = (D.prod[detalle] || 0) + 1;
    // 🔎 Búsquedas dentro de la tienda: `detalle` es lo que tipearon, `total` cuántos resultados
    // les salieron. Una búsqueda con 0 resultados es un pedido de compra que no pudiste cumplir.
    if (evento === 'busqueda' && detalle) {
      const q = detalle.toLowerCase().trim().slice(0, 40);
      const b = busq[q] = busq[q] || { q: detalle.trim().slice(0, 40), veces: 0, vacias: 0, vids: {} };
      b.veces++; if ((parseInt(totalEv) || 0) === 0) b.vacias++; if (vid) b.vids[vid] = 1;
    }
    if (evento === 'vistas') {
      const nombresV = leerVistas(detalle);   // v4.84: también rescata las tandas que llegaron cortadas
      nombresV.forEach((n: string) => { const V = vistasProd[n] = vistasProd[n] || { veces: 0, vids: {} }; V.veces++; if (vid) V.vids[vid] = 1; });
      if (nombresV.length) vistasEventos++;
    }
    if (evento === 'quitar' && detalle) { const Qd = quitados[detalle] = quitados[detalle] || { sacado: 0, bajado: 0 }; if ((parseInt(totalEv) || 0) === 0) Qd.sacado++; else Qd.bajado++; }
    if (evento === 'promo' && detalle) { const tipo = detalle.startsWith('pack') ? 'pack' : 'oferta'; const nom = detalle.replace(/^(oferta|pack) · /, ''); promos[tipo].veces++; promos[tipo].productos[nom] = (promos[tipo].productos[nom] || 0) + 1; }
    if (evento === 'compartir' && detalle) compartidos[detalle] = (compartidos[detalle] || 0) + 1;
    if (evento === 'aviso') { avisoClics.veces++; if (vid) avisoClics.vids[vid] = 1; }
    if (evento === 'salida' && esJSON(detalle)) { try { const sx = JSON.parse(detalle); if (typeof sx.sc === 'number') { scroll.n++; scroll.suma += sx.sc; if (sx.sc >= 90) scroll.alFinal++; } } catch { /**/ } }
    if (evento === 'visita' && esJSON(detalle)) {
      try { const fv = JSON.parse(detalle); if (fv.vip) { const VA = vipAp[fv.vip] = vipAp[fv.vip] || { aperturas: 0, vids: {}, ultima: '', ultimaTs: 0 }; VA.aperturas++; if (vid) VA.vids[vid] = 1; if (t!.ts >= VA.ultimaTs) { VA.ultimaTs = t!.ts; VA.ultima = r.fecha || ''; } } } catch { /**/ }
    }
    if (embudoVids[evento] && vid) embudoVids[evento][vid] = 1;   // 'salida' no está en el embudo: no infla nada
    if (vid) {
      if (!vids[vid]) vids[vid] = { visitas: 0, fechas: {}, nombre: '', telefono: '', ciudad: '', origen, pagina, primera: t!.ts, ultima: t!.ts, dispositivo: '', pais: '', productos: {}, eventos: {}, ficha: null, seg: 0, inter: 0, vistos: 0 };
      const o = vids[vid];
      if (evento === 'visita') o.visitas++;
      o.eventos[evento] = (o.eventos[evento] || 0) + 1;
      if (disp && !o.dispositivo) o.dispositivo = disp;
      if (pais && !o.pais) o.pais = pais;
      if (detalle && (evento === 'carrito' || evento === 'checkout' || evento === 'pedido')) o.productos[detalle] = (o.productos[detalle] || 0) + 1;
      // 🔬 Del anónimo igual se sabe muchísimo: la visita trae su ficha técnica (zona horaria,
      // idioma, aparato, pantalla) y la salida cuánto se quedó y cuánto tocó.
      if (evento === 'visita' && esJSON(detalle)) { try { o.ficha = { ...(o.ficha || {}), ...JSON.parse(detalle) }; } catch { /**/ } }
      if (evento === 'salida' && esJSON(detalle)) {
        try { const sx = JSON.parse(detalle); o.seg += parseInt(sx.seg) || 0; o.inter += parseInt(sx.int) || 0; o.vistos = Math.max(o.vistos, parseInt(sx.prod) || 0); } catch { /**/ }
      }
      o.fechas[t!.dk] = 1;
      if (nombre && !o.nombre) o.nombre = nombre;
      if (tel && !o.telefono) o.telefono = tel;
      if (ciudad && !o.ciudad) o.ciudad = ciudad;
      if (t!.ts < o.primera) o.primera = t!.ts; if (t!.ts > o.ultima) o.ultima = t!.ts;
    }
  });
  const listaVids = Object.keys(vids); resumen.unicos = listaVids.length;
  // 🧮 SESIONES (v4.80): una "visita" es cada carga de la página (recargar cuenta dos). Una sesión es
  // una venida de verdad: las ENTRADAS de la misma persona con menos de 30 minutos entre una y otra
  // son la misma sesión. Solo una entrada abre sesión: el que se quedó 40 minutos en la página y
  // recién ahí tocó el carrito no "volvió", sigue en la misma. Por eso sesiones ≤ visitas, siempre.
  const tsPorVid: any = {};
  filas.forEach(({ r, t }) => { if (r.vid && r.evento === 'visita') (tsPorVid[r.vid] = tsPorVid[r.vid] || []).push(t!.ts); });
  let sesiones = 0;
  Object.keys(tsPorVid).forEach((v) => {
    const ts = tsPorVid[v].sort((a: number, b: number) => a - b);
    let ult = -Infinity;
    ts.forEach((x: number) => { if (x - ult > 30 * 60000) sesiones++; ult = x; });
  });
  resumen.sesiones = sesiones;
  listaVids.forEach((v) => { if (Object.keys(vids[v].fechas).length >= 2) resumen.recurrentes++; else resumen.nuevos++; });
  const fmtU = (ts: number) => { const d = new Date(ts); const p = (n: number) => String(n).padStart(2, '0'); return p(d.getUTCDate()) + '/' + p(d.getUTCMonth() + 1) + '/' + d.getUTCFullYear() + ' ' + p(d.getUTCHours()) + ':' + p(d.getUTCMinutes()); };
  const leads = listaVids.filter((v) => vids[v].nombre || vids[v].telefono).map((v) => ({ nombre: vids[v].nombre || '(sin nombre)', telefono: vids[v].telefono || '', ciudad: vids[v].ciudad, origen: vids[v].origen, pagina: vids[v].pagina, visitas: vids[v].visitas, ultima: fmtU(vids[v].ultima) })).sort((a, b) => b.visitas - a.visitas);
  const topCiudades = Object.entries(porCiudad).sort((a: any, b: any) => b[1] - a[1]).slice(0, 8).map(([nombre, n]) => ({ nombre, n }));
  const topPaises = Object.entries(porPais).sort((a: any, b: any) => b[1] - a[1]).slice(0, 6).map(([nombre, n]) => ({ nombre, n }));
  const dias30 = Object.entries(porDia).sort((a: any, b: any) => a[0] < b[0] ? -1 : 1).map(([fecha, n]) => ({ fecha, n }));
  const topProductos = Object.entries(prodDeseados).sort((a: any, b: any) => b[1] - a[1]).slice(0, 10).map(([nombre, n]) => ({ nombre, n }));
  const conversionPorOrigen = Object.keys(origenVisitaVids).map((og) => { const uv = Object.keys(origenVisitaVids[og]).length; const up = origenPedidoVids[og] ? Object.keys(origenPedidoVids[og]).length : 0; return { origen: og, visitantes: uv, pedidos: up, pct: uv ? Math.round(up / uv * 100) : 0 }; }).sort((a, b) => b.visitantes - a.visitantes);
  const embudo = { visita: Object.keys(embudoVids.visita).length, carrito: Object.keys(embudoVids.carrito).length, checkout: Object.keys(embudoVids.checkout).length, pedido: Object.keys(embudoVids.pedido).length };
  let comparativa = null;
  if (prevT !== null && desdeT !== null) {
    const prevFilas = todas.filter((x) => x.t!.ts >= prevT && x.t!.ts < desdeT);
    let pVis = 0; const pUni: any = {}, pPed: any = {};
    prevFilas.forEach(({ r }) => { if (r.evento === 'visita') pVis++; if (r.vid) { pUni[r.vid] = 1; if (r.evento === 'pedido') pPed[r.vid] = 1; } });
    const delta = (a: number, b: number) => b > 0 ? Math.round((a - b) / b * 100) : (a > 0 ? 100 : 0);
    comparativa = { visitas: { actual: resumen.visitas, anterior: pVis, delta: delta(resumen.visitas, pVis) }, unicos: { actual: resumen.unicos, anterior: Object.keys(pUni).length, delta: delta(resumen.unicos, Object.keys(pUni).length) }, pedidos: { actual: embudo.pedido, anterior: Object.keys(pPed).length, delta: delta(embudo.pedido, Object.keys(pPed).length) } };
  }

  // ══════════════════════════════════════════════════════════════════════════════
  //  🕵️ QUIÉN ES QUIÉN — el cruce que convierte "visitante anónimo" en una persona.
  //  Todo pedido hecho desde la tienda guarda el `vid` del aparato (columna ventas.vid).
  //  Entonces, si ese mismo teléfono/compu ya compró alguna vez, sabemos su nombre, su
  //  teléfono y cuánto gastó — AUNQUE en esta visita no haya dejado un solo dato.
  //  Sin esto, la pantalla mostraba 28 de 30 carritos como "👤 Visitante anónimo".
  // ══════════════════════════════════════════════════════════════════════════════
  const kAna = (x: any) => String(x == null ? '' : x).substring(0, 40).trim().toLowerCase();
  const normNom = (x: any) => String(x == null ? '' : x).trim().toLowerCase();
  const telDeCliente: any = {}, tipoDeCliente: any = {};
  clientes.forEach((c: any) => { const k = normNom(c.nombre); if (!k) return; if (c.telefono) telDeCliente[k] = String(c.telefono); if (c.tipo) tipoDeCliente[k] = String(c.tipo); });

  const compraDeVid: any = {};
  ventas.forEach((v: any) => {
    const vidV = String(v.vid || '').trim();
    const est = (v.estado || '').toString();
    if (!vidV || est === 'cancelado' || est === 'cotizacion') return;
    const o = compraDeVid[vidV] = compraDeVid[vidV] || { compras: 0, ars: 0, usd: 0, cliente: '', ultimaTs: 0, ultima: '' };
    o.compras++; o.ars += parseFloat(v.total_ars) || 0; o.usd += parseFloat(v.total_usd) || 0;
    if (!o.cliente && v.cliente) o.cliente = String(v.cliente);
    const tsV = tsDeFecha(v.fecha); if (tsV && tsV > o.ultimaTs) { o.ultimaTs = tsV; o.ultima = String(v.fecha || ''); }
  });
  // Segunda pasada: el nombre también sirve de puente. Alguien que se registró con su nombre
  // y compró antes desde OTRO aparato igual queda identificado como cliente.
  const compraDeNombre: any = {};
  ventas.forEach((v: any) => {
    const est = (v.estado || '').toString();
    if (est === 'cancelado' || est === 'cotizacion') return;
    const k = normNom(v.cliente); if (!k) return;
    const o = compraDeNombre[k] = compraDeNombre[k] || { compras: 0, ars: 0, usd: 0, ultimaTs: 0, ultima: '' };
    o.compras++; o.ars += parseFloat(v.total_ars) || 0; o.usd += parseFloat(v.total_usd) || 0;
    const tsV = tsDeFecha(v.fecha); if (tsV && tsV > o.ultimaTs) { o.ultimaTs = tsV; o.ultima = String(v.fecha || ''); }
  });

  // ══════════════════════════════════════════════════════════════════════════════
  //  🏷️ PONERLE UN NOMBRE AL QUE NO LO DEJÓ
  //  Dos cosas distintas y las dos hacen falta:
  //  ① Un APODO automático y estable (#A4F2, sacado de su id de aparato). No dice quién es,
  //     pero permite RECONOCERLO: si vuelve dentro de un mes es el mismo #A4F2, se lo puede
  //     anotar, seguir y hablar de él. Un "visitante anónimo" no se puede ni nombrar.
  //  ② Un nombre puesto A MANO: cuando Jony deduce quién es ("este es el primo de David"),
  //     lo bautiza desde el panel y queda para siempre, en todas las pantallas. Convierte
  //     una corazonada en un dato. Va marcado como puesto por él, nunca se confunde con
  //     un nombre que la persona haya dejado de verdad.
  // ══════════════════════════════════════════════════════════════════════════════
  const apodoDe = (v: string) => '#' + String(v || '').replace(/[^a-z0-9]/gi, '').slice(-4).toUpperCase();
  const quienEs = (v: string) => {
    const o = vids[v] || {}, c = compraDeVid[v];
    const puesto = alias[v];
    const nombre = (o.nombre || (c && c.cliente) || (puesto && puesto.alias) || '').toString();
    const kn = normNom(nombre);
    const cn = kn ? compraDeNombre[kn] : null;
    const hist = c || cn;
    return {
      nombre,
      telefono: (o.telefono || telDeCliente[kn] || '').toString(),
      esCliente: !!hist,
      compras: hist ? hist.compras : 0,
      gastadoARS: hist ? Math.round(hist.ars) : 0,
      gastadoUSD: hist ? Math.round(hist.usd * 100) / 100 : 0,
      ultimaCompra: hist ? hist.ultima : '',
      tipoCliente: tipoDeCliente[kn] || '',
      comoSeSupo: o.nombre ? 'se registró' : (c ? 'ya compró desde este aparato' : (cn ? 'ya compró antes' : (puesto && puesto.alias ? 'se lo pusiste vos' : ''))),
      apodo: apodoDe(v),
      leDijiste: !!(puesto && puesto.alias) && !o.nombre && !c,
      nota: (puesto && puesto.nota) || '',
    };
  };

  // ══════════════════════════════════════════════════════════════════════════════
  //  💵 LA MONEDA DEL CARRITO — caso real (un cliente, 27/08): armó un carrito
  //  MAYORISTA de U$S 85,50 y la pantalla mostraba "$ 86". El mayorista puede tener
  //  precios en dólares; el minorista SIEMPRE cobra en pesos. Sumarlos como si fueran
  //  la misma plata desordena la prioridad (ese carrito aparecía último) y miente el total.
  //  Los carritos nuevos ya viajan con la moneda de cada renglón; para los viejos se
  //  deduce de la página del evento + la moneda del producto.
  // ══════════════════════════════════════════════════════════════════════════════
  const esUSD: any = {};
  productos.forEach((p: any) => { esUSD[kAna(p.nombre)] = (p.moneda === 'U$S'); });
  // Tipo de cambio de referencia: el de la venta más reciente que lo tenga cargado. Solo se
  // usa para ORDENAR y para el total "equivalente" — los dos importes se muestran separados.
  let tcRef = 0, tcTs = 0;
  ventas.forEach((v: any) => {
    const tc = parseFloat(v.tipo_cambio) || 0;
    if (tc <= 0) return;
    const ts = tsDeFecha(v.fecha) || 0;
    if (ts >= tcTs) { tcTs = ts; tcRef = tc; }
  });
  if (tcRef <= 0) tcRef = 1000;
  const totalesCarrito = (c: any) => {
    let ars = 0, usd = 0;
    const may = c.pagCarrito === 'mayorista';
    (c.items || []).forEach((it: any) => {
      const v = (parseFloat(it.q) || 0) * (parseFloat(it.p) || 0);
      // `it.m` lo manda la tienda desde v4.70; si no está (carritos viejos) se deduce.
      const enUSD = it.m ? (it.m === 'U$S') : (may && !!esUSD[kAna(it.n)]);
      if (enUSD) usd += v; else ars += v;
    });
    if (!(c.items || []).length) { ars = c.total || 0; }      // sin detalle: lo que haya
    return { ars: Math.round(ars), usd: Math.round(usd * 100) / 100, equiv: Math.round(ars + usd * tcRef) };
  };

  // ── 🛒 CARRITOS SIN TERMINAR, ahora con nombre, antigüedad y prioridad ──────────
  const ahoraT = Date.now();
  const abandonados = Object.keys(carritosPorVid)
    .filter((v) => { const c = carritosPorVid[v]; return c.ultimaCarrito && (!c.ultimoPedido || c.ultimoPedido < c.ultimaCarrito); })
    .map((v) => {
      const c = carritosPorVid[v], info = vids[v] || {}, q = quienEs(v);
      const horas = Math.round((ahoraT - c.ultimaCarrito) / 3600000);
      const m = totalesCarrito(c);
      // Prioridad: primero al que se puede contactar y más plata dejó en la mesa, con lo
      // reciente pesando fuerte (un carrito de hace 3 días ya está frío). La plata se mide
      // en el equivalente en pesos: si no, un carrito en dólares parecía de dos mangos.
      const score = (q.telefono ? 1000 : 0) + (q.esCliente ? 600 : 0) + (c.etapa === 'checkout' ? 400 : 0)
        + Math.min(500, Math.round(m.equiv / 1000)) + Math.max(0, 300 - horas * 2);
      return {
        vid: v, ...q, ciudad: info.ciudad || '', dispositivo: info.dispositivo || '',
        origen: info.origen || 'directo', visitas: info.visitas || 0,
        etapa: c.etapa, productos: Object.keys(c.productos).slice(0, 6), items: c.items || null,
        total: m.ars, totalUSD: m.usd, totalEquiv: m.equiv, mayorista: c.pagCarrito === 'mayorista',
        cuando: c.ddmm, ts: c.ultimaCarrito, horas, score,
      };
    })
    .sort((a, b) => b.score - a.score).slice(0, 60);

  // ── 👥 FICHA DE CADA VISITANTE — la lista completa, con lo que hizo cada uno ─────
  // ── 🔬 QUÉ SE PUEDE DECIR DE UN ANÓNIMO ────────────────────────────────────────
  // La zona horaria es el dato más honesto de todos: un argentino con VPN sigue teniendo la
  // hora de Buenos Aires. Sirve para saber dónde está DE VERDAD alguien, y —cruzada con el
  // resto— para separar a una persona de un robot de escaneo (que no toca nada y se va en
  // dos segundos). Los robots se MARCAN, nunca se borran: los números siguen siendo los reales.
  const zonaAPais = (tz: string) => {
    const z = (tz || '').toLowerCase();
    if (z.includes('argentina') || z.includes('buenos_aires')) return 'Argentina';
    if (z.includes('jerusalem') || z.includes('tel_aviv')) return 'Israel';
    if (z.includes('montevideo')) return 'Uruguay';
    if (z.includes('sao_paulo') || z.includes('brazil')) return 'Brasil';
    if (z.includes('santiago')) return 'Chile';
    if (z.includes('asuncion')) return 'Paraguay';
    if (z.startsWith('america/')) return 'América (' + (tz.split('/').pop() || '').replace(/_/g, ' ') + ')';
    if (z.startsWith('europe/')) return 'Europa (' + (tz.split('/').pop() || '').replace(/_/g, ' ') + ')';
    return tz || '';
  };
  const idiomaLegible = (i: string) => {
    const x = (i || '').toLowerCase();
    if (x.startsWith('es')) return 'español';
    if (x.startsWith('he') || x.startsWith('iw')) return 'hebreo';
    if (x.startsWith('en')) return 'inglés';
    if (x.startsWith('pt')) return 'portugués';
    return i || '';
  };
  const leerPerfil = (o: any) => {
    const f = o.ficha || {};
    const dondeEsta = zonaAPais(f.tz || '');
    const señales: string[] = [];
    // ⚖️ NO SE PUEDE ACUSAR SIN PRUEBAS: a un visitante solo se lo juzga si dejó ficha técnica
    // o tiempo de permanencia. Los anteriores a esta mejora no tienen nada de eso — marcarlos
    // como robots por no traer un dato que en su momento no existía sería una calumnia.
    const juzgable = !!o.ficha || o.seg > 0;
    if (juzgable) {
      if (o.seg > 0 && o.seg < 3) señales.push('se fue en ' + o.seg + ' s');
      if (o.inter === 0 && o.visitas <= 1) señales.push('no tocó nada');
      if (!f.tz) señales.push('el navegador no dice ni en qué huso horario está');
      if (f.px && /^(0x0|1x1)$/.test(f.px)) señales.push('pantalla de 0 píxeles');
    }
    if (f.bot === 1) señales.push('su navegador se presenta como programa automático');   // 🤖 v4.83 (lo marca el servidor del sitio)
    const bot = (juzgable && señales.length >= 2 && o.inter === 0) || f.bot === 1;
    return {
      dondeEsta, tz: f.tz || '', idioma: idiomaLegible(f.idi || ''), aparato: f.ap || '',
      pantalla: f.px || '', tactil: f.toq === 1, appInstalada: f.pwa === 1, aceptaAvisos: f.push === 1,
      desdeApp: f.wa === 1, horaLocal: typeof f.hl === 'number' && f.hl >= 0 ? f.hl : null,
      conPase: f.pase === 1,
      segundos: o.seg, interacciones: o.inter, productosVistos: o.vistos,
      pareceRobot: bot, señales,
    };
  };

  const visitantesTodos = listaVids.map((v) => {
    const o = vids[v], q = quienEs(v), c = carritosPorVid[v];
    return {
      perfil: leerPerfil(o),
      vid: v, ...q,
      visitas: o.visitas, dias: Object.keys(o.fechas).length,
      primeraTs: o.primera, ultimaTs: o.ultima, primera: fmtU(o.primera), ultima: fmtU(o.ultima),
      ciudad: o.ciudad || '', pais: o.pais || '', dispositivo: o.dispositivo || '',
      origen: o.origen || 'directo', pagina: o.pagina || 'tienda',
      productos: Object.keys(o.productos).slice(0, 10),
      armoCarrito: !!o.eventos.carrito, checkout: !!o.eventos.checkout, pidio: !!o.eventos.pedido,
      valorCarrito: c ? (c.total || 0) : 0,
      // 🌡️ v4.83: qué tan cerca está de comprar (0-100). El que ya pidió no está "cerca": ya llegó (0).
      calor: o.eventos.pedido ? 0 : Math.min(100, (o.eventos.checkout ? 45 : 0) + (o.eventos.carrito ? 25 : 0) + (q.esCliente ? 15 : 0) + (Object.keys(o.fechas).length >= 2 ? 10 : 0) + (q.telefono ? 5 : 0) + (o.visitas >= 3 ? 5 : 0) + (o.seg > 60 ? 5 : 0)),
      // La etiqueta que resume qué es esta persona para el negocio.
      etiqueta: o.eventos.pedido ? 'compró' : (q.esCliente ? 'cliente que volvió' : (o.eventos.checkout ? 'casi compra' : (o.eventos.carrito ? 'armó carrito' : (Object.keys(o.fechas).length >= 2 ? 'mirón que vuelve' : 'miró y se fue')))),
    };
  }).sort((a, b) => b.ultimaTs - a.ultimaTs);
  const visitantes = visitantesTodos.slice(0, 400);

  // ══════════════════════════════════════════════════════════════════════════════
  //  🧠 MÁS INTELIGENTE (v4.83): cohortes, plata por canal, proyección de la semana, mayoristas dormidos.
  // ══════════════════════════════════════════════════════════════════════════════
  const lunesDe = (ts: number) => { const d = new Date(ts); const dow = (d.getUTCDay() + 6) % 7; return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - dow); };
  // 🔁 COHORTES: de los que aparecieron por primera vez cada semana, cuántos volvieron otro día y cuántos compraron.
  // "Primera vez" = primera aparición dentro de lo leído (2× la ventana): quien ya venía de antes no es nuevo.
  const primeraDe: any = {}, diasDe: any = {}, pidioAlguna: any = {};
  todas.forEach(({ r, t }) => { if (!r.vid) return; if (primeraDe[r.vid] === undefined || t!.ts < primeraDe[r.vid]) primeraDe[r.vid] = t!.ts; (diasDe[r.vid] = diasDe[r.vid] || {})[t!.dk] = 1; if (r.evento === 'pedido') pidioAlguna[r.vid] = 1; });
  const cohMap: any = {};
  Object.keys(primeraDe).forEach((v) => {
    if (desdeT !== null && primeraDe[v] < desdeT) return;
    const wk = lunesDe(primeraDe[v]);
    const C = cohMap[wk] = cohMap[wk] || { semana: wk, nuevos: 0, volvieron: 0, compraron: 0 };
    C.nuevos++; if (Object.keys(diasDe[v]).length >= 2) C.volvieron++; if (pidioAlguna[v]) C.compraron++;
  });
  const cohortes = Object.values(cohMap).map((x: any) => x).sort((a: any, b: any) => a.semana - b.semana).slice(-8)
    .map((C: any) => ({ semana: fmtU(C.semana).slice(0, 5), semanaTs: C.semana, nuevos: C.nuevos, volvieron: C.volvieron, compraron: C.compraron, pctVolvieron: C.nuevos ? Math.round(C.volvieron / C.nuevos * 100) : 0, pctCompraron: C.nuevos ? Math.round(C.compraron / C.nuevos * 100) : 0 }));
  // 💰 PLATA POR CANAL: las ventas del período (no canceladas ni cotizaciones), atribuidas al canal por el que entró ese aparato.
  const plataOrigen: any = {};
  ventas.forEach((v: any) => {
    const est = (v.estado || '').toString(); if (est === 'cancelado' || est === 'cotizacion') return;
    const tsV = tsDeFecha(v.fecha); if (tsV === null || (desdeT !== null && tsV < desdeT)) return;
    const o = vids[String(v.vid || '').trim()]; if (!o) return;
    const og = o.origen || 'directo';
    const Pl = plataOrigen[og] = plataOrigen[og] || { ars: 0, usd: 0, n: 0 };
    Pl.ars += parseFloat(v.total_ars) || 0; Pl.usd += parseFloat(v.total_usd) || 0; Pl.n++;
  });
  conversionPorOrigen.forEach((c: any) => { const Pl = plataOrigen[c.origen]; c.plataARS = Pl ? Math.round(Pl.ars) : 0; c.plataUSD = Pl ? Math.round(Pl.usd * 100) / 100 : 0; c.ventas = Pl ? Pl.n : 0; });
  // 📈 PROYECCIÓN: lo que va de la semana (desde el lunes 00:00, hora de Buenos Aires) estirado a 7 días.
  let proyeccion: any = null;
  if (mH) {
    const ahoraBA = Date.UTC(+mH[3], +mH[2] - 1, +mH[1], +mH[4], +mH[5]);
    const lunes = lunesDe(hoy00);
    const transcurrido = (ahoraBA - lunes) / (7 * 86400000);
    let masViejo = Infinity; todas.forEach((x) => { if (x.t!.ts < masViejo) masViejo = x.t!.ts; });
    const cubierta = masViejo <= lunes;
    if (transcurrido >= 1 / 7) {
      let vis = 0; const ped: any = {};
      todas.forEach(({ r, t }) => { if (t!.ts < lunes) return; if (r.evento === 'visita') vis++; if (r.evento === 'pedido' && r.vid) ped[r.vid] = 1; });
      const nPed = Object.keys(ped).length;
      proyeccion = { visitas: vis, visitasProy: Math.round(vis / transcurrido), pedidos: nPed, pedidosProy: Math.round(nPed / transcurrido), diasTranscurridos: Math.round(transcurrido * 70) / 10, cubierta };
    }
  }
  // 😴 MAYORISTAS DORMIDOS: clientes mayoristas sin visita ni compra en el período, con última compra hace 30 días o más.
  const ultimaCompraDe: any = {};
  ventas.forEach((v: any) => { const est = (v.estado || '').toString(); if (est === 'cancelado' || est === 'cotizacion') return; const k = normNom(v.cliente); if (!k) return; const tsV = tsDeFecha(v.fecha) || 0; if (!ultimaCompraDe[k] || tsV > ultimaCompraDe[k].ts) ultimaCompraDe[k] = { ts: tsV, fecha: String(v.fecha || '') }; });
  const activosNombre: any = {};
  listaVids.forEach((v) => { const qn = quienEs(v); if (qn.nombre) activosNombre[normNom(qn.nombre)] = 1; });
  const dormidos = clientes.filter((c: any) => String(c.tipo || '') === 'Mayorista' && c.nombre)
    .map((c: any) => { const k = normNom(c.nombre); const uc = ultimaCompraDe[k]; return { nombre: String(c.nombre), telefono: String(c.telefono || ''), ultimaCompra: uc ? uc.fecha : '', diasSinComprar: uc ? Math.round((nowT - uc.ts) / 86400000) : null, activo: !!activosNombre[k] }; })
    .filter((c: any) => !c.activo && c.diasSinComprar !== null && c.diasSinComprar >= 30)
    .sort((a: any, b: any) => a.diasSinComprar - b.diasSinComprar).slice(0, 30);

  // ── 📅 EL DÍA A DÍA, en detalle ────────────────────────────────────────────────
  const diasDetalle = Object.keys(porDiaDet).sort().map((dk) => {
    const D = porDiaDet[dk];
    const u = Object.keys(D.unicos).length, ped = Object.keys(D.pedido).length;
    return {
      fecha: dk, visitas: D.visitas, unicos: u,
      carritos: Object.keys(D.carrito).length, checkouts: Object.keys(D.checkout).length,
      pedidos: ped, conv: u ? Math.round(ped / u * 100) : 0,
      top: Object.entries(D.prod).sort((a: any, b: any) => b[1] - a[1]).slice(0, 3).map(([nombre, n]) => ({ nombre, n })),
    };
  });

  // ── 🔥 DESEO vs VENTA — lo que quieren contra lo que realmente se vendió ────────
  const stockDe: any = {}, infoProd: any = {};
  productos.forEach((p: any) => {
    const k = kAna(p.nombre);
    stockDe[k] = (stockDe[k] || 0) + (parseInt(p.stock) || 0);
    if (!infoProd[k]) infoProd[k] = { activo: p.activo !== false, dueno: String(p.dueno || ''), nombre: String(p.nombre || ''), id: '', stockId: -1 };
    // ✨ v4.87: el id va para poder pedirle a la IA la ficha de ESE producto. Entre gemelos (mismo
    // nombre), el que tiene stock: es el que la gente está viendo en la tienda.
    const stP = parseInt(p.stock) || 0;
    if (p.activo !== false && stP > infoProd[k].stockId) { infoProd[k].id = String(p.id); infoProd[k].stockId = stP; }
  });
  const vendidoU: any = {}, nomDeId: any = {};
  productos.forEach((p: any) => { nomDeId[String(p.id)] = String(p.nombre || ''); });
  ventas.forEach((v: any) => {
    const est = (v.estado || '').toString();
    if (est === 'cancelado' || est === 'cotizacion') return;
    const tsV = tsDeFecha(v.fecha);
    if (desdeT !== null && (tsV === null || tsV < desdeT)) return;      // solo el período mirado
    String(v.stock_updates || '').split(',').forEach((u: string) => {
      const pp = u.split(':'), id = String(pp[0] || '').trim(), q = parseInt(pp[1]) || 0;
      if (!id || !q || !nomDeId[id]) return;
      const k = kAna(nomDeId[id]);
      vendidoU[k] = (vendidoU[k] || 0) + q;
    });
  });
  // Todo se cruza por el nombre recortado a 40 (kAna): las vistas viajan así, y los nombres largos
  // no cerrarían contra el carrito, que manda el nombre completo.
  const vistasK: any = {}, quitK: any = {}, compK: any = {};
  Object.keys(vistasProd).forEach((n) => { const k = kAna(n); const V = vistasK[k] = vistasK[k] || { nombre: n, veces: 0, vids: {} }; V.veces += vistasProd[n].veces; Object.assign(V.vids, vistasProd[n].vids); });
  Object.keys(quitados).forEach((n) => { const k = kAna(n); quitK[k] = (quitK[k] || 0) + quitados[n].sacado + quitados[n].bajado; });
  Object.keys(compartidos).forEach((n) => { const k = kAna(n); compK[k] = (compK[k] || 0) + compartidos[n]; });
  const deseadoK: any = {}; Object.keys(prodDeseados).forEach((n) => { deseadoK[kAna(n)] = 1; });
  const deseoVsVenta = Object.keys(prodDeseados).map((nombre) => {
    const k = kAna(nombre), st = stockDe[k];
    return {
      nombre, deseado: prodDeseados[nombre], vendido: vendidoU[k] || 0,
      stock: st === undefined ? null : st,
      activo: infoProd[k] ? infoProd[k].activo : true,
      dueno: infoProd[k] ? infoProd[k].dueno : '',
      vistos: vistasK[k] ? vistasK[k].veces : 0, personasVieron: vistasK[k] ? Object.keys(vistasK[k].vids).length : 0,
      quitado: quitK[k] || 0, compartido: compK[k] || 0,
    };
  }).sort((a, b) => b.deseado - a.deseado).slice(0, 40);
  // 👁️ Lo que se ve y no se agarra, y lo que nadie llega a ver (solo si ya hay vistas registradas:
  // antes de esta versión no existían, y "nadie lo vio" sería mentira).
  const verMas: any = {
    eventos: vistasEventos,
    vistosSinCarrito: Object.keys(vistasK).filter((k) => !deseadoK[k]).map((k) => ({ nombre: vistasK[k].nombre, vistos: vistasK[k].veces, personas: Object.keys(vistasK[k].vids).length, stock: stockDe[k] === undefined ? null : stockDe[k], dueno: infoProd[k] ? infoProd[k].dueno : '', id: infoProd[k] ? infoProd[k].id : '' })).sort((a, b) => b.personas - a.personas || b.vistos - a.vistos).slice(0, 15),
    nuncaVistos: vistasEventos ? Object.keys(stockDe).filter((k) => stockDe[k] > 0 && infoProd[k] && infoProd[k].activo && !vistasK[k]).map((k) => ({ nombre: infoProd[k].nombre, stock: stockDe[k], dueno: infoProd[k].dueno })).slice(0, 30) : null,
    quitados: Object.keys(quitK).map((k) => ({ nombre: (vistasK[k] && vistasK[k].nombre) || (infoProd[k] && infoProd[k].nombre) || k, veces: quitK[k] })).sort((a, b) => b.veces - a.veces).slice(0, 10),
    promos: { oferta: { veces: promos.oferta.veces, top: Object.entries(promos.oferta.productos).sort((a: any, b: any) => b[1] - a[1]).slice(0, 5).map(([nombre, n]) => ({ nombre, n })) }, pack: { veces: promos.pack.veces, top: Object.entries(promos.pack.productos).sort((a: any, b: any) => b[1] - a[1]).slice(0, 5).map(([nombre, n]) => ({ nombre, n })) } },
    compartidos: Object.entries(compartidos).sort((a: any, b: any) => b[1] - a[1]).slice(0, 10).map(([nombre, n]) => ({ nombre, n })),
    avisoClics: { veces: avisoClics.veces, personas: Object.keys(avisoClics.vids).length },
    scroll: scroll.n ? { n: scroll.n, promedio: Math.round(scroll.suma / scroll.n), alFinal: scroll.alFinal, pctAlFinal: Math.round(scroll.alFinal / scroll.n * 100) } : null,
  };
  // 🔗 Catálogos VIP: los que existen (config VIP_*) contra las aperturas registradas.
  const vipCatalogos: any[] = (opciones && opciones.vipCatalogos) || [];
  const vipTotales: any = (opciones && opciones.vipTotales) || {};
  // Las aperturas se registran desde el 22/09/2026 (v4.81): de un catálogo anterior no se puede
  // decir "nunca lo abrió" — a lo sumo "sin aperturas desde que se mide". Solo los posteriores son medibles.
  const VIP_DESDE = (opciones && opciones.vipDesde) || Date.UTC(2026, 8, 22);   // (las pruebas lo corren hacia atrás)
  const vipVistos: any = {};
  const vipAbiertos = vipCatalogos.map((c: any) => {
    const a = vipAp[c.token], tt = vipTotales[c.token]; vipVistos[c.token] = 1;
    const creadoTs = tsDeFecha(c.creado || '') || 0;
    return { token: c.token, cliente: c.nombre || '', canal: c.canal || '', creado: c.creado || '', creadoTs, medible: creadoTs >= VIP_DESDE,
      aperturas: a ? a.aperturas : 0, personas: a ? Object.keys(a.vids).length : 0, ultima: a ? a.ultima : '', ultimaTs: a ? a.ultimaTs : 0,
      aperturasTotal: tt ? tt.aperturas : (a ? a.aperturas : 0), ultimaTotal: tt ? tt.ultima : (a ? a.ultima : '') };
  }).concat(Object.keys(vipAp).filter((tk) => !vipVistos[tk]).map((tk) => ({ token: tk, cliente: '(link borrado)', canal: '', creado: '', creadoTs: 0, medible: false, aperturas: vipAp[tk].aperturas, personas: Object.keys(vipAp[tk].vids).length, ultima: vipAp[tk].ultima, ultimaTs: vipAp[tk].ultimaTs, aperturasTotal: vipAp[tk].aperturas, ultimaTotal: vipAp[tk].ultima })))
    .sort((a: any, b: any) => (b.ultimaTs - a.ultimaTs) || (b.creadoTs - a.creadoTs)).slice(0, 40);

  // ── 🔎 QUÉ BUSCAN (y qué buscan y NO encontrás) ────────────────────────────────
  const busquedas = Object.keys(busq).map((k) => {
    const b = busq[k];
    return { q: b.q, veces: b.veces, vacias: b.vacias, personas: Object.keys(b.vids).length };
  }).sort((a, b) => (b.vacias - a.vacias) || (b.veces - a.veces)).slice(0, 30);

  // ══════════════════════════════════════════════════════════════════════════════
  //  🎯 QUÉ HACER AHORA — el pedido de fondo: no más números lindos sin acción.
  //  Cada fila de acá es algo concreto para hacer hoy, con la gente ya identificada.
  // ══════════════════════════════════════════════════════════════════════════════
  const acciones: any[] = [];

  const plataDe = (arr: any[]) => {
    const ars = arr.reduce((t, a) => t + (a.total || 0), 0), usd = arr.reduce((t, a) => t + (a.totalUSD || 0), 0);
    return '$ ' + Math.round(ars).toLocaleString('es-AR') + (usd > 0 ? ' + U$S ' + (Math.round(usd * 100) / 100).toLocaleString('es-AR') : '');
  };
  const calientes = abandonados.filter((a) => a.horas <= 48);
  const contactables = calientes.filter((a) => a.telefono);
  if (calientes.length) acciones.push({
    id: 'carritos', icono: '🛒', urgencia: contactables.length ? 'alta' : 'media',
    titulo: calientes.length + (calientes.length === 1 ? ' carrito quedó' : ' carritos quedaron') + ' sin terminar en las últimas 48 h',
    detalle: (contactables.length ? '**' + contactables.length + '** con teléfono para escribirle ahora mismo' : 'ninguno dejó teléfono todavía')
      + ' · ' + plataDe(calientes) + ' sobre la mesa',
    n: calientes.length, ir: 'carritos',
  });

  const vuelvenSinComprar = visitantesTodos.filter((v) => v.esCliente && !v.pidio && v.visitas >= 1);
  if (vuelvenSinComprar.length) acciones.push({
    id: 'clientes-volvieron', icono: '👋', urgencia: 'alta',
    titulo: vuelvenSinComprar.length === 1 ? 'Un cliente tuyo entró y no compró nada' : vuelvenSinComprar.length + ' clientes tuyos entraron y no compraron nada',
    detalle: 'Ya te compraron antes: ' + vuelvenSinComprar.slice(0, 3).map((v) => v.nombre || 'sin nombre').filter(Boolean).join(', ')
      + (vuelvenSinComprar.length > 3 ? ' y ' + (vuelvenSinComprar.length - 3) + ' más' : '') + '. Un mensaje puede cerrar la venta.',
    n: vuelvenSinComprar.length, ir: 'visitantes',
  });

  const deseadoSinStock = deseoVsVenta.filter((p) => p.stock !== null && p.stock <= 0 && p.deseado >= 2);
  if (deseadoSinStock.length) acciones.push({
    id: 'sin-stock', icono: '📦', urgencia: 'alta',
    titulo: deseadoSinStock.length + (deseadoSinStock.length === 1 ? ' producto muy pedido está' : ' productos muy pedidos están') + ' en CERO',
    detalle: deseadoSinStock.slice(0, 3).map((p) => p.nombre + ' (' + p.deseado + ' veces)').join(' · ') + '. Lo quieren y no lo tenés.',
    n: deseadoSinStock.length, ir: 'deseo',
  });

  // 👁️ v4.81: mucha gente lo ve y nadie lo agarra → el freno es el precio o la foto.
  const venNoAgarran = verMas.vistosSinCarrito.filter((p: any) => p.personas >= 5 && p.stock !== null && p.stock > 0);
  if (venNoAgarran.length) acciones.push({
    id: 'ven-no-agarran', icono: '👁️', urgencia: 'media',
    titulo: venNoAgarran.length + (venNoAgarran.length === 1 ? ' producto lo ven muchos y nadie lo agarra' : ' productos los ven muchos y nadie los agarra'),
    detalle: venNoAgarran.slice(0, 3).map((p: any) => p.nombre + ' (' + p.personas + ' personas)').join(' · ') + '. Con stock. Mirá el precio o la foto: con ✨ la IA te propone una ficha mejor.',
    n: venNoAgarran.length, ir: 'deseo',
  });
  // 🔗 v4.81: catálogo VIP mandado hace más de 2 días y nunca abierto.
  const vipSinAbrir = vipAbiertos.filter((c: any) => c.medible && !c.aperturasTotal && c.creadoTs && (nowT - c.creadoTs) > 2 * 86400000 && (nowT - c.creadoTs) < 30 * 86400000);
  if (vipSinAbrir.length) acciones.push({
    id: 'vip-sin-abrir', icono: '🔗', urgencia: 'media',
    titulo: vipSinAbrir.length + (vipSinAbrir.length === 1 ? ' catálogo VIP nunca se abrió' : ' catálogos VIP nunca se abrieron'),
    detalle: vipSinAbrir.slice(0, 3).map((c: any) => c.cliente + ' (mandado el ' + String(c.creado).slice(0, 10) + ')').join(' · ') + '. Un recordatorio por WhatsApp cuesta nada.',
    n: vipSinAbrir.length, ir: 'visitantes',
  });

  // 🔔 v4.86: personas en lista de espera de productos que YA volvieron (nadie les avisó todavía).
  const volvieron = productosQueVolvieron((opciones && opciones.esperando) || [], productos);
  if (volvieron.length) {
    const nEsp = volvieron.reduce((t: number, g: any) => t + g.esperan, 0);
    acciones.push({
      id: 'esperan-stock', icono: '🔔', urgencia: 'alta',
      titulo: nEsp + (nEsp === 1 ? ' persona espera un producto que ya volvió' : ' personas esperan productos que ya volvieron'),
      detalle: volvieron.slice(0, 3).map((g: any) => g.nombre + ' (' + g.esperan + ')').join(' · ') + '. Avisales desde **Stock → Lista de espera**: el mensaje ya está armado.',
      n: nEsp, ir: '',
    });
  }

  const vacias = busquedas.filter((b) => b.vacias > 0);
  if (vacias.length) acciones.push({
    id: 'busquedas-vacias', icono: '🔎', urgencia: 'media',
    titulo: vacias.length + (vacias.length === 1 ? ' búsqueda no encontró' : ' búsquedas no encontraron') + ' nada',
    detalle: 'Te lo buscaron y no estaba: ' + vacias.slice(0, 4).map((b) => '"' + b.q + '"').join(', ') + '. Son pedidos de compra gratis.',
    n: vacias.length, ir: 'busquedas',
  });

  const insistentes = visitantesTodos.filter((v) => !v.pidio && !v.esCliente && v.dias >= 3);
  if (insistentes.length) acciones.push({
    id: 'insistentes', icono: '👀', urgencia: 'media',
    titulo: insistentes.length === 1 ? 'Una persona volvió 3 días o más y nunca compró' : insistentes.length + ' personas volvieron 3 días o más y nunca compraron',
    detalle: 'Están interesados pero algo los frena: precio, envío o que no encuentran lo que buscan.',
    n: insistentes.length, ir: 'visitantes',
  });

  const casi = visitantesTodos.filter((v) => v.checkout && !v.pidio);
  if (casi.length) acciones.push({
    id: 'casi', icono: '🔥', urgencia: 'alta',
    titulo: casi.length === 1 ? 'Una persona llegó hasta el final y no envió el pedido' : casi.length + ' personas llegaron hasta el final y no enviaron el pedido',
    detalle: 'Abrieron el checkout y se cayeron ahí. Es la etapa más cara de perder.',
    n: casi.length, ir: 'carritos',
  });

  if (comparativa && comparativa.visitas.delta <= -20) acciones.push({
    id: 'caida', icono: '📉', urgencia: 'media',
    titulo: 'El tráfico cayó ' + Math.abs(comparativa.visitas.delta) + '% contra el período anterior',
    detalle: 'Pasaste de ' + comparativa.visitas.anterior + ' a ' + comparativa.visitas.actual + ' visitas. ¿Mandaste menos difusiones?',
    n: 0, ir: '',
  });
  if (comparativa && comparativa.visitas.delta >= 25) acciones.push({
    id: 'suba', icono: '📈', urgencia: 'baja',
    titulo: 'El tráfico subió ' + comparativa.visitas.delta + '% contra el período anterior',
    detalle: 'De ' + comparativa.visitas.anterior + ' a ' + comparativa.visitas.actual + ' visitas. Momento de tener stock de lo más pedido.',
    n: 0, ir: '',
  });

  const orden: any = { alta: 0, media: 1, baja: 2 };
  acciones.sort((a, b) => orden[a.urgencia] - orden[b.urgencia]);

  // ══════════════════════════════════════════════════════════════════════════════
  //  🔬 HERRAMIENTAS PARA ENTENDER AL MIRÓN (v4.71)
  //  Tres preguntas que el negocio no podía contestar: ¿cuánto tarda alguien en decidirse?,
  //  ¿qué se lleva junto?, y ¿en qué se diferencia el que compra del que solo mira?
  // ══════════════════════════════════════════════════════════════════════════════

  // ⏱️ CUÁNTO TARDAN EN DECIDIRSE: de la primera visita al pedido. Dice si el negocio es de
  // impulso (compran el mismo día) o de maduración (hay que insistir un par de días).
  const demoras: number[] = [];
  visitantesTodos.forEach((v) => { if (v.pidio) demoras.push(Math.max(0, Math.round((v.ultimaTs - v.primeraTs) / 86400000))); });
  demoras.sort((a, b) => a - b);
  const tiempoADecidir = demoras.length ? {
    n: demoras.length,
    mismoDia: demoras.filter((d) => d === 0).length,
    hasta3: demoras.filter((d) => d > 0 && d <= 3).length,
    masDe3: demoras.filter((d) => d > 3).length,
    mediana: demoras[Math.floor(demoras.length / 2)],
    promedio: Math.round(demoras.reduce((a, b) => a + b, 0) / demoras.length * 10) / 10,
  } : null;

  // 🧺 QUÉ SE LLEVA JUNTO: pares de productos que aparecen en el mismo carrito. Materia prima
  // para armar packs y para sugerir "llevá también…".
  const pares: any = {};
  Object.keys(carritosPorVid).forEach((v) => {
    const items = (carritosPorVid[v].items || []).map((it: any) => String(it.n || '')).filter(Boolean);
    const unicos = [...new Set(items)].sort();
    for (let i = 0; i < unicos.length; i++) for (let j = i + 1; j < unicos.length; j++) {
      const k = unicos[i] + ' ⊕ ' + unicos[j];
      pares[k] = (pares[k] || 0) + 1;
    }
  });
  const juntos = Object.entries(pares).filter((x: any) => x[1] >= 2)
    .sort((a: any, b: any) => b[1] - a[1]).slice(0, 15)
    .map(([k, n]) => ({ a: k.split(' ⊕ ')[0], b: k.split(' ⊕ ')[1], n }));

  // 🆚 EL MIRÓN CONTRA EL COMPRADOR: en qué se diferencian de verdad. Sirve para saber dónde
  // apretar (si el mirón viene de un canal, entra a una hora o usa un aparato distinto).
  const perfilDe = (arr: any[]) => {
    const og: any = {}, disp: any = {};
    let visitas = 0, prods = 0;
    arr.forEach((v) => {
      og[v.origen || 'directo'] = (og[v.origen || 'directo'] || 0) + 1;
      if (v.dispositivo) disp[v.dispositivo] = (disp[v.dispositivo] || 0) + 1;
      visitas += v.visitas; prods += (v.productos || []).length;
    });
    const top = (o: any) => { const e = Object.entries(o).sort((a: any, b: any) => b[1] - a[1])[0]; return e ? { que: e[0], n: e[1], pct: Math.round(Number(e[1]) / Math.max(1, arr.length) * 100) } : null; };
    return { n: arr.length, visitasProm: arr.length ? Math.round(visitas / arr.length * 10) / 10 : 0, productosProm: arr.length ? Math.round(prods / arr.length * 10) / 10 : 0, canal: top(og), aparato: top(disp) };
  };
  const compradores = visitantesTodos.filter((v) => v.pidio);
  const mirones = visitantesTodos.filter((v) => !v.pidio && !v.armoCarrito && !v.checkout);
  const casiCompran = visitantesTodos.filter((v) => !v.pidio && (v.armoCarrito || v.checkout));
  const comparativo = { compradores: perfilDe(compradores), mirones: perfilDe(mirones), casiCompran: perfilDe(casiCompran) };

  // 🎣 LOS MIRONES QUE MÁS VALE LA PENA TENTAR: los que más volvieron sin comprar nunca.
  const mironesTop = visitantesTodos
    .filter((v) => !v.pidio && v.dias >= 2)
    .sort((a, b) => (b.dias - a.dias) || (b.visitas - a.visitas))
    .slice(0, 40)
    .map((v) => ({ vid: v.vid, nombre: v.nombre, telefono: v.telefono, esCliente: v.esCliente, visitas: v.visitas, dias: v.dias, ultima: v.ultima, ciudad: v.ciudad, origen: v.origen, dispositivo: v.dispositivo, productos: v.productos.slice(0, 5), armoCarrito: v.armoCarrito, checkout: v.checkout, valorCarrito: v.valorCarrito, apodo: v.apodo, leDijiste: v.leDijiste, nota: v.nota, perfil: v.perfil }));

  // ── 🛒 ¿SIRVE EL RESCATE DEL CARRITO? ──────────────────────────────────────────
  const ofr = Object.keys(resc.ofrecidos), ret = Object.keys(resc.retomados);
  const retomaronYCompraron = ret.filter((v) => embudoVids.pedido[v]).length;
  const rescate = ofr.length || ret.length ? {
    ofrecidos: ofr.length,
    retomados: ret.length,
    descartados: Object.keys(resc.descartados).length,
    compraron: retomaronYCompraron,
    pctRetoma: ofr.length ? Math.round(ret.length / ofr.length * 100) : 0,
    pctCompra: ret.length ? Math.round(retomaronYCompraron / ret.length * 100) : 0,
  } : null;

  // 🔁 ¿SIRVE "LO DE SIEMPRE"? (v4.86) Igual que el rescate: a cuántos se les ofreció, cuántos lo
  // cargaron y cuántos de ésos terminaron pidiendo.
  const rOfr = Object.keys(recom.ofrecidos), rCar = Object.keys(recom.cargados);
  const recompra = rOfr.length || rCar.length ? {
    ofrecidos: rOfr.length, cargados: rCar.length, descartados: Object.keys(recom.descartados).length,
    compraron: rCar.filter((v) => embudoVids.pedido[v]).length,
  } : null;

  // 🔥 ¿VENDEN LA VIDRIERA Y LOS SABORES? (v4.87) Cuánto se sumó al carrito desde cada lugar y
  // cuántas de esas personas terminaron pidiendo.
  const vFila = Object.keys(vidr.fila), vSabO = Object.keys(vidr.sabOfr), vSabS = Object.keys(vidr.sabSum), vFie = Object.keys(vidr.fiesta);
  const vSumaron = Array.from(new Set(vFila.concat(vSabS, vFie)));
  const vEnv = Object.keys(vidr.envio);
  const vidriera = vidr.filaN || vSabO.length || vidr.sabN || vidr.fiestaN || vEnv.length ? {
    envio: { alcanzaron: vEnv.length, compraron: vEnv.filter((v) => embudoVids.pedido[v]).length },
    fila: { sumados: vidr.filaN, personas: vFila.length },
    fiesta: { sumados: vidr.fiestaN, personas: vFie.length },
    sabores: { ofrecidos: vSabO.length, sumados: vidr.sabN, personas: vSabS.length },
    compraron: vSumaron.filter((v) => embudoVids.pedido[v]).length,   // de los que sumaron algo desde ahí, cuántos pidieron
  } : null;

  // 🤖 Cuántos de los que figuran como visitantes no parecen personas. Se informa, no se
  // borra: los números de arriba siguen siendo los reales, con esto se sabe cuánto descontar.
  const robots = visitantesTodos.filter((v) => v.perfil.pareceRobot);
  const conFicha = visitantesTodos.filter((v) => v.perfil.tz);
  const promSeg = (() => { const c = visitantesTodos.filter((v) => v.perfil.segundos > 0); return c.length ? Math.round(c.reduce((t, v) => t + v.perfil.segundos, 0) / c.length) : 0; })();
  const dondeEstan: any = {};
  visitantesTodos.forEach((v) => { if (v.perfil.dondeEsta) dondeEstan[v.perfil.dondeEsta] = (dondeEstan[v.perfil.dondeEsta] || 0) + 1; });
  const idiomas: any = {};
  visitantesTodos.forEach((v) => { if (v.perfil.idioma) idiomas[v.perfil.idioma] = (idiomas[v.perfil.idioma] || 0) + 1; });
  const aparatos: any = {};
  visitantesTodos.forEach((v) => { if (v.perfil.aparato) aparatos[v.perfil.aparato] = (aparatos[v.perfil.aparato] || 0) + 1; });
  const radiografia = {
    conFicha: conFicha.length, sinFicha: visitantesTodos.length - conFicha.length,
    robots: robots.length,
    segundosPromedio: promSeg,
    aceptanAvisos: visitantesTodos.filter((v) => v.perfil.aceptaAvisos).length,
    appInstalada: visitantesTodos.filter((v) => v.perfil.appInstalada).length,
    dondeEstan: Object.entries(dondeEstan).sort((a: any, b: any) => b[1] - a[1]).slice(0, 8).map(([que, n]) => ({ que, n })),
    idiomas: Object.entries(idiomas).sort((a: any, b: any) => b[1] - a[1]).map(([que, n]) => ({ que, n })),
    aparatos: Object.entries(aparatos).sort((a: any, b: any) => b[1] - a[1]).map(([que, n]) => ({ que, n })),
    robotsDetalle: robots.slice(0, 10).map((v) => ({ pais: v.pais, ciudad: v.ciudad, ultima: v.ultima, señales: v.perfil.señales, aparato: v.perfil.aparato })),
  };

  // ── 🌎 EL CANDADO GEOGRÁFICO, a la vista ───────────────────────────────────────
  // Dos preguntas que antes no se podían contestar: ¿a cuánta gente estoy rechazando?
  // y ¿cómo entró alguien de afuera si el candado está prendido?
  const deAfuera = visitantesTodos.filter((v) => v.pais && !['Argentina', 'Uruguay', 'Brazil', 'Brasil', 'Paraguay', 'Bolivia', 'Chile'].includes(v.pais));
  // 🕐 QUÉ HORA ERA PARA ÉL. Las fechas se guardan en hora de Buenos Aires; alguien que entra
  // a una tienda de golosinas a las 3 de la mañana de SU país no es una persona, es un programa.
  // Es el dato que separa al cliente de viaje del robot de escaneo, y no requiere nada nuevo.
  const HUSO: Record<string, string> = {
    'Israel': 'Asia/Jerusalem', 'United States': 'America/New_York', 'Mexico': 'America/Mexico_City',
    'Spain': 'Europe/Madrid', 'The Netherlands': 'Europe/Amsterdam', 'France': 'Europe/Paris',
    'Germany': 'Europe/Berlin', 'United Kingdom': 'Europe/London', 'Italy': 'Europe/Rome',
    'Canada': 'America/Toronto', 'Panama': 'America/Panama', 'Peru': 'America/Lima', 'Colombia': 'America/Bogota',
  };
  const horaAlla = (fechaAR: string, pais: string, tzReal: string) => {
    const m = (fechaAR || '').match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/);
    const tz = tzReal || HUSO[pais];
    if (!m || !tz) return '';
    try {
      const utc = Date.UTC(+m[3], +m[2] - 1, +m[1], +m[4] + 3, +m[5]);   // Buenos Aires es UTC−3
      return new Intl.DateTimeFormat('es-AR', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(utc));
    } catch { return ''; }
  };
  const candado = {
    bloqueados: bloqueos.total,
    bloqueadosPorPais: Object.entries(bloqueos.porPais).sort((a: any, b: any) => b[1] - a[1]).map(([pais, n]) => ({ pais, n })),
    ultimoBloqueo: bloqueos.ultimo,
    entraronDeAfuera: deAfuera.length,
    deAfueraDetalle: deAfuera.slice(0, 15).map((v) => ({
      pais: v.pais, ciudad: v.ciudad, visitas: v.visitas, ultima: v.ultima, etiqueta: v.etiqueta, nombre: v.nombre,
      vid: v.vid, aparato: v.perfil.aparato || v.dispositivo || '', origen: v.origen,
      horaAlla: horaAlla(v.ultima, v.pais, v.perfil.tz), pareceRobot: v.perfil.pareceRobot,
      dondeEsta: v.perfil.dondeEsta, conPase: v.perfil.conPase, segundos: v.perfil.segundos,
    })),
    discrepancias: discrepancias.slice(-15).reverse(),
  };

  // ── Números que resumen lo accionable (para la cabecera de la pantalla) ─────────
  const identificados = visitantesTodos.filter((v) => v.nombre).length;
  const conTelefono = visitantesTodos.filter((v) => v.telefono).length;
  const accionable = {
    identificados, conTelefono, anonimos: visitantesTodos.length - identificados,
    oportunidadARS: Math.round(abandonados.reduce((t, a) => t + (a.total || 0), 0)),
    oportunidadUSD: Math.round(abandonados.reduce((t, a) => t + (a.totalUSD || 0), 0) * 100) / 100,
    tcRef,
    carritosContactables: abandonados.filter((a) => a.telefono).length,
    clientesQueVolvieron: vuelvenSinComprar.length,
  };

  return {
    resumen, porOrigen, porDispositivo, topCiudades, topPaises, porHora, porDiaSemana, dias30,
    embudo, leads, abandonados, topProductos, conversionPorOrigen, comparativa,
    // 🆕 la vuelta de rosca
    acciones, accionable, visitantes, visitantesTotal: visitantesTodos.length,
    diasDetalle, deseoVsVenta, busquedas, candado,
    tiempoADecidir, juntos, comparativo, mironesTop, rescate, radiografia,
    hoyVsSemana: hoyVsSemana(todas),   // 🔴 v4.79
    excluidos, soloHoy,                 // 🧹 v4.80
    verMas, vipAbiertos,                // 👁️ v4.81
    heatmap, cohortes, proyeccion, dormidos,   // 🧠 v4.83
    recompra, encuesta,                 // 🔁 v4.86
    vidriera,                           // 🔥 v4.87
  };
}

// ── Infra ───────────────────────────────────────────────────────────────────────
// 🔐 v4.92 · SOLO LAS CUENTAS DEL EQUIPO. El login de Supabase traía de fábrica la inscripción
// abierta y el motor dejaba pasar a CUALQUIER usuario con sesión válida. Además de cerrar la
// inscripción (23/09), el motor acepta solo estas cuentas: una cuenta nueva, aunque alguien la
// lograra crear, no puede pedir nada. Sumar una cuenta = agregarla acá.
// 🔒 v4.96: Miri ya NO es del equipo (pedido del dueño 23/09: «que MYRI no tenga acceso a NADA»; su cuenta está bloqueada).
const MAILS_EQUIPO = ['admin@shukmamtakim.com', 'kids@candyshop.com'];
async function sesionValida(token: string): Promise<boolean> {
  return !!(await usuarioSesion(token));
}
// ── IDENTIDAD (v4.49) ───────────────────────────────────────────────────────────
// sesionValida() solo contesta "¿es un usuario válido?" — nunca CUÁL. Con eso, el token
// de Miri pasaba todos los controles y la regla sagrada de privacidad quedaba sostenida
// únicamente por el front (que no dibuja las cosas). Para el historial de compras, que
// trae proveedores y costos reales de Jony, eso no alcanza: la barrera va en el servidor.
const MAIL_JONY = 'admin@shukmamtakim.com';
type Usuario = { email: string; id: string };
async function usuarioSesion(token: string): Promise<Usuario | null> {
  if (!token) return null;
  try {
    const r = await fetch(SB_URL + '/auth/v1/user', { headers: { Authorization: 'Bearer ' + token, apikey: ANON } });
    if (!r.ok) return null;
    const u = await r.json();
    const email = String(u?.email || '').trim().toLowerCase();
    if (!MAILS_EQUIPO.includes(email)) return null;   // 🔐 v4.92: una sesión válida de alguien de afuera no alcanza
    return { email, id: String(u?.id || '') };
  } catch { return null; }
}
const esJony = (u: Usuario | null) => !!u && u.email === MAIL_JONY;
// 🎚️ INTERRUPTOR (v4.52): el mail de Miri identifica a quién le corta el paso el interruptor
// de acceso (config ACCESO_MIRI, lo maneja Jony desde el panel). Ver portero del dispatcher.
const MAIL_MIRI = 'myri@shukmamtakim.com';
const MAIL_KIDS = 'kids@candyshop.com';
// Las 62 acciones que usa el panel de los chicos (sacadas de candyshop.html el 23/09). Una acción nueva del panel Candy
// tiene que sumarse ACÁ (si no, al chico le aparece "no disponible para esta cuenta").
const ACCIONES_KIDS = [
    'agregarProductoHijo', 'agregarProveedorHijos', 'ajustarDepositoManual', 'analiticaCandy', 'analizarFotoProducto',
    'archivarFlyer', 'auditarHijos', 'bloquearVidCandy', 'borradosCandy', 'cancelarPedidoHijo', 'cerrarDiaHijos',
    'cobrarPedidoHijo', 'comprasTabHijos', 'consultarDeudores', 'editarPedidoHijo', 'editarProductoHijo',
    'editarProductosLoteHijos', 'editarProveedorHijos', 'editarVentaHijos', 'eliminarCompraHijos', 'eliminarFlyer',
    'eliminarProductoHijo', 'eliminarProveedorHijos', 'eliminarVentaHijos', 'enviarFlyerWA', 'firmarSubida', 'flyerTexto', 'fondoFlyer',
    'getAvisosCandy', 'getCatalogoHijos', 'getComprasHijos', 'getConfigCandy', 'getConsumoPeriodo', 'getDepositoHijos',
    'getFlyersHijos', 'getProductosShukAdmin', 'getProveedoresHijos', 'getShukEnCandy', 'getStockDia', 'getUltimoStockDia',
    'guardarFlyer', 'historialCliente', 'movsDeposito', 'panelHijos', 'registrarCompraHijos', 'registrarConsumoHijos',
    'registrarPagoCliente', 'registrarPagoVuelto', 'registrarVentaHijos', 'registrarVentaLote', 'registrarVueltoCC',
    'renombrarCategoriaHijos', 'resetearStockDia', 'resolverAvisoCandy', 'setCategoriaHijosLote', 'setConfigCandy',
    'setFotoHijo', 'setPrecioShukEnCandy', 'setStockDia', 'toggleShukEnCandy', 'transcribirIdea', 'ventasHoy', 'ventasPeriodo'
];
// ── EAN (v4.50) ─────────────────────────────────────────────────────────────────
// Deja el código comparable: solo dígitos, y el UPC-A de 12 se lleva a EAN-13 con el 0
// de adelante (si no, el mismo producto no matchea entre un ticket y un escaneo).
// Misma normalización que usa Costos Israel, para que los dos lados coincidan.
// ⚠️ El EAN NO decide: SUGIERE. Puede repetirse entre gemelos (mismo producto de dos
//    dueños), y la regla del proyecto es que la plata y el stock se resuelven por ID.
function normEAN(v: any): string {
  const d = String(v == null ? '' : v).replace(/\D/g, '');
  if (!d) return '';
  return d.length === 12 ? '0' + d : d.slice(0, 14);
}
// ⚠️ EL TOPE DE LAS 1000 FILAS (bug cazado el 26/08/2026).
// PostgREST corta TODA respuesta en `db.max_rows` (1000 en este proyecto) y NO avisa: un
// `limit=200000` no trae 200.000 filas, trae las PRIMERAS 1000 y calla la boca. Consecuencias
// reales: la Analítica leía las 1000 filas más VIEJAS de `trafico` (junio/julio) y al filtrar
// "últimos 7 días" daba todo en cero — el panel parecía muerto desde mediados de julio; y el
// backup diario guardaba cada tabla grande a medias. Por eso sbGet ahora trae página por
// página hasta agotar de verdad lo pedido.
const SB_MAX_FILAS = 1000;
async function sbPagina(tabla: string, query: string) {
  const r = await fetch(SB_URL + '/rest/v1/' + tabla + '?' + query, { headers: { apikey: SERVICE, Authorization: 'Bearer ' + SERVICE } });
  if (!r.ok) throw new Error(tabla + ' ' + r.status);
  return r.json();
}
async function sbGet(tabla: string, query: string) {
  const p = new URLSearchParams(query);
  const tope = parseInt(p.get('limit') || '0') || 0;            // 0 = "todo lo que haya"
  // Una sola página alcanza (o el llamador ya pidió con offset propio) → derecho viejo.
  if ((tope && tope <= SB_MAX_FILAS) || p.get('offset')) return sbPagina(tabla, query);
  p.set('limit', String(SB_MAX_FILAS));
  let primera = await sbPagina(tabla, p.toString());
  if (!Array.isArray(primera) || primera.length < SB_MAX_FILAS) return primera;
  // Vino llena ⇒ hay más atrás del tope. Para que las páginas no se pisen ni saltee filas
  // hace falta un orden estable: si la consulta no lo trae y las filas tienen `id`, ordenamos
  // por id (y repetimos la primera página, ahora sí ordenada).
  if (!p.get('order') && primera[0] && primera[0].id !== undefined) {
    p.set('order', 'id.asc');
    primera = await sbPagina(tabla, p.toString());
  }
  const todas = primera.slice();
  const limite = tope || Infinity;
  for (let off = SB_MAX_FILAS; todas.length < limite; off += SB_MAX_FILAS) {
    p.set('offset', String(off));
    const pag = await sbPagina(tabla, p.toString());
    if (!Array.isArray(pag) || !pag.length) break;
    for (const fila of pag) todas.push(fila);
    if (pag.length < SB_MAX_FILAS) break;
    if (off >= 500000) break;                                   // cinturón: jamás un loop infinito
  }
  return tope ? todas.slice(0, tope) : todas;
}
async function sbInsert(tabla: string, fila: any) {
  const r = await fetch(SB_URL + '/rest/v1/' + tabla, { method: 'POST', headers: { apikey: SERVICE, Authorization: 'Bearer ' + SERVICE, 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify(fila) });
  if (!r.ok) throw new Error('insert ' + tabla + ' ' + r.status + ' ' + (await r.text()).slice(0, 150));
}
async function sbPatch(tabla: string, filtro: string, patch: any) {
  const r = await fetch(SB_URL + '/rest/v1/' + tabla + '?' + filtro, { method: 'PATCH', headers: { apikey: SERVICE, Authorization: 'Bearer ' + SERVICE, 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify(patch) });
  if (!r.ok) throw new Error('patch ' + tabla + ' ' + r.status + ' ' + (await r.text()).slice(0, 150));
}
async function sbDelete(tabla: string, filtro: string) {
  await fetch(SB_URL + '/rest/v1/' + tabla + '?' + filtro, { method: 'DELETE', headers: { apikey: SERVICE, Authorization: 'Bearer ' + SERVICE, Prefer: 'return=minimal' } });
}
// Llama a una función de la base (solo el motor puede: la tienda tiene prohibido ejecutarlas).
async function sbRpc(fn: string, args: any) {
  const r = await fetch(SB_URL + '/rest/v1/rpc/' + fn, { method: 'POST', headers: { apikey: SERVICE, Authorization: 'Bearer ' + SERVICE, 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
  if (!r.ok) throw new Error('rpc ' + fn + ' ' + r.status + ' ' + (await r.text()).slice(0, 150));
  return r.json();
}
const boolHijo = (v: any) => v === true || v === 1 || v === '1' || v === 'true' || v === 'on';
// Foto de un producto de Shuk → URL completa de Cloudinary (portado de _fotoShukUrl).
function fotoShukUrl(val: string) {
  if (!val) return '';
  if (/^https?:\/\//i.test(val)) return val;                       // ya es URL completa
  const base = 'https://res.cloudinary.com/dq2boloyp/image/upload';
  if (val.indexOf('/') !== -1 && !/\.(jpg|jpeg|png|gif|webp)$/i.test(val)) return base + '/' + val;  // public_id con folder
  return base + '/shuk-mamtakim/' + val;                           // sin folder → asumir shuk-mamtakim
}
// Primera foto no vacía del campo imagen (lista separada por coma).
const primeraFoto = (imagen: any) => ((imagen || '').toString().split(',').map((x: string) => x.trim()).filter(Boolean)[0]) || '';
// Todas las FOTOS (sin videos) del campo imagen, como URLs completas — para el carrusel de la tienda Candy.
const fotosShukLista = (imagen: any) => ((imagen || '').toString().split(',').map((x: string) => x.trim()).filter(Boolean)
  .filter((x: string) => !/\.(mp4|webm|mov)(\?|$)/i.test(x) && x.indexOf('/video/') === -1).slice(0, 5).map(fotoShukUrl));
async function getConfig(clave: string, def: string) { const r = await sbGet('config', 'select=valor&clave=eq.' + encodeURIComponent(clave)); return r.length ? (r[0].valor ?? def) : def; }
// ── 📣 AVISO DE LA TIENDA (v4.53): normalización con LISTA BLANCA ───────────────
// Todo campo enumerado cae a su default si viene fuera de lista. El front usa estos
// valores como sufijo de clase CSS: si acá pasara basura, se podría inyectar CSS en
// la tienda. Por eso la puerta está de este lado, no solo en el navegador.
const AV_L: Record<string, string[]> = {
  estilo: ['plano', 'neon'],
  color:  ['verde', 'dorado', 'rojo', 'azul'],
  neon:   ['rosa', 'cyan', 'lima', 'ambar'],
  anim:   ['ninguna', 'clasico', 'respiracion', 'arranque', 'marquesina'],
  tam:    ['S', 'M', 'L'],
  modo:   ['ambos', 'mayorista', 'minorista'],
};
const avUno = (v: any, campo: string, def: string) => (AV_L[campo].indexOf(String(v ?? '')) !== -1 ? String(v) : def);
function avNorm(raw: any) {
  const c = (raw && typeof raw === 'object') ? raw : {};
  return {
    // Saca invisibles (zero-width/blando) que se pegan desde WhatsApp: sin esto un aviso
    // "vacío" de puros invisibles publicaba un cartel de neón negro sin texto.
    txt: String(c.txt ?? '').replace(/[​-‍﻿­]/g, '').replace(/\s+/g, ' ').trim().slice(0, 220),
    estilo: avUno(c.estilo, 'estilo', 'plano'),
    color:  avUno(c.color,  'color',  'verde'),
    neon:   avUno(c.neon,   'neon',   'rosa'),
    anim:   avUno(c.anim,   'anim',   'respiracion'),
    tam:    avUno(c.tam,    'tam',    'M'),
    modo:   avUno(c.modo,   'modo',   'ambos'),
    // SIEMPRE ISO yyyy-MM-dd, que se compara como string y ordena solo. (El campo
    // fecha_oferta tiene hoy dos formatos conviviendo y uno nunca vence: no se repite.)
    hasta: /^\d{4}-\d{2}-\d{2}$/.test(String(c.hasta ?? '')) ? String(c.hasta) : '',
  };
}
async function setConfig(clave: string, valor: string) {
  await fetch(SB_URL + '/rest/v1/config?on_conflict=clave', { method: 'POST', headers: { apikey: SERVICE, Authorization: 'Bearer ' + SERVICE, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ clave, valor }) });
}
// Fecha 'dd/MM/yyyy HH:mm' en zona Argentina (igual formato que el motor viejo).
const _cacheAna = new Map<string, { t: number; data: any }>();   // ⚡ v4.83
// La Analítica completa para un período: la usa la pantalla (getAnalitica) y el cron (avisos e informe).
async function calcularAnalitica(dias: number, soloHoy = false) {
  // La analítica ya no mira solo el tráfico: lo cruza con las ventas (para saber QUIÉN es
  // cada visitante), con los clientes (para el teléfono) y con los productos (stock real).
  const [trA, vtA, clA, prA] = await Promise.all([
    traficoParaAnalitica(dias),
    sbGet('ventas', 'select=id,fecha,cliente,estado,total_ars,total_usd,vid,stock_updates,tipo_cambio&order=n_venta'),
    sbGet('clientes', 'select=nombre,telefono,tipo'),
    sbGet('productos', 'select=id,nombre,stock,activo,dueno,moneda'),
  ]);
  // 🏷️ Los nombres que Jony le puso a mano a visitantes que no se identificaron.
  const [aliasRows, vipRows, esperando] = await Promise.all([
    sbGet('config', 'select=clave,valor&clave=like.vid_alias:*'),
    sbGet('config', 'select=clave,valor&clave=like.VIP_*'),   // 🔗 v4.81
    sbGet('notificaciones', 'select=producto_id,producto,estado&estado=eq.pendiente'),   // 🔔 v4.86
  ]);
  // 🔗 Las aperturas VIP de toda la historia (no solo del período): "nunca lo abrió" tiene que
  // mirar todo. Son pocas filas: solo visitas que traen "vip" en la ficha técnica (desde v4.81).
  const vipVisitas = await sbGet('trafico', 'select=detalle,fecha,vid&evento=eq.visita&detalle=like.' + encodeURIComponent('*"vip":"*') + '&order=id.asc');
  const vipTotales: any = {};
  vipVisitas.forEach((r: any) => {
    try { const fv = JSON.parse(String(r.detalle || '')); if (!fv.vip) return; const T = vipTotales[fv.vip] = vipTotales[fv.vip] || { aperturas: 0, vids: {}, ultima: '', ultimaTs: 0 }; T.aperturas++; if (r.vid) T.vids[r.vid] = 1; const ts = tsDeFecha(String(r.fecha || '')) || 0; if (ts >= T.ultimaTs) { T.ultimaTs = ts; T.ultima = String(r.fecha || ''); } } catch { /**/ }
  });
  const vipCatalogos = vipRows.map((r: any) => { try { const d = JSON.parse(r.valor || '{}'); return { token: String(r.clave || '').slice(4), nombre: d.nombre || '', canal: d.canal || 'minorista', creado: d.creado || '' }; } catch { return null; } }).filter(Boolean);
  const aliasMap: any = {};
  aliasRows.forEach((r: any) => {
    const vidA = String(r.clave || '').slice('vid_alias:'.length);
    if (!vidA) return;
    try { aliasMap[vidA] = JSON.parse(r.valor || '{}'); } catch { aliasMap[vidA] = { alias: String(r.valor || '') }; }
  });
  return analitica(trA, dias, vtA, clA, prA, aliasMap, { soloHoy, vipCatalogos, vipTotales, esperando });
}

// ══════════════════════════════════════════════════════════════════════════════
//  🔔 AVISOS AL CELULAR DE JONY (v4.82) — que la Analítica avise sola.
//  Van por OneSignal SOLO a los aparatos con la etiqueta rol=jony (el panel la pone al entrar).
//  NUNCA a "All": hay clientes suscriptos a las novedades de la tienda y no tienen por qué ver esto.
// ══════════════════════════════════════════════════════════════════════════════
const ALERTAS_DEF: any = { checkout: 1, conocido: 1, busqueda: 1, pico: 1, carrito: 1, carritoMin: 20000, picoMin: 15, informe: 1, rareza: 1, avisame: 1, tetoca: 1 };
async function alertasCfg() {
  try { return { ...ALERTAS_DEF, ...JSON.parse(await getConfig('ALERTAS_PUSH', '{}')) }; } catch { return { ...ALERTAS_DEF }; }
}
async function pushJony(titulo: string, mensaje: string) {
  try {
    const r = await fetch('https://api.onesignal.com/notifications', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Key ' + osKey() },
      body: JSON.stringify({ app_id: OS_APP_ID, filters: [{ field: 'tag', key: 'rol', relation: '=', value: 'jony' }], headings: { es: titulo, en: titulo }, contents: { es: mensaje, en: mensaje }, url: SITIO_PUSH + '#adm-wR7j4' }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || d.errors) return { ok: false, error: Array.isArray(d.errors) ? d.errors.join(' · ') : JSON.stringify(d.errors || ('HTTP ' + r.status)) };
    return { ok: true, id: d.id || '', destinatarios: d.recipients != null ? d.recipients : null };
  } catch (e) { return { ok: false, error: String((e as Error).message || e) }; }
}
// Para no repetir el mismo aviso: clave + horas de silencio (config PUSHDEDUP_*, se limpian en el cron).
async function avisoReciente(clave: string, horas: number) {
  const k = 'PUSHDEDUP_' + clave.replace(/[^a-z0-9_:.-]/gi, '').slice(0, 80);
  const v = parseInt(await getConfig(k, '0')) || 0;
  if (v && Date.now() - v < horas * 3600000) return true;
  await setConfig(k, String(Date.now()));
  return false;
}
const plataCorta = (ars: number, usd: number) => '$ ' + Math.round(ars || 0).toLocaleString('es-AR') + (usd > 0 ? ' + U$S ' + (Math.round(usd * 100) / 100).toLocaleString('es-AR') : '');
function itemsCortos(carritoJson: string) {
  try { const arr = JSON.parse(carritoJson || '[]'); if (!Array.isArray(arr) || !arr.length) return ''; return arr.slice(0, 3).map((it: any) => it.q + '× ' + String(it.n || '').slice(0, 28)).join(' · ') + (arr.length > 3 ? ' · +' + (arr.length - 3) : ''); } catch { return ''; }
}
// Quién es un visitante, para nombrarlo en un aviso: lo que dejó, lo que compró desde ese aparato, o el nombre que le puso Jony.
async function quienEsVid(vid: string, nombreEv: string) {
  if (nombreEv) return { nombre: nombreEv, como: 'se registró' };
  if (!vid) return { nombre: '', como: '' };
  const v = await sbGet('ventas', 'select=cliente,estado&vid=eq.' + encodeURIComponent(vid) + '&order=n_venta.desc&limit=3');
  const c = v.find((x: any) => (x.estado || '') !== 'cancelado' && (x.estado || '') !== 'cotizacion' && x.cliente);
  if (c) return { nombre: String(c.cliente), como: 'ya compró desde este aparato' };
  try { const a = JSON.parse(await getConfig('vid_alias:' + vid, '{}')); if (a.alias) return { nombre: String(a.alias), como: 'se lo pusiste vos' }; } catch { /**/ }
  return { nombre: '', como: '' };
}
// Los avisos instantáneos: se evalúan en cada evento que llega de la tienda (acción track).
async function avisosInstantaneos(ev: any) {
  const cfg = await alertasCfg();
  const apodo = '#' + String(ev.vid || '').replace(/[^a-z0-9]/gi, '').slice(-4).toUpperCase();
  if (ev.evento === 'checkout' && cfg.checkout) {
    if (await avisoReciente('co:' + ev.vid, 2)) return { silenciado: 'checkout' };
    const q = await quienEsVid(ev.vid, ev.nombre);
    return await pushJony('🔥 ' + (q.nombre || 'Visitante ' + apodo) + ' llegó al checkout', plataCorta(ev.total, ev.totalUSD) + (ev.carrito ? ' · ' + itemsCortos(ev.carrito) : '') + (ev.telefono ? ' · 📞 ' + ev.telefono : ''));
  }
  if (ev.evento === 'busqueda' && cfg.busqueda && (parseInt(ev.total) || 0) === 0 && ev.detalle) {
    const qb = String(ev.detalle).trim().toLowerCase().slice(0, 40);
    if (qb.length < 3 || await avisoReciente('bu:' + qb, 24)) return { silenciado: 'busqueda' };
    return await pushJony('🔎 Buscaron "' + qb + '" y no había', 'Si lo tenés o lo conseguís, es una venta. Mirá "Qué buscan" en Analítica.');
  }
  if (ev.evento === 'visita') {
    const res: any = {};
    if (cfg.conocido) {
      const q = await quienEsVid(ev.vid, ev.nombre);
      if (q.nombre && !(await avisoReciente('vi:' + ev.vid, 6))) res.conocido = await pushJony('👋 ' + q.nombre + ' entró a la tienda', 'Ahora mismo (' + q.como + '). Desde 🔴 En vivo le podés escribir mientras mira.');
    }
    if (cfg.pico) {
      const desde = new Date(Date.now() - 10 * 60000).toISOString();
      const rec = await sbGet('trafico', 'select=vid&evento=eq.visita&ts=gte.' + encodeURIComponent(desde));
      const n = new Set(rec.map((r: any) => r.vid).filter(Boolean)).size;
      if (n >= (cfg.picoMin || 15) && !(await avisoReciente('pico', 1))) res.pico = await pushJony('📈 ' + n + ' personas en la tienda en 10 minutos', 'Algo pasó: ¿mandaste algo? Miralo en 🔴 En vivo.');
    }
    return res;
  }
  return {};
}
// El informe de la semana, en un mensaje corto.
function textoInforme(a: any) {
  const r = a.resumen || {}, c = a.comparativa, e = a.embudo || {};
  const d = c && c.visitas ? ' (' + (c.visitas.delta >= 0 ? '▲' : '▼') + Math.abs(c.visitas.delta) + '%)' : '';
  const ab = a.abandonados || [];
  const plata = ab.reduce((t: number, x: any) => t + (x.total || 0), 0);
  const acc = (a.acciones || []).slice(0, 3).map((x: any, i: number) => (i + 1) + ') ' + x.titulo).join(' ');
  return (r.visitas || 0) + ' visitas' + d + ' · ' + (r.sesiones || 0) + ' sesiones · ' + (r.unicos || 0) + ' personas · ' + (e.pedido || 0) + ' pedidos · '
    + ab.length + ' carritos sin terminar (' + plataCorta(plata, 0) + '). ' + (acc ? 'Para el lunes: ' + acc : 'Nada urgente.');
}
// ¿Hoy es un día raro? Compara las visitas de hoy hasta esta hora con el mismo día de las últimas
// 4 semanas hasta la misma hora. Devuelve null si no hay con qué comparar (promedio < 10).
function rarezaCalc(filas: any[], hoyK: string, horaAR: number) {
  const m = hoyK.match(/(\d{4})-(\d{2})-(\d{2})/); if (!m) return null;
  const hoyTs = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  const dk = (ts: number) => { const d = new Date(ts); const p = (n: number) => String(n).padStart(2, '0'); return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate()); };
  const cuenta: any = {};
  filas.forEach((r: any) => { const t = tsDeFecha(r.fecha); if (t === null) return; const h = new Date(t).getUTCHours(); if (h > horaAR) return; const k = dk(t); cuenta[k] = (cuenta[k] || 0) + 1; });
  const hoy = cuenta[hoyK] || 0;
  const pasados = [1, 2, 3, 4].map((k) => cuenta[dk(hoyTs - k * 7 * 86400000)]).filter((x) => x !== undefined);
  if (!pasados.length) return null;
  const prom = pasados.reduce((a: number, b: number) => a + b, 0) / pasados.length;
  if (prom < 10) return null;
  const pct = Math.round((hoy - prom) / prom * 100);
  const nombres = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  return { hoy, promedio: Math.round(prom), pct, dia: nombres[new Date(hoyTs).getUTCDay()], semanas: pasados.length };
}
// 🔥 La vidriera de la tienda (v4.87): la recalcula el cron de cada hora y la guarda en config,
// así la tienda la recibe junto con su estado, en la misma consulta que ya hace al abrir.
async function refrescarVidriera() {
  const desde = new Date(Date.now() - 31 * 86400000).toISOString();
  const [vs, ps] = await Promise.all([
    sbGet('ventas', 'select=fecha,creado,estado,cliente,stock_updates&creado=gte.' + encodeURIComponent(desde)),
    sbGet('productos', 'select=id,stock,activo'),
  ]);
  const v = calcularVidriera(vs, ps, Date.now());
  await setConfig('TIENDA_VIDRIERA', JSON.stringify(v));
  return v;
}
// Lo que el cron de cada hora revisa: carritos colgados, el informe del domingo, y si hoy es raro.
async function avisosDelCron() {
  const cfg = await alertasCfg();
  const out: any = { carritos: 0, informe: false, rareza: null, avisame: 0, tetoca: false };
  const f = fechaAhora();
  const horaAR = parseInt(f.slice(11, 13), 10);
  const [dd, mm, yy] = f.slice(0, 10).split('/');
  const hoyK = yy + '-' + mm + '-' + dd;
  const dow = new Date(Date.UTC(+yy, +mm - 1, +dd)).getUTCDay();
  if (cfg.carrito) {
    const a = await calcularAnalitica(1, false);
    for (const c of (a.abandonados || [])) {
      if (!c.telefono || c.horas < 1 || c.horas > 3 || (c.totalEquiv || 0) < (cfg.carritoMin || 0)) continue;
      if (await avisoReciente('cc:' + c.vid, 24)) continue;
      const r = await pushJony('🛒 ' + (c.nombre || 'Visitante ' + c.apodo) + ' dejó ' + plataCorta(c.total, c.totalUSD) + ' en el carrito hace ' + c.horas + ' h', '📞 ' + c.telefono + (c.items && c.items.length ? ' · ' + c.items.slice(0, 3).map((it: any) => it.q + '× ' + String(it.n || '').slice(0, 28)).join(' · ') : '') + '. Escribile desde 🛒 Carritos.');
      if (r.ok) out.carritos++;
    }
  }
  // 🔔 v4.86: volvió algo que alguien esperaba. Una vez cada 3 días por producto.
  if (cfg.avisame) {
    try {
      const pend = await sbGet('notificaciones', 'select=producto_id,producto,estado&estado=eq.pendiente');
      if (pend.length) {
        const ids = [...new Set(pend.map((n: any) => String(n.producto_id || '')).filter(Boolean))];
        const prods = ids.length ? await sbGet('productos', 'select=id,nombre,stock,activo&id=in.(' + ids.map((x) => encodeURIComponent(x)).join(',') + ')') : [];
        for (const g of productosQueVolvieron(pend, prods) as any[]) {
          if (await avisoReciente('av:' + g.id, 72)) continue;
          const r = await pushJony('🔔 Volvió ' + g.nombre + ': ' + g.esperan + (g.esperan === 1 ? ' persona lo esperaba' : ' personas lo esperaban'), 'Avisales desde Stock → Lista de espera: el mensaje ya está armado.');
          if (r.ok) out.avisame++;
        }
      }
    } catch { /* un aviso nunca frena el cron */ }
  }
  // 🔔 v5.01: Te toca — cada mañana a las 11 (menos los sábados), a quiénes les toca volver a pedir hoy.
  if (cfg.tetoca && dow !== 6 && horaAR === 11 && !(await avisoReciente('tetoca:' + hoyK, 20))) {
    try {
      const tt = await teTocaDesdeLaBase();
      const hoy = tt.lista.filter((x: any) => !x.yaEscrito && (x.estado === 'le toca' || x.estado === 'atrasado'));
      if (hoy.length) {
        const nombres = hoy.slice(0, 3).map((x: any) => String(x.nombre).split(' ')[0]);
        const r = await pushJony('🔔 Hoy le toca pedir a ' + hoy.length + (hoy.length === 1 ? ' cliente' : ' clientes'),
          nombres.join(', ') + (hoy.length > 3 ? ' y ' + (hoy.length - 3) + ' más' : '') + '. Mandales su pedido de siempre desde 👥 Clientes → Te toca (un toque cada uno).');
        out.tetoca = !!r.ok;
      }
    } catch { /* un aviso nunca frena el cron */ }
  }
  if (cfg.informe && dow === 0 && horaAR === 20 && !(await avisoReciente('informe:' + hoyK, 20))) {
    const a7 = await calcularAnalitica(7, false);
    const r = await pushJony('📊 La semana en el Shuk', textoInforme(a7));
    out.informe = !!r.ok;
  }
  if (cfg.rareza && (horaAR === 13 || horaAR === 20)) {
    const desde = new Date(Date.now() - 29 * 86400000).toISOString();
    const filas = await sbGet('trafico', 'select=fecha&evento=eq.visita&ts=gte.' + encodeURIComponent(desde));
    const rz = rarezaCalc(filas, hoyK, horaAR);
    out.rareza = rz;
    if (rz && (rz.pct <= -50 || rz.pct >= 100) && !(await avisoReciente('rar:' + hoyK + ':' + horaAR, 20))) {
      await pushJony(rz.pct < 0 ? '📉 Hoy vas ' + Math.abs(rz.pct) + '% abajo de un ' + rz.dia + ' normal' : '📈 Hoy vas ' + rz.pct + '% arriba de un ' + rz.dia + ' normal',
        rz.hoy + ' visitas hasta las ' + String(horaAR).padStart(2, '0') + ':00 contra ' + rz.promedio + ' de promedio (' + rz.semanas + ' semanas). ' + (rz.pct < 0 ? '¿Mandaste algo esta semana?' : 'Aprovechá: mirá quién está en 🔴 En vivo.'));
    }
  }
  // Limpieza: las claves de "no repetir" de más de 3 días no protegen nada.
  try {
    const viejas = await sbGet('config', 'select=clave,valor&clave=like.PUSHDEDUP_*');
    for (const c of viejas) { if (Date.now() - (parseInt(c.valor) || 0) > 3 * 86400000) await sbDelete('config', 'clave=eq.' + encodeURIComponent(c.clave)); }
  } catch { /**/ }
  return out;
}
function fechaAhora() {
  const p: any = {};
  new Intl.DateTimeFormat('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date()).forEach((x) => p[x.type] = x.value);
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`;
}
const P = (o: any, k: string) => (o[k] == null ? '' : o[k]).toString();
// 🔒 v4.95: lo que manda un VISITANTE (acciones públicas, sin login) se guarda LIMPIO. Texto libre: sin
// < ni > (nadie puede guardar una etiqueta como <img onerror=…> que después se ejecute en el panel), sin
// caracteres de control raros y con tope de largo. Las comillas NO se tocan: hay productos con comillas en
// el nombre y el carrito viaja en JSON; al mostrar, el panel las escapa (esc / jsAttr).
const _libre = (s: any, max = 300) => String(s ?? '').replace(/[<>]/g, '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u2028\u2029]/g, ' ').slice(0, max);
// Identificadores (vid, código, id, hijo, evento, modo): solo letras, números y _ - . : — lo demás se va.
const _ident = (s: any, max = 64) => String(s ?? '').replace(/[^A-Za-z0-9_.:\-]/g, '').slice(0, max);
const _tel = (s: any) => String(s ?? '').replace(/[^\d+ ()\-]/g, '').slice(0, 25);
// A quién puede avisar la tienda Candy por WhatsApp (los chicos y Jony): antes era el número que mandara
// cualquiera, o sea un relevo de mensajes gratis con el nombre del negocio.
const WA_CANDY = ['5491171046383', '5491150987261', '5491131754540'];

// 💰 v4.99 — EL TOTAL DE UN PEDIDO DE LA TIENDA LO CALCULA EL MOTOR. Es la MISMA cuenta que hace la tienda
// (index.html: _cuentaPedido + precioEfectivo + el descuento del link VIP de _vipCargar): antes el motor guardaba
// el total que mandaba el navegador, y alguien podía pedir 10 Klik con «Total: $ 150». tests/unit/precio_real.js
// compara esta función con la de la tienda en cientos de pedidos: si cambia una, tiene que cambiar la otra.
const _hoyISO_AR = () => { const f = fechaAhora(); return f.slice(6, 10) + '-' + f.slice(3, 5) + '-' + f.slice(0, 2); };
function _fechaOfertaISO(f: string) {
  const t = String(f || '').trim();
  let m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0');
  m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? m[1] + '-' + m[2] + '-' + m[3] : '';
}
// ✂️ v5.03 — ¿ALCANZA EL STOCK para este pedido? Las fracciones ("· x3") comparten el pozo de su bolsa, así que no
// alcanza con mirar renglón por renglón: 1 bolsa cerrada + 3 promos x4 de la misma bolsa se miran JUNTAS. Primero se
// reservan las bolsas cerradas pedidas; lo que queda (cerradas × N + sueltas) se reparte entre las fracciones en orden.
// `filas` = los productos del pedido Y las bolsas madre de sus fracciones. Devuelve los renglones que no alcanzan,
// con cuánto hay de verdad para ese renglón (la tienda recorta el carrito con eso).
const COLS_STOCK = 'id,nombre,stock,fraccion_de,fraccion_cant,unidades_por_paquete,sueltas';
function faltantesStock(pares: any[], filas: any[]) {
  const F: any = {}; filas.forEach((r: any) => { F[String(r.id)] = r; });
  const pozos: any = {};
  const pozo = (id: string) => (pozos[id] = pozos[id] || { bolsas: [], fr: [] });
  for (const x of pares) {
    const id = String(x.id).trim(), qty = parseInt(x.qty) || 0;
    if (!id || qty <= 0) continue;
    const madre = F[id] ? (F[id].fraccion_de || '').toString().trim() : '';
    if (madre) pozo(madre).fr.push({ id, qty }); else pozo(id).bolsas.push({ id, qty });
  }
  const out: any[] = [];
  for (const pid of Object.keys(pozos)) {
    const P = pozos[pid], M = F[pid];
    let cerradas = M ? Math.max(0, parseInt(M.stock) || 0) : 0;
    for (const b of P.bolsas) {
      const hay = Math.min(b.qty, cerradas);
      if (hay < b.qty) out.push({ id: b.id, nombre: M ? M.nombre : '#' + b.id, pedido: b.qty, hay });
      cerradas -= hay;
    }
    if (!P.fr.length) continue;
    const upp = M ? Math.max(1, parseInt(M.unidades_por_paquete) || 1) : 1;
    let unidades = M ? cerradas * upp + Math.max(0, parseInt(M.sueltas) || 0) : 0;
    for (const f of P.fr) {
      const r = F[f.id], k = Math.max(1, parseInt(r.fraccion_cant) || 1);
      const hay = Math.min(f.qty, Math.floor(unidades / k));
      if (hay < f.qty) out.push({ id: f.id, nombre: r.nombre, pedido: f.qty, hay });
      unidades -= hay * k;
    }
  }
  return out;
}
// Trae de la base lo que necesita faltantesStock: los productos del pedido y las bolsas madre de sus fracciones.
async function faltantesDelPedido(pares: { id: string; qty: number }[]) {
  const ids = [...new Set(pares.map((x) => String(x.id).trim()).filter((x) => /^\d+$/.test(x)))];
  if (!ids.length) return [];
  const filas = await sbGet('productos', 'select=' + COLS_STOCK + '&id=in.(' + ids.join(',') + ')');
  const madres = [...new Set(filas.map((r: any) => (r.fraccion_de || '').toString().trim()).filter((m: string) => /^\d+$/.test(m) && ids.indexOf(m) === -1))];
  if (madres.length) for (const r of await sbGet('productos', 'select=' + COLS_STOCK + '&id=in.(' + madres.join(',') + ')')) filas.push(r);
  return faltantesStock(pares, filas);
}
// 🏷️ EL precio minorista de HOY para `qty` unidades: la oferta vigente (si de verdad baja el precio) y el pack por
// umbral ("llevando N o más, cada una a $ X"). v5.02: la usan la tienda (calcularPedidoTienda) Y el bot de WhatsApp/SMS/voz
// — una sola cuenta, así el bot nunca cobra distinto que la tienda. `base` = el precio de partida si ya viene rebajado
// (el link VIP); si no, el de lista.
function precioMinoristaHoy(p: any, qty: number, hoyISO: string, base = -1) {
  let v = base >= 0 ? base : (parseFloat(p.precio_min) || 0);
  const of = parseFloat(p.precio_oferta) || 0, vence = _fechaOfertaISO(String(p.fecha_oferta || '').trim());
  if (of > 0 && !(vence && hoyISO > vence) && of < v) v = of;
  const cp = parseInt(p.cant_pack) || 0, pp = parseFloat(p.precio_pack) || 0;
  if (cp > 0 && pp > 0 && qty >= cp && pp < v) v = pp;
  return Math.round(v);
}
function _conDescVip(v: number, pct: number, esDolar: boolean) { if (!pct || pct <= 0) return v; const r = v * (1 - pct / 100); return esDolar ? Math.ceil(r * 100) / 100 : Math.ceil(r); }
function calcularPedidoTienda(pares: any[], filas: any[], mayorista: boolean, vip: any, hoyISO: string) {
  const porId: any = {};
  (filas || []).forEach((r: any) => { porId[String(r.id)] = r; });
  const vipIds = vip && Array.isArray(vip.ids) ? new Set(vip.ids.map(String)) : null;
  const descG = vip ? (Number(vip.desc) || 0) : 0;
  const descP: any = vip && vip.descProd && typeof vip.descProd === 'object' ? vip.descProd : {};
  let arsJONY = 0, arsMyri = 0, usdMyri = 0, usdJONY = 0;
  const lineas: string[] = [], sinPrecio: string[] = [];
  for (const par of pares) {
    const id = String(par.id), qty = par.qty;
    const p = porId[id];
    if (!p) return null;   // un producto que no está: no hay con qué comparar (el control de stock ya lo frena antes)
    const moneda = String(p.moneda || '$').trim() === 'U$S' ? 'U$S' : '$';
    const esJonyP = String(p.dueno || '').trim() === 'Jony';
    let may = parseFloat(String(p.precio_may == null ? '' : p.precio_may).replace(',', '.')) || 0;
    let min = parseFloat(p.precio_min) || 0;
    if (vipIds && vipIds.has(id)) {
      const x = descP[id];
      const pct = (x !== undefined && x !== '' && !isNaN(x)) ? (Number(x) || 0) : descG;
      if (pct > 0) { if (may > 0) may = _conDescVip(may, pct, moneda === 'U$S'); if (min > 0) min = _conDescVip(min, pct, false); }
    }
    let unit: number, mon: string;
    if (mayorista) {
      mon = moneda;
      if (mon === 'U$S') { unit = may; if (esJonyP) usdJONY += unit * qty; else usdMyri += unit * qty; }
      else { unit = Math.round(may); if (esJonyP) arsJONY += unit * qty; else arsMyri += unit * qty; }
    } else {
      unit = precioMinoristaHoy(p, qty, hoyISO, min); mon = '$';
      if (esJonyP) arsJONY += unit * qty; else arsMyri += unit * qty;
    }
    if (!(unit > 0)) sinPrecio.push(String(p.nombre || '#' + id));   // la tienda no deja pedir algo sin precio: si llega, alguien lo armó a mano
    const subtotal = mon === 'U$S' ? (unit * qty).toFixed(2) : Math.round(unit * qty).toLocaleString('es-AR');
    const unitStr = mon === 'U$S' ? unit.toFixed(2) : unit.toLocaleString('es-AR');
    const desc = String(p.descripcion || '');
    lineas.push(`• ${qty}x ${p.nombre || ''}${desc ? ' · ' + desc.substring(0, 45) : ''} — ${mon} ${unitStr} c/u = ${mon} ${subtotal}`);
  }
  return { totalARS: arsJONY + arsMyri, totalUSD: usdMyri + usdJONY, arsJONY, arsMyri, usdMyri, usdJONY, comiARS: Math.round(arsMyri * 0.15), comiUSD: parseFloat((usdMyri * 0.15).toFixed(2)), lineas, sinPrecio };
}
// ¿Lo que mandó el navegador (ya redondeado como lo manda la tienda) cierra con la cuenta real? Pesos al peso, dólares al centavo.
const PARTES_PEDIDO = ['totalARS', 'totalUSD', 'arsJONY', 'arsMyri', 'usdJONY', 'usdMyri', 'comiARS', 'comiUSD'];
function totalNoCierra(mandado: any, real: any) {
  return PARTES_PEDIDO.some((k) => Math.abs((Number(mandado[k]) || 0) - (Number(real[k]) || 0)) > (k.indexOf('ARS') !== -1 ? 0.5 : 0.011));
}
const _plataTxt = (ars: number, usd: number) => [ars > 0 ? '$ ' + Math.round(ars).toLocaleString('es-AR') : '', usd > 0 ? 'U$S ' + usd.toFixed(2) : ''].filter(Boolean).join(' + ') || '$ 0';

// 🚨 v4.99 — FRENO DE PEDIDOS FALSOS que no depende de algo que elige el navegador (el vid se cambia borrando las
// cookies). Por CONEXIÓN (se guarda solo una huella de la IP, nunca la IP) y en TOTAL, por hora. Solo cuentan los
// pedidos de las tiendas públicas (los manuales de Jony no). Si salta, a Jony le llega UN aviso por hora.
const FRENO_POR_CONEXION = 5, FRENO_TOTAL_HORA = 30;
async function huellaIP(req: Request): Promise<string> {
  const ip = (req.headers.get('cf-connecting-ip') || req.headers.get('x-real-ip') || (req.headers.get('x-forwarded-for') || '').split(',')[0] || '').trim();
  if (!ip) return '';
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('shuk-ip|' + (BOT_SECRET || '') + '|' + ip));
  return Array.from(new Uint8Array(d)).slice(0, 10).map((b) => b.toString(16).padStart(2, '0')).join('');
}
async function frenoPedidos(tabla: string, ipH: string): Promise<string> {
  const desde = encodeURIComponent(new Date(Date.now() - 3600000).toISOString());
  if (ipH && (await sbGet(tabla, 'select=creado&ip_h=eq.' + ipH + '&creado=gte.' + desde)).length >= FRENO_POR_CONEXION) return 'conexion';
  if ((await sbGet(tabla, 'select=creado&ip_h=not.is.null&creado=gte.' + desde)).length >= FRENO_TOTAL_HORA) return 'total';
  return '';
}
async function avisarFreno(tabla: string, motivo: string) {
  try {
    const clave = 'FRENO_AVISO_' + tabla, ultimo = parseInt(await getConfig(clave, '0')) || 0;
    if (Date.now() - ultimo < 3600000) return;   // un solo aviso por hora
    await setConfig(clave, String(Date.now()));
    await sendTwilioWA('+5491131754540', '⚠️ *Freno de pedidos (' + (tabla === 'ventas' ? 'tienda del Shuk' : 'tienda del Candy') + ')*\n\n'
      + (motivo === 'conexion' ? 'Entraron ' + FRENO_POR_CONEXION + ' pedidos en una hora desde la MISMA conexión.' : 'Entraron más de ' + FRENO_TOTAL_HORA + ' pedidos en una hora.')
      + ' Los siguientes se frenan hasta que baje.\n\nSi es gente de verdad (por ejemplo, un evento), avisale a Claude para subir el límite.');
  } catch { /* el aviso nunca frena nada */ }
}
// ⚠️ Teléfono con pinta de trucho: <10 dígitos reales (área+número en AR), >13, o todos iguales.
// Defensa del lado del motor para 'notificacion' y 'avisarmeCandy' (la tienda ya valida, pero
// un fetch directo la saltea). Mismo criterio que _telDudoso del front.
const telDudoso = (tel: string) => {
  let d = String(tel || '').replace(/\D/g, '').replace(/^0+/, '');
  if (d.indexOf('549') === 0) d = d.slice(3); else if (d.indexOf('54') === 0) d = d.slice(2);
  if (d.length === 11 && d[0] === '9') d = d.slice(1);
  if (d.length === 12 && d.indexOf('15') === 0) d = d.slice(2);
  return d.length < 10 || d.length > 13 || /^(\d)\1+$/.test(d);
};
const N = (o: any, k: string) => { const n = parseFloat(o[k]); return isNaN(n) ? 0 : n; };
const normCli = (s: string) => (s || '').toString().trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ');
// 'jony' (nombre que usa la tienda ?kid=jony) y 'Pa' (perfil del panel) son la MISMA persona.
const normHijo = (s: any) => { const x = (s || '').toString().trim().toLowerCase(); return (x === 'jony' || x === 'pa') ? 'pa' : x; };
// Fecha de venta retroactiva: el front manda 'yyyy-MM-dd' → 'dd/MM/yyyy 12:00' (como el motor,
// que hacía new Date(fecha+'T12:00:00') y la hoja mostraba dd/MM/yyyy 12:00).
const fechaRetro = (f: string) => { const m = (f || '').match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? `${m[3]}/${m[2]}/${m[1]} 12:00` : f; };
async function saldoClienteCandy(hijo: string, cliente: string) {
  const cc = await sbGet('candy_cc', 'select=monto,cliente&hijo=eq.' + encodeURIComponent(hijo));
  const obj = normCli(cliente); let saldo = 0;
  cc.forEach((r: any) => { if (normCli(r.cliente) === obj) saldo += parseFloat(r.monto) || 0; });
  return saldo;
}
// 🧑 Grafía CANÓNICA del cliente Candy: si ya existe uno igual sin distinguir mayúsculas/acentos
// (caso real: 'Natan marinberg' vs 'Natan Marinberg' desincronizó el saldo del panel de Iosi),
// se usa la grafía YA GUARDADA — jamás se crea una variante nueva del mismo nombre.
async function clienteCanonicoCandy(nombre: string) {
  const limpio = (nombre || '').toString().trim().replace(/\s+/g, ' ');
  if (!limpio) return limpio;
  const k = normCli(limpio);
  const cc = await sbGet('candy_cc', 'select=cliente&limit=10000');
  for (const r of cc) { if (normCli(r.cliente) === k) return (r.cliente || '').toString().trim(); }
  const vt = await sbGet('candy_ventas', 'select=cliente&cliente=neq.&limit=10000');
  for (const r of vt) { if (normCli(r.cliente) === k) return (r.cliente || '').toString().trim(); }
  return limpio;
}
async function ajustarDeposito(codigo: string, nombre: string, delta: number, origen = '') {
  const ex = await sbGet('candy_deposito', 'select=cantidad&codigo=eq.' + encodeURIComponent(codigo));
  const antes = ex.length ? (parseFloat(ex[0].cantidad) || 0) : 0;
  if (ex.length) await sbPatch('candy_deposito', 'codigo=eq.' + encodeURIComponent(codigo), { cantidad: antes + delta });
  else await sbInsert('candy_deposito', { codigo, nombre: nombre || null, cantidad: delta });
  // Trazabilidad (M2 unificación): misma tabla movimientos_stock del Shuk, id_prod = código Candy.
  if (origen && delta !== 0) { try { await sbInsert('movimientos_stock', { fecha: fechaAhora(), id_prod: codigo, producto: nombre || '', cambio: delta, antes, despues: antes + delta, origen }); } catch { /**/ } }
}
// ═══ CIRCUITO CANDY↔SHUK F1 — compra automática de paquetes (diseño del usuario 2026-06-30) ═══
// Antes de descontar del depósito un producto `shuk:<id>` de MIRI: si el stock genuino de Candy
// no alcanza, Candy le COMPRA a Miri los paquetes enteros necesarios (mayorista×0,85, deuda en
// Cta Cte del Shuk como cliente "Candy") y las unidades sobrantes quedan genuinas en Candy.
async function asegurarGenuinoShuk(codigo: string, cant: number, contexto: string) {
  if (!codigo.startsWith('shuk:') || cant <= 0) return { ok: true };
  const pid = codigo.slice(5);
  const pr = await sbGet('productos', 'select=id,nombre,dueno,moneda,precio_may,costo,stock,unidades_por_paquete,vinculo&id=eq.' + encodeURIComponent(pid));
  if (!pr.length) return { ok: true };   // producto desconocido → comportamiento viejo
  const p = pr[0];
  const dep = await sbGet('candy_deposito', 'select=cantidad&codigo=eq.' + encodeURIComponent(codigo));
  const genuino = dep.length ? (parseFloat(dep[0].cantidad) || 0) : 0;
  if (genuino >= cant) return { ok: true };   // alcanza con lo genuino
  // FAMILIA de gemelos (vínculo explícito al publicar): mismo producto con stock de varios dueños.
  const grupo = (p.vinculo || '').toString().trim();
  let familia = [p];
  if (grupo) {
    const fam = await sbGet('productos', 'select=id,nombre,dueno,moneda,precio_may,costo,stock,unidades_por_paquete,vinculo&or=(vinculo.eq.' + encodeURIComponent(grupo) + ',id.eq.' + encodeURIComponent(grupo) + ')');
    if (fam.length) familia = fam;
  }
  // Prioridad del usuario: JONY primero (Candy compra AL COSTO → cero ganancia/Maaser/comisión),
  // después MIRI (mayorista −15%). Compra HÍBRIDA si hace falta: una venta interna POR DUEÑO.
  const fuentes = familia.filter((f: any) => ['Jony', 'Miri'].includes((f.dueno || '').toString().trim()) && (parseInt(f.stock) || 0) > 0)
    .sort((a: any, b: any) => ((a.dueno === 'Jony') ? 0 : 1) - ((b.dueno === 'Jony') ? 0 : 1));
  let faltan = cant - genuino;
  // 1º pasada: ¿la familia entera alcanza? (validar TODO antes de escribir nada)
  const plan: any[] = [];
  for (const f of fuentes) {
    if (faltan <= 0) break;
    const uppF = Math.max(1, parseInt(f.unidades_por_paquete) || 1);
    const paqNec = Math.ceil(faltan / uppF);
    const paqF = Math.min(paqNec, parseInt(f.stock) || 0);
    if (paqF <= 0) continue;
    const esJony = (f.dueno || '').toString().trim() === 'Jony';
    const unitF = esJony
      ? (parseFloat(String(f.costo || '0').replace(',', '.')) || 0)                       // Jony: AL COSTO
      : Math.round((parseFloat(String(f.precio_may || '0').replace(',', '.')) || 0) * 0.85 * 100) / 100;   // Miri: may −15%
    plan.push({ f, paquetes: paqF, upp: uppF, unit: unitF, esJony });
    faltan -= paqF * uppF;
  }
  if (faltan > 0) {
    const nombres = familia.map((f: any) => '"' + f.nombre + '" (' + (f.dueno || '?') + ': ' + (parseInt(f.stock) || 0) + ')').join(', ');
    return { error: 'Sin stock en el Shuk para cubrir ' + cant + ' unidades. Disponible: ' + nombres };
  }
  // 2º pasada: ejecutar el plan — una venta interna por fuente usada.
  const compras: any[] = [];
  for (const c of plan) {
    const f = c.f, esUSD = (f.moneda || '$').toString().trim() === 'U$S';
    const total = Math.round(c.unit * c.paquetes * 100) / 100;
    const fila: any = { fecha: fechaAhora(), cliente: 'Candy', tipo: 'Mayorista',
      productos: '• ' + c.paquetes + 'x ' + f.nombre + ' — ' + (esUSD ? 'U$S ' + c.unit.toFixed(2) : '$ ' + Math.round(c.unit)) + ' c/u = ' + (esUSD ? 'U$S ' + total.toFixed(2) : '$ ' + Math.round(total)),
      forma_pago: 'Cuenta corriente', notas: '🔗 Circuito Candy↔Shuk · ' + contexto + (c.esJony ? ' · al costo (Jony)' : ''), estado: 'entregado',
      total_ars: esUSD ? 0 : Math.round(total), total_usd: esUSD ? total : 0,
      ars_jony: (!esUSD && c.esJony) ? Math.round(total) : 0, ars_myri: (!esUSD && !c.esJony) ? Math.round(total) : 0,
      usd_myri: (esUSD && !c.esJony) ? total : 0, usd_jony: (esUSD && c.esJony) ? total : 0,
      comi_ars: 0, comi_usd: 0, caja_jony: '', caja_myri: '', tipo_cambio: 0, stock_updates: f.id + ':' + c.paquetes, sin_comi: 'SI' };
    const ins = await insertarVentaAtomica(fila);
    if ('error' in ins) return { error: 'circuito: ' + ins.error };
    await moverStockShuk(String(f.id), -c.paquetes, '🔗 Compra Candy #' + ins.nVenta + ' (circuito' + (c.esJony ? ' · Jony al costo' : '') + ')');
    await ajustarDeposito(codigo, p.nombre, c.paquetes * c.upp, '🔗 Apertura de paquete Shuk (compra interna #' + ins.nVenta + (c.esJony ? ' · Jony' : ' · Miri') + ')');
    await sbInsert('candy_compras', { compra_id: 'CS' + ins.nVenta, fecha: fechaAhora().slice(0, 10), proveedor: c.esJony ? 'Shuk (Jony, al costo)' : 'Shuk (Miri)', proveedor_id: 'shuk', codigo, producto: f.nombre, cantidad: c.paquetes * c.upp, costo_unit: Math.round((c.unit / c.upp) * 100) / 100, costo_total: total, registrado_por: 'circuito' + (esUSD ? ' U$S' : '') });
    compras.push({ dueno: f.dueno, paquetes: c.paquetes, nVenta: ins.nVenta });
  }
  return { ok: true, compras };
}
// ═══ CIRCUITO F3 — al PAGAR la deuda del cliente "Candy" con TC, las compras del circuito
// que quedaron en U$S crudo se pasan a PESOS con ese TC real → recién ahí Candy conoce su
// ganancia real (vendió en $, compró en U$S). El "mensaje interno" queda en la propia compra.
async function convertirComprasCircuito(tc: number, soloCompraId = '') {
  if (!(tc > 0)) return 0;
  let q = 'select=id,compra_id,codigo,costo_unit,costo_total&registrado_por=eq.' + encodeURIComponent('circuito U\$S');
  if (soloCompraId) q += '&compra_id=eq.' + encodeURIComponent(soloCompraId);
  const rows = await sbGet('candy_compras', q);
  const codigos = new Set<string>();
  for (const r of rows) {
    await sbPatch('candy_compras', 'id=eq.' + r.id, {
      costo_unit: Math.round((parseFloat(r.costo_unit) || 0) * tc * 100) / 100,
      costo_total: Math.round((parseFloat(r.costo_total) || 0) * tc * 100) / 100,
      registrado_por: 'circuito · pagada a \$' + tc + '/U\$S',
    });
    if (r.codigo) codigos.add(r.codigo.toString());
  }
  for (const c of codigos) await actualizarCostoPromedio(c);
  return rows.length;
}
async function actualizarCostoPromedio(codigo: string) {
  const compras = await sbGet('candy_compras', 'select=cantidad,costo_total&codigo=eq.' + encodeURIComponent(codigo));
  let unidades = 0, total = 0;
  compras.forEach((c: any) => { unidades += parseInt(c.cantidad) || 0; total += parseFloat(c.costo_total) || 0; });
  if (unidades <= 0) return;
  await sbPatch('candy_productos', 'codigo=eq.' + encodeURIComponent(codigo), { costo: Math.round((total / unidades) * 100) / 100 });
}
async function setEstadoPedidoHijo(body: any, estado: string) {
  const pedidoId = P(body, 'pedidoId');
  if (!pedidoId) return { error: 'parámetros inválidos' };
  const rows = await sbGet('candy_pedidos', 'select=*&pedido_id=eq.' + encodeURIComponent(pedidoId));
  if (!rows.length) return { error: 'no encontrado' };
  const ped = rows[0];
  if ((ped.estado || '') !== 'pendiente') return { ok: true, yaProcesado: true };
  if (estado === 'cancelado') {   // devolver stock reservado al depósito
    let items: any[] = []; try { items = JSON.parse(ped.items || '[]'); } catch { items = []; }
    for (const it of items) { const cant = parseInt(it.cantidad) || 0, cod = (it.codigo || '').toString(); if (cant > 0 && cod) await ajustarDeposito(cod, it.nombre || '', cant, 'Pedido de la tienda cancelado (stock devuelto)'); }
    // 🔗 REVERSA del circuito (caso truchos 13/07: la compra automática al Shuk quedaba viva y
    // "Candy debía" mercadería de un pedido falso). Se buscan las ventas internas de ESTE pedido
    // (el pedidoId viaja en la nota) y se deshace todo: venta cancelada + stock Shuk devuelto +
    // genuino descontado + compra borrada. Si los chicos ya vendieron parte del paquete abierto,
    // la reversa es parcial y avisa por WhatsApp.
    try {
      const compras = await sbGet('ventas', 'select=id,n_venta,stock_updates,estado,notas&cliente=eq.Candy&notas=ilike.' + encodeURIComponent('*[' + pedidoId + ']*'));
      for (const cv of compras) {
        if ((cv.estado || '') === 'cancelado') continue;
        await sbPatch('ventas', 'id=eq.' + encodeURIComponent(cv.id), { estado: 'cancelado' });
        for (const u of (cv.stock_updates || '').split(',')) {
          const pp = u.split(':'); const pid2 = (pp[0] || '').trim(), paq = parseInt(pp[1]) || 0;
          if (!pid2 || paq <= 0) continue;
          await moverStockShuk(pid2, paq, 'Reversa circuito — pedido tienda cancelado (#' + cv.n_venta + ')');
          const prU = await sbGet('productos', 'select=nombre,unidades_por_paquete&id=eq.' + encodeURIComponent(pid2));
          const uppR = prU.length ? Math.max(1, parseInt(prU[0].unidades_por_paquete) || 1) : 1;
          const unidades = paq * uppR;
          const depR = await sbGet('candy_deposito', 'select=cantidad&codigo=eq.' + encodeURIComponent('shuk:' + pid2));
          const genR = depR.length ? (parseFloat(depR[0].cantidad) || 0) : 0;
          const quitar = Math.min(unidades, Math.max(0, genR));
          if (quitar > 0) await ajustarDeposito('shuk:' + pid2, prU.length ? prU[0].nombre : '', -quitar, 'Reversa circuito (pedido tienda cancelado)');
          if (quitar < unidades) await sendTwilioWA('+5491131754540', '⚠️ *Reversa PARCIAL del circuito*\nPedido cancelado ' + pedidoId + ': la compra #' + cv.n_venta + ' abrió ' + unidades + ' unidades pero quedan ' + quitar + ' en el depósito (el resto ya se vendió). Revisalo.');
        }
        await sbDelete('candy_compras', 'compra_id=eq.' + encodeURIComponent('CS' + cv.n_venta));
      }
    } catch { /* la reversa jamás frena la cancelación */ }
  }
  await sbPatch('candy_pedidos', 'pedido_id=eq.' + encodeURIComponent(pedidoId), { estado });
  return { ok: true };
}
const json = (obj: unknown, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' } });

// WhatsApp saliente vía Twilio (mismo canal que sendTwilioWA del motor viejo).
// Best-effort: sin credenciales o con error NO rompe la operación principal.
async function sendTwilioWA(to: string, body: string) {
  const sid = Deno.env.get('TWILIO_SID') || '', tok = Deno.env.get('TWILIO_TOKEN') || '';
  const from = Deno.env.get('TWILIO_FROM') || 'whatsapp:+14155238886';
  if (!sid || !tok || !to) return false;
  try {
    const r = await fetch('https://api.twilio.com/2010-04-01/Accounts/' + sid + '/Messages.json', {
      method: 'POST',
      headers: { Authorization: 'Basic ' + btoa(sid + ':' + tok), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ From: from, To: 'whatsapp:' + to, Body: body }),
    });
    return r.ok;
  } catch { return false; }
}

// Mueve stock de un producto de Shuk — portado de _moverStockShuk_ del motor viejo.
// Si el producto comparte depósito con Candy (candy_cod), el stock real vive en
// candy_deposito: se ajusta AHÍ (mismo pozo que Candy → no se sobrevende) y la
// columna stock de productos no se toca. Siempre deja huella en movimientos_stock.
async function moverStockShuk(pid: string, delta: number, motivo: string) {
  const pr = await sbGet('productos', 'select=stock,nombre,candy_cod,fraccion_de&id=eq.' + encodeURIComponent(pid));
  if (!pr.length) return null;
  const nombre = (pr[0].nombre || '').toString();
  const candyCod = (pr[0].candy_cod || '').toString().trim();
  if (candyCod) {
    const dep = await sbGet('candy_deposito', 'select=cantidad&codigo=eq.' + encodeURIComponent(candyCod));
    const antes = dep.length ? parseInt(dep[0].cantidad) || 0 : 0;
    await ajustarDeposito(candyCod, nombre, delta, motivo + ' · espejo depósito Candy');
    await sbInsert('movimientos_stock', { fecha: fechaAhora(), id_prod: pid, producto: nombre, cambio: delta, antes, despues: antes + delta, origen: motivo + ' (depósito compartido)' });
    return { antes, despues: antes + delta, compartido: true, nombre };
  }
  // ✂️ v5.03: en UN solo paso dentro de la base (mover_stock, supabase_fracciones.sql). Antes era leer-y-escribir y
  // dos pedidos simultáneos del mismo producto se pisaban. Si es una FRACCIÓN, la base gasta el pozo de su bolsa:
  // primero las sueltas y, si no alcanzan, abre bolsas cerradas (y todas las fracciones hermanas se recalculan solas).
  let r: any;
  try { r = await sbRpc('mover_stock', { p_id: String(pid), p_delta: delta }); }
  catch (e) {
    // Red: si la función de la base faltara, un producto NORMAL se mueve como antes (una venta nunca queda a medias).
    // Una fracción no tiene camino viejo: sin la función no se puede gastar el pozo de su bolsa.
    if ((pr[0].fraccion_de || '').toString().trim()) throw e;
    const antesV = parseInt(pr[0].stock) || 0, despuesV = antesV + delta;
    await sbPatch('productos', 'id=eq.' + encodeURIComponent(pid), { stock: despuesV });
    await sbInsert('movimientos_stock', { fecha: fechaAhora(), id_prod: pid, producto: nombre, cambio: delta, antes: antesV, despues: despuesV, origen: motivo });
    return { antes: antesV, despues: despuesV, compartido: false, nombre };
  }
  if (!r) return null;
  const antes = parseFloat(r.antes) || 0, despues = parseFloat(r.despues) || 0;
  if (!r.fraccion) {
    await sbInsert('movimientos_stock', { fecha: fechaAhora(), id_prod: pid, producto: nombre, cambio: delta, antes, despues, origen: motivo });
    return { antes, despues, compartido: false, nombre };
  }
  const quedan = ' · la bolsa queda en ' + r.cerradas + ' cerrada' + (r.cerradas === 1 ? '' : 's') + ' + ' + r.sueltas + ' suelta' + (r.sueltas === 1 ? '' : 's');
  await sbInsert('movimientos_stock', { fecha: fechaAhora(), id_prod: pid, producto: nombre, cambio: delta, antes, despues, origen: motivo + ' ✂️ (sale de «' + (r.padreNombre || '') + '»' + quedan + ')' });
  const abiertas = parseInt(r.abiertas) || 0;
  if (abiertas > 0) await sbInsert('movimientos_stock', { fecha: fechaAhora(), id_prod: String(r.padre), producto: r.padreNombre || '', cambio: -abiertas, antes: (parseFloat(r.cerradas) || 0) + abiertas, despues: parseFloat(r.cerradas) || 0, origen: '✂️ Se abri' + (abiertas === 1 ? 'ó 1 bolsa' : 'eron ' + abiertas + ' bolsas') + ' para «' + nombre + '» · ' + motivo + quedan });
  return { antes, despues, compartido: false, nombre };
}

// Stock REAL disponible de un producto del Shuk. Si comparte depósito con Candy (candy_cod),
// la verdad NO está en productos.stock sino en candy_deposito (mismo pozo que Candy) — leerlo
// del lado equivocado hace creer que hay mercadería que no existe. Devuelve null si el producto
// ya no está en el catálogo.
async function stockRealShuk(pid: string): Promise<number | null> {
  const pr = await sbGet('productos', 'select=stock,candy_cod&id=eq.' + encodeURIComponent(pid));
  if (!pr.length) return null;
  const cc = (pr[0].candy_cod || '').toString().trim();
  if (!cc) return parseInt(pr[0].stock) || 0;
  const dep = await sbGet('candy_deposito', 'select=cantidad&codigo=eq.' + encodeURIComponent(cc));
  return dep.length ? (parseInt(dep[0].cantidad) || 0) : 0;
}

// Alta automática del cliente al registrar una venta (portado de altaClienteAuto_).
// No duplica (compara normalizado) y NUNCA rompe la venta.
async function altaClienteAuto(nombre: string, tipo: string) {
  try {
    const nom = (nombre || '').trim();
    if (!nom || nom === '__TEST__') return;
    const key = normCli(nom);
    if (!key) return;
    const todos = await sbGet('clientes', 'select=nombre');
    if (todos.some((c: any) => normCli((c.nombre || '').toString()) === key)) return;
    const f = fechaAhora();
    await sbInsert('clientes', { fecha: f, nombre: nom, telefono: '', tipo: tipo || 'Minorista', nota: '', ultimo_acceso: f });
  } catch { /* best-effort */ }
}

// ── SATÉLITES: IA (Anthropic) + worker relay (Telegram/imágenes/WA de los chicos) ──
const WORKER_RELAY_URL = 'https://shuk-hijos-bot.ingodwetrustsrl.workers.dev';
const BOT_SECRET = Deno.env.get('BOT_SECRET') || '';

// La clave de IA vive en la tabla config (la carga el panel con guardarClaveIA,
// igual que ScriptProperties en el motor viejo). Fallback: secret de la EF.
async function claveIA() { return (await getConfig('ANTHROPIC_API_KEY', '')) || Deno.env.get('ANTHROPIC_API_KEY') || ''; }
async function claveGemini() { return (await getConfig('GEMINI_API_KEY', '')) || Deno.env.get('GEMINI_API_KEY') || ''; }
// 🔑 v4.93: antes de guardar una clave nueva se PRUEBA contra el servicio (una lista de modelos: no
// gasta nada). Así un pegado a medias no deja la IA muerta hasta que alguien se dé cuenta.
async function probarClaveIA(tipo: string, clave: string): Promise<string> {
  try {
    const r = tipo === 'anthropic'
      ? await fetch('https://api.anthropic.com/v1/models?limit=1', { headers: { 'x-api-key': clave, 'anthropic-version': '2023-06-01' } })
      : await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1', { headers: { 'x-goog-api-key': clave } });
    if (r.ok) return '';
    return r.status === 401 || r.status === 403 || r.status === 400 ? 'la clave no funciona (el servicio la rechazó)' : 'el servicio respondió ' + r.status + ' — probá de nuevo en un rato';
  } catch { return 'no se pudo comprobar la clave (sin conexión con el servicio)'; }
}
async function fechasClavesIA(): Promise<any> { try { return JSON.parse(await getConfig('CLAVES_IA_FECHAS', '{}')) || {}; } catch { return {}; } }

// 🖼️ v4.99 — SUBIDAS A CLOUDINARY CON FIRMA. Los paneles subían con presets «sin firma»: cualquiera que leyera el código
// de una página podía subir archivos a la cuenta. Ahora el motor firma cada subida, solo para el equipo (Jony y la cuenta
// de los chicos) y solo con los presets y carpetas de los paneles, con la clave de Cloudinary que Jony carga en 🔑 (nunca
// sale del motor ni viaja en el backup). Con los presets cerrados, lo que llegue sin firma Cloudinary lo rechaza.
const CLD_CLOUD = 'dq2boloyp', CLD_PRESETS = ['shuk_upload', 'candyshop'], CLD_CARPETAS = ['shuk-mamtakim', 'shuk-comprobantes'];
async function claveCloudinary() { const k = await getConfig('CLOUDINARY_API_KEY', ''), s = await getConfig('CLOUDINARY_API_SECRET', ''); return k && s ? { k, s } : null; }
async function probarClaveCloudinary(k: string, s: string): Promise<string> {
  try {
    const r = await fetch('https://api.cloudinary.com/v1_1/' + CLD_CLOUD + '/usage', { headers: { Authorization: 'Basic ' + btoa(k + ':' + s) } });   // lectura: no gasta nada
    if (r.ok) return '';
    return r.status === 401 || r.status === 403 ? 'la clave no funciona (Cloudinary la rechazó)' : 'Cloudinary respondió ' + r.status + ' — probá de nuevo en un rato';
  } catch { return 'no se pudo comprobar la clave (sin conexión con Cloudinary)'; }
}
// Qué se firma de una subida: SOLO el preset y la carpeta de los paneles. Cualquier otro campo (public_id para pisar una
// foto, transformaciones, otra carpeta u otro preset) no se firma → null.
function camposAFirmar(campos: any): any {
  const firmar: any = {};
  for (const [k, v] of Object.entries(campos || {})) {
    if (k === 'upload_preset' && CLD_PRESETS.indexOf(String(v)) !== -1) firmar[k] = String(v);
    else if (k === 'folder' && CLD_CARPETAS.indexOf(String(v)) !== -1) firmar[k] = String(v);
    else return null;
  }
  return firmar.upload_preset ? firmar : null;
}
// La firma de Cloudinary: los campos ordenados «a=1&b=2», pegados al secreto, en SHA-1 (su algoritmo publicado).
async function firmaCloudinary(campos: any, secreto: string): Promise<string> {
  const txt = Object.keys(campos).sort().map((k) => k + '=' + campos[k]).join('&') + secreto;
  const d = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(txt));
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Llamada cruda a la API de Anthropic (mismo payload que el motor viejo). `betas`: funciones de la
// API que todavía van con encabezado propio (p. ej. el respaldo si el modelo se niega).
async function anthropicMsg(apiKey: string, payload: any, betas: string[] = []): Promise<{ code: number; body: any; texto: string }> {
  const headers: any = { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' };
  if (betas.length) headers['anthropic-beta'] = betas.join(',');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  let texto = '';
  (body.content || []).forEach((b: any) => { if (b.type === 'text') texto += b.text; });
  return { code: res.status, body, texto };
}

function urlFotoProducto(ref: string) {
  const r = (ref || '').toString();
  if (r.indexOf('http') === 0) return r;
  return 'https://res.cloudinary.com/dq2boloyp/image/upload/w_800,f_auto,q_auto/' + r;
}

// Mira la foto y propone nombre/desc/categoría con el MOLDE de los textos reales
// del catálogo (portado 1:1 de analizarFotoProducto de motor-v2.js).
async function analizarFotoProducto(pUrl: string) {
  const apiKey = await claveIA();
  if (!apiKey) return { error: 'sin_clave', mensaje: 'Falta la clave de IA (se carga desde la card Preguntale a tu negocio).' };
  const url = urlFotoProducto(pUrl);
  if (!url) return { error: 'sin url' };
  const prods = (await sbGet('productos', 'select=id,nombre,descripcion,categoria')).sort((a: any, b: any) => (parseInt(a.id) || 0) - (parseInt(b.id) || 0));
  const ejemplos: string[] = []; const cats: any = {};
  prods.forEach((p: any) => {
    if (p.nombre && p.descripcion && ejemplos.length < 14) ejemplos.push('- ' + p.nombre + ' · ' + p.descripcion);
    if (p.categoria) cats[p.categoria.toString()] = 1;
  });
  const system = 'Sos el catalogador de "Shuk Mamtakim", almacén argentino de golosinas y productos kosher importados de Israel. ' +
    'Mirás la foto de un producto y escribís su ficha siguiendo EXACTAMENTE el estilo de estos ejemplos reales del catálogo ' +
    '(nombre corto y propio del producto; descripción breve que aclara sabor/tipo y peso o cantidad entre paréntesis si se ve):\n' +
    ejemplos.join('\n') +
    '\nCategorías existentes (elegí la que mejor calce): ' + Object.keys(cats).join(', ') +
    '\nSi el texto del envase está en hebreo, interpretalo. Si no estás seguro del peso, no lo inventes.';
  try {
    const r = await anthropicMsg(apiKey, {
      model: 'claude-opus-4-8', max_tokens: 800, system,
      output_config: { format: { type: 'json_schema', schema: {
        type: 'object',
        properties: {
          nombre: { type: 'string', description: 'Nombre corto del producto, como en los ejemplos' },
          desc: { type: 'string', description: 'Descripción breve estilo catálogo, con peso/cantidad entre paréntesis si es visible' },
          categoria: { type: 'string', description: 'Una de las categorías existentes' },
        },
        required: ['nombre', 'desc', 'categoria'], additionalProperties: false,
      } } },
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'url', url } },
        { type: 'text', text: 'Generá la ficha de este producto.' },
      ] }],
    });
    if (r.code !== 200) return { error: 'IA error ' + r.code + (r.body.error ? ': ' + r.body.error.message : '') };
    const t = JSON.parse(r.texto);
    return { ok: true, nombre: t.nombre || '', desc: t.desc || '', categoria: t.categoria || '' };
  } catch (err) { return { error: 'análisis: ' + err }; }
}

// ✨ FICHAS QUE VENDEN (v4.87). Para un producto que la gente mira y no pone en el carrito (o que
// no tiene descripción), la IA mira su foto y propone descripción, nombre (solo si el actual no dice
// qué es) y una idea para la foto. No se aplica nada solo: Jony aprueba cada cambio en el panel.
// El pedido se arma aparte de la llamada para poder probarlo.
const FICHA_IA_SCHEMA = {
  type: 'object',
  properties: {
    desc: { type: 'string', description: 'La descripción propuesta, en el estilo de las fichas del catálogo' },
    nombre: { type: 'string', description: 'El nombre propuesto; el mismo que el actual si no hace falta cambiarlo' },
    cambiarNombre: { type: 'boolean', description: 'true solo si el nombre actual no dice qué es el producto' },
    foto: { type: 'string', description: 'Una sola idea concreta para mejorar la foto' },
    porque: { type: 'string', description: 'En una frase, por qué la ficha actual no ayuda a comprarlo' },
  },
  required: ['desc', 'nombre', 'cambiarNombre', 'foto', 'porque'], additionalProperties: false,
};
function pedidoFichaIA(p: any, ejemplos: string[], contexto: string, fotoUrl: string) {
  const system = 'Escribís las fichas de la tienda online de «Shuk Mamtakim», un almacén de Buenos Aires que vende ' +
    'golosinas y productos kosher importados de Israel. Te paso un producto que la gente mira y no pone en el carrito, ' +
    'o que no tiene descripción. Proponé una ficha que ayude a decidir la compra.\n\n' +
    'Así son las fichas reales del catálogo (nombre · descripción):\n' + ejemplos.join('\n') + '\n\n' +
    'Reglas:\n' +
    '- La descripción sigue ese estilo: una o dos frases cortas que dicen qué es, el sabor o el tipo, y el peso o la cantidad entre paréntesis si se ve en el envase.\n' +
    '- Nada inventado: ni pesos, ni ingredientes, ni certificación kosher, ni origen que no estén en la foto o en los datos. Si algo no se ve, no va.\n' +
    '- Sin frases de publicidad vacías («el mejor», «irresistible»), sin signos de exclamación y sin emojis.\n' +
    '- El nombre se cambia solo si el actual no dice qué es el producto (una marca sola, una palabra genérica o un código). Si está bien, devolvé el mismo y cambiarNombre en false.\n' +
    '- foto: una sola idea concreta que se pueda hacer con un celular (el producto abierto, el tamaño al lado de una mano, el envase de frente y sin reflejos).\n' +
    '- porque: una sola frase con la razón más probable por la que la ficha actual no ayuda a comprarlo.\n' +
    '- Escribí en castellano rioplatense, como la tienda.';
  const kosher = [p.hashgaja, p.kosher_tipo].map((x: any) => String(x || '').trim()).filter(Boolean).join(' · ');
  const texto = 'Producto: ' + String(p.nombre || '') +
    '\nDescripción actual: ' + (String(p.descripcion || '').trim() || '(no tiene)') +
    '\nCategoría: ' + String(p.categoria || 'Varios') +
    ((parseFloat(p.precio_min) || 0) > 0 ? '\nPrecio en la tienda: $ ' + Math.round(parseFloat(p.precio_min)).toLocaleString('es-AR') : '') +
    (kosher ? '\nKosher: ' + kosher : '') +
    '\nLo que pasa en la tienda: ' + contexto +
    (fotoUrl ? '' : '\nNo tiene foto cargada: la idea de foto es para la primera que se saque.');
  const content: any[] = [];
  if (fotoUrl) content.push({ type: 'image', source: { type: 'url', url: fotoUrl } });
  content.push({ type: 'text', text: texto });
  return {
    model: 'claude-opus-5', max_tokens: 4000, fallbacks: 'default',
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: FICHA_IA_SCHEMA } },
    system, messages: [{ role: 'user', content }],
  };
}
// La foto que ve la IA: la primera que no sea video, a 800 px y en JPG (formato que la API lee siempre).
function fotoParaIA(imagen: any) {
  const u = fotosShukLista(imagen)[0] || '';
  return u.indexOf('res.cloudinary.com') !== -1 && u.indexOf('/image/upload/') !== -1 ? u.replace('/image/upload/', '/image/upload/w_800,f_jpg,q_auto/') : u;
}
async function sugerirFicha(id: string, motivo: string, personas: number) {
  const apiKey = await claveIA();
  if (!apiKey) return { error: 'sin_clave', mensaje: 'Falta la clave de IA (se carga desde la card Preguntale a tu negocio).' };
  const prods = await sbGet('productos', 'select=id,nombre,descripcion,categoria,imagen,precio_min,hashgaja,kosher_tipo,activo&order=id');
  const p = prods.find((x: any) => String(x.id) === String(id));
  if (!p) return { error: 'producto no encontrado' };
  // Ejemplos de estilo: fichas con descripción, primero de la misma categoría.
  const conDesc = prods.filter((x: any) => x.activo !== false && String(x.id) !== String(id) && x.nombre && String(x.descripcion || '').trim());
  const misma = conDesc.filter((x: any) => (x.categoria || '') === (p.categoria || '')).slice(0, 8);
  const otras = conDesc.filter((x: any) => (x.categoria || '') !== (p.categoria || '')).slice(0, 14 - misma.length);
  const ejemplos = misma.concat(otras).map((x: any) => '- ' + x.nombre + ' · ' + x.descripcion);
  const contexto = motivo === 'sin-desc' ? 'No tiene descripción.'
    : personas > 0 ? 'La vieron ' + personas + ' personas en el último mes y nadie la puso en el carrito.'
    : 'La miran y no la ponen en el carrito.';
  try {
    const r = await anthropicMsg(apiKey, pedidoFichaIA(p, ejemplos, contexto, fotoParaIA(p.imagen)), ['server-side-fallback-2026-07-01']);
    if (r.code !== 200) return { error: 'IA error ' + r.code + (r.body.error ? ': ' + r.body.error.message : '') };
    if (r.body.stop_reason === 'refusal') return { error: 'La IA no quiso escribir esta ficha. Probá de nuevo o escribila a mano.' };
    const t = JSON.parse(r.texto);
    const nombreN = String(t.nombre || '').trim().slice(0, 120), descN = String(t.desc || '').trim().slice(0, 400);
    return {
      ok: true, id: String(p.id), actual: { nombre: String(p.nombre || ''), desc: String(p.descripcion || '') },
      desc: descN, nombre: nombreN, cambiarNombre: !!t.cambiarNombre && !!nombreN && nombreN !== String(p.nombre || '').trim(),
      foto: String(t.foto || '').trim().slice(0, 300), porque: String(t.porque || '').trim().slice(0, 300),
    };
  } catch (err) { return { error: 'IA: ' + err }; }
}

// ✂️ v5.04 — NOMBRE Y DESCRIPCIÓN DE UNA FRACCIÓN (pedido del usuario 24/09: "no puede decir Mix x 34 · x5, se entiende
// que son 5 bolsas de 34"). La fracción lleva el nombre del producto SIN la cantidad/peso del paquete + lo que trae ella:
// "Elite Etzbaot Mix x 34 unid" → "Elite Etzbaot Mix x 5 unidades". La IA lo escribe (sugerirFraccion) y esta regla fija
// es el respaldo (y lo que usa el panel al instante mientras la IA contesta).
function sinCantidadPaquete(t: string, mayuscula = true) {
  const r = String(t || '')
    .replace(/\(\s*\d+\s*(?:-\s*\d+\s*)?(?:unid(?:ades)?|u|paq(?:uetes)?)\.?\s*\)/gi, ' ')                 // (19-20 unid)
    .replace(/\(\s*\d+(?:[.,]\d+)?\s*(?:g|gr|grs|gramos|kg|kilo)\.?\s*\)/gi, ' ')                               // (408g)
    .replace(/\(\s*familiar\s*\)/gi, ' ')                                                                        // (familiar)
    .replace(/(?:\bpack\s*)?[x×]\s*\d+(?:[.,]\d+)?\s*(?:unid(?:ades)?\.?|u\.|paq(?:uetes)?\.?(?:\s+individuales)?|g(?:r|rs)?\.?|gramos|kg)?(?=[\s.,;·)]|$)/gi, ' ')   // x 34 unid · x16 · x 100 grs. · Pack x 4
    .replace(/\bpack\b/gi, ' ')
    .replace(/\s{2,}/g, ' ').replace(/\s+([.,;)])/g, '$1').replace(/\(\s*\)/g, '').replace(/[\s·,;:.-]+$/, '').trim();
  return r && mayuscula ? r.charAt(0).toUpperCase() + r.slice(1) : r;
}
function cantFraccionTxt(cant: number, unidad: string, corto = false) {
  if (unidad === 'g') return cant >= 1000 && cant % 1000 === 0 ? (cant / 1000) + ' kg' : cant + ' g';
  return cant + (corto ? ' unid' : (cant === 1 ? ' unidad' : ' unidades'));
}
function nombreFraccion(nombreBolsa: string, cant: number, unidad = 'u') { return (sinCantidadPaquete(nombreBolsa) || String(nombreBolsa || '').trim()) + ' x ' + cantFraccionTxt(cant, unidad); }
function descFraccion(descBolsa: string, cant: number, unidad = 'u') { const d = sinCantidadPaquete(descBolsa, false); return d ? d + ' x ' + cantFraccionTxt(cant, unidad, true) : ''; }
const FRACCION_IA_SCHEMA = {
  type: 'object',
  properties: {
    fracciones: { type: 'array', items: { type: 'object', properties: {
      cant: { type: 'integer', description: 'La cantidad de la fracción, igual a la que se pidió' },
      nombre: { type: 'string', description: 'Nombre de la fracción para la tienda' },
      desc: { type: 'string', description: 'Descripción de la fracción para la tienda' },
    }, required: ['cant', 'nombre', 'desc'], additionalProperties: false } },
  },
  required: ['fracciones'], additionalProperties: false,
};
function pedidoFraccionIA(bolsa: any, cants: number[], unidad: string) {
  const trae = unidad === 'g' ? 'una bolsita de ' + cantFraccionTxt(Math.max(1, parseFloat(bolsa.peso) || 100), 'g') : 'una bolsa de ' + Math.max(1, parseInt(bolsa.unidades_por_paquete) || 1) + ' unidades';
  const system = 'Escribís fichas para la tienda minorista de «Shuk Mamtakim», un almacén de Buenos Aires de golosinas y productos kosher importados de Israel. ' +
    'Una bolsa se vende también FRACCIONADA: de ' + trae + ' se arman bolsitas más chicas (o más grandes si es por peso). Para cada cantidad pedida, escribí el nombre y la descripción de esa fracción.\n\n' +
    'Reglas:\n' +
    '- Nombre: el nombre del producto SIN la cantidad, el peso ni el tamaño del paquete original (x 34 unid, (19-20 unid), Pack x 4, 408g, familiar, pack), y al final « x N unidades» (una sola: « x 1 unidad»)' + (unidad === 'g' ? ' — acá es POR PESO: al final « x 250 g» (1000 g = « x 1 kg»)' : '') + '.\n' +
    '- Conservá tal cual la marca, la línea, el sabor y las palabras en hebreo transliterado (no las traduzcas). Si es un surtido («Mix», «varios sabores») eso se queda.\n' +
    '- Descripción: la misma del paquete, en el mismo tono, sacando lo que para la fracción ya no es cierto (la cantidad total, el peso total, «familiar», «pack», «ideal para compartir en familia»), y terminá con « x N unid»' + (unidad === 'g' ? ' (por peso: « x 250 g»)' : '') + '. Si la bolsa no tiene descripción, dejala vacía.\n' +
    '- No inventes nada: ni sabores, ni ingredientes, ni pesos por unidad.\n\n' +
    'Ejemplo (bolsa de 34, fracción de 5): nombre «Elite Etzbaot Mix x 34 unid» → «Elite Etzbaot Mix x 5 unidades»; descripción «barra de chocolate tipo KINDER surtidos: Cream Jalav y con chispas que explotan en la boca x34 unid (408g) (familiar)» → «barra de chocolate tipo KINDER surtidos: Cream Jalav y con chispas que explotan en la boca x 5 unid».';
  const texto = 'Producto: ' + String(bolsa.nombre || '') + '\nDescripción: ' + String(bolsa.descripcion || '') + '\nCategoría: ' + String(bolsa.categoria || '') +
    '\nFracciones a escribir: ' + cants.map((c) => cantFraccionTxt(c, unidad)).join(', ');
  return {
    model: 'claude-opus-5', max_tokens: 2000, fallbacks: 'default',
    output_config: { effort: 'low', format: { type: 'json_schema', schema: FRACCION_IA_SCHEMA } },
    system, messages: [{ role: 'user', content: [{ type: 'text', text: texto }] }],
  };
}
// Lo que devuelve la IA se usa solo si viene completo y para las cantidades pedidas; si no, va la regla fija.
function limpiarFraccionIA(t: any, bolsa: any, cants: number[], unidad: string) {
  const porCant: any = {};
  (Array.isArray(t && t.fracciones) ? t.fracciones : []).forEach((f: any) => { const c = parseInt(f && f.cant) || 0; if (c && String(f.nombre || '').trim()) porCant[c] = f; });
  return cants.map((c) => {
    const f = porCant[c];
    const nombre = f ? String(f.nombre).replace(/[<>]/g, '').trim().slice(0, 120) : '';
    const desc = f ? String(f.desc || '').replace(/[<>]/g, '').trim().slice(0, 400) : '';
    return { cant: c, nombre: nombre || nombreFraccion(bolsa.nombre, c, unidad), desc: f ? desc : descFraccion(bolsa.descripcion, c, unidad), ia: !!nombre };
  });
}
async function sugerirFraccion(idBolsa: string, cantsTxt: string, unidad: string) {
  const cants = [...new Set(String(cantsTxt || '').split(',').map((x) => parseInt(x) || 0).filter((x) => x > 0 && x <= 100000))].slice(0, 12);
  if (!cants.length) return { error: 'sin cantidades' };
  const pr = await sbGet('productos', 'select=id,nombre,descripcion,categoria,unidades_por_paquete,peso&id=eq.' + encodeURIComponent(idBolsa));
  if (!pr.length) return { error: 'no encontré la bolsa' };
  const bolsa = pr[0], u = unidad === 'g' ? 'g' : 'u';
  const regla = () => ({ ok: true, fracciones: limpiarFraccionIA(null, bolsa, cants, u), ia: false });
  const apiKey = await claveIA();
  if (!apiKey) return regla();
  try {
    const r = await anthropicMsg(apiKey, pedidoFraccionIA(bolsa, cants, u), ['server-side-fallback-2026-07-01']);
    if (r.code !== 200 || r.body.stop_reason === 'refusal') return regla();
    return { ok: true, fracciones: limpiarFraccionIA(JSON.parse(r.texto), bolsa, cants, u), ia: true };
  } catch { return regla(); }
}

// ✨ PEDIDO POR MENSAJE, CON IA (v4.89). Jony pega el mensaje del cliente (o sube la foto de su lista)
// y la IA lo convierte en productos del catálogo con su cantidad. No se registra nada solo: el pedido
// cae en "Cargar pedido manual" para revisarlo y confirmarlo.
const PEDIDO_IA_SCHEMA = {
  type: 'object',
  properties: {
    items: { type: 'array', items: { type: 'object', properties: {
      id: { type: 'integer', description: 'El id del producto en el catálogo' },
      cantidad: { type: 'integer', description: 'Cuántas unidades pidió' },
      pedido: { type: 'string', description: 'Lo que escribió el cliente para este producto, tal cual' },
      dudoso: { type: 'boolean', description: 'true si no queda claro cuál de varios productos del catálogo es' },
    }, required: ['id', 'cantidad', 'pedido', 'dudoso'], additionalProperties: false } },
    noEncontrados: { type: 'array', items: { type: 'string' }, description: 'Lo que pidió y no está en el catálogo, como lo escribió' },
    cliente: { type: 'string', description: 'El nombre del cliente si aparece en el mensaje; si no, vacío' },
    nota: { type: 'string', description: 'Algo que Jony tenga que saber (una cantidad dudosa, una aclaración); vacío si no hay nada' },
  },
  required: ['items', 'noEncontrados', 'cliente', 'nota'], additionalProperties: false,
};
function pedidoMensajeIA(prods: any[], texto: string, imagen: any) {
  const catalogo = prods.map((p: any) => p.id + ' | ' + String(p.nombre || '').trim() + (String(p.descripcion || '').trim() ? ' | ' + String(p.descripcion).trim().slice(0, 70) : '') + ((parseInt(p.stock) || 0) <= 0 ? ' | SIN STOCK' : '')).join('\n');
  const system = 'Armás pedidos para el panel de «Shuk Mamtakim», un almacén de Buenos Aires de golosinas y productos kosher importados de Israel. ' +
    'Te paso el catálogo (id | nombre | detalle) y el mensaje o la foto de la lista de un cliente. Devolvé cada producto que pidió, con su id del catálogo y la cantidad.\n\n' +
    'Reglas:\n' +
    '- Usá solo ids del catálogo. Lo que no esté va en noEncontrados, escrito como lo puso el cliente.\n' +
    '- Los clientes escriben como hablan: «klik de leche» es el Klik chocolate con leche y «pitzujim de maní» es un Pitzujim de maní. Si puede ser más de un producto y no hay forma de saber cuál, elegí el más probable y marcá dudoso.\n' +
    '- Cantidades: «una docena» son 12 y «media docena» 6; si no dice cuántas, 1. Si pide cajas o paquetes y no se sabe cuántas unidades son, poné las que dijo y aclaralo en la nota.\n' +
    '- No inventes productos ni cantidades. El nombre del cliente va solo si lo dice.\n\n' +
    'CATÁLOGO:\n' + catalogo;
  const content: any[] = [];
  if (imagen) content.push({ type: 'image', source: { type: 'base64', media_type: imagen.tipo, data: imagen.data } });
  content.push({ type: 'text', text: texto ? 'MENSAJE DEL CLIENTE:\n' + texto : 'La lista del cliente está en la foto.' });
  return {
    model: 'claude-opus-5', max_tokens: 8000, fallbacks: 'default',
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: PEDIDO_IA_SCHEMA } },
    system, messages: [{ role: 'user', content }],
  };
}
// Lo que devuelve la IA pasa por el catálogo real: un id que no existe va a "no encontré", el mismo
// producto dos veces se suma, y cada renglón lleva el stock para avisar si no alcanza.
function limpiarPedidoIA(t: any, prods: any[]) {
  const porId: any = {};
  prods.forEach((p: any) => { porId[String(p.id)] = p; });
  const items: any[] = [], noEnc: string[] = [], yaEsta: any = {};
  (Array.isArray(t && t.items) ? t.items : []).forEach((it: any) => {
    const p = porId[String(it && it.id)], q = Math.max(0, Math.min(9999, parseInt(it && it.cantidad) || 0));
    if (!p) { if (it && it.pedido) noEnc.push(String(it.pedido).trim().slice(0, 80)); return; }
    if (!q) return;
    if (yaEsta[p.id]) { yaEsta[p.id].cantidad += q; return; }
    const x = { id: parseInt(p.id), nombre: String(p.nombre || ''), cantidad: q, pedido: String(it.pedido || '').trim().slice(0, 80), dudoso: !!it.dudoso, stock: parseInt(p.stock) || 0 };
    yaEsta[p.id] = x; items.push(x);
  });
  (Array.isArray(t && t.noEncontrados) ? t.noEncontrados : []).forEach((s: any) => { const v = String(s || '').trim().slice(0, 80); if (v) noEnc.push(v); });
  return { items, noEncontrados: noEnc.slice(0, 20), cliente: String((t && t.cliente) || '').trim().slice(0, 60), nota: String((t && t.nota) || '').trim().slice(0, 300) };
}
async function armarPedidoIA(texto: string, imagen: any) {
  const apiKey = await claveIA();
  if (!apiKey) return { error: 'sin_clave', mensaje: 'Falta la clave de IA (se carga desde la card Preguntale a tu negocio).' };
  const txt = String(texto || '').slice(0, 4000);
  const img = imagen && typeof imagen === 'object' && /^image\/(jpeg|png|webp|gif)$/.test(String(imagen.tipo || '')) && typeof imagen.data === 'string' && imagen.data.length < 7000000 ? { tipo: imagen.tipo, data: imagen.data } : null;
  if (!txt.trim() && !img) return { error: 'Pegá el mensaje o subí la foto de la lista.' };
  const prods = (await sbGet('productos', 'select=id,nombre,descripcion,stock,activo&order=id')).filter((p: any) => p.activo !== false);
  try {
    const r = await anthropicMsg(apiKey, pedidoMensajeIA(prods, txt, img), ['server-side-fallback-2026-07-01']);
    if (r.code !== 200) return { error: 'IA error ' + r.code + (r.body.error ? ': ' + r.body.error.message : '') };
    if (r.body.stop_reason === 'refusal') return { error: 'La IA no quiso armar este pedido. Cargalo a mano.' };
    return { ok: true, ...limpiarPedidoIA(JSON.parse(r.texto), prods) };
  } catch (err) { return { error: 'IA: ' + err }; }
}

// Error de IA que NO es culpa de la foto (saldo/rate/overload): no quema la foto.
const esErrorIATransitorio = (msg: string) => /credit|billing|too low|saldo|rate.?limit|overloaded|529|429|quota|insufficient|unavailable/i.test((msg || '').toString());

// Analiza hasta 4 fotos pendientes por corrida (la llama el panel tras subir y el cron
// horario como red). Errores transitorios de la IA NO queman la foto: queda pendiente.
async function procesarBandejaFn() {
  const rows = (await sbGet('bandeja_fotos', 'select=*&estado=eq.pendiente')).sort((a: any, b: any) => (a.id < b.id ? -1 : 1));
  let procesadas = 0, pendientes = 0;
  for (const rB of rows) {
    if (procesadas >= 4) { pendientes++; continue; }
    const res: any = await analizarFotoProducto((rB.public_id || '').toString());
    if (res.ok) {
      await sbPatch('bandeja_fotos', 'id=eq.' + encodeURIComponent(rB.id), { nombre: res.nombre, descripcion: res.desc, categoria: res.categoria, estado: 'listo' });
      procesadas++;
    } else if (res.error === 'sin_clave') {
      return { error: res.mensaje };
    } else if (esErrorIATransitorio(res.error)) {
      return { error: '⚠️ La IA no tiene saldo (créditos de Anthropic). Cargá créditos en console.anthropic.com → Plans & Billing y reintentá. Las fotos quedaron guardadas.', transitorio: true, detalle: res.error };
    } else {
      await sbPatch('bandeja_fotos', 'id=eq.' + encodeURIComponent(rB.id), { estado: 'error' });
      procesadas++;
    }
  }
  return { ok: true, procesadas, pendientes };
}

// Resumen JSON del negocio para "preguntale a tu negocio" (portado de resumenNegocio_).
async function resumenNegocio() {
  const r: any = { hoy: fechaAhora().slice(0, 10) };
  const [ventas, gastos, productos, candyVentas, candyCC, deposito, pagosJ, msC] = await Promise.all([
    sbGet('ventas', 'select=*&order=n_venta'), sbGet('gastos', 'select=*'), sbGet('productos', 'select=*'),
    sbGet('candy_ventas', 'select=*'), sbGet('candy_cc', 'select=hijo,cliente,monto'), sbGet('candy_deposito', 'select=*'),
    sbGet('pagos', 'select=*&order=id'), msUltimoCorte(),
  ]);
  // Ventas Shuk: por mes + por cliente + por producto
  const porMes: any = {}, porCliente: any = {}, porProducto: any = {};
  ventas.forEach((v: any) => {
    if ((v.estado || '') === 'cancelado') return;
    const m = (v.fecha || '').toString().match(/\d{2}\/(\d{2})\/(\d{4})/);
    const mes = m ? m[2] + '-' + m[1] : 's/f';
    if (!porMes[mes]) porMes[mes] = { pedidos: 0, ars: 0, usd: 0 };
    porMes[mes].pedidos++; porMes[mes].ars += parseFloat(v.total_ars) || 0; porMes[mes].usd += parseFloat(v.total_usd) || 0;
    const cli = (v.cliente || '').toString();
    if (cli) {
      if (!porCliente[cli]) porCliente[cli] = { pedidos: 0, ars: 0, usd: 0, tipo: v.tipo, ultima: v.fecha, pendientes: 0 };
      porCliente[cli].pedidos++; porCliente[cli].ars += parseFloat(v.total_ars) || 0; porCliente[cli].usd += parseFloat(v.total_usd) || 0;
      porCliente[cli].ultima = v.fecha;
      if ((v.estado || '') === 'pendiente') porCliente[cli].pendientes++;
    }
    (v.productos || '').toString().split('||').forEach((seg: string) => {
      const pm = seg.match(/(\d+)\s*x\s*([^—]+)/);
      if (pm) {
        const nom = pm[2].replace(/^[•\s]+/, '').trim();
        if (nom) {
          if (!porProducto[nom]) porProducto[nom] = { unidades: 0, pedidos: 0 };
          porProducto[nom].unidades += parseInt(pm[1]) || 0;
          porProducto[nom].pedidos++;
        }
      }
    });
  });
  r.ventasShukPorMes = porMes;
  r.clientesShukTop = Object.entries(porCliente).sort((a: any, b: any) => b[1].ars - a[1].ars).slice(0, 30)
    .map((e: any) => ({ nombre: e[0], pedidos: e[1].pedidos, totalARS: Math.round(e[1].ars), totalUSD: Math.round(e[1].usd * 100) / 100, tipo: e[1].tipo, ultimaCompra: e[1].ultima, pedidosPendientes: e[1].pendientes }));
  r.productosShukTop = Object.entries(porProducto).sort((a: any, b: any) => b[1].unidades - a[1].unidades).slice(0, 30)
    .map((e: any) => ({ producto: e[0], unidadesVendidas: e[1].unidades, apareceEnPedidos: e[1].pedidos }));
  // Gastos por mes
  const gm: any = {};
  gastos.forEach((g: any) => {
    const m = (g.fecha || '').toString().match(/\d{2}\/(\d{2})\/(\d{4})/);
    const mes = m ? m[2] + '-' + m[1] : 's/f';
    gm[mes] = (gm[mes] || 0) + (parseFloat(g.monto) || 0);
  });
  r.gastosShukPorMes = gm;
  // Stock actual (solo activos)
  r.stockShuk = productos.filter((p: any) => p.nombre && p.activo !== false)
    .map((p: any) => ({ nombre: p.nombre.toString() + (p.descripcion ? ' · ' + p.descripcion.toString() : ''), stock: parseInt(p.stock) || 0, precioMay: (p.precio_may ?? '').toString(), precioMin: (p.precio_min ?? '').toString() }));
  // Ganancias Jony EN VIVO (comisión + Pitzujim del período), consistente con el panel
  const perJ = calcularGanancias(ventas, productos, pagosJ, msC);
  r.gananciasJonyAcumulado = Math.round(perJ.comisionARS + perJ.pitzARS);
  // Candy: ventas por mes/hijo + productos top + deudores + depósito
  const vh: any = {}, prodH: any = {};
  candyVentas.forEach((row: any) => {
    const f = (row.fecha || '').toString().substring(3, 10).split('/').reverse().join('-');
    const k = row.hijo + ' ' + f;
    if (!vh[k]) vh[k] = { ventas: 0, total: 0 };
    vh[k].ventas++; vh[k].total += parseFloat(row.total) || 0;
    const prod = (row.producto || '').toString();
    if (prod) prodH[prod] = (prodH[prod] || 0) + (parseInt(row.cantidad) || 1);
  });
  r.candyVentasPorMes = vh;
  r.candyProductosTop = Object.entries(prodH).sort((a: any, b: any) => b[1] - a[1]).slice(0, 20)
    .map((e: any) => ({ producto: e[0], unidadesVendidas: e[1] }));
  const deudoresDe = (hijo: string) => {
    const saldos: any = {};
    candyCC.forEach((c: any) => { if (c.hijo !== hijo || !c.cliente) return; const k = normCli(c.cliente); if (!saldos[k]) saldos[k] = { cliente: c.cliente, saldo: 0 }; saldos[k].saldo += parseFloat(c.monto) || 0; });
    return Object.values(saldos).filter((x: any) => Math.abs(x.saldo) > 0.01).sort((a: any, b: any) => Math.abs(b.saldo) - Math.abs(a.saldo));
  };
  r.candyDeudores = { Meir: deudoresDe('Meir'), Iosi: deudoresDe('Iosi') };
  r.candyDeposito = deposito.map((d: any) => ({ codigo: d.codigo, producto: d.nombre || '', cantidad: parseInt(d.cantidad) || 0 })).filter((d: any) => d.cantidad > 0);
  return JSON.stringify(r);
}

// ═══ CEREBRO DEL BOT (SMS/voz) — portado 1:1 del bloque bot* de motor-v2.js ═══
const botMiles = (n: number) => Math.round(n || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const botMoney = (n: number) => '$ ' + botMiles(n);
const botCorto = (t: any, n: number) => { t = (t || '').toString(); return t.length > n ? t.substring(0, n - 1) + '…' : t; };
const normTxt = (s: any) => (s || '').toString().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

// Telegram vía el worker del bot (tiene el token TG como secret). Best-effort.
async function relayTelegram(dest: string, texto: string) {
  try { await fetch(WORKER_RELAY_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ relay: true, secret: BOT_SECRET, dest, text: texto }) }); } catch { /**/ }
}
async function claveOpenAI() { return (await getConfig('OPENAI_API_KEY', '')) || Deno.env.get('OPENAI_API_KEY') || ''; }
// Texto → voz natural (OpenAI TTS). Devuelve base64 del mp3, o null si falla.
async function ttsOpenAI(texto: string) {
  const key = await claveOpenAI();
  if (!key || !texto) return null;
  try {
    const res = await fetch('https://api.openai.com/v1/audio/speech', { method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'tts-1', voice: 'onyx', input: texto.substring(0, 500), response_format: 'mp3', speed: 1.05 }) });
    if (res.status !== 200) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    let bin = ''; const CH = 0x8000;
    for (let i = 0; i < buf.length; i += CH) bin += String.fromCharCode(...buf.subarray(i, i + CH));
    return btoa(bin);
  } catch { return null; }
}
// Costo promedio de un producto de Shuk (compras CostosJony; fallback costo manual col 30).
async function costoPromedioShuk(pid: string) {
  const compras = await sbGet('costos_jony', 'select=cantidad,costo_total&producto_id=eq.' + encodeURIComponent(pid));
  let u = 0, t = 0;
  compras.forEach((c: any) => { u += parseFloat(c.cantidad) || 0; t += parseFloat(c.costo_total) || 0; });
  if (u > 0) return t / u;
  const pr = await sbGet('productos', 'select=costo&id=eq.' + encodeURIComponent(pid));
  return pr.length ? (parseFloat(String(pr[0].costo || '0').replace(',', '.')) || 0) : 0;
}
// Inserta una venta con numeración atómica (índice único n_venta + reintento).
async function insertarVentaAtomica(fila: any): Promise<{ nVenta: number; id: string } | { error: string }> {
  for (let intento = 0; intento < 4; intento++) {
    const top = await sbGet('ventas', 'select=n_venta&order=n_venta.desc&limit=1');
    fila.id = 'P' + Date.now();
    fila.n_venta = (top.length ? parseInt(top[0].n_venta) || 0 : 0) + 1;
    const r = await fetch(SB_URL + '/rest/v1/ventas', { method: 'POST', headers: { apikey: SERVICE, Authorization: 'Bearer ' + SERVICE, 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify(fila) });
    if (r.ok) return { nVenta: fila.n_venta, id: fila.id };
    if (r.status !== 409) return { error: 'insert venta ' + r.status + ' ' + (await r.text()).slice(0, 150) };
    await new Promise((res) => setTimeout(res, 120 * (intento + 1)));
  }
  return { error: 'no pude asignar número de venta — reintentá' };
}
// Productos que un minorista puede pedir por el bot.
async function botLeerProductos() {
  return (await sbGet('productos', 'select=*')).sort((a: any, b: any) => (parseInt(a.id) || 0) - (parseInt(b.id) || 0)).filter((p: any) => {
    const vis = (p.visible_cat || 'Ambos').toString().trim();
    const stk = parseInt(p.stock) || 0;
    if (p.activo === false || vis === 'Oculto' || stk <= 0) return false;
    return vis === 'Ambos' || vis === 'Minorista';
  }).map((p: any) => ({ id: p.id.toString(), nombre: (p.nombre || '').toString(), desc: (p.descripcion || '').toString(), precioMin: parseFloat(p.precio_min) || 0, stock: parseInt(p.stock) || 0, categoria: (p.categoria || 'Varios').toString(),
    precio_min: p.precio_min, precio_oferta: p.precio_oferta, fecha_oferta: p.fecha_oferta, cant_pack: p.cant_pack, precio_pack: p.precio_pack,   // 🏷️ v5.02: el bot cobra ofertas y packs
    dueno: (p.dueno || 'Miri').toString(), moneda: ((p.moneda || '$').toString() === 'U$S') ? 'U$S' : '$', descBot: (p.desc_bot || '').toString() }));
}
// ══════════════════════════════════════════════════════════════════════════════
//  🤖🏷️ EL BOT CON OFERTAS (v5.02). Hasta acá el bot cobraba SIEMPRE el precio de lista: la oferta que se veía
//  en la tienda no existía por WhatsApp/SMS/teléfono. Ahora el bot usa la MISMA cuenta que la tienda
//  (precioMinoristaHoy) para todo: la lista del menú, el carrito, el total y el pedido que entra al panel. Y las
//  muestra: precio rebajado con 🔥 y el de antes, el pack, y una categoría "🔥 Ofertas" arriba de todo.
// ══════════════════════════════════════════════════════════════════════════════
const CAT_OFERTAS = '🔥 Ofertas';
const precioBot = (p: any, qty: number) => precioMinoristaHoy(p, qty, _hoyISO_AR());
function botPackActivo(p: any) {
  const cp = parseInt(p.cant_pack) || 0, pp = parseFloat(p.precio_pack) || 0;
  return cp > 1 && pp > 0 && Math.round(pp) < precioBot(p, 1) ? { cant: cp, precio: Math.round(pp) } : null;
}
const botEnOferta = (p: any) => precioBot(p, 1) < Math.round(p.precioMin || 0) || !!botPackActivo(p);
function botEtiquetaPrecio(p: any) {
  const u1 = precioBot(p, 1), lista = Math.round(p.precioMin || 0);
  let t = botMoney(u1);
  if (u1 < lista) t += ' 🔥 (antes ' + botMoney(lista) + ')';
  const pk = botPackActivo(p);
  if (pk) t += ' · llevando ' + pk.cant + ' o más: ' + botMoney(pk.precio) + ' c/u';
  return t;
}
function botCategorias(prods: any[]) {
  const orden = ['Pitzujim', 'Chocolate', 'Caramelo', 'Chupetín', 'Pastilla', 'Yumi', 'Varios'];
  const cats: string[] = [];
  prods.forEach((p) => { if (cats.indexOf(p.categoria) === -1) cats.push(p.categoria); });
  cats.sort((a, b) => { const ia = orden.indexOf(a), ib = orden.indexOf(b); return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib); });
  if (prods.some(botEnOferta)) cats.unshift(CAT_OFERTAS);   // lo primero que ve: lo que está más barato hoy
  return cats;
}
// Estado de la conversación por teléfono (carrito + nombre + historial), tabla bot_sesiones.
async function botSesion(tel: string) {
  const rows = await sbGet('bot_sesiones', 'select=*&telefono=eq.' + encodeURIComponent(tel));
  let carrito: any = {}, hist: any[] = [], nombre = '';
  if (rows.length) {
    try { carrito = JSON.parse(rows[0].carrito || '{}'); } catch { /**/ }
    try { hist = JSON.parse(rows[0].historial || '[]'); } catch { /**/ }
    nombre = (rows[0].nombre || '').toString();
  } else {
    await sbInsert('bot_sesiones', { telefono: tel, carrito: '{}', ultima_actividad: fechaAhora(), nombre: '', historial: '[]' });
  }
  return { telefono: tel, carrito, nombre, historial: hist };
}
async function botGuardarSesion(s: any) {
  const patch: any = { carrito: JSON.stringify(s.carrito), ultima_actividad: fechaAhora() };
  if (s.nombre) patch.nombre = s.nombre;
  if (s.historial) patch.historial = JSON.stringify(s.historial.slice(-6));
  await sbPatch('bot_sesiones', 'telefono=eq.' + encodeURIComponent(s.telefono), patch);
}
function botMenuCategorias(prods: any[]) {
  if (!prods.length) return 'Por ahora no hay productos disponibles. Probá más tarde. 🍬';
  const cats = botCategorias(prods);
  let s = '🍬 Shuk Mamtakim - Hola! Que buscas?\n\n';
  cats.forEach((c, i) => { s += (i + 1) + '- ' + c + '\n'; });
  s += '\nMandá el numero de la categoria.\nO LISTO cuando termines.';
  return s;
}
function botListarCategoria(prods: any[], cat: string) {
  const items = cat === CAT_OFERTAS ? prods.filter(botEnOferta) : prods.filter((p) => p.categoria === cat);
  if (!items.length) return 'No hay productos en esa categoria ahora. Mandá LISTA.';
  let s = cat.toUpperCase() + ':\n\n';
  items.forEach((p) => { s += p.id + '- ' + p.nombre + (p.desc ? ' ' + botCorto(p.desc, 20) : '') + '  ' + botEtiquetaPrecio(p) + '\n'; });
  const ej2 = items[1] ? ', ' + items[1].id + 'x1' : '';
  s += '\nMandá: codigo x cantidad (ej: ' + items[0].id + 'x2' + ej2 + ')\nPodés pedir varios separados por coma.\nVER tu pedido · LISTO para cerrar';
  return s;
}
const botNombreItem = (p: any) => p.desc ? p.nombre + ' ' + botCorto(p.desc, 22) : p.nombre;
async function botAgregar(s: any, prods: any[], codigo: string, qty: number) {
  const p = prods.find((x) => x.id === codigo);
  if (!p) return 'No encontré el codigo ' + codigo + '. Mandá LISTA para ver los codigos.';
  if (qty < 1) qty = 1;
  const ya = s.carrito[codigo] || 0;
  if (ya + qty > p.stock) return 'De ' + botNombreItem(p) + ' quedan ' + p.stock + '. Probá una cantidad menor.';
  s.carrito[codigo] = ya + qty;
  await botGuardarSesion(s);
  const qt = s.carrito[codigo], pk = botPackActivo(p);
  const extra = pk && qt >= pk.cant ? ' 🔥 (precio de pack)' : (pk ? '\n💡 Llevando ' + pk.cant + ' o más, cada uno sale ' + botMoney(pk.precio) + '.' : '');
  return '✓ ' + qt + 'x ' + botNombreItem(p) + ' = ' + botMoney(precioBot(p, qt) * qt) + extra + '\n\nSegui pidiendo, VER tu pedido, o LISTO para cerrar.';
}
function botParsearItems(raw: string) {
  const partes = (raw || '').split(/\s*[,;\n]\s*|\s+y\s+/i).map((t) => t.trim()).filter(Boolean);
  if (!partes.length) return null;
  const items: any[] = [];
  for (const parte of partes) {
    const m = parte.match(/^(\d{1,4})\s*[xX*\s]\s*(\d{1,3})$/);
    if (!m) return null;
    items.push({ codigo: m[1], qty: parseInt(m[2], 10) });
  }
  return items;
}
async function botAgregarVarios(s: any, prods: any[], items: any[]) {
  if (items.length === 1) return botAgregar(s, prods, items[0].codigo, items[0].qty);
  const oks: string[] = [], errs: string[] = [];
  items.forEach((it) => {
    const p = prods.find((x) => x.id === it.codigo);
    if (!p) { errs.push('codigo ' + it.codigo + ' no existe'); return; }
    const qty = it.qty < 1 ? 1 : it.qty;
    const ya = s.carrito[it.codigo] || 0;
    if (ya + qty > p.stock) { errs.push('de ' + botNombreItem(p) + ' solo quedan ' + p.stock); return; }
    s.carrito[it.codigo] = ya + qty;
    oks.push(qty + 'x ' + botNombreItem(p));
  });
  await botGuardarSesion(s);
  let r = '';
  if (oks.length) r += '✓ Agregué:\n' + oks.map((o) => '• ' + o).join('\n') + '\n';
  if (errs.length) r += (oks.length ? '\n' : '') + '⚠️ No pude:\n' + errs.map((e) => '• ' + e).join('\n') + '\n';
  r += '\nSegui pidiendo, VER tu pedido, o LISTO para cerrar.';
  return r;
}
function botVerCarrito(prods: any[], carrito: any) {
  const ids = Object.keys(carrito).filter((k) => carrito[k] > 0);
  if (!ids.length) return 'Tu pedido esta vacio. Mandá LISTA para ver los productos. 🛒';
  let s = 'TU PEDIDO:\n\n', total = 0;
  ids.forEach((id) => {
    const p = prods.find((x) => x.id === id);
    if (!p) return;
    const sub = precioBot(p, carrito[id]) * carrito[id]; total += sub;
    s += carrito[id] + 'x ' + botNombreItem(p) + ' = ' + botMoney(sub) + (precioBot(p, carrito[id]) < Math.round(p.precioMin || 0) ? ' 🔥' : '') + '\n';
  });
  s += '\nTOTAL: ' + botMoney(total) + '\n\nLISTO para confirmar · BORRAR para vaciar';
  return s;
}
const botAyuda = () => 'Shuk Mamtakim - Como pedir:\n\n• LISTA = ver categorias\n• numero = ver esa categoria\n• codigo x cantidad (ej 12x2) = agregar\n• VER = tu pedido\n• LISTO = confirmar\n• BORRAR = empezar de nuevo';
// Últimos pedidos de un teléfono (memoria del cliente entre llamadas).
async function botPedidosPrevios(tel: string) {
  const rows = await sbGet('ventas', 'select=fecha,productos,estado&vid=eq.' + encodeURIComponent('sms_' + tel) + '&order=n_venta.desc&limit=10');
  return rows.filter((v: any) => (v.estado || '').toString() !== 'cancelado').slice(0, 3)
    .map((v: any) => ({ fecha: (v.fecha || '').toString().substring(0, 10), productos: (v.productos || '').toString() }));
}
// Cierra el pedido del bot: venta + stock + ganancia pitzujim + aviso. sim=true NO toca nada.
async function botConfirmar(s: any, prods: any[], tel: string, sim: boolean) {
  const carrito = s.carrito;
  const ids = Object.keys(carrito).filter((k) => carrito[k] > 0);
  if (!ids.length) return 'Tu pedido esta vacio. Mandá LISTA para empezar. 🛒';
  const lineas: string[] = [], suArr: string[] = [], jonyArr: string[] = [];
  let total = 0;
  ids.forEach((id) => {
    const p = prods.find((x) => x.id === id);
    if (!p) return;
    const qty = carrito[id], unit = precioBot(p, qty), sub = unit * qty;
    total += sub;
    lineas.push('• ' + qty + 'x ' + p.nombre + (p.desc ? ' · ' + p.desc : '') + ' — $ ' + botMiles(unit) + ' c/u = $ ' + botMiles(sub));
    suArr.push(id + ':' + qty);
    if (p.dueno === 'Jony') jonyArr.push(id + ':' + qty + ':' + unit);   // la ganancia se mide con lo que se cobra
  });
  if (!lineas.length) return 'Hubo un problema con tu pedido. Mandá LISTA y probá de nuevo.';
  if (sim) {
    s.carrito = {}; await botGuardarSesion(s);
    return '✅ (PRUEBA) Pedido tomado! Total ' + botMoney(total) + '.\nEn la realidad acá se cargaria el pedido y se descontaria el stock.\nNada se modificó porque es una simulación. 🧪';
  }
  const cliente = s.nombre ? s.nombre : ('SMS ' + tel);
  const stockUpdates = suArr.join(',');
  const ins = await insertarVentaAtomica({ fecha: fechaAhora(), cliente, tipo: 'Minorista', productos: lineas.join('\n'), forma_pago: 'A coordinar', notas: '📱 Pedido por SMS', estado: 'pendiente', total_ars: total, total_usd: 0, ars_jony: 0, ars_myri: 0, usd_myri: 0, comi_ars: 0, comi_usd: 0, caja_jony: '', caja_myri: '', tipo_cambio: 0, stock_updates: stockUpdates, usd_jony: 0, vid: 'sms_' + tel });
  if ('error' in ins) return 'Hubo un problema al cargar tu pedido. Probá de nuevo en un ratito.';
  const nVenta = ins.nVenta;
  for (const u of suArr) { const pp = u.split(':'); await moverStockShuk(pp[0], -(parseInt(pp[1]) || 0), 'Venta SMS #' + nVenta + ' — ' + cliente); }
  if (jonyArr.length) {
    let g = 0;
    for (const it of jonyArr) { const pp = it.split(':'); const avg = await costoPromedioShuk(pp[0]); if (avg > 0) g += (parseFloat(pp[2]) - avg) * (parseFloat(pp[1]) || 0); }
    if (g > 0) await sbInsert('ganancias_jony', { fecha: fechaAhora(), tipo: 'ganancia_pitzujim', descripcion: 'Pitzujim — ' + cliente, monto: Math.round(g) });
  }
  await relayTelegram('papa', '📱 NUEVO PEDIDO POR SMS #' + nVenta + '\n👤 ' + cliente + ' (' + tel + ')\n\n' + lineas.join('\n') + '\n\nTotal: $ ' + botMiles(total) + '\nCoordiná entrega y cobro desde el panel.');
  s.carrito = {};
  await botGuardarSesion(s);
  return '✅ Pedido tomado' + (s.nombre ? ', ' + s.nombre : '') + '! Total ' + botMoney(total) + '.\nTe contactamos para coordinar la entrega. Gracias! 🍬';
}
// Punto de entrada del cerebro de comandos (LISTA/VER/LISTO/códigos).
async function procesarMensajeBot(tel: string, texto: string, sim: boolean) {
  tel = (tel || '').toString().trim();
  if (!tel) return { reply: 'Error: sin numero de origen.' };
  const s = await botSesion(tel);
  const prods = await botLeerProductos();
  const raw = (texto || '').trim();
  const T = raw.toUpperCase();
  if (T === '' || ['HOLA', 'LISTA', 'MENU', 'MENÚ', 'INICIO', 'EMPEZAR', 'BUENAS', 'BUENAS!', 'HI'].indexOf(T) !== -1) return { reply: botMenuCategorias(prods), nVenta: 0 };
  if (['AYUDA', 'HELP', '?'].indexOf(T) !== -1) return { reply: botAyuda() };
  if (['BORRAR', 'VACIAR', 'CANCELAR', 'RESET'].indexOf(T) !== -1) { s.carrito = {}; await botGuardarSesion(s); return { reply: 'Listo, vacié tu pedido. Mandá LISTA para empezar de nuevo. 🗑️' }; }
  if (['VER', 'CARRITO', 'PEDIDO'].indexOf(T) !== -1) return { reply: botVerCarrito(prods, s.carrito) };
  if (['LISTO', 'FIN', 'CONFIRMAR', 'TERMINAR', 'PAGAR', 'ENVIAR'].indexOf(T) !== -1) return { reply: await botConfirmar(s, prods, tel, sim), cerrado: true };
  const items = botParsearItems(raw);
  if (items && items.length) return { reply: await botAgregarVarios(s, prods, items) };
  const solo = raw.match(/^\s*(\d{1,4})\s*$/);
  if (solo) {
    const esProd = prods.find((p) => p.id === solo[1]);
    if (esProd) return { reply: await botAgregar(s, prods, solo[1], 1) };
    const cats = botCategorias(prods);
    const n = parseInt(solo[1], 10);
    if (n >= 1 && n <= cats.length) return { reply: botListarCategoria(prods, cats[n - 1]) };
  }
  return { reply: 'No te entendí 🤔 Mandá:\n• LISTA (ver productos)\n• codigo y cantidad (ej ' + (prods[0] ? prods[0].id + 'x2' : '12x2') + ')\n• VER (tu pedido) · LISTO (cerrar)' };
}
// Busca el producto que mejor matchea un nombre o código que dijo Shuki.
function matchProductoVoz(prods: any[], key: string) {
  key = (key || '').toString().trim();
  if (!key) return null;
  const byId = prods.find((p) => p.id === key);
  if (byId) return byId;
  const q = normTxt(key); if (!q) return null;
  const qWords = q.split(' ').filter((w) => w.length > 2);
  let best = null, bestScore = 0;
  prods.forEach((p) => {
    const hay = normTxt(p.nombre + ' ' + (p.desc || ''));
    let score = 0;
    qWords.forEach((w) => { if (hay.indexOf(w) !== -1) score++; });
    if (score > bestScore) { bestScore = score; best = p; }
  });
  return bestScore >= 1 ? best : null;
}
// Shuki conversacional (Claude): entiende lenguaje natural, arma el pedido y cierra.
async function procesarVozIA(tel: string, texto: string, sim: boolean, canal: string) {
  tel = (tel || '').toString().trim();
  if (!tel) return { reply: 'No te escuché bien, ¿me repetís?' };
  const esVoz = canal === 'voz';
  const apiKey = await claveIA();
  if (!apiKey) return { reply: 'Disculpá, ahora no puedo atenderte. Probá más tarde.', error: 'sin_clave' };
  const s = await botSesion(tel);
  if ((texto || '').trim() === '__reset__') { s.carrito = {}; s.historial = []; s.nombre = ''; await botGuardarSesion(s); return { reply: 'ok' }; }
  const prods = await botLeerProductos();
  if (!prods.length) return { reply: 'Perdoná, ahora mismo no tengo productos disponibles. Llamá más tarde así te atiendo.' };
  const cat = prods.map((p) => {
    const u1 = precioBot(p, 1), lista = Math.round(p.precioMin || 0), pk = botPackActivo(p);
    const precioTxt = u1 + ' pesos' + (u1 < lista ? ' (OFERTA, antes ' + lista + ')' : '') + (pk ? ' | PACK: llevando ' + pk.cant + ' o más, ' + pk.precio + ' pesos c/u' : '');
    return p.id + ' | ' + p.nombre + (p.desc ? ' ' + p.desc : '') + ' | ' + precioTxt + ' | stock ' + p.stock + (p.descBot ? ' | DESC: ' + p.descBot : '');
  }).join('\n');
  const previos = await botPedidosPrevios(tel);
  let perfil = '';
  if (s.nombre) perfil += 'El cliente se llama ' + s.nombre + '. ';
  if (previos.length) perfil += 'Ya compró antes con nosotros. Sus últimos pedidos:\n' + previos.map((pp: any) => '- ' + pp.fecha + ': ' + pp.productos.replace(/\n/g, '; ')).join('\n');
  if (!perfil) perfil = 'Cliente nuevo o sin datos previos.';
  const histTxt = (s.historial || []).slice(-6).map((t: any) => (t.r === 'a' ? 'Shuki' : 'Cliente') + ': ' + t.t).join('\n');
  const ids = Object.keys(s.carrito).filter((k) => s.carrito[k] > 0);
  let carritoTxt = '(vacío)', total = 0;
  if (ids.length) {
    const ls: string[] = [];
    ids.forEach((id) => {
      const p = prods.find((x) => x.id === id); if (!p) return;
      const sub = precioBot(p, s.carrito[id]) * s.carrito[id]; total += sub;
      ls.push(s.carrito[id] + 'x ' + p.nombre + (p.desc ? ' ' + p.desc : '') + ' = ' + Math.round(sub) + ' pesos');
    });
    carritoTxt = ls.join('\n') + '\nTOTAL: ' + Math.round(total) + ' pesos';
  }
  const system =
    'Sos Shuki, el vendedor telefónico de Shuk Mamtakim, un negocio familiar argentino de golosinas y frutos secos kosher. ' +
    'Atendés a un cliente por TELÉFONO. Hablás español RIOPLATENSE de Buenos Aires, cálido, cercano y BREVE (es una llamada: frases cortas, ' +
    'naturales, una idea por vez). Sos buena onda como un vendedor de barrio que conoce a su gente.\n' +
    '⚠️ ACENTO: hablá SOLO como argentino/porteño. Usá voseo ("vos", "tenés", "querés"). PROHIBIDO usar mexicanismos ' +
    'u otros regionalismos: NUNCA digas "te late", "órale", "qué onda", "ahorita", "platicar", "chido", "padre", "antojar". ' +
    'En lugar de "¿cuál te late?" decí "¿cuál te gusta?", "¿cuál llevás?" o "¿cuál te tienta?". Sonás 100% argentino.\n' +
    'Te paso el CATÁLOGO (codigo | producto | precio | stock) y el CARRITO actual del cliente. El cliente te habla normal.\n' +
    '⚠️ MONEDA: TODOS los precios están en PESOS ARGENTINOS. NUNCA hables de dólares ni de "U$S". Decí "pesos" o "$".\n' +
    'Tu trabajo: ayudarlo a armar el pedido y cerrarlo.\n' +
    'REGLAS:\n' +
    '- Identificá el producto por su nombre aunque lo diga informal ("maní grill", "los chocolates blancos").\n' +
    '- Si es ambiguo o no está, preguntá con amabilidad cuál es.\n' +
    '- Si el cliente pregunta cómo es un producto, describilo corto y apetitoso. Si en el catálogo el producto ' +
    'trae "DESC:", usá ESA descripción (es la oficial del negocio). Si no la trae, describí con lo que sabés de ' +
    'esa golosina/marca, sin inventar ingredientes ni datos que no podés saber.\n' +
    '- Respetá el stock. Si no alcanza, decíselo con tacto.\n' +
    '- Nunca digas códigos en voz alta (el cliente no los ve): hablá con los nombres.\n' +
    '- PERFIL DEL CLIENTE: si ya lo conocés por su nombre, saludalo por su nombre con cariño. Si compró antes, ' +
    'podés referirte a eso con naturalidad ("¿te llevo las pecan Lotus como la otra vez?"). No seas invasivo.\n' +
    '- ⚠️ NO repitas el nombre del cliente en cada frase: queda pesado y artificial. Usalo SOLO al saludar al ' +
    'principio y, como mucho, al cerrar el pedido. En el medio de la charla hablale normal, SIN nombrarlo.\n' +
    '- Si el cliente te dice su nombre, anotalo en nombre_cliente. Si te CORRIGE el nombre o aclara que es otra ' +
    'persona ("no soy X, soy Y"), creele y usá SIEMPRE el último nombre que te dio. Nunca vuelvas a un nombre viejo.\n' +
    '- Cuando el cliente diga que terminó, repetí el pedido y el total y pedí confirmación. Si confirma, cerrá.\n' +
    '- No inventes productos ni precios: usá SOLO el catálogo.\n' +
    '- Los precios del catálogo YA son los de hoy. Si dice OFERTA, ése es el precio que se cobra (podés contar que está en oferta y cuánto salía antes). Si dice PACK, llevando esa cantidad o más cada unidad sale a ese precio: mencionalo cuando le sirva al cliente (ej. si pide 2 y llevando 3 le conviene). Nunca inventes una oferta que no está.\n' +
    (esVoz
      ? '- CANAL: estás en una LLAMADA telefónica. Hablá en prosa fluida y natural, frases cortas, SIN listas, SIN números de ítem, SIN viñetas (no se pueden "escuchar"). Si enumerás productos, decilos en una oración corrida y breve.\n'
      : '- CANAL: estás por MENSAJE de texto (SMS/WhatsApp). Cuando listes varios productos, ponelos en LISTA VERTICAL, uno por línea con guión "- ", cortita y fácil de leer (nombre y precio). Para charlar usá frases normales. Sé breve.\n') +
    'Respondé el JSON:\n' +
    '- reply = lo que vas a DECIR (corto, natural, para leer en voz).\n' +
    '- pedido = la lista COMPLETA de lo que el cliente quiere HASTA AHORA (codigo y cantidad de CADA producto, no solo lo nuevo). ' +
    'El CARRITO ACTUAL de abajo te dice cómo viene. Si el cliente agrega algo, sumalo a lo que ya había. ' +
    'Si solo pregunta, saluda o charla, devolvé el pedido EXACTAMENTE igual a como está (no lo cambies). ' +
    'Si pide sacar algo, devolvé la lista sin eso. Si quiere empezar de cero, devolvé lista vacía.\n' +
    '- confirmar = true SOLO cuando el cliente confirma que ya terminó y quiere cerrar.\n' +
    '- nombre_cliente = el nombre del cliente si lo dijo en algún momento, si no "".\n\n' +
    'PERFIL DEL CLIENTE:\n' + perfil + '\n\n' +
    'CATÁLOGO (codigo | producto | precio | stock | DESC opcional):\n' + cat + '\n\nCARRITO ACTUAL del cliente:\n' + carritoTxt +
    (histTxt ? '\n\nCHARLA HASTA AHORA (para que tengas contexto):\n' + histTxt : '');
  const payload = {
    model: 'claude-haiku-4-5', max_tokens: 1500, system,
    output_config: { format: { type: 'json_schema', schema: {
      type: 'object',
      properties: {
        reply: { type: 'string', description: 'Lo que Shuki dice en voz: corto, natural, español rioplatense.' },
        pedido: { type: 'array', description: 'Lista COMPLETA de lo que el cliente quiere hasta ahora (estado final, no incremental).', items: {
          type: 'object',
          properties: { codigo: { type: 'string', description: 'Código del producto del catálogo.' }, cantidad: { type: 'number', description: 'Cantidad total de ese producto en el pedido.' } },
          required: ['codigo', 'cantidad'], additionalProperties: false,
        } },
        confirmar: { type: 'boolean', description: 'true solo cuando el cliente confirma que terminó.' },
        nombre_cliente: { type: 'string', description: 'Nombre del cliente si lo dijo, si no "".' },
      },
      required: ['reply', 'pedido', 'confirmar', 'nombre_cliente'], additionalProperties: false,
    } } },
    messages: [{ role: 'user', content: texto }],
  };
  // Llamada con reintento: cubre cortes/hipos transitorios de la API y JSON truncado.
  let data: any = null, dbg = '';
  for (let intento = 0; intento < 3 && !data; intento++) {
    if (intento > 0) await new Promise((r) => setTimeout(r, 500));
    try {
      const r = await anthropicMsg(apiKey, payload);
      if (r.code !== 200) { dbg = 'http ' + r.code + ': ' + JSON.stringify(r.body).substring(0, 150); continue; }
      data = JSON.parse(r.texto);
      if (r.body.stop_reason === 'max_tokens') dbg = 'truncado (subir max_tokens)';
    } catch (err) { dbg = 'parse/exc: ' + String(err).substring(0, 150); }
  }
  if (!data) return { reply: 'Perdoná, se me trabó un segundo. ¿Me lo repetís?', _dbg: dbg };
  const nuevo: any = {};
  (data.pedido || []).forEach((it: any) => {
    const p = prods.find((x) => x.id === String(it.codigo));
    if (!p) return;
    const q = parseInt(it.cantidad) || 0;
    if (q > 0) nuevo[p.id] = Math.min(p.stock, q);
  });
  s.carrito = nuevo;
  if (data.nombre_cliente && data.nombre_cliente.trim()) s.nombre = data.nombre_cliente.trim();
  const confirmar = data.confirmar === true && Object.keys(nuevo).length > 0;
  s.historial = (s.historial || []).concat([{ r: 'u', t: texto }, { r: 'a', t: data.reply || '' }]).slice(-6);
  if (confirmar) s.historial = [];
  await botGuardarSesion(s);
  if (confirmar) {
    const cierre = await botConfirmar(s, prods, tel, sim);
    return { reply: (data.reply ? data.reply + ' ' : '') + cierre, cerrado: true };
  }
  return { reply: data.reply || '¿Querés algo más?' };
}
// Pedido tomado por Shuki en la llamada (tool de Retell). dry=true no escribe nada.
async function registrarPedidoVoz(itemsStr: any, cliente: string, direccion: string, tel: string, dry: boolean) {
  const prods = await botLeerProductos();
  if (!prods.length) return { ok: false, error: 'sin_productos' };
  const tryp = (s: any) => { if (Array.isArray(s)) return s; if (typeof s !== 'string' || !s) return null; try { const x = JSON.parse(s); return Array.isArray(x) ? x : null; } catch { return null; } };
  let lista = tryp(itemsStr);
  if (!lista) { try { lista = tryp(decodeURIComponent(itemsStr)); } catch { /**/ } }
  if (!lista) { try { lista = tryp((itemsStr || '').replace(/\+/g, ' ')); } catch { /**/ } }
  if (!lista) lista = [];
  const carrito: any = {}, noEncontrados: string[] = [];
  lista.forEach((it: any) => {
    const key = (it && (it.codigo || it.nombre || it.producto)) || '';
    const q = parseInt(it && it.cantidad) || 0;
    if (!key || q <= 0) return;
    const p = matchProductoVoz(prods, key);
    if (p) carrito[p.id] = (carrito[p.id] || 0) + q;
    else noEncontrados.push(key);
  });
  const ids = Object.keys(carrito).filter((k) => carrito[k] > 0);
  if (!ids.length) return { ok: false, error: 'pedido_vacio', noEncontrados, recibido: (itemsStr || '').toString().substring(0, 200) };
  const lineas: string[] = [], suArr: string[] = [], jonyArr: string[] = [];
  let total = 0;
  ids.forEach((id) => {
    const p = prods.find((x) => x.id === id);
    const qty = Math.min(carrito[id], p.stock || carrito[id]);
    const unit = precioBot(p, qty), sub = unit * qty;
    total += sub;
    lineas.push('• ' + qty + 'x ' + p.nombre + (p.desc ? ' · ' + p.desc : '') + ' — $ ' + botMiles(unit) + ' c/u = $ ' + botMiles(sub));
    suArr.push(id + ':' + qty);
    if (p.dueno === 'Jony') jonyArr.push(id + ':' + qty + ':' + unit);
  });
  if (dry) return { ok: true, dry: true, total, lineas, noEncontrados };
  const cli = cliente ? cliente : ('Tel ' + (tel || 's/d'));
  const notas = '📞 Pedido por teléfono (Shuki)' + (direccion ? ' — Dirección: ' + direccion : '');
  const ins = await insertarVentaAtomica({ fecha: fechaAhora(), cliente: cli, tipo: 'Minorista', productos: lineas.join('\n'), forma_pago: 'A coordinar', notas, estado: 'pendiente', total_ars: total, total_usd: 0, ars_jony: 0, ars_myri: 0, usd_myri: 0, comi_ars: 0, comi_usd: 0, caja_jony: '', caja_myri: '', tipo_cambio: 0, stock_updates: suArr.join(','), usd_jony: 0, vid: 'voz_' + (tel || '') });
  if ('error' in ins) return { ok: false, error: ins.error };
  const nVenta = ins.nVenta;
  for (const u of suArr) { const pp = u.split(':'); await moverStockShuk(pp[0], -(parseInt(pp[1]) || 0), 'Venta TEL #' + nVenta + ' — ' + cli); }
  if (jonyArr.length) {
    let g = 0;
    for (const it of jonyArr) { const pp = it.split(':'); const avg = await costoPromedioShuk(pp[0]); if (avg > 0) g += (parseFloat(pp[2]) - avg) * (parseFloat(pp[1]) || 0); }
    if (g > 0) await sbInsert('ganancias_jony', { fecha: fechaAhora(), tipo: 'ganancia_pitzujim', descripcion: 'Pitzujim — ' + cli, monto: Math.round(g) });
  }
  await relayTelegram('papa', '📞 NUEVO PEDIDO POR TELÉFONO #' + nVenta + '\n👤 ' + cli + (tel ? ' (' + tel + ')' : '') + (direccion ? '\n📍 ' + direccion : '') + '\n\n' + lineas.join('\n') + '\n\nTotal: $ ' + botMiles(total) + '\nCoordiná entrega y cobro desde el panel.');
  return { ok: true, nVenta, total, resumen: lineas.map((l) => l.replace('• ', '')).join('; ') };
}
// Borra ventas por # de venta (uso administrativo). Devuelve stock de las no canceladas.
async function borrarVentasFn(idsStr: string) {
  const objetivo = (idsStr || '').split(',').map((s) => parseInt(s.trim())).filter((n) => n > 0);
  if (!objetivo.length) return { ok: false, error: 'sin ids' };
  const ventas = (await sbGet('ventas', 'select=id,n_venta,estado,stock_updates,cliente&n_venta=in.(' + objetivo.join(',') + ')'));
  if (!ventas.length) return { ok: false, error: 'no encontradas', objetivo };
  const devueltas: number[] = [], borradas: number[] = [];
  for (const v of ventas) {
    const estado = (v.estado || '').toString();
    if (estado !== 'cancelado' && estado !== 'cotizacion' && v.stock_updates) {
      for (const u of v.stock_updates.toString().split(',')) {
        const pp = u.split(':'); const qty = parseInt(pp[1]) || 0;
        if (pp[0] && qty > 0) await moverStockShuk(pp[0], qty, 'Borrado venta #' + v.n_venta + ' (devolución)');
      }
      devueltas.push(v.n_venta);
    }
    await sbInsert('borrados', { fecha: fechaAhora(), tipo: 'venta Shuk', detalle: '#' + v.n_venta + ' · ' + (v.cliente || '') + ' · estado ' + estado, por: '' });
    await sbDelete('ventas', 'id=eq.' + encodeURIComponent(v.id));
    borradas.push(v.n_venta);
  }
  return { ok: true, borradas, stockDevuelto: devueltas };
}
// SMS saliente por el gateway (capcom6 / sms-gate.app). Credenciales en config o secrets.
async function enviarSMS(texto: string, to: string, sim: string) {
  const user = (await getConfig('SMS_GATEWAY_USER', '')) || Deno.env.get('SMS_GATEWAY_USER') || '';
  const pass = (await getConfig('SMS_GATEWAY_PASS', '')) || Deno.env.get('SMS_GATEWAY_PASS') || '';
  if (!user || !pass) return;
  try {
    let dest = (to || '').toString().trim();
    if (dest && dest.charAt(0) !== '+') dest = '+' + dest;
    const cuerpo: any = { message: (texto || '').substring(0, 600), phoneNumbers: [dest] };
    if (sim) cuerpo.simNumber = parseInt(sim) || undefined;
    await fetch('https://api.sms-gate.app/3rdparty/v1/message', { method: 'POST', headers: { Authorization: 'Basic ' + btoa(user + ':' + pass), 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) });
  } catch { /**/ }
}

// ═══ CIERRE DIARIO + BACKUP (Supabase-nativo: JSON de todas las tablas a Storage) ═══
const esHoy = (valor: any) => (valor || '').toString().trim().substring(0, 10) === fechaAhora().slice(0, 10);
async function resumenShukHoy() {
  const r: any = { n: 0, ars: 0, usd: 0, gastos: 0, visitas: 0, abandonados: 0, stockBajo: [] as string[] };
  const [ventas, gastos, trafico, productos] = await Promise.all([
    sbGet('ventas', 'select=fecha,estado,total_ars,total_usd'), sbGet('gastos', 'select=fecha,monto'),
    sbGet('trafico', 'select=fecha,vid,evento&order=id.desc&limit=5000'), sbGet('productos', 'select=nombre,stock,activo'),
  ]);
  ventas.forEach((v: any) => { if (esHoy(v.fecha) && (v.estado || '') !== 'cancelado') { r.n++; r.ars += parseFloat(v.total_ars) || 0; r.usd += parseFloat(v.total_usd) || 0; } });
  gastos.forEach((g: any) => { if (esHoy(g.fecha)) r.gastos += parseFloat(g.monto) || 0; });
  const porVid: any = {};
  trafico.forEach((t: any) => {
    if (!esHoy(t.fecha)) return;
    if (t.evento === 'visita') r.visitas++;
    if (t.vid) { if (!porVid[t.vid]) porVid[t.vid] = {}; porVid[t.vid][t.evento] = true; }
  });
  r.abandonados = Object.values(porVid).filter((ev: any) => (ev.carrito || ev.checkout) && !ev.pedido).length;
  productos.forEach((p: any) => {
    const stk = parseInt(p.stock);
    if (p.nombre && p.activo !== false && !isNaN(stk) && stk > 0 && stk <= 3) r.stockBajo.push(p.nombre + ' (' + stk + ')');
  });
  return r;
}
async function resumenHijoHoy(hijo: string) {
  const r = { n: 0, total: 0, ganancia: 0, deudasNuevas: 0 };
  const [cat, prods, ventas, cc, consumo] = await Promise.all([
    sbGet('candy_productos', 'select=codigo,costo'), sbGet('productos', 'select=id,costo'),
    sbGet('candy_ventas', 'select=fecha,hijo,codigo,cantidad,precio,total&hijo=eq.' + encodeURIComponent(hijo)),
    sbGet('candy_cc', 'select=fecha,hijo,monto&hijo=eq.' + encodeURIComponent(hijo)),
    sbGet('candy_consumo', 'select=fecha,hijo,cantidad,costo&hijo=eq.' + encodeURIComponent(hijo)),
  ]);
  const costos: any = {};
  cat.forEach((p: any) => costos[(p.codigo || '').toString().toLowerCase()] = parseFloat(p.costo) || 0);
  prods.forEach((p: any) => costos[('shuk:' + p.id).toLowerCase()] = parseFloat(p.costo) || 0);
  ventas.forEach((v: any) => {
    if (!esHoy(v.fecha)) return;
    r.n++; r.total += parseFloat(v.total) || 0;
    const costo = costos[(v.codigo || '').toString().toLowerCase()] || 0;
    r.ganancia += ((parseFloat(v.precio) || 0) - costo) * (parseInt(v.cantidad) || 1);
  });
  cc.forEach((c: any) => { if (esHoy(c.fecha) && parseFloat(c.monto) > 0) r.deudasNuevas += parseFloat(c.monto) || 0; });
  consumo.forEach((c: any) => { if (esHoy(c.fecha)) r.ganancia -= (parseFloat(c.costo) || 0) * (parseInt(c.cantidad) || 0); });
  return r;
}
// Resumen nocturno a papá + mini-resumen a cada chico (Telegram vía worker). Idempotente por día.
async function cierreDiario() {
  const hoyISO = fechaAhora().slice(0, 10).split('/').reverse().join('-');
  const hoyKey = 'cierre_' + hoyISO;
  if ((await getConfig(hoyKey, '')) === '1') return { ok: true, dup: true };
  await setConfig(hoyKey, '1');
  const fmt = (n: number) => '$' + Math.round(n).toLocaleString('es-AR');
  const fecha = fechaAhora().slice(0, 10);
  const [shuk, meir, iosi] = await Promise.all([resumenShukHoy(), resumenHijoHoy('Meir'), resumenHijoHoy('Iosi')]);
  let msg = '🌙 *Cierre del día — ' + fecha + '*\n\n🏪 *Shuk Mamtakim*\n';
  msg += '• Pedidos: ' + shuk.n;
  if (shuk.ars > 0) msg += ' · ' + fmt(shuk.ars);
  if (shuk.usd > 0) msg += ' + U$S ' + shuk.usd.toFixed(2);
  msg += '\n';
  if (shuk.gastos > 0) msg += '• Gastos: ' + fmt(shuk.gastos) + '\n';
  msg += '• Visitas a la web: ' + shuk.visitas + '\n';
  if (shuk.abandonados > 0) msg += '• 🛒 Carritos sin terminar: ' + shuk.abandonados + ' (ver Analítica)\n';
  if (shuk.stockBajo.length) msg += '• ⚠️ Stock bajo: ' + shuk.stockBajo.slice(0, 5).join(', ') + '\n';
  msg += '\n🍬 *Candy Shop*\n';
  ([['Meir', meir], ['Iosi', iosi]] as [string, any][]).forEach(([nombre, d]) => {
    msg += '• ' + nombre + ': ' + d.n + ' venta' + (d.n !== 1 ? 's' : '');
    if (d.total > 0) msg += ' · ' + fmt(d.total) + ' (ganancia ' + fmt(d.ganancia) + ', maaser ' + fmt(d.ganancia * 0.1) + ')';
    if (d.deudasNuevas > 0) msg += ' · deudas nuevas ' + fmt(d.deudasNuevas);
    msg += '\n';
  });
  await relayTelegram('papa', msg);
  for (const [dest, d] of [['meir', meir], ['iosi', iosi]] as [string, any][]) {
    if (d.n > 0) await relayTelegram(dest, '🌙 *Tu día de hoy*\n• Ventas: ' + d.n + ' · ' + fmt(d.total) + '\n• Ganancia: ' + fmt(d.ganancia) + '\n• Maaser (10%): ' + fmt(d.ganancia * 0.1) + '\n¡Buen trabajo! 💪');
  }
  return { ok: true };
}
// Backup de TODAS las tablas como un JSON en Storage (bucket 'backups') + retención 30 días.
// v4.49: se auditó la lista contra information_schema y faltaban 9 tablas que SÍ tienen datos
// o van a tenerlos. Las más graves: `recepciones` (el historial de compras, 123 filas desde
// julio) y `ordenes_compra`. Las `costeo_*` son de Costos Israel — comparten proyecto y sbGet
// usa la SERVICE key, así que las lee aunque tengan RLS.
// Queda AFUERA a propósito: pagos_backup_20260707 (backup manual puntual, no es dato vivo).
const TABLAS_BACKUP = ['productos', 'ventas', 'pagos', 'clientes', 'movs_socios', 'envios', 'liquidacion_socios', 'cortes', 'gastos', 'rendiciones', 'notificaciones', 'movimientos_stock', 'ganancias_jony', 'costos_jony', 'visitas', 'trafico', 'avisos_candy', 'shuk_en_candy', 'borrados', 'config', 'candy_productos', 'candy_ventas', 'candy_cc', 'candy_consumo', 'candy_deposito', 'candy_compras', 'candy_proveedores', 'candy_pedidos', 'candy_deudores', 'stock_diario', 'cierres_hijos', 'bandeja_fotos', 'flyers_hijos', 'bot_sesiones', 'sms_log',
  'recepciones', 'ordenes_compra', 'costos_importaciones',
  'costeo_productos', 'costeo_compras', 'costeo_facturas', 'costeo_items', 'costeo_envios', 'costeo_recepciones'];
async function backupAhora(etiqueta: string) {
  const dump: any = {}; let filas = 0;
  for (const t of TABLAS_BACKUP) {
    try { dump[t] = await sbGet(t, 'select=*'); filas += dump[t].length; } catch (e) { dump[t] = { error: String(e) }; }
  }
  // 🔒 v4.95: las claves de servicios de afuera (IA, pases) NO viajan en la copia (iban completas, 24 copias
  // por día). Mismo criterio que el backup de GitHub: quedan vacías y se recargan desde el panel.
  if (Array.isArray(dump.config)) dump.config = dump.config.map((r: any) => (/(API_KEY|_TOKEN|_SECRET|_PASS|_HASH)$/i.test(String(r.clave)) ? { ...r, valor: '' } : r));
  const f = fechaAhora();   // dd/MM/yyyy HH:mm
  const nombre = 'Backup Shuk ' + (etiqueta ? '(' + etiqueta + ') ' : '') + f.slice(6, 10) + '-' + f.slice(3, 5) + '-' + f.slice(0, 2) + ' ' + f.slice(11, 13) + 'h' + f.slice(14, 16) + '.json';
  const up = await fetch(SB_URL + '/storage/v1/object/backups/' + encodeURIComponent(nombre), { method: 'POST', headers: { apikey: SERVICE, Authorization: 'Bearer ' + SERVICE, 'Content-Type': 'application/json', 'x-upsert': 'true' }, body: JSON.stringify(dump) });
  if (!up.ok) return { error: 'storage ' + up.status + ' ' + (await up.text()).slice(0, 150) };
  // Retención: borrar backups más viejos que 30 días.
  try {
    const ls = await fetch(SB_URL + '/storage/v1/object/list/backups', { method: 'POST', headers: { apikey: SERVICE, Authorization: 'Bearer ' + SERVICE, 'Content-Type': 'application/json' }, body: JSON.stringify({ prefix: '', limit: 1000 }) });
    const files = await ls.json();
    const corte = Date.now() - 30 * 86400000;
    for (const fl of (Array.isArray(files) ? files : [])) {
      if (fl.created_at && new Date(fl.created_at).getTime() < corte) await fetch(SB_URL + '/storage/v1/object/backups/' + encodeURIComponent(fl.name), { method: 'DELETE', headers: { apikey: SERVICE, Authorization: 'Bearer ' + SERVICE } });
    }
  } catch { /**/ }
  return { ok: true, nombre, tablas: TABLAS_BACKUP.length, filas };
}


// ═══ 🪄 DISEÑO IA TOTAL DEL FLYER (v4.58) ═══════════════════════════════════
// Gemini compone el flyer entero (logo real + fotos + textos exactos) y Claude
// VERIFICA los importes leyendo la imagen generada antes de entregarla.

async function b64DeUrl(u: string): Promise<{ mime: string; data: string }> {
  const r = await fetch(u);
  if (!r.ok) throw new Error('img ' + r.status);
  const buf = new Uint8Array(await r.arrayBuffer());
  let bin = '';
  const paso = 0x8000;
  for (let i = 0; i < buf.length; i += paso) bin += String.fromCharCode(...buf.subarray(i, i + paso));
  return { mime: r.headers.get('content-type') || 'image/png', data: btoa(bin) };
}

function promptFlyerIA(t: any, prods: any[], estilo: string, aspecto: string, conPrecios = true, web = '') {
  const lineas = prods.map((p: any, i: number) =>
    `${i + 1}) ${p.nombre}` + (conPrecios ? ` → "${p.promo || p.precio}"` : '') +
    (conPrecios && p.promo ? ` (al lado, el precio viejo "${p.precio}" tachado)` : '') +
    (p.badge ? ` [cinta "${p.badge}"]` : '')).join('\n');
  return 'Sos un diseñador gráfico senior. Diseñá un flyer promocional ' +
    (aspecto === '1:1' ? 'cuadrado' : 'vertical') +
    ' de calidad profesional para "Shuk Mamtakim", tienda argentina de golosinas kosher importadas de Israel.\n' +
    'LA PRIMERA IMAGEN ADJUNTA ES EL LOGO OFICIAL: integralo arriba, prominente, EXACTAMENTE como es (no lo redibujes ni cambies sus colores ni su texto).\n' +
    'LAS SIGUIENTES IMÁGENES SON LAS FOTOS REALES DE LOS PRODUCTOS: usalas SIN deformar ni redibujar, recortadas prolijas con sombra suave; son las protagonistas.\n' +
    'TEXTOS OBLIGATORIOS — copialos EXACTOS, letra por letra y número por número:\n' +
    `• Título: "${t.titulo}"\n• Frase: "${t.frase}"\n` +
    (conPrecios
      ? '• Precio de cada producto, en una etiqueta bien grande y legible pegada a SU producto:\n' + lineas + '\n'
      : '• Productos que aparecen (SIN ningún precio: este flyer no lleva precios, no inventes ninguno):\n' + lineas + '\n') +
    `• Cierre (botón o cinta): "${t.cierre}"\n• Pie: "📲 11 3175-4540"` +
    (web ? `\n• Dirección web al pie, junto al teléfono: "${web}"` : '') + '\n' +
    'PROHIBIDO: cualquier otro texto, palabra, número, marca de agua o logo inventado. Nada de texto en el fondo.\n' +
    'Estilo de arte: ' + (estilo || 'candy-pop 3D festivo, colores vibrantes, golosinas flotando, cintas y destellos') +
    '. Composición aireada y jerárquica, tipografía display redondeada con contorno, contraste alto para leerse en el celular.';
}

// Dos vías (la clásica generateContent y la nueva interactions) × varios modelos,
// hasta que alguna devuelva imagen. El shape de la respuesta cambia entre vías:
// cazarImagenB64 encuentra el base64 venga donde venga.
async function geminiImagen(key: string, prompt: string, imgs: { mime: string; data: string }[], aspecto: string): Promise<{ b64?: string; mime?: string; error?: string }> {
  const MODELOS = ['gemini-3-pro-image', 'gemini-3-pro-image-preview', 'gemini-2.5-flash-image'];
  let ultimo = '';
  for (const modelo of MODELOS) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`, {
        method: 'POST',
        headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }, ...imgs.map(i => ({ inline_data: { mime_type: i.mime, data: i.data } }))] }],
          generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: aspecto } },
        }),
      });
      const j: any = await r.json().catch(() => ({}));
      if (r.status === 200) {
        const im = cazarImagenB64(j);
        if (im) return { b64: im.data, mime: im.mime || 'image/png' };
      }
      ultimo = 'gc ' + modelo + ' HTTP ' + r.status + ' ' + String(j?.error?.message || '').slice(0, 140);
    } catch (e) { ultimo = 'gc ' + modelo + ': ' + e; }
    try {
      const r2 = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
        method: 'POST',
        headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: modelo,
          input: [{ type: 'text', text: prompt }, ...imgs.map(i => ({ type: 'image', mime_type: i.mime, data: i.data }))],
          response_format: { type: 'image', mime_type: 'image/png', aspect_ratio: aspecto, image_size: '1K' },
        }),
      });
      const j2: any = await r2.json().catch(() => ({}));
      if (r2.status === 200) {
        const im2 = cazarImagenB64(j2);
        if (im2) return { b64: im2.data, mime: im2.mime || 'image/png' };
      }
      ultimo = 'ix ' + modelo + ' HTTP ' + r2.status + ' ' + String(j2?.error?.message || '').slice(0, 140);
    } catch (e) { ultimo = 'ix ' + modelo + ': ' + e; }
  }
  return { error: ultimo };
}

function cazarImagenB64(o: any, prof = 0): { data: string; mime?: string } | null {
  if (!o || typeof o !== 'object' || prof > 8) return null;
  for (const k of Object.keys(o)) {
    const v = (o as any)[k];
    if (typeof v === 'string' && v.length > 10000 && /^[A-Za-z0-9+/=]+$/.test(v.slice(0, 120)))
      return { data: v, mime: (o as any).mime_type || (o as any).mimeType || '' };
    if (v && typeof v === 'object') { const r = cazarImagenB64(v, prof + 1); if (r) return r; }
  }
  return null;
}

// Claude lee el flyer generado y transcribe los importes; se comparan contra lo
// esperado (solo dígitos). null = no se pudo verificar (sin clave) → se avisa.
async function verificarPreciosFlyer(b64: string, mime: string, prods: any[]): Promise<{ ok: boolean; problemas: string[] } | null> {
  const aKey = await claveIA();   // 🔑 v4.93: la misma clave que todo lo demás (antes acá mandaba el secreto viejo)
  if (!aKey || b64.length > 4800000) return null;
  try {
    const r = await anthropicMsg(aKey, {
      model: 'claude-haiku-4-5-20251001', max_tokens: 600,
      output_config: { format: { type: 'json_schema', schema: {
        type: 'object',
        properties: { importes: { type: 'array', items: { type: 'string' }, description: 'TODOS los importes de dinero visibles en la imagen, dígitos exactos, incluidos los tachados' } },
        required: ['importes'], additionalProperties: false } } },
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: mime || 'image/png', data: b64 } },
        { type: 'text', text: 'Transcribí TODOS los importes de dinero visibles en este flyer, uno por uno, con sus dígitos exactos (incluidos los tachados).' },
      ] }],
    });
    if (r.code !== 200) return null;
    const leidos = (JSON.parse(r.texto).importes || []).map((s: string) => String(s).replace(/\D/g, '')).filter(Boolean);
    const problemas: string[] = [];
    for (const p of prods) {
      const esperado = String(p.promo || p.precio || '').replace(/\D/g, '');
      if (esperado && leidos.indexOf(esperado) === -1) problemas.push(`"${p.promo || p.precio}" (${p.nombre})`);
    }
    return { ok: problemas.length === 0, problemas };
  } catch { return null; }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return json({});
  const url = new URL(req.url);
  let body: any = {};
  if (req.method === 'POST') { try { body = await req.json(); } catch { body = {}; } }
  // El PANEL real (apiWrite/fetchConSesion) manda TODO por GET con query params — herencia
  // de Apps Script doGet. Los query params completan el body (sin pisar un POST JSON), así
  // TODOS los handlers leen igual venga por donde venga. (Bug cazado en el día simulado.)
  url.searchParams.forEach((v, k) => { if (body[k] === undefined) body[k] = v; });
  const accion = url.searchParams.get('accion') || body.accion || '';
  const token = (req.headers.get('Authorization') || '').replace('Bearer ', '') || url.searchParams.get('token') || body.token || '';
  const has = (k: string) => body[k] !== undefined && body[k] !== null && body[k] !== '';
  // La tienda llama por GET (query params, fire-and-forget); el panel por POST (body). Q lee ambos.
  const Q = (k: string) => { const v = body[k]; if (v !== undefined && v !== null && v !== '') return String(v); const q = url.searchParams.get(k); return q == null ? '' : q; };
  const QN = (k: string) => { const n = parseFloat(Q(k)); return isNaN(n) ? 0 : n; };
  // ── Webhook del gateway de SMS (capcom6): SMS entrante → cerebro de Shuki → respuesta SMS.
  //    🔒 v4.99: CERRADO CON LLAVE. El gateway no sabe de sesiones, así que la llave va en su dirección:
  //    …/functions/v1/api?clave=<SMS_WEBHOOK_TOKEN>. Sin llave cargada en config (hoy: el SMS no se usa desde junio)
  //    no entra NADA, ni se anota. Para REABRIRLO: cargar SMS_WEBHOOK_TOKEN (larga, al azar) y ponerla en el gateway.
  if (body && body.event === 'sms:received' && body.payload) {
    const llaveSms = await getConfig('SMS_WEBHOOK_TOKEN', '');
    if (!llaveSms || Q('clave') !== llaveSms) return json({ error: 'no autorizado' });
    try {
      const from = (body.payload.phoneNumber || '').toString().trim();
      const text = (body.payload.message || '').toString().trim();
      const sim = body.payload.simNumber != null ? String(body.payload.simNumber) : '';
      try { await sbInsert('sms_log', { fecha: fechaAhora(), sim, de: from, texto: text }); } catch { /**/ }
      const simShuk = await getConfig('SMS_SIM_SHUK', '');
      if (!simShuk) return json({ ok: true, modo: 'captura', simRecibida: sim });
      if (sim && String(sim) !== String(simShuk)) return json({ ok: true, ignorado: 'otra linea' });
      if (from && text) {
        const r: any = await procesarVozIA(from, text, false, 'texto');
        if (r && r.reply) await enviarSMS(r.reply, from, simShuk);
      }
      return json({ ok: true });
    } catch (err) { return json({ error: 'sms: ' + err }); }
  }
  // ── ZONA PÚBLICA: las acciones de la TIENDA (clientes, sin login) — espejo exacto
  //    de lo que queda FUERA de PROTECTED_ACTIONS/PROTECTED_HIJOS en motor-v2.js.
  const PUBLICAS = ['miHabitual', 'getPedidoArmado', 'getEstadoTienda', 'venta', 'track', 'visitas', 'notificacion', 'registrarClienteMayorista', 'getCatalogoHijos', 'getConfigCandy', 'registrarPedidoHijo', 'avisarmeCandy', 'getCatalogoVip', 'geoGate'];
  // ── Acciones que también acepta el bot/worker/cron con el secreto compartido (espejo del motor viejo).
  const CON_SECRET = ['botMsg', 'botVoz', 'pedidoVoz', 'tts', 'transcribirIdea', 'borrarVentas', 'preguntarIA', 'movimientosStock', 'auditoriaStock', 'leerStockRaw', 'backupAhora', 'cronHorario', 'cierreDiario'];
  const conSecreto = !!BOT_SECRET && Q('secret') === BOT_SECRET && CON_SECRET.indexOf(accion) !== -1;
  // ── Acciones que SOLO puede pedir Jony (v4.48). Miri tiene su propio usuario y su token
  //    es válido, así que sin esta lista vería el historial de compras de Jony con solo
  //    pedirlo. Toda acción nueva que toque costos, proveedores o compras NACE acá adentro.
  // 'setAvisoTienda' entra acá en v4.53: cambia la VIDRIERA que ve todo cliente, y hasta
  // ahora la podía tocar cualquier usuario logueado (el token de Miri incluido).
  const SOLO_JONY = ['historialCompras', 'ultimasCompras', 'accesoMiri', 'setAccesoMiri', 'setAvisoTienda', 'getAlertasPush', 'setAlertasPush', 'probarPushJony', 'sugerirFicha', 'setFiestasTienda', 'armarPedidoIA', 'setEnvioTienda', 'guardarClaveIA', 'guardarClaveGemini', 'estadoClavesIA', 'guardarClaveCloudinary', 'crearPedidoArmado', 'listarPedidosArmados', 'borrarPedidoArmado', 'teToca', 'teTocaMarcar', 'crearFracciones', 'sugerirFraccion'];
  // OJO: el texto debe ser EXACTAMENTE 'no autorizado' — candyshop.html compara con === para
  //  auto-renovar el token vencido (index.html usa indexOf, le sirve igual). Bug #15 del playón.
  const esPublica = PUBLICAS.indexOf(accion) !== -1;
  // Una sola consulta de identidad por request: sirve para el portero Y para saber quién es.
  const usuario = (esPublica || conSecreto) ? null : await usuarioSesion(token);
  if (!esPublica && !conSecreto && !usuario) return json({ error: 'no autorizado' });
  if (SOLO_JONY.indexOf(accion) !== -1 && !conSecreto && !esJony(usuario)) return json({ error: 'no autorizado' });
  // 🔒 v4.96: la cuenta de los chicos (Candy) puede SOLO lo que usa su panel (candyshop.html): antes pasaba a 143 acciones
  // del Shuk (clientes, plata, cobros, cortes, push a todos). El texto NO es 'no autorizado' a propósito: ese dispara el
  // refresco de sesión del panel y acá la sesión es válida — lo que no corresponde es la acción.
  if (usuario && usuario.email === MAIL_KIDS && ACCIONES_KIDS.indexOf(accion) === -1) return json({ error: 'no disponible para esta cuenta' });
  // 🎚️ INTERRUPTOR DE ACCESO DE MIRI (v4.52): Jony lo prende/apaga desde el panel (ACCESO_MIRI).
  // Apagado ⇒ el token de Miri no puede pedir NINGUNA acción protegida — ni siquiera con una
  // sesión que le quedó abierta en el navegador: la barrera es del servidor, no de la pantalla.
  // El texto NO es 'no autorizado' a propósito: ese texto exacto dispara el auto-refresh de token
  // del front (bug #15 del playón) y acá el token es VÁLIDO — lo apagado es el acceso.
  if (usuario && usuario.email === MAIL_MIRI && (await getConfig('ACCESO_MIRI', '1')) === '0') return json({ error: 'acceso pausado' });

  try {
    // ═══ TIENDA PÚBLICA (sin login) ═══════════════════════════════════════════
    // 🔁 v4.86: "lo de siempre" de este aparato (solo productos y cantidades, nada personal).
    if (accion === 'miHabitual') {
      const vidH = Q('vid').replace(/[^a-z0-9_]/gi, '').slice(0, 60);
      if (vidH.length < 8) return json({ items: [], pedidos: 0 });
      const vsH = await sbGet('ventas', 'select=fecha,estado,tipo,stock_updates&vid=eq.' + encodeURIComponent(vidH) + '&order=n_venta.desc&limit=6');
      return json(pedidoHabitual(vsH));
    }
    if (accion === 'venta') {
      // Pedido MANUAL del panel: viaja con la sesión de Jony y los precios los pone él → ni freno ni recálculo.
      const quienVenta = token ? await usuarioSesion(token) : null;
      const ventaManual = esJony(quienVenta);
      // El panel marca su pedido como manual: sin la sesión de Jony NO entra (el panel renueva la sesión y reintenta
      // solo). Así un pedido manual jamás se toma por uno de la tienda y se le "corrigen" los precios a mano.
      if (Q('manual') === '1' && !ventaManual) return json({ error: 'no autorizado' });
      const ipVenta = ventaManual ? '' : await huellaIP(req);
      if (!ventaManual) {
        const freno = await frenoPedidos('ventas', ipVenta);
        if (freno) { await avisarFreno('ventas', freno); return json({ error: 'rate' }); }
      }
      // Anti pedidos falsos: límite por dispositivo (vid) — 90s entre pedidos, máx 4/hora.
      // (El motor viejo usaba CacheService; acá se mira el timestamp 'creado' de las ventas del vid.)
      const vidVenta = _ident(Q('vid'));   // 🔒 v4.95
      if (vidVenta) {
        const desde = new Date(Date.now() - 3600000).toISOString();
        const recientes = await sbGet('ventas', 'select=creado&vid=eq.' + encodeURIComponent(vidVenta) + '&creado=gte.' + encodeURIComponent(desde) + '&order=creado.desc');
        if (recientes.length >= 4) return json({ error: 'rate' });
        if (recientes.length && Date.now() - new Date(recientes[0].creado).getTime() < 90000) return json({ error: 'rate' });
      }
      const esCotizacion = Q('cotizacion') === '1';
      const stockUpdates = Q('stockUpdates');
      // 🔒 v4.95: siempre "id:cantidad,id:cantidad" (lo arma la tienda); otra cosa no es un pedido de verdad.
      if (stockUpdates && !/^\d{1,9}:\d{1,6}(,\d{1,9}:\d{1,6})*$/.test(stockUpdates)) return json({ error: 'pedido inválido' });
      const cliente = _libre(Q('cliente'), 120);
      // 🛡️ Anti-DUPLICADO servidor (caso real #57/#58, 12/07/2026: mismo carrito
      // reenviado 16 min después con el catálogo viejo en el navegador → sobreventa). Mismo
      // cliente + mismo stock_updates dentro de 30 min y no cancelado = reintento → se devuelve
      // el pedido EXISTENTE como éxito y NO se crea ni descuenta nada.
      if (stockUpdates && !esCotizacion) {
        const desdeDup = new Date(Date.now() - 1800000).toISOString();
        const prevDup = await sbGet('ventas', 'select=n_venta,estado,cliente&stock_updates=eq.' + encodeURIComponent(stockUpdates) + '&creado=gte.' + encodeURIComponent(desdeDup));
        const norm = (x: string) => (x || '').toString().trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const ya = prevDup.find((x: any) => (x.estado || '') !== 'cancelado' && norm(x.cliente) === norm(cliente));
        if (ya) return json({ ok: true, dup: true, nVenta: ya.n_venta });
      }
      // 🛡️ STOCK NUNCA NEGATIVO (regla del negocio, 12/07/2026: "stock negativo no existe").
      // Se valida ANTES de registrar: si algo no alcanza, el pedido NO entra y el que compra ve
      // exactamente qué falta (la alerta de SOBREVENTA queda como red para carreras extremas).
      // ✂️ v5.03: por POZO (las fracciones de una bolsa y la bolsa entera se miran juntas) — faltantesStock.
      if (stockUpdates && !esCotizacion) {
        const paresChk = stockUpdates.split(',').map((u: string) => { const pp = u.split(':'); return { id: (pp[0] || '').trim(), qty: parseInt(pp[1]) || 0 }; });
        const faltanItems = await faltantesDelPedido(paresChk);   // estructurado: la tienda auto-ajusta el carrito con esto
        if (faltanItems.length) return json({ error: 'stock', detalle: faltanItems.map((f: any) => 'De "' + f.nombre + '" queda' + (f.hay === 1 ? '' : 'n') + ' ' + f.hay + ' y pediste ' + f.pedido).join(' · '), items: faltanItems });
      }
      // 💰 v4.99: en un pedido de la TIENDA el total lo calcula el motor con los precios reales. Si lo que mandó el
      // navegador no cierra, se guarda lo REAL y el pedido queda marcado para que Jony lo revise antes de cobrar.
      // Si cierra, se guarda exactamente lo de siempre (nada cambia para un pedido honesto).
      let correccion = '', cuenta: any = null, productosReales = '';
      if (!ventaManual && stockUpdates) {
        const pares = stockUpdates.split(',').map((u: string) => { const pp = u.split(':'); return { id: String(parseInt(pp[0])), qty: parseInt(pp[1]) || 0 }; }).filter((x: any) => x.qty > 0);
        const filasP = await sbGet('productos', 'select=id,nombre,descripcion,dueno,moneda,precio_min,precio_may,precio_oferta,fecha_oferta,cant_pack,precio_pack&id=in.(' + pares.map((x: any) => x.id).join(',') + ')');
        const vipT = Q('vip').replace(/[^a-z0-9]/gi, '').slice(0, 40);
        let vip: any = null;
        if (vipT) { try { vip = JSON.parse((await getConfig('VIP_' + vipT, '')) || 'null'); } catch { vip = null; } }
        cuenta = calcularPedidoTienda(pares, filasP, Q('tipo') === 'Mayorista', vip, _hoyISO_AR());   // el modo con que la tienda armó el pedido (el link VIP lo pone al abrir, pero el botón de modo sigue ahí)
        if (cuenta) {
          // Los renglones salen SIEMPRE de la cuenta real (en un pedido honesto son idénticos a los de la tienda): así nadie
          // puede mandar "10x Klik" en el texto y cobrarse 1 en la plata — texto, plata y stock salen de lo mismo.
          productosReales = _libre(cuenta.lineas.join(' || '), 20000);
          const mandado: any = {}; PARTES_PEDIDO.forEach((k) => { mandado[k] = QN(k); });
          if (totalNoCierra(mandado, cuenta)) correccion = '⚠️ TOTAL CORREGIDO: la tienda mandó ' + _plataTxt(mandado.totalARS, mandado.totalUSD) + ' y con los precios de hoy es ' + _plataTxt(cuenta.totalARS, cuenta.totalUSD) + ' (un precio que cambió con la página abierta, o un pedido armado a mano). Revisalo antes de cobrar. · ';
          if (cuenta.sinPrecio.length) correccion += '⚠️ SIN PRECIO: ' + cuenta.sinPrecio.join(', ') + '. · ';
        }
      }
      const V = (k: string, real: number) => (correccion && cuenta ? Math.round(real * 100) / 100 : QN(k));
      const fila: any = { fecha: fechaAhora(), cliente, tipo: _libre(Q('tipo'), 30), productos: productosReales || _libre(Q('productos'), 20000), forma_pago: _libre(Q('formaPago'), 60), notas: (_libre(correccion, 400) + _libre(Q('notas'), 1000)).slice(0, 1000), estado: esCotizacion ? 'cotizacion' : 'pendiente', total_ars: V('totalARS', cuenta?.totalARS), total_usd: V('totalUSD', cuenta?.totalUSD), ars_jony: V('arsJONY', cuenta?.arsJONY), ars_myri: V('arsMyri', cuenta?.arsMyri), usd_myri: V('usdMyri', cuenta?.usdMyri), comi_ars: V('comiARS', cuenta?.comiARS), comi_usd: V('comiUSD', cuenta?.comiUSD), caja_jony: '', caja_myri: '', tipo_cambio: 0, stock_updates: stockUpdates, usd_jony: V('usdJONY', cuenta?.usdJONY), vid: vidVenta };
      if (ipVenta) fila.ip_h = ipVenta;
      // Numeración atómica: índice ÚNICO en n_venta + reintento (la versión SQL del LockService del
      // motor viejo — dos pedidos simultáneos NUNCA toman el mismo número).
      const ins = await insertarVentaAtomica(fila);
      if ('error' in ins) return json({ error: ins.error });
      const nVenta = ins.nVenta;
      // 🔗 v5.00: el pedido vino de un link armado → queda anotado como confirmado (y el aviso a Jony lo dice).
      const armadoT = Q('armado').replace(/[^a-z0-9]/gi, '').slice(0, 40);
      let deArmado = false;
      if (armadoT) {
        try {
          const rawAV = await getConfig('ARMADO_' + armadoT, '');
          if (rawAV) {
            const dAV = JSON.parse(rawAV);
            dAV.estado = 'confirmado'; dAV.nVenta = nVenta; dAV.confirmado = fechaAhora();
            await setConfig('ARMADO_' + armadoT, JSON.stringify(dAV));
            deArmado = true;
          }
        } catch { /* marcar el link jamás frena una venta */ }
      }
      // En cotización NO se descuenta stock (se descuenta recién al aceptarla desde el panel).
      if (stockUpdates && !esCotizacion) {
        // En PARALELO (feedback del usuario 13/07: el "Enviando pedido…" tardaba 15-20s con
        // carritos grandes — el descuento era secuencial, un roundtrip por producto).
        await Promise.all(stockUpdates.split(',').map(async (u: string) => {
          const pp = u.split(':'); const pid = pp[0], qty = parseInt(pp[1]) || 0;
          if (!pid || !qty) return;
          const res = await moverStockShuk(pid, -qty, 'Venta #' + nVenta + ' — ' + cliente);
          const sobre = res ? qty - res.antes : 0;
          if (res && sobre > 0) await sendTwilioWA('+5491131754540', '⚠️ *SOBREVENTA*\n' + res.nombre + ': el pedido #' + nVenta + ' (' + cliente + ') pidió *' + qty + '* y solo había *' + res.antes + '*. Faltan ' + sobre + ' — revisalo antes de confirmar.');
        }));
      }
      await altaClienteAuto(cliente, fila.tipo);
      // 🔔 Notificación WhatsApp DESDE EL SERVIDOR (caso de un pedido mayorista 13/07: la disparaba el navegador
      // del cliente después de enviar — si cerraba la pestaña, moría y el pedido entraba mudo).
      // Truncada a 1500 (Twilio rebota >1600, error 21617 — caso real 13/07).
      if (!esCotizacion) {
        try {
          let resu = (fila.productos || '').split(' || ').join('\n');
          const totNP: string[] = [];
          if (fila.total_ars > 0) totNP.push('$ ' + Math.round(fila.total_ars).toLocaleString('es-AR'));
          if (fila.total_usd > 0) totNP.push('U$S ' + Number(fila.total_usd).toFixed(2));
          let cuerpoV = '🛍️ *Nuevo pedido #' + nVenta + ' - Shuk Mamtakim*\n\n👤 *' + cliente + '* (' + fila.tipo + ')\n\n' + resu + (totNP.length ? '\n\n*Total:* ' + totNP.join(' + ') : '');
          if (deArmado) cuerpoV = '🔗 *Confirmó el pedido que le armaste por link*\n' + cuerpoV;
          if (correccion) cuerpoV = '⚠️ *REVISALO ANTES DE COBRAR*\n' + correccion.split(' · ').filter(Boolean).join('\n') + '\n\n' + cuerpoV;
          if (cuerpoV.length > 1500) cuerpoV = cuerpoV.slice(0, 1450) + '\n…\n📋 *Pedido largo: el detalle completo está en el panel.*';
          await sendTwilioWA('+5491131754540', cuerpoV);
        } catch { /* la notificación jamás frena una venta */ }
      }
      // Envío cobrado al cliente → Caja Envíos del dueño del pedido (el costo se carga al cobrar).
      const envCob = QN('envioCobrado');
      if (envCob > 0) await upsertEnvio(fila.id, { nVenta, cliente, dueno: duenoVenta(QN('arsJONY'), QN('usdJONY'), QN('arsMyri'), QN('usdMyri')), cobrado: Math.round(envCob) });
      return json({ ok: true, nVenta, id: fila.id });
    }
    if (accion === 'registrarPedidoHijo') {
      let items: any[]; try { items = JSON.parse(Q('items') || '[]'); } catch { return json({ error: 'items inválido' }); }
      if (!Array.isArray(items) || !items.length || items.length > 200) return json({ error: 'sin items' });
      // 🔒 v4.95: cada texto de cada renglón, limpio (el panel de los chicos los muestra).
      items = items.map((it: any) => { const o: any = {}; for (const [k, v] of Object.entries(it || {})) o[_ident(k, 40)] = typeof v === 'string' ? _libre(v, 200) : (typeof v === 'number' || typeof v === 'boolean' ? v : null); return o; });
      const hijo = _ident(Q('hijo'), 20), cliente = await clienteCanonicoCandy(_libre(Q('cliente'), 120));   // 🧑 grafía única (el pedido nace con el nombre ya conocido)
      if (!hijo || !cliente) return json({ error: 'falta hijo o cliente' });
      const total = QN('total') || items.reduce((s, it) => s + (parseFloat(it.subtotal) || 0), 0);
      // Anti pedidos falsos (paridad con la tienda Shuk): límite por dispositivo (vid) —
      // 90s entre pedidos, máx 4/hora. El WhatsApp igual se abre (el chico recibe el mensaje).
      const vidPH = _ident(Q('vid'));
      const ipPH = await huellaIP(req);   // 🚨 v4.99: freno por conexión y total (el vid lo elige el navegador)
      const frenoPH = await frenoPedidos('candy_pedidos', ipPH);
      if (frenoPH) { await avisarFreno('candy_pedidos', frenoPH); return json({ error: 'rate' }); }
      // 🚫 Dispositivo bloqueado (pedidos truchos 13/07: amigos de los chicos jugando)
      if (vidPH && (await getConfig('VIDBLOCK_' + vidPH, '')) === '1') return json({ error: 'rate' });
      if (vidPH) {
        const desdePH = new Date(Date.now() - 3600000).toISOString();
        const recPH = await sbGet('candy_pedidos', 'select=creado&vid=eq.' + encodeURIComponent(vidPH) + '&creado=gte.' + encodeURIComponent(desdePH) + '&order=creado.desc');
        if (recPH.length >= 4) return json({ error: 'rate' });
        if (recPH.length && Date.now() - new Date(recPH[0].creado).getTime() < 90000) return json({ error: 'rate' });
      }
      // 📱 Teléfono obligatorio (anti-truchos 13/07): sin WhatsApp válido no hay pedido
      const telPH = _tel(Q('telefono'));
      if (telDudoso(telPH)) return json({ error: 'telefono', detalle: 'Dejanos un WhatsApp válido (código de área + número, sin 0 ni 15) para confirmarte el pedido' });
      // 🎁 COMBO: expandir cada combo del pedido a sus COMPONENTES (la validación y la reserva
      // corren sobre los componentes reales; el combo en sí no tiene stock propio).
      const combosCat = await sbGet('candy_productos', 'select=codigo,componentes&componentes=neq.');
      const compMap: any = {}; combosCat.forEach((r: any) => { try { const cs = JSON.parse(r.componentes || '[]'); if (cs.length) compMap[r.codigo] = cs; } catch { /**/ } });
      const itemsReserva: any[] = [];
      for (const it of items) {
        const cs = compMap[(it.codigo || '').toString()];
        const uds = parseInt(it.cantidad) || 0;
        if (!cs) { itemsReserva.push(it); continue; }
        for (const c of cs) itemsReserva.push({ codigo: c.codigo, nombre: (c.nombre || c.codigo || '').toString(), cantidad: uds * Math.max(1, parseInt(c.cant) || 1), _deCombo: it.nombre || it.codigo });
      }
      // ── Segunda validación de stock (pedida por el usuario: como la del Shuk) ──
      // Mientras el cliente cargaba el carrito pudo venderse stock. Se chequea acá, ANTES de
      // registrar nada. "♾️ Siempre disponible" y el switch global de stock apagado quedan exentos.
      // Los shuk:<id> los valida el circuito (asegurarGenuinoShuk) más abajo con la familia real.
      const mostrarStockPH = (await getConfig('candy_mostrar_stock', '1')) !== '0';
      if (mostrarStockPH) {
        for (const it of itemsReserva) {
          const cod = (it.codigo || '').toString(), cant = parseInt(it.cantidad) || 0;
          if (!cod || cant <= 0 || cod.startsWith('shuk:')) continue;
          const cpV = await sbGet('candy_productos', 'select=siempre_disp&codigo=eq.' + encodeURIComponent(cod));
          if (cpV.length && cpV[0].siempre_disp === true) continue;
          const depV = await sbGet('candy_deposito', 'select=cantidad&codigo=eq.' + encodeURIComponent(cod));
          const dispV = depV.length ? (parseFloat(depV[0].cantidad) || 0) : 0;
          if (dispV < cant) return json({ error: 'stock', detalle: 'De "' + (it.nombre || cod) + '" quedan ' + Math.max(0, Math.floor(dispV)) + ' y pediste ' + cant });
        }
      }
      const pedidoId = _ident(Q('pedidoId'), 40) || 'PH' + Date.now();
      // Anti-duplicado (reintento por red caída): pedido_id es UNIQUE → el segundo insert rebota
      // ANTES de reservar stock (equivale al cache de 15 min del motor viejo, pero permanente).
      const r = await fetch(SB_URL + '/rest/v1/candy_pedidos', { method: 'POST', headers: { apikey: SERVICE, Authorization: 'Bearer ' + SERVICE, 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify({ hijo, cliente, telefono: telPH, items: JSON.stringify(items), total: Math.round(total), estado: 'pendiente', pedido_id: pedidoId, nota: _libre(Q('nota'), 500), vid: vidPH, ...(ipPH ? { ip_h: ipPH } : {}) }) });
      if (r.status === 409) return json({ ok: true, dup: true });
      if (!r.ok) return json({ error: 'insert pedido ' + r.status + ' ' + (await r.text()).slice(0, 150) });
      // Reserva: descuenta el depósito por cada item (la tienda ve menos stock → no se sobrevende).
      // Circuito F1: si es shuk: de Miri y falta genuino, primero se compra el paquete a Miri.
      for (const it of itemsReserva) {
        const cant = parseInt(it.cantidad) || 0, cod = (it.codigo || '').toString();
        if (cant <= 0 || !cod) continue;
        const cir = await asegurarGenuinoShuk(cod, cant, 'pedido tienda ' + hijo + ' [' + pedidoId + ']');
        if (cir.error) { await sbDelete('candy_pedidos', 'pedido_id=eq.' + encodeURIComponent(pedidoId)); return json({ error: cir.error }); }
        await ajustarDeposito(cod, (it.nombre || '').toString(), -cant, (it._deCombo ? '🎁 Combo "' + it._deCombo + '" · ' : '') + 'Reserva pedido tienda (' + hijo + ')');
      }
      return json({ ok: true, pedidoId });
    }
    if (accion === 'avisarmeCandy') {
      const prodAv = _libre(Q('producto'), 150), cliAv = _libre(Q('cliente'), 120), telAv = _tel(Q('telefono'));   // 🔒 v4.95
      if (telAv && telDudoso(telAv)) return json({ error: 'teléfono inválido' });   // opcional, pero si viene tiene que ser real
      await sbInsert('avisos_candy', { fecha: fechaAhora(), hijo: _ident(Q('hijo'), 20), codigo: _ident(Q('codigo')), producto: prodAv, cliente: cliAv, telefono: telAv, estado: 'pendiente' });
      const waTo = Q('wa').replace(/\D/g, '');
      if (WA_CANDY.includes(waTo)) await sendTwilioWA(waTo, `🔔 *Candy Shop* — te piden un producto agotado\n\n🍬 ${prodAv}\n👤 ${cliAv || 'cliente'}${telAv ? ' · ' + telAv : ''}\n\nCuando lo tengas, avisale 😉`);
      return json({ ok: true });
    }
    if (accion === 'track') {
      // 🔒 v4.95: todo lo que manda un visitante, limpio (la Analítica y el En vivo lo muestran en el panel).
      const tv = { vid: _ident(Q('vid')), pagina: _libre(Q('pagina'), 120) || 'tienda', evento: _ident(Q('evento'), 40) || 'visita', origen: _libre(Q('origen'), 200) || 'directo', dispositivo: _libre(Q('dispositivo'), 40), ciudad: _libre(Q('ciudad'), 80), region: _libre(Q('region'), 80), pais: _libre(Q('pais'), 60), nombre: _libre(Q('nombre'), 120), telefono: _tel(Q('telefono')), detalle: _libre(Q('producto'), 300), carrito: _libre(Q('carrito'), 8000) };
      await sbInsert('trafico', { fecha: fechaAhora(), ...tv, total: QN('total') });
      // Compatibilidad con el contador simple de visitas existente.
      if (tv.evento === 'visita') await sbInsert('visitas', { fecha: fechaAhora(), pagina: tv.pagina });
      // 🔔 v4.82: ¿esto merece un aviso al celular de Jony? (checkout, cliente conocido, búsqueda vacía, pico)
      try { await avisosInstantaneos({ vid: tv.vid, evento: tv.evento, detalle: tv.detalle, nombre: tv.nombre, telefono: tv.telefono, total: QN('total'), totalUSD: QN('totalUSD'), carrito: tv.carrito }); } catch { /* un aviso nunca frena el registro */ }
      return json({ ok: true });
    }
    if (accion === 'visitas') return json((await sbGet('visitas', 'select=fecha,pagina&order=id.asc')).map((r: any) => ({ fecha: (r.fecha || '').toString(), pagina: (r.pagina || '').toString() })));
    if (accion === 'registrarClienteMayorista') {
      const telM = Q('telefono').replace(/\D/g, '').slice(-10);
      const nomM = _libre(Q('nombre'), 120).trim();   // 🔒 v4.95
      if (!telM || !nomM) return json({ error: 'datos incompletos' });
      const todosC = await sbGet('clientes', 'select=id,nombre,telefono');
      const exC = todosC.find((c: any) => (c.telefono || '').toString().replace(/\D/g, '').slice(-10) === telM);
      if (exC) { await sbPatch('clientes', 'id=eq.' + exC.id, { ultimo_acceso: fechaAhora() }); return json({ ok: true, nuevo: false, nombre: (exC.nombre || nomM).toString() }); }
      const fM = fechaAhora();
      await sbInsert('clientes', { fecha: fM, nombre: nomM, telefono: telM, tipo: _libre(Q('tipo'), 30) || 'Mayorista', nota: '', ultimo_acceso: fM });
      return json({ ok: true, nuevo: true });
    }
    if (accion === 'notificarPedido') {
      // Twilio WA corta en 1600 caracteres (error 21617 — caso real: un pedido mayorista del
      // 13/07 nunca llegó). Si el resumen es largo, se recorta con aviso: el detalle está en el panel.
      let cuerpoNP = '🛍️ *Nuevo pedido - Shuk Mamtakim*\n\n👤 *' + Q('cliente') + '* (' + Q('tipo') + ')\n\n' + Q('resumen');
      if (cuerpoNP.length > 1500) cuerpoNP = cuerpoNP.slice(0, 1450) + '\n…\n📋 *Pedido largo: el detalle completo está en el panel.*';
      await sendTwilioWA('+5491131754540', cuerpoNP);
      return json({ ok: true });
    }
    // ═══ fin tienda pública ═══════════════════════════════════════════════════
    if (accion === 'aceptarCotizacion') {
      // Convierte una cotización en pedido pendiente y RECIÉN AHÍ descuenta el stock.
      const rowsAC = await sbGet('ventas', 'select=id,estado,stock_updates,n_venta&id=eq.' + encodeURIComponent(P(body, 'id')));
      if (!rowsAC.length) return json({ error: 'no encontrado' });
      if ((rowsAC[0].estado || '') !== 'cotizacion') return json({ error: 'no es cotización' });
      await sbPatch('ventas', 'id=eq.' + encodeURIComponent(rowsAC[0].id), { estado: 'pendiente' });
      const suAC = (rowsAC[0].stock_updates || '').toString();
      if (suAC) for (const u of suAC.split(',')) { const pp = u.split(':'); const qty = parseInt(pp[1]) || 0; if (pp[0] && qty) await moverStockShuk(pp[0], -qty, 'Cotización aceptada #' + (rowsAC[0].n_venta || '')); }
      return json({ ok: true });
    }
    if (accion === 'setStock') {
      const conflictos: any[] = [];
      for (const u of P(body, 'updates').split(',')) {
        const parts = u.split(':'); if (!parts[0]) continue;
        const pid = parts[0], ns = parseInt(parts[1]) || 0;
        const esperado = parts.length > 2 && parts[2] !== '' ? (parseInt(parts[2]) || 0) : null;
        const pr = await sbGet('productos', 'select=stock,nombre,fraccion_de&id=eq.' + encodeURIComponent(pid));
        if (!pr.length) continue;
        if ((pr[0].fraccion_de || '').toString().trim()) continue;   // ✂️ una fracción no tiene stock propio: sale de su bolsa
        const antes = parseInt(pr[0].stock) || 0;
        let finalVal = ns, hayConflicto = false;
        if (esperado !== null && antes !== esperado) { hayConflicto = true; finalVal = Math.max(0, antes + (ns - esperado)); conflictos.push({ id: pid, nombre: pr[0].nombre, esperaba: esperado, encontro: antes, aplicado: finalVal }); }
        if (finalVal !== antes) { await sbPatch('productos', 'id=eq.' + encodeURIComponent(pid), { stock: finalVal }); await sbInsert('movimientos_stock', { fecha: fechaAhora(), id_prod: pid, producto: pr[0].nombre, cambio: finalVal - antes, antes, despues: finalVal, origen: hayConflicto ? 'Ajuste manual (ajustado por venta en curso)' : 'Ajuste manual (pestaña Stock)' }); }
      }
      return json({ ok: true, conflictos });
    }
    if (accion === 'agregarCliente') { await sbInsert('clientes', { fecha: fechaAhora(), nombre: P(body, 'nombre'), telefono: P(body, 'telefono'), tipo: P(body, 'tipo') || 'Mayorista', nota: P(body, 'nota') }); return json({ ok: true }); }
    if (accion === 'editarCliente') {
      const patch: any = { nombre: P(body, 'nombre'), telefono: P(body, 'telefono'), tipo: P(body, 'tipo') || 'Mayorista' };
      if (has('nota')) patch.nota = P(body, 'nota');
      await sbPatch('clientes', 'nombre=eq.' + encodeURIComponent(P(body, 'nombreOriginal')), patch);
      return json({ ok: true });
    }
    if (accion === 'editarProducto') {
      const id = P(body, 'id');
      const pr = await sbGet('productos', 'select=stock,nombre,nombres_prev,fraccion_de,sueltas&id=eq.' + encodeURIComponent(id));
      if (!pr.length) return json({ error: 'producto no encontrado' });
      const esFraccionEP = !!(pr[0].fraccion_de || '').toString().trim();
      const patch: any = {};
      const map: any = { nombre: 'nombre', desc: 'descripcion', categoria: 'categoria', dueno: 'dueno', descBot: 'desc_bot', moneda: 'moneda', imagen: 'imagen', hashgaja: 'hashgaja', kosherTipo: 'kosher_tipo', jalav: 'jalav' };
      // '__VACIO__' = el front quiere VACIAR el campo (has() ignora '' → hace falta el centinela).
      // Sin esta traducción el texto literal quedaba guardado — 4 productos terminaron con
      // vinculo='__VACIO__' y el sistema los agrupaba como gemelos falsos (reparado 2026-07-05).
      const PV = (k: string) => { const v = P(body, k); return v === '__VACIO__' ? '' : v; };
      Object.keys(map).forEach((k) => { if (has(k)) patch[map[k]] = PV(k); });
      // RENOMBRADO SEGURO también en el editor simple (antes solo el masivo lo tenía): el nombre
      // viejo se guarda en nombres_prev → el Maaser/ganancia Pitzujim sigue matcheando las ventas
      // viejas por texto, y nada de la historia se pierde.
      if (has('nombre')) {
        const actual = (pr[0].nombre || '').toString().trim(), nuevo = P(body, 'nombre').trim();
        if (nuevo && actual && nuevo !== actual) {
          const prev = (pr[0].nombres_prev || '').toString();
          const lista = prev ? prev.split('|').map((s: string) => s.trim()).filter(Boolean) : [];
          if (lista.indexOf(actual) === -1) lista.push(actual);
          patch.nombres_prev = lista.join(' | ');
        }
      }
      if (has('precioMay')) patch.precio_may = parseFloat(P(body, 'precioMay').replace(',', '.')) || 0;
      if (has('precioMin')) patch.precio_min = parseFloat(P(body, 'precioMin').replace(',', '.')) || 0;
      if (has('costo')) patch.costo = parseFloat(P(body, 'costo').replace(',', '.')) || null;   // vacío/0 = sin costo (les avisa el "falta costo" del Maaser)
      if (has('activo')) patch.activo = P(body, 'activo').toUpperCase() !== 'NO';
      if (has('visible')) { patch.visible_cat = P(body, 'visible'); patch.visible = P(body, 'visible') !== 'No'; }   // Ambos/Min/May + boolean
      if (has('unidadesPorPaquete')) patch.unidades_por_paquete = Math.max(1, parseInt(P(body, 'unidadesPorPaquete')) || 1);   // Circuito Candy↔Shuk: cuántas unidades trae el paquete/bolsa
      if (body.etiqueta !== undefined) patch.etiqueta = P(body, 'etiqueta').trim().slice(0, 40);   // cinta de la tarjeta (texto corto)
      if (has('peso')) patch.peso = parseFloat(String(P(body, 'peso')).replace(',', '.')) || 0;   // peso por bolsa (g), interno — para orden de compra
      if (body.ean !== undefined) patch.ean = normEAN(P(body, 'ean'));   // código de barras: SUGIERE el producto al recibir, nunca decide solo (regla de gemelos)
      if (body.vinculo !== undefined) patch.vinculo = PV('vinculo');   // gemelos: mismo producto con stock de los dos dueños ('' / '__VACIO__' = desvincular)
      if (has('stock') && !esFraccionEP) { const antes = parseInt(pr[0].stock) || 0, nsx = parseInt(P(body, 'stock')) || 0; patch.stock = nsx; if (nsx !== antes) await sbInsert('movimientos_stock', { fecha: fechaAhora(), id_prod: id, producto: pr[0].nombre, cambio: nsx - antes, antes, despues: nsx, origen: 'Edición manual (editor de producto)' }); }
      // ✂️ v5.03: las unidades SUELTAS de una bolsa ya abierta (se corrigen a mano si se rompió/comió alguna).
      if (has('sueltas') && !esFraccionEP) { const antesS = parseInt(pr[0].sueltas) || 0, nsS = Math.max(0, parseInt(P(body, 'sueltas')) || 0); patch.sueltas = nsS; if (nsS !== antesS) await sbInsert('movimientos_stock', { fecha: fechaAhora(), id_prod: id, producto: pr[0].nombre, cambio: 0, antes: parseInt(pr[0].stock) || 0, despues: parseInt(pr[0].stock) || 0, origen: '✂️ Sueltas corregidas a mano: ' + antesS + ' → ' + nsS }); }
      if (esFraccionEP) { delete patch.dueno; delete patch.moneda; delete patch.costo; delete patch.precio_may; delete patch.unidades_por_paquete; }   // salen de la bolsa (lo fuerza también la base)
      await sbPatch('productos', 'id=eq.' + encodeURIComponent(id), patch);
      return json({ ok: true });
    }
    if (accion === 'actualizarOferta') {
      const id = P(body, 'id');
      const ex = await sbGet('productos', 'select=id&id=eq.' + encodeURIComponent(id));
      if (!ex.length) return json({ error: 'no encontrado' });
      await sbPatch('productos', 'id=eq.' + encodeURIComponent(id), { precio_oferta: N(body, 'precioOferta'), fecha_oferta: P(body, 'fechaOferta'), cant_pack: parseInt(P(body, 'cantPack')) || 0, precio_pack: N(body, 'precioPack') });
      return json({ ok: true });
    }
    if (accion === 'registrarCompraHijos') {
      let items: any[]; try { items = JSON.parse(P(body, 'items') || '[]'); } catch { return json({ error: 'items inválido' }); }
      if (!items.length) return json({ error: 'sin items' });
      // Dedup (M4): si el front manda compraId y ya existe, es un reintento — no duplicar.
      const cid = P(body, 'compraId') || 'C' + Date.now();
      if (P(body, 'compraId')) {
        const exC = await sbGet('candy_compras', 'select=id&compra_id=eq.' + encodeURIComponent(cid) + '&limit=1');
        if (exC.length) return json({ ok: true, dup: true, id: cid });
      }
      const fecha = has('fecha') ? P(body, 'fecha') : fechaAhora().slice(0, 10);
      const filas: any[] = []; const codigos = new Set<string>();
      items.forEach((it) => { const cant = parseInt(it.cantidad) || 0, costo = parseFloat(it.costoUnit) || 0; if (!it.codigo || cant <= 0) return; filas.push({ compra_id: cid, fecha, proveedor_id: P(body, 'proveedorId'), proveedor: P(body, 'proveedor'), codigo: it.codigo, producto: it.nombre || '', cantidad: cant, costo_unit: costo, costo_total: cant * costo, registrado_por: P(body, 'hijo') }); codigos.add(it.codigo); });
      if (filas.length) await sbInsert('candy_compras', filas);
      for (const it of items) { const cant = parseInt(it.cantidad) || 0, cod = (it.codigo || '').toString(); if (cant > 0 && cod) await ajustarDeposito(cod, it.nombre || '', cant, 'Compra a proveedor' + (P(body, 'proveedor') ? ' · ' + P(body, 'proveedor') : '')); }
      for (const cod of codigos) await actualizarCostoPromedio(cod);
      return json({ ok: true, id: cid });
    }
    if (accion === 'editarProductosLote') {
      let cambios: any[]; try { cambios = JSON.parse(P(body, 'cambios') || '[]'); } catch { return json({ error: 'json inválido' }); }
      if (!cambios.length) return json({ ok: true, n: 0 });
      const map: any = { desc: 'descripcion', categoria: 'categoria', dueno: 'dueno', descBot: 'desc_bot', moneda: 'moneda', hashgaja: 'hashgaja', kosherTipo: 'kosher_tipo', jalav: 'jalav' };
      let n = 0;
      for (const c of cambios) {
        const id = (c.id || '').toString(); if (!id) continue;
        const pr = await sbGet('productos', 'select=stock,nombre,nombres_prev,fraccion_de&id=eq.' + encodeURIComponent(id));
        if (!pr.length) continue;
        const esFraccionL = !!(pr[0].fraccion_de || '').toString().trim();
        const patch: any = {};
        Object.keys(c).forEach((k) => {
          if (k === 'id') return;
          if (esFraccionL && ['stock', 'dueno', 'moneda', 'costo', 'precioMay', 'unidadesPorPaquete'].indexOf(k) !== -1) return;   // ✂️ salen de la bolsa
          const v = (c[k] === null || c[k] === undefined) ? '' : c[k].toString();
          if (k === 'stock') { patch.stock = parseInt(v) || 0; return; }
          if (k === 'nombre') { const actual = (pr[0].nombre || '').trim(), nuevo = (v === '__VACIO__' ? '' : v).trim(); if (nuevo && actual && nuevo !== actual) { const prev = (pr[0].nombres_prev || '').toString(); const lista = prev ? prev.split('|').map((s: string) => s.trim()).filter(Boolean) : []; if (lista.indexOf(actual) === -1) lista.push(actual); patch.nombres_prev = lista.join(' | '); } if (nuevo) patch.nombre = nuevo; return; }
          if (k === 'precioMay') { patch.precio_may = parseFloat(v.replace(',', '.')) || 0; return; }
          if (k === 'precioMin') { patch.precio_min = parseFloat(v.replace(',', '.')) || 0; return; }
          if (k === 'costo') { patch.costo = parseFloat(v.replace(',', '.')) || 0; return; }
          if (k === 'visible') { patch.visible_cat = v; patch.visible = v !== 'No'; return; }
          if (k === 'unidadesPorPaquete') { patch.unidades_por_paquete = Math.max(1, parseInt(v) || 1); return; }
          if (k === 'etiqueta') { patch.etiqueta = String(v == null ? '' : v).trim().slice(0, 40); return; }
      if (k === 'peso') { patch.peso = parseFloat(String(v).replace(',', '.')) || 0; return; }
          if (k === 'ean') { patch.ean = normEAN(v); return; }
          if (k === 'vinculo') { patch.vinculo = (v === '__VACIO__' ? '' : v); return; }
          if (map[k]) patch[map[k]] = (v === '__VACIO__' ? '' : v);
        });
        if (patch.stock !== undefined) { const antes = parseInt(pr[0].stock) || 0; if (patch.stock !== antes) await sbInsert('movimientos_stock', { fecha: fechaAhora(), id_prod: id, producto: pr[0].nombre, cambio: patch.stock - antes, antes, despues: patch.stock, origen: 'Editor masivo' }); }
        await sbPatch('productos', 'id=eq.' + encodeURIComponent(id), patch);
        n++;
      }
      return json({ ok: true, n });
    }
    if (accion === 'eliminarProducto') {
      const ex = await sbGet('productos', 'select=nombre,stock,fraccion_de&id=eq.' + encodeURIComponent(P(body, 'id')));
      if (!ex.length) return json({ error: 'no encontrado' });
      // ✂️ v5.03: una bolsa con fracciones publicadas no se borra (las dejaría sin stock ni costo).
      const hijasE = await sbGet('productos', 'select=nombre&fraccion_de=eq.' + encodeURIComponent(P(body, 'id')));
      if (hijasE.length) return json({ error: 'Esta bolsa tiene ' + hijasE.length + ' fracci' + (hijasE.length === 1 ? 'ón publicada' : 'ones publicadas') + ' (' + hijasE.map((h: any) => h.nombre).join(', ') + '). Borralas primero.' });
      if ((ex[0].fraccion_de || '').toString().trim()) {   // borrar una fracción no toca stock: el stock es de la bolsa
        await sbInsert('borrados', { fecha: fechaAhora(), tipo: 'producto Shuk', detalle: ex[0].nombre + ' (id ' + P(body, 'id') + ', fracción de la bolsa ' + ex[0].fraccion_de + ')', por: '' });
        await sbDelete('productos', 'id=eq.' + encodeURIComponent(P(body, 'id')));
        return json({ ok: true });
      }
      const stk = parseInt(ex[0].stock) || 0;
      await sbInsert('movimientos_stock', { fecha: fechaAhora(), id_prod: P(body, 'id'), producto: ex[0].nombre, cambio: -stk, antes: stk, despues: 0, origen: 'Producto eliminado del catálogo' });
      await sbInsert('borrados', { fecha: fechaAhora(), tipo: 'producto Shuk', detalle: ex[0].nombre + ' (id ' + P(body, 'id') + ', stock ' + stk + ')', por: '' });
      await sbDelete('productos', 'id=eq.' + encodeURIComponent(P(body, 'id')));
      return json({ ok: true });
    }
    if (accion === 'setVisibilidadMasiva') {
      const ids = P(body, 'ids').split(',').map((s) => s.trim()).filter(Boolean);
      if (!ids.length) return json({ error: 'sin ids' });
      const valor = P(body, 'mostrar') === '1';
      await sbPatch('productos', 'id=in.(' + ids.map((x) => '"' + x + '"').join(',') + ')', { activo: valor });
      return json({ ok: true, n: ids.length, mostrar: valor });
    }
    if (accion === 'setCategoriaMasiva') {
      const ids = P(body, 'ids').split(',').map((s) => s.trim()).filter(Boolean);
      if (!ids.length) return json({ error: 'sin ids' });
      await sbPatch('productos', 'id=in.(' + ids.map((x) => '"' + x + '"').join(',') + ')', { categoria: P(body, 'categoria') || 'Varios' });
      return json({ ok: true, n: ids.length });
    }
    if (accion === 'agregarProducto') {
      const all = await sbGet('productos', 'select=id');
      let maxId = 0; all.forEach((p: any) => { const n = parseInt(p.id) || 0; if (n > maxId) maxId = n; });
      const nid = String(maxId + 1); const stockIni = parseInt(P(body, 'stock')) || 0;
      await sbInsert('productos', { id: nid, nombre: P(body, 'nombre'), descripcion: P(body, 'desc'), precio_may: parseFloat((P(body, 'pMay') || '').replace(',', '.')) || null, precio_min: parseFloat((P(body, 'pMin') || '').replace(',', '.')) || 0, stock: stockIni, imagen: P(body, 'imagen'), activo: true, categoria: P(body, 'categoria') || 'Varios', visible: P(body, 'visible') !== 'No', visible_cat: has('visible') ? P(body, 'visible') : 'Ambos', dueno: P(body, 'dueno') || 'Miri', desc_bot: P(body, 'descBot'), moneda: P(body, 'moneda') === 'U$S' ? 'U$S' : '$', costo: parseFloat((P(body, 'costo') || '').replace(',', '.')) || null, unidades_por_paquete: Math.max(1, parseInt(P(body, 'unidadesPorPaquete')) || 1), peso: parseFloat(String(P(body, 'peso') || '').replace(',', '.')) || 0, ean: normEAN(P(body, 'ean')), etiqueta: P(body, 'etiqueta').trim().slice(0, 40), hashgaja: P(body, 'hashgaja'), kosher_tipo: P(body, 'kosherTipo'), jalav: P(body, 'jalav') });
      if (stockIni > 0) await sbInsert('movimientos_stock', { fecha: fechaAhora(), id_prod: nid, producto: P(body, 'nombre'), cambio: stockIni, antes: 0, despues: stockIni, origen: 'Alta de producto' });
      return json({ ok: true, id: nid });
    }
    if (accion === 'crearFracciones') {
      // ✂️ v5.03 — PUBLICADOR DE FRACCIONES: de una bolsa de N unidades salen fichas "· x3", "· x5"… SOLO minorista.
      // Cada una es una ficha propia (su nombre y su precio en pesos); stock, costo, moneda y dueño los calcula la base
      // desde la bolsa (supabase_fracciones.sql) — acá nunca se escriben.
      let itemsF: any[]; try { itemsF = JSON.parse(P(body, 'items') || '[]'); } catch { return json({ error: 'items inválido' }); }
      if (!Array.isArray(itemsF) || !itemsF.length || itemsF.length > 20) return json({ error: 'sin fracciones para publicar' });
      const idPadre = P(body, 'padre').trim();
      const prF = await sbGet('productos', 'select=*&id=eq.' + encodeURIComponent(idPadre));
      if (!prF.length) return json({ error: 'no encontré la bolsa' });
      const padre = prF[0];
      if ((padre.fraccion_de || '').toString().trim()) return json({ error: 'eso ya es una fracción: se fracciona la bolsa entera' });
      const uppF = Math.max(1, parseInt(padre.unidades_por_paquete) || 1);
      if (uppF < 2) return json({ error: 'a «' + padre.nombre + '» le falta cargar cuántas unidades trae la bolsa (U/paq)' });
      const todosF = await sbGet('productos', 'select=id,nombre,fraccion_de,fraccion_cant');
      const nombresUsados = new Set(todosF.map((x: any) => (x.nombre || '').toString().trim().toLowerCase()));
      const cantsYa = new Set(todosF.filter((x: any) => String(x.fraccion_de || '') === String(padre.id)).map((x: any) => parseInt(x.fraccion_cant) || 0));
      let maxIdF = 0; todosF.forEach((x: any) => { const n = parseInt(x.id) || 0; if (n > maxIdF) maxIdF = n; });
      const filasF: any[] = [];
      for (const it of itemsF) {
        const cant = parseInt(it.cant) || 0, precio = Math.round(parseFloat(String(it.precio || '').replace(',', '.')) || 0);
        if (cant < 1 || cant >= uppF) return json({ error: 'la fracción tiene que ser de 1 a ' + (uppF - 1) + ' unidades (la bolsa trae ' + uppF + ')' });
        if (precio <= 0) return json({ error: 'falta el precio de la fracción x' + cant });
        if (cantsYa.has(cant)) return json({ error: 'ya hay una fracción x' + cant + ' de esta bolsa' });
        const nombreF = (_libre(String(it.nombre || ''), 120).trim() || nombreFraccion(padre.nombre, cant));   // ✂️ v5.04: "… x 5 unidades", no "… x 34 · x5"
        const descF = it.desc !== undefined ? _libre(String(it.desc || ''), 400).trim() : descFraccion(padre.descripcion || '', cant);
        if (nombresUsados.has(nombreF.toLowerCase())) return json({ error: 'ya existe un producto llamado «' + nombreF + '» (el nombre tiene que ser único: con él se calcula la ganancia)' });
        nombresUsados.add(nombreF.toLowerCase()); cantsYa.add(cant);
        filasF.push({ id: String(++maxIdF), nombre: nombreF, descripcion: descF, precio_min: precio, precio_may: null, stock: 0, imagen: padre.imagen || '', activo: true, categoria: padre.categoria || 'Varios', visible: true, visible_cat: 'Minorista', dueno: padre.dueno, desc_bot: padre.desc_bot || '', moneda: padre.moneda, costo: null, unidades_por_paquete: cant, peso: 0, ean: '', etiqueta: '', hashgaja: padre.hashgaja || '', kosher_tipo: padre.kosher_tipo || '', jalav: padre.jalav || '', fraccion_de: String(padre.id), fraccion_cant: cant });
      }
      await sbInsert('productos', filasF);
      for (const f of filasF) await sbInsert('movimientos_stock', { fecha: fechaAhora(), id_prod: f.id, producto: f.nombre, cambio: 0, antes: 0, despues: 0, origen: '✂️ Fracción publicada: x' + f.fraccion_cant + ' de «' + padre.nombre + '» (el stock sale de la bolsa)' });
      const creadas = await sbGet('productos', 'select=*&id=in.(' + filasF.map((f) => f.id).join(',') + ')');
      return json({ ok: true, creadas: creadas.map(prodAdmin) });
    }
    // ── ESCRITURAS (POST) ─────────────────────────────────────────────────────
    if (accion === 'registrarPagoCuenta') {
      if (N(body, 'montoARS') === 0 && N(body, 'montoUSD') === 0) return json({ error: 'monto vacío' });
      // ⚖️ AUTO-REPARTO (2026-07-07, pedido del usuario tras los casos de 5 clientes):
      // "cuando el cliente paga, paga, ya está" — el sistema separa SOLO qué parte del pago es
      // Pitzujim (de Jony) y qué parte golosinas (de Miri), contra la deuda viva FIFO del
      // cliente, con EXACTAMENTE el mismo orden que usan la ganancia (coberturaPagos) y la
      // cuenta entre socios: en $ Pitzujim primero, en U$S golosinas primero. El reparto queda
      // GUARDADO en el pago (monto_pitz / monto_pitz_usd) → caja, cuenta corriente y vista
      // Miri leen todos lo mismo. Si el front mandó montoPitz explícito (>0), se respeta.
      const _rep = P(body, 'reparto');
      const critPago = (_rep === 'jony' || _rep === 'prorrata' || _rep === 'forzado') ? _rep : '';
      const { pitzARS, pitzUSD } = await calcularRepartoPitz(P(body, 'cliente'), P(body, 'pedidoId'), N(body, 'montoARS'), N(body, 'montoUSD'), N(body, 'montoPitz'), undefined, critPago, N(body, 'montoPitzUsd'));
      // 📅 v3.95: si el modal manda la fecha real del pago, ESA va (si no, "ahora")
      const fechaPagoElegida = P(body, 'fecha').trim();
      const fechaPago = /^\d{2}\/\d{2}\/\d{4}( \d{2}:\d{2})?$/.test(fechaPagoElegida) ? fechaPagoElegida : fechaAhora();
      await sbInsert('pagos', { fecha: fechaPago, cliente: P(body, 'cliente'), pedido_id: P(body, 'pedidoId'), monto_ars: N(body, 'montoARS'), monto_usd: N(body, 'montoUSD'), monto_pitz: pitzARS, monto_pitz_usd: pitzUSD, caja: P(body, 'caja'), tc: N(body, 'tipoCambio'), nota: P(body, 'nota') || 'Pago a cuenta', comprobante: P(body, 'comprobante'), total_mano: N(body, 'totalMano') || null, reparto: critPago || null });
      // Circuito F3: pago del cliente "Candy" con TC → convertir compras del circuito a pesos.
      // Atado a un pedido → solo la compra de esa venta; general → todas las pendientes en U\$S.
      if ((P(body, 'cliente') || '').trim() === 'Candy' && N(body, 'tipoCambio') > 0) {
        try {
          let soloF3 = '';
          const pidF3 = P(body, 'pedidoId');
          if (pidF3) {
            const vF3 = await sbGet('ventas', 'select=n_venta&id=eq.' + encodeURIComponent(pidF3));
            if (vF3.length) soloF3 = 'CS' + vF3[0].n_venta;
          }
          await convertirComprasCircuito(N(body, 'tipoCambio'), soloF3);
        } catch { /**/ }
      }
      // El front muestra el reparto en el toast: el usuario VE a qué bolsillo fue cada peso.
      return json({ ok: true, reparto: { pitzARS, pitzUSD, golARS: Math.max(0, N(body, 'montoARS') - pitzARS), golUSD: Math.max(0, Math.round((N(body, 'montoUSD') - pitzUSD) * 100) / 100) } });
    }
    // ✂️ PAGO FRACCIONADO EN CAJAS (v4.05): el mismo pago, partido por dueño → la parte de Jony
    // (Pitzujim) va a la caja de Jony y la de Miri (golosinas) a la de Miri, cada una en su caja.
    // Así NO queda deuda entre socios (cada uno recibe su plata directo). Crea DOS filas de pago,
    // cada una con reparto guardado ('fraccionado' → coberturaPagos respeta las partes).
    if (accion === 'registrarPagoFraccionado') {
      if (!(await sesionValida(token))) return json({ error: 'sin permiso' });
      const mA = N(body, 'montoARS'), mU = N(body, 'montoUSD'), tc = N(body, 'tipoCambio');
      if (mA === 0 && mU === 0) return json({ error: 'monto vacío' });
      const critF = (P(body, 'reparto') === 'jony' || P(body, 'reparto') === 'prorrata') ? P(body, 'reparto') : '';
      const { pitzARS, pitzUSD } = await calcularRepartoPitz(P(body, 'cliente'), P(body, 'pedidoId'), mA, mU, N(body, 'montoPitz'), undefined, critF);
      const golARS = Math.max(0, mA - pitzARS), golUSD = Math.max(0, Math.round((mU - pitzUSD) * 100) / 100);
      const cajaMiri = P(body, 'cajaMiri'), cajaJony = P(body, 'cajaJony');
      if ((pitzARS > 0 || pitzUSD > 0) && !cajaJony) return json({ error: 'falta la caja de Jony (Pitzujim)' });
      if ((golARS > 0 || golUSD > 0) && !cajaMiri) return json({ error: 'falta la caja de Miri (golosinas)' });
      const fEl = P(body, 'fecha').trim();
      const fPago = /^\d{2}\/\d{2}\/\d{4}( \d{2}:\d{2})?$/.test(fEl) ? fEl : fechaAhora();
      const cli = P(body, 'cliente'), pid = P(body, 'pedidoId'), nota = P(body, 'nota') || 'Pago a cuenta', comp = P(body, 'comprobante');
      // Parte de Jony (Pitzujim) → caja de Jony (todo el monto es Pitzujim)
      if (pitzARS > 0 || pitzUSD > 0) {
        await sbInsert('pagos', { fecha: fPago, cliente: cli, pedido_id: pid, monto_ars: pitzARS, monto_usd: pitzUSD, monto_pitz: pitzARS, monto_pitz_usd: pitzUSD, caja: cajaJony, tc, nota, comprobante: comp, reparto: 'fraccionado' });
      }
      // Parte de Miri (golosinas) → caja de Miri (nada Pitzujim)
      if (golARS > 0 || golUSD > 0) {
        await sbInsert('pagos', { fecha: fPago, cliente: cli, pedido_id: pid, monto_ars: golARS, monto_usd: golUSD, monto_pitz: 0, monto_pitz_usd: 0, caja: cajaMiri, tc, nota, comprobante: comp, reparto: 'fraccionado' });
      }
      return json({ ok: true, jony: { ars: pitzARS, usd: pitzUSD, caja: cajaJony }, miri: { ars: golARS, usd: golUSD, caja: cajaMiri } });
    }
    // ✏️ EDITAR un pago a cuenta ya registrado (v3.96): corrige monto/caja/fecha/TC y RE-HACE el
    // auto-reparto Pitzujim/golosinas (excluyéndose a sí mismo). Todo lo demás (deuda, caja,
    // ganancia, cuenta socios) se recalcula solo desde la tabla pagos. nota/comprobante intactos.
    if (accion === 'editarPagoCuenta') {
      if (!(await sesionValida(token))) return json({ error: 'sin permiso' });
      const pidE = P(body, 'pagoId');
      const rowsE = await sbGet('pagos', 'select=*&id=eq.' + encodeURIComponent(pidE));
      if (!rowsE.length) return json({ error: 'ese pago ya no existe' });
      const pgE = rowsE[0];
      const mA = N(body, 'montoARS'), mU = N(body, 'montoUSD');
      if (mA === 0 && mU === 0) return json({ error: 'monto vacío' });
      const fEd = P(body, 'fecha').trim();
      const fFinal = /^\d{2}\/\d{2}\/\d{4}( \d{2}:\d{2})?$/.test(fEd) ? fEd : (pgE.fecha || fechaAhora());
      // criterio: el que mande el front, o el que ya tenía guardado el pago (no lo pierde al editar)
      const _critOk = (x: string) => x === 'jony' || x === 'prorrata' || x === 'forzado';
      const critEd = _critOk(P(body, 'reparto')) ? P(body, 'reparto') : (_critOk(pgE.reparto) ? pgE.reparto : '');
      // Un pago 'forzado' (devolución) conserva sus partes al editarse: el auto-reparto no las sabe deducir.
      const _pzA = critEd === 'forzado' ? (body.montoPitz !== undefined ? N(body, 'montoPitz') : (parseFloat(pgE.monto_pitz) || 0)) : 0;
      const _pzU = critEd === 'forzado' ? (body.montoPitzUsd !== undefined ? N(body, 'montoPitzUsd') : (parseFloat(pgE.monto_pitz_usd) || 0)) : 0;
      const rep = await calcularRepartoPitz((pgE.cliente || '').toString(), (pgE.pedido_id || '').toString(), mA, mU, _pzA, pidE, critEd, _pzU);
      // 🛡️ Si los MONTOS no cambiaron (se editó solo la nota, la fecha, la caja o el TC), se
      // conserva el reparto que ya tenía. Recalcularlo puede DESTRUIRLO: el auto-reparto lo deduce
      // de la deuda viva del cliente, y si esa deuda ya se cubrió (o el reparto se había forzado a
      // mano, como en una devolución) devuelve otra cosa y la plata cambia de dueño sola.
      // Caso real: pago #130 de un cliente (U$S 81 todos de Jony) → al editarle solo la nota, el
      // recálculo lo bajó a 0,03 y los otros 80,97 pasaban a golosinas de Miri.
      const _mismoMonto = Math.abs(mA - (parseFloat(pgE.monto_ars) || 0)) < 0.5
                       && Math.abs(mU - (parseFloat(pgE.monto_usd) || 0)) < 0.005;
      const _pitzARSFinal = _mismoMonto ? (parseFloat(pgE.monto_pitz) || 0) : rep.pitzARS;
      const _pitzUSDFinal = _mismoMonto ? (parseFloat(pgE.monto_pitz_usd) || 0) : rep.pitzUSD;
      const patchPago: any = { monto_ars: mA, monto_usd: mU, monto_pitz: _pitzARSFinal, monto_pitz_usd: _pitzUSDFinal, caja: P(body, 'caja'), fecha: fFinal, tc: N(body, 'tipoCambio'), reparto: critEd || null };
      if (body.totalMano !== undefined) patchPago.total_mano = N(body, 'totalMano') || null;   // total en mano (si el front lo recalculó)
      // 📝 Nota libre editable. Con '!== undefined' (no has()) para poder BORRARLA mandando vacío;
      // si no viene el campo, la nota queda intacta (PATCH parcial) → las llamadas viejas no la pisan.
      if (body.nota !== undefined) patchPago.nota = P(body, 'nota').trim().slice(0, 300) || 'Pago a cuenta';
      await sbPatch('pagos', 'id=eq.' + encodeURIComponent(pidE), patchPago);
      return json({ ok: true, reparto: rep });
    }
    // 🗑️ ANULAR un pago a cuenta (v3.96): lo borra; la deuda del cliente vuelve a subir y la
    // caja se ajusta solas (todo deriva de la tabla pagos). Sin materializado que reparar.
    if (accion === 'anularPagoCuenta') {
      if (!(await sesionValida(token))) return json({ error: 'sin permiso' });
      await sbDelete('pagos', 'id=eq.' + encodeURIComponent(P(body, 'pagoId')));
      return json({ ok: true });
    }
    // 🛒 ÓRDENES DE COMPRA / REPOSICIÓN (v4.06): guardar/listar/leer. Tabla ordenes_compra con RLS
    // (solo la EF con service_role la toca). items = JSON de lo que se va a reponer.
    if (accion === 'guardarOrdenCompra') {
      if (!(await sesionValida(token))) return json({ error: 'sin permiso' });
      let itemsOC: any[] = []; try { itemsOC = JSON.parse(P(body, 'items') || '[]'); } catch { itemsOC = []; }
      if (!itemsOC.length) return json({ error: 'orden vacía' });
      const oidOC = P(body, 'id');
      const camposOC = { items: itemsOC, total_peso: N(body, 'totalPeso'), total_costo: N(body, 'totalCosto'), nota: P(body, 'nota') };
      if (oidOC) {   // editar una orden existente (no pisa la fecha original)
        await sbPatch('ordenes_compra', 'id=eq.' + encodeURIComponent(oidOC), camposOC);
        return json({ ok: true, id: oidOC });
      }
      // insert devolviendo el id (para poder ir actualizando la misma lista, ej. auto-guardado desde Lo más vendido)
      const insOC = await fetch(SB_URL + '/rest/v1/ordenes_compra', { method: 'POST', headers: { apikey: SERVICE, Authorization: 'Bearer ' + SERVICE, 'Content-Type': 'application/json', Prefer: 'return=representation' }, body: JSON.stringify({ fecha: P(body, 'fecha') || fechaAhora(), estado: 'abierta', ...camposOC }) });
      if (!insOC.ok) return json({ error: 'no se pudo guardar la orden' });
      const newOC = await insOC.json().catch(() => []);
      return json({ ok: true, id: Array.isArray(newOC) && newOC[0] ? newOC[0].id : undefined });
    }
    if (accion === 'listarOrdenesCompra') {
      if (!(await sesionValida(token))) return json({ error: 'sin permiso' });
      const rowsOC = await sbGet('ordenes_compra', 'select=id,fecha,total_peso,total_costo,nota,estado&order=id.desc&limit=40');
      return json(rowsOC.map((o: any) => ({ id: o.id, fecha: o.fecha, totalPeso: parseFloat(o.total_peso) || 0, totalCosto: parseFloat(o.total_costo) || 0, nota: (o.nota || '').toString(), estado: (o.estado || '').toString() })));
    }
    if (accion === 'getOrdenCompra') {
      if (!(await sesionValida(token))) return json({ error: 'sin permiso' });
      const rowsG = await sbGet('ordenes_compra', 'select=*&id=eq.' + encodeURIComponent(Q('id')));
      if (!rowsG.length) return json({ error: 'no existe' });
      const o = rowsG[0];
      let its: any[] = []; try { its = typeof o.items === 'string' ? JSON.parse(o.items) : (o.items || []); } catch { its = []; }
      return json({ id: o.id, fecha: o.fecha, items: its, totalPeso: parseFloat(o.total_peso) || 0, totalCosto: parseFloat(o.total_costo) || 0, nota: (o.nota || '').toString(), estado: (o.estado || '').toString() });
    }
    if (accion === 'borrarOrdenCompra') {
      if (!(await sesionValida(token))) return json({ error: 'sin permiso' });
      await sbDelete('ordenes_compra', 'id=eq.' + encodeURIComponent(P(body, 'id')));
      return json({ ok: true });
    }
    if (accion === 'registrarMovSocio') {
      if (N(body, 'montoARS') === 0 && N(body, 'montoUSD') === 0) return json({ error: 'nada para registrar' });
      await sbInsert('movs_socios', { fecha: P(body, 'fecha') || fechaAhora(), descripcion: P(body, 'desc') || 'Movimiento entre socios', monto_ars: N(body, 'montoARS'), monto_usd: N(body, 'montoUSD') });
      return json({ ok: true });
    }
    if (accion === 'saldarSocios') {
      if (N(body, 'montoARS') === 0 && N(body, 'montoUSD') === 0) return json({ error: 'nada para saldar' });
      await sbInsert('liquidacion_socios', { fecha: fechaAhora(), monto_ars: N(body, 'montoARS'), monto_usd: N(body, 'montoUSD'), nota: P(body, 'nota') || 'Saldo entre socios' });
      return json({ ok: true });
    }
    if (accion === 'gasto') {
      await sbInsert('gastos', { fecha: fechaAhora(), descripcion: P(body, 'desc'), monto: N(body, 'monto'), moneda: P(body, 'moneda') || 'ARS', categoria: P(body, 'categoria'), columna: P(body, 'columna'), comprobante: P(body, 'comprobante') });
      return json({ ok: true });
    }
    if (accion === 'rendicion') {
      await sbInsert('rendiciones', { fecha: P(body, 'fecha') || fechaAhora(), descripcion: P(body, 'desc'), monto: N(body, 'monto'), moneda: P(body, 'moneda') || 'ARS', columna: P(body, 'columna'), comprobante: P(body, 'comprobante') });
      return json({ ok: true });
    }
    if (accion === 'actualizarPedido') {
      const id = P(body, 'id');
      const rows = await sbGet('ventas', 'select=*&id=eq.' + encodeURIComponent(id));
      if (!rows.length) return json({ error: 'no encontrado' });
      const v = rows[0]; const patch: any = {};
      if (has('productos')) patch.productos = P(body, 'productos');
      if (has('tipo')) patch.tipo = P(body, 'tipo');
      if (body.cliente !== undefined && P(body, 'cliente').trim()) {
        const nuevo = P(body, 'cliente').trim(), ant = (v.cliente || '').toString().trim();
        if (normCli(nuevo) !== normCli(ant) || nuevo !== ant) {
          patch.cliente = nuevo;
          await sbPatch('pagos', 'pedido_id=eq.' + encodeURIComponent(id), { cliente: nuevo });   // arrastrar los pagos del pedido
          const exC = await sbGet('clientes', 'select=id&nombre=eq.' + encodeURIComponent(nuevo));
          if (!exC.length) await sbInsert('clientes', { fecha: fechaAhora(), nombre: nuevo, telefono: '', tipo: P(body, 'tipo') || (v.tipo || 'Mayorista'), nota: '' });
        }
      }
      if (body.totalARS !== undefined) patch.total_ars = N(body, 'totalARS');
      if (body.totalUSD !== undefined) patch.total_usd = N(body, 'totalUSD');
      if (body.arsJONY !== undefined) patch.ars_jony = N(body, 'arsJONY');
      if (body.arsMyri !== undefined) patch.ars_myri = N(body, 'arsMyri');
      if (body.usdMyri !== undefined) patch.usd_myri = N(body, 'usdMyri');
      if (body.comiARS !== undefined) patch.comi_ars = N(body, 'comiARS');
      if (body.comiUSD !== undefined) patch.comi_usd = N(body, 'comiUSD');
      if (body.usdJONY !== undefined) patch.usd_jony = N(body, 'usdJONY');
      if (has('tipoCambio') && N(body, 'tipoCambio') > 0) patch.tipo_cambio = N(body, 'tipoCambio');
      if (has('stockUpdatesNuevo')) patch.stock_updates = P(body, 'stockUpdatesNuevo');
      const estadoPed = (v.estado || '').toString().trim();
      if (has('stockDeltas') && estadoPed !== 'cotizacion') {
        for (const u of P(body, 'stockDeltas').split(',')) { const pp = u.split(':'); const pid = pp[0], delta = parseInt(pp[1]) || 0; if (!delta) continue; await moverStockShuk(pid, delta, 'Edición pedido #' + (v.n_venta || '')); }
      }
      // ⚖️ RECONCILIACIÓN COBRO vs TOTAL (caso #46): editar un pedido YA COBRADO
      // agregándole productos no puede "cobrarse solo" — lo cubierto real son los tramos, y el
      // faltante queda como tramo Cta Cte → la tarjeta muestra "cobro parcial · debe X", entra
      // a la cuenta corriente y las cajas no se inflan. Se compara POR MONEDA contra el total
      // (no por balde: una redistribución Jony↔Miri del mismo total no genera deuda fantasma).
      // Solo corre si la edición mandó totales (el corrector de splits viejos no los manda).
      let deudaNueva: any = null;
      // 💸 SOBRECOBRO (v4.41): si el total BAJA en un pedido ya cobrado (típico: devolución), la
      // plata real que el cliente ya pagó y ahora no debe quedaba en el aire — nadie avisaba y
      // la caja mostraba menos de lo que había (caso #33, U$S 81). Se informa al front con
      // el reparto por dueño y la caja original, para ofrecerlo como saldo a favor.
      let sobrecobro: any = null;
      const realCaja = (c: any) => !!c && !String(c).startsWith('CTA_CTE');
      if ((body.totalARS !== undefined || body.totalUSD !== undefined) && (realCaja(v.caja_jony) || realCaja(v.caja_myri)) && estadoPed !== 'cancelado' && estadoPed !== 'cotizacion') {
        let tram: any[] = [];
        try { tram = JSON.parse((v.tramos || '').toString() || '[]') || []; } catch { tram = []; }
        if (!Array.isArray(tram)) tram = [];
        // Cobro viejo de un toque (sin tramos): lo cubierto fue el split ANTERIOR entero →
        // se sintetizan tramos equivalentes (misma caja/conversión que ya usaba el cuadro de cajas).
        if (!tram.length) {
          const cJ = (v.caja_jony || '').toString(), cM = (v.caja_myri || '').toString();
          const tcV = parseFloat(v.tipo_cambio) || 0;
          const esUSDCaja = (c: string) => ['ETF_USD_MYRI', 'ETF_USD_JONY', 'CTA_CTE_USD'].indexOf(c) !== -1;
          const cajaUSDde = (c: string, fb: string) => esUSDCaja(c) ? c : (tcV > 0 ? c : fb);
          const vjA = parseFloat(v.ars_jony) || 0, vmA = parseFloat(v.ars_myri) || 0;
          const vjU = parseFloat(v.usd_jony) || 0, vmU = parseFloat(v.usd_myri) || 0;
          if (vjA > 0 && cJ) tram.push({ balde: 'arsJ', dueno: 'J', moneda: 'ARS', caja: cJ, monto: vjA });
          if (vjU > 0 && cJ) tram.push({ balde: 'usdJ', dueno: 'J', moneda: 'USD', caja: cajaUSDde(cJ, 'ETF_USD_JONY'), monto: vjU });
          if (vmA > 0 && cM) tram.push({ balde: 'arsM', dueno: 'M', moneda: 'ARS', caja: cM, monto: vmA });
          if (vmU > 0 && cM) tram.push({ balde: 'usdM', dueno: 'M', moneda: 'USD', caja: cajaUSDde(cM, 'ETF_USD_MYRI'), monto: vmU });
        }
        const obj: any = {
          jA: body.arsJONY !== undefined ? N(body, 'arsJONY') : (parseFloat(v.ars_jony) || 0),
          mA: body.arsMyri !== undefined ? N(body, 'arsMyri') : (parseFloat(v.ars_myri) || 0),
          jU: body.usdJONY !== undefined ? N(body, 'usdJONY') : (parseFloat(v.usd_jony) || 0),
          mU: body.usdMyri !== undefined ? N(body, 'usdMyri') : (parseFloat(v.usd_myri) || 0)
        };
        const duenoDe = (t: any) => t.dueno === 'J' ? 'J' : 'M';
        for (const cur of ['ARS', 'USD']) {
          const eps = cur === 'USD' ? 0.01 : 1;
          const rnd = (x: number) => cur === 'USD' ? Math.round(x * 100) / 100 : Math.round(x);
          const deCur = (t: any) => (t.moneda === 'USD' ? 'USD' : 'ARS') === cur;
          const cubJ = tram.reduce((s, t) => s + (deCur(t) && duenoDe(t) === 'J' ? (parseFloat(t.monto) || 0) : 0), 0);
          const cubM = tram.reduce((s, t) => s + (deCur(t) && duenoDe(t) === 'M' ? (parseFloat(t.monto) || 0) : 0), 0);
          const objJ = cur === 'USD' ? obj.jU : obj.jA, objM = cur === 'USD' ? obj.mU : obj.mA;
          let diff = rnd(objJ + objM - (cubJ + cubM));
          const ctaCaja = cur === 'USD' ? 'CTA_CTE_USD' : 'CTA_CTE_ARS';
          if (diff > eps) {
            // Faltante nuevo → deuda Cta Cte, atribuida al dueño que quedó corto
            let asigJ = Math.min(diff, Math.max(0, rnd(objJ - cubJ)));
            let asigM = rnd(diff - asigJ);
            for (const [dn, monto] of [['J', asigJ], ['M', asigM]] as [string, number][]) {
              if (monto <= eps / 2) continue;
              const ex = tram.find((t) => deCur(t) && duenoDe(t) === dn && String(t.caja || '').startsWith('CTA_CTE'));
              if (ex) ex.monto = rnd((parseFloat(ex.monto) || 0) + monto);
              else tram.push({ balde: (cur === 'USD' ? 'usd' : 'ars') + dn, dueno: dn, moneda: cur, caja: ctaCaja, monto });
            }
            deudaNueva = deudaNueva || { ars: 0, usd: 0 };
            if (cur === 'USD') deudaNueva.usd += diff; else deudaNueva.ars += diff;
          } else if (diff < -eps) {
            // El total BAJÓ: se achica primero la deuda Cta Cte; la plata real ya cobrada no se
            // toca (el sobrecobro se resuelve con el cliente, pero ahora SE AVISA).
            for (const t of tram) {
              if (diff >= -eps) break;
              if (!deCur(t) || !String(t.caja || '').startsWith('CTA_CTE')) continue;
              const m = parseFloat(t.monto) || 0;
              const quita = Math.min(m, -diff);
              t.monto = rnd(m - quita); diff = rnd(diff + quita);
            }
            // Lo que sigue sobrando ya entró a una caja real → es plata del cliente a favor.
            if (diff < -eps) {
              const sobra = rnd(-diff);
              const cubJ2 = tram.reduce((s, t) => s + (deCur(t) && duenoDe(t) === 'J' ? (parseFloat(t.monto) || 0) : 0), 0);
              const sobraJ = Math.max(0, Math.min(sobra, rnd(cubJ2 - objJ)));   // parte de Jony (Pitzujim)
              const tReal = tram.filter((t) => deCur(t) && realCaja(t.caja))
                .sort((a, b) => (parseFloat(b.monto) || 0) - (parseFloat(a.monto) || 0))[0];
              sobrecobro = sobrecobro || { ars: 0, usd: 0, pitzARS: 0, pitzUSD: 0, cajaARS: '', cajaUSD: '', tc: parseFloat(v.tipo_cambio) || 0, cliente: (v.cliente || '').toString(), nVenta: v.n_venta };
              if (cur === 'USD') { sobrecobro.usd = sobra; sobrecobro.pitzUSD = sobraJ; if (tReal) sobrecobro.cajaUSD = tReal.caja; }
              else { sobrecobro.ars = sobra; sobrecobro.pitzARS = sobraJ; if (tReal) sobrecobro.cajaARS = tReal.caja; }
            }
          }
        }
        patch.tramos = JSON.stringify(tram.filter((t) => (parseFloat(t.monto) || 0) > 0.005));
      }
      await sbPatch('ventas', 'id=eq.' + encodeURIComponent(id), patch);
      if (has('envioCobrado')) {
        const _aJ = body.arsJONY !== undefined ? N(body, 'arsJONY') : (v.ars_jony || 0);
        const _uJ = body.usdJONY !== undefined ? N(body, 'usdJONY') : (v.usd_jony || 0);
        const _aM = body.arsMyri !== undefined ? N(body, 'arsMyri') : (v.ars_myri || 0);
        const _uM = body.usdMyri !== undefined ? N(body, 'usdMyri') : (v.usd_myri || 0);
        await upsertEnvio(id, { nVenta: v.n_venta, cliente: (v.cliente || '').toString(), dueno: duenoVenta(_aJ, _uJ, _aM, _uM), cobrado: Math.round(N(body, 'envioCobrado')) });
      }
      return json({ ok: true, deudaNueva, sobrecobro });
    }
    if (accion === 'confirmarCobro') return json(await confirmarCobro(body));
    if (accion === 'cargarSaldoCC') {
      // Carga manual de un saldo a la cuenta corriente (saldo viejo del Excel o venta externa).
      // Crea un "pedido" pendiente sin caja → figura como deuda. dueno Myri|Jony, comision si|no.
      const clienteSC = P(body, 'cliente');
      if (!clienteSC) return json({ error: 'falta cliente' });
      const montoARS = Math.round(N(body, 'montoARS')), montoUSD = N(body, 'montoUSD');
      if (montoARS <= 0 && montoUSD <= 0) return json({ error: 'monto vacío' });
      const duenoSC = P(body, 'dueno') === 'Jony' ? 'Jony' : 'Myri';
      const sacaComi = (P(body, 'comision') || 'no') === 'si';
      const notaSC = P(body, 'nota');
      let arsJONY = 0, arsMyri = 0, usdMyri = 0, usdJONY = 0, comiARS = 0, comiUSD = 0, sinComi = '';
      if (duenoSC === 'Jony') {
        arsJONY = montoARS; usdJONY = montoUSD; sinComi = 'SI';   // ventas de Jony NUNCA generan comisión
      } else {
        arsMyri = montoARS; usdMyri = montoUSD;
        if (sacaComi) { comiARS = Math.round(arsMyri * 0.15); comiUSD = Math.round(usdMyri * 0.15 * 100) / 100; }
        else sinComi = 'SI';
      }
      const tagSC = (duenoSC === 'Jony' ? 'Pitzujim' : 'Golosinas') + (sacaComi ? '' : ' (sin comisión)');
      const lineasSC: string[] = [];
      if (montoARS > 0) lineasSC.push(`• Saldo cargado · ${notaSC || tagSC} — $ ${montoARS} c/u = $ ${montoARS}`);
      if (montoUSD > 0) lineasSC.push(`• Saldo cargado · ${notaSC || tagSC} — U$S ${montoUSD.toFixed(2)} c/u = U$S ${montoUSD.toFixed(2)}`);
      const insSC = await insertarVentaAtomica({ fecha: fechaAhora(), cliente: clienteSC, tipo: duenoSC === 'Jony' ? 'Mayorista' : 'Minorista', productos: lineasSC.join(' || '), forma_pago: 'Cuenta corriente', notas: 'Saldo cargado' + (notaSC ? ': ' + notaSC : ''), estado: 'pendiente', total_ars: arsJONY + arsMyri, total_usd: usdMyri + usdJONY, ars_jony: arsJONY, ars_myri: arsMyri, usd_myri: usdMyri, comi_ars: comiARS, comi_usd: comiUSD, caja_jony: '', caja_myri: '', tipo_cambio: 0, stock_updates: '', sin_comi: sinComi || null, usd_jony: usdJONY, vid: '' });
      if ('error' in insSC) return json({ error: insSC.error });
      await altaClienteAuto(clienteSC, duenoSC === 'Jony' ? 'Mayorista' : 'Minorista');
      return json({ ok: true, id: insSC.id, nVenta: insSC.nVenta });
    }
    if (accion === 'editarNotaPedido') {
      const exN = await sbGet('ventas', 'select=id&id=eq.' + encodeURIComponent(P(body, 'id')));
      if (!exN.length) return json({ error: 'no encontrado' });
      await sbPatch('ventas', 'id=eq.' + encodeURIComponent(P(body, 'id')), { notas: P(body, 'nota') });
      return json({ ok: true });
    }
    if (accion === 'renumerarVentas') {
      // Reasigna el # de venta correlativo y ÚNICO (1,2,3…) por orden actual. El # es cosmético
      // (la plata va por el ID interno). dry=1 → vista previa. Dos pasadas por el índice único.
      const todasR = (await sbGet('ventas', 'select=id,n_venta,cliente,fecha&order=n_venta')).filter((v: any) => v.id);
      const cambiosR: any[] = [];
      todasR.forEach((v: any, i: number) => { const nuevo = i + 1, viejo = parseInt(v.n_venta) || 0; if (nuevo !== viejo) cambiosR.push({ viejo, nuevo, cliente: (v.cliente || '').toString(), fecha: (v.fecha || '').toString().slice(0, 10) }); });
      if (P(body, 'dry') === '1') return json({ ok: true, total: todasR.length, cambios: cambiosR.slice(0, 200), totalCambios: cambiosR.length });
      for (let i = 0; i < todasR.length; i++) await sbPatch('ventas', 'id=eq.' + encodeURIComponent(todasR[i].id), { n_venta: -(i + 1) });   // fase 1: sin chocar el índice único
      for (let i = 0; i < todasR.length; i++) await sbPatch('ventas', 'id=eq.' + encodeURIComponent(todasR[i].id), { n_venta: i + 1 });
      return json({ ok: true, total: todasR.length, cambiados: cambiosR.length });
    }
    if (accion === 'setSaldoInicial') {
      await sbInsert('ganancias_jony', { fecha: fechaAhora(), tipo: 'saldo_inicial', descripcion: 'Saldo inicial', monto: N(body, 'monto') });
      return json({ ok: true });
    }
    if (accion === 'registrarVentaHijos') {
      // Venta de UNA línea (camino viejo del panel Candy; el wizard usa registrarVentaLote).
      const ventaIdS = P(body, 'ventaId');
      if (ventaIdS) {
        const kS = 'vh_' + ventaIdS;
        const exS = await sbGet('config', 'select=clave&clave=eq.' + encodeURIComponent(kS));
        if (exS.length) return json({ ok: true, dup: true });
        await setConfig(kS, fechaAhora());
      }
      const fechaS = has('fecha') ? fechaRetro(P(body, 'fecha')) : fechaAhora();
      if (body.cliente !== undefined) body.cliente = await clienteCanonicoCandy(P(body, 'cliente'));   // 🧑 grafía única
      await sbInsert('candy_ventas', { fecha: fechaS, hijo: P(body, 'hijo'), producto: P(body, 'productoNombre'), codigo: P(body, 'productoCodigo'), cantidad: parseInt(P(body, 'cantidad')) || 1, precio: N(body, 'precio'), total: N(body, 'total'), cliente: P(body, 'cliente'), es_debe: P(body, 'esDebe') || 'NO', pago_parcial: N(body, 'pagoParcial'), saldo_pendiente: N(body, 'saldoPendiente'), metodo_pago: P(body, 'metodoPago') === 'mp' ? 'mp' : 'efectivo' });
      if (N(body, 'saldoPendiente') > 0 && P(body, 'cliente')) {
        const q = parseInt(P(body, 'cantidad')) || 1;
        await sbInsert('candy_cc', { fecha: fechaAhora(), hijo: P(body, 'hijo'), cliente: P(body, 'cliente'), monto: N(body, 'saldoPendiente'), tipo: 'deuda', detalle: P(body, 'productoNombre') + (q > 1 ? ' x' + q : '') });
      }
      return json({ ok: true });
    }
    if (accion === 'ventasHoy') {
      // Ventas de un chico de HOY (o del día pedido, dd/MM/yyyy) — mismo shape que el motor.
      const hijoV = url.searchParams.get('hijo') || P(body, 'hijo');
      const diaV = /^\d{2}\/\d{2}\/\d{4}$/.test(P(body, 'dia')) ? P(body, 'dia') : fechaAhora().slice(0, 10);
      const vsH = await sbGet('candy_ventas', 'select=*&hijo=eq.' + encodeURIComponent(hijoV));
      return json(vsH.filter((v: any) => (v.fecha || '').toString().trim().substring(0, 10) === diaV)
        .map((v: any) => ({ rowIndex: v.id, producto: v.producto, codigo: v.codigo, cantidad: v.cantidad, precio: v.precio, cliente: v.cliente, saldoPendiente: v.saldo_pendiente, metodoPago: (v.metodo_pago || 'efectivo').toString(), hora: (v.fecha || '').toString().trim().substring(11, 16) })));
    }
    // ── CANDY: registrar una venta de un chico (varias líneas) + su cuenta corriente ──
    if (accion === 'registrarVentaLote') {
      // Anti-duplicado por ventaId (reintento del wizard con red caída) — espejo del cache
      // de 15 min del motor viejo, guardado en config (el cron limpia las claves viejas).
      const ventaIdW = P(body, 'ventaId');
      if (ventaIdW) {
        const kW = 'vh_' + ventaIdW;
        const exW = await sbGet('config', 'select=clave&clave=eq.' + encodeURIComponent(kW));
        if (exW.length) return json({ ok: true, dup: true });
        await setConfig(kW, fechaAhora());
      }
      let items: any[]; try { items = JSON.parse(P(body, 'items') || '[]'); } catch { return json({ error: 'items inválido' }); }
      if (!items.length) return json({ error: 'sin items' });
      const hijo = P(body, 'hijo'), cliente = await clienteCanonicoCandy(P(body, 'cliente')), esDebe = P(body, 'esDebe') || 'NO';   // 🧑 grafía única
      const pagoParcial = N(body, 'pagoParcial'), metodo = P(body, 'metodoPago') === 'mp' ? 'mp' : 'efectivo';
      const fecha = has('fecha') ? fechaRetro(P(body, 'fecha')) : fechaAhora();
      const filas = items.map((it) => ({ fecha, hijo, producto: it.productoNombre || '', codigo: it.productoCodigo || '', cantidad: parseInt(it.cantidad) || 1, precio: parseFloat(it.precio) || 0, total: parseFloat(it.total) || 0, cliente, es_debe: esDebe, pago_parcial: pagoParcial, saldo_pendiente: parseFloat(it.saldoPendiente) || 0, metodo_pago: metodo }));
      await sbInsert('candy_ventas', filas);
      const cc: any[] = [];
      items.forEach((it) => { const sp = parseFloat(it.saldoPendiente) || 0; if (sp > 0 && cliente) { const q = parseInt(it.cantidad) || 1; cc.push({ fecha, hijo, cliente, monto: sp, tipo: 'deuda', detalle: (it.productoNombre || '') + (q > 1 ? ' x' + q : '') }); } });
      if (has('vueltoMonto') && cliente) cc.push({ fecha, hijo, cliente, monto: -(N(body, 'vueltoMonto')), tipo: 'vuelto', detalle: P(body, 'vueltoProducto') });
      if (cc.length) await sbInsert('candy_cc', cc);
      return json({ ok: true, n: filas.length });
    }
    if (accion === 'registrarConsumoHijos') {
      await sbInsert('candy_consumo', { fecha: fechaAhora(), hijo: P(body, 'hijo'), producto: P(body, 'productoNombre'), codigo: P(body, 'productoCodigo'), cantidad: parseInt(P(body, 'cantidad')) || 1, costo: N(body, 'costo'), motivo: P(body, 'motivo') || 'comido', nota: P(body, 'nota') });
      return json({ ok: true });
    }
    if (accion === 'resolverAvisoCandy') { const row = P(body, 'row'); if (!row) return json({ ok: false }); await sbPatch('avisos_candy', 'id=eq.' + encodeURIComponent(row), { estado: 'listo' }); return json({ ok: true }); }
    if (accion === 'setEstadoTienda') { await setConfig('TIENDA_ESTADO', P(body, 'estado') || 'abierta'); if (body.mensaje !== undefined) await setConfig('TIENDA_MSG', P(body, 'mensaje')); return json({ ok: true }); }
    // 🌎 Vidriera geográfica (provisoria): interruptor que limita la WEB (no el backend) al Mercosur.
    if (accion === 'setGeoGate') { await setConfig('GEO_GATE', P(body, 'gate') === 'mercosur' ? 'mercosur' : 'off'); return json({ ok: true }); }
    if (accion === 'setConfigCandy') { await setConfig('candy_mostrar_stock', boolHijo(body.mostrarStock) ? '1' : '0'); return json({ ok: true }); }
    if (accion === 'setCategoriaHijosLote') {
      const cods = P(body, 'codigos').split(',').map((s) => s.trim()).filter(Boolean);
      const cat = P(body, 'categoria').trim() || 'Varios';
      if (!cods.length) return json({ error: 'sin códigos' });
      await sbPatch('candy_productos', 'codigo=in.(' + cods.map((c) => '"' + c + '"').join(',') + ')', { categoria: cat });
      return json({ ok: true, n: cods.length, categoria: cat });
    }
    if (accion === 'renombrarCategoriaHijos') {
      const viejo = P(body, 'viejo').trim(); const nuevo = P(body, 'nuevo').trim() || 'Varios';
      if (!viejo) return json({ error: 'falta categoría' });
      await sbPatch('candy_productos', 'categoria=eq.' + encodeURIComponent(viejo), { categoria: nuevo });
      return json({ ok: true, nuevo });
    }
    if (accion === 'setFotoHijo') {
      const cod = P(body, 'codigo').trim(); if (!cod) return json({ error: 'falta codigo' });
      const ex = await sbGet('candy_productos', 'select=codigo&codigo=eq.' + encodeURIComponent(cod));
      if (!ex.length) return json({ error: 'no encontrado' });
      await sbPatch('candy_productos', 'codigo=eq.' + encodeURIComponent(cod), { foto: P(body, 'foto') });
      return json({ ok: true });
    }
    if (accion === 'toggleShukEnCandy') {
      const id = P(body, 'id').trim(); if (!id) return json({ error: 'sin id' });
      const ex = await sbGet('shuk_en_candy', 'select=id&shuk_id=eq.' + encodeURIComponent(id));
      const sp = P(body, 'set');
      const quiero = sp === '1' ? true : sp === '0' ? false : (ex.length === 0);
      if (quiero) { if (!ex.length) await sbInsert('shuk_en_candy', { shuk_id: id, fecha: fechaAhora() }); return json({ ok: true, importado: true }); }
      if (ex.length) await sbDelete('shuk_en_candy', 'shuk_id=eq.' + encodeURIComponent(id));
      return json({ ok: true, importado: false });
    }
    if (accion === 'agregarProductoHijo') {
      await sbInsert('candy_productos', { codigo: P(body, 'codigo'), nombre: P(body, 'nombre'), precio_venta: N(body, 'precioVenta'), costo: N(body, 'costo'), foto: P(body, 'foto'), categoria: P(body, 'categoria') || 'Varios', precio_oferta: N(body, 'precioOferta'), fecha_oferta: P(body, 'fechaOferta'), cant_pack: parseInt(P(body, 'cantPack')) || 0, precio_pack: N(body, 'precioPack'), siempre_disp: boolHijo(body.siempreDisp), componentes: P(body, 'componentes'), hashgaja: P(body, 'hashgaja'), kosher_tipo: P(body, 'kosherTipo'), jalav: P(body, 'jalav') });
      return json({ ok: true });
    }
    if (accion === 'analiticaCandy') {
      // Visitas de las tiendas de los chicos (track pagina 'candy-<kid>', junta desde v3.14).
      const tr = await sbGet('trafico', "select=fecha,pagina,dispositivo,evento&pagina=like.candy-*&order=id.desc&limit=20000");
      const visitas = tr.filter((t: any) => (t.evento || 'visita') === 'visita');
      const porKid: any = {}, porDia: any = {}, disp: any = {};
      visitas.forEach((t: any) => {
        const kid = (t.pagina || '').replace('candy-', '') || '?';
        porKid[kid] = (porKid[kid] || 0) + 1;
        const dia = (t.fecha || '').slice(0, 10);
        if (!porDia[dia]) porDia[dia] = {};
        porDia[dia][kid] = (porDia[dia][kid] || 0) + 1;
        disp[t.dispositivo || '?'] = (disp[t.dispositivo || '?'] || 0) + 1;
      });
      return json({ total: visitas.length, porKid, dias: Object.keys(porDia).slice(0, 14).map((d) => ({ dia: d, ...porDia[d] })), dispositivos: disp });
    }
    if (accion === 'borradosCandy') {
      const bs = await sbGet('borrados', "select=fecha,tipo,detalle,por&tipo=like.*CS&order=id.desc&limit=60");
      return json(bs.map((b: any) => ({ fecha: b.fecha, tipo: b.tipo, detalle: b.detalle, por: b.por || '' })));
    }
    if (accion === 'movsDeposito') {
      // Trazabilidad del depósito Candy: últimos movimientos de un código.
      const codMv = url.searchParams.get('codigo') || P(body, 'codigo');
      const mv = await sbGet('movimientos_stock', 'select=fecha,producto,cambio,antes,despues,origen&id_prod=eq.' + encodeURIComponent(codMv) + '&order=id.desc&limit=40');
      return json(mv.map((m: any) => ({ fecha: m.fecha, producto: m.producto, cambio: m.cambio, antes: m.antes, despues: m.despues, origen: m.origen })));
    }
    if (accion === 'editarProductosLoteHijos') {
      // Editor masivo del catálogo Candy (paridad con el masivo del Shuk): varios productos de una.
      let cambios: any[]; try { cambios = JSON.parse(P(body, 'cambios') || '[]'); } catch { return json({ error: 'json inválido' }); }
      if (!cambios.length) return json({ ok: true, n: 0 });
      let nOk = 0;
      for (const c of cambios) {
        const codigo = (c.codigo || '').toString(); if (!codigo) continue;
        const ex = await sbGet('candy_productos', 'select=codigo,nombre&codigo=eq.' + encodeURIComponent(codigo));
        if (!ex.length) continue;
        const patch: any = {};
        if (c.nombre !== undefined && (c.nombre || '').toString().trim()) patch.nombre = c.nombre.toString().trim();
        if (c.categoria !== undefined) patch.categoria = (c.categoria || 'Varios').toString();
        if (c.precioVenta !== undefined) patch.precio_venta = parseFloat(String(c.precioVenta).replace(',', '.')) || 0;
        if (c.costo !== undefined) patch.costo = parseFloat(String(c.costo).replace(',', '.')) || 0;
        if (c.precioOferta !== undefined) patch.precio_oferta = parseFloat(String(c.precioOferta).replace(',', '.')) || 0;
        if (c.fechaOferta !== undefined) patch.fecha_oferta = (c.fechaOferta || '').toString();
        if (c.cantPack !== undefined) patch.cant_pack = parseInt(c.cantPack) || 0;
        if (c.precioPack !== undefined) patch.precio_pack = parseFloat(String(c.precioPack).replace(',', '.')) || 0;
        if (c.siempreDisp !== undefined) patch.siempre_disp = boolHijo(c.siempreDisp);
        if (Object.keys(patch).length) await sbPatch('candy_productos', 'codigo=eq.' + encodeURIComponent(codigo), patch);
        // Stock del depósito: se ajusta por DELTA contra lo actual (no pisa ventas del medio).
        if (c.stock !== undefined) {
          const dep = await sbGet('candy_deposito', 'select=cantidad&codigo=eq.' + encodeURIComponent(codigo));
          const actual = dep.length ? (parseFloat(dep[0].cantidad) || 0) : 0;
          const nuevo = parseInt(c.stock) || 0;
          if (nuevo !== actual) await ajustarDeposito(codigo, (patch.nombre || ex[0].nombre || '').toString(), nuevo - actual, 'Editor masivo (Candy)');
        }
        nOk++;
      }
      return json({ ok: true, n: nOk });
    }
    if (accion === 'editarProductoHijo') {
      const codigo = P(body, 'codigo'), nuevoCodigo = P(body, 'nuevoCodigo') || codigo;
      const ex = await sbGet('candy_productos', 'select=codigo&codigo=eq.' + encodeURIComponent(codigo));
      if (!ex.length) return json({ error: 'no encontrado' });
      if (nuevoCodigo !== codigo) { const dup = await sbGet('candy_productos', 'select=codigo&codigo=eq.' + encodeURIComponent(nuevoCodigo)); if (dup.length) return json({ error: 'ya existe un producto con ese código' }); }
      const patch: any = { codigo: nuevoCodigo, nombre: P(body, 'nombre'), precio_venta: N(body, 'precioVenta'), costo: N(body, 'costo'), foto: P(body, 'foto') };
      if (has('categoria')) patch.categoria = P(body, 'categoria') || 'Varios';
      if (has('precioOferta')) patch.precio_oferta = N(body, 'precioOferta');
      if (has('fechaOferta')) patch.fecha_oferta = P(body, 'fechaOferta');
      if (has('cantPack')) patch.cant_pack = parseInt(P(body, 'cantPack')) || 0;
      if (has('precioPack')) patch.precio_pack = N(body, 'precioPack');
      if (body.siempreDisp !== undefined) patch.siempre_disp = boolHijo(body.siempreDisp);
      if (body.componentes !== undefined) patch.componentes = P(body, 'componentes');   // 🎁 combo (pack mixto): JSON [{codigo,cant}]
      if (body.hashgaja !== undefined) patch.hashgaja = P(body, 'hashgaja');   // kosher ('' = borrar)
      if (body.kosherTipo !== undefined) patch.kosher_tipo = P(body, 'kosherTipo');
      if (body.jalav !== undefined) patch.jalav = P(body, 'jalav');
      await sbPatch('candy_productos', 'codigo=eq.' + encodeURIComponent(codigo), patch);
      if (nuevoCodigo !== codigo) for (const t of ['candy_ventas', 'stock_diario', 'candy_compras', 'candy_deposito']) await sbPatch(t, 'codigo=eq.' + encodeURIComponent(codigo), { codigo: nuevoCodigo });   // propagar el código a lo que lo referencia
      return json({ ok: true });
    }
    if (accion === 'eliminarProductoHijo') {
      const ex = await sbGet('candy_productos', 'select=nombre&codigo=eq.' + encodeURIComponent(P(body, 'codigo')));
      if (!ex.length) return json({ error: 'no encontrado' });
      await sbInsert('borrados', { fecha: fechaAhora(), tipo: 'producto CS', detalle: ex[0].nombre + ' (cod ' + P(body, 'codigo') + ')', por: P(body, 'hijo') });
      await sbDelete('candy_productos', 'codigo=eq.' + encodeURIComponent(P(body, 'codigo')));
      return json({ ok: true });
    }
    if (accion === 'setStockDia') {
      const hijo = P(body, 'hijo');
      const [cierres, stockD] = await Promise.all([sbGet('cierres_hijos', 'select=fecha&hijo=eq.' + encodeURIComponent(hijo)), sbGet('stock_diario', 'select=fecha&hijo=eq.' + encodeURIComponent(hijo))]);
      const hoy = fechaAhora().slice(0, 10);
      const cerr: any = {}; cierres.forEach((r: any) => cerr[(r.fecha || '').toString().slice(0, 10)] = true);
      const fl: any = {}; stockD.forEach((r: any) => { if (r.fecha) fl[(r.fecha || '').toString().slice(0, 10)] = true; });
      const fechaNum = (f: string) => { const m = (f || '').match(/(\d{2})\/(\d{2})\/(\d{4})/); return m ? (+m[3]) * 10000 + (+m[2]) * 100 + (+m[1]) : 0; };
      let diaAbierto: string | null = null; Object.keys(fl).forEach((f) => { if (!cerr[f] && (!diaAbierto || fechaNum(f) > fechaNum(diaAbierto))) diaAbierto = f; });
      if (diaAbierto && diaAbierto !== hoy && P(body, 'forzar') !== '1') return json({ error: 'dia_anterior_abierto', dia: diaAbierto });
      let items: any[]; try { items = JSON.parse(P(body, 'items') || '[]'); } catch { return json({ error: 'items inválido' }); }
      const hoyRows = await sbGet('stock_diario', 'select=*&hijo=eq.' + encodeURIComponent(hijo));
      for (const r of hoyRows) { if ((r.fecha || '').toString().startsWith(hoy)) { const cant = parseInt(r.cantidad) || 0; if (cant) await ajustarDeposito(r.codigo, r.producto || '', cant, 'Stock del día devuelto (re-carga)'); await sbDelete('stock_diario', 'id=eq.' + r.id); } }
      const fecha = fechaAhora();
      for (const it of items) { const cant = parseInt(it.cantidad) || 0; if (it.codigo && cant > 0) { const cirS = await asegurarGenuinoShuk((it.codigo || '').toString(), cant, 'stock del día ' + hijo); if (cirS.error) return json({ error: cirS.error }); await sbInsert('stock_diario', { fecha, hijo, codigo: it.codigo, producto: it.nombre || '', cantidad: cant }); await ajustarDeposito(it.codigo, it.nombre || '', -cant, 'Sacado para vender (stock del día · ' + hijo + ')'); } }
      return json({ ok: true, n: items.length });
    }
    if (accion === 'limpiarVentasHijosDia') {
      const dia = P(body, 'dia').trim(), hijo = P(body, 'hijo').trim();
      if (!dia) return json({ error: 'falta dia' });
      const rows = await sbGet('candy_ventas', 'select=*' + (hijo ? '&hijo=eq.' + encodeURIComponent(hijo) : ''));
      let borradas = 0;
      for (const r of rows) { if ((r.fecha || '').toString().startsWith(dia)) { const saldo = parseFloat(r.saldo_pendiente) || 0; if (saldo > 0 && r.cliente) await sbInsert('candy_cc', { fecha: fechaAhora(), hijo: r.hijo, cliente: r.cliente, monto: -saldo, tipo: 'anulacion', detalle: r.producto }); await sbDelete('candy_ventas', 'id=eq.' + r.id); borradas++; } }
      return json({ ok: true, borradas });
    }
    if (accion === 'arreglarVentasHijosDia') {
      const dia = P(body, 'dia').trim(), hijo = P(body, 'hijo').trim();
      if (!dia) return json({ error: 'falta dia' });
      const rows = (await sbGet('candy_ventas', 'select=*' + (hijo ? '&hijo=eq.' + encodeURIComponent(hijo) : ''))).filter((r: any) => (r.fecha || '').toString().slice(0, 10) === dia);
      const vistas: any = {}, aBorrar: any[] = [];
      rows.forEach((r: any) => { const cli = (r.cliente || '').toString().trim(); if (!cli) { aBorrar.push(r); return; } const key = cli + '|' + r.producto + '|' + r.cantidad + '|' + r.precio; if (vistas[key]) aBorrar.push(r); else vistas[key] = true; });
      let borradas = 0;
      for (const r of aBorrar) { const saldo = parseFloat(r.saldo_pendiente) || 0; if (saldo > 0 && r.cliente) await sbInsert('candy_cc', { fecha: fechaAhora(), hijo: r.hijo, cliente: r.cliente, monto: -saldo, tipo: 'anulacion', detalle: r.producto }); await sbDelete('candy_ventas', 'id=eq.' + r.id); borradas++; }
      return json({ ok: true, borradas });
    }
    if (accion === 'cargarStock') {
      let items: any[]; try { items = JSON.parse(P(body, 'items') || '[]'); } catch { return json({ error: 'items inválido' }); }
      const fecha = fechaAhora(), hijo = P(body, 'hijo');
      for (const it of items) { const cant = parseInt(it.cantidad) || 0; if (it.codigo && cant > 0) { const cirS = await asegurarGenuinoShuk((it.codigo || '').toString(), cant, 'stock del día ' + hijo); if (cirS.error) return json({ error: cirS.error }); await sbInsert('stock_diario', { fecha, hijo, codigo: it.codigo, producto: it.nombre || '', cantidad: cant }); await ajustarDeposito(it.codigo, it.nombre || '', -cant, 'Sacado para vender (stock del día · ' + hijo + ')'); } }
      return json({ ok: true });
    }
    if (accion === 'reasignarVentaHijo') {
      // Mueve ventas (por ids) de un chico a otro. rowIndexes = JSON de ids de candy_ventas.
      let ids: any[]; try { ids = JSON.parse(P(body, 'rowIndexes') || P(body, 'ids') || '[]'); } catch { ids = []; }
      const nuevoHijo = P(body, 'nuevoHijo'); if (!nuevoHijo || !ids.length) return json({ error: 'faltan datos' });
      for (const id of ids) await sbPatch('candy_ventas', 'id=eq.' + encodeURIComponent(id), { hijo: nuevoHijo });
      return json({ ok: true, n: ids.length });
    }
    if (accion === 'resetearStockDia') {
      const hijo = P(body, 'hijo'), hoy = fechaAhora().slice(0, 10);
      const rows = await sbGet('stock_diario', 'select=*&hijo=eq.' + encodeURIComponent(hijo));
      for (const r of rows) { if ((r.fecha || '').toString().startsWith(hoy)) { await ajustarDeposito(r.codigo, r.producto || '', parseInt(r.cantidad) || 0, 'Stock del día devuelto al depósito'); await sbDelete('stock_diario', 'id=eq.' + r.id); } }
      return json({ ok: true });
    }
    if (accion === 'cerrarDiaHijos') {
      const hijo = P(body, 'hijo'); if (!hijo) return json({ error: 'falta hijo' });
      const dia = /^\d{2}\/\d{2}\/\d{4}$/.test(P(body, 'dia')) ? P(body, 'dia') : fechaAhora().slice(0, 10);
      const ex = await sbGet('cierres_hijos', 'select=id&hijo=eq.' + encodeURIComponent(hijo) + '&fecha=eq.' + encodeURIComponent(dia));
      if (ex.length) return json({ ok: true, dup: true });
      await sbInsert('cierres_hijos', { fecha: dia, hijo, cerrado_en: fechaAhora(), vendido: N(body, 'vendido'), cobrado: N(body, 'cobrado'), efectivo: N(body, 'efectivo'), mp: N(body, 'mp'), deuda: N(body, 'deuda'), ganancia: N(body, 'ganancia'), consumo_costo: N(body, 'consumoCosto'), nota: P(body, 'nota') });
      return json({ ok: true, dia });
    }
    if (accion === 'editarPedidoHijo') {
      // ✏️ Editar un pedido PENDIENTE de la tienda (13/07: cobraron 2×$3.000 y era 2×$2.500):
      // cantidades y precios por línea. Los deltas de cantidad ajustan la RESERVA del depósito
      // (subir cantidad pasa por el circuito igual que al reservar; bajar devuelve).
      if (!(await sesionValida(token))) return json({ error: 'sin permiso' });
      const pidE = P(body, 'pedidoId');
      let nuevos: any[] = []; try { nuevos = JSON.parse(P(body, 'items') || '[]'); } catch { return json({ error: 'items inválido' }); }
      nuevos = nuevos.filter((it: any) => it && it.codigo && (parseInt(it.cantidad) || 0) > 0);
      if (!nuevos.length) return json({ error: 'el pedido no puede quedar vacío — cancelalo si no va más' });
      const rowsE = await sbGet('candy_pedidos', 'select=*&pedido_id=eq.' + encodeURIComponent(pidE));
      if (!rowsE.length) return json({ error: 'no encontrado' });
      if ((rowsE[0].estado || '') !== 'pendiente') return json({ error: 'solo se editan pedidos pendientes' });
      let viejos: any[] = []; try { viejos = JSON.parse(rowsE[0].items || '[]'); } catch { viejos = []; }
      const qtyV: any = {}; viejos.forEach((it: any) => { qtyV[it.codigo] = (qtyV[it.codigo] || 0) + (parseInt(it.cantidad) || 0); });
      const qtyN: any = {}; nuevos.forEach((it: any) => { qtyN[it.codigo] = (qtyN[it.codigo] || 0) + (parseInt(it.cantidad) || 0); });
      // 1º validar/comprar los AUMENTOS (todo o nada antes de escribir)
      for (const cod of Object.keys(qtyN)) {
        const delta = qtyN[cod] - (qtyV[cod] || 0);
        if (delta > 0) {
          const cirE = await asegurarGenuinoShuk(cod, delta, 'edición pedido tienda [' + pidE + ']');
          if (cirE.error) return json({ error: cirE.error });
        }
      }
      // 2º aplicar deltas a la reserva
      for (const cod of new Set([...Object.keys(qtyV), ...Object.keys(qtyN)])) {
        const delta = (qtyN[cod] || 0) - (qtyV[cod] || 0);
        if (delta === 0) continue;
        const nomE = (nuevos.find((it: any) => it.codigo === cod) || viejos.find((it: any) => it.codigo === cod) || {}).nombre || '';
        await ajustarDeposito(cod, nomE, -delta, 'Edición pedido tienda [' + pidE + '] (' + (delta > 0 ? '+' : '') + delta + ')');
      }
      const totalE = nuevos.reduce((s2: number, it: any) => s2 + (parseFloat(it.precio) || 0) * (parseInt(it.cantidad) || 0), 0);
      const itemsFinal = nuevos.map((it: any) => ({ codigo: it.codigo, nombre: (it.nombre || '').toString(), cantidad: parseInt(it.cantidad) || 0, precio: Math.round(parseFloat(it.precio) || 0), subtotal: Math.round((parseFloat(it.precio) || 0) * (parseInt(it.cantidad) || 0)) }));
      await sbPatch('candy_pedidos', 'pedido_id=eq.' + encodeURIComponent(pidE), { items: JSON.stringify(itemsFinal), total: Math.round(totalE) });
      return json({ ok: true, total: Math.round(totalE) });
    }
    if (accion === 'cobrarPedidoHijo') return json(await setEstadoPedidoHijo(body, 'cobrado'));
    if (accion === 'cancelarPedidoHijo') return json(await setEstadoPedidoHijo(body, 'cancelado'));
    if (accion === 'ajustarDepositoManual') {
      const codigo = P(body, 'codigo'); if (!codigo) return json({ error: 'falta codigo' });
      const nuevo = parseInt(P(body, 'cantidad')); if (isNaN(nuevo) || nuevo < 0) return json({ error: 'cantidad inválida' });
      const ex = await sbGet('candy_deposito', 'select=cantidad&codigo=eq.' + encodeURIComponent(codigo));
      const antes = ex.length ? parseInt(ex[0].cantidad) || 0 : 0;
      if (nuevo !== antes) await ajustarDeposito(codigo, P(body, 'nombre'), nuevo - antes, 'Ajuste manual de depósito (Candy)');
      return json({ ok: true, antes, nuevo });
    }
    if (accion === 'eliminarCompraHijos') {
      const id = P(body, 'compraId'); if (!id) return json({ error: 'falta compraId' });
      const rows = await sbGet('candy_compras', 'select=*&compra_id=eq.' + encodeURIComponent(id));
      if (!rows.length) return json({ error: 'no encontrado' });
      const codigos = new Set<string>(); const items: string[] = [];
      for (const r of rows) { await ajustarDeposito(r.codigo, r.producto || '', -(parseInt(r.cantidad) || 0), 'Compra eliminada (stock restado)'); codigos.add(r.codigo); items.push(r.cantidad + 'x ' + (r.producto || r.codigo) + ' ($' + r.costo_total + ')'); }
      await sbDelete('candy_compras', 'compra_id=eq.' + encodeURIComponent(id));
      await sbInsert('borrados', { fecha: fechaAhora(), tipo: 'compra CS', detalle: 'Compra ' + id + ': ' + items.join(', '), por: P(body, 'hijo') });
      for (const c of codigos) await actualizarCostoPromedio(c);
      return json({ ok: true, borradas: rows.length });
    }
    if (accion === 'agregarProveedorHijos') {
      if (!P(body, 'nombre')) return json({ error: 'falta nombre' });
      const id = 'PR' + Date.now();
      await sbInsert('candy_proveedores', { id, nombre: P(body, 'nombre'), telefono: P(body, 'telefono'), notas: P(body, 'notas') });
      return json({ ok: true, id });
    }
    if (accion === 'editarProveedorHijos') {
      const ex = await sbGet('candy_proveedores', 'select=id&id=eq.' + encodeURIComponent(P(body, 'id')));
      if (!ex.length) return json({ error: 'no encontrado' });
      await sbPatch('candy_proveedores', 'id=eq.' + encodeURIComponent(P(body, 'id')), { nombre: P(body, 'nombre'), telefono: P(body, 'telefono'), notas: P(body, 'notas') });
      return json({ ok: true });
    }
    if (accion === 'eliminarProveedorHijos') {
      await fetch(SB_URL + '/rest/v1/candy_proveedores?id=eq.' + encodeURIComponent(P(body, 'id')), { method: 'DELETE', headers: { apikey: SERVICE, Authorization: 'Bearer ' + SERVICE, Prefer: 'return=minimal' } });
      return json({ ok: true });
    }
    if (accion === 'editarVentaHijos') {
      const id = P(body, 'id') || P(body, 'rowIndex');
      const rows = await sbGet('candy_ventas', 'select=*&id=eq.' + encodeURIComponent(id));
      if (!rows.length) return json({ error: 'no encontrado' });
      const v = rows[0];
      if (v.hijo !== P(body, 'hijo')) return json({ error: 'no autorizado' });
      const oldSaldo = parseFloat(v.saldo_pendiente) || 0, oldCliente = (v.cliente || '').toString();
      const newNombre = has('productoNombre') ? P(body, 'productoNombre') : v.producto;
      const newCodigo = has('productoCodigo') ? P(body, 'productoCodigo') : v.codigo;
      const newCantidad = parseInt(P(body, 'cantidad')) || parseInt(v.cantidad) || 1;
      const newPrecio = has('precio') ? N(body, 'precio') : (parseFloat(v.precio) || 0);
      const newTotal = newCantidad * newPrecio;
      const newCliente = body.cliente !== undefined ? await clienteCanonicoCandy(P(body, 'cliente')) : oldCliente;   // 🧑 grafía única
      let newSaldo = N(body, 'saldoPendiente');
      // ⚖️ Espejo del caso #46 del Shuk: editar una venta YA COBRADA no puede "cobrar sola"
      // la diferencia. Lo que entró de verdad = total viejo − saldo viejo; si el total nuevo
      // supera eso y el saldo mandado no lo cubre, el faltante queda como deuda y se avisa.
      // (Solo cuando la edición CAMBIÓ el total: corregir el saldo a mano sigue permitido.)
      const oldTotal = parseFloat(v.total) || 0;
      let deudaNueva = 0;
      if (Math.abs(newTotal - oldTotal) > 0.005) {
        const cobradoReal = Math.max(0, oldTotal - oldSaldo);
        const saldoMin = Math.max(0, Math.round((newTotal - cobradoReal) * 100) / 100);
        if (newSaldo < saldoMin - 0.005) { deudaNueva = Math.round((saldoMin - newSaldo) * 100) / 100; newSaldo = saldoMin; }
      }
      await sbPatch('candy_ventas', 'id=eq.' + encodeURIComponent(id), { producto: newNombre, codigo: newCodigo, cantidad: newCantidad, precio: newPrecio, total: newTotal, cliente: newCliente, es_debe: newSaldo > 0 ? 'SI' : 'NO', saldo_pendiente: newSaldo });
      if (oldSaldo > 0 && oldCliente) await sbInsert('candy_cc', { fecha: fechaAhora(), hijo: v.hijo, cliente: oldCliente, monto: -oldSaldo, tipo: 'correccion', detalle: v.producto });
      if (newSaldo > 0 && newCliente) await sbInsert('candy_cc', { fecha: fechaAhora(), hijo: v.hijo, cliente: newCliente, monto: newSaldo, tipo: 'correccion', detalle: newNombre });
      return json({ ok: true, deudaNueva: deudaNueva || null });
    }
    if (accion === 'eliminarVentaHijos') {
      const id = P(body, 'id') || P(body, 'rowIndex');
      const rows = await sbGet('candy_ventas', 'select=*&id=eq.' + encodeURIComponent(id));
      if (!rows.length) return json({ error: 'no encontrado' });
      const v = rows[0];
      if (v.hijo !== P(body, 'hijo')) return json({ error: 'no autorizado' });
      const saldo = parseFloat(v.saldo_pendiente) || 0, cliente = (v.cliente || '').toString();
      if (saldo > 0 && cliente && P(body, 'confirmar') !== '1') {
        const saldoActual = await saldoClienteCandy(v.hijo, cliente);
        if (saldoActual < saldo - 0.01) return json({ needsConfirm: true, yaPagado: Math.round(saldo - saldoActual), saldoVenta: Math.round(saldo), cliente });
      }
      if (saldo > 0 && cliente) await sbInsert('candy_cc', { fecha: fechaAhora(), hijo: v.hijo, cliente, monto: -saldo, tipo: 'anulacion', detalle: v.producto });
      await sbInsert('borrados', { fecha: fechaAhora(), tipo: 'venta CS', detalle: v.cantidad + 'x ' + v.producto + ' ($' + v.total + ')' + (cliente ? ' · ' + cliente : ''), por: v.hijo });
      await fetch(SB_URL + '/rest/v1/candy_ventas?id=eq.' + encodeURIComponent(id), { method: 'DELETE', headers: { apikey: SERVICE, Authorization: 'Bearer ' + SERVICE, Prefer: 'return=minimal' } });
      return json({ ok: true });
    }
    if (accion === 'registrarPagoCliente') {
      const hijo = P(body, 'hijo'), cliente = await clienteCanonicoCandy(P(body, 'cliente'));   // 🧑 grafía única
      const saldoActual = await saldoClienteCandy(hijo, cliente);
      const montoPago = P(body, 'monto') === 'todo' ? saldoActual : N(body, 'monto');
      // Pago con opciones (M3, 2026-07-07): método (efectivo/mp), comprobante y perdón de redondeo.
      const metodo = P(body, 'metodo') === 'mp' ? 'mp' : 'efectivo';
      await sbInsert('candy_cc', { fecha: fechaAhora(), hijo, cliente, monto: -montoPago, tipo: 'pago', detalle: '', metodo, comprobante: P(body, 'comprobante') });
      let perdonado = 0;
      // Perdón/redondeo: si se pide cerrar la cuenta y quedó una diferencia chica, se anula el resto
      // (baja la deuda SIN plata — no es un pago, para que la caja del chico no sume de más).
      if (P(body, 'perdonar') === '1') {
        const resto = Math.round((saldoActual - montoPago) * 100) / 100;
        if (resto > 0) { perdonado = resto; await sbInsert('candy_cc', { fecha: fechaAhora(), hijo, cliente, monto: -resto, tipo: 'perdon', detalle: 'Redondeo / perdón' }); }
      }
      return json({ ok: true, saldoRestante: saldoActual - montoPago - perdonado, perdonado });
    }
    if (accion === 'registrarVueltoCC') {
      if (!P(body, 'cliente') || !has('monto')) return json({ ok: false });
      const cliVC = await clienteCanonicoCandy(P(body, 'cliente'));   // 🧑 grafía única
      await sbInsert('candy_cc', { fecha: fechaAhora(), hijo: P(body, 'hijo'), cliente: cliVC, monto: -(N(body, 'monto')), tipo: 'vuelto', detalle: P(body, 'producto') });
      return json({ ok: true });
    }
    if (accion === 'registrarPagoVuelto') {
      if (!has('monto')) return json({ ok: false });
      const cliPV = await clienteCanonicoCandy(P(body, 'cliente'));   // 🧑 grafía única
      const saldo = await saldoClienteCandy(P(body, 'hijo'), cliPV);
      const monto = P(body, 'monto') === 'todo' ? Math.abs(saldo) : N(body, 'monto');
      await sbInsert('candy_cc', { fecha: fechaAhora(), hijo: P(body, 'hijo'), cliente: cliPV, monto, tipo: 'pago_vuelto', detalle: '' });
      return json({ ok: true });
    }
    if (accion === 'guardarNotaCliente') { await setConfig('nota_cliente:' + P(body, 'cliente'), P(body, 'nota')); return json({ ok: true }); }
    if (accion === 'registrarCompra') {
      const cant = N(body, 'cantidad'), ct = N(body, 'costoTotal');
      await sbInsert('costos_jony', { fecha: fechaAhora(), producto_id: P(body, 'productoId'), producto: P(body, 'producto'), cantidad: cant, costo_total: ct, costo_unitario: cant > 0 ? ct / cant : 0 });
      return json({ ok: true });
    }
    // ── 🔗 CATÁLOGO VIP: link privado con carrito para pasarle a UN cliente ──────────────
    // La tienda de siempre pero mostrando SOLO los productos elegidos (incluidos los 🙈
    // ocultos). El token del link ES el secreto: sin él, nadie los ve. Se crea desde el
    // armador de catálogo del panel y se revoca cuando quieras.
    if (accion === 'crearCatalogoVip') {
      if (!(await sesionValida(token))) return json({ error: 'sin permiso' });
      const idsVip = P(body, 'ids').split(',').map((s) => s.trim()).filter(Boolean);
      if (!idsVip.length) return json({ error: 'elegí al menos un producto' });
      const tokVip = Math.random().toString(36).slice(2, 8) + Math.random().toString(36).slice(2, 6);
      // v3.92: el link guarda también los descuentos del armador (general + por producto)
      let descProdVip: any = {}; try { descProdVip = JSON.parse(P(body, 'descProd') || '{}'); } catch { descProdVip = {}; }
      await setConfig('VIP_' + tokVip, JSON.stringify({ ids: idsVip, nombre: P(body, 'nombre') || 'cliente', canal: P(body, 'canal') === 'mayorista' ? 'mayorista' : 'minorista', creado: fechaAhora(), desc: Number(P(body, 'desc')) || 0, descProd: descProdVip }));
      return json({ ok: true, token: tokVip });
    }
    if (accion === 'getCatalogoVip') {
      const t = Q('t').replace(/[^a-z0-9]/gi, '');
      if (!t) return json({ error: 'link inválido' });
      const raw = await getConfig('VIP_' + t, '');
      if (!raw) return json({ error: 'este catálogo ya no está disponible' });
      try { const d = JSON.parse(raw); return json({ ids: d.ids || [], nombre: d.nombre || '', canal: d.canal || 'minorista', desc: Number(d.desc) || 0, descProd: d.descProd || {} }); } catch { return json({ error: 'link inválido' }); }
    }
    if (accion === 'listarCatalogosVip') {
      if (!(await sesionValida(token))) return json({ error: 'sin permiso' });
      const rows = await sbGet('config', 'select=clave,valor&clave=like.VIP_*');
      return json(rows.map((r: any) => { try { const d = JSON.parse(r.valor || '{}'); return { token: (r.clave || '').slice(4), nombre: d.nombre || '', canal: d.canal || 'minorista', creado: d.creado || '', n: (d.ids || []).length, desc: Number(d.desc) || 0, nDescProd: Object.keys(d.descProd || {}).length }; } catch { return null; } }).filter(Boolean));
    }
    if (accion === 'bloquearVidCandy') {
      if (!(await sesionValida(token))) return json({ error: 'sin permiso' });
      const vB = P(body, 'vid').replace(/[^a-z0-9]/gi, '');
      if (!vB) return json({ error: 'sin vid' });
      await setConfig('VIDBLOCK_' + vB, P(body, 'desbloquear') === '1' ? '' : '1');
      return json({ ok: true });
    }
    if (accion === 'setPrecioShukEnCandy') {
      if (!(await sesionValida(token))) return json({ error: 'sin permiso' });
      const idP = P(body, 'shukId').replace(/[^0-9]/g, '');
      const precioP = parseFloat(P(body, 'precio')) || 0;
      await sbPatch('shuk_en_candy', 'shuk_id=eq.' + encodeURIComponent(idP), { precio_candy: precioP > 0 ? precioP : null });
      return json({ ok: true });
    }
    if (accion === 'actualizarCatalogoVip') {
      if (!(await sesionValida(token))) return json({ error: 'sin permiso' });
      const tU = P(body, 't').replace(/[^a-z0-9]/gi, '');
      const rawU = await getConfig('VIP_' + tU, '');
      if (!rawU) return json({ error: 'ese link ya no existe' });
      let dU: any = {}; try { dU = JSON.parse(rawU); } catch { dU = {}; }
      dU.ids = (P(body, 'ids') || '').split(',').map((x: string) => x.trim()).filter(Boolean);
      if (P(body, 'nombre')) dU.nombre = P(body, 'nombre');
      if (P(body, 'canal')) dU.canal = P(body, 'canal');
      if (body.desc !== undefined) dU.desc = Number(P(body, 'desc')) || 0;   // v3.92: descuentos editables
      if (body.descProd !== undefined) { try { dU.descProd = JSON.parse(P(body, 'descProd') || '{}'); } catch { dU.descProd = {}; } }
      dU.editado = fechaAhora();
      await setConfig('VIP_' + tU, JSON.stringify(dU));
      return json({ ok: true, n: dU.ids.length });
    }
    if (accion === 'borrarCatalogoVip') {
      if (!(await sesionValida(token))) return json({ error: 'sin permiso' });
      await sbDelete('config', 'clave=eq.' + encodeURIComponent('VIP_' + P(body, 't').replace(/[^a-z0-9]/gi, '')));
      return json({ ok: true });
    }
    // ── 🔗 PEDIDO ARMADO (v5.00): Jony arma el pedido, el cliente lo abre con el carrito cargado y solo confirma ──
    // Se guarda QUÉ y CUÁNTO (ids y cantidades), NUNCA precios: al abrirlo, la tienda lo rearma con el catálogo y
    // los precios de HOY, y al confirmarlo el motor recalcula el total como en cualquier pedido de la tienda.
    // El token del link ES el secreto. Una vez confirmado, reabrir el link no vuelve a cargar nada (no se duplica).
    if (accion === 'crearPedidoArmado') {
      const itemsA = P(body, 'items').trim();
      if (!/^\d{1,9}:\d{1,6}(,\d{1,9}:\d{1,6})*$/.test(itemsA)) return json({ error: 'el pedido no tiene productos válidos' });
      const porId: any = {};
      itemsA.split(',').forEach((u: string) => { const pp = u.split(':'); const q = parseInt(pp[1]) || 0; if (q > 0) porId[String(parseInt(pp[0]))] = q; });
      const listaA = Object.keys(porId).map((id) => ({ id, q: porId[id] }));
      if (!listaA.length || listaA.length > 80) return json({ error: 'el pedido tiene que tener entre 1 y 80 productos' });
      const abc = 'abcdefghijkmnpqrstuvwxyz23456789', rnd = new Uint8Array(10);
      crypto.getRandomValues(rnd);
      const tokA = Array.from(rnd, (b) => abc[b % 32]).join('');
      await setConfig('ARMADO_' + tokA, JSON.stringify({
        nombre: _libre(P(body, 'nombre'), 60) || 'cliente', canal: P(body, 'canal') === 'mayorista' ? 'mayorista' : 'minorista',
        items: listaA, nota: _libre(P(body, 'nota'), 300), origen: _ident(P(body, 'origen'), 20), creado: fechaAhora(), estado: 'enviado',
      }));
      return json({ ok: true, token: tokA });
    }
    if (accion === 'getPedidoArmado') {
      const tA = Q('t').replace(/[^a-z0-9]/gi, '').slice(0, 40);
      if (!tA) return json({ error: 'link inválido' });
      const rawA = await getConfig('ARMADO_' + tA, '');
      if (!rawA) return json({ error: 'este pedido ya no está disponible' });
      let dA: any; try { dA = JSON.parse(rawA); } catch { return json({ error: 'link inválido' }); }
      // La primera vez que el CLIENTE lo abre queda anotado (así Jony sabe si lo vio). Si lo abre alguien del
      // equipo para probarlo, no cuenta.
      if (!dA.abierto && Q('equipo') !== '1') {
        dA.abierto = fechaAhora();
        if (dA.estado === 'enviado') dA.estado = 'abierto';
        await setConfig('ARMADO_' + tA, JSON.stringify(dA));
      }
      return json({ nombre: dA.nombre || '', canal: dA.canal || 'minorista', items: dA.items || [], nota: dA.nota || '', confirmado: dA.estado === 'confirmado', nVenta: dA.nVenta || null });
    }
    if (accion === 'listarPedidosArmados') {
      const rowsA = await sbGet('config', 'select=clave,valor&clave=like.ARMADO_*');
      const listaL = rowsA.map((r: any) => {
        try {
          const d = JSON.parse(r.valor || '{}');
          return { token: String(r.clave || '').slice(7), nombre: d.nombre || '', canal: d.canal || 'minorista', n: (d.items || []).length,
            unidades: (d.items || []).reduce((t: number, x: any) => t + (parseInt(x.q) || 0), 0), creado: d.creado || '',
            estado: d.estado || 'enviado', abierto: d.abierto || '', confirmado: d.confirmado || '', nVenta: d.nVenta || null, origen: d.origen || '' };
        } catch { return null; }
      }).filter(Boolean);
      listaL.sort((a: any, b: any) => (tsDeFecha(b.creado) || 0) - (tsDeFecha(a.creado) || 0));
      return json(listaL.slice(0, 60));
    }
    if (accion === 'borrarPedidoArmado') {
      await sbDelete('config', 'clave=eq.' + encodeURIComponent('ARMADO_' + P(body, 't').replace(/[^a-z0-9]/gi, '').slice(0, 40)));
      return json({ ok: true });
    }
    if (accion === 'notificacion') {
      const pid = _ident(P(body, 'productoId'), 20), tel = _tel(P(body, 'telefono'));   // 🔒 v4.95
      if (telDudoso(tel)) return json({ error: 'Ese número no parece un WhatsApp válido — poné código de área + número' });
      const ex = await sbGet('notificaciones', 'select=id&producto_id=eq.' + encodeURIComponent(pid) + '&telefono=eq.' + encodeURIComponent(tel) + '&estado=eq.pendiente');
      if (ex.length) return json({ ok: true, duplicado: true });
      await sbInsert('notificaciones', { fecha: fechaAhora(), producto_id: pid, producto: _libre(P(body, 'producto'), 150), nombre: _libre(P(body, 'nombre'), 120), telefono: tel, estado: 'pendiente', modo: _ident(P(body, 'modoCliente'), 20) || 'mayorista' });
      return json({ ok: true });
    }
    if (accion === 'marcarNotificado') { await sbPatch('notificaciones', 'producto_id=eq.' + encodeURIComponent(P(body, 'productoId')) + '&telefono=eq.' + encodeURIComponent(P(body, 'telefono')) + '&estado=eq.pendiente', { estado: 'notificado' }); return json({ ok: true }); }
    if (accion === 'marcarComprado') { await sbPatch('notificaciones', 'producto_id=eq.' + encodeURIComponent(P(body, 'productoId')) + '&telefono=eq.' + encodeURIComponent(P(body, 'telefono')), { estado: 'comprado' }); return json({ ok: true }); }
    if (accion === 'eliminarNotificacion') { await sbDelete('notificaciones', 'producto_id=eq.' + encodeURIComponent(P(body, 'productoId')) + '&telefono=eq.' + encodeURIComponent(P(body, 'telefono'))); return json({ ok: true }); }
    if (accion === 'hacerCorte') {
      // Liquida la ganancia cobrada del período: calcula el Maaser, marca esas ventas con el corteId
      // (para que el período vuelva a 0) y registra el corte.
      const [ventas, productos, pagos, msC] = await Promise.all([sbGet('ventas', 'select=*&order=n_venta'), sbGet('productos', 'select=id,nombre,dueno,moneda,costo,descripcion,nombres_prev,creado'), sbGet('pagos', 'select=*&order=id'), msUltimoCorte()]);
      const per = calcularGanancias(ventas, productos, pagos, msC);
      const gananciaARS = Math.round(per.comisionARS + per.pitzARS);
      const gananciaUSD = Math.round((per.comisionUSD + per.pitzUSD) * 100) / 100;
      const diezmoARS = Math.round(gananciaARS * 0.10);
      const diezmoUSD = Math.round(gananciaUSD * 0.10 * 100) / 100;
      const corteId = 'C' + Date.now();
      const real = (c: string) => !!c && !String(c).startsWith('CTA_CTE');
      const ids = ventas.filter((v: any) => {
        const e = (v.estado || '').toString().trim();
        return e !== 'cancelado' && e !== 'cotizacion' && (real(v.caja_jony) || real(v.caja_myri)) && !(v.corte || '').toString().trim();
      }).map((v: any) => v.id);
      if (ids.length) await sbPatch('ventas', 'id=in.(' + ids.map((x: string) => '"' + x + '"').join(',') + ')', { corte: corteId });
      await sbInsert('cortes', { fecha: fechaAhora(), corte_id: corteId, ganancia_ars: gananciaARS, diezmo_ars: diezmoARS, ganancia_usd: gananciaUSD, diezmo_usd: diezmoUSD, pagado_myri_ars: N(body, 'pagadoMyriARS'), pagado_myri_usd: N(body, 'pagadoMyriUSD'), ventas: ids.length, nota: P(body, 'nota') });
      return json({ ok: true, corteId, gananciaARS, diezmoARS, gananciaUSD, diezmoUSD, ventas: ids.length });
    }
    if (accion === 'registrarRetiro') {
      const balance = N(body, 'balance');
      const diezmo = Math.round(balance * 0.10);
      const retiro = Math.round(balance - diezmo);
      const f = fechaAhora();
      await sbInsert('ganancias_jony', { fecha: f, tipo: 'diezmo', descripcion: 'Maaser 10%', monto: -diezmo });
      await sbInsert('ganancias_jony', { fecha: f, tipo: 'retiro', descripcion: P(body, 'nota') || 'Retiro de ganancias', monto: -retiro });
      return json({ ok: true, diezmo, retiro });
    }
    if (accion === 'actualizarEstado') {
      const id = P(body, 'id'), estado = P(body, 'estado');
      const rows = await sbGet('ventas', 'select=id,estado,stock_updates,n_venta&id=eq.' + encodeURIComponent(id));
      if (!rows.length) return json({ error: 'no encontrado' });
      const v = rows[0]; const estadoPrev = (v.estado || '').toString().trim();
      await sbPatch('ventas', 'id=eq.' + encodeURIComponent(id), { estado });
      // Devolver stock si se cancela un pedido que lo había descontado (no cotización, no ya cancelado).
      // moverStockShuk respeta el depósito compartido con Candy y deja huella en movimientos_stock.
      if (estado === 'cancelado' && estadoPrev !== 'cancelado' && estadoPrev !== 'cotizacion' && v.stock_updates) {
        for (const u of v.stock_updates.split(',')) {
          const [pid, q] = u.split(':'); const qty = parseInt(q) || 0;
          if (!pid || !qty) continue;
          await moverStockShuk(pid, qty, 'Cancelación pedido #' + (v.n_venta || ''));
        }
      }
      return json({ ok: true });
    }
    if (accion === 'levantarPedido') {
      // ↩️ LEVANTAR UN PEDIDO CANCELADO: vuelve a 'pendiente' y descuenta OTRA VEZ el stock, pero
      // solo lo que hay de verdad hoy (el front ya recortó el pedido contra el stock que vio y
      // manda las líneas finales). Acá se vuelve a mirar el stock REAL antes de escribir nada:
      // si entre la radiografía y el OK cambió (venta en curso, Candy sacó del mismo pozo), NO se
      // aplica nada y se pide rehacer la cuenta — es preferible repetir el paso a sobrevender.
      if (!(await sesionValida(token))) return json({ error: 'sin permiso' });
      const idLv = P(body, 'id');
      const rowsLv = await sbGet('ventas', 'select=*&id=eq.' + encodeURIComponent(idLv));
      if (!rowsLv.length) return json({ error: 'no encontrado' });
      const vLv = rowsLv[0];
      if ((vLv.estado || '').toString().trim() !== 'cancelado') return json({ error: 'este pedido no está cancelado (¿ya lo levantaste?)' });
      const suLv = P(body, 'stockUpdatesNuevo').toString();
      const aDescontar: { pid: string; qty: number }[] = [];
      for (const u of suLv.split(',')) {
        const pp = u.split(':'); const pid = (pp[0] || '').trim(); const qty = parseInt(pp[1]) || 0;
        if (pid && qty > 0) aDescontar.push({ pid, qty });
      }
      // Chequeo TODO-O-NADA: se mira todo el stock ANTES de tocar una sola fila.
      const faltantes: any[] = [];
      for (const it of aDescontar) {
        const hay = await stockRealShuk(it.pid);
        if (hay === null) { faltantes.push({ id: it.pid, pide: it.qty, hay: 0, motivo: 'ya no está en el catálogo' }); continue; }
        if (hay < it.qty) faltantes.push({ id: it.pid, pide: it.qty, hay });
      }
      // ✂️ v5.03: renglones que comparten bolsa (fracciones + la bolsa entera) se miran juntos.
      if (!faltantes.length) for (const f of await faltantesDelPedido(aDescontar.map((x) => ({ id: x.pid, qty: x.qty })))) faltantes.push({ id: f.id, pide: f.pedido, hay: f.hay });
      if (faltantes.length) return json({ error: 'el stock cambió mientras confirmabas — volvé a levantarlo para rehacer la cuenta', recalcular: true, faltantes });
      const patchLv: any = { estado: 'pendiente', stock_updates: suLv };
      if (has('productos')) patchLv.productos = P(body, 'productos');
      if (body.totalARS !== undefined) patchLv.total_ars = N(body, 'totalARS');
      if (body.totalUSD !== undefined) patchLv.total_usd = N(body, 'totalUSD');
      if (body.arsJONY !== undefined) patchLv.ars_jony = N(body, 'arsJONY');
      if (body.arsMyri !== undefined) patchLv.ars_myri = N(body, 'arsMyri');
      if (body.usdMyri !== undefined) patchLv.usd_myri = N(body, 'usdMyri');
      if (body.usdJONY !== undefined) patchLv.usd_jony = N(body, 'usdJONY');
      if (body.comiARS !== undefined) patchLv.comi_ars = N(body, 'comiARS');
      if (body.comiUSD !== undefined) patchLv.comi_usd = N(body, 'comiUSD');
      // 🔁 Marcador de "levantado": reinicia el reloj de la reserva de 7 días (la fecha del pedido
      // y su número NO se tocan: son la historia contable). Va como prefijo de la nota y el panel
      // lo muestra; el remito y los mensajes al cliente lo esconden.
      const notaPrevLv = (vLv.notas || '').toString().replace(/^(?:🔁 Levantado el \d{2}\/\d{2}\/\d{4}(?: · )?|🟡 COTIZACIÓN · )+/, '').trim();
      const restoLv = (notaPrevLv && notaPrevLv !== 'Manual') ? notaPrevLv : '';
      patchLv.notas = ('🔁 Levantado el ' + fechaAhora().slice(0, 10) + (restoLv ? ' · ' + restoLv : '')).slice(0, 500);
      await sbPatch('ventas', 'id=eq.' + encodeURIComponent(idLv), patchLv);
      for (const it of aDescontar) await moverStockShuk(it.pid, -it.qty, 'Pedido levantado #' + (vLv.n_venta || ''));
      return json({ ok: true, descontados: aDescontar.length, nVenta: vLv.n_venta, notas: patchLv.notas });
    }

    if (accion === 'getGanancias') {
      const [ventas, productos, pagos, msC] = await Promise.all([sbGet('ventas', 'select=*&order=n_venta'), sbGet('productos', 'select=id,nombre,dueno,moneda,costo,descripcion,nombres_prev,creado'), sbGet('pagos', 'select=*&order=id'), msUltimoCorte()]);
      const p = calcularGanancias(ventas, productos, pagos, msC);
      const balance = p.comisionARS + p.pitzARS;
      return json({ balance, balanceUSD: Math.round((p.comisionUSD + p.pitzUSD) * 100) / 100, comisionARS: p.comisionARS, comisionUSD: p.comisionUSD, pitz: p.pitzARS, pitzUSD: p.pitzUSD, movimientos: [], faltaCosto: p.faltaCosto, faltaTC: p.faltaTC, faltaTCVentas: p.faltaTCVentas || [] });
    }
    // ── CANDY lecturas ──
    if (accion === 'consultarDeudores') {
      const cc = await sbGet('candy_cc', 'select=cliente,monto&hijo=eq.' + encodeURIComponent(url.searchParams.get('hijo') || ''));
      const saldos: any = {};
      cc.forEach((r: any) => { if (!r.cliente) return; const k = normCli(r.cliente); if (!saldos[k]) saldos[k] = { cliente: r.cliente, saldo: 0 }; saldos[k].saldo += parseFloat(r.monto) || 0; });
      return json(Object.values(saldos).filter((x: any) => Math.abs(x.saldo) > 0.01).sort((a: any, b: any) => Math.abs(b.saldo) - Math.abs(a.saldo)));
    }
    if (accion === 'ventasPeriodo') {
      const hijo = url.searchParams.get('hijo') || '';
      const vs = await sbGet('candy_ventas', 'select=*' + (hijo ? '&hijo=eq.' + encodeURIComponent(hijo) : ''));
      return json(vs.map((v: any) => ({ rowIndex: v.id, fecha: (v.fecha || '').toString().slice(0, 10), hora: (v.fecha || '').toString().slice(11, 16), hijo: v.hijo, producto: v.producto, codigo: v.codigo, cantidad: v.cantidad, precio: v.precio, total: v.total, cliente: v.cliente, esDebe: v.es_debe, pagoParcial: v.pago_parcial, saldoPendiente: v.saldo_pendiente, metodoPago: v.metodo_pago || 'efectivo' })));
    }
    if (accion === 'getDepositoHijos') return json((await sbGet('candy_deposito', 'select=*')).map((d: any) => ({ codigo: d.codigo, producto: d.nombre || '', cantidad: parseInt(d.cantidad) || 0 })));
    if (accion === 'getProveedoresHijos') return json((await sbGet('candy_proveedores', 'select=*')).map((r: any) => ({ id: r.id, nombre: r.nombre || '', telefono: r.telefono || '', notas: r.notas || '' })));
    if (accion === 'getShukEnCandy') return json((await sbGet('shuk_en_candy', 'select=shuk_id,precio_candy')).map((r: any) => ({ id: (r.shuk_id || '').toString().trim(), precio: parseFloat(r.precio_candy) || 0 })).filter((r: any) => r.id));
    // 📅 v4.84: todo lo que pasó en la tienda un día (hoy por defecto), evento por evento, para la
    // pestaña En vivo. Misma regla que el servidor del sitio: la cuenta de Miri no lo ve.
    if (accion === 'eventosDelDia') {
      if (usuario && usuario.email === MAIL_MIRI) return json({ error: 'no disponible para esta cuenta' });
      const fH = fechaAhora();
      const hoyK = fH.slice(6, 10) + '-' + fH.slice(3, 5) + '-' + fH.slice(0, 2);
      const diaQ = url.searchParams.get('dia') || '';
      const dia = /^\d{4}-\d{2}-\d{2}$/.test(diaQ) && diaQ <= hoyK ? diaQ : hoyK;
      return json(await eventosDelDia(dia, hoyK));
    }
    if (accion === 'getAnalitica') {
      // ⚡ v4.83: la misma pregunta dentro de 45 s se contesta de memoria (cambiar de pestaña, volver, recargar).
      const dias = parseInt(url.searchParams.get('dias') || '0') || 0, soloHoyQ = url.searchParams.get('hoy') === '1';
      const kC = dias + ':' + (soloHoyQ ? 1 : 0);
      const cC = _cacheAna.get(kC);
      if (cC && Date.now() - cC.t < 45000) return json(cC.data);
      const dataC = await calcularAnalitica(dias, soloHoyQ);
      _cacheAna.set(kC, { t: Date.now(), data: dataC });
      return json(dataC);
    }
    // 🏷️ Bautizar a un visitante que no dejó nombre (o anotarle algo). Es una deducción de
    // Jony, no un dato que la persona haya dado: se guarda aparte y se muestra marcado.
    // 🔔 v5.01: Te toca — a quién le toca volver a pedir (solo Jony)
    if (accion === 'teToca') return json({ ok: true, ...(await teTocaDesdeLaBase()) });
    if (accion === 'teTocaMarcar') {
      const kT = normNombreTT(P(body, 'clave') || Q('clave'));
      if (!kT) return json({ error: 'falta el cliente' });
      let mT: any = {}; try { mT = JSON.parse(await getConfig('TETOCA_' + kT, '{}')) || {}; } catch { mT = {}; }
      if ((P(body, 'avisado') || Q('avisado')) === '1') mT.avisado = fechaAhora();
      const oc = P(body, 'oculto') || Q('oculto');
      if (oc === '1') mT.oculto = true; else if (oc === '0') delete mT.oculto;
      await setConfig('TETOCA_' + kT, JSON.stringify(mT));
      return json({ ok: true, marca: mT });
    }
    // 🔔 v4.82: los avisos al celular (solo Jony)
    if (accion === 'getAlertasPush') return json({ ok: true, cfg: await alertasCfg() });
    if (accion === 'setAlertasPush') {
      let nueva: any = {};
      try { nueva = JSON.parse(P(body, 'cfg') || Q('cfg') || '{}'); } catch { return json({ error: 'config inválida' }); }
      const cfg: any = {};
      for (const k of Object.keys(ALERTAS_DEF)) { if (nueva[k] === undefined) continue; cfg[k] = (k === 'carritoMin' || k === 'picoMin') ? Math.max(0, parseInt(nueva[k]) || 0) : (nueva[k] ? 1 : 0); }
      await setConfig('ALERTAS_PUSH', JSON.stringify(cfg));
      return json({ ok: true, cfg: { ...ALERTAS_DEF, ...cfg } });
    }
    if (accion === 'probarPushJony') {
      const r = await pushJony('🔔 Prueba del Shuk', 'Los avisos del negocio llegan a este aparato ✓');
      return json(r);
    }
    if (accion === 'ponerAliasVisitante') {
      const vidB = P(body, 'vid') || Q('vid');
      if (!vidB) return json({ error: 'falta el visitante' });
      const claveB = 'vid_alias:' + vidB;
      const valorB = JSON.stringify({ alias: (P(body, 'alias') || Q('alias')).slice(0, 60), nota: (P(body, 'nota') || Q('nota')).slice(0, 300) });
      _cacheAna.clear();   // el nombre nuevo tiene que verse ya
      const exB = await sbGet('config', 'select=clave&clave=eq.' + encodeURIComponent(claveB));
      if (exB.length) await sbPatch('config', 'clave=eq.' + encodeURIComponent(claveB), { valor: valorB });
      else await sbInsert('config', { clave: claveB, valor: valorB });
      return json({ ok: true });
    }
    // 👤 FICHA DE UN VISITANTE: toda su historia, paso por paso. Se pide al tocarlo en la
    // lista (no viaja en getAnalitica para no inflar la respuesta con miles de eventos).
    if (accion === 'getFichaVisitante') {
      const vidF = Q('vid');
      if (!vidF) return json({ error: 'falta el visitante' });
      const [evs, vtsF] = await Promise.all([
        sbGet('trafico', 'select=*&vid=eq.' + encodeURIComponent(vidF) + '&order=id.asc'),
        sbGet('ventas', 'select=id,n_venta,fecha,cliente,estado,total_ars,total_usd,productos&vid=eq.' + encodeURIComponent(vidF) + '&order=n_venta'),
      ]);
      if (!evs.length && !vtsF.length) return json({ error: 'sin datos de ese visitante' });
      const rf = resumirFicha(evs);
      let nombreF = rf.nombre, telF = rf.telefono;
      const ciudadF = rf.ciudad, paisF = rf.pais, dispF = rf.dispositivo, ogF = rf.origen, cuenta = rf.cuenta;
      const compras = vtsF.filter((v: any) => (v.estado || '') !== 'cancelado').map((v: any) => ({ nVenta: v.n_venta, fecha: v.fecha, cliente: v.cliente, estado: v.estado, totalARS: v.total_ars || 0, totalUSD: v.total_usd || 0, productos: (v.productos || '').toString().slice(0, 400) }));
      if (!nombreF && compras.length) nombreF = String(compras[compras.length - 1].cliente || '');
      if (!telF && nombreF) {
        const cf = await sbGet('clientes', 'select=telefono,tipo&nombre=eq.' + encodeURIComponent(nombreF));
        if (cf.length) telF = String(cf[0].telefono || '');
      }
      // Del anónimo: lo que su propio navegador cuenta de él (zona horaria, idioma, aparato).
      let fichaTec: any = null, segF = 0, intF = 0;
      evs.forEach((r: any) => {
        const det = (r.detalle || '').toString();
        if (!esJSON(det)) return;
        try {
          const j = JSON.parse(det);
          if ((r.evento || '') === 'visita') fichaTec = { ...(fichaTec || {}), ...j };
          if ((r.evento || '') === 'salida') { segF += parseInt(j.seg) || 0; intF += parseInt(j.int) || 0; }
        } catch { /**/ }
      });
      const aliasF = await sbGet('config', 'select=valor&clave=eq.' + encodeURIComponent('vid_alias:' + vidF));
      let puestoF: any = { alias: '', nota: '' };
      if (aliasF.length) { try { puestoF = JSON.parse(aliasF[0].valor || '{}'); } catch { /**/ } }
      return json({
        vid: vidF, nombre: nombreF, telefono: telF, ciudad: ciudadF, pais: paisF, dispositivo: dispF, origen: ogF,
        fichaTecnica: fichaTec, segundos: segF, interacciones: intF,
        apodo: '#' + vidF.replace(/[^a-z0-9]/gi, '').slice(-4).toUpperCase(),
        aliasPuesto: puestoF.alias || '', notaPuesta: puestoF.nota || '',
        eventos: cuenta, dias: rf.dias, primera: evs.length ? String(evs[0].fecha || '') : '', ultima: evs.length ? String(evs[evs.length - 1].fecha || '') : '',
        productos: rf.productos, agregados: rf.agregados,
        compras, gastadoARS: compras.reduce((t: number, c: any) => t + (parseFloat(c.totalARS) || 0), 0),
        linea: rf.linea.slice(-800),
      });
    }
    if (accion === 'auditarHijos') {
      const hijo = url.searchParams.get('hijo') || '';
      const data = await sbGet('candy_ventas', 'select=*' + (hijo ? '&hijo=eq.' + encodeURIComponent(hijo) : ''));
      const grupos: any = {};
      data.forEach((r: any) => {
        const fechaMin = (r.fecha || '').toString().slice(0, 16);
        const key = [r.hijo, normCli(r.cliente || ''), (r.codigo || '').toString().trim(), (r.producto || '').toString().trim().toLowerCase(), r.cantidad, r.precio, fechaMin].join('|');
        (grupos[key] = grupos[key] || []).push({ rowIndex: r.id, id: r.id, fecha: fechaMin, cliente: (r.cliente || '').toString(), producto: (r.producto || '').toString(), cantidad: parseInt(r.cantidad) || 1, precio: parseFloat(r.precio) || 0, total: parseFloat(r.total) || 0, saldoPendiente: parseFloat(r.saldo_pendiente) || 0 });
      });
      const duplicados: any[] = [];
      Object.keys(grupos).forEach((k) => { const g = grupos[k]; if (g.length > 1) duplicados.push({ items: g, repetidos: g.length - 1 }); });
      duplicados.sort((a, b) => (b.items[0].fecha).localeCompare(a.items[0].fecha));
      return json({ ok: true, duplicados, totalGrupos: duplicados.length });
    }
    if (accion === 'getAvisosCandy') {
      const hijo = url.searchParams.get('hijo') || '';
      return json((await sbGet('avisos_candy', 'select=*')).map((r: any) => ({ row: r.id, fecha: (r.fecha || '').toString(), hijo: (r.hijo || '').toString(), codigo: (r.codigo || '').toString(), producto: (r.producto || '').toString(), cliente: (r.cliente || '').toString(), telefono: (r.telefono || '').toString(), estado: (r.estado || 'pendiente').toString() })).filter((a: any) => (!hijo || a.hijo === hijo) && a.estado !== 'listo').reverse());
    }
    if (accion === 'notificaciones') return json((await sbGet('notificaciones', 'select=*')).filter((r: any) => r.estado === 'pendiente' || r.estado === 'notificado').map((r: any) => ({ fecha: (r.fecha || '').toString(), productoId: (r.producto_id || '').toString(), producto: r.producto, nombre: r.nombre, telefono: (r.telefono || '').toString(), estado: r.estado, modoCliente: r.modo || 'mayorista' })));
    // 📣 Va también el AVISO de la tienda (banner de texto libre: "envíos sin cargo…"). Viaja acá
    // para no sumarle otra llamada a la tienda: esta ya se hace siempre al abrir.
    if (accion === 'getEstadoTienda') {
      // Una sola consulta para las 5 claves (antes eran 4 SELECT secuenciales en la ruta
      // que abre la tienda: sumar campos de a uno la hacía más lenta a cada release).
      const filasCfg = await sbGet('config', 'select=clave,valor&clave=in.(TIENDA_ESTADO,TIENDA_MSG,TIENDA_AVISO,TIENDA_AVISO_COLOR,TIENDA_AVISO_CFG,TIENDA_VIDRIERA,TIENDA_FIESTAS,TIENDA_ENVIO)');
      const C: any = {};
      filasCfg.forEach((f: any) => { C[f.clave] = f.valor; });
      // 🔥 v4.87: la vidriera viaja en esta misma consulta. Si todavía no existe o quedó vieja
      // (el cron no corrió), se calcula acá una vez: son dos consultas chicas.
      let vidriera: any = null;
      try { vidriera = C.TIENDA_VIDRIERA ? JSON.parse(C.TIENDA_VIDRIERA) : null; } catch { vidriera = null; }
      if (!vidriera || !(Date.now() - (vidriera.t || 0) < 3 * 3600000)) {
        try { vidriera = await refrescarVidriera(); } catch { /* sin vidriera, la tienda ordena como siempre */ }
      }
      const avisoTxt = C.TIENDA_AVISO || '';
      const avisoCol = C.TIENDA_AVISO_COLOR || 'verde';
      // avisoCfg = formato nuevo (v4.53). Si todavía no existe, se arma desde el viejo:
      // un aviso guardado antes de esta versión se sigue viendo igual, sin migrar nada.
      let avisoCfg: any = null;
      try { avisoCfg = C.TIENDA_AVISO_CFG ? JSON.parse(C.TIENDA_AVISO_CFG) : null; } catch { avisoCfg = null; }
      return json({
        estado: C.TIENDA_ESTADO || 'abierta', mensaje: C.TIENDA_MSG || '',
        aviso: avisoTxt, avisoColor: avisoCol,                                  // ← compat: front viejo en la calle
        avisoCfg: avNorm(avisoCfg || { txt: avisoTxt, color: avisoCol }),
        vidriera: vidriera ? { t: vidriera.t, dias: vidriera.dias, top: vidriera.top, orden: vidriera.orden, agota: vidriera.agota } : null,
        fiestas: (() => { try { return normFiestas(C.TIENDA_FIESTAS ? JSON.parse(C.TIENDA_FIESTAS) : null); } catch { return normFiestas(null); } })(),   // 🗓️ v4.88
        envio: (() => { try { return normEnvio(C.TIENDA_ENVIO ? JSON.parse(C.TIENDA_ENVIO) : null); } catch { return normEnvio(null); } })(),         // 🚚 v4.90
      });
    }
    // 🚚 v4.90: el envío gratis (desde cuánto y en qué zona). Solo Jony.
    if (accion === 'setEnvioTienda') {
      const cfgE = normEnvio({ on: P(body, 'on') || Q('on'), min: P(body, 'min') || Q('min'), zona: body.zona !== undefined ? P(body, 'zona') : Q('zona') });
      await setConfig('TIENDA_ENVIO', JSON.stringify(cfgE));
      return json({ ok: true, envio: cfgE });
    }
    // 🗓️ v4.88: fiestas y Shabat. Llega por POST (la lista de productos de cada fiesta puede ser larga).
    if (accion === 'setFiestasTienda') {
      let rawF: any = body.cfg;
      if (typeof rawF === 'string') { try { rawF = JSON.parse(rawF); } catch { return json({ error: 'configuración inválida' }); } }
      const cfgF = normFiestas(rawF);
      await setConfig('TIENDA_FIESTAS', JSON.stringify(cfgF));
      return json({ ok: true, fiestas: cfgF });
    }
    if (accion === 'setAvisoTienda') {
      // Lista blanca en TODO campo enumerado: un payload raro cae a su default y el
      // aviso se publica igual, prolijo — nunca rompe la tienda ni inyecta CSS.
      const cfgAv = avNorm({
        txt: P(body, 'aviso'), estilo: P(body, 'estilo'), color: P(body, 'color'), neon: P(body, 'neon'),
        anim: P(body, 'anim'), tam: P(body, 'tam'), modo: P(body, 'modo'), hasta: P(body, 'hasta'),
      });
      await setConfig('TIENDA_AVISO_CFG', JSON.stringify(cfgAv));
      await setConfig('TIENDA_AVISO', cfgAv.txt);              // espejo para el front viejo
      await setConfig('TIENDA_AVISO_COLOR', cfgAv.color);
      return json({ ok: true, avisoCfg: cfgAv });
    }
    // 🎚️ Interruptor del acceso de Miri (v4.52) — los dos están en SOLO_JONY: Miri no puede ni
    // leerlo ni tocarlo. Apagado ⇒ el portero de arriba contesta 'acceso pausado' a su token.
    if (accion === 'accesoMiri') return json({ acceso: await getConfig('ACCESO_MIRI', '1') });
    if (accion === 'setAccesoMiri') {
      const vAcc = P(body, 'acceso') === '0' ? '0' : '1';
      await setConfig('ACCESO_MIRI', vAcc);
      return json({ ok: true, acceso: vAcc });
    }
    // Sonda del login (cualquier usuario logueado): no devuelve nada sensible. Si el acceso de
    // Miri está apagado, su token NO llega acá — el portero ya contestó 'acceso pausado'.
    if (accion === 'accesoSocio') return json({ ok: true });
    // 🌎 Estado del geo-gate (PÚBLICO, cacheado 30s) — lo lee el middleware de Vercel en cada request.
    // Devuelve el hash del pase (no el pase); el middleware valida ?pase hasheando y comparando.
    if (accion === 'geoGate') {
      const gate = await getConfig('GEO_GATE', 'off');
      const passHash = await getConfig('GEO_PASS_HASH', '');
      return new Response(JSON.stringify({ gate, passHash }), { status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=30, s-maxage=30' } });
    }
    if (accion === 'getConfigCandy') return json({ mostrarStock: (await getConfig('candy_mostrar_stock', '1')) !== '0' });
    if (accion === 'getCompras') return json((await sbGet('costos_jony', 'select=*')).map((r: any) => ({ fecha: r.fecha, productoId: (r.producto_id || '').toString(), producto: (r.producto || '').toString(), cantidad: parseFloat(r.cantidad) || 0, costoTotal: parseFloat(r.costo_total) || 0, costoUnitario: parseFloat(r.costo_unitario) || 0 })));
    if (accion === 'notasClientes') {
      const rows = await sbGet('config', 'select=clave,valor&clave=like.nota_cliente:*');
      const result: any = {};
      rows.forEach((r: any) => { const k = (r.clave || '').toString(); if (k.startsWith('nota_cliente:')) result[k.slice(13)] = r.valor || ''; });
      return json(result);
    }
    if (accion === 'gastos') return json((await sbGet('gastos', 'select=*')).map(gastoFront));
    if (accion === 'rendiciones') return json((await sbGet('rendiciones', 'select=*')).map(rendFront));
    if (accion === 'movimientosStock') {
      const pid = url.searchParams.get('id') || '';
      const rows = await sbGet('movimientos_stock', 'select=*' + (pid ? '&id_prod=eq.' + encodeURIComponent(pid) : '') + '&order=id.desc&limit=200');
      return json(rows.map((r: any) => ({ fecha: r.fecha, id: (r.id_prod || '').toString(), producto: (r.producto || '').toString(), cambio: parseInt(r.cambio) || 0, antes: parseInt(r.antes) || 0, despues: parseInt(r.despues) || 0, origen: (r.origen || '').toString() })));
    }
    if (accion === 'comprasTabHijos') {
      const [prov, comprasRows, dep] = await Promise.all([sbGet('candy_proveedores', 'select=*'), sbGet('candy_compras', 'select=*'), sbGet('candy_deposito', 'select=*')]);
      const compras: any = {}; const orden: string[] = [];
      comprasRows.forEach((r: any) => { const id = (r.compra_id || '').toString(); if (!id) return; if (!compras[id]) { compras[id] = { id, fecha: (r.fecha || '').toString().slice(0, 10), proveedor: r.proveedor || '', items: [], total: 0 }; orden.push(id); } compras[id].items.push({ codigo: r.codigo, nombre: r.producto, cantidad: r.cantidad, costoUnit: r.costo_unit, costoTotal: r.costo_total }); compras[id].total += parseFloat(r.costo_total) || 0; });
      return json({ proveedores: prov.map((r: any) => ({ id: r.id, nombre: r.nombre || '', telefono: r.telefono || '', notas: r.notas || '' })), compras: orden.map((id) => compras[id]).reverse(), deposito: dep.map((d: any) => ({ codigo: d.codigo, producto: d.nombre || '', cantidad: parseInt(d.cantidad) || 0 })) });
    }
    if (accion === 'consultarDeudaCliente') {
      const obj = normCli(url.searchParams.get('cliente') || '');
      const cc = (await sbGet('candy_cc', 'select=*&hijo=eq.' + encodeURIComponent(url.searchParams.get('hijo') || ''))).filter((r: any) => normCli(r.cliente) === obj);
      const saldo = cc.reduce((s: number, r: any) => s + (parseFloat(r.monto) || 0), 0);
      const ts = (f: string) => { const m = (f || '').match(/(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}))?/); return m ? new Date(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0)).getTime() : 0; };
      const detalle = cc.sort((a: any, b: any) => ts(a.fecha) - ts(b.fecha)).slice(-30).map((r: any) => ({ fecha: (r.fecha || '').toString().slice(0, 5), tipo: (r.tipo || '').toString(), producto: (r.detalle || r.tipo || '').toString(), monto: parseFloat(r.monto) || 0 }));
      return json({ saldo, detalle });
    }
    if (accion === 'getProductosShukAdmin' || accion === 'getProductosAdmin') {
      const filasP = (await sbGet('productos', 'select=*&order=nombre')).map(prodAdmin);
      // 🔒 Privacidad Jony/Miri (v4.49): hasta acá el backend mandaba TODOS los costos a
      // CUALQUIER sesión válida y lo único que los tapaba era que el front no los dibujara.
      // O sea: el costo de Jony ya estaba en la memoria del navegador de Miri. Ahora el costo
      // de lo ajeno no sale del servidor. Ojo: se decide por el USUARIO del token, no por
      // vistaSocio — así Jony simulando la vista de Miri sigue viendo todo, que es lo correcto.
      if (!esJony(usuario)) return json(filasP.map((p: any) => (p.dueno === 'Jony' ? { ...p, costo: 0 } : p)));
      return json(filasP);
    }
    if (accion === 'getUltimoStockDia') {
      const rows = await sbGet('stock_diario', 'select=*&hijo=eq.' + encodeURIComponent(url.searchParams.get('hijo') || ''));
      const hoy = fechaAhora().slice(0, 10);
      const fechaNum = (f: string) => { const m = (f || '').match(/(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}))?/); return m ? new Date(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0)).getTime() : 0; };
      let ultF: string | null = null, ultT = 0;
      rows.forEach((r: any) => { const f = (r.fecha || '').toString().slice(0, 10); if (f === hoy) return; const t = fechaNum(r.fecha); if (t > ultT) { ultT = t; ultF = f; } });
      if (!ultF) return json({ stock: {} });
      const stock: any = {};
      rows.forEach((r: any) => { if ((r.fecha || '').toString().slice(0, 10) === ultF) { const c = (r.codigo || '').toString(); stock[c] = (stock[c] || 0) + (parseInt(r.cantidad) || 0); } });
      return json({ stock, fecha: ultF });
    }
    if (accion === 'getComprasHijos') {
      const rows = await sbGet('candy_compras', 'select=*');
      const compras: any = {}; const orden: string[] = [];
      rows.forEach((r: any) => { const id = (r.compra_id || '').toString(); if (!id) return; if (!compras[id]) { compras[id] = { id, fecha: (r.fecha || '').toString().slice(0, 10), proveedor: r.proveedor || '', items: [], total: 0 }; orden.push(id); } compras[id].items.push({ codigo: r.codigo, nombre: r.producto, cantidad: r.cantidad, costoUnit: r.costo_unit, costoTotal: r.costo_total }); compras[id].total += parseFloat(r.costo_total) || 0; });
      return json(orden.map((id) => compras[id]).reverse());
    }
    if (accion === 'getConsumoPeriodo') {
      const hijo = url.searchParams.get('hijo') || '';
      const cs = await sbGet('candy_consumo', 'select=*' + (hijo ? '&hijo=eq.' + encodeURIComponent(hijo) : ''));
      return json(cs.map((r: any) => ({ fecha: (r.fecha || '').toString().slice(0, 10), hijo: r.hijo, producto: r.producto, codigo: r.codigo, cantidad: parseInt(r.cantidad) || 0, costo: parseFloat(r.costo) || 0, motivo: r.motivo, nota: r.nota })));
    }
    if (accion === 'getStockDia') {
      const hoy = fechaAhora().slice(0, 10);
      const sd = await sbGet('stock_diario', 'select=fecha,codigo,cantidad&hijo=eq.' + encodeURIComponent(url.searchParams.get('hijo') || ''));
      const stock: any = {};
      sd.forEach((r: any) => { if ((r.fecha || '').toString().startsWith(hoy)) { const c = (r.codigo || '').toString(); stock[c] = (stock[c] || 0) + (parseInt(r.cantidad) || 0); } });
      return json(stock);
    }
    if (accion === 'historialCliente') {
      const obj = normCli(url.searchParams.get('cliente') || '');
      const cc = await sbGet('candy_cc', 'select=*&hijo=eq.' + encodeURIComponent(url.searchParams.get('hijo') || ''));
      const ts = (f: string) => { const m = (f || '').match(/(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}))?/); return m ? new Date(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0)).getTime() : 0; };
      return json(cc.filter((r: any) => r.cliente && normCli(r.cliente) === obj).sort((a: any, b: any) => ts(b.fecha) - ts(a.fecha)).map((r: any) => ({ fecha: (r.fecha || '').toString(), monto: parseFloat(r.monto) || 0, tipo: r.tipo || '', producto: r.detalle || '', metodo: (r.metodo || '').toString(), comprobante: (r.comprobante || '').toString() })));
    }
    if (accion === 'getCatalogoHijos') {
      // Endurecido: el COSTO solo viaja con sesión válida (el panel de los chicos manda token;
      // la tienda pública no usa el costo y no tiene por qué verlo).
      const conCosto = await sesionValida(token);
      const [cat, dep, shukEn, prods] = await Promise.all([
        sbGet('candy_productos', 'select=*'), sbGet('candy_deposito', 'select=codigo,cantidad'),
        sbGet('shuk_en_candy', 'select=shuk_id,precio_candy'), sbGet('productos', 'select=id,nombre,precio_min,costo,moneda,imagen,stock,categoria,descripcion,dueno,unidades_por_paquete,vinculo,hashgaja,kosher_tipo,jalav'),
      ]);
      const depMap: any = {}; dep.forEach((d: any) => { const c = String(d.codigo); depMap[c] = (depMap[c] || 0) + (parseInt(d.cantidad) || 0); });
      // Circuito F2: stock ofrecido de un shuk:<id> = genuino Candy + TODA la familia de gemelos
      // (paquetes × unidades por paquete, Jony y Miri juntos). El tope lo pone el sistema.
      const stockFamiliar = (p: any) => {
        const grupo = (p.vinculo || '').toString().trim();
        const fam = grupo ? prods.filter((f: any) => (f.vinculo || '').toString().trim() === grupo || String(f.id) === grupo) : [p];
        const paqUni = (fam.length ? fam : [p]).filter((f: any) => ['Jony', 'Miri'].includes((f.dueno || '').toString().trim()))
          .reduce((sm: number, f: any) => sm + (parseInt(f.stock) || 0) * Math.max(1, parseInt(f.unidades_por_paquete) || 1), 0);
        return (depMap['shuk:' + p.id] || 0) + paqUni;
      };
      // 🎁 COMBO (pack mixto vendible): su stock ofrecido = cuántos combos completos se pueden
      // armar con lo disponible de CADA componente (propios: depósito; shuk: genuino + familia).
      const stockDisponible = (cod: string) => cod.startsWith('shuk:')
        ? (porId[cod.slice(5)] ? stockFamiliar(porId[cod.slice(5)]) : (depMap[cod] || 0))
        : (depMap[cod] || 0);
      const stockCombo = (r: any) => {
        let comps: any[] = []; try { comps = JSON.parse(r.componentes || '[]'); } catch { comps = []; }
        if (!comps.length) return null;
        return Math.max(0, Math.min(...comps.map((c: any) => Math.floor(stockDisponible((c.codigo || '').toString()) / Math.max(1, parseInt(c.cant) || 1)))));
      };
      const propios = cat.map((r: any) => ({ codigo: r.codigo, nombre: r.nombre, precioVenta: parseFloat(r.precio_venta) || 0, costo: conCosto ? (parseFloat(r.costo) || 0) : 0, foto: r.foto || '', fotos: r.foto ? [r.foto] : [], esCombo: !!(r.componentes || '').trim(), componentes: (r.componentes || '').toString(), stock: stockCombo(r) !== null ? stockCombo(r) : (depMap[String(r.codigo)] || 0), categoria: (r.categoria || 'Varios').toString(), precioOferta: parseFloat(r.precio_oferta) || 0, fechaOferta: (r.fecha_oferta || '').toString(), cantPack: parseInt(r.cant_pack) || 0, precioPack: parseFloat(r.precio_pack) || 0, siempreDisp: r.siempre_disp === true, hashgaja: (r.hashgaja || '').toString(), kosherTipo: (r.kosher_tipo || '').toString(), jalav: (r.jalav || '').toString() }));
      const porId: any = {}; prods.forEach((p: any) => porId[String(p.id)] = p);
      const _precioCandyMap: any = {}; shukEn.forEach((s: any) => { if (parseFloat(s.precio_candy) > 0) _precioCandyMap[String(s.shuk_id)] = parseFloat(s.precio_candy); });
      const shuk = shukEn.map((s: any) => porId[String(s.shuk_id)]).filter(Boolean).map((p: any) => ({ codigo: 'shuk:' + p.id, nombre: p.nombre, precioVenta: _precioCandyMap[String(p.id)] || parseFloat(p.precio_min) || 0, costo: conCosto ? (parseFloat(p.costo) || 0) : 0, costoMoneda: (p.moneda || '$').toString().trim() === 'U$S' ? 'U$S' : '$', foto: fotoShukUrl(primeraFoto(p.imagen)), fotos: fotosShukLista(p.imagen), stock: stockFamiliar(p), origen: 'shuk', desc: p.descripcion || '', categoria: (p.categoria || 'Varios').toString(), hashgaja: (p.hashgaja || '').toString(), kosherTipo: (p.kosher_tipo || '').toString(), jalav: (p.jalav || '').toString() }));
      return json(propios.concat(shuk));
    }
    if (accion === 'panelHijos') {
      const hijo = url.searchParams.get('hijo') || '';
      const enc = encodeURIComponent(hijo);
      const hoy = fechaAhora().slice(0, 10);   // dd/MM/yyyy
      const [vts, cc, cat, dep, shukEn, prods, cons, ped, cierres, stockD] = await Promise.all([
        sbGet('candy_ventas', 'select=*&hijo=eq.' + enc), sbGet('candy_cc', 'select=cliente,monto&hijo=eq.' + enc),
        sbGet('candy_productos', 'select=*'), sbGet('candy_deposito', 'select=codigo,cantidad'),
        sbGet('shuk_en_candy', 'select=shuk_id,precio_candy'), sbGet('productos', 'select=id,nombre,precio_min,costo,moneda,imagen,stock,categoria,descripcion'),
        sbGet('candy_consumo', 'select=*&hijo=eq.' + enc), sbGet('candy_pedidos', 'select=*'),
        sbGet('cierres_hijos', 'select=fecha&hijo=eq.' + enc), sbGet('stock_diario', 'select=fecha&hijo=eq.' + enc),
      ]);
      const ventasHoy = vts.filter((v: any) => (v.fecha || '').toString().startsWith(hoy)).map((v: any) => ({ rowIndex: v.id, producto: v.producto, codigo: v.codigo, cantidad: v.cantidad, precio: v.precio, cliente: v.cliente, saldoPendiente: v.saldo_pendiente, metodoPago: v.metodo_pago || 'efectivo', hora: (v.fecha || '').toString().slice(11, 16) }));
      const saldos: any = {};
      cc.forEach((r: any) => { if (!r.cliente) return; const k = normCli(r.cliente); if (!saldos[k]) saldos[k] = { cliente: r.cliente, saldo: 0 }; saldos[k].saldo += parseFloat(r.monto) || 0; });
      const deudores = Object.values(saldos).filter((x: any) => Math.abs(x.saldo) > 0.01).sort((a: any, b: any) => Math.abs(b.saldo) - Math.abs(a.saldo));
      // 🧑 Clientes conocidos (todas las grafías unificadas) → el panel los sugiere al tipear un
      // nombre, así los chicos eligen con el dedo y no nacen variantes ('Natan marinberg').
      const cliSet: any = {};
      cc.forEach((r: any) => { const k = normCli(r.cliente); if (k && !cliSet[k]) cliSet[k] = (r.cliente || '').toString().trim(); });
      vts.forEach((v: any) => { const k = normCli(v.cliente); if (k && !cliSet[k]) cliSet[k] = (v.cliente || '').toString().trim(); });
      const clientes = Object.values(cliSet).sort((a: any, b: any) => a.localeCompare(b));
      const depMap: any = {}; dep.forEach((d: any) => { const c = String(d.codigo); depMap[c] = (depMap[c] || 0) + (parseInt(d.cantidad) || 0); });
      const propios = cat.map((r: any) => ({ codigo: r.codigo, nombre: r.nombre, precioVenta: parseFloat(r.precio_venta) || 0, costo: parseFloat(r.costo) || 0, foto: r.foto || '', stock: depMap[String(r.codigo)] || 0, categoria: (r.categoria || 'Varios').toString(), precioOferta: parseFloat(r.precio_oferta) || 0, fechaOferta: (r.fecha_oferta || '').toString(), cantPack: parseInt(r.cant_pack) || 0, precioPack: parseFloat(r.precio_pack) || 0, siempreDisp: r.siempre_disp === true }));
      const porId: any = {}; prods.forEach((p: any) => porId[String(p.id)] = p);
      const _pcMap: any = {}; shukEn.forEach((s: any) => { if (parseFloat(s.precio_candy) > 0) _pcMap[String(s.shuk_id)] = parseFloat(s.precio_candy); });
      const catalogo = propios.concat(shukEn.map((s: any) => porId[String(s.shuk_id)]).filter(Boolean).map((p: any) => ({ codigo: 'shuk:' + p.id, nombre: p.nombre, precioVenta: _pcMap[String(p.id)] || parseFloat(p.precio_min) || 0, costo: parseFloat(p.costo) || 0, costoMoneda: (p.moneda || '$').toString().trim() === 'U$S' ? 'U$S' : '$', foto: fotoShukUrl(primeraFoto(p.imagen)), stock: parseInt(p.stock) || 0, origen: 'shuk', desc: p.descripcion || '', categoria: (p.categoria || 'Varios').toString() })));
      const consumo = cons.filter((c: any) => (c.fecha || '').toString().startsWith(hoy)).map((c: any) => ({ producto: c.producto, codigo: c.codigo, cantidad: c.cantidad, motivo: c.motivo }));
      // El pedido de la tienda guarda el kid en minúscula ('meir', 'jony'); el panel pregunta
      // por 'Meir'/'Pa'. normHijo empareja (y jony↔Pa son la misma persona) — como _normHijo_.
      const pedidos = ped.filter((p: any) => (p.estado || 'pendiente') === 'pendiente' && normHijo(p.hijo) === normHijo(hijo))
        .map((p: any) => ({ fecha: (p.fecha || '').toString(), hijo: (p.hijo || '').toString(), cliente: (p.cliente || '').toString(), telefono: (p.telefono || '').toString(), items: (() => { try { return JSON.parse(p.items || '[]'); } catch { return []; } })(), total: parseFloat(p.total) || 0, estado: (p.estado || '').toString(), pedidoId: (p.pedido_id || '').toString(), nota: (p.nota || '').toString(), vid: (p.vid || '').toString() }));
      // estado del día
      const fechaNum = (f: string) => { const m = (f || '').toString().match(/(\d{2})\/(\d{2})\/(\d{4})/); return m ? (+m[3]) * 10000 + (+m[2]) * 100 + (+m[1]) : 0; };
      const cerr: any = {}; cierres.forEach((r: any) => cerr[(r.fecha || '').toString().slice(0, 10)] = true);
      const fl: any = {}; stockD.forEach((r: any) => { if (r.fecha) fl[(r.fecha || '').toString().slice(0, 10)] = true; });
      let diaAbierto: string | null = null; Object.keys(fl).forEach((f) => { if (!cerr[f] && (!diaAbierto || fechaNum(f) > fechaNum(diaAbierto))) diaAbierto = f; });
      const cierre = { hoy, hoyCerrado: !!cerr[hoy], diaAbierto, diaAbiertoEsPasado: !!(diaAbierto && diaAbierto !== hoy) };
      return json({ ventas: ventasHoy, deudores, catalogo, stockDia: [], consumo, cierre, visitas: {}, pedidos, clientes });
    }
    if (accion === 'ventas') return json((await sbGet('ventas', 'select=*&order=n_venta')).map(ventaFront));
    if (accion === 'getPagos') return json((await sbGet('pagos', 'select=*')).map(pagoFront));
    if (accion === 'getClientes') return json((await sbGet('clientes', 'select=*')).map(clienteFront));
    if (accion === 'getBorrados') return json((await sbGet('borrados', 'select=*')).reverse().map((r: any) => ({ fecha: (r.fecha || '').toString(), tipo: (r.tipo || '').toString(), detalle: (r.detalle || '').toString(), por: (r.por || '').toString() })));
    if (accion === 'getCortes') return json((await sbGet('cortes', 'select=*')).reverse().map((r: any) => ({ fecha: r.fecha, corteId: r.corte_id, gananciaARS: r.ganancia_ars || 0, diezmoARS: r.diezmo_ars || 0, gananciaUSD: r.ganancia_usd || 0, diezmoUSD: r.diezmo_usd || 0, pagadoMyriARS: r.pagado_myri_ars || 0, pagadoMyriUSD: r.pagado_myri_usd || 0, ventas: r.ventas || 0, nota: r.nota || '' })));
    if (accion === 'getLiquidaciones') {
      const rows = (await sbGet('liquidacion_socios', 'select=*')).map((r: any) => ({ fecha: r.fecha, montoARS: parseFloat(r.monto_ars) || 0, montoUSD: parseFloat(r.monto_usd) || 0, nota: (r.nota || '').toString() }));
      return json({ totalARS: rows.reduce((s, m) => s + m.montoARS, 0), totalUSD: rows.reduce((s, m) => s + m.montoUSD, 0), movimientos: rows });
    }
    if (accion === 'getMovsSocios') {
      const [movs, envios, ventas] = await Promise.all([sbGet('movs_socios', 'select=*'), sbGet('envios', 'select=*'), sbGet('ventas', 'select=id,caja_jony,caja_myri')]);
      return json(movsSociosData(movs, envios, ventas));
    }
    if (accion === 'getCajaEnvios') {
      const [envios, ventas] = await Promise.all([sbGet('envios', 'select=*'), sbGet('ventas', 'select=id,caja_jony,caja_myri')]);
      return json(enviosData(envios, ventas));
    }
    // Guarda SOLO el cobrado del envío de una venta en la Caja Envíos (entrada liviana desde el remito).
    // El costo del cadete y quién lo pagó se completan como siempre al confirmar el cobro.
    if (accion === 'setEnvioCobrado') {
      const idEnv = P(body, 'ventaId');
      if (!idEnv) return json({ error: 'falta ventaId' });
      const vv = (await sbGet('ventas', 'select=n_venta,cliente,ars_jony,usd_jony,ars_myri,usd_myri&id=eq.' + encodeURIComponent(idEnv)))[0];
      if (!vv) return json({ error: 'venta inexistente' });
      await upsertEnvio(idEnv, {
        nVenta: vv.n_venta,
        cliente: (vv.cliente || '').toString(),
        dueno: duenoVenta(vv.ars_jony || 0, vv.usd_jony || 0, vv.ars_myri || 0, vv.usd_myri || 0),
        cobrado: Math.round(N(body, 'cobrado')),
      });
      return json({ ok: true });
    }
    if (accion === 'panelAdmin') {
      const [ventas, gastos, rendiciones, pagos, clientes, movs, envios] = await Promise.all([
        sbGet('ventas', 'select=*&order=n_venta'), sbGet('gastos', 'select=*'), sbGet('rendiciones', 'select=*'),
        sbGet('pagos', 'select=*'), sbGet('clientes', 'select=*'), sbGet('movs_socios', 'select=*'), sbGet('envios', 'select=*'),
      ]);
      return json({
        ventas: ventas.map(ventaFront), gastos: gastos.map(gastoFront), rendiciones: rendiciones.map(rendFront),
        pagos: pagos.map(pagoFront), clientes: clientes.map(clienteFront),
        movsSocios: movsSociosData(movs, envios, ventas), envios: enviosData(envios, ventas),
      });
    }
    // ═══ SATÉLITES: fotos con IA, preguntá-al-negocio, flyers, push, dormidos ═══
    if (accion === 'guardarClaveIA') {
      const clave = Q('clave').trim();
      if (!clave.startsWith('sk-ant-')) return json({ error: 'Esa no parece una clave de Anthropic (empiezan con sk-ant-)' });
      const mal = await probarClaveIA('anthropic', clave);
      if (mal) return json({ error: 'Anthropic: ' + mal + '. No se guardó nada.' });
      await setConfig('ANTHROPIC_API_KEY', clave);
      const f = await fechasClavesIA(); f.anthropic = fechaAhora(); await setConfig('CLAVES_IA_FECHAS', JSON.stringify(f));
      return json({ ok: true });
    }
    if (accion === 'guardarClaveCloudinary') {
      const kC = Q('apiKey').trim(), sC = Q('apiSecret').trim();
      if (!/^\d{6,20}$/.test(kC)) return json({ error: 'La «API Key» de Cloudinary es un número largo (sin letras)' });
      if (!/^[A-Za-z0-9_-]{10,64}$/.test(sC)) return json({ error: 'Ese no parece el «API Secret» de Cloudinary' });
      const mal = await probarClaveCloudinary(kC, sC);
      if (mal) return json({ error: 'Cloudinary: ' + mal + '. No se guardó nada.' });
      await setConfig('CLOUDINARY_API_KEY', kC); await setConfig('CLOUDINARY_API_SECRET', sC);
      const f = await fechasClavesIA(); f.cloudinary = fechaAhora(); await setConfig('CLAVES_IA_FECHAS', JSON.stringify(f));
      return json({ ok: true });
    }
    // Firma de una subida (el equipo: Jony y los chicos). Solo firma lo que usan los paneles: el preset y la carpeta.
    if (accion === 'firmarSubida') {
      let campos: any = {};
      try { campos = JSON.parse(Q('params') || '{}') || {}; } catch { return json({ error: 'pedido inválido' }); }
      const firmar = camposAFirmar(campos);
      if (!firmar) return json({ error: 'esa subida no se firma' });
      const cC = await claveCloudinary();
      if (!cC) return json({ sinClave: true });   // todavía no hay clave cargada: el panel sube como siempre
      firmar.timestamp = String(Math.floor(Date.now() / 1000));
      return json({ api_key: cC.k, timestamp: firmar.timestamp, signature: await firmaCloudinary(firmar, cC.s) });
    }
    if (accion === 'analizarFotoProducto') return json(await analizarFotoProducto(Q('url')));
    // ✨ v4.87: la IA propone una ficha mejor para un producto (Jony la aplica o la descarta en el panel).
    if (accion === 'sugerirFicha') return json(await sugerirFicha(Q('id'), Q('motivo'), parseInt(Q('personas')) || 0));
    // ✂️ v5.04: nombre y descripción de las fracciones de una bolsa (la IA, con la regla fija de respaldo).
    if (accion === 'sugerirFraccion') return json(await sugerirFraccion(Q('padre'), Q('cants'), Q('unidad')));
    // ✨ v4.89: el pedido armado por la IA desde el mensaje o la foto del cliente (llega por POST).
    if (accion === 'armarPedidoIA') return json(await armarPedidoIA(P(body, 'texto'), body.imagen));
    if (accion === 'bandejaSubir') {
      const idB = 'B' + Date.now() + Math.floor(Math.random() * 1000);
      await sbInsert('bandeja_fotos', { id: idB, fecha: fechaAhora(), public_id: Q('publicId'), nombre: '', descripcion: '', categoria: '', estado: 'pendiente' });
      return json({ ok: true, id: idB });
    }
    if (accion === 'bandejaListar') {
      const rows = (await sbGet('bandeja_fotos', 'select=*')).sort((a: any, b: any) => (a.id < b.id ? -1 : 1));
      return json(rows.filter((r: any) => r.id && r.estado !== 'usado')
        .map((r: any) => ({ id: r.id.toString(), publicId: (r.public_id || '').toString(), nombre: (r.nombre || '').toString(), desc: (r.descripcion || '').toString(), categoria: (r.categoria || '').toString(), estado: (r.estado || 'pendiente').toString() }))
        .reverse());
    }
    if (accion === 'bandejaUsar') {
      const ex = await sbGet('bandeja_fotos', 'select=id&id=eq.' + encodeURIComponent(Q('id')));
      if (!ex.length) return json({ error: 'no encontrado' });
      await sbPatch('bandeja_fotos', 'id=eq.' + encodeURIComponent(Q('id')), { estado: 'usado' });
      return json({ ok: true });
    }
    if (accion === 'procesarBandeja') return json(await procesarBandejaFn());
    if (accion === 'bandejaEliminar') {
      const ex = await sbGet('bandeja_fotos', 'select=id&id=eq.' + encodeURIComponent(Q('id')));
      if (!ex.length) return json({ ok: false });
      await sbDelete('bandeja_fotos', 'id=eq.' + encodeURIComponent(Q('id')));
      return json({ ok: true });
    }
    if (accion === 'bandejaVaciar') {
      const nV = (await sbGet('bandeja_fotos', 'select=id&estado=neq.usado')).length;
      if (nV) await sbDelete('bandeja_fotos', 'estado=neq.usado');
      return json({ ok: true, n: nV });
    }
    if (accion === 'bandejaReintentar') {
      const nR = (await sbGet('bandeja_fotos', 'select=id&estado=eq.error')).length;
      if (nR) await sbPatch('bandeja_fotos', 'estado=eq.error', { estado: 'pendiente' });
      return json({ ok: true, n: nR });
    }
    if (accion === 'preguntarIA') {
      const pregunta = Q('q').trim();
      if (!pregunta) return json({ error: 'pregunta vacía' });
      const apiKey = await claveIA();
      if (!apiKey) return json({ error: 'sin_clave', mensaje: 'Falta la clave de IA (se carga desde la card Preguntale a tu negocio).' });
      const datos = await resumenNegocio();
      const system = 'Sos el analista de datos de Shuk Mamtakim, un negocio familiar argentino de golosinas y productos kosher ' +
        '(venta mayorista y minorista). También existe "Candy Shop", el mini-negocio de los hijos Meir e Iosi. ' +
        'Te paso un resumen JSON con los datos reales del negocio y una pregunta del dueño. ' +
        'Respondé en español rioplatense, breve y concreto, con los números formateados (ej: $1.234.567). ' +
        'Si la pregunta no se puede responder con los datos disponibles, decilo claramente y sugerí dónde podría mirar. ' +
        'No inventes datos. Montos en ARS salvo que se indique USD.';
      try {
        const rIA = await anthropicMsg(apiKey, { model: 'claude-opus-4-8', max_tokens: 4096, system, messages: [{ role: 'user', content: 'DATOS DEL NEGOCIO (JSON):\n' + datos + '\n\nPREGUNTA: ' + pregunta }] });
        if (rIA.code !== 200) return json({ error: 'La IA respondió con error ' + rIA.code + (rIA.body.error ? ': ' + rIA.body.error.message : '') });
        return json({ ok: true, respuesta: rIA.texto || '(sin respuesta)' });
      } catch (err) { return json({ error: 'No se pudo consultar la IA: ' + err }); }
    }
    if (accion === 'getProductosDormidos') {
      // Activos con stock, sin venta en N días (default 30) y sin oferta vigente → candidatos a oferta.
      const dias = parseInt(Q('dias')) || 30;
      const desde = new Date(Date.now() - dias * 86400000);
      const [ventasD, prodsD] = await Promise.all([sbGet('ventas', 'select=fecha,productos,estado'), sbGet('productos', 'select=*')]);
      let vendidos = '';
      ventasD.forEach((v: any) => {
        const m = (v.fecha || '').toString().match(/(\d{2})\/(\d{2})\/(\d{4})/);
        const f = m ? new Date(m[3] + '-' + m[2] + '-' + m[1] + 'T12:00:00') : null;
        if (f && f >= desde && (v.estado || '') !== 'cancelado') vendidos += '||' + (v.productos || '').toString().toLowerCase();
      });
      const hoyD = new Date();
      return json(prodsD.filter((p: any) => {
        if (!p.id || !p.nombre) return false;
        const stk = parseInt(p.stock);
        if (p.activo === false || isNaN(stk) || stk <= 0) return false;
        if ((p.visible_cat || '').toString() === 'Oculto') return false;   // internos: no se promocionan
        const precioOf = parseFloat(p.precio_oferta) || 0;
        const fechaOf = p.fecha_oferta ? new Date(p.fecha_oferta + 'T23:59:59') : null;
        if (precioOf > 0 && (!fechaOf || isNaN(fechaOf.getTime()) || fechaOf >= hoyD)) return false;
        return vendidos.indexOf(p.nombre.toString().toLowerCase()) === -1;
      }).map((p: any) => ({ id: p.id.toString(), nombre: p.nombre.toString(), desc: (p.descripcion || '').toString(), stock: parseInt(p.stock) || 0, precioMay: parseFloat(String(p.precio_may || '0').replace(',', '.')) || 0, precioMin: parseFloat(String(p.precio_min || '0').replace(',', '.')) || 0 })));
    }
    if (accion === 'enviarPush') {
      const titulo = Q('titulo') || '🛍️ Shuk Mamtakim';
      const mensaje = Q('mensaje');
      if (!mensaje) return json({ error: 'sin mensaje' });
      // OJO: antes se hacía el fetch sin mirar la respuesta y se devolvía ok:true SIEMPRE — el panel
      // decía "enviada" aunque OneSignal la rechazara. Ahora se informa el resultado real.
      try {
        const rPush = await fetch('https://api.onesignal.com/notifications', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Key ' + osKey() },
          body: JSON.stringify({ app_id: OS_APP_ID, included_segments: ['All'], headings: { es: titulo, en: titulo }, contents: { es: mensaje, en: mensaje }, url: SITIO_PUSH }),
        });
        const dPush = await rPush.json().catch(() => ({}));
        if (!rPush.ok || dPush.errors) {
          const det = Array.isArray(dPush.errors) ? dPush.errors.join(' · ') : (dPush.errors ? JSON.stringify(dPush.errors) : 'HTTP ' + rPush.status);
          return json({ error: 'push_rechazada', mensaje: det, destinatarios: 0 });
        }
        return json({ ok: true, id: dPush.id || '', destinatarios: dPush.recipients != null ? dPush.recipients : null });
      } catch (ePush) {
        return json({ error: 'push_sin_red', mensaje: String((ePush as Error).message || ePush), destinatarios: 0 });
      }
    }
    // Estado del servicio de notificaciones: si el push web está configurado y cuántos suscriptos hay.
    // El chequeo de "configurado" usa un endpoint PÚBLICO (no precisa clave), así que sirve de
    // diagnóstico incluso con la clave vencida.
    if (accion === 'pushEstado') {
      let configurado = false, motivo = '', suscriptores: number | null = null, claveOk: boolean | null = null;
      try {
        const rC = await fetch('https://api.onesignal.com/sync/' + OS_APP_ID + '/web');
        const dC = await rC.json().catch(() => ({}));
        if (dC && dC.success === false) motivo = String(dC.description || 'no configurado');
        else { configurado = true; }
      } catch (e) { motivo = 'no se pudo consultar: ' + String((e as Error).message || e); }
      try {
        const rS = await fetch('https://api.onesignal.com/players?app_id=' + OS_APP_ID + '&limit=1',
          { headers: { Authorization: 'Key ' + osKey() } });
        const dS = await rS.json().catch(() => ({}));
        if (rS.ok && !dS.errors && dS.total_count != null) { suscriptores = Number(dS.total_count) || 0; claveOk = true; }
        else claveOk = false;
      } catch { claveOk = false; }
      return json({ ok: true, configurado, motivo, suscriptores, claveOk, appId: OS_APP_ID, sitio: SITIO_PUSH });
    }
    // ── Flyers de Candy (texto IA + fondo/envío vía worker + historial) ──
    if (accion === 'flyerTexto') {
      const apiKey = await claveIA();
      if (!apiKey) return json({ error: 'sin_clave', mensaje: 'Falta configurar la clave de IA (se carga desde el panel de Shuk).' });
      const hijoF = Q('hijo') || 'el vendedor';
      const productosF = Q('productos');
      const ideaF = Q('idea').substring(0, 300);
      const ocasionF = Q('ocasion');
      const intro = (Q('negocio') === 'shuk')
        ? 'Sos el creativo publicitario Y director de arte de "Shuk Mamtakim", un almacén familiar argentino de golosinas ' +
          'y productos kosher importados de Israel (venta mayorista y minorista). Escribís textos para flyers: cortos, ' +
          'tentadores, profesionales pero cercanos, en español rioplatense. '
        : 'Sos el creativo publicitario Y director de arte del Candy Shop de ' + hijoF + ', un chico argentino que vende ' +
          'golosinas a amigos, compañeros y vecinos. Escribís textos para flyers: cortos, divertidos, vendedores, ' +
          'en español rioplatense, con onda pero sin grosería. ';
      const systemF = intro + 'Respetá los límites de caracteres a rajatabla. ' +
        'EL TÍTULO ES LO QUE FRENA EL SCROLL: que tenga gancho comercial de verdad — un beneficio, una novedad, ' +
        'una urgencia o un guiño al producto ("Recién llegado de Israel", "Se van volando", "El chocolate que no se consigue"). ' +
        'NADA de títulos genéricos tipo "Nuestros productos" u "Ofertas". La frase suma el motivo de compra concreto ' +
        '(sabor, origen, kosher, precio, temporada) y el cierre es una orden simpática que empuja a escribir HOY. ' +
        (Q('conPrecios') === '0' ? 'OJO: este flyer NO lleva precios, así que el texto tiene que vender por deseo y el cierre invitar a consultar. ' : '') +
        (Q('conWeb') === '1' ? 'El flyer lleva un código QR a la tienda online: el cierre puede invitar a escanear y pedir. ' : '') +
        'Además escribís el prompt (en inglés) para generar el FONDO del flyer con un modelo de imágenes: ' +
        'tiene que ser detallado y profesional — estilo visual concreto (ej: vibrant candy-pop 3D render, soft gradient studio backdrop, ' +
        'playful flat illustration), motivos inspirados en los productos (vapor de sopa, trozos de chocolate, caramelos flotando), ' +
        'composición con un centro despejado para superponer tarjetas de productos, iluminación y paleta. ' +
        'PROHIBIDO en el prompt: texto, letras, números, logos, marcas, personas, packaging legible. ' +
        'También elegís una paleta de 3 colores en hex que combine con ese fondo: dos para un degradé oscuro-medio ' +
        '(con buen contraste para texto blanco encima) y un acento vibrante claro (para pills con texto oscuro).';
      // 🔄 "Otro texto": los modelos actuales ya no aceptan temperatura, así que con el
      // MISMO pedido devuelven casi siempre lo MISMO. Por eso el panel manda lo que ya
      // generó y acá se le pide, explícito, un ángulo distinto. Sin 'evitar' se comporta
      // igual que antes (lo usan también candyshop.html y paralelo.html).
      const evitarF = Q('evitar').substring(0, 900);
      const intentoF = parseInt(Q('intento')) || 1;
      const anguloF = ['el sabor y la textura', 'el origen israelí y lo kosher', 'la urgencia (poco stock, recién llegado)',
        'el precio / la conveniencia', 'la ocasión (para compartir, para regalar)', 'la novedad / lo que no se consigue'][(intentoF - 1) % 6];
      const userF = 'Productos del flyer: ' + productosF + '\n' +
        (ocasionF ? 'Ocasión/tema del flyer: ' + ocasionF + '\n' : '') +
        (ideaF ? 'Idea/texto que escribió ' + hijoF + ' (mejorala manteniendo su espíritu): "' + ideaF + '"' : 'No dejó texto: inventá algo corto y tentador.') +
        (evitarF
          ? '\n\nOJO — ESTO ES UN PEDIDO DE OTRA VERSIÓN. Para este mismo flyer ya escribiste:\n' + evitarF +
            '\nEscribí una versión NUEVA y claramente distinta: no repitas esos títulos, frases ni cierres, ' +
            'ni sus palabras clave. Cambiá el ángulo de venta — esta vez entrale por ' + anguloF + ' — ' +
            'y cambiá también la paleta y el estilo visual del fondo.'
          : '') +
        '\nGenerá los textos del flyer, el prompt del fondo y la paleta.';
      try {
        const rF = await anthropicMsg(apiKey, {
          model: 'claude-opus-4-8', max_tokens: 1500, system: systemF,
          output_config: { format: { type: 'json_schema', schema: {
            type: 'object',
            properties: {
              titulo: { type: 'string', description: 'Título grande y pegadizo, MÁXIMO 22 caracteres' },
              frase: { type: 'string', description: 'Frase vendedora corta, MÁXIMO 80 caracteres' },
              cierre: { type: 'string', description: 'Llamado a la acción, MÁXIMO 30 caracteres, ej: ¡Pedime ya!' },
              fondo_prompt: { type: 'string', description: 'Prompt en inglés, detallado y profesional, para generar el fondo del flyer (estilo, motivos de los productos, composición con centro despejado, iluminación, paleta). Sin texto/letras/logos/personas.' },
              paleta_a: { type: 'string', description: 'Color hex oscuro del degradé, ej #1a2c5e' },
              paleta_b: { type: 'string', description: 'Color hex medio del degradé, ej #4a6fd4' },
              paleta_accent: { type: 'string', description: 'Color hex de acento claro y vibrante, ej #ffd24a' },
            },
            required: ['titulo', 'frase', 'cierre', 'fondo_prompt', 'paleta_a', 'paleta_b', 'paleta_accent'], additionalProperties: false,
          } } },
          messages: [{ role: 'user', content: userF }],
        });
        if (rF.code !== 200) return json({ error: 'IA error ' + rF.code + (rF.body.error ? ': ' + rF.body.error.message : '') });
        const t = JSON.parse(rF.texto);
        return json({ ok: true, titulo: t.titulo || '¡Golosinas!', frase: t.frase || '', cierre: t.cierre || '¡Pedime ya!', fondoPrompt: t.fondo_prompt || '', paletaA: t.paleta_a || '', paletaB: t.paleta_b || '', paletaAccent: t.paleta_accent || '' });
      } catch (err) { return json({ error: 'No se pudo generar el texto: ' + err }); }
    }
    if (accion === 'fondoFlyer') {
      // El worker tiene la clave de imágenes; esto es un puente autenticado.
      try {
        const rW = await fetch(WORKER_RELAY_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fondoIA: true, secret: BOT_SECRET, tema: Q('tema'), prompt: Q('prompt') }) });
        return json(await rW.json());
      } catch (err) { return json({ error: 'fondo: ' + err }); }
    }
    if (accion === 'guardarClaveGemini') {
      const claveG = Q('clave').trim();
      // Google tiene DOS formatos vivos: el clásico 'AIza…' y el nuevo 'AQ.…'
      // (el que usa hoy AI Studio). Validar solo el viejo rechazaba la clave buena.
      if (!/^(AIza|AQ\.)/.test(claveG) || claveG.length < 30) return json({ error: 'Esa no parece una clave de Gemini (empiezan con AIza… o AQ.…)' });
      const mal = await probarClaveIA('gemini', claveG);
      if (mal) return json({ error: 'Gemini: ' + mal + '. No se guardó nada.' });
      await setConfig('GEMINI_API_KEY', claveG);
      const f = await fechasClavesIA(); f.gemini = fechaAhora(); await setConfig('CLAVES_IA_FECHAS', JSON.stringify(f));
      return json({ ok: true });
    }
    // 🔑 v4.93: en qué estado están las claves de IA — NUNCA devuelve la clave, ni un pedazo.
    if (accion === 'estadoClavesIA') {
      const f = await fechasClavesIA();
      const est = async (clave: string, env: string, fecha: string) => {
        const enPanel = !!(await getConfig(clave, '')), enSecreto = !!Deno.env.get(env);
        return { cargada: enPanel || enSecreto, origen: enPanel ? 'panel' : enSecreto ? 'secreto' : 'ninguna', fecha: enPanel ? (fecha || '') : '' };
      };
      return json({ anthropic: await est('ANTHROPIC_API_KEY', 'ANTHROPIC_API_KEY', f.anthropic), gemini: await est('GEMINI_API_KEY', 'GEMINI_API_KEY', f.gemini), cloudinary: await est('CLOUDINARY_API_SECRET', 'CLOUDINARY_API_SECRET_NO_EXISTE', f.cloudinary) });
    }
    if (accion === 'disenoFlyerIA') {
      // 🪄 Gemini diseña el flyer ENTERO; los precios se verifican leyendo la
      // imagen ANTES de entregarla (y si no cierran, se reintenta una vez).
      try {
        const gKey = await claveGemini();
        if (!gKey) return json({ error: 'sin_clave_gemini', mensaje: 'Falta la clave de Gemini (se carga desde el armador de flyers).' });
        let prodsIA: any[] = [];
        try { prodsIA = JSON.parse(Q('productos') || '[]'); } catch { prodsIA = []; }
        prodsIA = prodsIA.slice(0, 8);
        if (!prodsIA.length) return json({ error: 'sin productos' });
        const tIA = { titulo: Q('titulo'), frase: Q('frase'), cierre: Q('cierre') };
        const aspecto = Q('formato') === 'historia' ? '9:16' : Q('formato') === 'cuadrado' ? '1:1' : '4:5';
        const imgsIA: { mime: string; data: string }[] = [];
        imgsIA.push(await b64DeUrl('https://res.cloudinary.com/dq2boloyp/image/upload/e_trim:10/w_440/app_icon_rmbyhb.png'));
        for (const pr of prodsIA) { if (pr.foto) { try { imgsIA.push(await b64DeUrl(pr.foto)); } catch { /* foto caída: sigue sin ella */ } } }
        const conPreciosIA = Q('precios') !== '0';
        const promptIA = promptFlyerIA(tIA, prodsIA, Q('estilo'), aspecto, conPreciosIA, Q('web'));
        let gen = await geminiImagen(gKey, promptIA, imgsIA, aspecto);
        if (!gen.b64) return json({ error: gen.error || 'Gemini no devolvió imagen' });
        let aviso = '';
        // sin precios en la pieza no hay nada que verificar
        const ver = conPreciosIA ? await verificarPreciosFlyer(gen.b64, gen.mime || 'image/png', prodsIA) : null;
        if (ver && !ver.ok) {
          const gen2 = await geminiImagen(gKey, promptIA + '\nCORRECCIÓN CRÍTICA: en el intento anterior estos importes salieron mal o ilegibles: ' + ver.problemas.join('; ') + '. Repetí el diseño con CADA precio copiado EXACTO, grande y legible junto a su producto.', imgsIA, aspecto);
          if (gen2.b64) {
            const ver2 = await verificarPreciosFlyer(gen2.b64, gen2.mime || 'image/png', prodsIA);
            gen = gen2;
            if (ver2 && !ver2.ok) aviso = 'Revisá los precios en la imagen antes de mandarla: ' + ver2.problemas.join('; ');
          } else aviso = 'Revisá los precios en la imagen antes de mandarla: ' + ver.problemas.join('; ');
        } else if (ver === null) aviso = '';
        return json({ ok: true, b64: gen.b64, mime: gen.mime || 'image/png', aviso });
      } catch (err) { return json({ error: 'disenoIA: ' + err }); }
    }
    if (accion === 'guardarFlyer') {
      const idF = 'F' + Date.now();
      await sbInsert('flyers_hijos', { id: idF, fecha: fechaAhora(), hijo: Q('hijo'), url: Q('url'), titulo: Q('titulo'), codigos: Q('codigos'), idea: Q('idea'), fondo_ia: Q('fondo') === '1' ? 'SI' : 'NO', estado: 'activo', config: Q('config') });
      return json({ ok: true, id: idF });
    }
    if (accion === 'getFlyersHijos') {
      const rows = (await sbGet('flyers_hijos', 'select=*')).sort((a: any, b: any) => (a.id < b.id ? -1 : 1));
      return json(rows.filter((r: any) => r.id && r.hijo === Q('hijo'))
        .map((r: any) => ({ id: r.id.toString(), fecha: (r.fecha || '').toString(), url: (r.url || '').toString(), titulo: (r.titulo || '').toString(), codigos: (r.codigos || '').toString(), idea: (r.idea || '').toString(), fondo: r.fondo_ia === 'SI', estado: (r.estado || 'activo').toString(), config: (r.config || '').toString() }))
        .reverse().slice(0, 60));
    }
    if (accion === 'archivarFlyer') {
      const ex = await sbGet('flyers_hijos', 'select=id&id=eq.' + encodeURIComponent(Q('id')));
      if (!ex.length) return json({ error: 'no encontrado' });
      await sbPatch('flyers_hijos', 'id=eq.' + encodeURIComponent(Q('id')), { estado: Q('estado') || 'archivado' });
      return json({ ok: true });
    }
    if (accion === 'eliminarFlyer') {
      const ex = await sbGet('flyers_hijos', 'select=id&id=eq.' + encodeURIComponent(Q('id')));
      if (!ex.length) return json({ error: 'no encontrado' });
      await sbDelete('flyers_hijos', 'id=eq.' + encodeURIComponent(Q('id')));
      return json({ ok: true });
    }
    if (accion === 'enviarFlyerWA') {
      // Manda el flyer al WhatsApp del chico (vía worker → Twilio MediaUrl).
      try {
        const rW = await fetch(WORKER_RELAY_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ relay: true, secret: BOT_SECRET, dest: Q('hijo').toLowerCase(),
          // El epígrafe del panel ya trae el link tocable: se manda tal cual para
          // poder reenviarlo con la foto sin volver a escribirlo.
          text: Q('texto') || '🎨 ¡Tu flyer está listo! Reenvialo a tus contactos o subilo a tu estado.', mediaUrl: Q('url') }) });
        return json(await rW.json());
      } catch (err) { return json({ error: 'envío: ' + err }); }
    }
    // ═══ BOT / VOZ (Shuki) — panel (token) para simular, gateway/worker real (secret) ═══
    if (accion === 'botMsg') return json(await procesarMensajeBot(Q('from'), Q('text'), Q('sim') === '1'));
    if (accion === 'botVoz') {
      const rVoz: any = await procesarVozIA(Q('from'), Q('text'), Q('sim') === '1', Q('canal') || 'texto');
      // Voz natural embebida: el audio va en la MISMA respuesta (ahorra un viaje de red).
      if (Q('tts') === '1' && rVoz && rVoz.reply) { const a = await ttsOpenAI(rVoz.reply); if (a) rVoz.audio = a; }
      return json(rVoz);
    }
    if (accion === 'tts') {
      const keyT = await claveOpenAI();
      if (!keyT) return json({ error: 'sin_openai' });
      const textoT = Q('text').substring(0, 500);
      if (!textoT) return json({ error: 'sin texto' });
      const b64 = await ttsOpenAI(textoT);
      if (!b64) return json({ error: 'tts_fallo' });
      return json({ audio: b64 });
    }
    if (accion === 'pedidoVoz') {
      // Tool de Retell (custom function): POST {args:{cliente,direccion,items}} + secret en la URL.
      const a = body.args || body;
      const itemsStr = (typeof a.items === 'string') ? a.items : JSON.stringify(a.items || []);
      const telV = a.tel || (body.call && (body.call.from_number || '')) || '';
      return json(await registrarPedidoVoz(itemsStr, a.cliente || '', a.direccion || '', telV, Q('dry') === '1'));
    }
    if (accion === 'transcribirIdea') {
      // Audio → texto vía el worker (tiene la clave de transcripción como secret).
      try {
        const rW = await fetch(WORKER_RELAY_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ transcribir: true, secret: BOT_SECRET, b64: P(body, 'audio'), mime: P(body, 'mime') }) });
        return json(await rW.json());
      } catch (err) { return json({ error: 'transcribir: ' + err }); }
    }
    if (accion === 'borrarVentas') return json(await borrarVentasFn(Q('ids')));
    if (accion === 'recibirMercaderia') {
      // 📥 Recepción de mercadería con PPP (precio promedio ponderado de costo):
      //  · producto sin stock (o sin costo previo) → costo = el de esta compra
      //  · producto con stock → costo = (stock×costoActual + cant×costoNuevo) / (stock+cant)
      // Suma stock (respetando depósito compartido), deja huella en movimientos_stock y
      // registro auditable en `recepciones`. Dedup por compraId (reintento de red no duplica).
      let itemsR: any[]; try { itemsR = JSON.parse(P(body, 'items') || '[]'); } catch { return json({ error: 'items inválido' }); }
      // v4.48: un item también puede traer precioMay/precioMin (editados en la misma recepción).
      // Se acepta incluso con cantidad 0 (cambió el precio pero esa línea no recibió unidades).
      itemsR = itemsR.filter((it) => it && it.id && ((parseFloat(it.cantidad) || 0) > 0 || (parseFloat(it.precioMay) || 0) > 0 || (parseFloat(it.precioMin) || 0) > 0));
      if (!itemsR.length) return json({ error: 'sin items' });
      const compraId = P(body, 'compraId') || 'RC' + Date.now();
      // v4.49: a QUIÉN se le compró y una nota libre (vino roto, abierto, faltó, etc.).
      // Van como CABECERA: son de la compra entera, no de cada renglón. Es el dato que le
      // faltaba a `recepciones` para poder contestar "¿a quién le compré esto y cuándo?".
      const proveedorR = (P(body, 'proveedor') || '').toString().trim().slice(0, 120);
      const notaR = (P(body, 'nota') || '').toString().trim().slice(0, 500);
      const kR = 'rc_' + compraId;
      const exR = await sbGet('config', 'select=clave&clave=eq.' + encodeURIComponent(kR));
      if (exR.length) return json({ ok: true, dup: true, compraId });
      await setConfig(kR, fechaAhora());
      const resumen: any[] = [];
      for (const it of itemsR) {
        const pid = String(it.id);
        const cant = parseFloat(it.cantidad) || 0;
        const costoU = parseFloat(it.costoUnit) || 0;
        const pr = await sbGet('productos', 'select=nombre,costo,moneda,dueno,precio_may,precio_min&id=eq.' + encodeURIComponent(pid));
        if (!pr.length) { resumen.push({ id: pid, error: 'no existe' }); continue; }
        const p = pr[0];
        const mv = cant > 0 ? await moverStockShuk(pid, cant, '📥 Recepción — compra ' + compraId) : null;
        const antes = mv ? mv.antes : 0;
        const costoAnt = parseFloat(p.costo) || 0;
        let costoNuevo = costoU;
        if (antes > 0 && costoAnt > 0 && costoU > 0) costoNuevo = Math.round(((antes * costoAnt + cant * costoU) / (antes + cant)) * 100) / 100;
        const patchP: any = {};
        if (cant > 0 && costoU > 0) patchP.costo = costoNuevo;
        // 💰 Precios de venta editados desde la recepción (v4.48). SIEMPRE números (regla gviz:
        // un precio como texto desaparece de la tienda). Se registra el cambio en el resumen.
        const nMay = parseFloat(it.precioMay) || 0, nMin = parseFloat(it.precioMin) || 0;
        const vMayAnt = parseFloat(String(p.precio_may ?? '').replace(',', '.')) || 0;
        const vMinAnt = parseFloat(p.precio_min) || 0;
        if (nMay > 0 && Math.abs(nMay - vMayAnt) > 0.001) patchP.precio_may = nMay;
        if (nMin > 0 && Math.abs(nMin - vMinAnt) > 0.001) patchP.precio_min = nMin;
        if (Object.keys(patchP).length) await sbPatch('productos', 'id=eq.' + encodeURIComponent(pid), patchP);
        if (cant > 0) await sbInsert('recepciones', { fecha: fechaAhora(), compra_id: compraId, producto_id: pid, producto: p.nombre, cantidad: cant, costo_unit: costoU, costo_anterior: costoAnt || null, costo_nuevo: costoU > 0 ? costoNuevo : null, stock_antes: antes, stock_despues: mv ? mv.despues : antes + cant, moneda: (p.moneda || '$').toString(), dueno: (p.dueno || '').toString(), proveedor: proveedorR, nota: notaR });
        // Compat: las compras de productos de Jony también quedan en su log histórico (costos_jony).
        if ((p.dueno || '') === 'Jony' && cant > 0 && costoU > 0) await sbInsert('costos_jony', { fecha: fechaAhora(), producto_id: pid, producto: p.nombre, cantidad: cant, costo_total: Math.round(cant * costoU * 100) / 100, costo_unitario: costoU });
        resumen.push({ id: pid, nombre: p.nombre, stock: (mv ? mv.despues : null), costoAnterior: costoAnt, costoNuevo: (cant > 0 && costoU > 0) ? costoNuevo : costoAnt,
          precioMayNuevo: patchP.precio_may ?? null, precioMayAnterior: patchP.precio_may != null ? vMayAnt : null,
          precioMinNuevo: patchP.precio_min ?? null, precioMinAnterior: patchP.precio_min != null ? vMinAnt : null });
      }
      return json({ ok: true, compraId, items: resumen });
    }
    // 📜 Historial de compras de UN producto: a quién se le compró, cuándo, cuánto y a qué costo.
    // La tabla `recepciones` venía guardando todo esto desde v3.05 y NADIE la leía nunca.
    // 🔒 Está en SOLO_JONY (el portero de arriba ya rebotó a cualquier otro), pero además se
    //    revalida acá el dueño del producto: defensa en profundidad, no una sola puerta.
    if (accion === 'historialCompras') {
      const pidH = Q('id');
      if (!pidH) return json({ error: 'sin id' });
      const prH = await sbGet('productos', 'select=nombre,dueno,moneda,costo,unidades_por_paquete&id=eq.' + encodeURIComponent(pidH));
      if (!prH.length) return json({ error: 'no existe' });
      const pH = prH[0];
      if (!esJony(usuario)) return json({ error: 'no autorizado' });
      const filasH = await sbGet('recepciones', 'select=*&producto_id=eq.' + encodeURIComponent(pidH) + '&order=id.desc&limit=' + Math.min(100, parseInt(Q('limite')) || 30));
      // fechaAhora() escribe "dd/MM/yyyy HH:mm": se manda tal cual y también en ISO, para ordenar.
      const isoDe = (f: string) => { const m = String(f || '').match(/(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}))?/); return m ? `${m[3]}-${m[2]}-${m[1]}T${m[4] || '00'}:${m[5] || '00'}` : ''; };
      const compras = filasH.map((r: any) => ({
        fecha: r.fecha || '', iso: isoDe(r.fecha), proveedor: (r.proveedor || '').toString(), nota: (r.nota || '').toString(),
        cantidad: parseFloat(r.cantidad) || 0, costoUnit: parseFloat(r.costo_unit) || 0,
        costoAnterior: r.costo_anterior == null ? null : parseFloat(r.costo_anterior),
        costoNuevo: r.costo_nuevo == null ? null : parseFloat(r.costo_nuevo),
        stockAntes: parseFloat(r.stock_antes) || 0, stockDespues: parseFloat(r.stock_despues) || 0,
        moneda: (r.moneda || '$').toString(), compraId: (r.compra_id || '').toString(),
      }));
      // Resumen útil para decidir una recompra: qué proveedores, a qué precio, cuánto se lleva comprado.
      const porProveedor: Record<string, { veces: number; unidades: number; ultimo: number; min: number; max: number }> = {};
      compras.filter((c) => c.costoUnit > 0).forEach((c) => {
        const k = c.proveedor || '(sin proveedor)';
        const a = porProveedor[k] || (porProveedor[k] = { veces: 0, unidades: 0, ultimo: c.costoUnit, min: c.costoUnit, max: c.costoUnit });
        a.veces++; a.unidades += c.cantidad; a.min = Math.min(a.min, c.costoUnit); a.max = Math.max(a.max, c.costoUnit);
      });
      return json({ ok: true, producto: { id: pidH, nombre: pH.nombre || '', dueno: pH.dueno || '', moneda: pH.moneda || '$', costo: parseFloat(pH.costo) || 0, upp: Math.max(1, parseInt(pH.unidades_por_paquete) || 1) }, compras, porProveedor });
    }
    // 🔎 Buscar productos por código de barras (v4.50). Devuelve TODOS los candidatos, nunca
    // uno solo: un mismo código puede caer en dos productos (gemelos = mismo producto clonado
    // para cada dueño) y la regla del proyecto es que eso lo decide el ID, no el nombre ni el
    // código. Quien llama muestra los candidatos y el usuario elige.
    if (accion === 'buscarPorEAN') {
      const cod = normEAN(Q('ean'));
      if (!cod) return json({ ok: true, ean: '', candidatos: [] });
      const filas = await sbGet('productos', 'select=*&ean=eq.' + encodeURIComponent(cod));
      const cands = filas.map(prodAdmin).filter((p: any) => p.activo);
      return json({ ok: true, ean: cod, candidatos: cands, ambiguo: cands.length > 1 });
    }
    // 📜 La ÚLTIMA compra de CADA producto, en una sola llamada. Es lo que necesita la orden
    // de compra para poner "última: Rami Levy · 12/07 · U$S 1,80" en cada renglón: pedirlo de a
    // uno para 63 artículos serían 63 requests. Trae solo lo de Jony (misma barrera).
    if (accion === 'ultimasCompras') {
      if (!esJony(usuario)) return json({ error: 'no autorizado' });
      // Orden ascendente + pisar: la última que queda por producto es la más nueva.
      const todasU = await sbGet('recepciones', 'select=producto_id,fecha,proveedor,costo_unit,cantidad,moneda&order=id.asc&limit=100000');
      const ultima: Record<string, any> = {};
      for (const r of todasU) {
        const pid = String(r.producto_id || '');
        if (!pid || !(parseFloat(r.costo_unit) > 0)) continue;
        ultima[pid] = { fecha: (r.fecha || '').toString().slice(0, 10), proveedor: (r.proveedor || '').toString(), costoUnit: parseFloat(r.costo_unit) || 0, cantidad: parseFloat(r.cantidad) || 0, moneda: (r.moneda || '$').toString() };
      }
      return json({ ok: true, ultima });
    }
    // ═══ DIAGNÓSTICO + BACKUP + CRON ═══
    if (accion === 'leerStockRaw') {
      const prL = await sbGet('productos', 'select=*&id=eq.' + encodeURIComponent(Q('id')));
      if (!prL.length) return json({ error: 'no encontrado' });
      const p = prL[0];
      return json({ ssId: 'supabase', ssNombre: 'productos', fila: p.id, valores: [p.id, p.nombre, p.descripcion, p.precio_may, p.precio_min, p.stock, p.imagen, p.activo ? 'SI' : 'NO', p.categoria, p.visible_cat], formulaD: '', protecciones: 0 });
    }
    if (accion === 'auditoriaStock') {
      // Historial de stock de un producto, reconstruido de movimientos_stock (en Google
      // se leían los backups horarios de Drive; acá el registro exacto ya existe).
      const pidA = Q('id');
      if (!pidA) return json({ error: 'falta id' });
      const movs = (await sbGet('movimientos_stock', 'select=fecha,producto,despues&id_prod=eq.' + encodeURIComponent(pidA) + '&order=id.asc'));
      if (Q('modo') === 'diario') {
        const porDia: any = {};
        movs.forEach((m: any) => { const d = (m.fecha || '').toString().slice(0, 10); porDia[d] = m; });   // el último de cada día
        const dias = Math.min(parseInt(Q('dias')) || 30, 31);
        const fechaNum = (f: string) => { const m = f.match(/(\d{2})\/(\d{2})\/(\d{4})/); return m ? (+m[3]) * 10000 + (+m[2]) * 100 + (+m[1]) : 0; };
        return json(Object.keys(porDia).sort((a, b) => fechaNum(b) - fechaNum(a)).slice(0, dias).map((d) => ({ backup: d, nombre: (porDia[d].producto || '').toString(), stock: parseInt(porDia[d].despues) || 0 })));
      }
      const max = Math.min(parseInt(Q('max')) || 24, 60);
      return json(movs.slice(-max).reverse().map((m: any) => ({ backup: (m.fecha || '').toString(), nombre: (m.producto || '').toString(), stock: parseInt(m.despues) || 0 })));
    }
    if (accion === 'backupAhora') return json(await backupAhora(Q('etiqueta') || 'manual'));
    if (accion === 'cierreDiario') return json(await cierreDiario());
    if (accion === 'cronHorario') {
      // El pg_cron de Supabase llama esto cada hora (con el secreto): backup + bandeja +
      // cierre diario a partir de las 21hs — espejo de crearBackup() del motor viejo.
      // El cierre arranca APAGADO (config cierre_diario_activo) para no duplicar el de Google.
      const rBk = await backupAhora('');
      let rCierre: any = { off: true };
      const horaAR = parseInt(fechaAhora().slice(11, 13), 10);
      if (horaAR >= 21 && (await getConfig('cierre_diario_activo', '0')) === '1') rCierre = await cierreDiario();
      let rBand: any = {};
      try { rBand = await procesarBandejaFn(); } catch (e) { rBand = { error: String(e) }; }
      // Limpieza de claves de dedup viejas (vh_* de ventas hijos, rc_* de recepciones):
      // más de 1 día no protegen nada.
      try {
        const hoyCfg = fechaAhora().slice(0, 10);
        for (const pref of ['vh_', 'rc_']) {
          const claves = await sbGet('config', 'select=clave,valor&clave=like.' + pref + '*');
          for (const c of claves) { if ((c.valor || '').toString().slice(0, 10) !== hoyCfg) await sbDelete('config', 'clave=eq.' + encodeURIComponent(c.clave)); }
        }
      } catch { /**/ }
      let rAvisos: any = {};
      try { rAvisos = await avisosDelCron(); } catch (e) { rAvisos = { error: String(e) }; }   // 🔔 v4.82
      let rVidr: any = {};
      try { const vV = await refrescarVidriera(); rVidr = { top: vV.top.length, agota: Object.keys(vV.agota).length, dias: vV.dias }; } catch (e) { rVidr = { error: String(e) }; }   // 🔥 v4.87
      return json({ ok: true, backup: rBk, cierre: rCierre, bandeja: rBand, avisos: rAvisos, vidriera: rVidr });
    }
    return json({ error: 'acción no soportada aún: ' + accion });
  } catch (e) {
    return json({ error: String(e) });
  }
});
