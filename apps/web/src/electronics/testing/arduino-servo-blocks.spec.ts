import { describe, expect, it } from 'vitest';
import * as ScratchBlocks from 'scratch-blocks';
import { parseElectronicsDocument } from '@asa-lab/electronics';
import {
  advanceArduinoCircuitClock,
  type ArduinoCircuitClockState,
} from '@asa-lab/electronics/simulation';
import { generateArduinoCode, registerArduinoBlocks } from '../arduino-blocks';

describe('block-generated Servo source vertical path', () => {
  it('runs Servo block source through Arduino waveform, circuit and servo-motor angle', () => {
    registerArduinoBlocks();
    ScratchBlocks.Events.disable();
    const workspace = new ScratchBlocks.Workspace();
    try {
      const loop = workspace.newBlock('asa_loop');
      const write = workspace.newBlock('asa_servo_write');
      write.setFieldValue('9', 'PIN');
      write.setFieldValue('90', 'ANGLE');
      loop.getInput('DO')!.connection!.connect(write.previousConnection!);

      const source = generateArduinoCode(workspace);
      expect(source).toContain('#include <Servo.h>');
      expect(source).toContain('Servo servo_9;');
      expect(source).toContain('servo_9.attach(9);');
      expect(source).toContain('servo_9.write(90);');

      const parsed = parseElectronicsDocument({
        schemaVersion: 2,
        components: [
          {
            id: 'uno',
            kind: 'visual',
            value: 5,
            position: { x: 0, y: 0 },
            componentTypeId: 'arduino-uno',
            pinIds: ['d9', 'd13', 'power-5v', 'power-3v3', 'power-gnd-1'],
            stateProperties: { arduinoSource: source },
          },
          {
            id: 'servo',
            kind: 'visual',
            value: 0,
            position: { x: 0, y: 0 },
            componentTypeId: 'servo-motor',
            variantId: 'servo-motor',
            pinIds: ['gnd', 'vcc', 'signal'],
          },
        ],
        connections: [
          {
            id: 'vcc',
            from: { componentId: 'uno', terminal: 'power-5v' },
            to: { componentId: 'servo', terminal: 'vcc' },
          },
          {
            id: 'gnd',
            from: { componentId: 'uno', terminal: 'power-gnd-1' },
            to: { componentId: 'servo', terminal: 'gnd' },
          },
          {
            id: 'signal',
            from: { componentId: 'uno', terminal: 'd9' },
            to: { componentId: 'servo', terminal: 'signal' },
          },
        ],
      });
      if (!parsed.ok) throw new Error(parsed.message);

      let previous: ArduinoCircuitClockState | undefined;
      let done: ReturnType<typeof advanceArduinoCircuitClock> | undefined;
      for (let iteration = 0; iteration < 10_000; iteration += 1) {
        done = advanceArduinoCircuitClock(parsed.document, 5_000, previous, { maxClockEvents: 1 });
        if (done.executionStatus !== 'yielded') break;
        previous = JSON.parse(JSON.stringify(done.state)) as ArduinoCircuitClockState;
      }

      expect(done?.executionStatus, JSON.stringify(done?.diagnostics)).toBe('ready');
      const board = done!.state!.boards.find((entry) => entry.componentId === 'uno')!.runtime;
      expect(board.servo?.objects.servo_9).toMatchObject({
        attached: true,
        pin: 'd9',
        commandedAngle: 90,
        pulseWidthMicroseconds: 1472,
      });
      expect(
        done!.state!.servoMotors?.find((entry) => entry.componentId === 'servo')?.runtime,
      ).toMatchObject({
        powered: true,
        lastValidPulseWidthMicroseconds: 1472,
      });
      expect(
        done!.result!.components.find((entry) => entry.componentId === 'servo')?.servoAngleDegrees,
      ).toBeCloseTo(90, 8);
    } finally {
      workspace.dispose();
      ScratchBlocks.Events.enable();
    }
  });
});
