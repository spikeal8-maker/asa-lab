import {
  advanceClockedArduinoRuntime,
  analyseArduinoProgramSyntax,
  arduinoRuntimeStateMatchesProgram,
  type ArduinoRuntimeEvent,
  type ArduinoRuntimeState,
} from './arduino-program-runtime.js';
import { arduinoSnapshotFromState, arduinoSourceFor, isArduinoUno } from './arduino-model.js';
import type { ElectronicsDocument, SchematicComponent } from './document.js';
import { simulationInputDigest } from './simulation-input-digest.js';
import { electricalModelFor } from './model-registry.js';
import { compileCircuit, verifyCircuitQuality, type SimulationQuality } from './simulation.js';
import {
  clockedRcStateIsCompatible,
  solveCircuitWithHeldArduino,
  solveRcCircuitWithHeldArduino,
  type SolveResult,
} from './solver.js';
import {
  isElectrolyticCapacitor,
  type CapacitorTransientState,
} from './models/capacitor-transient-model.js';

const MAX_TIME_US = 2 ** 50 - 1001;
const MAX_INPUT_EVENTS = 1024;
const MAX_BOARDS = 8;
// Fixed barriers independent of UI refresh times. Adaptive trial steps stay inside each barrier.
const PHYSICS_QUANTUM_US = 1000;

export interface ArduinoCircuitInputEvent {
  readonly atMicroseconds: number;
  readonly componentId: string;
  readonly property: 'state' | 'wiperPosition';
  readonly value: boolean | number;
}

export interface ArduinoCircuitClockState {
  readonly version: 1;
  readonly profile: 'dc-inputs-v1' | 'rc-inputs-v2';
  readonly documentDigest: string;
  readonly reachedMicroseconds: number;
  /** Ordered, append-only history. Array index is the stable event sequence. */
  readonly inputs: readonly ArduinoCircuitInputEvent[];
  readonly nextInputIndex: number;
  /** Committed physics at the last clock barrier, NOT a speculative UI-horizon sample. */
  readonly physicalState?: CapacitorTransientState;
  readonly boards: readonly {
    readonly componentId: string;
    readonly runtime: ArduinoRuntimeState;
  }[];
}

