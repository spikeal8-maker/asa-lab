import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { seedTeacher, testAdminPool, testAppPool, type SeededTeacher } from '../portal/helpers';

let admin: pg.Pool;
let app: pg.Pool;
let author: SeededTeacher;
let outsider: SeededTeacher;
let principalId: string;
let accountId: string;
let outsiderPrincipalId: string;
let sequence = 0;

const policies = {
  attemptPolicy: { maxAttempts: 2 },
  resultSelectionPolicy: { mode: 'latest' },
  completionPolicy: { mode: 'submission' },
  latePolicy: { mode: 'allow_mark_late' },
  assessmentPolicy: { mode: 'manual' },
  feedbackReleasePolicy: { mode: 'after_review' },
};

async function identityFor(teacher: SeededTeacher) {
  const result = await admin.query(
    'SELECT principal_id,account_id FROM legacy_user_account_links WHERE tenant_id=$1 AND user_id=$2',
    [teacher.tenantId, teacher.teacherId],
  );
  return result.rows[0] as { principal_id: string; account_id: string };
}
async function inTenant<T>(
  teacher: SeededTeacher,
  callback: (client: pg.PoolClient) => Promise<T>,
) {
  const client = await app.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.tenant_id',$1,true)", [teacher.tenantId]);
    const value = await callback(client);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function publishActivity(
  teacher: SeededTeacher,
  ownerPrincipalId: string,
  moduleKey: string,
) {
  sequence += 1;
  const created = await inTenant(teacher, (client) =>
    client.query(
      "SELECT * FROM learning_activity_create($1,$2,'school','private','project',$3,'D2 activity','completion',NULL,$4::jsonb,$5,NULL,NULL,NULL,$6)",
      [
        ownerPrincipalId,
        teacher.tenantId,
        `D2 activity ${sequence}`,
        JSON.stringify(policies),
        moduleKey,
        `d2:create:${sequence}`,
      ],
    ),
  );
  expect(created.rows[0].result_code).toBe('ok');
  const published = await inTenant(teacher, (client) =>
    client.query('SELECT * FROM learning_activity_publish($1,$2,$3,1,$4)', [
      ownerPrincipalId,
      teacher.tenantId,
      created.rows[0].activity_id,
      `d2:publish:${sequence}`,
    ]),
  );
  expect(published.rows[0].result_code).toBe('ok');
  return {
    activityId: created.rows[0].activity_id as string,
    versionId: published.rows[0].activity_version_id as string,
  };
}

async function newCourse(title: string) {
  sequence += 1;
  await admin.query(
    "INSERT INTO teacher_assignments(tenant_id,owner_principal_id,title,brief,module_key,visibility) VALUES($1,$2,$3,'anchor','electronics','private')",
    [author.tenantId, principalId, `${title} anchor ${sequence}`],
  );
  const created = await admin.query("SELECT course_save($1,NULL,$2,NULL,NULL,'private') AS id", [
    principalId,
    title,
  ]);
  const courseId = created.rows[0].id as string;
  const outline = await admin.query(
    'SELECT section_id FROM course_outline_v3($1,$2,$3,$4) LIMIT 1',
    [courseId, principalId, accountId, author.tenantId],
  );
  return { courseId, sectionId: outline.rows[0].section_id as string };
}

beforeAll(async () => {
  admin = testAdminPool();
  app = testAppPool();
  author = await seedTeacher(admin, 'course-activity-block-author');
  outsider = await seedTeacher(admin, 'course-activity-block-outsider');
  const authorIdentity = await identityFor(author);
  const outsiderIdentity = await identityFor(outsider);
  principalId = authorIdentity.principal_id;
  accountId = authorIdentity.account_id;
  outsiderPrincipalId = outsiderIdentity.principal_id;
});

afterAll(async () => {
  await Promise.all([admin.end(), app.end()]);
});

async function authorized(blocks: unknown[]) {
  const result = await admin.query(
    'SELECT course_activity_blocks_authorized($1,$2,$3::jsonb) AS ok',
    [principalId, author.tenantId, JSON.stringify(blocks)],
  );
  return result.rows[0].ok as boolean;
}

describe('E1-FIX-11D2 canonical Activity blocks', () => {
  it('accepts the Activity shape and rejects a malformed version UUID', async () => {
    const exact = await publishActivity(author, principalId, 'electronics');
    const valid = [
      { id: 'activity-a', type: 'activity', learningActivityVersionId: exact.versionId },
    ];
    const invalid = [
      { id: 'activity-b', type: 'activity', learningActivityVersionId: 'not-a-uuid' },
    ];
    expect(
      (
        await admin.query('SELECT course_lesson_blocks_valid($1::jsonb) AS valid', [
          JSON.stringify(valid),
        ])
      ).rows[0].valid,
    ).toBe(true);
    expect(
      (
        await admin.query('SELECT course_lesson_blocks_valid($1::jsonb) AS valid', [
          JSON.stringify(invalid),
        ])
      ).rows[0].valid,
    ).toBe(false);
  });

  it('accepts exact Electronics and 3D versions and rejects nonexistent, unsupported and foreign versions', async () => {
    const electronics = await publishActivity(author, principalId, 'electronics');
    const threeD = await publishActivity(author, principalId, 'three-d');
    const unsupported = await publishActivity(author, principalId, 'chess');
    const foreign = await publishActivity(outsider, outsiderPrincipalId, 'electronics');
    const missingVersionId = randomUUID();

    expect(
      await authorized([
        { id: 'electronics', type: 'activity', learningActivityVersionId: electronics.versionId },
        { id: 'three-d', type: 'activity', learningActivityVersionId: threeD.versionId },
      ]),
    ).toBe(true);
    expect(
      await authorized([
        { id: 'missing', type: 'activity', learningActivityVersionId: missingVersionId },
      ]),
    ).toBe(false);
    expect(
      await authorized([
        { id: 'unsupported', type: 'activity', learningActivityVersionId: unsupported.versionId },
      ]),
    ).toBe(false);
    expect(
      await authorized([
        { id: 'foreign', type: 'activity', learningActivityVersionId: foreign.versionId },
      ]),
    ).toBe(false);
    expect(
      await authorized([
        {
          id: 'hidden-unsupported',
          type: 'activity',
          learningActivityVersionId: unsupported.versionId,
          hidden: true,
        },
      ]),
    ).toBe(false);
  });

  it('validates hidden Activity blocks, stores the draft and freezes only the visible exact pin', async () => {
    const electronics = await publishActivity(author, principalId, 'electronics');
    const threeD = await publishActivity(author, principalId, 'three-d');
    const unsupported = await publishActivity(author, principalId, 'manual-lab');
    const { courseId, sectionId } = await newCourse('D2 activity blocks');
    const hiddenUnsupported = [
      {
        id: 'hidden-invalid',
        type: 'activity',
        learningActivityVersionId: unsupported.versionId,
        hidden: true,
      },
    ];
    await expect(
      admin.query(
        "SELECT course_lesson_save_v3($1,$2,$3,NULL,'Hidden invalid',NULL,$4::jsonb,'material',NULL,15,NULL)",
        [principalId, courseId, sectionId, JSON.stringify(hiddenUnsupported)],
      ),
    ).rejects.toThrow(/activity block exact version is unavailable/);

    const blocks = [
      {
        id: 'visible-activity',
        type: 'activity',
        learningActivityVersionId: electronics.versionId,
      },
      {
        id: 'hidden-activity',
        type: 'activity',
        learningActivityVersionId: threeD.versionId,
        hidden: true,
      },
    ];
    const saved = await admin.query(
      "SELECT course_lesson_save_v3($1,$2,$3,NULL,'Mixed Activity blocks',NULL,$4::jsonb,'material',NULL,15,NULL) AS id",
      [principalId, courseId, sectionId, JSON.stringify(blocks)],
    );
    const lessonId = saved.rows[0].id as string;
    expect(lessonId).toBeTruthy();
    const draft = await admin.query('SELECT blocks,content FROM course_lessons WHERE id=$1', [
      lessonId,
    ]);
    expect(draft.rows[0]).toEqual({ blocks, content: null });
    expect(
      (
        await admin.query('SELECT course_lesson_blocks_plain_text($1::jsonb) AS content', [
          JSON.stringify(blocks),
        ])
      ).rows[0].content,
    ).toBeNull();

    const revision = Number(
      (await admin.query('SELECT draft_revision FROM courses WHERE id=$1', [courseId])).rows[0]
        .draft_revision,
    );
    const published = await admin.query('SELECT * FROM course_publish_v3($1,$2,$3,$4)', [
      principalId,
      courseId,
      revision,
      `d2:course:publish:${++sequence}`,
    ]);
    expect(published.rows[0]).toMatchObject({ result_code: 'ok', version_number: 1 });

    const frozen = await admin.query(
      `SELECT outline ->> 'schemaVersion' AS schema_version,
              outline #> '{sections,0,lessons,0,blocks}' AS blocks
         FROM course_versions WHERE id=$1`,
      [published.rows[0].version_id],
    );
    expect(frozen.rows[0]).toEqual({
      schema_version: '3',
      blocks: [
        {
          id: 'visible-activity',
          type: 'activity',
          learningActivityVersionId: electronics.versionId,
        },
      ],
    });
  });

  it('preserves the legacy lesson-level exact LearningActivityVersion pin', async () => {
    const electronics = await publishActivity(author, principalId, 'electronics');
    const { courseId, sectionId } = await newCourse('D2 legacy lesson pin');
    const saved = await admin.query(
      "SELECT course_lesson_save_v3($1,$2,$3,NULL,'Legacy exact pin',NULL,'[]'::jsonb,'assignment',NULL,20,$4) AS id",
      [principalId, courseId, sectionId, electronics.versionId],
    );
    const lessonId = saved.rows[0].id as string;
    expect(lessonId).toBeTruthy();
    expect(
      (
        await admin.query('SELECT learning_activity_version_id FROM course_lessons WHERE id=$1', [
          lessonId,
        ])
      ).rows[0].learning_activity_version_id,
    ).toBe(electronics.versionId);

    const revision = Number(
      (await admin.query('SELECT draft_revision FROM courses WHERE id=$1', [courseId])).rows[0]
        .draft_revision,
    );
    const published = await admin.query('SELECT * FROM course_publish_v3($1,$2,$3,$4)', [
      principalId,
      courseId,
      revision,
      `d2:legacy:publish:${++sequence}`,
    ]);
    expect(published.rows[0].result_code).toBe('ok');
    const frozen = await admin.query(
      `SELECT outline #>> '{sections,0,lessons,0,learningActivityVersionId}' AS version_id
         FROM course_versions WHERE id=$1`,
      [published.rows[0].version_id],
    );
    expect(frozen.rows[0].version_id).toBe(electronics.versionId);
  });
});