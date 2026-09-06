/** Uno / ATmega328P, Arduino AVR Boards 1.8.6 (GNU++11, AVR GCC 7.3).
 * Signed overflow and non-finite results are explicit simulation faults, not UB emulation.
 */
export type ArduinoNumericType =
  'bool' | 'byte' | 'int' | 'unsigned int' | 'long' | 'unsigned long' | 'float' | 'double';
export interface ArduinoValue {
  readonly type: ArduinoNumericType;
  readonly value: number;
}
export interface ArduinoBinding {
  readonly type: ArduinoNumericType;
  readonly constant: boolean;
  readonly value: number | null;
}
export type ArduinoScope = Map<string, ArduinoBinding>;
export type ArduinoScopeSnapshot = Readonly<Record<string, ArduinoBinding>>;

export class ArduinoArithmeticError extends Error {}

const integers = {
  bool: { bits: 1, signed: false },
  byte: { bits: 8, signed: false },
  int: { bits: 16, signed: true },
  'unsigned int': { bits: 16, signed: false },
  long: { bits: 32, signed: true },
  'unsigned long': { bits: 32, signed: false },
} as const;
export const ARDUINO_NUMERIC_TYPES: readonly ArduinoNumericType[] = [
  ...(Object.keys(integers) as Array<keyof typeof integers>),
  'float',
  'double',
];
const floating = (type: ArduinoNumericType): boolean => type === 'float' || type === 'double';
export const zeroValue = (type: ArduinoNumericType = 'int'): ArduinoValue => ({ type, value: 0 });

export function numericValue(type: ArduinoNumericType, value: number): ArduinoValue {
  const result = floating(type) ? Math.fround(value) : value;
  if (!Number.isFinite(result))
    throw new ArduinoArithmeticError('Результат вычисления не является конечным числом.');
  return { type, value: Object.is(result, -0) ? 0 : result };
}

export function convertValue(
  value: ArduinoValue,
  type: ArduinoNumericType,
  validateOnly = false,
): ArduinoValue {
  if (validateOnly) return zeroValue(type);
  if (type === 'bool') return numericValue(type, Number(value.value !== 0));
  if (floating(type)) return numericValue(type, value.value);
  const { bits, signed } = integers[type as keyof typeof integers];
  const range = 2 ** bits;
  const result = Math.trunc(value.value);
  // Float-to-integer out of range is not the well-defined unsigned integer conversion.
  const minimum = signed ? -range / 2 : 0;
  const maximum = signed ? range / 2 - 1 : range - 1;
  if (floating(value.type) && (result < minimum || result > maximum))
    throw new ArduinoArithmeticError(
      `Число вне диапазона ${type} при преобразовании из ${value.type}.`,
    );
  const wrapped = ((result % range) + range) % range;
  // AVR GCC's implementation-defined signed narrowing uses the low bits.
  return numericValue(type, signed && wrapped >= range / 2 ? wrapped - range : wrapped);
}

export function promotedType(type: ArduinoNumericType): ArduinoNumericType {
  return type === 'bool' || type === 'byte' ? 'int' : type;
}

export function commonType(a: ArduinoNumericType, b: ArduinoNumericType): ArduinoNumericType {
  if (a === 'double' || b === 'double') return 'double';
  if (a === 'float' || b === 'float') return 'float';
  const left = promotedType(a) as keyof typeof integers;
  const right = promotedType(b) as keyof typeof integers;
  if (left === right) return left;
  const x = integers[left],
    y = integers[right];
  if (x.bits === y.bits) return x.signed ? right : left;
  return x.bits > y.bits ? left : right;
}

export function unaryValue(
  operator: string,
  operand: ArduinoValue,
  validateOnly = false,
): ArduinoValue {
  if (operator === '!')
    return validateOnly ? zeroValue('bool') : numericValue('bool', Number(!operand.value));
  const value = convertValue(operand, promotedType(operand.type), validateOnly);
  return operator === '+' ? value : binaryValue('-', zeroValue(value.type), value, validateOnly);
}

export function binaryValue(
  operator: string,
  a: ArduinoValue,
  b: ArduinoValue,
  validateOnly = false,
): ArduinoValue {
  const type = commonType(a.type, b.type);
  const comparison = ['==', '!=', '<', '<=', '>', '>='].includes(operator);
  if (operator === '%' && floating(type))
    throw new SyntaxError('Остаток % требует целочисленных операндов.');
  if (validateOnly) return zeroValue(comparison ? 'bool' : type);
  const left = convertValue(a, type).value,
    right = convertValue(b, type).value;
  if (comparison) {
    const result =
      operator === '=='
        ? left === right
        : operator === '!='
          ? left !== right
          : operator === '<'
            ? left < right
            : operator === '<='
              ? left <= right
              : operator === '>'
                ? left > right
                : left >= right;
    return numericValue('bool', Number(result));
  }
  if ((operator === '/' || operator === '%') && right === 0)
    throw new ArduinoArithmeticError('Деление или остаток от деления на ноль.');
  if (floating(type)) {
    return numericValue(
      type,
      operator === '+'
        ? left + right
        : operator === '-'
          ? left - right
          : operator === '*'
            ? left * right
            : left / right,
    );
  }
  // Exact intermediate multiplication also for uint32: JS number loses low bits above 2^53.
  const x = BigInt(left),
    y = BigInt(right);
  const result =
    operator === '+'
      ? x + y
      : operator === '-'
        ? x - y
        : operator === '*'
          ? x * y
          : operator === '/'
            ? x / y
            : x % y;
  const { bits, signed } = integers[type as keyof typeof integers];
  if (signed) {
    const minimum = -(2n ** BigInt(bits - 1)),
      maximum = -minimum - 1n;
    if (
      result < minimum ||
      result > maximum ||
      ((operator === '/' || operator === '%') && x === minimum && y === -1n)
    )
      throw new ArduinoArithmeticError(`Переполнение знакового ${type} в операции ${operator}.`);
    return numericValue(type, Number(result));
  }
  return numericValue(type, Number(BigInt.asUintN(bits, result)));
}

