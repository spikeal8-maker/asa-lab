import { arduinoBlockTooltip, registerArduinoConnectionChecker } from './arduino-block-ui';
import {
  ARDUINO_DIGITAL_PIN_OPTIONS,
  ARDUINO_PWM_PIN_OPTIONS,
  ARDUINO_ANALOG_PIN_OPTIONS,
  ARDUINO_PIN_INPUTS,
  literalArduinoPin,
  literalArduinoServoPin,
  dynamicArduinoServoSource,
  dynamicArduinoServoWriteSource,
  dynamicArduinoServoReadSource,
  fixedArduinoServoPins,
  activeArduinoGraph,
  type ArduinoPinReporter,
} from './arduino-pin-inputs';
import * as ScratchBlocks from 'scratch-blocks';
import { arduinoBlockSupport } from '@asa-lab/electronics';

export type ArduinoBlockCategory =
  'output' | 'input' | 'comment' | 'control' | 'data' | 'variables';

export { readArduinoProgramState, DEFAULT_ARDUINO_SOURCE } from './arduino-program-state';
export type { ArduinoCodeMode, ArduinoProgramState } from './arduino-program-state';

export interface ArduinoVariableChoice {
  readonly id: string;
  readonly name: string;
}

export const ARDUINO_CREATE_VARIABLE_CALLBACK = 'CREATE_ARDUINO_VARIABLE';
export const ARDUINO_FLYOUT_HEADER_GAP = 98;

export function arduinoRenameVariableCallback(variableId: string): string {
  return `RENAME_ARDUINO_VARIABLE:${variableId}`;
}

export function arduinoDeleteVariableCallback(variableId: string): string {
  return `DELETE_ARDUINO_VARIABLE:${variableId}`;
}

const DIGITAL_PINS = ARDUINO_DIGITAL_PIN_OPTIONS;
const PWM_PINS = ARDUINO_PWM_PIN_OPTIONS;
const ANALOG_PINS = ARDUINO_ANALOG_PIN_OPTIONS;
const LEVELS = [
  ['ВЫСОКИЙ', 'HIGH'],
  ['НИЗКИЙ', 'LOW'],
];

const OUTPUT = '#4c97ff';
const INPUT = '#9966ff';
const COMMENT = '#8e8e8e';
const CONTROL = '#ffab19';
const DATA = '#40bf4a';
const VARIABLES = '#cf63cf';
const UNSUPPORTED_BLOCK = '#59636b';

let registered = false;

