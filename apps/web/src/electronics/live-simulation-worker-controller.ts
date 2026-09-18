import {
  resetElectronicsTimedState,
  type ElectronicsTimedInputEvent,
  type ElectronicsTimedState,
} from '@asa-lab/electronics/engine';
import type { ProductionStateValue, SchematicDocument, SolveResult } from '../api';
import { ElectronicsSimulationWorkerClient } from './simulation-worker-client';
import type { SimulationTimedAdvancePayload } from './simulation-worker-protocol';

export interface ElectronicsSimulationWorkerExecutor {
  beginGeneration(projectSessionId: string): number;
  preflight(generationId: number, document: SchematicDocument): Promise<SolveResult>;
  advance(
    generationId: number,
    document: SchematicDocument,
    state: ElectronicsTimedState,
    requestedHorizonMicroseconds: number,
    inputEvents?: readonly ElectronicsTimedInputEvent[],
  ): Promise<SimulationTimedAdvancePayload>;
  cancelActiveGeneration(): void;
  dispose(): void;
}

export interface LiveSimulationWorkerCallbacks {
  readonly onResult: (result: SolveResult) => void;
  readonly onFailure: (error: Error) => void;
}

interface SimulationTarget {
  readonly requestedHorizonMicroseconds: number;
}

const TIMED_STATE_PROPERTIES = ['temperatureCelsius', 'moisturePercent'] as const;
const RUNTIME_INPUT_OBSERVATION_WINDOW_MICROSECONDS = 100_000;

function boundedInputObservationHorizon(
  eventAtMicroseconds: number,
  ceilingMicroseconds: number,
): number {
  return Math.max(
    eventAtMicroseconds,
    Math.min(
      Math.max(eventAtMicroseconds, ceilingMicroseconds),
      eventAtMicroseconds + RUNTIME_INPUT_OBSERVATION_WINDOW_MICROSECONDS,
    ),
  );
}

function stripTimedRuntimeInputs(document: SchematicDocument): unknown {
  const withoutViewport = { ...document } as Partial<SchematicDocument>;
  delete withoutViewport.viewport;
  return {
    ...withoutViewport,
    simulation: { ...document.simulation, running: false },
    components: document.components.map((component) => {
      const clone = { ...component } as typeof component & {
        state?: boolean;
        wiperPosition?: number;
        stateProperties?: Readonly<Record<string, ProductionStateValue>>;
      };
      delete clone.state;
      delete clone.wiperPosition;
      if (clone.stateProperties) {
        const stateProperties = { ...clone.stateProperties };
        for (const property of TIMED_STATE_PROPERTIES) delete stateProperties[property];
        if (Object.keys(stateProperties).length > 0) clone.stateProperties = stateProperties;
        else delete clone.stateProperties;
      }
      return clone;
    }),
  };
}

function sameCanonicalStructure(left: SchematicDocument, right: SchematicDocument): boolean {
  return (
    JSON.stringify(stripTimedRuntimeInputs(left)) === JSON.stringify(stripTimedRuntimeInputs(right))
  );
}

function timedRuntimeEvents(
  previous: SchematicDocument,
  next: SchematicDocument,
  atMicroseconds: number,
): ElectronicsTimedInputEvent[] {
  const previousById = new Map(previous.components.map((component) => [component.id, component]));
  const events: ElectronicsTimedInputEvent[] = [];
  for (const component of next.components) {
    const before = previousById.get(component.id);
    if (!before) continue;
    if (component.state !== before.state && typeof component.state === 'boolean') {
      events.push({
        atMicroseconds,
        targetId: component.id,
        operation: 'state',
        payload: component.state,
      });
    }
    if (
      component.wiperPosition !== before.wiperPosition &&
      typeof component.wiperPosition === 'number' &&
      Number.isFinite(component.wiperPosition)
    ) {
      events.push({
        atMicroseconds,
        targetId: component.id,
        operation: 'wiperPosition',
        payload: component.wiperPosition,
      });
    }
    for (const property of TIMED_STATE_PROPERTIES) {
      const value = component.stateProperties?.[property];
      if (
        value !== before.stateProperties?.[property] &&
        typeof value === 'number' &&
        Number.isFinite(value)
      ) {
        events.push({
          atMicroseconds,
          targetId: component.id,
          operation: property,
          payload: value,
        });
      }
    }
  }
  return events;
}

