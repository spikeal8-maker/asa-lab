import { describe, expect, it } from 'vitest';
import {
  advanceHcSr04Due,
  HC_SR04_PROFILE,
  hcSr04EchoAvailable,
  hcSr04EchoHigh,
  hcSr04EchoWidthMicroseconds,
  hcSr04NextDueMicroseconds,
  initialHcSr04RuntimeState,
  isHcSr04RuntimeState,
  observeHcSr04Inputs,
} from '../domain/models/hc-sr04-runtime.js';
import type { SchematicComponent } from '../domain/document.js';

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
});
