import type { SchematicComponent } from '../document.js';
import {
  resolveBrushedMotorProfileSelection,
  type BrushedMotorAssemblyProfile,
  type MotorProfileSelectionError,
} from './brushed-motor-profiles.js';

export const BRUSHED_MOTOR_TRANSIENT_MODEL_VERSION = 1;
export const BRUSHED_MOTOR_AMBIENT_TEMPERATURE_CELSIUS = 25;
export const BRUSHED_MOTOR_DAMAGE_EXPOSURE_SECONDS = 10;

const TWO_PI = 2 * Math.PI;
const STOPPED_ANGULAR_VELOCITY_RAD_PER_SECOND = 0.1;
const MIN_STEP_SECONDS = 1e-9;

export type BrushedMotorFailureMode = 'none' | 'winding_open';
export type BrushedMotorDirection = 'clockwise' | 'counterclockwise' | 'stopped';
export type BrushedMotorOperatingMode =
  'stopped' | 'starting' | 'running' | 'coasting' | 'reversing' | 'stalled' | 'failed';
export type BrushedMotorThermalState = 'normal' | 'warning' | 'destructive' | 'failed';

export interface BrushedMotorTransientStateEntry {
  readonly modelVersion: typeof BRUSHED_MOTOR_TRANSIENT_MODEL_VERSION;
  readonly componentId: string;
  readonly profileId: string;
  readonly profileVersion: number;
  readonly simulationTimeSeconds: number;
  readonly currentAmp: number;
  readonly motorAngularVelocityRadPerSecond: number;
  readonly motorAngularPhaseRadian: number;
  readonly temperatureCelsius: number;
  /** Normalised irreversible winding damage. One means permanent open failure. */
  readonly accumulatedDamage: number;
  readonly failureMode: BrushedMotorFailureMode;
}

export interface BrushedMotorStepInput {
  /** Voltage at the positive terminal relative to the negative terminal. */
  readonly voltageVolt: number;
  readonly stepSeconds: number;
  /** Mechanical load applied at the visible output shaft. Always a magnitude. */
  readonly outputLoadTorqueNewtonMeter?: number;
  /** Represents a physically blocked shaft, not a diagnostic shortcut. */
  readonly shaftLocked?: boolean;
  readonly ambientTemperatureCelsius?: number;
}

export interface BrushedMotorCompanion {
  readonly conductanceSiemens: number;
  /** Branch current is G*V - historyCurrentAmp. */
  readonly historyCurrentAmp: number;
  readonly effectiveResistanceOhm: number;
  readonly reflectedLoadTorqueNewtonMeter: number;
  readonly mechanicalHistoryAngularVelocityRadPerSecond: number;
}

export interface BrushedMotorObservation {
  readonly voltageVolt: number;
  readonly currentAmp: number;
  readonly motorRpm: number;
  readonly outputRpm: number;
  readonly direction: BrushedMotorDirection;
  readonly operatingMode: BrushedMotorOperatingMode;
  readonly electromagneticTorqueNewtonMeter: number;
  readonly outputTorqueNewtonMeter: number;
  readonly outputLoadTorqueNewtonMeter: number;
  readonly transmissionEfficiency: number;
  readonly electricalInputPowerWatt: number;
  readonly copperLossWatt: number;
  readonly motorMechanicalPowerWatt: number;
  readonly outputMechanicalPowerWatt: number;
  readonly temperatureCelsius: number;
  readonly accumulatedDamage: number;
  readonly currentUtilization: number;
  readonly thermalState: BrushedMotorThermalState;
  readonly failureMode: BrushedMotorFailureMode;
}

export interface BrushedMotorStepResult {
  readonly state: BrushedMotorTransientStateEntry;
  readonly observation: BrushedMotorObservation;
  readonly companion: BrushedMotorCompanion | null;
}

