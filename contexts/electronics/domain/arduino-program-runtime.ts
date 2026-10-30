import { draw, seed, valid } from './arduino-random.js';
import {
  arduinoSwitchSections,
  arduinoSwitchType,
  arduinoSwitchCase,
} from './arduino-switch-syntax.js';
import {
  maskArduinoFunctionSyntax,
  parseArduinoVoidFunctions,
  reservedArduinoFunctionIdentifier,
  type ArduinoVoidFunction,
} from './arduino-user-functions.js';
import {
  ADC_OBSERVATION,
  unconnectedAdcReading,
  type ObservedArduinoInputs,
} from './arduino-adc-observation.js';
import type { Terminal } from './document.js';
import {
  advanceArduinoPulseWait,
  beginArduinoPulseWait,
  isArduinoPulseWaitState,
  type ArduinoPulseWaitState,
} from './arduino-pulse-runtime.js';
import {
  advanceArduinoServoWaveforms,
  arduinoServoDeclarationNames,
  attachArduinoServo,
  detachArduinoServo,
  initialArduinoServoRuntimeState,
  isArduinoServoRuntimeState,
  readArduinoServo,
  syncArduinoServoDeclarations,
  writeArduinoServo,
  type ArduinoServoRuntimeState,
} from './arduino-servo-runtime.js';
import {
  appendArduinoSerialTx,
  arduinoSerialAvailable,
  beginArduinoSerial,
  formatArduinoSerialNumber,
  initialArduinoSerialState,
  isArduinoSerialState,
  parseArduinoSerialStringLiteral,
  readArduinoSerial,
  splitArduinoSerialArguments,
  type ArduinoSerialState,
} from './arduino-serial-runtime.js';
import {
  advanceArduinoTimedWaveform,
  createArduinoTimedWaveform,
  isArduinoTimedWaveformState,
  type ArduinoTimedWaveformState,
} from './arduino-waveform-runtime.js';
import {
  ArduinoArithmeticError,
  ARDUINO_NUMERIC_TYPES,
  assignBinding,
  binaryValue,
  bindingFor,
  commonType,
  convertValue,
  numericValue,
  parseNumericLiteral,
  readBinding,
  scopeNumbers,
  serializeScopes,
  unaryValue,
  validScopes,
  zeroValue,
  type ArduinoNumericType,
  type ArduinoScope,
  type ArduinoScopeSnapshot,
  type ArduinoValue,
} from './arduino-values.js';

export type ArduinoPinMode = 'INPUT' | 'INPUT_PULLUP' | 'OUTPUT';

export interface ArduinoWriteAction {
  readonly kind: 'write';
  readonly terminal: Terminal;
  readonly targetVoltage: number;
  readonly enableOutput?: boolean;
}

export interface ArduinoDelayAction {
  readonly kind: 'delay';
  readonly durationMs: number;
}

export interface ArduinoToneAction {
  readonly kind: 'tone';
  readonly terminal: Terminal;
  readonly frequencyHz: number;
  readonly durationMs?: number;
}

export interface ArduinoNoToneAction {
  readonly kind: 'no-tone';
  readonly terminal: Terminal;
}

export type ArduinoToneState =
  | (ArduinoTimedWaveformState & { readonly expiresAtMs?: undefined })
  | { readonly frequencyHz: number; readonly expiresAtMs?: number };

export interface ArduinoPinModeAction {
  readonly kind: 'pin-mode';
  readonly terminal: Terminal;
  readonly mode: ArduinoPinMode;
}

export type ArduinoProgramAction =
  | ArduinoWriteAction
  | ArduinoDelayAction
  | ArduinoToneAction
  | ArduinoNoToneAction
  | ArduinoPinModeAction;

export const ARDUINO_RUNTIME_STATE_VERSION = 7 as const;
export const ARDUINO_RUNTIME_EVENT_QUEUE_LIMIT = 256 as const;
export type ArduinoClockProfile = 'legacy-ms-v1' | 'instruction-us-v1';

export interface ArduinoRuntimeEvent {
  readonly sequence: number;
  readonly atMicroseconds: number;
  readonly kind: 'pin-mode-change' | 'output-change' | 'tone-start' | 'tone-stop';
  readonly terminal: Terminal;
  readonly mode?: ArduinoPinMode;
  readonly voltage?: number;
  readonly frequencyHz?: number;
}

export interface ArduinoRuntimeDiagnostic {
  readonly code:
    | 'compile_error'
    | 'arithmetic_error'
    | 'clock_range_exceeded'
    | 'statement_budget_exceeded'
    | 'loop_advance_budget_exceeded';
  readonly severity: 'error';
  readonly message: string;
  readonly line?: number;
  readonly start?: number;
  readonly length?: number;
  readonly column?: number;
}

interface ArduinoUltrasonicAdapterState {
  readonly triggerTerminal: Terminal;
  readonly echoTerminal: Terminal;
  readonly phase: 'trigger-low-delay' | 'trigger-high-delay' | 'pulse';
}

interface ArduinoFunctionFrame {
  readonly callerFunction?: string;
  readonly returnProgramCounter: number;
  /** Suspended caller locals; globals remain shared in state.scopes[0]. */
  readonly scopes: readonly ArduinoScopeSnapshot[];
}

/**
 * Serializable runtime-only state. It is deliberately separate from the saved
 * schematic document: browser and server may carry it between simulation
 * steps, while Reset or a changed sketch starts from a clean snapshot.
 */
export interface ArduinoRuntimeState {
  readonly version: typeof ARDUINO_RUNTIME_STATE_VERSION;
  readonly clockProfile: ArduinoClockProfile;
  readonly programFingerprint: string;
  readonly virtualTimeMs: number;
  readonly resumeAtMs: number;
  readonly phase: 'setup' | 'loop';
  readonly programCounter: number;
  readonly activeFunction?: string;
  readonly functionFrames?: readonly ArduinoFunctionFrame[];
  readonly loopIterationActive: boolean;
  readonly loopStartedAtMs: number;
  readonly loopIterations: number;
  readonly nextEventSequence: number;
  readonly eventQueue: readonly ArduinoRuntimeEvent[];
  readonly pendingEvaluation?: ArduinoPendingEvaluation;
  readonly randomState?: number;
  readonly pulseWait?: ArduinoPulseWaitState | null;
  readonly ultrasonicAdapter?: ArduinoUltrasonicAdapterState | null;
  readonly serial?: ArduinoSerialState;
  readonly servo?: ArduinoServoRuntimeState;
  readonly variables: Readonly<Record<string, number>>;
  readonly locals: Readonly<Record<string, number>>;
  readonly scopes: readonly ArduinoScopeSnapshot[];
  readonly faults: readonly ArduinoRuntimeDiagnostic[];
  readonly pinModes: Readonly<Partial<Record<Terminal, ArduinoPinMode>>>;
  readonly outputVoltages: Readonly<Partial<Record<Terminal, number>>>;
  readonly tones: Readonly<Partial<Record<Terminal, ArduinoToneState>>>;
}

export interface ArduinoRuntimeAdvance {
  readonly executionStatus: 'ready' | 'yielded' | 'fault';
  /** Present only for a circuit-owned event batch. */
  readonly executedInstructions?: number;
  readonly setupActions: readonly ArduinoProgramAction[];
  readonly loopActions: readonly ArduinoProgramAction[];
  readonly events: readonly ArduinoRuntimeEvent[];
  readonly state: ArduinoRuntimeState;
  readonly diagnostics: readonly ArduinoRuntimeDiagnostic[];
}

export type ArduinoTerminalVoltages = Readonly<Partial<Record<Terminal, number>>>;

/** The circuit bridge resolves a read against the already executed GPIO state. */
export interface ArduinoElectricalState {
  readonly simulationTimeMs: number;
  readonly pinModes: ReadonlyMap<Terminal, ArduinoPinMode>;
  readonly outputVoltages: ReadonlyMap<Terminal, number>;
  readonly tones: ReadonlyMap<Terminal, ArduinoToneState>;
}
export type ArduinoInputReader = (state: ArduinoElectricalState) => ArduinoTerminalVoltages;

interface Token {
  readonly kind: 'number' | 'identifier' | 'operator' | 'punctuation';
  readonly value: string;
}

type ExpressionSyntax =
  | { readonly kind: 'literal'; readonly value: ArduinoValue }
  | { readonly kind: 'binding'; readonly name: string }
  | { readonly kind: 'unary'; readonly operator: string; readonly operand: ExpressionSyntax }
  | {
      readonly kind: 'binary';
      readonly operator: string;
      readonly left: ExpressionSyntax;
      readonly right: ExpressionSyntax;
    }
  | { readonly kind: 'call'; readonly name: string; readonly args: readonly ExpressionSyntax[] }
  | {
      readonly kind: 'conditional';
      readonly condition: ExpressionSyntax;
      readonly whenTrue: ExpressionSyntax;
      readonly whenFalse: ExpressionSyntax;
    };
interface PreparedExpression {
  readonly tokens: readonly Token[];
  readonly syntax?: ExpressionSyntax;
}
interface PreparedStatement {
  readonly compact: string;
  readonly member: boolean;
  readonly declaration: GlobalDeclaration | null;
  readonly assignment: readonly string[] | null;
  readonly increment: readonly string[] | null;
  readonly call: readonly string[] | null;
  readonly arguments: readonly string[];
}

interface ArduinoEvaluationEntry {
  readonly stream: number;
  readonly start: number;
  readonly end: number;
  readonly next: number;
  readonly value: ArduinoValue;
}
interface ArduinoPendingEvaluation {
  readonly programFingerprint: string;
  readonly phase: 'setup' | 'loop';
  readonly programCounter: number;
  readonly callContext?: string;
  readonly parents: readonly number[];
  readonly streams: readonly (readonly string[])[];
  readonly entries: readonly (ArduinoEvaluationEntry | null)[];
}
interface ArduinoEvaluationReplay {
  cursor: number;
  parents: number[];
  stack: number[];
  streams: (readonly string[])[];
  entries: (ArduinoEvaluationEntry | null)[];
}

interface RuntimeState {
  readonly scopes: ArduinoScope[];
  evaluationReplay?: ArduinoEvaluationReplay | undefined;
  randomState?: number | undefined;
  readonly validateOnly?: boolean;
  readonly inputs: ArduinoTerminalVoltages;
  readonly actions: ArduinoProgramAction[];
  readonly diagnostics: ArduinoRuntimeDiagnostic[];
  pulseWait: ArduinoPulseWaitState | null;
  ultrasonicAdapter: ArduinoUltrasonicAdapterState | null;
  serial: ArduinoSerialState | null;
  servo: ArduinoServoRuntimeState;
  simulationTimeMs: number;
  statementCount: number;
  readonly expressions?: Readonly<Record<string, PreparedExpression>>;
  readonly prepareExpression?: (expression: string, tokens: readonly Token[]) => void;
  readonly ownedClockCalls?: {
    readonly adapters: readonly [ExpressionParser, ExpressionParser];
    readonly arguments: readonly ArduinoValue[];
  };
}

interface SimpleInstruction {
  readonly kind: 'simple';
  readonly statement: string;
  readonly line: number;
  prepared?: PreparedStatement;
}

interface BranchInstruction {
  readonly kind: 'branch';
  readonly condition: string;
  falseTarget: number;
  readonly line: number;
}

interface JumpInstruction {
  readonly kind: 'jump';
  target: number;
  readonly unwindScopes?: number;
}

type ScopeInstruction = { readonly kind: 'enter-scope' } | { readonly kind: 'exit-scope' };
interface UserCallInstruction {
  readonly kind: 'user-call';
  readonly name: string;
  readonly args: readonly string[];
  readonly line: number;
}
type ReturnInstruction = { readonly kind: 'return'; readonly line: number };
interface SwitchInstruction {
  readonly kind: 'switch';
  readonly selector: string;
  readonly cases: { expression: string; target: number; value?: number }[];
  defaultTarget: number;
  readonly line: number;
}
type CompiledInstruction =
  | SimpleInstruction
  | BranchInstruction
  | JumpInstruction
  | ScopeInstruction
  | UserCallInstruction
  | SwitchInstruction
  | ReturnInstruction;

const MAX_STATEMENTS = 512;
const MAX_LOOP_ADVANCES = 4_096;
const MAX_ADVANCE_STATEMENTS = 16_384;
const MIN_LOOP_DURATION_MS = 1;
const DEFAULT_PULSE_IN_TIMEOUT_US = 1_000_000;
// Leave enough floating-point precision for lossless microsecond <-> ms state serialization.
const MAX_CLOCK_MICROSECONDS = 2 ** 50 - 1;
const MAX_CLOCK_TARGET_MS = (MAX_CLOCK_MICROSECONDS - 1000) / 1000;
const PWM_TERMINALS = new Set<Terminal>(['d3', 'd5', 'd6', 'd9', 'd10', 'd11']);

class ArduinoPulseWaitSignal {
  constructor(readonly wakeAtMicroseconds: number) {}
}

class ArduinoUltrasonicAdapterWaitSignal {
  constructor(readonly wakeAtMicroseconds: number) {}
}

function finite(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, finite(value)));
}

function microsecondsFromMilliseconds(value: number): number {
  return Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.round(finite(value) * 1_000)));
}

function clockHorizonMilliseconds(value: number): number {
  // Values such as 1.001 ms must survive binary floating-point round trips.
  // Compare on the caller's ms scale instead of an epsilon that grows with time
  // and could otherwise round a truly fractional horizon into the future.
  let ticks = Math.floor(value * 1000);
  if ((ticks + 1) / 1000 <= value) ticks += 1;
  if (ticks / 1000 > value) ticks -= 1;
  return ticks / 1000;
}

function programFingerprint(source: string): string {
  let fnv = 0x811c9dc5;
  let djb = 0x1505;
  for (let index = 0; index < source.length; index += 1) {
    const code = source.charCodeAt(index);
    fnv ^= code;
    fnv = Math.imul(fnv, 0x01000193);
    djb = Math.imul(djb, 33) ^ code;
  }
  return `arduino-v1-${source.length}-${(fnv >>> 0).toString(16).padStart(8, '0')}-${(djb >>> 0)
    .toString(16)
    .padStart(8, '0')}`;
}

function isArduinoGpioTerminal(value: unknown): value is Terminal {
  return typeof value === 'string' && /^(?:d(?:[0-9]|1[0-3])|a[0-5])$/.test(value);
}

function toneStateIsValid(tone: ArduinoToneState): boolean {
  return (
    isArduinoTimedWaveformState(tone) ||
    (tone != null &&
      Number.isFinite(tone.frequencyHz) &&
      tone.frequencyHz >= 1 &&
      tone.frequencyHz <= 20_000 &&
      (!('expiresAtMs' in tone) ||
        tone.expiresAtMs === undefined ||
        (Number.isFinite(tone.expiresAtMs) && tone.expiresAtMs >= 0)))
  );
}

