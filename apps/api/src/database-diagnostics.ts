import contract from './database-diagnostic-contract.json';
import type { LogEntry } from './admin-logs.worker.js';
import { logSubsystem } from './log-subsystems.js';

interface FieldRule {
  type: string;
  values?: readonly string[];
  minimum?: number;
  maximum?: number;
}
interface SourceRule {
  fields: Record<string, FieldRule>;
  severity?: { field: string; error: readonly string[]; warn: readonly string[] };
}
const sources: Record<string, SourceRule> = contract.sources;
const sourceNames = Object.keys(sources);
// API diagnostic quality reports also emit sequence. That key alone is not DB
// evidence; chess rows still have their DB provenance or created_at_ms marker.
const fieldNames = new Set(
  Object.values(sources)
    .flatMap((rule) => Object.keys(rule.fields))
    .filter((name) => name !== 'sequence'),
);
const fieldMarker = new RegExp(`"(?:${[...fieldNames].join('|')})"\\s*:`);
const timestampPattern = new RegExp(contract.timestamp.pattern);

function timestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !timestampPattern.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const hour = Number(value.slice(11, 13));
  const minute = Number(value.slice(14, 16));
  const second = Number(value.slice(17, 19));
  const zone = /([+-])(\d{2}):(\d{2})$/.exec(value);
  return (
    year >= contract.timestamp.minYear &&
    year <= contract.timestamp.maxYear &&
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= new Date(Date.UTC(year, month, 0)).getUTCDate() &&
    hour <= 23 &&
    minute <= 59 &&
    second <= 59 &&
    (!zone || (Number(zone[2]) <= 23 && Number(zone[3]) <= 59)) &&
    Number.isFinite(Date.parse(value))
  );
}

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** Only inspect the message chain; arbitrary nested objects never become diagnostics. */
function payloads(message: string): Record<string, unknown>[] {
  const result: Record<string, unknown>[] = [];
  let value: unknown = message;
  for (let depth = 0; depth < 8; depth++) {
    if (typeof value === 'string') {
      try {
        value = JSON.parse(value) as unknown;
      } catch {
        break;
      }
    }
    if (typeof value === 'string') continue;
    if (!object(value)) break;
    result.push(value);
    value = value.message;
  }
  return result;
}

/** Unknown/forged DB provenance is recognizable but cannot authorize any fields. */
export function projectDatabaseEntry(entry: LogEntry): LogEntry {
  const messages = payloads(entry.message);
  const origin =
    typeof entry.origin === 'string' && Object.hasOwn(sources, entry.origin) ? entry.origin : null;
  const recognizable =
    origin ||
    entry.source === 'audit' ||
    entry.source === 'auth' ||
    typeof entry.source !== 'string' ||
    (entry.origin !== undefined && typeof entry.origin !== 'string') ||
    sourceNames.some(
      (name) =>
        entry.message.includes(name) ||
        (typeof entry.source === 'string' && entry.source.includes(name)) ||
        (typeof entry.origin === 'string' && entry.origin.includes(name)),
    ) ||
    fieldMarker.test(entry.message) ||
    messages.some((message) => Object.keys(message).some((key) => fieldNames.has(key))) ||
    Object.keys(entry).some((key) => fieldNames.has(key));
  if (!recognizable) return entry;
  if (!timestamp(entry.time)) throw new Error('LOG_SEGMENT_INVALID');
  const rule = origin ? sources[origin] : undefined;
  const diagnostic: Record<string, unknown> = {};
  if (rule) {
    // Innermost message owns its facts; never merge unrelated nested payloads.
    const payload = messages.at(-1) ?? {};
    for (const [key, field] of Object.entries(rule.fields)) {
      const value = payload[key];
      const valid =
        field.type === 'enum'
          ? typeof value === 'string' && field.values!.includes(value)
          : field.type === 'integer'
            ? typeof value === 'number' &&
              Number.isSafeInteger(value) &&
              value >= field.minimum! &&
              value <= field.maximum!
            : field.type === 'timestamp' && timestamp(value);
      if (valid) diagnostic[key] = value;
    }
  }
  const source = origin === 'product_analytics_events' ? 'auth' : 'audit';
  const severity = rule?.severity;
  const outcome = severity ? diagnostic[severity.field] : undefined;
  const level =
    typeof outcome === 'string' && severity?.error.includes(outcome)
      ? 'error'
      : typeof outcome === 'string' && severity?.warn.includes(outcome)
        ? 'warn'
        : 'info';
  return {
    id: entry.id,
    time: entry.time,
    source,
    module: source === 'auth' ? 'auth' : 'system',
    subsystem: logSubsystem(source, '', origin ?? ''),
    level,
    message: JSON.stringify(diagnostic),
    requestId: null,
    revision: null,
    origin: origin ?? 'database',
    truncated: entry.truncated === true,
    normalizationVersion: 2,
  };
}
