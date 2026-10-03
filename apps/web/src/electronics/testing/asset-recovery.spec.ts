import { afterEach, describe, expect, it, vi } from 'vitest';
import { ownerSvgSource } from '../ProductionComponentVisual';
import {
  createQuietAssetRecovery,
  subscribeSharedQuietAssetRecovery,
  warmProductionAsset,
} from '../production-asset-contracts';

const validSvg = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="4" height="4"/></svg>';

class SvgParser {
  parseFromString(source: string): Document {
    const valid = source.startsWith('<svg xmlns="http://www.w3.org/2000/svg"');
    return {
      documentElement: {
        localName: valid ? 'svg' : 'html',
        namespaceURI: valid ? 'http://www.w3.org/2000/svg' : 'http://www.w3.org/1999/xhtml',
      },
      querySelector: () => null,
    } as unknown as Document;
  }
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('mounted quiet asset recovery', () => {
  it('spreads thirty failed consumers, stops permanently missing assets after three cycles, and cancels on unmount', async () => {
    vi.useFakeTimers();
    let randomIndex = 0;
    vi.spyOn(Math, 'random').mockImplementation(() => ((randomIndex++ * 17) % 31) / 31);
    const requests: number[] = [];
    const consumers = Array.from({ length: 30 }, () =>
      createQuietAssetRecovery(async () => {
        requests.push(Date.now());
        return false;
      }),
    );
    consumers.forEach((consumer) => consumer.failed());
    await vi.advanceTimersByTimeAsync(110_000);
    expect(requests).toHaveLength(90);
    const perSecond = new Map<number, number>();
    for (const at of requests) {
      const second = Math.floor(at / 1_000);
      perSecond.set(second, (perSecond.get(second) ?? 0) + 1);
    }
    expect(Math.max(...perSecond.values())).toBeLessThanOrEqual(10);
    await vi.advanceTimersByTimeAsync(110_000);
    expect(requests).toHaveLength(90);

    const cancelled = createQuietAssetRecovery(async () => {
      requests.push(Date.now());
      return false;
    });
    cancelled.failed();
    cancelled.cancel();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(requests).toHaveLength(90);
  });

  it('does not probe a recovered asset again', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    let requests = 0;
    const recovery = createQuietAssetRecovery(async () => {
      requests += 1;
      return true;
    });
    recovery.failed();
    await vi.advanceTimersByTimeAsync(100_000);
    expect(requests).toBe(1);
    recovery.failed();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(requests).toBe(2);
    recovery.cancel();
  });

  it('shares a failed asset probe across mounted consumers and cancels after the last unmount', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    let requests = 0;
    let notices = 0;
    const retry = async (): Promise<boolean> => {
      requests += 1;
      return requests === 2;
    };
    const first = subscribeSharedQuietAssetRecovery('shared:test', retry, () => {
      notices += 1;
    });
    const second = subscribeSharedQuietAssetRecovery('shared:test', retry, () => {
      notices += 1;
    });
    first.failed();
    second.failed();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(requests).toBe(2);
    expect(notices).toBe(2);
    first.cancel();
    second.cancel();
    await vi.advanceTimersByTimeAsync(100_000);
    expect(requests).toBe(2);
  });

