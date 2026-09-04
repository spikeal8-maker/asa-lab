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

export type ArduinoTerminalVoltages = Readonly<Partial<Record<Terminal, number>>>;

interface Token {
  readonly kind: 'number' | 'identifier' | 'operator' | 'punctuation';
  readonly value: string;
}

interface RuntimeState {
  readonly variables: Map<string, number>;
  readonly inputs: ArduinoTerminalVoltages;
  readonly actions: ArduinoProgramAction[];
  readonly simulationTimeMs: number;
  statementCount: number;
}

const MAX_STATEMENTS = 512;
const PWM_TERMINALS = new Set<Terminal>(['d3', 'd5', 'd6', 'd9', 'd10', 'd11']);

function finite(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, finite(value)));
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
  if (!compact || state.statementCount >= MAX_STATEMENTS) return;
  state.statementCount += 1;

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
      const conditionTrue = evaluate(condition.content, state) !== 0;
      if (conditionTrue) executeStatements(body.content, state);
      else if (elseBody) executeStatements(elseBody.content, state);
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
      // One bounded pass preserves the generated block's electrical intent
      // without pretending to be an unrestricted C++ virtual machine.
      executeStatements(body.content, state);
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
}

function initialVariables(source: string, state: RuntimeState): void {
  const withoutFunctions = source
    .replace(/\bvoid\s+setup\s*\([^)]*\)\s*\{[\s\S]*?\}/i, '')
    .replace(/\bvoid\s+loop\s*\([^)]*\)\s*\{[\s\S]*?\}/i, '');
  const declaration =
    /(?:^|;)\s*(?:const\s+)?(?:unsigned\s+long|int|long|float|double|bool|boolean|byte)\s+([A-Za-z_]\w*)\s*(?:=\s*([^;]+))?/gi;
  for (const match of withoutFunctions.matchAll(declaration)) {
    state.variables.set(match[1]!, match[2] ? evaluate(match[2], state) : 0);
  }
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
    simulationTimeMs: finite(simulationTimeMs),
    statementCount: 0,
  };
  initialVariables(cleanSource, setupState);
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
