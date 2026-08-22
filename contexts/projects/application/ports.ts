import type { ModulePreviewDescriptor } from '@asa-lab/module-sdk';
import type {
  Project,
  ProjectDraft,
  ProjectPreview,
  ProjectScope,
  ProjectStatus,
  ProjectVersion,
} from '../domain/project.js';
import type { ProjectSnapshot, ProjectSnapshotBytes, SnapshotImage } from '../domain/snapshot.js';

export interface ProjectActor {
  readonly principalId: string;
  readonly userId: string | null;
}

export interface CreateProjectInput {
  readonly tenantId: string;
  readonly scope: ProjectScope;
  readonly classroomId: string | null;
  readonly actor: ProjectActor;
  readonly moduleKey: string;
  readonly title: string;
  /** Present only when the title must be allocated atomically at insertion. */
  readonly automaticTitlePrefix?: string;
  readonly idempotencyKey: string;
  readonly requestFingerprint: string;
  readonly initialDocument: unknown;
  readonly initialPreview: ProjectPreview | null;
}

export type CreateProjectResult =
  | { readonly kind: 'created'; readonly project: Project }
  | { readonly kind: 'existing'; readonly project: Project }
  | { readonly kind: 'conflict' }
  | { readonly kind: 'classroom_not_found' };

export interface ProjectListFilter {
  readonly scope?: ProjectScope;
  readonly classroomId?: string;
  readonly status?: ProjectStatus;
}

export interface SaveDraftInput {
  readonly tenantId: string;
  readonly projectId: string;
  readonly actor: ProjectActor;
  readonly document: unknown;
  readonly preview: ProjectPreview | null;
}

export interface SaveSnapshotInput {
  readonly tenantId: string;
  readonly projectId: string;
  readonly actor: ProjectActor;
  readonly image: SnapshotImage;
}

export type ProjectDocumentValidation =
  | { readonly ok: true; readonly document: unknown }
  | { readonly ok: false; readonly message: string };

/** Subject-neutral contract consumed by Project Core. */
export interface ProjectModule {
  readonly moduleKey: string;
  readonly defaultProjectTitlePrefix: string;
  validateDocument(value: unknown): ProjectDocumentValidation;
  /**
   * The card picture for an already-validated document. Null means the module
   * has nothing to draw yet, which is not an error — the card shows its title
   * and summary instead.
   */
  describePreview(document: unknown): ModulePreviewDescriptor | null;
}

export interface CreatableProjectModule extends ProjectModule {
  createEmptyProject(): unknown;
}

export interface ModuleCatalogPort {
  get(moduleKey: string): ProjectModule | null;
  getCreatable(moduleKey: string): CreatableProjectModule | null;
}

export interface ProjectRepositoryPort {
  createWithDraft(input: CreateProjectInput): Promise<CreateProjectResult>;
  /**
   * Returns the next per-owner sequence number for a module. Every historical
   * row counts, including archived and trashed projects, so deleting a card
   * never reuses its number. Null means the classroom is not accessible.
   */
  nextTitleSequence(input: {
    readonly tenantId: string;
    readonly scope: ProjectScope;
    readonly classroomId: string | null;
    readonly actor: ProjectActor;
    readonly moduleKey: string;
  }): Promise<number | null>;
  listForActor(
    tenantId: string,
    actor: ProjectActor,
    filter: ProjectListFilter,
  ): Promise<Project[]>;
  load(
    tenantId: string,
    projectId: string,
    actor: ProjectActor,
  ): Promise<{ project: Project; draft: ProjectDraft; versions: ProjectVersion[] } | null>;
  rename(
    tenantId: string,
    projectId: string,
    actor: ProjectActor,
    title: string,
  ): Promise<Project | null>;
  updateStatus(
    tenantId: string,
    projectId: string,
    actor: ProjectActor,
    status: ProjectStatus,
  ): Promise<Project | null>;
  saveDraft(input: SaveDraftInput): Promise<ProjectDraft | null>;
  createCheckpoint(
    tenantId: string,
    projectId: string,
    actor: ProjectActor,
    label: string | null,
  ): Promise<ProjectVersion | null>;
  /**
   * Puts the project back to how a saved version looked.
   *
   * The state being left behind is checkpointed first, so going back is itself
   * something you can come back from. A history where one wrong press loses an
   * afternoon's work is worse than no history at all.
   */
  restoreVersion(
    tenantId: string,
    projectId: string,
    actor: ProjectActor,
    versionId: string,
  ): Promise<{ draft: ProjectDraft; versions: readonly ProjectVersion[] } | null>;
  listVersions(
    tenantId: string,
    projectId: string,
    actor: ProjectActor,
  ): Promise<readonly ProjectVersion[] | null>;
  /**
   * Stores the picture against the draft revision the server currently holds.
   * The revision is never taken from the caller: it is what decides whether a
   * cached card is still valid, so a client must not be able to name it.
   */
  saveSnapshot(input: SaveSnapshotInput): Promise<ProjectSnapshot | null>;
  loadSnapshot(
    tenantId: string,
    projectId: string,
    actor: ProjectActor,
  ): Promise<ProjectSnapshotBytes | null>;
}
