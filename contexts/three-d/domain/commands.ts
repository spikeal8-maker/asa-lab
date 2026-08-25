import {
  cloneThreeDDocument,
  type ShapeOperation,
  type ThreeDDimensions,
  type ThreeDDocument,
  type ThreeDGridSettings,
  type ThreeDNode,
  type ThreeDRulerSettings,
  type ThreeDTransform,
} from './document.js';

export type ThreeDCommand =
  | { readonly type: 'add'; readonly node: ThreeDNode }
  | { readonly type: 'remove'; readonly nodeIds: readonly string[] }
  | { readonly type: 'replace-transform'; readonly nodeId: string; readonly value: ThreeDTransform }
  | {
      readonly type: 'replace-dimensions';
      readonly nodeId: string;
      readonly value: ThreeDDimensions;
    }
  | { readonly type: 'rename'; readonly nodeId: string; readonly name: string }
  | { readonly type: 'set-color'; readonly nodeId: string; readonly color: string }
  | { readonly type: 'set-opacity'; readonly nodeId: string; readonly opacity: number }
  | { readonly type: 'set-operation'; readonly nodeId: string; readonly operation: ShapeOperation }
  | { readonly type: 'set-locked'; readonly nodeId: string; readonly locked: boolean }
  | { readonly type: 'set-visible'; readonly nodeId: string; readonly visible: boolean }
  | { readonly type: 'replace-node'; readonly node: ThreeDNode }
  | { readonly type: 'replace-nodes'; readonly nodes: readonly ThreeDNode[] }
  | { readonly type: 'replace-grid'; readonly value: ThreeDGridSettings }
  | { readonly type: 'replace-ruler'; readonly value: ThreeDRulerSettings };

export interface CommandResult {
  readonly document: ThreeDDocument;
  readonly changed: boolean;
}

function replaceNode(
  document: ThreeDDocument,
  nodeId: string,
  update: (node: ThreeDNode) => ThreeDNode,
): CommandResult {
  let changed = false;
  const nodes = document.nodes.map((node) => {
    if (node.id !== nodeId || node.locked) return node;
    changed = true;
    return update(node);
  });
  return changed ? { document: { ...document, nodes }, changed } : { document, changed };
}

export function applyThreeDCommand(source: ThreeDDocument, command: ThreeDCommand): CommandResult {
  const document = cloneThreeDDocument(source);
  switch (command.type) {
    case 'add':
      if (document.nodes.some((node) => node.id === command.node.id)) {
        return { document: source, changed: false };
      }
      return { document: { ...document, nodes: [...document.nodes, command.node] }, changed: true };
    case 'remove': {
      const removed = new Set(command.nodeIds);
      const nodes = document.nodes.filter((node) => node.locked || !removed.has(node.id));
      return nodes.length === document.nodes.length
        ? { document: source, changed: false }
        : { document: { ...document, nodes }, changed: true };
    }
    case 'replace-transform':
      return replaceNode(document, command.nodeId, (node) => ({
        ...node,
        transform: {
          position: { ...command.value.position },
          rotation: { ...command.value.rotation },
          scale: { ...command.value.scale },
        },
      }));
    case 'replace-dimensions':
      return replaceNode(document, command.nodeId, (node) => ({
        ...node,
        dimensions: { ...command.value },
      }));
    case 'rename':
      return replaceNode(document, command.nodeId, (node) => ({
        ...node,
        name: command.name.trim().slice(0, 120) || node.name,
      }));
    case 'set-color':
      return replaceNode(document, command.nodeId, (node) => ({ ...node, color: command.color }));
    case 'set-opacity':
      return replaceNode(document, command.nodeId, (node) => ({
        ...node,
        opacity: Math.min(1, Math.max(0.1, command.opacity)),
      }));
    case 'set-operation':
      return replaceNode(document, command.nodeId, (node) => ({
        ...node,
        operation: command.operation,
      }));
    case 'set-locked': {
      const nodes = document.nodes.map((node) =>
        node.id === command.nodeId ? { ...node, locked: command.locked } : node,
      );
      return document.nodes.some((node) => node.id === command.nodeId)
        ? { document: { ...document, nodes }, changed: true }
        : { document: source, changed: false };
    }
    case 'set-visible': {
      const nodes = document.nodes.map((node) =>
        node.id === command.nodeId ? { ...node, visible: command.visible } : node,
      );
      return document.nodes.some((node) => node.id === command.nodeId)
        ? { document: { ...document, nodes }, changed: true }
        : { document: source, changed: false };
    }
    case 'replace-node': {
      const index = document.nodes.findIndex((node) => node.id === command.node.id);
      if (index < 0 || document.nodes[index]?.locked) return { document: source, changed: false };
      const nodes = [...document.nodes];
      nodes[index] = command.node;
      return { document: { ...document, nodes }, changed: true };
    }
    case 'replace-nodes': {
      const replacements = new Map(command.nodes.map((node) => [node.id, node]));
      let changed = false;
      const nodes = document.nodes.map((node) => {
        const replacement = replacements.get(node.id);
        if (!replacement || node.locked) return node;
        changed = true;
        return replacement;
      });
      return changed
        ? { document: { ...document, nodes }, changed: true }
        : { document: source, changed: false };
    }
    case 'replace-grid':
      return { document: { ...document, grid: { ...command.value } }, changed: true };
    case 'replace-ruler':
      return {
        document: {
          ...document,
          ruler: { ...command.value, origin: { ...command.value.origin } },
        },
        changed: true,
      };
  }
}

export interface HistoryState {
  readonly past: readonly ThreeDDocument[];
  readonly present: ThreeDDocument;
  readonly future: readonly ThreeDDocument[];
}

export function createHistory(document: ThreeDDocument): HistoryState {
  return { past: [], present: cloneThreeDDocument(document), future: [] };
}

export function commitCommand(history: HistoryState, command: ThreeDCommand): HistoryState {
  const result = applyThreeDCommand(history.present, command);
  if (!result.changed) return history;
  return {
    past: [...history.past.slice(-99), history.present],
    present: result.document,
    future: [],
  };
}

export function replaceHistoryPresent(
  history: HistoryState,
  document: ThreeDDocument,
): HistoryState {
  return {
    past: [...history.past.slice(-99), history.present],
    present: cloneThreeDDocument(document),
    future: [],
  };
}

export function undoHistory(history: HistoryState): HistoryState {
  const previous = history.past.at(-1);
  if (!previous) return history;
  return {
    past: history.past.slice(0, -1),
    present: cloneThreeDDocument(previous),
    future: [history.present, ...history.future.slice(0, 99)],
  };
}

export function redoHistory(history: HistoryState): HistoryState {
  const next = history.future[0];
  if (!next) return history;
  return {
    past: [...history.past.slice(-99), history.present],
    present: cloneThreeDDocument(next),
    future: history.future.slice(1),
  };
}
