export type AiProvider = 'openai' | 'deepseek' | 'ollama-cloud' | 'polza';

export interface AiModelOption {
  readonly id: string;
  readonly provider: AiProvider;
  readonly label: string;
  readonly inputModalities: readonly ('text' | 'image')[];
  readonly outputModalities: readonly ('text' | 'image')[];
  readonly streaming: boolean;
  readonly adapterCompatible?: boolean;
  readonly shutdownDate: string | null;
  readonly selectable: boolean;
  readonly lifecycle: 'active' | 'deprecated' | 'retired';
}

export interface AiProviderConfiguration {
  readonly provider: AiProvider;
  readonly model: string;
  readonly enabled: boolean;
  readonly revision: number;
  readonly apiKeyConfigured: boolean;
  readonly keyFingerprint: string | null;
  readonly updatedAt: string | null;
}

export interface AiAdminConfig {
  readonly schemaVersion: 2;
  readonly enabled: boolean;
  readonly paidOperationsPerHour: number;
  readonly provider: AiProvider;
  readonly model: string;
  readonly apiKeyConfigured: boolean;
  readonly encryptionReady: boolean;
  readonly keyFingerprint: string | null;
  readonly configurationVersion: number;
  readonly updatedAt: string | null;
  readonly migratedFromModel: string | null;
  readonly providerConfigurations: readonly AiProviderConfiguration[];
  readonly modelCatalog: {
    readonly revision: string;
    readonly providers: readonly {
      readonly id: AiProvider;
      readonly label: string;
      readonly defaultModel: string;
    }[];
    readonly models: readonly AiModelOption[];
    readonly productFeatures: {
      readonly textChat: boolean;
      readonly streaming: boolean;
      readonly imageInput: boolean;
      readonly fileAttachments: boolean;
      readonly imageGeneration: boolean;
    };
  };
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function provider(value: unknown): value is AiProvider {
  return (
    value === 'openai' || value === 'deepseek' || value === 'ollama-cloud' || value === 'polza'
  );
}

function nullableText(value: unknown): boolean {
  return value === null || typeof value === 'string';
}

/** Validate the catalog contract; model identifiers themselves come only from the server. */
export function isAiAdminConfig(value: unknown): value is AiAdminConfig {
  if (!record(value) || !record(value['modelCatalog'])) return false;
  const catalog = value['modelCatalog'];
  const models = catalog['models'];
  const providers = catalog['providers'];
  const slots = value['providerConfigurations'];
  const features = catalog['productFeatures'];
  if (
    value['schemaVersion'] !== 2 ||
    typeof catalog['revision'] !== 'string' ||
    !Array.isArray(models) ||
    !models.length ||
    models.length > 2400 ||
    !Array.isArray(providers) ||
    ![2, 3, 4].includes(providers.length) ||
    !Array.isArray(slots) ||
    slots.length !== providers.length ||
    !record(features) ||
    !['textChat', 'streaming', 'imageInput', 'fileAttachments', 'imageGeneration'].every(
      (key) => typeof features[key] === 'boolean',
    )
  )
    return false;
  if (
    !models.every(
      (model) =>
        record(model) &&
        typeof model['id'] === 'string' &&
        model['id'].length > 0 &&
        provider(model['provider']) &&
        typeof model['label'] === 'string' &&
        typeof model['selectable'] === 'boolean' &&
        typeof model['streaming'] === 'boolean' &&
        ['active', 'deprecated', 'retired'].includes(String(model['lifecycle'])) &&
        nullableText(model['shutdownDate']) &&
        ['inputModalities', 'outputModalities'].every(
          (key) =>
            Array.isArray(model[key]) &&
            (model[key].length > 0 ||
              (model['adapterCompatible'] === false &&
                model['selectable'] === false &&
                model['streaming'] === false)) &&
            model[key].every((item: unknown) => item === 'text' || item === 'image'),
        ),
    )
  )
    return false;
  const hasModel = (id: unknown, owner: unknown): boolean =>
    models.some((model) => model.id === id && model.provider === owner);
  const hasSlotModel = (id: unknown, owner: unknown): boolean =>
    hasModel(id, owner) || (owner === 'polza' && id === 'polza/unconfigured');
  if (
    new Set(models.map((model) => model.id)).size !== models.length ||
    ![2, 3, 4].includes(providers.length) ||
    !providers.some((item) => record(item) && item['id'] === 'openai') ||
    !providers.some((item) => record(item) && item['id'] === 'deepseek') ||
    new Set(providers.map((item) => (record(item) ? item['id'] : null))).size !==
      providers.length ||
    !providers.every(
      (item) =>
        record(item) &&
        provider(item['id']) &&
        typeof item['label'] === 'string' &&
        hasSlotModel(item['defaultModel'], item['id']),
    ) ||
    slots.length !== providers.length ||
    new Set(slots.map((item) => (record(item) ? item['provider'] : null))).size !==
      providers.length ||
    !slots.every(
      (item) =>
        record(item) &&
        provider(item['provider']) &&
        hasSlotModel(item['model'], item['provider']) &&
        typeof item['enabled'] === 'boolean' &&
        Number.isSafeInteger(item['revision']) &&
        Number(item['revision']) > 0 &&
        typeof item['apiKeyConfigured'] === 'boolean' &&
        nullableText(item['keyFingerprint']) &&
        nullableText(item['updatedAt']),
    )
  )
    return false;
  return (
    typeof value['enabled'] === 'boolean' &&
    typeof value['apiKeyConfigured'] === 'boolean' &&
    typeof value['encryptionReady'] === 'boolean' &&
    Number.isSafeInteger(value['configurationVersion']) &&
    Number(value['configurationVersion']) > 0 &&
    Number.isInteger(value['paidOperationsPerHour']) &&
    Number(value['paidOperationsPerHour']) >= 0 &&
    Number(value['paidOperationsPerHour']) <= 2147483647 &&
    provider(value['provider']) &&
    hasModel(value['model'], value['provider']) &&
    nullableText(value['keyFingerprint']) &&
    nullableText(value['updatedAt']) &&
    nullableText(value['migratedFromModel'])
  );
}
