import { expect, it, vi } from 'vitest';
import { loadPreviewImages, previewImageCandidates } from './ai-preview-images';
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
