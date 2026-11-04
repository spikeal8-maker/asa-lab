import { describe, expect, it, vi } from 'vitest';
import type pg from 'pg';
import type { FastifyRequest } from 'fastify';
import type { ActiveContextUseCase } from '@asa-lab/identity';
import type { SeatContextUseCase } from './seat-context';
import { ChessNetworkController } from './chess-network.controller';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { ChessNetworkService, ChessNetworkError } from '@asa-lab/games';
import { TOKENS } from './tokens';

@Module({})
class GamesHttpFixture {}

function fixture() {
  const accounts = {
    resolve: vi.fn(async () => ({ accountId: 'account', principalId: 'principal' })),
  };
  const seats = { resolve: vi.fn(async () => ({ seatId: 'seat' })) };
  const pool = {
    connect: vi.fn(() => {
      throw new Error('unexpected database call');
    }),
  };
  const controller = new ChessNetworkController(
    accounts as unknown as ActiveContextUseCase,
    seats as unknown as SeatContextUseCase,
    pool as unknown as pg.Pool,
  );
  const request = (cookies: Record<string, string>) =>
    ({ cookies, method: 'POST', headers: {} }) as unknown as FastifyRequest;
  return { controller, accounts, seats, pool, request };
}
describe('Chess Games API trust boundary', () => {
  it('projects canonical error codes/status/requestId and retry delay on the real HTTP boundary', async () => {
    const f = fixture();
    const adapter = new FastifyAdapter();
    const app = await NestFactory.create<NestFastifyApplication>(
      {
        module: GamesHttpFixture,
        controllers: [ChessNetworkController],
        providers: [
          { provide: TOKENS.activeContextUseCase, useValue: f.accounts },
          { provide: TOKENS.seatContextUseCase, useValue: f.seats },
          { provide: TOKENS.pool, useValue: f.pool },
        ],
      },
      adapter,
      { logger: false },
    );
    adapter.getInstance().addHook('onRequest', async (request) => {
      request.cookies = { asa_session: 'account' };
    });
    const action = vi.spyOn(ChessNetworkService.prototype, 'action');
    try {
      await app.init();
      await adapter.getInstance().ready();
      for (const [internal, code, status] of [
        ['ILLEGAL_MOVE', 'GAME_COMMAND_REJECTED', 422],
        ['NOT_YOUR_TURN', 'GAME_COMMAND_REJECTED', 422],
        ['MATCH_FINISHED', 'MATCH_FINISHED', 409],
        ['INVALID_STATE', 'STATE_CONFLICT', 409],
        ['INVITE_EXPIRED', 'INVITE_EXPIRED', 410],
        ['RATE_LIMITED', 'RATE_LIMITED', 429],
        ['POLICY_DENIED', 'FORBIDDEN', 403],
      ] as const) {
        action.mockRejectedValueOnce(
          new ChessNetworkError(internal, 'Safe reason', internal === 'RATE_LIMITED' ? 429 : 409),
        );
        const response = await adapter.getInstance().inject({
          method: 'POST',
          url: '/api/games/chess/matches/match/commands',
          headers: { 'idempotency-key': 'command' },
          payload: { expectedVersion: 1, action: 'move', uci: 'e2e5' },
        });
        expect(response.statusCode).toBe(status);
        expect(response.json()).toEqual({
          error: { code, message: 'Safe reason', requestId: expect.any(String) },
        });
        if (status === 429) expect(response.headers['retry-after']).toBe('60');
      }
      const invalid = await adapter.getInstance().inject({
        method: 'POST',
        url: '/api/games/chess/matches/match/commands',
        payload: { currentFen: 'forged' },
      });
      expect(invalid.statusCode).toBe(400);
      expect(invalid.json().error).toMatchObject({
        code: 'VALIDATION_FAILED',
        requestId: expect.any(String),
      });
      const noKey = await adapter.getInstance().inject({
        method: 'PUT',
        url: '/api/games/chess/policy/class',
        payload: { enabled: true, scope: 'school', expectedVersion: 0 },
      });
      expect(noKey.statusCode).toBe(400);
      expect(noKey.json().error.code).toBe('VALIDATION_FAILED');
      const notifications = vi
        .spyOn(ChessNetworkService.prototype, 'notifications')
        .mockResolvedValue({ playerId: 'safe-player', incoming: [] });
      try {
        const accountCalls = f.accounts.resolve.mock.calls.length;
        for (const headers of [
          {},
          { 'x-game-presence': '0' },
          { 'x-game-presence': '1', 'sec-fetch-site': 'cross-site' },
        ]) {
          const blocked = await adapter
            .getInstance()
            .inject({ method: 'GET', url: '/api/games/chess/notifications', headers });
          expect(blocked.statusCode).toBe(403);
        }
        expect(f.accounts.resolve.mock.calls.length).toBe(accountCalls);
        const forged = await adapter.getInstance().inject({
          method: 'GET',
          url: '/api/games/chess/notifications?playerId=other',
          headers: { 'x-game-presence': '1' },
        });
        expect(forged.statusCode).toBe(400);
        expect(notifications).not.toHaveBeenCalled();
        const alerts = await adapter.getInstance().inject({
          method: 'GET',
          url: '/api/games/chess/notifications',
          headers: { 'x-game-presence': '1', 'sec-fetch-site': 'same-origin' },
        });
        expect(alerts.statusCode).toBe(200);
        expect(alerts.headers['cache-control']).toBe('private, no-store');
        expect(alerts.json()).toEqual({ playerId: 'safe-player', incoming: [] });
        expect(notifications).toHaveBeenCalledWith(expect.objectContaining({ kind: 'account' }));
      } finally {
        notifications.mockRestore();
      }
      const avatar = vi.spyOn(ChessNetworkService.prototype, 'avatar');
      const lobby = vi.spyOn(ChessNetworkService.prototype, 'lobby');
      try {
        avatar.mockResolvedValueOnce({
          dataUrl: null,
          defaultPath: '/assets/avatars/default/avatar-07.webp',
        });
        const redirected = await adapter.getInstance().inject({
          method: 'GET',
          url: '/api/games/chess/players/00000000-0000-4000-8000-000000000001/avatar?scope=classroom',
        });
        expect(redirected.statusCode).toBe(302);
        expect(redirected.headers['location']).toBe('/assets/avatars/default/avatar-07.webp');
        expect(redirected.headers['cache-control']).toBe('private, no-store');
        avatar.mockResolvedValueOnce({
          dataUrl:
            'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jfL8AAAAASUVORK5CYII=',
          defaultPath: '/assets/avatars/default/avatar-07.webp',
        });
        const raster = await adapter.getInstance().inject({
          method: 'GET',
          url: '/api/games/chess/players/00000000-0000-4000-8000-000000000001/avatar?scope=classroom',
        });
        expect(raster.headers['content-type']).toBe('image/png');
        expect(raster.headers['x-content-type-options']).toBe('nosniff');
        expect(raster.rawPayload.subarray(0, 8)).toEqual(
          Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        );
        avatar.mockRejectedValueOnce(new ChessNetworkError('POLICY_DENIED', 'Restricted', 403));
        const deniedAvatar = await adapter.getInstance().inject({
          method: 'GET',
          url: '/api/games/chess/players/00000000-0000-4000-8000-000000000001/avatar?scope=platform',
        });
        expect(deniedAvatar.statusCode).toBe(403);
        expect(deniedAvatar.headers['cache-control']).toBe('private, no-store');
        const forgedLobby = await adapter.getInstance().inject({
          method: 'POST',
          url: '/api/games/chess/lobby',
          payload: { scope: 'classroom', classroomId: 'foreign' },
        });
        expect(forgedLobby.statusCode).toBe(400);
        expect(lobby).not.toHaveBeenCalled();
        lobby.mockResolvedValueOnce({
          available: true,
          players: [],
          incoming: [],
          outgoing: [],
          limit: 100,
        });
        const listed = await adapter.getInstance().inject({
          method: 'POST',
          url: '/api/games/chess/lobby',
          payload: { scope: 'classroom' },
        });
        expect(listed.statusCode).toBe(201);
        expect(lobby).toHaveBeenCalledWith(
          expect.objectContaining({ kind: 'account' }),
          'classroom',
        );
        const challengeWithoutKey = await adapter.getInstance().inject({
          method: 'POST',
          url: '/api/games/chess/players/00000000-0000-4000-8000-000000000001/challenge',
          payload: {
            scope: 'platform',
            initialMs: 600000,
            incrementMs: 0,
            colorPreference: 'white',
          },
        });
        expect(challengeWithoutKey.statusCode).toBe(400);
      } finally {
        avatar.mockRestore();
        lobby.mockRestore();
      }
    } finally {
      action.mockRestore();
      await app.close();
    }
  }, 15000);
  it('rejects simultaneous cookies before selecting either identity', async () => {
    const f = fixture();
    await expect(
      f.controller.access(f.request({ asa_session: 'account', asa_student_session: 'seat' })),
    ).rejects.toMatchObject({ response: { error: { code: 'session_conflict' } } });
    expect(f.accounts.resolve).not.toHaveBeenCalled();
    expect(f.seats.resolve).not.toHaveBeenCalled();
  });
  it('never falls back to Account after an empty/invalid StudentSeat cookie', async () => {
    const f = fixture();
    await expect(f.controller.access(f.request({ asa_student_session: '' }))).rejects.toMatchObject(
      { response: { error: { code: 'UNAUTHORIZED' } } },
    );
    expect(f.accounts.resolve).not.toHaveBeenCalled();
  });
  it.each([
    'playerId',
    'accountId',
    'tenantId',
    'schoolId',
    'classroomId',
    'currentFen',
    'result',
    'clock',
    'whitePlayerId',
  ])('rejects client authority field %s before reaching a transaction', async (field) => {
    const f = fixture();
    await expect(
      f.controller.create(f.request({ asa_session: 'account' }), 'safe-command', {
        scope: 'platform',
        initialMs: 600000,
        incrementMs: 0,
        colorPreference: 'white',
        [field]: 'forged',
      }),
    ).rejects.toMatchObject({ response: { error: { code: 'INVALID_COMMAND' } } });
    expect(f.pool.connect).not.toHaveBeenCalled();
  });
  it.each(['scope', 'colorPreference'])(
    'rejects array-coerced %s before database authority',
    async (field) => {
      const f = fixture();
      await expect(
        f.controller.create(f.request({ asa_session: 'account' }), 'safe-command', {
          scope: 'platform',
          initialMs: 600000,
          incrementMs: 0,
          colorPreference: 'white',
          [field]: [field === 'scope' ? 'platform' : 'white'],
        }),
      ).rejects.toMatchObject({ response: { error: { code: 'INVALID_COMMAND' } } });
      expect(f.pool.connect).not.toHaveBeenCalled();
    },
  );
  it('rejects forged match state and invalid version/action shape', async () => {
    const f = fixture();
    await expect(
      f.controller.action(f.request({ asa_session: 'account' }), 'id', 'key', {
        expectedVersion: 1,
        action: ['draw-decline'],
      }),
    ).rejects.toMatchObject({ response: { error: { code: 'INVALID_COMMAND' } } });
    await expect(
      f.controller.action(f.request({ asa_session: 'account' }), 'id', 'key', {
        expectedVersion: 1,
        action: 'move',
        uci: 'e2e4',
        currentFen: 'forged',
      }),
    ).rejects.toMatchObject({ response: { error: { code: 'INVALID_COMMAND' } } });
    await expect(
      f.controller.action(f.request({ asa_session: 'account' }), 'id', 'key', {
        expectedVersion: 1,
        action: 'resign',
        uci: 'e2e4',
      }),
    ).rejects.toMatchObject({ response: { error: { code: 'INVALID_COMMAND' } } });
  });
});
