-- ============================================================================
--  REPARAR MODELO (2026-07-01) — completa columnas/tablas que la migración
--  inicial simplificó, para poder portar los endpoints que faltan.
--  Ejecutar en Supabase → SQL Editor. No borra datos existentes (salvo recrear
--  candy_compras, que se re-migra a continuación desde Google).
-- ============================================================================

-- 1) PRODUCTOS de Shuk: granularidad de "visible" (Ambos/Min/May) + ofertas/packs (promos).
alter table productos add column if not exists visible_cat  text default 'Ambos';   -- Ambos | Min | May | No
alter table productos add column if not exists precio_oferta numeric default 0;
alter table productos add column if not exists fecha_oferta  text;
alter table productos add column if not exists cant_pack     integer default 0;
alter table productos add column if not exists precio_pack   numeric default 0;

-- 2) COMPRAS de Candy: pasar de "items JSON agrupado" a FILA-POR-ITEM (como el motor viejo),
--    para poder recalcular el costo promedio ponderado por producto.
drop table if exists candy_compras cascade;
create table candy_compras (
  id            bigint generated always as identity primary key,
  compra_id     text,
  fecha         text,
  proveedor_id  text,
  proveedor     text,
  codigo        text,
  producto      text,
  cantidad      integer default 0,
  costo_unit    numeric default 0,
  costo_total   numeric default 0,
  registrado_por text
);
alter table candy_compras enable row level security;
