import { sha256Bytes } from '../components/sha256';

const LOCAL_PROJECT_DRAFT_SCHEMA = 2;
const SUPPORTED_LOCAL_PROJECT_DRAFT_SCHEMAS = new Set([1, LOCAL_PROJECT_DRAFT_SCHEMA, 3]);
const LOCAL_PROJECT_DRAFT_PREFIX = 'asa-project-local-draft:';

type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
type DraftStorageSource = DraftStorage | (() => DraftStorage);

/** Binds a local acknowledgement to exact recovery bytes, not a mutable key. */
export function localProjectDraftFingerprint(raw: string): string {
  return Array.from(sha256Bytes(new TextEncoder().encode(raw)), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

export interface LocalProjectDraft<TDocument = unknown> {
  readonly schemaVersion: 1 | typeof LOCAL_PROJECT_DRAFT_SCHEMA | 3;
  readonly userId?: string;
  readonly identityKind?: 'account' | 'seat';
  readonly projectId: string;
  readonly moduleKey: string;
  readonly baseRevision: number;
  /** Server document at baseRevision, required for a safe three-way merge. */
  readonly baseDocument?: TDocument;
  readonly document: TDocument;
  readonly updatedAt: string;
}

export function localProjectDraftKey(
  projectId: string,
  userId?: string,
  identityKind?: 'account' | 'seat',
): string {
  if (userId !== undefined)
    return `${LOCAL_PROJECT_DRAFT_PREFIX}user:${identityKind ?? 'account'}:${encodeURIComponent(userId)}:${encodeURIComponent(projectId)}`;
  return `${LOCAL_PROJECT_DRAFT_PREFIX}${projectId}`;
}

function resolveStorage(source: DraftStorageSource): DraftStorage {
  return typeof source === 'function' ? source() : source;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function readLocalProjectDraft<TDocument = unknown>(
  source: DraftStorageSource,
  projectId: string,
  moduleKey: string,
  userId?: string,
  identityKind?: 'account' | 'seat',
): LocalProjectDraft<TDocument> | null {
  try {
    const storage = resolveStorage(source);
    const key = localProjectDraftKey(projectId, userId, identityKind);
    const raw = storage.getItem(key);
    if (!raw) return null;
    const acknowledged = moduleKey === 'electronics' ? storage.getItem(`${key}:ack`) : null;
    if (acknowledged !== null && acknowledged === localProjectDraftFingerprint(raw)) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      !isRecord(parsed) ||
      !SUPPORTED_LOCAL_PROJECT_DRAFT_SCHEMAS.has(Number(parsed['schemaVersion'])) ||
      parsed['projectId'] !== projectId ||
      parsed['moduleKey'] !== moduleKey ||
      (userId !== undefined
        ? parsed['schemaVersion'] !== 3 ||
          parsed['userId'] !== userId ||
          parsed['identityKind'] !== (identityKind ?? 'account')
        : Number(parsed['schemaVersion']) === 3) ||
      !Number.isSafeInteger(parsed['baseRevision']) ||
      typeof parsed['updatedAt'] !== 'string' ||
      !isRecord(parsed['document']) ||
      (parsed['baseDocument'] !== undefined && !isRecord(parsed['baseDocument']))
    ) {
      return null;
    }
    return parsed as unknown as LocalProjectDraft<TDocument>;
  } catch {
    return null;
  }
}

export function writeLocalProjectDraft<TDocument>(
  source: DraftStorageSource,
  input: {
    readonly projectId: string;
    readonly userId?: string;
    readonly identityKind?: 'account' | 'seat';
    readonly moduleKey: string;
    readonly baseRevision: number;
    readonly baseDocument?: TDocument;
    readonly document: TDocument;
  },
): boolean {
  try {
    const record: LocalProjectDraft<TDocument> = {
      schemaVersion: input.userId === undefined ? LOCAL_PROJECT_DRAFT_SCHEMA : 3,
      ...input,
      ...(input.userId !== undefined ? { identityKind: input.identityKind ?? 'account' } : {}),
      updatedAt: new Date().toISOString(),
    };
    const storage = resolveStorage(source);
    const key = localProjectDraftKey(input.projectId, input.userId, input.identityKind);
    const serialized = JSON.stringify(record);
    storage.setItem(key, serialized);
    // A new local write is pending even if an older copy here was acknowledged.
    if (input.moduleKey === 'electronics' && storage.getItem(`${key}:ack`) !== null)
      storage.removeItem(`${key}:ack`);
    // A write that silently did nothing is not evidence of durability either.
    return storage.getItem(key) === serialized;
  } catch {
    // Privacy mode or a full quota must not make the editor itself unusable.
    return false;
  }
}

export function clearLocalProjectDraft(
  source: DraftStorageSource,
  projectId: string,
  userId?: string,
  identityKind?: 'account' | 'seat',
): void {
  try {
    resolveStorage(source).removeItem(localProjectDraftKey(projectId, userId, identityKind));
  } catch {
    // The server save already succeeded; cleanup is best-effort.
  }
}
