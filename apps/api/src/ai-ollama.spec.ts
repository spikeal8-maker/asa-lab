import { describe, expect, it, vi } from 'vitest';
import {
  OllamaError, ollamaBaseUrl, validOllamaModel, discoverOllama, streamOllamaText,
} from './ai-ollama';

describe('Ollama private network boundary', () => {
  it.each([
    'http://127.0.0.1:11434', 'http://192.168.1.22:11434',
    'http://10.20.30.40:11434', 'http://172.17.0.1:11434',
    'http://100.100.100.100:11434', 'http://host.docker.internal:11434',
  ])('allows exact loopback/LAN and Docker host-gateway %s', (url) => {
    expect(ollamaBaseUrl(url)).toBe(url);
  });
  it.each([
    'http://169.254.169.254:11434', 'http://8.8.8.8:11434',
    'http://example.com:11434', 'http://192.168.1.1:11434/admin',
    'http://user:password@192.168.1.1:11434', 'http://127.0.0.1:11434?evil=1',
    'https://192.168.1.1:11434', 'http://[::1]:11434',
    'file:///etc/passwd', 'http://172.32.1.1:11434',
    'http://192.168.1.1:11434#fragment',
  ])('rejects public/metadata/credential/redirect-surface endpoint %s', (url) => {
    expect(() => ollamaBaseUrl(url)).toThrow(OllamaError);
  });
  it('restricts the model identifier independently of network URL', () => {
    expect(validOllamaModel('gemma4:12b')).toBe(true);
    expect(validOllamaModel('deepseek-r1:7b')).toBe(true);
    expect(validOllamaModel('../../private')).toBe(false);
    expect(validOllamaModel('model name')).toBe(false);
    expect(validOllamaModel('')).toBe(false);
  });
});

describe('Ollama live HTTP protocol with deterministic fake transport', () => {
  it('discovers installed model names, never follows redirects and sends no credentials', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      models: [{ name: 'gemma4:12b', size: 99 }, { name: 'fake model', size: 77 }],
    })));
    const models = await discoverOllama('http://192.168.0.99:11434', fetchImpl);
    expect(models).toEqual([{ name: 'gemma4:12b', size: 99 }]);
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, options] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('http://192.168.0.99:11434/api/tags');
    expect(options).toMatchObject({ method: 'GET', redirect: 'error' });
    expect(JSON.stringify(options)).not.toContain('Bearer');
  });
  it('streams bounded NDJSON chunks and preserves real delta order', async () => {
    const encoder = new TextEncoder();
    const lines = [
      JSON.stringify({ message: { role: 'assistant', content: 'При' }, done: false }) + '\n',
      JSON.stringify({ message: { role: 'assistant', content: 'вет' }, done: false }) + '\n',
      JSON.stringify({ done: true }) + '\n',
    ].join('');
    const data = encoder.encode(lines);
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(data.slice(0, 11));
        controller.enqueue(data.slice(11, 49));
        controller.enqueue(data.slice(49));
        controller.close();
      },
    }), { status: 200 }));
    const deltas: string[] = [];
    const result = await streamOllamaText({
      baseUrl: 'http://127.0.0.1:11434', model: 'gemma4:12b',
      context: [{ role: 'user', content: 'Привет' }], instructions: 'Ответь на русском.',
      signal: new AbortController().signal, onDelta: delta => deltas.push(delta), fetchImpl,
    });
    expect(result).toEqual({ text: 'Привет', stopped: false });
    expect(deltas).toEqual(['При', 'вет']);
    const [url, options] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('http://127.0.0.1:11434/api/chat');
    expect(options).toMatchObject({ method: 'POST', redirect: 'error' });
    expect(JSON.parse(String(options?.body))).toMatchObject({
      model: 'gemma4:12b', stream: true,
      messages: [{ role: 'system', content: 'Ответь на русском.' }, { role: 'user', content: 'Привет' }],
    });
    expect(JSON.stringify(options)).not.toContain('authorization');
  });
  it('reports incomplete stream with partial text for safe history persistence', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(
      JSON.stringify({ message: { content: 'Часть ответа' }, done: false }) + '\n',
      { status: 200 },
    ));
    await expect(streamOllamaText({
      baseUrl: 'http://192.168.1.2:11434', model: 'gemma4:12b',
      context: [], instructions: '', signal: new AbortController().signal,
      onDelta: () => undefined, fetchImpl,
    })).rejects.toMatchObject({
      code: 'ai_ollama_interrupted', partialText: 'Часть ответа',
    });
  });
  it('does not issue a request when already cancelled', async () => {
    const abort = new AbortController();
    abort.abort();
    const fetchImpl = vi.fn<typeof fetch>();
    expect(await streamOllamaText({
      baseUrl: 'http://127.0.0.1:11434', model: 'gemma4:12b',
      context: [], instructions: '', signal: abort.signal, onDelta: () => undefined, fetchImpl,
    })).toEqual({ text: '', stopped: true });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('never fetches when a non-LAN endpoint is supplied', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    await expect(streamOllamaText({
      baseUrl: 'http://metadata.google.internal:11434', model: 'gemma4:12b',
      context: [], instructions: '', signal: new AbortController().signal,
      onDelta: () => undefined, fetchImpl,
    })).rejects.toMatchObject({ code: 'ai_ollama_url_denied' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
