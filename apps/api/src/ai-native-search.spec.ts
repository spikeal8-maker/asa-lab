import type { AiToolActivity } from '@asa-lab/contracts';
import * as cloudAdapter from './ai-provider-stream';
import * as localAdapter from './ai-ollama';
import { AiImageError, type AiImageService } from './ai-image.service';
import {
  TOOL_PROVIDERS,
  TOOL_TEST_ROOT,
  toolProviderRuntime,
  toolProviderResponse,
  isToolModelUrl,
  type ToolProvider,
} from './testing/ai-tool-provider.fixture';
import type pg from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { AiChatService } from './ai-chat.service';
import { imageSearchQueryAllowed } from './ai-web-search';
import { AiWebSearchService } from './ai-web-search';
import { aiUsageQueryFixture } from './testing/ai-usage-query.fixture';

const originalLocal = localAdapter.streamOllamaText;
const originalCloud = cloudAdapter.streamProviderText;
const OWNER = '11111111-1111-4111-8111-111111111111';
const THREAD = '22222222-2222-4222-8222-222222222222';
const REQUEST = '33333333-3333-4333-8333-333333333333';

function fixture(
  mode: 'auto' | 'off',
  tool: 'web_search' | 'image_search' | 'weather' | 'read_page' | 'generate_image' = 'web_search',
  toolQuery = 'Казань новости',
  disabledTools: readonly ('web_search' | 'image_search' | 'weather')[] = [],
  weatherVariant: 'complete' | 'partial' | 'ambiguous' | 'future' = 'complete',
  toolsCapable = true,
  userPrompt = tool === 'weather' ? 'Какая погода сейчас в Казани?' : 'Найди факты',
  chooseRead = false,
  provider: ToolProvider = 'ollama',
  imageReady = true,
) {
  let admitted = false;
  let answer: string | null = null;
  const calls: { sql: string; params: unknown[] }[] = [];
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    const journal = aiUsageQueryFixture(sql);
    if (journal) return journal;
    if (
      sql.includes('to_regprocedure') &&
      !sql.includes('ai_polza_catalog_runtime') &&
      disabledTools.length
    )
      return { rows: [{ ready: true }] };
    if (sql.includes('ai_tool_policy_snapshot'))
      return {
        rows: [
          {
            value: {
              revision: 3,
              tools: ['weather', 'web_search', 'image_search', 'generate_image'].map((id) => ({
                id,
                enabled: !disabledTools.includes(id as 'web_search' | 'image_search' | 'weather'),
                instructions: id === 'weather' ? 'Назови время обновления.' : '',
              })),
            },
          },
        ],
      };
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
    if (sql.includes('ai_web_search_runtime'))
      return {
        rows: [
          {
            enabled: true,
            weather_enabled: true,
            operations_per_hour: 100,
            revision: 1,
            allowed_domains: [],
            blocked_domains: [],
            search_instructions: '',
          },
        ],
      };
    if (sql.includes('ai_web_cache_claim')) {
      const body =
        params[0] === 'geocode'
          ? weatherVariant === 'ambiguous'
            ? [
                { name: 'Казань, Татарстан, Россия', lat: 55.7961, lon: 49.1064 },
                { name: 'Казань, другое место', lat: 56, lon: 50 },
              ]
            : [{ name: 'Казань, Татарстан, Россия', lat: 55.7961, lon: 49.1064 }]
          : {
              properties: {
                meta: {
                  updated_at: '2026-10-25T12:00:00Z',
                  units: {
                    air_temperature: 'celsius',
                    ...(weatherVariant === 'complete'
                      ? {
                          relative_humidity: '%',
                          air_pressure_at_sea_level: 'hPa',
                          wind_speed: 'm/s',
                        }
                      : {}),
                  },
                },
                timeseries: [
                  {
                    time: '2026-10-25T13:00:00Z',
                    data: {
                      instant: {
                        details: {
                          air_temperature: 4,
                          ...(weatherVariant === 'complete'
                            ? {
                                relative_humidity: 80,
                                air_pressure_at_sea_level: 1034.1,
                                wind_speed: 3.2,
                              }
                            : {}),
                        },
                      },
                    },
                  },
                  ...(weatherVariant === 'future'
                    ? [
                        {
                          time: '2026-10-26T13:00:00Z',
                          data: { instant: { details: { air_temperature: 1 } } },
                        },
                      ]
                    : []),
                ],
              },
            };
      return { rows: [{ value: { state: 'fresh', body } }] };
    }
    if (sql.includes('ai_tool_request_options')) return { rows: [{ value: true }] };
    if (sql.includes('ai_web_text_begin') || sql.includes('ai_text_begin')) {
      const fresh = !admitted;
      admitted = true;
      return { rows: [{ admitted: fresh }] };
    }
    if (sql.includes('ai_web_search_claim')) return { rows: [{ status: 'ready' }] };
    if (sql.includes('ai_text_generation_context'))
      return { rows: [{ role: 'user', content: userPrompt }] };
    if (sql.includes('ai_text_messages_page'))
      return {
        rows: answer
          ? [
              {
                id: 'reply',
                role: 'assistant',
                content: answer,
                request_id: REQUEST,
                state: 'complete',
                created_at: new Date(),
              },
            ]
          : [],
      };
    if (sql.includes('ai_chat_finish')) answer = String(params[3]);
    return { rows: [] };
  });
  const requests: { url: string; body?: Record<string, unknown> }[] = [];
  const fetchImpl = vi.fn<typeof fetch>(async (url, options) => {
    const address = String(url);
    if (address.endsWith('/api/show'))
      return new Response(
        JSON.stringify({ capabilities: toolsCapable ? ['completion', 'tools'] : ['completion'] }),
      );
    const body = options?.body
      ? (JSON.parse(String(options.body)) as Record<string, unknown>)
      : undefined;
    requests.push({ url: address, body });
    if (isToolModelUrl(address)) {
      const round = requests.filter((item) => isToolModelUrl(item.url)).length;
      const packet =
        round === 1 &&
        (mode === 'auto' || tool === 'generate_image') &&
        toolsCapable &&
        disabledTools.length < 3
          ? {
              message: {
                tool_calls: [
                  {
                    function: {
                      name: tool,
                      arguments:
                        tool === 'generate_image'
                          ? {
                              prompt: 'Синий замок в лесу',
                              size: 1024,
                              model: 'flux2-klein-4b-fp8-izo-v1',
                            }
                          : tool === 'weather'
                            ? { city: 'Казань' }
                            : tool === 'read_page'
                              ? { url: toolQuery }
                              : { query: toolQuery },
                    },
                  },
                ],
              },
              done: true,
              prompt_eval_count: 10,
              eval_count: 2,
              model: 'fixture:8b',
            }
          : round === 2 && chooseRead
            ? {
                message: {
                  tool_calls: [{ function: { name: 'read_page', arguments: { sourceIds: [1] } } }],
                },
                done: true,
                prompt_eval_count: 20,
                eval_count: 5,
                model: 'fixture:8b',
              }
            : {
                message: { content: 'Ответ по источнику' },
                done: true,
                prompt_eval_count: 20,
                eval_count: 5,
                model: 'fixture:8b',
              };
      return toolProviderResponse(provider, packet);
    }
    if (address.includes('/search?'))
      return new Response(
        JSON.stringify({
          results: [{ title: 'Источник', url: 'https://example.org/news', content: 'Факт' }],
        }),
      );
    throw new Error('Unexpected network request: ' + address);
  });
  const images = {
    nativeSchemaReady: vi.fn(async () => true),
    status: vi.fn(async () => ({
      enabled: imageReady,
      ready: imageReady,
      sizes: [1024],
      remainingToday: 10,
      recipe: 'flux2-klein-4b-fp8-izo-v1',
    })),
    toolContext: vi.fn(async () => []),
    replayTool: vi.fn(async () => ({ id: 'image-job', status: 'queued' })),
    createFromTool: vi.fn(async () => ({ id: 'image-job', status: 'queued' })),
  };
  const service = new AiChatService({ query } as unknown as pg.Pool, {
    fetchImpl,
    encryptionKey: TOOL_TEST_ROOT,
    ...(tool === 'generate_image' ? { images: images as unknown as AiImageService } : {}),
  });
  const deltas: string[] = [];
  const activities: AiToolActivity[] = [];
  const client = new AbortController();
  const send = () =>
    service.sendStream(
      OWNER,
      THREAD,
      userPrompt,
      REQUEST,
      (chunk) => deltas.push(chunk),
      client.signal,
      undefined,
      undefined,
      [],
      mode,
      undefined,
      tool === 'generate_image' ? { mode: 'auto', size: 1024 } : undefined,
      (activity) => activities.push(activity),
    );
  return { service, send, calls, requests, fetchImpl, deltas, images, client, activities };
}

