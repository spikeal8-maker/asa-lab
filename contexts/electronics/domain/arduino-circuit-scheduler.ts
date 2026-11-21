import {
  advanceClockedArduinoRuntime,
  analyseArduinoProgramSyntax,
  arduinoRuntimeStateMatchesProgram,
  createOwnedClockedArduinoRuntime,
  type ArduinoRuntimeEvent,
  type ArduinoRuntimeState,
  type ArduinoToneState,
  type ArduinoTerminalVoltages,
  type ArduinoPinMode,
} from './arduino-program-runtime.js';
import { analyseArduinoSourceSupport } from './arduino-capabilities.js';
import { observeArduinoInputs } from './arduino-adc-observation.js';
import {
  ARDUINO_SERIAL_RX_INGRESS_TEXT_LIMIT,
  enqueueArduinoSerialRx,
} from './arduino-serial-runtime.js';
import {
  advanceArduinoServoWaveforms,
  arduinoServoNextDueMicroseconds,
} from './arduino-servo-runtime.js';
import {
  advanceArduinoTimedWaveform,
  arduinoWaveformNextDueMicroseconds,
  isArduinoTimedWaveformState,
} from './arduino-waveform-runtime.js';
import {
  arduinoGroundTerminalsHaveOriginalDefinition,
  arduinoSnapshotFromState,
  arduinoSourceFor,
  isArduinoUno,
} from './arduino-model.js';
import { arduinoNumericTypesHaveOriginalDefinition } from './arduino-values.js';
import { strictElectricalIdentitiesHaveOriginalDefinition } from './model-identity.js';
import { ordinaryLedProfilesHaveOriginalDefinition } from './led-model.js';
import { resistorDeviceModelHasOriginalDefinition } from './models/linear-dc-models.js';
import { NPN_DEVICE_MODEL } from './models/npn-dc-model.js';
import { PNP_DEVICE_MODEL } from './models/pnp-dc-model.js';
import type { ElectronicsDocument, SchematicComponent, Terminal } from './document.js';
import { simulationInputDigest } from './simulation-input-digest.js';
import { l298nControlNetIndices } from './models/l298n-input-network.js';
import { nextL298nPwmEdgeMicroseconds } from './models/l298n-pwm-model.js';
import { REGULATED_POWER_SUPPLY_PROFILE } from './models/regulated-power-supply-model.js';
import {
  SIGNAL_GENERATOR_MAX_AMPLITUDE_VPP,
  SIGNAL_GENERATOR_MAX_FREQUENCY_HZ,
  SIGNAL_GENERATOR_MAX_OFFSET_VOLT,
  SIGNAL_GENERATOR_MIN_FREQUENCY_HZ,
  SIGNAL_GENERATOR_MIN_OFFSET_VOLT,
} from './models/signal-generator-model.js';
import {
  advanceThermalState,
  strictThermalProfilesHaveOriginalDefinition,
  thermalProfileFor,
} from './models/thermal-transient-model.js';
import {
  electricalModelFor,
  strictElectricalTerminalsHaveOriginalDefinition,
} from './model-registry.js';
import {
  createLedTemporalObservation,
  type LedElectricalObserver,
} from './led-temporal-observation.js';
import {
  compileCircuit,
  verifyCircuitQuality,
  createArduinoQualityTraversal,
  type SimulationQuality,
} from './simulation.js';
import {
  prepareCircuitSolve,
  createArduinoOperatingPointReuse,
  createArduinoQualityLayoutOwner,
  clockedRcStateIsCompatible,
  clockedPhysicalStateIsCompatible,
  solveCircuitWithHeldArduino,
  solveRcCircuitWithHeldArduino,
  solveRcCircuitWithHeldArduinoAndExternalShaft,
  TT_NATIVE_DRIVE_MAX_INTERVAL_US,
  type ComponentResult,
  type SolveResult,
  type ArduinoThermalEpoch,
} from './solver.js';
import { resolveBrushedMotorProfileSelection } from './models/brushed-motor-profiles.js';
import {
  createBrushedMotorExternalShaftState,
  type BrushedMotorExternalShaftResult,
  type BrushedMotorExternalShaftState,
} from './models/brushed-motor-transient-model.js';
import {
  isElectrolyticCapacitor,
  type CapacitorTransientState,
} from './models/capacitor-transient-model.js';
import {
  advanceHcSr04Due,
  hcSr04AcceptsTriggerFall,
  hcSr04DistanceMeters,
  hcSr04EchoAvailable,
  hcSr04InputLevels,
  hcSr04NextDueMicroseconds,
  initialHcSr04RuntimeState,
  isHcSr04,
  isHcSr04RuntimeState,
  observeHcSr04Inputs,
  type HcSr04EnvironmentSample,
  type HcSr04RuntimeState,
} from './models/hc-sr04-runtime.js';
import {
  advancePingUltrasonicDue,
  initialPingUltrasonicRuntimeState,
  isPingUltrasonic,
  isPingUltrasonicRuntimeState,
  observePingUltrasonicSignal,
  pingNextDueMicroseconds,
  pingUltrasonicDistanceMeters,
  pingUltrasonicInputLevels,
  type PingUltrasonicRuntimeState,
} from './models/ping-ultrasonic-runtime.js';
import {
  initialServoMotorRuntimeState,
  isServoMotor,
  isServoMotorRuntimeState,
  observeServoMotorInputs,
  servoMotorInputLevels,
  type ServoMotorRuntimeState,
} from './models/servo-runtime.js';

const MAX_TIME_US = 2 ** 50 - 1001;
const MAX_INPUT_EVENTS = 1024;
const MAX_BOARDS = 8;
// Fixed barriers independent of UI refresh times. Adaptive trial steps stay inside each barrier.
const PHYSICS_QUANTUM_US = 1000;
const ELECTROTHERMAL_MODELS = new Set([
  'ordinary-led',
  'rgb-led',
  'seven-segment',
  'diode',
  'npn-transistor',
  'pnp-transistor',
  'n-channel-fet',
  'incandescent-lamp',
  'dc-motor',
  'regulated-dc-supply',
]);

function usesElectrothermalProfile(document: ElectronicsDocument): boolean {
  if (
    document.components.some((component) =>
      ELECTROTHERMAL_MODELS.has(electricalModelFor(component).id),
    )
  )
    return true;
  // A photoresistor without a source still accepts ambient-light inputs.
  // Select a thermal clock only when its circuit can supply electrical power.
  if (
    document.components.some((component) => component.kind === 'photoresistor') &&
    document.components.some(
      (component) =>
        isArduinoUno(component) ||
        electricalModelFor(component).id === 'ideal-dc-source' ||
        electricalModelFor(component).id === 'function-generator',
    )
  )
    return true;
  // Select the physical profile from the fixed circuit, not the live meter mode.
  // A passive no-source circuit must retain the observable algebraic profile;
  // energized circuits keep the fuse history across A/V/R changes.
  if (
    document.components.some(
      (component) => electricalModelFor(component).id === 'digital-multimeter',
    ) &&
    document.components.some(
      (component) =>
        isElectrolyticCapacitor(component) ||
        isArduinoUno(component) ||
        electricalModelFor(component).id === 'ideal-dc-source' ||
        electricalModelFor(component).id === 'function-generator',
    )
  )
    return true;
  if (document.components.some(isElectrolyticCapacitor)) return false;
  return document.components.some(
    (component) => electricalModelFor(component).id === 'ideal-dc-source',
  );
}

// Reuse a zero-duration solve only when every carried physical input is identical.
// Object.is also distinguishes signed zero; no state or frame is retained between advances.
function identicalPhysicalState(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every(
      (key) =>
        Object.hasOwn(right, key) &&
        identicalPhysicalState(
          (left as Record<string, unknown>)[key],
          (right as Record<string, unknown>)[key],
        ),
    )
  );
}

export interface ArduinoCircuitInputEvent {
  readonly atMicroseconds: number;
  readonly componentId: string;
  readonly property:
    | 'state'
    | 'wiperPosition'
    | 'illumination'
    | 'temperatureCelsius'
    | 'moisturePercent'
    | 'motionDetected'
    | 'distanceMeters'
    | 'echoAvailable'
    | 'serialRx'
    | 'voltageSetpointVolt'
    | 'currentLimitAmp'
    | 'outputEnabled'
    | 'waveform'
    | 'frequencyHz'
    | 'amplitudeVpp'
    | 'dcOffsetVolt'
    | 'voltsPerDivision'
    | 'timePerDivisionMs'
    | 'triggerLevelVolt'
    | 'displayEnabled'
    | 'measurementMode';
  readonly value: boolean | number | string;
}

export interface ArduinoCircuitClockState {
  readonly version: 1;
  readonly profile:
    'dc-inputs-v1' | 'rc-inputs-v2' | 'electrothermal-v1' | 'electrothermal-events-v2';
  readonly documentDigest: string;
  readonly reachedMicroseconds: number;
  /** Ordered, append-only history. Array index is the stable event sequence. */
  readonly inputs: readonly ArduinoCircuitInputEvent[];
  readonly nextInputIndex: number;
  /** Committed physics at the last clock barrier, NOT a speculative UI-horizon sample. */
  readonly physicalState?: CapacitorTransientState;
  /** Constant-load thermal origins; observation tails never update these. */
  readonly thermalEpochs?: readonly ArduinoThermalEpoch[];
  readonly hcSr04?: readonly {
    readonly componentId: string;
    readonly runtime: HcSr04RuntimeState;
  }[];
  readonly pingUltrasonic?: readonly {
    readonly componentId: string;
    readonly runtime: PingUltrasonicRuntimeState;
  }[];
  readonly servoMotors?: readonly {
    readonly componentId: string;
    readonly runtime: ServoMotorRuntimeState;
  }[];
  readonly boards: readonly {
    readonly componentId: string;
    readonly loadedSource?: string | null;
    readonly runtime: ArduinoRuntimeState;
  }[];
}

export interface ArduinoCircuitClockDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly componentId?: string;
}

export interface ArduinoCircuitClockAdvance {
  readonly executionStatus: 'ready' | 'yielded' | 'fault';
  /** Null until the entire circuit reaches the requested horizon; also null on any fault. */
  readonly result: (SolveResult & { readonly quality: SimulationQuality }) | null;
  readonly state: ArduinoCircuitClockState | null;
  readonly events: readonly (ArduinoRuntimeEvent & { readonly componentId: string })[];
  readonly diagnostics: readonly ArduinoCircuitClockDiagnostic[];
}

export interface ArduinoCircuitHcSr04Barrier {
  readonly kind: 'query';
  readonly componentId: string;
  readonly atMicroseconds: number;
  readonly triggerHighSinceMicroseconds: number;
  readonly committedHorizonMicroseconds: number;
  readonly phase: 'pre-mcu' | 'post-gpio';
}

type HcSr04ClockSuspension =
  | ArduinoCircuitHcSr04Barrier
  | { readonly kind: 'working'; readonly committedHorizonMicroseconds: number };

export interface ArduinoCircuitShaftSample {
  readonly measuredAtMicroseconds: number;
  readonly angleRadian: number;
  readonly angularVelocityRadPerSecond: number;
}

interface ArduinoCircuitShaftBarrierBase {
  readonly componentId: string;
  readonly port: string;
  readonly axis: 'positive-output-shaft';
  readonly fromMicroseconds: number;
  readonly toMicroseconds: number;
  readonly committedHorizonMicroseconds: number;
}

