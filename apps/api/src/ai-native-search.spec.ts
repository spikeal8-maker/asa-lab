import type pg from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { AiChatService } from './ai-chat.service';
import { imageSearchQueryAllowed } from './ai-web-search';
import { AiWebSearchService } from './ai-web-search';
import { aiUsageQueryFixture } from './testing/ai-usage-query.fixture';

const OWNER = '11111111-1111-4111-8111-111111111111';
const THREAD = '22222222-2222-4222-8222-222222222222';
const REQUEST = '33333333-3333-4333-8333-333333333333';

function fixture(
  mode: 'auto' | 'off',
  tool: 'web_search' | 'image_search' | 'weather' = 'web_search',
  toolQuery = 'Казань новости',
  disabledTools: readonly ('web_search' | 'image_search' | 'weather')[] = [],
  weatherVariant: 'complete' | 'partial' | 'ambiguous' | 'future' = 'complete',
  toolsCapable = true,
  userPrompt = tool === 'weather' ? 'Какая погода сейчас в Казани?' : 'Найди факты',
) {
  let admitted = false;
  let answer: string | null = null;
  const calls: { sql: string; params: unknown[] }[] = [];
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    const journal = aiUsageQueryFixture(sql);
    if (journal) return journal;
    if (sql.includes('to_regprocedure') && disabledTools.length) return { rows: [{ ready: true }] };
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
        rows: [
          { enabled: false, configuration_version: 1, provider: 'openai', model: 'gpt-6-luna' },
        ],
      };
    if (sql.includes('ai_ollama_runtime'))
      return {
        rows: [
          { enabled: true, base_url: 'http://127.0.0.1:11434', model: 'fixture:8b', revision: 1 },
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
    if (sql.includes('ai_web_text_begin')) {
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
    if (address.endsWith('/api/chat')) {
      const round = requests.filter((item) => item.url.endsWith('/api/chat')).length;
      const packet =
        round === 1 && mode === 'auto' && toolsCapable && disabledTools.length < 3
          ? {
              message: {
                tool_calls: [
                  {
                    function: {
                      name: tool,
                      arguments: tool === 'weather' ? { city: 'Казань' } : { query: toolQuery },
                    },
                  },
                ],
              },
              done: true,
              prompt_eval_count: 10,
              eval_count: 2,
              model: 'fixture:8b',
            }
          : {
              message: { content: 'Ответ по источнику' },
              done: true,
              prompt_eval_count: 20,
              eval_count: 5,
              model: 'fixture:8b',
            };
      return new Response(JSON.stringify(packet) + '\n');
    }
    if (address.includes('/search?'))
      return new Response(
        JSON.stringify({
          results: [{ title: 'Источник', url: 'https://example.org/news', content: 'Факт' }],
        }),
      );
    throw new Error('Unexpected network request: ' + address);
  });
  const service = new AiChatService({ query } as unknown as pg.Pool, { fetchImpl });
  const deltas: string[] = [];
  const send = () =>
    service.sendStream(
      OWNER,
      THREAD,
      userPrompt,
      REQUEST,
      (chunk) => deltas.push(chunk),
      new AbortController().signal,
      undefined,
      undefined,
      [],
      mode,
    );
  return { service, send, calls, requests, fetchImpl, deltas };
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
    expect(finalBody.tools).toBeUndefined();
    expect(JSON.stringify(finalBody.messages)).toContain('example.org/news');
    const finalSystem = (finalBody.messages as { role: string; content: string }[])[0]!.content;
    expect(finalSystem).not.toContain('Доступны native web_search, image_search');
    expect(finalSystem).toContain('callable_by_model');
    expect(finalSystem).toMatch(/callable_by_model\\?":\[\]/u);
    expect(f.calls.filter((item) => item.sql.includes('ai_web_search_finish'))).toHaveLength(1);
    expect(f.calls.filter((item) => item.sql.includes('ai_usage_begin'))).toHaveLength(1);
    const usage = f.calls.find((item) => item.sql.includes('ai_usage_finish'))!;
    expect(usage.params).toContain(30);
    expect(usage.params).toContain(7);
    const count = f.fetchImpl.mock.calls.length;
    expect((await f.send()).replayed).toBe(true);
    expect(f.fetchImpl).toHaveBeenCalledTimes(count);
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
