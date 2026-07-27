import type {
  ComponentKind,
  SchematicComponent,
  SchematicConnection,
  SchematicDocument,
} from '../api';
import {
  ACTIVE_COMPONENTS,
  catalogEntry,
  renderedSize,
  terminalPosition,
} from './component-catalog';
import { snap, type Point } from './workbench-geometry';
import type { Selection, TerminalRef } from './workbench-model';

function boxOf(component: SchematicComponent): {
  x: number;
  y: number;
  width: number;
  height: number;
} | null {
  const entry = catalogEntry(component.kind);
  if (!entry) return null;
  const size = renderedSize(entry, component.rotation ?? 0);
  return { x: component.position.x, y: component.position.y, ...size };
}

function overlaps(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
  gap: number,
): boolean {
  return (
    a.x < b.x + b.width + gap &&
    a.x + a.width + gap > b.x &&
    a.y < b.y + b.height + gap &&
    a.y + a.height + gap > b.y
  );
}

/**
 * Find a free spot near the requested centre. Dropping every new part on the
 * exact centre stacks them on one point, hides the artwork and lets the topmost
 * element swallow every drag.
 */
function freePosition(
  document: SchematicDocument,
  size: { width: number; height: number },
  center: Point,
): Point {
  const gap = 24;
  const taken = document.components
    .map(boxOf)
    .filter((box): box is { x: number; y: number; width: number; height: number } => box !== null);
  const start = { x: center.x - size.width / 2, y: center.y - size.height / 2 };
  const step = 160;
  for (let ring = 0; ring < 6; ring += 1) {
    for (let index = 0; index <= ring * 2; index += 1) {
      const candidate = {
        x: snap(start.x + (index - ring) * step),
        y: snap(start.y + ring * step),
      };
      const box = { ...candidate, ...size };
      if (!taken.some((other) => overlaps(box, other, gap))) return candidate;
    }
  }
  return { x: snap(start.x), y: snap(start.y) };
}

export function addComponentToDocument(
  document: SchematicDocument,
  kind: Exclude<ComponentKind, 'wire'>,
  center: Point,
  id: string,
): { document: SchematicDocument; component: SchematicComponent } {
  const entry = ACTIVE_COMPONENTS[kind];
  const size = renderedSize(entry);
  const component: SchematicComponent = {
    id,
    kind,
    position: freePosition(document, size, center),
    value: entry.defaultValue,
    rotation: 0,
  };
  return { component, document: { ...document, components: [...document.components, component] } };
}

export function duplicateComponentInDocument(
  document: SchematicDocument,
  selection: Selection,
  id: string,
): { document: SchematicDocument; component: SchematicComponent } | null {
  if (selection?.kind !== 'component') return null;
  const source = document.components.find((item) => item.id === selection.id);
  if (!source) return null;
  const component: SchematicComponent = {
    ...source,
    id,
    position: { x: source.position.x + 28, y: source.position.y + 28 },
  };
  return { component, document: { ...document, components: [...document.components, component] } };
}

export function removeSelectionFromDocument(
  document: SchematicDocument,
  selection: Exclude<Selection, null>,
): SchematicDocument {
  if (selection.kind === 'wire') {
    return {
      ...document,
      connections: document.connections.filter((item) => item.id !== selection.id),
    };
  }
  return {
    ...document,
    components: document.components.filter((item) => item.id !== selection.id),
    connections: document.connections.filter(
      (wire) => wire.from.componentId !== selection.id && wire.to.componentId !== selection.id,
    ),
  };
}

export function rotateSelectionInDocument(
  document: SchematicDocument,
  selection: Selection,
): SchematicDocument | null {
  if (selection?.kind !== 'component') return null;
  return {
    ...document,
    components: document.components.map((item) =>
      item.id === selection.id
        ? { ...item, rotation: (((item.rotation ?? 0) + 90) % 360) as 0 | 90 | 180 | 270 }
        : item,
    ),
  };
}