export function registerArduinoBlocks(): void {
  // ScratchBlocks exports its translations without activating a locale. Its
  // built-in menus call message.replace(), so initialise them before injection
  // (including remounts where the Arduino block definitions already exist).
  ScratchBlocks.ScratchMsgs.setLocale('ru');
  registerArduinoConnectionChecker();
  if (registered) return;
  registered = true;
  const definitions: Record<string, unknown>[] = [
    ...[
      ['asa_pin', DIGITAL_PINS],
      ['asa_pwm_pin', PWM_PINS],
      ['asa_analog_pin', ANALOG_PINS],
    ].map(([type, options]) => ({
      type,
      message0: '%1',
      args0: [{ type: 'field_dropdown', name: 'VALUE', options }],
      output: 'Number',
      colour: DATA,
    })),
    {
      type: 'asa_setup',
      message0: 'в начале',
      message1: '%1',
      args1: [{ type: 'input_statement', name: 'DO' }],
      colour: CONTROL,
      extensions: ['shape_hat'],
      tooltip: 'Команды, которые выполняются один раз при включении Arduino.',
    },
    {
      type: 'asa_loop',
      message0: 'долгое время',
      message1: '%1',
      args1: [{ type: 'input_statement', name: 'DO' }],
      colour: CONTROL,
      extensions: ['shape_hat'],
      tooltip: 'Команды, которые Arduino повторяет непрерывно.',
    },
    {
      type: 'asa_wait',
      message0: 'ожидать %1 %2',
      args0: [
        { type: 'input_value', name: 'TIME', check: 'Number' },
        {
          type: 'field_dropdown',
          name: 'UNIT',
          options: [
            ['с', 'SECONDS'],
            ['мс', 'MILLISECONDS'],
            ['мкс', 'MICROSECONDS'],
          ],
        },
      ],
      previousStatement: null,
      nextStatement: null,
      colour: CONTROL,
      tooltip: 'Приостанавливает программу на указанное время.',
    },
    {
      type: 'asa_repeat',
      message0: 'повторить %1 раз',
      args0: [{ type: 'input_value', name: 'COUNT', check: 'Number' }],
      message1: '%1',
      args1: [{ type: 'input_statement', name: 'DO' }],
      previousStatement: null,
      nextStatement: null,
      colour: CONTROL,
    },
    {
      type: 'asa_forever',
      message0: 'повторять всегда',
      message1: '%1',
      args1: [{ type: 'input_statement', name: 'DO' }],
      previousStatement: null,
      colour: CONTROL,
    },
    {
      type: 'asa_if',
      message0: 'если %1 то',
      args0: [{ type: 'input_value', name: 'CONDITION', check: 'Boolean' }],
      message1: '%1',
      args1: [{ type: 'input_statement', name: 'DO' }],
      previousStatement: null,
      nextStatement: null,
      colour: CONTROL,
    },
    {
      type: 'asa_if_else',
      message0: 'если %1 то',
      args0: [{ type: 'input_value', name: 'CONDITION', check: 'Boolean' }],
      message1: '%1',
      args1: [{ type: 'input_statement', name: 'DO' }],
      message2: 'иначе',
      message3: '%1',
      args3: [{ type: 'input_statement', name: 'ELSE' }],
      previousStatement: null,
      nextStatement: null,
      colour: CONTROL,
    },
    {
      type: 'asa_while',
      message0: 'пока %1',
      args0: [{ type: 'input_value', name: 'CONDITION', check: 'Boolean' }],
      message1: '%1',
      args1: [{ type: 'input_statement', name: 'DO' }],
      previousStatement: null,
      nextStatement: null,
      colour: CONTROL,
    },
    {
      type: 'asa_for',
      message0: 'считать %1 по %2 для %3 с %4 до %5 делать',
      args0: [
        {
          type: 'field_dropdown',
          name: 'DIRECTION',
          options: [
            ['вверх', 'UP'],
            ['вниз', 'DOWN'],
          ],
        },
        { type: 'input_value', name: 'STEP', check: 'Number' },
        { type: 'field_input', name: 'NAME', text: 'i' },
        { type: 'input_value', name: 'FROM', check: 'Number' },
        { type: 'input_value', name: 'TO', check: 'Number' },
      ],
      message1: '%1',
      args1: [{ type: 'input_statement', name: 'DO' }],
      previousStatement: null,
      nextStatement: null,
      colour: CONTROL,
    },
    {
      type: 'asa_builtin_led',
      message0: 'назначить встроенный светодиод на %1',
      args0: [{ type: 'input_value', name: 'LEVEL' }],
      previousStatement: null,
      nextStatement: null,
      colour: OUTPUT,
    },
    {
      type: 'asa_digital_write',
      message0: 'назначить вывод %1 на %2',
      args0: [
        { type: 'field_dropdown', name: 'PIN', options: DIGITAL_PINS },
        { type: 'input_value', name: 'LEVEL' },
      ],
      previousStatement: null,
      nextStatement: null,
      colour: OUTPUT,
    },
    {
      type: 'asa_analog_write',
      message0: 'назначить ШИМ-вывод %1 на %2',
      args0: [
        { type: 'field_dropdown', name: 'PIN', options: PWM_PINS },
        { type: 'input_value', name: 'VALUE', check: 'Number' },
      ],
      previousStatement: null,
      nextStatement: null,
      colour: OUTPUT,
    },
    {
      type: 'asa_servo_write',
      message0: 'повернуть сервопривод на выводе %1 на %2°',
      args0: [
        { type: 'field_dropdown', name: 'PIN', options: DIGITAL_PINS },
        { type: 'input_value', name: 'ANGLE', check: 'Number' },
      ],
      previousStatement: null,
      nextStatement: null,
      colour: OUTPUT,
    },
    {
      type: 'asa_tone',
      message0: 'воспроизвести %1 Гц на выводе %2',
      args0: [
        { type: 'input_value', name: 'FREQUENCY', check: 'Number' },
        { type: 'field_dropdown', name: 'PIN', options: DIGITAL_PINS },
      ],
      previousStatement: null,
      nextStatement: null,
      colour: OUTPUT,
    },
    {
      type: 'asa_play_note',
      message0: 'воспроизвести запись на выводе %1',
      args0: [{ type: 'field_dropdown', name: 'PIN', options: DIGITAL_PINS }],
      message1: 'с тоном %1 Гц в течение %2 с',
      args1: [
        { type: 'input_value', name: 'FREQUENCY', check: 'Number' },
        { type: 'input_value', name: 'DURATION', check: 'Number' },
      ],
      previousStatement: null,
      nextStatement: null,
      colour: OUTPUT,
    },
    {
      type: 'asa_no_tone',
      message0: 'выключить динамик на выводе %1',
      args0: [{ type: 'field_dropdown', name: 'PIN', options: DIGITAL_PINS }],
      previousStatement: null,
      nextStatement: null,
      colour: OUTPUT,
    },
    {
      type: 'asa_serial_print',
      message0: 'вывести на монитор %1 %2',
      args0: [
        { type: 'input_value', name: 'TEXT' },
        {
          type: 'field_dropdown',
          name: 'ENDING',
          options: [
            ['с новой строки', 'LINE'],
            ['без переноса', 'NONE'],
          ],
        },
      ],
      previousStatement: null,
      nextStatement: null,
      colour: OUTPUT,
    },
    {
      type: 'asa_rgb_write',
      inputsInline: true,
      message0: 'RGB: выводы R %1 G %2 B %3 %4',
      args0: [
        { type: 'field_dropdown', name: 'R_PIN', options: PWM_PINS },
        { type: 'field_dropdown', name: 'G_PIN', options: PWM_PINS },
        { type: 'field_dropdown', name: 'B_PIN', options: PWM_PINS },
        { type: 'input_end_row' },
      ],
      message1: 'яркость R %1 G %2 B %3',
      args1: [
        { type: 'input_value', name: 'R', check: 'Number' },
        { type: 'input_value', name: 'G', check: 'Number' },
        { type: 'input_value', name: 'B', check: 'Number' },
      ],
      previousStatement: null,
      nextStatement: null,
      colour: OUTPUT,
    },
    {
      type: 'asa_lcd_setup',
      message0: 'настроить ЖК-экран: RS %1 E %2 D4 %3',
      args0: ['RS', 'E', 'D4'].map((name, index) => ({
        type: 'field_dropdown',
        name,
        options: DIGITAL_PINS,
        value: String([12, 11, 5, 4, 3, 2][index]),
      })),
      message1: 'D5 %1 D6 %2 D7 %3',
      args1: ['D5', 'D6', 'D7'].map((name, index) => ({
        type: 'field_dropdown',
        name,
        options: DIGITAL_PINS,
        value: String([4, 3, 2][index]),
      })),
      previousStatement: null,
      nextStatement: null,
      colour: OUTPUT,
    },
    {
      type: 'asa_lcd_print',
      message0: 'печатать на ЖК-экран %1',
      args0: [{ type: 'input_value', name: 'TEXT' }],
      previousStatement: null,
      nextStatement: null,
      colour: OUTPUT,
    },
    {
      type: 'asa_lcd_cursor',
      message0: 'задать положение на ЖК-экране столбец %1 строка %2',
      args0: [
        { type: 'input_value', name: 'COLUMN', check: 'Number' },
        { type: 'input_value', name: 'ROW', check: 'Number' },
      ],
      previousStatement: null,
      nextStatement: null,
      colour: OUTPUT,
    },
    {
      type: 'asa_lcd_clear',
      message0: 'на ЖК-экране очистить экран',
      previousStatement: null,
      nextStatement: null,
      colour: OUTPUT,
    },
    {
      type: 'asa_lcd_i2c_setup',
      message0: 'настроить тип ЖК-экрана %1',
      args0: [
        {
          type: 'field_dropdown',
          name: 'SIZE',
          options: [
            ['16 × 2', '16X2'],
            ['20 × 4', '20X4'],
          ],
        },
      ],
      message1: 'для I2C с адресом %1',
      args1: [
        {
          type: 'field_dropdown',
          name: 'ADDRESS',
          options: [
            ['32 (0x20)', '0x20'],
            ['39 (0x27)', '0x27'],
            ['63 (0x3F)', '0x3F'],
          ],
        },
      ],
      previousStatement: null,
      nextStatement: null,
      colour: OUTPUT,
    },
    {
      type: 'asa_7seg_setup',
      message0: 'настроить тип светодиодного экрана %1',
      args0: [
        {
          type: 'field_dropdown',
          name: 'DISPLAY',
          options: [
            ['1', '1'],
            ['2', '2'],
          ],
        },
      ],
      message1: 'для 7-сегментных часов с адресом %1',
      args1: [
        {
          type: 'field_dropdown',
          name: 'ADDRESS',
          options: [
            ['112 (0x70)', '0x70'],
            ['113 (0x71)', '0x71'],
            ['114 (0x72)', '0x72'],
          ],
        },
      ],
      previousStatement: null,
      nextStatement: null,
      colour: OUTPUT,
    },
    {
      type: 'asa_7seg_print',
      message0: 'печатать на светодиодный экран %1 значение %2',
      args0: [
        {
          type: 'field_dropdown',
          name: 'DISPLAY',
          options: [
            ['1', '1'],
            ['2', '2'],
          ],
        },
        { type: 'input_value', name: 'VALUE', check: 'Number' },
      ],
      previousStatement: null,
      nextStatement: null,
      colour: OUTPUT,
    },
    {
      type: 'asa_7seg_clear',
      message0: 'на светодиодном экране %1 очистить экран',
      args0: [
        {
          type: 'field_dropdown',
          name: 'DISPLAY',
          options: [
            ['1', '1'],
            ['2', '2'],
          ],
        },
      ],
      previousStatement: null,
      nextStatement: null,
      colour: OUTPUT,
    },
    {
      type: 'asa_neopixel_setup',
      message0: 'настроить светодиодную ленту',
      message1: 'вывод %1 светодиодов %2',
      args1: [
        { type: 'field_dropdown', name: 'PIN', options: DIGITAL_PINS },
        { type: 'input_value', name: 'COUNT', check: 'Number' },
      ],
      previousStatement: null,
      nextStatement: null,
      colour: OUTPUT,
    },
    {
      type: 'asa_neopixel_set',
      message0: 'светодиод %1 установить R %2 G %3 B %4',
      args0: [
        { type: 'input_value', name: 'INDEX', check: 'Number' },
        { type: 'input_value', name: 'R', check: 'Number' },
        { type: 'input_value', name: 'G', check: 'Number' },
        { type: 'input_value', name: 'B', check: 'Number' },
      ],
      previousStatement: null,
      nextStatement: null,
      colour: OUTPUT,
    },
    {
      type: 'asa_digital_read',
      message0: 'считать цифровой вывод %1',
      args0: [{ type: 'field_dropdown', name: 'PIN', options: DIGITAL_PINS }],
      output: 'Boolean',
      colour: INPUT,
    },
    {
      type: 'asa_analog_read',
      message0: 'считать аналоговый вывод %1',
      args0: [{ type: 'field_dropdown', name: 'PIN', options: ANALOG_PINS }],
      output: 'Number',
      colour: INPUT,
    },
    {
      type: 'asa_ultrasonic',
      message0: 'расстояние, см: триггер %1 эхо %2',
      args0: [
        { type: 'field_dropdown', name: 'TRIG', options: DIGITAL_PINS },
        { type: 'field_dropdown', name: 'ECHO', options: DIGITAL_PINS },
      ],
      output: 'Number',
      colour: INPUT,
    },
    {
      type: 'asa_pulse_in',
      message0: 'длительность импульса на выводе %1 уровня %2',
      args0: [
        { type: 'field_dropdown', name: 'PIN', options: DIGITAL_PINS },
        { type: 'input_value', name: 'LEVEL' },
      ],
      output: 'Number',
      colour: INPUT,
    },
    {
      type: 'asa_millis',
      message0: 'время с запуска, мс',
      output: 'Number',
      colour: INPUT,
    },
    {
      type: 'asa_temperature',
      message0: 'температура TMP36 на %1, °C',
      args0: [{ type: 'field_dropdown', name: 'PIN', options: ANALOG_PINS }],
      output: 'Number',
      colour: INPUT,
    },
    {
      type: 'asa_servo_read',
      message0: 'считать градусы поворота сервопривода на выводе %1',
      args0: [{ type: 'field_dropdown', name: 'PIN', options: DIGITAL_PINS }],
      output: 'Number',
      colour: INPUT,
    },
    {
      type: 'asa_serial_available',
      message0: 'количество доступных последовательных символов',
      output: 'Number',
      colour: INPUT,
    },
    {
      type: 'asa_serial_read',
      message0: 'считать из последовательного интерфейса',
      output: 'Number',
      colour: INPUT,
    },
    {
      type: 'asa_ir_read',
      message0: 'считать данные инфракрасного датчика на выводе %1',
      args0: [{ type: 'field_dropdown', name: 'PIN', options: DIGITAL_PINS }],
      output: 'Boolean',
      colour: INPUT,
    },
    {
      type: 'asa_number',
      message0: '%1',
      args0: [{ type: 'field_number', name: 'VALUE', value: '0' }],
      output: 'Number',
      colour: DATA,
    },
    {
      type: 'asa_text',
      message0: '%1',
      args0: [{ type: 'field_input', name: 'VALUE', text: 'текст' }],
      output: 'String',
      colour: DATA,
    },
    ...['ADD', 'MINUS', 'MULTIPLY', 'DIVIDE', 'MODULO'].map((operation) => ({
      type: `asa_math_${operation.toLowerCase()}`,
      message0: `%1 ${
        operation === 'ADD'
          ? '+'
          : operation === 'MINUS'
            ? '−'
            : operation === 'MULTIPLY'
              ? '×'
              : operation === 'DIVIDE'
                ? '÷'
                : 'mod'
      } %2`,
      args0: [
        { type: 'input_value', name: 'A', check: 'Number' },
        { type: 'input_value', name: 'B', check: 'Number' },
      ],
      inputsInline: true,
      output: 'Number',
      colour: DATA,
    })),
    ...['LT', 'EQ', 'GT'].map((operation) => ({
      type: `asa_compare_${operation.toLowerCase()}`,
      message0: `%1 ${operation === 'LT' ? '<' : operation === 'EQ' ? '=' : '>'} %2`,
      args0: [
        { type: 'input_value', name: 'A' },
        { type: 'input_value', name: 'B' },
      ],
      inputsInline: true,
      output: 'Boolean',
      colour: DATA,
    })),
    {
      type: 'asa_logic_and',
      message0: '%1 и %2',
      args0: [
        { type: 'input_value', name: 'A', check: 'Boolean' },
        { type: 'input_value', name: 'B', check: 'Boolean' },
      ],
      inputsInline: true,
      output: 'Boolean',
      colour: DATA,
    },
    {
      type: 'asa_logic_or',
      message0: '%1 или %2',
      args0: [
        { type: 'input_value', name: 'A', check: 'Boolean' },
        { type: 'input_value', name: 'B', check: 'Boolean' },
      ],
      inputsInline: true,
      output: 'Boolean',
      colour: DATA,
    },
    {
      type: 'asa_logic_not',
      message0: 'не %1',
      args0: [{ type: 'input_value', name: 'VALUE', check: 'Boolean' }],
      output: 'Boolean',
      colour: DATA,
    },
    {
      type: 'asa_random',
      message0: 'случайное от %1 до %2',
      args0: [
        { type: 'input_value', name: 'MIN', check: 'Number' },
        { type: 'input_value', name: 'MAX', check: 'Number' },
      ],
      output: 'Number',
      colour: DATA,
    },
    {
      type: 'asa_map',
      message0: 'перевести %1 из %2…%3 в %4…%5',
      args0: [
        { type: 'input_value', name: 'VALUE', check: 'Number' },
        { type: 'input_value', name: 'FROM_LOW', check: 'Number' },
        { type: 'input_value', name: 'FROM_HIGH', check: 'Number' },
        { type: 'input_value', name: 'TO_LOW', check: 'Number' },
        { type: 'input_value', name: 'TO_HIGH', check: 'Number' },
      ],
      output: 'Number',
      colour: DATA,
    },
    {
      type: 'asa_constrain',
      message0: 'ограничить %1 диапазоном от %2 до %3',
      args0: [
        { type: 'input_value', name: 'VALUE', check: 'Number' },
        { type: 'input_value', name: 'MIN', check: 'Number' },
        { type: 'input_value', name: 'MAX', check: 'Number' },
      ],
      output: 'Number',
      colour: DATA,
    },
    {
      type: 'asa_abs',
      message0: 'abs %1',
      args0: [{ type: 'input_value', name: 'VALUE', check: 'Number' }],
      output: 'Number',
      colour: DATA,
    },
    {
      type: 'asa_level',
      message0: '%1',
      args0: [{ type: 'field_dropdown', name: 'LEVEL', options: LEVELS }],
      output: 'Boolean',
      colour: DATA,
    },
    {
      type: 'asa_var_get',
      message0: 'значение %1',
      args0: [
        {
          type: 'field_variable',
          name: 'NAME',
          variableTypes: [ScratchBlocks.SCALAR_VARIABLE_TYPE],
          defaultType: ScratchBlocks.SCALAR_VARIABLE_TYPE,
        },
      ],
      output: null,
      colour: VARIABLES,
    },
    {
      type: 'asa_var_set',
      message0: 'задать %1 равным %2',
      args0: [
        {
          type: 'field_variable',
          name: 'NAME',
          variableTypes: [ScratchBlocks.SCALAR_VARIABLE_TYPE],
          defaultType: ScratchBlocks.SCALAR_VARIABLE_TYPE,
        },
        { type: 'input_value', name: 'VALUE' },
      ],
      previousStatement: null,
      nextStatement: null,
      colour: VARIABLES,
    },
    {
      type: 'asa_var_change',
      message0: 'изменить %1 на %2',
      args0: [
        {
          type: 'field_variable',
          name: 'NAME',
          variableTypes: [ScratchBlocks.SCALAR_VARIABLE_TYPE],
          defaultType: ScratchBlocks.SCALAR_VARIABLE_TYPE,
        },
        { type: 'input_value', name: 'VALUE', check: 'Number' },
      ],
      previousStatement: null,
      nextStatement: null,
      colour: VARIABLES,
    },
    {
      type: 'asa_comment',
      message0: 'замечание %1',
      args0: [{ type: 'field_input', name: 'TEXT', text: 'описание' }],
      previousStatement: null,
      nextStatement: null,
      colour: COMMENT,
    },
  ];
  // Keep the category colour on each Arduino block. Scratch's colour extensions
  // resolve through the active Blockly theme; if a host restores the workspace
  // before that theme has settled, the renderer falls back to black. An explicit
  // colour is the stable Blockly contract and still uses the genuine Scratch
  // shapes, fields and renderer.
  const annotatedDefinitions = definitions.map((definition) => {
    const blockType = typeof definition['type'] === 'string' ? definition['type'] : '';
    // Untyped variable reporters also need an explicit rounded output shape.
    if ('output' in definition) {
      definition['outputShape'] =
        definition['output'] === 'Boolean'
          ? ScratchBlocks.OUTPUT_SHAPE_HEXAGONAL
          : ScratchBlocks.OUTPUT_SHAPE_ROUND;
      definition['inputsInline'] = true;
    } else if (definition['args0']) {
      definition['inputsInline'] = true;
    }
    for (const [key, argumentsList] of Object.entries(definition)) {
      if (!key.startsWith('args') || !Array.isArray(argumentsList)) continue;
      definition[key] = argumentsList.map((entry: Record<string, unknown>) =>
        typeof entry['name'] === 'string' && ARDUINO_PIN_INPUTS[blockType]?.[entry['name']]
          ? { type: 'input_value', name: entry['name'], check: 'Number' }
          : entry,
      );
    }
    definition['tooltip'] = arduinoBlockTooltip(blockType);
    if (['asa_pin', 'asa_pwm_pin', 'asa_analog_pin', 'asa_level'].includes(blockType)) {
      // Scratch dropdown shadows switch to a named *_selected theme style.
      // A raw hex colour would become an invalid "#40bf4a_selected" style.
      delete definition['colour'];
      definition['style'] = 'operators';
    }
    const support = arduinoBlockSupport(blockType);
    if (support.status === 'supported') return definition;
    return {
      ...definition,
      ...(support.status === 'unsupported' ? { colour: UNSUPPORTED_BLOCK } : {}),
    };
  });
  ScratchBlocks.defineBlocksWithJsonArray(annotatedDefinitions);
}

