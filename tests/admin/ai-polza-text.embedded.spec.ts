import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import type pg from 'pg';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { applyPlan, planMigrations } from '../../tools/migrate.mjs';
import { aiIdentity } from './ai-student-access.contract';
import { AiPolzaService } from '../../apps/api/src/ai-polza.service';
import { AiChatService } from '../../apps/api/src/ai-chat.service';
import { AiTokenBudgetStore } from '../../apps/api/src/ai-token-budgets';
import { toolProviderResponse } from '../../apps/api/src/testing/ai-tool-provider.fixture';
let db: PGlite;
let actor: string;
let owner: string;
const admin = {
  query: async (sql: string, params: unknown[] = []) =>
    params.length ? db.query(sql, params) : { rows: (await db.exec(sql)).at(-1)?.rows ?? [] },
} as unknown as pg.Pool;
const runtime = {
  query: async (sql: string, params: unknown[] = []) => {
    await db.exec('SET ROLE asalab_app');
    try {
      return await db.query(sql, params);
    } finally {
      await db.exec('RESET ROLE');
    }
  },
} as unknown as pg.Pool;
const root = '29'.repeat(32);
let mode = 'text';
const model = {
  id: 'qwen/test-vision',
  name: 'Qwen test Vision',
  type: 'chat',
  architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] },
  endpoints: ['/api/v1/chat/completions'],
  top_provider: { supported_parameters: ['tools'], max_completion_tokens: 4096 },
};
const upstream = vi.fn<typeof fetch>(async (url, init) => {
  expect(new Headers(init?.headers).get('authorization')).toBe(
    'Bearer pza_isolated_polza_test_key',
  );
  if (String(url).endsWith('/models'))
    return new Response(
      JSON.stringify({
        data: [
          model,
          {
            ...model,
            id: 'text/test',
            name: 'Text test',
            architecture: { input_modalities: ['text'], output_modalities: ['text'] },
          },
          {
            id: 'stt/test',
            name: 'STT',
            type: 'stt',
            architecture: { input_modalities: ['audio'], output_modalities: ['text'] },
            endpoints: ['/api/v1/audio/transcriptions'],
          },
        ],
      }),
    );
  expect(String(url)).toBe('https://polza.ai/api/v1/chat/completions');
  const body = JSON.parse(String(init?.body));
  expect(body.model).toBe('qwen/test-vision');
  expect(body.max_tokens).toBe(4096);
  const returned = body.messages.filter((m: { role: string }) => m.role === 'tool').length;
  const call =
    mode === 'create' && returned === 0
      ? { name: 'create_working_file', arguments: { name: 'test.html', content: '<h1>One</h1>' } }
      : mode === 'edit' && returned === 0
        ? { name: 'read_working_file', arguments: { name: 'test.html' } }
        : mode === 'edit' && returned === 1
          ? {
              name: 'edit_working_file',
              arguments: {
                name: 'test.html',
                expectedVersion: 1,
                edits: [{ oldText: 'One', newText: 'Two' }],
              },
            }
          : null;
  return toolProviderResponse('deepseek', {
    message: call ? { tool_calls: [{ function: call }] } : { content: 'Готово.' },
    prompt_eval_count: 10,
    eval_count: 2,
  });
});
let polza: AiPolzaService;
let chat: AiChatService;
beforeAll(async () => {
  db = new PGlite();
  await applyPlan(admin, planMigrations('migrations'));
  const a = await aiIdentity(admin);
  actor = a.principal_id;
  owner = (await aiIdentity(admin)).principal_id;
  await admin.query(
    "INSERT INTO capability_grants(account_id,capability,state,policy_version,granted_by) VALUES($1,'platform_admin','verified','test','admin')",
    [a.account_id],
  );
  polza = new AiPolzaService(runtime, { encryptionKey: root, fetchImpl: upstream });
  chat = new AiChatService(runtime, { encryptionKey: root, fetchImpl: upstream });
  const c = await polza.admin(actor);
  await polza.save(actor, {
    configurationVersion: c.configurationVersion,
    enabled: true,
    transcriptionEnabled: true,
    dailySecondsLimit: 600,
    globalDailySecondsLimit: 7200,
    maxAudioSeconds: 20,
    apiKey: 'pza_isolated_polza_test_key',
    paidOperationsPerHour: 100,
    textConfigurationVersion: c.textConfigurationVersion,
  });
}, 30000);
afterAll(async () => db?.close());
it('keeps credentials private, imports only fixed-endpoint metadata, and requires an explicit connection selection', async () => {
  const c = await polza.refreshCatalog(actor);
  expect(c.items).toHaveLength(3);
  expect(c.items.every((m) => !m.selected)).toBe(true);
  expect(c.items.find((m) => m.id === 'polza/qwen/test-vision')).toMatchObject({
    vision: true,
    tools: true,
    maxOutputTokens: 4096,
  });
  await expect(polza.catalog(owner)).rejects.toMatchObject({ status: 403 });
  await expect(runtime.query('SELECT * FROM ai_polza_models')).rejects.toBeTruthy();
  await expect(
    polza.selectModels(actor, { version: c.version, ids: ['polza/stt/test'] }),
  ).rejects.toMatchObject({ status: 400 });
  const selected = await polza.selectModels(actor, {
    version: c.version,
    ids: ['polza/qwen/test-vision'],
  });
  expect(selected.items.find((m) => m.id === 'polza/qwen/test-vision')?.selected).toBe(true);
  const p = await chat.generationPolicy(actor);
  expect(p.models.find((m) => m.id === 'polza/qwen/test-vision')).toMatchObject({
    ready: true,
    connectionSelected: true,
    allowed: false,
    inputModalities: ['text', 'image'],
  });
  expect(p.models.find((m) => m.id === 'polza/text/test')).toMatchObject({
    connectionSelected: false,
    allowed: false,
  });
  await chat.saveGenerationPolicy(actor, {
    configurationVersion: p.configurationVersion,
    systemPrompt: 'Test',
    allowedModels: ['polza/qwen/test-vision'],
    defaultModel: 'polza/qwen/test-vision',
    requestId: randomUUID(),
  });
  expect((await polza.admin(actor)).transcriptionEnabled).toBe(true);
});
it('uses normal owner admission, streaming, actual usage, free replay and monthly budgets', async () => {
  const thread = await chat.createThread(owner),
    request = randomUUID();
  const delta: string[] = [];
  await chat.sendStream(
    owner,
    thread.id,
    'Привет',
    request,
    (d) => delta.push(d),
    new AbortController().signal,
    'polza/qwen/test-vision',
  );
  expect(delta.join('')).toBe('Готово.');
  const n = upstream.mock.calls.length;
  expect(
    (
      await chat.sendStream(
        owner,
        thread.id,
        'Привет',
        request,
        () => {},
        new AbortController().signal,
        'polza/qwen/test-vision',
      )
    ).replayed,
  ).toBe(true);
  expect(upstream).toHaveBeenCalledTimes(n);
  const row = (
    await admin.query(
      'SELECT provider,input_tokens,output_tokens FROM ai_usage_journal WHERE owner_principal_id=$1 AND request_id=$2',
      [owner, request],
    )
  ).rows[0];
  expect(row).toMatchObject({ provider: 'polza', input_tokens: 10, output_tokens: 2 });
  const budgets = new AiTokenBudgetStore(runtime);
  const b = await budgets.admin(actor);
  await budgets.save(actor, {
    configurationVersion: b.configurationVersion,
    requestId: randomUUID(),
    models: [{ model: 'polza/qwen/test-vision', globalLimit: '1', userLimit: '1' }],
  });
  await expect(
    chat.sendStream(
      owner,
      thread.id,
      'Другой запрос',
      randomUUID(),
      () => {},
      new AbortController().signal,
      'polza/qwen/test-vision',
    ),
  ).rejects.toMatchObject({ code: 'ai_budget_exhausted' });
  expect(upstream).toHaveBeenCalledTimes(n);
  const last = await budgets.admin(actor);
  await budgets.save(actor, {
    configurationVersion: last.configurationVersion,
    requestId: randomUUID(),
    models: [],
  });
});
it('creates, reads and edits the same working file via the shared Polza tool loop', async () => {
  const thread = await chat.createThread(owner);
  mode = 'create';
  await chat.sendStream(
    owner,
    thread.id,
    'Создай файл',
    randomUUID(),
    () => {},
    new AbortController().signal,
    'polza/qwen/test-vision',
  );
  expect((await chat.workingFiles.read(owner, thread.id, 'test.html')).version).toBe(1);
  mode = 'edit';
  await chat.sendStream(
    owner,
    thread.id,
    'Исправь файл',
    randomUUID(),
    () => {},
    new AbortController().signal,
    'polza/qwen/test-vision',
  );
  expect(await chat.workingFiles.read(owner, thread.id, 'test.html')).toMatchObject({
    version: 2,
    content: '<h1>Two</h1>',
  });
});
it('rejects stale catalogue choices and invalidates observed eligibility on key rotation', async () => {
  const c = await polza.catalog(actor);
  await expect(
    polza.selectModels(actor, { version: c.version - 1, ids: [] }),
  ).rejects.toMatchObject({ status: 409 });
  const cfg = await polza.admin(actor);
  await polza.save(actor, {
    configurationVersion: cfg.configurationVersion,
    enabled: true,
    transcriptionEnabled: true,
    dailySecondsLimit: 600,
    globalDailySecondsLimit: 7200,
    maxAudioSeconds: 20,
    apiKey: 'pza_changed_isolated_test_key',
  });
  expect((await polza.catalog(actor)).credentialCurrent).toBe(false);
  expect((await chat.status()).availableModels).not.toContain('polza/qwen/test-vision');
});
