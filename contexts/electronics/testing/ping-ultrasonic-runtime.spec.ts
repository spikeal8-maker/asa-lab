import { describe, expect, it } from 'vitest';
import {
  advancePingUltrasonicDue,
  initialPingUltrasonicRuntimeState,
  isPingUltrasonicRuntimeState,
  PING_ULTRASONIC_PROFILE,
  pingEchoHigh,
  pingEchoWidthMicroseconds,
  pingNextDueMicroseconds,
  pingUltrasonicElectricalBranch,
  observePingUltrasonicSignal,
} from '../domain/models/ping-ultrasonic-runtime.js';
import { advanceElectronicsToHorizon, parseElectronicsEngineDocument } from '../engine.js';
import type { ArduinoCircuitClockState } from '../domain/arduino-circuit-scheduler.js';
import { arduinoSnapshotFromState } from '../domain/arduino-model.js';
import { solveCircuitWithHeldArduino } from '../domain/solver.js';
import { compileCircuit, verifyCircuitQuality } from '../domain/simulation.js';
import { ULTRASONIC_U01_LEGACY_SAMPLES } from './fixtures/model-set-golden-compatibility.js';

function trigger(highDurationMicroseconds: number, distanceMeters = 1) {
  let state = initialPingUltrasonicRuntimeState();
  state = observePingUltrasonicSignal(state, 0, true, false, distanceMeters).state;
  state = observePingUltrasonicSignal(state, 10, true, true, distanceMeters).state;
  state = observePingUltrasonicSignal(
    state,
    10 + highDurationMicroseconds,
    true,
    false,
    distanceMeters,
  ).state;
  return state;
}

