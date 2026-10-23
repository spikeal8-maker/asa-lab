import { test } from 'node:test';
import assert from 'node:assert/strict';
import { instrumentPool, scheduledStage, stageVerdict, summarizePool } from './soak.mjs';

function fixture(fail = false) {
  let releases = 0,
    clock = 0;
  const pool = {
    connect(callback) {
      clock += 5;
      if (fail) return callback(new Error('checkout failed'));
      const release = () => {
        releases++;
      };
      callback(undefined, { release }, release);
    },
  };
  const rows = [];
  const restore = instrumentPool(
    pool,
    (row) => {
      rows.push(row);
      return (ms) => {
        row.holdMs = ms;
      };
    },
    () => clock,
  );
  return {
    pool,
    rows,
    restore,
    count: () => releases,
    advance: () => {
      clock += 11;
    },
  };
}
test('promise borrowing measures checkout and client hold exactly once', async () => {
  const f = fixture(),
    client = await f.pool.connect();
  f.advance();
  client.release();
  assert.deepEqual(f.rows, [{ waitMs: 5, failed: false, holdMs: 11 }]);
  assert.equal(f.count(), 1);
  assert.throws(() => client.release(), /double_release/);
  f.restore();
});
test('callback borrowing and pool.query-style release share the wrapped function', () => {
  const f = fixture();
  assert.equal(
    f.pool.connect((error, client, release) => {
      assert.equal(error, undefined);
      assert.equal(release, client.release);
      f.advance();
      release();
    }),
    undefined,
  );
  assert.equal(f.count(), 1);
  assert.equal(f.rows[0].holdMs, 11);
});
test('both failed checkout overloads preserve errors and never report a hold', async () => {
  const f = fixture(true);
  await assert.rejects(f.pool.connect(), /checkout failed/);
  f.pool.connect((error) => assert.match(error.message, /checkout failed/));
  assert.equal(summarizePool(f.rows).failedAcquires, 2);
  assert.equal(summarizePool(f.rows).holdMs.count, 0);
  assert.equal(f.count(), 0);
});
test('fixed arrival scheduler completes every planned chain without concurrent actor mutations', async () => {
  let clock = 0;
  const result = await scheduledStage({
    actors: [{ index: 0 }, { index: 1 }],
    durationMs: 40,
    periodMs: 10,
    lateLimitMs: 5,
    fatal: () => false,
    work: async () => {},
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
      await new Promise((resolve) => setImmediate(resolve));
    },
  });
  assert.equal(result.planned, 8);
  assert.equal(result.offered, 8);
  assert.equal(result.completed, 8);
  assert.equal(result.skippedBusy, 0);
});
test('slow chains do not slow offered arrivals or hide dropped work', async () => {
  let clock = 0;
  let finish;
  const resultPromise = scheduledStage({
    actors: [{ index: 0 }],
    durationMs: 30,
    periodMs: 10,
    lateLimitMs: 5,
    fatal: () => false,
    work: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
      await new Promise((resolve) => setImmediate(resolve));
      if (clock >= 30) finish?.();
    },
  });
  const result = await resultPromise;
  assert.equal(result.offered, 3);
  assert.equal(result.launched, 1);
  assert.equal(result.skippedBusy, 2);
});
test('late arrivals are reported and not launched in a catch-up burst', async () => {
  let clock = 0;
  const r = await scheduledStage({
    actors: [{ index: 0 }],
    durationMs: 20,
    periodMs: 10,
    lateLimitMs: 5,
    work: async () => assert.fail('late work launched'),
    fatal: () => false,
    now: () => clock,
    sleep: async (ms) => {
      clock += ms + 20;
    },
  });
  assert.equal(r.skippedLate, 2);
  assert.equal(r.completed, 0);
});
test('stage promotion rejects missing work, slow borrowing, and incomplete correctness', () => {
  const input = {
    schedule: {
      planned: 30,
      offered: 30,
      completed: 30,
      failed: 0,
      skippedBusy: 0,
      skippedLate: 0,
      lateOver100Ms: 0,
    },
    saves: { count: 30, p95: 200 },
    reads: { count: 30, p95: 50 },
    checkout: { count: 200, p95: 1 },
    failedAcquires: 0,
    errors: 0,
    sampleErrors: 0,
    actorsVerified: 30,
    actorsExpected: 30,
    acknowledged: 30,
    verified: 30,
  };
  assert.equal(stageVerdict(input).verdict, 'PASS');
  assert.equal(stageVerdict({ ...input, checkout: { count: 200, p95: 101 } }).verdict, 'FAIL');
  assert.equal(stageVerdict({ ...input, verified: 29 }).verdict, 'FAIL');
  assert.equal(
    stageVerdict({ ...input, schedule: { ...input.schedule, skippedBusy: 1 } }).verdict,
    'FAIL',
  );
});
