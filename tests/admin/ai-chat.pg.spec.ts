import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type pg from 'pg';
import { AiChatService } from '../../apps/api/src/ai-chat.service';
import { testAdminPool, testAppPool } from '../portal/helpers';

interface Identity {
  accountId: string;
  principalId: string;
}

const requestKey = '2f'.repeat(32);
let admin: pg.Pool;
let runtime: pg.Pool;
let service: AiChatService;
let owner: Identity;
let stranger: Identity;
let platformAdmin: Identity;
let providerCalls = 0;

async function makeIdentity(name: string, elevated: boolean): Promise<Identity> {
  const id = randomUUID();
  const account = await admin.query<{ id: string }>(
    `INSERT INTO accounts (email, password_hash, birth_date, country)
     VALUES ($1, 'ai-integration-only', DATE '1990-01-01', 'RU') RETURNING id`,
    [`ai-${name}-${id}@example.test`],
  );
  const accountId = account.rows[0]!.id;
  const principal = await admin.query<{ id: string }>(
    "INSERT INTO principals (kind, account_id) VALUES ('account', $1) RETURNING id",
    [accountId],
  );
  if (elevated) {
    await admin.query(
      `INSERT INTO capability_grants
        (account_id, capability, state, policy_version, granted_by)
       VALUES ($1, 'platform_admin', 'verified', 'admin-stage-a-2026-08', 'admin')`,
      [accountId],
    );
  }
  return { accountId, principalId: principal.rows[0]!.id };
}

beforeAll(async () => {
  admin = testAdminPool();
  runtime = testAppPool();
  owner = await makeIdentity('owner', false);
  stranger = await makeIdentity('stranger', false);
  platformAdmin = await makeIdentity('admin', true);
  service = new AiChatService(runtime, {
    encryptionKey: requestKey,
    fetchImpl: vi.fn<typeof fetch>(async (url, options) => {
      providerCalls += 1;
      expect(url).toBe('https://api.openai.com/v1/responses');
      const posted = JSON.parse(String(options?.body)) as {
        model: string;
        store: boolean;
        input: Array<{ role: string; content: string }>;
      };
      expect(posted.model).toBe('gpt-5-mini');
      expect(posted.store).toBe(false);
      expect(posted.input.at(-1)?.content).toBe('Что такое Arduino?');
      return new Response(JSON.stringify({
        output: [{ content: [{ type: 'output_text', text: 'Arduino — платформа для электроники.' }] }],
      }), { status: 200 });
    }),
  });
});

afterAll(async () => {
  await runtime?.end();
  await admin?.end();
});

describe('AI Chat PostgreSQL access and request replay', () => {
  it('denies direct runtime table reads and unprivileged admin configuration', async () => {
    for (const table of [
      'ai_assistant_config',
      'ai_assistant_threads',
      'ai_assistant_messages',
    ]) {
      await expect(runtime.query(`SELECT * FROM public.${table}`)).rejects.toMatchObject({
        code: '42501',
      });
    }
    await expect(service.adminConfig(owner.principalId)).rejects.toMatchObject({
      code: '42501',
    });
  });

  it('stores an encrypted provider key through platform-admin only', async () => {
    await expect(service.saveAdminConfig(owner.principalId, {
      enabled: true, provider: 'openai', model: 'gpt-5-mini',
      apiKey: 'sk-ai-private-integration-key-001',
    }, randomUUID())).rejects.toMatchObject({ code: '42501' });

    const saved = await service.saveAdminConfig(platformAdmin.principalId, {
      enabled: true,
      provider: 'openai',
      model: 'gpt-5-mini',
      apiKey: 'sk-ai-private-integration-key-001',
    }, randomUUID());
    expect(saved.enabled).toBe(true);
    expect(saved.apiKeyConfigured).toBe(true);
    expect(JSON.stringify(saved)).not.toContain('sk-ai-private-integration-key-001');

    const raw = await admin.query<{ api_key_ciphertext: string }>(
      'SELECT api_key_ciphertext FROM ai_assistant_config WHERE singleton_key',
    );
    expect(raw.rows[0]!.api_key_ciphertext).not.toContain('sk-ai-private-integration-key-001');
  });

  it('keeps different accounts isolated and never repeats one paid operation', async () => {
    const thread = await service.createThread(owner.principalId);
    const operation = randomUUID();
    expect(await service.messages(stranger.principalId, thread.id)).toEqual([]);
    await expect(
      service.send(stranger.principalId, thread.id, 'Чужое сообщение', randomUUID()),
    ).rejects.toMatchObject({ code: 'ai_thread_busy', status: 409 });

    const response = await service.send(owner.principalId, thread.id, 'Что такое Arduino?', operation);
    expect(response.replayed).toBe(false);
    expect(response.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(response.messages[0]?.requestId).toBe(operation);
    expect(response.messages[1]?.requestId).toBe(operation);
    expect(providerCalls).toBe(1);

    const replay = await service.send(owner.principalId, thread.id, 'Что такое Arduino?', operation);
    expect(replay.replayed).toBe(true);
    expect(providerCalls).toBe(1);
    expect(replay.messages).toEqual(response.messages);
    expect(await service.messages(stranger.principalId, thread.id)).toEqual([]);
    expect(await service.threads(stranger.principalId)).not.toContainEqual(
      expect.objectContaining({ id: thread.id }),
    );
  });

  it('rejects request identifier reuse with different text and different threads', async () => {
    const thread = (await service.threads(owner.principalId))[0]!;
    const other = await service.createThread(owner.principalId);
    const operation = randomUUID();
    const admitted = await runtime.query<{ admitted: boolean }>(
      'SELECT ai_chat_begin($1,$2,$3,$4::varchar) AS admitted',
      [owner.principalId, other.id, operation, 'Один запрос'],
    );
    expect(admitted.rows[0]!.admitted).toBe(true);
    await expect(runtime.query('SELECT ai_chat_begin($1,$2,$3,$4::varchar)', [
      owner.principalId, other.id, operation, 'Другой текст',
    ])).rejects.toMatchObject({ code: '22023' });
    await expect(runtime.query('SELECT ai_chat_begin($1,$2,$3,$4::varchar)', [
      owner.principalId, thread.id, operation, 'Один запрос',
    ])).rejects.toMatchObject({ code: '22023' });
  });
});
