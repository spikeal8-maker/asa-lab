import type pg from 'pg';
import type { AiImageRecipe } from '@asa-lab/contracts';
import { ollamaBaseUrl } from './ai-ollama.js';
import { ComfyUiError, discoverComfyUi } from './ai-comfyui.js';
import { ComfyImageTransport } from './ai-image-comfyui.js';

export function comfyUiOrigin(value: unknown): string {
  try {
    return ollamaBaseUrl(value);
  } catch {
    throw new ComfyUiError(
      'ai_comfy_url_invalid',
      400,
      'Укажите частный IP-адрес ComfyUI и порт, например http://192.168.1.20:8188.',
    );
  }
}
export async function comfyUiRuntimeOrigin(
  pool: pg.Pool,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const result = await pool.query<{ value: string | null }>('SELECT ai_comfyui_runtime() AS value');
  return comfyUiOrigin(
    result.rows[0]?.value ?? env['ASA_COMFYUI_BASE_URL'] ?? 'http://host.docker.internal:8188',
  );
}
export class ComfyUiSettings {
  constructor(
    private readonly pool: pg.Pool,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}
  async config(actor: string) {
    const row = (
      await this.pool.query<{ value: { configurationVersion: number; baseUrl: string | null } }>(
        'SELECT ai_comfyui_config($1) AS value',
        [actor],
      )
    ).rows[0]!.value;
    return {
      ...row,
      baseUrl: comfyUiOrigin(
        row.baseUrl ?? process.env['ASA_COMFYUI_BASE_URL'] ?? 'http://host.docker.internal:8188',
      ),
      source: row.baseUrl ? ('saved' as const) : ('environment' as const),
    };
  }
  async probe(actor: string, raw: unknown) {
    await this.config(actor);
    const baseUrl = comfyUiOrigin(raw);
    // The endpoint and the actual saved image recipe are separate settings.
    // Never report the legacy FP4 recipe as the readiness of a saved FP8 profile.
    const selected = await this.pool.query<{ value: { recipe: AiImageRecipe } }>(
      'SELECT ai_image_config() AS value',
    );
    const recipe = selected.rows[0]?.value?.recipe;
    if (recipe !== 'flux2-klein-4b-v1' && recipe !== 'flux2-klein-4b-fp8-izo-v1')
      throw new ComfyUiError(
        'ai_comfy_recipe_unknown',
        503,
        'Не удалось проверить выбранный профиль генерации.',
      );
    const status = await discoverComfyUi(baseUrl, this.fetchImpl);
    const readiness = await new ComfyImageTransport({
      baseUrl,
      fetchImpl: this.fetchImpl,
    }).readiness(recipe);
    return { ...status, recipe, recipeReady: readiness.ready, recipeReason: readiness.reason };
  }
  async status(actor: string) {
    const c = await this.config(actor);
    return this.probe(actor, c.baseUrl);
  }
  async save(actor: string, raw: unknown) {
    const p = raw as {
      configurationVersion?: unknown;
      baseUrl?: unknown;
      requestId?: unknown;
    } | null;
    if (
      !p ||
      !Number.isSafeInteger(p.configurationVersion) ||
      Number(p.configurationVersion) < 1 ||
      typeof p.requestId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        p.requestId,
      )
    )
      throw new ComfyUiError(
        'ai_comfy_config_invalid',
        400,
        'Нужны адрес и актуальная версия настроек.',
      );
    const baseUrl = comfyUiOrigin(p.baseUrl);
    const status = await this.probe(actor, baseUrl); // GET-only; saving never starts a generation.
    try {
      await this.pool.query('SELECT ai_comfyui_config_set($1,$2,$3::varchar,$4::uuid)', [
        actor,
        p.configurationVersion,
        baseUrl,
        p.requestId,
      ]);
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === '40001')
        throw new ComfyUiError(
          'ai_comfy_config_changed',
          409,
          'Настройки изменились. Обновите вкладку.',
        );
      if (code === '55000')
        throw new ComfyUiError(
          'ai_comfy_jobs_active',
          409,
          'Дождитесь завершения и подтверждения всех заданий изображений перед сменой сервера.',
        );
      if (code === '22023' || code === '22P02')
        throw new ComfyUiError('ai_comfy_url_invalid', 400, 'Адрес ComfyUI не разрешён.');
      throw e;
    }
    return { config: await this.config(actor), status };
  }
}
