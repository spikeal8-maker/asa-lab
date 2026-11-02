import { PGlite } from '@electric-sql/pglite';
import type pg from 'pg';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { applyPlan, planMigrations } from '../../tools/migrate.mjs';
import { aiTextFixture } from './ai-text-history.contract';
import { WorkingFileStore, applyFileEdits } from '../../apps/api/src/ai-working-files';

let db: PGlite, admin: pg.Pool, runtime: pg.Pool;
beforeAll(async () => {
  db = new PGlite();
  const adapter = {
    query: async (sql: string, params?: unknown[]) =>
      params?.length ? db.query(sql, params) : { rows: (await db.exec(sql)).at(-1)?.rows ?? [] },
  };
  admin = adapter as unknown as pg.Pool;
  runtime = {
    query: async (sql: string, params?: unknown[]) => {
      await db.exec('SET ROLE asalab_app');
      try {
        return await adapter.query(sql, params);
      } finally {
        await db.exec('RESET ROLE');
      }
    },
  } as unknown as pg.Pool;
  await applyPlan(adapter, planMigrations('migrations'));
}, 120000);
afterAll(async () => db?.close());
it('persists private files, exact edits, immutable versions, CAS, replay and restore', async () => {
  const f = await aiTextFixture(admin, runtime),
    store = new WorkingFileStore(runtime),
    request = randomUUID();
  await runtime.query("SELECT ai_generation_begin($1,$2,$3,$4::jsonb,'gpt-5-mini',$5,$6)", [
    f.owner.principal_id,
    f.thread.id,
    request,
    JSON.stringify({
      text: 'Создай змейку',
      model: 'gpt-5-mini',
      source: null,
      uploads: [],
      webSearchMode: null,
      weatherCity: null,
    }),
    (await admin.query('SELECT revision FROM ai_generation_policy WHERE singleton_key')).rows[0]
      .revision,
    await f.version(),
  ]);
  const owner = f.owner.principal_id,
    thread = f.thread.id,
    operation = randomUUID();
  const first = await store.write(
    owner,
    thread,
    'snake.html',
    0,
    '<h1>Змейка</h1>',
    operation,
    request,
    request,
    null,
    null,
    'Создание',
  );
  expect(first.version).toBe(1);
  expect((await store.list(owner, thread))[0]?.id).toBe(first.id);
  await expect(store.read(f.stranger.principal_id, thread, 'snake.html')).rejects.toThrow();
  await expect(runtime.query('SELECT * FROM ai_working_files')).rejects.toThrow();
  const replay = await store.write(
    owner,
    thread,
    'snake.html',
    0,
    '<h1>Змейка</h1>',
    operation,
    request,
    request,
    null,
    null,
    'Создание',
  );
  expect(replay.version).toBe(1);
  const next = applyFileEdits(first.content!, [
    { oldText: 'Змейка', newText: 'Змейка с уровнями' },
  ]);
  const second = await store.write(
    owner,
    thread,
    'snake.html',
    1,
    next,
    randomUUID(),
    request,
    request,
    null,
    null,
    'Уровни',
  );
  expect(second.id).toBe(first.id);
  expect(second.version).toBe(2);
  expect((await store.read(owner, thread, 'snake.html', 1)).content).toBe('<h1>Змейка</h1>');
  await expect(
    store.write(
      owner,
      thread,
      'snake.html',
      1,
      'stale',
      randomUUID(),
      request,
      request,
      null,
      null,
      'stale',
    ),
  ).rejects.toThrow('изменился');
  await runtime.query("SELECT ai_chat_finish($1,$2,$3,'Файл обновлён','complete')", [
    owner,
    thread,
    request,
  ]);
  const restored = await store.restore(owner, thread, 'snake.html', 1, 2, randomUUID());
  expect(restored.version).toBe(3);
  expect(restored.content).toBe(first.content);
  expect(restored.versions).toHaveLength(3);
  await runtime.query('SELECT ai_text_archive($1,$2,true)', [owner, thread]);
  await expect(store.restore(owner, thread, 'snake.html', 1, 3, randomUUID())).rejects.toThrow();
  expect((await store.read(owner, thread, 'snake.html')).version).toBe(3);
});
it('rejects absent or repeated patch anchors', () => {
  expect(() => applyFileEdits('x x', [{ oldText: 'x', newText: 'y' }])).toThrow('несколько');
  expect(() => applyFileEdits('x', [{ oldText: 'z', newText: 'y' }])).toThrow('отсутствует');
});
