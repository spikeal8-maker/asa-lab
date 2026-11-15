import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});
async function run(
  width: number,
  height: number,
  size: number,
  signature = [137, 80, 78, 71, 13, 10, 26, 10],
) {
  const postMessage = vi.fn();
  const scope: { onmessage?: (event: unknown) => Promise<void>; postMessage: typeof postMessage } =
    { postMessage };
  const close = vi.fn();
  const decode = vi.fn(async () => ({ width, height, close }));
  const draw = vi.fn();
  vi.stubGlobal('self', scope);
  vi.stubGlobal('createImageBitmap', decode);
  vi.stubGlobal(
    'OffscreenCanvas',
    class {
      getContext() {
        return { drawImage: draw };
      }
      async convertToBlob() {
        return new Blob(['encoded'], { type: 'image/png' });
      }
    },
  );
  await import('./prepare-image.worker');
  const file = {
    size,
    slice: () => ({ arrayBuffer: async () => new Uint8Array(signature).buffer }),
  };
  await scope.onmessage!({ data: file });
  return { reply: postMessage.mock.calls[0]![0], file, decode, close, draw };
}
it('keeps a small screenshot byte-for-byte instead of recompressing it', async () => {
  const result = await run(1200, 800, 120000);
  expect(result.reply.blob).toBe(result.file);
  expect(result.reply.unchanged).toBe(true);
  expect(result.draw).not.toHaveBeenCalled();
  expect(result.close).toHaveBeenCalledOnce();
});
it('bounds actual decoded dimensions while preferring lossless text pixels', async () => {
  const { reply, draw } = await run(6000, 4000, 6000000);
  expect(reply.width * reply.height).toBeLessThanOrEqual(4000000);
  expect(Math.max(reply.width, reply.height)).toBeLessThanOrEqual(2560);
  expect(reply.blob.type).toBe('image/png');
  expect(draw).toHaveBeenCalledOnce();
});
it('rejects excessive input before decoding', async () => {
  const { reply, decode } = await run(100, 100, 33 * 1024 * 1024);
  expect(reply.error).toContain('32 МБ');
  expect(decode).not.toHaveBeenCalled();
});
it('rejects disguised SVG rather than rasterizing active external content', async () => {
  const { reply, decode } = await run(100, 100, 1000, [60, 115, 118, 103, 62]);
  expect(reply.error).toContain('PNG, JPEG и WebP');
  expect(decode).not.toHaveBeenCalled();
});