const TOOLBOX_BY_CATEGORY: Record<ArduinoBlockCategory, readonly string[]> = {
  output: [
    'asa_builtin_led',
    'asa_digital_write',
    'asa_analog_write',
    'asa_servo_write',
    'asa_tone',
    'asa_play_note',
    'asa_no_tone',
    'asa_serial_print',
    'asa_rgb_write',
    'asa_lcd_setup',
    'asa_lcd_print',
    'asa_lcd_cursor',
    'asa_lcd_clear',
    'asa_lcd_i2c_setup',
    'asa_7seg_setup',
    'asa_7seg_print',
    'asa_7seg_clear',
    'asa_neopixel_setup',
    'asa_neopixel_set',
  ],
  input: [
    'asa_digital_read',
    'asa_analog_read',
    'asa_ultrasonic',
    'asa_pulse_in',
    'asa_millis',
    'asa_temperature',
    'asa_servo_read',
    'asa_serial_available',
    'asa_serial_read',
    'asa_ir_read',
  ],
  comment: ['asa_comment'],
  control: [
    'asa_setup',
    'asa_loop',
    'asa_wait',
    'asa_repeat',
    'asa_forever',
    'asa_if',
    'asa_if_else',
    'asa_while',
    'asa_for',
  ],
  data: [
    'asa_number',
    'asa_text',
    'asa_math_add',
    'asa_math_minus',
    'asa_math_multiply',
    'asa_math_divide',
    'asa_math_modulo',
    'asa_compare_lt',
    'asa_compare_eq',
    'asa_compare_gt',
    'asa_logic_and',
    'asa_logic_or',
    'asa_logic_not',
    'asa_random',
    'asa_map',
    'asa_constrain',
    'asa_abs',
    'asa_level',
  ],
  variables: ['asa_var_get', 'asa_var_set', 'asa_var_change'],
};

