import type { CatalogEntry } from './component-catalog';

interface Point {
  readonly x: number;
  readonly y: number;
}

export interface HitMask {
  readonly width: number;
  readonly height: number;
  readonly alpha: Uint8ClampedArray;
}

export interface ComponentVisibleBounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

type HitMaskState =
  | { readonly status: 'loading'; readonly ready: Promise<void> }
  | {
      readonly status: 'ready';
      readonly mask: HitMask;
      readonly visibleBounds: ComponentVisibleBounds | null;
    }
  | { readonly status: 'failed' };

const MAX_MASK_DIMENSION = 192;
const masks = new Map<string, HitMaskState>();

function maskKey(entry: CatalogEntry, width: number, height: number): string {
  return [entry.key, entry.asset, entry.assetFit ?? 'meet', width, height].join('|');
}

function drawAsset(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  entry: CatalogEntry,
  width: number,
  height: number,
  scale: number,
): void {
  const drawMeet = (targetWidth: number, targetHeight: number): void => {
    const sourceWidth = Math.max(1, image.naturalWidth || image.width);
    const sourceHeight = Math.max(1, image.naturalHeight || image.height);
    if (entry.assetFit === 'stretch' || entry.key === 'diode-do41') {
      context.drawImage(image, 0, 0, targetWidth, targetHeight);
      return;
    }
    const fit = Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight);
    const drawnWidth = sourceWidth * fit;
    const drawnHeight = sourceHeight * fit;
    context.drawImage(
      image,
      (targetWidth - drawnWidth) / 2,
      (targetHeight - drawnHeight) / 2,
      drawnWidth,
      drawnHeight,
    );
  };

  context.save();
  if (entry.key === 'diode-do35') {
    context.translate(width * scale, 0);
    context.rotate(Math.PI / 2);
    drawMeet(height * scale, width * scale);
  } else if (entry.key === 'diode-do41') {
    context.translate(0, height * 0.06 * scale);
    drawMeet(width * scale, height * 0.88 * scale);
  } else {
    drawMeet(width * scale, height * scale);
  }
  context.restore();
}

/**
 * Prepares an alpha mask from the same owner asset that is drawn on the stage.
 * It does not alter or trace the source SVG; the browser only samples its
 * already-rendered alpha channel for pointer hit testing.
 */
export function preloadComponentHitMask(
  entry: CatalogEntry,
  width: number,
  height: number,
): Promise<void> {
  if (typeof document === 'undefined' || typeof Image === 'undefined') return Promise.resolve();
  const key = maskKey(entry, width, height);
  const existing = masks.get(key);
  if (existing?.status === 'loading') return existing.ready;
  if (existing) return Promise.resolve();

  const image = new Image();
  const ready = new Promise<void>((resolve) => {
    image.onload = () => {
      try {
        const scale = Math.min(1, MAX_MASK_DIMENSION / Math.max(width, height));
        const maskWidth = Math.max(1, Math.ceil(width * scale));
        const maskHeight = Math.max(1, Math.ceil(height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = maskWidth;
        canvas.height = maskHeight;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) throw new Error('Canvas 2D is unavailable');
        drawAsset(context, image, entry, width, height, scale);
        const mask = {
          width: maskWidth,
          height: maskHeight,
          alpha: context
            .getImageData(0, 0, maskWidth, maskHeight)
            .data.filter((_value, index) => index % 4 === 3),
        } satisfies HitMask;
        masks.set(key, {
          status: 'ready',
          mask,
          visibleBounds: hitMaskVisibleBounds(mask, width, height),
        });
      } catch {
        masks.set(key, { status: 'failed' });
      }
      resolve();
    };
    image.onerror = () => {
      masks.set(key, { status: 'failed' });
      resolve();
    };
  });
  masks.set(key, { status: 'loading', ready });
  image.src = entry.asset;
  return ready;
}

/**
 * Returns the painted alpha silhouette bounds in the component's unrotated
 * local coordinate system. This is derived from the same owner asset used for
 * hit testing; it never creates or persists replacement artwork.
 */
export function hitMaskVisibleBounds(
  mask: HitMask,
  width: number,
  height: number,
): ComponentVisibleBounds | null {
  let minX = mask.width;
  let minY = mask.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < mask.height; y += 1) {
    for (let x = 0; x < mask.width; x += 1) {
      if ((mask.alpha[y * mask.width + x] ?? 0) < 16) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (maxX < minX || maxY < minY) return null;
  return {
    minX: (minX / mask.width) * width,
    minY: (minY / mask.height) * height,
    maxX: ((maxX + 1) / mask.width) * width,
    maxY: ((maxY + 1) / mask.height) * height,
  };
}

export function componentAssetVisibleBounds(
  entry: CatalogEntry,
  width: number,
  height: number,
): ComponentVisibleBounds | null {
  const state = masks.get(maskKey(entry, width, height));
  return state?.status === 'ready' ? state.visibleBounds : null;
}

export function hitMaskContainsPoint(
  mask: HitMask,
  point: Point,
  width: number,
  height: number,
): boolean {
  if (point.x < 0 || point.y < 0 || point.x > width || point.y > height) return false;
  const x = Math.min(mask.width - 1, Math.floor((point.x / width) * mask.width));
  const y = Math.min(mask.height - 1, Math.floor((point.y / height) * mask.height));
  // A one-raster-pixel tolerance keeps thin component leads practical without
  // turning transparent SVG margins into draggable body area.
  for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
    for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
      const sampleX = x + offsetX;
      const sampleY = y + offsetY;
      if (sampleX < 0 || sampleY < 0 || sampleX >= mask.width || sampleY >= mask.height) continue;
      if ((mask.alpha[sampleY * mask.width + sampleX] ?? 0) >= 16) return true;
    }
  }
  return false;
}

export function componentAssetContainsPoint(
  entry: CatalogEntry,
  width: number,
  height: number,
  point: Point,
): boolean {
  const state = masks.get(maskKey(entry, width, height));
  if (state?.status === 'ready') return hitMaskContainsPoint(state.mask, point, width, height);
  // While the same-origin asset is loading, suppress the old rectangular hit
  // box. On an exceptional rasterisation failure the visual remains selectable
  // through its terminals and keyboard instead of reviving an enormous ghost
  // collision around the part.
  return false;
}
