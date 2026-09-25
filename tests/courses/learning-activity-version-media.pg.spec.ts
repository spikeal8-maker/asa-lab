import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { seedTeacher, testAdminPool, testAppPool, type SeededTeacher } from '../portal/helpers';

let admin: pg.Pool;
let app: pg.Pool;
let owner: SeededTeacher;
let ownerPrincipalId: string;
let foreignPrincipalId: string;
let requestSequence = 0;

const policies = {
  attemptPolicy: { maxAttempts: 1 },
  resultSelectionPolicy: { mode: 'latest_accepted' },
  completionPolicy: { mode: 'accepted' },
  latePolicy: { mode: 'allow_until_close' },
  assessmentPolicy: { mode: 'manual' },
  feedbackReleasePolicy: { mode: 'immediate' },
};

async function createActivity(title: string) {
  const created = await admin.query(
    `SELECT * FROM learning_activity_create(
       $1,$2,'school','private','project',$3,'Build the shown circuit',
       'completion',NULL,$4::jsonb,'electronics',NULL,NULL,NULL,$5
     )`,
    [
      ownerPrincipalId,
      owner.tenantId,
      title,
      JSON.stringify(policies),
      `ux1a2:create:${++requestSequence}:0001`,
    ],
  );
  expect(created.rows[0]).toMatchObject({ result_code: 'ok', draft_revision: 1 });
  return created.rows[0].activity_id as string;
}

async function publish(activityId: string, revision: number, requestId: string) {
  const result = await admin.query(`SELECT * FROM learning_activity_publish($1,$2,$3,$4,$5)`, [
    ownerPrincipalId,
    owner.tenantId,
    activityId,
    revision,
    requestId,
  ]);
  return result.rows[0] as {
    result_code: string;
    activity_version_id: string | null;
    version_number: number | null;
    content_digest: string | null;
    reused: boolean;
  };
}

beforeAll(async () => {
  admin = testAdminPool();
  app = testAppPool();
  owner = await seedTeacher(admin, 'ux1a2-version-media-owner');

  const identity = await admin.query(
    `SELECT principal_id,account_id
       FROM legacy_user_account_links
      WHERE tenant_id=$1 AND user_id=$2`,
    [owner.tenantId, owner.teacherId],
  );
  ownerPrincipalId = identity.rows[0].principal_id as string;

  const workspace = await admin.query(
    `SELECT id AS workspace_id
       FROM workspaces
      WHERE tenant_id=$1 AND kind='organization'
      ORDER BY created_at
      LIMIT 1`,
    [owner.tenantId],
  );
  const foreignAccount = await admin.query(
    `INSERT INTO accounts (email,password_hash,birth_date,country)
     VALUES ('ux1a2-foreign-' || gen_random_uuid()::text || '@test.local',
             'isolated-test-only',DATE '1990-01-01','RU')
     RETURNING id`,
  );
  const foreignPrincipal = await admin.query(
    `INSERT INTO principals (kind,account_id)
     VALUES ('account',$1)
     RETURNING id`,
    [foreignAccount.rows[0].id],
  );
  foreignPrincipalId = foreignPrincipal.rows[0].id as string;
  await admin.query(
    `INSERT INTO capability_grants
       (account_id,capability,state,policy_version,granted_by)
     VALUES ($1,'educator','verified','ux1a2-test','server')`,
    [foreignAccount.rows[0].id],
  );
  await admin.query(
    `INSERT INTO workspace_memberships (account_id,workspace_id,role)
     VALUES ($1,$2,'educator')`,
    [foreignAccount.rows[0].id, workspace.rows[0].workspace_id],
  );
});

afterAll(async () => {
  await Promise.all([admin.end(), app.end()]);
});

