import { describe, it, expect, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { PresentationPreferencesUseCase, type ActiveContextUseCase } from '@asa-lab/identity';
import { PresentationPreferencesController } from './presentation-preferences.controller.js';
const value = { motion: 'system' as const, sidebar: 'expanded' as const, revision: 0 };
const input = {
  motion: 'reduce',
  sidebar: 'collapsed',
  revision: 0,
  requestId: '10000000-0000-4000-8000-000000000001',
};
const accountA = '20000000-0000-4000-8000-000000000001';
const accountB = '20000000-0000-4000-8000-000000000002';
const request = (cookies: Record<string, string>, expected: unknown = accountA) =>
  ({ cookies, headers: { 'x-asa-presentation-account': expected } }) as FastifyRequest;
describe('presentation authenticated Account endpoint', () => {
  it('never resolves a Seat cookie as Account and refuses anonymous writes', async () => {
    const resolve = vi.fn().mockResolvedValue(null),
      write = vi.fn();
    const controller = new PresentationPreferencesController(
      { resolve } as unknown as ActiveContextUseCase,
      new PresentationPreferencesUseCase({ read: vi.fn(), write }),
    );
    await expect(
      controller.write(request({ asa_seat_session: 'seat' }), input),
    ).rejects.toMatchObject({ status: 401 });
    expect(resolve).toHaveBeenCalledWith(undefined);
    expect(write).not.toHaveBeenCalled();
  });
  it('derives only server Account identity, rejects body authority and maps stale writes to409', async () => {
    const read = vi.fn().mockResolvedValue(value),
      write = vi.fn().mockResolvedValue({ code: 'conflict' });
    const controller = new PresentationPreferencesController(
      {
        resolve: vi.fn().mockResolvedValue({ accountId: accountA }),
      } as unknown as ActiveContextUseCase,
      new PresentationPreferencesUseCase({ read, write }),
    );
    expect(await controller.read(request({ asa_session: 'account' }))).toEqual(value);
    expect(read).toHaveBeenCalledWith(accountA);
    await expect(
      controller.write(request({ asa_session: 'account' }), { ...input, accountId: 'foreign' }),
    ).rejects.toMatchObject({ status: 400 });
    expect(write).not.toHaveBeenCalled();
    await expect(
      controller.write(request({ asa_session: 'account' }), input),
    ).rejects.toMatchObject({ status: 409 });
    expect(write).toHaveBeenCalledWith(accountA, input);
  });
  it.each([undefined, '', 'account-a', ' ' + accountA, accountA + ',' + accountB, [accountA], 42])(
    'fails closed for malformed or missing presentation precondition %j before ports',
    async (expected) => {
      const read = vi.fn(),
        write = vi.fn();
      const controller = new PresentationPreferencesController(
        {
          resolve: vi.fn().mockResolvedValue({ accountId: accountA }),
        } as unknown as ActiveContextUseCase,
        new PresentationPreferencesUseCase({ read, write }),
      );
      const req = request({ asa_session: 'a' });
      req.headers['x-asa-presentation-account'] = expected as string;
      await expect(controller.read(req)).rejects.toMatchObject({ status: 400 });
      await expect(controller.write(req, input)).rejects.toMatchObject({ status: 400 });
      expect(read).not.toHaveBeenCalled();
      expect(write).not.toHaveBeenCalled();
    },
  );
  it('checks cookie authority against loaded Account on both reads and writes without disclosing the new actor', async () => {
    const read = vi.fn(),
      write = vi.fn();
    const resolve = vi.fn().mockResolvedValue({ accountId: accountB });
    const controller = new PresentationPreferencesController(
      { resolve } as unknown as ActiveContextUseCase,
      new PresentationPreferencesUseCase({ read, write }),
    );
    for (const result of [
      controller.read(request({ asa_session: 'b' })),
      controller.write(request({ asa_session: 'b' }), input),
    ]) {
      await expect(result).rejects.toMatchObject({
        status: 409,
        response: { error: { code: 'actor_changed' } },
      });
      await result.catch((error) =>
        expect(JSON.stringify(error.getResponse())).not.toContain(accountB),
      );
    }
    expect(resolve).toHaveBeenCalledWith('b');
    expect(read).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    read.mockResolvedValue(value);
    expect(await controller.read(request({ asa_session: 'b' }, accountB))).toEqual(value);
    expect(read).toHaveBeenCalledWith(accountB);
  });
  it('accepts another valid session of the same Account and writes only its cookie-derived target', async () => {
    const snapshot = { motion: 'reduce' as const, sidebar: 'collapsed' as const, revision: 1 };
    const write = vi.fn().mockResolvedValue({ code: 'ok', snapshot });
    const resolve = vi.fn().mockResolvedValue({ accountId: accountA });
    const controller = new PresentationPreferencesController(
      { resolve } as unknown as ActiveContextUseCase,
      new PresentationPreferencesUseCase({ read: vi.fn(), write }),
    );
    expect(
      await controller.write(request({ asa_session: 'another-valid-a-session' }), input),
    ).toEqual(snapshot);
    expect(resolve).toHaveBeenCalledWith('another-valid-a-session');
    expect(write).toHaveBeenCalledWith(accountA, input);
  });
  it.each([{}, { asa_seat_session: 'seat' }])(
    'a valid hint cannot authorize anonymous or Seat GET/PUT %j',
    async (cookies) => {
      const read = vi.fn(),
        write = vi.fn();
      const controller = new PresentationPreferencesController(
        { resolve: vi.fn().mockResolvedValue(null) } as unknown as ActiveContextUseCase,
        new PresentationPreferencesUseCase({ read, write }),
      );
      await expect(controller.read(request(cookies))).rejects.toMatchObject({ status: 401 });
      await expect(controller.write(request(cookies), input)).rejects.toMatchObject({
        status: 401,
      });
      expect(read).not.toHaveBeenCalled();
      expect(write).not.toHaveBeenCalled();
    },
  );
});
