// ✂️ v5.03 — prueba de las fracciones CONTRA LA BASE REAL, sin dejar nada escrito: todo corre dentro de una
// transacción que termina en un error a propósito (RAISE) → Postgres deshace todo. Los resultados viajan en el
// mensaje del error. Usa fichas de prueba T90xx inactivas que nunca llegan a existir.
// Uso: node tests/fracciones_sql.test.js   (necesita la sesión del CLI de Supabase: `npx supabase login`)
// CON_MIGRACION=1 node tests/fracciones_sql.test.js → prueba supabase_fracciones.sql ANTES de aplicarlo (también se deshace).
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const SQL = `
do $$
declare r jsonb := '{}'::jsonb; j json;
begin
  insert into productos (id,nombre,stock,activo,categoria,dueno,moneda,precio_min,costo,unidades_por_paquete,visible_cat,visible)
    values ('T9001','ZZ prueba bolsa x18',2,false,'Varios','Jony','U$S',30000,18,18,'Ambos',false);
  insert into productos (id,nombre,stock,activo,categoria,dueno,moneda,precio_min,fraccion_de,fraccion_cant,visible_cat,visible,precio_may)
    values ('T9002','ZZ prueba x3',777,false,'Varios','Miri','$',6000,'T9001',3,'Ambos',false,99),
           ('T9003','ZZ prueba x4',777,false,'Varios','Miri','$',7500,'T9001',4,'Mayorista',false,null);
  r := r || jsonb_build_object('alta', (select jsonb_object_agg(id, jsonb_build_object('st',stock,'c',costo,'m',moneda,'d',dueno,'upp',unidades_por_paquete,'vis',visible_cat,'pm',precio_may)) from productos where id like 'T900%'));
  j := mover_stock('T9002', -1);
  r := r || jsonb_build_object('rpcX3', j::jsonb, 'trasX3', (select jsonb_object_agg(id, jsonb_build_array(stock, sueltas)) from productos where id like 'T900%'));
  j := mover_stock('T9003', -1);
  r := r || jsonb_build_object('trasX4', (select jsonb_object_agg(id, jsonb_build_array(stock, sueltas)) from productos where id like 'T900%'));
  j := mover_stock('T9001', -1);
  r := r || jsonb_build_object('rpcBolsa', j::jsonb, 'trasBolsa', (select jsonb_object_agg(id, jsonb_build_array(stock, sueltas)) from productos where id like 'T900%'));
  j := mover_stock('T9002', 1);
  r := r || jsonb_build_object('trasCancelar', (select jsonb_object_agg(id, jsonb_build_array(stock, sueltas)) from productos where id like 'T900%'));
  update productos set stock = 99, costo = 1 where id = 'T9002';
  update productos set costo = 36 where id = 'T9001';
  r := r || jsonb_build_object('trasManual', (select jsonb_object_agg(id, jsonb_build_array(stock, costo)) from productos where id like 'T900%'));
  update productos set stock = stock + 3 where id = 'T9001';
  r := r || jsonb_build_object('trasRecepcion', (select jsonb_object_agg(id, jsonb_build_array(stock, sueltas)) from productos where id like 'T900%'));
  j := mover_stock('T9003', -5);   -- 20 unidades con 14 sueltas: abre 1 bolsa
  r := r || jsonb_build_object('rpcAbre', j::jsonb);
  begin
    insert into productos (id,nombre,stock,activo,fraccion_de,fraccion_cant) values ('T9004','ZZ mala',0,false,'T9002',2);
    r := r || '{"fracDeFrac":"permitido"}'::jsonb;
  exception when others then r := r || jsonb_build_object('fracDeFrac', sqlerrm);
  end;
  -- ⚖️ v5.05: por PESO — 10 bolsitas de 100 g (1 kg) a $ 5.000 c/u; fracciones de 250 g y de 1 kg
  insert into productos (id,nombre,stock,activo,categoria,dueno,moneda,precio_min,costo,unidades_por_paquete,peso,fraccionar_por,visible_cat,visible)
    values ('T9101','ZZ prueba pitzujim 100 g',10,false,'Pitzujim','Jony','$',9999,5000,1,100,'g','Ambos',false);
  insert into productos (id,nombre,stock,activo,categoria,precio_min,fraccion_de,fraccion_cant,visible)
    values ('T9102','ZZ prueba 250 g',0,false,'Pitzujim',24000,'T9101',250,false), ('T9103','ZZ prueba 1 kg',0,false,'Pitzujim',90000,'T9101',1000,false);
  r := r || jsonb_build_object('gAlta', (select jsonb_object_agg(id, jsonb_build_object('st',stock,'c',costo,'upp',unidades_por_paquete,'por',fraccionar_por)) from productos where id like 'T910%'));
  j := mover_stock('T9102', -1);   -- 250 g: no hay sueltos → abre 3 bolsitas (300 g) y sobran 50 g
  r := r || jsonb_build_object('gRpc', j::jsonb, 'gTras', (select jsonb_object_agg(id, jsonb_build_array(stock, sueltas)) from productos where id like 'T910%'));
  j := mover_stock('T9102', 1);    -- cancelan: vuelven 250 g sueltos
  r := r || jsonb_build_object('gCancel', (select jsonb_object_agg(id, jsonb_build_array(stock, sueltas)) from productos where id like 'T910%'));
  update productos set peso = 200 where id = 'T9101';   -- si la bolsita pesara 200 g, todo se recalcula
  r := r || jsonb_build_object('gPeso', (select jsonb_object_agg(id, jsonb_build_array(stock, costo)) from productos where id like 'T910%'));
  j := mover_stock('T9999', -1);
  r := r || jsonb_build_object('noExiste', coalesce(j::text, 'null'));
  raise exception 'RESULTADO%FIN', r::text;
end $$;`;

