// 🔴 EN VIVO, probado de punta a punta en un navegador de verdad y contra el servidor REAL del
// sitio (despliegue/sitio/servidor.mjs) corriendo en local con un motor y un Auth de mentira:
// la tienda manda su visita por /api/track → el servidor la reenvía al motor y la empuja al
// panel por SSE → la pestaña 🔴 En vivo la dibuja. También: quién es quién, el checkout, la
// foto de respaldo, el 401 de Miri y que en vista Miri la pestaña no existe.
// Uso: node tests/en_vivo_ui.test.js   (levanta solo el servidor y el mock; puerto 3199/3998)
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const RAIZ = process.env.RAIZ_PRUEBA || path.resolve(__dirname, '..');
const SITIO = 'http://127.0.0.1:3199';

const DATA = {
  resumen: { visitas: 55, unicos: 32, nuevos: 31, recurrentes: 1, tienda: 42, mayorista: 13 },
  embudo: { visita: 30, carrito: 2, checkout: 1, pedido: 1 }, porOrigen: { directo: 55 }, porDispositivo: { celular: 43, compu: 12 },
  topCiudades: [], topPaises: [], porHora: new Array(24).fill(1), porDiaSemana: [1, 1, 1, 1, 1, 1, 1], dias30: [], topProductos: [], conversionPorOrigen: [], leads: [],
  abandonados: [], acciones: [], accionable: { identificados: 1, conTelefono: 1, anonimos: 30, oportunidadARS: 0, oportunidadUSD: 0, carritosContactables: 0 },
  visitantes: [{ vid: 'v_abc', nombre: 'Débora Levy', telefono: '1144556677', esCliente: true, compras: 3, gastadoARS: 145000, apodo: '#VABC', leDijiste: false, etiqueta: 'compró', visitas: 3, dias: 2, productos: [], perfil: {} }],
  visitantesTotal: 1, diasDetalle: [], deseoVsVenta: [], busquedas: [], candado: null, comparativo: null, mironesTop: [], rescate: null, radiografia: null,
  recompra: { ofrecidos: 5, cargados: 3, descartados: 1, compraron: 2 },
  encuesta: { canales: { whatsapp: 3, amigo: 1 }, respuestas: 4, pushSi: 2 },
  heatmap: Array.from({ length: 7 }, (_, d) => Array.from({ length: 24 }, (_, h) => (d === 4 && h === 20) ? 30 : (h % 5))),
  cohortes: [{ semana: '08/09', nuevos: 40, volvieron: 12, compraron: 2, pctVolvieron: 30, pctCompraron: 5 }, { semana: '15/09', nuevos: 55, volvieron: 9, compraron: 1, pctVolvieron: 16, pctCompraron: 2 }],
  proyeccion: { visitas: 300, visitasProy: 700, pedidos: 3, pedidosProy: 7, diasTranscurridos: 3, cubierta: true },
  dormidos: [{ nombre: 'Fabio Pallero', telefono: '1130001111', ultimaCompra: '10/08/2026 12:00', diasSinComprar: 43, activo: false }],
  verMas: { eventos: 3, vistosSinCarrito: [{ nombre: 'Bamba', vistos: 4, personas: 3, stock: 5, dueno: 'Jony' }], nuncaVistos: [{ nombre: 'Escondido', stock: 7, dueno: 'Jony' }], quitados: [{ nombre: 'Klik', veces: 2 }], promos: { oferta: { veces: 1, top: [{ nombre: 'Klik', n: 1 }] }, pack: { veces: 0, top: [] } }, compartidos: [], avisoClics: { veces: 2, personas: 1 }, scroll: { n: 5, promedio: 62, alFinal: 2, pctAlFinal: 40 } },
  vipAbiertos: [{ token: 'tok1', cliente: 'Sarah G', canal: 'minorista', creado: '19/09/2026 09:00', aperturas: 0, personas: 0, ultima: '' }],
  hoyVsSemana: { hoy: [0, 0, 0, 0, 0, 0, 0, 0, 2, 5, 7, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], hace7: [0, 0, 0, 0, 0, 0, 0, 1, 3, 4, 2, 6, 5, 3, 2, 1, 0, 0, 2, 3, 4, 2, 1, 0], horaActual: 11, diaNombre: 'martes', fechaHoy: '2026-09-22', fechaHace7: '2026-09-15', hace7Disponible: true },
};