function incrementWaitText(instruction: CompiledInstruction | undefined): string | undefined {
  if (instruction?.kind === 'user-call') return instruction.args.join(';') || undefined;
  if (instruction?.kind === 'switch') return instruction.selector;
  const text =
    instruction?.kind === 'simple'
      ? instruction.statement
      : instruction?.kind === 'branch'
        ? instruction.condition
        : '';
  return /(?:\?|\+\+|--|\brandom(?:Seed)?\s*\()/i.test(text) &&
    /\b(?:pulseIn|readUltrasonicCm)\s*\(/i.test(text)
    ? text
    : undefined;
}

function validEvaluationFrontier(pending: ArduinoPendingEvaluation): boolean {
  if (!Array.isArray(pending.parents) || pending.parents.length !== pending.entries.length)
    return false;
  const stack: number[] = [];
  const ends = pending.entries.map(() => pending.entries.length);
  for (let index = 0; index < pending.parents.length; index++) {
    const parent = pending.parents[index]!;
    if (!Number.isSafeInteger(parent) || parent < -1 || parent >= index) return false;
    while (stack.length && stack[stack.length - 1] !== parent) ends[stack.pop()!] = index;
    if ((stack[stack.length - 1] ?? -1) !== parent) return false;
    stack.push(index);
  }
  return (
    pending.entries.some((entry) => entry === null) &&
    pending.entries.every((entry, index) =>
      entry === null
        ? ends[index] === pending.entries.length &&
          (pending.parents[index] === -1 || pending.entries[pending.parents[index]!] === null)
        : entry.next === ends[index],
    )
  );
}

function pendingEvaluationIsValid(state: ArduinoRuntimeState): boolean {
  const pending = state.pendingEvaluation;
  if (pending === undefined) return true;
  try {
    return Boolean(
      pending &&
      (state.pulseWait || state.ultrasonicAdapter) &&
      pending.programFingerprint === state.programFingerprint &&
      pending.phase === state.phase &&
      pending.programCounter === state.programCounter &&
      pending.callContext === functionCallContext(state.activeFunction, state.functionFrames) &&
      Array.isArray(pending.streams) &&
      pending.streams.length > 0 &&
      pending.streams.reduce(
        (count, stream) =>
          count + (Array.isArray(stream) ? stream.length : MAX_ADVANCE_STATEMENTS + 1),
        0,
      ) <= MAX_ADVANCE_STATEMENTS &&
      pending.streams.every(
        (stream) =>
          stream.length > 0 &&
          stream.every((token: unknown) => typeof token === 'string' && token.length > 0),
      ) &&
      Array.isArray(pending.entries) &&
      pending.entries.length > 0 &&
      pending.entries.length <= MAX_ADVANCE_STATEMENTS &&
      pending.entries.some((entry) => entry !== null) &&
      validEvaluationFrontier(pending) &&
      pending.entries.every(
        (entry, index) =>
          entry === null ||
          (entry &&
            Number.isSafeInteger(entry.stream) &&
            entry.stream >= 0 &&
            entry.stream < pending.streams.length &&
            Number.isSafeInteger(entry.start) &&
            entry.start >= 0 &&
            Number.isSafeInteger(entry.end) &&
            entry.end > entry.start &&
            entry.end <= pending.streams[entry.stream]!.length &&
            Number.isSafeInteger(entry.next) &&
            entry.next > index &&
            entry.next <= pending.entries.length &&
            entry.value &&
            ARDUINO_NUMERIC_TYPES.includes(entry.value.type) &&
            Number.isFinite(entry.value.value) &&
            convertValue(entry.value, entry.value.type).value === entry.value.value),
      ),
    );
  } catch {
    return false;
  }
}

function runtimeStateIsValid(state: ArduinoRuntimeState): boolean {
  const pinModeEntries = Object.entries(state.pinModes ?? {});
  const outputVoltageEntries = Object.entries(state.outputVoltages ?? {});
  const toneEntries = Object.entries(state.tones ?? {});
  const pinModes = Object.values(state.pinModes ?? {});
  const outputVoltages = Object.values(state.outputVoltages ?? {});
  const tones = Object.values(state.tones ?? {});
  return (
    state.version === ARDUINO_RUNTIME_STATE_VERSION &&
    (state.activeFunction === undefined
      ? state.functionFrames === undefined
      : typeof state.activeFunction === 'string' &&
        Array.isArray(state.functionFrames) &&
        state.functionFrames.length > 0 &&
        state.functionFrames.length <= 128 &&
        Array.from(state.functionFrames).every(
          (frame) =>
            frame &&
            (frame.callerFunction === undefined || typeof frame.callerFunction === 'string') &&
            Number.isSafeInteger(frame.returnProgramCounter) &&
            frame.returnProgramCounter > 0 &&
            Array.isArray(frame.scopes) &&
            validScopes([{}, ...frame.scopes]),
        )) &&
    pendingEvaluationIsValid(state) &&
    (state.clockProfile === 'legacy-ms-v1' || state.clockProfile === 'instruction-us-v1') &&
    validScopes(state.scopes) &&
    Array.isArray(state.faults) &&
    state.faults.every(
      (fault) =>
        fault &&
        [
          'compile_error',
          'arithmetic_error',
          'clock_range_exceeded',
          'statement_budget_exceeded',
          'loop_advance_budget_exceeded',
        ].includes(fault.code) &&
        fault.severity === 'error' &&
        typeof fault.message === 'string',
    ) &&
    typeof state.programFingerprint === 'string' &&
    Number.isFinite(state.virtualTimeMs) &&
    state.virtualTimeMs >= 0 &&
    Number.isFinite(state.resumeAtMs) &&
    state.resumeAtMs >= 0 &&
    state.resumeAtMs >= state.virtualTimeMs &&
    (state.clockProfile !== 'instruction-us-v1' ||
      (state.virtualTimeMs <= MAX_CLOCK_TARGET_MS &&
        state.resumeAtMs <= MAX_CLOCK_MICROSECONDS / 1000 &&
        microsecondsFromMilliseconds(state.virtualTimeMs) / 1000 === state.virtualTimeMs &&
        microsecondsFromMilliseconds(state.resumeAtMs) / 1000 === state.resumeAtMs)) &&
    (state.phase === 'setup' || state.phase === 'loop') &&
    Number.isSafeInteger(state.programCounter) &&
    state.programCounter >= 0 &&
    typeof state.loopIterationActive === 'boolean' &&
    (state.phase === 'loop' || !state.loopIterationActive) &&
    Number.isFinite(state.loopStartedAtMs) &&
    state.loopStartedAtMs >= 0 &&
    state.loopStartedAtMs <= state.resumeAtMs &&
    Number.isSafeInteger(state.loopIterations) &&
    state.loopIterations >= 0 &&
    Number.isSafeInteger(state.nextEventSequence) &&
    state.nextEventSequence >= 0 &&
    Array.isArray(state.eventQueue) &&
    state.eventQueue.length <= ARDUINO_RUNTIME_EVENT_QUEUE_LIMIT &&
    (state.pulseWait == null ||
      (isArduinoPulseWaitState(state.pulseWait) &&
        isArduinoGpioTerminal(state.pulseWait.terminal) &&
        state.pulseWait.deadlineMicroseconds <= MAX_CLOCK_MICROSECONDS)) &&
    (state.ultrasonicAdapter == null ||
      (isArduinoGpioTerminal(state.ultrasonicAdapter.triggerTerminal) &&
        isArduinoGpioTerminal(state.ultrasonicAdapter.echoTerminal) &&
        ['trigger-low-delay', 'trigger-high-delay', 'pulse'].includes(
          state.ultrasonicAdapter.phase,
        ))) &&
    valid(state.randomState) &&
    (state.serial === undefined || isArduinoSerialState(state.serial)) &&
    (state.servo === undefined || isArduinoServoRuntimeState(state.servo)) &&
    state.eventQueue.every(
      (event, index) =>
        event !== null &&
        typeof event === 'object' &&
        Number.isSafeInteger(event.sequence) &&
        event.sequence >= 0 &&
        event.sequence < state.nextEventSequence &&
        (index === 0 || event.sequence > state.eventQueue[index - 1]!.sequence) &&
        Number.isSafeInteger(event.atMicroseconds) &&
        event.atMicroseconds >= 0 &&
        (index === 0 || event.atMicroseconds >= state.eventQueue[index - 1]!.atMicroseconds) &&
        isArduinoGpioTerminal(event.terminal) &&
        ['pin-mode-change', 'output-change', 'tone-start', 'tone-stop'].includes(event.kind) &&
        (event.mode === undefined ||
          event.mode === 'INPUT' ||
          event.mode === 'INPUT_PULLUP' ||
          event.mode === 'OUTPUT') &&
        (event.voltage === undefined ||
          (Number.isFinite(event.voltage) && event.voltage >= 0 && event.voltage <= 5)) &&
        (event.frequencyHz === undefined ||
          (Number.isFinite(event.frequencyHz) &&
            event.frequencyHz >= 1 &&
            event.frequencyHz <= 20_000)),
    ) &&
    state.variables !== null &&
    typeof state.variables === 'object' &&
    Object.values(state.variables).every((value) => Number.isFinite(value)) &&
    state.locals !== null &&
    typeof state.locals === 'object' &&
    Object.values(state.locals).every((value) => Number.isFinite(value)) &&
    state.pinModes !== null &&
    typeof state.pinModes === 'object' &&
    pinModeEntries.every(([terminal]) => isArduinoGpioTerminal(terminal)) &&
    pinModes.every((mode) => mode === 'INPUT' || mode === 'INPUT_PULLUP' || mode === 'OUTPUT') &&
    state.outputVoltages !== null &&
    typeof state.outputVoltages === 'object' &&
    outputVoltageEntries.every(([terminal]) => isArduinoGpioTerminal(terminal)) &&
    outputVoltages.every(
      (value) => value !== undefined && Number.isFinite(value) && value >= 0 && value <= 5,
    ) &&
    state.tones !== null &&
    typeof state.tones === 'object' &&
    toneEntries.every(([terminal]) => isArduinoGpioTerminal(terminal)) &&
    tones.every((tone) => tone !== undefined && toneStateIsValid(tone))
  );
}

function sortedRecord<T>(
  entries: ReadonlyMap<Terminal, T>,
): Readonly<Partial<Record<Terminal, T>>> {
  return Object.fromEntries(
    [...entries.entries()].sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)),
  );
}

function terminalMap<T>(entries: Readonly<Partial<Record<Terminal, T>>>): Map<Terminal, T> {
  return new Map(
    Object.entries(entries).sort(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0,
    ) as [Terminal, T][],
  );
}

function canonicalToneState(
  tone: ArduinoToneState,
  fallbackStartMicroseconds: number,
): ArduinoTimedWaveformState | null {
  if (isArduinoTimedWaveformState(tone)) return tone;
  const endAtMicroseconds =
    tone.expiresAtMs === undefined ? undefined : microsecondsFromMilliseconds(tone.expiresAtMs);
  if (endAtMicroseconds !== undefined && endAtMicroseconds <= fallbackStartMicroseconds)
    return null;
  return createArduinoTimedWaveform(fallbackStartMicroseconds, tone.frequencyHz, endAtMicroseconds);
}

function expireTones(
  targetTimeMs: number,
  tones: Map<Terminal, ArduinoTimedWaveformState>,
  emit: (event: Omit<ArduinoRuntimeEvent, 'sequence' | 'atMicroseconds'>, atMs: number) => void,
): void {
  if (tones.size === 0) return;
  const targetMicroseconds = microsecondsFromMilliseconds(targetTimeMs);
  const ordered = [...tones].sort(
    ([a, left], [b, right]) =>
      (left.endAtMicroseconds ?? Number.MAX_SAFE_INTEGER) -
        (right.endAtMicroseconds ?? Number.MAX_SAFE_INTEGER) || (a < b ? -1 : a > b ? 1 : 0),
  );
  for (const [terminal, tone] of ordered) {
    if (tone.endAtMicroseconds !== undefined && tone.endAtMicroseconds <= targetMicroseconds) {
      tones.delete(terminal);
      emit({ kind: 'tone-stop', terminal }, tone.endAtMicroseconds / 1000);
    }
  }
}

function applyRuntimeAction(
  action: Exclude<ArduinoProgramAction, ArduinoDelayAction>,
  executionTimeMs: number,
  pinModes: Map<Terminal, ArduinoPinMode>,
  outputVoltages: Map<Terminal, number>,
  tones: Map<Terminal, ArduinoTimedWaveformState>,
  emit: (event: Omit<ArduinoRuntimeEvent, 'sequence' | 'atMicroseconds'>, atMs: number) => void,
): void {
  if (action.kind === 'pin-mode') {
    if (pinModes.get(action.terminal) !== action.mode) {
      emit(
        { kind: 'pin-mode-change', terminal: action.terminal, mode: action.mode },
        executionTimeMs,
      );
    }
    pinModes.set(action.terminal, action.mode);
    const latch =
      action.mode === 'OUTPUT'
        ? (outputVoltages.get(action.terminal) ?? 0)
        : action.mode === 'INPUT_PULLUP'
          ? 5
          : 0;
    if (outputVoltages.get(action.terminal) !== latch) {
      emit({ kind: 'output-change', terminal: action.terminal, voltage: latch }, executionTimeMs);
      outputVoltages.set(action.terminal, latch);
    }
  } else if (action.kind === 'write') {
    if (action.enableOutput && pinModes.get(action.terminal) !== 'OUTPUT') {
      applyRuntimeAction(
        { kind: 'pin-mode', terminal: action.terminal, mode: 'OUTPUT' },
        executionTimeMs,
        pinModes,
        outputVoltages,
        tones,
        emit,
      );
    } else if (pinModes.get(action.terminal) !== 'OUTPUT') {
      applyRuntimeAction(
        {
          kind: 'pin-mode',
          terminal: action.terminal,
          mode: action.targetVoltage > 0 ? 'INPUT_PULLUP' : 'INPUT',
        },
        executionTimeMs,
        pinModes,
        outputVoltages,
        tones,
        emit,
      );
    }
    const previousVoltage = outputVoltages.get(action.terminal);
    if (previousVoltage !== action.targetVoltage) {
      emit(
        { kind: 'output-change', terminal: action.terminal, voltage: action.targetVoltage },
        executionTimeMs,
      );
    }
    if (!Object.is(previousVoltage, action.targetVoltage))
      outputVoltages.set(action.terminal, action.targetVoltage);
  } else if (action.kind === 'tone') {
    if (pinModes.get(action.terminal) !== 'OUTPUT')
      applyRuntimeAction(
        { kind: 'pin-mode', terminal: action.terminal, mode: 'OUTPUT' },
        executionTimeMs,
        pinModes,
        outputVoltages,
        tones,
        emit,
      );
    outputVoltages.set(action.terminal, 0);
    emit(
      { kind: 'tone-start', terminal: action.terminal, frequencyHz: action.frequencyHz },
      executionTimeMs,
    );
    const startedAtMicroseconds = microsecondsFromMilliseconds(executionTimeMs);
    tones.set(
      action.terminal,
      createArduinoTimedWaveform(
        startedAtMicroseconds,
        action.frequencyHz,
        action.durationMs === undefined
          ? undefined
          : startedAtMicroseconds + microsecondsFromMilliseconds(action.durationMs),
      ),
    );
  } else {
    if (tones.has(action.terminal)) {
      emit({ kind: 'tone-stop', terminal: action.terminal }, executionTimeMs);
    }
    tones.delete(action.terminal);
  }
}

function statementBudgetDiagnostic(state: RuntimeState): void {
  if (state.diagnostics.some((entry) => entry.code === 'statement_budget_exceeded')) return;
  state.diagnostics.push({
    code: 'statement_budget_exceeded',
    severity: 'error',
    message: `Программа превысила лимит ${MAX_STATEMENTS} операций за один проход Arduino.`,
  });
}

function consumeStatement(state: RuntimeState): boolean {
  if (state.statementCount >= MAX_STATEMENTS) {
    statementBudgetDiagnostic(state);
    return false;
  }
  state.statementCount += 1;
  return true;
}

function removeComments(source: string, offsets?: number[]): string {
  let output = '';
  const emit = (text: string, start: number): void => {
    output += text;
    for (let offset = 0; offset < text.length; offset += 1) offsets?.push(start + offset);
  };
  let quote: '"' | "'" | null = null;
  let lineComment = false;
  let blockComment = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index] ?? '';
    const next = source[index + 1] ?? '';
    if (lineComment) {
      if (character === '\n') {
        lineComment = false;
        emit('\n', index);
      }
      continue;
    }
    if (blockComment) {
      emit(character === '\n' ? '\n' : ' ', index);
      if (character === '*' && next === '/') {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      emit(character, index);
      if (character === '\\') {
        emit(next, index + 1);
        index += 1;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      emit(character, index);
      continue;
    }
    if (character === '/' && next === '/') {
      lineComment = true;
      index += 1;
      continue;
    }
    if (character === '/' && next === '*') {
      emit(' ', index);
      blockComment = true;
      index += 1;
      continue;
    }
    emit(character, index);
  }
  return output;
}

function tokenize(expression: string): readonly Token[] {
  const tokens: Token[] = [];
  for (let index = 0; index < expression.length;) {
    const character = expression[index] ?? '';
    if (/\s/.test(character)) {
      index += 1;
      continue;
    }
    const number =
      /^(?:0[xX][\da-fA-F]+(?:[uU][lL]?|[lL][uU]?)?|0[bB][01]+(?:[uU][lL]?|[lL][uU]?)?|(?:\d+\.\d*|\.\d+|\d+)(?:[eE][+-]?\d+)?(?:[uU][lL]?|[lL][uU]?|[fF])?)/.exec(
        expression.slice(index),
      );
    if (number) {
      tokens.push({ kind: 'number', value: number[0] });
      index += number[0].length;
      continue;
    }
    const identifier = /^[A-Za-z_][A-Za-z0-9_]*/.exec(expression.slice(index));
    if (identifier) {
      tokens.push({ kind: 'identifier', value: identifier[0] });
      index += identifier[0].length;
      continue;
    }
    const operator = ['++', '--', '&&', '||', '==', '!=', '<=', '>='].find((candidate) =>
      expression.startsWith(candidate, index),
    );
    if (operator) {
      tokens.push({ kind: 'operator', value: operator });
      index += operator.length;
      continue;
    }
    if ('+-*/%!<>'.includes(character)) {
      tokens.push({ kind: 'operator', value: character });
      index += 1;
      continue;
    }
    if ('(),.?:'.includes(character)) {
      tokens.push({ kind: 'punctuation', value: character });
      index += 1;
      continue;
    }
    throw new SyntaxError(`Недопустимый символ «${character}» в выражении.`);
  }
  return tokens;
}

function lexicalValue(token: Token): ArduinoValue | undefined {
  if (token.kind === 'number') return parseNumericLiteral(token.value);
  if (token.value === 'true' || token.value === 'false')
    return numericValue('bool', Number(token.value === 'true'));
  const constants: Readonly<Record<string, number>> = {
    HIGH: 1,
    LOW: 0,
    INPUT: 0,
    OUTPUT: 1,
    INPUT_PULLUP: 2,
    LED_BUILTIN: 13,
  };
  if (Object.hasOwn(constants, token.value)) return numericValue('int', constants[token.value]!);
  const analog = /^A([0-5])$/.exec(token.value);
  if (analog) return numericValue('byte', 14 + Number(analog[1]));
  const digital = /^D(\d{1,2})$/.exec(token.value);
  return digital ? numericValue('int', Number(digital[1])) : undefined;
}

// Syntax only: never retain bindings, input samples, current time or evaluated calls.
// Conditional Arduino macros and member calls keep the original token evaluator,
// including its repeated reads, suppression and continuation semantics.
function prepareExpression(tokens: readonly Token[]): PreparedExpression {
  if (
    tokens.some(
      (token, index) =>
        ['.', '++', '--'].includes(token.value) ||
        (['min', 'max', 'abs', 'constrain'].includes(token.value) &&
          tokens[index + 1]?.value === '('),
    )
  )
    return { tokens };
  const precedence: Readonly<Record<string, number>> = {
    '||': 1,
    '&&': 2,
    '==': 3,
    '!=': 3,
    '<': 4,
    '<=': 4,
    '>': 4,
    '>=': 4,
    '+': 5,
    '-': 5,
    '*': 6,
    '/': 6,
    '%': 6,
  };
  let index = 0;
  let nodes = 0;
  const countNode = (): void => {
    // Long flat expressions use the original iterative parser, not a deep AST.
    if (++nodes > 256) throw new SyntaxError();
  };
  const take = (value: string): boolean => {
    if (tokens[index]?.value !== value) return false;
    index++;
    return true;
  };
  const primary = (): ExpressionSyntax => {
    countNode();
    const token = tokens[index++];
    if (!token) throw new SyntaxError();
    if (['!', '-', '+'].includes(token.value))
      return { kind: 'unary', operator: token.value, operand: primary() };
    if (token.value === '(') {
      const node = conditional();
      if (!take(')')) throw new SyntaxError();
      return node;
    }
    if (token.kind !== 'number' && token.kind !== 'identifier') throw new SyntaxError();
    if (token.kind === 'identifier' && take('(')) {
      const args: ExpressionSyntax[] = [];
      if (!take(')')) {
        do {
          args.push(conditional());
        } while (take(','));
        if (!take(')')) throw new SyntaxError();
      }
      return { kind: 'call', name: token.value, args };
    }
    const value = lexicalValue(token);
    return value ? { kind: 'literal', value } : { kind: 'binding', name: token.value };
  };
  const binary = (minimum: number): ExpressionSyntax => {
    let left = primary();
    while (index < tokens.length) {
      const operator = tokens[index]!.value;
      const priority = precedence[operator] ?? 0;
      if (priority < minimum) break;
      index++;
      countNode();
      left = { kind: 'binary', operator, left, right: binary(priority + 1) };
    }
    return left;
  };
  const conditional = (): ExpressionSyntax => {
    const condition = binary(1);
    if (!take('?')) return condition;
    countNode();
    const whenTrue = conditional();
    if (!take(':')) throw new SyntaxError();
    return { kind: 'conditional', condition, whenTrue, whenFalse: conditional() };
  };
  try {
    const syntax = conditional();
    return index === tokens.length ? { tokens: [], syntax } : { tokens };
  } catch {
    // The original validator alone owns supported syntax and diagnostic priority.
    return { tokens };
  }
}

