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
  await runtime?.end();
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
    const mockFetch = vi.fn<typeof fetch>(async (_url, options) => {
      const input = JSON.parse(String(options?.body)) as { stream?: boolean };
      if (input.stream) {
        const data =
          'event: response.output_text.delta\ndata: ' +
          JSON.stringify({ type: 'response.output_text.delta', delta: 'Потоковый ответ GPT' }) +
          '\n\n' +
          'event: response.completed\ndata: {"type":"response.completed"}\n\n';
        return new Response(data, {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        });
      }
      return new Response(
        JSON.stringify({
          output: [{ content: [{ type: 'output_text', text: 'HTTP GPT успешно ответил' }] }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', mockFetch);

    const apiPool = testAppPool();
    const app = await buildTestApp(apiPool);
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
      expect(strangerRead.json()).toMatchObject({ items: [] });
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

      const streamedRequestId = randomUUID();
      const streamedReply = await inject(app, {
        method: 'POST',
        url: msgUrl + '/stream',
        headers: { host, 'content-type': 'application/json', accept: 'text/event-stream' },
        cookies: { asa_session: ownerToken },
        payload: { message: 'Потоковый запрос', requestId: streamedRequestId },
      });
      expect(streamedReply.statusCode).toBe(200);
      expect(streamedReply.headers['content-type']).toContain('text/event-stream');
      expect(streamedReply.body).toContain('event: delta');
      expect(streamedReply.body).toContain('Потоковый ответ GPT');
      expect(streamedReply.body).toContain('event: done');
      expect(mockFetch).toHaveBeenCalledTimes(2);
      const streamedHistory = await service.messages(owner.principalId, threadId);
      expect(streamedHistory).toContainEqual(
        expect.objectContaining({
          role: 'assistant',
          content: 'Потоковый ответ GPT',
          requestId: streamedRequestId,
          state: 'complete',
        }),
      );

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
      vi.unstubAllGlobals();
      if (previousEncryptionKey === undefined) delete process.env['ASA_SETTINGS_ENCRYPTION_KEY'];
      else process.env['ASA_SETTINGS_ENCRYPTION_KEY'] = previousEncryptionKey;
    }
  }, 30000);

  it('restricts rename/delete by owner and retains only owned conversation lists', async () => {
    const thread = await service.createThread(owner.principalId);
    const label = 'История — Arduino';
    await expect(
      service.renameThread(stranger.principalId, thread.id, 'Чужой'),
    ).rejects.toMatchObject({
      code: 'ai_thread_not_found',
      status: 404,
    });
    await expect(service.renameThread(owner.principalId, thread.id, '  ')).rejects.toMatchObject({
      code: 'ai_title_invalid',
      status: 400,
    });
    const renamed = await service.renameThread(owner.principalId, thread.id, label);
    expect(renamed.title).toBe(label);
    expect((await service.threadPage(owner.principalId)).items).toContainEqual(
      expect.objectContaining({ id: thread.id, title: label }),
    );
    expect((await service.threadPage(stranger.principalId)).items).not.toContainEqual(
      expect.objectContaining({ id: thread.id }),
    );
    await expect(service.deleteThread(stranger.principalId, thread.id)).rejects.toMatchObject({
      code: 'ai_thread_not_available',
      status: 409,
    });
    expect(await service.deleteThread(owner.principalId, thread.id)).toEqual({ deleted: true });
    expect((await service.threadPage(owner.principalId)).items).not.toContainEqual(
      expect.objectContaining({ id: thread.id }),
    );
    await expect(service.deleteThread(owner.principalId, thread.id)).rejects.toMatchObject({
      code: 'ai_thread_not_available',
    });
  });

  it('paginates 57 conversations and 107 messages without duplication or cross-account leakage', async () => {
    await admin.query(
      `INSERT INTO ai_assistant_threads (account_id, title, updated_at)
       SELECT $1, 'paged-' || n, now() - n * interval '2 minutes'
         FROM generate_series(1,57) n`,
      [owner.accountId],
    );
    let cursor: { at: string; id: string } | null = null;
    const allIds = new Set<string>();
    let pageCount = 0;
    do {
      const page = await service.threadPage(owner.principalId, cursor);
      expect(page.items.length).toBeLessThanOrEqual(50);
      for (const thread of page.items) {
        expect(allIds.has(thread.id)).toBe(false);
        allIds.add(thread.id);
      }
      cursor = page.nextCursor;
      pageCount += 1;
    } while (cursor !== null && pageCount < 10);
    expect(allIds.size).toBeGreaterThanOrEqual(57);
    expect(pageCount).toBeGreaterThanOrEqual(2);
    expect((await service.threadPage(stranger.principalId)).items.length).toBe(0);

    const thread = await service.createThread(owner.principalId);
    await admin.query(
      `INSERT INTO ai_assistant_messages
       (thread_id, account_id, request_id, role, content, created_at)
       SELECT $1, $2, gen_random_uuid(),
         CASE WHEN n % 2 = 0 THEN 'assistant' ELSE 'user' END,
         'Сообщение ' || n, now() - (108 - n) * interval '1 minute'
         FROM generate_series(1,107) n`,
      [thread.id, owner.accountId],
    );
    let messageCursor: { at: string; id: string } | null = null;
    const contents: string[] = [];
    let count = 0;
    do {
      const page = await service.messagePage(owner.principalId, thread.id, messageCursor);
      expect(page.items.length).toBeLessThanOrEqual(50);
      expect(page.items.length).toBeGreaterThan(0);
      for (const message of page.items) contents.push(message.content);
      messageCursor = page.nextCursor;
      count += 1;
    } while (messageCursor !== null && count < 10);
    expect(contents).toHaveLength(107);
    expect(new Set(contents).size).toBe(107);
    expect(contents).toContain('Сообщение 107');
    expect(contents).toContain('Сообщение 1');
    expect((await service.messagePage(stranger.principalId, thread.id)).items).toEqual([]);
  });
});
