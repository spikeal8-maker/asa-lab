import {
  localProjectDraftKey,
  localProjectDraftFingerprint,
  readLocalProjectDraftEntry,
  writeLocalProjectDraft,
  type LocalProjectDraft,
} from '../modules/project-local-draft';

type RecoveryStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;
type IdentifierSource = { readonly key: string; readonly fingerprint: string };

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
  let selected: { key: string; raw: string; draft: LocalProjectDraft<TDocument> } | null = null;
  let identifierSources: IdentifierSource[] = [];
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

  function preserveOriginal(draft: LocalProjectDraft<TDocument>, required = true): boolean {
    if (
      draft.schemaVersion !== 3 ||
      draft.projectId !== projectId ||
      draft.userId !== userId ||
      draft.identityKind !== identityKind ||
      draft.moduleKey !== 'electronics'
    )
      return false;
    try {
      if (selected?.draft === draft) {
        const inherited: unknown = (
          draft as LocalProjectDraft<TDocument> & {
            electronicsIdentifierSources?: unknown;
          }
        ).electronicsIdentifierSources;
        if (!required && inherited === undefined) return true;
        const receipts: IdentifierSource[] = [];
        if (inherited !== undefined) {
          if (!Array.isArray(inherited) || inherited.length > 256) return false;
          for (const item of inherited) {
            if (
              !item ||
              typeof item !== 'object' ||
              typeof item.key !== 'string' ||
              !(
                item.key === baseKey ||
                (item.key.startsWith(prefix) && !item.key.endsWith(':ack'))
              ) ||
              typeof item.fingerprint !== 'string' ||
              !/^[a-f0-9]{64}$/.test(item.fingerprint)
            )
              return false;
            const backup = readEntryAt(originalPrefix + item.fingerprint);
            if (!backup || localProjectDraftFingerprint(backup.raw) !== item.fingerprint)
              return false;
            receipts.push({ key: item.key, fingerprint: item.fingerprint });
          }
        }
        const signature = (value: LocalProjectDraft<TDocument>) =>
          JSON.stringify({ ...value, updatedAt: undefined });
        const originals = [selected];
        // Writer slots and the compatibility mirror may differ only in timestamp.
        // Carry exact receipts for every identical snapshot, never for distinct work.
        for (const key of keys(source())) {
          if (key === selected.key) continue;
          const entry = readEntryAt(key);
          if (entry && signature(entry.draft) === signature(draft))
            originals.push({ ...entry, key });
        }
        for (const entry of originals) {
          if (!preserveRaw(entry.raw)) return false;
          const fingerprint = localProjectDraftFingerprint(entry.raw);
          if (!receipts.some((item) => item.key === entry.key && item.fingerprint === fingerprint))
            receipts.push({ key: entry.key, fingerprint });
        }
        if (receipts.length > 256) return false;
        identifierSources = receipts;
        return true;
      }
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
      if (entry) {
        selected = { ...entry, key: previous };
        return entry.draft;
      }
    }
    try {
      selected = keys(source())
        .sort()
        .reduce<typeof selected>((newest, key) => {
          const entry = readEntryAt(key);
          return entry && (!newest || entry.draft.updatedAt > newest.draft.updatedAt)
            ? { ...entry, key }
            : newest;
        }, null);
      return selected?.draft ?? null;
    } catch {
      return null;
    }
  }

  function write(input: {
    baseRevision: number;
    baseDocument?: TDocument;
    document: TDocument;
  }): boolean {
    const record = {
      ...input,
      projectId,
      userId,
      identityKind,
      moduleKey: 'electronics',
      ...(identifierSources.length ? { electronicsIdentifierSources: identifierSources } : {}),
    };
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
      // A confirmed descendant may have edited or deleted every recovered object.
      // Retire only the exact consumed bytes; a concurrent replacement stays pending.
      for (const receipt of identifierSources) {
        const current = storage.getItem(receipt.key);
        if (current !== null && localProjectDraftFingerprint(current) === receipt.fingerprint) {
          storage.setItem(receipt.key + ':ack', receipt.fingerprint);
          if (storage.getItem(receipt.key + ':ack') !== receipt.fingerprint) return;
        }
      }
      identifierSources = [];
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
