import { aiAdminFixture } from './testing/ai-admin-config.fixture';
import { createCipheriv, randomBytes } from 'node:crypto';
import type pg from 'pg';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ActiveContextUseCase } from '@asa-lab/identity';
import { describe, expect, it, vi } from 'vitest';
import type { AiAccessService } from './ai-access.service';
import type { SeatContextUseCase } from './seat-context';
import { AiChatController } from './ai-chat.controller';
import { AiChatService, AiServiceError } from './ai-chat.service';

const PRINCIPAL = '11111111-1111-4111-8111-111111111111';
const THREAD = '22222222-2222-4222-8222-222222222222';
const REQUEST = '33333333-3333-4333-8333-333333333333';
const ROOT = '9c'.repeat(32);

function secureRuntime() {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(ROOT, 'hex'), iv);
  const ciphertext = Buffer.concat([
    cipher.update('sk-test-private-key-123456', 'utf8'),
    cipher.final(),
  ]);
  return {
    enabled: true,
    configuration_version: 1,
    provider: 'openai' as const,
    model: 'gpt-6-luna' as const,
    api_key_ciphertext: ciphertext.toString('base64url'),
    api_key_iv: iv.toString('base64url'),
    api_key_auth_tag: cipher.getAuthTag().toString('base64url'),
  };
}