describe('PING 3-pin ultrasonic foundation runtime', () => {
  it('ignores a trigger shorter than 2 us', () => {
    const state = trigger(PING_ULTRASONIC_PROFILE.minimumTriggerHighMicroseconds - 1);
    expect(state.phase).toBe('idle');
    expect(pingNextDueMicroseconds(state)).toBe(Number.POSITIVE_INFINITY);
    expect(state.lastEchoStartMicroseconds).toBeUndefined();
  });

  it('accepts an exact 2 us trigger and schedules echo 350 us after the falling edge', () => {
    const state = trigger(PING_ULTRASONIC_PROFILE.minimumTriggerHighMicroseconds);
    expect(state.phase).toBe('echo-delay');
    expect(state.echoStartMicroseconds).toBe(362);
    expect(state.echoEndMicroseconds).toBe(6162);
    expect(pingNextDueMicroseconds(state)).toBe(362);
  });

  it('reuses the ultrasonic distance formula: 1 m produces a 5800 us echo pulse', () => {
    expect(pingEchoWidthMicroseconds(1)).toBe(5800);

    let state = trigger(2, 1);
    state = advancePingUltrasonicDue(state, state.echoStartMicroseconds!).state;
    expect(pingEchoHigh(state)).toBe(true);

    state = advancePingUltrasonicDue(state, state.echoEndMicroseconds!).state;
    expect(pingEchoHigh(state)).toBe(false);
    expect(state.lastEchoEndMicroseconds! - state.lastEchoStartMicroseconds!).toBe(5800);
  });

  it('does not schedule or emit echo while unpowered', () => {
    let state = initialPingUltrasonicRuntimeState();
    state = observePingUltrasonicSignal(state, 0, false, false, 1).state;
    state = observePingUltrasonicSignal(state, 10, false, true, 1).state;
    state = observePingUltrasonicSignal(state, 20, false, false, 1).state;

    expect(state.powered).toBe(false);
    expect(state.phase).toBe('idle');
    expect(pingEchoHigh(state)).toBe(false);
    expect(pingNextDueMicroseconds(state)).toBe(Number.POSITIVE_INFINITY);
  });

  it('round-trips a pending echo through JSON without changing canonical timing', () => {
    const pending = trigger(2, 4);
    const restored = JSON.parse(JSON.stringify(pending));

    expect(isPingUltrasonicRuntimeState(restored)).toBe(true);
    expect(restored).toEqual(pending);

    const originalAtEcho = advancePingUltrasonicDue(pending, pending.echoStartMicroseconds!);
    const restoredAtEcho = advancePingUltrasonicDue(restored, restored.echoStartMicroseconds!);
    expect(restoredAtEcho.state).toEqual(originalAtEcho.state);
    expect(restoredAtEcho.echoChanged).toBe(true);
  });

  it('preserves all three drive states and the exact release deadline through JSON', () => {
    const delay = trigger(2);
    const start = delay.echoStartMicroseconds!;
    const end = delay.echoEndMicroseconds!;
    expect(delay.echoReleaseMicroseconds).toBe(end + 1);
    expect(pingUltrasonicElectricalBranch(delay)).toMatchObject({ rail: 'gnd', resistanceOhm: 10 });
    expect(
      pingUltrasonicElectricalBranch(advancePingUltrasonicDue(delay, start - 1).state)?.rail,
    ).toBe('gnd');
    const high = advancePingUltrasonicDue(JSON.parse(JSON.stringify(delay)), start);
    expect(high.echoChanged).toBe(true);
    expect(pingUltrasonicElectricalBranch(high.state)?.rail).toBe('vcc');
    expect(pingNextDueMicroseconds(high.state)).toBe(end);
    const low = advancePingUltrasonicDue(JSON.parse(JSON.stringify(high.state)), end);
    expect(low.echoChanged).toBe(true);
    expect(low.state.phase).toBe('echo-low');
    expect(pingUltrasonicElectricalBranch(low.state)?.rail).toBe('gnd');
    expect(pingNextDueMicroseconds(low.state)).toBe(end + 1);
    const released = advancePingUltrasonicDue(JSON.parse(JSON.stringify(low.state)), end + 1);
    expect(released.echoChanged).toBe(true);
    expect(released.state).toMatchObject({ phase: 'idle', triggerArmed: false });
    expect(pingUltrasonicElectricalBranch(released.state)).toBeNull();
    expect(pingNextDueMicroseconds(released.state)).toBe(Infinity);
    for (const state of [delay, high.state, low.state, released.state])
      expect(isPingUltrasonicRuntimeState(JSON.parse(JSON.stringify(state)))).toBe(true);
    expect(isPingUltrasonicRuntimeState({ ...low.state, echoReleaseMicroseconds: end })).toBe(
      false,
    );
    expect(isPingUltrasonicRuntimeState({ ...low.state, echoReleaseMicroseconds: end + 2 })).toBe(
      false,
    );
  });

  it('reports high-Z to LOW on the accepted Trigger, even though Echo is not HIGH', () => {
    let state = observePingUltrasonicSignal(
      initialPingUltrasonicRuntimeState(),
      0,
      true,
      false,
      1,
    ).state;
    state = observePingUltrasonicSignal(state, 10, true, true, 1).state;
    const accepted = observePingUltrasonicSignal(state, 12, true, false, 1);
    expect(accepted.echoChanged).toBe(true);
    expect(pingEchoHigh(accepted.state)).toBe(false);
    expect(pingUltrasonicElectricalBranch(accepted.state)?.rail).toBe('gnd');
  });

  it('represents latched no-echo as LOW until decision, then releases without a fabricated pulse', () => {
    let state = observePingUltrasonicSignal(
      initialPingUltrasonicRuntimeState(),
      0,
      true,
      false,
      1,
    ).state;
    state = observePingUltrasonicSignal(state, 10, true, true, 1).state;
    const accepted = observePingUltrasonicSignal(state, 12, true, false, 1, false);
    expect(accepted.echoChanged).toBe(true);
    state = JSON.parse(JSON.stringify(accepted.state));
    expect(isPingUltrasonicRuntimeState(state)).toBe(true);
    expect(state.phase).toBe('no-echo-delay');
    expect(pingNextDueMicroseconds(state)).toBe(362);
    expect(pingUltrasonicElectricalBranch(state)?.rail).toBe('gnd');
    expect(state.echoStartMicroseconds).toBeUndefined();
    expect(state.echoEndMicroseconds).toBeUndefined();
    const before = advancePingUltrasonicDue(state, 361);
    expect(before.state.phase).toBe('no-echo-delay');
    const released = advancePingUltrasonicDue(before.state, 362);
    expect(released.echoChanged).toBe(true);
    expect(released.state.phase).toBe('idle');
    expect(pingUltrasonicElectricalBranch(released.state)).toBeNull();
    expect(pingNextDueMicroseconds(released.state)).toBe(Infinity);
    expect(released.state.lastEchoStartMicroseconds).toBeUndefined();
    expect(released.state.lastEchoEndMicroseconds).toBeUndefined();
    state = observePingUltrasonicSignal(released.state, 363, true, true, 1).state;
    expect(state.phase).toBe('idle');
    state = observePingUltrasonicSignal(state, 364, true, false, 1).state;
    state = observePingUltrasonicSignal(state, 365, true, true, 1).state;
    state = observePingUltrasonicSignal(state, 367, true, false, 1).state;
    expect(state.phase).toBe('echo-delay');
    expect(state.echoStartMicroseconds).toBe(717);
  });

  it('discards busy and self-generated edges and requires a new LOW/HIGH/LOW after release', () => {
    let state = trigger(2);
    const start = state.echoStartMicroseconds!;
    const end = state.echoEndMicroseconds!;
    state = observePingUltrasonicSignal(state, 100, true, true, 1).state;
    state = observePingUltrasonicSignal(state, 200, true, false, 1).state;
    state = advancePingUltrasonicDue(state, start).state;
    state = observePingUltrasonicSignal(state, start, true, true, 1).state;
    state = advancePingUltrasonicDue(state, end).state;
    state = observePingUltrasonicSignal(state, end, true, true, 1).state;
    state = advancePingUltrasonicDue(state, end + 1).state;
    for (const time of [end + 1, end + 100]) {
      state = observePingUltrasonicSignal(state, time, true, true, 1).state;
      expect(state.phase).toBe('idle');
      expect(state.triggerHighSinceMicroseconds).toBeUndefined();
    }
    state = observePingUltrasonicSignal(state, end + 101, true, false, 1).state;
    expect(state.phase).toBe('idle');
    state = observePingUltrasonicSignal(state, end + 102, true, true, 1).state;
    state = observePingUltrasonicSignal(state, end + 104, true, false, 1).state;
    expect(state.phase).toBe('echo-delay');
    expect(state.echoStartMicroseconds).toBe(end + 104 + 350);
  });

  it('releases LOW and HIGH immediately on recognized power loss without resurrecting deadlines', () => {
    const delay = trigger(2);
    const high = advancePingUltrasonicDue(delay, delay.echoStartMicroseconds!).state;
    const low = advancePingUltrasonicDue(high, high.echoEndMicroseconds!).state;
    for (const [state, time] of [
      [delay, 100],
      [high, high.echoStartMicroseconds!],
      [low, low.echoEndMicroseconds!],
    ] as const) {
      const lost = observePingUltrasonicSignal(state, time, false, true, 1);
      expect(lost.echoChanged).toBe(true);
      expect(pingUltrasonicElectricalBranch(lost.state)).toBeNull();
      expect(pingNextDueMicroseconds(lost.state)).toBe(Infinity);
      const restored = observePingUltrasonicSignal(lost.state, time + 1, true, true, 1).state;
      expect(restored.phase).toBe('idle');
      expect(restored.echoStartMicroseconds).toBeUndefined();
      expect(pingEchoHigh(advancePingUltrasonicDue(restored, time + 20000).state)).toBe(false);
    }
  });
});

