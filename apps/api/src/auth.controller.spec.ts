import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AuthController } from './auth.controller.js';

afterEach(() => vi.restoreAllMocks());

function fixture(cookies: Record<string, string> = {}) {
  const active = { resolve: vi.fn().mockResolvedValue(null), logout: vi.fn() };
  const seats = { resolve: vi.fn().mockResolvedValue(null) };
  const refresh = { rotate: vi.fn(), revoke: vi.fn() };
  const controller = new AuthController(
    ...([{}, active, {}, {}, {}, {}, {}, refresh, {}, seats] as unknown as ConstructorParameters<
      typeof AuthController
    >),
  );
  const reply = { clearCookie: vi.fn(), setCookie: vi.fn() };
  const request = { id: 'trusted-request', cookies } as FastifyRequest;
  const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  const run = () => controller.refresh(request, reply as unknown as FastifyReply);
  return { controller, active, seats, refresh, reply, request, stdout, run };
}

describe('Account refresh and Seat isolation', () => {
  it.each([undefined, 'old-account-refresh-secret'])(
    'never rotates an Account or deletes cookies for a valid Seat (refresh=%s)',
    async (token) => {
      const f = fixture({
        asa_student_session: 'private-seat',
        ...(token ? { asa_refresh: token } : {}),
      });
      f.seats.resolve.mockResolvedValue({ seatId: 'private-seat-id' });
      await expect(f.run()).rejects.toMatchObject({
        status: 409,
        response: { error: { code: 'refresh_not_applicable' } },
      });
      expect(f.refresh.rotate).not.toHaveBeenCalled();
      expect(f.reply.clearCookie).not.toHaveBeenCalled();
      expect(f.reply.setCookie).not.toHaveBeenCalled();
      const log = JSON.parse(String(f.stdout.mock.calls[0]![0]));
      expect(log).toMatchObject({
        kind: 'auth_session_recovery',
        actorKind: 'student',
        sessionKind: 'student',
        reason: 'seat_active',
        outcome: 'skipped',
        requestId: 'trusted-request',
      });
      expect(JSON.stringify(log)).not.toMatch(/private|secret/);
    },
  );

  it('preserves Account-first product priority when both sessions are valid', async () => {
    const f = fixture({
      asa_session: 'account',
      asa_student_session: 'seat',
      asa_refresh: 'refresh',
    });
    f.active.resolve.mockResolvedValue({ accountId: 'account-id' });
    f.refresh.rotate.mockResolvedValue({
      status: 'rotated',
      accessToken: 'next-access',
      refreshToken: 'next-refresh',
    });
    expect(await f.run()).toEqual({ refreshed: true });
    expect(f.seats.resolve).not.toHaveBeenCalled();
    expect(f.refresh.rotate).toHaveBeenCalledWith('refresh');
    expect(f.reply.setCookie.mock.calls.map(([name]) => name)).toEqual([
      'asa_session',
      'asa_refresh',
    ]);
    expect(f.reply.clearCookie).not.toHaveBeenCalled();
  });

  it.each(['missing', 'expired', 'revoked'])(
    'a %s Seat never gains access or changes cookies from a missing Account refresh',
    async (state) => {
      const f = fixture(state === 'missing' ? {} : { asa_student_session: 'unavailable-seat' });
      await expect(f.run()).rejects.toMatchObject({
        status: 401,
        response: { error: { code: 'refresh_required' } },
      });
      expect(f.refresh.rotate).not.toHaveBeenCalled();
      expect(f.reply.clearCookie).not.toHaveBeenCalled();
      expect(f.reply.setCookie).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['invalid', 401],
    ['reused', 401],
    ['stale', 409],
  ] as const)('preserves newer browser cookies when rotation is %s', async (status, code) => {
    const f = fixture({ asa_refresh: 'private-old-refresh', asa_session: 'private-access' });
    f.refresh.rotate.mockResolvedValue({ status });
    await expect(f.run()).rejects.toMatchObject({ status: code });
    expect(f.reply.clearCookie).not.toHaveBeenCalled();
    expect(f.reply.setCookie).not.toHaveBeenCalled();
    expect(JSON.stringify(f.stdout.mock.calls)).not.toContain('private');
  });

  it('does not rotate or erase sessions when the Seat resolver is unavailable', async () => {
    const f = fixture({ asa_student_session: 'seat', asa_refresh: 'refresh' });
    const failure = new Error('database unavailable');
    f.seats.resolve.mockRejectedValue(failure);
    await expect(f.run()).rejects.toBe(failure);
    expect(f.refresh.rotate).not.toHaveBeenCalled();
    expect(f.reply.clearCookie).not.toHaveBeenCalled();
  });

  it('keeps successful rotation independent of logging failure', async () => {
    const f = fixture({ asa_refresh: 'refresh' });
    f.stdout.mockImplementation(() => {
      throw new Error('log sink');
    });
    f.refresh.rotate.mockResolvedValue({
      status: 'rotated',
      accessToken: 'access',
      refreshToken: 'refresh-next',
    });
    expect(await f.run()).toEqual({ refreshed: true });
    expect(f.reply.setCookie).toHaveBeenCalledTimes(2);
  });

  it('retains explicit logout revocation and cookie clearing', async () => {
    const f = fixture({
      asa_session: 'account',
      asa_refresh: 'refresh',
      asa_student_session: 'seat',
    });
    expect(await f.controller.logout(f.request, f.reply as unknown as FastifyReply)).toEqual({
      ok: true,
    });
    expect(f.refresh.revoke).toHaveBeenCalledWith('refresh', 'account', 'seat');
    expect(f.active.logout).toHaveBeenCalledWith('account');
    expect(f.reply.clearCookie.mock.calls.map(([name]) => name)).toEqual([
      'asa_session',
      'asa_student_session',
      'asa_refresh',
    ]);
  });
});
