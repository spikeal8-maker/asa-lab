import { fixtureRegenerationSql } from './ai-model-policy.fixture';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { testAdminPool, testAppPool } from '../portal/helpers';
import { lockAiPostgresSuite } from './ai-postgres-suite-lock';
import { aiTextFixture, aiTextHistoryContract } from './ai-text-history.contract';

let admin: pg.Pool, runtime: pg.Pool;
let unlock: (() => Promise<void>) | undefined;

beforeAll(async () => {
  const urls = ['TEST_DATABASE_URL', 'APP_TEST_DATABASE_URL'].map((name) => {
    const value = process.env[name];
    if (!value) throw new Error(`${name} must explicitly name an isolated _test database`);
    const url = new URL(value);
    if (!decodeURIComponent(url.pathname).endsWith('_test'))
      throw new Error(`${name} must name an isolated _test database`);
    return url;
  });
  if (urls[0]!.host !== urls[1]!.host || urls[0]!.pathname !== urls[1]!.pathname)
    throw new Error('Both roles must use the same isolated database');
  admin = testAdminPool();
  runtime = testAppPool();
  unlock = await lockAiPostgresSuite(admin);
}, 30000);

afterAll(async () => {
  try {
    await runtime?.end();
  } finally {
    await unlock?.();
    await admin?.end();
  }
});

aiTextHistoryContract(() => ({ admin, runtime }));

it('serializes 16 competing repeats of one variant across independent backends into one paid receipt', async () => {
  const f = await aiTextFixture(admin, runtime),
    question = await f.seedQuestion('Единственная платная операция');
  const request = randomUUID(),
    version = await f.version(),
    before = await f.ledgers();
  const first = await runtime.connect(),
    second = await runtime.connect();
  try {
    const pids = await Promise.all([
      first.query('SELECT pg_backend_pid() AS pid'),
      second.query('SELECT pg_backend_pid() AS pid'),
    ]);
    expect(pids[0]!.rows[0].pid).not.toBe(pids[1]!.rows[0].pid);
    const results = await Promise.all(
      Array.from({ length: 16 }, (_, index) =>
        (index % 2 ? first : second).query<{ admitted: boolean }>(fixtureRegenerationSql, [
          f.owner.principal_id,
          f.thread.id,
          index % 2 ? request.toUpperCase() : request,
          question.sourceId,
          version,
        ]),
      ),
    );
    expect(results.filter((result) => result.rows[0]!.admitted)).toHaveLength(1);
    expect(await f.ledgers()).toEqual({ global: before.global + 1, owner: before.owner + 1 });
    await first.query('SELECT ai_chat_abort($1,$2,$3)', [
      f.owner.principal_id,
      f.thread.id,
      request,
    ]);
    expect(
      (
        await second.query<{ admitted: boolean }>(fixtureRegenerationSql, [
          f.owner.principal_id,
          f.thread.id,
          request,
          question.sourceId,
          version,
        ])
      ).rows[0]!.admitted,
    ).toBe(false);
    expect(await f.ledgers()).toEqual({ global: before.global + 1, owner: before.owner + 1 });
  } finally {
    first.release();
    second.release();
  }
});

it('waits for a concurrent archive and rolls back fresh admission when that archive commits', async () => {
  const f = await aiTextFixture(admin, runtime),
    question = await f.seedQuestion('Архив выигрывает гонку');
  const archiver = await runtime.connect(),
    generator = await runtime.connect();
  const version = await f.version(),
    before = await f.ledgers();
  let pending: Promise<{ message?: string }> | undefined;
  try {
    await archiver.query('BEGIN');
    await archiver.query('SELECT * FROM ai_text_archive($1,$2,true)', [
      f.owner.principal_id,
      f.thread.id,
    ]);
    const pid = (await generator.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!
      .pid;
    pending = generator
      .query(fixtureRegenerationSql, [
        f.owner.principal_id,
        f.thread.id,
        randomUUID(),
        question.sourceId,
        version,
      ])
      .then(
        () => ({}),
        (problem: Error) => ({ message: problem.message }),
      );
    let blocked = false;
    for (let index = 0; index < 200 && !blocked; index += 1) {
      blocked = (
        await admin.query<{ blocked: boolean }>(
          'SELECT cardinality(pg_blocking_pids($1))>0 AS blocked',
          [pid],
        )
      ).rows[0]!.blocked;
      if (!blocked) await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(blocked).toBe(true);
    await archiver.query('COMMIT');
    expect(await pending).toEqual({ message: 'AI_THREAD_ARCHIVED' });
    expect(await f.ledgers()).toEqual(before);
    expect((await f.service.threadPage(f.owner.principal_id, null, '', true)).items[0]?.id).toBe(
      f.thread.id,
    );
  } finally {
    await archiver.query('ROLLBACK');
    await pending;
    archiver.release();
    generator.release();
  }
});
