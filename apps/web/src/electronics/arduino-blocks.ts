import * as ScratchBlocks from 'scratch-blocks';

export type ArduinoBlockCategory =
  'output' | 'input' | 'comment' | 'control' | 'data' | 'variables';

export type ArduinoCodeMode = 'blocks' | 'blocks-text' | 'text';

export interface ArduinoProgramState {
  readonly mode: ArduinoCodeMode;
  readonly workspaceJson: string;
  readonly source: string;
  readonly serialOpen: boolean;
  readonly baudRate: number;
}

export const DEFAULT_ARDUINO_SOURCE = `// C++ code
//
void setup()
{
  pinMode(LED_BUILTIN, OUTPUT);
}

void loop()
{
  digitalWrite(LED_BUILTIN, HIGH);
  delay(1000); // Wait for 1000 millisecond(s)
  digitalWrite(LED_BUILTIN, LOW);
  delay(1000); // Wait for 1000 millisecond(s)
}
`;

const DIGITAL_PINS = Array.from({ length: 14 }, (_, pin) => [String(pin), String(pin)]);
const PWM_PINS = ['3', '5', '6', '9', '10', '11'].map((pin) => [pin, pin]);
const ANALOG_PINS = Array.from({ length: 6 }, (_, pin) => [`A${pin}`, `A${pin}`]);
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

let registered = false;

