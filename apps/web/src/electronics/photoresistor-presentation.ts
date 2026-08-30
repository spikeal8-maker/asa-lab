export function formatIlluminanceLux(lux: number): string {
  if (!Number.isFinite(lux) || lux <= 0) return '0 лк';
  if (lux < 1) return `${lux.toFixed(2)} лк`;
  if (lux < 10) return `${lux.toFixed(1)} лк`;
  if (lux < 1_000) return `${Math.round(lux)} лк`;
  return `${(lux / 1_000).toFixed(lux < 10_000 ? 1 : 0)} тыс. лк`;
}

export function formatPhotoresistorResistance(resistanceOhm: number): string {
  if (!Number.isFinite(resistanceOhm) || resistanceOhm <= 0) return '—';
  if (resistanceOhm >= 1_000_000) return `${(resistanceOhm / 1_000_000).toFixed(2)} МОм`;
  if (resistanceOhm >= 1_000) {
    const kiloOhm = resistanceOhm / 1_000;
    return `${kiloOhm.toFixed(kiloOhm < 10 ? 2 : kiloOhm < 100 ? 1 : 0)} кОм`;
  }
  return `${Math.round(resistanceOhm)} Ом`;
}

export function photoresistorLightCondition(lux: number): string {
  if (!Number.isFinite(lux) || lux < 0.05) return 'Темнота';
  if (lux < 1) return 'Очень слабый свет';
  if (lux < 10) return 'Сумерки';
  if (lux < 100) return 'Приглушённое помещение';
  if (lux < 1_000) return 'Освещённое помещение';
  return 'Яркий свет';
}
