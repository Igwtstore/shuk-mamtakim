// Blindaje: precio del carrito de Candy con OFERTAS y PACKS (subtotalItem y amigas) — funciones
// REALES de tienda.html. Es lo que paga el cliente: un error acá = cobrar de más o de menos.
const { extraerFns, suite } = require('./_helpers');

module.exports.run = () => {
  const f = extraerFns('../../tienda.html', ['ofertaActiva', 'packActivo', 'precioUnit', 'subtotalItem']);
  const s = suite();
  const fecha = d => `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
  const ayer = fecha(new Date(Date.now() - 86400000));
  const manana = fecha(new Date(Date.now() + 86400000));

  // Sin promo
  s.ok('Sin promo: 3 × $1.000 = 3.000', f.subtotalItem({ precioVenta: 1000 }, 3) === 3000);

  // Oferta vigente (sin fecha de vencimiento)
  s.ok('Oferta vigente: precio unitario = oferta (700)', f.precioUnit({ precioVenta: 1000, precioOferta: 700 }) === 700);
  s.ok('Oferta vigente: 2 × $700 = 1.400', f.subtotalItem({ precioVenta: 1000, precioOferta: 700 }, 2) === 1400);

  // Oferta vencida (fecha de ayer) → NO aplica
  s.ok('Oferta vencida ayer: no aplica', f.ofertaActiva({ precioOferta: 700, fechaOferta: ayer }) === false);
  s.ok('Oferta vencida: vuelve al precio normal (1.000)', f.precioUnit({ precioVenta: 1000, precioOferta: 700, fechaOferta: ayer }) === 1000);

  // Oferta con vencimiento futuro → SÍ aplica
  s.ok('Oferta vence mañana: aplica', f.ofertaActiva({ precioOferta: 700, fechaOferta: manana }) === true);

  // Pack: cada cantPack a precioPack, el resto al unitario
  const conPack = { precioVenta: 1000, cantPack: 3, precioPack: 2500 };
  s.ok('Pack 3×$2.500: 7 unidades = 2 packs (5.000) + 1 suelto (1.000) = 6.000', f.subtotalItem(conPack, 7) === 6000);
  s.ok('Pack: cantidad menor al pack (2 < 3) → 2 × $1.000 = 2.000', f.subtotalItem(conPack, 2) === 2000);
  s.ok('Pack exacto: 6 = 2 packs = 5.000', f.subtotalItem(conPack, 6) === 5000);

  // Pack + oferta: el resto (suelto) usa el precio de OFERTA
  const packYOferta = { precioVenta: 1000, precioOferta: 700, cantPack: 3, precioPack: 2500 };
  s.ok('Pack + oferta: 4 = 1 pack (2.500) + 1 suelto a oferta (700) = 3.200', f.subtotalItem(packYOferta, 4) === 3200);

  return s.result();
};
