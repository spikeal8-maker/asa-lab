import { PGlite } from '@electric-sql/pglite';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { applyPlan, planMigrations } from '../../tools/migrate.mjs';
import { WorkingFileStore } from '../../apps/api/src/ai-working-files';
import { aiTextFixture } from './ai-text-history.contract';
import { fixtureGenerationSql } from './ai-model-policy.fixture';

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
  await admin.query("UPDATE ai_image_settings SET enabled=true,sizes='[768]',daily_limit=100");
}, 120000);
afterAll(async () => db?.close());

const placeholder = 'ASA_GENERATED_IMAGE_PENDING';
async function prepare(content = `<html><h1>Лес</h1><img src="${placeholder}"></html>`) {
  const f = await aiTextFixture(admin, runtime);
  const owner = f.owner.principal_id,
    thread = f.thread.id,
    parent = randomUUID();
  await runtime.query(fixtureGenerationSql, [
    owner,
    thread,
    parent,
    'Создай сайт с новой картинкой',
    await f.version(),
  ]);
  await runtime.query('SELECT ai_tool_request_options($1,$2,$3,$4::jsonb,true)', [
    owner,
    thread,
    parent,
    JSON.stringify({ nativeImage: { mode: 'auto', size: 768 } }),
  ]);
  await runtime.query('SELECT ai_tool_policy_snapshot($1,$2,$3)', [owner, thread, parent]);
  const store = new WorkingFileStore(runtime);
  const file = await store.write(
    owner,
    thread,
    'index.html',
    0,
    content,
    randomUUID(),
    parent,
    parent,
    null,
    null,
    'Сайт',
  );
  const target = { name: 'index.html', expectedVersion: file.version, placeholder };
  const child = randomUUID();
  const args = [
    owner,
    thread,
    parent,
    child,
    'Лес',
    768,
    randomUUID(),
    1,
    true,
    '8'.repeat(64),
    'flux2-klein-4b-v1',
    JSON.stringify(target),
  ];
  const begin = (values = args) =>
    runtime.query<{ value: { request_id: string } }>(
      'SELECT ai_tool_image_file_begin($1,$2,$3,$4,$5::varchar,$6::integer,$7,$8::bigint,$9::boolean,$10::varchar,$11::varchar,$12::jsonb) AS value',
      values,
    );
  const finish = async (state = 'complete') => {
    const lease = randomUUID();
    await admin.query(
      "UPDATE ai_image_jobs SET state='storing',sha256=$3,size_bytes=10,put_started=true,lease_id=$2,lease_until=clock_timestamp()+interval '30 seconds' WHERE owner_principal_id=$1 AND request_id=$4",
      [owner, lease, 'a'.repeat(64), child],
    );
    return runtime.query('SELECT ai_image_transition($1,$2,$3,$4::varchar)', [
      owner,
      child,
      lease,
      state,
    ]);
  };
  const state = async () =>
    (
      await admin.query(
        'SELECT state,applied_version FROM ai_image_file_bindings WHERE owner_principal_id=$1 AND parent_request_id=$2',
        [owner, parent],
      )
    ).rows[0];
  return { ...f, owner, thread, parent, child, args, begin, finish, state, store, file, content };
}

it('atomically binds one image to the exact HTML, replays freely and adds no user/model admission', async () => {
  const f = await prepare();
  await f.begin();
  const before = await f.ledgers();
  const replayArgs = [...f.args];
  replayArgs[3] = randomUUID();
  expect((await f.begin(replayArgs)).rows[0]!.value.request_id).toBe(f.child);
  await f.finish();
  const saved = await f.store.read(f.owner, f.thread, 'index.html');
  expect(saved.version).toBe(2);
  expect(saved.content).toBe(
    f.content.replace(
      placeholder,
      `/api/ai/threads/${f.thread}/image-generations/${f.child}/image`,
    ),
  );
  expect((await f.store.read(f.owner, f.thread, 'index.html', 1)).content).toBe(f.content);
  expect(await f.state()).toEqual({ state: 'applied', applied_version: 2 });
  expect(await f.ledgers()).toEqual(before);
  expect(
    (
      await admin.query(
        "SELECT count(*)::int AS n FROM ai_assistant_messages WHERE thread_id=$1 AND role='user'",
        [f.thread],
      )
    ).rows[0].n,
  ).toBe(1);
  // Duplicate terminal observation/restart cannot append another file version.
  await admin.query("UPDATE ai_image_jobs SET state='complete' WHERE request_id=$1", [f.child]);
  expect((await f.store.read(f.owner, f.thread, 'index.html')).version).toBe(2);
  await expect(runtime.query('SELECT * FROM ai_image_file_bindings')).rejects.toThrow();
});

