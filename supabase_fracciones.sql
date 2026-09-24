-- ✂️ v5.03 — FRACCIONAR PAQUETES (pedido del usuario 24/09/2026, solo minorista)
--
-- Una bolsa cerrada de N unidades (productos.unidades_por_paquete) es un POZO de unidades.
-- Cada fracción ("… · x3") es una ficha propia que saca de ese pozo:
--   productos.fraccion_de   = id de la bolsa madre (NULL = producto normal)
--   productos.fraccion_cant = cuántas unidades lleva la fracción
--   productos.sueltas       = (solo en la bolsa madre) unidades de bolsas YA abiertas
--
-- Reglas (confirmadas por el usuario):
--   · el stock de la bolsa madre = bolsas CERRADAS; las fracciones gastan primero las sueltas y
--     recién cuando no alcanzan se abre otra bolsa (stock −1, sueltas +N);
--   · stock de una fracción = piso((cerradas × N + sueltas) ÷ cant) — nunca se carga a mano;
--   · costo de una fracción = costo de la bolsa ÷ N × cant (bolsa U$S 18 de 18 → x3 = U$S 3);
--   · moneda y dueño salen de la bolsa; la fracción es SOLO minorista.
--
-- Todo lo calcula la base (triggers): da igual por dónde se toque el stock (venta, cancelación,
-- recepción de mercadería, ajuste manual, editor masivo), las fracciones quedan siempre al día.
-- Se aplica con: npx supabase db query --linked -f supabase_fracciones.sql   (es idempotente)

alter table productos add column if not exists fraccion_de   text;
alter table productos add column if not exists fraccion_cant integer;
alter table productos add column if not exists sueltas       integer not null default 0;
-- ⚖️ v5.05: cómo se fracciona la bolsa. 'u' = por unidades (trae unidades_por_paquete); 'g' = por PESO (pesa `peso`
-- gramos: los Pitzujim de 100 g). En 'g' el pozo, las sueltas y la cantidad de cada fracción van en GRAMOS, y la
-- fracción puede ser más grande que la bolsa (1 kg = 10 bolsitas).
alter table productos add column if not exists fraccionar_por text not null default 'u';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'productos_fraccionar_por_chk') then
    alter table productos add constraint productos_fraccionar_por_chk check (fraccionar_por in ('u', 'g'));
  end if;
end $$;
-- La tienda lee productos con permiso POR COLUMNA: sin esto, el catálogo que pida estas columnas falla.
grant select (fraccion_de, fraccion_cant, sueltas, fraccionar_por) on productos to anon, authenticated;
create index if not exists productos_fraccion_de_idx on productos (fraccion_de) where fraccion_de is not null;

-- 1) Una fracción SIEMPRE refleja a su bolsa (antes de guardarse, sea quien sea el que la toque).
create or replace function fraccion_calcular() returns trigger language plpgsql as $$
declare m record; k integer; upp integer;
begin
  if coalesce(new.fraccion_de, '') = '' then new.fraccion_de := null; new.fraccion_cant := null; return new; end if;
  select id, stock, sueltas, unidades_por_paquete, costo, moneda, dueno, fraccion_de, fraccionar_por, peso
    into m from productos where id = new.fraccion_de;
  if not found then new.stock := 0; return new; end if;   -- bolsa borrada: la fracción queda sin stock
  if coalesce(m.fraccion_de, '') <> '' then raise exception 'una fracción no puede salir de otra fracción'; end if;
  if m.id = new.id then raise exception 'un producto no puede ser fracción de sí mismo'; end if;
  -- lo que trae UNA bolsa: unidades, o gramos si se fracciona por peso
  upp := case when m.fraccionar_por = 'g' then greatest(1, round(coalesce(m.peso, 0))::integer) else greatest(1, coalesce(m.unidades_por_paquete, 1)) end;
  k   := greatest(1, coalesce(new.fraccion_cant, 1));
  new.fraccion_cant := k;
  new.fraccionar_por := m.fraccionar_por;
  new.stock  := floor(greatest(0, coalesce(m.stock, 0) * upp + coalesce(m.sueltas, 0)) / k);
  new.costo  := case when coalesce(m.costo, 0) > 0 then round(m.costo / upp * k, 4) else null end;
  new.moneda := m.moneda;
  new.dueno  := m.dueno;
  new.unidades_por_paquete := case when m.fraccionar_por = 'g' then 1 else k end;   -- unidades: la tienda muestra "3 unidades · $ X c/u" sola
  new.sueltas := 0;
  new.precio_may := null;                 -- solo minorista
  if coalesce(new.visible_cat, '') in ('', 'Ambos', 'Mayorista') then new.visible_cat := 'Minorista'; end if;
  return new;