type ArduinoShadowSpec = {
  readonly type: 'asa_number' | 'asa_text' | 'asa_level' | ArduinoPinReporter;
  readonly fields: Readonly<Record<string, string>>;
};

const NUMBER_SHADOW = (value = '1'): ArduinoShadowSpec => ({
  type: 'asa_number',
  fields: { VALUE: value },
});

const LEVEL_SHADOW: ArduinoShadowSpec = {
  type: 'asa_level',
  fields: { LEVEL: 'HIGH' },
};

const VALUE_INPUT_DEFAULTS: Readonly<Record<string, Readonly<Record<string, ArduinoShadowSpec>>>> =
  {
    asa_neopixel_setup: { COUNT: NUMBER_SHADOW('8') },
    asa_wait: { TIME: NUMBER_SHADOW() },
    asa_repeat: { COUNT: NUMBER_SHADOW('10') },
    asa_for: { STEP: NUMBER_SHADOW(), FROM: NUMBER_SHADOW(), TO: NUMBER_SHADOW('10') },
    asa_builtin_led: { LEVEL: LEVEL_SHADOW },
    asa_digital_write: { LEVEL: LEVEL_SHADOW },
    asa_pulse_in: { LEVEL: LEVEL_SHADOW },
    asa_servo_write: { ANGLE: NUMBER_SHADOW('0') },
    asa_tone: { FREQUENCY: NUMBER_SHADOW('440') },
    asa_play_note: { FREQUENCY: NUMBER_SHADOW('262'), DURATION: NUMBER_SHADOW() },
    asa_serial_print: { TEXT: { type: 'asa_text', fields: { VALUE: 'hello world' } } },
    asa_lcd_print: { TEXT: { type: 'asa_text', fields: { VALUE: 'hello world' } } },
    asa_rgb_write: { R: NUMBER_SHADOW('255'), G: NUMBER_SHADOW('0'), B: NUMBER_SHADOW('0') },
    asa_lcd_cursor: { COLUMN: NUMBER_SHADOW('0'), ROW: NUMBER_SHADOW('0') },
    asa_7seg_print: { VALUE: NUMBER_SHADOW('1234') },
    asa_neopixel_set: {
      INDEX: NUMBER_SHADOW('0'),
      R: NUMBER_SHADOW('255'),
      G: NUMBER_SHADOW('0'),
      B: NUMBER_SHADOW('0'),
    },
    asa_random: { MIN: NUMBER_SHADOW(), MAX: NUMBER_SHADOW('10') },
    asa_var_change: { VALUE: NUMBER_SHADOW() },
    asa_if: { CONDITION: LEVEL_SHADOW },
    asa_if_else: { CONDITION: LEVEL_SHADOW },
    asa_while: { CONDITION: LEVEL_SHADOW },
    asa_math_add: { A: NUMBER_SHADOW(), B: NUMBER_SHADOW() },
    asa_math_minus: { A: NUMBER_SHADOW(), B: NUMBER_SHADOW() },
    asa_math_multiply: { A: NUMBER_SHADOW(), B: NUMBER_SHADOW() },
    asa_math_divide: { A: NUMBER_SHADOW(), B: NUMBER_SHADOW() },
    asa_math_modulo: { A: NUMBER_SHADOW(), B: NUMBER_SHADOW() },
    asa_compare_lt: { A: NUMBER_SHADOW(), B: NUMBER_SHADOW() },
    asa_compare_eq: { A: NUMBER_SHADOW(), B: NUMBER_SHADOW() },
    asa_compare_gt: { A: NUMBER_SHADOW(), B: NUMBER_SHADOW() },
    asa_logic_and: { A: LEVEL_SHADOW, B: LEVEL_SHADOW },
    asa_logic_or: { A: LEVEL_SHADOW, B: LEVEL_SHADOW },
    asa_logic_not: { VALUE: LEVEL_SHADOW },
    asa_map: {
      VALUE: NUMBER_SHADOW('0'),
      FROM_LOW: NUMBER_SHADOW('0'),
      FROM_HIGH: NUMBER_SHADOW('1023'),
      TO_LOW: NUMBER_SHADOW('0'),
      TO_HIGH: NUMBER_SHADOW('255'),
    },
    asa_constrain: {
      VALUE: NUMBER_SHADOW('0'),
      MIN: NUMBER_SHADOW('0'),
      MAX: NUMBER_SHADOW('255'),
    },
    asa_abs: { VALUE: NUMBER_SHADOW('0') },
    asa_var_set: { VALUE: NUMBER_SHADOW() },
    asa_analog_write: { VALUE: NUMBER_SHADOW('0') },
  };

const TOOLBOX_INPUT_DEFAULTS: Readonly<
  Record<string, Readonly<Record<string, ArduinoShadowSpec>>>
> = Object.fromEntries(
  [...new Set([...Object.keys(VALUE_INPUT_DEFAULTS), ...Object.keys(ARDUINO_PIN_INPUTS)])].map(
    (type) => [
      type,
      {
        ...VALUE_INPUT_DEFAULTS[type],
        ...Object.fromEntries(
          Object.entries(ARDUINO_PIN_INPUTS[type] ?? {}).map(([name, reporter]) => [
            name,
            {
              type: reporter,
              fields: {
                VALUE:
                  reporter === 'asa_analog_pin' ? 'A0' : reporter === 'asa_pwm_pin' ? '3' : '0',
              },
            },
          ]),
        ),
      },
    ],
  ),
);

const TOOLBOX_FIELD_DEFAULTS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  asa_wait: { UNIT: 'SECONDS' },
  asa_for: { NAME: 'i' },

  asa_number: { VALUE: '0' },
  asa_text: { VALUE: 'текст' },
};

// Only former literal fields need a replacement on restore. Existing value
// connections may deliberately be empty: filling an old empty condition with
// HIGH, for example, would change a saved program's behavior.
const CONVERTED_INPUTS: Readonly<Record<string, readonly string[]>> = {
  asa_neopixel_setup: ['COUNT'],
  asa_wait: ['TIME'],
  asa_repeat: ['COUNT'],
  asa_for: ['STEP', 'FROM', 'TO'],
  asa_builtin_led: ['LEVEL'],
  asa_digital_write: ['LEVEL'],
  asa_pulse_in: ['LEVEL'],
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
  asa_map: ['FROM_LOW', 'FROM_HIGH', 'TO_LOW', 'TO_HIGH'],
  asa_constrain: ['MIN', 'MAX'],
  asa_var_change: ['VALUE'],
};

function toolboxBlock(
  type: string,
  fields?: Readonly<Record<string, unknown>>,
): ScratchBlocks.utils.toolbox.BlockInfo {
  const defaults = TOOLBOX_INPUT_DEFAULTS[type];
  const blockFields = Object.fromEntries(
    Object.entries({ ...TOOLBOX_FIELD_DEFAULTS[type], ...fields }).filter(
      ([name]) => !defaults?.[name],
    ),
  );
  return {
    kind: 'block',
    type,
    ...(Object.keys(blockFields).length > 0 ? { fields: blockFields } : {}),
    ...(defaults
      ? {
          inputs: Object.fromEntries(
            Object.entries(defaults).map(([name, shadow]) => [
              name,
              {
                shadow: {
                  type: shadow.type,
                  fields: shadow.fields,
                },
              },
            ]),
          ),
        }
      : {}),
  };
}

