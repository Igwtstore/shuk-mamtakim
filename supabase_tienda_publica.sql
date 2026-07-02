-- ============================================================================
--  TIENDA PÚBLICA — setup aplicado el 2026-07-01/02 (YA EJECUTADO en Supabase).
--  Queda acá como registro de lo que vive en la base.
-- ============================================================================

-- Depósito compartido Shuk↔Candy: productos de Shuk importados de Candy guardan
-- el código de Candy (col 29 "CandyCod" de la hoja Stock). Su stock real vive en
-- candy_deposito — la Edge Function lo respeta en venta/cancelación/edición.
alter table productos add column if not exists candy_cod text;
-- Backfill de los 16 productos que lo usan (leído de la hoja Stock en vivo):
update productos set candy_cod='ADCE' where id='79';
update productos set candy_cod='BION' where id='80';
update productos set candy_cod='BIFA' where id='81';
update productos set candy_cod='TAVE' where id='82';
update productos set candy_cod='TAAZ' where id='83';
update productos set candy_cod='BIBB' where id='84';
update productos set candy_cod='BIPI' where id='85';
update productos set candy_cod='APRO' where id='86';
update productos set candy_cod='YTCH' where id='87';
update productos set candy_cod='YTRA' where id='88';
update productos set candy_cod='YTCO' where id='89';
update productos set candy_cod='YTAP' where id='90';
update productos set candy_cod='SKAZ' where id='91';
update productos set candy_cod='SKVE' where id='92';
update productos set candy_cod='SKRJ' where id='93';
update productos set candy_cod='SKVI' where id='94';

-- Numeración de ventas a prueba de concurrencia: dos pedidos simultáneos NUNCA
-- toman el mismo número (la EF reintenta si rebota). Reemplaza al LockService.
create unique index if not exists ventas_n_venta_uniq on ventas (n_venta);

-- Catálogo público SIN datos sensibles: el navegador (anon/authenticated) puede
-- leer el catálogo pero NO costo, nombres_prev, desc_bot ni candy_cod.
-- (Mejora sobre Google: la hoja gviz de hoy expone TODO, costos incluidos.)
revoke select on table productos from anon;
revoke select on table productos from authenticated;
grant select (id, nombre, stock, activo, categoria, dueno, moneda, precio_may, precio_min, descripcion, visible, visible_cat, imagen, precio_oferta, fecha_oferta, cant_pack, precio_pack) on table productos to anon;
grant select (id, nombre, stock, activo, categoria, dueno, moneda, precio_may, precio_min, descripcion, visible, visible_cat, imagen, precio_oferta, fecha_oferta, cant_pack, precio_pack) on table productos to authenticated;
