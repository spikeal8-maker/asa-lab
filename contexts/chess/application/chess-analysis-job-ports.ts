import type { ChessAnalysisJob } from './chess-analysis-job.js';

export type ChessAnalysisJobCreateResult =
  | { readonly kind: 'created'; readonly job: ChessAnalysisJob }
  | { readonly kind: 'existing'; readonly job: ChessAnalysisJob };

export type ChessAnalysisJobSaveResult = 'saved' | 'not_found' | 'conflict';

export interface ChessAnalysisJobRepositoryPort {
  create(job: ChessAnalysisJob): Promise<ChessAnalysisJobCreateResult>;
  get(tenantPartition: string, jobId: string): Promise<ChessAnalysisJob | null>;
  save(job: ChessAnalysisJob, expectedVersion: number): Promise<ChessAnalysisJobSaveResult>;
}

export interface ChessAnalysisJobQueueItem {
  readonly tenantPartition: string;
  readonly jobId: string;
  readonly attempt: number;
  readonly jobVersion: number;
}

export interface ChessAnalysisJobQueuePort {
  enqueue(item: ChessAnalysisJobQueueItem): Promise<void>;
  cancel(tenantPartition: string, jobId: string): Promise<void>;
}

export interface ChessAnalysisJobClockPort {
  nowMs(): number;
}

export interface ChessAnalysisJobIdPort {
  nextId(): string;
}
