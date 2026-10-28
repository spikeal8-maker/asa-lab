import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import type pg from 'pg';
import { testAdminPool, testAppPool, seedTeacher } from './helpers';
import { PgProjectRepository } from '../../contexts/projects/infrastructure/pg-project.repository';
import { publicScratchFixture } from '../../apps/api/src/testing/fixtures/public-scratch';
import { PublicScratchPlayerService } from '../../apps/api/src/public-scratch-player';
let admin: pg.Pool, runtime: pg.Pool;
const ORIGIN = 'http://127.0.0.1:4612';
const env = {
  ASA_BLOCKS_RUNTIME_ORIGIN: ORIGIN,
  ASA_BLOCKS_RUNTIME_SIGNING_KEY: '0123456789abcdef'.repeat(4),
};
beforeAll(() => {
  admin = testAdminPool();
  runtime = testAppPool();
});
afterAll(async () => {
  await runtime?.end();
  await admin?.end();
});
async function fixture() {
  const f = publicScratchFixture();
  const teacher = await seedTeacher(admin, 'public-scratch-' + randomUUID().slice(0, 8));
  const principal = (
    await admin.query(
      'SELECT principal_id FROM legacy_user_account_links WHERE tenant_id=$1 AND user_id=$2',
      [teacher.tenantId, teacher.teacherId],
    )
  ).rows[0].principal_id;
  const actor = { principalId: principal, userId: teacher.teacherId };
  const key = `tenants/${teacher.tenantId}/blocks/assets/${f.ref.sha256.slice(0, 2)}/${f.ref.sha256}.svg`;
  await admin.query(
    'INSERT INTO blocks_blobs(tenant_id,sha256,data_format,size_bytes,object_key) VALUES($1,$2,$3,$4,$5)',
    [teacher.tenantId, f.ref.sha256, 'svg', f.bytes.length, key],
  );
  await admin.query(
    'INSERT INTO blocks_asset_aliases(tenant_id,asset_id,data_format,sha256) VALUES($1,$2,$3,$4)',
    [teacher.tenantId, f.ref.assetId, 'svg', f.ref.sha256],
  );
  const repo = new PgProjectRepository(admin);
  const result = await repo.createWithDraft({
    tenantId: teacher.tenantId,
    scope: 'personal',
    classroomId: null,
    actor,
    moduleKey: 'blocks',
    title: 'Published Scratch',
    idempotencyKey: randomUUID(),
    requestFingerprint: randomUUID().replaceAll('-', '').repeat(2),
    initialDocument: f.document,
    initialPreview: null,
  });
  if (result.kind !== 'created') throw Error('fixture failed');
  const projectId = result.project.id;
  const snapshot = async (revision: number) =>
    expect(
      await repo.saveSnapshot({
        tenantId: teacher.tenantId,
        actor,
        projectId,
        sourceRevision: revision,
        image: {
          bytes: Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAGUlEQVR4nGNQCu34TwlmGDVg1IBRA4aLAQDLpv4Q+i0QiwAAAABJRU5ErkJggg==',
            'base64',
          ),
          contentType: 'image/png',
          width: 16,
          height: 16,
        },
      }),
    ).not.toBeNull();
  const publish = async () =>
    (
      await admin.query('SELECT project_publication_publish($1,$2,$3::jsonb) AS result', [
        principal,
        projectId,
        JSON.stringify({ title: 'Published Scratch', license: 'reserved' }),
      ])
    ).rows[0].result.publication as { publicationId: string; revisionId: string };
  await snapshot(1);
  const binding = await publish();
  const service = new PublicScratchPlayerService(runtime, env, {
    blobs: {
      open: async () =>
        (async function* () {
          yield f.bytes;
        })(),
    } as never,
  });
  return { ...f, teacher, principal, projectId, binding, service, publish, snapshot };
}
describe('public Scratch exact-version authority under restricted PostgreSQL', () => {
  it('keeps published V1 separate from Draft V2, denies stale links and revoked cache/asset hits', async () => {
    const f = await fixture();
    const first = await f.service.issue(f.binding);
    const changed = structuredClone(f.document);
    changed.projectJson.targets[0]!.variables.counter[1] = 42;
    await admin.query(
      'UPDATE project_drafts SET document_json=$2::jsonb,revision=revision+1 WHERE project_id=$1',
      [f.projectId, JSON.stringify(changed)],
    );
    expect((await f.service.issue(f.binding)).projectJson).toEqual(first.projectJson);
    await f.snapshot(2);
    const next = await f.publish();
    expect(next.revisionId).not.toBe(f.binding.revisionId);
    await expect(f.service.issue(f.binding)).rejects.toMatchObject({ status: 404 });
    await expect(
      f.service.asset(f.binding, first.runtimeToken, ORIGIN, f.ref.assetId, 'svg'),
    ).rejects.toMatchObject({ status: 404 });
    const second = await f.service.issue(next);
    expect(second.projectJson).toEqual(changed.projectJson);
    await admin.query('SELECT project_publication_revoke($1,$2)', [f.principal, f.projectId]);
    await expect(f.service.issue(next)).rejects.toMatchObject({ status: 404 });
    await expect(
      f.service.asset(next, second.runtimeToken, ORIGIN, f.ref.assetId, 'svg'),
    ).rejects.toMatchObject({ status: 404 });
  });
  it('requires exact referenced hash/size/format and source tenant alias, never tenant-wide asset access', async () => {
    const f = await fixture();
    const b = await f.service.issue(f.binding);
    const read = await f.service.asset(f.binding, b.runtimeToken, ORIGIN, f.ref.assetId, 'svg');
    const parts = [];
    for await (const bytes of read.body) parts.push(bytes);
    read.release();
    expect(Buffer.concat(parts)).toEqual(f.bytes);
    await expect(
      f.service.asset(f.binding, b.runtimeToken, ORIGIN, f.ref.assetId, 'png'),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      f.service.asset(f.binding, b.runtimeToken, ORIGIN, 'f'.repeat(32), 'svg'),
    ).rejects.toMatchObject({ status: 404 });
    await admin.query('UPDATE blocks_blobs SET size_bytes=size_bytes+1 WHERE tenant_id=$1', [
      f.teacher.tenantId,
    ]);
    await expect(
      f.service.asset(f.binding, b.runtimeToken, ORIGIN, f.ref.assetId, 'svg'),
    ).rejects.toMatchObject({ status: 404 });
    await admin.query(
      'UPDATE blocks_blobs SET size_bytes=size_bytes-1,object_key=object_key||$2 WHERE tenant_id=$1',
      [f.teacher.tenantId, 'bad'],
    );
    await expect(
      f.service.asset(f.binding, b.runtimeToken, ORIGIN, f.ref.assetId, 'svg'),
    ).rejects.toMatchObject({ status: 404 });
  });
  it('fresh project visibility is required, and runtime role cannot directly write publication or asset tables', async () => {
    const f = await fixture();
    await f.service.issue(f.binding);
    await admin.query("UPDATE projects SET status='trashed' WHERE id=$1", [f.projectId]);
    await expect(f.service.issue(f.binding)).rejects.toMatchObject({ status: 404 });
    await expect(
      runtime.query('UPDATE project_publication_state SET current_revision_id=NULL WHERE id=$1', [
        f.binding.publicationId,
      ]),
    ).rejects.toBeTruthy();
    await expect(
      runtime.query(
        'INSERT INTO blocks_asset_aliases(tenant_id,asset_id,data_format,sha256) VALUES($1,$2,$3,$4)',
        [f.teacher.tenantId, 'b'.repeat(32), 'svg', f.ref.sha256],
      ),
    ).rejects.toBeTruthy();
  });
});
