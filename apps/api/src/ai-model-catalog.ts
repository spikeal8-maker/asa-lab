import type { PolzaCatalog } from './ai-polza-catalog.js';
import type { AiOllamaCloudModel, AiCatalogObservation } from '@asa-lab/contracts';
import { AI_MAX_OUTPUT_TOKENS } from './ai-generation-limits.js';
/** Server-owned text model catalog. The browser consumes this metadata, never an allowlist.
 * Official sources checked 2026-10-19:
 * https://developers.openai.com/api/docs/models/gpt-6-luna
 * https://developers.openai.com/api/docs/deprecations
 * https://developers.openai.com/api/docs/changelog (2025-08-07: minimal effort)
 * https://api-docs.deepseek.com/quick_start/pricing/
 * https://api-docs.deepseek.com/guides/thinking_mode/
 * Migration 0227 mirrors only the closed SQL boundary; a regression checks parity.
 * Ollama Cloud names verified 2026-10-25 at https://ollama.com/api/tags.
 * https://docs.ollama.com/api/openai-compatibility; migration 0252 extends the same guards.
 */
const MODELS = [
  {
    id: 'gemma4:31b',
    provider: 'ollama-cloud',
    label: 'Gemma 4 31B',
    vision: true,
    shutdownDate: null,
    reasoning: null,
  },
  {
    id: 'gpt-oss:120b',
    provider: 'ollama-cloud',
    label: 'GPT-OSS 120B',
    vision: false,
    shutdownDate: null,
    reasoning: null,
  },
  {
    id: 'gpt-oss:20b',
    provider: 'ollama-cloud',
    label: 'GPT-OSS 20B',
    vision: false,
    shutdownDate: null,
    reasoning: null,
  },
  {
    id: 'gpt-6-luna',
    provider: 'openai',
    label: 'GPT-6 Luna',
    vision: true,
    shutdownDate: null,
    reasoning: 'none',
  },
  {
    id: 'gpt-5-mini',
    provider: 'openai',
    label: 'GPT-5 mini',
    vision: true,
    shutdownDate: '2026-12-11',
    reasoning: 'minimal',
  },
  {
    id: 'gpt-4.1-mini',
    provider: 'openai',
    label: 'GPT-4.1 mini',
    vision: true,
    shutdownDate: '2027-01-14',
    reasoning: null,
  },
  {
    id: 'deepseek-flash',
    provider: 'deepseek',
    label: 'DeepSeek Flash',
    vision: true,
    shutdownDate: null,
    reasoning: 'disabled',
  },
  {
    id: 'deepseek-v4-pro',
    provider: 'deepseek',
    label: 'DeepSeek V4 Pro',
    vision: false,
    shutdownDate: null,
    reasoning: 'disabled',
  },
] as const;

export type AiProvider = (typeof MODELS)[number]['provider'] | 'polza';
export type AiModel = (typeof MODELS)[number]['id'] | (string & {});

