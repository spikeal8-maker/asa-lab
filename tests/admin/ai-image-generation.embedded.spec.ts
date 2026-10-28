import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import type pg from 'pg';
import { beforeAll, afterAll, it, expect, vi } from 'vitest';
import { applyPlan, planMigrations } from '../../tools/migrate.mjs';
import { AiImageService, imageInput, imageAdminInput } from '../../apps/api/src/ai-image.service';
import type { ComfyImageRecovery } from '../../apps/api/src/ai-image-comfyui';
import { AiAttachmentStorageError } from '../../apps/api/src/ai-attachments/blob-store';
import { AiTextHistoryStore } from '../../apps/api/src/ai-text-history';
import { aiClassFixture } from './ai-student-access.contract';
let db: PGlite, owner: string, stranger: string, admin: string, thread: string;
const pool = {
  query: async (sql: string, params: unknown[] = []) => {
    await db.exec('SET ROLE asalab_app');
    try {
      return await db.query(sql, params);
    } finally {
      await db.exec('RESET ROLE');
    }
  },
} as unknown as pg.Pool;
async function identity(elevated = false) {
  const a = (
    await db.query<{ id: string }>(
      "INSERT INTO accounts(email,password_hash,birth_date,country) VALUES($1,'test','1990-01-01','RU') RETURNING id",
      [randomUUID() + '@example.test'],
    )
  ).rows[0]!.id;
  await db.query(
    "INSERT INTO profiles(account_id,username,display_name) VALUES($1,$2,'Image owner')",
    [a, randomUUID()],
  );
  const p = (
    await db.query<{ id: string }>(
      "INSERT INTO principals(kind,account_id) VALUES('account',$1) RETURNING id",
      [a],
    )
  ).rows[0]!.id;
  if (elevated)
    await db.query(
      "INSERT INTO capability_grants(account_id,capability,state,policy_version,granted_by) VALUES($1,'platform_admin','verified','admin-stage-a-2026-08','admin')",
      [a],
    );
  return p;
}
const transport = {
  readiness: vi.fn(async () => ({ ready: true, reason: null })),
  dispatch: vi.fn(async () => undefined),
  recover: vi.fn<() => Promise<ComfyImageRecovery>>(async () => ({ state: 'missing' })),
  cancelPending: vi.fn(async () => false),
};
const blobs = {
  putImmutable: vi.fn(async () => undefined),
  verify: vi.fn(async () => false),
  read: vi.fn<() => Promise<Buffer | null>>(async () => null),
  remove: vi.fn(async () => true),
};
function service() {
  return new AiImageService(pool, { transport, blobs, maintenance: false });
}
async function config(enabled = true) {
  const c = await service().admin(admin);
  return service().saveAdmin(admin, { ...c, requestId: randomUUID(), enabled });
}
async function createThread() {
  return (await pool.query<{ id: string }>('SELECT ai_chat_create($1) AS id', [owner])).rows[0]!.id;
}
beforeAll(async () => {
  db = new PGlite();
  await applyPlan(
    {
      query: async (sql: string, params?: unknown[]) =>
        params?.length ? db.query(sql, params) : { rows: (await db.exec(sql)).at(-1)?.rows ?? [] },
    },
    planMigrations('migrations'),
  );
  admin = await identity(true);
  owner = await identity();
  stranger = await identity();
  thread = await createThread();
}, 120000);
afterAll(async () => {
  await db.close();
});
it('defaults disabled; validates bounded admin/prompt payloads', async () => {
  expect((await service().admin(admin)).enabled).toBe(false);
  expect(() => imageInput({ requestId: randomUUID(), prompt: '', size: 512 })).toThrow();
  expect(() =>
    imageAdminInput({
      requestId: randomUUID(),
      configurationVersion: 1,
      enabled: true,
      dailyLimit: 101,
      globalConcurrency: 1,
      sizes: [512],
    }),
  ).toThrow();
  await expect(service().admin(stranger)).rejects.toThrow();
});
it('admits local image without any text keys, dispatches once, unknown keeps global budget and journal token NULL', async () => {
  await config();
  const id = randomUUID();
  transport.dispatch.mockRejectedValueOnce(new Error('timeout'));
  const s = service();
  const job = await s.create(owner, thread, { requestId: id, prompt: 'A blue cube', size: 512 });
  expect(job.state).toBe('submitting');
  await s.create(owner, thread, { requestId: id, prompt: 'A blue cube', size: 512 });
  expect(transport.dispatch).toHaveBeenCalledTimes(1);
  await expect(
    s.create(owner, thread, { requestId: id, prompt: 'different', size: 512 }),
  ).rejects.toThrow();
  await expect(s.get(stranger, thread, id)).rejects.toThrow();
  await expect(
    s.create(owner, thread, { requestId: randomUUID(), prompt: 'other', size: 512 }),
  ).rejects.toThrow();
  await s.sweep();
  expect((await s.get(owner, thread, id)).state).toBe('unknown');
  const rows = (
    await db.query<{
      provider: string;
      input_tokens: null;
      output_tokens: null;
      operation: string;
    }>(
      'SELECT provider,operation,input_tokens,output_tokens FROM ai_usage_journal WHERE request_id=$1',
      [id],
    )
  ).rows;
  expect(rows[0]).toMatchObject({
    provider: 'comfyui',
    operation: 'image',
    input_tokens: null,
    output_tokens: null,
  });
  expect((await db.query('SELECT * FROM ai_paid_operation_quota')).rows).toHaveLength(0);
});
it('cancellation never interrupts or refunds unknown; deleted receipt denies UUID reuse', async () => {
  const row = (
    await db.query<{ request_id: string }>('SELECT request_id FROM ai_image_jobs LIMIT 1')
  ).rows[0]!;
  await service().cancel(owner, thread, row.request_id);
  expect(transport.cancelPending).not.toHaveBeenCalled();
  await pool.query('SELECT ai_chat_delete($1,$2)', [owner, thread]);
  expect((await db.query('SELECT * FROM ai_assistant_request_quota')).rows).toHaveLength(1);
  await expect(
    service().create(owner, thread, {
      requestId: row.request_id,
      prompt: 'A blue cube',
      size: 512,
    }),
  ).rejects.toThrow();
});
async function expireImageLeases() {
  await db.exec('UPDATE ai_image_jobs SET lease_until=NULL');
}
it('reconciles the cancelled unknown UUID without dispatch and then releases GPU only after known failure', async () => {
  await expireImageLeases();
  transport.recover.mockResolvedValueOnce({ state: 'failed' });
  await service().sweep();
  expect(
    (await db.query<{ state: string }>('SELECT state FROM ai_image_jobs LIMIT 1')).rows[0]!.state,
  ).toBe('cancelled');
  expect(transport.dispatch).toHaveBeenCalledTimes(1);
});
it('unknown immutable PUT is never retried; verified image persists in history and private bytes; deletion cleans output without refund', async () => {
  thread = await createThread();
  const id = randomUUID();
  const png = Buffer.from('sanitized output from trusted transport');
  const s = service();
  await s.create(owner, thread, { requestId: id, prompt: 'A green cube', size: 512 });
  transport.recover.mockResolvedValueOnce({ state: 'complete', png });
  blobs.putImmutable.mockRejectedValueOnce(new AiAttachmentStorageError('unknown'));
  await s.sweep();
  expect((await s.get(owner, thread, id)).state).toBe('storing');
  expect(blobs.putImmutable).toHaveBeenCalledTimes(1);
  await expireImageLeases();
  await s.sweep();
  expect((await s.get(owner, thread, id)).state).toBe('storing');
  expect(blobs.putImmutable).toHaveBeenCalledTimes(1);
  blobs.verify.mockResolvedValueOnce(true);
  await expireImageLeases();
  await s.sweep();
  const completed = await s.get(owner, thread, id);
  expect(completed.image?.downloadUrl).toContain(id);
  expect(completed.state).toBe('complete');
  const history = await new AiTextHistoryStore(pool).messages(owner, thread);
  expect(history).toHaveLength(2);
  expect(history[0]?.generationKind).toBe('image');
  expect(history[1]?.generatedImages?.[0]?.requestId).toBe(id);
  blobs.read.mockResolvedValueOnce(png);
  expect(await s.bytes(owner, thread, id)).toEqual(png);
  await expect(s.bytes(stranger, thread, id)).rejects.toThrow();
  const permit = await s.acquireTransfer(owner);
  await expect(s.acquireTransfer(owner)).rejects.toThrow();
  await s.releaseTransfer(owner, permit);
  await pool.query('SELECT ai_chat_delete($1,$2)', [owner, thread]);
  await expireImageLeases();
  await s.sweep();
  expect(blobs.remove).toHaveBeenCalledTimes(1);
  expect((await db.query('SELECT * FROM ai_assistant_request_quota')).rows).toHaveLength(2);
  expect(
    (await db.query("SELECT * FROM ai_usage_journal WHERE provider='comfyui'")).rows,
  ).toHaveLength(2);
});
it('disabled image settings and archived threads fail before another dispatch; admin CAS replay is immutable', async () => {
  await config(false);
  const t = await createThread();
  const before = transport.dispatch.mock.calls.length;
  await expect(
    service().create(owner, t, { requestId: randomUUID(), prompt: 'x', size: 512 }),
  ).rejects.toThrow();
  const c = await service().admin(admin);
  const input = { ...c, requestId: randomUUID(), enabled: true };
  await service().saveAdmin(admin, input);
  await service().saveAdmin(admin, input);
  await expect(service().saveAdmin(admin, { ...input, dailyLimit: 11 })).rejects.toThrow();
  await pool.query('SELECT * FROM ai_text_archive($1,$2,true)', [owner, t]);
  await expect(
    service().create(owner, t, { requestId: randomUUID(), prompt: 'x', size: 512 }),
  ).rejects.toThrow();
  expect(transport.dispatch).toHaveBeenCalledTimes(before);
});
it('school deny remains authoritative for image admission independent of local model readiness', async () => {
  const adminPool = {
    query: async (sql: string, params: unknown[] = []) => db.query(sql, params),
  } as unknown as pg.Pool;
  const f = await aiClassFixture(adminPool, pool);
  const t = randomUUID();
  await db.query(
    'INSERT INTO ai_assistant_threads(id,account_id,owner_principal_id) VALUES($1,NULL,$2)',
    [t, f.principalId],
  );
  const before = transport.dispatch.mock.calls.length;
  await expect(
    service().create(f.principalId, t, { requestId: randomUUID(), prompt: 'x', size: 512 }),
  ).rejects.toThrow();
  expect(transport.dispatch).toHaveBeenCalledTimes(before);
});
it('image UUID tombstones do not consume the existing text hourly budget', async () => {
  const t = await createThread();
  for (let i = 0; i < 30; i++) {
    const request = randomUUID(),
      provider = randomUUID();
    await db.query(
      "INSERT INTO ai_image_jobs(owner_principal_id,request_id,thread_id,provider_id,marker,seed,prompt,payload_digest,graph_digest,size,settings_snapshot) VALUES($1,$2,$3,$4,$5,1,'quota fixture',$6,$6,512,'{}')",
      [owner, request, t, provider, 'ASA_' + provider.replaceAll('-', ''), '0'.repeat(64)],
    );
    await db.query(
      'INSERT INTO ai_assistant_request_quota(account_id,owner_principal_id,request_id) SELECT account_id,id,$2 FROM principals WHERE id=$1',
      [owner, request],
    );
    await db.query("UPDATE ai_image_jobs SET state='failed' WHERE request_id=$1", [request]);
  }
  await db.query(
    "UPDATE ai_ollama_settings SET enabled=true,model='gemma:test' WHERE singleton_key",
  );
  const revision = (
    await db.query<{ revision: string }>(
      'SELECT revision FROM ai_ollama_settings WHERE singleton_key',
    )
  ).rows[0]!.revision;
  const result = await pool.query<{ admitted: boolean }>(
    'SELECT ai_text_begin_local($1,$2,$3,$4,$5::bigint) AS admitted',
    [owner, t, randomUUID(), 'A text question', revision],
  );
  expect(result.rows[0]?.admitted).toBe(true);
});
it('lost dispatch-CAS response is reconciled without ever posting the provider job', async () => {
  const other = await identity();
  const t = (await pool.query<{ id: string }>('SELECT ai_chat_create($1) AS id', [other])).rows[0]!
    .id;
  let lose = true;
  const uncertainPool = {
    query: async (sql: string, params: unknown[]) => {
      const result = await pool.query(sql, params);
      if (lose && sql.includes('ai_image_dispatch(')) {
        lose = false;
        throw new Error('database response disconnected');
      }
      return result;
    },
  } as unknown as pg.Pool;
  const s = new AiImageService(uncertainPool, { transport, blobs, maintenance: false });
  const id = randomUUID();
  const before = transport.dispatch.mock.calls.length;
  await expect(
    s.create(other, t, { requestId: id, prompt: 'One exact image', size: 512 }),
  ).rejects.toThrow();
  expect(
    (await s.create(other, t, { requestId: id, prompt: 'One exact image', size: 512 })).state,
  ).toBe('submitting');
  expect(transport.dispatch).toHaveBeenCalledTimes(before);
});

