/** Independent, server-only llama.cpp Chat Completions transport. */
import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP } from 'node:net';
import { Readable } from 'node:stream';
import { AI_MAX_ANSWER_CHARS, AI_MAX_OUTPUT_TOKENS } from './ai-generation-limits.js';
import {
  parseNativeToolBatch,
  type NativeToolCall,
  type NativeToolDefinition,
  type NativeToolResult,
} from './ai-native-tools.js';
import {
  mergeProviderUsage,
  providerModel,
  providerTokenCount,
  type AiProviderUsage,
} from './ai-provider-usage.js';

export const LLAMACPP_SELECTION = 'llamacpp-local' as const;
const MAX_FRAME = 1024 * 1024;
const MAX_JSON = 1024 * 1024;
const MAX_REQUEST = 8 * 1024 * 1024;
const MAX_CONTEXT = 1048576;
const GENERATION_TIMEOUT = 1800000;

export class LlamaCppError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
    readonly partialText = '',
    readonly usage?: AiProviderUsage,
    readonly applyState?: 'failed',
  ) {
    super(message);
    this.name = 'LlamaCppError';
  }
}

function invalid(message = 'llama.cpp вернул некорректный ответ.'): LlamaCppError {
  return new LlamaCppError('ai_llamacpp_invalid', 503, message);
}
const privateAddresses = new BlockList();
for (const [address, prefix] of [
  ['10.0.0.0', 8],
  ['127.0.0.0', 8],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
  ['100.64.0.0', 10],
] as const)
  privateAddresses.addSubnet(address, prefix, 'ipv4');
const privateV6Addresses = new BlockList();
privateV6Addresses.addAddress('::1', 'ipv6');
privateV6Addresses.addSubnet('fc00::', 7, 'ipv6');
const metadataAddresses = new BlockList();
metadataAddresses.addAddress('100.100.100.200', 'ipv4'); // Alibaba, inside CGNAT.
metadataAddresses.addAddress('fd00:ec2::254', 'ipv6'); // AWS IMDS, inside ULA.

/** The administrator selects one endpoint; only these local networks are eligible. */
export function llamaCppPrivateAddress(address: string): boolean {
  const family = isIP(address);
  // BlockList compares parsed addresses, including equivalent IPv6 spellings.
  if (family && metadataAddresses.check(address, family === 4 ? 'ipv4' : 'ipv6')) return false;
  if (family === 4) return privateAddresses.check(address, 'ipv4');
  // Mapped IPv4 is intentionally not accepted through an IPv6 spelling.
  return family === 6 && privateV6Addresses.check(address, 'ipv6');
}

export function normalizeLlamaCppBaseUrl(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > 512 ||
    /[\p{Cc}\p{Cf}]/u.test(value)
  )
    throw new LlamaCppError('ai_llamacpp_url_invalid', 400, 'Укажите адрес сервера llama.cpp.');
  const raw = value.trim();
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : 'http://' + raw);
  } catch {
    throw new LlamaCppError('ai_llamacpp_url_invalid', 400, 'Неверный адрес сервера llama.cpp.');
  }
  // URL.port removes explicit default ports: inspect the authority before normalization.
  const authority = raw.replace(/^[a-z][a-z\d+.-]*:\/\//i, '').split(/[/?#]/, 1)[0] ?? '';
  const explicitPort = /(?:\]|[^:]):(\d+)$/.exec(authority)?.[1];
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (
    (explicitPort !== undefined && Number(explicitPort) === 0) ||
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !['', '/', '/v1', '/v1/'].includes(url.pathname) ||
    !host ||
    host.endsWith('.') ||
    (!isIP(host) && !/^[a-z\d](?:[a-z\d.-]{0,251}[a-z\d])?$/i.test(host))
  )
    throw new LlamaCppError(
      'ai_llamacpp_url_denied',
      400,
      'Разрешён только локальный HTTP(S) адрес без дополнительных путей и параметров.',
    );
  if (isIP(host) && !llamaCppPrivateAddress(host))
    throw new LlamaCppError(
      'ai_llamacpp_url_denied',
      400,
      'Адрес не входит в разрешённые локальные сети.',
    );
  if (!explicitPort) url.port = '8080';
  url.pathname = '/';
  return explicitPort && !url.port
    ? url.protocol + '//' + url.hostname + ':' + Number(explicitPort)
    : url.origin;
}
export const llamacppBaseUrl = normalizeLlamaCppBaseUrl;

