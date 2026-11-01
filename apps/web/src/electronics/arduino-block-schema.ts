/** Pure workspace format shared by the editor and read-only publication renderer. */
import * as ScratchBlocks from 'scratch-blocks';

export const ARDUINO_DIGITAL_PIN_OPTIONS = [
  ...Array.from({ length: 14 }, (_, pin) => [String(pin), String(pin)]),
  ...Array.from({ length: 6 }, (_, pin) => [`A${pin}`, `A${pin}`]),
];
export const ARDUINO_PWM_PIN_OPTIONS = ['3', '5', '6', '9', '10', '11'].map((pin) => [pin, pin]);
export const ARDUINO_ANALOG_PIN_OPTIONS = Array.from({ length: 6 }, (_, pin) => [
  `A${pin}`,
  `A${pin}`,
]);

export type ArduinoPinReporter = 'asa_pin' | 'asa_pwm_pin' | 'asa_analog_pin';
export const ARDUINO_PIN_REPORTERS = new Set(['asa_pin', 'asa_pwm_pin', 'asa_analog_pin']);
export const ARDUINO_PIN_INPUTS: Readonly<
  Record<string, Readonly<Record<string, ArduinoPinReporter>>>
> = {
  asa_digital_write: { PIN: 'asa_pin' },
  asa_analog_write: { PIN: 'asa_pwm_pin' },
  asa_servo_write: { PIN: 'asa_pin' },
  asa_tone: { PIN: 'asa_pin' },
  asa_play_note: { PIN: 'asa_pin' },
  asa_no_tone: { PIN: 'asa_pin' },
  asa_rgb_write: { R_PIN: 'asa_pwm_pin', G_PIN: 'asa_pwm_pin', B_PIN: 'asa_pwm_pin' },
  asa_lcd_setup: {
    RS: 'asa_pin',
    E: 'asa_pin',
    D4: 'asa_pin',
    D5: 'asa_pin',
    D6: 'asa_pin',
    D7: 'asa_pin',
  },
  asa_neopixel_setup: { PIN: 'asa_pin' },
  asa_digital_read: { PIN: 'asa_pin' },
  asa_analog_read: { PIN: 'asa_analog_pin' },
  asa_ultrasonic: { TRIG: 'asa_pin', ECHO: 'asa_pin' },
  asa_pulse_in: { PIN: 'asa_pin' },
  asa_temperature: { PIN: 'asa_analog_pin' },
  asa_servo_read: { PIN: 'asa_pin' },
  asa_ir_read: { PIN: 'asa_pin' },
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

export const TOOLBOX_INPUT_DEFAULTS: Readonly<
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

export const TOOLBOX_FIELD_DEFAULTS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  asa_wait: { UNIT: 'SECONDS' },
  asa_for: { NAME: 'i' },

  asa_number: { VALUE: '0' },
  asa_text: { VALUE: 'текст' },
};

// Only former literal fields need a replacement on restore. Existing value
// connections may deliberately be empty: filling an old empty condition with
// HIGH, for example, would change a saved program's behavior.
export const CONVERTED_INPUTS: Readonly<Record<string, readonly string[]>> = {
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

export const VARIABLE_BLOCK_TYPES = new Set(['asa_var_get', 'asa_var_set', 'asa_var_change']);

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
