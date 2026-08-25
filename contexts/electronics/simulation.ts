export type {
  ComponentKind,
  ElectronicsDocument,
  ElectronicsViewport,
  Rotation,
  SchematicComponent,
  SchematicConnection,
  SimulationSettings,
  Terminal,
  TerminalRef,
} from './domain/document.js';
export { buildNetlist, terminalKey, type Netlist } from './domain/netlist.js';
export {
  canonicalElectricalModelRegistry,
  componentModelIdentityIsInstalled,
  electricalModelIdentityForComponent,
  electricalModelRegistryEntries,
  isKnownElectricalModelId,
  resolveElectricalModelIdentity,
  ELECTRICAL_MODEL_REGISTRY_VERSION,
  type ElectricalModelIdentity,
  type ElectricalModelRegistryEntry,
} from './domain/model-identity.js';
export {
  canonicalSimulationInput,
  sha256Hex,
  simulationInputDigest,
  SIMULATION_INPUT_DIGEST_VERSION,
} from './domain/simulation-input-digest.js';
export {
  analyseCircuit,
  compileCircuit,
  type CompiledCircuit,
  type CompiledNet,
  type SimulationQuality,
  type SimulationResult,
  type SimulationStatus,
} from './domain/simulation.js';
export type {
  ComponentResult,
  Diagnostic,
  DiagnosticAnchor,
  DiagnosticCode,
  DiagnosticSeverity,
  NodeResult,
  SimulationSolveStatus,
  SolveResult,
} from './domain/solver.js';
