// ↩️ LEVANTAR UN PEDIDO CANCELADO (07/09/2026) — navegador real, datos mock, sin escribir nada.
// Cancelar devolvió la mercadería al depósito: levantar tiene que volver a sacarla, pero SOLO lo
// que hay de verdad hoy. Se verifica la radiografía (qué queda / qué se ajusta / qué se cae), lo
// que se manda a guardar, el recálculo cuando el backend avisa que había menos stock, y que el
// reloj de la reserva de 7 días arranque de nuevo sin ensuciar el remito del cliente.
const { chromium } = require('playwright');
const path = require('path');
const INDEX = 'file://' + path.resolve(__dirname, '..', 'index.html');

const CAT = [
  { id: 1, nombre: 'Chocolate Elite', desc: 'Con caramelos explotables (90g)', dueno: 'Miri', moneda: '$', precioMay: '11999', precioMin: 11999, stock: 12, activo: 'SI', visible: 'Ambos', categoria: 'Chocolate', imagen: '' },
  { id: 2, nombre: 'Klik Test', desc: 'Barra', dueno: 'Miri', moneda: '$', precioMay: '3000', precioMin: 3000, stock: 1, activo: 'SI', visible: 'Ambos', categoria: 'Chocolate', imagen: '' },
  { id: 3, nombre: 'Pitzujim', desc: 'Surtido', dueno: 'Jony', moneda: 'U$S', precioMay: '10', precioMin: 10, stock: 0, activo: 'SI', visible: 'Ambos', categoria: 'Pitzujim', imagen: '' }
];
const PEDIDO = {
  id: 'V77', nVenta: 77, cliente: 'Cliente Test', tipo: 'Mayorista', estado: 'cancelado', fecha: '01/01/2026 10:00',
  notas: 'Timbre 3B', stockUpdates: '', totalARS: 33997, totalUSD: 20, arsMyri: 33997, usdJONY: 20, comiARS: 5100,
  productos: '• 2x Chocolate Elite · Con caramelos explotables (90g) — $ 11.999 c/u = $ 23.998 || • 3x Klik Test · Barra — $ 3.000 c/u = $ 9.000 || • 2x Pitzujim · Surtido — U$S 10.00 c/u = U$S 20.00'
};

