import type { Project, ProjectDraft, ProjectVersion } from '../domain/project.js';

export interface CreateProjectInput {
  readonly tenantId: string;
  readonly classroomId: string;
  readonly teacherId: string;
  readonly moduleKey: string;
  readonly title: string;
  readonly idempotencyKey: string;
  readonly requestFingerprint: string;
  /** Initial subject document stored in the draft. */
  readonly initialDocument: unknown;
}

export type CreateProjectResult =
  | { readonly kind: 'created'; readonly project: Project }
  | { readonly kind: 'existing'; readonly project: Project }
  | { readonly kind: 'conflict' }
  | { readonly kind: 'classroom_not_found' };

export interface SaveDraftInput {
  readonly tenantId: string;
  readonly projectId: string;
  readonly teacherId: string;
  readonly document: unknown;
}

export interface ProjectRepositoryPort {
  createWithDraft(input: CreateProjectInput): Promise<CreateProjectResult>;
  listForClassroom(tenantId: string, classroomId: string, teacherId: string): Promise<Project[]>;
  load(
    tenantId: string,
    projectId: string,
    teacherId: string,
  ): Promise<{ project: Project; draft: ProjectDraft; versions: ProjectVersion[] } | null>;
  saveDraft(input: SaveDraftInput): Promise<ProjectDraft | null>;
  createCheckpoint(
    tenantId: string,
    projectId: string,
    teacherId: string,
    label: string | null,
  ): Promise<ProjectVersion | null>;
}
