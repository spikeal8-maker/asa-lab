import {
  terminalsForComponent,
  type ElectronicsDocument,
  type SchematicComponent,
  type Terminal,
} from './document.js';
import {
  ARDUINO_GROUND_TERMINALS,
  arduinoOutputBranches,
  arduinoProgrammedToneOutputs,
  isArduinoUno,
} from './arduino-model.js';
import { photoresistorResistanceOhm } from './photoresistor-model.js';
import { buildNetlist, terminalKey } from './netlist.js';
import {
  unsupportedElectricalComponents,
  validateElectricalTerminalContract,
} from './model-registry.js';
import { ledBrightnessPercent, type LedJunctionProfile } from './led-model.js';
import type { DcStampContext, IterativeDcStampContext } from './models/device-model.js';
import {
  createLinearDcDevice,
  isResistorDevice,
  isSourceDevice,
  type LinearDcObservation,
} from './models/linear-dc-models.js';
import {
  nonlinearBranchKey,
  nonlinearDcBranchesForComponent,
  nonlinearSegmentAt,
  nonlinearSegmentIndex,
  type NonlinearDcBranch,
} from './models/nonlinear-dc-models.js';
import {
  createNpnDcDevice,
  NPN_DEVICE_MODEL,
  type NpnIterationState,
  type NpnObservation,
  type NpnOperatingPoint,
} from './models/npn-dc-model.js';
import {
  createPnpDcDevice,
  PNP_DEVICE_MODEL,
  type PnpIterationState,
  type PnpOperatingPoint,
} from './models/pnp-dc-model.js';
import {
  capacitorCompanion,
  capacitorParameters,
  capacitorPropertyError,
  isElectrolyticCapacitor,
  observeCapacitor,
  type CapacitorTransientState,
  type ThermalTransientStateEntry,
} from './models/capacitor-transient-model.js';
import {
  advanceThermalState,
  thermalProfileFor,
  thermalProfileKey,
} from './models/thermal-transient-model.js';
import {
  resolveBrushedMotorProfileSelection,
  type BrushedMotorAssemblyProfile,
} from './models/brushed-motor-profiles.js';
import {
  advanceBrushedMotorTransientState,
  brushedMotorCompanion,
  brushedMotorTransientStateIsCompatible,
  createBrushedMotorTransientState,
  type BrushedMotorObservation,
  type BrushedMotorStepInput,
  type BrushedMotorStepResult,
  type BrushedMotorTransientStateEntry,
} from './models/brushed-motor-transient-model.js';

export { sourceInternalResistanceOhm } from './models/linear-dc-models.js';

export type DiagnosticCode =
  | 'circuit_ok'
  | 'no_source'
  | 'open_circuit'
  | 'short_circuit'
  | 'invalid_property'
  | 'invalid_terminal_contract'
  | 'conflicting_sources'
  | 'reverse_polarity'
  | 'resistor_near_limit'
  | 'resistor_overload'
  | 'source_overload'
  | 'diode_near_limit'
  | 'diode_overcurrent'
  | 'diode_reverse_breakdown'
  | 'led_near_limit'
  | 'led_overcurrent'
  | 'led_burnout'
  | 'transistor_reverse_bias'
  | 'transistor_overcurrent'
  | 'capacitor_reverse_polarity'
  | 'capacitor_overvoltage'
  | 'component_failed'
  | 'unsupported_component'
  | 'unsupported_topology'
  | 'numerical_instability'
  | 'nonconvergent_topology';
export type DiagnosticSeverity = 'info' | 'warning' | 'error';
export type SimulationSolveStatus = 'solved' | 'invalid' | 'unsupported' | 'nonconvergent';
export type DeviceHealth =
  | 'normal'
  | 'warning'
  | 'overheated'
  | 'failed_open'
  | 'failed_short'
  | 'stalled'
  | 'reverse_damaged';
export type DamageState = 'none' | 'destructive_preview' | 'failed';
export type PresentationState = 'normal' | 'warning' | 'destructive' | 'failed' | 'stalled';

export interface Diagnostic {
  readonly code: DiagnosticCode;
  readonly severity: DiagnosticSeverity;
  readonly message: string;
  readonly componentIds?: readonly string[];
  readonly wireIds?: readonly string[];
  readonly netIds?: readonly string[];
  readonly suggestedAction?: string;
  readonly anchors?: readonly DiagnosticAnchor[];
}

export interface DiagnosticAnchor {
  readonly kind: 'component' | 'wire' | 'net';
  readonly id: string;
}

export interface ComponentResult {
  readonly componentId: string;
  readonly voltageDrop: number;
  readonly current: number;
  readonly terminalVoltages: Readonly<Partial<Record<Terminal, number>>>;
  /** Positive values enter the component through the named physical terminal. */
  readonly terminalCurrents?: Readonly<Partial<Record<Terminal, number>>>;
  readonly voltageConstraintResidual?: number;
  readonly power?: number;
  readonly brightness?: number;
  readonly branchCurrents?: Readonly<Record<string, number>>;
  readonly branchBrightness?: Readonly<Record<string, number>>;
  readonly continuousCurrentLimitAmp?: number;
  readonly destructiveCurrentLimitAmp?: number;
  readonly reverseVoltageLimitVolt?: number;
  /** Calculated DC junction state for an ordinary diode or two-terminal LED. */
  readonly junctionState?:
    'conducting' | 'forward_blocking' | 'reverse_blocking' | 'reverse_breakdown';
  readonly lit?: boolean;
  readonly energized?: boolean;
  readonly currentUtilizationPercent?: number;
  readonly powerUtilizationPercent?: number;
  readonly stressState?: 'normal' | 'warning' | 'overcurrent' | 'burned';
  /** Physical state returned by the model; it is not a solver failure status. */
  readonly deviceHealth?: DeviceHealth;
  /** Static DC currently reports a preview; accumulated failure starts with transient analysis. */
  readonly damageState?: DamageState;
  /** Minimal on-component visual selected from calculated observations. */
  readonly presentationState?: PresentationState;
  /** Effective series resistance used to calculate source voltage sag. */
  readonly internalResistanceOhm?: number;
  /** Heat dissipated inside the source at the current operating point. */
  readonly internalPower?: number;
  /** Difference between open-circuit EMF and loaded terminal voltage. */
  readonly voltageSag?: number;
  /** Whether a source delivers current, is idle, or is back-driven by another source. */
  readonly sourceOperatingMode?: 'delivering' | 'idle' | 'absorbing';
  readonly operatingRegion?: 'cutoff' | 'active' | 'saturation' | 'ohmic';
  readonly baseCurrent?: number;
  readonly collectorCurrent?: number;
  readonly emitterCurrent?: number;
  readonly currentGain?: number;
  readonly effectiveCurrentGain?: number;
  readonly earlyVoltage?: number;
  readonly maxCollectorCurrent?: number;
  readonly maxPower?: number;
  readonly frequencyHz?: number;
  readonly soundLevel?: number;
  readonly speedPercent?: number;
  readonly direction?: 'clockwise' | 'counterclockwise' | 'stopped';
  readonly motorRpm?: number;
  readonly outputRpm?: number;
  readonly motorAngularPhaseRadian?: number;
  readonly motorOperatingMode?:
    'stopped' | 'starting' | 'running' | 'coasting' | 'reversing' | 'stalled' | 'failed';
  readonly electromagneticTorqueNewtonMeter?: number;
  readonly outputTorqueNewtonMeter?: number;
  readonly outputLoadTorqueNewtonMeter?: number;
  readonly transmissionEfficiency?: number;
  readonly copperLossWatt?: number;
  readonly motorMechanicalPowerWatt?: number;
  readonly outputMechanicalPowerWatt?: number;
  readonly windingFailureMode?: 'none' | 'winding_open';
  readonly capacitanceFarad?: number;
  readonly chargeCoulomb?: number;
  readonly storedEnergyJoule?: number;
  readonly voltageRatingVolt?: number;
  readonly temperatureCelsius?: number;
  readonly thermalLoadPercent?: number;
  readonly accumulatedDamagePercent?: number;
}

export interface NodeResult {
  readonly id: string;
  readonly voltage: number;
  readonly terminals: readonly string[];
}

export interface SolveResult {
  readonly solved: boolean;
  readonly status: SimulationSolveStatus;
  readonly current: number;
  readonly components: readonly ComponentResult[];
  readonly nodes: readonly NodeResult[];
  readonly diagnostics: readonly Diagnostic[];
  readonly iterations: number;
  readonly numericalResidual: number;
  readonly numericalTolerance: number;
  readonly transientState?: CapacitorTransientState;
  readonly transientAnalysis?: {
    readonly acceptedSteps: number;
    readonly rejectedSteps: number;
    readonly minStepMs: number;
    readonly maxStepMs: number;
  };
}

export interface SolveOptions {
  readonly simulationTimeMs?: number;
  readonly transientState?: CapacitorTransientState;
}

interface InternalSolveOptions extends SolveOptions {
  readonly transientStepSeconds?: number;
  readonly capacitorPreviousVoltageById?: Readonly<Record<string, number>>;
  readonly bjtPreviousRegionById?: Readonly<Record<string, 'cutoff' | 'active' | 'saturation'>>;
  readonly motorPreviousStateById?: Readonly<Record<string, BrushedMotorTransientStateEntry>>;
  readonly failedComponentIds?: ReadonlySet<string>;
}

const GMIN = 1e-12;
const CLOSED_RESISTANCE = 1e-4;
const LED_WARNING_RATIO = 0.8;
const LAMP_MIN_POWER_W = 0.001;
const LAMP_NOMINAL_POWER_W = 1.5;
const SHORT_CIRCUIT_CURRENT_A = 5;
const FET_DEFAULT_THRESHOLD_VOLTAGE = 2;
const FET_DEFAULT_TRANSCONDUCTANCE_FACTOR = 0.05;
const FET_DEFAULT_MAX_DRAIN_CURRENT_A = 0.5;
const FET_MIN_OHMIC_CONDUCTANCE = 1e-4;
// Passive piezos are capacitive. The present deterministic DC solve represents
// only their finite leakage; audible drive is derived separately from a
// confirmed time-varying Arduino output.
const PIEZO_DC_RESISTANCE_OHM = 100_000_000;
const TRANSIENT_TARGET_STEP_MS = 5;
const MOTOR_TRANSIENT_STEP_MS = 1;
const SWITCHED_BJT_TRANSIENT_STEP_MS = 1;
const TRANSIENT_MAX_STEP_MS = 100;
const TRANSIENT_MIN_STEP_MS = 0.01;
const SWITCHED_BJT_MIN_STEP_MS = 0.1;
const TRANSIENT_MAX_ACCEPTED_STEPS = 4_096;
const TRANSIENT_INITIAL_SAMPLE_MS = 1;
const TRANSIENT_ABSOLUTE_TOLERANCE_VOLT = 1e-5;
const TRANSIENT_RELATIVE_TOLERANCE = 5e-4;
const TRANSIENT_FAILURE_EVENT_STEP_MS = 0.001;

function damageObservationForStress(
  stressState: ComponentResult['stressState'],
): Pick<ComponentResult, 'deviceHealth' | 'damageState' | 'presentationState'> {
  switch (stressState) {
    case 'warning':
      return { deviceHealth: 'warning', damageState: 'none', presentationState: 'warning' };
    case 'overcurrent':
      return {
        deviceHealth: 'warning',
        damageState: 'destructive_preview',
        presentationState: 'destructive',
      };
    case 'burned':
      // The current DC solver has no thermal clock. Preserve the visible danger
      // without falsely claiming that an accumulated, persistent failure has
      // already happened; MATH-4 promotes this preview to a real failed state.
      return {
        deviceHealth: 'overheated',
        damageState: 'destructive_preview',
        presentationState: 'destructive',
      };
    case 'normal':
    default:
      return { deviceHealth: 'normal', damageState: 'none', presentationState: 'normal' };
  }
}

function isDcMotor(component: SchematicComponent): boolean {
  return component.componentTypeId === 'dc-motor';
}

function brushedMotorProfile(component: SchematicComponent): BrushedMotorAssemblyProfile | null {
  const selection = resolveBrushedMotorProfileSelection(component);
  return selection.ok ? selection.profile : null;
}

function brushedMotorStepInput(
  component: SchematicComponent,
  voltageVolt: number,
  stepSeconds: number,
): BrushedMotorStepInput {
  return {
    voltageVolt,
    stepSeconds,
    outputLoadTorqueNewtonMeter: Number(
      component.stateProperties?.['outputLoadTorqueNewtonMeter'] ?? 0,
    ),
    shaftLocked: component.stateProperties?.['shaftLocked'] === true,
    ambientTemperatureCelsius: Number(
      component.stateProperties?.['ambientTemperatureCelsius'] ?? 25,
    ),
  };
}

function motorStateAfterResult(
  component: SchematicComponent,
  previousState: BrushedMotorTransientStateEntry,
  result: SolveResult,
  stepSeconds: number,
): BrushedMotorStepResult | null {
  const profile = brushedMotorProfile(component);
  const solved = result.components.find((entry) => entry.componentId === component.id);
  if (!profile || !solved) return null;
  return advanceBrushedMotorTransientState(
    profile,
    previousState,
    brushedMotorStepInput(component, solved.voltageDrop, stepSeconds),
  );
}

function advanceMotorStates(
  motors: readonly SchematicComponent[],
  previousById: Readonly<Record<string, BrushedMotorTransientStateEntry>>,
  result: SolveResult,
  stepSeconds: number,
): Record<string, BrushedMotorTransientStateEntry> {
  return Object.fromEntries(
    motors.map((component) => {
      const previous = previousById[component.id];
      if (!previous) throw new Error(`Missing transient motor state for ${component.id}`);
      const transition = motorStateAfterResult(component, previous, result, stepSeconds);
      return [component.id, transition?.state ?? previous];
    }),
  );
}

