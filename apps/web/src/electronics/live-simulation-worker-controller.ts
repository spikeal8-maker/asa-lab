import type { SchematicDocument, SolveResult } from '../api';
import { ElectronicsSimulationWorkerClient } from './simulation-worker-client';

export interface ElectronicsSimulationWorkerExecutor {
  beginGeneration(projectSessionId: string): number;
  preflight(
    generationId: number,
    document: SchematicDocument,
    simulationTimeMs?: number,
  ): Promise<SolveResult>;
  advance(
    generationId: number,
    document: SchematicDocument,
    previousResult: SolveResult | null,
    simulationTimeMs: number,
  ): Promise<SolveResult>;
  cancelActiveGeneration(): void;
  dispose(): void;
}

export interface LiveSimulationWorkerCallbacks {
  readonly onResult: (result: SolveResult) => void;
  readonly onFailure: (error: Error) => void;
}

interface SimulationTarget {
  readonly document: SchematicDocument;
  readonly simulationTimeMs: number;
}
export class ElectronicsLiveSimulationWorkerController {
  private generationId: number | null = null;
  private callbacks: LiveSimulationWorkerCallbacks | null = null;
  private latestTarget: SimulationTarget | null = null;
  private previousResult: SolveResult | null = null;
  private inFlightDocument: SchematicDocument | null = null;
  private inFlight = false;

  constructor(
    private readonly executor: ElectronicsSimulationWorkerExecutor = new ElectronicsSimulationWorkerClient(),
  ) {}

  start(
    projectSessionId: string,
    document: SchematicDocument,
    callbacks: LiveSimulationWorkerCallbacks,
  ): void {
    this.stop();
    this.callbacks = callbacks;
    this.latestTarget = null;
    this.previousResult = null;
    const generationId = this.executor.beginGeneration(projectSessionId);
    this.generationId = generationId;
    this.inFlightDocument = document;
    this.inFlight = true;
    void this.executor
      .preflight(generationId, document, 0)
      .then((result) => this.complete(generationId, result))
      .catch((error) => this.fail(generationId, error));
  }

  update(document: SchematicDocument, simulationTimeMs: number): void {
    if (this.generationId === null || !Number.isFinite(simulationTimeMs)) return;
    if (
      this.inFlight &&
      simulationTimeMs === 0 &&
      document === this.inFlightDocument &&
      this.latestTarget === null
    ) {
      return;
    }
    this.latestTarget = { document, simulationTimeMs };
    this.pump();
  }

  stop(): void {
    const active = this.generationId !== null;
    this.generationId = null;
    this.callbacks = null;
    this.latestTarget = null;
    this.previousResult = null;
    this.inFlightDocument = null;
    this.inFlight = false;
    if (active) this.executor.cancelActiveGeneration();
  }

  dispose(): void {
    this.generationId = null;
    this.callbacks = null;
    this.latestTarget = null;
    this.previousResult = null;
    this.inFlightDocument = null;
    this.inFlight = false;
    this.executor.dispose();
  }
  private pump(): void {
    const generationId = this.generationId;
    if (generationId === null || this.inFlight || !this.latestTarget) return;
    const target = this.latestTarget;
    this.latestTarget = null;
    this.inFlightDocument = target.document;
    this.inFlight = true;
    void this.executor
      .advance(generationId, target.document, this.previousResult, target.simulationTimeMs)
      .then((result) => this.complete(generationId, result))
      .catch((error) => this.fail(generationId, error));
  }

  private complete(generationId: number, result: SolveResult): void {
    if (generationId !== this.generationId) return;
    const completedDocument = this.inFlightDocument;
    this.previousResult = result;
    this.inFlightDocument = null;
    this.inFlight = false;
    const supersededByDocumentChange =
      this.latestTarget !== null && this.latestTarget.document !== completedDocument;
    if (!supersededByDocumentChange) this.callbacks?.onResult(result);
    this.pump();
  }

  private fail(generationId: number, reason: unknown): void {
    if (generationId !== this.generationId) return;
    const callbacks = this.callbacks;
    this.generationId = null;
    this.callbacks = null;
    this.latestTarget = null;
    this.previousResult = null;
    this.inFlightDocument = null;
    this.inFlight = false;
    this.executor.cancelActiveGeneration();
    callbacks?.onFailure(
      reason instanceof Error ? reason : new Error('Electronics simulation Worker failed.'),
    );
  }
}