function digitalTerminalFromPin(pin: number): Terminal | null {
  const rounded = Math.round(pin);
  if (rounded >= 0 && rounded <= 13) return `d${rounded}`;
  if (rounded >= 14 && rounded <= 19) return `a${rounded - 14}`;
  return null;
}

function analogTerminalFromPin(pin: number): Terminal | null {
  const rounded = Math.round(pin);
  if (rounded >= 0 && rounded <= 5) return `a${rounded}`;
  if (rounded >= 14 && rounded <= 19) return `a${rounded - 14}`;
  return null;
}

function groundVoltage(inputs: ArduinoTerminalVoltages): number {
  for (const terminal of ['power-gnd-1', 'power-gnd-2', 'gnd-top'] as const) {
    const value = inputs[terminal];
    if (value !== undefined && Number.isFinite(value)) return value;
  }
  return 0;
}

function referenceVoltage(inputs: ArduinoTerminalVoltages): number {
  const measured = Number(inputs['power-5v']) - groundVoltage(inputs);
  return Number.isFinite(measured) && measured > 0.1 ? measured : 5;
}

export function arduinoAnalogReading(inputs: ArduinoTerminalVoltages, terminal: Terminal): number {
  const context = (inputs as ObservedArduinoInputs)[ADC_OBSERVATION];
  if (context?.unconnected.has(terminal)) return unconnectedAdcReading(context, terminal);
  const voltage = Number(inputs[terminal]) - groundVoltage(inputs);
  return Math.round(
    (clamp(voltage, 0, referenceVoltage(inputs)) / referenceVoltage(inputs)) * 1023,
  );
}

export function arduinoDigitalReading(inputs: ArduinoTerminalVoltages, terminal: Terminal): 0 | 1 {
  const voltage = Number(inputs[terminal]) - groundVoltage(inputs);
  return finite(voltage) >= referenceVoltage(inputs) * 0.5 ? 1 : 0;
}

class ExpressionParser {
  private index = 0;
  private replayStream: number | undefined;

  constructor(
    private readonly tokens: readonly Token[],
    private readonly state: RuntimeState,
    private suppressed = 0,
  ) {}

  private get validateOnly(): boolean {
    return Boolean(this.state.validateOnly || this.suppressed);
  }

  parse(): ArduinoValue {
    const value = this.parseConditional();
    if (this.current())
      throw new SyntaxError(
        `Лишний элемент «${this.current()!.value}» в выражении. Проверьте точку с запятой.`,
      );
    return value;
  }

  validateUnarySpan(start: number, end: number, type: ArduinoNumericType): boolean {
    this.index = start;
    const value = this.parseUnary();
    return this.index === end && value.type === type;
  }

  private current(): Token | undefined {
    return this.tokens[this.index];
  }

  private take(value?: string): Token | undefined {
    const token = this.current();
    if (!token || (value !== undefined && token.value !== value)) return undefined;
    this.index += 1;
    return token;
  }

  private parseConditional(): ArduinoValue {
    const condition = this.parseOr();
    if (!this.take('?')) return condition;
    const selected = condition.value !== 0;
    if (!selected) this.suppressed++;
    const whenTrue = this.parseConditional();
    if (!selected) this.suppressed--;
    if (!this.take(':')) throw new SyntaxError('Ожидается : в условном выражении.');
    if (selected) this.suppressed++;
    const whenFalse = this.parseConditional();
    if (selected) this.suppressed--;
    const type =
      whenTrue.type === whenFalse.type ? whenTrue.type : commonType(whenTrue.type, whenFalse.type);
    return convertValue(selected ? whenTrue : whenFalse, type, this.validateOnly);
  }

  private parseOr(): ArduinoValue {
    let value = this.parseAnd();
    while (this.take('||')) {
      const skip = value.value !== 0;
      if (skip) this.suppressed++;
      const right = this.parseAnd();
      if (skip) this.suppressed--;
      value = numericValue('bool', Number(skip || right.value !== 0));
    }
    return value;
  }

  private parseAnd(): ArduinoValue {
    let value = this.parseEquality();
    while (this.take('&&')) {
      const skip = value.value === 0;
      if (skip) this.suppressed++;
      const right = this.parseEquality();
      if (skip) this.suppressed--;
      value = numericValue('bool', Number(!skip && right.value !== 0));
    }
    return value;
  }

  private parseEquality(): ArduinoValue {
    let value = this.parseComparison();
    while (this.current()?.value === '==' || this.current()?.value === '!=') {
      const operator = this.take()?.value;
      const right = this.parseComparison();
      value = binaryValue(operator!, value, right, this.validateOnly);
    }
    return value;
  }

  private parseComparison(): ArduinoValue {
    let value = this.parseAdditive();
    while (['<', '<=', '>', '>='].includes(this.current()?.value ?? '')) {
      const operator = this.take()?.value;
      const right = this.parseAdditive();
      value = binaryValue(operator!, value, right, this.validateOnly);
    }
    return value;
  }

  private parseAdditive(): ArduinoValue {
    let value = this.parseMultiplicative();
    while (this.current()?.value === '+' || this.current()?.value === '-') {
      const operator = this.take()?.value;
      const right = this.parseMultiplicative();
      value = binaryValue(operator!, value, right, this.validateOnly);
    }
    return value;
  }

  private parseMultiplicative(): ArduinoValue {
    let value = this.parseUnary();
    while (['*', '/', '%'].includes(this.current()?.value ?? '')) {
      const operator = this.take()?.value;
      const right = this.parseUnary();
      value = binaryValue(operator!, value, right, this.validateOnly);
    }
    return value;
  }

  // Only identifiers wrapped in parentheses retain scalar lvalue identity.
  private lvalue(index = this.index): { name: string; end: number } | undefined {
    if (this.tokens[index]?.value === '(') {
      const inner = this.lvalue(index + 1);
      return inner && this.tokens[inner.end]?.value === ')'
        ? { name: inner.name, end: inner.end + 1 }
        : undefined;
    }
    const token = this.tokens[index];
    return token?.kind === 'identifier' ? { name: token.value, end: index + 1 } : undefined;
  }

  private increment(name: string, operator: string, prefix: boolean): ArduinoValue {
    const binding = bindingFor(this.state.scopes, name);
    if (binding.constant) throw new SyntaxError(`Нельзя изменять const «${name}».`);
    if (binding.type === 'bool')
      throw new SyntaxError(
        'Инкремент bool не поддерживается; используйте присваивание true/false.',
      );
    const old = readBinding(this.state.scopes, name, this.validateOnly);
    // Validation and short-circuit suppression must never write a binding.
    if (this.validateOnly) return old;
    assignBinding(
      this.state.scopes,
      name,
      binaryValue(operator === '++' ? '+' : '-', old, numericValue('int', 1)),
      false,
    );
    return prefix ? readBinding(this.state.scopes, name, false) : old;
  }

  private parseUnary(): ArduinoValue {
    const replay = this.validateOnly ? undefined : this.state.evaluationReplay;
    if (!replay) return this.readUnary();
    if (this.replayStream === undefined) {
      this.replayStream = replay.streams.findIndex(
        (stream) =>
          stream.length === this.tokens.length &&
          stream.every((token, index) => token === this.tokens[index]!.value),
      );
      if (this.replayStream < 0) {
        this.replayStream = replay.streams.length;
        replay.streams.push(this.tokens.map((token) => token.value));
      }
    }
    const stream = this.replayStream;
    const key = replay.cursor++;
    const parent = replay.stack[replay.stack.length - 1] ?? -1;
    if (key < replay.parents.length && replay.parents[key] !== parent)
      throw new SyntaxError('Некорректная граница продолжения выражения.');
    replay.parents[key] = parent;
    const cached = replay.entries[key];
    if (cached) {
      if (
        cached.stream !== stream ||
        cached.start !== this.index ||
        cached.end > this.tokens.length
      )
        throw new SyntaxError('Некорректное продолжение выражения.');
      this.index = cached.end;
      replay.cursor = cached.next;
      return cached.value;
    }
    if (key >= MAX_ADVANCE_STATEMENTS)
      throw new SyntaxError('Превышен лимит продолжения выражения.');
    // Reserve unfinished ancestors too, so JSON preserves occurrence identities.
    replay.entries[key] = null;
    const start = this.index;
    replay.stack.push(key);
    try {
      const value = this.readUnary();
      replay.entries[key] = { stream, start, end: this.index, next: replay.cursor, value };
      return value;
    } finally {
      replay.stack.pop();
    }
  }

  private readUnary(): ArduinoValue {
    if (['++', '--'].includes(this.current()?.value ?? '')) {
      const operator = this.take()!.value;
      const target = this.lvalue();
      if (!target) throw new SyntaxError('Инкремент требует изменяемую скалярную переменную.');
      this.index = target.end;
      return this.increment(target.name, operator, true);
    }
    if (['!', '-', '+'].includes(this.current()?.value ?? '')) {
      const operator = this.take()!.value;
      return unaryValue(operator, this.parseUnary(), this.validateOnly);
    }
    const target = this.lvalue();
    if (target && ['++', '--'].includes(this.tokens[target.end]?.value ?? '')) {
      this.index = target.end + 1;
      return this.increment(target.name, this.tokens[target.end]!.value, false);
    }
    return this.parsePrimary();
  }

  private parsePrimary(): ArduinoValue {
    const token = this.take();
    if (!token) throw new SyntaxError('Ожидается выражение.');
    if (token.kind === 'number') return parseNumericLiteral(token.value);
    if (token.value === '(') {
      const value = this.parseConditional();
      if (!this.take(')')) throw new SyntaxError('Ожидается закрывающая скобка.');
      return value;
    }
    if (token.kind !== 'identifier') throw new SyntaxError(`Неожиданный элемент «${token.value}».`);
    if (token.value === 'Serial' && this.take('.')) {
      const method = this.take();
      if (!method || method.kind !== 'identifier' || !['available', 'read'].includes(method.value))
        throw new SyntaxError(
          'Поддерживаются только Serial.available() и Serial.read() в выражениях.',
        );
      if (!this.take('(') || !this.take(')'))
        throw new SyntaxError(`Serial.${method.value}() не принимает аргументы.`);
      if (this.validateOnly) return numericValue('int', method.value === 'read' ? -1 : 0);
      if (method.value === 'available')
        return numericValue('int', arduinoSerialAvailable(this.state.serial ?? undefined));
      const read = readArduinoSerial(this.state.serial ?? undefined);
      this.state.serial = read.state ?? null;
      return numericValue('int', read.value);
    }
    if (this.state.servo.objects[token.value] && this.take('.')) {
      const method = this.take();
      if (!method || method.kind !== 'identifier' || method.value !== 'read')
        throw new SyntaxError(
          `Для Servo object «${token.value}» в выражении поддерживается только read().`,
        );
      if (!this.take('(') || !this.take(')'))
        throw new SyntaxError(`${token.value}.read() не принимает аргументы.`);
      return numericValue(
        'int',
        this.state.validateOnly ? 0 : readArduinoServo(this.state.servo, token.value),
      );
    }
    if (this.current()?.value === '(') {
      this.take('(');
      const macro = ['min', 'max', 'abs', 'constrain'].includes(token.value);
      const argumentsList: ArduinoValue[] = [];
      const argumentTokens: Array<readonly Token[]> = [];
      if (this.current()?.value !== ')') {
        do {
          const start = this.index;
          if (macro) this.suppressed++;
          argumentsList.push(this.parseConditional());
          if (macro) this.suppressed--;
          argumentTokens.push(this.tokens.slice(start, this.index));
        } while (this.take(','));
      }
      if (!this.take(')')) throw new SyntaxError('Ожидается закрывающая скобка вызова.');
      if (macro) return this.macro(token.value, argumentsList, argumentTokens);
      return this.call(token.value, argumentsList);
    }
    return lexicalValue(token) ?? readBinding(this.state.scopes, token.value, this.validateOnly);
  }

  // Arduino.h defines these as conditional macros, not eager JS functions.
  // Parse/type-check every argument, but evaluate only the selected branches,
  // including repeated reads in the selected macro expansion.
  private macro(
    name: string,
    types: readonly ArduinoValue[],
    tokens: readonly (readonly Token[])[],
  ): ArduinoValue {
    validateCallArguments(name, types.length, true);
    const conditionalType = (a: ArduinoNumericType, b: ArduinoNumericType): ArduinoNumericType =>
      a === b ? a : commonType(a, b);
    const type =
      name === 'abs'
        ? conditionalType(types[0]!.type, unaryValue('-', types[0]!, true).type)
        : name === 'constrain'
          ? conditionalType(types[1]!.type, conditionalType(types[2]!.type, types[0]!.type))
          : conditionalType(types[0]!.type, types[1]!.type);
    if (this.validateOnly) return zeroValue(type);
    const read = (index: number): ArduinoValue =>
      new ExpressionParser(tokens[index]!, this.state).parse();
    let value: ArduinoValue;
    if (name === 'abs')
      value = binaryValue('>', read(0), zeroValue()).value ? read(0) : unaryValue('-', read(0));
    else if (name === 'constrain')
      value = binaryValue('<', read(0), read(1)).value
        ? read(1)
        : binaryValue('>', read(0), read(2)).value
          ? read(2)
          : read(0);
    else
      value = binaryValue(name === 'min' ? '<' : '>', read(0), read(1)).value ? read(0) : read(1);
    return convertValue(value, type);
  }

  call(name: string, argumentsList: readonly ArduinoValue[]): ArduinoValue {
    validateCallArguments(name, argumentsList.length, true);
    if (this.state.scopes.some((scope) => scope.has(name)))
      throw new SyntaxError(`«${name}» — переменная, а не функция.`);
    const lower = name.toLowerCase();
    if (lower === 'random')
      return this.validateOnly ? zeroValue('long') : draw(this.state, argumentsList);
    if (lower === 'analogread') {
      if (this.validateOnly) return zeroValue();
      const terminal = analogTerminalFromPin(convertValue(argumentsList[0]!, 'byte').value);
      return numericValue('int', terminal ? arduinoAnalogReading(this.state.inputs, terminal) : 0);
    }
    if (lower === 'digitalread') {
      if (this.validateOnly) return zeroValue();
      const terminal = digitalTerminalFromPin(convertValue(argumentsList[0]!, 'byte').value);
      return numericValue('int', terminal ? arduinoDigitalReading(this.state.inputs, terminal) : 0);
    }
    if (lower === 'map') {
      const [value, fromLow, fromHigh, toLow, toHigh] = argumentsList.map((arg) =>
        convertValue(arg, 'long', this.validateOnly),
      );
      const binary = (operator: string, a: ArduinoValue, b: ArduinoValue): ArduinoValue =>
        binaryValue(operator, a, b, this.validateOnly);
      return binary(
        '+',
        binary(
          '/',
          binary('*', binary('-', value!, fromLow!), binary('-', toHigh!, toLow!)),
          binary('-', fromHigh!, fromLow!),
        ),
        toLow!,
      );
    }
    if (lower === 'millis')
      return this.validateOnly
        ? zeroValue('unsigned long')
        : numericValue('unsigned long', Math.floor(this.state.simulationTimeMs) % 4294967296);
    if (lower === 'micros')
      return this.validateOnly
        ? zeroValue('unsigned long')
        : numericValue(
            'unsigned long',
            microsecondsFromMilliseconds(this.state.simulationTimeMs) % 4294967296,
          );
    if (lower === 'readultrasoniccm') {
      if (this.validateOnly) return zeroValue('float');
      const triggerTerminal = digitalTerminalFromPin(convertValue(argumentsList[0]!, 'byte').value);
      const echoTerminal = digitalTerminalFromPin(convertValue(argumentsList[1]!, 'byte').value);
      if (!triggerTerminal || !echoTerminal) return zeroValue('float');
      const nowMicroseconds = microsecondsFromMilliseconds(this.state.simulationTimeMs);
      const pending = this.state.ultrasonicAdapter;
      if (
        pending &&
        (pending.triggerTerminal !== triggerTerminal || pending.echoTerminal !== echoTerminal)
      )
        throw new SyntaxError('Продолжение readUltrasonicCm() не соответствует текущему вызову.');
      if (!pending) {
        this.state.actions.push(
          { kind: 'pin-mode', terminal: triggerTerminal, mode: 'OUTPUT' },
          { kind: 'write', terminal: triggerTerminal, targetVoltage: 0 },
        );
        this.state.ultrasonicAdapter = {
          triggerTerminal,
          echoTerminal,
          phase: 'trigger-low-delay',
        };
        throw new ArduinoUltrasonicAdapterWaitSignal(
          Math.min(MAX_CLOCK_MICROSECONDS, nowMicroseconds + 2),
        );
      }
      if (pending.phase === 'trigger-low-delay') {
        this.state.actions.push({
          kind: 'write',
          terminal: triggerTerminal,
          targetVoltage: 5,
        });
        this.state.ultrasonicAdapter = {
          triggerTerminal,
          echoTerminal,
          phase: 'trigger-high-delay',
        };
        throw new ArduinoUltrasonicAdapterWaitSignal(
          Math.min(MAX_CLOCK_MICROSECONDS, nowMicroseconds + 10),
        );
      }
      if (pending.phase === 'trigger-high-delay') {
        this.state.actions.push(
          { kind: 'write', terminal: triggerTerminal, targetVoltage: 0 },
          { kind: 'pin-mode', terminal: echoTerminal, mode: 'INPUT' },
        );
        this.state.ultrasonicAdapter = { triggerTerminal, echoTerminal, phase: 'pulse' };
        throw new ArduinoUltrasonicAdapterWaitSignal(
          Math.min(MAX_CLOCK_MICROSECONDS, nowMicroseconds + 1),
        );
      }
      const duration = this.call('pulseIn', [argumentsList[1]!, numericValue('byte', 1)]);
      this.state.ultrasonicAdapter = null;
      return numericValue('float', duration.value * 0.01723);
    }
    if (lower === 'pulsein') {
      if (this.validateOnly) return zeroValue('unsigned long');
      const terminal = digitalTerminalFromPin(convertValue(argumentsList[0]!, 'byte').value);
      const target = convertValue(argumentsList[1]!, 'byte').value;
      if (target !== 0 && target !== 1)
        throw new SyntaxError('pulseIn() принимает только HIGH или LOW как состояние импульса.');
      if (!terminal) return zeroValue('unsigned long');
      const timeoutMicroseconds = argumentsList[2]
        ? convertValue(argumentsList[2], 'unsigned long').value
        : DEFAULT_PULSE_IN_TIMEOUT_US;
      const nowMicroseconds = microsecondsFromMilliseconds(this.state.simulationTimeMs);
      const targetHigh = target === 1;
      const targetActive =
        (arduinoDigitalReading(this.state.inputs, terminal) !== 0) === targetHigh;
      const pending = this.state.pulseWait;
      if (
        pending &&
        (pending.terminal !== terminal ||
          pending.targetHigh !== targetHigh ||
          pending.timeoutMicroseconds !== timeoutMicroseconds)
      )
        throw new SyntaxError('Продолжение pulseIn() не соответствует текущему вызову.');
      const step = pending
        ? advanceArduinoPulseWait(pending, nowMicroseconds, targetActive)
        : beginArduinoPulseWait(
            terminal,
            targetHigh,
            timeoutMicroseconds,
            nowMicroseconds,
            Math.min(MAX_CLOCK_MICROSECONDS, nowMicroseconds + timeoutMicroseconds),
            targetActive,
          );
      if (step.status === 'done') {
        this.state.pulseWait = null;
        return numericValue('unsigned long', step.durationMicroseconds % 4294967296);
      }
      this.state.pulseWait = step.state;
      throw new ArduinoPulseWaitSignal(step.state.deadlineMicroseconds);
    }
    throw new SyntaxError(`Команда «${name}» не поддерживается.`);
  }
}

