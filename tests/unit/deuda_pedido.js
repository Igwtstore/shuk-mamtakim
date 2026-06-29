// Blindaje: deuda residual de un pedido (_deudaPedido) — función REAL de index.html.
// Cubre el bug que casi borra la deuda de isi michan: un pedido cobrado PARCIAL (parte a caja
// real + parte a cuenta corriente) NO debe figurar como saldado; la deuda es lo que quedó en CTA_CTE.
const { extraerFns, suite } = require('./_helpers');

module.exports.run = () => {
  const { _deudaPedido } = extraerFns('../../index.html', ['esCobradoReal', '_deudaPedido']);
  const s = suite();

  // 1) No cobrada (sin cajas, sin tramos) → debe TODO
  let d = _deudaPedido({ arsJONY: 1000, arsMyri: 2000, usdMyri: 5, usdJONY: 0 }, false);
  s.ok('No cobrada: deuda ARS = 3000, USD = 5', d.ars === 3000 && d.usd === 5);

  // 2) Cobrada completa (caja real, sin tramos) → deuda 0
  d = _deudaPedido({ cajaMyri: 'EFT_MYRI', arsMyri: 2000 }, false);
  s.ok('Cobrada completa (caja real): deuda 0', d.ars === 0 && d.usd === 0);

  // 3) Cancelada → deuda 0
  d = _deudaPedido({ estado: 'cancelado', arsMyri: 9999 }, false);
  s.ok('Cancelada: deuda 0', d.ars === 0 && d.usd === 0);

  // 4) Cotización → deuda 0
  d = _deudaPedido({ estado: 'cotizacion', arsMyri: 9999 }, false);
  s.ok('Cotización: deuda 0', d.ars === 0 && d.usd === 0);

  // 5) EL CASO isi michan: cobrado PARCIAL con tramos (parte a caja real + parte a CTA_CTE_USD).
  //    El backend igual setea cajaMyri con caja real → esCobradoReal daría true, pero la deuda
  //    residual son los U$S 157.66 que quedaron a cuenta corriente.
  const tramos = JSON.stringify([
    { dueno: 'J', caja: 'EFT_JONY', monto: 273745 },
    { dueno: 'M', caja: 'EFT_MYRI', monto: 126260 },
    { dueno: 'M', caja: 'CTA_CTE_USD', monto: 157.66 }
  ]);
  d = _deudaPedido({ cajaJony: 'EFT_JONY', cajaMyri: 'EFT_MYRI', tramos, usdMyri: 240, arsMyri: 126260 }, false);
  s.ok('Cobro parcial (isi michan): deuda residual USD = 157.66', Math.abs(d.usd - 157.66) < 0.01 && d.ars === 0);

  // 6) Vista Miri: solo cuenta la parte de Miri (no la de Jony)
  const tr2 = JSON.stringify([
    { dueno: 'J', caja: 'CTA_CTE_ARS', monto: 5000 },
    { dueno: 'M', caja: 'CTA_CTE_ARS', monto: 3000 }
  ]);
  d = _deudaPedido({ cajaMyri: 'EFT_MYRI', tramos: tr2 }, true);   // soloMiri = true
  s.ok('Vista Miri: deuda solo la parte de Miri = 3000 (no 8000)', d.ars === 3000);
  d = _deudaPedido({ cajaMyri: 'EFT_MYRI', tramos: tr2 }, false);  // vista completa
  s.ok('Vista completa: deuda = 8000 (Jony 5000 + Miri 3000)', d.ars === 8000);

  return s.result();
};
