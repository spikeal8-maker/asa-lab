import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { seedTeacher, testAdminPool, testAppPool } from '../portal/helpers';

let admin: pg.Pool;
let app: pg.Pool;
let owner: { tenantId: string; principalId: string; accountId: string };
let other: typeof owner;
let serial = 0;
const policies = {
  attemptPolicy: null,
  resultSelectionPolicy: null,
  completionPolicy: null,
  latePolicy: null,
  assessmentPolicy: null,
  feedbackReleasePolicy: null,
};
beforeAll(async () => {
  admin = testAdminPool();
  app = testAppPool();
  const identities = await Promise.all(
    ['owner', 'other'].map(async (name) => {
      const teacher = await seedTeacher(admin, 'course-diagnostic-' + name);
      const result = await admin.query(
        'SELECT principal_id,account_id FROM legacy_user_account_links WHERE tenant_id=$1 AND user_id=$2',
        [teacher.tenantId, teacher.teacherId],
      );
      return {
        tenantId: teacher.tenantId,
        principalId: result.rows[0].principal_id as string,
        accountId: result.rows[0].account_id as string,
      };
    }),
  );
  [owner, other] = identities as [typeof owner, typeof other];
});
afterAll(async () => {
  await Promise.all([admin.end(), app.end()]);
});

async function fixture(run: (client: pg.PoolClient) => Promise<void>) {
  const client = await admin.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.tenant_id',$1,true)", [owner.tenantId]);
    await run(client);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}
async function restricted(client: pg.PoolClient, sql: string, values: unknown[] = []) {
  await client.query('SET LOCAL ROLE asalab_app');
  const result = await client.query(sql, values);
  await client.query('SET LOCAL ROLE NONE');
  return result;
}
async function practice(
  client: pg.PoolClient,
  kind = 'project',
  module: string | null = 'electronics',
) {
  const key = 'fix07:activity:' + ++serial;
  const made = await restricted(
    client,
    "SELECT * FROM learning_activity_create($1,$2,'school','private',$3,$4,$5,$6,NULL,$7::jsonb,$8,NULL,NULL,NULL,$9)",
    [
      owner.principalId,
      owner.tenantId,
      kind,
      key,
      'Точные инструкции',
      kind === 'manual' ? 'ungraded' : 'completion',
      JSON.stringify(policies),
      module,
      key,
    ],
  );
  expect(made.rows[0].result_code).toBe('ok');
  const id = made.rows[0].activity_id as string;
  const published = await restricted(
    client,
    'SELECT * FROM learning_activity_publish($1,$2,$3,1,$4)',
    [owner.principalId, owner.tenantId, id, key + ':publish'],
  );
  expect(published.rows[0].result_code).toBe('ok');
  return { id, versionId: published.rows[0].activity_version_id as string };
}
async function course(client: pg.PoolClient) {
  const key = 'fix07:course:' + ++serial;
  const made = await restricted(
    client,
    "SELECT * FROM course_save_v2($1,$2,NULL,$3,NULL,NULL,'private',NULL,$4)",
    [owner.principalId, owner.tenantId, 'Раздел → урок: не машинный путь', key],
  );
  expect(made.rows[0].result_code).toBe('ok');
  const id = made.rows[0].id as string;
  const outline = await restricted(
    client,
    'SELECT section_id FROM course_outline_v3($1,$2,$3,$4) LIMIT 1',
    [id, owner.principalId, owner.accountId, owner.tenantId],
  );
  return { id, sectionId: outline.rows[0].section_id as string };
}
async function lesson(
  client: pg.PoolClient,
  target: Awaited<ReturnType<typeof course>>,
  blocks: unknown[],
  legacyId: string | null = null,
  canonicalId: string | null = null,
) {
  const saved = await restricted(
    client,
    'SELECT course_lesson_save_v3($1,$2,$3,NULL,$4,NULL,$5::jsonb,$6,$7,10,$8) AS id',
    [
      owner.principalId,
      target.id,
      target.sectionId,
      'Урок → ' + ++serial,
      JSON.stringify(blocks),
      legacyId || canonicalId ? 'assignment' : 'material',
      legacyId,
      canonicalId,
    ],
  );
  expect(saved.rows[0].id).toBeTruthy();
  return saved.rows[0].id as string;
}
async function revision(client: pg.PoolClient, id: string) {
  return Number(
    (
      await restricted(client, 'SELECT course_draft_revision($1,$2) AS revision', [
        owner.principalId,
        id,
      ])
    ).rows[0].revision,
  );
}
async function publish(
  client: pg.PoolClient,
  id: string,
  expected: number,
  key: string,
  principal = owner.principalId,
) {
  return (
    await restricted(client, 'SELECT * FROM course_publish_v4($1,$2,$3,$4)', [
      principal,
      id,
      expected,
      key,
    ])
  ).rows[0];
}
const textBlock = { id: 'before', type: 'paragraph', text: 'Первый блок остаётся без изменений' };

