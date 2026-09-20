import type { Terminal } from './document.js';
import {
  advanceArduinoTimedWaveform,
  arduinoWaveformNextDueMicroseconds,
  createArduinoTimedWaveform,
  isArduinoTimedWaveformState,
  type ArduinoTimedWaveformState,
} from './arduino-waveform-runtime.js';

export const ARDUINO_SERVO_PROFILE = {
  refreshMicroseconds: 20_000,
  frequencyHz: 50,
  minimumPulseMicroseconds: 544,
  maximumPulseMicroseconds: 2_400,
  defaultPulseMicroseconds: 1_500,
} as const;

export interface ArduinoServoObjectState {
  readonly attached: boolean;
  readonly pin?: Terminal | undefined;
  readonly commandedAngle: number;
  readonly pulseWidthMicroseconds: number;
  readonly waveform?: ArduinoTimedWaveformState | undefined;
}

export interface ArduinoServoRuntimeState {
  readonly version: 1;
  readonly objects: Readonly<Record<string, ArduinoServoObjectState>>;
}

function validName(name: string): boolean {
  return /^[A-Za-z_]\w*$/.test(name);
}

function validTerminal(value: unknown): value is Terminal {
  return typeof value === 'string' && /^(?:d(?:[0-9]|1[0-3])|a[0-5])$/.test(value);
}

export function arduinoServoDeclarationNames(source: string): readonly string[] {
  if (!/^\s*#\s*include\s*<Servo\.h>\s*$/m.test(source)) return [];
  const masked = source.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, (text) =>
    ' '.repeat(text.length),
  );
  const names: string[] = [];
  for (const match of masked.matchAll(/\bServo\s+([A-Za-z_]\w*)\s*;/g)) {
    let depth = 0;
    for (const character of source.slice(0, match.index ?? 0)) {
      if (character === '{') depth += 1;
      else if (character === '}') depth = Math.max(0, depth - 1);
    }
    if (depth === 0 && !names.includes(match[1]!)) names.push(match[1]!);
  }
  return names.sort();
}

function initialObject(): ArduinoServoObjectState {
  return {
    attached: false,
    commandedAngle: 90,
    pulseWidthMicroseconds: ARDUINO_SERVO_PROFILE.defaultPulseMicroseconds,
  };
}

export function initialArduinoServoRuntimeState(
  declarations: readonly string[],
): ArduinoServoRuntimeState {
  if (declarations.some((name) => !validName(name)))
    throw new TypeError('Invalid Servo declaration name.');
  return {
    version: 1,
    objects: Object.fromEntries(
      [...new Set(declarations)].sort().map((name) => [name, initialObject()]),
    ),
  };
}

export function isArduinoServoRuntimeState(value: unknown): value is ArduinoServoRuntimeState {
  if (!value || typeof value !== 'object') return false;
  const state = value as Partial<ArduinoServoRuntimeState>;
  if (state.version !== 1 || !state.objects || typeof state.objects !== 'object') return false;
  return Object.entries(state.objects).every(([name, object]) => {
    if (!validName(name) || !object || typeof object !== 'object') return false;
    const item = object as Partial<ArduinoServoObjectState>;
    return (
      typeof item.attached === 'boolean' &&
      typeof item.commandedAngle === 'number' &&
      Number.isInteger(item.commandedAngle) &&
      item.commandedAngle >= 0 &&
      item.commandedAngle <= 180 &&
      typeof item.pulseWidthMicroseconds === 'number' &&
      Number.isSafeInteger(item.pulseWidthMicroseconds) &&
      item.pulseWidthMicroseconds >= ARDUINO_SERVO_PROFILE.minimumPulseMicroseconds &&
      item.pulseWidthMicroseconds <= ARDUINO_SERVO_PROFILE.maximumPulseMicroseconds &&
      (item.pin === undefined || validTerminal(item.pin)) &&
      (item.waveform === undefined || isArduinoTimedWaveformState(item.waveform)) &&
      (!item.attached || (item.pin !== undefined && item.waveform !== undefined)) &&
      (item.attached || (item.pin === undefined && item.waveform === undefined))
    );
  });
}

export function syncArduinoServoDeclarations(
  state: ArduinoServoRuntimeState | undefined,
  declarations: readonly string[],
): ArduinoServoRuntimeState {
  const fresh = initialArduinoServoRuntimeState(declarations);
  if (!state || !isArduinoServoRuntimeState(state)) return fresh;
  const expected = Object.keys(fresh.objects);
  const actual = Object.keys(state.objects).sort();
  if (expected.length === actual.length && expected.every((name, index) => name === actual[index]))
    return state;
  return {
    version: 1,
    objects: Object.fromEntries(
      expected.map((name) => [name, state.objects[name] ?? initialObject()]),
    ),
  };
}

export function arduinoServoPulseWidthMicroseconds(angleDegrees: number): number {
  const angle = Math.min(180, Math.max(0, Math.round(angleDegrees)));
  const span =
    ARDUINO_SERVO_PROFILE.maximumPulseMicroseconds - ARDUINO_SERVO_PROFILE.minimumPulseMicroseconds;
  return Math.round(ARDUINO_SERVO_PROFILE.minimumPulseMicroseconds + (span * angle) / 180);
}

