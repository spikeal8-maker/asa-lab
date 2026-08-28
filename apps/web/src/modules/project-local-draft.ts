const LOCAL_PROJECT_DRAFT_SCHEMA = 2;
const SUPPORTED_LOCAL_PROJECT_DRAFT_SCHEMAS = new Set([1, LOCAL_PROJECT_DRAFT_SCHEMA]);
const LOCAL_PROJECT_DRAFT_PREFIX = 'asa-project-local-draft:';

type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface LocalProjectDraft<TDocument = unknown> {
  readonly schemaVersion: 1 | typeof LOCAL_PROJECT_DRAFT_SCHEMA;
  readonly projectId: string;
  readonly moduleKey: string;
  readonly baseRevision: number;
  /** Server document at baseRevision, required for a safe three-way merge. */
  readonly baseDocument?: TDocument;
  readonly document: TDocument;
  readonly updatedAt: string;
}

function draftKey(projectId: string): string {
  return `${LOCAL_PROJECT_DRAFT_PREFIX}${projectId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function readLocalProjectDraft<TDocument = unknown>(
  storage: DraftStorage,
  projectId: string,
  moduleKey: string,
): LocalProjectDraft<TDocument> | null {
  try {
    const raw = storage.getItem(draftKey(projectId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      !isRecord(parsed) ||
      !SUPPORTED_LOCAL_PROJECT_DRAFT_SCHEMAS.has(Number(parsed['schemaVersion'])) ||
      parsed['projectId'] !== projectId ||
      parsed['moduleKey'] !== moduleKey ||
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
  storage: DraftStorage,
  input: {
    readonly projectId: string;
    readonly moduleKey: string;
    readonly baseRevision: number;
    readonly baseDocument?: TDocument;
    readonly document: TDocument;
  },
): void {
  try {
    const record: LocalProjectDraft<TDocument> = {
      schemaVersion: LOCAL_PROJECT_DRAFT_SCHEMA,
      ...input,
      updatedAt: new Date().toISOString(),
    };
    storage.setItem(draftKey(input.projectId), JSON.stringify(record));
  } catch {
    // Privacy mode or a full quota must not make the editor itself unusable.
  }
}

export function clearLocalProjectDraft(storage: DraftStorage, projectId: string): void {
  try {
    storage.removeItem(draftKey(projectId));
  } catch {
    // The server save already succeeded; cleanup is best-effort.
  }
}
