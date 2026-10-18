import { describe, expect, it, vi } from 'vitest';
import { parseElectronicsDocument } from '@asa-lab/electronics';
import type { SchematicDocument } from '../../api';
import { localProjectDraftKey, type LocalProjectDraft } from '../../modules/project-local-draft';
import { repairElectronicsDocumentIdentifiers as inspectIdentifiers } from '../electronics-document-repair';
import { createElectronicsProjectRecovery } from '../electronics-project-recovery';

const repairElectronicsDocumentIdentifiers = (document: SchematicDocument) =>
  inspectIdentifiers(document).document;

function broken(): SchematicDocument {
  const board = 'board-'.repeat(20);
  const resistor = 'resistor-'.repeat(20);
  return {
    schemaVersion: 4,
    components: [
      { id: board, kind: 'breadboard', value: 0, position: { x: 0, y: 0 }, pinIds: ['H1'] },
      {
        id: resistor,
        kind: 'resistor',
        value: 220,
        position: { x: 10, y: 10 },
        name: 'R'.repeat(120) + ' — копия',
        pinIds: ['a', 'b'],
        holeBindings: { a: { breadboardComponentId: board, holeId: 'H1' } },
        stateProperties: { sketchSource: `// Keep literal ${resistor}\nvoid setup() {}` },
      },
      { id: 'led', kind: 'led', value: 2, position: { x: 50, y: 10 } },
    ],
    connections: [
      {
        id: 'wire-'.repeat(30),
        from: { componentId: resistor, terminal: 'b' },
        to: { componentId: 'led', terminal: 'a' },
        color: '#129944',
        vertices: [{ x: 30, y: 20 }],
      },
    ],
    viewport: { x: 5, y: 20, zoom: 2 },
    simulation: { running: false, maxIterations: 24 },
  };
}

describe('safe recovery of old Electronics copy identifiers', () => {
  it('preserves all objects, board bindings, geometry and code while repairing references', () => {
    const original = broken();
    const bytes = JSON.stringify(original);
    expect(parseElectronicsDocument(original).ok).toBe(false);
    const repaired = repairElectronicsDocumentIdentifiers(original)!;
    expect(repaired).not.toBeNull();
    expect(parseElectronicsDocument(repaired).ok).toBe(true);
    expect(JSON.stringify(original)).toBe(bytes);
    expect(repaired.components).toHaveLength(original.components.length);
    expect(repaired.connections).toHaveLength(original.connections.length);
    expect(repaired.components[2]).toEqual(original.components[2]);
    expect(repaired.components[1]).toEqual({
      ...original.components[1],
      id: repaired.components[1]!.id,
      name: 'R'.repeat(112) + ' — копия',
      holeBindings: { a: { breadboardComponentId: repaired.components[0]!.id, holeId: 'H1' } },
    });
    expect(repaired.connections[0]).toEqual({
      ...original.connections[0],
      id: repaired.connections[0]!.id,
      from: { componentId: repaired.components[1]!.id, terminal: 'b' },
    });
    for (const item of [...repaired.components, ...repaired.connections]) {
      expect(item.id.length).toBeGreaterThan(0);
      expect(item.id.length).toBeLessThanOrEqual(64);
    }
    expect(repaired.viewport).toEqual(original.viewport);
    expect(repairElectronicsDocumentIdentifiers(original)).toEqual(repaired);
    expect(repairElectronicsDocumentIdentifiers(repaired)).toBeNull();
  });

  it('keeps existing IDs even when one collides with a generated recovery ID', () => {
    const original = broken();
    const generated = repairElectronicsDocumentIdentifiers(original)!.components[0]!.id;
    const withCollision = {
      ...original,
      components: [
        ...original.components,
        {
          id: generated,
          kind: 'resistor' as const,
          value: 100,
          position: { x: 1, y: 1 },
        },
      ],
    };
    const repaired = repairElectronicsDocumentIdentifiers(withCollision)!;
    expect(repaired.components.at(-1)!.id).toBe(generated);
    expect(repaired.components[0]!.id).not.toBe(generated);
    expect(new Set(repaired.components.map((item) => item.id)).size).toBe(
      repaired.components.length,
    );
    expect(parseElectronicsDocument(repaired).ok).toBe(true);
  });

  it('recovers a unique empty ID and every endpoint referring to it', () => {
    const original = broken();
    const empty = {
      ...original,
      components: original.components.map((item, index) =>
        index === 2 ? { ...item, id: '' } : item,
      ),
      connections: original.connections.map((wire) => ({
        ...wire,
        to: { ...wire.to, componentId: '' },
      })),
    };
    const repaired = repairElectronicsDocumentIdentifiers(empty)!;
    expect(parseElectronicsDocument(repaired).ok).toBe(true);
    expect(repaired.connections[0]!.to.componentId).toBe(repaired.components[2]!.id);
  });

  it('refuses ambiguous identities, unrelated invalid data and custom long names', () => {
    const original = broken();
    const cases = [
      { ...original, components: [...original.components, original.components[0]!] },
      { ...original, connections: [...original.connections, original.connections[0]!] },
      {
        ...original,
        connections: [
          { ...original.connections[0]!, to: { componentId: 'missing', terminal: 'a' } },
        ],
      },
      { ...original, components: original.components.map((item) => ({ ...item, value: -1 })) },
      {
        ...original,
        components: original.components.map((item) => ({ ...item, name: 'Custom'.repeat(30) })),
      },
      { ...original, components: [{ ...original.components[0]!, id: 5 }] },
      { ...original, components: [null] },
      { ...original, components: [{ ...original.components[0]!, holeBindings: { a: null } }] },
    ];
    for (const candidate of cases) {
      const bytes = JSON.stringify(candidate);
      expect(inspectIdentifiers(candidate as unknown as SchematicDocument).status).toBe('blocked');
      expect(JSON.stringify(candidate)).toBe(bytes);
    }
  });
});

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
    values,
  };
}

