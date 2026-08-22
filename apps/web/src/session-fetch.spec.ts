import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchWithSessionRefresh } from './session-fetch';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('session-aware fetch', () => {
  it('refreshes once after 401 and retries the original request', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ refreshed: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await fetchWithSessionRefresh('/api/projects');

    expect(response.status).toBe(200);
    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
      '/api/projects',
      '/api/auth/refresh',
      '/api/projects',
    ]);
  });

  it('never turns a 403 permission denial into a session refresh', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 403 }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await fetchWithSessionRefresh('/api/admin/v1/me');

    expect(response.status).toBe(403);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not recurse when password login itself returns 401', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await fetchWithSessionRefresh('/api/auth/login', { method: 'POST' });

    expect(response.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