export function validLlamaCppModel(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 200 &&
    value === value.trim() &&
    !/[\p{Cc}\p{Cf}]/u.test(value) &&
    !value.includes('://')
  );
}

export function validLlamaCppKey(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 2048 &&
    /^[\x21-\x7e]+$/.test(value)
  );
}

interface Address {
  address: string;
  family: number;
}
async function abortable<T>(work: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return work;
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    work
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', abort))
      .catch(() => undefined);
    if (signal.aborted) abort();
  });
}
export interface LlamaCppFetchOptions {
  readonly resolve?: (hostname: string) => Promise<Address[]>;
  readonly allowedHosts?: readonly string[];
}

/** Resolve once, validate every answer, and pin the selected address to the socket. */
export function createLlamaCppFetch(options: LlamaCppFetchOptions = {}): typeof fetch {
  return async (input, init) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.hash ||
      !['/v1/models', '/props', '/v1/chat/completions'].includes(url.pathname)
    )
      throw new LlamaCppError('ai_llamacpp_url_denied', 400, 'Недопустимый маршрут llama.cpp.');
    const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    const allowed =
      options.allowedHosts ??
      (process.env['ASA_LLAMACPP_ALLOWED_HOSTS'] ?? '')
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
    if (allowed.length && !allowed.includes(hostname))
      throw new LlamaCppError(
        'ai_llamacpp_url_denied',
        400,
        'Сервер не входит в разрешённый список адресов.',
      );
    const signal = init?.signal ?? undefined;
    signal?.throwIfAborted();
    const addresses = isIP(hostname)
      ? [{ address: hostname, family: isIP(hostname) }]
      : await abortable(
          (options.resolve ?? ((host) => lookup(host, { all: true })))(hostname),
          signal,
        );
    signal?.throwIfAborted();
    if (
      !addresses.length ||
      addresses.length > 16 ||
      addresses.some((a) => !llamaCppPrivateAddress(a.address))
    )
      throw new LlamaCppError(
        'ai_llamacpp_url_denied',
        400,
        'Имя сервера должно разрешаться только в разрешённые локальные адреса.',
      );
    const address = addresses[0]!;
    const headers = new Headers(init?.headers);
    headers.set('accept-encoding', 'identity');
    // Never forward browser cookies or llama.cpp's persistent-stream header.
    headers.delete('cookie');
    headers.delete('x-conversation-id');
    if (init?.body !== undefined && init.body !== null && typeof init.body !== 'string')
      throw invalid();
    return new Promise<Response>((resolve, reject) => {
      const req = (url.protocol === 'https:' ? httpsRequest : httpRequest)(
        url,
        {
          method: init?.method ?? 'GET',
          agent: false,
          ...(signal ? { signal } : {}),
          headers: Object.fromEntries(headers),
          lookup: (_host, lookupOptions, callback) => {
            if (lookupOptions.all) callback(null, [address]);
            else callback(null, address.address, address.family);
          },
        },
        (res) => {
          const status = res.statusCode ?? 502;
          if (
            (status >= 300 && status < 400) ||
            (res.headers['content-encoding'] && res.headers['content-encoding'] !== 'identity')
          ) {
            res.destroy();
            reject(
              new LlamaCppError(
                'ai_llamacpp_url_denied',
                502,
                'Перенаправления и сжатые ответы llama.cpp не разрешены.',
              ),
            );
            return;
          }
          try {
            const responseHeaders = new Headers();
            if (res.headers['content-type'])
              responseHeaders.set('content-type', res.headers['content-type']);
            if (status === 204 || status === 205) {
              res.destroy();
              resolve(new Response(null, { status, headers: responseHeaders }));
            } else
              resolve(
                new Response(Readable.toWeb(res) as ReadableStream<Uint8Array>, {
                  status,
                  headers: responseHeaders,
                }),
              );
          } catch {
            res.destroy();
            reject(invalid());
          }
        },
      );
      req.on('error', reject);
      req.end(init?.body ?? undefined);
    });
  };
}
const pinnedFetch = createLlamaCppFetch();

