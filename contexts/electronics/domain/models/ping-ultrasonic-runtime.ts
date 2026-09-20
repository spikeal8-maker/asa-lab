import type { SchematicComponent, Terminal } from '../document.js';
import { hcSr04EchoWidthMicroseconds } from './hc-sr04-runtime.js';

export const PING_ULTRASONIC_PROFILE = Object.freeze({
  componentTypeId: 'ultrasonic-sensor',
  minimumDistanceMeters: 0.02,
  maximumDistanceMeters: 3,
  defaultDistanceMeters: 1,
  minimumTriggerHighMicroseconds: 2,
  echoStartLatencyMicroseconds: 350,
  minimumSupplyVolt: 4.5,
  maximumSupplyVolt: 5.5,
  digitalHighThresholdVolt: 2.5,
  echoHighVolt: 5,
  echoOutputResistanceOhm: 10,
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

interface PingUltrasonicElectricalBranch {
  readonly id: 'echo';
  readonly terminal: 'signal';
  readonly ground: 'gnd';
  readonly targetVoltage: number;
  readonly resistanceOhm: number;
}

function canonicalTime(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

export function isPingUltrasonic(component: SchematicComponent): boolean {
  return (
    component.componentTypeId === PING_ULTRASONIC_PROFILE.componentTypeId ||
    component.variantId === PING_ULTRASONIC_PROFILE.componentTypeId
  );
}

export function pingUltrasonicDistanceMeters(component: SchematicComponent): number | null {
  if (!isPingUltrasonic(component)) return null;
  const value =
    component.stateProperties?.['distanceMeters'] ?? PING_ULTRASONIC_PROFILE.defaultDistanceMeters;
  return typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= PING_ULTRASONIC_PROFILE.minimumDistanceMeters &&
    value <= PING_ULTRASONIC_PROFILE.maximumDistanceMeters
    ? value
    : null;
}

export function pingEchoWidthMicroseconds(distanceMeters: number): number {
  return hcSr04EchoWidthMicroseconds(distanceMeters);
}

export function initialPingUltrasonicRuntimeState(): PingUltrasonicRuntimeState {
  return { version: 1, phase: 'idle', powered: false };
}

export function isPingUltrasonicRuntimeState(value: unknown): value is PingUltrasonicRuntimeState {
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

export function pingUltrasonicElectricalBranch(
  state: PingUltrasonicRuntimeState,
): PingUltrasonicElectricalBranch | null {
  if (!pingEchoHigh(state)) return null;
  return {
    id: 'echo',
    terminal: 'signal',
    ground: 'gnd',
    targetVoltage: PING_ULTRASONIC_PROFILE.echoHighVolt,
    resistanceOhm: PING_ULTRASONIC_PROFILE.echoOutputResistanceOhm,
  };
}

export function pingUltrasonicInputLevels(
  terminalVoltages: Readonly<Partial<Record<Terminal, number>>>,
): {
  readonly powered: boolean;
  readonly signalHigh: boolean;
} {
  const ground = terminalVoltages.gnd ?? 0;
  const supply = (terminalVoltages.vcc ?? 0) - ground;
  const signal = (terminalVoltages.signal ?? 0) - ground;
  return {
    powered:
      supply >= PING_ULTRASONIC_PROFILE.minimumSupplyVolt &&
      supply <= PING_ULTRASONIC_PROFILE.maximumSupplyVolt,
    signalHigh: signal >= PING_ULTRASONIC_PROFILE.digitalHighThresholdVolt,
  };
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

  let next: PingUltrasonicRuntimeState = state.powered ? state : { ...state, powered: true };

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
      const echoEndMicroseconds = echoStartMicroseconds + pingEchoWidthMicroseconds(distanceMeters);
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
