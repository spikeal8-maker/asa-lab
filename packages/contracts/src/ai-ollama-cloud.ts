/** Public metadata only: never contains an API key or encrypted credential fields. */
export interface AiOllamaCloudModel {
  readonly id: string;
  readonly model: string;
  readonly capabilities: readonly string[];
  readonly active: boolean;
}
export interface AiOllamaCloudAccount {
  readonly status:
    | 'ok'
    | 'key_required'
    | 'invalid_key'
    | 'forbidden'
    | 'credits_required'
    | 'rate_limited'
    | 'unavailable';
  readonly checkedAt: string;
  readonly retryAfterSeconds: number | null;
  readonly balance: {
    readonly includedUsd: number | null;
    readonly purchasedUsd: number | null;
    readonly allowanceUsd: number | null;
    readonly resetsAt: string | null;
    readonly sessionRemainingPercent: number | null;
    readonly weeklyRemainingPercent: number | null;
  } | null;
}
export interface AiOllamaCloudInspection {
  readonly models: readonly AiOllamaCloudModel[];
  readonly account: AiOllamaCloudAccount;
  readonly catalogCheckedAt: string | null;
  readonly catalogError: 'catalog_unavailable' | null;
}

export interface AiOllamaCloudKey {
  readonly slot: number;
  readonly label: string;
  readonly priority: number;
  readonly enabled: boolean;
  readonly configured: boolean;
  readonly fingerprint: string | null;
  readonly models: readonly string[];
  readonly account: AiOllamaCloudAccount | null;
  readonly blockedUntil: string | null;
  readonly unavailableModels: readonly string[];
}
export interface AiOllamaCloudPool {
  readonly configurationVersion: number;
  readonly managed: boolean;
  readonly models: readonly AiOllamaCloudModel[];
  readonly keys: readonly AiOllamaCloudKey[];
}
export interface AiOllamaCloudKeyUpdate {
  readonly slot: number;
  readonly label: string;
  readonly priority: number;
  readonly enabled: boolean;
  readonly models: readonly string[];
  readonly apiKey?: string;
  readonly clearApiKey?: boolean;
}
