import * as ScratchBlocks from 'scratch-blocks';
import {
  applyArduinoBlockDefaults,
  generateArduinoCode,
  registerArduinoBlocks,
} from '../electronics/arduino-blocks';

export type RoboticsProgramPresetId = 'safe-rover' | 'turn-left' | 'push-one-shot';

export const DEFAULT_ROBOTICS_PROGRAM_PRESET_ID: RoboticsProgramPresetId = 'safe-rover';

export interface RoboticsProgramPresetMetadata {
  readonly id: RoboticsProgramPresetId;
  readonly label: string;
  readonly description: string;
}

export const ROBOTICS_PROGRAM_PRESETS: readonly RoboticsProgramPresetMetadata[] = [
  {
    id: 'safe-rover',
    label: 'Движение с датчиком',
    description:
      'Движение до препятствия и команды F/L/R/S через Serial. Во время измерения приводы отключены.',
  },
  {
    id: 'turn-left',
    label: 'Поворот налево',
    description:
      'Правый двигатель включается на 500 мс, затем оба привода отключаются. Угол зависит от робота.',
  },
  {
    id: 'push-one-shot',
    label: 'Толкнуть мяч',
    description:
      'Оба двигателя включаются один раз на 800 мс. Программа не использует сонар; для опыта установите датчик сбоку и направьте наружу.',
  },
];

export interface RoboticsPresetProgram {
  readonly mode: 'blocks';
  readonly workspaceJson: string;
  readonly source: string;
  readonly inputPins: readonly string[];
}

type Block = ScratchBlocks.Block;

