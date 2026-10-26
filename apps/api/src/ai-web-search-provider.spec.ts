import type pg from 'pg';
import { describe, expect, it, vi } from 'vitest';
import {
  FreeInternetProvider,
  boundedWebResponse,
  cityQuery,
  normalizeMetForecast,
  parseCityCandidates,
  parseSearxResults,
  publicWebUrl,
  searchThumbnailUrl,
  type PublicWeatherCache,
} from './ai-web-search-provider';
import { AiWebSearchService, internetIntent, webEvidenceContext } from './ai-web-search';

const city = { name: 'Казань, Татарстан, Россия', lat: 55.7961, lon: 49.1064 };
const met = {
  properties: {
    meta: {
      updated_at: '2026-10-25T12:00:00Z',
      units: {
        air_temperature: 'celsius',
        relative_humidity: '%',
        wind_speed: 'm/s',
        air_pressure_at_sea_level: 'hPa',
      },
    },
    timeseries: [
      {
        time: '2026-10-25T13:00:00Z',
        data: {
          instant: {
            details: {
              air_temperature: 4,
              relative_humidity: 80,
              wind_speed: 3,
              air_pressure_at_sea_level: 1018,
            },
          },
        },
      },
    ],
  },
};
const cache = (): PublicWeatherCache => ({
  claim: vi.fn(async () => ({ state: 'fetch' as const })),
  save: vi.fn(async () => undefined),
});

it('preserves source order, normalizes plain text and skips only unsafe previews', () => {
  expect(
    parseSearxResults(
      {
        results: [
          { title: 'Один', url: 'https://example.org/one', content: '<b>Данные</b>' },
          {
            title: 'Два',
            url: 'https://example.org/two',
            thumbnail_src: 'https://tse1.mm.bing.net/th?id=one',
          },
          {
            title: 'Три',
            url: 'https://example.org/three',
            thumbnail_src: 'https://arbitrary.invalid/img.svg',
          },
        ],
      },
      true,
    ),
  ).toMatchObject({
    sources: [
      { id: 1, title: 'Один', snippet: 'Данные' },
      { id: 2, title: 'Два' },
      { id: 3, title: 'Три' },
    ],
    images: [{ id: 1, title: 'Два', sourceUrl: 'https://example.org/two' }],
  });
});
it.each([
  'https://127.0.0.1/',
  'https://2130706433/',
  'https://localhost./',
  'https://[::1]/',
  'https://user:password@example.org/',
  'http://example.org/',
  'javascript:alert(1)',
  'https://example.org:8080/',
])('rejects unsafe public source: %s', (url) => expect(publicWebUrl(url)).toBeNull());
it('uses a closed raster CDN host list, never arbitrary originals', () => {
  expect(searchThumbnailUrl('https://tse1.mm.bing.net/th?id=a')).toBeTruthy();
  expect(searchThumbnailUrl('https://external-content.duckduckgo.com/iu/?u=image')).toBeTruthy();
  expect(searchThumbnailUrl('https://th.bing.com.evil.org/i.jpg')).toBeNull();
  expect(searchThumbnailUrl('https://upload.wikimedia.org/file.svg')).toBeNull();
  expect(searchThumbnailUrl('https://publisher.example/image.jpg')).toBeNull();
});
it('bounds actual streamed bytes', async () =>
  await expect(boundedWebResponse(new Response('123456'), 5)).rejects.toThrow());
