import { terminalsForKind, type ElectronicsDocument, type Terminal } from './document.js';

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
  for (const component of document.components) {
    const terminals = terminalsForKind(component.kind);
    for (const terminal of terminals) union.find(terminalKey(component.id, terminal));
    if (component.kind === 'wire') {
      union.union(terminalKey(component.id, 'a'), terminalKey(component.id, 'b'));
    }
  }
  for (const connection of document.connections) {
    union.union(
      terminalKey(connection.from.componentId, connection.from.terminal),
      terminalKey(connection.to.componentId, connection.to.terminal),
    );
  }

  const nodeOf = new Map<string, number>();
  const rootToIndex = new Map<string, number>();
  const terminalsByNode = new Map<number, string[]>();
  for (const component of document.components) {
    for (const terminal of terminalsForKind(component.kind)) {
      const key = terminalKey(component.id, terminal);
      const root = union.find(key);
      let index = rootToIndex.get(root);
      if (index === undefined) {
        index = rootToIndex.size;
        rootToIndex.set(root, index);
      }
      nodeOf.set(key, index);
      const members = terminalsByNode.get(index) ?? [];
      members.push(key);
      terminalsByNode.set(index, members);
    }
  }
  return { nodeOf, nodeCount: rootToIndex.size, terminalsByNode };
}
