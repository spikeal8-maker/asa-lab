import type { ElectronicsDocument, SchematicComponent } from './document.js';
import { buildNetlist, terminalKey } from './netlist.js';

/**
 * Minimal DC analysis for a single series loop: exactly one source and a chain
 * of resistors/LEDs. Enough for the teaching scenario of this slice and small
 * enough to stay fully deterministic and explainable.
 */

export type DiagnosticCode =
  | 'no_source'
  | 'multiple_sources'
  | 'open_circuit'
  | 'short_circuit'
  | 'led_reverse'
  | 'led_no_resistor'
  | 'overcurrent'
  | 'not_series';

export type DiagnosticSeverity = 'info' | 'warning' | 'error';

export interface Diagnostic {
  readonly code: DiagnosticCode;
  readonly severity: DiagnosticSeverity;
  /** Plain-language message for a teacher or a child. */
  readonly message: string;
  readonly componentIds?: readonly string[];
}

export interface ComponentResult {
  readonly componentId: string;
  readonly voltageDrop: number;
  readonly current: number;
  /** LED only. */
  readonly lit?: boolean;
}

export interface SolveResult {
  readonly solved: boolean;
  readonly current: number;
  readonly components: readonly ComponentResult[];
  readonly diagnostics: readonly Diagnostic[];
}

/** LED model: a fixed forward drop above which it conducts and lights up. */
const LED_MIN_CURRENT_A = 0.001;
const LED_MAX_CURRENT_A = 0.03;
const SHORT_CIRCUIT_CURRENT_A = 10;

function round(value: number, digits = 6): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function idsOf(components: readonly SchematicComponent[]): string[] {
  return components.map((component) => component.id);
}

