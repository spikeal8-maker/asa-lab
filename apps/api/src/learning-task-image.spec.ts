import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { renderTaskImagePreview } from './learning-task-image.js';

describe('task image previews', () => {
  it('fits both viewport variants, applies EXIF orientation and strips metadata', async () => {
    const original = await sharp({
      create: { width: 1800, height: 900, channels: 3, background: '#404080' },
    })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    for (const width of [640, 1280] as const) {
      const image = await renderTaskImagePreview(original, width);
      const meta = await sharp(image).metadata();
      expect(meta).toMatchObject({ format: 'webp', width: width / 2, height: width });
      expect(meta.orientation).toBeUndefined();
      expect(meta.exif).toBeUndefined();
    }
    expect((await sharp(original).metadata()).orientation).toBe(6);
  });

  it('retains transparency and does not enlarge a small image', async () => {
    const original = await sharp({
      create: { width: 42, height: 14, channels: 4, background: '#20202000' },
    })
      .png()
      .toBuffer();
    const image = await renderTaskImagePreview(original, 640);
    expect(await sharp(image).metadata()).toMatchObject({
      format: 'webp',
      width: 42,
      height: 14,
      hasAlpha: true,
    });
  });
});
