const MICROSECONDS_PER_SECOND = 1_000_000n;

export interface ArduinoTimedWaveformState {
  readonly startedAtMicroseconds: number;
  readonly frequencyHz: number;
  readonly dutyNumerator: number;
  readonly dutyDenominator: number;
  readonly edgeIndex: number;
  readonly endAtMicroseconds?: number | undefined;
}

function safeNonNegativeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

export function isArduinoTimedWaveformState(value: unknown): value is ArduinoTimedWaveformState {
  if (!value || typeof value !== 'object') return false;
  const state = value as Partial<ArduinoTimedWaveformState>;
  return (
    safeNonNegativeInteger(state.startedAtMicroseconds ?? -1) &&
    Number.isSafeInteger(state.frequencyHz) &&
    (state.frequencyHz ?? 0) > 0 &&
    Number.isSafeInteger(state.dutyNumerator) &&
    Number.isSafeInteger(state.dutyDenominator) &&
    (state.dutyNumerator ?? 0) > 0 &&
    (state.dutyDenominator ?? 0) > (state.dutyNumerator ?? 0) &&
    safeNonNegativeInteger(state.edgeIndex ?? -1) &&
    (state.endAtMicroseconds === undefined ||
      (safeNonNegativeInteger(state.endAtMicroseconds) &&
        state.endAtMicroseconds > state.startedAtMicroseconds!))
  );
}

export function createArduinoTimedWaveform(
  startedAtMicroseconds: number,
  frequencyHz: number,
  endAtMicroseconds?: number,
  dutyNumerator = 1,
  dutyDenominator = 2,
): ArduinoTimedWaveformState {
  const state: ArduinoTimedWaveformState = {
    startedAtMicroseconds,
    frequencyHz,
    dutyNumerator,
    dutyDenominator,
    edgeIndex: 0,
    ...(endAtMicroseconds === undefined ? {} : { endAtMicroseconds }),
  };
  if (!isArduinoTimedWaveformState(state)) throw new RangeError('Invalid canonical waveform.');
  return state;
}

function roundedRatio(numerator: bigint, denominator: bigint): number {
  const rounded = (numerator + denominator / 2n) / denominator;
  const value = Number(rounded);
  if (!Number.isSafeInteger(value)) throw new RangeError('Waveform timestamp exceeds safe range.');
  return value;
}

export function arduinoWaveformEdgeMicroseconds(
  state: ArduinoTimedWaveformState,
  edgeIndex: number,
): number {
  if (!isArduinoTimedWaveformState(state) || !safeNonNegativeInteger(edgeIndex))
    throw new TypeError('Invalid canonical waveform edge.');
  if (edgeIndex === 0) return state.startedAtMicroseconds;

  const frequency = BigInt(state.frequencyHz);
  let offset: number;
  if (edgeIndex % 2 === 0) {
    const cycle = BigInt(edgeIndex / 2);
    offset = roundedRatio(cycle * MICROSECONDS_PER_SECOND, frequency);
  } else {
    const cycle = BigInt((edgeIndex - 1) / 2);
    const dutyDenominator = BigInt(state.dutyDenominator);
    const dutyNumerator = BigInt(state.dutyNumerator);
    offset = roundedRatio(
      (cycle * dutyDenominator + dutyNumerator) * MICROSECONDS_PER_SECOND,
      frequency * dutyDenominator,
    );
  }
  const timestamp = state.startedAtMicroseconds + offset;
  if (!Number.isSafeInteger(timestamp))
    throw new RangeError('Waveform timestamp exceeds safe range.');
  return timestamp;
}

function edgeIndexAtOrBefore(state: ArduinoTimedWaveformState, atMicroseconds: number): number {
  if (atMicroseconds < state.startedAtMicroseconds) return -1;
  const delta = atMicroseconds - state.startedAtMicroseconds;
  let cycle = Number((BigInt(delta) * BigInt(state.frequencyHz)) / MICROSECONDS_PER_SECOND);
  while (cycle > 0 && arduinoWaveformEdgeMicroseconds(state, cycle * 2) > atMicroseconds)
    cycle -= 1;
  while (arduinoWaveformEdgeMicroseconds(state, (cycle + 1) * 2) <= atMicroseconds) cycle += 1;
  return arduinoWaveformEdgeMicroseconds(state, cycle * 2 + 1) <= atMicroseconds
    ? cycle * 2 + 1
    : cycle * 2;
}

export function arduinoWaveformLevel(state: ArduinoTimedWaveformState): 0 | 1 {
  return state.edgeIndex % 2 === 0 ? 1 : 0;
}

export function arduinoWaveformLevelAt(
  state: ArduinoTimedWaveformState,
  atMicroseconds: number,
): 0 | 1 {
  if (
    atMicroseconds < state.startedAtMicroseconds ||
    (state.endAtMicroseconds !== undefined && atMicroseconds >= state.endAtMicroseconds)
  )
    return 0;
  return edgeIndexAtOrBefore(state, atMicroseconds) % 2 === 0 ? 1 : 0;
}

export function arduinoWaveformNextDueMicroseconds(state: ArduinoTimedWaveformState): number {
  const edge = arduinoWaveformEdgeMicroseconds(state, state.edgeIndex + 1);
  return Math.min(edge, state.endAtMicroseconds ?? Number.POSITIVE_INFINITY);
}

export function advanceArduinoTimedWaveform(
  state: ArduinoTimedWaveformState,
  atMicroseconds: number,
): { readonly state: ArduinoTimedWaveformState | null; readonly levelChanged: boolean } {
  if (!isArduinoTimedWaveformState(state) || !safeNonNegativeInteger(atMicroseconds))
    throw new TypeError('Invalid canonical waveform continuation.');
  const before = arduinoWaveformLevel(state);
  if (state.endAtMicroseconds !== undefined && atMicroseconds >= state.endAtMicroseconds)
    return { state: null, levelChanged: before !== 0 };
  const edgeIndex = edgeIndexAtOrBefore(state, atMicroseconds);
  const next = edgeIndex === state.edgeIndex ? state : { ...state, edgeIndex };
  return { state: next, levelChanged: before !== arduinoWaveformLevel(next) };
}
