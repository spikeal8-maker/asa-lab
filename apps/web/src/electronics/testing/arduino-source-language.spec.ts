import { describe, expect, it } from 'vitest';
import {
  ARDUINO_COMPLETIONS,
  arduinoCompletionsAt,
  insertArduinoCompletion,
  tokenizeArduinoSource,
} from '../arduino-source-language';

describe('Arduino source language support', () => {
  it('highlights Arduino C++ syntax without treating comments inside strings as comments', () => {
    const lines = tokenizeArduinoSource(
      '#include <Arduino.h>\nvoid setup() {\n  Serial.println("https://asa-lab.ru"); // ready\n}',
    );
    expect(lines[0]).toEqual([{ kind: 'preprocessor', text: '#include <Arduino.h>' }]);
    expect(lines[1]).toEqual(
      expect.arrayContaining([
        { kind: 'type', text: 'void' },
        { kind: 'builtin', text: 'setup' },
      ]),
    );
    expect(lines[2]).toEqual(
      expect.arrayContaining([
        { kind: 'builtin', text: 'Serial' },
        { kind: 'builtin', text: 'println' },
        { kind: 'string', text: '"https://asa-lab.ru"' },
        { kind: 'comment', text: '// ready' },
      ]),
    );
  });

  it('offers Arduino API completions for plain and Serial prefixes', () => {
    expect(arduinoCompletionsAt('  digitalWri', 12)?.items[0]?.label).toBe('digitalWrite');
    expect(arduinoCompletionsAt('Serial.pr', 9)?.items.map((item) => item.label)).toEqual([
      'Serial.print',
      'Serial.println',
    ]);
    expect(arduinoCompletionsAt('x', 1)).toBeNull();
  });

  it('replaces the whole Servo API prefix and exposes the implemented distance adapter', () => {
    const source = '  servo.wr';
    const completion = arduinoCompletionsAt(source, source.length);
    expect(completion?.from).toBe(2);
    expect(completion?.items[0]?.label).toBe('Servo.write');
    const result = insertArduinoCompletion(
      source,
      completion!.from,
      source.length,
      completion!.items[0]!,
      'Tab',
    );
    expect(result.source).toBe('  servo.write(90);');
    expect(arduinoCompletionsAt('servo.re', 8)?.items.map((item) => item.label)).toEqual([
      'Servo.read',
    ]);
    expect(arduinoCompletionsAt('other.re', 8)).toBeNull();
    expect(arduinoCompletionsAt('readUltra', 9)?.items[0]?.label).toBe('readUltrasonicCm');
  });

  it('completes a statement and moves Enter to a correctly indented new line', () => {
    const source = 'void loop() {\n  dela\n}\n';
    const cursor = source.indexOf('dela') + 4;
    const delay = ARDUINO_COMPLETIONS.find((item) => item.label === 'delay');
    expect(delay).toBeDefined();

    const insertion = insertArduinoCompletion(source, cursor - 4, cursor, delay!, 'Enter');
    expect(insertion.source).toBe('void loop() {\n  delay(1000);\n  \n}\n');
    expect(insertion.source.slice(0, insertion.cursor)).toBe('void loop() {\n  delay(1000);\n  ');
  });

  it('accepts with Tab in place and keeps constants inside unfinished calls', () => {
    const delay = ARDUINO_COMPLETIONS.find((item) => item.label === 'delay');
    const high = ARDUINO_COMPLETIONS.find((item) => item.label === 'HIGH');
    expect(delay).toBeDefined();
    expect(high).toBeDefined();

    expect(insertArduinoCompletion('dela', 0, 4, delay!, 'Tab')).toEqual({
      source: 'delay(1000);',
      cursor: 12,
    });
    expect(insertArduinoCompletion('digitalWrite(13, HI);', 17, 19, high!, 'Enter')).toEqual({
      source: 'digitalWrite(13, HIGH);',
      cursor: 21,
    });
  });
});
