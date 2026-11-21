import type { FastifyRequest } from 'fastify';
import type { ActiveContextUseCase } from '@asa-lab/identity';
import type { AdminControlPlaneService } from './admin-control-plane.service';
import type { AiChatService } from './ai-chat.service';
import { AiAdminController } from './ai-admin.controller';
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
    [{ values: [false, true], default: false }, false],
    [{ values: [false], default: false }, false],
  ])('honors the exact model default including false', (thinking, expected) => {
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

it.each(['qwen3.8:27b', 'gemma4:12b'])(
  'preserves untouched accepted defaults for %s without a metadata or inference retry',
  async (model) => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ message: { content: 'answer' }, done: true }) + '\n'),
    );
    await streamOllamaText({
      baseUrl: 'http://127.0.0.1:11434',
      model,
      context: [],
      instructions: '',
      signal: new AbortController().signal,
      onDelta: () => undefined,
      fetchImpl,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(fetchImpl.mock.calls[0]![1]?.body))).toMatchObject({
      think: model === 'qwen3.8:27b' ? 'xhigh' : false,
      options: { num_ctx: 120000, num_predict: -1 },
    });
  },
);
it('validates actual Qwen metadata and rejects unsupported choices/context before chat', async () => {
  const fetchImpl = vi.fn<typeof fetch>(
    async () =>
      new Response(
        JSON.stringify({
          capabilities: ['completion', 'vision', 'tools', 'thinking'],
          thinking: { values: [false, 'low', 'medium', 'xhigh'], default: 'medium' },
          model_info: { 'qwen35.context_length': 262144 },
        }),
      ),
  );
  const detail = await inspectOllamaModel('http://127.0.0.1:11434', 'qwen3.8:27b', fetchImpl);
  expect(detail.contextMax).toBe(262144);
  expect(resolveOllamaThinking('xhigh', detail)).toBe('xhigh');
  expect(resolveOllamaThinking('default', detail)).toBe('medium');
  for (const options of [
    { thinking: 'high', contextTokens: 120000 },
    { thinking: 'xhigh', contextTokens: 262145 },
  ]) {
    await expect(
      streamOllamaText({
        baseUrl: 'http://127.0.0.1:11434',
        model: 'qwen3.8:27b',
        context: [],
        instructions: '',
        signal: new AbortController().signal,
        onDelta: () => undefined,
        fetchImpl,
        ...options,
      }),
    ).rejects.toMatchObject({ status: 400 });
  }
  expect(fetchImpl.mock.calls.every(([url]) => String(url).endsWith('/api/show'))).toBe(true);
});

it('admin controller forwards local inference fields and blocks unprivileged metadata inspection', async () => {
  let role = 'platform_admin';
  const saveOllamaSettings = vi.fn(async () => ({}));
  const ollamaModelDetail = vi.fn(async () => ({}));
  const controller = new AiAdminController(
    { resolve: async () => ({ principalId: 'actor' }) } as unknown as ActiveContextUseCase,
    {
      resolveAccess: async () => ({ scopes: [{ kind: 'platform', role }] }),
    } as unknown as AdminControlPlaneService,
    { saveOllamaSettings, ollamaModelDetail } as unknown as AiChatService,
  );
  const request = {
    id: 'controls',
    cookies: {},
    headers: { host: 'asa.test', origin: 'https://asa.test', 'content-type': 'application/json' },
  } as unknown as FastifyRequest;
  const input = {
    enabled: false,
    baseUrl: 'http://127.0.0.1:11434',
    model: 'qwen3.8:27b',
    revision: 4,
    thinking: 'xhigh',
    contextTokens: 120000,
  };
  await controller.updateOllama(request, input);
  expect(saveOllamaSettings).toHaveBeenCalledWith('actor', input, 'controls');
  role = 'school_admin';
  await expect(controller.ollamaModelDetail(request, input)).rejects.toMatchObject({ status: 403 });
  expect(ollamaModelDetail).not.toHaveBeenCalled();
});
