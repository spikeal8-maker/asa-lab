import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import type { ActiveContextUseCase, SeatContextUseCase } from '@asa-lab/identity';
import { AccountVerificationGuard, AllowUnverifiedAccount } from './account-verification.guard.js';
import { AccountVerificationService } from './account-verification.service.js';

function harness(
  input: {
    cookie?: string;
    seatCookie?: string;
    resolveSeat?: boolean;
    method?: string;
    route?: string;
    enabled?: boolean;
    allowed?: boolean;
    resolveAccount?: boolean;
    failure?: Error;
  } = {},
) {
  class Endpoint {
    action() {}
  }
  if (input.allowed)
    AllowUnverifiedAccount()(
      Endpoint.prototype,
      'action',
      Object.getOwnPropertyDescriptor(Endpoint.prototype, 'action')!,
    );
  const resolve = vi
    .fn()
    .mockResolvedValue(input.resolveAccount === false ? null : { accountId: 'account-a' });
  const requireAccount = input.failure
    ? vi.fn().mockRejectedValue(input.failure)
    : vi.fn().mockResolvedValue({ required: false });
  const verification = {
    isEnabled: vi.fn().mockResolvedValue(input.enabled !== false),
    requireAccount,
  };
  const seats = {
    resolve: vi.fn().mockResolvedValue(input.resolveSeat ? { seatId: 'seat-a' } : null),
  };
  const request = {
    method: input.method ?? 'GET',
    routeOptions: { url: input.route ?? '/api/account/profile' },
    cookies: { asa_session: input.cookie, asa_student_session: input.seatCookie },
    headers: { 'x-verification-disabled': 'true', 'x-original-url': '/api/modules' },
  };
  const context = {
    getType: () => 'http',
    getHandler: () => Endpoint.prototype.action,
    getClass: () => Endpoint,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  const guard = new AccountVerificationGuard(
    new Reflector(),
    { resolve } as unknown as ActiveContextUseCase,
    verification as unknown as AccountVerificationService,
    seats as unknown as SeatContextUseCase,
  );
  return { guard, context, resolve, verification, requireAccount, seats };
}

describe('central account verification API guard', () => {
  it('checks a restored existing Account session before a protected handler', async () => {
    const failure = new Error('account_verification_required');
    const test = harness({ cookie: 'valid-session', failure });
    await expect(test.guard.canActivate(test.context)).rejects.toBe(failure);
    expect(test.requireAccount).toHaveBeenCalledWith('account-a');
  });

  it('does not accept a client header claiming that verification is disabled', async () => {
    const test = harness({ cookie: 'valid-session', failure: new Error('required') });
    await expect(test.guard.canActivate(test.context)).rejects.toThrow('required');
  });

  it('lets only explicitly marked identity/recovery handlers run with a restricted session', async () => {
    const test = harness({
      cookie: 'valid-session',
      allowed: true,
      failure: new Error('required'),
    });
    expect(await test.guard.canActivate(test.context)).toBe(true);
    expect(test.resolve).not.toHaveBeenCalled();
    expect(test.requireAccount).not.toHaveBeenCalled();
  });

  it('preserves StudentSeat authentication independently of Account policy', async () => {
    const test = harness({ seatCookie: 'valid-seat' });
    expect(await test.guard.canActivate(test.context)).toBe(true);
    expect(test.verification.isEnabled).not.toHaveBeenCalled();
    expect(test.resolve).not.toHaveBeenCalled();
  });

  it('preserves the existing route denial for invalid or revoked sessions', async () => {
    const test = harness({ cookie: 'invalid-session', resolveAccount: false });
    expect(await test.guard.canActivate(test.context)).toBe(true);
    expect(test.resolve).toHaveBeenCalledWith('invalid-session');
    expect(test.requireAccount).not.toHaveBeenCalled();
  });

  it('does not add Account context queries when the policy is disabled', async () => {
    const test = harness({ cookie: 'valid-session', enabled: false });
    expect(await test.guard.canActivate(test.context)).toBe(true);
    expect(test.resolve).not.toHaveBeenCalled();
  });

  it.each(['/api/modules', '/api/version', '/health/live', '/health/ready', '/health/metrics'])(
    'preserves the public read %s with a restricted Account cookie',
    async (route) => {
      const test = harness({ cookie: 'valid-session', route, failure: new Error('required') });
      expect(await test.guard.canActivate(test.context)).toBe(true);
      expect(test.verification.isEnabled).not.toHaveBeenCalled();
    },
  );

  it.each([
    '/api/gallery',
    '/api/courses',
    '/api/collections',
    '/api/account/profile',
    '/api/modules/private',
  ])('does not mistake the protected read %s for an anonymous endpoint', async (route) => {
    const test = harness({ cookie: 'valid-session', route, failure: new Error('required') });
    await expect(test.guard.canActivate(test.context)).rejects.toThrow('required');
  });

  it('does not turn an allowed public GET into a mutation exception', async () => {
    const test = harness({
      cookie: 'valid-session',
      route: '/api/modules',
      method: 'POST',
      failure: new Error('required'),
    });
    await expect(test.guard.canActivate(test.context)).rejects.toThrow('required');
  });

  it('keeps the dedicated StudentSeat session endpoint independent of an Account cookie', async () => {
    const test = harness({
      cookie: 'valid-session',
      route: '/api/class-join/me',
      failure: new Error('required'),
    });
    expect(await test.guard.canActivate(test.context)).toBe(true);
    expect(test.requireAccount).not.toHaveBeenCalled();
  });

  it('preserves a verified Seat selected before Account by a mixed learner handler', async () => {
    const test = harness({
      cookie: 'valid-session',
      seatCookie: 'valid-seat',
      resolveSeat: true,
      route: '/api/learning/projects/:projectId/context',
      failure: new Error('required'),
    });
    expect(await test.guard.canActivate(test.context)).toBe(true);
    expect(test.seats.resolve).toHaveBeenCalledWith('valid-seat');
    expect(test.requireAccount).not.toHaveBeenCalled();
  });

  it('does not accept a forged Seat cookie on a mixed learner handler', async () => {
    const test = harness({
      cookie: 'valid-session',
      seatCookie: 'forged-seat',
      route: '/api/learning/projects/:projectId/context',
      failure: new Error('required'),
    });
    await expect(test.guard.canActivate(test.context)).rejects.toThrow('required');
  });

  it('does not substitute a Seat on Account-first project endpoints', async () => {
    const test = harness({
      cookie: 'valid-session',
      seatCookie: 'valid-seat',
      resolveSeat: true,
      route: '/api/projects',
      failure: new Error('required'),
    });
    await expect(test.guard.canActivate(test.context)).rejects.toThrow('required');
    expect(test.seats.resolve).not.toHaveBeenCalled();
  });
});