function authHeaders(apiKey: string | undefined, stream = false): Record<string, string> {
  if (apiKey !== undefined && !validLlamaCppKey(apiKey))
    throw new LlamaCppError('ai_llamacpp_key_invalid', 400, 'Недопустимый API-ключ llama.cpp.');
  return {
    accept: stream ? 'text/event-stream' : 'application/json',
    'content-type': 'application/json',
    ...(apiKey ? { authorization: 'Bearer ' + apiKey } : {}),
  };
}
function httpFailure(status: number): LlamaCppError {
  if (status === 400)
    return new LlamaCppError(
      'ai_llamacpp_request_rejected',
      422,
      'llama.cpp не поддерживает параметры этого запроса.',
    );
  if (status === 401 || status === 403)
    return new LlamaCppError(
      'ai_llamacpp_auth',
      502,
      'llama.cpp отклонил API-ключ. Проверьте ключ подключения.',
    );
  if (status === 404)
    return new LlamaCppError(
      'ai_llamacpp_model_missing',
      503,
      'Модель или API llama.cpp не найдены.',
    );
  if (status === 429 || status === 503)
    return new LlamaCppError('ai_llamacpp_busy', 503, 'llama.cpp занят или загружает модель.');
  return new LlamaCppError('ai_llamacpp_upstream_error', 503, 'llama.cpp отклонил запрос.');
}
function transportFailure(error: unknown, timeout: AbortSignal): LlamaCppError {
  if (error instanceof LlamaCppError) return error;
  return new LlamaCppError(
    timeout.aborted ? 'ai_llamacpp_timeout' : 'ai_llamacpp_unreachable',
    timeout.aborted ? 504 : 503,
    timeout.aborted ? 'Время ожидания llama.cpp истекло.' : 'Нет связи с сервером llama.cpp.',
  );
}
async function limitedJson(response: Response, maxBytes = MAX_JSON): Promise<unknown> {
  if (!response.body) throw invalid();
  const reader = response.body.getReader();
  let length = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > maxBytes) throw invalid('Ответ llama.cpp превышает допустимый размер.');
      chunks.push(next.value);
    }
    const bytes = Buffer.concat(chunks, length);
    try {
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
    } catch {
      throw invalid();
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function contextCount(value: unknown): number | null {
  return typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value > 0 &&
    value <= MAX_CONTEXT
    ? value
    : null;
}

export interface LlamaCppModel {
  readonly id: string;
  readonly contextTokens: number | null;
  /** True only after a safe live tool probe; discovery alone never claims it. */
  readonly tools: boolean;
}
export interface LlamaCppDiscovery {
  readonly baseUrl: string;
  readonly models: readonly LlamaCppModel[];
}
export interface LlamaCppConnectionArgs {
  readonly baseUrl: string;
  readonly apiKey?: string | undefined;
  readonly signal?: AbortSignal | undefined;
  readonly fetchImpl?: typeof fetch | undefined;
}
export async function discoverLlamaCpp(args: LlamaCppConnectionArgs): Promise<LlamaCppDiscovery> {
  const baseUrl = normalizeLlamaCppBaseUrl(args.baseUrl);
  const timeout = AbortSignal.timeout(15000);
  const signal = args.signal ? AbortSignal.any([args.signal, timeout]) : timeout;
  const fetchImpl = args.fetchImpl ?? pinnedFetch;
  const headers = authHeaders(args.apiKey);
  try {
    const reply = await fetchImpl(baseUrl + '/v1/models', {
      method: 'GET',
      headers,
      signal,
      redirect: 'error',
    });
    if (!reply.ok) {
      await reply.body?.cancel();
      throw httpFailure(reply.status);
    }
    const data = object(await limitedJson(reply))?.data;
    if (!Array.isArray(data) || data.length > 128)
      throw invalid('Некорректный каталог моделей llama.cpp.');
    const models: LlamaCppModel[] = [];
    const seen = new Set<string>();
    for (const raw of data) {
      const item = object(raw);
      const id = item?.id;
      if (!validLlamaCppModel(id) || seen.has(id))
        throw invalid('Некорректный идентификатор в каталоге llama.cpp.');
      seen.add(id);
      let contextTokens = contextCount(object(item?.meta)?.n_ctx);
      try {
        const props = await fetchImpl(
          baseUrl + '/props?model=' + encodeURIComponent(id) + '&autoload=false',
          { method: 'GET', headers, signal, redirect: 'error' },
        );
        if (props.ok) {
          const settings = object(object(await limitedJson(props))?.default_generation_settings);
          contextTokens = contextCount(settings?.n_ctx) ?? contextTokens;
        } else {
          await props.body?.cancel();
          if (props.status === 401 || props.status === 403) throw httpFailure(props.status);
        }
      } catch (error) {
        if (
          signal.aborted ||
          (error instanceof LlamaCppError &&
            ['ai_llamacpp_auth', 'ai_llamacpp_url_denied'].includes(error.code))
        )
          throw error;
        // Optional metadata may be disabled, unavailable or not loaded in router mode.
      }
      models.push({ id, contextTokens, tools: false });
    }
    return { baseUrl, models };
  } catch (error) {
    if (args.signal?.aborted) throw args.signal.reason;
    throw transportFailure(error, timeout);
  }
}

/** One bounded process-local queue. The service also holds a database slot across replicas. */
export class LlamaCppQueue {
  private active = false;
  private readonly waiting: Array<() => void> = [];
  constructor(
    private readonly maxWaiting = 16,
    private readonly waitMs = 30000,
  ) {}
  get idle(): boolean {
    return !this.active && !this.waiting.length;
  }
  async acquire(signal: AbortSignal): Promise<() => void> {
    signal.throwIfAborted();
    if (!this.active) {
      this.active = true;
      return this.release();
    }
    if (this.waiting.length >= this.maxWaiting)
      throw new LlamaCppError(
        'ai_llamacpp_busy',
        503,
        'Очередь llama.cpp заполнена. Повторите позже.',
      );
    return new Promise((resolve, reject) => {
      const remove = () => {
        const i = this.waiting.indexOf(grant);
        if (i >= 0) this.waiting.splice(i, 1);
      };
      const cleanup = () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
      };
      const grant = () => {
        cleanup();
        resolve(this.release());
      };
      const abort = () => {
        remove();
        cleanup();
        reject(signal.reason);
      };
      const timer = setTimeout(() => {
        remove();
        cleanup();
        reject(
          new LlamaCppError(
            'ai_llamacpp_busy',
            503,
            'Время ожидания свободного слота llama.cpp истекло.',
          ),
        );
      }, this.waitMs);
      this.waiting.push(grant);
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
    });
  }
  private release(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.waiting.shift();
      if (next) next();
      else this.active = false;
    };
  }
}
const queues = new Map<string, LlamaCppQueue>();
function queue(origin: string): LlamaCppQueue {
  let existing = queues.get(origin);
  if (!existing) {
    existing = new LlamaCppQueue();
    queues.set(origin, existing);
  }
  return existing;
}

