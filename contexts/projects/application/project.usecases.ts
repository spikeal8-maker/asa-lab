import { createHash } from 'node:crypto';
import {
  isProjectScope,
  isProjectStatus,
  isValidCheckpointLabel,
  isValidProjectTitle,
  type Project,
  type ProjectDraft,
  type ProjectScope,
  type ProjectStatus,
  type ProjectVersion,
} from '../domain/project.js';
import type {
  ModuleCatalogPort,
  ProjectActor,
  ProjectListFilter,
  ProjectRepositoryPort,
} from './ports.js';

export type ProjectErrorCode =
  'validation_error' | 'idempotency_conflict' | 'classroom_not_found' | 'project_not_found';

export type UseCaseResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: ProjectErrorCode; readonly message: string };

function fail<T>(code: ProjectErrorCode, message: string): UseCaseResult<T> {
  return { ok: false, code, message };
}

export function projectRequestFingerprint(input: {
  scope: ProjectScope;
  classroomId: string | null;
  moduleKey: string;
  title: string;
}): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

export class CreateProjectUseCase {
  constructor(
    private readonly repository: ProjectRepositoryPort,
    private readonly modules: ModuleCatalogPort,
  ) {}

  async execute(input: {
    tenantId: string;
    scope: unknown;
    classroomId: unknown;
    actor: ProjectActor;
    moduleKey: unknown;
    title: unknown;
    idempotencyKey: string;
  }): Promise<UseCaseResult<{ project: Project; created: boolean }>> {
    if (!isProjectScope(input.scope)) {
      return fail('validation_error', 'scope must be personal or classroom');
    }

    let classroomId: string | null = null;
    if (input.scope === 'classroom') {
      if (typeof input.classroomId !== 'string' || input.classroomId.length === 0) {
        return fail('validation_error', 'classroomId is required for a classroom project');
      }
      classroomId = input.classroomId;
    } else if (input.classroomId !== null && input.classroomId !== undefined) {
      return fail('validation_error', 'personal projects must not contain classroomId');
    }

    if (typeof input.moduleKey !== 'string' || input.moduleKey.length === 0) {
      return fail('validation_error', 'module is required');
    }
    const module = this.modules.getCreatable(input.moduleKey);
    if (!module) {
      return fail('validation_error', `module "${input.moduleKey}" is not available for creation`);
    }
    if (!isValidProjectTitle(input.title)) {
      return fail('validation_error', 'title must be 1..255 characters');
    }

    const title = input.title.trim();
    const result = await this.repository.createWithDraft({
      tenantId: input.tenantId,
      scope: input.scope,
      classroomId,
      actor: input.actor,
      moduleKey: module.moduleKey,
      title,
      idempotencyKey: input.idempotencyKey,
      requestFingerprint: projectRequestFingerprint({
        scope: input.scope,
        classroomId,
        moduleKey: module.moduleKey,
        title,
      }),
      initialDocument: module.createEmptyProject(),
    });

    if (result.kind === 'conflict') {
      return fail(
        'idempotency_conflict',
        'the same Idempotency-Key was already used with a different payload',
      );
    }
    if (result.kind === 'classroom_not_found') {
      return fail('classroom_not_found', 'classroom does not exist in this tenant');
    }
    return { ok: true, value: { project: result.project, created: result.kind === 'created' } };
  }
}

export class ListProjectsUseCase {
  constructor(private readonly repository: ProjectRepositoryPort) {}

  async execute(
    tenantId: string,
    actor: ProjectActor,
    rawFilter: { scope?: unknown; classroomId?: unknown; status?: unknown },
  ): Promise<UseCaseResult<Project[]>> {
    let scope: ProjectScope | undefined;
    let classroomId: string | undefined;
    let status: ProjectStatus | undefined;
    if (rawFilter.scope !== undefined) {
      if (!isProjectScope(rawFilter.scope)) {
        return fail('validation_error', 'scope must be personal or classroom');
      }
      scope = rawFilter.scope;
    }
    if (rawFilter.classroomId !== undefined) {
      if (typeof rawFilter.classroomId !== 'string' || rawFilter.classroomId.length === 0) {
        return fail('validation_error', 'classroomId must be a non-empty string');
      }
      classroomId = rawFilter.classroomId;
    }
    if ('status' in rawFilter && rawFilter.status !== undefined) {
      if (!isProjectStatus(rawFilter.status)) {
        return fail('validation_error', 'status must be active, archived or trashed');
      }
      status = rawFilter.status;
    }
    const filter: ProjectListFilter = {
      ...(scope === undefined ? {} : { scope }),
      ...(classroomId === undefined ? {} : { classroomId }),
      ...(status === undefined ? {} : { status }),
    };
    if (filter.scope === 'personal' && filter.classroomId) {
      return fail('validation_error', 'personal project list must not contain classroomId');
    }
    if (filter.scope === 'classroom' && !filter.classroomId) {
      return fail('validation_error', 'classroomId is required for classroom projects');
    }
    return { ok: true, value: await this.repository.listForActor(tenantId, actor, filter) };
  }
}

export class ChangeProjectStatusUseCase {
  constructor(private readonly repository: ProjectRepositoryPort) {}