export type ArduinoCircuitShaftBarrier = ArduinoCircuitShaftBarrierBase &
  (
    | { readonly kind: 'shaft-start' }
    | {
        readonly kind: 'shaft-interval';
        readonly leftShaft: ArduinoCircuitShaftSample;
        readonly winding: BrushedMotorExternalShaftResult;
        readonly windingVoltageVolt: number;
        readonly components: readonly ComponentResult[];
        readonly quality: SimulationQuality;
      }
  );

type ShaftClockCapability = Pick<ArduinoCircuitShaftBarrierBase, 'componentId' | 'port'> & {
  readonly onCheckpoint: (atMicroseconds: number) => void;
};
type ClockSuspension = HcSr04ClockSuspension | ArduinoCircuitShaftBarrier;
type ClockResponse = HcSr04EnvironmentSample | ArduinoCircuitShaftSample | undefined;

function integerTime(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value <= MAX_TIME_US;
}

function clockedComponent(component: SchematicComponent): boolean {
  // A narrow, opt-in electrical profile. Do not silently freeze physical history.
  const model = electricalModelFor(component);
  if (model.id === 'function-generator' || model.id === 'oscilloscope') {
    return (
      model.support !== 'unsupported' &&
      component.pinIds?.includes('signal') === true &&
      component.pinIds?.includes('ground') === true
    );
  }
  return (
    model.support !== 'unsupported' &&
    (ELECTROTHERMAL_MODELS.has(model.id) ||
      [
        'arduino-uno',
        'hc-sr04-distance-sensor',
        'ping-ultrasonic-distance-sensor',
        'servo-motor-signal',
        'resistor',
        'momentary-button',
        'spdt-switch',
        'spst-switch',
        'potentiometer',
        'photoresistor',
        'analog-temperature-sensor',
        'resistive-soil-sensor',
        'pir-motion-sensor',
        'breadboard-connectivity',
        'digital-multimeter',
        'ideal-wire',
        'ideal-dc-source',
        'capacitor',
        'piezo-transducer',
        'l298n-dual-hbridge',
      ].includes(model.id))
  );
}

function validLiveControl(component: SchematicComponent, event: ArduinoCircuitInputEvent): boolean {
  const { property, value } = event;
  if (component.componentTypeId === 'regulated-power-supply') {
    if (property === 'outputEnabled') return typeof value === 'boolean';
    if (typeof value !== 'number' || !Number.isFinite(value)) return false;
    return property === 'voltageSetpointVolt'
      ? value >= REGULATED_POWER_SUPPLY_PROFILE.voltageMinVolt &&
          value <= REGULATED_POWER_SUPPLY_PROFILE.voltageMaxVolt
      : property === 'currentLimitAmp' &&
          value >= REGULATED_POWER_SUPPLY_PROFILE.currentMinAmp &&
          value <= REGULATED_POWER_SUPPLY_PROFILE.currentMaxAmp;
  }
  if (component.componentTypeId === 'signal-generator') {
    if (property === 'outputEnabled') return typeof value === 'boolean';
    if (property === 'waveform')
      return value === 'sine' || value === 'square' || value === 'triangle';
    if (typeof value !== 'number' || !Number.isFinite(value)) return false;
    if (property === 'frequencyHz')
      return (
        value >= SIGNAL_GENERATOR_MIN_FREQUENCY_HZ && value <= SIGNAL_GENERATOR_MAX_FREQUENCY_HZ
      );
    if (property === 'amplitudeVpp')
      return value >= 0 && value <= SIGNAL_GENERATOR_MAX_AMPLITUDE_VPP;
    return (
      property === 'dcOffsetVolt' &&
      value >= SIGNAL_GENERATOR_MIN_OFFSET_VOLT &&
      value <= SIGNAL_GENERATOR_MAX_OFFSET_VOLT
    );
  }
  if (component.componentTypeId === 'oscilloscope') {
    if (property === 'displayEnabled') return typeof value === 'boolean';
    if (typeof value !== 'number' || !Number.isFinite(value)) return false;
    if (property === 'voltsPerDivision') return value > 0 && value <= 100;
    if (property === 'timePerDivisionMs') return value > 0 && value <= 10_000;
    return property === 'triggerLevelVolt' && value >= -100 && value <= 100;
  }
  if (component.componentTypeId === 'multimeter' && property === 'measurementMode') {
    return value === 'dc-voltage' || value === 'dc-current' || value === 'resistance';
  }
  return false;
}

function validInputs(
  document: ElectronicsDocument,
  inputs: readonly ArduinoCircuitInputEvent[],
): boolean {
  return (
    Array.isArray(inputs) &&
    inputs.length <= MAX_INPUT_EVENTS &&
    inputs.every((event, index) => {
      if (
        !event ||
        !integerTime(event.atMicroseconds) ||
        (index > 0 && event.atMicroseconds < inputs[index - 1]!.atMicroseconds)
      )
        return false;
      const component = document.components.find((entry) => entry.id === event.componentId);
      return (
        component !== undefined &&
        ((event.property === 'state' &&
          ['button', 'switch'].includes(component.kind) &&
          typeof event.value === 'boolean') ||
          (event.property === 'wiperPosition' &&
            component.kind === 'potentiometer' &&
            typeof event.value === 'number' &&
            Number.isFinite(event.value) &&
            event.value >= 0 &&
            event.value <= 1) ||
          (event.property === 'illumination' &&
            component.kind === 'photoresistor' &&
            typeof event.value === 'number' &&
            Number.isFinite(event.value) &&
            event.value >= 0 &&
            event.value <= 1) ||
          (event.property === 'moisturePercent' &&
            component.componentTypeId === 'soil-moisture-sensor' &&
            typeof event.value === 'number' &&
            Number.isFinite(event.value) &&
            event.value >= 0 &&
            event.value <= 100) ||
          (event.property === 'temperatureCelsius' &&
            component.componentTypeId === 'temperature-sensor' &&
            typeof event.value === 'number' &&
            Number.isFinite(event.value) &&
            event.value >= -40 &&
            event.value <= 125) ||
          (event.property === 'motionDetected' &&
            component.componentTypeId === 'pir-sensor' &&
            typeof event.value === 'boolean') ||
          (event.property === 'distanceMeters' &&
            (component.componentTypeId === 'ultrasonic-sensor' ||
              component.componentTypeId === 'ultrasonic-hc-sr04') &&
            typeof event.value === 'number' &&
            Number.isFinite(event.value) &&
            event.value >= 0.02 &&
            event.value <= (component.componentTypeId === 'ultrasonic-hc-sr04' ? 4 : 3)) ||
          (event.property === 'echoAvailable' &&
            component.componentTypeId === 'ultrasonic-hc-sr04' &&
            typeof event.value === 'boolean') ||
          (event.property === 'serialRx' &&
            isArduinoUno(component) &&
            typeof event.value === 'string' &&
            event.value.length <= ARDUINO_SERIAL_RX_INGRESS_TEXT_LIMIT) ||
          validLiveControl(component, event))
      );
    })
  );
}

function sameInput(left: ArduinoCircuitInputEvent, right: ArduinoCircuitInputEvent): boolean {
  return (
    left.atMicroseconds === right.atMicroseconds &&
    left.componentId === right.componentId &&
    left.property === right.property &&
    left.value === right.value
  );
}

function applyInput(
  document: ElectronicsDocument,
  event: ArduinoCircuitInputEvent,
): ElectronicsDocument {
  if (event.property === 'serialRx') return document;
  return {
    ...document,
    components: document.components.map((component) =>
      component.id === event.componentId
        ? event.property !== 'state' && event.property !== 'wiperPosition'
          ? {
              ...component,
              stateProperties: { ...component.stateProperties, [event.property]: event.value },
            }
          : ({ ...component, [event.property]: event.value } as SchematicComponent)
        : component,
    ),
  };
}

/**
 * Opt-in DC/RC coupling, not the web/transient solver's default clock.
 * Advance physics with old GPIO/inputs to t; apply inputs, sample, execute due boards together.
 * Simultaneous boards see the same pre-instruction frame, never a peer's future.
 * The caller supplies the full input history (or omits it to keep the old history).
 */
interface ClockPreparation {
  readonly sourceSupport: Map<string, ReturnType<typeof analyseArduinoSourceSupport>>;
  activeDocument?: ElectronicsDocument;
  digest?: string;
  solveDocument?: ElectronicsDocument;
  solve?: ReturnType<typeof prepareCircuitSolve>;
  qualityDocument?: ElectronicsDocument;
  qualityCircuit?: ReturnType<typeof compileCircuit>;
  physicalState?: CapacitorTransientState;
  failureTime?: number;
  readonly operatingPoint: ReturnType<typeof createArduinoOperatingPointReuse>;
  readonly observeLedState?: LedElectricalObserver;
  readonly observeRawDisplayState?: LedElectricalObserver;
  readonly invalidateRawDisplayState?: () => void;
  rawDisplayInitialObserved?: boolean;
}
type OwnedClockRequest = {
  readonly validatedDigest?: string;
  runtime?: ReturnType<typeof createOwnedClockedArduinoRuntime>;
  source?: string;
  continued: boolean;
  quality?: {
    readonly document: ElectronicsDocument;
    readonly circuit: ReturnType<typeof compileCircuit>;
    readonly layout: ReturnType<typeof createArduinoQualityLayoutOwner>;
    readonly traversal: ReturnType<typeof createArduinoQualityTraversal>;
  };
};

function clearOwnedQuality(ownership: OwnedClockRequest): void {
  ownership.quality?.traversal.dispose();
  ownership.quality?.layout.dispose();
  delete ownership.quality;
}
const ownedClockRequests = new WeakMap<ClockPreparation, OwnedClockRequest>();

function ordinaryOwnedGraph(value: unknown, visited = new Set<object>()): boolean {
  if (!value || typeof value !== 'object') return typeof value !== 'function';
  if (visited.has(value)) return true;
  visited.add(value);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== Array.prototype && prototype !== null)
    return false;
  return Reflect.ownKeys(value).every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    return 'value' in descriptor && ordinaryOwnedGraph(descriptor.value, visited);
  });
}

function originalOwnedProducers(): boolean {
  // The two stable module literals must reject strict components before touching
  // their unused methods. Descriptor reads never execute a replacement getter.
  const npn = Object.getOwnPropertyDescriptor(NPN_DEVICE_MODEL, 'id');
  const pnp = Object.getOwnPropertyDescriptor(PNP_DEVICE_MODEL, 'id');
  return (
    npn !== undefined &&
    'value' in npn &&
    npn.value === 'npn-transistor' &&
    pnp !== undefined &&
    'value' in pnp &&
    pnp.value === 'pnp-transistor' &&
    arduinoGroundTerminalsHaveOriginalDefinition() &&
    strictElectricalTerminalsHaveOriginalDefinition() &&
    strictElectricalIdentitiesHaveOriginalDefinition() &&
    strictThermalProfilesHaveOriginalDefinition() &&
    arduinoNumericTypesHaveOriginalDefinition() &&
    resistorDeviceModelHasOriginalDefinition() &&
    ordinaryLedProfilesHaveOriginalDefinition()
  );
}