export type BrushedMotorInitialStateResult =
  | {
      readonly ok: true;
      readonly profile: BrushedMotorAssemblyProfile;
      readonly state: BrushedMotorTransientStateEntry;
    }
  | { readonly ok: false; readonly error: MotorProfileSelectionError };

function requireFinite(name: string, value: number): number {
  if (!Number.isFinite(value)) throw new TypeError(`${name} must be finite`);
  return value;
}

function requireNonNegative(name: string, value: number): number {
  requireFinite(name, value);
  if (value < 0) throw new RangeError(`${name} must not be negative`);
  return value;
}

function requirePositive(name: string, value: number): number {
  requireFinite(name, value);
  if (value <= 0) throw new RangeError(`${name} must be positive`);
  return value;
}

function ratio(profile: BrushedMotorAssemblyProfile): number {
  return profile.transmission.gearRatio.value;
}

function nominalTransmissionEfficiency(profile: BrushedMotorAssemblyProfile): number {
  const fallback =
    (profile.transmission.efficiencyLowerBound.value +
      profile.transmission.efficiencyUpperBound.value) /
    2;
  const fitPoint = profile.referencePoints.find(
    (point) => point.voltageVolt === profile.fitReferenceVoltageVolt,
  );
  if (fitPoint?.outputStallTorqueNewtonMeter === undefined) return fallback;
  const derived =
    fitPoint.outputStallTorqueNewtonMeter /
    (profile.torqueNewtonMeterPerAmpere.value *
      fitPoint.stallCurrentAmp *
      profile.transmission.gearRatio.value);
  if (!Number.isFinite(derived) || derived <= 0) return fallback;
  return Math.min(
    profile.transmission.efficiencyUpperBound.value,
    Math.max(profile.transmission.efficiencyLowerBound.value, derived),
  );
}

function motorRpm(angularVelocityRadPerSecond: number): number {
  return (angularVelocityRadPerSecond * 60) / TWO_PI;
}

function normalizedPhase(radian: number): number {
  const phase = radian % TWO_PI;
  return phase < 0 ? phase + TWO_PI : phase;
}

function directionFor(angularVelocityRadPerSecond: number): BrushedMotorDirection {
  if (Math.abs(angularVelocityRadPerSecond) < STOPPED_ANGULAR_VELOCITY_RAD_PER_SECOND) {
    return 'stopped';
  }
  return angularVelocityRadPerSecond > 0 ? 'clockwise' : 'counterclockwise';
}

function reflectedLoadTorque(
  profile: BrushedMotorAssemblyProfile,
  outputLoadTorqueNewtonMeter: number,
): number {
  if (outputLoadTorqueNewtonMeter === 0) return 0;
  return outputLoadTorqueNewtonMeter / (ratio(profile) * nominalTransmissionEfficiency(profile));
}

function signedOpposingLoadTorque(
  reflectedLoadTorqueNewtonMeter: number,
  previousAngularVelocityRadPerSecond: number,
  appliedVoltageVolt: number,
): number {
  const direction =
    Math.abs(previousAngularVelocityRadPerSecond) >= STOPPED_ANGULAR_VELOCITY_RAD_PER_SECOND
      ? Math.sign(previousAngularVelocityRadPerSecond)
      : Math.sign(appliedVoltageVolt);
  return reflectedLoadTorqueNewtonMeter * direction;
}

function validateState(
  state: BrushedMotorTransientStateEntry,
  profile: BrushedMotorAssemblyProfile,
): void {
  if (
    state.modelVersion !== BRUSHED_MOTOR_TRANSIENT_MODEL_VERSION ||
    state.profileId !== profile.profileId ||
    state.profileVersion !== profile.profileVersion
  ) {
    throw new TypeError('brushed motor transient state is incompatible with the profile');
  }
  for (const [name, value] of Object.entries({
    simulationTimeSeconds: state.simulationTimeSeconds,
    currentAmp: state.currentAmp,
    motorAngularVelocityRadPerSecond: state.motorAngularVelocityRadPerSecond,
    motorAngularPhaseRadian: state.motorAngularPhaseRadian,
    temperatureCelsius: state.temperatureCelsius,
    accumulatedDamage: state.accumulatedDamage,
  })) {
    requireFinite(name, value);
  }
  if (state.simulationTimeSeconds < 0) throw new RangeError('simulation time must not be negative');
  if (state.accumulatedDamage < 0 || state.accumulatedDamage > 1) {
    throw new RangeError('motor accumulated damage must be from zero to one');
  }
  if (state.failureMode !== 'none' && state.failureMode !== 'winding_open') {
    throw new TypeError('motor failure mode is invalid');
  }
}