export function toolboxForCategory(
  category: ArduinoBlockCategory,
  variables: readonly ArduinoVariableChoice[] = [],
  flyoutScale = 1,
): ScratchBlocks.utils.toolbox.ToolboxInfo {
  const headerSpacer: ScratchBlocks.utils.toolbox.BlockInfo = {
    kind: 'sep',
    gap: Math.ceil(ARDUINO_FLYOUT_HEADER_GAP / Math.max(0.1, flyoutScale)),
  };
  if (category === 'variables') {
    return {
      kind: 'flyoutToolbox',
      contents: [
        headerSpacer,
        {
          kind: 'button',
          text: 'Создать переменную',
          callbackkey: ARDUINO_CREATE_VARIABLE_CALLBACK,
        },
        ...variables.flatMap(
          (variable) =>
            [
              ...TOOLBOX_BY_CATEGORY.variables.map((type) =>
                toolboxBlock(type, {
                  NAME: {
                    id: variable.id,
                    name: variable.name,
                    type: ScratchBlocks.SCALAR_VARIABLE_TYPE,
                  },
                }),
              ),
              {
                kind: 'button',
                text: `Переименовать «${variable.name}»`,
                callbackkey: arduinoRenameVariableCallback(variable.id),
              },
              {
                kind: 'button',
                text: `Удалить «${variable.name}»`,
                callbackkey: arduinoDeleteVariableCallback(variable.id),
              },
            ] as ScratchBlocks.utils.toolbox.FlyoutItemInfoArray,
        ),
      ],
    };
  }
  return {
    kind: 'flyoutToolbox',
    contents: [headerSpacer, ...TOOLBOX_BY_CATEGORY[category].map((type) => toolboxBlock(type))],
  };
}

const VARIABLE_BLOCK_TYPES = new Set(['asa_var_get', 'asa_var_set', 'asa_var_change']);

function objectValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Preserve legacy variable names and literal arguments when loading the
 * earlier field-based editor into the value-connection editor. */
export function migrateLegacyArduinoWorkspaceState(
  state: Record<string, unknown>,
): Record<string, unknown> {
  const root = objectValue(state);
  if (!root) return {};
  const variables = Array.isArray(root['variables'])
    ? [...(root['variables'] as readonly unknown[])]
    : [];
  const idsByName = new Map<string, string>();
  for (const entry of variables) {
    const variable = objectValue(entry);
    if (typeof variable?.['name'] === 'string' && typeof variable['id'] === 'string') {
      idsByName.set(variable['name'], variable['id']);
    }
  }
  let sequence = variables.length;

  const idForName = (name: string): string => {
    const existing = idsByName.get(name);
    if (existing) return existing;
    const id = `asa-variable-${++sequence}`;
    idsByName.set(name, id);
    variables.push({ name, id, type: ScratchBlocks.SCALAR_VARIABLE_TYPE });
    return id;
  };

  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const child of value) visit(child);
      return;
    }
    const node = objectValue(value);
    if (!node) return;
    if (typeof node['type'] === 'string' && VARIABLE_BLOCK_TYPES.has(node['type'])) {
      const fields = objectValue(node['fields']);
      const legacyName = fields?.['NAME'];
      if (fields && typeof legacyName === 'string') {
        const name = legacyName.trim() || 'переменная';
        fields['NAME'] = { id: idForName(name) };
      }
    }
    const defaults =
      typeof node['type'] === 'string' ? TOOLBOX_INPUT_DEFAULTS[node['type']] : undefined;
    if (defaults) {
      const fields = objectValue(node['fields']);
      const inputs = objectValue(node['inputs']) ?? {};
      for (const [name, shadow] of Object.entries(defaults)) {
        const legacyValue = fields?.[name];
        if (typeof legacyValue !== 'string' && typeof legacyValue !== 'number') continue;
        if (!inputs[name]) {
          const shadowField = shadow.type === 'asa_level' ? 'LEVEL' : 'VALUE';
          inputs[name] = {
            shadow: { type: shadow.type, fields: { [shadowField]: String(legacyValue) } },
          };
        }
        delete fields?.[name];
      }
      node['inputs'] = inputs;
    }
    for (const child of Object.values(node)) visit(child);
  };

  visit(root['blocks']);
  if (variables.length > 0) root['variables'] = variables;
  return root;
}

/** Fill empty fields left by early editor builds without overwriting values the
 * learner has already entered. Scratch's numeric fields otherwise render as a
 * visually blank white slot after an old project is restored. */
export function applyArduinoBlockDefaults(workspace: ScratchBlocks.Workspace): void {
  for (const block of workspace.getAllBlocks(false)) {
    for (const name of [
      ...(CONVERTED_INPUTS[block.type] ?? []),
      ...Object.keys(ARDUINO_PIN_INPUTS[block.type] ?? {}),
    ]) {
      const shadow = TOOLBOX_INPUT_DEFAULTS[block.type]![name]!;
      const connection = block.getInput(name)?.connection;
      if (!connection || connection.targetBlock()) continue;
      connection.setShadowState({ type: shadow.type, fields: { ...shadow.fields } });
    }
    const defaults = TOOLBOX_FIELD_DEFAULTS[block.type];
    if (!defaults) continue;
    for (const [fieldName, defaultValue] of Object.entries(defaults)) {
      if (!block.getField(fieldName)) continue;
      const currentValue = block.getFieldValue(fieldName);
      // An intentionally empty text literal is valid saved pupil content.
      if (block.type === 'asa_text' && currentValue !== null) continue;
      if (currentValue !== null && String(currentValue).trim() !== '') continue;
      block.setFieldValue(defaultValue, fieldName);
    }
  }
}

function quoted(value: string): string {
  return JSON.stringify(value);
}

function identifier(value: string): string {
  const safe = value.trim().replace(/[^a-zA-Z0-9_\u0400-\u04ff]/g, '_');
  return safe || 'variable';
}

function field(block: ScratchBlocks.Block | null, name: string, fallback = ''): string {
  if (!block) return fallback;
  return block.getFieldValue(name)?.toString() ?? fallback;
}

function variableName(block: ScratchBlocks.Block | null, fieldName = 'NAME'): string {
  if (!block) return 'переменная';
  const id = field(block, fieldName);
  return block.workspace.getVariableMap().getVariableById(id)?.getName() ?? id ?? 'переменная';
}

function workspaceIdentifier(workspace: ScratchBlocks.Workspace, prefix: string): string {
  const reserved = new Set<string>();
  for (const entry of activeArduinoGraph(workspace).blocks) {
    if (entry.type === 'asa_for') reserved.add(identifier(field(entry, 'NAME', 'i')));
    if (VARIABLE_BLOCK_TYPES.has(entry.type)) reserved.add(identifier(variableName(entry)));
  }
  const base = identifier(prefix);
  let name = base;
  let suffix = 0;
  while (reserved.has(name)) name = `${base}_${++suffix}`;
  return name;
}

function temporaryIdentifier(block: ScratchBlocks.Block, prefix: string): string {
  return workspaceIdentifier(block.workspace, prefix);
}

function dynamicLcd(workspace: ScratchBlocks.Workspace): boolean {
  const blocks = activeArduinoGraph(workspace).blocks;
  if (blocks.some((block) => block.type === 'asa_lcd_i2c_setup')) return false;
  const setup = blocks.find((block) => block.type === 'asa_lcd_setup');
  return Boolean(
    setup &&
    ['RS', 'E', 'D4', 'D5', 'D6', 'D7'].some((name) => literalArduinoPin(setup, name) === null),
  );
}

function lcdMember(block: ScratchBlocks.Block): string {
  return `${temporaryIdentifier(block, 'lcd')}${dynamicLcd(block.workspace) ? '->' : '.'}`;
}

function argument(
  block: ScratchBlocks.Block,
  name: string,
  fallback = '0',
  bindings?: ReadonlyMap<string, string>,
): string {
  const target = block.getInputTargetBlock(name);
  return target ? expression(target, bindings) : fallback;
}

// Preserve literal rounding; an expression must reach Arduino without Number coercion.
function duration(
  block: ScratchBlocks.Block,
  name: string,
  scale = 1,
  bindings?: ReadonlyMap<string, string>,
): string {
  const target = block.getInputTargetBlock(name);
  if (!target || target.type === 'asa_number') {
    return String(Math.round(Number(target ? field(target, 'VALUE', '1') : '1') * scale));
  }
  const value = expression(target, bindings);
  return scale === 1 ? value : `(${value} * ${scale})`;
}

