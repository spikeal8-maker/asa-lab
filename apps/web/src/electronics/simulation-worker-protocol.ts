import type { SchematicDocument, SolveResult } from '../api';

export const ELECTRONICS_SIMULATION_WORKER_PROTOCOL = 1 as const;
export const ELECTRONICS_SIMULATION_ENGINE_REVISION = 'asa-electronics-solver-v21' as const;

interface SimulationWorkerRequestBase {
  readonly protocolVersion: typeof ELECTRONICS_SIMULATION_WORKER_PROTOCOL;
  readonly engineRevision: typeof ELECTRONICS_SIMULATION_ENGINE_REVISION;
  readonly requestId: string;
  readonly generationId: number;
  readonly projectSessionId: string;
}

export interface SimulationPreflightRequest extends SimulationWorkerRequestBase {
  readonly kind: 'preflight';
  readonly document: SchematicDocument;
  readonly simulationTimeMs: number;
}

export interface SimulationAdvanceRequest extends SimulationWorkerRequestBase {
  readonly kind: 'advance';
  readonly document: SchematicDocument;
  readonly previousResult: SolveResult | null;
  readonly simulationTimeMs: number;
}

export interface SimulationCancelRequest extends SimulationWorkerRequestBase {
  readonly kind: 'cancel-generation';
}

export type ElectronicsSimulationWorkerRequest =
  SimulationPreflightRequest | SimulationAdvanceRequest | SimulationCancelRequest;

export interface SimulationWorkerMetrics {
  readonly computeMs: number;
  readonly solverRevision: typeof ELECTRONICS_SIMULATION_ENGINE_REVISION;
  readonly simulationInputDigest: string;
  readonly topologySignature: string;
  readonly status: SolveResult['status'];
}

interface SimulationWorkerResponseBase {
  readonly protocolVersion: typeof ELECTRONICS_SIMULATION_WORKER_PROTOCOL;
  readonly requestId: string;
  readonly generationId: number;
  readonly projectSessionId: string;
}

export type ElectronicsSimulationWorkerResponse =
  | (SimulationWorkerResponseBase & {
      readonly ok: true;
      readonly result: SolveResult;
      readonly metrics: SimulationWorkerMetrics;
    })
  | (SimulationWorkerResponseBase & {
      readonly ok: false;
      readonly code:
        'protocol-mismatch' | 'solver-mismatch' | 'cancelled' | 'invalid-request' | 'internal';
      readonly message: string;
    });
