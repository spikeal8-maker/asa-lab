import { afterEach, describe, expect, it, vi } from 'vitest';
import { call } from '../../api-call';
import { chessNetworkApi } from '../chess-network-api';
vi.mock('../../api-call', () => ({ call: vi.fn() }));
describe('Chess network uncertain command delivery', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  it.each(['fetch', 'body'] as const)(
    'bounds a stalled %s and ignores its late completion while allowing an exact command retry',
    async (phase) => {
      vi.useFakeTimers();
      const real = await vi.importActual<typeof import('../../api-call')>('../../api-call');
      vi.mocked(call).mockReset().mockImplementation(real.call);
      let release!: (value: Response) => void;
      let releaseBody!: (value: unknown) => void;
      const stalledBody = new Promise<unknown>((resolve) => {
        releaseBody = resolve;
      });
      const stalledResponse = { ok: true, status: 201, json: () => stalledBody } as Response;
      const transport = vi.fn<typeof fetch>();
      transport.mockImplementationOnce(() =>
        phase === 'fetch'
          ? new Promise<Response>((resolve) => {
              release = resolve;
            })
          : Promise.resolve(stalledResponse),
      );
      transport.mockImplementation(
        async () => new Response(JSON.stringify({ replayed: true }), { status: 201 }),
      );
      vi.stubGlobal('fetch', transport);
      const input = {
        scope: 'platform' as const,
        initialMs: 600000,
        incrementMs: phase === 'fetch' ? 1000 : 2000,
        colorPreference: 'white' as const,
      };
      const settled = vi.fn();
      const pending = chessNetworkApi.create(input).then((value) => {
        settled(value);
        return value;
      });
      await vi.advanceTimersByTimeAsync(14999);
      expect(settled).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(await pending).toMatchObject({
        ok: false,
        status: 0,
        error: { code: 'network_timeout' },
      });
      const first = transport.mock.calls[0]![1]!;
      expect(first.signal!.aborted).toBe(true);
      expect(await chessNetworkApi.create(input)).toMatchObject({
        ok: true,
        data: { replayed: true },
      });
      const retry = transport.mock.calls[1]![1]!;
      expect(retry.headers).toEqual(first.headers);
      expect(retry.body).toBe(first.body);
      if (phase === 'fetch')
        release(new Response(JSON.stringify({ replayed: false }), { status: 201 }));
      else releaseBody({ replayed: false });
      await vi.advanceTimersByTimeAsync(0);
      expect(settled).toHaveBeenCalledTimes(1);
      expect(settled.mock.calls[0]![0]).toMatchObject({
        ok: false,
        error: { code: 'network_timeout' },
      });
      await chessNetworkApi.create(input);
      expect(transport.mock.calls[2]![1]!.headers).not.toEqual(first.headers);
      expect(vi.getTimerCount()).toBe(0);
    },
  );
  it('retries policy PUT with its original key/version/body after a lost successful reply', async () => {
    const request = vi.mocked(call);
    request.mockReset();
    request.mockResolvedValueOnce({
      ok: false,
      status: 0,
      error: { code: 'network', message: 'lost' },
    });
    request.mockResolvedValue({
      ok: true,
      status: 200,
      data: { enabled: true, scope: 'school', version: 2, replayed: true },
    });
    const input = { enabled: true, scope: 'school' as const, expectedVersion: 1 };
    await chessNetworkApi.savePolicy('class', input);
    await chessNetworkApi.savePolicy('class', input);
    expect(request.mock.calls[0]![1]!.method).toBe('PUT');
    expect(request.mock.calls[1]![1]!.headers).toEqual(request.mock.calls[0]![1]!.headers);
    expect(request.mock.calls[1]![1]!.body).toEqual(request.mock.calls[0]![1]!.body);
    expect(request.mock.calls[0]![1]!.headers).toHaveProperty('idempotency-key');
  });
  it('passes an opaque bounded-page cursor without altering its identity', async () => {
    vi.mocked(call).mockReset().mockResolvedValue({ ok: true, status: 200, data: {} });
    await chessNetworkApi.history('opaque+cursor/=');
    expect(call).toHaveBeenCalledWith('/api/games/chess/history?cursor=opaque%2Bcursor%2F%3D', {
      cache: 'no-store',
      signal: expect.any(AbortSignal),
    });
  });
  it('retries a lost create response with the original key and exact payload, then permits a new intent', async () => {
    const request = vi.mocked(call);
    request.mockReset();
    const input = {
      scope: 'platform' as const,
      initialMs: 600000,
      incrementMs: 5000,
      colorPreference: 'white' as const,
    };
    request.mockResolvedValueOnce({
      ok: false,
      status: 0,
      error: { code: 'network', message: 'Response lost after commit' },
    });
    request.mockResolvedValue({ ok: true, status: 201, data: { replayed: true } });
    await chessNetworkApi.create(input);
    await chessNetworkApi.create(input);
    await chessNetworkApi.create(input);
    const first = request.mock.calls[0]![1]!;
    const retry = request.mock.calls[1]![1]!;
    const next = request.mock.calls[2]![1]!;
    expect(retry.headers).toEqual(first.headers);
    expect(retry.body).toBe(first.body);
    expect(next.headers).not.toEqual(first.headers);
  });
  it('retains an accept identity on server failure and clears it after a deterministic rejection', async () => {
    const request = vi.mocked(call);
    request.mockReset();
    request.mockResolvedValueOnce({
      ok: false,
      status: 503,
      error: { code: 'unavailable', message: 'Unavailable' },
    });
    request.mockResolvedValueOnce({
      ok: false,
      status: 403,
      error: { code: 'POLICY_DENIED', message: 'Denied' },
    });
    request.mockResolvedValue({ ok: true, status: 201, data: { replayed: false } });
    await chessNetworkApi.accept('A'.repeat(24));
    await chessNetworkApi.accept('A'.repeat(24));
    await chessNetworkApi.accept('A'.repeat(24));
    expect(request.mock.calls[1]![1]!.headers).toEqual(request.mock.calls[0]![1]!.headers);
    expect(request.mock.calls[2]![1]!.headers).not.toEqual(request.mock.calls[0]![1]!.headers);
  });
});
