import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from './api';
import { reportClientDiagnostic } from './client-diagnostics';
import { fetchWithSessionRefresh } from './session-fetch';

vi.mock('./client-diagnostics', () => ({ reportClientDiagnostic: vi.fn() }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('session-aware fetch', () => {
  const telemetryCalls = [
    {
      name: 'module opened',
      path: '/api/analytics/v1/module-opened',
      send: () => api.recordModuleOpened('electronics'),
      keepalive: undefined,
    },
    {
      name: 'module session start',
      path: '/api/analytics/v1/module-session/start',
      send: () => api.startModuleSession('session-id', 'project-id', 'electronics'),
      keepalive: undefined,
    },
    {
      name: 'module session touch',
      path: '/api/analytics/v1/module-session/touch',
      send: () => api.touchModuleSession('session-id'),
      keepalive: false,
    },
    {
      name: 'module session close',
      path: '/api/analytics/v1/module-session/touch',
      send: () => api.touchModuleSession('session-id', true, true),
      keepalive: true,
    },
  ];

  function watchSessionEffects() {
    const removeItem = vi.fn();
    const dispatchEvent = vi.fn();
    const broadcastChannel = vi.fn();
    vi.stubGlobal('window', {
      dispatchEvent,
      sessionStorage: {
        'asa-seat-notes:seat-id': 'learner notes',
        'asa-pending-create:account-id': 'pending project',
        'asa-project-scroll:project-id': 'scroll position',
        removeItem,
      },
    });
    vi.stubGlobal('BroadcastChannel', broadcastChannel);
    return { removeItem, dispatchEvent, broadcastChannel };
  }

  function expectNoSessionEffects(effects: ReturnType<typeof watchSessionEffects>) {
    expect(effects.removeItem).not.toHaveBeenCalled();
    expect(effects.dispatchEvent).not.toHaveBeenCalled();
    expect(effects.broadcastChannel).not.toHaveBeenCalled();
    expect(reportClientDiagnostic).not.toHaveBeenCalled();
  }

  describe.each(['Account', 'StudentSeat'])('%s telemetry', () => {
    it.each(telemetryCalls)('returns $name 401 without changing sessions', async (telemetry) => {
      const effects = watchSessionEffects();
      const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({ error: { code: 'unauthorized', message: 'no session' } }), {
          status: 401,
        }),
      );
      vi.stubGlobal('fetch', fetchMock);

      expect(await telemetry.send()).toEqual({
        ok: false,
        status: 401,
        error: { code: 'unauthorized', message: 'no session' },
      });
      expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
        telemetry.path,
        expect.objectContaining({
          method: 'POST',
          credentials: 'same-origin',
          cache: 'no-store',
          ...(telemetry.keepalive === undefined ? {} : { keepalive: telemetry.keepalive }),
        }),
      );
      expectNoSessionEffects(effects);
    });
  });

  it.each([
    '/api/analytics/v1/module-opened?retry=1',
    '/api/analytics/v1/module-session/start?retry=1',
    '/api/analytics/v1/module-session/touch?closed=true',
    '/api/analytics?version=1',
    '/api/diagnostics/client',
    '/api/diagnostics/client?retry=1',
    '/api/diagnostics?version=1',
  ])('does not refresh telemetry route %s with a query', async (path) => {
    const effects = watchSessionEffects();
    const denied = new Response(null, { status: 401 });
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(denied);
    vi.stubGlobal('fetch', fetchMock);

    expect(await fetchWithSessionRefresh(path, { method: 'POST', keepalive: true })).toBe(denied);
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      path,
      expect.objectContaining({ method: 'POST', keepalive: true, credentials: 'same-origin' }),
    );
    expectNoSessionEffects(effects);
  });

  it.each(telemetryCalls)(
    'returns $name service failures without authentication effects',
    async (telemetry) => {
      const effects = watchSessionEffects();
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ error: { code: 'unavailable', message: 'try later' } }), {
            status: 503,
          }),
        )
        .mockRejectedValueOnce(new TypeError('network unavailable'));
      vi.stubGlobal('fetch', fetchMock);

      expect(await telemetry.send()).toEqual({
        ok: false,
        status: 503,
        error: { code: 'unavailable', message: 'try later' },
      });
      expect(await telemetry.send()).toEqual({
        ok: false,
        status: 0,
        error: { code: 'network', message: 'сервер недоступен' },
      });
      expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([telemetry.path, telemetry.path]);
      expectNoSessionEffects(effects);
    },
  );

  it('does not turn read-only learner preview into a session refresh write', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);
    const response = await fetchWithSessionRefresh(
      '/api/learning/activities/id/preview?source=draft&draftRevision=1',
    );
    expect(response.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('does not refresh an Account session after a StudentSeat auth failure', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);
    expect((await fetchWithSessionRefresh('/api/class-join/me/assignments')).status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

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
