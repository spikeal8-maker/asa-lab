import { createBreadboardDefinition } from './breadboard.js';
import { breadboardInternalLinks } from './breadboard-netlist.js';
import { componentTerminalIds, type TerminalId } from './component-model.js';
import type { ElectronicsDocument } from './document.js';

/** Netlist: terminals joined by wires, attachments and direct links collapse into nodes. */

export interface TerminalRef {
  readonly componentId: string;
  readonly terminal: TerminalId;
}

export interface Netlist {
  /** node index per "componentId:terminal" key */
  readonly nodeOf: ReadonlyMap<string, number>;
  readonly nodeCount: number;
}

export function terminalKey(componentId: string, terminal: TerminalId): string {
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

/** Generic builder for multi-terminal parts, boards, ICs and instruments. */
export function buildNetlistFromTerminalMap(
  terminalMap: ReadonlyMap<string, readonly TerminalId[]>,
  links: readonly { readonly from: TerminalRef; readonly to: TerminalRef }[],
  internallyShortedComponents: ReadonlySet<string> = new Set(),
): Netlist {
  const union = new UnionFind();
  for (const [componentId, terminalIds] of terminalMap) {
    for (const terminalId of terminalIds) union.find(terminalKey(componentId, terminalId));
    if (internallyShortedComponents.has(componentId) && terminalIds.length > 1) {
      const first = terminalIds[0] as TerminalId;
      for (const terminalId of terminalIds.slice(1)) {
        union.union(terminalKey(componentId, first), terminalKey(componentId, terminalId));
      }
    }
  }
  for (const link of links) {
    union.union(
      terminalKey(link.from.componentId, link.from.terminal),
      terminalKey(link.to.componentId, link.to.terminal),
    );
  }

  const nodeOf = new Map<string, number>();
  const rootToIndex = new Map<string, number>();
  for (const [componentId, terminalIds] of terminalMap) {
    for (const terminalId of terminalIds) {
      const key = terminalKey(componentId, terminalId);
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

const HALF_BREADBOARD = createBreadboardDefinition('half-400');

/**
 * Build the current document netlist. Legacy wire components are ideal links;
 * active half-size breadboards contribute their physical internal buses;
 * explicit SchematicConnection objects add visible user-created wires; and
 * BreadboardAttachment objects add hidden physical lead-to-hole edges.
 */
export function buildNetlist(document: ElectronicsDocument): Netlist {
  const terminalMap = new Map(
    document.components.map((component) => [component.id, componentTerminalIds(component.kind)]),
  );
  const internallyShorted = new Set(
    document.components.filter((component) => component.kind === 'wire').map((component) => component.id),
  );
  const boardLinks = document.components.flatMap((component) =>
    component.kind === 'breadboard'
      ? breadboardInternalLinks(HALF_BREADBOARD, component.id)
      : [],
  );
  const attachmentLinks = (document.breadboardAttachments ?? []).map((attachment) => ({
    from: {
      componentId: attachment.componentId,
      terminal: attachment.componentTerminalId,
    },
    to: {
      componentId: attachment.breadboardComponentId,
      terminal: attachment.breadboardTerminalId,
    },
  }));
  return buildNetlistFromTerminalMap(
    terminalMap,
    [...document.connections, ...boardLinks, ...attachmentLinks],
    internallyShorted,
  );
}