/** Builds only the existing editor's blocks; their canonical generator owns C++. */
function populateWorkspace(workspace: ScratchBlocks.Workspace, id: RoboticsProgramPresetId): void {
  let nextId = 0;
  const block = (type: string): Block => workspace.newBlock(type, `robotics-${id}-${++nextId}`);

  const input = (parent: Block, name: string, child: Block): void => {
    const socket = parent.getInput(name)?.connection;
    if (!socket || !child.outputConnection)
      throw new Error(`Не удалось соединить блок ${parent.type}.${name}.`);
    socket.connect(child.outputConnection);
    if (parent.getInputTargetBlock(name) !== child)
      throw new Error(`Несовместимый блок ${parent.type}.${name}.`);
  };

  const body = (parent: Block, name: string, statements: readonly Block[]): void => {
    let connection = parent.getInput(name)?.connection ?? null;
    if (!connection) throw new Error(`У блока ${parent.type} нет последовательности ${name}.`);
    for (const statement of statements) {
      if (!connection || !statement.previousConnection)
        throw new Error('Не удалось соединить команды роботного примера.');
      connection.connect(statement.previousConnection);
      connection = statement.nextConnection;
    }
  };

  const literal = (type: string, field: string, value: string): Block => {
    const result = block(type);
    result.setFieldValue(value, field);
    result.setShadow(true);
    return result;
  };
  const number = (value: number): Block => literal('asa_number', 'VALUE', String(value));

  const comment = (text: string): Block => {
    const result = block('asa_comment');
    result.setFieldValue(text, 'TEXT');
    return result;
  };

  const write = (pin: number, high: boolean): Block => {
    const result = block('asa_digital_write');
    input(result, 'PIN', literal('asa_pin', 'VALUE', String(pin)));
    input(result, 'LEVEL', literal('asa_level', 'LEVEL', high ? 'HIGH' : 'LOW'));
    return result;
  };
  const motors = (left: boolean, right: boolean): readonly Block[] => [
    write(5, left),
    write(6, right),
  ];

  const wait = (amount: number, unit: 'MILLISECONDS' | 'MICROSECONDS'): Block => {
    const result = block('asa_wait');
    result.setFieldValue(unit, 'UNIT');
    input(result, 'TIME', number(amount));
    return result;
  };

  const setup = block('asa_setup');
  const loop = block('asa_loop');
  setup.moveBy(340, 80);
  loop.moveBy(340, id === 'safe-rover' ? 600 : 570);

  if (id !== 'safe-rover') {
    body(setup, 'DO', [
      comment('Один импульс при запуске'),
      ...motors(false, false),
      ...motors(id === 'push-one-shot', true),
      wait(id === 'push-one-shot' ? 800 : 500, 'MILLISECONDS'),
      ...motors(false, false),
    ]);
    body(loop, 'DO', [wait(50, 'MILLISECONDS')]);
    return;
  }

  const variables = new Map(
    ['command', 'safeStopEchoUs', 'duration'].map((name) => [
      name,
      workspace
        .getVariableMap()
        .createVariable(name, ScratchBlocks.SCALAR_VARIABLE_TYPE, `robotics-${id}-${name}`)
        .getId(),
    ]),
  );
  const variable = (name: string): Block => {
    const result = block('asa_var_get');
    result.setFieldValue(variables.get(name)!, 'NAME');
    return result;
  };
  const setVariable = (name: string, value: Block): Block => {
    const result = block('asa_var_set');
    result.setFieldValue(variables.get(name)!, 'NAME');
    input(result, 'VALUE', value);
    return result;
  };
  const binary = (type: string, a: Block, b: Block): Block => {
    const result = block(type);
    input(result, 'A', a);
    input(result, 'B', b);
    return result;
  };
  const branch = (condition: Block, yes: readonly Block[], no?: readonly Block[]): Block => {
    const result = block(no ? 'asa_if_else' : 'asa_if');
    input(result, 'CONDITION', condition);
    body(result, 'DO', yes);
    if (no) body(result, 'ELSE', no);
    return result;
  };
  const commandIs = (ascii: number): Block =>
    binary('asa_compare_eq', variable('command'), number(ascii));

  body(setup, 'DO', [
    comment('Serial: F70 / L76 / R82 / S83'),
    setVariable('command', number(70)),
    setVariable('safeStopEchoUs', number(3480)),
    setVariable('duration', number(0)),
    ...motors(false, false),
  ]);

  const pulse = block('asa_pulse_in');
  input(pulse, 'PIN', literal('asa_pin', 'VALUE', '2'));
  input(pulse, 'LEVEL', literal('asa_level', 'LEVEL', 'HIGH'));

  const serialOutput = block('asa_serial_print');
  serialOutput.setFieldValue('LINE', 'ENDING');
  input(serialOutput, 'TEXT', variable('duration'));

  // The shared block emits pulseIn(pin, level), whose timeout is one second.
  // Unlike the M0 text sketch's 30 ms timeout, missing echo must not keep the
  // previous drive powered during that wait. Existing saved sketches are untouched.
  body(loop, 'DO', [
    comment('Выбег до измерения. Тайм-аут 1 с.'),
    ...motors(false, false),
    write(13, false),
    wait(2, 'MICROSECONDS'),
    write(13, true),
    wait(10, 'MICROSECONDS'),
    write(13, false),
    setVariable('duration', pulse),
    branch(binary('asa_compare_gt', block('asa_serial_available'), number(0)), [
      setVariable('command', block('asa_serial_read')),
    ]),
    branch(commandIs(76), motors(false, true), [
      branch(commandIs(82), motors(true, false), [
        branch(
          binary(
            'asa_logic_and',
            commandIs(70),
            binary('asa_compare_gt', variable('duration'), variable('safeStopEchoUs')),
          ),
          motors(true, true),
          motors(false, false),
        ),
      ]),
    ]),
    serialOutput,
    wait(50, 'MILLISECONDS'),
  ]);
}

/** Pure preset data: no active editor, circuit, storage or simulation is modified. */
export function createRoboticsProgramPreset(id: RoboticsProgramPresetId): RoboticsPresetProgram {
  if (!ROBOTICS_PROGRAM_PRESETS.some((preset) => preset.id === id))
    throw new Error('Неизвестный роботный пример программы.');
  registerArduinoBlocks();
  const workspace = new ScratchBlocks.Workspace();
  ScratchBlocks.Events.disable();
  try {
    populateWorkspace(workspace, id);
    applyArduinoBlockDefaults(workspace);
    // HC-SR04 ECHO stays an input even in a one-shot sketch that does not read it.
    const inputPins = ['2'];
    return {
      mode: 'blocks',
      workspaceJson: JSON.stringify(ScratchBlocks.serialization.workspaces.save(workspace)),
      source: generateArduinoCode(workspace, inputPins),
      inputPins,
    };
  } finally {
    workspace.dispose();
    ScratchBlocks.Events.enable();
  }
}