export function createBrushedMotorTransientState(
  componentId: string,
  profile: BrushedMotorAssemblyProfile,
  ambientTemperatureCelsius = BRUSHED_MOTOR_AMBIENT_TEMPERATURE_CELSIUS,
): BrushedMotorTransientStateEntry {
  requireFinite('ambient temperature', ambientTemperatureCelsius);
  return {
    modelVersion: BRUSHED_MOTOR_TRANSIENT_MODEL_VERSION,
    componentId,
    profileId: profile.profileId,
    profileVersion: profile.profileVersion,
    simulationTimeSeconds: 0,
    currentAmp: 0,
    motorAngularVelocityRadPerSecond: 0,
    motorAngularPhaseRadian: 0,
    temperatureCelsius: ambientTemperatureCelsius,
    accumulatedDamage: 0,
    failureMode: 'none',
  };
}

export function createBrushedMotorTransientStateForComponent(
  component: SchematicComponent,
  ambientTemperatureCelsius = BRUSHED_MOTOR_AMBIENT_TEMPERATURE_CELSIUS,
): BrushedMotorInitialStateResult {
  const selection = resolveBrushedMotorProfileSelection(component);
  if (!selection.ok) return selection;
  return {
    ok: true,
    profile: selection.profile,
    state: createBrushedMotorTransientState(
      component.id,
      selection.profile,
      ambientTemperatureCelsius,
    ),
  };
}

export function brushedMotorTransientStateIsCompatible(
  state: BrushedMotorTransientStateEntry,
  componentId: string,
  profile: BrushedMotorAssemblyProfile,
): boolean {
  return (
    state.modelVersion === BRUSHED_MOTOR_TRANSIENT_MODEL_VERSION &&
    state.componentId === componentId &&
    state.profileId === profile.profileId &&
    state.profileVersion === profile.profileVersion &&
    Number.isFinite(state.simulationTimeSeconds) &&
    state.simulationTimeSeconds >= 0 &&
    Number.isFinite(state.currentAmp) &&
    Number.isFinite(state.motorAngularVelocityRadPerSecond) &&
    Number.isFinite(state.motorAngularPhaseRadian) &&
    Number.isFinite(state.temperatureCelsius) &&
    Number.isFinite(state.accumulatedDamage) &&
    state.accumulatedDamage >= 0 &&
    state.accumulatedDamage <= 1 &&
    (state.failureMode === 'none' || state.failureMode === 'winding_open')
  );
}

/**
 * Backward-Euler companion after analytically eliminating angular velocity:
 *
 * V = R*i + L*di/dt + Ke*omega
 * J*domega/dt = Kt*i - b*omega - loadTorque
 *
 * The companion can be stamped into the shared nodal solver as
 * i = G*V - I_history without adding a second, unrelated motor solver.
 */
