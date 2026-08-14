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
  ChessAnalysisJobRequesterAccess,
  ChessAnalysisJobRequesterAuthorizationPort,
  AuthenticatedChessAnalysisRequesterContext,
} from './chess-analysis-job-ports.js';

const SAFE_KEY = /^[A-Za-z0-9._:-]{1,160}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const ANALYSIS_KEYS = new Set([
  'schemaVersion',
  'fen',
  'engine',
  'settings',
  'cacheKey',
  'lines',
  'depth',
  'nodes',
  'durationMs',
]);
const ENGINE_KEYS = new Set(['name', 'version', 'protocol', 'binarySha256', 'networkSha256']);
const SETTINGS_KEYS = new Set(['search', 'multiPv', 'threads', 'hashMb', 'mode']);
const DEPTH_SEARCH_KEYS = new Set(['kind', 'depth']);
const MOVE_TIME_SEARCH_KEYS = new Set(['kind', 'moveTimeMs']);
const LINE_KEYS = new Set(['rank', 'score', 'movesUci']);
const CENTIPAWN_SCORE_KEYS = new Set(['kind', 'valueCp', 'perspective']);
const MATE_SCORE_KEYS = new Set(['kind', 'winner', 'distancePly']);
const REQUEST_KEYS = new Set(['fen', 'policy', 'settings', 'timeoutMs']);
const JOB_KEYS = new Set([
  'id',
  'tenantPartition',
  'requestedBy',
  'idempotencyKey',
  'requestFingerprint',
  'request',
  'status',
  'attempt',
  'maxAttempts',
  'version',
  'progress',
  'result',
  'failure',
  'cancellation',
  'createdAtMs',
  'updatedAtMs',
]);
const PROGRESS_KEYS = new Set(['stage', 'completedUnits', 'totalUnits', 'message', 'updatedAtMs']);
const FAILURE_KEYS = new Set(['code', 'message', 'retryable', 'failedAtMs']);
const CANCELLATION_KEYS = new Set(['requestedBy', 'reason', 'cancelledAtMs']);

function isExactRecord(
  value: unknown,
  keys: ReadonlySet<string>,
): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const ownKeys = Object.keys(value);
  if (ownKeys.length !== keys.size || !ownKeys.every((key) => keys.has(key))) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  return ownKeys.every((key) => descriptors[key] && 'value' in descriptors[key]);
}

export interface ChessAnalysisJobQuota extends ChessEngineQuota {
  readonly maxAttempts: number;
  readonly maxPvPly: number;
  readonly maxResultBytes: number;
}

export interface SubmitChessAnalysisJobCommand {
  readonly context: AuthenticatedChessAnalysisRequesterContext;
  readonly idempotencyKey: string;
  readonly request: ChessAnalysisJobRequest;
}

export interface ChessAnalysisJobMutationCommand {
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
    positive(quota.maxAttempts) &&
    positive(quota.maxPvPly) &&
    positive(quota.maxResultBytes)
  );
}

