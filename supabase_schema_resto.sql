-- ============================================================================
--  ESQUEMA Fase 2 — TODAS las hojas restantes → Supabase (2026-07-01).
--  Ejecutar en Supabase → SQL Editor. Completa la migración de datos al 100%.
--  Fechas como text (formato actual). candy_cc / candy_consumo ya existían.
-- ============================================================================

create table if not exists gastos (
  id bigint generated always as identity primary key,
  fecha text, descripcion text, monto numeric default 0, moneda text, categoria text, columna text
);
alter table gastos enable row level security;

create table if not exists rendiciones (
  id bigint generated always as identity primary key,
  fecha text, descripcion text, monto numeric default 0, moneda text, columna text
);
alter table rendiciones enable row level security;

create table if not exists stock_diario (
  id bigint generated always as identity primary key,
  fecha text, hijo text, codigo text, producto text, cantidad numeric default 0
);
alter table stock_diario enable row level security;

create table if not exists cierres_hijos (
  id bigint generated always as identity primary key,
  fecha text, hijo text, cerrado_en text, vendido numeric default 0, cobrado numeric default 0,
  efectivo numeric default 0, mp numeric default 0, deuda numeric default 0,
  ganancia numeric default 0, consumo_costo numeric default 0, nota text
);
alter table cierres_hijos enable row level security;

create table if not exists borrados (
  id bigint generated always as identity primary key,
  fecha text, tipo text, detalle text, por text
);
alter table borrados enable row level security;

create table if not exists notificaciones (
  id bigint generated always as identity primary key,
  fecha text, producto_id text, producto text, nombre text, telefono text, estado text, modo text
);
alter table notificaciones enable row level security;

create table if not exists movimientos_stock (
  id bigint generated always as identity primary key,
  fecha text, id_prod text, producto text, cambio numeric default 0,
  antes numeric default 0, despues numeric default 0, origen text
);
alter table movimientos_stock enable row level security;

create table if not exists ganancias_jony (
  id bigint generated always as identity primary key,
  fecha text, tipo text, descripcion text, monto numeric default 0
);
alter table ganancias_jony enable row level security;

create table if not exists costos_jony (
  id bigint generated always as identity primary key,
  fecha text, producto_id text, producto text, cantidad numeric default 0,
  costo_total numeric default 0, costo_unitario numeric default 0
);
alter table costos_jony enable row level security;

create table if not exists visitas (
  id bigint generated always as identity primary key,
  fecha text, pagina text
);
alter table visitas enable row level security;

create table if not exists trafico (
  id bigint generated always as identity primary key,
  fecha text, vid text, pagina text, evento text, origen text, dispositivo text,
  ciudad text, region text, pais text, nombre text, telefono text, detalle text,
  carrito text, total numeric default 0
);
alter table trafico enable row level security;

create table if not exists avisos_candy (
  id bigint generated always as identity primary key,
  fecha text, hijo text, codigo text, producto text, cliente text, telefono text, estado text
);
alter table avisos_candy enable row level security;

create table if not exists shuk_en_candy (
  id bigint generated always as identity primary key,
  shuk_id text, fecha text
);
alter table shuk_en_candy enable row level security;
