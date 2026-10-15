import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import {
  PgBlocksAssetMetadataStore,
  BlocksAssetStorageIntegrityError,
  blocksObjectKey,
} from '../../apps/api/src/blocks-asset-storage.js';
import { testAdminPool, testAppPool, seedTeacher, type SeededTeacher } from './helpers';

let admin: pg.Pool;
let runtime: pg.Pool;
let teacher: SeededTeacher;
beforeAll(async () => {
  admin = testAdminPool();
  runtime = testAppPool();
  teacher = await seedTeacher(admin, 'scratch-concurrency');
});
afterAll(async () => {
  await runtime?.end();
  await admin?.end();
});

describe('Scratch concurrent immutable metadata under the runtime role', () => {
  it('acknowledges identical concurrent uploads with one blob and one alias', async () => {
    const store = new PgBlocksAssetMetadataStore(runtime);
    const reference = {
      assetId: randomBytes(16).toString('hex'),
      dataFormat: 'png' as const,
      sha256: randomBytes(32).toString('hex'),
      sizeBytes: 3,
    };
    const objectKey = blocksObjectKey({ tenantId: teacher.tenantId, ...reference });
    const results = await Promise.all(
      Array.from({ length: 24 }, () =>
        store.commit({ tenantId: teacher.tenantId, reference, objectKey }),
      ),
    );
    expect(results).toHaveLength(24);
    for (const result of results) expect(result).toMatchObject(reference);
    const counts = await admin.query(
      'SELECT (SELECT count(*)::int FROM blocks_blobs WHERE tenant_id=$1 AND sha256=$2) blobs,(SELECT count(*)::int FROM blocks_asset_aliases WHERE tenant_id=$1 AND asset_id=$3) aliases',
      [teacher.tenantId, reference.sha256, reference.assetId],
    );
    expect(counts.rows).toEqual([{ blobs: 1, aliases: 1 }]);
  });

  it('rejects a conflicting object key as an integrity error without acknowledging an alias', async () => {
    const store = new PgBlocksAssetMetadataStore(runtime);
    const reference = {
      assetId: randomBytes(16).toString('hex'),
      dataFormat: 'png' as const,
      sha256: randomBytes(32).toString('hex'),
      sizeBytes: 3,
    };
    const objectKey = blocksObjectKey({ tenantId: teacher.tenantId, ...reference });
    await admin.query(
      'INSERT INTO blocks_blobs(tenant_id,sha256,data_format,size_bytes,object_key) VALUES ($1,$2,$3,$4,$5)',
      [
        teacher.tenantId,
        randomBytes(32).toString('hex'),
        reference.dataFormat,
        reference.sizeBytes,
        objectKey,
      ],
    );
    await expect(
      store.commit({ tenantId: teacher.tenantId, reference, objectKey }),
    ).rejects.toBeInstanceOf(BlocksAssetStorageIntegrityError);
    expect(await store.resolve({ tenantId: teacher.tenantId, ...reference })).toBeNull();
  });
});