  it('does not reset the finite budget when a preflight image never loads in its mounted consumer', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    let probes = 0;
    let mountedUpdates = 0;
    const recovery = subscribeSharedQuietAssetRecovery(
      'image:mounted-failure',
      async () => {
        probes += 1;
        return 'pending';
      },
      () => {
        mountedUpdates += 1;
      },
    );
    recovery.failed();
    await vi.advanceTimersByTimeAsync(100_000);
    expect(probes).toBe(3);
    expect(mountedUpdates).toBe(3);
    await vi.advanceTimersByTimeAsync(100_000);
    expect(probes).toBe(3);
    recovery.cancel();
  });

  it('uses one sparse transport probe to recover an asset after all three quick cycles failed', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    let transportReady = false;
    const fetch = vi.fn().mockImplementation(async () => ({ status: transportReady ? 200 : 503 }));
    vi.stubGlobal('fetch', fetch);
    let imageRequests = 0;
    const recovery = createQuietAssetRecovery(async () => {
      imageRequests += 1;
      return transportReady;
    }, '/assets/electronics/late-return.svg');
    recovery.failed();
    await vi.advanceTimersByTimeAsync(75_000);
    expect(imageRequests).toBe(3);
    expect(fetch).toHaveBeenCalledTimes(1);
    transportReady = true;
    await vi.advanceTimersByTimeAsync(40_000);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(imageRequests).toBe(4);
    expect(recovery.permanent()).toBe(false);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fetch).toHaveBeenCalledTimes(2);
    recovery.cancel();
  });

  it('confirms a permanent 404 twice before stopping, but permits a temporary 404 to recover', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    let status = 404;
    const fetch = vi.fn().mockImplementation(async () => ({ status }));
    vi.stubGlobal('fetch', fetch);
    const missing = createQuietAssetRecovery(async () => false, '/assets/electronics/missing.svg');
    missing.failed();
    await vi.advanceTimersByTimeAsync(110_000);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(missing.permanent()).toBe(true);
    await vi.advanceTimersByTimeAsync(110_000);
    expect(fetch).toHaveBeenCalledTimes(2);
    missing.cancel();

    let requests = 0;
    const temporary = createQuietAssetRecovery(async () => {
      requests += 1;
      return status === 200;
    }, '/assets/electronics/temporary.svg');
    temporary.failed();
    await vi.advanceTimersByTimeAsync(75_000);
    expect(temporary.permanent()).toBe(false);
    status = 200;
    await vi.advanceTimersByTimeAsync(40_000);
    expect(requests).toBe(4);
    expect(temporary.permanent()).toBe(false);
    temporary.cancel();
  });

  it('probes one of forty-two failed assets per interval rather than retrying the whole class', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const fetch = vi.fn().mockResolvedValue({ status: 503 });
    vi.stubGlobal('fetch', fetch);
    const group = Array.from({ length: 42 }, (_, index) =>
      createQuietAssetRecovery(async () => false, `/assets/electronics/group-${index}.svg`),
    );
    group.forEach((recovery) => recovery.failed());
    await vi.advanceTimersByTimeAsync(110_000);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(new Set(fetch.mock.calls.map(([asset]) => asset)).size).toBe(2);
    group.forEach((recovery) => recovery.cancel());
    await vi.advanceTimersByTimeAsync(110_000);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('re-arms forty-two distinct transient assets through one paced queue after transport returns', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    let online = false;
    const fetch = vi.fn().mockImplementation(async () => ({ status: online ? 200 : 503 }));
    vi.stubGlobal('fetch', fetch);
    const lateRequests: number[] = [];
    const group = Array.from({ length: 42 }, (_, index) => {
      let requests = 0;
      return createQuietAssetRecovery(async () => {
        requests += 1;
        if (requests > 3) lateRequests.push(Date.now());
        return online;
      }, `/assets/electronics/group-return-${index}.svg`);
    });
    group.forEach((recovery) => recovery.failed());
    await vi.advanceTimersByTimeAsync(75_000);
    expect(lateRequests).toHaveLength(0);
    online = true;
    await vi.advanceTimersByTimeAsync(160_000);
    expect(lateRequests).toHaveLength(42);
    expect(lateRequests.at(-1)! - lateRequests[0]!).toBe(123_000);
    const perSecond = new Map<number, number>();
    for (const at of lateRequests) {
      const second = Math.floor(at / 1_000);
      perSecond.set(second, (perSecond.get(second) ?? 0) + 1);
    }
    expect(Math.max(...perSecond.values())).toBe(1);
    expect(fetch.mock.calls.length).toBeLessThanOrEqual(6);
    group.forEach((recovery) => recovery.cancel());
  });

  it('keeps a 2xx asset eligible after more than three late decode failures', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const fetch = vi.fn().mockResolvedValue({ status: 200 });
    vi.stubGlobal('fetch', fetch);
    let requests = 0;
    const recovery = createQuietAssetRecovery(
      async () => ++requests >= 8,
      '/assets/decode-return.svg',
    );
    recovery.failed();
    await vi.advanceTimersByTimeAsync(250_000);
    expect(requests).toBe(8);
    expect(recovery.permanent()).toBe(false);
    const probes = fetch.mock.calls.length;
    await vi.advanceTimersByTimeAsync(90_000);
    expect(fetch).toHaveBeenCalledTimes(probes);
    recovery.cancel();
  });

  it('does not fan out every mounted asset after an isolated 5xx response', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (asset: string) => ({
        status: asset.endsWith('healthy.svg') ? 200 : 503,
      })),
    );
    const requests = [0, 0];
    const healthy = createQuietAssetRecovery(async () => {
      requests[0]! += 1;
      return false;
    }, '/assets/healthy.svg');
    const bad = createQuietAssetRecovery(async () => {
      requests[1]! += 1;
      return false;
    }, '/assets/bad.svg');
    healthy.failed();
    bad.failed();
    await vi.advanceTimersByTimeAsync(135_000);
    expect(requests).toEqual([5, 4]);
    healthy.cancel();
    bad.cancel();
  });

  it('spreads the shared late transport check across thirty simulated browser tabs', async () => {
    vi.useFakeTimers();
    let randomIndex = 0;
    vi.spyOn(Math, 'random').mockImplementation(() => ((randomIndex++ * 17) % 31) / 31);
    let online = false;
    const fetch = vi.fn().mockImplementation(async () => ({ status: online ? 200 : 503 }));
    vi.stubGlobal('fetch', fetch);
    const lateRequests: number[] = [];
    const clients = [];
    for (let index = 0; index < 30; index += 1) {
      // Each separately loaded module is one browser tab with its own shared
      // transport probe and paced re-arm queue.
      vi.resetModules();
      const { createQuietAssetRecovery: createForTab } =
        await import('../production-asset-contracts');
      let requests = 0;
      const client = createForTab(async () => {
        requests += 1;
        if (requests > 3) lateRequests.push(Date.now());
        return online;
      }, `/assets/electronics/class-${index}.svg`);
      client.failed();
      clients.push(client);
    }
    await vi.advanceTimersByTimeAsync(120_000);
    online = true;
    await vi.advanceTimersByTimeAsync(140_000);
    expect(lateRequests).toHaveLength(30);
    const perSecond = new Map<number, number>();
    for (const at of lateRequests) {
      const second = Math.floor(at / 1_000);
      perSecond.set(second, (perSecond.get(second) ?? 0) + 1);
    }
    expect(Math.max(...perSecond.values())).toBeLessThanOrEqual(5);
    clients.forEach((client) => client.cancel());
  });

  it('does not mistake an unsupported HEAD for permanent 404', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const fetch = vi.fn().mockImplementation(async (asset: string, options: RequestInit) => ({
      status: asset === '/assets/no-head.svg' && options.method === 'HEAD' ? 405 : 200,
    }));
    vi.stubGlobal('fetch', fetch);
    let requests = 0;
    const recovery = createQuietAssetRecovery(async () => ++requests > 3, '/assets/no-head.svg');
    recovery.failed();
    await vi.advanceTimersByTimeAsync(80_000);
    expect(fetch.mock.calls.map(([, options]) => options.method ?? 'GET')).toEqual(['HEAD', 'GET']);
    expect(requests).toBe(4);
    expect(recovery.permanent()).toBe(false);
    recovery.cancel();
  });
});

