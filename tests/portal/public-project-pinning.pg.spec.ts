import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { hashSessionToken } from '../../contexts/identity/dist/index.js';
import { PgProjectRepository } from '../../contexts/projects/infrastructure/pg-project.repository';
import { seedTeacher, testAdminPool, testAppPool } from './helpers';
import { buildTestApp, inject, type NestApp } from './app';

let admin: pg.Pool;
let runtime: pg.Pool;
let app: NestApp;
let repo: PgProjectRepository;
const projects: string[] = [];

beforeAll(async () => {
  admin = testAdminPool();
  runtime = testAppPool();
  repo = new PgProjectRepository(runtime);
  app = await buildTestApp(runtime);
}, 90_000);
afterAll(async () => {
  try {
    // Retain immutable fixture evidence; retire only our disposable catalog entries.
    if (projects.length)
      await admin.query(
        "UPDATE project_publication_state SET state='revoked',revoked_at=now() WHERE project_id=ANY($1::uuid[])",
        [projects],
      );
  } finally {
    // buildTestApp owns the runtime pool and closes it with Nest shutdown.
    await app?.close();
    await admin?.end();
  }
});

async function identity(label: string, role?: 'verified' | 'provisional' | 'school') {
  const teacher = await seedTeacher(admin, `moderation-${label}-${randomUUID().slice(0, 8)}`);
  const row = (
    await admin.query(
      'SELECT principal_id, account_id FROM legacy_user_account_links WHERE tenant_id=$1 AND user_id=$2',
      [teacher.tenantId, teacher.teacherId],
    )
  ).rows[0];
  await admin.query("UPDATE accounts SET email_verification_state='verified' WHERE id=$1", [
    row.account_id,
  ]);
  const workspace = (
    await admin.query(
      'SELECT workspace_id FROM workspace_memberships WHERE account_id=$1 LIMIT 1',
      [row.account_id],
    )
  ).rows[0].workspace_id;
  if (role === 'school')
    await admin.query(
      "UPDATE workspace_memberships SET role='moderator' WHERE account_id=$1 AND workspace_id=$2",
      [row.account_id, workspace],
    );
  else if (role)
    await admin.query(
      `INSERT INTO capability_grants(account_id,capability,state,policy_version,granted_by)
     VALUES ($1,'platform_admin',$2,'moderation-test','admin')`,
      [row.account_id, role],
    );
  const token = randomUUID();
  await admin.query(
    `INSERT INTO sessions_v2(principal_id,active_workspace_id,token_hash,expires_at)
     VALUES ($1,$2,$3,now()+interval '1 hour')`,
    [row.principal_id, workspace, hashSessionToken(token)],
  );
  return {
    principalId: row.principal_id as string,
    accountId: row.account_id as string,
    teacher,
    token,
  };
}
async function publication(initialTitle = 'Frozen publication') {
  const owner = await identity('owner');
  const actor = { userId: owner.teacher.teacherId, principalId: owner.principalId };
  const created = await repo.createWithDraft({
    tenantId: owner.teacher.tenantId,
    scope: 'personal',
    classroomId: null,
    actor,
    moduleKey: 'electronics',
    title: 'Private original',
    idempotencyKey: randomUUID(),
    requestFingerprint: randomUUID().replaceAll('-', '').repeat(2),
    initialDocument: {
      schemaVersion: 1,
      components: [],
      connections: [],
      privateMarker: randomUUID(),
    },
    initialPreview: null,
  });
  if (created.kind !== 'created') throw new Error('fixture project not created');
  const projectId = created.project.id;
  projects.push(projectId);
  await repo.saveSnapshot({
    tenantId: owner.teacher.tenantId,
    actor,
    projectId,
    sourceRevision: 1,
    image: { bytes: new Uint8Array(64).fill(17), contentType: 'image/png', width: 16, height: 16 },
  });
  const publish = async (title = 'Frozen publication') =>
    (
      await runtime.query('SELECT project_publication_publish($1,$2,$3::jsonb) AS result', [
        owner.principalId,
        projectId,
        JSON.stringify({ title, license: 'public-domain' }),
      ])
    ).rows[0].result;
  const status = await publish(initialTitle);
  return {
    owner,
    projectId,
    publish,
    publicationId: status.publication.publicationId as string,
    revisionId: status.publication.revisionId as string,
  };
}

