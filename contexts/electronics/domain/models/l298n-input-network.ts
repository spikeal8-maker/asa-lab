import type { ElectronicsDocument, SchematicComponent, Terminal } from '../document.js';
import type { ArduinoRuntimeSnapshot } from '../arduino-model.js';
import { ARDUINO_GROUND_TERMINALS, isArduinoUno } from '../arduino-model.js';
import { arduinoRuntimeStateMatchesProgram } from '../arduino-program-runtime.js';
import { terminalKey } from '../netlist.js';
import { switchContactClosed, switchSelectedTerminal } from '../switch-topology.js';
import { regulatedPowerSupplySettings } from './regulated-power-supply-model.js';
import {
  L298N_BOARD_PROFILE,
  l298nConfiguration,
  l298nRegulatorInputVoltage,
} from './l298n-dc-model.js';

type Nodes = ReadonlyMap<string, number>;
type LogicalTerminal = 'a' | 'b' | 'wiper';
const CONTROL_PINS = ['IN1', 'IN2', 'IN3', 'IN4', 'ENA', 'ENB'] as const;

/** Only passive connections, never the internal terminals of an IC or a motor. */
function passiveNetwork(document: ElectronicsDocument, nodes: Nodes, failed: ReadonlySet<string>) {
  const parent = new Map<number, number>();
  const adjacent = new Map<number, Set<number>>();
  for (const node of nodes.values()) if (!parent.has(node)) parent.set(node, node);
  const root = (node: number | undefined): number | undefined => {
    if (node === undefined || !parent.has(node)) return undefined;
    let current: number = node;
    let top = current;
    while (parent.get(top) !== top) top = parent.get(top)!;
    while (parent.get(current) !== current) {
      const next: number = parent.get(current)!;
      parent.set(current, top);
      current = next;
    }
    return top;
  };
  const join = (left: number | undefined, right: number | undefined) => {
    if (left !== undefined && right !== undefined) {
      if (!adjacent.has(left)) adjacent.set(left, new Set());
      if (!adjacent.has(right)) adjacent.set(right, new Set());
      adjacent.get(left)!.add(right);
      adjacent.get(right)!.add(left);
    }
    const a = root(left),
      b = root(right);
    if (a !== undefined && b !== undefined && a !== b) parent.set(b, a);
  };
  const pin = (component: SchematicComponent, terminal: Terminal) =>
    nodes.get(terminalKey(component.id, terminal));
  const passiveTerminal = (component: SchematicComponent, terminal: LogicalTerminal): Terminal => {
    if (!component.componentTypeId) return terminal;
    if (component.kind === 'resistor' || component.kind === 'photoresistor')
      return terminal === 'a' ? 'lead-1' : 'lead-2';
    if (component.kind === 'potentiometer')
      return terminal === 'wiper' ? 'wiper' : terminal === 'a' ? 'terminal-1' : 'terminal-2';
    if (component.kind === 'switch')
      return terminal === 'a' ? 'common' : switchSelectedTerminal(component);
    if (component.kind === 'button') return terminal === 'a' ? 'SW-A1' : 'SW-B1';
    return terminal;
  };
  const pair = (component: SchematicComponent, a: LogicalTerminal, b: LogicalTerminal) =>
    join(
      pin(component, passiveTerminal(component, a)),
      pin(component, passiveTerminal(component, b)),
    );
  for (const component of document.components) {
    if (failed.has(component.id)) continue;
    if (component.kind === 'resistor' || component.kind === 'photoresistor') {
      pair(component, 'a', 'b');
    } else if (component.kind === 'potentiometer') {
      pair(component, 'a', 'wiper');
      pair(component, 'wiper', 'b');
    } else if (component.kind === 'switch' && switchContactClosed(component)) {
      pair(component, 'a', 'b');
    } else if (component.kind === 'button') {
      join(pin(component, 'SW-A1'), pin(component, 'SW-A2'));
      join(pin(component, 'SW-B1'), pin(component, 'SW-B2'));
      if (component.state === true) pair(component, 'a', 'b');
    }
  }
  return { root, join, pin, adjacent };
}

