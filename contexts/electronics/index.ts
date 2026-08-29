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
  canonicalSimulationInput,
  sha256Hex,
  simulationInputDigest,
  SIMULATION_INPUT_DIGEST_VERSION,
} from './domain/simulation-input-digest.js';
export {
  ledBrightnessPercent,
  ledForwardVoltageAtCurrent,
  ordinaryLedProfile,
  rgbLedProfile,
  ORDINARY_LED_PROFILES,
  RGB_LED_PROFILES,
  type LedJunctionProfile,
  type OrdinaryLedColour,
  type RgbLedChannel,
} from './domain/led-model.js';
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
  electricalModelFor,
  unsupportedElectricalComponents,
  validateElectricalTerminalContract,
  type ElectricalModelDescriptor,
  type ElectricalModelId,
  type ElectricalModelSupport,
  type ElectricalTerminalContractResult,
} from './domain/model-registry.js';
export type {
  DcStampContext,
  DeviceModel,
  IterativeDcDeviceModel,
  IterativeDcStampContext,
  ModelIssue,
  NormalizedDevice,
} from './domain/models/device-model.js';
export {
  createLinearDcDevice,
  isResistorDevice,
  isSourceDevice,
  resistorPowerRatingWatt,
  sourceContinuousCurrentAmp,
  RESISTOR_DEVICE_MODEL,
  SOURCE_DEVICE_MODEL,
  type LinearDcDevice,
  type ResistorParameters,
  type SourceParameters,
} from './domain/models/linear-dc-models.js';
export {
  canonicalNpnDcProfileRegistry,
  classifyNpnOperatingRegion,
  createNpnDcDevice,
  NPN_DC_PROFILES,
  NPN_DEVICE_MODEL,
  type NpnDcDevice,
  type NpnIterationState,
  type NpnObservation,
  type NpnOperatingPoint,
  type NpnOperatingRegion,
  type NpnParameters,
  type NpnProfile,
  type NpnStressState,
} from './domain/models/npn-dc-model.js';
export {
  photoresistorIllumination,
  photoresistorResistanceOhm,
  PHOTORESISTOR_BRIGHT_RESISTANCE_OHM,
  PHOTORESISTOR_DARK_RESISTANCE_OHM,
  PHOTORESISTOR_DEFAULT_ILLUMINATION,
} from './domain/photoresistor-model.js';
export {
  solveCircuit,
  sourceInternalResistanceOhm,
  type ComponentResult,
  type DamageState,
  type Diagnostic,
  type DiagnosticAnchor,
  type DiagnosticCode,
  type DiagnosticSeverity,
  type DeviceHealth,
  type NodeResult,
  type PresentationState,
  type SimulationSolveStatus,
  type SolveResult,
} from './domain/solver.js';
export type {
  CapacitorTransientState,
  CapacitorTransientStateEntry,
  ThermalTransientStateEntry,
  TransientFailureMode,
} from './domain/models/capacitor-transient-model.js';
export {
  analyseCircuit,
  compileCircuit,
  type CompiledCircuit,
  type CompiledNet,
  type SimulationQuality,
  type SimulationResult,
  type SimulationOptions,
  type SimulationStatus,
} from './domain/simulation.js';
export { ELECTRONICS_MODULE } from './module.js';
