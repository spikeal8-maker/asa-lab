import { exact, expectation, invalid, object, uuid } from './analytics-envelope.js';

export function parseAcquisitionEnvelope(raw: unknown) {
  const v = object(raw);
  exact(v, ['schemaVersion', 'eventId', 'actorExpectation', 'source', 'medium', 'campaign']);
  if (v['schemaVersion'] !== 1) invalid();
  const semantic: Record<'source' | 'medium' | 'campaign', string | null> = {
    source: null,
    medium: null,
    campaign: null,
  };
  for (const key of ['source', 'medium', 'campaign'] as const) {
    const value = v[key];
    if (value !== null && (typeof value !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(value)))
      invalid();
    semantic[key] = value as string | null;
  }
  if (!Object.values(semantic).some(Boolean)) invalid();
  return {
    eventId: uuid(v['eventId']),
    actorExpectation: expectation(v['actorExpectation']),
    semantic,
  };
}
