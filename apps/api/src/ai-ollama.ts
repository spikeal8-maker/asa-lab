/** Private LAN-only Ollama transport. Never called from the browser.
 * Donor behavior: IZO_ASA backend/app/integrations/ollama.py.
 * The supplied host is a literal RFC1918/loopback/Tailscale IPv4 address,
 * or an origin explicitly trusted by the server operator for Docker DNS.
 */
import { ProviderStreamError, type ProviderStreamResult } from './ai-provider-stream.js';

const MAX_RESULT_CHARS = 8192;
const MAX_LINE_CHARS = 65536;

export interface OllamaModel {
  readonly name: string;
  readonly size: number;
}

export function ollamaOrigin(value: unknown, trusted = process.env['ASA_AI_OLLAMA_TRUSTED_ORIGINS'] ?? ''): string {
  if (typeof value !== 'string' || value.length > 160 || value.trim() !== value) {
    throw new ProviderStreamError('ai_ollama_address_invalid', 400, 'Укажите адрес Ollama в локальной сети.');
  }
  // Trusted DNS aliases are configured only by the server operator, never by a browser.
  const approved = trusted.split(',').map((entry) => entry.trim()).filter(Boolean);
  if (approved.includes(value)) {
    const parsed = new URL(value);
    if (parsed.protocol === 'http:' && parsed.port === '11434' &&
        !parsed.username && !parsed.password && parsed.pathname === '/' &&
        !parsed.search && !parsed.hash) return parsed.origin;
  }
  const literal = /^http:\/\/([0-9]{1,3}(?:\.[0-9]{1,3}){3}):11434\/?$/.exec(value);
  if (!literal) {
    throw new ProviderStreamError(
      'ai_ollama_address_invalid', 400,
      'Разрешён только HTTP-адрес IPv4 локальной сети с портом 11434.',
    );
  }
  const parts = literal[1]!.split('.').map(Number);
  if (parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255) ||
      literal[1]!.split('.').some((part) => String(Number(part)) !== part)) {
    throw new ProviderStreamError('ai_ollama_address_invalid', 400, 'Некорректный IPv4-адрес.');
  }
  const [a, b] = parts;
  const privateAddress =
    a === 10 || a === 127 || (a === 172 && b! >= 16 && b! <= 31) ||
    (a === 192 && b === 168) || (a === 100 && b! >= 64 && b! <= 127);
  if (!privateAddress) {
    throw new ProviderStreamError(
      'ai_ollama_address_denied', 403,
      'Ollama доступна только по разрешённым частным адресам, без публичного Интернета.',
    );
  }
  return 'http://' + literal[1] + ':11434';
}