function evaluate(expression: string, state: RuntimeState): number {
  return evaluateValue(expression, state).value;
}

function evaluateValue(expression: string, state: RuntimeState): ArduinoValue {
  const prepared = state.expressions?.[expression];
  if (prepared?.syntax && !state.evaluationReplay) return evaluateSyntax(prepared.syntax, state);
  const tokens = prepared?.syntax
    ? tokenize(expression)
    : (prepared?.tokens ?? tokenize(expression));
  state.prepareExpression?.(expression, tokens);
  return new ExpressionParser(tokens, state).parse();
}

function evaluateSyntax(
  node: ExpressionSyntax,
  state: RuntimeState,
  suppressed = false,
): ArduinoValue {
  const validateOnly = Boolean(state.validateOnly || suppressed);
  if (node.kind === 'literal') return node.value;
  if (node.kind === 'binding') return readBinding(state.scopes, node.name, validateOnly);
  if (node.kind === 'unary')
    return unaryValue(node.operator, evaluateSyntax(node.operand, state, suppressed), validateOnly);
  if (node.kind === 'conditional') {
    const selected = evaluateSyntax(node.condition, state, suppressed).value !== 0;
    const whenTrue = evaluateSyntax(node.whenTrue, state, suppressed || !selected);
    const whenFalse = evaluateSyntax(node.whenFalse, state, suppressed || selected);
    const type =
      whenTrue.type === whenFalse.type ? whenTrue.type : commonType(whenTrue.type, whenFalse.type);
    return convertValue(selected ? whenTrue : whenFalse, type, validateOnly);
  }
  if (node.kind === 'call') {
    if (
      state.ownedClockCalls &&
      node.args.length === 0 &&
      (node.name === 'millis' || node.name === 'micros')
    )
      return state.ownedClockCalls.adapters[suppressed ? 1 : 0].call(
        node.name,
        state.ownedClockCalls.arguments,
      );
    const args = node.args.map((arg) => evaluateSyntax(arg, state, suppressed));
    return new ExpressionParser([], state, Number(suppressed)).call(node.name, args);
  }
  const left = evaluateSyntax(node.left, state, suppressed);
  const skip =
    node.operator === '||' ? left.value !== 0 : node.operator === '&&' && left.value === 0;
  const right = evaluateSyntax(node.right, state, suppressed || skip);
  if (node.operator === '||') return numericValue('bool', Number(skip || right.value !== 0));
  if (node.operator === '&&') return numericValue('bool', Number(!skip && right.value !== 0));
  return binaryValue(node.operator, left, right, validateOnly);
}

function validateCallArguments(name: string, count: number, expression = false): void {
  const valueCalls: Readonly<Record<string, readonly [number, number]>> = {
    random: [0, 2],
    digitalRead: [1, 1],
    analogRead: [1, 1],
    millis: [0, 0],
    micros: [0, 0],
    pulseIn: [2, 3],
    readUltrasonicCm: [2, 2],
    map: [5, 5],
    constrain: [3, 3],
    abs: [1, 1],
    min: [2, 2],
    max: [2, 2],
  };
  const commandCalls: Readonly<Record<string, readonly [number, number]>> = {
    randomSeed: [1, 1],
    pinMode: [2, 2],
    digitalWrite: [2, 2],
    analogWrite: [2, 2],
    delay: [1, 1],
    delayMicroseconds: [1, 1],
    tone: [2, 3],
    noTone: [1, 1],
  };
  const range = valueCalls[name] ?? (expression ? undefined : commandCalls[name]);
  if (!range) throw new SyntaxError(`Команда «${name}» не поддерживается в этом выражении.`);
  if (count < range[0] || count > range[1])
    throw new SyntaxError(`Неверное число аргументов ${name}().`);
}

function functionBody(source: string, name: 'setup' | 'loop', syntax = source): string | null {
  const declaration = new RegExp(`\\bvoid\\s+${name}\\s*\\(\\s*(?:void\\s*)?\\)\\s*\\{`).exec(
    syntax,
  );
  if (!declaration) return null;
  const start = declaration.index + declaration[0].length;
  let depth = 1;
  for (let index = start; index < source.length; index += 1) {
    if (source[index] === '"' || source[index] === "'") {
      index = quotedEnd(source, index);
      continue;
    }
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(start, index);
  }
  return null;
}

function quotedEnd(source: string, start: number): number {
  for (let index = start + 1; index < source.length; index++) {
    if (source[index] === '\\') index++;
    else if (source[index] === source[start]) return index;
  }
  return source.length;
}

function balancedSlice(
  source: string,
  start: number,
  open: '(' | '{',
  close: ')' | '}',
): { readonly content: string; readonly end: number } | null {
  if (source[start] !== open) return null;
  let depth = 1;
  for (let index = start + 1; index < source.length; index += 1) {
    if (source[index] === '"' || source[index] === "'") {
      index = quotedEnd(source, index);
      continue;
    }
    if (source[index] === open) depth += 1;
    if (source[index] === close) depth -= 1;
    if (depth === 0) return { content: source.slice(start + 1, index), end: index + 1 };
  }
  return null;
}

function splitArguments(source: string): readonly string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === '(') depth += 1;
    if (source[index] === ')') depth -= 1;
    if (source[index] === ',' && depth === 0) {
      parts.push(source.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(source.slice(start).trim());
  return parts;
}

function executeSerialMemberStatement(statement: string, state: RuntimeState): boolean {
  const call = /^Serial\s*\.\s*(begin|print|println)\s*\(([\s\S]*)\)$/.exec(statement);
  if (!call) return false;
  const method = call[1]!;
  const argumentsList = splitArduinoSerialArguments(call[2] ?? '');
  const expected = method === 'begin' || method === 'print' ? [1, 1] : [0, 1];
  if (argumentsList.length < expected[0] || argumentsList.length > expected[1])
    throw new SyntaxError(`Serial.${method}() получил неверное число аргументов.`);

  if (method === 'begin') {
    const rawBaud = evaluateValue(argumentsList[0]!, state);
    const baud = convertValue(rawBaud, 'unsigned long', state.validateOnly).value;
    if (!state.validateOnly) {
      if (!Number.isSafeInteger(rawBaud.value) || rawBaud.value <= 0 || rawBaud.value > 0xffffffff)
        throw new SyntaxError('Serial.begin() требует положительную baud rate типа unsigned long.');
      state.serial = beginArduinoSerial(state.serial ?? initialArduinoSerialState(), baud);
    }
    return true;
  }

  let text = '';
  if (argumentsList.length === 1) {
    const literal = parseArduinoSerialStringLiteral(argumentsList[0]!);
    if (literal !== null) text = literal;
    else text = formatArduinoSerialNumber(evaluateValue(argumentsList[0]!, state).value);
  }
  if (!state.validateOnly)
    state.serial = appendArduinoSerialTx(
      state.serial ?? initialArduinoSerialState(),
      microsecondsFromMilliseconds(state.simulationTimeMs),
      text,
      method === 'println',
    );
  return true;
}

function executeServoMemberStatement(statement: string, state: RuntimeState): boolean {
  const call = /^([A-Za-z_]\w*)\s*\.\s*(attach|write|detach)\s*\(([\s\S]*)\)$/.exec(statement);
  if (!call || !(call[1]! in state.servo.objects)) return false;
  const name = call[1]!;
  const method = call[2]!;
  const argumentsList = splitArguments(call[3] ?? '').filter(Boolean);
  const atMicroseconds = microsecondsFromMilliseconds(state.simulationTimeMs);
  if (method === 'detach') {
    if (argumentsList.length !== 0)
      throw new SyntaxError(`${name}.detach() не принимает аргументы.`);
    if (state.validateOnly) return true;
    const pin = state.servo.objects[name]?.pin;
    state.servo = detachArduinoServo(state.servo, name);
    if (pin)
      state.actions.push({ kind: 'write', terminal: pin, targetVoltage: 0, enableOutput: true });
    return true;
  }
  if (argumentsList.length !== 1)
    throw new SyntaxError(`${name}.${method}() принимает один аргумент.`);
  const value = evaluateValue(argumentsList[0]!, state).value;
  if (method === 'attach') {
    const terminal = digitalTerminalFromPin(value);
    if (!terminal) throw new SyntaxError(`${name}.attach() требует цифровой вывод D0–D13.`);
    if (state.validateOnly) return true;
    state.servo = attachArduinoServo(state.servo, name, terminal, atMicroseconds);
    state.actions.push({ kind: 'pin-mode', terminal, mode: 'OUTPUT' });
    return true;
  }
  if (state.validateOnly) return true;
  state.servo = writeArduinoServo(state.servo, name, value, atMicroseconds);
  return true;
}

function prepareStatement(statement: string): PreparedStatement {
  const compact = statement.trim();
  // Plain capture arrays retain no RegExp input/groups metadata outside the byte budget.
  const call = /^([A-Za-z_]\w*)\s*\(([\s\S]*)\)$/.exec(compact)?.slice() ?? null;
  return {
    compact,
    member: /^[A-Za-z_]\w*\s*\./.test(compact),
    declaration: parseDeclaration(compact),
    assignment:
      /^([A-Za-z_]\w*)\s*(=|\+=|-=|\*=|\/=|%=)\s*([\s\S]+)$/.exec(compact)?.slice() ?? null,
    increment: /^(?:\+\+|--)?([A-Za-z_]\w*)(\+\+|--)?$/.exec(compact)?.slice() ?? null,
    call,
    arguments: call ? splitArguments(call[2] ?? '') : [],
  };
}

function executeSimpleStatement(
  statement: string,
  state: RuntimeState,
  prepared?: PreparedStatement,
): void {
  const compact = prepared ? prepared.compact : statement.trim();
  if (!compact || !consumeStatement(state)) return;
  if (
    (!prepared || prepared.member) &&
    (executeSerialMemberStatement(compact, state) || executeServoMemberStatement(compact, state))
  )
    return;

  const declaration = prepared ? prepared.declaration : parseDeclaration(compact);
  if (declaration) {
    declareVariable(declaration, state);
    return;
  }
  const assignment = prepared
    ? prepared.assignment
    : /^([A-Za-z_]\w*)\s*(=|\+=|-=|\*=|\/=|%=)\s*([\s\S]+)$/.exec(compact);
  if (assignment) {
    const name = assignment[1]!;
    bindingFor(state.scopes, name);
    const value = evaluateValue(assignment[3]!, state);
    const result =
      assignment[2] === '='
        ? value
        : binaryValue(
            assignment[2]![0]!,
            readBinding(state.scopes, name, Boolean(state.validateOnly)),
            value,
            state.validateOnly,
          );
    assignBinding(state.scopes, name, result, Boolean(state.validateOnly));
    return;
  }
  const increment = prepared
    ? prepared.increment
    : /^(?:\+\+|--)?([A-Za-z_]\w*)(\+\+|--)?$/.exec(compact);
  if (increment && (compact.startsWith('++') || compact.startsWith('--') || increment[2])) {
    if (increment[2] && (compact.startsWith('++') || compact.startsWith('--')))
      throw new SyntaxError('Нельзя совмещать префиксный и постфиксный инкремент.');
    const name = increment[1]!;
    const delta = compact.includes('++') ? 1 : -1;
    const current = readBinding(state.scopes, name, Boolean(state.validateOnly));
    if (current.type === 'bool')
      throw new SyntaxError(
        'Инкремент bool не поддерживается; используйте присваивание true/false.',
      );
    assignBinding(
      state.scopes,
      name,
      binaryValue('+', current, numericValue('int', delta), state.validateOnly),
      Boolean(state.validateOnly),
    );
    return;
  }

  const call = prepared ? prepared.call : /^([A-Za-z_]\w*)\s*\(([\s\S]*)\)$/.exec(compact);
  if (!call)
    throw new SyntaxError('Не удалось разобрать команду. Проверьте синтаксис и точку с запятой.');
  const name = call[1]!.toLowerCase();
  const argumentsList = prepared ? prepared.arguments : splitArguments(call[2] ?? '');
  if (argumentsList.some((arg) => arg.length === 0) && call[2]?.trim())
    throw new SyntaxError('Пустой аргумент команды.');
  validateCallArguments(call[1]!, argumentsList.filter((arg) => arg.length > 0).length);
  if (state.scopes.some((scope) => scope.has(call[1]!)))
    throw new SyntaxError(`«${call[1]}» — переменная, а не функция.`);
  if (name === 'randomseed') return seed(state, evaluateValue(argumentsList[0]!, state));
  if (
    ![
      'pinmode',
      'digitalwrite',
      'analogwrite',
      'delay',
      'delaymicroseconds',
      'tone',
      'notone',
    ].includes(name)
  ) {
    evaluateValue(compact, state);
    return;
  }
  const values = argumentsList.filter(Boolean).map((argument) => evaluateValue(argument, state));
  const argument = (index: number, type: ArduinoNumericType): number =>
    convertValue(values[index] ?? zeroValue(), type, state.validateOnly).value;
  const digitalTerminal = ['pinmode', 'digitalwrite', 'analogwrite', 'tone', 'notone'].includes(
    name,
  )
    ? digitalTerminalFromPin(argument(0, 'byte'))
    : null;
  if (name === 'pinmode' && digitalTerminal) {
    const rawMode = argument(1, 'byte');
    const mode =
      rawMode === 0 ? 'INPUT' : rawMode === 1 ? 'OUTPUT' : rawMode === 2 ? 'INPUT_PULLUP' : null;
    if (mode) {
      state.actions.push({ kind: 'pin-mode', terminal: digitalTerminal, mode });
    } else throw new SyntaxError('Режим pinMode должен быть INPUT, INPUT_PULLUP или OUTPUT.');
    return;
  }
  if (name === 'digitalwrite' && digitalTerminal) {
    state.actions.push({
      kind: 'write',
      terminal: digitalTerminal,
      targetVoltage: argument(1, 'byte') === 0 ? 0 : 5,
    });
    return;
  }
  if (name === 'analogwrite' && digitalTerminal) {
    const value = clamp(argument(1, 'int'), 0, 255);
    const targetVoltage = PWM_TERMINALS.has(digitalTerminal)
      ? (5 * value) / 255
      : value < 128
        ? 0
        : 5;
    state.actions.push({
      kind: 'write',
      terminal: digitalTerminal,
      targetVoltage,
      enableOutput: true,
    });
    return;
  }
  if (name === 'delay' || name === 'delaymicroseconds') {
    const rawDuration = argument(
      0,
      name === 'delaymicroseconds' ? 'unsigned int' : 'unsigned long',
    );
    state.actions.push({
      kind: 'delay',
      durationMs: name === 'delaymicroseconds' ? rawDuration / 1000 : rawDuration,
    });
    return;
  }
  if (name === 'tone' && digitalTerminal) {
    const frequencyHz = argument(1, 'unsigned int');
    const durationMs = argument(2, 'unsigned long');
    if (frequencyHz >= 1 && frequencyHz <= 20_000) {
      state.actions.push({
        kind: 'tone',
        terminal: digitalTerminal,
        frequencyHz,
        ...(durationMs > 0 ? { durationMs } : {}),
      });
    }
    return;
  }
  if (name === 'notone' && digitalTerminal) {
    state.actions.push({ kind: 'no-tone', terminal: digitalTerminal });
  }
}

function skipWhitespace(source: string, start: number): number {
  let index = start;
  while (index < source.length && /\s/.test(source[index] ?? '')) index += 1;
  return index;
}

function splitForHeader(source: string): readonly [string, string, string] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === '(') depth += 1;
    if (source[index] === ')') depth -= 1;
    if (source[index] === ';' && depth === 0) {
      parts.push(source.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(source.slice(start).trim());
  return [parts[0] ?? '', parts[1] ?? '', parts[2] ?? ''];
}

interface CompileMessage {
  readonly message: string;
  readonly start: number;
  readonly length: number;
}

function compileError(
  diagnostics: CompileMessage[],
  message: string,
  start: number,
  length: number,
): void {
  if (diagnostics.length === 0) diagnostics.push({ message, start, length });
}

function structuralCompileError(source: string): CompileMessage | null {
  const stack: Array<{ readonly character: '(' | '{'; readonly index: number }> = [];
  let quote: '"' | "'" | null = null;
  let quoteStart = 0;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index] ?? '';
    if (quote) {
      if (character === '\\') index += 1;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      quoteStart = index;
      continue;
    }
    if (character === '(' || character === '{') {
      stack.push({ character, index });
      continue;
    }
    if (character !== ')' && character !== '}') continue;
    const expected = character === ')' ? '(' : '{';
    const opening = stack.pop();
    if (!opening || opening.character !== expected) {
      return {
        message: `Ошибка синтаксиса Arduino: лишняя закрывающая скобка «${character}».`,
        start: index,
        length: 1,
      };
    }
  }
  if (quote)
    return {
      message: 'Ошибка синтаксиса Arduino: строка или символ не закрыты кавычкой.',
      start: quoteStart,
      length: 1,
    };
  const opening = stack.pop();
  if (!opening) return null;
  const expected = opening.character === '(' ? ')' : '}';
  return {
    message: `Ошибка синтаксиса Arduino: для «${opening.character}» не найдена закрывающая скобка «${expected}».`,
    start: opening.index,
    length: 1,
  };
}

