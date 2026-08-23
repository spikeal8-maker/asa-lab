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

export const ARDUINO_COMPLETIONS: readonly ArduinoCompletion[] = [
  { label: 'analogRead', detail: 'Считать аналоговый вход' },
  { label: 'analogWrite', detail: 'Записать ШИМ-значение' },
  { label: 'delay', detail: 'Пауза в миллисекундах' },
  { label: 'delayMicroseconds', detail: 'Пауза в микросекундах' },
  { label: 'digitalRead', detail: 'Считать цифровой вход' },
  { label: 'digitalWrite', detail: 'Установить цифровой выход' },
  { label: 'HIGH', detail: 'Высокий логический уровень' },
  { label: 'INPUT', detail: 'Режим цифрового входа' },
  { label: 'INPUT_PULLUP', detail: 'Вход со встроенной подтяжкой' },
  { label: 'LED_BUILTIN', detail: 'Встроенный светодиод платы' },
  { label: 'LOW', detail: 'Низкий логический уровень' },
  { label: 'map', detail: 'Перенести число в другой диапазон' },
  { label: 'micros', detail: 'Время работы в микросекундах' },
  { label: 'millis', detail: 'Время работы в миллисекундах' },
  { label: 'OUTPUT', detail: 'Режим цифрового выхода' },
  { label: 'pinMode', detail: 'Настроить режим вывода' },
  { label: 'pulseIn', detail: 'Измерить длительность импульса' },
  { label: 'Serial.begin', detail: 'Запустить последовательный порт' },
  { label: 'Serial.print', detail: 'Вывести значение без переноса' },
  { label: 'Serial.println', detail: 'Вывести значение с переносом' },
  { label: 'tone', detail: 'Запустить звуковой сигнал' },
] as const;

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
