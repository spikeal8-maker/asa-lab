/** Bounded upstream SSE decoder for OpenAI Responses and DeepSeek Chat Completions.
 * No provider credentials, request URLs, or response bodies are logged. */
export type StreamProvider = 'openai' | 'deepseek';

export class ProviderStreamError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ProviderStreamError';
  }
}

interface StreamArgs {
  readonly fetchImpl: typeof fetch;
  readonly provider: StreamProvider;
  readonly model: string;
  readonly apiKey: string;
  readonly context: readonly { role: 'user' | 'assistant'; content: string }[];
  readonly instructions: string;
  readonly signal: AbortSignal;
  readonly onDelta: (delta: string) => void;
}

export interface ProviderStreamResult {
  readonly text: string;
  readonly stopped: boolean;
}

const MAX_RESULT_CHARS = 8192;
const MAX_EVENT_BUFFER = 128 * 1024;

function textDelta(event: string, payload: unknown, provider: StreamProvider): string {
  if (!payload || typeof payload !== 'object') return '';
  if (provider === 'openai') {
    const packet = payload as { type?: string; delta?: unknown };
    return (event === 'response.output_text.delta' || packet.type === 'response.output_text.delta') &&
      typeof packet.delta === 'string'
      ? packet.delta
      : '';
  }
  const packet = payload as { choices?: Array<{ delta?: { content?: unknown } }> };
  const content = packet.choices?.[0]?.delta?.content;
  return typeof content === 'string' ? content : '';
}

/**
 * Reads only provider delta events; data boundaries may split UTF-8 sequences,
 * JSON records, and frames. A caller abort is distinct from provider timeout.
 */
export async function streamProviderText({
  fetchImpl,
  provider,
  model,
  apiKey,
  context,
  instructions,
  signal,
  onDelta,
}: StreamArgs): Promise<ProviderStreamResult> {
  const timeout = AbortSignal.timeout(65000);
  const combined = AbortSignal.any([signal, timeout]);
  let response: Response;
  try {
    response = await fetchImpl(
      provider === 'openai'
        ? 'https://api.openai.com/v1/responses'
        : 'https://api.deepseek.com/chat/completions',
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer ' + apiKey,
          'content-type': 'application/json',
          accept: 'text/event-stream',
        },
        body: JSON.stringify(
          provider === 'openai'
            ? {
                model,
                instructions,
                input: context,
                max_output_tokens: 1600,
                store: false,
                stream: true,
              }
            : {
                model,
                messages: [{ role: 'system', content: instructions }, ...context],
                max_tokens: 1600,
                stream: true,
              },
        ),
        signal: combined,
      },
    );
  } catch {
    if (signal.aborted) return { text: '', stopped: true };
    throw new ProviderStreamError(
      timeout.aborted ? 'ai_provider_timeout' : 'ai_provider_unavailable',
      timeout.aborted ? 504 : 503,
      'Не удалось установить соединение с моделью.',
    );
  }

  if (!response.ok) {
    throw new ProviderStreamError(
      response.status === 429 ? 'ai_provider_rate_limit' : 'ai_provider_error',
      response.status === 429 ? 429 : 503,
      response.status === 429
        ? 'Провайдер ограничил число запросов.'
        : 'Провайдер отклонил запрос. Проверьте ключ и модель в админке.',
    );
  }
  if (!response.body) {
    throw new ProviderStreamError('ai_stream_invalid', 503, 'Провайдер не поддержал потоковый ответ.');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  let finished = false;

  function handle(frame: string): void {
    if (finished) return;
    const lines = frame.split(/\r?\n/);
    const event = lines.find((line) => line.startsWith('event:'))?.slice(6).trim() ?? '';
    const data = lines
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n');
    if (!data) return;
    if (data === '[DONE]') {
      finished = true;
      return;
    }
    let payload: unknown;
    try {
      payload = JSON.parse(data) as unknown;
    } catch {
      throw new ProviderStreamError('ai_stream_invalid', 503, 'Повреждён ответ модели.');
    }
    if (event === 'error' || (payload as { type?: string }).type === 'error') {
      throw new ProviderStreamError('ai_provider_error', 503, 'Провайдер прервал генерацию.');
    }
    if (event === 'response.completed' || (payload as { type?: string }).type === 'response.completed') {
      finished = true;
      return;
    }
    const delta = textDelta(event, payload, provider);
    const available = MAX_RESULT_CHARS - content.length;
    if (!delta || available <= 0) return;
    const safeDelta = delta.slice(0, available);
    content += safeDelta;
    onDelta(safeDelta);
  }

  try {
    while (!finished && !combined.aborted && content.length < MAX_RESULT_CHARS) {
      const item = await reader.read();
      if (item.done) break;
      buffer += decoder.decode(item.value, { stream: true });
      if (buffer.length > MAX_EVENT_BUFFER) {
        throw new ProviderStreamError('ai_stream_invalid', 503, 'Превышен предел размера события модели.');
      }
      let boundary = /\r?\n\r?\n/.exec(buffer);
      while (boundary) {
        const raw = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary[0].length);
        handle(raw);
        boundary = /\r?\n\r?\n/.exec(buffer);
      }
    }
  } catch (error) {
    if (signal.aborted) return { text: content, stopped: true };
    if (error instanceof ProviderStreamError) throw error;
    throw new ProviderStreamError(
      timeout.aborted ? 'ai_provider_timeout' : 'ai_stream_interrupted',
      timeout.aborted ? 504 : 503,
      timeout.aborted ? 'Время ожидания модели истекло.' : 'Поток модели был прерван.',
    );
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  if (timeout.aborted && !signal.aborted) {
    throw new ProviderStreamError('ai_provider_timeout', 504, 'Время ожидания модели истекло.');
  }
  if (!content.trim() && !signal.aborted) {
    throw new ProviderStreamError('ai_response_empty', 503, 'Модель не вернула текст ответа.');
  }
  return {
    text: content,
    stopped: signal.aborted || content.length >= MAX_RESULT_CHARS,
  };
}
