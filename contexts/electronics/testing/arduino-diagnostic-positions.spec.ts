import { describe, expect, it } from 'vitest';
import { analyseArduinoProgramSyntax } from '../domain/arduino-program-runtime';
import { analyseArduinoSourceSupport } from '../domain/arduino-capabilities';

describe('original Arduino diagnostic coordinates', () => {
  const check = (source: string, slice: string, occurrence = 0) => {
    let start = -1;
    for (let index = 0; index <= occurrence; index += 1) start = source.indexOf(slice, start + 1);
    expect(start).toBeGreaterThanOrEqual(0);
    const prefix = source.slice(0, start);
    const expected = {
      start,
      length: slice.length,
      line: prefix.split('\n').length,
      column: start - prefix.lastIndexOf('\n'),
    };
    const diagnostics = analyseArduinoProgramSyntax(source);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ ...expected, severity: 'error', code: 'compile_error' });
    expect(
      source.slice(diagnostics[0]!.start, diagnostics[0]!.start! + diagnostics[0]!.length!),
    ).toBe(slice);
    expect(analyseArduinoSourceSupport(source).filter((d) => d.code === 'syntax-error')).toEqual([
      {
        ...expected,
        code: 'syntax-error',
        status: 'unsupported',
        message: diagnostics[0]!.message,
      },
    ]);
    // Cache hits return the same metadata without exposing the cached diagnostic object.
    expect(analyseArduinoProgramSyntax(source)).toEqual(diagnostics);
  };

  it.each(['\n', '\r\n'])('locates first, middle and nested statements with %j', (newline) => {
    for (const scope of ['setup', 'loop']) {
      check(`void ${scope}(){${newline}  digitalWrite(13);${newline}}`, 'digitalWrite(13)');
      check(
        `void ${scope}(){${newline}  delay(1);${newline}  digitalWrite(13);${newline}  delay(2);${newline}}`,
        'digitalWrite(13)',
      );
      check(
        `void ${scope}(){${newline}  if (1) { while(0) {${newline}    digitalWrite(13);${newline}  } }${newline}}`,
        'digitalWrite(13)',
      );
    }
  });

  it('keeps distinct repeated statement locations on the same line and across lines', () => {
    check('void loop(){ int x = 1; int x = 1; }', 'int x = 1', 1);
    check('void loop(){\n int x = 1;\n int x = 1;\n}', 'int x = 1', 1);
    check('int x = 1; int x = 1; void loop(){}', 'int x = 1', 1);
  });

  it('maps removed comments, escaped strings and UTF16 characters to original input', () => {
    check(
      '// 😀 before\r\nvoid loop(){ /* 😀 block */ delay(1); /* next */ digitalWrite(13); }',
      'digitalWrite(13)',
    );
    check(
      'void loop(){ Serial.println("😀 \\" // "); /* tail */ digitalWrite(13); }',
      'digitalWrite(13)',
    );
    check('/*before*/ digitalWrite(13);', 'digitalWrite(13)');
    check('delay(1); // line\n /*block*/ digitalWrite(13);', 'digitalWrite(13)');
  });

  it('points to responsible structural tokens, never setup/loop by message', () => {
    check('// prefix\nvoid loop(){ delay(1); }}', '}', 1);
    check('void setup(){\n delay(1);', '{');
    check('void loop(){ delay(1]; }', '}');
    check('void loop(){ Serial.println("unterminated); }', '"');
    check('void setup();', 'void');
    check('void loop(){ delay(1)   }', 'delay(1)');
    check('delay(1)', 'delay(1)');
  });

  it('locates malformed control syntax and trimmed for-header instructions', () => {
    check('void loop(){ if(1) {} else delay(1); }', 'else');
    check('void loop(){ if 1 {} }', 'if');
    check('void loop(){ for( int x = unknown; x < 1; x++ ){} }', 'int x = unknown');
    check('void loop(){ for( int x = 0; x < 1; digitalWrite(13) ){} }', 'digitalWrite(13)');
  });

  it('keeps valid comments and nested source accepted and free of syntax diagnostics', () => {
    for (const source of [
      'void setup(){/*x*/ pinMode(13, OUTPUT);} void loop(){ if(1){digitalWrite(13,HIGH);} }',
      'delay(1);',
      'void loop(){ Serial.println("😀 // text"); }',
    ]) {
      expect(analyseArduinoProgramSyntax(source)).toEqual([]);
    }
  });
});
