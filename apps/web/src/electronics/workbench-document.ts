import type {
  ComponentKind,
  SchematicComponent,
  SchematicConnection,
  SchematicDocument,
} from '../api';
import {
  WORKBENCH_VALUE_CONTROLS,
  validEditableValue,
} from './component-behavior';
import {
  catalogEntry,
  componentOriginForCenter,
  renderedSize,
  snapComponentOrigin,
  terminalPosition,
  terminalSpec,
  type CatalogEntry,
} from './component-catalog';
import { snap, type Point } from './workbench-geometry';
import { BREADBOARD_PITCH_UNITS, HALF_PITCH_UNITS } from './workbench-scale';
import type { Selection, TerminalRef } from './workbench-model';

function enabledEntry(kind: Exclude<ComponentKind, 'wire'>): CatalogEntry | null {
  const entry = catalogEntry(kind);
  return entry?.enabled === true && entry.kind === kind ? entry : null;
}

function boxOf(component: SchematicComponent): {
  x: number;
  y: number;
  width: number;
  height: number;
} | null {
  if (component.kind === 'wire') return null;
  const entry = enabledEntry(component.kind);
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

function ringOffsets(ring: number): Point[] {
  if (ring === 0) return [{ x: 0, y: 0 }];
  const offsets: Point[] = [];
  for (let x = -ring; x <= ring; x += 1) {
    offsets.push({ x, y: -ring }, { x, y: ring });
  }
  for (let y = -ring + 1; y < ring; y += 1) {
    offsets.push({ x: -ring, y }, { x: ring, y });
  }
  return offsets;
}

/** Remove every hidden physical insertion edge involving a component or board. */
export function detachComponentFromBreadboard(
  document: SchematicDocument,
  componentId: string,
): SchematicDocument {
  const attachments = document.breadboardAttachments;
  if (!attachments || attachments.length === 0) return document;
  const next = attachments.filter(
    (attachment) =>
      attachment.componentId !== componentId &&
      attachment.breadboardComponentId !== componentId,
  );
  if (next.length === attachments.length) return document;
  return { ...document, breadboardAttachments: next };
}

/** Find a free terminal-aligned spot around the requested visual centre. */
function freePosition(
  document: SchematicDocument,
  kind: Exclude<ComponentKind, 'wire'>,
  size: { width: number; height: number },
  center: Point,
  rotation: 0 | 90 | 180 | 270 = 0,
): Point {
  const gap = BREADBOARD_PITCH_UNITS;
  const taken = document.components
    .map(boxOf)
    .filter((box): box is { x: number; y: number; width: number; height: number } => box !== null);
  const start = componentOriginForCenter(kind, center, rotation);
  const step = BREADBOARD_PITCH_UNITS * 4;
  for (let ring = 0; ring < 10; ring += 1) {
    for (const offset of ringOffsets(ring)) {
      const candidate = snapComponentOrigin(
        kind,
        { x: start.x + offset.x * step, y: start.y + offset.y * step },
        rotation,
      );
      const box = { ...candidate, ...size };
      if (!taken.some((other) => overlaps(box, other, gap))) return candidate;
    }
  }
  return snapComponentOrigin(kind, start, rotation);
}

export function addComponentToDocument(
  document: SchematicDocument,
  kind: Exclude<ComponentKind, 'wire'>,
  center: Point,
  id: string,
): { document: SchematicDocument; component: SchematicComponent } {
  const entry = enabledEntry(kind);
  if (!entry) {
    throw new Error(`component ${kind} is not enabled in the native workbench catalogue`);
  }
  const size = renderedSize(entry);
  const component: SchematicComponent = {
    id,
    kind,
    position: freePosition(document, kind, size, center),
    value: WORKBENCH_VALUE_CONTROLS[kind].defaultValue,
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
  if (!source || source.kind === 'wire') return null;
  const rotation = source.rotation ?? 0;
  const entry = enabledEntry(source.kind);
  if (!entry) return null;
  const size = renderedSize(entry, rotation);
  const sourceCenter = {
    x: source.position.x + size.width / 2,
    y: source.position.y + size.height / 2,
  };
  const preferredCenter = {
    x: sourceCenter.x + BREADBOARD_PITCH_UNITS * 4,
    y: sourceCenter.y + BREADBOARD_PITCH_UNITS * 4,
  };
  const component: SchematicComponent = {
    ...source,
    id,
    position: freePosition(document, source.kind, size, preferredCenter, rotation),
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
  const detached = detachComponentFromBreadboard(document, selection.id);
  return {
    ...detached,
    components: detached.components.filter((item) => item.id !== selection.id),
    connections: detached.connections.filter(
      (wire) => wire.from.componentId !== selection.id && wire.to.componentId !== selection.id,
    ),
  };
}

export function rotateSelectionInDocument(
  document: SchematicDocument,
  selection: Selection,
): SchematicDocument | null {
  if (selection?.kind !== 'component') return null;
  const selected = document.components.find((item) => item.id === selection.id);
  if (!selected || selected.kind === 'wire') return null;
  const entry = enabledEntry(selected.kind);
  if (!entry) return null;
  const previousRotation = selected.rotation ?? 0;
  const previousSize = renderedSize(entry, previousRotation);
  const center = {
    x: selected.position.x + previousSize.width / 2,
    y: selected.position.y + previousSize.height / 2,
  };
  const rotation = ((previousRotation + 90) % 360) as 0 | 90 | 180 | 270;
  const position = componentOriginForCenter(selected.kind, center, rotation);
  const detached = detachComponentFromBreadboard(document, selected.id);
  return {
    ...detached,
    components: detached.components.map((item) =>
      item.id === selection.id ? { ...item, rotation, position } : item,
    ),
  };
}

export function updateSelectionValue(
  document: SchematicDocument,
  selection: Selection,
  value: number,
): SchematicDocument | null {
  if (selection?.kind !== 'component') return null;
  const selected = document.components.find((item) => item.id === selection.id);
  if (!selected || selected.kind === 'wire' || !enabledEntry(selected.kind)) return null;
  const valid = validEditableValue(selected.kind, value);
  if (valid === null) return null;
  return {
    ...document,
    components: document.components.map((item) =>
      item.id === selection.id ? { ...item, value: valid } : item,
    ),
  };
}

export function resetSelectionValueToNominal(
  document: SchematicDocument,
  selection: Selection,
): SchematicDocument | null {
  if (selection?.kind !== 'component') return null;
  const selected = document.components.find((item) => item.id === selection.id);
  if (!selected || selected.kind === 'wire' || !enabledEntry(selected.kind)) return null;
  const value = WORKBENCH_VALUE_CONTROLS[selected.kind].defaultValue;
  if (selected.value === value) return null;
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
  if (selection?.kind !== 'wire' || !/^#[0-9a-fA-F]{6}$/.test(color)) return null;
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
    Math.abs((current[0]?.x ?? start.x) - start.x) >
    Math.abs((current[0]?.y ?? start.y) - start.y);
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

export type ConnectTerminalResult =
  | { kind: 'duplicate' }
  | { kind: 'invalid'; message: string }
  | { kind: 'created'; wire: SchematicConnection; document: SchematicDocument };

function terminalExists(document: SchematicDocument, ref: TerminalRef): boolean {
  const component = document.components.find((item) => item.id === ref.componentId);
  if (!component || component.kind === 'wire') return false;
  const entry = enabledEntry(component.kind);
  return Boolean(entry && terminalSpec(entry, ref.terminal));
}

export function connectTerminals(
  document: SchematicDocument,
  from: TerminalRef,
  to: TerminalRef,
  id: string,
  color: string,
): ConnectTerminalResult {
  if (!terminalExists(document, from) || !terminalExists(document, to)) {
    return { kind: 'invalid', message: 'Вывод больше не существует в текущей активной модели компонента.' };
  }
  if (from.componentId === to.componentId && from.terminal === to.terminal) {
    return { kind: 'invalid', message: 'Нельзя соединить вывод сам с собой.' };
  }
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
    return { kind: 'invalid', message: 'Выбран недопустимый цвет провода.' };
  }
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
  const component = document.components.find((item) => item.id === componentId);
  if (!component || component.kind === 'wire' || !enabledEntry(component.kind)) return document;
  const snapped = snapComponentOrigin(component.kind, position, component.rotation ?? 0);
  const detached = detachComponentFromBreadboard(document, componentId);
  return {
    ...detached,
    components: detached.components.map((item) =>
      item.id === componentId ? { ...item, position: snapped } : item,
    ),
  };
}

export function sceneBounds(
  document: SchematicDocument,
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  const placed = document.components.filter(
    (component) => component.kind !== 'wire' && enabledEntry(component.kind),
  );
  if (placed.length === 0) return null;
  return placed.reduce(
    (acc, component) => {
      if (component.kind === 'wire') return acc;
      const entry = enabledEntry(component.kind);
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

export const WORKBENCH_PLACEMENT_GAP = HALF_PITCH_UNITS;
