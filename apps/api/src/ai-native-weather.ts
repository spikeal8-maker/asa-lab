import type { AiWebWeather } from '@asa-lab/contracts';

/** A ready MET forecast is rendered from validated fields, without another model round. */
export function readyWeatherAnswer(weather: AiWebWeather): string | null {
  const first = weather.hours[0];
  const forecastAt = first?.time;
  const validUtc = (value: unknown): value is string =>
    typeof value === 'string' &&
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/u.test(value) &&
    Number.isFinite(Date.parse(value));
  const source = (() => {
    try {
      const url = new URL(weather.sourceUrl);
      return url.protocol === 'https:' &&
        url.hostname === 'api.met.no' &&
        !url.port &&
        !url.username &&
        !url.password &&
        url.pathname.startsWith('/weatherapi/locationforecast/2.0/')
        ? url.href
        : null;
    } catch {
      return null;
    }
  })();
  if (
    !first ||
    !validUtc(forecastAt) ||
    !validUtc(weather.forecastUpdatedAt) ||
    weather.forecastAt !== forecastAt ||
    !Number.isFinite(first.temperatureC) ||
    !source
  )
    return null;

  const city = weather.location
    .replace(/[\p{Cc}[\]()<>]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 120);
  if (!city) return null;
  const number = (value: number) => String(value).replace('.', ',');
  const utc = (value: string) => value.replace('T', ' ').replace(/(?:\.\d+)?Z$/u, ' UTC');
  const optional = (value: number | null | undefined, min: number, max: number, unit: string) =>
    typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
      ? `${number(value)} ${unit}`
      : null;
  const facts = [`температура ${number(first.temperatureC)} °C`];
  const humidity = optional(first.humidityPercent, 0, 100, '%');
  const wind = optional(first.windSpeedMs, 0, 200, 'м/с');
  const pressure = optional(first.pressureHpa, 500, 1200, 'гПа');
  if (humidity) facts.push(`влажность ${humidity}`);
  if (wind) facts.push(`ветер ${wind}`);
  if (pressure) facts.push(`давление ${pressure}`);
  return `🌡 ${city}: модельный прогноз на ${utc(forecastAt)}.\n${facts.join('; ')}.\nПрогноз обновлён ${utc(weather.forecastUpdatedAt)}. Источник: [MET Norway](${source}).`;
}
