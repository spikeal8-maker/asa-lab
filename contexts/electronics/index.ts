export {
  BREADBOARD_CENTER_GAP_MM,
  BREADBOARD_HOLE_PITCH_MM,
  areBreadboardHolesConnected,
  breadboardBusMembers,
  breadboardHole,
  createBreadboardDefinition,
  expectedBreadboardTiePointCount,
  type BreadboardDefinition,
  type BreadboardEvidence,
  type BreadboardHole,
  type BreadboardHoleRegion,
  type BreadboardKind,
  type BreadboardRailId,
  type BreadboardTerminalRow,
} from './domain/breadboard.js';
export {
  COMPONENT_VALUE_MODELS,
  componentValueError,
  isNominalComponentValue,
  type ComponentValueModel,
} from './domain/component-model.js';
export {
  EMPTY_DOCUMENT,
  parseElectronicsDocument,
  type ComponentKind,
  type DocumentParseResult,
  type ElectronicsDocument,
  type ElectronicsGeometryProfile,
  type SchematicComponent,
  type SchematicConnection,
  type Terminal,
} from './domain/document.js';
export { buildNetlist, terminalKey, type Netlist } from './domain/netlist.js';
export {
  solveCircuit,
  type ComponentResult,
  type Diagnostic,
  type DiagnosticCode,
  type DiagnosticSeverity,
  type SolveResult,
} from './domain/solver.js';
