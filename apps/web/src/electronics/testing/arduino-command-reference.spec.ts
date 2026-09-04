import { describe, expect, it } from 'vitest';
import { ARDUINO_TEXT_COMMAND_SUPPORT } from '@asa-lab/electronics';
import {
  ARDUINO_COMMAND_REFERENCE,
  arduinoSupportStatusLabel,
  filterArduinoCommandReference,
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
      expect(entry.status).toBe(ARDUINO_TEXT_COMMAND_SUPPORT[entry.command].status);
    }
  });

  it('filters by category and Russian or source-language text', () => {
    expect(filterArduinoCommandReference('последовательный', 'all').length).toBeGreaterThan(0);
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
});
