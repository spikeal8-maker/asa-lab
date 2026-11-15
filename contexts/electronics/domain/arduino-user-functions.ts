import type { ArduinoNumericType } from './arduino-values.js';

export interface ArduinoFunctionParameter {
  readonly name: string;
  readonly type: ArduinoNumericType;
  readonly constant: boolean;
}

export interface ArduinoVoidFunction {
  readonly name: string;
  readonly parameters: readonly ArduinoFunctionParameter[];
  readonly body: string;
  readonly bodyOffset: number;
  readonly line: number;
}

export interface ArduinoFunctionMessage {
  readonly message: string;
  readonly start: number;
  readonly length: number;
}

const BUILTINS = new Set(
  'pinmode digitalwrite analogwrite digitalread analogread delay delaymicroseconds millis micros tone notone pulsein readultrasoniccm map constrain abs min max random randomseed'.split(
    ' ',
  ),
);
const ULTRASONIC = `float readUltrasonicCm(int triggerPin, int echoPin) {
pinMode(triggerPin, OUTPUT); digitalWrite(triggerPin, LOW); delayMicroseconds(2);
digitalWrite(triggerPin, HIGH); delayMicroseconds(10); digitalWrite(triggerPin, LOW);
pinMode(echoPin, INPUT); return pulseIn(echoPin, HIGH) * 0.01723; }`;
const compact = (text: string) => text.replace(/\s+/g, '');
const KEYWORDS = new Set(
  'alignas alignof and and_eq asm auto bitand bitor bool break case catch char char16_t char32_t class compl const constexpr const_cast continue decltype default delete do double dynamic_cast else enum explicit export extern false float for friend goto if inline int long mutable namespace new noexcept not not_eq nullptr operator or or_eq private protected public register reinterpret_cast return short signed sizeof static static_assert static_cast struct switch template this thread_local throw true try typedef typeid typename union unsigned using virtual void volatile wchar_t while xor xor_eq boolean byte'.split(
    ' ',
  ),
);

export function reservedArduinoFunctionIdentifier(name: string): boolean {
  return (
    KEYWORDS.has(name) ||
    /^(?:HIGH|LOW|INPUT|OUTPUT|INPUT_PULLUP|LED_BUILTIN|Serial|Servo|A[0-5]|D\d{1,2})$/.test(name)
  );
}

