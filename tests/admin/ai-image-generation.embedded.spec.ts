import { nativeTools, parseNativeToolCalls } from '../../apps/api/src/ai-native-tools';
import { AiChatService } from '../../apps/api/src/ai-chat.service';
import { AI_IMAGE_PRESETS } from '@asa-lab/contracts';
import { publishFixturePolicy, fixtureGenerationSql } from './ai-model-policy.fixture';
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
let legacyOwner: string, legacyThread: string, legacyRequest: string, legacyParent: string;
let legacyJob: Record<string, unknown>;
const legacyNativePayload = {
  text: 'Legacy image',
  model: null,
  source: null,
  uploads: [],
  webSearchMode: null,
  weatherCity: null,
  nativeImage: { mode: 'auto' as const, size: 512 },
};
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
  return service().saveAdmin(admin, { ...c, requestId: randomUUID(), enabled, sizes: [768] });
}
async function createThread() {
  return (await pool.query<{ id: string }>('SELECT ai_chat_create($1) AS id', [owner])).rows[0]!.id;
}
async function initialize(upgrade = false) {
  db = new PGlite();
  await applyPlan(
    {
      query: async (sql: string, params?: unknown[]) =>
        params?.length ? db.query(sql, params) : { rows: (await db.exec(sql)).at(-1)?.rows ?? [] },
    },
    planMigrations('migrations').filter((m: { version: string }) => !upgrade || m.version < '0280'),
  );
  admin = await identity(true);
  owner = await identity();
  stranger = await identity();
  thread = await createThread();
  if (!upgrade) return;
  await pool.query('SELECT ai_image_config_set($1,$2::jsonb)', [
    admin,
    JSON.stringify({
      requestId: randomUUID(),
      configurationVersion: 1,
      enabled: true,
      dailyLimit: 17,
      globalConcurrency: 2,
      sizes: [512],
    }),
  ]);
  await pool.query('SELECT ai_comfyui_config_set($1,1,$2,$3)', [
    admin,
    'http://192.168.12.20:8188',
    randomUUID(),
  ]);
  legacyOwner = await identity();
  legacyThread = (
    await pool.query<{ id: string }>('SELECT ai_chat_create($1) AS id', [legacyOwner])
  ).rows[0]!.id;
  legacyRequest = randomUUID();
  await pool.query('SELECT ai_image_begin($1,$2,$3,$4,512,$5,42,true,$6)', [
    legacyOwner,
    legacyThread,
    legacyRequest,
    'Legacy image',
    randomUUID(),
    'a'.repeat(64),
  ]);
  await db.query(
    "UPDATE ai_image_jobs SET state='complete',sha256=$2,size_bytes=10 WHERE request_id=$1",
    [legacyRequest, 'b'.repeat(64)],
  );
  legacyJob = (
    await db.query<Record<string, unknown>>('SELECT * FROM ai_image_jobs WHERE request_id=$1', [
      legacyRequest,
    ])
  ).rows[0]!;
  legacyParent = randomUUID();
  await db.query(
    `INSERT INTO ai_tool_image_receipts(owner_principal_id,parent_request_id,thread_id,source_user_message_id,child_request_id,prompt,size,recipe)
    SELECT $1,$2,$3,id,$4,'Legacy image',512,'flux2-klein-4b-v1' FROM ai_assistant_messages WHERE request_id=$4 AND role='user'`,
    [legacyOwner, legacyParent, legacyThread, legacyRequest],
  );
  await db.query(
    "UPDATE ai_ollama_settings SET enabled=true,model='gemma:test' WHERE singleton_key",
  );
  await publishFixturePolicy(pool, admin, 'ollama-local');
  await pool.query(
    `SELECT ai_generation_begin($1,$2,$3,$4::jsonb,'ollama-local',
    (ai_generation_policy_runtime()->>'revision')::bigint,$5::bigint)`,
    [
      legacyOwner,
      legacyThread,
      legacyParent,
      JSON.stringify(legacyNativePayload),
      (
        await db.query<{ revision: string }>(
          'SELECT revision FROM ai_ollama_settings WHERE singleton_key',
        )
      ).rows[0]!.revision,
    ],
  );
  await pool.query('SELECT ai_tool_request_options($1,$2,$3,$4::jsonb,true)', [
    legacyOwner,
    legacyThread,
    legacyParent,
    JSON.stringify(legacyNativePayload),
  ]);
  await applyPlan(
    {
      query: async (sql: string, params?: unknown[]) =>
        params?.length ? db.query(sql, params) : { rows: (await db.exec(sql)).at(-1)?.rows ?? [] },
    },
    planMigrations('migrations'),
  );
}
beforeAll(() => initialize(true), 120000);
afterAll(async () => {
  await db.close();
});
it('upgrades the complete 0279 ledger preserving saved endpoint, controls and legacy receipts', async () => {
  const settings = (await db.query('SELECT * FROM ai_image_settings')).rows[0]!;
  expect(settings).toMatchObject({
    enabled: true,
    daily_limit: 17,
    global_concurrency: 2,
    sizes: AI_IMAGE_PRESETS.map((p) => p.id),
    revision: 3,
    comfy_revision: 2,
    comfy_base_url: 'http://192.168.12.20:8188',
  });
  expect(
    (await db.query('SELECT * FROM ai_image_jobs WHERE request_id=$1', [legacyRequest])).rows[0],
  ).toEqual(legacyJob);
  expect((await service().get(legacyOwner, legacyThread, legacyRequest)).image).toMatchObject({
    width: 512,
    height: 512,
  });
  expect(
    (
      await pool.query<{ value: unknown[] }>('SELECT ai_image_history($1,$2,$3) AS value', [
        legacyOwner,
        legacyThread,
        legacyRequest,
      ])
    ).rows[0]!.value[0],
  ).toMatchObject({ width: 512, height: 512 });
  // Existing exact SQL receipt replay remains free after 512 leaves new admission.
  await pool.query('SELECT ai_image_begin($1,$2,$3,$4,512,$5,42,false,$6)', [
    legacyOwner,
    legacyThread,
    legacyRequest,
    'Legacy image',
    randomUUID(),
    'a'.repeat(64),
  ]);
  expect(
    (await db.query('SELECT * FROM ai_image_jobs WHERE request_id=$1', [legacyRequest])).rows[0],
  ).toEqual(legacyJob);
  expect(
    (await service().replayTool(legacyOwner, legacyThread, legacyParent))?.image,
  ).toMatchObject({ width: 512, height: 512 });
  expect(
    (
      await pool.query<{ value: boolean }>(
        'SELECT ai_tool_request_options($1,$2,$3,$4::jsonb,false) AS value',
        [legacyOwner, legacyThread, legacyParent, JSON.stringify(legacyNativePayload)],
      )
    ).rows[0]!.value,
  ).toBe(true);
  await expect(service().replayTool(stranger, legacyThread, legacyParent)).rejects.toThrow();
  const replayInput = { requestId: legacyRequest, prompt: 'Legacy image', size: 512 };
  const quotaBefore = (await db.query('SELECT * FROM ai_assistant_request_quota')).rows;
  const usageBefore = (await db.query('SELECT * FROM ai_usage_journal')).rows;
  expect((await service().create(legacyOwner, legacyThread, replayInput)).image).toMatchObject({
    width: 512,
    height: 512,
  });
  await expect(
    service().create(legacyOwner, legacyThread, { ...replayInput, prompt: 'Different intent' }),
  ).rejects.toThrow();
  await expect(service().create(stranger, legacyThread, replayInput)).rejects.toThrow();
  await expect(
    service().create(legacyOwner, legacyThread, { ...replayInput, requestId: randomUUID() }),
  ).rejects.toThrow();
  await db.query(
    "UPDATE ai_image_jobs SET state='submitting',sha256=NULL,size_bytes=NULL WHERE request_id=$1",
    [legacyRequest],
  );
  expect((await service().create(legacyOwner, legacyThread, replayInput)).state).toBe('submitting');
  expect((await service().get(legacyOwner, legacyThread, legacyRequest)).state).toBe('submitting');
  expect((await service().pendingTools(legacyOwner, legacyThread))[0]?.requestId).toBe(
    legacyRequest,
  );
  await db.query("UPDATE ai_image_jobs SET state='admitted' WHERE request_id=$1", [legacyRequest]);
  expect((await service().create(legacyOwner, legacyThread, replayInput)).state).toBe('admitted');
  expect((await db.query('SELECT * FROM ai_assistant_request_quota')).rows).toEqual(quotaBefore);
  expect((await db.query('SELECT * FROM ai_usage_journal')).rows).toEqual(usageBefore);
  const fetchImpl = vi.fn<typeof fetch>();
  const queries = vi.fn(async (sql: string, params: unknown[] = []) => pool.query(sql, params));
  const chat = new AiChatService({ query: queries } as unknown as pg.Pool, {
    images: service(),
    fetchImpl,
  });
  const nativeReplay = (actor = legacyOwner, request = legacyParent, text = 'Legacy image') =>
    chat.sendStream(
      actor,
      legacyThread,
      text,
      request,
      () => undefined,
      new AbortController().signal,
      undefined,
      undefined,
      [],
      undefined,
      undefined,
      legacyNativePayload.nativeImage,
    );
  const nativeQuota = (await db.query('SELECT * FROM ai_assistant_request_quota')).rows;
  const holds = (await db.query('SELECT * FROM ai_token_budget_reservations')).rows;
  const nativeReceipts = (await db.query('SELECT * FROM ai_tool_request_receipts')).rows;
  expect(await nativeReplay()).toMatchObject({
    replayed: true,
    imageJob: { requestId: legacyRequest },
  });
  await expect(nativeReplay(legacyOwner, randomUUID())).rejects.toMatchObject({
    code: 'ai_input_invalid',
  });
  await expect(nativeReplay(legacyOwner, legacyParent, 'Different intent')).rejects.toThrow();
  await expect(nativeReplay(stranger)).rejects.toThrow();
  expect((await db.query('SELECT * FROM ai_assistant_request_quota')).rows).toEqual(nativeQuota);
  expect((await db.query('SELECT * FROM ai_token_budget_reservations')).rows).toEqual(holds);
  expect(
    queries.mock.calls.some(([sql]) =>
      /ai_runtime_config|ai_ollama_runtime|ai_generation_begin|ai_chat_begin/.test(sql),
    ),
  ).toBe(false);
  expect((await db.query('SELECT * FROM ai_tool_request_receipts')).rows).toEqual(nativeReceipts);
  expect(fetchImpl).not.toHaveBeenCalled();
  expect(transport.dispatch).not.toHaveBeenCalled();
  const before = await service().admin(admin);
  await service().saveAdmin(admin, {
    ...before,
    requestId: randomUUID(),
    enabled: false,
    dailyLimit: 10,
    globalConcurrency: 1,
  });
  expect(
    (await pool.query<{ value: string }>('SELECT ai_comfyui_runtime() AS value')).rows[0]!.value,
  ).toBe('http://192.168.12.20:8188');
  await db.close();
  await initialize();
}, 120000);
it('defaults disabled; validates bounded admin/prompt payloads', async () => {
  expect((await service().admin(admin)).enabled).toBe(false);
  expect(() => imageInput({ requestId: randomUUID(), prompt: '', size: 768 })).toThrow();
  expect(() =>
    imageAdminInput({
      requestId: randomUUID(),
      configurationVersion: 1,
      enabled: true,
      dailyLimit: 101,
      globalConcurrency: 1,
      sizes: [768],
    }),
  ).toThrow();
  await expect(service().admin(stranger)).rejects.toThrow();
});
it('admits local image without any text keys, dispatches once, unknown keeps global budget and journal token NULL', async () => {
  await config();
  const id = randomUUID();
  transport.dispatch.mockRejectedValueOnce(new Error('timeout'));
  const s = service();
  const job = await s.create(owner, thread, { requestId: id, prompt: 'A blue cube', size: 768 });
  expect(job.state).toBe('submitting');
  await s.create(owner, thread, { requestId: id, prompt: 'A blue cube', size: 768 });
  expect(transport.dispatch).toHaveBeenCalledTimes(1);
  await expect(
    s.create(owner, thread, { requestId: id, prompt: 'different', size: 768 }),
  ).rejects.toThrow();
  await expect(s.get(stranger, thread, id)).rejects.toThrow();
  await expect(
    s.create(owner, thread, { requestId: randomUUID(), prompt: 'other', size: 768 }),
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
      size: 768,
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
  await s.create(owner, thread, { requestId: id, prompt: 'A green cube', size: 768 });
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
    service().create(owner, t, { requestId: randomUUID(), prompt: 'x', size: 768 }),
  ).rejects.toThrow();
  const c = await service().admin(admin);
  const input = { ...c, requestId: randomUUID(), enabled: true };
  await service().saveAdmin(admin, input);
  await service().saveAdmin(admin, input);
  await expect(service().saveAdmin(admin, { ...input, dailyLimit: 11 })).rejects.toThrow();
  await pool.query('SELECT * FROM ai_text_archive($1,$2,true)', [owner, t]);
  await expect(
    service().create(owner, t, { requestId: randomUUID(), prompt: 'x', size: 768 }),
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
    service().create(f.principalId, t, { requestId: randomUUID(), prompt: 'x', size: 768 }),
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
  await publishFixturePolicy(pool, admin, 'ollama-local');
  const result = await pool.query<{ admitted: boolean }>(fixtureGenerationSql, [
    owner,
    t,
    randomUUID(),
    'A text question',
    revision,
  ]);
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
    s.create(other, t, { requestId: id, prompt: 'One exact image', size: 768 }),
  ).rejects.toThrow();
  expect(
    (await s.create(other, t, { requestId: id, prompt: 'One exact image', size: 768 })).state,
  ).toBe('submitting');
  expect(transport.dispatch).toHaveBeenCalledTimes(before);
});