it('labels definite pre-admission size rejection distinctly from generic post-commit read denial', async () => {
  const fresh = await identity();
  const t = (await pool.query<{ id: string }>('SELECT ai_chat_create($1) AS id', [fresh])).rows[0]!
    .id;
  await expect(
    service().create(fresh, t, { requestId: randomUUID(), prompt: 'x', size: 768 }),
  ).rejects.toMatchObject({ code: 'ai_image_not_admitted', status: 400 });
  const row = (
    await db.query<{
      owner_principal_id: string;
      thread_id: string;
      request_id: string;
      prompt: string;
    }>(
      "SELECT owner_principal_id,thread_id,request_id,prompt FROM ai_image_jobs WHERE state='submitting' ORDER BY created_at DESC LIMIT 1",
    )
  ).rows[0]!;
  const afterCommitPool = {
    query: async (sql: string, params: unknown[]) => {
      if (sql.startsWith('SELECT ai_image_get(')) throw new Error('AI_SCOPE_DENIED');
      return pool.query(sql, params);
    },
  } as unknown as pg.Pool;
  await expect(
    new AiImageService(afterCommitPool, { transport, blobs, maintenance: false }).create(
      row.owner_principal_id,
      row.thread_id,
      { requestId: row.request_id, prompt: row.prompt, size: 512 },
    ),
  ).rejects.toMatchObject({ code: 'ai_image_denied', status: 403 });
});
it('confirmed readiness rejection creates no receipt and permits the same UUID after recovery; post-admission 503 stays uncertain', async () => {
  const s = service();
  await expireImageLeases();
  transport.recover.mockResolvedValueOnce({ state: 'failed' });
  await s.sweep();
  const fresh = await identity();
  const t = (await pool.query<{ id: string }>('SELECT ai_chat_create($1) AS id', [fresh])).rows[0]!
    .id;
  const requestId = randomUUID();
  transport.readiness.mockResolvedValueOnce({ ready: false, reason: null });
  await expect(
    s.create(fresh, t, { requestId, prompt: 'Local readiness race', size: 512 }),
  ).rejects.toMatchObject({ code: 'ai_image_not_admitted', status: 503 });
  expect(
    (await db.query('SELECT * FROM ai_image_jobs WHERE request_id=$1', [requestId])).rows,
  ).toHaveLength(0);
  expect(
    (await db.query('SELECT * FROM ai_assistant_request_quota WHERE request_id=$1', [requestId]))
      .rows,
  ).toHaveLength(0);
  expect(
    (await s.create(fresh, t, { requestId, prompt: 'Local readiness race', size: 512 })).state,
  ).toBe('submitting');
  const afterCommitPool = {
    query: async (sql: string, params: unknown[]) => {
      if (sql.startsWith('SELECT ai_image_get(')) throw new Error('AI_IMAGE_UNAVAILABLE');
      return pool.query(sql, params);
    },
  } as unknown as pg.Pool;
  await expect(
    new AiImageService(afterCommitPool, { transport, blobs, maintenance: false }).create(fresh, t, {
      requestId,
      prompt: 'Local readiness race',
      size: 512,
    }),
  ).rejects.toMatchObject({ code: 'ai_image_unavailable', status: 503 });
});
it('deleting an uncertain storing job releases only the finished GPU slot while retaining late-write cleanup and immutable quota', async () => {
  const s = service();
  await expireImageLeases();
  transport.recover.mockResolvedValueOnce({ state: 'failed' });
  await s.sweep();
  const fresh = await identity();
  const t = (await pool.query<{ id: string }>('SELECT ai_chat_create($1) AS id', [fresh])).rows[0]!
    .id;
  const requestId = randomUUID();
  await s.create(fresh, t, {
    requestId,
    prompt: 'GPU finished before unknown object write',
    size: 512,
  });
  transport.recover.mockResolvedValueOnce({
    state: 'complete',
    png: Buffer.from('sanitized fixed provider output'),
  });
  blobs.putImmutable.mockRejectedValueOnce(new AiAttachmentStorageError('unknown'));
  await s.sweep();
  const before = (
    await db.query<{ state: string; lease_id: string; sha256: string; size_bytes: number }>(
      'SELECT state,lease_id,sha256,size_bytes FROM ai_image_jobs WHERE request_id=$1',
      [requestId],
    )
  ).rows[0]!;
  expect(before.state).toBe('storing');
  await pool.query('SELECT ai_chat_delete($1,$2)', [fresh, t]);
  const deleted = (
    await db.query<{
      state: string;
      cleanup_required: boolean;
      put_uncertain: boolean;
      sha256: string;
      prompt: null;
    }>(
      'SELECT state,cleanup_required,put_uncertain,sha256,prompt FROM ai_image_jobs WHERE request_id=$1',
      [requestId],
    )
  ).rows[0]!;
  expect(deleted).toMatchObject({
    state: 'cancelled',
    cleanup_required: true,
    put_uncertain: true,
    sha256: before.sha256,
    prompt: null,
  });
  const finished = (
    await db.query<{ status: string; finished_at: string }>(
      'SELECT status,finished_at FROM ai_usage_journal WHERE request_id=$1',
      [requestId],
    )
  ).rows[0]!;
  expect(finished.status).toBe('cancelled');
  expect(finished.finished_at).not.toBeNull();
  expect(
    (
      await pool.query<{ changed: boolean }>(
        "SELECT ai_image_transition($1,$2,$3,'running') AS changed",
        [fresh, requestId, before.lease_id],
      )
    ).rows[0]?.changed,
  ).toBe(false);
  await pool.query("SELECT ai_image_transition($1,$2,$3,'complete')", [
    fresh,
    requestId,
    before.lease_id,
  ]);
  const nextThread = (await pool.query<{ id: string }>('SELECT ai_chat_create($1) AS id', [fresh]))
    .rows[0]!.id;
  const nextId = randomUUID();
  expect(
    (
      await s.create(fresh, nextThread, {
        requestId: nextId,
        prompt: 'A second local image',
        size: 512,
      })
    ).state,
  ).toBe('submitting');
  let lateObjectPresent = true;
  blobs.remove.mockImplementationOnce(async () => {
    lateObjectPresent = false;
    return true;
  });
  await db.query('UPDATE ai_image_jobs SET lease_until=NULL WHERE request_id=$1', [requestId]);
  await s.sweep();
  expect(lateObjectPresent).toBe(false);
  lateObjectPresent = true;
  blobs.remove.mockImplementationOnce(async () => {
    lateObjectPresent = false;
    return true;
  });
  await db.query('UPDATE ai_image_jobs SET lease_until=NULL WHERE request_id=$1', [requestId]);
  await s.sweep();
  expect(lateObjectPresent).toBe(false);
  expect(
    (
      await db.query(
        'SELECT state,cleanup_required,put_uncertain FROM ai_image_jobs WHERE request_id=$1',
        [requestId],
      )
    ).rows[0],
  ).toMatchObject({ state: 'cancelled', cleanup_required: true, put_uncertain: true });
  expect(
    (
      await db.query('SELECT status,finished_at FROM ai_usage_journal WHERE request_id=$1', [
        requestId,
      ])
    ).rows[0],
  ).toEqual(finished);
  expect(
    (
      await db.query('SELECT * FROM ai_assistant_request_quota WHERE owner_principal_id=$1', [
        fresh,
      ])
    ).rows,
  ).toHaveLength(2);
  expect(
    (await db.query('SELECT * FROM ai_assistant_messages WHERE thread_id=$1', [t])).rows,
  ).toHaveLength(0);
  // Unknown GPU work has no finished output descriptor and must retain its permit after deletion.
  await db.query('UPDATE ai_image_jobs SET lease_until=NULL WHERE request_id=$1', [nextId]);
  transport.recover.mockResolvedValueOnce({ state: 'missing' });
  await s.sweep();
  await s.cancel(fresh, nextThread, nextId);
  await pool.query('SELECT ai_chat_delete($1,$2)', [fresh, nextThread]);
  expect(
    (
      await db.query<{ state: string }>('SELECT state FROM ai_image_jobs WHERE request_id=$1', [
        nextId,
      ])
    ).rows[0]?.state,
  ).toBe('unknown');
  const thirdThread = (await pool.query<{ id: string }>('SELECT ai_chat_create($1) AS id', [fresh]))
    .rows[0]!.id;
  await expect(
    s.create(fresh, thirdThread, {
      requestId: randomUUID(),
      prompt: 'Must wait for known terminal GPU result',
      size: 512,
    }),
  ).rejects.toMatchObject({ code: 'ai_image_not_admitted', status: 429 });
});
it('cleanup_done defensively closes historical deleted storing rows without erasing their uncertain PUT tombstone', async () => {
  const j = (
    await db.query<{ owner_principal_id: string; request_id: string }>(
      'SELECT owner_principal_id,request_id FROM ai_image_jobs WHERE deleted_at IS NOT NULL AND put_uncertain AND cleanup_required ORDER BY created_at DESC LIMIT 1',
    )
  ).rows[0]!;
  // Reproduce the persisted state left by the previous deletion implementation.
  await db.query("UPDATE ai_image_jobs SET state='storing',lease_until=NULL WHERE request_id=$1", [
    j.request_id,
  ]);
  await db.query(
    "UPDATE ai_usage_journal SET status='running',finished_at=NULL WHERE request_id=$1",
    [j.request_id],
  );
  await service().sweep();
  expect(
    (
      await db.query(
        'SELECT state,cleanup_required,put_uncertain FROM ai_image_jobs WHERE request_id=$1',
        [j.request_id],
      )
    ).rows[0],
  ).toMatchObject({ state: 'cancelled', cleanup_required: true, put_uncertain: true });
  expect(
    (
      await db.query<{ status: string }>(
        'SELECT status FROM ai_usage_journal WHERE request_id=$1',
        [j.request_id],
      )
    ).rows[0]?.status,
  ).toBe('cancelled');
});

