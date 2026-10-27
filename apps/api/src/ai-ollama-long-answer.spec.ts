import { expect, it, vi } from 'vitest';
import { streamOllamaText } from './ai-ollama';

it('keeps Qwen xhigh, shared context and complete code past the old output cap', async () => {
  const answer = 'function completeCode() { return 42; }\n'.repeat(1000);
  const events = Array.from({ length: 100 }, (_, n) =>
    JSON.stringify({ message: { content: answer.slice(n * 380, (n + 1) * 380) } }),
  );
  // Include all remaining bytes, then an explicit upstream completion.
  events.push(JSON.stringify({ message: { content: answer.slice(38000) }, done: true }));
  const fetchImpl = vi.fn<typeof fetch>(async () => new Response(events.join('\n') + '\n'));
  const deltas: string[] = [];
  const result = await streamOllamaText({
    baseUrl: 'http://127.0.0.1:11434',
    model: 'qwen3.8:27b',
    context: [{ role: 'user', content: 'Write complete code' }],
    instructions: '',
    signal: new AbortController().signal,
    onDelta: (value) => deltas.push(value),
    fetchImpl,
  });
  expect(result.text).toBe(answer);
  expect(deltas.join('')).toBe(answer);
  expect(result.stopped).toBe(false);
  expect(JSON.parse(String(fetchImpl.mock.calls[0]![1]?.body))).toMatchObject({
    think: 'xhigh',
    keep_alive: -1,
    options: { num_ctx: 120000, num_predict: -1 },
  });
});
