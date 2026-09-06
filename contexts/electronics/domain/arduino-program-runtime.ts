import type { Terminal } from './document.js';
import {
  ArduinoArithmeticError,
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
  readonly loopIterationActive: boolean;
  readonly loopStartedAtMs: number;
  readonly loopIterations: number;
  readonly nextEventSequence: number;
  readonly eventQueue: readonly ArduinoRuntimeEvent[];
  readonly variables: Readonly<Record<string, number>>;
  readonly locals: Readonly<Record<string, number>>;
  readonly scopes: readonly ArduinoScopeSnapshot[];
  readonly faults: readonly ArduinoRuntimeDiagnostic[];
  readonly pinModes: Readonly<Partial<Record<Terminal, ArduinoPinMode>>>;
  readonly outputVoltages: Readonly<Partial<Record<Terminal, number>>>;
  readonly tones: Readonly<
    Partial<
      Record<
        Terminal,
        {
          readonly frequencyHz: number;
          readonly expiresAtMs?: number;
        }
      >
    >
  >;
}

export interface ArduinoRuntimeAdvance {
  readonly executionStatus: 'ready' | 'yielded' | 'fault';
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
  readonly tones: ReadonlyMap<
    Terminal,
    { readonly frequencyHz: number; readonly expiresAtMs?: number }
  >;
}
export type ArduinoInputReader = (state: ArduinoElectricalState) => ArduinoTerminalVoltages;

interface Token {
  readonly kind: 'number' | 'identifier' | 'operator' | 'punctuation';
  readonly value: string;
}

interface RuntimeState {
  readonly scopes: ArduinoScope[];
  readonly validateOnly?: boolean;
  readonly inputs: ArduinoTerminalVoltages;
  readonly actions: ArduinoProgramAction[];
  readonly diagnostics: ArduinoRuntimeDiagnostic[];
  simulationTimeMs: number;
  statementCount: number;
}

interface SimpleInstruction {
  readonly kind: 'simple';
  readonly statement: string;
  readonly line: number;
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
}

type ScopeInstruction = { readonly kind: 'enter-scope' } | { readonly kind: 'exit-scope' };
type CompiledInstruction =
  SimpleInstruction | BranchInstruction | JumpInstruction | ScopeInstruction;

const MAX_STATEMENTS = 512;
const MAX_LOOP_ADVANCES = 4_096;
const MAX_ADVANCE_STATEMENTS = 16_384;
const MIN_LOOP_DURATION_MS = 1;
// Leave enough floating-point precision for lossless microsecond <-> ms state serialization.
const MAX_CLOCK_MICROSECONDS = 2 ** 50 - 1;
const MAX_CLOCK_TARGET_MS = (MAX_CLOCK_MICROSECONDS - 1000) / 1000;
const PWM_TERMINALS = new Set<Terminal>(['d3', 'd5', 'd6', 'd9', 'd10', 'd11']);

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

