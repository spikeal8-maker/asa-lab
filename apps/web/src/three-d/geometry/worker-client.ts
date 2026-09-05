import type { BooleanOperation, ThreeDNode } from '@asa-lab/three-d';
import {
  THREE_D_GEOMETRY_WORKER_PROTOCOL,
  THREE_D_LEGACY_BSP_ENGINE,
  type EvaluatedBooleanGeometry,
  type GeometryWorkerRequest,
  type GeometryWorkerResponse,
} from './worker-protocol';

export interface GeometryWorkerLike {
  onmessage: ((event: MessageEvent<GeometryWorkerResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
  postMessage(message: GeometryWorkerRequest): void;
  terminate(): void;
}

export type GeometryWorkerFactory = () => GeometryWorkerLike;

interface PendingEvaluation {
  readonly generationId: number;
  readonly resolve: (value: EvaluatedBooleanGeometry) => void;
  readonly reject: (reason: Error) => void;
  readonly timeout: ReturnType<typeof setTimeout>;
}

function defaultWorkerFactory(): GeometryWorkerLike {
  return new Worker(new URL('./geometry.worker.ts', import.meta.url), {
    type: 'module',
    name: 'asa-3d-geometry',
  });
}

export class GeometryWorkerClient {
  private worker: GeometryWorkerLike | null = null;
  private generationId = 0;
  private requestSequence = 0;
  private workerFailure: string | null = null;
  private readonly pending = new Map<string, PendingEvaluation>();

  constructor(
    private readonly workerFactory: GeometryWorkerFactory = defaultWorkerFactory,
    // A recovery deadline, not a responsiveness target. It also bounds a lost
    // response when the browser cannot report a Worker startup failure.
    private readonly requestTimeoutMs = 30_000,
  ) {}

  beginGeneration(): number {
    this.stopActiveGeneration('Geometry evaluation was superseded by a newer document.');
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
            error instanceof Error ? error.message : 'Invalid Worker response.',
          );
        }
      };
      worker.onerror = (event) => {
        this.failWorker(worker, event.message || 'Geometry Worker failed.');
      };
      worker.onmessageerror = () => {
        this.failWorker(worker, 'Geometry Worker response could not be decoded.');
      };
    } catch (error) {
      // Keep the generation current so the scene can finish with diagnostics
      // rather than tearing down the viewport because Worker creation threw.
      this.workerFailure =
        error instanceof Error ? error.message : 'Geometry Worker could not start.';
    }
    return this.generationId;
  }

  cancelActiveGeneration(): void {
    this.stopActiveGeneration(
      'Geometry evaluation was cancelled because no Boolean groups remain.',
    );
  }

  evaluate(
    generationId: number,
    operands: readonly ThreeDNode[],
    operation: BooleanOperation,
  ): Promise<EvaluatedBooleanGeometry> {
    if (generationId !== this.generationId) {
      return Promise.reject(new Error('Geometry generation is no longer active.'));
    }
    if (!this.worker) {
      return Promise.reject(
        new Error(this.workerFailure ?? 'Geometry generation is no longer active.'),
      );
    }
    const worker = this.worker;
    const requestId = `geometry-${generationId}-${++this.requestSequence}`;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.failWorker(worker, `Geometry Worker timed out after ${this.requestTimeoutMs} ms.`);
      }, this.requestTimeoutMs);
      this.pending.set(requestId, { generationId, resolve, reject, timeout });
      try {
        worker.postMessage({
          protocolVersion: THREE_D_GEOMETRY_WORKER_PROTOCOL,
          requestId,
          generationId,
          kind: 'evaluate-boolean',
          engine: THREE_D_LEGACY_BSP_ENGINE,
          operation,
          operands,
        });
      } catch (error) {
        this.failWorker(
          worker,
          error instanceof Error ? error.message : 'Geometry request could not be sent.',
        );
      }
    });
  }

  isCurrent(generationId: number): boolean {
    return generationId === this.generationId;
  }

  dispose(): void {
    this.stopActiveGeneration('Geometry Worker was disposed.');
  }

  private stopActiveGeneration(message: string): void {
    const previousGeneration = this.generationId;
    this.generationId += 1;
    this.rejectPending(message);
    if (this.worker) {
      const worker = this.worker;
      try {
        worker.postMessage({
          protocolVersion: THREE_D_GEOMETRY_WORKER_PROTOCOL,
          requestId: `cancel-${previousGeneration}`,
          generationId: previousGeneration,
          kind: 'cancel-generation',
        });
      } catch {
        // Cancellation is best-effort messaging; termination below is what
        // actually interrupts synchronous BSP computation in the Worker.
      } finally {
        this.releaseWorker();
      }
    }
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

  private failWorker(worker: GeometryWorkerLike, message: string): void {
    if (this.worker !== worker) return;
    this.workerFailure = message;
    this.rejectPending(message);
    this.releaseWorker();
  }

  private handleMessage(response: GeometryWorkerResponse): void {
    const pending = this.pending.get(response.requestId);
    if (!pending) return;
    this.pending.delete(response.requestId);
    clearTimeout(pending.timeout);
    if (
      response.protocolVersion !== THREE_D_GEOMETRY_WORKER_PROTOCOL ||
      response.generationId !== pending.generationId ||
      response.generationId !== this.generationId
    ) {
      pending.reject(new Error('Stale Geometry Worker response was discarded.'));
      return;
    }
    if (!response.ok) {
      pending.reject(new Error(`${response.code}: ${response.message}`));
      return;
    }
    try {
      pending.resolve({
        resultKind: response.resultKind,
        positions: new Float32Array(response.positions),
        normals: new Float32Array(response.normals),
        featureEdges: new Float32Array(response.featureEdges),
        metrics: response.metrics,
      });
    } catch (error) {
      pending.reject(error instanceof Error ? error : new Error('Invalid Worker buffers.'));
      throw error;
    }
  }

  private rejectPending(message: string): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error(message));
    }
    this.pending.clear();
  }
}
