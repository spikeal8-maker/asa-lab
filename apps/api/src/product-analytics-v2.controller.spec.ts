import { describe, expect, it, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';
import type { ActiveContext } from '@asa-lab/identity';
import type { SeatContext } from './seat-context.js';
import type { ProductAnalyticsService } from './product-analytics.service.js';
import { ProductAnalyticsV2Controller } from './product-analytics-v2.controller.js';

const id = '10000000-0000-4000-8000-000000000001';
const body = {
  schemaVersion: 2,
  eventId: id,
  eventType: 'visit.observed',
  actorExpectation: { kind: 'student', seatId: id, classId: id },
  visitId: id,
  clientOccurredAt: '2026-10-11T10:00:00Z',
  entryRoute: 'home',
  referrerOrigin: null,
};
function fixture(account: ActiveContext | null, seat: SeatContext | null) {
  const writer = {
    authenticatedRequest: vi.fn(
      async (
        _account: unknown,
        _seat: unknown,
        run: (a: ActiveContext | null, s: SeatContext | null) => Promise<unknown>,
      ) => run(account, seat),
    ),
    persistAcquisition: vi.fn(async () => ({ accepted: true, state: 'persisted', eventId: id })),
    persistOperation: vi.fn(async () => ({ accepted: true, state: 'persisted', eventId: id })),
  };
  const controller = new ProductAnalyticsV2Controller(
    writer as unknown as ProductAnalyticsService,
    writer as unknown as ProductAnalyticsService,
  );
  const request = {
    cookies: { asa_session: 'account', asa_student_session: 'seat' },
    headers: {},
    raw: { socket: { remoteAddress: '127.0.0.1' } },
  } as unknown as FastifyRequest;
  return { controller, writer, request };
}
const seat = { seatId: id, classroomId: id, principalId: id } as SeatContext;
describe('protected v2 telemetry authority', () => {
  it('resolves current cookies before any receipt replay and never reattributes a different Seat', async () => {
    const f = fixture(null, null);
    await expect(f.controller.events(f.request, body)).rejects.toMatchObject({ status: 401 });
    expect(f.writer.persistOperation).not.toHaveBeenCalled();
    const other = fixture(null, { ...seat, classroomId: '20000000-0000-4000-8000-000000000001' });
    await expect(other.controller.events(other.request, body)).rejects.toMatchObject({
      status: 409,
    });
    expect(other.writer.persistOperation).not.toHaveBeenCalled();
  });
  it('rejects mixed valid cookies and accepts an exact Seat/class expectation', async () => {
    const mixed = fixture({ accountId: id, workspaceId: id } as ActiveContext, seat);
    await expect(mixed.controller.events(mixed.request, body)).rejects.toMatchObject({
      status: 409,
    });
    expect(mixed.writer.persistOperation).not.toHaveBeenCalled();
    const exact = fixture(null, seat);
    await expect(exact.controller.events(exact.request, body)).resolves.toMatchObject({
      state: 'persisted',
    });
    expect(exact.writer.persistOperation).toHaveBeenCalledWith(
      id,
      { kind: 'student', context: seat },
      'visit.observed',
      expect.any(Object),
      expect.any(Object),
      expect.any(String),
    );
  });
  it('maps a database receipt collision without exposing its raw error', async () => {
    const f = fixture(null, seat);
    f.writer.persistOperation.mockRejectedValueOnce(
      Object.assign(new Error('password=private'), { code: '23505' }),
    );
    await expect(f.controller.events(f.request, body)).rejects.toMatchObject({
      status: 409,
      response: { error: { code: 'telemetry_conflict' } },
    });
  });
});

it('keeps acquisition optional and binds it to the exact authenticated Seat/class', async () => {
  const claim = {
    schemaVersion: 1,
    eventId: id,
    actorExpectation: body.actorExpectation,
    source: 'school',
    medium: null,
    campaign: null,
  };
  const f = fixture(null, seat);
  await expect(f.controller.acquisition(f.request, claim)).resolves.toMatchObject({
    state: 'persisted',
  });
  expect(f.writer.persistOperation).not.toHaveBeenCalled();
  expect(f.writer.persistAcquisition).toHaveBeenCalledWith(
    id,
    { kind: 'student', context: seat },
    { source: 'school', medium: null, campaign: null },
    expect.any(String),
  );
  for (const denied of [
    fixture(null, null),
    fixture({ accountId: id, workspaceId: id } as ActiveContext, seat),
    fixture(null, { ...seat, classroomId: '20000000-0000-4000-8000-000000000001' }),
  ]) {
    await expect(denied.controller.acquisition(denied.request, claim)).rejects.toBeDefined();
    expect(denied.writer.persistAcquisition).not.toHaveBeenCalled();
  }
});

it('uses independent optional admission without consuming canonical delivery capacity', async () => {
  const canonical = fixture(null, seat);
  const optional = fixture(null, seat);
  const controller = new ProductAnalyticsV2Controller(
    canonical.writer as unknown as ProductAnalyticsService,
    optional.writer as unknown as ProductAnalyticsService,
  );
  await controller.acquisition(canonical.request, {
    schemaVersion: 1,
    eventId: id,
    actorExpectation: body.actorExpectation,
    source: 'school',
    medium: null,
    campaign: null,
  });
  expect(canonical.writer.authenticatedRequest).not.toHaveBeenCalled();
  expect(optional.writer.authenticatedRequest).toHaveBeenCalledOnce();
  await controller.events(canonical.request, body);
  expect(canonical.writer.persistOperation).toHaveBeenCalledOnce();
  expect(optional.writer.persistOperation).not.toHaveBeenCalled();
});
