# 🛡️ Red de seguridad (blindaje) — flujos de plata

Tests **rápidos** de lógica pura (sin backend, corren en ~1 segundo). Verifican los cálculos
donde está la plata, usando las funciones **REALES** de producción (`motor-v2.js` / `index.html`),
extraídas por nombre. Si una función de plata cambia y rompe algo, esto se pone **rojo**.

> Distinto de los `*.test.js` de la carpeta padre, que son E2E contra el backend real
> (completos pero lentos y necesitan credenciales). Esta red es la de **cada cambio**.

## Correr
```bash
node tests/unit/_run.js          # desde la raíz del repo
# o:  cd tests && npm run blindaje
```

## ⚠️ El ritual
- Correr **ANTES de cada deploy**. Si algo está **ROJO → NO se deploya** hasta arreglarlo.
- Cada vez que se toca un cálculo de plata, **agregar o actualizar su test acá**.

## Qué cubre hoy (41 checks)
- **ganancia_multimoneda** — ganancia Pitzujim/golosinas de Jony en $ y U$S, desambiguación
  de los 9 "Pitzujim" por descripción, renombrado, costo U$S × TC, sin costo, sin TC, Miri no cuenta.
- **deuda_pedido** — deuda residual; cobro parcial que NO borra la deuda (bug isi michan); vista Miri.
- **precios** — precio + moneda según tipo (base del repreciado al editar una venta).
- **packs_ofertas** — precio del carrito de Candy con ofertas (vigentes/vencidas) y packs automáticos.
- **catalogo_descuento** — descuento del catálogo con redondeo siempre para arriba ($ y U$S).

## Pendiente de ampliar (próximos tests)
Funciones que viven en el BACKEND (dependen de la planilla, no son lógica pura → las cubren los
`*.test.js` E2E de la carpeta padre): comisión 15% de Miri · split 2×2 (dueño × moneda) ·
gananciaJonyPeriodo_ (suma del período) · reserva de stock de pedidos Candy · lost-update de stock.
Pendientes de lógica pura: referencia en pesos del catálogo (_acRefValor, usa estado global).
