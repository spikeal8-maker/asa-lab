import { AI_MAX_ANSWER_CHARS, AI_GENERATION_TIMEOUT_MS } from './ai-generation-limits.js';
/** Bounded upstream SSE decoder for OpenAI Responses and DeepSeek Chat Completions.
 * No provider credentials, request URLs, or response bodies are logged. */
import {
  classifyProviderHttpFailure,
  classifyProviderTransportFailure,
} from './ai-provider-errors.js';
import {
  buildAiTextRequest,
  isModelForProvider,
  isKnownOllamaCloudModel,
} from './ai-model-catalog.js';
import { providerUsage, mergeProviderUsage, type AiProviderUsage } from './ai-provider-usage.js';
export type StreamProvider = 'openai' | 'deepseek' | 'ollama-cloud';

export class ProviderStreamError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
    readonly partialText: string = '',
    readonly usage?: AiProviderUsage,
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
  readonly usage?: AiProviderUsage;
}

const MAX_RESULT_CHARS = AI_MAX_ANSWER_CHARS;
const MAX_EVENT_BUFFER = 128 * 1024;

function completionState(
  provider: StreamProvider,
  terminal: unknown,
  partialText = '',
): 'complete' | 'stopped' {
  if (provider === 'openai' && terminal === 'completed') return 'complete';
  if (provider !== 'openai' && terminal === 'stop') return 'complete';
  if (provider !== 'openai' && terminal === 'length') return 'stopped';
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
    const response = payload as {
      status?: unknown;
      output_text?: unknown;
      output?: unknown;
      incomplete_details?: { reason?: unknown };
    };
    terminal =
      response.status === 'incomplete' &&
      response.incomplete_details?.reason === 'max_output_tokens'
        ? 'length'
        : response.status;
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
  const usage = providerUsage(provider, payload);
  let state: 'complete' | 'stopped';
  try {
    state =
      provider === 'openai' && terminal === 'length'
        ? 'stopped'
        : completionState(provider, terminal, bounded);
  } catch (error) {
    if (error instanceof ProviderStreamError)
      throw new ProviderStreamError(
        error.code,
        error.status,
        error.message,
        error.partialText,
        usage,
      );
    throw error;
  }
  if (!bounded) {
    throw new ProviderStreamError(
      'ai_response_empty',
      503,
      'Модель не вернула текст ответа.',
      '',
      usage,
    );
  }
  return {
    text: bounded,
    stopped: state === 'stopped' || text.length > MAX_RESULT_CHARS,
    ...(usage ? { usage } : {}),
  };
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
  if (!(isModelForProvider(provider, model) || isKnownOllamaCloudModel(provider, model))) {
    throw new ProviderStreamError('ai_model_invalid', 400, 'Выберите поддерживаемую модель.');
  }
  const request = buildAiTextRequest(provider, model, context, instructions, true);
  const timeout = AbortSignal.timeout(AI_GENERATION_TIMEOUT_MS);
  const combined = AbortSignal.any([signal, timeout]);
  let response: Response;
  try {
    response = await fetchImpl(request.url, {
      method: 'POST',
      ...(provider === 'ollama-cloud' ? { redirect: 'error' as const } : {}),
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
    const failure = classifyProviderTransportFailure(timeout.aborted);
    throw new ProviderStreamError(failure.code, failure.status, failure.message);
  }

  if (!response.ok) {
    const failure = classifyProviderHttpFailure(response.status);
    throw new ProviderStreamError(failure.code, failure.status, failure.message);
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
  let usage: AiProviderUsage | undefined;

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
      if (provider !== 'openai') {
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
    usage = mergeProviderUsage(
      usage,
      providerUsage(
        provider,
        provider === 'openai' ? (payload as { response?: unknown })?.response : payload,
      ),
    );
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
      if (
        (payload as { response?: { incomplete_details?: { reason?: unknown } } })?.response
          ?.incomplete_details?.reason === 'max_output_tokens'
      ) {
        providerState = 'stopped';
        finished = true;
        return;
      }
      completionState(provider, 'incomplete');
    }
    if (provider !== 'openai' && payload && typeof payload === 'object') {
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
    if (signal.aborted) return { text: content, stopped: true, ...(usage ? { usage } : {}) };
    if (error instanceof ProviderStreamError) {
      throw new ProviderStreamError(error.code, error.status, error.message, content, usage);
    }
    throw new ProviderStreamError(
      timeout.aborted ? 'ai_provider_timeout' : 'ai_stream_interrupted',
      timeout.aborted ? 504 : 503,
      timeout.aborted ? 'Время ожидания модели истекло.' : 'Поток модели был прерван.',
      content,
      usage,
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
      usage,
    );
  }
  if (!finished && !signal.aborted && content.length < MAX_RESULT_CHARS) {
    throw new ProviderStreamError(
      'ai_stream_interrupted',
      503,
      'Соединение закрыто до завершения ответа модели.',
      content,
      usage,
    );
  }
  if (!content.trim() && !signal.aborted) {
    throw new ProviderStreamError(
      'ai_response_empty',
      503,
      'Модель не вернула текст ответа.',
      '',
      usage,
    );
  }
  return {
    text: content,
    stopped: signal.aborted || providerState === 'stopped' || content.length >= MAX_RESULT_CHARS,
    ...(usage ? { usage } : {}),
  };
}
