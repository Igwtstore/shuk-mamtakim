// 💰 v4.99 — EL TOTAL LO CALCULA EL MOTOR. La tienda y el motor tienen que dar EXACTAMENTE lo mismo en un pedido
// honesto (si no, el motor "corregiría" pedidos buenos). Corre el código REAL de los dos lados: la cuenta de la tienda
// (_cuentaPedido + precioEfectivo + el mapeo del catálogo + el descuento del link VIP + enviarVentaASheet, que arma
// lo que viaja) contra calcularPedidoTienda / totalNoCierra del motor, en cientos de pedidos al azar (ofertas, packs,
// fechas, VIP general y por producto, pesos y dólares, Jony y Miri, mayorista y minorista). Más los ataques, el
// freno de pedidos falsos y la huella de la conexión.
const fs = require('fs');
const path = require('path');
const { suite } = require('./_helpers');
const HTML = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
const TS = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'functions', 'api', 'index.ts'), 'utf8');

// ── extractores (el mismo criterio que las otras pruebas: el texto real de producción) ──
function fnDe(src, nombre, prefijo = 'function') {
  const m = src.match(new RegExp('(?:async\\s+)?' + prefijo + '\\s+' + nombre + '\\s*\\('));
  if (!m) throw new Error('no encontré ' + nombre);
  let i = m.index + m[0].length, depth = 1;
  while (depth > 0) { const c = src[i++]; if (c === '(') depth++; else if (c === ')') depth--; }
  i = src.indexOf('{', i) + 1; depth = 1;
  while (i < src.length && depth > 0) { const c = src[i]; if (c === '{') depth++; else if (c === '}') depth--; i++; }
  return src.slice(m.index, i);
}
function constDe(src, nombre) {
  const ini = src.indexOf('const ' + nombre + ' = ');
  if (ini === -1) throw new Error('no encontré ' + nombre);
  let depth = 0, q = '';
  for (let i = ini; i < src.length; i++) {
    const c = src[i];
    if (q) { if (c === '\\') { i++; continue; } if (c === q) q = ''; continue; }
    if (c === "'" || c === '"' || c === '`') { q = c; continue; }
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    else if (c === ';' && depth === 0) return src.slice(ini, i + 1) + '\n';
  }
}
function parenDesde(src, marca) {   // devuelve el texto balanceado que empieza en el "(" que sigue a `marca`
  const i0 = src.indexOf(marca); if (i0 === -1) throw new Error('no encontré ' + marca);
  let i = src.indexOf('(', i0 + marca.length - 1), depth = 0, j = i;
  for (; j < src.length; j++) { const c = src[j]; if (c === '(') depth++; else if (c === ')') { depth--; if (!depth) break; } }
  return src.slice(i + 1, j);
}
const sinTipos = (code) => code.replace(/\)\s*:\s*Promise<[^>]+>\s*\{/g, ') {').replace(/:\s*(any|string|number|boolean|Request)(\[\])?(?=\s*[,)=;{])/g, '');

// ── LA TIENDA (index.html) ──
const mapeo = parenDesde(HTML, 'productos = data.map(');   // p => ({ …los campos del catálogo… })
const vipIni = HTML.indexOf('const descG = Number(d.desc) || 0'), vipFin = HTML.indexOf('const soloGeneral', vipIni);
if (vipIni === -1 || vipFin === -1) throw new Error('no encontré el descuento del link VIP en _vipCargar');
const TIENDA = new Function(
  'let modo = "minorista", HOY = "2026-09-23", _vipToken = "", _estadoTienda = "abierta", _url = "";\n' +
  'let _armadoToken = "", _armadoInfo = null;   // 🔗 v5.00: sin pedido armado, el envío es el de siempre\n' +
  'const APPS_SCRIPT_URL = "https://motor/api";\n' +
  'const _hoyAR = () => HOY;\n' +
  'const _vid = () => "v_prueba123";\n' +
  'const fetch = (u) => { _url = u; return Promise.resolve({ json: () => ({ ok: true }) }); };\n' +
  constDe(HTML, '_precioDelModo') +
  ['_fechaOfertaISO', 'ofertaActiva', 'packActivo', 'ofertaVigente', 'precioEfectivo', '_acConDesc', '_cuentaPedido', 'enviarVentaASheet'].map(n => fnDe(HTML, n)).join('\n') +
  '\nconst mapear = ' + mapeo + ';\n' +
  'function aplicarVip(d, productos, _vipIds) {\n' + HTML.slice(vipIni, vipFin) + '\n}\n' +
  'return { mapear, aplicarVip, _cuentaPedido, _precioDelModo, enviarVentaASheet,\n' +
  '  set: o => { if ("modo" in o) modo = o.modo; if ("hoy" in o) HOY = o.hoy; if ("vip" in o) _vipToken = o.vip; if ("estado" in o) _estadoTienda = o.estado; },\n' +
  '  url: () => _url };')();

