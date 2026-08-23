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
  type ProductionStateValue,
  type Rotation,
  type SchematicComponent,
  type SchematicConnection,
  type SimulationSettings,
  type Terminal,
  type TerminalRef,
} from './domain/document.js';
export type { ElectronicsDocument as SchematicDocument } from './domain/document.js';
export { buildNetlist, terminalKey, type Netlist } from './domain/netlist.js';
export {
  ledBrightnessPercent,
  ordinaryLedProfile,
  rgbLedProfile,
  ORDINARY_LED_PROFILES,
  RGB_LED_PROFILES,
  type LedJunctionProfile,
  type OrdinaryLedColour,
  type RgbLedChannel,
} from './domain/led-model.js';
export {
  electricalModelFor,
  unsupportedElectricalComponents,
  validateElectricalTerminalContract,
  type ElectricalModelDescriptor,
  type ElectricalModelId,
  type ElectricalModelSupport,
  type ElectricalTerminalContractResult,
} from './domain/model-registry.js';
export {
  photoresistorIllumination,
  photoresistorResistanceOhm,
  PHOTORESISTOR_BRIGHT_RESISTANCE_OHM,
  PHOTORESISTOR_DARK_RESISTANCE_OHM,
  PHOTORESISTOR_DEFAULT_ILLUMINATION,
} from './domain/photoresistor-model.js';
export {
  solveCircuit,
  type ComponentResult,
  type Diagnostic,
  type DiagnosticAnchor,
  type DiagnosticCode,
  type DiagnosticSeverity,
  type NodeResult,
  type SimulationSolveStatus,
  type SolveResult,
} from './domain/solver.js';
export {
  analyseCircuit,
  compileCircuit,
  type CompiledCircuit,
  type CompiledNet,
  type SimulationQuality,
  type SimulationResult,
  type SimulationStatus,
} from './domain/simulation.js';
export { ELECTRONICS_MODULE } from './module.js';
