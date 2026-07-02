-- ============================================================================
--  AJUSTE tablas de Candy a los formatos reales (Fase 1 Candy) — 2026-06-30.
--  Ejecutar en Supabase → SQL Editor. Recrea 2 tablas y agrega deudores.
--  candy_ventas y candy_deposito ya sirven (el mapeo lo hace el migrador).
-- ============================================================================

-- COMPRAS: cada compra tiene VARIOS productos (items). Se guarda items como JSON.
drop table if exists candy_compras cascade;
create table candy_compras (
  id        text primary key,
  fecha     text,
  proveedor text,
  items     text,        -- JSON: [{codigo,nombre,cantidad,costo}, ...]
  total     numeric
);
alter table candy_compras enable row level security;

-- PROVEEDORES: el id es texto ('PR...'), con teléfono y notas.
drop table if exists candy_proveedores cascade;
create table candy_proveedores (
  id       text primary key,
  nombre   text,
  telefono text,
  notas    text
);
alter table candy_proveedores enable row level security;

-- DEUDORES de Candy: saldo por cliente y por chico (de consultarDeudores).
create table if not exists candy_deudores (
  id      bigint generated always as identity primary key,
  hijo    text,
  cliente text,
  saldo   numeric
);
alter table candy_deudores enable row level security;