describe('scoped original backups before identifier recovery', () => {
  const draft: LocalProjectDraft<SchematicDocument> = {
    schemaVersion: 3,
    projectId: 'p',
    userId: 'u',
    identityKind: 'account',
    moduleKey: 'electronics',
    baseRevision: 7,
    baseDocument: broken(),
    document: broken(),
    updatedAt: '2026-10-16T10:00:00Z',
  };

  it('carries exact consumed receipts across reload and retires identical mirrors after a descendant save', () => {
    const storage = memoryStorage();
    const base = localProjectDraftKey('p', 'u', 'account');
    const oldKey = base + ':electronics-editor:old';
    const raw = JSON.stringify(draft);
    storage.setItem(oldKey, raw);
    storage.setItem(base, JSON.stringify({ ...draft, updatedAt: '2026-10-16T10:00:01Z' }));
    const first = createElectronicsProjectRecovery<SchematicDocument>(
      () => storage,
      null,
      'p',
      'u',
      'account',
    );
    expect(first.preserveOriginal(first.read()!)).toBe(true);
    expect(first.write({ baseRevision: 7, document: draft.document })).toBe(true);
    const resumed = createElectronicsProjectRecovery<SchematicDocument>(
      () => storage,
      null,
      'p',
      'u',
      'account',
    );
    const pending = resumed.read()!;
    expect(resumed.preserveOriginal(pending, false)).toBe(true);
    const deleted = { ...draft.document, components: [], connections: [] };
    expect(resumed.write({ baseRevision: 7, document: deleted })).toBe(true);
    resumed.clear(deleted);
    expect(storage.getItem(oldKey)).toBe(raw);
    expect(storage.getItem(oldKey + ':ack')).not.toBeNull();
    const fresh = createElectronicsProjectRecovery<SchematicDocument>(
      () => storage,
      null,
      'p',
      'u',
      'account',
    );
    expect(fresh.read()).toBeNull();
  });

  it('never acknowledges a concurrent replacement of the consumed source', () => {
    const storage = memoryStorage();
    const key = localProjectDraftKey('p', 'u', 'account') + ':electronics-editor:old';
    storage.setItem(key, JSON.stringify(draft));
    const recovery = createElectronicsProjectRecovery<SchematicDocument>(
      () => storage,
      null,
      'p',
      'u',
      'account',
    );
    expect(recovery.preserveOriginal(recovery.read()!)).toBe(true);
    const deleted = { ...draft.document, components: [], connections: [] };
    expect(recovery.write({ baseRevision: 7, document: deleted })).toBe(true);
    const replacement = JSON.stringify({
      ...draft,
      document: { ...draft.document, viewport: { x: 999, y: 0, zoom: 1 } },
    });
    storage.setItem(key, replacement);
    recovery.clear(deleted);
    expect(storage.getItem(key)).toBe(replacement);
    expect(storage.getItem(key + ':ack')).toBeNull();
  });

  it('keeps the descendant recovery slot if retiring its source cannot be verified', () => {
    const storage = memoryStorage();
    const key = localProjectDraftKey('p', 'u', 'account') + ':electronics-editor:old';
    storage.setItem(key, JSON.stringify(draft));
    const recovery = createElectronicsProjectRecovery<SchematicDocument>(
      () => storage,
      null,
      'p',
      'u',
      'account',
    );
    expect(recovery.preserveOriginal(recovery.read()!)).toBe(true);
    const deleted = { ...draft.document, components: [], connections: [] };
    expect(recovery.write({ baseRevision: 7, document: deleted })).toBe(true);
    const actual = storage.setItem;
    vi.spyOn(storage, 'setItem').mockImplementation((name, value) => {
      if (name.endsWith(':ack')) throw new Error('quota');
      actual(name, value);
    });
    recovery.clear(deleted);
    expect(recovery.readOwned()!.document).toEqual(deleted);
    expect(storage.getItem(key + ':ack')).toBeNull();
  });

  it('rejects foreign or unverifiable inherited receipts without changing their source', () => {
    for (const receipt of [
      { key: localProjectDraftKey('other', 'u', 'account'), fingerprint: 'a'.repeat(64) },
      { key: localProjectDraftKey('p', 'u', 'account'), fingerprint: 'a'.repeat(64) },
      { key: localProjectDraftKey('p', 'u', 'account'), fingerprint: 'invalid' },
    ]) {
      const storage = memoryStorage();
      const key = localProjectDraftKey('p', 'u', 'account');
      const raw = JSON.stringify({ ...draft, electronicsIdentifierSources: [receipt] });
      storage.setItem(key, raw);
      const recovery = createElectronicsProjectRecovery<SchematicDocument>(
        () => storage,
        null,
        'p',
        'u',
        'account',
      );
      expect(recovery.preserveOriginal(recovery.read()!, false)).toBe(false);
      expect(storage.getItem(key)).toBe(raw);
      expect(storage.getItem(key + ':ack')).toBeNull();
    }
  });

  it('verifies exact original bytes, deduplicates backups and never restores them as pending drafts', () => {
    const storage = memoryStorage();
    const key = localProjectDraftKey('p', 'u', 'account');
    const raw = JSON.stringify(draft, null, 2);
    storage.setItem(key, raw);
    const recovery = createElectronicsProjectRecovery<SchematicDocument>(
      () => storage,
      null,
      'p',
      'u',
      'account',
    );
    expect(recovery.preserveOriginal(recovery.read()!)).toBe(true);
    expect(recovery.preserveOriginal(recovery.read()!)).toBe(true);
    const originals = [...storage.values.keys()].filter((item) =>
      item.includes(':electronics-identifier-original:'),
    );
    expect(originals).toHaveLength(1);
    expect(storage.getItem(originals[0]!)).toBe(raw);
    storage.removeItem(key);
    expect(recovery.read()).toBeNull();
    const fresh = createElectronicsProjectRecovery<SchematicDocument>(
      () => storage,
      null,
      'p',
      'u',
      'account',
    );
    expect(fresh.read()).toBeNull();
    expect(recovery.preserveOriginal({ ...draft, userId: 'other' })).toBe(false);
    expect(recovery.preserveOriginal({ ...draft, projectId: 'other' })).toBe(false);
    const seat = createElectronicsProjectRecovery<SchematicDocument>(
      () => storage,
      null,
      'p',
      'u',
      'seat',
    );
    expect(seat.preserveOriginal(draft)).toBe(false);
  });

  it('reports quota failure and dishonest readback without accepting a backup', () => {
    const storage = memoryStorage();
    const recovery = createElectronicsProjectRecovery<SchematicDocument>(
      () => storage,
      null,
      'p',
      'u',
      'account',
    );
    const set = vi.spyOn(storage, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(recovery.preserveOriginal(draft)).toBe(false);
    set.mockImplementation(() => undefined);
    expect(recovery.preserveOriginal(draft)).toBe(false);
    expect(storage.length).toBe(0);
  });
});
