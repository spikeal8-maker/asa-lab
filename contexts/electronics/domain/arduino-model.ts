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

function programmedDigitalOutputs(source: string): ReadonlyMap<Terminal, number> {
  const outputs = new Map<Terminal, number>();
  const digitalWrite = /digitalWrite\s*\(\s*(LED_BUILTIN|D?\s*\d{1,2})\s*,\s*(HIGH|LOW)\s*\)/gi;
  for (const match of source.matchAll(digitalWrite)) {
    const terminal = digitalTerminal(match[1] ?? '');
    if (terminal && !outputs.has(terminal))
      outputs.set(terminal, match[2]?.toUpperCase() === 'HIGH' ? 5 : 0);
  }

  const analogWrite = /analogWrite\s*\(\s*(D?\s*\d{1,2})\s*,\s*(\d{1,3})\s*\)/gi;
  for (const match of source.matchAll(analogWrite)) {
    const terminal = digitalTerminal(match[1] ?? '');
    const value = Math.min(255, Math.max(0, Number(match[2] ?? 0)));
    if (terminal && !outputs.has(terminal)) outputs.set(terminal, (5 * value) / 255);
  }
  return outputs;
}

/**
 * Arduino outputs are represented as confirmed Thevenin sources. This keeps
 * the circuit finite under overload while still making a resistor-less LED on
 * D13 reach the destructive-current diagnostic, just as the physical circuit
 * would. The first write in loop() is the deterministic t=0 operating point.
 */
export function arduinoOutputBranches(
  component: SchematicComponent,
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
  for (const [terminal, targetVoltage] of programmedDigitalOutputs(source)) {
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
