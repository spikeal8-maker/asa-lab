import { terminalsForComponent, type ElectronicsDocument, type Terminal } from './document.js';
import { ARDUINO_GROUND_TERMINALS, isArduinoUno } from './arduino-model.js';
import { SEVEN_SEGMENT_COMMON_TERMINALS } from './led-model.js';

export interface TerminalRef {
  readonly componentId: string;
  readonly terminal: Terminal;
}

export interface Netlist {
  readonly nodeOf: ReadonlyMap<string, number>;
  readonly nodeCount: number;
  readonly terminalsByNode: ReadonlyMap<number, readonly string[]>;
}

export function terminalKey(componentId: string, terminal: Terminal): string {
  return `${componentId}:${terminal}`;
}

/**
 * Code-unit ordering, deliberately not `localeCompare`.
 *
 * Net numbering is derived from this order and reaches the caller as `net-0`,
 * `net-1`, … `localeCompare` without an explicit locale uses the runtime's ICU
 * data, which differs between a browser and a small-icu Node build — notably in
 * how it weights the `:` and `-` that appear in every terminal key. The
 * simulation contract requires the browser and the server to produce
 * byte-identical results from the same document, so the comparison must not
 * depend on the runtime at all.
 */
function compareTerminalKeys(left: string, right: string): number {
  if (left < right) return -1;
  return left > right ? 1 : 0;
}

class UnionFind {
  private readonly parent = new Map<string, string>();

  find(key: string): string {
    const seen = this.parent.get(key);
    if (seen === undefined) {
      this.parent.set(key, key);
      return key;
    }
    if (seen === key) return key;
    const root = this.find(seen);
    this.parent.set(key, root);
    return root;
  }

  union(left: string, right: string): void {
    const a = this.find(left);
    const b = this.find(right);
    if (a !== b) this.parent.set(a, b);
  }
}

/** Connections are ideal wires; legacy `wire` components also collapse to a node. */
export function buildNetlist(document: ElectronicsDocument): Netlist {
  const union = new UnionFind();
  const keys: string[] = [];
  for (const component of document.components) {
    const terminals = terminalsForComponent(component);
    for (const terminal of terminals) {
      const key = terminalKey(component.id, terminal);
      keys.push(key);
      union.find(key);
    }
    for (const [left, right] of component.internalConnections ?? []) {
      union.union(terminalKey(component.id, left), terminalKey(component.id, right));
    }
    // The two COM legs are the same conductor inside a single-digit display.
    // Apply the physical model even to older/imported documents that predate
    // the persisted internalConnections field.
    if (component.kind === 'seven-segment') {
      union.union(
        terminalKey(component.id, SEVEN_SEGMENT_COMMON_TERMINALS[0]),
        terminalKey(component.id, SEVEN_SEGMENT_COMMON_TERMINALS[1]),
      );
    }
    for (const [pinId, binding] of Object.entries(component.holeBindings ?? {})) {
      union.union(
        terminalKey(component.id, pinId),
        terminalKey(binding.breadboardComponentId, binding.holeId),
      );
    }
    if (component.kind === 'wire') {
      union.union(terminalKey(component.id, 'a'), terminalKey(component.id, 'b'));
    }
    if (isArduinoUno(component)) {
      const grounds = ARDUINO_GROUND_TERMINALS.filter((terminal) => terminals.includes(terminal));
      const reference = grounds[0];
      if (reference) {
        for (const terminal of grounds.slice(1)) {
          union.union(terminalKey(component.id, reference), terminalKey(component.id, terminal));
        }
      }
    }
  }
  for (const connection of document.connections) {
    union.union(
      terminalKey(connection.from.componentId, connection.from.terminal),
      terminalKey(connection.to.componentId, connection.to.terminal),
    );
  }

  keys.sort(compareTerminalKeys);
  const keysByRoot = new Map<string, string[]>();
  for (const key of keys) {
    const root = union.find(key);
    const members = keysByRoot.get(root);
    if (members) members.push(key);
    else keysByRoot.set(root, [key]);
  }

  const nodeOf = new Map<string, number>();
  const terminalsByNode = new Map<number, readonly string[]>();
  // Sorted keys insert each group at its smallest key and order its members.
  for (const members of keysByRoot.values()) {
    const index = terminalsByNode.size;
    terminalsByNode.set(index, members);
    for (const key of members) nodeOf.set(key, index);
  }
  return { nodeOf, nodeCount: terminalsByNode.size, terminalsByNode };
}