const PRODS_SB = [1, 2, 3, 4].map(i => ({ id: i, nombre: 'Producto de prueba ' + i, descripcion: 'desc', precio_may: '2000', precio_min: 3000, stock: 5, imagen: '', activo: true, categoria: 'Chocolate', visible_cat: 'Ambos', precio_oferta: 0, fecha_oferta: '', cant_pack: 0, precio_pack: 0, dueno: 'Jony', moneda: '$' }));
const esperar = ms => new Promise(r => setTimeout(r, ms));
// v4.84: lo que devuelve el motor para "todo el día": una visita de hace 2 horas que terminó en pedido.
// Si la prueba corre en las primeras 2 horas del día, "hace 2 horas" cae AYER y el día de hoy queda sin
// esa visita (5 pasos fallaban de madrugada, con el código bien): se la pone al empezar el día. Solo
// entre las 00:00 y las 00:06 no alcanza (la visita contaría todavía como "ahora").
const hoyBA = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date());
const INICIO_HOY_BA = Date.parse(hoyBA + 'T00:00:00-03:00');
const HACE2H = Math.max(Date.now() - 2 * 3600000, INICIO_HOY_BA + 60000);
const DIA = { dia: hoyBA, esHoy: true, eventos: [
  { id: 'm1', t: HACE2H, vid: 'v_rivka', pagina: 'tienda', evento: 'visita', ciudad: 'Once', dispositivo: 'celular', aparato: 'iPhone', nombre: 'Rivka Mañana', telefono: '1144448888', total: 0 },
  { id: 'm2', t: HACE2H + 20000, vid: 'v_rivka', pagina: 'tienda', evento: 'vistas', vistos: ['Klik', 'Bamba', 'Elite'], total: 0 },
  { id: 'm3', t: HACE2H + 40000, vid: 'v_rivka', pagina: 'tienda', evento: 'vistas', vistos: ['Elite'], total: 0 },
  { id: 'm4', t: HACE2H + 60000, vid: 'v_rivka', pagina: 'tienda', evento: 'carrito', detalle: 'Klik', carrito: '[{"n":"Klik","q":2,"p":7999}]', total: 15998 },
  { id: 'm5', t: HACE2H + 90000, vid: 'v_rivka', pagina: 'tienda', evento: 'pedido', total: 15998, carrito: '[{"n":"Klik","q":2,"p":7999}]' },
] };
// v4.85: la ficha del visitante con la forma nueva (productos de verdad + recorrido en eventos compactos)
const FICHA = { vid: 'v_rivka', nombre: 'Rivka Mañana', telefono: '1144448888', ciudad: 'Once', pais: 'Argentina', dispositivo: 'celular', origen: 'whatsapp',
  fichaTecnica: { tz: 'America/Argentina/Buenos_Aires', idi: 'es-AR', ap: 'iPhone', px: '390x844', toq: 1, hl: 10 }, segundos: 95, interacciones: 3,
  apodo: '#IVKA', aliasPuesto: '', notaPuesta: '', eventos: { visita: 1, vistas: 2, carrito: 1, pedido: 1 }, dias: 1, primera: '22/09/2026 10:00', ultima: '22/09/2026 10:02',
  productos: [{ nombre: 'Elite', n: 2 }, { nombre: 'Klik', n: 1 }, { nombre: 'Bamba', n: 1 }], agregados: [{ nombre: 'Klik', n: 1 }],
  compras: [{ nVenta: 157, fecha: '22/09/2026 10:02', cliente: 'Rivka Mañana', estado: 'pendiente', totalARS: 15998, totalUSD: 0 }], gastadoARS: 15998,
  linea: DIA.eventos.map(e => ({ ...e, fecha: '' })) };
const pedidosDia = [];
async function hasta(fn, ms = 6000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await esperar(150); } return false; }

