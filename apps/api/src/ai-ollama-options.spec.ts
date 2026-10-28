import { describe, expect, it, vi } from 'vitest';
import {
  inspectOllamaModel,
  resolveOllamaThinking,
  streamOllamaText,
  validOllamaOptions,
} from './ai-ollama';

describe('discovered Ollama inference controls', () => {
  it.each([
    [{ values: [false, 'low', 'medium', 'xhigh'], default: 'medium' }, 'medium'],
    [{ values: [false, true], default: true }, true],
    [{ values: [false, true], default: false }, true],
    [{ values: [false], default: false }, false],
  ])('keeps enabled model defaults and opts in where supported', (thinking, expected) => {
    expect(resolveOllamaThinking('default', { capabilities: [], thinking, contextMax: null })).toBe(
      expected,
    );
  });
  it('discovers future named modes without guessing their order and preserves separate thinking output', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (url) =>
      String(url).endsWith('/api/show')
        ? new Response(
            JSON.stringify({
              capabilities: ['completion', 'thinking'],
              thinking: { values: [false, 'deliberate_v2'], default: 'deliberate_v2' },
              model_info: { 'future.context_length': 131072 },
            }),
          )
        : new Response(
            JSON.stringify({
              message: { thinking: 'private reasoning', content: 'answer' },
              done: true,
            }) + '\n',
          ),
    );
    const detail = await inspectOllamaModel('http://127.0.0.1:11434', 'future:27b', fetchImpl);
    expect(detail.contextMax).toBe(131072);
    expect(resolveOllamaThinking('deliberate_v2', detail)).toBe('deliberate_v2');
    expect(() => resolveOllamaThinking('xhigh', detail)).toThrow();
    const onDelta = vi.fn();
    const reply = await streamOllamaText({
      baseUrl: 'http://127.0.0.1:11434',
      model: 'future:27b',
      thinking: 'deliberate_v2',
      contextTokens: 98304,
      context: [],
      instructions: '',
      signal: new AbortController().signal,
      onDelta,
      fetchImpl,
    });
    expect(reply.text).toBe('answer');
    expect(onDelta).toHaveBeenCalledWith('answer');
    expect(JSON.parse(String(fetchImpl.mock.calls.at(-1)?.[1]?.body))).toMatchObject({
      think: 'deliberate_v2',
      options: { num_ctx: 98304, num_predict: -1 },
    });
  });
  it('does not invent thinking support from model names or enable invalid options', () => {
    expect(
      resolveOllamaThinking('default', { capabilities: [], thinking: null, contextMax: null }),
    ).toBeUndefined();
    expect(() =>
      resolveOllamaThinking('on', { capabilities: [], thinking: null, contextMax: null }),
    ).toThrow();
    for (const context of [0, -1, 2047, 1.5, NaN, 1048577, '65536'])
      expect(validOllamaOptions('default', context)).toBe(false);
    expect(validOllamaOptions('xhigh', 120000)).toBe(true);
  });
});
