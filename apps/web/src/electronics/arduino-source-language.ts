import {
  arduinoTextCommandSupport,
  type ArduinoSupportStatus,
  type ArduinoTextCommand,
} from '@asa-lab/electronics';

export type ArduinoSourceTokenKind =
  | 'plain'
  | 'keyword'
  | 'type'
  | 'builtin'
  | 'constant'
  | 'number'
  | 'string'
  | 'comment'
  | 'preprocessor';

export type ArduinoSourceToken = {
  readonly kind: ArduinoSourceTokenKind;
  readonly text: string;
};

export type ArduinoCompletion = {
  readonly label: string;
  readonly detail: string;
  readonly insertText: string;
  readonly example: string;
  readonly lineComplete: boolean;
  readonly support: ArduinoSupportStatus;
};

const KEYWORDS = new Set([
  'break',
  'case',
  'continue',
  'default',
  'do',
  'else',
  'for',
  'goto',
  'if',
  'return',
  'sizeof',
  'switch',
  'while',
]);

const TYPES = new Set([
  'bool',
  'boolean',
  'byte',
  'char',
  'const',
  'double',
  'float',
  'int',
  'long',
  'short',
  'signed',
  'String',
  'unsigned',
  'void',
  'word',
]);

const CONSTANTS = new Set([
  'A0',
  'A1',
  'A2',
  'A3',
  'A4',
  'A5',
  'CHANGE',
  'DEC',
  'FALLING',
  'false',
  'HIGH',
  'HEX',
  'INPUT',
  'INPUT_PULLUP',
  'LED_BUILTIN',
  'LOW',
  'OCT',
  'OUTPUT',
  'PI',
  'RISING',
  'true',
]);

const BUILTINS = new Set([
  'analogRead',
  'analogReference',
  'analogWrite',
  'attachInterrupt',
  'begin',
  'delay',
  'delayMicroseconds',
  'detachInterrupt',
  'digitalRead',
  'digitalWrite',
  'end',
  'loop',
  'map',
  'micros',
  'millis',
  'noInterrupts',
  'noTone',
  'pinMode',
  'print',
  'println',
  'pulseIn',
  'random',
  'randomSeed',
  'read',
  'Serial',
  'setTimeout',
  'setup',
  'shiftIn',
  'shiftOut',
  'tone',
  'write',
]);

type ArduinoCompletionDefinition = Omit<ArduinoCompletion, 'support'>;