export function updateSelectionValue(
  document: SchematicDocument,
  selection: Selection,
  value: number,
): SchematicDocument | null {
  if (selection?.kind !== 'component' || !Number.isFinite(value) || value < 0) return null;
  return {
    ...document,
    components: document.components.map((item) =>
      item.id === selection.id ? { ...item, value } : item,
    ),
  };
}

export function updateSelectedWireColor(
  document: SchematicDocument,
  selection: Selection,
  color: string,
): SchematicDocument | null {
  if (selection?.kind !== 'wire') return null;
  return {
    ...document,
    connections: document.connections.map((item) =>
      item.id === selection.id ? { ...item, color } : item,
    ),
  };
}

export function toggleSelectedWireRoute(
  document: SchematicDocument,
  selection: Selection,
): SchematicDocument | null {
  if (selection?.kind !== 'wire') return null;
  const connection = document.connections.find((item) => item.id === selection.id);
  if (!connection) return null;
  const from = document.components.find((item) => item.id === connection.from.componentId);
  const to = document.components.find((item) => item.id === connection.to.componentId);
  if (!from || !to) return null;
  const start = terminalPosition(
    from.kind,
    from.position,
    connection.from.terminal,
    from.rotation ?? 0,
  );
  const end = terminalPosition(to.kind, to.position, connection.to.terminal, to.rotation ?? 0);
  if (!start || !end) return null;
  const current = connection.vertices ?? [];
  const vertical =
    Math.abs((current[0]?.x ?? start.x) - start.x) > Math.abs((current[0]?.y ?? start.y) - start.y);
  const vertices = vertical
    ? [
        { x: start.x, y: snap((start.y + end.y) / 2) },
        { x: end.x, y: snap((start.y + end.y) / 2) },
      ]
    : [
        { x: snap((start.x + end.x) / 2), y: start.y },
        { x: snap((start.x + end.x) / 2), y: end.y },
      ];
  return {
    ...document,
    connections: document.connections.map((item) =>
      item.id === connection.id ? { ...item, vertices } : item,
    ),
  };
}

export function connectTerminals(
  document: SchematicDocument,
  from: TerminalRef,
  to: TerminalRef,
  id: string,
  color: string,
):
  | { kind: 'duplicate' }
  | { kind: 'created'; wire: SchematicConnection; document: SchematicDocument } {
  const duplicate = document.connections.some(
    (wire) =>
      (wire.from.componentId === from.componentId &&
        wire.from.terminal === from.terminal &&
        wire.to.componentId === to.componentId &&
        wire.to.terminal === to.terminal) ||
      (wire.to.componentId === from.componentId &&
        wire.to.terminal === from.terminal &&
        wire.from.componentId === to.componentId &&
        wire.from.terminal === to.terminal),
  );
  if (duplicate) return { kind: 'duplicate' };
  const wire: SchematicConnection = { id, from: { ...from }, to: { ...to }, color };
  return {
    kind: 'created',
    wire,
    document: { ...document, connections: [...document.connections, wire] },
  };
}

export function moveComponentInDocument(
  document: SchematicDocument,
  componentId: string,
  position: Point,
): SchematicDocument {
  return {
    ...document,
    components: document.components.map((item) =>
      item.id === componentId ? { ...item, position } : item,
    ),
  };
}

export function sceneBounds(
  document: SchematicDocument,
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  const placed = document.components.filter((component) => catalogEntry(component.kind));
  if (placed.length === 0) return null;
  return placed.reduce(
    (acc, component) => {
      const entry = catalogEntry(component.kind);
      if (!entry) return acc;
      const size = renderedSize(entry, component.rotation ?? 0);
      return {
        minX: Math.min(acc.minX, component.position.x),
        minY: Math.min(acc.minY, component.position.y),
        maxX: Math.max(acc.maxX, component.position.x + size.width),
        maxY: Math.max(acc.maxY, component.position.y + size.height),
      };
    },
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  );
}
