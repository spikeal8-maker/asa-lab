import {
  advanceClockedArduinoRuntime,
  analyseArduinoProgramSyntax,
  arduinoRuntimeStateMatchesProgram,
  type ArduinoRuntimeEvent,
  type ArduinoRuntimeState,
} from './arduino-program-runtime.js';
import { analyseArduinoSourceSupport } from './arduino-capabilities.js';
import { arduinoSnapshotFromState, arduinoSourceFor, isArduinoUno } from './arduino-model.js';
import type { ElectronicsDocument, SchematicComponent } from './document.js';
import { simulationInputDigest } from './simulation-input-digest.js';
import { electricalModelFor } from './model-registry.js';
import { compileCircuit, verifyCircuitQuality, type SimulationQuality } from './simulation.js';
import {
  clockedRcStateIsCompatible,
  clockedPhysicalStateIsCompatible,
  solveCircuitWithHeldArduino,
  solveRcCircuitWithHeldArduino,
  type SolveResult,
} from './solver.js';
import {
  isElectrolyticCapacitor,
  type CapacitorTransientState,
} from './models/capacitor-transient-model.js';
import {
  advanceHcSr04Due,
  hcSr04DistanceMeters,
  hcSr04InputLevels,
  hcSr04NextDueMicroseconds,
  initialHcSr04RuntimeState,
  isHcSr04,
  isHcSr04RuntimeState,
  observeHcSr04Inputs,
  type HcSr04RuntimeState,
} from './models/hc-sr04-runtime.js';

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
  if (
    document.components.some(
      (component) =>
        electricalModelFor(component).id === 'digital-multimeter' &&
        component.stateProperties?.['measurementMode'] === 'dc-current',
    )
  )
    return true;
  if (document.components.some(isElectrolyticCapacitor)) return false;
  return document.components.some(
    (component) => electricalModelFor(component).id === 'ideal-dc-source',
  );
}

export interface ArduinoCircuitInputEvent {
  readonly atMicroseconds: number;
  readonly componentId: string;
  readonly property: 'state' | 'wiperPosition' | 'temperatureCelsius' | 'moisturePercent';
  readonly value: boolean | number;
}

