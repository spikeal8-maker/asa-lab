import { expect, it, vi } from 'vitest';
import { embedPreviewImages, loadPreviewImages, previewImageCandidates } from './ai-preview-images';
import { readGeneratedImage } from './read-generated-image';
vi.mock('./read-generated-image', async (original) => ({
  ...(await original<typeof import('./read-generated-image')>()),
  readGeneratedImage: vi.fn(),
}));
import { codePreviewDocument } from './ai-code-preview';

const path =
  '/api/ai/threads/11111111-1111-4111-8111-111111111111/web-search/22222222-2222-4222-8222-222222222222/images/1';
const url = 'https://images.example.org/cat.jpg';
const evidence = {
  schemaVersion: 1,
  provider: 'searxng',
  mode: 'images',
  status: 'ready',
  query: 'cats',
  retrievedAt: '2026-11-02T00:00:00Z',
  sources: [],
  images: [
    {
      id: 1,
      title: 'cat',
      thumbnailUrl: path,
      sourceUrl: 'https://example.org/cat',
      originalUrl: url,
    },
  ],
};
const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1]);

it('uses only a completed image receipt from this thread, carries Seat proof and embeds it in preview and downloadable HTML', async () => {
  const threadId = '11111111-1111-4111-8111-111111111111';
  const requestId = '33333333-3333-4333-8333-333333333333';
  const downloadUrl = `/api/ai/threads/${threadId}/image-generations/${requestId}/image`;
  const image = {
    requestId,
    downloadUrl,
    width: 1024,
    height: 1024,
    mimeType: 'image/png' as const,
    sizeBytes: png.length,
  };
  const code = `<h1>Site</h1><img src="${downloadUrl}" alt="Моя картинка"><script>console.log('works')</script>`;
  const candidates = previewImageCandidates(code, [], { threadId, images: [image] });
  expect(candidates).toHaveLength(1);
  vi.mocked(readGeneratedImage).mockResolvedValueOnce(new Blob([png], { type: 'image/png' }));
  const fetchImpl = vi.fn<typeof fetch>();
  const abort = new AbortController();
  const images = await loadPreviewImages(candidates, 'seat-a', abort.signal, fetchImpl);
  expect(fetchImpl).not.toHaveBeenCalled();
  expect(readGeneratedImage).toHaveBeenLastCalledWith(image, threadId, 'seat-a', abort.signal);
  expect(codePreviewDocument(code, false, false, images)).toContain(
    '<img src="data:image/png;base64,',
  );
  const download = embedPreviewImages(code, images);
  expect(download).toContain('<img src="data:image/png;base64,');
  expect(download).not.toContain(downloadUrl);
  expect(download).toContain("console.log('works')");
  expect(previewImageCandidates(code, [], { threadId: requestId, images: [image] })).toEqual([]);
  expect(
    previewImageCandidates(code, [], {
      threadId,
      images: [{ ...image, downloadUrl: 'https://evil.org/private' }],
    }),
  ).toEqual([]);
  expect(
    previewImageCandidates(code, [], {
      threadId,
      images: [{ ...image, sizeBytes: 9 * 1024 * 1024 }],
    }),
  ).toEqual([]);
  expect(previewImageCandidates(code, [])).toEqual([]);
});

it('fetches only exact referenced typed evidence through the scoped raster proxy and reconstructs a data-only preview', async () => {
  const code = `<img src="${url}" alt="Cat" onerror="fetch('/api')"><img src="https://evil.org/x"><img srcset="${url} 2x"><img src="data:image/svg+xml,bad">`;
  const candidates = previewImageCandidates(code, [evidence]);
  const fetchImpl = vi.fn<typeof fetch>(
    async () => new Response(png, { headers: { 'content-type': 'image/png' } }),
  );
  const images = await loadPreviewImages(
    candidates,
    'seat-123',
    new AbortController().signal,
    fetchImpl,
  );
  expect(fetchImpl).toHaveBeenCalledOnce();
  expect(fetchImpl.mock.calls[0]?.[0]).toBe(path);
  expect(fetchImpl.mock.calls[0]?.[1]?.headers).toEqual({ 'x-asa-ai-seat': 'seat-123' });
  const doc = codePreviewDocument(code, false, false, images)!;
  expect(doc).toContain('<img src="data:image/png;base64,');
  expect(doc).toContain('alt="Cat"');
  expect(doc).toContain('img-src data:');
  expect(doc).toContain("connect-src 'none'; frame-src 'none'");
  expect(doc).not.toMatch(/evil\.org|srcset=|onerror|data:image\/svg|https:/);
  expect(
    previewImageCandidates(`<img src="${url}">`, [
      { ...evidence, images: [{ ...evidence.images[0], thumbnailUrl: 'https://evil.org/pixel' }] },
    ]),
  ).toEqual([]);
});

it.each(['svg', 'oversize', 'error', 'mismatch'] as const)(
  'omits unsafe or unavailable proxy bytes: %s',
  async (kind) => {
    const response =
      kind === 'svg'
        ? new Response('<svg/>', { headers: { 'content-type': 'image/svg+xml' } })
        : kind === 'oversize'
          ? new Response(new Uint8Array(2 * 1024 * 1024 + 1), {
              headers: { 'content-type': 'image/png' },
            })
          : kind === 'error'
            ? new Response('', { status: 502 })
            : new Response('<svg/>', { headers: { 'content-type': 'image/png' } });
    const images = await loadPreviewImages(
      previewImageCandidates(`<img src="${url}">`, [evidence]),
      undefined,
      new AbortController().signal,
      vi.fn(async () => response),
    );
    expect(images.size).toBe(0);
  },
);

it('bounds selected assets and repeated serialized image references', async () => {
  const many = {
    ...evidence,
    images: Array.from({ length: 12 }, (_, i) => ({
      ...evidence.images[0],
      id: i + 1,
      thumbnailUrl: path.replace('/images/1', '/images/' + (i + 1)),
      originalUrl: url + '?' + i,
    })),
  };
  expect(
    previewImageCandidates(many.images.map((i) => `<img src="${i.originalUrl}">`).join(''), [many]),
  ).toHaveLength(5);
  const data = 'data:image/png;base64,' + 'A'.repeat(1024 * 1024);
  expect(
    codePreviewDocument(`<img src="${url}">`.repeat(8), true, false, new Map([[url, data]])),
  ).toBeNull();
  expect(() => embedPreviewImages(`<img src="${url}">`.repeat(8), new Map([[url, data]]))).toThrow(
    'image_limit',
  );
  expect(() => embedPreviewImages('<img src="/api/ai/threads/other/image">', new Map())).toThrow(
    'image_unavailable',
  );
  const second = url + '?second';
  const large = 'data:image/png;base64,' + 'A'.repeat(4 * 1024 * 1024);
  expect(() =>
    embedPreviewImages(
      `<img src="${url}"><img src="${second}">`,
      new Map([
        [url, large],
        [second, large],
      ]),
    ),
  ).toThrow('image_limit');
});

it('cancels a pending scope before publishing any bytes', async () => {
  const abort = new AbortController();
  const fetchImpl = vi.fn<typeof fetch>(async () => {
    abort.abort();
    return new Response(png, { headers: { 'content-type': 'image/png' } });
  });
  await expect(
    loadPreviewImages(
      previewImageCandidates(`<img src="${url}">`, [evidence]),
      'seat-a',
      abort.signal,
      fetchImpl,
    ),
  ).rejects.toMatchObject({ name: 'AbortError' });
});
