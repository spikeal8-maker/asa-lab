import { describe, expect, it } from 'vitest';
import { parseAcquisitionEnvelope } from './acquisition-envelope.js';
const id = '10000000-0000-4000-8000-000000000001';
const body = {
  schemaVersion: 1,
  eventId: id,
  actorExpectation: { kind: 'student', seatId: id, classId: id },
  source: 'school',
  medium: null,
  campaign: 'fall-2026',
};
describe('acquisition envelope boundary', () => {
  it('retains only exact controlled fields', () => {
    expect(parseAcquisitionEnvelope(body)).toMatchObject({
      eventId: id,
      semantic: { source: 'school', medium: null, campaign: 'fall-2026' },
    });
  });
  it('rejects unknown fields, URL/PII values, invalid actors and empty claims', () => {
    for (const patch of [
      { url: 'https://private.test?token=secret' },
      { source: 'https://example.test' },
      { source: 'mail@example.test' },
      { source: 'a'.repeat(65) },
      { campaign: {} },
      { medium: undefined },
      { source: null, campaign: null },
      { actorExpectation: { kind: 'account', accountId: id } },
    ])
      expect(() => parseAcquisitionEnvelope({ ...body, ...patch })).toThrow();
  });
});
