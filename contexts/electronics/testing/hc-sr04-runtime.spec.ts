import { describe, expect, it } from 'vitest';
import {
  advanceHcSr04Due,
  HC_SR04_PROFILE,
  hcSr04EchoAvailable,
  hcSr04EchoHigh,
  hcSr04EchoWidthMicroseconds,
  hcSr04ElectricalBranch,
  hcSr04NextDueMicroseconds,
  initialHcSr04RuntimeState,
  isHcSr04RuntimeState,
  observeHcSr04Inputs,
} from '../domain/models/hc-sr04-runtime.js';
import type { ElectronicsDocument, SchematicComponent, Terminal } from '../domain/document.js';
import { advanceElectronicsToHorizon, parseElectronicsEngineDocument } from '../engine.js';
import type { ArduinoCircuitClockState } from '../domain/arduino-circuit-scheduler.js';
import { arduinoSnapshotFromState } from '../domain/arduino-model.js';
import {
  advancePingUltrasonicDue,
  initialPingUltrasonicRuntimeState,
} from '../domain/models/ping-ultrasonic-runtime.js';
import { solveCircuitWithHeldArduino } from '../domain/solver.js';
import { compileCircuit, verifyCircuitQuality } from '../domain/simulation.js';
import { ULTRASONIC_U01_LEGACY_SAMPLES } from './fixtures/model-set-golden-compatibility.js';

function acceptedTrigger(distanceMeters: number, highDuration = 10) {
  let state = initialHcSr04RuntimeState();
  state = observeHcSr04Inputs(state, 0, true, false, distanceMeters).state;
  state = observeHcSr04Inputs(state, 5, true, true, distanceMeters).state;
  state = observeHcSr04Inputs(state, 5 + highDuration, true, false, distanceMeters).state;
  return state;
}