export interface ArduinoCircuitClockState {
  readonly version: 1;
  readonly profile: 'dc-inputs-v1' | 'rc-inputs-v2' | 'electrothermal-v1';
  readonly documentDigest: string;
  readonly reachedMicroseconds: number;
  /** Ordered, append-only history. Array index is the stable event sequence. */
  readonly inputs: readonly ArduinoCircuitInputEvent[];
  readonly nextInputIndex: number;
  /** Committed physics at the last clock barrier, NOT a speculative UI-horizon sample. */
  readonly physicalState?: CapacitorTransientState;
  readonly hcSr04?: readonly {
    readonly componentId: string;
    readonly runtime: HcSr04RuntimeState;
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

function integerTime(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value <= MAX_TIME_US;
}

function clockedComponent(component: SchematicComponent): boolean {
  // A narrow, opt-in electrical profile. Do not silently freeze physical history.
  const model = electricalModelFor(component);
  return (
    model.support !== 'unsupported' &&
    (ELECTROTHERMAL_MODELS.has(model.id) ||
      [
        'arduino-uno',
        'hc-sr04-distance-sensor',
        'resistor',
        'momentary-button',
        'spdt-switch',
        'potentiometer',
        'photoresistor',
        'analog-temperature-sensor',
        'resistive-soil-sensor',
        'breadboard-connectivity',
        'digital-multimeter',
        'ideal-wire',
        'ideal-dc-source',
        'capacitor',
      ].includes(model.id))
  );
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
            event.value <= 125))
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
  return {
    ...document,
    components: document.components.map((component) =>
      component.id === event.componentId
        ? event.property === 'temperatureCelsius' || event.property === 'moisturePercent'
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
export function advanceArduinoCircuitClock(
  document: ElectronicsDocument,
  targetMicroseconds: number,
  previous?: ArduinoCircuitClockState,
  options: {
    readonly inputs?: readonly ArduinoCircuitInputEvent[];
    readonly maxClockEvents?: number;
  } = {},
): ArduinoCircuitClockAdvance {
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
  const profile = usesElectrothermalProfile(document)
    ? 'electrothermal-v1'
    : document.components.some(isElectrolyticCapacitor)
      ? 'rc-inputs-v2'
      : 'dc-inputs-v1';
  const hasPhysics = profile !== 'dc-inputs-v1';
  const unsupported = document.components.find((component) => !clockedComponent(component));
  if (unsupported)
    return fault(
      'clocked_profile_unsupported',
      `${unsupported.id}: общий DC/RC clock ещё не поддерживает временное сопряжение этого компонента.`,
    );
  const boards = document.components
    .filter(isArduinoUno)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const hcSr04Components = document.components
    .filter(isHcSr04)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const invalidHcSr04 = hcSr04Components.find(
    (component) => hcSr04DistanceMeters(component) === null,
  );
  if (invalidHcSr04)
    return fault(
      'invalid_hc_sr04_distance',
      `${invalidHcSr04.id}: distanceMeters должен быть 0.02…4.00 м.`,
    );
  if (boards.length > MAX_BOARDS)
    return fault('invalid_board_count', 'Профиль поддерживает не более 8 плат Arduino.');
  let digest: string;
  try {
    digest = simulationInputDigest(document, 0);
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
    const supportDiagnostics = analyseArduinoSourceSupport(source).filter(
      (entry) => entry.status === 'unsupported',
    );
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
  if (previous) {
    if (
      previous.version !== 1 ||
      previous.profile !== profile ||
      previous.documentDigest !== digest ||
      !integerTime(previous.reachedMicroseconds) ||
      previous.reachedMicroseconds > targetMicroseconds ||
      (hasPhysics
        ? previous.physicalState
          ? !(
              profile === 'electrothermal-v1'
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
      previous.boards.some((entry, index) => {
        const board = boards[index]!;
        const loadedSource = previousLoadedSources.get(board.id);
        return (
          !entry ||
          entry.componentId !== board.id ||
          loadedSource === undefined ||
          !arduinoRuntimeStateMatchesProgram(loadedSource ?? '', entry.runtime) ||
          entry.runtime.clockProfile !== 'instruction-us-v1' ||
          entry.runtime.faults.length > 0 ||
          Object.keys(entry.runtime.tones).length > 0 ||
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
  for (const board of boards) {
    if (!executionSources.has(board.id) && !states.has(board.id)) {
      states.set(board.id, coldState);
      loadedSources.set(board.id, null);
    }
  }
  let reachedMicroseconds = previous?.reachedMicroseconds ?? -1;
  let physicalState = previous?.physicalState;
  const events: (ArduinoRuntimeEvent & { readonly componentId: string })[] = [];
  let cachedFrame: NonNullable<ArduinoCircuitClockAdvance['result']> | undefined;
  let cachedFrameTime = -1;
  const snapshots = () =>
    new Map(
      boards.map(
        (board) => [board.id, arduinoSnapshotFromState(states.get(board.id) ?? coldState)] as const,
      ),
    );
  const withQuality = (
    frame: SolveResult,
    time: number,
  ): NonNullable<ArduinoCircuitClockAdvance['result']> => ({
    ...frame,
    quality: verifyCircuitQuality(activeDocument, compileCircuit(activeDocument), frame, {
      simulationTimeMs: time / 1000,
    }),
  });
  const advancePhysics = (time: number) =>
    withQuality(
      solveRcCircuitWithHeldArduino(
        activeDocument,
        time / 1000,
        snapshots(),
        physicalState,
        hcSr04States,
      ),
      time,
    );
  const sample = (time: number): NonNullable<ArduinoCircuitClockAdvance['result']> => {
    if (cachedFrame && (profile === 'dc-inputs-v1' || cachedFrameTime === time)) return cachedFrame;
    if (hasPhysics) {
      // A horizon between canonical events may be observed but never committed:
      // otherwise UI frame rate would change adaptive integration and later ADC reads.
      const advanced = advancePhysics(time);
      if (!advanced.solved || !advanced.quality.passed) return advanced;
      cachedFrame = withQuality(
        solveRcCircuitWithHeldArduino(
          activeDocument,
          time / 1000,
          snapshots(),
          advanced.transientState,
          hcSr04States,
        ),
        time,
      );
    } else {
      cachedFrame = withQuality(
        solveCircuitWithHeldArduino(activeDocument, time / 1000, snapshots(), hcSr04States),
        time,
      );
    }
    cachedFrameTime = time;
    return cachedFrame;
  };
  const observeSensors = (
    frame: NonNullable<ArduinoCircuitClockAdvance['result']>,
    time: number,
  ): boolean => {
    let echoChanged = false;
    for (const component of hcSr04Components) {
      const terminalVoltages =
        frame.components.find((entry) => entry.componentId === component.id)?.terminalVoltages ??
        {};
      const levels = hcSr04InputLevels(terminalVoltages);
      const step = observeHcSr04Inputs(
        hcSr04States.get(component.id)!,
        time,
        levels.powered,
        levels.triggerHigh,
        hcSr04DistanceMeters(component)!,
      );
      hcSr04States.set(component.id, step.state);
      echoChanged ||= step.echoChanged;
    }
    return echoChanged;
  };
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
      Number.POSITIVE_INFINITY,
    );
  const nextPhysicsTime = (): number =>
    hasPhysics
      ? (Math.floor(
          Math.round((physicalState?.simulationTimeMs ?? 0) * 1000) / PHYSICS_QUANTUM_US,
        ) +
          1) *
        PHYSICS_QUANTUM_US
      : Number.POSITIVE_INFINITY;
  const nextTime = (): number =>
    Math.min(
      ...runnableBoards.map((board) => {
        if (pendingProgramLoads.has(board.id)) return previous?.reachedMicroseconds ?? 0;
        const state = states.get(board.id);
        return state ? Math.round(state.resumeAtMs * 1000) : 0;
      }),
      inputs[nextInputIndex]?.atMicroseconds ?? Number.POSITIVE_INFINITY,
      nextSensorTime(),
      nextPhysicsTime(),
    );
  // A returned frame is never a speculative MCU state. Failure discards this whole batch.
  let clockEvents = 0;
  while (nextTime() <= targetMicroseconds && clockEvents < budget) {
    const time = nextTime();
    let sensorOutputChanged = false;
    for (const component of hcSr04Components) {
      const state = hcSr04States.get(component.id)!;
      if (hcSr04NextDueMicroseconds(state) !== time) continue;
      const step = advanceHcSr04Due(state, time);
      hcSr04States.set(component.id, step.state);
      sensorOutputChanged ||= step.echoChanged;
    }
    if (sensorOutputChanged) cachedFrame = undefined;
    const physicsDue = nextPhysicsTime() === time;
    if (hasPhysics) {
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
    let inputChanged = false;
    while (inputs[nextInputIndex]?.atMicroseconds === time) {
      activeDocument = applyInput(activeDocument, inputs[nextInputIndex++]!);
      cachedFrame = undefined;
      inputChanged = true;
    }
    const frame = sample(time);
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
    sensorOutputChanged ||= observeSensors(frame, time);
    const updates: [string, ArduinoRuntimeState, string][] = [];
    let electricalStateChanged = false;
    for (const board of runnableBoards) {
      const state = states.get(board.id);
      const pulseInputSample =
        Boolean(state?.pulseWait) && (inputChanged || physicsDue || sensorOutputChanged);
      if (
        !pendingProgramLoads.has(board.id) &&
        state &&
        Math.round(state.resumeAtMs * 1000) > time &&
        !pulseInputSample
      )
        continue;
      const executionSource = executionSources.get(board.id)!;
      const advanced = advanceClockedArduinoRuntime(
        executionSource,
        frame.components.find((entry) => entry.componentId === board.id)?.terminalVoltages ?? {},
        time / 1000,
        state,
        undefined,
        { instructionBudget: 1, pulseInputSample },
      );
      if (advanced.executionStatus === 'fault')
        return fault(
          'arduino_execution_failed',
          advanced.diagnostics.map((entry) => entry.message).join(' '),
        );
      if (
        Object.keys(advanced.state.tones).length > 0 ||
        advanced.events.some((event) => event.kind === 'tone-start')
      ) {
        return fault(
          'clocked_profile_unsupported',
          'tone требует планирования периферийных фронтов; общий DC/RC clock не подменяет его постоянным напряжением.',
        );
      }
      updates.push([board.id, advanced.state, executionSource]);
      events.push(...advanced.events.map((event) => ({ ...event, componentId: board.id })));
      if (
        advanced.events.some(
          (event) => event.kind === 'pin-mode-change' || event.kind === 'output-change',
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
    if (electricalStateChanged) {
      const pulseWaiters = runnableBoards.filter((board) => states.get(board.id)?.pulseWait);
      if (pulseWaiters.length > 0 || hcSr04Components.length > 0) {
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
        if (observeSensors(postCommitFrame, time)) {
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
  const state: ArduinoCircuitClockState = {
    version: 1,
    profile,
    documentDigest: digest,
    reachedMicroseconds,
    inputs: inputs.map((event) => ({ ...event })),
    nextInputIndex,
    ...(physicalState ? { physicalState } : {}),
    ...(hcSr04Components.length > 0
      ? {
          hcSr04: hcSr04Components.map((component) => ({
            componentId: component.id,
            runtime: hcSr04States.get(component.id)!,
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
