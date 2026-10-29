/** Administrative, read-only detection of a private ComfyUI instance.
 * Never accepts an arbitrary browser URL or triggers workflow execution.
 */
import { ollamaBaseUrl } from './ai-ollama.js';

export interface ComfyUiStatus {
  readonly connected: true;
  readonly baseUrl: string;
  readonly version: string;
  readonly diffusionModels: readonly string[];
  readonly textEncoders: readonly string[];
  readonly vaeModels: readonly string[];
  readonly fluxKlein4bFound: boolean;
  readonly checkedAt: string;
  readonly devices: readonly { name: string; vramTotalBytes: number | null }[];
}

export class ComfyUiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ComfyUiError';
  }
}

async function privateJson(
  url: string,
  fetchImpl: typeof fetch,
  signal: AbortSignal,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      redirect: 'error',
      signal,
      headers: { accept: 'application/json' },
    });
  } catch {
    throw new ComfyUiError('ai_comfy_unreachable', 503, 'Нет соединения с ComfyUI.');
  }
  if (!response.ok || response.redirected) {
    throw new ComfyUiError(
      'ai_comfy_unavailable',
      503,
      'Адрес не подтвердил ComfyUI. Проверьте порт: 11434 обычно используется Ollama, ComfyUI — 8188.',
    );
  }
  if (!response.body) throw new ComfyUiError('ai_comfy_invalid', 503, 'Ответ ComfyUI пустой.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      length += item.value.length;
      if (length > 96 * 1024)
        throw new ComfyUiError('ai_comfy_invalid', 503, 'Каталог ComfyUI слишком большой.');
      chunks.push(item.value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const part of chunks) {
      bytes.set(part, offset);
      offset += part.length;
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
  } catch (error) {
    if (error instanceof ComfyUiError) throw error;
    throw new ComfyUiError('ai_comfy_invalid', 503, 'Неверный ответ ComfyUI.');
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

function modelNames(payload: unknown): readonly string[] {
  if (!Array.isArray(payload) || payload.length > 200) {
    throw new ComfyUiError('ai_comfy_invalid', 503, 'Неверный список моделей ComfyUI.');
  }
  return payload.filter(
    (name): name is string =>
      typeof name === 'string' &&
      name.length > 0 &&
      name.length <= 255 &&
      !Array.from(name).some((character) => character.charCodeAt(0) < 32),
  );
}

export async function discoverComfyUi(
  baseUrl = process.env['ASA_COMFYUI_BASE_URL'] ?? 'http://host.docker.internal:8188',
  fetchImpl: typeof fetch = fetch,
): Promise<ComfyUiStatus> {
  let origin: string;
  try {
    origin = ollamaBaseUrl(baseUrl);
  } catch {
    throw new ComfyUiError('ai_comfy_url_invalid', 503, 'Адрес ComfyUI не разрешён.');
  }
  const signal = AbortSignal.timeout(7000);
  const [systemInfo, diffusion, text, vae] = await Promise.all([
    privateJson(origin + '/system_stats', fetchImpl, signal),
    privateJson(origin + '/models/diffusion_models', fetchImpl, signal),
    privateJson(origin + '/models/text_encoders', fetchImpl, signal),
    privateJson(origin + '/models/vae', fetchImpl, signal),
  ]);
  const system =
    systemInfo && typeof systemInfo === 'object'
      ? (systemInfo as { system?: { comfyui_version?: unknown } }).system
      : undefined;
  const version =
    typeof system?.comfyui_version === 'string' && system.comfyui_version.length <= 40
      ? system.comfyui_version
      : 'неизвестна';
  if (version === 'неизвестна')
    throw new ComfyUiError(
      'ai_comfy_invalid',
      503,
      'Адрес не подтвердил ComfyUI: версия сервера отсутствует.',
    );
  const rawDevices = (systemInfo as { devices?: unknown }).devices;
  const devices = Array.isArray(rawDevices)
    ? rawDevices
        .slice(0, 8)
        .filter((v) => v && typeof v.name === 'string' && v.name.length <= 160)
        .map((v) => ({
          name: v.name as string,
          vramTotalBytes:
            typeof v.vram_total === 'number' && Number.isFinite(v.vram_total) && v.vram_total > 0
              ? v.vram_total
              : null,
        }))
    : [];
  const diffusionModels = modelNames(diffusion);
  const textEncoders = modelNames(text);
  const vaeModels = modelNames(vae);
  const fluxKlein4bFound =
    diffusionModels.some((v) => /^flux-2-klein-4b-/i.test(v)) &&
    textEncoders.some((v) => /qwen_3_4b/i.test(v)) &&
    vaeModels.some((v) => /flux2[-_]vae/i.test(v));
  return {
    connected: true,
    baseUrl: origin,
    version,
    diffusionModels,
    textEncoders,
    vaeModels,
    fluxKlein4bFound,
    checkedAt: new Date().toISOString(),
    devices,
  };
}
