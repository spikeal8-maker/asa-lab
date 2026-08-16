import { describe, expect, it } from 'vitest';
import { validateSnapshotImage, SNAPSHOT_MAX_BYTES, SNAPSHOT_MAX_EDGE } from '../domain/snapshot';

/**
 * These bytes arrive from a browser and are served back to classmates and
 * teachers. Every case here is a way that could go wrong: a file that is not an
 * image, an image whose real size disagrees with what a caller claims, and a
 * document format that only looks like an image.
 */

function padTo(bytes: number[], length: number): Uint8Array {
  const out = new Uint8Array(Math.max(bytes.length, length));
  out.set(bytes);
  return out;
}

function png(width: number, height: number, totalBytes = 128): Uint8Array {
  const header = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const ihdr = [0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52];
  const size = [
    (width >>> 24) & 0xff,
    (width >>> 16) & 0xff,
    (width >>> 8) & 0xff,
    width & 0xff,
    (height >>> 24) & 0xff,
    (height >>> 16) & 0xff,
    (height >>> 8) & 0xff,
    height & 0xff,
  ];
  return padTo([...header, ...ihdr, ...size, 8, 6, 0, 0, 0], totalBytes);
}

function riff(chunk: string, payload: number[], totalBytes = 128): Uint8Array {
  const head = [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50];
  const tag = [...chunk].map((character) => character.charCodeAt(0));
  const bytes = padTo([...head, ...tag, 0, 0, 0, 0, ...payload], totalBytes);
  const riffSize = bytes.length - 8;
  bytes[4] = riffSize & 0xff;
  bytes[5] = (riffSize >>> 8) & 0xff;
  bytes[6] = (riffSize >>> 16) & 0xff;
  bytes[7] = (riffSize >>> 24) & 0xff;
  return bytes;
}

function webpLossy(width: number, height: number): Uint8Array {
  return riff('VP8 ', [
    0,
    0,
    0,
    0x9d,
    0x01,
    0x2a,
    width & 0xff,
    (width >> 8) & 0x3f,
    height & 0xff,
    (height >> 8) & 0x3f,
  ]);
}

function webpLossless(width: number, height: number): Uint8Array {
  const bits = (width - 1) | ((height - 1) << 14);
  return riff('VP8L', [
    0x2f,
    bits & 0xff,
    (bits >>> 8) & 0xff,
    (bits >>> 16) & 0xff,
    (bits >>> 24) & 0xff,
  ]);
}

function webpExtended(width: number, height: number): Uint8Array {
  const w = width - 1;
  const h = height - 1;
  return riff('VP8X', [
    0x10,
    0,
    0,
    0,
    w & 0xff,
    (w >> 8) & 0xff,
    (w >> 16) & 0xff,
    h & 0xff,
    (h >> 8) & 0xff,
    (h >> 16) & 0xff,
  ]);
}

describe('validateSnapshotImage', () => {
  it('accepts a PNG and reads its size from the header', () => {
    const result = validateSnapshotImage(png(320, 200));
    expect(result).toMatchObject({ ok: true, image: { contentType: 'image/png' } });
    if (!result.ok) throw new Error('unreachable');
    expect(result.image.width).toBe(320);
    expect(result.image.height).toBe(200);
  });

  it('accepts all three WebP chunk layouts a canvas can produce', () => {
    for (const [name, bytes] of [
      ['lossy', webpLossy(320, 200)],
      ['lossless', webpLossless(320, 200)],
      ['extended', webpExtended(320, 200)],
    ] as const) {
      const result = validateSnapshotImage(bytes);
      expect(result.ok, name).toBe(true);
      if (!result.ok) continue;
      expect(result.image, name).toMatchObject({
        contentType: 'image/webp',
        width: 320,
        height: 200,
      });
    }
  });

  it('rejects anything that is not one of the two accepted formats', () => {
    const gif = padTo([0x47, 0x49, 0x46, 0x38, 0x39, 0x61], 128);
    expect(validateSnapshotImage(gif)).toMatchObject({ ok: false });
  });

  /**
   * The one that matters most: an SVG is a document, not a picture. It can
   * carry script and fetch remote resources, and it would run in the context of
   * whoever opened the class.
   */
  it('rejects an SVG even though a browser would render it as an image', () => {
    const svg = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>fetch("https://example.invalid")</script></svg>',
    );
    expect(validateSnapshotImage(svg)).toMatchObject({ ok: false });
  });

  it('rejects HTML disguised by a name the caller controls', () => {
    const html = new TextEncoder().encode('<!doctype html><html><body>not an image</body></html>');
    expect(validateSnapshotImage(html)).toMatchObject({ ok: false });
  });

  it('rejects a PNG signature with no readable header behind it', () => {
    const truncated = padTo([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 128);
    expect(validateSnapshotImage(truncated)).toMatchObject({ ok: false });
  });

  /** A RIFF whose declared length disagrees with the bytes has payload hidden after the image. */
  it('rejects a WebP with data appended after the declared image', () => {
    const bytes = webpLossless(320, 200);
    const padded = new Uint8Array(bytes.length + 64);
    padded.set(bytes);
    expect(validateSnapshotImage(padded)).toMatchObject({ ok: false });
  });

  it('rejects an image larger than a card could ever need', () => {
    expect(validateSnapshotImage(png(320, 200, SNAPSHOT_MAX_BYTES + 1))).toMatchObject({
      ok: false,
    });
  });

  it('rejects a decompression-bomb header', () => {
    expect(validateSnapshotImage(png(SNAPSHOT_MAX_EDGE + 1, 200))).toMatchObject({ ok: false });
  });

  it('rejects an image too small to be a preview of anything', () => {
    expect(validateSnapshotImage(png(4, 4))).toMatchObject({ ok: false });
  });

  it('rejects an empty upload', () => {
    expect(validateSnapshotImage(new Uint8Array(0))).toMatchObject({ ok: false });
  });
});
