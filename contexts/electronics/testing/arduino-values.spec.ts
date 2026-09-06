import { describe, expect, it } from 'vitest';
import {
  ArduinoArithmeticError,
  binaryValue,
  convertValue,
  numericValue,
  parseNumericLiteral,
  unaryValue,
} from '../domain/arduino-values.js';
import { advanceArduinoRuntime } from '../domain/arduino-program-runtime.js';

describe('Uno numeric profile', () => {
  it.each([
    ['32767', 'int', 32767],
    ['32768', 'long', 32768],
    ['65535U', 'unsigned int', 65535],
    ['65536U', 'unsigned long', 65536],
    ['4294967295UL', 'unsigned long', 4294967295],
    ['0xffff', 'unsigned int', 65535],
    ['0x80000000', 'unsigned long', 2147483648],
    ['010', 'int', 8],
    ['0b1010', 'int', 10],
    ['2.5f', 'float', 2.5],
    ['5e-1', 'double', 0.5],
    ['1.0', 'double', 1],
  ])('parses %s with the actual literal type', (source, type, value) => {
    expect(parseNumericLiteral(source)).toEqual({ type, value });
  });
  it.each(['08', '4294967295', '4294967296UL', '1.0L', '7f'])(
    'rejects unsupported literal %s',
    (source) => {
      expect(() => parseNumericLiteral(source)).toThrow();
    },
  );
  it('converts signed narrowing as AVR GCC and unsigned modulo without losing multiplication bits', () => {
    expect(convertValue(numericValue('long', 65535), 'int').value).toBe(-1);
    expect(convertValue(numericValue('int', -1), 'byte').value).toBe(255);
    const maximum = numericValue('unsigned long', 4294967295);
    expect(binaryValue('*', maximum, maximum).value).toBe(1);
    expect(binaryValue('+', maximum, numericValue('int', 1)).value).toBe(0);
    expect(binaryValue('-', numericValue('unsigned int', 0), numericValue('int', 1)).value).toBe(
      65535,
    );
  });
  it('uses promotions before comparing signed and unsigned operands', () => {
    expect(binaryValue('<', numericValue('int', -1), numericValue('unsigned int', 1)).value).toBe(
      0,
    );
    expect(
      binaryValue('<', numericValue('long', -1), numericValue('unsigned int', 65535)).value,
    ).toBe(1);
    expect(binaryValue('+', numericValue('byte', 255), numericValue('byte', 1))).toEqual({
      type: 'int',
      value: 256,
    });
  });
  it.each(['/', '%'])(
    'faults instead of inventing the undefined signed minimum %s -1',
    (operator) => {
      expect(() =>
        binaryValue(operator, numericValue('int', -32768), numericValue('int', -1)),
      ).toThrow(ArduinoArithmeticError);
    },
  );
  it('rejects signed overflow, floating remainder, non-finite and out-of-range float conversions', () => {
    expect(() => unaryValue('-', numericValue('int', -32768))).toThrow(ArduinoArithmeticError);
    expect(() =>
      binaryValue('*', numericValue('long', 2147483647), numericValue('long', 2)),
    ).toThrow(ArduinoArithmeticError);
    expect(() => binaryValue('%', numericValue('float', 2.5), numericValue('int', 2))).toThrow(
      SyntaxError,
    );
    expect(() => numericValue('double', 1e39)).toThrow(ArduinoArithmeticError);
    expect(() => convertValue(numericValue('float', 256.5), 'byte')).toThrow(
      ArduinoArithmeticError,
    );
  });
  it('checks type errors even without executing an expression, but defers numeric faults to execution', () => {
    expect(binaryValue('/', numericValue('int', 1), numericValue('int', 0), true)).toEqual({
      type: 'int',
      value: 0,
    });
    expect(() => binaryValue('%', zeroFloat(), numericValue('int', 0), true)).toThrow(SyntaxError);
  });
  it('agrees with the isolated AVR reference fixture for defined integer results', () => {
    const expressions = [
      'int value=5/2;',
      'int value=2.9;',
      'byte value=255; value++;',
      'bool value=2;',
      'long value=map(512,0,1023,0,255);',
      'int value=-5/2;',
      'int value=-5%2;',
      'byte value=255;value+=2;',
      'unsigned long value=4294967295UL;value++;',
      'byte a=255;int value=a+1;',
      'long value=map(-5,0,10,0,3);',
      'int value=65535L;',
      'unsigned long a=4294967295UL;unsigned long value=a*a;',
      'int a=-1;unsigned int b=1;int value=a<b;',
      'long a=-1;unsigned int b=65535U;int value=a<b;',
      'int value=1;if(true){int value=9;}',
    ];
    const expected = [2, 2, 0, 1, 127, -2, -1, 1, 0, 256, -1, -1, 1, 0, 1, 1];
    for (const [index, body] of expressions.entries()) {
      const result = advanceArduinoRuntime(
        `long observed=0;void setup(){${body}observed=value;}void loop(){delay(100);}`,
      );
      expect(result.diagnostics, body).toEqual([]);
      expect(result.state.variables.observed, body).toBe(expected[index]);
    }
  });
});

function zeroFloat() {
  return numericValue('float', 0);
}
