import { describe, expect, it } from 'vitest';
import {
  clearLocalProjectDraft,
  readLocalProjectDraft,
  writeLocalProjectDraft,
} from '../project-local-draft';

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

describe('shared project local draft', () => {
  it('ties pending work to a project, module and exact server revision', () => {
    const storage = memoryStorage();
    writeLocalProjectDraft(storage, {
      projectId: 'project-1',
      moduleKey: 'electronics',
      baseRevision: 7,
      document: { schemaVersion: 3, components: [], connections: [] },
    });

    expect(readLocalProjectDraft(storage, 'project-1', 'electronics')).toMatchObject({
      schemaVersion: 1,
      projectId: 'project-1',
      moduleKey: 'electronics',
      baseRevision: 7,
    });
    expect(readLocalProjectDraft(storage, 'project-1', 'chess')).toBeNull();
  });

  it('clears only after a confirmed server save', () => {
    const storage = memoryStorage();
    writeLocalProjectDraft(storage, {
      projectId: 'project-2',
      moduleKey: 'chess',
      baseRevision: 2,
      document: { schemaVersion: 1 },
    });
    clearLocalProjectDraft(storage, 'project-2');
    expect(readLocalProjectDraft(storage, 'project-2', 'chess')).toBeNull();
  });

  it('ignores malformed data', () => {
    const storage = memoryStorage();
    storage.setItem('asa-project-local-draft:project-3', '{broken');
    expect(readLocalProjectDraft(storage, 'project-3', 'checkers')).toBeNull();
  });
});
