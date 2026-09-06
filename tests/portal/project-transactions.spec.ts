import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type pg from 'pg';
import { withTenantContext } from '../../packages/database/src/index';
import { PgProjectRepository } from '../../contexts/projects/infrastructure/pg-project.repository';
import { ListProjectsUseCase } from '../../contexts/projects/application/project.usecases';
import type { CreateProjectInput } from '../../contexts/projects/application/ports';
import { seedTeacher, testAdminPool, testAppPool } from './helpers';

let admin: pg.Pool;
let runtime: pg.Pool;
beforeAll(() => {
  admin = testAdminPool();
  runtime = testAppPool();
});
afterAll(async () => {
  await runtime?.end();
  await admin?.end();
});

// Inject a real PostgreSQL error only in the optional activity statement. No
// database functions, roles or shared schema are replaced by these tests.
function activityFailurePool(pool: pg.Pool): pg.Pool {
  return new Proxy(pool, {
    get(target, property) {
      if (property === 'connect') {
        return async () => {
          const client = await target.connect();
          return new Proxy(client, {
            get(connection, key) {
              if (key === 'query') {
                return (sql: string, values?: unknown[]) =>
                  connection.query(
                    sql.startsWith('SELECT classroom_activity_record_project')
                      ? 'SELECT 1 / 0'
                      : sql,
                    sql.startsWith('SELECT classroom_activity_record_project') ? [] : values,
                  );
              }
              const value = Reflect.get(connection, key);
              return typeof value === 'function' ? value.bind(connection) : value;
            },
          });
        };
      }
      const value = Reflect.get(target, property);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

async function inputForTeacher(): Promise<CreateProjectInput> {
  const teacher = await seedTeacher(admin, 'transaction');
  const principal = await admin.query(
    'SELECT principal_id FROM legacy_user_account_links WHERE tenant_id=$1 AND user_id=$2',
    [teacher.tenantId, teacher.teacherId],
  );
  return {
    tenantId: teacher.tenantId,
    scope: 'personal',
    classroomId: null,
    actor: { userId: teacher.teacherId, principalId: principal.rows[0].principal_id as string },
    moduleKey: 'electronics',
    title: 'Проверка транзакции',
    idempotencyKey: crypto.randomUUID(),
    requestFingerprint: 'transaction-fixture',
    initialDocument: { schemaVersion: 1, components: [], connections: [] },
    initialPreview: null,
  };
}

describe('project persistence on real PostgreSQL', () => {
  it('allocates unique automatic names under concurrent devices and replays without extra drafts', async () => {
    const input = await inputForTeacher();
    const repo = new PgProjectRepository(runtime);
    const operations = Array.from({ length: 20 }, () => ({
      ...input,
      idempotencyKey: crypto.randomUUID(),
      automaticTitlePrefix: 'Электрическая цепь',
    }));
    const results = await Promise.all(
      operations.map((operation) => repo.createWithDraft(operation)),
    );
    const projects = results.flatMap((result) =>
      result.kind === 'created' ? [result.project] : [],
    );
    expect(projects).toHaveLength(20);
    expect(new Set(projects.map((project) => project.title)).size).toBe(20);
    const replay = await Promise.all(
      operations.map((operation) => repo.createWithDraft(operation)),
    );
    expect(replay.every((result) => result.kind === 'existing')).toBe(true);
    expect(
      await repo.listForActor(input.tenantId, input.actor, { scope: 'personal' }),
    ).toHaveLength(20);
  });

  it('pages a large mixed library without gaps, games, other owners or full documents', async () => {
    const input = await inputForTeacher();
    const repo = new PgProjectRepository(runtime);
    const ids: string[] = [];
    // Real repository writes, with only synthetic documents in the isolated DB.
    for (let start = 0; start < 1000; start += 20) {
      await Promise.all(
        Array.from({ length: 20 }, async (_, offset) => {
          const i = start + offset;
          const result = await repo.createWithDraft({
            ...input,
            idempotencyKey: crypto.randomUUID(),
            moduleKey: i < 990 ? 'electronics' : 'three-d',
            title: `Работа ${String(i).padStart(4, '0')}`,
          });
          if (result.kind !== 'created') throw new Error('fixture failed');
          ids.push(result.project.id);
        }),
      );
    }
    // All times equal at microsecond precision exercises a stable ID tie break.
    await admin.query(
      "UPDATE project_drafts SET updated_at='2026-09-01T10:00:00.123456Z' WHERE project_id=ANY($1::uuid[])",
      [ids],
    );
    const modules = await Promise.all(
      ['electronics', 'three-d'].map((moduleKey) =>
        repo.listForActor(input.tenantId, input.actor, { scope: 'personal', moduleKey, limit: 5 }),
      ),
    );
    expect(modules.map((rows) => rows.length)).toEqual([5, 5]);
    expect(JSON.stringify(modules).length).toBeLessThan(20000);
    expect(modules.flat().every((row) => !('document' in row))).toBe(true);
    const list = new ListProjectsUseCase(repo);
    for (const sort of ['recent', 'oldest', 'title'] as const) {
      const combined = await repo.listForActor(input.tenantId, input.actor, { limit: 5, sort });
      expect(combined).toHaveLength(5);
    }
    for (const sort of ['recent', 'oldest', 'title'] as const) {
      let cursor: string | undefined;
      const seen: string[] = [];
      do {
        const result = await list.execute(input.tenantId, input.actor, {
          scope: 'personal',
          moduleKey: 'electronics',
          limit: 100,
          sort,
          cursor,
        });
        if (!result.ok) throw new Error(result.message);
        seen.push(...result.value.map((row) => row.id));
        const last = result.value.at(-1);
        cursor =
          result.value.length === 100 && last
            ? Buffer.from(JSON.stringify([sort, last.updatedAt, last.id, last.title])).toString(
                'base64url',
              )
            : undefined;
      } while (cursor);
      expect(seen).toHaveLength(990);
      expect(new Set(seen).size).toBe(990);
    }
    const foreign = await inputForTeacher();
    expect(
      await repo.listForActor(input.tenantId, foreign.actor, { scope: 'personal', limit: 5 }),
    ).toEqual([]);
    expect(
      await repo.listForActor(input.tenantId, input.actor, {
        scope: 'personal',
        search: 'Работа 0999',
      }),
    ).toHaveLength(1);
    await repo.createWithDraft({
      ...input,
      idempotencyKey: crypto.randomUUID(),
      moduleKey: 'chess',
    });
    expect(
      await repo.listForActor(input.tenantId, input.actor, {
        scope: 'personal',
        moduleKey: 'chess',
        excludeGames: true,
      }),
    ).toEqual([]);
    const first = ids[0];
    if (!first) throw new Error('fixture missing');
    await repo.updateStatus(input.tenantId, first, input.actor, 'archived');
    expect(
      await repo.listForActor(input.tenantId, input.actor, {
        scope: 'personal',
        status: 'archived',
      }),
    ).toHaveLength(1);
  }, 90_000);
  it('never acknowledges COMMIT that PostgreSQL converted to ROLLBACK', async () => {
    await expect(
      withTenantContext(runtime, crypto.randomUUID(), async (client) => {
        await client.query('SELECT 1 / 0').catch(() => undefined);
        return 'must not acknowledge';
      }),
    ).rejects.toThrow();
    expect((await runtime.query('SELECT 1 AS alive')).rows[0].alive).toBe(1);
  });

  it('persists a created draft despite an optional activity SQL failure and replays its ID', async () => {
    const input = await inputForTeacher();
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const faulty = new PgProjectRepository(activityFailurePool(runtime));
      const result = await faulty.createWithDraft(input);
      expect(result.kind).toBe('created');
      if (result.kind !== 'created') throw new Error('creation failed');
      const reader = new PgProjectRepository(runtime);
      const saved = await reader.load(input.tenantId, result.project.id, input.actor);
      expect(saved?.draft.document).toEqual(input.initialDocument);
      const replay = await faulty.createWithDraft(input);
      expect(replay.kind).toBe('existing');
      if (replay.kind !== 'existing') throw new Error('replay failed');
      expect(replay.project.id).toBe(result.project.id);
      expect(warning).toHaveBeenCalled();
    } finally {
      warning.mockRestore();
    }
  });

  it('persists a saved revision and prevents a stale overwrite after an activity failure', async () => {
    const input = await inputForTeacher();
    const reader = new PgProjectRepository(runtime);
    const created = await reader.createWithDraft(input);
    if (created.kind !== 'created') throw new Error('fixture creation failed');
    const opened = await reader.load(input.tenantId, created.project.id, input.actor);
    if (!opened) throw new Error('fixture missing');
    const document = { ...(input.initialDocument as object), testChange: true };
    const mutation = {
      tenantId: input.tenantId,
      actor: input.actor,
      projectId: created.project.id,
      document,
      preview: null,
      baseRevision: opened.draft.revision,
      mutationId: crypto.randomUUID(),
    };
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const faulty = new PgProjectRepository(activityFailurePool(runtime));
      const saved = await faulty.saveDraft(mutation);
      expect(saved?.revision).toBe(opened.draft.revision + 1);
      expect(
        (await reader.load(input.tenantId, created.project.id, input.actor))?.draft.document,
      ).toEqual(document);
      expect((await faulty.saveDraft(mutation))?.revision).toBe(saved?.revision);
      expect(
        await faulty.saveDraft({ ...mutation, mutationId: crypto.randomUUID(), document: {} }),
      ).toBeNull();
    } finally {
      warning.mockRestore();
    }
  });
});