export interface ArduinoCircuitClockDiagnostic {
  readonly code: string;
  readonly message: string;
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
    [
      'arduino-uno',
      'resistor',
      'momentary-button',
      'spdt-switch',
      'potentiometer',
      'photoresistor',
      'breadboard-connectivity',
      'ideal-wire',
      'ideal-dc-source',
      'capacitor',
    ].includes(model.id)
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
            event.value <= 1))
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
        ? ({ ...component, [event.property]: event.value } as SchematicComponent)
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
  const profile = document.components.some(isElectrolyticCapacitor)
    ? 'rc-inputs-v2'
    : 'dc-inputs-v1';
  const unsupported = document.components.find((component) => !clockedComponent(component));
  if (unsupported)
    return fault(
      'clocked_profile_unsupported',
      `${unsupported.id}: общий DC/RC clock ещё не поддерживает временное сопряжение этого компонента.`,
    );
  const boards = document.components
    .filter(isArduinoUno)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (boards.length === 0 || boards.length > MAX_BOARDS)
    return fault('invalid_board_count', 'Профиль требует от 1 до 8 плат Arduino.');
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
  for (const board of boards) {
    const diagnostic = analyseArduinoProgramSyntax(arduinoSourceFor(board))[0];
    if (diagnostic) return fault(diagnostic.code, `${board.id}: ${diagnostic.message}`);
  }
  if (previous) {
    if (
      previous.version !== 1 ||
      previous.profile !== profile ||
      previous.documentDigest !== digest ||
      !integerTime(previous.reachedMicroseconds) ||
      previous.reachedMicroseconds > targetMicroseconds ||
      (profile === 'rc-inputs-v2'
        ? !previous.physicalState ||
          !clockedRcStateIsCompatible(
            document,
            previous.physicalState,
            previous.reachedMicroseconds / 1000,
          ) ||
          !integerTime(Math.round(previous.physicalState.simulationTimeMs * 1000)) ||
          Math.round(previous.physicalState.simulationTimeMs * 1000) / 1000 !==
            previous.physicalState.simulationTimeMs ||
          previous.reachedMicroseconds -
            Math.round(previous.physicalState.simulationTimeMs * 1000) >=
            PHYSICS_QUANTUM_US
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
      previous.boards.some(
        (entry, index) =>
          !entry ||
          entry.componentId !== boards[index]!.id ||
          !arduinoRuntimeStateMatchesProgram(arduinoSourceFor(boards[index]!), entry.runtime) ||
          entry.runtime.clockProfile !== 'instruction-us-v1' ||
          entry.runtime.faults.length > 0 ||
          Object.keys(entry.runtime.tones).length > 0 ||
          entry.runtime.virtualTimeMs > previous.reachedMicroseconds / 1000 ||
          entry.runtime.resumeAtMs <= previous.reachedMicroseconds / 1000,
      )
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
    components: [...document.components].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    connections: [...document.connections].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
  };
  let nextInputIndex = previous?.nextInputIndex ?? 0;
  for (const event of inputs.slice(0, nextInputIndex))
    activeDocument = applyInput(activeDocument, event);
  const states = new Map(
    previous?.boards.map((entry) => [entry.componentId, entry.runtime] as const),
  );
  const coldState = advanceClockedArduinoRuntime('').state;
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
      solveRcCircuitWithHeldArduino(activeDocument, time / 1000, snapshots(), physicalState),
      time,
    );
  const sample = (time: number): NonNullable<ArduinoCircuitClockAdvance['result']> => {
    if (cachedFrame && (profile === 'dc-inputs-v1' || cachedFrameTime === time)) return cachedFrame;
    if (profile === 'rc-inputs-v2') {
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
        ),
        time,
      );
    } else {
      cachedFrame = withQuality(
        solveCircuitWithHeldArduino(activeDocument, time / 1000, snapshots()),
        time,
      );
    }
    cachedFrameTime = time;
    return cachedFrame;
  };
  const nextTime = (): number =>
    Math.min(
      ...boards.map((board) => {
        const state = states.get(board.id);
        return state ? Math.round(state.resumeAtMs * 1000) : 0;
      }),
      inputs[nextInputIndex]?.atMicroseconds ?? Number.POSITIVE_INFINITY,
      profile === 'rc-inputs-v2'
        ? (Math.floor(
            Math.round((physicalState?.simulationTimeMs ?? 0) * 1000) / PHYSICS_QUANTUM_US,
          ) +
            1) *
            PHYSICS_QUANTUM_US
        : Number.POSITIVE_INFINITY,
    );
  // A returned frame is never a speculative MCU state. Failure discards this whole batch.
  let clockEvents = 0;
  while (nextTime() <= targetMicroseconds && clockEvents < budget) {
    const time = nextTime();
    if (profile === 'rc-inputs-v2') {
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
    while (inputs[nextInputIndex]?.atMicroseconds === time) {
      activeDocument = applyInput(activeDocument, inputs[nextInputIndex++]!);
      cachedFrame = undefined;
    }
    const frame = sample(time);
    if (!frame.solved)
      return fault(
        'electrical_sample_failed',
        frame.diagnostics.map((entry) => entry.message).join(' '),
      );
    if (!frame.quality.passed)
      return fault(
        'electrical_quality_failed',
        'Не выполнены проверки конечности, KCL или напряжения источников.',
      );
    const updates: [string, ArduinoRuntimeState][] = [];
    for (const board of boards) {
      const state = states.get(board.id);
      if (state && Math.round(state.resumeAtMs * 1000) > time) continue;
      const advanced = advanceClockedArduinoRuntime(
        arduinoSourceFor(board),
        frame.components.find((entry) => entry.componentId === board.id)?.terminalVoltages ?? {},
        time / 1000,
        state,
        undefined,
        { instructionBudget: 1 },
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
      updates.push([board.id, advanced.state]);
      events.push(...advanced.events.map((event) => ({ ...event, componentId: board.id })));
      if (advanced.events.length > 0) cachedFrame = undefined;
    }
    // Commit together, after ALL due boards have consumed the same electrical frame.
    for (const [id, state] of updates) states.set(id, state);
    reachedMicroseconds = time;
    clockEvents++;
  }
  const ready = nextTime() > targetMicroseconds;
  if (ready) {
    reachedMicroseconds = targetMicroseconds;
    for (const board of boards) {
      // No instruction is due in this idle interval; only align the observed horizon.
      const advanced = advanceClockedArduinoRuntime(
        arduinoSourceFor(board),
        {},
        targetMicroseconds / 1000,
        states.get(board.id),
      );
      if (advanced.executionStatus !== 'ready' || advanced.events.length > 0)
        return fault('clock_alignment_failed', 'Платы не достигли общего горизонта.');
      states.set(board.id, advanced.state);
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
    boards: boards.map((board) => ({ componentId: board.id, runtime: states.get(board.id)! })),
  };
  let result: ArduinoCircuitClockAdvance['result'] = null;
  if (ready) {
    const frame = sample(targetMicroseconds);
    if (!frame.solved)
      return fault(
        'electrical_sample_failed',
        frame.diagnostics.map((entry) => entry.message).join(' '),
      );
    if (!frame.quality.passed)
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
  return { executionStatus: ready ? 'ready' : 'yielded', result, state, events, diagnostics: [] };
}
