import { describe, expect, it } from 'vitest';
import type { SchematicDocument } from '../../apps/web/src/api';
import { addComponentToDocument } from '../../apps/web/src/electronics/workbench-document';

const emptyDocument: SchematicDocument = {
  schemaVersion: 1,
  geometryProfile: 'breadboard-2.54mm-v1',
  components: [],
  connections: [],
};

describe('workbench document component boundary', () => {
  it('creates only a fully enabled component', () => {
    const created = addComponentToDocument(emptyDocument, 'resistor', { x: 200, y: 200 }, 'r1');
    expect(created.component).toMatchObject({
      id: 'r1',
      kind: 'resistor',
      value: 300,
      rotation: 0,
    });
    expect(created.document.components).toHaveLength(1);
  });

  it('rejects the planned breadboard until asset terminals attachments and browser flow exist', () => {
    expect(() =>
      addComponentToDocument(emptyDocument, 'breadboard', { x: 200, y: 200 }, 'board1'),
    ).toThrow(/breadboard is not enabled/);
    expect(emptyDocument.components).toEqual([]);
  });
});
