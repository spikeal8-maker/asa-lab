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