describe('HC-SR04 canonical runtime', () => {
  it.each([
    [0.02, 116],
    [1, 5800],
    [4, 23200],
  ])('maps %s m to %s canonical echo microseconds', (distanceMeters, expected) => {
    expect(hcSr04EchoWidthMicroseconds(distanceMeters)).toBe(expected);
  });
  it('accepts a 10 us trigger and emits exact scheduled echo edges', () => {
    let state = acceptedTrigger(1);
    expect(state.phase).toBe('echo-delay');
    expect(state.echoStartMicroseconds).toBe(215);
    expect(state.echoEndMicroseconds).toBe(6015);
    expect(hcSr04NextDueMicroseconds(state)).toBe(215);

    state = advanceHcSr04Due(state, 215).state;
    expect(hcSr04EchoHigh(state)).toBe(true);
    expect(state.lastEchoStartMicroseconds).toBe(215);

    state = advanceHcSr04Due(state, 6015).state;
    expect(hcSr04EchoHigh(state)).toBe(false);
    expect(state.lastEchoEndMicroseconds).toBe(6015);
    expect(state.lastEchoEndMicroseconds! - state.lastEchoStartMicroseconds!).toBe(5800);
  });

  it('ignores a trigger shorter than 10 us', () => {
    const state = acceptedTrigger(1, HC_SR04_PROFILE.minimumTriggerHighMicroseconds - 1);
    expect(state.phase).toBe('idle');
    expect(hcSr04NextDueMicroseconds(state)).toBe(Number.POSITIVE_INFINITY);
    expect(state.lastEchoStartMicroseconds).toBeUndefined();
  });
  it('does not schedule echo while unpowered', () => {
    let state = initialHcSr04RuntimeState();
    state = observeHcSr04Inputs(state, 0, false, false, 1).state;
    state = observeHcSr04Inputs(state, 10, false, true, 1).state;
    state = observeHcSr04Inputs(state, 30, false, false, 1).state;
    expect(state.phase).toBe('idle');
    expect(state.powered).toBe(false);
    expect(hcSr04NextDueMicroseconds(state)).toBe(Number.POSITIVE_INFINITY);
  });

  it('defaults only an absent reflection flag to true and rejects malformed flags', () => {
    const component: SchematicComponent = {
      id: 'sonar',
      kind: 'visual',
      componentTypeId: 'ultrasonic-hc-sr04',
      value: 0,
      position: { x: 0, y: 0 },
    };
    expect(hcSr04EchoAvailable(component)).toBe(true);
    for (const echoAvailable of [false, true])
      expect(hcSr04EchoAvailable({ ...component, stateProperties: { echoAvailable } })).toBe(
        echoAvailable,
      );
    for (const echoAvailable of [0, 1, 'false', 'true'])
      expect(hcSr04EchoAvailable({ ...component, stateProperties: { echoAvailable } })).toBeNull();
  });

  it('latches no-echo on the falling Trig edge and waits for a new trigger after recovery', () => {
    let state = initialHcSr04RuntimeState();
    state = observeHcSr04Inputs(state, 0, true, false, 1, true).state;
    state = observeHcSr04Inputs(state, 5, true, true, 1, true).state;
    state = observeHcSr04Inputs(state, 15, true, false, 1, false).state;
    expect(state).toMatchObject({ phase: 'idle', powered: true });
    expect(hcSr04NextDueMicroseconds(state)).toBe(Number.POSITIVE_INFINITY);
    expect(state.echoStartMicroseconds).toBeUndefined();
    expect(state.lastEchoStartMicroseconds).toBeUndefined();
    state = observeHcSr04Inputs(JSON.parse(JSON.stringify(state)), 100, true, false, 2, true).state;
    expect(hcSr04EchoHigh(advanceHcSr04Due(state, 1000).state)).toBe(false);
    state = observeHcSr04Inputs(state, 1000, true, true, 2, false).state;
    state = observeHcSr04Inputs(state, 1010, true, false, 2, true).state;
    expect(state).toMatchObject({
      phase: 'echo-delay',
      echoStartMicroseconds: 1210,
      echoEndMicroseconds: 12810,
    });
  });

  it.each([100, 300])(
    'does not cancel an accepted echo when reflection disappears at %s us',
    (time) => {
      const accepted = acceptedTrigger(1);
      const due = advanceHcSr04Due(accepted, time).state;
      const changed = observeHcSr04Inputs(due, time, true, false, 4, false);
      expect(changed.state).toEqual(due);
      expect(changed.echoChanged).toBe(false);
      const completed = advanceHcSr04Due(changed.state, 6015).state;
      expect(completed.lastEchoEndMicroseconds! - completed.lastEchoStartMicroseconds!).toBe(5800);
    },
  );

  it('round-trips a pending measurement through JSON without changing due time or echo', () => {
    const pending = acceptedTrigger(4);
    const restored = JSON.parse(JSON.stringify(pending));
    expect(isHcSr04RuntimeState(restored)).toBe(true);
    expect(restored).toEqual(pending);

    const atEcho = advanceHcSr04Due(restored, pending.echoStartMicroseconds!);
    expect(atEcho.state).toEqual(advanceHcSr04Due(pending, pending.echoStartMicroseconds!).state);
    expect(atEcho.echoChanged).toBe(true);
  });

  it('invalidates the electrical frame on powered LOW/high-Z transitions', () => {
    const powered = observeHcSr04Inputs(initialHcSr04RuntimeState(), 0, true, false, 1);
    expect(powered.echoChanged).toBe(true);
    expect(hcSr04ElectricalBranch(powered.state)).toMatchObject({ rail: 'gnd', resistanceOhm: 10 });
    const lost = observeHcSr04Inputs(powered.state, 1, false, false, 1);
    expect(lost.echoChanged).toBe(true);
    expect(hcSr04ElectricalBranch(lost.state)).toBeNull();
    expect(hcSr04NextDueMicroseconds(lost.state)).toBe(Infinity);
  });
});