function expression(
  block: ScratchBlocks.Block | null,
  bindings?: ReadonlyMap<string, string>,
): string {
  if (!block) return '0';
  const input = (name: string) => expression(block.getInputTargetBlock(name), bindings);
  switch (block.type) {
    case 'asa_pin':
    case 'asa_pwm_pin':
    case 'asa_analog_pin':
    case 'asa_number':
      return field(block, 'VALUE', '0');
    case 'asa_text':
      return quoted(field(block, 'VALUE'));
    case 'asa_digital_read':
      return `digitalRead(${argument(block, 'PIN', '0', bindings)})`;
    case 'asa_analog_read':
      return `analogRead(${argument(block, 'PIN', 'A0', bindings)})`;
    case 'asa_ultrasonic':
      return `readUltrasonicCm(${argument(block, 'TRIG', '7', bindings)}, ${argument(block, 'ECHO', '8', bindings)})`;
    case 'asa_pulse_in':
      return `pulseIn(${argument(block, 'PIN', '0', bindings)}, ${argument(block, 'LEVEL', 'HIGH', bindings)})`;
    case 'asa_millis':
      return 'millis()';
    case 'asa_temperature':
      return `((analogRead(${argument(block, 'PIN', 'A0', bindings)}) * (5.0 / 1023.0) - 0.5) * 100.0)`;
    case 'asa_servo_read': {
      const pin = literalArduinoServoPin(block);
      if (pin !== null) return `${temporaryIdentifier(block, `servo_${pin}`)}.read()`;
      const prepared = bindings?.get(`@servo:${block.id}`);
      if (prepared === undefined)
        throw new Error('Не подготовлено чтение вычисляемого вывода сервопривода.');
      return prepared;
    }
    case 'asa_serial_available':
      return 'Serial.available()';
    case 'asa_serial_read':
      return 'Serial.read()';
    case 'asa_ir_read':
      return `digitalRead(${argument(block, 'PIN', '0', bindings)})`;
    case 'asa_math_add':
      return `(${input('A')} + ${input('B')})`;
    case 'asa_math_minus':
      return `(${input('A')} - ${input('B')})`;
    case 'asa_math_multiply':
      return `(${input('A')} * ${input('B')})`;
    case 'asa_math_divide':
      return `(${input('A')} / ${input('B')})`;
    case 'asa_math_modulo':
      return `(${input('A')} % ${input('B')})`;
    case 'asa_compare_lt':
      return `(${input('A')} < ${input('B')})`;
    case 'asa_compare_eq':
      return `(${input('A')} == ${input('B')})`;
    case 'asa_compare_gt':
      return `(${input('A')} > ${input('B')})`;
    case 'asa_logic_and':
      return `(${input('A')} && ${input('B')})`;
    case 'asa_logic_or':
      return `(${input('A')} || ${input('B')})`;
    case 'asa_logic_not':
      return `(!${input('VALUE')})`;
    case 'asa_random': {
      const maximum = block.getInputTargetBlock('MAX');
      const exclusiveMaximum =
        !maximum || maximum.type === 'asa_number'
          ? String(Number(field(maximum, 'VALUE', '10')) + 1)
          : `(${expression(maximum, bindings)} + 1)`;
      return `random(${argument(block, 'MIN', '1', bindings)}, ${exclusiveMaximum})`;
    }
    case 'asa_map':
      return `map(${input('VALUE')}, ${argument(block, 'FROM_LOW', '0', bindings)}, ${argument(block, 'FROM_HIGH', '1023', bindings)}, ${argument(block, 'TO_LOW', '0', bindings)}, ${argument(block, 'TO_HIGH', '255', bindings)})`;
    case 'asa_constrain':
      return `constrain(${input('VALUE')}, ${argument(block, 'MIN', '0', bindings)}, ${argument(block, 'MAX', '255', bindings)})`;
    case 'asa_abs':
      return `abs(${input('VALUE')})`;
    case 'asa_level':
      return field(block, 'LEVEL', 'HIGH');
    case 'asa_var_get':
      return bindings?.get(identifier(variableName(block))) ?? identifier(variableName(block));
    default:
      return '0';
  }
}

function indent(code: string, spaces = 2): string {
  const prefix = ' '.repeat(spaces);
  return code
    .split('\n')
    .filter((line, index, lines) => line.length > 0 || index < lines.length - 1)
    .map((line) => `${prefix}${line}`)
    .join('\n');
}

function outputPinStatement(
  block: ScratchBlocks.Block,
  input: string,
  fallback: string,
  command: (pin: string) => string,
  bindings?: ReadonlyMap<string, string>,
): string {
  const literal = literalArduinoPin(block, input, fallback);
  if (literal !== null) return command(literal);
  const pin = temporaryIdentifier(block, 'asaOutputPin');
  return `{\n${indent(`int ${pin} = ${argument(block, input, fallback, bindings)};\npinMode(${pin}, OUTPUT);\n${command(pin)}`)}\n}`;
}