export function parseNumericLiteral(literal: string): ArduinoValue {
  const real = /^(?:(?:\d+\.\d*|\.\d+)(?:e[+-]?\d+)?|\d+e[+-]?\d+)(f|l)?$/i.exec(literal);
  if (real) {
    if (real[1]?.toLowerCase() === 'l')
      throw new SyntaxError('long double пока не поддерживается.');
    return numericValue(
      real[1] ? 'float' : 'double',
      Number(real[1] ? literal.slice(0, -1) : literal),
    );
  }
  const integer = /^(0[xX][\da-fA-F]+|0[bB][01]+|0[0-7]*|[1-9]\d*)(u|l|ul|lu)?$/i.exec(literal);
  if (!integer) throw new SyntaxError(`Недопустимый числовой литерал «${literal}».`);
  const digits = integer[1]!,
    suffix = integer[2]?.toLowerCase() ?? '';
  const decimal = !digits.startsWith('0');
  const value =
    digits.length > 1 && /^0[0-7]+$/.test(digits) ? Number.parseInt(digits, 8) : Number(digits);
  const candidates: ArduinoNumericType[] = suffix.includes('u')
    ? suffix.includes('l')
      ? ['unsigned long']
      : ['unsigned int', 'unsigned long']
    : suffix.includes('l')
      ? decimal
        ? ['long']
        : ['long', 'unsigned long']
      : decimal
        ? ['int', 'long']
        : ['int', 'unsigned int', 'long', 'unsigned long'];
  for (const type of candidates) {
    const { bits, signed } = integers[type as keyof typeof integers];
    if (value <= 2 ** (bits - Number(signed)) - 1) return numericValue(type, value);
  }
  throw new SyntaxError(`Литерал «${literal}» требует неподдерживаемого 64-битного типа.`);
}

export function bindingFor(scopes: readonly ArduinoScope[], name: string): ArduinoBinding {
  for (let index = scopes.length - 1; index >= 0; index--) {
    const binding = scopes[index]!.get(name);
    if (binding) return binding;
  }
  throw new SyntaxError(`Переменная «${name}» не объявлена в этой области.`);
}

export function readBinding(
  scopes: readonly ArduinoScope[],
  name: string,
  validateOnly: boolean,
): ArduinoValue {
  const binding = bindingFor(scopes, name);
  if (validateOnly) return zeroValue(binding.type);
  if (binding.value === null)
    throw new ArduinoArithmeticError(`Переменная «${name}» прочитана до присваивания.`);
  return numericValue(binding.type, binding.value);
}

export function assignBinding(
  scopes: readonly ArduinoScope[],
  name: string,
  value: ArduinoValue,
  validateOnly: boolean,
): void {
  const binding = bindingFor(scopes, name);
  if (binding.constant) throw new SyntaxError(`Нельзя изменять const «${name}».`);
  const scope = [...scopes].reverse().find((entry) => entry.has(name))!;
  scope.set(name, { ...binding, value: convertValue(value, binding.type, validateOnly).value });
}

export function serializeScopes(scopes: readonly ArduinoScope[]): readonly ArduinoScopeSnapshot[] {
  return scopes.map((scope) =>
    Object.fromEntries([...scope].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
  );
}

export function scopeNumbers(scopes: readonly ArduinoScope[]): Readonly<Record<string, number>> {
  return Object.fromEntries(
    [...new Map(scopes.flatMap((scope) => [...scope]))]
      .filter(([, binding]) => binding.value !== null)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([name, binding]) => [name, binding.value!]),
  );
}

export function validScopes(value: unknown): value is readonly ArduinoScopeSnapshot[] {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    value.length <= 128 &&
    value.every(
      (scope) =>
        scope !== null &&
        typeof scope === 'object' &&
        !Array.isArray(scope) &&
        Object.entries(scope).every(([name, binding]) => {
          if (!/^[A-Za-z_]\w*$/.test(name) || !binding || typeof binding !== 'object') return false;
          const b = binding as ArduinoBinding;
          if (!ARDUINO_NUMERIC_TYPES.includes(b.type) || typeof b.constant !== 'boolean')
            return false;
          if (b.value === null) return !b.constant;
          if (!Number.isFinite(b.value)) return false;
          try {
            return convertValue(numericValue(b.type, b.value), b.type).value === b.value;
          } catch {
            return false;
          }
        }),
    )
  );
}
