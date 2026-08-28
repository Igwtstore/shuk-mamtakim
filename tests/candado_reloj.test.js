// 🕐 EL CANDADO POR RELOJ — el que la VPN no puede esquivar.
// Se entra con navegadores de distintos husos horarios y se mira si ven la tienda o el muro.
// Uso: node tests/candado_reloj.test.js
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const http = require('http');
const HTML = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const server = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(HTML); });
const PROD = [{ id: '1', nombre: 'Chocolate Elite', descripcion: '', precio_may: '5', precio_min: 9000, stock: 10, imagen: '', activo: true, categoria: 'C', visible_cat: 'Ambos', precio_oferta: null, fecha_oferta: null, cant_pack: 0, precio_pack: 0, dueno: 'Jony', moneda: '$', unidades_por_paquete: 1, peso: 0, etiqueta: '', vinculo: '', hashgaja: '', kosher_tipo: '', jalav: '' }];

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const URL_BASE = 'http://127.0.0.1:' + server.address().port + '/';
  const b = await chromium.launch();
  const checks = [];
  const ok = (n, c) => checks.push({ n, ok: !!c });

  // gate: 'mercosur' = candado prendido · 'off' = apagado
  async function visitar({ tz, gate = 'mercosur', pase = false, admin = false }) {
    const ctx = await b.newContext({ timezoneId: tz });
    const pg = await ctx.newPage();
    const tracks = [];
    await pg.addInitScript(() => { window.supabase = { createClient: () => ({ auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) } }) }; });
    if (admin) await pg.addInitScript(() => sessionStorage.setItem('adminAuth', '1'));
    await pg.route('**/*', route => {
      const u = route.request().url();
      if (u.includes('accion=track')) { tracks.push(u); return route.fulfill({ contentType: 'application/json', body: '{"ok":true}' }); }
      if (u.includes('accion=geoGate')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ gate, passHash: 'x' }) });
      if (u.includes('/rest/v1/productos')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify(PROD) });
      if (u.includes('getEstadoTienda')) return route.fulfill({ contentType: 'application/json', body: '{"estado":"abierta","mensaje":"","aviso":""}' });
      if (u.includes('ipapi')) return route.fulfill({ contentType: 'application/json', body: '{"city":"x","region":"x","country_name":"Argentina"}' });
      if (u.includes('supabase') || u.includes('qrserver')) return route.fulfill({ contentType: 'application/json', body: '[]' });
      return route.continue();
    });
    await pg.goto(URL_BASE + (pase ? '?pase=loquesea' : ''), { waitUntil: 'domcontentloaded' });
    await pg.waitForTimeout(1600);
    const txt = await pg.evaluate(() => document.body.innerText);
    const bloqueado = txt.includes('solo para clientes del Mercosur');
    await ctx.close();
    return { bloqueado, tracks };
  }

  // ── Los de casa entran ───────────────────────────────────────────────────
  for (const [tz, lbl] of [['America/Argentina/Buenos_Aires', 'Buenos Aires'], ['America/Argentina/Cordoba', 'Córdoba'],
                           ['America/Montevideo', 'Montevideo'], ['America/Sao_Paulo', 'San Pablo'],
                           ['America/Asuncion', 'Asunción'], ['America/La_Paz', 'La Paz'], ['America/Santiago', 'Santiago']]) {
    const r = await visitar({ tz });
    ok(`${lbl} entra normal`, !r.bloqueado);
  }

  // ── Los de afuera ven el muro ────────────────────────────────────────────
  for (const [tz, lbl] of [['Asia/Jerusalem', 'Tel Aviv'], ['America/New_York', 'Nueva York'],
                           ['Europe/Madrid', 'Madrid'], ['America/Mexico_City', 'México']]) {
    const r = await visitar({ tz });
    ok(`${lbl} ve el muro (aunque su IP diga Argentina)`, r.bloqueado);
  }

  const il = await visitar({ tz: 'Asia/Jerusalem' });
  ok('el rechazo por reloj queda REGISTRADO', il.tracks.some(u => decodeURIComponent(u).includes('reloj:Asia/Jerusalem')));

  // ── Las puertas que tienen que seguir abiertas ───────────────────────────
  ok('con el candado APAGADO, el de Israel entra', !(await visitar({ tz: 'Asia/Jerusalem', gate: 'off' })).bloqueado);
  ok('con el LINK CON PASE, el de Israel entra', !(await visitar({ tz: 'Asia/Jerusalem', pase: true })).bloqueado);
  ok('el DUEÑO nunca queda afuera (ni de viaje)', !(await visitar({ tz: 'Asia/Jerusalem', admin: true })).bloqueado);

  await b.close();
  server.close();
  let fail = 0;
  console.log('\n── candado por reloj ─────────────');
  checks.forEach(c => { if (!c.ok) fail++; console.log('  ' + (c.ok ? '✓' : '✗ FALLÓ —') + ' ' + c.n); });
  console.log(fail === 0 ? `\n✅ TODO VERDE — ${checks.length} controles` : `\n❌ ${fail} de ${checks.length} FALLARON`);
  process.exit(fail ? 1 : 0);
})();
