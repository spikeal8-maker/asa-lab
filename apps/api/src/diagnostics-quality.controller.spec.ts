import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { HttpException } from '@nestjs/common';
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

function requestFrom(address: string, forwarded = false) {
  return {
    headers: forwarded ? { 'x-forwarded-for': '203.0.113.250' } : {},
    raw: { socket: { remoteAddress: address } },
  } as unknown as FastifyRequest;
}

function makeQuality(streamNumber: number, sequence: number) {
  return {
    schemaVersion: 2,
    eventId:
      '20000000-0000-4000-8000-' + (streamNumber * 1000 + sequence).toString(16).padStart(12, '0'),
    pipeline: 'client-diagnostics',
    streamId: '30000000-0000-4000-8000-' + streamNumber.toString(16).padStart(12, '0'),
    sequence,
    streamStartedAt: '2026-11-09T10:00:00Z',
    clientObservedAt: '2026-11-09T10:00:01Z',
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
}

function expect429(run: () => unknown) {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(429);
    return;
  }
  throw new Error('Expected HTTP 429');
}

describe('diagnostic quality fairness behind one school NAT', () => {
  it('accepts 30 independent pupil streams without a false IP-wide 600/min rejection', () => {
    const log = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const controller = new DiagnosticsQualityController();
    const request = requestFrom('203.0.113.90');
    for (let pupil = 1; pupil <= 30; pupil += 1) {
      for (let step = 1; step <= 30; step += 1) {
        expect(controller.report(request, makeQuality(pupil, step))).toMatchObject({
          accepted: true,
          streamId: makeQuality(pupil, step).streamId,
        });
      }
    }
    expect(log).toHaveBeenCalledTimes(900);
  });

  it('blocks a noisy stream at 60 per minute but preserves capacity for another pupil', () => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const controller = new DiagnosticsQualityController();
    const request = requestFrom('203.0.113.90');
    for (let sequence = 1; sequence <= 60; sequence += 1)
      controller.report(request, makeQuality(1, sequence));
    expect429(() => controller.report(request, makeQuality(1, 61)));
    expect(controller.report(request, makeQuality(2, 1))).toMatchObject({
      accepted: true,
    });
  });

  it('retains an IP-level ceiling even if an attacker changes stream IDs', () => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const controller = new DiagnosticsQualityController();
    const schoolNat = requestFrom('203.0.113.90');
    for (let stream = 1; stream <= 30; stream += 1)
      for (let sequence = 1; sequence <= 60; sequence += 1)
        controller.report(schoolNat, makeQuality(stream, sequence));
    expect429(() => controller.report(schoolNat, makeQuality(31, 1)));
    // Forged X-Forwarded-For from a public socket is never a bypass.
    expect429(() => controller.report(requestFrom('203.0.113.90', true), makeQuality(32, 1)));
    expect(controller.report(requestFrom('203.0.113.91'), makeQuality(33, 1))).toMatchObject({
      accepted: true,
    });
  });

  it('rejects unknown fields before consuming the rate budget', () => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const controller = new DiagnosticsQualityController();
    const address = requestFrom('203.0.113.95');
    for (let i = 0; i < 80; i += 1)
      expect(() =>
        controller.report(address, { ...makeQuality(1, i + 1), token: 'untrusted' }),
      ).toThrow();
    for (let sequence = 1; sequence <= 60; sequence += 1)
      expect(controller.report(address, makeQuality(1, sequence))).toMatchObject({
        accepted: true,
      });
    expect429(() => controller.report(address, makeQuality(1, 61)));
  });
});