// ── EL MOTOR (index.ts) ──
const MOTOR = new Function(
  'let AHORA = "23/09/2026 14:05";\nconst fechaAhora = () => AHORA;\n' +
  sinTipos(constDe(TS, '_libre') + constDe(TS, '_hoyISO_AR') + fnDe(TS, '_fechaOfertaISO') + '\n' + fnDe(TS, '_conDescVip') + '\n' + fnDe(TS, 'calcularPedidoTienda') + '\n' +
    constDe(TS, '_plataTxt') + constDe(TS, 'PARTES_PEDIDO') + fnDe(TS, 'totalNoCierra')) +
  '\nreturn { _libre, _hoyISO_AR, calcularPedidoTienda, totalNoCierra, PARTES_PEDIDO, _plataTxt, setAhora: a => { AHORA = a; } };')();

// Lo que hace el motor con el pedido que llega (el mismo camino que el bloque de 'venta').
function motorRecibe(params, filasDB, configVip) {
  const Q = k => params.get(k) || '';
  const QN = k => { const n = parseFloat(Q(k)); return isNaN(n) ? 0 : n; };
  const pares = Q('stockUpdates').split(',').map(u => { const pp = u.split(':'); return { id: String(parseInt(pp[0])), qty: parseInt(pp[1]) || 0 }; }).filter(x => x.qty > 0);
  const ids = new Set(pares.map(x => x.id));
  const filas = filasDB.filter(r => ids.has(String(r.id)));
  const vipT = Q('vip').replace(/[^a-z0-9]/gi, '').slice(0, 40);
  const vip = vipT && configVip[vipT] ? JSON.parse(JSON.stringify(configVip[vipT])) : null;
  const cuenta = MOTOR.calcularPedidoTienda(pares, filas, Q('tipo') === 'Mayorista', vip, MOTOR._hoyISO_AR());
  const mandado = {}; MOTOR.PARTES_PEDIDO.forEach(k => { mandado[k] = QN(k); });
  return { cuenta, mandado, noCierra: cuenta ? MOTOR.totalNoCierra(mandado, cuenta) : null, lineasIguales: cuenta ? MOTOR._libre(cuenta.lineas.join(' || '), 20000) === MOTOR._libre(Q('productos'), 20000) : null };
}

// Un pedido completo: la tienda lo arma y lo manda; el motor lo recibe.
function pedido({ filas, modo, vip, vipToken, hoy, carrito, estado }) {
  TIENDA.set({ modo, hoy: hoy || '2026-09-23', vip: vipToken || '', estado: estado || 'abierta' });
  const productos = filas.map(TIENDA.mapear).filter(p => p.activo && p.id);
  if (vip) TIENDA.aplicarVip(vip, productos, new Set(vip.ids.map(String)));
  const items = carrito.map(([id, qty]) => ({ ...productos.find(p => p.id === id), qty }));
  const c = TIENDA._cuentaPedido(items);
  TIENDA.enviarVentaASheet('Cliente Prueba', items, modo === 'mayorista' ? 'Mayorista' : 'Minorista', 'Efectivo', c.totalARS, c.totalUSD, c.arsJONY, c.arsMyri, c.usdMyri, c.comiARS, c.comiUSD, c.lineas, '', c.usdJONY);
  const params = new URL(TIENDA.url()).searchParams;
  return { c, params, productos };
}

