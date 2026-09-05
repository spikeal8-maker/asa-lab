import type { Terminal } from './document.js';

export type ArduinoPinMode = 'INPUT' | 'INPUT_PULLUP' | 'OUTPUT';

export interface ArduinoWriteAction {
  readonly kind: 'write';
  readonly terminal: Terminal;
  readonly targetVoltage: number;
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

export interface ArduinoProgramExecution {
  readonly setupActions: readonly ArduinoProgramAction[];
  readonly loopActions: readonly ArduinoProgramAction[];
}

export const ARDUINO_RUNTIME_STATE_VERSION = 4 as const;
export const ARDUINO_RUNTIME_EVENT_QUEUE_LIMIT = 256 as const;

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
  readonly code: 'compile_error' | 'statement_budget_exceeded' | 'loop_advance_budget_exceeded';
  readonly severity: 'error';
  readonly message: string;
}

/**
 * Serializable runtime-only state. It is deliberately separate from the saved
 * schematic document: browser and server may carry it between simulation
 * steps, while Reset or a changed sketch starts from a clean snapshot.
 */
export interface ArduinoRuntimeState {
  readonly version: typeof ARDUINO_RUNTIME_STATE_VERSION;
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
  readonly setupActions: readonly ArduinoProgramAction[];
  readonly loopActions: readonly ArduinoProgramAction[];
  readonly events: readonly ArduinoRuntimeEvent[];
  readonly state: ArduinoRuntimeState;
  readonly diagnostics: readonly ArduinoRuntimeDiagnostic[];
}

export type ArduinoTerminalVoltages = Readonly<Partial<Record<Terminal, number>>>;

interface Token {
  readonly kind: 'number' | 'identifier' | 'operator' | 'punctuation';
  readonly value: string;
}

interface RuntimeState {
  readonly variables: Map<string, number>;
  readonly inputs: ArduinoTerminalVoltages;
  readonly actions: ArduinoProgramAction[];
  readonly diagnostics: ArduinoRuntimeDiagnostic[];
  simulationTimeMs: number;
  statementCount: number;
}

interface SimpleInstruction {
  readonly kind: 'simple';
  readonly statement: string;
}

interface BranchInstruction {
  readonly kind: 'branch';
  readonly condition: string;
  falseTarget: number;
}

interface JumpInstruction {
  readonly kind: 'jump';
  target: number;
}

type CompiledInstruction = SimpleInstruction | BranchInstruction | JumpInstruction;

const MAX_STATEMENTS = 512;
const MAX_LOOP_ADVANCES = 4_096;
const MAX_ADVANCE_STATEMENTS = 16_384;
const MIN_LOOP_DURATION_MS = 1;
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
    typeof state.programFingerprint === 'string' &&
    Number.isFinite(state.virtualTimeMs) &&
    state.virtualTimeMs >= 0 &&
    Number.isFinite(state.resumeAtMs) &&
    state.resumeAtMs >= 0 &&
    state.resumeAtMs >= state.virtualTimeMs &&
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

function runtimeVariables(entries: Readonly<Record<string, number>>): Map<string, number> {
  return new Map(
    Object.entries(entries)
      .filter(([, value]) => Number.isFinite(value))
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)),
  );
}

