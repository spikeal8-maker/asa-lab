import {
  terminalsForComponent,
  type ElectronicsDocument,
  type SchematicComponent,
  type Terminal,
} from './document.js';
import { buildNetlist, terminalKey } from './netlist.js';
import {
  unsupportedElectricalComponents,
  validateElectricalTerminalContract,
} from './model-registry.js';

export type DiagnosticCode =
  | 'circuit_ok'
  | 'no_source'
  | 'open_circuit'
  | 'dangling_terminal'
  | 'short_circuit'
  | 'invalid_property'
  | 'invalid_terminal_contract'
  | 'conflicting_sources'
  | 'reverse_polarity'
  | 'led_near_limit'
  | 'led_overcurrent'
  | 'led_burnout'
  | 'unsupported_component'
  | 'unsupported_topology'
  | 'numerical_instability'
  | 'nonconvergent_topology';
export type DiagnosticSeverity = 'info' | 'warning' | 'error';
export type SimulationSolveStatus = 'solved' | 'invalid' | 'unsupported' | 'nonconvergent';

export interface Diagnostic {
  readonly code: DiagnosticCode;
  readonly severity: DiagnosticSeverity;
  readonly message: string;
  readonly componentIds?: readonly string[];
  readonly wireIds?: readonly string[];
  readonly netIds?: readonly string[];
  readonly suggestedAction?: string;
  readonly anchors?: readonly DiagnosticAnchor[];
}

export interface DiagnosticAnchor {
  readonly kind: 'component' | 'wire' | 'net';
  readonly id: string;
}

export interface ComponentResult {
  readonly componentId: string;
  readonly voltageDrop: number;
  readonly current: number;
  readonly terminalVoltages: Readonly<Partial<Record<Terminal, number>>>;
  readonly power?: number;
  readonly brightness?: number;
  readonly branchCurrents?: Readonly<Record<string, number>>;
  readonly branchBrightness?: Readonly<Record<string, number>>;
  readonly lit?: boolean;
  readonly energized?: boolean;
  readonly currentUtilizationPercent?: number;
  readonly stressState?: 'normal' | 'warning' | 'overcurrent' | 'burned';
}

export interface NodeResult {
  readonly id: string;
  readonly voltage: number;
  readonly terminals: readonly string[];
}

export interface SolveResult {
  readonly solved: boolean;
  readonly status: SimulationSolveStatus;
  readonly current: number;
  readonly components: readonly ComponentResult[];
  readonly nodes: readonly NodeResult[];
  readonly diagnostics: readonly Diagnostic[];
  readonly iterations: number;
  readonly numericalResidual: number;
  readonly numericalTolerance: number;
}

const GMIN = 1e-12;
const CLOSED_RESISTANCE = 1e-4;
const DIODE_ON_RESISTANCE = 2;
// The catalogue voltage is a nominal forward drop measured at useful current,
// not an ideal switch threshold. Use a lower colour-specific knee plus the
// package's dynamic resistance so a 3 V AA holder can drive a blue LED dimly
// through a resistor instead of making the LED jump from fully dark to on.
const LED_DYNAMIC_RESISTANCE = 24;
const INDICATOR_ON_RESISTANCE = 8;
const LED_MIN_CURRENT_A = 0.0001;
const LED_NOMINAL_CURRENT_A = 0.02;
const DEFAULT_LED_MAX_CURRENT_A = 0.03;
const LED_WARNING_RATIO = 0.8;
const LAMP_MIN_POWER_W = 0.001;
const LAMP_NOMINAL_POWER_W = 1.5;
const SHORT_CIRCUIT_CURRENT_A = 5;

const LED_KNEE_VOLTAGE: Readonly<Record<string, number>> = {
  red: 1.65,
  orange: 1.72,
  yellow: 1.78,
  green: 1.85,
  blue: 2.55,
  white: 2.65,
};

const RGB_FORWARD_VOLTAGE: Readonly<Record<string, number>> = {
  red: 1.9,
  green: 2.2,
  blue: 3,
};

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

interface DiodeBranch {
  readonly component: SchematicComponent;
  readonly id: string;
  readonly anode: Terminal;
  readonly cathode: Terminal;
  readonly forwardVoltage: number;
  readonly resistance: number;
  readonly nominalCurrent: number;
  readonly maxCurrent: number;
}

