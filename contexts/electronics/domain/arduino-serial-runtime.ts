export const ARDUINO_SERIAL_TX_HISTORY_LIMIT = 256 as const;
export const ARDUINO_SERIAL_TX_TEXT_LIMIT = 1024 as const;
export const ARDUINO_SERIAL_RX_BUFFER_LIMIT = 256 as const;
export const ARDUINO_SERIAL_RX_INGRESS_TEXT_LIMIT = 1024 as const;
const MAX_BAUD_RATE = 4_294_967_295;

interface ArduinoSerialTxEntry {
  readonly sequence: number;
  readonly atMicroseconds: number;
  readonly text: string;
}

interface ArduinoSerialRxEntry {
  readonly sequence: number;
  readonly atMicroseconds: number;
  readonly byte: number;
}

export interface ArduinoSerialState {
  readonly version: 1;
  readonly begun: boolean;
  readonly baudRate?: number | undefined;
  readonly nextTxSequence: number;
  readonly tx: readonly ArduinoSerialTxEntry[];
  readonly nextRxSequence?: number | undefined;
  readonly rx?: readonly ArduinoSerialRxEntry[] | undefined;
}

export function initialArduinoSerialState(): ArduinoSerialState {
  return { version: 1, begun: false, nextTxSequence: 0, tx: [], nextRxSequence: 0, rx: [] };
}

export function isArduinoSerialState(value: unknown): value is ArduinoSerialState {
  if (!value || typeof value !== 'object') return false;
  const state = value as Partial<ArduinoSerialState>;
  if (
    state.version !== 1 ||
    typeof state.begun !== 'boolean' ||
    !Number.isSafeInteger(state.nextTxSequence) ||
    (state.nextTxSequence ?? -1) < 0 ||
    !Array.isArray(state.tx) ||
    state.tx.length > ARDUINO_SERIAL_TX_HISTORY_LIMIT
  )
    return false;
  if (
    state.begun !== (state.baudRate !== undefined) ||
    (state.baudRate !== undefined &&
      (!Number.isSafeInteger(state.baudRate) ||
        state.baudRate <= 0 ||
        state.baudRate > MAX_BAUD_RATE))
  )
    return false;
  const txValid = state.tx.every(
    (entry, index) =>
      entry !== null &&
      typeof entry === 'object' &&
      Number.isSafeInteger(entry.sequence) &&
      entry.sequence >= 0 &&
      entry.sequence < state.nextTxSequence! &&
      (index === 0 || entry.sequence > state.tx![index - 1]!.sequence) &&
      Number.isSafeInteger(entry.atMicroseconds) &&
      entry.atMicroseconds >= 0 &&
      (index === 0 || entry.atMicroseconds >= state.tx![index - 1]!.atMicroseconds) &&
      typeof entry.text === 'string' &&
      entry.text.length <= ARDUINO_SERIAL_TX_TEXT_LIMIT,
  );
  if (!txValid) return false;

  const hasRx = state.rx !== undefined || state.nextRxSequence !== undefined;
  if (!hasRx) return true;
  if (
    !Array.isArray(state.rx) ||
    state.rx.length > ARDUINO_SERIAL_RX_BUFFER_LIMIT ||
    !Number.isSafeInteger(state.nextRxSequence) ||
    (state.nextRxSequence ?? -1) < 0
  )
    return false;
  return state.rx.every(
    (entry, index) =>
      entry !== null &&
      typeof entry === 'object' &&
      Number.isSafeInteger(entry.sequence) &&
      entry.sequence >= 0 &&
      entry.sequence < state.nextRxSequence! &&
      (index === 0 || entry.sequence > state.rx![index - 1]!.sequence) &&
      Number.isSafeInteger(entry.atMicroseconds) &&
      entry.atMicroseconds >= 0 &&
      (index === 0 || entry.atMicroseconds >= state.rx![index - 1]!.atMicroseconds) &&
      Number.isInteger(entry.byte) &&
      entry.byte >= 0 &&
      entry.byte <= 255,
  );
}

export function beginArduinoSerial(
  state: ArduinoSerialState,
  baudRate: number,
): ArduinoSerialState {
  if (!isArduinoSerialState(state)) throw new TypeError('Invalid Arduino Serial state.');
  if (!Number.isSafeInteger(baudRate) || baudRate <= 0 || baudRate > MAX_BAUD_RATE)
    throw new RangeError('Serial.begin() baud rate must be a positive unsigned long.');
  return { ...state, begun: true, baudRate };
}

export function formatArduinoSerialNumber(value: number): string {
  if (!Number.isFinite(value)) throw new RangeError('Serial output must be finite.');
  return Object.is(value, -0) ? '0' : String(value);
}