export function solveCircuit(document: ElectronicsDocument): SolveResult {
  const diagnostics: Diagnostic[] = [];
  const sources = document.components.filter((component) => component.kind === 'source');
  const leds = document.components.filter((component) => component.kind === 'led');
  const empty = { solved: false, current: 0, components: [] as ComponentResult[] };

  if (sources.length === 0) {
    diagnostics.push({
      code: 'no_source',
      severity: 'error',
      message: 'В схеме нет источника питания. Добавьте источник и соедините цепь.',
    });
    return { ...empty, diagnostics };
  }
  if (sources.length > 1) {
    diagnostics.push({
      code: 'multiple_sources',
      severity: 'error',
      message: 'В схеме несколько источников. Этот редактор рассчитывает цепь с одним источником.',
      componentIds: idsOf(sources),
    });
    return { ...empty, diagnostics };
  }

  const source = sources[0] as SchematicComponent;
  const netlist = buildNetlist(document);
  const nodeA = netlist.nodeOf.get(terminalKey(source.id, 'a'));
  const nodeB = netlist.nodeOf.get(terminalKey(source.id, 'b'));

  // Elements in the loop: everything except wires (wires only merge nodes).
  const elements = document.components.filter(
    (component) => component.kind === 'resistor' || component.kind === 'led',
  );

  if (nodeA === undefined || nodeB === undefined || nodeA === nodeB) {
    if (nodeA !== undefined && nodeA === nodeB && elements.length === 0) {
      diagnostics.push({
        code: 'short_circuit',
        severity: 'error',
        message:
          'Источник замкнут накоротко: его выводы соединены проводом без резистора. Добавьте резистор.',
        componentIds: [source.id],
      });
      return { ...empty, current: SHORT_CIRCUIT_CURRENT_A, diagnostics };
    }
    diagnostics.push({
      code: 'open_circuit',
      severity: 'error',
      message: 'Цепь разомкнута: ток не может пройти. Соедините элементы в замкнутый контур.',
    });
    return { ...empty, diagnostics };
  }

  // Walk the loop from the source terminal A back to terminal B; every element
  // must be traversed exactly once for a valid series circuit.
  const adjacency = new Map<number, { component: SchematicComponent; other: number }[]>();
  for (const element of elements) {
    const from = netlist.nodeOf.get(terminalKey(element.id, 'a'));
    const to = netlist.nodeOf.get(terminalKey(element.id, 'b'));
    if (from === undefined || to === undefined) continue;
    if (!adjacency.has(from)) adjacency.set(from, []);
    if (!adjacency.has(to)) adjacency.set(to, []);
    (adjacency.get(from) as { component: SchematicComponent; other: number }[]).push({
      component: element,
      other: to,
    });
    (adjacency.get(to) as { component: SchematicComponent; other: number }[]).push({
      component: element,
      other: from,
    });
  }

  const path: { component: SchematicComponent; forward: boolean }[] = [];
  const visitedElements = new Set<string>();
  let node = nodeA;
  while (node !== nodeB) {
    const options = (adjacency.get(node) ?? []).filter(
      (edge) => !visitedElements.has(edge.component.id),
    );
    if (options.length === 0) {
      diagnostics.push({
        code: 'open_circuit',
        severity: 'error',
        message: 'Цепь разомкнута: ток не может пройти. Соедините элементы в замкнутый контур.',
      });
      return { ...empty, diagnostics };
    }
    if (options.length > 1) {
      diagnostics.push({
        code: 'not_series',
        severity: 'error',
        message:
          'Здесь цепь разветвляется. Этот редактор рассчитывает только простую последовательную цепь.',
        componentIds: options.map((edge) => edge.component.id),
      });
      return { ...empty, diagnostics };
    }
    const edge = options[0] as { component: SchematicComponent; other: number };
    const forward = netlist.nodeOf.get(terminalKey(edge.component.id, 'a')) === node;
    visitedElements.add(edge.component.id);
    path.push({ component: edge.component, forward });
    node = edge.other;
  }

  const unusedElements = elements.filter((element) => !visitedElements.has(element.id));
  if (unusedElements.length > 0) {
    diagnostics.push({
      code: 'open_circuit',
      severity: 'warning',
      message: 'Часть элементов не входит в замкнутый контур и не участвует в работе схемы.',
      componentIds: idsOf(unusedElements),
    });
  }

  const pathLeds = path.filter((entry) => entry.component.kind === 'led');
  // Current flows from the source terminal A, so an LED traversed backwards is
  // reverse-biased and blocks the circuit.
  const reversed = pathLeds.filter((entry) => !entry.forward);
  if (reversed.length > 0) {
    diagnostics.push({
      code: 'led_reverse',
      severity: 'error',
      message:
        'Светодиод подключён в обратной полярности и не пропускает ток. Разверните его выводы.',
      componentIds: reversed.map((entry) => entry.component.id),
    });
    return {
      solved: false,
      current: 0,
      components: path.map((entry) => ({
        componentId: entry.component.id,
        voltageDrop: 0,
        current: 0,
        ...(entry.component.kind === 'led' ? { lit: false } : {}),
      })),
      diagnostics,
    };
  }

  const totalResistance = path
    .filter((entry) => entry.component.kind === 'resistor')
    .reduce((sum, entry) => sum + entry.component.value, 0);
  const ledDrop = pathLeds.reduce((sum, entry) => sum + entry.component.value, 0);
  const drivingVoltage = source.value - ledDrop;

  if (totalResistance <= 0) {
    diagnostics.push({
      code: pathLeds.length > 0 ? 'led_no_resistor' : 'short_circuit',
      severity: 'error',
      message:
        pathLeds.length > 0
          ? 'Светодиод подключён без токоограничивающего резистора — так он сгорит. Добавьте резистор.'
          : 'Короткое замыкание: в цепи нет сопротивления. Добавьте резистор.',
      componentIds: pathLeds.length > 0 ? idsOf(leds) : [source.id],
    });
    return { ...empty, current: SHORT_CIRCUIT_CURRENT_A, diagnostics };
  }

  if (drivingVoltage <= 0) {
    diagnostics.push({
      code: 'open_circuit',
      severity: 'warning',
      message:
        'Напряжения источника не хватает, чтобы зажечь светодиод. Возьмите источник с большим напряжением.',
      componentIds: idsOf(leds),
    });
    return {
      solved: true,
      current: 0,
      components: path.map((entry) => ({
        componentId: entry.component.id,
        voltageDrop: 0,
        current: 0,
        ...(entry.component.kind === 'led' ? { lit: false } : {}),
      })),
      diagnostics,
    };
  }

  const current = drivingVoltage / totalResistance;
  if (current > LED_MAX_CURRENT_A && pathLeds.length > 0) {
    diagnostics.push({
      code: 'overcurrent',
      severity: 'warning',
      message: `Ток ${(current * 1000).toFixed(1)} мА выше безопасного для светодиода (20–30 мА). Возьмите резистор побольше.`,
      componentIds: pathLeds.map((entry) => entry.component.id),
    });
  }

  const components: ComponentResult[] = path.map((entry) => {
    if (entry.component.kind === 'resistor') {
      return {
        componentId: entry.component.id,
        voltageDrop: round(current * entry.component.value),
        current: round(current),
      };
    }
    return {
      componentId: entry.component.id,
      voltageDrop: round(entry.component.value),
      current: round(current),
      lit: current >= LED_MIN_CURRENT_A,
    };
  });

  if (diagnostics.length === 0) {
    diagnostics.push({
      code: 'led_no_resistor',
      severity: 'info',
      message: `Цепь замкнута. Ток ${(current * 1000).toFixed(1)} мА.`,
    });
  }

  return { solved: true, current: round(current), components, diagnostics };
}