function motorComponentObservation(
  component: SchematicComponent,
  transition: BrushedMotorStepResult,
): Partial<ComponentResult> {
  const observation: BrushedMotorObservation = transition.observation;
  const profile = brushedMotorProfile(component);
  const referenceRpm =
    profile?.referencePoints.find((point) => point.voltageVolt === profile.fitReferenceVoltageVolt)
      ?.noLoadSpeedRpm ?? 1;
  const failed = observation.failureMode === 'winding_open';
  const stalled = observation.operatingMode === 'stalled';
  const destructive = observation.thermalState === 'destructive';
  const warning = observation.thermalState === 'warning';
  return {
    energized:
      !failed &&
      (Math.abs(observation.currentAmp) >= CURRENT_DEADBAND_AMP ||
        observation.direction !== 'stopped'),
    speedPercent: round(Math.min(100, (Math.abs(observation.motorRpm) / referenceRpm) * 100), 2),
    direction: observation.direction,
    motorRpm: round(observation.motorRpm, 3),
    outputRpm: round(observation.outputRpm, 3),
    motorAngularPhaseRadian: round(transition.state.motorAngularPhaseRadian, 12),
    motorOperatingMode: observation.operatingMode,
    electromagneticTorqueNewtonMeter: round(observation.electromagneticTorqueNewtonMeter, 12),
    outputTorqueNewtonMeter: round(observation.outputTorqueNewtonMeter, 12),
    outputLoadTorqueNewtonMeter: round(observation.outputLoadTorqueNewtonMeter, 12),
    transmissionEfficiency: round(observation.transmissionEfficiency, 6),
    copperLossWatt: round(observation.copperLossWatt, 12),
    motorMechanicalPowerWatt: round(observation.motorMechanicalPowerWatt, 12),
    outputMechanicalPowerWatt: round(observation.outputMechanicalPowerWatt, 12),
    temperatureCelsius: round(observation.temperatureCelsius, 1),
    currentUtilizationPercent: round(observation.currentUtilization * 100, 2),
    accumulatedDamagePercent: round(observation.accumulatedDamage * 100, 2),
    windingFailureMode: observation.failureMode,
    stressState: failed
      ? 'burned'
      : destructive || stalled
        ? 'overcurrent'
        : warning
          ? 'warning'
          : 'normal',
    deviceHealth: failed
      ? 'failed_open'
      : stalled
        ? 'stalled'
        : destructive
          ? 'overheated'
          : warning
            ? 'warning'
            : 'normal',
    damageState: failed ? 'failed' : destructive ? 'destructive_preview' : 'none',
    presentationState: failed
      ? 'failed'
      : stalled
        ? 'stalled'
        : destructive
          ? 'destructive'
          : warning
            ? 'warning'
            : 'normal',
  };
}

