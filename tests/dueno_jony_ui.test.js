// 🆔 v5.07 — MIRI YA NO EXISTE: en un navegador de verdad y contra el servidor REAL del sitio (motor de mentira).
// ① el alta de producto: el dueño es Jony, fijo, y el pedido al motor dice Jony · ② la ficha: el dueño no se cambia
// (y el guardado no lo manda); la ficha vieja de Miri se ve como tal · ③ clonar: siempre para Jony · ④ la tarjeta del
// pedido #157: el chocolate RENOMBRADO dice JONY (antes MIRI) · ⑤ abrir y guardar ese pedido no le pasa plata a Miri
// ni cambia el stock · ⑥ la tarjeta "Recalcular reparto Jony/Myri" ya no está.
// Uso: node tests/dueno_jony_ui.test.js
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const RAIZ = path.resolve(__dirname, '..');
const SITIO = 'http://127.0.0.1:3199';
const P = (id, nombre, stock, precioMin, extra = {}) => ({ id, nombre, descripcion: 'desc', precio_may: '5', precio_min: precioMin, stock, imagen: '', activo: true, categoria: 'Chocolate', visible_cat: 'Ambos', precio_oferta: 0, fecha_oferta: '', cant_pack: 0, precio_pack: 0, dueno: 'Jony', moneda: 'U$S', unidades_por_paquete: 1, peso: 0, fraccion_de: null, fraccion_cant: null, sueltas: 0, fraccionar_por: 'u', ...extra });
const PRODS = [
  P(1, 'Chocolate Elite', 0, 10000, { dueno: 'Miri', visible_cat: 'Oculto', descripcion: 'Con caramelos explotables (90g) (Igur Harabanim)', precio_may: '5.8' }),
  P(48, 'Pitzujim-Pecán Caramelizadas.', 20, 12000, { moneda: '$', categoria: 'Pitzujim', descripcion: 'Nueces Pecán Caramelizadas Israelíes (100g)', precio_may: '10000' }),
  P(344, 'Chocolate Elite · Blanco con chispas que explotan en la boca (90g)', 19, 11999, { descripcion: 'Chocolate blanco con chispas explotables (90g)', precio_may: '6.5' }),
];
const V = (id, n, productos, su, plata) => ({ id, nVenta: n, fecha: '22/09/2026 01:48', cliente: 'Cliente ' + n, tipo: 'Minorista', productos, formaPago: 'Transferencia', notas: '', estado: 'pendiente', totalARS: 0, totalUSD: 0, arsJONY: 0, arsMyri: 0, usdMyri: 0, usdJONY: 0, comiARS: 0, comiUSD: 0, cajaJony: '', cajaMyri: '', tipoCambio: 0, stockUpdates: su, comprobante: '', ajuste: 0, ...plata });
const VENTAS = [
  V('v157', 157, '• 1x Pitzujim-Pecán Caramelizadas. · Nueces Pecán Caramelizadas Israelíes (100g) — $ 12.000 c/u = $ 12.000 || • 1x Chocolate Elite · Blanco con caramelos explotables (90g) · Chocolate blanco con caramelos explotables (9 — $ 11.999 c/u = $ 11.999', '48:1,344:1', { totalARS: 23999, arsJONY: 23999 }),
  // pedido VIEJO de Miri (julio): su renglón sigue diciendo MIRI — la historia no se toca
  V('v48', 48, '• 1x Chocolate Elite · Con caramelos explotables (90g) (Igur Harabanim) — $ 10.000 c/u = $ 10.000', '1:1', { totalARS: 10000, arsMyri: 10000, comiARS: 1500 }),
];
const esperar = ms => new Promise(r => setTimeout(r, ms));
async function hasta(fn, ms = 6000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await esperar(150); } return false; }

