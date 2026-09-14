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