function runtimeStateIsValid(state: ArduinoRuntimeState): boolean {
  const pinModeEntries = Object.entries(state.pinModes ?? {});
  const outputVoltageEntries = Object.entries(state.outputVoltages ?? {});
  const toneEntries = Object.entries(state.tones ?? {});
  const pinModes = Object.values(state.pinModes ?? {});
  const outputVoltages = Object.values(state.outputVoltages ?? {});
  const tones = Object.values(state.tones ?? {});
  return (
    state.version === ARDUINO_RUNTIME_STATE_VERSION &&
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
    tones.every(
      (tone) =>
        tone !== undefined &&
        Number.isFinite(tone.frequencyHz) &&
        tone.frequencyHz >= 1 &&
        tone.frequencyHz <= 20_000 &&
        (tone.expiresAtMs === undefined ||
          (Number.isFinite(tone.expiresAtMs) && tone.expiresAtMs >= 0)),
    )
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

function expireTones(
  targetTimeMs: number,
  tones: Map<Terminal, { readonly frequencyHz: number; readonly expiresAtMs?: number }>,
  emit: (event: Omit<ArduinoRuntimeEvent, 'sequence' | 'atMicroseconds'>, atMs: number) => void,
): void {
  const ordered = [...tones].sort(
    ([a, left], [b, right]) =>
      (left.expiresAtMs ?? Number.MAX_VALUE) - (right.expiresAtMs ?? Number.MAX_VALUE) ||
      (a < b ? -1 : a > b ? 1 : 0),
  );
  for (const [terminal, tone] of ordered) {
    if (tone.expiresAtMs !== undefined && tone.expiresAtMs <= targetTimeMs) {
      tones.delete(terminal);
      emit({ kind: 'tone-stop', terminal }, tone.expiresAtMs);
    }
  }
}

function applyRuntimeAction(
  action: Exclude<ArduinoProgramAction, ArduinoDelayAction>,
  executionTimeMs: number,
  pinModes: Map<Terminal, ArduinoPinMode>,
  outputVoltages: Map<Terminal, number>,
  tones: Map<Terminal, { readonly frequencyHz: number; readonly expiresAtMs?: number }>,
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
    if (outputVoltages.get(action.terminal) !== action.targetVoltage) {
      emit(
        { kind: 'output-change', terminal: action.terminal, voltage: action.targetVoltage },
        executionTimeMs,
      );
    }
    outputVoltages.set(action.terminal, action.targetVoltage);
  } else if (action.kind === 'tone') {
    const previous = tones.get(action.terminal);
    if (previous?.frequencyHz !== action.frequencyHz) {
      emit(
        { kind: 'tone-start', terminal: action.terminal, frequencyHz: action.frequencyHz },
        executionTimeMs,
      );
    }
    tones.set(action.terminal, {
      frequencyHz: action.frequencyHz,
      ...(action.durationMs !== undefined
        ? { expiresAtMs: executionTimeMs + action.durationMs }
        : {}),
    });
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

function removeComments(source: string): string {
  let output = '';
  let quote: '"' | "'" | null = null;
  let lineComment = false;
  let blockComment = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index] ?? '';
    const next = source[index + 1] ?? '';
    if (lineComment) {
      if (character === '\n') {
        lineComment = false;
        output += '\n';
      }
      continue;
    }
    if (blockComment) {
      output += character === '\n' ? '\n' : ' ';
      if (character === '*' && next === '/') {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      output += character;
      if (character === '\\') {
        output += next;
        index += 1;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      output += character;
      continue;
    }
    if (character === '/' && next === '/') {
      lineComment = true;
      index += 1;
      continue;
    }
    if (character === '/' && next === '*') {
      output += ' ';
      blockComment = true;
      index += 1;
      continue;
    }
    output += character;
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
    const operator = ['&&', '||', '==', '!=', '<=', '>='].find((candidate) =>
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
    if ('(),'.includes(character)) {
      tokens.push({ kind: 'punctuation', value: character });
      index += 1;
      continue;
    }
    throw new SyntaxError(`Недопустимый символ «${character}» в выражении.`);
  }
  return tokens;
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
  private suppressed = 0;

  constructor(
    private readonly tokens: readonly Token[],
    private readonly state: RuntimeState,
  ) {}

  private get validateOnly(): boolean {
    return Boolean(this.state.validateOnly || this.suppressed);
  }

  parse(): ArduinoValue {
    const value = this.parseOr();
    if (this.current())
      throw new SyntaxError(
        `Лишний элемент «${this.current()!.value}» в выражении. Проверьте точку с запятой.`,
      );
    return value;
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

  private parseUnary(): ArduinoValue {
    if (['!', '-', '+'].includes(this.current()?.value ?? '')) {
      const operator = this.take()!.value;
      return unaryValue(operator, this.parseUnary(), this.validateOnly);
    }
    return this.parsePrimary();
  }

  private parsePrimary(): ArduinoValue {
    const token = this.take();
    if (!token) throw new SyntaxError('Ожидается выражение.');
    if (token.kind === 'number') return parseNumericLiteral(token.value);
    if (token.value === '(') {
      const value = this.parseOr();
      if (!this.take(')')) throw new SyntaxError('Ожидается закрывающая скобка.');
      return value;
    }
    if (token.kind !== 'identifier') throw new SyntaxError(`Неожиданный элемент «${token.value}».`);
    if (this.current()?.value === '(') {
      this.take('(');
      const macro = ['min', 'max', 'abs', 'constrain'].includes(token.value);
      const argumentsList: ArduinoValue[] = [];
      const argumentTokens: Array<readonly Token[]> = [];
      if (this.current()?.value !== ')') {
        do {
          const start = this.index;
          if (macro) this.suppressed++;
          argumentsList.push(this.parseOr());
          if (macro) this.suppressed--;
          argumentTokens.push(this.tokens.slice(start, this.index));
        } while (this.take(','));
      }
      if (!this.take(')')) throw new SyntaxError('Ожидается закрывающая скобка вызова.');
      if (macro) return this.macro(token.value, argumentsList, argumentTokens);
      return this.call(token.value, argumentsList);
    }
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
    if (digital) return numericValue('int', Number(digital[1]));
    return readBinding(this.state.scopes, token.value, this.validateOnly);
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

  private call(name: string, argumentsList: readonly ArduinoValue[]): ArduinoValue {
    validateCallArguments(name, argumentsList.length, true);
    if (this.state.scopes.some((scope) => scope.has(name)))
      throw new SyntaxError(`«${name}» — переменная, а не функция.`);
    const lower = name.toLowerCase();
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
    throw new SyntaxError(`Команда «${name}» не поддерживается.`);
  }
}

function evaluate(expression: string, state: RuntimeState): number {
  return evaluateValue(expression, state).value;
}

function evaluateValue(expression: string, state: RuntimeState): ArduinoValue {
  return new ExpressionParser(tokenize(expression), state).parse();
}

function validateCallArguments(name: string, count: number, expression = false): void {
  const valueCalls: Readonly<Record<string, readonly [number, number]>> = {
    digitalRead: [1, 1],
    analogRead: [1, 1],
    millis: [0, 0],
    map: [5, 5],
    constrain: [3, 3],
    abs: [1, 1],
    min: [2, 2],
    max: [2, 2],
  };
  const commandCalls: Readonly<Record<string, readonly [number, number]>> = {
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

function functionBody(source: string, name: 'setup' | 'loop'): string | null {
  const declaration = new RegExp(`\\bvoid\\s+${name}\\s*\\(\\s*(?:void\\s*)?\\)\\s*\\{`).exec(
    source,
  );
  if (!declaration) return null;
  const start = declaration.index + declaration[0].length;
  let depth = 1;
  for (let index = start; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(start, index);
  }
  return null;
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

function executeSimpleStatement(statement: string, state: RuntimeState): void {
  const compact = statement.trim();
  if (!compact || !consumeStatement(state)) return;

  const declaration = parseDeclaration(compact);
  if (declaration) {
    declareVariable(declaration, state);
    return;
  }
  const assignment = /^([A-Za-z_]\w*)\s*(=|\+=|-=|\*=|\/=|%=)\s*([\s\S]+)$/.exec(compact);
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
  const increment = /^(?:\+\+|--)?([A-Za-z_]\w*)(\+\+|--)?$/.exec(compact);
  if (increment && (compact.startsWith('++') || compact.startsWith('--') || increment[2])) {
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

  const call = /^([A-Za-z_]\w*)\s*\(([\s\S]*)\)$/.exec(compact);
  if (!call)
    throw new SyntaxError('Не удалось разобрать команду. Проверьте синтаксис и точку с запятой.');
  const name = call[1]!.toLowerCase();
  const argumentsList = splitArguments(call[2] ?? '');
  if (argumentsList.some((arg) => arg.length === 0) && call[2]?.trim())
    throw new SyntaxError('Пустой аргумент команды.');
  validateCallArguments(call[1]!, argumentsList.filter((arg) => arg.length > 0).length);
  if (state.scopes.some((scope) => scope.has(call[1]!)))
    throw new SyntaxError(`«${call[1]}» — переменная, а не функция.`);
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

function compileError(diagnostics: string[], message: string): void {
  if (diagnostics.length === 0) diagnostics.push(message);
}

function structuralCompileError(source: string): string | null {
  const stack: Array<{ readonly character: '(' | '{'; readonly index: number }> = [];
  let quote: '"' | "'" | null = null;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index] ?? '';
    if (quote) {
      if (character === '\\') index += 1;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
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
      return `Ошибка синтаксиса Arduino: лишняя закрывающая скобка «${character}».`;
    }
  }
  if (quote) return 'Ошибка синтаксиса Arduino: строка или символ не закрыты кавычкой.';
  const opening = stack.pop();
  if (!opening) return null;
  const expected = opening.character === '(' ? ')' : '}';
  return `Ошибка синтаксиса Arduino: для «${opening.character}» не найдена закрывающая скобка «${expected}».`;
}

function compileStatements(
  source: string,
  instructions: CompiledInstruction[] = [],
  diagnostics: string[] = [],
  scope: 'setup' | 'loop' = 'loop',
  firstLine = 1,
  forHeaderName?: string,
): readonly CompiledInstruction[] {
  const lineAt = (offset: number): number =>
    firstLine + (source.slice(0, offset).match(/\n/g)?.length ?? 0);
  const compileBlock = (body: string, offset: number, headerName?: string): void => {
    instructions.push({ kind: 'enter-scope' });
    compileStatements(body, instructions, diagnostics, scope, lineAt(offset), headerName);
    instructions.push({ kind: 'exit-scope' });
  };
  let index = 0;
  while (index < source.length) {
    index = skipWhitespace(source, index);
    if (index >= source.length) break;
    if (source[index] === '#') {
      index = source.indexOf('\n', index);
      if (index < 0) break;
      continue;
    }
    const remaining = source.slice(index);
    const line = lineAt(index);
    if (source[index] === '{') {
      const block = balancedSlice(source, index, '{', '}');
      if (!block) {
        compileError(diagnostics, 'Незакрытый блок.');
        break;
      }
      compileBlock(block.content, index + 1);
      index = block.end;
      continue;
    }
    const control = /^(if|while)\b/.exec(remaining);
    if (control) {
      let cursor = skipWhitespace(source, index + control[0].length);
      const condition = balancedSlice(source, cursor, '(', ')');
      if (!condition) {
        compileError(
          diagnostics,
          `Ошибка синтаксиса в ${scope}(): после ${control[1]} ожидается условие в круглых скобках.`,
        );
        break;
      }
      cursor = skipWhitespace(source, condition.end);
      const body = balancedSlice(source, cursor, '{', '}');
      if (!body) {
        compileError(
          diagnostics,
          `Ошибка синтаксиса в ${scope}(): после ${control[1]} ожидается блок в фигурных скобках.`,
        );
        break;
      }
      cursor = skipWhitespace(source, body.end);
      let elseBody: { readonly content: string; readonly end: number } | null = null;
      if (control[1] === 'if' && /^else\b/.test(source.slice(cursor))) {
        cursor = skipWhitespace(source, cursor + 4);
        elseBody = balancedSlice(source, cursor, '{', '}');
        if (elseBody) cursor = elseBody.end;
        else if (!/^if\b/.test(source.slice(cursor))) {
          compileError(
            diagnostics,
            `Ошибка синтаксиса в ${scope}(): после else ожидается блок в фигурных скобках.`,
          );
          break;
        }
      }

      const branchIndex = instructions.length;
      instructions.push({ kind: 'branch', condition: condition.content, falseTarget: -1, line });
      compileBlock(body.content, body.end - body.content.length - 1);
      if (diagnostics.length > 0) break;
      if (control[1] === 'while') {
        instructions.push({ kind: 'jump', target: branchIndex });
        (instructions[branchIndex] as BranchInstruction).falseTarget = instructions.length;
      } else if (elseBody) {
        const jumpIndex = instructions.length;
        instructions.push({ kind: 'jump', target: -1 });
        (instructions[branchIndex] as BranchInstruction).falseTarget = instructions.length;
        compileBlock(elseBody.content, elseBody.end - elseBody.content.length - 1);
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
        compileError(
          diagnostics,
          `Ошибка синтаксиса в ${scope}(): после for ожидаются круглые скобки.`,
        );
        break;
      }
      cursor = skipWhitespace(source, header.end);
      const body = balancedSlice(source, cursor, '{', '}');
      if (!body) {
        compileError(
          diagnostics,
          `Ошибка синтаксиса в ${scope}(): после for ожидается блок в фигурных скобках.`,
        );
        break;
      }
      if ((header.content.match(/;/g) ?? []).length !== 2) {
        compileError(
          diagnostics,
          `Ошибка синтаксиса в ${scope}(): заголовок for должен содержать две точки с запятой.`,
        );
        break;
      }
      const [initialization, condition, increment] = splitForHeader(header.content);
      instructions.push({ kind: 'enter-scope' });
      if (initialization) instructions.push({ kind: 'simple', statement: initialization, line });
      const branchIndex = instructions.length;
      instructions.push({ kind: 'branch', condition: condition || '1', falseTarget: -1, line });
      compileBlock(
        body.content,
        body.end - body.content.length - 1,
        parseDeclaration(initialization)?.name,
      );
      if (diagnostics.length > 0) break;
      if (increment) instructions.push({ kind: 'simple', statement: increment, line });
      instructions.push({ kind: 'jump', target: branchIndex });
      (instructions[branchIndex] as BranchInstruction).falseTarget = instructions.length;
      instructions.push({ kind: 'exit-scope' });
      index = body.end;
      continue;
    }

    let depth = 0;
    let end = index;
    for (; end < source.length; end += 1) {
      if (source[end] === '(') depth += 1;
      if (source[end] === ')') depth -= 1;
      if (source[end] === ';' && depth === 0) break;
    }
    if (end >= source.length) {
      if (source.slice(index).trim()) {
        compileError(
          diagnostics,
          `Ошибка синтаксиса в ${scope}(): команда должна заканчиваться точкой с запятой.`,
        );
      }
      break;
    }
    const statement = source.slice(index, end).trim();
    if (forHeaderName && parseDeclaration(statement)?.name === forHeaderName) {
      compileError(diagnostics, `Повторное объявление «${forHeaderName}» в теле его цикла for.`);
      break;
    }
    if (statement) instructions.push({ kind: 'simple', statement, line });
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
    /^(?:true|false|HIGH|LOW|INPUT|OUTPUT|INPUT_PULLUP|LED_BUILTIN|A[0-5]|int|long|float|double|bool|boolean|byte|const|unsigned|void|if|else|for|while)$/.test(
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

function globalDeclarations(source: string): readonly GlobalDeclaration[] {
  const statements: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < source.length; index += 1) {
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
      statements.push(source.slice(start, index).trim());
      start = index + 1;
    }
  }

  return statements.flatMap((statement) => {
    const declaration = parseDeclaration(statement);
    if (!declaration) return [];
    return [
      {
        ...declaration,
        line: 1 + (source.slice(0, source.indexOf(statement)).match(/\n/g)?.length ?? 0),
      },
    ];
  });
}

function initializeGlobals(declarations: readonly GlobalDeclaration[], state: RuntimeState): void {
  for (const declaration of declarations) {
    declareVariable(declaration, state, true);
  }
}

interface ArduinoProgramCompilation {
  readonly cleanSource: string;
  readonly setupInstructions: readonly CompiledInstruction[];
  readonly loopInstructions: readonly CompiledInstruction[];
  readonly diagnostics: readonly ArduinoRuntimeDiagnostic[];
}

function applyScopeInstruction(instruction: ScopeInstruction, scopes: ArduinoScope[]): void {
  if (instruction.kind === 'enter-scope') {
    if (scopes.length >= 128)
      throw new SyntaxError('Превышена допустимая вложенность областей Arduino.');
    scopes.push(new Map());
  } else {
    if (scopes.length <= 2) throw new SyntaxError('Некорректное завершение области Arduino.');
    scopes.pop();
  }
}

function compileArduinoProgram(source: string): ArduinoProgramCompilation {
  const cleanSource = removeComments(source);
  const messages: string[] = [];
  const structuralError = structuralCompileError(cleanSource);
  if (structuralError) messages.push(structuralError);
  const declaredSetup = /\bvoid\s+setup\b/i.test(cleanSource);
  const declaredLoop = /\bvoid\s+loop\b/i.test(cleanSource);
  const extractedSetupBody = functionBody(cleanSource, 'setup');
  const extractedLoopBody = functionBody(cleanSource, 'loop');
  if (!structuralError && declaredSetup && extractedSetupBody === null) {
    messages.push(
      'Ошибка синтаксиса Arduino: функция setup() должна иметь корректное тело в фигурных скобках.',
    );
  }
  if (!structuralError && declaredLoop && extractedLoopBody === null) {
    messages.push(
      'Ошибка синтаксиса Arduino: функция loop() должна иметь корректное тело в фигурных скобках.',
    );
  }
  const setupBody = extractedSetupBody ?? '';
  const loopBody = extractedLoopBody ?? (declaredSetup || declaredLoop ? '' : cleanSource);
  const bodyLine = (name: string): number => {
    const match = new RegExp(`\\bvoid\\s+${name}\\s*\\([^)]*\\)\\s*\\{`).exec(cleanSource);
    return match
      ? 1 + (cleanSource.slice(0, match.index + match[0].length).match(/\n/g)?.length ?? 0)
      : 1;
  };
  const setupInstructions = compileStatements(setupBody, [], messages, 'setup', bodyLine('setup'));
  const loopInstructions = compileStatements(loopBody, [], messages, 'loop', bodyLine('loop'));
  // Parse every instruction, including unreachable branches, before driving GPIO.
  // This is validation of the bounded language, not execution of the sketch.
  if (messages.length === 0) {
    const validation: RuntimeState = {
      scopes: [new Map()],
      validateOnly: true,
      inputs: {},
      actions: [],
      diagnostics: [],
      simulationTimeMs: 0,
      statementCount: 0,
    };
    try {
      initializeGlobals(globalDeclarations(cleanSource), validation);
      const globals = new Map(validation.scopes[0]);
      for (const instructions of [setupInstructions, loopInstructions]) {
        validation.scopes.splice(0, validation.scopes.length, new Map(globals), new Map());
        for (const instruction of instructions) {
          validation.statementCount = 0;
          validation.actions.length = 0;
          if (instruction.kind === 'branch') evaluate(instruction.condition, validation);
          if (instruction.kind === 'simple')
            executeSimpleStatement(instruction.statement, validation);
          if (instruction.kind === 'enter-scope' || instruction.kind === 'exit-scope')
            applyScopeInstruction(instruction, validation.scopes);
        }
      }
    } catch (error) {
      if (!(error instanceof SyntaxError) && !(error instanceof ArduinoArithmeticError))
        throw error;
      compileError(messages, `Ошибка программы Arduino: ${error.message}`);
    }
  }
  return {
    cleanSource,
    setupInstructions,
    loopInstructions,
    diagnostics: messages.map((message) => ({
      code: 'compile_error',
      severity: 'error',
      message,
    })),
  };
}

/** Lightweight syntax pass for the supported Arduino subset; it never executes the sketch. */
export function analyseArduinoProgramSyntax(source: string): readonly ArduinoRuntimeDiagnostic[] {
  return compileArduinoProgram(source).diagnostics;
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
  options: { readonly instructionBudget?: number } = {},
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
  );
}

function advanceRuntime(
  source: string,
  inputs: ArduinoTerminalVoltages,
  simulationTimeMs: number,
  previous: ArduinoRuntimeState | undefined,
  readInputs: ArduinoInputReader | undefined,
  clockProfile: ArduinoClockProfile,
  instructionBudget = MAX_ADVANCE_STATEMENTS,
): ArduinoRuntimeAdvance {
  const clocked = clockProfile === 'instruction-us-v1';
  const compilation = compileArduinoProgram(source);
  const { cleanSource, setupInstructions, loopInstructions } = compilation;
  const declarations = globalDeclarations(cleanSource);
  const fingerprint = programFingerprint(source);
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
      },
      diagnostics: initialDiagnostics,
    };
  }
  const previousInstructions = previous?.phase === 'setup' ? setupInstructions : loopInstructions;
  const compatible =
    previous !== undefined &&
    runtimeStateIsValid(previous) &&
    previous.clockProfile === clockProfile &&
    previous.programFingerprint === fingerprint &&
    previous.virtualTimeMs <= targetTimeMs &&
    previous.programCounter <= previousInstructions.length &&
    previous.scopes.length ===
      previousInstructions
        .slice(0, previous.programCounter)
        .reduce(
          (depth, instruction) =>
            depth +
            (instruction.kind === 'enter-scope' ? 1 : instruction.kind === 'exit-scope' ? -1 : 0),
          2,
        );
  if (compatible && (previous.virtualTimeMs === targetTimeMs || previous.faults.length > 0)) {
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
  const scopes: ArduinoScope[] = compatible
    ? previous.scopes.map((scope) => new Map(Object.entries(scope)))
    : [new Map()];
  const pinModes = compatible
    ? terminalMap(previous.pinModes)
    : new Map<Terminal, ArduinoPinMode>();
  const outputVoltages = compatible
    ? terminalMap(previous.outputVoltages)
    : new Map<Terminal, number>();
  const tones = compatible
    ? terminalMap(previous.tones)
    : new Map<Terminal, { readonly frequencyHz: number; readonly expiresAtMs?: number }>();
  const diagnostics: ArduinoRuntimeDiagnostic[] = [];
  const setupActions: ArduinoProgramAction[] = [];
  const loopActions: ArduinoProgramAction[] = [];
  const resetAtMs = previous && previous.virtualTimeMs <= targetTimeMs ? targetTimeMs : 0;
  let resumeAtMs = compatible ? previous.resumeAtMs : resetAtMs;
  let phase: ArduinoRuntimeState['phase'] = compatible ? previous.phase : 'setup';
  let programCounter = compatible ? previous.programCounter : 0;
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
      get inputs() {
        return readInputs
          ? readInputs({ simulationTimeMs: resumeAtMs, pinModes, outputVoltages, tones })
          : inputs;
      },
      actions: [],
      diagnostics,
      simulationTimeMs: resetAtMs,
      statementCount: 0,
    };
    for (const declaration of declarations) {
      try {
        declareVariable(declaration, initializationState, true);
      } catch (error) {
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
    scopes.push(new Map());
  }

  let completedLoops = 0;
  while (
    resumeAtMs <= targetTimeMs &&
    (clocked
      ? executedInstructions < instructionBudget
      : completedLoops < MAX_LOOP_ADVANCES && advanceStatementCount < MAX_ADVANCE_STATEMENTS) &&
    diagnostics.length === 0
  ) {
    expireTones(resumeAtMs, tones, emit);
    const instructions = phase === 'setup' ? setupInstructions : loopInstructions;

    if (phase === 'setup' && programCounter >= instructions.length) {
      scopes.splice(1, scopes.length - 1, new Map());
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
      scopes.splice(1, scopes.length - 1, new Map());
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
    if (instruction.kind === 'jump') {
      programCounter = instruction.target;
      consumeClockInstruction();
      continue;
    }
    if (instruction.kind === 'enter-scope' || instruction.kind === 'exit-scope') {
      applyScopeInstruction(instruction, scopes);
      programCounter += 1;
      consumeClockInstruction();
      continue;
    }

    const actions = phase === 'setup' ? setupActions : loopActions;
    const instructionState: RuntimeState = {
      scopes,
      get inputs() {
        return readInputs
          ? readInputs({ simulationTimeMs: resumeAtMs, pinModes, outputVoltages, tones })
          : inputs;
      },
      actions,
      diagnostics,
      simulationTimeMs: resumeAtMs,
      statementCount: clocked ? 0 : continuousStatementCount,
    };
    const statementCountBefore = instructionState.statementCount;

    try {
      if (instruction.kind === 'branch') {
        if (!consumeStatement(instructionState)) break;
        programCounter =
          evaluate(instruction.condition, instructionState) !== 0
            ? programCounter + 1
            : instruction.falseTarget;
      } else if (instruction.kind === 'simple') {
        const actionStart = actions.length;
        executeSimpleStatement(instruction.statement, instructionState);
        programCounter += 1;
        const executionTimeMs = resumeAtMs;
        for (const action of actions.slice(actionStart)) {
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
            applyRuntimeAction(action, executionTimeMs, pinModes, outputVoltages, tones, emit);
          }
        }
      }
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
    const consumed = instructionState.statementCount - statementCountBefore;
    advanceStatementCount += consumed;
    continuousStatementCount =
      resumeAtMs > instructionState.simulationTimeMs ? 0 : instructionState.statementCount;
    consumeClockInstruction();
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
    resumeAtMs = Math.max(resumeAtMs, targetTimeMs);
  }
  return {
    executionStatus: diagnostics.length > 0 ? 'fault' : yielded ? 'yielded' : 'ready',
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
      loopIterationActive,
      loopStartedAtMs,
      loopIterations,
      nextEventSequence,
      eventQueue,
      variables: scopeNumbers(scopes.slice(0, 1)),
      locals: scopeNumbers(scopes.slice(1)),
      scopes: serializeScopes(scopes),
      faults: diagnostics,
      pinModes: sortedRecord(pinModes),
      outputVoltages: sortedRecord(outputVoltages),
      tones: sortedRecord(tones),
    },
    diagnostics,
  };
}

export function resetArduinoRuntime(
  source: string,
  inputs: ArduinoTerminalVoltages = {},
  simulationTimeMs = 0,
): ArduinoRuntimeAdvance {
  return advanceArduinoRuntime(source, inputs, simulationTimeMs);
}

export function arduinoSourceUsesInputReads(source: string): boolean {
  return /\b(?:analogRead|digitalRead)\s*\(/.test(removeComments(source));
}
