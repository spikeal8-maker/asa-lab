import { describe, expect, it } from 'vitest';
import { resistorBandCssColors, resistorFourBandCode } from '../domain/resistor-color-code';

describe('four-band resistor colour code', () => {
  it.each([
    [300, ['orange', 'black', 'brown', 'gold']],
    [4_700, ['yellow', 'violet', 'red', 'gold']],
    [1_000_000, ['brown', 'black', 'green', 'gold']],
    [0.22, ['red', 'red', 'silver', 'gold']],
  ] as const)('maps %s ohm to expected bands', (ohms, colors) => {
    const code = resistorFourBandCode(ohms);
    expect(code.bands.map((band) => band.color)).toEqual(colors);
    expect(code.representedOhms).toBeCloseTo(ohms, 9);
    expect(code.relativeRepresentationError).toBeLessThan(1e-12);
  });

  it('rounds to the nearest representable two-significant-digit value deterministically', () => {
    const code = resistorFourBandCode(1234);
    expect(code.significantDigits).toEqual([1, 2]);
    expect(code.multiplierExponent).toBe(2);
    expect(code.representedOhms).toBe(1200);
    expect(code.relativeRepresentationError).toBeCloseTo(34 / 1234, 12);
  });

  it.each([
    [1, 'brown'],
    [2, 'red'],
    [5, 'gold'],
    [10, 'silver'],
  ] as const)('uses the correct %s%% tolerance band', (tolerance, color) => {
    expect(resistorFourBandCode(330, tolerance).bands[3].color).toBe(color);
  });

  it('returns stable CSS colours for native SVG rendering', () => {
    const colors = resistorBandCssColors(300);
    expect(colors).toHaveLength(4);
    for (const color of colors) expect(color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid resistance %s',
    (value) => {
      expect(() => resistorFourBandCode(value)).toThrow(/positive finite/);
    },
  );
});
