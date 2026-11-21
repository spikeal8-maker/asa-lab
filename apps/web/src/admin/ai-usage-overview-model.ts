import type { AiUsageOverview } from '@asa-lab/contracts';

const DAY_MS = 86_400_000;
const count = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const date = (value: unknown): value is string =>
  typeof value === 'string' && Number.isFinite(Date.parse(value));

/** A malformed/stale API contract is an error, never an empty or zero-valued dashboard. */
export function isAiUsageOverview(value: unknown): value is AiUsageOverview {
  if (!record(value) || value['schemaVersion'] !== 1 || !count(value['requests'])) return false;
  const period = value['period'];
  if (
    !record(period) ||
    period['timeZone'] !== 'UTC' ||
    period['days'] !== 7 ||
    !date(period['from']) ||
    !date(period['to']) ||
    !date(value['generatedAt'])
  )
    return false;
  const start = Date.parse(period['from']);
  const end = Date.parse(period['to']);
  if (
    start % DAY_MS !== 0 ||
    end < start + 6 * DAY_MS ||
    end >= start + 7 * DAY_MS ||
    Date.parse(value['generatedAt']) !== end
  )
    return false;
  const daily = value['daily'];
  if (!Array.isArray(daily) || daily.length !== 7) return false;
  if (
    !daily.every(
      (day: unknown, index) =>
        record(day) &&
        count(day['requests']) &&
        day['date'] === new Date(start + index * DAY_MS).toISOString().slice(0, 10),
    )
  )
    return false;
  if (daily.reduce((sum, day) => sum + day.requests, 0) !== value['requests']) return false;
  let partial = false;
  for (const key of ['inputTokens', 'outputTokens']) {
    const tokens = value[key];
    if (
      !record(tokens) ||
      !count(tokens['knownOperations']) ||
      !count(tokens['unknownOperations']) ||
      tokens['knownOperations'] + tokens['unknownOperations'] !== value['requests']
    )
      return false;
    if (tokens['knownOperations'] === 0) {
      if (tokens['known'] !== (value['requests'] === 0 ? '0' : null)) return false;
    } else if (
      typeof tokens['known'] !== 'string' ||
      !/^(0|[1-9][0-9]{0,79})$/.test(tokens['known'])
    ) {
      return false;
    }
    partial ||= tokens['unknownOperations'] > 0;
  }
  return value['state'] === (value['requests'] === 0 ? 'empty' : partial ? 'partial' : 'complete');
}

export const usageInteger = new Intl.NumberFormat('ru-RU');
export const usageDate = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});
export const usageTime = new Intl.DateTimeFormat('ru-RU', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  timeZone: 'UTC',
});

export function formatUsageTokens(known: string | null): string {
  // Narrow cards may wrap between thousand groups without splitting a group.
  return known === null
    ? 'Неизвестно'
    : usageInteger.format(BigInt(known)).replace(/[\u00a0\u202f]/g, ' ');
}
