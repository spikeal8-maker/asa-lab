import type { AiAdminConfig } from '../ai-chat.service.js';
import { getAiModelCatalog } from '../ai-model-catalog.js';

/** Public API fixture only: no provider credential is present or reconstructed. */
export function aiAdminFixture(overrides: Partial<AiAdminConfig> = {}): AiAdminConfig {
  const catalog = getAiModelCatalog(Date.parse('2026-10-19T00:00:00Z'));
  const config = {
    schemaVersion: 2 as const,
    modelCatalog: catalog,
    enabled: false,
    paidOperationsPerHour: 0,
    provider: 'openai' as const,
    model: 'gpt-6-luna' as const,
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
