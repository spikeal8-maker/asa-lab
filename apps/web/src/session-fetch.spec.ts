import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from './api';
import { reportClientDiagnostic } from './client-diagnostics';
import { fetchWithSessionRefresh, onSessionLoggedOut } from './session-fetch';
import { setTelemetryContext } from './telemetry-context';
import { AUTH_REQUEST_TIMEOUT_MS } from './auth-request';
import { invalidatePortalSession } from './portal-requests';
import { call } from './api-call';

vi.mock('./client-diagnostics', () => ({ reportClientDiagnostic: vi.fn() }));

afterEach(() => {
  invalidatePortalSession();
  vi.useRealTimers();
  // A new fixture is a new authentication lifetime, even if both are anonymous.
  setTelemetryContext(null, true, 'public');
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
      retryAfterRefresh: 'idempotent',
      body: JSON.stringify({
        document: 'private-document',
        baseRevision: 1,
        mutationId: '10000000-0000-4000-8000-000000000001',
      }),
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

describe('authentication deadlines preserve shared refresh', () => {
  it('lets a live waiter finish when another waiter cancels', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    let finishRefresh!: (response: Response) => void;
    const observed: { signal?: AbortSignal | null | undefined } = {};
    const counts = new Map<string, number>();
    const transport = vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
      const path = String(url);
      counts.set(path, (counts.get(path) ?? 0) + 1);
      if (path === '/api/auth/refresh') {
        observed.signal = init?.signal;
        return new Promise<Response>((resolve) => {
          finishRefresh = resolve;
        });
      }
      return new Response(null, { status: counts.get(path) === 1 ? 401 : 200 });
    });
    vi.stubGlobal('fetch', transport);
    const cancelled = fetchWithSessionRefresh('/api/projects/cancelled', {
      signal: controller.signal,
    }).then(
      () => 'unexpected-success',
      () => 'cancelled',
    );
    const live = fetchWithSessionRefresh('/api/projects/live');
    await vi.advanceTimersByTimeAsync(0);
    expect(counts.get('/api/auth/refresh')).toBe(1);
    controller.abort();
    await expect(cancelled).resolves.toBe('cancelled');
    expect(observed.signal?.aborted).toBe(false);
    finishRefresh(Response.json({ refreshed: true }));
    expect((await live).status).toBe(200);
    expect(counts.get('/api/projects/cancelled')).toBe(1);
    expect(counts.get('/api/projects/live')).toBe(2);
  });

  it('clears a stalled refresh and never retries the expired auth request after a late success', async () => {
    vi.useFakeTimers();
    let finishLate!: (response: Response) => void;
    let refreshCount = 0;
    let refreshed = false;
    const paths: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockImplementation(async (url) => {
        const path = String(url);
        paths.push(path);
        if (path === '/api/auth/refresh') {
          refreshCount += 1;
          if (refreshCount === 1)
            return new Promise<Response>((resolve) => {
              finishLate = resolve;
            });
          refreshed = true;
          return Response.json({ refreshed: true });
        }
        return refreshed
          ? Response.json({ authenticated: true })
          : new Response(null, { status: 401 });
      }),
    );
    const timedOut = api.accountVerification();
    await vi.advanceTimersByTimeAsync(AUTH_REQUEST_TIMEOUT_MS + 1);
    await expect(timedOut).resolves.toMatchObject({ ok: false, error: { code: 'auth_timeout' } });
    // A newly mounted caller must not immediately repeat the expired refresh.
    await expect(api.me()).resolves.toMatchObject({ ok: false, status: 401 });
    expect(refreshCount).toBe(1);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(api.me()).resolves.toMatchObject({ ok: true, data: { authenticated: true } });
    finishLate(Response.json({ refreshed: true }));
    await vi.advanceTimersByTimeAsync(0);
    expect(refreshCount).toBe(2);
    expect(paths.filter((path) => path === '/api/auth/verification')).toHaveLength(1);
    expect(paths.filter((path) => path === '/api/auth/me')).toHaveLength(3);
  });

  it('bounds a stalled refresh error body without replaying a mutation', async () => {
    vi.useFakeTimers();
    const response = new Response(null, { status: 409 });
    const clone = response.clone();
    vi.spyOn(clone, 'json').mockImplementation(() => new Promise<never>(() => undefined));
    vi.spyOn(response, 'clone').mockReturnValue(clone);
    const transport = vi
      .fn<typeof fetch>()
      .mockImplementation(async (url) =>
        String(url) === '/api/auth/refresh' ? response : new Response(null, { status: 401 }),
      );
    vi.stubGlobal('fetch', transport);
    const result = fetchWithSessionRefresh('/api/projects/id/snapshot', { method: 'PUT' });
    await vi.advanceTimersByTimeAsync(AUTH_REQUEST_TIMEOUT_MS);
    expect((await result).status).toBe(401);
    expect(transport.mock.calls.map(([path]) => path)).toEqual([
      '/api/projects/id/snapshot',
      '/api/auth/refresh',
    ]);
  });
});

