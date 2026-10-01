import { afterEach, describe, expect, it, vi } from 'vitest';
import { ownerSvgSource } from '../ProductionComponentVisual';
import { warmProductionAsset } from '../production-asset-contracts';

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
  vi.unstubAllGlobals();
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