async function lifecycleVersion(publicationId: string): Promise<number> {
  const value = await admin.query<{ lifecycle_version: number }>(
    'SELECT lifecycle_version FROM project_publication_editorial_lifecycle WHERE publication_id=$1',
    [publicationId],
  );
  return Number(value.rows[0]?.lifecycle_version ?? 0);
}
async function pin(
  actor: string,
  publicationId: string,
  revisionId: string,
  pinned: boolean,
  expectedVersion = 0,
  expectedModerationVersion = 0,
  expectedLifecycleVersion?: number,
) {
  const expectedEpoch = expectedLifecycleVersion ?? (await lifecycleVersion(publicationId));
  return runtime.query<{ result: { pinned: boolean; pinVersion: number } }>(
    'SELECT admin_publication_pin_set($1,$2,$3,$4,$5,$6,$7,$8) AS result',
    [
      actor,
      publicationId,
      pinned,
      randomUUID(),
      expectedVersion,
      revisionId,
      expectedModerationVersion,
      expectedEpoch,
    ],
  );
}
async function publicPage(query: string, limit: number, offset: number) {
  return runtime.query<{ publication_id: string }>(
    'SELECT publication_id FROM public_projects_read(NULL,$1,NULL,$2,$3)',
    [query, limit, offset],
  );
}
async function pinState(publicationId: string, revisionId: string) {
  const read = await runtime.query<{ value: boolean }>(
    'SELECT project_publication_pinned($1,$2) AS value',
    [publicationId, revisionId],
  );
  return read.rows[0].value;
}