async function boundedText(response: Response, maxBytes: number): Promise<string> {
  const length = Number(response.headers.get('content-length'));
  if (Number.isFinite(length) && length > maxBytes) {
    throw new ProviderStreamError('ai_ollama_invalid_response', 503, 'Ответ Ollama слишком большой.');
  }
  if (!response.body) {
    throw new ProviderStreamError('ai_ollama_invalid_response', 503, 'Ollama не вернула ответ.');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = '';
  try {
    for (;;) {
      const item = await reader.read();
      if (item.done) break;
      size += item.value.byteLength;
      if (size > maxBytes) {
        throw new ProviderStreamError('ai_ollama_invalid_response', 503, 'Ответ Ollama слишком большой.');
      }
      text += decoder.decode(item.value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export async function discoverOllamaModels(fetchImpl: typeof fetch, address: string): Promise<OllamaModel[]> {
  const origin = ollamaOrigin(address);
  let response: Response;
  try {
    response = await fetchImpl(origin + '/api/tags', {
      method: 'GET',
      redirect: 'error',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(6000),
    });
  } catch {
    throw new ProviderStreamError('ai_ollama_unreachable', 503, 'Сервер Ollama не отвечает.');
  }
  if (!response.ok) {
    throw new ProviderStreamError('ai_ollama_unreachable', 503, 'Ollama недоступна для проверки моделей.');
  }
  let payload: unknown;
  try {
    payload = JSON.parse(await boundedText(response, 131072)) as unknown;
  } catch (problem) {
    if (problem instanceof ProviderStreamError) throw problem;
    throw new ProviderStreamError('ai_ollama_invalid_response', 503, 'Некорректный каталог Ollama.');
  }
  const rows = (payload as { models?: unknown })?.models;
  if (!Array.isArray(rows)) {
    throw new ProviderStreamError('ai_ollama_invalid_response', 503, 'Ollama не вернула список моделей.');
  }
  return rows.slice(0, 128).flatMap((row: unknown) => {
    if (!row || typeof row !== 'object') return [];
    const model = row as { name?: unknown; size?: unknown };
    return typeof model.name === 'string' && /^[\w./:-]{1,128}$/.test(model.name)
      ? [{ name: model.name, size: typeof model.size === 'number' ? model.size : 0 }]
      : [];
  });
}

export async function generateOllamaText(args: {
  fetchImpl: typeof fetch;
  address: string;
  model: string;
  context: readonly { role: 'user' | 'assistant'; content: string }[];
  instructions: string;
  signal: AbortSignal;
  onDelta: (delta: string) => void;
  stream: boolean;
}): Promise<ProviderStreamResult> {
  const { fetchImpl, model, context, instructions, signal, onDelta, stream } = args;
  const origin = ollamaOrigin(args.address);
  if (!/^[\w./:-]{1,128}$/.test(model)) {
    throw new ProviderStreamError('ai_ollama_model_invalid', 400, 'Некорректная модель Ollama.');
  }
  if (signal.aborted) return { text: '', stopped: true };
  const timeout = AbortSignal.timeout(65000);
  const combined = AbortSignal.any([signal, timeout]);
  let response: Response;
  try {
    response = await fetchImpl(origin + '/api/chat', {
      method: 'POST',
      redirect: 'error',
      headers: { 'content-type': 'application/json', accept: stream ? 'application/x-ndjson' : 'application/json' },
      body: JSON.stringify({
        model,
        stream,
        messages: [{ role: 'system', content: instructions }, ...context],
        options: { num_predict: 1600 },
        keep_alive: '5m',
      }),
      signal: combined,
    });
  } catch {
    if (signal.aborted) return { text: '', stopped: true };
    throw new ProviderStreamError(
      timeout.aborted ? 'ai_ollama_timeout' : 'ai_ollama_unreachable',
      timeout.aborted ? 504 : 503,
      timeout.aborted ? 'Ollama превысила время ожидания.' : 'Нет соединения с Ollama.',
    );
  }
  if (!response.ok) {
    throw new ProviderStreamError(
      response.status === 404 ? 'ai_ollama_model_missing' : 'ai_ollama_unreachable',
      503, response.status === 404 ? 'Модель Ollama не установлена.' : 'Ollama отклонила запрос.',
    );
  }
  if (!stream) {
    let packet: { done?: unknown; message?: { content?: unknown } };
    try {
      packet = JSON.parse(await boundedText(response, 131072)) as typeof packet;
    } catch (problem) {
      if (problem instanceof ProviderStreamError) throw problem;
      throw new ProviderStreamError('ai_ollama_invalid_response', 503, 'Некорректный ответ Ollama.');
    }
    if (packet?.done !== true || typeof packet.message?.content !== 'string' ||
        !packet.message.content.trim()) {
      throw new ProviderStreamError('ai_ollama_incomplete', 503, 'Ollama не завершила ответ.');
    }
    return { text: packet.message.content.slice(0, MAX_RESULT_CHARS), stopped: false };
  }
  if (!response.body) {
    throw new ProviderStreamError('ai_ollama_invalid_response', 503, 'Ollama не вернула поток.');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  let content = '';
  let finished = false;
  let capped = false;
  function receive(line: string): void {
    if (!line.trim()) return;
    let packet: { done?: unknown; message?: { content?: unknown }; error?: unknown; done_reason?: unknown };
    try {
      packet = JSON.parse(line) as typeof packet;
    } catch {
      throw new ProviderStreamError('ai_ollama_invalid_response', 503, 'Повреждён поток Ollama.');
    }
    if (packet.error) {
      throw new ProviderStreamError('ai_ollama_unreachable', 503, 'Ollama прервала выполнение.');
    }
    if (packet.message?.content !== undefined && typeof packet.message.content !== 'string') {
      throw new ProviderStreamError('ai_ollama_invalid_response', 503, 'Некорректный фрагмент Ollama.');
    }
    const delta = packet.message?.content ?? '';
    const available = MAX_RESULT_CHARS - content.length;
    if (delta && available > 0) {
      const piece = delta.slice(0, available);
      content += piece;
      onDelta(piece);
      if (piece.length < delta.length) capped = true;
    }
    if (packet.done === true) {
      finished = true;
      if (packet.done_reason === 'length') capped = true;
    }
  }
  try {
    while (!combined.aborted && !finished && !capped && content.length < MAX_RESULT_CHARS) {
      const item = await reader.read();
      if (item.done) break;
      pending += decoder.decode(item.value, { stream: true });
      if (pending.length > MAX_LINE_CHARS) {
        throw new ProviderStreamError('ai_ollama_invalid_response', 503, 'Слишком большой фрагмент Ollama.');
      }
      let index = pending.indexOf('\n');
      while (index >= 0) {
        const line = pending.slice(0, index).replace(/\r$/, '');
        pending = pending.slice(index + 1);
        receive(line);
        if (finished || capped) break;
        index = pending.indexOf('\n');
      }
    }
  } catch (problem) {
    if (signal.aborted) return { text: content, stopped: true };
    if (problem instanceof ProviderStreamError) {
      throw new ProviderStreamError(problem.code, problem.status, problem.message, content);
    }
    throw new ProviderStreamError(
      timeout.aborted ? 'ai_ollama_timeout' : 'ai_ollama_incomplete',
      timeout.aborted ? 504 : 503,
      timeout.aborted ? 'Ollama превысила время ожидания.' : 'Поток Ollama прервался.',
      content,
    );
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  if (timeout.aborted && !signal.aborted) {
    throw new ProviderStreamError('ai_ollama_timeout', 504, 'Ollama превысила время ожидания.', content);
  }
  if (!signal.aborted && !finished && !capped) {
    throw new ProviderStreamError('ai_ollama_incomplete', 503, 'Ollama не завершила поток.', content);
  }
  if (!content.trim() && !signal.aborted) {
    throw new ProviderStreamError('ai_ollama_empty', 503, 'Ollama вернула пустой ответ.');
  }
  return { text: content, stopped: signal.aborted || capped || content.length >= MAX_RESULT_CHARS };
}
