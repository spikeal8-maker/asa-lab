import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import {
  BlocksAssetIdentityConflictError,
  PgBlocksAssetMetadataStore,
  blocksObjectKey,
} from '../../apps/api/src/blocks-asset-storage.js';
import { testAdminPool, testAppPool, seedTeacher, type SeededTeacher } from '../portal/helpers';

let admin: pg.Pool;
let runtime: pg.Pool;
let tenantA: SeededTeacher;
let tenantB: SeededTeacher;

beforeAll(async () => {
  admin = testAdminPool();
  runtime = testAppPool();
  tenantA = await seedTeacher(admin, `blocks-storage-a-${crypto.randomUUID().slice(0, 8)}`);
  tenantB = await seedTeacher(admin, `blocks-storage-b-${crypto.randomUUID().slice(0, 8)}`);
});

afterAll(async () => {
  await admin?.end();
  await runtime?.end();
});
describe('Blocks PostgreSQL asset metadata', () => {
  it('commits immutable tenant metadata, replays idempotently and hides it cross-tenant', async () => {
    const store = new PgBlocksAssetMetadataStore(runtime);
    const reference = {
      assetId: 'c'.repeat(32),
      dataFormat: 'png' as const,
      sha256: 'd'.repeat(64),
      sizeBytes: 7,
    };
    const objectKey = blocksObjectKey({
      tenantId: tenantA.tenantId,
      sha256: reference.sha256,
      dataFormat: reference.dataFormat,
    });
    const counts = async () => {
      const result = await admin.query(
        `SELECT
           (SELECT count(*)::int FROM blocks_blobs WHERE tenant_id=$1) AS blobs,
           (SELECT count(*)::int FROM blocks_asset_aliases WHERE tenant_id=$1) AS aliases`,
        [tenantA.tenantId],
      );
      return result.rows[0] as { blobs: number; aliases: number };
    };
    const before = await counts();
    const first = await store.commit({ tenantId: tenantA.tenantId, reference, objectKey });
    const afterFirst = await counts();
    expect(first).toMatchObject({ ...reference, tenantId: tenantA.tenantId, blobCommitted: true });
    expect({
      blobs: afterFirst.blobs - before.blobs,
      aliases: afterFirst.aliases - before.aliases,
    }).toEqual({ blobs: 1, aliases: 1 });
    expect(await store.commit({ tenantId: tenantA.tenantId, reference, objectKey })).toEqual(first);
    const afterReplay = await counts();
    expect({
      blobs: afterReplay.blobs - afterFirst.blobs,
      aliases: afterReplay.aliases - afterFirst.aliases,
    }).toEqual({ blobs: 0, aliases: 0 });
    expect(
      await store.resolve({
        tenantId: tenantA.tenantId,
        assetId: reference.assetId,
        dataFormat: reference.dataFormat,
      }),
    ).toEqual(first);
    expect(
      await store.resolve({
        tenantId: tenantB.tenantId,
        assetId: reference.assetId,
        dataFormat: reference.dataFormat,
      }),
    ).toBeNull();
    const conflicting = {
      ...reference,
      sha256: 'e'.repeat(64),
    };
    await expect(
      store.commit({
        tenantId: tenantA.tenantId,
        reference: conflicting,
        objectKey: blocksObjectKey({
          tenantId: tenantA.tenantId,
          sha256: conflicting.sha256,
          dataFormat: conflicting.dataFormat,
        }),
      }),
    ).rejects.toBeInstanceOf(BlocksAssetIdentityConflictError);

    expect(await counts()).toEqual({ blobs: 1, aliases: 1 });
  });
});