/** Populated only from the private, server-owned SQL catalogue. Never from browser JSON. */
let cloudModels: {
  id: string;
  upstream: string;
  provider: 'ollama-cloud';
  label: string;
  vision: boolean;
  shutdownDate: null;
  reasoning: null;
  active: boolean;
}[] = MODELS.filter((m) => m.provider === 'ollama-cloud').map((m) => ({
  ...m,
  id: String(m.id),
  upstream: String(m.id),
  active: true,
}));
let cloudRevision: string | null = null;
let cloudAvailable: ReadonlySet<string> | null = null;
export function isOllamaCloudPoolManaged(): boolean {
  return cloudAvailable !== null;
}
export function isOllamaCloudModelAvailable(model: string): boolean {
  return cloudAvailable === null || cloudAvailable.has(model);
}
export function installOllamaCloudCatalog(
  rows: readonly AiOllamaCloudModel[],
  checkedAt: string | null,
  availableModels: readonly string[] | null = null,
): void {
  if (!rows.length || rows.length > 600) throw new Error('AI_CLOUD_CATALOG_INVALID');
  const next = rows.map((row) => {
    const old = MODELS.find((m) => m.provider === 'ollama-cloud' && m.id === row.model);
    if (
      typeof row.model !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,79}$/.test(row.model) ||
      row.id !== (old ? row.model : 'ollama-cloud/' + row.model) ||
      typeof row.active !== 'boolean' ||
      !Array.isArray(row.capabilities) ||
      !row.capabilities.includes('completion')
    )
      throw new Error('AI_CLOUD_CATALOG_INVALID');
    return {
      id: row.id,
      upstream: row.model,
      provider: 'ollama-cloud' as const,
      label: old?.label ?? row.model + '',
      vision: row.capabilities.includes('vision'),
      shutdownDate: null,
      reasoning: null,
      active: row.active,
    };
  });
  if (new Set(next.map((m) => m.id)).size !== next.length)
    throw new Error('AI_CLOUD_CATALOG_INVALID');
  cloudModels = next;
  cloudRevision = checkedAt;
  cloudAvailable = availableModels === null ? null : new Set(availableModels);
}
let polzaReady = false;
let polzaModels: {
  id: string;
  upstream: string;
  provider: 'polza';
  label: string;
  vision: boolean;
  tools: boolean;
  maxOutputTokens: number;
  active: boolean;
  selected: boolean;
  shutdownDate: null;
  reasoning: null;
}[] = [];
export function installPolzaModelCatalog(value: PolzaCatalog): void {
  polzaReady = true;
  polzaModels = value.items
    .filter((m) => m.kind === 'chat')
    .map((m) => ({
      ...m,
      provider: 'polza',
      active: m.active && value.credentialCurrent,
      shutdownDate: null,
      reasoning: null,
    }));
}
export function supportsAiTools(provider: unknown, model: unknown): boolean {
  return provider !== 'polza' || polzaModels.some((m) => m.id === model && m.tools);
}
export function isPolzaModelSelected(id: string): boolean {
  return polzaModels.some((m) => m.id === id && m.active && m.selected);
}
let observations: readonly AiCatalogObservation[] = [];
export function installProviderObservations(value: readonly AiCatalogObservation[]): void {
  observations = value;
}
function observedAvailable(provider: string, id: string): boolean {
  const observation = observations.find((o) => o.provider === provider);
  if (observation?.credentialChanged) return false;
  return !observation?.checkedAt || observation.models.some((m) => m.id === id && m.active);
}
function modelEntries() {
  return [...MODELS.filter((m) => m.provider !== 'ollama-cloud'), ...cloudModels, ...polzaModels];
}

const PROVIDERS = [
  { id: 'polza', label: 'Polza AI', defaultModel: 'polza/unconfigured' },
  { id: 'openai', label: 'OpenAI (GPT)', defaultModel: 'gpt-6-luna' },
  { id: 'deepseek', label: 'DeepSeek', defaultModel: 'deepseek-flash' },
  { id: 'ollama-cloud', label: 'Ollama Cloud', defaultModel: 'gemma4:31b' },
] as const;

/** Provider support does not enable an ASA upload, document or image generation adapter. */
export const AI_PRODUCT_FEATURES = {
  textChat: true,
  streaming: true,
  imageInput: true,
  fileAttachments: false,
  imageGeneration: false,
} as const;

export function isAiProvider(value: unknown): value is AiProvider {
  return PROVIDERS.some((provider) => provider.id === value);
}

export function isKnownAiModel(value: unknown): value is AiModel {
  return modelEntries().some((m) => m.id === value);
}
export function isAiModel(value: unknown, now = Date.now()): value is AiModel {
  return modelEntries().some(
    (model) =>
      model.id === value &&
      observedAvailable(model.provider, model.id) &&
      (!('active' in model) || model.active) &&
      (model.shutdownDate === null || now < Date.parse(model.shutdownDate + 'T00:00:00Z')),
  );
}

/** Configuration maintenance validates adapter identity, independently of observed availability. */
export function isKnownModelForProvider(provider: unknown, model: unknown): model is AiModel {
  return modelEntries().some(
    (candidate) => candidate.id === model && candidate.provider === provider,
  );
}

export function isModelForProvider(
  provider: unknown,
  model: unknown,
  now = Date.now(),
): model is AiModel {
  return (
    isAiModel(model, now) &&
    modelEntries().some((candidate) => candidate.id === model && candidate.provider === provider)
  );
}

/** Admission remains active-only in SQL/service. Already admitted requests may finish after a catalogue refresh retires their model. */
export function isKnownOllamaCloudModel(provider: unknown, model: unknown): boolean {
  return provider === 'ollama-cloud' && cloudModels.some((m) => m.id === model);
}

