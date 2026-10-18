import { describe, expect, it } from 'vitest';
import {
  createElectronicsAdvanceSession,
  parseElectronicsEngineDocument,
  type ElectronicsTimedState,
  type ElectronicsLedTemporalComponent,
  type ElectronicsLedTemporalObservation,
  type ElectronicsLedTemporalSample,
} from '@asa-lab/electronics/engine';
import type { SolveResult } from '../../api';
import { LedTemporalPresentation } from '../led-temporal-presentation';

function channel(
  componentId: string,
  samples: readonly ElectronicsLedTemporalSample[],
): ElectronicsLedTemporalComponent {
  let brightnessIntegral = 0;
  let litDurationMicroseconds = 0;
  let transitionCount = 0;
  for (let index = 1; index < samples.length; index++) {
    const before = samples[index - 1]!;
    const elapsed = samples[index]!.atMicroseconds - before.atMicroseconds;
    brightnessIntegral += before.brightness * elapsed;
    if (before.brightness > 0) litDurationMicroseconds += elapsed;
    if (before.brightness !== samples[index]!.brightness) transitionCount++;
  }
  return {
    componentId,
    samples,
    brightnessIntegral,
    litDurationMicroseconds,
    transitionCount,
    truncated: false,
  };
}

function point(atMicroseconds: number, brightness: number): ElectronicsLedTemporalSample {
  return { atMicroseconds, brightness, current: brightness > 0 ? 0.01 : 0 };
}

function square(from: number, to: number, half: number, brightness = 80, id = 'led') {
  const at = (time: number) => point(time, Math.floor(time / half) % 2 === 0 ? brightness : 0);
  const samples = [at(from)];
  for (let time = (Math.floor(from / half) + 1) * half; time < to; time += half)
    samples.push(at(time));
  if (to !== from) samples.push(at(to));
  return channel(id, samples);
}

function window(
  fromMicroseconds: number,
  toMicroseconds: number,
  components = [square(fromMicroseconds, toMicroseconds, 1000)],
): ElectronicsLedTemporalObservation {
  return { profile: 'ordinary-led-held-v1', fromMicroseconds, toMicroseconds, components };
}

// These optical signals are deliberately analytic. Actual solver/current provenance
// and transport are challenged in the domain and Worker integration tests.
function electrical(observation: ElectronicsLedTemporalObservation): SolveResult {
  return {
    solved: true,
    status: 'solved',
    current: 0,
    nodes: [],
    diagnostics: [],
    iterations: 1,
    numericalResidual: 0,
    numericalTolerance: 1e-9,
    quality: {
      passed: true,
      finite: true,
      maxKclResidualAmp: 0,
      maxSourceVoltageResidualVolt: 0,
      powerBalanceResidualWatt: 0,
      powerBalanceToleranceWatt: 1e-9,
      kclToleranceAmp: 1e-9,
      sourceVoltageToleranceVolt: 1e-9,
    },
    components: observation.components.map((component) => {
      const final = component.samples.at(-1)!;
      return {
        componentId: component.componentId,
        brightness: final.brightness,
        current: final.current,
        voltageDrop: 0,
        lit: final.brightness > 0,
        terminalVoltages: {},
      };
    }),
  };
}