it('denies foreign scope, invalid or ambiguous targets before image admission', async () => {
  const f = await prepare();
  const foreign = [...f.args];
  foreign[0] = f.stranger.principal_id;
  await expect(f.begin(foreign)).rejects.toThrow();
  for (const target of [
    { name: 'index.html', expectedVersion: 2, placeholder },
    { name: '../index.html', expectedVersion: 1, placeholder },
    { name: 'index.html', expectedVersion: 1, placeholder: 'other' },
  ]) {
    const bad = [...f.args];
    bad[11] = JSON.stringify(target);
    await expect(f.begin(bad)).rejects.toThrow();
  }
  expect(
    (
      await admin.query('SELECT count(*)::int AS n FROM ai_image_jobs WHERE request_id=$1', [
        f.child,
      ])
    ).rows[0].n,
  ).toBe(0);
  const ambiguous = await prepare(`<img src="${placeholder}"><img src="${placeholder}">`);
  await expect(ambiguous.begin()).rejects.toThrow();
});

it('preserves a newer file version instead of overwriting concurrent work', async () => {
  const f = await prepare();
  await f.begin();
  await f.store.write(
    f.owner,
    f.thread,
    'index.html',
    1,
    '<h1>Новая версия</h1>',
    randomUUID(),
    null,
    null,
    null,
    null,
    'Изменено',
  );
  await f.finish();
  expect(await f.state()).toEqual({ state: 'superseded', applied_version: null });
  expect((await f.store.read(f.owner, f.thread, 'index.html')).content).toBe(
    '<h1>Новая версия</h1>',
  );
});

it('does not change files after a newer user turn, cancellation or failed image', async () => {
  for (const terminal of ['newer', 'cancelled', 'failed']) {
    const f = await prepare();
    await f.begin();
    if (terminal === 'newer') {
      const request = randomUUID();
      await runtime.query(fixtureGenerationSql, [
        f.owner,
        f.thread,
        request,
        'Другой запрос',
        await f.version(),
      ]);
      await runtime.query("SELECT ai_chat_finish($1,$2,$3,'Готово','complete')", [
        f.owner,
        f.thread,
        request,
      ]);
    }
    if (terminal === 'cancelled')
      await runtime.query('SELECT ai_image_cancel($1,$2,$3)', [f.owner, f.thread, f.child]);
    await f.finish(terminal === 'failed' ? 'failed' : 'complete');
    expect((await f.state()).state).toBe(terminal === 'newer' ? 'superseded' : terminal);
    expect((await f.store.read(f.owner, f.thread, 'index.html')).version).toBe(1);
  }
});

it('waits on uncertain GPU outcome and completes the existing receipt once after recovery', async () => {
  const f = await prepare();
  await f.begin();
  await admin.query("UPDATE ai_image_jobs SET state='unknown' WHERE request_id=$1", [f.child]);
  expect((await f.state()).state).toBe('waiting');
  expect((await f.store.read(f.owner, f.thread, 'index.html')).version).toBe(1);
  await f.finish();
  expect((await f.state()).state).toBe('applied');
});

it('keeps a valid completed image when the file history quota fills meanwhile', async () => {
  const f = await prepare();
  await f.begin();
  const other = (
    await admin.query(
      'INSERT INTO ai_working_files(thread_id,owner_principal_id,name,anchor_request_id,head) VALUES($1,$2,$3,$4,88) RETURNING id',
      [f.thread, f.owner, 'other.html', f.parent],
    )
  ).rows[0].id;
  await admin.query(
    "INSERT INTO ai_working_file_versions(file_id,owner_principal_id,version,base_version,operation_id,content,summary) SELECT $1,$2,n,n-1,gen_random_uuid(),repeat('x',95000),'history' FROM generate_series(1,88) n",
    [other, f.owner],
  );
  const used = (
    await admin.query(
      'SELECT sum(octet_length(v.content))::int AS n FROM ai_working_file_versions v JOIN ai_working_files f ON f.id=v.file_id WHERE f.thread_id=$1',
      [f.thread],
    )
  ).rows[0].n;
  await admin.query(
    "INSERT INTO ai_working_file_versions(file_id,owner_principal_id,version,base_version,operation_id,content,summary) VALUES($1,$2,89,88,gen_random_uuid(),repeat('x',$3),'history')",
    [other, f.owner, 8388608 - used],
  );
  await f.finish();
  expect((await f.state()).state).toBe('failed');
  expect(
    (await admin.query('SELECT state FROM ai_image_jobs WHERE request_id=$1', [f.child])).rows[0]
      .state,
  ).toBe('complete');
  expect((await f.store.read(f.owner, f.thread, 'index.html')).version).toBe(1);
});
