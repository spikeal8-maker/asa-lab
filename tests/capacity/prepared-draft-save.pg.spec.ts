import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { PgProjectRepository } from '../../contexts/projects/infrastructure/pg-project.repository';
import { SaveDraftUseCase } from '../../contexts/projects/application/project.usecases';
import type {
  ModuleCatalogPort,
  ProjectRepositoryPort,
} from '../../contexts/projects/application/ports';
import { ELECTRONICS_MODULE } from '../../contexts/electronics/module';
import { EMPTY_DOCUMENT } from '../../contexts/electronics/domain/document';
import { seedTeacher, testAdminPool, testAppPool } from '../portal/helpers';

let admin: pg.Pool;
let runtime: pg.Pool;
beforeAll(() => {
  admin = testAdminPool();
  runtime = testAppPool();
});
afterAll(async () => {
  await Promise.all([admin?.end(), runtime?.end()]);
});

async function fixture() {
  const teacher = await seedTeacher(admin, 'prepared-save');
  const link = (
    await admin.query(
      'SELECT principal_id FROM legacy_user_account_links WHERE tenant_id=$1 AND user_id=$2',
      [teacher.tenantId, teacher.teacherId],
    )
  ).rows[0];
  const actor = { principalId: link.principal_id as string, userId: teacher.teacherId };
  const repo = new PgProjectRepository(runtime);
  const created = await repo.createWithDraft({
    tenantId: teacher.tenantId,
    scope: 'personal',
    classroomId: null,
    actor,
    moduleKey: 'electronics',
    title: 'Prepared save',
    idempotencyKey: randomUUID(),
    requestFingerprint: randomUUID(),
    initialDocument: { schemaVersion: 1, components: [], connections: [] },
    initialPreview: null,
  });
  if (created.kind !== 'created') throw new Error('fixture_create_failed');
  const input = {
    document: { schemaVersion: 1, components: [], connections: [] },
    preview: null,
    baseRevision: 1,
    mutationId: randomUUID(),
  };
  return { teacher, actor, repo, projectId: created.project.id, input };
}

