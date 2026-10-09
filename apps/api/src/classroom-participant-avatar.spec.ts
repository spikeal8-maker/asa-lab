import { describe, expect, it } from 'vitest';
import { PNG } from 'pngjs';
import { canonicalClassroomAvatar } from './classroom-participant-avatar.js';

function png(width = 32, height = 32): string {
  const image = new PNG({ width, height });
  image.data.fill(128);
  return `data:image/png;base64,${PNG.sync.write(image).toString('base64')}`;
}
describe('classroom raster boundary', () => {
  it('decodes and stores bounded canonical pixels', () => {
    const result = canonicalClassroomAvatar(png());
    const decoded = PNG.sync.read(Buffer.from(result.split(',')[1]!, 'base64'));
    expect(decoded.width).toBe(32);
    expect(decoded.height).toBe(32);
    expect(decoded.data[0]).toBe(128);
  });
  it('rejects executable, forged, broken, oversized and extreme dimension uploads', () => {
    for (const input of [
      'data:image/svg+xml;base64,PHN2Zz4=',
      'data:text/html;base64,PGgxPg==',
      'data:image/png;base64,PGh0bWw+',
      'https://other-class.test/image.png',
      png(8, 32),
      png(513, 32),
      `data:image/png;base64,${'A'.repeat(300_000)}`,
    ]) {
      expect(() => canonicalClassroomAvatar(input)).toThrow();
    }
    const bytes = Buffer.from(png().split(',')[1]!, 'base64');
    bytes[30] = bytes[30]! ^ 255;
    expect(() =>
      canonicalClassroomAvatar(`data:image/png;base64,${bytes.toString('base64')}`),
    ).toThrow();
  });
});