describe('UX1A2 immutable LearningActivityVersion sample', () => {
  it('publishes A to v1, keeps it while draft becomes B, then publishes B to v2', async () => {
    const beforeLegacy = await admin.query(
      'SELECT count(*)::integer AS count FROM teacher_assignments WHERE tenant_id=$1',
      [owner.tenantId],
    );
    const activityId = await createActivity('Published image A/B');
    const imageA = Buffer.from('published-image-A');
    const imageB = Buffer.from('published-image-B');

    const uploadA = await admin.query(
      `SELECT * FROM learning_activity_draft_sample_set($1,$2,$3,1,$4,'image/png')`,
      [ownerPrincipalId, owner.tenantId, activityId, imageA],
    );
    expect(uploadA.rows[0]).toMatchObject({ result_code: 'ok', draft_revision: 2 });
    const hashA = uploadA.rows[0].content_hash as string;

    const v1 = await publish(activityId, 2, 'ux1a2:publish:a:0001');
    expect(v1).toMatchObject({ result_code: 'ok', version_number: 1, reused: false });
    const v1Read = await admin.query(
      'SELECT * FROM learning_activity_version_sample_get($1,$2,$3,$4)',
      [ownerPrincipalId, owner.tenantId, activityId, v1.activity_version_id],
    );
    expect(v1Read.rows[0]).toMatchObject({
      result_code: 'ok',
      content_type: 'image/png',
      content_hash: hashA,
    });
    expect(Buffer.compare(v1Read.rows[0].bytes as Buffer, imageA)).toBe(0);

    const retry = await publish(activityId, 2, 'ux1a2:publish:a:0001');
    expect(retry).toMatchObject({
      result_code: 'ok',
      activity_version_id: v1.activity_version_id,
      version_number: 1,
      content_digest: v1.content_digest,
      reused: true,
    });
    const sameRevisionRetry = await publish(activityId, 2, 'ux1a2:publish:a:alternate');
    expect(sameRevisionRetry).toMatchObject({
      result_code: 'ok',
      activity_version_id: v1.activity_version_id,
      version_number: 1,
      content_digest: v1.content_digest,
      reused: true,
    });
    const v1MediaCount = await admin.query(
      `SELECT count(*)::integer AS count
         FROM learning_activity_version_media
        WHERE activity_version_id=$1 AND role='sample'`,
      [v1.activity_version_id],
    );
    expect(v1MediaCount.rows[0].count).toBe(1);

    const replaceB = await admin.query(
      `SELECT * FROM learning_activity_draft_sample_set($1,$2,$3,2,$4,'image/webp')`,
      [ownerPrincipalId, owner.tenantId, activityId, imageB],
    );
    expect(replaceB.rows[0]).toMatchObject({ result_code: 'ok', draft_revision: 3 });
    const hashB = replaceB.rows[0].content_hash as string;
    expect(hashB).not.toBe(hashA);

    const draftB = await admin.query(
      'SELECT * FROM learning_activity_draft_sample_get($1,$2,$3)',
      [ownerPrincipalId, owner.tenantId, activityId],
    );
    expect(draftB.rows[0]).toMatchObject({
      result_code: 'ok',
      content_type: 'image/webp',
      content_hash: hashB,
    });
    expect(Buffer.compare(draftB.rows[0].bytes as Buffer, imageB)).toBe(0);

    const v1StillA = await admin.query(
      'SELECT * FROM learning_activity_version_sample_get($1,$2,$3,$4)',
      [ownerPrincipalId, owner.tenantId, activityId, v1.activity_version_id],
    );
    expect(v1StillA.rows[0].content_hash).toBe(hashA);
    expect(Buffer.compare(v1StillA.rows[0].bytes as Buffer, imageA)).toBe(0);

    const v2 = await publish(activityId, 3, 'ux1a2:publish:b:0001');
    expect(v2).toMatchObject({ result_code: 'ok', version_number: 2, reused: false });
    expect(v2.activity_version_id).not.toBe(v1.activity_version_id);
    expect(v2.content_digest).not.toBe(v1.content_digest);

    const exact = await admin.query(
      `SELECT version.id,version.version_number,media.content_type,media.content_hash,media.bytes
         FROM learning_activity_versions version
         LEFT JOIN learning_activity_version_media media
           ON media.tenant_id=version.tenant_id
          AND media.activity_version_id=version.id
          AND media.role='sample'
        WHERE version.id=ANY($1::uuid[])
        ORDER BY version.version_number`,
      [[v1.activity_version_id, v2.activity_version_id]],
    );
    expect(exact.rows).toHaveLength(2);
    expect(exact.rows[0]).toMatchObject({
      id: v1.activity_version_id,
      version_number: 1,
      content_type: 'image/png',
      content_hash: hashA,
    });
    expect(Buffer.compare(exact.rows[0].bytes as Buffer, imageA)).toBe(0);
    expect(exact.rows[1]).toMatchObject({
      id: v2.activity_version_id,
      version_number: 2,
      content_type: 'image/webp',
      content_hash: hashB,
    });
    expect(Buffer.compare(exact.rows[1].bytes as Buffer, imageB)).toBe(0);

    const digestProof = await admin.query(
      `SELECT
         learning_activity_snapshot_digest(jsonb_build_object(
           'activityId',version.activity_id,
           'versionNumber',version.version_number,
           'kind',version.canonical_kind,
           'title',version.title,
           'instructions',version.instructions,
           'resultMode',version.result_mode,
           'maxPoints',version.max_points,
           'policies',version.policy_snapshot,
           'moduleKey',version.module_key,
           'quizVersionId',version.quiz_version_id,
           'starterProjectVersionId',version.starter_project_version_id,
           'sample',jsonb_build_object('contentType',$2::varchar,'contentHash',$3::varchar),
           'provenance',version.provenance
         )) AS expected_a,
         learning_activity_snapshot_digest(jsonb_build_object(
           'activityId',version.activity_id,
           'versionNumber',version.version_number,
           'kind',version.canonical_kind,
           'title',version.title,
           'instructions',version.instructions,
           'resultMode',version.result_mode,
           'maxPoints',version.max_points,
           'policies',version.policy_snapshot,
           'moduleKey',version.module_key,
           'quizVersionId',version.quiz_version_id,
           'starterProjectVersionId',version.starter_project_version_id,
           'sample',jsonb_build_object('contentType','image/webp','contentHash',$4::varchar),
           'provenance',version.provenance
         )) AS alternate_b,
         version.content_digest
         FROM learning_activity_versions version
        WHERE version.id=$1`,
      [v1.activity_version_id, 'image/png', hashA, hashB],
    );
    expect(digestProof.rows[0].content_digest).toBe(digestProof.rows[0].expected_a);
    expect(digestProof.rows[0].content_digest).not.toBe(digestProof.rows[0].alternate_b);

    await expect(
      admin.query(
        `UPDATE learning_activity_version_media
            SET content_hash=$2
          WHERE activity_version_id=$1 AND role='sample'`,
        [v1.activity_version_id, 'f'.repeat(64)],
      ),
    ).rejects.toThrow(/immutable/);
    await expect(
      admin.query(
        `DELETE FROM learning_activity_version_media
          WHERE activity_version_id=$1 AND role='sample'`,
        [v1.activity_version_id],
      ),
    ).rejects.toThrow(/immutable/);

    const foreignRead = await admin.query(
      'SELECT * FROM learning_activity_version_sample_get($1,$2,$3,$4)',
      [foreignPrincipalId, owner.tenantId, activityId, v1.activity_version_id],
    );
    expect(foreignRead.rows[0].result_code).toBe('activity_not_found');

    await expect(
      app.query('SELECT * FROM learning_activity_version_media WHERE activity_version_id=$1', [
        v1.activity_version_id,
      ]),
    ).rejects.toThrow(/permission denied/);

    const afterLegacy = await admin.query(
      'SELECT count(*)::integer AS count FROM teacher_assignments WHERE tenant_id=$1',
      [owner.tenantId],
    );
    expect(afterLegacy.rows[0].count).toBe(beforeLegacy.rows[0].count);
  });

  it('keeps a no-image v1 empty when an image is added for v2', async () => {
    const activityId = await createActivity('Published image none then A');
    const v1 = await publish(activityId, 1, 'ux1a2:no-image:v1:0001');
    expect(v1).toMatchObject({ result_code: 'ok', version_number: 1, reused: false });

    const v1NoImage = await admin.query(
      'SELECT * FROM learning_activity_version_sample_get($1,$2,$3,$4)',
      [ownerPrincipalId, owner.tenantId, activityId, v1.activity_version_id],
    );
    expect(v1NoImage.rows[0].result_code).toBe('sample_not_found');

    const imageA = Buffer.from('published-no-image-then-A');
    const uploadA = await admin.query(
      `SELECT * FROM learning_activity_draft_sample_set($1,$2,$3,1,$4,'image/jpeg')`,
      [ownerPrincipalId, owner.tenantId, activityId, imageA],
    );
    expect(uploadA.rows[0]).toMatchObject({ result_code: 'ok', draft_revision: 2 });

    const v2 = await publish(activityId, 2, 'ux1a2:no-image:v2:0001');
    expect(v2).toMatchObject({ result_code: 'ok', version_number: 2, reused: false });

    const [v1After, v2Image] = await Promise.all([
      admin.query('SELECT * FROM learning_activity_version_sample_get($1,$2,$3,$4)', [
        ownerPrincipalId,
        owner.tenantId,
        activityId,
        v1.activity_version_id,
      ]),
      admin.query('SELECT * FROM learning_activity_version_sample_get($1,$2,$3,$4)', [
        ownerPrincipalId,
        owner.tenantId,
        activityId,
        v2.activity_version_id,
      ]),
    ]);
    expect(v1After.rows[0].result_code).toBe('sample_not_found');
    expect(v2Image.rows[0]).toMatchObject({
      result_code: 'ok',
      content_type: 'image/jpeg',
      content_hash: uploadA.rows[0].content_hash,
    });
    expect(Buffer.compare(v2Image.rows[0].bytes as Buffer, imageA)).toBe(0);
  });
});
