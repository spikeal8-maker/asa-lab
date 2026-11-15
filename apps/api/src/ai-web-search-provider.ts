import type { AiWebImage, AiWebSource, AiWebWeather } from '@asa-lab/contracts';
import { createHash } from 'node:crypto';

const MAX_BODY = 2 * 1024 * 1024;
const USER_AGENT = 'ASA-Lab/1.0 (+https://github.com/spikeal8-maker/asa-lab)';
export class AiWebProviderError extends Error {
  constructor() {
    super('Internet provider unavailable');
  }
}
export interface PublicCacheReceipt {
  readonly state: 'fresh' | 'fetch' | 'busy' | 'limited';
  readonly body?: unknown;
  readonly lastModified?: string;
  readonly lease?: string;
  readonly fetchUntil?: string;
}
export interface PublicWeatherCache {
  claim(kind: 'geocode' | 'weather', key: string): Promise<PublicCacheReceipt>;
  save(
    kind: 'geocode' | 'weather',
    key: string,
    body: unknown,
    expiresAt: string,
    lastModified?: string,
    lease?: string,
  ): Promise<void>;
}
interface City {
  readonly name: string;
  readonly lat: number;
  readonly lon: number;
}
function plain(value: unknown, max: number): string {
  return typeof value === 'string'
    ? value
        .replace(/<[^>]{0,1000}>/g, ' ')
        .replace(/\p{Cc}/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, max)
    : '';
}
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
export function trustedServiceBase(value: string | undefined, defaultValue: string): string | null {
  try {
    const u = new URL(value === undefined ? defaultValue : value);
    if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.search || u.hash)
      return null;
    return u.href.replace(/\/+$/, '') + '/';
  } catch {
    return null;
  }
}
export function searchThumbnailUrl(value: unknown): string | null {
  const safe = publicWebUrl(value);
  if (!safe) return null;
  const u = new URL(safe);
  if (u.pathname.toLowerCase().endsWith('.svg')) return null;
  return u.hostname === 'th.bing.com' ||
    /^ts(?:e)?[1-4]\.mm\.bing\.net$/.test(u.hostname) ||
    u.hostname === 'external-content.duckduckgo.com' ||
    u.hostname === 'upload.wikimedia.org'
    ? u.href
    : null;
}
export function parseSearxResults(
  value: unknown,
  imageMode: boolean,
  limit = 8,
): { sources: AiWebSource[]; images: AiWebImage[] } {
  const data = record(value);
  if (!Array.isArray(data['results'])) throw new AiWebProviderError();
  const sources: AiWebSource[] = [],
    images: AiWebImage[] = [],
    seen = new Set<string>();
  const seenImages = new Set<string>();
  const count = Math.max(1, Math.min(12, limit));
  for (const raw of data['results'].slice(0, 48)) {
    const item = record(raw),
      url = publicWebUrl(item['url']);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const title = plain(item['title'], 240) || new URL(url).hostname;
    sources.push({
      id: sources.length + 1,
      title,
      url,
      hostname: new URL(url).hostname,
      snippet: plain(item['content'], 1200),
    });
    if (imageMode) {
      const thumbnailUrl = searchThumbnailUrl(item['thumbnail_src']);
      const originalUrl = publicWebUrl(item['img_src']);
      const identity = originalUrl ?? thumbnailUrl;
      if (thumbnailUrl && identity && !seenImages.has(identity)) {
        seenImages.add(identity);
        images.push({
          id: images.length + 1,
          title,
          sourceUrl: url,
          thumbnailUrl,
          ...(originalUrl ? { originalUrl } : {}),
        });
      }
    }
    if (!imageMode && sources.length === count) break;
  }
  if (!imageMode) return { sources: sources.slice(0, count), images };
  // Keep relevance order within each group, prefer an available original, and remove duplicates.
  const selected = images
    .sort((a, b) => Number(!!b.originalUrl) - Number(!!a.originalUrl))
    .slice(0, count)
    .map((image, index) => ({ ...image, id: index + 1 }));
  return {
    images: selected,
    sources: selected.flatMap((image, index) => {
      const source = sources.find((item) => item.url === image.sourceUrl);
      return source ? [{ ...source, id: index + 1 }] : [];
    }),
  };
}
function cityLabel(item: Record<string, unknown>): string {
  const address = record(item['address']);
  return (
    [
      ...new Set(
        [
          address['city'] ?? address['town'] ?? address['village'] ?? item['name'],
          address['state'],
          address['country'],
        ]
          .filter((v): v is string => typeof v === 'string')
          .map((v) => plain(v, 100)),
      ),
    ]
      .join(', ')
      .slice(0, 100) || plain(item['display_name'], 100)
  );
}
const SAME_CITY_RADIUS_KM = 3;
interface CityCandidate {
  readonly city: City;
  readonly cityRelation: boolean;
  readonly bounds: readonly [number, number, number, number] | null;
}

