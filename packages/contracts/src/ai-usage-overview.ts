/** Recorded token usage only. Decimal strings preserve PostgreSQL SUM(bigint) exactly. */
export interface AiUsageTokenTotal {
  /** Null means operations exist, but none supplied this token count. */
  readonly known: string | null;
  readonly knownOperations: number;
  readonly unknownOperations: number;
}

/** One snapshot of the existing admission journal; it contains no private owner or chat data. */
export interface AiUsageOverview {
  readonly schemaVersion: 1;
  readonly period: {
    /** Inclusive UTC midnight, six calendar days before the current UTC day. */
    readonly from: string;
    /** Exclusive database statement time. The current day is still in progress. */
    readonly to: string;
    readonly timeZone: 'UTC';
    readonly days: 7;
  };
  readonly generatedAt: string;
  /** Unique admitted operations, including pending, failed and regenerated requests. */
  readonly requests: number;
  readonly inputTokens: AiUsageTokenTotal;
  readonly outputTokens: AiUsageTokenTotal;
  readonly daily: readonly {
    /** Calendar date in UTC, YYYY-MM-DD. */
    readonly date: string;
    readonly requests: number;
  }[];
  readonly state: 'empty' | 'partial' | 'complete';
}
