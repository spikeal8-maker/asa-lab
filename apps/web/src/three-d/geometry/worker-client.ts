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
  postMessage(message: GeometryWorkerRequest): void;
  terminate(): void;
}

export type GeometryWorkerFactory = () => GeometryWorkerLike;

interface PendingEvaluation {
  readonly generationId: number;
  readonly resolve: (value: EvaluatedBooleanGeometry) => void;
  readonly reject: (reason: Error) => void;
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
  private readonly pending = new Map<string, PendingEvaluation>();

  constructor(private readonly workerFactory: GeometryWorkerFactory = defaultWorkerFactory) {}

  beginGeneration(): number {
    this.stopActiveGeneration('Geometry evaluation was superseded by a newer document.');
    const worker = this.workerFactory();
    this.worker = worker;
    worker.onmessage = (event) => {
      if (this.worker !== worker) return;
      this.handleMessage(event.data);
    };
    worker.onerror = (event) => {
      if (this.worker !== worker) return;
      this.rejectPending(event.message || 'Geometry Worker failed.');
    };
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
    if (!this.worker || generationId !== this.generationId) {
      return Promise.reject(new Error('Geometry generation is no longer active.'));
    }
    const requestId = `geometry-${generationId}-${++this.requestSequence}`;
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { generationId, resolve, reject });
      this.worker?.postMessage({
        protocolVersion: THREE_D_GEOMETRY_WORKER_PROTOCOL,
        requestId,
        generationId,
        kind: 'evaluate-boolean',
        engine: THREE_D_LEGACY_BSP_ENGINE,
        operation,
        operands,
      });
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
    if (this.worker) {
      const worker = this.worker;
      worker.onmessage = null;
      worker.onerror = null;
      worker.postMessage({
        protocolVersion: THREE_D_GEOMETRY_WORKER_PROTOCOL,
        requestId: `cancel-${previousGeneration}`,
        generationId: previousGeneration,
        kind: 'cancel-generation',
      });
      worker.terminate();
      this.worker = null;
    }
    this.rejectPending(message);
  }

  private handleMessage(response: GeometryWorkerResponse): void {
    const pending = this.pending.get(response.requestId);
    if (!pending) return;
    this.pending.delete(response.requestId);
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
    pending.resolve({
      positions: new Float32Array(response.positions),
      normals: new Float32Array(response.normals),
      featureEdges: new Float32Array(response.featureEdges),
      metrics: response.metrics,
    });
  }

  private rejectPending(message: string): void {
    for (const pending of this.pending.values()) pending.reject(new Error(message));
    this.pending.clear();
  }
}
