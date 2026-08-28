import type {
  ProductionStateValue,
  SchematicComponent,
  SchematicConnection,
  SchematicDocument,
  Terminal,
} from '../api';
import { resolveElectricalModelIdentity } from '@asa-lab/electronics/simulation';
import {
  catalogEntry,
  componentPointPosition,
  physicalTerminalOrder,
  renderedSize,
  terminalPosition,
} from './component-catalog';
import { PIN_ANCHOR_TOLERANCE_MM, WORLD_UNITS_PER_MM } from './production-asset-contracts';
import { productionBreadboard } from './production-manifest-adapter';
import { moveWireSegmentVertices, snap, wirePoints, type Point } from './workbench-geometry';
import type { Selection, TerminalRef } from './workbench-model';

function internalConnectionsForType(componentTypeId: string): [string, string][] {
  const board = productionBreadboard(componentTypeId);
  if (board) {
    return Object.values(board.groups).flatMap((holes) => {
      const first = holes[0];
      return first ? holes.slice(1).map((hole) => [first, hole] as [string, string]) : [];
    });
  }
  return componentTypeId === 'button-tactile-6mm'
    ? [
        ['SW-A1', 'SW-A2'],
        ['SW-B1', 'SW-B2'],
      ]
    : componentTypeId === 'seven-segment-display'
      ? [['top-3', 'bottom-3']]
      : [];
}

function variantTerminalReplacementMap(
  currentEntry: NonNullable<ReturnType<typeof catalogEntry>>,
  nextEntry: NonNullable<ReturnType<typeof catalogEntry>>,
): ReadonlyMap<Terminal, Terminal> {
  const replacements = new Map<Terminal, Terminal>();
  const availableNextTerminals = new Set(Object.keys(nextEntry.terminals));
  const currentTerminals = Object.keys(currentEntry.terminals);

  // Preserve semantic terminal names whenever the two variants share them.
  for (const terminal of currentTerminals) {
    if (!availableNextTerminals.has(terminal)) continue;
    replacements.set(terminal, terminal);
    availableNextTerminals.delete(terminal);
  }

  // A family variant is a physical replacement in the same place. When the
  // electrical names differ (B/C/E versus G/S/D), keep each wire and
  // breadboard binding on the nearest physical lead instead of deleting it.
  // Coordinates are normalized so differently sized packages still map by
  // lead position. Default string sorting is deterministic and locale-free.
  const remainingCurrent = currentTerminals
    .filter((terminal) => !replacements.has(terminal))
    .sort();
  for (const currentTerminal of remainingCurrent) {
    const currentPin = currentEntry.terminals[currentTerminal];
    if (!currentPin || availableNextTerminals.size === 0) continue;
    const currentX = currentPin.xMm / Math.max(currentEntry.physicalSizeMm.width, 1e-9);
    const currentY = currentPin.yMm / Math.max(currentEntry.physicalSizeMm.height, 1e-9);
    const nearest = [...availableNextTerminals]
      .sort()
      .map((nextTerminal) => {
        const nextPin = nextEntry.terminals[nextTerminal];
        if (!nextPin) return { nextTerminal, distance: Number.POSITIVE_INFINITY };
        const nextX = nextPin.xMm / Math.max(nextEntry.physicalSizeMm.width, 1e-9);
        const nextY = nextPin.yMm / Math.max(nextEntry.physicalSizeMm.height, 1e-9);
        return {
          nextTerminal,
          distance: (nextX - currentX) ** 2 + (nextY - currentY) ** 2,
        };
      })
      .sort(
        (left, right) =>
          left.distance - right.distance || (left.nextTerminal < right.nextTerminal ? -1 : 1),
      )[0];
    if (!nearest || !Number.isFinite(nearest.distance)) continue;
    replacements.set(currentTerminal, nearest.nextTerminal);
    availableNextTerminals.delete(nearest.nextTerminal);
  }
  return replacements;
}

