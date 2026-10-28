/** Exact decimal strings; null means unlimited. UTC month, soft admission only. */
export interface AiTokenBudgetLimit {
  readonly model: string;
  readonly globalLimit: string | null;
  readonly userLimit: string | null;
}
export interface AiTokenBudgetAdmin {
  readonly configurationVersion: number;
  readonly resetAt: string;
  readonly models: readonly (AiTokenBudgetLimit & {
    readonly used: string;
    readonly held: string;
    readonly unresolved: boolean;
    readonly pendingUnknown: boolean;
  })[];
}
export interface AiTokenBudgetUpdate {
  readonly configurationVersion: number;
  readonly requestId: string;
  readonly models: readonly AiTokenBudgetLimit[];
}
export interface AiTokenBudgetsOwn {
  readonly resetAt: string;
  readonly models: readonly {
    readonly model: string;
    readonly limit: string | null;
    readonly used: string;
    readonly held: string;
    readonly remaining: string | null;
    readonly unresolved: boolean;
    readonly pendingUnknown: boolean;
    readonly available: boolean;
    readonly reason: 'ai_budget_pending' | 'ai_budget_exhausted' | null;
  }[];
}
