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
async function publication() {
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
  const status = await publish();
  return {
    owner,
    projectId,
    publish,
    publicationId: status.publication.publicationId as string,
    revisionId: status.publication.revisionId as string,
  };
}
const transition = async (
  actor: string | null,
  publicationId: string,
  hidden: boolean,
  reason = 'Safety review',
  request = randomUUID(),
  expectedVersion = 0,
  expectedRevisionId?: string,
) => {
  // Test-only snapshot: simulate a fresh admin list when the specific dialog's
  // revision is not supplied. The stale-dialog tests pass an old revision.
  const selectedRevision =
    expectedRevisionId ??
    (
      await admin.query<{ current_revision_id: string }>(
        'SELECT current_revision_id FROM project_publication_state WHERE id=$1',
        [publicationId],
      )
    ).rows[0]?.current_revision_id ??
    randomUUID();
  return runtime.query('SELECT admin_publication_transition($1,$2,$3,$4,$5,$6,$7) AS result', [
    actor,
    publicationId,
    hidden,
    reason,
    request,
    expectedVersion,
    selectedRevision,
  ]);
};
async function original(projectId: string) {
  return (
    await admin.query(
      `SELECT
    (SELECT to_jsonb(p) FROM projects p WHERE id=$1) AS project,
    (SELECT jsonb_agg(to_jsonb(d)) FROM project_drafts d WHERE project_id=$1) AS drafts,
    (SELECT jsonb_agg(to_jsonb(v) ORDER BY version_no) FROM project_versions v WHERE project_id=$1) AS versions,
    (SELECT jsonb_agg(to_jsonb(r) ORDER BY revision_no) FROM project_publication_revisions r WHERE project_id=$1) AS revisions`,
      [projectId],
    )
  ).rows[0];
}
async function unavailable(source: Awaited<ReturnType<typeof publication>>) {
  for (const [sql, params] of [
    ['SELECT * FROM public_projects_read($1,NULL,NULL,1,0)', [source.publicationId]],
    ['SELECT * FROM public_project_image($1,NULL)', [source.publicationId]],
    ['SELECT * FROM gallery_snapshot($1)', [source.projectId]],
    ['SELECT * FROM gallery_work(NULL,$1)', [source.projectId]],
    [
      'SELECT * FROM public_project_copy_documents($1::uuid[],$2::uuid[])',
      [[source.publicationId], [source.revisionId]],
    ],
  ] as const)
    expect((await runtime.query(sql, [...params])).rows).toEqual([]);
  await expect(
    runtime.query('SELECT * FROM public_project_copy_source($1,$2,$3)', [
      source.owner.principalId,
      source.publicationId,
      source.revisionId,
    ]),
  ).rejects.toMatchObject({ code: 'P5C01' });
}