export interface LlamaCppStreamArgs extends LlamaCppConnectionArgs {
  readonly model: string;
  readonly context: readonly { role: 'user' | 'assistant'; content: string }[];
  readonly instructions: string;
  readonly signal: AbortSignal;
  readonly onDelta: (delta: string) => void;
  readonly onInferenceStart?: () => void;
  readonly onReasoningDelta?: ((delta: string) => void) | undefined;
  readonly tools?: readonly NativeToolDefinition[] | undefined;
  readonly toolResults?: readonly NativeToolResult[] | undefined;
  readonly temperature?: number | null | undefined;
  readonly topP?: number | null | undefined;
  readonly maxOutputTokens?: number | null | undefined;
  readonly contextTokens?: number | null | undefined;
}
export interface LlamaCppTextResult {
  readonly text: string;
  readonly stopped: boolean;
  readonly usage?: AiProviderUsage;
  readonly toolCalls?: readonly NativeToolCall[];
}
const callReplay = new WeakMap<NativeToolCall, { id: string; reasoning: string }>();

export function validLlamaCppGeneration(args: {
  temperature?: unknown;
  topP?: unknown;
  maxOutputTokens?: unknown;
  contextTokens?: unknown;
}): boolean {
  const { temperature, topP, maxOutputTokens, contextTokens } = args;
  return (
    (temperature == null ||
      (typeof temperature === 'number' &&
        Number.isFinite(temperature) &&
        temperature >= 0 &&
        temperature <= 2)) &&
    (topP == null ||
      (typeof topP === 'number' && Number.isFinite(topP) && topP > 0 && topP <= 1)) &&
    (maxOutputTokens == null || contextCount(maxOutputTokens) !== null) &&
    (contextTokens == null || contextCount(contextTokens) !== null) &&
    !(
      typeof maxOutputTokens === 'number' &&
      typeof contextTokens === 'number' &&
      maxOutputTokens > contextTokens
    )
  );
}
type TokenCountPath = '/v1/chat/completions/input_tokens' | '/apply-template' | '/tokenize';

async function postTokenCountRequest(
  args: LlamaCppStreamArgs,
  baseUrl: string,
  path: TokenCountPath,
  body: string,
  signal: AbortSignal,
): Promise<Response> {
  return (args.fetchImpl ?? pinnedFetch)(baseUrl + path, {
    method: 'POST',
    headers: authHeaders(args.apiKey),
    body,
    signal,
    redirect: 'error',
  });
}