function serializableVariables(
  variables: ReadonlyMap<string, number>,
): Readonly<Record<string, number>> {
  return Object.fromEntries(
    [...variables.entries()]
      .filter(([, value]) => Number.isFinite(value))
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)),
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
  for (const [terminal, tone] of tones) {
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
  } else if (action.kind === 'write') {
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
    const number = /^(?:\d+(?:\.\d*)?|\.\d+)/.exec(expression.slice(index));
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
    index += 1;
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

  constructor(
    private readonly tokens: readonly Token[],
    private readonly state: RuntimeState,
  ) {}

  parse(): number {
    return finite(this.parseOr());
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

  private parseOr(): number {
    let value = this.parseAnd();
    while (this.take('||')) value = value !== 0 || this.parseAnd() !== 0 ? 1 : 0;
    return value;
  }

  private parseAnd(): number {
    let value = this.parseEquality();
    while (this.take('&&')) value = value !== 0 && this.parseEquality() !== 0 ? 1 : 0;
    return value;
  }

  private parseEquality(): number {
    let value = this.parseComparison();
    while (this.current()?.value === '==' || this.current()?.value === '!=') {
      const operator = this.take()?.value;
      const right = this.parseComparison();
      value = operator === '==' ? (value === right ? 1 : 0) : value !== right ? 1 : 0;
    }
    return value;
  }

  private parseComparison(): number {
    let value = this.parseAdditive();
    while (['<', '<=', '>', '>='].includes(this.current()?.value ?? '')) {
      const operator = this.take()?.value;
      const right = this.parseAdditive();
      value =
        operator === '<'
          ? value < right
            ? 1
            : 0
          : operator === '<='
            ? value <= right
              ? 1
              : 0
            : operator === '>'
              ? value > right
                ? 1
                : 0
              : value >= right
                ? 1
                : 0;
    }
    return value;
  }

  private parseAdditive(): number {
    let value = this.parseMultiplicative();
    while (this.current()?.value === '+' || this.current()?.value === '-') {
      const operator = this.take()?.value;
      const right = this.parseMultiplicative();
      value = operator === '+' ? value + right : value - right;
    }
    return value;
  }

  private parseMultiplicative(): number {
    let value = this.parseUnary();
    while (['*', '/', '%'].includes(this.current()?.value ?? '')) {
      const operator = this.take()?.value;
      const right = this.parseUnary();
      value =
        operator === '*'
          ? value * right
          : operator === '/'
            ? right === 0
              ? 0
              : value / right
            : right === 0
              ? 0
              : value % right;
    }
    return value;
  }

  private parseUnary(): number {
    if (this.take('!')) return this.parseUnary() === 0 ? 1 : 0;
    if (this.take('-')) return -this.parseUnary();
    if (this.take('+')) return this.parseUnary();
    return this.parsePrimary();
  }

  private parsePrimary(): number {
    const token = this.take();
    if (!token) return 0;
    if (token.kind === 'number') return finite(Number(token.value));
    if (token.value === '(') {
      const value = this.parseOr();
      this.take(')');
      return value;
    }
    if (token.kind !== 'identifier') return 0;
    if (this.current()?.value === '(') {
      this.take('(');
      const argumentsList: number[] = [];
      if (this.current()?.value !== ')') {
        do {
          argumentsList.push(this.parseOr());
        } while (this.take(','));
      }
      this.take(')');
      return this.call(token.value, argumentsList);
    }
    const upper = token.value.toUpperCase();
    if (upper === 'HIGH' || upper === 'TRUE') return 1;
    if (upper === 'LOW' || upper === 'FALSE') return 0;
    if (upper === 'LED_BUILTIN') return 13;
    const analog = /^A([0-5])$/.exec(upper);
    if (analog) return 14 + Number(analog[1]);
    const digital = /^D(\d{1,2})$/.exec(upper);
    if (digital) return Number(digital[1]);
    return this.state.variables.get(token.value) ?? 0;
  }

  private call(name: string, argumentsList: readonly number[]): number {
    const lower = name.toLowerCase();
    if (lower === 'analogread') {
      const terminal = analogTerminalFromPin(argumentsList[0] ?? 0);
      return terminal ? arduinoAnalogReading(this.state.inputs, terminal) : 0;
    }
    if (lower === 'digitalread') {
      const terminal = digitalTerminalFromPin(argumentsList[0] ?? 0);
      return terminal ? arduinoDigitalReading(this.state.inputs, terminal) : 0;
    }
    if (lower === 'map') {
      const [value = 0, fromLow = 0, fromHigh = 0, toLow = 0, toHigh = 0] = argumentsList;
      if (fromHigh === fromLow) return toLow;
      return ((value - fromLow) * (toHigh - toLow)) / (fromHigh - fromLow) + toLow;
    }
    if (lower === 'constrain')
      return clamp(argumentsList[0] ?? 0, argumentsList[1] ?? 0, argumentsList[2] ?? 0);
    if (lower === 'abs') return Math.abs(argumentsList[0] ?? 0);
    if (lower === 'min') return Math.min(...argumentsList);
    if (lower === 'max') return Math.max(...argumentsList);
    if (lower === 'millis') return this.state.simulationTimeMs;
    return 0;
  }
}

function evaluate(expression: string, state: RuntimeState): number {
  return new ExpressionParser(tokenize(expression), state).parse();
}

function functionBody(source: string, name: 'setup' | 'loop'): string | null {
  const declaration = new RegExp(`\\bvoid\\s+${name}\\s*\\([^)]*\\)\\s*\\{`, 'i').exec(source);
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

  const declaration =
    /^(?:const\s+)?(?:unsigned\s+long|int|long|float|double|bool|boolean|byte)\s+([A-Za-z_]\w*)\s*(?:=\s*(.+))?$/i.exec(
      compact,
    );
  if (declaration) {
    state.variables.set(declaration[1]!, declaration[2] ? evaluate(declaration[2], state) : 0);
    return;
  }
  const assignment = /^([A-Za-z_]\w*)\s*(=|\+=|-=|\*=|\/=)\s*(.+)$/.exec(compact);
  if (assignment) {
    const name = assignment[1]!;
    const current = state.variables.get(name) ?? 0;
    const value = evaluate(assignment[3]!, state);
    state.variables.set(
      name,
      assignment[2] === '='
        ? value
        : assignment[2] === '+='
          ? current + value
          : assignment[2] === '-='
            ? current - value
            : assignment[2] === '*='
              ? current * value
              : value === 0
                ? 0
                : current / value,
    );
    return;
  }
  const increment = /^(?:\+\+|--)?([A-Za-z_]\w*)(\+\+|--)?$/.exec(compact);
  if (increment && (compact.startsWith('++') || compact.startsWith('--') || increment[2])) {
    const name = increment[1]!;
    const delta = compact.includes('++') ? 1 : -1;
    state.variables.set(name, (state.variables.get(name) ?? 0) + delta);
    return;
  }

  const call = /^([A-Za-z_]\w*)\s*\((.*)\)$/.exec(compact);
  if (!call) return;
  const name = call[1]!.toLowerCase();
  const argumentsList = splitArguments(call[2] ?? '');
  const pinValue = evaluate(argumentsList[0] ?? '0', state);
  const digitalTerminal = digitalTerminalFromPin(pinValue);
  if (name === 'pinmode' && digitalTerminal) {
    const mode = (argumentsList[1] ?? 'INPUT').trim().toUpperCase();
    if (mode === 'OUTPUT' || mode === 'INPUT' || mode === 'INPUT_PULLUP') {
      state.actions.push({ kind: 'pin-mode', terminal: digitalTerminal, mode });
      if (mode === 'OUTPUT') {
        state.actions.push({ kind: 'write', terminal: digitalTerminal, targetVoltage: 0 });
      }
    }
    return;
  }
  if (name === 'digitalwrite' && digitalTerminal) {
    state.actions.push({
      kind: 'write',
      terminal: digitalTerminal,
      targetVoltage: evaluate(argumentsList[1] ?? 'LOW', state) === 0 ? 0 : 5,
    });
    return;
  }
  if (name === 'analogwrite' && digitalTerminal) {
    const value = clamp(evaluate(argumentsList[1] ?? '0', state), 0, 255);
    const targetVoltage = PWM_TERMINALS.has(digitalTerminal)
      ? (5 * value) / 255
      : value < 128
        ? 0
        : 5;
    state.actions.push({ kind: 'write', terminal: digitalTerminal, targetVoltage });
    return;
  }
  if (name === 'delay' || name === 'delaymicroseconds') {
    const rawDuration = Math.max(0, evaluate(argumentsList[0] ?? '0', state));
    state.actions.push({
      kind: 'delay',
      durationMs: name === 'delaymicroseconds' ? rawDuration / 1000 : rawDuration,
    });
    return;
  }
  if (name === 'tone' && digitalTerminal) {
    const frequencyHz = evaluate(argumentsList[1] ?? '0', state);
    const durationMs = evaluate(argumentsList[2] ?? '0', state);
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
): readonly CompiledInstruction[] {
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
      instructions.push({ kind: 'branch', condition: condition.content, falseTarget: -1 });
      compileStatements(body.content, instructions, diagnostics, scope);
      if (diagnostics.length > 0) break;
      if (control[1] === 'while') {
        instructions.push({ kind: 'jump', target: branchIndex });
        (instructions[branchIndex] as BranchInstruction).falseTarget = instructions.length;
      } else if (elseBody) {
        const jumpIndex = instructions.length;
        instructions.push({ kind: 'jump', target: -1 });
        (instructions[branchIndex] as BranchInstruction).falseTarget = instructions.length;
        compileStatements(elseBody.content, instructions, diagnostics, scope);
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
      if (initialization) instructions.push({ kind: 'simple', statement: initialization });
      const branchIndex = instructions.length;
      instructions.push({ kind: 'branch', condition: condition || '1', falseTarget: -1 });
      compileStatements(body.content, instructions, diagnostics, scope);
      if (diagnostics.length > 0) break;
      if (increment) instructions.push({ kind: 'simple', statement: increment });
      instructions.push({ kind: 'jump', target: branchIndex });
      (instructions[branchIndex] as BranchInstruction).falseTarget = instructions.length;
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
    if (statement) instructions.push({ kind: 'simple', statement });
    index = end + 1;
  }
  return instructions;
}

function executeStatements(source: string, state: RuntimeState): void {
  let index = 0;
  while (index < source.length && state.statementCount < MAX_STATEMENTS) {
    index = skipWhitespace(source, index);
    if (index >= source.length) break;
    if (source[index] === '#') {
      index = source.indexOf('\n', index);
      if (index < 0) break;
      continue;
    }
    const remaining = source.slice(index);
    const control = /^(if|while)\b/.exec(remaining);
    if (control) {
      let cursor = skipWhitespace(source, index + control[0].length);
      const condition = balancedSlice(source, cursor, '(', ')');
      if (!condition) break;
      cursor = skipWhitespace(source, condition.end);
      const body = balancedSlice(source, cursor, '{', '}');
      if (!body) break;
      cursor = skipWhitespace(source, body.end);
      let elseBody: { readonly content: string; readonly end: number } | null = null;
      if (control[1] === 'if' && /^else\b/.test(source.slice(cursor))) {
        cursor = skipWhitespace(source, cursor + 4);
        elseBody = balancedSlice(source, cursor, '{', '}');
        if (elseBody) cursor = elseBody.end;
      }
      if (control[1] === 'if') {
        if (!consumeStatement(state)) break;
        const conditionTrue = evaluate(condition.content, state) !== 0;
        if (conditionTrue) executeStatements(body.content, state);
        else if (elseBody) executeStatements(elseBody.content, state);
      } else {
        while (consumeStatement(state)) {
          if (evaluate(condition.content, state) === 0) break;
          executeStatements(body.content, state);
          if (state.statementCount >= MAX_STATEMENTS) {
            statementBudgetDiagnostic(state);
            break;
          }
        }
      }
      index = cursor;
      continue;
    }
    if (/^for\b/.test(remaining)) {
      let cursor = skipWhitespace(source, index + 3);
      const header = balancedSlice(source, cursor, '(', ')');
      if (!header) break;
      cursor = skipWhitespace(source, header.end);
      const body = balancedSlice(source, cursor, '{', '}');
      if (!body) break;
      const [initialization, condition, increment] = splitForHeader(header.content);
      if (initialization) executeSimpleStatement(initialization, state);
      while (consumeStatement(state)) {
        if (condition && evaluate(condition, state) === 0) break;
        executeStatements(body.content, state);
        if (state.statementCount >= MAX_STATEMENTS) {
          statementBudgetDiagnostic(state);
          break;
        }
        if (increment) executeSimpleStatement(increment, state);
      }
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
    if (end >= source.length) break;
    executeSimpleStatement(source.slice(index, end), state);
    index = end + 1;
  }
  if (index < source.length && state.statementCount >= MAX_STATEMENTS) {
    statementBudgetDiagnostic(state);
  }
}

interface GlobalDeclaration {
  readonly name: string;
  readonly initializer?: string;
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
    const declaration =
      /^(?:const\s+)?(?:unsigned\s+long|int|long|float|double|bool|boolean|byte)\s+([A-Za-z_]\w*)\s*(?:=\s*(.+))?$/i.exec(
        statement,
      );
    if (!declaration) return [];
    return [
      {
        name: declaration[1]!,
        ...(declaration[2] ? { initializer: declaration[2] } : {}),
      },
    ];
  });
}

function initializeGlobals(declarations: readonly GlobalDeclaration[], state: RuntimeState): void {
  for (const declaration of declarations) {
    state.variables.set(
      declaration.name,
      declaration.initializer ? evaluate(declaration.initializer, state) : 0,
    );
  }
}

function discardLocalVariables(
  variables: Map<string, number>,
  globalNames: ReadonlySet<string>,
): void {
  for (const name of variables.keys()) {
    if (!globalNames.has(name)) variables.delete(name);
  }
}

interface ArduinoProgramCompilation {
  readonly cleanSource: string;
  readonly setupInstructions: readonly CompiledInstruction[];
  readonly loopInstructions: readonly CompiledInstruction[];
  readonly diagnostics: readonly ArduinoRuntimeDiagnostic[];
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
  const setupInstructions = compileStatements(setupBody, [], messages, 'setup');
  const loopInstructions = compileStatements(loopBody, [], messages, 'loop');
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

/**
 * Advance the compiled setup/loop continuation through deterministic virtual
 * time. A delay suspends the exact instruction, locals and control flow until
 * its boundary; later statements are neither evaluated nor applied early. A
 * loop with no delay receives a 1 ms scheduling quantum so a large time jump
 * stays finite and reproducible.
 */
export function advanceArduinoRuntime(
  source: string,
  inputs: ArduinoTerminalVoltages = {},
  simulationTimeMs = 0,
  previous?: ArduinoRuntimeState,
): ArduinoRuntimeAdvance {
  const compilation = compileArduinoProgram(source);
  const { cleanSource, setupInstructions, loopInstructions } = compilation;
  const declarations = globalDeclarations(cleanSource);
  const globalNames = new Set(declarations.map((declaration) => declaration.name));
  const fingerprint = programFingerprint(source);
  const targetTimeMs = Math.max(0, finite(simulationTimeMs));
  if (compilation.diagnostics.length > 0) {
    return {
      setupActions: [],
      loopActions: [],
      events: [],
      state: {
        version: ARDUINO_RUNTIME_STATE_VERSION,
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
        pinModes: {},
        outputVoltages: {},
        tones: {},
      },
      diagnostics: compilation.diagnostics,
    };
  }
  const previousInstructionCount =
    previous?.phase === 'setup' ? setupInstructions.length : loopInstructions.length;
  const compatible =
    previous !== undefined &&
    runtimeStateIsValid(previous) &&
    previous.programFingerprint === fingerprint &&
    previous.virtualTimeMs <= targetTimeMs &&
    previous.programCounter <= previousInstructionCount;
  if (compatible && previous.virtualTimeMs === targetTimeMs) {
    return {
      setupActions: [],
      loopActions: [],
      events: [],
      state: previous,
      diagnostics: [],
    };
  }
  const variables = compatible
    ? new Map<string, number>([
        ...runtimeVariables(previous.variables),
        ...runtimeVariables(previous.locals),
      ])
    : new Map<string, number>();
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

  if (!compatible) {
    const initializationState: RuntimeState = {
      variables,
      inputs,
      actions: [],
      diagnostics,
      simulationTimeMs: resetAtMs,
      statementCount: 0,
    };
    initializeGlobals(declarations, initializationState);
  }

  let completedLoops = 0;
  while (
    resumeAtMs <= targetTimeMs &&
    completedLoops < MAX_LOOP_ADVANCES &&
    advanceStatementCount < MAX_ADVANCE_STATEMENTS &&
    diagnostics.length === 0
  ) {
    expireTones(resumeAtMs, tones, emit);
    const instructions = phase === 'setup' ? setupInstructions : loopInstructions;

    if (phase === 'setup' && programCounter >= instructions.length) {
      discardLocalVariables(variables, globalNames);
      phase = 'loop';
      programCounter = 0;
      loopIterationActive = false;
      loopStartedAtMs = resumeAtMs;
      continuousStatementCount = 0;
      continue;
    }

    if (phase === 'loop' && !loopIterationActive) {
      loopIterationActive = true;
      loopStartedAtMs = resumeAtMs;
      loopIterations += 1;
    }

    if (phase === 'loop' && programCounter >= instructions.length) {
      discardLocalVariables(variables, globalNames);
      programCounter = 0;
      loopIterationActive = false;
      completedLoops += 1;
      continuousStatementCount = 0;
      if (resumeAtMs <= loopStartedAtMs) resumeAtMs = loopStartedAtMs + MIN_LOOP_DURATION_MS;
      continue;
    }

    const instruction = instructions[programCounter];
    if (!instruction) break;
    if (instruction.kind === 'jump') {
      programCounter = instruction.target;
      continue;
    }

    const actions = phase === 'setup' ? setupActions : loopActions;
    const instructionState: RuntimeState = {
      variables,
      inputs,
      actions,
      diagnostics,
      simulationTimeMs: resumeAtMs,
      statementCount: continuousStatementCount,
    };
    const statementCountBefore = instructionState.statementCount;

    if (instruction.kind === 'branch') {
      if (!consumeStatement(instructionState)) break;
      programCounter =
        evaluate(instruction.condition, instructionState) !== 0
          ? programCounter + 1
          : instruction.falseTarget;
    } else {
      const actionStart = actions.length;
      executeSimpleStatement(instruction.statement, instructionState);
      programCounter += 1;
      const executionTimeMs = resumeAtMs;
      for (const action of actions.slice(actionStart)) {
        if (action.kind === 'delay') {
          resumeAtMs += action.durationMs;
          if (action.durationMs > 0) continuousStatementCount = 0;
        } else {
          applyRuntimeAction(action, executionTimeMs, pinModes, outputVoltages, tones, emit);
        }
      }
    }
    const consumed = instructionState.statementCount - statementCountBefore;
    advanceStatementCount += consumed;
    continuousStatementCount =
      resumeAtMs > instructionState.simulationTimeMs ? 0 : instructionState.statementCount;
  }

  expireTones(targetTimeMs, tones, emit);

  if (
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

  return {
    setupActions,
    loopActions,
    events,
    state: {
      version: ARDUINO_RUNTIME_STATE_VERSION,
      programFingerprint: fingerprint,
      virtualTimeMs: targetTimeMs,
      resumeAtMs,
      phase,
      programCounter,
      loopIterationActive,
      loopStartedAtMs,
      loopIterations,
      nextEventSequence,
      eventQueue,
      variables: serializableVariables(
        new Map([...variables].filter(([name]) => globalNames.has(name))),
      ),
      locals: serializableVariables(
        new Map([...variables].filter(([name]) => !globalNames.has(name))),
      ),
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

export function executeArduinoProgram(
  source: string,
  inputs: ArduinoTerminalVoltages = {},
  simulationTimeMs = 0,
): ArduinoProgramExecution {
  const cleanSource = removeComments(source);
  const sharedVariables = new Map<string, number>();
  const setupState: RuntimeState = {
    variables: sharedVariables,
    inputs,
    actions: [],
    diagnostics: [],
    simulationTimeMs: finite(simulationTimeMs),
    statementCount: 0,
  };
  initializeGlobals(globalDeclarations(cleanSource), setupState);
  executeStatements(functionBody(cleanSource, 'setup') ?? '', setupState);
  const loopState: RuntimeState = {
    ...setupState,
    actions: [],
    statementCount: 0,
  };
  executeStatements(functionBody(cleanSource, 'loop') ?? cleanSource, loopState);
  return { setupActions: setupState.actions, loopActions: loopState.actions };
}

export function arduinoSourceUsesInputReads(source: string): boolean {
  return /\b(?:analogRead|digitalRead)\s*\(/.test(removeComments(source));
}
