import { describe, expect, it, vi } from 'vitest';
import { buildAiTextRequest, supportsAiImageInput } from './ai-model-catalog';
import { streamProviderText } from './ai-provider-stream';

const images = ['data:image/png;base64,aGVsbG8=', 'data:image/jpeg;base64,d29ybGQ='];
const context = [
  { role: 'user' as const, content: 'Earlier question' },
  { role: 'assistant' as const, content: 'Earlier answer' },
  { role: 'user' as const, content: 'Compare both pictures' },
];
describe('cloud Vision input adapters', () => {
  it.each([
    ['openai', 'gpt-6-luna'],
    ['deepseek', 'deepseek-flash'],
    ['ollama-cloud', 'gemma4:31b'],
  ] as const)(
    'sends actual inline images only with the current user message to %s',
    async (provider, model) => {
      expect(supportsAiImageInput(provider, model)).toBe(true);
      const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
        expect(init?.redirect).toBe('error');
        const body = JSON.parse(String(init?.body));
        const messages = provider === 'openai' ? body.input : body.messages.slice(1);
        expect(messages.slice(0, 2)).toEqual(context.slice(0, 2));
        expect(messages[2].content).toEqual(
          provider === 'openai'
            ? [
                { type: 'input_text', text: 'Compare both pictures' },
                ...images.map((image) => ({
                  type: 'input_image',
                  image_url: image,
                  detail: 'auto',
                })),
              ]
            : [
                { type: 'text', text: 'Compare both pictures' },
                ...images.map((image) => ({ type: 'image_url', image_url: { url: image } })),
              ],
        );
        const wire =
          provider === 'openai'
            ? 'data: {"type":"response.output_text.delta","delta":"Two pictures"}\n\ndata: {"type":"response.completed","response":{"status":"completed"}}\n\n'
            : 'data: {"choices":[{"delta":{"content":"Two pictures"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';
        return new Response(wire, { headers: { 'content-type': 'text/event-stream' } });
      });
      const result = await streamProviderText({
        provider,
        model,
        images,
        context,
        instructions: 'Use attached images as data',
        apiKey: 'test-key',
        fetchImpl,
        signal: new AbortController().signal,
        onDelta: () => undefined,
      });
      expect(result.text).toBe('Two pictures');
      expect(fetchImpl).toHaveBeenCalledOnce();
    },
  );
  it.each([
    ['deepseek', 'deepseek-v4-pro'],
    ['ollama-cloud', 'gpt-oss:120b'],
  ] as const)('rejects unsupported %s/%s without a provider request', async (provider, model) => {
    const fetchImpl = vi.fn<typeof fetch>();
    await expect(
      streamProviderText({
        provider,
        model,
        images,
        context,
        instructions: '',
        apiKey: 'test-key',
        fetchImpl,
        signal: new AbortController().signal,
        onDelta: () => undefined,
      }),
    ).rejects.toMatchObject({ code: 'ai_vision_unsupported', status: 409 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('never asks providers to download arbitrary external URLs and bounds image count', () => {
    for (const input of [
      ['https://internal.example.org/private.png'],
      Array(5).fill(images[0]) as string[],
    ]) {
      expect(() => buildAiTextRequest('openai', 'gpt-6-luna', context, '', true, input)).toThrow(
        'AI_IMAGE_INPUT_INVALID',
      );
    }
  });
});