// ── generador de catálogos y carritos al azar (con semilla: si algo falla, se puede repetir) ──
let semilla = 20260923;
const azar = () => { semilla = (semilla * 1103515245 + 12345) % 2147483648; return semilla / 2147483648; };
const uno = arr => arr[Math.floor(azar() * arr.length)];
const NOMBRES = ['Klik Caramelo', 'Pitzujim Grill', 'Bamba 80g', 'Carmit "Kadurim"', "D'Angelo Wafer", 'Elite Egozi', 'Osem Bissli · BBQ', 'Tnuva <Leche>', 'Candy Pop'];
const DESCS = ['', '', 'Paquete familiar de 12 unidades, sabor original, importado de Israel', 'Parve', 'Lácteo · con hashgajá Badatz'];
function filaAzar(id) {
  const min = uno([6499, 1250, 999.5, 15000, 3200, '4500', null, 0]);
  const moneda = uno(['$', 'U$S', 'U$S', '', null, ' U$S ']);
  const may = uno([5, 5.5, '5,50', '12.35', 3, 2500, 800.4, '', null, 0, 0.99]);
  const baseMin = parseFloat(min) || 0;
  const oferta = uno([0, 0, null, Math.round(baseMin * 0.8), Math.round(baseMin * 1.2), 1]);
  const fecha = uno(['', '23/09/2026', '22/09/2026', '24/09/2026', '2026-09-23', '2026-09-22', '5/10/2026', 'mañana', null]);
  const cp = uno([0, 0, 2, 6, null, 3]);
  const pp = uno([0, Math.round(baseMin * 0.7), Math.round(baseMin * 1.1), 1, null]);
  return { id, nombre: uno(NOMBRES), descripcion: uno(DESCS), dueno: uno(['Jony', 'Jony', 'Jony', 'Myri', '', ' Jony ']), moneda, precio_min: min, precio_may: may, precio_oferta: oferta, fecha_oferta: fecha, cant_pack: cp, precio_pack: pp, activo: true, stock: 99 };
}
function vipAzar(ids) {
  const elegidos = ids.filter(() => azar() < 0.7);
  const descProd = {};
  elegidos.forEach(id => { if (azar() < 0.4) descProd[String(id)] = uno([10, 15, 0, '', '20', 33.3, 'x']); });
  return { ids: elegidos.map(String), nombre: 'Tomás', canal: uno(['minorista', 'mayorista']), desc: uno([0, 5, 10, 12.5, 33]), descProd: uno([descProd, descProd, {}]) };
}

