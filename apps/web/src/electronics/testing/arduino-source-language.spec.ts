import { describe, expect, it } from 'vitest';
import { arduinoCompletionsAt, tokenizeArduinoSource } from '../arduino-source-language';

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
});
