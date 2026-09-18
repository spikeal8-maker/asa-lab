import type {
  ElectronicsTimedDiagnostic,
  ElectronicsTimedInputEvent,
  ElectronicsTimedState,
} from '@asa-lab/electronics/engine';
import type { SchematicDocument, SolveResult } from '../api';

export const ELECTRONICS_SIMULATION_WORKER_PROTOCOL = 2 as const;
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
}

export interface SimulationAdvanceRequest extends SimulationWorkerRequestBase {
  readonly kind: 'advance';
  readonly document: SchematicDocument;
  readonly state: ElectronicsTimedState;
  readonly requestedHorizonMicroseconds: number;
  readonly inputEvents?: readonly ElectronicsTimedInputEvent[];
}

export interface SimulationCancelRequest extends SimulationWorkerRequestBase {
  readonly kind: 'cancel-generation';
}

export type ElectronicsSimulationWorkerRequest =
  SimulationPreflightRequest | SimulationAdvanceRequest | SimulationCancelRequest;

export interface SimulationTimedAdvancePayload {
  readonly executionStatus: 'ready' | 'yielded' | 'fault';
  readonly requestedHorizonMicroseconds: number;
  readonly committedHorizonMicroseconds: number;
  readonly state: ElectronicsTimedState;
  readonly result: SolveResult | null;
  readonly diagnostics: readonly ElectronicsTimedDiagnostic[];
}

export interface SimulationWorkerMetrics {
  readonly computeMs: number;
  readonly solverRevision: typeof ELECTRONICS_SIMULATION_ENGINE_REVISION;
  readonly executionStatus: 'preflight' | 'ready' | 'yielded' | 'fault';
  readonly requestedHorizonMicroseconds?: number;
  readonly committedHorizonMicroseconds?: number;
  readonly simulationInputDigest?: string;
  readonly topologySignature?: string;
}

interface SimulationWorkerResponseBase {
  readonly protocolVersion: typeof ELECTRONICS_SIMULATION_WORKER_PROTOCOL;
  readonly requestId: string;
  readonly generationId: number;
  readonly projectSessionId: string;
}

export type SimulationWorkerSuccessResponse =
  | (SimulationWorkerResponseBase & {
      readonly ok: true;
      readonly kind: 'preflight';
      readonly result: SolveResult;
      readonly metrics: SimulationWorkerMetrics;
    })
  | (SimulationWorkerResponseBase & {
      readonly ok: true;
      readonly kind: 'advance';
      readonly advance: SimulationTimedAdvancePayload;
      readonly metrics: SimulationWorkerMetrics;
    });

export type ElectronicsSimulationWorkerResponse =
  | SimulationWorkerSuccessResponse
  | (SimulationWorkerResponseBase & {
      readonly ok: false;
      readonly code:
        'protocol-mismatch' | 'solver-mismatch' | 'cancelled' | 'invalid-request' | 'internal';
      readonly message: string;
    });
