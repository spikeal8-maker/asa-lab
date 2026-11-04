import { expect, it, vi } from 'vitest';
import { discoverPolzaModels, parsePolzaModels } from './ai-polza-catalog';
import {
  buildAiTextRequest,
  installPolzaModelCatalog,
  supportsAiImageInput,
  supportsAiTools,
} from './ai-model-catalog';
const chat = {
  id: 'qwen/vision',
  name: 'Vision',
  type: 'chat',
  architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] },
  endpoints: ['/api/v1/chat/completions'],
  top_provider: { supported_parameters: ['tools'], max_completion_tokens: 2048 },
};
it('uses explicit endpoint and modality metadata, never names, for Vision/tools and text selection', () => {
  const rows = parsePolzaModels({
    data: [
      chat,
      {
        ...chat,
        id: 'fake/vision',
        type: 'stt',
        architecture: { input_modalities: ['audio'], output_modalities: ['text'] },
      },
    ],
  });
  expect(rows[0]).toMatchObject({
    id: 'polza/qwen/vision',
    vision: true,
    tools: true,
    maxOutputTokens: 2048,
    selected: false,
  });
  expect(rows[1]).toMatchObject({ kind: 'stt', vision: false, tools: false });
  installPolzaModelCatalog({
    version: 1,
    checkedAt: '2026-11-02T00:00:00Z',
    credentialCurrent: true,
    items: rows.map((m) => ({ ...m, selected: m.kind === 'chat' })),
  });
  const request = buildAiTextRequest(
    'polza',
    'polza/qwen/vision',
    [{ role: 'user', content: 'Check' }],
    'Test',
    true,
    ['data:image/png;base64,aA=='],
  );
  expect(request.url).toBe('https://polza.ai/api/v1/chat/completions');
  expect(request.body).toMatchObject({ model: 'qwen/vision', max_tokens: 2048, stream: true });
  expect(supportsAiImageInput('polza', 'polza/qwen/vision')).toBe(true);
  expect(supportsAiTools('polza', 'polza/qwen/vision')).toBe(true);
  expect(() => buildAiTextRequest('polza', 'polza/fake/vision', [], '', true)).toThrow();
});
it.each([
  { data: [chat, chat] },
  { data: [{ ...chat, id: 'https://evil.test/key' }] },
  { data: [chat], has_more: true },
  { data: Array(1201).fill(chat) },
])('rejects ambiguous, injected or truncated metadata', (raw) =>
  expect(() => parsePolzaModels(raw)).toThrow(),
);
it('bounds transfer, pins the vendor origin and does not follow redirects', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ data: [chat] })));
  expect(await discoverPolzaModels('test-only', fetcher)).toHaveLength(1);
  expect(fetcher).toHaveBeenCalledWith(
    'https://polza.ai/api/v1/models',
    expect.objectContaining({ method: 'GET', redirect: 'error' }),
  );
  await expect(
    discoverPolzaModels('test-only', async () => new Response('x'.repeat(2 * 1024 * 1024 + 1))),
  ).rejects.toThrow('TOO_LARGE');
  await expect(
    discoverPolzaModels('test-only', async () => new Response('', { status: 401 })),
  ).rejects.toThrow('UNAVAILABLE');
});
