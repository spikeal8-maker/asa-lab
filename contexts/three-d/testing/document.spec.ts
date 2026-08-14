import { describe, expect, it } from 'vitest';
import {
  commitCommand,
  createEmptyThreeDDocument,
  createHistory,
  createThreeDNode,
  parseThreeDDocument,
  redoHistory,
  undoHistory,
} from '../index.js';

describe('ASA 3D document', () => {
  it('creates a versioned millimetre document accepted by the parser', () => {
    const document = createEmptyThreeDDocument();
    expect(parseThreeDDocument(document)).toEqual({ ok: true, value: document });
    expect(document.units).toBe('mm');
    expect(document.schemaVersion).toBe(1);
    expect(document.camera).toEqual({
      position: { x: 0, y: 181, z: 181 },
      target: { x: 0, y: 0, z: 0 },
      projection: 'perspective',
    });
  });

  it('rejects duplicate node identifiers', () => {
    const document = createEmptyThreeDDocument();
    const node = createThreeDNode('box', 'same');
    expect(parseThreeDDocument({ ...document, nodes: [node, node] })).toEqual({
      ok: false,
      message: 'Идентификаторы 3D-объектов должны быть уникальными.',
    });
  });

  it('applies reversible commands without mutating the source document', () => {
    const source = createEmptyThreeDDocument();
    const added = commitCommand(createHistory(source), {
      type: 'add',
      node: createThreeDNode('cylinder', 'cylinder-1'),
    });
    expect(source.nodes).toHaveLength(0);
    expect(added.present.nodes).toHaveLength(1);
    const undone = undoHistory(added);
    expect(undone.present.nodes).toHaveLength(0);
    expect(redoHistory(undone).present.nodes[0]?.primitive).toBe('cylinder');
  });
});
