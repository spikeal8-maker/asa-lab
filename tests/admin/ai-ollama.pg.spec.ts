/** Real PostgreSQL proof for independent local inference.
 * Requires isolated *_test roles, holds the shared AI suite lock, never connects to a GPU.
 * The Ollama HTTP transport is a deterministic local stub.
 */
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AiChatService } from '../../apps/api/src/ai-chat.service';
import { testAdminPool, testAppPool } from '../portal/helpers';
import { lockAiPostgresSuite } from './ai-postgres-suite-lock';

const ROOT = 'ae'.repeat(32);
let admin: pg.Pool;
let runtime: pg.Pool;
let service: AiChatService;
let release: (() => Promise<void>) | undefined;
let principal: string;
let adminPrincipal: string;
let thread: string;
let savedOllama: { enabled: boolean; base_url: string; model: string } | null = null;
let chatPostCount = 0;

async function account(platformAdmin: boolean): Promise<string> {
  const uuid = randomUUID();
  const a = await admin.query<{ id: string }>(
    "INSERT INTO accounts(email,password_hash,birth_date,country) VALUES($1,'ollama-pg-only',DATE '1990-01-01','RU') RETURNING id",
    ['ollama-' + uuid + '@example.test'],
  );
  const p = await admin.query<{ id: string }>(
    "INSERT INTO principals(kind,account_id) VALUES('account',$1) RETURNING id",
    [a.rows[0]!.id],
  );
  if (platformAdmin) {
    await admin.query(
      "INSERT INTO capability_grants(account_id,capability,state,policy_version,granted_by) VALUES($1,'platform_admin','verified','ollama-pg-only','admin')",
      [a.rows[0]!.id],
    );
  }
  return p.rows[0]!.id;
}
beforeAll(async () => {
  for (const name of ['TEST_DATABASE_URL', 'APP_TEST_DATABASE_URL']) {
    const raw = process.env[name];
    if (!raw || !decodeURIComponent(new URL(raw).pathname).endsWith('_test'))
      throw new Error('Ollama PG suite requires an explicitly isolated *_test database');
  }
  admin = testAdminPool();
  runtime = testAppPool();
  release = await lockAiPostgresSuite(admin);
  const old = await admin.query<{ enabled: boolean; base_url: string; model: string }>(
    'SELECT enabled,base_url,model FROM public.ai_ollama_settings WHERE singleton_key',
  );
  savedOllama = old.rows[0] ?? null;
  principal = await account(false);
  adminPrincipal = await account(true);
  const fetchImpl = vi.fn<typeof fetch>(async (url, options) => {
    if (String(url).endsWith('/api/tags')) {
      return new Response(JSON.stringify({ models: [{ name: 'gemma4:12b', size: 7600 }] }));
    }
    expect(url).toBe('http://127.0.0.1:11434/api/chat');
    expect(options?.redirect).toBe('error');
    expect(JSON.stringify(options)).not.toContain('authorization');
    chatPostCount++;
    return new Response(
      JSON.stringify({ message: { role: 'assistant', content: 'Локальный ответ' }, done: false }) +
        '\n' +
        JSON.stringify({ done: true }) +
        '\n',
      { status: 200 },
    );
  });
  service = new AiChatService(runtime, { encryptionKey: ROOT, fetchImpl });
  const config = await service.ollamaSettings(adminPrincipal);
  await service.saveOllamaSettings(
    adminPrincipal,
    {
      enabled: true,
      baseUrl: 'http://127.0.0.1:11434',
      model: 'gemma4:12b',
      revision: config.revision,
    },
    randomUUID(),
  );
  thread = (await service.createThread(principal)).id;
}, 60000);
afterAll(async () => {
  try {
    if (savedOllama && admin) {
      await admin.query(
        'UPDATE public.ai_ollama_settings SET enabled=$1,base_url=$2,model=$3,revision=revision+1 WHERE singleton_key',
        [savedOllama.enabled, savedOllama.base_url, savedOllama.model],
      );
    }
  } finally {
    await runtime?.end();
    await release?.();
    await admin?.end();
  }
});

describe('Ollama real SQL admission and owner safety', () => {
  it('retains runtime table secrecy and admin role checks', async () => {
    await expect(runtime.query('SELECT * FROM public.ai_ollama_settings')).rejects.toMatchObject({
      code: '42501',
    });
    await expect(service.ollamaSettings(principal)).rejects.toMatchObject({ code: '42501' });
    const before = await service.ollamaSettings(adminPrincipal);
    await expect(
      service.saveOllamaSettings(
        principal,
        {
          enabled: false,
          baseUrl: 'http://192.168.1.2:11434',
          model: 'gemma4:12b',
          revision: before.revision,
        },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: 'ai_admin_denied', status: 403 });
    expect((await service.ollamaSettings(adminPrincipal)).revision).toBe(before.revision);
  });

  it('saves local reply and replay without reserving any paid provider operation', async () => {
    const before = await admin.query<{ total: number }>(
      'SELECT count(*)::integer AS total FROM public.ai_paid_operation_quota',
    );
    const request = randomUUID();
    const deltas: string[] = [];
    const result = await service.sendStream(
      principal,
      thread,
      'Объясни электронику',
      request,
      (value) => deltas.push(value),
      new AbortController().signal,
      'ollama-local',
    );
    expect(result.replayed).toBe(false);
    expect(deltas).toEqual(['Локальный ответ']);
    expect(
      result.messages.some((m) => m.role === 'assistant' && m.content === 'Локальный ответ'),
    ).toBe(true);
    const again = await service.sendStream(
      principal,
      thread,
      'Объясни электронику',
      request,
      () => undefined,
      new AbortController().signal,
      'ollama-local',
    );
    expect(again.replayed).toBe(true);
    expect(chatPostCount).toBe(1);
    const after = await admin.query<{ total: number }>(
      'SELECT count(*)::integer AS total FROM public.ai_paid_operation_quota',
    );
    expect(after.rows[0]?.total).toBe(before.rows[0]?.total);
    const perOwner = await admin.query<{ total: number }>(
      'SELECT count(*)::integer AS total FROM public.ai_assistant_request_quota WHERE owner_principal_id=$1 AND request_id=$2',
      [principal, request],
    );
    expect(perOwner.rows[0]?.total).toBe(1);
  });

  it('rejects repeated request UUID with changed content without another inference', async () => {
    const recent = await admin.query<{ request_id: string }>(
      "SELECT request_id FROM public.ai_assistant_messages WHERE owner_principal_id=$1 AND role='user' LIMIT 1",
      [principal],
    );
    const request = recent.rows[0]!.request_id;
    await expect(
      service.sendStream(
        principal,
        thread,
        'Чужое содержание',
        request,
        () => undefined,
        new AbortController().signal,
        'ollama-local',
      ),
    ).rejects.toMatchObject({
      code: 'ai_request_id_reused',
      status: 409,
    });
    expect(chatPostCount).toBe(1);
  });
});