export function addComponentToDocument(
  document: SchematicDocument,
  componentTypeId: string,
  center: Point,
  id: string,
): { document: SchematicDocument; component: SchematicComponent } {
  const entry = catalogEntry(componentTypeId);
  if (!entry) throw new Error(`Unknown production component: ${componentTypeId}`);
  const rotation = entry.defaultRotation;
  const size = renderedSize(entry, rotation);
  const internalConnections = internalConnectionsForType(componentTypeId);
  const modelIdentity = resolveElectricalModelIdentity({
    componentTypeId,
    kind: entry.kind,
    stateProperties: entry.defaultStateProperties,
  });
  const component: SchematicComponent = {
    id,
    kind: entry.kind,
    componentTypeId,
    variantId: componentTypeId,
    ...modelIdentity,
    // Free placement, same as when an already placed component is dragged: the
    // part lands exactly where it was dropped. The only thing allowed to move it
    // afterwards is the breadboard pulling its pins into the holes below; a
    // background grid that captured the drop made the canvas feel sticky.
    position: {
      x: Math.round(center.x - size.width / 2),
      y: Math.round(center.y - size.height / 2),
    },
    value: entry.defaultValue,
    rotation,
    name: entry.label,
    ...(entry.defaultState === undefined ? {} : { state: entry.defaultState }),
    ...(entry.defaultWiperPosition === undefined
      ? {}
      : { wiperPosition: entry.defaultWiperPosition }),
    stateProperties: { ...entry.defaultStateProperties },
    pinIds: Object.keys(entry.terminals),
    ...(internalConnections.length === 0 ? {} : { internalConnections }),
  };
  return { component, document: { ...document, components: [...document.components, component] } };
}

export function updateSelectionVariant(
  document: SchematicDocument,
  selection: Selection,
  componentTypeId: string,
): SchematicDocument | null {
  if (selection?.kind !== 'component' || selection.ids.length !== 1) return null;
  const entry = catalogEntry(componentTypeId);
  const current = document.components.find((component) => component.id === selection.id);
  const currentEntry = current ? catalogEntry(current) : null;
  if (!entry || !current || !currentEntry) return null;

  const terminals = new Set(Object.keys(entry.terminals));
  const replacementMap = variantTerminalReplacementMap(currentEntry, entry);
  const connectedTerminals = new Set<Terminal>();
  for (const wire of document.connections) {
    if (wire.from.componentId === selection.id) connectedTerminals.add(wire.from.terminal);
    if (wire.to.componentId === selection.id) connectedTerminals.add(wire.to.terminal);
  }
  for (const terminal of Object.keys(current.holeBindings ?? {})) connectedTerminals.add(terminal);
  // Never make a destructive partial replacement. A future family with an
  // incompatible pin count must provide an explicit mapping before it can be
  // switched while connected.
  if ([...connectedTerminals].some((terminal) => !replacementMap.has(terminal))) return null;
  const internalConnections = internalConnectionsForType(componentTypeId);
  const modelIdentity = resolveElectricalModelIdentity({
    componentTypeId,
    kind: entry.kind,
    stateProperties: entry.defaultStateProperties,
  });
  const currentRotation = current.rotation ?? currentEntry?.defaultRotation ?? 0;
  const relativeRotation = currentEntry
    ? currentRotation - currentEntry.defaultRotation
    : currentRotation;
  const rotation = ((((entry.defaultRotation + relativeRotation) % 360) + 360) %
    360) as NonNullable<SchematicComponent['rotation']>;
  const currentSize = currentEntry ? renderedSize(currentEntry, currentRotation) : null;
  const nextSize = renderedSize(entry, rotation);
  const component: SchematicComponent = {
    ...current,
    kind: entry.kind,
    componentTypeId,
    variantId: componentTypeId,
    ...modelIdentity,
    value: entry.defaultValue,
    ...(current.name === undefined
      ? {}
      : { name: current.name === currentEntry?.label ? entry.label : current.name }),
    ...(entry.defaultState === undefined ? {} : { state: entry.defaultState }),
    ...(entry.defaultWiperPosition === undefined
      ? {}
      : { wiperPosition: entry.defaultWiperPosition }),
    stateProperties: { ...entry.defaultStateProperties },
    rotation,
    // Family variants grow around their physical centre. This keeps centred
    // terminals (notably the two battery-holder wire ends) at the same world
    // position instead of making the component jump sideways.
    position: currentSize
      ? {
          x: current.position.x + (currentSize.width - nextSize.width) / 2,
          y: current.position.y + (currentSize.height - nextSize.height) / 2,
        }
      : current.position,
    pinIds: [...terminals],
    holeBindings: Object.fromEntries(
      Object.entries(current.holeBindings ?? {}).flatMap(([terminal, binding]) => {
        const replacement = replacementMap.get(terminal);
        return replacement ? [[replacement, binding]] : [];
      }),
    ),
    internalConnections,
  };
  const remapTerminal = (terminal: Terminal): Terminal => replacementMap.get(terminal) ?? terminal;
  return {
    ...document,
    components: document.components.map((item) => (item.id === selection.id ? component : item)),
    connections: document.connections.map((wire) => ({
      ...wire,
      from:
        wire.from.componentId === selection.id
          ? { ...wire.from, terminal: remapTerminal(wire.from.terminal) }
          : wire.from,
      to:
        wire.to.componentId === selection.id
          ? { ...wire.to, terminal: remapTerminal(wire.to.terminal) }
          : wire.to,
    })),
  };
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
  let rotated: SchematicDocument = {
    ...document,
    components: document.components.map((item) => {
      if (!ids.has(item.id)) return item;
      const entry = catalogEntry(item);
      const rotation = (((item.rotation ?? 0) + 45) % 360) as NonNullable<
        SchematicComponent['rotation']
      >;
      if (!entry) return { ...item, rotation };
      const previousSize = renderedSize(entry, item.rotation ?? 0);
      const nextSize = renderedSize(entry, rotation ?? 0);
      const center = {
        x: item.position.x + previousSize.width / 2,
        y: item.position.y + previousSize.height / 2,
      };
      const withoutBindings = { ...item };
      delete withoutBindings.holeBindings;
      return {
        ...withoutBindings,
        rotation,
        position: {
          x: center.x - nextSize.width / 2,
          y: center.y - nextSize.height / 2,
        },
      };
    }),
  };
  for (const id of ids) rotated = snapComponentToBreadboard(rotated, id);
  return rotated;
}

