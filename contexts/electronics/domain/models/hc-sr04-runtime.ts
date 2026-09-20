import type { SchematicComponent, Terminal } from '../document.js';

export const HC_SR04_PROFILE = Object.freeze({
  componentTypeId: 'ultrasonic-hc-sr04',
  minimumDistanceMeters: 0.02,
  maximumDistanceMeters: 4,
  defaultDistanceMeters: 1,
  minimumTriggerHighMicroseconds: 10,
  echoStartLatencyMicroseconds: 200,
  microsecondsPerCentimeter: 58,
  minimumSupplyVolt: 4.5,
  maximumSupplyVolt: 5.5,
  digitalHighThresholdVolt: 2.5,
  echoHighVolt: 5,
  echoOutputResistanceOhm: 10,
});

type HcSr04Phase = 'idle' | 'trigger-high' | 'echo-delay' | 'echo-high';

export interface HcSr04RuntimeState {
  readonly version: 1;
  readonly phase: HcSr04Phase;
  readonly powered: boolean;
  readonly triggerHighSinceMicroseconds?: number | undefined;
  readonly echoStartMicroseconds?: number | undefined;
  readonly echoEndMicroseconds?: number | undefined;
  readonly lastEchoStartMicroseconds?: number | undefined;
  readonly lastEchoEndMicroseconds?: number | undefined;
}

interface HcSr04RuntimeStep {
  readonly state: HcSr04RuntimeState;
  readonly echoChanged: boolean;
}
interface HcSr04ElectricalBranch {
  readonly id: 'echo';
  readonly terminal: 'echo';
  readonly ground: 'gnd';
  readonly targetVoltage: number;
  readonly resistanceOhm: number;
}

function canonicalTime(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

export function isHcSr04(component: SchematicComponent): boolean {
  return (
    component.componentTypeId === HC_SR04_PROFILE.componentTypeId ||
    component.variantId === HC_SR04_PROFILE.componentTypeId
  );
}

export function hcSr04DistanceMeters(component: SchematicComponent): number | null {
  if (!isHcSr04(component)) return null;
  const value =
    component.stateProperties?.['distanceMeters'] ?? HC_SR04_PROFILE.defaultDistanceMeters;
  return typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= HC_SR04_PROFILE.minimumDistanceMeters &&
    value <= HC_SR04_PROFILE.maximumDistanceMeters
    ? value
    : null;
}

export function hcSr04EchoWidthMicroseconds(distanceMeters: number): number {
  if (
    !Number.isFinite(distanceMeters) ||
    distanceMeters < HC_SR04_PROFILE.minimumDistanceMeters ||
    distanceMeters > HC_SR04_PROFILE.maximumDistanceMeters
  )
    throw new RangeError('HC-SR04 distance must be between 0.02 and 4.00 m.');
  return Math.round(distanceMeters * 100 * HC_SR04_PROFILE.microsecondsPerCentimeter);
}
export function initialHcSr04RuntimeState(): HcSr04RuntimeState {
  return { version: 1, phase: 'idle', powered: false };
}

export function isHcSr04RuntimeState(value: unknown): value is HcSr04RuntimeState {
  if (!value || typeof value !== 'object') return false;
  const state = value as Partial<HcSr04RuntimeState>;
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

export function hcSr04NextDueMicroseconds(state: HcSr04RuntimeState): number {
  if (state.phase === 'echo-delay') return state.echoStartMicroseconds!;
  if (state.phase === 'echo-high') return state.echoEndMicroseconds!;
  return Number.POSITIVE_INFINITY;
}
export function hcSr04EchoHigh(state: HcSr04RuntimeState): boolean {
  return state.powered && state.phase === 'echo-high';
}

export function hcSr04ElectricalBranch(state: HcSr04RuntimeState): HcSr04ElectricalBranch | null {
  if (!state.powered) return null;
  return {
    id: 'echo',
    terminal: 'echo',
    ground: 'gnd',
    targetVoltage: hcSr04EchoHigh(state) ? HC_SR04_PROFILE.echoHighVolt : 0,
    resistanceOhm: HC_SR04_PROFILE.echoOutputResistanceOhm,
  };
}

export function hcSr04InputLevels(terminalVoltages: Readonly<Partial<Record<Terminal, number>>>): {
  readonly powered: boolean;
  readonly triggerHigh: boolean;
} {
  const ground = terminalVoltages.gnd ?? 0;
  const supply = (terminalVoltages.vcc ?? 0) - ground;
  const trigger = (terminalVoltages.trigger ?? 0) - ground;
  return {
    powered:
      supply >= HC_SR04_PROFILE.minimumSupplyVolt && supply <= HC_SR04_PROFILE.maximumSupplyVolt,
    triggerHigh: trigger >= HC_SR04_PROFILE.digitalHighThresholdVolt,
  };
}
export function advanceHcSr04Due(
  state: HcSr04RuntimeState,
  nowMicroseconds: number,
): HcSr04RuntimeStep {
  if (!isHcSr04RuntimeState(state) || !canonicalTime(nowMicroseconds))
    throw new TypeError('Invalid HC-SR04 runtime continuation.');
  const before = hcSr04EchoHigh(state);
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
  return { state: next, echoChanged: before !== hcSr04EchoHigh(next) };
}
export function observeHcSr04Inputs(
  state: HcSr04RuntimeState,
  nowMicroseconds: number,
  powered: boolean,
  triggerHigh: boolean,
  distanceMeters: number,
): HcSr04RuntimeStep {
  if (!isHcSr04RuntimeState(state) || !canonicalTime(nowMicroseconds))
    throw new TypeError('Invalid HC-SR04 runtime continuation.');
  const echoBefore = hcSr04EchoHigh(state);
  if (!powered) {
    const next: HcSr04RuntimeState = {
      version: 1,
      phase: 'idle',
      powered: false,
      lastEchoStartMicroseconds: state.lastEchoStartMicroseconds,
      lastEchoEndMicroseconds: state.lastEchoEndMicroseconds,
    };
    return { state: next, echoChanged: echoBefore };
  }

  let next: HcSr04RuntimeState = state.powered ? state : { ...state, powered: true };
  if (next.phase === 'idle' && triggerHigh) {
    next = {
      ...next,
      phase: 'trigger-high',
      triggerHighSinceMicroseconds: nowMicroseconds,
    };
  } else if (next.phase === 'trigger-high' && !triggerHigh) {
    const highDuration = nowMicroseconds - next.triggerHighSinceMicroseconds!;
    if (highDuration >= HC_SR04_PROFILE.minimumTriggerHighMicroseconds) {
      const echoStartMicroseconds = nowMicroseconds + HC_SR04_PROFILE.echoStartLatencyMicroseconds;
      const echoEndMicroseconds =
        echoStartMicroseconds + hcSr04EchoWidthMicroseconds(distanceMeters);
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
  return { state: next, echoChanged: echoBefore !== hcSr04EchoHigh(next) };
}
