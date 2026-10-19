import { beforeEach, describe, expect, it, vi } from 'vitest';
import { call } from '../api-call';
import { gameAccessApi } from './game-access-api';

vi.mock('../api-call', () => ({ call: vi.fn() }));
beforeEach(() => vi.clearAllMocks());

describe('server game admission adapter', () => {
  it.each([
    null,
    {},
    { granted: true },
    { granted: true, reason: 'class_disabled', threshold: null },
    { granted: true, reason: 'allowed', threshold: 101 },
  ])('rejects an unverified success body %j', async (data) => {
    vi.mocked(call).mockResolvedValue({ ok: true, status: 200, data });
    expect(await gameAccessApi.read('chess')).toMatchObject({
      ok: false,
      error: { code: 'admission_unavailable' },
    });
  });
  it('reads only the current server-derived game context with no cached class or Seat input', async () => {
    const data = { granted: false, reason: 'rating_below_threshold', threshold: 45.125 };
    vi.mocked(call).mockResolvedValue({ ok: true, status: 200, data });
    expect(await gameAccessApi.read('checkers')).toEqual({ ok: true, status: 200, data });
    expect(call).toHaveBeenCalledWith('/api/games/access?game=checkers', { cache: 'no-store' });
  });
  it('requires both policy version and effective admission for teacher individual controls', async () => {
    const data = {
      mode: 'allow',
      threshold: null,
      state: 'active',
      version: 1,
      override: 'inherit',
    };
    vi.mocked(call).mockResolvedValue({ ok: true, status: 200, data });
    expect((await gameAccessApi.readPolicy('class', 'seat')).ok).toBe(false);
    vi.mocked(call).mockResolvedValue({
      ok: true,
      status: 200,
      data: { ...data, admission: { granted: true, reason: 'allowed', threshold: null } },
    });
    expect((await gameAccessApi.readPolicy('class', 'seat')).ok).toBe(true);
  });
  it('preserves a conflict response instead of adopting an optimistic local policy', async () => {
    const conflict = {
      ok: false as const,
      status: 409,
      error: { code: 'version_conflict', message: 'conflict' },
    };
    vi.mocked(call).mockResolvedValue(conflict);
    expect(
      await gameAccessApi.saveSeat('class', 'seat', { override: 'deny', expectedVersion: 2 }),
    ).toEqual(conflict);
    expect(call).toHaveBeenCalledWith('/api/games/classrooms/class/seats/seat', {
      method: 'PUT',
      body: JSON.stringify({ override: 'deny', expectedVersion: 2 }),
    });
  });
});
