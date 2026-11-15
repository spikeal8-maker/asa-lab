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
const DEENERGIZED_VOLTAGE_VOLT = 1e-6;
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
  /** Normalised irreversible motor damage. One means permanent open failure. */
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

type BrushedMotorWindingState = Pick<
  BrushedMotorTransientStateEntry,
  'currentAmp' | 'temperatureCelsius' | 'accumulatedDamage' | 'failureMode'
>;

export interface BrushedMotorExternalShaftState extends BrushedMotorWindingState {
  readonly componentId: string;
  readonly profileId: string;
  readonly profileVersion: number;
  readonly atMicroseconds: number;
}

export interface BrushedMotorExternalShaftStep {
  readonly componentId: string;
  readonly profileId: string;
  readonly profileVersion: number;
  readonly fromMicroseconds: number;
  readonly toMicroseconds: number;
  /** Positive output speed induces positive back-EMF at the positive motor terminal. */
  readonly axis: 'positive-output-shaft';
  /** Speed at the right endpoint of this backward-Euler interval. */
  readonly outputAngularVelocityRadPerSecond: number;
  /** Winding terminal voltage for this accepted interval. */
  readonly voltageVolt: number;
  readonly ambientTemperatureCelsius?: number;
}

export interface BrushedMotorExternalShaftResult {
  readonly state: BrushedMotorExternalShaftState;
  readonly companion: BrushedMotorCompanion | null;
  /** Right-end current of the interval solve, before any endpoint winding-open transition. */
  readonly intervalCurrentAmp: number;
  readonly electromagneticTorqueNewtonMeter: number;
  readonly outputTorqueNewtonMeter: number;
  readonly outputTorqueImpulseNewtonMeterSeconds: number;
  readonly viscousLossWatt: number;
  readonly transmissionLossWatt: number;
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

function heldBelowStartingVoltage(
  profile: BrushedMotorAssemblyProfile,
  state: BrushedMotorTransientStateEntry,
  voltageVolt: number,
): boolean {
  const startingVoltageMin = profile.startingVoltageMin?.value;
  return (
    startingVoltageMin !== undefined &&
    Math.abs(state.motorAngularVelocityRadPerSecond) < STOPPED_ANGULAR_VELOCITY_RAD_PER_SECOND &&
    Math.abs(voltageVolt) < startingVoltageMin
  );
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

function windingCompanion(
  effectiveResistanceOhm: number,
  inductiveHistoryVoltageVolt: number,
  backEmfVolt: number,
  loadTorque: number,
  angularVelocityRadPerSecond: number,
): BrushedMotorCompanion {
  const conductanceSiemens = 1 / effectiveResistanceOhm;
  return {
    conductanceSiemens,
    historyCurrentAmp: conductanceSiemens * (backEmfVolt - inductiveHistoryVoltageVolt),
    effectiveResistanceOhm,
    reflectedLoadTorqueNewtonMeter: loadTorque,
    mechanicalHistoryAngularVelocityRadPerSecond: angularVelocityRadPerSecond,
  };
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

  if (input.shaftLocked === true || heldBelowStartingVoltage(profile, previousState, voltageVolt)) {
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
  return windingCompanion(
    effectiveResistanceOhm,
    (inductanceHenry / stepSeconds) * previousState.currentAmp,
    backEmf * mechanicalHistoryAngularVelocityRadPerSecond,
    loadTorque,
    mechanicalHistoryAngularVelocityRadPerSecond,
  );
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

function accumulatedMotorDamage(
  profile: BrushedMotorAssemblyProfile,
  previousDamage: number,
  temperatureCelsius: number,
  voltageVolt: number,
  stepSeconds: number,
): number {
  const warning = profile.warningTemperatureCelsius.value;
  const failure = profile.failureTemperatureCelsius.value;
  const thermalExposure = Math.max(0, (temperatureCelsius - warning) / (failure - warning));
  // The vendor operating range is authoritative even while the motor is
  // unloaded and back-EMF keeps copper loss low. Beyond it, brush, commutator,
  // insulation and overspeed damage must not be presented as a healthy motor.
  // The exposure curve is an explicit educational assumption: a small excess
  // accumulates slowly, while roughly twice the maximum voltage becomes a
  // visible destructive experiment within seconds of model time.
  const maximumVoltage = profile.operatingVoltageMax.value;
  const overvoltageExposure = Math.max(0, Math.abs(voltageVolt) / maximumVoltage - 1);
  return Math.min(
    1,
    previousDamage +
      ((thermalExposure * thermalExposure + overvoltageExposure * overvoltageExposure) *
        stepSeconds) /
        BRUSHED_MOTOR_DAMAGE_EXPOSURE_SECONDS,
  );
}

function advanceWindingState(
  profile: BrushedMotorAssemblyProfile,
  previousState: BrushedMotorWindingState,
  currentAmp: number,
  voltageVolt: number,
  ambientTemperatureCelsius: number,
  stepSeconds: number,
): BrushedMotorWindingState {
  const copperLossWatt = currentAmp * currentAmp * profile.armatureResistanceOhm.value;
  const temperatureCelsius = windingTemperature(
    profile,
    previousState.temperatureCelsius,
    copperLossWatt,
    ambientTemperatureCelsius,
    stepSeconds,
  );
  const failed = previousState.failureMode === 'winding_open';
  const accumulatedDamage = failed
    ? previousState.accumulatedDamage
    : accumulatedMotorDamage(
        profile,
        previousState.accumulatedDamage,
        temperatureCelsius,
        voltageVolt,
        stepSeconds,
      );
  const failureMode =
    failed ||
    temperatureCelsius >= profile.failureTemperatureCelsius.value ||
    accumulatedDamage >= 1
      ? 'winding_open'
      : 'none';
  return {
    currentAmp: failureMode === 'winding_open' ? 0 : currentAmp,
    temperatureCelsius,
    accumulatedDamage: failureMode === 'winding_open' ? 1 : accumulatedDamage,
    failureMode,
  };
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
  // An electrically open, spinning motor develops back EMF at its terminals,
  // so terminal voltage alone cannot distinguish coast from powered running.
  // With no armature current there is no electromagnetic drive torque.
  if (Math.abs(nextState.currentAmp) < 1e-6) return 'coasting';
  if (Math.abs(input.voltageVolt) < DEENERGIZED_VOLTAGE_VOLT) return 'coasting';
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
    input.shaftLocked === true || heldBelowStartingVoltage(profile, previousState, voltageVolt)
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
  const winding = advanceWindingState(
    profile,
    previousState,
    currentAmp,
    voltageVolt,
    ambientTemperatureCelsius,
    stepSeconds,
  );
  const state: BrushedMotorTransientStateEntry = {
    ...previousState,
    simulationTimeSeconds: previousState.simulationTimeSeconds + stepSeconds,
    currentAmp: winding.currentAmp,
    motorAngularVelocityRadPerSecond,
    motorAngularPhaseRadian,
    temperatureCelsius: winding.temperatureCelsius,
    accumulatedDamage: winding.accumulatedDamage,
    failureMode: winding.failureMode,
  };
  const observation = observeBrushedMotorTransientState(
    profile,
    previousState,
    state,
    normalizedInput,
  );
  return { state, observation, companion };
}

export function createBrushedMotorExternalShaftState(
  componentId: string,
  profile: BrushedMotorAssemblyProfile,
  ambientTemperatureCelsius = BRUSHED_MOTOR_AMBIENT_TEMPERATURE_CELSIUS,
): BrushedMotorExternalShaftState {
  if (typeof componentId !== 'string' || componentId.length === 0) {
    throw new TypeError('external motor shaft component ID is required');
  }
  return {
    componentId,
    profileId: profile.profileId,
    profileVersion: profile.profileVersion,
    atMicroseconds: 0,
    currentAmp: 0,
    temperatureCelsius: requireFinite('motor ambient temperature', ambientTemperatureCelsius),
    accumulatedDamage: 0,
    failureMode: 'none',
  };
}

/** TEST_ONLY accepted winding step with externally owned shaft motion and inertia. */
export function advanceBrushedMotorExternalShaft(
  profile: BrushedMotorAssemblyProfile,
  previousState: BrushedMotorExternalShaftState,
  input: BrushedMotorExternalShaftStep,
): BrushedMotorExternalShaftResult {
  if (
    typeof previousState.componentId !== 'string' ||
    previousState.componentId.length === 0 ||
    input.componentId !== previousState.componentId ||
    input.profileId !== previousState.profileId ||
    input.profileVersion !== previousState.profileVersion ||
    previousState.profileId !== profile.profileId ||
    previousState.profileVersion !== profile.profileVersion ||
    input.axis !== 'positive-output-shaft'
  ) {
    throw new TypeError('external motor shaft identity, profile or axis mismatch');
  }
  if (
    !Number.isSafeInteger(input.fromMicroseconds) ||
    !Number.isSafeInteger(input.toMicroseconds) ||
    input.fromMicroseconds < 0 ||
    input.fromMicroseconds !== previousState.atMicroseconds ||
    input.toMicroseconds <= input.fromMicroseconds
  ) {
    throw new RangeError('external motor shaft requires a contiguous microsecond interval');
  }
  requireFinite('motor previous current', previousState.currentAmp);
  requireFinite('motor previous temperature', previousState.temperatureCelsius);
  requireNonNegative('motor previous damage', previousState.accumulatedDamage);
  const failed = previousState.failureMode === 'winding_open';
  if (
    failed
      ? previousState.currentAmp !== 0 || previousState.accumulatedDamage !== 1
      : previousState.failureMode !== 'none' || previousState.accumulatedDamage >= 1
  ) {
    throw new TypeError('external motor winding damage or failure mode is invalid');
  }

  const stepSeconds = (input.toMicroseconds - input.fromMicroseconds) / 1e6;
  const voltageVolt = requireFinite('motor voltage', input.voltageVolt);
  const ambientTemperatureCelsius =
    input.ambientTemperatureCelsius === undefined
      ? BRUSHED_MOTOR_AMBIENT_TEMPERATURE_CELSIUS
      : requireFinite('motor ambient temperature', input.ambientTemperatureCelsius);
  const outputAngularVelocity = requireFinite(
    'external motor shaft velocity',
    input.outputAngularVelocityRadPerSecond,
  );
  const transmissionRatio = ratio(profile);
  const angularVelocity = requireFinite(
    'motor velocity',
    transmissionRatio * outputAngularVelocity,
  );
  const inductiveResistanceOhm = profile.armatureInductanceHenry.value / stepSeconds;
  const companion = failed
    ? null
    : windingCompanion(
        profile.armatureResistanceOhm.value + inductiveResistanceOhm,
        inductiveResistanceOhm * previousState.currentAmp,
        profile.backEmfVoltSecondPerRadian.value * angularVelocity,
        0,
        angularVelocity,
      );
  const intervalCurrentAmp = requireFinite(
    'motor interval current',
    companion ? companion.conductanceSiemens * voltageVolt - companion.historyCurrentAmp : 0,
  );
  const winding = advanceWindingState(
    profile,
    previousState,
    intervalCurrentAmp,
    voltageVolt,
    ambientTemperatureCelsius,
    stepSeconds,
  );
  requireFinite('motor next temperature', winding.temperatureCelsius);
  requireFinite('motor next damage', winding.accumulatedDamage);

  const electromagneticTorqueNewtonMeter =
    profile.torqueNewtonMeterPerAmpere.value * intervalCurrentAmp;
  const viscousTorque = profile.viscousFrictionNewtonMeterSecondPerRadian.value * angularVelocity;
  const gearTorque = electromagneticTorqueNewtonMeter - viscousTorque;
  const gearInputPower = requireFinite('motor gear input power', gearTorque * angularVelocity);
  const efficiency = nominalTransmissionEfficiency(profile);
  // The analytical fixture assumes the same efficiency in both power directions.
  // Backdriving supplies gear losses from the shaft rather than from the winding.
  const gearTransfer = gearInputPower < 0 ? 1 / efficiency : efficiency;
  const outputTorqueNewtonMeter = requireFinite(
    'motor output torque',
    gearTorque * transmissionRatio * gearTransfer,
  );
  return {
    state: {
      componentId: previousState.componentId,
      profileId: previousState.profileId,
      profileVersion: previousState.profileVersion,
      atMicroseconds: input.toMicroseconds,
      ...winding,
    },
    companion,
    intervalCurrentAmp,
    electromagneticTorqueNewtonMeter,
    outputTorqueNewtonMeter,
    outputTorqueImpulseNewtonMeterSeconds: requireFinite(
      'motor output torque impulse',
      outputTorqueNewtonMeter * stepSeconds,
    ),
    viscousLossWatt: requireFinite('motor viscous loss', viscousTorque * angularVelocity),
    transmissionLossWatt: requireFinite(
      'motor transmission loss',
      Math.abs(gearInputPower) * Math.abs(1 - gearTransfer),
    ),
  };
}