(async () => {
  const browser = await chromium.launch();
  const pg = await browser.newPage();
  const errs = []; pg.on('pageerror', e => errs.push(e.message));
  pg.on('dialog', d => d.accept());
  await pg.goto(INDEX, { waitUntil: 'domcontentloaded' });
  await pg.waitForFunction(() => typeof abrirLevantarPedido === 'function' && typeof _planLevantarPedido === 'function', { timeout: 20000 });
  await pg.evaluate(cat => {
    productos = cat;
    // El "levantar" refresca el stock desde la base antes de decidir: se intercepta esa lectura
    // y se devuelve lo que diga window.__stockBase (por defecto, el mismo del catálogo mock).
    window.__stockBase = null;
    const _origFetch = window.fetch;
    window.fetch = async (u, o) => {
      const s = typeof u === 'string' ? u : (u && u.url) || '';
      if (/\/rest\/v1\/productos\?select=id,stock/.test(s)) {
        const base = window.__stockBase || productos.map(p => ({ id: p.id, stock: p.stock }));
        return { ok: true, status: 200, json: async () => base, text: async () => JSON.stringify(base) };
      }
      return _origFetch(u, o);
    };
  }, CAT);

  let okAll = true; const chk = (n, c, e = '') => { if (!c) okAll = false; console.log((c ? '✅' : '❌') + ' ' + n + (e ? ' — ' + e : '')); };

  // ── 1. La radiografía ───────────────────────────────────────────────────────
  const radio = await pg.evaluate(async ped => {
    await abrirLevantarPedido(ped);
    const txt = document.getElementById('levantar-overlay').innerText;
    return { txt, lineas: _lvLineas.map(l => ({ n: l.nombre, pedida: l.pedida, qty: l.qty, motivo: l.motivo })) };
  }, PEDIDO);
  console.log('\n── Radiografía del pedido cancelado ──');
  chk('Hay 12: el chocolate entra entero (2)', radio.lineas[0].qty === 2 && radio.lineas[0].motivo === 'ok', JSON.stringify(radio.lineas[0]));
  chk('Hay 1 de 3: el Klik se ajusta a 1', radio.lineas[1].qty === 1 && radio.lineas[1].motivo === 'ajustada', JSON.stringify(radio.lineas[1]));
  chk('Sin stock: el Pitzujim sale del pedido', radio.lineas[2].qty === 0 && radio.lineas[2].motivo === 'sin-stock', JSON.stringify(radio.lineas[2]));
  chk('La pantalla lo explica en criollo ("quedan 1")', /quedan 1/.test(radio.txt), radio.txt.replace(/\n/g, ' | ').slice(0, 240));
  chk('La pantalla avisa que un renglón sale', /sale del pedido/.test(radio.txt));
  chk('Muestra el total viejo y el nuevo', /33\.997/.test(radio.txt) && /26\.998/.test(radio.txt), radio.txt.replace(/\n/g, ' | ').slice(-160));
  chk('El botón de levantar está habilitado', !/No hay stock de nada/.test(radio.txt));

  // ── 2. Qué se manda a guardar ───────────────────────────────────────────────
  const envio = await pg.evaluate(async () => {
    let url = null;
    const orig = window.fetch;
    // Ojo: después de guardar, el panel refresca solo (más fetch) → guardamos SOLO la del guardado.
    window.fetch = async (u) => {
      const s = typeof u === 'string' ? u : (u && u.url) || '';
      if (/levantarPedido/.test(s) && !url) url = s;
      return { ok: true, status: 200, json: async () => ({ ok: true }), text: async () => '{"ok":true}' };
    };
    await confirmarLevantarPedido();
    window.fetch = orig;
    return { url, stockLocal: productos.map(p => p.stock), overlay: !!document.getElementById('levantar-overlay') };
  });
  const q = new URLSearchParams((envio.url || '').split('?')[1] || '');
  console.log('\n── Lo que viaja al motor ──');
  chk('Va la acción levantarPedido', q.get('accion') === 'levantarPedido', q.get('accion'));
  chk('El pedido queda solo con lo que hay (2 renglones)', (q.get('productos') || '').split(' || ').length === 2, q.get('productos'));
  chk('El Klik va con 1, no con 3', /• 1x Klik Test/.test(q.get('productos') || ''));
  chk('El Pitzujim sin stock no viaja', !/Pitzujim/.test(q.get('productos') || ''));
  chk('Se descuenta exactamente 2 y 1', q.get('stockUpdatesNuevo') === '1:2,2:1', q.get('stockUpdatesNuevo'));
  chk('Total ARS recalculado = 23.998 + 3.000', q.get('totalARS') === '26998', q.get('totalARS'));
  chk('Total USD recalculado = 0 (se cayó el renglón en dólares)', parseFloat(q.get('totalUSD')) === 0, q.get('totalUSD'));
  chk('El reparto sigue a nombre de Miri', q.get('arsMyri') === '26998' && q.get('arsJONY') === '0', q.get('arsMyri') + '/' + q.get('arsJONY'));
  chk('La comisión se recalcula sobre lo que quedó (15%)', q.get('comiARS') === String(Math.round(26998 * 0.15)), q.get('comiARS'));
  chk('El catálogo local ya refleja el descuento (12→10, 1→0)', envio.stockLocal[0] === 10 && envio.stockLocal[1] === 0, JSON.stringify(envio.stockLocal));
  chk('La pantalla se cierra al terminar', !envio.overlay);

  // ── 3. El motor avisa que había MENOS stock del que figuraba ────────────────
  const rehecho = await pg.evaluate(async ped => {
    productos[0].stock = 12; productos[1].stock = 1;
    await abrirLevantarPedido(ped);
    const orig = window.fetch;
    const resp = { error: 'el stock cambió', recalcular: true, faltantes: [{ id: 1, pide: 2, hay: 1 }] };
    window.fetch = async () => ({ ok: true, status: 200, json: async () => resp, text: async () => JSON.stringify(resp) });
    await confirmarLevantarPedido();
    window.fetch = orig;
    const abierto = !!document.getElementById('levantar-overlay');
    return { abierto, lineas: _lvLineas.map(l => ({ qty: l.qty, motivo: l.motivo })), stockLocal: productos.map(p => p.stock) };
  }, PEDIDO);
  console.log('\n── Si el stock cambió mientras confirmabas ──');
  chk('No se cierra: te muestra la cuenta corregida', rehecho.abierto);
  chk('El chocolate se recalcula a 1', rehecho.lineas[0].qty === 1 && rehecho.lineas[0].motivo === 'ajustada', JSON.stringify(rehecho.lineas[0]));
  chk('El Klik sigue en 1', rehecho.lineas[1].qty === 1);
  chk('No se tocó el stock local (no se escribió nada)', rehecho.stockLocal[0] === 12 && rehecho.stockLocal[1] === 1, JSON.stringify(rehecho.stockLocal));

  // ── 4. Pedido sin nada de stock ─────────────────────────────────────────────
  const vacio = await pg.evaluate(async ped => {
    productos.forEach(p => p.stock = 0);
    await abrirLevantarPedido(ped);
    const txt = document.getElementById('levantar-overlay').innerText;
    const btn = document.getElementById('lv-btn-ok');
    return { txt, deshabilitado: !!(btn && btn.disabled) };
  }, PEDIDO);
  console.log('\n── Pedido sin stock de nada ──');
  chk('El botón queda bloqueado', vacio.deshabilitado);
  chk('Lo dice con todas las letras', /No hay stock de nada/.test(vacio.txt));

  // ── 3bis. El panel tiene el stock VIEJO y en el depósito hay más (caso real #146) ──
  // Pasó de verdad: la pantalla decía "no queda nada" de tres productos que tenían 4 en el
  // depósito, porque el panel usaba el catálogo cargado al abrirse. NO puede sacar del pedido
  // algo que sí está en stock.
  const desactualizado = await pg.evaluate(async ped => {
    productos[0].stock = 0; productos[1].stock = 0; productos[2].stock = 0;   // foto vieja del panel
    window.__stockBase = [{ id: 1, stock: 12 }, { id: 2, stock: 9 }, { id: 3, stock: 4 }];   // la base de verdad
    await abrirLevantarPedido(ped);
    const txt = document.getElementById('levantar-overlay').innerText;
    const r = { lineas: _lvLineas.map(l => ({ qty: l.qty, hay: l.hay, motivo: l.motivo })), avisoRojo: /puede estar viejo/.test(txt), stockPanel: productos.map(p => p.stock) };
    document.getElementById('levantar-overlay').remove();
    window.__stockBase = null;
    productos[0].stock = 12; productos[1].stock = 1; productos[2].stock = 0;
    return r;
  }, PEDIDO);
  console.log('\n── Si el panel tenía el stock viejo ──');
  chk('Lee el depósito de verdad y NO saca lo que sí hay', desactualizado.lineas.every(l => l.qty === l.pedida || l.hay > 0), JSON.stringify(desactualizado.lineas));
  chk('El pedido entra completo (2, 3 y 2)', JSON.stringify(desactualizado.lineas.map(l => l.qty)) === '[2,3,2]', JSON.stringify(desactualizado.lineas.map(l => l.qty)));
  chk('Y el catálogo del panel queda actualizado', JSON.stringify(desactualizado.stockPanel) === '[12,9,4]', JSON.stringify(desactualizado.stockPanel));
  chk('Sin aviso rojo cuando el depósito se pudo leer', !desactualizado.avisoRojo);

  // ── 3ter. La × para sacar un renglón a mano (y el ↺ para volver a ponerlo) ──
  const equis = await pg.evaluate(async ped => {
    productos[0].stock = 12; productos[1].stock = 9; productos[2].stock = 4;
    window.__stockBase = [{ id: 1, stock: 12 }, { id: 2, stock: 9 }, { id: 3, stock: 4 }];
    await abrirLevantarPedido(ped);
    const html0 = document.getElementById('levantar-overlay').innerHTML;
    const hayEquis = (html0.match(/_quitarLineaLevantar\(/g) || []).length;
    _quitarLineaLevantar(0);                                  // saco el primer renglón a mano
    const tras = { qty: _lvLineas[0].qty, motivo: _lvLineas[0].motivo, txt: document.getElementById('levantar-overlay').innerText };
    _quitarLineaLevantar(0);                                  // y lo devuelvo
    const vuelto = { qty: _lvLineas[0].qty, motivo: _lvLineas[0].motivo };
    _quitarLineaLevantar(0);
    // lo que se manda a guardar no debe incluir el renglón sacado
    let url = null; const orig = window.fetch;
    window.fetch = async (u) => { const s = typeof u === 'string' ? u : (u && u.url) || ''; if (/levantarPedido/.test(s) && !url) url = s; return { ok: true, status: 200, json: async () => ({ ok: true }), text: async () => '{"ok":true}' }; };
    await confirmarLevantarPedido();
    window.fetch = orig;
    window.__stockBase = null;
    productos[0].stock = 12; productos[1].stock = 1; productos[2].stock = 0;
    return { hayEquis, tras, vuelto, url };
  }, PEDIDO);
  console.log('\n── La × para sacar un renglón a mano ──');
  chk('Cada renglón tiene su botón', equis.hayEquis === 3, 'botones=' + equis.hayEquis);
  chk('La × lo saca del pedido aunque haya stock', equis.tras.qty === 0 && equis.tras.motivo === 'sacada', JSON.stringify(equis.tras.qty + '/' + equis.tras.motivo));
  chk('Se distingue de "no hay stock" ("lo sacaste vos")', /lo sacaste vos/.test(equis.tras.txt));
  chk('El ↺ lo vuelve a poner con lo que hay', equis.vuelto.qty === 2 && equis.vuelto.motivo === 'ok', JSON.stringify(equis.vuelto));
  const qe = new URLSearchParams((equis.url || '').split('?')[1] || '');
  chk('Lo sacado NO viaja en el pedido guardado', !/Chocolate Elite/.test(qe.get('productos') || ''), qe.get('productos'));
  chk('Ni se le descuenta stock', !/^1:/.test(qe.get('stockUpdatesNuevo') || '') , qe.get('stockUpdatesNuevo'));

  // ── 4bis. La tarjeta del pedido cancelado ofrece levantarlo ────────────────
  // El pedido cancelado se llega por TRES caminos distintos y el botón tiene que estar en los
  // tres (el 07/09 faltaba justo en el del buscador, que es el que uno usa para encontrarlo).
  const tarjeta = await pg.evaluate(async ped => {
    productos.forEach(p => p.stock = 5);
    apiGet = async (a) => (a === 'ventas' ? [ped] : []);
    const ver = async (prep) => {
      prep();
      await renderPedidos();
      const html = document.getElementById('pedidos-lista').innerHTML;
      return { levantar: /Levantar pedido/.test(html), cancelarDeNuevo: /Cancelar y devolver stock/.test(html), entregado: /✓ Entregado/.test(html) };
    };
    const normal = await ver(() => { _busquedaPedidos = ''; _filtroEstadoActual = 'todos'; });
    const filtrado = await ver(() => { _busquedaPedidos = ''; _filtroEstadoActual = 'cancelado'; });
    const buscado = await ver(() => { _busquedaPedidos = 'Cliente Test'; _filtroEstadoActual = 'todos'; });
    _busquedaPedidos = '';
    return { normal, filtrado, buscado };
  }, PEDIDO);
  console.log('\n── La tarjeta del pedido cancelado, por los 3 caminos ──');
  chk('En la lista normal (historial) ofrece "↩️ Levantar pedido"', tarjeta.normal.levantar);
  chk('Con el filtro ✕ Cancelado también', tarjeta.filtrado.levantar);
  chk('Y BUSCÁNDOLO por cliente también (el que faltaba)', tarjeta.buscado.levantar);
  chk('Buscándolo NO ofrece "✓ Entregado" de un cancelado', !tarjeta.buscado.entregado);
  chk('Ya no ofrece volver a cancelar lo que está cancelado', !tarjeta.normal.cancelarDeNuevo && !tarjeta.filtrado.cancelarDeNuevo);

  // ── 5. El reloj de la reserva y la nota del cliente ─────────────────────────
  const reloj = await pg.evaluate(() => {
    const hoy = new Date();
    const dd = String(hoy.getDate()).padStart(2, '0') + '/' + String(hoy.getMonth() + 1).padStart(2, '0') + '/' + hoy.getFullYear();
    const vLev = { fecha: '01/01/2026 10:00', notas: '🔁 Levantado el ' + dd + ' · Timbre 3B' };
    const vNormal = { fecha: '01/01/2026 10:00', notas: 'Timbre 3B' };
    return {
      diasLevantado: diasDesdePedido(_fechaReserva(vLev)),
      diasNormal: diasDesdePedido(_fechaReserva(vNormal)),
      notaCliente: _notaCliente(vLev),
      notaManual: _notaCliente({ notas: 'Manual' }),
      notaCotiz: _notaCliente({ notas: '🟡 COTIZACIÓN · Para el shabat' })
    };
  });
  console.log('\n── Reloj de la reserva + nota ──');
  chk('Levantado hoy: el reloj de los 7 días arranca de cero', reloj.diasLevantado === 0, 'días=' + reloj.diasLevantado);
  chk('Un pedido viejo sin levantar sigue contando sus días', reloj.diasNormal > 200, 'días=' + reloj.diasNormal);
  chk('El cliente ve su nota, no el marcador interno', reloj.notaCliente === 'Timbre 3B', reloj.notaCliente);
  chk('"Manual" sigue sin ser una nota', reloj.notaManual === '');
  chk('El prefijo de cotización tampoco llega al remito', reloj.notaCotiz === 'Para el shabat', reloj.notaCotiz);

  const rel = errs.filter(e => /levantar|Levantar|_arm|_plan|identificarLineas/i.test(e));
  chk('Sin errores JS relevantes', rel.length === 0, rel.join('; '));
  await browser.close();
  console.log('\n' + (okAll ? '🟢 LEVANTAR PEDIDO CANCELADO: VERDE' : '🔴 HAY ROJOS'));
  process.exit(okAll ? 0 : 1);
})();
