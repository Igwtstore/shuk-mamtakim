-- ============================================================================
--  POLÍTICAS DE SEGURIDAD (RLS) — Fase 2, paso 1.
--  Las tablas se crearon CON RLS activado (cerradas por defecto). Acá abrimos
--  SOLO lo que corresponde, con cuidado. Ejecutar en Supabase → SQL Editor.
--
--  ⚠️ Por ahora habilitamos SOLO la LECTURA PÚBLICA de productos (que ya son
--  públicos en la tienda). Las tablas con plata/privacidad (ventas, pagos,
--  clientes) NO se abren todavía — eso se hace con login + reglas finas cuando
--  reescribamos el panel (para que Miri no vea lo de Jony).
-- ============================================================================

-- Productos: cualquiera puede LEER (el catálogo es público). Nadie puede escribir
-- desde el navegador (eso sigue yendo por el backend con la llave secreta).
drop policy if exists "productos_lectura_publica" on productos;
create policy "productos_lectura_publica"
  on productos for select
  using (true);
