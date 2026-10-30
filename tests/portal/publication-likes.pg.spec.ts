import { randomUUID } from 'node:crypto';
import { PNG } from 'pngjs';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashSessionToken } from '../../contexts/identity/dist/index.js';
import { PgProjectRepository } from '../../contexts/projects/infrastructure/pg-project.repository';
import { testAdminPool, testAppPool, seedTeacher } from './helpers';
import { studentProjectPolicyFixture } from './student-project-policy-fixture';
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
    if (projects.length)
      await admin.query(
        "UPDATE project_publication_state SET state='revoked',revoked_at=now() WHERE project_id=ANY($1::uuid[])",
        [projects],
      );
  } finally {
    await app?.close();
    await admin?.end();
  }
});
async function identity(platform = false) {
  const teacher = await seedTeacher(admin, `likes-${randomUUID().slice(0, 8)}`);
  const row = (
    await admin.query(
      'SELECT principal_id,account_id FROM legacy_user_account_links WHERE tenant_id=$1 AND user_id=$2',
      [teacher.tenantId, teacher.teacherId],
    )
  ).rows[0]!;
  const principal = row.principal_id as string;
  const account = row.account_id as string;
  await admin.query("UPDATE accounts SET email_verification_state='verified' WHERE id=$1", [
    account,
  ]);
  if (platform)
    await admin.query(
      "INSERT INTO capability_grants(account_id,capability,state,policy_version,granted_by) VALUES($1,'platform_admin','verified','likes-test','admin')",
      [account],
    );
  const workspace = (
    await admin.query(
      'SELECT workspace_id FROM workspace_memberships WHERE account_id=$1 LIMIT 1',
      [account],
    )
  ).rows[0]!.workspace_id;
  const token = randomUUID();
  const hash = hashSessionToken(token);
  await admin.query(
    "INSERT INTO sessions_v2(principal_id,active_workspace_id,token_hash,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",
    [principal, workspace, hash],
  );
  return { teacher, principal, account, hash, token, cookies: { asa_session: token } };
}
async function source() {
  const owner = await identity();
  const actor = { userId: owner.teacher.teacherId, principalId: owner.principal };
  const created = await repo.createWithDraft({
    tenantId: owner.teacher.tenantId,
    scope: 'personal',
    classroomId: null,
    actor,
    moduleKey: 'electronics',
    title: 'Likes immutable source',
    idempotencyKey: randomUUID(),
    requestFingerprint: randomUUID().replaceAll('-', '').repeat(2),
    initialDocument: { schemaVersion: 1, components: [], connections: [] },
    initialPreview: null,
  });
  if (created.kind !== 'created') throw new Error('fixture source not created');
  const projectId = created.project.id;
  projects.push(projectId);
  const png = new PNG({ width: 32, height: 32 });
  png.data.fill(255);
  await repo.saveSnapshot({
    tenantId: owner.teacher.tenantId,
    actor,
    projectId,
    sourceRevision: 1,
    image: { bytes: PNG.sync.write(png), contentType: 'image/png', width: 32, height: 32 },
  });
  const publish = async (title = 'Published likes source') =>
    (
      await runtime.query('SELECT project_publication_publish($1,$2,$3::jsonb) result', [
        owner.principal,
        projectId,
        JSON.stringify({ title, license: 'reserved' }),
      ])
    ).rows[0]!.result;
  const result = await publish();
  return {
    owner,
    projectId,
    publish,
    publicationId: result.publication.publicationId as string,
    revisionId: result.publication.revisionId as string,
  };
}
type Source = Awaited<ReturnType<typeof source>>;
type Actor = Awaited<ReturnType<typeof identity>>;
const write = (s: Source, a: Actor, on = true, revision = s.revisionId) =>
  runtime.query('SELECT publication_like_write($1,$2,$3,$4,$5) result', [
    a.principal,
    s.publicationId,
    revision,
    on,
    a.hash,
  ]);
