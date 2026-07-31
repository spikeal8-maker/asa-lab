import { HttpException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ChessLiveController } from './chess-live.controller';

const request = {
  cookies: { asa_session: 'session-token' },
} as never;

function setup(
  context: { tenantId: string; userId: string | null; accountId?: string } | null = {
    tenantId: 'tenant:session',
    userId: 'user:session',
  },
) {
  const activeContext = {
    resolve: vi.fn().mockResolvedValue(context),
  };
  const accounts = {
    legacyActor: vi.fn().mockResolvedValue(null),
  };
  const service = {
    createChallenge: vi.fn().mockResolvedValue({
      ok: true,
      value: { challenge: { id: 'challenge:1' }, replayed: false },
    }),
    getChallenge: vi.fn().mockResolvedValue({
      ok: true,
      value: { id: 'challenge:1', publicCode: 'ABCDEFGH' },
    }),
    acceptChallenge: vi.fn().mockResolvedValue({
      ok: true,
      value: { challenge: { id: 'challenge:1' }, game: { gameId: 'game:1' }, replayed: false },
    }),
    cancelChallenge: vi.fn().mockResolvedValue({
      ok: true,
      value: { challenge: { id: 'challenge:1', status: 'cancelled' }, replayed: false },
    }),
    getGame: vi.fn().mockResolvedValue({ ok: true, value: { gameId: 'game:1' } }),
    reconnect: vi.fn().mockResolvedValue({
      ok: true,
      value: { snapshot: { gameId: 'game:1' }, events: [], nextSequence: 1 },
    }),
    spectatorEvents: vi.fn().mockResolvedValue({ ok: true, value: [] }),
    submitMove: vi.fn().mockResolvedValue({
      ok: true,
      value: { game: { gameId: 'game:1', version: 2 }, replayed: false, event: null },
    }),
    offerDraw: vi
      .fn()
      .mockResolvedValue({ ok: true, value: { game: {}, replayed: false, event: null } }),
    acceptDraw: vi
      .fn()
      .mockResolvedValue({ ok: true, value: { game: {}, replayed: false, event: null } }),
    declineDraw: vi
      .fn()
      .mockResolvedValue({ ok: true, value: { game: {}, replayed: false, event: null } }),
    resign: vi
      .fn()
      .mockResolvedValue({ ok: true, value: { game: {}, replayed: false, event: null } }),
    claimTimeout: vi
      .fn()
      .mockResolvedValue({ ok: true, value: { game: {}, replayed: false, event: null } }),
    joinMatchmaking: vi.fn().mockResolvedValue({
      ok: true,
      value: { ticket: { id: 'ticket:1' }, game: null, replayed: false },
    }),
    cancelMatchmaking: vi.fn().mockResolvedValue({
      ok: true,
      value: { ticket: { id: 'ticket:1', status: 'cancelled' }, replayed: false },
    }),
    getRating: vi.fn().mockResolvedValue({
      ok: true,
      value: { rating: { rating: 1200 }, ledger: [] },
    }),
  };
  return {
    activeContext,
    accounts,
    service,
    controller: new ChessLiveController(
      activeContext as never,
      accounts as never,
      service as never,
    ),
  };
}

async function rejectedStatus(operation: Promise<unknown>): Promise<number> {
  try {
    await operation;
    throw new Error('expected operation to reject');
  } catch (error) {
    expect(error).toBeInstanceOf(HttpException);
    return (error as HttpException).getStatus();
  }
}

