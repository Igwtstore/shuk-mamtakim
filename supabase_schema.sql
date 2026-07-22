-- ============================================================================
--  ESQUEMA SUPABASE — espejo de las hojas de Google Sheets (Shuk + Candy)
--  Fase 0 de la migración (2026-06-30). Ejecutar en: Supabase → SQL Editor.
--  No toca el sistema actual: crea la base nueva en paralelo.
--  Regla: se respetan los formatos actuales (fechas 'dd/MM/yyyy HH:mm' como text,
--  IDs 'P<timestamp>' como text) para que la migración de datos sea 1:1.
-- ============================================================================

-- ── SHUK ────────────────────────────────────────────────────────────────────

-- PRODUCTOS (hoja "Stock")
create table if not exists productos (
  id                    text primary key,
  nombre                text not null,
  stock                 numeric default 0,
  activo                boolean default true,
  categoria             text,
  dueno                 text,               -- 'Jony' | 'Miri' | ''
  moneda                text default '$',   -- '$' | 'U$S'
  precio_may            numeric,
  precio_min            numeric,
  descripcion           text,
  visible               boolean default true,
  imagen                text,
  desc_bot              text,
  costo                 numeric,
  nombres_prev          text,               -- historial de nombres (renombrado seguro)
  unidades_por_paquete  integer default 1,  -- ⭐ NUEVO: circuito Candy↔Shuk (bolsa de N unidades)
  peso                  numeric default 0,  -- peso por bolsa en gramos (interno, orden de compra)
  creado                timestamptz default now(),
  actualizado           timestamptz default now()
);

-- VENTAS (hoja "Ventas")
create table if not exists ventas (
  id            text primary key,        -- 'P<timestamp>'
  n_venta       integer,
  fecha         text,                    -- 'dd/MM/yyyy HH:mm'
  cliente       text,
  tipo          text,                    -- 'Mayorista' | 'Minorista'
  productos     text,                    -- detalle en texto (formato actual)
  forma_pago    text,
  notas         text,
  estado        text,                    -- pendiente|preparando|entregado|cotizacion|cancelado
  total_ars     numeric default 0,
  total_usd     numeric default 0,
  ars_jony      numeric default 0,       -- reparto 2×2 (dueño × moneda)
  ars_myri      numeric default 0,
  usd_myri      numeric default 0,
  usd_jony      numeric default 0,
  comi_ars      numeric default 0,       -- comisión de Miri hacia Jony
  comi_usd      numeric default 0,
  caja_jony     text,
  caja_myri     text,
  tipo_cambio   numeric default 0,
  sin_comi      text,                    -- 'SI' cuando la venta no paga comisión
  tramos        text,                    -- JSON de cobro fraccionado (col 29)
  corte         text,                    -- id del corte que la liquidó (col 26)
  stock_updates text,                    -- 'id:cant,id:cant' descontado del stock
  vid           text,                    -- device id (anti pedidos falsos)
  creado        timestamptz default now()
);
create index if not exists ventas_cliente_idx on ventas (cliente);
create index if not exists ventas_estado_idx  on ventas (estado);

-- PAGOS a cuenta (hoja "Pagos")
create table if not exists pagos (
  id          bigint generated always as identity primary key,
  fecha       text,
  cliente     text,
  pedido_id   text,          -- venta a la que se imputa ('' = general FIFO)
  monto_ars   numeric default 0,
  monto_usd   numeric default 0,
  monto_pitz  numeric default 0,   -- parte ARS que es Pitzujim (privacidad Miri)
  caja        text,               -- caja destino ('PERDON' = perdón/redondeo)
  tc          numeric default 0,   -- TC si pagó los U$S con pesos
  nota        text,
  comprobante text,
  creado      timestamptz default now()
);
create index if not exists pagos_cliente_idx on pagos (cliente);

-- CLIENTES (hoja "Clientes")
create table if not exists clientes (
  id             bigint generated always as identity primary key,
  fecha          text,
  nombre         text,
  telefono       text,
  tipo           text,          -- mayorista | minorista
  nota           text,
  ultimo_acceso  text
);

