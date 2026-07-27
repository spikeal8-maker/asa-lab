import { describe, it, expect } from 'vitest';
import {
  isSupportedModuleKey,
  isValidCheckpointLabel,
  isValidProjectTitle,
} from '../domain/project';
import {
  CreateCheckpointUseCase,
  CreateProjectUseCase,
  OpenProjectUseCase,
  SaveDraftUseCase,
  projectRequestFingerprint,
} from '../application/project.usecases';
import type { CreateProjectInput, ProjectRepositoryPort } from '../application/ports';

const project = {
  id: 'p1',
  classroomId: 'c1',
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
      return { kind: previous ? 'existing' : 'created', project };
    },
    listForClassroom: async () => [project],
    load: async () => ({
      project,
      draft: {
        projectId: 'p1',
        document: { schemaVersion: 1, components: [], connections: [] },
        revision: 1,
        updatedAt: 'now',
      },
      versions: [],
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

const okValidator = (value: unknown) => ({ ok: true as const, document: value });

describe('project domain rules', () => {
  it('validates titles, module keys and checkpoint labels', () => {
    expect(isValidProjectTitle('Схема 1')).toBe(true);
    expect(isValidProjectTitle('  ')).toBe(false);
    expect(isSupportedModuleKey('electronics')).toBe(true);
    expect(isSupportedModuleKey('checkers')).toBe(false);
    expect(isValidCheckpointLabel(undefined)).toBe(true);
    expect(isValidCheckpointLabel('x'.repeat(256))).toBe(false);
  });
});

describe('create project', () => {
  const base = {
    tenantId: 't1',
    classroomId: 'c1',
    teacherId: 'u1',
    moduleKey: 'electronics',
    title: 'Схема',
    idempotencyKey: 'k1',
  };

  it('creates a project with the module empty document', async () => {
    const { port, creates } = repo();
    const usecase = new CreateProjectUseCase(port, {
      schemaVersion: 1,
      components: [],
      connections: [],
    });
    const result = await usecase.execute(base);
    expect(result.ok && result.value.created).toBe(true);
    expect(creates[0]?.initialDocument).toEqual({
      schemaVersion: 1,
      components: [],
      connections: [],
    });
    expect(creates[0]?.requestFingerprint).toBe(projectRequestFingerprint('electronics', 'Схема'));
  });

  it('rejects an unsupported module and an empty title', async () => {
    const { port } = repo();
    const usecase = new CreateProjectUseCase(port, {});
    expect((await usecase.execute({ ...base, moduleKey: 'checkers' })).ok).toBe(false);
    expect((await usecase.execute({ ...base, title: '' })).ok).toBe(false);
  });

  it('is idempotent and conflicts on a different payload', async () => {
    const { port } = repo();
    const usecase = new CreateProjectUseCase(port, {});
    const first = await usecase.execute(base);
    const repeat = await usecase.execute(base);
    const conflict = await usecase.execute({ ...base, title: 'Другая' });
    expect(first.ok && first.value.created).toBe(true);
    expect(repeat.ok && !repeat.value.created).toBe(true);
    expect(conflict).toMatchObject({ ok: false, code: 'idempotency_conflict' });
  });

  it('reports a classroom that does not belong to the teacher', async () => {
    const { port } = repo({ createWithDraft: async () => ({ kind: 'classroom_not_found' }) });
    const usecase = new CreateProjectUseCase(port, {});
    expect(await usecase.execute(base)).toMatchObject({ ok: false, code: 'classroom_not_found' });
  });
});

describe('draft and checkpoint', () => {
  it('validates the subject document before saving', async () => {
    const { port } = repo();
    const usecase = new SaveDraftUseCase(port, () => ({ ok: false, message: 'bad document' }));
    expect(
      await usecase.execute({ tenantId: 't1', projectId: 'p1', teacherId: 'u1', document: {} }),
    ).toMatchObject({ ok: false, code: 'validation_error' });
  });

  it('saves a valid document and bumps the revision', async () => {
    const { port } = repo();
    const usecase = new SaveDraftUseCase(port, okValidator);
    const result = await usecase.execute({
      tenantId: 't1',
      projectId: 'p1',
      teacherId: 'u1',
      document: {},
    });
    expect(result.ok && result.value.revision).toBe(2);
  });

  it('reports a missing project on save, open and checkpoint', async () => {
    const { port } = repo({
      saveDraft: async () => null,
      load: async () => null,
      createCheckpoint: async () => null,
    });
    expect(
      await new SaveDraftUseCase(port, okValidator).execute({
        tenantId: 't1',
        projectId: 'ghost',
        teacherId: 'u1',
        document: {},
      }),
    ).toMatchObject({ ok: false, code: 'project_not_found' });
    expect(await new OpenProjectUseCase(port).execute('t1', 'ghost', 'u1')).toMatchObject({
      ok: false,
      code: 'project_not_found',
    });
    expect(
      await new CreateCheckpointUseCase(port).execute({
        tenantId: 't1',
        projectId: 'ghost',
        teacherId: 'u1',
        label: undefined,
      }),
    ).toMatchObject({ ok: false, code: 'project_not_found' });
  });

  it('creates a numbered checkpoint', async () => {
    const { port } = repo();
    const result = await new CreateCheckpointUseCase(port).execute({
      tenantId: 't1',
      projectId: 'p1',
      teacherId: 'u1',
      label: '  Первая версия  ',
    });
    expect(result.ok && result.value.versionNo).toBe(1);
  });
});