export function mirrorSelectionInDocument(
  document: SchematicDocument,
  selection: Selection,
  axis: 'horizontal' | 'vertical',
): SchematicDocument | null {
  if (selection?.kind !== 'component') return null;
  const ids = new Set(selection.ids);
  const property = axis === 'horizontal' ? 'mirrorX' : 'mirrorY';
  return {
    ...document,
    components: document.components.map((item) =>
      ids.has(item.id)
        ? {
            ...item,
            stateProperties: {
              ...(item.stateProperties ?? {}),
              [property]: item.stateProperties?.[property] !== true,
            },
          }
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
      item.id === selection.id
        ? {
            ...item,
            state,
            stateProperties: {
              ...item.stateProperties,
              ...(item.kind === 'button'
                ? { contactState: state ? 'pressed' : 'released' }
                : { selectedThrow: state ? 'right' : 'left' }),
            },
          }
        : item,
    ),
  };
}

export function updateSelectionProperties(
  document: SchematicDocument,
  selection: Selection,
  properties: Readonly<Record<string, ProductionStateValue>>,
): SchematicDocument | null {
  if (selection?.kind !== 'component') return null;
  return {
    ...document,
    components: document.components.map((item) =>
      item.id === selection.id
        ? { ...item, stateProperties: { ...item.stateProperties, ...properties } }
        : item,
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
  const start = terminalPosition(from, from.position, connection.from.terminal, from.rotation ?? 0);
  const end = terminalPosition(to, to.position, connection.to.terminal, to.rotation ?? 0);
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
        // Free placement. This pulled the vertex onto a ten-unit grid after the
        // caller had already decided where it goes, so no care in the drag
        // handler could put a bend where it was wanted — it jumped to the nearest
        // node instead, and running a wire alongside another wire was impossible.
        vertices: wire.vertices.map((vertex, index) =>
          index === vertexIndex ? { x: Math.round(point.x), y: Math.round(point.y) } : vertex,
        ),
      };
    }),
  };
}

