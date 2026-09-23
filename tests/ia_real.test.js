// Prueba REAL de los dos pedidos a la IA (ficha y pedido por mensaje) con las funciones del motor.
// Uso (con sesión de Supabase: npx supabase login): node tests/ia_real.test.js — gasta unos centavos de IA.
// La clave se lee de la base y nunca se imprime.
const { execSync } = require('child_process');
const fs = require('fs');
const RAIZ = '/Users/antoniojsetton/shuk-mamtakim';
const TS = fs.readFileSync(RAIZ + '/supabase/functions/api/index.ts', 'utf8');
const bloque = (nombre) => { const m = TS.match(new RegExp('function\\s+' + nombre + '\\s*\\(')); let i = m.index + m[0].length, d = 1; while (d > 0) { const c = TS[i++]; if (c === '(') d++; else if (c === ')') d--; } i = TS.indexOf('{', i) + 1; d = 1; while (d > 0) { const c = TS[i++]; if (c === '{') d++; else if (c === '}') d--; } return TS.slice(m.index, i); };
const constante = (nombre) => { const ini = TS.indexOf('const ' + nombre + ' = '); let d = 0, q = ''; for (let i = ini; i < TS.length; i++) { const c = TS[i]; if (q) { if (c === '\\') { i++; continue; } if (c === q) q = ''; continue; } if ("'\"`".includes(c)) { q = c; continue; } if ('([{'.includes(c)) d++; else if (')]}'.includes(c)) d--; else if (c === ';' && d === 0) return TS.slice(ini, i + 1); } };
const sinTipos = s => s.replace(/: string\[\]/g, '').replace(/: any\[\]/g, '').replace(/: any/g, '').replace(/: string/g, '').replace(/: number/g, '');
const F = new Function(sinTipos([bloque('fotoShukUrl'), constante('fotosShukLista'), constante('FICHA_IA_SCHEMA'), constante('PEDIDO_IA_SCHEMA'), bloque('pedidoFichaIA'), bloque('fotoParaIA'), bloque('pedidoMensajeIA'), bloque('limpiarPedidoIA')].join('\n')) + '\nreturn { pedidoFichaIA, fotoParaIA, pedidoMensajeIA, limpiarPedidoIA };')();
(async () => {
  const out = execSync(`cd ${RAIZ} && npx supabase db query --linked "select valor from config where clave='ANTHROPIC_API_KEY'" -o json`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
  const key = (JSON.parse(out).rows[0] || {}).valor;
  if (!key) { console.log('no encontré la clave'); return; }
  const html = fs.readFileSync(RAIZ + '/index.html', 'utf8');
  const anon = html.match(/apikey: '([^']+)'/)[1];
  const prods = await (await fetch('https://soarkknjewgcewryxqac.supabase.co/rest/v1/productos?select=id,nombre,descripcion,categoria,imagen,precio_min,hashgaja,kosher_tipo,activo,stock&order=id', { headers: { apikey: anon, Authorization: 'Bearer ' + anon } })).json();
  const llamar = async (payload) => {
    const t0 = Date.now();
    const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-beta': 'server-side-fallback-2026-07-01', 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const body = await r.json();
    let texto = ''; (body.content || []).forEach(b => { if (b.type === 'text') texto += b.text; });
    return { code: r.status, body, texto, seg: ((Date.now() - t0) / 1000).toFixed(1) };
  };
  // 1) Ficha: un producto real que se ve y no se agarra (con foto)
  const p = prods.find(x => /Milka · Oreo$/.test(x.nombre)) || prods.find(x => x.imagen && x.stock > 0);
  const ejemplos = prods.filter(x => x.activo !== false && x.id !== p.id && x.descripcion).slice(0, 14).map(x => '- ' + x.nombre + ' · ' + x.descripcion);
  const r1 = await llamar(F.pedidoFichaIA(p, ejemplos, 'La vieron 12 personas en el último mes y nadie la puso en el carrito.', F.fotoParaIA(p.imagen)));
  console.log('FICHA', r1.code, r1.seg + ' s', 'stop:', r1.body.stop_reason, 'modelo:', r1.body.model);
  if (r1.code === 200) console.log(JSON.stringify(JSON.parse(r1.texto), null, 1)); else console.log(JSON.stringify(r1.body).slice(0, 400));
  // 2) Pedido por mensaje
  const act = prods.filter(x => x.activo !== false);
  const r2 = await llamar(F.pedidoMensajeIA(act, 'hola! mandame 12 klik de leche, 24 barritas pesek zman, 5 pitzujim de maní y 2 alfajores havanna 🙏 soy Sarah', null));
  console.log('PEDIDO', r2.code, r2.seg + ' s', 'stop:', r2.body.stop_reason, 'modelo:', r2.body.model);
  if (r2.code === 200) console.log(JSON.stringify(F.limpiarPedidoIA(JSON.parse(r2.texto), act), null, 1)); else console.log(JSON.stringify(r2.body).slice(0, 400));
})().catch(e => console.log('ERROR', e.message));
