import type pg from 'pg';
import { expect, it, vi } from 'vitest';
import { AiWebSearchService } from './ai-web-search';
import { parseSearxResults } from './ai-web-search-provider';
import * as publicReader from './ai-web-page-reader';
import { aiAttachmentImageFixture } from './ai-attachments/validation.fixture';

it('persists bounded retrieval controls through the same revision-guarded settings write', async () => {
  const row = {
    enabled: true,
    weather_enabled: true,
    operations_per_hour: 100,
    revision: 4,
    results_limit: 8,
    pages_limit: 2,
    page_char_limit: 4500,
  };
  const query = vi.fn(async (sql: string, args: unknown[] = []) => {
    if (sql.includes('ai_web_search_retrieval_set'))
      Object.assign(row, {
        revision: 5,
        results_limit: args[9],
        pages_limit: args[10],
        page_char_limit: args[11],
      });
    return { rows: [row] };
  });
  const service = new AiWebSearchService({ query } as unknown as pg.Pool, vi.fn());
  const result = await service.save(
    'owner',
    {
      enabled: true,
      weatherEnabled: true,
      operationsPerHour: 100,
      configurationVersion: 4,
      resultsLimit: 12,
      pagesLimit: 0,
      pageCharLimit: 8000,
    },
    'request',
  );
  expect(result).toMatchObject({
    resultsLimit: 12,
    pagesLimit: 0,
    pageCharLimit: 8000,
    configurationVersion: 5,
  });
  expect(query.mock.calls.find(([sql]) => sql.includes('retrieval_set'))?.[1].slice(-3)).toEqual([
    12, 0, 8000,
  ]);
  const count = query.mock.calls.length;
  await expect(
    service.save(
      'owner',
      {
        enabled: true,
        weatherEnabled: true,
        operationsPerHour: 100,
        configurationVersion: 5,
        resultsLimit: 13,
      },
      'bad',
    ),
  ).rejects.toMatchObject({ code: 'ai_web_config_invalid' });
  expect(query.mock.calls.slice(count).some(([sql]) => sql.includes('_set'))).toBe(false);
});
it('respects result count, removes duplicate originals and prefers downloadable images', () => {
  const results = parseSearxResults(
    {
      results: [
        {
          url: 'https://a.example.org/one',
          title: 'Preview only',
          thumbnail_src: 'https://ts1.mm.bing.net/th?id=a',
        },
        {
          url: 'https://b.example.org/two',
          title: 'Full',
          thumbnail_src: 'https://ts1.mm.bing.net/th?id=b',
          img_src: 'https://images.example.org/full.jpg',
        },
        {
          url: 'https://c.example.org/three',
          title: 'Duplicate',
          thumbnail_src: 'https://ts1.mm.bing.net/th?id=c',
          img_src: 'https://images.example.org/full.jpg',
        },
      ],
    },
    true,
    1,
  );
  expect(results.images).toHaveLength(1);
  expect(results.images[0]).toMatchObject({
    title: 'Full',
    originalUrl: 'https://images.example.org/full.jpg',
  });
  expect(results.sources[0]?.url).toBe('https://b.example.org/two');
});
it('loads an original only from the exact owner receipt and rejects disguised SVG bytes', async () => {
  const query = vi.fn(async () => ({
    rows: [
      {
        value: {
          images: [
            {
              id: 1,
              originalUrl: 'https://images.example.org/full.png',
              thumbnailUrl: 'https://ts1.mm.bing.net/th?id=one',
            },
          ],
        },
      },
    ],
  }));
  const fetchImpl = vi.fn<typeof fetch>();
  const service = new AiWebSearchService({ query } as unknown as pg.Pool, fetchImpl);
  const read = vi
    .spyOn(publicReader, 'readPublicImage')
    .mockResolvedValue(aiAttachmentImageFixture('png'));
  try {
    const image = await service.image('owner', 'thread', 'request', 1, true);
    expect(image.mediaType).toBe('image/png');
    expect(query).toHaveBeenCalledWith('SELECT ai_web_search_evidence($1,$2,$3,$4) AS value', [
      'owner',
      'thread',
      'request',
      false,
    ]);
    expect(read).toHaveBeenCalledWith(
      'https://images.example.org/full.png',
      expect.any(AbortSignal),
    );
    read.mockResolvedValue(Buffer.from('<svg onload="alert(1)"/>'));
    await expect(service.image('owner', 'thread', 'request', 1, true)).rejects.toMatchObject({
      code: 'ai_web_image_unavailable',
    });
    const calls = read.mock.calls.length;
    await expect(service.image('other', 'thread', 'request', 12, true)).rejects.toMatchObject({
      status: 404,
    });
    expect(read).toHaveBeenCalledTimes(calls);
    expect(fetchImpl).not.toHaveBeenCalled();
  } finally {
    read.mockRestore();
  }
});
