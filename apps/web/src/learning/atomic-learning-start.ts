import { api, type ApiResult, type LearningStartReceipt } from '../api';

/** Keep the idempotency key through a failed response; a retry may follow a committed Start. */
export class AtomicLearningStarter {
  private readonly pending = new Map<string, string>();
  private readonly inFlight = new Set<string>();

  constructor(
    private readonly send: (
      activityRunId: string,
      requestId: string,
    ) => Promise<ApiResult<LearningStartReceipt>> = api.startLearningWork,
  ) {}

  async start(
    activityRunId: string | null | undefined,
  ): Promise<ApiResult<LearningStartReceipt> | null> {
    if (!activityRunId)
      return {
        ok: false,
        status: 409,
        error: {
          code: 'exact_run_unavailable',
          message: 'Эта практика пока недоступна для начала.',
        },
      };
    if (this.inFlight.has(activityRunId)) return null;
    this.inFlight.add(activityRunId);
    let requestId = this.pending.get(activityRunId);
    if (!requestId) {
      requestId = crypto.randomUUID();
      this.pending.set(activityRunId, requestId);
    }
    try {
      const result = await this.send(activityRunId, requestId);
      if (result.ok) this.pending.delete(activityRunId);
      return result;
    } finally {
      this.inFlight.delete(activityRunId);
    }
  }
}