export function brushedMotorCompanion(
  profile: BrushedMotorAssemblyProfile,
  previousState: BrushedMotorTransientStateEntry,
  input: BrushedMotorStepInput,
): BrushedMotorCompanion {
  validateState(previousState, profile);
  const stepSeconds = requirePositive('motor transient step', input.stepSeconds);
  const voltageVolt = requireFinite('motor voltage', input.voltageVolt);
  const outputLoadTorqueNewtonMeter = requireNonNegative(
    'motor output load torque',
    input.outputLoadTorqueNewtonMeter ?? 0,
  );
  const resistanceOhm = profile.armatureResistanceOhm.value;
  const inductanceHenry = profile.armatureInductanceHenry.value;
  const inertiaKgMeterSquared = profile.rotorInertiaKgMeterSquared.value;
  const viscousFriction = profile.viscousFrictionNewtonMeterSecondPerRadian.value;
  const backEmf = profile.backEmfVoltSecondPerRadian.value;
  const torqueConstant = profile.torqueNewtonMeterPerAmpere.value;
  const loadMagnitude = reflectedLoadTorque(profile, outputLoadTorqueNewtonMeter);
  const loadTorque = signedOpposingLoadTorque(
    loadMagnitude,
    previousState.motorAngularVelocityRadPerSecond,
    voltageVolt,
  );

  if (input.shaftLocked === true) {
    const effectiveResistanceOhm = resistanceOhm + inductanceHenry / stepSeconds;
    return {
      conductanceSiemens: 1 / effectiveResistanceOhm,
      historyCurrentAmp:
        -previousState.currentAmp * (inductanceHenry / stepSeconds) * (1 / effectiveResistanceOhm),
      effectiveResistanceOhm,
      reflectedLoadTorqueNewtonMeter: loadTorque,
      mechanicalHistoryAngularVelocityRadPerSecond: 0,
    };
  }

  const mechanicalDenominator = inertiaKgMeterSquared / stepSeconds + viscousFriction;
  const mechanicalHistoryAngularVelocityRadPerSecond =
    (inertiaKgMeterSquared * previousState.motorAngularVelocityRadPerSecond) /
      stepSeconds /
      mechanicalDenominator -
    loadTorque / mechanicalDenominator;
  const effectiveResistanceOhm =
    resistanceOhm +
    inductanceHenry / stepSeconds +
    (backEmf * torqueConstant) / mechanicalDenominator;
  const historyVoltageVolt =
    backEmf * mechanicalHistoryAngularVelocityRadPerSecond -
    (inductanceHenry / stepSeconds) * previousState.currentAmp;
  const conductanceSiemens = 1 / effectiveResistanceOhm;
  return {
    conductanceSiemens,
    historyCurrentAmp: conductanceSiemens * historyVoltageVolt,
    effectiveResistanceOhm,
    reflectedLoadTorqueNewtonMeter: loadTorque,
    mechanicalHistoryAngularVelocityRadPerSecond,
  };
}

function windingTemperature(
  profile: BrushedMotorAssemblyProfile,
  previousTemperatureCelsius: number,
  copperLossWatt: number,
  ambientTemperatureCelsius: number,
  stepSeconds: number,
): number {
  const thermalResistance = profile.thermalResistanceCelsiusPerWatt.value;
  const thermalCapacitance = profile.thermalCapacitanceJoulePerCelsius.value;
  const equilibriumTemperature = ambientTemperatureCelsius + copperLossWatt * thermalResistance;
  const timeConstantSeconds = thermalResistance * thermalCapacitance;
  const decay = Math.exp(-stepSeconds / timeConstantSeconds);
  return equilibriumTemperature + (previousTemperatureCelsius - equilibriumTemperature) * decay;
}

function accumulatedWindingDamage(
  profile: BrushedMotorAssemblyProfile,
  previousDamage: number,
  temperatureCelsius: number,
  stepSeconds: number,
): number {
  const warning = profile.warningTemperatureCelsius.value;
  const failure = profile.failureTemperatureCelsius.value;
  const exposure = Math.max(0, (temperatureCelsius - warning) / (failure - warning));
  return Math.min(
    1,
    previousDamage + (exposure * exposure * stepSeconds) / BRUSHED_MOTOR_DAMAGE_EXPOSURE_SECONDS,
  );
}

