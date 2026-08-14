import { describe, expect, it } from 'vitest';
import {
  isProjectScope,
  isValidCheckpointLabel,
  isValidProjectTitle,
  type Project,
} from '../domain/project';
import {
  CreateCheckpointUseCase,
  ChangeProjectStatusUseCase,
  CreateProjectUseCase,
  DuplicateProjectUseCase,
  ListProjectsUseCase,
  OpenProjectUseCase,
  RenameProjectUseCase,
  SaveDraftUseCase,
  projectRequestFingerprint,
} from '../application/project.usecases';
import type {
  CreateProjectInput,
  ModuleCatalogPort,
  ProjectDocumentValidation,
  ProjectRepositoryPort,
} from '../application/ports';

const personalProject: Project = {
  id: 'p1',
  scope: 'personal',
  classroomId: null,
  moduleKey: 'electronics',
  title: 'Схема',
  status: 'active',
  createdAt: 'now',
  updatedAt: 'now',
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
    listForActor: async () => [personalProject],
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
    updateStatus: async (_tenantId, _projectId, _actor, status) => ({
      ...personalProject,
      status,
    }),
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

function catalog(
  emptyDocument: unknown = { schemaVersion: 1, components: [], connections: [] },
  validateDocument: (value: unknown) => ProjectDocumentValidation = (value) => ({
    ok: true,
    document: value,
  }),
): ModuleCatalogPort {
  const module = {
    moduleKey: 'electronics',
    createEmptyProject: () => emptyDocument,
    validateDocument,
  };
  return {
    get: (moduleKey) => (moduleKey === 'electronics' ? module : null),
    getCreatable: (moduleKey) => (moduleKey === 'electronics' ? module : null),
  };
}

const personalInput = {
  tenantId: 't1',
  scope: 'personal' as const,
  classroomId: null,
  actor: { principalId: 'principal:1', userId: 'u1' },
  moduleKey: 'electronics',
  title: 'Схема',
  idempotencyKey: 'k1',
};
const classroomInput = { ...personalInput, scope: 'classroom' as const, classroomId: 'c1' };

describe('project domain rules', () => {
  it('validates titles, scopes and checkpoint labels without knowing subject modules', () => {
    expect(isValidProjectTitle('Схема 1')).toBe(true);
    expect(isValidProjectTitle('  ')).toBe(false);
    expect(isProjectScope('personal')).toBe(true);
    expect(isProjectScope('classroom')).toBe(true);
    expect(isProjectScope('global')).toBe(false);
    expect(isValidCheckpointLabel(undefined)).toBe(true);
    expect(isValidCheckpointLabel('x'.repeat(256))).toBe(false);
  });
});

describe('create project', () => {
  it('creates a personal project from the module provider without a classroom', async () => {
    const { port, creates } = repo();
    const empty = { schemaVersion: 1, components: [], connections: [] };
    const result = await new CreateProjectUseCase(port, catalog(empty)).execute(personalInput);
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
    const usecase = new CreateProjectUseCase(port, catalog());
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

  it('rejects modules that are not creatable in the registry and empty titles', async () => {
    const { port } = repo();
    const usecase = new CreateProjectUseCase(port, catalog());
    expect((await usecase.execute({ ...personalInput, moduleKey: 'checkers' })).ok).toBe(false);
    expect((await usecase.execute({ ...personalInput, title: '' })).ok).toBe(false);
  });

  it('is idempotent and conflicts on a different payload', async () => {
    const { port } = repo();
    const usecase = new CreateProjectUseCase(port, catalog());
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
      listForActor: async (_tenantId, _actor, filter) => {
        seen.push(filter);
        return [personalProject];
      },
    });
    const usecase = new ListProjectsUseCase(port);
    expect(
      (
        await usecase.execute(
          't1',
          { principalId: 'principal:1', userId: 'u1' },
          { scope: 'personal' },
        )
      ).ok,
    ).toBe(true);
    expect(
      (
        await usecase.execute(
          't1',
          { principalId: 'principal:1', userId: 'u1' },
          { scope: 'classroom', classroomId: 'c1' },
        )
      ).ok,
    ).toBe(true);
    expect(seen).toEqual([{ scope: 'personal' }, { scope: 'classroom', classroomId: 'c1' }]);
  });

  it('rejects inconsistent list filters', async () => {
    const { port } = repo();
    const usecase = new ListProjectsUseCase(port);
    expect(
      await usecase.execute(
        't1',
        { principalId: 'principal:1', userId: 'u1' },
        { scope: 'personal', classroomId: 'c1' },
      ),
    ).toMatchObject({ ok: false, code: 'validation_error' });
    expect(
      await usecase.execute(
        't1',
        { principalId: 'principal:1', userId: 'u1' },
        { scope: 'classroom' },
      ),
    ).toMatchObject({
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
      actor: { principalId: 'principal:1', userId: 'u1' },
      title: '  Новое имя  ',
    });
    expect(renamed.ok && renamed.value.title).toBe('Новое имя');
    expect(
      await usecase.execute({
        tenantId: 't1',
        projectId: 'p1',
        actor: { principalId: 'principal:1', userId: 'u1' },
        title: ' ',
      }),
    ).toMatchObject({ ok: false, code: 'validation_error' });
  });

  it('asks the project module to validate a draft before saving', async () => {
    const { port } = repo();
    const invalidCatalog = catalog({}, () => ({ ok: false, message: 'bad document' }));
    expect(
      await new SaveDraftUseCase(port, invalidCatalog).execute({
        tenantId: 't1',
        projectId: 'p1',
        actor: { principalId: 'principal:1', userId: 'u1' },
        document: {},
      }),
    ).toMatchObject({ ok: false, code: 'validation_error' });
    const saved = await new SaveDraftUseCase(port, catalog()).execute({
      tenantId: 't1',
      projectId: 'p1',
      actor: { principalId: 'principal:1', userId: 'u1' },
      document: {},
    });
    expect(saved.ok && saved.value.revision).toBe(2);
  });

  it('creates a numbered checkpoint', async () => {
    const { port } = repo();
    const checkpoint = await new CreateCheckpointUseCase(port).execute({
      tenantId: 't1',
      projectId: 'p1',
      actor: { principalId: 'principal:1', userId: 'u1' },
      label: '  Первая версия  ',
    });
    expect(checkpoint.ok && checkpoint.value.versionNo).toBe(1);
  });

  it('archives, trashes and restores through explicit state transitions', async () => {
    let current = personalProject;
    const { port } = repo({
      load: async () => ({
        project: current,
        draft: { projectId: current.id, document: {}, revision: 1, updatedAt: 'now' },
        versions: [],
      }),
      updateStatus: async (_tenantId, _projectId, _actor, status) => {
        current = { ...current, status };
        return current;
      },
    });
    const usecase = new ChangeProjectStatusUseCase(port);
    expect(
      await usecase.execute({
        tenantId: 't1',
        projectId: 'p1',
        actor: { principalId: 'principal:1', userId: 'u1' },
        status: 'archived',
      }),
    ).toMatchObject({ ok: true, value: { status: 'archived' } });
    expect(
      await usecase.execute({
        tenantId: 't1',
        projectId: 'p1',
        actor: { principalId: 'principal:1', userId: 'u1' },
        status: 'active',
      }),
    ).toMatchObject({ ok: true, value: { status: 'active' } });
    expect(
      await usecase.execute({
        tenantId: 't1',
        projectId: 'p1',
        actor: { principalId: 'principal:1', userId: 'u1' },
        status: 'invalid',
      }),
    ).toMatchObject({ ok: false, code: 'validation_error' });
  });

  it('duplicates the current draft into an independent private project', async () => {
    const { port, creates } = repo();
    const result = await new DuplicateProjectUseCase(port).execute({
      tenantId: 't1',
      projectId: 'p1',
      actor: { principalId: 'principal:1', userId: 'u1' },
      title: 'Копия схемы',
      idempotencyKey: 'duplicate-1',
    });
    expect(result).toMatchObject({ ok: true, value: { created: true } });
    expect(creates[0]).toMatchObject({
      title: 'Копия схемы',
      scope: 'personal',
      moduleKey: 'electronics',
      initialDocument: { schemaVersion: 1, components: [], connections: [] },
    });
  });

  it('reports a missing project on open, rename, save and checkpoint', async () => {
    const { port } = repo({
      load: async () => null,
      rename: async () => null,
      saveDraft: async () => null,
      createCheckpoint: async () => null,
    });
    expect(
      await new OpenProjectUseCase(port).execute('t1', 'ghost', {
        principalId: 'principal:1',
        userId: 'u1',
      }),
    ).toMatchObject({ ok: false, code: 'project_not_found' });
    expect(
      await new RenameProjectUseCase(port).execute({
        tenantId: 't1',
        projectId: 'ghost',
        actor: { principalId: 'principal:1', userId: 'u1' },
        title: 'X',
      }),
    ).toMatchObject({ ok: false, code: 'project_not_found' });
    expect(
      await new SaveDraftUseCase(port, catalog()).execute({
        tenantId: 't1',
        projectId: 'ghost',
        actor: { principalId: 'principal:1', userId: 'u1' },
        document: {},
      }),
    ).toMatchObject({ ok: false, code: 'project_not_found' });
    expect(
      await new CreateCheckpointUseCase(port).execute({
        tenantId: 't1',
        projectId: 'ghost',
        actor: { principalId: 'principal:1', userId: 'u1' },
        label: undefined,
      }),
    ).toMatchObject({ ok: false, code: 'project_not_found' });
  });
});
