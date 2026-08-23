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

export interface ArduinoToneOutput {
  readonly terminal: Terminal;
  readonly frequencyHz: number;
  readonly source: 'tone' | 'digital-toggle';
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

interface ArduinoToneAction {
  readonly kind: 'tone';
  readonly terminal: Terminal;
  readonly frequencyHz: number;
  readonly durationMs?: number;
}

interface ArduinoNoToneAction {
  readonly kind: 'no-tone';
  readonly terminal: Terminal;
}

type ArduinoProgramAction =
  ArduinoWriteAction | ArduinoDelayAction | ArduinoToneAction | ArduinoNoToneAction;

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
  const call = /\b(digitalWrite|analogWrite|delayMicroseconds|delay|noTone|tone)\s*\(([^)]*)\)/gi;
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
    if (name === 'tone') {
      const terminal = digitalTerminal(argumentsList[0] ?? '');
      const frequencyHz = Number(argumentsList[1]);
      const rawDuration = Number(argumentsList[2]);
      if (terminal && Number.isFinite(frequencyHz) && frequencyHz >= 1 && frequencyHz <= 20_000) {
        actions.push({
          kind: 'tone',
          terminal,
          frequencyHz,
          ...(argumentsList[2] === undefined || !Number.isFinite(rawDuration) || rawDuration <= 0
            ? {}
            : { durationMs: rawDuration }),
        });
      }
      continue;
    }
    if (name === 'notone') {
      const terminal = digitalTerminal(argumentsList[0] ?? '');
      if (terminal) actions.push({ kind: 'no-tone', terminal });
      continue;
    }
    const rawDuration = Number(argumentsList[0]);
    if (!Number.isFinite(rawDuration) || rawDuration < 0) continue;
    const durationMs = name === 'delaymicroseconds' ? rawDuration / 1000 : rawDuration;
    actions.push({ kind: 'delay', durationMs });
  }
  return actions;
}

function loopCycleDuration(actions: readonly ArduinoProgramAction[]): number {
  return actions.reduce(
    (duration, action) => duration + (action.kind === 'delay' ? action.durationMs : 0),
    0,
  );
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
  const cycleDurationMs = loopCycleDuration(loopActions);
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
    if (action.kind === 'write' && cursorMs <= cycleTime) {
      outputs.set(action.terminal, action.targetVoltage);
    }
  }
  return outputs;
}

/**
 * Resolve the audible signal emitted by the supported Arduino subset. tone()
 * is authoritative. A repeated HIGH/LOW loop is also recognised as a square
 * wave, but only inside the audible 20 Hz..20 kHz band; a one-second Blink
 * therefore remains silent instead of becoming an invented buzzer sound.
 */
export function arduinoProgrammedToneOutputs(
  component: SchematicComponent,
  simulationTimeMs = 0,
): ReadonlyMap<Terminal, ArduinoToneOutput> {
  if (!isArduinoUno(component)) return new Map();
  const storedSource = component.stateProperties?.['arduinoSource'];
  const source = typeof storedSource === 'string' ? storedSource : DEFAULT_ARDUINO_SOURCE;
  const tones = new Map<Terminal, ArduinoToneOutput>();
  const expiry = new Map<Terminal, number>();
  const applyTone = (action: ArduinoProgramAction, cursorMs: number): void => {
    if (action.kind === 'tone') {
      tones.set(action.terminal, {
        terminal: action.terminal,
        frequencyHz: action.frequencyHz,
        source: 'tone',
      });
      if (action.durationMs !== undefined)
        expiry.set(action.terminal, cursorMs + action.durationMs);
      else expiry.delete(action.terminal);
    } else if (action.kind === 'no-tone') {
      tones.delete(action.terminal);
      expiry.delete(action.terminal);
    }
  };

  for (const action of programActions(functionBody(source, 'setup') ?? '')) applyTone(action, 0);
  const loopActions = programActions(functionBody(source, 'loop') ?? source);
  const cycleDurationMs = loopCycleDuration(loopActions);
  if (cycleDurationMs <= 0) {
    for (const action of loopActions) applyTone(action, 0);
    return tones;
  }

  const finiteTime = Number.isFinite(simulationTimeMs) ? Math.max(0, simulationTimeMs) : 0;
  const cycleTime = finiteTime % cycleDurationMs;
  let cursorMs = 0;
  for (const action of loopActions) {
    if (action.kind === 'delay') {
      const nextCursor = cursorMs + action.durationMs;
      if (nextCursor > cycleTime) break;
      cursorMs = nextCursor;
      for (const [terminal, expiresAt] of expiry) {
        if (expiresAt <= cursorMs) {
          tones.delete(terminal);
          expiry.delete(terminal);
        }
      }
      continue;
    }
    applyTone(action, cursorMs);
  }
  for (const [terminal, expiresAt] of expiry) {
    if (expiresAt <= cycleTime) tones.delete(terminal);
  }

  const writesByTerminal = new Map<Terminal, ArduinoWriteAction[]>();
  for (const action of loopActions) {
    if (action.kind !== 'write') continue;
    writesByTerminal.set(action.terminal, [
      ...(writesByTerminal.get(action.terminal) ?? []),
      action,
    ]);
  }
  for (const [terminal, writes] of writesByTerminal) {
    if (tones.has(terminal) || writes.length < 2) continue;
    const levels = new Set(writes.map((write) => write.targetVoltage >= 2.5));
    if (levels.size < 2) continue;
    let risingEdges = 0;
    for (let index = 0; index < writes.length; index += 1) {
      const previous = writes[(index + writes.length - 1) % writes.length] as ArduinoWriteAction;
      const current = writes[index] as ArduinoWriteAction;
      if (previous.targetVoltage < 2.5 && current.targetVoltage >= 2.5) risingEdges += 1;
    }
    const frequencyHz = (risingEdges * 1000) / cycleDurationMs;
    if (frequencyHz >= 20 && frequencyHz <= 20_000) {
      tones.set(terminal, { terminal, frequencyHz, source: 'digital-toggle' });
    }
  }
  return tones;
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

  const programmedOutputs = arduinoProgrammedOutputs(component, simulationTimeMs);
  for (const [terminal, targetVoltage] of programmedOutputs) {
    if (!pins.has(terminal)) continue;
    branches.push({
      id: terminal,
      terminal,
      ground,
      targetVoltage,
      resistanceOhm: 10,
    });
  }
  for (const tone of arduinoProgrammedToneOutputs(component, simulationTimeMs).values()) {
    if (!pins.has(tone.terminal) || programmedOutputs.has(tone.terminal)) continue;
    const periodMs = 1000 / tone.frequencyHz;
    const phaseMs = Math.max(0, simulationTimeMs) % periodMs;
    branches.push({
      id: tone.terminal,
      terminal: tone.terminal,
      ground,
      targetVoltage: phaseMs < periodMs / 2 ? 5 : 0,
      resistanceOhm: 10,
    });
  }
  return branches;
}
