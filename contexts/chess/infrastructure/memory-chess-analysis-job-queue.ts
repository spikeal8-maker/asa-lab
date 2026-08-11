import type {
  ChessAnalysisJobAuthorizationPort,
  ChessAnalysisJobQueueDispatch,
  ChessAnalysisJobQueueEnqueueResult,
  ChessAnalysisJobQueueItem,
  ChessAnalysisJobQueuePort,
  ChessAnalysisJobWorkerClaim,
  ChessAnalysisJobWorkerClaimPort,
  ChessAnalysisJobWorkerClaimResult,
} from '../application/chess-analysis-job-ports.js';

interface StoredQueueItem extends ChessAnalysisJobQueueDispatch {
  readonly claimedBy: string | null;
  readonly claimToken: string | null;
  readonly leaseId: string | null;
  readonly leaseExpiresAtMs: number | null;
}

function itemKey(
  item: Pick<ChessAnalysisJobQueueDispatch, 'tenantPartition' | 'jobId' | 'attempt'>,
) {
  return `${item.tenantPartition}\u0000${item.jobId}\u0000${item.attempt}`;
}

function immutable<T>(value: T): T {
  return Object.freeze(structuredClone(value)) as T;
}

function monitor(item: StoredQueueItem): ChessAnalysisJobQueueItem {
  return immutable({
    tenantPartition: item.tenantPartition,
    jobId: item.jobId,
    attempt: item.attempt,
    jobVersion: item.jobVersion,
    claimedBy: item.claimedBy,
    leaseId: item.leaseId,
    leaseExpiresAtMs: item.leaseExpiresAtMs,
  });
}

function claimFrom(item: StoredQueueItem): ChessAnalysisJobWorkerClaim | null {
  if (
    item.claimedBy === null ||
    item.claimToken === null ||
    item.leaseId === null ||
    item.leaseExpiresAtMs === null
  ) {
    return null;
  }
  return immutable({
    tenantPartition: item.tenantPartition,
    jobId: item.jobId,
    attempt: item.attempt,
    jobVersion: item.jobVersion,
    workerId: item.claimedBy,
    claimToken: item.claimToken,
    leaseId: item.leaseId,
    leaseExpiresAtMs: item.leaseExpiresAtMs,
  });
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export class MemoryChessAnalysisJobQueue
  implements
    ChessAnalysisJobQueuePort,
    ChessAnalysisJobWorkerClaimPort,
    ChessAnalysisJobAuthorizationPort
{
  private readonly items = new Map<string, StoredQueueItem>();
  private nextEnqueueFailure: Error | null = null;
  private nextCancelFailure: Error | null = null;
  private claimSequence = 0;
  calls = 0;

  constructor(private readonly nowMs: () => number = Date.now) {}

  failNextEnqueue(message = 'Injected queue failure.'): void {
    this.nextEnqueueFailure = new Error(message);
  }

  failNextCancel(message = 'Injected queue cancellation failure.'): void {
    this.nextCancelFailure = new Error(message);
  }

  async enqueue(
    dispatch: ChessAnalysisJobQueueDispatch,
  ): Promise<ChessAnalysisJobQueueEnqueueResult> {
    this.calls += 1;
    if (this.nextEnqueueFailure) {
      const failure = this.nextEnqueueFailure;
      this.nextEnqueueFailure = null;
      throw failure;
    }
    const key = itemKey(dispatch);
    const existing = this.items.get(key);
    if (existing) {
      return existing.jobVersion === dispatch.jobVersion
        ? { kind: 'existing_same' }
        : { kind: 'conflict' };
    }
    this.items.set(
      key,
      immutable({
        ...dispatch,
        claimedBy: null,
        claimToken: null,
        leaseId: null,
        leaseExpiresAtMs: null,
      }),
    );
    return { kind: 'created' };
  }

  async claim(
    input: Parameters<ChessAnalysisJobWorkerClaimPort['claim']>[0],
  ): Promise<ChessAnalysisJobWorkerClaimResult> {
    this.calls += 1;
    if (
      !Number.isSafeInteger(input.leaseDurationMs) ||
      input.leaseDurationMs <= 0 ||
      input.workerId.length === 0
    ) {
      return { kind: 'conflict' };
    }
    const key = itemKey(input);
    const item = this.items.get(key);
    if (!item) return { kind: 'not_found' };
    const now = this.nowMs();
    const activeClaim = claimFrom(item);
    if (activeClaim && activeClaim.leaseExpiresAtMs > now) {
      return activeClaim.workerId === input.workerId
        ? { kind: 'existing_same', claim: activeClaim }
        : { kind: 'leased' };
    }
    const leaseExpiresAtMs = now + input.leaseDurationMs;
    if (!Number.isSafeInteger(now) || !Number.isSafeInteger(leaseExpiresAtMs)) {
      return { kind: 'conflict' };
    }
    this.claimSequence += 1;
    const claimed = immutable({
      ...item,
      claimedBy: input.workerId,
      claimToken: `analysis-claim-${this.claimSequence}`,
      leaseId: `analysis-lease-${this.claimSequence}`,
      leaseExpiresAtMs,
    });
    this.items.set(key, claimed);
    const claim = claimFrom(claimed);
    if (!claim) return { kind: 'conflict' };
    return { kind: 'claimed', claim };
  }

  async cancel(tenantPartition: string, jobId: string, attempt?: number): Promise<void> {
    this.calls += 1;
    if (this.nextCancelFailure) {
      const failure = this.nextCancelFailure;
      this.nextCancelFailure = null;
      throw failure;
    }
    for (const [key, item] of this.items) {
      if (
        item.tenantPartition === tenantPartition &&
        item.jobId === jobId &&
        (attempt === undefined || item.attempt === attempt)
      ) {
        this.items.delete(key);
      }
    }
  }

  async authorize(
    input: Parameters<ChessAnalysisJobAuthorizationPort['authorize']>[0],
  ): Promise<boolean> {
    const item = this.items.get(
      itemKey({
        tenantPartition: input.job.tenantPartition,
        jobId: input.job.id,
        attempt: input.job.attempt,
      }),
    );
    return (
      item?.claimedBy === input.principal.workerId &&
      item.claimToken === input.principal.claimToken &&
      item.leaseId === input.principal.leaseId &&
      item.leaseExpiresAtMs !== null &&
      item.leaseExpiresAtMs > this.nowMs() &&
      item.jobVersion <= input.job.version &&
      input.principal.tenantPartition === item.tenantPartition
    );
  }

  list(tenantPartition?: string): readonly ChessAnalysisJobQueueItem[] {
    return [...this.items.values()]
      .filter((item) => tenantPartition === undefined || item.tenantPartition === tenantPartition)
      .sort(
        (left, right) =>
          compareText(left.tenantPartition, right.tenantPartition) ||
          compareText(left.jobId, right.jobId) ||
          left.attempt - right.attempt,
      )
      .map(monitor);
  }
}