type SensorKind = 'hc' | 'ping';
const outputPin = (kind: SensorKind): Terminal => (kind === 'hc' ? 'echo' : 'signal');
const inputPin = (kind: SensorKind): Terminal => (kind === 'hc' ? 'd2' : 'd13');
const wire = (id: string, from: string, a: Terminal, to: string, b: Terminal) => ({
  id,
  from: { componentId: from, terminal: a },
  to: { componentId: to, terminal: b },
});
function parseFixture(value: unknown): ElectronicsDocument {
  const parsed = parseElectronicsEngineDocument(value);
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.document;
}
function measurementFixture(
  kind: SensorKind,
  loaded = false,
  supply?: number,
): ElectronicsDocument {
  const saved = ULTRASONIC_U01_LEGACY_SAMPLES.find((entry) => entry.kind === kind)!.document;
  let document = parseFixture(JSON.parse(JSON.stringify(saved)));
  if (loaded)
    document = parseFixture({
      ...document,
      components: [
        ...document.components,
        { id: 'load', kind: 'resistor', value: 10000, position: { x: 150, y: 100 } },
      ],
      connections: [
        ...document.connections,
        wire('load-a', 'sensor', outputPin(kind), 'load', 'a'),
        wire('load-b', 'load', 'b', 'sensor', 'gnd'),
      ],
    });
  if (supply !== undefined)
    document = parseFixture({
      ...document,
      components: [
        ...document.components,
        {
          id: 'supply',
          kind: 'source',
          value: supply,
          position: { x: 0, y: 100 },
          stateProperties: { internalResistanceOhm: 0 },
        },
      ],
      connections: [
        ...document.connections.filter((connection) => connection.id !== 'vcc'),
        wire('supply-vcc', 'supply', 'a', 'sensor', 'vcc'),
        wire('supply-gnd', 'supply', 'b', 'sensor', 'gnd'),
      ],
    });
  return document;
}
function runMeasurement(document: ElectronicsDocument, horizon = 40000, maxEvents = 1024) {
  let result = advanceElectronicsToHorizon(document, {
    requestedHorizonMicroseconds: horizon,
    maxEvents,
  });
  for (let step = 0; result.executionStatus === 'yielded' && step < 10000; step++)
    result = advanceElectronicsToHorizon(document, {
      requestedHorizonMicroseconds: horizon,
      maxEvents,
      state: JSON.parse(JSON.stringify(result.state)),
    });
  const clock = result.state.continuation
    ? (JSON.parse(result.state.continuation.serializedState) as ArduinoCircuitClockState)
    : undefined;
  return { result, clock };
}
function highFrame(document: ElectronicsDocument, kind: SensorKind) {
  const before = runMeasurement(document, 100);
  expect(before.result.executionStatus).toBe('ready');
  const clock = before.clock!;
  const at = (clock.hcSr04?.[0]?.runtime ?? clock.pingUltrasonic![0]!.runtime)
    .echoStartMicroseconds!;
  const hc =
    kind === 'hc'
      ? new Map([['sensor', advanceHcSr04Due(clock.hcSr04![0]!.runtime, at).state]])
      : undefined;
  const ping =
    kind === 'ping'
      ? new Map([['sensor', advancePingUltrasonicDue(clock.pingUltrasonic![0]!.runtime, at).state]])
      : undefined;
  const held = new Map([['uno', arduinoSnapshotFromState(clock.boards[0]!.runtime)]]);
  const raw = solveCircuitWithHeldArduino(document, at / 1000, held, hc, ping);
  const quality = verifyCircuitQuality(document, compileCircuit(document), raw, {
    simulationTimeMs: at / 1000,
  });
  return { at, raw, quality, held, hc, ping, clock };
}

