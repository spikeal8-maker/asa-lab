import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import type pg from 'pg';
import { testAdminPool, testAppPool } from './helpers';
import { hashSessionToken } from '../../contexts/identity/dist/index.js';
import { publicScratchFixture } from '../../apps/api/src/testing/fixtures/public-scratch';
import { PublicScratchPlayerService } from '../../apps/api/src/public-scratch-player';
import { buildTestApp, inject, type NestApp } from './app';
import { studentProjectPolicyFixture } from './student-project-policy-fixture';
import { PgProjectRepository } from '../../contexts/projects/infrastructure/pg-project.repository';
import { EMPTY_DOCUMENT } from '../../contexts/electronics/domain/document';
import { createApiModuleRegistry } from '../../apps/api/src/module-registry';
import {
  createEmptyThreeDDocument,
  createThreeDNode,
} from '../../contexts/three-d/domain/document';
let admin: pg.Pool;
let runtime: pg.Pool;
let app: NestApp;
const projectIds: string[] = [];
async function fixture(scope: 'personal' | 'classroom' = 'personal') {
  const f = await studentProjectPolicyFixture(admin, runtime, scope);
  projectIds.push(f.projectId);
  return f;
}
beforeAll(async () => {
  admin = testAdminPool();
  runtime = testAppPool();
  app = await buildTestApp(runtime);
});
afterAll(async () => {
  if (admin && projectIds.length)
    await admin.query(
      "UPDATE project_publication_state SET state='revoked',revoked_at=COALESCE(revoked_at,now()) WHERE project_id=ANY($1::uuid[])",
      [projectIds],
    );
  await Promise.all([admin?.end(), app?.close()]);
});
describe('StudentSeat actual immutable publication and audited permissions', () => {
  it('reads a saved Seat project privately and keeps classroom review authority out of personal previews', async () => {
    const own = await fixture();
    const foreign = await fixture();
    const url = `/api/projects/${own.projectId}/preview`;
    const read = (token?: string) =>
      inject(app, {
        method: 'GET',
        url,
        ...(token ? { cookies: { asa_student_session: token } } : {}),
      });
    const original = await admin.query(
      'SELECT revision,document_json FROM project_drafts WHERE project_id=$1',
      [own.projectId],
    );
    const saved = await read(own.token);
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.headers['cache-control']).toBe('private, no-store');
    expect(saved.json()).toMatchObject({
      projectId: own.projectId,
      revision: original.rows[0].revision,
      document: original.rows[0].document_json,
      moduleKey: 'electronics',
    });
    expect((await read(foreign.token)).statusCode).toBe(404);
    expect((await read()).statusCode).toBe(401);
    const repository = new PgProjectRepository(runtime);
    const teacher = { principalId: own.actor, userId: own.teacher.teacherId };
    expect(await repository.load(own.teacher.tenantId, own.projectId, teacher)).not.toBeNull();
    expect(
      await repository.load(own.teacher.tenantId, own.projectId, teacher, {
        includeVersions: false,
        ownPreview: true,
      }),
    ).toBeNull();
    const after = await admin.query(
      'SELECT revision,document_json FROM project_drafts WHERE project_id=$1',
      [own.projectId],
    );
    expect(after.rows).toEqual(original.rows);
    expect(
      (
        await admin.query(
          'SELECT count(*)::int n FROM project_publication_state WHERE project_id=$1',
          [own.projectId],
        )
      ).rows[0].n,
    ).toBe(0);
  });
  it('keeps a legacy Seat assignment in the learner preview while excluding its draft from teacher template previews', async () => {
    const pupil = await fixture('classroom');
    const authored = await admin.query(
      "INSERT INTO teacher_assignments(tenant_id,owner_principal_id,title,brief,module_key,visibility) VALUES($1,$2,'Модель','Соберите схему','electronics','private') RETURNING id",
      [pupil.teacher.tenantId, pupil.actor],
    );
    const assignment = await admin.query(
      "INSERT INTO classroom_assignments(tenant_id,classroom_id,assignment_id,status,created_by) VALUES($1,$2,$3,'open',$4) RETURNING id",
      [pupil.teacher.tenantId, pupil.classroomId, authored.rows[0].id, pupil.teacher.teacherId],
    );
    await admin.query(
      'INSERT INTO classroom_assignment_work(tenant_id,assignment_id,seat_id,project_id,submitted_at) VALUES($1,$2,$3,$4,now())',
      [pupil.teacher.tenantId, assignment.rows[0].id, pupil.seatId, pupil.projectId],
    );
    const endpoint = await inject(app, {
      method: 'GET',
      url: `/api/projects/${pupil.projectId}/preview`,
      cookies: { asa_student_session: pupil.token },
    });
    expect(endpoint.statusCode, endpoint.body).toBe(200);
    const repository = new PgProjectRepository(runtime);
    const teacher = { principalId: pupil.actor, userId: pupil.teacher.teacherId };
    expect(await repository.load(pupil.teacher.tenantId, pupil.projectId, teacher)).not.toBeNull();
    expect(
      await repository.load(pupil.teacher.tenantId, pupil.projectId, teacher, {
        includeVersions: false,
        ownPreview: true,
      }),
    ).toBeNull();
  });
  it.each([
    { scope: 'personal', label: 'normal Seat-owned personal Project Core flow' },
    { scope: 'classroom', label: 'synthetic teacher-created class source assigned to Seat' },
  ] as const)(
    '$label: defaults OFF, independent overrides/inherit, no Account, frozen public read survives disable, revoke closes it',
    async ({ scope }) => {
      const f = await fixture(scope);
      expect(await f.read()).toEqual({
        publish: false,
        download: false,
        comments: false,
        version: 0,
      });
      await expect(f.publish()).rejects.toMatchObject({ code: 'P5P01' });
      expect(await f.write({ publish: true, download: false, expectedVersion: 0 })).toMatchObject({
        version: 1,
      });
      expect(
        await f.write(
          { publishOverride: 'deny', downloadOverride: 'allow', expectedVersion: 1 },
          f.seatId,
        ),
      ).toMatchObject({ version: 2 });
      await expect(f.publish()).rejects.toMatchObject({ code: 'P5P01' });
      expect(
        await f.write(
          { publishOverride: 'inherit', downloadOverride: 'allow', expectedVersion: 2 },
          f.seatId,
        ),
      ).toMatchObject({ version: 3 });
      const published = await f.publish();
      const publicationId = published.publication.publicationId;
      expect(published.canPublish).toBe(true);
      const current = await admin.query(
        'SELECT document_json FROM project_versions WHERE id=(SELECT project_version_id FROM project_publication_revisions WHERE id=$1)',
        [published.publication.revisionId],
      );
      await admin.query(
        `UPDATE project_drafts SET document_json='{"private":"v2"}'::jsonb,revision=2 WHERE project_id=$1`,
        [f.projectId],
      );
      await f.write({ publish: false, download: false, expectedVersion: 3 });
      await expect(f.publish()).rejects.toMatchObject({ code: 'P5P01' });
      const read = await runtime.query('SELECT * FROM public_projects_read($1,NULL,NULL,1,0)', [
        publicationId,
      ]);
      expect(read.rows).toHaveLength(1);
      expect(read.rows[0].author_label).toBe('Автор проекта');
      const frozen = await admin.query(
        'SELECT document_json FROM project_versions WHERE id=(SELECT project_version_id FROM project_publication_revisions WHERE id=$1)',
        [published.publication.revisionId],
      );
      expect(frozen.rows).toEqual(current.rows);
      expect(
        (await runtime.query('SELECT * FROM gallery_work($1,$2)', [f.principal, f.projectId])).rows,
      ).toEqual([]);
      expect(
        (await runtime.query("SELECT * FROM gallery_list($1,'recent',NULL,20,0)", [f.principal]))
          .rows,
      ).toEqual([]);
      expect(
        (
          await runtime.query('SELECT project_publication_status($1,$2) data', [
            f.principal,
            f.projectId,
          ])
        ).rows[0].data,
      ).toMatchObject({
        canPublish: false,
        publication: { publicPath: `#/public-projects/${publicationId}` },
      });
      expect(
        (
          await runtime.query(
            "SELECT project_distribution_seat_lock($1,$2,$3,'download') allowed",
            [f.principal, f.projectId, f.hash],
          )
        ).rows[0].allowed,
      ).toBe(true);
      await runtime.query('SELECT project_publication_revoke($1,$2)', [f.principal, f.projectId]);
      expect(
        (
          await runtime.query('SELECT * FROM public_projects_read($1,NULL,NULL,1,0)', [
            publicationId,
          ])
        ).rows,
      ).toHaveLength(0);
      const audit = await admin.query(
        "SELECT payload_json FROM audit_events WHERE entity_id=$1 AND action='classroom.projects.policy'",
        [f.classroomId],
      );
      expect(audit.rows).toHaveLength(4);
      for (const row of audit.rows)
        expect(row.payload_json).toMatchObject({
          actorId: f.actor,
          requestId: expect.any(String),
          before: expect.any(Object),
          after: expect.any(Object),
        });
    },
  );
  it.each(['suspended', 'removed'])(
    'blocks inactive Seat %s, cross-scope teacher and stale CAS',
    async (status) => {
      const f = await fixture();
      const other = await fixture();
      expect(
        (
          await runtime.query('SELECT classroom_project_policy_read($1,$2,$3,NULL) data', [
            other.actor,
            f.teacher.tenantId,
            f.classroomId,
          ])
        ).rows[0].data,
      ).toBeNull();
      await f.write(
        { publishOverride: 'allow', downloadOverride: 'deny', expectedVersion: 0 },
        f.seatId,
      );
      expect(await f.write({ publish: true, download: true, expectedVersion: 0 })).toEqual({
        error: 'version_conflict',
      });
      await admin.query('UPDATE classroom_student_seats SET status=$2 WHERE id=$1', [
        f.seatId,
        status,
      ]);
      await expect(f.publish()).rejects.toMatchObject({ code: 'P5P01' });
    },
  );
  it('serializes competing CAS on the class and policy revoke against a transaction publishing', async () => {
    const f = await fixture();
    const result = await Promise.all([
      f.write({ publish: true, download: false, expectedVersion: 0 }),
      f.write({ publish: true, download: false, expectedVersion: 0 }),
    ]);
    expect(result.filter((r) => r.error === 'version_conflict')).toHaveLength(1);
    const approved = await f.approvedRequest();
    const writer = await runtime.connect();
    const revoker = await runtime.connect();
    try {
      await writer.query('BEGIN');
      await f.publishApproved(approved, writer);
      await revoker.query('BEGIN');
      await revoker.query("SET LOCAL lock_timeout='100ms'");
      await expect(
        revoker.query('SELECT classroom_project_policy_write($1,$2,$3,NULL,$4::jsonb,$5)', [
          f.actor,
          f.teacher.tenantId,
          f.classroomId,
          JSON.stringify({ publish: false, download: false, expectedVersion: 1 }),
          'concurrent-revoke',
        ]),
      ).rejects.toMatchObject({ code: '55P03' });
      await revoker.query('ROLLBACK');
      await writer.query('COMMIT');
    } finally {
      await writer.query('ROLLBACK');
      await revoker.query('ROLLBACK');
      writer.release();
      revoker.release();
    }
  });
  it('assembled HTTP rejects conflicting sessions and raw Seat publication commands', async () => {
    const f = await fixture();
    for (const options of [
      { method: 'GET' as const, url: `/api/projects/${f.projectId}/publication` },
      { method: 'POST' as const, url: `/api/projects/${f.projectId}/publication`, payload: {} },
      {
        method: 'PUT' as const,
        url: `/api/project-distribution/classrooms/${f.classroomId}/policy`,
        payload: { publish: true, download: true, expectedVersion: 0 },
      },
    ]) {
      const conflict = await inject(app, {
        ...options,
        cookies: { asa_student_session: f.token, asa_session: 'unrelated-account-token' },
      });
      expect(conflict.statusCode, conflict.body).toBe(409);
      expect(conflict.json()).toMatchObject({ error: { code: 'session_conflict' } });
    }
    expect(
      (
        await admin.query(
          'SELECT count(*)::int n FROM project_publication_state WHERE project_id=$1',
          [f.projectId],
        )
      ).rows[0].n,
    ).toBe(0);
    expect(await f.read()).toEqual({
      publish: false,
      download: false,
      comments: false,
      version: 0,
    });
    const request = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown) =>
      inject(app, {
        method,
        url,
        payload,
        cookies: { asa_student_session: f.token },
      });
    const status = await request('GET', `/api/projects/${f.projectId}/publication`);
    expect(status.statusCode, status.body).toBe(200);
    expect(status.json().canPublish).toBe(false);
    expect(status.json().requiresApproval).toBe(true);
    const policy = await request(
      'PUT',
      `/api/project-distribution/classrooms/${f.classroomId}/policy`,
      { publish: true, download: true, expectedVersion: 0 },
    );
    expect(policy.statusCode, policy.body).toBe(403);
    await f.write({ publish: true, download: false, expectedVersion: 0 });
    const forged = await request('POST', `/api/projects/${f.projectId}/publication`, {
      principalId: f.actor,
    });
    expect(forged.statusCode, forged.body).toBe(400);
    const raw = await request('POST', `/api/projects/${f.projectId}/publication`, {});
    expect(raw.statusCode, raw.body).toBe(403);
    const published = await f.publish();
    const endpoint = `/api/projects/${f.projectId}/publication`;
    const consent = await request('POST', endpoint + '/acquisition', {
      allowed: true,
      expectedVersion: published.acquisition.version,
      expectedRevisionId: published.publication.revisionId,
    });
    expect(consent.statusCode, consent.body).toBe(200);
    expect(consent.json()).toMatchObject({
      requiresApproval: true,
      acquisition: { allowed: true, version: published.acquisition.version + 1 },
      publication: { revisionId: published.publication.revisionId, state: 'public' },
    });
    const revoked = await request('DELETE', endpoint);
    expect(revoked.statusCode, revoked.body).toBe(200);
    expect(revoked.json()).toMatchObject({
      requiresApproval: true,
      publication: {
        revisionId: published.publication.revisionId,
        state: 'revoked',
        publicPath: null,
      },
    });
    const bypass = await request('POST', endpoint, {});
    expect(bypass.statusCode, bypass.body).toBe(403);
    await admin.query(
      'UPDATE classroom_student_sessions SET revoked_at=now() WHERE token_hash=$1',
      [f.hash],
    );
    const denied = await request('POST', `/api/projects/${f.projectId}/publication`, {});
    expect(denied.statusCode, denied.body).toBe(401);
  });
  it('keeps two scoped approvals private and publishes exactly the reviewed Seat candidate', async () => {
    const f = await fixture();
    const outsider = await fixture();
    const platform = await f.platformReviewer();
    await f.write({ publish: true, download: false, expectedVersion: 0 });
    await expect(f.rawPublish()).rejects.toMatchObject({ code: 'P5P01' });
    const key = randomUUID();
    const metadata = {
      title: 'Только согласованная версия',
      tags: [' Лаборатория ', 'лаборатория'],
    };
    const [created, retried] = await Promise.all([
      f.publicationRequest(1, metadata, key),
      f.publicationRequest(1, metadata, key),
    ]);
    expect(created).toMatchObject({
      state: 'waiting_teacher',
      sourceRevision: 1,
      metadata: { title: metadata.title, tags: ['лаборатория'] },
    });
    const id = created.requestId as string;
    expect(retried).toEqual(created);
    await expect(f.publicationRequest(1, { title: 'Другая версия' }, key)).rejects.toMatchObject({
      code: 'P5A09',
    });
    const queue = async (actor: string, role: string, classroom: string | null) =>
      (
        await runtime.query('SELECT classroom_publication_request_queue($1,$2,$3,20,0) data', [
          actor,
          role,
          classroom,
        ])
      ).rows.map((row) => row.data);
    const raster = async (actor: string, role: string) =>
      (
        await runtime.query('SELECT * FROM classroom_publication_request_raster($1,$2,$3,$4)', [
          actor,
          role,
          role === 'teacher' ? f.classroomId : null,
          id,
        ])
      ).rows;
    expect(await queue(f.actor, 'teacher', f.classroomId)).toEqual([created]);
    expect(await queue(outsider.actor, 'teacher', f.classroomId)).toEqual([]);
    expect(await queue(platform, 'platform', null)).not.toContainEqual(created);
    expect(await raster(outsider.actor, 'teacher')).toEqual([]);
    expect(await raster(platform, 'platform')).toEqual([]);
    expect(await raster(f.actor, 'teacher')).toMatchObject([
      { image: Buffer.alloc(64, 17), content_type: 'image/png', width: 16, height: 16 },
    ]);
    await expect(f.reviewPublication(id, 'platform')).rejects.toMatchObject({ code: 'P5P04' });
    await expect(f.reviewPublication(id, 'teacher', true, outsider.actor)).rejects.toMatchObject({
      code: 'P5P04',
    });
    await expect(f.publishApproved(id)).rejects.toMatchObject({ code: 'P5A09' });
    const teacherApproved = await f.reviewPublication(id, 'teacher');
    expect(teacherApproved.state).toBe('waiting_platform');
    expect(await f.reviewPublication(id, 'teacher')).toEqual(teacherApproved);
    expect(await raster(f.actor, 'teacher')).toEqual([]);
    expect(await queue(platform, 'platform', null)).toContainEqual(teacherApproved);
    expect(await raster(platform, 'platform')).toHaveLength(1);
    await expect(f.reviewPublication(id, 'platform', true, f.actor)).rejects.toMatchObject({
      code: 'P5P04',
    });
    await expect(f.publishApproved(id)).rejects.toMatchObject({ code: 'P5A09' });
    expect((await f.reviewPublication(id, 'platform')).state).toBe('approved');
    expect((await f.reviewPublication(id, 'platform')).state).toBe('approved');
    expect(await raster(platform, 'platform')).toEqual([]);
    expect(
      (
        await runtime.query('SELECT * FROM public_projects_read(NULL,$1,NULL,10,0)', [
          metadata.title,
        ])
      ).rows,
    ).toEqual([]);
    await expect(
      runtime.query('SELECT * FROM classroom_publication_requests WHERE id=$1', [id]),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      runtime.query('SELECT classroom_publication_source_digest($1,$2,$3)', [
        f.projectId,
        f.teacher.tenantId,
        1,
      ]),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      runtime.query('SELECT classroom_publication_request_publish($1,$2,$3,$4)', [
        outsider.principal,
        f.projectId,
        outsider.hash,
        id,
      ]),
    ).rejects.toMatchObject({ code: 'P5P01' });
    const [first, second] = await Promise.all([f.publishApproved(id), f.publishApproved(id)]);
    expect(first).toEqual(second);
    expect(first).toMatchObject({ state: 'published', metadata: { title: metadata.title } });
    expect(
      (
        await runtime.query('SELECT * FROM public_projects_read($1,NULL,NULL,1,0)', [
          first.publicationId,
        ])
      ).rows[0],
    ).toMatchObject({ revision_id: first.publicationRevisionId, title: metadata.title });
  });

  it('returns the sealed saved 3D model to the originating teacher even when the cover depicts something else', async () => {
    const f = await fixture();
    const outsider = await fixture();
    const node = {
      ...createThreeDNode('box', 'actual-classroom-model'),
      name: 'Действительная модель',
    };
    const document = { ...createEmptyThreeDDocument(), nodes: [node] };
    await admin.query("UPDATE projects SET module_key='three-d' WHERE id=$1", [f.projectId]);
    await admin.query('UPDATE project_drafts SET document_json=$2::jsonb WHERE project_id=$1', [
      f.projectId,
      JSON.stringify(document),
    ]);
    await f.write({ publish: true, download: false, expectedVersion: 0 });
    const author = { asa_student_session: f.token };
    const endpoint = `/api/projects/${f.projectId}/publication/approval`;
    const proposed = { sourceRevision: 1, metadata: { title: 'Проверяемая модель' } };
    const forged = await inject(app, {
      method: 'POST',
      url: endpoint,
      cookies: author,
      headers: { 'idempotency-key': randomUUID() },
      payload: { ...proposed, artifact: { nodes: [] } },
    });
    expect(forged.statusCode).toBe(400);
    const submitted = await inject(app, {
      method: 'POST',
      url: endpoint,
      cookies: author,
      headers: { 'idempotency-key': randomUUID() },
      payload: proposed,
    });
    expect(submitted.statusCode, submitted.body).toBe(200);
    const requestId = submitted.json().requestId as string;
    const login = await inject(app, {
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        workspace: f.teacher.workspace,
        email: f.teacher.email,
        password: f.teacher.password,
      },
    });
    expect(login.statusCode, login.body).toBe(200);
    const teacher = {
      asa_session: login.cookies.find((cookie) => cookie.name === 'asa_session')!.value,
    };
    const requestPath = (classroomId: string, target = requestId) =>
      `/api/project-distribution/classrooms/${classroomId}/publication-requests/${target}`;
    const scoped = requestPath(f.classroomId);
    const artifact = await inject(app, {
      method: 'GET',
      url: scoped + '/artifact',
      cookies: teacher,
    });
    expect(artifact.statusCode, artifact.body).toBe(200);
    expect(artifact.headers['cache-control']).toBe('private, no-store');
    expect(artifact.json()).toMatchObject({
      requestId,
      sourceRevision: 1,
      artifact: {
        provenance: { publicationId: requestId, revisionNumber: 1 },
        capabilities: { readOnly: true, download: false },
        nodes: [{ id: node.id, name: node.name }],
      },
    });
    expect(artifact.body).not.toContain(f.projectId);
    expect(artifact.json()).not.toHaveProperty('document');
    const cover = await inject(app, { method: 'GET', url: scoped + '/cover', cookies: teacher });
    expect(cover.statusCode).toBe(200);
    const coverHeaders = {
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
      'cross-origin-resource-policy': 'same-origin',
    };
    expect(cover.headers).toMatchObject(coverHeaders);
    expect(cover.rawPayload).toEqual(Buffer.alloc(64, 17));
    for (const [url, cookies, status] of [
      [requestPath(outsider.classroomId) + '/artifact', teacher, 404],
      [scoped + '/artifact', author, 403],
      [`/api/public-projects/${requestId}/artifact?revisionId=${requestId}`, {}, 404],
    ] as const) {
      const read = await inject(app, { method: 'GET', url, cookies });
      expect(read.statusCode).toBe(status);
    }
    await admin.query('UPDATE project_drafts SET revision=2 WHERE project_id=$1', [f.projectId]);
    const stale = await inject(app, { method: 'GET', url: scoped + '/artifact', cookies: teacher });
    expect(stale.statusCode).toBe(404);
    const decision = await inject(app, {
      method: 'POST',
      url: scoped + '/decision',
      cookies: teacher,
      payload: { approve: true },
    });
    expect(decision.json()).toEqual({ requestId, state: 'stale' });

    await admin.query('UPDATE project_snapshots SET source_revision=2 WHERE project_id=$1', [
      f.projectId,
    ]);
    const replacement = await inject(app, {
      method: 'POST',
      url: endpoint,
      cookies: author,
      headers: { 'idempotency-key': randomUUID() },
      payload: { ...proposed, sourceRevision: 2 },
    });
    expect(replacement.statusCode, replacement.body).toBe(200);
    const nextId = replacement.json().requestId as string;
    const platformAccount = (await f.platformAccount()).credentials;
    const platformLogin = await inject(app, {
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        workspace: platformAccount.workspace,
        email: platformAccount.email,
        password: platformAccount.password,
      },
    });
    expect(platformLogin.statusCode, platformLogin.body).toBe(200);
    const platform = {
      asa_session: platformLogin.cookies.find((entry) => entry.name === 'asa_session')!.value,
    };
    const platformPath = `/api/admin/v1/publications/student-requests/${nextId}`;
    const readPlatform = (cookies: Record<string, string>, suffix = 'artifact') =>
      inject(app, { method: 'GET', url: platformPath + '/' + suffix, cookies });
    expect((await readPlatform(platform)).statusCode).toBe(404);
    expect((await readPlatform(teacher)).statusCode).toBe(403);
    const mixed = await readPlatform({ ...platform, ...author });
    expect(mixed.statusCode, mixed.body).toBe(409);
    expect(mixed.json()).toMatchObject({ error: { code: 'session_conflict' } });
    const publish = (cookies: Record<string, string>) =>
      inject(app, {
        method: 'POST',
        url: endpoint + '/' + nextId + '/publish',
        cookies,
        payload: {},
      });
    expect((await publish(author)).statusCode).toBe(409);
    const teacherApproved = await inject(app, {
      method: 'POST',
      url: requestPath(f.classroomId, nextId) + '/decision',
      cookies: teacher,
      payload: { approve: true },
    });
    expect(teacherApproved.json()).toMatchObject({ state: 'waiting_platform' });
    const platformArtifact = await readPlatform(platform);
    expect(platformArtifact.statusCode, platformArtifact.body).toBe(200);
    expect(platformArtifact.json()).toMatchObject({
      requestId: nextId,
      sourceRevision: 2,
      artifact: {
        provenance: { publicationId: nextId, revisionNumber: 2 },
        nodes: [{ id: node.id }],
      },
    });
    expect((await readPlatform(platform, 'cover')).headers).toMatchObject(coverHeaders);
    const platformApproved = await inject(app, {
      method: 'POST',
      url: platformPath + '/decision',
      cookies: platform,
      payload: { approve: true },
    });
    expect(platformApproved.json()).toMatchObject({ state: 'approved' });
    expect((await publish(teacher)).statusCode).toBe(403);
    const published = await publish(author);
    expect(published.statusCode, published.body).toBe(200);
    expect(published.json()).toMatchObject({
      state: 'published',
      requestId: nextId,
      publicationId: expect.any(String),
    });
  });

  it('keeps the prior public revision during replacement review and invalidates a changed or protected candidate', async () => {
    const f = await fixture();
    await f.write({ publish: true, download: false, expectedVersion: 0 });
    const first = (await f.publish()).publication;
    const publicRevision = async () =>
      (
        await runtime.query('SELECT revision_id FROM public_projects_read($1,NULL,NULL,1,0)', [
          first.publicationId,
        ])
      ).rows;
    const nextSource = createApiModuleRegistry()
      .get('electronics')!
      .provider!.validate({
        ...EMPTY_DOCUMENT,
        components: [
          { id: 'revision-two', kind: 'resistor', position: { x: 0, y: 0 }, value: 330 },
        ],
      });
    if (!nextSource.ok) throw new Error('replacement Electronics fixture must validate');
    await admin.query(
      'UPDATE project_drafts SET revision=2,document_json=$2::jsonb WHERE project_id=$1',
      [f.projectId, JSON.stringify(nextSource.payload)],
    );
    await admin.query(
      'UPDATE project_snapshots SET source_revision=2,image=$2 WHERE project_id=$1',
      [f.projectId, Buffer.alloc(64, 18)],
    );
    const next = (await f.publicationRequest(2, { title: 'Следующая версия' })).requestId;
    expect(await publicRevision()).toEqual([{ revision_id: first.revisionId }]);
    await f.reviewPublication(next, 'teacher');
    expect(await publicRevision()).toEqual([{ revision_id: first.revisionId }]);
    await admin.query('UPDATE project_snapshots SET image=$2 WHERE project_id=$1', [
      f.projectId,
      Buffer.alloc(64, 19),
    ]);
    expect(
      (
        await runtime.query('SELECT * FROM classroom_publication_request_raster($1,$2,$3,$4)', [
          await f.platformReviewer(),
          'platform',
          null,
          next,
        ])
      ).rows,
    ).toEqual([]);
    expect(await f.reviewPublication(next, 'platform')).toEqual({
      requestId: next,
      state: 'stale',
    });
    await expect(f.publishApproved(next)).rejects.toMatchObject({ code: 'P5A09' });
    expect(await publicRevision()).toEqual([{ revision_id: first.revisionId }]);
    const reviewed = await f.approvedRequest(2);
    await admin.query(
      'UPDATE project_drafts SET revision=3,document_json=$2::jsonb WHERE project_id=$1',
      [f.projectId, JSON.stringify(EMPTY_DOCUMENT)],
    );
    expect(await f.publishApproved(reviewed)).toEqual({ requestId: reviewed, state: 'stale' });
    expect(await publicRevision()).toEqual([{ revision_id: first.revisionId }]);
    await admin.query('UPDATE project_snapshots SET source_revision=3 WHERE project_id=$1', [
      f.projectId,
    ]);
    const replacement = await f.approvedRequest(3);
    await admin.query('UPDATE classroom_student_seats SET safe_mode=true WHERE id=$1', [f.seatId]);
    await expect(f.publishApproved(replacement)).rejects.toMatchObject({ code: 'P5P01' });
    await expect(f.publicationRequest(3)).rejects.toMatchObject({ code: 'P5P01' });
    expect(await publicRevision()).toEqual([]);
    await admin.query('UPDATE classroom_student_seats SET safe_mode=false WHERE id=$1', [f.seatId]);
    await expect(f.publishApproved(replacement)).rejects.toMatchObject({ code: 'P5P01' });
    expect(await publicRevision()).toEqual([]);
  });
  it('serializes final publication behind a writer and requires new approval after the save commits', async () => {
    const f = await fixture();
    await f.write({ publish: true, download: false, expectedVersion: 0 });
    const candidate = await f.approvedRequest();
    const saver = await admin.connect();
    const publisher = await runtime.connect();
    try {
      await saver.query('BEGIN');
      await saver.query('SELECT 1 FROM projects WHERE id=$1 FOR UPDATE', [f.projectId]);
      await saver.query('UPDATE project_drafts SET revision=2 WHERE project_id=$1', [f.projectId]);
      await publisher.query('BEGIN');
      await publisher.query("SET LOCAL lock_timeout='100ms'");
      await expect(f.publishApproved(candidate, publisher)).rejects.toMatchObject({
        code: '55P03',
      });
      await publisher.query('ROLLBACK');
      await saver.query('COMMIT');
      expect(await f.publishApproved(candidate)).toEqual({ requestId: candidate, state: 'stale' });
      expect(
        (
          await admin.query('SELECT id FROM project_publication_state WHERE project_id=$1', [
            f.projectId,
          ])
        ).rows,
      ).toEqual([]);
    } finally {
      await Promise.all([saver.query('ROLLBACK'), publisher.query('ROLLBACK')]);
      saver.release();
      publisher.release();
    }
  });
  it('keeps durable protected origin, helper grants and exact publication moderation fail-closed', async () => {
    const f = await fixture();
    await f.write({ publish: true, download: true, expectedVersion: 0 });
    const publication = (await f.publish()).publication;
    await admin.query(
      `INSERT INTO project_publication_moderation(publication_id,hidden,reason,actor_principal_id) VALUES($1,true,'Review required',$2)`,
      [publication.publicationId, f.actor],
    );
    expect(
      (
        await runtime.query('SELECT * FROM public_projects_read($1,NULL,NULL,1,0)', [
          publication.publicationId,
        ])
      ).rows,
    ).toEqual([]);
    expect(
      (
        await runtime.query('SELECT project_publication_status($1,$2) data', [
          f.principal,
          f.projectId,
        ])
      ).rows[0].data.moderationReason,
    ).toBe('Review required');
    await admin.query(
      `INSERT INTO learning_legacy_project_origins(project_id,project_tenant_id,school_tenant_id,source_work_id,claimed_at) VALUES($1,$2,$2,$3,now())`,
      [f.projectId, f.teacher.tenantId, crypto.randomUUID()],
    );
    await expect(f.publish()).rejects.toMatchObject({ code: 'P5P01' });
    expect(
      (
        await runtime.query(
          `SELECT has_function_privilege('asalab_app','public.project_publication_publish_admitted(uuid,uuid,jsonb)','EXECUTE') allowed`,
        )
      ).rows[0].allowed,
    ).toBe(false);
  });
  it('issues a private Scratch player with exact sprite and sound assets only while the matching review stage is current', async () => {
    const f = await fixture();
    const outsider = await fixture();
    const seen = publicScratchFixture();
    const wave = Buffer.alloc(48);
    wave.write('RIFF', 0);
    wave.writeUInt32LE(40, 4);
    wave.write('WAVEfmt ', 8);
    wave.writeUInt32LE(16, 16);
    wave.writeUInt16LE(1, 20);
    wave.writeUInt16LE(1, 22);
    wave.writeUInt32LE(8000, 24);
    wave.writeUInt32LE(16000, 28);
    wave.writeUInt16LE(2, 32);
    wave.writeUInt16LE(16, 34);
    wave.write('data', 36);
    wave.writeUInt32LE(4, 40);
    wave.writeInt16LE(1024, 46);
    const otherWave = Buffer.from(wave);
    otherWave.writeInt16LE(24, 46);
    const audioRef = (bytes: Buffer) => ({
      dataFormat: 'wav' as const,
      assetId: createHash('md5').update(bytes).digest('hex'),
      sha256: createHash('sha256').update(bytes).digest('hex'),
      sizeBytes: bytes.length,
    });
    const sound = audioRef(wave),
      unrelated = audioRef(otherWave);
    const tenant = f.teacher.tenantId;
    for (const ref of [seen.ref, sound, unrelated]) {
      await admin.query(
        'INSERT INTO blocks_blobs(tenant_id,sha256,data_format,size_bytes,object_key) VALUES($1,$2,$3,$4,$5)',
        [
          tenant,
          ref.sha256,
          ref.dataFormat,
          ref.sizeBytes,
          `tenants/${tenant}/blocks/assets/${ref.sha256.slice(0, 2)}/${ref.sha256}.${ref.dataFormat}`,
        ],
      );
      await admin.query(
        'INSERT INTO blocks_asset_aliases(tenant_id,asset_id,data_format,sha256) VALUES($1,$2,$3,$4)',
        [tenant, ref.assetId, ref.dataFormat, ref.sha256],
      );
    }
    const sprite = {
      ...seen.document.projectJson.targets[0],
      isStage: false,
      name: 'Review sprite',
      layerOrder: 1,
      variables: {},
      blocks: {},
      x: 0,
      y: 0,
      size: 100,
      direction: 90,
      draggable: false,
      rotationStyle: 'all around',
      visible: true,
      sounds: [
        {
          name: 'Review sound',
          assetId: sound.assetId,
          dataFormat: 'wav',
          md5ext: sound.assetId + '.wav',
          rate: 8000,
          sampleCount: 2,
          format: '',
        },
      ],
    };
    const privateOrigin = 'https://classroom.test/private/previous-version';
    const hiddenMetadata = { reference: [privateOrigin] };
    const stage = seen.document.projectJson.targets[0]!;
    const procedure = {
      tagName: 'mutation',
      proccode: 'remember %s',
      argumentids: '["message"]',
      argumentnames: '["message"]',
      argumentdefaults: '["visible default"]',
      warp: 'false',
    };
    const document = {
      ...seen.document,
      projectJson: {
        ...seen.document.projectJson,
        meta: { ...seen.document.projectJson.meta, origin: privateOrigin },
        privateSource: privateOrigin,
        targets: [
          {
            ...stage,
            blocks: {
              ...stage.blocks,
              change: {
                ...stage.blocks.change,
                fields: { VARIABLE: ['counter', 'counter', hiddenMetadata] },
              },
              prototype: {
                opcode: 'procedures_prototype',
                mutation: { ...procedure, children: [hiddenMetadata], layoutCache: hiddenMetadata },
              },
            },
          },
          sprite,
        ],
        monitors: seen.document.projectJson.monitors.map((monitor) => ({
          ...monitor,
          params: { ...monitor.params, provenance: hiddenMetadata },
        })),
      },
      assets: [seen.ref, sound],
    };
    await admin.query("UPDATE projects SET module_key='blocks' WHERE id=$1", [f.projectId]);
    await admin.query('UPDATE project_drafts SET document_json=$2::jsonb WHERE project_id=$1', [
      f.projectId,
      JSON.stringify(document),
    ]);
    await f.write({ publish: true, download: false, expectedVersion: 0 });
    const created = await f.publicationRequest(1);
    const id = created.requestId as string;
    const origin = 'http://127.0.0.1:4612';
    const teacher = { actor: f.actor, role: 'teacher' as const, classroomId: f.classroomId };
    const platform = {
      actor: await f.platformReviewer(),
      role: 'platform' as const,
      classroomId: null,
    };
    const service = new PublicScratchPlayerService(
      runtime,
      {
        ASA_BLOCKS_RUNTIME_ORIGIN: origin,
        ASA_BLOCKS_RUNTIME_SIGNING_KEY: '0123456789abcdef'.repeat(4),
      },
      {
        blobs: {
          open: async ({ sha256 }) => {
            const bytes =
              sha256 === sound.sha256 ? wave : sha256 === seen.ref.sha256 ? seen.bytes : null;
            return bytes
              ? (async function* () {
                  yield bytes;
                })()
              : null;
          },
        },
      },
    );
    await expect(service.issueStudentReview(platform, id)).rejects.toMatchObject({ status: 404 });
    await expect(
      service.issueStudentReview({ ...teacher, actor: outsider.actor }, id),
    ).rejects.toMatchObject({ status: 404 });
    const boot = await service.issueStudentReview(teacher, id);
    expect(JSON.stringify(boot.projectJson)).not.toContain(privateOrigin);
    expect(boot.projectJson.targets).toMatchObject([
      {
        blocks: {
          change: { fields: { VARIABLE: ['counter', 'counter'] } },
          prototype: { mutation: { ...procedure, children: [] } },
        },
      },
      { name: 'Review sprite', sounds: [{ assetId: sound.assetId }] },
    ]);
    expect(boot.projectJson.monitors).toEqual(seen.document.projectJson.monitors);
    const target = { publicationId: id, revisionId: id };
    const body = await service.asset(target, boot.runtimeToken, origin, sound.assetId, 'wav');
    try {
      for await (const bytes of body.body) expect(bytes).toEqual(wave);
    } finally {
      body.release();
    }
    await expect(
      service.asset(target, boot.runtimeToken, origin, unrelated.assetId, 'wav'),
    ).rejects.toMatchObject({ status: 404 });
    await f.reviewPublication(id, 'teacher');
    await expect(
      service.asset(target, boot.runtimeToken, origin, sound.assetId, 'wav'),
    ).rejects.toMatchObject({ status: 404 });
    const moderatorBoot = await service.issueStudentReview(platform, id);
    expect(moderatorBoot.sourceRevision).toBe(1);
    await admin.query('UPDATE project_drafts SET revision=2 WHERE project_id=$1', [f.projectId]);
    await expect(
      service.asset(target, moderatorBoot.runtimeToken, origin, sound.assetId, 'wav'),
    ).rejects.toMatchObject({ status: 404 });
    expect(await f.reviewPublication(id, 'platform')).toEqual({ requestId: id, state: 'stale' });
    await admin.query('UPDATE project_snapshots SET source_revision=2 WHERE project_id=$1', [
      f.projectId,
    ]);
    const approved = await f.approvedRequest(2);
    const published = await f.publishApproved(approved);
    const publicView = await service.issue({
      publicationId: published.publicationId,
      revisionId: published.publicationRevisionId,
    });
    expect(publicView.projectJson).toEqual(boot.projectJson);
    expect(publicView.assets).toEqual(boot.assets);
    expect(JSON.stringify(publicView.projectJson)).not.toContain(privateOrigin);
    const original = await admin.query(
      "SELECT version.document_json#>>'{projectJson,meta,origin}' AS origin FROM project_versions version JOIN project_publication_revisions revision ON revision.project_version_id=version.id WHERE revision.id=$1",
      [published.publicationRevisionId],
    );
    expect(original.rows[0].origin).toBe(privateOrigin);
  });

  it('Seat-owned Scratch bootstrap and referenced asset stay frozen and readable after permission disable', async () => {
    const f = await fixture();
    const scratch = publicScratchFixture();
    await admin.query(`UPDATE projects SET module_key='blocks' WHERE id=$1`, [f.projectId]);
    await admin.query('UPDATE project_drafts SET document_json=$2::jsonb WHERE project_id=$1', [
      f.projectId,
      JSON.stringify(scratch.document),
    ]);
    const key = `tenants/${f.teacher.tenantId}/blocks/assets/${scratch.ref.sha256.slice(0, 2)}/${scratch.ref.sha256}.svg`;
    await admin.query(
      "INSERT INTO blocks_blobs(tenant_id,sha256,data_format,size_bytes,object_key) VALUES($1,$2,'svg',$3,$4)",
      [f.teacher.tenantId, scratch.ref.sha256, scratch.bytes.length, key],
    );
    await admin.query(
      "INSERT INTO blocks_asset_aliases(tenant_id,asset_id,data_format,sha256) VALUES($1,$2,'svg',$3)",
      [f.teacher.tenantId, scratch.ref.assetId, scratch.ref.sha256],
    );
    await f.write({ publish: true, download: false, expectedVersion: 0 });
    const binding = (await f.publish()).publication;
    const origin = 'http://127.0.0.1:4612';
    const service = new PublicScratchPlayerService(
      runtime,
      {
        ASA_BLOCKS_RUNTIME_ORIGIN: origin,
        ASA_BLOCKS_RUNTIME_SIGNING_KEY: '0123456789abcdef'.repeat(4),
      },
      {
        blobs: {
          open: async () =>
            (async function* () {
              yield scratch.bytes;
            })(),
        } as never,
      },
    );
    const first = await service.issue(binding);
    await f.write({ publish: false, download: false, expectedVersion: 1 });
    await expect(f.publish()).rejects.toMatchObject({ code: 'P5P01' });
    expect((await service.issue(binding)).projectJson).toEqual(first.projectJson);
    const asset = await service.asset(
      binding,
      first.runtimeToken,
      origin,
      scratch.ref.assetId,
      'svg',
    );
    const chunks = [];
    for await (const bytes of asset.body) chunks.push(bytes);
    expect(Buffer.concat(chunks)).toEqual(scratch.bytes);
    await expect(
      service.asset(binding, first.runtimeToken, origin, '00000000000000000000000000000000', 'svg'),
    ).rejects.toMatchObject({ status: 404 });
    await admin.query("UPDATE classroom_student_seats SET status='suspended' WHERE id=$1", [
      f.seatId,
    ]);
    await expect(service.issue(binding)).rejects.toMatchObject({ status: 404 });
  });
  it('computes download rights independently of ownership of a foreign readable publication', async () => {
    const viewer = await fixture();
    const author = await fixture();
    await author.write({ publish: true, download: false, expectedVersion: 0 });
    const publication = (await author.publish()).publication;
    const rights = async () =>
      (
        await runtime.query('SELECT classroom_project_admission_lock($1,$2,$3,$4,$5) data', [
          viewer.principal,
          viewer.teacher.tenantId,
          viewer.classroomId,
          viewer.seatId,
          viewer.hash,
        ])
      ).rows[0].data;
    expect(await rights()).toMatchObject({ publish: false, download: false });
    await viewer.write(
      { publishOverride: 'deny', downloadOverride: 'allow', expectedVersion: 0 },
      viewer.seatId,
    );
    expect(await rights()).toMatchObject({ publish: false, download: true });
    expect(
      (
        await runtime.query('SELECT * FROM public_projects_read($1,NULL,NULL,1,0)', [
          publication.publicationId,
        ])
      ).rows,
    ).toHaveLength(1);
    expect(
      (
        await runtime.query('SELECT * FROM gallery_work($1,$2)', [
          viewer.principal,
          author.projectId,
        ])
      ).rows,
    ).toEqual([]);
    expect(
      (
        await runtime.query('SELECT classroom_project_admission_lock($1,$2,$3,$4,$5) data', [
          viewer.principal,
          author.teacher.tenantId,
          author.classroomId,
          author.seatId,
          viewer.hash,
        ])
      ).rows[0].data,
    ).toBeNull();
  });
  it.each(['learner', 'link'] as const)(
    'retires both featured and pinned decisions after %s disable and restore',
    async (target) => {
      const f = await fixture();
      await f.write({ publish: true, download: false, expectedVersion: 0 });
      const publication = (await f.publish()).publication;
      const identity = (
        await admin.query(
          "SELECT id,learner_identity_id FROM learner_identity_links WHERE seat_id=$1 AND link_kind='student_seat'",
          [f.seatId],
        )
      ).rows[0];
      const epoch = async () =>
        (
          await admin.query(
            'SELECT lifecycle_version FROM project_publication_editorial_lifecycle WHERE publication_id=$1',
            [publication.publicationId],
          )
        ).rows[0].lifecycle_version as number;
      const flags = async () =>
        (
          await runtime.query(
            'SELECT project_publication_featured($1,$2) featured,project_publication_pinned($1,$2) pinned',
            [publication.publicationId, publication.revisionId],
          )
        ).rows[0];
      const initialEpoch = await epoch();
      await admin.query(
        `INSERT INTO project_publication_editorial(publication_id,revision_id,featured,editorial_version,moderation_version,lifecycle_version,actor_principal_id)
      VALUES($1,$2,true,1,0,$3,$4)`,
        [publication.publicationId, publication.revisionId, initialEpoch, f.actor],
      );
      await admin.query(
        `INSERT INTO project_publication_pin(publication_id,revision_id,pinned,pin_version,moderation_version,lifecycle_version,actor_principal_id)
      VALUES($1,$2,true,1,0,$3,$4)`,
        [publication.publicationId, publication.revisionId, initialEpoch, f.actor],
      );
      expect(await flags()).toEqual({ featured: true, pinned: true });
      // Ordinary metadata and no-op updates of dependency columns do not retire decisions.
      await admin.query('UPDATE learner_identities SET updated_at=now(),state=state WHERE id=$1', [
        identity.learner_identity_id,
      ]);
      await admin.query(
        "UPDATE learner_identity_links SET created_at=created_at+interval '1 second',status=status,disabled_at=disabled_at WHERE id=$1",
        [identity.id],
      );
      expect(await epoch()).toBe(initialEpoch);
      await f.write({ publish: false, download: true, expectedVersion: 1 });
      expect(await epoch()).toBe(initialEpoch);
      expect(await flags()).toEqual({ featured: true, pinned: true });
      expect(
        (
          await runtime.query('SELECT * FROM public_projects_read($1,NULL,NULL,1,0)', [
            publication.publicationId,
          ])
        ).rows,
      ).toHaveLength(1);
      if (target === 'learner') {
        await admin.query("UPDATE learner_identities SET state='inactive' WHERE id=$1", [
          identity.learner_identity_id,
        ]);
      } else {
        await admin.query(
          "UPDATE learner_identity_links SET status='inactive',disabled_at=now() WHERE id=$1",
          [identity.id],
        );
      }
      expect(await epoch()).toBe(initialEpoch + 1);
      expect(await flags()).toEqual({ featured: false, pinned: false });
      expect(
        (
          await runtime.query('SELECT * FROM public_projects_read($1,NULL,NULL,1,0)', [
            publication.publicationId,
          ])
        ).rows,
      ).toHaveLength(0);
      if (target === 'learner') {
        await admin.query("UPDATE learner_identities SET state='active' WHERE id=$1", [
          identity.learner_identity_id,
        ]);
      } else {
        // disabled_at itself is an eligibility dependency, even when status is unchanged.
        await admin.query(
          "UPDATE learner_identity_links SET disabled_at=disabled_at+interval '1 second' WHERE id=$1",
          [identity.id],
        );
        expect(await epoch()).toBe(initialEpoch + 2);
        await admin.query(
          "UPDATE learner_identity_links SET status='active',disabled_at=NULL WHERE id=$1",
          [identity.id],
        );
      }
      expect(await epoch()).toBe(initialEpoch + (target === 'learner' ? 2 : 3));
      expect(
        (
          await runtime.query('SELECT * FROM public_projects_read($1,NULL,NULL,1,0)', [
            publication.publicationId,
          ])
        ).rows,
      ).toHaveLength(1);
      expect(await flags()).toEqual({ featured: false, pinned: false });
      expect(
        (
          await admin.query(
            'SELECT featured,lifecycle_version FROM project_publication_editorial WHERE publication_id=$1',
            [publication.publicationId],
          )
        ).rows[0],
      ).toEqual({ featured: true, lifecycle_version: initialEpoch });
      expect(
        (
          await admin.query(
            'SELECT pinned,lifecycle_version FROM project_publication_pin WHERE publication_id=$1',
            [publication.publicationId],
          )
        ).rows[0],
      ).toEqual({ pinned: true, lifecycle_version: initialEpoch });
    },
  );
  it('invited co-teacher manages another personal tenant class and Seat without switching workspace', async () => {
    async function educator() {
      const id = crypto.randomUUID().replaceAll('-', '');
      const registered = await inject(app, {
        method: 'POST',
        url: '/api/auth/register',
        payload: {
          email: `policy-co-${id}@isolated.test`,
          username: `pco_${id.slice(0, 24)}`,
          displayName: 'Policy co-teacher',
          password: `Policy-${id}-Password`,
          birthDate: '1990-01-01',
          country: 'RU',
        },
      });
      expect(registered.statusCode, registered.body).toBe(201);
      const token = registered.cookies.find((cookie) => cookie.name === 'asa_session')?.value;
      if (!token) throw new Error('Personal Account session required');
      const cookies = { asa_session: token };
      const enabled = await inject(app, {
        method: 'POST',
        url: '/api/capabilities/educator/self-attest',
        cookies,
        payload: {},
      });
      expect(enabled.statusCode, enabled.body).toBe(201);
      const session = async () =>
        (
          await admin.query(
            `SELECT account.id account_id,actor.id principal_id,workspace.id workspace_id,workspace.tenant_id
        FROM sessions_v2 session JOIN principals actor ON actor.id=session.principal_id
        JOIN accounts account ON account.id=actor.account_id JOIN workspaces workspace ON workspace.id=session.active_workspace_id
        WHERE session.token_hash=$1 AND workspace.kind='personal'`,
            [hashSessionToken(token)],
          )
        ).rows[0];
      const initial = await session();
      expect(initial).toBeDefined();
      return { cookies, session, initial };
    }
    const owner = await educator();
    const colleague = await educator();
    const outsider = await educator();
    expect(colleague.initial.tenant_id).not.toBe(owner.initial.tenant_id);
    const created = await inject(app, {
      method: 'POST',
      url: '/api/classrooms',
      cookies: owner.cookies,
      headers: { 'idempotency-key': crypto.randomUUID() },
      payload: {
        title: 'Cross-personal policy',
        ageBand: 'mixed',
        topicKeys: [],
        safeModeDefault: true,
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    const classroomId = created.json().classroom.id as string;
    const seat = (
      await runtime.query(
        "SELECT id FROM classroom_management_add_seat($1,$2,'Scoped policy Seat',$3,true)",
        [owner.initial.account_id, classroomId, crypto.randomUUID().slice(0, 8)],
      )
    ).rows[0].id as string;
    const invite = crypto.randomUUID();
    await runtime.query(
      "SELECT * FROM classroom_teacher_invitation_create($1,$2,$3,now()+interval '1 day')",
      [owner.initial.account_id, classroomId, invite],
    );
    const accepted = await runtime.query(
      'SELECT * FROM classroom_teacher_invitation_accept($1,$2)',
      [colleague.initial.account_id, invite],
    );
    expect(accepted.rows[0]).toMatchObject({
      classroom_id: classroomId,
      teacher_role: 'co_teacher',
    });
    const path = `/api/project-distribution/classrooms/${classroomId}`;
    for (const suffix of ['policy', `seats/${seat}`]) {
      const read = await inject(app, {
        method: 'GET',
        url: `${path}/${suffix}`,
        cookies: colleague.cookies,
      });
      expect(read.statusCode, read.body).toBe(200);
      expect(read.json()).toMatchObject({ publish: false, download: false, version: 0 });
      const denied = await inject(app, {
        method: 'GET',
        url: `${path}/${suffix}`,
        cookies: outsider.cookies,
      });
      expect(denied.statusCode, denied.body).toBe(403);
    }
    const saved = await inject(app, {
      method: 'PUT',
      url: `${path}/policy`,
      cookies: colleague.cookies,
      payload: { publish: true, download: false, expectedVersion: 0 },
    });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json()).toMatchObject({ publish: true, download: false, version: 1 });
    const overridden = await inject(app, {
      method: 'PUT',
      url: `${path}/seats/${seat}`,
      cookies: colleague.cookies,
      payload: { publishOverride: 'deny', downloadOverride: 'allow', expectedVersion: 1 },
    });
    expect(overridden.statusCode, overridden.body).toBe(200);
    expect(overridden.json()).toMatchObject({
      publishOverride: 'deny',
      downloadOverride: 'allow',
      version: 2,
    });
    for (const suffix of ['policy', `seats/${seat}`]) {
      const denied = await inject(app, {
        method: 'PUT',
        url: `${path}/${suffix}`,
        cookies: outsider.cookies,
        payload:
          suffix === 'policy'
            ? { publish: false, download: true, expectedVersion: 2 }
            : { publishOverride: 'allow', downloadOverride: 'deny', expectedVersion: 2 },
      });
      expect(denied.statusCode, denied.body).toBe(403);
    }
    expect(await colleague.session()).toEqual(colleague.initial);
    expect(await owner.session()).toEqual(owner.initial);
    const audit = await admin.query(
      "SELECT tenant_id,payload_json FROM audit_events WHERE entity_id=$1 AND action='classroom.projects.policy' ORDER BY id",
      [classroomId],
    );
    expect(audit.rows).toHaveLength(2);
    for (const row of audit.rows) {
      expect(row.tenant_id).toBe(owner.initial.tenant_id);
      expect(row.payload_json.actorId).toBe(colleague.initial.principal_id);
    }
  });
});
