import type { ChessEngineAnalysis, ChessEngineSettings } from './engine-contract.js';
import type { ChessSessionPolicy } from '../domain/fair-play.js';

export type ChessAnalysisJobStatus =
  'dispatching' | 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface ChessAnalysisJobRequest {
  readonly fen: string;
  readonly policy: ChessSessionPolicy;
  readonly settings: ChessEngineSettings;
  readonly timeoutMs: number;
}

export interface ChessAnalysisJobProgress {
  readonly stage: 'dispatching' | 'queued' | 'starting' | 'analysing' | 'persisting' | 'completed';
  readonly completedUnits: number;
  readonly totalUnits: number;
  readonly message: string | null;
  readonly updatedAtMs: number;
}

export interface ChessAnalysisJobFailure {
  readonly code:
    | 'queue_failure'
    | 'engine_failure'
    | 'timeout'
    | 'invalid_output'
    | 'persistence_failure'
    | 'internal_failure';
  readonly message: string;
  readonly retryable: boolean;
  readonly failedAtMs: number;
}

export interface ChessAnalysisJobCancellation {
  readonly requestedBy: string;
  readonly reason: string | null;
  readonly cancelledAtMs: number;
}

export interface ChessAnalysisJob {
  readonly id: string;
  readonly tenantPartition: string;
  readonly requestedBy: string;
  readonly idempotencyKey: string;
  readonly requestFingerprint: string;
  readonly request: ChessAnalysisJobRequest;
  readonly status: ChessAnalysisJobStatus;
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly version: number;
  readonly progress: ChessAnalysisJobProgress;
  readonly result: ChessEngineAnalysis | null;
  readonly failure: ChessAnalysisJobFailure | null;
  readonly cancellation: ChessAnalysisJobCancellation | null;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
}

export type ChessAnalysisJobTransitionResult =
  | { readonly ok: true; readonly value: ChessAnalysisJob }
  | {
      readonly ok: false;
      readonly code: 'invalid_transition' | 'validation_error' | 'attempts_exhausted';
      readonly message: string;
    };

