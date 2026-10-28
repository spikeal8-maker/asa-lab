/** Server-only Ollama transport. Supports loopback, private LAN, and Docker host gateway.
 * Never accepts browser-supplied endpoints, follows redirects, or logs prompts/addresses.
 * Adapted from IZO_ASA/backend/app/integrations/ollama.py (main 51543df2).
 */
import { isIP } from 'node:net';
import { providerUsage, mergeProviderUsage, type AiProviderUsage } from './ai-provider-usage.js';
import {
  parseNativeToolCalls,
  type NativeToolCall,
  type NativeToolDefinition,
  type NativeToolResult,
} from './ai-native-tools.js';

export const OLLAMA_SELECTION = 'ollama-local' as const;
export interface OllamaSettings {
  readonly enabled: boolean;
  readonly baseUrl: string;
  readonly model: string;
  readonly revision: number;
  readonly updatedAt: string | null;
  readonly thinking?: string | undefined;
  readonly contextTokens?: number | undefined;
}
export interface OllamaModel {
  readonly name: string;
  readonly size: number;
  readonly capabilities?: readonly string[];
}
export class OllamaError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
    readonly partialText = '',
    readonly usage?: AiProviderUsage,
  ) {
    super(message);
    this.name = 'OllamaError';
  }
}
export function validOllamaModel(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= 100 &&
    /^[A-Za-z0-9][A-Za-z0-9._:/@+-]*$/.test(value)
  );
}

