import type { Project, ProjectDraft, ProjectScope, ProjectVersion } from '../domain/project.js';

export interface CreateProjectInput {
  readonly tenantId: string;
  readonly scope: ProjectScope;
  readonly classroomId: string | null;
  readonly teacherId: string;
  readonly moduleKey: string;
  readonly title: string;
  readonly idempotencyKey: string;
  readonly requestFingerprint: string;
  readonly initialDocument: unknown;
}

export type CreateProjectResult =
  | { readonly kind: 'created'; readonly project: Project }
  | { readonly kind: 'existing'; readonly project: Project }
  | { readonly kind: 'conflict' }
  | { readonly kind: 'classroom_not_found' };

export interface ProjectListFilter {
  readonly scope?: ProjectScope;
  readonly classroomId?: string;
}

export interface SaveDraftInput {
  readonly tenantId: string;
  readonly projectId: string;
  readonly teacherId: string;
  readonly document: unknown;
}

/** Minimal module contract consumed by Project Core during project creation.
 * Subject payload details remain outside the projects context. */
export interface CreatableProjectModule {
  readonly moduleKey: string;
  createEmptyProject(): unknown;
}

export interface ModuleCatalogPort {
  getCreatable(moduleKey: string): CreatableProjectModule | null;
}

export interface ProjectRepositoryPort {
  createWithDraft(input: CreateProjectInput): Promise<CreateProjectResult>;
  listForTeacher(tenantId: string, teacherId: string, filter: ProjectListFilter): Promise<Project[]>;
  load(
    tenantId: string,
    projectId: string,
    teacherId: string,
  ): Promise<{ project: Project; draft: ProjectDraft; versions: ProjectVersion[] } | null>;
  rename(
    tenantId: string,
    projectId: string,
    teacherId: string,
    title: string,
  ): Promise<Project | null>;
  saveDraft(input: SaveDraftInput): Promise<ProjectDraft | null>;
  createCheckpoint(
    tenantId: string,
    projectId: string,
    teacherId: string,
    label: string | null,
  ): Promise<ProjectVersion | null>;
}