function pingDocument(source?: string) {
  const saved = ULTRASONIC_U01_LEGACY_SAMPLES.find((entry) => entry.kind === 'ping')!.document;
  const parsed = parseElectronicsEngineDocument({
    ...saved,
    components: saved.components.map((component) =>
      source && component.id === 'uno'
        ? { ...component, stateProperties: { ...component.stateProperties, arduinoSource: source } }
        : component,
    ),
  });
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.document;
}
function pingAt(horizon: number, source?: string) {
  const document = pingDocument(source);
  let result = advanceElectronicsToHorizon(document, {
    requestedHorizonMicroseconds: horizon,
    maxEvents: 1024,
  });
  for (let count = 0; result.executionStatus === 'yielded' && count < 10000; count++)
    result = advanceElectronicsToHorizon(document, {
      requestedHorizonMicroseconds: horizon,
      maxEvents: 1024,
      state: JSON.parse(JSON.stringify(result.state)),
    });
  if (result.executionStatus !== 'ready') throw new Error(JSON.stringify(result.diagnostics));
  const clock = JSON.parse(result.state.continuation!.serializedState) as ArduinoCircuitClockState;
  return { document, result, clock, state: clock.pingUltrasonic![0]!.runtime };
}

describe('PING physical LOW and line release', () => {
  it('observes actual delay LOW, Echo HIGH, terminating LOW and high-Z in public frames', () => {
    const delay = pingAt(100);
    const start = delay.state.echoStartMicroseconds!;
    const end = delay.state.echoEndMicroseconds!;
    for (const [time, phase, rail, voltage] of [
      [100, 'echo-delay', 'gnd', 0],
      [start - 1, 'echo-delay', 'gnd', 0],
      [start, 'echo-high', 'vcc', 5],
      [end - 1, 'echo-high', 'vcc', 5],
      [end, 'echo-low', 'gnd', 0],
      [end + 1, 'idle', null, 0],
    ] as const) {
      const observed = pingAt(time);
      const sensor = observed.result.observation.components.find(
        (component) => component.componentId === 'sensor',
      )!;
      expect(observed.state.phase).toBe(phase);
      expect(pingUltrasonicElectricalBranch(observed.state)?.rail ?? null).toBe(rail);
      expect(sensor.terminalVoltages.signal).toBeCloseTo(voltage, 8);
      expect(observed.result.observation.quality.passed).toBe(true);
    }
    expect(pingAt(end + 20).clock.boards[0]!.runtime.variables.duration).toBe(5800);
  });

  it.each([0, 5])('distinguishes matching/opposing GPIO in delay LOW, external %s V', (voltage) => {
    const delay = pingAt(100);
    const runtime = delay.clock.boards[0]!.runtime;
    const held = new Map([
      [
        'uno',
        arduinoSnapshotFromState({
          ...runtime,
          pinModes: { ...runtime.pinModes, d13: 'OUTPUT' },
          outputVoltages: { ...runtime.outputVoltages, d13: voltage },
        }),
      ],
    ]);
    const raw = solveCircuitWithHeldArduino(
      delay.document,
      0.1,
      held,
      undefined,
      new Map([['sensor', delay.state]]),
    );
    const sensor = raw.components.find((component) => component.componentId === 'sensor')!;
    expect(raw.solved).toBe(true);
    expect(
      verifyCircuitQuality(delay.document, compileCircuit(delay.document), raw, {}).passed,
    ).toBe(true);
    expect(sensor.terminalVoltages.signal).toBeCloseTo(voltage / 2, 9);
    expect(sensor.terminalCurrents?.signal).toBeCloseTo(voltage / 20, 10);
    expect(sensor.terminalCurrents?.gnd).toBeCloseTo(-voltage / 20, 10);
    expect(sensor.terminalCurrents?.vcc).toBe(0);
    expect(sensor.power).toBeCloseTo((voltage / 20) ** 2 * 10, 9);
    expect(
      raw.diagnostics.some(
        (diagnostic) =>
          diagnostic.code === 'conflicting_sources' && diagnostic.severity === 'error',
      ),
    ).toBe(voltage !== 0);
  });

  it('releases SIG for a second complete external Trigger and real pulseIn', () => {
    const measurement = (destination: string) =>
      `pinMode(13,OUTPUT);digitalWrite(13,LOW);delayMicroseconds(2);digitalWrite(13,HIGH);delayMicroseconds(2);digitalWrite(13,LOW);pinMode(13,INPUT);${destination}=pulseIn(13,HIGH,30000);`;
    const source = `unsigned long firstDuration=999;unsigned long secondDuration=999;void setup(){${measurement('firstDuration')}${measurement('secondDuration')}}void loop(){delay(100);}`;
    const completed = pingAt(40000, source);
    expect(completed.clock.boards[0]!.runtime.variables).toEqual({
      firstDuration: 5800,
      secondDuration: 5800,
    });
    expect(completed.state.phase).toBe('idle');
    expect(pingUltrasonicElectricalBranch(completed.state)).toBeNull();
  });
});