async function run() {
  const t = suite();

  // 1) PARIDAD: 800 pedidos honestos al azar → el motor NO corrige ninguno y arma los mismos renglones.
  let honestos = 0, malos = [];
  for (let n = 0; n < 800; n++) {
    const filas = Array.from({ length: 1 + Math.floor(azar() * 8) }, (_, i) => filaAzar(100 + i));
    const modo = uno(['minorista', 'mayorista']);
    const conVip = azar() < 0.4, vip = conVip ? vipAzar(filas.map(f => f.id)) : null, vipToken = conVip ? 'k3j2h4g5' : '';
    const hoy = uno(['2026-09-23', '2026-09-22', '2026-09-24']);
    MOTOR.setAhora(hoy.slice(8, 10) + '/' + hoy.slice(5, 7) + '/' + hoy.slice(0, 4) + ' 14:05');
    // La tienda solo deja pedir lo que tiene precio en el modo (y, con link VIP, solo lo del link).
    TIENDA.set({ modo });
    const prods = filas.map(TIENDA.mapear);
    if (vip) TIENDA.aplicarVip(vip, prods, new Set(vip.ids.map(String)));
    const pedibles = prods.filter(p => TIENDA._precioDelModo(p) > 0 && (!vip || vip.ids.includes(String(p.id))));
    if (!pedibles.length) continue;
    const carrito = pedibles.filter(() => azar() < 0.8).map(p => [p.id, uno([1, 1, 2, 3, 6, 7, 12])]);
    if (!carrito.length) continue;
    const { c, params } = pedido({ filas, modo, vip, vipToken, hoy, carrito });
    const r = motorRecibe(params, filas, vipToken ? { [vipToken]: vip } : {});
    honestos++;
    if (!r.cuenta || r.noCierra || !r.lineasIguales || r.cuenta.sinPrecio.length) malos.push({ n, modo, vip, filas, carrito, tienda: c, motor: r.cuenta, mandado: r.mandado });
  }
  t.ok(`paridad: ${honestos} pedidos honestos al azar → el motor no corrige NINGUNO`, honestos > 500 && !malos.some(m => !m.motor || MOTOR.totalNoCierra(m.mandado, m.motor)));
  t.ok('paridad: los renglones que arma el motor son idénticos a los de la tienda (letra por letra)', honestos > 500 && malos.length === 0);
  if (malos.length) console.log('  primer caso distinto:', JSON.stringify(malos[0]).slice(0, 1500));

  // 2) Pedidos fijos que conocemos de memoria.
  const KLIK = { id: 7, nombre: 'Klik Caramelo', descripcion: '', dueno: 'Jony', moneda: '$', precio_min: 6499, precio_may: '4', precio_oferta: 0, fecha_oferta: '', cant_pack: 0, precio_pack: 0, activo: true };
  MOTOR.setAhora('23/09/2026 14:05');
  let p = pedido({ filas: [KLIK], modo: 'minorista', carrito: [[7, 10]] });
  let r = motorRecibe(p.params, [KLIK], {});
  t.eq('10 Klik a $ 6.499: la tienda manda $ 64.990 y el motor da lo mismo', [p.params.get('totalARS'), r.cuenta.totalARS, r.noCierra], ['64990', 64990, false]);
  t.eq('el renglón, como siempre', r.cuenta.lineas[0], '• 10x Klik Caramelo — $ 6.499 c/u = $ 64.990');

  // 3) ATAQUES: alguien arma el pedido a mano con otro total.
  const forjar = (params, cambios) => { const q = new URLSearchParams(params); Object.entries(cambios).forEach(([k, v]) => q.set(k, String(v))); return q; };
  r = motorRecibe(forjar(p.params, { totalARS: 150, arsJONY: 150 }), [KLIK], {});
  t.eq('ATAQUE: "10 Klik por $ 150" → no cierra; el real es $ 64.990', [r.noCierra, r.cuenta.totalARS], [true, 64990]);
  t.ok('el aviso dice lo que mandó y lo real', MOTOR._plataTxt(r.mandado.totalARS, r.mandado.totalUSD) === '$ 150' && MOTOR._plataTxt(r.cuenta.totalARS, r.cuenta.totalUSD) === '$ 64.990');
  r = motorRecibe(forjar(p.params, { arsJONY: 0, arsMyri: 64990, comiARS: 9749 }), [KLIK], {});
  t.ok('ATAQUE: el total bien pero repartido a Miri en vez de Jony → no cierra', r.noCierra === true);
  r = motorRecibe(forjar(p.params, { stockUpdates: '7:1' }), [KLIK], {});
  t.ok('ATAQUE: el total de 10 pero el stock de 1 → no cierra (la plata sale del stock que se mueve)', r.noCierra === true && r.cuenta.totalARS === 6499);
  r = motorRecibe(forjar(p.params, { productos: '• 1x Klik Caramelo — $ 6.499 c/u = $ 6.499' }), [KLIK], {});
  t.ok('ATAQUE: el texto dice 1 y la plata y el stock dicen 10 → la plata cierra, pero el motor NO usa ese texto (arma el suyo)', r.noCierra === false && r.lineasIguales === false && r.cuenta.lineas[0].startsWith('• 10x'));
  const DOLAR = { id: 8, nombre: 'Elite Egozi', descripcion: 'Caja x 24', dueno: 'Jony', moneda: 'U$S', precio_min: 2500, precio_may: '12.35', precio_oferta: 0, fecha_oferta: '', cant_pack: 0, precio_pack: 0, activo: true };
  p = pedido({ filas: [DOLAR], modo: 'mayorista', carrito: [[8, 3]] });
  r = motorRecibe(p.params, [DOLAR], {});
  t.eq('mayorista en dólares: 3 × U$S 12,35 = U$S 37,05, y cierra', [p.params.get('totalUSD'), r.noCierra], ['37.05', false]);
  r = motorRecibe(forjar(p.params, { totalUSD: '0.01', usdJONY: '0.01' }), [DOLAR], {});
  t.ok('ATAQUE: el mismo pedido "por U$S 0,01" → no cierra', r.noCierra === true);
  t.ok('un centavo de redondeo NO es un ataque (U$S 37,05 vs 37,054)', MOTOR.totalNoCierra({ ...r.mandado, totalUSD: 37.05, usdJONY: 37.05 }, { ...r.cuenta, totalUSD: 37.054, usdJONY: 37.054 }) === false);

  // 4) Link VIP: el descuento es del link guardado en el motor, no de lo que diga el navegador.
  const VIP = { ids: ['7'], nombre: 'Tomás', canal: 'minorista', desc: 10, descProd: {} };
  p = pedido({ filas: [KLIK], modo: 'minorista', vip: VIP, vipToken: 'tomas123', carrito: [[7, 2]] });
  r = motorRecibe(p.params, [KLIK], { tomas123: VIP });
  t.eq('link VIP con 10%: 2 Klik a $ 5.850 (6.499 − 10%, para arriba) y cierra', [p.params.get('totalARS'), r.noCierra], ['11700', false]);
  r = motorRecibe(forjar(p.params, { vip: 'inventado99' }), [KLIK], { tomas123: VIP });
  t.eq('ATAQUE: el descuento de un link que no existe → no cierra; el real es sin descuento', [r.noCierra, r.cuenta.totalARS], [true, 12998]);
  r = motorRecibe(forjar(p.params, { vip: '' }), [KLIK], { tomas123: VIP });
  t.ok('ATAQUE: el descuento sin mandar el link → no cierra', r.noCierra === true);

  // 5) Ofertas y packs: lo que vale HOY.
  const OF = { ...KLIK, precio_oferta: 5000, fecha_oferta: '22/09/2026' };
  p = pedido({ filas: [OF], modo: 'minorista', hoy: '2026-09-22', carrito: [[7, 1]] });
  MOTOR.setAhora('22/09/2026 23:59');
  t.ok('la oferta que vence hoy vale hasta el final del día (hora de Buenos Aires)', motorRecibe(p.params, [OF], {}).noCierra === false);
  MOTOR.setAhora('23/09/2026 00:01');
  r = motorRecibe(p.params, [OF], {});
  t.eq('pasada la medianoche la oferta ya no vale: el pedido de la página vieja se corrige a $ 6.499', [r.noCierra, r.cuenta.totalARS], [true, 6499]);
  const PACK = { ...KLIK, cant_pack: 6, precio_pack: 5500 };
  MOTOR.setAhora('23/09/2026 14:05');
  p = pedido({ filas: [PACK], modo: 'minorista', carrito: [[7, 6]] });
  t.eq('pack "llevando 6, cada una a $ 5.500": 6 → $ 33.000 y cierra', [p.params.get('totalARS'), motorRecibe(p.params, [PACK], {}).noCierra], ['33000', false]);
  p = pedido({ filas: [PACK], modo: 'minorista', carrito: [[7, 5]] });
  r = motorRecibe(forjar(p.params, { totalARS: 27500, arsJONY: 27500 }), [PACK], {});
  t.ok('ATAQUE: el precio del pack con 5 (no llega a 6) → no cierra', r.noCierra === true && r.cuenta.totalARS === 32495);
  p = pedido({ filas: [KLIK], modo: 'mayorista', carrito: [[7, 1]] });
  const SIN = { ...KLIK, precio_may: '' };
  r = motorRecibe(p.params, [SIN], {});
  t.ok('un producto SIN precio en el pedido queda marcado (la tienda no deja pedirlo)', r.cuenta.sinPrecio.length === 1 && r.cuenta.sinPrecio[0] === 'Klik Caramelo');

  // 6) La fecha de hoy del motor sale de la hora de Buenos Aires.
  MOTOR.setAhora('01/01/2027 00:10');
  t.eq('hoy (Buenos Aires) en formato aaaa-mm-dd', MOTOR._hoyISO_AR(), '2027-01-01');

  // 7) Cómo lo usa el motor (el bloque real de 'venta').
  const venta = (() => { const i = TS.indexOf("if (accion === 'venta') {"); return TS.slice(i, TS.indexOf("if (accion === 'registrarPedidoHijo')", i)); })();
  t.ok('manual del panel: sin la sesión de Jony no entra (el panel renueva la sesión y reintenta)', /if \(Q\('manual'\) === '1' && !ventaManual\) return json\(\{ error: 'no autorizado' \}\)/.test(venta));
  t.ok('el pedido manual (sesión de Jony) no pasa por el freno ni por la corrección', venta.includes('if (!ventaManual) {') && venta.includes('if (!ventaManual && stockUpdates) {'));
  t.ok('los renglones guardados salen de la cuenta real', venta.includes("productos: productosReales || _libre(Q('productos'), 20000)"));
  t.ok('si no cierra, se guarda lo real y queda la marca en las notas y en el WhatsApp', venta.includes("V('totalARS', cuenta?.totalARS)") && venta.includes("_libre(correccion, 400) + _libre(Q('notas'), 1000)") && venta.includes("'⚠️ *REVISALO ANTES DE COBRAR*"));
  t.ok('la huella de la conexión se guarda con el pedido', venta.includes('if (ipVenta) fila.ip_h = ipVenta;'));
  const envio = fnDe(HTML, 'enviarVentaASheet');
  t.ok('la tienda le dice al motor qué link VIP usó', envio.includes("vip: _vipToken || ''"));
  const manualIni = HTML.indexOf("accion: 'venta', manual: '1'");
  t.ok("el pedido manual del panel va marcado y por fetchConSesion", manualIni !== -1 && HTML.slice(manualIni, manualIni + 2500).includes('fetchConSesion(APPS_SCRIPT_URL'));

  // 8) FRENO de pedidos falsos: por conexión y en total, por hora, con UN aviso por hora.
  const consultas = [];
  let nConexion = 0, nTotal = 0;
  const F = new Function('sbGet', sinTipos(constDe(TS, 'FRENO_POR_CONEXION').replace(/^const /, 'var ').replace(/, FRENO_TOTAL_HORA = /, '; var FRENO_TOTAL_HORA = ') + fnDe(TS, 'frenoPedidos', 'async function')) + '\nreturn { frenoPedidos, FRENO_POR_CONEXION, FRENO_TOTAL_HORA };')(
    async (tabla, q) => { consultas.push(tabla + '?' + q); return new Array(q.includes('ip_h=eq.') ? nConexion : nTotal).fill({}); });
  t.eq('los límites: 5 por conexión y 30 en total, por hora', [F.FRENO_POR_CONEXION, F.FRENO_TOTAL_HORA], [5, 30]);
  nConexion = 4; nTotal = 29;
  t.eq('4 de la misma conexión y 29 en total → pasa', await F.frenoPedidos('ventas', 'abc123'), '');
  nConexion = 5;
  t.eq('el 6º de la misma conexión en una hora → freno', await F.frenoPedidos('ventas', 'abc123'), 'conexion');
  nConexion = 0; nTotal = 30;
  t.eq('más de 30 en una hora entre todos → freno', await F.frenoPedidos('ventas', 'abc123'), 'total');
  t.eq('sin huella (no se sabe la conexión) igual cuenta el total', await F.frenoPedidos('candy_pedidos', ''), 'total');
  t.ok('mira solo la última hora y cuenta solo pedidos de la tienda (los que tienen huella)', consultas.every(c => c.includes('creado=gte.')) && consultas.some(c => c.includes('ip_h=not.is.null')) && consultas.some(c => c.includes('ip_h=eq.abc123')));

  let reloj = 1_800_000_000_000, cfg = {}, enviados = [];
  const A = new Function('getConfig', 'setConfig', 'sendTwilioWA', 'Date', sinTipos('const FRENO_POR_CONEXION = 5, FRENO_TOTAL_HORA = 30;\n' + fnDe(TS, 'avisarFreno', 'async function')) + '\nreturn avisarFreno;')(
    async (k, d) => (k in cfg ? cfg[k] : d), async (k, v) => { cfg[k] = v; }, async (to, msg) => { enviados.push({ to, msg }); }, { now: () => reloj });
  await A('ventas', 'conexion'); await A('ventas', 'conexion'); reloj += 30 * 60000; await A('ventas', 'total');
  t.eq('UN solo aviso por hora aunque sigan llegando', enviados.length, 1);
  reloj += 31 * 60000; await A('ventas', 'total');
  t.eq('pasada la hora, avisa de nuevo', enviados.length, 2);
  t.ok('el aviso va a Jony y explica qué pasó', enviados[0].to === '+5491131754540' && enviados[0].msg.includes('MISMA conexión') && enviados[1].msg.includes('más de 30'));
  await A('candy_pedidos', 'conexion');
  t.ok('el Candy tiene su propio aviso', enviados.length === 3 && enviados[2].msg.includes('tienda del Candy'));

  // 9) La huella de la conexión: nunca la IP, siempre la misma para la misma conexión.
  const H = new Function('BOT_SECRET', sinTipos(fnDe(TS, 'huellaIP', 'async function')) + '\nreturn huellaIP;')('secreto-de-prueba');
  const req = h => ({ headers: { get: k => h[k.toLowerCase()] || null } });
  const h1 = await H(req({ 'cf-connecting-ip': '181.45.10.20' })), h2 = await H(req({ 'cf-connecting-ip': '181.45.10.20', 'x-real-ip': '9.9.9.9' }));
  t.ok('misma conexión → misma huella; es corta (20 letras) y no contiene la IP', h1 === h2 && /^[0-9a-f]{20}$/.test(h1) && !h1.includes('181'));
  t.ok('otra conexión → otra huella', h1 !== await H(req({ 'cf-connecting-ip': '181.45.10.21' })));
  t.ok('si no está la de Cloudflare usa x-real-ip, y si no, la primera de x-forwarded-for', await H(req({ 'x-real-ip': '181.45.10.20' })) === h1 && await H(req({ 'x-forwarded-for': '181.45.10.20, 10.0.0.1' })) === h1);
  t.eq('sin ninguna → sin huella', await H(req({})), '');
  const Hotro = new Function('BOT_SECRET', sinTipos(fnDe(TS, 'huellaIP', 'async function')) + '\nreturn huellaIP;')('otro-secreto');
  t.ok('la huella depende del secreto del motor (no se puede armar una tabla de IPs → huellas)', await Hotro(req({ 'cf-connecting-ip': '181.45.10.20' })) !== h1);

  // 10) El Candy: freno y huella en sus pedidos.
  const hijo = (() => { const i = TS.indexOf("if (accion === 'registrarPedidoHijo') {"); return TS.slice(i, TS.indexOf("\n    if (accion === '", i + 10)); })();
  t.ok('pedidos del Candy: freno por conexión y total, y guardan la huella', hijo.includes("frenoPedidos('candy_pedidos', ipPH)") && hijo.includes('ip_h: ipPH'));

  return t.result();
}
module.exports = { run, _interno: { pedido, motorRecibe, MOTOR } };
if (require.main === module) run().then(r => { r.forEach(x => console.log((x.ok ? '  ✓ ' : '  ✗ FALLÓ — ') + x.name)); const m = r.filter(x => !x.ok).length; console.log(m ? `❌ ${m} fallaron` : `✅ ${r.length}/${r.length}`); process.exit(m ? 1 : 0); });
