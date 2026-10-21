import { describe, expect, it, vi } from 'vitest';
import { discoverOllamaModels, generateOllamaText, ollamaOrigin } from './ai-ollama';

describe('Ollama private LAN boundary', () => {
  it('admits only private, loopback and Tailscale literal endpoints', () => {
    expect(ollamaOrigin('http://192.168.2.12:11434')).toBe('http://192.168.2.12:11434');
    expect(ollamaOrigin('http://172.21.0.3:11434')).toBe('http://172.21.0.3:11434');
    expect(ollamaOrigin('http://100.84.1.2:11434')).toBe('http://100.84.1.2:11434');
    for (const origin of [
      'http://8.8.8.8:11434', 'http://169.254.169.254:11434',
      'http://192.168.1.8:8080', 'http://192.168.1.8:11434/admin',
      'http://user:pass@192.168.1.8:11434', 'http://localhost:11434',
      'https://192.168.1.8:11434', 'http://010.0.0.1:11434',
      'http://192.168.1.8:11434?url=http://evil.test',
    ]) expect(() => ollamaOrigin(origin, '')).toThrow();
    expect(ollamaOrigin('http://ollama:11434', 'http://ollama:11434'))
      .toBe('http://ollama:11434');
  });

  it('discovers models without sending a key or following redirects', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ models: [{ name: 'gemma3:4b', size: 1234 }] }), { status: 200 }),
    );
    const models = await discoverOllamaModels(fetchImpl, 'http://10.0.2.20:11434');
    expect(models).toEqual([{ name: 'gemma3:4b', size: 1234 }]);
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(fetchImpl.mock.calls[0]![0]).toBe('http://10.0.2.20:11434/api/tags');
    expect(fetchImpl.mock.calls[0]![1]).toMatchObject({ redirect: 'error', method: 'GET' });
  });

  it('parses arbitrarily divided NDJSON and requires a terminal receipt', async () => {
    const lines = [
      '{"message":{"content":"При"},"done":false}\n',
      '{"message":{"content":"вет"},"done":false}\n',
      '{"message":{},"done":true}\n',
    ].join('');
    const split = [lines.slice(0, 12), lines.slice(12, 58), lines.slice(58)];
    const chunks = split.map((x) => new TextEncoder().encode(x));
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(new ReadableStream({
      start(controller) { for (const chunk of chunks) controller.enqueue(chunk); controller.close(); },
    }), { status: 200 }));
    const deltas: string[] = [];
    const result = await generateOllamaText({
      fetchImpl, address: 'http://10.1.2.3:11434', model: 'gemma3:4b',
      instructions: 'Test', context: [{ role: 'user', content: 'Привет' }],
      signal: new AbortController().signal, onDelta: (s) => deltas.push(s), stream: true,
    });
    expect(result).toEqual({ text: 'Привет', stopped: false });
    expect(deltas).toEqual(['При', 'вет']);
    const request = fetchImpl.mock.calls[0]![1]!;
    expect(request.redirect).toBe('error');
    const body = JSON.parse(String(request.body));
    expect(body.model).toBe('gemma3:4b');
    expect(body.messages.at(-1)).toEqual({ role: 'user', content: 'Привет' });
  });

  it('refuses incomplete model replies with retained partial text', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response('{"message":{"content":"часть"},"done":false}\n', { status: 200 }),
    );
    await expect(generateOllamaText({
      fetchImpl, address: 'http://192.168.1.8:11434', model: 'gemma3:4b',
      context: [], instructions: 'System', signal: new AbortController().signal,
      onDelta: () => undefined, stream: true,
    })).rejects.toMatchObject({ code: 'ai_ollama_incomplete', partialText: 'часть' });
  });
});
