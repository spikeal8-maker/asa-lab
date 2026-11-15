import { describe, expect, it, vi } from 'vitest';
import {
  createElectronicsAdvanceSession,
  parseElectronicsEngineDocument,
  type ElectronicsEngineDocument,
  type ElectronicsTimedAdvanceRequest,
} from '../engine';
import { createLedTemporalObservation } from '../domain/led-temporal-observation';
import * as solver from '../domain/solver';
import * as simulation from '../domain/simulation';

function ledResult(brightness: number, current = brightness > 0 ? 0.01 : 0) {
  return { componentId: 'led', brightness, current, lit: brightness > 0 } as solver.ComponentResult;
}

const pins = [13, 12, 11];
function sketch(delay: number | null) {
  return `void setup(){${pins.map((pin) => `pinMode(${pin},OUTPUT);`).join('')}}
    void loop(){${pins.map((pin) => `digitalWrite(${pin},HIGH);`).join('')}
    ${delay === null ? '' : `delay(${delay});${pins.map((pin) => `digitalWrite(${pin},LOW);`).join('')}delay(${delay});`}}`;
}

function circuit(source = sketch(1)): ElectronicsEngineDocument {
  const parsed = parseElectronicsEngineDocument({
    schemaVersion: 4,
    components: [
      {
        id: 'uno',
        kind: 'visual',
        value: 5,
        position: { x: 0, y: 0 },
        componentTypeId: 'arduino-uno',
        pinIds: ['d13', 'd12', 'd11', 'power-5v', 'power-3v3', 'power-gnd-1'],
        stateProperties: { arduinoSource: source },
      },
      ...pins.flatMap((pin) => [
        {
          id: `r${pin}`,
          kind: 'resistor',
          value: 330,
          position: { x: pin * 30, y: 0 },
          componentTypeId: 'resistor-axial',
          pinIds: ['lead-1', 'lead-2'],
        },
        {
          id: `led${pin}`,
          kind: 'led',
          value: 2,
          position: { x: pin * 30, y: 50 },
          componentTypeId: 'led-5mm',
          pinIds: ['anode', 'cathode'],
        },
      ]),
    ],
    connections: pins.flatMap((pin) => [
      {
        id: `drive${pin}`,
        from: { componentId: 'uno', terminal: `d${pin}` },
        to: { componentId: `r${pin}`, terminal: 'lead-1' },
      },
      {
        id: `series${pin}`,
        from: { componentId: `r${pin}`, terminal: 'lead-2' },
        to: { componentId: `led${pin}`, terminal: 'anode' },
      },
      {
        id: `ground${pin}`,
        from: { componentId: `led${pin}`, terminal: 'cathode' },
        to: { componentId: 'uno', terminal: 'power-gnd-1' },
      },
    ]),
  });
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.document;
}

function finish(
  document: ElectronicsEngineDocument,
  request: ElectronicsTimedAdvanceRequest,
  observeLedTemporal = true,
) {
  const session = createElectronicsAdvanceSession(document, request, { observeLedTemporal });
  for (let count = 0; count < 100_000; count++) {
    const result = session.step();
    if (result) return result;
  }
  throw new Error('request did not finish');
}

function physical(result: ReturnType<typeof finish>) {
  if (!result.observation) return result;
  const observation = { ...result.observation };
  delete observation.ledTemporal;
  return { ...result, observation };
}

