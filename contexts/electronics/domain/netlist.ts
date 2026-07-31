import type { ElectronicsDocument, Terminal } from './document.js';

/** Netlist: terminals joined by wires and direct links collapse into nodes. */

export interface TerminalRef {
  readonly componentId: string;
  readonly terminal: Terminal;
}

export interface Netlist {
  /** node index per "componentId:terminal" key */
  readonly nodeOf: ReadonlyMap<string, number>;
  readonly nodeCount: number;
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
    if (seen === key) {
      return key;
    }
    const root = this.find(seen);
    this.parent.set(key, root);
    return root;
  }

  union(left: string, right: string): void {
    const a = this.find(left);
    const b = this.find(right);
    if (a !== b) {
      this.parent.set(a, b);
    }
  }
}

/**
 * Build the netlist. Wires are not circuit elements: both of their terminals
 * belong to the same node, so a wire simply merges what it connects.
 */
export function buildNetlist(document: ElectronicsDocument): Netlist {
  const union = new UnionFind();
  for (const component of document.components) {
    union.find(terminalKey(component.id, 'a'));
    union.find(terminalKey(component.id, 'b'));
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
  for (const component of document.components) {
    for (const terminal of ['a', 'b'] as const) {
      const key = terminalKey(component.id, terminal);
      const root = union.find(key);
      let index = rootToIndex.get(root);
      if (index === undefined) {
        index = rootToIndex.size;
        rootToIndex.set(root, index);
      }
      nodeOf.set(key, index);
    }
  }
  return { nodeOf, nodeCount: rootToIndex.size };
}