// Keep a dangling else attached to its nearest if when locating a loop body.
function controlledStatement(
  source: string,
  start: number,
): { content: string; end: number; offset: number } | null {
  start = skipWhitespace(source, start);
  if (source[start] === '{') {
    const block = balancedSlice(source, start, '{', '}');
    return block ? { ...block, offset: start + 1 } : null;
  }
  if (/^do\b/.test(source.slice(start))) {
    const body = controlledStatement(source, start + 2);
    if (!body) return null;
    const tail = skipWhitespace(source, body.end);
    if (!/^while\b/.test(source.slice(tail))) return null;
    const condition = balancedSlice(source, skipWhitespace(source, tail + 5), '(', ')');
    if (!condition) return null;
    const end = skipWhitespace(source, condition.end);
    return source[end] === ';'
      ? { content: source.slice(start, end + 1), offset: start, end: end + 1 }
      : null;
  }
  const control = /^(if|while|for|switch)\b/.exec(source.slice(start));
  if (control) {
    const header = balancedSlice(
      source,
      skipWhitespace(source, start + control[0].length),
      '(',
      ')',
    );
    if (!header) return null;
    const body = controlledStatement(source, header.end);
    if (!body) return null;
    let end = body.end;
    const next = skipWhitespace(source, end);
    if (control[1] === 'if' && /^else\b/.test(source.slice(next))) {
      const alternate = controlledStatement(source, next + 4);
      if (!alternate) return null;
      end = alternate.end;
    }
    return { content: source.slice(start, end), offset: start, end };
  }
  let depth = 0;
  let quoted = false;
  for (let end = start; end < source.length; end += 1) {
    const character = source[end];
    if (character === '"' && (source.slice(0, end).match(/\\*$/)?.[0].length ?? 0) % 2 === 0)
      quoted = !quoted;
    if (quoted) continue;
    if (character === '(') depth += 1;
    if (character === ')') depth -= 1;
    if (character === '{' || character === '}' || depth < 0) return null;
    if (character === ';' && depth === 0)
      return { content: source.slice(start, end + 1), offset: start, end: end + 1 };
  }
  return null;
}

interface CompilingBreak {
  readonly scopeDepth: number;
  readonly breaks: JumpInstruction[];
}
interface CompilingLoop extends CompilingBreak {
  readonly continues: JumpInstruction[];
}

function compileStatements(
  source: string,
  instructions: CompiledInstruction[] = [],
  diagnostics: CompileMessage[] = [],
  scope: 'setup' | 'loop' = 'loop',
  firstLine = 1,
  forHeaderName?: string,
  firstOffset = 0,
  locations = new Map<object, { start: number; length: number }>(),
  loop?: CompilingLoop,
  scopeDepth = 0,
  functions?: ReadonlyMap<string, ArduinoVoidFunction>,
  helperBody = false,
  breakable: CompilingBreak | undefined = loop,
): readonly CompiledInstruction[] {
  const lineAt = (offset: number): number =>
    firstLine + (source.slice(0, offset).match(/\n/g)?.length ?? 0);
  const compileBlock = (
    body: string,
    offset: number,
    headerName?: string,
    bodyLoop = loop,
    parentDepth = scopeDepth,
    bodyBreak = bodyLoop === loop ? breakable : bodyLoop,
  ): void => {
    instructions.push({ kind: 'enter-scope' });
    compileStatements(
      body,
      instructions,
      diagnostics,
      scope,
      lineAt(offset),
      headerName,
      firstOffset + offset,
      locations,
      bodyLoop,
      parentDepth + 1,
      functions,
      helperBody,
      bodyBreak,
    );
    instructions.push({ kind: 'exit-scope' });
  };
  let index = 0;
  let end = 0;
  const error = (
    message: string,
    start = index,
    length = source.slice(index, end).trimEnd().length,
  ): void => compileError(diagnostics, message, firstOffset + start, Math.max(1, length));
  const record = (instruction: CompiledInstruction, start = index, length = end - index): void => {
    locations.set(instruction, { start: firstOffset + start, length: Math.max(1, length) });
    instructions.push(instruction);
  };
  while (index < source.length) {
    index = skipWhitespace(source, index);
    if (index >= source.length) break;
    if (source[index] === '#') {
      index = source.indexOf('\n', index);
      if (index < 0) break;
      continue;
    }
    const remaining = source.slice(index);
    end = index + (/^[A-Za-z_]\w*/.exec(remaining)?.[0].length ?? 1);
    const line = lineAt(index);
    if (/^switch\b/.test(remaining)) {
      const opening = skipWhitespace(source, index + 6);
      const selector = balancedSlice(source, opening, '(', ')');
      const bodyStart = selector ? skipWhitespace(source, selector.end) : -1;
      const body = bodyStart >= 0 ? balancedSlice(source, bodyStart, '{', '}') : null;
      if (!selector || !body) {
        error('После switch ожидаются условие и блок.');
        break;
      }
      try {
        const sections = arduinoSwitchSections(body.content);
        const dispatch: SwitchInstruction = {
          kind: 'switch',
          selector: selector.content,
          cases: [],
          defaultTarget: -1,
          line,
        };
        instructions.push({ kind: 'enter-scope' });
        record(dispatch, opening + 1, selector.content.length);
        const context: CompilingBreak = { scopeDepth: scopeDepth + 1, breaks: [] };
        for (const [sectionIndex, section] of sections.entries()) {
          if (section.isDefault) dispatch.defaultTarget = instructions.length;
          if (section.expression !== undefined) {
            const entry = { expression: section.expression, target: instructions.length };
            dispatch.cases.push(entry);
            locations.set(entry, {
              start: firstOffset + bodyStart + 1 + section.labelOffset!,
              length: section.labelLength!,
            });
          }
          const from = instructions.length;
          compileStatements(
            section.body,
            instructions,
            diagnostics,
            scope,
            lineAt(bodyStart + 1 + section.offset),
            undefined,
            firstOffset + bodyStart + 1 + section.offset,
            locations,
            loop,
            scopeDepth + 1,
            functions,
            helperBody,
            context,
          );
          let depth = 0;
          for (const instruction of instructions.slice(from)) {
            if (instruction.kind === 'enter-scope') depth++;
            if (instruction.kind === 'exit-scope') depth--;
            if (
              sectionIndex < sections.length - 1 &&
              depth === 0 &&
              instruction.kind === 'simple' &&
              parseDeclaration(instruction.statement)
            )
              throw new SyntaxError(
                'Объявление перед следующей меткой case требует отдельного блока.',
              );
          }
        }
        if (dispatch.defaultTarget < 0) dispatch.defaultTarget = instructions.length;
        for (const jump of context.breaks) jump.target = instructions.length;
        instructions.push({ kind: 'exit-scope' });
      } catch (caught) {
        if (!(caught instanceof SyntaxError)) throw caught;
        error(caught.message, index, 6);
      }
      index = body.end;
      continue;
    }
    if (source[index] === '{') {
      const block = balancedSlice(source, index, '{', '}');
      if (!block) {
        error('Незакрытый блок.');
        break;
      }
      compileBlock(block.content, index + 1);
      index = block.end;
      continue;
    }
    if (/^do\b/.test(remaining)) {
      const body = controlledStatement(source, index + 2);
      if (!body) {
        error('После do ожидается команда или блок.', index, 2);
        break;
      }
      const tail = skipWhitespace(source, body.end);
      if (!/^while\b/.test(source.slice(tail))) {
        error('После тела do ожидается while (условие);.', tail, 1);
        break;
      }
      const opening = skipWhitespace(source, tail + 5);
      const condition = balancedSlice(source, opening, '(', ')');
      if (!condition) {
        error('После while ожидается условие в круглых скобках.', tail, 5);
        break;
      }
      const closing = skipWhitespace(source, condition.end);
      if (source[closing] !== ';') {
        error('После do…while ожидается точка с запятой.', closing, 1);
        break;
      }
      const bodyIndex = instructions.length;
      const bodyLoop: CompilingLoop = { scopeDepth, breaks: [], continues: [] };
      compileBlock(body.content, body.offset, undefined, bodyLoop);
      if (diagnostics.length > 0) break;
      const branchIndex = instructions.length;
      record(
        {
          kind: 'branch',
          condition: condition.content,
          falseTarget: branchIndex + 2,
          line: lineAt(tail),
        },
        opening + 1,
        condition.content.length,
      );
      instructions.push({ kind: 'jump', target: bodyIndex });
      for (const jump of bodyLoop.breaks) jump.target = instructions.length;
      for (const jump of bodyLoop.continues) jump.target = branchIndex;
      index = closing + 1;
      continue;
    }
    const control = /^(if|while)\b/.exec(remaining);
    if (control) {
      let cursor = skipWhitespace(source, index + control[0].length);
      const condition = balancedSlice(source, cursor, '(', ')');
      if (!condition) {
        error(
          `Ошибка синтаксиса в ${scope}(): после ${control[1]} ожидается условие в круглых скобках.`,
        );
        break;
      }
      cursor = skipWhitespace(source, condition.end);
      const body = controlledStatement(source, cursor);
      if (!body) {
        error(`Ошибка синтаксиса в ${scope}(): после ${control[1]} ожидается команда или блок.`);
        break;
      }
      cursor = skipWhitespace(source, body.end);
      let elseBody: {
        readonly content: string;
        readonly end: number;
        readonly offset: number;
      } | null = null;
      if (control[1] === 'if' && /^else\b/.test(source.slice(cursor))) {
        const elseStart = cursor;
        cursor = skipWhitespace(source, cursor + 4);
        elseBody = controlledStatement(source, cursor);
        if (elseBody) cursor = elseBody.end;
        else if (!/^if\b/.test(source.slice(cursor))) {
          error(
            `Ошибка синтаксиса в ${scope}(): после else ожидается команда или блок.`,
            elseStart,
            4,
          );
          break;
        }
      }

      const branchIndex = instructions.length;
      record(
        { kind: 'branch', condition: condition.content, falseTarget: -1, line },
        index,
        condition.end - index,
      );
      const bodyLoop: CompilingLoop | undefined =
        control[1] === 'while' ? { scopeDepth, breaks: [], continues: [] } : loop;
      compileBlock(body.content, body.offset, undefined, bodyLoop);
      if (diagnostics.length > 0) break;
      if (control[1] === 'while') {
        instructions.push({ kind: 'jump', target: branchIndex });
        (instructions[branchIndex] as BranchInstruction).falseTarget = instructions.length;
        for (const jump of bodyLoop!.breaks) jump.target = instructions.length;
        for (const jump of bodyLoop!.continues) jump.target = branchIndex;
      } else if (elseBody) {
        const jumpIndex = instructions.length;
        instructions.push({ kind: 'jump', target: -1 });
        (instructions[branchIndex] as BranchInstruction).falseTarget = instructions.length;
        compileBlock(elseBody.content, elseBody.offset);
        if (diagnostics.length > 0) break;
        (instructions[jumpIndex] as JumpInstruction).target = instructions.length;
      } else {
        (instructions[branchIndex] as BranchInstruction).falseTarget = instructions.length;
      }
      index = cursor;
      continue;
    }
    if (/^for\b/.test(remaining)) {
      let cursor = skipWhitespace(source, index + 3);
      const header = balancedSlice(source, cursor, '(', ')');
      if (!header) {
        error(`Ошибка синтаксиса в ${scope}(): после for ожидаются круглые скобки.`);
        break;
      }
      cursor = skipWhitespace(source, header.end);
      const body = controlledStatement(source, cursor);
      if (!body) {
        error(`Ошибка синтаксиса в ${scope}(): после for ожидается команда или блок.`);
        break;
      }
      if ((header.content.match(/;/g) ?? []).length !== 2) {
        error(
          `Ошибка синтаксиса в ${scope}(): заголовок for должен содержать две точки с запятой.`,
        );
        break;
      }
      const [initialization, condition, increment] = splitForHeader(header.content);
      instructions.push({ kind: 'enter-scope' });
      if (initialization)
        record(
          { kind: 'simple', statement: initialization, line },
          header.end - header.content.length - 1 + header.content.indexOf(initialization),
          initialization.length,
        );
      const branchIndex = instructions.length;
      record(
        { kind: 'branch', condition: condition || '1', falseTarget: -1, line },
        index,
        header.end - index,
      );
      const bodyLoop: CompilingLoop = { scopeDepth: scopeDepth + 1, breaks: [], continues: [] };
      compileBlock(
        body.content,
        body.offset,
        parseDeclaration(initialization)?.name,
        bodyLoop,
        scopeDepth + 1,
      );
      if (diagnostics.length > 0) break;
      for (const jump of bodyLoop.continues) jump.target = instructions.length;
      if (increment)
        record(
          { kind: 'simple', statement: increment, line },
          header.end - header.content.length - 1 + header.content.lastIndexOf(increment),
          increment.length,
        );
      instructions.push({ kind: 'jump', target: branchIndex });
      (instructions[branchIndex] as BranchInstruction).falseTarget = instructions.length;
      for (const jump of bodyLoop.breaks) jump.target = instructions.length;
      instructions.push({ kind: 'exit-scope' });
      index = body.end;
      continue;
    }

    let depth = 0;
    end = index;
    for (; end < source.length; end += 1) {
      if (source[end] === '"' || source[end] === "'") {
        end = quotedEnd(source, end);
        continue;
      }
      if (source[end] === '(') depth += 1;
      if (source[end] === ')') depth -= 1;
      if (source[end] === ';' && depth === 0) break;
    }
    if (end >= source.length) {
      if (source.slice(index).trim()) {
        error(`Ошибка синтаксиса в ${scope}(): команда должна заканчиваться точкой с запятой.`);
      }
      break;
    }
    const statement = source.slice(index, end).trim();
    if (forHeaderName && parseDeclaration(statement)?.name === forHeaderName) {
      error(`Повторное объявление «${forHeaderName}» в теле его цикла for.`);
      break;
    }
    if (statement === 'break' || statement === 'continue') {
      const target = statement === 'break' ? breakable : loop;
      if (!target) {
        error(`Команда ${statement} допустима только внутри цикла.`);
        break;
      }
      const jump: JumpInstruction = {
        kind: 'jump',
        target: -1,
        unwindScopes: scopeDepth - target.scopeDepth,
      };
      record(jump);
      (statement === 'break' ? target.breaks : loop!.continues).push(jump);
    } else if (statement === 'return' && helperBody) {
      record({ kind: 'return', line });
    } else if (statement) {
      const call = /^([A-Za-z_]\w*)\s*\(([\s\S]*)\)$/.exec(statement);
      if (call && functions?.has(call[1]!)) {
        record({
          kind: 'user-call',
          name: call[1]!,
          args: call[2]!.trim() ? splitArduinoSerialArguments(call[2]!) : [],
          line,
        });
      } else record({ kind: 'simple', statement, line });
    }
    index = end + 1;
  }
  return instructions;
}

interface GlobalDeclaration {
  readonly name: string;
  readonly type: ArduinoNumericType;
  readonly constant: boolean;
  readonly initializer?: string;
  readonly line?: number;
}

function parseDeclaration(statement: string): GlobalDeclaration | null {
  const match =
    /^(const\s+)?(unsigned\s+long|unsigned\s+int|int|long|float|double|bool|boolean|byte)\s+([A-Za-z_]\w*)\s*(?:=\s*([\s\S]+))?$/.exec(
      statement.trim(),
    );
  if (!match) return null;
  const type = match[2]!.replace(/\s+/g, ' ');
  return {
    name: match[3]!,
    type: (type === 'boolean' ? 'bool' : type) as ArduinoNumericType,
    constant: Boolean(match[1]),
    ...(match[4] ? { initializer: match[4] } : {}),
  };
}

function declareVariable(
  declaration: GlobalDeclaration,
  state: RuntimeState,
  global = false,
): void {
  const { name, type, constant, initializer } = declaration;
  const scope = state.scopes[state.scopes.length - 1]!;
  if (scope.has(name)) throw new SyntaxError(`Повторное объявление «${name}» в одной области.`);
  if (
    /^(?:true|false|HIGH|LOW|INPUT|OUTPUT|INPUT_PULLUP|LED_BUILTIN|A[0-5]|int|long|float|double|bool|boolean|byte|const|unsigned|void|if|else|for|while|do|break|continue|switch)$/.test(
      name,
    )
  )
    throw new SyntaxError(`Зарезервированное имя «${name}».`);
  if (constant && !initializer)
    throw new SyntaxError(`const «${name}» требует начального значения.`);
  scope.set(name, { type, constant, value: global ? 0 : null });
  if (initializer) {
    try {
      scope.set(name, {
        type,
        constant,
        value: convertValue(evaluateValue(initializer, state), type, state.validateOnly).value,
      });
    } catch (error) {
      // A failed initializer must not leave an invalid half-declared const in
      // the fault snapshot and accidentally turn the next tick into a Reset.
      scope.delete(name);
      throw error;
    }
  }
}

function globalDeclarations(
  source: string,
  locations?: Map<object, { start: number; length: number }>,
): readonly GlobalDeclaration[] {
  const statements: Array<{ text: string; start: number }> = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === '"' || source[index] === "'") {
      index = quotedEnd(source, index);
      continue;
    }
    if (source[index] === '{') {
      if (depth === 0) start = index + 1;
      depth += 1;
      continue;
    }
    if (source[index] === '}') {
      depth = Math.max(0, depth - 1);
      if (depth === 0) start = index + 1;
      continue;
    }
    if (source[index] === ';' && depth === 0) {
      // A supported #include must not hide the first numeric declaration when
      // both precede the first semicolon. Keep the original source for lines.
      statements.push({
        start,
        text: source
          .slice(start, index)
          .replace(/^[\t ]*#[^\r\n]*/gm, '')
          .trim(),
      });
      start = index + 1;
    }
  }

  return statements.flatMap(({ text: statement, start }) => {
    const declaration = parseDeclaration(statement);
    if (!declaration) return [];
    const result = {
      ...declaration,
      line: 1 + (source.slice(0, source.indexOf(statement)).match(/\n/g)?.length ?? 0),
    };
    locations?.set(result, { start: source.indexOf(statement, start), length: statement.length });
    return [result];
  });
}