it('sends SearxNG only the fixed safe search parameters and no credentials', async () => {
  const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ results: [] })));
  await new FreeInternetProvider(fetchImpl, cache(), {
    searchEndpoint: 'http://search:8080',
  }).search('Казань', true, new AbortController().signal);
  const [url, options] = fetchImpl.mock.calls[0]!,
    parsed = new URL(String(url));
  expect(parsed.origin + parsed.pathname).toBe('http://search:8080/search');
  expect(Object.fromEntries(parsed.searchParams)).toEqual({
    q: 'Казань',
    format: 'json',
    language: 'ru-RU',
    safesearch: '2',
    categories: 'images',
    engines: 'bing images,duckduckgo images',
  });
  expect(options?.redirect).toBe('error');
  expect(new Headers(options?.headers).has('authorization')).toBe(false);
});
it('normalizes model forecast units and does not invent an observedAt', () => {
  expect(normalizeMetForecast(met, city)).toMatchObject({
    provider: 'met-norway',
    forecastUpdatedAt: '2026-10-25T12:00:00.000Z',
    forecastAt: '2026-10-25T13:00:00.000Z',
    temperatureC: 4,
    hours: [{ temperatureC: 4, pressureHpa: 1018, humidityPercent: 80 }],
  });
  expect(normalizeMetForecast(met, city)).not.toHaveProperty('observedAt');
  expect(() =>
    normalizeMetForecast(
      {
        ...met,
        properties: {
          ...met.properties,
          meta: { ...met.properties.meta, units: { air_temperature: 'fahrenheit' } },
        },
      },
      city,
    ),
  ).toThrow();
});
it.each(['ул Ленина 1', '55.75,37.62', 'my street', 'a'])(
  'does not turn weather into an address/autocomplete API: %s',
  (q) => expect(cityQuery(q)).toBeNull(),
);
it('does not select the first ambiguous city or fetch a forecast', async () => {
  const c = cache(),
    fetchImpl = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify([
            {
              name: 'Киров',
              addresstype: 'city',
              lat: '58',
              lon: '49',
              address: { city: 'Киров', state: 'Кировская область', country: 'Россия' },
            },
            {
              name: 'Киров',
              addresstype: 'town',
              lat: '54',
              lon: '34',
              address: { town: 'Киров', state: 'Калужская область', country: 'Россия' },
            },
          ]),
        ),
    );
  const result = await new FreeInternetProvider(fetchImpl, c).weather(
    'Киров',
    new AbortController().signal,
  );
  expect(result.choices).toHaveLength(2);
  expect(fetchImpl).toHaveBeenCalledOnce();
  expect(new Headers(fetchImpl.mock.calls[0]![1]?.headers).get('user-agent')).toContain(
    'github.com/spikeal8-maker/asa-lab',
  );
  expect(String(fetchImpl.mock.calls[0]![0])).toContain('nominatim.openstreetmap.org/search?');
});
it('rejects non-city geocoder results and malformed coordinates', () => {
  expect(
    parseCityCandidates([
      { addresstype: 'house', lat: '55', lon: '49' },
      { addresstype: 'city', lat: 'NaN', lon: '49' },
    ]),
  ).toEqual([]);
});
it('uses shared cached city and Expires forecast without any upstream fetch', async () => {
  const c = cache(),
    fetchImpl = vi.fn<typeof fetch>();
  vi.mocked(c.claim)
    .mockResolvedValueOnce({ state: 'fresh', body: [city] })
    .mockResolvedValueOnce({ state: 'fresh', body: met });
  expect(
    (await new FreeInternetProvider(fetchImpl, c).weather('Казань', new AbortController().signal))
      .weather?.temperatureC,
  ).toBe(4);
  expect(fetchImpl).not.toHaveBeenCalled();
});
it('revalidates stale forecast with If-Modified-Since and honors 304/Expires', async () => {
  const c = cache(),
    fetchImpl = vi.fn<typeof fetch>(
      async () =>
        new Response(null, {
          status: 304,
          headers: { expires: new Date(Date.now() + 3600000).toUTCString() },
        }),
    );
  vi.mocked(c.claim)
    .mockResolvedValueOnce({ state: 'fresh', body: [city] })
    .mockResolvedValueOnce({
      state: 'fetch',
      body: met,
      lastModified: 'Sun, 25 Oct 2026 12:00:00 GMT',
    });
  expect(
    (await new FreeInternetProvider(fetchImpl, c).weather('Казань', new AbortController().signal))
      .weather?.temperatureC,
  ).toBe(4);
  expect(new Headers(fetchImpl.mock.calls[0]![1]?.headers).get('if-modified-since')).toBe(
    'Sun, 25 Oct 2026 12:00:00 GMT',
    undefined,
  );
  expect(c.save).toHaveBeenCalledWith(
    'weather',
    '55.7961,49.1064',
    met,
    expect.any(String),
    'Sun, 25 Oct 2026 12:00:00 GMT',
    undefined,
  );
});
it('refuses arbitrary MET redirect targets', async () => {
  const c = cache(),
    fetchImpl = vi.fn<typeof fetch>(
      async () =>
        new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/private' } }),
    );
  vi.mocked(c.claim)
    .mockResolvedValueOnce({ state: 'fresh', body: [city] })
    .mockResolvedValueOnce({ state: 'fetch' });
  await expect(
    new FreeInternetProvider(fetchImpl, c).weather('Казань', new AbortController().signal),
  ).rejects.toThrow();
  expect(fetchImpl).toHaveBeenCalledOnce();
});
it('does not access the public geocoder when global admission is limited', async () => {
  const c = cache(),
    fetchImpl = vi.fn<typeof fetch>();
  vi.mocked(c.claim).mockResolvedValue({ state: 'limited' });
  await expect(
    new FreeInternetProvider(fetchImpl, c).weather('Казань', new AbortController().signal),
  ).rejects.toThrow();
  expect(fetchImpl).not.toHaveBeenCalled();
});
describe('minimal query intent', () => {
  it.each([
    'сегодня мне плохо, поддержи',
    'сейчас исправь мой код',
    'найди ошибку в моём коде',
    '```js\nнайди пароль\n```',
  ])('does not exfiltrate private prompts: %s', (text) =>
    expect(internetIntent(text, 'auto')).toBeNull(),
  );
  it('recognizes intended facts/images/weather and explicit off', () => {
    expect(internetIntent('Найди последние новости науки', 'auto')).toBe('web');
    expect(internetIntent('Найди фото Казани', 'auto')).toBe('images');
    expect(internetIntent('Погода в Казани', 'auto')).toBe('weather');
    expect(internetIntent('Погода в Казани', 'off')).toBeNull();
  });
  it('marks evidence untrusted and does not claim fresh knowledge after failure', () => {
    expect(
      webEvidenceContext({
        schemaVersion: 1,
        provider: 'searxng',
        mode: 'web',
        status: 'unavailable',
        query: 'новости',
        retrievedAt: '2026-10-25T12:00:00Z',
        sources: [],
        images: [],
        reason: 'provider_unavailable',
      }),
    ).toContain('свежие данные не проверены');
  });
});
it('rejects paid API keys and endpoints in free admin configuration', async () => {
  const pool = { query: vi.fn() } as unknown as pg.Pool,
    service = new AiWebSearchService(pool);
  await expect(
    service.save(
      'owner',
      {
        enabled: true,
        weatherEnabled: true,
        operationsPerHour: 100,
        configurationVersion: 1,
        apiKey: 'not-accepted',
      } as never,
      'test',
    ),
  ).rejects.toMatchObject({ code: 'ai_web_config_invalid' });
  expect(pool.query).not.toHaveBeenCalled();
});
