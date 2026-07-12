// Contra DATOS REALES de producción (dump directo de la base): ¿alguna venta cambia lo que
// Miri ve con v3.54 vs v3.53? Regla: cualquier diferencia debe ser un renglón de MIRI que antes
// se ocultaba (corrección), jamás un renglón de Jony que ahora se muestre (fuga).
const { chromium } = require('playwright');
const data = require('./prod_data.json');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('http://localhost:8917/index.html', { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(1200);

  const r = await page.evaluate((data) => {
    productos = data.prods.map(p => ({ id: p.id, nombre: p.nombre, dueno: p.dueno, precioMay: p.precio_may, precioMin: p.precio_min }));
    const sj = _nombresJony();

    // Réplica EXACTA de la regla v3.53 (para comparar)
    const v353 = (linea, suIds) => {
      const m = (linea || '').match(/\d+x\s+(.+?)\s+—/);
      if (!m) return /pitzujim/i.test(linea || '');
      const parts = m[1].trim().split(' · ');
      for (let i = parts.length; i >= 1; i--) {
        const nom = parts.slice(0, i).join(' · ').trim();
        if (sj.has(nom)) {
          if (suIds && suIds.size) {
            const g = productos.filter(p => (p.nombre || '').trim() === nom && suIds.has(String(p.id)));
            if (g.length && g.every(p => (p.dueno || '') !== 'Jony')) return false;
          }
          return true;
        }
      }
      return /pitzujim/i.test(m[1]);
    };

    const difs = [], fugas = [];
    data.ventas.forEach(v => {
      const lineas = (v.productos || '').split('||').map(l => l.trim()).filter(l => l.startsWith('•'));
      const su = _suIdsDe(v.stock_updates);
      lineas.forEach((l, i) => {
        const nuevo = _lineaEsDeJony(l, sj, su, lineas, i);
        const viejo = v353(l, su);
        const nom = _nombreLineaCat(l);
        const enSu = nom ? productos.filter(p => (p.nombre || '').trim() === nom && su.has(String(p.id))) : [];
        if (nuevo !== viejo) {
          const duenos = [...new Set(enSu.map(p => p.dueno))];
          difs.push(`#${v.n_venta} "${l.slice(0, 55)}" v3.53=${viejo ? 'oculto' : 'visible'} → v3.54=${nuevo ? 'oculto' : 'visible'} (dueño real por ID: ${duenos.join('+') || 'sin registro'})`);
          if (!nuevo && duenos.length === 1 && duenos[0] === 'Jony') fugas.push(`#${v.n_venta} ${l}`);
        }
        // Invariante regla sagrada: renglón visible cuyo ID registrado es 100% de Jony = FUGA
        if (!nuevo && enSu.length && enSu.every(p => p.dueno === 'Jony')) fugas.push(`#${v.n_venta} INVARIANTE: ${l.slice(0, 70)}`);
      });
    });
    return { difs, fugas };
  }, data);

  console.log(`Ventas reales analizadas: ${data.ventas.length}`);
  console.log(`Renglones que CAMBIAN vs v3.53: ${r.difs.length}`);
  r.difs.forEach(d => console.log('  •', d));
  if (r.fugas.length) { console.log('❌ FUGAS:'); r.fugas.forEach(f => console.log('  ', f)); process.exit(1); }
  console.log('✅ CERO fugas de Jony en vista Miri con las 51 ventas reales');
  await browser.close();
  process.exit(0);
})().catch(e => { console.error('EXPLOTÓ:', e.message); process.exit(1); });
