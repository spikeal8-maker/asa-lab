import type { ElectronicsDocument, SchematicComponent, Terminal } from './document.js';
import {
  arduinoOutputBranchesFromSnapshot,
  arduinoSnapshotFromState,
  isArduinoUno,
} from './arduino-model.js';
import { terminalKey } from './netlist.js';
import { numericalShuntPowerWatt, type NumericalCircuitTopology } from './numerical-shunt-power.js';
import {
  takeArduinoElectricalCheckpoint,
  type ArduinoElectricalCheckpointHandle,
  type ComponentResult,
  type SolveResult,
} from './solver.js';

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

export const KCL_TOLERANCE_A = 1e-6;
const TRANSIENT_KCL_RELATIVE_TOLERANCE = 0.02;
export const SOURCE_VOLTAGE_TOLERANCE_V = 1e-9;
export const MIN_POWER_BALANCE_TOLERANCE_W = 1e-9;
type LogicalTerminal = 'a' | 'b' | 'wiper';

export function logicalTerminal(
  component: SchematicComponent,
  terminal: LogicalTerminal,
): Terminal {
  if (!component.componentTypeId) return terminal;
  if (component.kind === 'source') {
    const positive = component.pinIds?.includes('BAT+') ? 'BAT+' : 'positive';
    const negative = component.pinIds?.includes('BAT-') ? 'BAT-' : 'negative';
    return terminal === 'a' ? positive : negative;
  }
  if (component.kind === 'resistor' || component.kind === 'photoresistor')
    return terminal === 'a' ? 'lead-1' : 'lead-2';
  if (component.kind === 'piezo') return terminal === 'a' ? 'positive' : 'negative';
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

// This collector is used only for a solver-issued, synchronous current frame.
// The public collector above retains all arbitrary caller observation semantics.
export function preparedNumbersFinite(
  result: Pick<
    SolveResult,
    | 'current'
    | 'iterations'
    | 'numericalResidual'
    | 'numericalTolerance'
    | 'transientState'
    | 'controllerState'
    | 'transientAnalysis'
    | 'nodes'
    | 'components'
  >,
  keys: (record: object) => readonly string[] | undefined,
): boolean {
  let finite = true;
  const check = (value: number) => {
    finite = Number.isFinite(value) && finite;
  };
  const record = (
    values: Readonly<Record<string, number | undefined>>,
    filterUndefined: boolean,
  ) => {
    const orderedKeys = keys(values);
    if (orderedKeys) {
      for (const key of orderedKeys) {
        const value = values[key];
        if (!filterUndefined || value !== undefined) check(value as number);
      }
    } else {
      const current = Object.values(values);
      for (const value of filterUndefined
        ? current.filter((value) => value !== undefined)
        : current)
        check(value as number);
    }
  };
  check(result.current);
  check(result.iterations);
  check(result.numericalResidual);
  check(result.numericalTolerance);
  const transient = result.transientState;
  if (transient) {
    check(transient.simulationTimeMs);
    for (const entry of transient.capacitors) {
      check(entry.capacitanceFarad);
      check(entry.initialVoltageVolt);
      check(entry.voltageRatingVolt);
      check(entry.voltageVolt);
    }
    for (const entry of transient.thermal) {
      check(entry.temperatureCelsius);
      check(entry.loadRatio);
      check(entry.accumulatedDamage);
    }
    for (const entry of transient.motors ?? []) {
      check(entry.simulationTimeSeconds);
      check(entry.currentAmp);
      check(entry.motorAngularVelocityRadPerSecond);
      check(entry.motorAngularPhaseRadian);
      check(entry.temperatureCelsius);
      check(entry.accumulatedDamage);
    }
    for (const entry of transient.multimeterFuses ?? [])
      check(entry.accumulatedI2tAmpSquaredSecond);
  }
  if (result.controllerState) {
    check(result.controllerState.simulationTimeMs);
    for (const entry of result.controllerState.boards) {
      const runtime = entry.runtime;
      check(runtime.virtualTimeMs);
      check(runtime.resumeAtMs);
      check(runtime.programCounter);
      check(runtime.loopStartedAtMs);
      check(runtime.loopIterations);
      record(runtime.variables, false);
      record(runtime.locals, false);
      record(runtime.outputVoltages, true);
      for (const tone of Object.values(runtime.tones))
        if (tone) {
          check(tone.frequencyHz);
          if (tone.expiresAtMs !== undefined) check(tone.expiresAtMs);
        }
    }
  }
  if (result.transientAnalysis) {
    check(result.transientAnalysis.acceptedSteps);
    check(result.transientAnalysis.rejectedSteps);
    check(result.transientAnalysis.minStepMs);
    check(result.transientAnalysis.maxStepMs);
  }
  for (const node of result.nodes) check(node.voltage);
  visitQualityComponents(result.components, check, record);
  return finite;
}

export function finishElectricalQuality(
  finite: boolean,
  maxKclResidualAmp: number,
  maxSourceVoltageResidualVolt: number,
  powerBalanceResidualWatt: number,
  powerBalanceToleranceWatt: number,
  kclToleranceAmp: number,
  powerBalanceApplicable: boolean,
  shuntPowerWatt: number | null,
): SimulationQuality {
  const passed =
    finite &&
    maxKclResidualAmp <= kclToleranceAmp &&
    maxSourceVoltageResidualVolt <= SOURCE_VOLTAGE_TOLERANCE_V &&
    (!powerBalanceApplicable ||
      (shuntPowerWatt !== null && powerBalanceResidualWatt <= powerBalanceToleranceWatt));
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

export function kclTolerance(transient: boolean, maxCurrent: number): number {
  return transient
    ? Math.max(KCL_TOLERANCE_A, maxCurrent * TRANSIENT_KCL_RELATIVE_TOLERANCE)
    : KCL_TOLERANCE_A;
}
export function powerTolerance(supplied: number): number {
  return Math.max(MIN_POWER_BALANCE_TOLERANCE_W, supplied * 1e-6);
}

function visitQualityComponents(
  components: readonly ComponentResult[],
  check: (v: number) => void,
  record: (values: Readonly<Record<string, number | undefined>>, skip: boolean) => void,
): void {
  for (const component of components) {
    check(component.voltageDrop);
    check(component.current);
    check(component.power ?? 0);
    check(component.internalResistanceOhm ?? 0);
    check(component.internalPower ?? 0);
    check(component.voltageSag ?? 0);
    check(component.voltageSetpointVolt ?? 0);
    check(component.currentLimitAmp ?? 0);
    check(component.brightness ?? 0);
    check(component.baseCurrent ?? 0);
    check(component.collectorCurrent ?? 0);
    check(component.emitterCurrent ?? 0);
    check(component.currentGain ?? 0);
    check(component.frequencyHz ?? 0);
    check(component.soundLevel ?? 0);
    check(component.motorRpm ?? 0);
    check(component.outputRpm ?? 0);
    check(component.motorAngularPhaseRadian ?? 0);
    check(component.electromagneticTorqueNewtonMeter ?? 0);
    check(component.outputTorqueNewtonMeter ?? 0);
    check(component.outputLoadTorqueNewtonMeter ?? 0);
    check(component.transmissionEfficiency ?? 0);
    check(component.copperLossWatt ?? 0);
    check(component.motorMechanicalPowerWatt ?? 0);
    check(component.outputMechanicalPowerWatt ?? 0);
    check(component.capacitanceFarad ?? 0);
    check(component.chargeCoulomb ?? 0);
    check(component.storedEnergyJoule ?? 0);
    check(component.voltageRatingVolt ?? 0);
    check(component.temperatureCelsius ?? 0);
    check(component.sensorTemperatureCelsius ?? 0);
    check(component.sensorMoisturePercent ?? 0);
    check(component.sensorResistanceOhm ?? 0);
    check(component.sensorOutputVoltageVolt ?? 0);
    check(component.sensorSupplyVoltageVolt ?? 0);
    check(component.sensorOutputCurrentAmp ?? 0);
    check(component.thermalLoadPercent ?? 0);
    check(component.accumulatedDamagePercent ?? 0);
    check(component.voltageConstraintResidual ?? 0);
    record(component.terminalVoltages, true);
    if (component.branchCurrents) record(component.branchCurrents, false);
    if (component.terminalCurrents) record(component.terminalCurrents, true);
    if (component.branchBrightness) record(component.branchBrightness, false);
  }
}

interface CheckpointTerminal {
  readonly node: number;
  readonly current: number;
  readonly voltage: number;
}
type CheckpointCurrentRow =
  | { readonly kind: 'terminals'; readonly terminals: readonly CheckpointTerminal[] }
  | {
      readonly kind: 'led';
      readonly anode: number;
      readonly cathode: number;
      readonly voltage: number;
      readonly current: number;
    }
  | {
      readonly kind: 'arduino';
      readonly component: SchematicComponent;
      readonly result: ComponentResult;
      readonly nodes: ReadonlyMap<Terminal, number>;
    };

interface CheckpointQualityColumns {
  readonly byId: ReadonlyMap<string, ComponentResult>;
  readonly currents: readonly CheckpointCurrentRow[];
  readonly sourceResiduals: readonly number[];
  readonly numbers: Float64Array;
  readonly residuals: Float64Array;
}

function compileCheckpointQuality(
  document: ElectronicsDocument,
  compiled: NumericalCircuitTopology,
  components: readonly ComponentResult[],
): CheckpointQualityColumns | undefined {
  const byId = new Map(components.map((component) => [component.componentId, component]));
  const numbers: number[] = [];
  const record = (
    values: Readonly<Record<string, number | undefined>>,
    filterUndefined: boolean,
  ) => {
    for (const key of Object.keys(values)) {
      const value = values[key];
      if (!filterUndefined || value !== undefined) numbers.push(value!);
    }
  };
  visitQualityComponents(components, (value) => numbers.push(value), record);
  // Reject a malformed source before typed-array conversion can coerce a value.
  if (!numbers.every(Number.isFinite)) return undefined;
  const currents: CheckpointCurrentRow[] = [];
  for (const component of document.components) {
    const result = byId.get(component.id);
    if (!result) return undefined;
    const node = (terminal: Terminal) =>
      compiled.netlist.nodeOf.get(terminalKey(component.id, terminal));
    if (result.terminalCurrents !== undefined) {
      const terminals: CheckpointTerminal[] = [];
      for (const [terminal, current] of Object.entries(result.terminalCurrents)) {
        const index = node(terminal);
        if (index === undefined || current === undefined) return undefined;
        terminals.push({ node: index, current, voltage: result.terminalVoltages[terminal] ?? 0 });
      }
      currents.push({ kind: 'terminals', terminals });
    } else if (component.kind === 'led') {
      const a = logicalTerminal(component, 'a'),
        b = logicalTerminal(component, 'b');
      const anode = node(a),
        cathode = node(b);
      if (anode === undefined || cathode === undefined) return undefined;
      currents.push({
        kind: 'led',
        anode,
        cathode,
        voltage: (result.terminalVoltages[a] ?? 0) - (result.terminalVoltages[b] ?? 0),
        current: result.branchCurrents?.['led'] ?? result.current,
      });
    } else if (isArduinoUno(component)) {
      const nodes = new Map<Terminal, number>();
      for (const terminal of Object.keys(result.terminalVoltages)) {
        const index = node(terminal);
        if (index === undefined) return undefined;
        nodes.set(terminal, index);
      }
      currents.push({ kind: 'arduino', component, result, nodes });
    } else return undefined;
  }
  const sourceResiduals = components.flatMap((component) =>
    component.voltageConstraintResidual === undefined ? [] : [component.voltageConstraintResidual],
  );
  return {
    byId,
    currents,
    sourceResiduals,
    numbers: new Float64Array(numbers),
    residuals: new Float64Array(compiled.netlist.nodeCount),
  };
}

/** The owned clock discards this verifier when its immutable document or quality owner changes. */
export function createArduinoCheckpointQuality(
  document: ElectronicsDocument,
  compiled: NumericalCircuitTopology,
  owner: object,
) {
  const layouts = new WeakMap<readonly ComponentResult[], CheckpointQualityColumns>();
  return (handle: ArduinoElectricalCheckpointHandle) => {
    const frame = takeArduinoElectricalCheckpoint(handle, owner, document, compiled);
    if (!frame) return undefined;
    let plan = layouts.get(frame.components);
    if (!plan) {
      plan = compileCheckpointQuality(document, compiled, frame.components);
      if (!plan) return undefined;
      layouts.set(frame.components, plan);
    }
    // Inspect every frozen electrical scalar again; only addresses and immutable observations are shared.
    for (const number of plan.numbers) if (!Number.isFinite(number)) return undefined;
    if (!preparedNumbersFinite({ ...frame, components: [] }, () => undefined)) return undefined;
    for (const thermal of frame.transientState.thermal)
      if (
        !Number.isFinite(Math.round(thermal.temperatureCelsius * 10)) ||
        !Number.isFinite(Math.round(thermal.loadRatio * 10000)) ||
        !Number.isFinite(Math.round(thermal.accumulatedDamage * 10000))
      )
        return undefined;
    const residuals = plan.residuals;
    residuals.fill(0);
    let maxTerminalCurrent = 0,
      totalPower = 0,
      suppliedPower = 0;
    let allTerminalCurrents = true;
    for (const row of plan.currents) {
      let power = 0;
      if (row.kind === 'terminals') {
        for (const terminal of row.terminals) {
          residuals[terminal.node] = residuals[terminal.node]! + terminal.current;
          maxTerminalCurrent = Math.max(maxTerminalCurrent, Math.abs(terminal.current));
          power += terminal.voltage * terminal.current;
        }
      } else if (row.kind === 'led') {
        allTerminalCurrents = false;
        residuals[row.anode] = residuals[row.anode]! + row.current;
        residuals[row.cathode] = residuals[row.cathode]! - row.current;
        power = row.voltage * row.current;
      } else {
        allTerminalCurrents = false;
        const runtime = frame.controllerState.boards.find(
          (board) => board.componentId === row.component.id,
        )?.runtime;
        if (!runtime) return undefined;
        const branches = arduinoOutputBranchesFromSnapshot(
          row.component,
          arduinoSnapshotFromState(runtime),
          frame.controllerState.simulationTimeMs,
        );
        for (const branch of branches) {
          const voltage =
            (row.result.terminalVoltages[branch.terminal] ?? 0) -
            (row.result.terminalVoltages[branch.ground] ?? 0);
          const stamped = row.result.branchCurrents?.[branch.id];
          const terminal = row.nodes.get(branch.terminal),
            ground = row.nodes.get(branch.ground);
          const current = (voltage - branch.targetVoltage) / branch.resistanceOhm;
          if (
            terminal === undefined ||
            ground === undefined ||
            stamped === undefined ||
            !Number.isFinite(stamped) ||
            !Number.isFinite(current) ||
            Math.abs(voltage + stamped * branch.resistanceOhm - branch.targetVoltage) >
              SOURCE_VOLTAGE_TOLERANCE_V
          )
            return undefined;
          residuals[terminal] = residuals[terminal]! + current;
          residuals[ground] = residuals[ground]! - current;
          power += voltage * current;
        }
      }
      totalPower += power;
      suppliedPower += Math.max(0, -power);
    }
    let maxKcl = 0;
    for (const residual of residuals) maxKcl = Math.max(maxKcl, Math.abs(residual));
    const shunt = numericalShuntPowerWatt(compiled, frame, plan.byId);
    const residualPower = Math.abs(totalPower + (shunt ?? 0));
    const allowedPower = powerTolerance(suppliedPower);
    // The ordinary Arduino report omits a partial terminal power sum. Check the full GPIO
    // contribution privately before returning the canonical public metrics.
    if (shunt === null || !(residualPower <= allowedPower)) return undefined;
    let maxSourceResidual = 0;
    for (const residual of plan.sourceResiduals)
      maxSourceResidual = Math.max(maxSourceResidual, Math.abs(residual));
    const quality = finishElectricalQuality(
      true,
      maxKcl,
      maxSourceResidual,
      allTerminalCurrents ? residualPower : 0,
      allTerminalCurrents ? allowedPower : powerTolerance(0),
      kclTolerance(true, maxTerminalCurrent),
      allTerminalCurrents,
      shunt,
    );
    return quality.passed
      ? {
          solved: true,
          quality,
          transientState: frame.transientState,
          components: frame.components,
        }
      : undefined;
  };
}