describe('ChessLiveController', () => {
  it('derives tenant and actor only from the active session', async () => {
    const { controller, service } = setup();
    await controller.createChallenge(request, 'command:create', {
      colorPreference: 'white',
      initialMs: 600_000,
      incrementMs: 5_000,
      rated: true,
      expiresInMs: 120_000,
    });
    expect(service.createChallenge).toHaveBeenCalledWith(
      { tenantId: 'tenant:session', userId: 'user:session' },
      {
        commandId: 'command:create',
        colorPreference: 'white',
        timeControl: { initialMs: 600_000, incrementMs: 5_000 },
        rated: true,
        expiresInMs: 120_000,
      },
    );
  });

  it('uses the server-side legacy bridge for Personal Workspace online chess', async () => {
    const { controller, accounts, service } = setup({
      tenantId: 'tenant:personal',
      userId: null,
      accountId: 'account:owner',
    });
    accounts.legacyActor.mockResolvedValueOnce({
      tenantId: 'tenant:organization',
      userId: 'user:teacher',
    });
    await controller.getRating(request, 'rapid');
    expect(accounts.legacyActor).toHaveBeenCalledWith('account:owner');
    expect(service.getRating).toHaveBeenCalledWith(
      { tenantId: 'tenant:organization', userId: 'user:teacher' },
      'rapid',
    );
  });

  it.each(['tenantId', 'tenant_id', 'userId', 'result', 'currentFen', 'winnerId'])(
    'rejects authoritative over-posted challenge field %s',
    async (field) => {
      const { controller, service } = setup();
      expect(
        await rejectedStatus(
          controller.createChallenge(request, 'command:create', {
            colorPreference: 'white',
            initialMs: 600_000,
            incrementMs: 5_000,
            rated: false,
            expiresInMs: 120_000,
            [field]: 'forged',
          }),
        ),
      ).toBe(400);
      expect(service.createChallenge).not.toHaveBeenCalled();
    },
  );

  it('requires a safe idempotency key for every write', async () => {
    const { controller } = setup();
    expect(
      await rejectedStatus(
        controller.createChallenge(request, undefined, {
          colorPreference: 'random',
          initialMs: 60_000,
          incrementMs: 0,
          rated: false,
          expiresInMs: 120_000,
        }),
      ),
    ).toBe(400);
    expect(
      await rejectedStatus(
        controller.createChallenge(request, 'bad command with spaces', {
          colorPreference: 'random',
          initialMs: 60_000,
          incrementMs: 0,
          rated: false,
          expiresInMs: 120_000,
        }),
      ),
    ).toBe(400);
  });

  it('rejects unauthenticated reads and writes', async () => {
    const { controller } = setup(null);
    expect(await rejectedStatus(controller.getChallenge(request, 'ABCDEFGH'))).toBe(401);
    expect(
      await rejectedStatus(
        controller.submitMove(request, 'game:1', 'command:move', {
          expectedVersion: 1,
          uci: 'e2e4',
        }),
      ),
    ).toBe(401);
  });

  it('passes only expectedVersion and UCI to the authoritative move service', async () => {
    const { controller, service } = setup();
    await controller.submitMove(request, 'game:1', 'command:move', {
      expectedVersion: 4,
      uci: 'e2e4',
    });
    expect(service.submitMove).toHaveBeenCalledWith(
      { tenantId: 'tenant:session', userId: 'user:session' },
      {
        gameId: 'game:1',
        commandId: 'command:move',
        expectedVersion: 4,
        uci: 'e2e4',
      },
    );
  });

  it.each(['tenantId', 'userId', 'fenAfter', 'clock', 'result', 'elapsedMs'])(
    'rejects forged move field %s',
    async (field) => {
      const { controller, service } = setup();
      expect(
        await rejectedStatus(
          controller.submitMove(request, 'game:1', 'command:move', {
            expectedVersion: 4,
            uci: 'e2e4',
            [field]: 'forged',
          }),
        ),
      ).toBe(400);
      expect(service.submitMove).not.toHaveBeenCalled();
    },
  );

  it('maps live domain errors to stable HTTP statuses', async () => {
    const { controller, service } = setup();
    service.submitMove.mockResolvedValueOnce({
      ok: false,
      code: 'illegal_move',
      message: 'Illegal or ambiguous chess move.',
    });
    expect(
      await rejectedStatus(
        controller.submitMove(request, 'game:1', 'command:move', {
          expectedVersion: 1,
          uci: 'e2e5',
        }),
      ),
    ).toBe(422);
    service.getGame.mockResolvedValueOnce({
      ok: false,
      code: 'forbidden',
      message: 'user is not a game participant',
    });
    expect(await rejectedStatus(controller.getGame(request, 'game:foreign'))).toBe(403);
  });

  it('validates reconnect sequence and rating pool through the service boundary', async () => {
    const { controller, service } = setup();
    await controller.reconnect(request, 'game:1', '7');
    expect(service.reconnect).toHaveBeenCalledWith(
      { tenantId: 'tenant:session', userId: 'user:session' },
      'game:1',
      7,
    );
    await controller.getRating(request, 'rapid');
    expect(service.getRating).toHaveBeenCalledWith(
      { tenantId: 'tenant:session', userId: 'user:session' },
      'rapid',
    );
    expect(await rejectedStatus(controller.getRating(request, 'all'))).toBe(400);
  });
});
