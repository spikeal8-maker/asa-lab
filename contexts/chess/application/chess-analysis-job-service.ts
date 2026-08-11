import { parseFen, toFen } from '../domain/chess.js';
import { chessCapabilityDecision, type ChessSessionPolicy } from '../domain/fair-play.js';
import type { ChessEngineAnalysis, ChessEngineQuota } from './engine-contract.js';
import {
  buildChessAnalysisJobFingerprint,
  cancelChessAnalysisJob,
  completeChessAnalysisJob,
  createQueuedChessAnalysisJob,
  failChessAnalysisJob,
  progressChessAnalysisJob,
  retryChessAnalysisJob,
  startChessAnalysisJob,
  type ChessAnalysisJob,
  type ChessAnalysisJobFailure,
  type ChessAnalysisJobProgress,
  type ChessAnalysisJobRequest,
  type ChessAnalysisJobTransitionResult,
} from './chess-analysis-job.js';
import type {
  ChessAnalysisJobClockPort,
  ChessAnalysisJobIdPort,
  ChessAnalysisJobQueuePort,
  ChessAnalysisJobRepositoryPort,
} from './chess-analysis-job-ports.js';

const SAFE_KEY = /^[A-Za-z0-9._:-]{1,160}$/;

export interface ChessAnalysisJobQuota extends ChessEngineQuota {
  readonly maxAttempts: number;
}

export interface SubmitChessAnalysisJobCommand {
  readonly tenantPartition: string;
  readonly requestedBy: string;
  readonly idempotencyKey: string;
  readonly request: ChessAnalysisJobRequest;
}

export interface ChessAnalysisJobMutationCommand {
  readonly tenantPartition: string;
  readonly jobId: string;
  readonly expectedVersion: number;
  /** Re-authorized before any repository access, then matched to the stored job. */
  readonly policy: ChessSessionPolicy;
}

export type ChessAnalysisJobServiceErrorCode =
  | 'capability_denied'
  | 'validation_error'
  | 'idempotency_conflict'
  | 'not_found'
  | 'conflict'
  | 'invalid_transition'
  | 'attempts_exhausted'
  | 'queue_failure';

export type ChessAnalysisJobServiceResult =
  | { readonly ok: true; readonly value: ChessAnalysisJob; readonly replayed: boolean }
  | {
      readonly ok: false;
      readonly code: ChessAnalysisJobServiceErrorCode;
      readonly message: string;
    };

function failed(
  code: ChessAnalysisJobServiceErrorCode,
  message: string,
): ChessAnalysisJobServiceResult {
  return { ok: false, code, message };
}