function initializeGlobals(
  declarations: readonly GlobalDeclaration[],
  state: RuntimeState,
  locate?: (declaration: GlobalDeclaration) => void,
): void {
  for (const declaration of declarations) {
    locate?.(declaration);
    declareVariable(declaration, state, true);
  }
}

interface ArduinoProgramCompilation {
  readonly cleanSource: string;
  readonly fingerprint: string;
  readonly declarations: readonly GlobalDeclaration[];
  readonly servoDeclarations: readonly string[];
  readonly setupInstructions: readonly CompiledInstruction[];
  readonly loopInstructions: readonly CompiledInstruction[];
  readonly functions?: Readonly<
    Record<
      string,
      {
        readonly definition: ArduinoVoidFunction;
        readonly instructions: readonly CompiledInstruction[];
      }
    >
  >;
  readonly expressions: Readonly<Record<string, PreparedExpression>>;
  readonly diagnostics: readonly ArduinoRuntimeDiagnostic[];
}

function functionCallContext(
  active: string | undefined,
  frames: readonly ArduinoFunctionFrame[] | undefined,
): string | undefined {
  return active === undefined
    ? undefined
    : `${frames?.map((frame) => `${frame.callerFunction ?? '$root'}@${frame.returnProgramCounter}`).join('/')}/${active}`;
}

function runtimeInstructions(
  compilation: ArduinoProgramCompilation,
  phase: ArduinoRuntimeState['phase'],
  active?: string,
): readonly CompiledInstruction[] {
  return active === undefined
    ? phase === 'setup'
      ? compilation.setupInstructions
      : compilation.loopInstructions
    : (compilation.functions?.[active]?.instructions ?? []);
}

function instructionScopeDepth(instructions: readonly CompiledInstruction[], pc: number): number {
  return instructions
    .slice(0, pc)
    .reduce(
      (depth, instruction) =>
        depth +
        (instruction.kind === 'enter-scope' ? 1 : instruction.kind === 'exit-scope' ? -1 : 0),
      2,
    );
}

function functionFramesMatch(
  compilation: ArduinoProgramCompilation,
  state: ArduinoRuntimeState,
): boolean {
  if (state.activeFunction === undefined) return state.functionFrames === undefined;
  if (
    !compilation.functions ||
    !state.functionFrames?.length ||
    !Array.from(state.scopes).every(Boolean) ||
    (state.phase === 'loop' && !state.loopIterationActive)
  )
    return false;
  let caller: string | undefined;
  for (const frame of state.functionFrames) {
    if (frame.callerFunction !== caller) return false;
    const stream = runtimeInstructions(compilation, state.phase, caller);
    const instruction = stream[frame.returnProgramCounter - 1];
    if (
      instruction?.kind !== 'user-call' ||
      frame.scopes.length !== instructionScopeDepth(stream, frame.returnProgramCounter) - 1
    )
      return false;
    if (caller !== undefined && !functionParametersMatch(compilation, caller, frame.scopes[0]))
      return false;
    caller = instruction.name;
  }
  return (
    caller === state.activeFunction &&
    functionParametersMatch(compilation, state.activeFunction, state.scopes[1])
  );
}

function functionParametersMatch(
  compilation: ArduinoProgramCompilation,
  name: string,
  scope: ArduinoScopeSnapshot | undefined,
): boolean {
  const fn = compilation.functions?.[name];
  return Boolean(
    fn &&
    scope &&
    fn.definition.parameters.every((parameter) => {
      const binding = scope[parameter.name];
      return (
        binding &&
        binding.type === parameter.type &&
        binding.constant === parameter.constant &&
        binding.value !== null
      );
    }),
  );
}

type InactiveScopePool = (ArduinoScope | undefined)[];

function acquireScope(pool: InactiveScopePool | undefined, depth: number): ArduinoScope {
  const scope = pool?.[depth];
  if (pool) pool[depth] = undefined;
  return scope ?? new Map();
}

function retireScope(pool: InactiveScopePool, depth: number, scope: ArduinoScope): void {
  scope.clear();
  pool[depth] = scope;
}

function resetLocalScopes(scopes: ArduinoScope[], pool?: InactiveScopePool): void {
  if (!pool) {
    scopes.splice(1, scopes.length - 1, new Map());
    return;
  }
  const retired = scopes.splice(1);
  for (const [index, scope] of retired.entries()) retireScope(pool, index + 1, scope);
  scopes.push(acquireScope(pool, 1));
}

function applyScopeInstruction(
  instruction: ScopeInstruction,
  scopes: ArduinoScope[],
  pool?: InactiveScopePool,
): void {
  if (instruction.kind === 'enter-scope') {
    if (scopes.length >= 128)
      throw new SyntaxError('Превышена допустимая вложенность областей Arduino.');
    scopes.push(acquireScope(pool, scopes.length));
  } else {
    if (scopes.length <= 2) throw new SyntaxError('Некорректное завершение области Arduino.');
    const depth = scopes.length - 1;
    const scope = scopes.pop()!;
    if (pool) retireScope(pool, depth, scope);
  }
}

// Immutable literal command operands belong to the compiled instruction, not runtime state.
// Names, reads and side effects are always evaluated against current runtime state.
const literalCommands = new WeakMap<
  CompiledInstruction,
  { name: string; actions: readonly ArduinoProgramAction[] }
>();
function prepareLiteralCommand(instruction: CompiledInstruction, state: RuntimeState): void {
  if (instruction.kind !== 'simple') return;
  const call = /^([A-Za-z_]\w*)\s*\(([\s\S]*)\)$/.exec(instruction.statement.trim());
  if (
    !call ||
    ![
      'pinMode',
      'digitalWrite',
      'analogWrite',
      'delay',
      'delayMicroseconds',
      'tone',
      'noTone',
    ].includes(call[1]!)
  )
    return;
  const args = splitArguments(call[2] ?? '').filter(Boolean);
  const constant = (argument: string) => {
    const tokens = tokenize(argument);
    return (
      tokens.length === 1 &&
      (tokens[0]!.kind === 'number' ||
        ['HIGH', 'LOW', 'INPUT', 'OUTPUT', 'INPUT_PULLUP', 'LED_BUILTIN', 'true', 'false'].includes(
          tokens[0]!.value,
        ))
    );
  };
  if (args.every(constant)) {
    const literalState = { ...state, validateOnly: false, actions: [] as ArduinoProgramAction[] };
    try {
      executeSimpleStatement(instruction.statement, literalState);
    } catch (error) {
      // A validation-only conversion may defer a numeric fault until execution.
      // Preparing immutable literals must not change that error's timing or kind.
      if (error instanceof SyntaxError || error instanceof ArduinoArithmeticError) return;
      throw error;
    }
    literalCommands.set(instruction, {
      name: call[1]!,
      actions: literalState.actions.map((action) => Object.freeze({ ...action })),
    });
  }
}

const COMPILATION_CACHE_ENTRIES = 32;
const COMPILATION_CACHE_BYTES = 2 * 1024 * 1024;
const compilationCache = new Map<
  string,
  { readonly compilation: ArduinoProgramCompilation; readonly bytes: number }
>();
let compilationCacheBytes = 0;

function compileArduinoProgram(source: string): ArduinoProgramCompilation {
  const cached = compilationCache.get(source);
  if (cached) {
    compilationCache.delete(source);
    compilationCache.set(source, cached);
    return cached.compilation;
  }
  const compilation = compileUncachedArduinoProgram(source);
  // Only immutable executable code is reused. Runtime state and invalid
  // programmes never enter the cache. Full source, not a hash, is its identity.
  if (compilation.diagnostics.length !== 0) return compilation;
  const bytes = 2 * (source.length + JSON.stringify(compilation).length);
  const freezeSyntax = (value: object): void => {
    for (const child of Object.values(value))
      if (child && typeof child === 'object' && !Object.isFrozen(child)) freezeSyntax(child);
    Object.freeze(value);
  };
  freezeSyntax(compilation.expressions);
  for (const instruction of [...compilation.setupInstructions, ...compilation.loopInstructions]) {
    if (instruction.kind === 'simple' && instruction.prepared) freezeSyntax(instruction.prepared);
    Object.freeze(instruction);
  }
  for (const declaration of compilation.declarations) Object.freeze(declaration);
  Object.freeze(compilation.declarations);
  Object.freeze(compilation.servoDeclarations);
  Object.freeze(compilation.setupInstructions);
  Object.freeze(compilation.loopInstructions);
  Object.freeze(compilation.diagnostics);
  Object.freeze(compilation);
  if (bytes > COMPILATION_CACHE_BYTES) return compilation;
  while (
    compilationCache.size >= COMPILATION_CACHE_ENTRIES ||
    compilationCacheBytes + bytes > COMPILATION_CACHE_BYTES
  ) {
    const oldest = compilationCache.keys().next().value!;
    compilationCacheBytes -= compilationCache.get(oldest)!.bytes;
    compilationCache.delete(oldest);
  }
  compilationCache.set(source, { compilation, bytes });
  compilationCacheBytes += bytes;
  return compilation;
}

function compileUncachedArduinoProgram(source: string): ArduinoProgramCompilation {
  const offsets: number[] = [];
  const cleanSource = removeComments(source, offsets);
  offsets.push(source.length);
  const messages: CompileMessage[] = [];
  const locations = new Map<object, { start: number; length: number }>();
  const helpers = parseArduinoVoidFunctions(cleanSource);
  const functionSyntax = maskArduinoFunctionSyntax(cleanSource);
  messages.push(...helpers.messages);
  const helperNames = new Map(helpers.functions.map((fn) => [fn.name, fn]));
  const structuralError = structuralCompileError(cleanSource);
  if (structuralError) messages.push(structuralError);
  const declaredSetup = /\bvoid\s+setup\b/i.test(functionSyntax);
  const declaredLoop = /\bvoid\s+loop\b/i.test(functionSyntax);
  const extractedSetupBody = functionBody(cleanSource, 'setup', functionSyntax);
  const extractedLoopBody = functionBody(cleanSource, 'loop', functionSyntax);
  if (!structuralError && declaredSetup && extractedSetupBody === null) {
    messages.push({
      message:
        'Ошибка синтаксиса Arduino: функция setup() должна иметь корректное тело в фигурных скобках.',
      start: cleanSource.search(/\bvoid\s+setup\b/i),
      length: 4,
    });
  }
  if (!structuralError && declaredLoop && extractedLoopBody === null) {
    messages.push({
      message:
        'Ошибка синтаксиса Arduino: функция loop() должна иметь корректное тело в фигурных скобках.',
      start: cleanSource.search(/\bvoid\s+loop\b/i),
      length: 4,
    });
  }
  const setupBody = extractedSetupBody ?? '';
  const loopBody = extractedLoopBody ?? (declaredSetup || declaredLoop ? '' : cleanSource);
  const servoDeclarations = arduinoServoDeclarationNames(cleanSource);
  const declarations = globalDeclarations(cleanSource, locations);
  for (const declaration of declarations) {
    if (helperNames.has(declaration.name))
      messages.push({
        message: `Имя ${declaration.name} занято функцией.`,
        ...(locations.get(declaration) ?? { start: 0, length: 1 }),
      });
  }
  const bodyLine = (name: string): number => {
    const match = new RegExp(`\\bvoid\\s+${name}\\s*\\([^)]*\\)\\s*\\{`).exec(functionSyntax);
    return match
      ? 1 + (cleanSource.slice(0, match.index + match[0].length).match(/\n/g)?.length ?? 0)
      : 1;
  };
  const bodyOffset = (name: string): number => {
    const match = new RegExp(`\\bvoid\\s+${name}\\s*\\(\\s*(?:void\\s*)?\\)\\s*\\{`).exec(
      functionSyntax,
    );
    return match ? match.index + match[0].length : 0;
  };
  const setupInstructions = compileStatements(
    setupBody,
    [],
    messages,
    'setup',
    bodyLine('setup'),
    undefined,
    bodyOffset('setup'),
    locations,
    undefined,
    0,
    helperNames,
  );
  const loopInstructions = compileStatements(
    loopBody,
    [],
    messages,
    'loop',
    bodyLine('loop'),
    undefined,
    bodyOffset('loop'),
    locations,
    undefined,
    0,
    helperNames,
  );
  const functions: NonNullable<ArduinoProgramCompilation['functions']> = Object.assign(
    Object.create(null),
    Object.fromEntries(
      helpers.functions.map((definition) => [
        definition.name,
        {
          definition,
          instructions: compileStatements(
            definition.body,
            [],
            messages,
            'loop',
            definition.line,
            undefined,
            definition.bodyOffset,
            locations,
            undefined,
            0,
            helperNames,
            true,
          ),
        },
      ]),
    ),
  );
  const visiting = new Set<string>();
  const visited = new Set<string>();
  for (const fn of Object.values(functions)) {
    let depth = 2;
    if (
      fn.instructions.some((instruction) => {
        depth +=
          instruction.kind === 'enter-scope' ? 1 : instruction.kind === 'exit-scope' ? -1 : 0;
        return depth > 128;
      })
    )
      messages.push({
        message: `Слишком много вложенных областей в функции ${fn.definition.name}().`,
        start: fn.definition.bodyOffset,
        length: 1,
      });
  }
  const visit = (name: string): void => {
    if (visiting.has(name)) throw new SyntaxError(`Рекурсивный вызов ${name}() не поддерживается.`);
    if (visited.has(name)) return;
    visiting.add(name);
    for (const instruction of functions[name]!.instructions)
      if (instruction.kind === 'user-call') visit(instruction.name);
    visiting.delete(name);
    visited.add(name);
  };
  try {
    for (const fn of helpers.functions) visit(fn.name);
  } catch (error) {
    messages.push({ message: (error as Error).message, start: 0, length: 1 });
  }
  const expressions: Record<string, PreparedExpression> = Object.create(null);
  // Parse every instruction, including unreachable branches, before driving GPIO.
  // This is validation of the bounded language, not execution of the sketch.
  if (messages.length === 0) {
    const validation: RuntimeState = {
      scopes: [new Map()],
      validateOnly: true,
      inputs: {},
      actions: [],
      diagnostics: [],
      pulseWait: null,
      ultrasonicAdapter: null,
      serial: null,
      servo: initialArduinoServoRuntimeState(servoDeclarations),
      simulationTimeMs: 0,
      statementCount: 0,
      prepareExpression(expression, tokens) {
        if (!Object.hasOwn(expressions, expression))
          expressions[expression] = prepareExpression(tokens);
      },
    };
    let position = { start: 0, length: 0 };
    try {
      initializeGlobals(declarations, validation, (declaration) => {
        position = locations.get(declaration)!;
      });
      const globals = new Map(validation.scopes[0]);
      const hasSwitch = [
        ...setupInstructions,
        ...loopInstructions,
        ...Object.values(functions).flatMap((fn) => fn.instructions),
      ].some((instruction) => instruction.kind === 'switch');
      const constantValues = new WeakMap<object, ArduinoValue>();
      const constantValue = (expression: string): ArduinoValue => {
        const tokens = tokenize(expression);
        for (const [index, token] of tokens.entries()) {
          if (['++', '--', '.'].includes(token.value))
            throw new SyntaxError('Метка case требует константного выражения.');
          if (
            token.kind !== 'identifier' ||
            lexicalValue(token) ||
            ['unsigned', 'int', 'long', 'float', 'double', 'bool', 'boolean', 'byte'].includes(
              token.value,
            ) ||
            (['min', 'max', 'abs', 'constrain'].includes(token.value) &&
              tokens[index + 1]?.value === '(')
          )
            continue;
          const binding = bindingFor(validation.scopes, token.value);
          if (!binding || !constantValues.has(binding))
            throw new SyntaxError('Метка case требует константного выражения.');
        }
        return evaluateValue(expression, {
          ...validation,
          validateOnly: false,
          scopes: validation.scopes.map(
            (scope) =>
              new Map(
                [...scope].map(([name, binding]) => [
                  name,
                  { ...binding, value: constantValues.get(binding)?.value ?? null },
                ]),
              ),
          ),
        });
      };
      const retainConstant = (declaration: GlobalDeclaration): void => {
        if (
          !hasSwitch ||
          !declaration.constant ||
          !declaration.initializer ||
          ['float', 'double'].includes(declaration.type)
        )
          return;
        try {
          const value = convertValue(constantValue(declaration.initializer), declaration.type);
          const binding = bindingFor(validation.scopes, declaration.name);
          if (binding) constantValues.set(binding, value);
        } catch {
          /* A legal runtime initializer is not necessarily a case constant. */
        }
      };
      for (const declaration of declarations) {
        if (hasSwitch) position = locations.get(declaration)!;
        if (hasSwitch && reservedArduinoFunctionIdentifier(declaration.name))
          throw new SyntaxError(`Зарезервированное имя «${declaration.name}».`);
        retainConstant(declaration);
      }
      for (const [instructions, parameters, helper] of [
        [setupInstructions, [], false],
        [loopInstructions, [], false],
        ...Object.values(functions).map(
          (fn) => [fn.instructions, fn.definition.parameters, true] as const,
        ),
      ] as const) {
        validation.scopes.splice(
          0,
          validation.scopes.length,
          new Map(globals),
          new Map(
            parameters.map((parameter) => [
              parameter.name,
              { type: parameter.type, constant: parameter.constant, value: 0 },
            ]),
          ),
        );
        for (const instruction of instructions) {
          position = locations.get(instruction) ?? position;
          validation.statementCount = 0;
          validation.actions.length = 0;
          if (instruction.kind === 'branch') evaluate(instruction.condition, validation);
          if (instruction.kind === 'switch') {
            const type = arduinoSwitchType(evaluateValue(instruction.selector, validation).type);
            const values = new Set<number>();
            for (const entry of instruction.cases) {
              position = locations.get(entry) ?? position;
              entry.value = arduinoSwitchCase(constantValue(entry.expression), type);
              if (values.has(entry.value)) throw new SyntaxError('Повторная метка case.');
              values.add(entry.value);
            }
          }
          if (instruction.kind === 'simple') {
            const declaration =
              helper || hasSwitch ? parseDeclaration(instruction.statement) : null;
            if (declaration && reservedArduinoFunctionIdentifier(declaration.name))
              throw new SyntaxError(`Зарезервированное имя «${declaration.name}».`);
            executeSimpleStatement(instruction.statement, validation);
            const constant = hasSwitch ? parseDeclaration(instruction.statement) : null;
            if (constant) retainConstant(constant);
            prepareLiteralCommand(instruction, validation);
            instruction.prepared = prepareStatement(instruction.statement);
          }
          if (instruction.kind === 'user-call') {
            for (const scope of validation.scopes)
              if (scope.has(instruction.name))
                throw new SyntaxError(`«${instruction.name}» — переменная, а не функция.`);
            const fn = functions[instruction.name]!;
            if (instruction.args.length !== fn.definition.parameters.length)
              throw new SyntaxError(
                `Функция ${instruction.name}() ожидает ${fn.definition.parameters.length} аргументов.`,
              );
            instruction.args.forEach((argument, index) =>
              convertValue(
                evaluateValue(argument, validation),
                fn.definition.parameters[index]!.type,
                true,
              ),
            );
          }
          if (instruction.kind === 'enter-scope' || instruction.kind === 'exit-scope')
            applyScopeInstruction(instruction, validation.scopes);
        }
      }
    } catch (error) {
      if (!(error instanceof SyntaxError) && !(error instanceof ArduinoArithmeticError))
        throw error;
      compileError(
        messages,
        `Ошибка программы Arduino: ${error.message}`,
        position.start,
        position.length,
      );
    }
  }
  return {
    cleanSource,
    fingerprint: programFingerprint(source),
    declarations,
    servoDeclarations,
    setupInstructions,
    loopInstructions,
    ...(helpers.functions.length ? { functions } : {}),
    expressions,
    diagnostics: messages.map(({ message, start: offset, length: size }) => {
      const start = offsets[offset] ?? source.length;
      const end = size
        ? (offsets[Math.min(cleanSource.length, offset + size - 1)] ?? start) + 1
        : start;
      const line = 1 + (source.slice(0, start).match(/\n/g)?.length ?? 0);
      return {
        code: 'compile_error',
        severity: 'error',
        message,
        start,
        length: end - start,
        line,
        column: start - source.lastIndexOf('\n', start - 1),
      };
    }),
  };
}

