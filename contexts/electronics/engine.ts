import {
  EMPTY_DOCUMENT,
  parseElectronicsDocument,
  type DocumentParseResult,
  type ElectronicsDocument,
} from './domain/document.js';
import {
  analyseCircuit,
  compileCircuit,
  type SimulationQuality,
  type SimulationResult,
  type SimulationStatus,
} from './domain/simulation.js';
import type { ComponentResult, Diagnostic, NodeResult } from './domain/solver.js';

export const ELECTRONICS_ENGINE_CONTRACT_VERSION = 1 as const;

export const ELECTRONICS_ENGINE_CAPABILITIES = [
  'parse-document',
  'prepare-topology',
  'analyse-snapshot',
] as const;

export type ElectronicsEngineCapability = (typeof ELECTRONICS_ENGINE_CAPABILITIES)[number];
export interface ElectronicsEngineDescriptor {
  readonly contractVersion: typeof ELECTRONICS_ENGINE_CONTRACT_VERSION;
  readonly documentSchemaVersion: ElectronicsDocument['schemaVersion'];
  readonly capabilities: readonly ElectronicsEngineCapability[];
}

export const ELECTRONICS_ENGINE_DESCRIPTOR: ElectronicsEngineDescriptor = Object.freeze({
  contractVersion: ELECTRONICS_ENGINE_CONTRACT_VERSION,
  documentSchemaVersion: EMPTY_DOCUMENT.schemaVersion,
  capabilities: ELECTRONICS_ENGINE_CAPABILITIES,
});

export type ElectronicsEngineDocument = ElectronicsDocument;
export type ElectronicsEngineDocumentParseResult = DocumentParseResult;

/** Canonical logical simulation time. Values are non-negative integer microseconds. */
export type ElectronicsCanonicalMicroseconds = number;

/**
 * One accepted append-only input event. Same-time events are ordered by their accepted array order,
 * never by host arrival timing.
 */
export interface ElectronicsTimedInputEvent {
  readonly atMicroseconds: ElectronicsCanonicalMicroseconds;
  readonly targetId: string;
  readonly operation: string;
  readonly payload: unknown;
}

/**
 * Stable serializable continuation envelope. The serialized state is engine-owned and opaque to
 * consumers so later scheduler convergence can preserve this public boundary.
 */
export interface ElectronicsTimedContinuation {
  readonly version: 1;
  readonly clockContractVersion: 1;
  readonly engineContractVersion: typeof ELECTRONICS_ENGINE_CONTRACT_VERSION;
  readonly clockProfileId: string;
  readonly documentDigest: string;
  readonly modelSetDigest: string;
  readonly committedHorizonMicroseconds: ElectronicsCanonicalMicroseconds;
  readonly serializedState: string;
}

export interface ElectronicsTimedAdvanceRequest {
  readonly requestedHorizonMicroseconds: ElectronicsCanonicalMicroseconds;
  readonly continuation?: ElectronicsTimedContinuation;
  /** Newly appended canonical events only; past events live inside the continuation. */
  readonly inputEvents?: readonly ElectronicsTimedInputEvent[];
  /** Optional bounded-work budget. It never changes the requested logical horizon. */
  readonly maxEvents?: number;
}

export interface ElectronicsTimedDiagnostic {
  readonly code: string;
  readonly message: string;
}

export type ElectronicsTimedAdvanceResult =
  | {
      readonly executionStatus: 'ready';
      readonly requestedHorizonMicroseconds: ElectronicsCanonicalMicroseconds;
      readonly committedHorizonMicroseconds: ElectronicsCanonicalMicroseconds;
      readonly continuation: ElectronicsTimedContinuation;
      readonly observation: ElectronicsSnapshotAnalysis;
      readonly diagnostics: readonly ElectronicsTimedDiagnostic[];
    }
  | {
      readonly executionStatus: 'yielded';
      readonly requestedHorizonMicroseconds: ElectronicsCanonicalMicroseconds;
      readonly committedHorizonMicroseconds: ElectronicsCanonicalMicroseconds;
      readonly continuation: ElectronicsTimedContinuation;
      readonly observation: null;
      readonly diagnostics: readonly ElectronicsTimedDiagnostic[];
    }
  | {
      readonly executionStatus: 'fault';
      readonly requestedHorizonMicroseconds: ElectronicsCanonicalMicroseconds;
      readonly committedHorizonMicroseconds: ElectronicsCanonicalMicroseconds;
      /** Last accepted continuation remains authoritative when a future advance faults. */
      readonly continuation: ElectronicsTimedContinuation | null;
      readonly observation: null;
      readonly diagnostics: readonly ElectronicsTimedDiagnostic[];
    };

export interface ElectronicsPreparedSnapshot {
  readonly topologySignature: string;
  readonly componentIds: readonly string[];
  readonly sourceIds: readonly string[];
  readonly unsupportedComponentIds: readonly string[];
  readonly netCount: number;
}
export interface ElectronicsSnapshotAnalysis {
  readonly solved: boolean;
  readonly status: SimulationStatus;
  readonly current: number;
  readonly components: readonly ComponentResult[];
  readonly nodes: readonly NodeResult[];
  readonly diagnostics: readonly Diagnostic[];
  readonly iterations: number;
  readonly numericalResidual: number;
  readonly numericalTolerance: number;
  readonly quality: SimulationQuality;
  readonly topologySignature: string;
  readonly simulationInputDigest: string;
  readonly solverRevision: SimulationResult['solverRevision'];
  readonly modelSetDigest: string;
  readonly analysis: SimulationResult['analysis'];
}

export function parseElectronicsEngineDocument(
  value: unknown,
): ElectronicsEngineDocumentParseResult {
  return parseElectronicsDocument(value);
}

export function prepareElectronicsSnapshot(
  document: ElectronicsEngineDocument,
): ElectronicsPreparedSnapshot {
  const compiled = compileCircuit(document);
  return {
    topologySignature: compiled.topologySignature,
    componentIds: compiled.componentIds,
    sourceIds: compiled.sourceIds,
    unsupportedComponentIds: compiled.unsupportedComponentIds,
    netCount: compiled.netlist.nodeCount,
  };
}

export function analyseElectronicsSnapshot(
  document: ElectronicsEngineDocument,
): ElectronicsSnapshotAnalysis {
  const result = analyseCircuit(document);
  return {
    solved: result.solved,
    status: result.status,
    current: result.current,
    components: result.components,
    nodes: result.nodes,
    diagnostics: result.diagnostics,
    iterations: result.iterations,
    numericalResidual: result.numericalResidual,
    numericalTolerance: result.numericalTolerance,
    quality: result.quality,
    topologySignature: result.topologySignature,
    simulationInputDigest: result.simulationInputDigest,
    solverRevision: result.solverRevision,
    modelSetDigest: result.modelSetDigest,
    analysis: result.analysis,
  };
}
