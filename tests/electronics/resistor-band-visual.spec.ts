import { describe, expect, it } from 'vitest';
import { resistorFourBandCode } from '../../contexts/electronics/domain/resistor-color-code';
import { resistorVisualCode } from '../../apps/web/src/electronics/resistor-band-visual';

const values = [0.22, 1, 4.7, 10, 47, 100, 220, 300, 470, 1000, 4700, 10000, 1_000_000, 1_000_000_000];
const tolerances = [1, 2, 5, 10] as const;

describe('resistor visual band parity', () => {
  it.each(values)('matches the domain four-band model for %s ohm', (value) => {
    const domain = resistorFourBandCode(value, 5);
    const visual = resistorVisualCode(value, 5);
    expect(visual.representedOhms).toBe(domain.representedOhms);
    expect(visual.relativeError).toBeCloseTo(domain.relativeRepresentationError, 12);
    expect(visual.bands.map((band) => band.color)).toEqual(
      domain.bands.map((band) => band.color),
    );
    expect(visual.bands.map((band) => band.cssColor)).toEqual(
      domain.bands.map((band) => band.cssColor),
    );
  });

  it.each(tolerances)('uses the same tolerance band at ±%s percent', (tolerance) => {
    expect(resistorVisualCode(300, tolerance).bands[3].color).toBe(
      resistorFourBandCode(300, tolerance).bands[3].color,
    );
  });

  it('changes the rendered band model when the electrical value changes', () => {
    expect(resistorVisualCode(300).bands.map((band) => band.color)).toEqual([
      'orange',
      'black',
      'brown',
      'gold',
    ]);
    expect(resistorVisualCode(1000).bands.map((band) => band.color)).toEqual([
      'brown',
      'black',
      'red',
      'gold',
    ]);
    expect(resistorVisualCode(300).bands).not.toEqual(resistorVisualCode(1000).bands);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid visible resistance %s',
    (value) => {
      expect(() => resistorVisualCode(value)).toThrow(/positive finite/);
    },
  );
});