/** Arbitrary destinations (public Internet, cloud metadata, DNS and URL credentials) are forbidden. */
export function ollamaBaseUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length > 256 || value.trim() !== value) {
    throw new OllamaError(
      'ai_ollama_url_invalid',
      400,
      'Укажите локальный IP-адрес и порт Ollama.',
    );
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new OllamaError('ai_ollama_url_invalid', 400, 'Неверный адрес Ollama.');
  }
  const host = url.hostname.toLowerCase();
  const octets = host.split('.').map(Number);
  const ipv4 = isIP(host) === 4 && octets.length === 4;
  const privateV4 =
    ipv4 &&
    (octets[0] === 10 ||
      octets[0] === 127 ||
      (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
      (octets[0] === 192 && octets[1] === 168) ||
      (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127));
  if (
    url.protocol !== 'http:' ||
    (!privateV4 && host !== 'localhost' && host !== 'host.docker.internal') ||
    !!url.username ||
    !!url.password ||
    !!url.search ||
    !!url.hash ||
    (url.pathname !== '/' && url.pathname !== '') ||
    !url.port
  ) {
    throw new OllamaError(
      'ai_ollama_url_denied',
      400,
      'Разрешены только http:// и частный IPv4, localhost или host.docker.internal с портом.',
    );
  }
  return url.origin;
}
function failure(status: number): OllamaError {
  if (status === 404)
    return new OllamaError('ai_ollama_model_missing', 503, 'Модель не найдена в Ollama.');
  if (status === 429 || status === 503)
    return new OllamaError('ai_ollama_busy', 503, 'Локальная модель перегружена.');
  return new OllamaError('ai_ollama_upstream_error', 503, 'Ollama отклонила запрос.');
}
async function limitedJson(response: Response): Promise<unknown> {
  if (!response.body) throw new OllamaError('ai_ollama_invalid', 503, 'Ollama не вернула данные.');
  const reader = response.body.getReader();
  const bytes: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.length;
      if (length > 256 * 1024)
        throw new OllamaError('ai_ollama_invalid', 503, 'Каталог Ollama слишком большой.');
      bytes.push(next.value);
    }
  } catch (problem) {
    if (problem instanceof OllamaError) throw problem;
    throw new OllamaError(
      'ai_ollama_interrupted',
      503,
      'Соединение с Ollama прервалось при получении списка моделей.',
    );
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  try {
    const joined = new Uint8Array(length);
    let offset = 0;
    for (const item of bytes) {
      joined.set(item, offset);
      offset += item.length;
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(joined)) as unknown;
  } catch {
    throw new OllamaError('ai_ollama_invalid', 503, 'Ollama вернула некорректные данные.');
  }
}
export async function discoverOllama(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<OllamaModel[]> {
  const origin = ollamaBaseUrl(baseUrl);
  let response: Response;
  try {
    response = await fetchImpl(origin + '/api/tags', {
      method: 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(5000),
      headers: { accept: 'application/json' },
    });
  } catch {
    throw new OllamaError(
      'ai_ollama_unreachable',
      503,
      'API-сервер не может подключиться к Ollama.',
    );
  }
  if (!response.ok) throw failure(response.status);
  const payload = await limitedJson(response);
  if (!payload || typeof payload !== 'object')
    throw new OllamaError('ai_ollama_invalid', 503, 'Некорректный каталог моделей.');
  const entries = (payload as { models?: unknown }).models;
  if (!Array.isArray(entries))
    throw new OllamaError('ai_ollama_invalid', 503, 'Ollama не вернула список моделей.');
  return entries.slice(0, 100).flatMap((entry: unknown) => {
    if (!entry || typeof entry !== 'object') return [];
    const value = entry as { name?: unknown; size?: unknown };
    return validOllamaModel(value.name)
      ? [
          {
            name: value.name,
            size: typeof value.size === 'number' && value.size >= 0 ? value.size : 0,
          },
        ]
      : [];
  });
}

/** Capabilities are verified from Ollama itself, never inferred from a model name. */
export async function inspectOllamaModel(
  baseUrl: string,
  model: string,
  fetchImpl: typeof fetch = fetch,
): Promise<OllamaModelDetail> {
  const origin = ollamaBaseUrl(baseUrl);
  if (!validOllamaModel(model))
    throw new OllamaError('ai_ollama_model_invalid', 400, 'Неверная модель Ollama.');
  let response: Response;
  try {
    response = await fetchImpl(origin + '/api/show', {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(5000),
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ model }),
    });
  } catch {
    throw new OllamaError(
      'ai_ollama_capability_unknown',
      503,
      'Не удалось подтвердить возможности модели в Ollama.',
    );
  }
  if (!response.ok) throw failure(response.status);
  const detail = await limitedJson(response);
  if (
    !detail ||
    typeof detail !== 'object' ||
    !Array.isArray((detail as { capabilities?: unknown }).capabilities)
  )
    throw new OllamaError(
      'ai_ollama_capability_unknown',
      503,
      'Ollama не сообщила достоверные возможности модели.',
    );
  const data = detail as {
    capabilities: unknown[];
    thinking?: { values?: unknown; default?: unknown };
    model_info?: Record<string, unknown>;
  };
  const capabilities = data.capabilities
    .filter((v): v is string => typeof v === 'string' && v.length <= 40)
    .slice(0, 32);
  const values = Array.isArray(data.thinking?.values)
    ? data.thinking.values
        .filter(
          (v): v is boolean | string =>
            typeof v === 'boolean' || (typeof v === 'string' && /^[a-z][a-z0-9_-]{0,39}$/.test(v)),
        )
        .slice(0, 32)
    : [];
  const maximum = Object.entries(data.model_info ?? {}).find(([key]) =>
    key.endsWith('.context_length'),
  )?.[1];
  return {
    capabilities,
    thinking: values.length
      ? {
          values,
          default: values.includes(data.thinking?.default as boolean | string)
            ? (data.thinking!.default as boolean | string)
            : null,
        }
      : null,
    contextMax:
      typeof maximum === 'number' && Number.isSafeInteger(maximum) && maximum > 0 ? maximum : null,
  };
}
export interface OllamaModelDetail {
  readonly capabilities: readonly string[];
  readonly thinking: {
    readonly values: readonly (boolean | string)[];
    readonly default: boolean | string | null;
  } | null;
  readonly contextMax: number | null;
}
export async function describeOllamaModel(
  baseUrl: string,
  model: string,
  fetchImpl: typeof fetch = fetch,
): Promise<readonly string[]> {
  return (await inspectOllamaModel(baseUrl, model, fetchImpl)).capabilities;
}
export function validOllamaOptions(thinking: unknown, context: unknown): boolean {
  return (
    (thinking === undefined ||
      (typeof thinking === 'string' &&
        /^(default|off|on|[a-z][a-z0-9_-]{0,39})$/.test(thinking))) &&
    (context === undefined ||
      (Number.isSafeInteger(context) && Number(context) >= 2048 && Number(context) <= 1048576))
  );
}
export function resolveOllamaThinking(
  mode: string,
  detail: OllamaModelDetail,
): boolean | string | undefined {
  const info = detail.thinking;
  if (mode === 'default') {
    if (!info) return undefined;
    // Preserve the model's own enabled default; opt in when its default is disabled.
    return info.default !== false && info.default !== null
      ? info.default
      : (info.values.find((v) => v !== false) ?? false);
  }
  const value = mode === 'off' ? false : mode === 'on' ? true : mode;
  if (!info?.values.includes(value))
    throw new OllamaError(
      'ai_ollama_thinking_invalid',
      400,
      'Этот режим размышления не поддерживается выбранной моделью.',
    );
  return value;
}

