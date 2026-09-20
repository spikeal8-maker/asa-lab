import { describe, expect, it } from 'vitest';
import {
  advancePingUltrasonicDue,
  initialPingUltrasonicRuntimeState,
  isPingUltrasonicRuntimeState,
  PING_ULTRASONIC_PROFILE,
  pingEchoHigh,
  pingEchoWidthMicroseconds,
  pingNextDueMicroseconds,
  observePingUltrasonicSignal,
} from '../domain/models/ping-ultrasonic-runtime.js';

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
});
