// Blindaje: comisión 15% de Miri en la moneda en que se cobró (_comiEnMonedaCobro_) — función REAL
// de motor-v2.js. Si los dólares entraron a una caja de PESOS con TC, la comisión se pasa a pesos.
const { extraerFns, suite } = require('./_helpers');

module.exports.run = () => {
  const { _comiEnMonedaCobro_ } = extraerFns('../../motor-v2.js', ['_comiEnMonedaCobro_']);
  const s = suite();

  s.eq('Sin comisión (flag) → 0/0', _comiEnMonedaCobro_(10000, 0, 'EFT_MYRI', 0, true), { comiARS: 0, comiUSD: 0 });
  s.eq('Solo pesos: 15% de 10.000 = 1.500', _comiEnMonedaCobro_(10000, 0, 'EFT_MYRI', 0, false), { comiARS: 1500, comiUSD: 0 });
  s.eq('Dólares a caja en U$S: comisión en U$S (15% de 100 = 15)', _comiEnMonedaCobro_(0, 100, 'EFT_USD', 0, false), { comiARS: 0, comiUSD: 15 });
  s.eq('Dólares a caja en PESOS con TC: comisión convertida a $ (100×1500×0,15 = 22.500)', _comiEnMonedaCobro_(0, 100, 'EFT_MYRI', 1500, false), { comiARS: 22500, comiUSD: 0 });
  s.eq('Mezcla $+U$S a caja pesos: 1.500 + 22.500 = 24.000', _comiEnMonedaCobro_(10000, 100, 'EFT_MYRI', 1500, false), { comiARS: 24000, comiUSD: 0 });
  s.eq('Dólares a caja pesos pero SIN TC (tc=0): queda en U$S', _comiEnMonedaCobro_(0, 100, 'EFT_MYRI', 0, false), { comiARS: 0, comiUSD: 15 });

  return s.result();
};
