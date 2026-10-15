import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type pg from 'pg';
import { AiChatService } from '../../apps/api/src/ai-chat.service';
import { hashSessionToken } from '../../contexts/identity/dist/index.js';
import { buildTestApp, inject } from '../portal/app';
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
let apiClosedRuntime = false;

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
      return new Response(
        JSON.stringify({
          output: [
            { content: [{ type: 'output_text', text: 'Arduino — платформа для электроники.' }] },
          ],
        }),
        { status: 200 },
      );
    }),
  });
});

afterAll(async () => {
  if (!apiClosedRuntime) await runtime?.end();
  await admin?.end();
});

describe('AI Chat PostgreSQL access and request replay', () => {
  it('denies direct runtime table reads and unprivileged admin configuration', async () => {
    for (const table of ['ai_assistant_config', 'ai_assistant_threads', 'ai_assistant_messages']) {
      await expect(runtime.query(`SELECT * FROM public.${table}`)).rejects.toMatchObject({
        code: '42501',
      });
    }
    await expect(service.adminConfig(owner.principalId)).rejects.toMatchObject({
      code: '42501',
    });
  });

  it('stores an encrypted provider key through platform-admin only', async () => {
    await expect(
      service.saveAdminConfig(
        owner.principalId,
        {
          enabled: true,
          provider: 'openai',
          model: 'gpt-5-mini',
          apiKey: 'sk-ai-private-integration-key-001',
        },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: '42501' });

    const saved = await service.saveAdminConfig(
      platformAdmin.principalId,
      {
        enabled: true,
        provider: 'openai',
        model: 'gpt-5-mini',
        apiKey: 'sk-ai-private-integration-key-001',
      },
      randomUUID(),
    );
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

    const response = await service.send(
      owner.principalId,
      thread.id,
      'Что такое Arduino?',
      operation,
    );
    expect(response.replayed).toBe(false);
    expect(response.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(response.messages[0]?.requestId).toBe(operation);
    expect(response.messages[1]?.requestId).toBe(operation);
    expect(providerCalls).toBe(1);

    const replay = await service.send(
      owner.principalId,
      thread.id,
      'Что такое Arduino?',
      operation,
    );
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
    await expect(
      runtime.query('SELECT ai_chat_begin($1,$2,$3,$4::varchar)', [
        owner.principalId,
        other.id,
        operation,
        'Другой текст',
      ]),
    ).rejects.toMatchObject({ code: '22023' });
    await expect(
      runtime.query('SELECT ai_chat_begin($1,$2,$3,$4::varchar)', [
        owner.principalId,
        thread.id,
        operation,
        'Один запрос',
      ]),
    ).rejects.toMatchObject({ code: '22023' });
  });

  it('wires real Nest HTTP sessions, admin permissions, tenant ownership and paid idempotency', async () => {
    async function createSession(actor: Identity, label: string): Promise<string> {
      const unique = randomUUID();
      const tenant = await admin.query<{ id: string }>(
        'INSERT INTO tenants (title, workspace_slug) VALUES ($1,$2) RETURNING id',
        [`AI HTTP test ${label}`, `ai-http-${unique}`],
      );
      const workspace = await admin.query<{ id: string }>(
        "INSERT INTO workspaces (tenant_id,kind,title) VALUES ($1,'personal',$2) RETURNING id",
        [tenant.rows[0]!.id, `AI HTTP ${label}`],
      );
      await admin.query(
        'INSERT INTO workspace_memberships (account_id,workspace_id,role) VALUES ($1,$2,$3)',
        [actor.accountId, workspace.rows[0]!.id, 'owner'],
      );
      await admin.query(
        'INSERT INTO profiles (account_id,username,display_name) VALUES ($1,$2,$3)',
        [actor.accountId, `ai_${unique.replaceAll('-', '')}`, label],
      );
      const token = `ai-http-${randomUUID()}`;
      await admin.query(
        `INSERT INTO sessions_v2
           (principal_id,active_workspace_id,token_hash,expires_at,client_metadata)
         VALUES ($1,$2,$3,now() + interval '1 hour','{}'::jsonb)`,
        [actor.principalId, workspace.rows[0]!.id, hashSessionToken(token)],
      );
      return token;
    }

    const ownerToken = await createSession(owner, 'owner');
    const strangerToken = await createSession(stranger, 'stranger');
    const adminToken = await createSession(platformAdmin, 'admin');
    const previousEncryptionKey = process.env['ASA_SETTINGS_ENCRYPTION_KEY'];
    process.env['ASA_SETTINGS_ENCRYPTION_KEY'] = requestKey;
    const mockFetch = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            output: [{ content: [{ type: 'output_text', text: 'HTTP GPT успешно ответил' }] }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    );
    vi.stubGlobal('fetch', mockFetch);

    const app = await buildTestApp(runtime);
    const host = '127.0.0.1:4610';
    try {
      const anonymous = await inject(app, { method: 'GET', url: '/api/ai/threads' });
      expect(anonymous.statusCode).toBe(401);

      const deniedAdmin = await inject(app, {
        method: 'GET',
        url: '/api/admin/v1/ai',
        headers: { host },
        cookies: { asa_session: ownerToken },
      });
      expect(deniedAdmin.statusCode).toBe(403);
      const allowedAdmin = await inject(app, {
        method: 'GET',
        url: '/api/admin/v1/ai',
        headers: { host },
        cookies: { asa_session: adminToken },
      });
      expect(allowedAdmin.statusCode).toBe(200);
      expect(allowedAdmin.body).not.toContain('sk-ai-private-integration-key-001');

      const newChat = await inject(app, {
        method: 'POST',
        url: '/api/ai/threads',
        headers: { host, 'content-type': 'application/json' },
        cookies: { asa_session: ownerToken },
        payload: {},
      });
      expect(newChat.statusCode).toBe(201);
      const threadId = (newChat.json() as { id: string }).id;
      const msgUrl = `/api/ai/threads/${threadId}/messages`;

      const strangerRead = await inject(app, {
        method: 'GET',
        url: msgUrl,
        headers: { host },
        cookies: { asa_session: strangerToken },
      });
      expect(strangerRead.statusCode).toBe(200);
      expect(strangerRead.json()).toEqual({ items: [] });
      const outsiderSend = await inject(app, {
        method: 'POST',
        url: msgUrl,
        headers: { host, 'content-type': 'application/json' },
        cookies: { asa_session: strangerToken },
        payload: { message: 'Чужой запрос', requestId: randomUUID() },
      });
      expect(outsiderSend.statusCode).toBe(409);
      expect(mockFetch).not.toHaveBeenCalled();

      const operation = randomUUID();
      const data = { message: 'HTTP проверка', requestId: operation };
      const first = await inject(app, {
        method: 'POST',
        url: msgUrl,
        headers: { host, 'content-type': 'application/json' },
        cookies: { asa_session: ownerToken },
        payload: data,
      });
      expect(first.statusCode).toBe(200);
      expect(first.json()).toMatchObject({
        replayed: false,
        messages: [
          { role: 'user', requestId: operation, content: 'HTTP проверка' },
          { role: 'assistant', requestId: operation, content: 'HTTP GPT успешно ответил' },
        ],
      });
      const replay = await inject(app, {
        method: 'POST',
        url: msgUrl,
        headers: { host, 'content-type': 'application/json' },
        cookies: { asa_session: ownerToken },
        payload: data,
      });
      expect(replay.statusCode).toBe(200);
      expect(replay.json()).toMatchObject({ replayed: true });
      expect(mockFetch).toHaveBeenCalledTimes(1);

      const wrongOrigin = await inject(app, {
        method: 'POST',
        url: '/api/ai/threads',
        headers: {
          host,
          origin: 'https://unauthorized.example',
          'content-type': 'application/json',
        },
        cookies: { asa_session: ownerToken },
        payload: {},
      });
      expect(wrongOrigin.statusCode).toBe(403);
    } finally {
      await app.close();
      apiClosedRuntime = true;
      vi.unstubAllGlobals();
      if (previousEncryptionKey === undefined) delete process.env['ASA_SETTINGS_ENCRYPTION_KEY'];
      else process.env['ASA_SETTINGS_ENCRYPTION_KEY'] = previousEncryptionKey;
    }
  }, 30000);
});