function diodeBranchKey(branch: DiodeBranch): string {
  return `${branch.component.id}:${branch.id}`;
}

function ledBrightness(current: number, nominalCurrent = LED_NOMINAL_CURRENT_A): number {
  if (current < LED_MIN_CURRENT_A) return 0;
  return Math.min(100, Math.pow(current / nominalCurrent, 0.65) * 100);
}

function componentDiodeBranches(component: SchematicComponent): readonly DiodeBranch[] {
  if (component.kind === 'led') {
    const colour = String(component.stateProperties?.['ledColour'] ?? 'red');
    return [
      {
        component,
        id: 'led',
        anode: logicalTerminal(component, 'a'),
        cathode: logicalTerminal(component, 'b'),
        forwardVoltage: LED_KNEE_VOLTAGE[colour] ?? component.value,
        resistance: LED_DYNAMIC_RESISTANCE,
        nominalCurrent: LED_NOMINAL_CURRENT_A,
        maxCurrent: DEFAULT_LED_MAX_CURRENT_A,
      },
    ];
  }
  if (component.kind === 'diode') {
    return [
      {
        component,
        id: 'diode',
        anode: logicalTerminal(component, 'a'),
        cathode: logicalTerminal(component, 'b'),
        forwardVoltage: component.value,
        resistance: DIODE_ON_RESISTANCE,
        nominalCurrent: LED_NOMINAL_CURRENT_A,
        maxCurrent: Number.POSITIVE_INFINITY,
      },
    ];
  }
  if (component.kind === 'rgb-led') {
    const common = 'common';
    const commonAnode = component.stateProperties?.['commonMode'] === 'common-anode';
    return ['red', 'green', 'blue'].map((channel) => ({
      component,
      id: channel,
      anode: commonAnode ? common : channel,
      cathode: commonAnode ? channel : common,
      forwardVoltage: RGB_FORWARD_VOLTAGE[channel] ?? 2,
      resistance: INDICATOR_ON_RESISTANCE,
      nominalCurrent: LED_NOMINAL_CURRENT_A,
      maxCurrent: DEFAULT_LED_MAX_CURRENT_A,
    }));
  }
  if (component.kind === 'seven-segment') {
    const common = 'bottom-3';
    const commonAnode = component.stateProperties?.['commonMode'] === 'common-anode';
    return Object.entries(SEVEN_SEGMENT_TERMINALS).map(([segment, terminal]) => ({
      component,
      id: segment,
      anode: commonAnode ? common : terminal,
      cathode: commonAnode ? terminal : common,
      forwardVoltage: 1.9,
      resistance: INDICATOR_ON_RESISTANCE,
      nominalCurrent: 0.01,
      maxCurrent: 0.02,
    }));
  }
  return [];
}

type LogicalTerminal = 'a' | 'b' | 'wiper';

function logicalTerminal(component: SchematicComponent, terminal: LogicalTerminal): Terminal {
  const type = component.componentTypeId;
  if (!type) return terminal;
  if (component.kind === 'source' && type) {
    const positive = component.pinIds?.includes('BAT+') ? 'BAT+' : 'positive';
    const negative = component.pinIds?.includes('BAT-') ? 'BAT-' : 'negative';
    return terminal === 'a' ? positive : negative;
  }
  if (component.kind === 'resistor') return terminal === 'a' ? 'lead-1' : 'lead-2';
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

function isSimulated(component: SchematicComponent): boolean {
  return !['breadboard', 'visual', 'wire'].includes(component.kind);
}

function round(value: number, digits = 6): number {
  const factor = 10 ** digits;
  const result = Math.round(value * factor) / factor;
  return Object.is(result, -0) ? 0 : result;
}

function solveLinear(matrix: number[][], rhs: number[]): number[] | null {
  const size = rhs.length;
  const augmented = matrix.map((row, index) => [...row, rhs[index] as number]);
  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(augmented[row]?.[column] ?? 0) > Math.abs(augmented[pivot]?.[column] ?? 0)) {
        pivot = row;
      }
    }
    if (Math.abs(augmented[pivot]?.[column] ?? 0) < 1e-14) return null;
    [augmented[column], augmented[pivot]] = [
      augmented[pivot] as number[],
      augmented[column] as number[],
    ];
    const divisor = augmented[column]?.[column] as number;
    for (let cell = column; cell <= size; cell += 1) {
      (augmented[column] as number[])[cell] = (augmented[column]?.[cell] as number) / divisor;
    }
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = augmented[row]?.[column] as number;
      if (Math.abs(factor) < 1e-18) continue;
      for (let cell = column; cell <= size; cell += 1) {
        (augmented[row] as number[])[cell] =
          (augmented[row]?.[cell] as number) - factor * (augmented[column]?.[cell] as number);
      }
    }
  }
  return augmented.map((row) => row[size] as number);
}