function requestProblem(
  request: ChessAnalysisJobRequest,
  quota: ChessAnalysisJobQuota,
): string | null {
  if (!isExactRecord(request, REQUEST_KEYS) || typeof request.fen !== 'string') {
    return 'Analysis request has an invalid shape.';
  }
  if (!positive(request.timeoutMs) || request.timeoutMs > quota.maxTimeoutMs) {
    return 'Analysis timeout is invalid or exceeds quota.';
  }
  const settings = request.settings;
  if (
    !isExactRecord(settings, SETTINGS_KEYS) ||
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
  if (
    !isExactRecord(settings.search, DEPTH_SEARCH_KEYS) &&
    !isExactRecord(settings.search, MOVE_TIME_SEARCH_KEYS)
  ) {
    return 'Analysis search settings have an invalid shape.';
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
    if (
      typeof principal.context.authenticationId !== 'string' ||
      principal.context.authenticationId.length === 0 ||
      principal.context.authenticationId.length > 512
    ) {
      return 'Requester authentication context is invalid.';
    }
    return action === 'cancel' || action === 'retry'
      ? null
      : 'A requester cannot perform worker mutations.';
  }
  if (
    !SAFE_KEY.test(principal.tenantPartition) ||
    !SAFE_KEY.test(principal.workerId) ||
    !SAFE_KEY.test(principal.claimToken) ||
    !SAFE_KEY.test(principal.leaseId)
  ) {
    return 'Worker identity, partition or queue lease is invalid.';
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
    if (!isExactRecord(line.score, CENTIPAWN_SCORE_KEYS)) {
      return 'Centipawn score contains unsupported fields.';
    }
    return Number.isSafeInteger(line.score.valueCp) && line.score.perspective === 'white'
      ? null
      : 'Centipawn score must be a finite integer from White perspective.';
  }
  if (line.score.kind !== 'mate') return 'Unknown engine score kind.';
  if (!isExactRecord(line.score, MATE_SCORE_KEYS)) {
    return 'Mate score contains unsupported fields.';
  }
  if (line.score.winner !== 'white' && line.score.winner !== 'black') {
    return 'Mate score must identify a winner.';
  }
  return line.score.distancePly === null || positive(line.score.distancePly)
    ? null
    : 'Mate distance must be null or a positive ply count.';
}

type CanonicalAnalysisResult =
  | { readonly ok: true; readonly value: ChessEngineAnalysis }
  | { readonly ok: false; readonly message: string };

function canonicalAnalysis(
  analysis: ChessEngineAnalysis,
  request: ChessAnalysisJobRequest,
  quota: ChessAnalysisJobQuota,
): CanonicalAnalysisResult {
  if (!isExactRecord(analysis, ANALYSIS_KEYS)) {
    return { ok: false, message: 'Analysis output has an invalid or non-canonical shape.' };
  }
  if (typeof analysis.fen !== 'string') return { ok: false, message: 'Analysis FEN is invalid.' };
  const parsed = parseFen(analysis.fen);
  if (!parsed.ok || analysis.fen !== request.fen || toFen(parsed.value) !== request.fen) {
    return {
      ok: false,
      message: 'Analysis FEN does not match the canonical requested position.',
    };
  }
  if (
    !isExactRecord(analysis.settings, SETTINGS_KEYS) ||
    (!isExactRecord(analysis.settings.search, DEPTH_SEARCH_KEYS) &&
      !isExactRecord(analysis.settings.search, MOVE_TIME_SEARCH_KEYS)) ||
    !settingsEqual(analysis.settings, request.settings)
  ) {
    return { ok: false, message: 'Analysis settings do not match the request.' };
  }
  const engine = analysis.engine;
  if (
    !isExactRecord(engine, ENGINE_KEYS) ||
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
    return { ok: false, message: 'Analysis engine identity is invalid.' };
  }
  let expectedCacheKey: string;
  try {
    expectedCacheKey = buildChessEngineCacheKey({
      fen: request.fen,
      engine,
      settings: request.settings,
    });
  } catch {
    return { ok: false, message: 'Analysis metadata has an invalid shape.' };
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
    return { ok: false, message: 'Analysis metadata or statistics are invalid.' };
  }
  const rootMoves = generateLegalMoves(parsed.value);
  if (rootMoves.length === 0) {
    if (analysis.lines.length !== 0) {
      return { ok: false, message: 'A terminal position cannot contain engine lines.' };
    }
  } else if (
    analysis.depth === 0 ||
    analysis.lines.length === 0 ||
    analysis.lines.length > Math.min(request.settings.multiPv, rootMoves.length)
  ) {
    return { ok: false, message: 'Analysis line count or depth does not match the request.' };
  }
  const roots = new Set<string>();
  for (const [index, line] of analysis.lines.entries()) {
    if (!isExactRecord(line, LINE_KEYS) || line.rank !== index + 1) {
      return { ok: false, message: 'MultiPV ranks must be contiguous and one-based.' };
    }
    const canonicalLine = line as unknown as ChessEngineLine;
    const scoreIssue = scoreProblem(canonicalLine);
    if (scoreIssue) return { ok: false, message: scoreIssue };
    if (
      !Array.isArray(line.movesUci) ||
      line.movesUci.length === 0 ||
      line.movesUci.length > quota.maxPvPly
    ) {
      return {
        ok: false,
        message: 'Every engine line must contain a bounded principal variation.',
      };
    }
    const root = line.movesUci[0];
    if (typeof root !== 'string' || roots.has(root)) {
      return { ok: false, message: 'MultiPV lines must have distinct root moves.' };
    }
    roots.add(root);
    let cursor = parsed.value;
    for (const uci of line.movesUci) {
      if (typeof uci !== 'string') {
        return { ok: false, message: 'Principal variation moves must be UCI strings.' };
      }
      const move = findLegalMoveByUci(cursor, uci);
      if (!move) return { ok: false, message: `Analysis line contains illegal move ${uci}.` };
      cursor = applyMoveUnchecked(cursor, move);
    }
  }
  const canonical: ChessEngineAnalysis = {
    schemaVersion: CHESS_ENGINE_ANALYSIS_SCHEMA_VERSION,
    fen: request.fen,
    engine: {
      name: engine.name,
      version: engine.version,
      protocol: engine.protocol,
      binarySha256: engine.binarySha256,
      networkSha256: engine.networkSha256,
    },
    settings: copySettings(request.settings),
    cacheKey: expectedCacheKey,
    lines: analysis.lines.map((line) => ({
      rank: line.rank,
      score:
        line.score.kind === 'centipawn'
          ? {
              kind: 'centipawn',
              valueCp: line.score.valueCp,
              perspective: 'white',
            }
          : {
              kind: 'mate',
              winner: line.score.winner,
              distancePly: line.score.distancePly,
            },
      movesUci: [...line.movesUci],
    })),
    depth: analysis.depth,
    nodes: analysis.nodes,
    durationMs: analysis.durationMs,
  };
  const serializedBytes = new TextEncoder().encode(JSON.stringify(canonical)).byteLength;
  return serializedBytes <= quota.maxResultBytes
    ? { ok: true, value: canonical }
    : { ok: false, message: 'Analysis output exceeds the persisted result byte quota.' };
}

const JOB_STATUSES = new Set([
  'dispatching',
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
]);
const PROGRESS_STAGES = new Set([
  'dispatching',
  'queued',
  'starting',
  'analysing',
  'persisting',
  'completed',
]);
const FAILURE_CODES = new Set([
  'queue_failure',
  'engine_failure',
  'timeout',
  'invalid_output',
  'persistence_failure',
  'internal_failure',
]);

type RepositoryJobValidationResult =
  | { readonly ok: true; readonly value: ChessAnalysisJob }
  | { readonly ok: false; readonly message: string };

function boundedText(value: unknown, maxLength = 1_000): value is string {
  return typeof value === 'string' && value.length <= maxLength;
}

function canonicalRequest(
  value: unknown,
  quota: ChessAnalysisJobQuota,
): { readonly ok: true; readonly value: ChessAnalysisJobRequest } | { readonly ok: false } {
  if (!isExactRecord(value, REQUEST_KEYS)) return { ok: false };
  const request = value as unknown as ChessAnalysisJobRequest;
  if (requestProblem(request, quota)) return { ok: false };
  const parsed = parseFen(request.fen);
  if (!parsed.ok || toFen(parsed.value) !== request.fen) return { ok: false };
  try {
    if (!chessCapabilityDecision(request.policy, 'engine_analysis').allowed) return { ok: false };
  } catch {
    return { ok: false };
  }
  return {
    ok: true,
    value: {
      fen: request.fen,
      policy: request.policy,
      settings: copySettings(request.settings),
      timeoutMs: request.timeoutMs,
    },
  };
}

function validateRepositoryJob(
  value: unknown,
  quota: ChessAnalysisJobQuota,
  expected: {
    readonly tenantPartition: string;
    readonly jobId?: string;
    readonly requestedBy?: string;
    readonly idempotencyKey?: string;
    readonly requestFingerprint?: string;
  },
): RepositoryJobValidationResult {
  try {
    if (!isExactRecord(value, JOB_KEYS)) {
      return { ok: false, message: 'Repository job has a non-canonical shape.' };
    }
    const job = value as unknown as ChessAnalysisJob;
    if (
      !SAFE_KEY.test(job.id) ||
      !SAFE_KEY.test(job.tenantPartition) ||
      !SAFE_KEY.test(job.requestedBy) ||
      !SAFE_KEY.test(job.idempotencyKey) ||
      job.tenantPartition !== expected.tenantPartition ||
      (expected.jobId !== undefined && job.id !== expected.jobId) ||
      (expected.requestedBy !== undefined && job.requestedBy !== expected.requestedBy) ||
      (expected.idempotencyKey !== undefined && job.idempotencyKey !== expected.idempotencyKey) ||
      (expected.requestFingerprint !== undefined &&
        job.requestFingerprint !== expected.requestFingerprint)
    ) {
      return { ok: false, message: 'Repository job identity or private partition is invalid.' };
    }
    const request = canonicalRequest(job.request, quota);
    if (!request.ok || buildChessAnalysisJobFingerprint(request.value) !== job.requestFingerprint) {
      return { ok: false, message: 'Repository job request provenance is invalid.' };
    }
    if (
      !JOB_STATUSES.has(job.status) ||
      !positive(job.attempt) ||
      !positive(job.maxAttempts) ||
      job.attempt > job.maxAttempts ||
      !positive(job.version) ||
      !nonNegative(job.createdAtMs) ||
      !nonNegative(job.updatedAtMs) ||
      job.updatedAtMs < job.createdAtMs ||
      !isExactRecord(job.progress, PROGRESS_KEYS) ||
      !PROGRESS_STAGES.has(job.progress.stage) ||
      !nonNegative(job.progress.completedUnits) ||
      !positive(job.progress.totalUnits) ||
      job.progress.completedUnits > job.progress.totalUnits ||
      (job.progress.message !== null && !boundedText(job.progress.message)) ||
      !nonNegative(job.progress.updatedAtMs) ||
      job.progress.updatedAtMs < job.createdAtMs ||
      job.progress.updatedAtMs > job.updatedAtMs
    ) {
      return { ok: false, message: 'Repository job lifecycle metadata is invalid.' };
    }

    let result: ChessEngineAnalysis | null = null;
    if (job.result !== null) {
      const canonical = canonicalAnalysis(job.result, request.value, quota);
      if (!canonical.ok) return { ok: false, message: canonical.message };
      result = canonical.value;
    }
    if (
      job.failure !== null &&
      (!isExactRecord(job.failure, FAILURE_KEYS) ||
        !FAILURE_CODES.has(job.failure.code) ||
        !boundedText(job.failure.message) ||
        typeof job.failure.retryable !== 'boolean' ||
        !nonNegative(job.failure.failedAtMs) ||
        job.failure.failedAtMs < job.createdAtMs ||
        job.failure.failedAtMs > job.updatedAtMs)
    ) {
      return { ok: false, message: 'Repository job failure is invalid.' };
    }
    if (
      job.cancellation !== null &&
      (!isExactRecord(job.cancellation, CANCELLATION_KEYS) ||
        job.cancellation.requestedBy !== job.requestedBy ||
        (job.cancellation.reason !== null && !boundedText(job.cancellation.reason)) ||
        !nonNegative(job.cancellation.cancelledAtMs) ||
        job.cancellation.cancelledAtMs < job.createdAtMs ||
        job.cancellation.cancelledAtMs > job.updatedAtMs)
    ) {
      return { ok: false, message: 'Repository job cancellation is invalid.' };
    }
    const progressMatchesState =
      (job.status === 'dispatching' && job.progress.stage === 'dispatching') ||
      (job.status === 'queued' && job.progress.stage === 'queued') ||
      (job.status === 'running' &&
        (job.progress.stage === 'starting' ||
          job.progress.stage === 'analysing' ||
          job.progress.stage === 'persisting')) ||
      (job.status === 'succeeded' && job.progress.stage === 'completed') ||
      ((job.status === 'failed' || job.status === 'cancelled') &&
        job.progress.stage !== 'completed');
    const stateIsValid =
      progressMatchesState &&
      ((job.status === 'succeeded' &&
        result !== null &&
        job.failure === null &&
        job.cancellation === null) ||
        (job.status === 'failed' &&
          result === null &&
          job.failure !== null &&
          job.cancellation === null) ||
        (job.status === 'cancelled' &&
          result === null &&
          job.failure === null &&
          job.cancellation !== null) ||
        ((job.status === 'dispatching' || job.status === 'queued' || job.status === 'running') &&
          result === null &&
          job.failure === null &&
          job.cancellation === null));
    if (!stateIsValid)
      return { ok: false, message: 'Repository job state fields are inconsistent.' };

    return {
      ok: true,
      value: immutableChessAnalysisJob({
        ...job,
        request: request.value,
        result,
        failure: job.failure === null ? null : { ...job.failure },
        cancellation: job.cancellation === null ? null : { ...job.cancellation },
        progress: { ...job.progress },
      }),
    };
  } catch {
    return { ok: false, message: 'Repository job could not be validated safely.' };
  }
}

function queueFailureMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export class ChessAnalysisJobService {
  constructor(
    private readonly repository: ChessAnalysisJobRepositoryPort,
    private readonly queue: ChessAnalysisJobQueuePort,
    private readonly requesterAuthorization: ChessAnalysisJobRequesterAuthorizationPort,
    private readonly authorization: ChessAnalysisJobAuthorizationPort,
    private readonly clock: ChessAnalysisJobClockPort,
    private readonly ids: ChessAnalysisJobIdPort,
    private readonly quota: ChessAnalysisJobQuota,
  ) {}

  private async requesterAccess(
    context: AuthenticatedChessAnalysisRequesterContext,
    action: 'submit' | 'cancel' | 'retry',
  ): Promise<
    | { readonly ok: true; readonly value: ChessAnalysisJobRequesterAccess }
    | { readonly ok: false; readonly error: ChessAnalysisJobServiceResult }
  > {
    if (
      typeof context?.authenticationId !== 'string' ||
      context.authenticationId.length === 0 ||
      context.authenticationId.length > 512
    ) {
      return {
        ok: false,
        error: failed('authorization_denied', 'Requester authentication context is invalid.'),
      };
    }
    try {
      const decision = await this.requesterAuthorization.authorize({ action, context });
      if (
        !decision.allowed ||
        !SAFE_KEY.test(decision.access.tenantPartition) ||
        !SAFE_KEY.test(decision.access.actorId)
      ) {
        return {
          ok: false,
          error: failed('authorization_denied', 'Requester access could not be authorized.'),
        };
      }
      return { ok: true, value: { ...decision.access } };
    } catch {
      return {
        ok: false,
        error: failed('authorization_denied', 'Requester access could not be verified.'),
      };
    }
  }

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
      const enqueued = await this.queue.enqueue({
        tenantPartition: job.tenantPartition,
        jobId: job.id,
        attempt: job.attempt,
        jobVersion: queued.value.version,
      });
      if (enqueued.kind === 'conflict') {
        await this.queue.cancel(job.tenantPartition, job.id, job.attempt);
        return this.compensateDispatchFailure(
          job,
          new Error('Queue attempt already exists with another job version.'),
        );
      }
    } catch (error) {
      return this.compensateDispatchFailure(job, error);
    }
    const stored = await this.repository.save(queued.value, job.version);
    if (stored === 'saved') {
      return { ok: true, value: immutableChessAnalysisJob(queued.value), replayed };
    }
    if (stored === 'conflict') {
      const rawCurrent = await this.repository.get(job.tenantPartition, job.id);
      const checkedCurrent = rawCurrent
        ? validateRepositoryJob(rawCurrent, this.quota, {
            tenantPartition: job.tenantPartition,
            jobId: job.id,
            requestedBy: job.requestedBy,
            idempotencyKey: job.idempotencyKey,
            requestFingerprint: job.requestFingerprint,
          })
        : null;
      if (checkedCurrent && !checkedCurrent.ok) {
        try {
          await this.queue.cancel(job.tenantPartition, job.id, job.attempt);
        } catch {
          return failed(
            'queue_failure',
            'Invalid repository state left a queue item to reconcile.',
          );
        }
        return failed('validation_error', checkedCurrent.message);
      }
      const current = checkedCurrent?.ok ? checkedCurrent.value : null;
      if (
        current?.status === 'cancelled' &&
        current.attempt === queued.value.attempt &&
        current.version >= queued.value.version
      ) {
        try {
          await this.queue.cancel(job.tenantPartition, job.id, job.attempt);
        } catch (error) {
          return failed(
            'queue_failure',
            `Cancelled analysis dispatch still needs queue cleanup: ${queueFailureMessage(
              error,
              'unknown queue error',
            )}`,
          );
        }
        return { ok: true, value: current, replayed: true };
      }
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
    if (!SAFE_KEY.test(command.idempotencyKey)) {
      return failed('validation_error', 'The idempotency key must be a safe ID.');
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
    const requester = await this.requesterAccess(command.context, 'submit');
    if (!requester.ok) return requester.error;
    const requestFingerprint = buildChessAnalysisJobFingerprint(request);
    const atMs = this.clock.nowMs();
    const jobId = this.ids.nextId();
    if (!SAFE_KEY.test(jobId)) {
      return failed('validation_error', 'Generated analysis job ID is invalid.');
    }
    const job = createDispatchingChessAnalysisJob({
      id: jobId,
      tenantPartition: requester.value.tenantPartition,
      requestedBy: requester.value.actorId,
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
    const checked = validateRepositoryJob(created.job, this.quota, {
      tenantPartition: requester.value.tenantPartition,
      ...(created.kind === 'created' ? { jobId: job.id } : {}),
      requestedBy: requester.value.actorId,
      idempotencyKey: command.idempotencyKey,
      requestFingerprint,
    });
    if (!checked.ok) {
      return failed(
        created.kind === 'existing' ? 'idempotency_conflict' : 'validation_error',
        checked.message,
      );
    }
    if (created.kind === 'existing') {
      if (checked.value.status === 'dispatching') {
        return this.dispatch(checked.value, true);
      }
      return { ok: true, value: checked.value, replayed: true };
    }
    return this.dispatch(checked.value);
  }

  private async loadAuthorizedJob(
    command: ChessAnalysisJobMutationCommand,
    action: ChessAnalysisJobMutationAction,
    checkExpectedVersion: boolean,
  ): Promise<
    | {
        readonly ok: true;
        readonly job: ChessAnalysisJob;
        readonly partition: string;
        readonly requesterActorId: string | null;
      }
    | { readonly ok: false; readonly error: ChessAnalysisJobServiceResult }
  > {
    const denial = authorized(command.policy);
    if (denial) return { ok: false, error: denial };
    if (!SAFE_KEY.test(command.jobId) || !positive(command.expectedVersion)) {
      return { ok: false, error: failed('validation_error', 'Job reference is invalid.') };
    }
    const principalIssue = principalProblem(command.principal, action);
    if (principalIssue) {
      return { ok: false, error: failed('authorization_denied', principalIssue) };
    }
    let partition: string;
    let requesterActorId: string | null = null;
    if (command.principal.kind === 'requester') {
      if (action !== 'cancel' && action !== 'retry') {
        return {
          ok: false,
          error: failed('authorization_denied', 'Requester mutation action is invalid.'),
        };
      }
      const requester = await this.requesterAccess(command.principal.context, action);
      if (!requester.ok) return { ok: false, error: requester.error };
      partition = requester.value.tenantPartition;
      requesterActorId = requester.value.actorId;
    } else {
      partition = command.principal.tenantPartition;
    }
    const loaded = await this.repository.get(partition, command.jobId);
    if (!loaded) {
      return { ok: false, error: failed('not_found', 'Analysis job was not found.') };
    }
    const checked = validateRepositoryJob(loaded, this.quota, {
      tenantPartition: partition,
      jobId: command.jobId,
    });
    if (!checked.ok) {
      return { ok: false, error: failed('validation_error', checked.message) };
    }
    const job = checked.value;
    if (command.principal.kind === 'requester') {
      if (job.requestedBy !== requesterActorId) {
        return {
          ok: false,
          error: failed('authorization_denied', 'Analysis job belongs to another requester.'),
        };
      }
    } else {
      let allowed: boolean;
      try {
        if (action === 'cancel' || action === 'retry') {
          return {
            ok: false,
            error: failed('authorization_denied', 'Worker mutation action is invalid.'),
          };
        }
        allowed = await this.authorization.authorize({
          action,
          principal: command.principal,
          job,
        });
      } catch {
        return {
          ok: false,
          error: failed(
            'authorization_denied',
            'Analysis job authorization could not be verified.',
          ),
        };
      }
      if (!allowed) {
        return {
          ok: false,
          error: failed('authorization_denied', 'Analysis job claim is not authorized.'),
        };
      }
    }
    if (job.request.policy !== command.policy) {
      return {
        ok: false,
        error: failed('validation_error', 'Mutation policy does not match the stored job.'),
      };
    }
    if (checkExpectedVersion && job.version !== command.expectedVersion) {
      return { ok: false, error: failed('conflict', 'Analysis job changed concurrently.') };
    }
    return { ok: true, job, partition, requesterActorId };
  }

  private async transition(
    command: ChessAnalysisJobMutationCommand,
    action: ChessAnalysisJobMutationAction,
    apply: (job: ChessAnalysisJob, atMs: number) => ChessAnalysisJobTransitionResult,
  ): Promise<ChessAnalysisJobServiceResult> {
    const loaded = await this.loadAuthorizedJob(command, action, true);
    if (!loaded.ok) return loaded.error;
    const job = loaded.job;
    const transitioned = apply(job, this.clock.nowMs());
    if (!transitioned.ok) return transitionError(transitioned);
    const checked = validateRepositoryJob(transitioned.value, this.quota, {
      tenantPartition: loaded.partition,
      jobId: job.id,
      requestedBy: job.requestedBy,
      idempotencyKey: job.idempotencyKey,
      requestFingerprint: job.requestFingerprint,
    });
    if (!checked.ok) return failed('validation_error', checked.message);
    const stored = await this.repository.save(checked.value, command.expectedVersion);
    if (stored !== 'saved') return failed(stored, 'Analysis job changed concurrently.');
    return { ok: true, value: checked.value, replayed: false };
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
    let canonicalOutput: ChessEngineAnalysis | null = null;
    const completed = await this.transition(command, 'complete', (job, atMs) => {
      const canonical = canonicalAnalysis(result, job.request, this.quota);
      invalidOutput = canonical.ok ? null : canonical.message;
      canonicalOutput = canonical.ok ? canonical.value : null;
      return invalidOutput
        ? failChessAnalysisJob(
            job,
            { code: 'invalid_output', message: invalidOutput, retryable: false },
            atMs,
          )
        : completeChessAnalysisJob(job, canonicalOutput as ChessEngineAnalysis, atMs);
    });
    if (completed.ok && invalidOutput) return failed('invalid_output', invalidOutput);
    return completed;
  }

  fail(
    command: ChessAnalysisJobMutationCommand,
    failure: Omit<ChessAnalysisJobFailure, 'failedAtMs'>,
  ): Promise<ChessAnalysisJobServiceResult> {
    if (
      !isExactRecord(failure, new Set(['code', 'message', 'retryable'])) ||
      !FAILURE_CODES.has(failure.code) ||
      !boundedText(failure.message) ||
      typeof failure.retryable !== 'boolean'
    ) {
      return Promise.resolve(failed('validation_error', 'Analysis failure is invalid.'));
    }
    return this.transition(command, 'fail', (job, atMs) =>
      failChessAnalysisJob(
        job,
        { code: failure.code, message: failure.message, retryable: failure.retryable },
        atMs,
      ),
    );
  }

  async cancel(
    command: ChessAnalysisJobMutationCommand,
    reason: string | null,
  ): Promise<ChessAnalysisJobServiceResult> {
    if (command.principal.kind !== 'requester') {
      return failed('authorization_denied', 'Only an authenticated requester can cancel a job.');
    }
    if (reason !== null && !boundedText(reason)) {
      return failed('validation_error', 'Cancellation reason is invalid.');
    }
    const loaded = await this.loadAuthorizedJob(command, 'cancel', false);
    if (!loaded.ok) return loaded.error;
    const actorId = loaded.requesterActorId;
    if (actorId === null) {
      return failed('authorization_denied', 'Cancellation requester could not be resolved.');
    }

    let result: ChessAnalysisJobServiceResult;
    if (loaded.job.status === 'cancelled') {
      if (
        loaded.job.cancellation?.requestedBy !== actorId ||
        loaded.job.cancellation.reason !== reason
      ) {
        return failed('conflict', 'Cancellation replay does not match the stored cancellation.');
      }
      result = { ok: true, value: loaded.job, replayed: true };
    } else {
      if (loaded.job.version !== command.expectedVersion) {
        return failed('conflict', 'Analysis job changed concurrently.');
      }
      const transitioned = cancelChessAnalysisJob(
        loaded.job,
        { requestedBy: actorId, reason },
        this.clock.nowMs(),
      );
      if (!transitioned.ok) return transitionError(transitioned);
      const checked = validateRepositoryJob(transitioned.value, this.quota, {
        tenantPartition: loaded.partition,
        jobId: loaded.job.id,
        requestedBy: loaded.job.requestedBy,
        idempotencyKey: loaded.job.idempotencyKey,
        requestFingerprint: loaded.job.requestFingerprint,
      });
      if (!checked.ok) return failed('validation_error', checked.message);
      const stored = await this.repository.save(checked.value, command.expectedVersion);
      if (stored !== 'saved') return failed(stored, 'Analysis job changed concurrently.');
      result = { ok: true, value: checked.value, replayed: false };
    }
    try {
      await this.queue.cancel(loaded.partition, command.jobId, loaded.job.attempt);
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