/** Lightweight syntax pass for the supported Arduino subset; it never executes the sketch. */
export function analyseArduinoProgramSyntax(source: string): readonly ArduinoRuntimeDiagnostic[] {
  return compileArduinoProgram(source).diagnostics.map((diagnostic) => ({ ...diagnostic }));
}

/** Validate persisted state before exposing its GPIO to an electrical solver. */
export function arduinoRuntimeStateMatchesProgram(
  source: string,
  state: ArduinoRuntimeState,
): boolean {
  if (!state || !runtimeStateIsValid(state)) return false;
  const compilation = compileArduinoProgram(source);
  if (!functionFramesMatch(compilation, state)) return false;
  const instructions = runtimeInstructions(compilation, state.phase, state.activeFunction);
  const replayText = incrementWaitText(instructions[state.programCounter]);
  if (state.pendingEvaluation) {
    if (!replayText) return false;
    const expressions = Object.keys(compilation.expressions)
      .filter((expression) => replayText.includes(expression))
      .map((expression) => tokenize(expression).map((token) => token.value));
    if (
      state.pendingEvaluation.streams.some(
        (stream) =>
          !expressions.some((tokens) =>
            tokens.some((_, start) =>
              stream.every((token, index) => token === tokens[start + index]),
            ),
          ),
      )
    )
      return false;
    const validation: RuntimeState = {
      scopes: state.scopes.map((scope) => new Map(Object.entries(scope))),
      validateOnly: true,
      inputs: {},
      actions: [],
      diagnostics: [],
      pulseWait: null,
      ultrasonicAdapter: null,
      serial: null,
      servo: initialArduinoServoRuntimeState(compilation.servoDeclarations),
      simulationTimeMs: 0,
      statementCount: 0,
    };
    try {
      const streams = state.pendingEvaluation.streams.map((stream) => tokenize(stream.join(' ')));
      if (
        state.pendingEvaluation.entries.some(
          (entry) =>
            entry &&
            !new ExpressionParser(streams[entry.stream]!, validation).validateUnarySpan(
              entry.start,
              entry.end,
              entry.value.type,
            ),
        )
      )
        return false;
    } catch {
      return false;
    }
  }
  if (replayText && (state.pulseWait || state.ultrasonicAdapter) && !state.pendingEvaluation)
    return false;
  const servoDeclarations = compilation.servoDeclarations;
  const persistedServoNames = state.servo ? Object.keys(state.servo.objects).sort() : [];
  return (
    compilation.diagnostics.length === 0 &&
    (state.servo === undefined ||
      (servoDeclarations.length === persistedServoNames.length &&
        servoDeclarations.every((name, index) => name === persistedServoNames[index]))) &&
    state.programFingerprint === compilation.fingerprint &&
    state.programCounter <= instructions.length &&
    state.scopes.length === instructionScopeDepth(instructions, state.programCounter)
  );
}

/** Existing circuit bridge. Kept on its legacy clock until the shared scheduler is ready. */
export function advanceArduinoRuntime(
  source: string,
  inputs: ArduinoTerminalVoltages = {},
  simulationTimeMs = 0,
  previous?: ArduinoRuntimeState,
  readInputs?: ArduinoInputReader,
): ArduinoRuntimeAdvance {
  return advanceRuntime(source, inputs, simulationTimeMs, previous, readInputs, 'legacy-ms-v1');
}

/**
 * Scheduler foundation, not yet enabled in the circuit bridge.
 * Each compiled instruction and setup/loop return costs one virtual microsecond;
 * effects occur at instruction start. This is an abstract clock, NOT AVR cycles.
 * A work quantum yields a serializable continuation, never a program error.
 * The caller must consume every returned events batch before resuming, use a
 * timestamped input reader (or inputs constant over the entire advance), and
 * must not present a yielded state as the result at the requested future time.
 */
export function advanceClockedArduinoRuntime(
  source: string,
  inputs: ArduinoTerminalVoltages = {},
  simulationTimeMs = 0,
  previous?: ArduinoRuntimeState,
  readInputs?: ArduinoInputReader,
  options: {
    readonly instructionBudget?: number;
    readonly pulseInputSample?: boolean;
    readonly stopAtElectricalBoundary?: boolean;
  } = {},
): ArduinoRuntimeAdvance {
  return advanceRuntime(
    source,
    inputs,
    simulationTimeMs,
    previous,
    readInputs,
    'instruction-us-v1',
    Math.floor(
      clamp(options.instructionBudget ?? MAX_ADVANCE_STATEMENTS, 1, MAX_ADVANCE_STATEMENTS),
    ),
    Boolean(options.pulseInputSample),
    Boolean(options.stopAtElectricalBoundary),
  );
}

interface OwnedRuntimeMemory {
  readonly compilation: ArduinoProgramCompilation;
  readonly inactiveScopes: InactiveScopePool;
  scopes?: ArduinoScope[];
  pinModes?: Map<Terminal, ArduinoPinMode>;
  outputVoltages?: Map<Terminal, number>;
  tones?: Map<Terminal, ArduinoTimedWaveformState>;
  workspace?: {
    readonly state: RuntimeState;
    readonly buffers: {
      actions: ArduinoProgramAction[];
      diagnostics: ArduinoRuntimeDiagnostic[];
    };
  };
}

function createOwnedInstructionWorkspace(
  scopes: ArduinoScope[],
  expressions: ArduinoProgramCompilation['expressions'],
  servo: ArduinoServoRuntimeState,
): NonNullable<OwnedRuntimeMemory['workspace']> {
  const buffers = {
    actions: [] as ArduinoProgramAction[],
    diagnostics: [] as ArduinoRuntimeDiagnostic[],
  };
  // No admitted expression reads inputs. These stable getters select only this
  // invocation's fresh arrays, never arrays already published by an older call.
  const state: RuntimeState = {
    scopes,
    expressions,
    inputs: {},
    get actions() {
      return buffers.actions;
    },
    get diagnostics() {
      return buffers.diagnostics;
    },
    pulseWait: null,
    ultrasonicAdapter: null,
    serial: null,
    servo,
    simulationTimeMs: 0,
    statementCount: 0,
  };
  const ownedClockCalls = {
    adapters: [new ExpressionParser([], state), new ExpressionParser([], state, 1)] as const,
    arguments: Object.freeze([]) as readonly ArduinoValue[],
  };
  Object.defineProperty(state, 'ownedClockCalls', { value: ownedClockCalls });
  return { state, buffers };
}

/** Package internal: only the cloned clock request constructs this working context. */
export function createOwnedClockedArduinoRuntime(source: string, initial?: ArduinoRuntimeState) {
  const compilation = compileArduinoProgram(source);
  const safe = (node: ExpressionSyntax): boolean =>
    node.kind === 'literal' ||
    node.kind === 'binding' ||
    (node.kind === 'unary' && safe(node.operand)) ||
    (node.kind === 'binary' && safe(node.left) && safe(node.right)) ||
    (node.kind === 'conditional' &&
      safe(node.condition) &&
      safe(node.whenTrue) &&
      safe(node.whenFalse)) ||
    (node.kind === 'call' && ['millis', 'micros'].includes(node.name) && node.args.every(safe));
  // These routes have no reader, member/peripheral effect or importer normalization.
  // Other supported programmes keep the public interpreter's original importer.
  if (
    compilation.diagnostics.length ||
    compilation.functions !== undefined ||
    compilation.servoDeclarations.length ||
    (initial &&
      (initial.serial ||
        initial.servo ||
        initial.pulseWait ||
        initial.ultrasonicAdapter ||
        Object.keys(initial.tones).length ||
        initial.scopes.some((scope) =>
          Object.values(scope).some((binding) =>
            Object.keys(binding).some((key) => !['type', 'constant', 'value'].includes(key)),
          ),
        ))) ||
    Object.values(compilation.expressions).some(
      (expression) => !expression.syntax || !safe(expression.syntax),
    ) ||
    [...compilation.setupInstructions, ...compilation.loopInstructions].some(
      (instruction) =>
        instruction.kind === 'switch' ||
        (instruction.kind === 'simple' &&
          (instruction.prepared?.member ||
            (instruction.prepared?.call &&
              !['pinMode', 'digitalWrite', 'analogWrite', 'delay', 'delayMicroseconds'].includes(
                instruction.prepared.call[1]!,
              )))),
    )
  )
    return null;
  let memory: OwnedRuntimeMemory | undefined = { compilation, inactiveScopes: [] };
  let previous = initial;
  return {
    advance(time: number, instructionBudget: number, stopAtElectricalBoundary = false) {
      if (!memory) throw new Error('Disposed Arduino request.');
      const advanced = advanceRuntime(
        source,
        {},
        time,
        previous,
        undefined,
        'instruction-us-v1',
        instructionBudget,
        false,
        stopAtElectricalBoundary,
        memory,
      );
      previous = advanced.state;
      return advanced;
    },
    dispose() {
      memory = undefined;
      previous = undefined;
    },
  };
}