export class ElectronicsLiveSimulationWorkerController {
  private generationId: number | null = null;
  private projectSessionId: string | null = null;
  private callbacks: LiveSimulationWorkerCallbacks | null = null;
  private canonicalDocument: SchematicDocument | null = null;
  private lastRuntimeDocument: SchematicDocument | null = null;
  private timedState: ElectronicsTimedState = resetElectronicsTimedState();
  private latestTarget: SimulationTarget | null = null;
  private continuationTarget: SimulationTarget | null = null;
  private inputTarget: SimulationTarget | null = null;
  private pendingInputEvents: ElectronicsTimedInputEvent[] = [];
  private lastInputEventAtMicroseconds = -1;
  private horizonOffsetMicroseconds = 0;
  private inFlight = false;
  private inFlightKind: 'preflight' | 'advance' | null = null;

  constructor(
    private readonly executor: ElectronicsSimulationWorkerExecutor = new ElectronicsSimulationWorkerClient(),
  ) {}

  start(
    projectSessionId: string,
    document: SchematicDocument,
    callbacks: LiveSimulationWorkerCallbacks,
  ): void {
    this.stop();
    this.projectSessionId = projectSessionId;
    this.callbacks = callbacks;
    this.beginGeneration(document, 0);
  }

  update(document: SchematicDocument, hostHorizonMicroseconds: number): void {
    if (
      this.generationId === null ||
      !Number.isSafeInteger(hostHorizonMicroseconds) ||
      hostHorizonMicroseconds < 0
    ) {
      return;
    }
    const canonicalHorizon = Math.max(0, hostHorizonMicroseconds - this.horizonOffsetMicroseconds);
    const previousDocument = this.lastRuntimeDocument;
    if (!previousDocument || !sameCanonicalStructure(previousDocument, document)) {
      this.horizonOffsetMicroseconds = hostHorizonMicroseconds;
      this.beginGeneration(document, 0);
      return;
    }

    const committed = this.timedState.continuation?.committedHorizonMicroseconds ?? 0;
    const eventAtMicroseconds = Math.max(committed + 1, this.lastInputEventAtMicroseconds + 1);
    const events = timedRuntimeEvents(previousDocument, document, eventAtMicroseconds);
    this.lastRuntimeDocument = document;
    let requestedHorizonMicroseconds = canonicalHorizon;
    if (events.length > 0) {
      this.pendingInputEvents.push(...events);
      this.lastInputEventAtMicroseconds = eventAtMicroseconds;
      this.inputTarget = {
        requestedHorizonMicroseconds: boundedInputObservationHorizon(
          eventAtMicroseconds,
          canonicalHorizon,
        ),
      };
      requestedHorizonMicroseconds = Math.max(requestedHorizonMicroseconds, eventAtMicroseconds);
    }
    if (
      this.inFlight &&
      this.inFlightKind === 'preflight' &&
      requestedHorizonMicroseconds === 0 &&
      events.length === 0 &&
      this.latestTarget === null
    ) {
      return;
    }
    this.latestTarget = {
      requestedHorizonMicroseconds: Math.max(
        requestedHorizonMicroseconds,
        this.latestTarget?.requestedHorizonMicroseconds ?? 0,
      ),
    };
    this.pump();
  }

  restart(document: SchematicDocument): void {
    if (this.generationId === null || !this.projectSessionId) return;
    this.horizonOffsetMicroseconds = 0;
    this.beginGeneration(document, 0);
  }

  stop(): void {
    const active = this.generationId !== null;
    this.clearGeneration();
    if (active) this.executor.cancelActiveGeneration();
  }

  dispose(): void {
    this.clearGeneration();
    this.executor.dispose();
  }

  private beginGeneration(document: SchematicDocument, canonicalHorizonMicroseconds: number): void {
    const projectSessionId = this.projectSessionId;
    if (!projectSessionId) return;
    this.canonicalDocument = document;
    this.lastRuntimeDocument = document;
    this.timedState = resetElectronicsTimedState();
    this.latestTarget = { requestedHorizonMicroseconds: canonicalHorizonMicroseconds };
    this.continuationTarget = null;
    this.inputTarget = null;
    this.pendingInputEvents = [];
    this.lastInputEventAtMicroseconds = -1;
    const generationId = this.executor.beginGeneration(projectSessionId);
    this.generationId = generationId;
    this.inFlight = true;
    this.inFlightKind = 'preflight';
    void this.executor
      .preflight(generationId, document)
      .then((result) => this.completePreflight(generationId, result))
      .catch((error) => this.fail(generationId, error));
  }

  private clearGeneration(): void {
    this.generationId = null;
    this.projectSessionId = null;
    this.callbacks = null;
    this.canonicalDocument = null;
    this.lastRuntimeDocument = null;
    this.timedState = resetElectronicsTimedState();
    this.latestTarget = null;
    this.continuationTarget = null;
    this.inputTarget = null;
    this.pendingInputEvents = [];
    this.lastInputEventAtMicroseconds = -1;
    this.horizonOffsetMicroseconds = 0;
    this.inFlight = false;
    this.inFlightKind = null;
  }

