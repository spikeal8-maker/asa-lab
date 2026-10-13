import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { DiagnosticsQualityController } from './diagnostics-quality.controller.js';
import { QUALITY_COUNTERS } from './analytics-envelope.js';

afterEach(() => vi.restoreAllMocks());
describe('anonymous diagnostic quality intake', () => {
  it('acknowledges only stdout intake with fixed anonymous fields, never database persistence', () => {
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const id = '10000000-0000-4000-8000-000000000001';
    const body = {
      schemaVersion: 2,
      eventId: id,
      pipeline: 'client-diagnostics',
      streamId: id,
      sequence: 1,
      streamStartedAt: '2026-10-11T10:00:00Z',
      clientObservedAt: '2026-10-11T10:00:01Z',
      acknowledgementStage: 'intake_acknowledged',
      counters: Object.fromEntries(QUALITY_COUNTERS.map((key) => [key, 0])),
      gauges: { pending: 0, inFlight: 0 },
      coverage: {
        persistenceUnavailable: false,
        uncleanEnd: false,
        final: false,
        counterSaturated: false,
      },
    };
    const request = {
      headers: { 'user-agent': 'private-raw-UA' },
      cookies: { asa_session: 'secret-cookie' },
      raw: { socket: { remoteAddress: '203.0.113.1' } },
    } as unknown as FastifyRequest;
    expect(new DiagnosticsQualityController().report(request, body)).toMatchObject({
      state: 'intake_acknowledged',
      eventId: id,
    });
    const line = String(output.mock.calls[0]![0]);
    expect(line).toContain('"untrustedClientReport":true');
    expect(line).not.toMatch(/private-raw-UA|secret-cookie|203\.0\.113\.1|"state":"persisted"/);
    expect(() =>
      new DiagnosticsQualityController().report(request, { ...body, accountId: id }),
    ).toThrow();
  });
});