describe('LED optical observation from held electrical states', () => {
  it('collects solved D13 voltage with no external LED and bounds its ordered history', () => {
    const observation = createLedTemporalObservation([], 0, ['uno']);
    for (let time = 0; time <= 1500; time++) {
      observation.observe(time, [
        {
          componentId: 'uno',
          terminalVoltages: { d13: time % 2 ? 5 : 0 },
        } as solver.ComponentResult,
      ]);
    }
    const result = observation.finish(1500)!;
    expect(result.components).toEqual([]);
    const indicator = result.arduinoIndicators![0]!;
    expect(indicator.truncated).toBe(true);
    expect(indicator.samples.length).toBeLessThanOrEqual(513);
    expect(indicator.samples[0]!.atMicroseconds).toBeGreaterThan(0);
    expect(indicator.samples.at(-1)).toEqual({ atMicroseconds: 1500, voltage: 0 });
    expect(
      indicator.samples.every(
        (sample, index) =>
          index === 0 || sample.atMicroseconds > indicator.samples[index - 1]!.atMicroseconds,
      ),
    ).toBe(true);
  });

  it.each(['connected', 'open', 'reversed', 'standalone'] as const)(
    'observes real solved D13 independently of the %s external LED circuit',
    (kind) => {
      const base = circuit(
        'void setup(){pinMode(13,OUTPUT);}void loop(){digitalWrite(13,HIGH);delay(1);digitalWrite(13,LOW);delay(1);}',
      );
      const parsed = parseElectronicsEngineDocument({
        ...base,
        components: kind === 'standalone' ? [base.components[0]] : base.components,
        connections:
          kind === 'standalone'
            ? []
            : kind === 'open'
              ? base.connections.filter((wire) => wire.id !== 'series13')
              : kind === 'reversed'
                ? base.connections.map((wire) =>
                    wire.id === 'series13'
                      ? { ...wire, to: { componentId: 'led13', terminal: 'cathode' } }
                      : wire.id === 'ground13'
                        ? { ...wire, from: { componentId: 'led13', terminal: 'anode' } }
                        : wire,
                  )
                : base.connections,
      });
      if (!parsed.ok) throw new Error(parsed.message);
      const document = parsed.document;
      const request = { requestedHorizonMicroseconds: 4500, maxEvents: 1024 };
      const actual = finish(document, request);
      expect(actual.executionStatus).toBe('ready');
      expect(actual.observation!.quality.passed).toBe(true);
      expect(physical(actual)).toStrictEqual(physical(finish(document, request, false)));
      const temporal = actual.observation!.ledTemporal!;
      const indicator = temporal.arduinoIndicators!.find((entry) => entry.componentId === 'uno')!;
      const runtime = JSON.parse(actual.state.continuation!.serializedState).boards[0].runtime;
      const events = runtime.eventQueue.filter(
        (event: { terminal: string; kind: string }) =>
          event.terminal === 'd13' && event.kind === 'output-change',
      );
      expect(events.length).toBeGreaterThanOrEqual(4);
      for (const event of events) {
        const sample = indicator.samples.find(
          (entry) => entry.atMicroseconds === event.atMicroseconds,
        );
        expect(sample).toBeDefined();
        // GPIO records the ideal source voltage. Compare its exact event time
        // with an independent quality-passed circuit solve at that horizon.
        const checkpoint = finish(
          document,
          { requestedHorizonMicroseconds: event.atMicroseconds, maxEvents: 1024 },
          false,
        );
        expect(checkpoint.executionStatus).toBe('ready');
        expect(checkpoint.observation!.quality.passed).toBe(true);
        expect(checkpoint.observation!.ledTemporal).toBeUndefined();
        const board = checkpoint.observation!.components.find(
          (entry) => entry.componentId === 'uno',
        )!;
        expect(sample!.voltage).toBe(board.terminalVoltages.d13);
        expect(sample!.voltage >= 2.5).toBe(event.voltage >= 2.5);
      }
      const led = temporal.components.find((entry) => entry.componentId === 'led13');
      for (const at of [250, 1250, 2250, 3250, 4250]) {
        const voltage = indicator.samples
          .filter((sample) => sample.atMicroseconds <= at)
          .at(-1)!.voltage;
        expect(voltage >= 2.5).toBe(Math.floor(at / 1000) % 2 === 0);
        if (led) {
          const brightness = led.samples
            .filter((sample) => sample.atMicroseconds <= at)
            .at(-1)!.brightness;
          expect(brightness > 0).toBe(kind === 'connected' && voltage >= 2.5);
        }
      }
      const final = indicator.samples.at(-1)!;
      expect(final.atMicroseconds).toBe(4500);
      expect(final.voltage).toBe(
        actual.observation!.components.find((entry) => entry.componentId === 'uno')!
          .terminalVoltages.d13,
      );
    },
  );

  it('discards a nonfinite solved D13 observation and does not manufacture an L value', () => {
    const observation = createLedTemporalObservation([], 0, ['uno']);
    observation.observe(0, [
      { componentId: 'uno', terminalVoltages: { d13: NaN } } as solver.ComponentResult,
    ]);
    expect(observation.finish(0)).toBeNull();
  });

  it('integrates actual nonlinear brightness and coalesces zero-duration electrical settles', () => {
    const observation = createLedTemporalObservation(['led'], 0);
    observation.observe(0, [ledResult(0)]);
    observation.observe(10, [ledResult(20, 0.002)]);
    observation.observe(10, [ledResult(60, 0.01)]);
    observation.observe(20, [ledResult(0)]);
    observation.observe(30, [ledResult(80)]);
    observation.observe(30, [ledResult(0)]);
    observation.observe(40, [ledResult(0)]);
    const led = observation.finish(40)!.components[0]!;
    expect(led.brightnessIntegral).toBe(600);
    expect(led.litDurationMicroseconds).toBe(10);
    expect(led.transitionCount).toBe(2);
    expect(led.samples.map((sample) => [sample.atMicroseconds, sample.brightness])).toEqual([
      [0, 0],
      [10, 60],
      [20, 0],
      [40, 0],
    ]);
  });

  it('clips the existing checkpoint seed to the committed start without counting past light', () => {
    const observation = createLedTemporalObservation(['led'], 537);
    observation.observe(0, [ledResult(60)]);
    observation.observe(1000, [ledResult(60)]);
    expect(observation.finish(1000)!.components[0]).toMatchObject({
      brightnessIntegral: 60 * 463,
      litDurationMicroseconds: 463,
      transitionCount: 0,
      samples: [{ atMicroseconds: 537 }, { atMicroseconds: 1000 }],
    });
  });

  it('bounds the trace but retains every optical duration, integral and transition', () => {
    const observation = createLedTemporalObservation(['led'], 0);
    for (let time = 0; time <= 1500; time++)
      observation.observe(time, [ledResult(time % 2 ? 100 : 0)]);
    const led = observation.finish(1500)!.components[0]!;
    expect(led).toMatchObject({
      truncated: true,
      brightnessIntegral: 75_000,
      litDurationMicroseconds: 750,
      transitionCount: 1500,
    });
    expect(led.samples.length).toBeLessThanOrEqual(513);
    expect(led.samples[0]!.atMicroseconds).toBeGreaterThan(0);
    expect(led.samples.at(-1)!.atMicroseconds).toBe(1500);
  });

  it.each([NaN, -1, 101])('withholds an invalid optical value %s', (brightness) => {
    const observation = createLedTemporalObservation(['led'], 0);
    observation.observe(0, [ledResult(20)]);
    observation.observe(10, [ledResult(brightness)]);
    observation.observe(20, [ledResult(20)]);
    expect(observation.finish(20)).toBeNull();
  });

  it('preserves summary counts when a full ring receives a same-time transition and revert', () => {
    const observation = createLedTemporalObservation(['led'], 0);
    for (let time = 0; time <= 511; time++)
      observation.observe(time, [ledResult(time % 2 ? 100 : 0)]);
    observation.observe(512, [ledResult(0)]);
    observation.observe(512, [ledResult(100)]);
    observation.observe(513, [ledResult(100)]);
    const led = observation.finish(513)!.components[0]!;
    expect(led).toMatchObject({
      brightnessIntegral: 25_700,
      litDurationMicroseconds: 257,
      transitionCount: 511,
      truncated: true,
    });
    expect(led.samples.at(-1)).toMatchObject({ atMicroseconds: 513, brightness: 100 });
    expect(led.samples.some((sample) => sample.atMicroseconds === 512)).toBe(false);
    expect(
      led.samples.every(
        (sample, index, all) =>
          index === 0 || sample.atMicroseconds > all[index - 1]!.atMicroseconds,
      ),
    ).toBe(true);
  });
});

