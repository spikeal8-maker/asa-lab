import { promotedType, type ArduinoNumericType, type ArduinoValue } from './arduino-values.js';

export interface ArduinoSwitchSection {
  readonly expression?: string;
  readonly isDefault: boolean;
  readonly body: string;
  readonly offset: number;
  readonly labelOffset?: number;
  readonly labelLength?: number;
}

/** Labels belong only to this braced switch, never a nested statement/block. */
export function arduinoSwitchSections(source: string): readonly ArduinoSwitchSection[] {
  const labels: { start: number; end: number; expression?: string; isDefault: boolean }[] = [];
  let braces = 0;
  let parentheses = 0;
  const quotedEnd = (start: number): number => {
    const quote = source[start];
    for (let i = start + 1; i < source.length; i++) {
      if (source[i] === '\\') i++;
      else if (source[i] === quote) return i;
    }
    throw new SyntaxError('Незакрытая строка в switch.');
  };
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === '"' || c === "'") {
      i = quotedEnd(i);
      continue;
    }
    if (c === '{') braces++;
    if (c === '}') braces--;
    if (c === '(') parentheses++;
    if (c === ')') parentheses--;
    if (braces || parentheses || (i && /\w/.test(source[i - 1]!))) continue;
    const label = /^(case|default)\b/.exec(source.slice(i));
    if (!label) continue;
    const start = i;
    let depth = 0;
    let conditional = 0;
    const expressionStart = i + label[0].length;
    for (i = expressionStart; i < source.length; i++) {
      const t = source[i];
      if (t === '"' || t === "'") {
        i = quotedEnd(i);
        continue;
      }
      if (t === '(') depth++;
      if (t === ')') depth--;
      if (depth) continue;
      if (t === '?') conditional++;
      if (t === ':' && conditional) {
        conditional--;
        continue;
      }
      if (t === ':') break;
      if (t === ';' || t === '{' || t === '}')
        throw new SyntaxError('После метки switch ожидается двоеточие.');
    }
    if (i >= source.length) throw new SyntaxError('После метки switch ожидается двоеточие.');
    const expression = source.slice(expressionStart, i).trim();
    const isDefault = label[1] === 'default';
    if (isDefault ? expression.length > 0 : expression.length === 0)
      throw new SyntaxError('Некорректная метка switch.');
    labels.push({ start, end: i + 1, ...(isDefault ? {} : { expression }), isDefault });
  }
  if (labels.filter((label) => label.isDefault).length > 1)
    throw new SyntaxError('Повторная метка default.');
  return [
    { body: source.slice(0, labels[0]?.start ?? source.length), offset: 0, isDefault: false },
    ...labels.map((label, index) => ({
      ...(label.expression === undefined ? {} : { expression: label.expression }),
      isDefault: label.isDefault,
      body: source.slice(label.end, labels[index + 1]?.start ?? source.length),
      offset: label.end,
      labelOffset: label.start,
      labelLength: label.end - label.start,
    })),
  ];
}

export function arduinoSwitchType(type: ArduinoNumericType): ArduinoNumericType {
  if (type === 'float' || type === 'double')
    throw new SyntaxError('Условие switch должно иметь целочисленный тип.');
  return promotedType(type);
}

/** C++11 converted constant expression: implicit narrowing is not allowed. */
export function arduinoSwitchCase(value: ArduinoValue, type: ArduinoNumericType): number {
  arduinoSwitchType(value.type);
  const ranges: Partial<Record<ArduinoNumericType, readonly [number, number]>> = {
    int: [-32768, 32767],
    'unsigned int': [0, 65535],
    long: [-2147483648, 2147483647],
    'unsigned long': [0, 4294967295],
  };
  const range = ranges[type]!;
  if (!Number.isSafeInteger(value.value) || value.value < range[0] || value.value > range[1])
    throw new SyntaxError('Метка case требует сужающего преобразования.');
  return value.value;
}
