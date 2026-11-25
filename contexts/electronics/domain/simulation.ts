import {
  finishElectricalQuality,
  kclTolerance,
  powerTolerance,
  preparedNumbersFinite,
  logicalTerminal,
  KCL_TOLERANCE_A,
  SOURCE_VOLTAGE_TOLERANCE_V,
  MIN_POWER_BALANCE_TOLERANCE_W,
  type SimulationQuality,
} from './electrical-solution-quality.js';
export {
  createArduinoCheckpointQuality,
  type SimulationQuality,
} from './electrical-solution-quality.js';
import { type ElectronicsDocument, type SchematicComponent, type Terminal } from './document.js';
import {
  arduinoOutputBranchesFromSnapshot,
  arduinoSnapshotFromState,
  isArduinoUno,
} from './arduino-model.js';
import { copyNumericalNode, numericalShuntPowerWatt } from './numerical-shunt-power.js';
import { buildNetlist, terminalKey, type Netlist } from './netlist.js';
import { createL298nArduinoCurrentSampler } from './models/l298n-pwm-model.js';
import { L298N_BOARD_PROFILE } from './models/l298n-dc-model.js';
import { canonicalElectricalModelRegistry } from './model-identity.js';
import { canonicalPhotoresistorProfileRegistry } from './photoresistor-model.js';
import { TMP36_PROFILE } from './models/tmp36-dc-model.js';
import { SOIL_MOISTURE_PROFILE } from './models/soil-moisture-model.js';
import { SEVEN_SEGMENT_TERMINALS } from './led-model.js';
import { electricalModelFor } from './model-registry.js';
import { canonicalNonlinearDcProfileRegistry } from './models/nonlinear-dc-models.js';
import {
  solveCircuit,
  takeArduinoQualityReceipt,
  arduinoQualityDictionaryKeys,
  releaseArduinoQualityReceipt,
  ELECTRICAL_EVENT_FRAME_VERSION,
  transistorTypeOf,
  type ComponentResult,
  type Diagnostic,
  type ArduinoControllerState,
  type SolveResult,
} from './solver.js';
import { sha256Hex, simulationInputDigest } from './simulation-input-digest.js';
import {
  isElectrolyticCapacitor,
  type CapacitorTransientState,
} from './models/capacitor-transient-model.js';
import { canonicalBrushedMotorProfileRegistry } from './models/brushed-motor-profiles.js';
import { BRUSHED_MOTOR_TRANSIENT_MODEL_VERSION } from './models/brushed-motor-transient-model.js';
import { canonicalRegulatedPowerSupplyProfileRegistry } from './models/regulated-power-supply-model.js';
import { canonicalPiezoAudioProfileRegistry } from './models/piezo-audio-model.js';
import { ARDUINO_RUNTIME_STATE_VERSION } from './arduino-program-runtime.js';
import { isHcSr04 } from './models/hc-sr04-runtime.js';
import { isPingUltrasonic } from './models/ping-ultrasonic-runtime.js';

export type SimulationStatus = 'solved' | 'unsupported' | 'invalid' | 'nonconvergent';

export interface CompiledNet {
  readonly id: string;
  readonly terminals: readonly string[];
}

export interface CompiledCircuit {
  readonly netlist: Netlist;
  readonly nets: readonly CompiledNet[];
  readonly componentIds: readonly string[];
  readonly sourceIds: readonly string[];
  readonly unsupportedComponentIds: readonly string[];
  readonly topologySignature: string;
}

export interface SimulationResult extends SolveResult {
  readonly status: SimulationStatus;
  readonly quality: SimulationQuality;
  readonly topologySignature: string;
  readonly simulationInputDigest: string;
  readonly solverRevision: 'asa-electronics-solver-v21';
  readonly modelSetDigest: string;
  readonly analysis: {
    readonly electricalMode: 'dc' | 'transient';
    readonly controllerRuntime: 'none' | 'arduino';
  };
}

const CLOSED_RESISTANCE = 1e-4;
const MODEL_SET_DIGEST = `sha256:${sha256Hex(
  JSON.stringify({
    identities: canonicalElectricalModelRegistry(),
    electricalEventFrameVersion: ELECTRICAL_EVENT_FRAME_VERSION,
    tmp36Profile: TMP36_PROFILE,
    soilMoistureProfile: SOIL_MOISTURE_PROFILE,
    photoresistorProfiles: canonicalPhotoresistorProfileRegistry(),
    nonlinearDcProfiles: canonicalNonlinearDcProfileRegistry(),
    brushedMotorProfiles: canonicalBrushedMotorProfileRegistry(),
    brushedMotorTransientModelVersion: BRUSHED_MOTOR_TRANSIENT_MODEL_VERSION,
    regulatedPowerSupplyProfiles: canonicalRegulatedPowerSupplyProfileRegistry(),
    l298nBoardProfile: L298N_BOARD_PROFILE,
    piezoAudioProfiles: canonicalPiezoAudioProfileRegistry(),
    arduinoRuntimeStateVersion: ARDUINO_RUNTIME_STATE_VERSION,
  }),
)}`;

/** Identity of the complete canonical model registry, independent of any circuit. */
export function simulationModelSetDigest(): string {
  return MODEL_SET_DIGEST;
}

function ordinalCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function orderedRecord<T>(
  record: Readonly<Record<string, T>> | undefined,
): Record<string, T> | undefined {
  return record
    ? Object.fromEntries(
        Object.entries(record).sort(([left], [right]) => ordinalCompare(left, right)),
      )
    : undefined;
}

function deterministicComponentResult(component: ComponentResult): ComponentResult {
  return {
    ...component,
    terminalVoltages: orderedRecord(component.terminalVoltages) ?? {},
    ...(component.branchCurrents !== undefined
      ? { branchCurrents: orderedRecord(component.branchCurrents) as Record<string, number> }
      : {}),
    ...(component.terminalCurrents !== undefined
      ? { terminalCurrents: orderedRecord(component.terminalCurrents) as Record<Terminal, number> }
      : {}),
    ...(component.branchBrightness !== undefined
      ? { branchBrightness: orderedRecord(component.branchBrightness) as Record<string, number> }
      : {}),
  };
}

function deterministicSolveResult(result: SolveResult): SolveResult {
  return {
    ...result,
    components: [...result.components]
      .sort((left, right) => ordinalCompare(left.componentId, right.componentId))
      .map(deterministicComponentResult),
    nodes: [...result.nodes]
      .sort((left, right) => ordinalCompare(left.id, right.id))
      .map((node) => copyNumericalNode(node, [...node.terminals].sort(ordinalCompare))),
    diagnostics: [...result.diagnostics]
      .map((diagnostic) => ({
        ...diagnostic,
        ...(diagnostic.componentIds
          ? { componentIds: [...diagnostic.componentIds].sort(ordinalCompare) }
          : {}),
        ...(diagnostic.wireIds ? { wireIds: [...diagnostic.wireIds].sort(ordinalCompare) } : {}),
        ...(diagnostic.netIds ? { netIds: [...diagnostic.netIds].sort(ordinalCompare) } : {}),
        ...(diagnostic.anchors
          ? {
              anchors: [...diagnostic.anchors].sort((left, right) =>
                ordinalCompare(`${left.kind}\u0000${left.id}`, `${right.kind}\u0000${right.id}`),
              ),
            }
          : {}),
      }))
      .sort((left, right) =>
        ordinalCompare(`${left.code}\u0000${left.message}`, `${right.code}\u0000${right.message}`),
      ),
    ...(result.transientState
      ? {
          transientState: {
            ...result.transientState,
            capacitors: [...result.transientState.capacitors].sort((left, right) =>
              ordinalCompare(left.componentId, right.componentId),
            ),
            thermal: [...result.transientState.thermal].sort((left, right) =>
              ordinalCompare(left.componentId, right.componentId),
            ),
            ...(result.transientState.bjtRegions
              ? {
                  bjtRegions: [...result.transientState.bjtRegions].sort((left, right) =>
                    ordinalCompare(left.componentId, right.componentId),
                  ),
                }
              : {}),
            ...(result.transientState.motors
              ? {
                  motors: [...result.transientState.motors].sort((left, right) =>
                    ordinalCompare(left.componentId, right.componentId),
                  ),
                }
              : {}),
            ...(result.transientState.multimeterFuses
              ? {
                  multimeterFuses: [...result.transientState.multimeterFuses].sort((left, right) =>
                    ordinalCompare(left.componentId, right.componentId),
                  ),
                }
              : {}),
          },
        }
      : {}),
    ...(result.controllerState
      ? {
          controllerState: {
            ...result.controllerState,
            boards: [...result.controllerState.boards].sort((left, right) =>
              ordinalCompare(left.componentId, right.componentId),
            ),
          },
        }
      : {}),
  };
}

export function compileCircuit(document: ElectronicsDocument): CompiledCircuit {
  const netlist = buildNetlist(document);
  const nets: CompiledNet[] = Array.from({ length: netlist.nodeCount }, (_, index) => ({
    id: `net-${index}`,
    terminals: [...(netlist.terminalsByNode.get(index) ?? [])].sort(),
  }));
  const componentIds = document.components
    .filter((component) => component.kind !== 'wire')
    .map((component) => component.id)
    .sort();
  const sourceIds = document.components
    .filter((component) => component.kind === 'source' || isArduinoUno(component))
    .map((component) => component.id)
    .sort();
  const unsupportedComponentIds = document.components
    .filter((component) => electricalModelFor(component).support === 'unsupported')
    .map((component) => component.id)
    .sort();
  const topologySignature = JSON.stringify({
    components: componentIds,
    nets: nets.map((net) => [net.id, net.terminals]),
  });
  return {
    netlist,
    nets,
    componentIds,
    sourceIds,
    unsupportedComponentIds,
    topologySignature,
  };
}