  private retimePendingInputsAfterCommitted(
    committedMicroseconds: number,
    currentTargetMicroseconds: number,
  ): void {
    if (this.pendingInputEvents.length === 0) return;
    const earliestPendingMicrosecond = this.pendingInputEvents[0]!.atMicroseconds;
    const deltaMicroseconds = Math.max(0, committedMicroseconds + 1 - earliestPendingMicrosecond);
    if (deltaMicroseconds === 0) return;
    const retimed = this.pendingInputEvents.map((event) => ({
      ...event,
      atMicroseconds: event.atMicroseconds + deltaMicroseconds,
    }));
    this.pendingInputEvents = retimed;
    const lastEventMicrosecond = retimed[retimed.length - 1]!.atMicroseconds;
    this.lastInputEventAtMicroseconds = Math.max(
      this.lastInputEventAtMicroseconds,
      lastEventMicrosecond,
    );
    const observationCeiling = Math.max(
      lastEventMicrosecond,
      currentTargetMicroseconds,
      this.latestTarget?.requestedHorizonMicroseconds ?? 0,
      this.continuationTarget?.requestedHorizonMicroseconds ?? 0,
    );
    this.inputTarget = {
      requestedHorizonMicroseconds: boundedInputObservationHorizon(
        lastEventMicrosecond,
        observationCeiling,
      ),
    };
    if (this.latestTarget) {
      this.latestTarget = {
        requestedHorizonMicroseconds: Math.max(
          this.latestTarget.requestedHorizonMicroseconds,
          lastEventMicrosecond,
        ),
      };
    }
  }

  private pump(): void {
    const generationId = this.generationId;
    const document = this.canonicalDocument;
    const target = this.inputTarget ?? this.continuationTarget ?? this.latestTarget;
    if (generationId === null || !document || this.inFlight || !target) return;
    if (this.inputTarget) this.inputTarget = null;
    else if (this.continuationTarget) this.continuationTarget = null;
    else this.latestTarget = null;
    const inputEvents = this.pendingInputEvents;
    this.pendingInputEvents = [];
    this.inFlight = true;
    this.inFlightKind = 'advance';
    void this.executor
      .advance(
        generationId,
        document,
        this.timedState,
        target.requestedHorizonMicroseconds,
        inputEvents,
      )
      .then((advance) => this.completeAdvance(generationId, target, advance))
      .catch((error) => this.fail(generationId, error));
  }

  private completePreflight(generationId: number, result: SolveResult): void {
    if (generationId !== this.generationId) return;
    this.inFlight = false;
    this.inFlightKind = null;
    void result;
    this.pump();
  }

  private completeAdvance(
    generationId: number,
    target: SimulationTarget,
    advance: SimulationTimedAdvancePayload,
  ): void {
    if (generationId !== this.generationId) return;
    this.inFlight = false;
    this.inFlightKind = null;
    this.timedState = advance.state;
    if (advance.executionStatus === 'fault') {
      const message =
        advance.diagnostics
          .map((entry) => entry.message)
          .filter(Boolean)
          .join(' ') || 'Electronics canonical timed advance failed.';
      this.fail(generationId, new Error(message));
      return;
    }
    this.retimePendingInputsAfterCommitted(
      advance.committedHorizonMicroseconds,
      target.requestedHorizonMicroseconds,
    );
    if (advance.executionStatus === 'yielded') {
      this.continuationTarget = target;
      this.pump();
      return;
    }
    if (
      this.latestTarget &&
      this.latestTarget.requestedHorizonMicroseconds <= advance.committedHorizonMicroseconds
    ) {
      this.latestTarget = null;
    }
    if (
      this.continuationTarget &&
      this.continuationTarget.requestedHorizonMicroseconds <= advance.committedHorizonMicroseconds
    ) {
      this.continuationTarget = null;
    }
    if (!advance.result) {
      this.fail(generationId, new Error('Ready Electronics timed advance omitted its result.'));
      return;
    }
    if (this.pendingInputEvents.length === 0) this.callbacks?.onResult(advance.result);
    this.pump();
  }

  private fail(generationId: number, reason: unknown): void {
    if (generationId !== this.generationId) return;
    const callbacks = this.callbacks;
    const active = this.generationId !== null;
    this.clearGeneration();
    if (active) this.executor.cancelActiveGeneration();
    callbacks?.onFailure(
      reason instanceof Error ? reason : new Error('Electronics simulation Worker failed.'),
    );
  }
}
