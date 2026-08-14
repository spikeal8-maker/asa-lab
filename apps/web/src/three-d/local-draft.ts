import type { ThreeDDocument } from '@asa-lab/three-d';

const LOCAL_DRAFT_SCHEMA_VERSION = 1;
const LOCAL_DRAFT_PREFIX = 'asa3d-local-draft:';

interface LocalDraftRecord {
  readonly schemaVersion: typeof LOCAL_DRAFT_SCHEMA_VERSION;
  readonly serverSignature: string;
  readonly document: ThreeDDocument;
  readonly updatedAt: string;
}

type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function draftKey(projectId: string): string {
  return `${LOCAL_DRAFT_PREFIX}${projectId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The server remains the source of truth. This cache only protects edits made
 * after that exact server revision, so an expired session or a reload cannot
 * silently discard the creator's work.
 */
export function readLocalThreeDDraft(
  storage: DraftStorage,
  projectId: string,
): LocalDraftRecord | null {
  try {
    const raw = storage.getItem(draftKey(projectId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      !isRecord(parsed) ||
      parsed['schemaVersion'] !== LOCAL_DRAFT_SCHEMA_VERSION ||
      typeof parsed['serverSignature'] !== 'string' ||
      typeof parsed['updatedAt'] !== 'string' ||
      !isRecord(parsed['document'])
    ) {
      return null;
    }
    return parsed as unknown as LocalDraftRecord;
  } catch {
    return null;
  }
}

export function writeLocalThreeDDraft(
  storage: DraftStorage,
  projectId: string,
  document: ThreeDDocument,
  serverSignature: string,
): void {
  try {
    const record: LocalDraftRecord = {
      schemaVersion: LOCAL_DRAFT_SCHEMA_VERSION,
      serverSignature,
      document,
      updatedAt: new Date().toISOString(),
    };
    storage.setItem(draftKey(projectId), JSON.stringify(record));
  } catch {
    // Autosave still reports its real server state. Storage quota or privacy
    // settings must never make modelling itself fail.
  }
}

export function clearLocalThreeDDraft(storage: DraftStorage, projectId: string): void {
  try {
    storage.removeItem(draftKey(projectId));
  } catch {
    // The server save has already succeeded, so cache cleanup is best-effort.
  }
}
