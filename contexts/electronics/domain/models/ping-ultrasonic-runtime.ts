import { hcSr04EchoWidthMicroseconds } from './hc-sr04-runtime.js';

export const PING_ULTRASONIC_PROFILE = Object.freeze({
  componentTypeId: 'ultrasonic-sensor',
  minimumTriggerHighMicroseconds: 2,
  echoStartLatencyMicroseconds: 350,
});

type PingUltrasonicPhase = 'idle' | 'trigger-high' | 'echo-delay' | 'echo-high';

export interface PingUltrasonicRuntimeState {
  readonly version: 1;
  readonly phase: PingUltrasonicPhase;
  readonly powered: boolean;
  readonly triggerHighSinceMicroseconds?: number | undefined;
  readonly echoStartMicroseconds?: number | undefined;
  readonly echoEndMicroseconds?: number | undefined;
  readonly lastEchoStartMicroseconds?: number | undefined;
  readonly lastEchoEndMicroseconds?: number | undefined;
}

interface PingUltrasonicRuntimeStep {
  readonly state: PingUltrasonicRuntimeState;
  readonly echoChanged: boolean;
}

function canonicalTime(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

export function pingEchoWidthMicroseconds(distanceMeters: number): number {
  return hcSr04EchoWidthMicroseconds(distanceMeters);
}

export function initialPingUltrasonicRuntimeState(): PingUltrasonicRuntimeState {
  return { version: 1, phase: 'idle', powered: false };
}

export function isPingUltrasonicRuntimeState(
  value: unknown,
): value is PingUltrasonicRuntimeState {
  if (!value || typeof value !== 'object') return false;
  const state = value as Partial<PingUltrasonicRuntimeState>;
  if (
    state.version !== 1 ||
    !['idle', 'trigger-high', 'echo-delay', 'echo-high'].includes(state.phase ?? '') ||
    typeof state.powered !== 'boolean'
  )
    return false;

  const times = [
    state.triggerHighSinceMicroseconds,
    state.echoStartMicroseconds,
    state.echoEndMicroseconds,
    state.lastEchoStartMicroseconds,
    state.lastEchoEndMicroseconds,
  ];
  if (times.some((time) => time !== undefined && !canonicalTime(time))) return false;
  if (state.phase === 'trigger-high') return state.triggerHighSinceMicroseconds !== undefined;
  if (state.phase === 'echo-delay' || state.phase === 'echo-high')
    return (
      state.echoStartMicroseconds !== undefined &&
      state.echoEndMicroseconds !== undefined &&
      state.echoEndMicroseconds >= state.echoStartMicroseconds
    );
  return true;
}

export function pingNextDueMicroseconds(state: PingUltrasonicRuntimeState): number {
  if (state.phase === 'echo-delay') return state.echoStartMicroseconds!;
  if (state.phase === 'echo-high') return state.echoEndMicroseconds!;
  return Number.POSITIVE_INFINITY;
}

export function pingEchoHigh(state: PingUltrasonicRuntimeState): boolean {
  return state.powered && state.phase === 'echo-high';
}

export function advancePingUltrasonicDue(
  state: PingUltrasonicRuntimeState,
  nowMicroseconds: number,
): PingUltrasonicRuntimeStep {
  if (!isPingUltrasonicRuntimeState(state) || !canonicalTime(nowMicroseconds))
    throw new TypeError('Invalid PING ultrasonic runtime continuation.');

  const before = pingEchoHigh(state);
  let next = state;

  if (
    next.phase === 'echo-delay' &&
    nowMicroseconds >= (next.echoStartMicroseconds ?? Number.POSITIVE_INFINITY)
  ) {
    next = {
      ...next,
      phase: 'echo-high',
      lastEchoStartMicroseconds: next.echoStartMicroseconds,
    };
  }

  if (
    next.phase === 'echo-high' &&
    nowMicroseconds >= (next.echoEndMicroseconds ?? Number.POSITIVE_INFINITY)
  ) {
    next = {
      version: 1,
      phase: 'idle',
      powered: next.powered,
      lastEchoStartMicroseconds: next.lastEchoStartMicroseconds,
      lastEchoEndMicroseconds: next.echoEndMicroseconds,
    };
  }

  return { state: next, echoChanged: before !== pingEchoHigh(next) };
}

export function observePingUltrasonicSignal(
  state: PingUltrasonicRuntimeState,
  nowMicroseconds: number,
  powered: boolean,
  signalHigh: boolean,
  distanceMeters: number,
): PingUltrasonicRuntimeStep {
  if (!isPingUltrasonicRuntimeState(state) || !canonicalTime(nowMicroseconds))
    throw new TypeError('Invalid PING ultrasonic runtime continuation.');

  const echoBefore = pingEchoHigh(state);
  if (!powered) {
    const next: PingUltrasonicRuntimeState = {
      version: 1,
      phase: 'idle',
      powered: false,
      lastEchoStartMicroseconds: state.lastEchoStartMicroseconds,
      lastEchoEndMicroseconds: state.lastEchoEndMicroseconds,
    };
    return { state: next, echoChanged: echoBefore };
  }

  let next: PingUltrasonicRuntimeState = state.powered
    ? state
    : { ...state, powered: true };

  if (next.phase === 'idle' && signalHigh) {
    next = {
      ...next,
      phase: 'trigger-high',
      triggerHighSinceMicroseconds: nowMicroseconds,
    };
  } else if (next.phase === 'trigger-high' && !signalHigh) {
    const highDuration = nowMicroseconds - next.triggerHighSinceMicroseconds!;
    if (highDuration >= PING_ULTRASONIC_PROFILE.minimumTriggerHighMicroseconds) {
      const echoStartMicroseconds =
        nowMicroseconds + PING_ULTRASONIC_PROFILE.echoStartLatencyMicroseconds;
      const echoEndMicroseconds =
        echoStartMicroseconds + pingEchoWidthMicroseconds(distanceMeters);
      next = {
        version: 1,
        phase: 'echo-delay',
        powered: true,
        echoStartMicroseconds,
        echoEndMicroseconds,
        lastEchoStartMicroseconds: next.lastEchoStartMicroseconds,
        lastEchoEndMicroseconds: next.lastEchoEndMicroseconds,
      };
    } else {
      next = {
        version: 1,
        phase: 'idle',
        powered: true,
        lastEchoStartMicroseconds: next.lastEchoStartMicroseconds,
        lastEchoEndMicroseconds: next.lastEchoEndMicroseconds,
      };
    }
  }

  return { state: next, echoChanged: echoBefore !== pingEchoHigh(next) };
}
