import { type ElectronicsDocument, type SchematicComponent, type Terminal } from './document.js';
import { arduinoOutputBranches, isArduinoUno } from './arduino-model.js';
import { buildNetlist, terminalKey, type Netlist } from './netlist.js';
import { canonicalElectricalModelRegistry } from './model-identity.js';
import { electricalModelFor } from './model-registry.js';
import { canonicalNonlinearDcProfileRegistry } from './models/nonlinear-dc-models.js';
import {
  solveCircuit,
  transistorTypeOf,
  type ComponentResult,
  type Diagnostic,
  type SolveResult,
} from './solver.js';
import { sha256Hex, simulationInputDigest } from './simulation-input-digest.js';
import {
  isElectrolyticCapacitor,
  type CapacitorTransientState,
} from './models/capacitor-transient-model.js';

export type SimulationStatus = 'solved' | 'unsupported' | 'invalid' | 'nonconvergent';

export interface SimulationQuality {
  readonly finite: boolean;
  readonly passed: boolean;
  readonly maxKclResidualAmp: number;
  readonly maxSourceVoltageResidualVolt: number;
  readonly powerBalanceResidualWatt: number;
  readonly powerBalanceToleranceWatt: number;
  readonly kclToleranceAmp: number;
  readonly sourceVoltageToleranceVolt: number;
}

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
  readonly solverRevision: 'asa-electronics-solver-v6';
  readonly modelSetDigest: string;
  readonly analysis: {
    readonly electricalMode: 'dc' | 'transient';
    readonly controllerRuntime: 'none' | 'arduino';
  };
}

const CLOSED_RESISTANCE = 1e-4;
const KCL_TOLERANCE_A = 1e-6;
const TRANSIENT_KCL_RELATIVE_TOLERANCE = 0.02;
const SOURCE_VOLTAGE_TOLERANCE_V = 1e-9;
const MIN_POWER_BALANCE_TOLERANCE_W = 1e-9;
const MODEL_SET_DIGEST = `sha256:${sha256Hex(
  JSON.stringify({
    identities: canonicalElectricalModelRegistry(),
    nonlinearDcProfiles: canonicalNonlinearDcProfileRegistry(),
  }),
)}`;

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
      .map((node) => ({ ...node, terminals: [...node.terminals].sort(ordinalCompare) })),
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
          },
        }
      : {}),
  };
}

const SEVEN_SEGMENT_TERMINALS: Readonly<Record<string, Terminal>> = {
  a: 'top-4',
  b: 'top-5',
  c: 'bottom-4',
  d: 'bottom-2',
  e: 'bottom-1',
  f: 'top-2',
  g: 'top-1',
  dp: 'bottom-5',
};

type LogicalTerminal = 'a' | 'b' | 'wiper';

function logicalTerminal(component: SchematicComponent, terminal: LogicalTerminal): Terminal {
  if (!component.componentTypeId) return terminal;
  if (component.kind === 'source') {
    const positive = component.pinIds?.includes('BAT+') ? 'BAT+' : 'positive';
    const negative = component.pinIds?.includes('BAT-') ? 'BAT-' : 'negative';
    return terminal === 'a' ? positive : negative;
  }
  if (component.kind === 'resistor' || component.kind === 'photoresistor')
    return terminal === 'a' ? 'lead-1' : 'lead-2';
  if (component.kind === 'led' || component.kind === 'diode') {
    return terminal === 'a' ? 'anode' : 'cathode';
  }
  if (component.kind === 'button') return terminal === 'a' ? 'SW-A1' : 'SW-B1';
  if (component.kind === 'switch') {
    if (terminal === 'a') return 'common';
    return component.state === true ? 'throw-right' : 'throw-left';
  }
  if (component.kind === 'potentiometer') {
    if (terminal === 'wiper') return 'wiper';
    return terminal === 'a' ? 'terminal-1' : 'terminal-2';
  }
  if (component.kind === 'lamp') return terminal === 'a' ? 'L1' : 'L2';
  return terminal;
}

