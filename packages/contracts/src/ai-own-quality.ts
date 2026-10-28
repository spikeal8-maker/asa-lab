/** Explicit own-personal quality review; never a global conversation directory. */
export interface AiOwnQualityGrant {
  readonly schemaVersion: 1;
  readonly scope: 'own_personal';
  readonly enabled: boolean;
  readonly revision: number;
  readonly maskingPolicy: 'quality-mask-v1';
}
export interface AiOwnQualityGrantUpdate {
  readonly enabled: boolean;
  readonly expectedRevision: number;
  readonly requestId: string;
}
export interface AiOwnQualityOperation {
  readonly requestId: string;
  readonly admittedAt: string;
  readonly timeZone: 'UTC';
  readonly operation: string | null;
  readonly provider: string | null;
  readonly requestedModel: string | null;
  readonly actualModel: string | null;
  readonly status: 'admitted' | 'running' | 'succeeded' | 'stopped' | 'cancelled' | 'failed';
  readonly answerState: 'complete' | 'partial' | 'stopped' | 'error' | 'pending' | 'unavailable';
  readonly question: string | null;
  readonly answer: string | null;
  readonly inputTokens: string | null;
  readonly outputTokens: string | null;
  readonly policyVersion: string | null;
  readonly promptVersion: string | null;
  readonly searchUsed: boolean | null;
  readonly toolUsed: boolean | null;
  readonly masked: boolean;
  readonly truncated: boolean;
}
export interface AiOwnQualityPage {
  readonly schemaVersion: 1;
  readonly scope: 'own_personal';
  readonly limit: 10;
  readonly maskingPolicy: 'quality-mask-v1';
  readonly items: readonly AiOwnQualityOperation[];
}