describe('bounded recovery waves and explicit replay contracts', () => {
  const settle = async () => {
    for (let index = 0; index < 40; index++) await Promise.resolve();
  };

  it('reuses a completed refresh for a delayed 401 from the same wave', async () => {
    let finishSlow!: (value: Response) => void;
    const attempts = new Map<string, number>();
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (url) => {
      const path = String(url);
      attempts.set(path, (attempts.get(path) ?? 0) + 1);
      if (path === '/api/auth/refresh') return Response.json({ refreshed: true });
      if (path === '/api/projects/slow' && attempts.get(path) === 1)
        return new Promise<Response>((resolve) => {
          finishSlow = resolve;
        });
      return Response.json({}, { status: attempts.get(path) === 1 ? 401 : 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const slow = fetchWithSessionRefresh('/api/projects/slow');
    expect((await fetchWithSessionRefresh('/api/projects/fast')).status).toBe(200);
    finishSlow(new Response(null, { status: 401 }));
    expect((await slow).status).toBe(200);
    expect(attempts.get('/api/auth/refresh')).toBe(1);
    expect(attempts.get('/api/projects/slow')).toBe(2);
  });

  it('bounds repeated 60-client failure waves and respects Retry-After', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const refresh = vi.fn(
      async () => new Response(null, { status: 503, headers: { 'retry-after': '3' } }),
    );
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockImplementation(async (path) =>
          path === '/api/auth/refresh' ? refresh() : new Response(null, { status: 401 }),
        ),
    );
    const wave = () =>
      Promise.all(
        Array.from({ length: 60 }, (_, index) =>
          fetchWithSessionRefresh(`/api/projects/fixture-${index}`),
        ),
      );
    expect((await wave()).every((response) => response.status === 401)).toBe(true);
    expect(refresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2999);
    await wave();
    expect(refresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await wave();
    expect(refresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(500);
    await wave();
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it.each([0, 1])(
    'adds positive refresh jitter after Retry-After for random=%s',
    async (random) => {
      vi.useFakeTimers();
      vi.spyOn(Math, 'random').mockReturnValue(random);
      const refresh = vi.fn(
        async () => new Response(null, { status: 503, headers: { 'retry-after': '3' } }),
      );
      vi.stubGlobal(
        'fetch',
        vi
          .fn<typeof fetch>()
          .mockImplementation(async (path) =>
            path === '/api/auth/refresh' ? refresh() : new Response(null, { status: 401 }),
          ),
      );
      await fetchWithSessionRefresh('/api/projects/fixture');
      await vi.advanceTimersByTimeAsync(3000);
      await fetchWithSessionRefresh('/api/projects/fixture');
      expect(refresh).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(200);
      await fetchWithSessionRefresh('/api/projects/fixture');
      expect(refresh).toHaveBeenCalledTimes(random === 0 ? 2 : 1);
      if (random === 1) {
        await vi.advanceTimersByTimeAsync(400);
        await fetchWithSessionRefresh('/api/projects/fixture');
        expect(refresh).toHaveBeenCalledTimes(2);
      }
    },
  );

  it('does not carry a recovery cooldown into another user or workspace', async () => {
    vi.useFakeTimers();
    const refresh = vi.fn(async () => new Response(null, { status: 503 }));
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockImplementation(async (path) =>
          path === '/api/auth/refresh' ? refresh() : new Response(null, { status: 401 }),
        ),
    );
    await fetchWithSessionRefresh('/api/projects/original');
    setTelemetryContext(
      { kind: 'account', accountId: 'new-account', workspaceId: 'new-workspace' },
      true,
      'projects',
    );
    await fetchWithSessionRefresh('/api/projects/successor');
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('starts shared refresh outside the occupied product queue', async () => {
    let finishRefresh!: (value: Response) => void;
    let refreshed = false;
    const attempts = new Map<string, number>();
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (url) => {
      const path = String(url);
      attempts.set(path, (attempts.get(path) ?? 0) + 1);
      if (path === '/api/auth/refresh')
        return new Promise<Response>((resolve) => {
          finishRefresh = resolve;
        });
      return Response.json({}, { status: refreshed ? 200 : 401 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const requests = Array.from({ length: 12 }, (_, index) =>
      call(`/api/projects?fixture=${index}`),
    );
    await settle();
    expect(attempts.get('/api/auth/refresh')).toBe(1);
    refreshed = true;
    finishRefresh(Response.json({ refreshed: true }));
    expect((await Promise.all(requests)).every((response) => response.ok)).toBe(true);
    expect(attempts.get('/api/auth/refresh')).toBe(1);
  });

  it('never replays an opted-in write across a pending scope boundary', async () => {
    let finish!: (value: Response) => void;
    const denied = new Response(null, { status: 401 });
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (path) => {
      if (path === '/api/auth/refresh')
        return new Promise<Response>((resolve) => {
          finish = resolve;
        });
      return denied;
    });
    vi.stubGlobal('fetch', fetchMock);
    const saving = fetchWithSessionRefresh('/api/projects/p/draft', {
      method: 'PUT',
      retryAfterRefresh: 'idempotent',
      body: JSON.stringify({
        document: { nodes: ['work'] },
        baseRevision: 7,
        mutationId: '10000000-0000-4000-8000-000000000001',
      }),
    });
    await settle();
    // The canonical successor has not reached App/telemetry yet.
    invalidatePortalSession();
    finish(Response.json({ refreshed: true }));
    expect(await saving).toBe(denied);
    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
      '/api/projects/p/draft',
      '/api/auth/refresh',
    ]);
  });

  it.each([
    { path: '/api/projects/p/versions/v/restore', method: 'POST' },
    { path: '/api/projects/p', method: 'PATCH' },
    { path: '/api/projects/p/snapshot', method: 'PUT' },
    { path: '/api/unproved', method: 'POST', retryAfterRefresh: 'idempotent' as const },
    { path: '/api/projects', method: 'POST' },
    { path: '/api/projects/p/draft', method: 'PUT', retryAfterRefresh: 'idempotent' as const },
  ])('refreshes but never replays unproved $method $path', async ({ path, ...init }) => {
    const denied = new Response(null, { status: 401 });
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(async (url) =>
        url === '/api/auth/refresh' ? Response.json({ refreshed: true }) : denied,
      );
    vi.stubGlobal('fetch', fetchMock);
    expect(
      await fetchWithSessionRefresh(path, {
        ...init,
        body: '{}',
        headers: { 'idempotency-key': 'present-but-not-a-proven-route' },
      }),
    ).toBe(denied);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([path, '/api/auth/refresh']);
  });

  it('replays one exact project create with its existing idempotency key', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(Response.json({ refreshed: true }))
      .mockResolvedValueOnce(
        Response.json({ project: { id: 'saved' }, created: true }, { status: 201 }),
      );
    vi.stubGlobal('fetch', fetchMock);
    expect(
      await api.createProject({
        scope: 'personal',
        module: 'electronics',
        title: 'Saved once',
        idempotencyKey: '10000000-0000-4000-8000-000000000001',
      }),
    ).toMatchObject({ ok: true, status: 201, data: { created: true } });
    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
      '/api/projects',
      '/api/auth/refresh',
      '/api/projects',
    ]);
    expect(fetchMock.mock.calls[0]![1]!.body).toBe(fetchMock.mock.calls[2]![1]!.body);
    expect(fetchMock.mock.calls[0]![1]!.headers).toEqual(fetchMock.mock.calls[2]![1]!.headers);
    expect(fetchMock.mock.calls[2]![1]).not.toHaveProperty('retryAfterRefresh');
  });

  it('preserves autosave recovery with the same generated draft mutation and revision', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(Response.json({ refreshed: true }))
      .mockResolvedValueOnce(Response.json({ draft: { revision: 8 }, result: null }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await api.saveDraft('project-a', { nodes: ['work'] }, 7)).toMatchObject({
      ok: true,
      data: { draft: { revision: 8 } },
    });
    const body = String(fetchMock.mock.calls[0]![1]!.body);
    expect(JSON.parse(body)).toMatchObject({ document: { nodes: ['work'] }, baseRevision: 7 });
    expect(JSON.parse(body).mutationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(fetchMock.mock.calls[2]![1]!.body).toBe(body);
    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
      '/api/projects/project-a/draft',
      '/api/auth/refresh',
      '/api/projects/project-a/draft',
    ]);
  });
});
