import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CatalogEntry } from '../component-catalog';
import {
  componentAssetContainsPoint,
  hitMaskContainsPoint,
  hitMaskVisibleBounds,
  preloadComponentHitMask,
  type HitMask,
} from '../component-hit-testing';

afterEach(() => vi.unstubAllGlobals());

describe('component alpha hit testing', () => {
  const mask: HitMask = {
    width: 10,
    height: 10,
    alpha: Uint8ClampedArray.from(
      Array.from({ length: 100 }, (_value, index) => {
        const x = index % 10;
        const y = Math.floor(index / 10);
        return x >= 4 && x <= 5 && y >= 2 && y <= 7 ? 255 : 0;
      }),
    ),
  };

  it('accepts the visible body and a one-pixel tolerance around thin leads', () => {
    expect(hitMaskContainsPoint(mask, { x: 4.5, y: 5 }, 10, 10)).toBe(true);
    expect(hitMaskContainsPoint(mask, { x: 3.5, y: 5 }, 10, 10)).toBe(true);
  });

  it('rejects transparent SVG margins instead of using the image rectangle', () => {
    expect(hitMaskContainsPoint(mask, { x: 0.5, y: 0.5 }, 10, 10)).toBe(false);
    expect(hitMaskContainsPoint(mask, { x: 9.5, y: 9.5 }, 10, 10)).toBe(false);
    expect(hitMaskContainsPoint(mask, { x: -1, y: 5 }, 10, 10)).toBe(false);
  });

  it('derives the painted bounds used by the shared diagnostic anchor', () => {
    expect(hitMaskVisibleBounds(mask, 100, 200)).toEqual({
      minX: 40,
      minY: 40,
      maxX: 60,
      maxY: 160,
    });
    expect(
      hitMaskVisibleBounds(
        { width: 2, height: 2, alpha: Uint8ClampedArray.from([0, 0, 0, 0]) },
        100,
        100,
      ),
    ).toBeNull();
  });
});

describe('production component hit mask recovery', () => {
  it('retries one failed image, shares the load, and restores only painted pixels', async () => {
    const requests: string[] = [];
    class TestImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      naturalWidth = 10;
      naturalHeight = 10;
      set src(value: string) {
        requests.push(value);
        queueMicrotask(() => {
          if (requests.length === 1) this.onerror?.();
          else this.onload?.();
        });
      }
    }
    const pixels = new Uint8ClampedArray(10 * 10 * 4);
    pixels[(5 * 10 + 5) * 4 + 3] = 255;
    vi.stubGlobal('Image', TestImage);
    vi.stubGlobal('document', {
      createElement: () => ({
        getContext: () => ({
          save() {},
          restore() {},
          drawImage() {},
          getImageData: () => ({ data: pixels }),
        }),
      }),
    });
    const entry = {
      key: 'asset-recovery-led',
      asset: '/assets/electronics/asset-recovery-led.svg',
    } as CatalogEntry;
    const first = preloadComponentHitMask(entry, 10, 10);
    const second = preloadComponentHitMask(entry, 10, 10);
    expect(first).toBe(second);
    await first;
    expect(requests).toHaveLength(2);
    expect(componentAssetContainsPoint(entry, 10, 10, { x: 5, y: 5 })).toBe(true);
    expect(componentAssetContainsPoint(entry, 10, 10, { x: 0, y: 0 })).toBe(false);
    await preloadComponentHitMask(entry, 10, 10);
    expect(requests).toHaveLength(2);
  });
});