export function moveWireSegment(
  document: SchematicDocument,
  wireId: string,
  segmentIndex: number,
  pointerDelta: Point,
): SchematicDocument {
  const wire = document.connections.find((item) => item.id === wireId);
  if (!wire) return document;
  const fromComponent = document.components.find((item) => item.id === wire.from.componentId);
  const toComponent = document.components.find((item) => item.id === wire.to.componentId);
  const from = fromComponent
    ? terminalPositionInDocument(document, fromComponent, wire.from.terminal)
    : null;
  const to = toComponent
    ? terminalPositionInDocument(document, toComponent, wire.to.terminal)
    : null;
  if (!from || !to) return document;
  const vertices = moveWireSegmentVertices(
    from,
    to,
    wire.vertices ?? [],
    segmentIndex,
    pointerDelta,
  );
  if (!vertices || vertices === wire.vertices) return document;
  return {
    ...document,
    connections: document.connections.map((item) =>
      item.id === wireId ? { ...item, vertices } : item,
    ),
  };
}

export function removeWireVertex(
  document: SchematicDocument,
  wireId: string,
  vertexIndex: number,
): SchematicDocument {
  return {
    ...document,
    connections: document.connections.map((wire) =>
      wire.id === wireId && wire.vertices?.[vertexIndex]
        ? {
            ...wire,
            vertices: wire.vertices.filter((_, index) => index !== vertexIndex),
          }
        : wire,
    ),
  };
}

function closestPointOnSegment(point: Point, start: Point, end: Point): Point {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return start;
  const ratio = Math.max(
    0,
    Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared),
  );
  return { x: start.x + dx * ratio, y: start.y + dy * ratio };
}