function distanceKm(a: City, b: City): number {
  const radians = Math.PI / 180;
  const latitude = (b.lat - a.lat) * radians;
  const longitude = (b.lon - a.lon) * radians;
  const arc =
    Math.sin(latitude / 2) ** 2 +
    Math.cos(a.lat * radians) * Math.cos(b.lat * radians) * Math.sin(longitude / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(arc)));
}

function nearbySameCity(a: City, b: City): boolean {
  if (
    a.name.normalize('NFKC').toLocaleLowerCase('ru') !==
    b.name.normalize('NFKC').toLocaleLowerCase('ru')
  )
    return false;
  return distanceKm(a, b) <= SAME_CITY_RADIUS_KM;
}

function cityBounds(value: unknown): CityCandidate['bounds'] {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const [south = NaN, north = NaN, west = NaN, east = NaN] = value.map((part) =>
    typeof part === 'number' || (typeof part === 'string' && part.trim()) ? Number(part) : NaN,
  );
  if (
    !Number.isFinite(south) ||
    !Number.isFinite(north) ||
    !Number.isFinite(west) ||
    !Number.isFinite(east) ||
    south < -90 ||
    north > 90 ||
    west < -180 ||
    east > 180 ||
    south > north ||
    west > east ||
    east - west > 180 ||
    distanceKm({ name: '', lat: south, lon: west }, { name: '', lat: north, lon: west }) > 150 ||
    distanceKm({ name: '', lat: south, lon: west }, { name: '', lat: south, lon: east }) > 150 ||
    distanceKm({ name: '', lat: north, lon: west }, { name: '', lat: north, lon: east }) > 150
  )
    return null;
  return [south, north, west, east];
}

function relationContains(relation: CityCandidate, other: CityCandidate): boolean {
  if (!relation.cityRelation || !relation.bounds) return false;
  const [south, north, west, east] = relation.bounds;
  return (
    other.city.lat >= south &&
    other.city.lat <= north &&
    other.city.lon >= west &&
    other.city.lon <= east
  );
}

function sameCityCandidate(a: CityCandidate, b: CityCandidate): boolean {
  return (
    a.city.name.normalize('NFKC').toLocaleLowerCase('ru') ===
      b.city.name.normalize('NFKC').toLocaleLowerCase('ru') &&
    (nearbySameCity(a.city, b.city) || relationContains(a, b) || relationContains(b, a))
  );
}

function dedupeNearbyCities(cities: readonly City[]): City[] {
  const unique: City[] = [];
  for (const city of cities)
    if (!unique.some((other) => nearbySameCity(other, city))) unique.push(city);
  return unique;
}

