import { describe, expect, it, vi } from 'vitest';
import type pg from 'pg';
import { REFRESH_TTL_DAYS, RefreshSessionService } from './refresh-session.service.js';

describe('refresh session service', () => {
  it('stores only hashes when attaching a refresh family', async () => {
    const query = vi.fn(async () => ({ rows: [{ attached: true }] }));
    const service = new RefreshSessionService({ query } as unknown as pg.Pool);

    const refreshToken = await service.attach('access-token', 'password');

    expect(refreshToken).toMatch(/^[0-9a-f]{64}$/);
    const parameters = query.mock.calls[0]?.[1] as unknown[];
    expect(parameters).toEqual([
      expect.stringMatching(/^[0-9a-f]{64}$/),
      expect.stringMatching(/^[0-9a-f]{64}$/),
      'password',
      REFRESH_TTL_DAYS,
    ]);
    expect(parameters).not.toContain('access-token');
    expect(parameters).not.toContain(refreshToken);
  });

  it('returns a new access and refresh pair only after a successful rotation', async () => {
    const query = vi.fn(async () => ({ rows: [{ result: 'rotated' }] }));
    const service = new RefreshSessionService({ query } as unknown as pg.Pool);

    const result = await service.rotate('old-refresh-token');

    expect(result).toMatchObject({
      status: 'rotated',
      accessToken: expect.stringMatching(/^[0-9a-f]{64}$/),
      refreshToken: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    const parameters = query.mock.calls[0]?.[1] as unknown[];
    expect(parameters[0]).toMatch(/^[0-9a-f]{64}$/);
    expect(parameters).not.toContain('old-refresh-token');
  });

  it('does not mint browser tokens for a rejected rotation', async () => {
    const query = vi.fn(async () => ({ rows: [{ result: 'reused' }] }));
    const service = new RefreshSessionService({ query } as unknown as pg.Pool);
    await expect(service.rotate('replayed-token')).resolves.toEqual({ status: 'reused' });
  });
});
