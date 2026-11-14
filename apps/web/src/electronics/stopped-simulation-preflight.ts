import { useLayoutEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { simulationInputDigest, simulationModelSetDigest } from '@asa-lab/electronics/simulation';
import type { SchematicDocument, SolveResult } from '../api';
import { workerFailure, type SimulationFailure } from './simulation-failure';
import { ElectronicsSimulationWorkerClient } from './simulation-worker-client';
import {
  ELECTRONICS_SIMULATION_ENGINE_REVISION,
  ELECTRONICS_SIMULATION_WORKER_PROTOCOL,
} from './simulation-worker-protocol';

/** Physical input deliberately excludes drawing geometry; Arduino source does not. */
export function stoppedSimulationInputKey(document: SchematicDocument): string {
  const programs = document.components
    .filter(
      (component) =>
        component.componentTypeId === 'arduino-uno' || component.variantId === 'arduino-uno',
    )
    .map((component) => [component.id, component.stateProperties?.arduinoSource ?? null] as const)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return JSON.stringify({
    electrical: simulationInputDigest(document, 0),
    programs,
    modelSet: simulationModelSetDigest(),
    engineRevision: ELECTRONICS_SIMULATION_ENGINE_REVISION,
    protocolVersion: ELECTRONICS_SIMULATION_WORKER_PROTOCOL,
  });
}

export interface StoppedSimulationPreflightSnapshot {
  readonly projectId: string | null;
  readonly projectSessionId: string | null;
  readonly inputKey: string | null;
  readonly key: string | null;
  readonly result: SolveResult | null;
  readonly pending: boolean;
  readonly error: SimulationFailure | null;
}

const EMPTY: StoppedSimulationPreflightSnapshot = {
  projectId: null,
  projectSessionId: null,
  inputKey: null,
  key: null,
  result: null,
  pending: false,
  error: null,
};
const MAX_ACCEPTED_RESULTS = 8;
let sessionSequence = 0;

interface ProjectSession {
  readonly projectId: string;
  readonly id: string;
  active: boolean;
  generation: number | null;
}

interface PreflightRequest {
  readonly session: ProjectSession;
  readonly document: SchematicDocument;
  readonly inputKey: string;
  readonly key: string;
}

/** One in-flight solve, one latest request, and only previously accepted cache entries. */
export class StoppedSimulationPreflightController {
  private session: ProjectSession | null = null;
  private requested: PreflightRequest | null = null;
  private inFlight: PreflightRequest | null = null;
  private queued: PreflightRequest | null = null;
  private readonly accepted = new Map<string, SolveResult>();
  private readonly listeners = new Set<() => void>();
  private snapshot = EMPTY;

  constructor(private readonly client = new ElectronicsSimulationWorkerClient()) {}

  readonly getSnapshot = (): StoppedSimulationPreflightSnapshot => this.snapshot;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  open(projectId: string): void {
    if (this.session?.active && this.session.projectId === projectId) return;
    this.close();
    this.session = {
      projectId,
      id: `${projectId}:stopped:${++sessionSequence}`,
      active: true,
      generation: null,
    };
  }

  close(): void {
    if (this.session) this.session.active = false;
    this.session = null;
    this.requested = null;
    this.inFlight = null;
    this.queued = null;
    this.accepted.clear();
    this.client.cancelActiveGeneration();
    if (this.snapshot !== EMPTY) this.publish(EMPTY);
  }

  update(document: SchematicDocument, inputKey = stoppedSimulationInputKey(document)): void {
    const session = this.session;
    if (!session?.active || this.requested?.inputKey === inputKey) return;
    const request: PreflightRequest = {
      session,
      document,
      inputKey,
      key: JSON.stringify([session.id, inputKey]),
    };
    // Object identity is the request nonce: an unfinished A in A -> B -> A is stale.
    this.requested = request;
    this.queued = null;
    const cached = this.accepted.get(request.key);
    if (cached) {
      this.accepted.delete(request.key);
      this.accepted.set(request.key, cached);
      this.publish(this.state(request, cached, false, null));
      return;
    }
    this.publish(this.state(request, null, true, null));
    if (this.inFlight) this.queued = request;
    else this.start(request);
  }

  private state(
    request: PreflightRequest,
    result: SolveResult | null,
    pending: boolean,
    error: SimulationFailure | null,
  ): StoppedSimulationPreflightSnapshot {
    return {
      projectId: request.session.projectId,
      projectSessionId: request.session.id,
      inputKey: request.inputKey,
      key: request.key,
      result,
      pending,
      error,
    };
  }

  private current(request: PreflightRequest): boolean {
    return request.session.active && this.session === request.session && this.requested === request;
  }

  private start(request: PreflightRequest): void {
    this.inFlight = request;
    void this.evaluate(request);
  }

  private async evaluate(request: PreflightRequest): Promise<void> {
    const session = request.session;
    try {
      const generation =
        session.generation ?? (session.generation = this.client.beginGeneration(session.id));
      const result = await this.client.preflight(generation, {
        ...request.document,
        simulation: { ...request.document.simulation, running: true },
      });
      if (!this.current(request) || !this.client.isCurrent(generation, session.id)) return;
      this.accepted.set(request.key, result);
      while (this.accepted.size > MAX_ACCEPTED_RESULTS) {
        const oldest = this.accepted.keys().next().value;
        if (oldest !== undefined) this.accepted.delete(oldest);
      }
      this.publish(this.state(request, result, false, null));
    } catch (reason) {
      if (this.session === session && session.active) {
        // A failed transport may be dead. A later/latest input gets a fresh Worker;
        // an obsolete failure never becomes the current project's diagnostic.
        session.generation = null;
        if (this.current(request))
          this.publish(this.state(request, null, false, workerFailure(reason)));
      }
    } finally {
      if (this.inFlight === request) {
        this.inFlight = null;
        const queued = this.queued;
        this.queued = null;
        if (queued && this.current(queued)) this.start(queued);
      }
    }
  }

  private publish(snapshot: StoppedSimulationPreflightSnapshot): void {
    this.snapshot = snapshot;
    for (const listener of this.listeners) listener();
  }
}

export function useStoppedSimulationPreflight(
  projectId: string,
  document: SchematicDocument | null,
  enabled: boolean,
): StoppedSimulationPreflightSnapshot {
  const [controller] = useState(() => new StoppedSimulationPreflightController());
  const active = enabled && document !== null;
  const inputKey = useMemo(
    () => (active && document ? stoppedSimulationInputKey(document) : null),
    [active, document],
  );
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  useLayoutEffect(() => {
    if (!active) {
      controller.close();
      return;
    }
    controller.open(projectId);
    return () => controller.close();
  }, [active, controller, projectId]);
  useLayoutEffect(() => {
    // Only committed inputs reach the Worker. An abandoned render cannot replace
    // the current request, invalidate its session, or publish a speculative edit.
    if (active && document && inputKey) controller.update(document, inputKey);
  }, [active, controller, document, inputKey, projectId]);
  return useMemo(
    () =>
      active && snapshot.projectId === projectId && snapshot.inputKey === inputKey
        ? snapshot
        : { ...EMPTY, projectId, inputKey, pending: active },
    [active, inputKey, projectId, snapshot],
  );
}
