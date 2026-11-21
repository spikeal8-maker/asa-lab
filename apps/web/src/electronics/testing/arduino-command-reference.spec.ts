import { describe, expect, it } from 'vitest';
import {
  ARDUINO_LANGUAGE_FEATURE_SUPPORT,
  ARDUINO_TEXT_COMMAND_SUPPORT,
  type ArduinoTextCommand,
  parseElectronicsDocument,
} from '@asa-lab/electronics';
import { advanceElectronicsToHorizon } from '@asa-lab/electronics/engine';
import {
  ARDUINO_COMMAND_REFERENCE,
  ARDUINO_LANGUAGE_REFERENCE,
  ARDUINO_REFERENCE_ENTRIES,
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
      ['type-int', 'supported'],
      ['for', 'limited'],
      ['type-text', 'unsupported'],
      ['switch', 'limited'],
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
    expect(arduinoSupportStatusLabel('limited')).toBe('Особенности симуляции');
    expect(arduinoSupportStatusLabel('unsupported')).toBe('Не исполняется');
  });

  it('finds the five existing Servo entries by library aliases without duplicates', () => {
    for (const query of ['Servo', 'библиотеки', 'libraries', 'сервопривод']) {
      const entries = filterArduinoCommandReference(query, 'all');
      expect(entries.map((entry) => entry.command)).toEqual([
        'Servo.h',
        'Servo.attach',
        'Servo.write',
        'Servo.read',
        'Servo.detach',
      ]);
    }
  });

  it.each(ARDUINO_REFERENCE_ENTRIES.filter((entry) => entry.status !== 'unsupported'))(
    'executes example $id in its documented declaration/setup context',
    (entry) => {
      const globals =
        'int value=1;int counter=0;int sensor=500;int left=2;int right=4;int button1=0;int button2=1;int pressed=0;';
      const servo = '#include <Servo.h>\nServo servo;\n';
      const source =
        entry.command === 'setup'
          ? `${entry.example}\nvoid loop(){delay(10);}`
          : entry.command === 'loop'
            ? `void setup(){pinMode(13,OUTPUT);}\n${entry.example}`
            : `${entry.command === 'Servo.h' ? entry.example + '\n' : entry.command.startsWith('Servo') ? servo : ''}${globals}\nvoid setup(){\n${entry.command.startsWith('Servo.') && entry.command !== 'Servo.attach' ? 'servo.attach(9);' : ''}\n${entry.command === 'Servo.h' ? '' : entry.example}\n}\nvoid loop(){delay(10);}`;
      const parsed = parseElectronicsDocument({
        schemaVersion: 2,
        connections: [],
        components: [
          {
            id: 'uno',
            kind: 'visual',
            componentTypeId: 'arduino-uno',
            value: 5,
            position: { x: 0, y: 0 },
            pinIds: ['d13', 'power-5v', 'power-3v3', 'power-gnd-1'],
            stateProperties: { arduinoSource: source },
          },
        ],
      });
      if (!parsed.ok) throw new Error(parsed.message);
      const result = advanceElectronicsToHorizon(parsed.document, {
        requestedHorizonMicroseconds: 1000,
      });
      expect(result.diagnostics, source).toEqual([]);
      const runtime = JSON.parse(result.state.continuation!.serializedState).boards[0].runtime;
      if (entry.command === 'Servo.attach' || entry.command === 'Servo.write') {
        expect(runtime.servo?.objects.servo).toMatchObject({
          attached: true,
          pin: 'd9',
          commandedAngle: 90,
        });
      }
      if (entry.command === 'Servo.detach')
        expect(runtime.servo?.objects.servo.attached).toBe(false);
      if (entry.command === 'Serial.print')
        expect(runtime.serial?.tx.map((event: { text: string }) => event.text)).toEqual(['42']);
      if (entry.command === 'Serial.println')
        expect(runtime.serial?.tx.map((event: { text: string }) => event.text)).toEqual(['42\n']);
    },
  );

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
