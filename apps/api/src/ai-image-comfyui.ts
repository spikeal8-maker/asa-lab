import {
  AI_IMAGE_PRESETS,
  aiImageDimensions,
  isAiImageSize,
  type AiImageRecipe,
  type AiImageStoredSize,
} from '@asa-lab/contracts';
import { createHash } from 'node:crypto';
import { ollamaBaseUrl } from './ai-ollama.js';
import { validateAiAttachment } from './ai-attachments/validation.js';

type Size = AiImageStoredSize;
type JsonObject = Record<string, unknown>;
export type ComfyImageRecovery = {
  state: 'pending' | 'running' | 'missing' | 'failed' | 'complete';
  png?: Buffer;
};
const RECIPE: AiImageRecipe = 'flux2-klein-4b-v1';
const MODELS = {
  unet: 'flux-2-klein-4b-fp8.safetensors',
  clip: 'qwen_3_4b_fp4_flux2.safetensors',
  vae: 'flux2-vae.safetensors',
};
export class ComfyTransportError extends Error {
  constructor(
    readonly code: string,
    readonly uncertain = false,
  ) {
    super(code);
    this.name = 'ComfyTransportError';
  }
}
function invalid(): never {
  throw new ComfyTransportError('ai_image_provider_invalid');
}
function object(value: unknown): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  return value as JsonObject;
}
function identity(id: string, marker: string, size: Size): void {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id) ||
    marker !== 'ASA_' + id.replaceAll('-', '') ||
    !(size === 512 || isAiImageSize(size))
  )
    invalid();
}
function graph(
  prompt: string,
  size: Size,
  seed: number,
  marker: string,
  recipe: AiImageRecipe = RECIPE,
): JsonObject {
  if (recipe !== RECIPE && recipe !== 'flux2-klein-4b-fp8-izo-v1') invalid();
  const dimensions = aiImageDimensions(size);
  // Versioned adaptation of docs/deployment/comfyui/izo-fp8-diagnostic-workflow.json.
  // Weight provenance is the adjacent RTX3060 manifest, not an HTTP catalogue assertion.
  if (recipe === 'flux2-klein-4b-fp8-izo-v1')
    return {
      '1': {
        class_type: 'UNETLoader',
        inputs: { unet_name: MODELS.unet, weight_dtype: 'default' },
      },
      '2': {
        class_type: 'CLIPLoader',
        inputs: { clip_name: 'qwen_3_4b.safetensors', type: 'flux2', device: 'default' },
      },
      '3': { class_type: 'VAELoader', inputs: { vae_name: MODELS.vae } },
      '4': { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: ['2', 0] } },
      '5': { class_type: 'CLIPTextEncode', inputs: { text: '', clip: ['2', 0] } },
      '6': { class_type: 'EmptyFlux2LatentImage', inputs: { ...dimensions, batch_size: 1 } },
      '7': {
        class_type: 'KSampler',
        inputs: {
          seed,
          steps: 4,
          cfg: 1.0,
          sampler_name: 'er_sde',
          scheduler: 'simple',
          denoise: 1.0,
          model: ['8', 0],
          positive: ['4', 0],
          negative: ['5', 0],
          latent_image: ['6', 0],
        },
      },
      '8': { class_type: 'ModelSamplingAuraFlow', inputs: { shift: 3.0, model: ['1', 0] } },
      '11': { class_type: 'VAEDecode', inputs: { samples: ['7', 0], vae: ['3', 0] } },
      '12': { class_type: 'SaveImage', inputs: { images: ['11', 0], filename_prefix: marker } },
    };
  return {
    '1': { class_type: 'UNETLoader', inputs: { unet_name: MODELS.unet, weight_dtype: 'default' } },
    '2': {
      class_type: 'CLIPLoader',
      inputs: { clip_name: MODELS.clip, type: 'flux2', device: 'default' },
    },
    '3': { class_type: 'VAELoader', inputs: { vae_name: MODELS.vae } },
    '4': { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: ['2', 0] } },
    '5': { class_type: 'BasicGuider', inputs: { model: ['1', 0], conditioning: ['4', 0] } },
    '6': {
      class_type: 'EmptyFlux2LatentImage',
      inputs: { width: dimensions.width, height: dimensions.height, batch_size: 1 },
    },
    '7': { class_type: 'RandomNoise', inputs: { noise_seed: seed } },
    '8': {
      class_type: 'Flux2Scheduler',
      inputs: { steps: 4, width: dimensions.width, height: dimensions.height },
    },
    '9': { class_type: 'KSamplerSelect', inputs: { sampler_name: 'euler' } },
    '10': {
      class_type: 'SamplerCustomAdvanced',
      inputs: {
        noise: ['7', 0],
        guider: ['5', 0],
        sampler: ['9', 0],
        sigmas: ['8', 0],
        latent_image: ['6', 0],
      },
    },
    '11': { class_type: 'VAEDecode', inputs: { samples: ['10', 0], vae: ['3', 0] } },
    '12': { class_type: 'SaveImage', inputs: { images: ['11', 0], filename_prefix: marker } },
  };
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => JSON.stringify(k) + ':' + canonical(v))
        .join(',') +
      '}'
    );
  return JSON.stringify(value) ?? 'null';
}
function digest(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}
/** Immutable server receipt digest, computed before dispatch and retained after prompt deletion. */
export function imageWorkflowDigest(
  prompt: string,
  size: Size,
  seed: number,
  marker: string,
  recipe: AiImageRecipe = RECIPE,
): string {
  return digest(graph(prompt, size, seed, marker, recipe));
}
function validDigest(value: string): void {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) invalid();
}
async function bounded(response: Response, max: number): Promise<Buffer> {
  if (!response.ok || response.redirected || !response.body) invalid();
  const reader = response.body.getReader();
  const parts: Buffer[] = [];
  let length = 0;
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      length += item.value.byteLength;
      if (length > max) invalid();
      parts.push(Buffer.from(item.value));
    }
    return Buffer.concat(parts, length);
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
/** Only server configuration supplies the private origin. No retries or global controls. */
export class ComfyImageTransport {
  private readonly origin: string;
  private readonly fetchImpl: typeof fetch;
  constructor(options: { baseUrl?: string; fetchImpl?: typeof fetch } = {}) {
    try {
      this.origin = ollamaBaseUrl(
        options.baseUrl ??
          process.env['ASA_COMFYUI_BASE_URL'] ??
          'http://host.docker.internal:8188',
      );
    } catch {
      throw new ComfyTransportError('ai_image_provider_configuration');
    }
    this.fetchImpl = options.fetchImpl ?? fetch;
  }
  private async json(path: string, body?: unknown): Promise<unknown> {
    try {
      const response = await this.fetchImpl(this.origin + path, {
        method: body === undefined ? 'GET' : 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(7000),
        headers: {
          accept: 'application/json',
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(await bounded(response, 256 * 1024)),
      ) as unknown;
    } catch {
      throw new ComfyTransportError('ai_image_provider_unavailable', body !== undefined);
    }
  }
  async readiness(
    recipe: AiImageRecipe = RECIPE,
  ): Promise<{ ready: boolean; reason: string | null }> {
    let reason =
      'Адрес не подтвердил ComfyUI. Проверьте сервер и порт (11434 обычно Ollama, 8188 — ComfyUI).';
    try {
      object(await this.json('/system_stats'));
      // Missing or malformed optional version metadata cannot veto valid capabilities.
      // Version strings are diagnostics, not a substitute for the actual native contracts.
      // The former 0.42.1 floor had no documented upstream defect behind it.
      const template = graph('readiness', 768, 0, 'ASA_readiness', recipe);
      const definitions = new Map<string, JsonObject>();
      for (const node of Object.values(template)) {
        const type = object(node)['class_type'] as string;
        reason = 'Нет совместимого native-узла: ' + type;
        if (!definitions.has(type))
          definitions.set(type, object(object(await this.json('/object_info/' + type))[type]));
      }
      const outputs: Record<string, readonly string[]> = {
        UNETLoader: ['MODEL'],
        CLIPLoader: ['CLIP'],
        VAELoader: ['VAE'],
        CLIPTextEncode: ['CONDITIONING'],
        BasicGuider: ['GUIDER'],
        EmptyFlux2LatentImage: ['LATENT'],
        RandomNoise: ['NOISE'],
        Flux2Scheduler: ['SIGMAS'],
        KSamplerSelect: ['SAMPLER'],
        SamplerCustomAdvanced: ['LATENT', 'LATENT'],
        KSampler: ['LATENT'],
        ModelSamplingAuraFlow: ['MODEL'],
        VAEDecode: ['IMAGE'],
        SaveImage: [],
      };
      for (const raw of AI_IMAGE_PRESETS.flatMap((preset) =>
        Object.values(graph('readiness', preset.id, 0, 'ASA_readiness', recipe)),
      )) {
        const node = object(raw),
          type = node['class_type'] as string;
        const info = definitions.get(type)!;
        reason = 'Несовместимые выходы native-узла: ' + type;
        const expectedOutputs = outputs[type];
        if (!expectedOutputs || canonical(info['output']) !== canonical(expectedOutputs)) invalid();
        const input = object(info['input']);
        const required = object(input['required']);
        const declared = { ...required, ...(input['optional'] ? object(input['optional']) : {}) };
        const values = object(node['inputs']);
        reason = 'Неподдерживаемый обязательный вход native-узла: ' + type;
        for (const key of Object.keys(required)) if (!Object.hasOwn(values, key)) invalid();
        for (const [key, value] of Object.entries(values)) {
          reason = ['unet_name', 'clip_name', 'vae_name'].includes(key)
            ? 'Для профиля ' + recipe + ' не подтверждён точный файл модели: ' + String(value)
            : 'Несовместимый вход native-узла: ' + type + '.' + key;
          const field = declared[key];
          if (!Array.isArray(field) || !field.length) invalid();
          if (Array.isArray(field[0]) || field[0] === 'COMBO') {
            const choices = Array.isArray(field[0]) ? field[0] : object(field[1])['options'];
            if (!Array.isArray(choices) || Array.isArray(value) || !choices.includes(value))
              invalid();
          } else if (Array.isArray(value)) {
            const source = object(template[String(value[0])]);
            const sourceOutputs = outputs[source['class_type'] as string];
            if (
              value.length !== 2 ||
              !Number.isInteger(value[1]) ||
              field[0] !== sourceOutputs?.[value[1] as number]
            )
              invalid();
          } else if (typeof value === 'number') {
            if (
              !Number.isFinite(value) ||
              field[0] !== (['cfg', 'denoise', 'shift'].includes(key) ? 'FLOAT' : 'INT') ||
              (field[0] === 'INT' && !Number.isInteger(value))
            )
              invalid();
            const bounds = field[1] ? object(field[1]) : {};
            if (
              (typeof bounds['min'] === 'number' && value < bounds['min']) ||
              (typeof bounds['max'] === 'number' && value > bounds['max'])
            )
              invalid();
          } else if (
            field[0] !== 'STRING' ||
            typeof value !== 'string' ||
            ['unet_name', 'clip_name', 'vae_name'].includes(key)
          )
            invalid();
        }
      }
      return { ready: true, reason: null };
    } catch {
      return { ready: false, reason };
    }
  }
  async dispatch(
    providerUUID: string,
    prompt: string,
    size: Size,
    seed: number,
    marker: string,
    recipe: AiImageRecipe = RECIPE,
  ): Promise<void> {
    identity(providerUUID, marker, size);
    if (
      typeof prompt !== 'string' ||
      prompt.length < 1 ||
      prompt.length > 4000 ||
      !Number.isSafeInteger(seed) ||
      seed < 0 ||
      seed > 0xffffffff
    )
      invalid();
    const workflow = graph(prompt, size, seed, marker, recipe);
    // The durable caller CAS must precede this sole POST. ComfyUI does not deduplicate IDs.
    try {
      const response = object(
        await this.json('/prompt', {
          prompt_id: providerUUID,
          prompt: workflow,
          extra_data: { asa_image: { marker, recipe, digest: digest(workflow) } },
        }),
      );
      if (
        response['prompt_id'] !== providerUUID ||
        (response['node_errors'] && Object.keys(object(response['node_errors'])).length)
      )
        invalid();
    } catch {
      throw new ComfyTransportError('ai_image_dispatch_unknown', true);
    }
  }
  private owned(
    tuple: unknown,
    id: string,
    marker: string,
    size: Size,
    expectedDigest: string,
    recipe: AiImageRecipe = RECIPE,
  ): boolean {
    if (!Array.isArray(tuple) || tuple[1] !== id) return false;
    const workflow = object(tuple[2]);
    const meta = object(object(tuple[3])['asa_image']);
    const prompt = object(object(workflow['4'])['inputs'])['text'];
    const seed = object(object(workflow['7'])['inputs'])[recipe === RECIPE ? 'noise_seed' : 'seed'];
    if (
      typeof prompt !== 'string' ||
      prompt.length < 1 ||
      prompt.length > 4000 ||
      typeof seed !== 'number' ||
      !Number.isSafeInteger(seed) ||
      seed < 0 ||
      seed > 0xffffffff
    )
      return false;
    const expected = graph(prompt, size, seed, marker, recipe);
    return (
      meta['marker'] === marker &&
      meta['recipe'] === recipe &&
      meta['digest'] === expectedDigest &&
      digest(expected) === expectedDigest &&
      canonical(workflow) === canonical(expected)
    );
  }
  private async queue(
    id: string,
    marker: string,
    size: Size,
    expectedDigest: string,
    recipe: AiImageRecipe = RECIPE,
  ): Promise<'pending' | 'running' | 'missing'> {
    const queue = object(await this.json('/queue'));
    for (const [key, state] of [
      ['queue_running', 'running'],
      ['queue_pending', 'pending'],
    ] as const) {
      const entries = queue[key];
      if (!Array.isArray(entries) || entries.length > 2000) invalid();
      for (const entry of entries) {
        if (Array.isArray(entry) && entry[1] === id) {
          if (!this.owned(entry, id, marker, size, expectedDigest, recipe)) invalid();
          return state;
        }
      }
    }
    return 'missing';
  }
  async recover(
    id: string,
    marker: string,
    size: Size,
    expectedDigest: string,
    recipe: AiImageRecipe = RECIPE,
  ): Promise<ComfyImageRecovery> {
    identity(id, marker, size);
    validDigest(expectedDigest);
    const history = object(await this.json('/history/' + id));
    if (!Object.hasOwn(history, id))
      return { state: await this.queue(id, marker, size, expectedDigest, recipe) };
    const entry = object(history[id]);
    if (!this.owned(entry['prompt'], id, marker, size, expectedDigest, recipe)) invalid();
    const status = object(entry['status']);
    if (status['status_str'] === 'error') return { state: 'failed' };
    if (status['completed'] !== true || status['status_str'] !== 'success')
      return { state: 'running' };
    const images = object(object(entry['outputs'])['12'])['images'];
    if (!Array.isArray(images) || images.length !== 1) invalid();
    const image = object(images[0]);
    const filename = image['filename'];
    if (
      typeof filename !== 'string' ||
      !new RegExp('^' + marker + '_[0-9]{5,}_[.]png$').test(filename) ||
      filename.length > 150 ||
      image['subfolder'] !== '' ||
      image['type'] !== 'output'
    )
      invalid();
    let png: Buffer;
    try {
      const response = await this.fetchImpl(
        this.origin +
          '/view?' +
          new URLSearchParams({ filename, subfolder: '', type: 'output' }).toString(),
        { redirect: 'error', signal: AbortSignal.timeout(15000), headers: { accept: 'image/png' } },
      );
      png = await bounded(response, 8 * 1024 * 1024);
      const validated = validateAiAttachment(png, 'result.png');
      const dimensions = aiImageDimensions(size);
      if (validated.width !== dimensions.width || validated.height !== dimensions.height) invalid();
      const chunks = [png.subarray(0, 8)];
      for (let offset = 8; offset < png.length;) {
        const end = offset + 12 + png.readUInt32BE(offset);
        if (!['tEXt', 'zTXt', 'iTXt'].includes(png.toString('ascii', offset + 4, offset + 8)))
          chunks.push(png.subarray(offset, end));
        offset = end;
      }
      png = Buffer.concat(chunks);
    } catch {
      throw new ComfyTransportError('ai_image_output_invalid');
    }
    return { state: 'complete', png };
  }
  async cancelPending(
    id: string,
    marker: string,
    size: Size,
    expectedDigest: string,
    recipe: AiImageRecipe = RECIPE,
  ): Promise<boolean> {
    identity(id, marker, size);
    validDigest(expectedDigest);
    if ((await this.queue(id, marker, size, expectedDigest, recipe)) !== 'pending') return false;
    // /queue delete targets only this caller-owned ID; never interrupt running work.
    await this.json('/queue', { delete: [id] });
    return (await this.queue(id, marker, size, expectedDigest, recipe)) === 'missing';
  }
}