describe('accepted per-LED temporal presentation', () => {
  it('keeps a real 1ms neighbour visible before, at and after another LED thermally fails', () => {
    const parsed = parseElectronicsEngineDocument({
      schemaVersion: 4,
      components: [
        {
          id: 'uno',
          kind: 'visual',
          componentTypeId: 'arduino-uno',
          value: 5,
          position: { x: 0, y: 0 },
          pinIds: ['d13', 'd12', 'd11', 'power-5v', 'power-3v3', 'power-gnd-1'],
          stateProperties: {
            // The unprotected 5V LED heats from time zero. Let the real MCU
            // wait during warmup, then measure multiple actual 1ms cycles
            // before the failure boundary; earlier switching is not required.
            arduinoSource:
              'void setup(){pinMode(12,OUTPUT);delay(3990);}void loop(){digitalWrite(12,HIGH);delay(1);digitalWrite(12,LOW);delay(1);}',
          },
        },
        {
          id: 'overdriven',
          kind: 'led',
          componentTypeId: 'led-5mm',
          value: 2,
          position: { x: 50, y: 0 },
          pinIds: ['anode', 'cathode'],
        },
        {
          id: 'protected',
          kind: 'led',
          componentTypeId: 'led-5mm',
          value: 2,
          position: { x: 100, y: 0 },
          pinIds: ['anode', 'cathode'],
        },
        {
          id: 'resistor',
          kind: 'resistor',
          componentTypeId: 'resistor-axial',
          value: 330,
          position: { x: 100, y: 50 },
          pinIds: ['lead-1', 'lead-2'],
        },
      ],
      connections: [
        {
          id: 'overdrive',
          from: { componentId: 'uno', terminal: 'power-5v' },
          to: { componentId: 'overdriven', terminal: 'anode' },
        },
        {
          id: 'overground',
          from: { componentId: 'overdriven', terminal: 'cathode' },
          to: { componentId: 'uno', terminal: 'power-gnd-1' },
        },
        {
          id: 'drive',
          from: { componentId: 'uno', terminal: 'd12' },
          to: { componentId: 'resistor', terminal: 'lead-1' },
        },
        {
          id: 'series',
          from: { componentId: 'resistor', terminal: 'lead-2' },
          to: { componentId: 'protected', terminal: 'anode' },
        },
        {
          id: 'ground',
          from: { componentId: 'protected', terminal: 'cathode' },
          to: { componentId: 'uno', terminal: 'power-gnd-1' },
        },
      ],
    });
    if (!parsed.ok) throw new Error(parsed.message);
    const presentation = new LedTemporalPresentation();
    let state: ElectronicsTimedState | undefined;
    let expectedMean = 0;
    for (const horizon of [3_999_999, 4_000_000, 4_000_001]) {
      const session = createElectronicsAdvanceSession(
        parsed.document,
        { requestedHorizonMicroseconds: horizon, ...(state ? { state } : {}) },
        { observeLedTemporal: true },
      );
      let done = session.step();
      for (let batch = 1; !done && batch < 100_000; batch++) done = session.step();
      if (!done) throw new Error('bounded mixed LED request did not finish');
      expect(done.executionStatus, JSON.stringify(done.diagnostics)).toBe('ready');
      const result = done.observation!;
      const damaged = result.components.find(
        (component) => component.componentId === 'overdriven',
      )!;
      if (horizon < 4_000_000) {
        // The destructive operating-point preview still conducts. stressState
        // alone must neither fabricate an open device nor silence its neighbour.
        expect(damaged).toMatchObject({
          lit: true,
          stressState: 'burned',
          damageState: 'none',
          presentationState: 'destructive',
        });
        expect(damaged.current).toBeGreaterThan(0.3);
      } else {
        expect(damaged).toMatchObject({
          lit: false,
          current: 0,
          brightness: 0,
          deviceHealth: 'failed_open',
          damageState: 'failed',
          presentationState: 'failed',
        });
      }
      expect(result.ledTemporal).toBeDefined();
      // Same structural status adapter as the Worker; all solved component,
      // node and quality values remain the actual engine observation.
      const presented = { ...result, status: 'solved' } as SolveResult;
      const projected = presentation.accept(presented, result.ledTemporal);
      const healthy = projected.get('protected');
      expect(healthy).toBeGreaterThan(0);
      expect(projected.has('overdriven')).toBe(false);
      if (horizon < 4_000_000) {
        const peak = Math.max(
          ...result
            .ledTemporal!.components.find((component) => component.componentId === 'protected')!
            .samples.map((sample) => sample.brightness),
        );
        expect(healthy! / peak).toBeCloseTo(0.5, 2);
        expectedMean = healthy!;
      } else expect(healthy).toBeCloseTo(expectedMean, 8);
      state = done.state;
    }
  });

  it.each([2_000_000, 100_000, 50_000])(
    'preserves instantaneous visible phases of %i us',
    (half) => {
      const presentation = new LedTemporalPresentation();
      for (let from = 0; from < half * 4; from += 25_000) {
        const observation = window(from, from + 25_000, [square(from, from + 25_000, half)]);
        expect(presentation.accept(electrical(observation), observation).size).toBe(0);
      }
    },
  );

  it.each([1000, 16_666, 24_999])(
    'shows a steady measured cycle mean at %i us phases without a window beat',
    (half) => {
      const presentation = new LedTemporalPresentation();
      let from = 0;
      const terminalBrightness = new Set<number>();
      for (let index = 1; index <= 30; index++) {
        const to = from + [11_137, 24_923, 17_003][index % 3]!;
        const observation = window(from, to, [square(from, to, half)]);
        const result = electrical(observation);
        const mean = presentation.accept(result, observation).get('led');
        if (to > half * 5) expect(mean).toBeCloseTo(40, 10);
        terminalBrightness.add(result.components[0]!.brightness!);
        from = to;
      }
      expect([...terminalBrightness].sort()).toEqual([0, 80]);
    },
  );

  it('integrates unequal actual optical phases instead of averaging their states or current', () => {
    const samples = [point(0, 80)];
    for (let cycle = 0; cycle < 4; cycle++) {
      samples.push(point(cycle * 4000 + 1000, 0));
      samples.push(point((cycle + 1) * 4000, 80));
    }
    const observation = window(0, 16_000, [channel('led', samples)]);
    expect(
      new LedTemporalPresentation().accept(electrical(observation), observation).get('led'),
    ).toBe(20);
  });

  it('keeps a fast, a slow and a constant output independent', () => {
    const presentation = new LedTemporalPresentation();
    let from = 0;
    for (const to of [17_003, 41_997, 67_001, 90_007]) {
      const observation = window(from, to, [
        square(from, to, 1000, 80, 'fast'),
        square(from, to, 50_000, 60, 'slow'),
        channel('steady', [point(from, 30), point(to, 30)]),
      ]);
      const projection = presentation.accept(electrical(observation), observation);
      expect([...projection]).toEqual([['fast', 40]]);
      from = to;
    }
  });

  it.each([0, 80])(
    'replaces the previous average promptly after the output holds at %i',
    (level) => {
      const presentation = new LedTemporalPresentation();
      const fast = window(0, 10_000);
      expect(presentation.accept(electrical(fast), fast).get('led')).toBe(40);
      const held = window(10_000, 36_000, [
        channel('led', [point(10_000, 80), point(10_001, level), point(36_000, level)]),
      ]);
      expect(presentation.accept(electrical(held), held).size).toBe(0);
      expect(electrical(held).components[0]!.brightness).toBe(level);
    },
  );

  it('forgets history on reset and on missing or noncontiguous observations', () => {
    const presentation = new LedTemporalPresentation();
    const fast = window(0, 10_000);
    expect(presentation.accept(electrical(fast), fast).get('led')).toBe(40);
    presentation.reset();
    const short = window(0, 500);
    expect(presentation.accept(electrical(short), short).size).toBe(0);
    presentation.accept(electrical(fast), fast);
    presentation.accept(electrical(fast));
    const next = window(10_000, 10_500);
    expect(presentation.accept(electrical(next), next).size).toBe(0);
    presentation.accept(electrical(fast), fast);
    const gap = window(11_000, 11_500);
    expect(presentation.accept(electrical(gap), gap).size).toBe(0);
  });

  it.each(['reverse', 'burned', 'disconnected'])(
    'cannot override an actual %s electrical state',
    (failure) => {
      const observation = window(0, 10_000);
      const result = electrical(observation);
      const component = result.components[0]!;
      const changed =
        failure === 'reverse'
          ? { ...component, junctionState: 'reverse_blocking' }
          : failure === 'burned'
            ? { ...component, presentationState: 'failed', stressState: 'burned' }
            : { ...component, brightness: 0, current: 0 };
      expect(
        new LedTemporalPresentation().accept(
          { ...result, components: [changed] } as SolveResult,
          observation,
        ).size,
      ).toBe(0);
    },
  );

  it('retains the true cycle mean even when the bounded raw trace has overflowed', () => {
    const full = square(0, 2000, 1);
    const component = { ...full, truncated: true, samples: full.samples.slice(-512) };
    const observation = window(0, 2000, [component]);
    expect(component.transitionCount).toBe(2000);
    expect(
      new LedTemporalPresentation().accept(electrical(observation), observation).get('led'),
    ).toBe(40);
  });

  it.each([0, 80])(
    'expires a former fast cycle exactly 25,000 us after the last edge, held %i',
    (level) => {
      for (const age of [24_999, 25_000]) {
        const presentation = new LedTemporalPresentation();
        // End at the existing edge into the requested held state, so no programme
        // change or structural reset is invented at an already committed time.
        const lastEdge = level === 0 ? 11_000 : 10_000;
        const fast = window(0, lastEdge);
        presentation.accept(electrical(fast), fast);
        const held = window(lastEdge, lastEdge + age, [
          channel('led', [point(lastEdge, level), point(lastEdge + age, level)]),
        ]);
        const mean = presentation.accept(electrical(held), held).get('led');
        if (age === 24_999) expect(mean).toBe(40);
        else expect(mean).toBeUndefined();
      }
    },
  );

  it.each(['reverse', 'burned', 'disconnected'])(
    'keeps a healthy fast neighbour when a second LED is %s',
    (failure) => {
      const observation = window(0, 10_000, [
        square(0, 10_000, 1000, 80, 'healthy'),
        channel('other', [point(0, 0), point(10_000, 0)]),
      ]);
      const result = electrical(observation);
      const other = result.components[1]!;
      const state =
        failure === 'reverse'
          ? { junctionState: 'reverse_blocking' }
          : failure === 'burned'
            ? { presentationState: 'failed', stressState: 'burned' }
            : {};
      const projection = new LedTemporalPresentation().accept(
        { ...result, components: [result.components[0]!, { ...other, ...state }] } as SolveResult,
        observation,
      );
      expect([...projection]).toEqual([['healthy', 40]]);
    },
  );

  it.each(['nan', 'integral', 'order', 'duplicate', 'end', 'summary', 'profile'])(
    'rejects malformed %s metadata and clears old history',
    (kind) => {
      const presentation = new LedTemporalPresentation();
      const initial = window(0, 10_000);
      presentation.accept(electrical(initial), initial);
      const valid = window(10_000, 20_000);
      const malformed = structuredClone(valid);
      const component = malformed.components[0]!;
      if (kind === 'nan') Object.assign(component.samples[1]!, { brightness: NaN });
      if (kind === 'integral') Object.assign(component, { brightnessIntegral: -1 });
      if (kind === 'order') Object.assign(component.samples[1]!, { atMicroseconds: 9000 });
      if (kind === 'duplicate') Object.assign(malformed, { components: [component, component] });
      if (kind === 'end') Object.assign(component.samples.at(-1)!, { atMicroseconds: 19_999 });
      if (kind === 'summary') Object.assign(component, { transitionCount: 1 });
      if (kind === 'profile') Object.assign(malformed, { profile: 'invented' });
      expect(presentation.accept(electrical(valid), malformed).size).toBe(0);
      const next = window(20_000, 20_500);
      expect(presentation.accept(electrical(next), next).size).toBe(0);
    },
  );
});
