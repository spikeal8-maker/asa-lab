export interface AiPolzaAdminConfig {
  readonly configurationVersion: number;
  readonly enabled: boolean;
  readonly transcriptionEnabled: boolean;
  readonly dailySecondsLimit: number;
  readonly globalDailySecondsLimit: number;
  readonly maxAudioSeconds: number;
  readonly apiKeyConfigured: boolean;
  readonly keyFingerprint: string | null;
  readonly updatedAt: string;
  readonly encryptionReady: boolean;
}

export function isPolzaConfig(value: unknown): value is AiPolzaAdminConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const data = value as Record<string, unknown>;
  return (
    Number.isSafeInteger(data.configurationVersion) &&
    Number(data.configurationVersion) >= 1 &&
    typeof data.enabled === 'boolean' &&
    typeof data.transcriptionEnabled === 'boolean' &&
    Number.isInteger(data.dailySecondsLimit) &&
    Number(data.dailySecondsLimit) >= 60 &&
    Number.isInteger(data.globalDailySecondsLimit) &&
    Number(data.globalDailySecondsLimit) >= 600 &&
    Number.isInteger(data.maxAudioSeconds) &&
    Number(data.maxAudioSeconds) >= 5 &&
    typeof data.apiKeyConfigured === 'boolean' &&
    (data.keyFingerprint === null || typeof data.keyFingerprint === 'string') &&
    typeof data.updatedAt === 'string' &&
    typeof data.encryptionReady === 'boolean'
  );
}
