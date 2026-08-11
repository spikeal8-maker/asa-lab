import {
  applyMoveUnchecked,
  findLegalMoveByUci,
  generateLegalMoves,
  parseFen,
  toFen,
} from '../domain/chess.js';
import { chessCapabilityDecision, type ChessSessionPolicy } from '../domain/fair-play.js';
import {
  CHESS_ENGINE_ANALYSIS_SCHEMA_VERSION,
  buildChessEngineCacheKey,
  type ChessEngineAnalysis,
  type ChessEngineLine,
  type ChessEngineQuota,
  type ChessEngineSettings,
} from './engine-contract.js';
import {
  buildChessAnalysisJobFingerprint,
  cancelChessAnalysisJob,
  completeChessAnalysisJob,
  createDispatchingChessAnalysisJob,
  failChessAnalysisJob,
  immutableChessAnalysisJob,
  progressChessAnalysisJob,
  queueChessAnalysisJob,
  retryChessAnalysisJob,
  startChessAnalysisJob,
  type ChessAnalysisJob,
  type ChessAnalysisJobFailure,
  type ChessAnalysisJobProgress,
  type ChessAnalysisJobRequest,
  type ChessAnalysisJobTransitionResult,
} from './chess-analysis-job.js';
import type {
  ChessAnalysisJobAuthorizationPort,
  ChessAnalysisJobClockPort,
  ChessAnalysisJobIdPort,
  ChessAnalysisJobMutationAction,
  ChessAnalysisJobMutationPrincipal,
  ChessAnalysisJobQueuePort,
  ChessAnalysisJobRepositoryPort,
} from './chess-analysis-job-ports.js';

const SAFE_KEY = /^[A-Za-z0-9._:-]{1,160}$/;
const SHA256 = /^[a-f0-9]{64}$/;

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
  /** Re-authorized before repository access, then matched to the stored job. */
  readonly policy: ChessSessionPolicy;
  readonly principal: ChessAnalysisJobMutationPrincipal;
}

export type ChessAnalysisJobServiceErrorCode =
  | 'capability_denied'
  | 'authorization_denied'
  | 'validation_error'
  | 'idempotency_conflict'
  | 'not_found'
  | 'conflict'
  | 'invalid_transition'
  | 'attempts_exhausted'
  | 'invalid_output'
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

function nonNegative(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
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
    typeof settings !== 'object' ||
    settings === null ||
    !positive(settings.multiPv) ||
    settings.multiPv > quota.maxMultiPv ||
    !positive(settings.threads) ||
    settings.threads > quota.maxThreads ||
    !positive(settings.hashMb) ||
    settings.hashMb > quota.maxHashMb ||
    (settings.mode !== 'reproducible' && settings.mode !== 'interactive')
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
  try {
    const decision = chessCapabilityDecision(policy, 'engine_analysis');
    return decision.allowed ? null : failed('capability_denied', decision.reason);
  } catch {
    return failed('validation_error', 'Analysis policy is invalid.');
  }
}

function transitionError(result: Exclude<ChessAnalysisJobTransitionResult, { readonly ok: true }>) {
  return failed(result.code, result.message);
}

function principalProblem(
  principal: ChessAnalysisJobMutationPrincipal,
  action: ChessAnalysisJobMutationAction,
): string | null {
  if (principal.kind === 'requester') {
    if (!SAFE_KEY.test(principal.actorId)) return 'Requester identity is invalid.';
    return action === 'cancel' || action === 'retry'
      ? null
      : 'A requester cannot perform worker mutations.';
  }
  if (!SAFE_KEY.test(principal.workerId) || !SAFE_KEY.test(principal.claimToken)) {
    return 'Worker identity or queue claim is invalid.';
  }
  return action === 'start' || action === 'progress' || action === 'complete' || action === 'fail'
    ? null
    : 'A worker cannot perform requester mutations.';
}

function settingsEqual(left: ChessEngineSettings, right: ChessEngineSettings): boolean {
  if (
    left.multiPv !== right.multiPv ||
    left.threads !== right.threads ||
    left.hashMb !== right.hashMb ||
    left.mode !== right.mode ||
    left.search.kind !== right.search.kind
  ) {
    return false;
  }
  return left.search.kind === 'depth'
    ? right.search.kind === 'depth' && left.search.depth === right.search.depth
    : right.search.kind === 'move_time' && left.search.moveTimeMs === right.search.moveTimeMs;
}

