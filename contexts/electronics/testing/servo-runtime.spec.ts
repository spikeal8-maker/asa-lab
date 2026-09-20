import { describe, expect, it } from 'vitest';
import {
  initialServoMotorRuntimeState,
  isServoMotorRuntimeState,
  observeServoMotorInputs,
  servoAngleFromPulseWidth,
  servoMotorInputLevels,
} from '../domain/models/servo-runtime.js';

describe('canonical servo-motor pulse decoder', () => {
  it.each([
    [544, 0],
    [1472, 90],
    [2400, 180],
  ])('maps %i us to %i degrees from observed signal pulse', (pulse, angle) => {
    let state = initialServoMotorRuntimeState();
    state = observeServoMotorInputs(state, 0, true, false);
    state = observeServoMotorInputs(state, 100, true, true);
    state = observeServoMotorInputs(state, 100 + pulse, true, false);
    expect(state.lastValidPulseWidthMicroseconds).toBe(pulse);
    expect(state.angleDegrees).toBeCloseTo(angle, 8);
  });

  it('retains the last valid angle on invalid pulse or missing power', () => {
    let state = initialServoMotorRuntimeState();
    state = observeServoMotorInputs(state, 0, true, true);
    state = observeServoMotorInputs(state, 1472, true, false);
    expect(state.angleDegrees).toBeCloseTo(90, 8);

    state = observeServoMotorInputs(state, 2000, true, true);
    state = observeServoMotorInputs(state, 2200, true, false);
    expect(state.angleDegrees).toBeCloseTo(90, 8);

    state = observeServoMotorInputs(state, 3000, false, true);
    state = observeServoMotorInputs(state, 5000, false, false);
    expect(state.angleDegrees).toBeCloseTo(90, 8);
    expect(state.powered).toBe(false);
  });

  it('resumes decoding valid pulses after power returns', () => {
    let state = initialServoMotorRuntimeState();
    state = observeServoMotorInputs(state, 0, false, false);
    state = observeServoMotorInputs(state, 10, true, false);
    state = observeServoMotorInputs(state, 100, true, true);
    state = observeServoMotorInputs(state, 2500, true, false);
    expect(state.angleDegrees).toBe(180);
    expect(isServoMotorRuntimeState(JSON.parse(JSON.stringify(state)))).toBe(true);
  });

  it('interprets vcc/signal relative to gnd and rejects out-of-range pulse widths', () => {
    expect(servoMotorInputLevels({ vcc: 5, gnd: 0, signal: 5 })).toEqual({
      powered: true,
      signalHigh: true,
    });
    expect(servoMotorInputLevels({ vcc: 3.3, gnd: 0, signal: 5 })).toEqual({
      powered: false,
      signalHigh: true,
    });
    expect(servoAngleFromPulseWidth(543)).toBeNull();
    expect(servoAngleFromPulseWidth(2401)).toBeNull();
  });
});