end $$;
drop trigger if exists fraccion_calcular on productos;
create trigger fraccion_calcular before insert or update on productos
  for each row execute function fraccion_calcular();

-- 2) Cuando cambia la bolsa (stock, sueltas, U/paq, costo, moneda, dueño) se recalculan sus fracciones.
create or replace function fraccion_sincronizar() returns trigger language plpgsql as $$
begin
  if coalesce(new.fraccion_de, '') = '' and (
       new.stock is distinct from old.stock or new.sueltas is distinct from old.sueltas
    or new.unidades_por_paquete is distinct from old.unidades_por_paquete or new.costo is distinct from old.costo
    or new.moneda is distinct from old.moneda or new.dueno is distinct from old.dueno
    or new.peso is distinct from old.peso or new.fraccionar_por is distinct from old.fraccionar_por) then
    update productos set fraccion_cant = fraccion_cant where fraccion_de = new.id;   -- el trigger 1 recalcula
  end if;
  return null;
end $$;
drop trigger if exists fraccion_sincronizar on productos;
create trigger fraccion_sincronizar after update on productos
  for each row execute function fraccion_sincronizar();

-- 3) Mover stock en UN solo paso (lo usan TODAS las ventas, cancelaciones y recepciones del motor).
--    Producto normal: stock + delta, atómico (antes era leer-y-escribir y dos pedidos simultáneos se pisaban).
--    Fracción: delta en fracciones → unidades del pozo. Vende: primero sueltas, después abre bolsas.
--    Devuelve/cancela: las unidades vuelven como SUELTAS (la bolsa ya se abrió).
--    Se bloquea PRIMERO la bolsa madre: así una fracción y la bolsa entera vendidas a la vez no se cruzan.
create or replace function mover_stock(p_id text, p_delta numeric) returns json language plpgsql as $$
declare f record; m record; k integer; upp integer; necesito numeric; abrir integer := 0;
        antes numeric; despues numeric; pozo numeric;
begin
  select id, nombre, stock, fraccion_de, fraccion_cant into f from productos where id = p_id;
  if not found then return null; end if;
  if coalesce(f.fraccion_de, '') = '' then
    update productos set stock = coalesce(stock, 0) + p_delta where id = p_id returning stock into despues;
    return json_build_object('antes', despues - p_delta, 'despues', despues, 'nombre', f.nombre, 'fraccion', false);
  end if;
  select id, nombre, stock, sueltas, unidades_por_paquete, fraccionar_por, peso into m from productos where id = f.fraccion_de for update;
  if not found then
    return json_build_object('antes', 0, 'despues', 0, 'nombre', f.nombre, 'fraccion', true, 'huerfana', true);
  end if;
  upp := case when m.fraccionar_por = 'g' then greatest(1, round(coalesce(m.peso, 0))::integer) else greatest(1, coalesce(m.unidades_por_paquete, 1)) end;
  k   := greatest(1, coalesce(f.fraccion_cant, 1));
  pozo  := coalesce(m.stock, 0) * upp + coalesce(m.sueltas, 0);
  antes := floor(greatest(0, pozo) / k);
  if p_delta >= 0 then
    update productos set sueltas = coalesce(sueltas, 0) + (p_delta * k)::integer where id = m.id;
  else
    necesito := -p_delta * k;
    if coalesce(m.sueltas, 0) >= necesito then
      update productos set sueltas = sueltas - necesito::integer where id = m.id;
    else
      abrir := ceil((necesito - coalesce(m.sueltas, 0)) / upp);
      update productos set stock = coalesce(stock, 0) - abrir,
                           sueltas = (coalesce(sueltas, 0) + abrir * upp - necesito)::integer
       where id = m.id;
    end if;
  end if;
  select stock into despues from productos where id = p_id;
  select stock, sueltas into m.stock, m.sueltas from productos where id = f.fraccion_de;
  return json_build_object('antes', antes, 'despues', despues, 'nombre', f.nombre, 'fraccion', true,
    'padre', f.fraccion_de, 'padreNombre', m.nombre, 'abiertas', abrir,
    'cerradas', m.stock, 'sueltas', m.sueltas, 'por', m.fraccionar_por);
end $$;
revoke all on function mover_stock(text, numeric) from public, anon, authenticated;
grant execute on function mover_stock(text, numeric) to service_role;
