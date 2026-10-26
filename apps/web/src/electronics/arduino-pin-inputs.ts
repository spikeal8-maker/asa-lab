import type * as ScratchBlocks from 'scratch-blocks';

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

/** A dropdown shadow and a plain number are static; any other reporter is
 * evaluated when its command executes. Old direct field callers remain readable. */
export function literalArduinoPin(
  block: ScratchBlocks.Block | null,
  name = 'PIN',
  fallback = '0',
): string | null {
  if (!block) return fallback;
  const value = block.getInputTargetBlock(name);
  if (!value) return String(block.getFieldValue(name) ?? fallback);
  if (ARDUINO_PIN_REPORTERS.has(value.type) || value.type === 'asa_number')
    return String(value.getFieldValue('VALUE') ?? fallback);
  return null;
}

export function literalArduinoServoPin(block: ScratchBlocks.Block): string | null {
  const raw = literalArduinoPin(block, 'PIN', '9');
  if (raw === null) return null;
  const analog = /^A([0-5])$/.exec(raw);
  const number = analog ? 14 + Number(analog[1]) : Number(raw);
  return Number.isInteger(number) && number >= 0 && number <= 19 ? String(number) : null;
}

/** Code and presentation share the same connected Arduino program. Keep the
 * workspace's existing first-root order, including when old saves have duplicates. */
export function activeArduinoGraph(workspace: ScratchBlocks.Workspace) {
  const blocks = workspace.getAllBlocks(false);
  const setup = blocks.find((block) => block.type === 'asa_setup');
  const loop = blocks.find((block) => block.type === 'asa_loop');
  const fallback =
    setup || loop
      ? []
      : blocks.filter(
          (block) => !block.getParent() && block.previousConnection && !block.outputConnection,
        );
  const active = new Set<ScratchBlocks.Block>();
  const pending =
    setup || loop ? [setup, loop].filter((block) => block !== undefined) : [...fallback];
  while (pending.length > 0) {
    const block = pending.pop()!;
    if (active.has(block)) continue;
    active.add(block);
    for (const input of block.inputList) {
      const child = input.connection?.targetBlock();
      if (child) pending.push(child);
    }
    const next = block.getNextBlock();
    if (next) pending.push(next);
  }
  return { setup, loop, fallback, blocks: blocks.filter((block) => active.has(block)), active };
}

export function fixedArduinoServoPins(workspace: ScratchBlocks.Workspace): string[] {
  return [
    ...new Set(
      activeArduinoGraph(workspace)
        .blocks.filter(
          (block) => block.type === 'asa_servo_write' || block.type === 'asa_servo_read',
        )
        .map(literalArduinoServoPin)
        .filter((pin): pin is string => pin !== null),
    ),
  ];
}

function servoSlots(fixedPins: readonly string[], nameFor: (prefix: string) => string) {
  return Array.from({ length: Math.max(0, 12 - fixedPins.length) }, (_, i) => ({
    object: nameFor(`asaDynamicServo${i}`),
    pin: nameFor(`asaDynamicServoPin${i}`),
  }));
}

/** Native Uno has twelve Servo channels. Allocate lazily, share literal and
 * computed pins, and emit only ordinary statements supported by both targets. */
export function dynamicArduinoServoSource(
  fixedPins: readonly string[],
  nameFor: (prefix: string) => string,
): readonly string[] {
  return servoSlots(fixedPins, nameFor).flatMap((slot) => [
    `Servo ${slot.object};`,
    `int ${slot.pin} = -1;`,
  ]);
}

export function dynamicArduinoServoWriteSource(
  fixedPins: readonly string[],
  nameFor: (prefix: string) => string,
  pinExpression: string,
  angleExpression: string,
): string {
  const pin = nameFor('asaServoWritePin'),
    angle = nameFor('asaServoWriteAngle'),
    done = nameFor('asaServoWritten');
  const slots = servoSlots(fixedPins, nameFor);
  const body = [
    `int ${pin} = ${pinExpression};`,
    `int ${angle} = ${angleExpression};`,
    `bool ${done} = false;`,
    ...fixedPins.map(
      (n) =>
        `if (${done} == false && ${pin} == ${n}) { ${nameFor(`servo_${n}`)}.write(${angle}); ${done} = true; }`,
    ),
    ...slots.map(
      (slot) =>
        `if (${done} == false && ${slot.pin} == ${pin}) { ${slot.object}.write(${angle}); ${done} = true; }`,
    ),
    ...slots.map(
      (slot) =>
        `if (${done} == false && ${slot.pin} < 0) { ${slot.object}.attach(${pin}); ${slot.pin} = ${pin}; ${slot.object}.write(${angle}); ${done} = true; }`,
    ),
  ]
    .map((line) => `  ${line}`)
    .join('\n');
  return `{\n${body}\n}`;
}

export function dynamicArduinoServoReadSource(
  fixedPins: readonly string[],
  nameFor: (prefix: string) => string,
  pinExpression: string,
  pinName: string,
  resultName: string,
): string[] {
  return [
    `int ${pinName} = ${pinExpression};`,
    `int ${resultName} = 90;`,
    ...fixedPins.map(
      (n) => `if (${pinName} == ${n}) { ${resultName} = ${nameFor(`servo_${n}`)}.read(); }`,
    ),
    ...servoSlots(fixedPins, nameFor).map(
      (slot) =>
        `if (${slot.pin} >= 0 && ${slot.pin} == ${pinName}) { ${resultName} = ${slot.object}.read(); }`,
    ),
  ];
}
