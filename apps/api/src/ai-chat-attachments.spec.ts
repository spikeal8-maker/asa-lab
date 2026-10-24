import { createHash } from 'node:crypto';
import type pg from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { AiChatService } from './ai-chat.service';
import { AiAttachmentError } from './ai-attachments/contracts';
import type { AiAttachmentService } from './ai-attachments/service';

const OWNER = '11111111-1111-4111-8111-111111111111';
const THREAD = '22222222-2222-4222-8222-222222222222';
const REQUEST = '33333333-3333-4333-8333-333333333333';
const UPLOAD = '44444444-4444-4444-8444-444444444444';

function attachmentService(bytes: Buffer, kind: 'text' | 'image' = 'text') {
  const receipt = {
    uploadId: UPLOAD,
    fileName: kind === 'text' ? 'sketch.ino' : 'led.png',
    sizeBytes: bytes.length,
    mediaType: kind === 'text' ? 'text/plain' : 'image/png',
    kind,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
  const withRead = vi.fn(
    async (
      _owner: string,
      _upload: string,
      consume: (file: { receipt: typeof receipt; bytes: Buffer }) => Promise<unknown>,
    ) => consume({ receipt, bytes }),
  );
  return { withRead } as unknown as AiAttachmentService;
}

function mockPool() {
  const sqlCalls: Array<{ sql: string; params: unknown[] }> = [];
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    sqlCalls.push({ sql, params });
    if (sql.includes('ai_runtime_config'))
      return { rows: [{ enabled: false, provider: 'openai', model: 'gpt-5-mini' }] };
    if (sql.includes('ai_ollama_runtime'))
      return {
        rows: [
          { enabled: true, base_url: 'http://127.0.0.1:11434', model: 'ornith:9b', revision: 5 },
        ],
      };
    if (sql.includes('ai_attachment_begin_message_local')) return { rows: [{ admitted: true }] };
    if (sql.includes('ai_text_generation_context'))
      return { rows: [{ role: 'user', content: 'Найди ошибку в файле' }] };
    if (sql.includes('ai_text_messages_page'))
      return {
        rows: [
          {
            id: '66666666-6666-4666-8666-666666666666',
            role: 'assistant',
            content: 'Исправьте номер порта.',
            request_id: REQUEST,
            created_at: new Date('2026-10-01T12:00:00Z'),
          },
        ],
      };
    return { rows: [] };
  });
  return { pool: { query } as unknown as pg.Pool, sqlCalls };
}

describe('ASA AI real file-to-provider context', () => {
  it('reads owned Arduino bytes and binds the same upload and request atomically on free Ollama', async () => {
    const code = Buffer.from('const int led=13;\nvoid setup(){pinMode(led,INPUT);}\n');
    const attachments = attachmentService(code);
    const { pool, sqlCalls } = mockPool();
    const fetchImpl = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({ message: { content: 'Используйте OUTPUT.' }, done: true }) + '\n',
        ),
    );
    const chat = new AiChatService(pool, { attachments, fetchImpl });
    const result = await chat.sendStream(
      OWNER,
      THREAD,
      'Найди ошибку в файле',
      REQUEST,
      () => undefined,
      new AbortController().signal,
      'ollama-local',
      undefined,
      [UPLOAD],
    );
    expect(result.replayed).toBe(false);
    expect((attachments.withRead as ReturnType<typeof vi.fn>).mock.calls[0]?.slice(0, 2)).toEqual([
      OWNER,
      UPLOAD,
    ]);
    const admitted = sqlCalls.find((entry) =>
      entry.sql.includes('ai_attachment_begin_message_local'),
    );
    expect(admitted?.params).toEqual([OWNER, THREAD, REQUEST, 'Найди ошибку в файле', 5, [UPLOAD]]);
    expect(sqlCalls.some((entry) => entry.sql.includes('ai_text_begin_paid'))).toBe(false);
    const [url, options] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('http://127.0.0.1:11434/api/chat');
    const body = JSON.parse(String(options?.body)) as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(body.messages.at(-1)?.content).toContain('2: void setup(){pinMode(led,INPUT);}');
    expect(body.messages.at(-1)?.content).toContain('sketch.ino');
    expect(sqlCalls.some((entry) => entry.sql.includes('ai_chat_finish'))).toBe(true);
  });

  it('refuses an image if /api/show lacks Vision before SQL admission or provider chat', async () => {
    const { pool, sqlCalls } = mockPool();
    const attachments = attachmentService(Buffer.from('test image'), 'image');
    const fetchImpl = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ capabilities: ['completion'] })),
    );
    const chat = new AiChatService(pool, { attachments, fetchImpl });
    await expect(
      chat.sendStream(
        OWNER,
        THREAD,
        'Что изображено?',
        REQUEST,
        () => undefined,
        new AbortController().signal,
        'ollama-local',
        undefined,
        [UPLOAD],
      ),
    ).rejects.toMatchObject({ code: 'ai_vision_unsupported', status: 409 });
    expect(sqlCalls.some((entry) => entry.sql.includes('ai_attachment_begin_message'))).toBe(false);
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('http://127.0.0.1:11434/api/show');
  });

  it('does not invoke SQL admission or inference after owner-scoped storage rejects the ID', async () => {
    const { pool, sqlCalls } = mockPool();
    const attachments = {
      withRead: vi.fn(async () => {
        throw new AiAttachmentError('ai_attachment_not_found', 403, 'Нет доступа к вложению.');
      }),
    } as unknown as AiAttachmentService;
    const fetchImpl = vi.fn<typeof fetch>();
    const chat = new AiChatService(pool, { attachments, fetchImpl });
    await expect(
      chat.sendStream(
        OWNER,
        THREAD,
        'Что в файле?',
        REQUEST,
        () => undefined,
        new AbortController().signal,
        'ollama-local',
        undefined,
        [UPLOAD],
      ),
    ).rejects.toMatchObject({ code: 'ai_attachment_not_found', status: 403 });
    expect(sqlCalls.some((entry) => entry.sql.includes('ai_attachment_begin_message'))).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
