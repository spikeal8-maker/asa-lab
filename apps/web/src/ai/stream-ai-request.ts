import {
  aiPublicErrorMessage,
  AI_TEXT_UNAVAILABLE,
  isAiToolActivity,
  type AiToolActivity,
} from '@asa-lab/contracts';
import { fetchWithSessionRefresh } from '../session-fetch';
import type { AiWebSearchMode, AiImageGenerationJob, AiImageSize } from '@asa-lab/contracts';

// The legacy completion returns up to 80 persisted messages. Reserve the
// worst-case JSON escaping of the bounded 65536-character answer per message.
const MAX_EVENT_CHARACTERS = 32 * 1024 * 1024;

/** Native ASA Lab SSE transport. Each POST has a stable client request ID. */
export interface AiStreamResponse<T> {
  readonly imageJob?: AiImageGenerationJob;
  readonly messages: readonly T[];
  readonly replayed: boolean;
  readonly stopped: boolean;
}

export class AiStreamClientError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(aiPublicErrorMessage(code, message));
    this.name = 'AiStreamClientError';
  }
}

export async function streamAiRequest<T>(
  threadId: string,
  text: string,
  requestId: string,
  onDelta: (piece: string) => void,
  signal: AbortSignal,
  model?: string,
  scopeHeaders: Record<string, string> = {},
  attachmentIds: readonly string[] = [],
  webSearch?: { readonly mode: AiWebSearchMode; readonly weatherCity?: string },
  nativeImage?: { readonly mode: 'off' | 'auto'; readonly size: AiImageSize },
  onActivity?: (activity: AiToolActivity) => void,
): Promise<AiStreamResponse<T>> {
  return streamCommand(
    threadId,
    'messages',
    {
      message: text,
      requestId,
      ...(nativeImage ? { nativeImage } : {}),
      ...(model ? { model } : {}),
      ...(attachmentIds.length ? { attachmentIds } : {}),
      ...(webSearch
        ? {
            webSearchMode: webSearch.mode,
            ...(webSearch.weatherCity ? { weatherCity: webSearch.weatherCity } : {}),
          }
        : {}),
    },
    onDelta,
    signal,
    scopeHeaders,
    onActivity,
  );
}

/** A new variant has its own paid request ID and references a persisted question. */
export async function streamAiRegeneration<T>(
  threadId: string,
  sourceUserMessageId: string,
  requestId: string,
  onDelta: (piece: string) => void,
  signal: AbortSignal,
  model?: string,
  scopeHeaders: Record<string, string> = {},
  onActivity?: (activity: AiToolActivity) => void,
): Promise<AiStreamResponse<T>> {
  return streamCommand(
    threadId,
    'regenerations',
    { sourceUserMessageId, requestId, ...(model ? { model } : {}) },
    onDelta,
    signal,
    scopeHeaders,
    onActivity,
  );
}

async function streamCommand<T>(
  threadId: string,
  operation: 'messages' | 'regenerations',
  body: Record<string, unknown>,
  onDelta: (piece: string) => void,
  signal: AbortSignal,
  scopeHeaders: Record<string, string>,
  onActivity?: (activity: AiToolActivity) => void,
): Promise<AiStreamResponse<T>> {
  const response = await fetchWithSessionRefresh(
    '/api/ai/threads/' + encodeURIComponent(threadId) + '/' + operation + '/stream',
    {
      method: 'POST',
      headers: { ...scopeHeaders, 'content-type': 'application/json', accept: 'text/event-stream' },
      body: JSON.stringify(body),
      signal,
    },
  );
  if (!response.ok) {
    let problem: { error?: { code?: string; message?: string } } | null = null;
    try {
      problem = (await response.json()) as { error?: { code?: string; message?: string } };
    } catch {
      /* Proxy and network errors must not surface raw response bodies. */
    }
    throw new AiStreamClientError(
      problem?.error?.code ?? 'ai_http_error',
      aiPublicErrorMessage(
        problem?.error?.code ?? '',
        /^ai_(input|session|scope|access|attachment|thread|origin|json|request_id|vision|source)/.test(
          problem?.error?.code ?? '',
        )
          ? problem?.error?.message
          : AI_TEXT_UNAVAILABLE,
      ),
    );
  }
  if (!response.headers.get('content-type')?.includes('text/event-stream') || !response.body) {
    throw new AiStreamClientError('ai_stream_unsupported', 'Сервер не вернул потоковый ответ.');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result: AiStreamResponse<T> | null = null;
  function checkSize(size: number): void {
    if (size > MAX_EVENT_CHARACTERS) {
      throw new AiStreamClientError('ai_stream_invalid', 'Превышен размер события сервера.');
    }
  }
  function process(frame: string): void {
    if (result || signal.aborted) return;
    const lines = frame.split(/\r?\n/);
    const kind = lines
      .find((line) => line.startsWith('event:'))
      ?.slice(6)
      .trim();
    const data = lines
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n');
    if (!kind || !data) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(data) as unknown;
    } catch {
      throw new AiStreamClientError('ai_stream_invalid', 'Сервер прислал повреждённое событие.');
    }
    if (kind === 'delta') {
      if (
        !parsed ||
        typeof parsed !== 'object' ||
        typeof (parsed as { text?: unknown }).text !== 'string'
      )
        throw new AiStreamClientError('ai_stream_invalid', AI_TEXT_UNAVAILABLE);
      onDelta((parsed as { text: string }).text);
    } else if (kind === 'activity') {
      if (isAiToolActivity(parsed)) onActivity?.(parsed);
    } else if (kind === 'done') {
      const value = parsed as Partial<AiStreamResponse<T>> | null;
      if (
        !value ||
        !Array.isArray(value.messages) ||
        typeof value.replayed !== 'boolean' ||
        typeof value.stopped !== 'boolean'
      )
        throw new AiStreamClientError('ai_stream_invalid', AI_TEXT_UNAVAILABLE);
      result = value as AiStreamResponse<T>;
    } else if (kind === 'error') {
      const problem = parsed && typeof parsed === 'object' ? (parsed as { code?: unknown }) : {};
      const code =
        typeof problem.code === 'string' && problem.code.length <= 100
          ? problem.code
          : 'ai_provider_error';
      throw new AiStreamClientError(code, aiPublicErrorMessage(code));
    }
  }
  try {
    while (!result && !signal.aborted) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      let delimiter = /\r?\n\r?\n/.exec(buffer);
      while (delimiter) {
        checkSize(delimiter.index);
        process(buffer.slice(0, delimiter.index));
        buffer = buffer.slice(delimiter.index + delimiter[0].length);
        delimiter = /\r?\n\r?\n/.exec(buffer);
      }
      // A network chunk can contain many complete events. Bound each event,
      // then only the unfinished remainder, independently of chunk boundaries.
      checkSize(buffer.length);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  if (!result) {
    throw new AiStreamClientError(
      'ai_stream_interrupted',
      'Соединение прервалось. Проверьте историю диалога.',
    );
  }
  return result;
}
