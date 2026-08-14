import { describe, expect, it } from 'vitest';
import { createEmptyThreeDDocument, createThreeDNode } from '@asa-lab/three-d';
import { clearLocalThreeDDraft, readLocalThreeDDraft, writeLocalThreeDDraft } from '../local-draft';

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => void values.delete(key),
    setItem: (key, value) => void values.set(key, value),
  };
}

describe('ASA 3D local draft safety net', () => {
  it('keeps a pending document tied to the exact server baseline', () => {
    const storage = memoryStorage();
    const document = {
      ...createEmptyThreeDDocument(),
      nodes: [createThreeDNode('box', 'box-local')],
    };

    writeLocalThreeDDraft(storage, 'project-1', document, 'server-revision-a');

    expect(readLocalThreeDDraft(storage, 'project-1')).toMatchObject({
      schemaVersion: 1,
      serverSignature: 'server-revision-a',
      document: { nodes: [{ id: 'box-local' }] },
    });
  });

  it('clears a local copy only after a successful server save', () => {
    const storage = memoryStorage();
    writeLocalThreeDDraft(storage, 'project-2', createEmptyThreeDDocument(), 'baseline');
    clearLocalThreeDDraft(storage, 'project-2');
    expect(readLocalThreeDDraft(storage, 'project-2')).toBeNull();
  });

  it('ignores malformed browser data without breaking the editor', () => {
    const storage = memoryStorage();
    storage.setItem('asa3d-local-draft:project-3', '{broken');
    expect(readLocalThreeDDraft(storage, 'project-3')).toBeNull();
  });
});
