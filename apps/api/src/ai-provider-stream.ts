/** Bounded upstream SSE decoder for OpenAI Responses and DeepSeek Chat Completions.
 * No provider credentials, request URLs, or response bodies are logged. */
import { buildAiTextRequest, isModelForProvider } from './ai-model-catalog.js';
export type StreamProvider = 'openai' | 'deepseek';

export class ProviderStreamError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
    readonly partialText: string = '',
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

function completionState(
  provider: StreamProvider,
  terminal: unknown,
  partialText = '',
): 'complete' | 'stopped' {
  if (provider === 'openai' && terminal === 'completed') return 'complete';
  if (provider === 'deepseek' && terminal === 'stop') return 'complete';
  if (provider === 'deepseek' && terminal === 'length') return 'stopped';
  throw new ProviderStreamError(
    provider === 'openai' && terminal === 'failed' ? 'ai_provider_error' : 'ai_response_incomplete',
    503,
    'Модель не завершила ответ.',
    partialText,
  );
}

/** The legacy JSON transport must confirm the same provider terminal state as SSE. */
export function parseProviderText(
  provider: StreamProvider,
  payload: unknown,
): ProviderStreamResult {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new ProviderStreamError('ai_response_invalid', 503, 'Модель вернула некорректный ответ.');
  }
  let text = '';
  let terminal: unknown;
  if (provider === 'openai') {
    const response = payload as { status?: unknown; output_text?: unknown; output?: unknown };
    terminal = response.status;
    if (typeof response.output_text === 'string') text = response.output_text;
    else if (Array.isArray(response.output)) {
      text = response.output
        .flatMap((item: { content?: unknown } | null) =>
          Array.isArray(item?.content) ? item.content : [],
        )
        .filter(
          (item: { type?: unknown; text?: unknown } | null) =>
            item?.type === 'output_text' && typeof item.text === 'string',
        )
        .map((item: { text: string }) => item.text)
        .join('\n');
    }
  } else {
    const response = payload as {
      choices?: Array<{ finish_reason?: unknown; message?: { content?: unknown } } | null>;
    };
    const choice = Array.isArray(response.choices) ? response.choices[0] : null;
    terminal = choice?.finish_reason;
    if (typeof choice?.message?.content === 'string') text = choice.message.content;
  }
  text = text.trim();
  const bounded = text.slice(0, MAX_RESULT_CHARS);
  const state = completionState(provider, terminal, bounded);
  if (!bounded) {
    throw new ProviderStreamError('ai_response_empty', 503, 'Модель не вернула текст ответа.');
  }
  return { text: bounded, stopped: state === 'stopped' || text.length >= MAX_RESULT_CHARS };
}

function textDelta(event: string, payload: unknown, provider: StreamProvider): string {
  if (!payload || typeof payload !== 'object') return '';
  if (provider === 'openai') {
    const packet = payload as { type?: string; delta?: unknown };
    return (event === 'response.output_text.delta' ||
      packet.type === 'response.output_text.delta') &&
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
  if (signal.aborted) return { text: '', stopped: true };
  if (!isModelForProvider(provider, model)) {
    throw new ProviderStreamError('ai_model_invalid', 400, 'Выберите поддерживаемую модель.');
  }
  const request = buildAiTextRequest(provider, model, context, instructions, true);
  const timeout = AbortSignal.timeout(65000);
  const combined = AbortSignal.any([signal, timeout]);
  let response: Response;
  try {
    response = await fetchImpl(request.url, {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + apiKey,
        'content-type': 'application/json',
        accept: 'text/event-stream',
      },
      body: JSON.stringify(request.body),
      signal: combined,
    });
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
    throw new ProviderStreamError(
      'ai_stream_invalid',
      503,
      'Провайдер не поддержал потоковый ответ.',
    );
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  let finished = false;
  let providerState: 'complete' | 'stopped' | null = null;

  function handle(frame: string): void {
    if (finished || combined.aborted) return;
    const lines = frame.split(/\r?\n/);
    const event =
      lines
        .find((line) => line.startsWith('event:'))
        ?.slice(6)
        .trim() ?? '';
    const data = lines
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n');
    if (!data) return;
    if (data === '[DONE]') {
      if (provider === 'deepseek') {
        if (providerState === null) completionState(provider, null);
        finished = true;
      }
      return;
    }
    let payload: unknown;
    try {
      payload = JSON.parse(data) as unknown;
    } catch {
      throw new ProviderStreamError('ai_stream_invalid', 503, 'Повреждён ответ модели.');
    }
    const packetType =
      payload && typeof payload === 'object' ? (payload as { type?: unknown }).type : null;
    if (
      event === 'error' ||
      packetType === 'error' ||
      event === 'response.failed' ||
      packetType === 'response.failed'
    ) {
      throw new ProviderStreamError('ai_provider_error', 503, 'Провайдер прервал генерацию.');
    }
    if (
      provider === 'openai' &&
      (event === 'response.incomplete' || packetType === 'response.incomplete')
    ) {
      completionState(provider, 'incomplete');
    }
    if (provider === 'deepseek' && payload && typeof payload === 'object') {
      const reason = (payload as { choices?: Array<{ finish_reason?: string | null }> })
        .choices?.[0]?.finish_reason;
      if (reason !== null && reason !== undefined) {
        providerState = completionState(provider, reason);
      }
    }
    if (
      provider === 'openai' &&
      (event === 'response.completed' || packetType === 'response.completed')
    ) {
      const status = (payload as { response?: { status?: unknown } })?.response?.status;
      completionState(provider, status ?? 'completed');
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
        throw new ProviderStreamError(
          'ai_stream_invalid',
          503,
          'Превышен предел размера события модели.',
        );
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
    if (error instanceof ProviderStreamError) {
      throw new ProviderStreamError(error.code, error.status, error.message, content);
    }
    throw new ProviderStreamError(
      timeout.aborted ? 'ai_provider_timeout' : 'ai_stream_interrupted',
      timeout.aborted ? 504 : 503,
      timeout.aborted ? 'Время ожидания модели истекло.' : 'Поток модели был прерван.',
      content,
    );
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  if (timeout.aborted && !signal.aborted) {
    throw new ProviderStreamError(
      'ai_provider_timeout',
      504,
      'Время ожидания модели истекло.',
      content,
    );
  }
  if (!finished && !signal.aborted && content.length < MAX_RESULT_CHARS) {
    throw new ProviderStreamError(
      'ai_stream_interrupted',
      503,
      'Соединение закрыто до завершения ответа модели.',
      content,
    );
  }
  if (!content.trim() && !signal.aborted) {
    throw new ProviderStreamError('ai_response_empty', 503, 'Модель не вернула текст ответа.');
  }
  return {
    text: content,
    stopped: signal.aborted || providerState === 'stopped' || content.length >= MAX_RESULT_CHARS,
  };
}
