/** Block shapes/fields only: no generator, editor controls or simulation imports. */
import * as ScratchBlocks from 'scratch-blocks';
import { arduinoBlockSupport } from '@asa-lab/electronics/rendering';
import { arduinoBlockTooltip } from './arduino-block-appearance';
import {
  ARDUINO_DIGITAL_PIN_OPTIONS,
  ARDUINO_PWM_PIN_OPTIONS,
  ARDUINO_ANALOG_PIN_OPTIONS,
  ARDUINO_PIN_INPUTS,
} from './arduino-block-schema';

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

export function registerArduinoBlockDefinitions(): void {
  // ScratchBlocks exports its translations without activating a locale. Its
  // built-in menus call message.replace(), so initialise them before injection
  // (including remounts where the Arduino block definitions already exist).
  ScratchBlocks.ScratchMsgs.setLocale('ru');
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