export interface OllamaStreamArgs {
  readonly baseUrl: string;
  readonly model: string;
  readonly context: readonly { role: 'user' | 'assistant'; content: string }[];
  /** Already owner-verified, integrity-checked and bounded base64 images. */
  readonly images?: readonly string[];
  readonly instructions: string;
  readonly signal: AbortSignal;
  readonly onDelta: (delta: string) => void;
  readonly fetchImpl?: typeof fetch;
  readonly tools?: readonly NativeToolDefinition[];
  readonly toolResults?: readonly NativeToolResult[];
  readonly thinking?: string | undefined;
  readonly contextTokens?: number | undefined;
}
export async function streamOllamaText(args: OllamaStreamArgs): Promise<{
  text: string;
  stopped: boolean;
  usage?: AiProviderUsage;
  toolCalls?: readonly NativeToolCall[];
}> {
  const origin = ollamaBaseUrl(args.baseUrl);
  if (!validOllamaModel(args.model))
    throw new OllamaError('ai_ollama_model_invalid', 400, 'Неверная модель Ollama.');
  if (args.signal.aborted) return { text: '', stopped: true };
  if (!validOllamaOptions(args.thinking, args.contextTokens))
    throw new OllamaError('ai_ollama_config_invalid', 400, 'Неверные параметры Ollama.');
  const thinking =
    args.thinking === undefined
      ? undefined
      : resolveOllamaThinking(
          args.thinking,
          await inspectOllamaModel(args.baseUrl, args.model, args.fetchImpl ?? fetch),
        );
  const timeout = AbortSignal.timeout(1800000);
  const signal = AbortSignal.any([args.signal, timeout]);
  let response: Response;
  try {
    response = await (args.fetchImpl ?? fetch)(origin + '/api/chat', {
      method: 'POST',
      redirect: 'error',
      signal,
      headers: { 'content-type': 'application/json', accept: 'application/x-ndjson' },
      body: JSON.stringify({
        model: args.model,
        messages: [
          { role: 'system', content: args.instructions },
          ...args.context.map((item, index) => ({
            ...item,
            ...(index === args.context.length - 1 && item.role === 'user' && args.images?.length
              ? { images: args.images }
              : {}),
          })),
          ...(args.toolResults?.length
            ? [
                {
                  role: 'assistant',
                  content: '',
                  tool_calls: args.toolResults.map((result) => ({
                    type: 'function',
                    function: { name: result.call.name, arguments: result.call.arguments },
                  })),
                },
                ...args.toolResults.map((result) => ({
                  role: 'tool',
                  tool_name: result.call.name,
                  content: result.content,
                })),
              ]
            : []),
        ],
        ...(args.tools?.length ? { tools: args.tools } : {}),
        stream: true,
        ...(thinking !== undefined ? { think: thinking } : {}),
        keep_alive: -1,
        options: { num_ctx: args.contextTokens ?? 65536, num_predict: -1 },
      }),
    });
  } catch {
    if (args.signal.aborted) return { text: '', stopped: true };
    throw new OllamaError('ai_ollama_unreachable', 503, 'Нет связи с Ollama.');
  }
  if (!response.ok) throw failure(response.status);
  if (!response.body) throw new OllamaError('ai_ollama_invalid', 503, 'Ollama не вернула поток.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let done = false;
  let lengthLimited = false;
  let usage: AiProviderUsage | undefined;
  const rawCalls: unknown[] = [];
  const frame = (line: string): void => {
    if (!line.trim()) return;
    let data: unknown;
    try {
      data = JSON.parse(line) as unknown;
    } catch {
      throw new OllamaError('ai_ollama_invalid', 503, 'Повреждён поток Ollama.', text);
    }
    if (!data || typeof data !== 'object')
      throw new OllamaError('ai_ollama_invalid', 503, 'Некорректный ответ Ollama.', text);
    const packet = data as {
      message?: { content?: unknown; tool_calls?: unknown };
      done?: unknown;
      done_reason?: unknown;
      error?: unknown;
    };
    usage = mergeProviderUsage(usage, providerUsage('ollama', packet));
    if (packet.error)
      throw new OllamaError('ai_ollama_upstream_error', 503, 'Ollama сообщила об ошибке.', text);
    if (packet.message?.tool_calls !== undefined) {
      if (
        !Array.isArray(packet.message.tool_calls) ||
        rawCalls.length + packet.message.tool_calls.length > 1
      )
        throw new OllamaError(
          'ai_tool_call_invalid',
          503,
          'Модель вернула неподдерживаемый вызов инструмента.',
        );
      rawCalls.push(...packet.message.tool_calls);
    }
    if (typeof packet.message?.content === 'string') {
      const delta = packet.message.content;
      text += delta;
      if (delta) args.onDelta(delta);
    }
    if (packet.done === true) {
      done = true;
      lengthLimited = packet.done_reason === 'length';
    }
  };
  try {
    while (!done && !signal.aborted) {
      const part = await reader.read();
      if (part.done) break;
      buffer += decoder.decode(part.value, { stream: true });
      let boundary = buffer.indexOf('\n');
      while (boundary >= 0) {
        // Bound each NDJSON event, not the entire HTTP chunk. One LAN read
        // can legitimately contain hundreds of short Ollama token events.
        if (boundary > 16 * 1024)
          throw new OllamaError('ai_ollama_invalid', 503, 'Слишком большое событие Ollama.', text);
        frame(buffer.slice(0, boundary).trimEnd());
        buffer = buffer.slice(boundary + 1);
        // Stop immediately even when many token frames were coalesced into
        // this same HTTP chunk; do not emit queued deltas after cancellation.
        if (done || signal.aborted) break;
        boundary = buffer.indexOf('\n');
      }
      if (!done && buffer.length > 16 * 1024)
        throw new OllamaError('ai_ollama_invalid', 503, 'Слишком большое событие Ollama.', text);
    }
    if (!done && !signal.aborted && buffer.trim()) frame(buffer.trim());
  } catch (error) {
    if (args.signal.aborted) return { text, stopped: true, ...(usage ? { usage } : {}) };
    if (error instanceof OllamaError)
      throw new OllamaError(error.code, error.status, error.message, text, usage);
    throw new OllamaError(
      timeout.aborted ? 'ai_ollama_timeout' : 'ai_ollama_interrupted',
      timeout.aborted ? 504 : 503,
      timeout.aborted ? 'Ollama не ответила вовремя.' : 'Поток Ollama прервался.',
      text,
      usage,
    );
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  if (timeout.aborted && !args.signal.aborted)
    throw new OllamaError('ai_ollama_timeout', 504, 'Ollama не ответила вовремя.', text, usage);
  if (!done && !args.signal.aborted)
    throw new OllamaError('ai_ollama_interrupted', 503, 'Ollama прервала ответ.', text, usage);
  let toolCalls: readonly NativeToolCall[] | undefined;
  if (rawCalls.length && !args.signal.aborted) {
    if (!done || lengthLimited)
      throw new OllamaError('ai_tool_call_invalid', 503, 'Вызов инструмента не завершён.');
    try {
      toolCalls = parseNativeToolCalls(rawCalls, args.tools ?? []);
    } catch {
      throw new OllamaError(
        'ai_tool_call_invalid',
        503,
        'Модель вернула неподдерживаемые аргументы инструмента.',
      );
    }
  }
  if (!text.trim() && !toolCalls?.length && !args.signal.aborted)
    throw new OllamaError('ai_ollama_empty', 503, 'Модель Ollama не вернула текст.', '', usage);
  return {
    text,
    stopped: args.signal.aborted || lengthLimited,
    ...(usage ? { usage } : {}),
    ...(toolCalls ? { toolCalls } : {}),
  };
}
