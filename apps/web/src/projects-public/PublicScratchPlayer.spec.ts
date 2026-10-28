// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { PublicScratchPlayer } from './PublicScratchPlayer';
const PUB = '11111111-1111-4111-8111-111111111111',
  REV = '22222222-2222-4222-8222-222222222222';
const SERVER = Date.UTC(2030, 0, 1);
let root: Root, container: HTMLDivElement;
const reactGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean };
function body(token = 'header.initial.signature', seconds = 0, ttl = 600) {
  return {
    schemaVersion: 1,
    viewerFamily: 'scratch',
    publicationId: PUB,
    revisionId: REV,
    runtimeOrigin: window.location.origin,
    runtimeToken: token,
    expiresAt: SERVER / 1000 + seconds + ttl,
    serverTime: 0,
    projectJson: { targets: [], monitors: [], extensions: [] },
    assets: [],
  };
}
function response(
  token = 'header.initial.signature',
  seconds = 0,
  ttl = 600,
  date: string | null = new Date(SERVER + seconds * 1000).toUTCString(),
) {
  return new Response(JSON.stringify(body(token, seconds, ttl)), {
    headers: { 'content-type': 'application/json', ...(date === null ? {} : { date }) },
  });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}
beforeEach(() => {
  reactGlobal.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function mount() {
  const unavailable = vi.fn();
  await act(async () =>
    root.render(
      createElement(PublicScratchPlayer, {
        publicationId: PUB,
        revisionId: REV,
        onUnavailable: unavailable,
        fallback: createElement('p', null, 'Cover'),
      }),
    ),
  );
  const iframe = container.querySelector('iframe')!;
  const post = vi.spyOn(iframe.contentWindow!, 'postMessage').mockImplementation(() => undefined);
  await act(async () => {
    iframe.dispatchEvent(new Event('load'));
    await Promise.resolve();
    await Promise.resolve();
  });
  return { iframe, post, unavailable };
}
function messages(post: {
  readonly mock: { readonly calls: readonly unknown[][] };
}): Record<string, unknown>[] {
  return post.mock.calls.map((call) => call[0] as Record<string, unknown>);
}
async function ready(iframe: HTMLIFrameElement, init: Record<string, unknown>) {
  await act(async () => {
    window.dispatchEvent(
      new MessageEvent('message', {
        source: iframe.contentWindow,
        origin: window.location.origin,
        data: {
          protocolVersion: 1,
          projectId: PUB,
          sessionNonce: init['sessionNonce'],
          messageType: 'ASA_BLOCKS_STATUS',
          status: 'editor-ready',
        },
      }),
    );
  });
}
describe('public player capability lifecycle', () => {
  it.each([null, 'invalid', new Date(SERVER + 600000).toUTCString()])(
    'fails closed for missing, invalid or expired HTTP Date: %s',
    async (date) => {
      const fetcher = vi.fn(async () => response('header.initial.signature', 0, 600, date));
      vi.stubGlobal('fetch', fetcher);
      const f = await mount();
      expect(messages(f.post).some((m) => m['messageType'] === 'ASA_BLOCKS_INIT')).toBe(false);
      expect(container.querySelector('iframe')).toBeNull();
      expect(container.textContent).toContain('Cover');
    },
  );
  it('uses HTTP Date despite unrelated body/server and pupil clocks', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(0);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response()),
    );
    const f = await mount();
    expect(
      messages(f.post).find((m) => m['messageType'] === 'ASA_BLOCKS_INIT')?.['runtimeToken'],
    ).toBe('header.initial.signature');
  });
  it('aborts and ignores a pre-resume JSON body and coalesces one fresh bootstrap while monotonic time is paused', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    vi.spyOn(performance, 'now').mockReturnValue(0);
    const old = deferred<unknown>(),
      fresh = deferred<Response>();
    let firstSignal: AbortSignal | undefined;
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(async (_url, options) => {
        firstSignal = options?.signal as AbortSignal;
        return {
          ok: true,
          status: 200,
          headers: new Headers({ date: new Date(SERVER).toUTCString() }),
          json: () => old.promise,
        } as Response;
      })
      .mockImplementationOnce(() => fresh.promise);
    vi.stubGlobal('fetch', fetcher);
    const f = await mount();
    await act(async () => {
      window.dispatchEvent(new Event('pageshow'));
      window.dispatchEvent(new Event('online'));
      document.dispatchEvent(new Event('visibilitychange'));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(firstSignal?.aborted).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(2);
    await act(async () => {
      fresh.resolve(response('header.fresh.signature', 1200));
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      old.resolve(body('header.stale.signature'));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(
      messages(f.post)
        .filter((m) =>
          ['ASA_BLOCKS_INIT', 'ASA_BLOCKS_TOKEN_UPDATE'].includes(String(m['messageType'])),
        )
        .map((m) => m['runtimeToken']),
    ).toEqual(['header.fresh.signature']);
  });
  it('retains a running iframe across repeated transient refresh failures and recovers without remount', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    let outage = true;
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response())
      .mockImplementation(async () =>
        outage
          ? new Response(null, { status: 503 })
          : response('header.recovered.signature', Math.floor(performance.now() / 1000)),
      );
    vi.stubGlobal('fetch', fetcher);
    const f = await mount();
    const init = messages(f.post).find((m) => m['messageType'] === 'ASA_BLOCKS_INIT')!;
    await ready(f.iframe, init);
    await act(async () => vi.advanceTimersByTimeAsync(70000));
    expect(fetcher.mock.calls.length).toBeGreaterThan(3);
    expect(container.querySelector('iframe')).toBe(f.iframe);
    expect(container.textContent).not.toContain('Cover');
    outage = false;
    await act(async () => vi.advanceTimersByTimeAsync(30000));
    expect(
      messages(f.post).some(
        (m) =>
          m['messageType'] === 'ASA_BLOCKS_TOKEN_UPDATE' &&
          m['runtimeToken'] === 'header.recovered.signature',
      ),
    ).toBe(true);
    expect(container.querySelector('iframe')).toBe(f.iframe);
  });
  it('keeps the old grant only until its original monotonic expiry during an outage', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response('header.initial.signature', 0, 20))
      .mockImplementation(async () => new Response(null, { status: 503 }));
    vi.stubGlobal('fetch', fetcher);
    const f = await mount();
    await ready(
      f.iframe,
      messages(f.post).find((m) => m['messageType'] === 'ASA_BLOCKS_INIT')!,
    );
    await act(async () => vi.advanceTimersByTimeAsync(18000));
    expect(container.querySelector('iframe')).toBe(f.iframe);
    await act(async () => vi.advanceTimersByTimeAsync(1001));
    expect(container.querySelector('iframe')).toBeNull();
    expect(container.textContent).toContain('Cover');
  });
});