describe('prepared draft saves on the restricted PostgreSQL role', () => {
  it.each([false, true])(
    'keeps annotation data through downgrade, replay and upgrade races (prepared=%s)',
    async (prepared) => {
      const f = await fixture();
      const provider = ELECTRONICS_MODULE.provider!;
      const module = {
        moduleKey: 'electronics',
        defaultProjectTitlePrefix: 'Circuit',
        createEmptyProject: () => EMPTY_DOCUMENT,
        validateDocument: (document: unknown) => {
          const result = provider.validate(document);
          return result.ok
            ? { ok: true as const, document: result.payload }
            : { ok: false as const, message: 'invalid' };
        },
        validateReplacement: (previous: unknown, next: unknown) => {
          const parsed = provider.validate(next);
          if (!parsed.ok) return { ok: false as const, message: 'invalid' };
          return provider.validateReplacement!(previous, parsed.payload).ok
            ? { ok: true as const }
            : { ok: false as const, message: 'format downgrade denied' };
        },
        describePreview: () => null,
      };
      const modules: ModuleCatalogPort = { get: () => module, getCreatable: () => module };
      const repository = Object.create(f.repo) as ProjectRepositoryPort;
      if (!prepared) repository.prepareDraftSave = undefined;
      const usecase = new SaveDraftUseCase(repository, modules);
      const command = {
        tenantId: f.teacher.tenantId,
        projectId: f.projectId,
        actor: f.actor,
        document: EMPTY_DOCUMENT,
        baseRevision: 1,
        mutationId: randomUUID(),
      };
      const upgraded = {
        ...EMPTY_DOCUMENT,
        schemaVersion: 5,
        annotations: [
          {
            id: 'text-1',
            text: 'Русский 😀\n\\u0000',
            position: { x: 0, y: 0 },
            size: { width: 240, height: 96 },
            fontSize: 18,
          },
        ],
      };
      const upgrade = { ...command, document: upgraded };
      expect(await usecase.execute(upgrade)).toMatchObject({
        ok: true,
        value: { revision: 2, document: upgraded },
      });
      // Replay follows the existing CAS receipt, rather than failing on an old base.
      expect(await usecase.execute(upgrade)).toMatchObject({
        ok: true,
        value: { revision: 2, document: upgraded },
      });
      expect(
        await usecase.execute({ ...command, baseRevision: 2, mutationId: randomUUID() }),
      ).toMatchObject({ ok: false, code: 'validation_error' });
      expect(
        await usecase.execute({ ...command, baseRevision: 3, mutationId: randomUUID() }),
      ).toMatchObject({ ok: false, code: 'project_revision_conflict' });
      const stored = await f.repo.load(f.teacher.tenantId, f.projectId, f.actor, {
        includeVersions: false,
      });
      expect(stored?.draft).toMatchObject({ revision: 2, document: upgraded });

      // A valid old-format writer read revision 1, then another writer upgrades.
      const racing = await fixture();
      const raw = racing.repo;
      const racingRepository = Object.create(raw) as ProjectRepositoryPort;
      if (!prepared) racingRepository.prepareDraftSave = undefined;
      const originalLoad = raw.load.bind(raw);
      let upgradedDuringRead = false;
      racingRepository.load = async (...args) => {
        const before = await originalLoad(...args);
        if (!upgradedDuringRead) {
          upgradedDuringRead = true;
          expect(
            await raw.saveDraft({
              tenantId: racing.teacher.tenantId,
              projectId: racing.projectId,
              actor: racing.actor,
              document: upgraded,
              preview: null,
              baseRevision: 1,
              mutationId: randomUUID(),
            }),
          ).toMatchObject({ revision: 2 });
        }
        return before;
      };
      const raced = await new SaveDraftUseCase(racingRepository, modules).execute({
        ...command,
        tenantId: racing.teacher.tenantId,
        projectId: racing.projectId,
        actor: racing.actor,
        mutationId: randomUUID(),
      });
      expect(raced).toMatchObject({ ok: false, code: 'project_revision_conflict' });
      expect(
        (await originalLoad(racing.teacher.tenantId, racing.projectId, racing.actor))?.draft,
      ).toMatchObject({ revision: 2, document: upgraded });
    },
  );

  it('persists, replays one receipt and rejects a stale mutation without incrementing twice', async () => {
    const f = await fixture();
    const target = await f.repo.prepareDraftSave(f.teacher.tenantId, f.projectId, f.actor);
    expect(target?.moduleKey).toBe('electronics');
    const saved = await target!.save(f.input);
    expect(saved?.revision).toBe(2);
    expect(await target!.save(f.input)).toEqual(saved);
    expect(await target!.save({ ...f.input, mutationId: randomUUID() })).toBeNull();
    const stored = await f.repo.load(f.teacher.tenantId, f.projectId, f.actor, {
      includeVersions: false,
    });
    expect(stored?.draft).toEqual(saved);
  });

  it('denies a prepared write and receipt replay after the legacy mapping changes', async () => {
    const f = await fixture();
    const target = await f.repo.prepareDraftSave(f.teacher.tenantId, f.projectId, f.actor);
    expect(await target!.save(f.input)).toMatchObject({ revision: 2 });
    // Owner principal still has current access, but its resolved user is now
    // null. A saved context must not reuse the retired legacy-user authority.
    await admin.query(
      "UPDATE legacy_user_account_links SET migration_state='retired' WHERE tenant_id=$1 AND user_id=$2",
      [f.teacher.tenantId, f.teacher.teacherId],
    );
    expect(await target!.save(f.input)).toBeNull();
    expect(
      await target!.save({ ...f.input, baseRevision: 2, mutationId: randomUUID() }),
    ).toBeNull();
    const stored = await admin.query(
      'SELECT revision FROM project_drafts WHERE tenant_id=$1 AND project_id=$2',
      [f.teacher.tenantId, f.projectId],
    );
    expect(stored.rows[0].revision).toBe(2);
  });

  it('denies another principal from a different tenant before returning a writer', async () => {
    const f = await fixture();
    const foreign = await fixture();
    expect(
      await f.repo.prepareDraftSave(foreign.teacher.tenantId, f.projectId, foreign.actor),
    ).toBeNull();
  });
});