const COMPLETION_DEFINITIONS = {
  setup: {
    label: 'setup',
    detail: 'Настройка при запуске',
    insertText: 'void setup() {\n  pinMode(13, OUTPUT);\n}',
    example: 'void setup() { … }',
    lineComplete: true,
  },
  loop: {
    label: 'loop',
    detail: 'Повторяющаяся программа',
    insertText: 'void loop() {\n  digitalWrite(13, HIGH);\n}',
    example: 'void loop() { … }',
    lineComplete: true,
  },
  pinMode: {
    label: 'pinMode',
    detail: 'Настроить цифровой вывод',
    insertText: 'pinMode(13, OUTPUT);',
    example: 'pinMode(13, OUTPUT);',
    lineComplete: true,
  },
  digitalWrite: {
    label: 'digitalWrite',
    detail: 'Записать цифровой уровень',
    insertText: 'digitalWrite(13, HIGH);',
    example: 'digitalWrite(13, HIGH);',
    lineComplete: true,
  },
  digitalRead: {
    label: 'digitalRead',
    detail: 'Считать цифровой вход',
    insertText: 'int state = digitalRead(2);',
    example: 'int state = digitalRead(2);',
    lineComplete: true,
  },
  analogRead: {
    label: 'analogRead',
    detail: 'Считать аналоговый вход',
    insertText: 'int value = analogRead(A0);',
    example: 'int value = analogRead(A0);',
    lineComplete: true,
  },
  analogWrite: {
    label: 'analogWrite',
    detail: 'Записать ШИМ-уровень',
    insertText: 'analogWrite(9, 128);',
    example: 'analogWrite(9, 128);',
    lineComplete: true,
  },
  delay: {
    label: 'delay',
    detail: 'Пауза в миллисекундах',
    insertText: 'delay(1000);',
    example: 'delay(1000);',
    lineComplete: true,
  },
  delayMicroseconds: {
    label: 'delayMicroseconds',
    detail: 'Пауза в микросекундах',
    insertText: 'delayMicroseconds(50);',
    example: 'delayMicroseconds(50);',
    lineComplete: true,
  },
  tone: {
    label: 'tone',
    detail: 'Включить звуковой тон',
    insertText: 'tone(8, 440, 500);',
    example: 'tone(8, 440, 500);',
    lineComplete: true,
  },
  noTone: {
    label: 'noTone',
    detail: 'Остановить звуковой тон',
    insertText: 'noTone(8);',
    example: 'noTone(8);',
    lineComplete: true,
  },
  map: {
    label: 'map',
    detail: 'Перенести число в диапазон',
    insertText: 'int pwm = map(value, 0, 1023, 0, 255);',
    example: 'map(value, 0, 1023, 0, 255)',
    lineComplete: true,
  },
  constrain: {
    label: 'constrain',
    detail: 'Ограничить число границами',
    insertText: 'value = constrain(value, 0, 255);',
    example: 'constrain(value, 0, 255)',
    lineComplete: true,
  },
  abs: {
    label: 'abs',
    detail: 'Получить модуль числа',
    insertText: 'int magnitude = abs(value);',
    example: 'abs(value)',
    lineComplete: true,
  },
  min: {
    label: 'min',
    detail: 'Выбрать меньшее число',
    insertText: 'int lower = min(left, right);',
    example: 'min(left, right)',
    lineComplete: true,
  },
  max: {
    label: 'max',
    detail: 'Выбрать большее число',
    insertText: 'int upper = max(left, right);',
    example: 'max(left, right)',
    lineComplete: true,
  },
  millis: {
    label: 'millis',
    detail: 'Прочитать время симуляции',
    insertText: 'unsigned long now = millis();',
    example: 'unsigned long now = millis();',
    lineComplete: true,
  },
  micros: {
    label: 'micros',
    detail: 'Прочитать микросекундное время',
    insertText: 'unsigned long now = micros();',
    example: 'unsigned long now = micros();',
    lineComplete: true,
  },
  pulseIn: {
    label: 'pulseIn',
    detail: 'Измерить длительность импульса',
    insertText: 'long width = pulseIn(7, HIGH);',
    example: 'long width = pulseIn(7, HIGH);',
    lineComplete: true,
  },
  random: {
    label: 'random',
    detail: 'Получить случайное число',
    insertText: 'long value = random(0, 100);',
    example: 'random(0, 100)',
    lineComplete: true,
  },
  randomSeed: {
    label: 'randomSeed',
    detail: 'Задать начальное случайное число',
    insertText: 'randomSeed(42);',
    example: 'randomSeed(42);',
    lineComplete: true,
  },
  'Serial.begin': {
    label: 'Serial.begin',
    detail: 'Открыть последовательный порт',
    insertText: 'Serial.begin(9600);',
    example: 'Serial.begin(9600);',
    lineComplete: true,
  },
  'Serial.print': {
    label: 'Serial.print',
    detail: 'Напечатать без переноса',
    insertText: 'Serial.print(value);',
    example: 'Serial.print(value);',
    lineComplete: true,
  },
  'Serial.println': {
    label: 'Serial.println',
    detail: 'Напечатать с новой строки',
    insertText: 'Serial.println(value);',
    example: 'Serial.println(value);',
    lineComplete: true,
  },
  'Serial.available': {
    label: 'Serial.available',
    detail: 'Проверить входящие данные',
    insertText: 'int available = Serial.available();',
    example: 'Serial.available()',
    lineComplete: true,
  },
  'Serial.read': {
    label: 'Serial.read',
    detail: 'Прочитать входящие данные',
    insertText: 'int incoming = Serial.read();',
    example: 'Serial.read()',
    lineComplete: true,
  },
  HIGH: {
    label: 'HIGH',
    detail: 'Высокий логический уровень',
    insertText: 'HIGH',
    example: 'digitalWrite(13, HIGH);',
    lineComplete: false,
  },
  LOW: {
    label: 'LOW',
    detail: 'Низкий логический уровень',
    insertText: 'LOW',
    example: 'digitalWrite(13, LOW);',
    lineComplete: false,
  },
  INPUT: {
    label: 'INPUT',
    detail: 'Режим цифрового входа',
    insertText: 'INPUT',
    example: 'pinMode(2, INPUT);',
    lineComplete: false,
  },
  INPUT_PULLUP: {
    label: 'INPUT_PULLUP',
    detail: 'Вход со встроенной подтяжкой',
    insertText: 'INPUT_PULLUP',
    example: 'pinMode(2, INPUT_PULLUP);',
    lineComplete: false,
  },
  OUTPUT: {
    label: 'OUTPUT',
    detail: 'Режим цифрового выхода',
    insertText: 'OUTPUT',
    example: 'pinMode(13, OUTPUT);',
    lineComplete: false,
  },
  LED_BUILTIN: {
    label: 'LED_BUILTIN',
    detail: 'Встроенный светодиод платы',
    insertText: 'LED_BUILTIN',
    example: 'digitalWrite(LED_BUILTIN, HIGH);',
    lineComplete: false,
  },
} as const satisfies Readonly<Record<ArduinoTextCommand, ArduinoCompletionDefinition>>;