function allNumbers(result: SolveResult): readonly number[] {
  const numbers = [
    result.current,
    result.iterations,
    result.numericalResidual,
    result.numericalTolerance,
    ...(result.transientState
      ? [
          result.transientState.simulationTimeMs,
          ...result.transientState.capacitors.flatMap((entry) => [
            entry.capacitanceFarad,
            entry.initialVoltageVolt,
            entry.voltageRatingVolt,
            entry.voltageVolt,
          ]),
          ...result.transientState.thermal.flatMap((entry) => [
            entry.temperatureCelsius,
            entry.loadRatio,
            entry.accumulatedDamage,
          ]),
          ...(result.transientState.motors ?? []).flatMap((entry) => [
            entry.simulationTimeSeconds,
            entry.currentAmp,
            entry.motorAngularVelocityRadPerSecond,
            entry.motorAngularPhaseRadian,
            entry.temperatureCelsius,
            entry.accumulatedDamage,
          ]),
          ...(result.transientState.multimeterFuses ?? []).map(
            (entry) => entry.accumulatedI2tAmpSquaredSecond,
          ),
        ]
      : []),
    ...(result.controllerState
      ? [
          result.controllerState.simulationTimeMs,
          ...result.controllerState.boards.flatMap((entry) => [
            entry.runtime.virtualTimeMs,
            entry.runtime.resumeAtMs,
            entry.runtime.programCounter,
            entry.runtime.loopStartedAtMs,
            entry.runtime.loopIterations,
            ...Object.values(entry.runtime.variables),
            ...Object.values(entry.runtime.locals),
            ...Object.values(entry.runtime.outputVoltages).filter(
              (value): value is number => value !== undefined,
            ),
            ...Object.values(entry.runtime.tones).flatMap((tone) =>
              tone
                ? [tone.frequencyHz, ...(tone.expiresAtMs === undefined ? [] : [tone.expiresAtMs])]
                : [],
            ),
          ]),
        ]
      : []),
    ...(result.transientAnalysis
      ? [
          result.transientAnalysis.acceptedSteps,
          result.transientAnalysis.rejectedSteps,
          result.transientAnalysis.minStepMs,
          result.transientAnalysis.maxStepMs,
        ]
      : []),
    ...result.nodes.flatMap((node) => [node.voltage]),
  ];
  const empty: readonly number[] = [];
  void [
    ...result.components.flatMap((component) => {
      numbers.push(
        component.voltageDrop,
        component.current,
        component.power ?? 0,
        component.internalResistanceOhm ?? 0,
        component.internalPower ?? 0,
        component.voltageSag ?? 0,
        component.voltageSetpointVolt ?? 0,
        component.currentLimitAmp ?? 0,
        component.brightness ?? 0,
        component.baseCurrent ?? 0,
        component.collectorCurrent ?? 0,
        component.emitterCurrent ?? 0,
        component.currentGain ?? 0,
        component.frequencyHz ?? 0,
        component.soundLevel ?? 0,
        component.motorRpm ?? 0,
        component.outputRpm ?? 0,
        component.motorAngularPhaseRadian ?? 0,
        component.electromagneticTorqueNewtonMeter ?? 0,
        component.outputTorqueNewtonMeter ?? 0,
        component.outputLoadTorqueNewtonMeter ?? 0,
        component.transmissionEfficiency ?? 0,
        component.copperLossWatt ?? 0,
        component.motorMechanicalPowerWatt ?? 0,
        component.outputMechanicalPowerWatt ?? 0,
        component.capacitanceFarad ?? 0,
        component.chargeCoulomb ?? 0,
        component.storedEnergyJoule ?? 0,
        component.voltageRatingVolt ?? 0,
        component.temperatureCelsius ?? 0,
        component.sensorTemperatureCelsius ?? 0,
        component.sensorMoisturePercent ?? 0,
        component.sensorResistanceOhm ?? 0,
        component.sensorOutputVoltageVolt ?? 0,
        component.sensorSupplyVoltageVolt ?? 0,
        component.sensorOutputCurrentAmp ?? 0,
        component.thermalLoadPercent ?? 0,
        component.accumulatedDamagePercent ?? 0,
        component.voltageConstraintResidual ?? 0,
      );
      for (const value of Object.values(component.terminalVoltages).filter(
        (value): value is number => value !== undefined,
      )) {
        numbers.push(value);
      }
      for (const value of Object.values(component.branchCurrents ?? {})) numbers.push(value);
      for (const value of Object.values(component.terminalCurrents ?? {}).filter(
        (value): value is number => value !== undefined,
      )) {
        numbers.push(value);
      }
      for (const value of Object.values(component.branchBrightness ?? {})) numbers.push(value);
      return empty;
    }),
  ];
  return numbers;
}

