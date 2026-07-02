-- ============================================================================
--  AJUSTE Fase 2 — hojas que faltaban para el SALDO FINAL de socios (2026-07-01).
--  Ejecutar en Supabase → SQL Editor. Crea 3 tablas espejo (datos, no lógica).
--  Con esto el cuadro de socios queda verificable punta a punta desde Supabase.
-- ============================================================================

-- CAJA ENVÍOS (hoja "Envios") — cada envío: costo + lo cobrado, gestionado por Jony.
-- El saldo y la deuda entre socios se DERIVAN de acá (no se escriben) → idempotente.
create table if not exists envios (
  id         bigint generated always as identity primary key,
  fecha      text,
  venta_id   text,          -- id de la venta ('P<timestamp>')
  n_venta    text,
  cliente    text,
  dueno      text,          -- siempre 'Jony' (la caja de envíos es de Jony)
  cobrado    numeric default 0,
  costo      numeric default 0,
  quien_pago text,
  nota       text
);
alter table envios enable row level security;

-- LIQUIDACIÓN ENTRE SOCIOS (hoja "LiquidacionSocios") — cada saldo pagado Myri↔Jony.
create table if not exists liquidacion_socios (
  id        bigint generated always as identity primary key,
  fecha     text,
  monto_ars numeric default 0,
  monto_usd numeric default 0,
  nota      text
);
alter table liquidacion_socios enable row level security;

-- CORTES de período (hoja "Cortes") — liquidación histórica de ganancia + Maaser.
create table if not exists cortes (
  id              bigint generated always as identity primary key,
  fecha           text,
  corte_id        text,
  ganancia_ars    numeric default 0,
  diezmo_ars      numeric default 0,
  ganancia_usd    numeric default 0,
  diezmo_usd      numeric default 0,
  pagado_myri_ars numeric default 0,
  pagado_myri_usd numeric default 0,
  ventas          numeric default 0,
  nota            text
);
alter table cortes enable row level security;