describe('exact course prepublication diagnostics under the restricted app role', () => {
  it('locates an unavailable second practice without changing history and preserves an exact completed replay', async () =>
    fixture(async (client) => {
      const pin = await practice(client);
      const target = await course(client);
      const id = await lesson(client, target, [
        textBlock,
        { id: 'second-practice', type: 'activity', learningActivityVersionId: pin.versionId },
      ]);
      const expected = await revision(client, target.id);
      const key = 'fix07:replay:' + serial;
      const accepted = await publish(client, target.id, expected, key);
      expect(accepted).toMatchObject({ result_code: 'ok', version_number: 1, reused: false });
      const before = await client.query(
        'SELECT id,version_number,outline,content_hash,published_at FROM course_versions WHERE course_id=$1',
        [target.id],
      );
      await client.query('UPDATE learning_activities SET archived_at=now() WHERE id=$1', [pin.id]);
      const denied = await publish(
        client,
        target.id,
        await revision(client, target.id),
        key + ':new',
      );
      expect(denied).toMatchObject({
        result_code: 'prepublish_invalid',
        problem_section_id: target.sectionId,
        problem_lesson_id: id,
        problem_block_id: 'second-practice',
        problem_field: 'learningActivityVersionId',
        problem_reason: 'pin_unavailable',
        version_id: null,
      });
      expect(denied.problem_path).toContain('блок 2');
      const replay = await publish(client, target.id, expected, key);
      expect(replay).toEqual({ ...accepted, reused: true });
      expect((await publish(client, target.id, expected + 1, key)).result_code).toBe(
        'idempotency_conflict',
      );
      expect(
        (
          await client.query(
            'SELECT id,version_number,outline,content_hash,published_at FROM course_versions WHERE course_id=$1',
            [target.id],
          )
        ).rows,
      ).toEqual(before.rows);
      expect(
        Number(
          (
            await client.query(
              "SELECT count(*) FROM audit_events WHERE entity_id=$1 AND action='course.publication.confirmed'",
              [target.id],
            )
          ).rows[0].count,
        ),
      ).toBe(1);
    }));

  it('identifies the disabled module of the second block without changing global module state outside its transaction', async () =>
    fixture(async (client) => {
      const module = 'fix07-future';
      await client.query(
        "INSERT INTO module_learning_capabilities(module_key,creatable,assignable,editable_evidence,submit_project_version,preview) VALUES($1,true,true,true,true,'snapshot')",
        [module],
      );
      const pin = await practice(client, 'project', module);
      const target = await course(client);
      const id = await lesson(client, target, [
        textBlock,
        { id: 'second-module', type: 'activity', learningActivityVersionId: pin.versionId },
      ]);
      await client.query(
        'UPDATE module_learning_capabilities SET assignable=false WHERE module_key=$1',
        [module],
      );
      expect(
        await publish(
          client,
          target.id,
          await revision(client, target.id),
          'fix07:module:' + serial,
        ),
      ).toMatchObject({
        result_code: 'prepublish_invalid',
        problem_section_id: target.sectionId,
        problem_lesson_id: id,
        problem_block_id: 'second-module',
        problem_field: 'learningActivityVersionId',
        problem_reason: 'module_unavailable',
      });
    }));

  it('locates an unavailable second manual pin and gives outsiders no course or block metadata', async () =>
    fixture(async (client) => {
      const pin = await practice(client, 'manual', null);
      const target = await course(client);
      const id = await lesson(client, target, [
        textBlock,
        { id: 'second-manual', type: 'manual-material', learningActivityVersionId: pin.versionId },
      ]);
      await client.query('UPDATE learning_activities SET archived_at=now() WHERE id=$1', [pin.id]);
      const expected = await revision(client, target.id);
      expect(await publish(client, target.id, expected, 'fix07:manual:' + serial)).toMatchObject({
        result_code: 'prepublish_invalid',
        problem_section_id: target.sectionId,
        problem_lesson_id: id,
        problem_block_id: 'second-manual',
        problem_field: 'learningActivityVersionId',
        problem_reason: 'pin_unavailable',
      });
      const denied = await publish(
        client,
        target.id,
        expected,
        'fix07:foreign:' + serial,
        other.principalId,
      );
      const missing = await publish(
        client,
        '11111111-1111-4111-8111-111111111111',
        expected,
        'fix07:missing:' + serial,
        other.principalId,
      );
      expect(denied).toEqual(missing);
      expect(denied.result_code).toBe('course_not_found');
      expect(
        Object.entries(denied)
          .filter(([name]) => name.startsWith('problem_'))
          .every(([, value]) => value === null),
      ).toBe(true);
    }));

  it('does not blame a valid lesson-level practice for its unavailable second manual block', async () =>
    fixture(async (client) => {
      const assignment = await practice(client);
      const manual = await practice(client, 'manual', null);
      const target = await course(client);
      const id = await lesson(
        client,
        target,
        [
          textBlock,
          {
            id: 'second-manual',
            type: 'manual-material',
            learningActivityVersionId: manual.versionId,
          },
        ],
        null,
        assignment.versionId,
      );
      await client.query('UPDATE learning_activities SET archived_at=now() WHERE id=$1', [
        manual.id,
      ]);
      expect(
        await publish(
          client,
          target.id,
          await revision(client, target.id),
          'fix07:mixed:' + serial,
        ),
      ).toMatchObject({
        result_code: 'prepublish_invalid',
        problem_lesson_id: id,
        problem_block_id: 'second-manual',
        problem_field: 'learningActivityVersionId',
        problem_reason: 'pin_unavailable',
      });
    }));

  it('points empty content and an existing legacy assignment at their actual correction control', async () =>
    fixture(async (client) => {
      const empty = await course(client);
      const emptyId = await lesson(client, empty, []);
      expect(
        await publish(client, empty.id, await revision(client, empty.id), 'fix07:empty:' + serial),
      ).toMatchObject({
        result_code: 'prepublish_invalid',
        problem_section_id: empty.sectionId,
        problem_lesson_id: emptyId,
        problem_block_id: null,
        problem_field: 'blocks',
        problem_reason: 'content_required',
      });
      const old = await client.query(
        "INSERT INTO teacher_assignments(tenant_id,owner_principal_id,title,brief,module_key,visibility) VALUES($1,$2,'Старый банк','Не преобразовывать молча','electronics','private') RETURNING id",
        [owner.tenantId, owner.principalId],
      );
      const legacy = await course(client);
      const legacyId = await lesson(client, legacy, [], old.rows[0].id);
      expect(
        await publish(
          client,
          legacy.id,
          await revision(client, legacy.id),
          'fix07:legacy:' + serial,
        ),
      ).toMatchObject({
        result_code: 'prepublish_invalid',
        problem_section_id: legacy.sectionId,
        problem_lesson_id: legacyId,
        problem_block_id: null,
        problem_field: 'learningActivityVersionId',
        problem_reason: 'legacy_assignment',
      });
    }));

  it('authorizes before replay and preserves archived course receipts without allowing new publication', async () =>
    fixture(async (client) => {
      const target = await course(client);
      await lesson(client, target, [textBlock]);
      const expected = await revision(client, target.id);
      const key = 'fix07:authorization:' + serial;
      const accepted = await publish(client, target.id, expected, key);
      expect(accepted.result_code).toBe('ok');
      const archived = await restricted(client, 'SELECT * FROM course_archive_set($1,$2,true,$3)', [
        owner.principalId,
        target.id,
        await revision(client, target.id),
      ]);
      expect(archived.rows[0].result_code).toBe('ok');
      expect(await publish(client, target.id, expected, key)).toEqual({
        ...accepted,
        reused: true,
      });
      expect(
        await publish(client, target.id, await revision(client, target.id), key + ':new'),
      ).toMatchObject({
        result_code: 'prepublish_invalid',
        problem_field: 'archivedAt',
        problem_reason: 'course_archived',
        problem_section_id: null,
        problem_lesson_id: null,
        problem_block_id: null,
      });
      await client.query(
        "UPDATE capability_grants SET state='revoked' WHERE account_id=$1 AND capability IN ('content_author','educator')",
        [owner.accountId],
      );
      const revoked = await publish(client, target.id, expected, key);
      expect(revoked.result_code).toBe('course_not_found');
      expect(revoked.version_id).toBeNull();
      expect(
        (
          await restricted(client, 'SELECT * FROM course_prepublication_validation_v2($1,$2)', [
            owner.principalId,
            target.id,
          ])
        ).rows[0].problem_path,
      ).toBeNull();
    }));

  it.each([
    [{ id: 'image-two', type: 'image', url: 'javascript:alert(1)', alt: '' }, 'url'],
    [{ id: 'file-two', type: 'file', url: '/assets/../private', label: 'Файл' }, 'url'],
    [{ id: 'file-two', type: 'file', url: 'https://example.test/a.pdf', label: '' }, 'label'],
    [{ id: 'heading-two', type: 'heading', text: '', level: 2 }, 'text'],
  ])(
    'maps invalid asset/content metadata to its precise field without fetching external URLs: %j',
    async (block, field) => {
      expect(
        (
          await app.query(
            'SELECT course_lesson_blocks_valid($1::jsonb) AS valid, course_block_problem_field($2::jsonb) AS field',
            [JSON.stringify([textBlock, block]), JSON.stringify(block)],
          )
        ).rows[0],
      ).toEqual({ valid: false, field });
    },
  );

  it('exposes only explicitly granted diagnostic and publish entrypoints to the runtime role', async () => {
    const result = await app.query(`SELECT current_user AS runtime_role,
      has_function_privilege('public.course_publish_v4(uuid,uuid,integer,varchar)'::regprocedure,'EXECUTE') AS publish,
      has_function_privilege('public.course_prepublication_validation_v2(uuid,uuid)'::regprocedure,'EXECUTE') AS diagnose,
      EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) acl
        WHERE p.oid IN ('public.course_publish_v4(uuid,uuid,integer,varchar)'::regprocedure,
                        'public.course_prepublication_validation_v2(uuid,uuid)'::regprocedure)
          AND acl.grantee=0 AND acl.privilege_type='EXECUTE') AS public_execute`);
    expect(result.rows[0]).toEqual({
      runtime_role: 'asalab_app',
      publish: true,
      diagnose: true,
      public_execute: false,
    });
  });
});
