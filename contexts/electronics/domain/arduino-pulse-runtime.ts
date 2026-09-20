import type { Terminal } from './document.js';

type ArduinoPulseWaitPhase = 'wait-previous-pulse-end' | 'wait-pulse-start' | 'measure-pulse';

export interface ArduinoPulseWaitState {
  readonly terminal: Terminal;
  readonly targetHigh: boolean;
  readonly phase: ArduinoPulseWaitPhase;
  readonly startedAtMicroseconds: number;
  readonly timeoutMicroseconds: number;
  readonly deadlineMicroseconds: number;
  readonly pulseStartedAtMicroseconds?: number;
}

type ArduinoPulseWaitStep =
  | { readonly status: 'waiting'; readonly state: ArduinoPulseWaitState }
  | { readonly status: 'done'; readonly durationMicroseconds: number };

const UINT32_MAX = 4_294_967_295;

function validTime(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

export function isArduinoPulseWaitState(value: unknown): value is ArduinoPulseWaitState {
  if (!value || typeof value !== 'object') return false;
  const state = value as Partial<ArduinoPulseWaitState>;
  if (
    typeof state.terminal !== 'string' ||
    typeof state.targetHigh !== 'boolean' ||
    !['wait-previous-pulse-end', 'wait-pulse-start', 'measure-pulse'].includes(state.phase ?? '') ||
    !validTime(state.startedAtMicroseconds) ||
    !validTime(state.timeoutMicroseconds) ||
    state.timeoutMicroseconds > UINT32_MAX ||
    !validTime(state.deadlineMicroseconds) ||
    state.deadlineMicroseconds < state.startedAtMicroseconds ||
    state.deadlineMicroseconds - state.startedAtMicroseconds > state.timeoutMicroseconds
  )
    return false;
  if (state.phase === 'measure-pulse') {
    return (
      validTime(state.pulseStartedAtMicroseconds) &&
      state.pulseStartedAtMicroseconds >= state.startedAtMicroseconds &&
      state.pulseStartedAtMicroseconds <= state.deadlineMicroseconds
    );
  }
  return state.pulseStartedAtMicroseconds === undefined;
}

function settleArduinoPulseWait(
  state: ArduinoPulseWaitState,
  nowMicroseconds: number,
  targetActive: boolean,
): ArduinoPulseWaitStep {
  if (nowMicroseconds > state.deadlineMicroseconds)
    return { status: 'done', durationMicroseconds: 0 };
  if (state.phase === 'wait-previous-pulse-end' && !targetActive) {
    const waiting: ArduinoPulseWaitState = {
      ...state,
      phase: 'wait-pulse-start',
    };
    return nowMicroseconds >= waiting.deadlineMicroseconds
      ? { status: 'done', durationMicroseconds: 0 }
      : { status: 'waiting', state: waiting };
  }

  if (state.phase === 'wait-pulse-start' && targetActive) {
    const measuring: ArduinoPulseWaitState = {
      ...state,
      phase: 'measure-pulse',
      pulseStartedAtMicroseconds: nowMicroseconds,
    };
    return nowMicroseconds >= measuring.deadlineMicroseconds
      ? { status: 'done', durationMicroseconds: 0 }
      : { status: 'waiting', state: measuring };
  }

  if (state.phase === 'measure-pulse' && !targetActive) {
    return {
      status: 'done',
      durationMicroseconds: Math.max(0, nowMicroseconds - state.pulseStartedAtMicroseconds!),
    };
  }

  return nowMicroseconds >= state.deadlineMicroseconds
    ? { status: 'done', durationMicroseconds: 0 }
    : { status: 'waiting', state };
}
export function beginArduinoPulseWait(
  terminal: Terminal,
  targetHigh: boolean,
  timeoutMicroseconds: number,
  startedAtMicroseconds: number,
  deadlineMicroseconds: number,
  targetActive: boolean,
): ArduinoPulseWaitStep {
  const state: ArduinoPulseWaitState = {
    terminal,
    targetHigh,
    phase: targetActive ? 'wait-previous-pulse-end' : 'wait-pulse-start',
    startedAtMicroseconds,
    timeoutMicroseconds,
    deadlineMicroseconds,
  };
  return settleArduinoPulseWait(state, startedAtMicroseconds, targetActive);
}

export function advanceArduinoPulseWait(
  state: ArduinoPulseWaitState,
  nowMicroseconds: number,
  targetActive: boolean,
): ArduinoPulseWaitStep {
  if (!isArduinoPulseWaitState(state) || !validTime(nowMicroseconds))
    throw new TypeError('Invalid Arduino pulse wait continuation.');
  if (nowMicroseconds < state.startedAtMicroseconds)
    throw new RangeError('Arduino pulse wait cannot move backwards in canonical time.');
  return settleArduinoPulseWait(state, nowMicroseconds, targetActive);
}