/** GPIO can reach a control through a resistor/pot/switch; power sources do not join this graph. */
export function l298nControlNetIndices(
  document: ElectronicsDocument,
  nodes: Nodes,
  driverId?: string,
  failedComponentIds: ReadonlySet<string> = new Set(),
): ReadonlySet<number> {
  const drivers = document.components.filter(
    (component) =>
      component.componentTypeId === 'l298n-motor-driver' &&
      (driverId === undefined || component.id === driverId) &&
      !failedComponentIds.has(component.id),
  );
  if (drivers.length === 0) return new Set();
  const network = passiveNetwork(document, nodes, failedComponentIds);
  // A signal can pass through a series resistor/switch, but never through a
  // shared supply rail into an unrelated consumer. Electrical reference
  // connectivity and PWM signal reachability are deliberately different graphs.
  const rails = new Set<number>();
  for (const component of document.components) {
    const pins: readonly Terminal[] =
      component.componentTypeId === 'l298n-motor-driver'
        ? ['GND', '+5V', '+12V']
        : isArduinoUno(component)
          ? [...ARDUINO_GROUND_TERMINALS, 'power-5v', 'power-3v3', 'power-vin']
          : [];
    for (const pin of pins) {
      const node = network.pin(component, pin);
      if (node !== undefined) rails.add(node);
    }
  }
  const result = new Set<number>();
  const pending: number[] = [];
  for (const driver of drivers)
    for (const pin of CONTROL_PINS) {
      if (pin === 'ENA' && driver.stateProperties?.['enaJumperInstalled'] !== false) continue;
      if (pin === 'ENB' && driver.stateProperties?.['enbJumperInstalled'] !== false) continue;
      const node = network.pin(driver, pin);
      if (node !== undefined && !rails.has(node)) pending.push(node);
    }
  while (pending.length > 0) {
    const node = pending.pop()!;
    if (result.has(node) || rails.has(node)) continue;
    result.add(node);
    for (const neighbour of network.adjacent.get(node) ?? [])
      if (!rails.has(neighbour) && !result.has(neighbour)) pending.push(neighbour);
  }
  return result;
}

interface DriveContext {
  readonly document: ElectronicsDocument;
  readonly nodeOf: Nodes;
  readonly sources: readonly SchematicComponent[];
  readonly arduinoBranches: readonly {
    readonly component: SchematicComponent;
    readonly terminal: Terminal;
    readonly ground: Terminal;
    readonly targetVoltage: number;
  }[];
  readonly failedComponentIds: ReadonlySet<string>;
  readonly logicalNode: (
    component: SchematicComponent,
    terminal: LogicalTerminal,
  ) => number | undefined;
  readonly physicalNode: (component: SchematicComponent, terminal: Terminal) => number | undefined;
}

/**
 * An arbitrary wire/passive neighbour is not a voltage reference. The active
 * frame's sources/Arduino branches extend the passive graph; GPIO INPUT and
 * failed/off sources do not become fictitious drivers. No frame is cached.
 */
export function createL298nInputDriveResolver(context: DriveContext) {
  const network = passiveNetwork(context.document, context.nodeOf, context.failedComponentIds);
  for (const source of context.sources) {
    if (context.failedComponentIds.has(source.id)) continue;
    if (source.componentTypeId === 'regulated-power-supply') {
      const settings = regulatedPowerSupplySettings(source);
      if (!settings.outputEnabled || settings.currentLimitAmp <= 0) continue;
    }
    network.join(context.logicalNode(source, 'a'), context.logicalNode(source, 'b'));
  }
  for (const branch of context.arduinoBranches) {
    if (context.failedComponentIds.has(branch.component.id)) continue;
    network.join(
      network.pin(branch.component, branch.terminal),
      network.pin(branch.component, branch.ground),
    );
  }
  return (component: SchematicComponent, terminals: readonly Terminal[]): ReadonlySet<Terminal> => {
    const references = new Set<number>();
    for (const pin of ['GND', '+5V']) {
      const root = network.root(context.physicalNode(component, pin));
      if (root !== undefined) references.add(root);
    }
    return new Set(
      terminals.filter((pin) => {
        const root = network.root(context.physicalNode(component, pin));
        return root !== undefined && references.has(root);
      }),
    );
  };
}

/**
 * Detect an active parallel logic source through passive wiring. Do not join
 * the source's own terminals: a path through the common return is not a power
 * feed. Failed/off sources and unpowered peer regulators are only loads.
 */
