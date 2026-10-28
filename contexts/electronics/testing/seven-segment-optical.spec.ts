import { describe, expect, it } from 'vitest';
import { createElectronicsAdvanceSession, type ElectronicsTimedState } from '../engine.js';
import { createLedTemporalObservation } from '../domain/led-temporal-observation.js';
import { arduinoSevenSegmentMatrix } from './fixtures/arduino-seven-segment-matrix.js';
import type { ElectronicsDocument } from '../domain/document.js';

function run(
  document: ElectronicsDocument,
  raw: boolean,
  ordinary = false,
  state?: ElectronicsTimedState,
  target = 30000,
) {
  const session = createElectronicsAdvanceSession(
    document,
    { requestedHorizonMicroseconds: target, ...(state ? { state } : {}) },
    { observeLedTemporal: ordinary, observeSevenSegmentTemporal: raw },
  );
  try {
    let next;
    do {
      next = session.step();
    } while (!next);
    if (next.executionStatus !== 'ready') throw new Error(JSON.stringify(next.diagnostics));
    return next;
  } finally {
    session.dispose();
  }
}

function electrical(result: ReturnType<typeof run>) {
  const observation = { ...result.observation };
  delete observation.ledTemporal;
  return JSON.stringify({ ...result, observation });
}

describe('explicit raw-display optical observations', () => {
  it.each([1, 4] as const)(
    'preserves full physical/runtime continuation and result bytes for %i NPN displays',
    (count) => {
      const document = arduinoSevenSegmentMatrix(count);
      const beforeStarted = performance.now();
      const before = run(document, false, false, undefined, 25001);
      const beforeMs = performance.now() - beforeStarted;
      const captureStarted = performance.now();
      const after = run(document, true, false, undefined, 25001);
      console.log(
        'Optical capture ordered local sample (warmup-sensitive, not realtime acceptance)',
        { count, horizon: 25001, beforeMs, captureMs: performance.now() - captureStarted },
      );
      expect(electrical(after)).toBe(electrical(before));
      expect(JSON.stringify(after.state)).toBe(JSON.stringify(before.state));
      expect(after.observation.ledTemporal?.sevenSegments).toHaveLength(count);
      for (const display of after.observation.ledTemporal!.sevenSegments!) {
        expect(display.branches.map((branch) => branch.componentId)).toEqual([
          'a',
          'b',
          'c',
          'd',
          'e',
          'f',
          'g',
          'dp',
        ]);
        for (const branch of display.branches) {
          expect(branch.samples[0]!.atMicroseconds).toBe(0);
          expect(branch.samples.at(-1)!.atMicroseconds).toBe(25001);
          expect(
            branch.samples.every(
              (sample) => Number.isFinite(sample.current) && Number.isFinite(sample.brightness),
            ),
          ).toBe(true);
        }
      }
      const resumedBefore = run(
        document,
        false,
        false,
        JSON.parse(JSON.stringify(before.state)),
        50003,
      );
      const resumedAfter = run(
        document,
        true,
        false,
        JSON.parse(JSON.stringify(after.state)),
        50003,
      );
      expect(electrical(resumedAfter)).toBe(electrical(resumedBefore));
      expect(resumedAfter.observation.ledTemporal!.fromMicroseconds).toBe(25001);
      expect(
        resumedAfter.observation.ledTemporal!.sevenSegments![0]!.branches[0]!.samples[0]!
          .atMicroseconds,
      ).toBe(25001);
    },
  );

  it('supports raw-only, ordinary-only, both and neither without a silent opt-in dependency', () => {
    const document = arduinoSevenSegmentMatrix(1);
    expect(run(document, false, false).observation.ledTemporal).toBeUndefined();
    expect(run(document, false, true).observation.ledTemporal).toBeUndefined();
    const raw = run(document, true, false).observation.ledTemporal!;
    expect(raw.sevenSegments).toHaveLength(1);
    expect(raw.arduinoIndicators).toBeUndefined();
    expect(raw.components).toEqual([]);
    const both = run(document, true, true).observation.ledTemporal!;
    expect(both.sevenSegments).toHaveLength(1);
    expect(both.arduinoIndicators?.map((indicator) => indicator.componentId)).toEqual(['uno']);
  });

  it('keeps combined capture byte-identical to legacy capture when no raw display exists', () => {
    const base = arduinoSevenSegmentMatrix(1);
    const document: ElectronicsDocument = {
      ...base,
      components: base.components.filter((component) => !component.id.startsWith('display-')),
      connections: base.connections.filter(
        (connection) =>
          !connection.from.componentId.startsWith('display-') &&
          !connection.to.componentId.startsWith('display-'),
      ),
    };
    expect(JSON.stringify(run(document, true, true))).toBe(
      JSON.stringify(run(document, false, true)),
    );
  });

  it('does not change mixed RC/thermal state or accepted physics through optical-only reads', () => {
    const base = arduinoSevenSegmentMatrix(1);
    const document: ElectronicsDocument = {
      ...base,
      components: [
        ...base.components,
        {
          id: 'cap',
          kind: 'visual',
          componentTypeId: 'electrolytic-capacitor',
          value: 0.1,
          pinIds: ['positive', 'negative'],
          position: { x: 0, y: 0 },
          stateProperties: { initialVoltageVolt: 0, voltageRatingVolt: 25 },
        },
      ],
      connections: [
        ...base.connections,
        {
          id: 'cap-signal',
          from: { componentId: 'cap', terminal: 'positive' },
          to: { componentId: 'display-0', terminal: 'top-5' },
        },
        {
          id: 'cap-ground',
          from: { componentId: 'cap', terminal: 'negative' },
          to: { componentId: 'uno', terminal: 'power-gnd-1' },
        },
      ],
    };
    const before = run(document, false, false, undefined, 10001);
    const after = run(document, true, false, undefined, 10001);
    expect(electrical(after)).toBe(electrical(before));
    expect(JSON.stringify(after.state)).toBe(JSON.stringify(before.state));
    expect(
      electrical(run(document, true, false, JSON.parse(JSON.stringify(after.state)), 20003)),
    ).toBe(
      electrical(run(document, false, false, JSON.parse(JSON.stringify(before.state)), 20003)),
    );
  });

  it('discards a private partial collector on cancellation and preserves the next fresh run', () => {
    const document = arduinoSevenSegmentMatrix(1);
    const frozen = JSON.stringify(document);
    const session = createElectronicsAdvanceSession(
      document,
      { requestedHorizonMicroseconds: 30000, maxEvents: 1 },
      { observeSevenSegmentTemporal: true },
    );
    expect(session.step()).toBeNull();
    session.dispose();
    expect(session.step()).toBeUndefined();
    expect(JSON.stringify(document)).toBe(frozen);
    expect(electrical(run(document, true))).toBe(electrical(run(document, false)));
  });

  it('invalidates incomplete, duplicate and nonfinite branch collectors without emitting partial metadata', () => {
    const sample = run(arduinoSevenSegmentMatrix(1), true).observation.components;
    for (const malformed of ['missing', 'nonfinite'] as const) {
      const collector = createLedTemporalObservation([], 0, [], ['display-0']);
      const components = structuredClone(sample);
      const display = components.find((component) => component.componentId === 'display-0')!;
      const brightness = { ...display.branchBrightness };
      if (malformed === 'missing') delete brightness.dp;
      else brightness.dp = Number.NaN;
      collector.observe(
        0,
        components.map((component) =>
          component === display ? { ...component, branchBrightness: brightness } : component,
        ),
      );
      collector.observe(1000, sample);
      expect(collector.finish(1000)).toBeNull();
    }
    const duplicate = createLedTemporalObservation([], 0, [], ['display-0', 'display-0']);
    duplicate.observe(0, sample);
    expect(duplicate.finish(0)).toBeNull();
    const cancelled = createLedTemporalObservation([], 0, [], ['display-0']);
    cancelled.observe(0, sample);
    cancelled.invalidate();
    cancelled.observe(1000, sample);
    expect(cancelled.finish(1000)).toBeNull();
  });

  it('records first reported failed health at 20ms instead of backdating it to a normal dark edge at 18ms', () => {
    const components = run(arduinoSevenSegmentMatrix(1), true).observation.components;
    const dark = components.map((component) =>
      component.componentId === 'display-0'
        ? {
            ...component,
            current: 0,
            brightness: 0,
            lit: false,
            branchBrightness: Object.fromEntries(
              ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'dp'].map((segment) => [segment, 0]),
            ),
            branchCurrents: Object.fromEntries(
              ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'dp'].map((segment) => [segment, 0]),
            ),
          }
        : component,
    );
    const failed = dark.map((component) =>
      component.componentId === 'display-0'
        ? {
            ...component,
            deviceHealth: 'failed_open' as const,
            damageState: 'failed' as const,
            presentationState: 'failed' as const,
          }
        : component,
    );
    const collector = createLedTemporalObservation([], 0, [], ['display-0']);
    collector.observe(0, components);
    collector.observe(18000, dark);
    expect(collector.finish(18000)!.sevenSegments![0]!.failedAtMicroseconds).toBeUndefined();
    collector.observe(20000, failed);
    collector.observe(30000, failed);
    const display = collector.finish(30000)!.sevenSegments![0]!;
    expect(display.failedAtMicroseconds).toBe(20000);
    expect(
      display.branches
        .find((branch) => branch.componentId === 'b')!
        .samples.map((sample) => sample.atMicroseconds),
    ).toEqual([0, 18000, 30000]);
  });
});
