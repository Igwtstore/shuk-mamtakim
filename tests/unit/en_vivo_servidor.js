// 🔴 EN VIVO — el módulo del servidor del VPS (despliegue/sitio/en-vivo.mjs), probado de verdad:
// normalización de eventos, ciudad por geo solo si falta, memoria de 30 min, latido solo-vivo,
// y el portero (sesión válida sí, Miri no, token vencido no).
const path = require('path');
const { suite } = require('./_helpers');

async function run() {
  const t = suite();
  const mod = await import(path.join(__dirname, '..', '..', 'despliegue', 'sitio', 'en-vivo.mjs'));
  const { normalizarEvento, paramsParaMotor, crearEnVivo, crearPortero, SOLO_VIVO, VENTANA_MS } = mod;

  // ── normalizarEvento ──
  t.eq('sin vid no hay evento', normalizarEvento({ evento: 'visita' }), null);
  const ev = normalizarEvento({ vid: 'v_abc', evento: 'carrito', producto: 'Klik', carrito: '[{"n":"Klik","q":2,"p":1000}]', total: '2000', totalUSD: '', ciudad: 'Castelar' }, { ahora: 1000, id: 7 });
  t.eq('campos básicos', [ev.vid, ev.evento, ev.pagina, ev.origen, ev.detalle, ev.total, ev.totalUSD, ev.t], ['v_abc', 'carrito', 'tienda', 'directo', 'Klik', 2000, 0, 1000]);
  t.eq('la ciudad que manda la tienda se respeta', [ev.ciudad, !!ev.geoServidor], ['Castelar', false]);
  const sinCiudad = normalizarEvento({ vid: 'v_x' }, { geo: { city: 'Rosario', region: 'S', country: 'AR' } });
  t.eq('sin ciudad, la pone geoip (y el país con nombre)', [sinCiudad.ciudad, sinCiudad.pais, sinCiudad.geoServidor], ['Rosario', 'Argentina', true]);
  const largo = normalizarEvento({ vid: 'v_x', producto: 'a'.repeat(5000), nombre: 'b'.repeat(500) });
  t.ok('los campos tienen tope', largo.detalle.length === 700 && largo.nombre.length === 80);
  const p = paramsParaMotor(ev);
  t.eq('al motor viaja con los nombres de siempre (producto = detalle)', [p.get('accion'), p.get('producto'), p.get('carrito'), p.get('total')], ['track', 'Klik', '[{"n":"Klik","q":2,"p":1000}]', '2000']);
  t.ok('el latido es solo para la pantalla en vivo', SOLO_VIVO.has('latido') && !SOLO_VIVO.has('visita'));

  // ── memoria + suscriptores ──
  let reloj = 1_000_000;
  const vivo = crearEnVivo({ ahora: () => reloj });
  const escritos = [];
  const res = { write: x => escritos.push(x) };
  const salir = vivo.suscribir(res);
  t.ok('al suscribirse recibe "inicio" con la memoria (vacía) y cuántos hay', escritos.some(x => x.startsWith('event: inicio')) && escritos.join('').includes('"conectados":1'));
  const e1 = vivo.registrar(normalizarEvento({ vid: 'v_1', evento: 'visita' }, { ahora: reloj }));
  t.ok('cada evento recibe un id único y llega al suscriptor', e1.id > 0 && escritos.some(x => x.includes('"vid":"v_1"')));
  reloj += VENTANA_MS + 1;
  vivo.registrar(normalizarEvento({ vid: 'v_2', evento: 'visita' }, { ahora: reloj }));
  t.eq('lo de hace más de 30 minutos se olvida', vivo.recientes().map(e => e.vid), ['v_2']);
  salir();
  t.eq('al cerrar la pestaña, deja de contar como conectado', vivo.conectados(), 0);
  let vivoRoto = false;
  const roto = { write: () => { if (vivoRoto) throw new Error('conexión cerrada'); } };
  vivo.suscribir(roto); vivoRoto = true;
  vivo.registrar(normalizarEvento({ vid: 'v_3' }, { ahora: reloj }));
  t.eq('un panel que se cortó sin avisar se saca solo, sin tirar el servidor', vivo.conectados(), 0);
  const muerto = { write: () => { throw new Error('ya cerrado'); } };
  t.eq('un panel que se cortó antes de la primera línea no queda suscripto', (vivo.suscribir(muerto), vivo.conectados()), 0);

  // ── portero ──
  let consultas = 0;
  const fetchFalso = async (url, opts) => {
    consultas++;
    const tok = (opts.headers.Authorization || '').replace('Bearer ', '');
    const mails = { jony: 'admin@shukmamtakim.com', miri: 'myri@shukmamtakim.com', kids: 'kids@candyshop.com' };
    if (!mails[tok]) return { ok: false, json: async () => ({}) };
    return { ok: true, json: async () => ({ email: mails[tok] }) };
  };
  let ahoraP = 0;
  const portero = crearPortero({ sbUrl: 'https://x', anon: 'a', mailMiri: 'myri@shukmamtakim.com', fetchFn: fetchFalso, ahora: () => ahoraP, ttlMs: 1000 });
  t.eq('sin token: afuera', (await portero.puedeVer('')).ok, false);
  t.eq('token inválido: afuera', (await portero.puedeVer('nadie')).ok, false);
  t.eq('Jony: adentro', (await portero.puedeVer('jony')).ok, true);
  t.eq('⚠️ Miri: afuera aunque su sesión sea válida (regla sagrada)', (await portero.puedeVer('miri')).ok, false);
  const antes = consultas; await portero.puedeVer('jony');
  t.eq('el token válido se recuerda (no se consulta Auth otra vez)', consultas, antes);
  ahoraP = 5000; await portero.puedeVer('jony');
  t.eq('pasados 5 minutos se vuelve a consultar', consultas, antes + 1);
  return t.result();
}
module.exports = { run };
