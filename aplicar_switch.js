// ============================================================================
//  EL SWITCH — convierte las 3 páginas REALES al motor nuevo (Supabase).
//  Misma cirugía verificada del paralelo, sin badge. NO pushea: deja los
//  archivos listos para revisar y commitear.
//
//  Orden del switch (día D):
//    1. SB_KEY=<secret> node resync_completo.js       ← espejo fresco
//    2. node aplicar_switch.js                        ← este script
//    3. node tests/unit/_run.js                       ← blindaje
//    4. git add index.html tienda.html candyshop.html && commit && push
//    5. Prender el cierre diario nuevo:  config cierre_diario_activo = '1'
//    6. Google queda PRENDIDO de red (no se toca) hasta estar verde varios días
//
//  Uso: node aplicar_switch.js          (aplica sobre index/tienda/candyshop.html)
//       node aplicar_switch.js --dry    (escribe *.switch-preview.html sin tocar los reales)
// ============================================================================
const fs = require('fs');

const EF = 'https://soarkknjewgcewryxqac.supabase.co/functions/v1/api';
const GAS = "'https://script.google.com/macros/s/AKfycbxO71AD5tBy1KpWCP0K9-uBEZEc7Qv1ehMv3PA3zDQwngwj7XHMLgIY6M7vWosr7-nc/exec'";
const DRY = process.argv.includes('--dry');

let total = 0;
function rep(src, viejo, nuevo, archivo) {
  if (!src.includes(viejo)) throw new Error(archivo + ': NO ENCONTRADO → ' + viejo.slice(0, 70));
  if (src.split(viejo).length !== 2) throw new Error(archivo + ': NO ÚNICO → ' + viejo.slice(0, 70));
  total++;
  // split/join = reemplazo LITERAL. Con replace(), un "$'" en el texto nuevo (ej: moneda '$')
  // se interpreta como patrón especial y pega el resto del archivo → lo triplicaba.
  return src.split(viejo).join(nuevo);
}

// ── index.html (Shuk tienda + panel): backend + catálogo por REST + merge privado ──
let idx = fs.readFileSync('index.html', 'utf8');
idx = rep(idx, "const APPS_SCRIPT_URL = " + GAS + ";",
  "const APPS_SCRIPT_URL = '" + EF + "';   // motor Supabase (switch " + new Date().toISOString().slice(0, 10) + ")\n" +
  "const SB_REST = 'https://soarkknjewgcewryxqac.supabase.co/rest/v1';\n" +
  "const SB_ANON_H = { apikey: 'sb_publishable_aAZNID-NdaGERYQWe9Uk6w_rmlYSCj2', Authorization: 'Bearer sb_publishable_aAZNID-NdaGERYQWe9Uk6w_rmlYSCj2' };", 'index.html');