export function verifyCircuitQuality(
  document: ElectronicsDocument,
  compiled: CompiledCircuit,
  result: SolveResult,
  options: SimulationOptions,
): SimulationQuality {
  const finite = allNumbers(result).every(Number.isFinite);
  if (result.components.length === 0) {
    return {
      finite,
      passed: false,
      maxKclResidualAmp: 0,
      maxSourceVoltageResidualVolt: 0,
      powerBalanceResidualWatt: 0,
      powerBalanceToleranceWatt: MIN_POWER_BALANCE_TOLERANCE_W,
      kclToleranceAmp: KCL_TOLERANCE_A,
      sourceVoltageToleranceVolt: SOURCE_VOLTAGE_TOLERANCE_V,
    };
  }

  const arduinoCurrent = createL298nArduinoCurrentSampler(document, compiled.netlist.nodeOf);
  const componentResult = new Map(result.components.map((entry) => [entry.componentId, entry]));
  const residualByNode = new Map<number, number>();
  const addAtNode = (componentId: string, terminal: Terminal, currentLeaving: number): void => {
    const node = compiled.netlist.nodeOf.get(terminalKey(componentId, terminal));
    if (node === undefined) return;
    residualByNode.set(node, (residualByNode.get(node) ?? 0) + currentLeaving);
  };
  const addBranch = (
    component: SchematicComponent,
    from: Terminal,
    to: Terminal,
    current: number,
  ): void => {
    addAtNode(component.id, from, current);
    addAtNode(component.id, to, -current);
  };

  let maxSourceVoltageResidualVolt = 0;
  for (const component of document.components) {
    const resultForComponent = componentResult.get(component.id);
    if (!resultForComponent) continue;
    if (resultForComponent.voltageConstraintResidual !== undefined) {
      maxSourceVoltageResidualVolt = Math.max(
        maxSourceVoltageResidualVolt,
        Math.abs(resultForComponent.voltageConstraintResidual),
      );
    }
    if (resultForComponent.terminalCurrents !== undefined) {
      for (const [terminal, currentEntering] of Object.entries(
        resultForComponent.terminalCurrents,
      )) {
        if (currentEntering !== undefined) addAtNode(component.id, terminal, currentEntering);
      }
      continue;
    }
    if (isArduinoUno(component)) {
      const runtime = result.controllerState?.boards.find(
        (entry) => entry.componentId === component.id,
      )?.runtime;
      // Verification observes the same controller state that supplied MNA. Never
      // replay a sketch with missing inputs to invent a different source voltage.
      if (!runtime) return { ...failedQuality(), finite };
      const branches = arduinoOutputBranchesFromSnapshot(
        component,
        arduinoSnapshotFromState(runtime),
        options.simulationTimeMs ?? 0,
      );
      for (const branch of branches) {
        const currentLeaving = arduinoCurrent(
          component.id,
          resultForComponent.terminalVoltages,
          branch,
          options,
          result.transientState?.simulationTimeMs,
        );
        addBranch(component, branch.terminal, branch.ground, currentLeaving);
      }
      continue;
    }
    if (
      component.kind === 'photoresistor' ||
      component.kind === 'piezo' ||
      component.kind === 'lamp' ||
      component.kind === 'switch' ||
      component.kind === 'button'
    ) {
      addBranch(
        component,
        logicalTerminal(component, 'a'),
        logicalTerminal(component, 'b'),
        resultForComponent.current,
      );
      continue;
    }
    if (component.kind === 'potentiometer') {
      const a = logicalTerminal(component, 'a');
      const b = logicalTerminal(component, 'b');
      const wiper = logicalTerminal(component, 'wiper');
      const position = component.wiperPosition ?? 0.5;
      const voltageA = resultForComponent.terminalVoltages[a] ?? 0;
      const voltageB = resultForComponent.terminalVoltages[b] ?? 0;
      const voltageWiper = resultForComponent.terminalVoltages[wiper] ?? 0;
      const currentA =
        (voltageA - voltageWiper) / Math.max(CLOSED_RESISTANCE, component.value * position);
      const currentB =
        (voltageWiper - voltageB) / Math.max(CLOSED_RESISTANCE, component.value * (1 - position));
      addBranch(component, a, wiper, currentA);
      addBranch(component, wiper, b, currentB);
      continue;
    }
    if (component.kind === 'led' || component.kind === 'diode') {
      const branchId = component.kind === 'led' ? 'led' : 'diode';
      addBranch(
        component,
        logicalTerminal(component, 'a'),
        logicalTerminal(component, 'b'),
        resultForComponent.branchCurrents?.[branchId] ?? resultForComponent.current,
      );
      continue;
    }
    if (component.kind === 'transistor') {
      const transistorType = transistorTypeOf(component);
      if (transistorType === 'fet') {
        // The gate is insulated: drain current leaves the drain and enters the source.
        addBranch(
          component,
          'drain',
          'source',
          resultForComponent.collectorCurrent ?? resultForComponent.branchCurrents?.['drain'] ?? 0,
        );
        continue;
      }
      if (transistorType === 'pnp') {
        // PNP currents leave the emitter and enter base and collector.
        addBranch(
          component,
          'emitter',
          'base',
          resultForComponent.baseCurrent ?? resultForComponent.branchCurrents?.['base'] ?? 0,
        );
        addBranch(
          component,
          'emitter',
          'collector',
          resultForComponent.collectorCurrent ??
            resultForComponent.branchCurrents?.['collector'] ??
            0,
        );
        continue;
      }
      addBranch(
        component,
        'base',
        'emitter',
        resultForComponent.baseCurrent ?? resultForComponent.branchCurrents?.['base'] ?? 0,
      );
      addBranch(
        component,
        'collector',
        'emitter',
        resultForComponent.collectorCurrent ??
          resultForComponent.branchCurrents?.['collector'] ??
          0,
      );
      continue;
    }
    if (component.kind === 'rgb-led') {
      const commonAnode = component.stateProperties?.['commonMode'] === 'common-anode';
      for (const channel of ['red', 'green', 'blue'] as const) {
        const current = resultForComponent.branchCurrents?.[channel] ?? 0;
        addBranch(
          component,
          commonAnode ? 'common' : channel,
          commonAnode ? channel : 'common',
          current,
        );
      }
      continue;
    }
    if (component.kind === 'seven-segment') {
      const common = 'bottom-3';
      const commonAnode = component.stateProperties?.['commonMode'] === 'common-anode';
      for (const [segment, terminal] of Object.entries(SEVEN_SEGMENT_TERMINALS)) {
        const current = resultForComponent.branchCurrents?.[segment] ?? 0;
        addBranch(
          component,
          commonAnode ? common : terminal,
          commonAnode ? terminal : common,
          current,
        );
      }
    }
  }

  const maxKclResidualAmp = Math.max(
    0,
    ...Array.from({ length: compiled.netlist.nodeCount }, (_, node) =>
      Math.abs(residualByNode.get(node) ?? 0),
    ),
  );
  const maxTerminalCurrentAmp = Math.max(
    0,
    ...result.components.flatMap((component) =>
      Object.values(component.terminalCurrents ?? {}).map((value) => Math.abs(value ?? 0)),
    ),
  );
  const kclToleranceAmp = kclTolerance(!!result.transientState, maxTerminalCurrentAmp);
  const powerBalanceComponents = document.components.filter(
    (component) =>
      !['wire', 'breadboard'].includes(component.kind) &&
      (component.kind !== 'visual' ||
        // A partial sum containing loads but omitting their Arduino supply is
        // not a circuit power balance. Require terminal currents for all parties.
        isArduinoUno(component) ||
        isElectrolyticCapacitor(component) ||
        isHcSr04(component) ||
        isPingUltrasonic(component) ||
        component.componentTypeId === 'dc-motor' ||
        component.componentTypeId === 'gearmotor' ||
        component.componentTypeId === 'vibration-motor' ||
        component.componentTypeId === 'temperature-sensor' ||
        component.componentTypeId === 'soil-moisture-sensor' ||
        component.componentTypeId === 'multimeter' ||
        component.componentTypeId === 'oscilloscope' ||
        component.componentTypeId === 'l298n-motor-driver'),
  );
  const powerBalanceApplicable =
    powerBalanceComponents.length > 0 &&
    powerBalanceComponents.every(
      (component) => componentResult.get(component.id)?.terminalCurrents !== undefined,
    );
  const terminalPowerByComponent = powerBalanceApplicable
    ? powerBalanceComponents.map((component) => {
        const solved = componentResult.get(component.id);
        return Object.entries(solved?.terminalCurrents ?? {}).reduce(
          (power, [terminal, currentEntering]) =>
            power + (solved?.terminalVoltages[terminal] ?? 0) * (currentEntering ?? 0),
          0,
        );
      })
    : [];
  const suppliedPowerWatt = terminalPowerByComponent.reduce(
    (total, power) => total + Math.max(0, -power),
    0,
  );
  const shuntPowerWatt = powerBalanceApplicable
    ? numericalShuntPowerWatt(compiled, result, componentResult)
    : 0;
  const powerBalanceResidualWatt = Math.abs(
    terminalPowerByComponent.reduce((total, power) => total + power, 0) + (shuntPowerWatt ?? 0),
  );
  const powerBalanceToleranceWatt = powerTolerance(suppliedPowerWatt);
  return finishElectricalQuality(
    finite,
    maxKclResidualAmp,
    maxSourceVoltageResidualVolt,
    powerBalanceResidualWatt,
    powerBalanceToleranceWatt,
    kclToleranceAmp,
    powerBalanceApplicable,
    shuntPowerWatt,
  );
}