function thermalStateFor(
  profile: BrushedMotorAssemblyProfile,
  state: BrushedMotorTransientStateEntry,
): BrushedMotorThermalState {
  if (state.failureMode === 'winding_open') return 'failed';
  if (state.temperatureCelsius >= profile.failureTemperatureCelsius.value) return 'destructive';
  if (
    state.temperatureCelsius >=
      (profile.warningTemperatureCelsius.value + profile.failureTemperatureCelsius.value) / 2 ||
    state.accumulatedDamage >= 0.35
  ) {
    return 'destructive';
  }
  if (state.temperatureCelsius >= profile.warningTemperatureCelsius.value) return 'warning';
  return 'normal';
}

function operatingModeFor(
  previousState: BrushedMotorTransientStateEntry,
  nextState: BrushedMotorTransientStateEntry,
  input: BrushedMotorStepInput,
): BrushedMotorOperatingMode {
  if (nextState.failureMode === 'winding_open') return 'failed';
  if (input.shaftLocked === true) return 'stalled';
  const previousDirection = directionFor(previousState.motorAngularVelocityRadPerSecond);
  const nextDirection = directionFor(nextState.motorAngularVelocityRadPerSecond);
  if (
    previousDirection !== 'stopped' &&
    nextDirection !== 'stopped' &&
    previousDirection !== nextDirection
  ) {
    return 'reversing';
  }
  if (nextDirection === 'stopped') return 'stopped';
  if (Math.abs(input.voltageVolt) < 1e-9) return 'coasting';
  if (previousDirection === 'stopped') return 'starting';
  return 'running';
}

export function observeBrushedMotorTransientState(
  profile: BrushedMotorAssemblyProfile,
  previousState: BrushedMotorTransientStateEntry,
  state: BrushedMotorTransientStateEntry,
  input: BrushedMotorStepInput,
): BrushedMotorObservation {
  validateState(state, profile);
  const outputLoadTorqueNewtonMeter = requireNonNegative(
    'motor output load torque',
    input.outputLoadTorqueNewtonMeter ?? 0,
  );
  const transmissionRatio = ratio(profile);
  const efficiency = nominalTransmissionEfficiency(profile);
  const electromagneticTorqueNewtonMeter =
    profile.torqueNewtonMeterPerAmpere.value * state.currentAmp;
  const outputTorqueNewtonMeter = electromagneticTorqueNewtonMeter * transmissionRatio * efficiency;
  const motorMechanicalPowerWatt =
    electromagneticTorqueNewtonMeter * state.motorAngularVelocityRadPerSecond;
  const outputAngularVelocity = state.motorAngularVelocityRadPerSecond / transmissionRatio;
  const outputMechanicalPowerWatt = outputTorqueNewtonMeter * outputAngularVelocity;
  const stallCurrent =
    profile.referencePoints.find((point) => point.voltageVolt === profile.fitReferenceVoltageVolt)
      ?.stallCurrentAmp ?? profile.fitReferenceVoltageVolt / profile.armatureResistanceOhm.value;
  return {
    voltageVolt: input.voltageVolt,
    currentAmp: state.currentAmp,
    motorRpm: motorRpm(state.motorAngularVelocityRadPerSecond),
    outputRpm: motorRpm(outputAngularVelocity),
    direction: directionFor(state.motorAngularVelocityRadPerSecond),
    operatingMode: operatingModeFor(previousState, state, input),
    electromagneticTorqueNewtonMeter,
    outputTorqueNewtonMeter,
    outputLoadTorqueNewtonMeter,
    transmissionEfficiency: efficiency,
    electricalInputPowerWatt: input.voltageVolt * state.currentAmp,
    copperLossWatt: state.currentAmp * state.currentAmp * profile.armatureResistanceOhm.value,
    motorMechanicalPowerWatt,
    outputMechanicalPowerWatt,
    temperatureCelsius: state.temperatureCelsius,
    accumulatedDamage: state.accumulatedDamage,
    currentUtilization: Math.abs(state.currentAmp) / stallCurrent,
    thermalState: thermalStateFor(profile, state),
    failureMode: state.failureMode,
  };
}