export const ARDUINO_COMPLETIONS: readonly ArduinoCompletion[] = Object.values(
  COMPLETION_DEFINITIONS,
).map((completion) => ({
  ...completion,
  support: arduinoTextCommandSupport(completion.label).status,
}));

function identifierKind(identifier: string): ArduinoSourceTokenKind {
  if (KEYWORDS.has(identifier)) return 'keyword';
  if (TYPES.has(identifier)) return 'type';
  if (CONSTANTS.has(identifier)) return 'constant';
  if (BUILTINS.has(identifier)) return 'builtin';
  return 'plain';
}

export function tokenizeArduinoSource(source: string): readonly (readonly ArduinoSourceToken[])[] {
  let blockComment = false;
  return source.split('\n').map((line) => {
    const tokens: ArduinoSourceToken[] = [];
    let index = 0;
    const push = (kind: ArduinoSourceTokenKind, text: string): void => {
      if (!text) return;
      const previous = tokens.at(-1);
      if (previous?.kind === kind) {
        tokens[tokens.length - 1] = { kind, text: previous.text + text };
      } else {
        tokens.push({ kind, text });
      }
    };

    if (!blockComment && /^\s*#/.test(line)) {
      return [{ kind: 'preprocessor', text: line }];
    }

    while (index < line.length) {
      if (blockComment) {
        const end = line.indexOf('*/', index);
        if (end < 0) {
          push('comment', line.slice(index));
          index = line.length;
        } else {
          push('comment', line.slice(index, end + 2));
          index = end + 2;
          blockComment = false;
        }
        continue;
      }
      if (line.startsWith('//', index)) {
        push('comment', line.slice(index));
        break;
      }
      if (line.startsWith('/*', index)) {
        blockComment = true;
        continue;
      }
      const character = line[index] as string;
      if (character === '"' || character === "'") {
        const quote = character;
        let end = index + 1;
        while (end < line.length) {
          if (line[end] === '\\') end += 2;
          else if (line[end] === quote) {
            end += 1;
            break;
          } else end += 1;
        }
        push('string', line.slice(index, end));
        index = end;
        continue;
      }
      const remainder = line.slice(index);
      const number = /^(?:0[xX][\dA-Fa-f]+|0[bB][01]+|\d+(?:\.\d+)?)(?:[uUlLfF]+)?/.exec(remainder);
      if (number) {
        push('number', number[0]);
        index += number[0].length;
        continue;
      }
      const identifier = /^[A-Za-z_]\w*/.exec(remainder);
      if (identifier) {
        push(identifierKind(identifier[0]), identifier[0]);
        index += identifier[0].length;
        continue;
      }
      push('plain', character);
      index += 1;
    }
    return tokens;
  });
}

export function arduinoCompletionsAt(
  source: string,
  cursor: number,
  limit = 7,
): { readonly from: number; readonly items: readonly ArduinoCompletion[] } | null {
  const beforeCursor = source.slice(0, cursor);
  const match = /(?:\bSerial\.)?[A-Za-z_]\w*$/.exec(beforeCursor);
  if (!match || match[0].length < 2) return null;
  const prefix = match[0].toLowerCase();
  const items = ARDUINO_COMPLETIONS.filter((item) =>
    item.label.toLowerCase().startsWith(prefix),
  ).slice(0, limit);
  return items.length > 0 ? { from: cursor - match[0].length, items } : null;
}

export function insertArduinoCompletion(
  source: string,
  from: number,
  cursor: number,
  completion: ArduinoCompletion,
  key: 'Enter' | 'Tab',
): { readonly source: string; readonly cursor: number } {
  const safeFrom = Math.max(0, Math.min(source.length, Math.trunc(from)));
  const safeCursor = Math.max(safeFrom, Math.min(source.length, Math.trunc(cursor)));
  const lineStart = source.lastIndexOf('\n', safeFrom - 1) + 1;
  const indentation = /^[\t ]*/.exec(source.slice(lineStart, safeFrom))?.[0] ?? '';
  const lineEnd = source.indexOf('\n', safeCursor);
  const currentLineEnd = lineEnd < 0 ? source.length : lineEnd;
  const afterCursorOnLine = source.slice(safeCursor, currentLineEnd);
  const completesLine =
    key === 'Enter' && completion.lineComplete && afterCursorOnLine.trim().length === 0;

  if (completesLine) {
    const rest = lineEnd < 0 ? '' : source.slice(lineEnd);
    const insertion = `${completion.insertText}\n${indentation}`;
    return {
      source: `${source.slice(0, safeFrom)}${insertion}${rest}`,
      cursor: safeFrom + insertion.length,
    };
  }

  return {
    source: `${source.slice(0, safeFrom)}${completion.insertText}${source.slice(safeCursor)}`,
    cursor: safeFrom + completion.insertText.length,
  };
}