describe.each(['hc', 'ping'] as const)('%s rail-connected ultrasonic output', (kind) => {
  it.each([4.5, 5, 5.5])('follows actual %s V supply with an independent 10k oracle', (supply) => {
    const document = measurementFixture(kind, true, supply);
    const { raw, quality } = highFrame(document, kind);
    const sensor = raw.components.find((part) => part.componentId === 'sensor')!;
    const load = raw.components.find((part) => part.componentId === 'load')!;
    const current = supply / 10010;
    expect(raw.solved).toBe(true);
    expect(quality.passed).toBe(true);
    expect(sensor.terminalVoltages.vcc).toBeCloseTo(supply, 9);
    expect(load.voltageDrop).toBeCloseTo(current * 10000, 9);
    expect(load.current).toBeCloseTo(current, 10);
    expect(sensor.terminalCurrents?.vcc).toBeCloseTo(current, 10);
    expect(sensor.terminalCurrents?.[outputPin(kind)]).toBeCloseTo(-current, 10);
    expect(sensor.terminalCurrents?.gnd).toBe(0);
    if (kind === 'hc') expect(sensor.terminalCurrents?.trigger).toBe(0);
    expect(Object.values(sensor.terminalCurrents!).reduce((sum, value) => sum + value!, 0)).toBe(0);
    expect(sensor.current).toBeCloseTo(current, 10);
    expect(sensor.power).toBeCloseTo(current * current * 10, 11);
  });

  for (const supply of [undefined, 5])
    for (const loaded of [false, true]) {
      it(`returns real pulseIn=5800 with ${supply === undefined ? 'Uno 0.1-ohm' : 'ideal'} supply, load=${loaded}`, () => {
        const document = measurementFixture(kind, loaded, supply);
        const high = highFrame(document, kind);
        const atHigh = runMeasurement(document, high.at);
        expect(atHigh.result.executionStatus).toBe('ready');
        if (atHigh.result.executionStatus !== 'ready')
          throw new Error('Expected public HIGH observation');
        const publicSensor = atHigh.result.observation.components.find(
          (part) => part.componentId === 'sensor',
        )!;
        const rawSensor = high.raw.components.find((part) => part.componentId === 'sensor')!;
        expect(publicSensor.terminalVoltages).toEqual(rawSensor.terminalVoltages);
        expect(publicSensor.terminalCurrents).toEqual(rawSensor.terminalCurrents);
        // The existing transient route can use its relative KCL tolerance.
        // Compare actual residuals and require both paths to meet the stricter DC bound.
        expect(atHigh.result.observation.quality).toMatchObject({
          finite: high.quality.finite,
          passed: high.quality.passed,
          maxKclResidualAmp: high.quality.maxKclResidualAmp,
          maxSourceVoltageResidualVolt: high.quality.maxSourceVoltageResidualVolt,
          powerBalanceResidualWatt: high.quality.powerBalanceResidualWatt,
        });
        expect(atHigh.result.observation.quality.maxKclResidualAmp).toBeLessThanOrEqual(1e-6);
        expect(high.quality).toMatchObject({
          passed: true,
          finite: true,
          kclToleranceAmp: 1e-6,
          sourceVoltageToleranceVolt: 1e-9,
          powerBalanceToleranceWatt: 1e-9,
        });
        expect(high.quality.maxKclResidualAmp).toBeLessThanOrEqual(1e-6);
        expect(high.quality.maxSourceVoltageResidualVolt).toBeLessThanOrEqual(1e-9);
        if (loaded) {
          const current = 5 / (10010 + (supply === undefined ? 0.1 : 0));
          expect(rawSensor.terminalVoltages[outputPin(kind)]).toBeCloseTo(current * 10000, 9);
          expect(rawSensor.terminalCurrents?.vcc).toBeCloseTo(current, 10);
        }
        const completed = runMeasurement(document);
        expect(completed.result.executionStatus).toBe('ready');
        expect(completed.clock?.boards[0]?.runtime.variables.duration).toBe(5800);
        expect(completed.result.diagnostics).toEqual([]);
      });
    }

  it('preserves signed reverse current and removes every output path when unpowered', () => {
    const base = measurementFixture(kind, false, 5);
    const high = highFrame(base, kind);
    const document = parseFixture({
      ...base,
      components: [
        ...base.components,
        {
          id: 'external',
          kind: 'source',
          value: 6,
          position: { x: 250, y: 100 },
          stateProperties: { internalResistanceOhm: 0 },
        },
      ],
      connections: [
        ...base.connections,
        wire('external-signal', 'external', 'a', 'sensor', outputPin(kind)),
        wire('external-gnd', 'external', 'b', 'sensor', 'gnd'),
      ],
    });
    const raw = solveCircuitWithHeldArduino(
      document,
      high.at / 1000,
      high.held,
      high.hc,
      high.ping,
    );
    const sensor = raw.components.find((part) => part.componentId === 'sensor')!;
    expect(raw.solved).toBe(true);
    expect(sensor.terminalCurrents?.[outputPin(kind)]).toBeCloseTo(0.1, 10);
    expect(sensor.terminalCurrents?.vcc).toBeCloseTo(-0.1, 10);
    expect(sensor.current).toBeCloseTo(0.1, 10);
    expect(sensor.power).toBeCloseTo(0.1, 10);
    expect(verifyCircuitQuality(document, compileCircuit(document), raw, {}).passed).toBe(true);
    const released = solveCircuitWithHeldArduino(
      document,
      high.at / 1000,
      high.held,
      kind === 'hc' ? new Map([['sensor', initialHcSr04RuntimeState()]]) : undefined,
      kind === 'ping' ? new Map([['sensor', initialPingUltrasonicRuntimeState()]]) : undefined,
    );
    const inactive = released.components.find((part) => part.componentId === 'sensor')!;
    expect(inactive.terminalVoltages[outputPin(kind)]).toBeCloseTo(6, 9);
    expect(Object.values(inactive.terminalCurrents!).every((current) => current === 0)).toBe(true);
    expect(inactive.current).toBe(0);
    expect(inactive.power).toBe(0);
    expect(verifyCircuitQuality(document, compileCircuit(document), released, {}).passed).toBe(
      true,
    );
  });

  for (const fault of ['short', 'opposing-gpio'] as const) {
    it(`keeps finite ${fault} observations with local topology errors`, () => {
      const base = measurementFixture(kind);
      const high = highFrame(base, kind);
      const document =
        fault === 'short'
          ? parseFixture({
              ...base,
              connections: [
                ...base.connections,
                wire('short', 'sensor', outputPin(kind), 'sensor', 'gnd'),
              ],
            })
          : base;
      const runtime = high.clock.boards[0]!.runtime;
      const held =
        fault === 'opposing-gpio'
          ? new Map([
              [
                'uno',
                arduinoSnapshotFromState({
                  ...runtime,
                  pinModes: { ...runtime.pinModes, [inputPin(kind)]: 'OUTPUT' },
                  outputVoltages: { ...runtime.outputVoltages, [inputPin(kind)]: 0 },
                }),
              ],
            ])
          : high.held;
      const raw = solveCircuitWithHeldArduino(document, high.at / 1000, held, high.hc, high.ping);
      const sensor = raw.components.find((part) => part.componentId === 'sensor')!;
      const expectedCurrent = 5 / (fault === 'short' ? 10.1 : 20.1);
      expect(raw.solved).toBe(true);
      expect(sensor.current).toBeCloseTo(expectedCurrent, 9);
      expect(sensor.terminalVoltages[outputPin(kind)]).toBeCloseTo(
        fault === 'short' ? 0 : expectedCurrent * 10,
        9,
      );
      expect(verifyCircuitQuality(document, compileCircuit(document), raw, {}).passed).toBe(true);
      const diagnostic = raw.diagnostics.find(
        (entry) => entry.code === (fault === 'short' ? 'short_circuit' : 'conflicting_sources'),
      )!;
      expect(diagnostic.severity).toBe('error');
      expect(diagnostic.componentIds).toContain('sensor');
      if (fault === 'opposing-gpio') expect(diagnostic.componentIds).toContain('uno');
      expect(diagnostic.netIds).toHaveLength(1);
      expect(diagnostic.anchors).toContainEqual({ kind: 'net', id: diagnostic.netIds![0] });
      const measuredDocument =
        fault === 'opposing-gpio'
          ? parseFixture({
              ...document,
              components: document.components.map((component) =>
                component.id !== 'uno'
                  ? component
                  : {
                      ...component,
                      stateProperties: {
                        ...component.stateProperties,
                        arduinoSource: String(component.stateProperties!.arduinoSource).replace(
                          kind === 'hc' ? 'pinMode(2,INPUT)' : 'pinMode(13,INPUT)',
                          kind === 'hc' ? 'pinMode(2,OUTPUT)' : 'pinMode(13,OUTPUT)',
                        ),
                      },
                    },
              ),
            })
          : document;
      expect(
        runMeasurement(measuredDocument).clock?.boards[0]?.runtime.variables.duration,
      ).not.toBe(5800);
    });
  }

  it.each([1, 7, 1024])('preserves loaded measurement through JSON yields, budget %s', (budget) => {
    const result = runMeasurement(measurementFixture(kind, true), 40000, budget);
    expect(result.result.executionStatus).toBe('ready');
    expect(result.clock?.boards[0]?.runtime.variables.duration).toBe(5800);
  });
});