function correr() {
  const tmp = path.join(os.tmpdir(), 'fracciones_prueba_' + process.pid + '.sql');
  fs.writeFileSync(tmp, process.env.CON_MIGRACION ? 'begin;\n' + fs.readFileSync(path.join(__dirname, '..', 'supabase_fracciones.sql'), 'utf8') + '\n' + SQL : SQL);
  let salida = '';
  try { salida = execFileSync('npx', ['supabase', 'db', 'query', '--linked', '-f', tmp], { cwd: path.join(__dirname, '..'), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (e) { salida = String(e.stdout || '') + String(e.stderr || ''); }
  finally { fs.unlinkSync(tmp); }
  const m = salida.replace(/\\\\"/g, '"').replace(/\\"/g, '"').match(/RESULTADO(\{.*\})FIN/);
  if (!m) throw new Error('no vino el resultado: ' + salida.slice(0, 400));
  return JSON.parse(m[1]);
}

const R = correr();
let ok = 0, mal = 0;
const eq = (n, a, b) => { const bien = JSON.stringify(a) === JSON.stringify(b); bien ? ok++ : mal++; console.log((bien ? '  ✓ ' : '  ✗ FALLÓ — ') + n + (bien ? '' : '  (vino ' + JSON.stringify(a) + ', esperaba ' + JSON.stringify(b) + ')')); };
const A = R.alta;
eq('alta: 2 bolsas de 18 → x3 tiene 12', A.T9002.st, 12);
eq('alta: → x4 tiene 9', A.T9003.st, 9);
eq('alta: costo x3 = U$S 3 (18 ÷ 18 × 3)', +A.T9002.c, 3);
eq('alta: costo x4 = U$S 4', +A.T9003.c, 4);
eq('alta: moneda y dueño salen de la bolsa (se ignoró lo mandado)', [A.T9002.m, A.T9002.d], ['U$S', 'Jony']);
eq('alta: solo minorista, sin precio mayorista', [A.T9002.vis, A.T9003.vis, A.T9002.pm], ['Minorista', 'Minorista', null]);
eq('alta: U/paq de la fracción = su cantidad', [A.T9002.upp, A.T9003.upp], [3, 4]);
eq('venta x3: se abre 1 bolsa (antes 12 → 11)', [R.rpcX3.antes, R.rpcX3.despues, R.rpcX3.abiertas], [12, 11, 1]);
eq('venta x3: 1 cerrada + 15 sueltas · x3 11 · x4 8', R.trasX3, { T9001: [1, 15], T9002: [11, 0], T9003: [8, 0] });
eq('venta x4: 11 sueltas · x3 9 · x4 7', R.trasX4, { T9001: [1, 11], T9002: [9, 0], T9003: [7, 0] });
eq('venta de la bolsa entera: 0 cerradas · x3 3 · x4 2', R.trasBolsa, { T9001: [0, 11], T9002: [3, 0], T9003: [2, 0] });
eq('la bolsa entera se mueve como un producto normal', R.rpcBolsa.fraccion, false);
eq('cancelan la x3: vuelve como 3 sueltas', R.trasCancelar, { T9001: [0, 14], T9002: [4, 0], T9003: [3, 0] });
eq('stock/costo cargados a mano en la fracción se ignoran; costo de la bolsa 36 → x3 = 6', { x3: R.trasManual.T9002.map(Number), x4: R.trasManual.T9003.map(Number) }, { x3: [4, 6], x4: [3, 8] });
eq('llegan 3 bolsas: (3×18+14) → x3 22 · x4 17', R.trasRecepcion, { T9001: [3, 14], T9002: [22, 0], T9003: [17, 0] });
eq('5 x4 (20 u.) con 14 sueltas: abre 1 bolsa y quedan 12 sueltas', [R.rpcAbre.abiertas, R.rpcAbre.cerradas, R.rpcAbre.sueltas], [1, 2, 12]);
eq('no deja crear una fracción de otra fracción', R.fracDeFrac, 'una fracción no puede salir de otra fracción');
eq('producto que no existe → null', R.noExiste, 'null');
const G = R.gAlta || {};
eq('⚖️ 10 bolsitas de 100 g → 250 g: máximo 4 (el ejemplo del usuario)', G.T9102 && G.T9102.st, 4);
eq('⚖️ → 1 kg: 1', G.T9103 && G.T9103.st, 1);
eq('⚖️ costo 250 g = $ 5.000 × 2,5 = $ 12.500 · 1 kg = $ 50.000', [+(G.T9102 || {}).c, +(G.T9103 || {}).c], [12500, 50000]);
eq('⚖️ la fracción queda "por peso" y sin "trae N" (U/paq 1)', [(G.T9102 || {}).por, (G.T9102 || {}).upp], ['g', 1]);
eq('⚖️ vender 250 g abre 3 bolsitas y quedan 50 g sueltos', [R.gRpc && R.gRpc.abiertas, R.gRpc && R.gRpc.cerradas, R.gRpc && R.gRpc.sueltas, R.gRpc && R.gRpc.por], [3, 7, 50, 'g']);
eq('⚖️ → 250 g: 3 · 1 kg: 0 (quedan 750 g)', R.gTras, { T9101: [7, 50], T9102: [3, 0], T9103: [0, 0] });
eq('⚖️ si cancelan, los 250 g vuelven sueltos → 4 y 1 otra vez', R.gCancel, { T9101: [7, 300], T9102: [4, 0], T9103: [1, 0] });
eq('⚖️ cambiar el peso de la bolsita recalcula todo (200 g: 1.700 g → 6 de 250 g, costo $ 6.250)', { a: (R.gPeso || {}).T9102 && R.gPeso.T9102.map(Number), b: (R.gPeso || {}).T9103 && R.gPeso.T9103.map(Number) }, { a: [6, 6250], b: [1, 25000] });
console.log('\n' + (mal ? '❌ ' + mal + ' de ' + (ok + mal) + ' FALLARON' : '✅ ' + ok + ' de ' + ok + ' — y no quedó nada escrito (la transacción se deshizo)'));
process.exit(mal ? 1 : 0);
