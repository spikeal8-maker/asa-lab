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
  ReadProjectSnapshotUseCase,
  RenameProjectUseCase,
  SaveDraftUseCase,
  SaveProjectSnapshotUseCase,
  projectRequestFingerprint,
} from '../application/project.usecases';
import type { ModulePreviewDescriptor } from '@asa-lab/module-sdk';
import type {
  CreateProjectInput,
  ModuleCatalogPort,
  ProjectDocumentValidation,
  ProjectRepositoryPort,
  SaveDraftInput,
  SaveSnapshotInput,
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
  preview: null,
};

const CIRCUIT_PREVIEW: ModulePreviewDescriptor = {
  kind: 'schematic',
  summary: '1 компонентов · 0 соединений',
  figure: {
    viewBox: { width: 40, height: 40 },
    shapes: [{ shape: 'rect', x: 12, y: 12, width: 16, height: 16, fill: '#3f6f8f' }],
  },
};

function repo(overrides: Partial<ProjectRepositoryPort> = {}): {
  port: ProjectRepositoryPort;
  creates: CreateProjectInput[];
  saves: SaveDraftInput[];
} {
  const creates: CreateProjectInput[] = [];
  const saves: SaveDraftInput[] = [];
  const snapshots: SaveSnapshotInput[] = [];
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
        preview: { digest: 'aaaaaaaa', descriptor: CIRCUIT_PREVIEW },
      },
      versions: [],
    }),
    rename: async (_tenantId, _projectId, _teacherId, title) => ({ ...personalProject, title }),
    updateStatus: async (_tenantId, _projectId, _actor, status) => ({
      ...personalProject,
      status,
    }),
    saveDraft: async (input) => {
      saves.push(input);
      return {
        projectId: 'p1',
        document: {},
        revision: 2,
        updatedAt: 'now',
        preview: input.preview,
      };
    },
    createCheckpoint: async () => ({
      id: 'v1',
      projectId: 'p1',
      versionNo: 1,
      label: null,
      createdAt: 'now',
    }),
    saveSnapshot: async (input) => {
      snapshots.push(input);
      return {
        projectId: 'p1',
        contentType: input.image.contentType,
        width: input.image.width,
        height: input.image.height,
        // The repository takes the revision from the draft, never the caller.
        sourceRevision: 4,
        capturedAt: 'now',
      };
    },
    loadSnapshot: async () => null,
    ...overrides,
  };
  return { port, creates, saves, snapshots };
}

/** A PNG header is enough for the validator; the pixels are not inspected. */
function pngDataUrl(width = 320, height = 200, totalBytes = 128): string {
  const bytes = new Uint8Array(totalBytes);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  bytes.set([0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52], 8);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width, false);
  view.setUint32(20, height, false);
  return `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`;
}