idx = rep(idx, `    const r = await fetch(SHEET_URL);
    const text = await r.text();
    const rows = parseCSV(text);
    productos = rows.slice(1).map(r => ({
      id: parseInt(r[0]),
      nombre: r[1],
      desc: r[2],
      precioMay: r[3],
      precioMin: parseFloat((r[4]||'0').replace(',','.')),
      stock: parseInt(r[5]||'0'),
      imagen: r[6],
      activo: (r[7]||'SI').trim().toUpperCase() === 'SI',
      categoria: (r[8]||'Varios').trim(),
      visible: (r[9]||'Ambos').trim(),
      precioOferta: parseFloat((r[10]||'0').replace(',','.')),
      fechaOferta: (r[11]||'').trim(),
      cantPack: parseInt(r[12]||'0'),
      precioPack: parseFloat((r[13]||'0').replace(',','.')),
      dueno: (r[14]||'').trim(),
      visibleOferta: (r[15]||'Ambos').trim(),
      descBot: (r[16]||'').trim(),
      moneda: ((r[17]||'$').trim() === 'U$S') ? 'U$S' : '$',
      candyCod: (r[28]||'').trim(),   // vínculo de stock compartido con Candy (col 29)
      costo: parseFloat((r[29]||'0').toString().replace(',','.')) || 0,   // col 30
      nombresPrev: (r[30]||'').toString().trim()   // col 31: nombres anteriores (historial)
    })).filter(p => p.activo && p.id);`,
`    // Catálogo desde Supabase (columnas públicas; costo/candyCod son privados)
    const r = await fetch(SB_REST + '/productos?select=id,nombre,descripcion,precio_may,precio_min,stock,imagen,activo,categoria,visible_cat,precio_oferta,fecha_oferta,cant_pack,precio_pack,dueno,moneda&order=id', { headers: SB_ANON_H });
    const data = await r.json();
    productos = data.map(p => ({
      id: parseInt(p.id),
      nombre: p.nombre || '',
      desc: p.descripcion || '',
      precioMay: (p.precio_may == null ? '' : p.precio_may).toString(),
      precioMin: parseFloat(p.precio_min) || 0,
      stock: parseInt(p.stock) || 0,
      imagen: p.imagen || '',
      activo: p.activo !== false,
      categoria: (p.categoria || 'Varios').trim(),
      visible: (p.visible_cat || 'Ambos').trim(),
      precioOferta: parseFloat(p.precio_oferta) || 0,
      fechaOferta: (p.fecha_oferta || '').trim(),
      cantPack: parseInt(p.cant_pack) || 0,
      precioPack: parseFloat(p.precio_pack) || 0,
      dueno: (p.dueno || '').trim(),
      visibleOferta: 'Ambos',   // col 16 de la hoja: constante 'Ambos'
      descBot: '',              // privado → se completa abajo con sesión
      moneda: ((p.moneda || '$').trim() === 'U$S') ? 'U$S' : '$',
      candyCod: '',             // privado → se completa abajo con sesión
      costo: 0,                 // privado → se completa abajo con sesión
      nombresPrev: ''           // privado → se completa abajo con sesión
    })).filter(p => p.activo && p.id);
    // Con sesión de admin, completar los campos privados desde el backend
    try {
      let tokP = _authToken;
      try { const g = await _sb.auth.getSession(); tokP = g.data.session?.access_token || tokP; } catch (e) {}
      if (tokP) {
        const full = await fetch(APPS_SCRIPT_URL + '?accion=getProductosAdmin&token=' + encodeURIComponent(tokP)).then(r => r.json());
        const porId = {};
        (Array.isArray(full) ? full : []).forEach(f => porId[String(f.id)] = f);
        productos.forEach(p => {
          const f = porId[String(p.id)];
          if (f) { p.costo = parseFloat(f.costo) || 0; p.descBot = f.descBot || ''; p.nombresPrev = f.nombresPrev || ''; p.candyCod = (f.candyCod || '').trim(); }
        });
      }
    } catch (e) {}`, 'index.html');
idx = rep(idx, `    fetch(SHEET_URL + '&t=' + Date.now()).then(r => r.text()).then(csv => {
      const frescos = {};
      parseCSV(csv).slice(1).forEach(r => { frescos[parseInt(r[0])] = parseInt(r[5]||'0') || 0; });`,
`    fetch(SB_REST + '/productos?select=id,stock&t=' + Date.now(), { headers: SB_ANON_H }).then(r => r.json()).then(data => {
      const frescos = {};
      data.forEach(p => { frescos[parseInt(p.id)] = parseInt(p.stock) || 0; });`, 'index.html');
idx = rep(idx, `    adminAuth = true;
    sessionStorage.setItem('adminAuth', '1');
    localStorage.setItem('shuk_no_track', '1');   // este navegador es del equipo: no cuenta en Analítica
    setSocio(socio);`,
`    adminAuth = true;
    sessionStorage.setItem('adminAuth', '1');
    localStorage.setItem('shuk_no_track', '1');   // este navegador es del equipo: no cuenta en Analítica
    setSocio(socio);
    cargarProductos();   // recargar con la sesión (completa costo/candyCod/descBot)`, 'index.html');

// ── tienda.html + candyshop.html: solo el backend ──
let tnd = fs.readFileSync('tienda.html', 'utf8');
tnd = rep(tnd, "const APPS_URL = " + GAS + ";", "const APPS_URL = '" + EF + "';   // motor Supabase", 'tienda.html');
let csh = fs.readFileSync('candyshop.html', 'utf8');
csh = rep(csh, "const APPS_URL = " + GAS + ";", "const APPS_URL = '" + EF + "';   // motor Supabase", 'candyshop.html');

const suf = DRY ? '.switch-preview.html' : '.html';
fs.writeFileSync('index' + suf, idx);
fs.writeFileSync('tienda' + suf, tnd);
fs.writeFileSync('candyshop' + suf, csh);
for (const f of ['index' + suf, 'tienda' + suf, 'candyshop' + suf]) {
  const resto = fs.readFileSync(f, 'utf8').split('script.google.com').length - 1;
  if (resto) throw new Error(f + ': quedan ' + resto + ' referencias a Google');
}
console.log('✅ Switch ' + (DRY ? 'PREVIEW generado (*.switch-preview.html)' : 'APLICADO a index/tienda/candyshop.html') + ' — ' + total + ' cambios, 0 referencias a Google.');