describe('R8-03C real PostgreSQL publication pin and catalog priority', () => {
  it('pins before SQL LIMIT/OFFSET without mutating originals; audit, RBAC and CAS are enforced', async () => {
    const marker = 'R8PIN' + randomUUID().replaceAll('-', '').slice(0, 12);
    const earlier = await publication(marker + ' older');
    const later = await publication(marker + ' newer');
    const adminActor = await identity('pin-platform', 'verified');
    const initialLifecycleVersion = await lifecycleVersion(earlier.publicationId);

    const originalDrafts = await admin.query(
      'SELECT to_jsonb(d) AS item FROM project_drafts d WHERE project_id=ANY($1::uuid[]) ORDER BY project_id',
      [[earlier.projectId, later.projectId]],
    );
    expect((await publicPage(marker, 1, 0)).rows.map((row) => row.publication_id)).toEqual([
      later.publicationId,
    ]);
    expect(await pinState(earlier.publicationId, earlier.revisionId)).toBe(false);
    for (const denied of [earlier.owner.principalId, null]) {
      await expect(
        runtime.query('SELECT admin_publication_pin_set($1,$2,true,$3,0,$4,0,0)', [
          denied,
          earlier.publicationId,
          randomUUID(),
          earlier.revisionId,
        ]),
      ).rejects.toMatchObject({ code: '42501' });
    }
    await expect(runtime.query('SELECT * FROM project_publication_pin')).rejects.toMatchObject({
      code: '42501',
    });
    const ordinary = await inject(app, {
      method: 'POST',
      url: '/api/admin/v1/publications/' + earlier.publicationId + '/pin',
      cookies: { asa_session: earlier.owner.token },
      payload: {
        pinned: true,
        expectedVersion: 0,
        expectedRevisionId: earlier.revisionId,
        expectedModerationVersion: 0,
        expectedLifecycleVersion: initialLifecycleVersion,
      },
    });
    expect(ordinary.statusCode).toBe(403);
    const accepted = await inject(app, {
      method: 'POST',
      url: '/api/admin/v1/publications/' + earlier.publicationId + '/pin',
      cookies: { asa_session: adminActor.token },
      payload: {
        pinned: true,
        expectedVersion: 0,
        expectedRevisionId: earlier.revisionId,
        expectedModerationVersion: 0,
        expectedLifecycleVersion: initialLifecycleVersion,
      },
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json()).toMatchObject({
      publicationId: earlier.publicationId,
      pinned: true,
      pinVersion: 1,
    });
    expect(await pinState(earlier.publicationId, earlier.revisionId)).toBe(true);
    expect((await publicPage(marker, 1, 0)).rows.map((row) => row.publication_id)).toEqual([
      earlier.publicationId,
    ]);
    expect((await publicPage(marker, 1, 1)).rows.map((row) => row.publication_id)).toEqual([
      later.publicationId,
    ]);
    const entry = await inject(app, {
      method: 'GET',
      url: '/api/public-projects/' + earlier.publicationId,
    });
    expect(entry.statusCode).toBe(200);
    expect(entry.json().publication).toMatchObject({ pinned: true, featured: false });
    expect(JSON.stringify(entry.json())).not.toContain(adminActor.principalId);
    await expect(
      pin(adminActor.principalId, earlier.publicationId, earlier.revisionId, true),
    ).rejects.toMatchObject({ code: 'P5M09' });

    const unpinned = await pin(
      adminActor.principalId,
      earlier.publicationId,
      earlier.revisionId,
      false,
      1,
    );
    expect(unpinned.rows[0].result).toMatchObject({ pinned: false, pinVersion: 2 });
    expect((await publicPage(marker, 1, 0)).rows[0].publication_id).toBe(later.publicationId);
    const unchanged = await admin.query(
      'SELECT to_jsonb(d) AS item FROM project_drafts d WHERE project_id=ANY($1::uuid[]) ORDER BY project_id',
      [[earlier.projectId, later.projectId]],
    );
    expect(unchanged.rows).toEqual(originalDrafts.rows);
    const audit = await admin.query(
      "SELECT action, actor_principal_id FROM administrative_audit_events WHERE target_id=$1 AND action IN ('publication.pin','publication.unpin') ORDER BY occurred_at",
      [earlier.publicationId],
    );
    expect(audit.rows.map((item) => item.action)).toEqual(['publication.pin', 'publication.unpin']);
    expect(audit.rows.every((item) => item.actor_principal_id === adminActor.principalId)).toBe(
      true,
    );
  }, 60_000);

  it('retires the old pin across moderation and revoke/same-source republish', async () => {
    const marker = 'R8PIN' + randomUUID().replaceAll('-', '').slice(0, 12);
    const source = await publication(marker + ' lifecycle');
    const moderator = await identity('pin-lifecycle-admin', 'verified');
    expect(
      (await pin(moderator.principalId, source.publicationId, source.revisionId, true)).rows[0]
        .result.pinned,
    ).toBe(true);
    const hidden = await runtime.query(
      'SELECT admin_publication_transition($1,$2,true,$3,$4,0,$5) AS result',
      [
        moderator.principalId,
        source.publicationId,
        'Moderation required',
        randomUUID(),
        source.revisionId,
      ],
    );
    expect(hidden.rows[0].result.hidden).toBe(true);
    expect(await pinState(source.publicationId, source.revisionId)).toBe(false);
    expect((await publicPage(marker, 10, 0)).rows).toEqual([]);
    const restored = await runtime.query(
      'SELECT admin_publication_transition($1,$2,false,$3,$4,1,$5) AS result',
      [moderator.principalId, source.publicationId, 'Reviewed', randomUUID(), source.revisionId],
    );
    expect(restored.rows[0].result.hidden).toBe(false);
    expect(await pinState(source.publicationId, source.revisionId)).toBe(false);
    await expect(
      pin(moderator.principalId, source.publicationId, source.revisionId, true, 1, 0),
    ).rejects.toMatchObject({ code: 'P5M09' });
    await pin(moderator.principalId, source.publicationId, source.revisionId, true, 1, 2);
    expect(await pinState(source.publicationId, source.revisionId)).toBe(true);
    await runtime.query('SELECT project_publication_revoke($1,$2)', [
      source.owner.principalId,
      source.projectId,
    ]);
    expect(await pinState(source.publicationId, source.revisionId)).toBe(false);
    const next = await source.publish(marker + ' republished');
    expect(next.publication.publicationId).toBe(source.publicationId);
    expect(await pinState(source.publicationId, next.publication.revisionId)).toBe(false);
    expect((await publicPage(marker, 10, 0)).rows).toHaveLength(1);
  }, 60_000);

  it('retires pins after project archive and account suspension and rejects stale epochs', async () => {
    const source = await publication('R8PIN lifecycle ' + randomUUID().slice(0, 8));
    const actor = await identity('pin-epoch', 'verified');
    const firstEpoch = await lifecycleVersion(source.publicationId);
    const receipt = await pin(actor.principalId, source.publicationId, source.revisionId, true);
    expect(receipt.rows[0].result.pinVersion).toBe(1);
    const ownerActor = {
      userId: source.owner.teacher.teacherId,
      principalId: source.owner.principalId,
    };
    const tenant = source.owner.teacher.tenantId;
    expect(
      (await repo.updateStatus(tenant, source.projectId, ownerActor, 'archived'))?.status,
    ).toBe('archived');
    expect(await pinState(source.publicationId, source.revisionId)).toBe(false);
    expect((await repo.updateStatus(tenant, source.projectId, ownerActor, 'active'))?.status).toBe(
      'active',
    );
    expect(await pinState(source.publicationId, source.revisionId)).toBe(false);
    const secondEpoch = await lifecycleVersion(source.publicationId);
    expect(secondEpoch).toBeGreaterThan(firstEpoch);
    await expect(
      pin(actor.principalId, source.publicationId, source.revisionId, true, 1, 0, firstEpoch),
    ).rejects.toMatchObject({ code: 'P5M09' });
    const repinned = await pin(
      actor.principalId,
      source.publicationId,
      source.revisionId,
      true,
      1,
      0,
      secondEpoch,
    );
    expect(repinned.rows[0].result.pinVersion).toBe(2);
    expect(await pinState(source.publicationId, source.revisionId)).toBe(true);
    await admin.query("UPDATE accounts SET status='suspended' WHERE id=$1", [
      source.owner.accountId,
    ]);
    expect(await pinState(source.publicationId, source.revisionId)).toBe(false);
    await admin.query("UPDATE accounts SET status='active' WHERE id=$1", [source.owner.accountId]);
    expect(await pinState(source.publicationId, source.revisionId)).toBe(false);
    const thirdEpoch = await lifecycleVersion(source.publicationId);
    expect(thirdEpoch).toBeGreaterThan(secondEpoch);
    await expect(
      pin(actor.principalId, source.publicationId, source.revisionId, true, 2, 0, secondEpoch),
    ).rejects.toMatchObject({ code: 'P5M09' });
    const final = await pin(
      actor.principalId,
      source.publicationId,
      source.revisionId,
      true,
      2,
      0,
      thirdEpoch,
    );
    expect(final.rows[0].result.pinVersion).toBe(3);
    expect(await pinState(source.publicationId, source.revisionId)).toBe(true);
  }, 60_000);

  it('serializes simultaneous pins from two verified admins with a single audit winner', async () => {
    const source = await publication('R8PIN concurrent ' + randomUUID().slice(0, 8));
    const actorA = await identity('pin-concurrent-a', 'verified');
    const actorB = await identity('pin-concurrent-b', 'verified');
    const epoch = await lifecycleVersion(source.publicationId);
    const outcomes = await Promise.allSettled([
      pin(actorA.principalId, source.publicationId, source.revisionId, true, 0, 0, epoch),
      pin(actorB.principalId, source.publicationId, source.revisionId, true, 0, 0, epoch),
    ]);
    expect(outcomes.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
    const failures = outcomes.filter((item) => item.status === 'rejected');
    expect(failures).toHaveLength(1);
    expect((failures[0] as PromiseRejectedResult).reason).toMatchObject({ code: 'P5M09' });
    expect(await pinState(source.publicationId, source.revisionId)).toBe(true);
    const audit = await admin.query(
      "SELECT count(*)::integer AS n FROM administrative_audit_events WHERE target_id=$1 AND action='publication.pin'",
      [source.publicationId],
    );
    expect(audit.rows[0].n).toBe(1);
  }, 60_000);
});
