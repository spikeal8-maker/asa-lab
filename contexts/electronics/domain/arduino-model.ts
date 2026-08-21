import type { SchematicComponent, Terminal } from './document.js';

export const ARDUINO_GROUND_TERMINALS = [
  'power-gnd-1',
  'power-gnd-2',
  'gnd-top',
] as const satisfies readonly Terminal[];

export interface ArduinoOutputBranch {
  readonly id: string;
  readonly terminal: Terminal;
  readonly ground: Terminal;
  readonly targetVoltage: number;
  readonly resistanceOhm: number;
}

const DEFAULT_ARDUINO_SOURCE = `
void setup() {
  pinMode(LED_BUILTIN, OUTPUT);
}

void loop() {
  digitalWrite(LED_BUILTIN, HIGH);
  delay(1000);
  digitalWrite(LED_BUILTIN, LOW);
  delay(1000);
}
`;

export function isArduinoUno(component: SchematicComponent): boolean {
  return component.componentTypeId === 'arduino-uno' || component.variantId === 'arduino-uno';
}

function digitalTerminal(token: string): Terminal | null {
  const compact = token.replaceAll(/\s/g, '').toUpperCase();
  if (compact === 'LED_BUILTIN') return 'd13';
  const match = /^(?:D)?(\d{1,2})$/.exec(compact);
  if (!match) return null;
  const pin = Number(match[1]);
  return Number.isInteger(pin) && pin >= 0 && pin <= 13 ? `d${pin}` : null;
}

interface ArduinoWriteAction {
  readonly kind: 'write';
  readonly terminal: Terminal;
  readonly targetVoltage: number;
}

interface ArduinoDelayAction {
  readonly kind: 'delay';
  readonly durationMs: number;
}

type ArduinoProgramAction = ArduinoWriteAction | ArduinoDelayAction;

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

function programActions(source: string): readonly ArduinoProgramAction[] {
  const actions: ArduinoProgramAction[] = [];
  const call = /\b(digitalWrite|analogWrite|delayMicroseconds|delay)\s*\(([^)]*)\)/gi;
  for (const match of source.matchAll(call)) {
    const name = match[1]?.toLowerCase();
    const argumentsList = (match[2] ?? '').split(',').map((argument) => argument.trim());
    if (name === 'digitalwrite') {
      const terminal = digitalTerminal(argumentsList[0] ?? '');
      const level = argumentsList[1]?.toUpperCase();
      if (terminal && (level === 'HIGH' || level === 'LOW')) {
        actions.push({ kind: 'write', terminal, targetVoltage: level === 'HIGH' ? 5 : 0 });
      }
      continue;
    }
    if (name === 'analogwrite') {
      const terminal = digitalTerminal(argumentsList[0] ?? '');
      const rawValue = Number(argumentsList[1]);
      if (terminal && Number.isFinite(rawValue)) {
        const value = Math.min(255, Math.max(0, rawValue));
        actions.push({ kind: 'write', terminal, targetVoltage: (5 * value) / 255 });
      }
      continue;
    }
    const rawDuration = Number(argumentsList[0]);
    if (!Number.isFinite(rawDuration) || rawDuration < 0) continue;
    const durationMs = name === 'delaymicroseconds' ? rawDuration / 1000 : rawDuration;
    actions.push({ kind: 'delay', durationMs });
  }
  return actions;
}

function applyWrites(
  outputs: Map<Terminal, number>,
  actions: readonly ArduinoProgramAction[],
): void {
  for (const action of actions) {
    if (action.kind === 'write') outputs.set(action.terminal, action.targetVoltage);
  }
}

/**
 * Execute the deterministic digital/PWM subset emitted by the block editor.
 * setup() runs once; loop() repeats according to delay()/delayMicroseconds().
 * Unknown C++ stays inert instead of inventing an electrical state.
 */
export function arduinoProgrammedOutputs(
  component: SchematicComponent,
  simulationTimeMs = 0,
): ReadonlyMap<Terminal, number> {
  if (!isArduinoUno(component)) return new Map();
  const storedSource = component.stateProperties?.['arduinoSource'];
  const source = typeof storedSource === 'string' ? storedSource : DEFAULT_ARDUINO_SOURCE;
  const outputs = new Map<Terminal, number>();
  applyWrites(outputs, programActions(functionBody(source, 'setup') ?? ''));

  const loopActions = programActions(functionBody(source, 'loop') ?? source);
  const cycleDurationMs = loopActions.reduce(
    (duration, action) => duration + (action.kind === 'delay' ? action.durationMs : 0),
    0,
  );
  if (cycleDurationMs <= 0) {
    applyWrites(outputs, loopActions);
    return outputs;
  }

  const finiteTime = Number.isFinite(simulationTimeMs) ? Math.max(0, simulationTimeMs) : 0;
  const cycleTime = finiteTime % cycleDurationMs;
  let cursorMs = 0;
  for (const action of loopActions) {
    if (action.kind === 'delay') {
      cursorMs += action.durationMs;
      if (cursorMs > cycleTime) break;
      continue;
    }
    if (cursorMs <= cycleTime) outputs.set(action.terminal, action.targetVoltage);
  }
  return outputs;
}

/**
 * Arduino outputs are represented as confirmed Thevenin sources. This keeps
 * the circuit finite under overload while still making a resistor-less LED on
 * D13 reach the destructive-current diagnostic, just as the physical circuit
 * would. simulationTimeMs is explicit input, so identical document + time still
 * gives byte-for-byte deterministic evidence in the browser and on the server.
 */
export function arduinoOutputBranches(
  component: SchematicComponent,
  simulationTimeMs = 0,
): readonly ArduinoOutputBranch[] {
  if (!isArduinoUno(component)) return [];
  const pins = new Set(component.pinIds ?? []);
  const ground = ARDUINO_GROUND_TERMINALS.find((terminal) => pins.has(terminal));
  if (!ground) return [];

  const branches: ArduinoOutputBranch[] = [];
  if (pins.has('power-5v')) {
    branches.push({
      id: 'power-5v',
      terminal: 'power-5v',
      ground,
      targetVoltage: 5,
      resistanceOhm: 0.1,
    });
  }
  if (pins.has('power-3v3')) {
    branches.push({
      id: 'power-3v3',
      terminal: 'power-3v3',
      ground,
      targetVoltage: 3.3,
      resistanceOhm: 0.2,
    });
  }

  for (const [terminal, targetVoltage] of arduinoProgrammedOutputs(component, simulationTimeMs)) {
    if (!pins.has(terminal)) continue;
    branches.push({
      id: terminal,
      terminal,
      ground,
      targetVoltage,
      resistanceOhm: 10,
    });
  }
  return branches;
}
