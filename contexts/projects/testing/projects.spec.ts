import { describe, expect, it } from 'vitest';
import {
  isProjectScope,
  isSupportedModuleKey,
  isValidCheckpointLabel,
  isValidProjectTitle,
  type Project,
} from '../domain/project';
import {
  CreateCheckpointUseCase,
  CreateProjectUseCase,
  ListProjectsUseCase,
  OpenProjectUseCase,
  RenameProjectUseCase,
  SaveDraftUseCase,
  projectRequestFingerprint,
} from '../application/project.usecases';
import type { CreateProjectInput, ProjectRepositoryPort } from '../application/ports';

const personalProject: Project = {
  id: 'p1',
  scope: 'personal',
  classroomId: null,
  moduleKey: 'electronics',
  title: 'Схема',
  status: 'active',
  createdAt: 'now',
};

function repo(overrides: Partial<ProjectRepositoryPort> = {}): {
  port: ProjectRepositoryPort;
  creates: CreateProjectInput[];
} {
  const creates: CreateProjectInput[] = [];
  const port: ProjectRepositoryPort = {
    createWithDraft: async (input) => {
      creates.push(input);
      const previous = creates.find(
        (entry, index) =>
          index < creates.length - 1 && entry.idempotencyKey === input.idempotencyKey,
      );
      if (previous && previous.requestFingerprint !== input.requestFingerprint) {
        return { kind: 'conflict' };
      }
      return { kind: previous ? 'existing' : 'created', project: personalProject };
    },
    listForTeacher: async () => [personalProject],
    load: async () => ({
      project: personalProject,
      draft: {
        projectId: 'p1',
        document: { schemaVersion: 1, components: [], connections: [] },
        revision: 1,
        updatedAt: 'now',
      },
      versions: [],
    }),
    rename: async (_tenantId, _projectId, _teacherId, title) => ({ ...personalProject, title }),
    saveDraft: async () => ({ projectId: 'p1', document: {}, revision: 2, updatedAt: 'now' }),
    createCheckpoint: async () => ({
      id: 'v1',
      projectId: 'p1',
      versionNo: 1,
      label: null,
      createdAt: 'now',
    }),
    ...overrides,
  };
  return { port, creates };
}

const okValidator = (value: unknown) => ({ ok: true as const, document: value });
const personalInput = {
  tenantId: 't1',
  scope: 'personal' as const,
  classroomId: null,
  teacherId: 'u1',
  moduleKey: 'electronics',
  title: 'Схема',
  idempotencyKey: 'k1',
};
const classroomInput = { ...personalInput, scope: 'classroom' as const, classroomId: 'c1' };

describe('project domain rules', () => {
  it('validates titles, scopes, module keys and checkpoint labels', () => {
    expect(isValidProjectTitle('Схема 1')).toBe(true);
    expect(isValidProjectTitle('  ')).toBe(false);
    expect(isProjectScope('personal')).toBe(true);
    expect(isProjectScope('classroom')).toBe(true);
    expect(isProjectScope('global')).toBe(false);
    expect(isSupportedModuleKey('electronics')).toBe(true);
    expect(isSupportedModuleKey('checkers')).toBe(false);
    expect(isValidCheckpointLabel(undefined)).toBe(true);
    expect(isValidCheckpointLabel('x'.repeat(256))).toBe(false);
  });
});

describe('create project', () => {
  it('creates a personal project without a classroom', async () => {
    const { port, creates } = repo();
    const empty = { schemaVersion: 1, components: [], connections: [] };
    const result = await new CreateProjectUseCase(port, empty).execute(personalInput);
    expect(result.ok && result.value.created).toBe(true);
    expect(creates[0]).toMatchObject({
      scope: 'personal',
      classroomId: null,
      initialDocument: empty,
    });
    expect(creates[0]?.requestFingerprint).toBe(
      projectRequestFingerprint({
        scope: 'personal',
        classroomId: null,
        moduleKey: 'electronics',
        title: 'Схема',
      }),
    );
  });

  it('requires classroomId only for classroom projects', async () => {
    const { port, creates } = repo();
    const usecase = new CreateProjectUseCase(port, {});
    expect((await usecase.execute(classroomInput)).ok).toBe(true);
    expect(creates[0]).toMatchObject({ scope: 'classroom', classroomId: 'c1' });
    expect(await usecase.execute({ ...classroomInput, classroomId: null })).toMatchObject({
      ok: false,
      code: 'validation_error',
    });
    expect(await usecase.execute({ ...personalInput, classroomId: 'c1' })).toMatchObject({
      ok: false,
      code: 'validation_error',
    });
  });

  it('rejects unsupported modules and empty titles', async () => {
    const { port } = repo();
    const usecase = new CreateProjectUseCase(port, {});
    expect((await usecase.execute({ ...personalInput, moduleKey: 'checkers' })).ok).toBe(false);
    expect((await usecase.execute({ ...personalInput, title: '' })).ok).toBe(false);
  });

  it('is idempotent and conflicts on a different payload', async () => {
    const { port } = repo();
    const usecase = new CreateProjectUseCase(port, {});
    const first = await usecase.execute(personalInput);
    const repeat = await usecase.execute(personalInput);
    const conflict = await usecase.execute({ ...personalInput, title: 'Другая' });
    expect(first.ok && first.value.created).toBe(true);
    expect(repeat.ok && !repeat.value.created).toBe(true);
    expect(conflict).toMatchObject({ ok: false, code: 'idempotency_conflict' });
  });
});