function copySettings(settings: ChessEngineSettings): ChessEngineSettings {
  return {
    search:
      settings.search.kind === 'depth'
        ? { kind: 'depth', depth: settings.search.depth }
        : { kind: 'move_time', moveTimeMs: settings.search.moveTimeMs },
    multiPv: settings.multiPv,
    threads: settings.threads,
    hashMb: settings.hashMb,
    mode: settings.mode,
  };
}

function scoreProblem(line: ChessEngineLine): string | null {
  if (typeof line.score !== 'object' || line.score === null) return 'Engine score is missing.';
  if (line.score.kind === 'centipawn') {
    return Number.isSafeInteger(line.score.valueCp) && line.score.perspective === 'white'
      ? null
      : 'Centipawn score must be a finite integer from White perspective.';
  }
  if (line.score.kind !== 'mate') return 'Unknown engine score kind.';
  if (line.score.winner !== 'white' && line.score.winner !== 'black') {
    return 'Mate score must identify a winner.';
  }
  return line.score.distancePly === null || positive(line.score.distancePly)
    ? null
    : 'Mate distance must be null or a positive ply count.';
}

function analysisProblem(
  analysis: ChessEngineAnalysis,
  request: ChessAnalysisJobRequest,
): string | null {
  if (typeof analysis !== 'object' || analysis === null) {
    return 'Analysis output has an invalid shape.';
  }
  if (typeof analysis.fen !== 'string') return 'Analysis FEN is invalid.';
  const parsed = parseFen(analysis.fen);
  if (!parsed.ok || analysis.fen !== request.fen || toFen(parsed.value) !== request.fen) {
    return 'Analysis FEN does not match the canonical requested position.';
  }
  if (
    typeof analysis.settings !== 'object' ||
    analysis.settings === null ||
    typeof analysis.settings.search !== 'object' ||
    analysis.settings.search === null ||
    !settingsEqual(analysis.settings, request.settings)
  ) {
    return 'Analysis settings do not match the request.';
  }
  const engine = analysis.engine;
  if (
    typeof engine !== 'object' ||
    engine === null ||
    typeof engine.name !== 'string' ||
    engine.name.length === 0 ||
    engine.name.length > 128 ||
    engine.name !== engine.name.trim() ||
    typeof engine.version !== 'string' ||
    engine.version.length === 0 ||
    engine.version.length > 128 ||
    engine.version !== engine.version.trim() ||
    (engine.protocol !== 'internal' && engine.protocol !== 'uci') ||
    (engine.binarySha256 !== null && typeof engine.binarySha256 !== 'string') ||
    (engine.binarySha256 !== null && !SHA256.test(engine.binarySha256)) ||
    (engine.networkSha256 !== null && typeof engine.networkSha256 !== 'string') ||
    (engine.networkSha256 !== null && !SHA256.test(engine.networkSha256))
  ) {
    return 'Analysis engine identity is invalid.';
  }
  let expectedCacheKey: string;
  try {
    expectedCacheKey = buildChessEngineCacheKey({
      fen: request.fen,
      engine,
      settings: request.settings,
    });
  } catch {
    return 'Analysis metadata has an invalid shape.';
  }
  if (
    analysis.schemaVersion !== CHESS_ENGINE_ANALYSIS_SCHEMA_VERSION ||
    typeof analysis.cacheKey !== 'string' ||
    analysis.cacheKey !== expectedCacheKey ||
    !Array.isArray(analysis.lines) ||
    !nonNegative(analysis.depth) ||
    !nonNegative(analysis.nodes) ||
    !Number.isFinite(analysis.durationMs) ||
    analysis.durationMs < 0
  ) {
    return 'Analysis metadata or statistics are invalid.';
  }
  const rootMoves = generateLegalMoves(parsed.value);
  if (rootMoves.length === 0) {
    return analysis.lines.length === 0 ? null : 'A terminal position cannot contain engine lines.';
  }
  if (
    analysis.depth === 0 ||
    analysis.lines.length === 0 ||
    analysis.lines.length > Math.min(request.settings.multiPv, rootMoves.length)
  ) {
    return 'Analysis line count or depth does not match the request.';
  }
  const roots = new Set<string>();
  for (const [index, line] of analysis.lines.entries()) {
    if (typeof line !== 'object' || line === null || line.rank !== index + 1) {
      return 'MultiPV ranks must be contiguous and one-based.';
    }
    const scoreIssue = scoreProblem(line);
    if (scoreIssue) return scoreIssue;
    if (!Array.isArray(line.movesUci) || line.movesUci.length === 0) {
      return 'Every engine line must contain a principal variation.';
    }
    const root = line.movesUci[0];
    if (typeof root !== 'string' || roots.has(root)) {
      return 'MultiPV lines must have distinct root moves.';
    }
    roots.add(root);
    let cursor = parsed.value;
    for (const uci of line.movesUci) {
      if (typeof uci !== 'string') return 'Principal variation moves must be UCI strings.';
      const move = findLegalMoveByUci(cursor, uci);
      if (!move) return `Analysis line contains illegal move ${uci}.`;
      cursor = applyMoveUnchecked(cursor, move);
    }
  }
  return null;
}

function queueFailureMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export class ChessAnalysisJobService {
  constructor(
    private readonly repository: ChessAnalysisJobRepositoryPort,
    private readonly queue: ChessAnalysisJobQueuePort,
    private readonly authorization: ChessAnalysisJobAuthorizationPort,
    private readonly clock: ChessAnalysisJobClockPort,
    private readonly ids: ChessAnalysisJobIdPort,
    private readonly quota: ChessAnalysisJobQuota,
  ) {}

  private async compensateDispatchFailure(
    job: ChessAnalysisJob,
    error: unknown,
  ): Promise<ChessAnalysisJobServiceResult> {
    const transition = failChessAnalysisJob(
      job,
      {
        code: 'queue_failure',
        message: queueFailureMessage(error, 'Queue rejected the analysis job.'),
        retryable: true,
      },
      this.clock.nowMs(),
    );
    if (!transition.ok) return transitionError(transition);
    const stored = await this.repository.save(transition.value, job.version);
    if (stored !== 'saved') {
      return failed(stored, 'Analysis job changed during queue failure compensation.');
    }
    return failed('queue_failure', 'Analysis job could not be queued.');
  }

  private async dispatch(
    job: ChessAnalysisJob,
    replayed = false,
  ): Promise<ChessAnalysisJobServiceResult> {
    const queued = queueChessAnalysisJob(job, this.clock.nowMs());
    if (!queued.ok) return transitionError(queued);
    try {
      await this.queue.enqueue({
        tenantPartition: job.tenantPartition,
        jobId: job.id,
        attempt: job.attempt,
        jobVersion: queued.value.version,
      });
    } catch (error) {
      return this.compensateDispatchFailure(job, error);
    }
    const stored = await this.repository.save(queued.value, job.version);
    if (stored === 'saved') {
      return { ok: true, value: immutableChessAnalysisJob(queued.value), replayed };
    }
    if (stored === 'conflict') {
      const current = await this.repository.get(job.tenantPartition, job.id);
      if (
        current?.attempt === queued.value.attempt &&
        current.version >= queued.value.version &&
        current.status !== 'dispatching' &&
        !(current.status === 'failed' && current.failure?.code === 'queue_failure')
      ) {
        return { ok: true, value: immutableChessAnalysisJob(current), replayed: true };
      }
    }
    try {
      await this.queue.cancel(job.tenantPartition, job.id, job.attempt);
    } catch (error) {
      return failed(
        'queue_failure',
        `Queue dispatch rollback failed: ${queueFailureMessage(error, 'unknown queue error')}`,
      );
    }
    return failed(stored, 'Analysis job changed before queue dispatch was confirmed.');
  }

  async submit(command: SubmitChessAnalysisJobCommand): Promise<ChessAnalysisJobServiceResult> {
    const denial = authorized(command.request.policy);
    if (denial) return denial;
    if (!validQuota(this.quota)) {
      return failed('validation_error', 'Analysis job quota is invalid.');
    }
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
      fen: toFen(parsed.value),
      policy: command.request.policy,
      settings: copySettings(command.request.settings),
      timeoutMs: command.request.timeoutMs,
    };
    const requestFingerprint = buildChessAnalysisJobFingerprint(request);
    const atMs = this.clock.nowMs();
    const job = createDispatchingChessAnalysisJob({
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
    if (created.kind === 'id_conflict') {
      return failed('conflict', 'Generated analysis job ID already exists.');
    }
    if (created.kind === 'existing') {
      if (created.job.requestedBy !== command.requestedBy) {
        return failed('authorization_denied', 'Idempotent analysis job belongs to another actor.');
      }
      if (created.job.requestFingerprint !== requestFingerprint) {
        return failed('idempotency_conflict', 'Idempotency key was used for another request.');
      }
      if (created.job.status === 'dispatching') {
        return this.dispatch(created.job, true);
      }
      return { ok: true, value: immutableChessAnalysisJob(created.job), replayed: true };
    }
    return this.dispatch(created.job);
  }

  private async transition(
    command: ChessAnalysisJobMutationCommand,
    action: ChessAnalysisJobMutationAction,
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
    const principalIssue = principalProblem(command.principal, action);
    if (principalIssue) return failed('authorization_denied', principalIssue);
    const loaded = await this.repository.get(command.tenantPartition, command.jobId);
    if (!loaded) return failed('not_found', 'Analysis job was not found.');
    const job = immutableChessAnalysisJob(loaded);
    if (job.request.policy !== command.policy) {
      return failed('validation_error', 'Mutation policy does not match the stored job.');
    }
    let allowed: boolean;
    try {
      allowed = await this.authorization.authorize({ action, principal: command.principal, job });
    } catch {
      return failed('authorization_denied', 'Analysis job authorization could not be verified.');
    }
    if (!allowed) return failed('authorization_denied', 'Analysis job claim is not authorized.');
    if (job.version !== command.expectedVersion) {
      return failed('conflict', 'Analysis job changed concurrently.');
    }
    const transitioned = apply(job, this.clock.nowMs());
    if (!transitioned.ok) return transitionError(transitioned);
    const stored = await this.repository.save(transitioned.value, command.expectedVersion);
    if (stored !== 'saved') return failed(stored, 'Analysis job changed concurrently.');
    return { ok: true, value: immutableChessAnalysisJob(transitioned.value), replayed: false };
  }

  start(command: ChessAnalysisJobMutationCommand): Promise<ChessAnalysisJobServiceResult> {
    return this.transition(command, 'start', startChessAnalysisJob);
  }

  progress(
    command: ChessAnalysisJobMutationCommand,
    progress: Omit<ChessAnalysisJobProgress, 'updatedAtMs'>,
  ): Promise<ChessAnalysisJobServiceResult> {
    return this.transition(command, 'progress', (job, atMs) =>
      progressChessAnalysisJob(job, progress, atMs),
    );
  }

  async complete(
    command: ChessAnalysisJobMutationCommand,
    result: ChessEngineAnalysis,
  ): Promise<ChessAnalysisJobServiceResult> {
    let invalidOutput: string | null = null;
    const completed = await this.transition(command, 'complete', (job, atMs) => {
      invalidOutput = analysisProblem(result, job.request);
      return invalidOutput
        ? failChessAnalysisJob(
            job,
            { code: 'invalid_output', message: invalidOutput, retryable: false },
            atMs,
          )
        : completeChessAnalysisJob(job, result, atMs);
    });
    if (completed.ok && invalidOutput) return failed('invalid_output', invalidOutput);
    return completed;
  }

  fail(
    command: ChessAnalysisJobMutationCommand,
    failure: Omit<ChessAnalysisJobFailure, 'failedAtMs'>,
  ): Promise<ChessAnalysisJobServiceResult> {
    return this.transition(command, 'fail', (job, atMs) =>
      failChessAnalysisJob(job, failure, atMs),
    );
  }

  async cancel(
    command: ChessAnalysisJobMutationCommand,
    reason: string | null,
  ): Promise<ChessAnalysisJobServiceResult> {
    if (command.principal.kind !== 'requester') {
      return failed('authorization_denied', 'Only an authenticated requester can cancel a job.');
    }
    const actorId = command.principal.actorId;
    const result = await this.transition(command, 'cancel', (job, atMs) =>
      cancelChessAnalysisJob(job, { requestedBy: actorId, reason: structuredClone(reason) }, atMs),
    );
    if (!result.ok) return result;
    try {
      await this.queue.cancel(command.tenantPartition, command.jobId);
    } catch (error) {
      return failed(
        'queue_failure',
        `Analysis job is cancelled, but its queue claim could not be removed: ${queueFailureMessage(
          error,
          'unknown queue error',
        )}`,
      );
    }
    return result;
  }

  async retry(command: ChessAnalysisJobMutationCommand): Promise<ChessAnalysisJobServiceResult> {
    const result = await this.transition(command, 'retry', retryChessAnalysisJob);
    if (!result.ok) return result;
    return this.dispatch(result.value);
  }
}