it('labels definite pre-admission size rejection distinctly from generic post-commit read denial', async () => {
  const fresh = await identity();
  const t = (await pool.query<{ id: string }>('SELECT ai_chat_create($1) AS id', [fresh])).rows[0]!
    .id;
  await expect(
    service().create(fresh, t, { requestId: randomUUID(), prompt: 'x', size: 1024 }),
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
      { requestId: row.request_id, prompt: row.prompt, size: 768 },
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
    s.create(fresh, t, { requestId, prompt: 'Local readiness race', size: 768 }),
  ).rejects.toMatchObject({ code: 'ai_image_not_admitted', status: 503 });
  expect(
    (await db.query('SELECT * FROM ai_image_jobs WHERE request_id=$1', [requestId])).rows,
  ).toHaveLength(0);
  expect(
    (await db.query('SELECT * FROM ai_assistant_request_quota WHERE request_id=$1', [requestId]))
      .rows,
  ).toHaveLength(0);
  expect(
    (await s.create(fresh, t, { requestId, prompt: 'Local readiness race', size: 768 })).state,
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
      size: 768,
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
    size: 768,
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
        size: 768,
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
      size: 768,
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
  await publishFixturePolicy(pool, admin, 'ollama-local');
  const fp8Settings = await service().saveAdmin(admin, {
    ...(await service().admin(admin)),
    requestId: randomUUID(),
    recipe: 'flux2-klein-4b-fp8-izo-v1',
  });
  const parent = randomUUID();
  const childPrompt = 'A detailed sunlit forest with a village and winding path';
  expect(
    (
      await pool.query<{ admitted: boolean }>(fixtureGenerationSql, [
        actor,
        chat,
        parent,
        'Нарисуй красивый лес и деревню',
        revision,
      ])
    ).rows[0]?.admitted,
  ).toBe(true);
  const options = {
    text: 'Нарисуй красивый лес и деревню',
    nativeImage: { mode: 'auto', size: 768 },
  };
  await pool.query('SELECT ai_tool_request_options($1,$2,$3,$4::jsonb,true)', [
    actor,
    chat,
    parent,
    JSON.stringify(options),
  ]);
  await pool.query('SELECT ai_tool_policy_snapshot($1,$2,$3) AS value', [actor, chat, parent]);
  await expect(
    service().saveAdmin(admin, {
      ...fp8Settings,
      requestId: randomUUID(),
      recipe: 'flux2-klein-4b-v1',
    }),
  ).rejects.toThrow();
  const before = transport.dispatch.mock.calls.length;
  const offered = nativeTools({
    imageSizes: [768],
    imageRecipe: fp8Settings.recipe,
    search: false,
    weather: false,
  });
  const parsed = parseNativeToolCalls(
    [
      {
        function: {
          name: 'generate_image',
          arguments: { prompt: childPrompt, size: 768, model: fp8Settings.recipe },
        },
      },
    ],
    offered,
  )[0]!;
  const job = await service().createFromTool(
    actor,
    chat,
    parent,
    parsed.arguments.prompt as string,
    768,
    new AbortController().signal,
    parsed.arguments.model as typeof fp8Settings.recipe,
  );
  expect(
    (
      await db.query<{ size: number }>('SELECT size FROM ai_image_jobs WHERE request_id=$1', [
        job.requestId,
      ])
    ).rows[0]?.size,
  ).toBe(768);
  expect(transport.dispatch.mock.calls.length).toBe(before + 1);
  expect(
    (
      await db.query<{ recipe: string }>(
        'SELECT recipe FROM ai_tool_image_receipts WHERE child_request_id=$1',
        [job.requestId],
      )
    ).rows[0]!.recipe,
  ).toBe('flux2-klein-4b-fp8-izo-v1');
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
    size: 768,
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

it('uses the six preset dimensions in durable owner history and rejects new 512 jobs', async () => {
  await db.query(
    "UPDATE ai_image_jobs SET state='failed' WHERE state IN('admitted','submitting','unknown','running','storing')",
  );
  const settings = await service().admin(admin);
  const ids = AI_IMAGE_PRESETS.map((p) => p.id);
  await service().saveAdmin(admin, {
    ...settings,
    requestId: randomUUID(),
    enabled: true,
    sizes: ids,
  });
  const actor = await identity();
  const chat = (await pool.query<{ id: string }>('SELECT ai_chat_create($1) AS id', [actor]))
    .rows[0]!.id;
  expect((await service().status(actor)).sizes).toEqual(ids);
  for (const preset of AI_IMAGE_PRESETS) {
    const id = randomUUID();
    await service().create(actor, chat, {
      requestId: id,
      prompt: 'Test dimensions',
      size: preset.id,
    });
    await db.query(
      "UPDATE ai_image_jobs SET state='complete',sha256=$2,size_bytes=10,put_started=true,put_uncertain=false WHERE request_id=$1",
      [id, 'a'.repeat(64)],
    );
    const visible = await service().get(actor, chat, id);
    expect(visible.image).toMatchObject({ width: preset.width, height: preset.height });
    const stored = (
      await pool.query<{ value: { width: number; height: number }[] }>(
        'SELECT ai_image_history($1,$2,$3) AS value',
        [actor, chat, id],
      )
    ).rows[0]!.value;
    expect(stored[0]).toMatchObject({ width: preset.width, height: preset.height });
    expect(
      (
        await pool.query<{ value: unknown[] }>('SELECT ai_image_history($1,$2,$3) AS value', [
          stranger,
          chat,
          id,
        ])
      ).rows[0]!.value,
    ).toEqual([]);
  }
  expect(() =>
    imageInput({ requestId: randomUUID(), prompt: 'New small image', size: 512 }),
  ).toThrow();
  await expect(
    service().saveAdmin(admin, {
      ...(await service().admin(admin)),
      requestId: randomUUID(),
      sizes: [512],
    }),
  ).rejects.toThrow();
});

it('pins FP8 admission and digest, preserves old-client config, rejects active profile switches and stale recipe admission', async () => {
  await db.query(
    "UPDATE ai_image_jobs SET state='failed' WHERE state IN('admitted','submitting','unknown','running','storing')",
  );
  await db.query('UPDATE ai_assistant_threads SET busy_until=NULL,active_request_id=NULL');
  const recipe = 'flux2-klein-4b-fp8-izo-v1';
  let settings = await service().saveAdmin(admin, {
    ...(await service().admin(admin)),
    requestId: randomUUID(),
    enabled: true,
    recipe,
  });
  const { recipe: omitted, ...oldClient } = settings;
  expect(omitted).toBe(recipe);
  settings = await service().saveAdmin(admin, { ...oldClient, requestId: randomUUID() });
  expect(settings.recipe).toBe(recipe);
  const actor = await identity();
  const chat = (await pool.query<{ id: string }>('SELECT ai_chat_create($1) AS id', [actor]))
    .rows[0]!.id;
  const requestId = randomUUID();
  const before = transport.dispatch.mock.calls.length;
  await service().create(actor, chat, { requestId, prompt: 'FP8 tree', size: 1024 });
  const row = (
    await db.query<{ recipe: string; graph_digest: string; settings_snapshot: { recipe: string } }>(
      'SELECT recipe,graph_digest,settings_snapshot FROM ai_image_jobs WHERE request_id=$1',
      [requestId],
    )
  ).rows[0]!;
  expect(row.recipe).toBe(recipe);
  expect(row.settings_snapshot.recipe).toBe(recipe);
  expect(row.graph_digest).toMatch(/^[a-f0-9]{64}$/);
  transport.recover.mockResolvedValueOnce({ state: 'missing' });
  await db.query('UPDATE ai_image_jobs SET lease_until=NULL WHERE request_id=$1', [requestId]);
  await service().sweep();
  expect(transport.recover.mock.calls.at(-1)?.at(-1)).toBe(recipe);
  expect(transport.dispatch.mock.calls.length).toBe(before + 1);
  expect(transport.dispatch.mock.calls.at(-1)?.at(-1)).toBe(recipe);
  await expect(
    service().saveAdmin(admin, {
      ...settings,
      requestId: randomUUID(),
      recipe: 'flux2-klein-4b-v1',
    }),
  ).rejects.toThrow();
  await service().create(actor, chat, { requestId, prompt: 'FP8 tree', size: 1024 });
  expect(transport.dispatch.mock.calls.length).toBe(before + 1);
  await db.query("UPDATE ai_image_jobs SET state='failed' WHERE request_id=$1", [requestId]);
  settings = await service().saveAdmin(admin, {
    ...settings,
    requestId: randomUUID(),
    recipe: 'flux2-klein-4b-v1',
  });
  await expect(
    pool.query('SELECT ai_image_begin($1,$2,$3,$4,1024,$5,42,true,$6,$7)', [
      actor,
      chat,
      randomUUID(),
      'Stale profile',
      randomUUID(),
      'a'.repeat(64),
      recipe,
    ]),
  ).rejects.toThrow(/AI_CONFIG_CHANGED/);
  expect((await service().get(actor, chat, requestId)).state).toBe('failed');
});
