// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from './api';
import { setTelemetryContext, telemetryContext } from './telemetry-context';

const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const actor = { kind: 'account' as const, accountId: id(1), workspaceId: id(2) };
const successor = { ...actor, workspaceId: id(3) };
const session = (identity = actor) => ({
  authenticated: true,
  account: { id: identity.accountId },
  activeWorkspace: { workspaceId: identity.workspaceId, kind: 'organization' },
});
const switched = (identity = successor) =>
  Response.json({ activeWorkspace: session(identity).activeWorkspace }, { status: 201 });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}
let transport: ReturnType<typeof vi.fn<typeof fetch>>;
beforeEach(() => {
  vi.useFakeTimers();
  setTelemetryContext(null, true, 'public');
  setTelemetryContext(actor, true, 'account');
  transport = vi.fn<typeof fetch>();
  vi.stubGlobal('fetch', transport);
});
afterEach(() => {
  setTelemetryContext(null, true, 'public');
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('product workspace mutation and canonical telemetry proof', () => {
  it('pauses before the existing POST, preserves its result, and waits through the POST-to-me gap', async () => {
    const original = telemetryContext();
    transport.mockImplementationOnce(async (_path, init) => {
      expect(telemetryContext()).toEqual({ ...original, ready: false });
      expect(init).toMatchObject({
        method: 'POST',
        body: JSON.stringify({ workspaceId: successor.workspaceId }),
      });
      return switched();
    });
    expect(await api.switchWorkspace(successor.workspaceId)).toEqual({
      ok: true,
      status: 201,
      data: { activeWorkspace: session(successor).activeWorkspace },
    });
    await vi.advanceTimersByTimeAsync(2000);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(telemetryContext().ready).toBe(false);
    transport.mockResolvedValueOnce(Response.json(session(successor)));
    expect((await api.me()).ok).toBe(true);
    expect(telemetryContext().ready).toBe(false);
    setTelemetryContext(successor, true, 'home');
    expect(telemetryContext()).toMatchObject({ actor: successor, ready: true });
    expect(transport.mock.calls.map(([path]) => path)).toEqual([
      '/api/session/context',
      '/api/auth/me',
    ]);
  });

  it('ignores a pre-mutation me response even after the successor has been accepted by App', async () => {
    const stale = deferred<Response>();
    transport.mockReturnValueOnce(stale.promise);
    const oldRead = api.me();
    transport.mockResolvedValueOnce(switched());
    await api.switchWorkspace(successor.workspaceId);
    transport.mockResolvedValueOnce(Response.json(session(successor)));
    await api.me();
    setTelemetryContext(successor, true, 'home');
    const accepted = telemetryContext();
    stale.resolve(Response.json(session()));
    expect(await oldRead).toMatchObject({ ok: true, data: session() });
    setTelemetryContext(actor, true, 'home');
    expect(telemetryContext()).toEqual(accepted);
  });

  it('does not use the newer POST completion as proof that an older mutation has settled', async () => {
    const older = deferred<Response>();
    const newer = deferred<Response>();
    const intermediate = deferred<Response>();
    const lastStarted = { ...actor, workspaceId: id(4) };
    transport.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    const first = api.switchWorkspace(successor.workspaceId);
    const second = api.switchWorkspace(lastStarted.workspaceId);
    newer.resolve(switched(lastStarted));
    await second;
    transport.mockReturnValueOnce(intermediate.promise);
    const prematureRead = api.me();
    older.resolve(switched());
    await first;
    intermediate.resolve(Response.json(session(lastStarted)));
    await prematureRead;
    setTelemetryContext(lastStarted, true, 'home');
    expect(telemetryContext().ready).toBe(false);
    transport.mockResolvedValueOnce(Response.json(session(successor)));
    await api.me();
    setTelemetryContext(successor, true, 'home');
    expect(telemetryContext()).toMatchObject({ actor: successor, ready: true });
    expect(transport.mock.calls.map(([path]) => path)).toEqual([
      '/api/session/context',
      '/api/session/context',
      '/api/auth/me',
      '/api/auth/me',
    ]);
  });

  it('returns a refused mutation before one background proof and resumes the unchanged queue', async () => {
    const original = telemetryContext();
    const proof = deferred<Response>();
    transport.mockResolvedValueOnce(
      Response.json({ error: { code: 'forbidden', message: 'denied' } }, { status: 403 }),
    );
    transport.mockReturnValueOnce(proof.promise);
    expect(await api.switchWorkspace(successor.workspaceId)).toEqual({
      ok: false,
      status: 403,
      error: { code: 'forbidden', message: 'denied' },
    });
    expect(transport).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(transport.mock.calls[1]).toEqual([
      '/api/auth/me',
      {
        credentials: 'same-origin',
        cache: 'no-store',
        signal: expect.any(AbortSignal),
      },
    ]);
    expect(telemetryContext().ready).toBe(false);
    proof.resolve(Response.json(session()));
    await vi.advanceTimersByTimeAsync(0);
    expect(telemetryContext()).toEqual(original);
    expect(transport).toHaveBeenCalledTimes(2);
    transport.mockResolvedValueOnce(switched());
    await api.switchWorkspace(successor.workspaceId);
    await vi.advanceTimersByTimeAsync(0);
    // The previous refusal cannot schedule a fallback for this subsequent successful mutation.
    expect(transport).toHaveBeenCalledTimes(3);
    expect(telemetryContext().ready).toBe(false);
  });

  it('keeps an uncertain lost response paused until the newly proved actor is accepted', async () => {
    transport.mockRejectedValueOnce(new TypeError('lost response'));
    transport.mockResolvedValueOnce(Response.json(session(successor)));
    expect(await api.switchWorkspace(successor.workspaceId)).toMatchObject({
      ok: false,
      status: 0,
      error: { code: 'network' },
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(telemetryContext()).toMatchObject({ actor, ready: false });
    setTelemetryContext(actor, true, 'account');
    expect(telemetryContext().ready).toBe(false);
    setTelemetryContext(successor, true, 'home');
    expect(telemetryContext()).toMatchObject({ actor: successor, ready: true });
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it('lets the caller canonical me replace the scheduled fallback without another request', async () => {
    transport.mockResolvedValueOnce(
      Response.json({ error: { code: 'forbidden' } }, { status: 403 }),
    );
    transport.mockResolvedValueOnce(Response.json(session()));
    await api.switchWorkspace(successor.workspaceId);
    await api.me();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(transport.mock.calls.map(([path]) => path)).toEqual([
      '/api/session/context',
      '/api/auth/me',
    ]);
    expect(telemetryContext().ready).toBe(true);
  });

  it.each([401, 503, 'malformed'] as const)(
    'does not refresh credentials or retry when background proof is %s',
    async (failure) => {
      transport.mockRejectedValueOnce(new TypeError('lost response'));
      transport.mockResolvedValueOnce(
        failure === 'malformed'
          ? new Response('{', { status: 200 })
          : new Response('{}', { status: failure }),
      );
      await api.switchWorkspace(successor.workspaceId);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(transport.mock.calls.map(([path]) => path)).toEqual([
        '/api/session/context',
        '/api/auth/me',
      ]);
      expect(telemetryContext().ready).toBe(false);
      transport.mockResolvedValueOnce(Response.json(session()));
      await api.me();
      expect(telemetryContext().ready).toBe(true);
    },
  );

  it('bounds an uncooperative background body and ignores its late proof without delaying the product', async () => {
    const body = deferred<unknown>();
    const response = Response.json({});
    vi.spyOn(response, 'json').mockReturnValue(body.promise);
    transport.mockRejectedValueOnce(new TypeError('lost response'));
    transport.mockResolvedValueOnce(response);
    expect((await api.switchWorkspace(successor.workspaceId)).ok).toBe(false);
    await vi.advanceTimersByTimeAsync(12_001);
    expect(transport.mock.calls[1]![1]!.signal!.aborted).toBe(true);
    body.resolve(session());
    await vi.advanceTimersByTimeAsync(30_000);
    expect(telemetryContext().ready).toBe(false);
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it.each(['fetch', 'body'] as const)(
    'rejects background proof after its absolute deadline even when the %s timeout callback is delayed',
    async (phase) => {
      const pendingFetch = deferred<Response>();
      const pendingBody = deferred<unknown>();
      const response = Response.json(session());
      const json = vi.spyOn(response, 'json');
      if (phase === 'body') json.mockReturnValue(pendingBody.promise);
      transport.mockRejectedValueOnce(new TypeError('lost response'));
      transport.mockReturnValueOnce(
        phase === 'fetch' ? pendingFetch.promise : Promise.resolve(response),
      );
      expect((await api.switchWorkspace(successor.workspaceId)).ok).toBe(false);
      await vi.advanceTimersByTimeAsync(0);
      const signal = transport.mock.calls[1]![1]!.signal!;
      vi.setSystemTime(Date.now() + 12_001);
      // Move wall time without running the overdue timeout: the response must fence itself.
      expect(signal.aborted).toBe(false);
      if (phase === 'fetch') pendingFetch.resolve(response);
      else pendingBody.resolve(session());
      for (let n = 0; n < 12; n++) await Promise.resolve();
      expect(signal.aborted).toBe(true);
      expect(telemetryContext().ready).toBe(false);
      expect(transport).toHaveBeenCalledTimes(2);
      if (phase === 'fetch') expect(json).not.toHaveBeenCalled();
    },
  );

  it('preserves the existing product 401 refresh and retry through the telemetry-only pause', async () => {
    const continuity = telemetryContext().continuity;
    transport.mockResolvedValueOnce(new Response('{}', { status: 401 }));
    transport.mockResolvedValueOnce(new Response('{}', { status: 200 }));
    transport.mockResolvedValueOnce(switched());
    expect(await api.switchWorkspace(successor.workspaceId)).toMatchObject({
      ok: true,
      status: 201,
    });
    expect(telemetryContext()).toMatchObject({ continuity, ready: false });
    expect(transport.mock.calls.map(([path]) => path)).toEqual([
      '/api/session/context',
      '/api/auth/refresh',
      '/api/session/context',
    ]);
    expect(transport.mock.calls[0]![1]!.body).toBe(transport.mock.calls[2]![1]!.body);
  });
});