describe('list, rename, draft and checkpoint', () => {
  it('passes personal and classroom filters to the repository', async () => {
    const seen: unknown[] = [];
    const { port } = repo({
      listForTeacher: async (_tenantId, _teacherId, filter) => {
        seen.push(filter);
        return [personalProject];
      },
    });
    const usecase = new ListProjectsUseCase(port);
    expect((await usecase.execute('t1', 'u1', { scope: 'personal' })).ok).toBe(true);
    expect((await usecase.execute('t1', 'u1', { scope: 'classroom', classroomId: 'c1' })).ok).toBe(
      true,
    );
    expect(seen).toEqual([{ scope: 'personal' }, { scope: 'classroom', classroomId: 'c1' }]);
  });

  it('rejects inconsistent list filters', async () => {
    const { port } = repo();
    const usecase = new ListProjectsUseCase(port);
    expect(
      await usecase.execute('t1', 'u1', { scope: 'personal', classroomId: 'c1' }),
    ).toMatchObject({ ok: false, code: 'validation_error' });
    expect(await usecase.execute('t1', 'u1', { scope: 'classroom' })).toMatchObject({
      ok: false,
      code: 'validation_error',
    });
  });

  it('renames a project and validates the title', async () => {
    const { port } = repo();
    const usecase = new RenameProjectUseCase(port);
    const renamed = await usecase.execute({
      tenantId: 't1',
      projectId: 'p1',
      teacherId: 'u1',
      title: '  Новое имя  ',
    });
    expect(renamed.ok && renamed.value.title).toBe('Новое имя');
    expect(
      await usecase.execute({ tenantId: 't1', projectId: 'p1', teacherId: 'u1', title: ' ' }),
    ).toMatchObject({ ok: false, code: 'validation_error' });
  });

  it('validates and saves a subject document', async () => {
    const { port } = repo();
    expect(
      await new SaveDraftUseCase(port, () => ({ ok: false, message: 'bad document' })).execute({
        tenantId: 't1',
        projectId: 'p1',
        teacherId: 'u1',
        document: {},
      }),
    ).toMatchObject({ ok: false, code: 'validation_error' });
    const saved = await new SaveDraftUseCase(port, okValidator).execute({
      tenantId: 't1',
      projectId: 'p1',
      teacherId: 'u1',
      document: {},
    });
    expect(saved.ok && saved.value.revision).toBe(2);
  });

  it('creates a numbered checkpoint', async () => {
    const { port } = repo();
    const checkpoint = await new CreateCheckpointUseCase(port).execute({
      tenantId: 't1',
      projectId: 'p1',
      teacherId: 'u1',
      label: '  Первая версия  ',
    });
    expect(checkpoint.ok && checkpoint.value.versionNo).toBe(1);
  });

  it('reports a missing project on open, rename, save and checkpoint', async () => {
    const { port } = repo({
      load: async () => null,
      rename: async () => null,
      saveDraft: async () => null,
      createCheckpoint: async () => null,
    });
    expect(await new OpenProjectUseCase(port).execute('t1', 'ghost', 'u1')).toMatchObject({
      ok: false,
      code: 'project_not_found',
    });
    expect(
      await new RenameProjectUseCase(port).execute({
        tenantId: 't1',
        projectId: 'ghost',
        teacherId: 'u1',
        title: 'X',
      }),
    ).toMatchObject({ ok: false, code: 'project_not_found' });
    expect(
      await new SaveDraftUseCase(port, okValidator).execute({
        tenantId: 't1',
        projectId: 'ghost',
        teacherId: 'u1',
        document: {},
      }),
    ).toMatchObject({ ok: false, code: 'project_not_found' });
    expect(
      await new CreateCheckpointUseCase(port).execute({
        tenantId: 't1',
        projectId: 'ghost',
        teacherId: 'u1',
        label: undefined,
      }),
    ).toMatchObject({ ok: false, code: 'project_not_found' });
  });
});