/** Preserve offsets while hiding braces/declarations inside comments or string literals. */
export function maskArduinoFunctionSyntax(source: string): string {
  let out = '';
  let quote = '';
  let comment = '';
  for (let i = 0; i < source.length; i++) {
    const c = source[i]!;
    const next = source[i + 1];
    if (comment) {
      out += c === '\n' ? '\n' : ' ';
      if (comment === 'line' && c === '\n') comment = '';
      else if (comment === 'block' && c === '*' && next === '/') {
        out += ' ';
        i++;
        comment = '';
      }
    } else if (quote) {
      out += c === '\n' ? '\n' : ' ';
      if (c === '\\' && next !== undefined) {
        out += next === '\n' ? '\n' : ' ';
        i++;
      } else if (c === quote) quote = '';
    } else if (c === '"' || c === "'") {
      quote = c;
      out += ' ';
    } else if (c === '/' && (next === '/' || next === '*')) {
      comment = next === '/' ? 'line' : 'block';
      out += '  ';
      i++;
    } else out += c;
  }
  return out.replace(/^[\t ]*#[^\r\n]*/gm, (line) => ' '.repeat(line.length));
}

function parameters(text: string, prototype: boolean): readonly ArduinoFunctionParameter[] | null {
  if (!text.trim() || text.trim() === 'void') return [];
  const result: ArduinoFunctionParameter[] = [];
  for (const part of text.split(',')) {
    const match =
      /^(const\s+)?(unsigned\s+long|unsigned\s+int|int|long|float|double|bool|boolean|byte)(?:\s+([A-Za-z_]\w*))?$/.exec(
        part.trim(),
      );
    if (
      !match ||
      (!prototype && !match[3]) ||
      (match[3] &&
        (reservedArduinoFunctionIdentifier(match[3]) || result.some((p) => p.name === match[3])))
    )
      return null;
    const type = match[2]!.replace(/\s+/g, ' ');
    result.push({
      name: match[3] ?? `parameter${result.length}`,
      type: (type === 'boolean' ? 'bool' : type) as ArduinoNumericType,
      constant: Boolean(match[1]),
    });
  }
  return result;
}

/** The sole existing generated numeric helper is admitted by its complete verified body. */
export function parseArduinoVoidFunctions(source: string): {
  readonly functions: readonly ArduinoVoidFunction[];
  readonly messages: readonly ArduinoFunctionMessage[];
} {
  const clean = maskArduinoFunctionSyntax(source);
  const found = new Map<string, ArduinoVoidFunction>();
  const signatures = new Map<string, readonly ArduinoFunctionParameter[]>();
  const messages: ArduinoFunctionMessage[] = [];
  let start = 0;
  const add = (message: string, offset: number, length: number) =>
    messages.push({ message, start: offset, length: Math.max(1, length) });
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (c !== ';' && c !== '{') continue;
    const prefix = clean.slice(start, i);
    const header = /([A-Za-z_]\w*)\s*\(([\s\S]*)\)\s*$/.exec(prefix);
    let end = i;
    if (c === '{') {
      let depth = 1;
      for (end = i + 1; end < clean.length; end++) {
        if (clean[end] === '{') depth++;
        if (clean[end] === '}' && --depth === 0) break;
      }
      if (end >= clean.length) {
        // The existing structural validator owns unterminated-brace diagnostics.
        break;
      }
    }
    if (header) {
      const name = header[1]!;
      const returns = prefix.slice(0, header.index).trim();
      // An initializer or ordinary top-level statement is not a prototype.
      if (returns && !/[=;()]/.test(returns) && name !== 'setup' && name !== 'loop') {
        const offset = start + header.index;
        const rawDefinition = clean.slice(start, end + 1).trim();
        if (
          c === '{' &&
          name === 'readUltrasonicCm' &&
          compact(rawDefinition) === compact(ULTRASONIC)
        ) {
          start = end + 1;
          i = end;
          continue;
        }
        const params = parameters(header[2]!, c === ';');
        if (returns !== 'void')
          add(
            `Функция ${name}(): поддерживаются функции void без возвращаемого значения.`,
            offset,
            name.length,
          );
        else if (reservedArduinoFunctionIdentifier(name) || BUILTINS.has(name.toLowerCase()))
          add(`Имя функции ${name}() зарезервировано.`, offset, name.length);
        else if (!params)
          add(
            `Функция ${name}(): нужны именованные скалярные параметры без ссылок, указателей и значений по умолчанию.`,
            offset,
            name.length,
          );
        else {
          const prior = signatures.get(name);
          if (
            prior &&
            (prior.length !== params.length || prior.some((p, n) => p.type !== params[n]!.type))
          )
            add(`Несовместимые объявления функции ${name}().`, offset, name.length);
          else {
            signatures.set(name, params);
            if (c === '{') {
              if (found.has(name))
                add(`Повторное определение функции ${name}().`, offset, name.length);
              else
                found.set(name, {
                  name,
                  parameters: params,
                  body: source.slice(i + 1, end),
                  bodyOffset: i + 1,
                  line: 1 + (source.slice(0, i + 1).match(/\n/g)?.length ?? 0),
                });
            }
          }
        }
      }
    }
    start = end + 1;
    i = end;
  }
  for (const name of signatures.keys())
    if (!found.has(name)) add(`Функция ${name}() объявлена, но не определена.`, 0, name.length);
  if (found.size > 128) add('Слишком много функций Arduino (не более 128).', 0, 1);
  return { functions: [...found.values()].slice(0, 128), messages };
}