function waveformFor(
  existing: ArduinoTimedWaveformState | undefined,
  atMicroseconds: number,
  pulseWidthMicroseconds: number,
): ArduinoTimedWaveformState {
  const startedAtMicroseconds = existing?.startedAtMicroseconds ?? atMicroseconds;
  const rebuilt = createArduinoTimedWaveform(
    startedAtMicroseconds,
    ARDUINO_SERVO_PROFILE.frequencyHz,
    undefined,
    pulseWidthMicroseconds,
    ARDUINO_SERVO_PROFILE.refreshMicroseconds,
  );
  return advanceArduinoTimedWaveform(rebuilt, atMicroseconds).state ?? rebuilt;
}

function replaceObject(
  state: ArduinoServoRuntimeState,
  name: string,
  object: ArduinoServoObjectState,
): ArduinoServoRuntimeState {
  if (!(name in state.objects)) throw new SyntaxError(`Servo object «${name}» не объявлен.`);
  return { ...state, objects: { ...state.objects, [name]: object } };
}

export function attachArduinoServo(
  state: ArduinoServoRuntimeState,
  name: string,
  pin: Terminal,
  atMicroseconds: number,
): ArduinoServoRuntimeState {
  if (!isArduinoServoRuntimeState(state)) throw new TypeError('Invalid Servo runtime state.');
  const conflict = Object.entries(state.objects).find(
    ([otherName, object]) => otherName !== name && object.attached && object.pin === pin,
  );
  if (conflict) throw new SyntaxError(`Вывод ${pin} уже занят Servo object «${conflict[0]}».`);
  const current = state.objects[name];
  if (!current) throw new SyntaxError(`Servo object «${name}» не объявлен.`);
  const pulse = current.attached
    ? current.pulseWidthMicroseconds
    : ARDUINO_SERVO_PROFILE.defaultPulseMicroseconds;
  return replaceObject(state, name, {
    ...current,
    attached: true,
    pin,
    pulseWidthMicroseconds: pulse,
    waveform: waveformFor(undefined, atMicroseconds, pulse),
  });
}

export function writeArduinoServo(
  state: ArduinoServoRuntimeState,
  name: string,
  angleDegrees: number,
  atMicroseconds: number,
): ArduinoServoRuntimeState {
  const current = state.objects[name];
  if (!current) throw new SyntaxError(`Servo object «${name}» не объявлен.`);
  const commandedAngle = Math.min(180, Math.max(0, Math.round(angleDegrees)));
  const pulseWidthMicroseconds = arduinoServoPulseWidthMicroseconds(commandedAngle);
  return replaceObject(state, name, {
    ...current,
    commandedAngle,
    pulseWidthMicroseconds,
    ...(current.attached
      ? { waveform: waveformFor(current.waveform, atMicroseconds, pulseWidthMicroseconds) }
      : {}),
  });
}

export function readArduinoServo(state: ArduinoServoRuntimeState, name: string): number {
  const object = state.objects[name];
  if (!object) throw new SyntaxError(`Servo object «${name}» не объявлен.`);
  return object.commandedAngle;
}

export function detachArduinoServo(
  state: ArduinoServoRuntimeState,
  name: string,
): ArduinoServoRuntimeState {
  const current = state.objects[name];
  if (!current) throw new SyntaxError(`Servo object «${name}» не объявлен.`);
  return replaceObject(state, name, {
    ...current,
    attached: false,
    pin: undefined,
    waveform: undefined,
  });
}

export function arduinoServoWaveforms(state: ArduinoServoRuntimeState | undefined): readonly {
  readonly name: string;
  readonly pin: Terminal;
  readonly waveform: ArduinoTimedWaveformState;
}[] {
  if (!state) return [];
  return Object.entries(state.objects)
    .flatMap(([name, object]) =>
      object.attached && object.pin && object.waveform
        ? [{ name, pin: object.pin, waveform: object.waveform }]
        : [],
    )
    .sort((a, b) => (a.pin < b.pin ? -1 : a.pin > b.pin ? 1 : a.name.localeCompare(b.name)));
}

export function arduinoServoNextDueMicroseconds(
  state: ArduinoServoRuntimeState | undefined,
): number {
  return Math.min(
    ...arduinoServoWaveforms(state).map(({ waveform }) =>
      arduinoWaveformNextDueMicroseconds(waveform),
    ),
    Number.POSITIVE_INFINITY,
  );
}

export function advanceArduinoServoWaveforms(
  state: ArduinoServoRuntimeState,
  atMicroseconds: number,
): { readonly state: ArduinoServoRuntimeState; readonly levelChanged: boolean } {
  let next = state;
  let levelChanged = false;
  for (const { name, waveform } of arduinoServoWaveforms(state)) {
    if (arduinoWaveformNextDueMicroseconds(waveform) !== atMicroseconds) continue;
    const advanced = advanceArduinoTimedWaveform(waveform, atMicroseconds);
    if (!advanced.state) continue;
    next = replaceObject(next, name, { ...next.objects[name]!, waveform: advanced.state });
    levelChanged ||= advanced.levelChanged;
  }
  return { state: next, levelChanged };
}