function statements(first: ScratchBlocks.Block | null): string {
  const lines: string[] = [];
  let block = first;
  while (block) {
    const current = block;
    const outputStart = lines.length;
    const values = new Map<string, string>();
    const prelude: string[] = [];
    let readIndex = 0;
    const prepareInputs = (names: readonly string[], initial = new Map<string, string>()) => {
      const prepared = new Map(initial);
      const code: string[] = [];
      const visitValue = (value: ScratchBlocks.Block | null): void => {
        if (!value) return;
        for (const input of value.inputList) {
          if (input.connection?.type === ScratchBlocks.ConnectionType.INPUT_VALUE)
            visitValue(input.connection.targetBlock());
        }
        if (value.type !== 'asa_servo_read' || literalArduinoServoPin(value) !== null) return;
        const ordinal = readIndex++;
        const pin = temporaryIdentifier(current, `asaServoReadPin${ordinal}`);
        const result = temporaryIdentifier(current, `asaServoReadValue${ordinal}`);
        code.push(
          ...dynamicArduinoServoReadSource(
            fixedArduinoServoPins(current.workspace),
            (prefix) => temporaryIdentifier(current, prefix),
            argument(value, 'PIN', '9', prepared),
            pin,
            result,
          ),
        );
        prepared.set(`@servo:${value.id}`, result);
      };
      for (const name of names) visitValue(current.getInputTargetBlock(name));
      return { values: prepared, code };
    };
    if (!['asa_repeat', 'asa_for'].includes(current.type)) {
      const prepared = prepareInputs(
        current.inputList
          .filter((input) => input.connection?.type === ScratchBlocks.ConnectionType.INPUT_VALUE)
          .map((input) => input.name),
      );
      for (const [key, value] of prepared.values) values.set(key, value);
      prelude.push(...prepared.code);
    }
    const valueOf = (name: string, fallback = '0') => argument(current, name, fallback, values);
    const pinCommand = (name: string, fallback: string, command: (pin: string) => string) =>
      outputPinStatement(current, name, fallback, command, values);
    const nested = (name: string) => statements(block?.getInputTargetBlock(name) ?? null);
    switch (block.type) {
      case 'asa_wait': {
        const amount = duration(
          block,
          'TIME',
          field(block, 'UNIT', 'SECONDS') === 'SECONDS' ? 1000 : 1,
          values,
        );
        const unit = field(block, 'UNIT', 'SECONDS');
        lines.push(unit === 'MICROSECONDS' ? `delayMicroseconds(${amount});` : `delay(${amount});`);
        break;
      }
      case 'asa_repeat': {
        const index = temporaryIdentifier(block, 'repeatIndex');
        const prepared = prepareInputs(['COUNT']);
        const count = argument(current, 'COUNT', '10', prepared.values);
        if (prepared.code.length === 0) {
          lines.push(
            `for (int ${index} = 0; ${index} < ${count}; ${index}++) {\n${indent(nested('DO'))}\n}`,
          );
        } else {
          const flag = temporaryIdentifier(current, 'asaRepeatCondition');
          const check = `{\n${indent([...prepared.code, `${flag} = ${index} < ${count};`].join('\n'))}\n}`;
          const body = `${check}\nif (${flag}) {\n${indent(`${nested('DO')}\n${index}++;`)}\n}`;
          lines.push(
            `{\n${indent(`int ${index} = 0;\nbool ${flag} = true;\nwhile (${flag}) {\n${indent(body)}\n}`)}\n}`,
          );
        }
        break;
      }
      case 'asa_forever':
        lines.push(`while (true) {\n${indent(nested('DO'))}\n}`);
        break;
      case 'asa_if':
        lines.push(
          `if (${expression(current.getInputTargetBlock('CONDITION'), values)}) {\n${indent(nested('DO'))}\n}`,
        );
        break;
      case 'asa_if_else':
        lines.push(
          `if (${expression(current.getInputTargetBlock('CONDITION'), values)}) {\n${indent(nested('DO'))}\n} else {\n${indent(nested('ELSE'))}\n}`,
        );
        break;
      case 'asa_while': {
        const condition = expression(current.getInputTargetBlock('CONDITION'), values);
        if (prelude.length > 0) {
          const flag = temporaryIdentifier(current, 'asaWhileCondition');
          const refresh = `{\n${indent([...prelude, `${flag} = ${condition};`].join('\n'))}\n}`;
          lines.push(
            `bool ${flag} = ${condition};\nwhile (${flag}) {\n${indent([nested('DO'), refresh].join('\n'))}\n}`,
          );
        } else {
          lines.push(`while (${condition}) {\n${indent(nested('DO'))}\n}`);
        }
        break;
      }
      case 'asa_for': {
        const name = identifier(field(block, 'NAME', 'i'));
        const up = field(block, 'DIRECTION', 'UP') === 'UP';
        const capturesCounter = ['FROM', 'TO', 'STEP'].some((inputName) =>
          block
            ?.getInputTargetBlock(inputName)
            ?.getDescendants(false)
            .some(
              (entry) => entry.type === 'asa_var_get' && identifier(variableName(entry)) === name,
            ),
        );
        const outerValue = temporaryIdentifier(block, 'asaForOuterValue');
        const bindings = capturesCounter ? new Map([...values, [name, outerValue]]) : values;
        const phases = ['FROM', 'TO', 'STEP'].map((input) => prepareInputs([input], bindings));
        const from = argument(block, 'FROM', '1', phases[0]!.values);
        const to = argument(block, 'TO', '10', phases[1]!.values);
        const step = argument(block, 'STEP', '1', phases[2]!.values);
        const comparison = `${name} ${up ? '<=' : '>='} ${to}`;
        const increment = `${name} ${up ? '+=' : '-='} ${step};`;
        let loop: string;
        if (phases.some((phase) => phase.code.length > 0)) {
          // FROM executes once; TO before each body; STEP after each body.
          // Keep computed Servo reads at the same evaluation points as fixed reads.
          const flag = temporaryIdentifier(current, 'asaForCondition');
          const check = `{\n${indent([...phases[1]!.code, `${flag} = ${comparison};`].join('\n'))}\n}`;
          const advance = `{\n${indent([...phases[2]!.code, increment].join('\n'))}\n}`;
          const body = `${check}\nif (${flag}) {\n${indent([nested('DO'), advance].join('\n'))}\n}`;
          loop = [
            ...phases[0]!.code,
            `int ${name} = ${from};`,
            `bool ${flag} = true;`,
            `while (${flag}) {\n${indent(body)}\n}`,
          ].join('\n');
          // A private scope preserves the original for-counter lifetime.
          loop = `{\n${indent(loop)}\n}`;
        } else {
          loop = `for (int ${name} = ${from}; ${comparison}; ${increment.slice(0, -1)}) {\n${indent(nested('DO'))}\n}`;
        }
        // Variable reporters refer to the outer pupil binding, not a counter
        // introduced by this statement. Snapshot only that float binding;
        // preserve each bound expression's original arithmetic/result type.
        lines.push(
          capturesCounter ? `{\n${indent(`float ${outerValue} = ${name};\n${loop}`)}\n}` : loop,
        );
        break;
      }
      case 'asa_builtin_led':
        lines.push(`digitalWrite(LED_BUILTIN, ${valueOf('LEVEL', 'HIGH')});`);
        break;
      case 'asa_digital_write':
        lines.push(
          pinCommand('PIN', '0', (pin) => `digitalWrite(${pin}, ${valueOf('LEVEL', 'HIGH')});`),
        );
        break;
      case 'asa_analog_write':
        lines.push(
          pinCommand(
            'PIN',
            '3',
            (pin) =>
              `analogWrite(${pin}, ${expression(current.getInputTargetBlock('VALUE'), values)});`,
          ),
        );
        break;
      case 'asa_servo_write':
        lines.push(
          literalArduinoServoPin(block) !== null
            ? `${temporaryIdentifier(block, `servo_${literalArduinoServoPin(block)}`)}.write(${valueOf('ANGLE', '0')});`
            : dynamicArduinoServoWriteSource(
                fixedArduinoServoPins(block.workspace),
                (prefix) => temporaryIdentifier(current, prefix),
                argument(block, 'PIN', '9', values),
                argument(block, 'ANGLE', '0', values),
              ),
        );
        break;
      case 'asa_tone':
        lines.push(
          pinCommand('PIN', '8', (pin) => `tone(${pin}, ${valueOf('FREQUENCY', '440')});`),
        );
        break;
      case 'asa_play_note': {
        const milliseconds = duration(block, 'DURATION', 1000, values);
        const durationBlock = block.getInputTargetBlock('DURATION');
        if (durationBlock && durationBlock.type !== 'asa_number') {
          // A reporter such as random() must be sampled once for both tone and
          // wait; a local scope also lets consecutive note blocks reuse the name.
          const durationName = temporaryIdentifier(block, 'asaNoteDurationMs');
          lines.push(
            pinCommand(
              'PIN',
              '8',
              (pin) =>
                `{\n${indent(
                  [
                    `unsigned long ${durationName} = ${milliseconds};`,
                    `tone(${pin}, ${valueOf('FREQUENCY', '262')}, ${durationName});`,
                    `delay(${durationName});`,
                  ].join('\n'),
                )}\n}`,
            ),
          );
          break;
        }
        lines.push(
          pinCommand(
            'PIN',
            '8',
            (pin) =>
              `tone(${pin}, ${valueOf('FREQUENCY', '262')}, ${milliseconds});\ndelay(${milliseconds});`,
          ),
        );
        break;
      }
      case 'asa_no_tone':
        lines.push(pinCommand('PIN', '8', (pin) => `noTone(${pin});`));
        break;
      case 'asa_serial_print':
        lines.push(
          `Serial.${field(block, 'ENDING', 'LINE') === 'LINE' ? 'println' : 'print'}(${argument(block, 'TEXT', quoted('hello world'), values)});`,
        );
        break;
      case 'asa_rgb_write':
        for (const [pinName, valueName, pinDefault, valueDefault] of [
          ['R_PIN', 'R', '3', '255'],
          ['G_PIN', 'G', '5', '0'],
          ['B_PIN', 'B', '6', '0'],
        ])
          lines.push(
            pinCommand(
              pinName!,
              pinDefault!,
              (pin) =>
                `analogWrite(${pin}, ${argument(current, valueName!, valueDefault!, values)});`,
            ),
          );
        break;
      case 'asa_lcd_setup': {
        const i2c = activeArduinoGraph(current.workspace).blocks.some(
          (entry) => entry.type === 'asa_lcd_i2c_setup',
        );
        const names = ['RS', 'E', 'D4', 'D5', 'D6', 'D7'];
        const deferred = dynamicLcd(current.workspace);
        if (!i2c && (deferred || names.some((name) => literalArduinoPin(current, name) === null))) {
          const pins = names.map((_, i) => temporaryIdentifier(current, `asaLcdPin${i}`));
          const code = names.map((name, i) => `int ${pins[i]} = ${valueOf(name)};`);
          if (deferred) {
            const object = temporaryIdentifier(current, 'asaLcdObject');
            code.push(
              `static LiquidCrystal ${object}(${pins.join(', ')});`,
              `${temporaryIdentifier(current, 'lcd')} = &${object};`,
            );
          }
          code.push(
            `${lcdMember(current)}init(1, ${pins[0]}, 255, ${pins[1]}, ${pins.slice(2).join(', ')}, 0, 0, 0, 0);`,
            `${lcdMember(current)}begin(16, 2);`,
          );
          lines.push(`{\n${indent(code.join('\n'))}\n}`);
        }
        break;
      }
      case 'asa_neopixel_setup':
        if (literalArduinoPin(block) === null || literalArduinoPin(block, 'COUNT', '8') === null) {
          lines.push(
            `${temporaryIdentifier(block, 'pixels')}.setPin(${valueOf('PIN', '6')});`,
            `${temporaryIdentifier(block, 'pixels')}.updateLength(${valueOf('COUNT', '8')});`,
            `${temporaryIdentifier(current, 'pixels')}.begin();`,
          );
        }
        break;
      case 'asa_lcd_print':
        lines.push(
          `${lcdMember(block)}print(${argument(block, 'TEXT', quoted('hello world'), values)});`,
        );
        break;
      case 'asa_lcd_cursor':
        lines.push(
          `${lcdMember(block)}setCursor(${valueOf('COLUMN', '0')}, ${valueOf('ROW', '0')});`,
        );
        break;
      case 'asa_lcd_clear':
        lines.push(`${lcdMember(block)}clear();`);
        break;
      case 'asa_7seg_print':
        lines.push(
          `${temporaryIdentifier(block, `display_${field(block, 'DISPLAY', '1')}`)}.print(${valueOf('VALUE', '1234')});`,
          `${temporaryIdentifier(block, `display_${field(block, 'DISPLAY', '1')}`)}.writeDisplay();`,
        );
        break;
      case 'asa_7seg_clear':
        lines.push(
          `${temporaryIdentifier(block, `display_${field(block, 'DISPLAY', '1')}`)}.clear();`,
          `${temporaryIdentifier(block, `display_${field(block, 'DISPLAY', '1')}`)}.writeDisplay();`,
        );
        break;
      case 'asa_neopixel_set':
        lines.push(
          `${temporaryIdentifier(block, 'pixels')}.setPixelColor(${valueOf('INDEX', '0')}, ${temporaryIdentifier(block, 'pixels')}.Color(${valueOf('R', '255')}, ${valueOf('G', '0')}, ${valueOf('B', '0')}));`,
          `${temporaryIdentifier(block, 'pixels')}.show();`,
        );
        break;
      case 'asa_var_set':
        lines.push(
          `${identifier(variableName(block))} = ${expression(current.getInputTargetBlock('VALUE'), values)};`,
        );
        break;
      case 'asa_var_change':
        lines.push(`${identifier(variableName(block))} += ${valueOf('VALUE', '1')};`);
        break;
      case 'asa_comment':
        lines.push(`// ${field(block, 'TEXT')}`);
        break;
    }
    if (prelude.length > 0) {
      const commands = lines.splice(outputStart);
      lines.push(`{\n${indent([...prelude, ...commands].join('\n'))}\n}`);
    }
    block = block.getNextBlock();
  }
  return lines.join('\n');
}

