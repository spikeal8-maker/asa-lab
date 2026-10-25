/* @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as S from 'scratch-blocks';
import {
  parseElectronicsDocument,
  solveCircuit,
  type SchematicComponent,
} from '@asa-lab/electronics';
import {
  ARDUINO_PIN_INPUTS,
  ARDUINO_DIGITAL_PIN_OPTIONS,
  ARDUINO_PWM_PIN_OPTIONS,
} from '../arduino-pin-inputs';
import { ARDUINO_WORKSPACE_PLUGINS, arduinoBlockTooltip } from '../arduino-block-ui';
import {
  registerArduinoBlocks,
  generateArduinoCode,
  applyArduinoBlockDefaults,
  migrateLegacyArduinoWorkspaceState,
  toolboxForCategory,
} from '../arduino-blocks';

let w: S.Workspace;
beforeEach(() => {
  registerArduinoBlocks();
  S.Events.disable();
  w = new S.Workspace(new S.Options({ plugins: ARDUINO_WORKSPACE_PLUGINS }));
});
afterEach(() => {
  w.dispose();
  S.Events.enable();
});
function connect(block: S.Block, input: string, child: S.Block) {
  block.getInput(input)!.connection!.connect(child.outputConnection!);
}
function number(value: string) {
  const n = w.newBlock('asa_number');
  n.setFieldValue(value, 'VALUE');
  return n;
}
function variable(name: string) {
  const v = w.getVariableMap().createVariable(name);
  const get = w.newBlock('asa_var_get');
  get.setFieldValue(v.getId(), 'NAME');
  return get;
}
function assign(name: string, value: string) {
  const b = w.newBlock('asa_var_set');
  b.setFieldValue(w.getVariableMap().createVariable(name).getId(), 'NAME');
  connect(b, 'VALUE', number(value));
  return b;
}
function setPin(block: S.Block, value: string) {
  const p = w.newBlock('asa_pin');
  p.setFieldValue(value, 'VALUE');
  connect(block, 'PIN', p);
}
function run(extra: readonly SchematicComponent[] = [], connections: unknown[] = []) {
  const parsed = parseElectronicsDocument({
    schemaVersion: 2,
    components: [
      {
        id: 'uno',
        kind: 'visual',
        value: 5,
        position: { x: 0, y: 0 },
        componentTypeId: 'arduino-uno',
        pinIds: [
          ...Array.from({ length: 14 }, (_, i) => `d${i}`),
          ...Array.from({ length: 6 }, (_, i) => `a${i}`),
          'power-5v',
          'power-3v3',
          'power-gnd-1',
        ],
        stateProperties: { arduinoSource: generateArduinoCode(w) },
      },
      ...extra,
    ],
    connections,
  });
  if (!parsed.ok) throw new Error(parsed.message);
  const result = solveCircuit(parsed.document);
  expect(result.solved, `${JSON.stringify(result.diagnostics)}\n${generateArduinoCode(w)}`).toBe(
    true,
  );
  return result;
}

describe('Arduino replaceable pin menus', () => {
  it('restores the previously selected analog pin after removing a replacement expression', () => {
    const block = w.newBlock('asa_digital_write');
    applyArduinoBlockDefaults(w);
    block.getInputTargetBlock('PIN')!.setFieldValue('A5', 'VALUE');
    const math = w.newBlock('asa_math_add');
    connect(block, 'PIN', math);
    math.dispose();
    expect(block.getInputTargetBlock('PIN')!.getFieldValue('VALUE')).toBe('A5');
  });
  it('accepts Boolean reporters in every numeric argument offered by the palette', () => {
    for (const category of ['output', 'input', 'control', 'data', 'variables'] as const) {
      for (const item of toolboxForCategory(category, [{ id: 'v', name: 'x' }]).contents) {
        if (typeof item !== 'object' || item.kind !== 'block') continue;
        const block = w.newBlock((item as S.utils.toolbox.BlockInfo).type!);
        for (const input of block.inputList) {
          if (!input.connection?.getCheck()?.includes('Number')) continue;
          const condition = w.newBlock('asa_compare_eq');
          input.connection.connect(condition.outputConnection!);
          expect(input.connection.targetBlock()).toBe(condition);
          condition.dispose();
        }
      }
    }
  });
  it.each(Object.entries(ARDUINO_PIN_INPUTS))(
    '%s accepts number, variable, math and Boolean pin values',
    (type, inputs) => {
      for (const input of Object.keys(inputs)) {
        const block = w.newBlock(type);
        applyArduinoBlockDefaults(w);
        const shadow = block.getInputTargetBlock(input)!;
        expect(shadow.isShadow()).toBe(true);
        expect(shadow.getField('VALUE')).toBeInstanceOf(S.FieldDropdown);
        for (const child of [
          number('13'),
          variable('pin'),
          w.newBlock('asa_math_add'),
          w.newBlock('asa_compare_eq'),
        ]) {
          connect(block, input, child);
          expect(block.getInputTargetBlock(input)).toBe(child);
          child.dispose();
          expect(block.getInputTargetBlock(input)!.isShadow()).toBe(true);
        }
      }
    },
  );

  it('lists A0–A5 after 0–13 without inventing PWM pins', () => {
    expect(ARDUINO_DIGITAL_PIN_OPTIONS.map((option) => option[1])).toEqual([
      ...Array.from({ length: 14 }, (_, i) => String(i)),
      'A0',
      'A1',
      'A2',
      'A3',
      'A4',
      'A5',
    ]);
    expect(ARDUINO_PWM_PIN_OPTIONS.map((option) => option[1])).toEqual([
      '3',
      '5',
      '6',
      '9',
      '10',
      '11',
    ]);
  });

  it('converts Boolean/numeric values while preserving shapes and rejecting text in numeric slots', () => {
    const wait = w.newBlock('asa_wait');
    const condition = w.newBlock('asa_compare_eq');
    connect(wait, 'TIME', condition);
    expect(wait.getInput('TIME')!.connection!.getCheck()).toEqual(['Number']);
    expect(condition.getOutputShape()).toBe(S.OUTPUT_SHAPE_HEXAGONAL);
    const branch = w.newBlock('asa_if');
    connect(branch, 'CONDITION', number('1'));
    expect(branch.getInputTargetBlock('CONDITION')!.getOutputShape()).toBe(S.OUTPUT_SHAPE_ROUND);
    const text = w.newBlock('asa_text');
    expect(
      w.connectionChecker.doTypeChecks(wait.getInput('TIME')!.connection!, text.outputConnection!),
    ).toBe(false);
  });

  it('migrates every old pin field into a dropdown shadow and preserves saved connections', () => {
    for (const [type, pins] of Object.entries(ARDUINO_PIN_INPUTS)) {
      const fields = Object.fromEntries(
        Object.entries(pins).map(([name, reporter]) => [
          name,
          reporter === 'asa_analog_pin' ? 'A3' : reporter === 'asa_pwm_pin' ? '11' : '13',
        ]),
      );
      const state = { blocks: { blocks: [{ type, id: 'old', fields }] } };
      const migrated = migrateLegacyArduinoWorkspaceState(structuredClone(state));
      S.serialization.workspaces.load(migrated, w);
      applyArduinoBlockDefaults(w);
      const block = w.getBlockById('old')!;
      for (const [name, value] of Object.entries(fields))
        expect(block.getInputTargetBlock(name)!.getFieldValue('VALUE')).toBe(value);
      const saved = S.serialization.workspaces.save(w);
      w.clear();
      S.serialization.workspaces.load(
        migrateLegacyArduinoWorkspaceState(JSON.parse(JSON.stringify(saved))),
        w,
      );
      for (const [name, value] of Object.entries(fields))
        expect(w.getBlockById('old')!.getInputTargetBlock(name)!.getFieldValue('VALUE')).toBe(
          value,
        );
      w.clear();
    }
  });

  it('evaluates computed output pins after assignment and again when a variable changes', () => {
    const setup = w.newBlock('asa_setup'),
      first = assign('port', '13');
    setup.getInput('DO')!.connection!.connect(first.previousConnection!);
    const writeA = w.newBlock('asa_digital_write');
    first.nextConnection!.connect(writeA.previousConnection!);
    connect(writeA, 'PIN', variable('port'));
    connect(writeA, 'LEVEL', number('1'));
    const change = assign('port', '19');
    writeA.nextConnection!.connect(change.previousConnection!);
    const writeB = w.newBlock('asa_digital_write');
    change.nextConnection!.connect(writeB.previousConnection!);
    const sum = w.newBlock('asa_math_add');
    connect(sum, 'A', variable('port'));
    connect(sum, 'B', number('0'));
    connect(writeB, 'PIN', sum);
    connect(writeB, 'LEVEL', number('1'));
    const runtime = run().controllerState!.boards[0]!.runtime;
    expect(runtime.outputVoltages).toMatchObject({ d13: 5, a5: 5 });
    expect(runtime.pinModes).toMatchObject({ d13: 'OUTPUT', a5: 'OUTPUT' });
    expect(generateArduinoCode(w)).not.toContain('pinMode(port, OUTPUT);\n}');
  });

  it('drives twenty independent resistor/LED branches including A0–A5', () => {
    const setup = w.newBlock('asa_setup');
    let next = setup.getInput('DO')!.connection!;
    const components: SchematicComponent[] = [],
      connections: unknown[] = [];
    for (let i = 0; i < 20; i++) {
      const pin = i < 14 ? String(i) : `A${i - 14}`,
        terminal = i < 14 ? `d${i}` : `a${i - 14}`;
      const write = w.newBlock('asa_digital_write');
      setPin(write, pin);
      connect(write, 'LEVEL', number('1'));
      next.connect(write.previousConnection!);
      next = write.nextConnection!;
      components.push(
        {
          id: `r${i}`,
          kind: 'resistor',
          value: 1000,
          position: { x: i * 30, y: 0 },
          componentTypeId: 'resistor-axial',
          pinIds: ['lead-1', 'lead-2'],
        },
        {
          id: `led${i}`,
          kind: 'led',
          value: 2,
          position: { x: i * 30, y: 50 },
          componentTypeId: 'led-5mm',
          pinIds: ['anode', 'cathode'],
        },
      );
      connections.push(
        {
          id: `drive${i}`,
          from: { componentId: 'uno', terminal },
          to: { componentId: `r${i}`, terminal: 'lead-1' },
        },
        {
          id: `series${i}`,
          from: { componentId: `r${i}`, terminal: 'lead-2' },
          to: { componentId: `led${i}`, terminal: 'anode' },
        },
        {
          id: `ground${i}`,
          from: { componentId: `led${i}`, terminal: 'cathode' },
          to: { componentId: 'uno', terminal: 'power-gnd-1' },
        },
      );
    }
    const result = run(components, connections);
    for (let i = 0; i < 20; i++) {
      const led = result.components.find((c) => c.componentId === `led${i}`)!;
      expect(Math.abs(led.current)).toBeGreaterThan(0.001);
      expect(led.brightness).toBeGreaterThan(0);
    }
  });

  it('shares fixed and computed Servo pins, including the A0/14 alias', () => {
    const setup = w.newBlock('asa_setup'),
      first = assign('port', '14');
    setup.getInput('DO')!.connection!.connect(first.previousConnection!);
    const fixed = w.newBlock('asa_servo_write');
    setPin(fixed, 'A0');
    connect(fixed, 'ANGLE', number('25'));
    first.nextConnection!.connect(fixed.previousConnection!);
    const dynamic = w.newBlock('asa_servo_write');
    connect(dynamic, 'PIN', variable('port'));
    connect(dynamic, 'ANGLE', number('75'));
    fixed.nextConnection!.connect(dynamic.previousConnection!);
    const get = w.newBlock('asa_var_set');
    get.setFieldValue(w.getVariableMap().createVariable('angle').getId(), 'NAME');
    const read = w.newBlock('asa_servo_read');
    connect(read, 'PIN', variable('port'));
    connect(get, 'VALUE', read);
    dynamic.nextConnection!.connect(get.previousConnection!);
    const runtime = run().controllerState!.boards[0]!.runtime;
    expect(runtime.variables.angle).toBe(75);
    expect(Object.values(runtime.servo!.objects).filter((object) => object.attached)).toHaveLength(
      1,
    );
  });

  it('re-evaluates a computed Servo read in a while condition after its body changes the angle', () => {
    const setup = w.newBlock('asa_setup'),
      first = assign('port', '14');
    setup.getInput('DO')!.connection!.connect(first.previousConnection!);
    const start = w.newBlock('asa_servo_write');
    connect(start, 'PIN', variable('port'));
    connect(start, 'ANGLE', number('45'));
    first.nextConnection!.connect(start.previousConnection!);
    const loop = w.newBlock('asa_while'),
      comparison = w.newBlock('asa_compare_gt'),
      read = w.newBlock('asa_servo_read');
    connect(read, 'PIN', variable('port'));
    connect(comparison, 'A', read);
    connect(comparison, 'B', number('0'));
    connect(loop, 'CONDITION', comparison);
    start.nextConnection!.connect(loop.previousConnection!);
    const stop = w.newBlock('asa_servo_write');
    connect(stop, 'PIN', variable('port'));
    connect(stop, 'ANGLE', number('0'));
    loop.getInput('DO')!.connection!.connect(stop.previousConnection!);
    loop.nextConnection!.connect(w.newBlock('asa_wait').previousConnection!);
    applyArduinoBlockDefaults(w);
    const runtime = run().controllerState!.boards[0]!.runtime;
    expect(runtime.resumeAtMs).toBe(1000);
    expect(
      Object.values(runtime.servo!.objects)
        .filter((object) => object.attached)
        .map((object) => object.commandedAngle),
    ).toEqual([0]);
  });

  it('keeps pupil variables distinct from fixed and computed Servo objects', () => {
    const setup = w.newBlock('asa_setup');
    const first = assign('servo_14', '14');
    setup.getInput('DO')!.connection!.connect(first.previousConnection!);
    const fixed = w.newBlock('asa_servo_write');
    setPin(fixed, 'A0');
    connect(fixed, 'ANGLE', number('25'));
    first.nextConnection!.connect(fixed.previousConnection!);
    const dynamic = w.newBlock('asa_servo_write');
    connect(dynamic, 'PIN', variable('servo_14'));
    connect(dynamic, 'ANGLE', number('65'));
    fixed.nextConnection!.connect(dynamic.previousConnection!);
    const runtime = run().controllerState!.boards[0]!.runtime;
    expect(runtime.variables.servo_14).toBe(14);
    expect(
      Object.values(runtime.servo!.objects)
        .filter((o) => o.attached)
        .map((o) => o.commandedAngle),
    ).toEqual([65]);
  });

  it('reads a fixed Servo despite a pupil variable with the same object name', () => {
    const setup = w.newBlock('asa_setup'),
      first = assign('servo_14', '14');
    setup.getInput('DO')!.connection!.connect(first.previousConnection!);
    const write = w.newBlock('asa_servo_write');
    setPin(write, 'A0');
    connect(write, 'ANGLE', number('65'));
    first.nextConnection!.connect(write.previousConnection!);
    const result = assign('result', '0'),
      read = w.newBlock('asa_servo_read');
    setPin(read, 'A0');
    connect(result, 'VALUE', read);
    write.nextConnection!.connect(result.previousConnection!);
    expect(run().controllerState!.boards[0]!.runtime.variables.result).toBe(65);
  });

  it.each([
    ['asa_serial_print', 'TEXT'],
    ['asa_lcd_print', 'TEXT'],
    ['asa_rgb_write', 'R'],
  ])('generates nested computed Servo values in %s.%s', (type, slot) => {
    const setup = w.newBlock('asa_setup'),
      first = assign('port', '14');
    setup.getInput('DO')!.connection!.connect(first.previousConnection!);
    const output = w.newBlock(type),
      math = w.newBlock('asa_math_add'),
      read = w.newBlock('asa_servo_read');
    connect(read, 'PIN', variable('port'));
    connect(math, 'A', read);
    connect(math, 'B', number('1'));
    connect(output, slot, math);
    first.nextConnection!.connect(output.previousConnection!);
    applyArduinoBlockDefaults(w);
    expect(generateArduinoCode(w)).toContain('(asaServoReadValue0 + 1)');
  });

  it.each(['asa_repeat', 'asa_for'])('re-evaluates a computed Servo loop bound in %s', (type) => {
    const setup = w.newBlock('asa_setup'),
      first = assign('port', '14');
    setup.getInput('DO')!.connection!.connect(first.previousConnection!);
    const start = w.newBlock('asa_servo_write');
    connect(start, 'PIN', variable('port'));
    connect(start, 'ANGLE', number('3'));
    first.nextConnection!.connect(start.previousConnection!);
    const loop = w.newBlock(type),
      read = w.newBlock('asa_servo_read');
    connect(read, 'PIN', variable('port'));
    connect(loop, type === 'asa_repeat' ? 'COUNT' : 'TO', read);
    start.nextConnection!.connect(loop.previousConnection!);
    const count = w.newBlock('asa_var_change');
    count.setFieldValue(w.getVariableMap().createVariable('count').getId(), 'NAME');
    connect(count, 'VALUE', number('1'));
    loop.getInput('DO')!.connection!.connect(count.previousConnection!);
    const stop = w.newBlock('asa_servo_write');
    connect(stop, 'PIN', variable('port'));
    connect(stop, 'ANGLE', number('0'));
    count.nextConnection!.connect(stop.previousConnection!);
    applyArduinoBlockDefaults(w);
    expect(run().controllerState!.boards[0]!.runtime.variables.count).toBe(1);
  });

  it('evaluates a computed Servo for-step after the loop body', () => {
    const setup = w.newBlock('asa_setup'),
      first = assign('port', '14');
    setup.getInput('DO')!.connection!.connect(first.previousConnection!);
    const start = w.newBlock('asa_servo_write');
    connect(start, 'PIN', variable('port'));
    connect(start, 'ANGLE', number('1'));
    first.nextConnection!.connect(start.previousConnection!);
    const loop = w.newBlock('asa_for'),
      read = w.newBlock('asa_servo_read');
    connect(read, 'PIN', variable('port'));
    connect(loop, 'STEP', read);
    connect(loop, 'TO', number('3'));
    start.nextConnection!.connect(loop.previousConnection!);
    const count = w.newBlock('asa_var_change');
    count.setFieldValue(w.getVariableMap().createVariable('count').getId(), 'NAME');
    connect(count, 'VALUE', number('1'));
    loop.getInput('DO')!.connection!.connect(count.previousConnection!);
    const change = w.newBlock('asa_servo_write');
    connect(change, 'PIN', variable('port'));
    connect(change, 'ANGLE', number('3'));
    count.nextConnection!.connect(change.previousConnection!);
    applyArduinoBlockDefaults(w);
    expect(run().controllerState!.boards[0]!.runtime.variables.count).toBe(1);
  });

  it('defers computed LCD wiring and consistently reserves peripheral object names', () => {
    for (const name of ['lcd', 'pixels', 'display_1']) variable(name);
    const setup = w.newBlock('asa_setup');
    const lcd = w.newBlock('asa_lcd_setup');
    connect(lcd, 'RS', variable('lcd'));
    setup.getInput('DO')!.connection!.connect(lcd.previousConnection!);
    const print = w.newBlock('asa_lcd_print');
    lcd.nextConnection!.connect(print.previousConnection!);
    const pixels = w.newBlock('asa_neopixel_setup');
    connect(pixels, 'PIN', variable('pixels'));
    print.nextConnection!.connect(pixels.previousConnection!);
    const color = w.newBlock('asa_neopixel_set');
    pixels.nextConnection!.connect(color.previousConnection!);
    const display = w.newBlock('asa_7seg_print');
    color.nextConnection!.connect(display.previousConnection!);
    connect(display, 'VALUE', variable('display_1'));
    applyArduinoBlockDefaults(w);
    const source = generateArduinoCode(w);
    expect(source).toContain('LiquidCrystal *lcd_1 = nullptr;');
    expect(source).toContain('static LiquidCrystal asaLcdObject(');
    expect(source).toContain('lcd_1 = &asaLcdObject;');
    expect(source).toContain('lcd_1->print(');
    expect(source).not.toContain('LiquidCrystal lcd(0, 0, 0, 0, 0, 0)');
    expect(source).toContain('pixels_1.setPin(pixels);');
    expect(source).toContain('pixels_1.Color(');
    expect(source).toContain('display_1_1.print(');
  });

  it('provides educational purpose-only help for every offered block, including gray blocks', () => {
    for (const category of [
      'output',
      'input',
      'data',
      'control',
      'variables',
      'comment',
    ] as const) {
      for (const item of toolboxForCategory(category, [{ id: 'v', name: 'x' }]).contents) {
        if (typeof item !== 'object' || item.kind !== 'block') continue;
        const type = (item as S.utils.toolbox.BlockInfo).type!;
        const tooltip = arduinoBlockTooltip(type);
        expect(tooltip.length).toBeGreaterThan(15);
        expect(tooltip).not.toMatch(
          /ограничени|рантайм|canonical|bounded|подмножество|Пока не работает/i,
        );
        expect(w.newBlock(type).tooltip).toBe(tooltip);
      }
    }
  });
});
