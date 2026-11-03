import type * as ScratchBlocks from 'scratch-blocks';
import { ARDUINO_DIGITAL_PIN_OPTIONS } from './arduino-block-schema';
import { literalArduinoPin } from './arduino-pin-inputs';

const INPUTS: Readonly<Record<string, readonly [string, string, boolean]>> = {
  asa_digital_read: ['PIN', '0', false],
  asa_analog_read: ['PIN', 'A0', true],
  asa_temperature: ['PIN', 'A0', true],
  asa_ir_read: ['PIN', '0', false],
  asa_pulse_in: ['PIN', '0', false],
  asa_ultrasonic: ['ECHO', '8', false],
};

/** Only prove small integral constants. Runtime reporters and mutable variables
 * deliberately remain unresolved; this is not a control-flow/range analyser. */
function constantPinValue(
  value: ScratchBlocks.Block | null,
  blocks: readonly ScratchBlocks.Block[],
): number | null {
  if (!value) return 0;
  const raw = value.getFieldValue('VALUE');
  if (['asa_number', 'asa_pin', 'asa_pwm_pin', 'asa_analog_pin'].includes(value.type)) {
    const analog = /^A([0-5])$/.exec(String(raw));
    const number = analog ? 14 + Number(analog[1]) : Number(raw);
    return Number.isFinite(number) ? number : null;
  }
  if (value.type === 'asa_level') return value.getFieldValue('LEVEL') === 'LOW' ? 0 : 1;
  if (value.type === 'asa_var_get') {
    // Generated identifiers may alias after sanitising pupil variable names.
    const name = (block: ScratchBlocks.Block) => {
      const id = String(block.getFieldValue('NAME'));
      return (
        (block.workspace.getVariableMap().getVariableById(id)?.getName() ?? id)
          .trim()
          .replace(/[^a-zA-Z0-9_\u0400-\u04ff]/g, '_') || 'variable'
      );
    };
    return blocks.some(
      (block) =>
        block.type === 'asa_for' ||
        (['asa_var_set', 'asa_var_change'].includes(block.type) && name(block) === name(value)),
    )
      ? null
      : 0;
  }
  const a = constantPinValue(value.getInputTargetBlock('A'), blocks);
  const b = constantPinValue(value.getInputTargetBlock('B'), blocks);
  if (
    a === null ||
    b === null ||
    !Number.isInteger(a) ||
    !Number.isInteger(b) ||
    a < -32768 ||
    a > 32767 ||
    b < -32768 ||
    b > 32767
  )
    return null;
  let result: number;
  switch (value.type) {
    case 'asa_math_add':
      result = a + b;
      break;
    case 'asa_math_minus':
      result = a - b;
      break;
    case 'asa_math_multiply':
      result = a * b;
      break;
    case 'asa_compare_eq':
      return Number(a === b);
    case 'asa_compare_lt':
      return Number(a < b);
    case 'asa_compare_gt':
      return Number(a > b);
    default:
      return null;
  }
  return result >= -32768 && result <= 32767 ? result : null;
}

function canonicalPin(raw: string | number, analog = false): string | null {
  const alias = /^A([0-5])$/.exec(String(raw));
  let number = alias ? 14 + Number(alias[1]) : Math.trunc(Number(raw));
  if (!Number.isFinite(number)) return null;
  number = ((number % 256) + 256) % 256;
  if (analog && number >= 6 && number < 14) return null;
  if (analog && number < 6) number += 14;
  return ARDUINO_DIGITAL_PIN_OPTIONS[number]?.[1] ?? null;
}

export function arduinoPinSetup(
  blocks: readonly ScratchBlocks.Block[],
  inputPins: readonly string[] = [],
) {
  const inputs = new Set<string>();
  for (const raw of inputPins) {
    if (!/^(?:[0-9]|1[0-9]|A[0-5])$/.test(raw)) continue;
    const pin = canonicalPin(raw);
    if (pin !== null) inputs.add(pin);
  }
  const unresolvedInputs: string[] = [];
  for (const block of blocks) {
    const role = INPUTS[block.type];
    if (!role) continue;
    const [name, fallback, analog] = role;
    const raw =
      literalArduinoPin(block, name, fallback) ??
      constantPinValue(block.getInputTargetBlock(name), blocks);
    const pin = raw === null ? null : canonicalPin(raw, analog);
    if (pin === null) unresolvedInputs.push(`${block.type}.${name}`);
    else inputs.add(pin);
  }
  // Hardware UART owns RX once Serial is enabled, including print-only sketches.
  if (blocks.some((block) => block.type.startsWith('asa_serial_'))) inputs.add('0');
  return { inputs, unresolvedInputs };
}

export function arduinoSetupModes(inputs: ReadonlySet<string>): string[] {
  return ARDUINO_DIGITAL_PIN_OPTIONS.map(
    ([, pin]) => `pinMode(${pin}, ${inputs.has(pin!) ? 'INPUT' : 'OUTPUT'});`,
  );
}
