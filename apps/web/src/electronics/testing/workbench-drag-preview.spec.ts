import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, afterEach, describe, expect, it, vi } from 'vitest';
import type { SchematicDocument } from '../../api';
import { configureProductionLibrary } from '../production-manifest-adapter';
import { addComponentToDocument } from '../workbench-document';
import {
  createVisualFrame,
  translatedDragDocument,
  componentDragWires,
} from '../workbench-drag-preview';

beforeAll(() =>
  configureProductionLibrary(
    JSON.parse(
      readFileSync(
        resolve(
          process.cwd(),
          'apps/web/public/assets/electronics/component-database/catalog.json',
        ),
        'utf8',
      ),
    ),
  ),
);
afterEach(() => vi.unstubAllGlobals());

function fixture(): SchematicDocument {
  let doc: SchematicDocument = {
    schemaVersion: 4,
    components: [],
    connections: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    simulation: { running: false, maxIterations: 24 },
  };
  for (const [type, id, x] of [
    ['breadboard-medium', 'board', 500],
    ['led-5mm', 'led', 600],
    ['resistor-axial', 'r', 800],
  ] as const)
    doc = addComponentToDocument(doc, type, { x, y: 300 }, id).document;
  return {
    ...doc,
    components: doc.components.map((part) =>
      part.id === 'led'
        ? {
            ...part,
            holeBindings: { anode: { breadboardComponentId: 'board', holeId: 'J8' } },
          }
        : part,
    ),
    connections: [
      {
        id: 'wire',
        from: { componentId: 'led', terminal: 'cathode' },
        to: { componentId: 'r', terminal: 'a' },
        vertices: [{ x: 700, y: 420 }],
      },
    ],
  };
}

describe('transactional visual drag', () => {
  it('coalesces events into one frame and cancels stale work', () => {
    let queued: FrameRequestCallback | undefined;
    const request = vi.fn((callback: FrameRequestCallback) => {
      queued = callback;
      return 7;
    });
    const cancel = vi.fn();
    vi.stubGlobal('requestAnimationFrame', request);
    vi.stubGlobal('cancelAnimationFrame', cancel);
    const frame = createVisualFrame();
    const draws = Array.from({ length: 100 }, () => vi.fn());
    draws.forEach((draw) => frame.schedule(draw));
    expect(request).toHaveBeenCalledTimes(1);
    queued?.(0);
    expect(draws[99]).toHaveBeenCalledTimes(1);
    expect(draws.slice(0, 99).every((draw) => draw.mock.calls.length === 0)).toBe(true);
    frame.schedule(draws[0]!);
    frame.cancel();
    queued?.(0);
    expect(cancel).toHaveBeenCalledWith(7);
    expect(draws[0]).not.toHaveBeenCalled();
  });

  it('moves a board and its parts together without changing connectivity or input bytes', () => {
    const doc = fixture();
    const bytes = JSON.stringify(doc);
    const next = translatedDragDocument(doc, ['board', 'led', 'r'], { x: 30, y: -20 });
    expect(JSON.stringify(doc)).toBe(bytes);
    expect(next.components.map((p) => p.position)).toEqual(
      doc.components.map((p) => ({ x: p.position.x + 30, y: p.position.y - 20 })),
    );
    expect(next.components[1]?.holeBindings).toEqual(doc.components[1]?.holeBindings);
    expect(next.connections[0]?.from).toEqual(doc.connections[0]?.from);
    expect(next.connections[0]?.to).toEqual(doc.connections[0]?.to);
    expect(next.connections[0]?.vertices).toEqual([{ x: 730, y: 400 }]);
  });

  it('detaches a picked part only in the committed copy and retains stationary wire bends', () => {
    const doc = fixture();
    const next = translatedDragDocument(doc, ['led'], { x: 12, y: 15 });
    expect(next.components[1]?.holeBindings).toEqual({});
    expect(doc.components[1]?.holeBindings?.['anode']?.breadboardComponentId).toBe('board');
    expect(next.components[0]).toBe(doc.components[0]);
    expect(next.connections[0]).toBe(doc.connections[0]);
    expect(translatedDragDocument(doc, ['led'], { x: 0, y: 0 })).toBe(doc);
  });

  it('wire preview equals the committed path for one or both moving endpoints', () => {
    const doc = fixture();
    for (const ids of [['led'], ['led', 'r'], ['board', 'led', 'r']]) {
      const delta = { x: 31, y: -17 };
      const preview = componentDragWires(doc, ids);
      const committed = translatedDragDocument(doc, ids, delta);
      expect(preview).toHaveLength(1);
      expect(preview[0]?.path(delta)).toBe(
        componentDragWires(committed, ids)[0]?.path({ x: 0, y: 0 }),
      );
      expect(componentDragWires(doc, ['board'])).toHaveLength(0);
    }
  });

  it('moves a wire endpoint attached by a flexible lead to the moving board', () => {
    const source = fixture();
    const doc = {
      ...source,
      connections: source.connections.map((wire) => ({
        ...wire,
        from: { ...wire.from, terminal: 'anode' },
      })),
    };
    const delta = { x: 20, y: 15 };
    const preview = componentDragWires(doc, ['board']);
    const next = translatedDragDocument(doc, ['board'], delta);
    expect(preview).toHaveLength(1);
    expect(preview[0]?.path(delta)).toBe(
      componentDragWires(next, ['board'])[0]?.path({ x: 0, y: 0 }),
    );
    expect(next.components[1]).toBe(doc.components[1]);
    expect(next.connections[0]?.vertices).toBe(doc.connections[0]?.vertices);
  });
});
