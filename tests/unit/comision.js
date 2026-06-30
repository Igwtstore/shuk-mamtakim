// Blindaje: comisión 15% de Miri en la moneda en que se cobró (_comiEnMonedaCobro_) — función REAL
// de motor-v2.js. Si los dólares entraron a una caja de PESOS con TC, la comisión se pasa a pesos.
const { extraerFns, suite } = require('./_helpers');

module.exports.run = () => {
  const { _comiEnMonedaCobro_, _comiPeriodoVenta_ } = extraerFns('../../motor-v2.js', ['_comiEnMonedaCobro_', '_comiPeriodoVenta_']);
  const s = suite();
  const CAJAS_ARS = ['MP_GABY', 'EFT_MYRI', 'EFT_JONY', 'MP_JONY', 'CTA_CTE_ARS'];

  // _comiEnMonedaCobro_ (al cobrar)
  s.eq('Sin comisión (flag) → 0/0', _comiEnMonedaCobro_(10000, 0, 'EFT_MYRI', 0, true), { comiARS: 0, comiUSD: 0 });
  s.eq('Solo pesos: 15% de 10.000 = 1.500', _comiEnMonedaCobro_(10000, 0, 'EFT_MYRI', 0, false), { comiARS: 1500, comiUSD: 0 });
  s.eq('Dólares a caja en U$S: comisión en U$S (15% de 100 = 15)', _comiEnMonedaCobro_(0, 100, 'EFT_USD', 0, false), { comiARS: 0, comiUSD: 15 });
  s.eq('Dólares a caja en PESOS con TC: comisión convertida a $ (100×1500×0,15 = 22.500)', _comiEnMonedaCobro_(0, 100, 'EFT_MYRI', 1500, false), { comiARS: 22500, comiUSD: 0 });
  s.eq('Mezcla $+U$S a caja pesos: 1.500 + 22.500 = 24.000', _comiEnMonedaCobro_(10000, 100, 'EFT_MYRI', 1500, false), { comiARS: 24000, comiUSD: 0 });
  s.eq('Dólares a caja pesos pero SIN TC (tc=0): queda en U$S', _comiEnMonedaCobro_(0, 100, 'EFT_MYRI', 0, false), { comiARS: 0, comiUSD: 15 });

  // _comiPeriodoVenta_ (cómputo del período): el bug del cobro fraccionado (desfasaje $35.828)
  const F = (arsM, usdM, comiARS, comiUSD, cajaM, tc, sinComi, tramos) => _comiPeriodoVenta_(arsM, usdM, comiARS, comiUSD, cajaM, tc, sinComi, tramos, CAJAS_ARS);
  s.eq('Período sin tramos, solo pesos: usa comiARS guardado (1.500)', F(10000, 0, 1500, 0, 'EFT_MYRI', 0, false, false), { cARS: 1500, cUSD: 0 });
  s.eq('Período sin tramos, dólares a caja $ con TC: convierte (100×1500×0,15)', F(0, 100, 0, 0, 'EFT_MYRI', 1500, false, false), { cARS: 22500, cUSD: 0 });
  // CON TRAMOS: usa la comisión derivada por tramo (NO recalcula). Caso #36: dólares entraron en
  // dólares + cuenta corriente → comisión guardada en U$S, NO se convierte a pesos a lo bruto.
  s.eq('Período CON tramos: usa comiARS/comiUSD guardados (no recalcula)', F(0, 241, 0, 36.20, 'EFT_JONY', 1515, false, true), { cARS: 0, cUSD: 36.20 });
  s.eq('CON tramos pero comisión guardada en pesos: la respeta', F(50000, 0, 7500, 0, 'EFT_MYRI', 0, false, true), { cARS: 7500, cUSD: 0 });
  s.eq('Período sin comisión (flag): 0/0', F(10000, 100, 1500, 15, 'EFT_MYRI', 1500, true, false), { cARS: 0, cUSD: 0 });

  return s.result();
};
