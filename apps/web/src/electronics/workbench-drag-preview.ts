import type { SchematicDocument } from '../api';
import {
  catalogEntry,
  componentPointPosition,
  renderedSize,
  terminalPosition,
} from './component-catalog';
import { componentTransform } from './workbench-model';
import { terminalPositionInDocument } from './workbench-document';
import {
  roundedWirePath,
  wirePoints,
  wireTerminalApproachPath,
  wireSegmentAtPoint,
  type Point,
} from './workbench-geometry';

export function wireClientSegment(
  points: readonly Point[],
  target: SVGPathElement,
  client: { clientX: number; clientY: number },
) {
  const matrix = target.getScreenCTM();
  return matrix
    ? wireSegmentAtPoint(
        points,
        new DOMPoint(client.clientX, client.clientY).matrixTransform(matrix.inverse()),
      )
    : null;
}

/** Existing owner front-panel openings retain control and readout priority. */
export function psuWireEntryClip(component: SchematicDocument['components'][number]) {
  const entry = catalogEntry(component);
  if (entry?.key !== 'regulated-power-supply') return null;
  const size = renderedSize(entry, 0);
  return {
    transform: `${componentTransform(component)} scale(${size.width / 294} ${size.height / 237})`,
    d: 'M0 0H294V237H0Z M10 198H85V232H10Z M10 15H190V85H10Z M10 105H190V177H10Z M199 18H269V88H199Z M199 110H269V180H199Z',
  };
}

export function psuWireApproaches(
  document: SchematicDocument,
  points: readonly Point[],
  endpoints: readonly [
    SchematicDocument['connections'][number]['from'] | null,
    SchematicDocument['connections'][number]['to'] | null,
  ],
) {
  return document.components.flatMap((component) => {
    const entry = catalogEntry(component);
    if (entry?.key !== 'regulated-power-supply') return [];
    const corner = (xMm: number, yMm: number) =>
      componentPointPosition(component, component.position, { xMm, yMm }, component.rotation ?? 0)!;
    const corners = [
      corner(0, 0),
      corner(entry.physicalSizeMm.width, 0),
      corner(0, entry.physicalSizeMm.height),
    ] as const;
    return ['positive', 'negative'].flatMap((terminal) => {
      const anchor = terminalPositionInDocument(document, component, terminal);
      if (!anchor) return [];
      const ends = [points, [...points].reverse()].filter(
        (route, index) =>
          endpoints[index]?.componentId === component.id &&
          endpoints[index]?.terminal === terminal &&
          route[0] &&
          Math.hypot(route[0].x - anchor.x, route[0].y - anchor.y) < 1e-6,
      );
      return ends.map((route) => ({
        componentId: component.id,
        terminal,
        path: wireTerminalApproachPath(route, corners),
        transform: componentTransform(component),
      }));
    });
  });
}

/** One component's existing routes, shared by the local paint/hit consumer. */
export function psuEntryPresentation(
  document: SchematicDocument,
  component: SchematicDocument['components'][number],
  routes: readonly {
    wire: SchematicDocument['connections'][number];
    points: readonly Point[];
    selected: boolean;
    endpoints: Parameters<typeof psuWireApproaches>[2];
  }[],
  pending: {
    pendingStart: Point | null;
    wirePreviewEnd: Point | null;
    wirePreviewVertices: readonly Point[];
    pendingTerminal: Parameters<typeof psuWireApproaches>[2][0];
  },
) {
  const clip = psuWireEntryClip(component);
  if (!clip) return null;
  return {
    clip,
    entries: routes.flatMap(({ wire, points, selected, endpoints }) =>
      psuWireApproaches(document, points, endpoints)
        .filter((item) => item.componentId === component.id)
        .map((item) => ({ ...item, wire, selected, points })),
    ),
    pending:
      pending.pendingStart && pending.wirePreviewEnd
        ? psuWireApproaches(
            document,
            wirePoints(pending.pendingStart, pending.wirePreviewEnd, pending.wirePreviewVertices),
            [pending.pendingTerminal, null],
          ).filter((item) => item.componentId === component.id)
        : [],
  };
}

/** One pending visual frame; never writes a document, history or storage. */
export function createVisualFrame() {
  let frame: number | null = null;
  let latest: (() => void) | null = null;
  return {
    schedule(draw: () => void): void {
      latest = draw;
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        const next = latest;
        latest = null;
        next?.();
      });
    },
    cancel(): void {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      latest = null;
    },
  };
}