export function appendArduinoSerialTx(
  state: ArduinoSerialState,
  atMicroseconds: number,
  text: string,
  newline = false,
): ArduinoSerialState {
  if (!isArduinoSerialState(state)) throw new TypeError('Invalid Arduino Serial state.');
  if (!Number.isSafeInteger(atMicroseconds) || atMicroseconds < 0)
    throw new RangeError('Serial TX timestamp must be a non-negative canonical microsecond.');
  if (!state.begun) return state;

  const payload = newline
    ? `${text.slice(0, ARDUINO_SERIAL_TX_TEXT_LIMIT - 1)}\n`
    : text.slice(0, ARDUINO_SERIAL_TX_TEXT_LIMIT);
  const entry: ArduinoSerialTxEntry = {
    sequence: state.nextTxSequence,
    atMicroseconds,
    text: payload,
  };
  const tx = [...state.tx, entry];
  if (tx.length > ARDUINO_SERIAL_TX_HISTORY_LIMIT)
    tx.splice(0, tx.length - ARDUINO_SERIAL_TX_HISTORY_LIMIT);
  return { ...state, nextTxSequence: state.nextTxSequence + 1, tx };
}

function utf8Bytes(text: string): readonly number[] {
  const bytes: number[] = [];
  for (const character of text) {
    const codePoint = character.codePointAt(0)!;
    if (codePoint <= 0x7f) bytes.push(codePoint);
    else if (codePoint <= 0x7ff) {
      bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint <= 0xffff) {
      bytes.push(
        0xe0 | (codePoint >> 12),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    } else {
      bytes.push(
        0xf0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 0x3f),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    }
  }
  return bytes;
}

export function enqueueArduinoSerialRx(
  state: ArduinoSerialState,
  atMicroseconds: number,
  payload: string,
): ArduinoSerialState {
  if (!isArduinoSerialState(state)) throw new TypeError('Invalid Arduino Serial state.');
  if (!Number.isSafeInteger(atMicroseconds) || atMicroseconds < 0)
    throw new RangeError('Serial RX timestamp must be a non-negative canonical microsecond.');
  if (payload.length > ARDUINO_SERIAL_RX_INGRESS_TEXT_LIMIT)
    throw new RangeError('Serial RX payload exceeds the bounded ingress size.');
  if (!state.begun) return state;

  const rx = [...(state.rx ?? [])];
  let nextRxSequence = state.nextRxSequence ?? 0;
  const capacity = ARDUINO_SERIAL_RX_BUFFER_LIMIT - rx.length;
  for (const byte of utf8Bytes(payload).slice(0, capacity)) {
    rx.push({ sequence: nextRxSequence, atMicroseconds, byte });
    nextRxSequence += 1;
  }
  return { ...state, nextRxSequence, rx };
}

export function arduinoSerialAvailable(state: ArduinoSerialState | undefined): number {
  return state?.begun ? (state.rx?.length ?? 0) : 0;
}

export function readArduinoSerial(state: ArduinoSerialState | undefined): {
  readonly state: ArduinoSerialState | undefined;
  readonly value: number;
} {
  if (!state?.begun) return { state, value: -1 };
  if (!isArduinoSerialState(state)) throw new TypeError('Invalid Arduino Serial state.');
  const rx = state.rx ?? [];
  if (rx.length === 0) return { state, value: -1 };
  return { state: { ...state, rx: rx.slice(1) }, value: rx[0]!.byte };
}

export function splitArduinoSerialArguments(source: string): readonly string[] {
  if (!source.trim()) return [];
  const parts: string[] = [];
  let start = 0;
  let depth = 0;
  let quote = false;
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index] ?? '';
    if (quote) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') quote = false;
      continue;
    }
    if (character === '"') {
      quote = true;
      continue;
    }
    if (character === '(') depth += 1;
    else if (character === ')') depth -= 1;
    else if (character === ',' && depth === 0) {
      parts.push(source.slice(start, index).trim());
      start = index + 1;
    }
  }
  if (quote || depth !== 0) throw new SyntaxError('Malformed Serial argument list.');
  parts.push(source.slice(start).trim());
  if (parts.some((part) => part.length === 0)) throw new SyntaxError('Empty Serial argument.');
  return parts;
}

export function parseArduinoSerialStringLiteral(source: string): string | null {
  const value = source.trim();
  if (!value.startsWith('"')) return null;
  if (value.length < 2 || !value.endsWith('"'))
    throw new SyntaxError('Serial string literal must have a closing quote.');
  let result = '';
  for (let index = 1; index < value.length - 1; index += 1) {
    const character = value[index] ?? '';
    if (character !== '\\') {
      result += character;
      continue;
    }
    const escaped = value[++index];
    if (escaped === undefined) throw new SyntaxError('Incomplete escape in Serial string literal.');
    const replacements: Readonly<Record<string, string>> = {
      n: '\n',
      r: '\r',
      t: '\t',
      '"': '"',
      '\\': '\\',
    };
    if (!Object.hasOwn(replacements, escaped))
      throw new SyntaxError(`Unsupported escape \\${escaped} in Serial string literal.`);
    result += replacements[escaped]!;
  }
  return result;
}
