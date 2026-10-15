import {
  localProjectDraftKey,
  localProjectDraftFingerprint,
  readLocalProjectDraft,
  writeLocalProjectDraft,
  type LocalProjectDraft,
} from '../modules/project-local-draft';

type RecoveryStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;

/** Server revisions remain authoritative. Each mounted writer owns one recovery
 * slot; the legacy key is only a compatibility mirror, never its durability proof. */
export class ElectronicsProjectRecovery<TDocument> {
  private readonly baseKey: string;
  private readonly prefix: string;
  private readonly ownKey: string;
  private readonly previous: string | null;
  private written = false;

  constructor(
    private readonly source: () => RecoveryStorage,
    private readonly session: Pick<Storage, 'getItem' | 'setItem'> | null,
    private readonly projectId: string,
    private readonly userId: string,
    private readonly identityKind: 'account' | 'seat',
    private readonly acknowledged: (
      source: LocalProjectDraft<TDocument>,
      confirmed: TDocument,
    ) => boolean = (source, confirmed) =>
      JSON.stringify(source.document) === JSON.stringify(confirmed),
  ) {
    this.baseKey = localProjectDraftKey(projectId, userId, identityKind);
    this.prefix = `${this.baseKey}:electronics-editor:`;
    // A new writer ID also isolates tabs created with a copied sessionStorage.
    const writerId =
      typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
            byte.toString(16).padStart(2, '0'),
          ).join('');
    this.ownKey = `${this.prefix}${writerId}`;
    try {
      this.previous = session?.getItem(this.prefix) ?? null;
    } catch {
      this.previous = null;
    }
  }

  private at(key: string, observe?: (raw: string | null) => void) {
    return {
      getItem: (requested: string) => {
        const raw = this.source().getItem(requested === `${this.baseKey}:ack` ? `${key}:ack` : key);
        if (requested === this.baseKey) observe?.(raw);
        return raw;
      },
      setItem: (_key: string, value: string) => this.source().setItem(key, value),
      removeItem: (requested: string) =>
        this.source().removeItem(requested === `${this.baseKey}:ack` ? `${key}:ack` : key),
    };
  }

  private readAt(key: string): LocalProjectDraft<TDocument> | null {
    return this.readEntryAt(key)?.draft ?? null;
  }

  private readEntryAt(key: string): { raw: string; draft: LocalProjectDraft<TDocument> } | null {
    let raw: string | null = null;
    const draft = readLocalProjectDraft<TDocument>(
      this.at(key, (value) => {
        raw = value;
      }),
      this.projectId,
      'electronics',
      this.userId,
      this.identityKind,
    );
    return draft && raw !== null ? { raw, draft } : null;
  }

  readOwned(): LocalProjectDraft<TDocument> | null {
    return this.readAt(this.ownKey);
  }

  read(): LocalProjectDraft<TDocument> | null {
    if (this.written) return this.readOwned();
    // Reload prefers this tab's previous branch, rather than another tab's latest edit.
    if (this.previous === 'saved') return null;
    if (this.previous?.startsWith(this.prefix)) {
      const previous = this.readEntryAt(this.previous);
      if (previous) return previous.draft;
    }
    try {
      const storage = this.source();
      const keys = [this.baseKey];
      for (let index = 0; index < storage.length; index++) {
        const key = storage.key(index);
        if (key?.startsWith(this.prefix) && !key.endsWith(':ack')) keys.push(key);
      }
      // A fresh tab can recover the newest pending copy. Other copies stay intact.
      const newest = keys
        .sort()
        .flatMap((key) => {
          const entry = this.readEntryAt(key);
          return entry ? [{ key, ...entry }] : [];
        })
        .sort((left, right) =>
          left.draft.updatedAt < right.draft.updatedAt
            ? 1
            : left.draft.updatedAt > right.draft.updatedAt
              ? -1
              : 0,
        )[0];
      return newest?.draft ?? null;
    } catch {
      return null;
    }
  }

  write(input: { baseRevision: number; baseDocument?: TDocument; document: TDocument }): boolean {
    const record = {
      ...input,
      projectId: this.projectId,
      userId: this.userId,
      identityKind: this.identityKind,
      moduleKey: 'electronics',
    };
    const stored = writeLocalProjectDraft(this.at(this.ownKey), record);
    if (!stored) return false;
    this.written = true;
    try {
      this.session?.setItem(this.prefix, this.ownKey);
    } catch {
      /* optional reload hint */
    }
    // Preserve existing project-list/legacy reader compatibility. Another tab may
    // replace/remove this mirror without touching our owned recovery slot.
    writeLocalProjectDraft(this.source, record);
    return true;
  }

  clear(confirmedDocument: TDocument): void {
    try {
      const storage = this.source();
      storage.removeItem(this.ownKey);
      storage.removeItem(`${this.ownKey}:ack`);
      // Never delete another writer's key: an acknowledgement is bound to exact
      // bytes and ignored after that writer makes any new edit, even during a race.
      const keys = [this.baseKey];
      for (let index = 0; index < storage.length; index++) {
        const key = storage.key(index);
        if (key?.startsWith(this.prefix) && !key.endsWith(':ack')) keys.push(key);
      }
      // Retire every acknowledged source in a reload chain, not just its last link.
      for (const key of keys) {
        const source = this.readEntryAt(key);
        if (source && this.acknowledged(source.draft, confirmedDocument))
          storage.setItem(`${key}:ack`, localProjectDraftFingerprint(source.raw));
      }
    } catch {
      /* A confirmed server save does not depend on recovery cleanup. */
    }
    try {
      this.session?.setItem(this.prefix, 'saved');
    } catch {
      /* optional reload hint */
    }
  }
}
