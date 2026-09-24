import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { seedTeacher, testAdminPool, testAppPool, type SeededTeacher } from '../portal/helpers';

let admin: pg.Pool;
let app: pg.Pool;
let owner: SeededTeacher;
let ownerPrincipalId: string;
let ownerAccountId: string;
let foreignPrincipalId: string;
let activityId: string;

const policies = {
  attemptPolicy: { maxAttempts: 1 },
  resultSelectionPolicy: { mode: 'latest_accepted' },
  completionPolicy: { mode: 'accepted' },
  latePolicy: { mode: 'allow_until_close' },
  assessmentPolicy: { mode: 'manual' },
  feedbackReleasePolicy: { mode: 'immediate' },
};

beforeAll(async () => {
  admin = testAdminPool();
  app = testAppPool();
  owner = await seedTeacher(admin, 'ux1a1-draft-media-owner');

  const identity = await admin.query(
    `SELECT principal_id,account_id
       FROM legacy_user_account_links
      WHERE tenant_id=$1 AND user_id=$2`,
    [owner.tenantId, owner.teacherId],
  );
  ownerPrincipalId = identity.rows[0].principal_id as string;
  ownerAccountId = identity.rows[0].account_id as string;

  const workspace = await admin.query(
    `SELECT workspace_id
       FROM workspace_memberships
      WHERE account_id=$1 AND role='owner'
      ORDER BY created_at
      LIMIT 1`,
    [ownerAccountId],
  );

  const foreignAccount = await admin.query(
    `INSERT INTO accounts (email,password_hash,birth_date,country)
     VALUES ('ux1a1-foreign-' || gen_random_uuid()::text || '@test.local',
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
     VALUES ($1,'content_author','verified','ux1a1-test','test')`,
    [foreignAccount.rows[0].id],
  );
  await admin.query(
    `INSERT INTO workspace_memberships (account_id,workspace_id,role)
     VALUES ($1,$2,'educator')`,
    [foreignAccount.rows[0].id, workspace.rows[0].workspace_id],
  );

  const created = await admin.query(
    `SELECT * FROM learning_activity_create(
       $1,$2,'school','private','project','Draft image task','Build the shown circuit',
       'completion',NULL,$3::jsonb,'electronics',NULL,NULL,NULL,'ux1a1:create:0001'
     )`,
    [ownerPrincipalId, owner.tenantId, JSON.stringify(policies)],
  );
  expect(created.rows[0]).toMatchObject({ result_code: 'ok', draft_revision: 1 });
  activityId = created.rows[0].activity_id as string;
});

afterAll(async () => {
  await Promise.all([admin.end(), app.end()]);
});