it('atomically turns an admitted local text request into one owner-scoped image job', async () => {
  await config();
  const actor = await identity();
  const chat = (await pool.query<{ id: string }>('SELECT ai_chat_create($1) AS id', [actor]))
    .rows[0]!.id;
  await db.query(
    "UPDATE ai_image_jobs SET state='failed' WHERE state IN('admitted','submitting','unknown','running','storing')",
  );
  await db.query(
    "UPDATE ai_ollama_settings SET enabled=true,model='gemma:test' WHERE singleton_key",
  );
  const revision = (
    await db.query<{ revision: string }>(
      'SELECT revision FROM ai_ollama_settings WHERE singleton_key',
    )
  ).rows[0]!.revision;
  const parent = randomUUID();
  const childPrompt = 'A detailed sunlit forest with a village and winding path';
  expect(
    (
      await pool.query<{ admitted: boolean }>(
        'SELECT ai_text_begin_local($1,$2,$3,$4,$5::bigint) AS admitted',
        [actor, chat, parent, 'Нарисуй красивый лес и деревню', revision],
      )
    ).rows[0]?.admitted,
  ).toBe(true);
  const options = {
    text: 'Нарисуй красивый лес и деревню',
    nativeImage: { mode: 'auto', size: 512 },
  };
  await pool.query('SELECT ai_tool_request_options($1,$2,$3,$4::jsonb,true)', [
    actor,
    chat,
    parent,
    JSON.stringify(options),
  ]);
  await pool.query('SELECT ai_tool_policy_snapshot($1,$2,$3) AS value', [actor, chat, parent]);
  const before = transport.dispatch.mock.calls.length;
  const job = await service().createFromTool(
    actor,
    chat,
    parent,
    childPrompt,
    512,
    new AbortController().signal,
  );
  expect(
    (
      await db.query<{ size: number }>('SELECT size FROM ai_image_jobs WHERE request_id=$1', [
        job.requestId,
      ])
    ).rows[0]?.size,
  ).toBe(512);
  expect(transport.dispatch.mock.calls.length).toBe(before + 1);
  expect((await service().replayTool(actor, chat, parent))?.requestId).toBe(job.requestId);
  expect(
    (await service().pendingTools(actor, chat)).some((item) => item.requestId === job.requestId),
  ).toBe(true);
  expect(
    (
      await db.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM ai_assistant_messages WHERE thread_id=$1 AND role='user'",
        [chat],
      )
    ).rows[0]?.count,
  ).toBe('1');
  expect(
    (
      await db.query<{ active_request_id: string | null }>(
        'SELECT active_request_id FROM ai_assistant_threads WHERE id=$1',
        [chat],
      )
    ).rows[0]?.active_request_id,
  ).toBeNull();
  const acknowledged = await new AiTextHistoryStore(pool).messages(actor, chat);
  expect(
    acknowledged.find((item) => item.role === 'assistant' && item.requestId === parent)?.content,
  ).toContain('Задание');
  const lease = randomUUID();
  await db.query(
    "UPDATE ai_image_jobs SET lease_id=$2,lease_until=clock_timestamp()+interval '2 minutes' WHERE request_id=$1",
    [job.requestId, lease],
  );
  expect(
    (
      await pool.query<{ value: boolean }>(
        'SELECT ai_image_transition($1,$2,$3,$4::varchar,$5::varchar,$6::integer,$7::varchar) AS value',
        [actor, job.requestId, lease, 'storing', 'a'.repeat(64), 3, null],
      )
    ).rows[0]?.value,
  ).toBe(true);
  expect(
    (
      await pool.query<{ value: boolean }>(
        'SELECT ai_image_transition($1,$2,$3,$4::varchar,$5::varchar,$6::integer,$7::varchar) AS value',
        [actor, job.requestId, lease, 'complete', null, null, null],
      )
    ).rows[0]?.value,
  ).toBe(true);
  const completed = await new AiTextHistoryStore(pool).messages(actor, chat);
  expect(completed.filter((item) => item.role === 'assistant')).toHaveLength(1);
  expect(completed.filter((item) => item.role === 'user')).toHaveLength(1);
  expect(
    completed.filter((item) => item.role === 'assistant' && item.generatedImages?.length),
  ).toHaveLength(1);
  expect(
    completed.find((item) => item.role === 'assistant' && item.requestId === parent)
      ?.generatedImages?.[0]?.requestId,
  ).toBe(job.requestId);
  expect(
    (
      await db.query<{ source_user_message_id: string; child_request_id: string }>(
        'SELECT source_user_message_id,child_request_id FROM ai_tool_image_receipts WHERE owner_principal_id=$1 AND parent_request_id=$2',
        [actor, parent],
      )
    ).rows[0],
  ).toMatchObject({
    child_request_id: job.requestId,
    source_user_message_id: completed.find((item) => item.role === 'user')?.id,
  });
  const manualThread = (
    await pool.query<{ id: string }>('SELECT ai_chat_create($1) AS id', [actor])
  ).rows[0]!.id;
  const manual = await service().create(actor, manualThread, {
    requestId: randomUUID(),
    prompt: 'Manual landscape',
    size: 512,
  });
  const manualLease = randomUUID();
  await db.query(
    "UPDATE ai_image_jobs SET lease_id=$2,lease_until=clock_timestamp()+interval '2 minutes' WHERE request_id=$1",
    [manual.requestId, manualLease],
  );
  await pool.query(
    'SELECT ai_image_transition($1,$2,$3,$4::varchar,$5::varchar,$6::integer,$7::varchar)',
    [actor, manual.requestId, manualLease, 'storing', 'b'.repeat(64), 3, null],
  );
  await pool.query(
    'SELECT ai_image_transition($1,$2,$3,$4::varchar,$5::varchar,$6::integer,$7::varchar)',
    [actor, manual.requestId, manualLease, 'complete', null, null, null],
  );
  const manualHistory = await new AiTextHistoryStore(pool).messages(actor, manualThread);
  expect(manualHistory.filter((item) => item.role === 'assistant')).toHaveLength(1);
  expect(manualHistory[1]?.generatedImages?.[0]?.requestId).toBe(manual.requestId);
  await expect(service().replayTool(stranger, chat, parent)).rejects.toThrow();
});
