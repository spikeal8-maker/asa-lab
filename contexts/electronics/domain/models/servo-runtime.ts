import type { SchematicComponent } from '../document.js';
import type { ArduinoTerminalVoltages } from '../arduino-program-runtime.js';

export const SERVO_MOTOR_PROFILE = {
  componentTypeId: 'servo-motor',
  minimumPulseMicroseconds: 544,
  maximumPulseMicroseconds: 2_400,
  minimumSupplyVolt: 4.5,
  maximumSupplyVolt: 5.5,
  digitalHighThresholdVolt: 2.5,
} as const;

export interface ServoMotorRuntimeState {
  readonly version: 1;
  readonly powered: boolean;
  readonly signalHigh: boolean;
  readonly signalHighStartedAtMicroseconds?: number | undefined;
  readonly lastValidPulseWidthMicroseconds?: number | undefined;
  readonly angleDegrees: number;
}

export function isServoMotor(component: SchematicComponent): boolean {
  return component.componentTypeId === SERVO_MOTOR_PROFILE.componentTypeId;
}

export function initialServoMotorRuntimeState(): ServoMotorRuntimeState {
  return {
    version: 1,
    powered: false,
    signalHigh: false,
    angleDegrees: 90,
  };
}

export function isServoMotorRuntimeState(value: unknown): value is ServoMotorRuntimeState {
  if (!value || typeof value !== 'object') return false;
  const state = value as Partial<ServoMotorRuntimeState>;
  return (
    state.version === 1 &&
    typeof state.powered === 'boolean' &&
    typeof state.signalHigh === 'boolean' &&
    typeof state.angleDegrees === 'number' &&
    Number.isFinite(state.angleDegrees) &&
    state.angleDegrees >= 0 &&
    state.angleDegrees <= 180 &&
    (state.signalHighStartedAtMicroseconds === undefined ||
      (Number.isSafeInteger(state.signalHighStartedAtMicroseconds) &&
        state.signalHighStartedAtMicroseconds >= 0)) &&
    (state.lastValidPulseWidthMicroseconds === undefined ||
      (Number.isSafeInteger(state.lastValidPulseWidthMicroseconds) &&
        state.lastValidPulseWidthMicroseconds >= SERVO_MOTOR_PROFILE.minimumPulseMicroseconds &&
        state.lastValidPulseWidthMicroseconds <= SERVO_MOTOR_PROFILE.maximumPulseMicroseconds))
  );
}

export function servoMotorInputLevels(terminalVoltages: ArduinoTerminalVoltages): {
  readonly powered: boolean;
  readonly signalHigh: boolean;
} {
  const ground = terminalVoltages.gnd ?? 0;
  const supply = (terminalVoltages.vcc ?? ground) - ground;
  const signal = (terminalVoltages.signal ?? ground) - ground;
  return {
    powered:
      supply >= SERVO_MOTOR_PROFILE.minimumSupplyVolt &&
      supply <= SERVO_MOTOR_PROFILE.maximumSupplyVolt,
    signalHigh: signal >= SERVO_MOTOR_PROFILE.digitalHighThresholdVolt,
  };
}

export function servoAngleFromPulseWidth(pulseWidthMicroseconds: number): number | null {
  if (
    !Number.isSafeInteger(pulseWidthMicroseconds) ||
    pulseWidthMicroseconds < SERVO_MOTOR_PROFILE.minimumPulseMicroseconds ||
    pulseWidthMicroseconds > SERVO_MOTOR_PROFILE.maximumPulseMicroseconds
  )
    return null;
  return (
    ((pulseWidthMicroseconds - SERVO_MOTOR_PROFILE.minimumPulseMicroseconds) * 180) /
    (SERVO_MOTOR_PROFILE.maximumPulseMicroseconds - SERVO_MOTOR_PROFILE.minimumPulseMicroseconds)
  );
}

export function observeServoMotorInputs(
  state: ServoMotorRuntimeState,
  atMicroseconds: number,
  powered: boolean,
  signalHigh: boolean,
): ServoMotorRuntimeState {
  if (
    !isServoMotorRuntimeState(state) ||
    !Number.isSafeInteger(atMicroseconds) ||
    atMicroseconds < 0
  )
    throw new TypeError('Invalid Servo motor runtime state.');
  if (!powered) {
    if (!state.powered && !state.signalHigh && state.signalHighStartedAtMicroseconds === undefined)
      return state;
    return {
      ...state,
      powered: false,
      signalHigh: false,
      signalHighStartedAtMicroseconds: undefined,
    };
  }
  if (!state.powered) {
    return {
      ...state,
      powered: true,
      signalHigh,
      ...(signalHigh ? { signalHighStartedAtMicroseconds: atMicroseconds } : {}),
    };
  }
  if (!state.signalHigh && signalHigh) {
    return { ...state, signalHigh: true, signalHighStartedAtMicroseconds: atMicroseconds };
  }
  if (state.signalHigh && !signalHigh) {
    const started = state.signalHighStartedAtMicroseconds;
    const pulse = started === undefined ? null : atMicroseconds - started;
    const angle = pulse === null ? null : servoAngleFromPulseWidth(pulse);
    return {
      ...state,
      signalHigh: false,
      signalHighStartedAtMicroseconds: undefined,
      ...(angle === null || pulse === null
        ? {}
        : {
            lastValidPulseWidthMicroseconds: pulse,
            angleDegrees: angle,
          }),
    };
  }
  return state.signalHigh === signalHigh ? state : { ...state, signalHigh };
}
