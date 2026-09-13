import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { seedTeacher, testAdminPool, testAppPool, type SeededTeacher } from '../portal/helpers';

let admin: pg.Pool,
  app: pg.Pool,
  teacher: SeededTeacher,
  principal: string,
  account: string,
  foreign: string;
let sequence = 0;
const policies = {
  attemptPolicy: { maxAttempts: 3 },
  resultSelectionPolicy: { mode: 'latest_accepted' },
  completionPolicy: { mode: 'accepted' },
  latePolicy: { mode: 'allow_until_close' },
  assessmentPolicy: { mode: 'manual' },
  feedbackReleasePolicy: { mode: 'immediate' },
};
beforeAll(async () => {
  admin = testAdminPool();
  app = testAppPool();
  teacher = await seedTeacher(admin, 'draft-version-owner');
  const other = await seedTeacher(admin, 'draft-version-foreign');
  const who = (
    await admin.query(
      'SELECT principal_id,account_id FROM legacy_user_account_links WHERE tenant_id=$1 AND user_id=$2',
      [teacher.tenantId, teacher.teacherId],
    )
  ).rows[0];
  principal = who.principal_id;
  account = who.account_id;
  foreign = (
    await admin.query(
      'SELECT principal_id FROM legacy_user_account_links WHERE tenant_id=$1 AND user_id=$2',
      [other.tenantId, other.teacherId],
    )
  ).rows[0].principal_id;
});
afterAll(async () => {
  await Promise.all([admin.end(), app.end()]);
});
async function state(id: string) {
  return (await admin.query('SELECT * FROM courses WHERE id=$1', [id])).rows[0];
}
async function publish(id: string) {
  const s = await state(id);
  const r = (
    await app.query('SELECT * FROM course_publish_v2($1,$2,$3,$4)', [
      principal,
      id,
      s.draft_revision,
      'draft:publish:' + ++sequence,
    ])
  ).rows[0];
  expect(r.result_code).toBe('ok');
  return r;
}
async function restore(id: string, version: string, actor = principal) {
  return (
    await app.query('SELECT * FROM course_draft_from_version($1,$2,$3,$4)', [
      actor,
      id,
      version,
      (await state(id)).draft_revision,
    ])
  ).rows[0];
}
async function title(id: string, value: string) {
  const r = (
    await app.query("SELECT * FROM course_save_v2($1,$2,$3,$4,NULL,NULL,'private',$5,$6)", [
      principal,
      teacher.tenantId,
      id,
      value,
      (await state(id)).draft_revision,
      'draft:edit:' + ++sequence,
    ])
  ).rows[0];
  expect(r.result_code).toBe('ok');
}
async function course() {
  const id = (
    await app.query(
      "SELECT * FROM course_save_v2($1,$2,NULL,'Original course',NULL,NULL,'private',NULL,$3)",
      [principal, teacher.tenantId, 'draft:create:' + ++sequence],
    )
  ).rows[0].id as string;
  const section = (
    await app.query('SELECT * FROM course_outline_v3($1,$2,$3,$4)', [
      id,
      principal,
      account,
      teacher.tenantId,
    ])
  ).rows[0].section_id;
  const material = (
    await app.query(
      "SELECT * FROM learning_activity_create($1,$2,'school','private','project','Pinned material','Exact instructions','graded',12,$3::jsonb,'electronics',NULL,NULL,NULL,$4)",
      [principal, teacher.tenantId, JSON.stringify(policies), 'draft:material:' + ++sequence],
    )
  ).rows[0].activity_id;
  const pin = (
    await app.query('SELECT * FROM learning_activity_publish($1,$2,$3,1,$4)', [
      principal,
      teacher.tenantId,
      material,
      'draft:material:publish:' + ++sequence,
    ])
  ).rows[0].activity_version_id;
  await app.query(
    "SELECT course_lesson_save_v3($1,$2,$3,NULL,'Pinned lesson','Lesson summary',$4::jsonb,'assignment',NULL,17,$5)",
    [
      principal,
      id,
      section,
      JSON.stringify([{ id: 'paragraph-1', type: 'paragraph', text: 'Exact V1 block' }]),
      pin,
    ],
  );
  const v1 = await publish(id);
  return { id, v1, material, pin };
}
async function history(id: string) {
  return (
    await admin.query(
      'SELECT row_to_json(v)::text AS bytes FROM course_versions v WHERE course_id=$1 ORDER BY version_number',
      [id],
    )
  ).rows;
}
async function runtime() {
  const result: Record<string, unknown> = {};
  for (const table of [
    'classroom_course_runs',
    'classroom_course_run_lessons',
    'course_enrollments',
    'activity_runs',
    'activity_participations',
    'learning_attempts',
    'learning_submissions',
    'assessment_results',
    'gradebook_entries',
  ]) {
    result[table] = (
      await admin.query(
        'SELECT row_to_json(t)::text AS bytes FROM ' +
          table +
          ' t WHERE tenant_id=$1 ORDER BY row_to_json(t)::text',
        [teacher.tenantId],
      )
    ).rows;
  }
  return result;
}
describe('explicit author draft from one immutable publication', () => {
  it('protects a blocks-only edit whose plain text has not changed', async () => {
    const { id } = await course();
    const section = (
      await app.query('SELECT * FROM course_outline_v3($1,$2,$3,$4)', [
        id,
        principal,
        account,
        teacher.tenantId,
      ])
    ).rows[0].section_id;
    const blocks = (url: string) =>
      JSON.stringify([
        url.endsWith('a.png')
          ? { id: 'same-block', type: 'paragraph', text: 'Same text' }
          : { id: 'same-block', type: 'heading', level: 2, text: 'Same text' },
      ]);
    const lesson = (
      await app.query(
        "SELECT course_lesson_save_v3($1,$2,$3,NULL,'Diagram',NULL,$4::jsonb,'material',NULL,NULL,NULL) AS id",
        [principal, id, section, blocks('https://example.com/a.png')],
      )
    ).rows[0].id;
    const version = await publish(id);
    expect((await state(id)).draft_active).toBe(false);
    await app.query(
      "SELECT course_lesson_save_v3($1,$2,$3,$4,'Diagram',NULL,$5::jsonb,'material',NULL,NULL,NULL)",
      [principal, id, section, lesson, blocks('https://example.com/b.png')],
    );
    expect((await state(id)).draft_active).toBe(true);
    expect((await restore(id, version.version_id)).result_code).toBe('draft_exists');
    expect(
      (await admin.query('SELECT blocks FROM course_lessons WHERE id=$1', [lesson])).rows[0]
        .blocks[0].type,
    ).toBe('heading');
  });
  it('restores legacy assignment index and refuses changed mutable legacy content without any partial write', async () => {
    const { id } = await course();
    const assignment = (
      await admin.query(
        "INSERT INTO teacher_assignments(tenant_id,owner_principal_id,title,brief,module_key,visibility) VALUES($1,$2,'Legacy task','Original brief','electronics','private') RETURNING id",
        [teacher.tenantId, principal],
      )
    ).rows[0].id;
    const section = (
      await app.query('SELECT * FROM course_outline_v3($1,$2,$3,$4)', [
        id,
        principal,
        account,
        teacher.tenantId,
      ])
    ).rows[0].section_id;
    await app.query(
      "SELECT course_lesson_save_v3($1,$2,$3,NULL,'Legacy lesson',NULL,'[]'::jsonb,'assignment',$4,12,NULL)",
      [principal, id, section, assignment],
    );
    const v2 = await publish(id);
    const index = (
      await admin.query(
        'SELECT assignment_id,position FROM course_items WHERE course_id=$1 ORDER BY position',
        [id],
      )
    ).rows;
    await title(id, 'Third');
    await publish(id);
    expect((await restore(id, v2.version_id)).result_code).toBe('ok');
    expect(
      (
        await admin.query(
          'SELECT assignment_id,position FROM course_items WHERE course_id=$1 ORDER BY position',
          [id],
        )
      ).rows,
    ).toEqual(index);
    const historicalDraft = await state(id);
    const oldHistory = await history(id);
    const records = await runtime();
    expect(
      (
        await app.query('SELECT teacher_assignment_sample_set($1,$2,$3,$4) AS saved', [
          principal,
          assignment,
          Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2ioAAAAASUVORK5CYII=',
            'base64',
          ),
          'image/png',
        ])
      ).rows[0].saved,
    ).toBe(true);
    expect(await state(id)).toMatchObject({
      draft_active: true,
      draft_revision: historicalDraft.draft_revision + 1,
      draft_base_version_id: v2.version_id,
      draft_started_revision: historicalDraft.draft_started_revision,
    });
    const withSample = await state(id);
    await admin.query(
      "UPDATE teacher_assignments SET sample_image='/ignored-with-bytes' WHERE id=$1",
      [assignment],
    );
    expect(await state(id)).toEqual(withSample);
    await app.query('SELECT teacher_assignment_sample_set($1,$2,NULL,NULL)', [
      principal,
      assignment,
    ]);
    expect(await history(id)).toEqual(oldHistory);
    expect(await runtime()).toEqual(records);
    const latest = await publish(id);
    const closed = await state(id);
    await admin.query("UPDATE teacher_assignments SET visibility='public' WHERE id=$1", [
      assignment,
    ]);
    expect(await state(id)).toEqual(closed);
    expect(
      (
        await app.query(
          "SELECT teacher_assignment_save($1,$2,'Legacy task','Changed independently','electronics') AS id",
          [principal, assignment],
        )
      ).rows[0].id,
    ).toBe(assignment);
    expect(await state(id)).toMatchObject({
      draft_active: true,
      draft_revision: closed.draft_revision + 1,
      draft_base_version_id: latest.version_id,
      draft_started_revision: closed.draft_revision + 1,
    });
    expect(
      (
        await app.query('SELECT publication_state FROM course_library_list_v2($1) WHERE id=$2', [
          principal,
          id,
        ])
      ).rows[0].publication_state,
    ).toBe('changed');
    expect((await restore(id, v2.version_id)).result_code).toBe('draft_exists');
    await publish(id);
    const before = await state(id);
    const content = (await admin.query('SELECT course_snapshot_build($1) AS snapshot', [id]))
      .rows[0].snapshot;
    expect(await restore(id, v2.version_id)).toMatchObject({
      result_code: 'source_not_restorable',
      draft_revision: before.draft_revision,
    });
    expect(await state(id)).toEqual(before);
    expect(
      (await admin.query('SELECT course_snapshot_build($1) AS snapshot', [id])).rows[0].snapshot,
    ).toEqual(content);
    expect(await runtime()).toEqual(records);
  });
  it('distinguishes an identical active draft, rejects retries and concurrent creation, closes latest dedup and retains provenance', async () => {
    const { id, v1 } = await course();
    expect(await state(id)).toMatchObject({
      draft_active: false,
      draft_base_version_id: null,
      draft_started_revision: null,
    });
    const revision = (await state(id)).draft_revision;
    const results = await Promise.all(
      [1, 2].map(() =>
        app.query('SELECT * FROM course_draft_from_version($1,$2,$3,$4)', [
          principal,
          id,
          v1.version_id,
          revision,
        ]),
      ),
    );
    expect(results.map((r) => r.rows[0].result_code).sort()).toEqual(['draft_exists', 'ok']);
    const before = await state(id);
    expect(before).toMatchObject({
      draft_active: true,
      draft_base_version_id: v1.version_id,
      draft_started_revision: revision + 1,
    });
    const source = (
      await admin.query('SELECT outline FROM course_versions WHERE id=$1', [v1.version_id])
    ).rows[0].outline;
    expect(
      (await admin.query('SELECT course_snapshot_build($1) AS snapshot', [id])).rows[0].snapshot,
    ).toEqual(source);
    expect((await restore(id, v1.version_id)).result_code).toBe('draft_exists');
    expect(await state(id)).toEqual(before);
    const dedup = await publish(id);
    expect(dedup).toMatchObject({ version_id: v1.version_id, version_number: 1, reused: true });
    expect(await state(id)).toMatchObject({
      draft_active: false,
      draft_base_version_id: null,
      draft_started_revision: null,
    });
    expect((await history(id)).length).toBe(1);
    expect(
      (
        await admin.query(
          "SELECT payload_json FROM audit_events WHERE entity_id=$1 AND action='course.draft.published'",
          [id],
        )
      ).rows[0].payload_json.sourceVersionId,
    ).toBe(v1.version_id);
  });
  it.each([false, true])(
    'restores historical V1, publishes V4 (edit=%s), preserves all versions and a real V1 run without runtime writes',
    async (edit) => {
      const { id, v1 } = await course();
      const classId = (
        await admin.query(
          "INSERT INTO classrooms(tenant_id,school_id,academic_period_id,title,created_by) VALUES($1,$2,$3,'Pinned class',$4) RETURNING id",
          [teacher.tenantId, teacher.schoolId, teacher.periodId, teacher.teacherId],
        )
      ).rows[0].id;
      await admin.query(
        "INSERT INTO classroom_memberships(tenant_id,classroom_id,user_id,account_id,member_role) VALUES($1,$2,$3,$4,'owner')",
        [teacher.tenantId, classId, teacher.teacherId, account],
      );
      const run = (
        await app.query(
          "SELECT * FROM classroom_course_run_assign_v3($1,$2,$3,NULL,1,'whole_class',NULL,$4)",
          [principal, classId, id, 'draft:run:' + ++sequence],
        )
      ).rows[0];
      expect(run.result_code).toBe('ok');
      await title(id, 'V2');
      expect((await publish(id)).version_number).toBe(2);
      await title(id, 'V3');
      expect((await publish(id)).version_number).toBe(3);
      const old = await history(id),
        records = await runtime();
      expect((await restore(id, v1.version_id)).result_code).toBe('ok');
      expect((await state(id)).title).toBe('Original course');
      if (edit) await title(id, 'Restored and edited V1');
      expect((await publish(id)).version_number).toBe(4);
      expect((await history(id)).slice(0, 3)).toEqual(old);
      expect(await runtime()).toEqual(records);
      expect(
        (
          await admin.query('SELECT course_version_id FROM classroom_course_runs WHERE id=$1', [
            run.run_id,
          ])
        ).rows[0].course_version_id,
      ).toBe(v1.version_id);
    },
  );
  it('denies a foreign author even for a public course, rejects another root version and protects an implicitly edited draft', async () => {
    const a = await course(),
      b = await course();
    await admin.query("UPDATE courses SET visibility='public' WHERE id=$1", [a.id]);
    const before = await state(a.id);
    expect((await restore(a.id, a.v1.version_id, foreign)).result_code).toBe('course_not_found');
    expect((await restore(a.id, b.v1.version_id)).result_code).toBe('version_not_found');
    expect(await state(a.id)).toEqual(before);
    await title(a.id, 'Unsaved publication');
    expect((await state(a.id)).draft_active).toBe(true);
    expect((await restore(a.id, a.v1.version_id)).result_code).toBe('draft_exists');
    expect((await state(a.id)).title).toBe('Unsaved publication');
  });
  it('restores activity policy/content exactly, protects drafts and author permission, publishes root-next V4 without runtime writes', async () => {
    const { material: id, pin: v1 } = await course();
    const pub = async (revision: number) =>
      (
        await app.query('SELECT * FROM learning_activity_publish($1,$2,$3,$4,$5)', [
          principal,
          teacher.tenantId,
          id,
          revision,
          'draft:actpub:' + ++sequence,
        ])
      ).rows[0];
    const put = async (revision: number, label: string) => {
      expect(
        (
          await app.query(
            "SELECT * FROM learning_activity_draft_put($1,$2,$3,$4,$5,'New content','graded',20,$6::jsonb,'electronics',NULL,NULL)",
            [principal, teacher.tenantId, id, revision, label, JSON.stringify(policies)],
          )
        ).rows[0].result_code,
      ).toBe('ok');
    };
    await put(1, 'V2');
    expect((await pub(2)).version_number).toBe(2);
    await put(2, 'V3');
    expect((await pub(3)).version_number).toBe(3);
    const records = await runtime();
    const old = (
      await admin.query(
        'SELECT row_to_json(v)::text AS bytes FROM learning_activity_versions v WHERE activity_id=$1 ORDER BY version_number',
        [id],
      )
    ).rows;
    const restoreActivity = (actor: string, revision: number) =>
      app.query('SELECT * FROM learning_activity_draft_from_version($1,$2,$3,$4,$5)', [
        actor,
        teacher.tenantId,
        id,
        v1,
        revision,
      ]);
    expect((await restoreActivity(foreign, 3)).rows[0].result_code).toBe('activity_not_found');
    expect((await restoreActivity(principal, 3)).rows[0].result_code).toBe('ok');
    expect((await restoreActivity(principal, 4)).rows[0].result_code).toBe('draft_exists');
    const restored = (
      await admin.query(
        'SELECT draft_payload,draft_base_version_id FROM learning_activities WHERE id=$1',
        [id],
      )
    ).rows[0];
    expect(restored).toMatchObject({
      draft_base_version_id: v1,
      draft_payload: {
        title: 'Pinned material',
        instructions: 'Exact instructions',
        resultMode: 'graded',
        maxPoints: 12,
        policies,
      },
    });
    const v4 = await pub(4);
    expect(v4.version_number).toBe(4);
    expect(
      (
        await admin.query('SELECT provenance FROM learning_activity_versions WHERE id=$1', [
          v4.activity_version_id,
        ])
      ).rows[0].provenance.sourceVersionId,
    ).toBe(v1);
    expect(
      (
        await admin.query(
          'SELECT row_to_json(v)::text AS bytes FROM learning_activity_versions v WHERE activity_id=$1 ORDER BY version_number',
          [id],
        )
      ).rows.slice(0, 3),
    ).toEqual(old);
    expect(await runtime()).toEqual(records);
  });
});
