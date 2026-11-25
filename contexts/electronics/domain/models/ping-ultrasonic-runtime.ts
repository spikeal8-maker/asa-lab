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
  echoOutputResistanceOhm: 10,
  releaseLowMicroseconds: 1,
  // Functional profile: only the output load draws current from VCC.
  quiescentCurrentAmp: 0,
});

type PingUltrasonicPhase =
  'idle' | 'trigger-high' | 'echo-delay' | 'echo-high' | 'echo-low' | 'no-echo-delay';

export interface PingUltrasonicRuntimeState {
  readonly version: 2;
  readonly phase: PingUltrasonicPhase;
  readonly powered: boolean;
  readonly triggerArmed: boolean;
  readonly triggerHighSinceMicroseconds?: number | undefined;
  readonly echoStartMicroseconds?: number | undefined;
  readonly echoEndMicroseconds?: number | undefined;
  readonly echoReleaseMicroseconds?: number | undefined;
  readonly echoDecisionMicroseconds?: number | undefined;
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
  readonly rail: 'vcc' | 'gnd';
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
  return { version: 2, phase: 'idle', powered: false, triggerArmed: false };
}

export function isPingUltrasonicRuntimeState(value: unknown): value is PingUltrasonicRuntimeState {
  if (!value || typeof value !== 'object') return false;
  const state = value as Partial<PingUltrasonicRuntimeState>;
  if (
    state.version !== 2 ||
    !['idle', 'trigger-high', 'echo-delay', 'echo-high', 'echo-low', 'no-echo-delay'].includes(
      state.phase ?? '',
    ) ||
    typeof state.powered !== 'boolean' ||
    typeof state.triggerArmed !== 'boolean'
  )
    return false;

  const times = [
    state.triggerHighSinceMicroseconds,
    state.echoStartMicroseconds,
    state.echoEndMicroseconds,
    state.echoReleaseMicroseconds,
    state.echoDecisionMicroseconds,
    state.lastEchoStartMicroseconds,
    state.lastEchoEndMicroseconds,
  ];
  if (times.some((time) => time !== undefined && !canonicalTime(time))) return false;
  if (state.phase === 'trigger-high') return state.triggerHighSinceMicroseconds !== undefined;
  if (state.phase === 'no-echo-delay')
    return (
      state.echoDecisionMicroseconds !== undefined &&
      state.echoStartMicroseconds === undefined &&
      state.echoEndMicroseconds === undefined &&
      state.echoReleaseMicroseconds === undefined
    );
  if (state.phase === 'echo-delay' || state.phase === 'echo-high' || state.phase === 'echo-low')
    return (
      state.echoStartMicroseconds !== undefined &&
      state.echoEndMicroseconds !== undefined &&
      state.echoEndMicroseconds > state.echoStartMicroseconds &&
      state.echoReleaseMicroseconds ===
        state.echoEndMicroseconds + PING_ULTRASONIC_PROFILE.releaseLowMicroseconds
    );
  return true;
}

export function pingNextDueMicroseconds(state: PingUltrasonicRuntimeState): number {
  if (state.phase === 'no-echo-delay') return state.echoDecisionMicroseconds!;
  if (state.phase === 'echo-delay') return state.echoStartMicroseconds!;
  if (state.phase === 'echo-high') return state.echoEndMicroseconds!;
  if (state.phase === 'echo-low') return state.echoReleaseMicroseconds!;
  return Number.POSITIVE_INFINITY;
}

export function pingEchoHigh(state: PingUltrasonicRuntimeState): boolean {
  return state.powered && state.phase === 'echo-high';
}

function pingDrive(state: PingUltrasonicRuntimeState): 'vcc' | 'gnd' | null {
  if (!state.powered) return null;
  if (state.phase === 'echo-high') return 'vcc';
  return state.phase === 'echo-delay' ||
    state.phase === 'echo-low' ||
    state.phase === 'no-echo-delay'
    ? 'gnd'
    : null;
}

