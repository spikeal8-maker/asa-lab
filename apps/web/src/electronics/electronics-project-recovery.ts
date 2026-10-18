import {
  localProjectDraftKey,
  localProjectDraftFingerprint,
  readLocalProjectDraftEntry,
  writeLocalProjectDraft,
  type LocalProjectDraft,
} from '../modules/project-local-draft';

type RecoveryStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;

/** Each writer owns one recovery slot; the legacy key is only a mirror.
 * Closure state avoids repeated class property names in the editor bundle. */
export function createElectronicsProjectRecovery<TDocument>(
  source: () => RecoveryStorage,
  session: Pick<Storage, 'getItem' | 'setItem'> | null,
  projectId: string,
  userId: string,
  identityKind: 'account' | 'seat',
  acknowledged: (
    draft: LocalProjectDraft<TDocument>,
    confirmed: TDocument,
    preserveOriginal: () => boolean,
  ) => boolean = (draft, confirmed) => JSON.stringify(draft.document) === JSON.stringify(confirmed),
) {
  const baseKey = localProjectDraftKey(projectId, userId, identityKind);
  const prefix = baseKey + ':electronics-editor:';
  const originalPrefix = baseKey + ':electronics-identifier-original:';
  // New writer IDs also isolate tabs with copied sessionStorage hints.
  // Opaque 128-bit ID; getRandomValues also works without a secure context.
  const writerId = crypto.getRandomValues(new Uint32Array(4)).join('-');
  const ownKey = prefix + writerId;
  let previous: string | null;
  let written = false;
  try {
    previous = session?.getItem(prefix) ?? null;
  } catch {
    previous = null;
  }

  function readEntryAt(key: string): { raw: string; draft: LocalProjectDraft<TDocument> } | null {
    return readLocalProjectDraftEntry<TDocument>(
      source,
      projectId,
      'electronics',
      userId,
      identityKind,
      key,
    );
  }

  function readOwned(): LocalProjectDraft<TDocument> | null {
    return readEntryAt(ownKey)?.draft ?? null;
  }

  function preserveRaw(raw: string): boolean {
    try {
      const storage = source();
      const key = originalPrefix + localProjectDraftFingerprint(raw);
      const existing = storage.getItem(key);
      if (existing === null) storage.setItem(key, raw);
      return storage.getItem(key) === raw;
    } catch {
      return false;
    }
  }

  function preserveOriginal(draft: LocalProjectDraft<TDocument>): boolean {
    if (
      draft.schemaVersion !== 3 ||
      draft.projectId !== projectId ||
      draft.userId !== userId ||
      draft.identityKind !== identityKind ||
      draft.moduleKey !== 'electronics'
    )
      return false;
    try {
      const raw = JSON.stringify(draft);
      // Preserve the exact stored bytes (including formatting), when available.
      for (const key of keys(source())) {
        const entry = readEntryAt(key);
        if (entry && JSON.stringify(entry.draft) === raw) return preserveRaw(entry.raw);
      }
      return preserveRaw(raw);
    } catch {
      return false;
    }
  }

  function keys(storage: RecoveryStorage): string[] {
    const result = [baseKey];
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index);
      if (key?.startsWith(prefix) && !key.endsWith(':ack')) result.push(key);
    }
    return result;
  }

  function read(): LocalProjectDraft<TDocument> | null {
    if (written) return readOwned();
    // Reload prefers its branch; a fresh tab offers the newest pending copy.
    if (previous === 'saved') return null;
    if (previous?.startsWith(prefix)) {
      const entry = readEntryAt(previous);
      if (entry) return entry.draft;
    }
    try {
      return keys(source())
        .sort()
        .reduce<LocalProjectDraft<TDocument> | null>((newest, key) => {
          const draft = readEntryAt(key)?.draft;
          return draft && (!newest || draft.updatedAt > newest.updatedAt) ? draft : newest;
        }, null);
    } catch {
      return null;
    }
  }

  function write(input: {
    baseRevision: number;
    baseDocument?: TDocument;
    document: TDocument;
  }): boolean {
    const record = { ...input, projectId, userId, identityKind, moduleKey: 'electronics' };
    if (!writeLocalProjectDraft(source, record, ownKey)) return false;
    written = true;
    try {
      session?.setItem(prefix, ownKey);
    } catch {
      /* optional reload hint */
    }
    // The compatibility mirror is never the proof of this writer's durability.
    writeLocalProjectDraft(source, record);
    return true;
  }

  function clear(confirmedDocument: TDocument): void {
    try {
      const storage = source();
      storage.removeItem(ownKey);
      storage.removeItem(ownKey + ':ack');
      // Acknowledge exact bytes, never delete another writer's key.
      for (const key of keys(storage)) {
        const entry = readEntryAt(key);
        if (entry && acknowledged(entry.draft, confirmedDocument, () => preserveRaw(entry.raw)))
          storage.setItem(key + ':ack', localProjectDraftFingerprint(entry.raw));
      }
    } catch {
      /* Confirmed server saves do not depend on recovery cleanup. */
    }
    try {
      session?.setItem(prefix, 'saved');
    } catch {
      /* optional reload hint */
    }
  }

  return { read, readOwned, write, clear, preserveOriginal };
}