const count = async (s: Source) =>
  (await runtime.query('SELECT publication_like_count($1) n', [s.publicationId])).rows[0]!
    .n as number;
const state = async (s: Source, a: Actor) =>
  (
    await runtime.query('SELECT publication_like_state($1,$2,$3) result', [
      a.principal,
      s.publicationId,
      a.hash,
    ])
  ).rows[0]!.result;
const settings = (
  s: Source,
  a: Actor,
  enabled: boolean,
  version = 0,
  revision = s.revisionId,
  reason = 'Safety review',
) =>
  runtime.query('SELECT admin_publication_reactions_write($1,$2,$3,$4,$5,$6,$7) result', [
    a.principal,
    s.publicationId,
    enabled,
    version,
    revision,
    reason,
    randomUUID(),
  ]);

describe('canonical publication likes with real restricted PostgreSQL and HTTP', () => {
  it('serializes concurrent idempotent Account likes, exposes only counts and preserves legacy storage', async () => {
    const s = await source();
    const reader = await identity();
    await admin.query(
      "INSERT INTO project_reactions(project_id,reactor_principal_id,kind) VALUES($1,$2,'like'),($1,$2,'wow')",
      [s.projectId, reader.principal],
    );
    expect(await count(s)).toBe(0);
    const legacyBefore = (
      await admin.query(
        'SELECT row_to_json(r) row FROM project_reactions r WHERE project_id IS NOT NULL ORDER BY project_id,reactor_principal_id,kind',
      )
    ).rows;
    const privateBefore = (
      await admin.query('SELECT document_json FROM project_drafts WHERE project_id=$1', [
        s.projectId,
      ])
    ).rows;
    await Promise.all(Array.from({ length: 8 }, () => write(s, reader)));
    expect(await count(s)).toBe(1);
    expect((await state(s, reader)).liked).toBe(true);
    const detail = await inject(app, {
      method: 'GET',
      url: `/api/public-projects/${s.publicationId}`,
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().publication.likeCount).toBe(1);
    expect(JSON.stringify(detail.json())).not.toContain(reader.principal);
    expect(
      (
        await runtime.query('SELECT * FROM project_reactions WHERE publication_id=$1', [
          s.publicationId,
        ])
      ).rows,
    ).toEqual([]);
    expect(
      (
        await admin.query(
          'SELECT row_to_json(r) row FROM project_reactions r WHERE project_id IS NOT NULL ORDER BY project_id,reactor_principal_id,kind',
        )
      ).rows,
    ).toEqual(legacyBefore);
    expect(
      (
        await admin.query('SELECT document_json FROM project_drafts WHERE project_id=$1', [
          s.projectId,
        ])
      ).rows,
    ).toEqual(privateBefore);
    const res = await inject(app, {
      method: 'GET',
      url: `/api/public-projects/${s.publicationId}/like`,
      cookies: reader.cookies,
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toContain('no-store');
    expect(res.json()).toMatchObject({ liked: true, likeCount: 1 });
    expect(JSON.stringify(res.json())).not.toContain(reader.principal);
    await Promise.all([write(s, reader, false), write(s, reader, false)]);
    expect(await count(s)).toBe(0);
  });
  it('rejects self-likes, stale revision, invalid sessions, inactive accounts and arbitrary raw writes', async () => {
    const s = await source();
    const reader = await identity();
    await expect(write(s, s.owner)).rejects.toMatchObject({ code: 'P5R02' });
    await expect(write(s, reader, true, randomUUID())).rejects.toMatchObject({ code: 'P5C02' });
    await expect(
      runtime.query(
        "INSERT INTO project_reactions(publication_id,reactor_principal_id,kind) VALUES($1,$2,'like')",
        [s.publicationId, reader.principal],
      ),
    ).rejects.toMatchObject({ code: '42501' });
    await write(s, reader);
    await admin.query("UPDATE accounts SET status='suspended' WHERE id=$1", [reader.account]);
    await expect(write(s, reader, false)).rejects.toMatchObject({ code: 'P5R01' });
    expect(await count(s)).toBe(1);
    const fresh = await identity();
    await admin.query('UPDATE sessions_v2 SET revoked_at=now() WHERE token_hash=$1', [fresh.hash]);
    await expect(write(s, fresh)).rejects.toMatchObject({ code: 'P5R01' });
    const guest = await inject(app, {
      method: 'PUT',
      url: `/api/public-projects/${s.publicationId}/like`,
      payload: { revisionId: s.revisionId, on: true },
    });
    expect(guest.statusCode).toBe(401);
  });
  it('retains across metadata update/revoke/republish and makes hidden/unknown unlike equally opaque', async () => {
    const s = await source();
    const reader = await identity();
    await write(s, reader);
    const updated = await s.publish('Updated public title');
    expect(updated.publication.publicationId).toBe(s.publicationId);
    expect(await count(s)).toBe(1);
    await runtime.query('SELECT project_publication_revoke($1,$2)', [
      s.owner.principal,
      s.projectId,
    ]);
    await expect(write(s, reader)).rejects.toMatchObject({ code: 'P5P04' });
    const removed = await inject(app, {
      method: 'PUT',
      url: `/api/public-projects/${s.publicationId}/like`,
      cookies: reader.cookies,
      payload: { revisionId: s.revisionId, on: false },
    });
    const absent = await inject(app, {
      method: 'PUT',
      url: `/api/public-projects/${randomUUID()}/like`,
      cookies: reader.cookies,
      payload: { revisionId: s.revisionId, on: false },
    });
    expect(removed.statusCode).toBe(200);
    expect(absent.statusCode).toBe(200);
    expect(removed.json()).toEqual({ liked: false });
    expect(absent.json()).toEqual(removed.json());
    const republished = await s.publish();
    s.revisionId = republished.publication.revisionId;
    await write(s, reader);
    await runtime.query('SELECT project_publication_revoke($1,$2)', [
      s.owner.principal,
      s.projectId,
    ]);
    await s.publish();
    expect(await count(s)).toBe(1);
  });
  it('admin disabling serializes with a waiting insert; enforces CAS/reason/scope and retains removal', async () => {
    const s = await source();
    const moderator = await identity(true);
    const reader = await identity();
    await expect(settings(s, reader, false)).rejects.toMatchObject({ code: '42501' });
    await expect(settings(s, moderator, false, 0, s.revisionId, ' ')).rejects.toMatchObject({
      code: '22023',
    });
    const blocker = await admin.connect();
    const writer = await runtime.connect();
    try {
      const blockerPid = (await blocker.query('SELECT pg_backend_pid() pid')).rows[0]!
        .pid as number;
      await blocker.query('BEGIN');
      await blocker.query('SELECT id FROM projects WHERE id=$1 FOR UPDATE', [s.projectId]);
      await blocker.query(
        'UPDATE project_publication_state SET reactions_enabled=false,reactions_version=1 WHERE id=$1',
        [s.publicationId],
      );
      const pid = (await writer.query('SELECT pg_backend_pid() pid')).rows[0]!.pid as number;
      const pending = writer
        .query('SELECT publication_like_write($1,$2,$3,true,$4)', [
          reader.principal,
          s.publicationId,
          s.revisionId,
          reader.hash,
        ])
        .then(
          () => null,
          (error: unknown) => error,
        );
      let waiting = false;
      for (let i = 0; i < 100 && !waiting; i++) {
        waiting =
          (
            await admin.query(
              "SELECT wait_event_type='Lock' AND $2=ANY(pg_blocking_pids($1)) waiting FROM pg_stat_activity WHERE pid=$1",
              [pid, blockerPid],
            )
          ).rows[0]?.waiting === true;
        if (!waiting) await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(waiting).toBe(true);
      expect(await count(s)).toBe(0);
      await blocker.query('COMMIT');
      expect(await pending).toMatchObject({ code: 'P5R03' });
      expect(await count(s)).toBe(0);
    } finally {
      await blocker.query('ROLLBACK');
      blocker.release();
      writer.release();
    }
    await settings(s, moderator, true, 1);
    await write(s, reader);
    await settings(s, moderator, false, 2);
    expect(await state(s, reader)).toMatchObject({
      liked: true,
      canLike: false,
      canUnlike: true,
      likeCount: 1,
    });
    await expect(write(s, reader)).rejects.toMatchObject({ code: 'P5R03' });
    await write(s, reader, false);
    expect(await count(s)).toBe(0);
    await expect(settings(s, moderator, true, 0)).rejects.toMatchObject({ code: 'P5M09' });
    const audits = (
      await admin.query(
        "SELECT action,reason_text FROM administrative_audit_events WHERE target_id=$1 AND action='publication.reactions'",
        [s.publicationId],
      )
    ).rows;
    expect(audits).toHaveLength(2);
    expect(audits.every((row) => row.reason_text === 'Safety review')).toBe(true);
    const list = await inject(app, {
      method: 'GET',
      url: '/api/admin/v1/publications?limit=50',
      cookies: moderator.cookies,
    });
    expect(list.statusCode).toBe(200);
    expect(
      list
        .json()
        .items.find((item: { publicationId: string }) => item.publicationId === s.publicationId),
    ).toMatchObject({ likeCount: 0, reactionsEnabled: false, reactionsVersion: 3 });
  });
  it('active Seat likes independently of default-OFF publication/download rights and shares verified Account identity', async () => {
    const s = await source();
    const seat = await studentProjectPolicyFixture(admin, runtime);
    const linked = await identity();
    const learner = (
      await admin.query(
        "SELECT learner_identity_id,tenant_id,school_id FROM learner_identity_links WHERE seat_id=$1 AND status='active'",
        [seat.seatId],
      )
    ).rows[0]!;
    await admin.query(
      "INSERT INTO learner_identity_links(id,tenant_id,school_id,learner_identity_id,link_kind,account_id) VALUES($1,$2,$3,$4,'account',$5)",
      [
        randomUUID(),
        learner.tenant_id,
        learner.school_id,
        learner.learner_identity_id,
        linked.account,
      ],
    );
    await write(s, linked);
    const cookies = { asa_student_session: seat.token };
    const response = await inject(app, {
      method: 'PUT',
      url: `/api/public-projects/${s.publicationId}/like`,
      cookies,
      payload: { revisionId: s.revisionId, on: true },
    });
    expect(response.statusCode).toBe(200);
    expect(await count(s)).toBe(1);
    expect(
      (
        await runtime.query('SELECT publication_like_state($1,$2,$3) result', [
          seat.principal,
          s.publicationId,
          seat.hash,
        ])
      ).rows[0]!.result,
    ).toMatchObject({ liked: true, canUnlike: true });
    await admin.query(
      "INSERT INTO learner_identity_links(id,tenant_id,school_id,learner_identity_id,link_kind,account_id) VALUES($1,$2,$3,$4,'account',$5)",
      [
        randomUUID(),
        learner.tenant_id,
        learner.school_id,
        learner.learner_identity_id,
        s.owner.account,
      ],
    );
    await expect(
      runtime.query('SELECT publication_like_write($1,$2,$3,true,$4)', [
        seat.principal,
        s.publicationId,
        s.revisionId,
        seat.hash,
      ]),
    ).rejects.toMatchObject({ code: 'P5R02' });
    await admin.query("UPDATE classroom_student_seats SET status='suspended' WHERE id=$1", [
      seat.seatId,
    ]);
    const blocked = await inject(app, {
      method: 'PUT',
      url: `/api/public-projects/${s.publicationId}/like`,
      cookies,
      payload: { revisionId: s.revisionId, on: false },
    });
    expect([401, 403]).toContain(blocked.statusCode);
    expect(await count(s)).toBe(1);
  });
});
