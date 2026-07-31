export {
  EMPTY_DOCUMENT,
  DEFAULT_SIMULATION,
  DEFAULT_VIEWPORT,
  parseElectronicsDocument,
  terminalsForKind,
  type ComponentKind,
  type DocumentParseResult,
  type ElectronicsDocument,
  type ElectronicsViewport,
  type Rotation,
  type SchematicComponent,
  type SchematicConnection,
  type SimulationSettings,
  type Terminal,
  type TerminalRef,
} from './domain/document.js';
export { buildNetlist, terminalKey, type Netlist } from './domain/netlist.js';
export {
  solveCircuit,
  type ComponentResult,
  type Diagnostic,
  type DiagnosticCode,
  type DiagnosticSeverity,
  type NodeResult,
  type SolveResult,
} from './domain/solver.js';
export { ELECTRONICS_MODULE } from './module.js';
