import type pg from 'pg';
import type { AiUsageOverview } from '@asa-lab/contracts';
import { providerModel, providerTokenCount, type AiProviderUsage } from './ai-provider-usage.js';

export interface AiUsageAttempt {
  readonly provider: string;
  readonly model: string;
  readonly operation: string;
  readonly startedAt: number;
}

export class AiUsageUnavailable extends Error {}
const FAILURE_CODES = new Set([
  'ai_provider_error',
  'ai_response_incomplete',
  'ai_response_invalid',
  'ai_response_empty',
  'ai_stream_invalid',
  'ai_stream_interrupted',
  'ai_provider_timeout',
  'ai_provider_unavailable',
  'ai_provider_invalid_request',
  'ai_provider_authentication_failed',
  'ai_provider_access_denied',
  'ai_provider_insufficient_balance',
  'ai_provider_model_unavailable',
  'ai_provider_invalid_parameters',
  'ai_provider_rate_limit',
  'ai_ollama_unreachable',
  'ai_ollama_timeout',
  'ai_ollama_interrupted',
  'ai_ollama_invalid',
  'ai_ollama_upstream_error',
  'ai_ollama_empty',
]);
export function usageFailureCode(problem: unknown): string {
  const code = problem && typeof problem === 'object' ? (problem as { code?: unknown }).code : null;
  return typeof code === 'string' && FAILURE_CODES.has(code) ? code : 'ai_generation_failed';
}

export class AiUsageJournal {
  constructor(private readonly pool: pg.Pool) {}

  async overview(actor: string): Promise<AiUsageOverview> {
    try {
      const result = await this.pool.query<{ overview: AiUsageOverview }>(
        'SELECT ai_usage_overview($1) AS overview',
        [actor],
      );
      const overview = result.rows[0]?.overview;
      if (!overview) throw new Error('AI_USAGE_MISSING');
      // PostgreSQL COUNT is bigint. Reject an unsafe JSON number instead of
      // silently rounding a chart/card; token sums already use exact strings.
      const counts = [
        overview.requests,
        overview.inputTokens.knownOperations,
        overview.inputTokens.unknownOperations,
        overview.outputTokens.knownOperations,
        overview.outputTokens.unknownOperations,
        ...overview.daily.map((day) => day.requests),
      ];
      if (counts.some((count) => !Number.isSafeInteger(count) || count < 0)) {
        throw new Error('AI_USAGE_UNSAFE_COUNT');
      }
      return overview;
    } catch (problem) {
      if ((problem as { code?: string } | null)?.code === '42501') throw problem;
      throw new AiUsageUnavailable('AI_USAGE_UNAVAILABLE');
    }
  }

  async begin(
    owner: string,
    thread: string,
    request: string,
    operation: 'chat' | 'regeneration',
    transport: 'json' | 'sse',
    provider: string,
    model: string,
  ): Promise<AiUsageAttempt> {
    try {
      const result = await this.pool.query<{ started: boolean }>(
        'SELECT ai_usage_begin($1,$2,$3,$4::varchar,$5::varchar,$6::varchar,$7::varchar) AS started',
        [owner, thread, request, operation, transport, provider, model],
      );
      if (result.rows[0]?.started !== true) throw new Error('AI_USAGE_ALREADY_STARTED');
      return { provider, model, operation, startedAt: performance.now() };
    } catch {
      this.quality('begin', request);
      throw new AiUsageUnavailable('AI_USAGE_UNAVAILABLE');
    }
  }

  async finish(
    owner: string,
    request: string,
    status: 'succeeded' | 'stopped' | 'cancelled' | 'failed',
    errorCode: string | null,
    usage?: AiProviderUsage,
    attempt?: AiUsageAttempt,
  ): Promise<void> {
    let journalState = 'recorded';
    const safeError = errorCode === null ? null : usageFailureCode({ code: errorCode });
    try {
      const result = await this.pool.query<{ recorded: boolean }>(
        'SELECT ai_usage_finish($1,$2,$3::varchar,$4::varchar,$5::bigint,$6::bigint,$7::varchar) AS recorded',
        [
          owner,
          request,
          status,
          safeError,
          usage?.inputTokens ?? null,
          usage?.outputTokens ?? null,
          usage?.actualModel ?? null,
        ],
      );
      if (result.rows[0]?.recorded !== true) throw new Error('AI_USAGE_NOT_RECORDED');
    } catch {
      // The durable admitted/running row remains visibly pending. A telemetry
      // failure must not destroy a paid answer or replace the primary exception.
      this.quality('finish', request);
      journalState = 'pending';
    }
    this.emit({
      kind: 'ai_usage',
      module: 'portal',
      path: '/api/ai',
      level: status === 'failed' ? 'error' : journalState === 'pending' ? 'warn' : 'info',
      operationRequestId: this.requestId(request),
      operation: attempt?.operation === 'regeneration' ? 'regeneration' : 'chat',
      provider:
        attempt &&
        ['openai', 'deepseek', 'ollama', 'ollama-cloud', 'polza'].includes(attempt.provider)
          ? attempt.provider
          : null,
      requestedModel: providerModel(attempt?.model),
      actualModel: providerModel(usage?.actualModel),
      status,
      errorCode: safeError,
      durationMs:
        attempt && Number.isFinite(attempt.startedAt)
          ? Math.max(0, Math.round(performance.now() - attempt.startedAt))
          : null,
      usage: {
        input: providerTokenCount(usage?.inputTokens),
        output: providerTokenCount(usage?.outputTokens),
      },
      journalState,
    });
  }

  private quality(stage: 'begin' | 'finish', request: string): void {
    this.emit({
      kind: 'ai_usage_quality',
      module: 'portal',
      path: '/api/ai',
      level: 'warn',
      stage,
      state: 'pending',
      errorCode: 'ai_usage_unavailable',
      operationRequestId: this.requestId(request),
    });
  }

  private requestId(request: string): string | undefined {
    return /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(request)
      ? request.toLowerCase()
      : undefined;
  }

  private emit(value: Record<string, unknown>): void {
    try {
      console.warn(JSON.stringify(value));
    } catch {
      /* Logging cannot mask a paid result or primary error. */
    }
  }
}
