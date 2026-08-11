import type { ChessAnalysisJob } from './chess-analysis-job.js';

export type ChessAnalysisJobCreateResult =
  | { readonly kind: 'created'; readonly job: ChessAnalysisJob }
  | { readonly kind: 'existing'; readonly job: ChessAnalysisJob }
  | { readonly kind: 'id_conflict' };

export type ChessAnalysisJobSaveResult = 'saved' | 'not_found' | 'conflict';

export interface ChessAnalysisJobRepositoryPort {
  create(job: ChessAnalysisJob): Promise<ChessAnalysisJobCreateResult>;
  get(tenantPartition: string, jobId: string): Promise<ChessAnalysisJob | null>;
  save(job: ChessAnalysisJob, expectedVersion: number): Promise<ChessAnalysisJobSaveResult>;
}

export interface ChessAnalysisJobQueueDispatch {
  readonly tenantPartition: string;
  readonly jobId: string;
  readonly attempt: number;
  readonly jobVersion: number;
}

export interface ChessAnalysisJobQueueItem extends ChessAnalysisJobQueueDispatch {
  /** Opaque bearer claim delivered only to the worker consuming this item. */
  readonly claimToken: string;
}

export interface ChessAnalysisJobQueuePort {
  enqueue(item: ChessAnalysisJobQueueDispatch): Promise<void>;
  cancel(tenantPartition: string, jobId: string, attempt?: number): Promise<void>;
}

export type ChessAnalysisJobMutationAction =
  'start' | 'progress' | 'complete' | 'fail' | 'cancel' | 'retry';

export type ChessAnalysisJobMutationPrincipal =
  | {
      readonly kind: 'requester';
      readonly actorId: string;
    }
  | {
      readonly kind: 'worker';
      readonly workerId: string;
      readonly claimToken: string;
    };

export interface ChessAnalysisJobAuthorizationPort {
  authorize(input: {
    readonly action: ChessAnalysisJobMutationAction;
    readonly principal: ChessAnalysisJobMutationPrincipal;
    readonly job: ChessAnalysisJob;
  }): Promise<boolean>;
}

export interface ChessAnalysisJobClockPort {
  nowMs(): number;
}

export interface ChessAnalysisJobIdPort {
  nextId(): string;
}
