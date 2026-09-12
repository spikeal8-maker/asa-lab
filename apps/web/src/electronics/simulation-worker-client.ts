import type { SchematicDocument, SolveResult } from '../api';
import {
  ELECTRONICS_SIMULATION_ENGINE_REVISION,
  ELECTRONICS_SIMULATION_WORKER_PROTOCOL,
  type ElectronicsSimulationWorkerRequest,
  type ElectronicsSimulationWorkerResponse,
  type SimulationAdvanceRequest,
  type SimulationPreflightRequest,
} from './simulation-worker-protocol';

export interface ElectronicsSimulationWorkerLike {
  onmessage: ((event: MessageEvent<ElectronicsSimulationWorkerResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
  postMessage(message: ElectronicsSimulationWorkerRequest): void;
  terminate(): void;
}

export type ElectronicsSimulationWorkerFactory = () => ElectronicsSimulationWorkerLike;

interface PendingSimulation {
  readonly generationId: number;
  readonly projectSessionId: string;
  readonly resolve: (value: SolveResult) => void;
  readonly reject: (reason: Error) => void;
  readonly timeout: ReturnType<typeof setTimeout>;
}

function defaultWorkerFactory(): ElectronicsSimulationWorkerLike {
  return new Worker(new URL('./simulation.worker.ts', import.meta.url), {
    type: 'module',
    name: 'asa-electronics-simulation',
  });
}

type EvaluationRequest = SimulationPreflightRequest | SimulationAdvanceRequest;

export class ElectronicsSimulationWorkerClient {
  private worker: ElectronicsSimulationWorkerLike | null = null;
  private generationId = 0;
  private requestSequence = 0;
  private projectSessionId: string | null = null;
  private workerFailure: string | null = null;
  private readonly pending = new Map<string, PendingSimulation>();

  constructor(
    private readonly workerFactory: ElectronicsSimulationWorkerFactory = defaultWorkerFactory,
    private readonly requestTimeoutMs = 30_000,
  ) {}

  beginGeneration(projectSessionId: string): number {
    this.stopActiveGeneration('Electronics simulation was superseded by a newer document.');
    this.projectSessionId = projectSessionId;
    this.workerFailure = null;
    try {
      const worker = this.workerFactory();
      this.worker = worker;
      worker.onmessage = (event) => {
        if (this.worker !== worker) return;
        try {
          this.handleMessage(event.data);
        } catch (error) {
          this.failWorker(
            worker,
            error instanceof Error ? error.message : 'Invalid Electronics Worker response.',
          );
        }
      };
      worker.onerror = (event) => {
        this.failWorker(worker, event.message || 'Electronics Worker failed.');
      };
      worker.onmessageerror = () => {
        this.failWorker(worker, 'Electronics Worker response could not be decoded.');
      };
    } catch (error) {
      this.workerFailure =
        error instanceof Error ? error.message : 'Electronics Worker could not start.';
    }
    return this.generationId;
  }

  preflight(
    generationId: number,
    document: SchematicDocument,
    simulationTimeMs = 0,
  ): Promise<SolveResult> {
    try {
      return this.send({
        ...this.requestBase(generationId),
        kind: 'preflight',
        document,
        simulationTimeMs,
      });
    } catch (error) {
      return Promise.reject(
        error instanceof Error ? error : new Error('Electronics request failed.'),
      );
    }
  }

  advance(
    generationId: number,
    document: SchematicDocument,
    previousResult: SolveResult | null,
    simulationTimeMs: number,
  ): Promise<SolveResult> {
    try {
      return this.send({
        ...this.requestBase(generationId),
        kind: 'advance',
        document,
        previousResult,
        simulationTimeMs,
      });
    } catch (error) {
      return Promise.reject(
        error instanceof Error ? error : new Error('Electronics request failed.'),
      );
    }
  }

  isCurrent(generationId: number, projectSessionId?: string): boolean {
    return (
      generationId === this.generationId &&
      (projectSessionId === undefined || projectSessionId === this.projectSessionId)
    );
  }

  cancelActiveGeneration(): void {
    this.stopActiveGeneration('Electronics simulation was cancelled.');
  }

  dispose(): void {
    this.stopActiveGeneration('Electronics Worker was disposed.');
  }

  private requestBase(generationId: number): {
    protocolVersion: typeof ELECTRONICS_SIMULATION_WORKER_PROTOCOL;
    engineRevision: typeof ELECTRONICS_SIMULATION_ENGINE_REVISION;
    requestId: string;
    generationId: number;
    projectSessionId: string;
  } {
    if (generationId !== this.generationId || !this.projectSessionId) {
      throw new Error('Electronics simulation generation is no longer active.');
    }
    return {
      protocolVersion: ELECTRONICS_SIMULATION_WORKER_PROTOCOL,
      engineRevision: ELECTRONICS_SIMULATION_ENGINE_REVISION,
      requestId: `electronics-${generationId}-${++this.requestSequence}`,
      generationId,
      projectSessionId: this.projectSessionId,
    };
  }

  private send(request: EvaluationRequest): Promise<SolveResult> {
    if (!this.worker) {
      return Promise.reject(
        new Error(this.workerFailure ?? 'Electronics simulation generation is no longer active.'),
      );
    }
    const worker = this.worker;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.failWorker(worker, `Electronics Worker timed out after ${this.requestTimeoutMs} ms.`);
      }, this.requestTimeoutMs);
      this.pending.set(request.requestId, {
        generationId: request.generationId,
        projectSessionId: request.projectSessionId,
        resolve,
        reject,
        timeout,
      });
      try {
        worker.postMessage(request);
      } catch (error) {
        this.failWorker(
          worker,
          error instanceof Error ? error.message : 'Electronics request could not be sent.',
        );
      }
    });
  }

  private stopActiveGeneration(message: string): void {
    const previousGeneration = this.generationId;
    const previousSession = this.projectSessionId;
    this.generationId += 1;
    this.rejectPending(message);
    if (this.worker) {
      const worker = this.worker;
      try {
        if (previousSession) {
          worker.postMessage({
            protocolVersion: ELECTRONICS_SIMULATION_WORKER_PROTOCOL,
            engineRevision: ELECTRONICS_SIMULATION_ENGINE_REVISION,
            requestId: `cancel-${previousGeneration}-${++this.requestSequence}`,
            generationId: previousGeneration,
            projectSessionId: previousSession,
            kind: 'cancel-generation',
          });
        }
      } catch {
        // Best effort only. terminate() below is the actual interruption boundary.
      } finally {
        this.releaseWorker();
      }
    }
    this.projectSessionId = null;
  }

  private releaseWorker(): void {
    const worker = this.worker;
    this.worker = null;
    if (!worker) return;
    worker.onmessage = null;
    worker.onerror = null;
    worker.onmessageerror = null;
    worker.terminate();
  }

  private failWorker(worker: ElectronicsSimulationWorkerLike, message: string): void {
    if (this.worker !== worker) return;
    this.workerFailure = message;
    this.rejectPending(message);
    this.releaseWorker();
  }

  private handleMessage(response: ElectronicsSimulationWorkerResponse): void {
    const pending = this.pending.get(response.requestId);
    if (!pending) return;
    this.pending.delete(response.requestId);
    clearTimeout(pending.timeout);

    if (
      response.protocolVersion !== ELECTRONICS_SIMULATION_WORKER_PROTOCOL ||
      response.generationId !== pending.generationId ||
      response.projectSessionId !== pending.projectSessionId ||
      response.generationId !== this.generationId ||
      response.projectSessionId !== this.projectSessionId
    ) {
      pending.reject(new Error('Stale Electronics Worker response was discarded.'));
      return;
    }
    if (!response.ok) {
      pending.reject(new Error(`${response.code}: ${response.message}`));
      return;
    }
    if (response.result.solverRevision !== ELECTRONICS_SIMULATION_ENGINE_REVISION) {
      pending.reject(new Error('Electronics Worker returned an unexpected solver revision.'));
      return;
    }
    pending.resolve(response.result);
  }

  private rejectPending(message: string): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error(message));
    }
    this.pending.clear();
  }
}