describe('UX1A1 canonical LearningActivity draft sample', () => {
  it('persists A, replaces with B, deletes it, and advances only the canonical draft revision', async () => {
    const beforeLegacy = await admin.query(
      'SELECT count(*)::integer AS count FROM teacher_assignments WHERE tenant_id=$1',
      [owner.tenantId],
    );
    const imageA = Buffer.from('canonical-image-A');
    const imageB = Buffer.from('canonical-image-B');

    const uploadA = await admin.query(
      `SELECT * FROM learning_activity_draft_sample_set($1,$2,$3,1,$4,'image/png')`,
      [ownerPrincipalId, owner.tenantId, activityId, imageA],
    );
    expect(uploadA.rows[0]).toMatchObject({ result_code: 'ok', draft_revision: 2 });
    const hashA = uploadA.rows[0].content_hash as string;
    expect(hashA).toMatch(/^[0-9a-f]{64}$/);

    const reloadA = await admin.query(
      'SELECT * FROM learning_activity_draft_sample_get($1,$2,$3)',
      [ownerPrincipalId, owner.tenantId, activityId],
    );
    expect(reloadA.rows[0]).toMatchObject({
      result_code: 'ok',
      content_type: 'image/png',
      content_hash: hashA,
      draft_revision: 2,
    });
    expect(Buffer.compare(reloadA.rows[0].bytes as Buffer, imageA)).toBe(0);

    const replaceB = await admin.query(
      `SELECT * FROM learning_activity_draft_sample_set($1,$2,$3,2,$4,'image/webp')`,
      [ownerPrincipalId, owner.tenantId, activityId, imageB],
    );
    expect(replaceB.rows[0]).toMatchObject({ result_code: 'ok', draft_revision: 3 });
    expect(replaceB.rows[0].content_hash).not.toBe(hashA);

    const reloadB = await admin.query(
      'SELECT * FROM learning_activity_draft_sample_get($1,$2,$3)',
      [ownerPrincipalId, owner.tenantId, activityId],
    );
    expect(reloadB.rows[0]).toMatchObject({
      result_code: 'ok',
      content_type: 'image/webp',
      content_hash: replaceB.rows[0].content_hash,
      draft_revision: 3,
    });
    expect(Buffer.compare(reloadB.rows[0].bytes as Buffer, imageB)).toBe(0);
    const currentRows = await admin.query(
      `SELECT count(*)::integer AS count
         FROM learning_activity_draft_media
        WHERE activity_id=$1 AND role='sample'`,
      [activityId],
    );
    expect(currentRows.rows[0].count).toBe(1);

    const removed = await admin.query(
      'SELECT * FROM learning_activity_draft_sample_delete($1,$2,$3,3)',
      [ownerPrincipalId, owner.tenantId, activityId],
    );
    expect(removed.rows[0]).toMatchObject({ result_code: 'ok', draft_revision: 4 });

    const reloadAfterDelete = await admin.query(
      'SELECT * FROM learning_activity_draft_sample_get($1,$2,$3)',
      [ownerPrincipalId, owner.tenantId, activityId],
    );
    expect(reloadAfterDelete.rows[0]).toMatchObject({
      result_code: 'sample_not_found',
      draft_revision: 4,
    });

    const activity = await admin.query(
      `SELECT draft_revision,authoring_origin,source_teacher_assignment_id,archived_at
         FROM learning_activities
        WHERE id=$1`,
      [activityId],
    );
    expect(activity.rows[0]).toEqual({
      draft_revision: 4,
      authoring_origin: 'canonical',
      source_teacher_assignment_id: null,
      archived_at: null,
    });

    const afterLegacy = await admin.query(
      'SELECT count(*)::integer AS count FROM teacher_assignments WHERE tenant_id=$1',
      [owner.tenantId],
    );
    expect(afterLegacy.rows[0].count).toBe(beforeLegacy.rows[0].count);
  });

  it('denies a different authorized author in the same tenant from reading or changing the sample', async () => {
    const foreignRead = await admin.query(
      'SELECT * FROM learning_activity_draft_sample_get($1,$2,$3)',
      [foreignPrincipalId, owner.tenantId, activityId],
    );
    expect(foreignRead.rows[0].result_code).toBe('activity_not_found');

    const foreignWrite = await admin.query(
      `SELECT * FROM learning_activity_draft_sample_set($1,$2,$3,4,$4,'image/png')`,
      [foreignPrincipalId, owner.tenantId, activityId, Buffer.from('foreign-write')],
    );
    expect(foreignWrite.rows[0].result_code).toBe('activity_not_found');

    const foreignDelete = await admin.query(
      'SELECT * FROM learning_activity_draft_sample_delete($1,$2,$3,4)',
      [foreignPrincipalId, owner.tenantId, activityId],
    );
    expect(foreignDelete.rows[0].result_code).toBe('activity_not_found');

    await expect(
      app.query('SELECT * FROM learning_activity_draft_media WHERE activity_id=$1', [activityId]),
    ).rejects.toThrow(/permission denied/);

    const restrictedRead = await app.query(
      'SELECT result_code,draft_revision FROM learning_activity_draft_sample_get($1,$2,$3)',
      [ownerPrincipalId, owner.tenantId, activityId],
    );
    expect(restrictedRead.rows[0]).toMatchObject({
      result_code: 'sample_not_found',
      draft_revision: 4,
    });
  });
});
