// 🧪 La Analítica nueva, probada de punta a punta en un navegador de verdad:
// las 6 pestañas dibujan, la ficha del visitante abre, el buscador filtra y los días se abren.
// Uso: node tests/ana_vuelta_rosca.test.js
const { chromium } = require('playwright');
const path = require('path');
const INDEX = 'file://' + path.resolve(__dirname, '..', 'index.html');

const DATA = {
  resumen: { visitas: 480, unicos: 297, nuevos: 262, recurrentes: 35, tienda: 408, mayorista: 71 },
  comparativa: { visitas: { actual: 480, anterior: 400, delta: 20 }, unicos: { actual: 297, anterior: 280, delta: 6 }, pedidos: { actual: 13, anterior: 8, delta: 62 } },
  embudo: { visita: 297, carrito: 23, checkout: 13, pedido: 8 },
  porOrigen: { directo: 300, whatsapp: 120, instagram: 60 },
  porDispositivo: { celular: 300, compu: 180 },
  topCiudades: [{ nombre: 'Buenos Aires', n: 210 }], topPaises: [{ nombre: 'Argentina', n: 400 }, { nombre: 'Israel', n: 12 }],
  porHora: Array.from({ length: 24 }, (_, h) => h === 21 ? 90 : h * 2), porDiaSemana: [10, 40, 55, 60, 70, 90, 20],
  dias30: [{ fecha: '2026-08-25', n: 120 }, { fecha: '2026-08-26', n: 147 }],
  topProductos: [{ nombre: 'Chocolate Elite', n: 23 }, { nombre: 'Bon O Bon', n: 19 }],
  conversionPorOrigen: [{ origen: 'whatsapp', visitantes: 80, pedidos: 12, pct: 15 }],
  leads: [{ nombre: 'Sarah G', telefono: '1155667788', ciudad: 'CABA', origen: 'whatsapp', pagina: 'tienda', visitas: 9, ultima: '26/08/2026 20:10' }],
  abandonados: [
    { vid: 'v_abc', nombre: 'Débora Levy', telefono: '1144556677', esCliente: true, compras: 3, gastadoARS: 145000, gastadoUSD: 0, ultimaCompra: '10/08/2026 18:00', tipoCliente: 'Minorista', comoSeSupo: 'ya compró desde este aparato', ciudad: 'CABA', dispositivo: 'celular', origen: 'whatsapp', visitas: 6, etapa: 'checkout', productos: ['Chocolate Elite'], items: [{ n: 'Chocolate Elite', q: 3, p: 8000 }, { n: 'Bon O Bon', q: 2, p: 5000 }], total: 34000, totalUSD: 0, totalEquiv: 34000, mayorista: false, cuando: '26/08 21:15', ts: Date.now() - 3600000, horas: 1, score: 1900 },
    { vid: 'v_may', nombre: 'Isi Michan', telefono: '1130275468', esCliente: false, compras: 0, gastadoARS: 0, gastadoUSD: 0, ultimaCompra: '', tipoCliente: '', comoSeSupo: 'se registró', ciudad: 'CABA', dispositivo: 'compu', origen: 'directo', visitas: 3, etapa: 'carrito', productos: ['Klik dolar'], items: [{ n: 'Klik dolar', q: 10, p: 8.55, m: 'U$S' }], total: 0, totalUSD: 85.5, totalEquiv: 119700, mayorista: true, cuando: '27/08 11:00', ts: Date.now() - 7200000, horas: 2, score: 900 },
    { vid: 'v_xyz', nombre: '', telefono: '', esCliente: false, compras: 0, gastadoARS: 0, gastadoUSD: 0, ultimaCompra: '', tipoCliente: '', comoSeSupo: '', ciudad: 'Rosario', dispositivo: 'compu', origen: 'directo', visitas: 2, etapa: 'carrito', productos: ['Pesek Zman'], items: [{ n: 'Pesek Zman', q: 1, p: 6000 }], total: 6000, totalUSD: 0, totalEquiv: 6000, mayorista: false, cuando: '24/08 10:00', ts: Date.now() - 3 * 86400000, horas: 72, score: 120 },
  ],
  acciones: [
    { id: 'carritos', icono: '🛒', urgencia: 'alta', titulo: '2 carritos quedaron sin terminar en las últimas 48 h', detalle: '**1** con teléfono para escribirle ahora mismo · $ 40.000 sobre la mesa', n: 2, ir: 'carritos' },
    { id: 'sin-stock', icono: '📦', urgencia: 'alta', titulo: '1 producto muy pedido está en CERO', detalle: 'Chocolate Elite (23 veces). Lo quieren y no lo tenés.', n: 1, ir: 'deseo' },
    { id: 'suba', icono: '📈', urgencia: 'baja', titulo: 'El tráfico subió 20%', detalle: 'De 400 a 480 visitas.', n: 0, ir: '' },
  ],
  accionable: { identificados: 40, conTelefono: 22, anonimos: 257, oportunidadARS: 40000, oportunidadUSD: 85.5, tcRef: 1400, carritosContactables: 1, clientesQueVolvieron: 3 },
  visitantes: [
    { vid: 'v_abc', nombre: 'Débora Levy', telefono: '1144556677', esCliente: true, compras: 3, gastadoARS: 145000, gastadoUSD: 0, ultimaCompra: '10/08/2026', tipoCliente: 'Minorista', comoSeSupo: 'ya compró desde este aparato', visitas: 6, dias: 4, primeraTs: 0, ultimaTs: Date.now(), primera: '01/08/2026 10:00', ultima: '26/08/2026 21:15', ciudad: 'CABA', pais: 'Argentina', dispositivo: 'celular', origen: 'whatsapp', pagina: 'tienda', productos: ['Chocolate Elite', 'Bon O Bon'], armoCarrito: true, checkout: true, pidio: false, valorCarrito: 34000, etiqueta: 'casi compra', perfil: { dondeEsta: 'Argentina', tz: 'America/Argentina/Buenos_Aires', idioma: 'español', aparato: 'iPhone', pantalla: '390x844', tactil: true, appInstalada: true, aceptaAvisos: true, desdeApp: false, horaLocal: 21, segundos: 180, interacciones: 6, productosVistos: 4, pareceRobot: false, señales: [] } },
    { vid: 'v_xyz', nombre: '', telefono: '', esCliente: false, compras: 0, gastadoARS: 0, gastadoUSD: 0, ultimaCompra: '', tipoCliente: '', comoSeSupo: '', visitas: 2, dias: 1, primeraTs: 0, ultimaTs: Date.now() - 1000, primera: '24/08/2026', ultima: '24/08/2026 10:00', ciudad: 'Rosario', pais: 'Argentina', dispositivo: 'compu', origen: 'directo', pagina: 'tienda', productos: ['Pesek Zman'], armoCarrito: true, checkout: false, pidio: false, valorCarrito: 6000, etiqueta: 'armó carrito', perfil: { dondeEsta: 'Israel', tz: 'Asia/Jerusalem', idioma: 'hebreo', aparato: 'Linux', pantalla: '1280x720', tactil: false, appInstalada: false, aceptaAvisos: false, desdeApp: false, horaLocal: 3, segundos: 1, interacciones: 0, productosVistos: 0, pareceRobot: true, señales: ['se fue en 1 s', 'no tocó nada'] } },
  ],
  visitantesTotal: 297,
  diasDetalle: [
    { fecha: '2026-08-25', visitas: 120, unicos: 80, carritos: 6, checkouts: 3, pedidos: 2, conv: 3, top: [{ nombre: 'Chocolate Elite', n: 5 }] },
    { fecha: '2026-08-26', visitas: 147, unicos: 95, carritos: 9, checkouts: 4, pedidos: 3, conv: 3, top: [{ nombre: 'Bon O Bon', n: 7 }] },
  ],
  deseoVsVenta: [
    { nombre: 'Chocolate Elite', deseado: 23, vendido: 0, stock: 0, activo: true, dueno: 'Jony' },
    { nombre: 'Bon O Bon', deseado: 19, vendido: 12, stock: 40, activo: true, dueno: 'Jony' },
    // Caso distinto: HAY stock, lo miran mucho y no lo compra nadie → el freno es el precio.
    { nombre: 'Pitzujim Nueces Pecan', deseado: 11, vendido: 0, stock: 25, activo: true, dueno: 'Jony' },
  ],
  busquedas: [{ q: 'halva', veces: 7, vacias: 7, personas: 5 }, { q: 'bon o bon', veces: 4, vacias: 0, personas: 4 }],
  candado: {
    bloqueados: 12, bloqueadosPorPais: [{ pais: 'IL', n: 8 }, { pais: 'US', n: 4 }], ultimoBloqueo: '27/08/2026 10:00',
    entraronDeAfuera: 2,
    deAfueraDetalle: [
      { pais: 'Israel', ciudad: 'Tel Aviv', visitas: 1, ultima: '24/08/2026 21:30', etiqueta: 'miró y se fue', nombre: '', vid: 'v_il', aparato: 'Windows', origen: 'directo', horaAlla: 'mar, 03:30', pareceRobot: true, dondeEsta: 'Israel', conPase: false, segundos: 1 },
      { pais: 'United States', ciudad: 'Boca Raton', visitas: 2, ultima: '27/08/2026 11:48', etiqueta: 'miró y se fue', nombre: '', vid: 'v_us', aparato: 'iPhone', origen: 'directo', horaAlla: 'jue, 10:48', pareceRobot: false, dondeEsta: 'América (New York)', conPase: true, segundos: 40 },
    ],
    discrepancias: [{ fecha: '27/08/2026 11:48', detalle: 'navegador:United States · candado:AR · candado PRENDIDO', ciudad: 'Boca Raton', pais: 'United States' }],
  },
  tiempoADecidir: { n: 8, mismoDia: 5, hasta3: 2, masDe3: 1, mediana: 0, promedio: 1.2 },
  juntos: [{ a: 'Chocolate Elite', b: 'Bon O Bon', n: 4 }],
  comparativo: {
    compradores: { n: 8, visitasProm: 3.2, productosProm: 4.1, canal: { que: 'whatsapp', n: 5, pct: 62 }, aparato: { que: 'celular', n: 6, pct: 75 } },
    mirones: { n: 250, visitasProm: 1.2, productosProm: 0.3, canal: { que: 'directo', n: 200, pct: 80 }, aparato: { que: 'celular', n: 180, pct: 72 } },
    casiCompran: { n: 39, visitasProm: 2.4, productosProm: 2.8, canal: { que: 'whatsapp', n: 20, pct: 51 }, aparato: { que: 'celular', n: 30, pct: 77 } },
  },
  radiografia: {
    conFicha: 120, sinFicha: 30, robots: 3, segundosPromedio: 74, aceptanAvisos: 9, appInstalada: 4,
    dondeEstan: [{ que: 'Argentina', n: 110 }, { que: 'Israel', n: 3 }],
    idiomas: [{ que: 'español', n: 115 }, { que: 'hebreo', n: 3 }],
    aparatos: [{ que: 'iPhone', n: 70 }, { que: 'Android', n: 40 }, { que: 'Windows', n: 10 }],
    robotsDetalle: [{ pais: 'Israel', ciudad: 'Tel Aviv', ultima: '24/08/2026 21:30', señales: ['se fue en 1 s', 'no tocó nada'], aparato: 'Linux' }],
  },
  mironesTop: [
    { vid: 'v_miron', nombre: '', telefono: '', esCliente: false, visitas: 9, dias: 5, ultima: '27/08/2026 09:00', ciudad: 'CABA', origen: 'instagram', dispositivo: 'celular', productos: ['Chocolate Elite'], armoCarrito: true, checkout: false, valorCarrito: 12000 },
    { vid: 'v_miron2', nombre: 'Ariel', telefono: '1122334455', esCliente: true, visitas: 4, dias: 3, ultima: '26/08/2026 18:00', ciudad: 'CABA', origen: 'whatsapp', dispositivo: 'compu', productos: ['Bon O Bon'], armoCarrito: false, checkout: false, valorCarrito: 0 },
  ],
};
const FICHA = {
  vid: 'v_abc', nombre: 'Débora Levy', telefono: '1144556677', ciudad: 'CABA', pais: 'Argentina', dispositivo: 'celular', origen: 'whatsapp',
  eventos: { visita: 6, carrito: 4, checkout: 1 }, dias: 4, primera: '01/08/2026 10:00', ultima: '26/08/2026 21:15',
  productos: [{ nombre: 'Chocolate Elite', n: 3 }], compras: [{ nVenta: 88, fecha: '10/08/2026 18:00', cliente: 'Débora Levy', estado: 'entregado', totalARS: 45000, totalUSD: 0, productos: '• 2x Chocolate Elite' }],
  gastadoARS: 145000,
  fichaTecnica: { tz: 'America/Argentina/Buenos_Aires', idi: 'es-AR', ap: 'iPhone', px: '390x844', toq: 1, pwa: 1, push: 1, hl: 21, wa: 1 },
  segundos: 180, interacciones: 6,
  linea: [
    { fecha: '26/08/2026 21:10', evento: 'visita', pagina: 'tienda', detalle: '', total: 0, items: null, origen: 'whatsapp' },
    { fecha: '26/08/2026 21:12', evento: 'busqueda', pagina: 'tienda', detalle: 'halva', total: 0, items: null, origen: '' },
    { fecha: '26/08/2026 21:15', evento: 'checkout', pagina: 'tienda', detalle: '', total: 34000, items: [{ n: 'Chocolate Elite', q: 3, p: 8000 }], origen: '' },
  ],
};

