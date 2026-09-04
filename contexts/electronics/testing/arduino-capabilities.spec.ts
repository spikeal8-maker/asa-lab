import { describe, expect, it } from 'vitest';
import {
  ARDUINO_BLOCK_SUPPORT,
  ARDUINO_TEXT_COMMAND_SUPPORT,
  analyseArduinoSourceSupport,
  arduinoBlockSupport,
  arduinoSourceHasUnsupportedFeatures,
} from '../domain/arduino-capabilities';

describe('Arduino capability contract', () => {
  it('classifies representative blocks from the one shared registry', () => {
    expect(arduinoBlockSupport('asa_digital_write').status).toBe('supported');
    expect(arduinoBlockSupport('asa_analog_write').status).toBe('limited');
    expect(arduinoBlockSupport('asa_serial_print').status).toBe('unsupported');
    expect(Object.keys(ARDUINO_BLOCK_SUPPORT).length).toBeGreaterThan(50);
    expect(ARDUINO_TEXT_COMMAND_SUPPORT['Serial.println'].status).toBe('unsupported');
  });

  it('accepts the supported digital and analog input slice', () => {
    const diagnostics = analyseArduinoSourceSupport(`
      void setup() { pinMode(13, OUTPUT); }
      void loop() {
        if (digitalRead(2) == HIGH) {
          analogWrite(9, map(analogRead(A0), 0, 1023, 0, 255));
        }
      }
    `);

    expect(diagnostics.some((entry) => entry.status === 'unsupported')).toBe(false);
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ code: 'averaged-pwm', status: 'limited' }),
    );
  });

  it('reports libraries, member calls and unknown functions with source positions', () => {
    const diagnostics = analyseArduinoSourceSupport(`#include <Servo.h>
void loop() {
  servo_9.write(90);
  mysteryCommand(2);
}`);

    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'preprocessor', status: 'unsupported', line: 1 }),
        expect.objectContaining({ code: 'member-call', status: 'unsupported', line: 3 }),
        expect.objectContaining({ code: 'unknown-call', status: 'unsupported', line: 4 }),
      ]),
    );
    expect(arduinoSourceHasUnsupportedFeatures('#include <Servo.h>')).toBe(true);
  });

  it('does not mistake comments and string contents for commands', () => {
    const diagnostics = analyseArduinoSourceSupport(`
      // Serial.println("ignored");
      void loop() {
        /* mysteryCommand(); */
        digitalWrite(13, HIGH);
      }
    `);

    expect(diagnostics).toEqual([]);
  });

  it('fails closed for unsupported control syntax', () => {
    const diagnostics = analyseArduinoSourceSupport(
      'void loop() { switch (digitalRead(2)) { break; } }',
    );

    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'unsupported-syntax', status: 'unsupported' }),
      ]),
    );
  });
});