function rejected(
  code: 'invalid_transition' | 'validation_error' | 'attempts_exhausted',
  message: string,
): ChessAnalysisJobTransitionResult {
  return { ok: false, code, message };
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  if (seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function immutableCopy<T>(value: T): T {
  return deepFreeze(structuredClone(value));
}

export function immutableChessAnalysisJob(job: ChessAnalysisJob): ChessAnalysisJob {
  return immutableCopy(job);
}

function next(
  job: ChessAnalysisJob,
  atMs: number,
  values: Partial<ChessAnalysisJob>,
): ChessAnalysisJobTransitionResult {
  if (!Number.isSafeInteger(atMs) || atMs < job.updatedAtMs) {
    return rejected('validation_error', 'Transition time cannot move backwards.');
  }
  return {
    ok: true,
    value: immutableCopy({ ...job, ...values, version: job.version + 1, updatedAtMs: atMs }),
  };
}

interface CreateChessAnalysisJobInput {
  readonly id: string;
  readonly tenantPartition: string;
  readonly requestedBy: string;
  readonly idempotencyKey: string;
  readonly requestFingerprint: string;
  readonly request: ChessAnalysisJobRequest;
  readonly maxAttempts: number;
  readonly createdAtMs: number;
}

function createInitialChessAnalysisJob(
  input: CreateChessAnalysisJobInput,
  status: 'dispatching' | 'queued',
): ChessAnalysisJob {
  return immutableCopy({
    ...input,
    status,
    attempt: 1,
    version: 1,
    progress: {
      stage: status,
      completedUnits: 0,
      totalUnits: 1,
      message: null,
      updatedAtMs: input.createdAtMs,
    },
    result: null,
    failure: null,
    cancellation: null,
    updatedAtMs: input.createdAtMs,
  });
}

export function createDispatchingChessAnalysisJob(
  input: CreateChessAnalysisJobInput,
): ChessAnalysisJob {
  return createInitialChessAnalysisJob(input, 'dispatching');
}

/**
 * @deprecated Compatibility tombstone for the current package index. The unsafe queued
 * constructor is intentionally unavailable; the package-level export can be removed separately.
 */
export function createQueuedChessAnalysisJob(_input: CreateChessAnalysisJobInput): never {
  void _input;
  throw new Error('Queued analysis jobs can only be created through ChessAnalysisJobService.');
}

export function queueChessAnalysisJob(
  job: ChessAnalysisJob,
  atMs: number,
): ChessAnalysisJobTransitionResult {
  if (job.status !== 'dispatching') {
    return rejected('invalid_transition', 'Only dispatching jobs can become queued.');
  }
  return next(job, atMs, {
    status: 'queued',
    progress: {
      stage: 'queued',
      completedUnits: 0,
      totalUnits: 1,
      message: null,
      updatedAtMs: atMs,
    },
  });
}

export function startChessAnalysisJob(
  job: ChessAnalysisJob,
  atMs: number,
): ChessAnalysisJobTransitionResult {
  if (job.status !== 'queued') return rejected('invalid_transition', 'Only queued jobs can start.');
  return next(job, atMs, {
    status: 'running',
    progress: {
      stage: 'starting',
      completedUnits: 0,
      totalUnits: 1,
      message: null,
      updatedAtMs: atMs,
    },
  });
}

export function progressChessAnalysisJob(
  job: ChessAnalysisJob,
  progress: Omit<ChessAnalysisJobProgress, 'updatedAtMs'>,
  atMs: number,
): ChessAnalysisJobTransitionResult {
  if (job.status !== 'running') {
    return rejected('invalid_transition', 'Only running jobs can report progress.');
  }
  if (
    !Number.isSafeInteger(progress.completedUnits) ||
    !Number.isSafeInteger(progress.totalUnits) ||
    progress.totalUnits <= 0 ||
    progress.completedUnits < 0 ||
    progress.completedUnits > progress.totalUnits
  ) {
    return rejected('validation_error', 'Progress units are invalid.');
  }
  const stageOrder: Readonly<Record<ChessAnalysisJobProgress['stage'], number>> = {
    dispatching: 0,
    queued: 1,
    starting: 2,
    analysing: 3,
    persisting: 4,
    completed: 5,
  };
  if (
    progress.stage === 'dispatching' ||
    progress.stage === 'queued' ||
    progress.stage === 'completed' ||
    stageOrder[progress.stage] < stageOrder[job.progress.stage] ||
    (progress.stage === job.progress.stage &&
      (progress.totalUnits !== job.progress.totalUnits ||
        progress.completedUnits < job.progress.completedUnits))
  ) {
    return rejected('validation_error', 'Progress cannot move backwards.');
  }
  return next(job, atMs, { progress: { ...progress, updatedAtMs: atMs } });
}

export function completeChessAnalysisJob(
  job: ChessAnalysisJob,
  result: ChessEngineAnalysis,
  atMs: number,
): ChessAnalysisJobTransitionResult {
  if (job.status !== 'running') {
    return rejected('invalid_transition', 'Only running jobs can complete.');
  }
  return next(job, atMs, {
    status: 'succeeded',
    result,
    failure: null,
    progress: {
      stage: 'completed',
      completedUnits: 1,
      totalUnits: 1,
      message: null,
      updatedAtMs: atMs,
    },
  });
}

export function failChessAnalysisJob(
  job: ChessAnalysisJob,
  failure: Omit<ChessAnalysisJobFailure, 'failedAtMs'>,
  atMs: number,
): ChessAnalysisJobTransitionResult {
  if (job.status !== 'dispatching' && job.status !== 'queued' && job.status !== 'running') {
    return rejected('invalid_transition', 'Only dispatching, queued or running jobs can fail.');
  }
  return next(job, atMs, {
    status: 'failed',
    failure: { ...failure, failedAtMs: atMs },
    result: null,
  });
}

export function cancelChessAnalysisJob(
  job: ChessAnalysisJob,
  cancellation: Omit<ChessAnalysisJobCancellation, 'cancelledAtMs'>,
  atMs: number,
): ChessAnalysisJobTransitionResult {
  if (job.status !== 'dispatching' && job.status !== 'queued' && job.status !== 'running') {
    return rejected('invalid_transition', 'Only dispatching, queued or running jobs can cancel.');
  }
  return next(job, atMs, {
    status: 'cancelled',
    cancellation: { ...cancellation, cancelledAtMs: atMs },
    result: null,
    failure: null,
  });
}

export function retryChessAnalysisJob(
  job: ChessAnalysisJob,
  atMs: number,
): ChessAnalysisJobTransitionResult {
  if (job.status !== 'failed') return rejected('invalid_transition', 'Only failed jobs can retry.');
  if (!job.failure?.retryable || job.attempt >= job.maxAttempts) {
    return rejected(
      'attempts_exhausted',
      'The job is not retryable or has exhausted its attempts.',
    );
  }
  return next(job, atMs, {
    status: 'dispatching',
    attempt: job.attempt + 1,
    failure: null,
    cancellation: null,
    result: null,
    progress: {
      stage: 'dispatching',
      completedUnits: 0,
      totalUnits: 1,
      message: null,
      updatedAtMs: atMs,
    },
  });
}

export function buildChessAnalysisJobFingerprint(request: ChessAnalysisJobRequest): string {
  const search =
    request.settings.search.kind === 'depth'
      ? ['depth', request.settings.search.depth]
      : ['move_time', request.settings.search.moveTimeMs];
  return JSON.stringify([
    'asa-chess-analysis-job',
    1,
    request.fen,
    request.policy,
    [
      search,
      request.settings.multiPv,
      request.settings.threads,
      request.settings.hashMb,
      request.settings.mode,
    ],
    request.timeoutMs,
  ]);
}