export function translatedDragDocument(
  document: SchematicDocument,
  componentIds: readonly string[],
  delta: Point,
): SchematicDocument {
  if (delta.x === 0 && delta.y === 0) return document;
  const ids = new Set(componentIds);
  return {
    ...document,
    components: document.components.map((part) => {
      if (!ids.has(part.id)) return part;
      return {
        ...part,
        position: { x: part.position.x + delta.x, y: part.position.y + delta.y },
        // A part picked off a stationary board is detached only on release.
        holeBindings: Object.fromEntries(
          Object.entries(part.holeBindings ?? {}).filter(([, binding]) =>
            ids.has(binding.breadboardComponentId),
          ),
        ),
      };
    }),
    connections: document.connections.map((wire) =>
      ids.has(wire.from.componentId) && ids.has(wire.to.componentId) && wire.vertices
        ? { ...wire, vertices: wire.vertices.map((p) => ({ x: p.x + delta.x, y: p.y + delta.y })) }
        : wire,
    ),
  };
}

export function componentDragWires(document: SchematicDocument, componentIds: readonly string[]) {
  const ids = new Set(componentIds);
  const parts = new Map(document.components.map((part) => [part.id, part]));
  return document.connections.flatMap((wire) => {
    const fromPartMoving = ids.has(wire.from.componentId);
    const toPartMoving = ids.has(wire.to.componentId);
    const bindingMoves = (end: typeof wire.from) => {
      const boardId = parts.get(end.componentId)?.holeBindings?.[end.terminal]
        ?.breadboardComponentId;
      return boardId !== undefined && ids.has(boardId);
    };
    const fromMoving = fromPartMoving || bindingMoves(wire.from);
    const toMoving = toPartMoving || bindingMoves(wire.to);
    if (!fromMoving && !toMoving) return [];
    const endpoint = (end: typeof wire.from, moving: boolean) => {
      const part = parts.get(end.componentId);
      if (!part) return null;
      const binding = part.holeBindings?.[end.terminal];
      return moving && binding && !ids.has(binding.breadboardComponentId)
        ? terminalPosition(part, part.position, end.terminal, part.rotation ?? 0)
        : terminalPositionInDocument(document, part, end.terminal);
    };
    const from = endpoint(wire.from, fromMoving);
    const to = endpoint(wire.to, toMoving);
    if (!from || !to) return [];
    return [
      {
        id: wire.id,
        path(delta: Point): string {
          const shift = (p: Point) => ({ x: p.x + delta.x, y: p.y + delta.y });
          const vertices =
            fromPartMoving && toPartMoving ? wire.vertices?.map(shift) : wire.vertices;
          return roundedWirePath(
            wirePoints(fromMoving ? shift(from) : from, toMoving ? shift(to) : to, vertices),
          );
        },
      },
    ];
  });
}

export function createWireDragPreview(
  stage: SVGSVGElement,
  source: SchematicDocument,
  wireId: string,
) {
  const escapedWireId = CSS.escape(wireId);
  const overlayGroup = stage.querySelector<SVGGElement>(
    '.workbench-wire-overlay > g[data-wire-id="' + escapedWireId + '"]',
  );
  const editorGroup = stage.querySelector<SVGGElement>(
    '.workbench-wire-editor-layer > g[data-wire-id="' + escapedWireId + '"]',
  );
  const nodes = [
    ...(overlayGroup ? Array.from(overlayGroup.querySelectorAll<SVGElement>('path')) : []),
    ...(editorGroup
      ? Array.from(editorGroup.querySelectorAll<SVGElement>('circle[data-wire-vertex-index]'))
      : []),
    ...Array.from(
      stage.querySelectorAll<SVGElement>(
        '[data-psu-wire-entry][data-wire-id="' + escapedWireId + '"] path',
      ),
    ),
  ];
  const original = nodes.map((node) => ({
    node,
    d: node.getAttribute('d'),
    cx: node.getAttribute('cx'),
    cy: node.getAttribute('cy'),
  }));
  stage.dataset['wireDragging'] = 'true';
  return {
    draw(document: SchematicDocument): void {
      const wire = document.connections.find((item) => item.id === wireId);
      const fromPart = source.components.find((item) => item.id === wire?.from.componentId);
      const toPart = source.components.find((item) => item.id === wire?.to.componentId);
      if (!wire || !fromPart || !toPart) return;
      const from = terminalPositionInDocument(source, fromPart, wire.from.terminal);
      const to = terminalPositionInDocument(source, toPart, wire.to.terminal);
      if (!from || !to) return;
      const points = wirePoints(from, to, wire.vertices);
      const path = roundedWirePath(points);
      const approaches = psuWireApproaches(source, points, [wire.from, wire.to]);
      for (const node of nodes) {
        if (node.tagName.toLowerCase() === 'path') {
          const entry = node.closest<SVGElement>('[data-psu-wire-entry]');
          node.setAttribute(
            'd',
            entry
              ? (approaches.find(
                  (item) =>
                    item.componentId === entry.dataset['componentId'] &&
                    item.terminal === entry.dataset['terminal'],
                )?.path ?? '')
              : path,
          );
        } else {
          const point = wire.vertices?.[Number(node.dataset['wireVertexIndex'])];
          if (point) {
            node.setAttribute('cx', String(point.x));
            node.setAttribute('cy', String(point.y));
          }
        }
      }
    },
    restore(): void {
      for (const { node, d, cx, cy } of original) {
        for (const [name, value] of [
          ['d', d],
          ['cx', cx],
          ['cy', cy],
        ] as const) {
          if (value === null) node.removeAttribute(name);
          else node.setAttribute(name, value);
        }
      }
      delete stage.dataset['wireDragging'];
    },
  };
}

