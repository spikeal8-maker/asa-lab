import type { BooleanOperation, ThreeDNode } from '@asa-lab/three-d';

/** Serializable boundary between the editor and geometry evaluators. */
export const THREE_D_GEOMETRY_WORKER_PROTOCOL = 2 as const;
export const THREE_D_LEGACY_BSP_ENGINE = { id: 'legacy-bsp', version: '1' } as const;

export interface GeometryEngineIdentity {
  readonly id: typeof THREE_D_LEGACY_BSP_ENGINE.id;
  readonly version: string;
}

export interface GeometryEvaluateRequest {
  readonly protocolVersion: typeof THREE_D_GEOMETRY_WORKER_PROTOCOL;
  readonly requestId: string;
  readonly generationId: number;
  readonly kind: 'evaluate-boolean';
  readonly engine: GeometryEngineIdentity;
  readonly operation: BooleanOperation;
  readonly operands: readonly ThreeDNode[];
}

export interface GeometryCancelRequest {
  readonly protocolVersion: typeof THREE_D_GEOMETRY_WORKER_PROTOCOL;
  readonly requestId: string;
  readonly generationId: number;
  readonly kind: 'cancel-generation';
}

export type GeometryWorkerRequest = GeometryEvaluateRequest | GeometryCancelRequest;

export interface GeometryEvaluationMetrics {
  readonly engine: GeometryEngineIdentity;
  readonly computeMs: number;
  readonly triangleCount: number;
  readonly featureEdgeSegmentCount: number;
  readonly checksum: string;
  readonly bounds: {
    readonly min: readonly [number, number, number];
    readonly max: readonly [number, number, number];
  };
}

export type GeometryWorkerResponse =
  | {
      readonly protocolVersion: typeof THREE_D_GEOMETRY_WORKER_PROTOCOL;
      readonly requestId: string;
      readonly generationId: number;
      readonly ok: true;
      readonly positions: ArrayBuffer;
      readonly normals: ArrayBuffer;
      readonly featureEdges: ArrayBuffer;
      readonly metrics: GeometryEvaluationMetrics;
    }
  | {
      readonly protocolVersion: typeof THREE_D_GEOMETRY_WORKER_PROTOCOL;
      readonly requestId: string;
      readonly generationId: number;
      readonly ok: false;
      readonly code:
        'protocol-mismatch' | 'unsupported-engine' | 'invalid-geometry' | 'cancelled' | 'internal';
      readonly message: string;
    };

export interface EvaluatedBooleanGeometry {
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly featureEdges: Float32Array;
  readonly metrics: GeometryEvaluationMetrics;
}
