import type { ModulePreviewDescriptor } from '@asa-lab/module-sdk';
import type {
  Project,
  ProjectDraft,
  ProjectPreview,
  ProjectScope,
  ProjectStatus,
  ProjectVersion,
} from '../domain/project.js';

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

export type ProjectDocumentValidation =
  | { readonly ok: true; readonly document: unknown }
  | { readonly ok: false; readonly message: string };

/** Subject-neutral contract consumed by Project Core. */
export interface ProjectModule {
  readonly moduleKey: string;
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
}