function ordinaryOwnedSource(source: unknown): boolean {
  // Conservative syntax exclusion, before compilation/support analysis. These
  // routes can consult mutable public support/peripheral tables. The existing
  // prepared AST later proves every executed expression and command separately.
  return typeof source === 'string' && !/#|\b[A-Za-z_]\w*\s*\.|\bServo\b|->/.test(source);
}

function strictOwnedDocument(document: ElectronicsDocument): boolean {
  if (!Array.isArray(document.components)) return false;
  let boards = 0;
  for (const component of document.components) {
    if (!component || typeof component !== 'object') return false;
    const type = component.componentTypeId;
    if (component.variantId !== undefined && component.variantId !== type) return false;
    if (
      Object.values(component.stateProperties ?? {}).some(
        (value) => !['string', 'number', 'boolean'].includes(typeof value),
      )
    )
      return false;
    if (type === 'arduino-uno' && component.kind === 'visual') {
      boards++;
      if (!ordinaryOwnedSource(arduinoSourceFor(component))) return false;
    } else if (type === 'resistor-axial' && component.kind === 'resistor') {
      // Canonical identity validation retains its original position below.
    } else if (type === 'led-5mm' && component.kind === 'led') {
      const colour = component.stateProperties?.['ledColour'];
      if (
        colour !== undefined &&
        !['red', 'orange', 'yellow', 'green', 'blue', 'white'].includes(String(colour))
      )
        return false;
    } else return false;
  }
  return boards === 1;
}

function ordinaryOwnedContinuation(serialized: unknown): boolean {
  if (typeof serialized !== 'string') return false;
  try {
    const previous = JSON.parse(serialized) as ArduinoCircuitClockState;
    return (
      previous !== null &&
      Array.isArray(previous.inputs) &&
      previous.inputs.length === 0 &&
      [previous.hcSr04, previous.pingUltrasonic, previous.servoMotors].every(
        (entries) => entries === undefined || (Array.isArray(entries) && entries.length === 0),
      ) &&
      Array.isArray(previous.boards) &&
      previous.boards.length === 1 &&
      previous.boards.every((board) => {
        const runtime = board?.runtime;
        return (
          runtime &&
          (board.loadedSource === undefined ||
            board.loadedSource === null ||
            ordinaryOwnedSource(board.loadedSource)) &&
          !runtime.serial &&
          !runtime.servo &&
          !runtime.pulseWait &&
          !runtime.ultrasonicAdapter &&
          runtime.tones &&
          Object.keys(runtime.tones).length === 0 &&
          // eventQueue is bounded history of already executed GPIO events, not
          // pending work. The canonical continuation validator checks its full
          // shape and ordering before constructing any owned runtime below.
          Array.isArray(runtime.eventQueue)
        );
      })
    );
  } catch {
    return false;
  }
}

/** Package internal; constructed immediately after the engine's two original clones. */
export function createOwnedArduinoCircuitClockRequest(
  document: ElectronicsDocument,
  request: {
    readonly inputEvents?: readonly unknown[];
    readonly state?: { readonly continuation: { readonly serializedState: string } | null };
  },
) {
  // Nothing can retain the graph before this decision. Once a generic callback
  // could have seen it, restoration of the public producers cannot promote it.
  let admitted = false;
  try {
    admitted =
      ordinaryOwnedGraph([document, request]) &&
      originalOwnedProducers() &&
      strictOwnedDocument(document) &&
      (request.inputEvents === undefined ||
        (Array.isArray(request.inputEvents) && request.inputEvents.length === 0)) &&
      (!request.state?.continuation ||
        ordinaryOwnedContinuation(request.state.continuation.serializedState));
  } catch {
    // Malformed public arguments retain their original validation/exception path.
  }
  let validatedDigest: string | undefined;
  const check = () => {
    admitted = admitted && originalOwnedProducers();
    return admitted;
  };
  return {
    check,
    validateDigest: () => {
      const digest = simulationInputDigest(document, 0);
      validatedDigest = check() ? digest : undefined;
      return digest;
    },
    create: (
      target: number,
      initial: ArduinoCircuitClockState | undefined,
      options: {
        readonly inputs: readonly ArduinoCircuitInputEvent[];
        readonly maxClockEvents?: number;
      },
      observeLedTemporal: boolean,
      observeSevenSegmentTemporal = false,
    ) =>
      createArduinoCircuitClockRequest(
        document,
        target,
        initial,
        options,
        observeLedTemporal,
        check,
        validatedDigest,
        observeSevenSegmentTemporal,
      ),
  };
}

