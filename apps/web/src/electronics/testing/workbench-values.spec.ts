import { describe, expect, it } from 'vitest';
import {
  defaultResistanceUnit,
  RESISTANCE_UNITS,
  resistanceDisplayValue,
  resistanceValueInOhms,
} from '../workbench-values';

describe('Tinkercad-style resistance units', () => {
  it.each([
    [4_700, 'Ω', 4_700],
    [4_700, 'kΩ', 4.7],
    [4_700, 'MΩ', 0.0047],
    [0.0047, 'mΩ', 4.7],
  ] as const)('round-trips %s ohm through %s', (ohms, unit, displayValue) => {
    expect(resistanceDisplayValue(ohms, unit)).toBe(displayValue);
    expect(resistanceValueInOhms(displayValue, unit)).toBeCloseTo(ohms, 10);
  });

  it('selects a readable default without changing the stored ohm value', () => {
    expect(defaultResistanceUnit(4_700)).toBe('kΩ');
    expect(defaultResistanceUnit(2_200_000)).toBe('MΩ');
    expect(defaultResistanceUnit(220)).toBe('Ω');
  });

  it('round-trips arbitrary decimal values through every selectable unit', () => {
    let state = 0x9e3779b9;
    const values = Array.from({ length: 48 }, () => {
      state = (Math.imul(state, 1_103_515_245) + 12_345) >>> 0;
      return Number((10 ** (-9 + (state / 0x1_0000_0000) * 18)).toPrecision(9));
    });

    for (const value of values) {
      for (const unit of RESISTANCE_UNITS) {
        const restored = resistanceValueInOhms(resistanceDisplayValue(value, unit.id), unit.id);
        expect(Math.abs(restored - value) / value).toBeLessThan(1e-8);
      }
    }
  });
});
