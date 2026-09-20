import { describe, expect, it } from 'vitest';
import {
  ARDUINO_SERVO_PROFILE,
  advanceArduinoServoWaveforms,
  arduinoServoDeclarationNames,
  arduinoServoPulseWidthMicroseconds,
  arduinoServoWaveforms,
  attachArduinoServo,
  initialArduinoServoRuntimeState,
  isArduinoServoRuntimeState,
  readArduinoServo,
  writeArduinoServo,
} from '../domain/arduino-servo-runtime.js';
import {
  advanceClockedArduinoRuntime,
  advanceArduinoRuntime,
  type ArduinoRuntimeState,
} from '../domain/arduino-program-runtime.js';

function through(
  source: string,
  targetMs: number,
  budget = 16_384,
  previous?: ArduinoRuntimeState,
) {
  for (let index = 0; index < 100_000; index += 1) {
    const result = advanceClockedArduinoRuntime(source, {}, targetMs, previous, undefined, {
      instructionBudget: budget,
    });
    if (result.executionStatus !== 'yielded') return result;
    previous = JSON.parse(JSON.stringify(result.state)) as ArduinoRuntimeState;
  }
  throw new Error('Servo program did not reach target.');
}

describe('bounded Arduino Servo.h adapter', () => {
  it('recognizes only top-level Servo declarations', () => {
    expect(
      arduinoServoDeclarationNames(
        '#include <Servo.h>\nServo left; Servo right; void setup(){Servo local;}',
      ),
    ).toEqual(['left', 'right']);
  });

  it('maps command angles to canonical pulse widths and defaults attach to 1500 us', () => {
    expect(arduinoServoPulseWidthMicroseconds(-10)).toBe(544);
    expect(arduinoServoPulseWidthMicroseconds(0)).toBe(544);
    expect(arduinoServoPulseWidthMicroseconds(90)).toBe(1472);
    expect(arduinoServoPulseWidthMicroseconds(180)).toBe(2400);
    expect(arduinoServoPulseWidthMicroseconds(999)).toBe(2400);

    const attached = attachArduinoServo(
      initialArduinoServoRuntimeState(['motor']),
      'motor',
      'd9',
      7,
    );
    expect(attached.objects.motor).toMatchObject({
      attached: true,
      pin: 'd9',
      commandedAngle: 90,
      pulseWidthMicroseconds: ARDUINO_SERVO_PROFILE.defaultPulseMicroseconds,
    });
    expect(attached.objects.motor?.waveform).toMatchObject({
      startedAtMicroseconds: 7,
      frequencyHz: 50,
      dutyNumerator: 1500,
      dutyDenominator: 20_000,
    });
  });

  it('keeps multiple Servo objects independent and reuses canonical waveform state', () => {
    let state = initialArduinoServoRuntimeState(['left', 'right']);
    state = attachArduinoServo(state, 'left', 'd9', 10);
    state = attachArduinoServo(state, 'right', 'd10', 11);
    state = writeArduinoServo(state, 'left', 30, 12);
    state = writeArduinoServo(state, 'right', 150, 13);

    expect(readArduinoServo(state, 'left')).toBe(30);
    expect(readArduinoServo(state, 'right')).toBe(150);
    expect(state.objects.left?.pin).toBe('d9');
    expect(state.objects.right?.pin).toBe('d10');
    expect(
      arduinoServoWaveforms(state).map(({ pin, waveform }) => [pin, waveform.frequencyHz]),
    ).toEqual(
      [
        ['d10', 50],
        ['d9', 50],
      ].sort(),
    );
    expect(isArduinoServoRuntimeState(JSON.parse(JSON.stringify(state)))).toBe(true);

    const due = arduinoServoWaveforms(state)[0]!.waveform;
    const advanced = advanceArduinoServoWaveforms(
      state,
      due.startedAtMicroseconds + due.dutyNumerator,
    );
    expect(advanced.state.objects.left).not.toBe(advanced.state.objects.right);
  });

  it('executes ordinary Servo.h attach/write/read source without generic object emulation', () => {
    const source = `
      #include <Servo.h>
      Servo motor;
      int angle = -1;
      void setup() {
        motor.attach(9);
        motor.write(90);
        angle = motor.read();
      }
      void loop() { delay(100); }
    `;
    const result = through(source, 1);
    expect(result.diagnostics).toEqual([]);
    expect(result.state.variables.angle).toBe(90);
    expect(result.state.servo?.objects.motor).toMatchObject({
      attached: true,
      pin: 'd9',
      commandedAngle: 90,
      pulseWidthMicroseconds: 1472,
    });
  });

  it('resets Servo objects on program change and preserves JSON continuation', () => {
    const source =
      '#include <Servo.h>\nServo motor;void setup(){motor.attach(9);motor.write(30);}void loop(){delay(100);}';
    const first = through(source, 2);
    const restored = through(source, 5, 2, JSON.parse(JSON.stringify(first.state)));
    expect(restored.state.servo).toEqual(through(source, 5, 16_384).state.servo);

    const next =
      '#include <Servo.h>\nServo other;void setup(){other.attach(10);other.write(150);}void loop(){delay(100);}';
    const changedStart = advanceArduinoRuntime(next, {}, 3, restored.state);
    expect(changedStart.state.servo?.objects.motor).toBeUndefined();
    expect(changedStart.state.servo?.objects.other).toBeDefined();
  });
});
