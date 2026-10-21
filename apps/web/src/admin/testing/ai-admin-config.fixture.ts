import type { AiAdminConfig } from '../ai-model-config';

/** Public schema-v2 snapshot: exercises the Web contract independently of API implementation. */
const catalog: AiAdminConfig['modelCatalog'] = {
  revision: '2026-10-19',
  providers: [
    { id: 'openai', label: 'OpenAI (GPT)', defaultModel: 'gpt-6-luna' },
    { id: 'deepseek', label: 'DeepSeek', defaultModel: 'deepseek-flash' },
  ],
  models: [
    {
      id: 'gpt-6-luna',
      provider: 'openai',
      label: 'GPT-6 Luna',
      inputModalities: ['text', 'image'],
      outputModalities: ['text'],
      streaming: true,
      shutdownDate: null,
      selectable: true,
      lifecycle: 'active',
    },
    {
      id: 'gpt-5-mini',
      provider: 'openai',
      label: 'GPT-5 mini',
      inputModalities: ['text', 'image'],
      outputModalities: ['text'],
      streaming: true,
      shutdownDate: '2026-12-11',
      selectable: true,
      lifecycle: 'deprecated',
    },
    {
      id: 'gpt-4.1-mini',
      provider: 'openai',
      label: 'GPT-4.1 mini',
      inputModalities: ['text', 'image'],
      outputModalities: ['text'],
      streaming: true,
      shutdownDate: '2027-01-14',
      selectable: true,
      lifecycle: 'deprecated',
    },
    {
      id: 'deepseek-flash',
      provider: 'deepseek',
      label: 'DeepSeek Flash',
      inputModalities: ['text', 'image'],
      outputModalities: ['text'],
      streaming: true,
      shutdownDate: null,
      selectable: true,
      lifecycle: 'active',
    },
    {
      id: 'deepseek-v4-pro',
      provider: 'deepseek',
      label: 'DeepSeek V4 Pro',
      inputModalities: ['text'],
      outputModalities: ['text'],
      streaming: true,
      shutdownDate: null,
      selectable: true,
      lifecycle: 'active',
    },
  ],
  productFeatures: {
    textChat: true,
    streaming: true,
    imageInput: false,
    fileAttachments: false,
    imageGeneration: false,
  },
};

export function aiAdminFixture(overrides: Partial<AiAdminConfig> = {}): AiAdminConfig {
  const config = {
    schemaVersion: 2 as const,
    modelCatalog: catalog,
    enabled: false,
    paidOperationsPerHour: 0,
    provider: 'openai' as const,
    model: 'gpt-6-luna',
    apiKeyConfigured: false,
    encryptionReady: true,
    keyFingerprint: null,
    configurationVersion: 1,
    updatedAt: null,
    migratedFromModel: null,
    ...overrides,
  };
  return {
    ...config,
    providerConfigurations:
      overrides.providerConfigurations ??
      catalog.providers.map((item) => ({
        provider: item.id,
        model: item.id === config.provider ? config.model : item.defaultModel,
        apiKeyConfigured: item.id === config.provider && config.apiKeyConfigured,
        keyFingerprint: item.id === config.provider ? config.keyFingerprint : null,
        updatedAt: item.id === config.provider ? config.updatedAt : null,
      })),
  };
}
