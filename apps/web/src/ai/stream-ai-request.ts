import { fetchWithSessionRefresh } from '../session-fetch';

// Also accept older servers' last-80-message completions: even JSON escaping
// 80 persisted 8192-character messages fits within this bounded character cap.
const MAX_EVENT_CHARACTERS = 4 * 1024 * 1024;

/** Native ASA Lab SSE transport. Each POST has a stable client request ID. */
export interface AiStreamResponse<T> {
  readonly messages: readonly T[];
  readonly replayed: boolean;
  readonly stopped: boolean;
}

export class AiStreamClientError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
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
): Promise<AiStreamResponse<T>> {
  return streamCommand(
    threadId,
    'messages',
    { message: text, requestId, ...(model ? { model } : {}) },
    onDelta,
    signal,
    scopeHeaders,
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
): Promise<AiStreamResponse<T>> {
  return streamCommand(
    threadId,
    'regenerations',
    { sourceUserMessageId, requestId, ...(model ? { model } : {}) },
    onDelta,
    signal,
    scopeHeaders,
  );
}

async function streamCommand<T>(
  threadId: string,
  operation: 'messages' | 'regenerations',
  body: Record<string, string>,
  onDelta: (piece: string) => void,
  signal: AbortSignal,
  scopeHeaders: Record<string, string>,
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
      problem?.error?.message ?? 'Не удалось отправить сообщение.',
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
    if (kind === 'delta' && typeof (parsed as { text?: unknown }).text === 'string') {
      onDelta((parsed as { text: string }).text);
    } else if (kind === 'done') {
      result = parsed as AiStreamResponse<T>;
    } else if (kind === 'error') {
      const problem = parsed as { code?: string; message?: string };
      throw new AiStreamClientError(
        problem.code ?? 'ai_provider_error',
        problem.message ?? 'Ответ модели прервался.',
      );
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
