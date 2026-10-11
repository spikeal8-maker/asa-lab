import { describe, expect, it, vi } from 'vitest';
import type { ActiveContextUseCase, ActiveContext } from '@asa-lab/identity';
import type { FastifyRequest } from 'fastify';
import { ProductAnalyticsController } from './product-analytics.controller.js';
import type { ProductAnalyticsService } from './product-analytics.service.js';
import type { SeatContext, SeatContextUseCase } from './seat-context.js';

const ID = '11111111-1111-4111-8111-111111111111';
function fixture(account: boolean, seat: boolean) {
  const accountContext = {
    principalId: 'account-principal',
    accountId: 'account',
    workspaceId: 'workspace',
  } as ActiveContext;
  const seatContext = { principalId: 'seat-principal', seatId: 'seat' } as SeatContext;
  const activeContext = { resolve: vi.fn(async () => (account ? accountContext : null)) };
  const seatContextUseCase = { resolve: vi.fn(async () => (seat ? seatContext : null)) };
  const analytics = {
    startModuleSession: vi.fn(async () => false),
    touchModuleSession: vi.fn(async () => false),
  };
  const controller = new ProductAnalyticsController(
    activeContext as unknown as ActiveContextUseCase,
    seatContextUseCase as unknown as SeatContextUseCase,
    analytics as unknown as ProductAnalyticsService,
  );
  const request = {
    cookies: { asa_session: 'account-cookie', asa_student_session: 'seat-cookie' },
    headers: {},
    ip: '127.0.0.1',
    raw: { socket: { remoteAddress: '127.0.0.1' } },
  } as unknown as FastifyRequest;
  return { controller, request, analytics, accountContext, seatContext };
}
describe('Scratch uses authenticated ProductAnalytics endpoints', () => {
  it.each(['account', 'student'] as const)(
    'takes %s identity from cookies, never the client body',
    async (kind) => {
      const f = fixture(kind === 'account', kind === 'student');
      const result = await f.controller.startModuleSession(f.request, {
        sessionId: ID,
        projectId: ID,
        moduleKey: 'blocks',
      });
      expect(result).toEqual({ accepted: false, sessionId: ID });
      expect(f.analytics.startModuleSession).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: ID,
          projectId: ID,
          moduleKey: 'blocks',
          actor: { kind, context: kind === 'account' ? f.accountContext : f.seatContext },
        }),
      );
      await f.controller.touchModuleSession(f.request, { sessionId: ID, closed: true });
      expect(f.analytics.touchModuleSession).toHaveBeenCalledWith({
        sessionId: ID,
        closed: true,
        actor: { kind, context: kind === 'account' ? f.accountContext : f.seatContext },
      });
      await expect(
        f.controller.startModuleSession(f.request, {
          sessionId: ID,
          projectId: ID,
          moduleKey: 'blocks',
          actorId: 'foreign',
        }),
      ).rejects.toMatchObject({ status: 400 });
    },
  );
  it('rejects simultaneous valid Account and Seat cookies and anonymous sessions', async () => {
    for (const [account, seat, status] of [
      [true, true, 409],
      [false, false, 401],
    ] as const) {
      const f = fixture(account, seat);
      await expect(
        f.controller.startModuleSession(f.request, {
          sessionId: ID,
          projectId: ID,
          moduleKey: 'blocks',
        }),
      ).rejects.toMatchObject({ status });
      await expect(
        f.controller.touchModuleSession(f.request, { sessionId: ID }),
      ).rejects.toMatchObject({ status });
      expect(f.analytics.startModuleSession).not.toHaveBeenCalled();
      expect(f.analytics.touchModuleSession).not.toHaveBeenCalled();
    }
  });
});
