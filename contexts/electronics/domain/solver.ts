import {
  terminalsForComponent,
  type ElectronicsDocument,
  type SchematicComponent,
  type Terminal,
} from './document.js';
import { buildNetlist, terminalKey } from './netlist.js';

export type DiagnosticCode =
  | 'circuit_ok'
  | 'no_source'
  | 'open_circuit'
  | 'dangling_terminal'
  | 'short_circuit'
  | 'invalid_property'
  | 'reverse_polarity'
  | 'led_overcurrent'
  | 'unsupported_component'
  | 'nonconvergent_topology';
export type DiagnosticSeverity = 'info' | 'warning' | 'error';

export interface Diagnostic {
  readonly code: DiagnosticCode;
  readonly severity: DiagnosticSeverity;
  readonly message: string;
  readonly componentIds?: readonly string[];
  readonly wireIds?: readonly string[];
  readonly netIds?: readonly string[];
  readonly suggestedAction?: string;
}

export interface ComponentResult {
  readonly componentId: string;
  readonly voltageDrop: number;
  readonly current: number;
  readonly terminalVoltages: Readonly<Partial<Record<Terminal, number>>>;
  readonly lit?: boolean;
  readonly energized?: boolean;
}

export interface NodeResult {
  readonly id: string;
  readonly voltage: number;
  readonly terminals: readonly string[];
}

export interface SolveResult {
  readonly solved: boolean;
  readonly current: number;
  readonly components: readonly ComponentResult[];
  readonly nodes: readonly NodeResult[];
  readonly diagnostics: readonly Diagnostic[];
  readonly iterations: number;
}

const GMIN = 1e-12;
const CLOSED_RESISTANCE = 1e-4;
const DIODE_ON_RESISTANCE = 2;
const LED_ON_RESISTANCE = 8;
const LED_MIN_CURRENT_A = 0.001;
const DEFAULT_LED_MAX_CURRENT_A = 0.03;
const LAMP_MIN_POWER_W = 0.001;
const SHORT_CIRCUIT_CURRENT_A = 5;

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
  return !['rgb-led', 'seven-segment', 'breadboard', 'visual', 'wire'].includes(component.kind);
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

export function solveCircuit(document: ElectronicsDocument): SolveResult {
  const diagnostics: Diagnostic[] = [];
  const netlist = buildNetlist(document);
  const sources = document.components.filter((component) => component.kind === 'source');
  const empty = (iterations = 0): SolveResult => ({
    solved: false,
    current: 0,
    components: [],
    nodes: [],
    diagnostics,
    iterations,
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
  if (invalid.length > 0) return empty();
  const unsupported = document.components.filter((component) =>
    ['rgb-led', 'seven-segment', 'visual'].includes(component.kind),
  );
  if (unsupported.length > 0) {
    diagnostics.push({
      code: 'unsupported_component',
      severity: 'warning',
      message: `${unsupported.length} production-компонент(а) показаны визуально без электрической модели.`,
      componentIds: unsupported.map((component) => component.id),
      suggestedAction:
        'Их variant/state сохранены; solver не подменяет расчёт вымышленными значениями.',
    });
  }
  if (sources.length === 0) {
    diagnostics.push({
      code: 'no_source',
      severity: 'error',
      message: 'В схеме нет источника постоянного напряжения.',
      suggestedAction: 'Добавьте источник и соедините замкнутую цепь.',
    });
    return empty();
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
      return empty();
    }
  }

  const nodeVariables = new Map<number, number>();
  for (let node = 0; node < netlist.nodeCount; node += 1) {
    if (node !== referenceNode) nodeVariables.set(node, nodeVariables.size);
  }
  const nodeVariableCount = nodeVariables.size;
  const size = nodeVariableCount + sources.length;
  const diodeStates = new Map<string, boolean>();
  for (const component of document.components) {
    if (component.kind === 'led' || component.kind === 'diode') diodeStates.set(component.id, true);
  }

  let solution: number[] | null = null;
  let converged = false;
  let iterations = 1;
  const maxIterations = document.simulation.maxIterations;
  const nodeIndex = (component: SchematicComponent, terminal: LogicalTerminal): number =>
    netlist.nodeOf.get(terminalKey(component.id, logicalTerminal(component, terminal))) as number;
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
      } else if (component.kind === 'led' || component.kind === 'diode') {
        const active = diodeStates.get(component.id) === true;
        const resistance = component.kind === 'led' ? LED_ON_RESISTANCE : DIODE_ON_RESISTANCE;
        if (active) {
          const conductance = 1 / resistance;
          stampConductance(a, b, conductance);
          stampOffset(a, b, conductance * component.value);
        } else {
          stampConductance(a, b, GMIN);
        }
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

    solution = solveLinear(matrix, rhs);
    if (!solution) break;
    let changed = false;
    for (const component of document.components) {
      if (component.kind !== 'led' && component.kind !== 'diode') continue;
      const drop =
        voltageFrom(solution, nodeIndex(component, 'a')) -
        voltageFrom(solution, nodeIndex(component, 'b'));
      const next = drop >= component.value - 0.02;
      if (next !== diodeStates.get(component.id)) {
        diodeStates.set(component.id, next);
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
    return empty(iterations);
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

  const components: ComponentResult[] = document.components
    .filter((component) => component.kind !== 'wire')
    .map((component) => {
      const terminalVoltages: Partial<Record<Terminal, number>> = {};
      for (const terminal of terminalsForComponent(component)) {
        terminalVoltages[terminal] = round(physicalVoltageAt(component, terminal));
      }
      const voltageDrop = isSimulated(component)
        ? voltageAt(component, 'a') - voltageAt(component, 'b')
        : 0;
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
      } else if (
        (component.kind === 'led' || component.kind === 'diode') &&
        diodeStates.get(component.id)
      ) {
        current = Math.max(
          0,
          (voltageDrop - component.value) /
            (component.kind === 'led' ? LED_ON_RESISTANCE : DIODE_ON_RESISTANCE),
        );
      }
      return {
        componentId: component.id,
        voltageDrop: round(voltageDrop),
        current: round(current),
        terminalVoltages,
        ...(component.kind === 'led' ? { lit: current >= LED_MIN_CURRENT_A } : {}),
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
    (item) => item.kind === 'led' || item.kind === 'diode',
  )) {
    const result = components.find((entry) => entry.componentId === component.id);
    if ((result?.voltageDrop ?? 0) < -0.05) {
      diagnostics.push({
        code: 'reverse_polarity',
        severity: 'warning',
        message: `${component.kind === 'led' ? 'Светодиод' : 'Диод'} подключён в обратной полярности.`,
        componentIds: [component.id],
        suggestedAction: 'Поменяйте местами анод A и катод K.',
      });
    }
    if (component.kind === 'led' && Math.abs(result?.current ?? 0) > DEFAULT_LED_MAX_CURRENT_A) {
      diagnostics.push({
        code: 'led_overcurrent',
        severity: 'error',
        message: `Ток LED ${(Math.abs(result?.current ?? 0) * 1000).toFixed(1)} мА выше безопасного предела.`,
        componentIds: [component.id],
        suggestedAction: 'Увеличьте токоограничивающее сопротивление.',
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
    solved: !diagnostics.some((diagnostic) => diagnostic.severity === 'error'),
    current: round(totalSourceCurrent),
    components,
    nodes,
    diagnostics,
    iterations,
  };
}