/** Package internal: a private topology and scratch, enabled by the owned clock. */
export function createArduinoQualityTraversal(
  document: ElectronicsDocument,
  compiled: CompiledCircuit,
  owner: object,
) {
  // Neither these Maps nor the derived terminal layouts escape this closure.
  const nodeOf = new Map(compiled.netlist.nodeOf);
  const nodeCount = compiled.netlist.nodeCount;
  const arduinoCurrent = createL298nArduinoCurrentSampler(document, nodeOf);
  const componentResult = new Map<string, ComponentResult>();
  const residualByNode = new Map<number, number>();
  const terminalPowerByComponent: number[] = [];
  let terminalLayouts = new WeakMap<object, Map<string, readonly (number | undefined)[]>>();
  let active = false;
  let disposed = false;
  const verify = (result: SolveResult, options: SimulationOptions): SimulationQuality => {
    // Unknown/reentrant frames take the original path before shared scratch is touched.
    const receipt = !disposed ? takeArduinoQualityReceipt(owner, result, document) : undefined;
    if (!receipt || active) {
      if (receipt) releaseArduinoQualityReceipt(receipt);
      return verifyCircuitQuality(document, compiled, result, options);
    }
    active = true;
    const keys = (record: object) => arduinoQualityDictionaryKeys(receipt, record);
    const terminalNodes = (record: object, componentId: string, orderedKeys: readonly string[]) => {
      let byComponent = terminalLayouts.get(record);
      if (!byComponent) {
        byComponent = new Map();
        terminalLayouts.set(record, byComponent);
      }
      let nodes = byComponent.get(componentId);
      if (!nodes) {
        nodes = orderedKeys.map((terminal) => nodeOf.get(terminalKey(componentId, terminal)));
        byComponent.set(componentId, nodes);
      }
      return nodes;
    };
    try {
      const finite = preparedNumbersFinite(result, keys);
      if (result.components.length === 0) {
        return {
          finite,
          passed: false,
          maxKclResidualAmp: 0,
          maxSourceVoltageResidualVolt: 0,
          powerBalanceResidualWatt: 0,
          powerBalanceToleranceWatt: MIN_POWER_BALANCE_TOLERANCE_W,
          kclToleranceAmp: KCL_TOLERANCE_A,
          sourceVoltageToleranceVolt: SOURCE_VOLTAGE_TOLERANCE_V,
        };
      }

      for (const entry of result.components) componentResult.set(entry.componentId, entry);
      const addAtNode = (componentId: string, terminal: Terminal, currentLeaving: number): void => {
        const node = nodeOf.get(terminalKey(componentId, terminal));
        if (node === undefined) return;
        residualByNode.set(node, (residualByNode.get(node) ?? 0) + currentLeaving);
      };
      const addBranch = (
        component: SchematicComponent,
        from: Terminal,
        to: Terminal,
        current: number,
      ): void => {
        addAtNode(component.id, from, current);
        addAtNode(component.id, to, -current);
      };

      let maxSourceVoltageResidualVolt = 0;
      for (const component of document.components) {
        const resultForComponent = componentResult.get(component.id);
        if (!resultForComponent) continue;
        if (resultForComponent.voltageConstraintResidual !== undefined) {
          maxSourceVoltageResidualVolt = Math.max(
            maxSourceVoltageResidualVolt,
            Math.abs(resultForComponent.voltageConstraintResidual),
          );
        }
        if (resultForComponent.terminalCurrents !== undefined) {
          const currents = resultForComponent.terminalCurrents;
          const orderedKeys = keys(currents);
          if (orderedKeys) {
            const nodes = terminalNodes(currents, component.id, orderedKeys);
            for (let index = 0; index < orderedKeys.length; index++) {
              const currentEntering = currents[orderedKeys[index]!];
              const node = nodes[index];
              if (currentEntering !== undefined && node !== undefined)
                residualByNode.set(node, (residualByNode.get(node) ?? 0) + currentEntering);
            }
          } else {
            for (const [terminal, currentEntering] of Object.entries(currents))
              if (currentEntering !== undefined) addAtNode(component.id, terminal, currentEntering);
          }
          continue;
        }
        if (isArduinoUno(component)) {
          const runtime = result.controllerState?.boards.find(
            (entry) => entry.componentId === component.id,
          )?.runtime;
          // Verification observes the same controller state that supplied MNA. Never
          // replay a sketch with missing inputs to invent a different source voltage.
          if (!runtime) return { ...failedQuality(), finite };
          const branches = arduinoOutputBranchesFromSnapshot(
            component,
            arduinoSnapshotFromState(runtime),
            options.simulationTimeMs ?? 0,
          );
          for (const branch of branches) {
            const currentLeaving = arduinoCurrent(
              component.id,
              resultForComponent.terminalVoltages,
              branch,
              options,
              result.transientState?.simulationTimeMs,
            );
            addBranch(component, branch.terminal, branch.ground, currentLeaving);
          }
          continue;
        }
        if (
          component.kind === 'photoresistor' ||
          component.kind === 'piezo' ||
          component.kind === 'lamp' ||
          component.kind === 'switch' ||
          component.kind === 'button'
        ) {
          addBranch(
            component,
            logicalTerminal(component, 'a'),
            logicalTerminal(component, 'b'),
            resultForComponent.current,
          );
          continue;
        }
        if (component.kind === 'potentiometer') {
          const a = logicalTerminal(component, 'a');
          const b = logicalTerminal(component, 'b');
          const wiper = logicalTerminal(component, 'wiper');
          const position = component.wiperPosition ?? 0.5;
          const voltageA = resultForComponent.terminalVoltages[a] ?? 0;
          const voltageB = resultForComponent.terminalVoltages[b] ?? 0;
          const voltageWiper = resultForComponent.terminalVoltages[wiper] ?? 0;
          const currentA =
            (voltageA - voltageWiper) / Math.max(CLOSED_RESISTANCE, component.value * position);
          const currentB =
            (voltageWiper - voltageB) /
            Math.max(CLOSED_RESISTANCE, component.value * (1 - position));
          addBranch(component, a, wiper, currentA);
          addBranch(component, wiper, b, currentB);
          continue;
        }
        if (component.kind === 'led' || component.kind === 'diode') {
          const branchId = component.kind === 'led' ? 'led' : 'diode';
          addBranch(
            component,
            logicalTerminal(component, 'a'),
            logicalTerminal(component, 'b'),
            resultForComponent.branchCurrents?.[branchId] ?? resultForComponent.current,
          );
          continue;
        }
        if (component.kind === 'transistor') {
          const transistorType = transistorTypeOf(component);
          if (transistorType === 'fet') {
            // The gate is insulated: drain current leaves the drain and enters the source.
            addBranch(
              component,
              'drain',
              'source',
              resultForComponent.collectorCurrent ??
                resultForComponent.branchCurrents?.['drain'] ??
                0,
            );
            continue;
          }
          if (transistorType === 'pnp') {
            // PNP currents leave the emitter and enter base and collector.
            addBranch(
              component,
              'emitter',
              'base',
              resultForComponent.baseCurrent ?? resultForComponent.branchCurrents?.['base'] ?? 0,
            );
            addBranch(
              component,
              'emitter',
              'collector',
              resultForComponent.collectorCurrent ??
                resultForComponent.branchCurrents?.['collector'] ??
                0,
            );
            continue;
          }
          addBranch(
            component,
            'base',
            'emitter',
            resultForComponent.baseCurrent ?? resultForComponent.branchCurrents?.['base'] ?? 0,
          );
          addBranch(
            component,
            'collector',
            'emitter',
            resultForComponent.collectorCurrent ??
              resultForComponent.branchCurrents?.['collector'] ??
              0,
          );
          continue;
        }
        if (component.kind === 'rgb-led') {
          const commonAnode = component.stateProperties?.['commonMode'] === 'common-anode';
          for (const channel of ['red', 'green', 'blue'] as const) {
            const current = resultForComponent.branchCurrents?.[channel] ?? 0;
            addBranch(
              component,
              commonAnode ? 'common' : channel,
              commonAnode ? channel : 'common',
              current,
            );
          }
          continue;
        }
        if (component.kind === 'seven-segment') {
          const common = 'bottom-3';
          const commonAnode = component.stateProperties?.['commonMode'] === 'common-anode';
          for (const [segment, terminal] of Object.entries(SEVEN_SEGMENT_TERMINALS)) {
            const current = resultForComponent.branchCurrents?.[segment] ?? 0;
            addBranch(
              component,
              commonAnode ? common : terminal,
              commonAnode ? terminal : common,
              current,
            );
          }
        }
      }

      let maxKclResidualAmp = 0;
      for (let node = 0; node < nodeCount; node++)
        maxKclResidualAmp = Math.max(maxKclResidualAmp, Math.abs(residualByNode.get(node) ?? 0));
      let maxTerminalCurrentAmp = 0;
      for (const component of result.components) {
        const currents = component.terminalCurrents;
        if (!currents) continue;
        const orderedKeys = keys(currents);
        if (orderedKeys)
          for (const key of orderedKeys)
            maxTerminalCurrentAmp = Math.max(maxTerminalCurrentAmp, Math.abs(currents[key] ?? 0));
        else
          for (const value of Object.values(currents).map((value) => Math.abs(value ?? 0)))
            maxTerminalCurrentAmp = Math.max(maxTerminalCurrentAmp, value);
      }
      const kclToleranceAmp = kclTolerance(!!result.transientState, maxTerminalCurrentAmp);
      const powerBalanceComponents = document.components.filter(
        (component) =>
          !['wire', 'breadboard'].includes(component.kind) &&
          (component.kind !== 'visual' ||
            // A partial sum containing loads but omitting their Arduino supply is
            // not a circuit power balance. Require terminal currents for all parties.
            isArduinoUno(component) ||
            isElectrolyticCapacitor(component) ||
            isHcSr04(component) ||
            isPingUltrasonic(component) ||
            component.componentTypeId === 'dc-motor' ||
            component.componentTypeId === 'gearmotor' ||
            component.componentTypeId === 'vibration-motor' ||
            component.componentTypeId === 'temperature-sensor' ||
            component.componentTypeId === 'soil-moisture-sensor' ||
            component.componentTypeId === 'multimeter' ||
            component.componentTypeId === 'oscilloscope' ||
            component.componentTypeId === 'l298n-motor-driver'),
      );
      const powerBalanceApplicable =
        powerBalanceComponents.length > 0 &&
        powerBalanceComponents.every(
          (component) => componentResult.get(component.id)?.terminalCurrents !== undefined,
        );
      if (powerBalanceApplicable)
        for (const component of powerBalanceComponents) {
          const solved = componentResult.get(component.id);
          const currents = solved?.terminalCurrents;
          const orderedKeys = currents && keys(currents);
          let power = 0;
          if (orderedKeys)
            for (const terminal of orderedKeys)
              power =
                power + (solved?.terminalVoltages[terminal] ?? 0) * (currents![terminal] ?? 0);
          else
            power = Object.entries(currents ?? {}).reduce(
              (sum, [terminal, currentEntering]) =>
                sum + (solved?.terminalVoltages[terminal] ?? 0) * (currentEntering ?? 0),
              0,
            );
          terminalPowerByComponent.push(power);
        }
      let suppliedPowerWatt = 0;
      for (const power of terminalPowerByComponent)
        suppliedPowerWatt = suppliedPowerWatt + Math.max(0, -power);
      let totalPowerWatt = 0;
      for (const power of terminalPowerByComponent) totalPowerWatt = totalPowerWatt + power;
      const shuntPowerWatt = powerBalanceApplicable
        ? numericalShuntPowerWatt(compiled, result, componentResult)
        : 0;
      const powerBalanceResidualWatt = Math.abs(totalPowerWatt + (shuntPowerWatt ?? 0));
      const powerBalanceToleranceWatt = powerTolerance(suppliedPowerWatt);
      return finishElectricalQuality(
        finite,
        maxKclResidualAmp,
        maxSourceVoltageResidualVolt,
        powerBalanceResidualWatt,
        powerBalanceToleranceWatt,
        kclToleranceAmp,
        powerBalanceApplicable,
        shuntPowerWatt,
      );
    } finally {
      componentResult.clear();
      residualByNode.clear();
      terminalPowerByComponent.length = 0;
      releaseArduinoQualityReceipt(receipt);
      active = false;
    }
  };
  return {
    verify,
    dispose() {
      disposed = true;
      terminalLayouts = new WeakMap();
      nodeOf.clear();
      componentResult.clear();
      residualByNode.clear();
      terminalPowerByComponent.length = 0;
    },
  };
}

