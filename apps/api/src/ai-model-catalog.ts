/** Server-owned text model catalog. The browser consumes this metadata, never an allowlist.
 * Official sources checked 2026-10-19:
 * https://developers.openai.com/api/docs/models/gpt-6-luna
 * https://developers.openai.com/api/docs/deprecations
 * https://developers.openai.com/api/docs/changelog (2025-08-07: minimal effort)
 * https://api-docs.deepseek.com/quick_start/pricing/
 * https://api-docs.deepseek.com/guides/thinking_mode/
 * Migration 0227 mirrors only the closed SQL boundary; a regression checks parity.
 */
const MODELS = [
  {
    id: 'ollama-local',
    provider: 'ollama',
    label: 'Ollama · серверная модель',
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

export type AiProvider = (typeof MODELS)[number]['provider'];
export type AiModel = (typeof MODELS)[number]['id'];

const PROVIDERS = [
  { id: 'openai', label: 'OpenAI (GPT)', defaultModel: 'gpt-6-luna' },
  { id: 'deepseek', label: 'DeepSeek', defaultModel: 'deepseek-flash' },
  { id: 'ollama', label: 'Ollama (локальная сеть)', defaultModel: 'ollama-local' },
] as const;

/** Provider support does not enable an ASA upload, document or image generation adapter. */
export const AI_PRODUCT_FEATURES = {
  textChat: true,
  streaming: true,
  imageInput: false,
  fileAttachments: false,
  imageGeneration: false,
} as const;

export function isAiProvider(value: unknown): value is AiProvider {
  return PROVIDERS.some((provider) => provider.id === value);
}

export function isAiModel(value: unknown, now = Date.now()): value is AiModel {
  return MODELS.some(
    (model) =>
      model.id === value &&
      (model.shutdownDate === null || now < Date.parse(model.shutdownDate + 'T00:00:00Z')),
  );
}

export function isModelForProvider(
  provider: unknown,
  model: unknown,
  now = Date.now(),
): model is AiModel {
  return (
    isAiModel(model, now) &&
    MODELS.some((candidate) => candidate.id === model && candidate.provider === provider)
  );
}

export function getAiModelCatalog(now = Date.now()) {
  return {
    revision: '2026-10-21-ollama-lan',
    providers: PROVIDERS,
    models: MODELS.map((model) => ({
      id: model.id,
      provider: model.provider,
      label: model.label,
      inputModalities: model.vision ? ['text', 'image'] : ['text'],
      outputModalities: ['text'],
      streaming: true,
      shutdownDate: model.shutdownDate,
      selectable: isAiModel(model.id, now),
      lifecycle:
        model.shutdownDate === null
          ? ('active' as const)
          : isAiModel(model.id, now)
            ? ('deprecated' as const)
            : ('retired' as const),
    })),
    productFeatures: AI_PRODUCT_FEATURES,
  };
}

export type AiModelCatalog = ReturnType<typeof getAiModelCatalog>;

/** The same bounded request policy is used by JSON, SSE and the explicitly paid test. */
export function buildAiTextRequest(
  provider: AiProvider,
  model: AiModel,
  context: readonly { role: 'user' | 'assistant'; content: string }[],
  instructions: string,
  stream: boolean,
): { url: string; body: Record<string, unknown> } {
  const descriptor = MODELS.find((candidate) => candidate.id === model);
  if (!descriptor || !isModelForProvider(provider, model)) {
    throw new Error('AI_MODEL_UNAVAILABLE');
  }
  if (provider === 'ollama') {
    throw new Error('AI_OLLAMA_REQUIRES_PRIVATE_LAN_ADAPTER');
  }
  return provider === 'openai'
    ? {
        url: 'https://api.openai.com/v1/responses',
        body: {
          model,
          instructions,
          input: context,
          max_output_tokens: 1600,
          store: false,
          stream,
          ...(descriptor.reasoning === 'none' || descriptor.reasoning === 'minimal'
            ? { reasoning: { effort: descriptor.reasoning } }
            : {}),
        },
      }
    : {
        url: 'https://api.deepseek.com/chat/completions',
        body: {
          model,
          messages: [{ role: 'system', content: instructions }, ...context],
          max_tokens: 1600,
          thinking: { type: 'disabled' },
          stream,
        },
      };
}