function positive(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function validQuota(quota: ChessAnalysisJobQuota): boolean {
  return (
    positive(quota.maxDepth) &&
    positive(quota.maxMoveTimeMs) &&
    positive(quota.maxMultiPv) &&
    positive(quota.maxThreads) &&
    positive(quota.maxHashMb) &&
    positive(quota.maxTimeoutMs) &&
    positive(quota.maxAttempts)
  );
}

function requestProblem(
  request: ChessAnalysisJobRequest,
  quota: ChessAnalysisJobQuota,
): string | null {
  if (!positive(request.timeoutMs) || request.timeoutMs > quota.maxTimeoutMs) {
    return 'Analysis timeout is invalid or exceeds quota.';
  }
  const settings = request.settings;
  if (
    !positive(settings.multiPv) ||
    settings.multiPv > quota.maxMultiPv ||
    !positive(settings.threads) ||
    settings.threads > quota.maxThreads ||
    !positive(settings.hashMb) ||
    settings.hashMb > quota.maxHashMb
  ) {
    return 'Analysis settings are invalid or exceed quota.';
  }
  if (settings.search.kind === 'depth') {
    if (!positive(settings.search.depth) || settings.search.depth > quota.maxDepth) {
      return 'Analysis depth is invalid or exceeds quota.';
    }
  } else if (
    settings.search.kind !== 'move_time' ||
    !positive(settings.search.moveTimeMs) ||
    settings.search.moveTimeMs > quota.maxMoveTimeMs
  ) {
    return 'Analysis move time is invalid or exceeds quota.';
  }
  if (
    settings.mode === 'reproducible' &&
    (settings.search.kind !== 'depth' || settings.threads !== 1)
  ) {
    return 'Reproducible jobs require fixed depth and one thread.';
  }
  return null;
}

function authorized(policy: ChessSessionPolicy): ChessAnalysisJobServiceResult | null {
  const decision = chessCapabilityDecision(policy, 'engine_analysis');
  return decision.allowed ? null : failed('capability_denied', decision.reason);
}

function transitionError(result: Exclude<ChessAnalysisJobTransitionResult, { readonly ok: true }>) {
  return failed(result.code, result.message);
}

export class ChessAnalysisJobService {
  constructor(
    private readonly repository: ChessAnalysisJobRepositoryPort,
    private readonly queue: ChessAnalysisJobQueuePort,
    private readonly clock: ChessAnalysisJobClockPort,
    private readonly ids: ChessAnalysisJobIdPort,
    private readonly quota: ChessAnalysisJobQuota,
  ) {}

  async submit(command: SubmitChessAnalysisJobCommand): Promise<ChessAnalysisJobServiceResult> {
    const denial = authorized(command.request.policy);
    if (denial) return denial;
    if (!validQuota(this.quota))
      return failed('validation_error', 'Analysis job quota is invalid.');
    if (
      !SAFE_KEY.test(command.tenantPartition) ||
      !SAFE_KEY.test(command.requestedBy) ||
      !SAFE_KEY.test(command.idempotencyKey)
    ) {
      return failed('validation_error', 'Tenant, actor and idempotency keys must be safe IDs.');
    }
    const requestIssue = requestProblem(command.request, this.quota);
    if (requestIssue) return failed('validation_error', requestIssue);
    const parsed = parseFen(command.request.fen);
    if (!parsed.ok) return failed('validation_error', parsed.message);
    const request: ChessAnalysisJobRequest = {
      ...command.request,
      fen: toFen(parsed.value),
    };
    const requestFingerprint = buildChessAnalysisJobFingerprint(request);
    const atMs = this.clock.nowMs();
    const job = createQueuedChessAnalysisJob({
      id: this.ids.nextId(),
      tenantPartition: command.tenantPartition,
      requestedBy: command.requestedBy,
      idempotencyKey: command.idempotencyKey,
      requestFingerprint,
      request,
      maxAttempts: this.quota.maxAttempts,
      createdAtMs: atMs,
    });
    const created = await this.repository.create(job);
    if (created.kind === 'existing') {
      return created.job.requestFingerprint === requestFingerprint
        ? { ok: true, value: created.job, replayed: true }
        : failed('idempotency_conflict', 'Idempotency key was used for another request.');
    }
    try {
      await this.queue.enqueue({
        tenantPartition: job.tenantPartition,
        jobId: job.id,
        attempt: job.attempt,
        jobVersion: job.version,
      });
    } catch (error) {
      const transition = failChessAnalysisJob(
        job,
        {
          code: 'queue_failure',
          message: error instanceof Error ? error.message : 'Queue rejected the job.',
          retryable: true,
        },
        this.clock.nowMs(),
      );
      if (transition.ok) await this.repository.save(transition.value, job.version);
      return failed('queue_failure', 'Analysis job could not be queued.');
    }
    return { ok: true, value: job, replayed: false };
  }

  private async transition(
    command: ChessAnalysisJobMutationCommand,
    apply: (job: ChessAnalysisJob, atMs: number) => ChessAnalysisJobTransitionResult,
  ): Promise<ChessAnalysisJobServiceResult> {
    const denial = authorized(command.policy);
    if (denial) return denial;
    if (
      !SAFE_KEY.test(command.tenantPartition) ||
      !SAFE_KEY.test(command.jobId) ||
      !positive(command.expectedVersion)
    ) {
      return failed('validation_error', 'Job reference is invalid.');
    }
    const job = await this.repository.get(command.tenantPartition, command.jobId);
    if (!job) return failed('not_found', 'Analysis job was not found.');
    if (job.request.policy !== command.policy) {
      return failed('validation_error', 'Mutation policy does not match the stored job.');
    }
    if (job.version !== command.expectedVersion) {
      return failed('conflict', 'Analysis job changed concurrently.');
    }
    const transitioned = apply(job, this.clock.nowMs());
    if (!transitioned.ok) return transitionError(transitioned);
    const stored = await this.repository.save(transitioned.value, command.expectedVersion);
    if (stored !== 'saved') return failed(stored, 'Analysis job changed concurrently.');
    return { ok: true, value: transitioned.value, replayed: false };
  }

  start(command: ChessAnalysisJobMutationCommand): Promise<ChessAnalysisJobServiceResult> {
    return this.transition(command, startChessAnalysisJob);
  }

  progress(
    command: ChessAnalysisJobMutationCommand,
    progress: Omit<ChessAnalysisJobProgress, 'updatedAtMs'>,
  ): Promise<ChessAnalysisJobServiceResult> {
    return this.transition(command, (job, atMs) => progressChessAnalysisJob(job, progress, atMs));
  }

  complete(
    command: ChessAnalysisJobMutationCommand,
    result: ChessEngineAnalysis,
  ): Promise<ChessAnalysisJobServiceResult> {
    return this.transition(command, (job, atMs) => completeChessAnalysisJob(job, result, atMs));
  }

  fail(
    command: ChessAnalysisJobMutationCommand,
    failure: Omit<ChessAnalysisJobFailure, 'failedAtMs'>,
  ): Promise<ChessAnalysisJobServiceResult> {
    return this.transition(command, (job, atMs) => failChessAnalysisJob(job, failure, atMs));
  }

  async cancel(
    command: ChessAnalysisJobMutationCommand,
    requestedBy: string,
    reason: string | null,
  ): Promise<ChessAnalysisJobServiceResult> {
    if (!SAFE_KEY.test(requestedBy))
      return failed('validation_error', 'Cancellation actor is invalid.');
    const result = await this.transition(command, (job, atMs) =>
      cancelChessAnalysisJob(job, { requestedBy, reason }, atMs),
    );
    if (result.ok) await this.queue.cancel(command.tenantPartition, command.jobId);
    return result;
  }

  async retry(command: ChessAnalysisJobMutationCommand): Promise<ChessAnalysisJobServiceResult> {
    const result = await this.transition(command, retryChessAnalysisJob);
    if (!result.ok) return result;
    try {
      await this.queue.enqueue({
        tenantPartition: result.value.tenantPartition,
        jobId: result.value.id,
        attempt: result.value.attempt,
        jobVersion: result.value.version,
      });
      return result;
    } catch (error) {
      const failedRetry = failChessAnalysisJob(
        result.value,
        {
          code: 'queue_failure',
          message: error instanceof Error ? error.message : 'Queue rejected the retry.',
          retryable: true,
        },
        this.clock.nowMs(),
      );
      if (failedRetry.ok) await this.repository.save(failedRetry.value, result.value.version);
      return failed('queue_failure', 'Analysis retry could not be queued.');
    }
  }
}