/** Mutate only presentation attributes; restore before the single final commit. */
export function createComponentDragPreview(
  stage: SVGSVGElement,
  document: SchematicDocument,
  componentIds: readonly string[],
) {
  const ids = new Set(componentIds);
  const parts = new Map(document.components.map((part) => [part.id, part]));
  const leads = Array.from(
    stage.querySelectorAll<SVGLineElement>('[data-mounted-terminal]'),
  ).flatMap((node) => {
    const partId = node.closest<SVGElement>('[data-testid="schematic-component"]')?.dataset[
      'componentId'
    ];
    const part = parts.get(partId ?? '');
    const binding = part?.holeBindings?.[node.dataset['mountedTerminal'] ?? ''];
    if (!part || !binding) return [];
    const partMoves = ids.has(part.id);
    const boardMoves = ids.has(binding.breadboardComponentId);
    if (partMoves === boardMoves) return [];
    return [
      {
        node,
        detached: partMoves,
        x: node.getAttribute('x2')!,
        y: node.getAttribute('y2')!,
        visibility: node.style.visibility,
      },
    ];
  });
  const transforms = Array.from(
    stage.querySelectorAll<SVGElement>(
      '[data-testid="schematic-component"], .workbench-diagnostic-layer [data-component-id], [data-psu-entry-clip][data-component-id]',
    ),
  )
    .filter((node) => ids.has(node.dataset['componentId'] ?? ''))
    .map((node) => ({ node, original: node.getAttribute('transform') }));
  const paths = componentDragWires(document, componentIds).flatMap((wire) => {
    const nodes = Array.from(
      stage.querySelectorAll<SVGPathElement>(
        '[data-testid="schematic-wire"][data-wire-id="' + CSS.escape(wire.id) + '"]',
      ),
    );
    const entryNodes = Array.from(
      stage.querySelectorAll<SVGPathElement>(
        '[data-psu-wire-entry][data-wire-id="' + CSS.escape(wire.id) + '"] path',
      ),
    );
    return [...nodes, ...entryNodes].map((node) => ({
      node,
      original: node.getAttribute('d'),
      path(delta: Point): string {
        const entry = node.closest<SVGElement>('[data-psu-wire-entry]');
        if (!entry) return wire.path(delta);
        const next = translatedDragDocument(document, componentIds, delta);
        const connection = next.connections.find((item) => item.id === wire.id)!;
        const fromPart = next.components.find((item) => item.id === connection.from.componentId)!;
        const toPart = next.components.find((item) => item.id === connection.to.componentId)!;
        const from = terminalPositionInDocument(next, fromPart, connection.from.terminal);
        const to = terminalPositionInDocument(next, toPart, connection.to.terminal);
        return from && to
          ? (psuWireApproaches(next, wirePoints(from, to, connection.vertices), [
              connection.from,
              connection.to,
            ]).find(
              (item) =>
                item.componentId === entry.dataset['componentId'] &&
                item.terminal === entry.dataset['terminal'],
            )?.path ?? '')
          : '';
      },
    }));
  });
  stage.dataset['componentDragging'] = 'true';
  return {
    draw(delta: Point): void {
      for (const lead of leads) {
        if (lead.detached) lead.node.style.visibility = 'hidden';
        else {
          lead.node.setAttribute('x2', String(Number(lead.x) + delta.x));
          lead.node.setAttribute('y2', String(Number(lead.y) + delta.y));
        }
      }
      for (const { node, original } of transforms) {
        node.setAttribute(
          'transform',
          'translate(' + delta.x + ' ' + delta.y + ') ' + (original ?? ''),
        );
      }
      for (const { node, path } of paths) node.setAttribute('d', path(delta));
    },
    restore(): void {
      for (const lead of leads) {
        lead.node.setAttribute('x2', lead.x);
        lead.node.setAttribute('y2', lead.y);
        lead.node.style.visibility = lead.visibility;
      }
      for (const { node, original } of transforms) {
        if (original === null) node.removeAttribute('transform');
        else node.setAttribute('transform', original);
      }
      for (const { node, original } of paths) {
        if (original === null) node.removeAttribute('d');
        else node.setAttribute('d', original);
      }
      delete stage.dataset['componentDragging'];
    },
  };
}