export function parseCityCandidates(value: unknown): City[] {
  if (!Array.isArray(value)) throw new AiWebProviderError();
  const results: CityCandidate[] = [];
  for (const raw of value.slice(0, 3)) {
    const item = record(raw),
      kind = item['addresstype'];
    if (!['city', 'town', 'village', 'municipality', 'hamlet', 'borough'].includes(kind as string))
      continue;
    const lat = Number(item['lat']),
      lon = Number(item['lon']),
      name = cityLabel(item);
    if (
      !name ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lon) ||
      Math.abs(lat) > 90 ||
      Math.abs(lon) > 180
    )
      continue;
    const candidate = { name, lat, lon };
    const cityRelation = item['osm_type'] === 'relation' && kind === 'city';
    const parsed: CityCandidate = {
      city: candidate,
      cityRelation,
      bounds: cityRelation ? cityBounds(item['boundingbox']) : null,
    };
    const duplicate = results.findIndex((result) => sameCityCandidate(result, parsed));
    if (duplicate < 0) results.push(parsed);
    else if (cityRelation && !results[duplicate]!.cityRelation) results[duplicate] = parsed;
  }
  return results.map((result) => result.city);
}
export function cityQuery(value: string): string | null {
  const city = value.trim().normalize('NFKC');
  if (
    city.length < 2 ||
    city.length > 100 ||
    !/^[\p{L} .,'’—-]+$/u.test(city) ||
    /улиц|проспект|квартир|адрес|street|avenue|\broad\b/iu.test(city)
  )
    return null;
  // A place name in a Russian question is often in the prepositional case.
  // Resolve known aliases, never guess coordinates or strip arbitrary suffixes.
  const aliases: Record<string, string> = {
    москве: 'Москва',
    'санкт-петербурге': 'Санкт-Петербург',
    петербурге: 'Санкт-Петербург',
    казани: 'Казань',
    екатеринбурге: 'Екатеринбург',
    новосибирске: 'Новосибирск',
    самаре: 'Самара',
    туле: 'Тула',
    перми: 'Пермь',
  };
  const [place, ...region] = city.split(',');
  const canonical = aliases[place!.trim().toLocaleLowerCase('ru')];
  return canonical ? [canonical, ...region.map((part) => part.trim())].join(', ') : city;
}
function geocodeCacheKey(city: string): string {
  // v2 cannot reuse earlier cached point-only results, which lack relation bounds.
  return 'v2:' + createHash('sha256').update(city.toLocaleLowerCase('ru')).digest('hex');
}
export function normalizeMetForecast(raw: unknown, city: City): AiWebWeather {
  const properties = record(record(raw)['properties']),
    meta = record(properties['meta']),
    units = record(meta['units']);
  if (
    units['air_temperature'] !== 'celsius' ||
    !Array.isArray(properties['timeseries']) ||
    typeof meta['updated_at'] !== 'string' ||
    !Number.isFinite(Date.parse(meta['updated_at']))
  )
    throw new AiWebProviderError();
  const number = (value: unknown, min: number, max: number) =>
    typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
      ? value
      : null;
  const hours = properties['timeseries'].slice(0, 72).flatMap((rawPoint) => {
    const point = record(rawPoint),
      details = record(record(record(point['data'])['instant'])['details']);
    const time =
      typeof point['time'] === 'string' &&
      /(?:Z|[+-]\d\d:\d\d)$/.test(point['time']) &&
      Number.isFinite(Date.parse(point['time']))
        ? new Date(point['time']).toISOString()
        : '';
    const temperatureC = number(details['air_temperature'], -100, 70);
    if (!time || temperatureC === null) return [];
    return [
      {
        time,
        temperatureC,
        humidityPercent:
          units['relative_humidity'] === '%' ? number(details['relative_humidity'], 0, 100) : null,
        pressureHpa:
          units['air_pressure_at_sea_level'] === 'hPa'
            ? number(details['air_pressure_at_sea_level'], 500, 1200)
            : null,
        windSpeedMs: units['wind_speed'] === 'm/s' ? number(details['wind_speed'], 0, 200) : null,
      },
    ];
  });
  if (!hours.length) throw new AiWebProviderError();
  return {
    provider: 'met-norway',
    location: city.name,
    sourceUrl:
      'https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=' +
      city.lat.toFixed(4) +
      '&lon=' +
      city.lon.toFixed(4),
    forecastUpdatedAt: new Date(meta['updated_at']).toISOString(),
    forecastAt: hours[0]!.time,
    attributions: [
      { title: 'MET Norway', url: 'https://www.met.no/en' },
      { title: 'CC BY 4.0', url: 'https://creativecommons.org/licenses/by/4.0/' },
      { title: '© OpenStreetMap contributors', url: 'https://www.openstreetmap.org/copyright' },
    ],
    temperatureC: hours[0]!.temperatureC,
    hours,
  };
}
export function publicWebUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const u = new URL(value);
    if (
      u.protocol !== 'https:' ||
      u.href.length > 2048 ||
      u.username ||
      u.password ||
      (u.port && u.port !== '443') ||
      !u.hostname.includes('.') ||
      u.hostname.endsWith('.') ||
      /[[\]:]/.test(u.hostname) ||
      /^\d+(?:\.\d+)*$/.test(u.hostname) ||
      /(?:^|\.)(?:localhost|local|internal|test|invalid|home|onion)$/.test(u.hostname)
    )
      return null;
    return u.href;
  } catch {
    return null;
  }
}