function formatReferenceMilliamp(currentAmp: number): string {
  const rounded = Math.round(Math.abs(currentAmp) * 10_000) / 10;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)} mA`;
}

type TransistorOperatingRegion = 'cutoff' | 'active' | 'saturation' | 'ohmic';

type TransistorType = 'npn' | 'pnp' | 'fet';

interface FetTransistorModel {
  readonly transistorType: 'fet';
  readonly component: SchematicComponent;
  readonly gate: Terminal;
  readonly source: Terminal;
  readonly drain: Terminal;
  readonly thresholdVoltage: number;
  readonly transconductanceFactor: number;
  readonly maxDrainCurrent: number;
}

type TransistorModel = FetTransistorModel;

interface TransistorOperatingResult {
  readonly operatingRegion: TransistorOperatingRegion;
  readonly baseEmitterDrop: number;
  readonly collectorEmitterDrop: number;
  readonly baseCurrent: number;
  readonly collectorCurrent: number;
  readonly emitterCurrent: number;
  readonly currentGain: number;
  readonly maxCollectorCurrent: number;
  readonly power?: number;
  readonly effectiveCurrentGain?: number;
  readonly earlyVoltage?: number;
  readonly maxPower?: number;
  readonly currentUtilizationPercent?: number;
  readonly powerUtilizationPercent?: number;
  readonly stressState?: NpnObservation['stressState'];
  readonly terminalCurrents?: NpnObservation['terminalCurrents'];
  readonly diagnostics?: NpnObservation['diagnostics'];
}

function boundedProperty(
  component: SchematicComponent,
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const value = Number(component.stateProperties?.[key] ?? fallback);
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

export function transistorTypeOf(component: SchematicComponent): TransistorType {
  const raw = String(component.stateProperties?.['transistorType'] ?? '').toLowerCase();
  if (raw === 'pnp' || raw === 'fet' || raw === 'npn') return raw;
  const typeId = component.componentTypeId ?? '';
  if (typeId.includes('pnp')) return 'pnp';
  if (typeId.includes('fet')) return 'fet';
  return 'npn';
}

function transistorModel(component: SchematicComponent): TransistorModel | null {
  if (component.kind !== 'transistor') return null;
  const transistorType = transistorTypeOf(component);
  // Versioned NPN/PNP devices use their dedicated iterative models below.
  // The compact legacy path remains only for the FET until its own slice.
  if (transistorType === 'npn' || transistorType === 'pnp') return null;
  return {
    transistorType,
    component,
    gate: 'gate',
    source: 'source',
    drain: 'drain',
    thresholdVoltage: boundedProperty(
      component,
      'thresholdVoltage',
      FET_DEFAULT_THRESHOLD_VOLTAGE,
      0.5,
      5,
    ),
    transconductanceFactor: boundedProperty(
      component,
      'transconductanceFactor',
      FET_DEFAULT_TRANSCONDUCTANCE_FACTOR,
      0.001,
      10,
    ),
    maxDrainCurrent: boundedProperty(
      component,
      'maxDrainCurrent',
      FET_DEFAULT_MAX_DRAIN_CURRENT_A,
      0.001,
      20,
    ),
  };
}

function ledBrightness(
  current: number,
  profile: Pick<LedJunctionProfile, 'nominalCurrentAmp' | 'brightnessExponent'>,
): number {
  return ledBrightnessPercent(current, profile);
}

type LogicalTerminal = 'a' | 'b' | 'wiper';

function logicalTerminal(component: SchematicComponent, terminal: LogicalTerminal): Terminal {
  const type = component.componentTypeId;
  if (!type) return terminal;
  if (component.kind === 'source' && type) {
    const positive = component.pinIds?.includes('BAT+') ? 'BAT+' : 'positive';
    const negative = component.pinIds?.includes('BAT-') ? 'BAT-' : 'negative';
    return terminal === 'a' ? positive : negative;
  }
  if (component.kind === 'resistor' || component.kind === 'photoresistor')
    return terminal === 'a' ? 'lead-1' : 'lead-2';
  if (component.kind === 'piezo') return terminal === 'a' ? 'positive' : 'negative';
  if (component.kind === 'led' || component.kind === 'diode') {
    return terminal === 'a' ? 'anode' : 'cathode';
  }
  if (component.kind === 'button') return terminal === 'a' ? 'SW-A1' : 'SW-B1';
  if (component.kind === 'switch') {
    if (terminal === 'a') return 'common';
    return component.state === true ? 'throw-right' : 'throw-left';
  }
  if (component.kind === 'potentiometer') {
    if (terminal === 'wiper') return 'wiper';
    return terminal === 'a' ? 'terminal-1' : 'terminal-2';
  }
  if (component.kind === 'lamp') return terminal === 'a' ? 'L1' : 'L2';
  if (isDcMotor(component)) return terminal === 'a' ? 'positive' : 'negative';
  if (isElectrolyticCapacitor(component)) return terminal === 'a' ? 'positive' : 'negative';
  return terminal;
}

function isSimulated(component: SchematicComponent): boolean {
  return (
    isArduinoUno(component) ||
    isDcMotor(component) ||
    isElectrolyticCapacitor(component) ||
    !['breadboard', 'visual', 'wire'].includes(component.kind)
  );
}

/**
 * Presentation rounding for solved values. The default must stay far below the
 * verification tolerances in `simulation.ts` (1 µA KCL, 1 nV source voltage):
 * the quality check reads these rounded numbers, so rounding at 6 digits
 * leaked up to 0.5 µA per branch and rejected an eight-branch seven-segment
 * display as nonconvergent although the solve itself was exact.
 */
function round(value: number, digits = 12): number {
  const factor = 10 ** digits;
  const result = Math.round(value * factor) / factor;
  return Object.is(result, -0) ? 0 : result;
}

/**
 * An open switch or a reverse-biased junction conducts nothing. The linear
 * solve still returns GMIN-scale residue (~pA) there; reporting it as a
 * measured current would be inventing a value, so anything below the
 * deadband — a thousand times tighter than the 1 µA KCL tolerance — is zero.
 */
const CURRENT_DEADBAND_AMP = 1e-9;
function roundCurrent(value: number): number {
  return Math.abs(value) < CURRENT_DEADBAND_AMP ? 0 : round(value);
}

function solveLinear(matrix: number[][], rhs: number[]): number[] | null {
  const size = rhs.length;
  const augmented = matrix.map((row, index) => [...row, rhs[index] as number]);
  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(augmented[row]?.[column] ?? 0) > Math.abs(augmented[pivot]?.[column] ?? 0)) {
        pivot = row;
      }
    }
    if (Math.abs(augmented[pivot]?.[column] ?? 0) < 1e-14) return null;
    [augmented[column], augmented[pivot]] = [
      augmented[pivot] as number[],
      augmented[column] as number[],
    ];
    const divisor = augmented[column]?.[column] as number;
    for (let cell = column; cell <= size; cell += 1) {
      (augmented[column] as number[])[cell] = (augmented[column]?.[cell] as number) / divisor;
    }
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = augmented[row]?.[column] as number;
      if (Math.abs(factor) < 1e-18) continue;
      for (let cell = column; cell <= size; cell += 1) {
        (augmented[row] as number[])[cell] =
          (augmented[row]?.[cell] as number) - factor * (augmented[column]?.[cell] as number);
      }
    }
  }
  return augmented.map((row) => row[size] as number);
}

function propertyError(component: SchematicComponent): string | null {
  const capacitorError = capacitorPropertyError(component);
  if (capacitorError) return capacitorError;
  if (isDcMotor(component)) {
    const selection = resolveBrushedMotorProfileSelection(component);
    if (!selection.ok) return selection.error.message;
    const outputLoadTorque = Number(
      component.stateProperties?.['outputLoadTorqueNewtonMeter'] ?? 0,
    );
    if (!Number.isFinite(outputLoadTorque) || outputLoadTorque < 0) {
      return 'Момент нагрузки двигателя должен быть неотрицательным конечным числом.';
    }
    const ambientTemperature = Number(
      component.stateProperties?.['ambientTemperatureCelsius'] ?? 25,
    );
    if (
      !Number.isFinite(ambientTemperature) ||
      ambientTemperature < -50 ||
      ambientTemperature > 100
    ) {
      return 'Температура окружающей среды двигателя должна быть от −50 до 100 °C.';
    }
    const shaftLocked = component.stateProperties?.['shaftLocked'];
    if (shaftLocked !== undefined && typeof shaftLocked !== 'boolean') {
      return 'Состояние блокировки вала должно быть логическим значением.';
    }
  }
  if (!Number.isFinite(component.value) || component.value < 0)
    return 'Значение должно быть неотрицательным числом.';
  if (component.kind === 'source' && component.value <= 0)
    return 'Напряжение источника должно быть больше нуля.';
  if ((component.kind === 'lamp' || component.kind === 'potentiometer') && component.value <= 0) {
    return 'Сопротивление должно быть больше нуля.';
  }
  if ((component.kind === 'led' || component.kind === 'diode') && component.value <= 0)
    return 'Прямое падение напряжения должно быть больше нуля.';
  if (component.kind === 'transistor') {
    const transistorType = transistorTypeOf(component);
    if (transistorType === 'npn') {
      return NPN_DEVICE_MODEL.validate(component)[0]?.message ?? null;
    }
    if (transistorType === 'pnp') {
      return PNP_DEVICE_MODEL.validate(component)[0]?.message ?? null;
    }
    if (transistorType === 'fet') {
      const thresholdVoltage = Number(
        component.stateProperties?.['thresholdVoltage'] ?? FET_DEFAULT_THRESHOLD_VOLTAGE,
      );
      const transconductanceFactor = Number(
        component.stateProperties?.['transconductanceFactor'] ??
          FET_DEFAULT_TRANSCONDUCTANCE_FACTOR,
      );
      const maxDrainCurrent = Number(
        component.stateProperties?.['maxDrainCurrent'] ?? FET_DEFAULT_MAX_DRAIN_CURRENT_A,
      );
      if (!Number.isFinite(thresholdVoltage) || thresholdVoltage < 0.5 || thresholdVoltage > 5)
        return 'Пороговое напряжение затвора должно быть от 0,5 до 5 В.';
      if (
        !Number.isFinite(transconductanceFactor) ||
        transconductanceFactor < 0.001 ||
        transconductanceFactor > 10
      )
        return 'Крутизна полевого транзистора должна быть от 0,001 до 10 А/В².';
      if (!Number.isFinite(maxDrainCurrent) || maxDrainCurrent < 0.001 || maxDrainCurrent > 20)
        return 'Допустимый ток стока должен быть от 1 мА до 20 А.';
      return null;
    }
  }
  if (component.kind === 'potentiometer' && (component.wiperPosition ?? 0.5) < 0)
    return 'Положение движка должно быть от 0 до 1.';
  if (component.kind === 'potentiometer' && (component.wiperPosition ?? 0.5) > 1)
    return 'Положение движка должно быть от 0 до 1.';
  return null;
}

function withDiagnosticAnchors(diagnostic: Diagnostic): Diagnostic {
  if (diagnostic.anchors) return diagnostic;
  const anchors: DiagnosticAnchor[] = [
    ...(diagnostic.componentIds ?? []).map((id) => ({ kind: 'component' as const, id })),
    ...(diagnostic.wireIds ?? []).map((id) => ({ kind: 'wire' as const, id })),
    ...(diagnostic.netIds ?? []).map((id) => ({ kind: 'net' as const, id })),
  ];
  return anchors.length === 0 ? diagnostic : { ...diagnostic, anchors };
}

function applyThermalObservations(
  document: ElectronicsDocument,
  result: SolveResult,
  thermalById: ReadonlyMap<string, ThermalTransientStateEntry>,
  failedComponentIds: ReadonlySet<string>,
): SolveResult {
  const componentById = new Map(document.components.map((component) => [component.id, component]));
  const diagnostics = result.diagnostics.filter((diagnostic) => {
    if (diagnostic.code !== 'led_burnout') return true;
    return (diagnostic.componentIds ?? []).some(
      (id) => !thermalById.has(id) || failedComponentIds.has(id),
    );
  });
  for (const componentId of failedComponentIds) {
    const component = componentById.get(componentId);
    if (!component) continue;
    const code: DiagnosticCode = component.kind === 'led' ? 'led_burnout' : 'component_failed';
    if (
      diagnostics.some(
        (diagnostic) => diagnostic.code === code && diagnostic.componentIds?.includes(componentId),
      )
    ) {
      continue;
    }
    const fallbackLabel = isElectrolyticCapacitor(component)
      ? 'Конденсатор'
      : ((
          {
            source: 'Источник питания',
            resistor: 'Резистор',
            led: 'Светодиод',
            diode: 'Диод',
            transistor: 'Транзистор',
          } as Partial<Record<SchematicComponent['kind'], string>>
        )[component.kind] ?? component.id);
    diagnostics.push({
      code,
      severity: 'error',
      message: `${component.name ?? fallbackLabel}: компонент вышел из строя.`,
      componentIds: [componentId],
      suggestedAction: 'Остановите моделирование и исправьте причину перегрузки.',
    });
  }
  return {
    ...result,
    diagnostics: diagnostics.map(withDiagnosticAnchors),
    components: result.components.map((componentResult) => {
      const state = thermalById.get(componentResult.componentId);
      if (!state) return componentResult;
      const component = componentById.get(componentResult.componentId);
      const profile = component ? thermalProfileFor(component) : null;
      const temperatureCelsius = Math.round(state.temperatureCelsius * 10) / 10;
      const common = {
        temperatureCelsius,
        thermalLoadPercent: Math.round(state.loadRatio * 10_000) / 100,
        accumulatedDamagePercent: Math.min(100, Math.round(state.accumulatedDamage * 10_000) / 100),
      };
      if (state.failureMode === 'open') {
        return {
          ...componentResult,
          ...common,
          current: 0,
          power: 0,
          brightness: 0,
          lit: false,
          energized: false,
          terminalCurrents: Object.fromEntries(
            Object.keys(componentResult.terminalVoltages).map((terminal) => [terminal, 0]),
          ),
          ...(componentResult.branchCurrents
            ? {
                branchCurrents: Object.fromEntries(
                  Object.keys(componentResult.branchCurrents).map((branch) => [branch, 0]),
                ),
              }
            : {}),
          ...(componentResult.branchBrightness
            ? {
                branchBrightness: Object.fromEntries(
                  Object.keys(componentResult.branchBrightness).map((branch) => [branch, 0]),
                ),
              }
            : {}),
          stressState: 'burned',
          deviceHealth: 'failed_open',
          damageState: 'failed',
          presentationState: 'failed',
        };
      }
      const warning =
        state.temperatureCelsius >= (profile?.warningTemperatureCelsius ?? 80) ||
        componentResult.stressState === 'overcurrent' ||
        componentResult.stressState === 'burned';
      const overheated =
        state.temperatureCelsius >= (profile?.overheatTemperatureCelsius ?? 120) ||
        state.accumulatedDamage >= 0.35;
      return {
        ...componentResult,
        ...common,
        deviceHealth: overheated ? 'overheated' : warning ? 'warning' : 'normal',
        damageState: 'none',
        presentationState: overheated ? 'destructive' : warning ? 'warning' : 'normal',
      };
    }),
  };
}

export function solveCircuit(
  document: ElectronicsDocument,
  options: SolveOptions = {},
): SolveResult {
  const orderedCapacitors = document.components
    .filter(isElectrolyticCapacitor)
    .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  const orderedMotors = document.components
    .filter(isDcMotor)
    .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  const orderedThermalComponents = document.components
    .filter((component) => thermalProfileFor(component) !== null)
    .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  const transientRequested =
    orderedCapacitors.length > 0 ||
    orderedMotors.length > 0 ||
    options.simulationTimeMs !== undefined ||
    options.transientState !== undefined;
  if (!transientRequested) return solveCircuitStep(document, options);

  const requestedTimeMs = Number.isFinite(options.simulationTimeMs)
    ? Math.max(0, options.simulationTimeMs ?? 0)
    : 0;
  const targetTimeMs = Math.max(TRANSIENT_INITIAL_SAMPLE_MS, requestedTimeMs);
  const compatibleState = capacitorTransientStateIsCompatible(
    options.transientState,
    orderedCapacitors,
    orderedMotors,
    targetTimeMs,
  )
    ? options.transientState
    : undefined;
  const startTimeMs = compatibleState?.simulationTimeMs ?? 0;
  const elapsedTimeMs = Math.max(TRANSIENT_INITIAL_SAMPLE_MS, targetTimeMs - startTimeMs);
  const bjtCount = document.components.filter(
    (component) =>
      component.kind === 'transistor' &&
      (transistorTypeOf(component) === 'npn' || transistorTypeOf(component) === 'pnp'),
  ).length;
  const usesSwitchedBjtTransient = orderedCapacitors.length >= 2 && bjtCount >= 2;
  const needsDeterministicAstableStartup =
    compatibleState === undefined &&
    usesSwitchedBjtTransient &&
    orderedCapacitors.every((component) => capacitorParameters(component).initialVoltageVolt === 0);
  const previousVoltageById: Record<string, number> = Object.fromEntries(
    orderedCapacitors.map((component) => {
      const carried = compatibleState?.capacitors.find(
        (entry) => entry.componentId === component.id,
      );
      const initialVoltageVolt = capacitorParameters(component).initialVoltageVolt;
      return [component.id, carried?.voltageVolt ?? initialVoltageVolt];
    }),
  );
  const bjtRegionById: Record<string, 'cutoff' | 'active' | 'saturation'> = Object.fromEntries(
    compatibleState?.bjtRegions?.map((entry) => [entry.componentId, entry.region]) ?? [],
  );
  let motorStateById: Record<string, BrushedMotorTransientStateEntry> = Object.fromEntries(
    orderedMotors.map((component) => {
      const profile = brushedMotorProfile(component);
      if (!profile) throw new Error(`Missing validated motor profile for ${component.id}`);
      const carried = compatibleState?.motors?.find((entry) => entry.componentId === component.id);
      return [component.id, carried ?? createBrushedMotorTransientState(component.id, profile)];
    }),
  );
  if (needsDeterministicAstableStartup) {
    document.components
      .filter(
        (component) =>
          component.kind === 'transistor' &&
          (transistorTypeOf(component) === 'npn' || transistorTypeOf(component) === 'pnp'),
      )
      .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
      .forEach((component, index) => {
        // A real symmetric pair starts because transistor tolerances and noise
        // are never exactly equal. The deterministic solver uses component ID
        // order only as the first nonlinear operating-point guess; capacitor
        // voltage remains the declared physical initial voltage.
        bjtRegionById[component.id] = index % 2 === 0 ? 'saturation' : 'cutoff';
      });
  }
  const thermalById = new Map<string, ThermalTransientStateEntry>(
    orderedThermalComponents.map((component) => {
      const profile = thermalProfileFor(component)!;
      const profileKey = thermalProfileKey(component, profile);
      const carried = compatibleState?.thermal.find(
        (entry) => entry.componentId === component.id && entry.profileKey === profileKey,
      );
      return [
        component.id,
        carried ?? {
          componentId: component.id,
          profileKey,
          temperatureCelsius: profile.ambientCelsius,
          loadRatio: 0,
          accumulatedDamage: 0,
          failureMode: 'none',
        },
      ];
    }),
  );
  const failedComponentIds = new Set([
    ...[...thermalById.values()]
      .filter((entry) => entry.failureMode === 'open')
      .map((entry) => entry.componentId),
    ...Object.values(motorStateById)
      .filter((entry) => entry.failureMode === 'winding_open')
      .map((entry) => entry.componentId),
  ]);
  let accumulatedIterations = 0;
  let finalResult: SolveResult | null = null;
  let currentTimeMs = startTimeMs;
  let candidateStepMs = Math.min(
    usesSwitchedBjtTransient || orderedMotors.length > 0
      ? MOTOR_TRANSIENT_STEP_MS
      : TRANSIENT_TARGET_STEP_MS,
    elapsedTimeMs,
  );
  let acceptedSteps = 0;
  let rejectedSteps = 0;
  let minStepMs = Number.POSITIVE_INFINITY;
  let maxStepMs = 0;

  const voltageFromResult = (result: SolveResult, componentId: string, fallback: number): number =>
    result.components.find((component) => component.componentId === componentId)?.voltageDrop ??
    fallback;

  while (currentTimeMs < targetTimeMs && acceptedSteps < TRANSIENT_MAX_ACCEPTED_STEPS) {
    const remainingMs = targetTimeMs - currentTimeMs;
    const stepMs = Math.min(candidateStepMs, remainingMs);
    const common = {
      capacitorPreviousVoltageById: previousVoltageById,
      bjtPreviousRegionById: bjtRegionById,
      motorPreviousStateById: motorStateById,
      failedComponentIds,
    } as const;
    let acceptedResult: SolveResult;
    let acceptedMotorStateById = motorStateById;
    let estimatedErrorVolt = 0;

    if (orderedCapacitors.length === 0) {
      acceptedResult = solveCircuitStep(document, {
        ...common,
        simulationTimeMs: currentTimeMs + stepMs,
        transientStepSeconds: stepMs / 1_000,
      });
      accumulatedIterations += acceptedResult.iterations;
      if (acceptedResult.solved) {
        acceptedMotorStateById = advanceMotorStates(
          orderedMotors,
          motorStateById,
          acceptedResult,
          stepMs / 1_000,
        );
      }
    } else if (usesSwitchedBjtTransient) {
      // A transistor switching event is discontinuous, so Richardson error
      // estimation (one full step versus two half steps) can repeatedly chase
      // the threshold without crossing it. A bounded 1 ms backward-Euler step
      // is deterministic, stable and lets multivibrators actually change
      // state instead of asymptotically freezing at VBE.
      const switched = solveCircuitStep(document, {
        ...common,
        simulationTimeMs: currentTimeMs + stepMs,
        transientStepSeconds: stepMs / 1_000,
      });
      accumulatedIterations += switched.iterations;
      if (!switched.solved) {
        if (switched.status === 'nonconvergent' && stepMs > SWITCHED_BJT_MIN_STEP_MS) {
          rejectedSteps += 1;
          candidateStepMs = Math.max(SWITCHED_BJT_MIN_STEP_MS, stepMs / 2);
          continue;
        }
        return {
          ...switched,
          iterations: accumulatedIterations,
          ...(compatibleState ? { transientState: compatibleState } : {}),
        };
      }
      acceptedResult = switched;
      acceptedMotorStateById = advanceMotorStates(
        orderedMotors,
        motorStateById,
        acceptedResult,
        stepMs / 1_000,
      );
    } else {
      const full = solveCircuitStep(document, {
        ...common,
        simulationTimeMs: currentTimeMs + stepMs,
        transientStepSeconds: stepMs / 1_000,
      });
      const halfStepMs = stepMs / 2;
      const firstHalf = solveCircuitStep(document, {
        ...common,
        simulationTimeMs: currentTimeMs + halfStepMs,
        transientStepSeconds: halfStepMs / 1_000,
      });
      const halfVoltageById: Record<string, number> = Object.fromEntries(
        orderedCapacitors.map((capacitor) => [
          capacitor.id,
          voltageFromResult(firstHalf, capacitor.id, previousVoltageById[capacitor.id] as number),
        ]),
      );
      const halfMotorStateById = firstHalf.solved
        ? advanceMotorStates(orderedMotors, motorStateById, firstHalf, halfStepMs / 1_000)
        : motorStateById;
      const secondHalf = solveCircuitStep(document, {
        simulationTimeMs: currentTimeMs + stepMs,
        transientStepSeconds: halfStepMs / 1_000,
        capacitorPreviousVoltageById: halfVoltageById,
        bjtPreviousRegionById: bjtRegionById,
        motorPreviousStateById: halfMotorStateById,
        failedComponentIds,
      });
      accumulatedIterations += full.iterations + firstHalf.iterations + secondHalf.iterations;
      const failedSolve = [full, firstHalf, secondHalf].find((result) => !result.solved);
      if (failedSolve) {
        if (failedSolve.status === 'nonconvergent' && stepMs > TRANSIENT_MIN_STEP_MS) {
          rejectedSteps += 1;
          candidateStepMs = Math.max(TRANSIENT_MIN_STEP_MS, stepMs / 2);
          continue;
        }
        return {
          ...failedSolve,
          iterations: accumulatedIterations,
          ...(compatibleState ? { transientState: compatibleState } : {}),
        };
      }
      acceptedMotorStateById = advanceMotorStates(
        orderedMotors,
        halfMotorStateById,
        secondHalf,
        halfStepMs / 1_000,
      );
      estimatedErrorVolt = Math.max(
        0,
        ...orderedCapacitors.map((capacitor) =>
          Math.abs(
            voltageFromResult(full, capacitor.id, previousVoltageById[capacitor.id] as number) -
              voltageFromResult(
                secondHalf,
                capacitor.id,
                previousVoltageById[capacitor.id] as number,
              ),
          ),
        ),
      );
      const scaleVolt = Math.max(
        1,
        ...orderedCapacitors.map((capacitor) =>
          Math.abs(
            voltageFromResult(
              secondHalf,
              capacitor.id,
              previousVoltageById[capacitor.id] as number,
            ),
          ),
        ),
      );
      const toleranceVolt =
        TRANSIENT_ABSOLUTE_TOLERANCE_VOLT + TRANSIENT_RELATIVE_TOLERANCE * scaleVolt;
      if (estimatedErrorVolt > toleranceVolt && stepMs > TRANSIENT_MIN_STEP_MS) {
        rejectedSteps += 1;
        candidateStepMs = Math.max(TRANSIENT_MIN_STEP_MS, stepMs / 2);
        continue;
      }
      acceptedResult = secondHalf;
    }

    motorStateById = acceptedMotorStateById;

    if (!acceptedResult.solved) {
      return {
        ...acceptedResult,
        iterations: accumulatedIterations,
        ...(compatibleState ? { transientState: compatibleState } : {}),
      };
    }

    for (const capacitor of orderedCapacitors) {
      previousVoltageById[capacitor.id] = voltageFromResult(
        acceptedResult,
        capacitor.id,
        previousVoltageById[capacitor.id] as number,
      );
    }
    for (const component of acceptedResult.components) {
      if (
        component.operatingRegion === 'cutoff' ||
        component.operatingRegion === 'active' ||
        component.operatingRegion === 'saturation'
      ) {
        bjtRegionById[component.componentId] = component.operatingRegion;
      }
    }

    let failureOccurred = false;
    for (const motorState of Object.values(motorStateById)) {
      if (
        motorState.failureMode === 'winding_open' &&
        !failedComponentIds.has(motorState.componentId)
      ) {
        failedComponentIds.add(motorState.componentId);
        failureOccurred = true;
      }
    }
    for (const component of orderedThermalComponents) {
      const previous = thermalById.get(component.id)!;
      if (previous.failureMode === 'open') continue;
      const componentResult = acceptedResult.components.find(
        (entry) => entry.componentId === component.id,
      );
      if (!componentResult) continue;
      const profile = thermalProfileFor(component)!;
      const observation = advanceThermalState(
        profile,
        componentResult,
        previous.temperatureCelsius,
        previous.accumulatedDamage,
        stepMs / 1_000,
      );
      const failureMode = observation.failed ? ('open' as const) : ('none' as const);
      thermalById.set(component.id, {
        ...previous,
        temperatureCelsius: observation.temperatureCelsius,
        loadRatio: observation.loadRatio,
        accumulatedDamage: observation.failed
          ? Math.max(1, observation.accumulatedDamage)
          : observation.accumulatedDamage,
        failureMode,
      });
      if (failureMode === 'open') {
        failedComponentIds.add(component.id);
        failureOccurred = true;
      }
    }

    if (failureOccurred) {
      const postFailure = solveCircuitStep(document, {
        simulationTimeMs: currentTimeMs + stepMs,
        transientStepSeconds: TRANSIENT_FAILURE_EVENT_STEP_MS / 1_000,
        capacitorPreviousVoltageById: previousVoltageById,
        bjtPreviousRegionById: bjtRegionById,
        motorPreviousStateById: motorStateById,
        failedComponentIds,
      });
      accumulatedIterations += postFailure.iterations;
      if (postFailure.solved) {
        acceptedResult = postFailure;
        for (const capacitor of orderedCapacitors) {
          previousVoltageById[capacitor.id] = voltageFromResult(
            postFailure,
            capacitor.id,
            previousVoltageById[capacitor.id] as number,
          );
        }
      }
    }

    finalResult = applyThermalObservations(
      document,
      acceptedResult,
      thermalById,
      failedComponentIds,
    );
    currentTimeMs += stepMs;
    acceptedSteps += 1;
    minStepMs = Math.min(minStepMs, stepMs);
    maxStepMs = Math.max(maxStepMs, stepMs);
    const scaleVolt = Math.max(
      1,
      ...orderedCapacitors.map((component) => Math.abs(previousVoltageById[component.id] ?? 0)),
    );
    const toleranceVolt =
      TRANSIENT_ABSOLUTE_TOLERANCE_VOLT + TRANSIENT_RELATIVE_TOLERANCE * scaleVolt;
    candidateStepMs =
      usesSwitchedBjtTransient || orderedMotors.length > 0
        ? Math.min(SWITCHED_BJT_TRANSIENT_STEP_MS, Math.max(SWITCHED_BJT_MIN_STEP_MS, stepMs * 2))
        : Math.min(
            TRANSIENT_MAX_STEP_MS,
            estimatedErrorVolt < toleranceVolt / 8 ? stepMs * 2 : stepMs,
          );
  }

  if (!finalResult || currentTimeMs < targetTimeMs) {
    const result =
      finalResult ??
      solveCircuitStep(document, { failedComponentIds, motorPreviousStateById: motorStateById });
    return {
      ...result,
      solved: false,
      status: 'nonconvergent',
      diagnostics: [
        ...result.diagnostics,
        {
          code: 'numerical_instability',
          severity: 'error',
          message: 'Переходный расчёт не достиг заданного времени с допустимой погрешностью.',
          suggestedAction: 'Проверьте параметры быстрого переходного процесса.',
        },
      ],
      iterations: accumulatedIterations,
    };
  }

  return {
    ...finalResult,
    iterations: accumulatedIterations,
    transientState: {
      version: 2,
      simulationTimeMs: targetTimeMs,
      capacitors: orderedCapacitors.map((component) => {
        const parameters = capacitorParameters(component);
        return {
          componentId: component.id,
          capacitanceFarad: parameters.capacitanceFarad,
          initialVoltageVolt: parameters.initialVoltageVolt,
          voltageRatingVolt: parameters.voltageRatingVolt,
          voltageVolt: previousVoltageById[component.id] as number,
        };
      }),
      thermal: [...thermalById.values()],
      bjtRegions: Object.entries(bjtRegionById)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([componentId, region]) => ({ componentId, region })),
      motors: orderedMotors.map((component) => motorStateById[component.id]!),
    },
    transientAnalysis: {
      acceptedSteps,
      rejectedSteps,
      minStepMs: Number.isFinite(minStepMs) ? minStepMs : 0,
      maxStepMs,
    },
  };
}

function capacitorTransientStateIsCompatible(
  state: CapacitorTransientState | undefined,
  capacitors: readonly SchematicComponent[],
  motors: readonly SchematicComponent[],
  targetTimeMs: number,
): state is CapacitorTransientState {
  if (
    state?.version !== 2 ||
    !Number.isFinite(state.simulationTimeMs) ||
    state.simulationTimeMs < 0 ||
    state.simulationTimeMs >= targetTimeMs ||
    !Array.isArray(state.capacitors) ||
    !Array.isArray(state.thermal) ||
    state.capacitors.length !== capacitors.length ||
    (motors.length > 0
      ? !Array.isArray(state.motors) || state.motors.length !== motors.length
      : Array.isArray(state.motors) && state.motors.length > 0)
  ) {
    return false;
  }
  return (
    capacitors.every((component, index) => {
      const entry = state.capacitors[index];
      const parameters = capacitorParameters(component);
      return (
        entry?.componentId === component.id &&
        entry.capacitanceFarad === parameters.capacitanceFarad &&
        entry.initialVoltageVolt === parameters.initialVoltageVolt &&
        entry.voltageRatingVolt === parameters.voltageRatingVolt &&
        Number.isFinite(entry.voltageVolt)
      );
    }) &&
    motors.every((component, index) => {
      const entry = state.motors?.[index];
      const profile = brushedMotorProfile(component);
      return Boolean(
        entry && profile && brushedMotorTransientStateIsCompatible(entry, component.id, profile),
      );
    })
  );
}

function solveCircuitStep(
  document: ElectronicsDocument,
  options: InternalSolveOptions = {},
): SolveResult {
  const diagnostics: Diagnostic[] = [];
  const netlist = buildNetlist(document);
  const failedComponentIds = options.failedComponentIds ?? new Set<string>();
  const linearDcDevices = document.components.flatMap((component) => {
    if (failedComponentIds.has(component.id)) return [];
    const device = createLinearDcDevice(component);
    return device ? [device] : [];
  });
  const npnDcDevices = document.components.flatMap((component) => {
    if (failedComponentIds.has(component.id)) return [];
    const device = createNpnDcDevice(component);
    return device ? [device] : [];
  });
  const pnpDcDevices = document.components.flatMap((component) => {
    if (failedComponentIds.has(component.id)) return [];
    const device = createPnpDcDevice(component);
    return device ? [device] : [];
  });
  const capacitors = document.components.filter(
    (component) => isElectrolyticCapacitor(component) && !failedComponentIds.has(component.id),
  );
  const sourceDevices = linearDcDevices.filter(isSourceDevice);
  const linearDcDeviceById = new Map(
    linearDcDevices.map((device) => [device.instance.componentId, device] as const),
  );
  const sources = sourceDevices.map((device) => device.instance.component);
  const arduinoBranches = document.components.flatMap((component) =>
    failedComponentIds.has(component.id)
      ? []
      : arduinoOutputBranches(component, options.simulationTimeMs ?? 0).map((branch) => ({
          component,
          ...branch,
        })),
  );
  const empty = (
    status: Exclude<SimulationSolveStatus, 'solved'>,
    iterations = 0,
    numericalResidual = 0,
    numericalTolerance = 0,
  ): SolveResult => ({
    solved: false,
    status,
    current: 0,
    components: [],
    nodes: [],
    diagnostics: diagnostics.map(withDiagnosticAnchors),
    iterations,
    numericalResidual,
    numericalTolerance,
  });

  const invalid = document.components.flatMap((component) => {
    const message = propertyError(component);
    return message ? [{ component, message }] : [];
  });
  for (const entry of invalid) {
    diagnostics.push({
      code: 'invalid_property',
      severity: 'error',
      message: `${entry.component.name ?? entry.component.id}: ${entry.message}`,
      componentIds: [entry.component.id],
      suggestedAction: 'Исправьте значение в инспекторе компонента.',
    });
  }
  if (invalid.length > 0) return empty('invalid');
  const invalidTerminalContracts = document.components.flatMap((component) => {
    const contract = validateElectricalTerminalContract(component);
    return contract.valid ? [] : [{ component, missing: contract.missing }];
  });
  for (const entry of invalidTerminalContracts) {
    diagnostics.push({
      code: 'invalid_terminal_contract',
      severity: 'error',
      message: `${entry.component.name ?? entry.component.id}: отсутствуют обязательные выводы ${entry.missing.join(', ')}.`,
      componentIds: [entry.component.id],
      suggestedAction: 'Восстановите подтверждённый pin map компонента перед моделированием.',
    });
  }
  if (invalidTerminalContracts.length > 0) return empty('invalid');
  const unsupported = unsupportedElectricalComponents(document.components);
  if (unsupported.length > 0) {
    diagnostics.push({
      code: 'unsupported_component',
      severity: 'error',
      message: `${unsupported.length} компонент(а) не имеют подтверждённой электрической модели. Расчёт остановлен без вымышленных значений.`,
      componentIds: unsupported.map((component) => component.id),
      suggestedAction:
        'Удалите неподдерживаемый компонент или дождитесь отдельной реализации его модели.',
    });
    return empty('unsupported');
  }
  if (
    sources.length === 0 &&
    arduinoBranches.length === 0 &&
    capacitors.length === 0 &&
    failedComponentIds.size === 0
  ) {
    diagnostics.push({
      code: 'no_source',
      severity: 'error',
      message: 'В схеме нет источника постоянного напряжения.',
      suggestedAction: 'Добавьте источник и соедините замкнутую цепь.',
    });
    return empty('invalid');
  }

  const directlyShortedSourceIds = new Set<string>();
  for (const source of sources) {
    const positive = netlist.nodeOf.get(
      terminalKey(source.id, logicalTerminal(source, 'a')),
    ) as number;
    const negative = netlist.nodeOf.get(
      terminalKey(source.id, logicalTerminal(source, 'b')),
    ) as number;
    if (positive === negative) directlyShortedSourceIds.add(source.id);
  }
  // Every disconnected electrical island needs its own voltage reference.
  // Using one global reference forces unrelated loose parts and open sources
  // through tiny GMIN paths. That makes an otherwise ordinary circuit badly
  // conditioned: placing a second, unused battery beside a working LED branch
  // used to be enough for harmless floating-point residue to reject the whole
  // simulation. Wires and breadboard groups are already collapsed by the
  // netlist; component terminals join those nets into independent islands.
  const islandParent = Array.from({ length: netlist.nodeCount }, (_, node) => node);
  const findIsland = (node: number): number => {
    let root = node;
    while (islandParent[root] !== root) root = islandParent[root] as number;
    let current = node;
    while (islandParent[current] !== current) {
      const next = islandParent[current] as number;
      islandParent[current] = root;
      current = next;
    }
    return root;
  };
  const joinIsland = (left: number, right: number): void => {
    const leftRoot = findIsland(left);
    const rightRoot = findIsland(right);
    if (leftRoot !== rightRoot) islandParent[rightRoot] = leftRoot;
  };
  for (const component of document.components.filter(
    (candidate) => isSimulated(candidate) && !failedComponentIds.has(candidate.id),
  )) {
    const nodes = terminalsForComponent(component)
      .map((terminal) => netlist.nodeOf.get(terminalKey(component.id, terminal)))
      .filter((node): node is number => node !== undefined);
    const first = nodes[0];
    if (first === undefined) continue;
    for (const node of nodes.slice(1)) joinIsland(first, node);
  }
  const referenceByIsland = new Map<number, number>();
  for (const source of sources) {
    const negative = netlist.nodeOf.get(
      terminalKey(source.id, logicalTerminal(source, 'b')),
    ) as number;
    const island = findIsland(negative);
    if (!referenceByIsland.has(island)) referenceByIsland.set(island, negative);
  }
  for (const branch of arduinoBranches) {
    const ground = netlist.nodeOf.get(terminalKey(branch.component.id, branch.ground));
    if (ground === undefined) continue;
    const island = findIsland(ground);
    if (!referenceByIsland.has(island)) referenceByIsland.set(island, ground);
  }
  for (let node = 0; node < netlist.nodeCount; node += 1) {
    const island = findIsland(node);
    if (!referenceByIsland.has(island)) referenceByIsland.set(island, node);
  }
  const referenceNodes = new Set(referenceByIsland.values());

  const nodeVariables = new Map<number, number>();
  for (let node = 0; node < netlist.nodeCount; node += 1) {
    if (!referenceNodes.has(node)) nodeVariables.set(node, nodeVariables.size);
  }
  const nodeVariableCount = nodeVariables.size;
  const size = nodeVariableCount + sources.length;
  const diodeBranches = document.components.flatMap((component) =>
    failedComponentIds.has(component.id) ? [] : nonlinearDcBranchesForComponent(component),
  );
  const diodeStates = new Map<string, boolean>();
  const diodeSegmentIndices = new Map<string, number>();
  const transistorModels = document.components.flatMap((component) => {
    if (failedComponentIds.has(component.id)) return [];
    const model = transistorModel(component);
    return model ? [model] : [];
  });
  const transistorRegions = new Map<string, TransistorOperatingRegion>();
  const fetOverdrives = new Map<string, number>();
  const npnIterationStates = new Map<string, NpnIterationState>(
    npnDcDevices.map((device) => {
      const initial = device.model.initialIterationState(device.instance);
      const previousRegion = options.bjtPreviousRegionById?.[device.instance.componentId];
      return [
        device.instance.componentId,
        previousRegion ? { ...initial, region: previousRegion } : initial,
      ];
    }),
  );
  const pnpIterationStates = new Map<string, PnpIterationState>(
    pnpDcDevices.map((device) => {
      const initial = device.model.initialIterationState(device.instance);
      const previousRegion = options.bjtPreviousRegionById?.[device.instance.componentId];
      return [
        device.instance.componentId,
        previousRegion ? { ...initial, region: previousRegion } : initial,
      ];
    }),
  );
  // Start nonlinear junctions open. A real forward voltage discovered by the
  // first linear solve turns them on; an isolated LED must not create its own
  // artificial voltage across otherwise floating terminals.
  for (const branch of diodeBranches) {
    const key = nonlinearBranchKey(branch);
    diodeStates.set(key, false);
    diodeSegmentIndices.set(key, 0);
  }
  for (const transistor of transistorModels) {
    transistorRegions.set(transistor.component.id, 'cutoff');
    fetOverdrives.set(transistor.component.id, 0);
  }

  let solution: number[] | null = null;
  let converged = false;
  let iterations = 1;
  let finalMatrix: number[][] | null = null;
  let finalRhs: number[] | null = null;
  const maxIterations = document.simulation.maxIterations;
  const nodeIndex = (component: SchematicComponent, terminal: LogicalTerminal): number =>
    netlist.nodeOf.get(terminalKey(component.id, logicalTerminal(component, terminal))) as number;
  const physicalNodeIndex = (component: SchematicComponent, terminal: Terminal): number =>
    netlist.nodeOf.get(terminalKey(component.id, terminal)) as number;
  const voltageFrom = (values: number[], node: number): number =>
    referenceNodes.has(node) ? 0 : (values[nodeVariables.get(node) as number] as number);

  for (; iterations <= maxIterations; iterations += 1) {
    const matrix = Array.from({ length: size }, () => Array<number>(size).fill(0));
    const rhs = Array<number>(size).fill(0);
    const stampConductance = (left: number, right: number, conductance: number): void => {
      const li = nodeVariables.get(left);
      const ri = nodeVariables.get(right);
      if (li !== undefined) matrix[li]![li] += conductance;
      if (ri !== undefined) matrix[ri]![ri] += conductance;
      if (li !== undefined && ri !== undefined) {
        matrix[li]![ri] -= conductance;
        matrix[ri]![li] -= conductance;
      }
    };
    const stampOffset = (left: number, right: number, current: number): void => {
      const li = nodeVariables.get(left);
      const ri = nodeVariables.get(right);
      if (li !== undefined) rhs[li] += current;
      if (ri !== undefined) rhs[ri] -= current;
    };
    const stampVccs = (
      outputPositive: number,
      outputNegative: number,
      controlPositive: number,
      controlNegative: number,
      transconductance: number,
    ): void => {
      const op = nodeVariables.get(outputPositive);
      const on = nodeVariables.get(outputNegative);
      const cp = nodeVariables.get(controlPositive);
      const cn = nodeVariables.get(controlNegative);
      if (op !== undefined && cp !== undefined) matrix[op]![cp] += transconductance;
      if (op !== undefined && cn !== undefined) matrix[op]![cn] -= transconductance;
      if (on !== undefined && cp !== undefined) matrix[on]![cp] -= transconductance;
      if (on !== undefined && cn !== undefined) matrix[on]![cn] += transconductance;
    };
    const sourcePositionById = new Map(sources.map((source, index) => [source.id, index]));
    const modelStampContext: DcStampContext = {
      node(component, terminal) {
        return nodeIndex(component, terminal as LogicalTerminal);
      },
      stampConductance,
      stampVoltageSource(componentId, positive, negative, voltage, seriesResistance) {
        const sourcePosition = sourcePositionById.get(componentId);
        if (sourcePosition === undefined) return;
        const row = nodeVariableCount + sourcePosition;
        const positiveIndex = nodeVariables.get(positive);
        const negativeIndex = nodeVariables.get(negative);
        if (positiveIndex !== undefined) {
          matrix[positiveIndex]![row] += 1;
          matrix[row]![positiveIndex] += 1;
        }
        if (negativeIndex !== undefined) {
          matrix[negativeIndex]![row] -= 1;
          matrix[row]![negativeIndex] -= 1;
        }
        matrix[row]![row] -= seriesResistance;
        rhs[row] = voltage;
      },
    };
    const iterativeStampContext: IterativeDcStampContext = {
      node(component, terminal) {
        return physicalNodeIndex(component, terminal);
      },
      stampConductance,
      stampOffset,
      stampVccs,
    };

    for (const variable of nodeVariables.values()) matrix[variable]![variable] += GMIN;
    for (const branch of arduinoBranches) {
      const positive = physicalNodeIndex(branch.component, branch.terminal);
      const ground = physicalNodeIndex(branch.component, branch.ground);
      const conductance = 1 / branch.resistanceOhm;
      stampConductance(positive, ground, conductance);
      stampOffset(positive, ground, conductance * branch.targetVoltage);
    }
    for (const component of document.components) {
      if (failedComponentIds.has(component.id)) continue;
      if (isArduinoUno(component)) continue;
      if (!isSimulated(component) || component.kind === 'source') continue;
      if (['led', 'diode', 'rgb-led', 'seven-segment', 'transistor'].includes(component.kind))
        continue;
      const a = nodeIndex(component, 'a');
      const b = nodeIndex(component, 'b');
      if (component.kind === 'resistor') continue;
      if (component.kind === 'photoresistor') {
        stampConductance(a, b, 1 / photoresistorResistanceOhm(component));
      } else if (component.kind === 'piezo') {
        stampConductance(a, b, 1 / PIEZO_DC_RESISTANCE_OHM);
      } else if (component.kind === 'lamp') {
        stampConductance(a, b, 1 / component.value);
      } else if (isDcMotor(component)) {
        const profile = brushedMotorProfile(component);
        const previousState = options.motorPreviousStateById?.[component.id];
        if (!profile || !previousState) continue;
        const companion = brushedMotorCompanion(
          profile,
          previousState,
          brushedMotorStepInput(
            component,
            0,
            options.transientStepSeconds ?? TRANSIENT_INITIAL_SAMPLE_MS / 1_000,
          ),
        );
        stampConductance(a, b, companion.conductanceSiemens);
        stampOffset(a, b, companion.historyCurrentAmp);
      } else if (isElectrolyticCapacitor(component)) {
        const parameters = capacitorParameters(component);
        const previousVoltage =
          options.capacitorPreviousVoltageById?.[component.id] ?? parameters.initialVoltageVolt;
        const companion = capacitorCompanion(
          parameters,
          previousVoltage,
          options.transientStepSeconds ?? TRANSIENT_INITIAL_SAMPLE_MS / 1_000,
        );
        stampConductance(a, b, companion.conductanceSiemens);
        stampOffset(a, b, companion.historyCurrentAmp);
      } else if (component.kind === 'switch') {
        if (component.componentTypeId || component.state === true) {
          stampConductance(a, b, 1 / CLOSED_RESISTANCE);
        }
      } else if (component.kind === 'button') {
        if (component.state === true) stampConductance(a, b, 1 / CLOSED_RESISTANCE);
      } else if (component.kind === 'potentiometer') {
        const wiper = nodeIndex(component, 'wiper');
        const position = component.wiperPosition ?? 0.5;
        stampConductance(a, wiper, 1 / Math.max(CLOSED_RESISTANCE, component.value * position));
        stampConductance(
          wiper,
          b,
          1 / Math.max(CLOSED_RESISTANCE, component.value * (1 - position)),
        );
      }
    }

    for (const device of linearDcDevices.filter(isResistorDevice)) {
      device.model.stampDc(modelStampContext, device.instance);
    }

    for (const branch of diodeBranches) {
      const anode = physicalNodeIndex(branch.component, branch.anode);
      const cathode = physicalNodeIndex(branch.component, branch.cathode);
      const key = nonlinearBranchKey(branch);
      const active = diodeStates.get(key) === true;
      if (active) {
        const segment = nonlinearSegmentAt(branch, diodeSegmentIndices.get(key) ?? 0);
        const conductance = 1 / segment.dynamicResistanceOhm;
        stampConductance(anode, cathode, conductance);
        stampOffset(anode, cathode, conductance * segment.kneeVoltage);
      } else {
        stampConductance(anode, cathode, GMIN);
      }
    }

    for (const device of npnDcDevices) {
      device.model.stampDc(
        iterativeStampContext,
        device.instance,
        npnIterationStates.get(device.instance.componentId) ??
          device.model.initialIterationState(device.instance),
      );
    }
    for (const device of pnpDcDevices) {
      device.model.stampDc(
        iterativeStampContext,
        device.instance,
        pnpIterationStates.get(device.instance.componentId) ??
          device.model.initialIterationState(device.instance),
      );
    }

    for (const transistor of transistorModels) {
      const region = transistorRegions.get(transistor.component.id) ?? 'cutoff';
      const drain = physicalNodeIndex(transistor.component, transistor.drain);
      const source = physicalNodeIndex(transistor.component, transistor.source);
      const gate = physicalNodeIndex(transistor.component, transistor.gate);
      if (region === 'cutoff') {
        stampConductance(drain, source, GMIN);
        continue;
      }
      const overdrive = Math.max(0, fetOverdrives.get(transistor.component.id) ?? 0);
      if (region === 'active') {
        // Saturation region: drain current source Id = gm · (Vgs − Vth),
        // gm = k · Vov from the previous iteration (fixed-point style).
        const transconductance = transistor.transconductanceFactor * overdrive;
        stampConductance(drain, source, FET_MIN_OHMIC_CONDUCTANCE);
        stampVccs(drain, source, gate, source, transconductance);
        stampOffset(drain, source, transconductance * transistor.thresholdVoltage);
      } else {
        // Ohmic (triode) region: drain–source behaves as a conductance k · Vov.
        const conductance = Math.max(
          FET_MIN_OHMIC_CONDUCTANCE,
          transistor.transconductanceFactor * overdrive,
        );
        stampConductance(drain, source, conductance);
      }
    }

    for (const device of sourceDevices) device.model.stampDc(modelStampContext, device.instance);

    finalMatrix = matrix;
    finalRhs = rhs;
    solution = solveLinear(matrix, rhs);
    if (!solution) break;
    let changed = false;
    for (const branch of diodeBranches) {
      const key = nonlinearBranchKey(branch);
      const segmentIndex = diodeSegmentIndices.get(key) ?? 0;
      const segment = nonlinearSegmentAt(branch, segmentIndex);
      const drop =
        voltageFrom(solution, physicalNodeIndex(branch.component, branch.anode)) -
        voltageFrom(solution, physicalNodeIndex(branch.component, branch.cathode));
      const next = drop >= segment.kneeVoltage - 0.02;
      if (next !== diodeStates.get(key)) {
        diodeStates.set(key, next);
        changed = true;
      }
      const current =
        diodeStates.get(key) === true
          ? Math.max(0, (drop - segment.kneeVoltage) / segment.dynamicResistanceOhm)
          : 0;
      const nextSegmentIndex = nonlinearSegmentIndex(branch, current);
      if (nextSegmentIndex !== segmentIndex) {
        diodeSegmentIndices.set(key, nextSegmentIndex);
        changed = true;
      }
    }
    for (const device of npnDcDevices) {
      const component = device.instance.component;
      const previous =
        npnIterationStates.get(device.instance.componentId) ??
        device.model.initialIterationState(device.instance);
      const operatingPoint: NpnOperatingPoint = {
        baseEmitterDropVolt:
          voltageFrom(solution, physicalNodeIndex(component, device.instance.parameters.base)) -
          voltageFrom(solution, physicalNodeIndex(component, device.instance.parameters.emitter)),
        collectorEmitterDropVolt:
          voltageFrom(
            solution,
            physicalNodeIndex(component, device.instance.parameters.collector),
          ) -
          voltageFrom(solution, physicalNodeIndex(component, device.instance.parameters.emitter)),
      };
      const evaluated = device.model.evaluateIteration(device.instance, previous, operatingPoint);
      npnIterationStates.set(device.instance.componentId, evaluated.state);
      if (evaluated.changed) changed = true;
    }
    for (const device of pnpDcDevices) {
      const component = device.instance.component;
      const previous =
        pnpIterationStates.get(device.instance.componentId) ??
        device.model.initialIterationState(device.instance);
      const operatingPoint: PnpOperatingPoint = {
        baseEmitterDropVolt:
          voltageFrom(solution, physicalNodeIndex(component, device.instance.parameters.emitter)) -
          voltageFrom(solution, physicalNodeIndex(component, device.instance.parameters.base)),
        collectorEmitterDropVolt:
          voltageFrom(solution, physicalNodeIndex(component, device.instance.parameters.emitter)) -
          voltageFrom(solution, physicalNodeIndex(component, device.instance.parameters.collector)),
      };
      const evaluated = device.model.evaluateIteration(device.instance, previous, operatingPoint);
      pnpIterationStates.set(device.instance.componentId, evaluated.state);
      if (evaluated.changed) changed = true;
    }
    for (const transistor of transistorModels) {
      const currentRegion = transistorRegions.get(transistor.component.id) ?? 'cutoff';
      const gateVoltage = voltageFrom(
        solution,
        physicalNodeIndex(transistor.component, transistor.gate),
      );
      const drainVoltage = voltageFrom(
        solution,
        physicalNodeIndex(transistor.component, transistor.drain),
      );
      const sourceVoltage = voltageFrom(
        solution,
        physicalNodeIndex(transistor.component, transistor.source),
      );
      const overdrive = gateVoltage - sourceVoltage - transistor.thresholdVoltage;
      const drainSourceDrop = drainVoltage - sourceVoltage;
      fetOverdrives.set(transistor.component.id, Math.max(0, overdrive));
      const nextRegion: TransistorOperatingRegion =
        overdrive <= 0.02
          ? 'cutoff'
          : drainSourceDrop >= overdrive - (currentRegion === 'active' ? 0.05 : 0)
            ? 'active'
            : 'ohmic';
      if (nextRegion !== currentRegion) {
        transistorRegions.set(transistor.component.id, nextRegion);
        changed = true;
      }
    }
    if (!changed) {
      converged = true;
      break;
    }
  }

  if (!solution || !converged) {
    diagnostics.push({
      code: 'nonconvergent_topology',
      severity: 'error',
      message: 'DC-расчёт не сошёлся для этой топологии.',
      suggestedAction: 'Проверьте источники, короткие замыкания и полярность диодов.',
    });
    return empty('nonconvergent', iterations);
  }

  const numericalResidual = Math.max(
    0,
    ...(finalMatrix ?? []).map((row, rowIndex) =>
      Math.abs(
        row.reduce(
          (sum, coefficient, columnIndex) =>
            sum + coefficient * ((solution as number[])[columnIndex] ?? 0),
          0,
        ) - ((finalRhs ?? [])[rowIndex] ?? 0),
      ),
    ),
  );
  const numericalScale = Math.max(
    1,
    ...(finalRhs ?? []).map(Math.abs),
    ...(solution ?? []).map(Math.abs),
  );
  const numericalTolerance = 1e-9 * numericalScale;
  if (!Number.isFinite(numericalResidual) || numericalResidual > numericalTolerance) {
    diagnostics.push({
      code: 'numerical_instability',
      severity: 'error',
      message: 'Численная невязка DC-расчёта превышает допустимый предел.',
      suggestedAction: 'Проверьте источники, экстремальные сопротивления и короткие замыкания.',
    });
    return empty('nonconvergent', iterations, numericalResidual, numericalTolerance);
  }

  const voltageAt = (component: SchematicComponent, terminal: LogicalTerminal): number =>
    voltageFrom(solution as number[], nodeIndex(component, terminal));
  const physicalVoltageAt = (component: SchematicComponent, terminal: Terminal): number => {
    const node = netlist.nodeOf.get(terminalKey(component.id, terminal));
    return node === undefined ? 0 : voltageFrom(solution as number[], node);
  };
  const sourceCurrents = new Map<string, number>();
  for (const [position, source] of sources.entries()) {
    sourceCurrents.set(source.id, solution[nodeVariableCount + position] as number);
  }
  const currentDeliveredByArduinoBranch = (branch: (typeof arduinoBranches)[number]): number => {
    const measured =
      physicalVoltageAt(branch.component, branch.terminal) -
      physicalVoltageAt(branch.component, branch.ground);
    return (branch.targetVoltage - measured) / branch.resistanceOhm;
  };
  const resultForBranch = (branch: NonlinearDcBranch) => {
    const key = nonlinearBranchKey(branch);
    const segment = nonlinearSegmentAt(branch, diodeSegmentIndices.get(key) ?? 0);
    const voltageDrop =
      physicalVoltageAt(branch.component, branch.anode) -
      physicalVoltageAt(branch.component, branch.cathode);
    const current = diodeStates.get(key)
      ? Math.max(0, (voltageDrop - segment.kneeVoltage) / segment.dynamicResistanceOhm)
      : 0;
    return {
      voltageDrop,
      current,
      conducting: diodeStates.get(key) === true,
      brightness: branch.emitsLight
        ? ledBrightness(current, {
            nominalCurrentAmp: branch.nominalCurrentAmp,
            brightnessExponent: branch.brightnessExponent,
          })
        : 0,
    };
  };
  const npnResultById = new Map<string, TransistorOperatingResult>(
    npnDcDevices.map((device) => {
      const component = device.instance.component;
      const state =
        npnIterationStates.get(device.instance.componentId) ??
        device.model.initialIterationState(device.instance);
      const observation = device.model.observe(device.instance, state, {
        baseEmitterDropVolt:
          physicalVoltageAt(component, device.instance.parameters.base) -
          physicalVoltageAt(component, device.instance.parameters.emitter),
        collectorEmitterDropVolt:
          physicalVoltageAt(component, device.instance.parameters.collector) -
          physicalVoltageAt(component, device.instance.parameters.emitter),
      });
      return [
        device.instance.componentId,
        {
          operatingRegion: observation.operatingRegion,
          baseEmitterDrop: observation.baseEmitterDropVolt,
          collectorEmitterDrop: observation.collectorEmitterDropVolt,
          baseCurrent: observation.baseCurrentAmp,
          collectorCurrent: observation.collectorCurrentAmp,
          emitterCurrent: observation.emitterCurrentAmp,
          currentGain: observation.nominalCurrentGain,
          maxCollectorCurrent: observation.maxCollectorCurrentAmp,
          power: observation.powerWatt,
          effectiveCurrentGain: observation.effectiveCurrentGain,
          earlyVoltage: observation.earlyVoltageVolt,
          maxPower: observation.maxPowerWatt,
          currentUtilizationPercent: observation.currentUtilizationPercent,
          powerUtilizationPercent: observation.powerUtilizationPercent,
          stressState: observation.stressState,
          terminalCurrents: observation.terminalCurrents,
          diagnostics: observation.diagnostics,
        },
      ] as const;
    }),
  );
  const pnpResultById = new Map<string, TransistorOperatingResult>(
    pnpDcDevices.map((device) => {
      const component = device.instance.component;
      const state =
        pnpIterationStates.get(device.instance.componentId) ??
        device.model.initialIterationState(device.instance);
      const observation = device.model.observe(device.instance, state, {
        baseEmitterDropVolt:
          physicalVoltageAt(component, device.instance.parameters.emitter) -
          physicalVoltageAt(component, device.instance.parameters.base),
        collectorEmitterDropVolt:
          physicalVoltageAt(component, device.instance.parameters.emitter) -
          physicalVoltageAt(component, device.instance.parameters.collector),
      });
      return [
        device.instance.componentId,
        {
          operatingRegion: observation.operatingRegion,
          baseEmitterDrop: observation.baseEmitterDropVolt,
          collectorEmitterDrop: observation.collectorEmitterDropVolt,
          baseCurrent: observation.baseCurrentAmp,
          collectorCurrent: observation.collectorCurrentAmp,
          emitterCurrent: observation.emitterCurrentAmp,
          currentGain: observation.nominalCurrentGain,
          maxCollectorCurrent: observation.maxCollectorCurrentAmp,
          power: observation.powerWatt,
          effectiveCurrentGain: observation.effectiveCurrentGain,
          earlyVoltage: observation.earlyVoltageVolt,
          maxPower: observation.maxPowerWatt,
          currentUtilizationPercent: observation.currentUtilizationPercent,
          powerUtilizationPercent: observation.powerUtilizationPercent,
          stressState: observation.stressState,
          terminalCurrents: observation.terminalCurrents,
          diagnostics: observation.diagnostics,
        },
      ] as const;
    }),
  );
  const transistorResultById = new Map<string, TransistorOperatingResult>(
    transistorModels.map((transistor) => {
      const operatingRegion = transistorRegions.get(transistor.component.id) ?? 'cutoff';
      const gateVoltage = physicalVoltageAt(transistor.component, transistor.gate);
      const drainVoltage = physicalVoltageAt(transistor.component, transistor.drain);
      const sourceVoltage = physicalVoltageAt(transistor.component, transistor.source);
      const gateSourceDrop = gateVoltage - sourceVoltage;
      const drainSourceDrop = drainVoltage - sourceVoltage;
      const overdrive = Math.max(0, gateSourceDrop - transistor.thresholdVoltage);
      const drainCurrent =
        operatingRegion === 'cutoff'
          ? 0
          : operatingRegion === 'active'
            ? transistor.transconductanceFactor * overdrive * overdrive
            : Math.max(0, transistor.transconductanceFactor * overdrive * drainSourceDrop);
      return [
        transistor.component.id,
        {
          operatingRegion,
          baseEmitterDrop: gateSourceDrop,
          collectorEmitterDrop: drainSourceDrop,
          baseCurrent: 0,
          collectorCurrent: drainCurrent,
          emitterCurrent: drainCurrent,
          currentGain: 0,
          maxCollectorCurrent: transistor.maxDrainCurrent,
        },
      ] as const;
    }),
  );

  const linearDcObservationById = new Map<string, LinearDcObservation>();
  const components: ComponentResult[] = document.components
    .filter((component) => component.kind !== 'wire')
    .map((component) => {
      const terminalVoltages: Partial<Record<Terminal, number>> = {};
      for (const terminal of terminalsForComponent(component)) {
        terminalVoltages[terminal] = round(physicalVoltageAt(component, terminal));
      }
      if (failedComponentIds.has(component.id)) {
        const voltages = Object.values(terminalVoltages);
        const voltageDrop = round((voltages[0] ?? 0) - (voltages[1] ?? 0));
        const failedMotorState = isDcMotor(component)
          ? options.motorPreviousStateById?.[component.id]
          : undefined;
        const failedMotorProfile = failedMotorState ? brushedMotorProfile(component) : null;
        const failedMotorTransition =
          failedMotorState && failedMotorProfile
            ? advanceBrushedMotorTransientState(
                failedMotorProfile,
                failedMotorState,
                brushedMotorStepInput(
                  component,
                  0,
                  options.transientStepSeconds ?? TRANSIENT_INITIAL_SAMPLE_MS / 1_000,
                ),
              )
            : null;
        return {
          componentId: component.id,
          voltageDrop,
          current: 0,
          terminalVoltages,
          terminalCurrents: Object.fromEntries(
            Object.keys(terminalVoltages).map((terminal) => [terminal, 0]),
          ),
          power: 0,
          brightness: 0,
          lit: false,
          energized: false,
          stressState: 'burned',
          deviceHealth: 'failed_open',
          damageState: 'failed',
          presentationState: 'failed',
          ...(failedMotorTransition
            ? motorComponentObservation(component, failedMotorTransition)
            : {}),
        };
      }
      const branches = diodeBranches.filter((branch) => branch.component.id === component.id);
      const branchResults = branches.map((branch) => ({ branch, ...resultForBranch(branch) }));
      const componentArduinoBranches = arduinoBranches.filter(
        (branch) => branch.component.id === component.id,
      );
      const arduinoBranchResults = componentArduinoBranches.map((branch) => ({
        branch,
        voltageDrop:
          physicalVoltageAt(component, branch.terminal) -
          physicalVoltageAt(component, branch.ground),
        current: currentDeliveredByArduinoBranch(branch),
      }));
      const transistorResult =
        npnResultById.get(component.id) ??
        pnpResultById.get(component.id) ??
        transistorResultById.get(component.id);
      const voltageDrop =
        transistorResult?.collectorEmitterDrop ??
        branchResults[0]?.voltageDrop ??
        arduinoBranchResults.find((entry) => entry.branch.id === 'd13')?.voltageDrop ??
        arduinoBranchResults[0]?.voltageDrop ??
        (isSimulated(component) ? voltageAt(component, 'a') - voltageAt(component, 'b') : 0);
      const capacitorObservation = isElectrolyticCapacitor(component)
        ? observeCapacitor(
            capacitorParameters(component),
            options.capacitorPreviousVoltageById?.[component.id] ??
              capacitorParameters(component).initialVoltageVolt,
            voltageDrop,
            options.transientStepSeconds ?? TRANSIENT_INITIAL_SAMPLE_MS / 1_000,
          )
        : undefined;
      const motorStep = isDcMotor(component)
        ? (() => {
            const profile = brushedMotorProfile(component);
            const previousState = options.motorPreviousStateById?.[component.id];
            if (!profile || !previousState) return undefined;
            return advanceBrushedMotorTransientState(
              profile,
              previousState,
              brushedMotorStepInput(
                component,
                voltageDrop,
                options.transientStepSeconds ?? TRANSIENT_INITIAL_SAMPLE_MS / 1_000,
              ),
            );
          })()
        : undefined;
      const linearDcDevice = linearDcDeviceById.get(component.id);
      const reportedLinearCurrent =
        component.kind === 'source' ? -(sourceCurrents.get(component.id) ?? 0) : 0;
      const linearDcObservation: LinearDcObservation | undefined = linearDcDevice?.model.observe?.(
        linearDcDevice.instance as never,
        {
          voltageDrop,
          current: reportedLinearCurrent,
        },
      );
      if (linearDcObservation) linearDcObservationById.set(component.id, linearDcObservation);
      let current = 0;
      if (linearDcObservation) current = linearDcObservation.current;
      else if (isArduinoUno(component))
        current = Math.max(0, ...arduinoBranchResults.map((entry) => Math.abs(entry.current)));
      else if (component.kind === 'photoresistor')
        current = voltageDrop / photoresistorResistanceOhm(component);
      else if (component.kind === 'lamp') current = voltageDrop / component.value;
      else if (component.kind === 'piezo') current = voltageDrop / PIEZO_DC_RESISTANCE_OHM;
      else if (motorStep) current = motorStep.observation.currentAmp;
      else if (capacitorObservation) current = capacitorObservation.currentAmp;
      else if (component.kind === 'switch')
        current = component.componentTypeId
          ? voltageDrop / CLOSED_RESISTANCE
          : component.state === true
            ? voltageDrop / CLOSED_RESISTANCE
            : 0;
      else if (component.kind === 'button')
        current = component.state === true ? voltageDrop / CLOSED_RESISTANCE : 0;
      else if (component.kind === 'potentiometer') {
        const position = component.wiperPosition ?? 0.5;
        current =
          (voltageAt(component, 'a') - voltageAt(component, 'wiper')) /
          Math.max(CLOSED_RESISTANCE, component.value * position);
      } else if (transistorResult) current = transistorResult.collectorCurrent;
      else if (branches.length > 0)
        current = branchResults.reduce((sum, branch) => sum + branch.current, 0);
      const power =
        linearDcObservation?.power ??
        transistorResult?.power ??
        Math.abs(
          isArduinoUno(component)
            ? arduinoBranchResults.reduce(
                (sum, entry) => sum + Math.abs(entry.current * entry.voltageDrop),
                0,
              )
            : transistorResult
              ? transistorResult.collectorCurrent * transistorResult.collectorEmitterDrop +
                transistorResult.baseCurrent * transistorResult.baseEmitterDrop
              : component.kind === 'lamp'
                ? current * voltageDrop
                : branchResults.length > 0
                  ? branchResults.reduce(
                      (sum, branch) => sum + branch.current * branch.voltageDrop,
                      0,
                    )
                  : current * voltageDrop,
        );
      const branchCurrents = transistorResult
        ? transistorTypeOf(component) === 'fet'
          ? {
              gate: roundCurrent(transistorResult.baseCurrent),
              drain: roundCurrent(transistorResult.collectorCurrent),
              source: roundCurrent(transistorResult.emitterCurrent),
            }
          : {
              base: roundCurrent(transistorResult.baseCurrent),
              collector: roundCurrent(transistorResult.collectorCurrent),
              emitter: roundCurrent(transistorResult.emitterCurrent),
            }
        : isArduinoUno(component)
          ? Object.fromEntries(
              arduinoBranchResults.map(({ branch, current: branchCurrent }) => [
                branch.id,
                roundCurrent(branchCurrent),
              ]),
            )
          : Object.fromEntries(
              branchResults.map(({ branch, current: branchCurrent }) => [
                branch.id,
                roundCurrent(branchCurrent),
              ]),
            );
      const branchBrightness = Object.fromEntries(
        branchResults.map(({ branch, brightness }) => [branch.id, round(brightness, 2)]),
      );
      const brightness =
        component.kind === 'lamp'
          ? Math.min(100, Math.pow(power / LAMP_NOMINAL_POWER_W, 0.55) * 100)
          : Math.max(0, ...Object.values(branchBrightness));
      const powerUtilizationPercent =
        linearDcObservation?.powerUtilizationPercent ?? transistorResult?.powerUtilizationPercent;
      const currentUtilizationPercent =
        transistorResult?.currentUtilizationPercent ??
        (branches.length > 0
          ? Math.max(
              0,
              ...branchResults.map(({ branch, current: branchCurrent }) =>
                Math.abs((branchCurrent / branch.nominalCurrentAmp) * 100),
              ),
            )
          : undefined);
      const sourceCurrentUtilizationPercent = linearDcObservation?.currentUtilizationPercent;
      const reverseBreakdown = branchResults.some(
        ({ branch, voltageDrop: branchVoltageDrop }) =>
          branchVoltageDrop < -branch.repetitivePeakReverseVoltage,
      );
      const stressState =
        linearDcObservation?.stressState ??
        transistorResult?.stressState ??
        (branches.length === 0
          ? undefined
          : reverseBreakdown ||
              branchResults.some(
                ({ branch, current: branchCurrent }) =>
                  Math.abs(branchCurrent) > branch.destructiveCurrentAmp,
              )
            ? 'burned'
            : branchResults.some(
                  ({ branch, current: branchCurrent }) =>
                    Math.abs(branchCurrent) > branch.nominalCurrentAmp,
                )
              ? 'overcurrent'
              : branchResults.some(
                    ({ branch, current: branchCurrent }) =>
                      branch.nearLimitWarning &&
                      Math.abs(branchCurrent) >= branch.nominalCurrentAmp * LED_WARNING_RATIO,
                  )
                ? 'warning'
                : 'normal');
      const piezoTone =
        component.kind === 'piezo'
          ? (() => {
              const positiveNode = netlist.nodeOf.get(terminalKey(component.id, 'positive'));
              const negativeNode = netlist.nodeOf.get(terminalKey(component.id, 'negative'));
              if (positiveNode === undefined || negativeNode === undefined) return null;
              for (const arduino of document.components.filter(isArduinoUno)) {
                const groundNodes = ARDUINO_GROUND_TERMINALS.map((terminal) =>
                  netlist.nodeOf.get(terminalKey(arduino.id, terminal)),
                ).filter((node): node is number => node !== undefined);
                for (const tone of arduinoProgrammedToneOutputs(
                  arduino,
                  options.simulationTimeMs ?? 0,
                ).values()) {
                  const toneNode = netlist.nodeOf.get(terminalKey(arduino.id, tone.terminal));
                  if (toneNode === undefined) continue;
                  if (
                    (toneNode === positiveNode && groundNodes.includes(negativeNode)) ||
                    (toneNode === negativeNode && groundNodes.includes(positiveNode))
                  ) {
                    return tone;
                  }
                }
              }
              return null;
            })()
          : null;
      return {
        componentId: component.id,
        voltageDrop: round(voltageDrop),
        current: roundCurrent(current),
        terminalVoltages,
        ...(motorStep
          ? {
              terminalCurrents: {
                positive: roundCurrent(motorStep.observation.currentAmp),
                negative: roundCurrent(-motorStep.observation.currentAmp),
              },
            }
          : capacitorObservation
            ? {
                terminalCurrents: {
                  positive: roundCurrent(capacitorObservation.currentAmp),
                  negative: roundCurrent(-capacitorObservation.currentAmp),
                },
              }
            : linearDcObservation
              ? {
                  terminalCurrents: Object.fromEntries(
                    Object.entries(linearDcObservation.terminalCurrents).map(
                      ([terminal, value]) => [terminal, roundCurrent(value)],
                    ),
                  ),
                  ...(linearDcObservation.voltageConstraintResidual === undefined
                    ? {}
                    : {
                        voltageConstraintResidual: round(
                          linearDcObservation.voltageConstraintResidual,
                        ),
                      }),
                }
              : transistorResult?.terminalCurrents
                ? {
                    terminalCurrents: Object.fromEntries(
                      Object.entries(transistorResult.terminalCurrents).map(([terminal, value]) => [
                        terminal,
                        roundCurrent(value),
                      ]),
                    ),
                  }
                : {}),
        power: round(power),
        brightness: round(brightness, 2),
        ...(branches.length > 0 || transistorResult || isArduinoUno(component)
          ? {
              branchCurrents,
              ...(branches.length > 0 ? { branchBrightness } : {}),
            }
          : {}),
        ...(branches.length === 1
          ? {
              continuousCurrentLimitAmp: branches[0]!.nominalCurrentAmp,
              destructiveCurrentLimitAmp: branches[0]!.destructiveCurrentAmp,
              reverseVoltageLimitVolt: branches[0]!.repetitivePeakReverseVoltage,
              ...(component.kind === 'diode' || component.kind === 'led'
                ? {
                    junctionState: reverseBreakdown
                      ? ('reverse_breakdown' as const)
                      : branchResults[0]!.conducting
                        ? ('conducting' as const)
                        : branchResults[0]!.voltageDrop < 0
                          ? ('reverse_blocking' as const)
                          : ('forward_blocking' as const),
                  }
                : {}),
            }
          : {}),
        ...((currentUtilizationPercent ?? sourceCurrentUtilizationPercent) === undefined ||
        stressState === undefined
          ? {}
          : {
              currentUtilizationPercent: round(
                currentUtilizationPercent ?? (sourceCurrentUtilizationPercent as number),
                2,
              ),
            }),
        ...(powerUtilizationPercent === undefined
          ? {}
          : { powerUtilizationPercent: round(powerUtilizationPercent, 2) }),
        ...(stressState === undefined
          ? {}
          : {
              stressState,
              ...(reverseBreakdown
                ? {
                    deviceHealth: 'reverse_damaged' as const,
                    damageState: 'destructive_preview' as const,
                    presentationState: 'destructive' as const,
                  }
                : damageObservationForStress(stressState)),
            }),
        ...(linearDcObservation?.internalResistanceOhm !== undefined
          ? {
              internalResistanceOhm: round(linearDcObservation.internalResistanceOhm, 6),
              internalPower: round(linearDcObservation.internalPower ?? 0),
              voltageSag: round(linearDcObservation.voltageSag ?? 0),
              sourceOperatingMode: linearDcObservation.sourceOperatingMode ?? 'idle',
            }
          : {}),
        ...(component.kind === 'led' ||
        component.kind === 'rgb-led' ||
        component.kind === 'seven-segment'
          ? { lit: brightness > 0 }
          : {}),
        ...(component.kind === 'lamp'
          ? {
              lit: Math.abs(current * voltageDrop) >= LAMP_MIN_POWER_W,
              energized: Math.abs(current) > 1e-6,
            }
          : {}),
        ...(component.kind === 'piezo'
          ? {
              energized: piezoTone !== null,
              frequencyHz: round(piezoTone?.frequencyHz ?? 0, 2),
              soundLevel:
                piezoTone === null ? 0 : component.componentTypeId === 'piezo-disc' ? 0.55 : 0.8,
            }
          : {}),
        ...(isDcMotor(component)
          ? motorStep
            ? motorComponentObservation(component, motorStep)
            : {
                energized: false,
                speedPercent: 0,
                direction: 'stopped' as const,
              }
          : {}),
        ...(capacitorObservation
          ? {
              capacitanceFarad: round(capacitorParameters(component).capacitanceFarad, 12),
              chargeCoulomb: round(capacitorObservation.chargeCoulomb, 12),
              storedEnergyJoule: round(capacitorObservation.storedEnergyJoule, 12),
              voltageRatingVolt: round(capacitorParameters(component).voltageRatingVolt, 3),
              stressState: capacitorObservation.overVoltage
                ? ('burned' as const)
                : ('normal' as const),
              deviceHealth: capacitorObservation.overVoltage
                ? ('overheated' as const)
                : ('normal' as const),
              damageState: capacitorObservation.overVoltage
                ? ('destructive_preview' as const)
                : ('none' as const),
              presentationState: capacitorObservation.overVoltage
                ? ('destructive' as const)
                : ('normal' as const),
            }
          : {}),
        ...(isArduinoUno(component) ? { energized: true } : {}),
        ...(transistorResult
          ? {
              operatingRegion: transistorResult.operatingRegion,
              baseCurrent: roundCurrent(transistorResult.baseCurrent),
              collectorCurrent: roundCurrent(transistorResult.collectorCurrent),
              emitterCurrent: roundCurrent(transistorResult.emitterCurrent),
              currentGain: round(transistorResult.currentGain, 2),
              ...(transistorResult.effectiveCurrentGain === undefined
                ? {}
                : { effectiveCurrentGain: round(transistorResult.effectiveCurrentGain, 2) }),
              ...(transistorResult.earlyVoltage === undefined
                ? {}
                : { earlyVoltage: round(transistorResult.earlyVoltage, 2) }),
              maxCollectorCurrent: roundCurrent(transistorResult.maxCollectorCurrent),
              ...(transistorResult.maxPower === undefined
                ? {}
                : { maxPower: round(transistorResult.maxPower) }),
            }
          : {}),
      };
    });

  for (const [componentId, observation] of linearDcObservationById) {
    diagnostics.push(
      ...observation.diagnostics.map((diagnostic) => ({
        ...diagnostic,
        code: diagnostic.code as DiagnosticCode,
        componentIds: [componentId],
      })),
    );
  }
  for (const [componentId, observation] of npnResultById) {
    diagnostics.push(
      ...(observation.diagnostics ?? []).map((diagnostic) => ({
        ...diagnostic,
        code: diagnostic.code as DiagnosticCode,
        componentIds: [componentId],
      })),
    );
  }
  for (const [componentId, observation] of pnpResultById) {
    diagnostics.push(
      ...(observation.diagnostics ?? []).map((diagnostic) => ({
        ...diagnostic,
        code: diagnostic.code as DiagnosticCode,
        componentIds: [componentId],
      })),
    );
  }

  for (const capacitor of capacitors) {
    const result = components.find((component) => component.componentId === capacitor.id);
    if (!result) continue;
    const parameters = capacitorParameters(capacitor);
    if (result.voltageDrop < -0.1) {
      diagnostics.push({
        code: 'capacitor_reverse_polarity',
        severity: 'info',
        message: `${capacitor.name ?? capacitor.id}: напряжение на выводах сейчас имеет обратный знак относительно маркировки +/−.`,
        componentIds: [capacitor.id],
        suggestedAction:
          'В переменной схеме это часть рассчитанного цикла; при постоянном обратном напряжении проверьте подключение или используйте неполярный конденсатор.',
      });
    }
    if (Math.abs(result.voltageDrop) > parameters.voltageRatingVolt) {
      diagnostics.push({
        code: 'capacitor_overvoltage',
        severity: 'error',
        message: `${capacitor.name ?? capacitor.id}: напряжение ${Math.abs(result.voltageDrop).toFixed(2)} В превышает допустимые ${parameters.voltageRatingVolt.toFixed(0)} В.`,
        componentIds: [capacitor.id],
        suggestedAction:
          'Уменьшите напряжение или выберите конденсатор с большим рабочим напряжением.',
      });
    }
  }

  for (const component of document.components.filter(
    (item) => nonlinearDcBranchesForComponent(item).length > 0,
  )) {
    const componentBranches = diodeBranches.filter(
      (branch) => branch.component.id === component.id,
    );
    const result = components.find((entry) => entry.componentId === component.id);
    const reverseBranches = componentBranches.filter((branch) => {
      const anodeVoltage = result?.terminalVoltages[branch.anode] ?? 0;
      const cathodeVoltage = result?.terminalVoltages[branch.cathode] ?? 0;
      return anodeVoltage - cathodeVoltage < -0.05;
    });
    if (reverseBranches.length > 0 && component.kind !== 'diode' && component.kind !== 'led') {
      diagnostics.push({
        code: 'reverse_polarity',
        severity: 'warning',
        message: `${component.name ?? component.id}: обратная полярность ${reverseBranches.map((branch) => branch.id).join(', ')}.`,
        componentIds: [component.id],
        suggestedAction: 'Проверьте анод, катод и общий вывод.',
      });
    }
    if (component.kind === 'diode') {
      const reverseBreakdown = componentBranches.filter((branch) => {
        const anodeVoltage = result?.terminalVoltages[branch.anode] ?? 0;
        const cathodeVoltage = result?.terminalVoltages[branch.cathode] ?? 0;
        return cathodeVoltage - anodeVoltage > branch.repetitivePeakReverseVoltage;
      });
      if (reverseBreakdown.length > 0) {
        const branch = reverseBreakdown[0]!;
        diagnostics.push({
          code: 'diode_reverse_breakdown',
          severity: 'error',
          message: `${component.name ?? component.id}: обратное напряжение превысило ${branch.repetitivePeakReverseVoltage.toFixed(0)} В. Диод находится в разрушительном режиме.`,
          componentIds: [component.id],
          suggestedAction: 'Уменьшите обратное напряжение или выберите диод с большим VRRM.',
        });
      }
    }
    const nearLimit = componentBranches.filter((branch) => {
      const current = Math.abs(result?.branchCurrents?.[branch.id] ?? 0);
      return (
        branch.nearLimitWarning &&
        current >= branch.nominalCurrentAmp * LED_WARNING_RATIO &&
        current <= branch.nominalCurrentAmp
      );
    });
    if (nearLimit.length > 0) {
      diagnostics.push({
        code: component.kind === 'diode' ? 'diode_near_limit' : 'led_near_limit',
        severity: 'warning',
        message:
          component.kind === 'diode'
            ? `${component.name ?? component.id}: ток близок к длительному пределу ${nearLimit[0]!.nominalCurrentAmp.toFixed(3)} А.`
            : `${component.name ?? component.id}: ток близок к номинальному пределу в ${nearLimit.map((branch) => branch.id).join(', ')}. Светодиод пока работает, но запас по току мал.`,
        componentIds: [component.id],
        suggestedAction:
          component.kind === 'diode'
            ? 'Уменьшите ток или выберите диод с большим допустимым током.'
            : 'Увеличьте сопротивление, чтобы оставить безопасный запас по току.',
      });
    }
    const overloaded = componentBranches.filter(
      (branch) => Math.abs(result?.branchCurrents?.[branch.id] ?? 0) > branch.nominalCurrentAmp,
    );
    if (overloaded.length > 0) {
      const current = Math.abs(result?.branchCurrents?.[overloaded[0]!.id] ?? 0);
      diagnostics.push({
        code: component.kind === 'diode' ? 'diode_overcurrent' : 'led_overcurrent',
        severity: component.kind === 'diode' ? 'error' : 'warning',
        message:
          component.kind === 'diode'
            ? `${component.name ?? component.id}: ток ${formatReferenceMilliamp(current)} превышает длительный предел ${(overloaded[0]!.nominalCurrentAmp * 1000).toFixed(0)} mA.`
            : component.kind === 'led'
              ? `Сила тока в светодиоде равна ${formatReferenceMilliamp(current)} (максимальное рекомендуемое значение — 20.0 mA). Это может привести к сокращению срока службы светодиода.`
              : `${component.name ?? component.id}: ток выше номинальных ${(overloaded[0]!.nominalCurrentAmp * 1000).toFixed(0)} мА в ${overloaded.map((branch) => branch.id).join(', ')}. Возможна деградация светодиода.`,
        componentIds: [component.id],
        ...(component.kind === 'led'
          ? {}
          : { suggestedAction: 'Увеличьте токоограничивающее сопротивление.' }),
      });
    }
    const burnedOut = componentBranches.filter(
      (branch) => Math.abs(result?.branchCurrents?.[branch.id] ?? 0) > branch.destructiveCurrentAmp,
    );
    if (burnedOut.length > 0 && component.kind !== 'diode') {
      const current = Math.abs(result?.branchCurrents?.[burnedOut[0]!.id] ?? 0);
      diagnostics.push({
        code: 'led_burnout',
        severity: 'error',
        message:
          component.kind === 'led'
            ? `Сила тока в светодиоде равна ${formatReferenceMilliamp(current)} (разрушительный предел — ${(burnedOut[0]!.destructiveCurrentAmp * 1000).toFixed(0)} mA).`
            : `${component.name ?? component.id}: ток превысил разрушительный предел ${(burnedOut[0]!.destructiveCurrentAmp * 1000).toFixed(0)} мА в ${burnedOut.map((branch) => branch.id).join(', ')}. Светодиод перегорел в этой рабочей точке.`,
        componentIds: [component.id],
        ...(component.kind === 'led'
          ? {}
          : {
              suggestedAction:
                'Остановите моделирование, уменьшите напряжение или добавьте сопротивление.',
            }),
      });
    }
  }

  for (const transistor of transistorModels) {
    const result = transistorResultById.get(transistor.component.id);
    if (!result) continue;
    if (Math.abs(result.baseEmitterDrop) > 20) {
      diagnostics.push({
        code: 'transistor_reverse_bias',
        severity: 'error',
        message: `${transistor.component.name ?? transistor.component.id}: напряжение затвор–исток ${result.baseEmitterDrop.toFixed(1)} В превышает пробивное для затвора.`,
        componentIds: [transistor.component.id],
        suggestedAction: 'Проверьте распиновку S, G, D и полярность питания.',
      });
    }
    if (result.collectorCurrent > result.maxCollectorCurrent) {
      diagnostics.push({
        code: 'transistor_overcurrent',
        severity: 'error',
        message: `${transistor.component.name ?? transistor.component.id}: ток стока ${(result.collectorCurrent * 1000).toFixed(1)} мА превышает допустимые ${(result.maxCollectorCurrent * 1000).toFixed(1)} мА.`,
        componentIds: [transistor.component.id],
        suggestedAction: 'Увеличьте сопротивление нагрузки или уменьшите напряжение затвора.',
      });
    }
  }

  const totalSourceCurrent = Math.max(
    0,
    ...sources.map((source) => Math.abs(sourceCurrents.get(source.id) ?? 0)),
    ...arduinoBranches.map((branch) => Math.abs(currentDeliveredByArduinoBranch(branch))),
  );
  const sourcesByIsland = new Map<number, SchematicComponent[]>();
  for (const source of sources) {
    const positiveNode = netlist.nodeOf.get(terminalKey(source.id, logicalTerminal(source, 'a')));
    if (positiveNode === undefined) continue;
    const island = findIsland(positiveNode);
    sourcesByIsland.set(island, [...(sourcesByIsland.get(island) ?? []), source]);
  }
  for (const islandSources of sourcesByIsland.values()) {
    const activeSources = islandSources.filter(
      (source) => Math.abs(sourceCurrents.get(source.id) ?? 0) >= CURRENT_DEADBAND_AMP,
    );
    const absorbingSources = activeSources.filter(
      (source) => (sourceCurrents.get(source.id) ?? 0) < -CURRENT_DEADBAND_AMP,
    );
    const deliveringSources = activeSources.filter(
      (source) => (sourceCurrents.get(source.id) ?? 0) > CURRENT_DEADBAND_AMP,
    );
    if (absorbingSources.length === 0 || deliveringSources.length === 0) continue;
    const affectedSources = [...activeSources].sort((left, right) =>
      left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
    );
    const reverseCurrentMilliamp = Math.max(
      ...absorbingSources.map((source) => Math.abs(sourceCurrents.get(source.id) ?? 0) * 1000),
    );
    const destructive = affectedSources.some((source) => {
      const stress = linearDcObservationById.get(source.id)?.stressState;
      return stress === 'overcurrent' || stress === 'burned';
    });
    diagnostics.push({
      code: 'conflicting_sources',
      severity: destructive ? 'error' : 'warning',
      message: `Источники включены несогласованно: обратный ток ${reverseCurrentMilliamp.toFixed(1)} мА.`,
      componentIds: affectedSources.map((source) => source.id),
      suggestedAction: 'Проверьте напряжения и полярность соединённых источников.',
    });
  }
  for (const source of sources) {
    const deliveredCurrent = Math.abs(sourceCurrents.get(source.id) ?? 0);
    if (directlyShortedSourceIds.has(source.id)) {
      diagnostics.push({
        code: 'short_circuit',
        severity: 'error',
        message: `${source.name ?? source.id}: КЗ, ${formatReferenceMilliamp(deliveredCurrent)}.`,
        componentIds: [source.id],
      });
    }
  }
  const highCurrentSourceIds = sources
    .filter((source) => Math.abs(sourceCurrents.get(source.id) ?? 0) > SHORT_CIRCUIT_CURRENT_A)
    .map((source) => source.id);
  const highCurrentArduinoIds = document.components
    .filter(
      (component) =>
        isArduinoUno(component) &&
        arduinoBranches.some(
          (branch) =>
            branch.component.id === component.id &&
            Math.abs(currentDeliveredByArduinoBranch(branch)) > SHORT_CIRCUIT_CURRENT_A,
        ),
    )
    .map((component) => component.id);
  const highCurrentProviderIds = [...new Set([...highCurrentSourceIds, ...highCurrentArduinoIds])];
  if (highCurrentProviderIds.length > 0) {
    diagnostics.push({
      code: 'short_circuit',
      severity: 'error',
      message: `Ток источника ${totalSourceCurrent.toFixed(2)} А указывает на короткое замыкание.`,
      componentIds: highCurrentProviderIds,
      suggestedAction: 'Остановите моделирование и добавьте сопротивление в путь тока.',
    });
  }

  // Zero current is a legitimate operating point: an open switch or a
  // reverse-biased diode is often exactly what the circuit is meant to do.
  // It therefore falls through to the neutral circuit_ok observation instead
  // of creating a warning or attaching a fault marker to the source.
  if (!diagnostics.some((diagnostic) => diagnostic.severity !== 'info')) {
    diagnostics.push({
      code: 'circuit_ok',
      severity: 'info',
      message: `DC-расчёт завершён. Ток источника ${(totalSourceCurrent * 1000).toFixed(2)} мА.`,
    });
  }

  const nodes: NodeResult[] = Array.from({ length: netlist.nodeCount }, (_, node) => ({
    id: `net-${node}`,
    voltage: round(voltageFrom(solution as number[], node)),
    terminals: netlist.terminalsByNode.get(node) ?? [],
  }));
  return {
    solved: true,
    status: 'solved',
    current: roundCurrent(totalSourceCurrent),
    components,
    nodes,
    diagnostics: diagnostics.map(withDiagnosticAnchors),
    iterations,
    numericalResidual,
    numericalTolerance,
  };
}
