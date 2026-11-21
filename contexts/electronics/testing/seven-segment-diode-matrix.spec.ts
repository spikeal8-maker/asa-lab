import { describe, expect, it } from 'vitest';
import { analyseCircuit } from '../domain/simulation.js';
import { sevenSegmentDiodeMatrix } from './fixtures/seven-segment-diode-matrix.js';
import { parseElectronicsDocument } from '../domain/document.js';

// Independent decimal glyph oracle; do not derive it from the fixture routing.
const RAW_DISPLAY_DIGITS = [
  'abcdef',
  'bc',
  'abdeg',
  'abcdg',
  'bcfg',
  'acdfg',
  'acdefg',
  'abc',
  'abcdefg',
  'abcdfg',
];

describe('complete direct 2AA ten-button diode matrix', () => {
  it.each([[], ...RAW_DISPLAY_DIGITS.map((_, digit) => [digit])].map((pressed) => ({ pressed })))(
    'electrically solves pressed $pressed',
    ({ pressed }) => {
      const document = sevenSegmentDiodeMatrix(pressed);
      const result = analyseCircuit(document);
      expect(result.status, JSON.stringify(result.diagnostics)).toBe('solved');
      expect(result.quality.passed, JSON.stringify(result.quality)).toBe(true);
      const display = result.components.find((entry) => entry.componentId === 'display');
      const expected = pressed.length ? RAW_DISPLAY_DIGITS[pressed[0]!]! : '';
      // Independent series-circuit reference: DO35 0.58V + 12Ω, red display
      // 1.9V + 8Ω, 220Ω route + 100Ω shared segment, 2 fresh AA × 0.225Ω.
      const expectedCurrent = expected.length
        ? (3 - 0.58 - 1.9) / (340 + expected.length * 0.45)
        : 0;
      for (const segment of [...'abcdefg', 'dp']) {
        expect((display?.branchBrightness?.[segment] ?? 0) > 0, segment).toBe(
          expected.includes(segment),
        );
        expect(Math.abs(display?.branchCurrents?.[segment] ?? 0)).toBeLessThan(0.01);
        expect(display?.branchCurrents?.[segment] ?? 0).toBeCloseTo(
          expected.includes(segment) ? expectedCurrent : 0,
          8,
        );
      }
      for (const component of result.components.filter((entry) =>
        entry.componentId.startsWith('diode-'),
      )) {
        const digit = Number(component.componentId.split('-')[1]);
        if (!pressed.includes(digit)) expect(Math.abs(component.current)).toBeLessThan(1e-9);
      }
      expect(document.components.filter((c) => c.kind === 'diode')).toHaveLength(49);
      expect(result.quality.finite).toBe(true);
      expect(result.quality.maxKclResidualAmp).toBeLessThanOrEqual(1e-6);
      expect(result.quality.maxSourceVoltageResidualVolt).toBeLessThanOrEqual(1e-9);
    },
  );

  it.each(
    [
      [0, 1],
      [2, 5],
      [3, 4],
      [7, 9],
    ].map((pressed) => ({ pressed })),
  )('combines real electrical branches $pressed without a priority decoder', ({ pressed }) => {
    const result = analyseCircuit(sevenSegmentDiodeMatrix(pressed));
    expect(result.status).toBe('solved');
    expect(result.quality.passed).toBe(true);
    const display = result.components.find((c) => c.componentId === 'display')!;
    const expected = pressed.map((digit) => RAW_DISPLAY_DIGITS[digit]).join('');
    for (const segment of [...'abcdefg', 'dp']) {
      expect((display.branchBrightness?.[segment] ?? 0) > 0).toBe(expected.includes(segment));
      expect(Math.abs(display.branchCurrents?.[segment] ?? 0)).toBeLessThan(0.01);
    }
    for (const diode of result.components.filter((c) => c.componentId.startsWith('diode-'))) {
      if (!pressed.includes(Number(diode.componentId.split('-')[1])))
        expect(Math.abs(diode.current)).toBeLessThan(1e-9);
    }
  });

  it('releases, repeats and reopens the full saved circuit without topology or electrical changes', () => {
    const original = sevenSegmentDiodeMatrix();
    const parsed = parseElectronicsDocument(JSON.parse(JSON.stringify(original)));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.document).toEqual(original);
    expect(JSON.stringify(analyseCircuit(parsed.document))).toBe(
      JSON.stringify(analyseCircuit(original)),
    );
    for (const digit of [0, 9, 1, 8, 2, 7, 3, 6, 4, 5, 0]) {
      const pressed = {
        ...parsed.document,
        components: parsed.document.components.map((c) =>
          c.kind === 'button' ? { ...c, state: c.id === `button-${digit}` } : c,
        ),
      };
      const result = analyseCircuit(pressed);
      expect(result.status).toBe('solved');
      const display = result.components.find((c) => c.componentId === 'display')!;
      expect([...'abcdefg'].filter((s) => (display.branchBrightness?.[s] ?? 0) > 0).join('')).toBe(
        RAW_DISPLAY_DIGITS[digit],
      );
      const released = {
        ...pressed,
        components: pressed.components.map((c) =>
          c.kind === 'button' ? { ...c, state: false } : c,
        ),
      };
      const release = analyseCircuit(released);
      expect(release.quality.passed).toBe(true);
      expect(release.components.find((c) => c.componentId === 'display')?.lit).toBe(false);
    }
  });
});