(async () => {
  const mock = spawn('node', [path.join(__dirname, '_mock_motor_auth.mjs')], { stdio: 'ignore' });
  const srv = spawn('node', ['servidor.mjs'], { cwd: path.join(RAIZ, 'despliegue', 'sitio'), stdio: 'ignore', env: { ...process.env, MOTOR_URL: 'http://127.0.0.1:3998/motor', SUPABASE_URL: 'http://127.0.0.1:3998', PUERTO: '3199', RAIZ } });
  await esperar(1500);
  const b = await chromium.launch();
  const pg = await b.newPage();
  // El cliente de Supabase no carga desde el CDN en la prueba: se stubea (igual que en ana_vuelta_rosca).
  await pg.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });   // v4.80: los automatizados no cuentan; acá queremos contar
    window.supabase = { createClient: () => ({ auth: {
      getSession: async () => ({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } })
    } }) };
  });
  const errs = [];
  pg.on('pageerror', e => errs.push(e.message));
  await pg.route('**/*', route => {
    const u = route.request().url();
    if (u.includes('getAnalitica')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify(DATA) });
    if (u.includes('eventosDelDia')) { const m = u.match(/dia=(\d{4}-\d{2}-\d{2})/); pedidosDia.push(m ? m[1] : ''); return route.fulfill({ contentType: 'application/json', body: JSON.stringify(m && m[1] !== hoyBA ? { dia: m[1], esHoy: false, eventos: [] } : DIA) }); }
    if (u.includes('getFichaVisitante')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify(FICHA) });
    if (u.includes('getAlertasPush')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, cfg: { checkout: 1, conocido: 1, busqueda: 0, pico: 1, carrito: 1, carritoMin: 20000, picoMin: 15, informe: 1, rareza: 1, avisame: 1 } }) });
    // El catálogo (Supabase REST) con productos de mentira: sin tarjetas no hay vistas que medir.
    if (/\/rest\/v1\/productos\?/.test(u)) return route.fulfill({ contentType: 'application/json', body: JSON.stringify(PRODS_SB) });
    if (u.startsWith(SITIO)) return route.continue();
    if (u.includes('supabase') || u.includes('ipapi') || u.includes('qrserver') || u.includes('onesignal')) return route.fulfill({ contentType: 'application/json', body: '[]' });
    return route.continue();
  });
  const checks = [];
  const ok = (n, c) => checks.push({ n, ok: !!c });
  const txt = () => pg.evaluate(() => (document.getElementById('analitica-contenido') || {}).innerText || '');
  const track = (q) => fetch(SITIO + '/api/track?' + new URLSearchParams(q).toString()).then(r => r.status);
  const recibidos = () => fetch('http://127.0.0.1:3998/_recibidos').then(r => r.json());

  // ── 1) La TIENDA, como un cliente: la visita tiene que llegar al motor pasando por el servidor ──
  await pg.goto(SITIO + '/tienda', { waitUntil: 'domcontentloaded' });
  ok('la tienda mandó su visita por /api/track y el servidor la reenvió al motor', await hasta(async () => (await recibidos()).some(r => r.evento === 'visita' && r.pagina === 'tienda' && /^v_/.test(r.vid))));
  const vidTienda = (await recibidos()).find(r => r.evento === 'visita').vid;
  // v4.81: las tarjetas a la vista se anotan (1 s a media altura) y viajan en lote como 'vistas'.
  // Como una persona: baja un poco para que las tarjetas queden a la vista (la mitad, un segundo).
  await pg.evaluate(() => window.scrollTo(0, 600));
  await pg.waitForTimeout(1600);
  await pg.evaluate(() => _vistasEnviar(false));
  ok('v4.81: la tienda mandó un lote de VISTAS con las tarjetas que estuvieron a la vista', await hasta(async () => (await recibidos()).some(r => r.evento === 'vistas' && (() => { try { return JSON.parse(r.producto).v.length > 0; } catch { return false; } })())));
  // v4.81: sacar del carrito se registra como 'quitar'
  // (en la prueba el catálogo no carga desde Supabase: se inventa un producto)
  await pg.evaluate(() => { const p = { id: 999001, nombre: 'Klik de prueba', stock: 5, precioMin: 1000, precioMay: 900, desc: '' }; productos.push(p); carrito[p.id] = { ...p, qty: 1 }; eliminarDelCarrito(p.id); });
  ok('v4.81: sacar algo del carrito manda "quitar"', await hasta(async () => (await recibidos()).some(r => r.evento === 'quitar' && r.total === '0' && r.producto === 'Klik de prueba')));

  // ── 2) El PANEL de Jony ──
  await pg.evaluate(() => { adminAuth = true; socioActual = 'jony'; _authToken = 'jony'; localStorage.setItem('shuk_no_track', '1'); });
  await pg.evaluate(() => setAdminTab('analitica'));
  await pg.waitForTimeout(600);
  ok('la pestaña 🔴 En vivo existe y va primera', (await txt()).trim().startsWith('🔴 En vivo'));
  ok('v4.80: hay botón "Hoy" en el período', await pg.evaluate(() => !!document.getElementById('ana-p-hoy')));
  await pg.evaluate(() => setAnaTab('hoy'));
  await pg.waitForTimeout(500);
  { const c = await txt(); const h = await pg.content();
    ok('v4.86: "Qué hacer" mide si sirve «lo de siempre»', c.includes('¿Sirve «lo de siempre»?') && c.includes('Lo cargaron'));
    ok('v4.86: la tarjeta de avisos tiene "Volvió algo que alguien esperaba", prendido', c.includes('Volvió algo que alguien esperaba') && h.includes('data-alerta="avisame" checked'));
    ok('v4.82: "Qué hacer" termina con la tarjeta de avisos al celular, con la config cargada', c.includes('Avisos al celular') && c.includes('Informe del domingo') && h.includes('data-alerta="busqueda"') && !h.includes('data-alerta="busqueda" checked') && h.includes('data-alerta="checkout" checked')); }
  await pg.evaluate(() => setAnaTab('productos'));
  await pg.waitForTimeout(200);
  { const c = await txt();
    ok('v4.81: Productos muestra "los ven y no los agarran" y "nadie llega a verlos"', c.includes('Los ven y no los agarran') && c.includes('Nadie llega a verlos') && c.includes('Escondido')); }
  await pg.evaluate(() => setAnaTab('gente'));
  await pg.waitForTimeout(200);
  ok('v4.81: Gente muestra los catálogos VIP con "nunca lo abrió"', (await txt()).includes('Catálogos VIP') && (await txt()).includes('nunca lo abrió'));
  { const c = await txt(); const h = await pg.content();
    ok('v4.83: Gente muestra mayoristas dormidos con botón para despertarlo y las cohortes', c.includes('Mayoristas dormidos') && c.includes('Fabio Pallero') && h.includes('wa.me/5491130001111') && c.includes('¿Vuelven?') && c.includes('30%')); }
  await pg.evaluate(() => setAnaTab('canales'));
  await pg.waitForTimeout(200);
  ok('v4.86: Canales muestra "¿Cómo nos conocieron?" con lo que contestaron los clientes', (await txt()).includes('¿Cómo nos conocieron?') && (await txt()).includes('Un amigo') && (await txt()).includes('2 pidieron que les avisemos'));
  ok('v4.83: Canales muestra el mapa de calor con el pico (jueves 20:00)', (await txt()).includes('Cuándo entran') && (await txt()).includes('Jue a las 20:00'));
  await pg.evaluate(() => setAnaTab('hoy'));
  await pg.waitForTimeout(200);
  ok('v4.83: Qué hacer muestra la proyección de la semana', (await txt()).includes('la semana cierra con 7 pedidos y 700 visitas'));
  await pg.evaluate(() => setAnaTab('canales'));
  await pg.waitForTimeout(200);
  { const c = await txt(); const h = await pg.content();
    ok('v4.80: Canales arranca con el generador de links etiquetados (copiar minorista/mayorista)', c.includes('Links por canal') && h.includes('/tienda?c=wa') && h.includes('/mayorista?c=estado'));
    ok('v4.80: "directo" se explica como "sin etiqueta"', c.includes('Directo (sin etiqueta)')); }
  await pg.evaluate(() => setAnaTab('vivo'));
  ok('se conecta por SSE (punto verde "En vivo")', await hasta(async () => (await txt()).includes('En vivo ·') && (await pg.evaluate(() => _vivo.fuente)) === 'sse'));
  let t = await txt();
  ok('la visita de la tienda de recién ya figura como persona en la tienda ahora', t.includes('1 persona en la tienda ahora'));
  ok('v4.84: "Todo el día de hoy" trae la visita de la mañana desde el motor, con su resumen', await hasta(async () => { const x = await txt(); return x.includes('Todo el día de hoy') && x.includes('Rivka Mañana') && x.includes('miró 3 productos') && x.includes('pidió'); }));
  ok('v4.84: y junta lo de la mañana con lo de recién (la visita de la tienda de esta prueba)', (await txt()).includes('entró') && (await txt()).includes('sacó Klik de prueba'));
  ok('el gráfico hoy vs semana pasada se dibuja con sus totales', t.includes('Hoy: 18 visitas') && t.includes('martes pasado') && t.includes('16 a esta hora'));

  // ── 3) Llegan eventos en vivo ──
  await track({ vid: 'v_abc', evento: 'carrito', producto: 'Klik', carrito: '[{"n":"Klik","q":2,"p":1000}]', total: '2000', ciudad: 'Castelar', dispositivo: 'celular' });
  ok('el carrito de Débora aparece al instante, CON NOMBRE (cruce con la Analítica) y sus compras', await hasta(async () => { const x = await txt(); return x.includes('Débora Levy') && x.includes('3 compras') && x.includes('2× Klik') && x.includes('$ 2.000'); }));
  await track({ vid: 'v_abc', evento: 'checkout', carrito: '[{"n":"Klik","q":2,"p":1000}]', total: '2000', nombre: 'Débora Levy', telefono: '1144556677' });
  ok('al llegar al checkout cambia el chip y hay botón para escribirle ahora', await hasta(async () => { const x = await txt(); return x.includes('en el checkout') && x.includes('Escribirle ahora'); }));
  ok('todo el día: la visita de Débora aparece con hora y el checkout', await hasta(async () => /\d\d:\d\d/.test(await txt()) && (await txt()).includes('llegó al checkout')));
  ok('personas ahora = 2 (la de la tienda + Débora)', (await txt()).includes('2 personas en la tienda ahora'));
  await track({ vid: 'v_abc', evento: 'busqueda', producto: 'Gum', total: '0' });
  ok('una búsqueda sin resultados se marca en rojo en el resumen de la visita', await hasta(async () => (await txt()).includes('sin resultados')));
  await track({ vid: vidTienda, evento: 'salida', producto: '{"seg":42,"int":1,"prod":2}' });
  ok('el que se fue deja de contar como "ahora" pero queda en el día', await hasta(async () => { const x = await txt(); return x.includes('1 persona en la tienda ahora') && x.includes('se fue a los 42 s'); }));
  // v4.84: filtros, paso a paso y otro día
  await pg.evaluate(() => vivoDiaFiltro('pidieron'));
  { const x = await pg.evaluate(() => document.getElementById('vivo-dia').innerText); ok('v4.84: filtro "Pidieron" deja solo la visita que pidió (en la lista del día)', x.includes('Rivka Mañana') && !x.includes('Débora Levy')); }
  await pg.evaluate(() => vivoDiaFiltro('todas'));
  await pg.evaluate(() => { const b = [...document.querySelectorAll('#vivo-dia button')].find(x => x.textContent.includes('Paso a paso') && x.closest('div[style*="border-bottom"]').textContent.includes('Rivka')); if (b) b.click(); });
  { const x = await txt(); ok('v4.84: el paso a paso junta las dos tandas de vistas en un renglón, con hora y segundos', x.includes('miró 3: Klik, Bamba, Elite') && /\d\d:\d\d:\d\d/.test(x)); }
  // v4.85: la ficha del visitante, visita por visita y sin texto de código
  await pg.evaluate(() => abrirFichaVisitante('v_rivka'));
  await hasta(async () => (await pg.evaluate(() => (document.getElementById('ana-ficha-modal') || {}).innerText || '')).includes('Su recorrido'));
  { const fx = await pg.evaluate(() => document.getElementById('ana-ficha-modal').innerText);
    ok('v4.85: la ficha muestra lo que más miró y lo que puso en el carrito, con productos de verdad', fx.includes('Lo que más miró') && fx.includes('Elite') && fx.includes('Lo que puso en el carrito'));
    ok('v4.85: el recorrido va visita por visita, con fecha y resumen', fx.includes('Su recorrido, visita por visita') && /\d\d\/\d\d/.test(fx) && fx.includes('miró 3 productos') && fx.includes('pidió'));
    ok('v4.85: la ficha no muestra ningún texto de código', !fx.includes('{"') && !fx.includes('"tz"') && !fx.includes('"seg"')); }
  await pg.evaluate(() => { const b = [...document.querySelectorAll('#ficha-recorrido button')].find(x => x.textContent.includes('Paso a paso')); if (b) b.click(); });
  ok('v4.85: el paso a paso de la ficha muestra qué llevaba en el pedido', (await pg.evaluate(() => document.getElementById('ficha-recorrido').innerText)).includes('2× Klik'));
  await pg.evaluate(() => cerrarFichaVisitante());
  await pg.evaluate(() => vivoDiaIr(-1));
  ok('v4.84: "Día anterior" le pide al motor el día de ayer y lo muestra', await hasta(async () => pedidosDia.length >= 2 && pedidosDia[pedidosDia.length - 1] < hoyBA && (await txt()).includes('Todo el ')));
  await pg.evaluate(() => vivoDiaIr(0));
  ok('v4.84: "Hoy" vuelve al día de hoy', await hasta(async () => (await txt()).includes('Todo el día de hoy')));
  if (process.env.CAPTURA) {
    // Para la foto: hacer visible el panel (en la prueba no se entra al panel de verdad) y capturar solo la pestaña.
    await pg.setViewportSize({ width: 420, height: 1600 });
    await pg.evaluate(() => { let el = document.getElementById('analitica-contenido'); while (el) { if (getComputedStyle(el).display === 'none') el.style.display = 'block'; el = el.parentElement; } });
    await pg.locator('#analitica-contenido').screenshot({ path: process.env.CAPTURA });
  }
  const html = await pg.content();
  ok('el botón de WhatsApp lleva el teléfono de Débora', html.includes('wa.me/5491144556677'));

  // ── 4) La foto de respaldo (sin SSE) ──
  await pg.evaluate(() => { _vivoDesconectar(false); _vivo.fuente = 'poll'; });
  await track({ vid: 'v_nuevo', evento: 'visita', pagina: 'mayorista' });
  await pg.evaluate(() => _vivoFoto());
  ok('sin SSE, la foto trae al nuevo (y dice que actualiza cada 15 s)', await hasta(async () => { const x = await txt(); return x.includes('Actualizando cada 15 s') && x.includes('mayorista'); }));

  // ── 5) Miri: el servidor le cierra la puerta, y en su vista la pestaña no existe ──
  await pg.evaluate(() => { _authToken = 'miri'; _vivoConectar(); });
  ok('con la sesión de Miri el servidor contesta 401 y la pantalla lo dice', await hasta(async () => (await txt()).includes('no disponible para esta cuenta'), 8000));
  await pg.evaluate(() => { _authToken = 'jony'; vistaSocio = 'miri'; setAnaTab('vivo'); });
  await pg.waitForTimeout(300);
  t = await txt();
  ok('en vista Miri no hay pestaña En vivo y cae en "Qué hacer"', !t.includes('🔴 En vivo') && t.includes('Resumen del período'));
  ok('v4.82: en vista Miri NO está la tarjeta de avisos', !t.includes('Avisos al celular'));
  ok('al salir de la pestaña se corta la conexión', (await pg.evaluate(() => !_vivo.es && !_vivo.timer)));
  ok('sin errores de JavaScript en toda la recorrida', errs.length === 0);

  await b.close(); srv.kill(); mock.kill();
  checks.forEach(c => console.log((c.ok ? '  ✓ ' : '  ✗ FALLÓ — ') + c.n));
  const malos = checks.filter(c => !c.ok).length;
  if (errs.length) console.log('  errores JS:', errs.slice(0, 3));
  console.log(malos ? `❌ ${malos} de ${checks.length} fallaron` : `✅ ${checks.length}/${checks.length} en vivo OK`);
  process.exit(malos ? 1 : 0);
})().catch(e => { console.error('💥', e); process.exit(1); });
process.on('exit', () => { try { require('child_process').execSync('pkill -f _mock_motor_auth.mjs; pkill -f "PUERTO=3199" ', { stdio: 'ignore' }); } catch { /**/ } });