function failedQuality(): SimulationQuality {
  return {
    finite: true,
    passed: false,
    maxKclResidualAmp: 0,
    maxSourceVoltageResidualVolt: 0,
    powerBalanceResidualWatt: 0,
    powerBalanceToleranceWatt: MIN_POWER_BALANCE_TOLERANCE_W,
    kclToleranceAmp: KCL_TOLERANCE_A,
    sourceVoltageToleranceVolt: SOURCE_VOLTAGE_TOLERANCE_V,
  };
}

function statusFor(result: SolveResult): SimulationStatus {
  if (result.diagnostics.some((diagnostic) => diagnostic.code === 'unsupported_component')) {
    return 'unsupported';
  }
  if (result.diagnostics.some((diagnostic) => diagnostic.code === 'nonconvergent_topology')) {
    return 'nonconvergent';
  }
  return result.solved ? 'solved' : 'invalid';
}

export interface SimulationOptions {
  readonly simulationTimeMs?: number;
  /** Internal shared-clock interval input, never persisted as project state. */
  readonly l298nPwmSampleTimeMs?: number | undefined;
  readonly transientState?: CapacitorTransientState;
  readonly controllerState?: ArduinoControllerState;
}

export function analyseCircuit(
  document: ElectronicsDocument,
  options: SimulationOptions = {},
): SimulationResult {
  const compiled = compileCircuit(document);
  const inputDigest = simulationInputDigest(document, options.simulationTimeMs ?? 0);
  const analysis = {
    electricalMode:
      document.components.some(
        (component) =>
          isElectrolyticCapacitor(component) ||
          component.componentTypeId === 'dc-motor' ||
          component.componentTypeId === 'gearmotor' ||
          component.componentTypeId === 'vibration-motor',
      ) || options.simulationTimeMs !== undefined
        ? 'transient'
        : 'dc',
    controllerRuntime: document.components.some((component) => isArduinoUno(component))
      ? 'arduino'
      : 'none',
  } as const;
  if (compiled.unsupportedComponentIds.length > 0) {
    const diagnostic: Diagnostic = {
      code: 'unsupported_component',
      severity: 'error',
      message:
        'Схема содержит компонент без электрической модели. Расчёт остановлен без вымышленных токов и напряжений.',
      componentIds: compiled.unsupportedComponentIds,
      suggestedAction:
        'Удалите неподдерживаемый компонент или дождитесь его подтверждённой модели.',
    };
    return {
      solved: false,
      status: 'unsupported',
      current: 0,
      components: [],
      nodes: [],
      diagnostics: [diagnostic],
      iterations: 0,
      numericalResidual: 0,
      numericalTolerance: 0,
      quality: failedQuality(),
      topologySignature: compiled.topologySignature,
      simulationInputDigest: inputDigest,
      solverRevision: 'asa-electronics-solver-v21',
      modelSetDigest: MODEL_SET_DIGEST,
      analysis,
    };
  }

  const solved = deterministicSolveResult(solveCircuit(document, options));
  const quality = verifyCircuitQuality(document, compiled, solved, options);
  if (solved.solved && !quality.passed) {
    const diagnostic: Diagnostic = {
      code: 'nonconvergent_topology',
      severity: 'error',
      message: quality.finite
        ? `Численная проверка отклонена: невязка KCL ${quality.maxKclResidualAmp} А, источников ${quality.maxSourceVoltageResidualVolt} В.`
        : 'Численная проверка отклонена: результат содержит NaN или Infinity.',
      suggestedAction: 'Проверьте топологию, идеальные источники и параметры компонентов.',
    };
    return {
      ...solved,
      solved: false,
      status: 'nonconvergent',
      diagnostics: [...solved.diagnostics, diagnostic],
      quality,
      topologySignature: compiled.topologySignature,
      simulationInputDigest: inputDigest,
      solverRevision: 'asa-electronics-solver-v21',
      modelSetDigest: MODEL_SET_DIGEST,
      analysis,
    };
  }

  return {
    ...solved,
    status: statusFor(solved),
    quality,
    topologySignature: compiled.topologySignature,
    simulationInputDigest: inputDigest,
    solverRevision: 'asa-electronics-solver-v21',
    modelSetDigest: MODEL_SET_DIGEST,
    analysis,
  };
}
