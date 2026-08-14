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

/** Redacted monitoring projection. It never contains a bearer credential. */
export interface ChessAnalysisJobQueueItem extends ChessAnalysisJobQueueDispatch {
  readonly claimedBy: string | null;
  readonly leaseId: string | null;
  readonly leaseExpiresAtMs: number | null;
}

/** Secret claim delivered only to the worker that atomically acquired the lease. */
export interface ChessAnalysisJobWorkerClaim extends ChessAnalysisJobQueueDispatch {
  readonly workerId: string;
  readonly claimToken: string;
  readonly leaseId: string;
  readonly leaseExpiresAtMs: number;
}

export type ChessAnalysisJobQueueEnqueueResult =
  { readonly kind: 'created' } | { readonly kind: 'existing_same' } | { readonly kind: 'conflict' };

export type ChessAnalysisJobWorkerClaimResult =
  | { readonly kind: 'claimed' | 'existing_same'; readonly claim: ChessAnalysisJobWorkerClaim }
  | { readonly kind: 'not_found' | 'leased' | 'conflict' };

export interface ChessAnalysisJobQueuePort {
  /**
   * Must be atomically idempotent by tenantPartition, jobId and attempt.
   * A replay with the same jobVersion returns existing_same; version drift returns conflict.
   */
  enqueue(item: ChessAnalysisJobQueueDispatch): Promise<ChessAnalysisJobQueueEnqueueResult>;
  cancel(tenantPartition: string, jobId: string, attempt?: number): Promise<void>;
}

export interface ChessAnalysisJobWorkerClaimPort {
  claim(input: {
    readonly tenantPartition: string;
    readonly jobId: string;
    readonly attempt: number;
    readonly workerId: string;
    readonly leaseDurationMs: number;
  }): Promise<ChessAnalysisJobWorkerClaimResult>;
}

export type ChessAnalysisJobMutationAction =
  'start' | 'progress' | 'complete' | 'fail' | 'cancel' | 'retry';

export interface AuthenticatedChessAnalysisRequesterContext {
  /** Opaque credential/session reference. It is never treated as an actor or tenant id. */
  readonly authenticationId: string;
}

export interface ChessAnalysisJobRequesterAccess {
  readonly tenantPartition: string;
  readonly actorId: string;
}

export type ChessAnalysisJobRequesterAuthorizationDecision =
  | { readonly allowed: true; readonly access: ChessAnalysisJobRequesterAccess }
  | { readonly allowed: false };

export interface ChessAnalysisJobRequesterAuthorizationPort {
  authorize(input: {
    readonly action: 'submit' | 'cancel' | 'retry';
    readonly context: AuthenticatedChessAnalysisRequesterContext;
  }): Promise<ChessAnalysisJobRequesterAuthorizationDecision>;
}

export type ChessAnalysisJobMutationPrincipal =
  | {
      readonly kind: 'requester';
      readonly context: AuthenticatedChessAnalysisRequesterContext;
    }
  | {
      readonly kind: 'worker';
      readonly tenantPartition: string;
      readonly workerId: string;
      readonly claimToken: string;
      readonly leaseId: string;
    };

export interface ChessAnalysisJobAuthorizationPort {
  authorize(input: {
    readonly action: 'start' | 'progress' | 'complete' | 'fail';
    readonly principal: Extract<ChessAnalysisJobMutationPrincipal, { readonly kind: 'worker' }>;
    readonly job: ChessAnalysisJob;
  }): Promise<boolean>;
}

export interface ChessAnalysisJobClockPort {
  nowMs(): number;
}

export interface ChessAnalysisJobIdPort {
  nextId(): string;
}