export function generateArduinoCode(workspace: ScratchBlocks.Workspace): string {
  const {
    blocks: allBlocks,
    setup: setupBlock,
    loop: loopBlock,
    fallback,
  } = activeArduinoGraph(workspace);
  const blockTypes = new Set(allBlocks.map((block) => block.type));
  const declarations: string[] = [];
  const setupLines: string[] = [];

  const digitalPins = new Set<string>();
  for (const block of allBlocks) {
    if (block.type === 'asa_builtin_led') digitalPins.add('LED_BUILTIN');
    if (
      [
        'asa_digital_write',
        'asa_analog_write',
        'asa_tone',
        'asa_play_note',
        'asa_no_tone',
      ].includes(block.type)
    ) {
      const pin = literalArduinoPin(block);
      if (pin !== null) digitalPins.add(pin);
    }
  }
  for (const pin of digitalPins) setupLines.push(`pinMode(${pin}, OUTPUT);`);

  const variableNames = new Set(
    allBlocks
      .filter((block) => ['asa_var_get', 'asa_var_set', 'asa_var_change'].includes(block.type))
      .map((block) => identifier(variableName(block))),
  );
  for (const name of variableNames) declarations.push(`float ${name} = 0;`);

  const servoBlocks = allBlocks.filter(
    (block) => block.type === 'asa_servo_write' || block.type === 'asa_servo_read',
  );
  const servoPins = new Set(
    servoBlocks
      .map((block) => literalArduinoServoPin(block))
      .filter((pin): pin is string => pin !== null),
  );
  if (servoBlocks.length > 0) {
    declarations.unshift('#include <Servo.h>');
    for (const pin of servoPins) {
      declarations.push(`Servo ${workspaceIdentifier(workspace, `servo_${pin}`)};`);
      setupLines.push(`${workspaceIdentifier(workspace, `servo_${pin}`)}.attach(${pin});`);
    }
    if (servoBlocks.some((block) => literalArduinoServoPin(block) === null)) {
      declarations.push(
        ...dynamicArduinoServoSource([...servoPins], (prefix) =>
          temporaryIdentifier(servoBlocks[0]!, prefix),
        ),
      );
    }
  }

  const lcdSetup = allBlocks.find((block) => block.type === 'asa_lcd_setup');
  const lcdI2cSetup = allBlocks.find((block) => block.type === 'asa_lcd_i2c_setup');
  if (lcdI2cSetup) {
    const [columns, rows] = field(lcdI2cSetup, 'SIZE', '16X2') === '20X4' ? [20, 4] : [16, 2];
    declarations.unshift('#include <LiquidCrystal_I2C.h>');
    declarations.push(
      `LiquidCrystal_I2C ${workspaceIdentifier(workspace, 'lcd')}(${field(lcdI2cSetup, 'ADDRESS', '0x27')}, ${columns}, ${rows});`,
    );
    setupLines.push(
      `${workspaceIdentifier(workspace, 'lcd')}.init();`,
      `${workspaceIdentifier(workspace, 'lcd')}.backlight();`,
    );
  } else if (lcdSetup || blockTypes.has('asa_lcd_print') || blockTypes.has('asa_lcd_cursor')) {
    const pins = lcdSetup
      ? ['RS', 'E', 'D4', 'D5', 'D6', 'D7'].map((name) => literalArduinoPin(lcdSetup, name))
      : ['12', '11', '5', '4', '3', '2'];
    declarations.unshift('#include <LiquidCrystal.h>');
    const dynamic = pins.some((pin) => pin === null);
    declarations.push(
      dynamic
        ? `LiquidCrystal *${workspaceIdentifier(workspace, 'lcd')} = nullptr;`
        : `LiquidCrystal ${workspaceIdentifier(workspace, 'lcd')}(${pins.join(', ')});`,
    );
    if (!dynamic) setupLines.push(`${workspaceIdentifier(workspace, 'lcd')}.begin(16, 2);`);
  }

  const sevenSegmentSetups = allBlocks.filter((block) => block.type === 'asa_7seg_setup');
  if (
    sevenSegmentSetups.length > 0 ||
    blockTypes.has('asa_7seg_print') ||
    blockTypes.has('asa_7seg_clear')
  ) {
    declarations.unshift('#include <Adafruit_LEDBackpack.h>');
    const displayNumbers = new Set(
      allBlocks
        .filter((block) =>
          ['asa_7seg_setup', 'asa_7seg_print', 'asa_7seg_clear'].includes(block.type),
        )
        .map((block) => field(block, 'DISPLAY', '1')),
    );
    if (displayNumbers.size === 0) displayNumbers.add('1');
    for (const display of displayNumbers) {
      const setup = sevenSegmentSetups.find((block) => field(block, 'DISPLAY', '1') === display);
      declarations.push(
        `Adafruit_7segment ${workspaceIdentifier(workspace, `display_${display}`)};`,
      );
      setupLines.push(
        `${workspaceIdentifier(workspace, `display_${display}`)}.begin(${field(setup ?? null, 'ADDRESS', '0x70')});`,
      );
    }
  }

  const pixelSetup = allBlocks.find((block) => block.type === 'asa_neopixel_setup');
  if (pixelSetup || blockTypes.has('asa_neopixel_set')) {
    const pin = literalArduinoPin(pixelSetup ?? null, 'PIN', '6');
    const count = literalArduinoPin(pixelSetup ?? null, 'COUNT', '8');
    declarations.unshift('#include <Adafruit_NeoPixel.h>');
    const dynamic = pin === null || count === null;
    declarations.push(
      `Adafruit_NeoPixel ${workspaceIdentifier(workspace, 'pixels')}(${dynamic ? '0, 0' : `${count}, ${pin}`}, NEO_GRB + NEO_KHZ800);`,
    );
    if (!dynamic) setupLines.push(`${workspaceIdentifier(workspace, 'pixels')}.begin();`);
  }

  if (
    blockTypes.has('asa_serial_print') ||
    blockTypes.has('asa_serial_available') ||
    blockTypes.has('asa_serial_read')
  ) {
    setupLines.push('Serial.begin(9600);');
  }

  if (blockTypes.has('asa_ultrasonic')) {
    declarations.push(
      `float readUltrasonicCm(int triggerPin, int echoPin) {
  pinMode(triggerPin, OUTPUT);
  digitalWrite(triggerPin, LOW);
  delayMicroseconds(2);
  digitalWrite(triggerPin, HIGH);
  delayMicroseconds(10);
  digitalWrite(triggerPin, LOW);
  pinMode(echoPin, INPUT);
  return pulseIn(echoPin, HIGH) * 0.01723;
}`,
    );
  }

  const setupBody = statements(setupBlock?.getInputTargetBlock('DO') ?? null);
  const loopBody = loopBlock
    ? statements(loopBlock.getInputTargetBlock('DO'))
    : fallback
        .map((block) => statements(block))
        .filter(Boolean)
        .join('\n');
  return `// C++ code generated by ASA Lab
// Arduino Uno R3
${declarations.length > 0 ? `\n${declarations.join('\n')}\n` : ''}
void setup()
{
${indent([...setupLines, setupBody].filter(Boolean).join('\n'))}
}

void loop()
{
${indent(loopBody)}
}
`;
}

export function createDefaultArduinoBlocks(workspace: ScratchBlocks.WorkspaceSvg): void {
  const setup = workspace.newBlock('asa_setup');
  const loop = workspace.newBlock('asa_loop');
  const ledHigh = workspace.newBlock('asa_builtin_led');
  const waitHigh = workspace.newBlock('asa_wait');
  const ledLow = workspace.newBlock('asa_builtin_led');
  const waitLow = workspace.newBlock('asa_wait');

  for (const block of [setup, loop, ledHigh, waitHigh, ledLow, waitLow]) {
    block.initSvg();
    block.render();
  }
  applyArduinoBlockDefaults(workspace);
  ledLow.getInputTargetBlock('LEVEL')?.setFieldValue('LOW', 'LEVEL');
  loop.getInput('DO')?.connection?.connect(ledHigh.previousConnection);
  ledHigh.nextConnection?.connect(waitHigh.previousConnection);
  waitHigh.nextConnection?.connect(ledLow.previousConnection);
  ledLow.nextConnection?.connect(waitLow.previousConnection);
  setup.moveBy(330, 120);
  loop.moveBy(330, 280);
}
