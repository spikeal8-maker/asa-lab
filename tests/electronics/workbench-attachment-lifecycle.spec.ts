import { describe, expect, it } from 'vitest';
import type { SchematicDocument } from '../../apps/web/src/api';
import {
  detachComponentFromBreadboard,
  moveComponentInDocument,
  removeSelectionFromDocument,
  rotateSelectionInDocument,
} from '../../apps/web/src/electronics/workbench-document';

function mountedDocument(): SchematicDocument {
  return {
    schemaVersion: 1,
    geometryProfile: 'breadboard-2.54mm-v1',
    components: [
      { id: 'board', kind: 'breadboard', position: { x: 100, y: 100 }, value: 0, rotation: 0 },
      { id: 'r1', kind: 'resistor', position: { x: 120, y: 120 }, value: 300, rotation: 0 },
      { id: 'led1', kind: 'led', position: { x: 180, y: 120 }, value: 2, rotation: 0 },
    ],
    connections: [],
    breadboardAttachments: [
      {
        id: 'r1-a',
        breadboardComponentId: 'board',
        breadboardTerminalId: 'half-400:terminal:1:a',
        componentId: 'r1',
        componentTerminalId: 'a',
      },
      {
        id: 'r1-b',
        breadboardComponentId: 'board',
        breadboardTerminalId: 'half-400:terminal:11:a',
        componentId: 'r1',
        componentTerminalId: 'b',
      },
      {
        id: 'led-a',
        breadboardComponentId: 'board',
        breadboardTerminalId: 'half-400:terminal:15:a',
        componentId: 'led1',
        componentTerminalId: 'a',
      },
    ],
  };
}

describe('workbench breadboard attachment lifecycle', () => {
  it('detaches only the selected mounted component', () => {
    const document = mountedDocument();
    const detached = detachComponentFromBreadboard(document, 'r1');
    expect(detached.breadboardAttachments).toEqual([
      expect.objectContaining({ id: 'led-a', componentId: 'led1' }),
    ]);
    expect(document.breadboardAttachments).toHaveLength(3);
  });

  it('moving a mounted component removes hidden physical attachments atomically', () => {
    const document = mountedDocument();
    const moved = moveComponentInDocument(document, 'r1', { x: 300, y: 260 });
    expect(moved.components.find((component) => component.id === 'r1')?.position).not.toEqual(
      document.components.find((component) => component.id === 'r1')?.position,
    );
    expect(moved.breadboardAttachments?.some((attachment) => attachment.componentId === 'r1')).toBe(
      false,
    );
    expect(moved.breadboardAttachments?.some((attachment) => attachment.componentId === 'led1')).toBe(
      true,
    );
  });

  it('rotating a mounted component detaches before changing orientation', () => {
    const rotated = rotateSelectionInDocument(mountedDocument(), { kind: 'component', id: 'r1' });
    expect(rotated).not.toBeNull();
    expect(rotated?.components.find((component) => component.id === 'r1')?.rotation).toBe(90);
    expect(rotated?.breadboardAttachments?.some((attachment) => attachment.componentId === 'r1')).toBe(
      false,
    );
  });

  it('deleting a component removes its wires and physical attachments', () => {
    const removed = removeSelectionFromDocument(mountedDocument(), { kind: 'component', id: 'r1' });
    expect(removed.components.some((component) => component.id === 'r1')).toBe(false);
    expect(removed.breadboardAttachments?.some((attachment) => attachment.componentId === 'r1')).toBe(
      false,
    );
  });

  it('deleting the board removes all attachments without deleting mounted components', () => {
    const removed = removeSelectionFromDocument(mountedDocument(), {
      kind: 'component',
      id: 'board',
    });
    expect(removed.components.some((component) => component.id === 'board')).toBe(false);
    expect(removed.components.map((component) => component.id).sort()).toEqual(['led1', 'r1']);
    expect(removed.breadboardAttachments).toEqual([]);
  });
});