describe('ASA native AI Chat', () => {
  for (const outcome of [
    'complete',
    'stopped',
    'replayed',
    'pending-replay',
    'uppercase',
  ] as const) {
    it(`emits only this request's messages in done: ${outcome}`, async () => {
      const requestId = outcome === 'uppercase' ? 'abcdefab-cdef-4abc-8abc-abcdefabcdef' : REQUEST;
      const history = Array.from({ length: 78 }, (_, index) => ({
        id: `old-${index}`,
        role: 'assistant' as const,
        content: 'История'.repeat(1000),
        createdAt: new Date(index).toISOString(),
        requestId: 'other-request',
        state: 'complete' as const,
      }));
      const current = [
        { ...history[0]!, id: 'current-user', role: 'user' as const, requestId },
        ...(outcome === 'pending-replay'
          ? []
          : [
              {
                ...history[0]!,
                id: 'current-answer',
                requestId,
                state: outcome === 'stopped' ? ('stopped' as const) : ('complete' as const),
              },
            ]),
      ];
      const result = {
        messages: [...history, ...current],
        replayed: outcome.includes('replay'),
        stopped: outcome === 'stopped',
      };
      const ai = { sendStream: vi.fn(async () => result) };
      const controller = new AiChatController(
        {
          resolve: vi.fn(async () => ({ principalId: PRINCIPAL, accountId: PRINCIPAL })),
        } as unknown as ActiveContextUseCase,
        ai as unknown as AiChatService,
        { resolveExisting: vi.fn(async () => null) } as unknown as SeatContextUseCase,
        { owner: vi.fn(async () => PRINCIPAL) } as unknown as AiAccessService,
      );
      const write = vi.fn();
      const raw = { writeHead: vi.fn(), once: vi.fn(), write, end: vi.fn() };
      await controller.sendStream(
        {
          cookies: {},
          headers: {
            origin: 'http://localhost',
            host: 'localhost',
            'content-type': 'application/json',
          },
        } as unknown as FastifyRequest,
        { hijack: vi.fn(), raw } as unknown as FastifyReply,
        THREAD,
        {
          message: 'Вопрос',
          requestId: outcome === 'uppercase' ? requestId.toUpperCase() : requestId,
        },
      );
      expect(write).toHaveBeenCalledTimes(1);
      expect(write).toHaveBeenCalledWith(
        'event: done\ndata: ' + JSON.stringify({ ...result, messages: current }) + '\n\n',
      );
    });
  }

  it('never returns the credential to the admin read surface', async () => {
    const query = vi.fn(async () => ({
      rows: [
        {
          enabled: true,
          provider: 'openai',
          model: 'gpt-6-luna',
          api_key_configured: true,
          provider_configurations: aiAdminFixture({ apiKeyConfigured: true })
            .providerConfigurations,
          migrated_from_model: null,
          key_fingerprint: 'a1b2c3d4e5f6',
          configuration_version: 3,
          updated_at: new Date('2026-10-14T00:00:00Z'),
        },
      ],
    }));
    const service = new AiChatService({ query } as unknown as pg.Pool, {
      encryptionKey: ROOT,
    });
    const config = await service.adminConfig(PRINCIPAL);
    expect(config.apiKeyConfigured).toBe(true);
    expect(config.encryptionReady).toBe(true);
    expect(JSON.stringify(config)).not.toContain('sk-test-private-key');
  });

  it('encrypts a replaced GPT key without submitting raw credentials to SQL', async () => {
    const calls: unknown[][] = [];
    let configurationVersion = 1;
    const query = vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push([sql, ...params]);
      if (sql.includes('ai_admin_get_config')) {
        return {
          rows: [
            {
              enabled: false,
              provider: 'openai',
              model: 'gpt-6-luna',
              api_key_configured: false,
              provider_configurations: aiAdminFixture({ apiKeyConfigured: false })
                .providerConfigurations,
              migrated_from_model: null,
              key_fingerprint: null,
              configuration_version: configurationVersion,
              updated_at: null,
            },
          ],
        };
      }
      configurationVersion += 1;
      return { rows: [{ ai_admin_set_config: configurationVersion }] };
    });
    const service = new AiChatService({ query } as unknown as pg.Pool, {
      encryptionKey: ROOT,
    });
    await service.saveAdminConfig(
      PRINCIPAL,
      {
        enabled: true,
        provider: 'openai',
        model: 'gpt-6-luna',
        apiKey: 'sk-test-private-key-123456',
      },
      'test-admin-request',
    );
    const write = calls.find((call) => String(call[0]).includes('ai_admin_set_config'));
    expect(write).toBeDefined();
    expect(write?.[5]).toBe('replace');
    expect(JSON.stringify(write)).not.toContain('sk-test-private-key-123456');
    expect(write?.[6]).not.toBeNull();
    expect(write?.[7]).not.toBeNull();
    expect(write?.[8]).not.toBeNull();
  });

  it('sends real GPT protocol only after database admission and saves the completed reply', async () => {
    const queries: string[] = [];
    let persisted = false;
    const query = vi.fn(async (sql: string) => {
      queries.push(sql);
      if (sql.includes('ai_runtime_config')) return { rows: [secureRuntime()] };
      if (sql.includes('ai_text_begin')) return { rows: [{ admitted: true }] };
      if (sql.includes('ai_text_generation_context'))
        return { rows: [{ role: 'user', content: 'Объясни Arduino' }] };
      if (sql.includes('ai_text_messages_page')) {
        return {
          rows: persisted
            ? [
                { id: 'u1', role: 'user', content: 'Объясни Arduino', created_at: new Date(1) },
                {
                  id: 'a1',
                  role: 'assistant',
                  content: 'Arduino — микроконтроллерная платформа.',
                  created_at: new Date(2),
                },
              ]
            : [{ id: 'u1', role: 'user', content: 'Объясни Arduino', created_at: new Date(1) }],
        };
      }
      if (sql.includes('ai_chat_finish')) persisted = true;
      return { rows: [] };
    });
    const fetchImpl = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            status: 'completed',
            output: [
              {
                content: [{ type: 'output_text', text: 'Arduino — микроконтроллерная платформа.' }],
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    );
    const service = new AiChatService({ query } as unknown as pg.Pool, {
      encryptionKey: ROOT,
      fetchImpl,
    });
    const result = await service.send(PRINCIPAL, THREAD, 'Объясни Arduino', REQUEST);
    expect(result.messages).toHaveLength(2);
    expect(queries.findIndex((sql) => sql.includes('ai_text_begin'))).toBeLessThan(
      queries.findIndex((sql) => sql.includes('ai_chat_finish')),
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, options] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe('https://api.openai.com/v1/responses');
    const body = JSON.parse(String(options?.body)) as {
      store: boolean;
      model: string;
      input: unknown[];
    };
    expect(body.store).toBe(false);
    expect(body.model).toBe('gpt-6-luna');
    expect(body.input).toHaveLength(1);
  });

  it('does not retry a rejected paid request and releases the thread lock', async () => {
    const queries: string[] = [];
    const query = vi.fn(async (sql: string) => {
      queries.push(sql);
      if (sql.includes('ai_runtime_config')) return { rows: [secureRuntime()] };
      if (sql.includes('ai_text_begin')) return { rows: [{ admitted: true }] };
      if (sql.includes('ai_text_generation_context'))
        return { rows: [{ role: 'user', content: 'Вопрос' }] };
      if (sql.includes('ai_text_messages_page')) {
        return { rows: [{ id: 'u1', role: 'user', content: 'Вопрос', created_at: new Date() }] };
      }
      return { rows: [] };
    });
    const fetchImpl = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ error: { message: 'Unauthorized' } }), { status: 401 }),
    );
    const service = new AiChatService({ query } as unknown as pg.Pool, {
      encryptionKey: ROOT,
      fetchImpl,
    });
    await expect(service.send(PRINCIPAL, THREAD, 'Вопрос', REQUEST)).rejects.toMatchObject({
      code: 'ai_provider_authentication_failed',
      status: 502,
    } satisfies Partial<AiServiceError>);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(queries.some((sql) => sql.includes('ai_chat_abort'))).toBe(true);
    expect(queries.some((sql) => sql.includes('ai_chat_finish'))).toBe(false);
  });

  it('does not call provider again when the same client request ID is replayed', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('ai_runtime_config')) return { rows: [secureRuntime()] };
      if (sql.includes('ai_text_begin')) return { rows: [{ admitted: false }] };
      if (sql.includes('ai_text_messages_page')) {
        return {
          rows: [
            {
              id: 'existing',
              role: 'user',
              content: 'Вопрос',
              request_id: REQUEST,
              created_at: new Date(1),
            },
          ],
        };
      }
      throw new Error('Unexpected database command');
    });
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new Error('A replay must never POST to provider');
    });
    const service = new AiChatService({ query } as unknown as pg.Pool, {
      encryptionKey: ROOT,
      fetchImpl,
    });
    const result = await service.send(PRINCIPAL, THREAD, 'Вопрос', REQUEST);
    expect(result.replayed).toBe(true);
    expect(result.messages).toHaveLength(1);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('persists interrupted streamed text before releasing its active SQL request', async () => {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const query = vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      if (sql.includes('ai_runtime_config')) return { rows: [secureRuntime()] };
      if (sql.includes('ai_text_begin')) return { rows: [{ admitted: true }] };
      if (sql.includes('ai_text_generation_context'))
        return { rows: [{ role: 'user', content: 'Вопрос' }] };
      if (sql.includes('ai_text_messages_page')) return { rows: [] };
      return { rows: [{ ai_chat_finish: true }] };
    });
    const fetchImpl = vi.fn<typeof fetch>(
      async () =>
        new Response('event: response.output_text.delta\ndata: {"delta":"Не потерять"}\n\n', {
          headers: { 'content-type': 'text/event-stream' },
        }),
    );
    const service = new AiChatService({ query } as unknown as pg.Pool, {
      encryptionKey: ROOT,
      fetchImpl,
    });
    await expect(
      service.sendStream(
        PRINCIPAL,
        THREAD,
        'Вопрос',
        REQUEST,
        () => undefined,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'ai_stream_interrupted' });
    const finish = calls.find(({ sql }) => sql.includes('ai_chat_finish'));
    expect(finish?.params).toEqual([PRINCIPAL, THREAD, REQUEST, 'Не потерять', 'stopped']);
    expect(calls.some(({ sql }) => sql.includes('ai_chat_abort'))).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each(['openai', 'deepseek'] as const)(
    'persists a partial legacy %s answer as stopped and does not recharge replay',
    async (provider) => {
      let admitted = false;
      let answer: Record<string, unknown> | null = null;
      const calls: Array<{ sql: string; params: unknown[] }> = [];
      const query = vi.fn(async (sql: string, params: unknown[] = []) => {
        calls.push({ sql, params });
        if (sql.includes('ai_runtime_config')) {
          return {
            rows: [
              {
                ...secureRuntime(),
                provider,
                model: provider === 'openai' ? 'gpt-6-luna' : 'deepseek-flash',
              },
            ],
          };
        }
        if (sql.includes('ai_text_generation_context'))
          return { rows: [{ role: 'user', content: 'Вопрос' }] };
        if (sql.includes('ai_text_begin')) {
          const replayed = admitted;
          admitted = true;
          return { rows: [{ admitted: !replayed }] };
        }
        if (sql.includes('ai_text_messages_page')) {
          return {
            rows: [
              {
                id: 'user',
                role: 'user',
                content: 'Вопрос',
                request_id: REQUEST,
                created_at: new Date(1),
              },
              ...(answer ? [answer] : []),
            ],
          };
        }
        if (sql.includes('ai_chat_finish')) {
          answer = {
            id: 'answer',
            role: 'assistant',
            content: params[3],
            state: params[4],
            request_id: REQUEST,
            created_at: new Date(2),
          };
        }
        return { rows: [] };
      });
      const fetchImpl = vi.fn<typeof fetch>(
        async () =>
          new Response(
            JSON.stringify(
              provider === 'openai'
                ? { status: 'incomplete', output_text: 'Частичный ответ' }
                : {
                    choices: [{ finish_reason: 'length', message: { content: 'Частичный ответ' } }],
                  },
            ),
          ),
      );
      const service = new AiChatService({ query } as unknown as pg.Pool, {
        encryptionKey: ROOT,
        fetchImpl,
      });
      const sending = service.send(PRINCIPAL, THREAD, 'Вопрос', REQUEST);
      if (provider === 'openai') {
        await expect(sending).rejects.toMatchObject({
          code: 'ai_response_incomplete',
          status: 503,
        });
      } else {
        expect((await sending).replayed).toBe(false);
      }
      const replay = await service.send(PRINCIPAL, THREAD, 'Вопрос', REQUEST);
      expect(replay.replayed).toBe(true);
      expect(replay.messages).toContainEqual(
        expect.objectContaining({
          content: 'Частичный ответ',
          role: 'assistant',
          state: 'stopped',
        }),
      );
      expect(calls.filter(({ sql }) => sql.includes('ai_chat_finish'))).toEqual([
        {
          sql: 'SELECT ai_chat_finish($1,$2,$3,$4::varchar,$5::varchar)',
          params: [PRINCIPAL, THREAD, REQUEST, 'Частичный ответ', 'stopped'],
        },
      ]);
      expect(calls.some(({ sql }) => sql.includes('ai_chat_abort'))).toBe(false);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    },
  );

  it('uses the same digital-laboratory instruction for JSON and streaming requests', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('ai_runtime_config')) return { rows: [secureRuntime()] };
      if (sql.includes('ai_text_begin')) return { rows: [{ admitted: true }] };
      if (sql.includes('ai_text_generation_context'))
        return { rows: [{ role: 'user', content: 'Вопрос' }] };
      return { rows: [] };
    });
    const fetchImpl = vi.fn<typeof fetch>(async (_url, options) => {
      const body = JSON.parse(String(options?.body)) as { stream?: boolean };
      return body.stream
        ? new Response(
            'event: response.output_text.delta\ndata: {"delta":"Ответ"}\n\n' +
              'event: response.completed\ndata: {"type":"response.completed"}\n\n',
          )
        : new Response(JSON.stringify({ status: 'completed', output_text: 'Ответ' }));
    });
    const service = new AiChatService({ query } as unknown as pg.Pool, {
      encryptionKey: ROOT,
      fetchImpl,
    });
    await service.send(PRINCIPAL, THREAD, 'Вопрос', REQUEST);
    await service.sendStream(
      PRINCIPAL,
      THREAD,
      'Вопрос',
      REQUEST,
      () => undefined,
      new AbortController().signal,
    );
    const prompts = fetchImpl.mock.calls.map(
      ([, options]) => (JSON.parse(String(options?.body)) as { instructions: string }).instructions,
    );
    expect(prompts[0]).toBe(prompts[1]);
    expect(prompts[0]).toContain('цифровой лаборатории ASA Lab');
    expect(prompts[0]).toContain('создавать проекты');
  });

  it('stops an owned stream across UUID casing without stopping another owner or thread', async () => {
    const principal = 'abcdefab-cdef-4abc-8abc-abcdefabcdef';
    const thread = 'bcdefabc-defa-4bcd-9bcd-bcdefabcdefa';
    const request = 'cdefabcd-efab-4cde-acde-cdefabcdefab';
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('ai_runtime_config')) return { rows: [secureRuntime()] };
      if (sql.includes('ai_text_begin')) return { rows: [{ admitted: true }] };
      if (sql.includes('ai_text_generation_context'))
        return { rows: [{ role: 'user', content: 'Вопрос' }] };
      return { rows: [] };
    });
    const fetchImpl = vi.fn<typeof fetch>(
      async () => new Response('event: response.output_text.delta\ndata: {"delta":"Часть"}\n\n'),
    );
    const service = new AiChatService({ query } as unknown as pg.Pool, {
      encryptionKey: ROOT,
      fetchImpl,
    });
    const result = await service.sendStream(
      principal.toUpperCase(),
      thread.toUpperCase(),
      'Вопрос',
      request.toUpperCase(),
      () => {
        expect(service.stopStream(PRINCIPAL, thread, request)).toEqual({ stopped: false });
        expect(service.stopStream(principal, THREAD, request)).toEqual({ stopped: false });
        expect(service.stopStream(principal, thread, request)).toEqual({ stopped: true });
      },
      new AbortController().signal,
    );
    expect(result.stopped).toBe(true);
    expect(query).toHaveBeenCalledWith('SELECT ai_chat_finish($1,$2,$3,$4::varchar,$5::varchar)', [
      principal,
      thread,
      request,
      'Часть',
      'stopped',
    ]);
    expect(service.stopStream(principal, thread, request)).toEqual({ stopped: false });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('keeps PostgreSQL microseconds in thread and message cursors', async () => {
    const rows = Array.from({ length: 51 }, (_, index) => ({
      id: `12345678-1234-4234-8234-${String(index).padStart(12, '0')}`,
      title: 'Диалог',
      role: 'user',
      content: 'Сообщение',
      request_id: REQUEST,
      updated_at: new Date('2026-10-19T10:00:00.123Z'),
      created_at: new Date('2026-10-19T10:00:00.123Z'),
      cursor_at: `2026-10-19T10:00:00.123${String(index).padStart(3, '0')}Z`,
    }));
    const query = vi.fn(async () => ({ rows }));
    const service = new AiChatService({ query } as unknown as pg.Pool);
    const threads = await service.threadPage(PRINCIPAL);
    expect(threads.items).toHaveLength(50);
    expect(threads.items.at(-1)?.updatedAt).toBe('2026-10-19T10:00:00.123Z');
    expect(threads.nextCursor).toEqual({ at: '2026-10-19T10:00:00.123049Z', id: rows[49]!.id });
    const messages = await service.messagePage(PRINCIPAL, THREAD);
    expect(messages.items).toHaveLength(50);
    expect(messages.nextCursor).toEqual({ at: '2026-10-19T10:00:00.123001Z', id: rows[1]!.id });
  });

  it.each(['2026-10-19T10:00:00.123Z', '2026-10-19T10:00:00.123456Z'])(
    'accepts a canonical timestamp cursor without rounding %s',
    async (at) => {
      const beforeId = 'ABCDEFAB-CDEF-4ABC-8ABC-ABCDEFABCDEF';
      const ai = {
        threadPage: vi.fn(async () => ({ items: [], nextCursor: null })),
        messagePage: vi.fn(async () => ({ items: [], nextCursor: null })),
      };
      const controller = new AiChatController(
        {
          resolve: vi.fn(async () => ({
            principalId: PRINCIPAL,
            accountId: PRINCIPAL,
          })),
        } as unknown as ActiveContextUseCase,
        ai as unknown as AiChatService,
        { resolveExisting: vi.fn(async () => null) } as unknown as SeatContextUseCase,
        { owner: vi.fn(async () => PRINCIPAL) } as unknown as AiAccessService,
      );
      const req = { cookies: {}, headers: {} } as unknown as FastifyRequest;
      await controller.threads(req, at, beforeId);
      await controller.messages(req, beforeId, at, beforeId);
      expect(ai.threadPage).toHaveBeenCalledWith(
        PRINCIPAL,
        { at, id: beforeId.toLowerCase() },
        '',
        false,
      );
      expect(ai.messagePage).toHaveBeenCalledWith(PRINCIPAL, beforeId.toLowerCase(), {
        at,
        id: beforeId.toLowerCase(),
      });
    },
  );

  it.each([
    '2026-02-30T10:00:00.123456Z',
    '2026-10-19T24:00:00.123456Z',
    '2026-10-19T10:00:00.1234Z',
    '2026-10-19T10:00:00.1234567Z',
    '2026-10-19T10:00:00.123456+00:00',
    '2026-10-19T10:00:00.123456',
  ])('rejects a noncanonical timestamp cursor %s before SQL', async (at) => {
    const ai = { threadPage: vi.fn(), messagePage: vi.fn() };
    const controller = new AiChatController(
      {
        resolve: vi.fn(async () => ({
          principalId: PRINCIPAL,
          accountId: PRINCIPAL,
        })),
      } as unknown as ActiveContextUseCase,
      ai as unknown as AiChatService,
      { resolveExisting: vi.fn(async () => null) } as unknown as SeatContextUseCase,
      { owner: vi.fn(async () => PRINCIPAL) } as unknown as AiAccessService,
    );
    const req = { cookies: {}, headers: {} } as unknown as FastifyRequest;
    await expect(controller.threads(req, at, THREAD)).rejects.toMatchObject({
      status: 400,
      response: { error: { code: 'ai_cursor_invalid' } },
    });
    await expect(controller.messages(req, THREAD, at, REQUEST)).rejects.toMatchObject({
      status: 400,
    });
    expect(ai.threadPage).not.toHaveBeenCalled();
    expect(ai.messagePage).not.toHaveBeenCalled();
  });

  it('explicit admin connection test verifies one response without enabling chat or storing a thread', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('ai_admin_get_config'))
        return {
          rows: [
            {
              enabled: false,
              provider: 'openai',
              model: 'gpt-6-luna',
              api_key_configured: true,
              provider_configurations: aiAdminFixture({ apiKeyConfigured: true })
                .providerConfigurations,
              migrated_from_model: null,
              key_fingerprint: 'test-hash',
              configuration_version: 7,
              updated_at: null,
            },
          ],
        };
      if (sql.includes('ai_runtime_config'))
        return { rows: [{ ...secureRuntime(), enabled: false }] };
      if (sql.includes('ai_admin_test_begin')) return { rows: [{ admitted: true }] };
      throw new Error('Connection test must not mutate config or history');
    });
    const fetchImpl = vi.fn<typeof fetch>(
      async () =>
        new Response(
          'event: response.output_text.delta\ndata: {"delta":"OK"}\n\n' +
            'event: response.completed\ndata: {"type":"response.completed"}\n\n',
        ),
    );
    const service = new AiChatService({ query } as unknown as pg.Pool, {
      encryptionKey: ROOT,
      fetchImpl,
    });
    const result = await service.testConnection(PRINCIPAL, 7);
    expect(result).toMatchObject({
      provider: 'openai',
      model: 'gpt-6-luna',
      configurationVersion: 7,
    });
    expect(JSON.stringify(result)).not.toContain('sk-test-private-key');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await expect(service.testConnection(PRINCIPAL, 6)).rejects.toMatchObject({
      code: 'ai_config_changed',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('blocks a status and connection test when a saved API key cannot be decrypted', async () => {
    const query = vi.fn(async (sql: string) =>
      sql.includes('ai_admin_get_config')
        ? {
            rows: [
              {
                enabled: true,
                provider: 'openai',
                model: 'gpt-6-luna',
                api_key_configured: true,
                provider_configurations: aiAdminFixture({ apiKeyConfigured: true })
                  .providerConfigurations,
                migrated_from_model: null,
                configuration_version: 2,
                updated_at: null,
              },
            ],
          }
        : { rows: [secureRuntime()] },
    );
    const fetchImpl = vi.fn<typeof fetch>();
    const service = new AiChatService({ query } as unknown as pg.Pool, {
      encryptionKey: 'ab'.repeat(32),
      fetchImpl,
    });
    expect((await service.status()).enabled).toBe(false);
    await expect(service.testConnection(PRINCIPAL, 2)).rejects.toMatchObject({
      code: 'ai_key_decryption_failed',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
