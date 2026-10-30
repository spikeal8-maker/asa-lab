import type { AiWebSearchEvidence, AiWebSource } from '@asa-lab/contracts';

/** Evidence is network input even when it comes from our own API. */
export function publicSourceUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port ||
      !host.includes('.') ||
      host.includes(':') ||
      host.includes('[') ||
      host.includes(']') ||
      /^[\d.]+$/.test(host) ||
      /(?:^|\.)(?:localhost|local|internal|test|invalid|lan|home|corp)$/.test(host) ||
      host.endsWith('.home.arpa')
    )
      return null;
    return url.href;
  } catch {
    return null;
  }
}

export function searchThumbnailUrl(value: unknown): string | null {
  return typeof value === 'string' &&
    /^\/api\/ai\/threads\/[a-f0-9-]{36}\/web-search\/[a-f0-9-]{36}\/images\/(?:[1-9]|1[0-2])$/.test(
      value,
    )
    ? value
    : null;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function readWebEvidence(value: unknown): AiWebSearchEvidence | null {
  if (
    !record(value) ||
    value.schemaVersion !== 1 ||
    value.provider !== 'searxng' ||
    !['web', 'images', 'weather'].includes(String(value.mode)) ||
    !['ready', 'empty', 'unavailable', 'limited', 'needs_location'].includes(
      String(value.status),
    ) ||
    typeof value.query !== 'string' ||
    typeof value.retrievedAt !== 'string' ||
    !Number.isFinite(Date.parse(value.retrievedAt)) ||
    !Array.isArray(value.sources) ||
    !Array.isArray(value.images)
  )
    return null;
  const sources: AiWebSource[] = [];
  for (const item of value.sources.slice(0, 12)) {
    if (!record(item)) continue;
    const url = publicSourceUrl(item.url);
    if (
      url &&
      Number.isInteger(item.id) &&
      Number(item.id) > 0 &&
      typeof item.title === 'string' &&
      typeof item.snippet === 'string' &&
      !sources.some((source) => source.id === item.id)
    )
      sources.push({
        id: Number(item.id),
        title: item.title.slice(0, 300),
        snippet: item.snippet.slice(0, 1500),
        url,
        hostname: new URL(url).hostname,
        ...(item.pageRead === 'read' || item.pageRead === 'unavailable'
          ? { pageRead: item.pageRead }
          : {}),
        ...(item.pageRead === 'read' && typeof item.pageText === 'string'
          ? { pageText: item.pageText.slice(0, 4500) }
          : {}),
      });
  }
  const images = value.images.slice(0, 12).flatMap((item) => {
    if (!record(item) || typeof item.title !== 'string' || !Number.isInteger(item.id)) return [];
    const thumbnailUrl = searchThumbnailUrl(item.thumbnailUrl);
    const sourceUrl = publicSourceUrl(item.sourceUrl);
    return thumbnailUrl && sourceUrl
      ? [
          {
            id: Number(item.id),
            title: item.title.slice(0, 300),
            thumbnailUrl,
            sourceUrl,
            ...(publicSourceUrl(item.originalUrl)
              ? { originalUrl: publicSourceUrl(item.originalUrl)! }
              : {}),
          },
        ]
      : [];
  });
  const weather = record(value.weather) ? value.weather : null;
  const sourceUrl = weather ? publicSourceUrl(weather.sourceUrl) : null;
  const finiteTemperature = (temperature: unknown): temperature is number =>
    typeof temperature === 'number' &&
    Number.isFinite(temperature) &&
    temperature >= -100 &&
    temperature <= 80;
  return {
    schemaVersion: 1,
    provider: 'searxng',
    mode: value.mode as AiWebSearchEvidence['mode'],
    status: value.status as AiWebSearchEvidence['status'],
    query: value.query.slice(0, 400),
    retrievedAt: value.retrievedAt,
    sources,
    images,
    ...(value.status === 'ready' &&
    weather &&
    sourceUrl &&
    weather.provider === 'met-norway' &&
    typeof weather.forecastAt === 'string' &&
    Number.isFinite(Date.parse(weather.forecastAt)) &&
    typeof weather.forecastUpdatedAt === 'string' &&
    Number.isFinite(Date.parse(weather.forecastUpdatedAt)) &&
    Array.isArray(weather.attributions) &&
    typeof weather.location === 'string' &&
    Array.isArray(weather.hours)
      ? {
          weather: {
            provider: 'met-norway' as const,
            forecastAt: weather.forecastAt,
            forecastUpdatedAt: weather.forecastUpdatedAt,
            attributions: weather.attributions.slice(0, 4).flatMap((item) => {
              if (!record(item) || typeof item.title !== 'string') return [];
              const url = publicSourceUrl(item.url);
              return url ? [{ title: item.title.slice(0, 150), url }] : [];
            }),
            location: weather.location.slice(0, 200),
            sourceUrl,
            temperatureC: finiteTemperature(weather.temperatureC) ? weather.temperatureC : null,
            hours: weather.hours.slice(0, 12).flatMap((hour) =>
              record(hour) &&
              typeof hour.time === 'string' &&
              Number.isFinite(Date.parse(hour.time)) &&
              finiteTemperature(hour.temperatureC)
                ? [
                    {
                      time: hour.time,
                      temperatureC: hour.temperatureC,
                      humidityPercent:
                        typeof hour.humidityPercent === 'number' &&
                        Number.isFinite(hour.humidityPercent) &&
                        hour.humidityPercent >= 0 &&
                        hour.humidityPercent <= 100
                          ? hour.humidityPercent
                          : null,
                      pressureHpa:
                        typeof hour.pressureHpa === 'number' &&
                        Number.isFinite(hour.pressureHpa) &&
                        hour.pressureHpa >= 800 &&
                        hour.pressureHpa <= 1200
                          ? hour.pressureHpa
                          : null,
                      windSpeedMs:
                        typeof hour.windSpeedMs === 'number' &&
                        Number.isFinite(hour.windSpeedMs) &&
                        hour.windSpeedMs >= 0 &&
                        hour.windSpeedMs <= 150
                          ? hour.windSpeedMs
                          : null,
                    },
                  ]
                : [],
            ),
          },
        }
      : {}),
    ...(Array.isArray(value.locationChoices)
      ? {
          locationChoices: value.locationChoices
            .filter((item): item is string => typeof item === 'string')
            .slice(0, 5)
            .map((item) => item.slice(0, 200)),
        }
      : {}),
    ...(typeof value.reason === 'string' &&
    [
      'not_configured',
      'provider_unavailable',
      'weather_unavailable',
      'location_required',
      'location_ambiguous',
      'rate_limit',
    ].includes(value.reason)
      ? { reason: value.reason as NonNullable<AiWebSearchEvidence['reason']> }
      : {}),
  };
}
