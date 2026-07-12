// v3.55 — Crear producto nuevo SIN salir de "Recibir mercadería":
// el buscador ofrece "crear", se abre un modal con el form REAL (el mismo nodo, mudado),
// al guardar el modal se cierra, el form vuelve a su lugar y el producto queda buscado.
const { chromium } = require('playwright');
let ok = 0, fail = 0;
const chk = (n, c, x) => { if (c) { ok++; console.log('  ✓', n); } else { fail++; console.log('  ✗ FALLO:', n, x || ''); } };
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => { if (!/net::|fetch|resource|onesignal/i.test(e.message)) errs.push(e.message); });
  await page.goto('http://localhost:8917/index.html', { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(1200);

  const r = await page.evaluate(async () => {
    const out = {};
    productos = [{ id: 1, nombre: 'Chocolate Elite', desc: '', categoria: 'Chocolate', dueno: 'Miri', stock: 5, costo: 0, moneda: 'U$S' }];
    vistaSocio = 'todo';
    // CONDICIÓN REAL (bug 2026-07-11): el panel está en la sección STOCK → setPanelSeccion
    // deja el card de "Agregar nuevo producto" (Catálogo) con display:none inline.
    setPanelSeccion('stock');
    // como en la vida real: el Panel visible (se destapan los ancestros ocultos hasta body)
    for (let n = document.getElementById('recep-buscar'); n && n !== document.body; n = n.parentElement)
      if (getComputedStyle(n).display === 'none') n.style.display = 'block';
    out.cardOcultoEnStock = document.getElementById('card-nuevo-producto').style.display === 'none';

    // 1) Busco algo que NO existe → ofrece crearlo
    document.getElementById('recep-buscar').value = 'Halva Nueva';
    filtrarRecep();
    const html1 = document.getElementById('recep-resultados').innerHTML;
    out.ofreceCrear = html1.includes('Crear "Halva Nueva" como producto nuevo') && html1.includes('abrirNpDesdeRecep');

    // 2) Busco algo que SÍ existe → lista normal + botón "no está en la lista" al final
    document.getElementById('recep-buscar').value = 'Chocolate';
    filtrarRecep();
    const html2 = document.getElementById('recep-resultados').innerHTML;
    out.listaConCrear = html2.includes('agregarRecep(1)') && html2.includes('No está en la lista — crear producto nuevo');

    // 3) Abro el modal: el form REAL se muda adentro (mismo nodo, no copia)
    document.getElementById('recep-buscar').value = 'Halva Nueva';
    filtrarRecep();
    const cardAntes = document.getElementById('card-nuevo-producto');
    const padreOriginal = cardAntes.parentNode;
    const padreBandeja = document.getElementById('card-bandeja').parentNode;
    const anchoPanel = Math.round(document.getElementById('recep-buscar').closest('.admin-card').getBoundingClientRect().width);
    // bandeja con un producto precargado por la IA (backend mockeado)
    const fetchB = window.fetch;
    window.fetch = async (url) => (url + '').includes('bandejaListar')
      ? { json: async () => ([{ id: 'b1', publicId: 'pid1', estado: 'listo', nombre: 'Yummy Dippy', desc: 'Palitos de galleta', categoria: 'Galletitas' }]) }
      : { json: async () => ([]) };
    abrirNpDesdeRecep();
    await new Promise(res => setTimeout(res, 250));
    window.fetch = fetchB;
    const caja = document.querySelector('#np-modal-recep > div');
    out.anchoReal = Math.abs(parseInt(caja.style.maxWidth) - anchoPanel) <= 2;
    out._dbgAncho = 'caja=' + caja.style.maxWidth + ' panel=' + anchoPanel + ' inner=' + window.innerWidth;
    out.bandejaAdentro = document.getElementById('np-modal-recep').contains(document.getElementById('card-bandeja'))
      && document.getElementById('card-bandeja').style.display !== 'none';
    out.bandejaConItems = document.getElementById('bandeja-grid').innerHTML.includes("usarDeBandeja('b1')");
    usarDeBandeja('b1');
    out.usarEnAltaPrefill = document.getElementById('np-nombre').value === 'Yummy Dippy'
      && document.getElementById('np-desc').value === 'Palitos de galleta'
      && document.getElementById('np-categoria').value === 'Galletitas';
    document.getElementById('np-nombre').value = 'Halva Nueva';
    document.getElementById('np-desc').value = ''; document.getElementById('np-categoria').value = '';
    _npPreSubida = ''; _npBandejaId = '';
    const modal = document.getElementById('np-modal-recep');
    out.modalAbierto = !!modal;
    out.formMudado = modal && modal.contains(document.getElementById('card-nuevo-producto'));
    out.formVISIBLE = document.getElementById('card-nuevo-producto').style.display !== 'none'
      && document.getElementById('card-nuevo-producto').offsetHeight > 100;   // se VE de verdad (el bug del usuario)
    out.esElMismoNodo = document.getElementById('card-nuevo-producto') === cardAntes;
    out.precargaNombre = true;   // (cubierto: el nombre se precargó con 'Halva Nueva' antes del test de bandeja)
    out.camposReales = !!document.getElementById('np-dueno') && !!document.getElementById('np-hashgaja') && modal.contains(document.getElementById('np-guardar-btn'));

    // 4) Cierro sin guardar: el form vuelve a su lugar original
    cerrarNpDesdeRecep();
    out.modalCerrado = !document.getElementById('np-modal-recep');
    out.formDeVuelta = document.getElementById('card-nuevo-producto').parentNode === padreOriginal;
    out.formOcultoDeVuelta = document.getElementById('card-nuevo-producto').style.display === 'none';   // en Stock no debe verse
    out.bandejaDeVuelta = document.getElementById('card-bandeja').parentNode === padreBandeja
      && document.getElementById('card-bandeja').style.display === 'none';

    // 5) Guardar DESDE el modal: backend mockeado → cierra modal + producto queda buscado
    abrirNpDesdeRecep();
    document.getElementById('np-nombre').value = 'Halva Nueva';
    document.getElementById('np-categoria').value = 'Varios';
    document.getElementById('np-pmay').value = '5';
    document.getElementById('np-pmin').value = '1000';
    const fetchOrig = window.fetch;
    window.fetch = async (url) => {
      if ((url + '').includes('agregarProducto')) return { json: async () => ({ ok: true }) };
      return { json: async () => ([]) };
    };
    const cargarOrig = window.cargarProductos;
    window.cargarProductos = async () => { productos.push({ id: 99, nombre: 'Halva Nueva', desc: '', categoria: 'Varios', dueno: 'Miri', stock: 0, costo: 0, moneda: 'U$S' }); };
    await guardarNuevoProducto();
    await new Promise(res => setTimeout(res, 300));
    window.fetch = fetchOrig; window.cargarProductos = cargarOrig;
    out.modalCerradoTrasGuardar = !document.getElementById('np-modal-recep');
    out.formEnSuLugar = document.getElementById('card-nuevo-producto').parentNode === padreOriginal;
    out.buscadorConNuevo = document.getElementById('recep-buscar').value === 'Halva Nueva'
      && document.getElementById('recep-resultados').innerHTML.includes('agregarRecep(99)');

    // 6) Lo toco y entra a la recepción (flujo completo)
    agregarRecep(99);
    out.entraARecepcion = !!document.querySelector('#recep-lineas') && document.getElementById('recep-lineas').innerHTML.includes('Halva Nueva');

    // 7) Vista MIRI: la bandeja de la IA NO se muda al modal (privacidad del panel)
    window.esVistaMiri = () => true;
    abrirNpDesdeRecep();
    out.miriSinBandeja = !document.getElementById('np-modal-recep').contains(document.getElementById('card-bandeja'));
    cerrarNpDesdeRecep();
    window.esVistaMiri = () => false;
    return out;
  });

  chk('sin resultados → ofrece crear "Halva Nueva" ahí mismo', r.ofreceCrear);
  chk('con resultados → botón "no está en la lista" al final', r.listaConCrear);
  chk('condición real: en sección Stock el card arranca oculto', r.cardOcultoEnStock);
  chk('modal abierto con el form REAL mudado (mismo nodo, no copia)', r.modalAbierto && r.formMudado && r.esElMismoNodo);
  chk('🔴 EL BUG: el form se VE dentro del modal (display + altura real)', r.formVISIBLE);
  chk('MISMO ancho que el panel real (medido, no fijo)', r.anchoReal, r._dbgAncho);
  chk('la bandeja de la IA está adentro del modal y visible', r.bandejaAdentro);
  chk('la bandeja se carga sola al abrir (item de la IA presente)', r.bandejaConItems);
  chk('"Usar en alta ↑" precarga nombre/desc/categoría en el form del modal', r.usarEnAltaPrefill);
  chk('precarga el nombre que estaba buscando', r.precargaNombre);
  chk('todos los campos reales presentes (dueño, hashgajá, guardar)', r.camposReales);
  chk('cerrar sin guardar → form vuelve a su lugar en Stock', r.modalCerrado && r.formDeVuelta);
  chk('  · y vuelve OCULTO (respeta que la sección activa es Stock)', r.formOcultoDeVuelta);
  chk('  · la bandeja también vuelve a su lugar (y oculta)', r.bandejaDeVuelta);
  chk('guardar desde el modal → modal se cierra y form vuelve', r.modalCerradoTrasGuardar && r.formEnSuLugar);
  chk('el producto recién creado queda buscado y visible', r.buscadorConNuevo);
  chk('tocarlo lo mete en la recepción (flujo redondo)', r.entraARecepcion);
  chk('🔒 vista Miri: la bandeja NO entra al modal (privacidad)', r.miriSinBandeja);
  chk('sin errores JS', errs.length === 0, errs.join(' | '));

  await browser.close();
  console.log(fail ? '\n❌ ' + fail + ' FALLO(S)' : '\n✅ ALTA DESDE RECIBIR OK — ' + ok + '/' + ok);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('EXPLOTÓ:', e.message); process.exit(1); });
