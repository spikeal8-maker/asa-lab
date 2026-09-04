import { describe, expect, it } from 'vitest';
import {
  ARDUINO_LANGUAGE_FEATURE_SUPPORT,
  ARDUINO_TEXT_COMMAND_SUPPORT,
  type ArduinoTextCommand,
} from '@asa-lab/electronics';
import {
  ARDUINO_COMMAND_REFERENCE,
  ARDUINO_LANGUAGE_REFERENCE,
  arduinoSnippetDropTarget,
  arduinoSupportStatusLabel,
  filterArduinoCommandReference,
  insertArduinoSnippet,
} from '../arduino-command-reference';

describe('Arduino command reference', () => {
  it('documents every command from the executable support registry', () => {
    expect(ARDUINO_COMMAND_REFERENCE.map((entry) => entry.command).sort()).toEqual(
      Object.keys(ARDUINO_TEXT_COMMAND_SUPPORT).sort(),
    );
    for (const entry of ARDUINO_COMMAND_REFERENCE) {
      expect(entry.signature.length).toBeGreaterThan(0);
      expect(entry.summary.length).toBeGreaterThan(0);
      expect(entry.limits.length).toBeGreaterThan(0);
      expect(entry.example.length).toBeGreaterThan(0);
      expect(entry.status).toBe(
        ARDUINO_TEXT_COMMAND_SUPPORT[entry.command as ArduinoTextCommand].status,
      );
    }
  });

  it('documents the same primitive C++ subset as the runtime contract', () => {
    expect(
      ARDUINO_LANGUAGE_REFERENCE.map((entry) => entry.id.replace('language:', '')).sort(),
    ).toEqual(Object.keys(ARDUINO_LANGUAGE_FEATURE_SUPPORT).sort());
    for (const expected of [
      ['if', 'supported'],
      ['comparison', 'supported'],
      ['logical-and', 'supported'],
      ['type-int', 'limited'],
      ['for', 'limited'],
      ['type-text', 'unsupported'],
      ['switch', 'unsupported'],
    ]) {
      expect(
        ARDUINO_LANGUAGE_REFERENCE.find((entry) => entry.id === `language:${expected[0]}`)?.status,
      ).toBe(expected[1]);
    }
  });

  it('filters by category and Russian or source-language text', () => {
    expect(filterArduinoCommandReference('последовательный', 'all').length).toBeGreaterThan(0);
    expect(
      filterArduinoCommandReference('больше и меньше', 'logic').map((entry) => entry.command),
    ).toEqual(['comparison']);
    expect(
      filterArduinoCommandReference('Serial.println', 'serial').map((entry) => entry.command),
    ).toEqual(['Serial.println']);
    expect(
      filterArduinoCommandReference('', 'constant').every((entry) => entry.category === 'constant'),
    ).toBe(true);
  });

  it('uses plain-language status labels', () => {
    expect(arduinoSupportStatusLabel('supported')).toBe('Работает');
    expect(arduinoSupportStatusLabel('limited')).toBe('Ограничено');
    expect(arduinoSupportStatusLabel('unsupported')).toBe('Пока не работает');
  });

  it('inserts a dragged example at the selected code position', () => {
    expect(insertArduinoSnippet('void loop() {\n}\n', 'digitalWrite(13, HIGH);', 14)).toEqual({
      source: 'void loop() {\ndigitalWrite(13, HIGH);\n}\n',
      cursor: 38,
    });
    expect(insertArduinoSnippet('void setup() {}', 'void loop() {}', 15).source).toBe(
      'void setup() {}\nvoid loop() {}',
    );
  });

  it('targets a precise line boundary while dragging', () => {
    const source = 'void setup() {\n}\n\nvoid loop() {\n}\n';
    expect(arduinoSnippetDropTarget(source, 10, 0, 20)).toMatchObject({
      lineIndex: 0,
      position: 0,
      top: 10,
    });
    expect(arduinoSnippetDropTarget(source, 68, 0, 20)).toMatchObject({
      lineIndex: 2,
      position: 17,
      top: 68,
    });
    expect(arduinoSnippetDropTarget(source, 10, 58, 20)).toMatchObject({
      lineIndex: 2,
      position: 17,
      top: 10,
    });
  });
});
