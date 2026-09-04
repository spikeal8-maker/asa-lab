import type { SchematicComponent, Terminal } from './document.js';
import {
  executeArduinoProgram,
  type ArduinoProgramAction,
  type ArduinoTerminalVoltages,
  type ArduinoWriteAction,
} from './arduino-program-runtime.js';

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
 * The circuit solver validates the sketch against the shared capability
 * registry before calling this bounded executor, so unknown C++ fails closed
 * instead of becoming an invented electrical state.
 */
export function arduinoProgrammedOutputs(
  component: SchematicComponent,
  simulationTimeMs = 0,
  inputVoltages: ArduinoTerminalVoltages = {},
): ReadonlyMap<Terminal, number> {
  if (!isArduinoUno(component)) return new Map();
  const storedSource = component.stateProperties?.['arduinoSource'];
  const source = typeof storedSource === 'string' ? storedSource : DEFAULT_ARDUINO_SOURCE;
  const execution = executeArduinoProgram(source, inputVoltages, simulationTimeMs);
  const outputs = new Map<Terminal, number>();
  applyWrites(outputs, execution.setupActions);

  const loopActions = execution.loopActions;
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
  inputVoltages: ArduinoTerminalVoltages = {},
): ReadonlyMap<Terminal, ArduinoToneOutput> {
  if (!isArduinoUno(component)) return new Map();
  const storedSource = component.stateProperties?.['arduinoSource'];
  const source = typeof storedSource === 'string' ? storedSource : DEFAULT_ARDUINO_SOURCE;
  const execution = executeArduinoProgram(source, inputVoltages, simulationTimeMs);
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

  for (const action of execution.setupActions) applyTone(action, 0);
  const loopActions = execution.loopActions;
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
  inputVoltages: ArduinoTerminalVoltages = {},
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

  const storedSource = component.stateProperties?.['arduinoSource'];
  const source = typeof storedSource === 'string' ? storedSource : DEFAULT_ARDUINO_SOURCE;
  const execution = executeArduinoProgram(source, inputVoltages, simulationTimeMs);
  const programmedOutputs = arduinoProgrammedOutputs(component, simulationTimeMs, inputVoltages);
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
  const modes = new Map<Terminal, 'INPUT' | 'INPUT_PULLUP' | 'OUTPUT'>();
  for (const action of [...execution.setupActions, ...execution.loopActions]) {
    if (action.kind === 'pin-mode') modes.set(action.terminal, action.mode);
  }
  for (const [terminal, mode] of modes) {
    if (mode !== 'INPUT_PULLUP' || !pins.has(terminal) || programmedOutputs.has(terminal)) continue;
    branches.push({
      id: terminal,
      terminal,
      ground,
      targetVoltage: 5,
      resistanceOhm: 20_000,
    });
  }
  for (const tone of arduinoProgrammedToneOutputs(
    component,
    simulationTimeMs,
    inputVoltages,
  ).values()) {
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
