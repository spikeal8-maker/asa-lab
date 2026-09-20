import { describe, expect, it } from 'vitest';
import {
  advanceHcSr04Due,
  HC_SR04_PROFILE,
  hcSr04EchoHigh,
  hcSr04EchoWidthMicroseconds,
  hcSr04NextDueMicroseconds,
  initialHcSr04RuntimeState,
  isHcSr04RuntimeState,
  observeHcSr04Inputs,
} from '../domain/models/hc-sr04-runtime.js';

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
