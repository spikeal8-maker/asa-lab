import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { call } from './api-call';
import {
  invalidatePortalSession,
  onPortalMutation,
  portalAttentionRoute,
  portalSessionKey,
  setPortalSessionKey,
} from './portal-requests';

vi.mock('./client-diagnostics', () => ({ reportClientDiagnostic: vi.fn() }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}
const settle = async () => {
  for (let index = 0; index < 40; index++) await Promise.resolve();
};

beforeEach(() => invalidatePortalSession());
afterEach(async () => {
  invalidatePortalSession();
  await settle();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('portal GET admission', () => {
  it.each([
    '/api/auth/me',
    '/api/class-join/me',
    '/api/class-join/me/assignment-counts',
    '/api/projects?scope=personal&limit=40',
    '/api/public-projects?offset=0&limit=24',
    '/api/modules',
  ])('shares an in-flight %s, never a completed identity or data response', async (path) => {
    const response = deferred<Response>();
    const fetchMock = vi.fn<typeof fetch>().mockReturnValueOnce(response.promise);
    vi.stubGlobal('fetch', fetchMock);
    const first = call<{ value: { revision: number } }>(path);
    const second = call<{ value: { revision: number } }>(path);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    response.resolve(Response.json({ value: { revision: 1 } }));
    const [a, b] = await Promise.all([first, second]);
    expect(a).toEqual(b);
    if (!a.ok || !b.ok) throw new Error('read failed');
    a.data.value.revision = 99;
    expect(b.data.value.revision).toBe(1);
    fetchMock.mockResolvedValueOnce(Response.json({ value: { revision: 2 } }));
    expect(await call(path)).toMatchObject({ ok: true, data: { value: { revision: 2 } } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps query, representation and credentials distinct while canonicalizing header syntax', async () => {
    const pending: ReturnType<typeof deferred<Response>>[] = [];
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(() => {
      const item = deferred<Response>();
      pending.push(item);
      return item.promise;
    });
    vi.stubGlobal('fetch', fetchMock);
    const requests = [
      call('/api/projects?module=electronics', {
        headers: new Headers({ Accept: 'application/json' }),
      }),
      call('/api/projects?module=electronics', { headers: [['accept', 'application/json']] }),
      call('/api/projects?module=three-d', { headers: { accept: 'application/json' } }),
      call('/api/projects?module=electronics', { headers: { accept: 'application/problem+json' } }),
      call('/api/projects?module=electronics', {
        headers: { accept: 'application/json' },
        credentials: 'omit',
      }),
    ];
    expect(fetchMock).toHaveBeenCalledTimes(4);
    pending.forEach((item, index) => item.resolve(Response.json({ index })));
    const results = await Promise.all(requests);
    expect(results[0]).toEqual(results[1]);
    expect(results[0]).not.toEqual(results[2]);
    expect(results[0]).not.toEqual(results[3]);
    expect(results[0]).not.toEqual(results[4]);
  });

  it('cancels one consumer during body delivery without aborting the other reader', async () => {
    let source!: ReadableStreamDefaultController<Uint8Array>;
    let transportSignal: AbortSignal | null | undefined;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        source = controller;
        controller.enqueue(new TextEncoder().encode('{"items":'));
      },
    });
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (_path, init) => {
      transportSignal = init?.signal;
      return new Response(stream);
    });
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();
    const cancelled = call('/api/modules', { signal: controller.signal });
    const live = call('/api/modules');
    await settle();
    controller.abort();
    expect(await cancelled).toMatchObject({ ok: false, error: { code: 'request_cancelled' } });
    expect(transportSignal?.aborted).toBe(false);
    source.enqueue(new TextEncoder().encode('[]}'));
    source.close();
    expect(await live).toMatchObject({ ok: true, data: { items: [] } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('aborts transport when its last consumer leaves and admits a new read immediately', async () => {
    const signals: AbortSignal[] = [];
    const fetchMock = vi.fn<typeof fetch>().mockImplementation((_path, init) => {
      signals.push(init!.signal!);
      return signals.length === 1
        ? new Promise<Response>(() => undefined)
        : Promise.resolve(Response.json({ items: ['fresh'] }));
    });
    vi.stubGlobal('fetch', fetchMock);
    const a = new AbortController();
    const b = new AbortController();
    const first = call('/api/modules', { signal: a.signal });
    const second = call('/api/modules', { signal: b.signal });
    a.abort();
    await first;
    expect(signals[0]?.aborted).toBe(false);
    b.abort();
    await second;
    expect(signals[0]?.aborted).toBe(true);
    expect(await call('/api/modules')).toMatchObject({ ok: true, data: { items: ['fresh'] } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  const account = {
    kind: 'authenticated',
    session: {
      account: { id: 'account-a', displayName: 'A' },
      activeWorkspace: { workspaceId: 'workspace-a', kind: 'personal' },
      capabilities: [{ capability: 'educator', state: 'verified' }],
      navigation: { classroomManagement: true },
    },
  };
  it.each([
    { ...account, session: { ...account.session, account: { id: 'account-b' } } },
    {
      ...account,
      session: { ...account.session, activeWorkspace: { workspaceId: 'workspace-b' } },
    },
    { ...account, session: { ...account.session, capabilities: [] } },
    { kind: 'student', session: { student: { seatId: 'seat-a' }, classroom: { id: 'class-a' } } },
  ])(
    'retires old reads before accepting a changed account, workspace, grant or seat: %j',
    async (next) => {
      setPortalSessionKey(portalSessionKey(account));
      const stale = deferred<Response>();
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockReturnValueOnce(stale.promise)
        .mockResolvedValueOnce(Response.json({ items: ['new-scope'] }));
      vi.stubGlobal('fetch', fetchMock);
      const old = call('/api/projects');
      setPortalSessionKey(portalSessionKey(next));
      const current = call('/api/projects');
      expect(await old).toMatchObject({ ok: false, error: { code: 'request_cancelled' } });
      stale.resolve(Response.json({ items: ['old-private-data'] }));
      expect(await current).toMatchObject({ ok: true, data: { items: ['new-scope'] } });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    },
  );

  it('invalidates joining synchronously around mutations and never coalesces writes', async () => {
    const old = deferred<Response>();
    const write = deferred<Response>();
    let reads = 0;
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (_path, init) => {
      if (init?.method === 'POST') return write.promise;
      reads += 1;
      return reads === 1 ? old.promise : Response.json({ revision: reads });
    });
    vi.stubGlobal('fetch', fetchMock);
    const oldRead = call('/api/projects');
    const firstWrite = call('/api/projects', { method: 'POST', body: '{}' });
    const secondWrite = call('/api/projects', { method: 'POST', body: '{}' });
    expect(await call('/api/projects')).toMatchObject({ ok: true, data: { revision: 2 } });
    write.resolve(Response.json({ saved: true }));
    await Promise.all([firstWrite, secondWrite]);
    expect(await call('/api/projects')).toMatchObject({ ok: true, data: { revision: 3 } });
    old.resolve(Response.json({ revision: 1 }));
    await oldRead;
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(2);
  });

  it('does not cache denial or unavailable responses', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(async () =>
        Response.json({ error: { code: 'forbidden', message: 'Denied' } }, { status: 403 }),
      );
    vi.stubGlobal('fetch', fetchMock);
    await call('/api/projects');
    await call('/api/projects');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('interactive capacity and body lifecycle', () => {
  it('does not let four unbounded resource reads block portal reads or interactive saves', async () => {
    const pending = deferred<Response>();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(async (path) =>
        String(path).startsWith('/api/projects/stalled-')
          ? pending.promise.then((response) => response.clone())
          : Response.json({ items: [], saved: true }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const resources = Array.from({ length: 4 }, (_, index) =>
      call(`/api/projects/stalled-${index}`),
    );
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(await call('/api/modules')).toMatchObject({ ok: true });
    const save = call('/api/projects/p/draft', { method: 'PUT', body: '{}' });
    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(await save).toMatchObject({ ok: true });
    pending.resolve(Response.json({ project: {} }));
    await Promise.all(resources);
  });

  it('bounds a stalled portal body and frees its permit even when fetch ignores abort', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | null | undefined;
    const fetchMock = vi.fn<typeof fetch>().mockImplementationOnce(async (_path, init) => {
      signal = init?.signal;
      return new Response(new ReadableStream());
    });
    vi.stubGlobal('fetch', fetchMock);
    const stalled = call('/api/modules');
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await stalled).toMatchObject({ ok: false, error: { code: 'network' } });
    expect(signal?.aborted).toBe(true);
    fetchMock.mockResolvedValueOnce(Response.json({ items: ['available'] }));
    expect(await call('/api/modules')).toMatchObject({ ok: true, data: { items: ['available'] } });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('lets checkers and an interactive read finish while the chess body stalls', async () => {
    const chess = new AbortController();
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (path) => {
      if (String(path).includes('/chess/')) return new Response(new ReadableStream());
      return Response.json({ items: [] });
    });
    vi.stubGlobal('fetch', fetchMock);
    const stalled = call('/api/games/chess/notifications', {
      signal: chess.signal,
      priority: 'low',
    });
    const checkers = call('/api/games/checkers/notifications', { priority: 'low' });
    const foreground = call('/api/projects');
    expect(await checkers).toMatchObject({ ok: true });
    expect(await foreground).toMatchObject({ ok: true });
    chess.abort();
    expect(await stalled).toMatchObject({ ok: false, error: { code: 'request_cancelled' } });
  });

  it('holds four permits through body consumption and serves queued interactive work first', async () => {
    const sources = new Map<string, ReadableStreamDefaultController<Uint8Array>>();
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (path) => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          sources.set(String(path), controller);
          controller.enqueue(new TextEncoder().encode('{"items":[]'));
        },
      });
      return new Response(stream);
    });
    vi.stubGlobal('fetch', fetchMock);
    const complete = (path: string) => {
      sources.get(path)!.enqueue(new TextEncoder().encode('}'));
      sources.get(path)!.close();
    };
    const a = call('/api/games/chess/notifications', { priority: 'low' });
    const b = call('/api/games/checkers/notifications', { priority: 'low' });
    const c = call('/api/projects?foreground=1');
    const d = call('/api/projects?foreground=2');
    const background = call('/api/modules?background=1', { priority: 'low' });
    const foreground = call('/api/projects?foreground=3');
    const cancelled = new AbortController();
    const queued = call('/api/modules?cancelled=1', { signal: cancelled.signal });
    cancelled.abort();
    expect(await queued).toMatchObject({ ok: false, error: { code: 'request_cancelled' } });
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(4);
    complete('/api/games/chess/notifications');
    await a;
    await settle();
    expect(fetchMock.mock.calls[4]?.[0]).toBe('/api/projects?foreground=3');
    expect(sources.has('/api/modules?background=1')).toBe(false);
    complete('/api/projects?foreground=3');
    await foreground;
    await settle();
    expect(fetchMock.mock.calls[5]?.[0]).toBe('/api/modules?background=1');
    complete('/api/games/checkers/notifications');
    complete('/api/projects?foreground=1');
    complete('/api/projects?foreground=2');
    complete('/api/modules?background=1');
    await Promise.all([b, c, d, background]);
    expect(fetchMock.mock.calls.some(([path]) => String(path).includes('cancelled'))).toBe(false);
  });

  it('bounds the queue, gives foreground work admission, and starts pagehide saves synchronously', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(async (path) =>
        path === '/api/projects/p/draft'
          ? Response.json({ saved: true })
          : new Response(new ReadableStream()),
      );
    vi.stubGlobal('fetch', fetchMock);
    const controllers: AbortController[] = [];
    const requests = Array.from({ length: 68 }, (_, index) => {
      const controller = new AbortController();
      controllers.push(controller);
      return call(`/api/modules?queue=${index}`, {
        signal: controller.signal,
        priority: index < 2 ? 'high' : 'low',
      });
    });
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(await call('/api/modules?overflow=1', { priority: 'low' })).toMatchObject({
      ok: false,
      status: 0,
    });
    const foregroundController = new AbortController();
    const foreground = call('/api/projects?foreground=1', { signal: foregroundController.signal });
    expect(await requests[67]).toMatchObject({ ok: false, error: { code: 'request_cancelled' } });
    const save = call('/api/projects/p/draft', { method: 'PUT', body: '{}' });
    expect(fetchMock.mock.calls[4]?.[0]).toBe('/api/projects/p/draft');
    expect(await save).toMatchObject({ ok: true });
    const unloadSave = call('/api/projects/p/draft', {
      method: 'PUT',
      body: '{}',
      keepalive: true,
    });
    expect(fetchMock.mock.calls[5]?.[0]).toBe('/api/projects/p/draft');
    expect(await unloadSave).toMatchObject({ ok: true });
    controllers[0]!.abort();
    await requests[0];
    await settle();
    expect(fetchMock.mock.calls[6]?.[0]).toBe('/api/projects?foreground=1');
    foregroundController.abort();
    controllers.forEach((controller) => controller.abort());
    await Promise.all([...requests, foreground]);
  });
});

describe('portal attention and retry advice', () => {
  it('keeps attention dependencies stable across identity copies, profile changes and filters', () => {
    const original = {
      kind: 'authenticated',
      session: {
        account: { id: 'account-a', displayName: 'A' },
        activeWorkspace: { workspaceId: 'workspace-a' },
        capabilities: [{ capability: 'educator', state: 'verified' }],
        timeZone: 'UTC',
      },
    };
    expect(portalSessionKey(structuredClone(original))).toBe(portalSessionKey(original));
    expect(
      portalSessionKey({
        ...original,
        session: {
          ...original.session,
          account: { id: 'account-a', displayName: 'Renamed' },
          timeZone: 'Europe/Moscow',
        },
      }),
    ).toBe(portalSessionKey(original));
    expect(portalAttentionRoute({ kind: 'my-projects', ...{ search: 'new filter' } })).toBe(
      portalAttentionRoute({ kind: 'my-projects' }),
    );
    expect(portalAttentionRoute({ kind: 'editor', projectId: 'new-project' })).not.toBe(
      portalAttentionRoute({ kind: 'editor', projectId: 'old-project' }),
    );
  });

  it('publishes successful product mutations so attention can refresh without navigation', async () => {
    const listener = vi.fn();
    const stop = onPortalMutation(listener);
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ ok: true })),
    );
    try {
      await call('/api/class-join/me/assignments/assignment/submit', {
        method: 'POST',
        body: '{}',
      });
      await call('/api/analytics/v2/module-session', { method: 'POST', body: '{}' });
      expect(listener).toHaveBeenCalledExactlyOnceWith(
        '/api/class-join/me/assignments/assignment/submit',
      );
    } finally {
      stop();
    }
  });

  it.each([
    ['3', 3000],
    ['900', 60_000],
    ['invalid', undefined],
  ])('exposes bounded Retry-After %s without retrying the request', async (header, expected) => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(async () =>
        Response.json(
          { error: { code: 'unavailable', message: 'Later' } },
          { status: 503, headers: { 'retry-after': header } },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);
    const result = await call('/api/modules');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.retryAfterMs).toBe(expected);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
