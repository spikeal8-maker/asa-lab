import type {
  ChessAnalysisJobAuthorizationPort,
  ChessAnalysisJobQueueDispatch,
  ChessAnalysisJobQueueItem,
  ChessAnalysisJobQueuePort,
} from '../application/chess-analysis-job-ports.js';

function itemKey(item: ChessAnalysisJobQueueDispatch): string {
  return `${item.tenantPartition}\u0000${item.jobId}\u0000${item.attempt}`;
}

function immutableItem(item: ChessAnalysisJobQueueItem): ChessAnalysisJobQueueItem {
  return Object.freeze(structuredClone(item));
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export class MemoryChessAnalysisJobQueue
  implements ChessAnalysisJobQueuePort, ChessAnalysisJobAuthorizationPort
{
  private readonly items = new Map<string, ChessAnalysisJobQueueItem>();
  private nextEnqueueFailure: Error | null = null;
  private nextCancelFailure: Error | null = null;
  private claimSequence = 0;
  calls = 0;

  failNextEnqueue(message = 'Injected queue failure.'): void {
    this.nextEnqueueFailure = new Error(message);
  }

  failNextCancel(message = 'Injected queue cancellation failure.'): void {
    this.nextCancelFailure = new Error(message);
  }

  async enqueue(dispatch: ChessAnalysisJobQueueDispatch): Promise<void> {
    this.calls += 1;
    if (this.nextEnqueueFailure) {
      const failure = this.nextEnqueueFailure;
      this.nextEnqueueFailure = null;
      throw failure;
    }
    const key = itemKey(dispatch);
    const existing = this.items.get(key);
    if (existing) {
      if (existing.jobVersion !== dispatch.jobVersion) {
        throw new Error('Queue dispatch conflicts with an existing attempt.');
      }
      return;
    }
    this.claimSequence += 1;
    this.items.set(
      key,
      immutableItem({ ...dispatch, claimToken: `analysis-claim-${this.claimSequence}` }),
    );
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
    if (input.principal.kind === 'requester') {
      return (
        input.principal.actorId === input.job.requestedBy &&
        (input.action === 'cancel' || input.action === 'retry')
      );
    }
    if (
      input.action !== 'start' &&
      input.action !== 'progress' &&
      input.action !== 'complete' &&
      input.action !== 'fail'
    ) {
      return false;
    }
    const item = this.items.get(
      itemKey({
        tenantPartition: input.job.tenantPartition,
        jobId: input.job.id,
        attempt: input.job.attempt,
        jobVersion: input.job.version,
      }),
    );
    return (
      item?.claimToken === input.principal.claimToken &&
      item.jobVersion <= input.job.version &&
      input.principal.workerId.length > 0
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
      .map(immutableItem);
  }
}