async function tokenCountJson(response: Response, limit: number) {
  if (!response.ok) {
    await response.body?.cancel();
    return null;
  }
  return object(await limitedJson(response, limit));
}

async function requestBody(
  args: LlamaCppStreamArgs,
  stream: boolean,
  baseUrl: string,
  signal: AbortSignal,
): Promise<string> {
  if (!validLlamaCppModel(args.model))
    throw new LlamaCppError('ai_llamacpp_model_invalid', 400, 'Выберите модель llama.cpp.');
  if (!validLlamaCppGeneration(args))
    throw new LlamaCppError(
      'ai_llamacpp_config_invalid',
      400,
      'Некорректные параметры генерации llama.cpp.',
    );
  const output =
    args.maxOutputTokens ??
    Math.min(
      AI_MAX_OUTPUT_TOKENS,
      args.contextTokens != null
        ? Math.max(1, Math.floor(args.contextTokens / 4))
        : AI_MAX_OUTPUT_TOKENS,
    );
  const payload = {
    model: args.model,
    messages: [
      { role: 'system', content: args.instructions },
      ...args.context,
      ...(args.toolResults ?? []).flatMap((result, i) => {
        const replay = callReplay.get(result.call);
        const id = replay?.id ?? 'call_asa_llamacpp_' + i;
        return [
          {
            role: 'assistant',
            content: '',
            ...(replay?.reasoning ? { reasoning_content: replay.reasoning } : {}),
            tool_calls: [
              {
                id,
                type: 'function',
                function: {
                  name: result.call.name,
                  arguments: JSON.stringify(result.call.arguments),
                },
              },
            ],
          },
          { role: 'tool', tool_call_id: id, content: result.content },
        ];
      }),
    ],
    stream,
    ...(stream ? { stream_options: { include_usage: true } } : {}),
    max_tokens: output,
    ...(args.temperature != null ? { temperature: args.temperature } : {}),
    ...(args.topP != null ? { top_p: args.topP } : {}),
    ...(args.tools?.length ? { tools: args.tools, parallel_tool_calls: false } : {}),
  };
  const body = JSON.stringify(payload);
  const wireBytes = Buffer.byteLength(body, 'utf8');
  if (wireBytes > MAX_REQUEST)
    throw new LlamaCppError(
      'ai_llamacpp_context_invalid',
      400,
      'Запрос превышает допустимый размер контекста.',
    );
  const context = args.contextTokens;
  if (context == null) return body;
  // Wire bytes give older servers a conservative budget. Versions with a token
  // counter can measure the same messages, tools and template without inference.
  const wireBudget = context - Math.min(1024, Math.max(128, Math.floor(context / 16)));
  if (wireBytes + output <= wireBudget) return body;
  const counterSignal = AbortSignal.any([signal, AbortSignal.timeout(3500)]);
  let legacyCounter = false;
  const count = async (messages: typeof payload.messages) => {
    if (counterSignal.aborted) return null;
    try {
      const request = JSON.stringify({
        ...payload,
        messages,
        stream: false,
        stream_options: undefined,
      });
      const post = (path: TokenCountPath, body: string) =>
        postTokenCountRequest(args, baseUrl, path, body, counterSignal);
      if (!legacyCounter) {
        const response = await post('/v1/chat/completions/input_tokens', request);
        legacyCounter = [404, 405, 501].includes(response.status);
        const counter = await tokenCountJson(response, 2048);
        if (!legacyCounter) {
          const input = counter?.input_tokens;
          return typeof input === 'number' && Number.isSafeInteger(input) && input > 0
            ? input
            : null;
        }
      }
      const rendered = await tokenCountJson(await post('/apply-template', request), MAX_JSON);
      if (typeof rendered?.prompt !== 'string' || !rendered.prompt) return null;
      const tokens = await tokenCountJson(
        await post(
          '/tokenize',
          JSON.stringify({
            model: args.model,
            content: rendered.prompt,
            add_special: true,
            parse_special: true,
          }),
        ),
        MAX_JSON,
      );
      return Array.isArray(tokens?.tokens) &&
        tokens.tokens.length > 0 &&
        tokens.tokens.every((token) => Number.isSafeInteger(token) && token >= 0)
        ? tokens.tokens.length
        : null;
    } catch {
      signal.throwIfAborted();
      return null;
    }
  };
  const minOutput = Math.min(output, 128);
  const inputTokens = await count(payload.messages);
  const tokenBudget = context - 32;
  const maxReply = inputTokens === null ? wireBudget - wireBytes : tokenBudget - inputTokens;
  if (maxReply >= minOutput)
    return JSON.stringify({ ...payload, max_tokens: Math.min(output, maxReply) });

  // Keep the system message, the latest user turn, and all tool call/result pairs.
  // Earlier turns can be removed whole, starting with the oldest one.
  const turnStarts = args.context.flatMap((message, i) =>
    i > 0 && message.role === 'user' ? [i + 1] : [],
  );
  let low = 0;
  let high = turnStarts.length - 1;
  let fitted: string | undefined;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const messages = [payload.messages[0]!, ...payload.messages.slice(turnStarts[middle]!)];
    const candidate = JSON.stringify({ ...payload, messages });
    let available = wireBudget - Buffer.byteLength(candidate, 'utf8');
    if (available < output && inputTokens !== null) {
      const tokens = await count(messages);
      if (tokens !== null) available = tokenBudget - tokens;
    }
    if (available >= minOutput) {
      fitted = JSON.stringify({ ...payload, messages, max_tokens: Math.min(output, available) });
      high = middle - 1;
    } else {
      low = middle + 1;
    }
  }
  if (fitted !== undefined) return fitted;
  throw new LlamaCppError(
    'ai_llamacpp_context_exceeded',
    400,
    'Сообщения и инструменты превышают безопасный лимит контекста llama.cpp.',
  );
}
function reportedUsage(payload: Record<string, unknown>): AiProviderUsage | undefined {
  const raw = object(payload.usage);
  const inputTokens = providerTokenCount(raw?.prompt_tokens);
  const outputTokens = providerTokenCount(raw?.completion_tokens);
  const actualModel = providerModel(payload.model);
  return inputTokens !== null || outputTokens !== null || actualModel !== null
    ? { inputTokens, outputTokens, actualModel }
    : undefined;
}
function providerError(payload: Record<string, unknown>): LlamaCppError | null {
  if (!payload.error) return null;
  const error = object(payload.error);
  return error?.type === 'exceed_context_size_error'
    ? new LlamaCppError(
        'ai_llamacpp_context_exceeded',
        400,
        'Запрос превышает рабочий контекст llama.cpp. Сократите историю или измените лимит.',
      )
    : new LlamaCppError('ai_llamacpp_upstream_error', 503, 'llama.cpp прервал генерацию.');
}
interface PartialCall {
  id: string;
  name: string;
  arguments: string;
}
function parsedCalls(
  calls: Map<number, PartialCall>,
  tools: readonly NativeToolDefinition[],
  reasoning: string,
): readonly NativeToolCall[] {
  try {
    const ordered = [...calls].sort(([a], [b]) => a - b);
    if (ordered.some(([index], i) => index !== i)) throw invalid();
    const parsed = parseNativeToolBatch(
      ordered.map(([, call]) => ({
        function: { name: call.name, arguments: JSON.parse(call.arguments) as unknown },
      })),
      tools,
    );
    for (const [i, call] of parsed.entries())
      callReplay.set(call, { id: ordered[i]![1].id || 'call_asa_llamacpp_' + i, reasoning });
    return parsed;
  } catch {
    throw new LlamaCppError(
      'ai_tool_call_invalid',
      503,
      'llama.cpp вернул некорректный вызов инструмента.',
    );
  }
}
export function parseLlamaCppText(
  payload: unknown,
  tools: readonly NativeToolDefinition[] = [],
): LlamaCppTextResult {
  const packet = object(payload);
  if (!packet) throw invalid();
  const failure = providerError(packet);
  if (failure) throw failure;
  const choices = packet.choices;
  const choice = Array.isArray(choices) && choices.length === 1 ? object(choices[0]) : null;
  const message = object(choice?.message);
  if (
    !choice ||
    !message ||
    !['stop', 'length', 'tool_calls'].includes(String(choice.finish_reason))
  )
    throw invalid();
  const content = typeof message.content === 'string' ? message.content : '';
  const text = content.slice(0, AI_MAX_ANSWER_CHARS);
  const usage = reportedUsage(packet);
  let toolCalls: readonly NativeToolCall[] | undefined;
  if (choice.finish_reason === 'tool_calls') {
    if (
      !Array.isArray(message.tool_calls) ||
      !message.tool_calls.length ||
      message.tool_calls.length > 4
    )
      throw invalid();
    const calls = new Map<number, PartialCall>();
    for (const [index, raw] of message.tool_calls.entries()) {
      const call = object(raw);
      const fn = object(call?.function);
      if (
        typeof fn?.name !== 'string' ||
        typeof fn.arguments !== 'string' ||
        fn.arguments.length > MAX_FRAME
      )
        throw invalid();
      calls.set(index, {
        id: typeof call?.id === 'string' ? call.id : '',
        name: fn.name,
        arguments: fn.arguments,
      });
    }
    toolCalls = parsedCalls(
      calls,
      tools,
      typeof message.reasoning_content === 'string'
        ? message.reasoning_content.slice(0, MAX_FRAME)
        : '',
    );
  }
  if (!text.trim() && !toolCalls?.length && choice.finish_reason !== 'length')
    throw new LlamaCppError(
      'ai_llamacpp_response_empty',
      503,
      'llama.cpp не вернул текст ответа.',
      '',
      usage,
    );
  return {
    text,
    stopped: choice.finish_reason === 'length' || content.length > AI_MAX_ANSWER_CHARS,
    ...(usage ? { usage } : {}),
    ...(toolCalls ? { toolCalls } : {}),
  };
}

