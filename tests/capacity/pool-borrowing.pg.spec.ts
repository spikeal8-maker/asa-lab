import pg from 'pg';
import { describe, it, expect } from 'vitest';
import { assertIsolatedEnvironment } from '../../tools/capacity/contracts.mjs';
import { instrumentPool, summarizePool } from '../../tools/capacity/soak.mjs';

describe.skipIf(process.env.ASA_CAPACITY_SOAK !== '1')('real pg fixture instrumentation', () => {
  it('covers internal query borrowing, both connect forms, releases and a saturated checkout failure', async () => {
    assertIsolatedEnvironment(process.env);
    const pool = new pg.Pool({
      connectionString: process.env.APP_TEST_DATABASE_URL,
      max: 1,
      connectionTimeoutMillis: 100,
    });
    const rows: any[] = [];
    const restore = instrumentPool(pool, (row) => {
      rows.push(row);
      return (holdMs) => {
        row.holdMs = holdMs;
      };
    });
    try {
      expect((await pool.query('SELECT 1 AS value')).rows[0].value).toBe(1);
      await new Promise<void>((resolve, reject) =>
        pool.connect((error, client, release) => {
          if (error) return reject(error);
          client.query('SELECT 2 AS value', (queryError, result) => {
            release();
            if (queryError) reject(queryError);
            else {
              expect(result.rows[0].value).toBe(2);
              resolve();
            }
          });
        }),
      );
      const held = await pool.connect();
      await expect(pool.connect()).rejects.toThrow(/timeout/i);
      held.release();
      await pool.query('SELECT 3');
      const summary = summarizePool(rows);
      expect(summary.checkoutMs.count).toBe(5);
      expect(summary.failedAcquires).toBe(1);
      expect(summary.holdMs.count).toBe(4);
      expect(summary.unreleasedAcquires).toBe(0);
      expect(pool.waitingCount).toBe(0);
      expect(pool.idleCount).toBe(1);
    } finally {
      restore();
      await pool.end();
    }
  });
});