export function registerArduinoBlocks(): void {
  if (registered) return;
  registered = true;
  const definitions: Record<string, unknown>[] = [
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
        { type: 'field_number', name: 'TIME', value: 1, min: 0, precision: 0.001 },
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
      args0: [{ type: 'field_number', name: 'COUNT', value: 10, min: 0, precision: 1 }],
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
        { type: 'field_number', name: 'STEP', value: 1 },
        { type: 'field_input', name: 'NAME', text: 'i' },
        { type: 'field_number', name: 'FROM', value: 1 },
        { type: 'field_number', name: 'TO', value: 10 },
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
      args0: [{ type: 'field_dropdown', name: 'LEVEL', options: LEVELS }],
      previousStatement: null,
      nextStatement: null,
      colour: OUTPUT,
    },
    {
      type: 'asa_digital_write',
      message0: 'назначить вывод %1 на %2',
      args0: [
        { type: 'field_dropdown', name: 'PIN', options: DIGITAL_PINS },
        { type: 'field_dropdown', name: 'LEVEL', options: LEVELS },
      ],
      previousStatement: null,
      nextStatement: null,
      colour: OUTPUT,
    },
    {
      type: 'asa_analog_write',
      message0: 'назначить вывод %1 на %2',
      args0: [
        { type: 'field_dropdown', name: 'PIN', options: PWM_PINS },
        { type: 'field_number', name: 'VALUE', value: 0, min: 0, max: 255, precision: 1 },
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
        { type: 'field_number', name: 'ANGLE', value: 0, min: 0, max: 180, precision: 1 },
      ],
      previousStatement: null,
      nextStatement: null,
      colour: OUTPUT,
    },
    {
      type: 'asa_tone',
      message0: 'воспроизвести %1 Гц на выводе %2',
      args0: [
        { type: 'field_number', name: 'FREQUENCY', value: 440, min: 1, max: 20000 },
        { type: 'field_dropdown', name: 'PIN', options: DIGITAL_PINS },
      ],
      previousStatement: null,
      nextStatement: null,
      colour: OUTPUT,
    },
    {
      type: 'asa_play_note',
      message0: 'воспроизвести запись на выводе %1 с тоном %2 Гц в течение %3 с',
      args0: [
        { type: 'field_dropdown', name: 'PIN', options: DIGITAL_PINS },
        { type: 'field_number', name: 'FREQUENCY', value: 262, min: 31, max: 20000 },
        { type: 'field_number', name: 'DURATION', value: 1, min: 0.01, max: 60 },
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
        { type: 'field_input', name: 'TEXT', text: 'hello world' },
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
      message0: 'назначить светодиодам RGB на выводах %1 %2 %3 значения %4 %5 %6',
      args0: [
        { type: 'field_dropdown', name: 'R_PIN', options: PWM_PINS },
        { type: 'field_dropdown', name: 'G_PIN', options: PWM_PINS },
        { type: 'field_dropdown', name: 'B_PIN', options: PWM_PINS },
        { type: 'field_number', name: 'R', value: 255, min: 0, max: 255 },
        { type: 'field_number', name: 'G', value: 0, min: 0, max: 255 },
        { type: 'field_number', name: 'B', value: 0, min: 0, max: 255 },
      ],
      previousStatement: null,
      nextStatement: null,
      colour: OUTPUT,
    },
    {
      type: 'asa_lcd_setup',
      message0: 'настроить ЖК-экран: RS %1 E %2 D4 %3 D5 %4 D6 %5 D7 %6',
      args0: ['RS', 'E', 'D4', 'D5', 'D6', 'D7'].map((name, index) => ({
        type: 'field_dropdown',
        name,
        options: DIGITAL_PINS,
        value: String([12, 11, 5, 4, 3, 2][index]),
      })),
      previousStatement: null,
      nextStatement: null,
      colour: OUTPUT,
    },
    {
      type: 'asa_lcd_print',
      message0: 'печатать на ЖК-экран %1',
      args0: [{ type: 'field_input', name: 'TEXT', text: 'hello world' }],
      previousStatement: null,
      nextStatement: null,
      colour: OUTPUT,
    },
    {
      type: 'asa_lcd_cursor',
      message0: 'задать положение на ЖК-экране столбец %1 строка %2',
      args0: [
        { type: 'field_number', name: 'COLUMN', value: 0, min: 0, max: 39 },
        { type: 'field_number', name: 'ROW', value: 0, min: 0, max: 3 },
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
      message0: 'настроить тип ЖК-экрана %1 для I2C с адресом %2',
      args0: [
        {
          type: 'field_dropdown',
          name: 'SIZE',
          options: [
            ['16 × 2', '16X2'],
            ['20 × 4', '20X4'],
          ],
        },
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
      message0: 'настроить тип светодиодного экрана %1 для 7-сегментных часов с адресом %2',
      args0: [
        {
          type: 'field_dropdown',
          name: 'DISPLAY',
          options: [
            ['1', '1'],
            ['2', '2'],
          ],
        },
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
        { type: 'field_number', name: 'VALUE', value: 1234, min: -999, max: 9999 },
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
      message0: 'настроить светодиодную ленту: вывод %1 светодиодов %2',
      args0: [
        { type: 'field_dropdown', name: 'PIN', options: DIGITAL_PINS },
        { type: 'field_number', name: 'COUNT', value: 8, min: 1, max: 300 },
      ],
      previousStatement: null,
      nextStatement: null,
      colour: OUTPUT,
    },
    {
      type: 'asa_neopixel_set',
      message0: 'светодиод %1 установить R %2 G %3 B %4',
      args0: [
        { type: 'field_number', name: 'INDEX', value: 0, min: 0, max: 299 },
        { type: 'field_number', name: 'R', value: 255, min: 0, max: 255 },
        { type: 'field_number', name: 'G', value: 0, min: 0, max: 255 },
        { type: 'field_number', name: 'B', value: 0, min: 0, max: 255 },
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
        { type: 'field_dropdown', name: 'LEVEL', options: LEVELS },
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
      args0: [{ type: 'field_number', name: 'VALUE', value: 0 }],
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
        { type: 'field_number', name: 'MIN', value: 1 },
        { type: 'field_number', name: 'MAX', value: 10 },
      ],
      output: 'Number',
      colour: DATA,
    },
    {
      type: 'asa_map',
      message0: 'перевести %1 из %2…%3 в %4…%5',
      args0: [
        { type: 'input_value', name: 'VALUE', check: 'Number' },
        { type: 'field_number', name: 'FROM_LOW', value: 0 },
        { type: 'field_number', name: 'FROM_HIGH', value: 1023 },
        { type: 'field_number', name: 'TO_LOW', value: 0 },
        { type: 'field_number', name: 'TO_HIGH', value: 255 },
      ],
      output: 'Number',
      colour: DATA,
    },
    {
      type: 'asa_constrain',
      message0: 'ограничить %1 диапазоном от %2 до %3',
      args0: [
        { type: 'input_value', name: 'VALUE', check: 'Number' },
        { type: 'field_number', name: 'MIN', value: 0 },
        { type: 'field_number', name: 'MAX', value: 255 },
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
      args0: [{ type: 'field_input', name: 'NAME', text: 'переменная' }],
      output: null,
      colour: VARIABLES,
    },
    {
      type: 'asa_var_set',
      message0: 'задать %1 равным %2',
      args0: [
        { type: 'field_input', name: 'NAME', text: 'переменная' },
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
        { type: 'field_input', name: 'NAME', text: 'переменная' },
        { type: 'field_number', name: 'VALUE', value: 1 },
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
  const colourExtensions = new Map<string, string>([
    [OUTPUT, 'colours_motion'],
    [INPUT, 'colours_sensing'],
    [COMMENT, 'colours_more'],
    [CONTROL, 'colours_control'],
    [DATA, 'colours_operators'],
    [VARIABLES, 'colours_data'],
  ]);
  for (const definition of definitions) {
    const colour = definition['colour'];
    const colourExtension = typeof colour === 'string' ? colourExtensions.get(colour) : undefined;
    if (!colourExtension) continue;
    const extensions = Array.isArray(definition['extensions']) ? definition['extensions'] : [];
    definition['extensions'] = [...extensions, colourExtension];
    delete definition['colour'];
  }
  ScratchBlocks.defineBlocksWithJsonArray(definitions);
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

export function toolboxForCategory(
  category: ArduinoBlockCategory,
): ScratchBlocks.utils.toolbox.ToolboxInfo {
  return {
    kind: 'flyoutToolbox',
    contents: TOOLBOX_BY_CATEGORY[category].map((type) => ({ kind: 'block', type })),
  };
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

function expression(block: ScratchBlocks.Block | null): string {
  if (!block) return '0';
  const input = (name: string) => expression(block.getInputTargetBlock(name));
  switch (block.type) {
    case 'asa_number':
      return field(block, 'VALUE', '0');
    case 'asa_text':
      return quoted(field(block, 'VALUE'));
    case 'asa_digital_read':
      return `digitalRead(${field(block, 'PIN', '0')})`;
    case 'asa_analog_read':
      return `analogRead(${field(block, 'PIN', 'A0')})`;
    case 'asa_ultrasonic':
      return `readUltrasonicCm(${field(block, 'TRIG', '7')}, ${field(block, 'ECHO', '8')})`;
    case 'asa_pulse_in':
      return `pulseIn(${field(block, 'PIN', '0')}, ${field(block, 'LEVEL', 'HIGH')})`;
    case 'asa_millis':
      return 'millis()';
    case 'asa_temperature':
      return `((analogRead(${field(block, 'PIN', 'A0')}) * (5.0 / 1023.0) - 0.5) * 100.0)`;
    case 'asa_servo_read':
      return `servo_${field(block, 'PIN', '9')}.read()`;
    case 'asa_serial_available':
      return 'Serial.available()';
    case 'asa_serial_read':
      return 'Serial.read()';
    case 'asa_ir_read':
      return `digitalRead(${field(block, 'PIN', '0')})`;
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
    case 'asa_random':
      return `random(${field(block, 'MIN', '1')}, ${Number(field(block, 'MAX', '10')) + 1})`;
    case 'asa_map':
      return `map(${input('VALUE')}, ${field(block, 'FROM_LOW', '0')}, ${field(block, 'FROM_HIGH', '1023')}, ${field(block, 'TO_LOW', '0')}, ${field(block, 'TO_HIGH', '255')})`;
    case 'asa_constrain':
      return `constrain(${input('VALUE')}, ${field(block, 'MIN', '0')}, ${field(block, 'MAX', '255')})`;
    case 'asa_abs':
      return `abs(${input('VALUE')})`;
    case 'asa_level':
      return field(block, 'LEVEL', 'HIGH');
    case 'asa_var_get':
      return identifier(field(block, 'NAME'));
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

function statements(first: ScratchBlocks.Block | null): string {
  const lines: string[] = [];
  let block = first;
  while (block) {
    const nested = (name: string) => statements(block?.getInputTargetBlock(name) ?? null);
    switch (block.type) {
      case 'asa_wait': {
        const amount = Number(field(block, 'TIME', '1'));
        const unit = field(block, 'UNIT', 'SECONDS');
        const value = unit === 'SECONDS' ? amount * 1000 : amount;
        lines.push(
          unit === 'MICROSECONDS'
            ? `delayMicroseconds(${Math.round(value)});`
            : `delay(${Math.round(value)});`,
        );
        break;
      }
      case 'asa_repeat':
        lines.push(
          `for (int repeatIndex = 0; repeatIndex < ${field(block, 'COUNT', '10')}; repeatIndex++) {\n${indent(nested('DO'))}\n}`,
        );
        break;
      case 'asa_forever':
        lines.push(`while (true) {\n${indent(nested('DO'))}\n}`);
        break;
      case 'asa_if':
        lines.push(
          `if (${expression(block.getInputTargetBlock('CONDITION'))}) {\n${indent(nested('DO'))}\n}`,
        );
        break;
      case 'asa_if_else':
        lines.push(
          `if (${expression(block.getInputTargetBlock('CONDITION'))}) {\n${indent(nested('DO'))}\n} else {\n${indent(nested('ELSE'))}\n}`,
        );
        break;
      case 'asa_while':
        lines.push(
          `while (${expression(block.getInputTargetBlock('CONDITION'))}) {\n${indent(nested('DO'))}\n}`,
        );
        break;
      case 'asa_for': {
        const name = identifier(field(block, 'NAME', 'i'));
        const up = field(block, 'DIRECTION', 'UP') === 'UP';
        const from = field(block, 'FROM', '1');
        const to = field(block, 'TO', '10');
        const step = field(block, 'STEP', '1');
        lines.push(
          `for (int ${name} = ${from}; ${name} ${up ? '<=' : '>='} ${to}; ${name} ${up ? '+=' : '-='} ${step}) {\n${indent(nested('DO'))}\n}`,
        );
        break;
      }
      case 'asa_builtin_led':
        lines.push(`digitalWrite(LED_BUILTIN, ${field(block, 'LEVEL', 'HIGH')});`);
        break;
      case 'asa_digital_write':
        lines.push(`digitalWrite(${field(block, 'PIN', '0')}, ${field(block, 'LEVEL', 'HIGH')});`);
        break;
      case 'asa_analog_write':
        lines.push(`analogWrite(${field(block, 'PIN', '3')}, ${field(block, 'VALUE', '0')});`);
        break;
      case 'asa_servo_write':
        lines.push(`servo_${field(block, 'PIN', '9')}.write(${field(block, 'ANGLE', '0')});`);
        break;
      case 'asa_tone':
        lines.push(`tone(${field(block, 'PIN', '8')}, ${field(block, 'FREQUENCY', '440')});`);
        break;
      case 'asa_play_note': {
        const milliseconds = Math.round(Number(field(block, 'DURATION', '1')) * 1000);
        lines.push(
          `tone(${field(block, 'PIN', '8')}, ${field(block, 'FREQUENCY', '262')}, ${milliseconds});`,
          `delay(${milliseconds});`,
        );
        break;
      }
      case 'asa_no_tone':
        lines.push(`noTone(${field(block, 'PIN', '8')});`);
        break;
      case 'asa_serial_print':
        lines.push(
          `Serial.${field(block, 'ENDING', 'LINE') === 'LINE' ? 'println' : 'print'}(${quoted(field(block, 'TEXT'))});`,
        );
        break;
      case 'asa_rgb_write':
        lines.push(
          `analogWrite(${field(block, 'R_PIN', '3')}, ${field(block, 'R', '255')});`,
          `analogWrite(${field(block, 'G_PIN', '5')}, ${field(block, 'G', '0')});`,
          `analogWrite(${field(block, 'B_PIN', '6')}, ${field(block, 'B', '0')});`,
        );
        break;
      case 'asa_lcd_print':
        lines.push(`lcd.print(${quoted(field(block, 'TEXT'))});`);
        break;
      case 'asa_lcd_cursor':
        lines.push(`lcd.setCursor(${field(block, 'COLUMN', '0')}, ${field(block, 'ROW', '0')});`);
        break;
      case 'asa_lcd_clear':
        lines.push('lcd.clear();');
        break;
      case 'asa_7seg_print':
        lines.push(
          `display_${field(block, 'DISPLAY', '1')}.print(${field(block, 'VALUE', '1234')});`,
          `display_${field(block, 'DISPLAY', '1')}.writeDisplay();`,
        );
        break;
      case 'asa_7seg_clear':
        lines.push(
          `display_${field(block, 'DISPLAY', '1')}.clear();`,
          `display_${field(block, 'DISPLAY', '1')}.writeDisplay();`,
        );
        break;
      case 'asa_neopixel_set':
        lines.push(
          `pixels.setPixelColor(${field(block, 'INDEX', '0')}, pixels.Color(${field(block, 'R', '255')}, ${field(block, 'G', '0')}, ${field(block, 'B', '0')}));`,
          'pixels.show();',
        );
        break;
      case 'asa_var_set':
        lines.push(
          `${identifier(field(block, 'NAME'))} = ${expression(block.getInputTargetBlock('VALUE'))};`,
        );
        break;
      case 'asa_var_change':
        lines.push(`${identifier(field(block, 'NAME'))} += ${field(block, 'VALUE', '1')};`);
        break;
      case 'asa_comment':
        lines.push(`// ${field(block, 'TEXT')}`);
        break;
    }
    block = block.getNextBlock();
  }
  return lines.join('\n');
}

export function generateArduinoCode(workspace: ScratchBlocks.Workspace): string {
  const allBlocks = workspace.getAllBlocks(false);
  const setupBlock = allBlocks.find((block) => block.type === 'asa_setup');
  const loopBlock = allBlocks.find((block) => block.type === 'asa_loop');
  const blockTypes = new Set(allBlocks.map((block) => block.type));
  const declarations: string[] = [];
  const setupLines: string[] = [];

  const digitalPins = new Set<string>();
  for (const block of allBlocks) {
    if (block.type === 'asa_builtin_led') digitalPins.add('LED_BUILTIN');
    if (['asa_digital_write', 'asa_tone', 'asa_play_note', 'asa_no_tone'].includes(block.type)) {
      digitalPins.add(field(block, 'PIN', '0'));
    }
  }
  for (const pin of digitalPins) setupLines.push(`pinMode(${pin}, OUTPUT);`);

  const variableNames = new Set(
    allBlocks
      .filter((block) => ['asa_var_get', 'asa_var_set', 'asa_var_change'].includes(block.type))
      .map((block) => identifier(field(block, 'NAME'))),
  );
  for (const name of variableNames) declarations.push(`float ${name} = 0;`);

  const servoPins = new Set(
    allBlocks
      .filter((block) => block.type === 'asa_servo_write' || block.type === 'asa_servo_read')
      .map((block) => field(block, 'PIN', '9')),
  );
  if (servoPins.size > 0) {
    declarations.unshift('#include <Servo.h>');
    for (const pin of servoPins) {
      declarations.push(`Servo servo_${pin};`);
      setupLines.push(`servo_${pin}.attach(${pin});`);
    }
  }

  const lcdSetup = allBlocks.find((block) => block.type === 'asa_lcd_setup');
  const lcdI2cSetup = allBlocks.find((block) => block.type === 'asa_lcd_i2c_setup');
  if (lcdI2cSetup) {
    const [columns, rows] = field(lcdI2cSetup, 'SIZE', '16X2') === '20X4' ? [20, 4] : [16, 2];
    declarations.unshift('#include <LiquidCrystal_I2C.h>');
    declarations.push(
      `LiquidCrystal_I2C lcd(${field(lcdI2cSetup, 'ADDRESS', '0x27')}, ${columns}, ${rows});`,
    );
    setupLines.push('lcd.init();', 'lcd.backlight();');
  } else if (lcdSetup || blockTypes.has('asa_lcd_print') || blockTypes.has('asa_lcd_cursor')) {
    const pins = lcdSetup
      ? ['RS', 'E', 'D4', 'D5', 'D6', 'D7'].map((name) => field(lcdSetup, name))
      : ['12', '11', '5', '4', '3', '2'];
    declarations.unshift('#include <LiquidCrystal.h>');
    declarations.push(`LiquidCrystal lcd(${pins.join(', ')});`);
    setupLines.push('lcd.begin(16, 2);');
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
      declarations.push(`Adafruit_7segment display_${display};`);
      setupLines.push(`display_${display}.begin(${field(setup ?? null, 'ADDRESS', '0x70')});`);
    }
  }

  const pixelSetup = allBlocks.find((block) => block.type === 'asa_neopixel_setup');
  if (pixelSetup || blockTypes.has('asa_neopixel_set')) {
    const pin = pixelSetup ? field(pixelSetup, 'PIN', '6') : '6';
    const count = pixelSetup ? field(pixelSetup, 'COUNT', '8') : '8';
    declarations.unshift('#include <Adafruit_NeoPixel.h>');
    declarations.push(`Adafruit_NeoPixel pixels(${count}, ${pin}, NEO_GRB + NEO_KHZ800);`);
    setupLines.push('pixels.begin();');
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
  const loopBody = statements(loopBlock?.getInputTargetBlock('DO') ?? null);
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
  ledHigh.setFieldValue('HIGH', 'LEVEL');
  ledLow.setFieldValue('LOW', 'LEVEL');
  waitHigh.setFieldValue(1, 'TIME');
  waitLow.setFieldValue(1, 'TIME');
  loop.getInput('DO')?.connection?.connect(ledHigh.previousConnection);
  ledHigh.nextConnection?.connect(waitHigh.previousConnection);
  waitHigh.nextConnection?.connect(ledLow.previousConnection);
  ledLow.nextConnection?.connect(waitLow.previousConnection);
  setup.moveBy(330, 120);
  loop.moveBy(330, 280);
}

export function readArduinoProgramState(
  properties: Readonly<Record<string, string | number | boolean | readonly string[]>> | undefined,
): ArduinoProgramState {
  const mode = properties?.['arduinoCodeMode'];
  const baud = properties?.['arduinoBaudRate'];
  return {
    mode: mode === 'blocks-text' || mode === 'text' ? mode : 'blocks',
    workspaceJson:
      typeof properties?.['arduinoWorkspace'] === 'string' ? properties['arduinoWorkspace'] : '',
    source:
      typeof properties?.['arduinoSource'] === 'string'
        ? properties['arduinoSource']
        : DEFAULT_ARDUINO_SOURCE,
    serialOpen: properties?.['arduinoSerialOpen'] === true,
    baudRate: typeof baud === 'number' && Number.isFinite(baud) ? baud : 9600,
  };
}