export function pingUltrasonicElectricalBranch(
  state: PingUltrasonicRuntimeState,
): PingUltrasonicElectricalBranch | null {
  const rail = pingDrive(state);
  if (rail === null) return null;
  return {
    id: 'echo',
    terminal: 'signal',
    rail,
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

  const before = pingDrive(state);
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
      ...next,
      phase: 'echo-low',
      lastEchoEndMicroseconds: next.echoEndMicroseconds,
    };
  }

  if (
    (next.phase === 'echo-low' &&
      nowMicroseconds >= (next.echoReleaseMicroseconds ?? Number.POSITIVE_INFINITY)) ||
    (next.phase === 'no-echo-delay' &&
      nowMicroseconds >= (next.echoDecisionMicroseconds ?? Number.POSITIVE_INFINITY))
  ) {
    next = {
      version: 2,
      phase: 'idle',
      powered: next.powered,
      triggerArmed: false,
      lastEchoStartMicroseconds: next.lastEchoStartMicroseconds,
      lastEchoEndMicroseconds: next.lastEchoEndMicroseconds,
    };
  }

  return { state: next, echoChanged: before !== pingDrive(next) };
}

export function observePingUltrasonicSignal(
  state: PingUltrasonicRuntimeState,
  nowMicroseconds: number,
  powered: boolean,
  signalHigh: boolean,
  distanceMeters: number,
  echoAvailable = true,
): PingUltrasonicRuntimeStep {
  if (!isPingUltrasonicRuntimeState(state) || !canonicalTime(nowMicroseconds))
    throw new TypeError('Invalid PING ultrasonic runtime continuation.');
  if (typeof echoAvailable !== 'boolean')
    throw new TypeError('PING echoAvailable must be boolean.');

  const echoBefore = pingDrive(state);
  if (!powered) {
    const next: PingUltrasonicRuntimeState = {
      version: 2,
      phase: 'idle',
      powered: false,
      triggerArmed: false,
      lastEchoStartMicroseconds: state.lastEchoStartMicroseconds,
      lastEchoEndMicroseconds: state.lastEchoEndMicroseconds,
    };
    return { state: next, echoChanged: echoBefore !== null };
  }

  let next: PingUltrasonicRuntimeState = state.powered ? state : { ...state, powered: true };

  // Busy observations never arm a later Trigger. A released line must first
  // observe a new LOW, then a fresh HIGH and its qualified falling edge.
  if (next.phase === 'idle' && !signalHigh && !next.triggerArmed) {
    next = { ...next, triggerArmed: true };
  } else if (next.phase === 'idle' && signalHigh && next.triggerArmed) {
    next = {
      ...next,
      phase: 'trigger-high',
      triggerArmed: false,
      triggerHighSinceMicroseconds: nowMicroseconds,
    };
  } else if (next.phase === 'trigger-high' && !signalHigh) {
    const highDuration = nowMicroseconds - next.triggerHighSinceMicroseconds!;
    if (highDuration >= PING_ULTRASONIC_PROFILE.minimumTriggerHighMicroseconds) {
      const echoStartMicroseconds =
        nowMicroseconds + PING_ULTRASONIC_PROFILE.echoStartLatencyMicroseconds;
      const echoEndMicroseconds = echoAvailable
        ? echoStartMicroseconds + pingEchoWidthMicroseconds(distanceMeters)
        : undefined;
      next = {
        version: 2,
        phase: echoAvailable ? 'echo-delay' : 'no-echo-delay',
        powered: true,
        triggerArmed: false,
        ...(echoEndMicroseconds === undefined
          ? { echoDecisionMicroseconds: echoStartMicroseconds }
          : {
              echoStartMicroseconds,
              echoEndMicroseconds,
              echoReleaseMicroseconds:
                echoEndMicroseconds + PING_ULTRASONIC_PROFILE.releaseLowMicroseconds,
            }),
        lastEchoStartMicroseconds: next.lastEchoStartMicroseconds,
        lastEchoEndMicroseconds: next.lastEchoEndMicroseconds,
      };
    } else {
      next = {
        version: 2,
        phase: 'idle',
        powered: true,
        triggerArmed: true,
        lastEchoStartMicroseconds: next.lastEchoStartMicroseconds,
        lastEchoEndMicroseconds: next.lastEchoEndMicroseconds,
      };
    }
  }

  return { state: next, echoChanged: echoBefore !== pingDrive(next) };
}