export function createL298nLogicSourceResolver(context: DriveContext) {
  const network = passiveNetwork(context.document, context.nodeOf, context.failedComponentIds);
  const reachable = (start: number, blocked: number): ReadonlySet<number> => {
    const visited = new Set<number>();
    const pending = [start];
    while (pending.length > 0) {
      const node = pending.pop()!;
      if (node === blocked || visited.has(node)) continue;
      visited.add(node);
      for (const adjacent of network.adjacent.get(node) ?? [])
        if (adjacent !== blocked && !visited.has(adjacent)) pending.push(adjacent);
    }
    return visited;
  };
  const sources = context.sources.filter((source) => {
    if (context.failedComponentIds.has(source.id)) return false;
    if (source.componentTypeId !== 'regulated-power-supply') return true;
    const settings = regulatedPowerSupplySettings(source);
    return settings.outputEnabled && settings.currentLimitAmp > 0;
  });
  const branches = context.arduinoBranches.filter(
    (branch) => !context.failedComponentIds.has(branch.component.id) && branch.targetVoltage > 0,
  );
  const controlNets = new Map<string, ReadonlySet<number>>();
  const regulators = context.document.components.filter(
    (component) =>
      component.componentTypeId === 'l298n-motor-driver' &&
      !context.failedComponentIds.has(component.id) &&
      l298nConfiguration(component).regulatorJumperInstalled,
  );
  return (
    component: SchematicComponent,
    voltage: (other: SchematicComponent, terminal: Terminal) => number,
  ): boolean => {
    const logic = context.physicalNode(component, '+5V');
    const ground = context.physicalNode(component, 'GND');
    if (logic === undefined || ground === undefined || logic === ground) return false;
    const feed = reachable(logic, ground);
    const returns = reachable(ground, logic);
    const motorSupply = l298nRegulatorInputVoltage(
      voltage(component, '+12V') - voltage(component, 'GND'),
    );
    const onboardLogicPowerAvailable =
      l298nConfiguration(component).regulatorJumperInstalled &&
      motorSupply >= L298N_BOARD_PROFILE.regulator.minimumInputVolt &&
      motorSupply <= L298N_BOARD_PROFILE.regulator.maximumInputVolt;
    let signals = controlNets.get(component.id);
    if (!signals) {
      signals = l298nControlNetIndices(
        context.document,
        context.nodeOf,
        component.id,
        context.failedComponentIds,
      );
      controlNets.set(component.id, signals);
    }
    const connected = (a: number | undefined, b: number | undefined) =>
      a !== undefined &&
      b !== undefined &&
      a !== b &&
      ((feed.has(a) && returns.has(b)) || (feed.has(b) && returns.has(a)));
    if (
      sources.some((source) =>
        connected(context.logicalNode(source, 'a'), context.logicalNode(source, 'b')),
      )
    )
      return true;
    if (
      branches.some((branch) => {
        const output = network.pin(branch.component, branch.terminal);
        // A GPIO pull-up is a signal only while this board's regulator can
        // actually power the logic. Otherwise it can backfeed +5V through the
        // pull-up. LOW is a sink; explicit power pins are always supplies.
        // Scope the exemption to this board so controlling B cannot hide a
        // separate GPIO feed into A's +5V rail.
        if (
          onboardLogicPowerAvailable &&
          branch.terminal !== 'power-5v' &&
          branch.terminal !== 'power-3v3' &&
          output !== undefined &&
          signals.has(output)
        )
          return false;
        return connected(output, network.pin(branch.component, branch.ground));
      })
    )
      return true;
    return regulators.some((other) => {
      if (
        other.id === component.id ||
        !connected(context.physicalNode(other, '+5V'), context.physicalNode(other, 'GND'))
      )
        return false;
      const supply = l298nRegulatorInputVoltage(voltage(other, '+12V') - voltage(other, 'GND'));
      return (
        supply >= L298N_BOARD_PROFILE.regulator.minimumInputVolt &&
        supply <= L298N_BOARD_PROFILE.regulator.maximumInputVolt
      );
    });
  };
}

/**
 * Only actual unconfigured GPIO in setup (or the canonical empty bootstrap
 * frame at t=0) may temporarily coast. This does not assign LOW to an input,
 * does not exempt a passive dangling wire and expires on entry to loop.
 */
export function l298nArduinoSetupHighImpedance(
  component: SchematicComponent,
  missingInputs: readonly Terminal[],
  document: ElectronicsDocument,
  nodes: Nodes,
  snapshots: ReadonlyMap<string, ArduinoRuntimeSnapshot>,
  simulationTimeMs: number,
  failedComponentIds: ReadonlySet<string> = new Set(),
): boolean {
  if (missingInputs.length === 0) return false;
  const initialising = new Set<number>();
  const network = passiveNetwork(document, nodes, failedComponentIds);
  const ground = nodes.get(terminalKey(component.id, 'GND'));
  if (ground === undefined) return false;
  for (const board of document.components) {
    if (!isArduinoUno(board)) continue;
    if (!ARDUINO_GROUND_TERMINALS.some((pin) => nodes.get(terminalKey(board.id, pin)) === ground))
      continue;
    const snapshot = snapshots.get(board.id);
    if (
      !snapshot ||
      snapshot.state.clockProfile !== 'instruction-us-v1' ||
      snapshot.diagnostics.length
    )
      continue;
    const runtime = snapshot.state;
    const bootstrap =
      simulationTimeMs === 0 &&
      runtime.virtualTimeMs === 0 &&
      snapshot.pinModes.size === 0 &&
      snapshot.outputs.size === 0 &&
      arduinoRuntimeStateMatchesProgram('', runtime);
    if (runtime.phase !== 'setup' && !bootstrap) continue;
    for (const pin of board.pinIds ?? []) {
      if (!/^(?:d(?:[0-9]|1[0-3])|a[0-5])$/.test(pin)) continue;
      const mode = snapshot.pinModes.get(pin);
      if (mode === 'OUTPUT' || mode === 'INPUT_PULLUP') continue;
      const node = network.root(network.pin(board, pin));
      if (node !== undefined) initialising.add(node);
    }
  }
  return missingInputs.every((pin) => {
    const node = network.root(network.pin(component, pin));
    return node !== undefined && initialising.has(node);
  });
}