/** Pure accepted-step transition. Calling code owns adaptive rejection. */
export function advanceBrushedMotorTransientState(
  profile: BrushedMotorAssemblyProfile,
  previousState: BrushedMotorTransientStateEntry,
  input: BrushedMotorStepInput,
): BrushedMotorStepResult {
  validateState(previousState, profile);
  const stepSeconds = Math.max(
    MIN_STEP_SECONDS,
    requirePositive('motor transient step', input.stepSeconds),
  );
  const voltageVolt = requireFinite('motor voltage', input.voltageVolt);
  const ambientTemperatureCelsius = requireFinite(
    'motor ambient temperature',
    input.ambientTemperatureCelsius ?? BRUSHED_MOTOR_AMBIENT_TEMPERATURE_CELSIUS,
  );
  const normalizedInput: BrushedMotorStepInput = {
    ...input,
    voltageVolt,
    stepSeconds,
    ambientTemperatureCelsius,
  };
  const failed = previousState.failureMode === 'winding_open';
  const companion = failed ? null : brushedMotorCompanion(profile, previousState, normalizedInput);
  const currentAmp = failed
    ? 0
    : (companion?.conductanceSiemens ?? 0) * voltageVolt - (companion?.historyCurrentAmp ?? 0);
  const inertia = profile.rotorInertiaKgMeterSquared.value;
  const friction = profile.viscousFrictionNewtonMeterSecondPerRadian.value;
  const torqueConstant = profile.torqueNewtonMeterPerAmpere.value;
  const mechanicalDenominator = inertia / stepSeconds + friction;
  const outputLoadTorqueNewtonMeter = requireNonNegative(
    'motor output load torque',
    input.outputLoadTorqueNewtonMeter ?? 0,
  );
  const loadTorque =
    companion?.reflectedLoadTorqueNewtonMeter ??
    signedOpposingLoadTorque(
      reflectedLoadTorque(profile, outputLoadTorqueNewtonMeter),
      previousState.motorAngularVelocityRadPerSecond,
      voltageVolt,
    );
  const motorAngularVelocityRadPerSecond =
    input.shaftLocked === true
      ? 0
      : (inertia * previousState.motorAngularVelocityRadPerSecond) /
          stepSeconds /
          mechanicalDenominator +
        (torqueConstant * currentAmp - loadTorque) / mechanicalDenominator;
  const motorAngularPhaseRadian = normalizedPhase(
    previousState.motorAngularPhaseRadian +
      ((previousState.motorAngularVelocityRadPerSecond + motorAngularVelocityRadPerSecond) / 2) *
        stepSeconds,
  );
  const copperLossWatt = currentAmp * currentAmp * profile.armatureResistanceOhm.value;
  const temperatureCelsius = windingTemperature(
    profile,
    previousState.temperatureCelsius,
    copperLossWatt,
    ambientTemperatureCelsius,
    stepSeconds,
  );
  const accumulatedDamage = failed
    ? previousState.accumulatedDamage
    : accumulatedWindingDamage(
        profile,
        previousState.accumulatedDamage,
        temperatureCelsius,
        stepSeconds,
      );
  const failureMode: BrushedMotorFailureMode =
    failed ||
    temperatureCelsius >= profile.failureTemperatureCelsius.value ||
    accumulatedDamage >= 1
      ? 'winding_open'
      : 'none';
  const state: BrushedMotorTransientStateEntry = {
    ...previousState,
    simulationTimeSeconds: previousState.simulationTimeSeconds + stepSeconds,
    currentAmp: failureMode === 'winding_open' ? 0 : currentAmp,
    motorAngularVelocityRadPerSecond,
    motorAngularPhaseRadian,
    temperatureCelsius,
    accumulatedDamage: failureMode === 'winding_open' ? 1 : accumulatedDamage,
    failureMode,
  };
  const observation = observeBrushedMotorTransientState(
    profile,
    previousState,
    state,
    normalizedInput,
  );
  return { state, observation, companion };
}
