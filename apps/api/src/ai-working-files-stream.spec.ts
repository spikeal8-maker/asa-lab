import {
  TOOL_PROVIDERS,
  TOOL_TEST_ROOT,
  toolProviderRuntime,
  toolProviderResponse,
  isToolModelUrl,
} from './testing/ai-tool-provider.fixture';
import type pg from 'pg';
import { expect, it, vi } from 'vitest';
import { AiChatService } from './ai-chat.service';
import { aiUsageQueryFixture } from './testing/ai-usage-query.fixture';

it.each(TOOL_PROVIDERS)(
  'runs read then edit through the real %s chat loop, persists one short answer and sums every round usage',
  async (provider) => {
    const owner = '11111111-1111-4111-8111-111111111111';
    const thread = '22222222-2222-4222-8222-222222222222';
    const request = '33333333-3333-4333-8333-333333333333';
    const query = vi.fn(async (sql: string, params: unknown[] = []) => {
      const journal = aiUsageQueryFixture(sql);
      if (journal) return journal;
      if (sql.includes('ai_runtime_config'))
        return {
          rows: [toolProviderRuntime(provider)],
        };
      if (sql.includes('ai_ollama_runtime'))
        return {
          rows: [
            {
              enabled: provider === 'ollama',
              base_url: 'http://127.0.0.1:11434',
              model: 'fixture:8b',
              revision: 1,
            },
          ],
        };
      if (sql.includes('ai_text_begin')) return { rows: [{ admitted: true }] };
      if (sql.includes('ai_text_generation_context'))
        return { rows: [{ role: 'user', content: 'Измени заголовок змейки' }] };
      if (sql.includes('ai_text_messages_page')) return { rows: [] };
      if (sql.includes('ai_chat_finish')) expect(params[3]).toBe('Заголовок обновлён.');
      return { rows: [] };
    });
    let round = 0;
    const fetchImpl = vi.fn<typeof fetch>(async (url, init) => {
      if (String(url).endsWith('/api/show'))
        return new Response(JSON.stringify({ capabilities: ['completion', 'tools'] }));
      expect(isToolModelUrl(String(url))).toBe(true);
      const body = JSON.parse(String(init?.body));
      expect(
        body.tools.map(
          (t: { name?: string; function?: { name: string } }) => t.name ?? t.function?.name,
        ),
      ).toContain('edit_working_file');
      round++;
      const message =
        round === 1
          ? {
              tool_calls: [
                { function: { name: 'read_working_file', arguments: { name: 'snake.html' } } },
              ],
            }
          : round === 2
            ? {
                tool_calls: [
                  {
                    function: {
                      name: 'edit_working_file',
                      arguments: {
                        name: 'snake.html',
                        expectedVersion: 1,
                        edits: [{ oldText: 'Snake', newText: 'Змейка' }],
                      },
                    },
                  },
                ],
              }
            : { content: 'Заголовок обновлён.' };
      return toolProviderResponse(provider, {
        message,
        done: true,
        prompt_eval_count: 10,
        eval_count: 2,
        model: 'fixture:8b',
      });
    });
    const service = new AiChatService({ query } as unknown as pg.Pool, {
      fetchImpl,
      encryptionKey: TOOL_TEST_ROOT,
    });
    vi.spyOn(service.workingFiles, 'ready').mockResolvedValue(true);
    vi.spyOn(service.workingFiles, 'list').mockResolvedValue([]);
    const file = {
      id: 'file',
      name: 'snake.html',
      version: 1,
      content: '<h1>Snake</h1>',
      anchorRequestId: request,
      sourceMessageId: null,
      sourceBlock: null,
      updatedAt: '',
    };
    vi.spyOn(service.workingFiles, 'read').mockResolvedValue(file);
    const write = vi
      .spyOn(service.workingFiles, 'write')
      .mockResolvedValue({ ...file, version: 2, content: '<h1>Змейка</h1>' });
    const deltas: string[] = [];
    await service.sendStream(
      owner,
      thread,
      'Измени заголовок змейки',
      request,
      (delta) => deltas.push(delta),
      new AbortController().signal,
    );
    expect(round).toBe(3);
    expect(deltas.join('')).toBe('Заголовок обновлён.');
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0]?.slice(0, 5)).toEqual([
      owner,
      thread,
      'snake.html',
      1,
      '<h1>Змейка</h1>',
    ]);
    const usage = query.mock.calls.find(([sql]) => sql.includes('ai_usage_finish'));
    expect(usage?.[1]).toContain(30);
    expect(usage?.[1]).toContain(6);
  },
);