function createArduinoCircuitClockRequest(
  document: ElectronicsDocument,
  target: number,
  initial: ArduinoCircuitClockState | undefined,
  options: {
    readonly inputs: readonly ArduinoCircuitInputEvent[];
    readonly maxClockEvents?: number;
  },
  observeLedTemporal: boolean,
  stillOwned: () => boolean,
  validatedDigest?: string,
  observeSevenSegmentTemporal = false,
) {
  let collector =
    observeLedTemporal || observeSevenSegmentTemporal
      ? createLedTemporalObservation(
          document.components
            .filter((component) => observeLedTemporal && component.kind === 'led')
            .map((component) => component.id),
          initial?.reachedMicroseconds ?? 0,
          document.components
            .filter(
              (component) =>
                observeLedTemporal && isArduinoUno(component) && component.pinIds?.includes('d13'),
            )
            .map((component) => component.id),
          observeSevenSegmentTemporal
            ? document.components
                .filter((component) => component.kind === 'seven-segment')
                .map((component) => component.id)
            : [],
        )
      : null;
  let preparation: ClockPreparation | undefined = {
    sourceSupport: new Map(),
    operatingPoint: createArduinoOperatingPointReuse(),
    ...(collector ? { observeLedState: collector.observe } : {}),
    ...(collector &&
    observeSevenSegmentTemporal &&
    document.components.some((component) => component.kind === 'seven-segment')
      ? {
          observeRawDisplayState: collector.observe,
          invalidateRawDisplayState: collector.invalidate,
        }
      : {}),
  };
  const ownership: OwnedClockRequest = {
    continued: false,
    ...(validatedDigest === undefined ? {} : { validatedDigest }),
  };
  if (stillOwned()) ownedClockRequests.set(preparation, ownership);
  let previous = initial;
  let data: { document: ElectronicsDocument; target: number; options: typeof options } | undefined =
    { document, target, options };
  let disposed = false;
  return {
    step() {
      if (disposed || !data) return undefined;
      if (!stillOwned()) {
        clearOwnedQuality(ownership);
        ownership.runtime?.dispose();
        ownership.runtime = null;
        if (preparation) ownedClockRequests.delete(preparation);
      }
      const advanced = advanceArduinoCircuitClock(
        data.document,
        data.target,
        previous,
        data.options,
        preparation,
      );
      ownership.continued = true;
      previous = advanced.state ?? undefined;
      return {
        advanced,
        ledTemporal:
          advanced.executionStatus === 'ready' && advanced.state
            ? collector?.finish(advanced.state.reachedMicroseconds)
            : null,
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      clearOwnedQuality(ownership);
      ownership.runtime?.dispose();
      ownership.runtime = null;
      if (preparation) ownedClockRequests.delete(preparation);
      previous = undefined;
      preparation = undefined;
      data = undefined;
      collector = null;
    },
  };
}
/** One immutable document and one request; never a shared/persisted state authority. */
export function createArduinoCircuitClockExecutor(
  document: ElectronicsDocument,
  observeLedState?: LedElectricalObserver,
) {
  const preparation: ClockPreparation = {
    sourceSupport: new Map(),
    operatingPoint: createArduinoOperatingPointReuse(),
    ...(observeLedState ? { observeLedState } : {}),
  };
  return (
    horizon: number,
    previous?: ArduinoCircuitClockState,
    options: {
      readonly inputs?: readonly ArduinoCircuitInputEvent[];
      readonly maxClockEvents?: number;
    } = {},
  ) => advanceArduinoCircuitClock(document, horizon, previous, options, preparation);
}

export function advanceArduinoCircuitClock(
  document: ElectronicsDocument,
  targetMicroseconds: number,
  previous?: ArduinoCircuitClockState,
  options: {
    readonly inputs?: readonly ArduinoCircuitInputEvent[];
    readonly maxClockEvents?: number;
  } = {},
  ownedPreparation?: ClockPreparation,
): ArduinoCircuitClockAdvance {
  const clock = iterateArduinoCircuitClock(
    document,
    targetMicroseconds,
    previous,
    options,
    ownedPreparation,
  );
  const final = clock.next();
  if (final.done) return final.value;
  clock.return(undefined as never);
  throw new Error('Synchronous Arduino clock unexpectedly suspended.');
}

/** TEST_ONLY. Owns an uninterrupted fresh clock with one selected HC-SR04. */
export function createArduinoCircuitHcSr04TestClock(
  document: ElectronicsDocument,
  targetMicroseconds: number,
  options: {
    readonly inputs: readonly ArduinoCircuitInputEvent[];
    readonly maxClockEvents?: number;
  },
  queryComponentId: string,
) {
  return iterateArduinoCircuitClock(
    document,
    targetMicroseconds,
    undefined,
    options,
    undefined,
    queryComponentId,
  ) as Generator<
    HcSr04ClockSuspension,
    ArduinoCircuitClockAdvance,
    HcSr04EnvironmentSample | undefined
  >;
}

/** TEST_ONLY. The canonical scheduler owns the entire coupled test clock. */
export function createArduinoCircuitShaftTestClock(
  document: ElectronicsDocument,
  targetMicroseconds: number,
  options: {
    readonly inputs: readonly ArduinoCircuitInputEvent[];
    readonly maxClockEvents?: number;
  },
  shaftPort: ShaftClockCapability,
) {
  return iterateArduinoCircuitClock(
    document,
    targetMicroseconds,
    undefined,
    options,
    undefined,
    undefined,
    shaftPort,
  ) as Generator<
    Exclude<ClockSuspension, ArduinoCircuitHcSr04Barrier>,
    ArduinoCircuitClockAdvance,
    ArduinoCircuitShaftSample | undefined
  >;
}

function* iterateArduinoCircuitClock(
  document: ElectronicsDocument,
  targetMicroseconds: number,
  previous: ArduinoCircuitClockState | undefined,
  options: {
    readonly inputs?: readonly ArduinoCircuitInputEvent[];
    readonly maxClockEvents?: number;
  },
  ownedPreparation: ClockPreparation | undefined,
  queryComponentId?: string,
  shaftPort?: ShaftClockCapability,
): Generator<ClockSuspension, ArduinoCircuitClockAdvance, ClockResponse> {
  const ownership = ownedPreparation ? ownedClockRequests.get(ownedPreparation) : undefined;
  const fault = (code: string, message: string): ArduinoCircuitClockAdvance => ({
    executionStatus: 'fault',
    result: null,
    state: null,
    events: [],
    diagnostics: [{ code, message }],
  });
  if (!integerTime(targetMicroseconds))
    return fault(
      'clock_range_exceeded',
      'Горизонт должен быть целым числом микросекунд в диапазоне 0…2^50−1001.',
    );
  const budget = options.maxClockEvents ?? 256;
  if (!Number.isInteger(budget) || budget < 1 || budget > 1024)
    return fault('invalid_clock_budget', 'Квант общего scheduler: от 1 до 1024 отметок времени.');
  const eventPhysics =
    document.components.filter(isArduinoUno).length === 1 &&
    document.components.every((component) => {
      const model = electricalModelFor(component);
      return (
        model.support === 'supported' &&
        model.version === 1 &&
        model.profileVersion === 1 &&
        ((model.id === 'arduino-uno' &&
          model.profileId === 'arduino-uno-r3' &&
          isArduinoUno(component)) ||
          (model.id === 'resistor' &&
            model.profileId === 'axial-resistor' &&
            component.kind === 'resistor') ||
          (model.id === 'ordinary-led' &&
            model.profileId === 'generic-red-led' &&
            component.kind === 'led'))
      );
    });
  // Keep the legacy 1 ms physical history for an interactive LED circuit. A
  // sleeping MCU does not consume an electrical observation between input edges.
  const sleepingButtonPhysics =
    !eventPhysics &&
    document.components.filter(isArduinoUno).length === 1 &&
    document.components.every((component) => {
      const model = electricalModelFor(component);
      return (
        model.support === 'supported' &&
        model.version === 1 &&
        model.profileVersion === 1 &&
        ((model.id === 'arduino-uno' &&
          model.profileId === 'arduino-uno-r3' &&
          isArduinoUno(component)) ||
          (model.id === 'resistor' &&
            model.profileId === 'axial-resistor' &&
            component.kind === 'resistor') ||
          (model.id === 'ordinary-led' &&
            model.profileId === 'generic-red-led' &&
            component.kind === 'led') ||
          (model.id === 'momentary-button' &&
            model.profileId === 'tactile-button-6mm' &&
            component.kind === 'button'))
      );
    });
  const profile = eventPhysics
    ? 'electrothermal-events-v2'
    : usesElectrothermalProfile(document)
      ? 'electrothermal-v1'
      : document.components.some(isElectrolyticCapacitor)
        ? 'rc-inputs-v2'
        : 'dc-inputs-v1';
  const hasPhysics = profile !== 'dc-inputs-v1';
  const hasL298n = document.components.some(
    (component) => component.componentTypeId === 'l298n-motor-driver',
  );
  const hasTimeDependentObservation = document.components.some(
    (component) =>
      component.componentTypeId === 'signal-generator' ||
      component.componentTypeId === 'l298n-motor-driver' ||
      electricalModelFor(component).id === 'piezo-transducer',
  );
  const unsupported = document.components.find((component) => !clockedComponent(component));
  if (unsupported)
    return fault(
      'clocked_profile_unsupported',
      `${unsupported.id}: общий DC/RC clock ещё не поддерживает временное сопряжение этого компонента.`,
    );
  const boards = document.components
    .filter(isArduinoUno)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  let winding: BrushedMotorExternalShaftState | undefined;
  if (shaftPort) {
    const motors = document.components.filter(
      (component) => electricalModelFor(component).id === 'dc-motor',
    );
    const motor = motors[0];
    const selection = motor && resolveBrushedMotorProfileSelection(motor);
    if (
      boards.length !== 1 ||
      motors.length !== 1 ||
      motor?.id !== shaftPort.componentId ||
      !selection?.ok ||
      selection.profile.profileId !== 'adafruit-3777-tt-48to1' ||
      document.components.some(isElectrolyticCapacitor)
    )
      return fault(
        'invalid_tt_shaft_scope',
        'The selected circuit needs one Uno, one 48:1 TT and no capacitors.',
      );
    winding = createBrushedMotorExternalShaftState(shaftPort.componentId, selection.profile);
  }
  const hcSr04Components = document.components
    .filter(isHcSr04)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (
    queryComponentId !== undefined &&
    (boards.length !== 1 ||
      hcSr04Components.length !== 1 ||
      hcSr04Components[0]?.id !== queryComponentId)
  )
    return fault(
      'invalid_hc_sr04_query_scope',
      'The test requires one Uno and the selected HC-SR04.',
    );
  const pingUltrasonicComponents = document.components
    .filter(isPingUltrasonic)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const servoComponents = document.components
    .filter(isServoMotor)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const invalidHcSr04 = hcSr04Components.find(
    (component) => hcSr04DistanceMeters(component) === null,
  );
  if (invalidHcSr04)
    return fault(
      'invalid_hc_sr04_distance',
      `${invalidHcSr04.id}: distanceMeters должен быть 0.02…4.00 м.`,
    );
  const invalidHcSr04Echo = hcSr04Components.find(
    (component) => hcSr04EchoAvailable(component) === null,
  );
  if (invalidHcSr04Echo)
    return fault(
      'invalid_hc_sr04_echo_available',
      `${invalidHcSr04Echo.id}: echoAvailable должен быть логическим значением.`,
    );
  const invalidPingUltrasonic = pingUltrasonicComponents.find(
    (component) => pingUltrasonicDistanceMeters(component) === null,
  );
  if (invalidPingUltrasonic)
    return fault(
      'invalid_ping_ultrasonic_distance',
      `${invalidPingUltrasonic.id}: distanceMeters должен быть 0.02…3.00 м.`,
    );
  if (boards.length > MAX_BOARDS)
    return fault('invalid_board_count', 'Профиль поддерживает не более 8 плат Arduino.');
  let digest: string;
  try {
    digest =
      ownedPreparation?.digest ?? ownership?.validatedDigest ?? simulationInputDigest(document, 0);
    if (ownedPreparation) ownedPreparation.digest = digest;
  } catch {
    return fault('invalid_document', 'Электрический документ содержит некорректные значения.');
  }
  const inputs = options.inputs ?? previous?.inputs ?? [];
  if (!validInputs(document, inputs))
    return fault(
      'invalid_input_history',
      'История входов должна быть упорядоченной, конечной и содержать не более 1024 событий кнопки/переключателя/потенциометра.',
    );
  const compileDiagnostics = new Map<string, ArduinoCircuitClockDiagnostic>();
  const localUnsupportedCodes = new Set([
    'member-call',
    'unsupported-call',
    'unsupported-syntax',
    'preprocessor',
  ]);
  for (const board of boards) {
    const source = arduinoSourceFor(board);
    let support = ownedPreparation?.sourceSupport.get(source);
    if (!support) {
      support = analyseArduinoSourceSupport(source);
      if (ownedPreparation && ownedPreparation.sourceSupport.size < MAX_BOARDS)
        ownedPreparation.sourceSupport.set(source, support);
    }
    const supportDiagnostics = support.filter((entry) => entry.status === 'unsupported');
    const globalUnsupported = supportDiagnostics.find(
      (entry) => entry.code !== 'syntax-error' && !localUnsupportedCodes.has(entry.code),
    );
    if (globalUnsupported)
      return fault(globalUnsupported.code, `${board.id}: ${globalUnsupported.message}`);

    const localUnsupported = supportDiagnostics.find((entry) =>
      localUnsupportedCodes.has(entry.code),
    );
    if (localUnsupported) {
      compileDiagnostics.set(board.id, {
        code: localUnsupported.code,
        message: `${board.id}: ${localUnsupported.message}`,
        componentId: board.id,
      });
      continue;
    }

    const diagnostic = analyseArduinoProgramSyntax(source)[0];
    if (!diagnostic) continue;
    if (diagnostic.code !== 'compile_error')
      return fault(diagnostic.code, `${board.id}: ${diagnostic.message}`);
    compileDiagnostics.set(board.id, {
      code: diagnostic.code,
      message: `${board.id}: ${diagnostic.message}`,
      componentId: board.id,
    });
  }
  const editorSources = new Map(
    boards.map((board) => [board.id, arduinoSourceFor(board)] as const),
  );
  const previousLoadedSources = new Map<string, string | null>();
  for (const [index, board] of boards.entries()) {
    const entry = previous?.boards[index];
    if (!entry || entry.componentId !== board.id) continue;
    if (typeof entry.loadedSource === 'string') {
      if (arduinoRuntimeStateMatchesProgram(entry.loadedSource, entry.runtime))
        previousLoadedSources.set(board.id, entry.loadedSource);
      continue;
    }
    if (entry.loadedSource === null) {
      if (arduinoRuntimeStateMatchesProgram('', entry.runtime))
        previousLoadedSources.set(board.id, null);
      continue;
    }
    const editorSource = editorSources.get(board.id)!;
    if (
      !compileDiagnostics.has(board.id) &&
      arduinoRuntimeStateMatchesProgram(editorSource, entry.runtime)
    ) {
      previousLoadedSources.set(board.id, editorSource);
      continue;
    }
    if (arduinoRuntimeStateMatchesProgram('', entry.runtime))
      previousLoadedSources.set(board.id, null);
  }
  const executionSources = new Map<string, string>();
  for (const board of boards) {
    const editorSource = editorSources.get(board.id)!;
    if (!compileDiagnostics.has(board.id)) {
      executionSources.set(board.id, editorSource);
      continue;
    }
    const lastGood = previousLoadedSources.get(board.id);
    if (typeof lastGood === 'string') executionSources.set(board.id, lastGood);
  }
  const runnableBoards = boards.filter((board) => executionSources.has(board.id));
  if (shaftPort && runnableBoards.length !== 1)
    return fault('invalid_tt_shaft_scope', 'The native TT test requires one runnable Uno program.');
  const pendingProgramLoads = new Set(
    previous
      ? runnableBoards
          .filter(
            (board) =>
              !compileDiagnostics.has(board.id) &&
              previousLoadedSources.get(board.id) !== executionSources.get(board.id),
          )
          .map((board) => board.id)
      : [],
  );
  const emptyRuntime = advanceClockedArduinoRuntime('', {}, 0, undefined, undefined, {
    instructionBudget: 1,
  }).state;
  const resetRuntimeAt = (timeMicroseconds: number): ArduinoRuntimeState => ({
    ...emptyRuntime,
    virtualTimeMs: timeMicroseconds / 1000,
    resumeAtMs: (timeMicroseconds + 1) / 1000,
    loopStartedAtMs: timeMicroseconds / 1000,
  });
  const coldState = resetRuntimeAt(0);
  const previousHcSr04 = previous?.hcSr04 ?? [];
  const previousPingUltrasonic = previous?.pingUltrasonic ?? [];
  const previousServoMotors = previous?.servoMotors ?? [];
  if (previous) {
    if (
      previous.version !== 1 ||
      previous.profile !== profile ||
      previous.documentDigest !== digest ||
      (eventPhysics
        ? !Array.isArray(previous.thermalEpochs) ||
          previous.thermalEpochs.length !== (previous.physicalState?.thermal.length ?? 0) ||
          previous.thermalEpochs.some(
            (epoch, index) =>
              epoch.componentId !== previous.physicalState?.thermal[index]?.componentId ||
              !integerTime(epoch.atMicroseconds) ||
              epoch.atMicroseconds > previous.reachedMicroseconds ||
              !Number.isFinite(epoch.temperatureCelsius) ||
              !Number.isFinite(epoch.accumulatedDamage) ||
              epoch.accumulatedDamage < 0 ||
              !Number.isFinite(epoch.loadRatio) ||
              epoch.loadRatio < 0 ||
              epoch.loadRatio > 20,
          )
        : previous.thermalEpochs !== undefined) ||
      !integerTime(previous.reachedMicroseconds) ||
      previous.reachedMicroseconds > targetMicroseconds ||
      (hasPhysics
        ? previous.physicalState
          ? !(
              profile === 'electrothermal-v1' || profile === 'electrothermal-events-v2'
                ? clockedPhysicalStateIsCompatible
                : clockedRcStateIsCompatible
            )(document, previous.physicalState, previous.reachedMicroseconds / 1000) ||
            !integerTime(Math.round(previous.physicalState.simulationTimeMs * 1000)) ||
            Math.round(previous.physicalState.simulationTimeMs * 1000) / 1000 !==
              previous.physicalState.simulationTimeMs ||
            previous.reachedMicroseconds -
              Math.round(previous.physicalState.simulationTimeMs * 1000) >=
              PHYSICS_QUANTUM_US
          : previous.reachedMicroseconds >= PHYSICS_QUANTUM_US
        : previous.physicalState !== undefined) ||
      !validInputs(document, previous.inputs) ||
      !Number.isInteger(previous.nextInputIndex) ||
      previous.nextInputIndex < 0 ||
      previous.nextInputIndex > previous.inputs.length ||
      previous.inputs.some(
        (event, index) =>
          index < previous.nextInputIndex !== event.atMicroseconds <= previous.reachedMicroseconds,
      ) ||
      !Array.isArray(previous.boards) ||
      previous.boards.length !== boards.length ||
      previousHcSr04.length !== hcSr04Components.length ||
      previousHcSr04.some(
        (entry, index) =>
          entry.componentId !== hcSr04Components[index]?.id || !isHcSr04RuntimeState(entry.runtime),
      ) ||
      previousPingUltrasonic.length !== pingUltrasonicComponents.length ||
      previousPingUltrasonic.some(
        (entry, index) =>
          entry.componentId !== pingUltrasonicComponents[index]?.id ||
          !isPingUltrasonicRuntimeState(entry.runtime),
      ) ||
      previousServoMotors.length !== servoComponents.length ||
      previousServoMotors.some(
        (entry, index) =>
          entry.componentId !== servoComponents[index]?.id ||
          !isServoMotorRuntimeState(entry.runtime),
      ) ||
      previous.boards.some((entry, index) => {
        const board = boards[index]!;
        const loadedSource = previousLoadedSources.get(board.id);
        return (
          !entry ||
          entry.componentId !== board.id ||
          loadedSource === undefined ||
          (!(ownership?.continued && ownership.runtime && ownership.source === loadedSource) &&
            !arduinoRuntimeStateMatchesProgram(loadedSource ?? '', entry.runtime)) ||
          entry.runtime.clockProfile !== 'instruction-us-v1' ||
          entry.runtime.faults.length > 0 ||
          (loadedSource === null &&
            (Object.keys(entry.runtime.pinModes).length > 0 ||
              Object.keys(entry.runtime.outputVoltages).length > 0 ||
              entry.runtime.eventQueue.length > 0)) ||
          entry.runtime.virtualTimeMs > previous.reachedMicroseconds / 1000 ||
          entry.runtime.resumeAtMs <= previous.reachedMicroseconds / 1000
        );
      })
    ) {
      return fault(
        'invalid_clock_continuation',
        'Продолжение не соответствует схеме, программе или достигнутому времени. Нужен Reset.',
      );
    }
    if (
      inputs.length < previous.inputs.length ||
      previous.inputs.some((event, index) => !sameInput(event, inputs[index]!)) ||
      inputs
        .slice(previous.inputs.length)
        .some((event) => event.atMicroseconds <= previous.reachedMicroseconds)
    ) {
      return fault(
        'retroactive_input',
        'Нельзя менять прошлое входов. Добавьте событие после достигнутого времени или выполните Reset.',
      );
    }
  }
  let activeDocument: ElectronicsDocument = {
    ...document,
    components: document.components
      .map((component) => {
        if (!compileDiagnostics.has(component.id)) return component;
        return {
          ...component,
          stateProperties: {
            ...component.stateProperties,
            arduinoSource: executionSources.get(component.id) ?? '',
          },
        };
      })
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    connections: [...document.connections].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
  };
  if (ownedPreparation && compileDiagnostics.size === 0 && inputs.length === 0) {
    activeDocument = ownedPreparation.activeDocument ?? activeDocument;
    ownedPreparation.activeDocument = activeDocument;
  }
  let nextInputIndex = previous?.nextInputIndex ?? 0;
  for (const event of inputs.slice(0, nextInputIndex))
    activeDocument = applyInput(activeDocument, event);
  const states = new Map(
    previous?.boards.map((entry) => [entry.componentId, entry.runtime] as const),
  );
  const loadedSources = new Map(previousLoadedSources);
  const hcSr04States = new Map(
    hcSr04Components.map(
      (component, index) =>
        [component.id, previousHcSr04[index]?.runtime ?? initialHcSr04RuntimeState()] as const,
    ),
  );
  const pingUltrasonicStates = new Map(
    pingUltrasonicComponents.map(
      (component, index) =>
        [
          component.id,
          previousPingUltrasonic[index]?.runtime ?? initialPingUltrasonicRuntimeState(),
        ] as const,
    ),
  );
  const servoStates = new Map(
    servoComponents.map(
      (component, index) =>
        [
          component.id,
          previousServoMotors[index]?.runtime ?? initialServoMotorRuntimeState(),
        ] as const,
    ),
  );
  for (const board of boards) {
    if (!executionSources.has(board.id) && !states.has(board.id)) {
      states.set(board.id, coldState);
      loadedSources.set(board.id, null);
    }
  }
  let reachedMicroseconds = previous?.reachedMicroseconds ?? -1;
  let closedHorizonMicroseconds = 0;
  let physicalState = previous?.physicalState;
  const thermalEpochs = new Map(
    (previous?.thermalEpochs ?? []).map((epoch) => [epoch.componentId, epoch]),
  );
  const events: (ArduinoRuntimeEvent & { readonly componentId: string })[] = [];
  let cachedFrame: NonNullable<ArduinoCircuitClockAdvance['result']> | undefined;
  let cachedFrameTime = -1;
  const snapshots = () =>
    new Map(
      boards.map((board) => {
        const state = states.get(board.id) ?? coldState;
        // Physical/quality consumers always receive the detached held view.
        if (
          ownership?.runtime &&
          !arduinoRuntimeStateMatchesProgram(loadedSources.get(board.id) ?? '', state)
        )
          throw new Error('Invalid private Arduino state at electrical boundary.');
        return [board.id, arduinoSnapshotFromState(state)] as const;
      }),
    );
  let qualityDocument = ownedPreparation?.qualityDocument;
  let qualityCircuit = ownedPreparation?.qualityCircuit;
  const withQuality = (
    frame: SolveResult,
    time: number,
    l298nPwmSampleTimeMs?: number,
  ): NonNullable<ArduinoCircuitClockAdvance['result']> => {
    // Compilation depends only on the immutable active document, never on a frame.
    // Each applied input replaces that document; every frame is still independently verified.
    if (qualityDocument !== activeDocument || !qualityCircuit) {
      if (ownership) clearOwnedQuality(ownership);
      qualityCircuit = compileCircuit(activeDocument);
      qualityDocument = activeDocument;
      if (ownedPreparation) {
        ownedPreparation.qualityDocument = activeDocument;
        ownedPreparation.qualityCircuit = qualityCircuit;
      }
    }
    if (
      ownership?.runtime &&
      ownership.source === executionSources.get(boards[0]!.id) &&
      (!ownership.quality ||
        ownership.quality.document !== activeDocument ||
        ownership.quality.circuit !== qualityCircuit)
    ) {
      clearOwnedQuality(ownership);
      const layout = createArduinoQualityLayoutOwner(operatingPointReuse);
      ownership.quality = {
        document: activeDocument,
        circuit: qualityCircuit,
        layout,
        traversal: createArduinoQualityTraversal(activeDocument, qualityCircuit, layout.owner),
      };
    }
    const qualityOptions = { simulationTimeMs: time / 1000, l298nPwmSampleTimeMs };
    return {
      ...frame,
      quality: ownership?.quality
        ? ownership.quality.traversal.verify(frame, qualityOptions)
        : verifyCircuitQuality(activeDocument, qualityCircuit, frame, qualityOptions),
    };
  };
  let solveDocument = ownedPreparation?.solveDocument;
  let solvePreparation = ownedPreparation?.solve;
  const preparation = () => {
    if (solveDocument !== activeDocument || !solvePreparation) {
      solvePreparation = prepareCircuitSolve(activeDocument);
      solveDocument = activeDocument;
      if (ownedPreparation) {
        ownedPreparation.solveDocument = activeDocument;
        ownedPreparation.solve = solvePreparation;
      }
    }
    return solvePreparation;
  };
  const operatingPointReuse =
    ownedPreparation?.operatingPoint ?? createArduinoOperatingPointReuse();
  const adcInputs = (
    boardId: string,
    time: number,
    voltages: ArduinoTerminalVoltages,
    ownModes?: ReadonlyMap<string, ArduinoPinMode>,
  ) =>
    observeArduinoInputs(
      voltages,
      activeDocument,
      preparation()(activeDocument)!.terminalNodes,
      boardId,
      time,
      (id, pin) => (id === boardId && ownModes ? ownModes.get(pin) : states.get(id)?.pinModes[pin]),
    );
  const advancePhysics = (time: number) => {
    // Previous GPIO/PWM is held over this interval. The subsequent zero-time
    // sample observes the new timer level at the same causal boundary.
    const heldPwmTime = hasL298n ? (physicalState?.simulationTimeMs ?? 0) : undefined;
    return withQuality(
      solveRcCircuitWithHeldArduino(
        activeDocument,
        time / 1000,
        snapshots(),
        physicalState,
        hcSr04States,
        pingUltrasonicStates,
        servoStates,
        preparation(),
        operatingPointReuse,
        eventPhysics ? thermalEpochs : undefined,
        undefined,
        heldPwmTime,
      ),
      time,
      heldPwmTime,
    );
  };
  let shaft: ArduinoCircuitShaftSample | undefined;
  const solveShaftFrame = (time: number) => {
    if (!winding || !shaft || shaft.measuredAtMicroseconds !== winding.atMicroseconds)
      throw new Error('TT shaft and electrical state are not at the same time.');
    const heldPwmTime =
      hasL298n && time > winding.atMicroseconds ? winding.atMicroseconds / 1000 : undefined;
    const solved = solveRcCircuitWithHeldArduinoAndExternalShaft(
      {
        winding,
        toMicroseconds: time,
        angularVelocityRadPerSecond: shaft.angularVelocityRadPerSecond,
      },
      activeDocument,
      snapshots(),
      physicalState,
      hcSr04States,
      pingUltrasonicStates,
      servoStates,
      preparation(),
      heldPwmTime,
    );
    return { frame: withQuality(solved.frame, time, heldPwmTime), accepted: solved.accepted };
  };
  const sample = (time: number): NonNullable<ArduinoCircuitClockAdvance['result']> => {
    // Generator output and passive piezo edge-age recognition depend on the
    // observation horizon even when no runtime output or physical state changes.
    if (
      cachedFrame &&
      (cachedFrameTime === time || (profile === 'dc-inputs-v1' && !hasTimeDependentObservation))
    )
      return cachedFrame;
    if (winding) {
      if (time !== winding.atMicroseconds)
        throw new Error('Cannot observe an unconfirmed TT interval.');
      const { frame } = solveShaftFrame(time);
      if (frame.solved && frame.quality.passed) physicalState = frame.transientState;
      cachedFrame = frame;
    } else if (hasPhysics) {
      // A horizon between canonical events may be observed but never committed:
      // otherwise UI frame rate would change adaptive integration and later ADC reads.
      const advanced = advancePhysics(time);
      if (!advanced.solved || !advanced.quality.passed) return advanced;
      // The follow-up still runs whenever integration or a zero-duration settle changed
      // any physical input. Otherwise it would repeat exactly the solve just verified.
      cachedFrame = withQuality(
        physicalState?.simulationTimeMs === time / 1000 &&
          identicalPhysicalState(physicalState, advanced.transientState)
          ? advanced
          : solveRcCircuitWithHeldArduino(
              activeDocument,
              time / 1000,
              snapshots(),
              advanced.transientState,
              hcSr04States,
              pingUltrasonicStates,
              servoStates,
              preparation(),
              operatingPointReuse,
              eventPhysics ? thermalEpochs : undefined,
            ),
        time,
      );
    } else {
      cachedFrame = withQuality(
        solveCircuitWithHeldArduino(
          activeDocument,
          time / 1000,
          snapshots(),
          hcSr04States,
          pingUltrasonicStates,
          servoStates,
          preparation(),
          operatingPointReuse,
        ),
        time,
      );
    }
    cachedFrameTime = time;
    return cachedFrame;
  };
  const observeSensors = (
    frame: NonNullable<ArduinoCircuitClockAdvance['result']>,
    time: number,
    environment?: HcSr04EnvironmentSample,
  ): boolean => {
    let echoChanged = false;
    for (const component of hcSr04Components) {
      const terminalVoltages =
        frame.components.find((entry) => entry.componentId === component.id)?.terminalVoltages ??
        {};
      const levels = hcSr04InputLevels(terminalVoltages);
      const activeComponent =
        activeDocument.components.find((entry) => entry.id === component.id) ?? component;
      const step = observeHcSr04Inputs(
        hcSr04States.get(component.id)!,
        time,
        levels.powered,
        levels.triggerHigh,
        environment?.kind === 'echo'
          ? environment.distanceMeters
          : hcSr04DistanceMeters(activeComponent)!,
        environment ? environment.kind === 'echo' : hcSr04EchoAvailable(activeComponent)!,
      );
      hcSr04States.set(component.id, step.state);
      echoChanged ||= step.echoChanged;
    }
    for (const component of pingUltrasonicComponents) {
      const terminalVoltages =
        frame.components.find((entry) => entry.componentId === component.id)?.terminalVoltages ??
        {};
      const levels = pingUltrasonicInputLevels(terminalVoltages);
      const activeComponent =
        activeDocument.components.find((entry) => entry.id === component.id) ?? component;
      const step = observePingUltrasonicSignal(
        pingUltrasonicStates.get(component.id)!,
        time,
        levels.powered,
        levels.signalHigh,
        pingUltrasonicDistanceMeters(activeComponent)!,
      );
      pingUltrasonicStates.set(component.id, step.state);
      echoChanged ||= step.echoChanged;
    }
    for (const component of servoComponents) {
      const terminalVoltages =
        frame.components.find((entry) => entry.componentId === component.id)?.terminalVoltages ??
        {};
      const levels = servoMotorInputLevels(terminalVoltages);
      const previousServo = servoStates.get(component.id)!;
      const nextServo = observeServoMotorInputs(
        previousServo,
        time,
        levels.powered,
        levels.signalHigh,
      );
      servoStates.set(component.id, nextServo);
      echoChanged ||= nextServo !== previousServo;
    }
    return echoChanged;
  };
  const selectedTriggerFall = (
    frame: NonNullable<ArduinoCircuitClockAdvance['result']>,
    time: number,
  ): number | undefined => {
    const selected =
      queryComponentId === undefined ? undefined : hcSr04States.get(queryComponentId);
    if (!selected) return undefined;
    const voltages =
      frame.components.find((entry) => entry.componentId === queryComponentId)?.terminalVoltages ??
      {};
    const { powered, triggerHigh } = hcSr04InputLevels(voltages);
    return hcSr04AcceptsTriggerFall(selected, time, powered, triggerHigh)
      ? selected.triggerHighSinceMicroseconds
      : undefined;
  };
  function* observeSensorsWithQuery(
    frame: NonNullable<ArduinoCircuitClockAdvance['result']>,
    time: number,
    phase: ArduinoCircuitHcSr04Barrier['phase'],
  ): Generator<ArduinoCircuitHcSr04Barrier, boolean, ClockResponse> {
    const highSince = selectedTriggerFall(frame, time);
    if (highSince === undefined) return observeSensors(frame, time);
    const environment = yield {
      kind: 'query',
      componentId: queryComponentId!,
      atMicroseconds: time,
      triggerHighSinceMicroseconds: highSince,
      committedHorizonMicroseconds: closedHorizonMicroseconds,
      phase,
    };
    if (!environment || !('kind' in environment))
      throw new Error('The HC-SR04 clock resumed without its query response.');
    return observeSensors(frame, time, environment);
  }
  const isNonFatalPassiveNoSource = (frame: SolveResult): boolean =>
    boards.length === 0 &&
    !hasPhysics &&
    frame.status === 'invalid' &&
    frame.diagnostics.some((entry) => entry.code === 'no_source') &&
    !frame.diagnostics.some((entry) => entry.severity === 'error' && entry.code !== 'no_source');
  const nextSensorTime = (): number =>
    Math.min(
      ...hcSr04Components.map((component) =>
        hcSr04NextDueMicroseconds(hcSr04States.get(component.id)!),
      ),
      ...pingUltrasonicComponents.map((component) =>
        pingNextDueMicroseconds(pingUltrasonicStates.get(component.id)!),
      ),
      Number.POSITIVE_INFINITY,
    );
  const nextToneTime = (): number =>
    Math.min(
      ...runnableBoards.flatMap((board) => [
        arduinoServoNextDueMicroseconds(states.get(board.id)?.servo),
        ...Object.values(states.get(board.id)?.tones ?? {}).flatMap((tone) =>
          tone && isArduinoTimedWaveformState(tone)
            ? [arduinoWaveformNextDueMicroseconds(tone)]
            : [],
        ),
      ]),
      Number.POSITIVE_INFINITY,
    );
  let pwmDocument: ElectronicsDocument | undefined;
  let pwmNodes: ReadonlyMap<string, number> = new Map();
  let pwmControlNodes: ReadonlySet<number> = new Set();
  const nextPwmTime = (): number => {
    if (!hasL298n) return Number.POSITIVE_INFINITY;
    if (pwmDocument !== activeDocument) {
      pwmDocument = activeDocument;
      pwmNodes = compileCircuit(activeDocument).netlist.nodeOf;
      pwmControlNodes = l298nControlNetIndices(activeDocument, pwmNodes);
    }
    return nextL298nPwmEdgeMicroseconds(
      activeDocument,
      pwmNodes,
      pwmControlNodes,
      states,
      Math.max(0, reachedMicroseconds),
    );
  };
  const nextPhysicsTime = (): number =>
    hasPhysics
      ? (Math.floor(
          Math.round((physicalState?.simulationTimeMs ?? 0) * 1000) / PHYSICS_QUANTUM_US,
        ) +
          1) *
        PHYSICS_QUANTUM_US
      : Number.POSITIVE_INFINITY;
  const nextShaftTime = (): number => {
    if (!winding) return Number.POSITIVE_INFINITY;
    if (reachedMicroseconds < 0) return 0;
    if (winding.atMicroseconds >= targetMicroseconds) return Number.POSITIVE_INFINITY;
    return Math.min(winding.atMicroseconds + TT_NATIVE_DRIVE_MAX_INTERVAL_US, targetMicroseconds);
  };
  const nextTime = (): number =>
    Math.min(
      ...runnableBoards.map((board) => {
        if (pendingProgramLoads.has(board.id)) return previous?.reachedMicroseconds ?? 0;
        const state = states.get(board.id);
        return state ? Math.round(state.resumeAtMs * 1000) : 0;
      }),
      inputs[nextInputIndex]?.atMicroseconds ?? Number.POSITIVE_INFINITY,
      nextSensorTime(),
      nextToneTime(),
      nextPwmTime(),
      nextPhysicsTime(),
      nextShaftTime(),
      eventPhysics ? failureTime : Number.POSITIVE_INFINITY,
    );
  // Locate the first failed integer timestamp with the same thermal equation.
  // Monotone constant-load temperature/damage permits binary search with verified neighbours.
  let failureTime = Number.POSITIVE_INFINITY;
  const locateFailure = (frame: SolveResult): void => {
    failureTime = Number.POSITIVE_INFINITY;
    if (!eventPhysics || !physicalState) return;
    const from = Math.round(physicalState.simulationTimeMs * 1000);
    const until = nextPhysicsTime();
    for (const thermal of physicalState.thermal) {
      if (thermal.failureMode === 'open') continue;
      const component = activeDocument.components.find((c) => c.id === thermal.componentId)!;
      const profile = thermalProfileFor(component);
      const result = frame.components.find((c) => c.componentId === thermal.componentId);
      if (!profile || !result) continue;
      const epoch = thermalEpochs.get(thermal.componentId);
      const failed = (at: number) =>
        advanceThermalState(
          profile,
          result,
          epoch?.temperatureCelsius ?? thermal.temperatureCelsius,
          epoch?.accumulatedDamage ?? thermal.accumulatedDamage,
          (at - (epoch?.atMicroseconds ?? from)) / 1_000_000,
        ).failed;
      if (!failed(until)) continue;
      let low = from,
        high = until;
      while (high - low > 1) {
        const middle = Math.floor((low + high) / 2);
        if (failed(middle)) high = middle;
        else low = middle;
      }
      failureTime = Math.min(failureTime, high);
    }
  };
  const commitPhysics = (time: number): boolean => {
    const advanced = advancePhysics(time);
    if (!advanced.solved || !advanced.quality.passed || !advanced.transientState) return false;
    ownedPreparation?.observeLedState?.(time, advanced.components);
    physicalState = advanced.transientState;
    cachedFrame = undefined;
    for (const thermal of physicalState.thermal) {
      const component = activeDocument.components.find((c) => c.id === thermal.componentId)!;
      const profile = thermalProfileFor(component);
      const result = advanced.components.find((c) => c.componentId === thermal.componentId);
      if (!profile || !result) continue;
      const load = advanceThermalState(
        profile,
        result,
        thermal.temperatureCelsius,
        thermal.accumulatedDamage,
        0,
      ).loadRatio;
      const epoch = thermalEpochs.get(thermal.componentId);
      if (!epoch || epoch.loadRatio !== load || thermal.failureMode === 'open')
        thermalEpochs.set(thermal.componentId, {
          componentId: thermal.componentId,
          atMicroseconds: time,
          temperatureCelsius: thermal.temperatureCelsius,
          accumulatedDamage: thermal.accumulatedDamage,
          loadRatio: load,
        });
    }
    locateFailure(advanced);
    return true;
  };
  if (eventPhysics) {
    if (!physicalState && !commitPhysics(0))
      return fault('physical_advance_failed', 'Initial physical frame failed.');
    if (ownedPreparation && ownedPreparation.physicalState === physicalState)
      failureTime = ownedPreparation.failureTime ?? Number.POSITIVE_INFINITY;
    else {
      const checkpointTime = Math.round(physicalState!.simulationTimeMs * 1000);
      const frame = sample(checkpointTime);
      locateFailure(frame);
      if (frame.solved && frame.quality.passed)
        ownedPreparation?.observeLedState?.(checkpointTime, frame.components);
    }
  }
  if (
    !eventPhysics &&
    ownedPreparation?.observeRawDisplayState &&
    !ownedPreparation.rawDisplayInitialObserved
  ) {
    const from = previous?.reachedMicroseconds ?? 0;
    const frame = sample(from);
    if (frame.solved && frame.quality.passed)
      ownedPreparation.observeRawDisplayState(from, frame.components);
    else ownedPreparation.invalidateRawDisplayState?.();
    ownedPreparation.rawDisplayInitialObserved = true;
  }
  function* requestShaftSample(
    interval:
      | {
          readonly measured: ArduinoCircuitShaftSample;
          readonly accepted: NonNullable<ReturnType<typeof solveShaftFrame>['accepted']>;
          readonly frame: ReturnType<typeof solveShaftFrame>['frame'];
        }
      | undefined,
    toMicroseconds: number,
  ): Generator<ArduinoCircuitShaftBarrier, ArduinoCircuitShaftSample, ClockResponse> {
    const base = {
      componentId: shaftPort!.componentId,
      port: shaftPort!.port,
      axis: 'positive-output-shaft' as const,
      fromMicroseconds: interval?.measured.measuredAtMicroseconds ?? 0,
      toMicroseconds,
      committedHorizonMicroseconds: closedHorizonMicroseconds,
    };
    const reply = yield interval
      ? {
          ...base,
          kind: 'shaft-interval',
          leftShaft: interval.measured,
          winding: interval.accepted.transition,
          windingVoltageVolt: interval.accepted.voltageVolt,
          components: interval.frame.components,
          quality: interval.frame.quality,
        }
      : { ...base, kind: 'shaft-start' };
    if (
      !reply ||
      !('measuredAtMicroseconds' in reply) ||
      reply.measuredAtMicroseconds !== toMicroseconds
    )
      throw new Error('The TT clock resumed without its native shaft sample.');
    return reply;
  }
  if (shaftPort) shaft = yield* requestShaftSample(undefined, 0);
  // A returned frame is never a speculative MCU state. Failure discards this whole batch.
  const suspendedClock = queryComponentId !== undefined || shaftPort !== undefined;
  let clockEvents = 0;
  while (nextTime() <= targetMicroseconds && (suspendedClock || clockEvents < budget)) {
    const time = nextTime();
    const pwmDue = hasL298n && nextPwmTime() === time;
    if (pwmDue) cachedFrame = undefined;
    if (suspendedClock) {
      // A due operation may leave other work scheduled at the very same timestamp.
      // Only a timestamp strictly behind the next operation is externally committed.
      if (reachedMicroseconds >= 0 && reachedMicroseconds < time) {
        closedHorizonMicroseconds = Math.max(closedHorizonMicroseconds, reachedMicroseconds);
        shaftPort?.onCheckpoint(closedHorizonMicroseconds);
      }
      if (clockEvents >= budget) {
        yield { kind: 'working', committedHorizonMicroseconds: closedHorizonMicroseconds };
        clockEvents = 0;
      }
    }
    if (winding && shaft && winding.atMicroseconds < time) {
      const { frame, accepted } = solveShaftFrame(time);
      if (
        !frame.solved ||
        !frame.quality.passed ||
        !frame.transientState ||
        !accepted ||
        accepted.transition.state.failureMode !== 'none'
      )
        return fault(
          'tt_shaft_electrical_advance_failed',
          frame.diagnostics.map((entry) => entry.message).join(' ') ||
            'The TT electrical interval failed acceptance.',
        );
      shaft = yield* requestShaftSample({ measured: shaft, accepted, frame }, time);
      // The electrical interval and its same-time physical response become private
      // state together. Arduino and peripherals still have their original order at t.
      winding = accepted.transition.state;
      physicalState = frame.transientState;
      cachedFrame = undefined;
    }
    const onlyBoard = runnableBoards[0];
    const currentRuntime = onlyBoard ? states.get(onlyBoard.id) : undefined;
    const electricalBarrier = Math.min(
      nextPhysicsTime(),
      failureTime,
      inputs[nextInputIndex]?.atMicroseconds ?? Number.POSITIVE_INFINITY,
    );
    if (
      eventPhysics &&
      onlyBoard &&
      nextToneTime() === Number.POSITIVE_INFINITY &&
      !currentRuntime?.pulseWait &&
      !currentRuntime?.ultrasonicAdapter &&
      !currentRuntime?.servo &&
      time < electricalBarrier
    ) {
      const source = executionSources.get(onlyBoard.id)!;
      if (ownership && ownership.runtime === undefined) {
        ownership.runtime = createOwnedClockedArduinoRuntime(source, currentRuntime, {
          accountForStableLoops: true,
        });
        ownership.source = source;
      }
      let readFailed = false;
      const advanced = ownership?.runtime
        ? ownership.runtime.advance(
            Math.min(targetMicroseconds, electricalBarrier - 1) / 1000,
            budget - clockEvents,
            true,
          )
        : advanceClockedArduinoRuntime(
            source,
            {},
            Math.min(targetMicroseconds, electricalBarrier - 1) / 1000,
            currentRuntime,
            ({ simulationTimeMs, pinModes }) => {
              const at = Math.round(simulationTimeMs * 1000);
              if (!commitPhysics(at)) readFailed = true;
              return adcInputs(
                onlyBoard.id,
                at,
                sample(at).components.find((c) => c.componentId === onlyBoard.id)
                  ?.terminalVoltages ?? {},
                pinModes,
              );
            },
            { instructionBudget: budget - clockEvents, stopAtElectricalBoundary: true },
          );
      if (readFailed || advanced.executionStatus === 'fault')
        return fault(
          'arduino_execution_failed',
          advanced.diagnostics.map((d) => d.message).join(' ') || 'Electrical read failed.',
        );
      const changed =
        advanced.events.some(
          (event) =>
            event.kind === 'pin-mode-change' ||
            event.kind === 'output-change' ||
            event.kind === 'tone-start' ||
            event.kind === 'tone-stop',
        ) || advanced.state.servo !== currentRuntime?.servo;
      const at = Math.round(advanced.state.virtualTimeMs * 1000);
      if (changed && !commitPhysics(at))
        return fault('physical_advance_failed', 'Electrical event physical advance failed.');
      states.set(onlyBoard.id, advanced.state);
      loadedSources.set(onlyBoard.id, source);
      pendingProgramLoads.delete(onlyBoard.id);
      events.push(...advanced.events.map((event) => ({ ...event, componentId: onlyBoard.id })));
      if (changed) {
        cachedFrame = undefined;
        if (!commitPhysics(at))
          return fault('physical_advance_failed', 'Electrical event settle failed.');
      }
      reachedMicroseconds = at;
      clockEvents += Math.max(1, advanced.executedInstructions ?? 1);
      continue;
    }
    let sensorOutputChanged = false;
    for (const component of hcSr04Components) {
      const state = hcSr04States.get(component.id)!;
      if (hcSr04NextDueMicroseconds(state) !== time) continue;
      const step = advanceHcSr04Due(state, time);
      hcSr04States.set(component.id, step.state);
      sensorOutputChanged ||= step.echoChanged;
    }
    for (const component of pingUltrasonicComponents) {
      const state = pingUltrasonicStates.get(component.id)!;
      if (pingNextDueMicroseconds(state) !== time) continue;
      const step = advancePingUltrasonicDue(state, time);
      pingUltrasonicStates.set(component.id, step.state);
      sensorOutputChanged ||= step.echoChanged;
    }
    if (sensorOutputChanged) cachedFrame = undefined;
    const failureDue = eventPhysics && failureTime === time;
    const physicsDue = nextPhysicsTime() === time || failureDue;
    if (hasPhysics && eventPhysics) {
      if (!commitPhysics(time)) return fault('physical_advance_failed', 'Physical barrier failed.');
    } else if (hasPhysics && !winding) {
      const advanced = advancePhysics(time);
      if (!advanced.solved || !advanced.quality.passed || !advanced.transientState)
        return fault(
          'physical_advance_failed',
          advanced.diagnostics.map((entry) => entry.message).join(' ') ||
            'Не выполнены проверки переходного расчёта.',
        );
      physicalState = advanced.transientState;
      cachedFrame = undefined;
    }
    // The physical step and its quality check above already ran. Strict-v2 can
    // observe lazily at MCU reads; the narrow legacy button route may only skip
    // an extra observation while the MCU sleeps past this input-free barrier.
    const lazyPhysicsObservation =
      (eventPhysics ||
        (sleepingButtonPhysics &&
          runnableBoards.every((board) => {
            const runtime = states.get(board.id);
            return runtime !== undefined && Math.round(runtime.resumeAtMs * 1000) > time;
          }))) &&
      physicsDue &&
      !failureDue &&
      !sensorOutputChanged &&
      hcSr04Components.length === 0 &&
      pingUltrasonicComponents.length === 0 &&
      servoComponents.length === 0 &&
      (inputs[nextInputIndex]?.atMicroseconds ?? Number.POSITIVE_INFINITY) > time &&
      physicalState?.thermal.every((thermal) => thermal.failureMode !== 'open') &&
      runnableBoards.every((board) => {
        const runtime = states.get(board.id);
        return (
          !pendingProgramLoads.has(board.id) &&
          runtime !== undefined &&
          !runtime.pulseWait &&
          !runtime.ultrasonicAdapter &&
          !runtime.servo &&
          Object.keys(runtime.tones).length === 0
        );
      });
    if (
      lazyPhysicsObservation &&
      runnableBoards.every((board) => Math.round(states.get(board.id)!.resumeAtMs * 1000) > time)
    ) {
      reachedMicroseconds = time;
      clockEvents++;
      continue;
    }
    let inputChanged = false;
    while (inputs[nextInputIndex]?.atMicroseconds === time) {
      const input = inputs[nextInputIndex++]!;
      if (input.property === 'serialRx') {
        const state = states.get(input.componentId);
        if (state?.serial?.begun)
          states.set(input.componentId, {
            ...state,
            serial: enqueueArduinoSerialRx(state.serial, time, input.value as string),
          });
        continue;
      }
      activeDocument = applyInput(activeDocument, input);
      cachedFrame = undefined;
      inputChanged = true;
    }
    let frame: ReturnType<typeof sample> | undefined;
    let observationFault: ArduinoCircuitClockAdvance | undefined;
    const observe = () => {
      frame ??= sample(time);
      if (!frame.solved && !isNonFatalPassiveNoSource(frame))
        observationFault = fault(
          'electrical_sample_failed',
          frame.diagnostics.map((entry) => entry.message).join(' '),
        );
      else if (!frame.quality.passed && !isNonFatalPassiveNoSource(frame))
        observationFault = fault(
          'electrical_quality_failed',
          'Не выполнены проверки конечности, KCL или напряжения источников.',
        );
      return frame;
    };
    if (!lazyPhysicsObservation) {
      const observed = observe();
      if (observationFault) return observationFault;
      if (!eventPhysics) ownedPreparation?.observeRawDisplayState?.(time, observed.components);
      if (!sensorOutputChanged) {
        sensorOutputChanged =
          queryComponentId === undefined
            ? observeSensors(observed, time)
            : yield* observeSensorsWithQuery(observed, time, 'pre-mcu');
      } else if (
        queryComponentId !== undefined &&
        selectedTriggerFall(observed, time) !== undefined
      ) {
        // The v1 short-circuit above skips all pre-MCU sensors after a due output change.
        // Opt-in cannot establish this edge's ordering without changing that rule.
        return fault(
          'ambiguous_hc_sr04_query_order',
          'A due sensor output masked a selected Trig edge.',
        );
      }
    }
    const updates: [string, ArduinoRuntimeState, string][] = [];
    let electricalStateChanged = false;
    for (const board of runnableBoards) {
      const state = states.get(board.id);
      const pulseInputSample =
        Boolean(state?.pulseWait) && (inputChanged || physicsDue || sensorOutputChanged || pwmDue);
      const toneBarrierDue =
        arduinoServoNextDueMicroseconds(state?.servo) === time ||
        Object.values(state?.tones ?? {}).some(
          (tone) =>
            tone &&
            isArduinoTimedWaveformState(tone) &&
            arduinoWaveformNextDueMicroseconds(tone) === time,
        );
      if (
        !pendingProgramLoads.has(board.id) &&
        state &&
        Math.round(state.resumeAtMs * 1000) > time &&
        !pulseInputSample &&
        !toneBarrierDue
      )
        continue;
      const executionSource = executionSources.get(board.id)!;
      const advanced = ownership?.runtime
        ? ownership.runtime.advance(time / 1000, 1)
        : advanceClockedArduinoRuntime(
            executionSource,
            frame?.components.find((entry) => entry.componentId === board.id)?.terminalVoltages ??
              {},
            time / 1000,
            state,
            ({ pinModes }) =>
              adcInputs(
                board.id,
                time,
                (lazyPhysicsObservation ? observe() : frame)?.components.find(
                  (entry) => entry.componentId === board.id,
                )?.terminalVoltages ?? {},
                pinModes,
              ),
            { instructionBudget: 1, pulseInputSample },
          );
      // A failed lazy read precedes any interpreter failure and discards all of
      // this batch's effects, just like the eager observation did before execution.
      if (observationFault) return observationFault;
      if (advanced.executionStatus === 'fault')
        return fault(
          'arduino_execution_failed',
          advanced.diagnostics.map((entry) => entry.message).join(' '),
        );
      updates.push([board.id, advanced.state, executionSource]);
      events.push(...advanced.events.map((event) => ({ ...event, componentId: board.id })));
      if (advanced.state.servo !== state?.servo) electricalStateChanged = true;
      if (
        advanced.events.some(
          (event) =>
            event.kind === 'pin-mode-change' ||
            event.kind === 'output-change' ||
            event.kind === 'tone-start' ||
            event.kind === 'tone-stop',
        )
      )
        electricalStateChanged = true;
      if (advanced.events.length > 0) cachedFrame = undefined;
    }
    // Commit together, after ALL due boards have consumed the same electrical frame.
    for (const [id, state, loadedSource] of updates) {
      states.set(id, state);
      loadedSources.set(id, loadedSource);
      pendingProgramLoads.delete(id);
    }
    let waveformOutputChanged = false;
    for (const board of runnableBoards) {
      const state = states.get(board.id)!;
      const tones = { ...state.tones } as Partial<Record<Terminal, ArduinoToneState>>;
      let stateChanged = false;
      for (const [terminal, tone] of Object.entries(state.tones) as [
        Terminal,
        ArduinoToneState,
      ][]) {
        if (!isArduinoTimedWaveformState(tone) || arduinoWaveformNextDueMicroseconds(tone) !== time)
          continue;
        const advanced = advanceArduinoTimedWaveform(tone, time);
        if (advanced.state) tones[terminal] = advanced.state;
        else delete tones[terminal];
        stateChanged = true;
        waveformOutputChanged ||= advanced.levelChanged;
      }
      let nextState = stateChanged ? { ...state, tones } : state;
      if (nextState.servo && arduinoServoNextDueMicroseconds(nextState.servo) === time) {
        const advanced = advanceArduinoServoWaveforms(nextState.servo, time);
        nextState = { ...nextState, servo: advanced.state };
        waveformOutputChanged ||= advanced.levelChanged;
        stateChanged = true;
      }
      if (stateChanged) states.set(board.id, nextState);
    }
    if (waveformOutputChanged) {
      electricalStateChanged = true;
      cachedFrame = undefined;
    }
    if (electricalStateChanged) {
      const pulseWaiters = runnableBoards.filter((board) => states.get(board.id)?.pulseWait);
      if (
        pulseWaiters.length > 0 ||
        hcSr04Components.length > 0 ||
        pingUltrasonicComponents.length > 0 ||
        servoComponents.length > 0
      ) {
        cachedFrame = undefined;
        let postCommitFrame = sample(time);
        if (!postCommitFrame.solved && !isNonFatalPassiveNoSource(postCommitFrame))
          return fault(
            'electrical_sample_failed',
            postCommitFrame.diagnostics.map((entry) => entry.message).join(' '),
          );
        if (!postCommitFrame.quality.passed && !isNonFatalPassiveNoSource(postCommitFrame))
          return fault(
            'electrical_quality_failed',
            'Не выполнены проверки конечности, KCL или напряжения источников.',
          );
        const sensorChanged =
          queryComponentId === undefined
            ? observeSensors(postCommitFrame, time)
            : yield* observeSensorsWithQuery(postCommitFrame, time, 'post-gpio');
        if (sensorChanged) {
          cachedFrame = undefined;
          postCommitFrame = sample(time);
        }
        const pulseUpdates: [string, ArduinoRuntimeState, string][] = [];
        for (const board of pulseWaiters) {
          const executionSource = executionSources.get(board.id)!;
          const advanced = advanceClockedArduinoRuntime(
            executionSource,
            postCommitFrame.components.find((entry) => entry.componentId === board.id)
              ?.terminalVoltages ?? {},
            time / 1000,
            states.get(board.id),
            undefined,
            { instructionBudget: 1, pulseInputSample: true },
          );
          if (advanced.executionStatus === 'fault')
            return fault(
              'arduino_execution_failed',
              advanced.diagnostics.map((entry) => entry.message).join(' '),
            );
          pulseUpdates.push([board.id, advanced.state, executionSource]);
          events.push(...advanced.events.map((event) => ({ ...event, componentId: board.id })));
        }
        for (const [id, state, loadedSource] of pulseUpdates) {
          states.set(id, state);
          loadedSources.set(id, loadedSource);
        }
      }
    }
    if (eventPhysics && electricalStateChanged) {
      if (!commitPhysics(time))
        return fault('physical_advance_failed', 'Electrical settle failed.');
    }
    if (!eventPhysics && electricalStateChanged && ownedPreparation?.observeRawDisplayState) {
      // An optical read is a zero-duration observation, never a physical checkpoint.
      // Record the settled held state after all same-time GPIO updates are committed.
      const settled = sample(time);
      if (settled.solved && settled.quality.passed)
        ownedPreparation.observeRawDisplayState(time, settled.components);
      else ownedPreparation.invalidateRawDisplayState?.();
    }
    reachedMicroseconds = time;
    clockEvents++;
  }
  const ready = nextTime() > targetMicroseconds;
  if (ready) {
    reachedMicroseconds = targetMicroseconds;
    for (const board of boards) {
      const executionSource = executionSources.get(board.id);
      if (executionSource === undefined) {
        states.set(board.id, resetRuntimeAt(targetMicroseconds));
        loadedSources.set(board.id, null);
        continue;
      }
      // No instruction is due in this idle interval; only align the observed horizon.
      const advanced = advanceClockedArduinoRuntime(
        executionSource,
        {},
        targetMicroseconds / 1000,
        states.get(board.id),
      );
      if (advanced.executionStatus !== 'ready' || advanced.events.length > 0)
        return fault('clock_alignment_failed', 'Платы не достигли общего горизонта.');
      states.set(board.id, advanced.state);
      loadedSources.set(board.id, executionSource);
      pendingProgramLoads.delete(board.id);
    }
  }
  if (ownedPreparation && eventPhysics) {
    if (physicalState) ownedPreparation.physicalState = physicalState;
    ownedPreparation.failureTime = failureTime;
  }
  const state: ArduinoCircuitClockState = {
    version: 1,
    profile,
    documentDigest: digest,
    reachedMicroseconds,
    inputs: inputs.map((event) => ({ ...event })),
    nextInputIndex,
    ...(physicalState ? { physicalState } : {}),
    ...(eventPhysics ? { thermalEpochs: [...thermalEpochs.values()] } : {}),
    ...(hcSr04Components.length > 0
      ? {
          hcSr04: hcSr04Components.map((component) => ({
            componentId: component.id,
            runtime: hcSr04States.get(component.id)!,
          })),
        }
      : {}),
    ...(pingUltrasonicComponents.length > 0
      ? {
          pingUltrasonic: pingUltrasonicComponents.map((component) => ({
            componentId: component.id,
            runtime: pingUltrasonicStates.get(component.id)!,
          })),
        }
      : {}),
    ...(servoComponents.length > 0
      ? {
          servoMotors: servoComponents.map((component) => ({
            componentId: component.id,
            runtime: servoStates.get(component.id)!,
          })),
        }
      : {}),
    boards: boards.map((board) => ({
      componentId: board.id,
      loadedSource: loadedSources.get(board.id) ?? null,
      runtime: states.get(board.id)!,
    })),
  };
  let result: ArduinoCircuitClockAdvance['result'] = null;
  if (ready) {
    const frame = sample(targetMicroseconds);
    if (!frame.solved && !isNonFatalPassiveNoSource(frame))
      return fault(
        'electrical_sample_failed',
        frame.diagnostics.map((entry) => entry.message).join(' '),
      );
    if (!frame.quality.passed && !isNonFatalPassiveNoSource(frame))
      return fault(
        'electrical_quality_failed',
        'Не выполнены проверки конечности, KCL или напряжения источников.',
      );
    if (eventPhysics && frame.solved && frame.quality.passed)
      ownedPreparation?.observeLedState?.(targetMicroseconds, frame.components);
    if (!eventPhysics && frame.solved && frame.quality.passed)
      ownedPreparation?.observeRawDisplayState?.(targetMicroseconds, frame.components);
    // The public controller observation contains ordinary stable data fields.
    // Reading these private projections once materializes their detached values.
    if (ownership?.runtime)
      for (const board of state.boards) {
        void board.runtime.variables;
        void board.runtime.locals;
        void board.runtime.scopes;
      }
    shaftPort?.onCheckpoint(targetMicroseconds);
    result = {
      ...frame,
      controllerState: {
        version: 1,
        simulationTimeMs: targetMicroseconds / 1000,
        boards: state.boards,
      },
    };
  }
  return {
    executionStatus: ready ? 'ready' : 'yielded',
    result,
    state,
    events,
    diagnostics: [...compileDiagnostics.values()],
  };
}
