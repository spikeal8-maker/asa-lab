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
import {
  AiWebSearchService,
  internetIntent,
  webEvidenceContext,
  weatherCityFromPrompt,
} from './ai-web-search';

it('extracts a supplied weather city without mistaking tense or Russian case for a missing location', () => {
  expect(cityQuery(weatherCityFromPrompt('какая погода сейчас в москве?')!)).toBe('Москва');
  expect(cityQuery(weatherCityFromPrompt('Погода в Казани завтра')!)).toBe('Казань');
  expect(weatherCityFromPrompt('Прогноз погоды сейчас будет в Нижнем Новгороде?')).toBe(
    'Нижнем Новгороде',
  );
  expect(weatherCityFromPrompt('Какая погода сейчас?')).toBeUndefined();
  expect(cityQuery('Лесная улица')).toBeNull();
});

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
it('bounds raw provider counts and records partial engine failures without exposing engine details', () => {
  const parsed = parseSearxResults(
    {
      results: [{ title: 'Учебный источник', url: 'https://example.org/lesson' }],
      unresponsive_engines: [
        ['bing', 'timeout'],
        ['duckduckgo', 'error'],
      ],
    },
    false,
  );
  expect(parsed.rawCount).toBe(1);
  expect(parsed.engineFailureCount).toBe(2);
  expect(parsed.sources).toHaveLength(1);
  expect(parsed).not.toHaveProperty('unresponsive_engines');
  expect(
    parseSearxResults({ results: Array.from({ length: 100 }, () => ({})) }, false).rawCount,
  ).toBe(32);
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
  expect(searchThumbnailUrl('https://ts4.mm.bing.net/th?id=OIP.example&pid=15.1')).toBeTruthy();
  expect(searchThumbnailUrl('https://ts2.mm.bing.net/th?id=OIP.example&pid=15.1')).toBeTruthy();
  expect(searchThumbnailUrl('https://external-content.duckduckgo.com/iu/?u=image')).toBeTruthy();
  expect(searchThumbnailUrl('https://th.bing.com.evil.org/i.jpg')).toBeNull();
  expect(searchThumbnailUrl('https://ts4.mm.bing.net.evil.org/th?id=a')).toBeNull();
  expect(searchThumbnailUrl('https://sub.ts4.mm.bing.net/th?id=a')).toBeNull();
  expect(searchThumbnailUrl('https://ts10.mm.bing.net/th?id=a')).toBeNull();
  expect(searchThumbnailUrl('https://127.0.0.1/th?id=a')).toBeNull();
  expect(searchThumbnailUrl('http://ts4.mm.bing.net/th?id=a')).toBeNull();
  expect(searchThumbnailUrl('https://user:pass@ts4.mm.bing.net/th?id=a')).toBeNull();
  expect(searchThumbnailUrl('https://ts4.mm.bing.net/preview.svg')).toBeNull();
  expect(searchThumbnailUrl('https://upload.wikimedia.org/file.svg')).toBeNull();
  expect(searchThumbnailUrl('https://publisher.example/image.jpg')).toBeNull();
});
it('keeps Bing ts thumbnails from raw Searx image results as gallery metadata', () => {
  const results = parseSearxResults(
    {
      results: [
        {
          title: 'Сибирская кошка 1',
          url: 'https://example.org/cats/one',
          thumbnail_src: 'https://ts4.mm.bing.net/th?id=OIP.one&pid=15.1',
          img_src: 'https://untrusted.example/raw-one.jpg',
        },
        {
          title: 'Сибирская кошка 2',
          url: 'https://example.org/cats/two',
          thumbnail_src: 'https://ts2.mm.bing.net/th?id=OIP.two&pid=15.1',
          img_src: 'https://untrusted.example/raw-two.jpg',
        },
      ],
    },
    true,
  );
  expect(results.images).toEqual([
    {
      id: 1,
      title: 'Сибирская кошка 1',
      sourceUrl: 'https://example.org/cats/one',
      thumbnailUrl: 'https://ts4.mm.bing.net/th?id=OIP.one&pid=15.1',
    },
    {
      id: 2,
      title: 'Сибирская кошка 2',
      sourceUrl: 'https://example.org/cats/two',
      thumbnailUrl: 'https://ts2.mm.bing.net/th?id=OIP.two&pid=15.1',
    },
  ]);
  expect(results.images.every((image) => searchThumbnailUrl(image.thumbnailUrl))).toBe(true);
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
it('uses a containing city relation for the real 7 km Novosibirsk duplicate', async () => {
  const candidates = [
    {
      name: 'Новосибирск',
      addresstype: 'city',
      osm_type: 'node',
      lat: '55.0288307',
      lon: '82.9226887',
      address: { city: 'Новосибирск', state: 'Новосибирская область', country: 'Россия' },
    },
    {
      name: 'Новосибирск',
      addresstype: 'city',
      osm_type: 'relation',
      lat: '54.9678145',
      lon: '82.9515989',
      boundingbox: ['54.8', '55.2', '82.7', '83.2'],
      address: { city: 'Новосибирск', state: 'Новосибирская область', country: 'Россия' },
    },
  ];
  expect(parseCityCandidates(candidates)).toEqual([
    {
      name: 'Новосибирск, Новосибирская область, Россия',
      lat: 54.9678145,
      lon: 82.9515989,
    },
  ]);
  expect(parseCityCandidates([...candidates].reverse())).toEqual(parseCityCandidates(candidates));
  const c = cache();
  const fetchImpl = vi.fn<typeof fetch>(
    async (url) =>
      new Response(JSON.stringify(String(url).includes('nominatim') ? candidates : met)),
  );
  const result = await new FreeInternetProvider(fetchImpl, c).weather(
    'Новосибирск',
    new AbortController().signal,
  );
  expect(result.choices).toBeUndefined();
  expect(result.weather?.location).toBe('Новосибирск, Новосибирская область, Россия');
  expect(String(fetchImpl.mock.calls[1]?.[0])).toContain('lat=54.9678&lon=82.9516');
  const geocodeKey = vi.mocked(c.claim).mock.calls[0]?.[1];
  expect(geocodeKey).toMatch(/^v2:[a-f0-9]{64}$/);
  expect(geocodeKey).not.toBe('новосибирск');
  expect(c.save).toHaveBeenCalledWith(
    'geocode',
    geocodeKey,
    parseCityCandidates(candidates),
    expect.any(String),
    undefined,
    undefined,
  );
});
it('does not merge distant homonyms outside city bounds or from oversized/malformed bounds', () => {
  const first = {
    addresstype: 'city',
    osm_type: 'node',
    lat: '55.0288307',
    lon: '82.9226887',
    address: { city: 'Новосибирск', state: 'Новосибирская область', country: 'Россия' },
  };
  const relation = {
    addresstype: 'city',
    osm_type: 'relation',
    lat: '54.9678145',
    lon: '82.9515989',
    address: first.address,
  };
  for (const boundingbox of [
    ['54.8', '55.0', '82.7', '83.2'],
    ['-80', '80', '-170', '170'],
    ['54.8', 'not-a-coordinate', '82.7', '83.2'],
    ['54.8', '', '82.7', '83.2'],
  ])
    expect(parseCityCandidates([first, { ...relation, boundingbox }])).toHaveLength(2);
});
it('rejects a nearly worldwide longitude span before shortest-arc distance and keeps a real ambiguity', async () => {
  const candidates = [
    {
      addresstype: 'city',
      osm_type: 'node',
      lat: '0',
      lon: '0',
      address: { city: 'Мир', country: 'Россия' },
    },
    {
      addresstype: 'city',
      osm_type: 'relation',
      lat: '0',
      lon: '179.9',
      boundingbox: ['-0.1', '0.1', '-179.9', '179.9'],
      address: { city: 'Мир', country: 'Россия' },
    },
  ];
  expect(parseCityCandidates(candidates)).toHaveLength(2);
  const c = cache();
  const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(candidates)));
  const result = await new FreeInternetProvider(fetchImpl, c).weather(
    'Мир',
    new AbortController().signal,
  );
  expect(result.choices).toHaveLength(2);
  expect(result.weather).toBeUndefined();
  expect(fetchImpl).toHaveBeenCalledOnce();
  expect(c.claim).toHaveBeenCalledTimes(1);
});
it('keeps distant same-name places and distinct regions separate', async () => {
  const candidates = [
    { addresstype: 'city', lat: '58', lon: '49', address: { city: 'Киров', country: 'Россия' } },
    { addresstype: 'city', lat: '54', lon: '34', address: { city: 'Киров', country: 'Россия' } },
    {
      addresstype: 'city',
      lat: '58.001',
      lon: '49.001',
      address: { city: 'Киров', state: 'Кировская область', country: 'Россия' },
    },
  ];
  expect(parseCityCandidates(candidates)).toHaveLength(3);
  expect(parseCityCandidates(candidates).at(-1)?.name).toBe('Киров, Кировская область, Россия');
  const c = cache();
  vi.mocked(c.claim).mockResolvedValueOnce({
    state: 'fresh',
    body: parseCityCandidates(candidates.slice(0, 2)),
  });
  const fetchImpl = vi.fn<typeof fetch>();
  const result = await new FreeInternetProvider(fetchImpl, c).weather(
    'Киров',
    new AbortController().signal,
  );
  expect(result.choices).toHaveLength(2);
  expect(result.weather).toBeUndefined();
  expect(fetchImpl).not.toHaveBeenCalled();
});
it('collapses nearby duplicate cities from a v2 geocode cache before claiming weather', async () => {
  const c = cache();
  vi.mocked(c.claim)
    .mockResolvedValueOnce({
      state: 'fresh',
      body: [
        { name: 'Новосибирск, Новосибирская область, Россия', lat: 55.029, lon: 82.921 },
        { name: 'Новосибирск, Новосибирская область, Россия', lat: 55.03, lon: 82.92 },
      ],
    })
    .mockResolvedValueOnce({ state: 'fresh', body: met });
  const fetchImpl = vi.fn<typeof fetch>();
  const result = await new FreeInternetProvider(fetchImpl, c).weather(
    'Новосибирск',
    new AbortController().signal,
  );
  expect(result.weather?.location).toBe('Новосибирск, Новосибирская область, Россия');
  expect(result.choices).toBeUndefined();
  expect(fetchImpl).not.toHaveBeenCalled();
});
it('uses bounded distinct v2 geocode keys even for 100-character city names', async () => {
  const c = cache();
  vi.mocked(c.claim).mockResolvedValue({ state: 'fresh', body: [] });
  const provider = new FreeInternetProvider(vi.fn<typeof fetch>(), c);
  await provider.weather('А'.repeat(99) + 'Б', new AbortController().signal);
  await provider.weather('А'.repeat(99) + 'В', new AbortController().signal);
  const keys = vi.mocked(c.claim).mock.calls.map(([, key]) => key);
  expect(keys).toHaveLength(2);
  expect(keys[0]).toMatch(/^v2:[a-f0-9]{64}$/);
  expect(keys[0]).not.toBe(keys[1]);
  expect(keys.every((key) => key.length <= 100)).toBe(true);
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
it('runs only fixed neutral admin probes and distinguishes upstream empty from domain filtering', async () => {
  const pool = {
    query: vi.fn(async () => ({
      rows: [
        {
          enabled: false,
          weather_enabled: false,
          operations_per_hour: 100,
          revision: 4,
          allowed_domains: [],
          blocked_domains: ['example.org'],
        },
      ],
    })),
  } as unknown as pg.Pool;
  const fetchImpl = vi.fn<typeof fetch>(
    async (url) =>
      new Response(
        JSON.stringify({
          results: String(url).includes('categories=images')
            ? [{ title: 'Учебный источник', url: 'https://example.org/lesson' }]
            : [],
        }),
      ),
  );
  const service = new AiWebSearchService(pool, fetchImpl);
  const result = await service.probe('administrator');
  expect(result.modes.map(({ status }) => status)).toEqual(['empty', 'filtered']);
  expect(result.modes[0]?.diagnostics).toMatchObject({ rawCount: 0, validatedCount: 0 });
  expect(result.modes[1]?.diagnostics).toMatchObject({
    rawCount: 1,
    validatedCount: 1,
    postDomainCount: 0,
  });
  expect(fetchImpl).toHaveBeenCalledTimes(2);
  for (const [url] of fetchImpl.mock.calls) {
    const parsed = new URL(String(url));
    expect(parsed.searchParams.get('q')).toBe('наука образование');
    expect(parsed.searchParams.get('safesearch')).toBe('2');
    expect(parsed.searchParams.get('engines')).toMatch(/bing/);
  }
  expect(vi.mocked(pool.query)).toHaveBeenCalledTimes(1);
  await expect(service.probe('administrator')).rejects.toMatchObject({
    code: 'ai_web_probe_limited',
    status: 429,
  });
  expect(fetchImpl).toHaveBeenCalledTimes(2);
});
it('does not treat partial engine failure or invalid rows as proof of no web results', async () => {
  const pool = {
    query: vi.fn(async () => ({ rows: [{ enabled: true, revision: 1 }] })),
  } as unknown as pg.Pool;
  const fetchImpl = vi.fn<typeof fetch>(
    async (url) =>
      new Response(
        JSON.stringify(
          String(url).includes('categories=images')
            ? { results: [{ url: 'http://127.0.0.1/private' }] }
            : { results: [], unresponsive_engines: [['bing', 'timeout']] },
        ),
      ),
  );
  const result = await new AiWebSearchService(pool, fetchImpl).probe('administrator');
  expect(result.modes.map(({ status }) => status)).toEqual(['partial', 'invalid']);
  expect(result.modes[0]?.diagnostics?.engineFailureCount).toBe(1);
  expect(result.modes[1]?.diagnostics).toMatchObject({ rawCount: 1, validatedCount: 0 });
});
it('classifies all 32 bounded candidates before applying the eight-source display limit', async () => {
  const pool = {
    query: vi.fn(async () => ({
      rows: [{ enabled: true, revision: 1, blocked_domains: ['blocked.example.org'] }],
    })),
  } as unknown as pg.Pool;
  const fetchImpl = vi.fn<typeof fetch>(
    async () =>
      new Response(
        JSON.stringify({
          results: [
            ...Array.from({ length: 8 }, (_, index) => ({
              url: `https://blocked.example.org/${index}`,
            })),
            { url: 'https://allowed.example.org/ninth' },
          ],
        }),
      ),
  );
  const result = await new AiWebSearchService(pool, fetchImpl).probe('administrator');
  expect(result.modes[0]).toMatchObject({
    status: 'results',
    diagnostics: { rawCount: 9, validatedCount: 9, postDomainCount: 1 },
  });
});
