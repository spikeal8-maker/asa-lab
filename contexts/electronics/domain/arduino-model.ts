import type { SchematicComponent, Terminal } from './document.js';
import {
  advanceArduinoRuntime,
  executeArduinoProgram,
  type ArduinoProgramAction,
  type ArduinoRuntimeDiagnostic,
  type ArduinoRuntimeState,
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

export interface ArduinoRuntimeSnapshot {
  readonly state: ArduinoRuntimeState;
  readonly diagnostics: readonly ArduinoRuntimeDiagnostic[];
  readonly outputs: ReadonlyMap<Terminal, number>;
  readonly pinModes: ReadonlyMap<Terminal, 'INPUT' | 'INPUT_PULLUP' | 'OUTPUT'>;
  readonly tones: ReadonlyMap<Terminal, ArduinoToneOutput>;
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

function sourceFor(component: SchematicComponent): string {
  const storedSource = component.stateProperties?.['arduinoSource'];
  return typeof storedSource === 'string' ? storedSource : DEFAULT_ARDUINO_SOURCE;
}

function terminalMap<T>(record: Readonly<Partial<Record<Terminal, T>>>): Map<Terminal, T> {
  return new Map(Object.entries(record) as [Terminal, T][]);
}

export function arduinoRuntimeSnapshot(
  component: SchematicComponent,
  simulationTimeMs = 0,
  inputVoltages: ArduinoTerminalVoltages = {},
  previousState?: ArduinoRuntimeState,
): ArduinoRuntimeSnapshot | null {
  if (!isArduinoUno(component)) return null;
  const advanced = advanceArduinoRuntime(
    sourceFor(component),
    inputVoltages,
    simulationTimeMs,
    previousState,
  );
  return {
    state: advanced.state,
    diagnostics: advanced.diagnostics,
    outputs: terminalMap(advanced.state.outputVoltages),
    pinModes: terminalMap(advanced.state.pinModes),
    tones: new Map(
      Object.entries(advanced.state.tones).map(([terminal, tone]) => [
        terminal as Terminal,
        {
          terminal: terminal as Terminal,
          frequencyHz: tone!.frequencyHz,
          source: 'tone' as const,
        },
      ]),
    ),
  };
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
  previousState?: ArduinoRuntimeState,
): ReadonlyMap<Terminal, number> {
  return (
    arduinoRuntimeSnapshot(component, simulationTimeMs, inputVoltages, previousState)?.outputs ??
    new Map()
  );
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
  previousState?: ArduinoRuntimeState,
): ReadonlyMap<Terminal, ArduinoToneOutput> {
  if (!isArduinoUno(component)) return new Map();
  const snapshot = arduinoRuntimeSnapshot(
    component,
    simulationTimeMs,
    inputVoltages,
    previousState,
  );
  return snapshot
    ? arduinoProgrammedToneOutputsFromSnapshot(component, snapshot, simulationTimeMs, inputVoltages)
    : new Map();
}

export function arduinoProgrammedToneOutputsFromSnapshot(
  component: SchematicComponent,
  snapshot: ArduinoRuntimeSnapshot,
  simulationTimeMs = 0,
  inputVoltages: ArduinoTerminalVoltages = {},
): ReadonlyMap<Terminal, ArduinoToneOutput> {
  const source = sourceFor(component);
  const tones = new Map(snapshot.tones);
  const execution = executeArduinoProgram(source, inputVoltages, simulationTimeMs);
  const loopActions = execution.loopActions;
  const cycleDurationMs = loopCycleDuration(loopActions);

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
    const frequencyHz = cycleDurationMs > 0 ? (risingEdges * 1000) / cycleDurationMs : 0;
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
  previousState?: ArduinoRuntimeState,
): readonly ArduinoOutputBranch[] {
  if (!isArduinoUno(component)) return [];
  const snapshot = arduinoRuntimeSnapshot(
    component,
    simulationTimeMs,
    inputVoltages,
    previousState,
  );
  return snapshot
    ? arduinoOutputBranchesFromSnapshot(component, snapshot, simulationTimeMs, inputVoltages)
    : [];
}

export function arduinoOutputBranchesFromSnapshot(
  component: SchematicComponent,
  snapshot: ArduinoRuntimeSnapshot,
  simulationTimeMs = 0,
  inputVoltages: ArduinoTerminalVoltages = {},
): readonly ArduinoOutputBranch[] {
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

  const programmedOutputs = snapshot.outputs;
  const programmedTones = arduinoProgrammedToneOutputsFromSnapshot(
    component,
    snapshot,
    simulationTimeMs,
    inputVoltages,
  );
  for (const [terminal, targetVoltage] of programmedOutputs) {
    if (!pins.has(terminal) || programmedTones.has(terminal)) continue;
    branches.push({
      id: terminal,
      terminal,
      ground,
      targetVoltage,
      resistanceOhm: 10,
    });
  }
  for (const [terminal, mode] of snapshot.pinModes) {
    if (
      mode !== 'INPUT_PULLUP' ||
      !pins.has(terminal) ||
      programmedOutputs.has(terminal) ||
      programmedTones.has(terminal)
    )
      continue;
    branches.push({
      id: terminal,
      terminal,
      ground,
      targetVoltage: 5,
      resistanceOhm: 20_000,
    });
  }
  for (const tone of programmedTones.values()) {
    if (!pins.has(tone.terminal)) continue;
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
