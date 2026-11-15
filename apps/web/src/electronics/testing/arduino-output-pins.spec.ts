/* @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as S from 'scratch-blocks';
import { parseElectronicsDocument, solveCircuit } from '@asa-lab/electronics';
import {
  applyArduinoBlockDefaults,
  generateArduinoCode,
  migrateLegacyArduinoWorkspaceState,
  registerArduinoBlocks,
} from '../arduino-blocks';
import { activeArduinoGraph } from '../arduino-pin-inputs';
import { arduinoPinSetup } from '../arduino-output-pins';
const owner = JSON.parse(
  readFileSync(
    resolve(
      process.cwd(),
      'apps/web/src/electronics/testing/fixtures/owner-7ad29bb5-pin-setup.json',
    ),
    'utf8',
  ),
) as {
  arduinoBlocks: string;
  arduinoSource: string;
  arduinoGeneratedSource: string;
};

let w: S.Workspace;
beforeEach(() => {
  registerArduinoBlocks();
  S.Events.disable();
  w = new S.Workspace();
});
afterEach(() => {
  w.dispose();
  S.Events.enable();
});
function input(block: S.Block, name: string, child: S.Block) {
  block.getInput(name)!.connection!.connect(child.outputConnection!);
}
function number(value: string) {
  const block = w.newBlock('asa_number');
  block.setFieldValue(value, 'VALUE');
  return block;
}
function body(root: S.Block, child: S.Block) {
  root.getInput('DO')!.connection!.connect(child.previousConnection!);
}
function append(first: S.Block, next: S.Block) {
  first.nextConnection!.connect(next.previousConnection!);
}
function source() {
  applyArduinoBlockDefaults(w);
  return generateArduinoCode(w);
}
function modes(source: string) {
  return [...source.matchAll(/pinMode\((\w+), (INPUT|OUTPUT)\);/g)].map((m) => [m[1], m[2]]);
}
function runtime(source: string) {
  const parsed = parseElectronicsDocument({
    schemaVersion: 2,
    connections: [],
    components: [
      {
        id: 'uno',
        kind: 'visual',
        componentTypeId: 'arduino-uno',
        value: 5,
        position: { x: 0, y: 0 },
        pinIds: [
          ...Array.from({ length: 14 }, (_, i) => `d${i}`),
          ...Array.from({ length: 6 }, (_, i) => `a${i}`),
          'power-5v',
          'power-3v3',
          'power-gnd-1',
        ],
        stateProperties: { arduinoSource: source },
      },
    ],
  });
  if (!parsed.ok) throw new Error(parsed.message);
  const result = solveCircuit(parsed.document);
  expect(result.solved, JSON.stringify(result.diagnostics)).toBe(true);
  return result.controllerState!.boards[0]!.runtime;
}
function reading(type: string, pin: string) {
  const block = w.newBlock(type);
  input(block, 'PIN', number(pin));
  const statement = w.newBlock('asa_var_set');
  statement.setFieldValue(
    w
      .getVariableMap()
      .createVariable(`reading${w.getAllBlocks(false).length}`)
      .getId(),
    'NAME',
  );
  input(statement, 'VALUE', block);
  return statement;
}

describe('generated Arduino setup pin roles', () => {
  it('regenerates the exact owner program with twenty setup modes and simple unchanged effects', () => {
    const saved = JSON.parse(owner.arduinoBlocks);
    S.serialization.workspaces.load(migrateLegacyArduinoWorkspaceState(saved), w);
    const before = JSON.stringify(S.serialization.workspaces.save(w));
    const generated = source();
    expect(JSON.stringify(S.serialization.workspaces.save(w))).toBe(before);
    expect(modes(generated)).toEqual([
      ...Array.from({ length: 14 }, (_, pin) => [String(pin), 'OUTPUT']),
      ...Array.from({ length: 6 }, (_, pin) => [`A${pin}`, 'OUTPUT']),
    ]);
    expect(generated.split('void loop()')[1]).not.toContain('pinMode');
    expect(generated).not.toContain('asaOutputPin');
    expect(generated).toContain('digitalWrite(x, HIGH);');
    expect(generated).toContain('digitalWrite((x - 1), LOW);');
    expect(generated).toContain('digitalWrite((11 - x), HIGH);');
    expect(generated).toContain('digitalWrite((12 - x), LOW);');
    // This is an electrical-command/algorithm oracle, not a timing oracle:
    // removing repeated setup commands intentionally changes instruction time.
    const expanded = owner.arduinoSource.replace(
      /\{\s*int asaOutputPin = ([^;]+);\s*pinMode\(asaOutputPin, OUTPUT\);\s*digitalWrite\(asaOutputPin, (HIGH|LOW)\);\s*\}/g,
      'digitalWrite($1, $2);',
    );
    const loop = (s: string) => s.split('void loop()')[1]!.replace(/\s/g, '');
    expect(loop(generated)).toBe(loop(expanded));
    // The same immutable golden is executed by the core project's 22-second
    // action oracle; this frontend test binds it to the actual generator bytes.
    expect(generated).toBe(owner.arduinoGeneratedSource);
    const hash = (value: string) => createHash('sha256').update(value).digest('hex');
    expect(hash(owner.arduinoSource)).toBe(
      '943d712b0b4430dded820b43938f13d2b096c45ae63c7ef08e050fbcab5b4173',
    );
    const state = runtime(generated);
    expect(Object.values(state.pinModes)).toEqual(Array(20).fill('OUTPUT'));
    expect(Object.keys(state.outputVoltages).length).toBeGreaterThan(0);
    const serialized = JSON.stringify(S.serialization.workspaces.save(w));
    w.clear();
    S.serialization.workspaces.load(migrateLegacyArduinoWorkspaceState(JSON.parse(serialized)), w);
    expect(source()).toBe(generated);
    expect(owner.arduinoBlocks).toBe(JSON.stringify(saved));
  });

  it('gives button D2 and analog channel 0 input priority, including numeric aliases', () => {
    const setup = w.newBlock('asa_setup');
    const digital = reading('asa_digital_read', '2');
    const analog = reading('asa_analog_read', '0');
    body(setup, digital);
    append(digital, analog);
    const output = w.newBlock('asa_digital_write');
    append(analog, output);
    input(output, 'PIN', number('14'));
    const generated = source();
    expect(modes(generated)).toHaveLength(20);
    expect(generated).toContain('pinMode(2, INPUT);');
    expect(generated).toContain('pinMode(A0, INPUT);');
    expect(generated).not.toContain('pinMode(14,');
    const state = runtime(generated);
    expect(state.pinModes.d2).toBe('INPUT');
    expect(state.pinModes.a0).toBe('INPUT_PULLUP');
  });

  it.each(['0', '1', '2', '3', '4', '5', '14', '15', '16', '17', '18', '19'])(
    'reserves the analog input channel for numeric analogRead(%s)',
    (pin) => {
      body(w.newBlock('asa_setup'), reading('asa_analog_read', pin));
      const channel = Number(pin) < 6 ? Number(pin) : Number(pin) - 14;
      const generated = source();
      expect(generated).toContain(`pinMode(A${channel}, INPUT);`);
      expect(generated).toContain('pinMode(0, OUTPUT);');
      expect(modes(generated).filter(([, mode]) => mode === 'INPUT')).toHaveLength(1);
    },
  );

  it('reserves UART RX and ultrasonic echo, with no helper pinMode calls', () => {
    const setup = w.newBlock('asa_setup');
    const print = w.newBlock('asa_serial_print');
    body(setup, print);
    const measurement = w.newBlock('asa_var_set');
    measurement.setFieldValue(w.getVariableMap().createVariable('cm').getId(), 'NAME');
    append(print, measurement);
    const ultrasonic = w.newBlock('asa_ultrasonic');
    input(ultrasonic, 'TRIG', number('7'));
    input(ultrasonic, 'ECHO', number('8'));
    input(measurement, 'VALUE', ultrasonic);
    const generated = source();
    expect(generated).toContain('pinMode(0, INPUT);');
    expect(generated).toContain('pinMode(7, OUTPUT);');
    expect(generated).toContain('pinMode(8, INPUT);');
    expect(generated.slice(0, generated.indexOf('void setup()'))).not.toContain('pinMode');
    expect(modes(generated)).toHaveLength(20);
    expect(generated).toContain('Serial.begin(9600);');
  });

  it('does not evaluate an output reporter in setup and samples it once at the command', () => {
    const setup = w.newBlock('asa_setup');
    const output = w.newBlock('asa_digital_write');
    body(setup, output);
    const random = w.newBlock('asa_random');
    input(output, 'PIN', random);
    const generated = source();
    expect(generated).toContain('digitalWrite(random(1, 11), HIGH);');
    expect(generated.match(/random\(/g)).toHaveLength(1);
    expect(generated).not.toContain('asaOutputPin');
  });

  it('preserves numeric truncation and variable reassignment at each simple write', () => {
    const setup = w.newBlock('asa_setup');
    const variable = w.getVariableMap().createVariable('port');
    let previous: S.Block | null = null;
    for (const port of ['13.9', '19.9']) {
      const assignment = w.newBlock('asa_var_set');
      assignment.setFieldValue(variable.getId(), 'NAME');
      input(assignment, 'VALUE', number(port));
      if (previous) append(previous, assignment);
      else body(setup, assignment);
      const output = w.newBlock('asa_digital_write');
      const get = w.newBlock('asa_var_get');
      get.setFieldValue(variable.getId(), 'NAME');
      input(output, 'PIN', get);
      append(assignment, output);
      previous = output;
    }
    const generated = source();
    expect(generated.match(/digitalWrite\(port, HIGH\);/g)).toHaveLength(2);
    expect(runtime(generated).outputVoltages).toMatchObject({ d13: 5, a5: 5 });
  });

  it('covers RGB, PWM and tone branches without explicit per-command modes', () => {
    const loop = w.newBlock('asa_loop');
    const branch = w.newBlock('asa_if_else');
    body(loop, branch);
    const rgb = w.newBlock('asa_rgb_write');
    input(rgb, 'R_PIN', number('3'));
    input(rgb, 'G_PIN', number('5'));
    input(rgb, 'B_PIN', number('6'));
    body(branch, rgb);
    const pwm = w.newBlock('asa_analog_write');
    branch.getInput('ELSE')!.connection!.connect(pwm.previousConnection!);
    const tone = w.newBlock('asa_tone');
    input(tone, 'PIN', number('8'));
    append(branch, tone);
    append(tone, w.newBlock('asa_play_note'));
    tone.getNextBlock()!.nextConnection!.connect(w.newBlock('asa_no_tone').previousConnection!);
    const generated = source();
    expect(modes(generated)).toHaveLength(20);
    expect(generated.split('void loop()')[1]).not.toContain('pinMode');
    expect(generated).toContain('analogWrite(3, 255);');
    expect(generated).toContain('analogWrite(5, 0);');
    expect(generated).toContain('analogWrite(6, 0);');
    expect(generated).toContain('tone(8, 440);');
  });

  it('includes fallback input roles and ignores disconnected input reporters', () => {
    const fallback = reading('asa_ir_read', '4');
    expect(source()).toContain('pinMode(4, INPUT);');
    w.newBlock('asa_loop');
    expect(activeArduinoGraph(w).active.has(fallback)).toBe(false);
    expect(source()).toContain('pinMode(4, OUTPUT);');
  });

  it('reports unresolved runtime inputs separately from provable constant expressions', () => {
    const setup = w.newBlock('asa_setup');
    const measurement = reading('asa_digital_read', '2');
    body(setup, measurement);
    const read = measurement.getInputTargetBlock('VALUE')!;
    const add = w.newBlock('asa_math_add');
    input(add, 'A', number('1'));
    input(add, 'B', number('1'));
    input(read, 'PIN', add);
    expect(arduinoPinSetup(activeArduinoGraph(w).blocks).inputs.has('2')).toBe(true);
    input(read, 'PIN', w.newBlock('asa_serial_read'));
    expect(arduinoPinSetup(activeArduinoGraph(w).blocks).unresolvedInputs).toEqual([
      'asa_digital_read.PIN',
    ]);
  });

  it('uses the explicit input list for runtime-dependent input ports without repeated modes', () => {
    const setup = w.newBlock('asa_setup');
    const measurement = reading('asa_digital_read', '2');
    body(setup, measurement);
    input(measurement.getInputTargetBlock('VALUE')!, 'PIN', w.newBlock('asa_serial_read'));
    applyArduinoBlockDefaults(w);
    const generated = generateArduinoCode(w, ['2', '14', 'A0', 'A5']);
    expect(generated).toContain('pinMode(2, INPUT);');
    expect(generated).toContain('pinMode(A0, INPUT);');
    expect(generated).toContain('pinMode(A5, INPUT);');
    expect(modes(generated)).toHaveLength(20);
    expect(generated.match(/Serial.read\(/g)).toHaveLength(1);
    expect(generated).not.toContain('pinMode(14,');
  });
});
