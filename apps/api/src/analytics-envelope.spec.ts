import { describe, expect, it } from 'vitest';
import { parseAnalyticsEnvelope, QUALITY_COUNTERS } from './analytics-envelope.js';
import { clientEnvironment, environmentSummary } from './client-environment.js';

const id = '10000000-0000-4000-8000-000000000001';
const visit = {
  schemaVersion: 2,
  eventId: id,
  actorExpectation: { kind: 'student', seatId: id, classId: id },
  eventType: 'visit.observed',
  visitId: id,
  clientOccurredAt: '2026-10-11T10:00:00Z',
  entryRoute: 'editor.blocks',
  referrerOrigin: 'https://school.test/private?token=secret#x',
};
describe('fixed telemetry envelopes', () => {
  it('rejects local clock strings and normalizes equivalent explicit offsets to the same semantic request', () => {
    expect(() =>
      parseAnalyticsEnvelope({ ...visit, clientOccurredAt: '2026-10-11T10:00:00' }, 'events'),
    ).toThrow();
    expect(
      parseAnalyticsEnvelope({ ...visit, clientOccurredAt: '2026-10-11T13:00:00+03:00' }, 'events'),
    ).toEqual(parseAnalyticsEnvelope(visit, 'events'));
  });
  it('retains a Seat/class expectation and reduces the referrer to its HTTP origin', () => {
    expect(parseAnalyticsEnvelope(visit, 'events')).toMatchObject({
      operation: 'visit.observed',
      actorExpectation: { kind: 'student', seatId: id, classId: id },
      semantic: { referrerOrigin: 'https://school.test' },
    });
  });
  it.each([
    { eventType: 'module.opened' },
    { moduleKey: 'blocks' },
    { entryRoute: '/private/user/1' },
    { referrerOrigin: 'https://name:password@school.test/a' },
    { referrerOrigin: 'file:///secret' },
    { actorExpectation: { kind: 'student', seatId: id, workspaceId: id } },
  ])(
    'rejects additional launch writers, unsafe navigation and fake Seat authority: %o',
    (patch) => {
      expect(() => parseAnalyticsEnvelope({ ...visit, ...patch }, 'events')).toThrow();
    },
  );
  it('requires a complete fixed cumulative quality snapshot, with safe integers', () => {
    const quality = {
      schemaVersion: 2,
      eventId: id,
      actorExpectation: visit.actorExpectation,
      pipeline: 'product-analytics',
      streamId: id,
      sequence: 1,
      streamStartedAt: visit.clientOccurredAt,
      clientObservedAt: visit.clientOccurredAt,
      acknowledgementStage: 'persisted',
      counters: Object.fromEntries(QUALITY_COUNTERS.map((key) => [key, 0])),
      gauges: { pending: 1, inFlight: 1 },
      coverage: {
        persistenceUnavailable: false,
        uncleanEnd: false,
        final: false,
        counterSaturated: false,
      },
    };
    expect(parseAnalyticsEnvelope(quality, 'quality').operation).toBe('quality');
    expect(() =>
      parseAnalyticsEnvelope(
        { ...quality, counters: { ...quality.counters, attempted: 2 ** 53 } },
        'quality',
      ),
    ).toThrow();
    expect(() =>
      parseAnalyticsEnvelope({ ...quality, clientObservedAt: undefined }, 'quality'),
    ).toThrow();
  });
  it('normalizes the actual browser before Chrome compatibility tokens and never stores raw UA', () => {
    const raw = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0 Safari/537.36 Edg/130.0 ${'private'.repeat(500)}`;
    expect(clientEnvironment(raw)).toMatchObject({
      browser: 'Edge',
      major: 130,
      os: 'Windows',
      device: 'desktop',
    });
    expect(environmentSummary(raw)).not.toContain('private');
    expect(
      clientEnvironment(
        'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) Version/17.0 Mobile/15 Safari/604',
      ),
    ).toMatchObject({ browser: 'Safari', major: 17, os: 'iOS', device: 'tablet' });
  });
});