function catalog(
  emptyDocument: unknown = { schemaVersion: 1, components: [], connections: [] },
  validateDocument: (value: unknown) => ProjectDocumentValidation = (value) => ({
    ok: true,
    document: value,
  }),
  describePreview: (document: unknown) => ModulePreviewDescriptor | null = () => CIRCUIT_PREVIEW,
): ModuleCatalogPort {
  const module = {
    moduleKey: 'electronics',
    createEmptyProject: () => emptyDocument,
    validateDocument,
    describePreview,
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

describe('project snapshots', () => {
  const actor = { principalId: 'principal:1', userId: 'u1' };
  const input = { tenantId: 't1', projectId: 'p1', actor };

  it('stores a picture the editor captured', async () => {
    const { port, snapshots } = repo();
    const result = await new SaveProjectSnapshotUseCase(port).execute({
      ...input,
      imageDataUrl: pngDataUrl(320, 200),
    });
    expect(result).toMatchObject({ ok: true });
    expect(snapshots[0]?.image).toMatchObject({
      contentType: 'image/png',
      width: 320,
      height: 200,
    });
  });

  /**
   * The revision decides whether a cached card is current, so it is read from
   * the draft the server holds. A caller that could name it could pin a card to
   * a picture of work that is no longer there.
   */
  it('reports the revision the server chose, not one the caller supplied', async () => {
    const { port } = repo();
    const result = await new SaveProjectSnapshotUseCase(port).execute({
      ...input,
      imageDataUrl: pngDataUrl(),
    });
    expect(result).toMatchObject({ ok: true, value: { sourceRevision: 4 } });
  });

  it('refuses an SVG dressed as a snapshot', async () => {
    const { port, snapshots } = repo();
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>').toString('base64');
    const result = await new SaveProjectSnapshotUseCase(port).execute({
      ...input,
      imageDataUrl: `data:image/svg+xml;base64,${svg}`,
    });
    expect(result).toMatchObject({ ok: false, code: 'validation_error' });
    expect(snapshots).toHaveLength(0);
  });

  /**
   * A base64 decoder skips characters outside its alphabet, so bytes that pass
   * a lenient decode are not the bytes that were validated. The charset is
   * checked before anything is decoded.
   */
  it('refuses a payload whose media type lies about its bytes', async () => {
    const { port, snapshots } = repo();
    const html = Buffer.from('<!doctype html><script>alert(1)</script>').toString('base64');
    const result = await new SaveProjectSnapshotUseCase(port).execute({
      ...input,
      imageDataUrl: `data:image/png;base64,${html}`,
    });
    expect(result).toMatchObject({ ok: false, code: 'validation_error' });
    expect(snapshots).toHaveLength(0);
  });

  it('refuses a remote URL in place of an image', async () => {
    const { port } = repo();
    const result = await new SaveProjectSnapshotUseCase(port).execute({
      ...input,
      imageDataUrl: 'https://example.invalid/picture.png',
    });
    expect(result).toMatchObject({ ok: false, code: 'validation_error' });
  });

  it('reports a missing project rather than inventing one', async () => {
    const { port } = repo({ saveSnapshot: async () => null });
    const result = await new SaveProjectSnapshotUseCase(port).execute({
      ...input,
      imageDataUrl: pngDataUrl(),
    });
    expect(result).toMatchObject({ ok: false, code: 'project_not_found' });
  });

  it('reports no snapshot for a project that has never been photographed', async () => {
    const { port } = repo();
    const result = await new ReadProjectSnapshotUseCase(port).execute('t1', 'p1', actor);
    expect(result).toMatchObject({ ok: false, code: 'project_not_found' });
  });
});

describe('project previews', () => {
  const actor = { principalId: 'principal:1', userId: 'u1' };

  it('stores the preview of the starting document when a project is created', async () => {
    const { port, creates } = repo();
    await new CreateProjectUseCase(port, catalog()).execute(personalInput);
    expect(creates[0]?.initialPreview?.descriptor).toEqual(CIRCUIT_PREVIEW);
  });

  it('fingerprints the preview so a card can tell whether it is current', async () => {
    const { port, creates } = repo();
    await new CreateProjectUseCase(port, catalog()).execute(personalInput);
    expect(creates[0]?.initialPreview?.digest).toMatch(/^[0-9a-f]{8}$/);
  });

  it('redraws the preview on every save', async () => {
    const { port, saves } = repo();
    await new SaveDraftUseCase(port, catalog()).execute({
      tenantId: 't1',
      projectId: 'p1',
      actor,
      document: { schemaVersion: 1, components: [], connections: [] },
    });
    expect(saves[0]?.preview?.descriptor).toEqual(CIRCUIT_PREVIEW);
  });

  /**
   * The preview is decoration; the document is the learner's work. A module bug
   * in preview code must never turn a save into an error, so the save proceeds
   * with no picture rather than failing.
   */
  it('saves the document even when the module fails to draw it', async () => {
    const { port, saves } = repo();
    const broken = catalog(undefined, undefined, () => {
      throw new Error('preview blew up');
    });
    const result = await new SaveDraftUseCase(port, broken).execute({
      tenantId: 't1',
      projectId: 'p1',
      actor,
      document: { schemaVersion: 1, components: [], connections: [] },
    });
    expect(result.ok).toBe(true);
    expect(saves[0]?.preview).toBeNull();
  });

  it('stores no preview when the module has nothing to draw', async () => {
    const { port, saves } = repo();
    const empty = catalog(undefined, undefined, () => null);
    await new SaveDraftUseCase(port, empty).execute({
      tenantId: 't1',
      projectId: 'p1',
      actor,
      document: { schemaVersion: 1, components: [], connections: [] },
    });
    expect(saves[0]?.preview).toBeNull();
  });

  /** A duplicate carries the same document, so redrawing it is wasted work. */
  it('carries the source preview into a duplicate', async () => {
    const { port, creates } = repo();
    await new DuplicateProjectUseCase(port).execute({
      tenantId: 't1',
      projectId: 'p1',
      actor,
      title: 'Копия',
      idempotencyKey: 'dup-1',
    });
    expect(creates[0]?.initialPreview).toEqual({
      digest: 'aaaaaaaa',
      descriptor: CIRCUIT_PREVIEW,
    });
  });
});