function rounded(value: number, digits = 12): number {
  const factor = 10 ** digits;
  const result = Math.round(value * factor) / factor;
  return Object.is(result, -0) ? 0 : result;
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
  return [
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
    ...result.components.flatMap((component) => [
      component.voltageDrop,
      component.current,
      component.power ?? 0,
      component.internalResistanceOhm ?? 0,
      component.internalPower ?? 0,
      component.voltageSag ?? 0,
      component.brightness ?? 0,
      component.baseCurrent ?? 0,
      component.collectorCurrent ?? 0,
      component.emitterCurrent ?? 0,
      component.currentGain ?? 0,
      component.frequencyHz ?? 0,
      component.soundLevel ?? 0,
      component.capacitanceFarad ?? 0,
      component.chargeCoulomb ?? 0,
      component.storedEnergyJoule ?? 0,
      component.voltageRatingVolt ?? 0,
      component.temperatureCelsius ?? 0,
      component.thermalLoadPercent ?? 0,
      component.accumulatedDamagePercent ?? 0,
      component.voltageConstraintResidual ?? 0,
      ...Object.values(component.terminalVoltages).filter(
        (value): value is number => value !== undefined,
      ),
      ...Object.values(component.branchCurrents ?? {}),
      ...Object.values(component.terminalCurrents ?? {}).filter(
        (value): value is number => value !== undefined,
      ),
      ...Object.values(component.branchBrightness ?? {}),
    ]),
  ];
}

function verifyQuality(
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
      for (const branch of arduinoOutputBranches(component, options.simulationTimeMs ?? 0)) {
        const positive = resultForComponent.terminalVoltages[branch.terminal] ?? 0;
        const ground = resultForComponent.terminalVoltages[branch.ground] ?? 0;
        const currentLeaving = (positive - ground - branch.targetVoltage) / branch.resistanceOhm;
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
  const kclToleranceAmp = result.transientState
    ? Math.max(KCL_TOLERANCE_A, maxTerminalCurrentAmp * TRANSIENT_KCL_RELATIVE_TOLERANCE)
    : KCL_TOLERANCE_A;
  const powerBalanceComponents = document.components.filter(
    (component) =>
      !['wire', 'breadboard'].includes(component.kind) &&
      (component.kind !== 'visual' || isElectrolyticCapacitor(component)),
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
  const powerBalanceResidualWatt = Math.abs(
    terminalPowerByComponent.reduce((total, power) => total + power, 0),
  );
  const powerBalanceToleranceWatt = Math.max(
    MIN_POWER_BALANCE_TOLERANCE_W,
    suppliedPowerWatt * 1e-6,
  );
  const passed =
    finite &&
    maxKclResidualAmp <= kclToleranceAmp &&
    maxSourceVoltageResidualVolt <= SOURCE_VOLTAGE_TOLERANCE_V &&
    (!powerBalanceApplicable || powerBalanceResidualWatt <= powerBalanceToleranceWatt);
  return {
    finite,
    passed,
    maxKclResidualAmp: rounded(maxKclResidualAmp),
    maxSourceVoltageResidualVolt: rounded(maxSourceVoltageResidualVolt),
    powerBalanceResidualWatt: rounded(powerBalanceResidualWatt),
    powerBalanceToleranceWatt: rounded(powerBalanceToleranceWatt),
    kclToleranceAmp: rounded(kclToleranceAmp),
    sourceVoltageToleranceVolt: SOURCE_VOLTAGE_TOLERANCE_V,
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
  readonly transientState?: CapacitorTransientState;
}

export function analyseCircuit(
  document: ElectronicsDocument,
  options: SimulationOptions = {},
): SimulationResult {
  const compiled = compileCircuit(document);
  const inputDigest = simulationInputDigest(document, options.simulationTimeMs ?? 0);
  const analysis = {
    electricalMode:
      document.components.some(isElectrolyticCapacitor) || options.simulationTimeMs !== undefined
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
      solverRevision: 'asa-electronics-solver-v6',
      modelSetDigest: MODEL_SET_DIGEST,
      analysis,
    };
  }

  const solved = deterministicSolveResult(solveCircuit(document, options));
  const quality = verifyQuality(document, compiled, solved, options);
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
      solverRevision: 'asa-electronics-solver-v6',
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
    solverRevision: 'asa-electronics-solver-v6',
    modelSetDigest: MODEL_SET_DIGEST,
    analysis,
  };
}