describe('publication moderation with real runtime privileges and sessions', () => {
  it('denies anonymous, ordinary, school moderator, unverified capability and Seat-selected requests', async () => {
    const source = await publication();
    const platform = await identity('platform', 'verified');
    const denied = [
      source.owner,
      await identity('school', 'school'),
      await identity('provisional', 'provisional'),
    ];
    for (const actor of [null, ...denied]) {
      for (const options of [
        { method: 'GET' as const, url: '/api/admin/v1/publications' },
        { method: 'GET' as const, url: `/api/admin/v1/publications/${source.publicationId}/image` },
        {
          method: 'POST' as const,
          url: `/api/admin/v1/publications/${source.publicationId}/hide`,
          payload: { reason: 'x' },
        },
        {
          method: 'POST' as const,
          url: `/api/admin/v1/publications/${source.publicationId}/restore`,
          payload: { reason: 'x' },
        },
      ]) {
        const response = await inject(app, {
          ...options,
          cookies: actor ? { asa_session: actor.token } : {},
        });
        expect(response.statusCode).toBe(actor ? 403 : 401);
        expect(response.body).not.toContain('Frozen publication');
      }
      const id = actor?.principalId ?? null;
      await expect(
        runtime.query('SELECT admin_publications_list($1,0,25)', [id]),
      ).rejects.toMatchObject({ code: '42501' });
      await expect(
        runtime.query('SELECT * FROM admin_publication_image($1,$2)', [id, source.publicationId]),
      ).rejects.toMatchObject({ code: '42501' });
      await expect(transition(id, randomUUID(), true)).rejects.toMatchObject({ code: '42501' });
    }
    for (const path of ['', `/${source.publicationId}/image`]) {
      const response = await inject(app, {
        method: 'GET',
        url: '/api/admin/v1/publications' + path,
        cookies: { asa_session: platform.token, asa_student_session: 'invalid-seat' },
      });
      // Mixed Account+Seat cookies are blocked by the shared session-conflict
      // hook before the administration controller is reached.
      expect(response.statusCode).toBe(409);
      expect(response.body).toContain('session_conflict');
    }
    const classroom = (
      await admin.query(
        `INSERT INTO classrooms(tenant_id,school_id,academic_period_id,title,created_by)
      VALUES ($1,$2,$3,'Seat auth test',$4) RETURNING id`,
        [
          source.owner.teacher.tenantId,
          source.owner.teacher.schoolId,
          source.owner.teacher.periodId,
          source.owner.teacher.teacherId,
        ],
      )
    ).rows[0].id;
    const seat = (
      await admin.query(
        `INSERT INTO classroom_student_seats
      (tenant_id,classroom_id,display_label,login_handle,normalized_login_handle,safe_mode,status,created_by)
      VALUES ($1,$2,'Seat','moderation-seat','moderation-seat',true,'active',$3) RETURNING id`,
        [source.owner.teacher.tenantId, classroom, source.owner.teacher.teacherId],
      )
    ).rows[0].id;
    const seatPrincipal = (
      await admin.query(
        "INSERT INTO principals(kind,seat_id) VALUES ('student_seat',$1) RETURNING id",
        [seat],
      )
    ).rows[0].id;
    await expect(
      runtime.query('SELECT admin_publications_list($1,0,25)', [seatPrincipal]),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      runtime.query('SELECT * FROM admin_publication_image($1,$2)', [
        seatPrincipal,
        source.publicationId,
      ]),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(transition(seatPrincipal, source.publicationId, true)).rejects.toMatchObject({
      code: '42501',
    });
    // Capability revocation takes effect on the next privileged SQL invocation.
    await admin.query(
      "UPDATE capability_grants SET state='provisional' WHERE account_id=$1 AND capability='platform_admin'",
      [platform.accountId],
    );
    await expect(
      transition(platform.principalId, source.publicationId, true),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('rejects an old restore dialog after a newer restore-and-hide (ABA)', async () => {
    const source = await publication();
    const first = await identity('aba-first', 'verified');
    const second = await identity('aba-second', 'verified');
    const path = '/api/admin/v1/publications/' + source.publicationId;
    const send = async (
      actor: Awaited<ReturnType<typeof identity>>,
      op: 'hide' | 'restore',
      reason: string,
      expectedVersion: number,
    ) =>
      inject(app, {
        method: 'POST',
        url: path + '/' + op,
        cookies: { asa_session: actor.token },
        payload: { reason, expectedVersion, expectedRevisionId: source.revisionId },
      });

    const hideA = await send(first, 'hide', 'Reason A', 0);
    expect(hideA.statusCode).toBe(200);
    expect(hideA.json().moderationVersion).toBe(1);
    const restoreA = await send(second, 'restore', 'Reviewed A', 1);
    expect(restoreA.statusCode).toBe(200);
    expect(restoreA.json().moderationVersion).toBe(2);
    const hideB = await send(second, 'hide', 'Reason B', 2);
    expect(hideB.statusCode).toBe(200);
    expect(hideB.json().moderationVersion).toBe(3);

    // Old dialog still carries expectedVersion=1, not the current=3.
    const staleRestore = await send(first, 'restore', 'Stale reviewed A', 1);
    expect(staleRestore.statusCode).toBe(409);
    await unavailable(source);
    const row = (
      await admin.query(
        'SELECT hidden, reason, moderation_version FROM project_publication_moderation WHERE publication_id=$1',
        [source.publicationId],
      )
    ).rows[0];
    expect(row).toMatchObject({ hidden: true, reason: 'Reason B', moderation_version: 3 });
    const audit = (
      await admin.query(
        "SELECT count(*)::integer AS count FROM administrative_audit_events WHERE target_type='project_publication' AND target_id=$1",
        [source.publicationId],
      )
    ).rows[0];
    expect(audit.count).toBe(3);
    const fresh = await send(first, 'restore', 'Reviewed latest B', 3);
    expect(fresh.statusCode).toBe(200);
    expect(fresh.json().moderationVersion).toBe(4);
    expect(
      (await runtime.query('SELECT * FROM public_project_image($1,NULL)', [source.publicationId]))
        .rows,
    ).toHaveLength(1);
  });

  it('rejects stale restore after the author republishes a different immutable revision', async () => {
    const source = await publication();
    const moderator = await identity('revision-race', 'verified');
    const hide = await transition(
      moderator.principalId,
      source.publicationId,
      true,
      'Review before author changes',
      randomUUID(),
      0,
      source.revisionId,
    );
    expect(hide.rows[0].result.moderationVersion).toBe(1);
    const latest = await source.publish('Updated after moderation');
    const revisionId = latest.publication.revisionId as string;
    expect(revisionId).not.toBe(source.revisionId);

    // This dialog still shows the previous immutable revision. The moderation
    // state version is the SAME 1: stale content alone must cause HTTP 409.
    const stale = await inject(app, {
      method: 'POST',
      url: `/api/admin/v1/publications/${source.publicationId}/restore`,
      cookies: { asa_session: moderator.token },
      payload: {
        reason: 'Reviewed old revision',
        expectedVersion: 1,
        expectedRevisionId: source.revisionId,
      },
    });
    expect(stale.statusCode).toBe(409);
    await unavailable(source);
    const unchanged = (
      await admin.query(
        'SELECT hidden, reason, moderation_version FROM project_publication_moderation WHERE publication_id=$1',
        [source.publicationId],
      )
    ).rows[0];
    expect(unchanged).toMatchObject({
      hidden: true,
      reason: 'Review before author changes',
      moderation_version: 1,
    });
    const events = (
      await admin.query(
        "SELECT count(*)::integer AS n FROM administrative_audit_events WHERE target_type='project_publication' AND target_id=$1",
        [source.publicationId],
      )
    ).rows[0];
    expect(events.n).toBe(1);

    // Explicitly reviewing the CURRENT author revision can restore it.
    const current = await inject(app, {
      method: 'POST',
      url: `/api/admin/v1/publications/${source.publicationId}/restore`,
      cookies: { asa_session: moderator.token },
      payload: {
        reason: 'Reviewed current author revision',
        expectedVersion: 1,
        expectedRevisionId: revisionId,
      },
    });
    expect(current.statusCode).toBe(200);
    expect(current.json().moderationVersion).toBe(2);
    expect(
      (await runtime.query('SELECT * FROM public_project_image($1,NULL)', [source.publicationId]))
        .rows,
    ).toHaveLength(1);
  });

  it('hides all public projections, preserves originals, explains to owner and restores with atomic audit', async () => {
    const source = await publication();
    const moderator = await identity('moderator', 'verified');
    const stranger = await identity('stranger');
    const collectionId = (
      await runtime.query('SELECT collection_create($1,$2) AS id', [
        stranger.principalId,
        'Moderation collection',
      ])
    ).rows[0].id;
    expect(
      (
        await runtime.query('SELECT collection_set_item($1,$2,$3,true) AS ok', [
          stranger.principalId,
          collectionId,
          source.projectId,
        ])
      ).rows[0].ok,
    ).toBe(true);
    const before = await original(source.projectId);
    const onLegacyWall = async () => {
      const response = await inject(app, {
        method: 'GET',
        url: '/api/gallery/mine',
        cookies: { asa_session: source.owner.token },
      });
      expect(response.statusCode).toBe(200);
      return (response.json().projectIds as string[]).includes(source.projectId);
    };
    expect(await onLegacyWall()).toBe(true);
    const list = await inject(app, {
      method: 'GET',
      url: '/api/admin/v1/publications?offset=0&limit=50',
      cookies: { asa_session: moderator.token },
    });
    expect(list.statusCode).toBe(200);
    expect(
      list
        .json()
        .items.some(
          (item: { publicationId: string }) => item.publicationId === source.publicationId,
        ),
    ).toBe(true);
    const hidden = await inject(app, {
      method: 'POST',
      url: `/api/admin/v1/publications/${source.publicationId}/hide`,
      cookies: { asa_session: moderator.token },
      payload: {
        reason: 'Unsafe example',
        expectedVersion: 0,
        expectedRevisionId: source.revisionId,
      },
    });
    expect(hidden.statusCode).toBe(200);
    expect(hidden.json()).toMatchObject({
      publicationId: source.publicationId,
      hidden: true,
      moderationVersion: 1,
      reason: 'Unsafe example',
    });
    await unavailable(source);
    expect(await onLegacyWall()).toBe(false);
    expect(
      (
        await runtime.query('SELECT * FROM collection_items_list($1,$2)', [
          stranger.principalId,
          collectionId,
        ])
      ).rows,
    ).toEqual([]);
    expect(await original(source.projectId)).toEqual(before);
    expect(
      (
        await runtime.query('SELECT project_publication_status($1,$2) AS result', [
          source.owner.principalId,
          source.projectId,
        ])
      ).rows[0].result,
    ).toMatchObject({ moderationReason: 'Unsafe example', publication: { publicPath: null } });
    expect(
      (
        await runtime.query('SELECT project_publication_status($1,$2) AS result', [
          stranger.principalId,
          source.projectId,
        ])
      ).rows[0].result,
    ).toBeNull();
    const ownerResponse = await inject(app, {
      method: 'GET',
      url: `/api/projects/${source.projectId}/publication`,
      cookies: { asa_session: source.owner.token },
    });
    expect(ownerResponse.statusCode).toBe(200);
    expect(ownerResponse.json().moderationReason).toBe('Unsafe example');
    const strangerResponse = await inject(app, {
      method: 'GET',
      url: `/api/projects/${source.projectId}/publication`,
      cookies: { asa_session: stranger.token },
    });
    expect(strangerResponse.statusCode).toBe(404);
    expect(strangerResponse.body).not.toContain('Unsafe example');
    const preview = await inject(app, {
      method: 'GET',
      url: `/api/admin/v1/publications/${source.publicationId}/image`,
      cookies: { asa_session: moderator.token },
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.rawPayload).toEqual(Buffer.alloc(64, 17));
    expect(preview.headers['cache-control']).toBe('no-store');
    await expect(
      transition(moderator.principalId, source.publicationId, true),
    ).rejects.toMatchObject({ code: 'P5M09' });
    const restored = await inject(app, {
      method: 'POST',
      url: `/api/admin/v1/publications/${source.publicationId}/restore`,
      cookies: { asa_session: moderator.token },
      payload: {
        reason: 'Reviewed safe',
        expectedVersion: 1,
        expectedRevisionId: source.revisionId,
      },
    });
    expect(restored.statusCode).toBe(200);
    expect(restored.json()).toMatchObject({ hidden: false, reason: null, moderationVersion: 2 });
    expect(await onLegacyWall()).toBe(true);
    expect(
      (await runtime.query('SELECT * FROM public_project_image($1,NULL)', [source.publicationId]))
        .rows,
    ).toHaveLength(1);
    expect(await original(source.projectId)).toEqual(before);
    const audit = (
      await admin.query(
        `SELECT actor_principal_id, action, reason_text, request_id, before_version, after_version
      FROM administrative_audit_events WHERE target_type='project_publication' AND target_id=$1 ORDER BY occurred_at,id`,
        [source.publicationId],
      )
    ).rows;
    expect(audit).toHaveLength(2);
    expect(audit[0]).toMatchObject({
      actor_principal_id: moderator.principalId,
      action: 'publication.hide',
      reason_text: 'Unsafe example',
      before_version: '0',
      after_version: '1',
    });
    expect(audit[1]).toMatchObject({
      action: 'publication.restore',
      reason_text: 'Reviewed safe',
      before_version: '1',
      after_version: '2',
    });
    expect(audit.every((event) => event.request_id.length > 0)).toBe(true);
    await expect(
      runtime.query('DELETE FROM administrative_audit_events WHERE target_id=$1', [
        source.publicationId,
      ]),
    ).rejects.toBeDefined();
  });

  it('keeps hide across author update/revoke and never republishes revoked or ineligible originals', async () => {
    const source = await publication();
    const moderator = await identity('lifecycle', 'verified');
    await transition(moderator.principalId, source.publicationId, true);
    await source.publish('Updated frozen title');
    await unavailable(source);
    await runtime.query('SELECT project_publication_revoke($1,$2)', [
      source.owner.principalId,
      source.projectId,
    ]);
    await transition(
      moderator.principalId,
      source.publicationId,
      false,
      'Reviewed revoked',
      randomUUID(),
      1,
    );
    await unavailable(source);
    await source.publish();
    await transition(
      moderator.principalId,
      source.publicationId,
      true,
      'Safety review',
      randomUUID(),
      2,
    );
    await admin.query("UPDATE projects SET status='archived' WHERE id=$1", [source.projectId]);
    await transition(
      moderator.principalId,
      source.publicationId,
      false,
      'Reviewed archived',
      randomUUID(),
      3,
    );
    await unavailable(source);
  });

  it('serializes simultaneous actions, rejects replay and rolls back state and audit together', async () => {
    const source = await publication();
    const moderator = await identity('race', 'verified');
    const outcomes = await Promise.allSettled([
      transition(moderator.principalId, source.publicationId, true),
      transition(moderator.principalId, source.publicationId, true),
    ]);
    expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((result) => result.status === 'rejected')).toHaveLength(1);
    await transition(
      moderator.principalId,
      source.publicationId,
      false,
      'Reviewed',
      randomUUID(),
      1,
    );
    const requestId = randomUUID();
    await transition(moderator.principalId, source.publicationId, true, 'Safety', requestId, 2);
    await transition(
      moderator.principalId,
      source.publicationId,
      false,
      'Reviewed',
      randomUUID(),
      3,
    );
    await expect(
      transition(moderator.principalId, source.publicationId, true, 'Replay', requestId, 4),
    ).rejects.toMatchObject({ code: 'P5M09' });
    const auditBefore = (
      await admin.query(
        'SELECT count(*) AS count FROM administrative_audit_events WHERE target_id=$1',
        [source.publicationId],
      )
    ).rows[0].count;
    const client = await runtime.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT admin_publication_transition($1,$2,true,$3,$4,$5,$6)', [
        moderator.principalId,
        source.publicationId,
        'Rolled back',
        randomUUID(),
        4,
        source.revisionId,
      ]);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
    expect(
      (
        await admin.query(
          'SELECT hidden FROM project_publication_moderation WHERE publication_id=$1',
          [source.publicationId],
        )
      ).rows[0].hidden,
    ).toBe(false);
    expect(
      (
        await admin.query(
          'SELECT count(*) AS count FROM administrative_audit_events WHERE target_id=$1',
          [source.publicationId],
        )
      ).rows[0].count,
    ).toBe(auditBefore);
    // A failure in append-only audit must abort the moderation write too. DDL is
    // transactional and rolled back; the trigger affects only this fixture target.
    const failureClient = await admin.connect();
    const suffix = randomUUID().replaceAll('-', '');
    try {
      await failureClient.query('BEGIN');
      await failureClient.query(`CREATE FUNCTION public.moderation_fail_${suffix}() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN IF NEW.target_id = '${source.publicationId}' THEN RAISE EXCEPTION 'fixture audit failure'; END IF;
        RETURN NEW; END; $$`);
      await failureClient.query(`CREATE TRIGGER moderation_fail_${suffix} BEFORE INSERT ON administrative_audit_events
        FOR EACH ROW EXECUTE FUNCTION public.moderation_fail_${suffix}()`);
      await failureClient.query('SET LOCAL ROLE asalab_app');
      await expect(
        failureClient.query('SELECT admin_publication_transition($1,$2,true,$3,$4,$5,$6)', [
          moderator.principalId,
          source.publicationId,
          'Must roll back',
          randomUUID(),
          4,
          source.revisionId,
        ]),
      ).rejects.toMatchObject({ code: 'P0001' });
    } finally {
      await failureClient.query('ROLLBACK');
      failureClient.release();
    }
    expect(
      (
        await admin.query(
          'SELECT hidden FROM project_publication_moderation WHERE publication_id=$1',
          [source.publicationId],
        )
      ).rows[0].hidden,
    ).toBe(false);
    expect(
      (
        await admin.query(
          'SELECT count(*) AS count FROM administrative_audit_events WHERE target_id=$1',
          [source.publicationId],
        )
      ).rows[0].count,
    ).toBe(auditBefore);
    await expect(transition(moderator.principalId, randomUUID(), true)).rejects.toMatchObject({
      code: 'P5P04',
    });
  });

  it('serializes author publish and revoke against moderation without losing hidden state', async () => {
    const source = await publication();
    const moderator = await identity('author-race', 'verified');
    const published = await Promise.allSettled([
      source.publish('Concurrent author update'),
      transition(moderator.principalId, source.publicationId, true),
    ]);
    expect(published[0].status).toBe('fulfilled');
    if (published[1].status === 'rejected') {
      expect(published[1].reason).toMatchObject({ code: 'P5M09' });
      await transition(moderator.principalId, source.publicationId, true);
    }
    await unavailable(source);
    const revoked = await Promise.allSettled([
      runtime.query('SELECT project_publication_revoke($1,$2)', [
        source.owner.principalId,
        source.projectId,
      ]),
      transition(
        moderator.principalId,
        source.publicationId,
        false,
        'Reviewed concurrently',
        randomUUID(),
        1,
      ),
    ]);
    expect(revoked.every((result) => result.status === 'fulfilled')).toBe(true);
    expect(
      (
        await admin.query('SELECT state FROM project_publication_state WHERE id=$1', [
          source.publicationId,
        ])
      ).rows[0].state,
    ).toBe('revoked');
    await unavailable(source);
  });

  it('rejects direct restricted-role table access and unbounded SQL input', async () => {
    expect((await runtime.query('SELECT current_user AS role')).rows[0].role).toBe('asalab_app');
    for (const sql of [
      'SELECT * FROM project_publication_moderation',
      "INSERT INTO project_publication_moderation(publication_id,hidden,reason,actor_principal_id) VALUES ($1,true,'x',$2)",
      'UPDATE project_publication_moderation SET hidden=false,reason=NULL',
      'DELETE FROM project_publication_moderation',
    ]) {
      await expect(
        runtime.query(sql, sql.includes('$1') ? [randomUUID(), randomUUID()] : []),
      ).rejects.toMatchObject({ code: '42501' });
    }
    const moderator = await identity('bounds', 'verified');
    await expect(
      runtime.query('SELECT admin_publications_list($1,0,51)', [moderator.principalId]),
    ).rejects.toMatchObject({ code: '22023' });
    await expect(transition(moderator.principalId, randomUUID(), true, ' ')).rejects.toMatchObject({
      code: '22023',
    });
  });
  it('enforces editorial access and revision-bound lifecycle', async () => {
    const source = await publication();
    const editor = await identity('featured-editor', 'verified');
    const ordinary = await identity('featured-ordinary');
    const url = `/api/admin/v1/publications/${source.publicationId}/featured`;
    const lifecycleResult = await admin.query<{ lifecycle_version: number }>(
      'SELECT lifecycle_version FROM project_publication_editorial_lifecycle WHERE publication_id=$1',
      [source.publicationId],
    );
    const lifecycleVersion = lifecycleResult.rows[0]?.lifecycle_version ?? 0;
    const data = (
      featured: boolean,
      editorialVersion: number,
      moderationVersion: number,
      revisionId = source.revisionId,
    ) => ({
      featured,
      expectedVersion: editorialVersion,
      expectedModerationVersion: moderationVersion,
      expectedRevisionId: revisionId,
      expectedLifecycleVersion: lifecycleVersion,
    });
    const request = async (token: string, payload: ReturnType<typeof data>) =>
      inject(app, {
        method: 'POST',
        url,
        cookies: { asa_session: token },
        payload,
      });
    expect((await request(ordinary.token, data(true, 0, 0))).statusCode).toBe(403);
    await expect(
      runtime.query('SELECT * FROM project_publication_editorial'),
    ).rejects.toMatchObject({ code: '42501' });
    const selected = await request(editor.token, data(true, 0, 0));
    expect(selected.statusCode).toBe(200);
    expect(selected.json()).toMatchObject({
      publicationId: source.publicationId,
      revisionId: source.revisionId,
      featured: true,
      editorialVersion: 1,
    });
    expect((await request(editor.token, data(true, 0, 0))).statusCode).toBe(409);
    const publicDetail = async () =>
      inject(app, { method: 'GET', url: `/api/public-projects/${source.publicationId}` });
    expect((await publicDetail()).json().publication).toMatchObject({ featured: true });
    const catalog = await inject(app, { method: 'GET', url: '/api/public-projects?limit=48' });
    expect(catalog.statusCode).toBe(200);
    const catalogItem = catalog
      .json()
      .items.find((item: { publicationId: string }) => item.publicationId === source.publicationId);
    expect(catalogItem).toMatchObject({ featured: true });
    const adminList = await inject(app, {
      method: 'GET',
      url: '/api/admin/v1/publications',
      cookies: { asa_session: editor.token },
    });
    expect(adminList.statusCode).toBe(200);
    const adminItem = adminList
      .json()
      .items.find((item: { publicationId: string }) => item.publicationId === source.publicationId);
    expect(adminItem).toMatchObject({ featured: true, editorialVersion: 1 });

    await transition(
      editor.principalId,
      source.publicationId,
      true,
      'Safety check',
      randomUUID(),
      0,
      source.revisionId,
    );
    expect((await publicDetail()).statusCode).toBe(404);
    expect((await request(editor.token, data(false, 1, 1))).statusCode).toBe(404);
    await transition(
      editor.principalId,
      source.publicationId,
      false,
      'Reviewed',
      randomUUID(),
      1,
      source.revisionId,
    );
    expect((await publicDetail()).json().publication.featured).toBe(false);
    expect((await request(editor.token, data(true, 1, 0))).statusCode).toBe(409);
    const again = await request(editor.token, data(true, 1, 2));
    expect(again.statusCode).toBe(200);
    expect((await publicDetail()).json().publication.featured).toBe(true);

    const updated = await source.publish('Author-updated immutable metadata');
    const newRevision = updated.publication.revisionId as string;
    expect(newRevision).not.toBe(source.revisionId);
    expect((await publicDetail()).json().publication.featured).toBe(false);
    expect((await request(editor.token, data(false, 2, 2))).statusCode).toBe(409);
    const history = (
      await admin.query(
        `SELECT action,actor_principal_id,reason_text,before_version,after_version
          FROM administrative_audit_events WHERE target_type='project_publication' AND target_id=$1
          ORDER BY occurred_at,id`,
        [source.publicationId],
      )
    ).rows;
    const editorial = history.filter((event) =>
      String(event.action).startsWith('publication.feat'),
    );
    expect(editorial).toHaveLength(2);
    expect(editorial[0]).toMatchObject({
      action: 'publication.feature',
      actor_principal_id: editor.principalId,
      reason_text: 'Выбор редакции',
      before_version: '0',
      after_version: '1',
    });
    expect(editorial[1]).toMatchObject({
      action: 'publication.feature',
      before_version: '1',
      after_version: '2',
    });
    expect(history.filter((event) => event.action === 'publication.restore')).toHaveLength(1);
  });
  it('prevents badge resurrection after revoke and republish', async () => {
    const source = await publication();
    const editor = await identity('revoke-featured-editor', 'verified');
    const actionUrl = `/api/admin/v1/publications/${source.publicationId}/featured`;
    const epoch = async (): Promise<number> => {
      const result = await admin.query<{ lifecycle_version: number }>(
        'SELECT lifecycle_version FROM project_publication_editorial_lifecycle WHERE publication_id=$1',
        [source.publicationId],
      );
      return result.rows[0]?.lifecycle_version ?? 0;
    };
    const startEpoch = await epoch();
    const action = async (editorialVersion: number, lifecycleVersion: number) =>
      inject(app, {
        method: 'POST',
        url: actionUrl,
        cookies: { asa_session: editor.token },
        payload: {
          featured: true,
          expectedVersion: editorialVersion,
          expectedRevisionId: source.revisionId,
          expectedModerationVersion: 0,
          expectedLifecycleVersion: lifecycleVersion,
        },
      });
    const selected = await action(0, startEpoch);
    expect(selected.statusCode).toBe(200);
    expect(selected.json()).toMatchObject({
      publicationId: source.publicationId,
      revisionId: source.revisionId,
      featured: true,
      editorialVersion: 1,
      lifecycleVersion: startEpoch,
    });
    const read = async () =>
      inject(app, { method: 'GET', url: `/api/public-projects/${source.publicationId}` });
    expect((await read()).json().publication.featured).toBe(true);

    const before = await original(source.projectId);
    const revoked = await runtime.query('SELECT project_publication_revoke($1,$2) AS ok', [
      source.owner.principalId,
      source.projectId,
    ]);
    expect(revoked.rows[0]?.ok).toBe(true);
    expect((await read()).statusCode).toBe(404);

    // The writer deliberately reuses the same immutable revision when content,
    // preview and publication metadata have not changed.
    const republished = await source.publish();
    expect(republished.publication.revisionId).toBe(source.revisionId);
    const nextEpoch = await epoch();
    expect(nextEpoch).toBeGreaterThan(startEpoch);
    const visible = await read();
    expect(visible.statusCode).toBe(200);
    expect(visible.json().publication.featured).toBe(false);
    expect((await action(1, startEpoch)).statusCode).toBe(409);
    const currentList = await inject(app, {
      method: 'GET',
      url: '/api/admin/v1/publications',
      cookies: { asa_session: editor.token },
    });
    const row = currentList
      .json()
      .items.find((item: { publicationId: string }) => item.publicationId === source.publicationId);
    expect(row).toMatchObject({
      featured: false,
      editorialVersion: 1,
      lifecycleVersion: nextEpoch,
    });
    const newDecision = await action(1, nextEpoch);
    expect(newDecision.statusCode).toBe(200);
    expect(newDecision.json()).toMatchObject({ featured: true, editorialVersion: 2 });
    expect((await read()).json().publication.featured).toBe(true);
    expect(await original(source.projectId)).toEqual(before);
  });
  it('retires a featured decision after Project or Account eligibility is restored', async () => {
    const source = await publication();
    const editor = await identity('policy-editor', 'verified');
    const actionUrl = `/api/admin/v1/publications/${source.publicationId}/featured`;
    const lifecycle = async () => {
      const row = await admin.query<{ lifecycle_version: number }>(
        'SELECT lifecycle_version FROM project_publication_editorial_lifecycle WHERE publication_id=$1',
        [source.publicationId],
      );
      return row.rows[0]?.lifecycle_version ?? 0;
    };
    const setFeatured = async (expectedVersion: number, expectedLifecycleVersion: number) =>
      inject(app, {
        method: 'POST',
        url: actionUrl,
        cookies: { asa_session: editor.token },
        payload: {
          featured: true,
          expectedVersion,
          expectedRevisionId: source.revisionId,
          expectedModerationVersion: 0,
          expectedLifecycleVersion,
        },
      });
    const publicDetail = async () =>
      inject(app, { method: 'GET', url: `/api/public-projects/${source.publicationId}` });
    const versionsBefore = (
      await admin.query(
        'SELECT to_jsonb(v) AS original FROM project_versions v WHERE project_id=$1',
        [source.projectId],
      )
    ).rows;
    const draftBefore = (
      await admin.query('SELECT document_json, revision FROM project_drafts WHERE project_id=$1', [
        source.projectId,
      ])
    ).rows;

    const firstEpoch = await lifecycle();
    expect((await setFeatured(0, firstEpoch)).statusCode).toBe(200);
    expect((await publicDetail()).json().publication.featured).toBe(true);

    const actor = {
      principalId: source.owner.principalId,
      userId: source.owner.teacher.teacherId,
    };
    const target = source.owner.teacher.tenantId;
    expect((await repo.updateStatus(target, source.projectId, actor, 'archived'))?.status).toBe(
      'archived',
    );
    expect((await publicDetail()).statusCode).toBe(404);
    expect((await repo.updateStatus(target, source.projectId, actor, 'active'))?.status).toBe(
      'active',
    );
    expect((await publicDetail()).json().publication.featured).toBe(false);
    const restoredProjectEpoch = await lifecycle();
    expect(restoredProjectEpoch).toBeGreaterThan(firstEpoch);
    expect((await setFeatured(1, firstEpoch)).statusCode).toBe(409);
    expect((await setFeatured(1, restoredProjectEpoch)).statusCode).toBe(200);
    expect((await publicDetail()).json().publication.featured).toBe(true);

    await admin.query("UPDATE accounts SET status='suspended' WHERE id=$1", [
      source.owner.accountId,
    ]);
    expect((await publicDetail()).statusCode).toBe(404);
    await admin.query("UPDATE accounts SET status='active' WHERE id=$1", [source.owner.accountId]);
    expect((await publicDetail()).json().publication.featured).toBe(false);
    const restoredAccountEpoch = await lifecycle();
    expect(restoredAccountEpoch).toBeGreaterThan(restoredProjectEpoch);
    expect((await setFeatured(2, restoredProjectEpoch)).statusCode).toBe(409);
    expect((await setFeatured(2, restoredAccountEpoch)).statusCode).toBe(200);
    expect((await publicDetail()).json().publication.featured).toBe(true);

    expect(
      (
        await admin.query(
          'SELECT to_jsonb(v) AS original FROM project_versions v WHERE project_id=$1',
          [source.projectId],
        )
      ).rows,
    ).toEqual(versionsBefore);
    expect(
      (
        await admin.query(
          'SELECT document_json, revision FROM project_drafts WHERE project_id=$1',
          [source.projectId],
        )
      ).rows,
    ).toEqual(draftBefore);
  });
});