describe('native local internet tools', () => {
  it('admits once, calls web search once, persists evidence, follows up once and replays without network', async () => {
    const f = fixture('auto');
    const first = await f.send();
    expect(first.replayed).toBe(false);
    expect(f.requests.filter((item) => item.url.endsWith('/api/chat'))).toHaveLength(2);
    expect(f.requests.filter((item) => item.url.includes('/search?'))).toHaveLength(1);
    const firstBody = f.requests.find((item) => item.url.endsWith('/api/chat'))!.body!;
    expect(
      (firstBody.tools as { function: { name: string } }[]).map((item) => item.function.name),
    ).toEqual(['web_search', 'image_search', 'weather']);
    const finalBody = f.requests.filter((item) => item.url.endsWith('/api/chat'))[1]!.body!;
    expect(
      (finalBody.tools as { function: { name: string } }[]).map((item) => item.function.name),
    ).toEqual(['read_page']);
    expect(JSON.stringify(finalBody.messages)).toContain('example.org/news');
    const finalSystem = (finalBody.messages as { role: string; content: string }[])[0]!.content;
    expect(finalSystem).not.toContain('Доступны native web_search, image_search');
    expect(finalSystem).toContain('callable_by_model');
    expect(finalSystem).toContain('read_page');
    expect(f.calls.filter((item) => item.sql.includes('ai_web_search_finish'))).toHaveLength(1);
    expect(f.calls.filter((item) => item.sql.includes('ai_usage_begin'))).toHaveLength(1);
    const usage = f.calls.find((item) => item.sql.includes('ai_usage_finish'))!;
    expect(usage.params).toContain(30);
    expect(usage.params).toContain(7);
    expect(f.activities).toEqual([
      { tool: 'web_search', state: 'running' },
      { tool: 'web_search', state: 'complete' },
    ]);
    const activityCount = f.activities.length;
    const count = f.fetchImpl.mock.calls.length;
    expect((await f.send()).replayed).toBe(true);
    expect(f.activities).toHaveLength(activityCount);
    expect(f.fetchImpl).toHaveBeenCalledTimes(count);
  });

  it('lets the model select a page, persists its content once, then finishes without more tools', async () => {
    const read = vi
      .spyOn(AiWebSearchService.prototype, 'readPages')
      .mockImplementation(async (evidence, ids) => ({
        ...evidence,
        sources: evidence.sources.map((source) =>
          ids.includes(source.id)
            ? {
                ...source,
                pageRead: 'read',
                pageText: 'Verified article contents beyond the search snippet.',
              }
            : source,
        ),
      }));
    try {
      const f = fixture(
        'auto',
        'web_search',
        'Казань новости',
        [],
        'complete',
        true,
        'Сравни подробности новости',
        true,
      );
      await f.send();
      expect(read).toHaveBeenCalledOnce();
      expect(f.activities).toEqual([
        { tool: 'web_search', state: 'running' },
        { tool: 'web_search', state: 'complete' },
        { tool: 'read_page', state: 'running' },
        { tool: 'read_page', state: 'complete' },
      ]);
      const rounds = f.requests.filter((item) => item.url.endsWith('/api/chat'));
      expect(rounds).toHaveLength(3);
      expect(rounds[2]!.body!.tools).toBeUndefined();
      expect(JSON.stringify(rounds[2]!.body!.messages)).toContain('Verified article contents');
      expect(f.calls.filter((item) => item.sql.includes('ai_web_search_finish'))).toHaveLength(1);
      const count = f.fetchImpl.mock.calls.length;
      expect((await f.send()).replayed).toBe(true);
      expect(f.fetchImpl).toHaveBeenCalledTimes(count);
    } finally {
      read.mockRestore();
    }
  });

  it('offers no internet tools when the user switches internet off', async () => {
    const f = fixture('off');
    await f.send();
    expect(f.requests).toHaveLength(1);
    expect(f.requests[0]!.body?.tools).toBeUndefined();
    expect(f.calls.some((item) => item.sql.includes('ai_web_search_claim'))).toBe(false);
  });

  it('uses prepared auto-search for a local model without confirmed tools capability', async () => {
    const f = fixture('auto', 'web_search', 'Казань новости', [], 'complete', false);
    const result = await f.send();
    expect(result.replayed).toBe(false);
    expect(f.requests.filter((item) => item.url.endsWith('/api/chat'))).toHaveLength(1);
    expect(f.requests.find((item) => item.url.endsWith('/api/chat'))?.body?.tools).toBeUndefined();
    expect(f.requests.filter((item) => item.url.includes('/search?'))).toHaveLength(1);
    expect(f.calls.some((item) => item.sql.includes('ai_web_search_finish'))).toBe(true);
    expect(f.calls.find((item) => item.sql.includes('ai_chat_finish'))?.params[3]).toBe(
      'Ответ по источнику',
    );
  });

  it('omits a disabled native tool while retaining a per-tool admin instruction', async () => {
    const f = fixture('auto', 'web_search', 'Казань новости', ['image_search']);
    await f.send();
    const body = f.requests.find((item) => item.url.endsWith('/api/chat'))!.body!;
    const tools = body.tools as { function: { name: string; description: string } }[];
    expect(tools.map((item) => item.function.name)).toEqual(['web_search', 'weather']);
    expect(tools.find((item) => item.function.name === 'weather')?.function.description).toContain(
      'Назови время обновления.',
    );
    expect(tools.find((item) => item.function.name === 'weather')?.function.description).toContain(
      'Серверные ограничения',
    );
  });

  it('does not announce unavailable internet tools when all three are disabled', async () => {
    const f = fixture('auto', 'web_search', 'Казань новости', [
      'web_search',
      'image_search',
      'weather',
    ]);
    await f.send();
    expect(f.requests).toHaveLength(1);
    const body = f.requests[0]!.body!;
    expect(body.tools).toBeUndefined();
    const system = (body.messages as { role: string; content: string }[])[0]!.content;
    expect(system).not.toContain('Доступны native web_search');
    expect(system).toMatch(/callable_by_model\\?":\[\]/u);
    expect(f.calls.some((item) => item.sql.includes('ai_web_search_claim'))).toBe(false);
  });

  it('routes image discovery through strict SearxNG safesearch and stores the image receipt', async () => {
    const f = fixture('auto', 'image_search');
    await f.send();
    const url = new URL(f.requests.find((item) => item.url.includes('/search?'))!.url);
    expect(url.searchParams.get('categories')).toBe('images');
    expect(url.searchParams.get('safesearch')).toBe('2');
    const claim = f.calls.find((item) => item.sql.includes('ai_web_search_claim'))!;
    expect(claim.params).toEqual([OWNER, THREAD, REQUEST, 'images', 'Казань новости', 1]);
  });

  it('routes weather through cached Nominatim and MET evidence with forecast timestamps', async () => {
    const f = fixture('auto', 'weather');
    await f.send();
    const claim = f.calls.find((item) => item.sql.includes('ai_web_search_claim'))!;
    expect(claim.params).toEqual([OWNER, THREAD, REQUEST, 'weather', 'Казань', 1]);
    expect(f.calls.filter((item) => item.sql.includes('ai_web_cache_claim'))).toHaveLength(2);
    expect(f.requests).toHaveLength(1);
    const finish = f.calls.find((item) => item.sql.includes('ai_web_search_finish'))!;
    expect(String(finish.params[3])).toContain('2026-10-25T13:00:00.000Z');
    expect(f.requests.filter((item) => item.url.endsWith('/api/chat'))).toHaveLength(1);
    const saved = f.calls.find((item) => item.sql.includes('ai_chat_finish'))!;
    expect(saved.params[3]).toContain('🌡 Казань, Татарстан, Россия');
    expect(saved.params[3]).toContain('температура 4 °C');
    expect(saved.params[3]).toContain('влажность 80 %');
    expect(saved.params[3]).toContain('ветер 3,2 м/с');
    expect(saved.params[3]).toContain('давление 1034,1 гПа');
    expect(saved.params[3]).not.toContain('мм рт');
    expect(saved.params[3]).toContain('2026-10-25 13:00:00 UTC');
    expect(saved.params[3]).toContain('2026-10-25 12:00:00 UTC');
    expect(saved.params[3]).toContain('[MET Norway](https://api.met.no/');
    expect(f.deltas).toEqual([saved.params[3]]);
    const usage = f.calls.find((item) => item.sql.includes('ai_usage_finish'))!;
    expect(usage.params).toContain(10);
    expect(usage.params).toContain(2);
    const networkCalls = f.fetchImpl.mock.calls.length;
    expect((await f.send()).replayed).toBe(true);
    expect(f.fetchImpl).toHaveBeenCalledTimes(networkCalls);
  });

  it('omits absent weather measures instead of inventing zeros', async () => {
    const f = fixture('auto', 'weather', 'Казань', [], 'partial');
    await f.send();
    const saved = f.calls.find((item) => item.sql.includes('ai_chat_finish'))!;
    expect(saved.params[3]).toContain('температура 4 °C');
    expect(saved.params[3]).not.toMatch(/влажность|ветер|давление| 0 /u);
    expect(f.requests.filter((item) => item.url.endsWith('/api/chat'))).toHaveLength(1);
  });

  it('keeps a future forecast question in the model follow-up with the requested day available', async () => {
    const f = fixture(
      'auto',
      'weather',
      'Казань',
      [],
      'future',
      true,
      'Какая погода завтра в Казани?',
    );
    await f.send();
    const rounds = f.requests.filter((item) => item.url.endsWith('/api/chat'));
    expect(rounds).toHaveLength(2);
    expect(JSON.stringify(rounds[1]!.body?.messages)).toContain('2026-10-26T13:00:00.000Z');
    expect(JSON.stringify(rounds[1]!.body?.messages)).toContain('не подставляй первый час');
    expect(JSON.stringify(rounds[1]!.body?.messages)).toContain('pressureHpa — гПа');
    expect(f.calls.find((item) => item.sql.includes('ai_chat_finish'))?.params[3]).toBe(
      'Ответ по источнику',
    );
  });

  it.each([
    'Какая погода сейчас в Казани и на выходных?',
    'Какая погода сейчас в Казани и в понедельник?',
  ])('does not shorten a mixed-period request to the first hour: %s', async (userPrompt) => {
    const f = fixture('auto', 'weather', 'Казань', [], 'future', true, userPrompt);
    await f.send();
    const rounds = f.requests.filter((item) => item.url.endsWith('/api/chat'));
    expect(rounds).toHaveLength(2);
    expect(JSON.stringify(rounds[1]!.body?.messages)).toContain(userPrompt);
    expect(f.calls.find((item) => item.sql.includes('ai_chat_finish'))?.params[3]).toBe(
      'Ответ по источнику',
    );
  });

  it('does not render a current-weather shortcut for a city different from the request', async () => {
    const f = fixture(
      'auto',
      'weather',
      'Казань',
      [],
      'complete',
      true,
      'Какая погода сейчас в Москве?',
    );
    await f.send();
    expect(f.requests.filter((item) => item.url.endsWith('/api/chat'))).toHaveLength(2);
    expect(f.calls.find((item) => item.sql.includes('ai_chat_finish'))?.params[3]).toBe(
      'Ответ по источнику',
    );
  });

  it('keeps the clarification model round for an ambiguous weather location', async () => {
    const f = fixture('auto', 'weather', 'Казань', [], 'ambiguous');
    await f.send();
    expect(f.requests.filter((item) => item.url.endsWith('/api/chat'))).toHaveLength(2);
    expect(f.calls.find((item) => item.sql.includes('ai_chat_finish'))?.params[3]).toBe(
      'Ответ по источнику',
    );
  });

  it('rejects explicit sexual image discovery even with upstream safesearch', () => {
    expect(imageSearchQueryAllowed('nude photos')).toBe(false);
    expect(imageSearchQueryAllowed('pornographic photos')).toBe(false);
    expect(imageSearchQueryAllowed('sex photos')).toBe(false);
    expect(imageSearchQueryAllowed('sexual images')).toBe(false);
    expect(imageSearchQueryAllowed('голые девочки фото')).toBe(false);
    expect(imageSearchQueryAllowed('Фото Голых Девочек')).toBe(false);
    expect(imageSearchQueryAllowed('порнографические картинки')).toBe(false);
    expect(imageSearchQueryAllowed('sex chromosomes diagram')).toBe(true);
    expect(imageSearchQueryAllowed('medical anatomy illustrations')).toBe(true);
    expect(imageSearchQueryAllowed('фотографии Казани')).toBe(true);
  });

  it('persists an unsafe image-query decision without contacting SearxNG', async () => {
    const sql: string[] = [];
    const query = vi.fn(async (statement: string) => {
      sql.push(statement);
      if (statement.includes('ai_web_search_runtime'))
        return {
          rows: [
            {
              enabled: true,
              weather_enabled: true,
              operations_per_hour: 100,
              allowed_domains: [],
              blocked_domains: [],
            },
          ],
        };
      if (statement.includes('ai_web_search_claim')) return { rows: [{ status: 'ready' }] };
      return { rows: [] };
    });
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new Error('unsafe query escaped');
    });
    const service = new AiWebSearchService({ query } as unknown as pg.Pool, fetchImpl);
    const evidence = await service.prepare(
      OWNER,
      THREAD,
      REQUEST,
      'голые девочки фото',
      'images',
      new AbortController().signal,
    );
    expect(evidence).toMatchObject({ status: 'unavailable', reason: 'unsafe_query' });
    expect(sql.some((item) => item.includes('ai_web_search_finish'))).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('blocks a native image-search query before the provider while completing with truthful evidence', async () => {
    const f = fixture('auto', 'image_search', 'sex photos');
    await f.send();
    expect(f.requests.filter((item) => item.url.includes('/search?'))).toHaveLength(0);
    const finish = f.calls.find((item) => item.sql.includes('ai_web_search_finish'))!;
    expect(String(finish.params[3])).toContain('unsafe_query');
    expect(f.requests.filter((item) => item.url.endsWith('/api/chat'))).toHaveLength(2);
  });

  it('rejects an address passed as a weather city before geocoding or search', async () => {
    const query = vi.fn(async (statement: string) => {
      if (statement.includes('ai_web_search_runtime'))
        return {
          rows: [
            {
              enabled: true,
              weather_enabled: true,
              operations_per_hour: 100,
              allowed_domains: [],
              blocked_domains: [],
            },
          ],
        };
      if (statement.includes('ai_web_search_claim')) return { rows: [{ status: 'ready' }] };
      return { rows: [] };
    });
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new Error('address escaped');
    });
    const service = new AiWebSearchService({ query } as unknown as pg.Pool, fetchImpl);
    const evidence = await service.prepare(
      OWNER,
      THREAD,
      REQUEST,
      'Лесная улица',
      'weather',
      new AbortController().signal,
      'Лесная улица',
    );
    expect(evidence).toMatchObject({ status: 'needs_location', reason: 'location_required' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

it('streams ordinary text before completion even when native tools are offered', async () => {
  const f = fixture('auto');
  const original = f.fetchImpl.getMockImplementation()!;
  let finish = (): void => undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encode = (content: string, done: boolean): Uint8Array =>
        new TextEncoder().encode(JSON.stringify({ message: { content }, done }) + '\n');
      controller.enqueue(encode('Первая часть. ', false));
      finish = () => {
        controller.enqueue(encode('Вторая часть.', true));
        controller.close();
      };
    },
  });
  f.fetchImpl.mockImplementation(async (url, options) => {
    if (String(url).endsWith('/api/chat')) {
      expect(JSON.parse(String(options?.body)).tools.length).toBeGreaterThan(0);
      return new Response(stream);
    }
    return original(url, options);
  });
  let completed = false;
  const sent = f.send().then((result) => {
    completed = true;
    return result;
  });
  try {
    await vi.waitFor(() => expect(f.deltas.join('')).toBe('Первая часть. '));
    expect(completed).toBe(false);
  } finally {
    finish();
    await sent;
  }
  expect(f.deltas).toEqual(['Первая часть. ', 'Вторая часть.']);
});

it('offers only user-provided URLs, executes a selected direct read and follows up without search', async () => {
  const url = 'https://example.org/article';
  const read = vi.spyOn(AiWebSearchService.prototype, 'prepareDirect').mockResolvedValue({
    schemaVersion: 1,
    provider: 'searxng',
    mode: 'web',
    status: 'ready',
    query: 'Страница',
    retrievedAt: new Date().toISOString(),
    images: [],
    sources: [
      {
        id: 1,
        url,
        hostname: 'example.org',
        title: 'Article',
        snippet: '',
        pageRead: 'read',
        pageText: 'Actual full article text from the provided address.',
      },
    ],
  });
  try {
    const f = fixture('auto', 'read_page', url, [], 'complete', true, 'Проанализируй ' + url);
    await f.send();
    expect(read).toHaveBeenCalledWith(OWNER, THREAD, REQUEST, url, expect.any(AbortSignal), true);
    expect(f.requests.some((item) => item.url.includes('/search?'))).toBe(false);
    const rounds = f.requests.filter((item) => item.url.endsWith('/api/chat'));
    expect(rounds).toHaveLength(2);
    expect(JSON.stringify(rounds[0]!.body!.tools)).toContain(url);
    expect(JSON.stringify(rounds[1]!.body!.messages)).toContain('Actual full article text');
    expect(rounds[1]!.body!.tools).toBeUndefined();
    expect(f.calls.filter((item) => item.sql.includes('ai_web_search_finish'))).toHaveLength(1);
  } finally {
    read.mockRestore();
  }
});

// The actual service executor, not only the transport parser, must be provider-neutral.
describe.each(TOOL_PROVIDERS)('%s internet executor', (provider) => {
  it.each(['web_search', 'image_search', 'weather'] as const)(
    'executes %s once and never sends follow-up to another provider',
    async (tool) => {
      const f = fixture(
        'auto',
        tool,
        'Казань новости',
        [],
        'complete',
        true,
        undefined,
        false,
        provider,
      );
      await f.send();
      const rounds = f.requests.filter((item) => isToolModelUrl(item.url));
      expect(rounds.length).toBe(tool === 'weather' ? 1 : 2);
      expect(new Set(rounds.map((item) => item.url)).size).toBe(1);
      const tools = rounds[0]!.body!.tools;
      expect(JSON.stringify(tools)).toContain('web_search');
      expect(JSON.stringify(tools)).toContain('image_search');
      expect(JSON.stringify(tools)).toContain('weather');
      expect(f.deltas.join('')).not.toContain('"arguments"');
      const count = f.fetchImpl.mock.calls.length;
      expect((await f.send()).replayed).toBe(true);
      expect(f.fetchImpl).toHaveBeenCalledTimes(count);
    },
  );
  it('allows search, selected page reading, then a final answer without tools', async () => {
    const read = vi
      .spyOn(AiWebSearchService.prototype, 'readPages')
      .mockImplementation(async (evidence) => ({
        ...evidence,
        sources: evidence.sources.map((source) => ({
          ...source,
          pageRead: 'read',
          pageText: 'FULL_ARTICLE_MARKER',
        })),
      }));
    try {
      const f = fixture(
        'auto',
        'web_search',
        'Казань новости',
        [],
        'complete',
        true,
        'Сравни новости',
        true,
        provider,
      );
      await f.send();
      const rounds = f.requests.filter((item) => isToolModelUrl(item.url));
      expect(rounds).toHaveLength(3);
      expect(new Set(rounds.map((item) => item.url)).size).toBe(1);
      expect(rounds[2]!.body!.tools).toBeUndefined();
      expect(JSON.stringify(rounds[2]!.body)).toContain('FULL_ARTICLE_MARKER');
      expect(read).toHaveBeenCalledOnce();
    } finally {
      read.mockRestore();
    }
  });
  it('respects internet off without issuing a search or offering tools', async () => {
    const f = fixture(
      'off',
      'web_search',
      undefined,
      [],
      'complete',
      true,
      undefined,
      false,
      provider,
    );
    await f.send();
    expect(f.requests).toHaveLength(1);
    expect(f.requests[0]!.body!.tools).toBeUndefined();
  });
});

describe.each(TOOL_PROVIDERS)('%s native image executor', (provider) => {
  it('retains generator failure identity and finishes its activity without submitting twice', async () => {
    const f = fixture(
      'off',
      'generate_image',
      '',
      [],
      'complete',
      true,
      'Создай картинку',
      false,
      provider,
    );
    f.images.createFromTool.mockRejectedValueOnce(
      new AiImageError('ai_image_unavailable', 503, 'PRIVATE GPU host'),
    );
    await expect(f.send()).rejects.toMatchObject({ code: 'ai_image_unavailable' });
    expect(f.images.createFromTool).toHaveBeenCalledOnce();
    expect(f.activities).toEqual([
      { tool: 'generate_image', state: 'running' },
      { tool: 'generate_image', state: 'complete' },
    ]);
  });

  it('offers the configured generator and submits exactly one owner-bound image job', async () => {
    const f = fixture(
      'off',
      'generate_image',
      '',
      [],
      'complete',
      true,
      'Создай картинку замка',
      false,
      provider,
    );
    const result = await f.send();
    expect(result.imageJob?.id).toBe('image-job');
    expect(f.images.createFromTool).toHaveBeenCalledTimes(1);
    expect(f.images.createFromTool.mock.calls[0]?.slice(0, 5)).toEqual([
      OWNER,
      THREAD,
      REQUEST,
      'Синий замок в лесу',
      1024,
    ]);
    const wire = f.requests.find((r) => isToolModelUrl(r.url))!.body!;
    expect(JSON.stringify(wire.tools)).toContain('generate_image');
    expect(JSON.stringify(wire)).toContain('НА РУССКОМ ЯЗЫКЕ');
    const count = f.fetchImpl.mock.calls.length;
    expect((await f.send()).replayed).toBe(true);
    expect(f.fetchImpl).toHaveBeenCalledTimes(count);
    expect(f.images.createFromTool).toHaveBeenCalledTimes(1);
  });
  it('rejects an invented generator call when image generation is unavailable', async () => {
    const f = fixture(
      'off',
      'generate_image',
      '',
      [],
      'complete',
      true,
      'Создай картинку',
      false,
      provider,
      false,
    );
    await expect(f.send()).rejects.toMatchObject({ code: 'ai_tool_call_invalid' });
    expect(f.images.createFromTool).not.toHaveBeenCalled();
  });
  it('advertises native image use for available cloud models without local Ollama', async () => {
    const f = fixture(
      'off',
      'generate_image',
      '',
      [],
      'complete',
      true,
      'Создай картинку',
      false,
      provider,
    );
    const status = await f.service.status();
    expect(status.nativeImageTools).toEqual(status.availableModels);
  });
});

it.each(TOOL_PROVIDERS)('%s never dispatches a tool after user cancellation', async (provider) => {
  const f = fixture(
    'auto',
    'web_search',
    undefined,
    [],
    'complete',
    true,
    undefined,
    false,
    provider,
  );
  const original = f.fetchImpl.getMockImplementation()!;
  f.fetchImpl.mockImplementation(async (url, init) => {
    const response = await original(url, init);
    if (isToolModelUrl(String(url))) f.client.abort();
    return response;
  });
  const result = await f.send();
  expect(result.stopped).toBe(true);
  expect(f.requests.some((item) => item.url.includes('/search?'))).toBe(false);
});

it.each(TOOL_PROVIDERS)(
  '%s accounts for a failed follow-up as well as the successful tool-selection round',
  async (provider) => {
    const f = fixture(
      'auto',
      'web_search',
      undefined,
      [],
      'complete',
      true,
      undefined,
      false,
      provider,
    );
    const usage = { inputTokens: 20, outputTokens: 7, actualModel: 'failed-follow-up' };
    let round = 0;
    const spy =
      provider === 'ollama'
        ? vi.spyOn(localAdapter, 'streamOllamaText').mockImplementation(async (input) => {
            if (++round === 2)
              throw new localAdapter.OllamaError(
                'ai_stream_interrupted',
                503,
                'Interrupted',
                'Partial answer',
                usage,
              );
            return originalLocal(input);
          })
        : vi.spyOn(cloudAdapter, 'streamProviderText').mockImplementation(async (input) => {
            if (++round === 2)
              throw new cloudAdapter.ProviderStreamError(
                'ai_stream_interrupted',
                503,
                'Interrupted',
                'Partial answer',
                usage,
              );
            return originalCloud(input);
          });
    try {
      await expect(f.send()).rejects.toMatchObject({ code: 'ai_stream_interrupted' });
      const finish = f.calls.find((item) => item.sql.includes('ai_usage_finish'))!;
      expect(finish.params).toContain('failed');
      expect(finish.params).toContain(30);
      expect(finish.params).toContain(9);
      expect(f.calls.find((item) => item.sql.includes('ai_chat_finish'))?.params.slice(3)).toEqual([
        'Partial answer',
        'stopped',
      ]);
      expect(f.requests.filter((item) => item.url.includes('/search?'))).toHaveLength(1);
    } finally {
      spy.mockRestore();
    }
  },
);