-- MOVIMIENTOS ENTRE SOCIOS (hoja "MovsSocios")
create table if not exists movs_socios (
  id         bigint generated always as identity primary key,
  fecha      text,
  descripcion text,
  monto_ars  numeric default 0,
  monto_usd  numeric default 0
);

-- ── CANDY (paneles de los chicos) ───────────────────────────────────────────

-- PRODUCTOS DE CANDY (los propios; los de Shuk se referencian con codigo 'shuk:<id>')
create table if not exists candy_productos (
  codigo         text primary key,
  nombre         text not null,
  precio_venta   numeric,
  costo          numeric,
  stock          numeric default 0,
  categoria      text,
  foto           text,
  precio_oferta  numeric default 0,
  fecha_oferta   text,
  cant_pack      integer default 0,
  precio_pack    numeric default 0,
  siempre_disp   boolean default false,
  creado         timestamptz default now()
);

-- VENTAS DE CANDY (hoja "VentasHijos")
create table if not exists candy_ventas (
  id              bigint generated always as identity primary key,
  fecha           text,
  hijo            text,          -- Meir | Iosi | Pa
  producto        text,
  codigo          text,          -- 'shuk:<id>' si es producto del Shuk
  cantidad        integer default 1,
  precio          numeric,
  total           numeric,
  cliente         text,
  es_debe         text,
  pago_parcial    numeric default 0,
  saldo_pendiente numeric default 0,
  metodo_pago     text
);

-- PEDIDOS DE LA TIENDA CANDY (hoja "PedidosHijos") — pendientes de cobrar
create table if not exists candy_pedidos (
  id         bigint generated always as identity primary key,
  fecha      timestamptz default now(),
  hijo       text,
  cliente    text,
  telefono   text,
  items      text,          -- JSON de items
  total      numeric,
  estado     text default 'pendiente',
  pedido_id  text unique,
  nota       text
);

-- COMPRAS DE MERCADERÍA (hoja "ComprasHijos")
create table if not exists candy_compras (
  id         bigint generated always as identity primary key,
  fecha      text,
  hijo       text,
  producto   text,
  codigo     text,
  cantidad   integer,
  costo      numeric,
  proveedor  text,
  nota       text
);

-- PROVEEDORES (hoja "Proveedores"/ProveedoresHijos)
create table if not exists candy_proveedores (
  id      bigint generated always as identity primary key,
  hijo    text,
  nombre  text,
  contacto text,
  nota    text
);

-- DEPÓSITO (hoja "DepositoHijos") — mercadería en casa (stock compartido de los chicos)
create table if not exists candy_deposito (
  codigo   text primary key,
  nombre   text,
  cantidad numeric default 0
);

-- CONSUMO / "me lo comí o regalé" (hoja "ConsumoHijos")
create table if not exists candy_consumo (
  id        bigint generated always as identity primary key,
  fecha     text,
  hijo      text,
  producto  text,
  codigo    text,
  cantidad  integer default 1,
  costo     numeric,
  motivo    text,        -- comido | regalado
  nota      text
);

-- CUENTA CORRIENTE DE CANDY (hoja "CCHijos")
create table if not exists candy_cc (
  id       bigint generated always as identity primary key,
  fecha    text,
  hijo     text,
  cliente  text,
  monto    numeric,
  tipo     text,         -- deuda | pago | vuelto
  detalle  text
);

-- ============================================================================
--  Notas:
--  · Falta agregar: Envios, ShukEnCandy (referencias), StockDiario, CierresHijos,
--    Notificaciones (lista de espera), MovimientosStock, Borrados, GananciasJony,
--    CostosJony, Trafico (analítica), AvisosCandy, config. Se suman en la Fase 1.
--  · RLS (seguridad por fila) y las políticas de acceso se definen aparte, cuando
--    se conecte el frontend (para que cada uno vea solo lo suyo, como hoy).
-- ============================================================================
