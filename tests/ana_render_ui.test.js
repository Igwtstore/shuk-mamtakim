// Verifica que renderAnalitica() del panel dibuje las secciones nuevas sin errores de JS,
// usando los datos REALES de getAnalitica (interceptados). Carga el index.html local.
const { chromium } = require('playwright');
const { _motor } = require('./unit/vidriera.js');   // la función REAL analitica() del motor
const path = require('path');
const INDEX = 'file://' + path.resolve(__dirname, '..', 'index.html');
const APPS = 'https://soarkknjewgcewryxqac.supabase.co/functions/v1/api';   // v4.83: el motor de Supabase (antes apuntaba al Apps Script muerto)


// Visitas inventadas que cubren todas las secciones: canales, carritos, búsquedas (con y sin resultado), checkout con
// nombre y teléfono, pedidos, quitados, salidas; un cliente conocido que vuelve; ventas para comparar.
function datosDePrueba() {
  const f = (d, h, m = 15) => { const x = new Date(Date.now() - d * 86400000); return String(x.getDate()).padStart(2, '0') + '/' + String(x.getMonth() + 1).padStart(2, '0') + '/' + x.getFullYear() + ' ' + String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0'); };
  const PR = [{ id: 1, nombre: 'Klik azul', stock: 8, activo: true, dueno: 'Jony', categoria: 'Chocolate' }, { id: 2, nombre: 'Bamba Osem', stock: 0, activo: true, dueno: 'Jony', categoria: 'Snacks' }, { id: 3, nombre: 'Pitzujim Grill', stock: 20, activo: true, dueno: 'Jony', categoria: 'Pitzujim' }];
  const ORIG = ['directo', 'whatsapp', 'instagram', 'google', 'wa-estado'];
  const rows = [];
  for (let d = 0; d < 25; d++) for (let n = 0; n < 6; n++) {
    const vid = 'v_prueba' + d + 'x' + n, o = ORIG[(d + n) % ORIG.length];
    const b = { vid, pagina: 'tienda', origen: o, dispositivo: n % 2 ? 'celular' : 'compu', ciudad: 'Buenos Aires', region: '', pais: 'AR', nombre: '', telefono: '', detalle: '', carrito: '', total: 0 };
    rows.push({ ...b, fecha: f(d, 10 + n), evento: 'visita' });
    if (n % 2 === 0) rows.push({ ...b, fecha: f(d, 10 + n, 20), evento: 'busqueda', detalle: n === 0 ? 'bamba' : 'turron', total: n === 0 ? '1' : '0' });
    if (n < 4) rows.push({ ...b, fecha: f(d, 10 + n, 25), evento: 'carrito', detalle: 'Klik azul', carrito: JSON.stringify([{ n: 'Klik azul', q: 2, p: 1500, m: '$' }]), total: '3000' });
    if (n === 1) rows.push({ ...b, fecha: f(d, 10 + n, 27), evento: 'quitar', detalle: 'Klik azul' });
    if (n < 3) rows.push({ ...b, fecha: f(d, 10 + n, 30), evento: 'checkout', nombre: 'Cliente Prueba ' + n, telefono: '54911000000' + n, carrito: JSON.stringify([{ n: 'Klik azul', q: 2, p: 1500, m: '$' }]), total: '3000' });
    if (n === 0) rows.push({ ...b, fecha: f(d, 10 + n, 35), evento: 'pedido', nombre: 'Cliente Prueba 0', telefono: '549110000000', carrito: JSON.stringify([{ n: 'Klik azul', q: 2, p: 1500, m: '$' }]), total: '3000' });
    rows.push({ ...b, fecha: f(d, 10 + n, 40), evento: 'salida' });
  }
  const ventas = [0, 3, 7].map((d, i) => ({ n_venta: 100 + i, fecha: f(d, 11), cliente: 'Cliente Prueba 0', productos: 'Klik azul x2 ($1.500)', total_ars: 3000, estado: 'entregado', stock_updates: '1:2' }));
  const clientes = [{ nombre: 'Cliente Prueba 0', telefono: '549110000000', tipo: 'Minorista' }];
  return _motor.analitica(rows, 30, ventas, clientes, PR, null, {});
}

(async () => {
  // 1) Los datos: la función REAL analitica() del motor sobre visitas INVENTADAS (v4.97). Antes se bajaba la
  //    Analítica real con la cuenta de los chicos; desde v4.96 esa cuenta ya no puede verla (era un agujero), y una
  //    prueba no tiene por qué leer datos de clientes de verdad.
  const data = datosDePrueba();

  const b = await chromium.launch();
  const pg = await b.newPage();
  // En file:// no carga el CDN de supabase → lo stubeamos para replicar prod (donde sí existe).
  await pg.addInitScript(() => {
    window.supabase = { createClient: () => ({ auth: {
      getSession: async () => ({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe(){} } } })
    } }) };
  });
  const errs = [];
  pg.on('pageerror', e => errs.push(e.message));
  await pg.route('**/*', route => {
    const url = route.request().url();
    if (url.includes('getAnalitica')) return route.fulfill({ contentType:'application/json', body: JSON.stringify(data) });
    if (url.includes('script.google.com') || url.includes('supabase')) return route.fulfill({ contentType:'application/json', body: '[]' });
    return route.continue();
  });
  await pg.goto(INDEX, { waitUntil: 'domcontentloaded' }).catch(()=>{});
  await pg.waitForTimeout(400);

  // v4.83: desde la v4.69 la Analítica son pestañas; se dibuja cada una y se junta el texto.
  const out = await pg.evaluate(async () => {
    try { adminAuth = true; socioActual = 'jony'; await renderAnalitica(); } catch (e) { return { err: e.message }; }
    let html = '';
    for (const t of ['hoy', 'carritos', 'gente', 'dias', 'productos', 'canales']) { try { setAnaTab(t); } catch (e) { return { err: t + ': ' + e.message }; } html += '\n' + document.getElementById('analitica-contenido').innerHTML; }
    return { html };
  });
  if (out.err) { console.log('❌ renderAnalitica tiró error:', out.err); await b.close(); process.exit(1); }

  const html = out.html;
  const secciones = ['Resumen del período', 'Comparado con', 'Embudo de conversión', 'Carritos sin terminar', 'Toda la gente que entró',
                     'Día por día', 'Lo que quieren contra lo que se vendió', 'Qué buscan en la tienda', 'De dónde vienen', 'Conversión por canal', 'Visitantes identificados', 'Links por canal', 'Avisos al celular'];
  let okAll = true;
  secciones.forEach(s => { const ok = html.includes(s); if(!ok) okAll=false; console.log((ok?'✅':'❌')+' sección: '+s); });

  // export CSV no debe tirar error
  const csvOk = await pg.evaluate(() => { try { window.URL.createObjectURL = () => 'blob:x'; descargarAnaCSV('leads'); descargarAnaCSV('abandonados'); return true; } catch(e){ return e.message; } });
  console.log((csvOk===true?'✅':'❌')+' descargarAnaCSV sin error' + (csvOk===true?'':' — '+csvOk));
  if (csvOk!==true) okAll=false;

  console.log('errores JS de página:', errs.filter(e=>/renderAnalitica|descargarAna|_anaData|topProductos|comparativa/.test(e)).length, '(relevantes)');
  await b.close();
  console.log('\n' + (okAll ? '🟢 ANALÍTICA UI VERDE' : '🔴 FALLAS'));
  process.exit(okAll ? 0 : 1);
})().catch(e => { console.log('ERR', e.message); process.exit(1); });
