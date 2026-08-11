import type {
  ChessAnalysisJobQueueItem,
  ChessAnalysisJobQueuePort,
} from '../application/chess-analysis-job-ports.js';

function itemKey(item: ChessAnalysisJobQueueItem): string {
  return `${item.tenantPartition}\u0000${item.jobId}\u0000${item.attempt}`;
}

export class MemoryChessAnalysisJobQueue implements ChessAnalysisJobQueuePort {
  private readonly items = new Map<string, ChessAnalysisJobQueueItem>();
  private nextFailure: Error | null = null;
  calls = 0;

  failNextEnqueue(message = 'Injected queue failure.'): void {
    this.nextFailure = new Error(message);
  }

  async enqueue(item: ChessAnalysisJobQueueItem): Promise<void> {
    this.calls += 1;
    if (this.nextFailure) {
      const failure = this.nextFailure;
      this.nextFailure = null;
      throw failure;
    }
    this.items.set(itemKey(item), structuredClone(item));
  }

  async cancel(tenantPartition: string, jobId: string): Promise<void> {
    this.calls += 1;
    for (const [key, item] of this.items) {
      if (item.tenantPartition === tenantPartition && item.jobId === jobId) this.items.delete(key);
    }
  }

  list(tenantPartition?: string): readonly ChessAnalysisJobQueueItem[] {
    return [...this.items.values()]
      .filter((item) => tenantPartition === undefined || item.tenantPartition === tenantPartition)
      .sort(
        (left, right) =>
          left.tenantPartition.localeCompare(right.tenantPartition) ||
          left.jobId.localeCompare(right.jobId) ||
          left.attempt - right.attempt,
      )
      .map((item) => structuredClone(item));
  }
}
