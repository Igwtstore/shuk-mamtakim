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
function gananciaPitz(productosStr: string, mapa: any, tc: number) {
  const out = { ars: 0, usd: 0, faltaCosto: [] as string[], faltaTC: false };
  (productosStr || '').split(' || ').forEach((linea) => {
    const t = (linea || '').trim(); if (!t || t[0] !== '•') return;
    const L = parseLinea(t); if (!L) return;
    const cands = mapa[L.nombre.toLowerCase()]; if (!cands || !cands.length) return;
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
function mapaProdJony(productos: any[]) {
  const map: any = {};
  productos.forEach((p) => {
    if ((p.dueno || '').toString().trim() !== 'Jony') return;
    const moneda = ((p.moneda || '$').toString().trim() === 'U$S') ? 'U$S' : '$';
    const costo = parseFloat(String(p.costo || '0').replace(',', '.')) || 0;
    const entry = { id: p.id, moneda, costo, desc: (p.descripcion || '').toString().trim().toLowerCase(), nombre: (p.nombre || '').toString().trim().toLowerCase() };
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
    const it = { v, ...d, cub: { jA: 0, mA: 0, jU: 0, mU: 0 } };   // cub: cubierto que CUENTA (pagos > último corte)
    porId[String(v.id)] = it;
    if (d.jA <= 0 && d.mA <= 0 && d.jU <= 0 && d.mU <= 0) return;
    (res[norm(v.cliente)] = res[norm(v.cliente)] || []).push(it);
  });
  Object.values(res).forEach((l: any) => l.sort((a: any, b: any) => _fparMin(a.v.fecha) - _fparMin(b.v.fecha)));
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
    if (cuenta) { it.cub.jA += pz; it.cub.mA += gA; it.cub.mU += gU; it.cub.jU += pzU; }
  });
  // Generales: FIFO por componente (Pitzujim primero en $, golosinas primero en U$S)
  ord.filter((p) => !p.pedido_id && (p.caja || '') !== 'PERDON').forEach((p) => {
    const cuenta = _fparMin(p.fecha) > msCorte;
    let pA = parseFloat(p.monto_ars) || 0, pU = parseFloat(p.monto_usd) || 0;
    (res[norm(p.cliente)] || []).forEach((it: any) => {
      let a = Math.min(pA, it.jA); it.jA -= a; pA -= a; if (cuenta) it.cub.jA += a;
      a = Math.min(pA, it.mA); it.mA -= a; pA -= a; if (cuenta) it.cub.mA += a;
      a = Math.min(pU, it.mU); it.mU -= a; pU -= a; if (cuenta) it.cub.mU += a;
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
      const gp = gananciaPitz((v.productos || '').toString(), mapa, tc);
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
    if (c.jA <= 0.5 && c.mA <= 0.5 && c.jU <= 0.005 && c.mU <= 0.005) return;
    if (!sinComi) {
      out.comisionARS += Math.round(c.mA * 0.15);
      out.comisionUSD += Math.round(c.mU * 0.15 * 100) / 100;
    }
    const bJ = (parseFloat(v.ars_jony) || 0) + (parseFloat(v.usd_jony) || 0);
    const fJ = bJ > 0 ? Math.min(1, (c.jA + c.jU) / bJ) : 0;
    if (fJ > 0) {
      const gp = gananciaPitz((v.productos || '').toString(), mapa, tc);
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
async function calcularRepartoPitz(cliente: string, pedidoId: string, montoARS: number, montoUSD: number, montoPitzExplicito: number, excludePagoId?: string): Promise<{ pitzARS: number; pitzUSD: number }> {
  let pitzARS = montoPitzExplicito || 0, pitzUSD = 0;
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
    let poolA = montoARS, poolU = montoUSD;
    let autoPitzA = 0, autoPitzU = 0;
    items.forEach((it: any) => {
      let a = Math.min(poolA, it.jA); poolA -= a; autoPitzA += a;   // $: Pitzujim primero
      a = Math.min(poolA, it.mA); poolA -= a;                       // $: después golosinas
      a = Math.min(poolU, it.mU); poolU -= a;                       // U$S: golosinas primero
      a = Math.min(poolU, it.jU); poolU -= a; autoPitzU += a;       // U$S: después Pitzujim
    });
    if (pitzARS <= 0) pitzARS = Math.round(autoPitzA);
    pitzUSD = Math.round(autoPitzU * 100) / 100;
  } catch { /* si el reparto falla, queda en 0 (como antes) */ }
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
  // fecha del pedido → "no me coinciden las fechas con el resumen de MP", caso KI TOV #37).
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
const pagoFront = (p: any) => ({ id: p.id, fecha: p.fecha, cliente: (p.cliente || '').toString(), pedidoId: (p.pedido_id || '').toString(), montoARS: parseFloat(p.monto_ars) || 0, montoUSD: parseFloat(p.monto_usd) || 0, caja: (p.caja || '').toString(), nota: (p.nota || '').toString(), montoPitz: parseFloat(p.monto_pitz) || 0, montoPitzUsd: parseFloat(p.monto_pitz_usd) || 0, tc: parseFloat(p.tc) || 0, comprobante: (p.comprobante || '').toString() });
const clienteFront = (c: any) => ({ fecha: c.fecha, nombre: (c.nombre || '').toString(), telefono: (c.telefono || '').toString(), tipo: (c.tipo || '').toString(), nota: (c.nota || '').toString(), ultimoAcceso: (c.ultimo_acceso || '').toString() });
const gastoFront = (g: any) => ({ fecha: g.fecha, desc: g.descripcion, monto: g.monto, moneda: g.moneda, categoria: g.categoria, columna: g.columna || '', comprobante: (g.comprobante || '').toString() });
const prodAdmin = (p: any) => ({ id: p.id, nombre: p.nombre || '', stock: parseInt(p.stock) || 0, activo: p.activo !== false, categoria: (p.categoria || 'Varios').toString(), dueno: (p.dueno || '').toString(), moneda: p.moneda === 'U$S' ? 'U$S' : '$', precioMay: p.precio_may, precioMin: parseFloat(p.precio_min) || 0, desc: (p.descripcion || '').toString(), visible: (p.visible_cat || 'Ambos').toString(), imagen: (p.imagen || '').toString(), descBot: (p.desc_bot || '').toString(), costo: parseFloat(p.costo) || 0, nombresPrev: (p.nombres_prev || '').toString(), candyCod: (p.candy_cod || '').toString(), unidadesPorPaquete: Math.max(1, parseInt(p.unidades_por_paquete) || 1), vinculo: (p.vinculo || '').toString(), hashgaja: (p.hashgaja || '').toString(), kosherTipo: (p.kosher_tipo || '').toString(), jalav: (p.jalav || '').toString(), creado: (p.creado || '').toString() });
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
function analitica(rows: any[], dias: number) {
  if (!rows.length) return { vacio: true };
  const pf = (f: string) => { const m = (f || '').toString().match(/(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?/); return m ? { ts: Date.UTC(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)), hora: +(m[4] || 0), dow: new Date(Date.UTC(+m[3], +m[2] - 1, +m[1])).getUTCDay(), dk: m[3] + '-' + m[2] + '-' + m[1], ddmm: m[1] + '/' + m[2] + ' ' + (m[4] || '00') + ':' + (m[5] || '00') } : null; };
  const todas = rows.map((r: any) => ({ r, t: pf(r.fecha) })).filter((x) => x.t);
  const nowT = Date.now(), desdeT = dias > 0 ? nowT - dias * 86400000 : null, prevT = dias > 0 ? nowT - 2 * dias * 86400000 : null;
  const filas = desdeT ? todas.filter((x) => x.t!.ts >= desdeT) : todas;
  const resumen: any = { visitas: 0, unicos: 0, nuevos: 0, recurrentes: 0, tienda: 0, mayorista: 0 };
  const porOrigen: any = {}, porDispositivo: any = {}, porCiudad: any = {}, porPais: any = {}, porHora = new Array(24).fill(0), porDia: any = {}, porDiaSemana = new Array(7).fill(0);
  const prodDeseados: any = {}, origenVisitaVids: any = {}, origenPedidoVids: any = {};
  const embudoVids: any = { visita: {}, carrito: {}, checkout: {}, pedido: {} };
  const vids: any = {}, carritosPorVid: any = {};
  filas.forEach(({ r, t }) => {
    const vid = r.vid, pagina = r.pagina, evento = r.evento, origen = r.origen, disp = r.dispositivo, ciudad = r.ciudad, pais = r.pais, nombre = r.nombre, tel = r.telefono;
    const detalle = (r.detalle || '').toString(), cartJson = (r.carrito || '').toString(), totalEv = (r.total || '').toString();
    if (vid && (evento === 'carrito' || evento === 'checkout' || evento === 'pedido')) {
      if (!carritosPorVid[vid]) carritosPorVid[vid] = { productos: {}, ultimaCarrito: null, ultimoPedido: null, etapa: 'carrito', items: null, total: 0, itemsTs: null, ddmm: '' };
      const c = carritosPorVid[vid];
      if (cartJson && (!c.itemsTs || t!.ts >= c.itemsTs)) { try { const arr = JSON.parse(cartJson); if (Array.isArray(arr) && arr.length) { c.items = arr; c.total = parseInt(totalEv) || 0; c.itemsTs = t!.ts; } } catch { /**/ } }
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
      porHora[t!.hora]++; porDiaSemana[t!.dow]++; porDia[t!.dk] = (porDia[t!.dk] || 0) + 1;
    }
    if (embudoVids[evento] && vid) embudoVids[evento][vid] = 1;
    if (vid) {
      if (!vids[vid]) vids[vid] = { visitas: 0, fechas: {}, nombre: '', telefono: '', ciudad: '', origen, pagina, primera: t!.ts, ultima: t!.ts };
      const o = vids[vid];
      if (evento === 'visita') o.visitas++;
      o.fechas[t!.dk] = 1;
      if (nombre && !o.nombre) o.nombre = nombre;
      if (tel && !o.telefono) o.telefono = tel;
      if (ciudad && !o.ciudad) o.ciudad = ciudad;
      if (t!.ts < o.primera) o.primera = t!.ts; if (t!.ts > o.ultima) o.ultima = t!.ts;
    }
  });
  const listaVids = Object.keys(vids); resumen.unicos = listaVids.length;
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
  const abandonados = Object.keys(carritosPorVid).filter((v) => { const c = carritosPorVid[v]; return c.ultimaCarrito && (!c.ultimoPedido || c.ultimoPedido < c.ultimaCarrito); }).map((v) => { const c = carritosPorVid[v]; const info = vids[v] || {}; return { nombre: info.nombre || '', telefono: info.telefono || '', ciudad: info.ciudad || '', etapa: c.etapa, productos: Object.keys(c.productos).slice(0, 6), items: c.items || null, total: c.total || 0, cuando: c.ddmm, ts: c.ultimaCarrito }; }).sort((a, b) => b.ts - a.ts).slice(0, 30);
  return { resumen, porOrigen, porDispositivo, topCiudades, topPaises, porHora, porDiaSemana, dias30, embudo, leads, abandonados, topProductos, conversionPorOrigen, comparativa };
}

// ── Infra ───────────────────────────────────────────────────────────────────────
async function sesionValida(token: string): Promise<boolean> {
  if (!token) return false;
  try { const r = await fetch(SB_URL + '/auth/v1/user', { headers: { Authorization: 'Bearer ' + token, apikey: ANON } }); return r.ok; } catch { return false; }
}
async function sbGet(tabla: string, query: string) {
  const r = await fetch(SB_URL + '/rest/v1/' + tabla + '?' + query, { headers: { apikey: SERVICE, Authorization: 'Bearer ' + SERVICE } });
  if (!r.ok) throw new Error(tabla + ' ' + r.status);
  return r.json();
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
async function setConfig(clave: string, valor: string) {
  await fetch(SB_URL + '/rest/v1/config?on_conflict=clave', { method: 'POST', headers: { apikey: SERVICE, Authorization: 'Bearer ' + SERVICE, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ clave, valor }) });
}
// Fecha 'dd/MM/yyyy HH:mm' en zona Argentina (igual formato que el motor viejo).
function fechaAhora() {
  const p: any = {};
  new Intl.DateTimeFormat('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date()).forEach((x) => p[x.type] = x.value);
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`;
}
const P = (o: any, k: string) => (o[k] == null ? '' : o[k]).toString();
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
  const pr = await sbGet('productos', 'select=stock,nombre,candy_cod&id=eq.' + encodeURIComponent(pid));
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
  const antes = parseInt(pr[0].stock) || 0, despues = antes + delta;
  await sbPatch('productos', 'id=eq.' + encodeURIComponent(pid), { stock: despues });
  await sbInsert('movimientos_stock', { fecha: fechaAhora(), id_prod: pid, producto: nombre, cambio: delta, antes, despues, origen: motivo });
  return { antes, despues, compartido: false, nombre };
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

// Llamada cruda a la API de Anthropic (mismo payload que el motor viejo).
async function anthropicMsg(apiKey: string, payload: any): Promise<{ code: number; body: any; texto: string }> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
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
  }).map((p: any) => ({ id: p.id.toString(), nombre: (p.nombre || '').toString(), desc: (p.descripcion || '').toString(), precioMin: parseFloat(p.precio_min) || 0, stock: parseInt(p.stock) || 0, categoria: (p.categoria || 'Varios').toString(), dueno: (p.dueno || 'Miri').toString(), moneda: ((p.moneda || '$').toString() === 'U$S') ? 'U$S' : '$', descBot: (p.desc_bot || '').toString() }));
}
function botCategorias(prods: any[]) {
  const orden = ['Pitzujim', 'Chocolate', 'Caramelo', 'Chupetín', 'Pastilla', 'Yumi', 'Varios'];
  const cats: string[] = [];
  prods.forEach((p) => { if (cats.indexOf(p.categoria) === -1) cats.push(p.categoria); });
  cats.sort((a, b) => { const ia = orden.indexOf(a), ib = orden.indexOf(b); return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib); });
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
  const items = prods.filter((p) => p.categoria === cat);
  if (!items.length) return 'No hay productos en esa categoria ahora. Mandá LISTA.';
  let s = cat.toUpperCase() + ':\n\n';
  items.forEach((p) => { s += p.id + '- ' + p.nombre + (p.desc ? ' ' + botCorto(p.desc, 20) : '') + '  ' + botMoney(p.precioMin) + '\n'; });
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
  return '✓ ' + s.carrito[codigo] + 'x ' + botNombreItem(p) + ' = ' + botMoney(p.precioMin * s.carrito[codigo]) + '\n\nSegui pidiendo, VER tu pedido, o LISTO para cerrar.';
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
    const sub = p.precioMin * carrito[id]; total += sub;
    s += carrito[id] + 'x ' + botNombreItem(p) + ' = ' + botMoney(sub) + '\n';
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
    const qty = carrito[id], sub = p.precioMin * qty;
    total += sub;
    lineas.push('• ' + qty + 'x ' + p.nombre + (p.desc ? ' · ' + p.desc : '') + ' — $ ' + botMiles(p.precioMin) + ' c/u = $ ' + botMiles(sub));
    suArr.push(id + ':' + qty);
    if (p.dueno === 'Jony') jonyArr.push(id + ':' + qty + ':' + p.precioMin);
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
  const cat = prods.map((p) => p.id + ' | ' + p.nombre + (p.desc ? ' ' + p.desc : '') + ' | ' + Math.round(p.precioMin) + ' pesos | stock ' + p.stock + (p.descBot ? ' | DESC: ' + p.descBot : '')).join('\n');
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
      const sub = p.precioMin * s.carrito[id]; total += sub;
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
    const sub = p.precioMin * qty;
    total += sub;
    lineas.push('• ' + qty + 'x ' + p.nombre + (p.desc ? ' · ' + p.desc : '') + ' — $ ' + botMiles(p.precioMin) + ' c/u = $ ' + botMiles(sub));
    suArr.push(id + ':' + qty);
    if (p.dueno === 'Jony') jonyArr.push(id + ':' + qty + ':' + p.precioMin);
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
const TABLAS_BACKUP = ['productos', 'ventas', 'pagos', 'clientes', 'movs_socios', 'envios', 'liquidacion_socios', 'cortes', 'gastos', 'rendiciones', 'notificaciones', 'movimientos_stock', 'ganancias_jony', 'costos_jony', 'visitas', 'trafico', 'avisos_candy', 'shuk_en_candy', 'borrados', 'config', 'candy_productos', 'candy_ventas', 'candy_cc', 'candy_consumo', 'candy_deposito', 'candy_compras', 'candy_proveedores', 'candy_pedidos', 'candy_deudores', 'stock_diario', 'cierres_hijos', 'bandeja_fotos', 'flyers_hijos', 'bot_sesiones', 'sms_log'];
async function backupAhora(etiqueta: string) {
  const dump: any = {}; let filas = 0;
  for (const t of TABLAS_BACKUP) {
    try { dump[t] = await sbGet(t, 'select=*&limit=100000'); filas += dump[t].length; } catch (e) { dump[t] = { error: String(e) }; }
  }
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
  //    Sin token (el gateway no sabe de sesiones); protección = SIM configurada + modo captura.
  if (body && body.event === 'sms:received' && body.payload) {
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
  const PUBLICAS = ['getEstadoTienda', 'venta', 'track', 'visitas', 'notificacion', 'registrarClienteMayorista', 'notificarPedido', 'getCatalogoHijos', 'getConfigCandy', 'registrarPedidoHijo', 'avisarmeCandy', 'getCatalogoVip', 'geoGate'];
  // ── Acciones que también acepta el bot/worker/cron con el secreto compartido (espejo del motor viejo).
  const CON_SECRET = ['botMsg', 'botVoz', 'pedidoVoz', 'tts', 'transcribirIdea', 'borrarVentas', 'preguntarIA', 'movimientosStock', 'auditoriaStock', 'leerStockRaw', 'backupAhora', 'cronHorario', 'cierreDiario'];
  const conSecreto = !!BOT_SECRET && Q('secret') === BOT_SECRET && CON_SECRET.indexOf(accion) !== -1;
  // OJO: el texto debe ser EXACTAMENTE 'no autorizado' — candyshop.html compara con === para
  //  auto-renovar el token vencido (index.html usa indexOf, le sirve igual). Bug #15 del playón.
  if (PUBLICAS.indexOf(accion) === -1 && !conSecreto && !(await sesionValida(token))) return json({ error: 'no autorizado' });

  try {
    // ═══ TIENDA PÚBLICA (sin login) ═══════════════════════════════════════════
    if (accion === 'venta') {
      // Anti pedidos falsos: límite por dispositivo (vid) — 90s entre pedidos, máx 4/hora.
      // (El motor viejo usaba CacheService; acá se mira el timestamp 'creado' de las ventas del vid.)
      const vidVenta = Q('vid');
      if (vidVenta) {
        const desde = new Date(Date.now() - 3600000).toISOString();
        const recientes = await sbGet('ventas', 'select=creado&vid=eq.' + encodeURIComponent(vidVenta) + '&creado=gte.' + encodeURIComponent(desde) + '&order=creado.desc');
        if (recientes.length >= 4) return json({ error: 'rate' });
        if (recientes.length && Date.now() - new Date(recientes[0].creado).getTime() < 90000) return json({ error: 'rate' });
      }
      const esCotizacion = Q('cotizacion') === '1';
      const stockUpdates = Q('stockUpdates');
      const cliente = Q('cliente');
      // 🛡️ Anti-DUPLICADO servidor (caso real #57/#58 isi michan 12/07/2026: mismo carrito
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
      if (stockUpdates && !esCotizacion) {
        const idsChk = stockUpdates.split(',').map((u: string) => (u.split(':')[0] || '').trim()).filter((x: string) => /^\d+$/.test(x));
        if (idsChk.length) {
          const stRows = await sbGet('productos', 'select=id,nombre,stock&id=in.(' + idsChk.join(',') + ')');
          const stMap: any = {}; stRows.forEach((r: any) => { stMap[String(r.id)] = r; });
          const faltan: string[] = [];
          const faltanItems: any[] = [];   // estructurado: la tienda auto-ajusta el carrito con esto
          for (const u of stockUpdates.split(',')) {
            const pp = u.split(':'); const pid = (pp[0] || '').trim(), qty = parseInt(pp[1]) || 0;
            if (!pid || qty <= 0) continue;
            const st = stMap[pid]; const disp = st ? (parseInt(st.stock) || 0) : 0;
            if (disp < qty) {
              faltan.push('De "' + (st ? st.nombre : '#' + pid) + '" queda' + (disp === 1 ? '' : 'n') + ' ' + Math.max(0, disp) + ' y pediste ' + qty);
              faltanItems.push({ id: pid, nombre: st ? st.nombre : '#' + pid, pedido: qty, hay: Math.max(0, disp) });
            }
          }
          if (faltan.length) return json({ error: 'stock', detalle: faltan.join(' · '), items: faltanItems });
        }
      }
      const fila: any = { fecha: fechaAhora(), cliente, tipo: Q('tipo'), productos: Q('productos'), forma_pago: Q('formaPago'), notas: Q('notas'), estado: esCotizacion ? 'cotizacion' : 'pendiente', total_ars: QN('totalARS'), total_usd: QN('totalUSD'), ars_jony: QN('arsJONY'), ars_myri: QN('arsMyri'), usd_myri: QN('usdMyri'), comi_ars: QN('comiARS'), comi_usd: QN('comiUSD'), caja_jony: '', caja_myri: '', tipo_cambio: 0, stock_updates: stockUpdates, usd_jony: QN('usdJONY'), vid: vidVenta };
      // Numeración atómica: índice ÚNICO en n_venta + reintento (la versión SQL del LockService del
      // motor viejo — dos pedidos simultáneos NUNCA toman el mismo número).
      const ins = await insertarVentaAtomica(fila);
      if ('error' in ins) return json({ error: ins.error });
      const nVenta = ins.nVenta;
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
      await altaClienteAuto(cliente, Q('tipo'));
      // 🔔 Notificación WhatsApp DESDE EL SERVIDOR (caso KI TOV 13/07: la disparaba el navegador
      // del cliente después de enviar — si cerraba la pestaña, moría y el pedido entraba mudo).
      // Truncada a 1500 (Twilio rebota >1600, error 21617 — caso Fabio 13/07).
      if (!esCotizacion) {
        try {
          let resu = (Q('productos') || '').split(' || ').join('\n');
          const totNP: string[] = [];
          if (QN('totalARS') > 0) totNP.push('$ ' + Math.round(QN('totalARS')).toLocaleString('es-AR'));
          if (QN('totalUSD') > 0) totNP.push('U$S ' + QN('totalUSD').toFixed(2));
          let cuerpoV = '🛍️ *Nuevo pedido #' + nVenta + ' - Shuk Mamtakim*\n\n👤 *' + cliente + '* (' + Q('tipo') + ')\n\n' + resu + (totNP.length ? '\n\n*Total:* ' + totNP.join(' + ') : '');
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
      if (!items.length) return json({ error: 'sin items' });
      const hijo = Q('hijo'), cliente = await clienteCanonicoCandy(Q('cliente'));   // 🧑 grafía única (el pedido nace con el nombre ya conocido)
      if (!hijo || !cliente) return json({ error: 'falta hijo o cliente' });
      const total = QN('total') || items.reduce((s, it) => s + (parseFloat(it.subtotal) || 0), 0);
      // Anti pedidos falsos (paridad con la tienda Shuk): límite por dispositivo (vid) —
      // 90s entre pedidos, máx 4/hora. El WhatsApp igual se abre (el chico recibe el mensaje).
      const vidPH = Q('vid');
      // 🚫 Dispositivo bloqueado (pedidos truchos 13/07: amigos de los chicos jugando)
      if (vidPH && (await getConfig('VIDBLOCK_' + vidPH, '')) === '1') return json({ error: 'rate' });
      if (vidPH) {
        const desdePH = new Date(Date.now() - 3600000).toISOString();
        const recPH = await sbGet('candy_pedidos', 'select=creado&vid=eq.' + encodeURIComponent(vidPH) + '&creado=gte.' + encodeURIComponent(desdePH) + '&order=creado.desc');
        if (recPH.length >= 4) return json({ error: 'rate' });
        if (recPH.length && Date.now() - new Date(recPH[0].creado).getTime() < 90000) return json({ error: 'rate' });
      }
      // 📱 Teléfono obligatorio (anti-truchos 13/07): sin WhatsApp válido no hay pedido
      const telPH = Q('telefono');
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
      const pedidoId = Q('pedidoId') || 'PH' + Date.now();
      // Anti-duplicado (reintento por red caída): pedido_id es UNIQUE → el segundo insert rebota
      // ANTES de reservar stock (equivale al cache de 15 min del motor viejo, pero permanente).
      const r = await fetch(SB_URL + '/rest/v1/candy_pedidos', { method: 'POST', headers: { apikey: SERVICE, Authorization: 'Bearer ' + SERVICE, 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify({ hijo, cliente, telefono: Q('telefono'), items: Q('items') || '[]', total: Math.round(total), estado: 'pendiente', pedido_id: pedidoId, nota: Q('nota'), vid: vidPH }) });
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
      const prodAv = Q('producto'), cliAv = Q('cliente'), telAv = Q('telefono');
      if (telAv && telDudoso(telAv)) return json({ error: 'teléfono inválido' });   // opcional, pero si viene tiene que ser real
      await sbInsert('avisos_candy', { fecha: fechaAhora(), hijo: Q('hijo'), codigo: Q('codigo'), producto: prodAv, cliente: cliAv, telefono: telAv, estado: 'pendiente' });
      const waTo = Q('wa');
      if (waTo) await sendTwilioWA(waTo, `🔔 *Candy Shop* — te piden un producto agotado\n\n🍬 ${prodAv}\n👤 ${cliAv || 'cliente'}${telAv ? ' · ' + telAv : ''}\n\nCuando lo tengas, avisale 😉`);
      return json({ ok: true });
    }
    if (accion === 'track') {
      await sbInsert('trafico', { fecha: fechaAhora(), vid: Q('vid'), pagina: Q('pagina') || 'tienda', evento: Q('evento') || 'visita', origen: Q('origen') || 'directo', dispositivo: Q('dispositivo'), ciudad: Q('ciudad'), region: Q('region'), pais: Q('pais'), nombre: Q('nombre'), telefono: Q('telefono'), detalle: Q('producto'), carrito: Q('carrito'), total: QN('total') });
      // Compatibilidad con el contador simple de visitas existente.
      if ((Q('evento') || 'visita') === 'visita') await sbInsert('visitas', { fecha: fechaAhora(), pagina: Q('pagina') || 'tienda' });
      return json({ ok: true });
    }
    if (accion === 'visitas') return json((await sbGet('visitas', 'select=fecha,pagina&order=id&limit=200000')).map((r: any) => ({ fecha: (r.fecha || '').toString(), pagina: (r.pagina || '').toString() })));
    if (accion === 'registrarClienteMayorista') {
      const telM = Q('telefono').replace(/\D/g, '').slice(-10);
      const nomM = Q('nombre');
      if (!telM || !nomM) return json({ error: 'datos incompletos' });
      const todosC = await sbGet('clientes', 'select=id,nombre,telefono');
      const exC = todosC.find((c: any) => (c.telefono || '').toString().replace(/\D/g, '').slice(-10) === telM);
      if (exC) { await sbPatch('clientes', 'id=eq.' + exC.id, { ultimo_acceso: fechaAhora() }); return json({ ok: true, nuevo: false, nombre: (exC.nombre || nomM).toString() }); }
      const fM = fechaAhora();
      await sbInsert('clientes', { fecha: fM, nombre: nomM, telefono: telM, tipo: Q('tipo') || 'Mayorista', nota: '', ultimo_acceso: fM });
      return json({ ok: true, nuevo: true });
    }
    if (accion === 'notificarPedido') {
      // Twilio WA corta en 1600 caracteres (error 21617 — caso real: pedido mayorista de Fabio
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
        const pr = await sbGet('productos', 'select=stock,nombre&id=eq.' + encodeURIComponent(pid));
        if (!pr.length) continue;
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
      const pr = await sbGet('productos', 'select=stock,nombre,nombres_prev&id=eq.' + encodeURIComponent(id));
      if (!pr.length) return json({ error: 'producto no encontrado' });
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
      if (body.vinculo !== undefined) patch.vinculo = PV('vinculo');   // gemelos: mismo producto con stock de los dos dueños ('' / '__VACIO__' = desvincular)
      if (has('stock')) { const antes = parseInt(pr[0].stock) || 0, nsx = parseInt(P(body, 'stock')) || 0; patch.stock = nsx; if (nsx !== antes) await sbInsert('movimientos_stock', { fecha: fechaAhora(), id_prod: id, producto: pr[0].nombre, cambio: nsx - antes, antes, despues: nsx, origen: 'Edición manual (editor de producto)' }); }
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
        const pr = await sbGet('productos', 'select=stock,nombre,nombres_prev&id=eq.' + encodeURIComponent(id));
        if (!pr.length) continue;
        const patch: any = {};
        Object.keys(c).forEach((k) => {
          if (k === 'id') return;
          const v = (c[k] === null || c[k] === undefined) ? '' : c[k].toString();
          if (k === 'stock') { patch.stock = parseInt(v) || 0; return; }
          if (k === 'nombre') { const actual = (pr[0].nombre || '').trim(), nuevo = (v === '__VACIO__' ? '' : v).trim(); if (nuevo && actual && nuevo !== actual) { const prev = (pr[0].nombres_prev || '').toString(); const lista = prev ? prev.split('|').map((s: string) => s.trim()).filter(Boolean) : []; if (lista.indexOf(actual) === -1) lista.push(actual); patch.nombres_prev = lista.join(' | '); } if (nuevo) patch.nombre = nuevo; return; }
          if (k === 'precioMay') { patch.precio_may = parseFloat(v.replace(',', '.')) || 0; return; }
          if (k === 'precioMin') { patch.precio_min = parseFloat(v.replace(',', '.')) || 0; return; }
          if (k === 'costo') { patch.costo = parseFloat(v.replace(',', '.')) || 0; return; }
          if (k === 'visible') { patch.visible_cat = v; patch.visible = v !== 'No'; return; }
          if (k === 'unidadesPorPaquete') { patch.unidades_por_paquete = Math.max(1, parseInt(v) || 1); return; }
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
      const ex = await sbGet('productos', 'select=nombre,stock&id=eq.' + encodeURIComponent(P(body, 'id')));
      if (!ex.length) return json({ error: 'no encontrado' });
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
      await sbInsert('productos', { id: nid, nombre: P(body, 'nombre'), descripcion: P(body, 'desc'), precio_may: parseFloat((P(body, 'pMay') || '').replace(',', '.')) || null, precio_min: parseFloat((P(body, 'pMin') || '').replace(',', '.')) || 0, stock: stockIni, imagen: P(body, 'imagen'), activo: true, categoria: P(body, 'categoria') || 'Varios', visible: P(body, 'visible') !== 'No', visible_cat: has('visible') ? P(body, 'visible') : 'Ambos', dueno: P(body, 'dueno') || 'Miri', desc_bot: P(body, 'descBot'), moneda: P(body, 'moneda') === 'U$S' ? 'U$S' : '$', costo: parseFloat((P(body, 'costo') || '').replace(',', '.')) || null, unidades_por_paquete: Math.max(1, parseInt(P(body, 'unidadesPorPaquete')) || 1), hashgaja: P(body, 'hashgaja'), kosher_tipo: P(body, 'kosherTipo'), jalav: P(body, 'jalav') });
      if (stockIni > 0) await sbInsert('movimientos_stock', { fecha: fechaAhora(), id_prod: nid, producto: P(body, 'nombre'), cambio: stockIni, antes: 0, despues: stockIni, origen: 'Alta de producto' });
      return json({ ok: true, id: nid });
    }
    // ── ESCRITURAS (POST) ─────────────────────────────────────────────────────
    if (accion === 'registrarPagoCuenta') {
      if (N(body, 'montoARS') === 0 && N(body, 'montoUSD') === 0) return json({ error: 'monto vacío' });
      // ⚖️ AUTO-REPARTO (2026-07-07, pedido del usuario tras el caso Isi/Dany/KI TOV/Moshe/Yair):
      // "cuando el cliente paga, paga, ya está" — el sistema separa SOLO qué parte del pago es
      // Pitzujim (de Jony) y qué parte golosinas (de Miri), contra la deuda viva FIFO del
      // cliente, con EXACTAMENTE el mismo orden que usan la ganancia (coberturaPagos) y la
      // cuenta entre socios: en $ Pitzujim primero, en U$S golosinas primero. El reparto queda
      // GUARDADO en el pago (monto_pitz / monto_pitz_usd) → caja, cuenta corriente y vista
      // Miri leen todos lo mismo. Si el front mandó montoPitz explícito (>0), se respeta.
      const { pitzARS, pitzUSD } = await calcularRepartoPitz(P(body, 'cliente'), P(body, 'pedidoId'), N(body, 'montoARS'), N(body, 'montoUSD'), N(body, 'montoPitz'));
      // 📅 v3.95: si el modal manda la fecha real del pago, ESA va (si no, "ahora")
      const fechaPagoElegida = P(body, 'fecha').trim();
      const fechaPago = /^\d{2}\/\d{2}\/\d{4}( \d{2}:\d{2})?$/.test(fechaPagoElegida) ? fechaPagoElegida : fechaAhora();
      await sbInsert('pagos', { fecha: fechaPago, cliente: P(body, 'cliente'), pedido_id: P(body, 'pedidoId'), monto_ars: N(body, 'montoARS'), monto_usd: N(body, 'montoUSD'), monto_pitz: pitzARS, monto_pitz_usd: pitzUSD, caja: P(body, 'caja'), tc: N(body, 'tipoCambio'), nota: P(body, 'nota') || 'Pago a cuenta', comprobante: P(body, 'comprobante') });
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
      const rep = await calcularRepartoPitz((pgE.cliente || '').toString(), (pgE.pedido_id || '').toString(), mA, mU, 0, pidE);
      await sbPatch('pagos', 'id=eq.' + encodeURIComponent(pidE), { monto_ars: mA, monto_usd: mU, monto_pitz: rep.pitzARS, monto_pitz_usd: rep.pitzUSD, caja: P(body, 'caja'), fecha: fFinal, tc: N(body, 'tipoCambio') });
      return json({ ok: true, reparto: rep });
    }
    // 🗑️ ANULAR un pago a cuenta (v3.96): lo borra; la deuda del cliente vuelve a subir y la
    // caja se ajusta solas (todo deriva de la tabla pagos). Sin materializado que reparar.
    if (accion === 'anularPagoCuenta') {
      if (!(await sesionValida(token))) return json({ error: 'sin permiso' });
      await sbDelete('pagos', 'id=eq.' + encodeURIComponent(P(body, 'pagoId')));
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
      // ⚖️ RECONCILIACIÓN COBRO vs TOTAL (caso #46 Mati Allami): editar un pedido YA COBRADO
      // agregándole productos no puede "cobrarse solo" — lo cubierto real son los tramos, y el
      // faltante queda como tramo Cta Cte → la tarjeta muestra "cobro parcial · debe X", entra
      // a la cuenta corriente y las cajas no se inflan. Se compara POR MONEDA contra el total
      // (no por balde: una redistribución Jony↔Miri del mismo total no genera deuda fantasma).
      // Solo corre si la edición mandó totales (el corrector de splits viejos no los manda).
      let deudaNueva: any = null;
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
            // toca (un sobrecobro se resuelve a mano con el cliente).
            for (const t of tram) {
              if (diff >= -eps) break;
              if (!deCur(t) || !String(t.caja || '').startsWith('CTA_CTE')) continue;
              const m = parseFloat(t.monto) || 0;
              const quita = Math.min(m, -diff);
              t.monto = rnd(m - quita); diff = rnd(diff + quita);
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
      return json({ ok: true, deudaNueva });
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
    if (accion === 'notificacion') {
      const pid = P(body, 'productoId'), tel = P(body, 'telefono');
      if (telDudoso(tel)) return json({ error: 'Ese número no parece un WhatsApp válido — poné código de área + número' });
      const ex = await sbGet('notificaciones', 'select=id&producto_id=eq.' + encodeURIComponent(pid) + '&telefono=eq.' + encodeURIComponent(tel) + '&estado=eq.pendiente');
      if (ex.length) return json({ ok: true, duplicado: true });
      await sbInsert('notificaciones', { fecha: fechaAhora(), producto_id: pid, producto: P(body, 'producto'), nombre: P(body, 'nombre'), telefono: tel, estado: 'pendiente', modo: P(body, 'modoCliente') || 'mayorista' });
      return json({ ok: true });
    }
    if (accion === 'marcarNotificado') { await sbPatch('notificaciones', 'producto_id=eq.' + encodeURIComponent(P(body, 'productoId')) + '&telefono=eq.' + encodeURIComponent(P(body, 'telefono')) + '&estado=eq.pendiente', { estado: 'notificado' }); return json({ ok: true }); }
    if (accion === 'marcarComprado') { await sbPatch('notificaciones', 'producto_id=eq.' + encodeURIComponent(P(body, 'productoId')) + '&telefono=eq.' + encodeURIComponent(P(body, 'telefono')), { estado: 'comprado' }); return json({ ok: true }); }
    if (accion === 'eliminarNotificacion') { await sbDelete('notificaciones', 'producto_id=eq.' + encodeURIComponent(P(body, 'productoId')) + '&telefono=eq.' + encodeURIComponent(P(body, 'telefono'))); return json({ ok: true }); }
    if (accion === 'hacerCorte') {
      // Liquida la ganancia cobrada del período: calcula el Maaser, marca esas ventas con el corteId
      // (para que el período vuelva a 0) y registra el corte.
      const [ventas, productos, pagos, msC] = await Promise.all([sbGet('ventas', 'select=*&order=n_venta'), sbGet('productos', 'select=id,nombre,dueno,moneda,costo,descripcion,nombres_prev'), sbGet('pagos', 'select=*&order=id'), msUltimoCorte()]);
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

    if (accion === 'getGanancias') {
      const [ventas, productos, pagos, msC] = await Promise.all([sbGet('ventas', 'select=*&order=n_venta'), sbGet('productos', 'select=id,nombre,dueno,moneda,costo,descripcion,nombres_prev'), sbGet('pagos', 'select=*&order=id'), msUltimoCorte()]);
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
    if (accion === 'getAnalitica') { const dias = parseInt(url.searchParams.get('dias') || '0') || 0; return json(analitica(await sbGet('trafico', 'select=*&order=id&limit=200000'), dias)); }
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
    if (accion === 'getEstadoTienda') return json({ estado: await getConfig('TIENDA_ESTADO', 'abierta'), mensaje: await getConfig('TIENDA_MSG', '') });
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
    if (accion === 'getProductosShukAdmin' || accion === 'getProductosAdmin') return json((await sbGet('productos', 'select=*&order=nombre')).map(prodAdmin));
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
      await setConfig('ANTHROPIC_API_KEY', clave);
      return json({ ok: true });
    }
    if (accion === 'analizarFotoProducto') return json(await analizarFotoProducto(Q('url')));
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
      await fetch('https://api.onesignal.com/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Key os_v2_app_bzffawgxufafxbwjq2xeffakwte3mjhkcfje2qevxjorgj4osj3vac6be2h2xriszbv7b7okaqv6ug4v6e4omyx6p6u74imuvhszyei' },
        body: JSON.stringify({ app_id: '0e4a5058-d7a1-405b-86c9-86ae42940ab4', included_segments: ['All'], headings: { es: titulo, en: titulo }, contents: { es: mensaje, en: mensaje }, url: 'https://shuk-mamtakim.vercel.app/' }),
      });
      return json({ ok: true });
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
        'Además escribís el prompt (en inglés) para generar el FONDO del flyer con un modelo de imágenes: ' +
        'tiene que ser detallado y profesional — estilo visual concreto (ej: vibrant candy-pop 3D render, soft gradient studio backdrop, ' +
        'playful flat illustration), motivos inspirados en los productos (vapor de sopa, trozos de chocolate, caramelos flotando), ' +
        'composición con un centro despejado para superponer tarjetas de productos, iluminación y paleta. ' +
        'PROHIBIDO en el prompt: texto, letras, números, logos, marcas, personas, packaging legible. ' +
        'También elegís una paleta de 3 colores en hex que combine con ese fondo: dos para un degradé oscuro-medio ' +
        '(con buen contraste para texto blanco encima) y un acento vibrante claro (para pills con texto oscuro).';
      const userF = 'Productos del flyer: ' + productosF + '\n' +
        (ocasionF ? 'Ocasión/tema del flyer: ' + ocasionF + '\n' : '') +
        (ideaF ? 'Idea/texto que escribió ' + hijoF + ' (mejorala manteniendo su espíritu): "' + ideaF + '"' : 'No dejó texto: inventá algo corto y tentador.') +
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
        const rW = await fetch(WORKER_RELAY_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ relay: true, secret: BOT_SECRET, dest: Q('hijo').toLowerCase(), text: '🎨 ¡Tu flyer está listo! Reenvialo a tus contactos o subilo a tu estado.', mediaUrl: Q('url') }) });
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
      itemsR = itemsR.filter((it) => it && it.id && (parseFloat(it.cantidad) || 0) > 0);
      if (!itemsR.length) return json({ error: 'sin items' });
      const compraId = P(body, 'compraId') || 'RC' + Date.now();
      const kR = 'rc_' + compraId;
      const exR = await sbGet('config', 'select=clave&clave=eq.' + encodeURIComponent(kR));
      if (exR.length) return json({ ok: true, dup: true, compraId });
      await setConfig(kR, fechaAhora());
      const resumen: any[] = [];
      for (const it of itemsR) {
        const pid = String(it.id);
        const cant = parseFloat(it.cantidad) || 0;
        const costoU = parseFloat(it.costoUnit) || 0;
        const pr = await sbGet('productos', 'select=nombre,costo,moneda,dueno&id=eq.' + encodeURIComponent(pid));
        if (!pr.length) { resumen.push({ id: pid, error: 'no existe' }); continue; }
        const p = pr[0];
        const mv = await moverStockShuk(pid, cant, '📥 Recepción — compra ' + compraId);
        const antes = mv ? mv.antes : 0;
        const costoAnt = parseFloat(p.costo) || 0;
        let costoNuevo = costoU;
        if (antes > 0 && costoAnt > 0 && costoU > 0) costoNuevo = Math.round(((antes * costoAnt + cant * costoU) / (antes + cant)) * 100) / 100;
        if (costoU > 0) await sbPatch('productos', 'id=eq.' + encodeURIComponent(pid), { costo: costoNuevo });
        await sbInsert('recepciones', { fecha: fechaAhora(), compra_id: compraId, producto_id: pid, producto: p.nombre, cantidad: cant, costo_unit: costoU, costo_anterior: costoAnt || null, costo_nuevo: costoU > 0 ? costoNuevo : null, stock_antes: antes, stock_despues: mv ? mv.despues : antes + cant, moneda: (p.moneda || '$').toString(), dueno: (p.dueno || '').toString() });
        // Compat: las compras de productos de Jony también quedan en su log histórico (costos_jony).
        if ((p.dueno || '') === 'Jony' && costoU > 0) await sbInsert('costos_jony', { fecha: fechaAhora(), producto_id: pid, producto: p.nombre, cantidad: cant, costo_total: Math.round(cant * costoU * 100) / 100, costo_unitario: costoU });
        resumen.push({ id: pid, nombre: p.nombre, stock: (mv ? mv.despues : null), costoAnterior: costoAnt, costoNuevo: costoU > 0 ? costoNuevo : costoAnt });
      }
      return json({ ok: true, compraId, items: resumen });
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
      return json({ ok: true, backup: rBk, cierre: rCierre, bandeja: rBand });
    }
    return json({ error: 'acción no soportada aún: ' + accion });
  } catch (e) {
    return json({ error: String(e) });
  }
});