function propertyError(component: SchematicComponent): string | null {
  if (!Number.isFinite(component.value) || component.value < 0)
    return 'Значение должно быть неотрицательным числом.';
  if (component.kind === 'source' && component.value <= 0)
    return 'Напряжение источника должно быть больше нуля.';
  if (
    (component.kind === 'resistor' ||
      component.kind === 'lamp' ||
      component.kind === 'potentiometer') &&
    component.value <= 0
  ) {
    return 'Сопротивление должно быть больше нуля.';
  }
  if ((component.kind === 'led' || component.kind === 'diode') && component.value <= 0)
    return 'Прямое падение напряжения должно быть больше нуля.';
  if (component.kind === 'potentiometer' && (component.wiperPosition ?? 0.5) < 0)
    return 'Положение движка должно быть от 0 до 1.';
  if (component.kind === 'potentiometer' && (component.wiperPosition ?? 0.5) > 1)
    return 'Положение движка должно быть от 0 до 1.';
  return null;
}

function withDiagnosticAnchors(diagnostic: Diagnostic): Diagnostic {
  if (diagnostic.anchors) return diagnostic;
  const anchors: DiagnosticAnchor[] = [
    ...(diagnostic.componentIds ?? []).map((id) => ({ kind: 'component' as const, id })),
    ...(diagnostic.wireIds ?? []).map((id) => ({ kind: 'wire' as const, id })),
    ...(diagnostic.netIds ?? []).map((id) => ({ kind: 'net' as const, id })),
  ];
  return anchors.length === 0 ? diagnostic : { ...diagnostic, anchors };
}