  async execute(input: {
    tenantId: string;
    projectId: string;
    actor: ProjectActor;
    status: unknown;
  }): Promise<UseCaseResult<Project>> {
    if (!isProjectStatus(input.status)) {
      return fail('validation_error', 'status must be active, archived or trashed');
    }
    const current = await this.repository.load(input.tenantId, input.projectId, input.actor);
    if (!current) return fail('project_not_found', 'project not found');
    const transitions: Record<ProjectStatus, readonly ProjectStatus[]> = {
      active: ['archived', 'trashed'],
      archived: ['active', 'trashed'],
      trashed: ['active'],
    };
    if (!transitions[current.project.status].includes(input.status)) {
      return fail(
        'validation_error',
        `project cannot change from ${current.project.status} to ${input.status}`,
      );
    }
    const project = await this.repository.updateStatus(
      input.tenantId,
      input.projectId,
      input.actor,
      input.status,
    );
    return project === null
      ? fail('project_not_found', 'project not found')
      : { ok: true, value: project };
  }
}

export class DuplicateProjectUseCase {
  constructor(private readonly repository: ProjectRepositoryPort) {}

  async execute(input: {
    tenantId: string;
    projectId: string;
    actor: ProjectActor;
    title: unknown;
    idempotencyKey: string;
  }): Promise<UseCaseResult<{ project: Project; created: boolean }>> {
    if (!isValidProjectTitle(input.title)) {
      return fail('validation_error', 'title must be 1..255 characters');
    }
    const source = await this.repository.load(input.tenantId, input.projectId, input.actor);
    if (!source || source.project.status === 'trashed') {
      return fail('project_not_found', 'project not found');
    }
    const title = input.title.trim();
    const requestFingerprint = createHash('sha256')
      .update(JSON.stringify({ sourceProjectId: input.projectId, title }))
      .digest('hex');
    const result = await this.repository.createWithDraft({
      tenantId: input.tenantId,
      scope: source.project.scope,
      classroomId: source.project.classroomId,
      actor: input.actor,
      moduleKey: source.project.moduleKey,
      title,
      idempotencyKey: input.idempotencyKey,
      requestFingerprint,
      initialDocument: source.draft.document,
    });
    if (result.kind === 'conflict') {
      return fail(
        'idempotency_conflict',
        'the same Idempotency-Key was already used with a different payload',
      );
    }
    if (result.kind === 'classroom_not_found') {
      return fail('classroom_not_found', 'classroom does not exist in this tenant');
    }
    return { ok: true, value: { project: result.project, created: result.kind === 'created' } };
  }
}

export class OpenProjectUseCase {
  constructor(private readonly repository: ProjectRepositoryPort) {}

  async execute(
    tenantId: string,
    projectId: string,
    actor: ProjectActor,
  ): Promise<UseCaseResult<{ project: Project; draft: ProjectDraft; versions: ProjectVersion[] }>> {
    const loaded = await this.repository.load(tenantId, projectId, actor);
    return loaded === null
      ? fail('project_not_found', 'project not found')
      : { ok: true, value: loaded };
  }
}

export class RenameProjectUseCase {
  constructor(private readonly repository: ProjectRepositoryPort) {}

  async execute(input: {
    tenantId: string;
    projectId: string;
    actor: ProjectActor;
    title: unknown;
  }): Promise<UseCaseResult<Project>> {
    if (!isValidProjectTitle(input.title)) {
      return fail('validation_error', 'title must be 1..255 characters');
    }
    const project = await this.repository.rename(
      input.tenantId,
      input.projectId,
      input.actor,
      input.title.trim(),
    );
    return project === null
      ? fail('project_not_found', 'project not found')
      : { ok: true, value: project };
  }
}

export class SaveDraftUseCase {
  constructor(
    private readonly repository: ProjectRepositoryPort,
    private readonly modules: ModuleCatalogPort,
  ) {}

  async execute(input: {
    tenantId: string;
    projectId: string;
    actor: ProjectActor;
    document: unknown;
  }): Promise<UseCaseResult<ProjectDraft>> {
    const loaded = await this.repository.load(input.tenantId, input.projectId, input.actor);
    if (!loaded) {
      return fail('project_not_found', 'project not found');
    }
    const module = this.modules.get(loaded.project.moduleKey);
    if (!module) {
      return fail('validation_error', `module "${loaded.project.moduleKey}" is not registered`);
    }
    const parsed = module.validateDocument(input.document);
    if (!parsed.ok) {
      return fail('validation_error', parsed.message);
    }
    const draft = await this.repository.saveDraft({
      tenantId: input.tenantId,
      projectId: input.projectId,
      actor: input.actor,
      document: parsed.document,
    });
    return draft === null
      ? fail('project_not_found', 'project not found')
      : { ok: true, value: draft };
  }
}

export class CreateCheckpointUseCase {
  constructor(private readonly repository: ProjectRepositoryPort) {}

  async execute(input: {
    tenantId: string;
    projectId: string;
    actor: ProjectActor;
    label: unknown;
  }): Promise<UseCaseResult<ProjectVersion>> {
    if (!isValidCheckpointLabel(input.label)) {
      return fail('validation_error', 'label must be at most 255 characters');
    }
    const label =
      typeof input.label === 'string' && input.label.trim().length > 0 ? input.label.trim() : null;
    const version = await this.repository.createCheckpoint(
      input.tenantId,
      input.projectId,
      input.actor,
      label,
    );
    return version === null
      ? fail('project_not_found', 'project not found')
      : { ok: true, value: version };
  }
}
