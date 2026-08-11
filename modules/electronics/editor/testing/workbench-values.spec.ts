import { describe, expect, it } from 'vitest';
import {
  defaultResistanceUnit,
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
});
