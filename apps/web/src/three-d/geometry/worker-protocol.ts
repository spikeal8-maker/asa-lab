/** Reserved message boundary for the later, owner-activated Manifold/WASM
 * milestone. M0 intentionally has no boolean engine or worker implementation;
 * keeping the transport serialisable prevents Three.js or WASM instances from
 * leaking into the persisted project document. */
export const THREE_D_GEOMETRY_WORKER_PROTOCOL = 1 as const;

export interface GeometryWorkerRequest {
  readonly protocolVersion: typeof THREE_D_GEOMETRY_WORKER_PROTOCOL;
  readonly requestId: string;
  readonly kind: 'evaluate-boolean';
  readonly operation: 'union' | 'difference' | 'intersection';
  readonly operandNodeIds: readonly string[];
  readonly documentRevision: number;
}

export type GeometryWorkerResponse =
  | {
      readonly protocolVersion: typeof THREE_D_GEOMETRY_WORKER_PROTOCOL;
      readonly requestId: string;
      readonly ok: true;
      readonly positions: ArrayBuffer;
      readonly indices: ArrayBuffer;
    }
  | {
      readonly protocolVersion: typeof THREE_D_GEOMETRY_WORKER_PROTOCOL;
      readonly requestId: string;
      readonly ok: false;
      readonly code: 'unsupported' | 'invalid-geometry' | 'cancelled' | 'internal';
      readonly message: string;
    };