function advanceRuntime(
  source: string,
  inputs: ArduinoTerminalVoltages,
  simulationTimeMs: number,
  previous: ArduinoRuntimeState | undefined,
  readInputs: ArduinoInputReader | undefined,
  clockProfile: ArduinoClockProfile,
  instructionBudget = MAX_ADVANCE_STATEMENTS,
  pulseInputSample = false,
  stopAtElectricalBoundary = false,
  owned?: OwnedRuntimeMemory,
): ArduinoRuntimeAdvance {
  const clocked = clockProfile === 'instruction-us-v1';
  const compilation = owned?.compilation ?? compileArduinoProgram(source);
  const { setupInstructions, loopInstructions, declarations, servoDeclarations, fingerprint } =
    compilation;
  const invalidClockTime =
    clocked &&
    (!Number.isFinite(simulationTimeMs) ||
      simulationTimeMs < 0 ||
      simulationTimeMs > MAX_CLOCK_TARGET_MS);
  const targetTimeMs = clocked
    ? invalidClockTime
      ? 0
      : clockHorizonMilliseconds(simulationTimeMs)
    : Math.max(0, finite(simulationTimeMs));
  const initialDiagnostics: readonly ArduinoRuntimeDiagnostic[] = invalidClockTime
    ? [
        {
          code: 'clock_range_exceeded',
          severity: 'error',
          message:
            'Время Arduino должно быть конечным, неотрицательным и находиться в диапазоне instruction-us-v1 (до 2^50 − 1001 мкс).',
        },
      ]
    : compilation.diagnostics;
  if (initialDiagnostics.length > 0) {
    return {
      executionStatus: 'fault',
      setupActions: [],
      loopActions: [],
      events: [],
      state: {
        version: ARDUINO_RUNTIME_STATE_VERSION,
        clockProfile,
        programFingerprint: fingerprint,
        virtualTimeMs: targetTimeMs,
        resumeAtMs: targetTimeMs,
        phase: 'setup',
        programCounter: 0,
        loopIterationActive: false,
        loopStartedAtMs: targetTimeMs,
        loopIterations: 0,
        nextEventSequence: 0,
        eventQueue: [],
        variables: {},
        locals: {},
        scopes: [{}, {}],
        faults: initialDiagnostics,
        pinModes: {},
        outputVoltages: {},
        tones: {},
        ...(servoDeclarations.length > 0
          ? { servo: initialArduinoServoRuntimeState(servoDeclarations) }
          : {}),
      },
      diagnostics: initialDiagnostics,
    };
  }
  const compatible =
    previous !== undefined &&
    (owned?.scopes !== undefined || arduinoRuntimeStateMatchesProgram(source, previous)) &&
    previous.clockProfile === clockProfile &&
    previous.virtualTimeMs <= targetTimeMs;
  if (
    compatible &&
    (previous.faults.length > 0 ||
      (previous.virtualTimeMs === targetTimeMs &&
        previous.ultrasonicAdapter == null &&
        !(previous.pulseWait && pulseInputSample)))
  ) {
    return {
      executionStatus: previous.faults.length > 0 ? 'fault' : 'ready',
      setupActions: [],
      loopActions: [],
      events: [],
      state:
        previous.virtualTimeMs === targetTimeMs
          ? previous
          : {
              ...previous,
              virtualTimeMs: targetTimeMs,
              resumeAtMs: Math.max(previous.resumeAtMs, targetTimeMs),
            },
      diagnostics: previous.faults,
    };
  }
  const scopes: ArduinoScope[] =
    owned?.scopes ??
    (compatible ? previous.scopes.map((scope) => new Map(Object.entries(scope))) : [new Map()]);
  const pinModes =
    owned?.pinModes ??
    (compatible ? terminalMap(previous.pinModes) : new Map<Terminal, ArduinoPinMode>());
  const outputVoltages =
    owned?.outputVoltages ??
    (compatible ? terminalMap(previous.outputVoltages) : new Map<Terminal, number>());
  const tones =
    owned?.tones ??
    (compatible
      ? new Map(
          [...terminalMap(previous.tones)].flatMap(([terminal, tone]) => {
            const canonical = canonicalToneState(
              tone,
              microsecondsFromMilliseconds(previous.virtualTimeMs),
            );
            return canonical ? ([[terminal, canonical]] as const) : [];
          }),
        )
      : new Map<Terminal, ArduinoTimedWaveformState>());
  if (owned) Object.assign(owned, { scopes, pinModes, outputVoltages, tones });
  const diagnostics: ArduinoRuntimeDiagnostic[] = [];
  const setupActions: ArduinoProgramAction[] = [];
  const loopActions: ArduinoProgramAction[] = [];
  const resetAtMs = previous && previous.virtualTimeMs <= targetTimeMs ? targetTimeMs : 0;
  let resumeAtMs = compatible ? previous.resumeAtMs : resetAtMs;
  let pendingEvaluation = compatible ? previous.pendingEvaluation : undefined;
  let pulseWait = compatible ? (previous.pulseWait ?? null) : null;
  let ultrasonicAdapter = compatible ? (previous.ultrasonicAdapter ?? null) : null;
  let serial = compatible ? (previous.serial ?? null) : null;
  let servo = syncArduinoServoDeclarations(
    compatible ? previous.servo : undefined,
    servoDeclarations,
  );
  if (clocked && compatible && pulseWait && pulseInputSample && resumeAtMs > targetTimeMs)
    resumeAtMs = targetTimeMs;
  let rng = compatible ? previous.randomState : undefined;
  let phase: ArduinoRuntimeState['phase'] = compatible ? previous.phase : 'setup';
  let programCounter = compatible ? previous.programCounter : 0;
  let activeFunction = compatible ? previous.activeFunction : undefined;
  const functionFrames: ArduinoFunctionFrame[] = compatible
    ? [...(previous.functionFrames ?? [])]
    : [];
  let loopIterationActive = compatible ? previous.loopIterationActive : false;
  let loopStartedAtMs = compatible ? previous.loopStartedAtMs : resetAtMs;
  let loopIterations = compatible ? previous.loopIterations : 0;
  let nextEventSequence = compatible ? previous.nextEventSequence : 0;
  const eventQueue = compatible ? [...previous.eventQueue] : [];
  const events: ArduinoRuntimeEvent[] = [];
  const emit = (
    event: Omit<ArduinoRuntimeEvent, 'sequence' | 'atMicroseconds'>,
    atMs: number,
  ): void => {
    const sequenced: ArduinoRuntimeEvent = {
      ...event,
      sequence: nextEventSequence,
      atMicroseconds: microsecondsFromMilliseconds(atMs),
    };
    nextEventSequence += 1;
    eventQueue.push(sequenced);
    events.push(sequenced);
    if (eventQueue.length > ARDUINO_RUNTIME_EVENT_QUEUE_LIMIT) {
      eventQueue.splice(0, eventQueue.length - ARDUINO_RUNTIME_EVENT_QUEUE_LIMIT);
    }
  };
  let advanceStatementCount = 0;
  let continuousStatementCount = 0;
  let executedInstructions = 0;
  const consumeClockInstruction = (): void => {
    if (!clocked) return;
    executedInstructions += 1;
    resumeAtMs =
      Math.min(MAX_CLOCK_MICROSECONDS, microsecondsFromMilliseconds(resumeAtMs) + 1) / 1000;
  };

  if (!compatible) {
    const initializationState: RuntimeState = {
      scopes,
      expressions: compilation.expressions,
      get inputs() {
        return readInputs
          ? readInputs({ simulationTimeMs: resumeAtMs, pinModes, outputVoltages, tones })
          : inputs;
      },
      actions: [],
      diagnostics,
      pulseWait: null,
      ultrasonicAdapter: null,
      serial: null,
      servo,
      simulationTimeMs: resetAtMs,
      statementCount: 0,
    };
    for (const declaration of declarations) {
      try {
        declareVariable(declaration, initializationState, true);
      } catch (error) {
        if (error instanceof ArduinoPulseWaitSignal) {
          diagnostics.push({
            code: 'compile_error',
            severity: 'error',
            message: `Строка ${declaration.line ?? 1}: pulseIn() разрешён только внутри setup()/loop().`,
            line: declaration.line ?? 1,
          });
          break;
        }
        if (!(error instanceof SyntaxError) && !(error instanceof ArduinoArithmeticError))
          throw error;
        diagnostics.push({
          code: error instanceof ArduinoArithmeticError ? 'arithmetic_error' : 'compile_error',
          severity: 'error',
          message: `Строка ${declaration.line ?? 1}: ${error.message}`,
          line: declaration.line ?? 1,
        });
        break;
      }
    }
    rng = initializationState.randomState;
    scopes.push(acquireScope(owned?.inactiveScopes, scopes.length));
  }

  let completedLoops = 0;
  let sampledElectricalInput = false;
  const workspace = owned
    ? (owned.workspace ??= createOwnedInstructionWorkspace(scopes, compilation.expressions, servo))
    : undefined;
  if (workspace) {
    workspace.buffers.actions = phase === 'setup' ? setupActions : loopActions;
    workspace.buffers.diagnostics = diagnostics;
    workspace.state.pulseWait = pulseWait;
    workspace.state.ultrasonicAdapter = ultrasonicAdapter;
    workspace.state.serial = serial;
    workspace.state.servo = servo;
    workspace.state.simulationTimeMs = resumeAtMs;
    workspace.state.statementCount = clocked ? 0 : continuousStatementCount;
  }
  const instructionState: RuntimeState = workspace?.state ?? {
    scopes,
    expressions: compilation.expressions,
    get inputs() {
      sampledElectricalInput = true;
      return readInputs
        ? readInputs({ simulationTimeMs: resumeAtMs, pinModes, outputVoltages, tones })
        : inputs;
    },
    get actions() {
      return phase === 'setup' ? setupActions : loopActions;
    },
    diagnostics,
    pulseWait,
    ultrasonicAdapter,
    serial,
    servo,
    simulationTimeMs: resumeAtMs,
    statementCount: clocked ? 0 : continuousStatementCount,
  };
  const commitActions = (
    actions: readonly ArduinoProgramAction[],
    start: number,
    atMs: number,
  ): void => {
    for (let index = start; index < actions.length; index += 1) {
      const action = actions[index]!;
      if (action.kind === 'delay') {
        resumeAtMs = clocked
          ? Math.min(
              MAX_CLOCK_MICROSECONDS,
              microsecondsFromMilliseconds(resumeAtMs) +
                microsecondsFromMilliseconds(action.durationMs),
            ) / 1000
          : resumeAtMs + action.durationMs;
        if (action.durationMs > 0) continuousStatementCount = 0;
      } else {
        applyRuntimeAction(action, atMs, pinModes, outputVoltages, tones, emit);
      }
    }
  };
  const returnFromFunction = (): void => {
    const caller = functionFrames.pop()!;
    scopes.splice(
      1,
      scopes.length - 1,
      ...caller.scopes.map((scope) => new Map(Object.entries(scope))),
    );
    activeFunction = caller.callerFunction;
    programCounter = caller.returnProgramCounter;
    consumeClockInstruction();
  };
  while (
    resumeAtMs <= targetTimeMs &&
    (clocked
      ? executedInstructions < instructionBudget
      : completedLoops < MAX_LOOP_ADVANCES && advanceStatementCount < MAX_ADVANCE_STATEMENTS) &&
    diagnostics.length === 0
  ) {
    if (
      stopAtElectricalBoundary &&
      executedInstructions > 0 &&
      (events.length > 0 ||
        sampledElectricalInput ||
        pulseWait ||
        ultrasonicAdapter ||
        (servoDeclarations.length > 0 && servo !== previous?.servo))
    )
      break;
    expireTones(resumeAtMs, tones, emit);
    const instructions =
      activeFunction === undefined
        ? phase === 'setup'
          ? setupInstructions
          : loopInstructions
        : compilation.functions![activeFunction]!.instructions;
    if (activeFunction !== undefined && programCounter >= instructions.length) {
      returnFromFunction();
      continue;
    }

    if (phase === 'setup' && programCounter >= instructions.length) {
      if (scopes.length !== 2 || scopes[1]!.size !== 0)
        resetLocalScopes(scopes, owned?.inactiveScopes);
      phase = 'loop';
      programCounter = 0;
      loopIterationActive = false;
      loopStartedAtMs = resumeAtMs;
      continuousStatementCount = 0;
      consumeClockInstruction();
      continue;
    }

    if (phase === 'loop' && !loopIterationActive) {
      loopIterationActive = true;
      loopStartedAtMs = resumeAtMs;
      loopIterations += 1;
    }

    if (phase === 'loop' && programCounter >= instructions.length) {
      if (scopes.length !== 2 || scopes[1]!.size !== 0)
        resetLocalScopes(scopes, owned?.inactiveScopes);
      programCounter = 0;
      loopIterationActive = false;
      completedLoops += 1;
      continuousStatementCount = 0;
      if (clocked) consumeClockInstruction();
      else if (resumeAtMs <= loopStartedAtMs) resumeAtMs = loopStartedAtMs + MIN_LOOP_DURATION_MS;
      continue;
    }

    const instruction = instructions[programCounter];
    if (!instruction) break;
    if (instruction.kind === 'return') {
      returnFromFunction();
      continue;
    }
    if (instruction.kind === 'jump') {
      for (let count = 0; count < (instruction.unwindScopes ?? 0); count += 1)
        applyScopeInstruction({ kind: 'exit-scope' }, scopes, owned?.inactiveScopes);
      programCounter = instruction.target;
      consumeClockInstruction();
      continue;
    }
    if (instruction.kind === 'enter-scope' || instruction.kind === 'exit-scope') {
      applyScopeInstruction(instruction, scopes, owned?.inactiveScopes);
      programCounter += 1;
      consumeClockInstruction();
      continue;
    }

    const actions = phase === 'setup' ? setupActions : loopActions;
    const literal = instruction.kind === 'simple' ? literalCommands.get(instruction) : undefined;
    if (clocked && literal) {
      // Prepared commands contain only literal operands and actions. Execute each
      // instruction normally without marshalling unrelated evaluator peripherals.
      // Binding checks, action order, faults and the one-us instruction cost remain.
      try {
        for (const scope of scopes) {
          if (scope.has(literal.name))
            throw new SyntaxError(`«${literal.name}» — переменная, а не функция.`);
        }
        const actionStart = actions.length;
        for (const action of literal.actions) actions.push(action);
        programCounter += 1;
        commitActions(actions, actionStart, resumeAtMs);
      } catch (error) {
        if (!(error instanceof SyntaxError) && !(error instanceof ArduinoArithmeticError))
          throw error;
        diagnostics.push({
          code: error instanceof ArduinoArithmeticError ? 'arithmetic_error' : 'compile_error',
          severity: 'error',
          message: `Строка ${instruction.line}: ${error.message}`,
          line: instruction.line,
        });
      }
      consumeClockInstruction();
      continue;
    }
    if (workspace) workspace.buffers.actions = actions;
    instructionState.pulseWait = pulseWait;
    instructionState.ultrasonicAdapter = ultrasonicAdapter;
    instructionState.serial = serial;
    instructionState.servo = servo;
    instructionState.randomState = rng;
    instructionState.simulationTimeMs = resumeAtMs;
    instructionState.statementCount = clocked ? 0 : continuousStatementCount;
    instructionState.evaluationReplay = incrementWaitText(instruction)
      ? {
          cursor: 0,
          parents: pendingEvaluation ? [...pendingEvaluation.parents] : [],
          stack: [],
          streams: pendingEvaluation ? [...pendingEvaluation.streams] : [],
          entries: pendingEvaluation ? [...pendingEvaluation.entries] : [],
        }
      : undefined;
    const statementCountBefore = instructionState.statementCount;
    let pulseBlocked = false;
    let ultrasonicAdapterBlocked = false;
    const actionStart = actions.length;
    const executionTimeMs = resumeAtMs;

    try {
      if (instruction.kind === 'switch') {
        if (!consumeStatement(instructionState)) break;
        const selector = evaluateValue(instruction.selector, instructionState);
        arduinoSwitchType(selector.type);
        programCounter =
          instruction.cases.find((entry) => entry.value === selector.value)?.target ??
          instruction.defaultTarget;
      } else if (instruction.kind === 'branch') {
        if (!consumeStatement(instructionState)) break;
        programCounter =
          evaluate(instruction.condition, instructionState) !== 0
            ? programCounter + 1
            : instruction.falseTarget;
      } else if (instruction.kind === 'user-call') {
        if (!consumeStatement(instructionState)) break;
        for (const scope of scopes)
          if (scope.has(instruction.name))
            throw new SyntaxError(`«${instruction.name}» — переменная, а не функция.`);
        const fn = compilation.functions![instruction.name]!;
        const values = instruction.args.map((argument, index) =>
          convertValue(
            evaluateValue(argument, instructionState),
            fn.definition.parameters[index]!.type,
          ),
        );
        if (functionFrames.length >= 128)
          throw new SyntaxError('Превышена глубина вызовов функций.');
        functionFrames.push({
          ...(activeFunction === undefined ? {} : { callerFunction: activeFunction }),
          returnProgramCounter: programCounter + 1,
          scopes: serializeScopes(scopes.slice(1)),
        });
        scopes.splice(
          1,
          scopes.length - 1,
          new Map(
            fn.definition.parameters.map((parameter, index) => [
              parameter.name,
              { type: parameter.type, constant: parameter.constant, value: values[index]!.value },
            ]),
          ),
        );
        activeFunction = instruction.name;
        programCounter = 0;
        commitActions(actions, actionStart, executionTimeMs);
      } else if (instruction.kind === 'simple') {
        if (literal) {
          if (consumeStatement(instructionState)) {
            for (const scope of scopes) {
              if (scope.has(literal.name))
                throw new SyntaxError(`«${literal.name}» — переменная, а не функция.`);
            }
            for (const action of literal.actions) actions.push(action);
          }
        } else
          executeSimpleStatement(instruction.statement, instructionState, instruction.prepared);
        programCounter += 1;
        commitActions(actions, actionStart, executionTimeMs);
      }
    } catch (error) {
      if (error instanceof ArduinoUltrasonicAdapterWaitSignal) {
        ultrasonicAdapterBlocked = true;
        commitActions(actions, actionStart, executionTimeMs);
        resumeAtMs = Math.min(MAX_CLOCK_MICROSECONDS, error.wakeAtMicroseconds) / 1000;
      } else if (error instanceof ArduinoPulseWaitSignal) {
        pulseBlocked = true;
        resumeAtMs = Math.min(MAX_CLOCK_MICROSECONDS, error.wakeAtMicroseconds) / 1000;
      } else {
        if (!(error instanceof SyntaxError) && !(error instanceof ArduinoArithmeticError))
          throw error;
        diagnostics.push({
          code: error instanceof ArduinoArithmeticError ? 'arithmetic_error' : 'compile_error',
          severity: 'error',
          message: `Строка ${instruction.line}: ${error.message}`,
          line: instruction.line,
        });
      }
    }
    const replay = instructionState.evaluationReplay;
    pendingEvaluation =
      (pulseBlocked || ultrasonicAdapterBlocked) && replay
        ? {
            programFingerprint: fingerprint,
            phase,
            programCounter,
            ...(activeFunction === undefined
              ? {}
              : { callContext: functionCallContext(activeFunction, functionFrames)! }),
            parents: replay.parents,
            streams: replay.streams,
            entries: replay.entries,
          }
        : undefined;
    pulseWait = instructionState.pulseWait;
    ultrasonicAdapter = instructionState.ultrasonicAdapter;
    serial = instructionState.serial;
    servo = instructionState.servo;
    rng = instructionState.randomState;
    const consumed = instructionState.statementCount - statementCountBefore;
    advanceStatementCount += consumed;
    continuousStatementCount =
      resumeAtMs > instructionState.simulationTimeMs ? 0 : instructionState.statementCount;
    if (!pulseBlocked && !ultrasonicAdapterBlocked) consumeClockInstruction();
  }

  const yielded = clocked && resumeAtMs <= targetTimeMs && diagnostics.length === 0;
  // The interval before the next instruction is known. Never expire timers at
  // the caller's future target while unexecuted instructions can change them.
  const reachedTimeMs = yielded
    ? Math.max(
        compatible ? previous.virtualTimeMs : resetAtMs,
        (microsecondsFromMilliseconds(resumeAtMs) - 1) / 1000,
      )
    : targetTimeMs;
  expireTones(reachedTimeMs, tones, emit);
  if (!clocked) {
    const reachedMicroseconds = microsecondsFromMilliseconds(reachedTimeMs);
    servo = advanceArduinoServoWaveforms(servo, reachedMicroseconds).state;
    for (const [terminal, tone] of tones) {
      const advanced = advanceArduinoTimedWaveform(tone, reachedMicroseconds);
      if (advanced.state) tones.set(terminal, advanced.state);
      else tones.delete(terminal);
    }
  }

  if (
    !clocked &&
    resumeAtMs <= targetTimeMs &&
    completedLoops >= MAX_LOOP_ADVANCES &&
    !diagnostics.some((entry) => entry.code === 'statement_budget_exceeded')
  ) {
    diagnostics.push({
      code: 'loop_advance_budget_exceeded',
      severity: 'error',
      message: `Arduino не успела догнать виртуальное время за ${MAX_LOOP_ADVANCES} проходов loop().`,
    });
  } else if (
    !clocked &&
    resumeAtMs <= targetTimeMs &&
    advanceStatementCount >= MAX_ADVANCE_STATEMENTS &&
    !diagnostics.some((entry) => entry.code === 'statement_budget_exceeded')
  ) {
    diagnostics.push({
      code: 'loop_advance_budget_exceeded',
      severity: 'error',
      message: `Arduino не успела догнать виртуальное время за ${MAX_ADVANCE_STATEMENTS} операций.`,
    });
  }

  if (diagnostics.length > 0) {
    setupActions.length = 0;
    loopActions.length = 0;
    events.length = 0;
    eventQueue.length = 0;
    nextEventSequence = 0;
    pinModes.clear();
    outputVoltages.clear();
    tones.clear();
    pendingEvaluation = undefined;
    pulseWait = null;
    ultrasonicAdapter = null;
    serial = null;
    servo = initialArduinoServoRuntimeState(servoDeclarations);
    resumeAtMs = Math.max(resumeAtMs, targetTimeMs);
  }
  // Binding writes replace leaves. Capturing each scope's entries therefore
  // detaches this private wire view while keeping its projections demand driven.
  // No callback can reach these leaves on the admitted route.
  const snapshotScopes = owned ? scopes.map((scope) => new Map(scope)) : scopes;
  const advanced: ArduinoRuntimeAdvance = {
    executionStatus: diagnostics.length > 0 ? 'fault' : yielded ? 'yielded' : 'ready',
    ...(stopAtElectricalBoundary ? { executedInstructions } : {}),
    setupActions,
    loopActions,
    events,
    state: {
      version: ARDUINO_RUNTIME_STATE_VERSION,
      clockProfile,
      programFingerprint: fingerprint,
      virtualTimeMs: reachedTimeMs,
      resumeAtMs,
      phase,
      programCounter,
      ...(activeFunction === undefined
        ? {}
        : { activeFunction, functionFrames: [...functionFrames] }),
      loopIterationActive,
      loopStartedAtMs,
      loopIterations,
      nextEventSequence,
      eventQueue: owned ? [...eventQueue] : eventQueue,
      ...(pendingEvaluation ? { pendingEvaluation } : {}),
      ...(rng !== undefined && { randomState: rng }),
      ...(pulseWait ? { pulseWait } : {}),
      ...(ultrasonicAdapter ? { ultrasonicAdapter } : {}),
      ...(serial ? { serial } : {}),
      ...(servoDeclarations.length > 0 ? { servo } : {}),
      variables: owned ? {} : scopeNumbers(scopes.slice(0, 1)),
      locals: owned ? {} : scopeNumbers(scopes.slice(1)),
      scopes: owned ? [] : serializeScopes(scopes),
      faults: diagnostics,
      pinModes: sortedRecord(pinModes),
      outputVoltages: sortedRecord(outputVoltages),
      tones: sortedRecord(tones),
    },
    diagnostics,
  };
  if (owned) {
    const projection = (key: 'variables' | 'locals' | 'scopes', materialize: () => unknown) => ({
      enumerable: true,
      configurable: true,
      get() {
        const value = materialize();
        Object.defineProperty(advanced.state, key, {
          value,
          enumerable: true,
          configurable: true,
          writable: true,
        });
        return value;
      },
    });
    Object.defineProperties(advanced.state, {
      variables: projection('variables', () => scopeNumbers(snapshotScopes.slice(0, 1))),
      locals: projection('locals', () => scopeNumbers(snapshotScopes.slice(1))),
      scopes: projection('scopes', () =>
        serializeScopes(
          snapshotScopes.map(
            (scope) => new Map([...scope].map(([name, binding]) => [name, { ...binding }])),
          ),
        ),
      ),
    });
  }
  return advanced;
}

export function resetArduinoRuntime(
  source: string,
  inputs: ArduinoTerminalVoltages = {},
  simulationTimeMs = 0,
): ArduinoRuntimeAdvance {
  return advanceArduinoRuntime(source, inputs, simulationTimeMs);
}

export function arduinoSourceUsesInputReads(source: string): boolean {
  return /\b(?:analogRead|digitalRead|pulseIn)\s*\(/.test(removeComments(source));
}
