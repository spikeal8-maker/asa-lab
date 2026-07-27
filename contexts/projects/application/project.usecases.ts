import { createHash } from 'node:crypto';
import {
  isSupportedModuleKey,
  isValidCheckpointLabel,
  isValidProjectTitle,
  type Project,
  type ProjectDraft,
  type ProjectVersion,
} from '../domain/project.js';
import type { ProjectRepositoryPort } from './ports.js';

export type ProjectErrorCode =
  'validation_error' | 'idempotency_conflict' | 'classroom_not_found' | 'project_not_found';

export type UseCaseResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: ProjectErrorCode; readonly message: string };

function fail<T>(code: ProjectErrorCode, message: string): UseCaseResult<T> {
  return { ok: false, code, message };
}

export function projectRequestFingerprint(moduleKey: string, title: string): string {
  return createHash('sha256').update(JSON.stringify({ moduleKey, title })).digest('hex');
}

/** Validates the subject document before it reaches storage. */
export type DocumentValidator = (
  value: unknown,
) =>
  | { readonly ok: true; readonly document: unknown }
  | { readonly ok: false; readonly message: string };

export class CreateProjectUseCase {
  constructor(
    private readonly repository: ProjectRepositoryPort,
    private readonly emptyDocument: unknown,
  ) {}

  async execute(input: {
    tenantId: string;
    classroomId: unknown;
    teacherId: string;
    moduleKey: unknown;
    title: unknown;
    idempotencyKey: string;
  }): Promise<UseCaseResult<{ project: Project; created: boolean }>> {
    if (typeof input.classroomId !== 'string' || input.classroomId.length === 0) {
      return fail('validation_error', 'classroomId is required');
    }
    if (!isSupportedModuleKey(input.moduleKey)) {
      return fail('validation_error', 'module must be "electronics"');
    }
    if (!isValidProjectTitle(input.title)) {
      return fail('validation_error', 'title must be 1..255 characters');
    }
    const title = input.title.trim();
    const result = await this.repository.createWithDraft({
      tenantId: input.tenantId,
      classroomId: input.classroomId,
      teacherId: input.teacherId,
      moduleKey: input.moduleKey,
      title,
      idempotencyKey: input.idempotencyKey,
      requestFingerprint: projectRequestFingerprint(input.moduleKey, title),
      initialDocument: this.emptyDocument,
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
    classroomId: unknown,
    teacherId: string,
  ): Promise<UseCaseResult<Project[]>> {
    if (typeof classroomId !== 'string' || classroomId.length === 0) {
      return fail('validation_error', 'classroomId is required');
    }
    return {
      ok: true,
      value: await this.repository.listForClassroom(tenantId, classroomId, teacherId),
    };
  }
}

export class OpenProjectUseCase {
  constructor(private readonly repository: ProjectRepositoryPort) {}

  async execute(
    tenantId: string,
    projectId: string,
    teacherId: string,
  ): Promise<UseCaseResult<{ project: Project; draft: ProjectDraft; versions: ProjectVersion[] }>> {
    const loaded = await this.repository.load(tenantId, projectId, teacherId);
    if (loaded === null) {
      return fail('project_not_found', 'project not found');
    }
    return { ok: true, value: loaded };
  }
}

export class SaveDraftUseCase {
  constructor(
    private readonly repository: ProjectRepositoryPort,
    private readonly validateDocument: DocumentValidator,
  ) {}

  async execute(input: {
    tenantId: string;
    projectId: string;
    teacherId: string;
    document: unknown;
  }): Promise<UseCaseResult<ProjectDraft>> {
    const parsed = this.validateDocument(input.document);
    if (!parsed.ok) {
      return fail('validation_error', parsed.message);
    }
    const draft = await this.repository.saveDraft({
      tenantId: input.tenantId,
      projectId: input.projectId,
      teacherId: input.teacherId,
      document: parsed.document,
    });
    if (draft === null) {
      return fail('project_not_found', 'project not found');
    }
    return { ok: true, value: draft };
  }
}

export class CreateCheckpointUseCase {
  constructor(private readonly repository: ProjectRepositoryPort) {}

  async execute(input: {
    tenantId: string;
    projectId: string;
    teacherId: string;
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
      input.teacherId,
      label,
    );
    if (version === null) {
      return fail('project_not_found', 'project not found');
    }
    return { ok: true, value: version };
  }
}