describe('production owner SVG text recovery', () => {
  it('deduplicates consumers, retries a failed fetch, and reuses the validated success', async () => {
    vi.stubGlobal('DOMParser', SvgParser);
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValue({ ok: true, text: async () => validSvg });
    vi.stubGlobal('fetch', fetch);
    const asset = '/assets/electronics/recovery-dedup.svg';
    const first = ownerSvgSource(asset);
    expect(ownerSvgSource(asset)).toBe(first);
    expect(await first).toBe(validSvg);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(await ownerSvgSource(asset)).toBe(validSvg);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('rejects successful HTTP with invalid SVG and permits a later recovery event', async () => {
    vi.stubGlobal('DOMParser', SvgParser);
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, text: async () => '<html>bad asset</html>' })
      .mockResolvedValueOnce({ ok: true, text: async () => '<html>bad asset</html>' })
      .mockResolvedValueOnce({ ok: true, text: async () => '<html>bad asset</html>' })
      .mockResolvedValue({ ok: true, text: async () => validSvg });
    vi.stubGlobal('fetch', fetch);
    const asset = '/assets/electronics/recovery-invalid.svg';
    await expect(ownerSvgSource(asset)).rejects.toThrow('not valid SVG');
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(await ownerSvgSource(asset)).toBe(validSvg);
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it('terminates a hung fetch after a bounded cycle without further automatic requests', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('DOMParser', SvgParser);
    const fetch = vi.fn().mockImplementation(() => new Promise(() => undefined));
    vi.stubGlobal('fetch', fetch);
    const pending = ownerSvgSource('/assets/electronics/recovery-hang.svg');
    const failure = expect(pending).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(10_000);
    await failure;
    expect(fetch).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});

describe('production state-image warmup', () => {
  it('deduplicates a hung image and releases the warmup slot after timeout', async () => {
    vi.useFakeTimers();
    const requests: string[] = [];
    class TestImage {
      decoding = '';
      naturalWidth = 10;
      naturalHeight = 10;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(value: string) {
        requests.push(value);
      }
    }
    vi.stubGlobal('window', { Image: TestImage, setTimeout, clearTimeout });
    const asset = '/assets/electronics/recovery-warmup.svg';
    warmProductionAsset(asset);
    warmProductionAsset(asset);
    expect(requests).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(2_500);
    warmProductionAsset(asset);
    expect(requests).toHaveLength(2);
  });
});
