import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { testAdminPool, testAppPool } from './helpers';
import { publicScratchFixture } from '../../apps/api/src/testing/fixtures/public-scratch';
import { PublicScratchPlayerService } from '../../apps/api/src/public-scratch-player';
import { buildTestApp, inject, type NestApp } from './app';
import { studentProjectPolicyFixture } from './student-project-policy-fixture';
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
  it.each([
    { scope: 'personal', label: 'normal Seat-owned personal Project Core flow' },
    { scope: 'classroom', label: 'synthetic teacher-created class source assigned to Seat' },
  ] as const)(
    '$label: defaults OFF, independent overrides/inherit, no Account, frozen public read survives disable, revoke closes it',
    async ({ scope }) => {
      const f = await fixture(scope);
      expect(await f.read()).toEqual({ publish: false, download: false, version: 0 });
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
    const writer = await runtime.connect();
    const revoker = await runtime.connect();
    try {
      await writer.query('BEGIN');
      await writer.query('SELECT project_publication_publish_seat($1,$2,$3::jsonb,$4)', [
        f.principal,
        f.projectId,
        '{}',
        f.hash,
      ]);
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
  it('assembled HTTP selects Seat before Account and rejects forged policy/owner input', async () => {
    const f = await fixture();
    const request = (method: 'GET' | 'POST' | 'PUT', url: string, payload?: unknown) =>
      inject(app, {
        method,
        url,
        payload,
        cookies: { asa_student_session: f.token, asa_session: 'unrelated-account-token' },
      });
    const status = await request('GET', `/api/projects/${f.projectId}/publication`);
    expect(status.statusCode, status.body).toBe(200);
    expect(status.json().canPublish).toBe(false);
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
    const published = await request('POST', `/api/projects/${f.projectId}/publication`, {});
    expect(published.statusCode, published.body).toBe(200);
    await admin.query(
      'UPDATE classroom_student_sessions SET revoked_at=now() WHERE token_hash=$1',
      [f.hash],
    );
    const denied = await request('POST', `/api/projects/${f.projectId}/publication`, {});
    expect(denied.statusCode, denied.body).toBe(401);
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
});
