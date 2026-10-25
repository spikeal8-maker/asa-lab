/* @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as ScratchBlocks from 'scratch-blocks';
import { parseElectronicsDocument, solveCircuit } from '@asa-lab/electronics';
import {
  applyArduinoBlockDefaults,
  generateArduinoCode,
  migrateLegacyArduinoWorkspaceState,
  registerArduinoBlocks,
  toolboxForCategory,
} from '../arduino-blocks';

const sockets: Record<string, string[]> = {
  asa_wait: ['TIME'],
  asa_repeat: ['COUNT'],
  asa_for: ['STEP', 'FROM', 'TO'],
  asa_builtin_led: ['LEVEL'],
  asa_digital_write: ['LEVEL'],
  asa_pulse_in: ['LEVEL'],
  asa_analog_write: ['VALUE'],
  asa_servo_write: ['ANGLE'],
  asa_tone: ['FREQUENCY'],
  asa_play_note: ['FREQUENCY', 'DURATION'],
  asa_serial_print: ['TEXT'],
  asa_lcd_print: ['TEXT'],
  asa_rgb_write: ['R', 'G', 'B'],
  asa_lcd_cursor: ['COLUMN', 'ROW'],
  asa_7seg_print: ['VALUE'],
  asa_neopixel_set: ['INDEX', 'R', 'G', 'B'],
  asa_random: ['MIN', 'MAX'],
  asa_map: ['VALUE', 'FROM_LOW', 'FROM_HIGH', 'TO_LOW', 'TO_HIGH'],
  asa_constrain: ['VALUE', 'MIN', 'MAX'],
  asa_var_set: ['VALUE'],
  asa_var_change: ['VALUE'],
  asa_math_add: ['A', 'B'],
  asa_math_minus: ['A', 'B'],
  asa_math_multiply: ['A', 'B'],
  asa_math_divide: ['A', 'B'],
  asa_math_modulo: ['A', 'B'],
  asa_abs: ['VALUE'],
};
let workspace: ScratchBlocks.Workspace;
beforeEach(() => {
  registerArduinoBlocks();
  ScratchBlocks.Events.disable();
  workspace = new ScratchBlocks.Workspace();
});
afterEach(() => {
  workspace.dispose();
  ScratchBlocks.Events.enable();
});

function reporter(type: string, value = '7') {
  const block = workspace.newBlock(type);
  if (type === 'asa_number') block.setFieldValue(value, 'VALUE');
  if (type === 'asa_var_get') {
    const variable = workspace.getVariableMap().createVariable('sensor');
    block.setFieldValue(variable.getId(), 'NAME');
  }
  return block;
}
function attach(parent: ScratchBlocks.Block, name: string, child: ScratchBlocks.Block) {
  parent.getInput(name)!.connection!.connect(child.outputConnection!);
  expect(parent.getInputTargetBlock(name)).toBe(child);
}
function inLoop(block: ScratchBlocks.Block) {
  workspace.newBlock('asa_loop').getInput('DO')!.connection!.connect(block.previousConnection!);
}
function load(state: Record<string, unknown>) {
  ScratchBlocks.serialization.workspaces.load(migrateLegacyArduinoWorkspaceState(state), workspace);
  applyArduinoBlockDefaults(workspace);
}

function runGenerated() {
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
        pinIds: ['d13', 'power-5v', 'power-3v3', 'power-gnd-1'],
        stateProperties: { arduinoSource: generateArduinoCode(workspace) },
      },
    ],
  });
  if (!parsed.ok) throw new Error(parsed.message);
  const solved = solveCircuit(parsed.document);
  expect(solved.solved, JSON.stringify(solved.diagnostics)).toBe(true);
  return solved.controllerState!.boards[0]!.runtime;
}

function namedReporter(name: string) {
  const variable = workspace.getVariableMap().createVariable(name);
  const value = workspace.newBlock('asa_var_get');
  value.setFieldValue(variable.getId(), 'NAME');
  return value;
}

function initializeVariable(name: string, value: string) {
  const variable = workspace.getVariableMap().createVariable(name);
  const assignment = workspace.newBlock('asa_var_set');
  assignment.setFieldValue(variable.getId(), 'NAME');
  attach(assignment, 'VALUE', reporter('asa_number', value));
  workspace
    .newBlock('asa_setup')
    .getInput('DO')!
    .connection!.connect(assignment.previousConnection!);
}

function countBody(loop: ScratchBlocks.Block) {
  const variable = workspace.getVariableMap().createVariable('hits');
  const increment = workspace.newBlock('asa_var_change');
  increment.setFieldValue(variable.getId(), 'NAME');
  loop.getInput('DO')!.connection!.connect(increment.previousConnection!);
  loop.nextConnection!.connect(workspace.newBlock('asa_wait').previousConnection!);
  applyArduinoBlockDefaults(workspace);
}

describe('Arduino expression sockets', () => {
  it('executes repeat COUNT from a pupil variable named repeatIndex without capturing it', () => {
    initializeVariable('repeatIndex', '3');
    workspace.getVariableMap().createVariable('repeatIndex_1');
    const repeat = workspace.newBlock('asa_repeat');
    inLoop(repeat);
    attach(repeat, 'COUNT', namedReporter('repeatIndex'));
    countBody(repeat);
    expect(generateArduinoCode(workspace)).toContain(
      'for (int repeatIndex_2 = 0; repeatIndex_2 < repeatIndex; repeatIndex_2++)',
    );
    expect(runGenerated().variables).toMatchObject({ repeatIndex: 3, hits: 3 });
  });

  it.each([
    ['FROM', '3', '1', '5', '1', 3],
    ['TO', '3', '1', '5', '1', 3],
    ['STEP', '2', '0', '4', '1', 3],
  ] as const)(
    'executes %s using the outer i binding before declaring the loop counter',
    (input, initial, from, to, step, hits) => {
      initializeVariable('i', initial);
      const loop = workspace.newBlock('asa_for');
      inLoop(loop);
      loop.setFieldValue('i', 'NAME');
      attach(loop, 'FROM', reporter('asa_number', from));
      attach(loop, 'TO', reporter('asa_number', to));
      attach(loop, 'STEP', reporter('asa_number', step));
      loop.getInputTargetBlock(input)!.dispose();
      const sum = reporter('asa_math_add');
      attach(sum, 'A', namedReporter('i'));
      attach(sum, 'B', reporter('asa_number', '0'));
      attach(loop, input, sum);
      countBody(loop);
      const source = generateArduinoCode(workspace);
      expect(source).toContain('float asaForOuterValue = i;');
      expect(source).toContain('(asaForOuterValue + 0)');
      expect(source).not.toContain('for (int i = i;');
      expect(runGenerated().variables).toMatchObject({ i: Number(initial), hits });
    },
  );

  it.each([
    ['asa_random', 'MIN', 'random(asaForOuterValue, 11)'],
    ['asa_map', 'FROM_LOW', 'map(0, asaForOuterValue, 1023, 0, 255)'],
    ['asa_constrain', 'MIN', 'constrain(0, asaForOuterValue, 255)'],
  ])('propagates the outer binding into nested %s argument sockets', (type, input, expected) => {
    const loop = workspace.newBlock('asa_for');
    inLoop(loop);
    loop.setFieldValue('i', 'NAME');
    const value = reporter(type);
    attach(value, input, namedReporter('i'));
    attach(loop, 'FROM', value);
    applyArduinoBlockDefaults(workspace);
    expect(generateArduinoCode(workspace)).toContain(expected);
  });
  it('does not shadow pupil variables or loop counters with the note-duration temporary', () => {
    const variable = workspace.getVariableMap().createVariable('asaNoteDurationMs');
    workspace.getVariableMap().createVariable('asaNoteDurationMs_1');
    const setup = workspace.newBlock('asa_setup');
    const assignment = workspace.newBlock('asa_var_set');
    assignment.setFieldValue(variable.getId(), 'NAME');
    attach(assignment, 'VALUE', reporter('asa_number', '440'));
    setup.getInput('DO')!.connection!.connect(assignment.previousConnection!);
    const loop = workspace.newBlock('asa_for');
    inLoop(loop);
    loop.setFieldValue('asaNoteDurationMs_2', 'NAME');
    const note = workspace.newBlock('asa_play_note');
    loop.getInput('DO')!.connection!.connect(note.previousConnection!);
    for (const input of ['DURATION', 'FREQUENCY']) {
      const value = workspace.newBlock('asa_var_get');
      value.setFieldValue(variable.getId(), 'NAME');
      attach(note, input, value);
    }
    applyArduinoBlockDefaults(workspace);
    const source = generateArduinoCode(workspace);
    expect(source).toContain('unsigned long asaNoteDurationMs_3 = (asaNoteDurationMs * 1000);');
    expect(source).toContain('tone(0, asaNoteDurationMs, asaNoteDurationMs_3);');
    expect(source).toContain('delay(asaNoteDurationMs_3);');
    expect(source).not.toContain('unsigned long asaNoteDurationMs =');
  });
  it('samples an expression for note duration once and preserves independent note scopes', () => {
    const note = workspace.newBlock('asa_play_note');
    inLoop(note);
    const random = reporter('asa_random');
    attach(note, 'DURATION', random);
    applyArduinoBlockDefaults(workspace);
    const source = generateArduinoCode(workspace);
    expect(source.match(/random\(/g)).toHaveLength(1);
    expect(source).toContain('unsigned long asaNoteDurationMs = (random(1, 11) * 1000);');
    expect(source).toContain('delay(asaNoteDurationMs);');
  });
  it('executes variable arithmetic through assignment, GPIO, serial and dynamic delay', () => {
    const setup = workspace.newBlock('asa_setup');
    const assign = workspace.newBlock('asa_var_set');
    const variable = workspace.getVariableMap().createVariable('sensor');
    assign.setFieldValue(variable.getId(), 'NAME');
    const sum = reporter('asa_math_add');
    attach(sum, 'A', reporter('asa_number', '2'));
    attach(sum, 'B', reporter('asa_number', '3'));
    attach(assign, 'VALUE', sum);
    setup.getInput('DO')!.connection!.connect(assign.previousConnection!);
    const write = workspace.newBlock('asa_digital_write');
    inLoop(write);
    attach(write, 'PIN', reporter('asa_number', '13'));
    attach(write, 'LEVEL', reporter('asa_var_get'));
    const print = workspace.newBlock('asa_serial_print');
    write.nextConnection!.connect(print.previousConnection!);
    attach(print, 'TEXT', reporter('asa_var_get'));
    const wait = workspace.newBlock('asa_wait');
    print.nextConnection!.connect(wait.previousConnection!);
    const divide = reporter('asa_math_divide');
    attach(divide, 'A', reporter('asa_var_get'));
    attach(divide, 'B', reporter('asa_number', '10'));
    attach(wait, 'TIME', divide);
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
          pinIds: ['d13', 'power-5v', 'power-3v3', 'power-gnd-1'],
          stateProperties: { arduinoSource: generateArduinoCode(workspace) },
        },
      ],
    });
    if (!parsed.ok) throw new Error(parsed.message);
    const solved = solveCircuit(parsed.document);
    expect(solved.solved, JSON.stringify(solved.diagnostics)).toBe(true);
    const runtime = solved.controllerState!.boards[0]!.runtime;
    expect(runtime.variables.sensor).toBe(5);
    expect(runtime.outputVoltages.d13).toBe(5);
    expect(runtime.resumeAtMs).toBeCloseTo(500, 5);
  });
  it.each(Object.entries(sockets))(
    '%s accepts variables and nested arithmetic in every value slot',
    (type, names) => {
      for (const name of names) {
        const block = workspace.newBlock(type);
        const variable = reporter('asa_var_get');
        attach(block, name, variable);
        variable.dispose();
        const sum = reporter('asa_math_add');
        attach(sum, 'A', reporter('asa_var_get'));
        attach(sum, 'B', reporter('asa_number'));
        attach(block, name, sum);
      }
    },
  );

  it('uses round number/text/variable reporters and hexagonal conditions', () => {
    for (const type of [
      'asa_number',
      'asa_text',
      'asa_var_get',
      'asa_math_add',
      'asa_random',
      'asa_map',
    ]) {
      expect(reporter(type).getOutputShape()).toBe(ScratchBlocks.OUTPUT_SHAPE_ROUND);
    }
    for (const type of ['asa_compare_eq', 'asa_logic_not', 'asa_level', 'asa_digital_read']) {
      expect(reporter(type).getOutputShape()).toBe(ScratchBlocks.OUTPUT_SHAPE_HEXAGONAL);
    }
    const wait = workspace.newBlock('asa_wait');
    expect(wait.getInput('TIME')!.connection!.getCheck()).toEqual(['Number']);
    expect(workspace.newBlock('asa_if').getInput('CONDITION')!.connection!.getCheck()).toEqual([
      'Boolean',
    ]);
    expect(workspace.newBlock('asa_neopixel_setup').getInput('COUNT')).not.toBeNull();
    expect(workspace.newBlock('asa_comment').getField('TEXT')).not.toBeNull();
  });

  it('generates dynamic delay, loop bounds, output levels and serial expressions', () => {
    const wait = workspace.newBlock('asa_wait');
    inLoop(wait);
    const sum = reporter('asa_math_add');
    attach(sum, 'A', reporter('asa_var_get'));
    attach(sum, 'B', reporter('asa_number'));
    attach(wait, 'TIME', sum);
    const print = workspace.newBlock('asa_serial_print');
    wait.nextConnection!.connect(print.previousConnection!);
    attach(print, 'TEXT', reporter('asa_var_get'));
    const write = workspace.newBlock('asa_digital_write');
    print.nextConnection!.connect(write.previousConnection!);
    attach(write, 'LEVEL', reporter('asa_math_multiply'));
    expect(generateArduinoCode(workspace)).toContain('delay(((sensor + 7) * 1000));');
    expect(generateArduinoCode(workspace)).toContain('Serial.println(sensor);');
    expect(generateArduinoCode(workspace)).toContain('digitalWrite(0, (0 * 0));');
    wait.setFieldValue('MICROSECONDS', 'UNIT');
    expect(generateArduinoCode(workspace)).toContain('delayMicroseconds((sensor + 7));');
  });

  it('provides editable shadows for every flyout value and restores them after replacement', () => {
    for (const category of ['output', 'control', 'data', 'variables'] as const) {
      const toolbox = toolboxForCategory(category, [{ id: 'v', name: 'sensor' }]);
      for (const item of toolbox.contents) {
        if (typeof item !== 'object' || item.kind !== 'block') continue;
        const info = item as ScratchBlocks.utils.toolbox.BlockInfo;
        for (const name of sockets[info.type!] ?? []) {
          expect(info.inputs?.[name]?.shadow, `${info.type}.${name}`).toBeDefined();
          expect(info.fields?.[name]).toBeUndefined();
        }
      }
    }
    const wait = workspace.newBlock('asa_wait');
    applyArduinoBlockDefaults(workspace);
    expect(wait.getInputTargetBlock('TIME')!.isShadow()).toBe(true);
    attach(wait, 'TIME', reporter('asa_var_get'));
    wait.getInputTargetBlock('TIME')!.dispose();
    expect(wait.getInputTargetBlock('TIME')!.getFieldValue('VALUE')).toBe(1);
  });
});

describe('old Arduino workspace compatibility', () => {
  it('preserves empty conditions, original empty value sockets and deliberately empty text', () => {
    load({
      blocks: {
        blocks: [
          {
            type: 'asa_loop',
            inputs: {
              DO: {
                block: {
                  type: 'asa_if',
                  id: 'if',
                  inputs: {
                    DO: {
                      block: {
                        type: 'asa_serial_print',
                        fields: { TEXT: '' },
                      },
                    },
                  },
                  next: {
                    block: {
                      type: 'asa_var_set',
                      fields: { NAME: 'x' },
                      inputs: {
                        VALUE: { block: { type: 'asa_math_add', id: 'math' } },
                      },
                    },
                  },
                },
              },
            },
          },
        ],
      },
    });
    expect(workspace.getBlockById('if')!.getInputTargetBlock('CONDITION')).toBeNull();
    expect(workspace.getBlockById('math')!.getInputTargetBlock('A')).toBeNull();
    expect(generateArduinoCode(workspace)).toContain('if (0)');
    expect(generateArduinoCode(workspace)).toContain('Serial.println("");');
    expect(generateArduinoCode(workspace)).toContain('x = (0 + 0);');
  });
  it('preserves legacy values, IDs, positions, variable names and exact literal code after save/reopen', () => {
    const legacy: Record<string, unknown> = {
      blocks: {
        languageVersion: 0,
        blocks: [
          {
            type: 'asa_loop',
            id: 'loop',
            x: 330,
            y: 280,
            inputs: {
              DO: {
                block: {
                  type: 'asa_wait',
                  id: 'wait',
                  fields: { TIME: '0.125', UNIT: 'SECONDS' },
                  next: {
                    block: {
                      type: 'asa_serial_print',
                      id: 'print',
                      fields: { TEXT: 'a "quote"\nстрока', ENDING: 'LINE' },
                      next: {
                        block: {
                          type: 'asa_var_change',
                          id: 'change',
                          fields: { NAME: 'счётчик', VALUE: '-2.5' },
                          next: {
                            block: {
                              type: 'asa_servo_write',
                              id: 'servo',
                              fields: { PIN: '9', ANGLE: '90' },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        ],
      },
    };
    const migrated = migrateLegacyArduinoWorkspaceState(structuredClone(legacy));
    expect(migrateLegacyArduinoWorkspaceState(structuredClone(migrated))).toEqual(migrated);
    load(structuredClone(legacy));
    const code = generateArduinoCode(workspace);
    expect(code).toContain('delay(125);');
    expect(code).toContain('Serial.println("a \\"quote\\"\\nстрока");');
    expect(code).toContain('счётчик += -2.5;');
    expect(code).toContain('servo_9.write(90);');
    const saved = ScratchBlocks.serialization.workspaces.save(workspace);
    workspace.clear();
    load(JSON.parse(JSON.stringify(saved)));
    expect(generateArduinoCode(workspace)).toBe(code);
    expect(workspace.getBlockById('wait')!.getNextBlock()!.id).toBe('print');
    expect(workspace.getBlockById('loop')!.getRelativeToSurfaceXY()).toMatchObject({
      x: 330,
      y: 280,
    });
    expect(
      workspace
        .getVariableMap()
        .getAllVariables()
        .map((v) => v.getName()),
    ).toContain('счётчик');
  });

  it('migrates every converted literal and does not overwrite existing expressions', () => {
    for (const [type, names] of Object.entries(sockets)) {
      if (type.startsWith('asa_math_') || ['asa_abs', 'asa_var_set'].includes(type)) continue;
      const fields = Object.fromEntries(
        names.map((name) => [
          name,
          ['LEVEL'].includes(name) ? 'LOW' : name === 'TEXT' ? '' : '2.75',
        ]),
      );
      const state = migrateLegacyArduinoWorkspaceState({
        blocks: { blocks: [{ type, id: type, fields: { ...fields } }] },
      });
      const node = (
        state.blocks as {
          blocks: { fields: object; inputs: Record<string, { shadow: { fields: object } }> }[];
        }
      ).blocks[0]!;
      for (const name of names) {
        expect(node.inputs[name]!.shadow.fields).toEqual({
          [name === 'LEVEL' ? 'LEVEL' : 'VALUE']: fields[name],
        });
        expect(node.fields).not.toHaveProperty(name);
      }
    }
    const state = {
      blocks: {
        blocks: [
          {
            type: 'asa_wait',
            fields: { TIME: '99' },
            inputs: {
              TIME: {
                block: {
                  type: 'asa_math_add',
                  id: 'sum',
                  inputs: { A: { block: { type: 'asa_var_get', fields: { NAME: 'x' } } } },
                },
              },
            },
          },
        ],
      },
    };
    load(state);
    const sum = workspace.getBlockById('sum')!;
    expect(sum.getInputTargetBlock('A')!.type).toBe('asa_var_get');
    const code = generateArduinoCode(workspace);
    const saved = ScratchBlocks.serialization.workspaces.save(workspace);
    workspace.clear();
    load(JSON.parse(JSON.stringify(saved)));
    expect(workspace.getBlockById('sum')!.getInputTargetBlock('A')!.type).toBe('asa_var_get');
    expect(generateArduinoCode(workspace)).toBe(code);
  });
});