async function completion(args: LlamaCppStreamArgs, stream: boolean): Promise<LlamaCppTextResult> {
  const baseUrl = normalizeLlamaCppBaseUrl(args.baseUrl);
  if (args.signal.aborted) return { text: '', stopped: true };
  const timeout = AbortSignal.timeout(GENERATION_TIMEOUT);
  const signal = AbortSignal.any([args.signal, timeout]);
  let release: (() => void) | undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let text = '';
  let usage: AiProviderUsage | undefined;
  try {
    const localQueue = queue(baseUrl);
    const unlock = await localQueue.acquire(signal);
    release = () => {
      unlock();
      if (localQueue.idle && queues.get(baseUrl) === localQueue) queues.delete(baseUrl);
    };
    const body = await requestBody(args, stream, baseUrl, signal);
    signal.throwIfAborted();
    args.onInferenceStart?.();
    const response = await (args.fetchImpl ?? pinnedFetch)(baseUrl + '/v1/chat/completions', {
      method: 'POST',
      headers: authHeaders(args.apiKey, stream),
      body,
      signal,
      redirect: 'error',
    });
    if (!response.ok) {
      if (response.status === 400) {
        let data: unknown;
        try {
          data = await limitedJson(response, 16384);
        } catch {
          data = null;
        }
        const contextError = object(data) && providerError(object(data)!);
        if (contextError?.code === 'ai_llamacpp_context_exceeded') throw contextError;
      } else await response.body?.cancel();
      throw httpFailure(response.status);
    }
    if (!stream) return parseLlamaCppText(await limitedJson(response), args.tools);
    if (!response.body) throw invalid();
    reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let buffer = '';
    let done = false;
    let finish: string | null = null;
    let reasoning = '';
    const calls = new Map<number, PartialCall>();
    const handle = (raw: string) => {
      const data = raw
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n');
      if (!data) return;
      if (done) throw invalid();
      if (data === '[DONE]') {
        done = true;
        return;
      }
      let packet: Record<string, unknown> | null;
      try {
        packet = object(JSON.parse(data) as unknown);
      } catch {
        throw invalid();
      }
      if (!packet) throw invalid();
      const failure = providerError(packet);
      if (failure) throw failure;
      usage = mergeProviderUsage(usage, reportedUsage(packet));
      if (!Array.isArray(packet.choices) || packet.choices.length > 1) throw invalid();
      if (!packet.choices.length) return; // final provider-reported usage frame
      const choice = object(packet.choices[0]);
      if (!choice || (choice.index !== undefined && choice.index !== 0)) throw invalid();
      const delta = object(choice.delta);
      if (!delta) throw invalid();
      if (finish !== null && (delta.content || delta.reasoning_content || delta.tool_calls))
        throw invalid();
      if (delta.content != null && typeof delta.content !== 'string') throw invalid();
      if (typeof delta.content === 'string') {
        const next = delta.content.slice(0, AI_MAX_ANSWER_CHARS - text.length);
        text += next;
        if (next) args.onDelta(next);
      }
      if (delta.reasoning_content != null && typeof delta.reasoning_content !== 'string')
        throw invalid();
      if (typeof delta.reasoning_content === 'string') {
        reasoning += delta.reasoning_content;
        if (reasoning.length > MAX_FRAME)
          throw invalid('Размышление llama.cpp превышает допустимый размер.');
        args.onReasoningDelta?.(delta.reasoning_content);
      }
      if (delta.tool_calls !== undefined) {
        if (!Array.isArray(delta.tool_calls) || !args.tools?.length)
          throw new LlamaCppError(
            'ai_tool_call_invalid',
            503,
            'Неожиданный вызов инструмента llama.cpp.',
          );
        for (const rawCall of delta.tool_calls) {
          const call = object(rawCall);
          const fn = object(call?.function);
          const index = call?.index;
          if (
            typeof index !== 'number' ||
            !Number.isInteger(index) ||
            index < 0 ||
            index > 3 ||
            !fn
          )
            throw invalid();
          const previous = calls.get(index) ?? { id: '', name: '', arguments: '' };
          if (
            (fn.name != null && typeof fn.name !== 'string') ||
            (fn.arguments != null && typeof fn.arguments !== 'string') ||
            (call?.id != null && typeof call.id !== 'string')
          )
            throw invalid();
          const id = typeof call?.id === 'string' ? call.id : previous.id;
          if (previous.id && id !== previous.id) throw invalid();
          const next = {
            id,
            name: previous.name + (fn.name ?? ''),
            arguments: previous.arguments + (fn.arguments ?? ''),
          };
          if (next.id.length > 200 || next.name.length > 80 || next.arguments.length > MAX_FRAME)
            throw invalid();
          calls.set(index, next);
        }
      }
      if (choice.finish_reason != null) {
        if (
          finish !== null ||
          !['stop', 'length', 'tool_calls'].includes(String(choice.finish_reason))
        )
          throw invalid();
        finish = String(choice.finish_reason);
      }
    };
    while (!done && !signal.aborted && text.length < AI_MAX_ANSWER_CHARS) {
      const next = await reader.read();
      if (next.done) {
        buffer += decoder.decode();
        break;
      }
      buffer += decoder.decode(next.value, { stream: true });
      let boundary = /\r?\n\r?\n/.exec(buffer);
      while (boundary) {
        if (boundary.index > MAX_FRAME) throw invalid();
        handle(buffer.slice(0, boundary.index));
        buffer = buffer.slice(boundary.index + boundary[0].length);
        if (done) break;
        boundary = /\r?\n\r?\n/.exec(buffer);
      }
      if (buffer.length > MAX_FRAME) throw invalid();
    }
    if (args.signal.aborted) return { text, stopped: true, ...(usage ? { usage } : {}) };
    if (timeout.aborted) throw transportFailure(null, timeout);
    if (text.length >= AI_MAX_ANSWER_CHARS)
      return { text, stopped: true, ...(usage ? { usage } : {}) };
    if (!done || !finish)
      throw new LlamaCppError(
        'ai_llamacpp_interrupted',
        503,
        'Соединение закрыто до завершения ответа llama.cpp.',
      );
    if (calls.size && finish !== 'tool_calls' && finish !== 'length')
      throw new LlamaCppError(
        'ai_tool_call_invalid',
        503,
        'llama.cpp не завершил вызов инструмента.',
      );
    const toolCalls =
      finish === 'tool_calls' ? parsedCalls(calls, args.tools ?? [], reasoning) : undefined;
    if (!text.trim() && !toolCalls?.length && finish !== 'length')
      throw new LlamaCppError(
        'ai_llamacpp_response_empty',
        503,
        'llama.cpp не вернул текст ответа.',
      );
    return {
      text,
      stopped: finish === 'length',
      ...(usage ? { usage } : {}),
      ...(toolCalls ? { toolCalls } : {}),
    };
  } catch (error) {
    if (args.signal.aborted) return { text, stopped: true, ...(usage ? { usage } : {}) };
    const failure =
      reader && !timeout.aborted && !(error instanceof LlamaCppError)
        ? new LlamaCppError('ai_llamacpp_interrupted', 503, 'Поток llama.cpp был прерван.')
        : transportFailure(error, timeout);
    throw new LlamaCppError(
      failure.code,
      failure.status,
      failure.message,
      text || failure.partialText,
      usage ?? failure.usage,
    );
  } finally {
    if (reader) {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
    release?.();
  }
}

export const streamLlamaCppText = (args: LlamaCppStreamArgs): Promise<LlamaCppTextResult> =>
  completion(args, true);
export const generateLlamaCppText = (args: LlamaCppStreamArgs): Promise<LlamaCppTextResult> =>
  completion(args, false);
