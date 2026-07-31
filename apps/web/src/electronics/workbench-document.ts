import type {
  ComponentKind,
  SchematicComponent,
  SchematicConnection,
  SchematicDocument,
  Terminal,
} from '../api';
import {
  ACTIVE_COMPONENTS,
  catalogEntry,
  renderedSize,
  terminalPosition,
} from './component-catalog';
import { snap, type Point } from './workbench-geometry';
import type { Selection, TerminalRef } from './workbench-model';

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
    position: { x: snap(center.x - size.width / 2), y: snap(center.y - size.height / 2) },
    value: entry.defaultValue,
    rotation: 0,
    name: entry.label,
    ...(entry.defaultState === undefined ? {} : { state: entry.defaultState }),
    ...(entry.defaultWiperPosition === undefined
      ? {}
      : { wiperPosition: entry.defaultWiperPosition }),
  };
  return { component, document: { ...document, components: [...document.components, component] } };
}

export function duplicateComponentInDocument(
  document: SchematicDocument,
  selection: Selection,
  id: string,
): {
  document: SchematicDocument;
  component: SchematicComponent;
  components: readonly SchematicComponent[];
} | null {
  if (selection?.kind !== 'component') return null;
  const selectedIds = new Set(selection.ids);
  const sources = document.components.filter((item) => selectedIds.has(item.id));
  if (sources.length === 0) return null;
  const idMap = new Map<string, string>();
  sources.forEach((source, index) => idMap.set(source.id, `${id}-${index + 1}`));
  const components = sources.map((source) => ({
    ...source,
    id: idMap.get(source.id) as string,
    name: `${source.name ?? source.kind} — копия`,
    position: { x: source.position.x + 28, y: source.position.y + 28 },
  }));
  const connections = document.connections
    .filter(
      (wire) => selectedIds.has(wire.from.componentId) && selectedIds.has(wire.to.componentId),
    )
    .map((wire, index) => ({
      ...wire,
      id: `${id}-wire-${index + 1}`,
      from: { ...wire.from, componentId: idMap.get(wire.from.componentId) as string },
      to: { ...wire.to, componentId: idMap.get(wire.to.componentId) as string },
      ...(wire.vertices
        ? { vertices: wire.vertices.map((vertex) => ({ x: vertex.x + 28, y: vertex.y + 28 })) }
        : {}),
    }));
  return {
    component: components[0] as SchematicComponent,
    components,
    document: {
      ...document,
      components: [...document.components, ...components],
      connections: [...document.connections, ...connections],
    },
  };
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
  const ids = new Set(selection.ids);
  return {
    ...document,
    components: document.components.filter((item) => !ids.has(item.id)),
    connections: document.connections.filter(
      (wire) => !ids.has(wire.from.componentId) && !ids.has(wire.to.componentId),
    ),
  };
}

export function rotateSelectionInDocument(
  document: SchematicDocument,
  selection: Selection,
): SchematicDocument | null {
  if (selection?.kind !== 'component') return null;
  const ids = new Set(selection.ids);
  return {
    ...document,
    components: document.components.map((item) =>
      ids.has(item.id)
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
  const ids = new Set(selection.ids);
  return {
    ...document,
    components: document.components.map((item) => (ids.has(item.id) ? { ...item, value } : item)),
  };
}

export function updateSelectionName(
  document: SchematicDocument,
  selection: Selection,
  name: string,
): SchematicDocument | null {
  if (selection?.kind !== 'component' || name.length > 120) return null;
  return {
    ...document,
    components: document.components.map((item) =>
      item.id === selection.id ? { ...item, name } : item,
    ),
  };
}

export function updateSelectionState(
  document: SchematicDocument,
  selection: Selection,
  state: boolean,
): SchematicDocument | null {
  if (selection?.kind !== 'component') return null;
  const target = document.components.find((item) => item.id === selection.id);
  if (!target || (target.kind !== 'switch' && target.kind !== 'button')) return null;
  return {
    ...document,
    components: document.components.map((item) =>
      item.id === selection.id ? { ...item, state } : item,
    ),
  };
}

export function updateWiperPosition(
  document: SchematicDocument,
  selection: Selection,
  wiperPosition: number,
): SchematicDocument | null {
  if (
    selection?.kind !== 'component' ||
    !Number.isFinite(wiperPosition) ||
    wiperPosition < 0 ||
    wiperPosition > 1
  )
    return null;
  const target = document.components.find((item) => item.id === selection.id);
  if (target?.kind !== 'potentiometer') return null;
  return {
    ...document,
    components: document.components.map((item) =>
      item.id === selection.id ? { ...item, wiperPosition } : item,
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

export function removeSelectedWireBends(
  document: SchematicDocument,
  selection: Selection,
): SchematicDocument | null {
  if (selection?.kind !== 'wire') return null;
  return {
    ...document,
    connections: document.connections.map((item) =>
      item.id === selection.id ? { ...item, vertices: [] } : item,
    ),
  };
}

export function moveWireVertex(
  document: SchematicDocument,
  wireId: string,
  vertexIndex: number,
  point: Point,
): SchematicDocument {
  return {
    ...document,
    connections: document.connections.map((wire) => {
      if (wire.id !== wireId || !wire.vertices?.[vertexIndex]) return wire;
      return {
        ...wire,
        vertices: wire.vertices.map((vertex, index) =>
          index === vertexIndex ? { x: snap(point.x), y: snap(point.y) } : vertex,
        ),
      };
    }),
  };
}

export function reconnectWireEndpoint(
  document: SchematicDocument,
  wireId: string,
  endpoint: 'from' | 'to',
  target: { componentId: string; terminal: Terminal },
): SchematicDocument | null {
  const wire = document.connections.find((item) => item.id === wireId);
  if (!wire) return null;
  const other = endpoint === 'from' ? wire.to : wire.from;
  if (other.componentId === target.componentId && other.terminal === target.terminal) return null;
  return {
    ...document,
    connections: document.connections.map((item) =>
      item.id === wireId ? { ...item, [endpoint]: { ...target } } : item,
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

export function moveComponentsInDocument(
  document: SchematicDocument,
  positions: Readonly<Record<string, Point>>,
): SchematicDocument {
  return {
    ...document,
    components: document.components.map((item) =>
      positions[item.id] ? { ...item, position: positions[item.id] } : item,
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