(async () => {
  const b = await chromium.launch();
  const pg = await b.newPage();
  await pg.addInitScript(() => {
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
    if (u.includes('getFichaVisitante')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify(FICHA) });
    if (u.includes('supabase') || u.includes('ipapi') || u.includes('qrserver')) return route.fulfill({ contentType: 'application/json', body: '[]' });
    return route.continue();
  });
  await pg.goto(INDEX, { waitUntil: 'domcontentloaded' });
  await pg.evaluate(() => { adminAuth = true; socioActual = 'jony'; });

  const checks = [];
  const ok = (n, c) => checks.push({ n, ok: !!c });
  const txt = () => pg.evaluate(() => document.getElementById('analitica-contenido').innerText);

  await pg.evaluate(() => renderAnalitica());
  await pg.waitForTimeout(700);

  let t = await txt();
  ok('abre en "Qué hacer" con la plata en juego', t.includes('$ 40.000') && t.includes('En carritos sin cerrar'));
  ok('muestra las acciones concretas', t.includes('sin terminar en las últimas 48 h') && t.includes('está en CERO'));
  ok('la negrita del detalle se renderiza (no sale **1**)', !t.includes('**'));
  ok('dice cuántos están identificados', t.includes('Sabemos quiénes son'));
  ok('el embudo muestra dónde se cae la gente', t.includes('se cayeron'));

  await pg.evaluate(() => setAnaTab('carritos'));
  await pg.waitForTimeout(250);
  t = await txt();
  ok('CARRITOS: el anónimo que ya compró aparece con NOMBRE', t.includes('Débora Levy'));
  ok('CARRITOS: muestra que ya te compró y cuánto gastó', t.includes('3 compras') && t.includes('145.000'));
  ok('CARRITOS: explica de dónde sacamos quién es', t.includes('ya compró desde este aparato'));
  ok('CARRITOS: dice hace cuánto quedó colgado', t.includes('hace 1 h') && t.includes('hace 3 días'));
  ok('CARRITOS: el que no se sabe quién es queda claro', t.includes('Sin identificar'));
  ok('CARRITOS: botón de WhatsApp con el pedido adentro', (await pg.content()).includes('waCarrito(0)'));

  ok('CARRITOS: el mayorista en dólares NO se muestra como pesos', t.includes('U$S 85,5') && !t.includes('$ 86'));
  ok('CARRITOS: se ve que ese carrito es mayorista', t.includes('mayorista'));
  const cab = await pg.evaluate(() => { setAnaTab('hoy'); return document.getElementById('analitica-contenido').innerText; });
  ok('CABECERA: la oportunidad muestra las dos monedas por separado', cab.includes('U$S 85,5'));
  await pg.evaluate(() => setAnaTab('carritos'));
  await pg.waitForTimeout(200);

  const msg = await pg.evaluate(() => {
    let capt = '';
    const orig = window.open; window.open = u => { capt = decodeURIComponent(u); };
    waCarrito(0); window.open = orig; return capt;
  });
  ok('WhatsApp: el mensaje lleva los productos y el total', msg.includes('3× Chocolate Elite') && msg.includes('$ 34.000'));
  ok('WhatsApp: va al teléfono correcto', msg.includes('wa.me/5491144556677'));

  await pg.evaluate(() => setAnaTab('gente'));
  await pg.waitForTimeout(250);
  t = await txt();
  ok('GENTE: lista con la etiqueta de qué es cada uno', t.includes('casi compra') && t.includes('armó carrito'));
  ok('GENTE: filtros con sus números', t.includes('Con teléfono (1)') && t.includes('Ya compraron (1)'));
  ok('GENTE: muestra qué miró cada uno', t.includes('Chocolate Elite'));
  await pg.evaluate(() => buscarGente('rosario'));
  await pg.waitForTimeout(200);
  t = await txt();
  ok('GENTE: el buscador filtra (busqué Rosario y quedó uno)', !t.includes('Débora Levy'));
  await pg.evaluate(() => buscarGente(''));

  t = await txt();
  ok('GENTE: lista los mirones para tentar', t.includes('Mirones para tentar') && t.includes('Volvió'));
  ok('GENTE: avisa a cuántos mirones se les puede escribir', t.includes('dejaron teléfono'));
  ok('GENTE: compara comprador contra mirón', t.includes('En qué se diferencia') && t.includes('Solo miraron'));
  ok('GENTE: dice cuánto tardan en decidirse y qué significa', t.includes('Cuánto tardan en decidirse') && t.includes('impulso'));
  ok('RADIOGRAFÍA: dice dónde están de verdad (por su reloj)', t.includes('Dónde están de verdad') && t.includes('Israel'));
  ok('RADIOGRAFÍA: en qué idioma leen y con qué aparato', t.includes('hebreo') && t.includes('iPhone'));
  ok('RADIOGRAFÍA: cuántos aceptan notificaciones', t.includes('Aceptan notificaciones'));
  ok('RADIOGRAFÍA: marca las visitas que no parecen personas', t.includes('No parecen personas') && t.includes('no tocó nada'));
  ok('RADIOGRAFÍA: aclara que a los robots NO los borra', t.includes('siguen siendo los reales'));
  ok('GENTE: al robot lo marca en la lista', t.includes('🤖 robot'));
  ok('GENTE: muestra el perfil técnico de cada uno', t.includes('se quedó 180s') && t.includes('acepta avisos'));

  await pg.evaluate(() => setAnaTab('dias'));
  await pg.waitForTimeout(250);
  t = await txt();
  ok('DÍAS: números reales por día, no barritas mudas', t.includes('147') && t.includes('pedidos') && t.includes('conversión'));
  ok('DÍAS: dice el promedio y el mejor día', t.includes('Promedio') && t.includes('mejor día'));
  await pg.evaluate(() => abrirDiaAna('2026-08-26'));
  await pg.waitForTimeout(200);
  t = await txt();
  ok('DÍAS: al abrir un día muestra qué miraron ese día', t.includes('Lo más tocado ese día') && t.includes('Bon O Bon'));

  await pg.evaluate(() => setAnaTab('productos'));
  await pg.waitForTimeout(250);
  t = await txt();
  ok('PRODUCTOS: marca lo que quieren y no tenés', t.includes('SIN STOCK'));
  ok('PRODUCTOS: marca lo que miran y no compran', t.includes('lo miran, no lo compran'));
  ok('PRODUCTOS: muestra las búsquedas sin resultado', t.includes('halva') && t.includes('sin resultado'));

  t = await txt();
  ok('PRODUCTOS: muestra qué se llevan juntos (packs que se arman solos)', t.includes('Qué se llevan juntos') && t.includes('Chocolate Elite'));

  await pg.evaluate(() => setAnaTab('canales'));
  await pg.waitForTimeout(250);
  t = await txt();
  ok('CANALES: de dónde vienen + conversión por canal', t.includes('WhatsApp') && t.includes('Conversión por canal'));
  ok('CANALES: dice la hora pico en criollo', t.includes('21:00'));
  ok('CANDADO: dice a cuántos rechazó y de dónde', t.includes('Rechazados por el candado') && t.includes('IL'));
  ok('CANDADO: muestra a los que entraron igual', t.includes('Tel Aviv'));
  ok('CANDADO: explica POR QUÉ se coló', t.includes('candado:AR'));
  ok('CANDADO: dice qué hora era PARA ÉL', t.includes('allá: mar, 03:30') && t.includes('allá: jue, 10:48'));
  ok('CANDADO: marca cuál no parece persona', t.includes('no parece persona'));
  ok('CANDADO: avisa si entró con el link con pase', t.includes('entró con el pase'));
  ok('CANDADO: aclara que el bloqueado no deja rastro', t.includes('vieron el catálogo'));
  ok('CANDADO: aclara que son dos fuentes distintas', t.includes('IP que ve el servidor'));

  await pg.evaluate(() => abrirFichaVisitante('v_abc'));
  await pg.waitForTimeout(600);
  const ficha = await pg.evaluate(() => { const m = document.getElementById('ana-ficha-modal'); return m ? m.innerText : ''; });
  ok('FICHA: abre con el nombre y el teléfono', ficha.includes('Débora Levy') && ficha.includes('1144556677'));
  ok('FICHA: muestra sus compras anteriores', ficha.includes('Pedido #88'));
  ok('FICHA: muestra el recorrido paso por paso', ficha.includes('Entró a la tienda') && ficha.includes('Empezó el pedido'));
  ok('FICHA: muestra la búsqueda que no encontró nada', ficha.includes('Buscó: halva') && ficha.includes('0 resultados'));
  ok('FICHA: muestra su ficha técnica (huso, idioma, aparato)', ficha.includes('Ficha técnica') && ficha.includes('Buenos_Aires') && ficha.includes('iPhone'));
  ok('FICHA: dice cuánto se quedó', ficha.includes('180 segundos'));
  await pg.evaluate(() => cerrarFichaVisitante());
  const cerrada = await pg.evaluate(() => document.getElementById('ana-ficha-modal').style.display);
  ok('FICHA: cierra bien', cerrada === 'none');

  ok('sin un solo error de JavaScript en toda la recorrida', errs.length === 0);

  let fail = 0;
  console.log('\n── analítica: la vuelta de rosca ─────────────');
  checks.forEach(c => { if (!c.ok) fail++; console.log('  ' + (c.ok ? '✓' : '✗ FALLÓ —') + ' ' + c.n); });
  if (errs.length) console.log('\n  errores JS:', errs.slice(0, 5));
  console.log(fail === 0 ? `\n✅ TODO VERDE — ${checks.length} controles` : `\n❌ ${fail} de ${checks.length} FALLARON`);
  await b.close();
  process.exit(fail ? 1 : 0);
})();