export function isKnownAdmittedModel(provider: unknown, model: unknown): boolean {
  return (
    isKnownOllamaCloudModel(provider, model) ||
    (provider === 'polza' && polzaModels.some((m) => m.id === model))
  );
}
export function getAiModelCatalog(now = Date.now()) {
  return {
    revision: cloudRevision ? '2026-10-19+cloud:' + cloudRevision : '2026-10-19',
    providers: PROVIDERS.filter((p) => p.id !== 'polza' || polzaReady).map((p) =>
      p.id === 'ollama-cloud'
        ? {
            ...p,
            defaultModel:
              cloudModels.find((m) => m.active && m.id === p.defaultModel)?.id ??
              cloudModels.find((m) => m.active)?.id ??
              p.defaultModel,
          }
        : p,
    ),
    models: [
      ...modelEntries().map((model) => ({
        adapterCompatible: true,
        id: model.id,
        provider: model.provider,
        label: model.label,
        inputModalities: model.vision ? ['text', 'image'] : ['text'],
        outputModalities: ['text'],
        streaming: true,
        shutdownDate: model.shutdownDate,
        selectable:
          isAiModel(model.id, now) &&
          (model.provider !== 'ollama-cloud' || isOllamaCloudModelAvailable(model.id)) &&
          (model.provider !== 'polza' || isPolzaModelSelected(model.id)),
        lifecycle:
          model.shutdownDate === null
            ? ('active' as const)
            : isAiModel(model.id, now)
              ? ('deprecated' as const)
              : ('retired' as const),
      })),
      ...observations.flatMap((o) =>
        o.models
          .filter(
            (m) =>
              !modelEntries().some((known) => known.id === m.id && known.provider === o.provider),
          )
          .map((m) => ({
            id: `catalog:${o.provider}:${m.id}`,
            provider: o.provider,
            label: m.id,
            adapterCompatible: false,
            inputModalities: [] as string[],
            outputModalities: [] as string[],
            streaming: false,
            shutdownDate: null,
            selectable: false,
            lifecycle: m.active ? ('active' as const) : ('retired' as const),
          })),
      ),
    ],
    productFeatures: AI_PRODUCT_FEATURES,
  };
}

export type AiModelCatalog = ReturnType<typeof getAiModelCatalog>;

/** The same bounded request policy is used by JSON, SSE and the explicitly paid test. */
export function supportsAiImageInput(provider: unknown, model: unknown): boolean {
  return modelEntries().some(
    (entry) => entry.provider === provider && entry.id === model && entry.vision,
  );
}

export function buildAiTextRequest(
  provider: AiProvider,
  model: AiModel,
  context: readonly { role: 'user' | 'assistant'; content: string }[],
  instructions: string,
  stream: boolean,
  images: readonly string[] = [],
): { url: string; body: Record<string, unknown> } {
  const descriptor = modelEntries().find((candidate) => candidate.id === model);
  if (!descriptor || descriptor.provider !== provider) {
    throw new Error('AI_MODEL_UNAVAILABLE');
  }
  if (images.length && !descriptor.vision) throw new Error('AI_VISION_UNSUPPORTED');
  if (
    images.length > 4 ||
    images.some(
      (image) => !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(image),
    )
  )
    throw new Error('AI_IMAGE_INPUT_INVALID');
  let lastUser = context.length - 1;
  while (lastUser >= 0 && context[lastUser]?.role !== 'user') lastUser -= 1;
  if (images.length && lastUser < 0) throw new Error('AI_IMAGE_INPUT_INVALID');
  const multimodal = images.length
    ? context.map((item, index) =>
        index !== lastUser
          ? item
          : {
              role: item.role,
              content:
                provider === 'openai'
                  ? [
                      { type: 'input_text', text: item.content },
                      ...images.map((image) => ({
                        type: 'input_image',
                        image_url: image,
                        detail: 'auto',
                      })),
                    ]
                  : [
                      { type: 'text', text: item.content },
                      ...images.map((image) => ({ type: 'image_url', image_url: { url: image } })),
                    ],
            },
      )
    : context;
  return provider === 'openai'
    ? {
        url: 'https://api.openai.com/v1/responses',
        body: {
          model,
          instructions,
          input: multimodal,
          max_output_tokens: AI_MAX_OUTPUT_TOKENS,
          store: false,
          stream,
          ...(descriptor.reasoning === 'none' || descriptor.reasoning === 'minimal'
            ? { reasoning: { effort: descriptor.reasoning } }
            : {}),
        },
      }
    : {
        url:
          provider === 'ollama-cloud'
            ? 'https://ollama.com/v1/chat/completions'
            : provider === 'polza'
              ? 'https://polza.ai/api/v1/chat/completions'
              : 'https://api.deepseek.com/chat/completions',
        body: {
          ...(stream ? { stream_options: { include_usage: true } } : {}),
          model:
            (provider === 'ollama-cloud' || provider === 'polza') && 'upstream' in descriptor
              ? descriptor.upstream
              : model,
          messages: [{ role: 'system', content: instructions }, ...multimodal],
          max_tokens:
            'maxOutputTokens' in descriptor ? descriptor.maxOutputTokens : AI_MAX_OUTPUT_TOKENS,
          ...(provider === 'deepseek' ? { thinking: { type: 'disabled' } } : {}),
          stream,
        },
      };
}