describe('LED observation in the actual Arduino/physics engine', () => {
  it.each([2000, 100, 50, 1])(
    'observes the physical three-LED fronts and duty for delay(%i)',
    (delay) => {
      const d = delay * 1000;
      const period = 2 * d + 9;
      const done = finish(circuit(sketch(delay)), { requestedHorizonMicroseconds: period + 8 });
      expect(done.executionStatus, JSON.stringify(done.diagnostics)).toBe('ready');
      expect(done.observation?.quality.passed).toBe(true);
      expect(done.state.continuation?.clockProfileId).toBe('electrothermal-events-v2');
      const optical = done.observation!.ledTemporal!;
      expect(optical).toBeDefined();
      for (const [index, pin] of pins.entries()) {
        const led = optical.components.find((entry) => entry.componentId === `led${pin}`)!;
        const edges = led.samples.filter(
          (sample, at, all) => at > 0 && sample.brightness > 0 !== all[at - 1]!.brightness > 0,
        );
        expect(edges.map((sample) => sample.atMicroseconds)).toEqual([
          4 + index,
          d + 8 + index,
          period + 4 + index,
        ]);
        expect(led.litDurationMicroseconds).toBe(d + 8 - index);
        expect(led.brightnessIntegral).toBeGreaterThan(0);
        expect(
          edges.filter((sample) => sample.brightness > 0).every((sample) => sample.current > 0),
        ).toBe(true);
      }
    },
  );

  it('keeps physical returns, quality work and solve count unchanged across private budgets', () => {
    const document = circuit();
    const request = { requestedHorizonMicroseconds: 20_123 };
    const solves = vi.spyOn(solver, 'solveRcCircuitWithHeldArduino');
    const quality = vi.spyOn(simulation, 'verifyCircuitQuality');
    try {
      const baseline = finish(document, request, false);
      expect(baseline.executionStatus, JSON.stringify(baseline.diagnostics)).toBe('ready');
      const solveCount = solves.mock.calls.length;
      const qualityCount = quality.mock.calls.length;
      solves.mockClear();
      quality.mockClear();
      const observed = finish(document, request);
      expect(physical(observed)).toStrictEqual(baseline);
      expect(solves).toHaveBeenCalledTimes(solveCount);
      expect(quality).toHaveBeenCalledTimes(qualityCount);
      for (const maxEvents of [1, 7])
        expect(finish(document, { ...request, maxEvents })).toStrictEqual(observed);
    } finally {
      solves.mockRestore();
      quality.mockRestore();
    }
  });

  it('preserves physics and optical area through non-barrier UI horizons and JSON continuation', () => {
    const document = circuit();
    const original = structuredClone(document);
    const whole = finish(document, { requestedHorizonMicroseconds: 20_123 });
    const integrals = new Map<string, number>();
    let state;
    let partitioned = whole;
    for (const horizon of [0, 537, 1033, 2739, 5081, 20_123]) {
      const before = JSON.stringify(state);
      partitioned = finish(document, {
        requestedHorizonMicroseconds: horizon,
        state,
        maxEvents: 7,
      });
      expect(JSON.stringify(state)).toBe(before);
      expect(partitioned.executionStatus).toBe('ready');
      for (const led of partitioned.observation!.ledTemporal!.components)
        integrals.set(
          led.componentId,
          (integrals.get(led.componentId) ?? 0) + led.brightnessIntegral,
        );
      state = JSON.parse(JSON.stringify(partitioned.state));
    }
    expect(physical(partitioned)).toStrictEqual(physical(whole));
    for (const led of whole.observation!.ledTemporal!.components)
      expect(integrals.get(led.componentId)).toBeCloseTo(led.brightnessIntegral, 6);
    expect(document).toStrictEqual(original);
  });

  it('keeps three no-delay HIGH loads lit without accumulating duplicate samples', () => {
    const document = circuit(sketch(null));
    const done = finish(document, { requestedHorizonMicroseconds: 20_000 });
    expect(done.executionStatus).toBe('ready');
    for (const [index, pin] of pins.entries()) {
      const led = done.observation!.ledTemporal!.components.find(
        (entry) => entry.componentId === `led${pin}`,
      )!;
      expect(led.litDurationMicroseconds).toBe(20_000 - 4 - index);
      expect(led.samples.length).toBeLessThanOrEqual(6);
      expect(led.samples.at(-1)!.brightness).toBeGreaterThan(0);
    }
  });

  it('does not invent light in disconnected or reversed branches while their neighbour conducts', () => {
    const original = circuit();
    const document = {
      ...original,
      connections: original.connections
        .filter((wire) => wire.id !== 'series13')
        .map((wire) => ({
          ...wire,
          from: wire.from.componentId === 'led12' ? { ...wire.from, terminal: 'anode' } : wire.from,
          to: wire.to.componentId === 'led12' ? { ...wire.to, terminal: 'cathode' } : wire.to,
        })),
    } as ElectronicsEngineDocument;
    const done = finish(document, { requestedHorizonMicroseconds: 20_123 });
    expect(done.executionStatus).toBe('ready');
    for (const id of ['led13', 'led12']) {
      const led = done.observation!.ledTemporal!.components.find(
        (entry) => entry.componentId === id,
      )!;
      expect(led.brightnessIntegral).toBe(0);
      expect(led.samples.every((sample) => sample.brightness === 0)).toBe(true);
    }
    expect(
      done.observation!.ledTemporal!.components.find((led) => led.componentId === 'led11')!
        .brightnessIntegral,
    ).toBeGreaterThan(0);
  });

  it('discards all private optical progress when later runtime work faults', () => {
    const document = circuit(
      'void setup(){pinMode(13,OUTPUT);digitalWrite(13,HIGH);delay(1);int n=0;int bad=1/n;}void loop(){}',
    );
    const initial = finish(document, { requestedHorizonMicroseconds: 0 });
    const saved = JSON.stringify(initial.state);
    const session = createElectronicsAdvanceSession(
      document,
      {
        requestedHorizonMicroseconds: 5000,
        state: initial.state,
        maxEvents: 1,
      },
      { observeLedTemporal: true },
    );
    let pending = 0;
    let result;
    do {
      result = session.step();
      if (!result) pending++;
    } while (!result && pending < 1000);
    expect(pending).toBeGreaterThan(3);
    expect(result).toMatchObject({
      executionStatus: 'fault',
      observation: null,
      committedHorizonMicroseconds: 0,
    });
    expect(JSON.stringify(result!.state)).toBe(saved);
    expect(JSON.stringify(initial.state)).toBe(saved);
  });

  it('ends real LED emission at its thermal failure boundary while a protected neighbour stays lit', () => {
    const original = circuit('void setup(){}void loop(){delay(1000);}');
    const document = {
      ...original,
      components: original.components.filter((component) => component.id !== 'r13'),
      connections: original.connections
        .filter((wire) => wire.id !== 'drive13')
        .map((wire) =>
          wire.id === 'series13'
            ? { ...wire, from: { componentId: 'uno', terminal: 'power-5v' } }
            : wire.id.startsWith('drive')
              ? { ...wire, from: { componentId: 'uno', terminal: 'power-5v' } }
              : wire,
        ),
    } as ElectronicsEngineDocument;
    const before = finish(document, { requestedHorizonMicroseconds: 3_999_999 });
    expect(before.executionStatus, JSON.stringify(before.diagnostics)).toBe('ready');
    const light = before.observation!.components.find(
      (component) => component.componentId === 'led13',
    )!;
    expect(light.lit).toBe(true);
    const after = finish(document, {
      requestedHorizonMicroseconds: 4_000_001,
      state: before.state,
    });
    expect(after.executionStatus, JSON.stringify(after.diagnostics)).toBe('ready');
    expect(
      after.observation!.components.find((component) => component.componentId === 'led13'),
    ).toMatchObject({
      brightness: 0,
      lit: false,
      current: 0,
      presentationState: 'failed',
    });
    expect(
      after.observation?.ledTemporal,
      JSON.stringify({
        before: light,
        after: after.observation!.components.filter((component) =>
          component.componentId.startsWith('led'),
        ),
      }),
    ).toBeDefined();
    const failed = after.observation!.ledTemporal!.components.find(
      (component) => component.componentId === 'led13',
    )!;
    expect(failed.samples.map((sample) => [sample.atMicroseconds, sample.brightness > 0])).toEqual([
      [3_999_999, true],
      [4_000_000, false],
      [4_000_001, false],
    ]);
    expect(failed.brightnessIntegral).toBeCloseTo(light.brightness!, 8);
    expect(
      after.observation!.ledTemporal!.components.find(
        (component) => component.componentId === 'led12',
      )!.litDurationMicroseconds,
    ).toBe(2);
  });
});
