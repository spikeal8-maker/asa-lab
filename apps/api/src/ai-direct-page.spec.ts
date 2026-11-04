import type pg from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as reader from './ai-web-page-reader';
import { providedPageUrls } from './ai-web-search-provider';
import { nativeTools, parseNativeToolCalls } from './ai-native-tools';
import { AiWebSearchService } from './ai-web-search';
import { aiAttachmentImageFixture } from './ai-attachments/validation.fixture';

const URL = 'https://example.org/article';
const signal = () => new AbortController().signal;
function fixture(pagesLimit = 1, admission = 'ready', blocked: string[] = []) {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes('ai_web_search_runtime'))
      return {
        rows: [
          {
            enabled: true,
            weather_enabled: true,
            operations_per_hour: 100,
            revision: 1,
            allowed_domains: [],
            blocked_domains: blocked,
            results_limit: 6,
            pages_limit: pagesLimit,
            page_char_limit: 2500,
          },
        ],
      };
    if (sql.includes('ai_web_search_claim')) return { rows: [{ status: admission }] };
    return { rows: [] };
  });
  const network = vi.fn<typeof fetch>();
  return {
    query,
    network,
    service: new AiWebSearchService({ query } as unknown as pg.Pool, network),
  };
}
afterEach(() => vi.restoreAllMocks());

describe('explicit page URLs', () => {
  it('offers only safe addresses actually supplied by the user', () => {
    expect(providedPageUrls('Посмотри ' + URL + '). ' + URL)).toEqual([URL]);
    expect(providedPageUrls('https://127.0.0.1/ http://example.org/')).toEqual([]);
    expect(providedPageUrls('Не открывай ' + URL)).toEqual([]);
    const offered = nativeTools({ search: false, weather: false, pageUrls: [URL] });
    const call = (url: string) => [{ function: { name: 'read_page', arguments: { url } } }];
    expect(parseNativeToolCalls(call(URL), offered)[0]?.arguments).toEqual({ url: URL });
    expect(() => parseNativeToolCalls(call('https://invented.org/'), offered)).toThrow(
      'AI_TOOL_CALL_INVALID',
    );
    expect(() =>
      parseNativeToolCalls(
        [{ function: { name: 'read_page', arguments: { sourceIds: [1] } } }],
        offered,
      ),
    ).toThrow('AI_TOOL_CALL_INVALID');
  });
  it('claims before reading, freezes bounds, persists real text and never sends the URL to search', async () => {
    const f = fixture();
    const read = vi
      .spyOn(reader, 'readPublicDocument')
      .mockImplementation(async (_url, _signal, allowed, options) => {
        expect(f.query.mock.calls.some(([sql]) => sql.includes('ai_web_search_claim'))).toBe(true);
        expect(options?.textLimit).toBe(2500);
        expect(allowed(URL)).toBe(true);
        return {
          url: URL,
          text: 'Real article',
          images: [{ url: 'https://example.org/photo.png', alt: 'Photograph' }],
        };
      });
    const evidence = await f.service.prepare(
      'owner',
      'thread',
      'request',
      'Прочитай ' + URL,
      'auto',
      signal(),
    );
    expect(evidence?.sources[0]?.pageText).toBe('Real article');
    expect(evidence?.sources[0]?.pageImages).toHaveLength(1);
    expect(evidence?.retrievalOptions).toEqual({
      resultsLimit: 6,
      pagesLimit: 1,
      pageCharLimit: 2500,
    });
    expect(read).toHaveBeenCalledOnce();
    expect(f.network).not.toHaveBeenCalled();
    expect(f.query.mock.calls.filter(([sql]) => sql.includes('ai_web_search_finish'))).toHaveLength(
      1,
    );
  });
  it.each([
    [0, 'ready', []],
    [1, 'limited', []],
    [1, 'replay', []],
    [1, 'ready', ['example.org']],
  ] as const)(
    'does not fetch when reading is disabled, limited, replayed or domain-blocked (%s %s)',
    async (pages, admission, blocked) => {
      const read = vi.spyOn(reader, 'readPublicDocument');
      const f = fixture(pages, admission, [...blocked]);
      await f.service.prepareDirect('owner', 'thread', 'request', URL, signal());
      expect(read).not.toHaveBeenCalled();
      expect(f.network).not.toHaveBeenCalled();
    },
  );
  it('passes actual validated raster bytes to Vision and respects the remaining attachment budget', async () => {
    const f = fixture();
    const bytes = aiAttachmentImageFixture('png');
    const read = vi.spyOn(reader, 'readPublicImage').mockResolvedValue(bytes);
    const evidence = {
      schemaVersion: 1 as const,
      provider: 'searxng' as const,
      mode: 'web' as const,
      status: 'ready' as const,
      query: 'Page',
      retrievedAt: new Date().toISOString(),
      images: [],
      sources: [
        {
          id: 1,
          title: 'Page',
          hostname: 'example.org',
          url: URL,
          snippet: '',
          pageRead: 'read' as const,
          pageImages: [{ url: 'https://example.org/photo.png', alt: 'Image' }],
        },
      ],
    };
    const input = await f.service.pageImageInput(evidence, signal(), 1, bytes.length);
    expect(input.raw).toEqual([bytes.toString('base64')]);
    expect(input.urls[0]).toBe('data:image/png;base64,' + bytes.toString('base64'));
    expect(input.context).toContain('не полный визуальный просмотр');
    expect((await f.service.pageImageInput(evidence, signal(), 1, bytes.length - 1)).raw).toEqual(
      [],
    );
    read.mockClear();
    expect((await f.service.pageImageInput(evidence, signal(), 0, 12000000)).raw).toEqual([]);
    expect(read).not.toHaveBeenCalled();
  });
});
