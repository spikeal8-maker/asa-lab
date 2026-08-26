import pg from 'pg';
import { describe, expect, it } from 'vitest';
import {
  analyzeLearningData,
  withReadOnlyTransaction,
} from '../../tools/learning-migration-dry-run.mjs';

const databaseUrl = process.env.TEST_DATABASE_URL;
const databaseName = databaseUrl ? new URL(databaseUrl).pathname.slice(1) : '';
const describePg = databaseUrl && databaseName.endsWith('_test') ? describe : describe.skip;

describePg('LRN-M0-005 PostgreSQL read-only evidence', () => {
  it('rejects a write at database level with SQLSTATE 25006', async () => {
    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      await expect(
        withReadOnlyTransaction(client, async (tx) => {
          await tx.query('CREATE TEMP TABLE lrn_m0_005_forbidden_write(id integer)');
        }),
      ).rejects.toMatchObject({ code: '25006' });
    } finally {
      await client.end();
    }
  });

  it('repeats the same snapshot with bounded set-based reads', async () => {
    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    const options = {
      asOf: '2026-08-24T00:00:00.000Z',
      environmentKind: 'test',
      repositorySha: '0000000000000000000000000000000000000000',
      analyzerSha256: '0'.repeat(64),
    };
    try {
      await withReadOnlyTransaction(
        client,
        async (tx) => {
          const first = await analyzeLearningData(tx, options);
          const second = await analyzeLearningData(tx, options);
          expect(second.deterministic).toEqual(first.deterministic);
          expect(first.metadata.performance.queryCount).toBeLessThanOrEqual(6);
        },
        options.asOf,
      );
    } finally {
      await client.end();
    }
  });
});
