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
  it('returns failure for denied getters, quota, serialization and silent dropped writes', () => {
    const input = { projectId: 'p', moduleKey: 'electronics', baseRevision: 1, document: {} };
    const denied = () => {
      throw new Error('Denied storage getter');
    };
    expect(writeLocalProjectDraft(denied, input)).toBe(false);
    expect(readLocalProjectDraft(denied, 'p', 'electronics')).toBeNull();
    expect(() => clearLocalProjectDraft(denied, 'p')).not.toThrow();
    const storage = memoryStorage();
    storage.setItem = () => {
      throw new Error('Quota exceeded');
    };
    expect(writeLocalProjectDraft(storage, input)).toBe(false);
    storage.setItem = () => undefined;
    expect(writeLocalProjectDraft(storage, input)).toBe(false);
    const cyclic: Record<string, unknown> = {};
    cyclic['self'] = cyclic;
    expect(writeLocalProjectDraft(memoryStorage(), { ...input, document: cyclic })).toBe(false);
  });

  it('isolates attributed records without adopting, changing or deleting legacy bytes', () => {
    const storage = memoryStorage();
    const input = {
      projectId: 'p',
      moduleKey: 'electronics',
      baseRevision: 1,
      document: { sketch: 'old' },
    };
    expect(writeLocalProjectDraft(storage, input)).toBe(true);
    const legacy = storage.getItem('asa-project-local-draft:p');
    expect(readLocalProjectDraft(storage, 'p', 'electronics', 'u')).toBeNull();
    expect(
      writeLocalProjectDraft(storage, { ...input, userId: 'u', document: { sketch: 'new' } }),
    ).toBe(true);
    expect(readLocalProjectDraft(storage, 'p', 'electronics', 'u')).toMatchObject({
      schemaVersion: 3,
      userId: 'u',
      identityKind: 'account',
      document: { sketch: 'new' },
    });
    expect(readLocalProjectDraft(storage, 'p', 'electronics', 'other')).toBeNull();
    expect(readLocalProjectDraft(storage, 'p', 'electronics', 'u', 'seat')).toBeNull();
    const key = 'asa-project-local-draft:user:account:u:p';
    const raw = JSON.parse(storage.getItem(key)!);
    raw.userId = 'other';
    storage.setItem(key, JSON.stringify(raw));
    expect(readLocalProjectDraft(storage, 'p', 'electronics', 'u')).toBeNull();
    clearLocalProjectDraft(storage, 'p', 'u');
    expect(storage.getItem('asa-project-local-draft:p')).toBe(legacy);
    expect(readLocalProjectDraft(storage, 'p', 'electronics')?.schemaVersion).toBe(2);
  });

  it('keeps Chess and Checkers defaults at schema2 and their original keys', () => {
    for (const moduleKey of ['chess', 'checkers']) {
      const storage = memoryStorage();
      expect(
        writeLocalProjectDraft(storage, {
          projectId: moduleKey,
          moduleKey,
          baseRevision: 9,
          document: { schemaVersion: 1 },
        }),
      ).toBe(true);
      expect(storage.key(0)).toBe(`asa-project-local-draft:${moduleKey}`);
      expect(readLocalProjectDraft(storage, moduleKey, moduleKey)).toMatchObject({
        schemaVersion: 2,
      });
    }
  });
  it('ties pending work to a project, module and exact server revision', () => {
    const storage = memoryStorage();
    writeLocalProjectDraft(storage, {
      projectId: 'project-1',
      moduleKey: 'electronics',
      baseRevision: 7,
      baseDocument: { schemaVersion: 3, components: [], connections: [] },
      document: { schemaVersion: 3, components: [], connections: [] },
    });

    expect(readLocalProjectDraft(storage, 'project-1', 'electronics')).toMatchObject({
      schemaVersion: 2,
      projectId: 'project-1',
      moduleKey: 'electronics',
      baseRevision: 7,
      baseDocument: { schemaVersion: 3, components: [], connections: [] },
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

  it('still reads schema-1 drafts created before safe three-way merge metadata existed', () => {
    const storage = memoryStorage();
    storage.setItem(
      'asa-project-local-draft:project-legacy',
      JSON.stringify({
        schemaVersion: 1,
        projectId: 'project-legacy',
        moduleKey: 'electronics',
        baseRevision: 3,
        document: { schemaVersion: 3, components: [], connections: [] },
        updatedAt: '2026-08-28T00:00:00.000Z',
      }),
    );
    expect(readLocalProjectDraft(storage, 'project-legacy', 'electronics')).toMatchObject({
      schemaVersion: 1,
      baseRevision: 3,
    });
  });
});