(async () => {
  const mock = spawn('node', [path.join(__dirname, '_mock_motor_auth.mjs')], { stdio: 'ignore' });
  const srv = spawn('node', ['servidor.mjs'], { cwd: path.join(RAIZ, 'despliegue', 'sitio'), stdio: 'ignore', env: { ...process.env, MOTOR_URL: 'http://127.0.0.1:3998/motor', SUPABASE_URL: 'http://127.0.0.1:3998', PUERTO: '3199', RAIZ } });
  process.on('exit', () => { try { srv.kill(); mock.kill(); } catch { /**/ } });
  await esperar(1500);
  const b = await chromium.launch();
  const checks = [], errs = [], motor = [];
  const ok = (n, c) => checks.push({ n, ok: !!c });
  const ctx = await b.newContext({ viewport: { width: +(process.env.ANCHO || 1100), height: 900 }, serviceWorkers: 'block' });
  const pg = await ctx.newPage();
  await pg.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => false }); window.supabase = { createClient: () => ({ auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) } }) }; });
  pg.on('pageerror', e => errs.push(e.message));
  pg.on('dialog', d => d.accept());
  await pg.route('**/*', route => {
    const rq = route.request(), u = rq.url();
    if (u.includes('/functions/v1/api')) {
      const q = Object.fromEntries(new URL(u).searchParams.entries());
      let body = {}; try { body = rq.postData() ? JSON.parse(rq.postData()) : {}; } catch { body = {}; }
      const acc = q.accion || body.accion;
      if (['agregarProducto', 'editarProducto', 'actualizarPedido'].includes(acc)) { motor.push({ acc, ...q, ...body }); return route.fulfill({ contentType: 'application/json', body: '{"ok":true,"id":"900"}' }); }
      if (acc === 'ventas') return route.fulfill({ contentType: 'application/json', body: JSON.stringify(VENTAS) });
      if (acc === 'getEstadoTienda') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ estado: 'abierta' }) });
      return route.fulfill({ contentType: 'application/json', body: '[]' });
    }
    if (/\/rest\/v1\/productos\?/.test(u)) return route.fulfill({ contentType: 'application/json', body: JSON.stringify(PRODS) });
    if (u.startsWith(SITIO)) return route.continue();
    if (u.includes('supabase') || u.includes('ipapi') || u.includes('qrserver') || u.includes('onesignal') || u.includes('bluelytics') || u.includes('cloudinary')) return route.fulfill({ contentType: 'application/json', body: '[]' });
    return route.continue();
  });
  await pg.goto(SITIO + '/tienda', { waitUntil: 'domcontentloaded' });
  await hasta(async () => pg.evaluate(() => typeof productos !== 'undefined' && productos.length >= 3));
  // Jony en el panel. El nombre anterior del #344 llega del endpoint privado (acá se pone a mano).
  const prep = () => pg.evaluate(() => { adminAuth = true; socioActual = 'jony'; const p = productos.find(x => String(x.id) === '344'); if (p) p.nombresPrev = 'Chocolate Elite · Blanco con caramelos explotables (90g)'; });
  await prep();
  await pg.evaluate(() => { try { setModo('admin'); } catch (e) {} try { setAdminTab('panel'); } catch (e) {} setPanelSeccion('stock'); });
  await esperar(800); await prep();

  // ① ALTA
  const alta = await pg.evaluate(() => { const s = document.getElementById('np-dueno'); return { opts: [...s.options].map(o => o.value + '|' + o.textContent), val: s.value, dis: s.disabled }; });
  ok('① Nuevo producto: el dueño muestra SOLO "Jony" (Miri no aparece)', JSON.stringify(alta.opts) === JSON.stringify(['Jony|Jony']));
  ok('① …y viene puesto en Jony y bloqueado', alta.val === 'Jony' && alta.dis);
  await pg.evaluate(() => { document.getElementById('np-nombre').value = 'Chocolate de prueba'; document.getElementById('np-pmin').value = '9999'; document.getElementById('np-visible').value = 'Minorista'; document.getElementById('np-categoria').value = 'Chocolate'; });
  await pg.evaluate(() => guardarNuevoProducto());
  const alt = await (async () => { await hasta(async () => motor.some(m => m.acc === 'agregarProducto')); return motor.find(m => m.acc === 'agregarProducto'); })();
  ok('① al guardar, el motor recibe dueno=Jony', alt && alt.dueno === 'Jony');
  await pg.evaluate(() => { try { setVistaSocio('miri'); } catch (e) {} });
  ok('① en la vista "Solo Miri" también queda Jony (antes forzaba Miri)', await pg.evaluate(() => { const s = document.getElementById('np-dueno'); return s.value === 'Jony' && s.disabled; }));
  await pg.evaluate(() => { try { setVistaSocio('todo'); } catch (e) {} });

  // ② FICHA
  await pg.evaluate(() => irAEditarProducto(344)); await esperar(500);
  const f344 = await pg.evaluate(() => { const s = document.getElementById('ep-dueno'); return { opts: [...s.options].map(o => o.textContent), val: s.value, dis: s.disabled, se: s.offsetHeight > 0 && getComputedStyle(s).display !== 'none' }; });
  ok('② Ficha de Jony: el dueño se VE, dice Jony y no se puede cambiar', f344.se && f344.val === 'Jony' && f344.dis && JSON.stringify(f344.opts) === '["Jony"]');
  motor.length = 0;
  await pg.evaluate(() => guardarEdicionProducto());
  await hasta(async () => motor.some(m => m.acc === 'editarProducto'));
  const ed = motor.find(m => m.acc === 'editarProducto') || {};
  ok('② al guardar la ficha, NO se manda el dueño (no se puede cambiar por ahí)', ed.id === '344' && !('dueno' in ed));
  await pg.evaluate(() => irAEditarProducto(1)); await esperar(500);
  const f1 = await pg.evaluate(() => { const s = document.getElementById('ep-dueno'); return { opts: [...s.options].map(o => o.textContent), dis: s.disabled }; });
  ok('② Ficha VIEJA de Miri: se ve como "Miri · ficha vieja (no se cambia)", bloqueada', f1.dis && f1.opts.length === 1 && f1.opts[0].includes('ficha vieja'));

  // ③ CLONAR
  await pg.evaluate(() => abrirClonarProducto());
  const clon = await pg.evaluate(() => { const s = document.getElementById('clon-dueno'); const r = s ? [...s.options].map(o => o.value) : null; document.getElementById('clon-overlay')?.remove(); return r; });
  ok('③ Clonar la ficha vieja de Miri: el clon es de Jony, sin opción Miri', JSON.stringify(clon) === '["Jony"]');
  await pg.evaluate(() => { try { cerrarEditorProducto(); } catch (e) {} });

  // ④ LA TARJETA DEL PEDIDO
  await pg.evaluate(async () => { await renderPedidos(); });
  await hasta(async () => pg.evaluate(() => !!document.getElementById('pedido-v157')));
  const card = await pg.evaluate(() => { const c = document.getElementById('pedido-v157'); return c ? c.innerText : ''; });
  const renglon = card.split('\n').find(l => l.includes('Blanco con caramelos explotables')) || '';
  ok('④ #157: el chocolate renombrado dice JONY', /JONY/.test(renglon) && !/MIRI/.test(renglon));
  ok('④ #157: ningún renglón del pedido dice MIRI', !/MIRI/.test(card));
  const card48 = await pg.evaluate(() => { const c = document.getElementById('pedido-v48'); return c ? c.innerText : ''; });
  ok('④ pedido VIEJO de Miri (#48): su renglón sigue diciendo MIRI (la historia no se toca)', /MIRI/.test(card48));

  // ⑤ ABRIR Y GUARDAR EL #157 SIN TOCAR NADA
  motor.length = 0;
  await pg.evaluate(async () => { const v = (await apiGet('ventas')).find(x => x.id === 'v157'); abrirEditarPedido(v); });
  const ids = await pg.evaluate(() => _editLineas.map(l => String(l.prodId)));
  ok('⑤ el editor reconoce las fichas que el pedido descontó (48 y 344, no la #1 de Miri)', JSON.stringify(ids) === '["48","344"]');
  await pg.evaluate(() => guardarEditPedido());
  await hasta(async () => motor.some(m => m.acc === 'actualizarPedido'));
  const up = motor.find(m => m.acc === 'actualizarPedido') || {};
  ok('⑤ al guardar: Miri $ 0 · U$S 0 · comisión 0 · Jony $ 23.999', up.arsMyri === '0' && parseFloat(up.usdMyri) === 0 && up.comiARS === '0' && up.arsJONY === '23999');
  ok('⑤ …y el stock queda igual (48:1,344:1, sin mover nada)', up.stockUpdatesNuevo === '48:1,344:1' && !up.stockDeltas);

  // ⑥ LA TARJETA PELIGROSA
  await pg.evaluate(() => { try { setPanelSeccion('dinero'); } catch (e) {} });
  ok('⑥ la tarjeta "Recalcular reparto Jony/Myri" ya no existe', await pg.evaluate(() => ![...document.querySelectorAll('.admin-titulo')].some(t => t.textContent.includes('Recalcular reparto')) && !document.getElementById('migracion-splits-resultado') && typeof previewMigracionSplits === 'undefined' && typeof _recomputeSplit === 'undefined'));

  ok('sin errores de JavaScript', errs.length === 0);
  if (errs.length) console.log('Errores:', errs);
  await b.close(); srv.kill(); mock.kill();
  const mal = checks.filter(c => !c.ok);
  checks.forEach(c => console.log((c.ok ? '  ✓ ' : '  ✗ FALLÓ — ') + c.n));
  console.log(mal.length ? `\n❌ ${mal.length} de ${checks.length} fallaron` : `\n✅ ${checks.length} de ${checks.length}`);
  process.exit(mal.length ? 1 : 0);
})().catch(e => { console.log('ERR', e.message); process.exit(1); });