export function providedPageUrls(prompt: string): string[] {
  if (/не\s+(?:открывай|читай|переходи)|do not (?:open|read|visit)/iu.test(prompt)) return [];
  return [
    ...new Set(
      (prompt.match(/https:\/\/[^\s<>"`]+/giu) ?? []).flatMap((raw) => {
        const url = publicWebUrl(raw.replace(/[),.;]+$/g, ''));
        return url ? [url] : [];
      }),
    ),
  ].slice(0, 3);
}

export async function boundedWebResponse(response: Response, limit = MAX_BODY): Promise<Buffer> {
  if (
    !response.ok ||
    !response.body ||
    Number(response.headers.get('content-length') ?? 0) > limit
  ) {
    await response.body?.cancel();
    throw new AiWebProviderError();
  }
  const reader = response.body.getReader(),
    chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > limit) throw new AiWebProviderError();
      chunks.push(part.value);
    }
    return Buffer.concat(chunks);
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
}

export class FreeInternetProvider {
  readonly searchBase: string | null;
  readonly geocoderBase: string | null;
  constructor(
    private readonly fetchImpl: typeof fetch,
    private readonly cache: PublicWeatherCache,
    options: { searchEndpoint?: string; geocoderEndpoint?: string } = {},
  ) {
    this.searchBase = trustedServiceBase(
      options.searchEndpoint ?? process.env['ASA_AI_SEARCH_ENDPOINT'],
      'http://search:8080',
    );
    this.geocoderBase = trustedServiceBase(
      options.geocoderEndpoint ?? process.env['ASA_AI_GEOCODER_ENDPOINT'],
      'https://nominatim.openstreetmap.org',
    );
  }
  private async response(
    url: string,
    signal: AbortSignal,
    headers: Record<string, string> = {},
    met = false,
  ): Promise<Response> {
    const boundedSignal = AbortSignal.any([signal, AbortSignal.timeout(12000)]);
    for (let redirects = 0; redirects < 3; redirects += 1) {
      const response = await this.fetchImpl(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', ...headers },
        credentials: 'omit',
        redirect: met ? 'manual' : 'error',
        signal: boundedSignal,
      });
      if (!met || ![301, 302, 307, 308].includes(response.status)) return response;
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location) throw new AiWebProviderError();
      const next = new URL(location, url);
      if (
        next.protocol !== 'https:' ||
        next.hostname !== 'api.met.no' ||
        next.port ||
        next.username ||
        next.password ||
        !next.pathname.startsWith('/weatherapi/locationforecast/2.0/')
      )
        throw new AiWebProviderError();
      url = next.href;
    }
    throw new AiWebProviderError();
  }
  private async json(response: Response): Promise<unknown> {
    return JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(await boundedWebResponse(response)),
    );
  }
  async search(query: string, images: boolean, signal: AbortSignal, limit = 8) {
    if (!this.searchBase) throw new AiWebProviderError();
    const url = new URL('search', this.searchBase);
    url.search = new URLSearchParams({
      q: query,
      format: 'json',
      language: 'ru-RU',
      safesearch: '2',
      categories: images ? 'images' : 'general',
      engines: images ? 'bing images,duckduckgo images' : 'bing,duckduckgo,wikipedia',
    }).toString();
    return parseSearxResults(await this.json(await this.response(url.href, signal)), images, limit);
  }
  async weather(
    cityInput: string,
    signal: AbortSignal,
  ): Promise<{ weather?: AiWebWeather; choices?: string[] }> {
    const city = cityQuery(cityInput);
    if (!city || !this.geocoderBase) return { choices: [] };
    const normalizedCity = city.toLocaleLowerCase('ru');
    const geoKey = geocodeCacheKey(city);
    const geoReceipt = await this.cache.claim('geocode', geoKey);
    let cities: City[];
    if (geoReceipt.state === 'fresh')
      cities = Array.isArray(geoReceipt.body) ? dedupeNearbyCities(geoReceipt.body as City[]) : [];
    else if (geoReceipt.state === 'fetch') {
      try {
        if (geoReceipt.fetchUntil && Date.parse(geoReceipt.fetchUntil) <= Date.now())
          throw new AiWebProviderError();
        const url = new URL('search', this.geocoderBase);
        url.search = new URLSearchParams({
          q: city,
          format: 'jsonv2',
          addressdetails: '1',
          limit: '3',
          'accept-language': 'ru',
        }).toString();
        cities = parseCityCandidates(await this.json(await this.response(url.href, signal)));
        await this.cache.save(
          'geocode',
          geoKey,
          cities,
          new Date(Date.now() + (cities.length ? 7 * 86400 : 3600) * 1000).toISOString(),
          undefined,
          geoReceipt.lease,
        );
      } catch (error) {
        await this.cache.save(
          'geocode',
          geoKey,
          null,
          new Date(Date.now() + 60000).toISOString(),
          undefined,
          geoReceipt.lease,
        );
        throw error;
      }
    } else throw new AiWebProviderError();
    const exact = cities.filter((c) => c.name.toLocaleLowerCase('ru') === normalizedCity);
    const chosen = exact.length === 1 ? exact[0] : cities.length === 1 ? cities[0] : undefined;
    if (!chosen) return { choices: cities.map((c) => c.name) };
    const rounded: City = {
      ...chosen,
      lat: Number(chosen.lat.toFixed(4)),
      lon: Number(chosen.lon.toFixed(4)),
    };
    const cacheKey = rounded.lat.toFixed(4) + ',' + rounded.lon.toFixed(4);
    const receipt = await this.cache.claim('weather', cacheKey);
    if (receipt.state === 'fresh') return { weather: normalizeMetForecast(receipt.body, rounded) };
    if (receipt.state !== 'fetch') throw new AiWebProviderError();
    try {
      const url =
        'https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=' +
        rounded.lat.toFixed(4) +
        '&lon=' +
        rounded.lon.toFixed(4);
      const response = await this.response(
        url,
        signal,
        receipt.lastModified ? { 'If-Modified-Since': receipt.lastModified } : {},
        true,
      );
      const data = response.status === 304 ? receipt.body : await this.json(response);
      if (response.status === 304) await response.body?.cancel();
      const weather = normalizeMetForecast(data, rounded);
      const expires = Date.parse(response.headers.get('expires') ?? '');
      const expiresAt = new Date(
        Number.isFinite(expires) ? Math.max(expires, Date.now() + 60000) : Date.now() + 600000,
      ).toISOString();
      await this.cache.save(
        'weather',
        cacheKey,
        data,
        expiresAt,
        response.headers.get('last-modified') ??
          receipt.lastModified ??
          new Date(weather.forecastUpdatedAt).toUTCString(),
        receipt.lease,
      );
      return { weather };
    } catch (error) {
      await this.cache.save(
        'weather',
        cacheKey,
        null,
        new Date(Date.now() + 60000).toISOString(),
        undefined,
        receipt.lease,
      );
      throw error;
    }
  }
}
