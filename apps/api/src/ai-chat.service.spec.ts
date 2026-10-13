import { createCipheriv, randomBytes } from 'node:crypto';
import type pg from 'pg';
import { describe, expect, it, vi } from 'vitest';
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
    provider: 'openai' as const,
    model: 'gpt-5-mini' as const,
    api_key_ciphertext: ciphertext.toString('base64url'),
    api_key_iv: iv.toString('base64url'),
    api_key_auth_tag: cipher.getAuthTag().toString('base64url'),
  };
}

describe('ASA native AI Chat', () => {
  it('never returns the credential to the admin read surface', async () => {
    const query = vi.fn(async () => ({
      rows: [
        {
          enabled: true,
          provider: 'openai',
          model: 'gpt-5-mini',
          api_key_configured: true,
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
    const query = vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push([sql, ...params]);
      if (sql.includes('ai_admin_get_config')) {
        return {
          rows: [
            {
              enabled: false,
              provider: 'openai',
              model: 'gpt-5-mini',
              api_key_configured: false,
              key_fingerprint: null,
              configuration_version: 1,
              updated_at: null,
            },
          ],
        };
      }
      return { rows: [{ ai_admin_set_config: 2 }] };
    });
    const service = new AiChatService({ query } as unknown as pg.Pool, {
      encryptionKey: ROOT,
    });
    await service.saveAdminConfig(
      PRINCIPAL,
      {
        enabled: true,
        provider: 'openai',
        model: 'gpt-5-mini',
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
      if (sql.includes('ai_chat_begin')) return { rows: [{ id: REQUEST }] };
      if (sql.includes('ai_chat_messages')) {
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
    const result = await service.send(PRINCIPAL, THREAD, 'Объясни Arduino');
    expect(result.messages).toHaveLength(2);
    expect(queries.findIndex((sql) => sql.includes('ai_chat_begin'))).toBeLessThan(
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
    expect(body.model).toBe('gpt-5-mini');
    expect(body.input).toHaveLength(1);
  });

  it('does not retry a rejected paid request and releases the thread lock', async () => {
    const queries: string[] = [];
    const query = vi.fn(async (sql: string) => {
      queries.push(sql);
      if (sql.includes('ai_runtime_config')) return { rows: [secureRuntime()] };
      if (sql.includes('ai_chat_begin')) return { rows: [{ id: REQUEST }] };
      if (sql.includes('ai_chat_messages')) {
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
    await expect(service.send(PRINCIPAL, THREAD, 'Вопрос')).rejects.toMatchObject({
      code: 'ai_provider_error',
      status: 503,
    } satisfies Partial<AiServiceError>);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(queries.some((sql) => sql.includes('ai_chat_abort'))).toBe(true);
    expect(queries.some((sql) => sql.includes('ai_chat_finish'))).toBe(false);
  });
});
