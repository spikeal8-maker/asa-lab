import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from './api';
import { reportClientDiagnostic } from './client-diagnostics';
import { fetchWithSessionRefresh, onSessionLoggedOut } from './session-fetch';
import { setTelemetryContext } from './telemetry-context';

vi.mock('./client-diagnostics', () => ({ reportClientDiagnostic: vi.fn() }));

afterEach(() => {
  setTelemetryContext(null, false, 'public');
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('confirmed session invalidation', () => {
  function setup() {
    const events = new EventTarget();
    const dispatch = vi.spyOn(events, 'dispatchEvent');
    const removeItem = vi.fn();
    const tab = Object.assign(events, {
      sessionStorage: { 'asa-seat-notes:seat': 'unsaved', removeItem },
      setTimeout,
    });
    vi.stubGlobal('window', tab);
    class Channel {
      static all: Channel[] = [];
      onmessage: ((event: { data: unknown }) => void) | null = null;
      postMessage = vi.fn();
      close = vi.fn();
      constructor() {
        Channel.all.push(this);
      }
    }
    vi.stubGlobal('BroadcastChannel', Channel);
    const denied = new Response(null, { status: 401 });
    const proof = {
      account: () => Promise.resolve(Response.json({ authenticated: false })),
      seat: () => Promise.resolve(Response.json({ authenticated: false })),
    };
    const refresh = vi
      .fn()
      .mockImplementation(async () =>
        Response.json({ error: { code: 'refresh_required' } }, { status: 401 }),
      );
    const transport = vi.fn<typeof fetch>().mockImplementation(async (url) => {
      if (url === '/api/auth/refresh') return refresh();
      if (url === '/api/auth/me') return proof.account();
      if (url === '/api/class-join/me') return proof.seat();
      return denied;
    });
    vi.stubGlobal('fetch', transport);
    return { dispatch, removeItem, Channel, denied, proof, refresh, transport };
  }
  const settle = async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  };
  const nextActor = () =>
    setTelemetryContext(
      { kind: 'student', seatId: 'new-seat', classId: 'class' },
      true,
      'editor.electronics',
    );

  it.each(['account', 'seat'] as const)(
    'keeps a valid %s after resource401 and failed refresh',
    async (kind) => {
      const f = setup();
      f.proof[kind] = async () => Response.json({ authenticated: true });
      expect(await fetchWithSessionRefresh('/api/projects/id')).toBe(f.denied);
      expect(f.removeItem).not.toHaveBeenCalled();
      expect(f.dispatch).not.toHaveBeenCalled();
      expect(f.Channel.all).toHaveLength(0);
      expect(f.transport.mock.calls.map(([url]) => url)).toEqual([
        '/api/projects/id',
        '/api/auth/refresh',
        '/api/auth/me',
        '/api/class-join/me',
      ]);
    },
  );

  it('does not retry the Seat guard409 as a stale Account rotation', async () => {
    const f = setup();
    f.refresh.mockResolvedValue(
      Response.json({ error: { code: 'refresh_not_applicable' } }, { status: 409 }),
    );
    expect(await fetchWithSessionRefresh('/api/projects/id/snapshot', { method: 'PUT' })).toBe(
      f.denied,
    );
    expect(f.transport).toHaveBeenCalledTimes(2);
    expect(f.removeItem).not.toHaveBeenCalled();
    expect(f.Channel.all).toHaveLength(0);
    expect(reportClientDiagnostic).not.toHaveBeenCalled();
  });

  it.each(['expired', 'revoked'])(
    'invalidates a server-confirmed %s session without claiming its exact cause',
    async () => {
      const f = setup();
      expect(await fetchWithSessionRefresh('/api/projects/id')).toBe(f.denied);
      expect(f.removeItem).toHaveBeenCalledExactlyOnceWith('asa-seat-notes:seat');
      expect(f.dispatch).toHaveBeenCalledOnce();
      expect(f.Channel.all[0]!.postMessage).toHaveBeenCalledWith({ type: 'session-unavailable' });
    },
  );

  it.each(['503', 'malformed', 'shape', 'network'] as const)(
    'preserves state for %s identity proof',
    async (failure) => {
      const f = setup();
      f.proof.seat = async () => {
        if (failure === 'network') throw new TypeError('offline');
        return failure === '503'
          ? new Response(null, { status: 503 })
          : failure === 'malformed'
            ? new Response('<html>')
            : Response.json({ authenticated: 'false' });
      };
      expect(await fetchWithSessionRefresh('/api/projects/id')).toBe(f.denied);
      expect(f.removeItem).not.toHaveBeenCalled();
      expect(f.dispatch).not.toHaveBeenCalled();
      expect(f.Channel.all).toHaveLength(0);
    },
  );

  it('preserves state after a transient refresh503 without probing or logout', async () => {
    const f = setup();
    f.refresh.mockResolvedValue(new Response(null, { status: 503 }));
    expect(await fetchWithSessionRefresh('/api/projects/id')).toBe(f.denied);
    expect(f.transport).toHaveBeenCalledTimes(2);
    expect(f.removeItem).not.toHaveBeenCalled();
  });

  it('coalesces concurrent failures into one recovery and one invalidation', async () => {
    const f = setup();
    await Promise.all([
      fetchWithSessionRefresh('/api/projects/a'),
      fetchWithSessionRefresh('/api/projects/b'),
    ]);
    expect(f.refresh).toHaveBeenCalledOnce();
    expect(f.removeItem).toHaveBeenCalledOnce();
    expect(f.transport).toHaveBeenCalledTimes(5);
  });

  it('old recovery completion cannot replace or clear a newer context flight', async () => {
    const f = setup();
    const finishes: ((value: Response) => void)[] = [];
    f.refresh.mockImplementation(() => new Promise<Response>((resolve) => finishes.push(resolve)));
    const old = fetchWithSessionRefresh('/api/projects/old/draft', { method: 'PUT' });
    await settle();
    nextActor();
    const current = fetchWithSessionRefresh('/api/projects/current/draft', { method: 'PUT' });
    await settle();
    expect(f.refresh).toHaveBeenCalledTimes(2);
    finishes[0]!(Response.json({ refreshed: true }));
    expect(await old).toBe(f.denied);
    const joined = fetchWithSessionRefresh('/api/projects/current/snapshot');
    await settle();
    expect(f.refresh).toHaveBeenCalledTimes(2);
    finishes[1]!(new Response(null, { status: 503 }));
    expect(await current).toBe(f.denied);
    expect(await joined).toBe(f.denied);
    expect(f.removeItem).not.toHaveBeenCalled();
  });

  it('bounds a hung identity proof without converting its timeout into logout', async () => {
    const f = setup();
    vi.useFakeTimers();
    f.transport.mockImplementation(async (url, init) => {
      if (url === '/api/auth/refresh') return f.refresh();
      if (url === '/api/auth/me') return Response.json({ authenticated: false });
      if (url === '/api/class-join/me')
        return new Promise<Response>((_, reject) => {
          init!.signal!.addEventListener(
            'abort',
            () => reject(new DOMException('timeout', 'AbortError')),
            { once: true },
          );
        });
      return f.denied;
    });
    try {
      const result = fetchWithSessionRefresh('/api/projects/id');
      await vi.advanceTimersByTimeAsync(5000);
      expect(await result).toBe(f.denied);
      expect(f.removeItem).not.toHaveBeenCalled();
      expect(f.dispatch).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('retains the single stale-rotation retry', async () => {
    const f = setup();
    f.refresh
      .mockResolvedValueOnce(Response.json({ error: { code: 'refresh_stale' } }, { status: 409 }))
      .mockResolvedValueOnce(Response.json({ refreshed: true }));
    await fetchWithSessionRefresh('/api/projects/id');
    expect(f.refresh).toHaveBeenCalledTimes(2);
    expect(f.transport.mock.calls.filter(([url]) => url === '/api/projects/id')).toHaveLength(2);
    expect(f.removeItem).not.toHaveBeenCalled();
  });

  it('does not replay a write after a newer actor replaces the initiating context', async () => {
    const f = setup();
    let finish!: (value: Response) => void;
    f.refresh.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    const result = fetchWithSessionRefresh('/api/projects/id/draft', {
      method: 'PUT',
      body: 'private-document',
    });
    await settle();
    nextActor();
    finish(Response.json({ refreshed: true }));
    expect(await result).toBe(f.denied);
    expect(f.transport).toHaveBeenCalledTimes(2);
    expect(f.removeItem).not.toHaveBeenCalled();
  });

  it('a delayed absence proof cannot invalidate a newer login', async () => {
    const f = setup();
    let finish!: (value: Response) => void;
    f.proof.seat = () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      });
    const result = fetchWithSessionRefresh('/api/projects/id');
    await settle();
    nextActor();
    finish(Response.json({ authenticated: false }));
    expect(await result).toBe(f.denied);
    expect(f.removeItem).not.toHaveBeenCalled();
    expect(f.Channel.all).toHaveLength(0);
  });

  it.each(['request', 'other-tab'] as const)(
    'preserves login queued after proof resolution but before %s invalidation',
    async (source) => {
      const f = setup();
      f.proof.account = async () => new Response(null, { status: 401 });
      f.proof.seat = async () => {
        const response = Response.json({ authenticated: false });
        vi.spyOn(response, 'json').mockResolvedValue(
          Object.defineProperty({}, 'authenticated', {
            get() {
              // Place the concurrent login after Promise.all + proof continuation,
              // immediately before the caller can perform the automatic effect.
              queueMicrotask(() => queueMicrotask(() => queueMicrotask(nextActor)));
              return false;
            },
          }),
        );
        return response;
      };
      const listener = vi.fn();
      const stop = source === 'other-tab' ? onSessionLoggedOut(listener) : () => undefined;
      try {
        if (source === 'request') await fetchWithSessionRefresh('/api/projects/id');
        else {
          f.Channel.all[0]!.onmessage!({ data: { type: 'session-unavailable' } });
          await settle();
        }
        expect(f.removeItem).not.toHaveBeenCalled();
        expect(f.dispatch).not.toHaveBeenCalled();
        expect(listener).not.toHaveBeenCalled();
      } finally {
        stop();
      }
    },
  );

  it.each(['active', 'absent', 'transient'] as const)(
    'another tab rechecks an automatic invalidation with %s authority',
    async (state) => {
      const f = setup();
      const listener = vi.fn();
      const stop = onSessionLoggedOut(listener);
      try {
        if (state === 'active')
          f.proof.account = async () => Response.json({ authenticated: true });
        if (state === 'transient') f.proof.seat = async () => new Response(null, { status: 503 });
        f.Channel.all[0]!.onmessage!({ data: { type: 'session-unavailable' } });
        await settle();
        expect(f.transport).toHaveBeenCalledTimes(2);
        expect(listener).toHaveBeenCalledTimes(state === 'absent' ? 1 : 0);
        expect(f.removeItem).toHaveBeenCalledTimes(state === 'absent' ? 1 : 0);
      } finally {
        stop();
      }
    },
  );

  it('unsubscribed tab ignores a delayed invalidation proof', async () => {
    const f = setup();
    let finish!: (value: Response) => void;
    f.proof.seat = () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      });
    const listener = vi.fn();
    const stop = onSessionLoggedOut(listener);
    f.Channel.all[0]!.onmessage!({ data: { type: 'session-unavailable' } });
    await settle();
    stop();
    finish(Response.json({ authenticated: false }));
    await settle();
    expect(listener).not.toHaveBeenCalled();
    expect(f.removeItem).not.toHaveBeenCalled();
  });

  it('fans one confirmed automatic logout out to every local subscriber exactly once', async () => {
    const f = setup();
    nextActor();
    const app = vi.fn();
    const snapshots = vi.fn();
    const stopApp = onSessionLoggedOut(app);
    const stopSnapshots = onSessionLoggedOut(snapshots);
    try {
      // Each real subscription owns a BroadcastChannel; both receive the hint.
      for (const channel of [...f.Channel.all]) {
        channel.onmessage!({ data: { type: 'session-unavailable' } });
      }
      await settle();
      expect(app).toHaveBeenCalledOnce();
      expect(snapshots).toHaveBeenCalledOnce();
      expect(f.dispatch).toHaveBeenCalledOnce();
      expect(f.removeItem).toHaveBeenCalledOnce();
    } finally {
      stopApp();
      stopSnapshots();
    }
  });

  it('keeps explicit cross-tab logout immediate', () => {
    const f = setup();
    const listener = vi.fn();
    const stop = onSessionLoggedOut(listener);
    f.Channel.all[0]!.onmessage!({ data: { type: 'logged-out' } });
    expect(listener).toHaveBeenCalledOnce();
    expect(f.transport).not.toHaveBeenCalled();
    stop();
  });
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
    '/api/analytics/v2/events',
    '/api/analytics/v2/module-session',
    '/api/analytics/v2/quality?retry=1',
    '/api/diagnostics/quality?retry=1',
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