export function solveCircuit(document: ElectronicsDocument): SolveResult {
  const diagnostics: Diagnostic[] = [];
  const netlist = buildNetlist(document);
  const sources = document.components.filter((component) => component.kind === 'source');
  const empty = (
    status: Exclude<SimulationSolveStatus, 'solved'>,
    iterations = 0,
    numericalResidual = 0,
    numericalTolerance = 0,
  ): SolveResult => ({
    solved: false,
    status,
    current: 0,
    components: [],
    nodes: [],
    diagnostics: diagnostics.map(withDiagnosticAnchors),
    iterations,
    numericalResidual,
    numericalTolerance,
  });

  const invalid = document.components.flatMap((component) => {
    const message = propertyError(component);
    return message ? [{ component, message }] : [];
  });
  for (const entry of invalid) {
    diagnostics.push({
      code: 'invalid_property',
      severity: 'error',
      message: `${entry.component.name ?? entry.component.id}: ${entry.message}`,
      componentIds: [entry.component.id],
      suggestedAction: 'Исправьте значение в инспекторе компонента.',
    });
  }
  if (invalid.length > 0) return empty('invalid');
  const invalidTerminalContracts = document.components.flatMap((component) => {
    const contract = validateElectricalTerminalContract(component);
    return contract.valid ? [] : [{ component, missing: contract.missing }];
  });
  for (const entry of invalidTerminalContracts) {
    diagnostics.push({
      code: 'invalid_terminal_contract',
      severity: 'error',
      message: `${entry.component.name ?? entry.component.id}: отсутствуют обязательные выводы ${entry.missing.join(', ')}.`,
      componentIds: [entry.component.id],
      suggestedAction: 'Восстановите подтверждённый pin map компонента перед моделированием.',
    });
  }
  if (invalidTerminalContracts.length > 0) return empty('invalid');
  const unsupported = unsupportedElectricalComponents(document.components);
  if (unsupported.length > 0) {
    diagnostics.push({
      code: 'unsupported_component',
      severity: 'error',
      message: `${unsupported.length} компонент(а) не имеют подтверждённой электрической модели. Расчёт остановлен без вымышленных значений.`,
      componentIds: unsupported.map((component) => component.id),
      suggestedAction:
        'Удалите неподдерживаемый компонент или дождитесь отдельной реализации его модели.',
    });
    return empty('unsupported');
  }
  if (sources.length === 0) {
    diagnostics.push({
      code: 'no_source',
      severity: 'error',
      message: 'В схеме нет источника постоянного напряжения.',
      suggestedAction: 'Добавьте источник и соедините замкнутую цепь.',
    });
    return empty('invalid');
  }

  const referenceNode = netlist.nodeOf.get(
    terminalKey(sources[0]!.id, logicalTerminal(sources[0]!, 'b')),
  ) as number;
  for (const source of sources) {
    const a = netlist.nodeOf.get(terminalKey(source.id, logicalTerminal(source, 'a')));
    const b = netlist.nodeOf.get(terminalKey(source.id, logicalTerminal(source, 'b')));
    if (a === undefined || b === undefined || a === b) {
      diagnostics.push({
        code: 'short_circuit',
        severity: 'error',
        message: 'Выводы источника соединены одной идеальной сетью — короткое замыкание.',
        componentIds: [source.id],
        netIds: a === undefined ? [] : [`net-${a}`],
        suggestedAction: 'Разорвите прямое соединение и добавьте нагрузку.',
      });
      return empty('invalid');
    }
  }

  const sourceByNodePair = new Map<
    string,
    { readonly sourceId: string; readonly orientedVoltage: number }
  >();
  for (const source of sources) {
    const positive = netlist.nodeOf.get(
      terminalKey(source.id, logicalTerminal(source, 'a')),
    ) as number;
    const negative = netlist.nodeOf.get(
      terminalKey(source.id, logicalTerminal(source, 'b')),
    ) as number;
    const low = Math.min(positive, negative);
    const high = Math.max(positive, negative);
    const key = `${low}:${high}`;
    const orientedVoltage = positive === low ? source.value : -source.value;
    const existing = sourceByNodePair.get(key);
    if (!existing) {
      sourceByNodePair.set(key, { sourceId: source.id, orientedVoltage });
      continue;
    }
    const sameVoltage = Math.abs(existing.orientedVoltage - orientedVoltage) <= 1e-9;
    diagnostics.push({
      code: sameVoltage ? 'unsupported_topology' : 'conflicting_sources',
      severity: 'error',
      message: sameVoltage
        ? 'Параллельные идеальные источники не имеют однозначного распределения токов.'
        : 'Источники задают разные напряжения между одной парой электрических сетей.',
      componentIds: [existing.sourceId, source.id],
      netIds: [`net-${low}`, `net-${high}`],
      suggestedAction: sameVoltage
        ? 'Оставьте один источник или добавьте подтверждённые внутренние сопротивления.'
        : 'Разъедините конфликтующие источники и проверьте их полярность.',
    });
    return empty(sameVoltage ? 'unsupported' : 'invalid');
  }

  const nodeVariables = new Map<number, number>();
  for (let node = 0; node < netlist.nodeCount; node += 1) {
    if (node !== referenceNode) nodeVariables.set(node, nodeVariables.size);
  }
  const nodeVariableCount = nodeVariables.size;
  const size = nodeVariableCount + sources.length;
  const diodeBranches = document.components.flatMap(componentDiodeBranches);
  const diodeStates = new Map<string, boolean>();
  // Start nonlinear junctions open. A real forward voltage discovered by the
  // first linear solve turns them on; an isolated LED must not create its own
  // artificial voltage across otherwise floating terminals.
  for (const branch of diodeBranches) diodeStates.set(diodeBranchKey(branch), false);

  let solution: number[] | null = null;
  let converged = false;
  let iterations = 1;
  let finalMatrix: number[][] | null = null;
  let finalRhs: number[] | null = null;
  const maxIterations = document.simulation.maxIterations;
  const nodeIndex = (component: SchematicComponent, terminal: LogicalTerminal): number =>
    netlist.nodeOf.get(terminalKey(component.id, logicalTerminal(component, terminal))) as number;
  const physicalNodeIndex = (component: SchematicComponent, terminal: Terminal): number =>
    netlist.nodeOf.get(terminalKey(component.id, terminal)) as number;
  const voltageFrom = (values: number[], node: number): number =>
    node === referenceNode ? 0 : (values[nodeVariables.get(node) as number] as number);

  for (; iterations <= maxIterations; iterations += 1) {
    const matrix = Array.from({ length: size }, () => Array<number>(size).fill(0));
    const rhs = Array<number>(size).fill(0);
    const stampConductance = (left: number, right: number, conductance: number): void => {
      const li = nodeVariables.get(left);
      const ri = nodeVariables.get(right);
      if (li !== undefined) matrix[li]![li] += conductance;
      if (ri !== undefined) matrix[ri]![ri] += conductance;
      if (li !== undefined && ri !== undefined) {
        matrix[li]![ri] -= conductance;
        matrix[ri]![li] -= conductance;
      }
    };
    const stampOffset = (left: number, right: number, current: number): void => {
      const li = nodeVariables.get(left);
      const ri = nodeVariables.get(right);
      if (li !== undefined) rhs[li] += current;
      if (ri !== undefined) rhs[ri] -= current;
    };

    for (const variable of nodeVariables.values()) matrix[variable]![variable] += GMIN;
    for (const component of document.components) {
      if (!isSimulated(component) || component.kind === 'source') continue;
      if (['led', 'diode', 'rgb-led', 'seven-segment'].includes(component.kind)) continue;
      const a = nodeIndex(component, 'a');
      const b = nodeIndex(component, 'b');
      if (component.kind === 'resistor' || component.kind === 'lamp') {
        stampConductance(a, b, 1 / component.value);
      } else if (component.kind === 'switch') {
        if (component.componentTypeId || component.state === true) {
          stampConductance(a, b, 1 / CLOSED_RESISTANCE);
        }
      } else if (component.kind === 'button') {
        if (component.state === true) stampConductance(a, b, 1 / CLOSED_RESISTANCE);
      } else if (component.kind === 'potentiometer') {
        const wiper = nodeIndex(component, 'wiper');
        const position = component.wiperPosition ?? 0.5;
        stampConductance(a, wiper, 1 / Math.max(CLOSED_RESISTANCE, component.value * position));
        stampConductance(
          wiper,
          b,
          1 / Math.max(CLOSED_RESISTANCE, component.value * (1 - position)),
        );
      }
    }

    for (const branch of diodeBranches) {
      const anode = physicalNodeIndex(branch.component, branch.anode);
      const cathode = physicalNodeIndex(branch.component, branch.cathode);
      const active = diodeStates.get(diodeBranchKey(branch)) === true;
      if (active) {
        const conductance = 1 / branch.resistance;
        stampConductance(anode, cathode, conductance);
        stampOffset(anode, cathode, conductance * branch.forwardVoltage);
      } else {
        stampConductance(anode, cathode, GMIN);
      }
    }

    for (const [sourcePosition, source] of sources.entries()) {
      const a = nodeIndex(source, 'a');
      const b = nodeIndex(source, 'b');
      const row = nodeVariableCount + sourcePosition;
      const ai = nodeVariables.get(a);
      const bi = nodeVariables.get(b);
      if (ai !== undefined) {
        matrix[ai]![row] += 1;
        matrix[row]![ai] += 1;
      }
      if (bi !== undefined) {
        matrix[bi]![row] -= 1;
        matrix[row]![bi] -= 1;
      }
      rhs[row] = source.value;
    }

    finalMatrix = matrix;
    finalRhs = rhs;
    solution = solveLinear(matrix, rhs);
    if (!solution) break;
    let changed = false;
    for (const branch of diodeBranches) {
      const drop =
        voltageFrom(solution, physicalNodeIndex(branch.component, branch.anode)) -
        voltageFrom(solution, physicalNodeIndex(branch.component, branch.cathode));
      const next = drop >= branch.forwardVoltage - 0.02;
      const key = diodeBranchKey(branch);
      if (next !== diodeStates.get(key)) {
        diodeStates.set(key, next);
        changed = true;
      }
    }
    if (!changed) {
      converged = true;
      break;
    }
  }

  if (!solution || !converged) {
    diagnostics.push({
      code: 'nonconvergent_topology',
      severity: 'error',
      message: 'DC-расчёт не сошёлся для этой топологии.',
      suggestedAction: 'Проверьте источники, короткие замыкания и полярность диодов.',
    });
    return empty('nonconvergent', iterations);
  }

  const numericalResidual = Math.max(
    0,
    ...(finalMatrix ?? []).map((row, rowIndex) =>
      Math.abs(
        row.reduce(
          (sum, coefficient, columnIndex) =>
            sum + coefficient * ((solution as number[])[columnIndex] ?? 0),
          0,
        ) - ((finalRhs ?? [])[rowIndex] ?? 0),
      ),
    ),
  );
  const numericalScale = Math.max(
    1,
    ...(finalRhs ?? []).map(Math.abs),
    ...(solution ?? []).map(Math.abs),
  );
  const numericalTolerance = 1e-9 * numericalScale;
  if (!Number.isFinite(numericalResidual) || numericalResidual > numericalTolerance) {
    diagnostics.push({
      code: 'numerical_instability',
      severity: 'error',
      message: 'Численная невязка DC-расчёта превышает допустимый предел.',
      suggestedAction: 'Проверьте источники, экстремальные сопротивления и короткие замыкания.',
    });
    return empty('nonconvergent', iterations, numericalResidual, numericalTolerance);
  }

  const voltageAt = (component: SchematicComponent, terminal: LogicalTerminal): number =>
    voltageFrom(solution as number[], nodeIndex(component, terminal));
  const physicalVoltageAt = (component: SchematicComponent, terminal: Terminal): number => {
    const node = netlist.nodeOf.get(terminalKey(component.id, terminal));
    return node === undefined ? 0 : voltageFrom(solution as number[], node);
  };
  const sourceCurrents = new Map<string, number>();
  for (const [position, source] of sources.entries()) {
    sourceCurrents.set(source.id, solution[nodeVariableCount + position] as number);
  }
  const resultForBranch = (branch: DiodeBranch) => {
    const voltageDrop =
      physicalVoltageAt(branch.component, branch.anode) -
      physicalVoltageAt(branch.component, branch.cathode);
    const current = diodeStates.get(diodeBranchKey(branch))
      ? Math.max(0, (voltageDrop - branch.forwardVoltage) / branch.resistance)
      : 0;
    return {
      voltageDrop,
      current,
      brightness: ledBrightness(current, branch.nominalCurrent),
    };
  };

  const components: ComponentResult[] = document.components
    .filter((component) => component.kind !== 'wire')
    .map((component) => {
      const terminalVoltages: Partial<Record<Terminal, number>> = {};
      for (const terminal of terminalsForComponent(component)) {
        terminalVoltages[terminal] = round(physicalVoltageAt(component, terminal));
      }
      const branches = diodeBranches.filter((branch) => branch.component.id === component.id);
      const branchResults = branches.map((branch) => ({ branch, ...resultForBranch(branch) }));
      const voltageDrop =
        branchResults[0]?.voltageDrop ??
        (isSimulated(component) ? voltageAt(component, 'a') - voltageAt(component, 'b') : 0);
      let current = 0;
      if (component.kind === 'source') current = -(sourceCurrents.get(component.id) ?? 0);
      else if (component.kind === 'resistor' || component.kind === 'lamp')
        current = voltageDrop / component.value;
      else if (component.kind === 'switch')
        current = component.componentTypeId
          ? voltageDrop / CLOSED_RESISTANCE
          : component.state === true
            ? voltageDrop / CLOSED_RESISTANCE
            : 0;
      else if (component.kind === 'button')
        current = component.state === true ? voltageDrop / CLOSED_RESISTANCE : 0;
      else if (component.kind === 'potentiometer') {
        const position = component.wiperPosition ?? 0.5;
        current =
          (voltageAt(component, 'a') - voltageAt(component, 'wiper')) /
          Math.max(CLOSED_RESISTANCE, component.value * position);
      } else if (branches.length > 0)
        current = branchResults.reduce((sum, branch) => sum + branch.current, 0);
      const power = Math.abs(
        component.kind === 'lamp'
          ? current * voltageDrop
          : branchResults.length > 0
            ? branchResults.reduce((sum, branch) => sum + branch.current * branch.voltageDrop, 0)
            : current * voltageDrop,
      );
      const branchCurrents = Object.fromEntries(
        branchResults.map(({ branch, current: branchCurrent }) => [
          branch.id,
          round(branchCurrent),
        ]),
      );
      const branchBrightness = Object.fromEntries(
        branchResults.map(({ branch, brightness }) => [branch.id, round(brightness, 2)]),
      );
      const brightness =
        component.kind === 'lamp'
          ? Math.min(100, Math.pow(power / LAMP_NOMINAL_POWER_W, 0.55) * 100)
          : Math.max(0, ...Object.values(branchBrightness));
      const currentUtilizationPercent =
        branches.length > 0
          ? Math.max(
              0,
              ...branchResults.map(({ branch, current: branchCurrent }) =>
                Math.abs((branchCurrent / branch.nominalCurrent) * 100),
              ),
            )
          : undefined;
      const stressState =
        branches.length === 0
          ? undefined
          : branchResults.some(
                ({ branch, current: branchCurrent }) => Math.abs(branchCurrent) > branch.maxCurrent,
              )
            ? 'burned'
            : branchResults.some(
                  ({ branch, current: branchCurrent }) =>
                    Math.abs(branchCurrent) > branch.nominalCurrent,
                )
              ? 'overcurrent'
              : branchResults.some(
                    ({ branch, current: branchCurrent }) =>
                      Math.abs(branchCurrent) >= branch.nominalCurrent * LED_WARNING_RATIO,
                  )
                ? 'warning'
                : 'normal';
      return {
        componentId: component.id,
        voltageDrop: round(voltageDrop),
        current: round(current),
        terminalVoltages,
        power: round(power),
        brightness: round(brightness, 2),
        ...(branches.length > 0 ? { branchCurrents, branchBrightness } : {}),
        ...(currentUtilizationPercent === undefined || stressState === undefined
          ? {}
          : {
              currentUtilizationPercent: round(currentUtilizationPercent, 2),
              stressState,
            }),
        ...(component.kind === 'led' ||
        component.kind === 'rgb-led' ||
        component.kind === 'seven-segment'
          ? { lit: brightness > 0 }
          : {}),
        ...(component.kind === 'lamp'
          ? {
              lit: Math.abs(current * voltageDrop) >= LAMP_MIN_POWER_W,
              energized: Math.abs(current) > 1e-6,
            }
          : {}),
      };
    });

  const connectionCount = new Map<string, number>();
  for (const connection of document.connections) {
    for (const endpoint of [connection.from, connection.to]) {
      const key = terminalKey(endpoint.componentId, endpoint.terminal);
      connectionCount.set(key, (connectionCount.get(key) ?? 0) + 1);
    }
  }
  for (const component of document.components) {
    for (const [pinId, binding] of Object.entries(component.holeBindings ?? {})) {
      connectionCount.set(terminalKey(component.id, pinId), 1);
      connectionCount.set(terminalKey(binding.breadboardComponentId, binding.holeId), 1);
    }
  }
  for (const component of document.components.filter(isSimulated)) {
    if (component.kind === 'rgb-led' || component.kind === 'seven-segment') continue;
    const logical = [logicalTerminal(component, 'a'), logicalTerminal(component, 'b')];
    if (component.kind === 'potentiometer') logical.push(logicalTerminal(component, 'wiper'));
    const dangling = logical.filter(
      (terminal) => !connectionCount.get(terminalKey(component.id, terminal)),
    );
    if (dangling.length > 0) {
      diagnostics.push({
        code: 'dangling_terminal',
        severity: 'warning',
        message: `${component.name ?? component.id}: не подключены выводы ${dangling.join(', ')}.`,
        componentIds: [component.id],
        suggestedAction: 'Соедините свободные выводы или удалите неиспользуемый компонент.',
      });
    }
  }

  for (const component of document.components.filter(
    (item) => componentDiodeBranches(item).length > 0,
  )) {
    const componentBranches = diodeBranches.filter(
      (branch) => branch.component.id === component.id,
    );
    const result = components.find((entry) => entry.componentId === component.id);
    const reverseBranches = componentBranches.filter((branch) => {
      const anodeVoltage = result?.terminalVoltages[branch.anode] ?? 0;
      const cathodeVoltage = result?.terminalVoltages[branch.cathode] ?? 0;
      return anodeVoltage - cathodeVoltage < -0.05;
    });
    if (reverseBranches.length > 0) {
      const isTwoTerminalDiode = component.kind === 'led' || component.kind === 'diode';
      diagnostics.push({
        code: 'reverse_polarity',
        severity: 'warning',
        message: `${component.name ?? component.id}: обратная полярность${
          isTwoTerminalDiode
            ? ' — анод подключён к минусу, катод к плюсу.'
            : ` ${reverseBranches.map((branch) => branch.id).join(', ')}.`
        }`,
        componentIds: [component.id],
        suggestedAction: isTwoTerminalDiode
          ? 'Подключите BAT+ к аноду, BAT− к катоду.'
          : 'Проверьте анод, катод и общий вывод.',
      });
    }
    const nearLimit = componentBranches.filter((branch) => {
      const current = Math.abs(result?.branchCurrents?.[branch.id] ?? 0);
      return (
        current >= branch.nominalCurrent * LED_WARNING_RATIO && current <= branch.nominalCurrent
      );
    });
    if (nearLimit.length > 0) {
      diagnostics.push({
        code: 'led_near_limit',
        severity: 'warning',
        message: `${component.name ?? component.id}: ток близок к номинальному пределу в ${nearLimit.map((branch) => branch.id).join(', ')}. Светодиод пока работает, но запас по току мал.`,
        componentIds: [component.id],
        suggestedAction: 'Увеличьте сопротивление, чтобы оставить безопасный запас по току.',
      });
    }
    const overloaded = componentBranches.filter(
      (branch) => Math.abs(result?.branchCurrents?.[branch.id] ?? 0) > branch.nominalCurrent,
    );
    if (overloaded.length > 0) {
      diagnostics.push({
        code: 'led_overcurrent',
        severity: 'warning',
        message: `${component.name ?? component.id}: ток выше номинальных ${(overloaded[0]!.nominalCurrent * 1000).toFixed(0)} мА в ${overloaded.map((branch) => branch.id).join(', ')}. Возможна деградация светодиода.`,
        componentIds: [component.id],
        suggestedAction: 'Увеличьте токоограничивающее сопротивление.',
      });
    }
    const burnedOut = componentBranches.filter(
      (branch) => Math.abs(result?.branchCurrents?.[branch.id] ?? 0) > branch.maxCurrent,
    );
    if (burnedOut.length > 0) {
      diagnostics.push({
        code: 'led_burnout',
        severity: 'error',
        message: `${component.name ?? component.id}: ток превысил разрушительный предел ${(burnedOut[0]!.maxCurrent * 1000).toFixed(0)} мА в ${burnedOut.map((branch) => branch.id).join(', ')}. Светодиод перегорел в этой рабочей точке.`,
        componentIds: [component.id],
        suggestedAction:
          'Остановите моделирование, уменьшите напряжение или добавьте сопротивление.',
      });
    }
  }

  const totalSourceCurrent = Math.max(
    ...sources.map((source) => Math.abs(sourceCurrents.get(source.id) ?? 0)),
  );
  if (totalSourceCurrent > SHORT_CIRCUIT_CURRENT_A) {
    diagnostics.push({
      code: 'short_circuit',
      severity: 'error',
      message: `Ток источника ${totalSourceCurrent.toFixed(2)} А указывает на короткое замыкание.`,
      componentIds: sources.map((source) => source.id),
      suggestedAction: 'Остановите моделирование и добавьте сопротивление в путь тока.',
    });
  } else if (totalSourceCurrent < 1e-8) {
    diagnostics.push({
      code: 'open_circuit',
      severity: 'warning',
      message: 'Источник не отдаёт ток: цепь разомкнута или блокируется полярным элементом.',
      componentIds: sources.map((source) => source.id),
      suggestedAction: 'Замкните переключатель и проверьте все соединения и полярность.',
    });
  }

  if (!diagnostics.some((diagnostic) => diagnostic.severity !== 'info')) {
    diagnostics.push({
      code: 'circuit_ok',
      severity: 'info',
      message: `DC-расчёт завершён. Ток источника ${(totalSourceCurrent * 1000).toFixed(2)} мА.`,
    });
  }

  const nodes: NodeResult[] = Array.from({ length: netlist.nodeCount }, (_, node) => ({
    id: `net-${node}`,
    voltage: round(voltageFrom(solution as number[], node)),
    terminals: netlist.terminalsByNode.get(node) ?? [],
  }));
  return {
    solved: true,
    status: 'solved',
    current: round(totalSourceCurrent),
    components,
    nodes,
    diagnostics: diagnostics.map(withDiagnosticAnchors),
    iterations,
    numericalResidual,
    numericalTolerance,
  };
}