export function insertWireVertex(
  document: SchematicDocument,
  wireId: string,
  point: Point,
): SchematicDocument {
  const wire = document.connections.find((item) => item.id === wireId);
  if (!wire || (wire.vertices?.length ?? 0) >= 48) return document;
  const fromComponent = document.components.find((item) => item.id === wire.from.componentId);
  const toComponent = document.components.find((item) => item.id === wire.to.componentId);
  const from = fromComponent
    ? terminalPositionInDocument(document, fromComponent, wire.from.terminal)
    : null;
  const to = toComponent
    ? terminalPositionInDocument(document, toComponent, wire.to.terminal)
    : null;
  if (!from || !to) return document;

  const route = wirePoints(from, to, wire.vertices);
  const baseVertices = wire.vertices === undefined ? route.slice(1, -1) : [...wire.vertices];
  let best: { index: number; point: Point; distance: number } | null = null;
  for (let index = 0; index < route.length - 1; index += 1) {
    const projected = closestPointOnSegment(
      point,
      route[index] as Point,
      route[index + 1] as Point,
    );
    const distance = Math.hypot(point.x - projected.x, point.y - projected.y);
    if (!best || distance < best.distance) best = { index, point: projected, distance };
  }
  if (!best) return document;
  // The new bend appears exactly on the wire, where it was clicked. Snapping it
  // to a grid moved it off the line the moment it was created, which is the jump
  // people saw before they had even started dragging.
  baseVertices.splice(best.index, 0, { x: Math.round(best.point.x), y: Math.round(best.point.y) });
  return {
    ...document,
    connections: document.connections.map((item) =>
      item.id === wireId ? { ...item, vertices: baseVertices } : item,
    ),
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

function hasFlexibleBreadboardLeads(component: SchematicComponent): boolean {
  return ['battery', 'battery-holder-aa', 'piezo'].includes(
    catalogEntry(component)?.familyId ?? '',
  );
}

function snapFlexibleLeadsToBreadboard(
  document: SchematicDocument,
  component: SchematicComponent,
): SchematicDocument {
  const entry = catalogEntry(component);
  if (!entry) return document;
  const used = new Set<string>();
  const bindings: Record<string, { breadboardComponentId: string; holeId: string }> = {};

  for (const terminal of component.pinIds ?? Object.keys(entry.terminals)) {
    const physicalPoint = terminalPosition(
      component,
      component.position,
      terminal,
      component.rotation ?? 0,
    );
    if (!physicalPoint) continue;
    let nearest:
      | {
          boardId: string;
          holeId: string;
          distance: number;
        }
      | undefined;
    for (const boardComponent of document.components.filter((item) => item.kind === 'breadboard')) {
      const board = productionBreadboard(boardComponent.componentTypeId ?? '');
      if (!board) continue;
      for (const hole of board.holes) {
        const identity = `${boardComponent.id}:${hole.id}`;
        if (used.has(identity)) continue;
        const holePoint = componentPointPosition(
          boardComponent,
          boardComponent.position,
          hole,
          boardComponent.rotation ?? 0,
        );
        if (!holePoint) continue;
        const distance = Math.hypot(holePoint.x - physicalPoint.x, holePoint.y - physicalPoint.y);
        if (distance <= 30 && (!nearest || distance < nearest.distance)) {
          nearest = { boardId: boardComponent.id, holeId: hole.id, distance };
        }
      }
    }
    if (!nearest) continue;
    bindings[terminal] = {
      breadboardComponentId: nearest.boardId,
      holeId: nearest.holeId,
    };
    used.add(`${nearest.boardId}:${nearest.holeId}`);
  }

  const previous = component.holeBindings ?? {};
  if (
    Object.keys(previous).length === Object.keys(bindings).length &&
    Object.entries(bindings).every(
      ([terminal, binding]) =>
        previous[terminal]?.breadboardComponentId === binding.breadboardComponentId &&
        previous[terminal]?.holeId === binding.holeId,
    )
  ) {
    return document;
  }
  return {
    ...document,
    components: document.components.map((item) =>
      item.id === component.id ? { ...item, holeBindings: bindings } : item,
    ),
  };
}

export function snapComponentToBreadboard(
  document: SchematicDocument,
  componentId: string,
): SchematicDocument {
  const component = document.components.find((item) => item.id === componentId);
  const entry = component ? catalogEntry(component) : null;
  if (component && hasFlexibleBreadboardLeads(component)) {
    return snapFlexibleLeadsToBreadboard(document, component);
  }
  const offsets = entry?.footprint?.pinOffsetsMm;
  const pinIds = component ? physicalTerminalOrder(component) : [];
  if (
    !component ||
    !entry ||
    !offsets ||
    offsets.length === 0 ||
    pinIds.length !== offsets.length
  ) {
    return document;
  }
  const pinPoints = pinIds.map((pinId) =>
    terminalPosition(component, component.position, pinId, component.rotation ?? 0),
  );
  if (pinPoints.some((point) => point === null)) return document;

  const normalizedRotation = (((component.rotation ?? 0) % 360) + 360) % 360;
  const mirrorX = component.stateProperties?.['mirrorX'] === true ? -1 : 1;
  const mirrorY = component.stateProperties?.['mirrorY'] === true ? -1 : 1;
  const footprintOffsetWorld = ([rawX, rawY]: readonly [number, number]): Point => {
    const x = rawX * mirrorX * WORLD_UNITS_PER_MM;
    const y = rawY * mirrorY * WORLD_UNITS_PER_MM;
    const radians = (normalizedRotation * Math.PI) / 180;
    return {
      x: x * Math.cos(radians) - y * Math.sin(radians),
      y: x * Math.sin(radians) + y * Math.cos(radians),
    };
  };
  const footprintOffsets = offsets.map(footprintOffsetWorld);
  const rigidFootprint = ['rectangle', 'dual-inline'].includes(entry.footprint?.kind ?? '');
  const maximumLeadAdjustment =
    (rigidFootprint ? PIN_ANCHOR_TOLERANCE_MM : 1.6) * WORLD_UNITS_PER_MM;

  let best: {
    board: SchematicComponent;
    holes: { id: string; xMm: number; yMm: number }[];
    translation: Point;
    score: number;
  } | null = null;
  for (const boardComponent of document.components.filter((item) => item.kind === 'breadboard')) {
    const board = productionBreadboard(boardComponent.componentTypeId ?? '');
    if (!board) continue;
    const holeWorld = new Map(
      board.holes.flatMap((hole) => {
        const point = componentPointPosition(
          boardComponent,
          boardComponent.position,
          hole,
          boardComponent.rotation ?? 0,
        );
        return point ? [[hole.id, point] as const] : [];
      }),
    );
    for (const originHole of board.holes) {
      const originWorld = holeWorld.get(originHole.id);
      if (!originWorld) continue;
      if (
        Math.hypot(
          originWorld.x - (pinPoints[0] as Point).x,
          originWorld.y - (pinPoints[0] as Point).y,
        ) > 30
      )
        continue;
      const holes = footprintOffsets.flatMap((offset) => {
        const target = { x: originWorld.x + offset.x, y: originWorld.y + offset.y };
        let nearest: { hole: (typeof board.holes)[number]; distance: number } | null = null;
        for (const candidate of board.holes) {
          const point = holeWorld.get(candidate.id);
          if (!point) continue;
          const distance = Math.hypot(point.x - target.x, point.y - target.y);
          if (!nearest || distance < nearest.distance) nearest = { hole: candidate, distance };
        }
        return nearest && nearest.distance <= PIN_ANCHOR_TOLERANCE_MM * WORLD_UNITS_PER_MM
          ? [{ id: nearest.hole.id, xMm: nearest.hole.xMm, yMm: nearest.hole.yMm }]
          : [];
      });
      if (
        holes.length === footprintOffsets.length &&
        new Set(holes.map((hole) => hole.id)).size === holes.length
      ) {
        const targetPoints = holes.map((hole) => holeWorld.get(hole.id) as Point);
        const translationSum = targetPoints.reduce(
          (sum, target, index) => ({
            x: sum.x + target.x - (pinPoints[index] as Point).x,
            y: sum.y + target.y - (pinPoints[index] as Point).y,
          }),
          { x: 0, y: 0 },
        );
        const translation = {
          x: translationSum.x / targetPoints.length,
          y: translationSum.y / targetPoints.length,
        };
        const maximumError = Math.max(
          ...targetPoints.map((target, index) =>
            Math.hypot(
              (pinPoints[index] as Point).x + translation.x - target.x,
              (pinPoints[index] as Point).y + translation.y - target.y,
            ),
          ),
        );
        const distance = Math.hypot(translation.x, translation.y);
        const score = distance + maximumError * 4;
        if (
          distance <= 30 &&
          maximumError <= maximumLeadAdjustment &&
          (!best || score < best.score)
        ) {
          best = { board: boardComponent, holes, translation, score };
        }
      }
    }
  }
  if (!best) {
    if (!component.holeBindings) return document;
    return {
      ...document,
      components: document.components.map((item) =>
        item.id === componentId ? { ...item, holeBindings: {} } : item,
      ),
    };
  }
  const alignedPosition = {
    x: component.position.x + best.translation.x,
    y: component.position.y + best.translation.y,
  };
  const holeBindings = Object.fromEntries(
    pinIds.map((pinId, index) => [
      pinId,
      { breadboardComponentId: best?.board.id as string, holeId: best?.holes[index]?.id as string },
    ]),
  );
  return {
    ...document,
    components: document.components.map((item) =>
      item.id === componentId ? { ...item, position: alignedPosition, holeBindings } : item,
    ),
  };
}

export function componentsBoundToBreadboard(
  document: SchematicDocument,
  breadboardComponentId: string,
): string[] {
  return document.components
    .filter(
      (component) =>
        !hasFlexibleBreadboardLeads(component) &&
        Object.values(component.holeBindings ?? {}).some(
          (binding) => binding.breadboardComponentId === breadboardComponentId,
        ),
    )
    .map((component) => component.id);
}

export function terminalPositionInDocument(
  document: SchematicDocument,
  component: SchematicComponent,
  terminal: Terminal,
): Point | null {
  const binding = component.holeBindings?.[terminal];
  if (binding) {
    const boardComponent = document.components.find(
      (item) => item.id === binding.breadboardComponentId,
    );
    const board = boardComponent
      ? productionBreadboard(boardComponent.componentTypeId ?? '')
      : null;
    const hole = board?.holes.find((candidate) => candidate.id === binding.holeId);
    if (boardComponent && hole) {
      return componentPointPosition(
        boardComponent,
        boardComponent.position,
        hole,
        boardComponent.rotation ?? 0,
      );
    }
  }
  return terminalPosition(component, component.position, terminal, component.rotation ?? 0);
}

export function connectTerminals(
  document: SchematicDocument,
  from: TerminalRef,
  to: TerminalRef,
  id: string,
  color: string,
  vertices: readonly Point[] = [],
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
  const wire: SchematicConnection = {
    id,
    from: { ...from },
    to: { ...to },
    color,
    vertices: [...vertices],
  };
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
  const placed = document.components.filter((component) => catalogEntry(component));
  if (placed.length === 0) return null;
  return placed.reduce(
    (acc, component) => {
      const entry = catalogEntry(component);
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
